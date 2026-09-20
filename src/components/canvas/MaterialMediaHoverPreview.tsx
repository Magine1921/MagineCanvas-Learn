'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, Scissors, Volume2, VolumeX } from 'lucide-react';
import type { MaterialRef } from '@/lib/material-mentions';
import { resolveMaterialPlayableUrl } from '@/lib/material-disk-playable-url';
import { useCanvasStore } from '@/components/canvas/CanvasStore';
import { MaterialMediaEditor } from '@/components/nodes/MaterialMediaEditor';
import {
  makeVideoThumbnailDataUrl,
  resolveMaterialMediaAspect,
} from '@/lib/material-import-from-file';
import {
  getMaterialBlob,
  isMaterialIdbRef,
  materialRefToNodeId,
} from '@/lib/canvas-material-idb';

export type MaterialMediaPreviewKind = 'image' | 'video' | 'audio' | 'unsupported';

export function materialMediaPreviewKind(material: MaterialRef): MaterialMediaPreviewKind {
  const declaredType = (material.fileType || '').toLowerCase();
  if (declaredType === 'image' || declaredType.startsWith('image/')) return 'image';
  if (declaredType === 'video' || declaredType.startsWith('video/')) return 'video';
  if (declaredType === 'audio' || declaredType.startsWith('audio/')) return 'audio';

  const source = `${material.fileName || ''}\n${material.fileUrl || ''}`.toLowerCase();
  if (/\.(mp4|mov|webm|mkv|avi|m4v|ogv)(?:[?#]|$)/i.test(source)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg|flac|opus|wma|aiff|caf)(?:[?#]|$)/i.test(source)) return 'audio';
  if (material.fileUrl || material.thumbnailUrl) return 'image';
  return 'unsupported';
}

interface MaterialMediaPreviewState {
  material: MaterialRef;
  kind: Exclude<MaterialMediaPreviewKind, 'unsupported'>;
  sourceUrl: string;
  fallbackUrl?: string;
  left: number;
  top: number;
}

type MaterialPreviewAnchor = Pick<DOMRect, 'left' | 'right' | 'top'>;

function previewSource(material: MaterialRef, kind: MaterialMediaPreviewKind): string {
  if (kind === 'unsupported') return '';
  const source = kind === 'image'
    ? material.fileUrl || material.thumbnailUrl || ''
    : material.fileUrl || '';
  return kind === 'audio' ? source : resolveMaterialPlayableUrl(source, kind);
}

function editedMaterialFileName(fileName: string | undefined, extension: string): string {
  const source = fileName?.trim() || 'material';
  const base = source.replace(/\.[^.]+$/, '') || 'material';
  return `${base}-trimmed.${extension}`;
}

async function resolveMaterialTrimSourceUrl(sourceUrl: string): Promise<string> {
  if (!isMaterialIdbRef(sourceUrl)) return sourceUrl;
  const cached = await getMaterialBlob(materialRefToNodeId(sourceUrl));
  const restored = cached?.fileUrl?.trim() || '';
  if (!restored || isMaterialIdbRef(restored)) {
    throw new Error('当前素材缓存不可用，请重新上传或重新生成');
  }
  return restored;
}

export function useMaterialMediaHoverPreview() {
  const [preview, setPreview] = useState<MaterialMediaPreviewState | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<MaterialRef | null>(null);
  const [videoMuted, setVideoMuted] = useState(true);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);

  const cancelClose = useCallback(() => {
    if (!closeTimerRef.current) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const closePreview = useCallback(() => {
    cancelClose();
    setPreview(null);
  }, [cancelClose]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setPreview(null), 180);
  }, [cancelClose]);

  const openPreview = useCallback((material: MaterialRef, anchor: MaterialPreviewAnchor) => {
    const kind = materialMediaPreviewKind(material);
    const sourceUrl = previewSource(material, kind);
    if (kind === 'unsupported' || !sourceUrl) {
      scheduleClose();
      return;
    }

    cancelClose();
    setVideoMuted(true);
    const viewportWidth = typeof window === 'undefined' ? 320 : window.innerWidth;
    const previewWidth = Math.min(kind === 'audio' ? 300 : 320, viewportWidth - 16);
    const anchorCenter = anchor.left + (anchor.right - anchor.left) / 2;
    const left = Math.max(12 + previewWidth / 2, Math.min(
      viewportWidth - 12 - previewWidth / 2,
      anchorCenter,
    ));
    setPreview({
      material,
      kind,
      sourceUrl,
      fallbackUrl: kind === 'image' && material.thumbnailUrl
        ? resolveMaterialPlayableUrl(material.thumbnailUrl, 'image')
        : undefined,
      left,
      top: anchor.top,
    });
  }, [cancelClose, scheduleClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  useEffect(() => {
    if (!preview) return;
    const frame = window.requestAnimationFrame(() => {
      const media = preview.kind === 'video' ? videoRef.current : audioRef.current;
      void media?.play().catch(() => undefined);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [preview]);

  const trimReferencedVideo = useCallback(async (start: number, end: number) => {
    if (!editingMaterial) throw new Error('当前视频素材不可用');
    const sourceNode = useCanvasStore.getState().nodes.find((node) => node.id === editingMaterial.nodeId);
    const sourceData = sourceNode?.data as Record<string, unknown> | undefined;
    const storedSourceUrl = typeof sourceData?.fileUrl === 'string' && sourceData.fileUrl.trim()
      ? sourceData.fileUrl.trim()
      : editingMaterial.fileUrl.trim();
    const trimVideo = window.magineDesktop?.materialVideoTrim;
    if (!sourceNode || !storedSourceUrl) throw new Error('未找到该引用对应的源素材节点');
    if (!trimVideo) throw new Error('视频剪辑仅支持桌面客户端');

    const sourceUrl = await resolveMaterialTrimSourceUrl(storedSourceUrl);
    const fileName = typeof sourceData?.fileName === 'string'
      ? sourceData.fileName
      : editingMaterial.fileName;
    const result = await trimVideo({ sourceUrl, fileName, start, end });
    const thumbnailUrl = await makeVideoThumbnailDataUrl(result.url, 720);
    const aspect = await resolveMaterialMediaAspect('video', result.url, thumbnailUrl);
    updateNodeData(editingMaterial.nodeId, {
      fileUrl: result.url,
      thumbnailUrl,
      fileName: result.fileName || editedMaterialFileName(fileName, 'mp4'),
      fileType: 'video',
      ...(aspect || {}),
    });
  }, [editingMaterial, updateNodeData]);

  const trimReferencedAudio = useCallback(async (start: number, end: number) => {
    if (!editingMaterial) throw new Error('当前音频素材不可用');
    const sourceNode = useCanvasStore.getState().nodes.find((node) => node.id === editingMaterial.nodeId);
    const sourceData = sourceNode?.data as Record<string, unknown> | undefined;
    const storedSourceUrl = typeof sourceData?.fileUrl === 'string' && sourceData.fileUrl.trim()
      ? sourceData.fileUrl.trim()
      : editingMaterial.fileUrl.trim();
    const trimAudio = window.magineDesktop?.materialAudioTrim;
    if (!sourceNode || !storedSourceUrl) throw new Error('未找到该引用对应的源素材节点');
    if (!trimAudio) throw new Error('音频剪辑仅支持桌面客户端');

    const sourceUrl = await resolveMaterialTrimSourceUrl(storedSourceUrl);
    const fileName = typeof sourceData?.fileName === 'string'
      ? sourceData.fileName
      : editingMaterial.fileName;
    const result = await trimAudio({ sourceUrl, fileName, start, end });
    updateNodeData(editingMaterial.nodeId, {
      fileUrl: result.url,
      thumbnailUrl: '',
      fileName: result.fileName || editedMaterialFileName(fileName, 'mp3'),
      fileType: 'audio',
      materialAspectW: undefined,
      materialAspectH: undefined,
    });
  }, [editingMaterial, updateNodeData]);

  const openEditor = useCallback((material: MaterialRef) => {
    setPreview(null);
    setEditingMaterial(material);
  }, []);

  const portal = preview && typeof document !== 'undefined'
    ? createPortal(
        <div
          role="presentation"
          className="nodrag nopan nowheel pointer-events-auto fixed z-[10100] flex flex-col items-center"
          style={{
            left: preview.left,
            top: preview.top,
            transform: 'translate(-50%, -100%)',
            paddingBottom: 20,
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onWheel={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div
            className="relative overflow-hidden rounded-md border border-white/22 bg-[#0b0d0e] shadow-[0_24px_60px_rgba(0,0,0,0.68)]"
            style={{ width: `min(${preview.kind === 'audio' ? 300 : 320}px, calc(100vw - 16px))` }}
          >
            {preview.kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.sourceUrl}
                alt={preview.material.fileName || preview.material.slug}
                draggable={false}
                decoding="async"
                onError={(event) => {
                  if (
                    !preview.fallbackUrl
                    || event.currentTarget.dataset.materialFallbackApplied === 'true'
                  ) return;
                  event.currentTarget.dataset.materialFallbackApplied = 'true';
                  event.currentTarget.src = preview.fallbackUrl;
                }}
                className="block max-h-[min(42vh,280px)] w-full object-contain"
              />
            ) : preview.kind === 'video' ? (
              <div className="relative bg-black">
                <video
                  ref={videoRef}
                  src={preview.sourceUrl}
                  autoPlay
                  loop
                  muted={videoMuted}
                  playsInline
                  preload="auto"
                  className="block max-h-[min(42vh,280px)] w-full object-contain"
                />
                <button
                  type="button"
                  title={videoMuted ? '打开声音' : '关闭声音'}
                  aria-label={videoMuted ? '打开视频声音' : '关闭视频声音'}
                  onClick={() => {
                    setVideoMuted((muted) => !muted);
                    void videoRef.current?.play().catch(() => undefined);
                  }}
                  className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-md border border-white/18 bg-black/75 text-white hover:bg-black"
                >
                  {videoMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  title="剪辑视频"
                  aria-label="剪辑引用视频"
                  onClick={() => openEditor(preview.material)}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md border border-white/18 bg-black/75 text-white hover:bg-black"
                >
                  <Scissors className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative flex items-center gap-3 p-3 pr-12">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-cyan-100">
                  <AudioLines className="h-4 w-4" />
                </div>
                <audio
                  ref={audioRef}
                  src={preview.sourceUrl}
                  autoPlay
                  controls
                  preload="auto"
                  className="h-9 min-w-0 flex-1"
                />
                <button
                  type="button"
                  title="剪辑音频"
                  aria-label="剪辑引用音频"
                  onClick={() => openEditor(preview.material)}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md border border-white/18 bg-black/75 text-white hover:bg-black"
                >
                  <Scissors className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="truncate border-t border-white/10 px-2.5 py-1.5 text-[10px] text-zinc-300">
              @{preview.material.slug}{preview.material.fileName ? ` · ${preview.material.fileName}` : ''}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  const editorKind = editingMaterial ? materialMediaPreviewKind(editingMaterial) : 'unsupported';
  const editorSourceUrl = editingMaterial && editorKind !== 'unsupported'
    ? previewSource(editingMaterial, editorKind)
    : '';
  const editor = editingMaterial
    && (editorKind === 'video' || editorKind === 'audio')
    && editorSourceUrl ? (
      <MaterialMediaEditor
        sourceUrl={editorSourceUrl}
        posterUrl={editorKind === 'video'
          ? resolveMaterialPlayableUrl(editingMaterial.thumbnailUrl || '', 'image')
          : undefined}
        fileType={editorKind}
        fileName={editingMaterial.fileName}
        onClose={() => setEditingMaterial(null)}
        onApplyImage={async () => undefined}
        onTrimVideo={trimReferencedVideo}
        onTrimAudio={trimReferencedAudio}
        onCaptureFrame={async () => undefined}
      />
    ) : null;

  return {
    openPreview,
    scheduleClose,
    cancelClose,
    closePreview,
    portal: (
      <>
        {portal}
        {editor}
      </>
    ),
  };
}
