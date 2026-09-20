'use client';

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MIN_VOICE_REFERENCE_SECONDS, readAudioWaveform } from '@/lib/audio-trim';

interface VoiceReferenceTrimmerProps {
  sourceUrl: string;
  initialStart?: number;
  initialEnd?: number;
  maxSelectionSeconds?: number;
  disabled?: boolean;
  textSize?: 'compact' | 'comfortable';
  onCommit: (start: number, end: number) => Promise<void>;
}

function formatSeconds(value: number): string {
  return `${Math.max(0, value).toFixed(2)}s`;
}

export function VoiceReferenceTrimmer({
  sourceUrl,
  initialStart = 0,
  initialEnd,
  maxSelectionSeconds = 10,
  disabled = false,
  textSize = 'compact',
  onCommit,
}: VoiceReferenceTrimmerProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const activeHandleRef = useRef<'start' | 'end' | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const committedSelectionRef = useRef({ start: 0, end: 0 });
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');

  const stopPlayback = () => {
    if (animationFrameRef.current != null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    audioRef.current?.pause();
    setPlaying(false);
  };

  useEffect(() => {
    let cancelled = false;
    const loadWaveform = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setError('');
      stopPlayback();
      try {
        const waveform = await readAudioWaveform(sourceUrl);
        if (cancelled) return;
        if (waveform.duration < MIN_VOICE_REFERENCE_SECONDS) {
          throw new Error(`音频总时长不能短于 ${MIN_VOICE_REFERENCE_SECONDS} 秒，请重新上传`);
        }
        const start = Math.max(
          0,
          Math.min(initialStart, waveform.duration - MIN_VOICE_REFERENCE_SECONDS),
        );
        const requestedEnd = initialEnd == null ? start + maxSelectionSeconds : initialEnd;
        const end = Math.max(
          start + MIN_VOICE_REFERENCE_SECONDS,
          Math.min(requestedEnd, waveform.duration, start + maxSelectionSeconds),
        );
        const nextSelection = { start, end };
        setDuration(waveform.duration);
        setPeaks(waveform.peaks);
        setSelection(nextSelection);
        selectionRef.current = nextSelection;
        committedSelectionRef.current = nextSelection;
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '音频波形读取失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadWaveform();
    return () => {
      cancelled = true;
      stopPlayback();
    };
    // A source change starts a fresh trim session; parent updates to trim metadata are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl, maxSelectionSeconds]);

  useEffect(() => {
    if (!duration || activeHandleRef.current) return;
    const start = Math.max(
      0,
      Math.min(initialStart, duration - MIN_VOICE_REFERENCE_SECONDS),
    );
    const requestedEnd = initialEnd == null ? start + maxSelectionSeconds : initialEnd;
    const end = Math.max(
      start + MIN_VOICE_REFERENCE_SECONDS,
      Math.min(requestedEnd, duration, start + maxSelectionSeconds),
    );
    const nextSelection = { start, end };
    setSelection(nextSelection);
    selectionRef.current = nextSelection;
    committedSelectionRef.current = nextSelection;
  }, [duration, initialEnd, initialStart, maxSelectionSeconds]);

  const updateSelectionFromPointer = (clientX: number) => {
    const handle = activeHandleRef.current;
    const track = trackRef.current;
    if (!handle || !track || duration <= 0) return;
    const bounds = track.getBoundingClientRect();
    const pointedTime = Math.max(
      0,
      Math.min(duration, ((clientX - bounds.left) / Math.max(1, bounds.width)) * duration),
    );
    const current = selectionRef.current;
    const next = handle === 'start'
      ? {
          start: Math.max(0, Math.min(pointedTime, current.end - MIN_VOICE_REFERENCE_SECONDS)),
          end: current.end,
        }
      : {
          start: current.start,
          end: Math.min(duration, Math.max(pointedTime, current.start + MIN_VOICE_REFERENCE_SECONDS)),
        };

    if (next.end - next.start > maxSelectionSeconds) {
      if (handle === 'start') next.start = next.end - maxSelectionSeconds;
      else next.end = next.start + maxSelectionSeconds;
    }
    selectionRef.current = next;
    setSelection(next);
  };

  const commitSelection = async () => {
    const next = selectionRef.current;
    const previous = committedSelectionRef.current;
    if (next.end - next.start < MIN_VOICE_REFERENCE_SECONDS) {
      selectionRef.current = previous;
      setSelection(previous);
      setError(`音色参考选区不能短于 ${MIN_VOICE_REFERENCE_SECONDS} 秒`);
      return;
    }
    if (
      Math.abs(next.start - previous.start) < 0.01
      && Math.abs(next.end - previous.end) < 0.01
    ) return;
    setCommitting(true);
    setError('');
    try {
      await onCommit(next.start, next.end);
      committedSelectionRef.current = next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '音色裁剪失败');
    } finally {
      setCommitting(false);
    }
  };

  const beginDrag = (
    handle: 'start' | 'end',
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (disabled || committing) return;
    event.preventDefault();
    event.stopPropagation();
    activeHandleRef.current = handle;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!activeHandleRef.current) return;
    event.preventDefault();
    activeHandleRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    void commitSelection();
  };

  const monitorPlayback = () => {
    const audio = audioRef.current;
    if (!audio || audio.paused || audio.currentTime >= selectionRef.current.end) {
      stopPlayback();
      return;
    }
    animationFrameRef.current = requestAnimationFrame(monitorPlayback);
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    if (playing) {
      stopPlayback();
      return;
    }
    audio.currentTime = selection.start;
    await audio.play();
    setPlaying(true);
    animationFrameRef.current = requestAnimationFrame(monitorPlayback);
  };

  const startPercent = duration ? (selection.start / duration) * 100 : 0;
  const endPercent = duration ? (selection.end / duration) * 100 : 0;
  const textSizeClass = textSize === 'comfortable' ? 'text-[10px]' : 'text-[8px]';

  return (
    <div className="nodrag nopan nowheel w-full space-y-2 text-left">
      <audio ref={audioRef} src={sourceUrl} preload="metadata" onEnded={stopPlayback} />
      <div className={cn('flex h-6 items-center justify-between gap-2 text-zinc-500', textSizeClass)}>
        <span>{formatSeconds(selection.start)} - {formatSeconds(selection.end)}</span>
        <span>{formatSeconds(selection.end - selection.start)}</span>
      </div>
      <div
        ref={trackRef}
        className="relative h-14 overflow-hidden rounded-md border border-white/10 bg-black/45 px-1"
      >
        <div className="absolute inset-0 flex items-center justify-between gap-px px-1 opacity-65">
          {loading ? (
            <Loader2 className="mx-auto h-4 w-4 animate-spin text-zinc-600" />
          ) : peaks.map((peak, index) => (
            <span
              key={index}
              className="min-w-px flex-1 rounded-full bg-zinc-500"
              style={{ height: `${Math.max(8, peak * 38)}px` }}
            />
          ))}
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 border-x border-orange-200/65 bg-orange-300/12"
          style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }}
        />
        {(['start', 'end'] as const).map((handle) => {
          const percent = handle === 'start' ? startPercent : endPercent;
          return (
            <button
              key={handle}
              type="button"
              aria-label={handle === 'start' ? '拖动音色裁剪起点' : '拖动音色裁剪终点'}
              title={handle === 'start' ? '裁剪起点' : '裁剪终点'}
              disabled={disabled || loading || committing}
              onPointerDown={(event) => beginDrag(handle, event)}
              onPointerMove={(event) => updateSelectionFromPointer(event.clientX)}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={cn(
                'absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none disabled:cursor-not-allowed',
                handle === 'start' ? 'text-orange-100' : 'text-orange-100',
              )}
              style={{ left: `${percent}%` }}
            >
              <span className="absolute left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current shadow-[0_0_6px_rgba(254,215,170,0.6)]" />
              <span className="absolute left-1/2 top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-current bg-[#17191a]" />
            </button>
          );
        })}
      </div>
      <div className="flex h-6 items-center gap-2">
        <button
          type="button"
          title={playing ? '暂停选区试听' : '试听选区'}
          aria-label={playing ? '暂停选区试听' : '试听选区'}
          disabled={disabled || loading || committing || Boolean(error)}
          onClick={() => void togglePlayback()}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 text-zinc-400 hover:bg-white/8 hover:text-white disabled:opacity-35"
        >
          {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </button>
        {committing ? (
          <span className={cn('flex items-center gap-1 text-orange-100/70', textSizeClass)}>
            <Loader2 className="h-3 w-3 animate-spin" />
            正在应用裁剪
          </span>
        ) : error ? (
          <span className={cn('min-w-0 truncate text-red-200/75', textSizeClass)} title={error}>{error}</span>
        ) : (
          <span className={cn('text-zinc-600', textSizeClass)}>
            {MIN_VOICE_REFERENCE_SECONDS}-{maxSelectionSeconds} 秒
          </span>
        )}
      </div>
    </div>
  );
}
