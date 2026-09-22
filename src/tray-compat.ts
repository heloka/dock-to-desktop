import type { App } from "obsidian";
import type { BrowserWindowLike, WindowCloseEventLike } from "./types";

export type TrayCompatibilityStatus = "not-detected" | "detached" | "failed";

interface TrayPluginLike {
  getWindows?: () => Array<{ id?: number }>;
}

interface PluginRegistryLike {
  getPlugin?: (id: string) => unknown;
  plugins?: Record<string, unknown>;
}

function getTrayPlugin(app: App): TrayPluginLike | null {
  const registry = (app as App & { plugins?: PluginRegistryLike }).plugins;
  if (!registry) return null;
  const candidate = registry.getPlugin?.("obsidian-tray") ?? registry.plugins?.["obsidian-tray"];
  if (!candidate || typeof candidate !== "object") return null;
  const tray = candidate as TrayPluginLike;
  return typeof tray.getWindows === "function" ? tray : null;
}

function isTracked(tray: TrayPluginLike, browserWindow: BrowserWindowLike): boolean {
  try {
    return tray.getWindows?.().some((window) => window?.id === browserWindow.id) ?? false;
  } catch {
    return false;
  }
}

/**
 * Obsidian Tray 0.3.x tracks every popout and later hides/minimizes all of
 * them. Its own close listener removes a popout from that private set. Emit a
 * prevented close once so that listener performs its cleanup without closing
 * the Dock to Desktop editor window.
 */
export async function detachWindowFromObsidianTray(
  app: App,
  browserWindow: BrowserWindowLike
): Promise<TrayCompatibilityStatus> {
  const tray = getTrayPlugin(app);
  if (!tray) return "not-detected";
  if (!isTracked(tray, browserWindow)) return "detached";

  let intercepted = false;
  const preventClose = (event: WindowCloseEventLike): void => {
    intercepted = true;
    event.preventDefault();
  };

  try {
    browserWindow.prependOnceListener("close", preventClose);
    browserWindow.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  } catch (error) {
    console.error("[DockToDesktop] Could not detach quick note window from Obsidian Tray", error);
  } finally {
    if (!intercepted) {
      try { browserWindow.removeListener("close", preventClose); } catch { /* window bridge may already be gone */ }
    }
  }

  return !browserWindow.isDestroyed() && !isTracked(tray, browserWindow) ? "detached" : "failed";
}
