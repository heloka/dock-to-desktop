import type { BrowserWindowLike } from "./types";

/**
 * Hide a popout as a utility window instead of leaving a minimized window in
 * the Windows taskbar or Alt+Tab list.
 */
export function hideWindowCompletely(browserWindow: BrowserWindowLike): void {
  try { browserWindow.setAlwaysOnTop(false); } catch { /* continue hiding */ }
  try { browserWindow.blur(); } catch { /* continue hiding */ }
  try { browserWindow.setFocusable(false); } catch { /* continue hiding */ }
  try { browserWindow.setSkipTaskbar(true); } catch { /* continue hiding */ }
  browserWindow.hide();
}

/** Restore all properties changed by hideWindowCompletely before showing. */
export function prepareWindowForShow(browserWindow: BrowserWindowLike): void {
  try { browserWindow.setFocusable(true); } catch { /* older Electron bridge */ }
  try { browserWindow.setSkipTaskbar(false); } catch { /* older Electron bridge */ }
  if (browserWindow.isMinimized()) browserWindow.restore();
}
