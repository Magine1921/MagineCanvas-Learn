# Changelog

All notable changes to MagineCanvas are documented in this file.

## [0.2.2] - 2026-08-16

### Learning edition

- 发布独立的 `MagineCanvas-Learn` 学习版源码树。
- 从源码、节点注册、菜单、工程导入和 Agent 工具链中移除 3D 摄像机、3D 导演台和一键成片。
- Web 与 Electron 开发环境默认使用 `127.0.0.1:3100`，并显式启用学习版构建标记。
- Windows 安装包改为 `dist-installer-learn\MagineCanvas-Learn-Setup-0.2.2.exe`。
- 免安装目录版入口改为 `dist-installer-learn\win-unpacked\MagineCanvas-Learn.exe`。
- 源码归档产物为 `dist-source\MagineCanvas-Learn-0.2.2-source.zip`。
- 增加学习版运行时边界测试和源码发布排除规则。

### Open-source release preparation

- 代码采用 AGPL-3.0-only。
- 更新公开仓库说明、资产授权登记和第三方依赖注意事项。
- 微信、支付宝及平台账号二维码和头像按项目所有者明确授权保留。

---

## [0.2.0] - 2026-06-14

### Highlights

- 即梦 CLI 深度集成图像/视频节点，积分与消耗预估实时同步
- 语音助手、Agent 与画布生成全面打通，支持工作风格学习与套路复现
- 桌面端 API 配置持久化，重启不再丢失
- Windows 安装包修复磨砂玻璃 UI、应用图标与启动稳定性

### Added

- **即梦 CLI**：图像/视频节点 CLI 参数 UI、积分条、预估消耗；CLI 执行层与 Dreamina API 路由统一
- **语音与音乐**：TTS 自然化表达；语音直控音乐播放；主动 ambient 播歌场景；`MusicBootstrap`
- **Agent**：`run_generation` 画布桥接、`arrange_nodes` 自动布局、选中节点上下文；工作风格观察与操作套路复现
- **自定义 Provider**：Provider API Profile 配置层、统一请求构建与代理 host 白名单、Profile 编辑 UI
- **区域节点**：拖入区域随动、拖出解除归属
- **桌面持久化**：`seedance-storage` 双写 localStorage 与 `%APPDATA%\MagineCanvas\magine-app-settings.json`
- **打包**：PostCSS `backdrop-filter` 补全插件；LOGO → 多尺寸 `icon.ico`；`afterPack` 嵌入 exe 图标

### Fixed

- 打包后节点/菜单 UI 透明（生产 CSS 缺少标准 `backdrop-filter`）
- GPU 省性能模式误关 blur 导致节点几乎全透明
- 安装版缺少 `magine-cache-root.cjs` 导致无法启动
- Electron 入场 blur 糊屏、React hydration 不匹配
- `MentionTextarea` 长文本撑开输入框；Agent 权限与 `list_projects` 存储 key

### Changed

- Electron 缓存统一写入 `userData`（`MAGINE_CACHE_ROOT`）
- 代理流式透传、LLM/Agent 与工程磁盘缓存链路优化
- `next.config` 增加 `outputFileTracingRoot` 缩小 standalone 追踪范围
- Web 与 Electron 使用统一的本地开发地址；学习版当前端口见 0.2.2 说明

### Install

- 本节保留 0.2.0 历史变更；学习版当前 Windows 产物与升级说明见 0.2.2

---

## [0.1.0] - 2026-06-13

Initial preview release of MagineCanvas desktop client.
