'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  isMaterialDiskRef,
  isProjectCacheMaterialUrl,
  resolveMaterialPlayableUrl,
} from '@/lib/material-disk-playable-url';
import { cn } from '@/lib/utils';

export function isDisplayableRasterUrl(url: string) {
  if (!url) return false;
  if (url.startsWith('data:image')) return true;
  if (url.startsWith('blob:')) return true;
  if (isMaterialDiskRef(url) || isProjectCacheMaterialUrl(url)) return true;
  return /\.(png|jpe?g|webp|gif|bmp|avif)(\?|#|$)/i.test(url);
}

type MaterialThumbWithHoverProps = {
  thumbSrc: string;
  fullSrc: string;
  alt?: string;
  className?: string;
  imgClassName?: string;
  enableHover?: boolean;
  children?: React.ReactNode;
};

/**
 * 小缩略图悬停时在上方弹出原图大图（Portal + 底部透明内边距桥接，避免被父级 overflow 裁切）
 */
export function MaterialThumbWithHover({
  thumbSrc,
  fullSrc,
  alt = '',
  className,
  imgClassName,
  enableHover = true,
  children,
}: MaterialThumbWithHoverProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState<{
    left: number;
    top: number;
    w: number;
    h: number;
  } | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolvedThumbSrc = resolveMaterialPlayableUrl(thumbSrc, 'image');
  const resolvedFullSrc = resolveMaterialPlayableUrl(fullSrc, 'image');
  const handleThumbError = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (
      !resolvedFullSrc
      || resolvedFullSrc === resolvedThumbSrc
      || image.dataset.materialFallbackApplied === 'true'
    ) {
      return;
    }
    image.dataset.materialFallbackApplied = 'true';
    image.src = resolvedFullSrc;
  }, [resolvedFullSrc, resolvedThumbSrc]);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openPop = useCallback(() => {
    if (!enableHover || !isDisplayableRasterUrl(resolvedFullSrc)) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPop({
      left: r.left + r.width / 2,
      top: r.top,
      w: r.width,
      h: r.height,
    });
  }, [enableHover, resolvedFullSrc]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setPop(null), 220);
  }, [clearCloseTimer]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  const portal =
    pop && typeof document !== 'undefined'
      ? createPortal(
          <div
            role="presentation"
            className="pointer-events-auto fixed z-[10050] flex flex-col items-center"
            style={{
              left: pop.left,
              top: pop.top,
              transform: 'translate(-50%, -100%)',
              paddingBottom: pop.h + 12,
              boxSizing: 'content-box',
            }}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
          >
            <div className="max-h-[min(48vh,280px)] max-w-[min(72vw,380px)] overflow-hidden rounded-lg border border-white/22 bg-[#0c0c0c] shadow-[0_24px_56px_rgba(0,0,0,0.55)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolvedFullSrc}
                alt={alt}
                loading="lazy"
                decoding="async"
                draggable={false}
                className="max-h-[min(48vh,280px)] max-w-[min(72vw,380px)] object-contain"
              />
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div
        ref={wrapRef}
        className={cn('relative', className)}
        onMouseEnter={() => {
          clearCloseTimer();
          openPop();
        }}
        onMouseLeave={scheduleClose}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolvedThumbSrc || resolvedFullSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={handleThumbError}
          className={imgClassName}
        />
        {children}
      </div>
      {portal}
    </>
  );
}
