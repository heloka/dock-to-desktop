import assert from "node:assert/strict";
import test from "node:test";
import { ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, registerAndPosition, type AppBarData } from "../src/appbar-core";

function data(): AppBarData {
  return {
    cbSize: 48,
    hWnd: 1,
    uCallbackMessage: 0xc001,
    uEdge: 2,
    rc: { left: 1500, top: 0, right: 2000, bottom: 1080 },
    lParam: 0
  };
}

test("registers, queries, then sets the shell-approved position", () => {
  const calls: number[] = [];
  const result = registerAndPosition((message, value) => {
    calls.push(message);
    if (message === ABM_QUERYPOS) value.rc.right = 1920;
    return 1;
  }, data(), "right", 400);

  assert.deepEqual(calls, [ABM_NEW, ABM_QUERYPOS, ABM_SETPOS]);
  assert.deepEqual(result, { left: 1520, top: 0, right: 1920, bottom: 1080 });
});

test("removes a partially registered appbar when positioning throws", () => {
  const calls: number[] = [];
  assert.throws(() => registerAndPosition((message) => {
    calls.push(message);
    if (message === ABM_QUERYPOS) throw new Error("query failed");
    return 1;
  }, data(), "right", 400), /query failed/);
  assert.deepEqual(calls, [ABM_NEW, ABM_QUERYPOS, ABM_REMOVE]);
});
