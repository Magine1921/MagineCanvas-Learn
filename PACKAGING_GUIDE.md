# MagineCanvas Learn 0.2.2 源码运行与打包

本文面向从源码运行、二次开发或自行打包学习版的用户。学习版源码物理移除了 3D 摄像机、3D 导演台和一键成片，不应从商业版复制相关文件回本仓库。

## 1. 环境要求

- Windows 10 / Windows 11；
- Node.js 22.12 或更高版本；
- npm。

先确认版本：

```powershell
node --version
npm --version
```

## 2. 安装依赖

在项目根目录执行：

```powershell
npm ci
```

`npm ci` 会严格按照 `package-lock.json` 安装依赖。若 PowerShell 阻止 `npm.ps1`，使用 `npm.cmd ci`。

## 3. 运行开发版

Web 开发版：

```powershell
npm run dev
```

默认地址为 <http://127.0.0.1:3100>。

Electron 开发版：

```powershell
npm run dev:desktop
```

两个命令都通过 `NEXT_PUBLIC_MAGINE_LEARNING_EDITION=1` 启用学习版边界。

## 4. 测试与构建检查

```powershell
npm run lint
npm run test:agent
npm run build
```

只有上述检查通过后再制作发布包。学习版边界测试必须验证商业节点不能被菜单、工程导入或 Agent 创建。

## 5. 打包 Windows 客户端

先生成免安装目录版进行冒烟测试：

```powershell
npm run dist:win:dir
```

再生成安装包：

```powershell
npm run dist:win
```

0.2.2 默认产物为：

```text
dist-installer-learn\MagineCanvas-Learn-Setup-0.2.2.exe
dist-installer-learn\win-unpacked\MagineCanvas-Learn.exe
```

## 6. 打包源码归档

```powershell
npm run pack:source
```

产物为：

```text
dist-source\MagineCanvas-Learn-0.2.2-source.zip
```

该脚本会排除依赖、构建结果、运行缓存和本地配置，但公开前仍应检查归档内容。

## 7. 打包后验证

1. 先运行 `dist-installer-learn\win-unpacked\MagineCanvas-Learn.exe`。
2. 新建工程，验证节点创建、保存、重启与再次打开。
3. 用用户自行配置的测试账号验证所需 API 与本地模型。
4. 检查界面、菜单、工程文件及 Agent 中不存在 3D 摄像机、3D 导演台和一键成片。
5. 再安装 `MagineCanvas-Learn-Setup-0.2.2.exe`，重复启动与保存测试。

本地模型和第三方 CLI 不随 npm 依赖自动安装；缺少它们时，对应能力会不可用，但不应导致客户端无法启动。

## 8. 目录说明

| 目录 | 说明 |
|---|---|
| `src` | 前端、节点和 API 调用逻辑 |
| `electron` | Electron 主进程和预加载脚本 |
| `public` | 静态资源 |
| `scripts` | 构建、检查和源码归档脚本 |
| `build` | 应用图标及安装器资源 |
| `tests` | 自动化测试 |

## 9. 不得公开的本机内容

不要提交或复制以下内容到公开仓库：

```text
node_modules
.next
.runtime
.magine-cache
magine-cache
MagineCanvas-UserData
dist-installer-*
dist-source
.env
.env.local
*.log
```

如需配置模板，只提交不含真实凭据的 `.env.example`。公开日志或截图前同样要删除 API Key、登录态、账号信息和本地绝对路径。

## 10. 许可证和素材

代码按 AGPL-3.0-only 发布。网络部署修改版时也须向对应用户提供完整相应源码。素材授权边界见 `ASSET_LICENSES.md` 和 `THIRD_PARTY_NOTICES.md`；未确权的非必要资源不得加入首次公开快照。

正式版网页试用版：<https://magine-trial.magine1921.workers.dev/>

