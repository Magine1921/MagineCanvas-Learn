'use client';

import type { DragEventHandler, ReactNode, SyntheticEvent } from 'react';
import { AudioLines, Image as ImageIcon, Video, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSmoothedProgress } from '@/lib/use-smoothed-progress';
import { useMediaViewportVisibility } from '@/lib/use-media-viewport-visibility';
import { CanvasVideoPlayer, type CanvasVideoPlaybackState } from './CanvasVideoPlayer';
import { GenerationEta } from './GenerationEta';
import { resolveMaterialPlayableUrl } from '@/lib/material-disk-playable-url';

function compactPlayableUrl(
  value: string | undefined,
  kind: 'image' | 'video' | 'audio',
): string {
  const trimmed = value?.trim() || '';
  if (!trimmed || trimmed.startsWith('idb://')) return '';
  return resolveMaterialPlayableUrl(trimmed, kind);
}

interface CompactNodeFrameProps {
  title: string;
  icon?: ReactNode;
  mediaUrl?: string;
  imageThumbnailUrl?: string;
  posterUrl?: string;
  mediaType?: string;
  text?: string;
  badge?: string;
  width?: string;
  /** 如 `1920 / 1080`；有图/视频时覆盖默认 16:9 */
  mediaAspectRatio?: string;
  /** When set, the entire node card keeps this aspect ratio, including the title bar. */
  frameAspectRatio?: string;
  accent?: 'cyan' | 'amber' | 'violet' | 'zinc';
  /** 外层为 `.mc-node-glass-shell` 时使用，避免与磨砂壳叠出双层卡片 */
  variant?: 'card' | 'glass-inner';
  /** 是否正在生成中，显示加载指示器 */
  isLoading?: boolean;
  progress?: number;
  loadingLabel?: string;
  mediaFit?: 'cover' | 'contain';
  mediaClassName?: string;
  mediaFrameClassName?: string;
  mediaOnly?: boolean;
  mediaDraggable?: boolean;
  onMediaDragStart?: DragEventHandler<HTMLDivElement>;
  statusMessage?: string;
  statusTone?: 'info' | 'success' | 'error';
  taskSummary?: {
    total: number;
    succeeded: number;
  };
  etaKey?: string;
  etaSessionKey?: string;
  etaBaselineSeconds?: number;
  onImageLargePreview?: () => void;
  onVideoLargePreview?: (playback: CanvasVideoPlaybackState) => void;
}

const accentClass = {
  cyan: 'text-zinc-100 border-white/22 bg-white/[0.08] shadow-[0_0_14px_rgba(255,255,255,0.14)]',
  amber: 'text-zinc-100 border-white/22 bg-white/[0.08] shadow-[0_0_14px_rgba(255,255,255,0.14)]',
  violet: 'text-zinc-100 border-white/22 bg-white/[0.08] shadow-[0_0_14px_rgba(255,255,255,0.14)]',
  zinc: 'text-zinc-200 border-white/14 bg-white/6',
};

export function CompactNodeFrame({
  title,
  icon,
  mediaUrl,
  imageThumbnailUrl,
  posterUrl,
  mediaType,
  text,
  badge,
  width = 'w-[280px]',
  mediaAspectRatio,
  frameAspectRatio,
  accent = 'cyan',
  variant = 'card',
  isLoading = false,
  progress,
  loadingLabel = '生成中',
  mediaFit = 'cover',
  mediaClassName,
  mediaFrameClassName,
  mediaOnly = false,
  mediaDraggable = false,
  onMediaDragStart,
  statusMessage,
  statusTone = 'info',
  taskSummary,
  etaKey,
  etaSessionKey,
  etaBaselineSeconds,
  onImageLargePreview,
  onVideoLargePreview,
}: CompactNodeFrameProps) {
  const isVideo = mediaType === 'video';
  const isAudio = mediaType === 'audio';
  const resolvedMediaUrl = compactPlayableUrl(
    mediaUrl,
    isVideo ? 'video' : isAudio ? 'audio' : 'image',
  );
  const resolvedThumbnailUrl = compactPlayableUrl(imageThumbnailUrl, 'image');
  const resolvedPosterUrl = compactPlayableUrl(posterUrl, 'image');
  const isImage = mediaType === 'image' || (!!(resolvedMediaUrl || resolvedThumbnailUrl) && !isVideo && !isAudio);
  const fallbackText = text?.trim();
  const displayImageUrl = resolvedThumbnailUrl || resolvedMediaUrl;
  const staticPreviewUrl = isVideo ? resolvedPosterUrl : displayImageUrl;
  const logoReliefUrl = '/logo-symbol-relief.svg';
  const [mediaFrameRef, isMediaVisible] = useMediaViewportVisibility<HTMLDivElement>();
  const smoothedProgress = useSmoothedProgress(progress ?? 0);
  const progressValue = Math.round(isLoading ? Math.min(99, smoothedProgress) : smoothedProgress);
  const taskTotal = Math.max(0, Math.floor(Number(taskSummary?.total) || 0));
  const taskSucceeded = Math.min(taskTotal, Math.max(0, Math.floor(Number(taskSummary?.succeeded) || 0)));
  const currentTaskNumber = taskTotal > 0
    ? Math.min(taskTotal, taskSucceeded + (isLoading ? 1 : 0))
    : 0;
  const totalProgress = taskTotal > 0
    ? Math.min(100, Math.round(((taskSucceeded * 100) + (isLoading ? progressValue : 0)) / taskTotal))
    : progressValue;
  const stopMediaEvent = (event: SyntheticEvent) => {
    event.stopPropagation();
  };
  const mediaObjectClass = mediaFit === 'contain'
    ? 'object-contain p-5'
    : mediaAspectRatio
      ? 'object-contain'
      : 'object-cover';
  const trimmedStatusMessage = statusMessage?.trim();

  return (
    <div
      className={cn(
        'compact-node-frame mc-node-compact relative rounded-xl border p-1.5',
        mediaOnly
          ? 'mc-node-media-only border-transparent bg-transparent p-0 shadow-none'
          : variant === 'glass-inner'
          ? 'mc-node-compact-glass border-white/12 bg-transparent shadow-none'
          : 'border-white/12 bg-[#1e1d1b]/38 shadow-[0_18px_42px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]',
        isLoading && !mediaOnly && 'mc-node-generating-pulse border-white/40',
        frameAspectRatio && 'flex flex-col',
        width
      )}
      style={frameAspectRatio ? { aspectRatio: frameAspectRatio } : undefined}
    >
      {mediaOnly ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-full mb-1 flex items-center justify-between gap-2 px-0.5 text-[10px] font-semibold text-zinc-100/90">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-md border', accentClass[accent])}>
              {icon || (isVideo ? <Video className="h-3 w-3" /> : isAudio ? <AudioLines className="h-3 w-3" /> : isImage ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />)}
            </span>
            <span className="truncate">{title}</span>
          </span>
          {(taskSummary || isLoading) && (
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[9px] font-medium text-zinc-400">
              {taskSummary && (
                <span title={`当前任务 ${currentTaskNumber}/${taskTotal}，总进度 ${totalProgress}%`}>
                  任务 {currentTaskNumber}/{taskTotal} · 总进度 {totalProgress}%
                </span>
              )}
              {isLoading && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-cyan-200" />}
            </span>
          )}
        </div>
      ) : (
        <div className="mb-1.5 flex shrink-0 items-center gap-1.5 px-0.5 text-[10px] font-semibold text-zinc-100/90">
          <span className={cn('flex h-4 w-4 items-center justify-center rounded-md border', accentClass[accent])}>
            {icon || (isVideo ? <Video className="h-3 w-3" /> : isAudio ? <AudioLines className="h-3 w-3" /> : isImage ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />)}
          </span>
          <span>{title}</span>
          {(taskSummary || isLoading) && (
            <span className="ml-auto flex min-w-0 items-center gap-1.5">
              {taskSummary && (
                <span
                  className="whitespace-nowrap text-[9px] font-medium text-zinc-400"
                  title={`总任务 ${taskSummary.total}，已成功 ${taskSummary.succeeded}`}
                >
                  任务 {taskSummary.total} · 成功 {taskSummary.succeeded}
                </span>
              )}
              {isLoading && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-cyan-200" />}
            </span>
          )}
        </div>
      )}

      <div
        ref={mediaFrameRef}
        draggable={mediaDraggable}
        onDragStart={onMediaDragStart}
        onMouseDown={mediaDraggable ? stopMediaEvent : undefined}
        onPointerDown={mediaDraggable ? stopMediaEvent : undefined}
        className={cn(
          'relative overflow-hidden rounded-md border shadow-inner shadow-black/25',
          mediaOnly && 'mc-node-media-only-surface rounded-lg',
          mediaOnly && isLoading && 'mc-node-generating-pulse border-white/40',
          mediaDraggable && 'nodrag nopan cursor-grab active:cursor-grabbing',
          frameAspectRatio && 'min-h-0 flex-1',
          mediaOnly
            ? 'border-white/10 bg-black/12'
            : variant === 'glass-inner'
              ? 'mc-node-compact-glass-body border-white/10'
              : 'border-white/10 bg-black/12',
          (isImage || isVideo) && !mediaAspectRatio && !frameAspectRatio ? 'aspect-video' : '',
          !(isImage || isVideo) && !mediaAspectRatio ? 'min-h-[118px]' : '',
          mediaFrameClassName,
        )}
        style={mediaAspectRatio && !frameAspectRatio ? { aspectRatio: mediaAspectRatio } : undefined}
      >
        {!isMediaVisible && (isVideo || isAudio || isImage) ? (
          <div className="relative h-full min-h-[118px] w-full overflow-hidden bg-black" aria-hidden>
            {staticPreviewUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={staticPreviewUrl}
                alt=""
                draggable={false}
                decoding="async"
                className={cn('h-full w-full', mediaObjectClass, mediaClassName)}
              />
            ) : null}
          </div>
        ) : isVideo ? (
          resolvedMediaUrl ? (
            <CanvasVideoPlayer
              key={resolvedMediaUrl}
              src={resolvedMediaUrl}
              poster={resolvedPosterUrl}
              videoClassName={cn(mediaObjectClass, mediaClassName)}
              onLargePreview={isLoading ? undefined : onVideoLargePreview}
            />
          ) : staticPreviewUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={staticPreviewUrl}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                className={cn('h-full w-full', mediaObjectClass, mediaClassName)}
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/14">
                <Video className="h-5 w-5 text-white/85" />
              </div>
            </>
          ) : (
            <div className="flex h-full min-h-[118px] flex-col items-center justify-center gap-2 p-3 text-zinc-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoReliefUrl}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                className="mc-node-logo-relief h-20 w-20 object-contain"
              />
              {fallbackText && (
                <p className="line-clamp-2 max-w-[80%] text-center text-[10px] text-zinc-400">
                  {fallbackText}
                </p>
              )}
            </div>
          )
        ) : isAudio && resolvedMediaUrl ? (
          <div className="flex h-full min-h-[118px] flex-col items-center justify-center gap-3 p-3 text-zinc-200">
            <AudioLines className="h-7 w-7" />
            {fallbackText && (
              <p className="line-clamp-2 max-w-[80%] text-center text-[10px] text-zinc-400">
                {fallbackText}
              </p>
            )}
          </div>
        ) : isImage && displayImageUrl ? (
          onImageLargePreview ? (
            <button
              type="button"
              title="查看大图"
              aria-label="查看大图"
              onClick={(event) => {
                event.stopPropagation();
                onImageLargePreview();
              }}
              onMouseDown={stopMediaEvent}
              onPointerDown={stopMediaEvent}
              className="nodrag nopan nowheel block h-full w-full cursor-zoom-in border-0 bg-transparent p-0"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayImageUrl}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                className={cn('h-full w-full', mediaObjectClass, mediaClassName)}
              />
            </button>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayImageUrl}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              className={cn('h-full w-full', mediaObjectClass, mediaClassName)}
            />
          )
        ) : (
          <div className="flex h-full min-h-[118px] items-center justify-center p-3">
            {fallbackText ? (
              <p className="line-clamp-5 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-300">
                {fallbackText}
              </p>
            ) : (
              <div className="flex flex-col items-center gap-2 text-slate-600">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoReliefUrl}
                  alt=""
                  draggable={false}
                  loading="lazy"
                  decoding="async"
                  className="mc-node-logo-relief h-20 w-20 object-contain"
                />
              </div>
            )}
          </div>
        )}

        {badge && (
          <span className="absolute right-3 top-2 rounded-md border border-white/10 bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {badge}
          </span>
        )}

        {isLoading && (
          <>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/16">
              <div className="flex flex-col items-center gap-0.5 rounded-md border border-white/45 bg-black/45 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_18px_rgba(255,255,255,0.14)]">
                <span>{loadingLabel} {progressValue}%...</span>
                {etaKey ? (
                  <GenerationEta
                    active={isLoading}
                    progress={progress ?? 0}
                    estimateKey={etaKey}
                    sessionKey={etaSessionKey}
                    defaultTotalSeconds={etaBaselineSeconds}
                  />
                ) : null}
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-3 bottom-2 overflow-hidden rounded-full border border-white/10 bg-black/45 p-[1px] shadow-[0_0_12px_rgba(255,255,255,0.1)]">
              <div
                className="h-1.5 rounded-full bg-white/80 shadow-[0_0_14px_rgba(255,255,255,0.45)] transition-[width] duration-500 ease-out"
                style={{ width: `${progressValue}%` }}
              />
            </div>
          </>
        )}

        {!isLoading && trimmedStatusMessage && (
          <div
            className={cn(
              'pointer-events-none absolute inset-x-3 rounded-md border px-2 py-1 text-[10px] font-medium leading-snug shadow-[0_0_14px_rgba(0,0,0,0.28)]',
              isVideo ? 'bottom-11' : 'bottom-2',
              statusTone === 'error'
                ? 'border-red-300/35 bg-red-950/72 text-red-100'
                : statusTone === 'success'
                  ? 'border-emerald-300/30 bg-emerald-950/65 text-emerald-100'
                  : 'border-white/16 bg-black/62 text-zinc-100'
            )}
          >
            <span className="line-clamp-2 whitespace-pre-wrap break-words">{trimmedStatusMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}
