# API 配置教程

Magine Canvas 本身不附带模型额度。使用图片生成、视频生成、语音、音乐、LLM 和画质增强前，你需要配置自己的 API Key。

## 1. 打开 API 配置

1. 打开 Magine Canvas。
2. 点击首页右上角「API 配置」。
3. 选择分类：图片、画质提升、视频、LLM、语音/音乐。
4. 展开你要使用的服务商。
5. 填写 API Key。
6. 点击保存。

## 2. Kie API

Kie 是当前推荐的统一 API 平台，画布中的多个模型都可以通过 Kie 使用。

购买/充值链接：

```text
https://kie.ai?ref=296742715562ed5361182aa543ee85a5
```

配置：

```text
API 地址: https://api.kie.ai
API Key: 填写你在 Kie 后台创建的密钥
```

Kie 支持的常见能力：

- 图片生成：GPT Image-2、Nano Banana
- 视频生成：Hailuo、Veo、Gemini Omni
- LLM：Gemini、Claude、OpenAI
- 音乐：Suno
- 画质增强：Topaz

注意：Kie 是统一 credits 余额。同一个 Kie API Key 下，所有 Kie 模型都会消耗同一个余额。

## 3. 图片模型配置

### Kie GPT Image-2

适合文字生图和参考图生图。

```text
API 地址: https://api.kie.ai
模型:
gpt-image-2-text-to-image
gpt-image-2-image-to-image
```

### Kie Nano Banana

适合图片生成和图片编辑。

```text
API 地址: https://api.kie.ai
模型:
nano-banana-2
nano-banana-pro
google/nano-banana
google/nano-banana-edit
```

### Seedream

火山方舟/豆包图片生成模型。

```text
API 地址: https://ark.cn-beijing.volces.com
```

需要在火山方舟控制台获取 API Key。

## 4. 视频模型配置

### Kie Hailuo

适合文字生视频和图片生视频。

```text
API 地址: https://api.kie.ai
模型:
hailuo/2-3-image-to-video-standard
hailuo/2-3-image-to-video-pro
hailuo/02-text-to-video-standard
hailuo/02-image-to-video-standard
hailuo/02-text-to-video-pro
hailuo/02-image-to-video-pro
```

### Kie Veo / Gemini Omni

```text
API 地址: https://api.kie.ai
模型:
veo3_fast
veo3_lite
veo3
gemini-omni-video
```

注意：`gemini-omni-video` 通常只支持 `16:9` 和 `9:16`。

### Seedance 2.0

火山方舟/豆包视频生成模型。

```text
API 地址: https://ark.cn-beijing.volces.com
```

## 5. 即梦 CLI 配置

即梦 CLI 不使用云端 API Key，而是调用你电脑本机的即梦 CLI。

使用前需要：

1. 安装即梦 CLI。
2. 在本机登录即梦账号。
3. 在 Magine Canvas 中填写 CLI 路径。

常见路径：

```text
dreamina
C:\Users\<你的用户名>\bin\dreamina.exe
```

即梦 CLI 消耗的是你的即梦账号积分。

## 6. LLM 配置

LLM 用于 AI 助手、Agent 节点、联网搜索整理和文本推理。

### Kie Gemini

```text
API 地址: https://api.kie.ai
模型:
gemini-2.5-pro
gemini-3-pro
gemini-3.1-pro
gemini-2.5-flash
gemini-3-flash
gemini-3.5-flash-openai
```

### Kie Claude

```text
API 地址: https://api.kie.ai/claude
```

### Kie OpenAI

```text
API 地址: https://api.kie.ai
```

## 7. 语音和音乐配置

### 本地 STT

语音识别默认使用本地模型，不需要云端 STT API Key。

### ElevenLabs

用于 TTS 语音播报和部分音乐能力。

```text
API 地址: https://api.elevenlabs.io
```

### MiniMax 音频

用于 TTS 和音乐生成。

```text
API 地址: https://api.minimaxi.com
```

### Kie Suno

用于音乐生成。

```text
API 地址: https://api.kie.ai
模型:
V5_5
V5
V4_5PLUS
V4_5
V4_5ALL
V4
V3_5
```

## 8. 画质增强配置

画质增强使用 Topaz / Kie 云端服务。

```text
API 地址: https://api.kie.ai
模型:
topaz/image-upscale
topaz/video-upscale
```

## 9. 配置后如何测试

建议按这个顺序测试：

1. 先测试图片生成。
2. 再测试视频生成。
3. 再测试 LLM / AI 助手。
4. 最后测试语音、音乐和画质增强。

如果某个模型失败，先换一个同类模型，不要立刻判断软件整体不可用。

