import assert from "node:assert/strict";
import test from "node:test";
import { GlobalHotkeyManager } from "../src/hotkey";
import { SerialExecutor } from "../src/serial";

test("serializes repeated toggle work", async () => {
  const serial = new SerialExecutor();
  const events: string[] = [];
  const first = serial.run(async () => {
    events.push("first-start");
    await new Promise((resolve) => setTimeout(resolve, 15));
    events.push("first-end");
  });
  const second = serial.run(async () => { events.push("second"); });
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second"]);
});

test("keeps the old global shortcut when replacement registration fails", () => {
  const registered = new Set<string>();
  const manager = new GlobalHotkeyManager({
    register(accelerator) {
      if (accelerator === "Ctrl+Alt+X") return false;
      registered.add(accelerator);
      return true;
    },
    unregister(accelerator) { registered.delete(accelerator); }
  }, () => undefined);

  assert.equal(manager.replace("Ctrl+Alt+D"), true);
  assert.equal(manager.replace("Ctrl+Alt+X"), false);
  assert.deepEqual([...registered], ["Ctrl+Alt+D"]);
  manager.dispose();
  assert.equal(registered.size, 0);
});

test("treats an invalid accelerator exception as a failed replacement", () => {
  const manager = new GlobalHotkeyManager({
    register() { throw new Error("invalid accelerator"); },
    unregister() { throw new Error("not reached"); }
  }, () => undefined);
  assert.equal(manager.replace("not a shortcut"), false);
  assert.equal(manager.accelerator, null);
});
