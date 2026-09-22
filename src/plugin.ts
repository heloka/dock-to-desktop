import path from "node:path";
import { apiVersion, FileSystemAdapter, Notice, Platform, Plugin, TFile } from "obsidian";
import { WindowsAppBar } from "./appbar";
import { getElectronRemote } from "./electron";
import { GlobalHotkeyManager } from "./hotkey";
import { ensureQuickNote } from "./note";
import { DEFAULT_SETTINGS, migrateSettings, validateNotePath } from "./settings";
import { DockSettingTab } from "./settings-tab";
import type { DockSettings } from "./types";
import { DockWindowManager } from "./window-manager";

export default class DockToDesktopPlugin extends Plugin {
  settings: DockSettings = { ...DEFAULT_SETTINGS };
  windowManager: DockWindowManager | null = null;
  private hotkeys: GlobalHotkeyManager | null = null;
  private appbar: WindowsAppBar | null = null;
  private electronAvailable = false;

  async onload(): Promise<void> {
    this.settings = migrateSettings(await this.loadData());
    await this.saveSettings();

    this.addRibbonIcon("panel-right", "停靠速记", () => { void this.toggleDock(); });
    this.addCommand({ id: "toggle-dock", name: "切换停靠速记窗口", callback: () => { void this.toggleDock(); } });
    this.addCommand({ id: "reset", name: "紧急重置：释放保留区并收起速记窗口", callback: () => { void this.emergencyReset(); } });
    this.addCommand({ id: "diagnose", name: "生成分屏诊断报告", callback: () => { void this.writeDiagnosticReport(); } });
    this.addSettingTab(new DockSettingTab(this.app, this));

    const remote = getElectronRemote(window);
    if (!remote) {
      new Notice("Dock to Desktop：无法访问 Obsidian 的 Electron 桌面桥接，全局快捷键和停靠窗口不可用。", 9000);
      return;
    }
    this.electronAvailable = true;

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("Dock to Desktop：当前仓库不是本地文件系统仓库。", 8000);
      return;
    }
    const pluginDir = path.join(adapter.getBasePath(), this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`);
    this.appbar = new WindowsAppBar(pluginDir);
    this.windowManager = new DockWindowManager(
      this.app,
      remote,
      this.appbar,
      () => this.settings,
      () => ensureQuickNote(this.app.vault, this.settings.notePath)
    );
    this.windowManager.start();

    this.hotkeys = new GlobalHotkeyManager(remote.globalShortcut, () => { void this.toggleDock(); });
    if (!this.hotkeys.replace(this.settings.accelerator)) {
      new Notice(`Dock to Desktop：全局快捷键“${this.settings.accelerator}”注册失败，可能已被其他程序占用。`, 9000);
    }
  }

  onunload(): void {
    this.hotkeys?.dispose();
    this.hotkeys = null;
    this.windowManager?.dispose();
    this.windowManager = null;
    this.appbar = null;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async toggleDock(): Promise<void> {
    if (!this.app.workspace.layoutReady) {
      new Notice("Dock to Desktop：请等待 Obsidian 完成启动后再试。");
      return;
    }
    if (!this.windowManager) {
      new Notice("Dock to Desktop：Electron 桌面桥接不可用，无法创建速记窗口。", 7000);
      return;
    }
    await this.windowManager.toggle();
  }

  async emergencyReset(): Promise<void> {
    if (!this.windowManager) {
      new Notice("Dock to Desktop：当前没有本插件持有的窗口或保留区。");
      return;
    }
    await this.windowManager.emergencyReset();
    new Notice("Dock to Desktop：已释放本插件的保留区并收起速记窗口。", 4000);
  }

  async refreshDock(): Promise<void> {
    await this.windowManager?.settingsChanged();
  }

  async updateAccelerator(candidate: string): Promise<boolean> {
    const value = candidate.trim();
    if (!value || !this.hotkeys) {
      new Notice("Dock to Desktop：快捷键为空，或 Electron 全局快捷键接口不可用。", 6000);
      return false;
    }
    if (!this.hotkeys.replace(value)) {
      new Notice(`Dock to Desktop：无法注册“${value}”，原快捷键“${this.settings.accelerator}”仍然有效。`, 8000);
      return false;
    }
    this.settings.accelerator = value;
    await this.saveSettings();
    new Notice(`Dock to Desktop：全局快捷键已改为 ${value}。`, 3500);
    return true;
  }

  async updateNotePath(candidate: string): Promise<boolean> {
    const validation = validateNotePath(candidate);
    if (!validation.ok) {
      new Notice(`Dock to Desktop：${validation.reason}`, 6000);
      return false;
    }
    this.settings.notePath = validation.path;
    await this.saveSettings();
    new Notice(`Dock to Desktop：速记笔记已改为 ${validation.path}。`, 3500);
    return true;
  }

  async writeDiagnosticReport(): Promise<void> {
    const snapshot = this.windowManager?.snapshot();
    const pathValidation = validateNotePath(this.settings.notePath);
    const lines = [
      "# Dock to Desktop 诊断报告",
      "",
      `- 生成时间：${new Date().toLocaleString()}`,
      `- 插件版本：${this.manifest.version}`,
      `- Obsidian API 版本：${apiVersion}`,
      `- 平台：${process.platform} ${process.arch}`,
      `- Windows：${Platform.isWin ? "是" : "否"}`,
      `- Electron 桌面桥接：${this.electronAvailable ? "可用" : "不可用"}`,
      `- 全局快捷键：${this.hotkeys?.accelerator ?? "未注册"}`,
      `- 窗口状态：${snapshot?.state ?? "未初始化"}`,
      `- 窗口 ID：${snapshot?.browserWindowId ?? "无"}`,
      `- 目标显示器 ID：${snapshot?.displayId ?? "无"}`,
      `- AppBar 接口：${snapshot?.appbar.available ? "可用" : "不可用"}`,
      `- AppBar 已注册：${snapshot?.appbar.registered ? "是" : "否"}`,
      `- 原生模式已被熔断：${snapshot?.nativeModeDisabledForSession ? "是" : "否"}`,
      `- AppBar 错误：${snapshot?.appbar.error ?? "无"}`,
      `- 速记路径：${pathValidation.ok ? pathValidation.path : `无效（${pathValidation.reason}）`}`,
      "",
      "> 此诊断只读取插件状态，不会申请或修改 Windows 屏幕保留区。",
      ""
    ];
    const reportPath = "DockToDesktop 诊断报告.md";
    const content = lines.join("\n");
    const existing = this.app.vault.getAbstractFileByPath(reportPath);
    let report: TFile;
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
      report = existing;
    } else if (existing) {
      new Notice(`Dock to Desktop：无法写入诊断报告，“${reportPath}”不是文件。`, 7000);
      return;
    } else {
      report = await this.app.vault.create(reportPath, content);
    }
    await this.app.workspace.getLeaf("tab").openFile(report);
    new Notice("Dock to Desktop：诊断报告已生成，未执行 AppBar 测试。", 4500);
  }
}
