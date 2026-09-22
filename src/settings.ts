import type { DockSettings } from "./types";

export const DEFAULT_SETTINGS: DockSettings = {
  accelerator: "Ctrl+Alt+D",
  notePath: "Quick Note.md",
  side: "right",
  widthPercent: 25
};

type UnknownRecord = Record<string, unknown>;

export function migrateSettings(raw: unknown): DockSettings {
  const source: UnknownRecord = raw && typeof raw === "object" ? raw as UnknownRecord : {};
  const accelerator = typeof source.accelerator === "string" && source.accelerator.trim()
    ? source.accelerator.trim()
    : DEFAULT_SETTINGS.accelerator;
  const notePath = typeof source.notePath === "string" && source.notePath.trim()
    ? source.notePath.trim()
    : DEFAULT_SETTINGS.notePath;
  const side = source.side === "left" ? "left" : "right";
  const requestedWidth = typeof source.widthPercent === "number" ? source.widthPercent : DEFAULT_SETTINGS.widthPercent;

  return {
    accelerator,
    notePath,
    side,
    widthPercent: Math.round(Math.min(60, Math.max(15, requestedWidth)))
  };
}

export function validateNotePath(input: string): { ok: true; path: string } | { ok: false; reason: string } {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (!trimmed) return { ok: false, reason: "笔记路径不能为空。" };
  if (trimmed.startsWith("/") || /^[A-Za-z]:\//.test(trimmed)) {
    return { ok: false, reason: "笔记必须位于当前仓库内，不能使用绝对路径。" };
  }
  if (trimmed.split("/").some((part) => part === "..")) {
    return { ok: false, reason: "笔记路径不能包含 ..。" };
  }
  if (!trimmed.toLowerCase().endsWith(".md")) {
    return { ok: false, reason: "速记文件必须使用 .md 扩展名。" };
  }
  const path = trimmed.split("/").filter((part) => part && part !== ".").join("/");
  if (!path || path === ".md") return { ok: false, reason: "请输入有效的 Markdown 文件路径。" };
  return { ok: true, path };
}
