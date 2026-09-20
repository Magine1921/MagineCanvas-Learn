'use client';

import type { ProviderConfig } from '@/components/seedance/SeedanceStore';
import { buildProxyHeaders, getProxyUrl } from './APIFactory';
import { customProviderFetchJson } from '@/lib/custom-provider-request';

export interface ElevenLabsMusicParams {
  prompt: string;
  model?: string;
  duration?: number;
}

export interface ElevenLabsMusicResponse {
  task_id?: string;
  audioUrl?: string;
  status?: string;
  fail_reason?: string;
}

export interface ElevenLabsTTSParams {
  model: string;
  text: string;
  voiceId: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
}

export interface ElevenLabsTTSResponse {
  audioUrl?: string;
}

const KIE_TTS_DEFAULT_MODEL = 'elevenlabs/text-to-speech-turbo-2-5';
const KIE_TTS_MULTILINGUAL_MODEL = 'elevenlabs/text-to-speech-multilingual-v2';

function normalizeKieTtsModel(model: string): string {
  return /multilingual/i.test(model)
    ? KIE_TTS_MULTILINGUAL_MODEL
    : KIE_TTS_DEFAULT_MODEL;
}

function normalizeKieTtsVoice(voiceId: string): string {
  const voice = voiceId.trim();
  // Kie Market expects a voice name, while direct ElevenLabs uses voice IDs.
  if (!voice || /^[A-Za-z0-9_-]{16,}$/.test(voice)) return 'Rachel';
  return voice;
}

function formatKieTtsFailure(message: string, code?: string): string {
  const detail = String(code ?? '') === '500' || /internal error|try again later/i.test(message)
    ? 'Kie服务模型维护中，暂不可用'
    : message;
  return code ? `${detail}（错误码 ${code}）` : detail;
}

function extractResultUrls(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    if (/^https?:\/\//i.test(text)) return [text];
    try {
      return extractResultUrls(JSON.parse(text));
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap(extractResultUrls);
  if (!value || typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  const preferredKeys = ['resultUrls', 'audioUrl', 'audio_url', 'url'];
  const preferred = preferredKeys.flatMap((key) => extractResultUrls(record[key]));
  if (preferred.length > 0) return preferred;
  return Object.values(record).flatMap(extractResultUrls);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function createElevenLabsMusicAPI(providerConfig: ProviderConfig) {
  const { apiUrl } = providerConfig;
  const base = apiUrl.replace(/\/+$/, '');
  const proxyUrl = getProxyUrl(providerConfig);

  async function generateMusic(params: ElevenLabsMusicParams): Promise<ElevenLabsMusicResponse> {
    const endpoint = `${base}/v1/music/generate`;
    const headers = buildProxyHeaders(providerConfig, endpoint);

    const body: Record<string, unknown> = {
      model: params.model || 'eleven-music-v1',
      prompt: params.prompt,
      duration_seconds: params.duration ?? 30,
    };

    console.log('[ElevenLabs API] → generateMusic', {
      endpoint,
      proxyUrl,
      model: body.model,
      promptLength: params.prompt.length,
      durationSeconds: body.duration_seconds,
    });

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    console.log('[ElevenLabs API] ← generateMusic response status:', response.status);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[ElevenLabs API] Error response:', errText);
      throw new Error(`ElevenLabs Music error ${response.status}: ${errText.slice(0, 500)}`);
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    console.log('[ElevenLabs API] Response data:', data);

    if (typeof data.error === 'string' && data.error) {
      throw new Error(`ElevenLabs Music error: ${data.error}`);
    }

    return {
      task_id: typeof data.task_id === 'string' ? data.task_id : undefined,
      audioUrl: typeof data.audio_url === 'string' ? data.audio_url : undefined,
      status: typeof data.status === 'string' ? data.status : undefined,
    };
  }

  async function queryMusicTask(taskId: string): Promise<ElevenLabsMusicResponse> {
    const endpoint = `${base}/v1/music/query?task_id=${encodeURIComponent(taskId)}`;
    const headers = buildProxyHeaders(providerConfig, endpoint);

    console.log('[ElevenLabs API] → queryMusicTask', { taskId, endpoint, proxyUrl });

    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers,
    });

    console.log('[ElevenLabs API] ← queryMusicTask response status:', response.status);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[ElevenLabs API] Query error response:', errText);
      throw new Error(`ElevenLabs Music query error ${response.status}: ${errText.slice(0, 500)}`);
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    console.log('[ElevenLabs API] Query response data:', data);

    if (typeof data.error === 'string' && data.error) {
      throw new Error(`ElevenLabs Music query error: ${data.error}`);
    }

    return {
      task_id: taskId,
      audioUrl: typeof data.audio_url === 'string' ? data.audio_url : undefined,
      status: typeof data.status === 'string' ? data.status : undefined,
      fail_reason: typeof data.fail_reason === 'string' ? data.fail_reason : undefined,
    };
  }

  async function textToSpeech(params: ElevenLabsTTSParams): Promise<ElevenLabsTTSResponse> {
    if (/api\.kie\.ai/i.test(base)) {
      const submit = await customProviderFetchJson(providerConfig, {
        targetUrl: `${base}/api/v1/jobs/createTask`,
        method: 'POST',
        body: {
          model: normalizeKieTtsModel(params.model),
          callBackUrl: 'https://your-domain.com/api/callback',
          input: {
            text: params.text,
            voice: normalizeKieTtsVoice(params.voiceId),
            stability: params.stability ?? 0.5,
            similarity_boost: params.similarityBoost ?? 0.75,
            style: params.style ?? 0,
            speed: params.speed ?? 1,
            timestamps: false,
            previous_text: '',
            next_text: '',
            language_code: '',
          },
        },
      });

      const submitData = submit.data as {
        code?: number;
        msg?: string;
        data?: { taskId?: string };
      };
      const taskId = submitData.data?.taskId;
      if (!submit.ok || !taskId) {
        throw new Error(
          `Kie ElevenLabs TTS submit failed (${submit.status}): ${
            submitData.msg || submit.rawText.slice(0, 500)
          }`,
        );
      }

      for (let attempt = 0; attempt < 300; attempt += 1) {
        if (attempt > 0) await wait(2_000);
        const query = await customProviderFetchJson(providerConfig, {
          targetUrl: `${base}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
          method: 'GET',
          omitContentType: true,
        });
        const queryData = query.data as {
          msg?: string;
          data?: {
            state?: string;
            resultJson?: unknown;
            failCode?: string;
            failMsg?: string;
          };
        };
        if (!query.ok) {
          throw new Error(
            `Kie ElevenLabs TTS query failed (${query.status}): ${query.rawText.slice(0, 500)}`,
          );
        }

        const state = queryData.data?.state;
        if (state === 'success') {
          const [audioUrl] = extractResultUrls(queryData.data?.resultJson);
          if (!audioUrl) throw new Error('Kie ElevenLabs TTS completed without an audio URL');
          return { audioUrl };
        }
        if (state === 'fail') {
          const failureMessage = queryData.data?.failMsg || queryData.msg || 'unknown error';
          throw new Error(
            `Kie ElevenLabs TTS 生成失败：${formatKieTtsFailure(
              failureMessage,
              queryData.data?.failCode,
            )}（任务 ${taskId}）`,
          );
        }
      }

      throw new Error('Kie ElevenLabs TTS timed out after 10 minutes');
    }

    const endpoint = `${base}/v1/text-to-speech/${encodeURIComponent(params.voiceId)}`;
    const headers = buildProxyHeaders(providerConfig, endpoint);

    const body: Record<string, unknown> = {
      text: params.text,
      model_id: params.model,
      voice_settings: {
        stability: params.stability ?? 0.5,
        similarity_boost: params.similarityBoost ?? 0.75,
      },
    };

    console.log('[ElevenLabs TTS] → textToSpeech', {
      endpoint,
      proxyUrl,
      model: body.model_id,
      voiceId: params.voiceId,
      textLength: params.text.length,
    });

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    console.log('[ElevenLabs TTS] ← response status:', response.status);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[ElevenLabs TTS] Error response:', errText);
      throw new Error(`ElevenLabs TTS error ${response.status}: ${errText.slice(0, 500)}`);
    }

    // ElevenLabs returns raw audio bytes
    const arrayBuf = await response.arrayBuffer();
    if (arrayBuf.byteLength === 0) {
      throw new Error('ElevenLabs TTS error: 返回空音频');
    }

    const blob = new Blob([arrayBuf], { type: 'audio/mpeg' });
    const audioUrl = URL.createObjectURL(blob);
    return { audioUrl };
  }

  return { generateMusic, queryMusicTask, textToSpeech };
}
