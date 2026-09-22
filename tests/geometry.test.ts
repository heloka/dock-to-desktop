import assert from "node:assert/strict";
import test from "node:test";
import { computeDockRect, physicalToDipFallback, screenRectToDip } from "../src/geometry";

test("docks to either edge and preserves room for another window", () => {
  assert.deepEqual(computeDockRect({ x: 0, y: 0, width: 1920, height: 1040 }, 25, "right"), {
    x: 1440, y: 0, width: 480, height: 1040
  });
  assert.deepEqual(computeDockRect({ x: -1280, y: 0, width: 1280, height: 984 }, 60, "left"), {
    x: -1280, y: 0, width: 768, height: 984
  });
});

test("converts physical coordinates relative to a mixed-DPI display origin", () => {
  assert.deepEqual(physicalToDipFallback(
    { x: -768, y: 0, width: 768, height: 1536 },
    { x: -1280, y: 0, width: 1280, height: 1024 },
    { x: -1920, y: 0, width: 1920, height: 1536 },
    1.5
  ), { x: -512, y: 0, width: 512, height: 1024 });
});

test("falls back when Electron rejects a remote object during coordinate conversion", () => {
  assert.deepEqual(screenRectToDip(
    { x: 1440, y: 0, width: 480, height: 1080 },
    { x: 0, y: 0, width: 1536, height: 864 },
    { x: 0, y: 0, width: 1920, height: 1080 },
    1.25,
    () => { throw new Error("conversion failure from remote BrowserWindow"); }
  ), { x: 1152, y: 0, width: 384, height: 864 });
});
