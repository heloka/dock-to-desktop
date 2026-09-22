import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserWindowLike } from "../src/types";
import { hideWindowCompletely, prepareWindowForShow } from "../src/window-visibility";

function fakeWindow(minimized: boolean): { browserWindow: BrowserWindowLike; calls: string[] } {
  const calls: string[] = [];
  const browserWindow = {
    blur: () => { calls.push("blur"); },
    hide: () => { calls.push("hide"); },
    isMinimized: () => minimized,
    restore: () => { calls.push("restore"); },
    setAlwaysOnTop: (flag: boolean) => { calls.push(`always-on-top:${flag}`); },
    setFocusable: (flag: boolean) => { calls.push(`focusable:${flag}`); },
    setSkipTaskbar: (skip: boolean) => { calls.push(`skip-taskbar:${skip}`); }
  } as BrowserWindowLike;
  return { browserWindow, calls };
}

test("fully hides a popout from the desktop and task switcher", () => {
  const { browserWindow, calls } = fakeWindow(false);
  hideWindowCompletely(browserWindow);
  assert.deepEqual(calls, [
    "always-on-top:false",
    "blur",
    "focusable:false",
    "skip-taskbar:true",
    "hide"
  ]);
});

test("restores a minimized popout before showing it again", () => {
  const { browserWindow, calls } = fakeWindow(true);
  prepareWindowForShow(browserWindow);
  assert.deepEqual(calls, ["focusable:true", "skip-taskbar:false", "restore"]);
});

test("still hides when a taskbar bridge method is unavailable", () => {
  const { browserWindow, calls } = fakeWindow(false);
  browserWindow.setSkipTaskbar = () => { throw new Error("unsupported bridge method"); };
  hideWindowCompletely(browserWindow);
  assert.equal(calls.at(-1), "hide");
});
