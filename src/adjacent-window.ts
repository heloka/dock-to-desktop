import path from "node:path";
import type { DisplayLike, Rectangle, ScreenLike } from "./types";

const SW_MAXIMIZE = 3;
const SW_RESTORE = 9;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_ASYNCWINDOWPOS = 0x4000;

interface NativeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AdjacentNativeApi {
  GetForegroundWindow(): unknown;
  GetWindowRect(hWnd: unknown, rect: NativeRect): number;
  GetWindowThreadProcessId(hWnd: unknown, processId: Array<number | null>): number;
  IsWindow(hWnd: unknown): number;
  IsWindowVisible(hWnd: unknown): number;
  IsZoomed(hWnd: unknown): number;
  SetWindowPos(hWnd: unknown, insertAfter: unknown, x: number, y: number, width: number, height: number, flags: number): number;
  ShowWindowAsync(hWnd: unknown, command: number): number;
}

export interface AdjacentWindowStatus {
  available: boolean;
  error?: string;
  managed: boolean;
}

interface ManagedWindow {
  hWnd: unknown;
  restoredForDock: boolean;
}

export function rectCenterIsInside(rect: NativeRect, area: Rectangle): boolean {
  const centerX = rect.left + (rect.right - rect.left) / 2;
  const centerY = rect.top + (rect.bottom - rect.top) / 2;
  return centerX >= area.x && centerX < area.x + area.width
    && centerY >= area.y && centerY < area.y + area.height;
}

export class WindowsAdjacentWindow {
  private api: AdjacentNativeApi | null | undefined;
  private loadError: string | undefined;
  private managed: ManagedWindow | null = null;

  constructor(private readonly pluginDir: string, api?: AdjacentNativeApi) {
    this.api = api;
  }

  status(): AdjacentWindowStatus {
    return {
      available: Boolean(this.ensureApi()),
      error: this.loadError,
      managed: Boolean(this.managed)
    };
  }

  captureForeground(screen: ScreenLike, display: DisplayLike): boolean {
    this.restore();
    const api = this.ensureApi();
    if (!api) return false;
    const hWnd = api.GetForegroundWindow();
    if (!hWnd || !api.IsWindow(hWnd) || !api.IsWindowVisible(hWnd) || !api.IsZoomed(hWnd)) return false;

    const processId: Array<number | null> = [null];
    if (!api.GetWindowThreadProcessId(hWnd, processId) || processId[0] === process.pid) return false;

    const windowRect: NativeRect = { left: 0, top: 0, right: 0, bottom: 0 };
    if (!api.GetWindowRect(hWnd, windowRect)) return false;
    const displayPhysical = screen.dipToScreenRect(null, display.bounds);
    if (!rectCenterIsInside(windowRect, displayPhysical)) return false;

    this.managed = { hWnd, restoredForDock: false };
    return true;
  }

  arrange(screen: ScreenLike, bounds: Rectangle): boolean {
    const api = this.ensureApi();
    const managed = this.managed;
    if (!api || !managed) return false;
    if (!api.IsWindow(managed.hWnd)) {
      this.managed = null;
      return false;
    }

    if (!managed.restoredForDock) {
      if (!api.ShowWindowAsync(managed.hWnd, SW_RESTORE)) throw new Error("无法把原前台窗口切换为可调整状态。");
      managed.restoredForDock = true;
    }
    const physical = screen.dipToScreenRect(null, bounds);
    const moved = api.SetWindowPos(
      managed.hWnd,
      null,
      Math.round(physical.x),
      Math.round(physical.y),
      Math.max(1, Math.round(physical.width)),
      Math.max(1, Math.round(physical.height)),
      SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS
    );
    if (!moved) throw new Error("无法同步调整原前台窗口。");
    return true;
  }

  restore(): void {
    const managed = this.managed;
    this.managed = null;
    const api = this.ensureApi();
    if (!api || !managed?.restoredForDock) return;
    try {
      if (api.IsWindow(managed.hWnd)) api.ShowWindowAsync(managed.hWnd, SW_MAXIMIZE);
    } catch {
      // The other application may already be closing.
    }
  }

  private ensureApi(): AdjacentNativeApi | null {
    if (this.api !== undefined) return this.api;
    if (process.platform !== "win32" || process.arch !== "x64") {
      this.loadError = "相邻窗口联动仅支持 Windows x64。";
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
      koffi.alias(`DTD_HWND_${suffix}`, koffi.pointer(koffi.opaque(`DTD_HWND_VALUE_${suffix}`)));
      koffi.alias(`DTD_DWORD_${suffix}`, "uint32_t");
      koffi.struct(`DTD_ADJ_RECT_${suffix}`, { left: "long", top: "long", right: "long", bottom: "long" });
      const user32 = koffi.load("user32.dll");
      const api = {
        GetForegroundWindow: user32.func(`DTD_HWND_${suffix} __stdcall GetForegroundWindow()`),
        GetWindowRect: user32.func(`int __stdcall GetWindowRect(DTD_HWND_${suffix} hWnd, _Out_ DTD_ADJ_RECT_${suffix} *lpRect)`),
        GetWindowThreadProcessId: user32.func(`DTD_DWORD_${suffix} __stdcall GetWindowThreadProcessId(DTD_HWND_${suffix} hWnd, _Out_ DTD_DWORD_${suffix} *lpdwProcessId)`),
        IsWindow: user32.func(`int __stdcall IsWindow(DTD_HWND_${suffix} hWnd)`),
        IsWindowVisible: user32.func(`int __stdcall IsWindowVisible(DTD_HWND_${suffix} hWnd)`),
        IsZoomed: user32.func(`int __stdcall IsZoomed(DTD_HWND_${suffix} hWnd)`),
        SetWindowPos: user32.func(`int __stdcall SetWindowPos(DTD_HWND_${suffix} hWnd, DTD_HWND_${suffix} hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)`),
        ShowWindowAsync: user32.func(`int __stdcall ShowWindowAsync(DTD_HWND_${suffix} hWnd, int nCmdShow)`)
      } as unknown as AdjacentNativeApi;
      this.api = api;
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error);
      this.api = null;
    }
    return this.api;
  }
}
