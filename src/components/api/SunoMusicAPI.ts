'use client';

import type { ProviderConfig } from '@/components/seedance/SeedanceStore';
import { buildProxyHeaders, getProxyUrl } from './APIFactory';

export interface SunoMusicParams {
  prompt: string;
  model?: string;
  duration?: number;
  style?: string;
}

export interface SunoMusicResponse {
  task_id?: string;
  audioUrl?: string;
  status?: string;
  fail_reason?: string;
}

export function createSunoMusicAPI(providerConfig: ProviderConfig) {
  const { apiUrl } = providerConfig;
  const base = apiUrl.replace(/\/+$/, '');
  const proxyUrl = getProxyUrl(providerConfig);

  async function generateMusic(params: SunoMusicParams): Promise<SunoMusicResponse> {
    const endpoint = `${base}/v1/music/generate`;
    const headers = buildProxyHeaders(providerConfig, endpoint);

    const body: Record<string, unknown> = {
      model: params.model || 'suno-v4',
      prompt: params.prompt,
      duration: params.duration ?? 30,
    };
    if (params.style) body.style = params.style;

    console.log('[Suno API] → generateMusic', {
      endpoint,
      proxyUrl,
      model: body.model,
      promptLength: params.prompt.length,
      duration: body.duration,
      hasStyle: !!params.style,
    });

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    console.log('[Suno API] ← generateMusic response status:', response.status);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[Suno API] Error response:', errText);
      throw new Error(`Suno Music error ${response.status}: ${errText.slice(0, 500)}`);
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    console.log('[Suno API] Response data:', data);

    if (typeof data.error === 'string' && data.error) {
      throw new Error(`Suno Music error: ${data.error}`);
    }

    return {
      task_id: typeof data.task_id === 'string' ? data.task_id : undefined,
      audioUrl: typeof data.audio_url === 'string' ? data.audio_url : undefined,
      status: typeof data.status === 'string' ? data.status : undefined,
    };
  }

  async function queryMusicTask(taskId: string): Promise<SunoMusicResponse> {
    const endpoint = `${base}/v1/music/query?task_id=${encodeURIComponent(taskId)}`;
    const headers = buildProxyHeaders(providerConfig, endpoint);

    console.log('[Suno API] → queryMusicTask', { taskId, endpoint, proxyUrl });

    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers,
    });

    console.log('[Suno API] ← queryMusicTask response status:', response.status);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[Suno API] Query error response:', errText);
      throw new Error(`Suno Music query error ${response.status}: ${errText.slice(0, 500)}`);
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    console.log('[Suno API] Query response data:', data);

    if (typeof data.error === 'string' && data.error) {
      throw new Error(`Suno Music query error: ${data.error}`);
    }

    return {
      task_id: taskId,
      audioUrl: typeof data.audio_url === 'string' ? data.audio_url : undefined,
      status: typeof data.status === 'string' ? data.status : undefined,
      fail_reason: typeof data.fail_reason === 'string' ? data.fail_reason : undefined,
    };
  }

  return { generateMusic, queryMusicTask };
}
