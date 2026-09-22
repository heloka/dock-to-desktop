import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, migrateSettings, validateNotePath } from "../src/settings";

test("migrates valid v1 settings and discards the old window mode", () => {
  assert.deepEqual(migrateSettings({
    accelerator: "Ctrl+Shift+N",
    appbar: false,
    mode: "main",
    notePath: "Inbox/Quick.md",
    side: "left",
    widthPercent: 34
  }), {
    accelerator: "Ctrl+Shift+N",
    notePath: "Inbox/Quick.md",
    side: "left",
    widthPercent: 34
  });
});

test("uses safe defaults and clamps the configured width", () => {
  assert.deepEqual(migrateSettings({ widthPercent: 99, side: "bottom" }), {
    ...DEFAULT_SETTINGS,
    widthPercent: 60
  });
});

test("accepts only markdown paths inside the vault", () => {
  assert.deepEqual(validateNotePath(" Notes\\Quick.md "), { ok: true, path: "Notes/Quick.md" });
  assert.equal(validateNotePath("../outside.md").ok, false);
  assert.equal(validateNotePath("C:/outside.md").ok, false);
  assert.equal(validateNotePath("Notes/todo.txt").ok, false);
});
