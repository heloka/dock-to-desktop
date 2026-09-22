import assert from "node:assert/strict";
import test from "node:test";
import { WindowsAdjacentWindow, type AdjacentNativeApi } from "../src/adjacent-window";
import type { DisplayLike, Rectangle, ScreenLike } from "../src/types";

function createScreen(scale = 1): ScreenLike {
  const display: DisplayLike = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    scaleFactor: scale
  };
  return {
    dipToScreenRect(_window, rect): Rectangle {
      return { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale };
    },
    getAllDisplays: () => [display],
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => display,
    on: () => undefined,
    removeListener: () => undefined,
    screenToDipRect: (_window, rect) => rect
  };
}

test("restores, resizes, and re-maximizes the captured foreground window", () => {
  const hWnd = {};
  const calls: Array<unknown[]> = [];
  const api: AdjacentNativeApi = {
    GetForegroundWindow: () => hWnd,
    GetWindowRect(_hWnd, rect) {
      Object.assign(rect, { left: 0, top: 0, right: 1920, bottom: 1080 });
      return 1;
    },
    GetWindowThreadProcessId(_hWnd, processId) {
      processId[0] = process.pid + 1;
      return 7;
    },
    IsWindow: () => 1,
    IsWindowVisible: () => 1,
    IsZoomed: () => 1,
    SetWindowPos(...args) {
      calls.push(["position", ...args]);
      return 1;
    },
    ShowWindowAsync(...args) {
      calls.push(["show", ...args]);
      return 1;
    }
  };
  const screen = createScreen(1.25);
  const display = screen.getAllDisplays()[0];
  const manager = new WindowsAdjacentWindow("", api);

  assert.equal(manager.captureForeground(screen, display), true);
  assert.equal(manager.arrange(screen, { x: 0, y: 0, width: 1200, height: 800 }), true);
  assert.equal(manager.arrange(screen, { x: 0, y: 0, width: 1000, height: 800 }), true);
  manager.restore();

  assert.deepEqual(calls, [
    ["show", hWnd, 9],
    ["position", hWnd, null, 0, 0, 1500, 1000, 0x4014],
    ["position", hWnd, null, 0, 0, 1250, 1000, 0x4014],
    ["show", hWnd, 3]
  ]);
  assert.equal(manager.status().managed, false);
});

test("does not manage Obsidian itself, ordinary windows, or another screen", () => {
  const hWnd = {};
  let processId = process.pid;
  let maximized = 1;
  let rect = { left: 0, top: 0, right: 1920, bottom: 1080 };
  const api: AdjacentNativeApi = {
    GetForegroundWindow: () => hWnd,
    GetWindowRect(_hWnd, output) { Object.assign(output, rect); return 1; },
    GetWindowThreadProcessId(_hWnd, output) { output[0] = processId; return 7; },
    IsWindow: () => 1,
    IsWindowVisible: () => 1,
    IsZoomed: () => maximized,
    SetWindowPos: () => 1,
    ShowWindowAsync: () => 1
  };
  const screen = createScreen();
  const display = screen.getAllDisplays()[0];
  const manager = new WindowsAdjacentWindow("", api);

  assert.equal(manager.captureForeground(screen, display), false);
  processId += 1;
  maximized = 0;
  assert.equal(manager.captureForeground(screen, display), false);
  maximized = 1;
  rect = { left: 1920, top: 0, right: 3840, bottom: 1080 };
  assert.equal(manager.captureForeground(screen, display), false);
});
