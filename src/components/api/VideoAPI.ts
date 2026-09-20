export type VideoRatio = '9:16' | '16:9' | '4:3' | '3:4' | '1:1' | '4:5' | '5:4' | '9:21' | '21:9';
export type VideoResolution = '480P' | '720P' | '1080P' | '4K';
export type VideoDuration = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export interface VideoGenerateRequest {
  api_key: string;
  model?: string;
  prompt: string;
  ratio: VideoRatio;
  resolution: VideoResolution;
  duration: VideoDuration;
  reference_image?: string;
  reference_images?: string[];
  reference_videos?: string[];
  reference_audios?: string[];
  callback_url?: string;
}

export interface VideoGenerateResponse {
  task_id: string;
  status: string;
  message?: string;
}

export type ArkVideoTaskStatus =
  | 'queued'
  | 'running'
  | 'cancelled'
  | 'succeeded'
  | 'failed'
  | 'expired';

export interface TaskQueryResponse {
  task_id: string;
  status: ArkVideoTaskStatus;
  result?: {
    video_url?: string;
    cover_url?: string;
  };
  message?: string;
  usage?: {
    completion_tokens?: number;
    total_tokens?: number;
  };
  progress?: number;
}

type ArkVideoContentItem = {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url';
  text?: string;
  image_url?: { url: string };
  video_url?: { url: string };
  audio_url?: { url: string };
  role?: 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio';
};

type ArkErrorPayload = {
  error?: string | { code?: string; message?: string };
  message?: string;
  code?: string;
  target_host?: string;
  target_path?: string;
};

const DEFAULT_API_URL = 'https://ark.cn-beijing.volces.com';
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const MAX_TRANSIENT_TASK_QUERY_FAILURES = 5;
export const SEEDANCE_20_REFERENCE_LIMITS = {
  images: 9,
  videos: 3,
  audios: 3,
} as const;
const VIDEO_STATUSES: ArkVideoTaskStatus[] = [
  'queued',
  'running',
  'cancelled',
  'succeeded',
  'failed',
  'expired',
];

const MODEL_MAPPING: Record<string, string> = {
  // canonical model IDs for Volcengine ARK API
  'seedance-2.0': 'doubao-seedance-2-0-260128',
  'seedance-2.0-fast': 'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-2.0': 'doubao-seedance-2-0-260128',
  'doubao-seedance-2.0-fast': 'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-2-0-260128': 'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128': 'doubao-seedance-2-0-fast-260128',
};

// ── HappyHorse (DashScope) 模型规格 ──

export interface HappyHorseModelSpec {
  /** 生成类型 */
  generationType: 't2v' | 'i2v' | 'r2v' | 'video-edit';
  /** 是否需要参考图（首帧） */
  requiresFirstFrame: boolean;
  /** 是否支持多图参考 */
  supportsMultiImage: boolean;
  /** 是否支持视频参考 */
  supportsVideoRef: boolean;
  /** 是否支持手动设置比例（I2V 自动匹配输入图） */
  supportsRatio: boolean;
  supportsDuration: boolean;
  requiresPrompt: boolean;
  aspectRatios: VideoRatio[];
  /** 支持的分辨率 */
  resolutions: VideoResolution[];
  /** 支持的时长范围（秒） */
  durationMin: number;
  durationMax: number;
  minReferenceImages: number;
  minReferenceVideos: number;
  maxReferenceImages: number;
}

const HAPPYHORSE_GENERATION_RATIOS: VideoRatio[] = [
  '16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9',
];

const HAPPYHORSE_MODEL_SPECS: Record<string, HappyHorseModelSpec> = {
  'happyhorse-1.0-t2v': {
    generationType: 't2v',
    requiresFirstFrame: false,
    supportsMultiImage: false,
    supportsVideoRef: false,
    supportsRatio: true,
    supportsDuration: true,
    requiresPrompt: true,
    aspectRatios: HAPPYHORSE_GENERATION_RATIOS,
    resolutions: ['720P', '1080P'],
    durationMin: 3,
    durationMax: 15,
    minReferenceImages: 0,
    minReferenceVideos: 0,
    maxReferenceImages: 0,
  },
  'happyhorse-1.0-i2v': {
    generationType: 'i2v',
    requiresFirstFrame: true,
    supportsMultiImage: false,
    supportsVideoRef: false,
    supportsRatio: false,
    supportsDuration: true,
    requiresPrompt: false,
    aspectRatios: [],
    resolutions: ['480P', '720P', '1080P'],
    durationMin: 3,
    durationMax: 15,
    minReferenceImages: 1,
    minReferenceVideos: 0,
    maxReferenceImages: 1,
  },
  'happyhorse-1.0-r2v': {
    generationType: 'r2v',
    requiresFirstFrame: false,
    supportsMultiImage: true,
    supportsVideoRef: false,
    supportsRatio: true,
    supportsDuration: true,
    requiresPrompt: true,
    aspectRatios: HAPPYHORSE_GENERATION_RATIOS,
    resolutions: ['480P', '720P', '1080P'],
    durationMin: 3,
    durationMax: 15,
    minReferenceImages: 1,
    minReferenceVideos: 0,
    maxReferenceImages: 9,
  },
  'happyhorse-1.0-video-edit': {
    generationType: 'video-edit',
    requiresFirstFrame: false,
    supportsMultiImage: true,
    supportsVideoRef: true,
    supportsRatio: false,
    supportsDuration: false,
    requiresPrompt: true,
    aspectRatios: [],
    resolutions: ['720P', '1080P'],
    durationMin: 3,
    durationMax: 15,
    minReferenceImages: 0,
    minReferenceVideos: 1,
    maxReferenceImages: 5,
  },
};

export function getHappyHorseModelSpec(userModel: string): HappyHorseModelSpec | null {
  return HAPPYHORSE_MODEL_SPECS[userModel] || null;
}

function uniqueValues(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }

  return out;
}

function getPayloadMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;

  const data = payload as ArkErrorPayload;
  const target = [data.target_host, data.target_path].filter(Boolean).join('');
  const targetTip = target ? `目标接口：${target}` : '';

  if (typeof data.error === 'string') {
    return [data.error, data.message, targetTip].filter(Boolean).join(': ');
  }
  if (data.error?.message) {
    return [data.error.code, data.error.message, targetTip].filter(Boolean).join(': ');
  }
  if (data.message) return [data.message, targetTip].filter(Boolean).join(': ');
  if (data.code) return [data.code, targetTip].filter(Boolean).join(': ');

  return undefined;
}

export function isInputImagePrivacyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    message.includes('InputImageSensitiveContentDetected.PrivacyInformation') ||
    /input image may contain real person/i.test(message) ||
    /真人|人像隐私|隐私信息/.test(message)
  );
}

function getRequestId(message: string): string | undefined {
  return (
    /Request\s*id\s*:\s*([a-zA-Z0-9_-]+)/i.exec(message)?.[1] ||
    /RequestId\s*[:=]\s*([a-zA-Z0-9_-]+)/i.exec(message)?.[1]
  );
}

export function normalizeVideoApiMessage(message: string): string {
  const requestId = getRequestId(message);
  const requestTip = requestId ? `\n请求 ID：${requestId}` : '';

  if (isInputImagePrivacyError(message)) {
    return [
      '输入参考图疑似包含真人、人脸或隐私信息，Seedance 2.0 不允许直接把这类图片/视频作为参考素材提交。',
      '处理办法：更换为非真人参考图，或使用方舟素材库里已授权的真人/虚拟人 asset:// 素材。',
      requestTip,
    ].filter(Boolean).join('\n');
  }

  if (/InputImageSensitiveContentDetected/i.test(message)) {
    return [
      '输入参考图触发内容安全审核，系统认为图片可能包含敏感视觉内容。',
      '处理办法：更换参考图，或去掉/弱化血腥、恐怖、暴力、裸露、真人人脸、隐私信息等高风险元素后再生成。',
      requestTip,
    ].filter(Boolean).join('\n');
  }

  if (/InputVideoSensitiveContentDetected/i.test(message)) {
    return [
      '输入参考视频触发内容安全审核，系统认为视频可能包含敏感视觉内容。',
      '处理办法：更换参考视频，或移除血腥、暴力、裸露、真人人脸、隐私信息等高风险片段后重试。',
      requestTip,
    ].filter(Boolean).join('\n');
  }

  if (/InputAudioSensitiveContentDetected/i.test(message)) {
    return [
      '输入参考音频触发内容安全审核，可能包含敏感语音、受限歌曲或不合规内容。',
      '处理办法：更换音频，或裁掉对应片段后重试。',
      requestTip,
    ].filter(Boolean).join('\n');
  }

  if (/copyright|intellectual.?property|ip.?infring|trademark|brand.?rights|版权|著作权|商标/i.test(message)) {
    return [
      '输入内容或参考素材疑似涉及版权、商标或受保护 IP，任务被内容安全审核拦截。',
      '处理办法：改用自有或已获授权的素材，并移除受保护角色、品牌标识、影视片段或音乐。',
      requestTip,
    ].filter(Boolean).join('\n');
  }

  if (/gore|blood|graphic.?violence|violent|violence|血腥|流血|暴力|肢解/i.test(message)) {
    return [
      '输入内容或生成结果触发血腥/暴力安全审核。',
      '处理办法：删除或弱化流血、伤口、肢解、武器伤害等描述，并更换相关参考素材。',
      requestTip,
    ].filter(Boolean).join('\n');
  }

  if (/sexual|nudity|porn|adult|裸露|色情|性内容/i.test(message)) {
    return [
      '输入内容或生成结果触发裸露/性内容安全审核。',
      '处理办法：删除相关描述并更换参考素材后重试。',
      requestTip,
    ].filter(Boolean).join('\n');
  }

  if (/InputTextSensitiveContentDetected/i.test(message)) {
    return [
      '提示词触发内容安全审核，系统认为文本中可能包含敏感内容。',
      '处理办法：删除或改写高风险描述后再生成。',
      requestTip,
    ].filter(Boolean).join('\n');
  }

  if (/Output.*SensitiveContentDetected/i.test(message)) {
    return [
      '生成结果触发内容安全审核，视频未能返回。',
      '处理办法：降低血腥、恐怖、暴力、裸露、真人人脸等敏感描述强度，或更换参考素材后重试。',
      requestTip,
    ].filter(Boolean).join('\n');
  }

  if (/InvalidParameter|Invalid Parameter/i.test(message)) {
    const detail = message.trim().slice(0, 360);
    return [
      '请求参数不合法，请检查模型、比例、分辨率、时长、参考素材数量和素材格式。',
      detail ? `接口详情：${detail}` : '',
      requestTip,
    ].filter(Boolean).join('\n');
  }

  const modelNotOpenMatch = /ModelNotOpen.*?(doubao-seedance[\w-]+)/i.exec(message);
  if (modelNotOpenMatch) {
    return [
      `模型 ${modelNotOpenMatch[1]} 尚未开通，请在火山方舟控制台激活该模型服务。`,
      '处理办法：前往 https://console.volcengine.com/ark/region:ark+cn-beijing/model 开通对应模型。',
      requestTip,
    ].filter(Boolean).join('\n');
  }

  if (/Proxy error/i.test(message)) {
    return [
      '本地代理转发火山方舟接口失败，不是模型生成内容本身的错误。',
      message.replace(/^Proxy error:?\s*/i, '').trim(),
      '处理办法：检查 API 地址是否为 https://ark.cn-beijing.volces.com，确认网络能访问方舟接口；如果使用私有网关，需要把域名加入 VOLCENGINE_PROXY_ALLOWED_HOSTS。',
      requestTip,
    ].filter(Boolean).join('\n');
  }

  return message;
}

function normalizeVideoApiError(status: number, message: string): string {
  if (status === 401) {
    return `视频生成失败：API Key 无效或已过期，请重新检查 Seedance API Key。\n接口详情：${message}`;
  }
  if (status === 403) {
    return `视频生成失败：当前账号没有调用该 Seedance 模型的权限，请先在对应平台开通模型。\n接口详情：${message}`;
  }
  if (status === 402 || /insufficient.?balance|insufficient.?credit|quota.?exceed|余额不足|额度不足/i.test(message)) {
    return `视频生成失败：当前账号额度或余额不足，请充值或更换有额度的 API Key。\n接口详情：${message}`;
  }
  if (status === 429 || /rate.?limit|too many requests|限流|请求过多/i.test(message)) {
    return `视频生成失败：请求过于频繁，已触发接口限流，请稍后重试。\n接口详情：${message}`;
  }
  return `视频生成失败：${status} - ${normalizeVideoApiMessage(message)}`;
}

async function readResponsePayload(response: Response): Promise<{ payload?: unknown; text: string }> {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (contentType.includes('application/json') || text.trim().startsWith('{')) {
    try {
      return { payload: JSON.parse(text), text };
    } catch {
      return { text };
    }
  }

  return { text };
}

function requestSizeInBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isTransientTaskQueryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /(?:^|\D)(?:408|425|429|500|502|503|504)(?:\D|$)|fetch failed|failed to fetch|proxy|network|timeout|timed out|ECONN|ETIMEDOUT|UND_ERR|socket|TLS|本地代理|网络连接|连接不可用|请求超时/i.test(message);
}

function validateReferenceUrls(referenceImages: string[], referenceVideos: string[]) {
  const unsupportedImage = referenceImages.find((url) =>
    /^data:image\/svg/i.test(url) || /\.svg(?:[?#].*)?$/i.test(url)
  );
  if (unsupportedImage) {
    throw new Error('Seedance 2.0 参考图片仅支持 jpeg/png/webp/bmp/tiff/gif，不能直接使用 SVG。');
  }

  const localVideo = referenceVideos.find((url) => /^data:video\//i.test(url));
  if (localVideo) {
    throw new Error('Seedance 2.0 参考视频必须是公网 URL 或 asset:// 素材 ID，本地上传视频不能直接作为 Base64 发送。');
  }
}

export function validateSeedance20ReferenceCounts(
  imageCount: number,
  videoCount: number,
  audioCount: number,
): void {
  const over: string[] = [];
  if (imageCount > SEEDANCE_20_REFERENCE_LIMITS.images) {
    over.push(`图片 ${imageCount}/${SEEDANCE_20_REFERENCE_LIMITS.images}`);
  }
  if (videoCount > SEEDANCE_20_REFERENCE_LIMITS.videos) {
    over.push(`视频 ${videoCount}/${SEEDANCE_20_REFERENCE_LIMITS.videos}`);
  }
  if (audioCount > SEEDANCE_20_REFERENCE_LIMITS.audios) {
    over.push(`音频 ${audioCount}/${SEEDANCE_20_REFERENCE_LIMITS.audios}`);
  }
  if (over.length > 0) {
    throw new Error(`Seedance 2.0 参考素材超过官方上限：${over.join('、')}。请移除多余素材后再生成。`);
  }
}

export class VideoAPI {
  private apiKey: string;
  private apiUrl: string;
  private happyHorseMode = false;
  /** apiUrl 的 origin（仅协议+主机，不含路径），避免用户配置了带路径的地址导致拼接时路径翻倍 */
  private apiOrigin: string;

  constructor(apiKey: string, apiUrl: string = DEFAULT_API_URL) {
    this.apiKey = apiKey;
    // 剥离无意附加的 HTTP 方法前缀（如 "POST https://..."）
    const raw = (apiUrl || DEFAULT_API_URL).replace(/\/+$/, '').replace(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+/i, '');
    this.apiUrl = raw;
    try {
      this.apiOrigin = new URL(raw).origin;
    } catch {
      // Fallback: 正则提取协议+主机（防御 new URL() 失败）
      const m = raw.match(/https?:\/\/[^/?#]+/i);
      this.apiOrigin = m ? m[0] : raw.replace(/\/api\/.*$/, '');
      console.warn('[VideoAPI] new URL failed for apiUrl, fallback origin:', this.apiOrigin);
    }
  }

  private isHappyHorse(model?: string): boolean {
    return this.happyHorseMode
      || /^happyhorse-/i.test(model || '')
      || /dashscope|\.maas\.aliyuncs\.com/i.test(this.apiUrl);
  }

  private getProxyHeaders(targetUrl: string): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-Target-URL': targetUrl,
      'X-API-Key': this.apiKey,
    };
  }

  private getProxyUrl(): string {
    const host = (() => { try { return new URL(this.apiUrl).hostname.toLowerCase(); } catch { return ''; } })();
    if (host.endsWith('.volces.com') || host.endsWith('.volcengineapi.com')) {
      return '/api/proxy/volcengine';
    }
    return '/api/proxy/openai';
  }

  private getTaskTargetUrl(taskId?: string): string {
    let basePath = '/api/v3/contents/generations/tasks';
    try {
      const parsed = new URL(this.apiUrl);
      const configuredPath = parsed.pathname.replace(/\/+$/, '');
      if (parsed.hostname.toLowerCase() === 'api.tokenriver.cn') {
        basePath = '/seedance/v3/contents/generations/tasks';
      } else if (/\/contents\/generations\/tasks$/i.test(configuredPath)) {
        basePath = configuredPath;
      } else if (configuredPath && configuredPath !== '/') {
        basePath = `${configuredPath}/contents/generations/tasks`;
      }
    } catch {
      /* constructor already produced a safe origin fallback */
    }
    return `${this.apiOrigin}${basePath}${taskId ? `/${encodeURIComponent(taskId)}` : ''}`;
  }

  private formatFetchError(error: unknown): Error {
    if (error instanceof TypeError && /failed to fetch/i.test(error.message)) {
      return new Error(
        '请求视频生成接口失败：本地代理或网络连接不可用。请确认开发服务正在运行，且参考素材总大小没有超过 64 MB。'
      );
    }

    return error instanceof Error ? error : new Error('未知错误');
  }

  private async generateHappyHorseVideo(params: {
    prompt: string;
    ratio: VideoRatio;
    resolution: VideoResolution;
    duration: VideoDuration;
    model?: string;
    referenceImage?: string;
    referenceImages?: string[];
    referenceVideos?: string[];
  }): Promise<VideoGenerateResponse> {
    const model = params.model || 'happyhorse-1.0-i2v';
    const isI2V = model === 'happyhorse-1.0-i2v';
    const isR2V = model === 'happyhorse-1.0-r2v';
    const isVideoEdit = model === 'happyhorse-1.0-video-edit';
    const spec = getHappyHorseModelSpec(model);

    const availableImages = uniqueValues([
      params.referenceImage,
      ...(params.referenceImages || []),
    ]);
    const availableVideos = uniqueValues(params.referenceVideos || []);
    if (spec?.requiresPrompt && !params.prompt.trim()) {
      throw new Error(`${model} 需要提供视频生成提示词`);
    }
    if (spec && availableImages.length < spec.minReferenceImages) {
      throw new Error(`${model} 至少需要 ${spec.minReferenceImages} 张参考图片`);
    }
    if (spec && availableVideos.length < spec.minReferenceVideos) {
      throw new Error(`${model} 至少需要 ${spec.minReferenceVideos} 个参考视频`);
    }

    const media: Array<{ type: string; url: string }> = [];
    if (isI2V && availableImages[0]) {
      // 图生视频-首帧：1 张首帧图片
      media.push({ type: 'first_frame', url: availableImages[0] });
    } else if (isR2V) {
      // 参考生视频：1-9 张参考图
      const images = availableImages.slice(0, spec?.maxReferenceImages || 9);
      for (const img of images) {
        media.push({ type: 'reference_image', url: img });
      }
    } else if (isVideoEdit) {
      // 视频编辑：1 个视频 + 0-5 张参考图
      const refVideos = availableVideos.slice(0, 1);
      for (const v of refVideos) {
        media.push({ type: 'video', url: v });
      }
      const refImages = availableImages.slice(0, spec?.maxReferenceImages || 5);
      for (const img of refImages) {
        media.push({ type: 'reference_image', url: img });
      }
    }
    // T2V 不需要 media

    const input: Record<string, unknown> = { prompt: params.prompt };
    if (media.length > 0) input.media = media;

    const parameters: Record<string, unknown> = { resolution: params.resolution };
    if (spec?.supportsDuration !== false) parameters.duration = params.duration;
    if (spec?.supportsRatio) parameters.ratio = params.ratio;

    const requestBody: Record<string, unknown> = { model, input, parameters };

    try {
      const targetUrl = `${this.apiOrigin}/api/v1/services/aigc/video-generation/video-synthesis`;
      console.log('[HappyHorse] origin:', this.apiOrigin, '→ targetUrl:', targetUrl);
      const proxyHeaders = this.getProxyHeaders(targetUrl);
      const response = await fetch(this.getProxyUrl(), {
        method: 'POST',
        headers: {
          ...proxyHeaders,
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      if (!response.ok) {
        const message = data.message || data.code || response.statusText;
        let hint = '';
        // 代理层拒绝主机时附带诊断信息
        if (typeof message === 'string' && message.includes('不在代理白名单中')) {
          hint = `\n当前 API 地址: ${this.apiUrl}\n请在服务端环境变量 OPENAI_PROXY_ALLOWED_HOSTS 中添加该域名，或将 API 地址恢复为默认的 https://dashscope.aliyuncs.com`;
        }
        // 401 鉴权失败：提示 DashScope API Key 获取方式
        if (response.status === 401) {
          hint = `\nDashScope API Key 无效，请检查：\n1) 前往 https://bailian.console.aliyun.com 获取 DashScope API Key（以 sk- 开头）\n2) 注意不是阿里云 RAM AccessKey，DashScope 使用独立的 API Key\n3) 确认已开通「视频生成」服务\n4) 若刚创建 Key，可能需要等待几分钟生效`;
        }
        // 403 权限拒绝：常见于模型未开通或不支持同步调用
        if (response.status === 403) {
          if (typeof message === 'string' && /synchronous/i.test(message)) {
            hint = `\nHappyHorse 模型仅支持异步调用，已自动切换。若仍失败请检查：\n1) 前往 https://bailian.console.aliyun.com → 模型广场 → 开通 HappyHorse 模型\n2) API Key、模型、端点必须属于同一区域（北京/新加坡/美国）\n3) HappyHorse 为 2026年4月新发布模型，确认账号已获得模型权限`;
          } else {
            hint = `\nAPI 权限不足，请检查：\n1) 前往 https://bailian.console.aliyun.com → 模型广场 → 确认已开通对应模型\n2) 确认 API Key 有视频生成权限\n3) 部分模型需要申请白名单才能使用`;
          }
        }
        // 400 常见错误：模型不存在 / 参数问题
        if (response.status === 400) {
          if (typeof message === 'string' && /model.*not.*exist/i.test(message)) {
            hint = `\n模型 "${model}" 不存在，请检查：\n1) API Key、模型、端点必须属于同一区域（北京/新加坡/美国）\n2) 前往 https://bailian.console.aliyun.com → 模型广场 → 开通 HappyHorse 模型\n3) HappyHorse 为 2026年4月新发布模型，确认账号已获得模型权限\n4) 如果是新加坡/美国区域 Key，请将 API 地址改为对应区域端点`;
          } else {
            hint = `\n请求参数错误，请检查：\n1) 模型名称: ${model}\n2) 当前模型${spec?.supportsRatio ? '支持所选比例' : '不接受比例参数（已自动排除）'}\n3) 支持分辨率: ${spec?.resolutions.join(' / ') || '请查看模型文档'}\n4) ${spec?.supportsDuration ? '时长范围 3-15 秒' : '视频编辑时长由输入视频自动决定（已自动排除时长参数）'}`;
          }
        }
        throw new Error(`HappyHorse API错误：${response.status} - ${message}${hint}`);
      }

      return {
        task_id: data.output?.task_id || '',
        status: data.output?.task_status?.toLowerCase() || 'pending',
        message: data.request_id ? `请求ID: ${data.request_id}` : undefined,
      };
    } catch (error) {
      console.error('VideoAPI.generateHappyHorseVideo error:', error);
      throw this.formatFetchError(error);
    }
  }

  async queryHappyHorseTask(taskId: string): Promise<TaskQueryResponse> {
    try {
      const targetUrl = `${this.apiOrigin}/api/v1/tasks/${encodeURIComponent(taskId)}`;
      const response = await fetch(this.getProxyUrl(), {
        method: 'GET',
        headers: this.getProxyHeaders(targetUrl),
      });

      const data = await response.json();
      if (!response.ok) {
        const message = data.message || data.code || response.statusText;
        let hint = '';
        if (typeof message === 'string' && message.includes('不在代理白名单中')) {
          hint = `\n当前 API 地址: ${this.apiUrl}\n请在服务端环境变量 OPENAI_PROXY_ALLOWED_HOSTS 中添加该域名，或将 API 地址恢复为默认的 https://dashscope.aliyuncs.com`;
        }
        if (response.status === 401) {
          hint = `\nDashScope API Key 无效，请检查：\n1) 前往 https://bailian.console.aliyun.com 获取 DashScope API Key（以 sk- 开头）\n2) 注意不是阿里云 RAM AccessKey，DashScope 使用独立的 API Key\n3) 确认已开通「视频生成」服务`;
        }
        if (response.status === 400) {
          hint = `\n查询失败，task_id 可能已过期（有效期 24 小时）或格式错误`;
        }
        throw new Error(`HappyHorse查询错误：${response.status} - ${message}${hint}`);
      }

      const status = data.output?.task_status?.toLowerCase();
      const normalizedStatus = status === 'succeeded' ? 'succeeded' 
        : status === 'failed' ? 'failed' 
        : status === 'pending' || status === 'queued' ? 'queued'
        : 'running';

      return {
        task_id: data.output?.task_id || taskId,
        status: normalizedStatus as ArkVideoTaskStatus,
        result: data.output?.video_url ? { video_url: data.output.video_url } : undefined,
        message: data.output?.message || data.output?.code,
      };
    } catch (error) {
      console.error('VideoAPI.queryHappyHorseTask error:', error);
      throw this.formatFetchError(error);
    }
  }

  async generateVideo(params: {
    prompt: string;
    ratio: VideoRatio;
    resolution: VideoResolution;
    duration: VideoDuration;
    generateAudio?: boolean;
    model?: string;
    firstFrameImage?: string;
    referenceImage?: string;
    referenceImages?: string[];
    referenceVideos?: string[];
    referenceAudios?: string[];
    callbackUrl?: string;
  }): Promise<VideoGenerateResponse> {
    this.happyHorseMode = this.isHappyHorse(params.model);
    if (this.happyHorseMode) {
      return this.generateHappyHorseVideo({
        ...params,
        referenceImage: params.firstFrameImage || params.referenceImage || params.referenceImages?.[0],
        referenceVideos: params.referenceVideos,
      });
    }

    const prompt = params.prompt.trim();
    const firstFrameImage = params.firstFrameImage?.trim() || '';
    const referenceImages = uniqueValues([
      params.referenceImage,
      ...(params.referenceImages || []),
    ]).filter((url) => url !== firstFrameImage);
    const referenceVideos = uniqueValues(params.referenceVideos || []);
    const referenceAudios = uniqueValues(params.referenceAudios || []);

    validateSeedance20ReferenceCounts(
      referenceImages.length + (firstFrameImage ? 1 : 0),
      referenceVideos.length,
      referenceAudios.length,
    );

    validateReferenceUrls([firstFrameImage, ...referenceImages].filter(Boolean), referenceVideos);

    if (!prompt && !firstFrameImage && referenceImages.length === 0 && referenceVideos.length === 0) {
      throw new Error('请输入提示词，或连接至少 1 个参考图片/视频素材。');
    }

    if (referenceAudios.length > 0 && !firstFrameImage && referenceImages.length === 0 && referenceVideos.length === 0) {
      throw new Error('Seedance 2.0 参考音频不能单独使用，需要同时提供参考图片或参考视频。');
    }

    const content: ArkVideoContentItem[] = [];
    if (prompt) {
      content.push({ type: 'text', text: prompt });
    }

    if (firstFrameImage) {
      content.push({
        type: 'image_url',
        image_url: { url: firstFrameImage },
        role: 'first_frame',
      });
    }

    for (const url of referenceImages) {
      content.push({
        type: 'image_url',
        image_url: { url },
        role: 'reference_image',
      });
    }

    for (const url of referenceVideos) {
      content.push({
        type: 'video_url',
        video_url: { url },
        role: 'reference_video',
      });
    }

    for (const url of referenceAudios) {
      content.push({
        type: 'audio_url',
        audio_url: { url },
        role: 'reference_audio',
      });
    }

    const actualModel = params.model
      ? MODEL_MAPPING[params.model] || params.model
      : MODEL_MAPPING['seedance-2.0'];

    const isSeedance20 = /doubao-seedance-2-0/i.test(actualModel);
    if (isSeedance20 && (params.duration < 4 || params.duration > 15)) {
      throw new Error(`Seedance 2.0 时长仅支持 4–15 秒，当前为 ${params.duration} 秒。`);
    }
    const allowedSeedance20Ratios = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']);
    if (isSeedance20 && !allowedSeedance20Ratios.has(params.ratio)) {
      throw new Error(`Seedance 2.0 不支持比例 ${params.ratio}，请选择 16:9、4:3、1:1、3:4、9:16 或 21:9。`);
    }

    const isSeedanceFast = isSeedance20 && actualModel.includes('fast');
    if (isSeedanceFast && !['480P', '720P'].includes(params.resolution)) {
      throw new Error(`Seedance 2.0 Fast 仅支持 480P 或 720P，当前为 ${params.resolution}。`);
    }

    const requestBody: Record<string, unknown> = {
      model: actualModel,
      content,
      resolution: params.resolution.toLowerCase(),
      ratio: params.ratio,
      duration: params.duration,
      generate_audio: params.generateAudio !== false,
      return_last_frame: true,
      watermark: false,
    };

    if (params.callbackUrl?.trim()) {
      requestBody.callback_url = params.callbackUrl.trim();
    }

    const requestText = JSON.stringify(requestBody);
    if (requestSizeInBytes(requestText) > MAX_REQUEST_BYTES) {
      throw new Error('参考素材总大小超过火山方舟 64 MB 请求体限制，请减少素材数量或改用公网 URL / asset:// 素材。');
    }

    try {
      const targetUrl = this.getTaskTargetUrl();
      const response = await fetch(this.getProxyUrl(), {
        method: 'POST',
        headers: this.getProxyHeaders(targetUrl),
        body: requestText,
      });

      const { payload, text } = await readResponsePayload(response);
      if (!response.ok) {
        const message = getPayloadMessage(payload) || text || response.statusText;
        throw new Error(normalizeVideoApiError(response.status, message));
      }

      const result = (payload || {}) as {
        id?: string;
        task_id?: string;
        status?: string;
        message?: string;
      };
      return {
        task_id: result.id || result.task_id || '',
        status: result.status ?? 'queued',
        message: result.message,
      };
    } catch (error) {
      console.error('VideoAPI.generateVideo error:', error);
      throw this.formatFetchError(error);
    }
  }

  async queryTask(taskId: string): Promise<TaskQueryResponse> {
    if (this.isHappyHorse()) {
      return this.queryHappyHorseTask(taskId);
    }

    try {
      const targetUrl = this.getTaskTargetUrl(taskId);
      const response = await fetch(this.getProxyUrl(), {
        method: 'GET',
        headers: this.getProxyHeaders(targetUrl),
      });

      const { payload, text } = await readResponsePayload(response);
      if (!response.ok) {
        const message = getPayloadMessage(payload) || text || response.statusText;
        throw new Error(`查询失败：${response.status} - ${normalizeVideoApiMessage(message)}`);
      }

      const result = (payload || {}) as {
        id?: string;
        task_id?: string;
        status?: string;
        content?: { video_url?: string; last_frame_url?: string };
        error?: { message?: string };
        message?: string;
        usage?: TaskQueryResponse['usage'];
        progress?: number;
      };
      const rawProgress = Number(result.progress);
      const rawStatus = result.status;
      const status = (VIDEO_STATUSES.includes((rawStatus || '') as ArkVideoTaskStatus)
        ? rawStatus
        : 'queued') as ArkVideoTaskStatus;
      const videoUrl = result.content?.video_url;
      const message = result.error?.message || result.message;

      return {
        task_id: result.id || result.task_id || taskId,
        status,
        result: videoUrl
          ? { video_url: videoUrl, cover_url: result.content?.last_frame_url }
          : undefined,
        message: message ? normalizeVideoApiMessage(message) : undefined,
        progress: Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : undefined,
        usage: result.usage
          ? {
              completion_tokens: result.usage.completion_tokens,
              total_tokens: result.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      console.error('VideoAPI.queryTask error:', error);
      throw this.formatFetchError(error);
    }
  }

  async pollTaskUntilComplete(
    taskId: string,
    onProgress?: (status: string, progress?: number) => void,
    maxAttempts: number = 120,
    intervalMs: number = 5000
  ): Promise<TaskQueryResponse> {
    let transientFailures = 0;
    for (let i = 0; i < maxAttempts; i++) {
      let result: TaskQueryResponse;
      try {
        result = await this.queryTask(taskId);
        transientFailures = 0;
      } catch (error) {
        if (
          isTransientTaskQueryError(error)
          && transientFailures < MAX_TRANSIENT_TASK_QUERY_FAILURES
        ) {
          transientFailures += 1;
          onProgress?.('running');
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
          continue;
        }
        throw error;
      }

      onProgress?.(result.status, result.progress);

      if (
        result.status === 'succeeded' ||
        result.status === 'failed' ||
        result.status === 'cancelled' ||
        result.status === 'expired'
      ) {
        return result;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error('任务超时');
  }
}

export function createVideoAPI(apiKey: string, apiUrl?: string): VideoAPI {
  if (!apiKey) {
    throw new Error('请先配置 API Key');
  }
  return new VideoAPI(apiKey, apiUrl);
}
