'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  SyntheticEvent,
} from 'react';
import { Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CanvasVideoPlaybackState {
  currentTime: number;
  wasPlaying: boolean;
}

interface CanvasVideoPlayerProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  initialTime?: number;
  size?: 'compact' | 'large';
  className?: string;
  videoClassName?: string;
  onLargePreview?: (playback: CanvasVideoPlaybackState) => void;
  largePreviewMode?: 'open' | 'close';
}

const VIDEO_CONTROLS_AUTO_HIDE_MS = 2_000;
const VIDEO_LOAD_RETRY_DELAYS_MS = [1_200, 3_000, 6_000] as const;

function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function describeVideoPlaybackError(video: HTMLVideoElement, error?: unknown): string {
  if (video.error?.code === MediaError.MEDIA_ERR_NETWORK) return '视频加载中断，请点击重试';
  if (video.error?.code === MediaError.MEDIA_ERR_DECODE) return '视频解码失败，请重新加载';
  if (video.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return '视频地址或格式不可播放';
  if (error instanceof DOMException && error.name === 'NotAllowedError') return '播放被系统阻止，请再次点击播放';
  return '视频暂时无法播放，请点击重试';
}

export function CanvasVideoPlayer({
  src,
  poster,
  autoPlay = false,
  initialTime = 0,
  size = 'compact',
  className,
  videoClassName,
  onLargePreview,
  largePreviewMode = 'open',
}: CanvasVideoPlayerProps) {
  const isLarge = size === 'large';
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const controlsHideTimerRef = useRef<number | null>(null);
  const loadRetryTimerRef = useRef<number | null>(null);
  const loadRetryCountRef = useRef(0);
  const playAttemptRef = useRef(0);
  const progressRenderAtRef = useRef(0);
  const controlsHoveredRef = useRef(false);
  const controlsCanCollapseRef = useRef(false);
  const progressDraggingRef = useRef(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [controlsVisible, setControlsVisible] = useState(true);
  const [mediaActivated, setMediaActivated] = useState(() => autoPlay || isLarge || !poster);

  useEffect(() => () => {
    playAttemptRef.current += 1;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    if (controlsHideTimerRef.current !== null) {
      window.clearTimeout(controlsHideTimerRef.current);
    }
    if (loadRetryTimerRef.current !== null) {
      window.clearTimeout(loadRetryTimerRef.current);
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }, []);

  useEffect(() => {
    loadRetryCountRef.current = 0;
    if (loadRetryTimerRef.current !== null) {
      window.clearTimeout(loadRetryTimerRef.current);
      loadRetryTimerRef.current = null;
    }
    setMediaActivated(autoPlay || isLarge || !poster);
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
  }, [autoPlay, isLarge, poster, src]);

  const stopMediaEvent = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const stopProgressSync = () => {
    if (animationFrameRef.current === null) return;
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  };

  const startProgressSync = () => {
    stopProgressSync();
    progressRenderAtRef.current = 0;
    const update = (timestamp: number) => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended) {
        animationFrameRef.current = null;
        return;
      }
      if (timestamp - progressRenderAtRef.current >= 80) {
        progressRenderAtRef.current = timestamp;
        setCurrentTime(video.currentTime);
      }
      animationFrameRef.current = window.requestAnimationFrame(update);
    };
    animationFrameRef.current = window.requestAnimationFrame(update);
  };

  const clearControlsHideTimer = () => {
    if (controlsHideTimerRef.current === null) return;
    window.clearTimeout(controlsHideTimerRef.current);
    controlsHideTimerRef.current = null;
  };

  const keepControlsVisible = () => {
    clearControlsHideTimer();
    controlsCanCollapseRef.current = false;
    setControlsVisible(true);
  };

  const startControlsAutoHide = () => {
    clearControlsHideTimer();
    controlsCanCollapseRef.current = false;
    setControlsVisible(true);
    controlsHideTimerRef.current = window.setTimeout(() => {
      controlsHideTimerRef.current = null;
      controlsCanCollapseRef.current = true;
      if (!controlsHoveredRef.current) setControlsVisible(false);
    }, VIDEO_CONTROLS_AUTO_HIDE_MS);
  };

  const revealControlsFromBottom = () => {
    controlsHoveredRef.current = true;
    setControlsVisible(true);
  };

  const collapseControlsAfterLeave = () => {
    controlsHoveredRef.current = false;
    const video = videoRef.current;
    if (
      !progressDraggingRef.current &&
      controlsCanCollapseRef.current &&
      video &&
      !video.paused &&
      !video.ended
    ) {
      setControlsVisible(false);
    }
  };

  const seekTo = (nextTime: number) => {
    const clampedTime = Math.max(0, Math.min(duration || 0, nextTime));
    const video = videoRef.current;
    if (video) video.currentTime = clampedTime;
    setCurrentTime(clampedTime);
  };

  const seekFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || duration <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    seekTo(duration * ratio);
  };

  const startProgressDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    stopMediaEvent(event);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    progressDraggingRef.current = true;
    controlsHoveredRef.current = true;
    setControlsVisible(true);
    seekFromPointer(event);
  };

  const moveProgressDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!progressDraggingRef.current) return;
    stopMediaEvent(event);
    event.preventDefault();
    seekFromPointer(event);
  };

  const finishProgressDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    stopMediaEvent(event);
    if (!progressDraggingRef.current) return;
    seekFromPointer(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    progressDraggingRef.current = false;
    const video = videoRef.current;
    if (
      !controlsHoveredRef.current &&
      controlsCanCollapseRef.current &&
      video &&
      !video.paused &&
      !video.ended
    ) {
      setControlsVisible(false);
    }
  };

  const handleProgressKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = Math.max(0.1, Math.min(5, duration / 100 || 0.1));
    let nextTime: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextTime = currentTime - step;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextTime = currentTime + step;
    if (event.key === 'Home') nextTime = 0;
    if (event.key === 'End') nextTime = duration;
    if (nextTime === null) return;
    event.preventDefault();
    event.stopPropagation();
    seekTo(nextTime);
  };

  const playVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    const attempt = playAttemptRef.current + 1;
    playAttemptRef.current = attempt;
    setPlaybackError('');
    setLoadFailed(false);
    loadRetryCountRef.current = 0;

    void (async () => {
      try {
        if (loadFailed || video.error) video.load();
        await video.play();
      } catch (firstError) {
        if (playAttemptRef.current !== attempt) return;
        const errorName = firstError instanceof DOMException ? firstError.name : '';
        const shouldRetry =
          errorName === 'AbortError'
          || video.readyState === HTMLMediaElement.HAVE_NOTHING
          || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE;
        if (shouldRetry) {
          try {
            video.load();
            await video.play();
            return;
          } catch (retryError) {
            if (playAttemptRef.current !== attempt) return;
            setPlaybackError(describeVideoPlaybackError(video, retryError));
          }
        } else {
          setPlaybackError(describeVideoPlaybackError(video, firstError));
        }
        setLoadFailed(true);
        keepControlsVisible();
      }
    })();
  };

  const togglePlayback = (event: SyntheticEvent) => {
    stopMediaEvent(event);
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) playVideo();
    else video.pause();
  };

  const activateAndPlay = (event: SyntheticEvent) => {
    stopMediaEvent(event);
    setMediaActivated(true);
    window.requestAnimationFrame(() => playVideo());
  };

  const toggleMute = (event: SyntheticEvent) => {
    stopMediaEvent(event);
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const openLargePreview = (event: SyntheticEvent) => {
    stopMediaEvent(event);
    const video = videoRef.current;
    const playback = {
      currentTime: video && Number.isFinite(video.currentTime) ? video.currentTime : 0,
      wasPlaying: Boolean(video && !video.paused && !video.ended),
    };
    video?.pause();
    onLargePreview?.(playback);
  };

  const progressPercent = duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;
  const controlButtonClass = isLarge ? 'h-9 w-9' : 'h-7 w-7';
  const controlIconClass = isLarge ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5';

  return (
    <div
      className={cn('group/mc-video nopan nowheel relative h-full w-full overflow-hidden bg-black', className)}
      onDoubleClick={stopMediaEvent}
      onContextMenu={stopMediaEvent}
      onWheel={stopMediaEvent}
    >
      {mediaActivated ? <video
        ref={videoRef}
        key={src}
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        playsInline
        preload={isLarge ? 'auto' : 'metadata'}
        draggable={false}
        onClick={togglePlayback}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          const nextDuration = Number.isFinite(video.duration) ? video.duration : 0;
          const targetTime = Math.min(Math.max(0, initialTime), nextDuration || initialTime);
          setDuration(nextDuration);
          setCurrentTime(targetTime);
          setIsMuted(video.muted);
          setLoadFailed(false);
          setPlaybackError('');
          loadRetryCountRef.current = 0;
          if (loadRetryTimerRef.current !== null) {
            window.clearTimeout(loadRetryTimerRef.current);
            loadRetryTimerRef.current = null;
          }
          keepControlsVisible();
          if (targetTime > 0) video.currentTime = targetTime;
          if (autoPlay) playVideo();
        }}
        onDurationChange={(event) => {
          const nextDuration = event.currentTarget.duration;
          setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
        }}
        onPlay={() => {
          setIsPlaying(true);
          setLoadFailed(false);
          setPlaybackError('');
          startProgressSync();
          startControlsAutoHide();
        }}
        onPause={(event) => {
          setIsPlaying(false);
          setCurrentTime(event.currentTarget.currentTime);
          stopProgressSync();
          keepControlsVisible();
        }}
        onEnded={(event) => {
          setIsPlaying(false);
          setCurrentTime(event.currentTarget.duration || 0);
          stopProgressSync();
          keepControlsVisible();
        }}
        onVolumeChange={(event) => setIsMuted(event.currentTarget.muted || event.currentTarget.volume === 0)}
        onError={(event) => {
          const video = event.currentTarget;
          const errorCode = video.error?.code;
          const retryIndex = loadRetryCountRef.current;
          const canRetry =
            (errorCode === MediaError.MEDIA_ERR_NETWORK || errorCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED)
            && retryIndex < VIDEO_LOAD_RETRY_DELAYS_MS.length;
          if (canRetry) {
            const delayMs = VIDEO_LOAD_RETRY_DELAYS_MS[retryIndex];
            loadRetryCountRef.current = retryIndex + 1;
            setLoadFailed(false);
            setPlaybackError(`视频文件正在同步，${Math.ceil(delayMs / 1000)} 秒后自动重试...`);
            if (loadRetryTimerRef.current !== null) window.clearTimeout(loadRetryTimerRef.current);
            loadRetryTimerRef.current = window.setTimeout(() => {
              loadRetryTimerRef.current = null;
              video.load();
            }, delayMs);
            setIsPlaying(false);
            stopProgressSync();
            keepControlsVisible();
            return;
          }
          setLoadFailed(true);
          setPlaybackError(describeVideoPlaybackError(video));
          setIsPlaying(false);
          stopProgressSync();
          keepControlsVisible();
        }}
        className={cn('block h-full w-full', videoClassName)}
      /> : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          draggable={false}
          decoding="async"
          className={cn('block h-full w-full', videoClassName)}
        />
      )}

      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[2px] overflow-hidden bg-white/24 transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          controlsVisible ? 'opacity-0' : 'opacity-100',
        )}
      >
        <div
          className="h-full bg-white/90 shadow-[0_0_7px_rgba(255,255,255,0.72)]"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {!controlsVisible && (
        <div
          className={cn('nodrag nopan nowheel absolute inset-x-0 bottom-0 z-30', isLarge ? 'h-20' : 'h-12')}
          onMouseEnter={revealControlsFromBottom}
          aria-hidden
        />
      )}

      {!isPlaying && (
        <button
          type="button"
          title={loadFailed ? '重新加载并播放' : '播放视频'}
          aria-label={loadFailed ? '重新加载并播放' : '播放视频'}
          onClick={mediaActivated ? togglePlayback : activateAndPlay}
          className={cn(
            'nodrag nopan absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/24 bg-black/54 text-white shadow-[0_0_24px_rgba(255,255,255,0.15)] backdrop-blur-md transition-colors hover:border-white/42 hover:bg-black/68',
            isLarge ? 'h-14 w-14' : 'h-9 w-9',
          )}
        >
          <Play className={cn(isLarge ? 'h-6 w-6' : 'h-4 w-4', 'ml-0.5')} fill="currentColor" aria-hidden />
        </button>
      )}

      {playbackError && !isPlaying ? (
        <div className="pointer-events-none absolute inset-x-8 bottom-10 z-30 rounded-md bg-black/72 px-2 py-1 text-center text-[10px] text-red-100 backdrop-blur-sm">
          {playbackError}
        </div>
      ) : null}

      <div
        inert={!controlsVisible}
        aria-hidden={!controlsVisible}
        onMouseEnter={revealControlsFromBottom}
        onMouseLeave={collapseControlsAfterLeave}
        className={cn(
          'nodrag nopan nowheel absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/86 via-black/52 to-transparent transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform',
          isLarge ? 'px-4 pb-3 pt-12' : 'px-2 pb-1.5 pt-7',
          controlsVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-full opacity-0',
        )}
      >
        <div className={cn('relative flex items-center', isLarge ? 'h-4' : 'h-3')}>
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 overflow-hidden rounded-full bg-white/22">
            <div
              className="h-full rounded-full bg-white/88 shadow-[0_0_8px_rgba(255,255,255,0.72)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span
            className={cn(
              'pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_9px_rgba(255,255,255,0.72)]',
              isLarge ? 'h-2.5 w-2.5' : 'h-2 w-2',
            )}
            style={{ left: `${progressPercent}%` }}
          />
          <div
            role="slider"
            tabIndex={0}
            aria-label="视频播放进度"
            aria-valuemin={0}
            aria-valuemax={duration || 0}
            aria-valuenow={Math.min(currentTime, duration || 0)}
            aria-valuetext={`${formatVideoTime(currentTime)} / ${formatVideoTime(duration)}`}
            onPointerDown={startProgressDrag}
            onPointerMove={moveProgressDrag}
            onPointerUp={finishProgressDrag}
            onPointerCancel={finishProgressDrag}
            onKeyDown={handleProgressKeyDown}
            className="nodrag nopan nowheel absolute inset-x-0 -inset-y-1 cursor-default touch-none outline-none"
            style={{ cursor: 'default' }}
          />
        </div>

        <div className={cn('flex items-center', isLarge ? 'mt-1.5 gap-1.5' : 'mt-0.5 gap-0.5')}>
          <button
            type="button"
            title={isPlaying ? '暂停' : '播放'}
            aria-label={isPlaying ? '暂停' : '播放'}
            onClick={mediaActivated ? togglePlayback : activateAndPlay}
            className={cn('flex items-center justify-center rounded-md text-white/88 transition-colors hover:bg-white/12 hover:text-white', controlButtonClass)}
          >
            {isPlaying
              ? <Pause className={controlIconClass} fill="currentColor" aria-hidden />
              : <Play className={cn(controlIconClass, 'ml-px')} fill="currentColor" aria-hidden />}
          </button>
          <span className={cn('select-none tabular-nums text-white/90', isLarge ? 'text-xs' : 'text-[10px]')}>
            {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            title={isMuted ? '打开声音' : '静音'}
            aria-label={isMuted ? '打开声音' : '静音'}
            onClick={toggleMute}
            className={cn('flex items-center justify-center rounded-md text-white/88 transition-colors hover:bg-white/12 hover:text-white', controlButtonClass)}
          >
            {isMuted
              ? <VolumeX className={controlIconClass} aria-hidden />
              : <Volume2 className={controlIconClass} aria-hidden />}
          </button>
          {onLargePreview && (
            <button
              type="button"
              title={largePreviewMode === 'close' ? '退出大尺寸预览' : '大尺寸预览'}
              aria-label={largePreviewMode === 'close' ? '退出大尺寸预览' : '大尺寸预览'}
              onClick={openLargePreview}
              className={cn('flex items-center justify-center rounded-md text-white/88 transition-colors hover:bg-white/12 hover:text-white', controlButtonClass)}
            >
              {largePreviewMode === 'close'
                ? <Minimize2 className={controlIconClass} aria-hidden />
                : <Maximize2 className={controlIconClass} aria-hidden />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
