'use client';

import type { ProviderConfig } from '@/components/seedance/SeedanceStore';
import { customProviderFetchJson } from '@/lib/custom-provider-request';
import { retryKieSubmission } from '@/lib/kie-submit-retry';
import type {
  SeedreamAspectRatio,
  SeedreamResolution,
  TaskQueryResponse as ImageTaskQueryResponse,
} from './ImageAPI';
import type {
  TaskQueryResponse as VideoTaskQueryResponse,
  VideoDuration,
  VideoRatio,
} from './VideoAPI';

type KieTaskState = 'waiting' | 'queueing' | 'generating' | 'success' | 'fail' | 'failed';

interface KieSubmitResponse {
  code?: number;
  msg?: string;
  data?: {
    taskId?: string;
  };
}

interface KieMarketRecordData {
  taskId?: string;
  state?: KieTaskState | string;
  resultJson?: string | Record<string, unknown>;
  response?: unknown;
  failCode?: string;
  failMsg?: string;
  progress?: number;
  creditsConsumed?: number;
}

interface KieMarketRecordResponse {
  code?: number;
  msg?: string;
  data?: KieMarketRecordData;
}

interface KieVeoRecordData {
  taskId?: string;
  successFlag?: number;
  response?: {
    resultUrls?: string[];
    fullResultUrls?: string[];
    originUrls?: string[];
    resolution?: string;
  };
  errorCode?: string | null;
  errorMessage?: string | null;
}

interface KieVeoRecordResponse {
  code?: number;
  msg?: string;
  data?: KieVeoRecordData;
}

interface KieVeoUpgradeResponse {
  code?: number;
  msg?: string;
  data?: {
    taskId?: string;
    resultUrl?: string;
    resultUrls?: string[] | null;
  };
}

function getBase(provider: ProviderConfig): string {
  return (provider.apiUrl || 'https://api.kie.ai').replace(/\/+$/, '');
}

function getMessage(payload: { code?: number; msg?: string; data?: unknown }, fallback: string): string {
  const data = payload.data as { failMsg?: string; errorMessage?: string | null } | undefined;
  return data?.failMsg || data?.errorMessage || payload.msg || fallback;
}

export function formatKieTaskFailure(message: string, code?: string | number | null): string {
  const detail = String(message || '').trim();
  const normalizedCode = String(code ?? '').trim();
  if (
    normalizedCode === '402'
    || /insufficient credits?|credit balance|余额不足|积分不足|额度不足/i.test(detail)
  ) {
    return `Kie 账户额度不足（错误码 402）${detail ? `：${detail}` : ''}`;
  }
  if (normalizedCode === '455' || /service unavailable|maintenance|维护/i.test(detail)) {
    return `Kie 模型服务维护中，暂不可用（错误码 455）${detail ? `：${detail}` : ''}`;
  }
  if (normalizedCode === '500' || /internal error|server error|please try again later/i.test(detail)) {
    return 'Kie 云端模型内部生成失败（错误码 500），不是额度不足；请稍后重试。';
  }
  if (normalizedCode === '429' || /rate limit|too many requests|请求过快/i.test(detail)) {
    return `Kie 请求过快或并发达到限制（错误码 429）${detail ? `：${detail}` : ''}`;
  }
  return detail || (normalizedCode ? `Kie 任务失败（错误码 ${normalizedCode}）` : 'Kie 任务失败');
}

function parseErrorText(rawText: string): string {
  try {
    const payload = JSON.parse(rawText) as { error?: unknown; message?: unknown; msg?: unknown };
    return [payload.error, payload.message, payload.msg]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join('：');
  } catch {
    return rawText;
  }
}

function formatKieHttpError(action: string, status: number, rawText: string): string {
  const detail = parseErrorText(rawText);
  if (status === 502 && /proxy error|fetch failed/i.test(detail)) {
    return `Kie ${action}失败：本地代理无法连接 Kie API（HTTP 502）。通常是网络、代理/VPN、DNS、防火墙或 Kie 服务临时不可达导致。请稍后重试，或检查当前网络是否能访问 api.kie.ai。`;
  }
  if (status === 401 || status === 403) {
    return `Kie ${action}失败：API Key 无效、权限不足或账号未开通该模型（HTTP ${status}）。请检查 API 配置。`;
  }
  if (status === 402) {
    return `Kie ${action}失败：账户额度不足（HTTP 402），请检查 Kie credits 余额。`;
  }
  if (status === 404) {
    return `Kie ${action}失败：接口地址或模型接口不存在（HTTP 404）。请检查 API 地址和模型配置是否匹配 Kie 文档。`;
  }
  if (status === 429) {
    return `Kie ${action}失败：请求过快或并发达到限制（HTTP 429）。请稍后再试。`;
  }
  if (status === 455) {
    return `Kie ${action}失败：模型服务维护中，暂不可用（HTTP 455）。`;
  }
  if (status >= 500) {
    return `Kie ${action}失败：Kie 服务端或本地代理返回异常（HTTP ${status}）。${detail ? `详情：${detail.slice(0, 180)}` : '请稍后重试。'}`;
  }
  return `Kie ${action}失败（HTTP ${status}）。${detail ? `详情：${detail.slice(0, 180)}` : '请检查 API 配置后重试。'}`;
}

function isTransientKieError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /HTTP 502|fetch failed|proxy|network|timeout|timed out|ECONN|ETIMEDOUT|UND_ERR/i.test(message);
}

function parseJsonMaybe(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function pickUrls(value: unknown): string[] {
  const parsed = parseJsonMaybe(value);
  if (!parsed || typeof parsed !== 'object') return [];
  const data = parsed as Record<string, unknown>;
  const candidates = [
    data.resultUrls,
    data.imageUrls,
    data.images,
    data.videoUrls,
    data.audioUrls,
    data.urls,
    data.url,
    data.imageUrl,
    data.videoUrl,
    data.audioUrl,
  ];
  const urls: string[] = [];
  for (const item of candidates) {
    if (typeof item === 'string' && item.trim()) urls.push(item.trim());
    if (Array.isArray(item)) {
      for (const url of item) {
        if (typeof url === 'string' && url.trim()) urls.push(url.trim());
      }
    }
  }
  return urls;
}

function isTerminalFailure(state?: string): boolean {
  return /^(fail|failed|error|cancelled|canceled)$/i.test(state || '');
}

function isTerminalSuccess(state?: string): boolean {
  return /^success$/i.test(state || '');
}

function toKieResolution(resolution?: SeedreamResolution | string): '1K' | '2K' | '4K' {
  const upper = String(resolution || '').toUpperCase();
  if (upper === '1K') return '1K';
  if (upper === '4K' || upper === '3K' || upper === 'VR8K') return '4K';
  return '2K';
}

function toKieImageAspectRatio(ratio?: SeedreamAspectRatio): string {
  return ratio || 'auto';
}

function publicUrls(urls: string[]): string[] {
  return urls.filter((url) => /^https?:\/\//i.test(url));
}

function normalizeKieImageModel(model: string, refs: string[]): string {
  if (model === 'kie-gpt-image-2' || model === 'gpt-image-2') {
    return refs.length ? 'gpt-image-2-image-to-image' : 'gpt-image-2-text-to-image';
  }
  if (model === 'nano-banana') return 'nano-banana-2';
  if (model === 'google/nano-banana' && refs.length > 0) return 'google/nano-banana-edit';
  return model;
}

function requireKieTaskId(payload: KieSubmitResponse): string {
  if (payload.code && payload.code !== 200) {
    throw new Error(formatKieTaskFailure(
      getMessage(payload, 'Kie task submit failed'),
      payload.code,
    ));
  }
  const taskId = payload.data?.taskId;
  if (!taskId) {
    throw new Error(`Kie response missing taskId: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return taskId;
}

export class KieMarketImageAPI {
  constructor(private readonly provider: ProviderConfig) {}

  async generateImage(params: {
    model: string;
    prompt: string;
    ratio: SeedreamAspectRatio;
    resolution?: SeedreamResolution;
    referenceImages?: string[];
  }): Promise<{ task_id: string; status: string }> {
    const base = getBase(this.provider);
    const refs = publicUrls(params.referenceImages || []);
    const model = normalizeKieImageModel(params.model, refs);

    const input: Record<string, unknown> = {
      prompt: params.prompt,
    };

    if (model.startsWith('gpt-image-2')) {
      input.aspect_ratio = toKieImageAspectRatio(params.ratio);
      if (refs.length) input.input_urls = refs;
    } else if (model === 'google/nano-banana') {
      input.aspect_ratio = toKieImageAspectRatio(params.ratio);
      input.output_format = 'png';
    } else if (model === 'google/nano-banana-edit') {
      if (!refs.length) {
        throw new Error('Nano Banana Edit requires at least one public reference image URL');
      }
      input.image_urls = refs.slice(0, 10);
      input.aspect_ratio = toKieImageAspectRatio(params.ratio);
      input.output_format = 'png';
    } else if (model === 'nano-banana-pro') {
      input.image_input = refs.slice(0, 8);
      input.aspect_ratio = toKieImageAspectRatio(params.ratio);
      input.resolution = toKieResolution(params.resolution);
      input.output_format = 'png';
    } else {
      input.image_input = refs.slice(0, 14);
      input.aspect_ratio = toKieImageAspectRatio(params.ratio);
      input.resolution = toKieResolution(params.resolution);
      input.output_format = 'png';
    }

    const { ok, status, data, rawText } = await retryKieSubmission(
      () => customProviderFetchJson(this.provider, {
        targetUrl: `${base}/api/v1/jobs/createTask`,
        method: 'POST',
        body: { model, input },
      }),
    );
    if (!ok) throw new Error(formatKieHttpError('图片任务提交', status, rawText));

    return { task_id: requireKieTaskId(data as KieSubmitResponse), status: 'submitted' };
  }

  async queryTask(taskId: string): Promise<ImageTaskQueryResponse> {
    const base = getBase(this.provider);
    const { ok, status, data, rawText } = await customProviderFetchJson(this.provider, {
      targetUrl: `${base}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      method: 'GET',
      omitContentType: true,
    });
    if (!ok) throw new Error(formatKieHttpError('图片结果查询', status, rawText));

    const payload = data as KieMarketRecordResponse;
    const record = payload.data || {};
    const state = String(record.state || '').toLowerCase();
    const urls = pickUrls(record.resultJson || record.response);
    const imageUrl = urls[0];

    if (isTerminalSuccess(state) && imageUrl) {
      return {
        task_id: taskId,
        status: 'success',
        result: { image_url: imageUrl },
        usage: typeof record.creditsConsumed === 'number' ? { total_tokens: record.creditsConsumed } : undefined,
      };
    }
    if (isTerminalFailure(state)) {
      return {
        task_id: taskId,
        status: 'failed',
        message: formatKieTaskFailure(
          record.failMsg || payload.msg || 'Kie image task failed',
          record.failCode,
        ),
        usage: typeof record.creditsConsumed === 'number' ? { total_tokens: record.creditsConsumed } : undefined,
      };
    }
    return {
      task_id: taskId,
      status: 'processing',
      message: typeof record.progress === 'number' ? `Kie ${record.progress}%` : state || payload.msg,
      progress: typeof record.progress === 'number' ? record.progress : undefined,
    };
  }

  async pollTaskUntilComplete(
    taskId: string,
    onProgress?: (status: string, progress?: number) => void,
    maxAttempts = 120,
    intervalMs = 3000,
  ): Promise<ImageTaskQueryResponse> {
    let transientFailures = 0;
    for (let i = 0; i < maxAttempts; i++) {
      let result: ImageTaskQueryResponse;
      try {
        result = await this.queryTask(taskId);
        transientFailures = 0;
      } catch (error) {
        if (isTransientKieError(error) && transientFailures < 5) {
          transientFailures += 1;
          onProgress?.('processing');
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
          continue;
        }
        throw error;
      }
      onProgress?.(result.status, result.progress);
      if (result.status === 'success' || result.status === 'failed') return result;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('Kie image task timeout');
  }
}

function toGeminiOmniAspectRatio(ratio?: VideoRatio): '16:9' | '9:16' {
  return ratio === '9:16' ? '9:16' : '16:9';
}

export interface KieGeminiOmniModelSpec {
  durations: Array<4 | 6 | 8 | 10>;
  aspectRatios: Array<'16:9' | '9:16'>;
  maxReferenceVideos: 1;
  maxReferenceAudios: 3;
}

const KIE_GEMINI_OMNI_SPEC: KieGeminiOmniModelSpec = {
  durations: [4, 6, 8, 10],
  aspectRatios: ['16:9', '9:16'],
  maxReferenceVideos: 1,
  maxReferenceAudios: 3,
};

export function getKieGeminiOmniModelSpec(): KieGeminiOmniModelSpec {
  return KIE_GEMINI_OMNI_SPEC;
}

export function normalizeKieGeminiOmniDuration(duration?: VideoDuration | number): 4 | 6 | 8 | 10 {
  const requested = Number(duration || 4);
  return KIE_GEMINI_OMNI_SPEC.durations.reduce((closest, candidate) =>
    Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest
  );
}

export class KieMarketVideoAPI {
  constructor(private readonly provider: ProviderConfig) {}

  async createTask(params: {
    model: string;
    prompt: string;
    duration?: VideoDuration | number;
    referenceImage?: string;
    referenceImages?: string[];
    referenceVideos?: string[];
    referenceAudios?: string[];
    ratio?: VideoRatio;
  }): Promise<{ task_id: string }> {
    const base = getBase(this.provider);
    if (params.model !== 'gemini-omni-video') {
      throw new Error(`Kie market video model is not supported: ${params.model}`);
    }

    const spec = getKieGeminiOmniModelSpec();
    const referenceVideos = publicUrls(params.referenceVideos || []).slice(0, spec.maxReferenceVideos);
    const maxImages = referenceVideos.length > 0 ? 5 : 7;
    const referenceImages = publicUrls([
      ...(params.referenceImages || []),
      ...(params.referenceImage ? [params.referenceImage] : []),
    ]).slice(0, maxImages);
    const duration = normalizeKieGeminiOmniDuration(params.duration);
    const audioIds = (params.referenceAudios || [])
      .filter((value) => /^audio[_-]?[a-z0-9]/i.test(value))
      .slice(0, spec.maxReferenceAudios);

    const input: Record<string, unknown> = {
      prompt: params.prompt,
      duration: String(duration),
      aspect_ratio: toGeminiOmniAspectRatio(params.ratio),
    };
    if (referenceImages.length > 0) {
      input.image_urls = referenceImages;
    }
    if (referenceVideos.length > 0) {
      input.video_list = referenceVideos.map((url) => ({
        url,
        start: 0,
        ends: duration,
      }));
    }
    if (audioIds.length > 0) {
      input.audio_ids = audioIds;
    }

    const { ok, status, data, rawText } = await retryKieSubmission(
      () => customProviderFetchJson(this.provider, {
        targetUrl: `${base}/api/v1/jobs/createTask`,
        method: 'POST',
        body: { model: params.model, input },
      }),
    );
    if (!ok) throw new Error(formatKieHttpError('视频任务提交', status, rawText));
    return { task_id: requireKieTaskId(data as KieSubmitResponse) };
  }

  async queryTask(taskId: string): Promise<VideoTaskQueryResponse> {
    const base = getBase(this.provider);
    const { ok, status, data, rawText } = await customProviderFetchJson(this.provider, {
      targetUrl: `${base}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      method: 'GET',
      omitContentType: true,
    });
    if (!ok) throw new Error(formatKieHttpError('视频结果查询', status, rawText));

    const payload = data as KieMarketRecordResponse;
    const record = payload.data || {};
    const state = String(record.state || '').toLowerCase();
    const videoUrl = pickUrls(record.resultJson || record.response)[0];

    if (isTerminalSuccess(state) && videoUrl) {
      return {
        task_id: taskId,
        status: 'succeeded',
        result: { video_url: videoUrl },
        usage: typeof record.creditsConsumed === 'number' ? { total_tokens: record.creditsConsumed } : undefined,
      };
    }
    if (isTerminalFailure(state)) {
      return {
        task_id: taskId,
        status: 'failed',
        message: formatKieTaskFailure(
          record.failMsg || payload.msg || 'Kie video task failed',
          record.failCode,
        ),
        usage: typeof record.creditsConsumed === 'number' ? { total_tokens: record.creditsConsumed } : undefined,
      };
    }
    return {
      task_id: taskId,
      status: 'running',
      message: typeof record.progress === 'number' ? `Kie ${record.progress}%` : state || payload.msg,
      progress: typeof record.progress === 'number' ? record.progress : undefined,
    };
  }
}

function toVeoAspectRatio(ratio?: VideoRatio): string {
  if (ratio === '16:9' || ratio === '9:16') return ratio;
  return 'Auto';
}

export interface KieVeoModelSpec {
  durations: Array<4 | 6 | 8>;
  resolutions: Array<'1080P' | '4K'>;
  aspectRatios: Array<'16:9' | '9:16'>;
  maxReferenceImages: number;
  referenceDuration: 8;
}

const KIE_VEO_DURATIONS: Array<4 | 6 | 8> = [4, 6, 8];

export function getKieVeoModelSpec(model: string): KieVeoModelSpec {
  return {
    durations: KIE_VEO_DURATIONS,
    resolutions: ['1080P', '4K'],
    aspectRatios: ['16:9', '9:16'],
    maxReferenceImages: model === 'veo3_fast' || model === 'veo3_lite' ? 8 : 2,
    referenceDuration: 8,
  };
}

export function normalizeKieVeoDuration(duration?: VideoDuration | number): 4 | 6 | 8 {
  const requested = Number(duration || 8);
  return KIE_VEO_DURATIONS.reduce((closest, candidate) =>
    Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest
  );
}

function kieVeoUpgradeUrl(record: KieVeoRecordData): string {
  return record.response?.resultUrls?.[0]
    || record.response?.fullResultUrls?.[0]
    || record.response?.originUrls?.[0]
    || '';
}

function isKieVeoUpgradePending(status: number, message: string): boolean {
  if (/insufficient|credit|balance|unauthorized|forbidden|unsupported|余额|积分|鉴权|不支持/i.test(message)) {
    return false;
  }
  return status >= 500
    || status === 404
    || status === 409
    || status === 422
    || status === 425
    || status === 429
    || /processing|generating|not ready|check back|try again|pending|处理中|生成中|尚未完成|稍后/i.test(message);
}

export class KieVeoVideoAPI {
  constructor(private readonly provider: ProviderConfig) {}

  async createTask(params: {
    model: string;
    prompt: string;
    ratio?: VideoRatio;
    duration?: VideoDuration | number;
    referenceImages?: string[];
  }): Promise<{ task_id: string }> {
    const base = getBase(this.provider);
    const spec = getKieVeoModelSpec(params.model);
    const imageUrls = publicUrls(params.referenceImages || []).slice(0, spec.maxReferenceImages);
    const generationType =
      imageUrls.length === 0
        ? 'TEXT_2_VIDEO'
        : imageUrls.length <= 2
          ? 'FIRST_AND_LAST_FRAMES_2_VIDEO'
          : 'REFERENCE_2_VIDEO';
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      model: params.model || 'veo3_fast',
      aspect_ratio: toVeoAspectRatio(params.ratio),
      enableFallback: false,
      enableTranslation: true,
      generationType,
    };
    if (imageUrls.length > 0) {
      body.imageUrls = imageUrls;
    } else {
      body.duration = normalizeKieVeoDuration(params.duration);
    }

    const { ok, status, data, rawText } = await retryKieSubmission(
      () => customProviderFetchJson(this.provider, {
        targetUrl: `${base}/api/v1/veo/generate`,
        method: 'POST',
        body,
      }),
    );
    if (!ok) throw new Error(formatKieHttpError('Veo 任务提交', status, rawText));
    return { task_id: requireKieTaskId(data as KieSubmitResponse) };
  }

  async createResolutionTask(
    taskId: string,
    resolution: '1080P' | '4K',
  ): Promise<{ task_id: string; result?: { video_url: string } }> {
    if (resolution === '1080P') return { task_id: taskId };

    const base = getBase(this.provider);
    const { ok, status, data, rawText } = await customProviderFetchJson(this.provider, {
      targetUrl: `${base}/api/v1/veo/get-4k-video`,
      method: 'POST',
      body: { taskId, index: 0 },
    });
    const payload = data as KieVeoUpgradeResponse;
    const upgradedTaskId = payload.data?.taskId || taskId;
    const immediateUrl = payload.data?.resultUrl || payload.data?.resultUrls?.[0] || '';
    if (ok && payload.code === 200) {
      return immediateUrl
        ? { task_id: upgradedTaskId, result: { video_url: immediateUrl } }
        : { task_id: upgradedTaskId };
    }

    const message = getMessage(payload, rawText || 'Veo 4K upgrade failed');
    if (isKieVeoUpgradePending(status, message)) return { task_id: upgradedTaskId };
    throw new Error(formatKieHttpError('Veo 4K 高清任务提交', status, rawText || message));
  }

  async queryResolutionTask(
    taskId: string,
    resolution: '1080P' | '4K',
  ): Promise<VideoTaskQueryResponse> {
    const base = getBase(this.provider);
    if (resolution === '1080P') {
      const { ok, status, data, rawText } = await customProviderFetchJson(this.provider, {
        targetUrl: `${base}/api/v1/veo/get-1080p-video?taskId=${encodeURIComponent(taskId)}&index=0`,
        method: 'GET',
        omitContentType: true,
      });
      const payload = data as KieVeoUpgradeResponse;
      const videoUrl = payload.data?.resultUrl || payload.data?.resultUrls?.[0] || '';
      if (ok && payload.code === 200 && videoUrl) {
        return { task_id: taskId, status: 'succeeded', result: { video_url: videoUrl }, progress: 100 };
      }
      const message = getMessage(payload, rawText || 'Veo 1080P processing');
      if (isKieVeoUpgradePending(status, message) || (ok && !videoUrl)) {
        return { task_id: taskId, status: 'running', message, progress: 95 };
      }
      return { task_id: taskId, status: 'failed', message };
    }

    const { ok, status, data, rawText } = await customProviderFetchJson(this.provider, {
      targetUrl: `${base}/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`,
      method: 'GET',
      omitContentType: true,
    });
    const payload = data as KieVeoRecordResponse;
    const record = payload.data || {};
    const is4KResult = /4k/i.test(record.response?.resolution || '');
    const videoUrl = kieVeoUpgradeUrl(record);
    if (ok && record.successFlag === 1 && is4KResult && videoUrl) {
      return { task_id: taskId, status: 'succeeded', result: { video_url: videoUrl }, progress: 100 };
    }
    if (record.successFlag === 2 || record.successFlag === 3) {
      return {
        task_id: taskId,
        status: 'failed',
        message: record.errorMessage || payload.msg || 'Kie Veo 4K upgrade failed',
      };
    }
    const message = record.errorMessage || payload.msg || rawText || 'Veo 4K processing';
    if (ok || isKieVeoUpgradePending(status, message)) {
      return { task_id: taskId, status: 'running', message, progress: 95 };
    }
    return { task_id: taskId, status: 'failed', message };
  }

  async queryTask(taskId: string): Promise<VideoTaskQueryResponse> {
    const base = getBase(this.provider);
    const { ok, status, data, rawText } = await customProviderFetchJson(this.provider, {
      targetUrl: `${base}/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`,
      method: 'GET',
      omitContentType: true,
    });
    if (!ok) throw new Error(formatKieHttpError('Veo 结果查询', status, rawText));

    const payload = data as KieVeoRecordResponse;
    const record = payload.data || {};
    if (record.successFlag === 1 && record.response?.resultUrls?.[0]) {
      return {
        task_id: taskId,
        status: 'succeeded',
        result: { video_url: record.response.resultUrls[0] },
      };
    }
    if (record.successFlag === 2 || record.successFlag === 3) {
      return {
        task_id: taskId,
        status: 'failed',
        message: record.errorMessage || payload.msg || 'Kie Veo task failed',
      };
    }
    return { task_id: taskId, status: 'running', message: payload.msg || 'Kie Veo processing' };
  }
}

export function createKieMarketImageAPI(provider: ProviderConfig): KieMarketImageAPI {
  return new KieMarketImageAPI(provider);
}

export function createKieMarketVideoAPI(provider: ProviderConfig): KieMarketVideoAPI {
  return new KieMarketVideoAPI(provider);
}

export function createKieVeoVideoAPI(provider: ProviderConfig): KieVeoVideoAPI {
  return new KieVeoVideoAPI(provider);
}
