import { useSeedanceStore } from '@/components/seedance/SeedanceStore';
import { createElevenLabsMusicAPI } from '@/components/api/ElevenLabsMusicAPI';

let streamAudioCtx: AudioContext | null = null;
let activeSource: AudioBufferSourceNode | null = null;
let streamEndCallback: (() => void) | null = null;
let streamActive = false;
let playbackSerial = 0;

export interface VoiceTtsConfig {
  apiKey: string;
  voiceId: string;
  providerId: string;
  stability: number;
  style: number;
  similarityBoost: number;
  speed: number;
}

export interface TtsPlaybackErrorEvent {
  providerId?: string;
  code?: number;
  message: string;
  rawMessage?: string;
  createdAt: number;
}

type TtsPlaybackErrorListener = (event: TtsPlaybackErrorEvent) => void;

const ttsPlaybackErrorListeners = new Set<TtsPlaybackErrorListener>();

export function onTtsPlaybackError(listener: TtsPlaybackErrorListener): () => void {
  ttsPlaybackErrorListeners.add(listener);
  return () => ttsPlaybackErrorListeners.delete(listener);
}

function emitTtsPlaybackError(event: Omit<TtsPlaybackErrorEvent, 'createdAt'>): void {
  const payload = { ...event, createdAt: Date.now() };
  ttsPlaybackErrorListeners.forEach((listener) => {
    try {
      listener(payload);
    } catch {
      // Keep TTS cleanup independent from UI notification listeners.
    }
  });
}

function readVoiceTtsParams() {
  const s = useSeedanceStore.getState().config;
  return {
    stability: s.voiceAssistantTtsStability ?? 0.35,
    style: s.voiceAssistantTtsStyle ?? 0.5,
    similarityBoost: s.voiceAssistantTtsSimilarityBoost ?? 0.75,
    speed: s.voiceAssistantTtsSpeed ?? 1.0,
  };
}

/** Resolve the globally configured TTS voice, API key, and provider. */
export function resolveVoiceTtsConfig(): VoiceTtsConfig {
  const params = readVoiceTtsParams();
  const s = useSeedanceStore.getState().config;

  // 全模态开启时强制使用 ElevenLabs 全模态
  if (s.voiceAssistantFullModalEnabled) {
    const apiKey = s.audio.providers['elevenlabs']?.apiKey?.trim() || s.elevenLabs.apiKey.trim();
    return { apiKey, voiceId: 'wOqiPOGlNVdIcEallTsU', providerId: 'elevenlabs', ...params };
  }

  // TTS 关闭 → 静音
  if (s.voiceAssistantEnabled === false || !s.voiceAssistantTtsEnabled) {
    return { apiKey: '', voiceId: '', providerId: '', ...params };
  }

  const pid = s.voiceAssistantSoundProviderId || 'elevenlabs';
  // 音色关闭时使用默认音色
  const vm = s.voiceAssistantTimbreEnabled
    ? (s.voiceAssistantSoundModel || 'wOqiPOGlNVdIcEallTsU')
    : 'wOqiPOGlNVdIcEallTsU';
  const allP = { ...s.audio.providers, ...s.audio.customProviders };
  const p = allP[pid];
  const apiKey = p?.apiKey?.trim() || s.elevenLabs.apiKey.trim();
  return { apiKey, voiceId: vm, providerId: pid, ...params };
}

export function ensureStreamAudioContext(): void {
  if (!streamAudioCtx) {
    streamAudioCtx = new AudioContext({ latencyHint: 'interactive' });
  }
  if (streamAudioCtx.state === 'suspended') {
    void streamAudioCtx.resume();
  }
}

function clearActiveTtsPlayback(): void {
  try { activeSource?.stop(0); } catch { /* noop */ }
  activeSource = null;
  streamEndCallback = null;
}

export function stopTtsPlayback(): void {
  playbackSerial += 1;
  clearActiveTtsPlayback();
}

export function stopStreamTts(): void {
  streamActive = false;
  stopTtsPlayback();
}

export function streamTtsFeed(_text: string, _apiKey: string, _voiceId?: string, _providerId?: string): void {
  streamActive = true;
}

export function streamTtsFlush(text: string, apiKey: string, voiceId?: string, onProgress?: (ratio: number) => void, providerId?: string): void {
  streamActive = true;
  void speakText(text, apiKey, voiceId, onProgress, providerId);
}

export function onStreamTtsEnd(cb: () => void): void {
  streamEndCallback = cb;
}

async function playAudioBuffer(
  arrayBuf: ArrayBuffer,
  playbackId: number,
  onProgress?: (ratio: number) => void,
): Promise<void> {
  if (!streamAudioCtx) {
    console.error('[TTS] streamAudioCtx不存在');
    return;
  }

  const audioBuf = await streamAudioCtx.decodeAudioData(arrayBuf);
  if (playbackId !== playbackSerial) return;
  console.log('[TTS] 音频解码成功, 时长:', audioBuf.duration, '秒');

  const src = streamAudioCtx.createBufferSource();
  src.buffer = audioBuf;
  src.connect(streamAudioCtx.destination);
  activeSource = src;

  // 轮询播放进度，驱动字幕同步
  const startTime = streamAudioCtx.currentTime;
  const duration = audioBuf.duration;
  let progressRaf = 0;
  const pollProgress = () => {
    const elapsed = streamAudioCtx!.currentTime - startTime;
    const ratio = Math.min(1, elapsed / duration);
    onProgress?.(ratio);
    if (ratio < 1 && activeSource === src && playbackId === playbackSerial) {
      progressRaf = requestAnimationFrame(pollProgress);
    }
  };
  progressRaf = requestAnimationFrame(pollProgress);

  await new Promise<void>((resolve) => {
    src.onended = () => {
      console.log('[TTS] 音频播放结束');
      cancelAnimationFrame(progressRaf);
      if (playbackId !== playbackSerial) {
        resolve();
        return;
      }
      onProgress?.(1);
      activeSource = null;
      streamEndCallback?.();
      streamEndCallback = null;
      streamActive = false;
      resolve();
    };
    if (playbackId !== playbackSerial) {
      resolve();
      return;
    }
    src.start();
  });
}

async function speakElevenLabs(
  text: string,
  apiKey: string,
  voiceId: string,
  voiceSettings: Pick<VoiceTtsConfig, 'stability' | 'style' | 'similarityBoost'>,
  playbackId: number,
  onProgress?: (ratio: number) => void,
): Promise<boolean> {
  console.log('[TTS] ElevenLabs API请求, voiceId:', voiceId);

  const provider = useSeedanceStore.getState().config.audio.providers.elevenlabs;
  if (provider && /api\.kie\.ai/i.test(provider.apiUrl || '')) {
    const ttsApi = createElevenLabsMusicAPI({ ...provider, apiKey });
    const result = await ttsApi.textToSpeech({
      model: 'elevenlabs/text-to-speech-turbo-2-5',
      text: text.trim(),
      voiceId: voiceId || 'Rachel',
      stability: voiceSettings.stability,
      similarityBoost: voiceSettings.similarityBoost,
      style: voiceSettings.style,
      speed: readVoiceTtsParams().speed,
    });
    if (!result.audioUrl) {
      throw new Error('Kie ElevenLabs TTS completed without an audio URL');
    }
    const audioResponse = await fetch(result.audioUrl, { cache: 'no-store' });
    if (!audioResponse.ok) {
      throw new Error(`Kie ElevenLabs audio download failed: HTTP ${audioResponse.status}`);
    }
    const arrayBuf = await audioResponse.arrayBuffer();
    if (playbackId !== playbackSerial) return false;
    await playAudioBuffer(arrayBuf, playbackId, onProgress);
    return playbackId === playbackSerial;
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text: text.trim(),
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: voiceSettings.stability,
        similarity_boost: voiceSettings.similarityBoost,
        style: voiceSettings.style,
        use_speaker_boost: true,
      },
    }),
  });

  console.log('[TTS] ElevenLabs响应状态:', res.status, res.statusText);

  if (!res.ok) {
    const errorText = await res.text().catch(() => '无法读取错误信息');
    console.error('[TTS] API错误:', res.status, errorText);
    onProgress?.(1);
    streamEndCallback?.();
    streamEndCallback = null;
    streamActive = false;
    return false;
  }

  const arrayBuf = await res.arrayBuffer();
  if (playbackId !== playbackSerial) return false;
  console.log('[TTS] 收到音频数据大小:', arrayBuf.byteLength, 'bytes');
  await playAudioBuffer(arrayBuf, playbackId, onProgress);
  return playbackId === playbackSerial;
}

async function speakMiniMax(
  text: string,
  apiKey: string,
  voiceId: string,
  speed: number,
  playbackId: number,
  onProgress?: (ratio: number) => void,
): Promise<boolean> {
  console.log('[TTS] MiniMax API请求, voiceId:', voiceId);

  const res = await fetch('/api/proxy/openai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Target-URL': 'https://api.minimaxi.com/v1/t2a_v2',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      model: 'speech-2.8-hd',
      text: text.trim(),
      stream: false,
      voice_setting: {
        voice_id: voiceId,
        speed,
        vol: 1.0,
        pitch: 0,
      },
    }),
  });

  console.log('[TTS] MiniMax响应状态:', res.status, res.statusText);

  if (!res.ok) {
    const errorText = await res.text().catch(() => '无法读取错误信息');
    console.error('[TTS] API错误:', res.status, errorText);
    emitTtsPlaybackError({
      providerId: 'minimax-audio',
      code: res.status,
      message: 'MiniMax TTS 请求失败，请在 API 配置 > 语音/音乐 中检查或切换 TTS 模型。',
      rawMessage: errorText,
    });
    onProgress?.(1);
    streamEndCallback?.();
    streamEndCallback = null;
    streamActive = false;
    return false;
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const baseResp = data.base_resp as { status_code?: number; status_msg?: string } | undefined;
  if (baseResp && baseResp.status_code !== 0) {
    console.error('[TTS] MiniMax API错误:', JSON.stringify(data).slice(0, 300));
    const rawMessage = baseResp.status_msg || JSON.stringify(data).slice(0, 300);
    const isQuotaError =
      baseResp.status_code === 2056 ||
      /Token Plan|用量上限|额度|积分|quota|limit/i.test(rawMessage);
    emitTtsPlaybackError({
      providerId: 'minimax-audio',
      code: baseResp.status_code,
      message: isQuotaError
        ? 'MiniMax TTS 额度已用完，请在 API 配置 > 语音/音乐 中切换 TTS 模型，或升级 Token Plan/购买积分。'
        : 'MiniMax TTS 返回错误，请在 API 配置 > 语音/音乐 中检查或切换 TTS 模型。',
      rawMessage,
    });
    onProgress?.(1);
    streamEndCallback?.();
    streamEndCallback = null;
    streamActive = false;
    return false;
  }

  // MiniMax returns audio as hex string in data.audio or top-level audio field
  const audioHex = typeof data.data === 'object' && data.data ? (data.data as Record<string, unknown>).audio : undefined;
  const hex = (typeof audioHex === 'string' ? audioHex : undefined) || (typeof (data as Record<string, unknown>).audio === 'string' ? (data as Record<string, unknown>).audio as string : undefined);

  if (!hex || typeof hex !== 'string') {
    console.error('[TTS] MiniMax返回数据中未找到音频:', Object.keys(data));
    onProgress?.(1);
    streamEndCallback?.();
    streamEndCallback = null;
    streamActive = false;
    return false;
  }

  // Convert hex to ArrayBuffer
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  console.log('[TTS] MiniMax音频数据大小:', bytes.byteLength, 'bytes');
  if (playbackId !== playbackSerial) return false;
  await playAudioBuffer(bytes.buffer, playbackId, onProgress);
  return playbackId === playbackSerial;
}

export async function speakText(
  text: string,
  apiKey: string,
  voiceId?: string,
  onProgress?: (ratio: number) => void,
  providerId?: string,
): Promise<boolean> {
  if (!text.trim() || !apiKey.trim()) {
    console.error('[TTS] 缺少text或apiKey');
    return false;
  }

  playbackSerial += 1;
  const playbackId = playbackSerial;
  clearActiveTtsPlayback();
  ensureStreamAudioContext();

  const vid = voiceId?.trim() || '21m00Tcm4TlvDq8ikWAM';
  const params = readVoiceTtsParams();

  try {
    if (providerId === 'minimax-audio') {
      return await speakMiniMax(text, apiKey.trim(), vid, params.speed, playbackId, onProgress);
    }
    return await speakElevenLabs(text, apiKey.trim(), vid, params, playbackId, onProgress);
  } catch (e) {
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.warn('[TTS] 播放出错:', rawMessage);
    const isKieServiceUnavailable = /Kie服务模型维护中，暂不可用/.test(rawMessage);
    emitTtsPlaybackError({
      providerId: providerId || 'elevenlabs',
      message: isKieServiceUnavailable
        ? 'Kie服务模型维护中，暂不可用'
        : /Kie ElevenLabs/i.test(rawMessage)
        ? rawMessage.replace(/^Kie ElevenLabs TTS 生成失败：?/, '')
        : '语音生成失败，请检查或切换语音模型后重试。',
      rawMessage,
    });
    onProgress?.(1);
    streamEndCallback?.();
    streamEndCallback = null;
    streamActive = false;
    return false;
  }
}
