import { TFile, TFolder, type Vault } from "obsidian";
import { validateNotePath } from "./settings";

export async function ensureQuickNote(vault: Vault, configuredPath: string): Promise<TFile> {
  const validation = validateNotePath(configuredPath);
  if (!validation.ok) throw new Error(validation.reason);
  const notePath = validation.path;
  const existing = vault.getAbstractFileByPath(notePath);
  if (existing instanceof TFile) return existing;
  if (existing) throw new Error(`“${notePath}”已经存在，但它不是文件。`);

  const parts = notePath.split("/");
  parts.pop();
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const node = vault.getAbstractFileByPath(current);
    if (node instanceof TFolder) continue;
    if (node) throw new Error(`无法创建目录“${current}”：同名文件已经存在。`);
    try {
      await vault.createFolder(current);
    } catch (error) {
      if (!(vault.getAbstractFileByPath(current) instanceof TFolder)) throw error;
    }
  }

  try {
    return await vault.create(notePath, "");
  } catch (error) {
    const createdByAnotherCall = vault.getAbstractFileByPath(notePath);
    if (createdByAnotherCall instanceof TFile) return createdByAnotherCall;
    throw new Error(`无法创建速记文件“${notePath}”：${error instanceof Error ? error.message : String(error)}`);
  }
}
