'use client';

import { Handle, Position, type NodeProps, useUpdateNodeInternals } from 'reactflow';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Sparkles, Loader2, Download, Key } from 'lucide-react';

import { CanvasNodeData, useCanvasStore } from '../canvas/CanvasStore';
import { useSeedanceStore } from '../seedance/SeedanceStore';
import { createTopazImageAPI } from '../api/TopazImageAPI';
import { CompactNodeFrame } from '../canvas/CompactNodeFrame';
import { GenerationEta } from '../canvas/GenerationEta';
import {
  resolveTopazInboundImageUrl,
  resolveTopazInboundKind,
  resolveTopazInboundVideoUrl,
} from '@/lib/resolve-topaz-inbound-url';
import { coalesceTopazImageUrlForApi, coalesceTopazVideoUrlForApi } from '@/lib/topaz-client-coalesce-media-url';
import { getKieProviderTokenBucket, KIE_GLOBAL_PROVIDER_TOKEN_KEY } from '@/lib/kie-usage-display';
import {
  GENERATED_IMAGE_DND_TYPE,
  GENERATED_VIDEO_DND_TYPE,
  makeGeneratedImageFileName,
  makeGeneratedVideoFileName,
  type GeneratedImageDragPayload,
  type GeneratedVideoDragPayload,
} from '@/lib/generated-image-dnd';
import { Button } from '@/components/ui/button';
import { Select, SelectItem } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useAgentGenerationBridge } from '@/lib/useAgentGenerationBridge';

type TopazPanelMode = 'image' | 'video';

const TOPAZ_IMAGE_UPSCALE_FACTOR_CHOICES = [2, 4, 8] as const;
const TOPAZ_VIDEO_UPSCALE_FACTOR_CHOICES = [2, 4] as const;

const MAX_IMAGE_HISTORY = 12;
const MAX_VIDEO_HISTORY = 12;
const TOPAZ_PROVIDER_TOKEN_KEY = KIE_GLOBAL_PROVIDER_TOKEN_KEY;
const DEFAULT_TOPAZ_MEDIA_ASPECT = { w: 16, h: 9 };
const TOPAZ_MEDIA_BASE_HEIGHT = 220;
const TOPAZ_OPTIONS_WIDTH = 260;
const TOPAZ_EXPANDED_MIN_WIDTH = 760;
const TOPAZ_EXPANDED_MIN_HEIGHT = 280;
const TOPAZ_EXPANDED_MAX_WIDTH = 1400;
const TOPAZ_EXPANDED_MAX_HEIGHT = 1200;
const TOPAZ_BODY_PADDING_X = 24;
const TOPAZ_BODY_GAP_X = 24;

interface TopazEnhanceNodeData extends CanvasNodeData {
  outputImageUrl?: string;
  outputVideoUrl?: string;
  topazViewingImageUrl?: string;
  topazViewingVideoUrl?: string;
  topazPanelMode?: TopazPanelMode;
  topazImageHistory?: string[];
  topazVideoHistory?: string[];
  topazWidth?: number;
  topazHeight?: number;
  topazStatus?: string;
  topazProgress?: number;
  topazLastError?: string;
  /** Legacy VIAPI option kept only for old workflow compatibility. */
  viapiBitRate?: number;
  /** Legacy VIAPI option kept only for old workflow compatibility. */
  viapiImageMode?: string;
  /** Topaz/Kie upscale factor. */
  viapiUpscaleFactor?: number;
  /** Legacy provider marker. Topaz is now the only active provider. */
  topazProvider?: 'aliyun' | 'topaz';
}

function coerceStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
}

function normalizeUpscaleFactor(v: unknown, fallback: number, choices: readonly number[]): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (choices.includes(n)) return n;
  if (choices.includes(8) && n >= 6) return 8;
  if (n >= 3) return 4;
  if (n < 1.5) return choices[0] ?? fallback;
  return 2;
}

function isUpscaleFactorChoice(choices: readonly number[], value: number): boolean {
  return choices.includes(value);
}

const PREVIEW_FRAME_CLASS =
  'nodrag nopan nowheel mc-node-frost-media-well relative w-full min-w-0 min-h-[96px] overflow-hidden rounded-md border border-white/10 bg-black/25';

const stopNodePointer = (e: React.SyntheticEvent) => {
  e.stopPropagation();
};

function NodeEmbeddedVideo({
  src,
  poster,
  className,
  onLoadedMetadata,
}: {
  src: string;
  poster?: string;
  className?: string;
  onLoadedMetadata?: (event: SyntheticEvent<HTMLVideoElement>) => void;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      src={src}
      controls
      playsInline
      preload="metadata"
      poster={poster || undefined}
      className={cn('h-full min-h-[96px] w-full object-contain', className)}
      onMouseDown={stopNodePointer}
      onPointerDown={stopNodePointer}
      onClick={stopNodePointer}
      onDoubleClick={stopNodePointer}
      onLoadedMetadata={onLoadedMetadata}
    />
  );
}

function PreviewPane({
  label,
  children,
  className,
  style,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn('flex w-full min-w-0 min-h-0 flex-col gap-1', className)} style={style}>
      <span className="px-0.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">{label}</span>
      {children}
    </div>
  );
}

function TopazEnhanceNode({ id, data, selected }: NodeProps<TopazEnhanceNodeData>) {
  const isExpanded = useCanvasStore((state) => state.selectedNode?.id === id);
  const enhanceCategoryConfig = useSeedanceStore((s) => s.config.enhance);
  const providerTokens = useSeedanceStore((s) => s.config.providerTokens);
  const addProviderTokens = useSeedanceStore((s) => s.addProviderTokens);
  const setProviderRemainingTokens = useSeedanceStore((s) => s.setProviderRemainingTokens);
  const updateNodeInternals = useUpdateNodeInternals();
  const { nodes, edges, updateNodeData, updateTopazEnhanceGeometry } = useCanvasStore(
    useShallow((s) => ({
      nodes: s.nodes,
      edges: s.edges,
      updateNodeData: s.updateNodeData,
      updateTopazEnhanceGeometry: s.updateTopazEnhanceGeometry,
    }))
  );

  const [busy, setBusy] = useState(false);
  const [localProgress, setLocalProgress] = useState(0);
  const [localMessage, setLocalMessage] = useState('');
  const [creditLoading, setCreditLoading] = useState(false);
  const [creditError, setCreditError] = useState('');

  const inboundKind = useMemo(() => resolveTopazInboundKind(nodes, edges, id), [nodes, edges, id]);
  const inboundImageUrl = useMemo(
    () => (inboundKind === 'image' ? resolveTopazInboundImageUrl(nodes, edges, id) : ''),
    [inboundKind, nodes, edges, id]
  );
  const inboundVideoUrl = useMemo(
    () => (inboundKind === 'video' ? resolveTopazInboundVideoUrl(nodes, edges, id) : ''),
    [inboundKind, nodes, edges, id]
  );
  const inboundPosterUrl = useMemo(
    () => (inboundKind === 'video' ? resolveTopazInboundImageUrl(nodes, edges, id) : ''),
    [inboundKind, nodes, edges, id]
  );

  const panelMode: TopazPanelMode = data.topazPanelMode === 'video' ? 'video' : 'image';
  const topazProviderConfig = enhanceCategoryConfig.providers.topaz;
  const topazHasKey = Boolean(topazProviderConfig?.apiKey?.trim());
  const topazTokenBucket = getKieProviderTokenBucket(providerTokens, 'enhance.topaz');
  const imageHistory = useMemo(() => coerceStringArray(data.topazImageHistory), [data.topazImageHistory]);
  const videoHistory = useMemo(() => coerceStringArray(data.topazVideoHistory), [data.topazVideoHistory]);

  const refreshTopazCredits = useCallback(async () => {
    if (!topazHasKey) {
      setCreditError('');
      return;
    }
    setCreditLoading(true);
    setCreditError('');
    try {
      const topazApi = createTopazImageAPI(topazProviderConfig);
      const credits = await topazApi.getCredits();
      if (!credits) {
        setCreditError('credits 查询失败');
        return;
      }
      setProviderRemainingTokens(TOPAZ_PROVIDER_TOKEN_KEY, credits.available);
    } catch (err) {
      setCreditError(err instanceof Error ? err.message : 'credits 查询失败');
    } finally {
      setCreditLoading(false);
    }
  }, [topazHasKey, topazProviderConfig, setProviderRemainingTokens]);

  useEffect(() => {
    if (!isExpanded || !topazHasKey) return;
    void refreshTopazCredits();
  }, [isExpanded, topazHasKey, refreshTopazCredits]);

  useEffect(() => {
    if (inboundKind === 'video' && data.topazPanelMode !== 'video') {
      updateNodeData(id, { topazPanelMode: 'video' }, { recordUndo: false });
    } else if (inboundKind === 'image' && data.topazPanelMode !== 'image') {
      updateNodeData(id, { topazPanelMode: 'image' }, { recordUndo: false });
    }
  }, [inboundKind, id, data.topazPanelMode, updateNodeData]);

  const defaultUpscaleFactor = 2;
  const upscaleFactorChoices =
    panelMode === 'video' ? TOPAZ_VIDEO_UPSCALE_FACTOR_CHOICES : TOPAZ_IMAGE_UPSCALE_FACTOR_CHOICES;
  const nodeUpscaleFactor = normalizeUpscaleFactor(
    data.viapiUpscaleFactor,
    defaultUpscaleFactor,
    upscaleFactorChoices
  );
  const upscaleSelectValue = useMemo(() => {
    const exact = upscaleFactorChoices.find((u) => u === nodeUpscaleFactor);
    if (exact !== undefined) return String(exact);
    return String(
      upscaleFactorChoices.reduce((a, b) =>
        Math.abs(b - nodeUpscaleFactor) < Math.abs(a - nodeUpscaleFactor) ? b : a
      )
    );
  }, [nodeUpscaleFactor, upscaleFactorChoices]);

  const outputUrl = typeof data.outputImageUrl === 'string' ? data.outputImageUrl.trim() : '';
  const outputVideoUrl = typeof data.outputVideoUrl === 'string' ? data.outputVideoUrl.trim() : '';
  const viewingImage = typeof data.topazViewingImageUrl === 'string' ? data.topazViewingImageUrl.trim() : '';
  const viewingVideo = typeof data.topazViewingVideoUrl === 'string' ? data.topazViewingVideoUrl.trim() : '';
  const effectiveOutputImage = viewingImage || outputUrl;
  const effectiveOutputVideo = viewingVideo || outputVideoUrl;
  const displayedOutputImage = busy ? '' : effectiveOutputImage;
  const displayedOutputVideo = busy ? '' : effectiveOutputVideo;
  const remainingCreditsText =
    topazTokenBucket?.remainingTokens != null
      ? topazTokenBucket.remainingTokens.toLocaleString()
      : creditLoading
        ? '查询中'
        : topazHasKey
          ? '未查询'
          : '未配置 API Key';
  const usedCreditsText = (topazTokenBucket?.usedTokens ?? 0).toLocaleString();
  const topazCreditInfo = (
    <div
      className={cn(
        'rounded border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] font-medium leading-relaxed text-zinc-200',
        creditError && 'border-yellow-400/20 text-yellow-200/75'
      )}
      title={creditError || undefined}
    >
      Topaz credits / 积分：剩余 {remainingCreditsText} · 已记录消耗 {usedCreditsText}
      {creditError ? ` · ${creditError}` : ''}
    </div>
  );

  const imageMainPreview = displayedOutputImage || inboundImageUrl;
  const videoMainPreview = displayedOutputVideo || inboundVideoUrl;

  const showProgress = busy || localProgress > 0;
  const [sourceAspect, setSourceAspect] = useState(DEFAULT_TOPAZ_MEDIA_ASPECT);
  const setSourceAspectFromSize = useCallback((width: number, height: number) => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    const ratio = Math.min(3, Math.max(0.35, width / height));
    const next = { w: Math.round(ratio * 1000), h: 1000 };
    setSourceAspect((prev) => (Math.abs(prev.w / prev.h - ratio) < 0.01 ? prev : next));
  }, []);
  const sourceAspectRatio = `${sourceAspect.w} / ${sourceAspect.h}`;
  const mediaPaneWidth = useMemo(() => {
    const ratio = sourceAspect.w / sourceAspect.h;
    return Math.round(Math.min(460, Math.max(220, TOPAZ_MEDIA_BASE_HEIGHT * ratio)));
  }, [sourceAspect.h, sourceAspect.w]);
  const desiredExpandedWidth = useMemo(
    () =>
      Math.min(
        TOPAZ_EXPANDED_MAX_WIDTH,
        Math.max(
          TOPAZ_EXPANDED_MIN_WIDTH,
          mediaPaneWidth * 2 + TOPAZ_OPTIONS_WIDTH + TOPAZ_BODY_PADDING_X + TOPAZ_BODY_GAP_X
        )
      ),
    [mediaPaneWidth]
  );
  const mediaPaneStyle = useMemo(() => ({ width: `${mediaPaneWidth}px` }), [mediaPaneWidth]);
  const mediaFrameStyle = useMemo(() => ({ aspectRatio: sourceAspectRatio }), [sourceAspectRatio]);

  useEffect(() => {
    if (!inboundImageUrl && !inboundVideoUrl) {
      setSourceAspect(DEFAULT_TOPAZ_MEDIA_ASPECT);
    }
  }, [inboundImageUrl, inboundVideoUrl]);

  const expandedRootRef = useRef<HTMLDivElement | null>(null);
  const expandMeasureRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    updateNodeInternals(id);
  }, [
    id,
    updateNodeInternals,
    isExpanded,
    imageMainPreview,
    videoMainPreview,
    showProgress,
    data.topazLastError,
    panelMode,
    imageHistory.length,
    videoHistory.length,
    viewingImage,
    viewingVideo,
    data.label,
    data.topazWidth,
    data.topazHeight,
    desiredExpandedWidth,
  ]);

  useLayoutEffect(() => {
    if (!isExpanded) return;
    const el = expandMeasureRef.current;
    const root = expandedRootRef.current;
    if (!el || !root) return;

    let raf = 0;
    let timeout = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const st = useCanvasStore.getState();
        const n = st.nodes.find((x) => x.id === id);
        if (!n) return;
        const dh = n.data as TopazEnhanceNodeData;
        const curW = typeof dh.topazWidth === 'number' ? dh.topazWidth : TOPAZ_EXPANDED_MIN_WIDTH;
        const curH = typeof dh.topazHeight === 'number' ? dh.topazHeight : TOPAZ_EXPANDED_MIN_HEIGHT;
        const measuredH = Math.ceil(
          Math.max(
            el.scrollHeight,
            el.getBoundingClientRect().height
          )
        ) + 16;
        const wantW = desiredExpandedWidth;
        const wantH = Math.min(TOPAZ_EXPANDED_MAX_HEIGHT, Math.max(TOPAZ_EXPANDED_MIN_HEIGHT, measuredH));
        if (Math.abs(wantW - curW) < 4 && Math.abs(wantH - curH) < 4) return;
        st.updateTopazEnhanceGeometry(
          id,
          { x: n.position.x, y: n.position.y, width: wantW, height: wantH },
          { recordUndo: false }
        );
        window.requestAnimationFrame(() => updateNodeInternals(id));
      });
    };

    run();
    timeout = window.setTimeout(run, 80);
    const ro = new ResizeObserver(run);
    ro.observe(el);
    ro.observe(root);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
      ro.disconnect();
    };
  }, [
    isExpanded,
    id,
    panelMode,
    inboundKind,
    imageMainPreview,
    videoMainPreview,
    outputUrl,
    outputVideoUrl,
    viewingImage,
    viewingVideo,
    imageHistory.length,
    videoHistory.length,
    showProgress,
    data.topazLastError,
    busy,
    data.label,
    nodeUpscaleFactor,
    desiredExpandedWidth,
    updateNodeInternals,
  ]);

  const runTopazImageEnhance = useCallback(async () => {
    if (!inboundImageUrl) {
      updateNodeData(id, { topazLastError: '请连接上游图片素材' });
      return;
    }
    if (!topazHasKey) {
      updateNodeData(id, { topazLastError: '请先在 API 配置中设置 Topaz / Kie API Key' });
      return;
    }

    setBusy(true);
    setLocalProgress(12);
    setLocalMessage('提交中…');
    updateNodeData(id, { topazLastError: '', topazStatus: '提交中', topazProgress: 12 });

    try {
      setLocalProgress(22);
      setLocalMessage('正在准备图片…');
      const imageUrlForApi = await coalesceTopazImageUrlForApi(inboundImageUrl);

      const topazApi = createTopazImageAPI(topazProviderConfig);

      setLocalProgress(35);
      setLocalMessage('Topaz 云端处理中…');

      const result = await topazApi.enhanceImage({
        imageUrl: imageUrlForApi,
        upscaleFactor: nodeUpscaleFactor,
        outputFormat: 'png',
      });

      if (result.status === 'error') {
        throw new Error(result.error || 'Topaz API 返回错误');
      }

      const out = result.imageUrl || '';
      if (!out) throw new Error('响应缺少输出图片 URL');

      if (result.creditCost != null) {
        addProviderTokens(TOPAZ_PROVIDER_TOKEN_KEY, result.creditCost);
      }
      void refreshTopazCredits();

      const prev = typeof data.outputImageUrl === 'string' ? data.outputImageUrl.trim() : '';
      const hist = [...imageHistory];
      if (prev && prev !== out) {
        hist.push(prev);
        while (hist.length > MAX_IMAGE_HISTORY) hist.shift();
      }
      const successMessage =
        result.usedUpscaleFactor != null &&
        result.requestedUpscaleFactor != null &&
        result.usedUpscaleFactor !== result.requestedUpscaleFactor
          ? `完成（已按 ${result.usedUpscaleFactor}x 输出）`
          : '完成';

      updateNodeData(id, {
        outputImageUrl: out,
        topazImageHistory: hist,
        topazViewingImageUrl: '',
        topazStatus: successMessage,
        topazProgress: 100,
        topazLastError: '',
      });
      setLocalProgress(100);
      setLocalMessage(successMessage);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateNodeData(id, {
        outputImageUrl: '',
        topazViewingImageUrl: '',
        topazLastError: msg,
        topazStatus: '失败',
        topazProgress: 0,
      });
      setLocalMessage(msg);
    } finally {
      setBusy(false);
      setTimeout(() => {
        setLocalProgress(0);
        setLocalMessage('');
      }, 4000);
    }
  }, [
    id,
    inboundImageUrl,
    nodeUpscaleFactor,
    topazProviderConfig,
    topazHasKey,
    addProviderTokens,
    refreshTopazCredits,
    updateNodeData,
    data.outputImageUrl,
    imageHistory,
  ]);

  const runTopazVideoEnhance = useCallback(async () => {
    if (!inboundVideoUrl) {
      updateNodeData(id, { topazLastError: '请连接上游视频素材' });
      return;
    }
    if (!topazHasKey) {
      updateNodeData(id, { topazLastError: '请先在 API 配置中设置 Topaz / Kie API Key' });
      return;
    }

    setBusy(true);
    setLocalProgress(8);
    setLocalMessage('提交中…');
    updateNodeData(id, { topazLastError: '', topazStatus: '提交中', topazProgress: 8 });

    try {
      setLocalProgress(10);
      setLocalMessage('正在准备视频…');
      const videoUrlForApi = await coalesceTopazVideoUrlForApi(inboundVideoUrl);

      setLocalProgress(18);
      setLocalMessage('Topaz 视频超分处理中（可能数分钟）…');

      const topazApi = createTopazImageAPI(topazProviderConfig);
      const result = await topazApi.enhanceVideo({
        videoUrl: videoUrlForApi,
        upscaleFactor: nodeUpscaleFactor,
      });

      if (result.status === 'error') {
        throw new Error(result.error || 'Topaz API 返回错误');
      }

      const out = result.videoUrl || '';
      if (!out) throw new Error('响应缺少输出视频 URL');

      if (result.creditCost != null) {
        addProviderTokens(TOPAZ_PROVIDER_TOKEN_KEY, result.creditCost);
      }
      void refreshTopazCredits();

      const prev = typeof data.outputVideoUrl === 'string' ? data.outputVideoUrl.trim() : '';
      const hist = [...videoHistory];
      if (prev && prev !== out) {
        hist.push(prev);
        while (hist.length > MAX_VIDEO_HISTORY) hist.shift();
      }
      const successMessage =
        result.usedUpscaleFactor != null &&
        result.requestedUpscaleFactor != null &&
        result.usedUpscaleFactor !== result.requestedUpscaleFactor
          ? `完成（已按 ${result.usedUpscaleFactor}x 输出）`
          : '完成';

      updateNodeData(id, {
        outputVideoUrl: out,
        topazVideoHistory: hist,
        topazViewingVideoUrl: '',
        topazStatus: successMessage,
        topazProgress: 100,
        topazLastError: '',
      });
      setLocalProgress(100);
      setLocalMessage(successMessage);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateNodeData(id, {
        topazLastError: msg,
        topazStatus: '失败',
        topazProgress: 0,
      });
      setLocalMessage(msg);
    } finally {
      setBusy(false);
      setTimeout(() => {
        setLocalProgress(0);
        setLocalMessage('');
      }, 4000);
    }
  }, [
    id,
    inboundVideoUrl,
    nodeUpscaleFactor,
    topazProviderConfig,
    topazHasKey,
    addProviderTokens,
    refreshTopazCredits,
    updateNodeData,
    data.outputVideoUrl,
    videoHistory,
  ]);

  useAgentGenerationBridge(
    id,
    panelMode === 'video' ? runTopazVideoEnhance : runTopazImageEnhance,
    {
      status: busy
        ? 'processing'
        : data.topazLastError
          ? 'error'
          : localProgress >= 100
            ? 'success'
            : 'idle',
      message: String(data.topazLastError || localMessage || data.topazStatus || ''),
    },
  );

  const handleDownload = async () => {
    if (!effectiveOutputImage) return;
    try {
      const topazApi = createTopazImageAPI(topazProviderConfig);
      const downloadUrl = topazHasKey
        ? await topazApi.getDownloadUrl(effectiveOutputImage).catch(() => effectiveOutputImage)
        : effectiveOutputImage;
      const response = await fetch(downloadUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `topaz-image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('下载失败:', err);
    }
  };

  const handleDownloadVideo = async () => {
    if (!effectiveOutputVideo) return;
    try {
      const topazApi = createTopazImageAPI(topazProviderConfig);
      const downloadUrl = topazHasKey
        ? await topazApi.getDownloadUrl(effectiveOutputVideo).catch(() => effectiveOutputVideo)
        : effectiveOutputVideo;
      const response = await fetch(downloadUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `topaz-video-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('下载失败:', err);
    }
  };

  const handleGeneratedImageDragStart = (event: React.DragEvent<HTMLElement>, imageUrl: string) => {
    if (!imageUrl) return;
    event.stopPropagation();
    const payload: GeneratedImageDragPayload = {
      imageUrl,
      thumbnailUrl: imageUrl,
      fileName: makeGeneratedImageFileName(),
    };
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(GENERATED_IMAGE_DND_TYPE, JSON.stringify(payload));
    event.dataTransfer.setData('text/uri-list', imageUrl);
  };

  const handleGeneratedVideoDragStart = (event: React.DragEvent<HTMLElement>, videoUrl: string) => {
    if (!videoUrl) return;
    event.stopPropagation();
    const payload: GeneratedVideoDragPayload = {
      videoUrl,
      fileName: makeGeneratedVideoFileName(),
      posterUrl: effectiveOutputImage || inboundPosterUrl || undefined,
    };
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(GENERATED_VIDEO_DND_TYPE, JSON.stringify(payload));
    event.dataTransfer.setData('text/uri-list', videoUrl);
  };

  const progressVal = busy ? Math.max(localProgress, 15) : localProgress;
  const topazEtaKey = `enhance:topaz:${inboundKind || panelMode}`;
  const topazEtaBaselineSeconds = (inboundKind || panelMode) === 'video' ? 1800 : 300;

  const imageTabLocked = inboundKind === 'video';
  const videoTabLocked = inboundKind === 'image';

  if (!isExpanded) {
    const compactText =
      inboundKind === 'video'
        ? inboundVideoUrl
          ? '已连接视频'
          : '请连接上游'
        : inboundKind === 'image'
          ? inboundImageUrl
            ? '已连接图片'
            : '请连接上游'
          : '请连接上游';

    return (
      <div className="relative mc-node-glass-shell mc-node-compact h-full w-full overflow-hidden rounded-lg">
        <Handle type="target" position={Position.Left} id="in" className="mc-node-handle" />
        {inboundKind === 'video' ? (
          <CompactNodeFrame
            title={data.label}
            icon={<Sparkles className="h-3 w-3" />}
            mediaUrl={videoMainPreview || inboundVideoUrl || undefined}
            posterUrl={inboundPosterUrl || effectiveOutputImage || undefined}
            mediaType="video"
            text={compactText}
            badge="Topaz"
            width="w-[280px]"
            accent="violet"
            variant="glass-inner"
            isLoading={busy}
            progress={progressVal}
            etaKey={topazEtaKey}
            etaSessionKey={`enhance:${id}`}
            etaBaselineSeconds={topazEtaBaselineSeconds}
          />
        ) : (
          <CompactNodeFrame
            title={data.label}
            icon={<Sparkles className="h-3 w-3" />}
            mediaUrl={imageMainPreview || undefined}
            mediaType="image"
            text={compactText}
            badge="Topaz"
            width="w-[280px]"
            accent="violet"
            variant="glass-inner"
            isLoading={busy}
            progress={progressVal}
            etaKey={topazEtaKey}
            etaSessionKey={`enhance:${id}`}
            etaBaselineSeconds={topazEtaBaselineSeconds}
          />
        )}
        <Handle type="source" position={Position.Right} id="out" className="mc-node-handle" />
      </div>
    );
  }

  return (
    <div
      ref={expandedRootRef}
      style={{ width: desiredExpandedWidth, minWidth: desiredExpandedWidth }}
      className={cn(
        'mc-topaz-enhance-node mc-topaz-expand-center relative mc-node-glass-shell mc-node-expanded flex h-auto min-h-[280px] min-w-[760px] flex-col overflow-visible rounded-xl border border-white/22 transition-colors mc-dur-12f',
        selected ? 'shadow-[0_0_32px_rgba(255,255,255,0.14),0_22px_50px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.2)]' : 'border-slate-300/10 hover:border-slate-300/18'
      )}
    >
      <Handle type="target" position={Position.Left} id="in" className="mc-node-handle" />

      <div ref={expandMeasureRef} className="flex w-full min-w-0 flex-col overflow-visible">
        <div className="flex items-center gap-2 border-b border-slate-300/10 px-3 py-2 mc-node-frost-header">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/22 bg-white/[0.08]">
            <Sparkles className="h-4 w-4 text-violet-200" />
          </div>
          <span className="text-xs font-medium text-white">{data.label}</span>
        </div>

        <div className="flex w-full min-w-0 items-center justify-center gap-3 p-3">
          <PreviewPane label="原素材" className="shrink-0" style={mediaPaneStyle}>
            <div className={PREVIEW_FRAME_CLASS} style={mediaFrameStyle}>
              {inboundVideoUrl ? (
                <NodeEmbeddedVideo
                  src={inboundVideoUrl}
                  poster={inboundPosterUrl || undefined}
                  onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    setSourceAspectFromSize(video.videoWidth, video.videoHeight);
                    requestAnimationFrame(() => updateNodeInternals(id));
                  }}
                />
              ) : inboundImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={inboundImageUrl}
                  alt=""
                  className="h-full w-full object-contain"
                  draggable={false}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    setSourceAspectFromSize(image.naturalWidth, image.naturalHeight);
                    requestAnimationFrame(() => updateNodeInternals(id));
                  }}
                />
              ) : (
                <div className="flex h-full min-h-[96px] items-center justify-center px-2 text-center text-[10px] text-zinc-500">
                  {inboundKind === 'video' ? '请连接视频上游后显示原片' : '连接图片上游后显示原图'}
                </div>
              )}
            </div>
          </PreviewPane>

          <div
            className="nodrag nopan flex shrink-0 flex-col gap-2 overflow-hidden rounded-md border border-violet-500/25 bg-violet-500/[0.05] px-2.5 py-2.5"
            style={{ width: TOPAZ_OPTIONS_WIDTH }}
          >
            <span className="text-[10px] font-semibold tracking-tight text-zinc-100">画质增强选项</span>

            <div className="flex w-full min-w-0 rounded-md border border-white/10 bg-black/20 p-0.5 text-[10px] font-medium">
              <button
                type="button"
                disabled={imageTabLocked}
                className={cn(
                  'flex-1 rounded py-1.5 transition-colors',
                  panelMode === 'image' ? 'bg-white/14 text-white' : 'text-zinc-400 hover:text-zinc-200',
                  imageTabLocked && 'cursor-not-allowed opacity-40'
                )}
                onClick={() => {
                  if (imageTabLocked) return;
                  updateNodeData(id, { topazPanelMode: 'image' });
                }}
              >
                图片
              </button>
              <button
                type="button"
                disabled={videoTabLocked}
                className={cn(
                  'flex-1 rounded py-1.5 transition-colors',
                  panelMode === 'video' ? 'bg-white/14 text-white' : 'text-zinc-400 hover:text-zinc-200',
                  videoTabLocked && 'cursor-not-allowed opacity-40'
                )}
                onClick={() => {
                  if (videoTabLocked) return;
                  updateNodeData(id, { topazPanelMode: 'video' });
                }}
              >
                视频
              </button>
            </div>

            {panelMode === 'image' ? (
              <div className={cn('flex flex-col gap-2', imageTabLocked && 'pointer-events-none opacity-40')}>
                <div className="space-y-1">
                  <div className="text-[10px] font-medium text-zinc-200">UpscaleFactor</div>
                  <Select
                    value={upscaleSelectValue}
                    onValueChange={(v) => {
                      const n = Number(v);
                      if (isUpscaleFactorChoice(upscaleFactorChoices, n)) {
                        updateNodeData(id, { viapiUpscaleFactor: n });
                      }
                    }}
                    className="h-8 w-full min-w-0 text-xs"
                  >
                    {upscaleFactorChoices.map((u) => (
                      <SelectItem key={u} value={String(u)}>
                        {u}×
                      </SelectItem>
                    ))}
                  </Select>
                  <p className="text-[9px] leading-relaxed text-zinc-500">
                    Topaz / Kie 云端图片超分。公网链接与本地素材都会先转存到 Kie 临时文件服务，再提交任务。
                  </p>
                </div>
                {topazCreditInfo}
                <div className="flex w-full min-w-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 flex-1 text-xs"
                    disabled={busy || !inboundImageUrl || imageTabLocked || !topazHasKey}
                    onClick={() => void runTopazImageEnhance()}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        处理中
                      </>
                    ) : !topazHasKey ? (
                      <>
                        <Key className="mr-1 h-3.5 w-3.5" />
                        请配置 API Key
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-1 h-3.5 w-3.5" />
                        生成
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 border-white/15 text-xs"
                    disabled={busy || !effectiveOutputImage}
                    onClick={() => void handleDownload()}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    下载
                  </Button>
                </div>
                {viewingImage ? (
                  <button
                    type="button"
                    className="text-left text-[10px] text-violet-300/90 underline-offset-2 hover:underline"
                    onClick={() => updateNodeData(id, { topazViewingImageUrl: '' })}
                  >
                    恢复最新生成图
                  </button>
                ) : null}
                {imageHistory.length > 0 ? (
                  <div className="flex w-full min-w-0 max-h-[52px] gap-1 overflow-x-auto pb-0.5">
                    {imageHistory.map((u) => (
                      <button
                        type="button"
                        key={u}
                        className={cn(
                          'h-12 w-12 shrink-0 overflow-hidden rounded border p-0 transition',
                          viewingImage === u
                            ? 'border-violet-400/70 ring-1 ring-violet-400/35'
                            : 'border-white/12 hover:border-white/25'
                        )}
                        title="查看此版本"
                        onClick={() => updateNodeData(id, { topazViewingImageUrl: u })}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt="" className="pointer-events-none h-full w-full object-cover" draggable={false} />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className={cn('flex flex-col gap-2', videoTabLocked && 'pointer-events-none opacity-40')}>
                <div className="space-y-1">
                  <div className="text-[10px] font-medium text-zinc-200">UpscaleFactor</div>
                  <Select
                    value={upscaleSelectValue}
                    onValueChange={(v) => {
                      const n = Number(v);
                      if (isUpscaleFactorChoice(upscaleFactorChoices, n)) {
                        updateNodeData(id, { viapiUpscaleFactor: n });
                      }
                    }}
                    className="h-8 w-full min-w-0 text-xs"
                  >
                    {upscaleFactorChoices.map((u) => (
                      <SelectItem key={u} value={String(u)}>
                        {u}x
                      </SelectItem>
                    ))}
                  </Select>
                  <p className="text-[9px] leading-relaxed text-zinc-500">
                    Topaz / Kie 云端视频超分。公网链接与本地素材都会先转存到 Kie 临时文件服务，再提交任务。
                  </p>
                </div>

                {topazCreditInfo}

                <div className="flex w-full min-w-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 flex-1 text-xs"
                    disabled={busy || !inboundVideoUrl || videoTabLocked || !topazHasKey}
                    onClick={() => void runTopazVideoEnhance()}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        处理中
                      </>
                    ) : !topazHasKey ? (
                      <>
                        <Key className="mr-1 h-3.5 w-3.5" />
                        请配置 API Key
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-1 h-3.5 w-3.5" />
                        生成
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 border-white/15 text-xs"
                    disabled={busy || !effectiveOutputVideo}
                    onClick={() => void handleDownloadVideo()}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    下载
                  </Button>
                </div>

                {viewingVideo ? (
                  <button
                    type="button"
                    className="text-left text-[10px] text-violet-300/90 underline-offset-2 hover:underline"
                    onClick={() => updateNodeData(id, { topazViewingVideoUrl: '' })}
                  >
                    恢复最新生成视频
                  </button>
                ) : null}

                {videoHistory.length > 0 ? (
                  <div className="flex w-full min-w-0 max-h-[52px] gap-1 overflow-x-auto pb-0.5">
                    {videoHistory.map((u) => (
                      <button
                        type="button"
                        key={u}
                        className={cn(
                          'relative h-12 w-16 shrink-0 overflow-hidden rounded border p-0 transition',
                          viewingVideo === u
                            ? 'border-violet-400/70 ring-1 ring-violet-400/35'
                            : 'border-white/12 hover:border-white/25'
                        )}
                        title="查看此版本"
                        onClick={() => updateNodeData(id, { topazViewingVideoUrl: u })}
                      >
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <video
                          src={u}
                          muted
                          playsInline
                          preload="metadata"
                          className="pointer-events-none h-full w-full object-cover"
                          onLoadedData={() => requestAnimationFrame(() => updateNodeInternals(id))}
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {typeof data.topazLastError === 'string' && data.topazLastError ? (
              <p className="rounded border border-red-500/25 bg-red-950/30 px-2 py-1 text-[10px] text-red-200/90">
                {data.topazLastError}
              </p>
            ) : null}

            {showProgress ? (
              <div className="space-y-1">
                <Progress value={progressVal} className="h-1.5" />
                <p className="text-[10px] text-zinc-500">{localMessage || data.topazStatus || '…'}</p>
                <GenerationEta
                  active={busy}
                  progress={progressVal}
                  estimateKey={topazEtaKey}
                  sessionKey={`enhance:${id}`}
                  defaultTotalSeconds={topazEtaBaselineSeconds}
                  className="block text-right"
                />
              </div>
            ) : null}
          </div>

          <PreviewPane label="增强后" className="shrink-0" style={mediaPaneStyle}>
            <div
              className={cn(
                PREVIEW_FRAME_CLASS,
                panelMode === 'video'
                  ? displayedOutputVideo
                    ? 'cursor-grab active:cursor-grabbing'
                    : ''
                  : displayedOutputImage
                    ? 'cursor-grab active:cursor-grabbing'
                    : ''
              )}
              draggable={panelMode === 'video' ? Boolean(displayedOutputVideo) : Boolean(displayedOutputImage)}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onDragStart={(e) => {
                if (panelMode === 'video') {
                  if (displayedOutputVideo) {
                    handleGeneratedVideoDragStart(e, displayedOutputVideo);
                  } else {
                    e.preventDefault();
                  }
                } else if (displayedOutputImage) {
                  handleGeneratedImageDragStart(e, displayedOutputImage);
                } else {
                  e.preventDefault();
                }
              }}
              style={mediaFrameStyle}
            >
              {panelMode === 'video' ? (
                displayedOutputVideo ? (
                  <NodeEmbeddedVideo
                    src={displayedOutputVideo}
                    poster={inboundPosterUrl || displayedOutputImage || undefined}
                    onLoadedMetadata={() => requestAnimationFrame(() => updateNodeInternals(id))}
                  />
                ) : (
                  <div className="flex h-full min-h-[96px] items-center justify-center px-2 text-center text-[10px] text-zinc-500">
                    {busy ? '处理中，完成后显示增强视频' : '生成后将在此显示增强视频'}
                  </div>
                )
              ) : displayedOutputImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={displayedOutputImage}
                  alt=""
                  className="h-full w-full object-contain"
                  draggable={false}
                  onLoad={() => requestAnimationFrame(() => updateNodeInternals(id))}
                />
              ) : (
                <div className="flex h-full min-h-[96px] items-center justify-center px-2 text-center text-[10px] text-zinc-500">
                  {panelMode === 'image' && inboundKind === 'video'
                    ? '请在「视频」页签生成超分结果'
                    : '生成后将在此显示增强结果'}
                </div>
              )}
            </div>
          </PreviewPane>

        </div>
      </div>

      <Handle type="source" position={Position.Right} id="out" className="mc-node-handle" />
    </div>
  );
}

export default memo(TopazEnhanceNode);
