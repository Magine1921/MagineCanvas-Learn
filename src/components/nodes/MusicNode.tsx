'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CanvasNodeData, useCanvasStore } from '../canvas/CanvasStore';
import { useSeedanceStore, type ProviderConfig } from '../seedance/SeedanceStore';
import { createMiniMaxAudioAPI, getMusicModelSpec } from '../api/MiniMaxAudioAPI';
import { createSunoMusicAPI } from '../api/SunoMusicAPI';
import { createKieSunoMusicAPI } from '../api/KieSunoMusicAPI';
import { createElevenLabsMusicAPI } from '../api/ElevenLabsMusicAPI';
import { MentionTextarea, type MentionTextareaSize } from '../canvas/MentionTextarea';
import { ExpandableTextField } from '../canvas/ExpandableTextField';
import { ScreenSpaceNodePanel } from '../canvas/ScreenSpaceNodePanel';
import { KieUsageInfo } from '../canvas/KieUsageInfo';
import { useIncomingPromptSources } from '../canvas/useCanvasDerivedData';
import { MiniMaxVoiceManager } from '../seedance/MiniMaxVoiceManager';
import { VoiceAssistantWaveStrip } from '@/components/voice/VoiceAssistantWaveStrip';
import { GenerationEta } from '../canvas/GenerationEta';
import {
  hydratePersistedAudioUrl,
  isAudioIdbRef,
  persistGeneratedAudioUrl,
} from '@/lib/canvas-persist-audio-offload';
import { composePrompt } from '@/lib/prompt-flow';
import {
  buildKieUsageDisplay,
  fetchKieCredits,
  getKieProviderTokenBucket,
  isKieProvider as isKieApiProvider,
  KIE_GLOBAL_PROVIDER_TOKEN_KEY,
} from '@/lib/kie-usage-display';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useSmoothedProgress } from '@/lib/use-smoothed-progress';
import { useAgentGenerationBridge } from '@/lib/useAgentGenerationBridge';
import { Music, Loader2, Play, Pause, Download, Settings2, Volume2, Mic, Trash2 } from 'lucide-react';

interface GeneratedMusicItem {
  id: string;
  audioUrl: string;
  createdAt: number;
  name?: string;
  prompt?: string;
  model?: string;
  provider?: string;
  duration?: number;
}

interface GeneratedTTSItem {
  id: string;
  audioUrl: string;
  createdAt: number;
  name?: string;
  text?: string;
  model?: string;
  provider?: string;
  voiceId?: string;
}

interface MusicNodeData extends CanvasNodeData {
  prompt?: string;
  customPrompt?: string;
  promptEdited?: boolean;
  audioUrl?: string;
  promptBoxSize?: MentionTextareaSize;
  duration?: number;
  model?: string;
  providerId?: string;
  status?: string;
  generatedMusic?: GeneratedMusicItem[];
  // 模型特定参数
  sunoStyle?: string;
  elevenLabsStyle?: string;
  // 模式切换
  mode?: 'music' | 'tts';
  // TTS 特定参数
  ttsProviderId?: string;
  ttsModel?: string;
  ttsVoiceId?: string;
  ttsVoiceMode?: 'preset' | 'custom';
  ttsSpeed?: number;
  ttsVol?: number;
  ttsPitch?: number;
  ttsStability?: number;
  ttsSimilarityBoost?: number;
  ttsAudioUrl?: string;
  generatedTTS?: GeneratedTTSItem[];
}

interface MusicModelOption {
  value: string;
  label: string;
  providerId: string;
  isMusicModel: boolean;
}

interface GenerationProgress {
  status: 'idle' | 'submitting' | 'processing' | 'success' | 'error';
  progress: number;
  message: string;
  errorType?: 'config' | 'quota' | 'network' | 'unknown';
}

// 厂商和模型配置
interface ModelConfig {
  displayName: string;
  isMusicModel: boolean;
  durationOptions: { value: number; label: string }[];
  hasStyleOption: boolean;
  styleOptions?: { value: string; label: string }[];
}

interface ProviderModelConfig {
  [modelId: string]: ModelConfig;
}

const KIE_SUNO_STYLE_OPTIONS = [
  { value: 'pop', label: 'Pop' },
  { value: 'rock', label: 'Rock' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'electronic', label: 'Electronic' },
  { value: 'ambient', label: 'Ambient' },
  { value: 'acoustic', label: 'Acoustic' },
];

const KIE_SUNO_DURATION_OPTIONS = [
  { value: 30, label: '30s' },
  { value: 60, label: '60s' },
  { value: 120, label: '120s' },
];

function createKieSunoModelConfig(displayName: string): ModelConfig {
  return {
    displayName,
    isMusicModel: true,
    durationOptions: KIE_SUNO_DURATION_OPTIONS,
    hasStyleOption: true,
    styleOptions: KIE_SUNO_STYLE_OPTIONS,
  };
}

const PROVIDER_MODEL_CONFIGS: Record<string, ProviderModelConfig> = {
  'minimax-audio': {
    'music-2.6': {
      displayName: 'Music 2.6',
      isMusicModel: true,
      // music-2.6 不接收 duration，时长由 prompt/lyrics 决定
      durationOptions: [],
      hasStyleOption: false,
    },
    'music-2.6-free': {
      displayName: 'Music 2.6 Free',
      isMusicModel: true,
      durationOptions: [],
      hasStyleOption: false,
    },
  },
  suno: {
    V5_5: createKieSunoModelConfig('Kie Suno V5.5'),
    V5: createKieSunoModelConfig('Kie Suno V5'),
    V4_5PLUS: createKieSunoModelConfig('Kie Suno V4.5+'),
    V4_5: createKieSunoModelConfig('Kie Suno V4.5'),
    V4_5ALL: createKieSunoModelConfig('Kie Suno V4.5 All'),
    V4: {
      displayName: 'Kie Suno V4',
      isMusicModel: true,
      durationOptions: KIE_SUNO_DURATION_OPTIONS,
      hasStyleOption: true,
      styleOptions: KIE_SUNO_STYLE_OPTIONS,
    },
    V3_5: {
      displayName: 'Kie Suno V3.5',
      isMusicModel: true,
      durationOptions: [
        { value: 30, label: '30s' },
        { value: 60, label: '60s' },
      ],
      hasStyleOption: true,
      styleOptions: [
        { value: 'pop', label: 'Pop' },
        { value: 'rock', label: 'Rock' },
        { value: 'cinematic', label: 'Cinematic' },
        { value: 'electronic', label: 'Electronic' },
      ],
    },
    'suno-v4': {
      displayName: 'Suno v4',
      isMusicModel: true,
      durationOptions: [
        { value: 15, label: '15秒' },
        { value: 30, label: '30秒' },
        { value: 45, label: '45秒' },
        { value: 60, label: '60秒' },
        { value: 120, label: '120秒' },
      ],
      hasStyleOption: true,
      styleOptions: [
        { value: 'pop', label: '流行' },
        { value: 'rock', label: '摇滚' },
        { value: 'jazz', label: '爵士' },
        { value: 'classical', label: '古典' },
        { value: 'hiphop', label: '嘻哈' },
        { value: 'electronic', label: '电子' },
        { value: 'ambient', label: '氛围' },
        { value: 'acoustic', label: '原声' },
      ],
    },
    'suno-v3.5': {
      displayName: 'Suno v3.5',
      isMusicModel: true,
      durationOptions: [
        { value: 15, label: '15秒' },
        { value: 30, label: '30秒' },
        { value: 45, label: '45秒' },
        { value: 60, label: '60秒' },
      ],
      hasStyleOption: true,
      styleOptions: [
        { value: 'pop', label: '流行' },
        { value: 'rock', label: '摇滚' },
        { value: 'jazz', label: '爵士' },
        { value: 'classical', label: '古典' },
      ],
    },
  },
  'kie-suno': {
    V5_5: createKieSunoModelConfig('Kie Suno V5.5'),
    V5: createKieSunoModelConfig('Kie Suno V5'),
    V4_5PLUS: createKieSunoModelConfig('Kie Suno V4.5+'),
    V4_5: createKieSunoModelConfig('Kie Suno V4.5'),
    V4_5ALL: createKieSunoModelConfig('Kie Suno V4.5 All'),
    V4: {
      displayName: 'Kie Suno V4',
      isMusicModel: true,
      durationOptions: KIE_SUNO_DURATION_OPTIONS,
      hasStyleOption: true,
      styleOptions: KIE_SUNO_STYLE_OPTIONS,
    },
    V3_5: {
      displayName: 'Kie Suno V3.5',
      isMusicModel: true,
      durationOptions: [
        { value: 30, label: '30s' },
        { value: 60, label: '60s' },
      ],
      hasStyleOption: true,
      styleOptions: [
        { value: 'pop', label: 'Pop' },
        { value: 'rock', label: 'Rock' },
        { value: 'cinematic', label: 'Cinematic' },
        { value: 'electronic', label: 'Electronic' },
      ],
    },
  },
  elevenlabs: {
    'eleven-music-v1': {
      displayName: 'Eleven Music v1',
      isMusicModel: true,
      durationOptions: [
        { value: 10, label: '10秒' },
        { value: 15, label: '15秒' },
        { value: 20, label: '20秒' },
        { value: 30, label: '30秒' },
        { value: 45, label: '45秒' },
        { value: 60, label: '60秒' },
      ],
      hasStyleOption: false,
    },
  },
};

const DEFAULT_DURATION_OPTIONS = [
  { value: 10, label: '10秒' },
  { value: 15, label: '15秒' },
  { value: 30, label: '30秒' },
  { value: 45, label: '45秒' },
  { value: 60, label: '60秒' },
];

const DEFAULT_PROMPT_BOX_SIZE: MentionTextareaSize = { width: 254, height: 80 };
const MUSIC_PREVIEW_WIDTH = 360;
const MUSIC_EDIT_PANEL_WIDTH = 660;
const CUSTOM_TTS_VOICE_VALUE = '__custom_tts_voice__';
const DEFAULT_MINIMAX_TTS_VOICE_ID = 'male-qn-qingse';
const DEFAULT_ELEVENLABS_TTS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

type AudioContextLike = AudioContext & {
  createMediaElementSource(mediaElement: HTMLMediaElement): MediaElementAudioSourceNode;
};

function AudioWaveformFrame({
  title,
  mode,
  audioUrl,
  trackingAudioUrl,
  prompt,
  badge,
  isLoading,
  progress,
  etaKey,
  etaSessionKey,
  etaBaselineSeconds,
  statusMessage,
  isGlowing,
  onDownload,
  onModeChange,
  playRequestId,
  pauseRequestId,
  onPlayingAudioUrlChange,
}: {
  title: string;
  mode: 'music' | 'tts';
  audioUrl: string;
  trackingAudioUrl?: string;
  prompt: string;
  badge: string;
  isLoading: boolean;
  progress: number;
  etaKey: string;
  etaSessionKey: string;
  etaBaselineSeconds: number;
  statusMessage: string;
  isGlowing: boolean;
  onDownload: () => void;
  onModeChange: (mode: 'music' | 'tts') => void;
  playRequestId: number;
  pauseRequestId: number;
  onPlayingAudioUrlChange: (audioUrl: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContextLike | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioLevelRef = useRef<number | undefined>(undefined);
  const handledPlayRequestIdRef = useRef(playRequestId);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const smoothGenerationProgress = useSmoothedProgress(progress);

  const ensureAudioGraph = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || typeof window === 'undefined') return false;
    try {
      const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return false;
      if (!audioContextRef.current) {
        audioContextRef.current = new Ctx() as AudioContextLike;
      }
      const ctx = audioContextRef.current;
      if (!sourceRef.current) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.64;
        sourceRef.current = ctx.createMediaElementSource(audio);
        sourceRef.current.connect(analyser);
        analyser.connect(ctx.destination);
        analyserRef.current = analyser;
        dataRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      }
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const playCurrentAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    await ensureAudioGraph();
    await audio.play();
    setIsPlaying(true);
    onPlayingAudioUrlChange(trackingAudioUrl || audioUrl);
  }, [audioUrl, ensureAudioGraph, onPlayingAudioUrlChange, trackingAudioUrl]);

  const togglePlayback = useCallback(async (event: React.MouseEvent) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      onPlayingAudioUrlChange('');
      return;
    }
    await playCurrentAudio();
  }, [audioUrl, isPlaying, onPlayingAudioUrlChange, playCurrentAudio]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    audioLevelRef.current = undefined;
    onPlayingAudioUrlChange('');
  }, [audioUrl, onPlayingAudioUrlChange]);

  useEffect(() => {
    if (!audioUrl || playRequestId <= 0 || handledPlayRequestIdRef.current === playRequestId) return;
    handledPlayRequestIdRef.current = playRequestId;
    void playCurrentAudio().catch((error) => {
      console.error('[MusicNode] history playback failed:', error);
    });
  }, [audioUrl, playCurrentAudio, playRequestId]);

  useEffect(() => {
    if (pauseRequestId <= 0) return;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
    }
    setIsPlaying(false);
    onPlayingAudioUrlChange('');
  }, [onPlayingAudioUrlChange, pauseRequestId]);

  useEffect(() => {
    if (!isPlaying) {
      audioLevelRef.current = undefined;
      return;
    }
    const tick = () => {
      const analyser = analyserRef.current;
      const data = dataRef.current;
      if (analyser && data) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < data.length; i += 1) {
          const centered = (data[i] - 128) / 128;
          peak = Math.max(peak, Math.abs(centered));
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / Math.max(1, data.length));
        const nextLevel = Math.min(1, Math.max(0.12, Math.max(rms * 18, peak * 1.7)));
        audioLevelRef.current = typeof audioLevelRef.current === 'number'
          ? audioLevelRef.current * 0.22 + nextLevel * 0.78
          : nextLevel;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying]);

  const timeLabel = duration > 0
    ? `${Math.floor(currentTime / 60)}:${String(Math.floor(currentTime % 60)).padStart(2, '0')} / ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`
    : badge;
  const progressRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  const handleSeek = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !audioUrl || duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const nextTime = ratio * duration;
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, [audioUrl, duration]);

  return (
    <div className={cn('mc-music-wave-node relative h-[202px] w-full overflow-hidden rounded-xl border border-white/18 bg-[#080a0d]/94 shadow-[0_20px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.08)]', isPlaying && 'mc-music-wave-node-playing', isGlowing && 'mc-node-success-glow')}>
      <div className="flex h-10 items-center gap-2 border-b border-white/8 px-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/16 bg-white/[0.06]">
          {mode === 'tts' ? <Mic className="h-4 w-4 text-violet-100" /> : <Music className="h-4 w-4 text-emerald-100" />}
        </div>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white">{title}</span>
        <div className="nodrag nopan ml-auto flex rounded-md border border-white/10 bg-black/20 p-0.5 text-[10px] font-medium">
          <button
            type="button"
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 transition-all',
              mode === 'tts'
                ? 'bg-violet-500/25 text-violet-100 shadow-[0_0_8px_rgba(139,92,246,0.25)]'
                : 'text-zinc-500 hover:text-zinc-300'
            )}
            onClick={(event) => {
              event.stopPropagation();
              onModeChange('tts');
            }}
          >
            <Mic className="h-3 w-3" />
            语音
          </button>
          <button
            type="button"
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 transition-all',
              mode === 'music'
                ? 'bg-emerald-500/25 text-emerald-100 shadow-[0_0_8px_rgba(16,185,129,0.25)]'
                : 'text-zinc-500 hover:text-zinc-300'
            )}
            onClick={(event) => {
              event.stopPropagation();
              onModeChange('music');
            }}
          >
            <Music className="h-3 w-3" />
            音乐
          </button>
        </div>
      </div>

      <div className="flex h-[118px] flex-col justify-center px-4">
        <div className="relative flex h-14 items-center overflow-visible">
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-px -translate-y-1/2 bg-white/8" />
          <VoiceAssistantWaveStrip
            active={true}
            audioLevelRef={isPlaying ? audioLevelRef : undefined}
            forceMotion={isPlaying}
            intensity={2.15}
            className={cn('mc-music-voice-wave h-12 items-center overflow-visible', isPlaying && 'mc-music-voice-wave-playing')}
          />
        </div>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-zinc-500">
          <span className="truncate">{audioUrl ? timeLabel : (prompt || statusMessage || '等待生成...')}</span>
          {isLoading ? (
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-zinc-400">
              <GenerationEta
                active={isLoading}
                progress={progress}
                estimateKey={etaKey}
                sessionKey={etaSessionKey}
                defaultTotalSeconds={etaBaselineSeconds}
                className="text-[8px]"
              />
              {Math.round(smoothGenerationProgress)}%
            </span>
          ) : null}
        </div>
        <div
          className="mc-music-progress-track nodrag nopan mt-2 h-1 w-full cursor-pointer rounded-full bg-white/[0.08]"
          title={audioUrl ? '播放进度' : '暂无音频'}
          onClick={handleSeek}
        >
          <div
            className="mc-music-progress-fill h-full rounded-full bg-gradient-to-r from-emerald-300/70 via-cyan-200/75 to-amber-200/65"
            style={{ width: `${progressRatio * 100}%` }}
          />
        </div>
      </div>

      <div className="flex h-11 items-center gap-2 border-t border-white/8 px-3">
        <button
          type="button"
          onClick={togglePlayback}
          disabled={!audioUrl}
          title={audioUrl ? (isPlaying ? '暂停' : '播放') : '暂无音频'}
          className="nodrag nopan flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-zinc-100 transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <div className="min-w-0 flex-1 truncate text-[10px] text-zinc-500">{statusMessage}</div>
        {audioUrl && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDownload();
            }}
            title="下载音频"
            className="nodrag nopan flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-zinc-200 transition hover:bg-white/[0.12]"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {audioUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          className="hidden"
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
          onPause={() => {
            setIsPlaying(false);
            onPlayingAudioUrlChange('');
          }}
          onEnded={() => {
            setIsPlaying(false);
            onPlayingAudioUrlChange('');
          }}
        />
      )}
    </div>
  );
}

function AudioHistoryStrip({
  sourceNodeId,
  mode,
  items,
  activeAudioUrl,
  playingAudioUrl,
  onSelect,
  onPlay,
  onDownload,
  onDelete,
}: {
  sourceNodeId: string;
  mode: 'music' | 'tts';
  items: Array<GeneratedMusicItem | GeneratedTTSItem>;
  activeAudioUrl: string;
  playingAudioUrl: string;
  onSelect: (audioUrl: string) => void;
  onPlay: (audioUrl: string) => void;
  onDownload: (item: GeneratedMusicItem | GeneratedTTSItem) => void;
  onDelete: (item: GeneratedMusicItem | GeneratedTTSItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div
      className="mc-music-history-strip nodrag nopan nowheel mt-2 flex max-h-[136px] w-full flex-col gap-1.5 overflow-y-auto rounded-xl border border-white/12 bg-[#080a0d]/86 p-1.5"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {items.map((item) => {
        const isActive = item.audioUrl === activeAudioUrl;
        const isItemPlaying = item.audioUrl === playingAudioUrl;
        const description = mode === 'tts'
          ? ((item as GeneratedTTSItem).text || '语音片段')
          : ((item as GeneratedMusicItem).prompt || '音乐片段');
        const assetName = item.name || createAudioAssetName(mode, description, item.createdAt);
        const meta = mode === 'tts'
          ? [item.provider, item.model, (item as GeneratedTTSItem).voiceId].filter(Boolean).join(' / ')
          : [item.provider, item.model, (item as GeneratedMusicItem).duration ? `${(item as GeneratedMusicItem).duration}s` : ''].filter(Boolean).join(' / ');
        return (
          <div
            key={item.id || item.audioUrl}
            role="button"
            tabIndex={0}
            title={assetName}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(item.audioUrl);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              onSelect(item.audioUrl);
            }}
            className={cn(
              'mc-music-history-item flex w-full shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition',
              isActive
                ? 'border-emerald-300/45 bg-emerald-400/12 text-emerald-50 shadow-[0_0_14px_rgba(16,185,129,0.18)]'
                : 'border-white/10 bg-white/[0.035] text-zinc-300 hover:border-white/28 hover:bg-white/[0.07]'
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium">
                {mode === 'tts' ? <Mic className="h-3 w-3 shrink-0" /> : <Music className="h-3 w-3 shrink-0" />}
                <span className="truncate">{assetName}</span>
                {isActive && <span className="shrink-0 rounded bg-emerald-300/14 px-1.5 py-0.5 text-[9px] text-emerald-100">当前播放</span>}
              </span>
              <span className="mt-1 truncate pl-[18px] text-[9px] text-zinc-400">{description}</span>
              {meta && <span className="mt-0.5 truncate pl-[18px] text-[9px] text-zinc-500">{meta}</span>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                title="播放此素材"
                aria-label="播放此素材"
                onClick={(event) => {
                  event.stopPropagation();
                  onPlay(item.audioUrl);
                }}
                className="nodrag nopan flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.045] text-zinc-300 transition hover:border-emerald-300/35 hover:bg-emerald-500/12 hover:text-emerald-100"
              >
                {isItemPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                title="下载音频"
                aria-label="下载音频"
                onClick={(event) => {
                  event.stopPropagation();
                  onDownload(item);
                }}
                className="nodrag nopan flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.045] text-zinc-300 transition hover:border-white/25 hover:bg-white/[0.1] hover:text-white"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="删除音频"
                aria-label="删除音频"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(item);
                }}
                className="nodrag nopan flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.045] text-zinc-400 transition hover:border-red-300/35 hover:bg-red-500/12 hover:text-red-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 音乐模型过滤 - 只保留当前官方可用的音乐生成模型，排除TTS等其他模型
const MUSIC_MODEL_FILTER: Record<string, string[]> = {
  'minimax-audio': ['music-2.6', 'music-2.6-free'],
  suno: ['V5_5', 'V5', 'V4_5PLUS', 'V4_5', 'V4_5ALL', 'V4', 'V3_5'],
  'kie-suno': ['V5_5', 'V5', 'V4_5PLUS', 'V4_5', 'V4_5ALL', 'V4', 'V3_5'],
  elevenlabs: ['eleven-music-v1'],
};

function getProviderMusicModels(providerId: string, providerModels: string[]): string[] {
  const allowedModels = MUSIC_MODEL_FILTER[providerId] || [];
  if (allowedModels.length === 0) return [];

  const providerModelSet = new Set(providerModels);
  if (providerId === 'minimax-audio') {
    allowedModels.forEach((model) => providerModelSet.add(model));
  }
  return allowedModels.filter((model) => providerModelSet.has(model));
}

function normalizeAudioAssetNameSource(source: string): string {
  return source
    .replace(/@\[[^\]]+\]\([^)]*\)/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createAudioAssetName(mode: 'music' | 'tts', source?: string, createdAt = Date.now()): string {
  const prefix = mode === 'tts' ? '语音' : '音乐';
  const normalized = normalizeAudioAssetNameSource(source || '');
  if (normalized) {
    return `${prefix}-${normalized.slice(0, 14)}`;
  }
  return `${prefix}-${createdAt}`;
}

function toSafeAudioFilename(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  return `${safe || `audio-${Date.now()}`}.mp3`;
}

// ── TTS 模型过滤 ──
const TTS_MODEL_FILTER: Record<string, string[]> = {
  'minimax-audio': ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo', 'speech-02-hd', 'speech-02-turbo', 'speech-01-hd', 'speech-01-turbo'],
  elevenlabs: ['eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_flash_v2_5'],
};

// ── TTS 模型配置 ──
interface TTSModelConfig {
  displayName: string;
  hasSpeed: boolean;
  hasPitch: boolean;
  hasVol: boolean;
  hasStability: boolean;
  hasSimilarityBoost: boolean;
  speedRange: [number, number];
  pitchRange: [number, number];
  volRange: [number, number];
}

const TTS_MODEL_CONFIGS: Record<string, Record<string, TTSModelConfig>> = {
  'minimax-audio': {
    'speech-2.8-hd': { displayName: 'Speech 2.8 HD', hasSpeed: true, hasPitch: true, hasVol: true, hasStability: false, hasSimilarityBoost: false, speedRange: [0.5, 2.0], pitchRange: [-12, 12], volRange: [0.1, 10.0] },
    'speech-2.8-turbo': { displayName: 'Speech 2.8 Turbo', hasSpeed: true, hasPitch: true, hasVol: true, hasStability: false, hasSimilarityBoost: false, speedRange: [0.5, 2.0], pitchRange: [-12, 12], volRange: [0.1, 10.0] },
    'speech-2.6-hd': { displayName: 'Speech 2.6 HD', hasSpeed: true, hasPitch: true, hasVol: true, hasStability: false, hasSimilarityBoost: false, speedRange: [0.5, 2.0], pitchRange: [-12, 12], volRange: [0.1, 10.0] },
    'speech-2.6-turbo': { displayName: 'Speech 2.6 Turbo', hasSpeed: true, hasPitch: true, hasVol: true, hasStability: false, hasSimilarityBoost: false, speedRange: [0.5, 2.0], pitchRange: [-12, 12], volRange: [0.1, 10.0] },
    'speech-02-hd': { displayName: 'Speech 02 HD', hasSpeed: true, hasPitch: true, hasVol: true, hasStability: false, hasSimilarityBoost: false, speedRange: [0.5, 2.0], pitchRange: [-12, 12], volRange: [0.1, 10.0] },
    'speech-02-turbo': { displayName: 'Speech 02 Turbo', hasSpeed: true, hasPitch: true, hasVol: true, hasStability: false, hasSimilarityBoost: false, speedRange: [0.5, 2.0], pitchRange: [-12, 12], volRange: [0.1, 10.0] },
    'speech-01-hd': { displayName: 'Speech 01 HD', hasSpeed: true, hasPitch: true, hasVol: true, hasStability: false, hasSimilarityBoost: false, speedRange: [0.5, 2.0], pitchRange: [-12, 12], volRange: [0.1, 10.0] },
    'speech-01-turbo': { displayName: 'Speech 01 Turbo', hasSpeed: true, hasPitch: true, hasVol: true, hasStability: false, hasSimilarityBoost: false, speedRange: [0.5, 2.0], pitchRange: [-12, 12], volRange: [0.1, 10.0] },
  },
  elevenlabs: {
    'eleven_multilingual_v2': { displayName: 'Multilingual v2', hasSpeed: false, hasPitch: false, hasVol: false, hasStability: true, hasSimilarityBoost: true, speedRange: [1, 1], pitchRange: [0, 0], volRange: [1, 1] },
    'eleven_turbo_v2_5': { displayName: 'Turbo v2.5', hasSpeed: false, hasPitch: false, hasVol: false, hasStability: true, hasSimilarityBoost: true, speedRange: [1, 1], pitchRange: [0, 0], volRange: [1, 1] },
    'eleven_flash_v2_5': { displayName: 'Flash v2.5', hasSpeed: false, hasPitch: false, hasVol: false, hasStability: true, hasSimilarityBoost: true, speedRange: [1, 1], pitchRange: [0, 0], volRange: [1, 1] },
  },
};

// ── MiniMax TTS 常用音色 ──
const MINIMAX_VOICE_PRESETS = [
  { value: 'male-qn-qingse', label: '青涩男声' },
  { value: 'female-shaonv', label: '少女' },
  { value: 'male-qn-jingying', label: '精英男声' },
  { value: 'female-yujie', label: '御姐' },
  { value: 'male-qn-kefu', label: '客服男声' },
  { value: 'female-kefu', label: '客服女声' },
  { value: 'presenter_male', label: '男主持人' },
  { value: 'presenter_female', label: '女主持人' },
];

function findModelProvider(
  model: string,
  audioConfig: { providers: Record<string, ProviderConfig>; customProviders: Record<string, ProviderConfig> }
): { providerId: string; provider: ProviderConfig } | null {
  const all = { ...audioConfig.providers, ...audioConfig.customProviders };
  for (const [providerId, provider] of Object.entries(all)) {
    if (!provider.enabled || !provider.apiKey.trim()) continue;
    if (provider.models.includes(model) || getProviderMusicModels(providerId, provider.models).includes(model)) {
      return { providerId, provider };
    }
  }
  return null;
}

function getGeneratedMusic(data: MusicNodeData): GeneratedMusicItem[] {
  const map = new Map<string, GeneratedMusicItem>();
  const rawItems = Array.isArray(data.generatedMusic) ? data.generatedMusic : [];
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Partial<GeneratedMusicItem>;
    if (typeof r.audioUrl !== 'string' || !r.audioUrl) continue;
    map.set(r.audioUrl, {
      id: r.id || `music-${map.size}`,
      audioUrl: r.audioUrl,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
      name: r.name || createAudioAssetName('music', r.prompt, typeof r.createdAt === 'number' ? r.createdAt : 0),
      prompt: r.prompt,
      model: r.model,
      provider: r.provider,
      duration: r.duration,
    });
  }
  if (data.audioUrl && !map.has(data.audioUrl)) {
    map.set(data.audioUrl, {
      id: 'legacy-current-music',
      audioUrl: data.audioUrl,
      createdAt: 0,
      name: createAudioAssetName('music', data.prompt, 0),
    });
  }
  return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
}

function getGeneratedTTS(data: MusicNodeData): GeneratedTTSItem[] {
  const map = new Map<string, GeneratedTTSItem>();
  const rawItems = Array.isArray(data.generatedTTS) ? data.generatedTTS : [];
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Partial<GeneratedTTSItem>;
    if (typeof r.audioUrl !== 'string' || !r.audioUrl) continue;
    map.set(r.audioUrl, {
      id: r.id || `tts-${map.size}`,
      audioUrl: r.audioUrl,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
      name: r.name || createAudioAssetName('tts', r.text, typeof r.createdAt === 'number' ? r.createdAt : 0),
      text: r.text,
      model: r.model,
      provider: r.provider,
      voiceId: r.voiceId,
    });
  }
  if (data.ttsAudioUrl && !map.has(data.ttsAudioUrl)) {
    map.set(data.ttsAudioUrl, {
      id: 'legacy-current-tts',
      audioUrl: data.ttsAudioUrl,
      createdAt: 0,
      name: createAudioAssetName('tts', data.prompt || data.customPrompt, 0),
    });
  }
  return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
}

interface MusicApi {
  generateMusic: (params: { prompt: string; model: string; duration: number; style?: string; lyricsOptimizer?: boolean; isInstrumental?: boolean }) => Promise<{ task_id?: string; audioUrl?: string }>;
  queryMusicTask: (taskId: string) => Promise<{ audioUrl?: string; status?: string; fail_reason?: string }>;
}

function getMusicApiForProvider(providerId: string, provider: ProviderConfig): MusicApi {
  const isKieProvider = /api\.kie\.ai/i.test(provider.apiUrl || '');
  if (providerId === 'kie-suno' || (providerId === 'suno' && isKieProvider)) {
    const api = createKieSunoMusicAPI(provider);
    return {
      generateMusic: (p) => api.generateMusic(p),
      queryMusicTask: (id) => api.queryMusicTask(id),
    };
  }
  if (providerId === 'suno') {
    const api = createSunoMusicAPI(provider);
    return {
      generateMusic: (p) => api.generateMusic(p),
      queryMusicTask: (id) => api.queryMusicTask(id),
    };
  }
  if (providerId === 'elevenlabs') {
    const api = createElevenLabsMusicAPI(provider);
    return {
      generateMusic: (p) => api.generateMusic(p),
      queryMusicTask: (id) => api.queryMusicTask(id),
    };
  }
  // minimax-audio (default) or any custom provider using MiniMax-compatible API
  const api = createMiniMaxAudioAPI(provider);
  return {
    generateMusic: (p) => api.generateMusic(p),
    queryMusicTask: (id) => api.queryMusicTask(id),
  };
}

// ── TTS API ──

interface TTSApi {
  textToSpeech: (params: { model: string; text: string; voiceId: string; speed?: number; vol?: number; pitch?: number; stability?: number; similarityBoost?: number }) => Promise<{ audioUrl?: string }>;
}

function getTTSApiForProvider(providerId: string, provider: ProviderConfig): TTSApi {
  if (providerId === 'elevenlabs') {
    const api = createElevenLabsMusicAPI(provider);
    return {
      textToSpeech: (p) => api.textToSpeech({
        model: p.model,
        text: p.text,
        voiceId: p.voiceId,
        stability: p.stability,
        similarityBoost: p.similarityBoost,
      }),
    };
  }
  // minimax-audio (default) or MiniMax-compatible
  const api = createMiniMaxAudioAPI(provider);
  return {
    textToSpeech: (p) => api.textToSpeech({
      model: p.model,
      text: p.text,
      voiceId: p.voiceId,
      speed: p.speed,
      vol: p.vol,
      pitch: p.pitch,
    }),
  };
}

// 分析错误类型
function analyzeError(error: unknown): { message: string; errorType: 'config' | 'quota' | 'network' | 'unknown' } {
  const errMessage = error instanceof Error ? error.message : String(error);

  // 代理白名单 / 域名限制
  if (errMessage.includes('不在代理白名单') || errMessage.includes('not in') || errMessage.includes('allowlist')) {
    return { message: `【本地配置】代理域名限制：${errMessage.slice(0, 200)}。请在环境变量 OPENAI_PROXY_ALLOWED_HOSTS 中添加该域名。`, errorType: 'config' };
  }

  // 鉴权相关（MiniMax status_code 1004 / HTTP 401/403）
  if (errMessage.includes('status_code') && (errMessage.includes('1004') || errMessage.includes('401') || errMessage.includes('403'))) {
    return { message: '【本地配置】API Key 鉴权失败，请检查 provider 设置中的 API Key 是否正确。', errorType: 'config' };
  }
  if (errMessage.includes('401') || errMessage.includes('403') ||
      errMessage.includes('unauthorized') || errMessage.includes('Invalid API key') ||
      errMessage.includes('api key') || errMessage.includes('API key') ||
      errMessage.includes('invalid_api_key')) {
    return { message: '【本地配置】API Key 配置无效，请检查您的 API Key 是否正确。', errorType: 'config' };
  }

  // 模型参数不匹配（MiniMax status_code 2013）
  if (errMessage.includes('2013')) {
    return { message: `【模型参数不匹配】当前模型不支持发送的参数组合。${errMessage.slice(0, 300)}`, errorType: 'config' };
  }

  // 余额/额度（MiniMax status_code 1008 / HTTP 402）
  if (errMessage.includes('status_code') && (errMessage.includes('1008') || errMessage.includes('1001'))) {
    return { message: `【官方额度】${errMessage.includes('1008') ? '账户余额不足或套餐额度已用完' : '请求参数不合法' }。原始响应: ${errMessage.slice(0, 250)}`, errorType: 'quota' };
  }
  if (errMessage.includes('402') || errMessage.includes('quota') ||
      errMessage.includes('limit') || errMessage.includes('exceeded') ||
      errMessage.includes('insufficient') || errMessage.includes('billing')) {
    return { message: '【官方额度】API 额度不足，请检查您的账户余额或套餐。', errorType: 'quota' };
  }

  // 网络/代理问题
  if (errMessage.includes('network') || errMessage.includes('timeout') ||
      errMessage.includes('fetch') || errMessage.includes('500') ||
      errMessage.includes('502') || errMessage.includes('503') ||
      errMessage.includes('ECONNREFUSED') || errMessage.includes('ENOTFOUND')) {
    return { message: '【网络问题】连接失败，请检查网络连接和 API 地址是否正确。', errorType: 'network' };
  }

  // 代理拦截
  if (errMessage.includes('400') && (errMessage.includes('Proxy error') || errMessage.includes('proxy'))) {
    return { message: `【本地配置】代理请求失败: ${errMessage.slice(0, 300)}`, errorType: 'config' };
  }

  return { message: errMessage, errorType: 'unknown' };
}

function MusicNode({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const nodeData = data as MusicNodeData;
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);

  const isLoading = nodeData.isLoading === true;
  const generationProgress: GenerationProgress =
    typeof nodeData.generationProgress === 'object' && nodeData.generationProgress
      ? (nodeData.generationProgress as GenerationProgress)
      : { status: 'idle' as const, progress: 0, message: '等待生成...' };

  const setIsLoading = (v: boolean) => updateNodeData(id, { isLoading: v } as Partial<MusicNodeData>);
  const setGenerationProgress = (v: GenerationProgress) =>
    updateNodeData(id, { generationProgress: v } as Partial<MusicNodeData>);
  const isExpanded = useCanvasStore((state) => state.selectedNode?.id === id);
  const isGlowing = useCanvasStore((state) => state.glowingNodeIds.includes(id));
  const addGlowingNode = useCanvasStore((state) => state.addGlowingNode);
  const clearGlowingNode = useCanvasStore((state) => state.clearGlowingNode);
  const [historyPlayRequestId, setHistoryPlayRequestId] = useState(0);
  const [historyPauseRequestId, setHistoryPauseRequestId] = useState(0);
  const [playingAudioUrl, setPlayingAudioUrl] = useState('');
  const [playableAudioUrlByRef, setPlayableAudioUrlByRef] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isExpanded && isGlowing) {
      clearGlowingNode(id);
    }
  }, [isExpanded, isGlowing, id, clearGlowingNode]);

  const { audioConfig, setProviderRemainingTokens } = useSeedanceStore(useShallow((state) => ({
    audioConfig: state.config.audio,
    setProviderRemainingTokens: state.setProviderRemainingTokens,
  })));

  // Build provider options from all enabled & configured audio providers
  const providerOptions = useMemo(() => {
    const all = { ...audioConfig.providers, ...audioConfig.customProviders };
    return Object.entries(all)
      .filter(([, p]) => p.enabled && p.apiKey.trim())
      .map(([id, p]) => ({ value: id, label: p.label, models: p.models }));
  }, [audioConfig]);

  // Current provider — use saved id if still valid, else first available
  const currentProviderId = useMemo(() => {
    if (nodeData.providerId && providerOptions.some((p) => p.value === nodeData.providerId)) {
      return nodeData.providerId;
    }
    return providerOptions[0]?.value || '';
  }, [nodeData.providerId, providerOptions]);

  const currentProviderLabel = useMemo(() => {
    const all = { ...audioConfig.providers, ...audioConfig.customProviders };
    return all[currentProviderId]?.label || currentProviderId;
  }, [audioConfig, currentProviderId]);

  // Model options filtered by selected provider - 只显示音乐模型
  const modelOptions = useMemo(() => {
    const provider = providerOptions.find((p) => p.value === currentProviderId);
    if (!provider) return [];
    
    const musicModelsForProvider = getProviderMusicModels(currentProviderId, provider.models);

    return musicModelsForProvider
      .map((model) => {
        const config = PROVIDER_MODEL_CONFIGS[currentProviderId]?.[model];
        return {
          value: model,
          label: config?.displayName || model,
          providerId: currentProviderId,
          isMusicModel: config?.isMusicModel !== false,
        };
      });
  }, [providerOptions, currentProviderId]);

  // Auto-select first music model when provider changes or none selected
  const currentModel = useMemo(() => {
    if (nodeData.model && modelOptions.some((m) => m.value === nodeData.model)) {
      return nodeData.model;
    }
    return modelOptions[0]?.value || '';
  }, [nodeData.model, modelOptions]);

  // 获取当前模型的配置
  const currentModelConfig = useMemo(() => {
    if (!currentProviderId || !currentModel) return null;
    const providerConfig = PROVIDER_MODEL_CONFIGS[currentProviderId];
    if (!providerConfig) return null;
    return providerConfig[currentModel];
  }, [currentProviderId, currentModel]);

  // 获取当前模型的时长选项
  const currentDurationOptions = useMemo(() => {
    return currentModelConfig?.durationOptions || DEFAULT_DURATION_OPTIONS;
  }, [currentModelConfig]);

  const currentMusicProvider = useMemo(() => {
    const all = { ...audioConfig.providers, ...audioConfig.customProviders };
    return all[currentProviderId];
  }, [audioConfig, currentProviderId]);

  const currentMusicDuration = Number(nodeData.duration || currentDurationOptions[0]?.value || 30);
  const isKieMusicProvider = isKieApiProvider(currentMusicProvider, currentProviderId);
  const kieMusicTokenBucket = useSeedanceStore((state) =>
    getKieProviderTokenBucket(state.config.providerTokens, `audio.${currentProviderId}`)
  );
  const kieMusicUsage = useMemo(
    () =>
      buildKieUsageDisplay({
        kind: 'audio',
        providerId: currentProviderId,
        provider: currentMusicProvider,
        model: currentModel,
        duration: currentMusicDuration,
        bucket: kieMusicTokenBucket,
      }),
    [currentModel, currentMusicDuration, currentMusicProvider, currentProviderId, kieMusicTokenBucket]
  );

  const syncKieCredits = () => {
    if (!isKieMusicProvider) return;
    void fetchKieCredits(currentMusicProvider)
      .then((credits) => {
        if (credits != null) setProviderRemainingTokens(KIE_GLOBAL_PROVIDER_TOKEN_KEY, credits);
      })
      .catch(() => undefined);
  };

  // ── TTS 模式 ──
  const mode = (nodeData.mode || 'music') as 'music' | 'tts';

  // 可提供 TTS 的厂商（仅有 TTS 模型的厂商）
  const ttsProviderOptions = useMemo(() => {
    return providerOptions.filter((p) => {
      const ttsModels = TTS_MODEL_FILTER[p.value];
      if (!ttsModels || ttsModels.length === 0) return false;
      return p.models.some((m) => ttsModels.includes(m));
    });
  }, [providerOptions]);

  const currentTTSProviderId = useMemo(() => {
    if (nodeData.ttsProviderId && ttsProviderOptions.some((p) => p.value === nodeData.ttsProviderId)) {
      return nodeData.ttsProviderId;
    }
    return ttsProviderOptions[0]?.value || '';
  }, [nodeData.ttsProviderId, ttsProviderOptions]);

  const currentTTSProviderConfig = useMemo(() => {
    if (!currentTTSProviderId) return undefined;
    const all = { ...audioConfig.providers, ...audioConfig.customProviders };
    return all[currentTTSProviderId];
  }, [audioConfig, currentTTSProviderId]);

  // TTS model options
  const ttsModelOptions = useMemo(() => {
    const provider = ttsProviderOptions.find((p) => p.value === currentTTSProviderId);
    if (!provider) return [];
    const filter = TTS_MODEL_FILTER[currentTTSProviderId] || [];
    return provider.models
      .filter((model) => filter.includes(model))
      .map((model) => {
        const config = TTS_MODEL_CONFIGS[currentTTSProviderId]?.[model];
        return { value: model, label: config?.displayName || model, providerId: currentTTSProviderId };
      });
  }, [ttsProviderOptions, currentTTSProviderId]);

  const currentTTSModel = useMemo(() => {
    if (nodeData.ttsModel && ttsModelOptions.some((m) => m.value === nodeData.ttsModel)) {
      return nodeData.ttsModel;
    }
    return ttsModelOptions[0]?.value || '';
  }, [nodeData.ttsModel, ttsModelOptions]);

  const currentTTSModelConfig = useMemo(() => {
    if (!currentTTSProviderId || !currentTTSModel) return null;
    return TTS_MODEL_CONFIGS[currentTTSProviderId]?.[currentTTSModel] || null;
  }, [currentTTSProviderId, currentTTSModel]);

  // TTS 音色选项（MiniMax 预置 + 自定义 voice_id）
  const ttsVoicePresets = useMemo(() => {
    if (currentTTSProviderId === 'minimax-audio') return MINIMAX_VOICE_PRESETS;
    return [];
  }, [currentTTSProviderId]);

  const ttsVoicePresetValues = useMemo(
    () => new Set(ttsVoicePresets.map((voice) => voice.value)),
    [ttsVoicePresets]
  );
  const ttsVoiceId = nodeData.ttsVoiceId?.trim() || '';
  const isMinimaxTTSProvider = currentTTSProviderId === 'minimax-audio';
  const isCustomTTSVoice =
    isMinimaxTTSProvider &&
    (nodeData.ttsVoiceMode === 'custom' || (ttsVoiceId.length > 0 && !ttsVoicePresetValues.has(ttsVoiceId)));
  const ttsVoiceSelectValue = isCustomTTSVoice
    ? CUSTOM_TTS_VOICE_VALUE
    : (ttsVoiceId && ttsVoicePresetValues.has(ttsVoiceId) ? ttsVoiceId : DEFAULT_MINIMAX_TTS_VOICE_ID);

  const upstreamPromptSources = useIncomingPromptSources(id);
  const upstreamPrompt = useMemo(
    () => composePrompt(upstreamPromptSources.map((s) => s.text).filter((t) => t.trim())),
    [upstreamPromptSources]
  );

  const localPrompt = useMemo(() => {
    if (typeof nodeData.customPrompt === 'string' && (nodeData.promptEdited || nodeData.customPrompt.length > 0)) {
      return nodeData.customPrompt;
    }
    return nodeData.prompt || upstreamPrompt || nodeData.customPrompt || '';
  }, [nodeData.customPrompt, nodeData.prompt, nodeData.promptEdited, upstreamPrompt]);

  const sanitizedPrompt = localPrompt;

  const canGenerate = useMemo(() => {
    const mp = findModelProvider(currentModel, audioConfig);
    return Boolean(sanitizedPrompt.trim()) && Boolean(mp?.provider.apiKey);
  }, [currentModel, audioConfig, sanitizedPrompt]);

  const generatedMusic = useMemo(() => getGeneratedMusic(nodeData), [nodeData]);
  const activeAudioUrl = nodeData.audioUrl || generatedMusic[0]?.audioUrl || '';
  const activeMusicItem = useMemo(
    () => generatedMusic.find((item) => item.audioUrl === activeAudioUrl),
    [activeAudioUrl, generatedMusic]
  );

  // TTS generated data
  const generatedTTS = useMemo(() => getGeneratedTTS(nodeData), [nodeData]);
  const activeTtsAudioUrl = nodeData.ttsAudioUrl || generatedTTS[0]?.audioUrl || '';
  const activeTtsItem = useMemo(
    () => generatedTTS.find((item) => item.audioUrl === activeTtsAudioUrl),
    [activeTtsAudioUrl, generatedTTS]
  );

  // active audio URL for current mode
  const currentActiveAudioUrl = mode === 'tts' ? activeTtsAudioUrl : activeAudioUrl;
  const currentPlayableAudioUrl = isAudioIdbRef(currentActiveAudioUrl)
    ? playableAudioUrlByRef[currentActiveAudioUrl] || ''
    : currentActiveAudioUrl;
  const currentHistoryItems: Array<GeneratedMusicItem | GeneratedTTSItem> = mode === 'tts' ? generatedTTS : generatedMusic;

  useEffect(() => {
    if (!currentActiveAudioUrl || !isAudioIdbRef(currentActiveAudioUrl)) return;
    if (playableAudioUrlByRef[currentActiveAudioUrl]) return;

    let cancelled = false;
    void hydratePersistedAudioUrl(currentActiveAudioUrl).then((url) => {
      if (cancelled || !url || isAudioIdbRef(url)) return;
      setPlayableAudioUrlByRef((prev) =>
        prev[currentActiveAudioUrl] === url ? prev : { ...prev, [currentActiveAudioUrl]: url }
      );
    });

    return () => {
      cancelled = true;
    };
  }, [currentActiveAudioUrl, playableAudioUrlByRef]);

  const handleSelectHistoryItem = useCallback((audioUrl: string) => {
    if (mode === 'tts') updateNodeData(id, { ttsAudioUrl: audioUrl });
    else updateNodeData(id, { audioUrl });
  }, [id, mode, updateNodeData]);

  const handlePlayHistoryItem = useCallback((audioUrl: string) => {
    if (playingAudioUrl === audioUrl) {
      setHistoryPauseRequestId((value) => value + 1);
      return;
    }
    if (mode === 'tts') updateNodeData(id, { ttsAudioUrl: audioUrl });
    else updateNodeData(id, { audioUrl });
    setHistoryPlayRequestId((value) => value + 1);
  }, [id, mode, playingAudioUrl, updateNodeData]);

  const handleDeleteHistoryItem = useCallback((item: GeneratedMusicItem | GeneratedTTSItem) => {
    const isSameItem = (entry: GeneratedMusicItem | GeneratedTTSItem) => (
      item.id
        ? entry.id === item.id
        : entry.audioUrl === item.audioUrl
    );

    if (mode === 'tts') {
      const nextItems = generatedTTS.filter((entry) => !isSameItem(entry));
      updateNodeData(id, {
        generatedTTS: nextItems,
        ttsAudioUrl: activeTtsAudioUrl === item.audioUrl ? nextItems[0]?.audioUrl || '' : activeTtsAudioUrl,
      });
      return;
    }

    const nextItems = generatedMusic.filter((entry) => !isSameItem(entry));
    updateNodeData(id, {
      generatedMusic: nextItems,
      audioUrl: activeAudioUrl === item.audioUrl ? nextItems[0]?.audioUrl || '' : activeAudioUrl,
    });
  }, [activeAudioUrl, activeTtsAudioUrl, generatedMusic, generatedTTS, id, mode, updateNodeData]);

  const promptBoxSize = nodeData.promptBoxSize || DEFAULT_PROMPT_BOX_SIZE;
  const selectedNodeWidth = Math.max(280, promptBoxSize.width + 26);
  const editPromptBoxSize = useMemo(
    () => ({
      width: Math.max(MUSIC_EDIT_PANEL_WIDTH - 24, promptBoxSize.width),
      height: Math.max(96, promptBoxSize.height),
    }),
    [promptBoxSize.height, promptBoxSize.width]
  );

  // 处理厂商变更
  const handleProviderChange = (value: string | null) => {
    if (!value) return;
    const provider = providerOptions.find((p) => p.value === value);
    const musicModelsForProvider = getProviderMusicModels(value, provider?.models || []);
    const firstMusicModel = musicModelsForProvider[0] || '';
    updateNodeData(id, {
      providerId: value,
      model: firstMusicModel,
      // 重置模型特定参数
      sunoStyle: undefined,
      elevenLabsStyle: undefined,
    });
  };

  // 处理模型变更
  const handleModelChange = (value: string | null) => {
    if (!value) return;
    updateNodeData(id, { 
      model: value,
      // 重置模型特定参数
      sunoStyle: undefined,
      elevenLabsStyle: undefined,
    });
  };

  // 处理时长变更
  const handleDurationChange = (value: string | null) => {
    if (value) updateNodeData(id, { duration: parseInt(value) as MusicNodeData['duration'] });
  };

  // 处理风格变更
  const handleStyleChange = (value: string | null) => {
    if (!value) {
      updateNodeData(id, { sunoStyle: undefined });
      return;
    }
    updateNodeData(id, { sunoStyle: value });
  };

  // ── TTS 处理函数 ──

  const handleTTSProviderChange = (value: string | null) => {
    if (!value) return;
    const provider = ttsProviderOptions.find((p) => p.value === value);
    const ttsModels = TTS_MODEL_FILTER[value] || [];
    const firstModel = provider?.models.find((m) => ttsModels.includes(m)) || '';
    updateNodeData(id, {
      ttsProviderId: value,
      ttsModel: firstModel,
      ttsVoiceId: undefined,
      ttsVoiceMode: undefined,
    });
  };

  const handleTTSModelChange = (value: string | null) => {
    if (!value) return;
    updateNodeData(id, { ttsModel: value, ttsVoiceId: undefined, ttsVoiceMode: undefined });
  };

  const handleTTSVoiceIdChange = (value: string | null) => {
    if (!value) return;
    if (value === CUSTOM_TTS_VOICE_VALUE) {
      updateNodeData(id, { ttsVoiceId: undefined, ttsVoiceMode: 'custom' });
      return;
    }
    updateNodeData(id, { ttsVoiceId: value, ttsVoiceMode: 'preset' });
  };

  const commitGeneratedTTS = async (params: {
    audioUrl: string;
    text: string;
    model: string;
    provider: string;
    voiceId: string;
  }) => {
    const createdAt = Date.now();
    const itemId = `tts-${createdAt}`;
    const audioUrl = await persistGeneratedAudioUrl(id, 'tts', itemId, params.audioUrl);
    const nextTTS: GeneratedTTSItem = {
      id: itemId,
      audioUrl,
      createdAt,
      name: createAudioAssetName('tts', params.text, createdAt),
      text: params.text,
      model: params.model,
      provider: params.provider,
      voiceId: params.voiceId,
    };
    const retained = generatedTTS.filter((item) => item.audioUrl !== nextTTS.audioUrl);
    updateNodeData(id, {
      ttsAudioUrl: nextTTS.audioUrl,
      generatedTTS: [nextTTS, ...retained].slice(0, 20),
    });
    addGlowingNode(id);
  };

  const handleTTSGenerate = async () => {
    const ttsProviderLabel = (() => {
      const all = { ...audioConfig.providers, ...audioConfig.customProviders };
      return all[currentTTSProviderId]?.label || currentTTSProviderId;
    })();

    const mp = findModelProvider(currentTTSModel, audioConfig);
    if (!mp) {
      setGenerationProgress({ status: 'error', progress: 0, message: '未找到对应提供方配置，请在 API 设置中检查', errorType: 'config' });
      return;
    }

    if (!sanitizedPrompt.trim()) {
      setGenerationProgress({ status: 'error', progress: 0, message: '请输入要合成的文字', errorType: 'config' });
      return;
    }

    const providerVoiceId = currentTTSProviderConfig?.voiceId?.trim() || '';
    const fallbackVoiceId = currentTTSProviderId === 'minimax-audio'
      ? DEFAULT_MINIMAX_TTS_VOICE_ID
      : DEFAULT_ELEVENLABS_TTS_VOICE_ID;
    const explicitVoiceId = nodeData.ttsVoiceId?.trim() || '';
    const voiceId = (isCustomTTSVoice
      ? (explicitVoiceId || providerVoiceId)
      : (explicitVoiceId || providerVoiceId || fallbackVoiceId)
    ).trim();
    if (isCustomTTSVoice && !voiceId) {
      setGenerationProgress({ status: 'error', progress: 0, message: '请选择或输入自定义音色 voice_id', errorType: 'config' });
      return;
    }
    const modelDisplayName = currentTTSModelConfig?.displayName || currentTTSModel;

    setIsLoading(true);
    setGenerationProgress({
      status: 'submitting',
      progress: 12,
      message: `正在合成语音（${ttsProviderLabel} / ${modelDisplayName} / ${voiceId}）...`,
    });

    try {
      const ttsApi = getTTSApiForProvider(mp.providerId, mp.provider);
      const text = sanitizedPrompt.trim();
      const config = currentTTSModelConfig;

      const result = await ttsApi.textToSpeech({
        model: currentTTSModel,
        text,
        voiceId,
        speed: config?.hasSpeed ? (nodeData.ttsSpeed ?? 1.0) : undefined,
        vol: config?.hasVol ? (nodeData.ttsVol ?? 1.0) : undefined,
        pitch: config?.hasPitch ? (nodeData.ttsPitch ?? 0) : undefined,
        stability: config?.hasStability ? (nodeData.ttsStability ?? 0.5) : undefined,
        similarityBoost: config?.hasSimilarityBoost ? (nodeData.ttsSimilarityBoost ?? 0.75) : undefined,
      });

      if (result.audioUrl) {
        await commitGeneratedTTS({
          audioUrl: result.audioUrl,
          text,
          model: currentTTSModel,
          provider: mp.providerId,
          voiceId,
        });
        setGenerationProgress({ status: 'success', progress: 100, message: `语音合成成功（${ttsProviderLabel}）` });
      } else {
        setGenerationProgress({
          status: 'error',
          progress: 0,
          message: '语音合成失败，API 未返回音频数据。请检查 provider 配置和 API Key 是否正确。',
          errorType: 'config',
        });
      }
    } catch (error) {
      console.error('[MusicNode] TTS error:', error);
      const errorAnalysis = analyzeError(error);
      setGenerationProgress({
        status: 'error',
        progress: 0,
        message: errorAnalysis.message,
        errorType: errorAnalysis.errorType,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const commitGeneratedMusic = async (params: {
    audioUrl: string;
    prompt: string;
    model: string;
    provider: string;
    duration: number;
  }) => {
    const createdAt = Date.now();
    const itemId = `music-${createdAt}`;
    const audioUrl = await persistGeneratedAudioUrl(id, 'music', itemId, params.audioUrl);
    const nextMusic: GeneratedMusicItem = {
      id: itemId,
      audioUrl,
      createdAt,
      name: createAudioAssetName('music', params.prompt, createdAt),
      prompt: params.prompt,
      model: params.model,
      provider: params.provider,
      duration: params.duration,
    };
    const retained = generatedMusic.filter((item) => item.audioUrl !== nextMusic.audioUrl);
    updateNodeData(id, {
      audioUrl: nextMusic.audioUrl,
      generatedMusic: [nextMusic, ...retained].slice(0, 20),
      status: 'success',
    });
    addGlowingNode(id);
  };

  const handleGenerate = async () => {
    console.log('[MusicNode] handleGenerate called', {
      currentProviderId,
      currentModel,
      sanitizedPromptLength: sanitizedPrompt.length,
    });
    
    const mp = findModelProvider(currentModel, audioConfig);
    if (!mp) {
      console.error('[MusicNode] No model provider found');
      setGenerationProgress({ 
        status: 'error', 
        progress: 0, 
        message: '未找到对应提供方配置，请在 API 设置中检查',
        errorType: 'config' 
      });
      return;
    }
    
    console.log('[MusicNode] Found provider', {
      providerId: mp.providerId,
      providerLabel: mp.provider.label,
    });
    
    if (!sanitizedPrompt.trim()) {
      console.warn('[MusicNode] Empty prompt');
      setGenerationProgress({ 
        status: 'error', 
        progress: 0, 
        message: '请输入音乐描述',
        errorType: 'config' 
      });
      return;
    }

    let succeeded = false;
    setIsLoading(true);
    const modelDisplayName = currentModelConfig?.displayName || currentModel;
    setGenerationProgress({
      status: 'submitting',
      progress: 12,
      message: `正在提交音乐生成（${mp.provider.label} / ${modelDisplayName}）...`,
    });

    try {
      const musicApi = getMusicApiForProvider(mp.providerId, mp.provider);
      const prompt = sanitizedPrompt.trim();
      // MiniMax 模型按当前规格决定是否发送 duration
      const musicSpec = currentProviderId === 'minimax-audio' ? getMusicModelSpec(currentModel) : null;
      const duration = musicSpec?.supportsDuration ? (nodeData.duration || 60) : (nodeData.duration || 30);
      const style = currentProviderId === 'suno' || currentProviderId === 'kie-suno' ? nodeData.sunoStyle : undefined;
      const useMiniMaxLyricsOptimizer =
        currentProviderId === 'minimax-audio' &&
        (currentModel === 'music-2.6' || currentModel === 'music-2.6-free') &&
        musicSpec?.supportsLyrics === true;

      console.log('[MusicNode] Calling generateMusic', {
        promptLength: prompt.length,
        model: currentModel,
        duration,
        durationSent: musicSpec ? musicSpec.supportsDuration : true,
        hasStyle: !!style,
        lyricsOptimizer: useMiniMaxLyricsOptimizer,
      });

      const result = await musicApi.generateMusic({
        prompt,
        model: currentModel,
        duration,
        style,
        lyricsOptimizer: useMiniMaxLyricsOptimizer,
      });
      
      console.log('[MusicNode] generateMusic result:', result);

      if (result.task_id) {
        setGenerationProgress({
          status: 'processing',
          progress: 25,
          message: `任务已提交 ${result.task_id.slice(0, 8)}（${mp.provider.label}）...`,
        });

        let attempts = 0;
        const maxAttempts = 120;
        const interval = 3000;

        while (attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, interval));
          attempts++;
          const queryResult = await musicApi.queryMusicTask(result.task_id);

          if (queryResult.audioUrl) {
            succeeded = true;
            await commitGeneratedMusic({
              audioUrl: queryResult.audioUrl,
              prompt,
              model: currentModel,
              provider: mp.providerId,
              duration,
            });
            syncKieCredits();
            setGenerationProgress({ status: 'success', progress: 100, message: `音乐生成成功（${mp.provider.label}）` });
            return;
          }

          if (queryResult.status === 'failed' || queryResult.fail_reason) {
            const errorAnalysis = analyzeError(queryResult.fail_reason || '生成失败');
            setGenerationProgress({
              status: 'error',
              progress: 0,
              message: errorAnalysis.message,
              errorType: errorAnalysis.errorType,
            });
            return;
          }

          setGenerationProgress({
            status: 'processing',
            progress: 25 + Math.min(70, attempts * 3),
            message: `${mp.provider.label} 处理中...（${attempts}/${maxAttempts}）`,
          });
        }

        setGenerationProgress({ 
          status: 'error', 
          progress: 0, 
          message: '生成超时，请重试',
          errorType: 'network' 
        });
      } else if (result.audioUrl) {
        succeeded = true;
        await commitGeneratedMusic({
          audioUrl: result.audioUrl,
          prompt,
          model: currentModel,
          provider: mp.providerId,
          duration,
        });
        syncKieCredits();
        setGenerationProgress({ status: 'success', progress: 100, message: `音乐生成成功（${mp.provider.label}）` });
      } else {
        const respSnippet = JSON.stringify(result).slice(0, 200);
        console.error('[MusicNode] No task_id in response:', respSnippet);
        setGenerationProgress({
          status: 'error',
          progress: 0,
          message: `任务提交失败，API 未返回 task_id（响应: ${respSnippet}）。请检查 provider 配置和 API Key 是否正确。`,
          errorType: 'config'
        });
      }
    } catch (error) {
      console.error('[MusicNode] Generation error:', error);
      const errorAnalysis = analyzeError(error);
      console.error('[MusicNode] Error analysis:', errorAnalysis);
      setGenerationProgress({
        status: 'error',
        progress: 0,
        message: errorAnalysis.message,
        errorType: errorAnalysis.errorType,
      });
    } finally {
      setIsLoading(false);
      if (succeeded) {
        setTimeout(() => {
          setGenerationProgress({ status: 'idle', progress: 0, message: '等待生成...' });
        }, 3000);
      }
    }
  };

  useAgentGenerationBridge(
    id,
    async () => {
      if (nodeData.mode === 'tts') await handleTTSGenerate();
      else await handleGenerate();
    },
    generationProgress,
  );

  const downloadAudioUrl = useCallback(async (url: string, filename = `audio-${Date.now()}.mp3`) => {
    if (!url) return;
    try {
      const resolvedUrl = await hydratePersistedAudioUrl(url);
      if (!resolvedUrl || isAudioIdbRef(resolvedUrl)) {
        throw new Error('音频素材尚未完成本地恢复');
      }
      const response = await fetch(resolvedUrl);
      const blob = await response.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch (error) {
      console.error('下载失败:', error);
    }
  }, []);

  const handleDownload = useCallback(async () => {
    const url = mode === 'tts' ? activeTtsAudioUrl : activeAudioUrl;
    const activeItem = mode === 'tts' ? activeTtsItem : activeMusicItem;
    await downloadAudioUrl(url, toSafeAudioFilename(activeItem?.name || createAudioAssetName(mode, mode === 'tts' ? activeTtsItem?.text : activeMusicItem?.prompt)));
  }, [activeAudioUrl, activeMusicItem, activeTtsAudioUrl, activeTtsItem, downloadAudioUrl, mode]);

  const handleDownloadHistoryItem = useCallback(async (item: GeneratedMusicItem | GeneratedTTSItem) => {
    const source = mode === 'tts' ? (item as GeneratedTTSItem).text : (item as GeneratedMusicItem).prompt;
    await downloadAudioUrl(item.audioUrl, toSafeAudioFilename(item.name || createAudioAssetName(mode, source, item.createdAt)));
  }, [downloadAudioUrl, mode]);

  const previewText = mode === 'tts'
    ? (activeTtsAudioUrl ? (activeTtsItem?.text || sanitizedPrompt || '已合成语音') : (sanitizedPrompt || '语音合成'))
    : (activeAudioUrl ? activeMusicItem?.prompt || sanitizedPrompt || '已生成音乐' : sanitizedPrompt || '音乐生成');

  const isGenerating = isLoading || generationProgress.status === 'submitting' || generationProgress.status === 'processing';
  const generationPercent = Math.max(0, Math.min(100, generationProgress.progress || 0));
  const previewFrame = (
    <div
      ref={previewFrameRef}
      data-tutorial-id="music-preview-panel"
      data-tutorial-node-id={id}
      className="w-full overflow-visible"
    >
      <AudioWaveformFrame
        title={nodeData.label}
        mode={mode}
        audioUrl={currentPlayableAudioUrl}
        trackingAudioUrl={currentActiveAudioUrl}
        prompt={previewText}
        badge={mode === 'tts' ? (activeTtsItem?.voiceId || nodeData.ttsVoiceId || 'TTS') : `${activeMusicItem?.duration || nodeData.duration || 30}s`}
        isLoading={isGenerating}
        progress={generationPercent}
        etaKey={`audio:${mode}:${currentProviderId}:${currentModel}`}
        etaSessionKey={`audio:${id}`}
        etaBaselineSeconds={mode === 'tts' ? 60 : 180}
        statusMessage={generationProgress.message}
        isGlowing={isGlowing}
        onDownload={handleDownload}
        onModeChange={(nextMode) => updateNodeData(id, { mode: nextMode })}
        playRequestId={historyPlayRequestId}
        pauseRequestId={historyPauseRequestId}
        onPlayingAudioUrlChange={setPlayingAudioUrl}
      />
      <AudioHistoryStrip
        sourceNodeId={id}
        mode={mode}
        items={currentHistoryItems}
        activeAudioUrl={currentActiveAudioUrl}
        playingAudioUrl={playingAudioUrl}
        onSelect={handleSelectHistoryItem}
        onPlay={handlePlayHistoryItem}
        onDownload={handleDownloadHistoryItem}
        onDelete={handleDeleteHistoryItem}
      />
    </div>
  );

  if (!isExpanded) {
    return (
      <div className={cn('mc-node-edit-anchor relative w-[360px] overflow-visible', isGlowing && 'mc-node-success-glow', isGenerating && 'mc-node-generating-fade')}>
        <Handle type="target" position={Position.Left} id="input" className="mc-node-handle" />
        {previewFrame}
        <Handle type="source" position={Position.Right} id="output" className="mc-node-handle" />
      </div>
    );
  }

  return (
    <div className={cn('mc-node-edit-anchor relative w-[360px] overflow-visible', isGlowing && 'mc-node-success-glow')}>
      <div className={cn('relative w-[360px] overflow-visible', isGenerating && 'mc-node-generating-fade')}>
        <Handle type="target" position={Position.Left} id="input" className="mc-node-handle" />
        {previewFrame}
        <Handle type="source" position={Position.Right} id="output" className="mc-node-handle" />
      </div>

      <ScreenSpaceNodePanel
        anchorRef={previewFrameRef}
        width={Math.max(MUSIC_EDIT_PANEL_WIDTH, selectedNodeWidth)}
        data-tutorial-id="music-editor-panel"
        data-tutorial-node-id={id}
        className={cn(
          'mc-music-edit-panel mc-node-expanded mc-node-edit-panel mc-node-screen-space-panel nodrag nopan nowheel max-h-[560px] overflow-x-hidden overflow-y-auto rounded-xl border border-white/22 bg-[#080a0d]/92 transition-colors mc-dur-12f',
          selected || isExpanded
            ? 'shadow-[0_0_32px_rgba(255,255,255,0.14),0_22px_50px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.2)]'
            : 'border-slate-300/10 hover:border-slate-300/18'
        )}
      >
      {/* Content */}
      <div className="p-3 space-y-3">
        {/* Prompt Input */}
        <div>
          <label className="text-[10px] text-zinc-500 mb-1 block">
            {mode === 'tts'
              ? (upstreamPrompt ? '合成文本（来自上游，可编辑）' : '合成文本')
              : (upstreamPrompt ? '音乐描述（来自上游，可编辑）' : '音乐描述')
            }
          </label>
          <ExpandableTextField
            title={mode === 'tts' ? '合成文本' : '音乐描述'}
            value={sanitizedPrompt}
            onChange={(next) => updateNodeData(id, { customPrompt: next, promptEdited: true })}
            placeholder={mode === 'tts' ? '输入要合成语音的文字…' : '描述你想生成的音乐风格、情绪、乐器…'}
          >
            <MentionTextarea
              value={sanitizedPrompt}
              onChange={(next) => updateNodeData(id, { customPrompt: next, promptEdited: true })}
              materials={[]}
              placeholder={mode === 'tts' ? '输入要合成语音的文字…' : '描述你想生成的音乐风格、情绪、乐器…'}
              minHeight="min-h-[56px]"
              minResizeWidth={MUSIC_EDIT_PANEL_WIDTH - 24}
              minResizeHeight={96}
              size={editPromptBoxSize}
              onSizeChange={(size) => updateNodeData(id, { promptBoxSize: size })}
              className="mc-node-frost-surface !border-white/10 !text-xs focus:!border-white/40 focus:!shadow-[0_0_12px_rgba(255,255,255,0.12)]"
            />
          </ExpandableTextField>
        </div>

        {mode === 'music' ? (
          <>
            {/* ── 音乐模式 ── */}
            <div className="space-y-2">
              {/* Provider selector */}
              <div>
                <label className="text-[10px] text-zinc-500 mb-1 block">厂商</label>
                <Select
                  value={currentProviderId}
                  onValueChange={handleProviderChange}
                  className="h-8 text-xs"
                >
                  {providerOptions.length === 0 ? (
                    <SelectItem value="" disabled>暂无可用厂商</SelectItem>
                  ) : (
                    providerOptions.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))
                  )}
                </Select>
              </div>
              {/* Model + Duration row */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-zinc-500 mb-1 block">模型</label>
                  <Select value={currentModel} onValueChange={handleModelChange} className="h-8 text-xs">
                    {modelOptions.length === 0 ? (
                      <SelectItem value="" disabled>暂无可用模型</SelectItem>
                    ) : (
                      modelOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))
                    )}
                  </Select>
                </div>
                {currentDurationOptions.length > 0 ? (
                  <div>
                    <label className="text-[10px] text-zinc-500 mb-1 block">时长</label>
                    <Select
                      value={String(nodeData.duration || currentDurationOptions[0]?.value || 30)}
                      onValueChange={handleDurationChange}
                      className="h-8 text-xs"
                    >
                      {currentDurationOptions.map((opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                      ))}
                    </Select>
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] text-zinc-500 mb-1 block">时长</label>
                    <div className="text-[11px] text-zinc-400 h-8 flex items-center">由 prompt 决定</div>
                  </div>
                )}
              </div>
              {currentModelConfig?.hasStyleOption && currentModelConfig.styleOptions && (
                <div>
                  <label className="text-[10px] text-zinc-500 mb-1 block">
                    <Settings2 className="w-3 h-3 inline mr-1" />
                    音乐风格
                  </label>
                  <Select value={nodeData.sunoStyle || ''} onValueChange={handleStyleChange} className="h-8 text-xs">
                    <SelectItem value="">不指定风格</SelectItem>
                    {currentModelConfig.styleOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* ── 语音模式 ── */}
            <div className="space-y-2">
              {/* Provider */}
              <div>
                <label className="text-[10px] text-zinc-500 mb-1 block">厂商</label>
                <Select value={currentTTSProviderId} onValueChange={handleTTSProviderChange} className="h-8 text-xs">
                  {ttsProviderOptions.length === 0 ? (
                    <SelectItem value="" disabled>暂无 TTS 厂商</SelectItem>
                  ) : (
                    ttsProviderOptions.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))
                  )}
                </Select>
              </div>
              {/* Model + Voice */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-zinc-500 mb-1 block">模型</label>
                  <Select value={currentTTSModel} onValueChange={handleTTSModelChange} className="h-8 text-xs">
                    {ttsModelOptions.length === 0 ? (
                      <SelectItem value="" disabled>暂无 TTS 模型</SelectItem>
                    ) : (
                      ttsModelOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))
                    )}
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 mb-1 block">音色</label>
                  {ttsVoicePresets.length > 0 ? (
                    <Select
                      value={ttsVoiceSelectValue}
                      onValueChange={handleTTSVoiceIdChange}
                      className="h-8 text-xs"
                    >
                      {ttsVoicePresets.map((v) => (
                        <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_TTS_VOICE_VALUE}>自定义 / 音色管理...</SelectItem>
                    </Select>
                  ) : (
                    <Input
                      value={nodeData.ttsVoiceId || ''}
                      onChange={(e) => updateNodeData(id, { ttsVoiceId: e.target.value, ttsVoiceMode: 'custom' })}
                      placeholder="输入 voice_id"
                      className="h-8 border-white/10 bg-black/20 text-[11px] text-zinc-200 placeholder:text-zinc-500 focus-visible:border-white/30"
                    />
                  )}
                </div>
              </div>
              {isCustomTTSVoice && (
                <div className="space-y-2 rounded-lg border border-white/8 bg-white/[0.025] p-2.5">
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-zinc-500 mb-1 block">自定义 voice_id</label>
                    <Input
                      value={nodeData.ttsVoiceId || ''}
                      onChange={(e) => updateNodeData(id, { ttsVoiceId: e.target.value, ttsVoiceMode: 'custom' })}
                      placeholder={currentTTSProviderConfig?.voiceId ? `默认：${currentTTSProviderConfig.voiceId}` : '输入或从下方音色管理中选择 voice_id'}
                      className="h-8 border-white/10 bg-black/20 text-[11px] text-zinc-200 placeholder:text-zinc-500 focus-visible:border-white/30"
                    />
                  </div>
                  {isMinimaxTTSProvider && (
                    <MiniMaxVoiceManager
                      apiKey={(currentTTSProviderConfig?.apiKey || audioConfig.providers['minimax-audio']?.apiKey || '').trim()}
                      selectedVoiceId={nodeData.ttsVoiceId || ''}
                      onSelectVoice={(voiceId) => updateNodeData(id, { ttsVoiceId: voiceId, ttsVoiceMode: 'custom' })}
                    />
                  )}
                </div>
              )}
              {/* TTS Parameters */}
              <div className="grid grid-cols-3 gap-2">
                {currentTTSModelConfig?.hasSpeed && (
                  <div>
                    <label className="text-[10px] text-zinc-500 mb-1 block">
                      语速 <span className="text-zinc-600">{((nodeData.ttsSpeed ?? 1.0)).toFixed(1)}</span>
                    </label>
                    <input
                      type="range"
                      min={currentTTSModelConfig.speedRange[0]}
                      max={currentTTSModelConfig.speedRange[1]}
                      step={0.1}
                      value={nodeData.ttsSpeed ?? 1.0}
                      onChange={(e) => updateNodeData(id, { ttsSpeed: parseFloat(e.target.value) })}
                      className="w-full h-1 accent-violet-400"
                    />
                  </div>
                )}
                {currentTTSModelConfig?.hasPitch && (
                  <div>
                    <label className="text-[10px] text-zinc-500 mb-1 block">
                      音调 <span className="text-zinc-600">{nodeData.ttsPitch ?? 0}</span>
                    </label>
                    <input
                      type="range"
                      min={currentTTSModelConfig.pitchRange[0]}
                      max={currentTTSModelConfig.pitchRange[1]}
                      step={1}
                      value={nodeData.ttsPitch ?? 0}
                      onChange={(e) => updateNodeData(id, { ttsPitch: parseInt(e.target.value) })}
                      className="w-full h-1 accent-violet-400"
                    />
                  </div>
                )}
                {currentTTSModelConfig?.hasVol && (
                  <div>
                    <label className="text-[10px] text-zinc-500 mb-1 block">
                      音量 <span className="text-zinc-600">{((nodeData.ttsVol ?? 1.0)).toFixed(1)}</span>
                    </label>
                    <input
                      type="range"
                      min={currentTTSModelConfig.speedRange[0]}
                      max={currentTTSModelConfig.volRange[1]}
                      step={0.1}
                      value={nodeData.ttsVol ?? 1.0}
                      onChange={(e) => updateNodeData(id, { ttsVol: parseFloat(e.target.value) })}
                      className="w-full h-1 accent-violet-400"
                    />
                  </div>
                )}
                {currentTTSModelConfig?.hasStability && (
                  <div>
                    <label className="text-[10px] text-zinc-500 mb-1 block">
                      稳定性 <span className="text-zinc-600">{((nodeData.ttsStability ?? 0.5)).toFixed(2)}</span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={nodeData.ttsStability ?? 0.5}
                      onChange={(e) => updateNodeData(id, { ttsStability: parseFloat(e.target.value) })}
                      className="w-full h-1 accent-violet-400"
                    />
                  </div>
                )}
                {currentTTSModelConfig?.hasSimilarityBoost && (
                  <div>
                    <label className="text-[10px] text-zinc-500 mb-1 block">
                      相似度 <span className="text-zinc-600">{((nodeData.ttsSimilarityBoost ?? 0.75)).toFixed(2)}</span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={nodeData.ttsSimilarityBoost ?? 0.75}
                      onChange={(e) => updateNodeData(id, { ttsSimilarityBoost: parseFloat(e.target.value) })}
                      className="w-full h-1 accent-violet-400"
                    />
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {mode === 'music' && isKieMusicProvider && (
          <>
          <KieUsageInfo usage={kieMusicUsage} />
          <div className="hidden mc-node-frost-strip flex-col gap-1 rounded-md px-2 py-1.5 text-[10px] text-zinc-400">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="min-w-0 flex-1 truncate">{kieMusicUsage.currentText}</span>
              <span className="shrink-0">{kieMusicUsage.estimateText}</span>
            </div>
            <div className="text-[11px] font-medium text-zinc-100">{kieMusicUsage.balanceText} · {kieMusicUsage.usedText}</div>
          </div>
          </>
        )}

        {/* Progress */}
        <div className="space-y-1">
          <Progress
            value={generationProgress.progress}
            variant={
              generationProgress.status === 'error'
                ? 'error'
                : generationProgress.status === 'success'
                  ? 'success'
                  : 'cyan'
            }
            size="sm"
            showValue={true}
          />
          <div
            className={cn(
              "text-xs min-h-4 max-h-20 overflow-y-auto whitespace-pre-wrap break-words",
              generationProgress.errorType === 'config' ? 'text-amber-400' :
              generationProgress.errorType === 'quota' ? 'text-orange-400' :
              generationProgress.errorType === 'network' ? 'text-red-400' :
              'text-zinc-400'
            )}
          >
            {generationProgress.errorType && (
              <span className="mr-1">
                {generationProgress.errorType === 'config' ? '⚙️' :
                 generationProgress.errorType === 'quota' ? '💰' :
                 generationProgress.errorType === 'network' ? '📶' :
                 '❌'}
              </span>
            )}
            {generationProgress.message}
          </div>
          <GenerationEta
            active={isGenerating}
            progress={generationPercent}
            estimateKey={`audio:${mode}:${currentProviderId}:${currentModel}`}
            sessionKey={`audio:${id}`}
            defaultTotalSeconds={mode === 'tts' ? 60 : 180}
            className="block text-right"
          />
        </div>

        {/* Generate Button */}
        {mode === 'music' ? (
          <Button
            onClick={handleGenerate}
            disabled={isLoading || !canGenerate}
            title={
              modelOptions.length === 0
                ? '请先在 API 配置中配置音频提供方并填写 API Key'
                : !sanitizedPrompt.trim()
                  ? '请输入音乐描述'
                  : undefined
            }
            className={cn(
              'h-8 w-full gap-1.5 border border-white/10 bg-emerald-500/20 text-xs text-zinc-100 shadow-none transition-all hover:bg-emerald-500/30',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Play className="h-3 w-3" />
                生成音乐
              </>
            )}
          </Button>
        ) : (
          <Button
            onClick={handleTTSGenerate}
            disabled={isLoading || !sanitizedPrompt.trim() || !currentTTSProviderId}
            title={
              ttsModelOptions.length === 0
                ? '请先在 API 配置中配置音频提供方并填写 API Key'
                : !sanitizedPrompt.trim()
                  ? '请输入合成文本'
                  : undefined
            }
            className={cn(
              'h-8 w-full gap-1.5 border border-white/10 bg-violet-500/20 text-xs text-zinc-100 shadow-none transition-all hover:bg-violet-500/30',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                合成中...
              </>
            ) : (
              <>
                <Volume2 className="h-3 w-3" />
                生成语音
              </>
            )}
          </Button>
        )}

      </div>

      </ScreenSpaceNodePanel>
    </div>
  );
}

export default memo(MusicNode);
