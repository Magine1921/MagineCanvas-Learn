'use client';

import type { ProviderConfig } from '@/components/seedance/SeedanceStore';

export interface TopazEnhanceParams {
  imageUrl: string;
  mode?: string;
  upscaleFactor?: number;
  outputFormat?: 'png' | 'jpeg' | 'webp';
}

export interface TopazVideoEnhanceParams {
  videoUrl: string;
  upscaleFactor?: number;
}

export interface TopazEnhanceResult {
  status: 'success' | 'error';
  imageUrl?: string;
  videoUrl?: string;
  taskId?: string;
  creditCost?: number;
  requestedUpscaleFactor?: number;
  usedUpscaleFactor?: number;
  error?: string;
  raw?: unknown;
}

function normalizeApiUrl(apiUrl: string): string {
  const raw = apiUrl.trim();
  if (!raw) return 'https://api.kie.ai';
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, '') : `https://${raw.replace(/\/+$/, '')}`;
}

const TOPAZ_CLOUD_TIMEOUT_MS = 20 * 60_000;
const TOPAZ_IMAGE_TIMEOUT_MS = TOPAZ_CLOUD_TIMEOUT_MS;
const TOPAZ_VIDEO_TIMEOUT_MS = TOPAZ_CLOUD_TIMEOUT_MS;
const TOPAZ_SHORT_TIMEOUT_MS = 30_000;

async function postLocalTopaz(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = TOPAZ_IMAGE_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Topaz request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || json.ok === false) {
    const msg =
      typeof json.error === 'string'
        ? json.error
        : typeof json.message === 'string'
          ? json.message
          : `HTTP ${response.status}`;
    const attempts = Array.isArray(json.attempts)
      ? json.attempts
          .map((item) => {
            const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
            const factor = typeof record.factor === 'number' ? `${record.factor}x` : '';
            const taskId = typeof record.taskId === 'string' ? record.taskId : '';
            return [factor, taskId].filter(Boolean).join('/');
          })
          .filter(Boolean)
      : [];
    throw new Error(attempts.length ? `${msg}；尝试 ${attempts.join('，')}` : msg);
  }
  return json;
}

/**
 * Kie Topaz adapter.
 *
 * Browser code talks only to local Next routes. The server route handles
 * Kie Bearer auth, temporary file upload, task creation, polling, and
 * temporary download-url conversion.
 */
export function createTopazImageAPI(providerConfig: ProviderConfig) {
  const apiKey = providerConfig.apiKey.trim();
  const apiUrl = normalizeApiUrl(providerConfig.apiUrl);

  async function enhanceImage(params: TopazEnhanceParams): Promise<TopazEnhanceResult> {
    try {
      const json = await postLocalTopaz('/api/topaz/enhance', {
        apiKey,
        apiUrl,
        kind: 'image',
        inputUrl: params.imageUrl,
        upscaleFactor: params.upscaleFactor ?? 2,
      }, TOPAZ_IMAGE_TIMEOUT_MS);
      return {
        status: 'success',
        imageUrl: typeof json.outputUrl === 'string' ? json.outputUrl : undefined,
        taskId: typeof json.taskId === 'string' ? json.taskId : undefined,
        creditCost: typeof json.creditCost === 'number' ? json.creditCost : undefined,
        requestedUpscaleFactor:
          typeof json.requestedUpscaleFactor === 'number' ? json.requestedUpscaleFactor : undefined,
        usedUpscaleFactor: typeof json.usedUpscaleFactor === 'number' ? json.usedUpscaleFactor : undefined,
        raw: json.raw ?? json,
      };
    } catch (err) {
      return { status: 'error', error: err instanceof Error ? err.message : 'Unknown Topaz error' };
    }
  }

  async function enhanceVideo(params: TopazVideoEnhanceParams): Promise<TopazEnhanceResult> {
    try {
      const json = await postLocalTopaz('/api/topaz/enhance', {
        apiKey,
        apiUrl,
        kind: 'video',
        inputUrl: params.videoUrl,
        upscaleFactor: params.upscaleFactor ?? 2,
      }, TOPAZ_VIDEO_TIMEOUT_MS);
      return {
        status: 'success',
        videoUrl: typeof json.outputUrl === 'string' ? json.outputUrl : undefined,
        taskId: typeof json.taskId === 'string' ? json.taskId : undefined,
        creditCost: typeof json.creditCost === 'number' ? json.creditCost : undefined,
        requestedUpscaleFactor:
          typeof json.requestedUpscaleFactor === 'number' ? json.requestedUpscaleFactor : undefined,
        usedUpscaleFactor: typeof json.usedUpscaleFactor === 'number' ? json.usedUpscaleFactor : undefined,
        raw: json.raw ?? json,
      };
    } catch (err) {
      return { status: 'error', error: err instanceof Error ? err.message : 'Unknown Topaz error' };
    }
  }

  async function getCredits(): Promise<{ available: number; total: number } | null> {
    try {
      const json = await postLocalTopaz('/api/topaz/credit', { apiKey, apiUrl }, TOPAZ_SHORT_TIMEOUT_MS);
      const credits = typeof json.credits === 'number' ? json.credits : 0;
      return { available: credits, total: credits };
    } catch {
      return null;
    }
  }

  async function getDownloadUrl(url: string): Promise<string> {
    const json = await postLocalTopaz('/api/topaz/download-url', { apiKey, apiUrl, url }, TOPAZ_SHORT_TIMEOUT_MS);
    const downloadUrl = typeof json.downloadUrl === 'string' ? json.downloadUrl.trim() : '';
    if (!downloadUrl) throw new Error('Topaz download URL response is empty');
    return downloadUrl;
  }

  return { enhanceImage, enhanceVideo, getCredits, getDownloadUrl };
}
