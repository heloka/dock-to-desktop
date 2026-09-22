import type { BrowserWindowLike, ElectronRemoteLike } from "./types";

type WindowWithRequire = Window & { require?: (id: string) => unknown };

export function getElectronRemote(targetWindow: Window = window): ElectronRemoteLike | null {
  const req = (targetWindow as WindowWithRequire).require ?? (typeof require === "function" ? require : undefined);
  if (!req) return null;

  const candidates: unknown[] = [];
  try { candidates.push(req("@electron/remote")); } catch { /* optional bridge */ }
  try {
    const electron = req("electron") as { remote?: unknown } | undefined;
    if (electron?.remote) candidates.push(electron.remote);
  } catch { /* optional bridge */ }

  for (const value of candidates) {
    const remote = value as (Partial<ElectronRemoteLike> & { require?: (id: string) => Partial<ElectronRemoteLike> }) | undefined;
    if (!remote?.getCurrentWindow) continue;
    let electronMain: Partial<ElectronRemoteLike> = {};
    if ((!remote.globalShortcut || !remote.screen) && remote.require) {
      try { electronMain = remote.require("electron"); } catch { /* use direct remote properties */ }
    }
    const globalShortcut = remote.globalShortcut ?? electronMain.globalShortcut;
    const screen = remote.screen ?? electronMain.screen;
    if (globalShortcut && screen) {
      return {
        BrowserWindow: remote.BrowserWindow ?? electronMain.BrowserWindow,
        getCurrentWindow: remote.getCurrentWindow.bind(remote),
        globalShortcut,
        screen
      } as ElectronRemoteLike;
    }
  }
  return null;
}

export async function getBrowserWindowForDom(targetWindow: Window): Promise<BrowserWindowLike | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const remote = getElectronRemote(targetWindow);
    if (remote) {
      try {
        const browserWindow = remote.getCurrentWindow();
        if (browserWindow && !browserWindow.isDestroyed()) return browserWindow;
      } catch { /* window is still being attached */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

export function nativeInteger(value: Buffer): number {
  if (!value || value.length === 0) return 0;
  if (value.length >= 8) return Number(value.readBigUInt64LE(0));
  if (value.length >= 4) return value.readUInt32LE(0);
  return value.readUInt8(0);
}
