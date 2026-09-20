'use client';

import { memo, useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import { useCanvasStore, CanvasNodeData } from '../canvas/CanvasStore';
import { cn } from '@/lib/utils';
import {
  Layers,
  Upload,
  Download,
  X,
  Loader2,
  ShieldCheck,
  EyeOff,
  GripVertical,
  Crop,
  Scissors,
  SkipBack,
  SkipForward,
  UserRound,
  Volume2,
  Eraser,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  defaultMaterialSlug,
  resolveMaterialFaceComplianceOutput,
} from '@/lib/material-mentions';
import {
  fileNameToMentionSlug,
  captureVideoFrameDataUrl,
  fileToMaterialNodeData,
  getMaterialKindFromFile,
  makeImageThumbnailDataUrl,
  makeVideoThumbnailDataUrl,
  materialNodeDisplaySize,
  materialPreviewAspectStyle,
  resolveMaterialMediaAspect,
} from '@/lib/material-import-from-file';
import { CompactNodeFrame } from '../canvas/CompactNodeFrame';
import { ScreenSpaceNodePanel } from '../canvas/ScreenSpaceNodePanel';
import { useIncomingDisplayMedia } from '../canvas/useCanvasDerivedData';
import { applyFaceCompliance, type ComplianceResult } from '@/lib/face-compliance';
import { persistImageToMaterialCache, persistVideoToMaterialCache } from '@/lib/persist-generated-media';
import { materialDiskPlayableUrl } from '@/lib/material-disk-playable-url';
import { postMaterialFileToProjectDiskCache } from '@/lib/sync-material-project-disk-cache';
import { getMaterialBlob, isMaterialIdbRef, materialRefToNodeId } from '@/lib/canvas-material-idb';
import { saveMediaToDisk, showDownloadError } from '@/lib/download-media';
import {
  MIN_VOICE_REFERENCE_SECONDS,
  readAudioWaveform,
  trimAudioUrlToWavDataUrl,
} from '@/lib/audio-trim';
import { hydratePersistedAudioUrl } from '@/lib/canvas-persist-audio-offload';
import {
  MaterialMediaEditor,
  type MaterialImageEditResult,
} from './MaterialMediaEditor';
import {
  GENERATED_AUDIO_DND_TYPE,
  GENERATED_IMAGE_DND_TYPE,
  GENERATED_VIDEO_DND_TYPE,
  type GeneratedAudioDragPayload,
  type GeneratedImageDragPayload,
  type GeneratedVideoDragPayload,
} from '@/lib/generated-image-dnd';
import { VoiceReferenceTrimmer } from './VoiceReferenceTrimmer';
import {
  completeSubtitleRemovalMaterialNode,
  createSubtitleRemovalMaterialNode,
  failSubtitleRemovalMaterialNode,
  removeSubtitlesFromMedia,
  showSubtitleRemovalError,
  subtitleRemovalOutputFileName,
  updateSubtitleRemovalMaterialProgress,
} from '@/lib/subtitle-remover';
import { SubtitleRemovalDialog } from './SubtitleRemovalDialog';
import type { SubtitleRemovalMode, SubtitleRemovalRegion } from '@/lib/subtitle-removal-region';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  });
}

function sanitizeSlugInput(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\u4e00-\u9fff\-.:]/g, '').slice(0, 30);
}

async function resolveMaterialEditSourceUrl(sourceUrl: string): Promise<string> {
  if (!isMaterialIdbRef(sourceUrl)) return sourceUrl;
  const cached = await getMaterialBlob(materialRefToNodeId(sourceUrl));
  const restored = cached?.fileUrl?.trim() || '';
  if (!restored || isMaterialIdbRef(restored)) {
    throw new Error('当前素材缓存不可用，请重新上传或重新生成');
  }
  return restored;
}

function normalizeSeedanceAssetInput(value: string): { id: string; uri: string } {
  const trimmed = value.trim();
  if (!trimmed) return { id: '', uri: '' };

  const id = trimmed.replace(/^asset:\/\//i, '');
  return {
    id,
    uri: `asset://${id}`,
  };
}

function editedFileName(fileName: string | undefined, suffix: string, extension: string): string {
  const source = fileName?.trim() || 'material';
  const base = source.replace(/\.[^.]+$/, '') || 'material';
  return `${base}-${suffix}.${extension}`;
}

interface MaterialNodeData extends CanvasNodeData {
  fileUrl?: string;
  thumbnailUrl?: string;
  fileName?: string;
  fileType?: string;
  mentionSlug?: string;
  seedanceAssetId?: string;
  seedanceAssetUri?: string;
  seedanceAssetGroupId?: string;
  virtualHumanCardId?: string;
  materialAspectW?: number;
  materialAspectH?: number;
  materialWidth?: number;
  materialHeight?: number;
  connectedMediaSourceNodeId?: string;
  connectedMediaLocked?: boolean;
  subtitleRemovalStatus?: 'queued' | 'processing' | 'complete' | 'error';
  subtitleRemovalProgress?: number;
  subtitleRemovalMessage?: string;
  subtitleRemovalRequestId?: string;
  manualMediaOverrideSourceKey?: string;
  characterMaterialEnabled?: boolean;
  characterDescription?: string;
  characterVoiceReferenceUrl?: string;
  characterVoiceOriginalUrl?: string;
  characterVoiceFileName?: string;
  characterVoiceTrimStart?: number;
  characterVoiceTrimEnd?: number;
  characterVoiceDuration?: number;
  characterVoiceError?: string;
  // 人脸合规相关字段
  faceComplianceEnabled?: boolean;
  faceComplianceProcessed?: boolean;
  faceComplianceResults?: Array<{
    inputUrl: string;
    outputUrl: string;
    faceCount: number;
    eyesCount: number;
    mouthCount: number;
  }>;
  faceComplianceStatus?: 'idle' | 'processing' | 'success' | 'noFace' | 'error';
  faceComplianceError?: string;
}

type MaterialVideoFrameCaptureMode = 'free' | 'first' | 'last';

const MATERIAL_VIDEO_FRAME_CAPTURE_LABELS: Record<MaterialVideoFrameCaptureMode, string> = {
  free: '自由截帧',
  first: '一键首帧',
  last: '一键尾帧',
};

function MaterialNode({ id, data }: NodeProps) {
  const nodeData = data as MaterialNodeData;
  const { isGlowing, updateMaterialGeometry, updateNodeData } = useCanvasStore(
    useShallow((s) => ({
      isGlowing: s.glowingNodeIds.includes(id),
      updateMaterialGeometry: s.updateMaterialGeometry,
      updateNodeData: s.updateNodeData,
    }))
  );
  const isExpanded = useCanvasStore((state) => state.selectedNode?.id === id);
  const showSettingsPanel = isExpanded;
  const downstreamTargetIds = useCanvasStore(
    useShallow((state) => state.downstreamNodeIdsBySource[id] ?? [])
  );
  const incomingDisplayMedia = useIncomingDisplayMedia(id);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const characterVoiceInputRef = useRef<HTMLInputElement>(null);
  const compactFrameRef = useRef<HTMLDivElement>(null);
  const uploadRequestRef = useRef(0);
  const faceComplianceRequestRef = useRef(0);
  const localPreviewUrlRef = useRef('');
  const browserMediaDragRef = useRef<{
    sourceKey: string;
    dragId: string;
    ready: boolean;
    promise: Promise<boolean>;
  } | null>(null);
  const browserMediaDragGhostRef = useRef<HTMLDivElement | null>(null);
  const browserMediaDragGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    started: boolean;
    browserDrag: boolean;
  } | null>(null);
  const htmlMediaDragActiveRef = useRef(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [mediaEditorOpen, setMediaEditorOpen] = useState(false);
  const [frameCaptureBusy, setFrameCaptureBusy] = useState<MaterialVideoFrameCaptureMode | null>(null);
  const [frameCaptureMessage, setFrameCaptureMessage] = useState('');
  const [characterVoiceBusy, setCharacterVoiceBusy] = useState(false);
  const [subtitleRemovalProgress, setSubtitleRemovalProgress] = useState<number | null>(null);
  const [subtitleRemovalDialogOpen, setSubtitleRemovalDialogOpen] = useState(false);

  useEffect(() => () => {
    if (localPreviewUrlRef.current) {
      URL.revokeObjectURL(localPreviewUrlRef.current);
      localPreviewUrlRef.current = '';
    }
  }, []);

  useEffect(() => () => {
    browserMediaDragGhostRef.current?.remove();
    browserMediaDragGhostRef.current = null;
    browserMediaDragGestureRef.current = null;
    htmlMediaDragActiveRef.current = false;
    const prepared = browserMediaDragRef.current;
    browserMediaDragRef.current = null;
    if (prepared) {
      void window.magineDesktop?.browserCancelCanvasMediaDrag?.(prepared.dragId).catch(() => false);
    }
  }, []);

  useEffect(() => {
    if (typeof nodeData.mentionSlug !== 'string') {
      updateNodeData(id, { mentionSlug: defaultMaterialSlug(id) });
    }
  }, [id, nodeData.mentionSlug, updateNodeData]);

  useEffect(() => {
    if (!incomingDisplayMedia) return;
    if (nodeData.connectedMediaLocked === true) return;
    const incomingSourceKey = `${incomingDisplayMedia.sourceNodeId}|${incomingDisplayMedia.fileUrl}`;
    if (nodeData.manualMediaOverrideSourceKey === incomingSourceKey) return;
    const sourceChanged =
      nodeData.connectedMediaSourceNodeId !== incomingDisplayMedia.sourceNodeId
      || nodeData.fileUrl !== incomingDisplayMedia.fileUrl
      || nodeData.fileType !== incomingDisplayMedia.fileType;
    const thumbnailUrl = incomingDisplayMedia.thumbnailUrl
      || (sourceChanged ? '' : nodeData.thumbnailUrl || '');
    if (
      !sourceChanged
      && nodeData.thumbnailUrl === thumbnailUrl
      && nodeData.fileName === incomingDisplayMedia.fileName
    ) return;

    if (sourceChanged) {
      uploadRequestRef.current += 1;
      faceComplianceRequestRef.current += 1;
      if (localPreviewUrlRef.current) {
        URL.revokeObjectURL(localPreviewUrlRef.current);
        localPreviewUrlRef.current = '';
      }
      setIsUploading(false);
    }

    updateNodeData(id, {
      fileUrl: incomingDisplayMedia.fileUrl,
      thumbnailUrl,
      fileName: incomingDisplayMedia.fileName,
      fileType: incomingDisplayMedia.fileType,
      connectedMediaSourceNodeId: incomingDisplayMedia.sourceNodeId,
      manualMediaOverrideSourceKey: undefined,
      ...(sourceChanged ? {
        materialAspectW: incomingDisplayMedia.aspectW,
        materialAspectH: incomingDisplayMedia.aspectH,
        seedanceAssetId: '',
        seedanceAssetUri: '',
        seedanceAssetGroupId: '',
        virtualHumanCardId: '',
        faceComplianceProcessed: false,
        faceComplianceResults: undefined,
        faceComplianceStatus: 'idle',
        faceComplianceError: undefined,
      } : {}),
    }, { recordUndo: false });
  }, [
    id,
    incomingDisplayMedia,
    nodeData.connectedMediaSourceNodeId,
    nodeData.connectedMediaLocked,
    nodeData.fileName,
    nodeData.fileType,
    nodeData.fileUrl,
    nodeData.manualMediaOverrideSourceKey,
    nodeData.thumbnailUrl,
    updateNodeData,
  ]);

  /** 历史素材：视频无缩略图时补首帧，便于紧凑节点与其它节点预览 */
  useEffect(() => {
    if (nodeData.fileType !== 'video') return;
    const src = typeof nodeData.fileUrl === 'string' ? nodeData.fileUrl.trim() : '';
    const th = typeof nodeData.thumbnailUrl === 'string' ? nodeData.thumbnailUrl.trim() : '';
    if (!src || th) return;
    let cancelled = false;
    void makeVideoThumbnailDataUrl(src).then((next) => {
      if (!cancelled && next) {
        updateNodeData(id, { thumbnailUrl: next }, { recordUndo: false });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, nodeData.fileType, nodeData.fileUrl, nodeData.thumbnailUrl, updateNodeData]);

  const mediaAspectKey = `${nodeData.fileType || ''}|${nodeData.fileUrl || ''}|${nodeData.thumbnailUrl || ''}`;
  useEffect(() => {
    const url = typeof nodeData.fileUrl === 'string' ? nodeData.fileUrl.trim() : '';
    const ft = nodeData.fileType;
    if (!url || ft === 'audio' || !ft) return;
    let cancelled = false;
    void resolveMaterialMediaAspect(ft, url, nodeData.thumbnailUrl).then((aspect) => {
      if (cancelled || !aspect) return;
      if (
        nodeData.materialAspectW === aspect.materialAspectW &&
        nodeData.materialAspectH === aspect.materialAspectH
      ) {
        return;
      }
      updateNodeData(id, aspect, { recordUndo: false });
    });
    return () => {
      cancelled = true;
    };
  }, [id, mediaAspectKey, nodeData.fileType, nodeData.fileUrl, nodeData.materialAspectH, nodeData.materialAspectW, nodeData.thumbnailUrl, updateNodeData]);

  const previewAspectStyle = useMemo(
    () => materialPreviewAspectStyle(nodeData.materialAspectW, nodeData.materialAspectH),
    [nodeData.materialAspectH, nodeData.materialAspectW]
  );
  const compactMediaAspect =
    previewAspectStyle && nodeData.fileType !== 'audio'
      ? previewAspectStyle.aspectRatio
      : undefined;
  const compactFrameAspect = compactMediaAspect || '16 / 9';

  useEffect(() => {
    const nextSize = materialNodeDisplaySize(
      nodeData.fileType,
      nodeData.materialAspectW,
      nodeData.materialAspectH,
    );
    const currentNode = useCanvasStore.getState().nodes.find((node) => node.id === id);
    if (!currentNode) return;
    const style = currentNode.style as { width?: unknown; height?: unknown } | undefined;
    const currentWidth = Number(currentNode.width || style?.width || nodeData.materialWidth || 0);
    const currentHeight = Number(currentNode.height || style?.height || nodeData.materialHeight || 0);
    if (
      currentWidth === nextSize.width
      && currentHeight === nextSize.height
      && nodeData.materialWidth === nextSize.width
      && nodeData.materialHeight === nextSize.height
    ) return;

    updateMaterialGeometry(id, {
      x: currentNode.position.x + (currentWidth - nextSize.width) / 2,
      y: currentNode.position.y + (currentHeight - nextSize.height) / 2,
      width: nextSize.width,
      height: nextSize.height,
    }, { recordUndo: false });
  }, [
    id,
    nodeData.fileType,
    nodeData.materialAspectH,
    nodeData.materialAspectW,
    nodeData.materialHeight,
    nodeData.materialWidth,
    updateMaterialGeometry,
  ]);

  const effectiveFileUrl = resolveMaterialFaceComplianceOutput(
    nodeData as Record<string, unknown>,
  )?.outputUrl || nodeData.fileUrl;

  const writeReferenceDragData = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.stopPropagation();
    const fileUrl = effectiveFileUrl?.trim() || '';
    if (!fileUrl) {
      event.preventDefault();
      return;
    }
    const fileName = nodeData.fileName?.trim()
      || `素材.${nodeData.fileType === 'video' ? 'mp4' : nodeData.fileType === 'audio' ? 'mp3' : 'png'}`;
    event.dataTransfer.effectAllowed = 'copy';
    if (nodeData.fileType === 'video') {
      const payload: GeneratedVideoDragPayload = {
        videoUrl: fileUrl,
        posterUrl: nodeData.thumbnailUrl,
        fileName,
      };
      event.dataTransfer.setData(GENERATED_VIDEO_DND_TYPE, JSON.stringify(payload));
    } else if (nodeData.fileType === 'audio') {
      const payload: GeneratedAudioDragPayload = { audioUrl: fileUrl, fileName };
      event.dataTransfer.setData(GENERATED_AUDIO_DND_TYPE, JSON.stringify(payload));
    } else {
      const payload: GeneratedImageDragPayload = {
        imageUrl: fileUrl,
        thumbnailUrl: nodeData.thumbnailUrl,
        fileName,
      };
      event.dataTransfer.setData(GENERATED_IMAGE_DND_TYPE, JSON.stringify(payload));
    }
    event.dataTransfer.setData('text/uri-list', fileUrl);
  }, [effectiveFileUrl, nodeData.fileName, nodeData.fileType, nodeData.thumbnailUrl]);

  const prepareBrowserMediaDrag = useCallback(async (): Promise<boolean> => {
    const prepareBrowserDrag = window.magineDesktop?.browserPrepareCanvasMediaDrag;
    const fileUrl = effectiveFileUrl?.trim() || '';
    if (!prepareBrowserDrag || !fileUrl) return false;

    const fileName = nodeData.fileName?.trim()
      || `素材.${nodeData.fileType === 'video' ? 'mp4' : nodeData.fileType === 'audio' ? 'mp3' : 'png'}`;
    const fileType = nodeData.fileType === 'video'
      ? 'video'
      : nodeData.fileType === 'audio'
        ? 'audio'
        : 'image';
    const sourceKey = `${fileUrl}|${fileName}|${fileType}`;
    const existing = browserMediaDragRef.current;
    if (existing?.sourceKey === sourceKey) return existing.promise;
    if (existing) {
      void window.magineDesktop?.browserCancelCanvasMediaDrag?.(existing.dragId).catch(() => false);
    }

    const dragId = `material-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const prepared = {
      sourceKey,
      dragId,
      ready: false,
      promise: Promise.resolve(false),
    };
    const promise = (async () => {
      try {
        const resolvedFileUrl = await resolveMaterialEditSourceUrl(fileUrl);
        if (resolvedFileUrl.startsWith('blob:') || resolvedFileUrl.startsWith('data:')) {
          const response = await fetch(resolvedFileUrl);
          if (!response.ok) return false;
          const bytes = new Uint8Array(await response.arrayBuffer());
          return prepareBrowserDrag({
            dragId,
            ...(resolvedFileUrl.startsWith('blob:') ? { sourceUrl: resolvedFileUrl } : {}),
            bytes,
            fileName,
            fileType,
            mimeType: response.headers.get('content-type') || undefined,
          });
        }
        return prepareBrowserDrag({
          dragId,
          sourceUrl: resolvedFileUrl,
          fileName,
          fileType,
        });
      } catch (cause) {
        console.warn('[material] 无法把素材拖入浏览器:', cause);
        return false;
      }
    })();
    prepared.promise = promise;
    browserMediaDragRef.current = prepared;
    const ready = await promise;
    if (browserMediaDragRef.current === prepared) {
      prepared.ready = ready;
      if (!ready) browserMediaDragRef.current = null;
    }
    return ready;
  }, [effectiveFileUrl, nodeData.fileName, nodeData.fileType]);

  const removeBrowserMediaDragGhost = useCallback(() => {
    browserMediaDragGhostRef.current?.remove();
    browserMediaDragGhostRef.current = null;
  }, []);

  const resetBrowserMediaDragVisuals = useCallback(() => {
    htmlMediaDragActiveRef.current = false;
    browserMediaDragGestureRef.current = null;
    removeBrowserMediaDragGhost();
  }, [removeBrowserMediaDragGhost]);

  useEffect(() => {
    const reset = () => resetBrowserMediaDragVisuals();
    const resetWhenHidden = () => {
      if (document.visibilityState === 'hidden') reset();
    };
    window.addEventListener('pointerup', reset, true);
    window.addEventListener('blur', reset);
    document.addEventListener('dragend', reset, true);
    document.addEventListener('drop', reset, true);
    document.addEventListener('visibilitychange', resetWhenHidden);
    return () => {
      window.removeEventListener('pointerup', reset, true);
      window.removeEventListener('blur', reset);
      document.removeEventListener('dragend', reset, true);
      document.removeEventListener('drop', reset, true);
      document.removeEventListener('visibilitychange', resetWhenHidden);
    };
  }, [resetBrowserMediaDragVisuals]);

  const moveBrowserMediaDragGhost = useCallback((clientX: number, clientY: number) => {
    const ghost = browserMediaDragGhostRef.current;
    if (!ghost) return;
    ghost.style.transform = `translate3d(${Math.round(clientX + 14)}px, ${Math.round(clientY + 14)}px, 0)`;
  }, []);

  const showBrowserMediaDragGhost = useCallback((clientX: number, clientY: number) => {
    removeBrowserMediaDragGhost();
    const ghost = document.createElement('div');
    const frame = compactFrameRef.current?.getBoundingClientRect();
    const ratio = frame?.width && frame?.height ? frame.width / frame.height : 16 / 9;
    const width = 168;
    const height = Math.max(72, Math.min(126, Math.round(width / ratio)));
    Object.assign(ghost.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: `${width}px`,
      height: `${height}px`,
      zIndex: '2147483647',
      pointerEvents: 'none',
      overflow: 'hidden',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.55)',
      background: 'rgba(8,10,14,0.88)',
      boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
      opacity: '0.78',
      willChange: 'transform',
    });
    const preview = compactFrameRef.current?.querySelector<HTMLElement>('img, video, canvas');
    if (preview) {
      const clone = preview.cloneNode(true) as HTMLElement;
      clone.removeAttribute('controls');
      Object.assign(clone.style, {
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        pointerEvents: 'none',
      });
      ghost.appendChild(clone);
    } else {
      const label = document.createElement('span');
      label.textContent = nodeData.fileName || '素材';
      Object.assign(label.style, {
        display: 'flex',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
        color: 'rgba(255,255,255,0.82)',
        fontSize: '12px',
        textAlign: 'center',
      });
      ghost.appendChild(label);
    }
    document.body.appendChild(ghost);
    browserMediaDragGhostRef.current = ghost;
    moveBrowserMediaDragGhost(clientX, clientY);
  }, [moveBrowserMediaDragGhost, nodeData.fileName, removeBrowserMediaDragGhost]);

  const handleMediaDragStart = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'copy';
    const browserDragActive = window.magineDesktop?.browserCanAcceptCanvasMediaDrag?.() === true;
    if (!browserDragActive) {
      htmlMediaDragActiveRef.current = true;
      const gesture = browserMediaDragGestureRef.current;
      if (gesture) gesture.started = true;
      if (!browserMediaDragGhostRef.current) {
        showBrowserMediaDragGhost(event.clientX, event.clientY);
      }
      const transparentDragImage = document.createElement('canvas');
      transparentDragImage.width = 1;
      transparentDragImage.height = 1;
      event.dataTransfer.setDragImage(transparentDragImage, 0, 0);
      writeReferenceDragData(event);
      return;
    }

    const gesture = browserMediaDragGestureRef.current;
    if (gesture) gesture.started = true;
    const prepared = browserMediaDragRef.current;
    const startPreparedDrag = window.magineDesktop?.browserStartPreparedCanvasMediaDrag;

    // Electron requires startDrag to run during the real dragstart gesture. Starting it
    // after awaiting preparation loses the Windows drag session over the embedded HWND.
    event.preventDefault();
    if (!prepared?.ready || !startPreparedDrag) {
      resetBrowserMediaDragVisuals();
      void prepareBrowserMediaDrag();
      return;
    }

    browserMediaDragRef.current = null;
    resetBrowserMediaDragVisuals();
    startPreparedDrag(prepared.dragId);
  }, [prepareBrowserMediaDrag, resetBrowserMediaDragVisuals, showBrowserMediaDragGhost, writeReferenceDragData]);

  const handleMediaDrag = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    if (!htmlMediaDragActiveRef.current) return;
    event.stopPropagation();
    if (event.clientX || event.clientY) {
      moveBrowserMediaDragGhost(event.clientX, event.clientY);
    }
  }, [moveBrowserMediaDragGhost]);

  const handleMediaDragEnd = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    resetBrowserMediaDragVisuals();
  }, [resetBrowserMediaDragVisuals]);

  const handleBrowserMediaPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const browserDrag = window.magineDesktop?.browserCanAcceptCanvasMediaDrag?.() === true;
    if (browserDrag) {
      void prepareBrowserMediaDrag();
    }
    browserMediaDragGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: true,
      started: false,
      browserDrag,
    };
    showBrowserMediaDragGhost(event.clientX, event.clientY);
  }, [prepareBrowserMediaDrag, showBrowserMediaDragGhost]);

  const handleBrowserMediaPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = browserMediaDragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !gesture.active) return;
    moveBrowserMediaDragGhost(event.clientX, event.clientY);
  }, [moveBrowserMediaDragGhost]);

  const handleBrowserMediaPointerRelease = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = browserMediaDragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.type === 'pointercancel' && htmlMediaDragActiveRef.current) return;
    resetBrowserMediaDragVisuals();
  }, [resetBrowserMediaDragVisuals]);

  // 素材或合规结果变化时，同步所有下游连接节点。
  useEffect(() => {
    downstreamTargetIds.forEach((targetId) => {
      updateNodeData(targetId, { imageRef: effectiveFileUrl });
    });
  }, [downstreamTargetIds, effectiveFileUrl, updateNodeData]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const kind = getMaterialKindFromFile(file);
    if (!kind) return;

    const requestId = uploadRequestRef.current + 1;
    uploadRequestRef.current = requestId;
    faceComplianceRequestRef.current += 1;
    const previewUrl = URL.createObjectURL(file);
    if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
    localPreviewUrlRef.current = previewUrl;
    setIsUploading(true);
    updateNodeData(id, {
      label: '素材',
      type: 'material',
      fileUrl: previewUrl,
      thumbnailUrl: kind === 'image' ? previewUrl : '',
      fileName: file.name,
      fileType: kind,
      mentionSlug: fileNameToMentionSlug(file.name),
      seedanceAssetId: '',
      seedanceAssetUri: '',
      seedanceAssetGroupId: '',
      virtualHumanCardId: '',
      materialAspectW: undefined,
      materialAspectH: undefined,
      faceComplianceProcessed: false,
      faceComplianceResults: undefined,
      faceComplianceStatus: 'idle',
      faceComplianceError: undefined,
      manualMediaOverrideSourceKey: incomingDisplayMedia
        ? `${incomingDisplayMedia.sourceNodeId}|${incomingDisplayMedia.fileUrl}`
        : undefined,
    });

    try {
      const cacheId = `${id}-upload-${Date.now().toString(36)}-${requestId}`;
      const [cached, thumbnailUrl, aspect] = await Promise.all([
        postMaterialFileToProjectDiskCache(cacheId, file),
        kind === 'image'
          ? makeImageThumbnailDataUrl(previewUrl, 420, 160)
          : kind === 'video'
            ? makeVideoThumbnailDataUrl(previewUrl, 720)
            : Promise.resolve(''),
        resolveMaterialMediaAspect(kind, previewUrl),
      ]);
      const partial: Partial<CanvasNodeData> = cached
        ? {
            label: '素材',
            type: 'material',
            fileUrl: materialDiskPlayableUrl(cacheId, kind),
            thumbnailUrl,
            fileName: file.name,
            fileType: kind,
            mentionSlug: fileNameToMentionSlug(file.name),
            seedanceAssetId: '',
            seedanceAssetUri: '',
            seedanceAssetGroupId: '',
            virtualHumanCardId: '',
            manualMediaOverrideSourceKey: incomingDisplayMedia
              ? `${incomingDisplayMedia.sourceNodeId}|${incomingDisplayMedia.fileUrl}`
              : undefined,
            ...(aspect || {}),
          }
        : {
            ...(await fileToMaterialNodeData(file)),
            manualMediaOverrideSourceKey: incomingDisplayMedia
              ? `${incomingDisplayMedia.sourceNodeId}|${incomingDisplayMedia.fileUrl}`
              : undefined,
          };
      if (uploadRequestRef.current !== requestId) return;
      updateNodeData(id, partial, { recordUndo: false });
      localPreviewUrlRef.current = '';
      window.setTimeout(() => URL.revokeObjectURL(previewUrl), 1000);
    } catch (error) {
      console.error('文件读取失败:', error);
    } finally {
      if (uploadRequestRef.current === requestId) setIsUploading(false);
      if (uploadRequestRef.current !== requestId) URL.revokeObjectURL(previewUrl);
    }
  };

  const handleRemove = () => {
    uploadRequestRef.current += 1;
    faceComplianceRequestRef.current += 1;
    if (localPreviewUrlRef.current) {
      URL.revokeObjectURL(localPreviewUrlRef.current);
      localPreviewUrlRef.current = '';
    }
    setIsUploading(false);
    updateNodeData(id, {
      fileUrl: '',
      thumbnailUrl: '',
      fileName: '',
      fileType: '',
      materialAspectW: undefined,
      materialAspectH: undefined,
      seedanceAssetId: '',
      seedanceAssetUri: '',
      seedanceAssetGroupId: '',
      virtualHumanCardId: '',
      faceComplianceProcessed: false,
      faceComplianceResults: undefined,
      faceComplianceStatus: 'idle',
      faceComplianceError: undefined,
    });
  };

  const handleUploadClick = () => {
    const input = fileInputRef.current;
    if (!input || isUploading) return;
    input.value = '';
    input.click();
  };

  const handleDownload = useCallback(async () => {
    const sourceUrl = typeof effectiveFileUrl === 'string' ? effectiveFileUrl.trim() : '';
    if (!sourceUrl || isDownloading) return;

    const fallbackExt = nodeData.fileType === 'video' ? 'mp4' : nodeData.fileType === 'audio' ? 'mp3' : 'png';
    const suggestedName = nodeData.fileName?.trim() || `material-${Date.now()}.${fallbackExt}`;
    setIsDownloading(true);
    try {
      await saveMediaToDisk(sourceUrl, suggestedName);
    } catch (error) {
      showDownloadError(error);
    } finally {
      setIsDownloading(false);
    }
  }, [effectiveFileUrl, isDownloading, nodeData.fileName, nodeData.fileType]);

  const handleRemoveSubtitles = useCallback(async (options: {
    mode: SubtitleRemovalMode;
    region?: SubtitleRemovalRegion;
  }) => {
    const mediaType = nodeData.fileType === 'video' ? 'video' : nodeData.fileType === 'image' ? 'image' : null;
    const sourceRef = typeof effectiveFileUrl === 'string' ? effectiveFileUrl.trim() : '';
    if (!mediaType || !sourceRef || subtitleRemovalProgress !== null) return;
    setSubtitleRemovalProgress(0);
    const materialNodeId = createSubtitleRemovalMaterialNode({
      sourceNodeId: id,
      sourceHandle: null,
      fileName: subtitleRemovalOutputFileName(nodeData.fileName, mediaType),
      fileType: mediaType,
    });
    if (!materialNodeId) {
      setSubtitleRemovalProgress(null);
      return;
    }
    try {
      const sourceUrl = await resolveMaterialEditSourceUrl(sourceRef);
      const result = await removeSubtitlesFromMedia({
        sourceUrl,
        fileName: nodeData.fileName,
        mediaType,
        ...options,
      }, (progress) => {
        setSubtitleRemovalProgress(progress.progress);
        updateSubtitleRemovalMaterialProgress(materialNodeId, progress);
      });
      const thumbnailUrl = mediaType === 'video'
        ? await makeVideoThumbnailDataUrl(result.url, 720).catch(() => nodeData.thumbnailUrl || '')
        : await makeImageThumbnailDataUrl(result.url, 420, 160).catch(() => result.url);
      const cached = mediaType === 'video'
        ? await persistVideoToMaterialCache(materialNodeId, result.url)
        : await persistImageToMaterialCache(materialNodeId, result.url);
      const posterCacheId = `${materialNodeId}-poster`;
      const posterCached = mediaType === 'video' && thumbnailUrl
        ? await persistImageToMaterialCache(posterCacheId, thumbnailUrl)
        : false;
      completeSubtitleRemovalMaterialNode({
        materialNodeId,
        fileUrl: cached ? materialDiskPlayableUrl(materialNodeId, mediaType) : result.url,
        thumbnailUrl: posterCached ? materialDiskPlayableUrl(posterCacheId, 'image') : thumbnailUrl,
        fileName: result.fileName,
      });
    } catch (error) {
      failSubtitleRemovalMaterialNode(materialNodeId, error);
      showSubtitleRemovalError(error);
    } finally {
      setSubtitleRemovalProgress(null);
    }
  }, [
    effectiveFileUrl,
    id,
    nodeData.fileName,
    nodeData.fileType,
    nodeData.thumbnailUrl,
    subtitleRemovalProgress,
  ]);

  const handleApplyImageEdit = useCallback(async (result: MaterialImageEditResult) => {
    const cacheId = `${id}-image-edit-${Date.now().toString(36)}`;
    const cached = await persistImageToMaterialCache(cacheId, result.dataUrl);
    const nextFileUrl = cached
      ? materialDiskPlayableUrl(cacheId, 'image')
      : result.dataUrl;
    const thumbnailUrl = await makeImageThumbnailDataUrl(result.dataUrl, 420, 160);
    updateNodeData(id, {
      fileUrl: nextFileUrl,
      thumbnailUrl,
      fileName: editedFileName(nodeData.fileName, 'edited', 'png'),
      fileType: 'image',
      materialAspectW: result.width,
      materialAspectH: result.height,
      faceComplianceProcessed: false,
      faceComplianceResults: undefined,
      faceComplianceStatus: 'idle',
      faceComplianceError: undefined,
    });
  }, [id, nodeData.fileName, updateNodeData]);

  const handleTrimVideo = useCallback(async (start: number, end: number) => {
    const storedSourceUrl = typeof effectiveFileUrl === 'string' ? effectiveFileUrl.trim() : '';
    const trimVideo = window.magineDesktop?.materialVideoTrim;
    if (!storedSourceUrl) throw new Error('当前视频不可用');
    if (!trimVideo) throw new Error('视频裁剪仅支持桌面客户端');
    const sourceUrl = await resolveMaterialEditSourceUrl(storedSourceUrl);
    const result = await trimVideo({
      sourceUrl,
      fileName: nodeData.fileName,
      start,
      end,
    });
    const thumbnailUrl = await makeVideoThumbnailDataUrl(result.url, 720);
    const aspect = await resolveMaterialMediaAspect('video', result.url, thumbnailUrl);
    updateNodeData(id, {
      fileUrl: result.url,
      thumbnailUrl,
      fileName: result.fileName || editedFileName(nodeData.fileName, 'trimmed', 'mp4'),
      fileType: 'video',
      ...(aspect || {}),
    });
  }, [effectiveFileUrl, id, nodeData.fileName, updateNodeData]);

  const handleTrimAudio = useCallback(async (start: number, end: number) => {
    const storedSourceUrl = typeof effectiveFileUrl === 'string' ? effectiveFileUrl.trim() : '';
    const trimAudio = window.magineDesktop?.materialAudioTrim;
    if (!storedSourceUrl) throw new Error('当前音频不可用');
    if (!trimAudio) throw new Error('音频裁剪仅支持桌面客户端');
    const sourceUrl = await resolveMaterialEditSourceUrl(storedSourceUrl);
    const result = await trimAudio({
      sourceUrl,
      fileName: nodeData.fileName,
      start,
      end,
    });
    updateNodeData(id, {
      fileUrl: result.url,
      thumbnailUrl: '',
      fileName: result.fileName || editedFileName(nodeData.fileName, 'trimmed', 'mp3'),
      fileType: 'audio',
      materialAspectW: undefined,
      materialAspectH: undefined,
    });
  }, [effectiveFileUrl, id, nodeData.fileName, updateNodeData]);

  const handleCaptureVideoFrame = useCallback(async (time: number) => {
    const sourceUrl = typeof effectiveFileUrl === 'string' ? effectiveFileUrl.trim() : '';
    if (!sourceUrl) throw new Error('当前视频不可用');
    const frame = await captureVideoFrameDataUrl(sourceUrl, time, 2560);
    const cacheId = `material-frame-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const cached = await persistImageToMaterialCache(cacheId, frame.dataUrl);
    const fileUrl = cached ? materialDiskPlayableUrl(cacheId, 'image') : frame.dataUrl;
    const thumbnailUrl = await makeImageThumbnailDataUrl(frame.dataUrl, 420, 160);
    const store = useCanvasStore.getState();
    const sourceNode = store.nodes.find((node) => node.id === id);
    const position = sourceNode
      ? {
          x: sourceNode.position.x + Number(sourceNode.width || sourceNode.style?.width || 240) + 80,
          y: sourceNode.position.y,
        }
      : { x: 320, y: 240 };
    const fileName = editedFileName(nodeData.fileName, `frame-${Math.round(frame.time * 100)}`, 'jpg');
    const newNodeId = store.addNodeWithData('material', position, {
      label: '素材',
      fileUrl,
      thumbnailUrl,
      fileName,
      fileType: 'image',
      mentionSlug: fileNameToMentionSlug(fileName),
      materialAspectW: frame.width,
      materialAspectH: frame.height,
    }, { captureEntrance: true, syncCommit: true });
    if (newNodeId) store.addGlowingNode(newNodeId);
  }, [effectiveFileUrl, id, nodeData.fileName]);

  const handleCaptureVideoFrameMode = useCallback(async (mode: MaterialVideoFrameCaptureMode) => {
    if (frameCaptureBusy) return;
    setFrameCaptureBusy(mode);
    setFrameCaptureMessage('');
    try {
      const previewVideo = compactFrameRef.current?.querySelector('video');
      const currentTime =
        mode === 'free' && previewVideo && Number.isFinite(previewVideo.currentTime)
          ? previewVideo.currentTime
          : 0;
      const captureTime = mode === 'last'
        ? Number.POSITIVE_INFINITY
        : mode === 'free'
          ? currentTime
          : 0;
      await handleCaptureVideoFrame(captureTime);
      setFrameCaptureMessage(`已生成${MATERIAL_VIDEO_FRAME_CAPTURE_LABELS[mode]}素材`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      console.error('素材视频截帧失败:', error);
      setFrameCaptureMessage(`截帧失败：${message}`);
    } finally {
      setFrameCaptureBusy(null);
    }
  }, [frameCaptureBusy, handleCaptureVideoFrame]);

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeData(id, { mentionSlug: sanitizeSlugInput(e.target.value) });
  };

  const handleSlugBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const next = sanitizeSlugInput(e.target.value.trim());
    updateNodeData(id, { mentionSlug: next || defaultMaterialSlug(id) });
  };

  const handleAssetIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = normalizeSeedanceAssetInput(e.target.value);
    updateNodeData(id, {
      seedanceAssetId: next.id,
      seedanceAssetUri: next.uri,
    });
  };

  const handleAssetGroupIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeData(id, { seedanceAssetGroupId: e.target.value.trim() });
  };

  const handleCharacterMaterialToggle = () => {
    updateNodeData(id, {
      characterMaterialEnabled: nodeData.characterMaterialEnabled !== true,
    });
  };

  const handleCharacterVoiceUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file || characterVoiceBusy) return;
    setCharacterVoiceBusy(true);
    updateNodeData(id, { characterVoiceError: undefined });
    try {
      const originalUrl = await fileToDataUrl(file);
      const waveform = await readAudioWaveform(originalUrl);
      if (waveform.duration < MIN_VOICE_REFERENCE_SECONDS) {
        throw new Error(`参考音色不能短于 ${MIN_VOICE_REFERENCE_SECONDS} 秒`);
      }
      const trimStart = 0;
      const trimEnd = Math.min(10, waveform.duration);
      const referenceUrl = await trimAudioUrlToWavDataUrl(originalUrl, trimStart, trimEnd);
      updateNodeData(id, {
        characterVoiceOriginalUrl: originalUrl,
        characterVoiceReferenceUrl: referenceUrl,
        characterVoiceFileName: file.name,
        characterVoiceTrimStart: trimStart,
        characterVoiceTrimEnd: trimEnd,
        characterVoiceDuration: waveform.duration,
        characterVoiceError: undefined,
      });
    } catch (error) {
      updateNodeData(id, {
        characterVoiceError: error instanceof Error ? error.message : '参考音色读取失败',
      });
    } finally {
      setCharacterVoiceBusy(false);
    }
  }, [characterVoiceBusy, id, updateNodeData]);

  const handleCharacterVoiceTrim = useCallback(async (start: number, end: number) => {
    const storedSource = nodeData.characterVoiceOriginalUrl || nodeData.characterVoiceReferenceUrl || '';
    if (!storedSource) throw new Error('请先上传参考音色');
    setCharacterVoiceBusy(true);
    updateNodeData(id, { characterVoiceError: undefined });
    try {
      const sourceUrl = await hydratePersistedAudioUrl(storedSource);
      const referenceUrl = await trimAudioUrlToWavDataUrl(sourceUrl, start, end);
      updateNodeData(id, {
        characterVoiceReferenceUrl: referenceUrl,
        characterVoiceTrimStart: start,
        characterVoiceTrimEnd: end,
        characterVoiceError: undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '参考音色裁剪失败';
      updateNodeData(id, { characterVoiceError: message });
      throw error;
    } finally {
      setCharacterVoiceBusy(false);
    }
  }, [id, nodeData.characterVoiceOriginalUrl, nodeData.characterVoiceReferenceUrl, updateNodeData]);

  const handleCharacterVoiceRemove = () => {
    updateNodeData(id, {
      characterVoiceOriginalUrl: '',
      characterVoiceReferenceUrl: '',
      characterVoiceFileName: '',
      characterVoiceTrimStart: undefined,
      characterVoiceTrimEnd: undefined,
      characterVoiceDuration: undefined,
      characterVoiceError: undefined,
    });
  };

  // 当原始素材更新时，清除人脸合规结果
  useEffect(() => {
    if (nodeData.faceComplianceProcessed && nodeData.faceComplianceResults?.[0]?.inputUrl !== nodeData.fileUrl) {
      updateNodeData(id, {
        faceComplianceProcessed: false,
        faceComplianceResults: undefined,
        faceComplianceStatus: 'idle',
        faceComplianceError: undefined,
      });
    }
  }, [id, nodeData.fileUrl, nodeData.faceComplianceProcessed, nodeData.faceComplianceResults, updateNodeData]);

  // 人脸合规处理函数
  const canProcessFaceCompliance = useMemo(() => {
    return nodeData.fileType === 'image' && !!nodeData.fileUrl && nodeData.faceComplianceStatus !== 'processing';
  }, [nodeData.fileType, nodeData.fileUrl, nodeData.faceComplianceStatus]);

  const handleFaceComplianceProcess = useCallback(async () => {
    if (!nodeData.fileUrl) return;

    const requestId = faceComplianceRequestRef.current + 1;
    faceComplianceRequestRef.current = requestId;
    const inputUrl = nodeData.fileUrl;
    updateNodeData(id, { faceComplianceStatus: 'processing', faceComplianceError: undefined });

    try {
      const result: ComplianceResult = await applyFaceCompliance(inputUrl);
      const cacheId = `${id}-fc`;
      const cached = await persistImageToMaterialCache(cacheId, result.dataUrl);
      if (faceComplianceRequestRef.current !== requestId) return;
      const outputUrl = cached
        ? materialDiskPlayableUrl(cacheId, 'image')
        : result.dataUrl;
      const complianceResult = {
        inputUrl,
        outputUrl,
        faceCount: result.faceCount,
        eyesCount: result.eyesCount,
        mouthCount: result.mouthCount,
      };
      
      updateNodeData(id, {
        faceComplianceProcessed: true,
        faceComplianceResults: [complianceResult],
        faceComplianceStatus: result.faceCount > 0 ? 'success' : 'noFace',
        faceComplianceError: undefined,
      });
    } catch (error) {
      if (faceComplianceRequestRef.current !== requestId) return;
      console.error('人脸合规处理失败:', error);
      updateNodeData(id, {
        faceComplianceStatus: 'error',
        faceComplianceError: error instanceof Error ? error.message : '人脸合规处理失败',
      });
    }
  }, [id, nodeData.fileUrl, updateNodeData]);

  const handleFaceComplianceToggle = useCallback(() => {
    const nextEnabled = !nodeData.faceComplianceEnabled;
    updateNodeData(id, { faceComplianceEnabled: nextEnabled });
    if (nextEnabled && canProcessFaceCompliance) {
      void handleFaceComplianceProcess();
    }
  }, [
    canProcessFaceCompliance,
    handleFaceComplianceProcess,
    id,
    nodeData.faceComplianceEnabled,
    updateNodeData,
  ]);

  const isSubtitleRemovalProcessing =
    nodeData.subtitleRemovalStatus === 'queued'
    || nodeData.subtitleRemovalStatus === 'processing';
  const subtitleRemovalNodeProgress = Math.max(
    0,
    Math.min(100, Number(nodeData.subtitleRemovalProgress) || 0),
  );
  const subtitleRemovalNodeError = nodeData.subtitleRemovalStatus === 'error'
    ? nodeData.subtitleRemovalMessage || '去字幕失败'
    : undefined;

  const compactCard = (
    <div
      ref={compactFrameRef}
      data-tutorial-id="material-node"
      data-tutorial-node-id={id}
      onPointerEnter={() => { void prepareBrowserMediaDrag(); }}
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest('.mc-material-compact-actions')) return;
        const store = useCanvasStore.getState();
        const currentNode = store.nodes.find((node) => node.id === id);
        if (currentNode) store.setSelectedNode(currentNode);
      }}
      className="group mc-node-media-frame-anchor mc-node-media-only-anchor relative w-[360px] overflow-visible"
    >
      <Handle type="target" position={Position.Left} className="mc-node-handle mc-node-inner-frame-handle" />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        onChange={handleFileSelect}
        className="hidden"
      />
      <input
        ref={characterVoiceInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
        onChange={handleCharacterVoiceUpload}
        className="hidden"
      />
      <CompactNodeFrame
        title={nodeData.label}
        icon={<Layers className="h-3 w-3" />}
        mediaUrl={nodeData.fileType === 'image' ? effectiveFileUrl : nodeData.fileUrl}
        imageThumbnailUrl={nodeData.fileType === 'image' ? nodeData.thumbnailUrl : undefined}
        posterUrl={nodeData.fileType === 'video' ? nodeData.thumbnailUrl : undefined}
        mediaType={nodeData.fileUrl || nodeData.subtitleRemovalStatus ? nodeData.fileType : undefined}
        text={nodeData.fileUrl ? nodeData.fileName || `@${nodeData.mentionSlug || defaultMaterialSlug(id)}` : undefined}
        badge={nodeData.faceComplianceEnabled && nodeData.faceComplianceProcessed
          ? `合规 · ${nodeData.faceComplianceResults?.[0]?.faceCount || 0} 脸`
          : nodeData.characterMaterialEnabled
            ? '角色素材'
            : isSubtitleRemovalProcessing
              ? '去字幕'
            : nodeData.fileUrl ? nodeData.fileType : undefined}
        width="w-full"
        frameAspectRatio={compactFrameAspect}
        mediaAspectRatio={compactMediaAspect}
        accent="cyan"
        mediaFrameClassName={cn(isGlowing && 'mc-node-success-glow')}
        mediaOnly
        isLoading={isSubtitleRemovalProcessing}
        progress={subtitleRemovalNodeProgress}
        loadingLabel="去字幕中"
        statusMessage={subtitleRemovalNodeError}
        statusTone={subtitleRemovalNodeError ? 'error' : 'info'}
      />
      {nodeData.fileUrl ? (
        <div className="mc-material-compact-actions nodrag nopan absolute bottom-full right-0 z-10 mb-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            draggable
            title="拖入画布节点"
            aria-label="拖入画布节点"
            onPointerEnter={() => { void prepareBrowserMediaDrag(); }}
            onDragStart={handleMediaDragStart}
            onDrag={handleMediaDrag}
            onDragEnd={handleMediaDragEnd}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={handleBrowserMediaPointerDown}
            onPointerMove={handleBrowserMediaPointerMove}
            onPointerUp={handleBrowserMediaPointerRelease}
            onPointerCancel={handleBrowserMediaPointerRelease}
            className="nodrag nopan mc-node-frost-surface flex h-7 w-7 cursor-grab items-center justify-center rounded-lg border text-slate-300 transition-colors hover:border-white/25 hover:text-white active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          {(nodeData.fileType === 'image' || nodeData.fileType === 'video' || nodeData.fileType === 'audio') ? (
            <button
              type="button"
              title={nodeData.fileType === 'image' ? '裁剪与编辑图片' : nodeData.fileType === 'audio' ? '剪辑音频' : '剪辑视频'}
              aria-label={nodeData.fileType === 'image' ? '裁剪与编辑图片' : nodeData.fileType === 'audio' ? '剪辑音频' : '剪辑视频'}
              onClick={(event) => {
                event.stopPropagation();
                setMediaEditorOpen(true);
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              className="mc-node-frost-surface flex h-7 w-7 items-center justify-center rounded-lg border text-slate-300 transition-colors hover:border-white/25 hover:text-white"
            >
              {nodeData.fileType === 'image' ? (
                <Crop className="h-3.5 w-3.5" />
              ) : (
                <Scissors className="h-3.5 w-3.5" />
              )}
            </button>
          ) : null}
          {(nodeData.fileType === 'image' || nodeData.fileType === 'video') ? (
            <button
              type="button"
              title={subtitleRemovalProgress === null ? '去字幕' : `去字幕中 ${subtitleRemovalProgress}%`}
              aria-label={subtitleRemovalProgress === null ? `去除${nodeData.fileType === 'video' ? '视频' : '图片'}字幕` : `正在去字幕 ${subtitleRemovalProgress}%`}
              aria-haspopup="dialog"
              aria-expanded={subtitleRemovalDialogOpen}
              disabled={subtitleRemovalProgress !== null}
              onClick={(event) => {
                event.stopPropagation();
                setSubtitleRemovalDialogOpen(true);
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              className="mc-node-frost-surface flex h-7 w-7 items-center justify-center rounded-lg border text-slate-300 transition-colors hover:border-white/25 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              {subtitleRemovalProgress === null
                ? <Eraser className="h-3.5 w-3.5" />
                : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            </button>
          ) : null}
          <button
            type="button"
            title="下载素材"
            aria-label="下载素材"
            disabled={isDownloading}
            onClick={(event) => {
              event.stopPropagation();
              void handleDownload();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className="mc-node-frost-surface flex h-7 w-7 items-center justify-center rounded-lg border text-slate-300 transition-colors hover:border-white/25 hover:text-white disabled:cursor-wait disabled:opacity-60"
          >
            {isDownloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            data-tutorial-id="material-upload-button"
            data-tutorial-node-id={id}
            title="替换素材"
            aria-label="替换素材"
            onClick={(event) => {
              event.stopPropagation();
              handleUploadClick();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className="mc-node-frost-surface flex h-7 w-7 items-center justify-center rounded-lg border text-slate-300 transition-colors hover:border-white/25 hover:text-white"
          >
            <Upload className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="移除素材"
            aria-label="移除素材"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.detail === 0) handleRemove();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              handleRemove();
            }}
            className="mc-node-frost-surface flex h-7 w-7 items-center justify-center rounded-lg border text-slate-300 transition-colors hover:border-red-300/35 hover:text-red-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : isSubtitleRemovalProcessing || nodeData.subtitleRemovalStatus === 'error' ? null : (
        <button
          type="button"
          data-tutorial-id="material-upload-button"
          data-tutorial-node-id={id}
          title="上传素材"
          aria-label="上传素材"
          onClick={(event) => {
            event.stopPropagation();
            handleUploadClick();
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            'absolute inset-7 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/14 bg-[#080a0d]/72 text-xs text-slate-300 transition-colors hover:border-white/30 hover:bg-[#101318]/82',
            isUploading && 'cursor-wait opacity-70'
          )}
        >
          {isUploading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>上传中...</span>
            </>
          ) : (
            <>
              <Upload className="h-5 w-5" />
              <span>上传素材</span>
            </>
          )}
        </button>
      )}
      <Handle type="source" position={Position.Right} className="mc-node-handle mc-node-inner-frame-handle" />
    </div>
  );

  return (
    <div className="mc-node-edit-anchor mc-material-edit-anchor relative w-[360px] overflow-visible">
      {compactCard}
      {showSettingsPanel ? (
        <ScreenSpaceNodePanel
        anchorRef={compactFrameRef}
        data-tutorial-id="material-settings-panel"
        data-tutorial-node-id={id}
        className={cn(
          'mc-node-expanded mc-node-edit-panel mc-node-screen-space-panel nodrag nopan nowheel flex flex-col gap-2 overflow-hidden rounded-xl border border-white/22 bg-[#080a0d]/92 p-3 transition-colors mc-dur-12f',
          showSettingsPanel
            ? 'shadow-[0_0_32px_rgba(255,255,255,0.14),0_22px_50px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.2)]'
            : 'border-slate-300/10 hover:border-slate-300/18'
        )}
      >
      <div className="grid w-full grid-cols-[1.25fr_1.55fr_1.2fr] gap-2">
        <div data-tutorial-id="material-mention-input" data-tutorial-node-id={id}>
          <label className="text-[10px] text-zinc-500 mb-1 block">@ 引用名称</label>
          <Input
            value={nodeData.mentionSlug || ''}
            onChange={handleSlugChange}
            onBlur={handleSlugBlur}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="如 素材A"
            className="nodrag nopan nowheel mc-node-frost-surface h-8 border text-xs"
          />
        </div>
        <div data-tutorial-id="material-seedance-settings" data-tutorial-node-id={id}>
          <label className="text-[10px] text-zinc-500 mb-1 block">Seedance Asset ID</label>
          <Input
            value={nodeData.seedanceAssetUri || nodeData.seedanceAssetId || ''}
            onChange={handleAssetIdChange}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="asset://asset-..."
            className="nodrag nopan nowheel mc-node-frost-surface h-8 border text-xs"
          />
        </div>
        <div data-tutorial-id="material-seedance-settings" data-tutorial-node-id={id}>
          <label className="text-[10px] text-zinc-500 mb-1 block">Asset Group ID</label>
          <Input
            value={nodeData.seedanceAssetGroupId || ''}
            onChange={handleAssetGroupIdChange}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="group-...（可选）"
            className="nodrag nopan nowheel mc-node-frost-surface h-8 border text-xs"
          />
        </div>
      </div>

      <div className="mc-node-frost-strip flex min-h-5 items-center justify-between gap-2 overflow-hidden rounded-md px-2 py-1 text-[9px] text-zinc-500">
        <span className="min-w-0 truncate">
          {nodeData.fileName ? `当前素材：${nodeData.fileName}` : '当前未上传素材，可在上方节点内上传'}
        </span>
        <span className="shrink-0">
          {nodeData.seedanceAssetUri || nodeData.seedanceAssetId ? '已配置 Asset' : 'Asset ID 可选'}
        </span>
      </div>

      <div className="space-y-2 rounded-lg border border-white/10 bg-[#101318] p-2">
        <div className="flex min-h-7 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <UserRound className="h-3.5 w-3.5 shrink-0 text-cyan-200/80" />
            <div className="min-w-0">
              <div className="text-xs font-medium text-zinc-200">角色素材</div>
              <div className="truncate text-[10px] text-zinc-500">输出角色画面、描述与参考音色</div>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={nodeData.characterMaterialEnabled === true}
            aria-label="角色素材"
            onClick={handleCharacterMaterialToggle}
            className={cn(
              'relative h-5 w-8 shrink-0 rounded-full transition-colors',
              nodeData.characterMaterialEnabled ? 'bg-cyan-500/70' : 'bg-slate-600/60'
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                nodeData.characterMaterialEnabled ? 'left-3.5' : 'left-0.5'
              )}
            />
          </button>
        </div>

        {nodeData.characterMaterialEnabled ? (
          <div className="space-y-2 border-t border-white/8 pt-2">
            <label className="block">
              <span className="mb-1 block text-[11px] text-zinc-400">角色描述</span>
              <textarea
                value={nodeData.characterDescription || ''}
                onChange={(event) => updateNodeData(id, { characterDescription: event.target.value })}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="描述角色身份、年龄、外貌、服装、性格和声音特点"
                className="nodrag nopan nowheel h-20 w-full resize-none rounded-md border border-white/12 bg-[#080a0d] px-2 py-1.5 text-xs leading-[1.5] text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-cyan-300/40"
              />
            </label>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Volume2 className="h-3.5 w-3.5 shrink-0 text-cyan-200/80" />
                  <span className="text-[11px] text-zinc-300">参考音色</span>
                  {nodeData.characterVoiceFileName ? (
                    <span className="min-w-0 truncate text-[10px] text-zinc-500">
                      {nodeData.characterVoiceFileName}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={characterVoiceBusy}
                    onClick={() => characterVoiceInputRef.current?.click()}
                    className="h-6 rounded-md border border-white/12 bg-white/[0.04] px-2 text-[10px] text-zinc-300 hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-50"
                  >
                    {characterVoiceBusy ? '处理中' : nodeData.characterVoiceOriginalUrl ? '替换' : '上传'}
                  </button>
                  {nodeData.characterVoiceOriginalUrl || nodeData.characterVoiceReferenceUrl ? (
                    <button
                      type="button"
                      aria-label="移除参考音色"
                      title="移除参考音色"
                      onClick={handleCharacterVoiceRemove}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-white/12 bg-white/[0.04] text-zinc-500 hover:border-red-300/30 hover:text-red-200"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              </div>

              {nodeData.characterVoiceOriginalUrl || nodeData.characterVoiceReferenceUrl ? (
                <VoiceReferenceTrimmer
                  sourceUrl={nodeData.characterVoiceOriginalUrl || nodeData.characterVoiceReferenceUrl || ''}
                  initialStart={nodeData.characterVoiceTrimStart || 0}
                  initialEnd={nodeData.characterVoiceTrimEnd}
                  maxSelectionSeconds={10}
                  disabled={characterVoiceBusy}
                  textSize="comfortable"
                  onCommit={handleCharacterVoiceTrim}
                />
              ) : (
                <button
                  type="button"
                  disabled={characterVoiceBusy}
                  onClick={() => characterVoiceInputRef.current?.click()}
                  className="flex h-16 w-full items-center justify-center gap-2 rounded-md border border-dashed border-white/12 bg-[#080a0d] text-[11px] text-zinc-500 hover:border-cyan-300/25 hover:text-zinc-300 disabled:cursor-wait"
                >
                  {characterVoiceBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  上传参考音色并裁剪
                </button>
              )}
              {nodeData.characterVoiceError ? (
                <div className="rounded-md border border-red-400/20 bg-red-500/8 px-2 py-1 text-[10px] text-red-200/80">
                  {nodeData.characterVoiceError}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {nodeData.fileType === 'image' && nodeData.fileUrl ? (
        <div className="mc-node-frost-strip flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[9px] text-zinc-500">
            支持自由裁剪、旋转和翻转
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setMediaEditorOpen(true)}
            className="h-7 shrink-0 gap-1 border-white/12 bg-white/[0.04] px-2 text-[10px] text-zinc-200 hover:bg-white/[0.08]"
          >
            <Crop className="h-3 w-3" />
            图片编辑
          </Button>
        </div>
      ) : null}

      {nodeData.fileType === 'video' && nodeData.fileUrl ? (
        <div className="mc-node-frost-strip flex min-h-9 items-center justify-between gap-2 rounded-md px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[9px] text-zinc-500">
            {frameCaptureMessage || '播放到目标画面后可自由截帧'}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              title="视频剪辑"
              aria-label="视频剪辑"
              onClick={() => setMediaEditorOpen(true)}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              className="mc-node-frost-surface flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[10px] text-slate-300 transition-colors hover:border-white/25 hover:text-white"
            >
              <Scissors className="h-3.5 w-3.5" />
              <span>视频剪辑</span>
            </button>
            {([
              { mode: 'free' as const, icon: Scissors },
              { mode: 'first' as const, icon: SkipBack },
              { mode: 'last' as const, icon: SkipForward },
            ]).map(({ mode, icon: Icon }) => {
              const busy = frameCaptureBusy === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={Boolean(frameCaptureBusy)}
                  title={MATERIAL_VIDEO_FRAME_CAPTURE_LABELS[mode]}
                  aria-label={MATERIAL_VIDEO_FRAME_CAPTURE_LABELS[mode]}
                  onClick={() => void handleCaptureVideoFrameMode(mode)}
                  onMouseDown={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="mc-node-frost-surface flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[10px] text-slate-300 transition-colors hover:border-white/25 hover:text-white disabled:cursor-wait disabled:opacity-55"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                  <span>{MATERIAL_VIDEO_FRAME_CAPTURE_LABELS[mode]}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {nodeData.fileType === 'audio' && nodeData.fileUrl ? (
        <div className="mc-node-frost-strip flex min-h-9 items-center justify-between gap-2 rounded-md px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[9px] text-zinc-500">
            试听音频并设置需要保留的入点和出点
          </span>
          <button
            type="button"
            title="音频剪辑"
            aria-label="音频剪辑"
            onClick={() => setMediaEditorOpen(true)}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className="mc-node-frost-surface flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[10px] text-slate-300 transition-colors hover:border-white/25 hover:text-white"
          >
            <Scissors className="h-3.5 w-3.5" />
            <span>音频剪辑</span>
          </button>
        </div>
      ) : null}

      {nodeData.fileType === 'image' && (
        <div
          data-tutorial-id="material-face-compliance"
          data-tutorial-node-id={id}
          className="space-y-1.5"
        >
          <div className="mc-node-frost-strip flex min-h-8 items-center justify-between gap-2 rounded-md px-2 py-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" />
              <span className="shrink-0 text-[10px] text-zinc-400">人脸合规检测</span>
              {nodeData.faceComplianceProcessed && nodeData.faceComplianceResults && (
                <span className="min-w-0 truncate text-[9px] text-zinc-500">
                  {nodeData.faceComplianceResults.map((result) => `检测到 ${result.faceCount} 个人脸`).join('，')}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={nodeData.faceComplianceEnabled === true}
                aria-label="素材人脸合规"
                title="启用并开始人脸合规检测"
                onClick={handleFaceComplianceToggle}
                className={cn(
                  'relative h-5 w-8 rounded-full transition-colors',
                  nodeData.faceComplianceEnabled ? 'bg-emerald-500/60' : 'bg-slate-600/50'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                    nodeData.faceComplianceEnabled ? 'left-3.5 translate-x-0' : 'left-0.5'
                  )}
                />
              </button>
              <Button
                onClick={handleFaceComplianceProcess}
                disabled={!nodeData.faceComplianceEnabled || !canProcessFaceCompliance || nodeData.faceComplianceStatus === 'processing'}
                variant="outline"
                size="sm"
                className="h-7 gap-1 border-emerald-500/30 bg-emerald-500/10 px-2 text-xs text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/20 disabled:opacity-45"
              >
                {nodeData.faceComplianceStatus === 'processing' ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    处理中...
                  </>
                ) : (
                  <>
                    {nodeData.faceComplianceProcessed ? (
                      <ShieldCheck className="h-3 w-3" />
                    ) : (
                      <EyeOff className="h-3 w-3" />
                    )}
                    {nodeData.faceComplianceProcessed ? '重新处理' : '处理图片'}
                  </>
                )}
              </Button>
            </div>
          </div>
          {nodeData.faceComplianceStatus === 'error' && nodeData.faceComplianceError ? (
            <div className="rounded-md border border-red-400/20 bg-red-500/8 px-2 py-1.5 text-[9px] text-red-200/80">
              {nodeData.faceComplianceError}
            </div>
          ) : null}
        </div>
      )}
        </ScreenSpaceNodePanel>
      ) : null}
      {mediaEditorOpen
        && effectiveFileUrl
        && (nodeData.fileType === 'image' || nodeData.fileType === 'video' || nodeData.fileType === 'audio') ? (
          <MaterialMediaEditor
            sourceUrl={effectiveFileUrl}
            posterUrl={nodeData.thumbnailUrl}
            fileType={nodeData.fileType}
            fileName={nodeData.fileName}
            onClose={() => setMediaEditorOpen(false)}
            onApplyImage={handleApplyImageEdit}
            onTrimVideo={handleTrimVideo}
            onTrimAudio={handleTrimAudio}
            onCaptureFrame={handleCaptureVideoFrame}
          />
        ) : null}
      {subtitleRemovalDialogOpen
        && effectiveFileUrl
        && (nodeData.fileType === 'image' || nodeData.fileType === 'video') ? (
          <SubtitleRemovalDialog
            sourceUrl={effectiveFileUrl}
            posterUrl={nodeData.fileType === 'video' ? nodeData.thumbnailUrl : undefined}
            mediaType={nodeData.fileType}
            fileName={nodeData.fileName}
            onClose={() => setSubtitleRemovalDialogOpen(false)}
            onConfirm={(options) => {
              setSubtitleRemovalDialogOpen(false);
              void handleRemoveSubtitles(options);
            }}
          />
        ) : null}
    </div>
  );
}

export default memo(MaterialNode);
