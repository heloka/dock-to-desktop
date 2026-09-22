import { PluginSettingTab, Setting, type App } from "obsidian";
import type DockToDesktopPlugin from "./plugin";

export class DockSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: DockToDesktopPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Dock to Desktop" });
    containerEl.createEl("p", {
      text: "按全局快捷键呼出或收起速记窗口。原生停靠仅支持 Windows x64；不可用时会自动使用置顶窗口。"
    });

    let shortcutDraft = this.plugin.settings.accelerator;
    new Setting(containerEl)
      .setName("全局快捷键")
      .setDesc("Electron 快捷键格式，例如 Ctrl+Alt+D。新快捷键注册失败时会继续保留原快捷键。")
      .addText((text) => text
        .setPlaceholder("Ctrl+Alt+D")
        .setValue(shortcutDraft)
        .onChange((value) => { shortcutDraft = value.trim(); }))
      .addButton((button) => button
        .setButtonText("应用")
        .onClick(async () => {
          const applied = await this.plugin.updateAccelerator(shortcutDraft);
          if (!applied) this.display();
        }));

    new Setting(containerEl)
      .setName("停靠位置")
      .setDesc("每次从收起状态呼出时，以鼠标所在屏幕为准。")
      .addDropdown((dropdown) => dropdown
        .addOption("right", "右侧")
        .addOption("left", "左侧")
        .setValue(this.plugin.settings.side)
        .onChange(async (value) => {
          this.plugin.settings.side = value === "left" ? "left" : "right";
          await this.plugin.saveSettings();
          await this.plugin.refreshDock();
        }));

    new Setting(containerEl)
      .setName("停靠宽度")
      .setDesc("占目标屏幕宽度的百分比。窗口最窄为 320 像素，并至少为其他应用保留 480 像素。")
      .addSlider((slider) => slider
        .setLimits(15, 60, 1)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.widthPercent)
        .onChange(async (value) => {
          this.plugin.settings.widthPercent = value;
          await this.plugin.saveSettings();
          await this.plugin.refreshDock();
        }));

    let noteDraft = this.plugin.settings.notePath;
    new Setting(containerEl)
      .setName("速记笔记")
      .setDesc("当前仓库内的 Markdown 路径；文件和缺少的子目录会在首次呼出时创建。")
      .addText((text) => text
        .setPlaceholder("Quick Note.md")
        .setValue(noteDraft)
        .onChange((value) => { noteDraft = value; }))
      .addButton((button) => button
        .setButtonText("应用")
        .onClick(async () => {
          const applied = await this.plugin.updateNotePath(noteDraft);
          if (!applied) this.display();
        }));

    const snapshot = this.plugin.windowManager?.snapshot();
    new Setting(containerEl)
      .setName("原生停靠状态")
      .setDesc(snapshot
        ? snapshot.appbar.available
          ? `Windows AppBar 已就绪${snapshot.appbar.registered ? "，当前已注册" : "，当前未注册"}。`
          : `不可用：${snapshot.appbar.error ?? "未知原因"}`
        : "Electron 桌面桥接不可用。")
      .addButton((button) => button
        .setButtonText("生成诊断报告")
        .onClick(() => { void this.plugin.writeDiagnosticReport(); }));
  }
}
