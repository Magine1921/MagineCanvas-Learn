'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AudioLines,
  FlipHorizontal2,
  FlipVertical2,
  ImageDown,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Scissors,
  SkipBack,
  SkipForward,
  Video,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { readAudioWaveform } from '@/lib/audio-trim';

type CropRect = { x: number; y: number; width: number; height: number };
type CropDragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';
type TrimDragEdge = 'start' | 'end';

export interface MaterialImageEditResult {
  dataUrl: string;
  width: number;
  height: number;
}

interface MaterialMediaEditorProps {
  sourceUrl: string;
  posterUrl?: string;
  fileType: 'image' | 'video' | 'audio';
  fileName?: string;
  onClose: () => void;
  onApplyImage: (result: MaterialImageEditResult) => Promise<void>;
  onTrimVideo: (start: number, end: number) => Promise<void>;
  onTrimAudio: (start: number, end: number) => Promise<void>;
  onCaptureFrame: (time: number) => Promise<void>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatTime(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const hundredths = Math.floor((safe % 1) * 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function formatTrimSeconds(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return safe < 60 ? `${safe.toFixed(2)}s` : formatTime(safe);
}

export function MaterialMediaEditor({
  sourceUrl,
  posterUrl,
  fileType,
  fileName,
  onClose,
  onApplyImage,
  onTrimVideo,
  onTrimAudio,
  onCaptureFrame,
}: MaterialMediaEditorProps) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trimTimelineRef = useRef<HTMLDivElement | null>(null);
  const trimDragRef = useRef<{ pointerId: number; edge: TrimDragEdge } | null>(null);
  const cropDragRef = useRef<{
    pointerId: number;
    mode: CropDragMode;
    startX: number;
    startY: number;
    initial: CropRect;
  } | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 1, height: 1 });
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioWaveform, setAudioWaveform] = useState<{ sourceUrl: string; peaks: number[] }>({
    sourceUrl: '',
    peaks: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setPreviewSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fileType]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  useEffect(() => {
    let cancelled = false;
    if (fileType !== 'audio') return () => {
      cancelled = true;
    };
    void readAudioWaveform(sourceUrl, 120)
      .then((waveform) => {
        if (!cancelled) setAudioWaveform({ sourceUrl, peaks: waveform.peaks });
      })
      .catch(() => {
        if (!cancelled) setAudioWaveform({ sourceUrl, peaks: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [fileType, sourceUrl]);

  const imageBounds = useMemo(() => {
    if (!previewSize.width || !previewSize.height || !imageSize.width || !imageSize.height) {
      return { left: 0, top: 0, width: previewSize.width, height: previewSize.height };
    }
    const containerRatio = previewSize.width / previewSize.height;
    const imageRatio = imageSize.width / imageSize.height;
    if (containerRatio > imageRatio) {
      const height = previewSize.height;
      const width = height * imageRatio;
      return { left: (previewSize.width - width) / 2, top: 0, width, height };
    }
    const width = previewSize.width;
    const height = width / imageRatio;
    return { left: 0, top: (previewSize.height - height) / 2, width, height };
  }, [imageSize.height, imageSize.width, previewSize.height, previewSize.width]);

  const beginCropDrag = (
    event: ReactPointerEvent<HTMLElement>,
    mode: CropDragMode,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    cropDragRef.current = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      initial: crop,
    };
  };

  const updateCropDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = cropDragRef.current;
    if (!active || active.pointerId !== event.pointerId || !imageBounds.width || !imageBounds.height) return;
    event.preventDefault();
    const dx = (event.clientX - active.startX) / imageBounds.width;
    const dy = (event.clientY - active.startY) / imageBounds.height;
    const minSize = 0.05;
    const next = { ...active.initial };

    if (active.mode === 'move') {
      next.x = clamp(active.initial.x + dx, 0, 1 - active.initial.width);
      next.y = clamp(active.initial.y + dy, 0, 1 - active.initial.height);
    } else {
      if (active.mode.includes('w')) {
        const right = active.initial.x + active.initial.width;
        next.x = clamp(active.initial.x + dx, 0, right - minSize);
        next.width = right - next.x;
      }
      if (active.mode.includes('e')) {
        next.width = clamp(active.initial.width + dx, minSize, 1 - active.initial.x);
      }
      if (active.mode.includes('n')) {
        const bottom = active.initial.y + active.initial.height;
        next.y = clamp(active.initial.y + dy, 0, bottom - minSize);
        next.height = bottom - next.y;
      }
      if (active.mode.includes('s')) {
        next.height = clamp(active.initial.height + dy, minSize, 1 - active.initial.y);
      }
    }
    setCrop(next);
  };

  const endCropDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (cropDragRef.current?.pointerId === event.pointerId) cropDragRef.current = null;
  };

  const applyImage = async () => {
    const image = imageRef.current;
    if (!image?.naturalWidth || !image.naturalHeight) return;
    setBusy(true);
    setError('');
    try {
      const sx = Math.round(crop.x * image.naturalWidth);
      const sy = Math.round(crop.y * image.naturalHeight);
      const sw = Math.max(1, Math.round(crop.width * image.naturalWidth));
      const sh = Math.max(1, Math.round(crop.height * image.naturalHeight));
      const cropped = document.createElement('canvas');
      cropped.width = sw;
      cropped.height = sh;
      const croppedContext = cropped.getContext('2d');
      if (!croppedContext) throw new Error('无法创建图片编辑画布');
      croppedContext.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);

      const quarterTurn = Math.abs(rotation % 180) === 90;
      const output = document.createElement('canvas');
      output.width = quarterTurn ? sh : sw;
      output.height = quarterTurn ? sw : sh;
      const outputContext = output.getContext('2d');
      if (!outputContext) throw new Error('无法输出编辑后的图片');
      outputContext.translate(output.width / 2, output.height / 2);
      outputContext.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      outputContext.rotate((rotation * Math.PI) / 180);
      outputContext.drawImage(cropped, -sw / 2, -sh / 2);
      await onApplyImage({
        dataUrl: output.toDataURL('image/png'),
        width: output.width,
        height: output.height,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片编辑失败');
    } finally {
      setBusy(false);
    }
  };

  const timedMedia = () => fileType === 'audio' ? audioRef.current : videoRef.current;

  const seekTimedMedia = (time: number) => {
    const media = timedMedia();
    if (!media) return;
    const target = clamp(time, 0, duration || time);
    media.currentTime = target;
    setCurrentTime(target);
  };

  const handleTimedMediaTimeUpdate = (media: HTMLMediaElement) => {
    const time = media.currentTime;
    if (!media.paused && trimEnd > trimStart && time >= trimEnd - 0.01) {
      media.pause();
      media.currentTime = trimEnd;
      setCurrentTime(trimEnd);
      setPlaying(false);
      return;
    }
    setCurrentTime(time);
  };

  const handleTimedMediaPlay = (media: HTMLMediaElement) => {
    if (trimEnd > trimStart && (media.currentTime < trimStart || media.currentTime >= trimEnd - 0.01)) {
      media.currentTime = trimStart;
      setCurrentTime(trimStart);
    }
    setPlaying(true);
  };

  const toggleTimedMediaPlayback = () => {
    const media = timedMedia();
    if (!media) return;
    if (!media.paused) {
      media.pause();
      return;
    }
    if (media.currentTime < trimStart || media.currentTime >= trimEnd - 0.01) {
      media.currentTime = trimStart;
      setCurrentTime(trimStart);
    }
    void media.play();
  };

  const initializeTimedMedia = (media: HTMLMediaElement) => {
    const nextDuration = Number.isFinite(media.duration) ? media.duration : 0;
    setDuration(nextDuration);
    setTrimStart(0);
    setTrimEnd(nextDuration);
    setCurrentTime(0);
  };

  const updateTrimEdge = (edge: TrimDragEdge, rawTime: number) => {
    if (!duration) return;
    const minimumGap = Math.min(0.05, duration);
    if (edge === 'start') {
      const next = clamp(rawTime, 0, Math.max(0, trimEnd - minimumGap));
      setTrimStart(next);
      seekTimedMedia(next);
      return;
    }
    const next = clamp(rawTime, Math.min(duration, trimStart + minimumGap), duration);
    setTrimEnd(next);
    seekTimedMedia(next);
  };

  const trimTimeFromClientX = (clientX: number): number => {
    const rect = trimTimelineRef.current?.getBoundingClientRect();
    if (!rect?.width || !duration) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
  };

  const beginTrimDrag = (event: ReactPointerEvent<HTMLButtonElement>, edge: TrimDragEdge) => {
    if (!duration || busy) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    trimDragRef.current = { pointerId: event.pointerId, edge };
    updateTrimEdge(edge, trimTimeFromClientX(event.clientX));
  };

  const updateTrimDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = trimDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateTrimEdge(active.edge, trimTimeFromClientX(event.clientX));
  };

  const endTrimDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (trimDragRef.current?.pointerId === event.pointerId) trimDragRef.current = null;
  };

  const handleTrimTimelinePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration || (event.target as HTMLElement).closest('[data-trim-handle]')) return;
    event.preventDefault();
    seekTimedMedia(trimTimeFromClientX(event.clientX));
  };

  const handleTrimHandleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    edge: TrimDragEdge,
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = edge === 'start' ? trimStart : trimEnd;
    const step = Math.max(0.01, duration / 200) * (event.shiftKey ? 10 : 1);
    updateTrimEdge(edge, current + (event.key === 'ArrowRight' ? step : -step));
  };

  const applyTimedMediaTrim = async () => {
    if (!duration || trimEnd - trimStart < 0.05) return;
    setBusy(true);
    setError('');
    try {
      if (fileType === 'audio') {
        await onTrimAudio(trimStart, trimEnd);
      } else {
        await onTrimVideo(trimStart, trimEnd);
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${fileType === 'audio' ? '音频' : '视频'}裁剪失败`);
    } finally {
      setBusy(false);
    }
  };

  const captureFrame = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await onCaptureFrame(currentTime);
      setNotice(`已在 ${formatTime(currentTime)} 截取单帧到画布`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '单帧截取失败');
    } finally {
      setBusy(false);
    }
  };

  const trimStartPercent = duration > 0 ? clamp((trimStart / duration) * 100, 0, 100) : 0;
  const trimEndPercent = duration > 0 ? clamp((trimEnd / duration) * 100, 0, 100) : 100;
  const playheadPercent = duration > 0 ? clamp((currentTime / duration) * 100, 0, 100) : 0;
  const selectedDuration = Math.max(0, trimEnd - trimStart);
  const waveformBars = audioWaveform.sourceUrl === sourceUrl && audioWaveform.peaks.length > 0
    ? audioWaveform.peaks
    : Array.from({ length: 72 }, (_, index) => 0.18 + Math.abs(Math.sin(index * 0.47)) * 0.34);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10200] flex items-center justify-center bg-black/72 p-5 backdrop-blur-md"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <section className="flex max-h-[92vh] w-[min(880px,94vw)] flex-col overflow-hidden rounded-lg border border-white/18 bg-[#111516]/98 shadow-[0_28px_90px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.1)]">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-4">
          {fileType === 'image' ? <ImageDown className="h-4 w-4" /> : <Scissors className="h-4 w-4" />}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-zinc-100">
              {fileType === 'image' ? '图片编辑' : fileType === 'audio' ? '音频剪辑' : '视频剪辑'}
            </div>
            <div className="truncate text-[9px] text-zinc-500">{fileName || '当前素材'}</div>
          </div>
          <button
            type="button"
            title="关闭编辑器"
            aria-label="关闭编辑器"
            disabled={busy}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-white/8 hover:text-white disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {fileType === 'image' ? (
            <>
              <div
                ref={previewRef}
                onPointerMove={updateCropDrag}
                onPointerUp={endCropDrag}
                onPointerCancel={endCropDrag}
                className="relative h-[min(58vh,520px)] min-h-[300px] touch-none overflow-hidden rounded-md border border-white/10 bg-[#07090a]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imageRef}
                  src={sourceUrl}
                  alt="待编辑图片"
                  draggable={false}
                  crossOrigin={/^https?:/i.test(sourceUrl) ? 'anonymous' : undefined}
                  onLoad={(event) => setImageSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })}
                  className="pointer-events-none absolute select-none"
                  style={imageBounds}
                />
                {imageSize.width > 0 ? (
                  <div
                    className="absolute cursor-move border border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.58)]"
                    onPointerDown={(event) => beginCropDrag(event, 'move')}
                    style={{
                      left: imageBounds.left + crop.x * imageBounds.width,
                      top: imageBounds.top + crop.y * imageBounds.height,
                      width: crop.width * imageBounds.width,
                      height: crop.height * imageBounds.height,
                    }}
                  >
                    {(['nw', 'ne', 'sw', 'se'] as CropDragMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-label={`调整裁剪范围 ${mode}`}
                        onPointerDown={(event) => beginCropDrag(event, mode)}
                        className={cn(
                          'absolute h-3 w-3 border border-black/60 bg-white shadow-sm',
                          mode === 'nw' && '-left-1.5 -top-1.5 cursor-nwse-resize',
                          mode === 'ne' && '-right-1.5 -top-1.5 cursor-nesw-resize',
                          mode === 'sw' && '-bottom-1.5 -left-1.5 cursor-nesw-resize',
                          mode === 'se' && '-bottom-1.5 -right-1.5 cursor-nwse-resize',
                        )}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" title="向左旋转" onClick={() => setRotation((value) => value - 90)} className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-zinc-300 hover:bg-white/8"><RotateCcw className="h-3.5 w-3.5" /></button>
                <button type="button" title="向右旋转" onClick={() => setRotation((value) => value + 90)} className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-zinc-300 hover:bg-white/8"><RotateCw className="h-3.5 w-3.5" /></button>
                <button type="button" title="水平翻转" onClick={() => setFlipX((value) => !value)} className={cn('flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-zinc-300 hover:bg-white/8', flipX && 'border-cyan-200/40 bg-cyan-200/10 text-cyan-100')}><FlipHorizontal2 className="h-3.5 w-3.5" /></button>
                <button type="button" title="垂直翻转" onClick={() => setFlipY((value) => !value)} className={cn('flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-zinc-300 hover:bg-white/8', flipY && 'border-cyan-200/40 bg-cyan-200/10 text-cyan-100')}><FlipVertical2 className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => { setCrop({ x: 0, y: 0, width: 1, height: 1 }); setRotation(0); setFlipX(false); setFlipY(false); }} className="ml-auto h-8 rounded-md border border-white/10 px-3 text-[10px] text-zinc-300 hover:bg-white/8">重置</button>
              </div>
            </>
          ) : (
            <>
              {fileType === 'audio' ? (
                <audio
                  ref={audioRef}
                  src={sourceUrl}
                  crossOrigin={/^https?:/i.test(sourceUrl) ? 'anonymous' : undefined}
                  onLoadedMetadata={(event) => initializeTimedMedia(event.currentTarget)}
                  onTimeUpdate={(event) => handleTimedMediaTimeUpdate(event.currentTarget)}
                  onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
                  onPlay={(event) => handleTimedMediaPlay(event.currentTarget)}
                  onPause={() => setPlaying(false)}
                  className="hidden"
                />
              ) : (
                <div ref={previewRef} className="relative overflow-hidden rounded-md border border-white/10 bg-black">
                  <video
                    ref={videoRef}
                    src={sourceUrl}
                    poster={posterUrl}
                    playsInline
                    crossOrigin={/^https?:/i.test(sourceUrl) ? 'anonymous' : undefined}
                    onLoadedMetadata={(event) => initializeTimedMedia(event.currentTarget)}
                    onTimeUpdate={(event) => handleTimedMediaTimeUpdate(event.currentTarget)}
                    onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onPlay={(event) => handleTimedMediaPlay(event.currentTarget)}
                    onPause={() => setPlaying(false)}
                    onClick={toggleTimedMediaPlayback}
                    className="max-h-[52vh] w-full cursor-pointer object-contain"
                  />
                  {!playing ? (
                    <button
                      type="button"
                      title="播放所选片段"
                      aria-label="播放所选片段"
                      onClick={toggleTimedMediaPlayback}
                      className="absolute inset-0 flex items-center justify-center bg-black/12 text-white/90 transition-colors hover:bg-black/22"
                    >
                      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-black/55 shadow-lg">
                        <Play className="ml-0.5 h-5 w-5" />
                      </span>
                    </button>
                  ) : null}
                </div>
              )}

              <div
                data-material-trim-editor={fileType}
                className={cn(
                  'rounded-lg border border-white/12 bg-[#0b0f11] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]',
                  fileType === 'video' && 'mt-3',
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {fileType === 'audio' ? (
                    <AudioLines className="h-4 w-4 shrink-0 text-cyan-200" />
                  ) : (
                    <Video className="h-4 w-4 shrink-0 text-cyan-200" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-300">
                    {fileName || (fileType === 'audio' ? '音频素材' : '视频素材')}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">
                    已选 {formatTrimSeconds(selectedDuration)}
                  </span>
                </div>

                <div className="mb-2 mt-3 flex items-center justify-between text-[10px] tabular-nums text-zinc-500">
                  <span>{formatTrimSeconds(trimStart)} - {formatTrimSeconds(trimEnd)}</span>
                  <span>{formatTrimSeconds(selectedDuration)}</span>
                </div>

                <div
                  ref={trimTimelineRef}
                  data-material-trim-timeline={fileType}
                  onPointerDown={handleTrimTimelinePointerDown}
                  onPointerMove={updateTrimDrag}
                  onPointerUp={endTrimDrag}
                  onPointerCancel={endTrimDrag}
                  className="relative h-[76px] touch-none select-none overflow-hidden rounded-md border border-white/12 bg-[#111416]"
                >
                  {fileType === 'audio' ? (
                    <div className="absolute inset-x-1 inset-y-2 flex items-center gap-[2px] overflow-hidden" aria-hidden>
                      {waveformBars.map((peak, index) => (
                        <span
                          key={index}
                          className="min-w-px flex-1 rounded-full bg-zinc-400/65"
                          style={{ height: `${Math.max(10, peak * 58)}px` }}
                        />
                      ))}
                    </div>
                  ) : posterUrl ? (
                    <div className="absolute inset-0 grid grid-cols-8" aria-hidden>
                      {Array.from({ length: 8 }, (_, index) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={index} src={posterUrl} alt="" draggable={false} className="h-full w-full border-r border-black/45 object-cover last:border-r-0" />
                      ))}
                    </div>
                  ) : (
                    <div className="absolute inset-0 grid grid-cols-8" aria-hidden>
                      {Array.from({ length: 8 }, (_, index) => (
                        <span key={index} className="flex items-center justify-center border-r border-black/45 bg-gradient-to-br from-zinc-700/45 to-zinc-950/70 last:border-r-0">
                          <Video className="h-4 w-4 text-zinc-500" />
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="pointer-events-none absolute inset-y-0 left-0 z-10 bg-black/68" style={{ width: `${trimStartPercent}%` }} />
                  <div className="pointer-events-none absolute inset-y-0 right-0 z-10 bg-black/68" style={{ width: `${100 - trimEndPercent}%` }} />
                  <div
                    className="pointer-events-none absolute inset-y-0 z-20 border-y border-amber-100/75 bg-amber-100/[0.035]"
                    style={{ left: `${trimStartPercent}%`, width: `${Math.max(0, trimEndPercent - trimStartPercent)}%` }}
                  />
                  <div
                    className="pointer-events-none absolute inset-y-0 z-20 w-px bg-white/85 shadow-[0_0_8px_rgba(255,255,255,0.45)]"
                    style={{ left: `${playheadPercent}%` }}
                  />

                  {(['start', 'end'] as TrimDragEdge[]).map((edge) => {
                    const isStart = edge === 'start';
                    const percent = isStart ? trimStartPercent : trimEndPercent;
                    return (
                      <button
                        key={edge}
                        type="button"
                        role="slider"
                        data-trim-handle={edge}
                        aria-label={isStart ? '调整视频或音频入点' : '调整视频或音频出点'}
                        aria-orientation="horizontal"
                        aria-valuemin={0}
                        aria-valuemax={duration}
                        aria-valuenow={isStart ? trimStart : trimEnd}
                        disabled={busy || !duration}
                        onPointerDown={(event) => beginTrimDrag(event, edge)}
                        onKeyDown={(event) => handleTrimHandleKeyDown(event, edge)}
                        onClick={(event) => event.stopPropagation()}
                        onLostPointerCapture={() => {
                          trimDragRef.current = null;
                        }}
                        className="absolute inset-y-0 z-30 w-9 cursor-ew-resize outline-none disabled:cursor-default focus-visible:bg-white/8"
                        style={isStart ? { left: `${percent}%` } : { left: `calc(${percent}% - 36px)` }}
                      >
                        <span className={cn(
                          'absolute inset-y-0 w-px bg-amber-100 shadow-[0_0_8px_rgba(253,230,138,0.72)]',
                          isStart ? 'left-0' : 'right-0',
                        )} />
                        <span className={cn(
                          'absolute top-1/2 h-6 w-2 -translate-y-1/2 rounded-sm border border-amber-50/75 bg-amber-100/25',
                          isStart ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2',
                        )} />
                      </button>
                    );
                  })}
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <button type="button" title="定位入点" aria-label="定位入点" disabled={!duration} onClick={() => seekTimedMedia(trimStart)} className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-zinc-400 hover:bg-white/8 hover:text-zinc-100 disabled:opacity-40"><SkipBack className="h-3.5 w-3.5" /></button>
                  <button type="button" title={playing ? '暂停' : '播放所选片段'} onClick={toggleTimedMediaPlayback} disabled={!duration} className="flex h-8 w-8 items-center justify-center rounded-md border border-white/12 text-zinc-200 hover:bg-white/8 disabled:opacity-40">{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</button>
                  <button type="button" title="定位出点" aria-label="定位出点" disabled={!duration} onClick={() => seekTimedMedia(trimEnd)} className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-zinc-400 hover:bg-white/8 hover:text-zinc-100 disabled:opacity-40"><SkipForward className="h-3.5 w-3.5" /></button>
                  <span className="text-[10px] tabular-nums text-zinc-500">片段 {formatTrimSeconds(selectedDuration)}</span>
                  <span className="ml-auto text-[10px] tabular-nums text-zinc-400">{formatTime(currentTime)} / {formatTime(duration)}</span>
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="flex min-h-14 shrink-0 items-center gap-2 border-t border-white/10 px-4 py-2">
          <div className="min-w-0 flex-1 text-[10px]">
            {error ? <span className="text-red-300">{error}</span> : notice ? <span className="text-emerald-300">{notice}</span> : <span className="text-zinc-500">{fileType === 'image' ? '拖动选框与四角控制点确定裁剪区域' : fileType === 'audio' ? '试听音频并设置需要保留的入点和出点' : '设置入点和出点，或在当前时间截取单帧'}</span>}
          </div>
          {fileType === 'video' ? (
            <button type="button" disabled={busy || !duration} onClick={() => void captureFrame()} className="h-8 rounded-md border border-white/12 px-3 text-[10px] text-zinc-200 hover:bg-white/8 disabled:opacity-40">截取单帧</button>
          ) : null}
          <button type="button" disabled={busy} onClick={onClose} className="h-8 rounded-md border border-white/12 px-3 text-[10px] text-zinc-300 hover:bg-white/8 disabled:opacity-40">取消</button>
          <button type="button" disabled={busy || (fileType === 'image' ? !imageSize.width : !duration)} onClick={() => void (fileType === 'image' ? applyImage() : applyTimedMediaTrim())} className="flex h-8 min-w-24 items-center justify-center gap-1.5 rounded-md border border-orange-200/30 bg-orange-300/12 px-3 text-[10px] text-orange-50 hover:bg-orange-300/18 disabled:opacity-40">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : fileType === 'image' ? <ImageDown className="h-3.5 w-3.5" /> : <Scissors className="h-3.5 w-3.5" />}
            {busy ? '处理中' : fileType === 'image' ? '应用编辑' : '应用裁剪'}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
