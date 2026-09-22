import type { DockSide } from "./types";

export const ABM_NEW = 0;
export const ABM_REMOVE = 1;
export const ABM_QUERYPOS = 2;
export const ABM_SETPOS = 3;
export const ABM_ACTIVATE = 6;
export const ABM_WINDOWPOSCHANGED = 9;
export const ABE_LEFT = 0;
export const ABE_RIGHT = 2;

export interface NativeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AppBarData {
  cbSize: number;
  hWnd: unknown;
  uCallbackMessage: number;
  uEdge: number;
  rc: NativeRect;
  lParam: number;
}

export type SendAppBarMessage = (message: number, data: AppBarData) => unknown;

export function queryAndSetPosition(send: SendAppBarMessage, data: AppBarData, side: DockSide, thickness: number): NativeRect {
  send(ABM_QUERYPOS, data);
  if (side === "left") data.rc.right = data.rc.left + thickness;
  else data.rc.left = data.rc.right - thickness;
  send(ABM_SETPOS, data);
  return { ...data.rc };
}

export function registerAndPosition(send: SendAppBarMessage, data: AppBarData, side: DockSide, thickness: number): NativeRect {
  if (!send(ABM_NEW, data)) throw new Error("Windows 拒绝了 ABM_NEW 请求。快捷窗口可能已经被其他 AppBar 注册。");
  try {
    return queryAndSetPosition(send, data, side, thickness);
  } catch (error) {
    try { send(ABM_REMOVE, data); } catch { /* best effort rollback */ }
    throw error;
  }
}
