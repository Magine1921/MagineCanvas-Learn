'use client';

import type { MaterialRef } from '@/lib/material-mentions';
import { cn } from '@/lib/utils';
import { AudioLines, Image as ImageIcon, Video } from 'lucide-react';
import { MaterialThumbWithHover, isDisplayableRasterUrl } from '@/components/canvas/MaterialThumbWithHover';
import { useMaterialMediaHoverPreview } from '@/components/canvas/MaterialMediaHoverPreview';

interface MaterialPreviewStripProps {
  materials: MaterialRef[];
  className?: string;
  showLabel?: boolean;
}

export function MaterialPreviewStrip({ materials, className, showLabel = true }: MaterialPreviewStripProps) {
  const materialHoverPreview = useMaterialMediaHoverPreview();
  if (materials.length === 0) return null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 rounded-lg border border-white/12 bg-[#24211f]/22 px-2 py-1.5 shadow-inner shadow-black/10 backdrop-blur-md',
        !showLabel && '[&>span:first-child]:hidden',
        className
      )}
    >
      <span className="shrink-0 text-[9px] text-zinc-500">素材</span>
      <div className="flex gap-1 flex-wrap">
        {materials.map((m, i) => (
          <div
            key={`${m.nodeId}-${m.slug || i}`}
            title={`@${m.slug}${m.fileName ? ` · ${m.fileName}` : ''}${
              m.seedanceAssetUri ? ` · ${m.seedanceAssetUri}` : ''
            }`}
            className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-white/12 bg-black/14 shadow-[0_8px_20px_rgba(0,0,0,0.15)] transition hover:border-white/35 hover:shadow-[0_0_14px_rgba(255,255,255,0.12)]"
            onMouseEnter={(event) => {
              materialHoverPreview.cancelClose();
              materialHoverPreview.openPreview(m, event.currentTarget.getBoundingClientRect());
            }}
            onMouseLeave={materialHoverPreview.scheduleClose}
          >
            {m.fileType === 'video' ? (
              <>
                {m.thumbnailUrl ? (
                  <MaterialThumbWithHover
                    thumbSrc={m.thumbnailUrl}
                    fullSrc={
                      isDisplayableRasterUrl(m.fileUrl || '') ? m.fileUrl || m.thumbnailUrl : m.thumbnailUrl
                    }
                    alt=""
                    className="h-full w-full"
                    imgClassName="w-full h-full object-cover"
                    enableHover={false}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Video className="h-3.5 w-3.5 text-zinc-100 drop-shadow-[0_0_8px_rgba(255,255,255,0.35)]" />
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/14">
                  <Video className="w-3 h-3 text-white/90" />
                </div>
              </>
            ) : m.fileType === 'audio' ? (
              <div className="w-full h-full flex items-center justify-center">
                <AudioLines className="h-3.5 w-3.5 text-zinc-100 drop-shadow-[0_0_8px_rgba(255,255,255,0.35)]" />
              </div>
            ) : m.fileUrl ? (
              <MaterialThumbWithHover
                thumbSrc={m.thumbnailUrl || m.fileUrl}
                fullSrc={m.thumbnailUrl || m.fileUrl}
                alt=""
                className="h-full w-full"
                imgClassName="h-full w-full object-cover"
                enableHover={false}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-3 h-3 text-zinc-600" />
              </div>
            )}
            {m.seedanceAssetUri && (
              <span className="absolute bottom-0 right-0 rounded-tl bg-white/90 px-0.5 text-[7px] font-medium text-zinc-900 shadow-[0_0_8px_rgba(255,255,255,0.4)]">
                ID
              </span>
            )}
          </div>
        ))}
      </div>
      {materialHoverPreview.portal}
    </div>
  );
}
