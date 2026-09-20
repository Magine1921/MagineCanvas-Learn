'use client';

import type { ProviderConfig } from '@/components/seedance/SeedanceStore';
import { createKlingJwt } from '@/lib/kling-jwt';
import { getProxyUrl } from './APIFactory';

export interface KlingVideoParams {
  model: string;
  prompt: string;
  duration?: string;
  aspect_ratio?: string;
  mode?: 'std' | 'pro' | '4k';
  negative_prompt?: string;
  cfg_scale?: number;
  referenceImage?: string;
  endImage?: string;
  referenceImages?: string[];
  elementIds?: string[];
  referenceVideo?: string;
}

export interface KlingTaskResult {
  task_id: string;
  endpointType: string;
}

export interface KlingTaskStatus {
  task_id: string;
  status: 'submitted' | 'processing' | 'succeed' | 'failed';
  video_url?: string;
  cover_url?: string;
  message?: string;
}

// ── Kling 模型规格 ──

export interface KlingModelSpec {
  /** 支持的端点类型 */
  endpointTypes: string[];
  /** 是否支持首帧 I2V */
  supportsFirstFrame: boolean;
  /** 是否支持尾帧 */
  supportsLastFrame: boolean;
  /** 是否支持多图参考 (multi-image2video) */
  supportsMultiImage: boolean;
  /** 是否支持 Omni (元素/视频参考) */
  supportsOmni: boolean;
  /** 是否支持视频参考 */
  supportsVideoRef: boolean;
  /** 支持的 mode */
  modes: string[];
  /** 支持的时长 */
  durations: string[];
  /** 支持的画面比例 */
  aspectRatios: string[];
}

const KLING_FLEXIBLE_DURATIONS = Array.from({ length: 13 }, (_, index) => String(index + 3));

const KLING_MODEL_SPECS: Record<string, KlingModelSpec> = {
  'kling-v3-omni': {
    endpointTypes: ['text2video', 'image2video', 'omni'],
    supportsFirstFrame: true,
    supportsLastFrame: true,
    supportsMultiImage: true,
    supportsOmni: true,
    supportsVideoRef: true,
    modes: ['std', 'pro', '4k'],
    durations: KLING_FLEXIBLE_DURATIONS,
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  'kling-v3': {
    endpointTypes: ['text2video', 'image2video'],
    supportsFirstFrame: true,
    supportsLastFrame: true,
    supportsMultiImage: false,
    supportsOmni: false,
    supportsVideoRef: false,
    modes: ['std', 'pro', '4k'],
    durations: KLING_FLEXIBLE_DURATIONS,
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  'kling-v2-6': {
    endpointTypes: ['text2video', 'image2video', 'multi-image2video'],
    supportsFirstFrame: true,
    supportsLastFrame: true,
    supportsMultiImage: true,
    supportsOmni: false,
    supportsVideoRef: false,
    modes: ['std', 'pro'],
    durations: ['5', '10'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  'kling-v2-master': {
    endpointTypes: ['text2video', 'image2video'],
    supportsFirstFrame: true,
    supportsLastFrame: true,
    supportsMultiImage: false,
    supportsOmni: false,
    supportsVideoRef: false,
    modes: ['std', 'pro'],
    durations: ['5', '10'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  'kling-v2-1': {
    endpointTypes: ['text2video', 'image2video'],
    supportsFirstFrame: true,
    supportsLastFrame: true,
    supportsMultiImage: false,
    supportsOmni: false,
    supportsVideoRef: false,
    modes: ['std', 'pro'],
    durations: ['5', '10'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  'kling-v2': {
    endpointTypes: ['text2video', 'image2video'],
    supportsFirstFrame: true,
    supportsLastFrame: false,
    supportsMultiImage: false,
    supportsOmni: false,
    supportsVideoRef: false,
    modes: ['std', 'pro'],
    durations: ['5', '10'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  'kling-v1-6': {
    endpointTypes: ['text2video', 'image2video', 'multi-image2video'],
    supportsFirstFrame: true,
    supportsLastFrame: false,
    supportsMultiImage: true,
    supportsOmni: false,
    supportsVideoRef: false,
    modes: ['std', 'pro'],
    durations: ['5', '10'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  'kling-v1-5': {
    endpointTypes: ['text2video', 'image2video'],
    supportsFirstFrame: true,
    supportsLastFrame: false,
    supportsMultiImage: false,
    supportsOmni: false,
    supportsVideoRef: false,
    modes: ['std', 'pro'],
    durations: ['5', '10'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  'kling-v1': {
    endpointTypes: ['text2video'],
    supportsFirstFrame: false,
    supportsLastFrame: false,
    supportsMultiImage: false,
    supportsOmni: false,
    supportsVideoRef: false,
    modes: ['std', 'pro'],
    durations: ['5', '10'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
};

export function getKlingModelSpec(userModel: string): KlingModelSpec | null {
  return KLING_MODEL_SPECS[userModel] || null;
}

// ── Kling 业务错误码 → 中文说明 ──

const KLING_ERROR_MAP: Record<number, string> = {
  // 鉴权类 (本地配置问题)
  1000: '【本地配置】身份验证失败：Authorization header 不正确或缺失',
  1001: '【本地配置】API Key 为空：请在厂商设置中填写 AccessKey:SecretKey',
  1002: '【本地配置】JWT 签名无效：AccessKey 或 SecretKey 有误，或密钥已过期/被禁用',
  1003: '【本地配置】JWT 未到生效时间：系统时钟偏差过大，请校准电脑时间',
  1004: '【本地配置】JWT 已过期：Token 30 分钟有效期内未完成请求，请重试',
  // 请求参数类
  1100: '请求参数非法：缺少必填字段或参数值超出范围',
  1101: '请求参数非法：model_name 不支持当前端点类型',
  // 业务限制类
  1200: '【额度/权限】API 服务未开通或已欠费',
  1201: '【额度/权限】账户余额不足或资源包已用完',
  1202: '【官方限制】并发任务数超出限制，请等待',
};

function parseKlingError(data: Record<string, unknown>, httpStatus: number): string {
  const code = typeof data.code === 'number' ? data.code : -1;
  const message = typeof data.message === 'string' ? data.message : '';

  // 优先查错误码表
  if (code > 0 && KLING_ERROR_MAP[code]) {
    return `可灵 API (HTTP ${httpStatus}, code: ${code}): ${KLING_ERROR_MAP[code]}${message ? ` — ${message}` : ''}`;
  }
  if (code > 0 && message) {
    return `可灵 API (HTTP ${httpStatus}, code: ${code}): ${message}`;
  }

  // HTTP 状态码通用诊断
  if (httpStatus === 401) {
    return `可灵 API 401 鉴权失败。常见原因：\n1) AK/SK 填写有误 — 检查是否有多余空格、冒号位置是否正确\n2) 系统时钟偏差 — 校准电脑时间后重试\n3) 密钥已过期/被禁用 — 到 app.klingai.com 重新生成\n4) 代理转发时 JWT 被截断 — 检查代理日志中的 apiKey len`;
  }
  if (httpStatus === 404) {
    return `可灵 API 404: 接口路径不存在。检查 API 地址是否为正确的 Kling 节点（如 https://api-singapore.klingai.com）`;
  }
  if (httpStatus === 429) {
    return `可灵 API 429: 请求频率超限，请稍后重试`;
  }

  return message
    ? `可灵 API 错误 (HTTP ${httpStatus}): ${message}`
    : `可灵 API 错误 (HTTP ${httpStatus}): ${JSON.stringify(data).slice(0, 300)}`;
}

// ── 工具函数 ──

function parseKlingCredentials(apiKey: string): { accessKey: string; secretKey: string; rawToken: string } {
  const idx = apiKey.indexOf(':');
  if (idx < 0) return { accessKey: '', secretKey: '', rawToken: apiKey };
  return { accessKey: apiKey.slice(0, idx), secretKey: apiKey.slice(idx + 1), rawToken: '' };
}

function resolveEndpointType(params: KlingVideoParams): string {
  const hasMultiImages = params.referenceImages && params.referenceImages.length >= 2;
  const hasElements = params.elementIds && params.elementIds.length > 0;
  const hasVideoRef = !!params.referenceVideo;
  const isImage2Video = !!params.referenceImage && !hasMultiImages;

  if (hasElements || hasVideoRef) return 'omni';
  if (hasMultiImages) return 'multi-image2video';
  if (isImage2Video || params.endImage) return 'image2video';
  return 'text2video';
}

// ── API ──

export function createKlingVideoAPI(providerConfig: ProviderConfig) {
  const base = providerConfig.apiUrl.replace(/\/+$/, '');
  const proxyUrl = getProxyUrl(providerConfig);

  async function getAuthToken(): Promise<string> {
    const { accessKey, secretKey, rawToken } = parseKlingCredentials(providerConfig.apiKey);
    if (accessKey && secretKey) {
      return createKlingJwt(accessKey, secretKey);
    }
    return rawToken;
  }

  async function createTask(params: KlingVideoParams): Promise<KlingTaskResult> {
    const jwt = await getAuthToken();
    const endpointType = resolveEndpointType(params);
    const endpoint = `${base}/v1/videos/${endpointType}`;

    const klingModel = params.model;
    const spec = KLING_MODEL_SPECS[klingModel] || null;

    const body: Record<string, unknown> = {
      model_name: klingModel,
      duration: params.duration || '5',
      mode: params.mode || 'std',
    };

    // aspect_ratio 对 omni 无效
    if (endpointType !== 'omni') {
      body.aspect_ratio = params.aspect_ratio || '16:9';
    }

    if (params.prompt) body.prompt = params.prompt;

    // 首帧 I2V
    if (params.referenceImage && (spec?.supportsFirstFrame || endpointType === 'image2video')) {
      body.image = params.referenceImage;
    }
    // 尾帧
    if (params.endImage && spec?.supportsLastFrame) {
      body.image_tail = params.endImage;
    }
    // 多图参考
    if (endpointType === 'multi-image2video' && params.referenceImages) {
      body.image_list = params.referenceImages.map((url) => ({ image: url }));
    }
    // Omni 元素
    if (params.elementIds?.length) {
      body.elements = params.elementIds.map((id, i) => ({ id, placeholder: `element_${i + 1}` }));
    }
    // Omni 视频参考
    if (params.referenceVideo && spec?.supportsVideoRef) {
      body.video_ref = params.referenceVideo;
    }

    if (params.negative_prompt) body.negative_prompt = params.negative_prompt;
    if (params.cfg_scale !== undefined) body.cfg_scale = params.cfg_scale;

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Target-URL': endpoint,
        'X-API-Key': jwt,
      },
      body: JSON.stringify(body),
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const code = typeof data.code === 'number' ? data.code : -1;
    if (!response.ok || (code > 0 && code !== 0)) {
      throw new Error(parseKlingError(data, response.status));
    }

    const taskId = typeof data.data === 'object' && data.data && typeof (data.data as Record<string, unknown>).task_id === 'string'
      ? (data.data as Record<string, string>).task_id
      : typeof data.task_id === 'string' ? data.task_id : '';
    if (!taskId) throw new Error(`可灵: 响应中未找到 task_id，原始响应: ${JSON.stringify(data).slice(0, 300)}`);

    return { task_id: taskId, endpointType };
  }

  async function queryTask(taskId: string, endpointType?: string): Promise<KlingTaskStatus> {
    const type = endpointType || 'text2video';
    const endpoint = `${base}/v1/videos/${type}/${encodeURIComponent(taskId)}`;
    const jwt = await getAuthToken();

    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'X-Target-URL': endpoint,
        'X-API-Key': jwt,
      },
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const code = typeof data.code === 'number' ? data.code : -1;
    if (!response.ok || (code > 0 && code !== 0)) {
      throw new Error(parseKlingError(data, response.status));
    }

    const taskData = (data.data || {}) as Record<string, unknown>;
    const status = (taskData.task_status as string) || 'processing';

    let videoUrl: string | undefined;
    let coverUrl: string | undefined;
    const taskResult = taskData.task_result as Record<string, unknown> | undefined;
    if (taskResult) {
      const videos = taskResult.videos;
      if (Array.isArray(videos)) {
        const firstVideo = videos[0];
        if (typeof firstVideo === 'object' && firstVideo) {
          videoUrl = (firstVideo as Record<string, string>).url;
          coverUrl = (firstVideo as Record<string, string>).cover_url;
        } else if (typeof firstVideo === 'string') {
          videoUrl = firstVideo;
        }
      }
    }

    return {
      task_id: taskId,
      status: status as KlingTaskStatus['status'],
      video_url: videoUrl,
      cover_url: coverUrl,
      message: typeof taskData.task_status_msg === 'string' ? taskData.task_status_msg : undefined,
    };
  }

  return { createTask, queryTask };
}
