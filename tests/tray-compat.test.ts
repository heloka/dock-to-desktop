import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { App } from "obsidian";
import { detachWindowFromObsidianTray } from "../src/tray-compat";
import type { BrowserWindowLike, WindowCloseEventLike } from "../src/types";

class FakeWindow extends EventEmitter {
  id = 42;
  destroyed = false;

  close(): void {
    let prevented = false;
    const event: WindowCloseEventLike = { preventDefault: () => { prevented = true; } };
    this.emit("close", event);
    if (!prevented) this.destroyed = true;
  }

  isDestroyed(): boolean { return this.destroyed; }
}

test("detaches the quick-note popout through Tray's own close cleanup", async () => {
  const browserWindow = new FakeWindow();
  const tracked = new Set([browserWindow]);
  browserWindow.on("close", () => tracked.delete(browserWindow));
  const app = {
    plugins: {
      getPlugin: (id: string) => id === "obsidian-tray"
        ? { getWindows: () => [...tracked] }
        : null
    }
  } as unknown as App;

  const status = await detachWindowFromObsidianTray(app, browserWindow as unknown as BrowserWindowLike);
  assert.equal(status, "detached");
  assert.equal(browserWindow.isDestroyed(), false);
  assert.equal(tracked.size, 0);
});

test("does not synthesize a close when Tray is absent", async () => {
  const browserWindow = new FakeWindow();
  const app = { plugins: { getPlugin: () => null } } as unknown as App;
  const status = await detachWindowFromObsidianTray(app, browserWindow as unknown as BrowserWindowLike);
  assert.equal(status, "not-detected");
  assert.equal(browserWindow.isDestroyed(), false);
});
