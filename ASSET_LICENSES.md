# 素材授权登记

代码许可证不会自动覆盖图片、音频、字体、二维码、头像或平台标识。本文件记录 MagineCanvas Learn 0.2.2 首次公开快照的素材边界。

## 项目所有者明确授权保留

项目所有者 Magine1921 已明确授权在本开源仓库中保留以下微信、支付宝及平台账号二维码和头像：

- `public/streaming/alipay.jpg`
- `public/streaming/kuaishou.jpg`
- `public/streaming/wechat-channel.jpg`
- `public/streaming/wechat-pay.jpg`
- `public/streaming/wechat.bmp`
- `public/streaming/xiaohongshu.jpg`
- `public/streaming/youtube.png`

该授权仅表示项目所有者允许这些文件随仓库公开和保留。微信、支付宝、快手、小红书、YouTube 等名称、商标和平台标识仍归各自权利人所有；仓库使用者必须遵守对应平台规则，不得据此主张平台授权、背书或商标权。

## 随 0.2.2 公开的项目原创资源

以下资源为本项目为首次公开快照重新制作的源码或由该源码机械生成，随项目按 `AGPL-3.0-only` 发布：

- `public/backgrounds/bg.svg`
- `public/logo-symbol-relief.svg`
- `public/panorama-equirectangular-guide.svg`
- `src/lib/canvasEntranceSound.ts`、`src/lib/welcomeEntranceSound.ts`、`src/lib/voiceAssistantClickSound.ts` 中的程序化 Web Audio 音效
- 由 `public/logo-symbol-relief.svg` 和 `scripts/generate-win-icon-ico.cjs` 生成的 `public/icon.png`、`build/icon.png`、`build/icon.ico`、`src/app/favicon.ico`

## 已确认来源的第三方运行时

- `public/ort/ort-wasm-simd-threaded.mjs`
- `public/ort/ort-wasm-simd-threaded.wasm`

上述两个文件由 `scripts/sync-onnx-runtime-assets.cjs` 从锁定依赖 `onnxruntime-web@1.30.0` 原样同步。该依赖由 Microsoft 以 MIT 许可证发布，准确版本以 `package-lock.json` 为准。

## 尚未完成来源或授权核验

下列资源目前没有随仓库提供足够的来源、作者或授权凭据：

- `public/backgrounds/bg.jpeg`
- `public/sounds/*.mp3`
- `public/logo-symbol-relief.png`
- `LOGO.png`
- `public/panorama-equirectangular-guide.png`
- `public/models/face/scrfd_2.5g_bnkps.onnx`
- `public/ffmpeg/*`
- `public/mp4-wasm.wasm`
- `public/tutorial-audio/**/*.mp3`
- 其他未在本登记表中明确列出的图片、音频、字体、模型和二进制资源

这些文件从首次公开快照中排除。人脸合规模型改为由用户自行从具有合法授权的来源下载到程序提示的目录；教程音频保留生成脚本和文本清单，未分发旧的预生成音频。

## 新增素材登记要求

每项随仓库或安装包发布的素材至少记录以下信息：

- 文件路径与用途；
- 作者或来源链接；
- 许可证或书面授权；
- 是否允许修改、公开再分发和商业使用；
- 所需署名及其他限制。

无法确认来源或授权时，不得默认其可再分发。
