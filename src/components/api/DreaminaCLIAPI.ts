'use client';

import type { DreaminaCliConfig } from '@/components/seedance/SeedanceStore';
import { formatDreaminaFailReason } from '@/lib/dreamina-cli-options';
import { extractTaskId } from '@/lib/dreamina-cli-result';

export {
  extractCoverUrl,
  extractImageUrl,
  extractImagesFromResult,
  extractTaskId,
  extractVideoUrl,
} from '@/lib/dreamina-cli-result';

export interface DreaminaCLIGenerateResult {
  submit_id?: string;
  id?: string;
  task_id?: string;
  status?: string;
  gen_status?: string;
  image_url?: string;
  video_url?: string;
  cover_url?: string;
  images?: Array<{ image_url: string; size?: string }>;
  fail_reason?: string;
  error?: string;
  [key: string]: unknown;
}

export interface DreaminaCLIQueryResult {
  submit_id?: string;
  gen_status?: string;
  status?: string;
  image_url?: string;
  video_url?: string;
  cover_url?: string;
  images?: Array<{ image_url: string; size?: string }>;
  fail_reason?: string;
  error?: string;
  [key: string]: unknown;
}

/**
 * 根据 CLI 文档（SKILL.md）校验 async 任务提交是否成功。
 * 成功标准：submit_id 存在 + gen_status 为 'querying' 或 'success'
 */
export function isSubmitSuccess(result: Record<string, unknown>): { ok: boolean; taskId?: string; reason?: string } {
  const taskId = extractTaskId(result);
  if (!taskId) {
    return { ok: false, reason: 'CLI 未返回 submit_id' };
  }
  const genStatus = result['gen_status'];
  if (genStatus === 'fail') {
    const raw = typeof result['fail_reason'] === 'string' ? result['fail_reason'] : '任务提交失败';
    return { ok: false, taskId, reason: formatDreaminaFailReason(raw) };
  }
  // Accept 'querying' (in progress) or 'success' (synchronous completion)
  if (genStatus === 'querying' || genStatus === 'success') {
    return { ok: true, taskId };
  }
  // Unknown status — accept if we have a taskId (be lenient)
  return { ok: true, taskId };
}

const POLL_INTERVAL = 5000;
/** 无进度超时：队列位置连续不变超过此次数则视为卡死（5分钟无进展） */
const STUCK_ATTEMPTS = 60;

function getCliPath(cliConfig: DreaminaCliConfig): string {
  return cliConfig.cliPath || 'dreamina';
}

function redactClientTraceValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^data:(image|video|audio)\//i.test(value)) {
      const comma = value.indexOf(',');
      const meta = value.slice(0, comma > 0 ? comma : 80);
      return `${meta},...[data-url ${value.length} chars]`;
    }
    if (value.length > 1200) return `${value.slice(0, 1200)}...[truncated ${value.length - 1200} chars]`;
    return value;
  }
  if (Array.isArray(value)) return value.map(redactClientTraceValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /key|token|secret|authorization/i.test(key)
        ? '[redacted]'
        : redactClientTraceValue(child);
    }
    return out;
  }
  return value;
}

function isRetryableDreaminaUploadTimeout(message: string): boolean {
  return /upload resource[\s\S]*(?:Apply(?:Image|Video|Audio)Upload|upload (?:image|video|audio))[\s\S]*(?:context deadline exceeded|timeout|timed out)/i.test(
    message,
  );
}

const DREAMINA_TRACE_ENABLED = false;

export function logDreaminaClientTrace(stage: string, payload: Record<string, unknown> = {}): void {
  if (!DREAMINA_TRACE_ENABLED) return;
  if (typeof window === 'undefined') return;
  try {
    const body = JSON.stringify({
      stage,
      at: new Date().toISOString(),
      payload: redactClientTraceValue(payload),
    });
    void fetch('/api/dreamina/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: body.length < 60000,
    }).catch(() => {});
  } catch {
    // Diagnostics must never affect generation.
  }
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  uploadRetryAttempt = 0,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const startTime = Date.now();
  console.log(`[DreaminaCLI] → POST ${url}`, JSON.stringify(body).slice(0, 300));
  logDreaminaClientTrace('request', { url, body });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const elapsed = Date.now() - startTime;
  console.log(`[DreaminaCLI] ← ${res.status} (${elapsed}ms)`, JSON.stringify(json).slice(0, 500));
  logDreaminaClientTrace('response', { url, status: res.status, elapsedMs: elapsed, json });
  if (!res.ok || json.ok === false) {
    const nested =
      json.data && typeof json.data === 'object' && !Array.isArray(json.data)
        ? (json.data as Record<string, unknown>)
        : undefined;
    const apiError =
      (typeof json.error === 'string' && json.error) ||
      (typeof nested?.fail_reason === 'string' && nested.fail_reason) ||
      (typeof nested?.error === 'string' && nested.error) ||
      (typeof json.message === 'string' && json.message) ||
      `请求失败 (${res.status})`;
    const detail =
      json.detail && typeof json.detail === 'object' && !Array.isArray(json.detail)
        ? (json.detail as Record<string, unknown>)
        : undefined;
    const reportPath =
      (typeof json.reportPath === 'string' && json.reportPath) ||
      (typeof detail?.reportPath === 'string' && detail.reportPath) ||
      '';
    const errorMessage = reportPath ? `${apiError}\n诊断报告已写入：${reportPath}` : apiError;
    if (uploadRetryAttempt === 0 && isRetryableDreaminaUploadTimeout(apiError)) {
      logDreaminaClientTrace('upload-timeout-retry', {
        url,
        status: res.status,
        elapsedMs: elapsed,
        nextAttempt: 2,
        error: apiError,
      });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return postJson(url, body, 1);
    }
    const displayError = formatDreaminaFailReason(errorMessage);
    logDreaminaClientTrace('response-error', { url, status: res.status, elapsedMs: elapsed, error: errorMessage, json });
    throw new Error(displayError);
  }
  return { ok: true, data: json };
}

function isTransientDreaminaQueryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  const lines = message.trim().split(/\r?\n/).filter(Boolean);
  const emptyOutputQueryFailure = lines.length === 1
    && /^Command failed:[\s\S]*\bquery_result\b/i.test(lines[0]);
  return emptyOutputQueryFailure
    || /get_history_by_ids|context deadline exceeded|Client\.Timeout|awaiting headers|timeout|timed out|ECONN|ETIMEDOUT|fetch failed|HTTP 5\d\d|502|network/i.test(message);
}

export class DreaminaCLIAPI {
  private cliConfig: DreaminaCliConfig;

  constructor(cliConfig: DreaminaCliConfig) {
    this.cliConfig = cliConfig;
  }

  async checkLogin(): Promise<{
    loggedIn: boolean;
    loginName?: string;
    totalCredit?: number;
    vipLevel?: string;
    userId?: string;
    usedPath?: string;
    error?: string;
    data?: Record<string, unknown>;
  }> {
    const { ok, data } = await postJson('/api/dreamina/user-credit', {
      cliPath: getCliPath(this.cliConfig),
    });
    const creditPayload =
      data.data && typeof data.data === 'object' && !Array.isArray(data.data)
        ? (data.data as Record<string, unknown>)
        : undefined;
    return {
      loggedIn: data.loggedIn === true || ok,
      loginName: typeof data.loginName === 'string' ? data.loginName : undefined,
      totalCredit:
        typeof creditPayload?.total_credit === 'number' ? creditPayload.total_credit : undefined,
      vipLevel: typeof creditPayload?.vip_level === 'string' ? creditPayload.vip_level : undefined,
      userId: creditPayload?.user_id == null ? undefined : String(creditPayload.user_id),
      usedPath: typeof data.usedPath === 'string' ? data.usedPath : undefined,
      error: typeof data.error === 'string' ? data.error : undefined,
      data,
    };
  }

  async text2image(params: {
    prompt: string;
    ratio?: string;
    resolution_type?: string;
    model_version?: string;
    quality?: string;
    style?: string;
    negative_prompt?: string;
    num_images?: number;
  }): Promise<DreaminaCLIGenerateResult> {
    const { data } = await postJson('/api/dreamina/text2image', {
      cliPath: getCliPath(this.cliConfig),
      ...params,
    });
    return (data.data || data) as DreaminaCLIGenerateResult;
  }

  async text2video(params: {
    prompt: string;
    ratio?: string;
    duration?: number;
    model_version?: string;
    resolution?: string;
    negative_prompt?: string;
  }): Promise<DreaminaCLIGenerateResult> {
    const { data } = await postJson('/api/dreamina/text2video', {
      cliPath: getCliPath(this.cliConfig),
      ...params,
    });
    return (data.data || data) as DreaminaCLIGenerateResult;
  }

  async image2video(params: {
    prompt: string;
    image?: string;
    images?: string[];
    ratio?: string;
    duration?: number;
    model_version?: string;
    resolution?: string;
  }): Promise<DreaminaCLIGenerateResult> {
    const { data } = await postJson('/api/dreamina/image2video', {
      cliPath: getCliPath(this.cliConfig),
      ...params,
    });
    return (data.data || data) as DreaminaCLIGenerateResult;
  }

  async image2image(params: {
    prompt: string;
    images: string[];
    ratio?: string;
    resolution_type?: string;
    model_version?: string;
    style?: string;
    poll?: number;
  }): Promise<DreaminaCLIGenerateResult> {
    const { data } = await postJson('/api/dreamina/image2image', {
      cliPath: getCliPath(this.cliConfig),
      ...params,
    });
    return (data.data || data) as DreaminaCLIGenerateResult;
  }

  async multimodal2video(params: {
    prompt: string;
    image?: string;
    images?: string[];
    video?: string;
    videos?: string[];
    audio?: string;
    audios?: string[];
    ratio?: string;
    duration?: number;
    model_version?: string;
    video_resolution?: string;
    poll?: number;
  }): Promise<DreaminaCLIGenerateResult> {
    const { data } = await postJson('/api/dreamina/multimodal2video', {
      cliPath: getCliPath(this.cliConfig),
      ...params,
    });
    return (data.data || data) as DreaminaCLIGenerateResult;
  }

  async multiframe2video(params: {
    prompt?: string;
    images: string[];
    duration?: number;
    poll?: number;
  }): Promise<DreaminaCLIGenerateResult> {
    const { data } = await postJson('/api/dreamina/multiframe2video', {
      cliPath: getCliPath(this.cliConfig),
      ...params,
    });
    return (data.data || data) as DreaminaCLIGenerateResult;
  }

  async listTask(params?: {
    gen_status?: string;
    submit_id?: string;
    limit?: number;
  }): Promise<{ tasks: DreaminaCLIGenerateResult[] }> {
    const { data } = await postJson('/api/dreamina/list-task', {
      cliPath: getCliPath(this.cliConfig),
      ...params,
    });
    return { tasks: (Array.isArray(data.tasks) ? data.tasks : []) as DreaminaCLIGenerateResult[] };
  }

  async queryResult(submitId: string, nodeId?: string): Promise<DreaminaCLIQueryResult> {
    const { data } = await postJson('/api/dreamina/query-result', {
      cliPath: getCliPath(this.cliConfig),
      submit_id: submitId,
      ...(nodeId ? { nodeId } : {}),
    });
    return (data.data || data) as DreaminaCLIQueryResult;
  }

  /**
   * 轮询任务直到完成。
   * 不设绝对超时 — 只要即梦队列位置在前进就持续等待。
   * 仅当队列位置连续 N 次不变时才判定为卡死超时。
   */
  async pollUntilComplete(
    submitId: string,
    onProgress?: (status: string) => void,
    maxStuckAttempts: number = STUCK_ATTEMPTS,
    intervalMs: number = POLL_INTERVAL,
    nodeId?: string,
    hasUsableResult?: (result: DreaminaCLIQueryResult) => boolean,
  ): Promise<DreaminaCLIQueryResult> {
    let lastQueueIdx = -1;
    let stuckCount = 0;
    let totalAttempts = 0;
    let hadQueue = false;
    let successWithoutUsableResultCount = 0;
    let transientQueryErrorCount = 0;
    let lastUsableResult: DreaminaCLIQueryResult | null = null;

    while (true) {
      totalAttempts++;
      let result: DreaminaCLIQueryResult;
      try {
        result = await this.queryResult(submitId, nodeId);
        transientQueryErrorCount = 0;
      } catch (error) {
        if (lastUsableResult) return lastUsableResult;
        if (isTransientDreaminaQueryError(error) && transientQueryErrorCount < maxStuckAttempts) {
          transientQueryErrorCount++;
          onProgress?.(`querying (result retry ${transientQueryErrorCount}/${maxStuckAttempts})`);
          await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, 5000)));
          continue;
        }
        throw error;
      }
      const status = (result.gen_status || result.status || 'processing') as string;
      if (hasUsableResult?.(result)) {
        lastUsableResult = result;
      }

      // Build progress label with queue info
      const qi = result['queue_info'] as Record<string, unknown> | undefined;
      let progressLabel = status;
      if (qi && typeof qi.queue_idx === 'number') {
        hadQueue = true;
        const currentIdx = qi.queue_idx as number;
        const qlen = typeof qi.queue_length === 'number' ? qi.queue_length : '?';
        const queueStatusText = typeof qi.queue_status === 'string'
          ? qi.queue_status.toLowerCase()
          : '';
        const isActivelyGenerating =
          currentIdx === 0 || /generating|processing|running|working/.test(queueStatusText);
        progressLabel = `${status} (队列 #${currentIdx}/${qlen}，第 ${totalAttempts} 次查询)`;

        // Dynamic: queue position is moving → reset stuck counter
        if (currentIdx < lastQueueIdx || lastQueueIdx < 0) {
          stuckCount = 0;
        } else if (currentIdx === lastQueueIdx && !isActivelyGenerating) {
          stuckCount++;
        } else {
          stuckCount = 0;
        }
        lastQueueIdx = currentIdx;
      } else if (lastQueueIdx >= 0 && status !== 'querying') {
        progressLabel = `${status} (已出队列，共等待 ${totalAttempts} 次)`;
        stuckCount = 0;
      } else if (!hadQueue && status === 'querying') {
        stuckCount++;
      }

      onProgress?.(progressLabel);

      // Terminal states
      if (status === 'completed' || status === 'success' || status === 'succeeded') {
        if (hasUsableResult && !hasUsableResult(result)) {
          successWithoutUsableResultCount++;
          if (successWithoutUsableResultCount < 10) {
            onProgress?.(`success (等待素材地址 ${successWithoutUsableResultCount}/10)`);
            await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, 3000)));
            continue;
          }
        }
        return result;
      }
      if (status === 'failed' || status === 'error' || status === 'cancelled') {
        const msg = result.fail_reason || result.error || '任务失败';
        throw new Error(typeof msg === 'string' ? msg : '未知错误');
      }

      // Only timeout if stuck (no queue progress for too long)
      if (stuckCount >= maxStuckAttempts) {
        const minutes = Math.round((totalAttempts * intervalMs) / 60000);
        const detail = hadQueue
          ? `队列位置 #${lastQueueIdx} 连续 ${stuckCount} 次无变化（已等 ${minutes} 分钟）`
          : `未获取到队列信息，已等 ${minutes} 分钟`;
        throw new Error(`任务卡死：${detail}`);
      }

      // Dynamic interval: slow down when queue isn't moving
      const dynamicInterval = hadQueue && stuckCount > 10
        ? Math.min(intervalMs * 3, 30000)
        : intervalMs;
      await new Promise((resolve) => setTimeout(resolve, dynamicInterval));
    }
  }
}
