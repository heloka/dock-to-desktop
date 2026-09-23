import path from "node:path";
import type { DisplayLike, DockSide, Rectangle, ScreenLike } from "./types";

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
  captureResult: string;
  error?: string;
  managed: boolean;
}

interface ManagedWindow {
  hWnd: unknown;
  initiallyMaximized: boolean;
  originalBounds: Rectangle;
  changedForDock: boolean;
}

export function rectCenterIsInside(rect: NativeRect, area: Rectangle): boolean {
  const centerX = rect.left + (rect.right - rect.left) / 2;
  const centerY = rect.top + (rect.bottom - rect.top) / 2;
  return centerX >= area.x && centerX < area.x + area.width
    && centerY >= area.y && centerY < area.y + area.height;
}

export function isFullHeightEdgeWindow(rect: NativeRect, workArea: Rectangle, side: DockSide): boolean {
  const edgeTolerance = 32;
  const topTolerance = 32;
  const visibleHeight = Math.min(rect.bottom, workArea.y + workArea.height) - Math.max(rect.top, workArea.y);
  if (visibleHeight < workArea.height * 0.8 || Math.abs(rect.top - workArea.y) > topTolerance) return false;
  return side === "right"
    ? Math.abs(rect.left - workArea.x) <= edgeTolerance
    : Math.abs(rect.right - (workArea.x + workArea.width)) <= edgeTolerance;
}

export class WindowsAdjacentWindow {
  private api: AdjacentNativeApi | null | undefined;
  private loadError: string | undefined;
  private managed: ManagedWindow | null = null;
  private captureResult = "尚未尝试";
  private verificationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly pluginDir: string, api?: AdjacentNativeApi) {
    this.api = api;
  }

  status(): AdjacentWindowStatus {
    return {
      available: Boolean(this.ensureApi()),
      captureResult: this.captureResult,
      error: this.loadError,
      managed: Boolean(this.managed)
    };
  }

  captureForeground(screen: ScreenLike, display: DisplayLike, side: DockSide, excludedHandles: readonly bigint[] = []): boolean {
    this.restore();
    const api = this.ensureApi();
    if (!api) {
      this.captureResult = "Windows 窗口接口不可用";
      return false;
    }
    const hWnd = api.GetForegroundWindow();
    if (!hWnd || !api.IsWindow(hWnd) || !api.IsWindowVisible(hWnd)) {
      this.captureResult = "没有可用的前台窗口";
      return false;
    }
    if (typeof hWnd === "bigint" && excludedHandles.includes(hWnd)) {
      this.captureResult = "前台窗口属于 Obsidian";
      return false;
    }

    const processId: Array<number | null> = [null];
    if (!api.GetWindowThreadProcessId(hWnd, processId) || processId[0] === process.pid) {
      this.captureResult = "前台窗口无法读取或属于 Obsidian";
      return false;
    }

    const windowRect: NativeRect = { left: 0, top: 0, right: 0, bottom: 0 };
    if (!api.GetWindowRect(hWnd, windowRect)) {
      this.captureResult = "无法读取前台窗口位置";
      return false;
    }
    const displayPhysical = screen.dipToScreenRect(null, display.bounds);
    if (!rectCenterIsInside(windowRect, displayPhysical)) {
      this.captureResult = "前台窗口位于其他屏幕";
      return false;
    }
    const initiallyMaximized = Boolean(api.IsZoomed(hWnd));
    const workAreaPhysical = screen.dipToScreenRect(null, display.workArea);
    if (!initiallyMaximized && !isFullHeightEdgeWindow(windowRect, workAreaPhysical, side)) {
      this.captureResult = "前台窗口未最大化，也未贴靠屏幕边缘";
      return false;
    }

    this.managed = {
      hWnd,
      initiallyMaximized,
      originalBounds: {
        x: windowRect.left,
        y: windowRect.top,
        width: windowRect.right - windowRect.left,
        height: windowRect.bottom - windowRect.top
      },
      changedForDock: false
    };
    this.captureResult = initiallyMaximized ? "已接管最大化窗口" : "已接管贴边窗口";
    return true;
  }

  arrange(screen: ScreenLike, bounds: Rectangle): boolean {
    const api = this.ensureApi();
    const managed = this.managed;
    if (!api || !managed) return false;
    if (!api.IsWindow(managed.hWnd)) {
      this.managed = null;
      this.captureResult = "原前台窗口已关闭";
      return false;
    }

    if (api.IsZoomed(managed.hWnd)) {
      if (!api.ShowWindowAsync(managed.hWnd, SW_RESTORE)) throw new Error("无法把原前台窗口切换为可调整状态。");
    }
    managed.changedForDock = true;
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
    this.scheduleVerification(managed, {
      x: Math.round(physical.x),
      y: Math.round(physical.y),
      width: Math.max(1, Math.round(physical.width)),
      height: Math.max(1, Math.round(physical.height))
    });
    return true;
  }

  restore(): void {
    if (this.verificationTimer !== null) clearTimeout(this.verificationTimer);
    this.verificationTimer = null;
    const managed = this.managed;
    this.managed = null;
    const api = this.ensureApi();
    if (!api || !managed?.changedForDock) return;
    try {
      if (!api.IsWindow(managed.hWnd)) return;
      if (managed.initiallyMaximized) api.ShowWindowAsync(managed.hWnd, SW_MAXIMIZE);
      else {
        if (api.IsZoomed(managed.hWnd)) api.ShowWindowAsync(managed.hWnd, SW_RESTORE);
        api.SetWindowPos(
          managed.hWnd,
          null,
          managed.originalBounds.x,
          managed.originalBounds.y,
          managed.originalBounds.width,
          managed.originalBounds.height,
          SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS
        );
      }
    } catch {
      // The other application may already be closing.
    }
  }

  private scheduleVerification(managed: ManagedWindow, desired: Rectangle, retryCount = 0): void {
    if (this.verificationTimer !== null) clearTimeout(this.verificationTimer);
    this.verificationTimer = setTimeout(() => {
      this.verificationTimer = null;
      const api = this.ensureApi();
      if (!api || managed !== this.managed || !api.IsWindow(managed.hWnd)) return;
      const actual: NativeRect = { left: 0, top: 0, right: 0, bottom: 0 };
      if (!api.GetWindowRect(managed.hWnd, actual)) return;
      const gap = Math.max(
        Math.abs(actual.left - desired.x),
        Math.abs(actual.top - desired.y),
        Math.abs(actual.right - desired.x - desired.width),
        Math.abs(actual.bottom - desired.y - desired.height)
      );
      if (gap <= 12) return;
      if (retryCount >= 1) {
        this.captureResult = "原前台窗口未接受目标尺寸";
        return;
      }
      try {
        if (api.IsZoomed(managed.hWnd)) api.ShowWindowAsync(managed.hWnd, SW_RESTORE);
        const accepted = api.SetWindowPos(
          managed.hWnd,
          null,
          desired.x,
          desired.y,
          desired.width,
          desired.height,
          SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS
        );
        if (accepted) this.scheduleVerification(managed, desired, retryCount + 1);
        else this.captureResult = "原前台窗口拒绝调整尺寸";
      } catch {
        this.captureResult = "原前台窗口拒绝调整尺寸";
      }
    }, 140);
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
