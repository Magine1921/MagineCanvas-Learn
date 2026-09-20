# MagineCanvas Learn 0.2.2

MagineCanvas Learn 是 Magine Canvas 的学习开源版：一个基于 Next.js、React Flow 与 Electron 的无限画布 AI 工作流编辑器。用户可以在画布上编排提示词、素材、大模型、图像生成、视频生成和 Agent 节点，并通过连线传递上下文与生成结果。

## 学习版边界

本仓库从源码层面移除了以下商业版功能，而不是通过 CSS、权限开关或菜单隐藏：

- 3D 摄像机；
- 3D 导演台；
- 一键成片。

相关节点组件、API 路由、模板与专用资源均不包含在学习版源码中。导入旧工程或通过 Agent 请求创建节点时，学习版也会过滤这些商业版节点。

需要完整功能可访问[正式版网页试用版](https://magine-trial.magine1921.workers.dev/)。

## 主要能力

- 无限画布节点编排、拖拽、连线与工程导入导出；
- 图片、视频等素材节点和 `@` 素材引用；
- 图像、视频、全景、画质增强等生成工作流；
- 可配置的大模型与 AI 助手；
- Electron Windows 桌面端；
- 即梦 CLI、本地语音与第三方 API 接入。

模型服务、第三方 API 和部分本地模型需要用户自行配置，可能产生第三方费用，并受相应服务条款约束。不要提交 API Key、登录态、工程缓存或个人数据。

## 环境要求

- Windows 10/11（Electron Windows 打包）；
- Node.js 22.12 或更高版本；
- npm（随 Node.js 安装）。

## 安装依赖

```powershell
npm ci
```

若 PowerShell 阻止 `npm.ps1`，可以使用 `npm.cmd ci`。

## 开发运行

Web 开发版：

```powershell
npm run dev
```

浏览器打开 <http://127.0.0.1:3100>。

Electron 开发版：

```powershell
npm run dev:desktop
```

以上命令都会显式启用学习版构建标记。

## 检查、构建与打包

```powershell
npm run lint
npm run test:agent
npm run build
npm run dist:win:dir
npm run dist:win
```

Windows 产物默认写入 `dist-installer-learn`：

- `MagineCanvas-Learn-Setup-0.2.2.exe`：安装包；
- `win-unpacked/MagineCanvas-Learn.exe`：免安装目录版。

打包源码归档：

```powershell
npm run pack:source
```

产物为 `dist-source/MagineCanvas-Learn-0.2.2-source.zip`。

更完整的说明见 [PACKAGING_GUIDE.md](PACKAGING_GUIDE.md) 和 [docs/user/06-源码运行与打包.md](docs/user/06-源码运行与打包.md)。

## 配置与数据安全

API Key、Provider 地址和本地模型配置会保存在用户本机。公开问题、日志或截图前，请先移除密钥、令牌、账号标识和本地绝对路径。`.env*` 默认被 Git 忽略；如需提供公共配置示例，请使用 `.env.example`。

## 开源许可证

本项目代码以 [GNU Affero General Public License v3.0 only](LICENSE) 发布。修改、分发本项目，或通过网络向用户提供修改后的版本时，需要依照 AGPL-3.0 向对应用户提供完整的相应源代码和许可证声明。

图片、音频、字体、二维码、平台标识和其他素材可能适用不同授权，详见 [ASSET_LICENSES.md](ASSET_LICENSES.md) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。仓库中保留的微信、支付宝及平台账号二维码和头像已由项目所有者明确授权保留；该授权不自动授予第三方对相关平台标识的任何权利。

Copyright (C) 2026 Magine1921
