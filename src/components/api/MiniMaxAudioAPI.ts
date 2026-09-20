'use client';

import type { ProviderConfig } from '@/components/seedance/SeedanceStore';
import { buildProxyHeaders, getProxyUrl } from './APIFactory';

export interface MiniMaxTTSParams {
  model: string;
  text: string;
  voiceId?: string;
  speed?: number;
  vol?: number;
  pitch?: number;
  emotion?: string;
  sampleRate?: number;
  format?: string;
  channel?: number;
}

export interface MiniMaxTTSResponse {
  audioUrl?: string;
  audioBase64?: string;
  extraInfo?: Record<string, unknown>;
}

export interface MiniMaxVoiceDesignParams {
  prompt: string;
  previewText: string;
}

export interface MiniMaxVoiceDesignResponse {
  voiceId?: string;
  audioUrl?: string;
}

export interface MiniMaxMusicParams {
  prompt: string;
  model?: string;
  duration?: number;
  lyrics?: string;
  lyricsOptimizer?: boolean;
  isInstrumental?: boolean;
  referenceAudio?: string;
}

export interface MiniMaxMusicResponse {
  task_id?: string;
  audioUrl?: string;
  status?: string;
  fail_reason?: string;
}

// ── 音乐模型规格 ──

export interface MusicModelSpec {
  /** 支持的时长范围（秒），null 表示模型自行决定 */
  durationRange: [number, number] | null;
  /** 是否支持 duration 参数 */
  supportsDuration: boolean;
  /** 是否支持 reference_audio 参数 */
  supportsReferenceAudio: boolean;
  /** 是否支持 lyrics 参数 */
  supportsLyrics: boolean;
  /** 是否支持 is_instrumental 参数 */
  supportsInstrumental: boolean;
}

const MUSIC_MODEL_SPECS: Record<string, MusicModelSpec> = {
  'music-2.6': {
    durationRange: null,
    supportsDuration: false,
    supportsReferenceAudio: false,
    supportsLyrics: true,
    supportsInstrumental: true,
  },
  'music-2.6-free': {
    durationRange: null,
    supportsDuration: false,
    supportsReferenceAudio: false,
    supportsLyrics: true,
    supportsInstrumental: true,
  },
};

export function getMusicModelSpec(userModel: string): MusicModelSpec | null {
  return MUSIC_MODEL_SPECS[userModel] || null;
}

// ── MiniMax 音乐错误码 → 中文说明 ──

const MINIMAX_ERROR_MAP: Record<number, string> = {
  1001: '【本地配置】请求参数不合法 — 检查 model/prompt/lyrics 格式',
  1004: '【本地配置】API Key 鉴权失败，请检查密钥是否正确或已过期',
  1008: '【官方额度】账户余额不足或套餐额度已用完',
  2013: '【模型参数】参数不合法 — 当前 MiniMax 音乐生成接口只支持 music-2.6 / music-2.6-free 这类当前模型，请不要使用旧的 music-01 / music-02',
};

function formatMiniMaxError(data: Record<string, unknown>): string {
  const baseResp = data.base_resp as Record<string, unknown> | undefined;
  const code = typeof baseResp?.status_code === 'number' ? baseResp.status_code : -1;
  const msg = typeof baseResp?.status_msg === 'string' ? baseResp.status_msg : '';

  if (code > 0 && MINIMAX_ERROR_MAP[code]) {
    return `MiniMax Music error (code: ${code}): ${MINIMAX_ERROR_MAP[code]}${msg ? ` — ${msg}` : ''}`;
  }
  if (code > 0 && msg) {
    return `MiniMax Music error (code: ${code}): ${msg}`;
  }
  return `MiniMax Music error: ${JSON.stringify(baseResp || data)}`;
}

function hexAudioToObjectUrl(hex: string): string {
  const clean = hex.trim();
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
}

function audioStringToUrl(audio: string): string | undefined {
  const value = audio.trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value) || value.startsWith('blob:') || value.startsWith('data:audio/')) {
    return value;
  }
  if (/^[0-9a-f]+$/i.test(value) && value.length >= 2) {
    return hexAudioToObjectUrl(value);
  }
  return undefined;
}

export function createMiniMaxAudioAPI(providerConfig: ProviderConfig) {
  const { apiUrl } = providerConfig;
  const base = apiUrl.replace(/\/+$/, '');
  const proxyUrl = getProxyUrl(providerConfig);

  async function designVoice(params: MiniMaxVoiceDesignParams): Promise<MiniMaxVoiceDesignResponse> {
    const endpoint = `${base}/v1/voice_design`;
    const headers = buildProxyHeaders(providerConfig, endpoint);
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: params.prompt.trim(),
        preview_text: params.previewText.trim(),
      }),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`MiniMax 音色设计失败 ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
    }
    const baseResp = data.base_resp as Record<string, unknown> | undefined;
    if (baseResp && baseResp.status_code !== 0) {
      throw new Error(`MiniMax 音色设计失败: ${JSON.stringify(baseResp)}`);
    }

    const voiceId = typeof data.voice_id === 'string' ? data.voice_id.trim() : '';
    const trialAudio = typeof data.trial_audio === 'string' ? data.trial_audio.trim() : '';
    if (!voiceId) throw new Error('MiniMax 音色设计未返回 voice_id');
    return {
      voiceId,
      audioUrl: trialAudio ? hexAudioToObjectUrl(trialAudio) : undefined,
    };
  }

  async function textToSpeech(params: MiniMaxTTSParams): Promise<MiniMaxTTSResponse> {
    const endpoint = `${base}/v1/t2a_v2`;
    const headers = buildProxyHeaders(providerConfig, endpoint);

    const body = {
      model: params.model,
      text: params.text,
      stream: false,
      voice_setting: {
        voice_id: params.voiceId || 'male-qn-qingse',
        speed: params.speed ?? 1.0,
        vol: params.vol ?? 1.0,
        pitch: params.pitch ?? 0,
        ...(params.emotion ? { emotion: params.emotion } : {}),
      },
      audio_setting: {
        sample_rate: params.sampleRate ?? 32000,
        format: params.format || 'mp3',
        channel: params.channel ?? 1,
      },
    };

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`MiniMax TTS error ${response.status}: ${errText.slice(0, 500)}`);
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (data.base_resp && (data.base_resp as Record<string, unknown>).status_code !== 0) {
      throw new Error(`MiniMax TTS error: ${JSON.stringify(data.base_resp)}`);
    }

    const audioHex = typeof data.data === 'object' && data.data
      ? (data.data as Record<string, unknown>).audio as string | undefined
      : undefined;

    if (audioHex) {
      // MiniMax returns audio as hex-encoded string
      const bytes = new Uint8Array(audioHex.length / 2);
      for (let i = 0; i < audioHex.length; i += 2) {
        bytes[i / 2] = parseInt(audioHex.substring(i, i + 2), 16);
      }
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(blob);
      return {
        audioUrl,
        audioBase64: undefined,
        extraInfo: data.extra_info as Record<string, unknown> | undefined,
      };
    }

    return {
      extraInfo: (data.extra_info || data) as Record<string, unknown> | undefined,
    };
  }

  async function generateMusic(params: MiniMaxMusicParams): Promise<MiniMaxMusicResponse> {
    const endpoint = `${base}/v1/music_generation`;
    const headers = buildProxyHeaders(providerConfig, endpoint);

    const model = params.model || 'music-2.6-free';
    const spec = MUSIC_MODEL_SPECS[model] || null;

    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
    };

    // 按当前模型规格添加参数，避免发送模型不支持的字段导致 2013
    if (spec?.supportsDuration && params.duration) {
      body.duration = params.duration;
    }
    if (spec?.supportsReferenceAudio && params.referenceAudio) {
      body.reference_audio = params.referenceAudio;
    }
    if (spec?.supportsLyrics) {
      const lyrics = params.lyrics?.trim();
      if (lyrics) {
        body.lyrics = lyrics;
      } else if (params.isInstrumental) {
        body.is_instrumental = true;
      } else {
        body.lyrics_optimizer = params.lyricsOptimizer ?? true;
      }
    }

    console.log('[MiniMax API] → generateMusic', {
      endpoint,
      proxyUrl,
      model: body.model,
      promptLength: params.prompt.length,
      hasDuration: 'duration' in body,
      duration: body.duration,
      hasReferenceAudio: 'reference_audio' in body,
      hasLyrics: 'lyrics' in body,
      lyricsOptimizer: body.lyrics_optimizer,
      isInstrumental: body.is_instrumental,
    });

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    console.log('[MiniMax API] ← generateMusic response status:', response.status);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[MiniMax API] Error response:', errText);
      throw new Error(`MiniMax Music error ${response.status}: ${errText.slice(0, 500)}`);
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    console.log('[MiniMax API] Response data:', data);

    // MiniMax 统一在 base_resp 返回错误（HTTP 200 时 status_code ≠ 0 也是错误）
    if (data.base_resp && (data.base_resp as Record<string, unknown>).status_code !== 0) {
      throw new Error(formatMiniMaxError(data));
    }

    const responseData = data.data && typeof data.data === 'object'
      ? data.data as Record<string, unknown>
      : {};
    const audio = typeof responseData.audio === 'string'
      ? responseData.audio
      : typeof data.audio === 'string'
        ? data.audio
        : '';
    const taskId = typeof data.task_id === 'string' ? data.task_id : '';
    const audioUrl = audioStringToUrl(audio) || (typeof data.audio_url === 'string' ? data.audio_url : undefined);

    return {
      task_id: taskId || undefined,
      audioUrl,
      status: typeof data.status === 'string' ? data.status : undefined,
    };
  }

  async function queryMusicTask(taskId: string): Promise<MiniMaxMusicResponse> {
    const endpoint = `${base}/v1/query/music_generation?task_id=${encodeURIComponent(taskId)}`;
    const headers = buildProxyHeaders(providerConfig, endpoint);

    console.log('[MiniMax API] → queryMusicTask', { taskId, endpoint, proxyUrl });

    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers,
    });

    console.log('[MiniMax API] ← queryMusicTask response status:', response.status);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[MiniMax API] Query error response:', errText);
      throw new Error(`MiniMax Music query error ${response.status}: ${errText.slice(0, 500)}`);
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    console.log('[MiniMax API] Query response data:', data);

    if (data.base_resp && (data.base_resp as Record<string, unknown>).status_code !== 0) {
      throw new Error(formatMiniMaxError(data));
    }

    return {
      task_id: taskId,
      audioUrl: typeof data.audio_url === 'string' ? data.audio_url : undefined,
      status: typeof data.status === 'string' ? data.status : undefined,
      fail_reason: typeof data.fail_reason === 'string' ? data.fail_reason : undefined,
    };
  }

  return { designVoice, textToSpeech, generateMusic, queryMusicTask };
}
