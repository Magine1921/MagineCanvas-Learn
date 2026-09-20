# 第三方声明

MagineCanvas Learn 自有代码以 AGPL-3.0-only 发布，但依赖、平台标识、模型、媒体和二进制文件仍适用各自的许可证或服务条款。`package-lock.json` 是 JavaScript 依赖及实际锁定版本的准确信息来源。

## 已从公开发行范围排除的编辑器

此前嵌入的 `JianshenVideoEditorWeb` 编辑器已从以下位置移除：

- `vendor/JianshenVideoEditorWeb`
- `public/jianshen`
- `public/maginecanvas`
- `scripts/copy-jianshen-editor.cjs`
- `scripts/patch-jianshen-index-bundle.cjs`
- `scripts/jianshen`

原因：上游包同时出现 MIT 文本和非商业使用说明，在获得上游作者明确的书面再分发许可前，不应重新加入公开源码、安装包或付费发行物。

## 需要特别核验的运行时依赖

- `sharp` 与 `@img/sharp-*`：Electron 打包时可能包含 libvips 相关组件，需要保留相应许可证、版权声明，并核对 LGPL 等义务。
- `ffmpeg-static` 及任何 `ffmpeg-core.js` / `ffmpeg-core.wasm`：发布前必须记录具体构建版本、许可证、编译参数以及适用的源码提供义务。
- `onnxruntime-web@1.30.0`：`public/ort` 下两个运行时文件由同步脚本从该 MIT 许可依赖原样复制；版本与完整依赖关系见 `package-lock.json`。
- `NeteaseCloudMusicApi`：软件包本身的许可证不代表获得音乐内容或平台接口的使用权，用户仍须遵守平台条款与音乐版权规则。
- 本地语音、视觉或视频模型：权重、推理代码和训练数据可能采用不同许可证，不得仅因接口代码开源就随仓库再分发模型文件。
- 即梦 CLI 及其他平台 CLI：由用户按平台官方流程安装、登录和使用，仍受相应平台服务条款约束。

## 二维码、头像与平台标识

`public/streaming/*` 中现有的微信、支付宝及平台账号二维码和头像，经项目所有者明确授权可在本仓库中保留。该许可不改变其中第三方平台名称、商标或标识的权属，也不表示相关平台认可或赞助本项目。详细文件清单见 `ASSET_LICENSES.md`。

## 首次公开快照规则

除上述已获项目所有者明确授权保留的二维码和头像外，任何未能确认来源及再分发权的图片、音频、字体、模型或二进制资源都应：

1. 从首次公开快照和源码压缩包中排除；或
2. 改为由用户按照文档从合法来源另行下载。

不得用占位的“合理使用”声明代替真实授权。

本次 0.2.2 首发已经用原创 SVG 与程序化音效替换旧背景、标志、全景引导图和界面音效，并排除未确权的模型权重、旧媒体、旧 FFmpeg WASM、MP4 WASM 与预生成教程音频。保留的二维码和头像以项目所有者的明确授权为依据。

## 发布检查清单

1. 根据锁定依赖生成完整的第三方许可证报告。
2. 随发行物保留 MIT、ISC、Apache-2.0、BSD、MPL、LGPL 等适用许可证与版权声明。
3. 核对原生模块、WASM、FFmpeg 与模型文件是否需要源码提供、动态链接或署名。
4. 按 `ASSET_LICENSES.md` 逐项核验媒体素材，排除未确权资源。
5. 不得在没有书面许可的情况下重新引入已移除的第三方编辑器。
