# Dock to Desktop 2.0.2

这是一个面向 Windows x64 的 Obsidian 桌面速记插件。Obsidian 仍在运行时，按 `Ctrl+Alt+D` 可以从其他软件中呼出独立的 Obsidian 编辑窗口；再按一次会收起窗口并释放屏幕保留区。

## 使用方式

1. 在 Obsidian 的“第三方插件”中启用 **Dock to Desktop**。
2. 在任意软件中按 `Ctrl+Alt+D`。
3. 插件在鼠标所在屏幕的右侧打开 `Quick Note.md`，并把输入焦点放进编辑器。
4. 再按 `Ctrl+Alt+D` 收起。

可以在设置中修改快捷键、左右位置、宽度百分比和速记文件路径。速记文件不存在时会创建，已有内容不会被覆盖。

## Windows 分屏原理

插件使用 Windows `SHAppBarMessage` 注册速记窗口，并按 `ABM_NEW → ABM_QUERYPOS → ABM_SETPOS` 的顺序向系统申请屏幕边缘。系统批准的位置会避开任务栏和其他 AppBar。遵循 Windows 工作区的最大化应用会使用剩余区域。

如果原生组件不能加载或 Windows 拒绝注册，插件会先回滚可能存在的注册，再使用不挤占工作区的置顶窗口，并在 Obsidian 中显示原因。插件不会强制移动普通窗口。

## 命令

- **切换停靠速记窗口**：与全局快捷键相同。
- **紧急重置：释放保留区并收起速记窗口**：只清理本插件当前持有的 AppBar 和窗口状态。
- **生成分屏诊断报告**：写入 `DockToDesktop 诊断报告.md`。诊断只读取状态，不会申请测试保留区。

## 运行边界

- 原生 AppBar 功能面向 Windows x64；其他环境只会使用回退窗口。
- 全局快捷键只在 Obsidian 进程仍运行时有效。关闭并退出 Obsidian 后，插件不会驻留后台。
- 首次呼出可能需要等待 Obsidian 创建弹出窗口；后续切换会复用并隐藏该窗口。
- Windows 全屏应用打开时，插件会按 AppBar 通知调整窗口层级。

## 开发

插件包含 TypeScript 源码和 Windows x64 的 Koffi 运行时依赖。

```powershell
npm install
npm test
npm run build
```

构建会生成 Obsidian 直接加载的 `main.js`。发布或复制安装目录时，需同时保留 `manifest.json`、`main.js` 和包含 Koffi Windows x64 二进制文件的 `node_modules`。

## 版本记录

- **2.0.2**：修复 Obsidian remote 桥接拒绝把 `BrowserWindow` 代理传给 DPI 坐标转换接口时，原生 AppBar 被错误回滚的问题。
- **2.0.1**：阻断 AppBar 工作区变化造成的窗口重排反馈循环；忽略由自身注册产生的 `workArea` 变化，合并系统位置通知，并避免重复写入相同窗口位置。
