export type DockSide = "left" | "right";

export interface DockSettings {
  accelerator: string;
  notePath: string;
  side: DockSide;
  widthPercent: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayLike {
  id: number;
  bounds: Rectangle;
  workArea: Rectangle;
  scaleFactor: number;
}

export interface BrowserWindowLike {
  id: number;
  close(): void;
  focus(): void;
  getBounds(): Rectangle;
  getNativeWindowHandle(): Buffer;
  hide(): void;
  hookWindowMessage(message: number, callback: (wParam: Buffer, lParam: Buffer) => void): void;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  moveBottom?(): void;
  on(event: "closed", callback: () => void): void;
  restore(): void;
  setAlwaysOnTop(flag: boolean, level?: string): void;
  setBounds(bounds: Rectangle, animate?: boolean): void;
  show(): void;
}

export interface ScreenLike {
  dipToScreenRect(window: BrowserWindowLike | null, rect: Rectangle): Rectangle;
  getAllDisplays(): DisplayLike[];
  getCursorScreenPoint(): { x: number; y: number };
  getDisplayNearestPoint(point: { x: number; y: number }): DisplayLike;
  on(event: string, callback: (...args: unknown[]) => void): void;
  removeListener(event: string, callback: (...args: unknown[]) => void): void;
  screenToDipRect(window: BrowserWindowLike | null, rect: Rectangle): Rectangle;
}

export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface ElectronRemoteLike {
  BrowserWindow: unknown;
  getCurrentWindow(): BrowserWindowLike;
  globalShortcut: GlobalShortcutLike;
  screen: ScreenLike;
}
