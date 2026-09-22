import path from "node:path";
import { ABE_LEFT, ABE_RIGHT, ABM_ACTIVATE, ABM_REMOVE, ABM_WINDOWPOSCHANGED, queryAndSetPosition, registerAndPosition, type AppBarData } from "./appbar-core";
import { computeDockRect, edgesFromRect, rectFromEdges, screenRectToDip } from "./geometry";
import type { BrowserWindowLike, DisplayLike, DockSettings, Rectangle, ScreenLike } from "./types";

interface NativeApi {
  APPBARDATA: unknown;
  RegisterWindowMessageW(name: string): number;
  SHAppBarMessage(message: number, data: AppBarData): unknown;
  koffi: {
    decode(buffer: Buffer, offset: number, type: string): unknown;
    sizeof(type: unknown): number;
  };
}

export interface AppBarStatus {
  available: boolean;
  error?: string;
  registered: boolean;
}

export class WindowsAppBar {
  private api: NativeApi | null | undefined;
  private loadError: string | undefined;
  private browserWindow: BrowserWindowLike | null = null;
  private callbackMessage = 0;
  private taskbarCreatedMessage = 0;
  private data: AppBarData | null = null;
  private registered = false;
  private lastOperationError: string | undefined;

  constructor(private readonly pluginDir: string) {}

  get callbackMessageId(): number { this.ensureApi(); return this.callbackMessage; }
  get taskbarCreatedMessageId(): number { this.ensureApi(); return this.taskbarCreatedMessage; }
  get isRegistered(): boolean { return this.registered; }

  status(): AppBarStatus {
    const available = Boolean(this.ensureApi());
    return { available, error: this.lastOperationError ?? this.loadError, registered: this.registered };
  }

  register(browserWindow: BrowserWindowLike, screen: ScreenLike, display: DisplayLike, settings: DockSettings): Rectangle {
    const api = this.ensureApi();
    if (!api) throw new Error(this.loadError ?? "Windows AppBar 接口不可用。");
    this.remove();
    try {
      const requestedDip = computeDockRect(display.bounds, settings.widthPercent, settings.side);
      const requestedPhysical = screen.dipToScreenRect(null, requestedDip);
      const monitorPhysical = screen.dipToScreenRect(null, display.bounds);
      const rc = edgesFromRect({
        x: settings.side === "left" ? monitorPhysical.x : requestedPhysical.x,
        y: monitorPhysical.y,
        width: requestedPhysical.width,
        height: monitorPhysical.height
      });
      const hWnd = api.koffi.decode(browserWindow.getNativeWindowHandle(), 0, "void *");
      const data: AppBarData = {
        cbSize: api.koffi.sizeof(api.APPBARDATA),
        hWnd,
        uCallbackMessage: this.callbackMessage,
        uEdge: settings.side === "left" ? ABE_LEFT : ABE_RIGHT,
        rc,
        lParam: 0
      };

      const approved = registerAndPosition(
        (message, value) => api.SHAppBarMessage(message, value),
        data,
        settings.side,
        requestedPhysical.width
      );
      this.browserWindow = browserWindow;
      this.data = data;
      this.registered = true;
      const bounds = this.toDipRect(screen, approved, display, monitorPhysical);
      this.lastOperationError = undefined;
      return bounds;
    } catch (error) {
      this.lastOperationError = error instanceof Error ? error.message : String(error);
      this.remove();
      throw error;
    }
  }

  reposition(screen: ScreenLike, display: DisplayLike, settings: DockSettings): Rectangle | null {
    const api = this.ensureApi();
    if (!api || !this.registered || !this.data || !this.browserWindow) return null;
    const requestedDip = computeDockRect(display.bounds, settings.widthPercent, settings.side);
    const requestedPhysical = screen.dipToScreenRect(null, requestedDip);
    const monitorPhysical = screen.dipToScreenRect(null, display.bounds);
    this.data.uEdge = settings.side === "left" ? ABE_LEFT : ABE_RIGHT;
    this.data.rc = edgesFromRect({
      x: settings.side === "left" ? monitorPhysical.x : requestedPhysical.x,
      y: monitorPhysical.y,
      width: requestedPhysical.width,
      height: monitorPhysical.height
    });
    const approved = queryAndSetPosition(
      (message, value) => api.SHAppBarMessage(message, value),
      this.data,
      settings.side,
      requestedPhysical.width
    );
    return this.toDipRect(screen, approved, display, monitorPhysical);
  }

  reregister(screen: ScreenLike, display: DisplayLike, settings: DockSettings): Rectangle | null {
    const browserWindow = this.browserWindow;
    this.registered = false;
    this.data = null;
    return browserWindow ? this.register(browserWindow, screen, display, settings) : null;
  }

  activate(active: boolean): void {
    const api = this.ensureApi();
    if (!api || !this.registered || !this.data) return;
    this.data.lParam = active ? 1 : 0;
    api.SHAppBarMessage(ABM_ACTIVATE, this.data);
  }

  windowPositionChanged(): void {
    const api = this.ensureApi();
    if (!api || !this.registered || !this.data) return;
    api.SHAppBarMessage(ABM_WINDOWPOSCHANGED, this.data);
  }

  remove(): void {
    const api = this.ensureApi();
    if (api && this.registered && this.data) {
      try { api.SHAppBarMessage(ABM_REMOVE, this.data); } catch { /* the native window may already be gone */ }
    }
    this.registered = false;
    this.data = null;
    this.browserWindow = null;
  }

  private toDipRect(
    screen: ScreenLike,
    approved: { left: number; top: number; right: number; bottom: number },
    display: DisplayLike,
    physicalDisplay: Rectangle
  ): Rectangle {
    const physical = rectFromEdges(approved);
    return screenRectToDip(
      physical,
      display.bounds,
      physicalDisplay,
      display.scaleFactor,
      typeof screen.screenToDipRect === "function" ? (rect) => screen.screenToDipRect(null, rect) : undefined
    );
  }

  private ensureApi(): NativeApi | null {
    if (this.api !== undefined) return this.api;
    if (process.platform !== "win32" || process.arch !== "x64") {
      this.loadError = "原生停靠首版仅支持 Windows x64。";
      this.api = null;
      return null;
    }

    try {
      let koffi: typeof import("koffi") | null = null;
      const loaders = [
        () => require("koffi") as typeof import("koffi"),
        () => require(path.join(this.pluginDir, "node_modules", "koffi")) as typeof import("koffi")
      ];
      for (const load of loaders) {
        try { koffi = load(); break; } catch { /* try the absolute plugin path */ }
      }
      if (!koffi) throw new Error("找不到插件随附的 koffi 原生组件。");

      const suffix = Math.random().toString(36).slice(2, 9);
      const RECT = koffi.struct(`DTD_RECT_${suffix}`, { left: "long", top: "long", right: "long", bottom: "long" });
      const APPBARDATA = koffi.struct(`DTD_APPBARDATA_${suffix}`, {
        cbSize: "uint32_t",
        hWnd: "void *",
        uCallbackMessage: "uint32_t",
        uEdge: "uint32_t",
        rc: RECT,
        lParam: "intptr_t"
      });
      const user32 = koffi.load("user32.dll");
      const shell32 = koffi.load("shell32.dll");
      const api = {
        koffi,
        APPBARDATA,
        RegisterWindowMessageW: user32.func("uint32_t __stdcall RegisterWindowMessageW(str16 lpString)"),
        SHAppBarMessage: shell32.func(`uintptr_t __stdcall SHAppBarMessage(uint32_t dwMessage, _Inout_ DTD_APPBARDATA_${suffix} *pData)`)
      } as unknown as NativeApi;
      this.callbackMessage = api.RegisterWindowMessageW("Obsidian.DockToDesktop.AppBar.Callback.v2");
      this.taskbarCreatedMessage = api.RegisterWindowMessageW("TaskbarCreated");
      if (!this.callbackMessage || !this.taskbarCreatedMessage) throw new Error("无法注册 Windows 窗口消息。");
      this.api = api;
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error);
      this.api = null;
    }
    return this.api;
  }
}
