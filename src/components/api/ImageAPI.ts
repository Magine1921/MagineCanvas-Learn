// 图像生成 API 模块：火山方舟 Seedream Image generation API；可选 GPT-image-2（OpenAPI 式 /v1/images/generations）

import { normalizeShiyunOpenAiV1Base } from '@/lib/gemini-api-url';

export type ImageApiProvider = 'seedream' | 'gpt-image-2';

export const DEFAULT_GPT_IMAGE_MODEL = 'gpt-image-2';

export type SeedreamAspectRatio =
  | '9:16'
  | '16:9'
  | '4:3'
  | '3:4'
  | '1:1'
  | '3:2'
  | '2:3'
  | '2:1'
  | '21:9';

export type SeedreamResolution = '1K' | '2K' | '3K' | '4K' | 'VR8K';

/** 下拉展示名；VR8K 在 GPT-image-2 的 2:1 下会请求 8192×4096，与火山 Seedream 4K/2:1 像素一致 */
export const SEEDREAM_RESOLUTION_LABELS: Record<SeedreamResolution, string> = {
  '1K': '1K',
  '2K': '2K',
  '3K': '3K',
  '4K': '4K',
  'VR8K': '8192×4096（VR8K）',
};

export const DEFAULT_SEEDREAM_MODEL = 'doubao-seedream-5-0-260128';

export const SEEDREAM_MODEL_OPTIONS = [
  {
    value: DEFAULT_SEEDREAM_MODEL,
    label: 'Seedream 5.0 Lite',
    desc: '文生图 / 单图 / 多图，支持 2K-4K',
  },
  {
    value: 'doubao-seedream-4-5-251128',
    label: 'Seedream 4.5',
    desc: '文生图 / 单图 / 多图，支持 2K/4K',
  },
  {
    value: 'doubao-seedream-4-0-250828',
    label: 'Seedream 4.0',
    desc: '文生图 / 单图 / 多图，支持 1K/2K/4K',
  },
  {
    value: 'doubao-seedream-3-0-t2i-250415',
    label: 'Seedream 3.0',
    desc: '文生图',
  },
] as const;

export type SeedreamModel = (typeof SEEDREAM_MODEL_OPTIONS)[number]['value'];

/** 图片节点可选模型：火山 Seedream + GPT-image-2（兼容网关） */
export const IMAGE_GEN_MODEL_OPTIONS = [
  ...SEEDREAM_MODEL_OPTIONS,
  {
    value: DEFAULT_GPT_IMAGE_MODEL,
    label: 'GPT-image-2（兼容 API）',
    desc: 'POST /v1/images/generations，OpenAI 兼容',
  },
] as const;

export type ImageGenModel = SeedreamModel | typeof DEFAULT_GPT_IMAGE_MODEL;

const MODEL_ALIASES: Record<string, SeedreamModel> = {
  'seedance-image-v2': DEFAULT_SEEDREAM_MODEL,
  'seedance-image-v1': 'doubao-seedream-3-0-t2i-250415',
  'doubao-seedream-5-0-lite-260128': DEFAULT_SEEDREAM_MODEL,
};

const SEEDREAM_1K_SIZES: Record<SeedreamAspectRatio, string> = {
  '1:1': '1024x1024',
  '3:4': '864x1152',
  '4:3': '1152x864',
  '16:9': '1312x736',
  '9:16': '736x1312',
  '3:2': '1248x832',
  '2:3': '832x1248',
  '2:1': '2048x1024',
  '21:9': '1568x672',
};

const SEEDREAM_2K_SIZES: Record<SeedreamAspectRatio, string> = {
  '1:1': '2048x2048',
  '3:4': '1728x2304',
  '4:3': '2304x1728',
  '16:9': '2848x1600',
  '9:16': '1600x2848',
  '3:2': '2496x1664',
  '2:3': '1664x2496',
  '2:1': '4096x2048',
  '21:9': '3136x1344',
};

const SEEDREAM_3K_SIZES: Record<SeedreamAspectRatio, string> = {
  '1:1': '3072x3072',
  '3:4': '2592x3456',
  '4:3': '3456x2592',
  '16:9': '4096x2304',
  '9:16': '2304x4096',
  '3:2': '3744x2496',
  '2:3': '2496x3744',
  '2:1': '6144x3072',
  '21:9': '4704x2016',
};

const SEEDREAM_4K_SIZES: Record<SeedreamAspectRatio, string> = {
  '1:1': '4096x4096',
  '3:4': '3520x4704',
  '4:3': '4704x3520',
  '16:9': '5504x3040',
  '9:16': '3040x5504',
  '3:2': '4992x3328',
  '2:3': '3328x4992',
  '2:1': '8192x4096',
  '21:9': '6240x2656',
};

const SEEDREAM_3_SIZES: Record<SeedreamAspectRatio, string> = {
  '1:1': '1024x1024',
  '3:4': '768x1024',
  '4:3': '1024x768',
  '16:9': '1280x720',
  '9:16': '720x1280',
  '3:2': '1152x768',
  '2:3': '768x1152',
  '2:1': '1280x640',
  '21:9': '1344x576',
};

/** 与 4K 像素表相同；独立档位用于兼容 GPT-image-2 下对 2:1 显式请求 8192×4096 */
const SEEDREAM_VR8K_SIZES: Record<SeedreamAspectRatio, string> = { ...SEEDREAM_4K_SIZES };

const SEEDREAM_SIZE_TABLE: Record<SeedreamResolution, Record<SeedreamAspectRatio, string>> = {
  '1K': SEEDREAM_1K_SIZES,
  '2K': SEEDREAM_2K_SIZES,
  '3K': SEEDREAM_3K_SIZES,
  '4K': SEEDREAM_4K_SIZES,
  'VR8K': SEEDREAM_VR8K_SIZES,
};

export interface ImageGenerateRequest {
  model: string;
  prompt: string;
  size: string;
  response_format: 'url' | 'b64_json';
  image?: string | string[];
  sequential_image_generation?: 'disabled' | 'auto';
  output_format?: 'png' | 'jpeg';
  watermark?: boolean;
}

export interface ImageUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ImageGenerateResponse {
  task_id?: string;
  status: string;
  result?: {
    image_url: string;
    images?: Array<{
      image_url: string;
      size?: string;
    }>;
  };
  message?: string;
  usage?: ImageUsage;
}

export interface TaskQueryResponse {
  task_id: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  result?: {
    image_url?: string;
    video_url?: string;
    cover_url?: string;
  };
  message?: string;
  usage?: ImageUsage;
  progress?: number;
}

interface ArkImageData {
  url?: string;
  b64_json?: string;
  size?: string;
}

interface ArkImagesResponse {
  data?: ArkImageData[];
  usage?: ImageUsage;
  error?: {
    code?: string;
    message?: string;
  };
  task_id?: string;
  status?: string;
  result?: {
    image_url?: string;
  };
  message?: string;
}

export function normalizeSeedreamModel(model?: string): ImageGenModel {
  if (!model) return DEFAULT_SEEDREAM_MODEL;
  if (model === DEFAULT_GPT_IMAGE_MODEL) return DEFAULT_GPT_IMAGE_MODEL;
  if (model in MODEL_ALIASES) return MODEL_ALIASES[model];
  if (SEEDREAM_MODEL_OPTIONS.some((option) => option.value === model)) {
    return model as SeedreamModel;
  }
  return DEFAULT_SEEDREAM_MODEL;
}

export function isGptImage2Model(model?: string): boolean {
  return normalizeSeedreamModel(model) === DEFAULT_GPT_IMAGE_MODEL;
}

export function isSeedreamTextOnlyModel(model?: string): boolean {
  return normalizeSeedreamModel(model) === 'doubao-seedream-3-0-t2i-250415';
}

export function getSupportedSeedreamResolutions(model?: string): SeedreamResolution[] {
  if (
    model === 'kie-gpt-image-2' ||
    model === 'gpt-image-2' ||
    model === 'gpt-image-2-text-to-image' ||
    model === 'gpt-image-2-image-to-image' ||
    model === 'nano-banana-2' ||
    model === 'nano-banana-pro'
  ) {
    return ['1K', '2K', '4K'];
  }
  if (model === 'google/nano-banana' || model === 'google/nano-banana-edit') {
    return ['1K'];
  }
  const normalized = normalizeSeedreamModel(model);
  if (normalized === DEFAULT_GPT_IMAGE_MODEL) return ['1K', '2K', '3K', '4K', 'VR8K'];
  if (normalized === 'doubao-seedream-5-0-260128') return ['2K', '3K', '4K', 'VR8K'];
  if (normalized === 'doubao-seedream-4-5-251128') return ['2K', '4K', 'VR8K'];
  if (normalized === 'doubao-seedream-4-0-250828') return ['1K', '2K', '4K', 'VR8K'];
  return ['1K'];
}

export function normalizeSeedreamResolution(
  model: string | undefined,
  resolution?: string
): SeedreamResolution {
  const supported = getSupportedSeedreamResolutions(model);
  if (supported.includes(resolution as SeedreamResolution)) {
    return resolution as SeedreamResolution;
  }
  return supported[0] || '2K';
}

export function getSeedreamImageSize(
  model: string | undefined,
  ratio: SeedreamAspectRatio,
  resolution?: string
): string {
  if (isSeedreamTextOnlyModel(model)) {
    return SEEDREAM_3_SIZES[ratio];
  }
  const normalizedResolution = normalizeSeedreamResolution(model, resolution);
  const raw = SEEDREAM_SIZE_TABLE[normalizedResolution][ratio];
  return clampImageLongestEdge(raw, 3840);
}

/** 确保图像尺寸最长边不超过 API 限制（当前火山方舟限制 3840px） */
function clampImageLongestEdge(size: string, maxEdge: number): string {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return size;
  const w = parseInt(match[1]!, 10);
  const h = parseInt(match[2]!, 10);
  const long = Math.max(w, h);
  if (long <= maxEdge) return size;
  const scale = maxEdge / long;
  return `${Math.round(w * scale)}x${Math.round(h * scale)}`;
}

export function isSeedreamImageInput(value: string): boolean {
  return /^(https?:\/\/|data:image\/[a-z0-9.+-]+;base64,)/i.test(value);
}

function getArkApiBase(apiUrl: string): string {
  const trimmed = apiUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/api/v3') ? trimmed : `${trimmed}/api/v3`;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function getImageUrl(data: ArkImageData, outputFormat: 'png' | 'jpeg' = 'png'): string | null {
  if (data.url) return data.url;
  if (data.b64_json) return `data:image/${outputFormat};base64,${data.b64_json}`;
  return null;
}

/** 将画布上的比例/分辨率映射到 GPT-image-2 文档允许的 size（其余用 auto） */
export function mapSeedreamToGptImage2Size(
  ratio: SeedreamAspectRatio,
  resolution: SeedreamResolution
): string {
  const rank: Record<SeedreamResolution, number> = { '1K': 1, '2K': 2, '3K': 3, '4K': 4, 'VR8K': 5 };
  const r = rank[resolution] ?? 2;

  /** 等距柱状 2:1 与火山 Seedream 档位对齐；勿与 21:9 或 16:9 混用 */
  if (ratio === '2:1') {
    if (resolution === 'VR8K' || resolution === '4K') return clampImageLongestEdge('8192x4096', 3840);
    if (resolution === '3K') return clampImageLongestEdge('6144x3072', 3840);
    if (resolution === '2K') return clampImageLongestEdge('4096x2048', 3840);
    return '2048x1024';
  }

  if (ratio === '1:1') {
    if (r <= 1) return '1024x1024';
    return '2048x2048';
  }
  if (ratio === '16:9') {
    if (r >= 4) return '3840x2160';
    if (r >= 2) return '2048x1152';
    return '1536x1024';
  }
  if (ratio === '9:16') {
    if (r >= 4) return '2160x3840';
    return '1024x1536';
  }
  if (ratio === '21:9') {
    if (r >= 4) return '3840x2160';
    return '2048x1152';
  }
  if (ratio === '4:3') {
    return r <= 1 ? '1024x1024' : '1536x1024';
  }
  if (ratio === '3:4') {
    return r >= 4 ? '2160x3840' : '1024x1536';
  }
  if (ratio === '3:2') {
    return '1536x1024';
  }
  if (ratio === '2:3') {
    return '1024x1536';
  }
  return 'auto';
}

/**
 * OpenAI /images/edits 的 size；2:1 须显式传 2:1 像素，否则原默认 1536x1024 为 3:2，全景会畸变。
 * 其它比例仍用文档常见档位。
 */
function mapSeedreamRatioToGptImage2EditsSize(
  ratio: SeedreamAspectRatio,
  resolution: SeedreamResolution
): string {
  if (ratio === '2:1') {
    return mapSeedreamToGptImage2Size('2:1', resolution);
  }
  if (ratio === '1:1') return '1024x1024';
  if (ratio === '9:16' || ratio === '2:3' || ratio === '3:4') return '1024x1536';
  return '1536x1024';
}

async function referenceUrlToImageBlob(url: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`无法加载参考图 (${response.status})`);
  }
  const blob = await response.blob();
  if (url.startsWith('data:')) {
    const mime = /^data:([^;,]+)/i.exec(url)?.[1] || blob.type || 'image/png';
    const ext = /jpe?g/i.test(mime) ? 'jpg' : /webp/i.test(mime) ? 'webp' : 'png';
    return { blob, filename: `reference.${ext}` };
  }
  const fromPath = url.split('?')[0].split('/').pop() || '';
  const filename = fromPath && /\./.test(fromPath) ? fromPath : `reference.${blob.type?.includes('jpeg') ? 'jpg' : 'png'}`;
  return { blob, filename };
}

async function buildGptImage2EditsFormData(
  prompt: string,
  ratio: SeedreamAspectRatio,
  referenceImages: string[],
  resolution: SeedreamResolution
): Promise<FormData> {
  const form = new FormData();
  form.append('model', DEFAULT_GPT_IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('size', mapSeedreamRatioToGptImage2EditsSize(ratio, resolution));
  form.append('quality', 'auto');
  form.append('output_format', 'png');
  for (const imageUrl of referenceImages) {
    const { blob, filename } = await referenceUrlToImageBlob(imageUrl);
    form.append('image[]', blob, filename);
  }
  return form;
}

function extractUrlsFromMarkdownContent(text: string): string[] {
  const out: string[] = [];
  const md = /!\[[^\]]*]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = md.exec(text)) !== null) {
    const u = m[1]?.trim();
    if (u) out.push(u);
  }
  const plain = /\b(https?:\/\/[^\s"'<>]+?\.(?:png|jpe?g|webp)(?:\?[^\s"'<>]*)?)/gi;
  while ((m = plain.exec(text)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function extractImageUrlsFromGptImage2Payload(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const o = raw as Record<string, unknown>;

  const data = o.data;
  if (Array.isArray(data)) {
    const urls: string[] = [];
    for (const row of data) {
      if (!row || typeof row !== 'object') continue;
      const d = row as { url?: string; b64_json?: string };
      if (d.url) urls.push(d.url);
      else if (d.b64_json) urls.push(`data:image/png;base64,${d.b64_json}`);
    }
    if (urls.length) return urls;
  }

  const choices = o.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
    const msg = (choices[0] as { message?: { content?: string } }).message;
    const content = typeof msg?.content === 'string' ? msg.content : '';
    if (content) {
      const fromMd = extractUrlsFromMarkdownContent(content);
      if (fromMd.length) return fromMd;
    }
  }

  const result = o.result as { image_url?: string } | undefined;
  if (result?.image_url) return [result.image_url];

  return [];
}

function stringifyErrorPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '未知错误';
  const record = payload as {
    error?: string | { code?: string; message?: string };
    message?: string;
    code?: string;
    target_host?: string;
    target_path?: string;
  };
  const code = typeof record.error === 'string' ? record.error : record.error?.code || record.code;
  const message = typeof record.error === 'string' ? record.message : record.error?.message || record.message;
  const target = [record.target_host, record.target_path].filter(Boolean).join('');
  return [code, message, target ? `目标接口: ${target}` : ''].filter(Boolean).join(': ') || JSON.stringify(payload);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** HTTP 429 或方舟「上游负载已饱和」等：适合退避重试 */
function isImageGenerationRateLimited(response: Response, raw: unknown): boolean {
  if (response.status === 429) return true;
  const t = stringifyErrorPayload(raw);
  return /负载已饱和|限流|Too Many Requests|rate\s*limit/i.test(t);
}

export class ImageAPI {
  private apiKey: string;
  private apiUrl: string;
  private readonly provider: ImageApiProvider;

  constructor(
    apiKey: string,
    apiUrl: string = 'https://ark.cn-beijing.volces.com',
    opts?: { provider?: ImageApiProvider }
  ) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
    this.provider = opts?.provider === 'gpt-image-2' ? 'gpt-image-2' : 'seedream';
  }

  private getProxyHeaders(targetUrl: string): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-Target-URL': targetUrl,
      'X-API-Key': this.apiKey,
    };
  }

  private getProxyUrl(): string {
    return '/api/proxy/volcengine';
  }

  /** OpenAI 兼容绘画（/v1/images/generations）：经本站 gemini 代理（同域 Bearer） */
  private getGeminiProxyHeaders(targetUrl: string, opts?: { omitContentType?: boolean }): HeadersInit {
    const headers: Record<string, string> = {
      'X-Target-URL': targetUrl,
      'X-Goog-Api-Key': this.apiKey,
    };
    if (!opts?.omitContentType) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }

  private getGeminiProxyUrl(): string {
    return '/api/proxy/gemini';
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /**
   * 生成图像
   * POST /api/v3/images/generations
   */
  async generateImage(params: {
    prompt: string;
    ratio: SeedreamAspectRatio;
    resolution?: SeedreamResolution;
    model?: string;
    referenceImage?: string;
    referenceImages?: string[];
  }): Promise<ImageGenerateResponse> {
    const modelId = normalizeSeedreamModel(params.model);
    const useGptImage2Api =
      modelId === DEFAULT_GPT_IMAGE_MODEL || this.provider === 'gpt-image-2';

    if (useGptImage2Api) {
      const resList: SeedreamResolution[] = ['1K', '2K', '3K', '4K', 'VR8K'];
      const res: SeedreamResolution = resList.includes(params.resolution as SeedreamResolution)
        ? (params.resolution as SeedreamResolution)
        : '2K';
      const size = mapSeedreamToGptImage2Size(params.ratio, res);
      const base = normalizeShiyunOpenAiV1Base(this.apiUrl);
      const referenceImages = dedupe([
        ...(params.referenceImages || []),
        ...(params.referenceImage ? [params.referenceImage] : []),
      ])
        .filter(isSeedreamImageInput)
        .slice(0, 16);
      const useEdits = referenceImages.length > 0;
      const targetUrl = `${base}/images/${useEdits ? 'edits' : 'generations'}`;

      try {
        const response = await fetch(
          this.getGeminiProxyUrl(),
          useEdits
            ? {
                method: 'POST',
                headers: this.getGeminiProxyHeaders(targetUrl, { omitContentType: true }),
                body: await buildGptImage2EditsFormData(params.prompt, params.ratio, referenceImages, res),
              }
            : {
                method: 'POST',
                headers: this.getGeminiProxyHeaders(targetUrl),
                body: JSON.stringify({
                  prompt: params.prompt,
                  n: 1,
                  size,
                  format: 'png',
                  quality: 'auto',
                  modal: DEFAULT_GPT_IMAGE_MODEL,
                  model: DEFAULT_GPT_IMAGE_MODEL,
                }),
              }
        );

        const raw = await this.parseResponse(response);
        if (!response.ok) {
          throw new Error(`图像生成失败: ${response.status} - ${stringifyErrorPayload(raw)}`);
        }

        const urls = extractImageUrlsFromGptImage2Payload(raw);
        if (!urls.length) {
          throw new Error('GPT-image-2 接口未返回可解析的图片 URL');
        }

        const payload = raw as { usage?: ImageUsage };
        return {
          status: 'success',
          result: { image_url: urls[0], images: urls.map((image_url) => ({ image_url })) },
          usage: payload.usage,
        };
      } catch (error) {
        console.error('ImageAPI.generateImage (gpt-image-2) error:', error);
        throw error;
      }
    }

    const model = modelId as SeedreamModel;
    const outputFormat: 'png' | 'jpeg' = model === DEFAULT_SEEDREAM_MODEL ? 'png' : 'jpeg';
    const referenceImages = dedupe([
      ...(params.referenceImages || []),
      ...(params.referenceImage ? [params.referenceImage] : []),
    ])
      .filter(isSeedreamImageInput)
      .slice(0, 14);

    const request: ImageGenerateRequest = {
      model,
      prompt: params.prompt,
      size: getSeedreamImageSize(model, params.ratio, params.resolution),
      response_format: 'url',
      watermark: false,
    };

    if (model === DEFAULT_SEEDREAM_MODEL) {
      request.output_format = 'png';
    }

    if (!isSeedreamTextOnlyModel(model)) {
      request.sequential_image_generation = 'disabled';
      if (referenceImages.length > 0) {
        request.image = referenceImages.length === 1 ? referenceImages[0] : referenceImages;
      }
    }

    try {
      const targetUrl = `${getArkApiBase(this.apiUrl)}/images/generations`;
      const maxAttempts = 4;
      let raw: unknown = {};
      let response!: Response;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        response = await fetch(this.getProxyUrl(), {
          method: 'POST',
          headers: this.getProxyHeaders(targetUrl),
          body: JSON.stringify(request),
        });

        raw = await this.parseResponse(response);
        if (response.ok) {
          break;
        }
        if (attempt < maxAttempts - 1 && isImageGenerationRateLimited(response, raw)) {
          const backoffMs = 2000 * 2 ** attempt;
          await sleep(backoffMs);
          continue;
        }
        throw new Error(`图像生成失败: ${response.status} - ${stringifyErrorPayload(raw)}`);
      }

      const payload = raw as ArkImagesResponse;
      if (payload.error) {
        throw new Error(`图像生成失败: ${stringifyErrorPayload(payload)}`);
      }

      if (payload.task_id) {
        return {
          task_id: payload.task_id,
          status: payload.status || 'submitted',
          message: payload.message,
          usage: payload.usage,
        };
      }

      if (payload.result?.image_url) {
        return {
          status: payload.status || 'success',
          result: { image_url: payload.result.image_url },
          message: payload.message,
          usage: payload.usage,
        };
      }

      const images: Array<{ image_url: string; size?: string }> = [];
      for (const item of payload.data || []) {
        const imageUrl = getImageUrl(item, outputFormat);
        if (imageUrl) {
          images.push(item.size ? { image_url: imageUrl, size: item.size } : { image_url: imageUrl });
        }
      }

      if (!images.length) {
        throw new Error('图像生成接口未返回图片 URL');
      }

      return {
        status: 'success',
        result: {
          image_url: images[0].image_url,
          images,
        },
        usage: payload.usage,
      };
    } catch (error) {
      console.error('ImageAPI.generateImage error:', error);
      throw error;
    }
  }

  /**
   * 兼容旧的异步任务查询接口；官方 Seedream images/generations 通常同步返回图片。
   */
  async queryTask(taskId: string): Promise<TaskQueryResponse> {
    if (this.provider === 'gpt-image-2') {
      throw new Error('GPT-image-2 为同步出图，不支持任务查询');
    }
    try {
      const targetUrl = `${getArkApiBase(this.apiUrl)}/task/query?task_id=${encodeURIComponent(taskId)}`;
      const response = await fetch(this.getProxyUrl(), {
        method: 'GET',
        headers: this.getProxyHeaders(targetUrl),
      });

      const raw = await this.parseResponse(response);
      if (!response.ok) {
        throw new Error(`查询失败: ${response.status} - ${stringifyErrorPayload(raw)}`);
      }

      const payload = raw as TaskQueryResponse;
      const rawProgress = Number((raw as { progress?: unknown }).progress);
      return {
        ...payload,
        progress: Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : undefined,
        usage: payload.usage
          ? {
              prompt_tokens: payload.usage.prompt_tokens,
              completion_tokens: payload.usage.completion_tokens,
              total_tokens: payload.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      console.error('ImageAPI.queryTask error:', error);
      throw error;
    }
  }

  /**
   * 轮询任务状态直到完成
   */
  async pollTaskUntilComplete(
    taskId: string,
    onProgress?: (status: string, progress?: number) => void,
    maxAttempts: number = 60,
    intervalMs: number = 3000
  ): Promise<TaskQueryResponse> {
    for (let i = 0; i < maxAttempts; i++) {
      const result = await this.queryTask(taskId);

      onProgress?.(result.status, result.progress);

      if (result.status === 'success' || result.status === 'failed') {
        return result;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error('任务超时');
  }
}

/**
 * 创建 ImageAPI 实例
 */
export function createImageAPI(
  apiKey: string,
  apiUrl?: string,
  opts?: { provider?: ImageApiProvider }
): ImageAPI {
  if (!apiKey) {
    throw new Error('请先配置 API Key');
  }
  return new ImageAPI(apiKey, apiUrl, opts);
}
