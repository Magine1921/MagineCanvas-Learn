'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Eraser, ScanSearch, SquareDashedMousePointer, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveMaterialPlayableUrl } from '@/lib/material-disk-playable-url';
import { getMaterialBlob, isMaterialIdbRef, materialRefToNodeId } from '@/lib/canvas-material-idb';
import {
  normalizeSubtitleRemovalRegion,
  type SubtitleRemovalMode,
  type SubtitleRemovalRegion,
} from '@/lib/subtitle-removal-region';

interface SubtitleRemovalDialogProps {
  sourceUrl: string;
  mediaType: 'image' | 'video';
  posterUrl?: string;
  fileName?: string;
  onClose: () => void;
  onConfirm: (options: {
    mode: SubtitleRemovalMode;
    region?: SubtitleRemovalRegion;
  }) => void;
}

interface MediaDimensions {
  width: number;
  height: number;
}

const FALLBACK_DIMENSIONS: MediaDimensions = { width: 1280, height: 720 };

export function SubtitleRemovalDialog({
  sourceUrl,
  mediaType,
  posterUrl,
  fileName,
  onClose,
  onConfirm,
}: SubtitleRemovalDialogProps) {
  const [mode, setMode] = useState<SubtitleRemovalMode>('auto');
  const [region, setRegion] = useState<SubtitleRemovalRegion | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dimensions, setDimensions] = useState<MediaDimensions>(FALLBACK_DIMENSIONS);
  const [hydratedSource, setHydratedSource] = useState<{ ref: string; url: string } | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const fallbackPlayableUrl = useMemo(
    () => resolveMaterialPlayableUrl(sourceUrl, mediaType),
    [mediaType, sourceUrl],
  );
  const playableUrl = hydratedSource?.ref === sourceUrl
    ? resolveMaterialPlayableUrl(hydratedSource.url, mediaType)
    : fallbackPlayableUrl;
  const playablePoster = useMemo(
    () => posterUrl ? resolveMaterialPlayableUrl(posterUrl, 'image') : undefined,
    [posterUrl],
  );
  const imagePreviewUrl = mediaType === 'image'
    && isMaterialIdbRef(sourceUrl)
    && hydratedSource?.ref !== sourceUrl
    && playablePoster
    ? playablePoster
    : playableUrl;

  useEffect(() => {
    if (!isMaterialIdbRef(sourceUrl)) return;
    let cancelled = false;
    void getMaterialBlob(materialRefToNodeId(sourceUrl)).then((cached) => {
      const restored = cached?.fileUrl?.trim() || '';
      if (!cancelled && restored && !isMaterialIdbRef(restored)) {
        setHydratedSource({ ref: sourceUrl, url: restored });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sourceUrl]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  const pointFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(0.9999, (event.clientX - bounds.left) / Math.max(1, bounds.width))),
      y: Math.max(0, Math.min(0.9999, (event.clientY - bounds.top) / Math.max(1, bounds.height))),
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== 'custom') return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromPointer(event);
    setDragStart(point);
    setRegion({ left: point.x, top: point.y, right: point.x, bottom: point.y });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== 'custom' || !dragStart) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointFromPointer(event);
    setRegion({
      left: Math.min(dragStart.x, point.x),
      top: Math.min(dragStart.y, point.y),
      right: Math.max(dragStart.x, point.x),
      bottom: Math.max(dragStart.y, point.y),
    });
  };

  const finishRegionSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setRegion((current) => normalizeSubtitleRemovalRegion(current));
    setDragStart(null);
  };

  const normalizedRegion = normalizeSubtitleRemovalRegion(region);
  const confirmDisabled = mode === 'custom' && !normalizedRegion;
  const regionStyle = region ? {
    left: `${region.left * 100}%`,
    top: `${region.top * 100}%`,
    width: `${Math.max(0, region.right - region.left) * 100}%`,
    height: `${Math.max(0, region.bottom - region.top) * 100}%`,
  } : undefined;

  const dialog = (
    <div
      className="nodrag nopan nowheel fixed inset-0 z-[10210] flex items-center justify-center bg-black/72 p-5 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="subtitle-removal-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-[min(92vw,1180px)] flex-col overflow-hidden rounded-2xl border border-white/14 bg-[#121617] shadow-[0_36px_120px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.08)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/14 bg-white/[0.05] text-zinc-100">
              <Eraser className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="subtitle-removal-dialog-title" className="text-base font-semibold text-zinc-100">去字幕</h2>
              <p className="mt-0.5 truncate text-xs text-zinc-500">{fileName || (mediaType === 'video' ? '视频素材' : '图片素材')}</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="关闭去字幕窗口"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-400 transition-colors hover:border-white/24 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/50"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-white/10 px-5 py-4">
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/25 p-1" role="group" aria-label="擦除方式">
            <button
              type="button"
              aria-pressed={mode === 'auto'}
              onClick={() => setMode('auto')}
              className={cn(
                'flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/45',
                mode === 'auto'
                  ? 'border-violet-300/40 bg-violet-400/16 text-violet-100'
                  : 'border-transparent text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200',
              )}
            >
              <ScanSearch className="h-4 w-4" aria-hidden="true" />
              自动识别擦除
            </button>
            <button
              type="button"
              aria-pressed={mode === 'custom'}
              onClick={() => setMode('custom')}
              className={cn(
                'flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/45',
                mode === 'custom'
                  ? 'border-violet-300/40 bg-violet-400/16 text-violet-100'
                  : 'border-transparent text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200',
              )}
            >
              <SquareDashedMousePointer className="h-4 w-4" aria-hidden="true" />
              指定区域擦除
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black p-4">
          <div className="relative inline-block max-h-full max-w-full overflow-hidden bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
            {mediaType === 'video' ? (
              <video
                src={imagePreviewUrl}
                poster={playablePoster}
                width={dimensions.width}
                height={dimensions.height}
                controls={mode === 'auto'}
                muted
                playsInline
                preload="auto"
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  if (video.videoWidth > 0 && video.videoHeight > 0) {
                    setDimensions({ width: video.videoWidth, height: video.videoHeight });
                  }
                  if (mode === 'custom' && Number.isFinite(video.duration) && video.duration > 0) {
                    video.currentTime = Math.min(0.1, video.duration / 2);
                  }
                }}
                className="block max-h-[min(56vh,560px)] max-w-[min(88vw,1120px)] select-none object-contain"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={playableUrl}
                alt="待去字幕图片素材"
                width={dimensions.width}
                height={dimensions.height}
                draggable={false}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                    setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
                  }
                }}
                className="block max-h-[min(56vh,560px)] max-w-[min(88vw,1120px)] select-none object-contain"
              />
            )}

            {mode === 'custom' ? (
              <div
                className="absolute inset-0 cursor-crosshair touch-none select-none"
                aria-label="在素材上拖拽框选字幕区域"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishRegionSelection}
                onPointerCancel={finishRegionSelection}
              >
                {regionStyle ? (
                  <div
                    className="pointer-events-none absolute border-2 border-violet-400 bg-violet-600/35 shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_0_28px_rgba(139,92,246,0.35)]"
                    style={regionStyle}
                  />
                ) : null}
                {!region ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/18">
                    <div className="rounded-xl border border-white/14 bg-black/65 px-4 py-2 text-sm text-zinc-200 shadow-xl">
                      按住鼠标拖拽框选字幕区域
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
          <div className="min-w-0 text-xs text-zinc-500">
            {mode === 'auto'
              ? '腾讯云将自动识别画面中的字幕并擦除。'
              : normalizedRegion
                ? `已框选：左 ${Math.round(normalizedRegion.left * 100)}% · 上 ${Math.round(normalizedRegion.top * 100)}% · 宽 ${Math.round((normalizedRegion.right - normalizedRegion.left) * 100)}% · 高 ${Math.round((normalizedRegion.bottom - normalizedRegion.top) * 100)}%`
                : '请先在素材画面中拖拽框选需要擦除的字幕区域。'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-xl border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              取消
            </button>
            <button
              type="button"
              disabled={confirmDisabled}
              onClick={() => onConfirm({
                mode,
                ...(mode === 'custom' && normalizedRegion ? { region: normalizedRegion } : {}),
              })}
              className="min-h-11 rounded-xl border border-violet-300/35 bg-violet-500/18 px-6 text-sm font-semibold text-violet-100 transition-colors hover:border-violet-200/55 hover:bg-violet-500/26 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              开始擦除
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(dialog, document.body) : null;
}
