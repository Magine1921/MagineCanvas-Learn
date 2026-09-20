'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useSeedanceStore } from '@/components/seedance/SeedanceStore';
import { getUserName } from '@/lib/user-profile-store';
import { getWorkStyleContextForPrompt } from '@/lib/canvas-work-style';
import { streamLlmText } from '@/lib/invoke-llm-text';
import { resolveGeminiModelId } from '@/lib/llm-text-provider';
import { estimateLlmTokens } from '@/lib/ark-token-estimate';
import { streamClaudeTurn } from '@/lib/claude-agent-stream';
import type { ClaudeAgentEvent } from '@/lib/claude-agent-stream';
import { speakText, stopTtsPlayback, stopStreamTts, ensureStreamAudioContext, onTtsPlaybackError } from '@/lib/elevenlabs/ttsPlayback';
import { playVoiceAssistantClickSound } from '@/lib/voiceAssistantClickSound';
import { useVoiceAssistantActivityStore } from './voice-assistant-activity-store';

function cleanSubtitleText(text: string): string {
  return text
    .replace(/[^一-鿿㐀-䶿a-zA-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resample Float32Array from source sample rate to target. */
function resampleF32(input: Float32Array, rateIn: number, rateOut: number): Float32Array {
  if (rateIn === rateOut) return new Float32Array(input);
  const ratio = rateIn / rateOut;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcIdx - i0;
    out[i] = input[i0]! * (1 - frac) + input[i1]! * frac;
  }
  return out;
}

/** Float32 to 16-bit PCM ArrayBuffer. */
function f32ToPcm16(floats: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(floats.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < floats.length; i++) {
    const s = Math.max(-1, Math.min(1, floats[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buf;
}

function pcmVadLevel(input: Float32Array): number {
  if (input.length === 0) return 0;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.abs(input[i]!);
    peak = Math.max(peak, sample);
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / input.length);
  return Math.max(rms * 420, peak * 140);
}

/** Encode raw 16-bit mono PCM into a WAV blob. */
function encodePcmWav(pcmBuf: ArrayBuffer, sampleRate: number): Blob {
  const dataLen = pcmBuf.byteLength;
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, dataLen, true);
  const combined = new Uint8Array(44 + dataLen);
  combined.set(new Uint8Array(header), 0);
  combined.set(new Uint8Array(pcmBuf), 44);
  return new Blob([combined], { type: 'audio/wav' });
}

export type VoiceChatMsg = { role: 'user' | 'assistant'; content: string };
type VoiceDiagEntry = {
  at: string;
  event: string;
  data?: unknown;
};

const VOICE_DIAG_LIMIT = 260;

function clipVoiceDiagText(text: string, max = 2400): string {
  return text.length > max ? `${text.slice(0, max)}...[truncated ${text.length - max} chars]` : text;
}

function serializeVoiceDiagData(data: unknown): unknown {
  if (data instanceof Error) {
    return { name: data.name, message: data.message, stack: data.stack };
  }
  if (typeof data === 'string') return clipVoiceDiagText(data);
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return clipVoiceDiagText(String(data));
  }
}

function getVoiceSystemPrompt(): string {
  const N = getUserName();
  const styleHint = getWorkStyleContextForPrompt();
  const styleLine = styleHint
    ? `用户画布习惯（摘要）：${styleHint.split('\n').find((l) => l.startsWith('- 常用')) || '已记录偏好'}。说「像上次一样」可复现套路。`
    : '';
  return `你是 Magine Canvas 里的语音助手，${N}的工作搭档。` +
  '铁律：每次回复不超过40个字，1-2句口语，保留自然标点（逗号、问号）。' +
  '禁止：长铺垫、列表、客服腔、机械复述。像同事随口回一句。' +
  '例如：「搞定了。」「已经删了，你看下。」「这个我做不到，权限不够。」' +
  `做不到的事就直说，可以带点吐槽感，比如「这个软件接口封死了，你得手动来，${N}」。` +
  `${N}正在用 MagineCanvas 创作，你是搭档不是客服。` +
  (styleLine ? `\n${styleLine}` : '');
}

/** 语音模式：控制输出长度，确保语音口语简短 */
const VOICE_LLM_MAX_TOKENS = 128;
/** 参与 LLM 的最近轮次（仅压缩 prompt，界面仍保留完整气泡） */
const VOICE_LLM_HISTORY_MAX_MESSAGES = 6;

const DEFAULT_LLM_MODEL = 'gpt-5-5';
const POST_TTS_MIC_COOLDOWN_MS = 1000;
const STT_RESTART_DELAY_MS = 800;
const INVALID_STT_RESTART_DELAY_MS = 1500;
const MIN_STT_AUDIO_BYTES = 48000;
const STT_FILLER_WORDS = new Set(['嗯', '呃', '额', '啊', '哦', '噢', '唉', '诶', '哎', '喂']);

function normalizeSttTranscript(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function getSemanticSttText(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, '').trim();
}

function isUsableSttTranscript(text: string): boolean {
  const normalized = normalizeSttTranscript(text);
  if (!normalized) return false;
  if (/^[\s\p{P}\p{S}]+$/u.test(normalized)) return false;

  const semantic = getSemanticSttText(normalized);
  if (!semantic) return false;
  if (STT_FILLER_WORDS.has(semantic)) return false;

  return true;
}

export type AgentSink = (text: string) => void;
export type VoiceSubtitleMode = 'normal' | 'thinking';

export type VoiceAssistantContextValue = {
  open: boolean;
  setOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  closePanel: () => void;
  ttsOn: boolean;
  setTtsOn: (next: boolean | ((prev: boolean) => boolean)) => void;
  messages: VoiceChatMsg[];
  liveTranscript: string;
  listening: boolean;
  processing: boolean;
  error: string | null;
  elSessionActive: boolean;
  elConnecting: boolean;
  canUseElevenLabs: boolean;
  useElevenLabsUi: boolean;
  micBusy: boolean;
  micLive: boolean;
  waveActive: boolean;
  subtitleText: string;
  subtitleMode: VoiceSubtitleMode;
  ttsNotice: string;
  /** 播完语音后与「说完」对齐：1 显示字幕，0 隐藏 */
  subtitlePlaybackOpacity: number;
  /** 当前 TTS 已朗读到的字符数，用于字幕逐字同步 */
  ttsRevealChars: number;
  audioLevelRef: RefObject<number>;
  scrollRef: RefObject<HTMLDivElement | null>;
  toggleListen: () => void;
  /** Agent 注册语音接收端：设置后语音转录结果直接喂给 Agent，不再走语音 LLM */
  setAgentSink: (sink: AgentSink) => void;
  clearAgentSink: () => void;
  /** Agent 推送响应文本到语音助手字幕 */
  pushAgentSubtitle: (text: string) => void;
  /** Agent 流式输出期间实时更新字幕（不进 messages） */
  setLiveSubtitle: (text: string, mode?: VoiceSubtitleMode) => void;
  /** Agent TTS 播放进度回调，ratio 0-1，驱动字幕逐字同步 */
  setAgentTtsProgress: (ratio: number) => void;
  /** TTS 实际播放结束后调用：清除预估计时器，自动开启下一轮录音 */
  notifyAgentVoiceEnded: () => void;
  /** 直接在桌面输出语音助手诊断 txt */
};

export const VoiceAssistantContext = createContext<VoiceAssistantContextValue | null>(null);

export function useVoiceAssistant(): VoiceAssistantContextValue {
  const ctx = useContext(VoiceAssistantContext);
  if (!ctx) {
    throw new Error('useVoiceAssistant must be used within VoiceAssistantProvider');
  }
  return ctx;
}

export function VoiceAssistantProvider({ children }: { children: ReactNode }) {
  const { config, addUsedTokens } = useSeedanceStore();
  const voiceAssistantEnabled = config.voiceAssistantEnabled !== false;
  const [open, setOpen] = useState(false);
  const [ttsOn, setTtsOn] = useState(true);
  const [messages, setMessages] = useState<VoiceChatMsg[]>([]);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elSessionActive, setElSessionActive] = useState(false);
  const [elConnecting, setElConnecting] = useState(false);
  const [agentVoiceBusy, setAgentVoiceBusy] = useState(false);
  const [continuousMode, setContinuousMode] = useState(false);
  const continuousModeRef = useRef(false);
  const voiceGreetedRef = useRef(false);
  const autoStartAttemptedRef = useRef(false);
  const [liveSubtitle, setLiveSubtitle] = useState('');
  const [liveSubtitleMode, setLiveSubtitleMode] = useState<VoiceSubtitleMode>('normal');
  const [ttsNotice, setTtsNotice] = useState('');
  const [ttsRevealChars, setTtsRevealChars] = useState(0);
  const ttsTextRef = useRef('');
  const agentVoiceTimerRef = useRef<number | null>(null);
  const postPlaybackFadeTimerRef = useRef<number | null>(null);
  const ttsNoticeTimerRef = useRef<number | null>(null);
  const [subtitlePlaybackOpacity, setSubtitlePlaybackOpacity] = useState(1);

  const messagesRef = useRef<VoiceChatMsg[]>([]);
  const liveTranscriptRef = useRef('');
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sttChunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<number | null>(null);
  const silenceRafRef = useRef<number | null>(null);
  const sttRestartTimerRef = useRef<number | null>(null);
  const sttCooldownUntilRef = useRef(0);
  const agentVoiceBusyRef = useRef(agentVoiceBusy);
  const ttsOnRef = useRef(ttsOn);
  const micLevelRef = useRef(0);
  const audioLevelRef = useRef(0);
  const voiceDiagRef = useRef<VoiceDiagEntry[]>([]);
  const voiceAssistantEnabledRef = useRef(voiceAssistantEnabled);
  voiceAssistantEnabledRef.current = voiceAssistantEnabled;

  const agentSinkRef = useRef<AgentSink | null>(null);
  const startSttRecordingRef = useRef<(() => void) | null>(null);

  // ---- 打断（barge-in）监控 ----
  const bargeInMonitorRef = useRef<{ stop: () => void } | null>(null);
  const ttsPlaybackSerialRef = useRef(0);

  useEffect(() => { continuousModeRef.current = continuousMode; }, [continuousMode]);
  useEffect(() => { agentVoiceBusyRef.current = agentVoiceBusy; }, [agentVoiceBusy]);

  const appendVoiceDiag = useCallback((event: string, data?: unknown) => {
    voiceDiagRef.current.push({
      at: new Date().toISOString(),
      event,
      data: data === undefined ? undefined : serializeVoiceDiagData(data),
    });
    if (voiceDiagRef.current.length > VOICE_DIAG_LIMIT) {
      voiceDiagRef.current.splice(0, voiceDiagRef.current.length - VOICE_DIAG_LIMIT);
    }
  }, []);

  const scheduleSttRestart = useCallback((delayMs = STT_RESTART_DELAY_MS) => {
    if (!voiceAssistantEnabledRef.current) return;
    appendVoiceDiag('stt.restart.scheduled', { delayMs });
    if (sttRestartTimerRef.current !== null) {
      window.clearTimeout(sttRestartTimerRef.current);
    }
    sttRestartTimerRef.current = window.setTimeout(() => {
      sttRestartTimerRef.current = null;
      appendVoiceDiag('stt.restart.timer.fire', {
        continuousMode: continuousModeRef.current,
        agentVoiceBusy: agentVoiceBusyRef.current,
      });
      if (continuousModeRef.current && !agentVoiceBusyRef.current) {
        startSttRecordingRef.current?.();
      }
    }, delayMs);
  }, [appendVoiceDiag]);

  const setAgentSink = useCallback((sink: AgentSink) => {
    agentSinkRef.current = sink;
  }, []);

  const clearAgentSink = useCallback(() => {
    agentSinkRef.current = null;
  }, []);

  const stopBargeInMonitor = useCallback(() => {
    bargeInMonitorRef.current?.stop();
    bargeInMonitorRef.current = null;
  }, []);

  /** TTS 播放期间持续监听麦克风，检测到用户说话则打断 TTS 并切回收音 */
  const startBargeInMonitor = useCallback(async () => {
    if (!voiceAssistantEnabledRef.current) return;
    stopBargeInMonitor();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let active = true;

      const processor = audioCtx.createScriptProcessor(1024, 1, 1);
      let latestPcmLevel = 0;
      let latestPcmLevelAt = 0;
      processor.onaudioprocess = (e) => {
        if (!active) return;
        const input = e.inputBuffer.getChannelData(0);
        const level = pcmVadLevel(input);
        latestPcmLevel = Math.max(latestPcmLevel * 0.82, level);
        latestPcmLevelAt = performance.now();
      };
      source.connect(processor);
      const muteGain = audioCtx.createGain();
      muteGain.gain.value = 0;
      processor.connect(muteGain);
      muteGain.connect(audioCtx.destination);

      const startedAt = performance.now();
      const WARMUP_MS = 500;
      const MIN_SPEECH_LEVEL = 14;
      const SPEECH_OVER_FLOOR = 7;
      const SPEECH_FRAMES_NEEDED = 3;
      let speechFrames = 0;
      let noiseFloor = 0;
      let floorSamples = 0;

      const check = () => {
        if (!active) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]!;
        const spectrumAvg = sum / dataArray.length;
        const now = performance.now();
        const pcmLevel = now - latestPcmLevelAt < 350 ? latestPcmLevel : 0;
        const avg = Math.max(spectrumAvg, pcmLevel);

        if (floorSamples < 12) {
          noiseFloor = floorSamples === 0 ? avg : noiseFloor * 0.85 + avg * 0.15;
          floorSamples += 1;
        } else if (avg < Math.max(MIN_SPEECH_LEVEL, noiseFloor + SPEECH_OVER_FLOOR)) {
          noiseFloor = noiseFloor * 0.96 + avg * 0.04;
        }

        const speechGate = Math.max(MIN_SPEECH_LEVEL, noiseFloor + SPEECH_OVER_FLOOR);
        if (now - startedAt > WARMUP_MS && avg > speechGate) {
          speechFrames++;
          if (speechFrames >= SPEECH_FRAMES_NEEDED) {
            appendVoiceDiag('barge.detected', {
              avg,
              spectrumAvg,
              pcmLevel,
              speechGate,
              noiseFloor,
            });
            ttsPlaybackSerialRef.current += 1;
            stopBargeInMonitor();
            try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
            stopTtsPlayback();
            stopStreamTts();
            if (agentVoiceTimerRef.current !== null) {
              clearTimeout(agentVoiceTimerRef.current);
              agentVoiceTimerRef.current = null;
            }
            if (postPlaybackFadeTimerRef.current !== null) {
              clearTimeout(postPlaybackFadeTimerRef.current);
              postPlaybackFadeTimerRef.current = null;
            };
            setAgentVoiceBusy(false);
            setSubtitlePlaybackOpacity(0);
            setLiveSubtitle('');
            idleTimerResetRef.current?.();
            sttCooldownUntilRef.current = 0;
            startSttRecordingRef.current?.();
            return;
          }
        } else {
          speechFrames = Math.max(0, speechFrames - 1);
        }
      };

      const intervalId = window.setInterval(check, 100);
      // 首帧立即检测，不等待 100ms
      check();

      bargeInMonitorRef.current = {
        stop: () => {
          active = false;
          clearInterval(intervalId);
          try { source.disconnect(); } catch { /* noop */ }
          try { processor.disconnect(); } catch { /* noop */ }
          try { muteGain.disconnect(); } catch { /* noop */ }
          try { audioCtx.close(); } catch { /* noop */ }
          stream.getTracks().forEach((t) => t.stop());
        },
      };
      appendVoiceDiag('barge.monitor.started');
    } catch (error) {
      appendVoiceDiag('barge.monitor.failed', error);
    }
  }, [appendVoiceDiag, stopBargeInMonitor]);

  const pushAgentSubtitle = useCallback((text: string) => {
    if (!voiceAssistantEnabledRef.current) return;
    const t = text.trim();
    if (!t) return;
    appendVoiceDiag('agent.subtitle.push', { textLength: t.length });
    setLiveSubtitle(''); // 清除流式残留，让 subtitleText 走 messages 取完整文本
    ttsPlaybackSerialRef.current += 1;
    ttsTextRef.current = t;
    setTtsRevealChars(0);
    clearPostPlaybackFadeTimer();
    setSubtitlePlaybackOpacity(1);
    setMessages((prev) => [...prev, { role: 'assistant', content: t }]);
    setAgentVoiceBusy(true);
    // 启动打断监控：TTS 播放期间持续监听麦克风，检测到用户说话则自动打断
    void startBargeInMonitor();
    // 兜底定时器：时长按字数估算，万一 TTS 失败 / notifyAgentVoiceEnded 未触发则自动恢复
    if (agentVoiceTimerRef.current !== null) clearTimeout(agentVoiceTimerRef.current);
    agentVoiceTimerRef.current = window.setTimeout(() => {
      sttCooldownUntilRef.current = performance.now() + POST_TTS_MIC_COOLDOWN_MS;
      setAgentVoiceBusy(false);
      agentVoiceTimerRef.current = null;
      setSubtitlePlaybackOpacity(0);
      setTimeout(() => {
        setLiveSubtitle('');
        if (continuousModeRef.current) {
          idleTimerResetRef.current?.();
          startSttRecordingRef.current?.();
        }
      }, 420);
    }, Math.max(60000, t.length * 400));
  }, [appendVoiceDiag, startBargeInMonitor]);

  // Agent 流式输出期间实时更新字幕
  const setLiveSubtitleCb = useCallback((text: string, mode: VoiceSubtitleMode = 'normal') => {
    if (!voiceAssistantEnabledRef.current) return;
    const next = text.trim();
    setLiveSubtitle(next);
    setLiveSubtitleMode(next ? mode : 'normal');
  }, []);

  // TTS 错误提示：让波形 UI 能显示额度/模型异常。
  useEffect(() => {
    const unsubscribe = onTtsPlaybackError((event) => {
      const message = event.message.trim();
      if (!message) return;
      setTtsNotice(message);
      setSubtitlePlaybackOpacity(1);
      setLiveSubtitleCb(message, 'normal');
      if (ttsNoticeTimerRef.current !== null) {
        clearTimeout(ttsNoticeTimerRef.current);
      }
      ttsNoticeTimerRef.current = window.setTimeout(() => {
        setTtsNotice((current) => (current === message ? '' : current));
        ttsNoticeTimerRef.current = null;
      }, 9000);
    });

    return () => {
      unsubscribe();
      if (ttsNoticeTimerRef.current !== null) {
        clearTimeout(ttsNoticeTimerRef.current);
        ttsNoticeTimerRef.current = null;
      }
    };
  }, [setLiveSubtitleCb]);

  // Agent TTS 播放进度 → 驱动字幕逐字同步
  const setAgentTtsProgress = useCallback((ratio: number) => {
    if (!voiceAssistantEnabledRef.current) return;
    setTtsRevealChars(Math.floor(ttsTextRef.current.length * ratio));
  }, []);

  const clearPostPlaybackFadeTimer = useCallback(() => {
    if (postPlaybackFadeTimerRef.current !== null) {
      clearTimeout(postPlaybackFadeTimerRef.current);
      postPlaybackFadeTimerRef.current = null;
    }
  }, []);

  // TTS 实际播完时由 Agent 组件调用，以真实音频结束时刻为准
  const notifyAgentVoiceEnded = useCallback(() => {
    if (!voiceAssistantEnabledRef.current) return;
    appendVoiceDiag('agent.voice.ended', {
      continuousMode: continuousModeRef.current,
    });
    stopBargeInMonitor();
    sttCooldownUntilRef.current = performance.now() + POST_TTS_MIC_COOLDOWN_MS;
    if (agentVoiceTimerRef.current !== null) {
      clearTimeout(agentVoiceTimerRef.current);
      agentVoiceTimerRef.current = null;
    }
    setAgentVoiceBusy(false);
    setLiveSubtitle('');
    // 字幕停留 1.5s 再淡出，之后开始收音
    clearPostPlaybackFadeTimer();
    postPlaybackFadeTimerRef.current = window.setTimeout(() => {
      setSubtitlePlaybackOpacity(0);
      setTimeout(() => {
        if (continuousModeRef.current) {
          idleTimerResetRef.current?.();
          startSttRecordingRef.current?.();
        }
      }, 420);
    }, 1500);
  }, [appendVoiceDiag, clearPostPlaybackFadeTimer, stopBargeInMonitor]);

  const canUseElevenLabs = config.elevenLabs.apiKey.trim().length > 0;

  /** Resolve TTS config from the selected voice assistant sound provider */
  function resolveVoiceTtsConfig(): { apiKey: string; voiceId: string; providerId: string } {
    const providerId = config.voiceAssistantSoundProviderId || 'elevenlabs';
    const voiceModel = config.voiceAssistantSoundModel || 'wOqiPOGlNVdIcEallTsU';
    const allProviders = { ...config.audio.providers, ...config.audio.customProviders };
    const provider = allProviders[providerId];
    const apiKey = provider?.apiKey?.trim() || config.elevenLabs.apiKey.trim();
    return { apiKey, voiceId: voiceModel, providerId };
  }

  useEffect(() => {
    ttsOnRef.current = ttsOn;
  }, [ttsOn]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    liveTranscriptRef.current = liveTranscript;
  }, [liveTranscript]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, liveTranscript, processing]);

  useEffect(() => {
    let id = 0;
    const loop = () => {
      let v = 0;
      v = Math.min(1, Math.max(v, micLevelRef.current * 1.15));
      micLevelRef.current *= 0.9;
      if (processing && !elSessionActive) {
        v = Math.max(v, 0.1 + 0.06 * Math.sin(performance.now() / 320));
      }
      if (listening && !canUseElevenLabs) {
        v = Math.max(v, 0.08 + 0.05 * Math.sin(performance.now() / 180) + 0.04 * Math.sin(performance.now() / 73));
      }
      audioLevelRef.current = Math.min(1, v);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [processing, listening, elSessionActive, canUseElevenLabs]);

  useEffect(
    () => () => {
      clearPostPlaybackFadeTimer();
    },
    [clearPostPlaybackFadeTimer]
  );

  const fallbackSpeak = useCallback((text: string, playbackSerial = ttsPlaybackSerialRef.current) => {
    if (!voiceAssistantEnabledRef.current) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.trim());
    u.lang = 'zh-CN';
    u.rate = 1.02;
    u.onboundary = (ev: SpeechSynthesisEvent & { charIndex?: number; charLength?: number }) => {
      if (typeof ev.charIndex === 'number') {
        setTtsRevealChars(ev.charIndex + (ev.charLength ?? 0));
      }
    };
    u.onend = () => {
      if (ttsPlaybackSerialRef.current !== playbackSerial) return;
      setTtsRevealChars(text.trim().length);
      notifyAgentVoiceEnded();
    };
    window.speechSynthesis.speak(u);
  }, [notifyAgentVoiceEnded]);

  const speak = useCallback(
    (text: string) => {
      if (!voiceAssistantEnabledRef.current) return;
      clearPostPlaybackFadeTimer();
      setSubtitlePlaybackOpacity(1);
      setTtsRevealChars(0);
      if (!ttsOn || typeof window === 'undefined' || !text.trim()) {
        if (continuousModeRef.current) scheduleSttRestart(STT_RESTART_DELAY_MS);
        return;
      }

      const playbackSerial = ttsPlaybackSerialRef.current + 1;
      ttsPlaybackSerialRef.current = playbackSerial;
      ttsTextRef.current = text.trim();
      setAgentVoiceBusy(true);
      void startBargeInMonitor();

      // 优先使用配置的 TTS 引擎，不可用时回退到浏览器内置语音合成
      const s = useSeedanceStore.getState().config;
      const pid = s.voiceAssistantSoundProviderId || 'elevenlabs';
      const vm = s.voiceAssistantSoundModel || 'wOqiPOGlNVdIcEallTsU';
      const allP = { ...s.audio.providers, ...s.audio.customProviders };
      const p = allP[pid];
      const apiKey = p?.apiKey?.trim() || s.elevenLabs.apiKey.trim();

      if (apiKey) {
        void speakText(text, apiKey, vm || undefined, (ratio) => {
          if (ttsPlaybackSerialRef.current !== playbackSerial) return;
          setTtsRevealChars(Math.floor(ttsTextRef.current.length * ratio));
        }, pid).then((played) => {
          if (ttsPlaybackSerialRef.current !== playbackSerial) return;
          if (!played) {
            fallbackSpeak(text, playbackSerial);
            return;
          }
          notifyAgentVoiceEnded();
        }).catch(() => {
          if (ttsPlaybackSerialRef.current === playbackSerial) fallbackSpeak(text, playbackSerial);
        });
        return;
      }

      fallbackSpeak(text, playbackSerial);
    },
    [ttsOn, clearPostPlaybackFadeTimer, fallbackSpeak, notifyAgentVoiceEnded, scheduleSttRestart, startBargeInMonitor]
  );

  // 空闲超时状态引用（在此声明以便 stopVoiceSession 等可提前访问）
  const idleRef = useRef<{
    phaseIndex: number;
    phaseStart: number;
    rafId: number | null;
    nudgeSent: boolean;
    farewellTriggered: boolean;
    resetCount: number;
    lastResetTime: number;
  }>({
    phaseIndex: -1,
    phaseStart: 0,
    rafId: null,
    nudgeSent: false,
    farewellTriggered: false,
    resetCount: 0,
    lastResetTime: 0,
  });

  const clearIdleState = useCallback(() => {
    if (idleRef.current.rafId !== null) {
      cancelAnimationFrame(idleRef.current.rafId);
      idleRef.current.rafId = null;
    }
    idleRef.current.phaseIndex = -1;
    idleRef.current.nudgeSent = false;
    idleRef.current.farewellTriggered = false;
  }, []);

  const stopVoiceSession = useCallback(() => {
    appendVoiceDiag('voice.session.stop');
    clearIdleState();
    if (agentVoiceTimerRef.current !== null) clearTimeout(agentVoiceTimerRef.current);
    agentVoiceTimerRef.current = null;
    setAgentVoiceBusy(false);
    // 清理本地 STT 录制
    if (silenceRafRef.current !== null) cancelAnimationFrame(silenceRafRef.current);
    silenceRafRef.current = null;
    if (silenceTimerRef.current !== null) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    if (sttRestartTimerRef.current !== null) window.clearTimeout(sttRestartTimerRef.current);
    sttRestartTimerRef.current = null;
    sttCooldownUntilRef.current = 0;
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    sttChunksRef.current = [];
    micLevelRef.current = 0;
    setElSessionActive(false);
    setElConnecting(false);
    setContinuousMode(false);
    setLiveSubtitle('');
    setMessages([]);
    setLiveTranscript('');
  }, [appendVoiceDiag, clearIdleState]);

  useEffect(() => () => stopVoiceSession(), [stopVoiceSession]);

  const stopListening = useCallback(() => {
    appendVoiceDiag('voice.listening.stop');
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
    recognitionRef.current = null;
    setListening(false);
    setContinuousMode(false);
  }, [appendVoiceDiag]);

  useEffect(() => () => stopListening(), [stopListening]);

  // ── 渐进式空闲管理 ──
  // 5 阶段状态机：grace → thinking → nudge → waiting → farewell
  // 根据场景（标签页隐藏、深夜、会话活跃度）动态调整时长

  type IdlePhase = 'inactive' | 'grace' | 'thinking' | 'nudge' | 'waiting' | 'farewell';

  interface IdlePhaseDef {
    phase: IdlePhase;
    /** 该阶段持续时间（ms），farewell 为触发点 */
    durationMs: number;
    /** 该阶段结束时触发的操作（可选） */
    action?: 'nudge' | 'farewell';
  }

  // 基准时长（可被场景系数缩放）
  const BASE_PHASES: IdlePhaseDef[] = [
    { phase: 'grace', durationMs: 10_000 },
    { phase: 'thinking', durationMs: 60_000 },
    { phase: 'nudge', durationMs: 1, action: 'nudge' },
    { phase: 'waiting', durationMs: 90_000 },
    { phase: 'farewell', durationMs: 1, action: 'farewell' },
  ];

  const GRACE_MIC_THRESHOLD = 0.055;
  const THINKING_MIC_THRESHOLD = 0.08;

  /** 根据当前场景计算时长缩放系数（>1 = 延长等待，<1 = 加速检测） */
  function getIdleSpeedMultiplier(): number {
    let m = 1.0;

    // 标签页隐藏 → 加速检测（用户已切走，大概率不在）
    const state = useVoiceAssistantActivityStore.getState();
    if (state.tabHiddenTimestamp > 0) {
      m *= 0.35;
    }

    // 深夜 (23:00-05:00) → 延长等待（用户可能疲劳但仍在工作，更有耐心）
    const hour = new Date().getHours();
    if (hour >= 23 || hour < 5) {
      m *= 1.6;
    }

    // 高活跃度会话 → 延长等待（用户在密集工作，思考间歇长）
    if (messagesRef.current.length > 8) {
      m *= 1.4;
    }

    // 频繁重置（用户反复短时间回来） → 逐渐延长（反骚扰）
    if (idleRef.current.resetCount > 2) {
      m *= 1.5;
    }

    return Math.max(0.25, Math.min(m, 3.0));
  }

  const runIdlePhase = useCallback((phaseStart: number) => {
    const now = performance.now();
    const elapsed = now - phaseStart;
    const multiplier = getIdleSpeedMultiplier();

    // 累计从 phase 0 到当前 phase 的时长阈值
    let cumulative = 0;
    let targetPhaseIdx = 0;

    for (let i = 0; i < BASE_PHASES.length; i++) {
      cumulative += BASE_PHASES[i]!.durationMs * multiplier;
      if (elapsed < cumulative) {
        targetPhaseIdx = i;
        break;
      }
      targetPhaseIdx = i;
    }

    const currentPhaseIdx = idleRef.current.phaseIndex;
    const targetPhase = BASE_PHASES[targetPhaseIdx]!;

    // ── 阶段变化处理 ──
    if (targetPhaseIdx !== currentPhaseIdx) {
      idleRef.current.phaseIndex = targetPhaseIdx;

      if (targetPhase.action === 'nudge' && !idleRef.current.nudgeSent) {
        idleRef.current.nudgeSent = true;
        const nudgeText = (() => {
          const hour = new Date().getHours();
          if (hour >= 23 || hour < 5) return '夜深了，还在吗？需要帮忙随时说。';
          if (messagesRef.current.length > 6) return '还在吗？上下文都在，有需要随时叫我。';
          return '还在吗？有需要随时叫我。';
        })();
        setMessages((prev) => [...prev, { role: 'assistant', content: nudgeText }]);
        const ttsCfg = (() => {
          const s = useSeedanceStore.getState().config;
          const pid = s.voiceAssistantSoundProviderId || 'elevenlabs';
          const vm = s.voiceAssistantSoundModel || 'wOqiPOGlNVdIcEallTsU';
          const allP = { ...s.audio.providers, ...s.audio.customProviders };
          const p = allP[pid];
          const ak = p?.apiKey?.trim() || s.elevenLabs.apiKey.trim();
          return { apiKey: ak, voiceId: vm, providerId: pid };
        })();
        if (ttsCfg.apiKey) {
          ttsTextRef.current = nudgeText;
          setTtsRevealChars(0);
          void startBargeInMonitor();
          speakText(nudgeText, ttsCfg.apiKey, ttsCfg.voiceId || undefined, (ratio) => {
            setTtsRevealChars(Math.floor(ttsTextRef.current.length * ratio));
          }, ttsCfg.providerId).catch(() => {});
        }
      }

      if (targetPhase.action === 'farewell' && !idleRef.current.farewellTriggered) {
        idleRef.current.farewellTriggered = true;
        if (idleRef.current.rafId !== null) {
          cancelAnimationFrame(idleRef.current.rafId);
          idleRef.current.rafId = null;
        }
        const goodbye = (() => {
          const hour = new Date().getHours();
          if (hour >= 23 || hour < 5) return '看起来你可能休息了，我先退下了。晚安，随时点麦克风叫我。';
          if (idleRef.current.nudgeSent) return '我先退下休息了。随时点麦克风可以再叫我。';
          return '看起来你可能离开了，我先退下了。随时点麦克风叫我。';
        })();
        setMessages((prev) => [...prev, { role: 'assistant', content: goodbye }]);
        const ttsCfg2 = (() => {
          const s = useSeedanceStore.getState().config;
          const pid = s.voiceAssistantSoundProviderId || 'elevenlabs';
          const vm = s.voiceAssistantSoundModel || 'wOqiPOGlNVdIcEallTsU';
          const allP = { ...s.audio.providers, ...s.audio.customProviders };
          const p = allP[pid];
          const ak = p?.apiKey?.trim() || s.elevenLabs.apiKey.trim();
          return { apiKey: ak, voiceId: vm, providerId: pid };
        })();
        if (ttsCfg2.apiKey) {
          ttsTextRef.current = goodbye;
          setTtsRevealChars(0);
          void startBargeInMonitor();
          speakText(goodbye, ttsCfg2.apiKey, ttsCfg2.voiceId || undefined, (ratio) => {
            setTtsRevealChars(Math.floor(ttsTextRef.current.length * ratio));
          }, ttsCfg2.providerId).then(() => {
            stopVoiceSession();
            stopListening();
          });
        } else {
          setTimeout(() => {
            stopVoiceSession();
            stopListening();
          }, 3500);
        }
        return; // 不再继续轮询
      }
    }

    // ── 麦克风检测（grace/thinking/waiting 阶段均检测，阈值递增）──
    if (targetPhase.phase === 'grace' || targetPhase.phase === 'thinking' || targetPhase.phase === 'waiting') {
      const threshold =
        targetPhase.phase === 'grace' ? GRACE_MIC_THRESHOLD
        : targetPhase.phase === 'thinking' ? THINKING_MIC_THRESHOLD
        : THINKING_MIC_THRESHOLD * 1.3;
      if (micLevelRef.current > threshold) {
        // 用户说话了，重置整个空闲状态
        clearIdleState();
        return;
      }
    }

    // 继续轮询
    idleRef.current.rafId = requestAnimationFrame(() => runIdlePhase(phaseStart));
  }, [clearIdleState, stopVoiceSession, stopListening, startBargeInMonitor]);

  const resetIdleTimer = useCallback(() => {
    clearIdleState();

    const now = performance.now();
    const prevReset = idleRef.current.lastResetTime;

    // 如果距离上次重置在 8 秒内，累计重置计数（防抖场景）
    if (now - prevReset < 8000) {
      idleRef.current.resetCount += 1;
    } else {
      idleRef.current.resetCount = 0;
    }
    idleRef.current.lastResetTime = now;

    idleRef.current.phaseIndex = 0;
    idleRef.current.phaseStart = now;
    idleRef.current.rafId = requestAnimationFrame(() => runIdlePhase(now));
  }, [clearIdleState, runIdlePhase]);

  // 暴露 resetIdleTimer 供外部调用
  const idleTimerResetRef = useRef<(() => void) | null>(null);
  idleTimerResetRef.current = resetIdleTimer;

  const closePanel = useCallback(() => {
    if (listening) {
      stopListening();
    }
    if (elSessionActive || elConnecting) {
      stopVoiceSession();
    }
    setOpen(false);
  }, [elConnecting, elSessionActive, listening, stopVoiceSession, stopListening]);

  type VoiceProvider = string;

  const resolveVoiceProvider = useCallback((): VoiceProvider | null => {
    const v2Gemini = config.llm.providers.gemini ?? config.llm.customProviders.gemini;
    const hasGemini = Boolean(config.multimodalApi.apiKey.trim() || v2Gemini?.apiKey.trim());
    const preferred = config.defaultLlmSource;
    if (preferred === 'gemini' && hasGemini) return 'gemini';
    const preferredProvider = config.llm.providers[preferred];
    if (preferredProvider?.enabled && preferredProvider.apiKey.trim()) return preferred;

    // 默认 provider 不可用，回退到任意已配置的
    if (hasGemini) return 'gemini';
    const fallback = Object.entries(config.llm.providers)
      .find(([, provider]) => provider.enabled && provider.apiKey.trim());
    if (fallback) return fallback[0];
    return null;
  }, [config]);

  const runAssistant = useCallback(
    async (userText: string) => {
      if (!voiceAssistantEnabledRef.current) return;
      const trimmed = userText.trim();
      if (!trimmed) return;
      appendVoiceDiag('assistant.run.start', {
        textLength: trimmed.length,
        hasAgentSink: Boolean(agentSinkRef.current),
      });

      // Agent 接管：语音转录文本直接喂给 Agent 完整管线
      if (agentSinkRef.current) {
        appendVoiceDiag('assistant.run.agent_sink', { textLength: trimmed.length });
        setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
        setLiveTranscript('');
        agentSinkRef.current(trimmed);
        return;
      }

      const voiceProvider = resolveVoiceProvider();
      if (!voiceProvider) {
        appendVoiceDiag('assistant.run.no_provider');
        setError('请先在欢迎页右上角「API配置」中填写任意一个可用的 LLM API Key。');
        return;
      }
      appendVoiceDiag('assistant.run.provider', { voiceProvider });

      setError(null);
      setProcessing(true);

      const prev = messagesRef.current;
      const historyForUi: VoiceChatMsg[] = [...prev, { role: 'user', content: trimmed }];
      setMessages([...historyForUi, { role: 'assistant', content: '' }]);

      const forPrompt =
        historyForUi.length > VOICE_LLM_HISTORY_MAX_MESSAGES
          ? historyForUi.slice(-VOICE_LLM_HISTORY_MAX_MESSAGES)
          : historyForUi;

      const prompt = forPrompt
        .map((m) => (m.role === 'user' ? `用户：${m.content}` : `助手：${m.content}`))
        .join('\n');

      let full = '';
      try {
        if (voiceProvider === 'claude') {
          const v2Claude = config.llm.providers.claude ?? config.llm.customProviders.claude;
          const claudeApiKey = v2Claude?.apiKey.trim() || config.claudeApi?.apiKey.trim() || '';
          const claudeApiUrl = v2Claude?.apiUrl || config.claudeApi?.apiUrl;
          const claudeModel = v2Claude?.models?.[0] || config.claudeApi?.model || 'claude-sonnet-4-5';
          for await (const event of streamClaudeTurn({
            apiKey: claudeApiKey,
            apiUrl: claudeApiUrl,
            model: claudeModel,
            systemPrompt: getVoiceSystemPrompt(),
            messages: forPrompt.map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
            tools: [], // 语音模式：纯文本，不调用工具
          })) {
            if (event.type === 'text_delta') {
              full += event.text;
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === 'assistant') {
                  next[next.length - 1] = { ...last, content: full };
                }
                return next;
              });
            }
            if (event.type === 'error') {
              throw new Error(event.message);
            }
          }

          addUsedTokens('claude', estimateLlmTokens(prompt, full, VOICE_LLM_MAX_TOKENS));
        } else {
          const geminiModelId = resolveGeminiModelId(undefined, config.multimodalApi.model);
          const voiceModel = config.llm.providers[voiceProvider]?.models[0]
            || config.defaultLlmModel
            || DEFAULT_LLM_MODEL;
          for await (const chunk of streamLlmText({
            config,
            volcModel: voiceModel,
            provider: voiceProvider,
            geminiModelId,
            prompt,
            systemPrompt: getVoiceSystemPrompt(),
            temperature: 0.45,
            maxTokens: VOICE_LLM_MAX_TOKENS,
          })) {
            full += chunk;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === 'assistant') {
                next[next.length - 1] = { ...last, content: full };
              }
              return next;
            });
          }

          const billed = estimateLlmTokens(prompt, full, VOICE_LLM_MAX_TOKENS);
          addUsedTokens(voiceProvider === 'gemini' ? 'multimodal' : 'llm', billed);
        }
        speak(full);
        appendVoiceDiag('assistant.run.success', {
          provider: voiceProvider,
          answerLength: full.length,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : '请求失败';
        appendVoiceDiag('assistant.run.error', { message: msg });
        setError(msg);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant' && !last.content) next.pop();
          return next;
        });
      } finally {
        setProcessing(false);
        appendVoiceDiag('assistant.run.finally');
      }
    },
    [addUsedTokens, appendVoiceDiag, config, resolveVoiceProvider, speak]
  );

  // Local SenseVoice STT（PCM 捕获→WAV编码，无需 WebM 解码）
  const startSttRecording = useCallback(async () => {
    if (!voiceAssistantEnabledRef.current) {
      appendVoiceDiag('stt.start.blocked.assistant_disabled');
      return;
    }
    appendVoiceDiag('stt.start.request', {
      elSessionActive,
      elConnecting,
      continuousMode: continuousModeRef.current,
      agentVoiceBusy: agentVoiceBusyRef.current,
    });
    if (elSessionActive || elConnecting) {
      appendVoiceDiag('stt.start.blocked.active_session', { elSessionActive, elConnecting });
      return;
    }
    const cooldownMs = Math.ceil(sttCooldownUntilRef.current - performance.now());
    if (cooldownMs > 0) {
      appendVoiceDiag('stt.start.blocked.cooldown', { cooldownMs });
      scheduleSttRestart(cooldownMs);
      return;
    }
    // 检查 STT 开关：本地识别开启后才允许录音
    const {
      voiceAssistantEnabled: assistantEnabled,
      voiceAssistantSttEnabled,
    } = useSeedanceStore.getState().config;
    if (!assistantEnabled || !voiceAssistantSttEnabled) {
      appendVoiceDiag('stt.start.blocked.disabled');
      return;
    }
    setError(null);
    setElConnecting(true);
    appendVoiceDiag('stt.start.connecting');

    let pcmChunks: ArrayBuffer[] = [];
    let audioCtx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let stopped = false;

    const doStop = () => {
      if (stopped) return;
      stopped = true;
      if (silenceRafRef.current !== null) cancelAnimationFrame(silenceRafRef.current);
      silenceRafRef.current = null;
      if (silenceTimerRef.current !== null) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
      // ScriptProcessorNode is disconnected by closing AudioContext
      try { audioCtx?.close(); } catch { /* noop */ }
      audioCtx = null;
    };

    const finishAndSend = async () => {
      appendVoiceDiag('stt.finish.begin', {
        continuousMode: continuousModeRef.current,
        chunks: pcmChunks.length,
      });
      setElConnecting(false);
      setElSessionActive(false);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      mediaStreamRef.current = null;
      micLevelRef.current = 0;

      if (!continuousModeRef.current) {
        appendVoiceDiag('stt.finish.skip.not_continuous');
        return;
      }

      // Concatenate PCM chunks
      let totalLen = 0;
      for (const c of pcmChunks) totalLen += c.byteLength;
      if (totalLen < MIN_STT_AUDIO_BYTES) {
        // Very short clips are usually playback tail or noise, not a complete user turn.
        console.log('[STT] PCM 数据太小，跳过:', (totalLen / 1024).toFixed(1), 'KB');
        appendVoiceDiag('stt.finish.skip.pcm_too_small', {
          bytes: totalLen,
          minBytes: MIN_STT_AUDIO_BYTES,
        });
        pcmChunks = [];
        if (continuousModeRef.current && !agentVoiceBusyRef.current) {
          scheduleSttRestart(STT_RESTART_DELAY_MS);
        }
        return;
      }

      const pcmBuf = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of pcmChunks) {
        pcmBuf.set(new Uint8Array(c), offset);
        offset += c.byteLength;
      }
      pcmChunks = [];

      const wavBlob = encodePcmWav(pcmBuf.buffer, 16000);
      console.log('[STT] PCM→WAV 编码完成, 大小:', (wavBlob.size / 1024).toFixed(1), 'KB，发送到服务端…');
      appendVoiceDiag('stt.request.send', {
        pcmBytes: totalLen,
        wavBytes: wavBlob.size,
      });
      setProcessing(true);
      try {
        const form = new FormData();
        form.append('audio', wavBlob, 'recording.wav');

        const res = await fetch('/api/local-stt', { method: 'POST', body: form });
        const data = (await res.json().catch(() => ({}))) as {
          text?: string;
          error?: string;
          diagnostics?: unknown;
        };
        console.log('[STT] 服务端响应:', JSON.stringify(data));
        appendVoiceDiag('stt.response.received', {
          ok: res.ok,
          status: res.status,
          hasText: Boolean(data.text?.trim()),
          textLength: data.text?.trim().length || 0,
          hasError: Boolean(data.error),
          hasDiagnostics: Boolean(data.diagnostics),
        });
        if (res.ok && data.text?.trim()) {
          const transcript = normalizeSttTranscript(data.text);
          if (!isUsableSttTranscript(transcript)) {
            console.log('[STT] 忽略无效转写:', JSON.stringify(transcript));
            appendVoiceDiag('stt.response.invalid_transcript', { transcript });
            if (continuousModeRef.current && !agentVoiceBusyRef.current) {
              scheduleSttRestart(INVALID_STT_RESTART_DELAY_MS);
            }
            return;
          }
          console.log('[STT] 转录成功:', transcript);
          appendVoiceDiag('stt.response.success', { transcript });
          setLiveTranscript('');
          idleTimerResetRef.current?.();
          await runAssistant(transcript);
        } else if (res.ok && !data.text?.trim()) {
          console.log('[STT] 录音全部为背景噪音，跳过');
          appendVoiceDiag('stt.response.empty_text');
          if (continuousModeRef.current && !agentVoiceBusyRef.current) {
            scheduleSttRestart(INVALID_STT_RESTART_DELAY_MS);
          }
        } else if (data.error) {
          const message = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
          appendVoiceDiag('stt.response.error', { message });
          setError(message);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'STT 请求失败';
        appendVoiceDiag('stt.request.exception', { message });
        setError(message);
      } finally {
        setProcessing(false);
        appendVoiceDiag('stt.finish.finally');
      }
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;
      appendVoiceDiag('stt.media.ready', {
        tracks: stream.getAudioTracks().map((track) => ({
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        })),
      });

      audioCtx = new AudioContext({ latencyHint: 'interactive' });
      appendVoiceDiag('stt.audio_context.ready', {
        sampleRate: audioCtx.sampleRate,
        state: audioCtx.state,
      });
      const source = audioCtx.createMediaStreamSource(stream);

      // Silence detection analyser
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let silenceStart = 0;
      let hasSpoken = false;
      let speechStart = 0;
      let voicedFrames = 0;
      let peakAvg = 0;
      let noiseFloor = 0;
      let floorSamples = 0;
      let latestPcmLevel = 0;
      let latestPcmLevelAt = 0;
      const recordingStartedAt = performance.now();
      const MIN_SILENCE_LEVEL = 6;
      const MIN_SPEECH_LEVEL = 12;
      const SPEECH_OVER_FLOOR = 6;
      const SILENCE_OVER_FLOOR = 3;
      const SILENCE_DURATION = 1800;
      const MIN_RECORDING_DURATION = 1400;
      const FALLBACK_RECORDING_DURATION = 9000;
      const MAX_RECORDING_DURATION = 15000;
      const MIN_SPEECH_DURATION = 180;
      const MIN_VOICED_FRAMES = 3;

      // PCM capture via ScriptProcessorNode
      const processor = audioCtx.createScriptProcessor(1024, 1, 1);
      processor.onaudioprocess = (e) => {
        if (stopped) return;
        const input = e.inputBuffer.getChannelData(0);
        if (input.length > 0) {
          const pcmLevel = pcmVadLevel(input);
          latestPcmLevel = Math.max(latestPcmLevel * 0.82, pcmLevel);
          latestPcmLevelAt = performance.now();
          micLevelRef.current = Math.max(micLevelRef.current, Math.min(1, latestPcmLevel / 72));
          const resampled = resampleF32(input, audioCtx!.sampleRate, 16000);
          pcmChunks.push(f32ToPcm16(resampled));
        }
      };
      source.connect(processor);
      const muteGain = audioCtx.createGain();
      muteGain.gain.value = 0;
      processor.connect(muteGain);
      muteGain.connect(audioCtx.destination);

      // Store processor reference for cleanup
      const processorNode = processor;
      mediaRecorderRef.current = null; // No longer using MediaRecorder

      const checkSilence = () => {
        if (stopped) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]!;
        const spectrumAvg = sum / dataArray.length;
        const now = performance.now();
        const pcmLevel = now - latestPcmLevelAt < 350 ? latestPcmLevel : 0;
        const avg = Math.max(spectrumAvg, pcmLevel);

        if (!hasSpoken) {
          const learningGate = Math.max(MIN_SPEECH_LEVEL, noiseFloor + SPEECH_OVER_FLOOR);
          if (floorSamples < 12) {
            noiseFloor = floorSamples === 0 ? avg : noiseFloor * 0.85 + avg * 0.15;
            floorSamples += 1;
          } else if (avg < learningGate) {
            noiseFloor = noiseFloor * 0.96 + avg * 0.04;
          }
        }

        const speechGate = Math.max(MIN_SPEECH_LEVEL, noiseFloor + SPEECH_OVER_FLOOR);
        const silenceGate = Math.max(MIN_SILENCE_LEVEL, noiseFloor + SILENCE_OVER_FLOOR);

        if (avg > speechGate) {
          if (speechStart === 0) speechStart = performance.now();
          voicedFrames += 1;
          peakAvg = Math.max(peakAvg, avg);
        } else if (!hasSpoken && avg < silenceGate) {
          voicedFrames = Math.max(0, voicedFrames - 1);
          if (voicedFrames === 0) {
            speechStart = 0;
            peakAvg = 0;
          }
        }

        if (
          !hasSpoken &&
          speechStart > 0 &&
          voicedFrames >= MIN_VOICED_FRAMES &&
          now - speechStart >= MIN_SPEECH_DURATION &&
          peakAvg >= speechGate
        ) {
          hasSpoken = true;
          appendVoiceDiag('stt.vad.speech_detected', {
            avg,
            speechGate,
            silenceGate,
            peakAvg,
            voicedFrames,
            elapsedMs: Math.round(now - recordingStartedAt),
          });
        }

        if (
          (hasSpoken && now - recordingStartedAt >= MAX_RECORDING_DURATION) ||
          (!hasSpoken && now - recordingStartedAt >= FALLBACK_RECORDING_DURATION)
        ) {
          console.log(hasSpoken ? '[STT] 达到最长录音时长，自动停止录音' : '[STT] 未触发语音门限，兜底停止录音');
          appendVoiceDiag(hasSpoken ? 'stt.vad.max_duration_stop' : 'stt.vad.fallback_no_speech_stop', {
            elapsedMs: Math.round(now - recordingStartedAt),
            hasSpoken,
            avg,
            speechGate,
            silenceGate,
            chunks: pcmChunks.length,
          });
          doStop();
          void finishAndSend();
          return;
        }

        if (avg < silenceGate) {
          if (silenceStart === 0) silenceStart = performance.now();
          else if (
            hasSpoken &&
            now - recordingStartedAt >= MIN_RECORDING_DURATION &&
            now - silenceStart >= SILENCE_DURATION
          ) {
            console.log('[STT] 检测到静音，自动停止录音');
            appendVoiceDiag('stt.vad.silence_stop', {
              elapsedMs: Math.round(now - recordingStartedAt),
              silenceMs: Math.round(now - silenceStart),
              avg,
              speechGate,
              silenceGate,
              chunks: pcmChunks.length,
            });
            doStop();
            void finishAndSend();
            return;
          }
        } else {
          silenceStart = 0;
        }
        micLevelRef.current = Math.max(micLevelRef.current, Math.min(1, avg / 72));
        silenceRafRef.current = requestAnimationFrame(checkSilence);
      };

      setElSessionActive(true);
      setElConnecting(false);
      appendVoiceDiag('stt.session.active');
      idleTimerResetRef.current?.();
      silenceRafRef.current = requestAnimationFrame(checkSilence);
    } catch (e) {
      doStop();
      appendVoiceDiag('stt.start.exception', e);
      if (e instanceof DOMException) {
        if (e.name === 'NotAllowedError') {
          setError('麦克风权限被拒绝，请在浏览器设置中允许访问麦克风');
        } else if (e.name === 'NotFoundError') {
          setError('未找到麦克风设备，请确保已连接麦克风');
        } else if (e.name === 'NotReadableError') {
          setError('麦克风被其他应用占用，请关闭其他使用麦克风的应用');
        } else {
          setError(e.message || '无法访问麦克风');
        }
      } else {
        setError(e instanceof Error ? e.message : '无法启动麦克风');
      }
      setElConnecting(false);

    }
  }, [appendVoiceDiag, elSessionActive, elConnecting, runAssistant, scheduleSttRestart]);
  startSttRecordingRef.current = startSttRecording;

  const stopSttRecording = useCallback(() => {
    if (silenceRafRef.current !== null) cancelAnimationFrame(silenceRafRef.current);
    silenceRafRef.current = null;
    if (silenceTimerRef.current !== null) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    if (sttRestartTimerRef.current !== null) window.clearTimeout(sttRestartTimerRef.current);
    sttRestartTimerRef.current = null;
    setElConnecting(false);
    setElSessionActive(false);
    micLevelRef.current = 0;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }, []);

  const toggleListen = useCallback(() => {
    if (!voiceAssistantEnabledRef.current) return;
    appendVoiceDiag('voice.toggle', {
      continuousMode: continuousModeRef.current,
      elSessionActive,
      listening,
      elConnecting,
    });
    ensureStreamAudioContext();
    // 任意激活状态下再次点击 = 挂断
    if (continuousModeRef.current || elSessionActive || listening) {
      appendVoiceDiag('voice.toggle.stop_active');
      playVoiceAssistantClickSound();
      if (elSessionActive) {
        stopSttRecording();
      }
      if (listening) stopListening();
      stopStreamTts();
      stopTtsPlayback();
      stopBargeInMonitor();
      setContinuousMode(false);
      setAgentVoiceBusy(false);
      setSubtitlePlaybackOpacity(0);
      setLiveSubtitle('');
      setLiveTranscript('');
      setMessages([]);
      setTtsRevealChars(0);
      if (agentVoiceTimerRef.current !== null) {
        clearTimeout(agentVoiceTimerRef.current);
        agentVoiceTimerRef.current = null;
      }
      clearIdleState();
      voiceGreetedRef.current = false;
      return;
    }

    // 首次激活时自动打招呼（Agent 接管模式下）
    if (agentSinkRef.current && !voiceGreetedRef.current) {
      appendVoiceDiag('voice.toggle.start_agent_greeting');
      voiceGreetedRef.current = true;
      setContinuousMode(true);
      playVoiceAssistantClickSound();
      const greeting = '你好，我是 Magine 助手。我可以帮你操作画布、管理文件、搜索信息。请告诉我你需要什么？';
      pushAgentSubtitle(greeting);
      const ttsCfg3 = (() => {
        const s = useSeedanceStore.getState().config;
        const pid = s.voiceAssistantSoundProviderId || 'elevenlabs';
        const vm = s.voiceAssistantSoundModel || 'wOqiPOGlNVdIcEallTsU';
        const allP = { ...s.audio.providers, ...s.audio.customProviders };
        const p = allP[pid];
        const ak = p?.apiKey?.trim() || s.elevenLabs.apiKey.trim();
        return { apiKey: ak, voiceId: vm, providerId: pid };
      })();

      const startRecordingAfterGreeting = () => {
        appendVoiceDiag('voice.greeting.finished.start_recording');
        // TTS 播放完毕 → 淡出字幕 → 等待 CSS transition → 开始收音
        setSubtitlePlaybackOpacity(0);
        setTimeout(() => {
          idleTimerResetRef.current?.();
          void startSttRecording();
        }, 420);
      };

      if (ttsCfg3.apiKey) {
        ttsTextRef.current = greeting;
        setTtsRevealChars(0);
        void speakText(greeting, ttsCfg3.apiKey, ttsCfg3.voiceId || undefined, (ratio) => {
          setTtsRevealChars(Math.floor(ttsTextRef.current.length * ratio));
        }, ttsCfg3.providerId).then(startRecordingAfterGreeting);
      } else {
        // 无 TTS：给用户阅读字幕的时间后开始收音
        setTimeout(startRecordingAfterGreeting, 2000);
      }
      return;
    }

    if (elConnecting) {
      appendVoiceDiag('voice.toggle.blocked.connecting');
      return;
    }
    appendVoiceDiag('voice.toggle.start_recording');
    voiceGreetedRef.current = true;
    setContinuousMode(true);
    playVoiceAssistantClickSound();
    void startSttRecording();
  }, [
    elConnecting,
    appendVoiceDiag,
    elSessionActive,
    listening,
    startSttRecording,
    stopSttRecording,
    stopListening,
    stopBargeInMonitor,
  ]);

  useEffect(() => {
    if (voiceAssistantEnabled) return;

    const cleanupTimer = window.setTimeout(() => {
      if (voiceAssistantEnabledRef.current) return;
      autoStartAttemptedRef.current = false;
      ttsPlaybackSerialRef.current += 1;
      stopVoiceSession();
      stopListening();
      stopBargeInMonitor();
      stopStreamTts();
      stopTtsPlayback();
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* noop */
      }
      clearPostPlaybackFadeTimer();
      setOpen(false);
      setError(null);
      setTtsNotice('');
      setTtsRevealChars(0);
      setSubtitlePlaybackOpacity(0);
    }, 0);

    return () => window.clearTimeout(cleanupTimer);
  }, [
    clearPostPlaybackFadeTimer,
    stopBargeInMonitor,
    stopListening,
    stopVoiceSession,
    voiceAssistantEnabled,
  ]);

  const useElevenLabsUi = true;
  const micBusy = useElevenLabsUi ? elConnecting : processing;
  const micLive = useElevenLabsUi ? elSessionActive : listening;
  const waveActive =
    continuousMode || Boolean(elSessionActive || elConnecting || listening || processing || liveTranscript.trim() || agentVoiceBusy || ttsNotice.trim());

  const subtitleText = useMemo(() => {
    const live = liveTranscript.trim();
    if (live) return live;
    // Agent 流式字幕（实时更新，优先级高于历史消息）
    if (liveSubtitle.trim()) return liveSubtitle.trim();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === 'assistant') {
        const t = (m.content ?? '').trim();
        if (t) return t;
      }
    }
    return '';
  }, [liveTranscript, liveSubtitle, messages]);

  const subtitleMode = useMemo<VoiceSubtitleMode>(() => {
    if (liveTranscript.trim()) return 'normal';
    if (liveSubtitle.trim()) return liveSubtitleMode;
    return 'normal';
  }, [liveTranscript, liveSubtitle, liveSubtitleMode]);

  useEffect(() => {
    clearPostPlaybackFadeTimer();
    setSubtitlePlaybackOpacity(1);
  }, [subtitleText, clearPostPlaybackFadeTimer]);

  useEffect(() => {
    if (liveTranscript.trim()) {
      clearPostPlaybackFadeTimer();
      setSubtitlePlaybackOpacity(1);
    }
  }, [liveTranscript, clearPostPlaybackFadeTimer]);

  // 自启动主动交互：页面加载后自动开启语音助手
  useEffect(() => {
    if (autoStartAttemptedRef.current) return;
    if (!voiceAssistantEnabled) {
      autoStartAttemptedRef.current = false;
      return;
    }
    if (!config.voiceAssistantAutoStart) return;

    const timer = setTimeout(() => {
      if (continuousModeRef.current || elSessionActive || listening) return;
      autoStartAttemptedRef.current = true;
      toggleListen();
    }, 3000);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.voiceAssistantAutoStart, voiceAssistantEnabled]);

  const value = useMemo<VoiceAssistantContextValue>(
    () => ({
      open,
      setOpen,
      closePanel,
      ttsOn,
      setTtsOn,
      messages,
      liveTranscript,
      listening,
      processing,
      error,
      elSessionActive,
      elConnecting,
      canUseElevenLabs,
      useElevenLabsUi,
      micBusy,
      micLive,
      waveActive,
      subtitleText,
      subtitleMode,
      ttsNotice,
      subtitlePlaybackOpacity,
      ttsRevealChars,
      audioLevelRef,
      scrollRef,
      toggleListen,
      setAgentSink,
      clearAgentSink,
      pushAgentSubtitle,
      setLiveSubtitle: setLiveSubtitleCb,
      setAgentTtsProgress,
      notifyAgentVoiceEnded,
    }),
    [
      open,
      closePanel,
      ttsOn,
      messages,
      liveTranscript,
      listening,
      processing,
      error,
      elSessionActive,
      elConnecting,
      canUseElevenLabs,
      useElevenLabsUi,
      micBusy,
      micLive,
      waveActive,
      subtitleText,
      subtitleMode,
      ttsNotice,
      subtitlePlaybackOpacity,
      ttsRevealChars,
      toggleListen,
      setAgentSink,
      clearAgentSink,
      pushAgentSubtitle,
      setLiveSubtitleCb,
      setAgentTtsProgress,
      notifyAgentVoiceEnded,
    ]
  );

  return <VoiceAssistantContext.Provider value={value}>{children}</VoiceAssistantContext.Provider>;
}
