import { MarkdownView, Notice, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import { WindowsAppBar } from "./appbar";
import { boundsDiffer, NativeReflowGuard, ReflowCircuitBreaker, shouldReflowForDisplayMetrics } from "./event-policy";
import { computeDockRect } from "./geometry";
import { getBrowserWindowForDom, nativeInteger } from "./electron";
import { SerialExecutor } from "./serial";
import type { BrowserWindowLike, DisplayLike, DockSettings, ElectronRemoteLike, ScreenLike } from "./types";
import { hideWindowCompletely, prepareWindowForShow } from "./window-visibility";

const ABN_POSCHANGED = 1;
const ABN_FULLSCREENAPP = 2;
const WM_ACTIVATE = 0x0006;
const NATIVE_REFLOW_DEBOUNCE_MS = 150;
const NATIVE_NOTIFICATION_SUPPRESSION_MS = 1000;

type WindowState = "hidden" | "creating" | "visible" | "disposed";

export interface WindowSnapshot {
  appbar: ReturnType<WindowsAppBar["status"]>;
  browserWindowId: number | null;
  displayId: number | null;
  nativeModeDisabledForSession: boolean;
  state: WindowState;
}

export class DockWindowManager {
  private readonly serial = new SerialExecutor();
  private state: WindowState = "hidden";
  private leaf: WorkspaceLeaf | null = null;
  private domWindow: Window | null = null;
  private browserWindow: BrowserWindowLike | null = null;
  private targetDisplayId: number | null = null;
  private screen: ScreenLike;
  private nativeWarningShown = false;
  private readonly nativeReflowGuard = new NativeReflowGuard();
  private readonly reflowCircuitBreaker = new ReflowCircuitBreaker();
  private nativeDisabledForSession = false;
  private positionNotificationTimer: ReturnType<typeof setTimeout> | null = null;
  private hideVerificationTimer: ReturnType<typeof setTimeout> | null = null;
  private fullScreenAppOpen: boolean | null = null;
  private readonly displayTopologyChanged = (): void => { void this.serial.run(() => this.reflow(false)); };
  private readonly displayMetricsChanged = (...args: unknown[]): void => {
    const display = args[1] as DisplayLike | undefined;
    const changedMetrics = Array.isArray(args[2]) ? args[2].filter((value): value is string => typeof value === "string") : [];
    if (display && this.targetDisplayId !== null && display.id !== this.targetDisplayId) return;
    if (!shouldReflowForDisplayMetrics(changedMetrics)) return;
    void this.serial.run(() => this.reflow(false));
  };

  constructor(
    private readonly app: App,
    private readonly remote: ElectronRemoteLike,
    private readonly appbar: WindowsAppBar,
    private readonly getSettings: () => DockSettings,
    private readonly ensureNote: () => Promise<TFile>
  ) {
    this.screen = remote.screen;
  }

  start(): void {
    this.screen.on("display-added", this.displayTopologyChanged);
    this.screen.on("display-removed", this.displayTopologyChanged);
    this.screen.on("display-metrics-changed", this.displayMetricsChanged);
  }

  toggle(): Promise<void> {
    return this.serial.run(async () => {
      if (this.state === "disposed") return;
      if (this.state === "visible" || this.state === "creating") await this.hide();
      else await this.show();
    });
  }

  settingsChanged(): Promise<void> {
    return this.serial.run(() => this.reflow(false));
  }

  emergencyReset(): Promise<void> {
    return this.serial.run(async () => {
      this.clearPositionNotificationTimer();
      this.appbar.remove();
      if (this.state !== "disposed") this.state = "hidden";
      if (this.browserWindow && !this.browserWindow.isDestroyed()) {
        hideWindowCompletely(this.browserWindow);
        this.scheduleHideVerification(this.browserWindow);
      }
      this.fullScreenAppOpen = null;
    });
  }

  snapshot(): WindowSnapshot {
    return {
      appbar: this.appbar.status(),
      browserWindowId: this.browserWindow?.id ?? null,
      displayId: this.targetDisplayId,
      nativeModeDisabledForSession: this.nativeDisabledForSession,
      state: this.state
    };
  }

  dispose(): void {
    if (this.state === "disposed") return;
    this.state = "disposed";
    this.clearPositionNotificationTimer();
    this.clearHideVerificationTimer();
    this.screen.removeListener("display-added", this.displayTopologyChanged);
    this.screen.removeListener("display-removed", this.displayTopologyChanged);
    this.screen.removeListener("display-metrics-changed", this.displayMetricsChanged);
    this.appbar.remove();
    const browserWindow = this.browserWindow;
    this.browserWindow = null;
    this.leaf = null;
    this.domWindow = null;
    if (browserWindow && !browserWindow.isDestroyed()) {
      try { browserWindow.setAlwaysOnTop(false); } catch { /* shutdown */ }
      try { browserWindow.close(); } catch { /* shutdown */ }
    }
  }

  private async show(): Promise<void> {
    this.state = "creating";
    try {
      const file = await this.ensureNote();
      if (this.isDisposed()) return;
      await this.ensureWindow(file);
      if (this.isDisposed() || !this.browserWindow || !this.leaf) return;

      this.targetDisplayId = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint()).id;
      await this.positionWindow(true);
      if (this.isDisposed() || !this.browserWindow) return;
      this.clearHideVerificationTimer();
      prepareWindowForShow(this.browserWindow);
      this.browserWindow.setAlwaysOnTop(true, "floating");
      this.browserWindow.show();
      this.browserWindow.focus();
      this.state = "visible";
      this.focusEditorSoon();
    } catch (error) {
      this.appbar.remove();
      if (!this.isDisposed()) this.state = "hidden";
      new Notice(`Dock to Desktop：${error instanceof Error ? error.message : String(error)}`, 8000);
    }
  }

  private async hide(): Promise<void> {
    this.clearPositionNotificationTimer();
    this.appbar.remove();
    if (this.state !== "disposed") this.state = "hidden";
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      hideWindowCompletely(this.browserWindow);
      this.scheduleHideVerification(this.browserWindow);
    }
    this.fullScreenAppOpen = null;
    this.reflowCircuitBreaker.reset();
  }

  private async ensureWindow(file: TFile): Promise<void> {
    if (this.browserWindow && !this.browserWindow.isDestroyed() && this.leaf) {
      await this.leaf.openFile(file, { active: true });
      return;
    }

    const leaf = this.app.workspace.openPopoutLeaf();
    try {
      await leaf.openFile(file, { active: true });
      const container = leaf.getContainer();
      const domWindow = container.win;
      const browserWindow = await getBrowserWindowForDom(domWindow);
      if (!browserWindow) throw new Error("无法取得速记窗口的 Electron 句柄。请确认 Obsidian 桌面桥接可用。 ");
      if (this.state === "disposed") {
        browserWindow.close();
        return;
      }
      hideWindowCompletely(browserWindow);
      domWindow.document.body.classList.add("dock-to-desktop-window");
      this.leaf = leaf;
      this.domWindow = domWindow;
      this.browserWindow = browserWindow;
      browserWindow.on("closed", () => this.onWindowClosed(browserWindow));
      browserWindow.on("minimize", () => {
        if (browserWindow !== this.browserWindow || this.state !== "visible") return;
        void this.serial.run(() => this.hide());
      });
      browserWindow.on("show", () => {
        if (browserWindow !== this.browserWindow || this.state === "visible" || this.state === "creating") return;
        hideWindowCompletely(browserWindow);
      });
      this.hookNativeMessages(browserWindow);
    } catch (error) {
      try { leaf.detach(); } catch { /* incomplete popout */ }
      throw error;
    }
  }

  private async reflow(explorerRestarted: boolean): Promise<void> {
    if (this.state !== "visible" || !this.browserWindow || this.browserWindow.isDestroyed()) return;
    const display = this.getTargetDisplay();
    if (!display) return;
    if (this.nativeDisabledForSession) {
      this.applyFallbackBounds(display);
      return;
    }
    if (!this.reflowCircuitBreaker.record(Date.now())) {
      this.tripNativeCircuitBreaker();
      return;
    }
    this.suppressNativePositionNotifications();
    try {
      const bounds = explorerRestarted
        ? this.appbar.reregister(this.screen, display, this.getSettings())
        : this.appbar.reposition(this.screen, display, this.getSettings());
      if (bounds) this.setWindowBoundsIfChanged(bounds);
      else await this.positionWindow(false);
    } catch (error) {
      this.appbar.remove();
      this.applyFallbackBounds(display);
      this.warnNativeFallback(error);
    }
  }

  private async positionWindow(firstPlacement: boolean): Promise<void> {
    const browserWindow = this.browserWindow;
    if (!browserWindow) return;
    const display = this.getTargetDisplay();
    if (!display) throw new Error("没有找到可用的显示器。");
    const settings = this.getSettings();
    if (this.nativeDisabledForSession) {
      this.applyFallbackBounds(display);
      return;
    }
    this.suppressNativePositionNotifications();
    this.setWindowBoundsIfChanged(computeDockRect(display.bounds, settings.widthPercent, settings.side));
    try {
      const approved = this.appbar.register(browserWindow, this.screen, display, settings);
      this.setWindowBoundsIfChanged(approved);
    } catch (error) {
      this.appbar.remove();
      this.applyFallbackBounds(display);
      this.warnNativeFallback(error);
    }
    if (!firstPlacement && this.state === "visible") this.focusEditorSoon();
  }

  private getTargetDisplay(): DisplayLike | null {
    const displays = this.screen.getAllDisplays();
    const selected = displays.find((display) => display.id === this.targetDisplayId);
    if (selected) return selected;
    if (!displays.length) return null;
    const replacement = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint());
    this.targetDisplayId = replacement.id;
    return replacement;
  }

  private applyFallbackBounds(display: DisplayLike): void {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return;
    this.setWindowBoundsIfChanged(computeDockRect(display.workArea, this.getSettings().widthPercent, this.getSettings().side));
  }

  private warnNativeFallback(error: unknown): void {
    console.error("[DockToDesktop] Windows AppBar unavailable", error);
    if (this.nativeWarningShown) return;
    this.nativeWarningShown = true;
    const reason = error instanceof Error ? error.message : String(error);
    new Notice(`Dock to Desktop：系统分屏不可用，已回退为置顶窗口。${reason}`, 9000);
  }

  private tripNativeCircuitBreaker(): void {
    this.nativeDisabledForSession = true;
    this.clearPositionNotificationTimer();
    this.appbar.remove();
    if (!this.isDisposed()) this.state = "hidden";
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      hideWindowCompletely(this.browserWindow);
      this.scheduleHideVerification(this.browserWindow);
    }
    console.error("[DockToDesktop] Native layout circuit breaker tripped");
    new Notice("Dock to Desktop：检测到连续窗口重排，已自动释放分屏并收起窗口。本次 Obsidian 会话将改用普通置顶模式。", 10000);
  }

  private hookNativeMessages(browserWindow: BrowserWindowLike): void {
    if (process.platform !== "win32") return;
    const callbackMessage = this.appbar.callbackMessageId;
    const taskbarCreatedMessage = this.appbar.taskbarCreatedMessageId;
    if (callbackMessage) {
      browserWindow.hookWindowMessage(callbackMessage, (wParam, lParam) => {
        const notification = nativeInteger(wParam);
        if (notification === ABN_POSCHANGED) this.scheduleNativePositionReflow();
        if (notification === ABN_FULLSCREENAPP && this.browserWindow && !this.browserWindow.isDestroyed()) {
          const fullScreenOpened = nativeInteger(lParam) !== 0;
          if (this.fullScreenAppOpen === fullScreenOpened) return;
          this.fullScreenAppOpen = fullScreenOpened;
          if (fullScreenOpened) {
            this.browserWindow.setAlwaysOnTop(false);
            this.browserWindow.moveBottom?.();
          } else {
            this.browserWindow.setAlwaysOnTop(true, "floating");
          }
        }
      });
    }
    if (taskbarCreatedMessage) {
      browserWindow.hookWindowMessage(taskbarCreatedMessage, () => {
        if (this.state === "visible") void this.serial.run(() => this.reflow(true));
      });
    }
    browserWindow.hookWindowMessage(WM_ACTIVATE, (wParam) => {
      this.appbar.activate((nativeInteger(wParam) & 0xffff) !== 0);
    });
  }

  private suppressNativePositionNotifications(): void {
    this.nativeReflowGuard.suppress(Date.now(), NATIVE_NOTIFICATION_SUPPRESSION_MS);
  }

  private scheduleNativePositionReflow(): void {
    if (!this.nativeReflowGuard.tryQueue(Date.now())) return;
    this.positionNotificationTimer = setTimeout(() => {
      this.positionNotificationTimer = null;
      this.nativeReflowGuard.release();
      if (!this.nativeReflowGuard.canRun(Date.now()) || this.state !== "visible") return;
      void this.serial.run(() => this.reflow(false));
    }, NATIVE_REFLOW_DEBOUNCE_MS);
  }

  private clearPositionNotificationTimer(): void {
    if (this.positionNotificationTimer === null) return;
    clearTimeout(this.positionNotificationTimer);
    this.positionNotificationTimer = null;
    this.nativeReflowGuard.release();
  }

  private scheduleHideVerification(browserWindow: BrowserWindowLike): void {
    this.clearHideVerificationTimer();
    this.hideVerificationTimer = setTimeout(() => {
      this.hideVerificationTimer = null;
      if (this.state !== "hidden" || browserWindow !== this.browserWindow || browserWindow.isDestroyed()) return;
      if (browserWindow.isVisible() || browserWindow.isMinimized()) hideWindowCompletely(browserWindow);
    }, 80);
  }

  private clearHideVerificationTimer(): void {
    if (this.hideVerificationTimer === null) return;
    clearTimeout(this.hideVerificationTimer);
    this.hideVerificationTimer = null;
  }

  private setWindowBoundsIfChanged(bounds: { x: number; y: number; width: number; height: number }): void {
    const browserWindow = this.browserWindow;
    if (!browserWindow || browserWindow.isDestroyed()) return;
    if (boundsDiffer(browserWindow.getBounds(), bounds)) browserWindow.setBounds(bounds, false);
  }

  private focusEditorSoon(): void {
    const leaf = this.leaf;
    const domWindow = this.domWindow;
    if (!leaf || !domWindow) return;
    domWindow.setTimeout(() => {
      if (this.state !== "visible") return;
      const view = leaf.view as Partial<MarkdownView>;
      if (view.editor && typeof view.editor.focus === "function") view.editor.focus();
    }, 40);
  }

  private onWindowClosed(closedWindow: BrowserWindowLike): void {
    if (closedWindow !== this.browserWindow) return;
    this.appbar.remove();
    this.browserWindow = null;
    this.domWindow = null;
    this.leaf = null;
    this.targetDisplayId = null;
    this.fullScreenAppOpen = null;
    this.clearPositionNotificationTimer();
    this.clearHideVerificationTimer();
    if (!this.isDisposed()) this.state = "hidden";
  }

  private isDisposed(): boolean {
    return this.state === "disposed";
  }
}
