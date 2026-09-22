import type { GlobalShortcutLike } from "./types";

export class GlobalHotkeyManager {
  private registered: string | null = null;

  constructor(
    private readonly shortcuts: GlobalShortcutLike,
    private readonly callback: () => void
  ) {}

  get accelerator(): string | null {
    return this.registered;
  }

  replace(accelerator: string): boolean {
    const next = accelerator.trim();
    if (!next) return false;
    if (this.registered === next) return true;
    try {
      if (!this.shortcuts.register(next, this.callback)) return false;
    } catch {
      return false;
    }

    const previous = this.registered;
    this.registered = next;
    if (previous) {
      try { this.shortcuts.unregister(previous); } catch { /* the previous binding is already gone */ }
    }
    return true;
  }

  dispose(): void {
    if (!this.registered) return;
    try { this.shortcuts.unregister(this.registered); } catch { /* Electron is shutting down */ }
    this.registered = null;
  }
}
