'use client';

import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { CanvasNodeData, useCanvasStore } from '../canvas/CanvasStore';
import { useSeedanceStore } from '../seedance/SeedanceStore';
import { VideoAPI, isInputImagePrivacyError, getHappyHorseModelSpec, type VideoDuration, type VideoRatio, type VideoResolution } from '../api/VideoAPI';
import { DreaminaCLIAPI, extractVideoUrl, extractCoverUrl, isSubmitSuccess, logDreaminaClientTrace, type DreaminaCLIGenerateResult } from '../api/DreaminaCLIAPI';
import { createKlingVideoAPI, getKlingModelSpec } from '../api/KlingVideoAPI';
import { createCustomVideoAPI } from '../api/CustomVideoAPI';
import {
  createKieMarketVideoAPI,
  createKieVeoVideoAPI,
  getKieGeminiOmniModelSpec,
  getKieVeoModelSpec,
  normalizeKieGeminiOmniDuration,
  normalizeKieVeoDuration,
} from '../api/KieMarketAPI';
import { createMiniMaxH3VideoAPI, isMiniMaxH3Ref2VAModel } from '../api/MiniMaxH3VideoAPI';
import { ScreenSpaceNodePanel } from '../canvas/ScreenSpaceNodePanel';
import { MaterialPreviewStrip } from '../canvas/MaterialPreviewStrip';
import { MentionTextarea, type MentionTextareaSize } from '../canvas/MentionTextarea';
import { ExpandableTextField } from '../canvas/ExpandableTextField';
import { CompactNodeFrame } from '../canvas/CompactNodeFrame';
import { KieUsageInfo } from '../canvas/KieUsageInfo';
import { CanvasVideoPlayer } from '../canvas/CanvasVideoPlayer';
import {
  convertVideoBusinessTokensToPackageTokens,
  estimateSeedanceVideoTokenUsage,
} from '@/lib/ark-token-estimate';
import {
  buildKieUsageDisplay,
  fetchKieCredits,
  getKieProviderTokenBucket,
  isKieProvider,
  KIE_GLOBAL_PROVIDER_TOKEN_KEY,
} from '@/lib/kie-usage-display';
import { materializeKieMaterialRefsForCloud } from '@/lib/kie-reference-upload-client';
import {
  getMaterialReferenceKind,
  getMaterialReferenceUrl,
  getCharacterMaterialPrompt,
  stripMaterialMentionTokens,
  type MaterialRef,
} from '@/lib/material-mentions';
import { composePrompt, mergeConnectedPromptText } from '@/lib/prompt-flow';
import { useAgentGenerationBridge } from '@/lib/useAgentGenerationBridge';
import { useIncomingMaterialRefs, useIncomingPromptSources } from '../canvas/useCanvasDerivedData';
import { cn } from '@/lib/utils';
import { saveMediaToDisk, showDownloadError } from '@/lib/download-media';
import {
  batchMediaExportMessage,
  collectNodeMediaExportGroup,
  exportNodeMediaGroups,
  showBatchMediaExportError,
} from '@/lib/batch-media-export';
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
import { getMergedVideoModelOptions, getVideoModelDisplayName, resolveProviderForModel } from '@/lib/model-options';
import {
  generatedVideoCacheKey,
  persistImageToMaterialCache,
  persistVideoToMaterialCache,
} from '@/lib/persist-generated-media';
import {
  isProjectCacheMaterialUrl,
  isMaterialDiskRef,
  materialDiskRefToNodeId,
  materialDiskPlayableUrl,
  resolveMaterialPlayableUrl,
} from '@/lib/material-disk-playable-url';
import { Button } from '@/components/ui/button';
import { Select, SelectItem } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Video, Loader2, Play, Download, ArrowRight, Scissors, SkipBack, SkipForward, GripVertical, FolderDown, Eraser } from 'lucide-react';
import {
  GENERATED_VIDEO_DND_TYPE,
  makeGeneratedVideoFileName,
  type GeneratedVideoDragPayload,
} from '@/lib/generated-image-dnd';
import {
  DREAMINA_CLI_VIDEO_MODELS,
  DREAMINA_CLI_VIDEO_MODE_OPTIONS,
  DREAMINA_CLI_VIDEO_RATIO_OPTIONS,
  getDreaminaCliVideoDurationOptions,
  getDreaminaCliVideoModel,
  getDreaminaCliVideoCreditCost,
  normalizeDreaminaCliVideoResolution,
  normalizeDreaminaCliVideoMode,
  formatDreaminaFailReason,
  type DreaminaCliVideoMode,
} from '@/lib/dreamina-cli-options';
import { extractDreaminaCreditCount } from '@/lib/dreamina-cli-credits';
import { useDreaminaCliCreditSync } from '@/lib/use-dreamina-cli-credits';
import { DreaminaCliCreditBar } from '../seedance/DreaminaCliCreditBar';
import { captureVideoFrameDataUrl, fileNameToMentionSlug } from '@/lib/material-import-from-file';
import { persistInlineMaterialDataToProjectSidecar } from '@/lib/persist-inline-material-sidecar';
import { FACE_COMPLIANCE_VIDEO_PROMPT } from '@/lib/face-compliance';
import { claimSeedanceTaskLease, releaseSeedanceTaskLease } from '@/lib/seedance-task-lease';
import { MaterialMediaEditor } from './MaterialMediaEditor';
import { repairVideoHistoryPoster } from '@/lib/video-history-poster';

interface GeneratedVideoItem {
  id: string;
  taskId?: string;
  videoUrl: string;
  createdAt: number;
  cacheKey?: string;
  fileName?: string;
  posterUrl?: string;
  prompt?: string;
  model?: string;
  ratio?: string;
  resolution?: string;
  duration?: number;
  providerId?: string;
  generationBackend?: VideoNodeData['generationBackend'];
  mode?: VideoNodeData['mode'];
  personReferenceMode?: VideoNodeData['personReferenceMode'];
  dreaminaCliModel?: string;
  dreaminaCliVideoMode?: DreaminaCliVideoMode;
}

interface VideoNodeData extends CanvasNodeData {
  prompt?: string;
  customPrompt?: string;
  promptEdited?: boolean;
  imageRef?: string;
  videoUrl?: string;
  promptBoxSize?: MentionTextareaSize;
  ratio?: '9:16' | '16:9' | '4:3' | '3:4' | '1:1' | '4:5' | '5:4' | '9:21' | '21:9';
  resolution?: '480P' | '720P' | '1080P' | '4K';
  duration?: number;
  mode?: 'std' | 'pro' | '4k';
  model?: string;
  providerId?: string;
  personReferenceMode?: 'text-fallback' | 'strict';
  virtualHumanCardId?: string;
  status?: string;
  generatedVideos?: GeneratedVideoItem[];
  activeGeneratedVideoId?: string;
  generationTaskTotal?: number;
  generationTaskSucceeded?: number;
  lastGenerationCredits?: number;
  generationBackend?: 'api' | 'dreamina-cli';
  /** 即梦CLI 模型：VIP 快速 / 标准 */
  dreaminaCliModel?: string;
  dreaminaCliVideoMode?: DreaminaCliVideoMode;
  pendingMiniMaxH3Task?: PendingMiniMaxH3Task;
  pendingSeedanceTask?: PendingSeedanceTask;
}

interface PendingMiniMaxH3Task {
  taskId: string;
  prompt: string;
  inputPrompt?: string;
  model: string;
  ratio: VideoNodeData['ratio'];
  resolution: VideoNodeData['resolution'];
  duration: VideoNodeData['duration'];
  posterUrl?: string;
  submittedAt: number;
}

interface PendingSeedanceTask {
  taskId: string;
  providerId: string;
  providerMode: 'official' | 'custom';
  prompt: string;
  inputPrompt?: string;
  model: string;
  ratio: VideoNodeData['ratio'];
  resolution: VideoNodeData['resolution'];
  duration: VideoNodeData['duration'];
  submittedAt: number;
  hasVideoInput?: boolean;
}

interface GeneratedVideoCommitParams {
  taskId?: string;
  providerId?: string;
  videoUrl: string;
  posterUrl?: string;
  prompt: string;
  inputPrompt?: string;
  baseRequest: {
    ratio: VideoNodeData['ratio'];
    resolution: VideoNodeData['resolution'];
    duration: VideoNodeData['duration'];
    model: string;
  };
  lastGenerationCredits?: number;
}

interface GenerationProgress {
  status: 'idle' | 'submitting' | 'processing' | 'success' | 'error';
  progress: number; // 0-100
  message: string;
}

type VideoFrameCaptureMode = 'free' | 'first' | 'last';

const VIDEO_GENERATION_SUCCESS_NOTICE_MS = 30_000;
const IS_WEB_TRIAL_BUILD = process.env.NEXT_PUBLIC_MAGINE_WEB_TRIAL === '1';

const VIDEO_FRAME_CAPTURE_LABELS: Record<VideoFrameCaptureMode, string> = {
  free: '自由截帧',
  first: '一键首帧',
  last: '一键尾帧',
};

const STANDARD_VIDEO_RATIOS: VideoRatio[] = ['16:9', '9:16', '4:3', '3:4', '1:1'];

function toApiVideoRatio(ratio?: VideoNodeData['ratio'], allowExtended = false): VideoRatio {
  const value = ratio || '16:9';
  if (!allowExtended && !STANDARD_VIDEO_RATIOS.includes(value)) return '16:9';
  return value;
}

function ratioToCssAspect(value?: string): string {
  const match = String(value || '16:9').trim().match(/^(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) return '16 / 9';
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '16 / 9';
  }
  return `${width} / ${height}`;
}

function isGeneratedVideoItem(value: unknown): value is GeneratedVideoItem {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<GeneratedVideoItem>;
  return typeof record.videoUrl === 'string' && record.videoUrl.length > 0;
}

function projectCacheMaterialNodeId(url: unknown): string | null {
  if (typeof url !== 'string' || !url.includes('/api/project-cache/material')) return null;
  try {
    const parsed = new URL(url, 'http://magine.local');
    if (parsed.pathname !== '/api/project-cache/material') return null;
    return parsed.searchParams.get('nodeId')?.trim() || null;
  } catch {
    return null;
  }
}

function inferGeneratedVideoCacheKey(nodeId: string, item: Partial<GeneratedVideoItem>, index: number): string | undefined {
  if (!nodeId) return undefined;

  const videoCacheId = projectCacheMaterialNodeId(item.videoUrl);
  if (videoCacheId) return videoCacheId;
  if (typeof item.videoUrl === 'string' && isMaterialDiskRef(item.videoUrl)) {
    return materialDiskRefToNodeId(item.videoUrl);
  }

  if (typeof item.cacheKey === 'string' && item.cacheKey.trim()) return item.cacheKey.trim();

  const posterCacheId = projectCacheMaterialNodeId(item.posterUrl);
  if (posterCacheId?.endsWith('-poster')) return posterCacheId.slice(0, -'-poster'.length);
  if (typeof item.posterUrl === 'string' && isMaterialDiskRef(item.posterUrl)) {
    const posterDiskId = materialDiskRefToNodeId(item.posterUrl);
    if (posterDiskId.endsWith('-poster')) return posterDiskId.slice(0, -'-poster'.length);
  }

  const idMatch = typeof item.id === 'string' ? /^generated-video-(\d+)$/.exec(item.id) : null;
  if (idMatch) return generatedVideoCacheKey(nodeId, Number(idMatch[1]));
  return generatedVideoCacheKey(nodeId, index);
}

function isSameGeneratedVideoUrl(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return normalizeVideoCompareUrl(a) === normalizeVideoCompareUrl(b);
}

function h3TaskIdFromMediaUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'magine-media:' || parsed.hostname !== 'h3') return '';
    const fileName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    const match = /^comfy-h3-([0-9a-f-]{36})\.[a-z0-9]+$/i.exec(fileName);
    return match ? `comfy:${match[1]}` : '';
  } catch {
    return '';
  }
}

function withVideoCacheVersion(url: string, version?: string): string {
  const v = version?.trim();
  if (!url || !v || url.startsWith('data:') || url.startsWith('disk://magine/material/v1/')) return url;
  try {
    const parsed = new URL(url, 'http://magine.local');
    parsed.searchParams.set('v', v);
    return url.startsWith('http://') || url.startsWith('https://')
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

function normalizeVideoCompareUrl(url: string): string {
  const resolved = resolveMaterialPlayableUrl(url, 'video');
  try {
    const parsed = new URL(resolved, 'http://magine.local');
    if (parsed.pathname === '/api/project-cache/material') {
      const nodeId = parsed.searchParams.get('nodeId') || '';
      const kind = parsed.searchParams.get('kind') || '';
      return `${parsed.pathname}|nodeId=${nodeId}|kind=${kind}`;
    }
  } catch {
    /* keep raw fallback */
  }
  return resolved;
}

function getGeneratedVideos(data: VideoNodeData, nodeId = ''): GeneratedVideoItem[] {
  const items: GeneratedVideoItem[] = [];
  const seenIds = new Set<string>();
  const rawItems = Array.isArray(data.generatedVideos) ? data.generatedVideos : [];

  rawItems.forEach((item, index) => {
    if (!isGeneratedVideoItem(item)) return;
    const baseId = item.id || `generated-video-${index}`;
    const id = seenIds.has(baseId) ? `${baseId}-${index}` : baseId;
    seenIds.add(id);
    items.push({
      ...item,
      id,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
      cacheKey: inferGeneratedVideoCacheKey(nodeId, item, index),
    });
  });

  if (data.videoUrl && !items.some((item) => isSameGeneratedVideoUrl(item.videoUrl, data.videoUrl))) {
    items.push({
      id: 'legacy-current-video',
      videoUrl: data.videoUrl,
      createdAt: 0,
      fileName: makeGeneratedVideoFileName(0),
      cacheKey: inferGeneratedVideoCacheKey(nodeId, { videoUrl: data.videoUrl }, rawItems.length),
    });
  }

  return items.sort((a, b) => b.createdAt - a.createdAt);
}

function buildGeneratedVideoItem(params: {
  taskId?: string;
  videoUrl: string;
  posterUrl?: string;
  prompt: string;
  model: string;
  ratio: string;
  resolution: string;
  duration: number;
  providerId?: string;
  generationBackend?: VideoNodeData['generationBackend'];
  mode?: VideoNodeData['mode'];
  personReferenceMode?: VideoNodeData['personReferenceMode'];
  dreaminaCliModel?: string;
  dreaminaCliVideoMode?: DreaminaCliVideoMode;
}): GeneratedVideoItem {
  const createdAt = Date.now();
  return {
    id: `generated-video-${createdAt}`,
    taskId: params.taskId,
    videoUrl: params.videoUrl,
    createdAt,
    fileName: makeGeneratedVideoFileName(createdAt),
    posterUrl: params.posterUrl,
    prompt: params.prompt,
    model: params.model,
    ratio: params.ratio,
    resolution: params.resolution,
    duration: params.duration,
    providerId: params.providerId,
    generationBackend: params.generationBackend,
    mode: params.mode,
    personReferenceMode: params.personReferenceMode,
    dreaminaCliModel: params.dreaminaCliModel,
    dreaminaCliVideoMode: params.dreaminaCliVideoMode,
  };
}

const RATIO_OPTIONS = [
  { value: '16:9', label: '16:9', desc: '横屏' },
  { value: '9:16', label: '9:16', desc: '竖屏' },
  { value: '4:3', label: '4:3', desc: '标准' },
  { value: '3:4', label: '3:4', desc: '人像' },
  { value: '1:1', label: '1:1', desc: '方形' },
  { value: '21:9', label: '21:9', desc: '超宽屏' },
];

const HAPPYHORSE_RATIO_OPTIONS = [
  ...RATIO_OPTIONS,
  { value: '4:5', label: '4:5', desc: '竖幅' },
  { value: '5:4', label: '5:4', desc: '横幅' },
  { value: '9:21', label: '9:21', desc: '超长竖屏' },
];

const RESOLUTION_OPTIONS = [
  { value: '480P', label: '480P', desc: '标清' },
  { value: '720P', label: '720P', desc: '高清' },
  { value: '1080P', label: '1080P', desc: '全高清' },
  { value: '4K', label: '4K', desc: '超高清' },
];

const DURATION_OPTIONS = [
  { value: 3, label: '3秒' },
  { value: 4, label: '4秒' },
  { value: 5, label: '5秒' },
  { value: 6, label: '6秒' },
  { value: 7, label: '7秒' },
  { value: 8, label: '8秒' },
  { value: 9, label: '9秒' },
  { value: 10, label: '10秒' },
  { value: 11, label: '11秒' },
  { value: 12, label: '12秒' },
  { value: 13, label: '13秒' },
  { value: 14, label: '14秒' },
  { value: 15, label: '15秒' },
];

const GENERATION_BACKEND_OPTIONS = [
  { value: 'api', label: 'API' },
  { value: 'dreamina-cli', label: '即梦CLI' },
];

const VIDEO_ASPECT_CLASS: Record<NonNullable<VideoNodeData['ratio']>, string> = {
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
  '4:3': 'aspect-[4/3]',
  '3:4': 'aspect-[3/4]',
  '1:1': 'aspect-square',
  '4:5': 'aspect-[4/5]',
  '5:4': 'aspect-[5/4]',
  '9:21': 'aspect-[9/21]',
  '21:9': 'aspect-[21/9]',
};

const DEFAULT_VIDEO_PROMPT_BOX_SIZE: MentionTextareaSize = { width: 254, height: 96 };

function isLikelyVideoUrl(url: string): boolean {
  return /^data:video\//i.test(url) || /\.(mp4|mov)(?:[?#].*)?$/i.test(url);
}

function isLikelyAudioUrl(url: string): boolean {
  return /^data:audio\//i.test(url) || /\.(mp3|wav)(?:[?#].*)?$/i.test(url);
}

function isArkAssetUrl(url: string): boolean {
  return /^asset:\/\//i.test(url.trim());
}

function hasNonAssetVisualReference(referenceImages: string[], referenceVideos: string[]): boolean {
  return [...referenceImages, ...referenceVideos].some((url) => !isArkAssetUrl(url));
}

function buildPrivacyFallbackPrompt(cleanPrompt: string, references: MaterialRef[]): string {
  const materialNames = references
    .map((m) => m.fileName || `@${m.slug}`)
    .filter(Boolean)
    .slice(0, 8)
    .join('、');
  return [
    cleanPrompt || '生成一段虚构角色视频',
    materialNames ? `参考角色素材名称：${materialNames}` : '',
    '角色为虚构设定，请按文字描述创作，不复刻真实人物身份。',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildPrivacyFallbackReferences(
  referenceImages: string[],
  referenceVideos: string[],
  referenceAudios: string[]
) {
  const assetImages = referenceImages.filter(isArkAssetUrl);
  const assetVideos = referenceVideos.filter(isArkAssetUrl);
  const hasVisualAsset = assetImages.length > 0 || assetVideos.length > 0;

  return {
    referenceImages: assetImages,
    referenceVideos: assetVideos,
    referenceAudios: hasVisualAsset ? referenceAudios.filter(isArkAssetUrl) : [],
  };
}

function buildVideoReferences(materialRefs: MaterialRef[], fallbackUrl?: string) {
  const referenceImages: string[] = [];
  const referenceVideos: string[] = [];
  const referenceAudios: string[] = [];
  const unsupported: MaterialRef[] = [];
  const seen = new Set<string>();

  const addUrl = (kind: 'image' | 'video' | 'audio', url: string) => {
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    if (kind === 'image') referenceImages.push(trimmed);
    if (kind === 'video') referenceVideos.push(trimmed);
    if (kind === 'audio') referenceAudios.push(trimmed);
  };

  for (const material of materialRefs) {
    const kind = getMaterialReferenceKind(material);
    const referenceUrl = getMaterialReferenceUrl(material);
    if (kind === 'unsupported') {
      unsupported.push(material);
    } else {
      addUrl(kind, referenceUrl);
    }
    if (material.characterMaterial && material.characterVoiceReferenceUrl) {
      addUrl('audio', material.characterVoiceReferenceUrl);
    }
  }

  if (fallbackUrl && !seen.has(fallbackUrl)) {
    if (isLikelyVideoUrl(fallbackUrl)) {
      addUrl('video', fallbackUrl);
    } else if (isLikelyAudioUrl(fallbackUrl)) {
      addUrl('audio', fallbackUrl);
    } else {
      addUrl('image', fallbackUrl);
    }
  }

  return {
    referenceImages,
    referenceVideos,
    referenceAudios,
    unsupported,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('cached media read returned empty result'));
    };
    reader.onerror = () => reject(reader.error || new Error('cached media read failed'));
    reader.readAsDataURL(blob);
  });
}

async function fetchDreaminaCliReferenceAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`本地缓存素材读取失败 (${response.status})`);
  }
  return blobToDataUrl(await response.blob());
}

async function toDreaminaCliReferenceInput(
  url: string,
  kind: 'image' | 'video' | 'audio',
): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;

  if (isMaterialDiskRef(trimmed)) {
    const cacheKind = kind === 'video' ? 'video' : 'image';
    return fetchDreaminaCliReferenceAsDataUrl(
      materialDiskPlayableUrl(materialDiskRefToNodeId(trimmed), cacheKind),
    );
  }

  if (isProjectCacheMaterialUrl(trimmed) || /^blob:/i.test(trimmed)) {
    return fetchDreaminaCliReferenceAsDataUrl(trimmed);
  }

  return trimmed;
}

async function toDreaminaCliReferenceInputs(
  urls: string[],
  kind: 'image' | 'video' | 'audio',
): Promise<string[]> {
  return Promise.all(urls.map((url) => toDreaminaCliReferenceInput(url, kind)));
}

function formatDreaminaCliVideoError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  if (/upload resource[\s\S]*(\/api\/project-cache\/material|project-cache\/material)|read file[\s\S]*(\/api\/project-cache\/material|project-cache\/material)/i.test(message)) {
    return '本地缓存素材未能转成即梦 CLI 可读取文件。请刷新画布或重新连接素材后再试。';
  }
  return formatDreaminaFailReason(message);
}

interface ProviderTaskStatus {
  status: string;
  video_url?: string;
  cover_url?: string;
  message?: string;
  usage?: {
    completion_tokens?: number;
    total_tokens?: number;
  };
  progress?: number;
}

function isTransientProviderPollError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /HTTP 502|fetch failed|proxy|network|timeout|timed out|ECONN|ETIMEDOUT|UND_ERR/i.test(message);
}

/** 通用的异步视频任务轮询。 */
async function pollProviderTask(
  taskId: string,
  queryFn: (taskId: string) => Promise<ProviderTaskStatus>,
  onProgress: (status: string, progress?: number) => void,
  maxAttempts = 120,
  intervalMs = 5000,
  shouldContinue: () => boolean = () => true,
  maxTransientFailures = 5,
): Promise<ProviderTaskStatus> {
  let transientFailures = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (!shouldContinue()) return { status: 'paused', message: '本地轮询已暂停' };
    let result: ProviderTaskStatus;
    try {
      result = await queryFn(taskId);
      transientFailures = 0;
    } catch (error) {
      if (isTransientProviderPollError(error) && transientFailures < maxTransientFailures) {
        transientFailures += 1;
        onProgress('processing');
        continue;
      }
      throw error;
    }
    onProgress(result.status, result.progress);
    if (
      result.status === 'succeed'
      || result.status === 'succeeded'
      || result.status === 'failed'
      || result.status === 'cancelled'
      || result.status === 'expired'
    ) {
      return { ...result, status: result.status === 'succeeded' ? 'succeed' : result.status };
    }
  }
  return { status: 'failed', message: '轮询超时' };
}

function isPublicOrAssetReference(url: string): boolean {
  if (/^asset:\/\//i.test(url)) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false;
    const private172 = /^172\.(\d+)\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    return true;
  } catch {
    return false;
  }
}

async function materializeSeedanceReference(url: string, kind: 'image' | 'video' | 'audio'): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (isPublicOrAssetReference(trimmed)) return trimmed;
  if (kind === 'image' && /^data:image\//i.test(trimmed)) return trimmed;
  if (kind === 'audio' && /^data:audio\//i.test(trimmed)) return trimmed;
  if (kind === 'video') {
    throw new Error('Seedance 2.0 参考视频必须使用公网 URL 或 asset:// 素材 ID；本地视频不能作为相对地址提交给远端模型。');
  }

  const playableUrl = resolveMaterialPlayableUrl(trimmed, kind);
  try {
    const response = await fetch(playableUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const expectedPrefix = kind === 'image' ? 'image/' : 'audio/';
    if (blob.type && !blob.type.toLowerCase().startsWith(expectedPrefix)) {
      throw new Error(`返回类型为 ${blob.type}`);
    }
    return await blobToDataUrl(blob);
  } catch (error) {
    throw new Error(
      `Seedance 2.0 无法读取本地${kind === 'image' ? '图片' : '音频'}参考素材，请重新上传或配置 asset:// 素材 ID：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function estimateMiniMaxH3Progress(submittedAt: number, duration: number): number {
  const elapsedMs = Math.max(0, Date.now() - submittedAt);
  const expectedMs = Math.max(6 * 60_000, Math.max(5, duration) * 90_000);
  return Math.min(92, Math.max(20, 20 + Math.round((elapsedMs / expectedMs) * 72)));
}

function estimateSeedanceTaskProgress(
  task: PendingSeedanceTask,
  status: string,
  apiProgress?: number,
): number {
  if (Number.isFinite(apiProgress)) {
    return Math.min(95, Math.max(20, Math.round(apiProgress!)));
  }
  const elapsedMs = Math.max(0, Date.now() - task.submittedAt);
  const expectedMs = Math.max(4 * 60_000, Math.max(5, task.duration || 5) * 24_000);
  if (status === 'queued' || status === 'submitted') {
    return Math.min(38, 20 + Math.round((elapsedMs / expectedMs) * 18));
  }
  return Math.min(94, 38 + Math.round((elapsedMs / expectedMs) * 56));
}

function VideoNode({ id, data }: NodeProps<CanvasNodeData>) {
  const nodeData = data as VideoNodeData;
  const effectiveNodeData = nodeData;
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const dreaminaCliSubmitRef = useRef(false);
  const miniMaxH3SubmitRef = useRef(false);
  const componentMountedRef = useRef(true);
  const recoveredSeedanceTaskIdsRef = useRef(new Set<string>());
  const commitGeneratedVideoRef = useRef<(params: GeneratedVideoCommitParams) => Promise<void>>(async () => {});
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNodeWithData = useCanvasStore((state) => state.addNodeWithData);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const reactFlow = useReactFlow<CanvasNodeData>();
  const [frameCaptureBusy, setFrameCaptureBusy] = useState<VideoFrameCaptureMode | null>(null);
  const [frameCaptureMessage, setFrameCaptureMessage] = useState('');
  const [mediaEditorOpen, setMediaEditorOpen] = useState(false);
  const [isBatchExporting, setIsBatchExporting] = useState(false);
  const [subtitleRemovalProgress, setSubtitleRemovalProgress] = useState<number | null>(null);
  const [subtitleRemovalDialogOpen, setSubtitleRemovalDialogOpen] = useState(false);
  const [brokenHistoryPosters, setBrokenHistoryPosters] = useState<Record<string, string>>({});
  const [largeVideoPreview, setLargeVideoPreview] = useState<{
    url: string;
    posterUrl?: string;
    currentTime: number;
    shouldPlay: boolean;
  } | null>(null);

  useEffect(() => {
    componentMountedRef.current = true;
    return () => {
      componentMountedRef.current = false;
    };
  }, []);

  const isLoading = nodeData.isLoading === true;
  const generationProgress: GenerationProgress =
    typeof nodeData.generationProgress === 'object' && nodeData.generationProgress
      ? nodeData.generationProgress as GenerationProgress
      : { status: 'idle' as const, progress: 0, message: '等待生成...' };
  const previousGenerationStatusRef = useRef(generationProgress.status);
  const [showGenerationSuccessNotice, setShowGenerationSuccessNotice] = useState(false);

  useEffect(() => {
    const previousStatus = previousGenerationStatusRef.current;
    previousGenerationStatusRef.current = generationProgress.status;

    if (generationProgress.status !== 'success') {
      if (previousStatus === 'success') setShowGenerationSuccessNotice(false);
      return;
    }
    if (previousStatus === 'success') return;

    setShowGenerationSuccessNotice(true);
    const timeoutId = window.setTimeout(() => {
      setShowGenerationSuccessNotice(false);
    }, VIDEO_GENERATION_SUCCESS_NOTICE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [generationProgress.status]);

  const setIsLoading = (v: boolean) => updateNodeData(id, { isLoading: v } as Partial<VideoNodeData>);
  const setGenerationProgress = (v: GenerationProgress) => {
    const currentNode = useCanvasStore.getState().nodes.find((node) => node.id === id);
    const currentData = currentNode?.data as VideoNodeData | undefined;
    const currentProgress = currentData?.generationProgress as GenerationProgress | undefined;
    if (currentProgress?.status === 'success' && v.status === 'processing' && currentData?.isLoading !== true) {
      return;
    }
    const nextProgress = Number.isFinite(v.progress) ? Math.max(0, Math.min(100, v.progress)) : 0;
    const progress =
      (v.status === 'submitting' || v.status === 'processing') &&
      (currentProgress?.status === 'submitting' || currentProgress?.status === 'processing') &&
      nextProgress < currentProgress.progress
        ? currentProgress.progress
        : nextProgress;
    updateNodeData(id, { generationProgress: { ...v, progress } } as Partial<VideoNodeData>);
  };
  const registerGenerationTask = () => {
    const latestNode = useCanvasStore.getState().nodes.find((node) => node.id === id);
    const latestData = (latestNode?.data || effectiveNodeData) as VideoNodeData;
    const completed = Math.max(
      Math.max(0, Math.floor(Number(latestData.generationTaskSucceeded) || 0)),
      getGeneratedVideos(latestData, id).length,
    );
    const total = Math.max(
      Math.max(0, Math.floor(Number(latestData.generationTaskTotal) || 0)),
      completed,
    );
    updateNodeData(id, {
      generationTaskTotal: total + 1,
      generationTaskSucceeded: completed,
    } as Partial<VideoNodeData>);
  };
  useEffect(() => {
    const displayMessage = formatDreaminaFailReason(generationProgress.message || '');
    if (displayMessage === generationProgress.message) return;
    updateNodeData(id, {
      generationProgress: { ...generationProgress, message: displayMessage },
    } as Partial<VideoNodeData>);
  }, [generationProgress.message, generationProgress.progress, generationProgress.status, id, updateNodeData]);
  const isExpanded = useCanvasStore((state) => state.selectedNode?.id === id);
  const showSettingsPanel = isExpanded;
  const isGlowing = useCanvasStore((state) => state.glowingNodeIds.includes(id));
  const addGlowingNode = useCanvasStore((state) => state.addGlowingNode);
  const clearGlowingNode = useCanvasStore((state) => state.clearGlowingNode);

  useEffect(() => {
    if (showSettingsPanel && isGlowing) {
      clearGlowingNode(id);
    }
  }, [showSettingsPanel, isGlowing, id, clearGlowingNode]);

  useEffect(() => {
    if (!largeVideoPreview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setLargeVideoPreview(null);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [largeVideoPreview]);

  const previewMaterials = useIncomingMaterialRefs(id);
  const {
    videoCategoryConfig,
    videoTokenConfig,
    dreaminaCliConfig,
    addUsedTokens,
    addProviderTokens,
    setProviderRemainingTokens,
    dreaminaCliSessionUsedCredits,
    applyDreaminaCliCreditSpend,
  } = useSeedanceStore(useShallow((state) => ({
    videoCategoryConfig: state.config.video,
    videoTokenConfig: state.tokenConfig.video,
    dreaminaCliConfig: state.config.dreaminaCli,
    addUsedTokens: state.addUsedTokens,
    addProviderTokens: state.addProviderTokens,
    setProviderRemainingTokens: state.setProviderRemainingTokens,
    dreaminaCliSessionUsedCredits: state.dreaminaCliSessionUsedCredits,
    applyDreaminaCliCreditSpend: state.applyDreaminaCliCreditSpend,
  })));
  // Two-level provider → model selector
  const providerOptions = useMemo(() => {
    const all = { ...videoCategoryConfig.providers, ...videoCategoryConfig.customProviders };
    
    // 厂商友好名称映射（支持多种格式）
    const friendlyProviderNames: Record<string, string> = {
      'seedance-2.0': 'Seedance 2.0',
      'seedance-2-0': 'Seedance 2.0',
    };
    
    return Object.entries(all)
      .filter(([, p]) => p.enabled && (p.apiKey.trim() || p.authType === 'standard-bearer' && /127\.0\.0\.1|localhost/i.test(p.apiUrl)))
      .map(([id, p]) => {
        // 标准化provider ID格式（将连字符转换为点）
        const normalizedId = id.replace(/-/g, '.');
        const label = friendlyProviderNames[id] || friendlyProviderNames[normalizedId] || p.label || id;
        return { 
          value: id, 
          label, 
          models: p.models 
        };
      });
  }, [videoCategoryConfig]);

  // Also include models from legacy videoApi for backward compat
  const videoModelOptions = useMemo(() => getMergedVideoModelOptions(videoCategoryConfig), [videoCategoryConfig]);

  const currentProviderId = useMemo(() => {
    // 检查有效provider ID
    if (effectiveNodeData.providerId) {
      // 首先尝试精确匹配
      if (providerOptions.some((p) => p.value === effectiveNodeData.providerId)) {
        return effectiveNodeData.providerId;
      }
      // 尝试标准化匹配（连字符和点互换）
      const normalizedId = effectiveNodeData.providerId.replace(/-/g, '.');
      if (providerOptions.some((p) => p.value === normalizedId)) {
        return normalizedId;
      }
      // 尝试反向标准化
      const reversedId = effectiveNodeData.providerId.replace(/\./g, '-');
      if (providerOptions.some((p) => p.value === reversedId)) {
        return reversedId;
      }
    }
    // Fallback: resolve provider from current model
    if (effectiveNodeData.model) {
      const pid = resolveProviderForModel(videoCategoryConfig, effectiveNodeData.model, '', 'video');
      if (pid && providerOptions.some((p) => p.value === pid)) return pid;
    }
    return providerOptions[0]?.value || '';
  }, [effectiveNodeData.providerId, effectiveNodeData.model, providerOptions, videoCategoryConfig]);

  const currentVideoProvider = useMemo(() => {
    const all = { ...videoCategoryConfig.providers, ...videoCategoryConfig.customProviders };
    return all[currentProviderId] || null;
  }, [videoCategoryConfig, currentProviderId]);

  const modelOptions = useMemo(() => {
    const provider = providerOptions.find((p) => p.value === currentProviderId);
    if (!provider) return videoModelOptions; // fallback to flat list
    
    // 内置友好名称映射（技术名 → UI 标签）
    const friendlyNameMap: Record<string, string> = {
      'doubao-seedance-2.0': 'Seedance 2.0',
      'doubao-seedance-2.0-fast': 'Seedance 2.0 Fast',
      'doubao-seedance-2-0-260128': 'Seedance 2.0',
      'doubao-seedance-2-0-fast-260128': 'Seedance 2.0 Fast',
      'gemini-omni-video': 'Gemini Omni Video',
      'minimax_h3_fl2va_pruned_fp8_scaled.safetensors': 'MiniMax H3 FL2VA（文生/首尾帧）',
      'minimax_h3_ref2va_pruned_fp8_scaled.safetensors': 'MiniMax H3 Ref2VA（全模态参考）',
    };
    
    return provider.models.map((model) => {
      // 首先从videoModelOptions查找友好名称
      const friendlyOption = videoModelOptions.find((o) => o.value === model);
      // 如果找不到，使用内置映射
      const friendlyName = getVideoModelDisplayName(
        model,
        friendlyNameMap[model] || friendlyOption?.label || model,
      );
      return {
        value: model,
        label: friendlyName,
        providerId: currentProviderId,
      };
    });
  }, [providerOptions, currentProviderId, videoModelOptions]);

  const currentModel = useMemo(() => {
    if (effectiveNodeData.model && modelOptions.some((m) => m.value === effectiveNodeData.model)) {
      return effectiveNodeData.model;
    }
    return modelOptions[0]?.value || 'seedance-2.0';
  }, [effectiveNodeData.model, modelOptions]);

  const isKieApiVideoProvider = /api\.kie\.ai/i.test(currentVideoProvider?.apiUrl || '');
  const isKieVeoProvider =
    currentProviderId === 'kie-veo' ||
    (currentProviderId === 'veo-omni' && isKieApiVideoProvider && currentModel !== 'gemini-omni-video');
  const isKieGeminiOmniProvider =
    currentProviderId === 'kie-gemini-omni' ||
    (currentProviderId === 'veo-omni' && isKieApiVideoProvider && currentModel === 'gemini-omni-video');
  const isMiniMaxH3Provider = currentProviderId === 'minimax-h3';
  const hasImageReferenceMaterial = previewMaterials.some(
    (material) => getMaterialReferenceKind(material) === 'image'
  );
  // ── Kling 模型动态选项 ──
  const isKlingProvider = currentProviderId === 'kling';
  const klingModelSpec = useMemo(
    () => (isKlingProvider ? getKlingModelSpec(currentModel) : null),
    [isKlingProvider, currentModel],
  );
  // ── HappyHorse 模型动态选项 ──
  const isHappyHorseProvider = currentProviderId === 'happyhorse';
  const happyHorseSpec = useMemo(
    () => (isHappyHorseProvider ? getHappyHorseModelSpec(currentModel) : null),
    [isHappyHorseProvider, currentModel],
  );
  const kieVeoModelSpec = useMemo(
    () => (isKieVeoProvider ? getKieVeoModelSpec(currentModel) : null),
    [isKieVeoProvider, currentModel],
  );
  const kieGeminiOmniModelSpec = useMemo(
    () => (isKieGeminiOmniProvider ? getKieGeminiOmniModelSpec() : null),
    [isKieGeminiOmniProvider],
  );
  // Each built-in model only exposes parameters accepted by its actual endpoint.
  const resolutionOptions = useMemo(() => {
    if (kieGeminiOmniModelSpec) {
      return [];
    }
    if (kieVeoModelSpec) {
      return RESOLUTION_OPTIONS.filter((o) => kieVeoModelSpec.resolutions.includes(o.value as '1080P' | '4K'));
    }
    if (isMiniMaxH3Provider) {
      return RESOLUTION_OPTIONS.filter((o) => o.value === '720P' || o.value === '1080P');
    }
    if (isKlingProvider) {
      return [];
    }
    const opts = RESOLUTION_OPTIONS.filter((o) => o.value !== '4K');
    // HappyHorse 仅支持 720P / 1080P（无 480P）
    if (happyHorseSpec) {
      return RESOLUTION_OPTIONS.filter((o) => happyHorseSpec.resolutions.includes(o.value as VideoResolution));
    }
    // Seedance fast 模型不支持 1080P
    if (/seedance/i.test(`${currentProviderId} ${currentModel}`)) {
      return currentModel?.includes('fast')
        ? RESOLUTION_OPTIONS.filter((o) => o.value === '480P' || o.value === '720P')
        : RESOLUTION_OPTIONS;
    }
    return opts;
  }, [kieGeminiOmniModelSpec, kieVeoModelSpec, isKlingProvider, isMiniMaxH3Provider, happyHorseSpec, currentModel, currentProviderId]);

  const durationOptions = useMemo(() => {
    if (kieGeminiOmniModelSpec) {
      return DURATION_OPTIONS.filter((o) => kieGeminiOmniModelSpec.durations.includes(o.value as 4 | 6 | 8 | 10));
    }
    if (kieVeoModelSpec) {
      const supported = hasImageReferenceMaterial
        ? [kieVeoModelSpec.referenceDuration]
        : kieVeoModelSpec.durations;
      return DURATION_OPTIONS.filter((o) => supported.includes(o.value as 4 | 6 | 8));
    }
    if (klingModelSpec) {
      return DURATION_OPTIONS.filter((o) => klingModelSpec.durations.includes(String(o.value)));
    }
    if (isKlingProvider) {
      return DURATION_OPTIONS.filter((o) => o.value === 5 || o.value === 10);
    }
    if (isMiniMaxH3Provider) {
      return DURATION_OPTIONS.filter((o) => o.value >= 5 && o.value <= 15);
    }
    if (happyHorseSpec) {
      if (!happyHorseSpec.supportsDuration) return [];
      return DURATION_OPTIONS.filter((o) => o.value >= happyHorseSpec.durationMin && o.value <= happyHorseSpec.durationMax);
    }
    return DURATION_OPTIONS.filter((o) => o.value >= 4 && o.value <= 15);
  }, [kieGeminiOmniModelSpec, kieVeoModelSpec, hasImageReferenceMaterial, klingModelSpec, isKlingProvider, isMiniMaxH3Provider, happyHorseSpec]);

  const ratioOptions = useMemo(() => {
    if (klingModelSpec) {
      return RATIO_OPTIONS.filter((o) => klingModelSpec.aspectRatios.includes(o.value));
    }
    if (kieVeoModelSpec) {
      return RATIO_OPTIONS.filter((o) => kieVeoModelSpec.aspectRatios.includes(o.value as '16:9' | '9:16'));
    }
    if (kieGeminiOmniModelSpec) {
      return RATIO_OPTIONS.filter((o) => kieGeminiOmniModelSpec.aspectRatios.includes(o.value as '16:9' | '9:16'));
    }
    if (isMiniMaxH3Provider) {
      return RATIO_OPTIONS;
    }
    // HappyHorse I2V 不支持手动设置比例（自动匹配输入图）
    if (happyHorseSpec) {
      if (!happyHorseSpec.supportsRatio) return [];
      return HAPPYHORSE_RATIO_OPTIONS.filter((o) => happyHorseSpec.aspectRatios.includes(o.value as VideoRatio));
    }
    return RATIO_OPTIONS;
  }, [klingModelSpec, kieVeoModelSpec, kieGeminiOmniModelSpec, isMiniMaxH3Provider, happyHorseSpec]);

  useEffect(() => {
    // CLI 后端自带时长列表，不受 API provider 的 durationOptions 约束
    if (effectiveNodeData.generationBackend === 'dreamina-cli') return;
    const currentDuration = effectiveNodeData.duration || 5;
    const firstDuration = durationOptions[0]?.value;
    if (firstDuration && !durationOptions.some((option) => option.value === currentDuration)) {
      updateNodeData(id, { duration: firstDuration as VideoNodeData['duration'] });
    }
  }, [effectiveNodeData.generationBackend, durationOptions, effectiveNodeData.duration, id, updateNodeData]);

  useEffect(() => {
    if (effectiveNodeData.generationBackend === 'dreamina-cli') return;
    const patch: Partial<VideoNodeData> = {};
    const currentRatio = effectiveNodeData.ratio || '16:9';
    const currentResolution = effectiveNodeData.resolution || '720P';
    if (ratioOptions.length > 0 && !ratioOptions.some((option) => option.value === currentRatio)) {
      patch.ratio = ratioOptions[0].value as VideoNodeData['ratio'];
    }
    if (resolutionOptions.length > 0 && !resolutionOptions.some((option) => option.value === currentResolution)) {
      patch.resolution = resolutionOptions[0].value as VideoNodeData['resolution'];
    }
    if (Object.keys(patch).length > 0) updateNodeData(id, patch);
  }, [effectiveNodeData.generationBackend, effectiveNodeData.ratio, effectiveNodeData.resolution, id, ratioOptions, resolutionOptions, updateNodeData]);

  // Kling mode options are model-specific (std / pro / 4K).

  const modeOptions = useMemo(() => {
    if (!klingModelSpec) return [];
    return klingModelSpec.modes.map((m) => {
      const labels: Record<string, string> = { std: '标准', pro: '专业', '4k': '4K' };
      return { value: m, label: labels[m] || m };
    });
  }, [klingModelSpec]);

  const upstreamPromptSources = useIncomingPromptSources(id);

  const upstreamPrompt = useMemo(
    () =>
      upstreamPromptSources
        .map((source) => source.text)
        .filter((text) => text.trim().length > 0)
        .join('\n\n'),
    [upstreamPromptSources]
  );

  const localPrompt = useMemo(() => {
    const localText = (
      typeof effectiveNodeData.customPrompt === 'string' &&
      (effectiveNodeData.promptEdited || effectiveNodeData.customPrompt.length > 0)
    )
      ? effectiveNodeData.customPrompt
      : effectiveNodeData.prompt || effectiveNodeData.customPrompt || '';
    return mergeConnectedPromptText(upstreamPrompt, localText);
  }, [
    effectiveNodeData.customPrompt,
    effectiveNodeData.prompt,
    effectiveNodeData.promptEdited,
    upstreamPrompt,
  ]);

  const generationPrompt = useMemo(
    () => localPrompt,
    [localPrompt]
  );
  const connectedMaterialSlugs = useMemo(
    () => new Set(previewMaterials.map((material) => material.slug)),
    [previewMaterials]
  );
  const sanitizedGenerationPrompt = useMemo(
    () => stripMaterialMentionTokens(generationPrompt, connectedMaterialSlugs),
    [connectedMaterialSlugs, generationPrompt]
  );

  const defaultReferenceImage = previewMaterials[0]?.fileUrl || '';
  const firstMaterial = previewMaterials[0];
  const defaultReferencePreview =
    (typeof firstMaterial?.thumbnailUrl === 'string' ? firstMaterial.thumbnailUrl.trim() : '') ||
    (firstMaterial && getMaterialReferenceKind(firstMaterial) === 'image' ? defaultReferenceImage : '');
  const hasReferenceMaterial = previewMaterials.length > 0;
  const isSeedanceModel = /seedance/i.test(currentModel);
  /** 独立合规节点和素材节点内置合规都需要追加去黑条提示词。 */
  const hasFaceComplianceSource = useMemo(() => {
    if (previewMaterials.length === 0) return false;
    const nodes = useCanvasStore.getState().nodes;
    return previewMaterials.some((m) => {
      if (m.faceCompliance) return true;
      const sourceNode = nodes.find((n) => n.id === m.nodeId);
      if (sourceNode?.type === 'faceCompliance') return true;
      const sourceData = sourceNode?.data as Record<string, unknown> | undefined;
      return sourceNode?.type === 'material'
        && sourceData?.faceComplianceEnabled === true
        && sourceData.faceComplianceProcessed === true;
    });
  }, [previewMaterials]);
  const canGenerate = Boolean(sanitizedGenerationPrompt.trim() || hasReferenceMaterial);
  const seedanceGenerateEnabled = isMiniMaxH3Provider || !!currentVideoProvider?.apiKey.trim();
  const generatedVideos = useMemo(
    () => getGeneratedVideos(effectiveNodeData, id),
    [effectiveNodeData, id]
  );
  const selectedHistoryVideo = useMemo(
    () => generatedVideos.find((item) => item.id === effectiveNodeData.activeGeneratedVideoId) || null,
    [effectiveNodeData.activeGeneratedVideoId, generatedVideos]
  );
  const activeVideoUrl = selectedHistoryVideo?.videoUrl || effectiveNodeData.videoUrl || generatedVideos[0]?.videoUrl || '';
  const playableActiveVideoUrl = useMemo(
    () => resolveMaterialPlayableUrl(activeVideoUrl, 'video'),
    [activeVideoUrl]
  );

  const requestHistoryPosterRepair = useCallback((item: GeneratedVideoItem, force = false) => {
    const cacheKey = item.cacheKey?.trim();
    if (!cacheKey || !item.videoUrl.trim()) return;
    const expectedPosterUrl = item.posterUrl || '';

    void repairVideoHistoryPoster({
      cacheKey,
      videoUrl: item.videoUrl,
      force,
    }).then((posterUrl) => {
      const latestNode = useCanvasStore.getState().nodes.find((node) => node.id === id);
      const latestData = latestNode?.data as VideoNodeData | undefined;
      if (!latestData) return;

      let changed = false;
      const currentVideos = Array.isArray(latestData.generatedVideos)
        ? latestData.generatedVideos
        : [];
      let nextVideos = currentVideos.map((current) => {
        const matchesHistoryItem = current.id === item.id
          || (!current.id && isSameGeneratedVideoUrl(current.videoUrl, item.videoUrl));
        if (!matchesHistoryItem) return current;
        if (current.posterUrl && current.posterUrl !== expectedPosterUrl) return current;
        if (current.posterUrl === posterUrl && current.cacheKey === cacheKey) return current;
        changed = true;
        return { ...current, id: current.id || item.id, cacheKey, posterUrl };
      });
      if (
        !changed
        && currentVideos.length === 0
        && isSameGeneratedVideoUrl(latestData.videoUrl, item.videoUrl)
      ) {
        nextVideos = [{ ...item, cacheKey, posterUrl }];
        changed = true;
      }
      if (changed) {
        useCanvasStore.getState().updateNodeData(id, {
          generatedVideos: nextVideos,
          ...(!latestData.activeGeneratedVideoId ? { activeGeneratedVideoId: item.id } : {}),
        }, { recordUndo: false });
      }
      if (!componentMountedRef.current) return;
      setBrokenHistoryPosters((current) => {
        if (!(item.id in current)) return current;
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    }).catch(() => {
      // Keep the video history usable; a later remount, reconnect, or image error retries repair.
    });
  }, [id]);

  useEffect(() => {
    const repairMissingPosters = () => {
      generatedVideos.forEach((item) => {
        if (!item.posterUrl) requestHistoryPosterRepair(item);
      });
    };
    const repairWhenVisible = () => {
      if (document.visibilityState === 'visible') repairMissingPosters();
    };
    repairMissingPosters();
    window.addEventListener('online', repairMissingPosters);
    window.addEventListener('focus', repairMissingPosters);
    document.addEventListener('visibilitychange', repairWhenVisible);
    return () => {
      window.removeEventListener('online', repairMissingPosters);
      window.removeEventListener('focus', repairMissingPosters);
      document.removeEventListener('visibilitychange', repairWhenVisible);
    };
  }, [generatedVideos, requestHistoryPosterRepair]);

  useEffect(() => {
    const staleVideos = generatedVideos.filter(
      (item) =>
        item.cacheKey &&
        (item.videoUrl.startsWith('blob:') || item.videoUrl.startsWith('magine-media://h3/'))
    );
    if (staleVideos.length === 0) return;

    let cancelled = false;
    void Promise.all(
      staleVideos.map(async (item) => {
        const stableUrl = materialDiskPlayableUrl(item.cacheKey!, 'video');

        if (item.videoUrl.startsWith('magine-media://h3/')) {
          if (!isMiniMaxH3Provider || !currentVideoProvider) return null;
          const taskId = h3TaskIdFromMediaUrl(item.videoUrl);
          if (!taskId) return null;

          try {
            const sourcePath = await createMiniMaxH3VideoAPI(currentVideoProvider).downloadVideoContent(taskId);
            const cached = await persistVideoToMaterialCache(item.cacheKey!, sourcePath);
            return cached ? { id: item.id, oldUrl: item.videoUrl, stableUrl } : null;
          } catch {
            return null;
          }
        }

        try {
          const response = await fetch(stableUrl, { method: 'HEAD', cache: 'no-store' });
          return response.ok ? { id: item.id, oldUrl: item.videoUrl, stableUrl } : null;
        } catch {
          return null;
        }
      })
    ).then((results) => {
      if (cancelled) return;
      const repairs = results.filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (repairs.length === 0) return;

      const latestNode = useCanvasStore.getState().nodes.find((node) => node.id === id);
      const latestData = latestNode?.data as VideoNodeData | undefined;
      if (!latestData) return;

      const repairById = new Map(repairs.map((item) => [item.id, item]));
      const nextVideos = (latestData.generatedVideos || []).map((item) => {
        const repair = repairById.get(item.id);
        return repair && repair.oldUrl === item.videoUrl
          ? { ...item, videoUrl: repair.stableUrl }
          : item;
      });
      const activeRepair = repairs.find(
        (item) =>
          item.id === latestData.activeGeneratedVideoId ||
          item.oldUrl === latestData.videoUrl
      );

      useCanvasStore.getState().updateNodeData(id, {
        generatedVideos: nextVideos,
        videoUrl: activeRepair?.stableUrl || latestData.videoUrl,
        ...((latestData.generationProgress as GenerationProgress | undefined)?.status === 'success'
          ? { pendingMiniMaxH3Task: undefined }
          : {}),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [currentVideoProvider, generatedVideos, id, isMiniMaxH3Provider]);

  useEffect(() => {
    if (!IS_WEB_TRIAL_BUILD) return;
    const activeItem = selectedHistoryVideo
      || generatedVideos.find((item) => isSameGeneratedVideoUrl(item.videoUrl, effectiveNodeData.videoUrl))
      || generatedVideos[0];
    if (!activeItem?.cacheKey || !/^https:\/\//i.test(activeItem.videoUrl)) return;

    let cancelled = false;
    const sourceUrl = activeItem.videoUrl;
    void persistVideoToMaterialCache(activeItem.cacheKey, sourceUrl).then((cached) => {
      if (!cached || cancelled) return;
      const stableUrl = materialDiskPlayableUrl(activeItem.cacheKey!, 'video');
      const latestNode = useCanvasStore.getState().nodes.find((node) => node.id === id);
      const latestData = latestNode?.data as VideoNodeData | undefined;
      if (!latestData) return;
      const nextVideos = (latestData.generatedVideos || []).map((item) => (
        item.id === activeItem.id && item.videoUrl === sourceUrl
          ? { ...item, videoUrl: stableUrl, cacheKey: activeItem.cacheKey }
          : item
      ));
      updateNodeData(id, {
        generatedVideos: nextVideos,
        ...(isSameGeneratedVideoUrl(latestData.videoUrl, sourceUrl) ? { videoUrl: stableUrl } : {}),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [effectiveNodeData.videoUrl, generatedVideos, id, selectedHistoryVideo, updateNodeData]);

  useEffect(() => {
    setFrameCaptureMessage('');
  }, [activeVideoUrl]);

  const activeGeneratedVideo = useMemo(
    () =>
      selectedHistoryVideo ||
      generatedVideos.find((item) => isSameGeneratedVideoUrl(item.videoUrl, activeVideoUrl)) ||
      (activeVideoUrl
        ? {
            id: 'active-generated-video',
            videoUrl: activeVideoUrl,
            createdAt: 0,
            fileName: makeGeneratedVideoFileName(0),
            posterUrl: defaultReferencePreview || defaultReferenceImage,
        }
        : null),
    [activeVideoUrl, defaultReferenceImage, defaultReferencePreview, generatedVideos, selectedHistoryVideo]
  );
  const handleCaptureVideoFrame = async (mode: VideoFrameCaptureMode, overrideTime?: number) => {
    const sourceUrl = playableActiveVideoUrl || activeVideoUrl;
    if (!sourceUrl || frameCaptureBusy) return;

    setFrameCaptureBusy(mode);
    setFrameCaptureMessage('');
    try {
      const currentPreviewVideo = previewFrameRef.current?.querySelector('video');
      const currentTime =
        mode === 'free' && typeof overrideTime === 'number' && Number.isFinite(overrideTime)
          ? overrideTime
          : mode === 'free' && currentPreviewVideo && Number.isFinite(currentPreviewVideo.currentTime)
          ? currentPreviewVideo.currentTime
          : 0;
      const captureTime =
        mode === 'last'
          ? Number.POSITIVE_INFINITY
          : mode === 'free'
            ? currentTime
            : 0;
      const frame = await captureVideoFrameDataUrl(sourceUrl, captureTime);
      const nodes = useCanvasStore.getState().nodes;
      const videoNode = nodes.find((node) => node.id === id);
      const capturedCount = nodes.filter(
        (node) => node.type === 'material' && node.data?.sourceVideoNodeId === id
      ).length;
      const origin = videoNode?.position || { x: 0, y: 0 };
      const fileName = `${VIDEO_FRAME_CAPTURE_LABELS[mode]}-${Date.now()}.jpg`;
      const newId = addNodeWithData(
        'material',
        {
          x: origin.x + 420,
          y: origin.y + capturedCount * 210,
        },
        {
          label: '素材',
          type: 'material',
          fileUrl: frame.dataUrl,
          thumbnailUrl: frame.dataUrl,
          fileName,
          fileType: 'image',
          mentionSlug: fileNameToMentionSlug(fileName),
          materialAspectW: frame.width,
          materialAspectH: frame.height,
          sourceVideoNodeId: id,
          sourceVideoUrl: activeVideoUrl,
          sourceVideoFrameTime: frame.time,
          sourceVideoFrameMode: mode,
        },
        { captureEntrance: true, syncCommit: true }
      );
      addGlowingNode(newId);
      await persistInlineMaterialDataToProjectSidecar(newId, frame.dataUrl, frame.dataUrl);
      requestAnimationFrame(() => {
        const created = useCanvasStore.getState().nodes.find((node) => node.id === newId);
        if (created) {
          setSelectedNode(created);
          const materialCenterX = created.position.x + 120;
          const materialCenterY = created.position.y + 85;
          reactFlow.setCenter(materialCenterX, materialCenterY, {
            zoom: Math.max(0.75, reactFlow.getZoom()),
            duration: 520,
          });
        }
      });
      setFrameCaptureMessage(`已生成${VIDEO_FRAME_CAPTURE_LABELS[mode]}素材`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      console.error('视频截帧失败:', error);
      setFrameCaptureMessage(`截帧失败：${message}`);
    } finally {
      setFrameCaptureBusy(null);
    }
  };

  const videoFrameAspectRatio = ratioToCssAspect(activeGeneratedVideo?.ratio || effectiveNodeData.ratio);
  const promptBoxSize = effectiveNodeData.promptBoxSize || DEFAULT_VIDEO_PROMPT_BOX_SIZE;
  const selectedNodeWidth = Math.max(280, promptBoxSize.width + 26);

  const hasVideoInputForTokenEstimate = useMemo(
    () => previewMaterials.some((material) => getMaterialReferenceKind(material) === 'video'),
    [previewMaterials]
  );
  const videoTokenEstimate = useMemo(
    () =>
      estimateSeedanceVideoTokenUsage({
        model: currentModel,
        duration: effectiveNodeData.duration || 5,
        resolution: effectiveNodeData.resolution || '720P',
        hasVideoInput: hasVideoInputForTokenEstimate,
      }),
    [
      currentModel,
      effectiveNodeData.duration,
      effectiveNodeData.resolution,
      hasVideoInputForTokenEstimate,
    ]
  );
  const standard15s720Estimate = useMemo(
    () =>
      estimateSeedanceVideoTokenUsage({
        model: currentModel,
        duration: 15,
        resolution: '720P',
        hasVideoInput: hasVideoInputForTokenEstimate,
      }),
    [currentModel, hasVideoInputForTokenEstimate]
  );
  const videoRemainingTokens =
    videoTokenConfig.arkRemainingTokens == null
      ? null
      : Math.max(0, videoTokenConfig.arkRemainingTokens - videoTokenConfig.usedTokens);
  const estimatedRemaining15s720Videos =
    videoRemainingTokens == null
      ? null
      : Math.floor(videoRemainingTokens / Math.max(1, standard15s720Estimate.packageTokens));

  const remainingDisplay =
    videoRemainingTokens == null
      ? '请在侧栏设置中填写视频 API 剩余资源包 token'
      : `${videoRemainingTokens.toLocaleString()} 资源包 token`;
  const isKieVideoProvider = isKieProvider(currentVideoProvider, currentProviderId);
  const kieVideoTokenBucket = useSeedanceStore((state) =>
    getKieProviderTokenBucket(state.config.providerTokens, `video.${currentProviderId}`)
  );
  const kieVideoUsage = useMemo(
    () =>
      buildKieUsageDisplay({
        kind: 'video',
        providerId: currentProviderId,
        provider: currentVideoProvider,
        bucket: kieVideoTokenBucket,
        model: currentModel,
        resolution: isKieGeminiOmniProvider ? undefined : effectiveNodeData.resolution || '720P',
        duration: effectiveNodeData.duration || 5,
        hasInput: hasVideoInputForTokenEstimate,
      }),
    [
      currentModel,
      currentProviderId,
      currentVideoProvider,
      effectiveNodeData.duration,
      effectiveNodeData.resolution,
      hasVideoInputForTokenEstimate,
      isKieGeminiOmniProvider,
      kieVideoTokenBucket,
    ]
  );
  const syncKieCredits = () => {
    if (!isKieVideoProvider) return;
    void fetchKieCredits(currentVideoProvider)
      .then((credits) => {
        if (credits != null) setProviderRemainingTokens(KIE_GLOBAL_PROVIDER_TOKEN_KEY, credits);
      })
      .catch(() => undefined);
  };

  const handleRatioChange = (value: string | null) => {
    if (value) {
      updateNodeData(id, { ratio: value as VideoNodeData['ratio'] });
    }
  };

  const handleResolutionChange = (value: string | null) => {
    if (value) {
      updateNodeData(id, { resolution: value as VideoNodeData['resolution'] });
    }
  };

  const handleDurationChange = (value: string | null) => {
    if (value) {
      updateNodeData(id, { duration: parseInt(value) as VideoNodeData['duration'] });
    }
  };

  const handleModeChange = (value: string | null) => {
    if (value) updateNodeData(id, { mode: value });
  };

  const handleProviderChange = (value: string | null) => {
    if (!value) return;
    const provider = providerOptions.find((p) => p.value === value);
    const firstModel = provider?.models[0] || '';
    const patch: Partial<VideoNodeData> = { providerId: value, model: firstModel };
    // Downgrade resolution for fast models
    if (/seedance/i.test(value) && firstModel.includes('fast') && effectiveNodeData.resolution === '1080P') {
      patch.resolution = '720P';
    }
    // Kling 选项由具体模型规格决定。
    if (value === 'kling') {
      const klingSpec = getKlingModelSpec(firstModel);
      if (klingSpec) {
        const curRatio = effectiveNodeData.ratio || '16:9';
        if (!klingSpec.aspectRatios.includes(curRatio)) {
          patch.ratio = '16:9';
        }
        const curDur = effectiveNodeData.duration || 5;
        if (!klingSpec.durations.includes(String(curDur))) {
          patch.duration = 5;
        }
        patch.mode = 'std';
      }
    }
    // HappyHorse 选项由 T2V/I2V/R2V/视频编辑模式分别决定。
    if (value === 'happyhorse') {
      const hhSpec = getHappyHorseModelSpec(firstModel);
      if (hhSpec) {
        const curRes = effectiveNodeData.resolution || '720P';
        if (!hhSpec.resolutions.includes(curRes as VideoResolution)) {
          patch.resolution = '720P';
        }
        const curDur = effectiveNodeData.duration || 5;
        if (curDur < hhSpec.durationMin || curDur > hhSpec.durationMax) {
          patch.duration = 5;
        }
        if (!hhSpec.supportsRatio) {
          patch.ratio = undefined as unknown as VideoNodeData['ratio'];
        }
      }
    }
    updateNodeData(id, patch);
  };

  const handleModelChange = (value: string | null) => {
    if (value) {
      const patch: Partial<VideoNodeData> = { model: value };
      const isFastModel = value.includes('fast');
      // Seedance fast 模型不支持 1080P
      if (/seedance/i.test(currentProviderId) && isFastModel && effectiveNodeData.resolution === '1080P') {
        patch.resolution = '720P';
      }
      // Kling 模型切换时，校验比例/时长/模式是否被新模型支持
      if (isKlingProvider) {
        const newSpec = getKlingModelSpec(value);
        if (newSpec) {
          const curRatio = effectiveNodeData.ratio || '16:9';
          if (!newSpec.aspectRatios.includes(curRatio)) {
            patch.ratio = '16:9';
          }
          const curDur = effectiveNodeData.duration || 5;
          if (!newSpec.durations.includes(String(curDur))) {
            patch.duration = 5;
          }
          const curMode = effectiveNodeData.mode || 'std';
          if (!newSpec.modes.includes(curMode)) {
            patch.mode = 'std';
          }
        }
      }
      // HappyHorse 模型切换时，校验分辨率/时长/比例
      if (isHappyHorseProvider) {
        const newSpec = getHappyHorseModelSpec(value);
        if (newSpec) {
          const curRes = effectiveNodeData.resolution || '720P';
          if (!newSpec.resolutions.includes(curRes as VideoResolution)) {
            patch.resolution = '720P';
          }
          const curDur = effectiveNodeData.duration || 5;
          if (curDur < newSpec.durationMin || curDur > newSpec.durationMax) {
            patch.duration = 5 as VideoNodeData['duration'];
          }
          // I2V 不支持手动比例，清除 ratio
          if (!newSpec.supportsRatio) {
            patch.ratio = undefined as unknown as VideoNodeData['ratio'];
          }
        }
      }
      updateNodeData(id, patch);
    }
  };

  const effectiveBackend: 'api' | 'dreamina-cli' =
    effectiveNodeData.generationBackend === 'dreamina-cli' && dreaminaCliConfig.videoEnabled
      ? 'dreamina-cli'
      : 'api';

  const effectiveDreaminaCliModel = getDreaminaCliVideoModel(effectiveNodeData.dreaminaCliModel);
  const effectiveDreaminaCliVideoMode = normalizeDreaminaCliVideoMode(effectiveNodeData.dreaminaCliVideoMode);
  const dreaminaCliCreditSync = useDreaminaCliCreditSync(effectiveBackend === 'dreamina-cli');
  const dreaminaEstimatedCreditCost = useMemo(
    () => getDreaminaCliVideoCreditCost(effectiveDreaminaCliModel.value),
    [effectiveDreaminaCliModel.value],
  );

  useEffect(() => {
    if (effectiveBackend !== 'dreamina-cli') return;
    const supportedRes = effectiveDreaminaCliModel.resolutions as readonly string[];
    const currentResolution = effectiveNodeData.resolution || '720P';
    if (!supportedRes.includes(currentResolution)) {
      updateNodeData(id, { resolution: supportedRes[0] as VideoNodeData['resolution'] });
    }
  }, [effectiveBackend, effectiveDreaminaCliModel, effectiveNodeData.resolution, id, updateNodeData]);

  const recordDreaminaCreditSpend = async (result: Record<string, unknown>) => {
    const spent = extractDreaminaCreditCount(result) ?? dreaminaEstimatedCreditCost;
    applyDreaminaCliCreditSpend(spent);
    await dreaminaCliCreditSync.refresh(true);
  };

  const handleBackendChange = (value: string | null) => {
    if (value === 'api' || value === 'dreamina-cli') {
      const patch: Partial<VideoNodeData> = {
        generationBackend: value as VideoNodeData['generationBackend'],
      };
      if (value === 'dreamina-cli') {
        patch.dreaminaCliModel = effectiveDreaminaCliModel.value;
        patch.dreaminaCliVideoMode = effectiveDreaminaCliVideoMode;
        const supportedRes = effectiveDreaminaCliModel.resolutions as readonly string[];
        if (!supportedRes.includes(effectiveNodeData.resolution || '720P')) {
          patch.resolution = supportedRes[0] as VideoNodeData['resolution'];
        }
        const duration = effectiveNodeData.duration || 5;
        if (
          duration < effectiveDreaminaCliModel.minDuration
          || duration > effectiveDreaminaCliModel.maxDuration
        ) {
          patch.duration = 5;
        }
      }
      updateNodeData(id, patch);
    }
  };

  const handleDreaminaCliModelChange = (value: string | null) => {
    if (value && DREAMINA_CLI_VIDEO_MODELS.some((m) => m.value === value)) {
      const model = DREAMINA_CLI_VIDEO_MODELS.find((m) => m.value === value)!;
      const patch: Partial<VideoNodeData> = { dreaminaCliModel: value };
      // If current resolution not supported by new model, auto-switch to first supported
      if (!(model.resolutions as readonly string[]).includes(effectiveNodeData.resolution || '720P')) {
        patch.resolution = model.resolutions[0] as VideoNodeData['resolution'];
      }
      const duration = effectiveNodeData.duration || 5;
      if (duration < model.minDuration || duration > model.maxDuration) {
        patch.duration = Math.max(model.minDuration, Math.min(5, model.maxDuration));
      }
      updateNodeData(id, patch);
    }
  };

  const handleDreaminaCliVideoModeChange = (value: string | null) => {
    updateNodeData(id, { dreaminaCliVideoMode: normalizeDreaminaCliVideoMode(value || undefined) });
  };

  // CLI model-specific supported resolutions
  const dreaminaResolutionOptions = useMemo(() => {
    const supported = effectiveDreaminaCliModel.resolutions as readonly string[];
    return RESOLUTION_OPTIONS.filter((o) => supported.includes(o.value));
  }, [effectiveDreaminaCliModel]);

  const effectiveRatioOptions = useMemo(() => {
    if (effectiveBackend === 'dreamina-cli') {
      return DREAMINA_CLI_VIDEO_RATIO_OPTIONS.map((opt) => ({
        value: opt.value,
        label: opt.label,
        desc: '',
      }));
    }
    return ratioOptions;
  }, [effectiveBackend, ratioOptions]);

  const effectiveDurationOptions = useMemo(() => {
    if (effectiveBackend === 'dreamina-cli') {
      return getDreaminaCliVideoDurationOptions(effectiveDreaminaCliModel.value);
    }
    return durationOptions;
  }, [effectiveBackend, effectiveDreaminaCliModel.value, durationOptions]);

  useEffect(() => {
    if (effectiveDurationOptions.length === 0) return;
    const currentDuration = effectiveNodeData.duration || 5;
    const firstDuration = effectiveDurationOptions[0]?.value;
    if (firstDuration && !effectiveDurationOptions.some((option) => option.value === currentDuration)) {
      updateNodeData(id, { duration: firstDuration as VideoNodeData['duration'] });
    }
  }, [effectiveDurationOptions, effectiveNodeData.duration, id, updateNodeData]);

  const handleGeneratedVideoDragStart = (
    event: React.DragEvent<HTMLElement>,
    item: GeneratedVideoItem
  ) => {
    event.stopPropagation();
    const payload: GeneratedVideoDragPayload = {
      videoUrl: resolveMaterialPlayableUrl(item.videoUrl, 'video'),
      fileName: item.fileName || makeGeneratedVideoFileName(item.createdAt),
      prompt: item.prompt,
      posterUrl: item.posterUrl,
    };
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(GENERATED_VIDEO_DND_TYPE, JSON.stringify(payload));
    event.dataTransfer.setData('text/uri-list', payload.videoUrl);
  };

  const handleOpenGeneratedVideo = (item: GeneratedVideoItem) => {
    updateNodeData(id, {
      videoUrl: item.videoUrl,
      activeGeneratedVideoId: item.id,
      ...(item.prompt !== undefined ? { customPrompt: item.prompt, promptEdited: true } : {}),
      ...(item.model ? { model: item.model } : {}),
      ...(item.providerId ? { providerId: item.providerId } : {}),
      ...(item.ratio ? { ratio: item.ratio as VideoNodeData['ratio'] } : {}),
      ...(item.resolution ? { resolution: item.resolution as VideoNodeData['resolution'] } : {}),
      ...(typeof item.duration === 'number' ? { duration: item.duration } : {}),
      ...(item.generationBackend ? { generationBackend: item.generationBackend } : {}),
      ...(item.mode ? { mode: item.mode } : {}),
      ...(item.personReferenceMode ? { personReferenceMode: item.personReferenceMode } : {}),
      ...(item.dreaminaCliModel ? { dreaminaCliModel: item.dreaminaCliModel } : {}),
      ...(item.dreaminaCliVideoMode ? { dreaminaCliVideoMode: item.dreaminaCliVideoMode } : {}),
    });
  };

  const commitGeneratedVideo = async (params: GeneratedVideoCommitParams) => {
    const latestNode = useCanvasStore.getState().nodes.find((node) => node.id === id);
    const latestData = latestNode?.data as VideoNodeData | undefined;
    const latestVideos = latestData ? getGeneratedVideos(latestData, id) : generatedVideos;
    const existingTaskVideo = params.taskId
      ? latestVideos.find((item) => item.taskId === params.taskId)
      : undefined;
    if (existingTaskVideo) {
      let existingVideoUrl = existingTaskVideo.videoUrl;
      if (IS_WEB_TRIAL_BUILD && /^https:\/\//i.test(existingVideoUrl) && existingTaskVideo.cacheKey) {
        const cached = await persistVideoToMaterialCache(existingTaskVideo.cacheKey, existingVideoUrl);
        if (!cached) {
          throw new Error('视频任务已完成，但返回文件尚未就绪或未通过媒体格式校验，云端正在保留任务，请稍后重试恢复。');
        }
        existingVideoUrl = materialDiskPlayableUrl(existingTaskVideo.cacheKey, 'video');
      }
      updateNodeData(id, {
        videoUrl: existingVideoUrl,
        generatedVideos: latestVideos.map((item) => (
          item.id === existingTaskVideo.id ? { ...item, videoUrl: existingVideoUrl } : item
        )),
        activeGeneratedVideoId: existingTaskVideo.id,
        pendingSeedanceTask: undefined,
        isLoading: false,
        status: 'success',
        generationProgress: { status: 'success', progress: 100, message: '视频生成完成' },
      } as Partial<VideoNodeData>);
      return;
    }

    const sourceUrl = params.videoUrl;
    const nextVideo = buildGeneratedVideoItem({
      taskId: params.taskId,
      videoUrl: sourceUrl,
      posterUrl: params.posterUrl,
      prompt: params.inputPrompt ?? params.prompt,
      model: params.baseRequest.model,
      ratio: params.baseRequest.ratio || '16:9',
      resolution: params.baseRequest.resolution || '720P',
      duration: params.baseRequest.duration || 5,
      providerId: params.providerId || currentProviderId,
      generationBackend: effectiveBackend,
      mode: effectiveNodeData.mode,
      personReferenceMode: effectiveNodeData.personReferenceMode,
      dreaminaCliModel: effectiveBackend === 'dreamina-cli' ? effectiveDreaminaCliModel.value : undefined,
      dreaminaCliVideoMode: effectiveBackend === 'dreamina-cli' ? effectiveDreaminaCliVideoMode : undefined,
    });
    let playableUrl = sourceUrl;
    let cacheNodeId = projectCacheMaterialNodeId(sourceUrl) || '';
    if (cacheNodeId) {
      const cached = await persistVideoToMaterialCache(cacheNodeId, sourceUrl);
      if (!cached && IS_WEB_TRIAL_BUILD) {
        throw new Error('视频任务已完成，但云端媒体文件不存在或尚未写入成功，请稍后重试恢复。');
      }
      playableUrl = cached ? materialDiskPlayableUrl(cacheNodeId, 'video') : sourceUrl;
    } else {
      cacheNodeId = generatedVideoCacheKey(id, nextVideo.createdAt);
      const cached = await persistVideoToMaterialCache(cacheNodeId, sourceUrl);
      if (!cached && IS_WEB_TRIAL_BUILD && (/^https:\/\//i.test(sourceUrl) || /^data:video\//i.test(sourceUrl))) {
        throw new Error('视频任务已完成，但返回文件尚未就绪、地址已失效或格式不正确，未能安全保存到云端素材库。请稍后重试恢复。');
      }
      playableUrl = cached ? materialDiskPlayableUrl(cacheNodeId, 'video') : resolveMaterialPlayableUrl(sourceUrl, 'video');
      if (!cached) {
        cacheNodeId = projectCacheMaterialNodeId(playableUrl) || cacheNodeId;
      }
    }
    nextVideo.cacheKey = cacheNodeId;
    nextVideo.videoUrl = playableUrl;

    let cachedPosterUrl = '';
    try {
      cachedPosterUrl = await repairVideoHistoryPoster({
        cacheKey: cacheNodeId,
        videoUrl: nextVideo.videoUrl,
        force: true,
      });
    } catch {
      cachedPosterUrl = '';
    }
    if (!cachedPosterUrl && params.posterUrl) {
      if (isProjectCacheMaterialUrl(params.posterUrl) || isMaterialDiskRef(params.posterUrl)) {
        cachedPosterUrl = resolveMaterialPlayableUrl(params.posterUrl, 'image');
      } else {
        const posterCacheNodeId = `${cacheNodeId}-poster`;
        const cachedPoster = await persistImageToMaterialCache(posterCacheNodeId, params.posterUrl);
        cachedPosterUrl = cachedPoster ? materialDiskPlayableUrl(posterCacheNodeId, 'image') : params.posterUrl;
      }
    }
    nextVideo.posterUrl = cachedPosterUrl || undefined;

    const retainedVideos = latestVideos.filter((item) => item.id !== nextVideo.id);
    const generationTaskSucceeded = Math.max(
      Math.max(0, Math.floor(Number(latestData?.generationTaskSucceeded) || 0)),
      latestVideos.length,
    ) + 1;
    const generationTaskTotal = Math.max(
      Math.max(0, Math.floor(Number(latestData?.generationTaskTotal) || 0)),
      generationTaskSucceeded,
    );
    updateNodeData(id, {
      videoUrl: nextVideo.videoUrl,
      activeGeneratedVideoId: nextVideo.id,
      generatedVideos: [nextVideo, ...retainedVideos].slice(0, 30),
      generationTaskTotal,
      generationTaskSucceeded,
      lastGenerationCredits: params.lastGenerationCredits,
      isLoading: false,
      status: 'success',
      pendingMiniMaxH3Task: undefined,
      pendingSeedanceTask: undefined,
      generationProgress: { status: 'success', progress: 100, message: '视频生成完成' },
    });
    addGlowingNode(id);
  };
  useEffect(() => {
    commitGeneratedVideoRef.current = commitGeneratedVideo;
  });

  useEffect(() => {
    if (
      effectiveBackend !== 'api'
      || !/^seedance/i.test(currentProviderId)
      || !currentVideoProvider?.apiKey
      || generationProgress.status !== 'error'
    ) {
      return;
    }

    const taskId = /\/contents\/generations\/tasks\/([a-z0-9_-]+)/i.exec(
      generationProgress.message,
    )?.[1];
    if (!taskId || recoveredSeedanceTaskIdsRef.current.has(taskId)) return;
    recoveredSeedanceTaskIdsRef.current.add(taskId);

    let cancelled = false;
    void (async () => {
      try {
        const api = new VideoAPI(currentVideoProvider.apiKey, currentVideoProvider.apiUrl);
        const result = await api.pollTaskUntilComplete(taskId, undefined, 120, 5000);
        if (cancelled || result.status !== 'succeeded' || !result.result?.video_url) return;

        await commitGeneratedVideoRef.current({
          taskId,
          providerId: currentProviderId,
          videoUrl: result.result.video_url,
          posterUrl: result.result.cover_url || defaultReferencePreview || defaultReferenceImage,
          prompt: sanitizedGenerationPrompt,
          inputPrompt: sanitizedGenerationPrompt,
          baseRequest: {
            model: effectiveNodeData.model || 'seedance-2.0',
            ratio: effectiveNodeData.ratio || '16:9',
            resolution: effectiveNodeData.resolution || '720P',
            duration: effectiveNodeData.duration || 5,
          },
        });
      } catch {
        recoveredSeedanceTaskIdsRef.current.delete(taskId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    currentProviderId,
    currentVideoProvider,
    defaultReferenceImage,
    defaultReferencePreview,
    effectiveBackend,
    effectiveNodeData.duration,
    effectiveNodeData.model,
    effectiveNodeData.ratio,
    effectiveNodeData.resolution,
    generationProgress.message,
    generationProgress.status,
    sanitizedGenerationPrompt,
  ]);

  useEffect(() => {
    const isUnfinished = generationProgress.status === 'submitting' || generationProgress.status === 'processing';
    if (!isMiniMaxH3Provider || !isUnfinished || !currentVideoProvider) return;

    const savedTask = effectiveNodeData.pendingMiniMaxH3Task;
    const lookupPrompt = stripMaterialMentionTokens(savedTask?.prompt || sanitizedGenerationPrompt).trim();
    if (!savedTask?.taskId && !lookupPrompt) return;
    // A newly submitted task has not received/persisted its engine task id yet.
    // Let the submit path finish instead of misclassifying it as a lost history task.
    if (!savedTask?.taskId && miniMaxH3SubmitRef.current) return;

    let cancelled = false;
    const provider = currentVideoProvider;

    const patchNode = (patch: Partial<VideoNodeData>) => {
      if (!cancelled) useCanvasStore.getState().updateNodeData(id, patch);
    };

    void (async () => {
      const h3Api = createMiniMaxH3VideoAPI(provider);
      let taskId = savedTask?.taskId || '';
      const taskStatus = taskId
        ? await h3Api.queryTask(taskId)
        : await h3Api.findLatestTaskByPrompt(lookupPrompt);

      if (!taskStatus) {
        patchNode({
          isLoading: false,
          generationProgress: {
            status: 'error',
            progress: 0,
            message: 'MiniMax-H3 画布任务已中断，未找到对应的本地引擎历史任务',
          },
        });
        return;
      }

      taskId = taskStatus.task_id;
      console.info('[MiniMax-H3] 恢复画布任务', { nodeId: id, taskId, status: taskStatus.status });
      const recoveryTask: PendingMiniMaxH3Task = savedTask || {
        taskId,
        prompt: lookupPrompt,
        inputPrompt: localPrompt,
        model: currentModel,
        ratio: effectiveNodeData.ratio || '16:9',
        resolution: effectiveNodeData.resolution || '720P',
        duration: effectiveNodeData.duration || 5,
        posterUrl: defaultReferencePreview || defaultReferenceImage,
        submittedAt: Date.now(),
      };
      if (!savedTask) patchNode({ pendingMiniMaxH3Task: recoveryTask });

      let finalStatus: ProviderTaskStatus = taskStatus;
      if (taskStatus.status === 'submitted' || taskStatus.status === 'processing') {
        finalStatus = await pollProviderTask(
          taskId,
          (idToQuery) => cancelled
            ? Promise.resolve({ status: 'failed', message: 'cancelled' })
            : h3Api.queryTask(idToQuery),
          (_status, apiProgress) => patchNode({
            isLoading: true,
            generationProgress: {
              status: 'processing',
              progress: typeof apiProgress === 'number'
                ? Math.min(94, Math.max(20, Math.round(apiProgress)))
                : estimateMiniMaxH3Progress(
                    recoveryTask.submittedAt,
                    recoveryTask.duration || 5,
                  ),
              message: 'MiniMax-H3 视频生成中...',
            },
          }),
          4320,
          5000,
        );
      }
      if (cancelled) return;

      if (finalStatus.status !== 'succeed') {
        patchNode({
          isLoading: false,
          pendingMiniMaxH3Task: undefined,
          generationProgress: {
            status: 'error',
            progress: 0,
            message: `MiniMax-H3 生成失败: ${finalStatus.message || finalStatus.status}`,
          },
        });
        return;
      }

      patchNode({
        isLoading: true,
        generationProgress: { status: 'processing', progress: 95, message: '正在读取已生成的视频...' },
      });
      const videoUrl = await h3Api.downloadVideoContent(taskId);
      if (cancelled) return;
      await commitGeneratedVideoRef.current({
        videoUrl,
        posterUrl: recoveryTask.posterUrl,
        prompt: recoveryTask.prompt,
        inputPrompt: recoveryTask.inputPrompt,
        baseRequest: {
          ratio: recoveryTask.ratio,
          resolution: recoveryTask.resolution,
          duration: recoveryTask.duration,
          model: recoveryTask.model,
        },
      });
      console.info('[MiniMax-H3] 画布任务已恢复并写入视频', { nodeId: id, taskId });
      patchNode({ pendingMiniMaxH3Task: undefined });
    })().catch((error) => {
      patchNode({
        isLoading: false,
        generationProgress: {
          status: 'error',
          progress: 0,
          message: `MiniMax-H3 任务恢复失败: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    currentModel,
    currentVideoProvider,
    defaultReferenceImage,
    defaultReferencePreview,
    effectiveNodeData.duration,
    effectiveNodeData.pendingMiniMaxH3Task,
    effectiveNodeData.ratio,
    effectiveNodeData.resolution,
    generationProgress.status,
    id,
    isMiniMaxH3Provider,
    localPrompt,
    sanitizedGenerationPrompt,
  ]);

  const handleDreaminaCliGenerate = async () => {
    const prompt = sanitizedGenerationPrompt;

    if (!dreaminaCliConfig.loggedIn) {
      setGenerationProgress({
        status: 'error', progress: 0,
        message: '即梦CLI 未登录，请在 API 配置中检测登录状态',
      });
      return;
    }
    if (!prompt.trim() && !hasReferenceMaterial) {
      setGenerationProgress({
        status: 'error', progress: 0,
        message: '请输入提示词或连接参考素材',
      });
      return;
    }

    if (dreaminaCliSubmitRef.current) return;
    dreaminaCliSubmitRef.current = true;
    registerGenerationTask();
    setIsLoading(true);

    try {
      const cli = new DreaminaCLIAPI(dreaminaCliConfig);
      const cliModel = effectiveDreaminaCliModel.value;
      const requiredCredit = dreaminaEstimatedCreditCost;
      let totalCredit = useSeedanceStore.getState().dreaminaCliCredit.totalCredit;

      setGenerationProgress({ status: 'submitting', progress: 5, message: '同步 CLI 额度...' });
      await dreaminaCliCreditSync.refresh(true);
      totalCredit = useSeedanceStore.getState().dreaminaCliCredit.totalCredit;

      const cleanPrompt = stripMaterialMentionTokens(prompt);
      const builtReferences = buildVideoReferences(previewMaterials);
      setGenerationProgress({ status: 'submitting', progress: 8, message: '准备 CLI 参考素材...' });
      const referenceImages = await toDreaminaCliReferenceInputs(builtReferences.referenceImages, 'image');
      const referenceVideos = await toDreaminaCliReferenceInputs(builtReferences.referenceVideos, 'video');
      const referenceAudios = await toDreaminaCliReferenceInputs(builtReferences.referenceAudios, 'audio');
      const hasReferences = referenceImages.length > 0 || referenceVideos.length > 0;

      const cliPrompt = composePrompt([
        cleanPrompt || (hasReferences ? '结合参考素材生成视频' : '') || '视频生成',
        ...previewMaterials.map(getCharacterMaterialPrompt),
        hasFaceComplianceSource && FACE_COMPLIANCE_VIDEO_PROMPT,
      ]);

      /** 统一的提交→轮询→获取结果流程 */
      const submitAndPoll = async (
        submitFn: () => Promise<DreaminaCLIGenerateResult>,
        submitLabel: string,
      ) => {
        setGenerationProgress({ status: 'submitting', progress: 10, message: `即梦CLI: ${submitLabel}` });

        const result = await submitFn();

        // Check sync video_url first (some CLI versions return immediately)
        const syncVideo = extractVideoUrl(result);
        if (syncVideo) {
          await commitGeneratedVideo({
            videoUrl: syncVideo,
            posterUrl: extractCoverUrl(result) || defaultReferencePreview || defaultReferenceImage,
            prompt: cliPrompt,
            inputPrompt: prompt,
            baseRequest: {
              ratio: effectiveNodeData.ratio || '16:9',
              resolution: effectiveNodeData.resolution || '720P',
              duration: effectiveNodeData.duration || 5,
              model: effectiveDreaminaCliModel.value,
            },
          });
          await recordDreaminaCreditSpend(result);
          setGenerationProgress({ status: 'success', progress: 100, message: '即梦CLI: 视频生成成功' });
          return;
        }

        // Validate async submission per CLI docs (SKILL.md)
        const submitCheck = isSubmitSuccess(result);
        if (!submitCheck.ok) {
          const errDetail = JSON.stringify(result).slice(0, 300);
          const rawReason =
            typeof result['fail_reason'] === 'string' ? result['fail_reason'] : '任务提交失败';
          console.error('[DreaminaCLI] 提交失败，CLI 返回:', errDetail);
          const displayReason = formatDreaminaFailReason(rawReason, {
            totalCredit,
            requiredCredit,
            modelLabel: effectiveDreaminaCliModel.label,
          });
          setGenerationProgress({
            status: 'error', progress: 0,
            message: displayReason === '即梦积分额度不足'
              ? displayReason
              : `${displayReason}\n响应: ${errDetail}`,
          });
          return;
        }

        const taskId = submitCheck.taskId!;
        setGenerationProgress({
          status: 'processing', progress: 20,
          message: `即梦CLI: 任务已提交 ${taskId.slice(0, 8)}...`,
        });

        let initialQueuePos = -1;
        let lastProgress = 20;

        const finalResult = await cli.pollUntilComplete(
          taskId,
          (status) => {
            const queueMatch = status.match(/队列 #(\d+)\/(\d+)/);
            let progress = lastProgress;

            if (queueMatch) {
              const currentPos = parseInt(queueMatch[1], 10);
              const totalLen = parseInt(queueMatch[2], 10);
              if (initialQueuePos < 0) initialQueuePos = currentPos;

              // Dynamic progress: 20% → 60% as queue position approaches 0
              const ratio = Math.max(0, 1 - currentPos / Math.max(initialQueuePos, 1));
              progress = 20 + Math.round(ratio * 40);

              setGenerationProgress({
                status: 'processing',
                progress: Math.min(progress, 60),
                message: `排队中 #${currentPos}/${totalLen}`,
              });
            } else if (status.includes('已出队列')) {
              progress = 70;
              setGenerationProgress({
                status: 'processing', progress,
                message: `已出队列，正在生成视频...`,
              });
            } else if (status.includes('querying')) {
              progress = Math.min(lastProgress + 1, 55);
              setGenerationProgress({
                status: 'processing', progress,
                message: `即梦CLI: ${status}`,
              });
            } else {
              progress = 75;
              setGenerationProgress({
                status: 'processing', progress,
                message: `即梦CLI: ${status}`,
              });
            }
            lastProgress = progress;
          },
          undefined,
          undefined,
          id,
          (pollResult) => Boolean(extractVideoUrl(pollResult)),
        );

        const finalVideo = extractVideoUrl(finalResult);
        if (finalVideo) {
          await commitGeneratedVideo({
            videoUrl: finalVideo,
            posterUrl: extractCoverUrl(finalResult) || defaultReferencePreview || defaultReferenceImage,
            prompt: cliPrompt,
            inputPrompt: prompt,
            baseRequest: {
              ratio: effectiveNodeData.ratio || '16:9',
              resolution: effectiveNodeData.resolution || '720P',
              duration: effectiveNodeData.duration || 5,
              model: effectiveDreaminaCliModel.value,
            },
          });
          await recordDreaminaCreditSpend(finalResult);
          setGenerationProgress({ status: 'success', progress: 100, message: '即梦CLI: 视频生成成功' });
        } else {
          const reason = typeof finalResult['fail_reason'] === 'string'
            ? finalResult['fail_reason']
            : `未返回视频 URL（响应键: ${Object.keys(finalResult).join(', ')}）`;
          setGenerationProgress({ status: 'error', progress: 0, message: `生成失败: ${reason}` });
        }
      };

      const validatedResolution = normalizeDreaminaCliVideoResolution(
        cliModel,
        effectiveNodeData.resolution || '720P',
      );

      if (hasReferences) {
        const referenceSubmit =
          effectiveDreaminaCliVideoMode === 'first-last-frame'
            ? () => cli.multiframe2video({
                prompt: cliPrompt,
                images: referenceImages,
                duration: effectiveNodeData.duration || 5,
              })
            : () => cli.multimodal2video({
                prompt: cliPrompt,
                images: referenceImages,
                videos: referenceVideos,
                audios: referenceAudios,
                ratio: effectiveNodeData.ratio || '16:9',
                duration: effectiveNodeData.duration || 5,
                model_version: cliModel,
                video_resolution: validatedResolution,
              });
        const referenceLabel =
          effectiveDreaminaCliVideoMode === 'first-last-frame'
            ? `首尾帧，参考图 ${referenceImages.length} 张...`
            : `全能参考 (${effectiveDreaminaCliModel.label})，图片 ${referenceImages.length} 张，视频 ${referenceVideos.length} 个...`;
        await submitAndPoll(
          referenceSubmit,
          referenceLabel,
        );
      } else {
        await submitAndPoll(
          () => cli.text2video({
            prompt: cliPrompt,
            ratio: effectiveNodeData.ratio || '16:9',
            duration: effectiveNodeData.duration || 5,
            model_version: cliModel,
            resolution: validatedResolution,
          }),
          `文生视频 (${effectiveDreaminaCliModel.label})...`,
        );
      }
    } catch (error) {
      logDreaminaClientTrace('video-node-error', {
        nodeId: id,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
        prompt,
        backend: effectiveBackend,
        model: effectiveDreaminaCliModel.value,
        mode: effectiveDreaminaCliVideoMode,
      });
      const displayError = formatDreaminaCliVideoError(error);
      setGenerationProgress({
        status: 'error', progress: 0,
        message: displayError === '即梦积分额度不足'
          ? displayError
          : `即梦CLI 错误: ${displayError}`,
      });
    } finally {
      dreaminaCliSubmitRef.current = false;
      setIsLoading(false);
    }
  };

  const handleGenerate = async () => {
    // Dispatch to CLI backend
    if (effectiveBackend === 'dreamina-cli') {
      return handleDreaminaCliGenerate();
    }

    const prompt = sanitizedGenerationPrompt;

    if (!isMiniMaxH3Provider && !currentVideoProvider?.apiKey) {
      setGenerationProgress({
        status: 'error',
        progress: 0,
        message: '请先配置 API Key'
      });
      return;
    }

    if (!prompt.trim() && !hasReferenceMaterial) {
      setGenerationProgress({
        status: 'error',
        progress: 0,
        message: '请输入提示词或连接参考素材'
      });
      return;
    }

    if (isMiniMaxH3Provider) {
      const latestNode = useCanvasStore.getState().nodes.find((node) => node.id === id);
      const latestData = latestNode?.data as VideoNodeData | undefined;
      const latestProgress = latestData?.generationProgress as GenerationProgress | undefined;
      const hasActiveTask =
        Boolean(latestData?.pendingMiniMaxH3Task?.taskId) ||
        latestProgress?.status === 'submitting' ||
        latestProgress?.status === 'processing';
      if (miniMaxH3SubmitRef.current || hasActiveTask) return;
      miniMaxH3SubmitRef.current = true;
    }

    if (/^seedance/i.test(currentProviderId)) {
      const latestNode = useCanvasStore.getState().nodes.find((node) => node.id === id);
      const pendingTask = (latestNode?.data as VideoNodeData | undefined)?.pendingSeedanceTask;
      if (pendingTask?.taskId) {
        setGenerationProgress({
          status: 'processing',
          progress: estimateSeedanceTaskProgress(pendingTask, 'processing'),
          message: `正在继续云端任务 ${pendingTask.taskId.slice(0, 12)}...`,
        });
        return;
      }
    }

    registerGenerationTask();
    setIsLoading(true);
    setGenerationProgress({
      status: 'submitting',
      progress: 10,
      message: '正在提交任务...'
    });

    try {
      const cleanPrompt = stripMaterialMentionTokens(prompt);
      const builtReferences = buildVideoReferences(previewMaterials);
      const {
        referenceImages,
      } = builtReferences;
      const {
        referenceVideos,
        referenceAudios,
      } = builtReferences;
      const { unsupported } = builtReferences;
      const kieImageReferenceMaterials = previewMaterials
        .filter((material) => getMaterialReferenceKind(material) === 'image')
        .slice(0, 9);
      const kieVideoReferenceMaterials = previewMaterials
        .filter((material) => getMaterialReferenceKind(material) === 'video')
        .slice(0, 3);

      if (unsupported.length > 0) {
        const names = unsupported
          .map((m) => m.fileName || `@${m.slug}`)
          .slice(0, 3)
          .join('、');
        throw new Error(`视频生成只支持图片、公开视频/asset:// 视频和音频素材，请移除不支持的素材：${names}`);
      }

      const hasApiReferences =
        referenceImages.length > 0 || referenceVideos.length > 0 || referenceAudios.length > 0;
      const apiPrompt =
        composePrompt([
          cleanPrompt ||
            (hasApiReferences ? '结合所给参考素材生成视频' : '') ||
            '视频生成',
          ...previewMaterials.map(getCharacterMaterialPrompt),
          hasFaceComplianceSource && FACE_COMPLIANCE_VIDEO_PROMPT,
        ]);

      const baseRequest = {
        ratio: toApiVideoRatio(effectiveNodeData.ratio, isHappyHorseProvider || isSeedanceModel),
        resolution: effectiveNodeData.resolution || '720P',
        duration: effectiveNodeData.duration || 5,
        model: currentModel,
      } as const;
      let submittedHasVideoInput = referenceVideos.length > 0;

      setGenerationProgress({
        status: 'submitting',
        progress: 12,
        message: `正在提交任务：参考图 ${referenceImages.length} 张，参考视频 ${referenceVideos.length} 个，参考音频 ${referenceAudios.length} 个`,
      });

      // ── 根据 provider 分发到不同的 API ──
      const isKling = currentProviderId === 'kling';
      const isHappyHorse = currentProviderId === 'happyhorse';
      const isBuiltinVideo = ['seedance-2.0', 'seedance-2.0-relay', 'seedance-2-0', 'kling', 'happyhorse', 'veo-omni', 'kie-veo', 'kie-gemini-omni', 'minimax-h3'].includes(currentProviderId);

      if (isKling) {
        // ── Kling AI ──
        const klingApi = createKlingVideoAPI(currentVideoProvider);
        const klingSpec = getKlingModelSpec(currentModel);
        const requestedKlingDuration = String(baseRequest.duration);
        const klingDuration = klingSpec?.durations.includes(requestedKlingDuration)
          ? requestedKlingDuration
          : klingSpec?.durations[0] || '5';
        const klingMode = klingSpec?.modes.includes(effectiveNodeData.mode || 'std')
          ? effectiveNodeData.mode || 'std'
          : klingSpec?.modes[0] || 'std';
        const klingBaseRequest = {
          ...baseRequest,
          duration: Number(klingDuration),
        };
        const klingParams: import('../api/KlingVideoAPI').KlingVideoParams = {
          model: currentModel,
          prompt: apiPrompt,
          duration: klingDuration,
          aspect_ratio: baseRequest.ratio,
          mode: klingMode as 'std' | 'pro' | '4k',
        };
        // 根据模型规格条件化设置参考图参数
        if (referenceImages.length > 0 && klingSpec?.supportsFirstFrame !== false) {
          klingParams.referenceImage = referenceImages[0];
          if (referenceImages.length >= 2 && klingSpec?.supportsMultiImage) {
            klingParams.referenceImages = referenceImages.slice(0, 4);
          }
          if (referenceImages.length >= 2 && klingSpec?.supportsLastFrame) {
            klingParams.endImage = referenceImages[1];
          }
        }
        if (referenceVideos.length > 0 && klingSpec?.supportsVideoRef) {
          klingParams.referenceVideo = referenceVideos[0];
        }
        const klingResult = await klingApi.createTask(klingParams);
        if (!klingResult.task_id) throw new Error('Kling: 任务提交失败，未返回 task_id');

        setGenerationProgress({ status: 'processing', progress: 20, message: `Kling 任务已提交 ${klingResult.task_id.slice(0, 8)}...` });

        const klingFinal = await pollProviderTask(
          klingResult.task_id,
          (taskId) => klingApi.queryTask(taskId, klingResult.endpointType),
          (status) => {
            setGenerationProgress({
              status: 'processing',
              progress: status === 'processing' ? 55 : 30,
              message: `Kling: ${status === 'processing' ? '视频生成中...' : '任务排队中...'}`,
            });
          }
        );

        if (klingFinal.status === 'succeed' && klingFinal.video_url) {
          addProviderTokens(`video.${currentProviderId}`, 0);
          await commitGeneratedVideo({
            videoUrl: klingFinal.video_url,
            posterUrl: klingFinal.cover_url || defaultReferencePreview || defaultReferenceImage,
            prompt: apiPrompt,
            inputPrompt: prompt,
            baseRequest: klingBaseRequest,
          });
          setGenerationProgress({ status: 'success', progress: 100, message: '视频生成成功' });
        } else {
          setGenerationProgress({ status: 'error', progress: 0, message: `Kling 生成失败: ${klingFinal.message || klingFinal.status || '未知错误'}` });
        }
      } else if (isMiniMaxH3Provider) {
        // ── MiniMax-H3 (Magine built-in engine or ComfyUI compatibility mode) ──
        const h3Api = createMiniMaxH3VideoAPI(currentVideoProvider);
        const h3Duration = Math.max(5, Math.min(15, baseRequest.duration));
        const h3Ratio = effectiveNodeData.ratio || '16:9';
        const h3Resolution = baseRequest.resolution === '1080P' ? '1080P' : '720P';
        const h3BaseRequest = {
          ...baseRequest,
          duration: h3Duration,
          ratio: h3Ratio,
          resolution: h3Resolution,
        };
        const h3Params: import('../api/MiniMaxH3VideoAPI').MiniMaxH3VideoParams = {
          sourceNodeId: id,
          model: currentModel,
          prompt: apiPrompt,
          duration: h3Duration,
          ratio: h3Ratio,
          resolution: h3Resolution,
        };
        if (isMiniMaxH3Ref2VAModel(currentModel)) {
          h3Params.referenceImages = referenceImages.slice(0, 9);
          h3Params.referenceVideos = referenceVideos.slice(0, 3);
          h3Params.referenceAudios = referenceAudios.slice(0, 3);
        } else if (referenceImages.length > 0) {
          h3Params.referenceImage = referenceImages[0];
          h3Params.endImage = referenceImages[1];
        }
        const h3Result = await h3Api.createTask(h3Params);
        if (!h3Result.task_id) throw new Error('MiniMax-H3: 任务提交失败，未返回 task_id');

        updateNodeData(id, {
          isLoading: true,
          pendingMiniMaxH3Task: {
            taskId: h3Result.task_id,
            prompt: apiPrompt,
            inputPrompt: prompt,
            model: h3BaseRequest.model,
            ratio: h3BaseRequest.ratio,
            resolution: h3BaseRequest.resolution,
            duration: h3BaseRequest.duration,
            posterUrl: defaultReferencePreview || defaultReferenceImage,
            submittedAt: Date.now(),
          },
          generationProgress: {
            status: 'processing',
            progress: 20,
            message: `MiniMax-H3 任务已提交 ${h3Result.task_id.slice(0, 8)}...`,
          },
        } as Partial<VideoNodeData>);
      } else if (isKieGeminiOmniProvider) {
        const kieApi = createKieMarketVideoAPI(currentVideoProvider);
        const geminiSpec = getKieGeminiOmniModelSpec();
        const kieReferenceVideos = await materializeKieMaterialRefsForCloud({
          apiKey: currentVideoProvider.apiKey,
          materials: kieVideoReferenceMaterials,
          kind: 'video',
          max: geminiSpec.maxReferenceVideos,
        });
        const kieReferenceImages = await materializeKieMaterialRefsForCloud({
          apiKey: currentVideoProvider.apiKey,
          materials: kieImageReferenceMaterials,
          kind: 'image',
          max: kieReferenceVideos.length > 0 ? 5 : 7,
        });
        const geminiDuration = normalizeKieGeminiOmniDuration(baseRequest.duration);
        const geminiBaseRequest = {
          ...baseRequest,
          duration: geminiDuration,
        };
        const kieResult = await kieApi.createTask({
          model: currentModel,
          prompt: apiPrompt,
          duration: geminiDuration,
          ratio: baseRequest.ratio,
          referenceImages: kieReferenceImages,
          referenceVideos: kieReferenceVideos,
          referenceAudios,
        });
        if (!kieResult.task_id) throw new Error('Kie Gemini Omni task submit failed: missing task_id');

        setGenerationProgress({ status: 'processing', progress: 20, message: `Kie Gemini Omni task ${kieResult.task_id.slice(0, 8)}...` });

        const kieFinal = await pollProviderTask(
          kieResult.task_id,
          async (taskId) => {
            const result = await kieApi.queryTask(taskId);
            return {
              status: result.status,
              video_url: result.result?.video_url,
              cover_url: result.result?.cover_url,
              message: result.message,
              usage: result.usage,
              progress: result.progress,
            };
          },
          (status, apiProgress) => {
            const progress =
              typeof apiProgress === 'number'
                ? Math.max(20, Math.min(95, apiProgress))
                : status === 'running'
                  ? 55
                  : 30;
            setGenerationProgress({
              status: 'processing',
              progress,
              message:
                typeof apiProgress === 'number'
                  ? `Kie Gemini Omni video generating ${Math.round(apiProgress)}%...`
                  : status === 'running'
                    ? 'Kie Gemini Omni video generating...'
                    : 'Kie Gemini Omni queued...',
            });
          },
          180,
          5000
        );

        if (kieFinal.status === 'succeed' && kieFinal.video_url) {
          const billed = kieFinal.usage?.total_tokens ?? kieFinal.usage?.completion_tokens ?? 0;
          if (billed > 0) {
            addProviderTokens(KIE_GLOBAL_PROVIDER_TOKEN_KEY, billed);
          }
          syncKieCredits();
          await commitGeneratedVideo({
            videoUrl: kieFinal.video_url,
            posterUrl: kieFinal.cover_url || defaultReferencePreview || defaultReferenceImage,
            prompt: apiPrompt,
            inputPrompt: prompt,
            baseRequest: geminiBaseRequest,
            lastGenerationCredits: billed,
          });
          setGenerationProgress({
            status: 'success',
            progress: 100,
            message: billed > 0 ? `Kie Gemini Omni video done - ${billed} credits` : 'Kie Gemini Omni video generated',
          });
        } else {
          setGenerationProgress({ status: 'error', progress: 0, message: `Kie Gemini Omni failed: ${kieFinal.message || kieFinal.status || 'unknown error'}` });
        }
      } else if (isKieVeoProvider) {
        const kieApi = createKieVeoVideoAPI(currentVideoProvider);
        const veoSpec = getKieVeoModelSpec(currentModel);
        const kieReferenceImages = await materializeKieMaterialRefsForCloud({
          apiKey: currentVideoProvider.apiKey,
          materials: kieImageReferenceMaterials,
          kind: 'image',
          max: veoSpec.maxReferenceImages,
        });
        const veoDuration = kieReferenceImages.length > 0
          ? veoSpec.referenceDuration
          : normalizeKieVeoDuration(baseRequest.duration);
        const veoResolution: '1080P' | '4K' = baseRequest.resolution === '4K' ? '4K' : '1080P';
        const veoBaseRequest = {
          ...baseRequest,
          duration: veoDuration,
          resolution: veoResolution,
        };
        const kieResult = await kieApi.createTask({
          model: currentModel,
          prompt: apiPrompt,
          ratio: baseRequest.ratio,
          duration: veoDuration,
          referenceImages: kieReferenceImages,
        });
        if (!kieResult.task_id) throw new Error('Kie Veo task submit failed: missing task_id');

        setGenerationProgress({ status: 'processing', progress: 20, message: `Kie Veo task ${kieResult.task_id.slice(0, 8)}...` });

        const kieFinal = await pollProviderTask(
          kieResult.task_id,
          async (taskId) => {
            const result = await kieApi.queryTask(taskId);
            return {
              status: result.status,
              video_url: result.result?.video_url,
              cover_url: result.result?.cover_url,
              message: result.message,
              usage: result.usage,
              progress: result.progress,
            };
          },
          (status, apiProgress) => {
            const progress =
              typeof apiProgress === 'number'
                ? Math.max(20, Math.min(95, apiProgress))
                : status === 'running'
                  ? 55
                  : 30;
            setGenerationProgress({
              status: 'processing',
              progress,
              message:
                typeof apiProgress === 'number'
                  ? `Kie Veo video generating ${Math.round(apiProgress)}%...`
                  : status === 'running'
                    ? 'Kie Veo video generating...'
                    : 'Kie Veo queued...',
            });
          },
          180,
          5000
        );

        if (kieFinal.status === 'succeed' && kieFinal.video_url) {
          setGenerationProgress({
            status: 'processing',
            progress: 86,
            message: `Veo 基础视频已完成，正在获取 ${veoResolution} 视频...`,
          });
          const upgradeTask = await kieApi.createResolutionTask(kieResult.task_id, veoResolution);
          let deliveryVideoUrl = upgradeTask.result?.video_url || '';
          if (!deliveryVideoUrl) {
            const upgradeFinal = await pollProviderTask(
              upgradeTask.task_id,
              async (taskId) => {
                const result = await kieApi.queryResolutionTask(taskId, veoResolution);
                return {
                  status: result.status,
                  video_url: result.result?.video_url,
                  message: result.message,
                  progress: result.progress,
                };
              },
              () => {
                setGenerationProgress({
                  status: 'processing',
                  progress: veoResolution === '4K' ? 94 : 92,
                  message: `Veo ${veoResolution} 高清处理中...`,
                });
              },
              veoResolution === '4K' ? 60 : 90,
              veoResolution === '4K' ? 30000 : 20000,
            );
            if (upgradeFinal.status !== 'succeed' || !upgradeFinal.video_url) {
              throw new Error(`Kie Veo ${veoResolution} 处理失败: ${upgradeFinal.message || upgradeFinal.status}`);
            }
            deliveryVideoUrl = upgradeFinal.video_url;
          }
          const billed = kieFinal.usage?.total_tokens ?? kieFinal.usage?.completion_tokens ?? 0;
          if (billed > 0) {
            addProviderTokens(KIE_GLOBAL_PROVIDER_TOKEN_KEY, billed);
          }
          syncKieCredits();
          await commitGeneratedVideo({
            videoUrl: deliveryVideoUrl,
            posterUrl: kieFinal.cover_url || defaultReferencePreview || defaultReferenceImage,
            prompt: apiPrompt,
            inputPrompt: prompt,
            baseRequest: veoBaseRequest,
            lastGenerationCredits: billed,
          });
          setGenerationProgress({
            status: 'success',
            progress: 100,
            message: billed > 0 ? `Kie Veo video done - ${billed} credits` : 'Kie Veo video generated',
          });
        } else {
          setGenerationProgress({ status: 'error', progress: 0, message: `Kie Veo failed: ${kieFinal.message || kieFinal.status || 'unknown error'}` });
        }
      } else if (!isBuiltinVideo && currentVideoProvider) {
        // ── 自定义 Provider (OpenAI 兼容异步模式) ──
        const customApi = createCustomVideoAPI(currentVideoProvider);
        const customParams: import('../api/CustomVideoAPI').CustomVideoGenerateParams = {
          model: currentModel,
          prompt: apiPrompt,
          ratio: baseRequest.ratio,
          duration: baseRequest.duration,
          resolution: baseRequest.resolution,
        };
        if (referenceImages.length > 0) {
          customParams.referenceImage = referenceImages[0];
        }
        const customResult = await customApi.createTask(customParams);
        if (!customResult.task_id) throw new Error('自定义服务: 任务提交失败，未返回 task_id');

        const pendingTask: PendingSeedanceTask | undefined = /^seedance/i.test(currentProviderId)
          ? {
              taskId: customResult.task_id,
              providerId: currentProviderId,
              providerMode: 'custom',
              prompt: apiPrompt,
              inputPrompt: prompt,
              model: baseRequest.model,
              ratio: baseRequest.ratio,
              resolution: baseRequest.resolution,
              duration: baseRequest.duration,
              submittedAt: Date.now(),
              hasVideoInput: submittedHasVideoInput,
            }
          : undefined;
        const ownsSeedanceTaskLease = pendingTask
          ? claimSeedanceTaskLease(customResult.task_id)
          : false;
        if (pendingTask) {
          updateNodeData(id, { pendingSeedanceTask: pendingTask } as Partial<VideoNodeData>, { recordUndo: false });
        }

        setGenerationProgress({ status: 'processing', progress: 20, message: `任务已提交 ${customResult.task_id.slice(0, 8)}...` });

        let customFinal: ProviderTaskStatus;
        try {
          customFinal = await pollProviderTask(
            customResult.task_id,
            (taskId) => customApi.queryTask(taskId),
            (status, apiProgress) => {
              if (!componentMountedRef.current) return;
              setGenerationProgress({
                status: 'processing',
                progress: pendingTask
                  ? estimateSeedanceTaskProgress(pendingTask, status, apiProgress)
                  : status === 'processing' ? 55 : 30,
                message: `${status === 'processing' ? '视频生成中...' : '任务排队中...'}`,
              });
            },
            17_280,
            5000,
            () => componentMountedRef.current,
            60,
          );
        } finally {
          if (ownsSeedanceTaskLease) releaseSeedanceTaskLease(customResult.task_id);
        }
        if (customFinal.status === 'paused' || !componentMountedRef.current) return;

        if (customFinal.status === 'succeed' && customFinal.video_url) {
          addProviderTokens(`video.${currentProviderId}`, 0);
          await commitGeneratedVideo({
            taskId: customResult.task_id,
            providerId: currentProviderId,
            videoUrl: customFinal.video_url,
            posterUrl: defaultReferencePreview || defaultReferenceImage,
            prompt: apiPrompt,
            inputPrompt: prompt,
            baseRequest,
          });
          setGenerationProgress({ status: 'success', progress: 100, message: '视频生成成功' });
        } else {
          if (pendingTask) updateNodeData(id, { pendingSeedanceTask: undefined } as Partial<VideoNodeData>, { recordUndo: false });
          setGenerationProgress({ status: 'error', progress: 0, message: `生成失败: ${customFinal.message || customFinal.status || '未知错误'}` });
        }
      } else {
        // ── Seedance / HappyHorse / Veo (VideoAPI) ──
        const api = new VideoAPI(currentVideoProvider.apiKey, currentVideoProvider.apiUrl);
        const isSeedanceApiRequest = /seedance/i.test(`${currentProviderId} ${currentModel}`);
        const apiReferenceImages = isSeedanceApiRequest
          ? await Promise.all(referenceImages.map((url) => materializeSeedanceReference(url, 'image')))
          : referenceImages;
        const apiReferenceVideos = isSeedanceApiRequest
          ? await Promise.all(referenceVideos.map((url) => materializeSeedanceReference(url, 'video')))
          : referenceVideos;
        const apiReferenceAudios = isSeedanceApiRequest
          ? await Promise.all(referenceAudios.map((url) => materializeSeedanceReference(url, 'audio')))
          : referenceAudios;
        const apiDuration = isHappyHorse && happyHorseSpec
          ? Math.max(happyHorseSpec.durationMin, Math.min(happyHorseSpec.durationMax, baseRequest.duration))
          : Math.max(4, Math.min(15, baseRequest.duration));
        const standardApiResolutions: VideoResolution[] = ['480P', '720P', '1080P', '4K'];
        const apiResolution = happyHorseSpec
          ? (happyHorseSpec.resolutions.includes(baseRequest.resolution as VideoResolution)
              ? baseRequest.resolution as VideoResolution
              : happyHorseSpec.resolutions[0])
          : (standardApiResolutions.includes(baseRequest.resolution as VideoResolution)
              ? baseRequest.resolution as VideoResolution
              : '720P');
        const apiBaseRequest = {
          ...baseRequest,
          duration: apiDuration,
          resolution: apiResolution,
        };

        let result;
        try {
          result = await api.generateVideo({
            ...apiBaseRequest,
            duration: apiDuration as VideoDuration,
            prompt: apiPrompt,
            referenceImages: apiReferenceImages,
            referenceVideos: apiReferenceVideos,
            referenceAudios: apiReferenceAudios,
          });
        } catch (error) {
          const shouldRetryAsText =
            isInputImagePrivacyError(error) &&
            hasNonAssetVisualReference(apiReferenceImages, apiReferenceVideos);

          if (!shouldRetryAsText) {
            throw error;
          }

          const fallbackReferences = buildPrivacyFallbackReferences(
            apiReferenceImages,
            apiReferenceVideos,
            apiReferenceAudios
          );
          submittedHasVideoInput = fallbackReferences.referenceVideos.length > 0;
          setGenerationProgress({
            status: 'submitting',
            progress: 12,
            message: 'AI 人像参考被拦截，正在改用文字生成...',
          });
          result = await api.generateVideo({
            ...apiBaseRequest,
            duration: apiDuration as VideoDuration,
            prompt: composePrompt([
              buildPrivacyFallbackPrompt(cleanPrompt, previewMaterials),
              ...previewMaterials.map(getCharacterMaterialPrompt),
            ]),
            referenceImages: fallbackReferences.referenceImages,
            referenceVideos: fallbackReferences.referenceVideos,
            referenceAudios: fallbackReferences.referenceAudios,
          });
        }

        if (result.task_id) {
          const pendingTask: PendingSeedanceTask | undefined = isSeedanceApiRequest
            ? {
                taskId: result.task_id,
                providerId: currentProviderId,
                providerMode: 'official',
                prompt: apiPrompt,
                inputPrompt: prompt,
                model: apiBaseRequest.model,
                ratio: apiBaseRequest.ratio,
                resolution: apiBaseRequest.resolution,
                duration: apiBaseRequest.duration,
                submittedAt: Date.now(),
                hasVideoInput: submittedHasVideoInput,
              }
            : undefined;
          const ownsSeedanceTaskLease = pendingTask
            ? claimSeedanceTaskLease(result.task_id)
            : false;
          if (pendingTask) {
            updateNodeData(id, { pendingSeedanceTask: pendingTask } as Partial<VideoNodeData>, { recordUndo: false });
          }
          setGenerationProgress({
            status: 'processing',
            progress: 20,
            message: `任务已提交 ${result.task_id.slice(0, 8)}...`
          });

          let finalResult: ProviderTaskStatus;
          try {
            finalResult = await pollProviderTask(
              result.task_id,
              async (taskId) => {
                const task = await api.queryTask(taskId);
                return {
                  status: task.status,
                  video_url: task.result?.video_url,
                  cover_url: task.result?.cover_url,
                  message: task.message,
                  usage: task.usage,
                  progress: task.progress,
                };
              },
              (status, apiProgress) => {
                if (!componentMountedRef.current) return;
                const waiting = status === 'queued' || status === 'submitted';
                setGenerationProgress({
                  status: 'processing',
                  progress: pendingTask
                    ? estimateSeedanceTaskProgress(pendingTask, status, apiProgress)
                    : waiting ? 30 : 55,
                  message: waiting ? '任务排队中...' : '视频生成中...',
                });
              },
              17_280,
              5000,
              () => componentMountedRef.current,
              60,
            );
          } finally {
            if (ownsSeedanceTaskLease) releaseSeedanceTaskLease(result.task_id);
          }
          if (finalResult.status === 'paused' || !componentMountedRef.current) return;

          if (finalResult.status === 'succeed' && finalResult.video_url) {
            const billed = finalResult.usage?.total_tokens ?? finalResult.usage?.completion_tokens ?? 0;
            const packageBilled = convertVideoBusinessTokensToPackageTokens({
              businessTokens: billed,
              model: baseRequest.model,
              resolution: baseRequest.resolution,
              hasVideoInput: submittedHasVideoInput,
            });
            if (billed > 0) {
              addUsedTokens('video', packageBilled);
              addProviderTokens('video.seedance-2.0', packageBilled);
            }
            await commitGeneratedVideo({
              taskId: result.task_id,
              providerId: currentProviderId,
              videoUrl: finalResult.video_url,
              posterUrl: finalResult.cover_url || defaultReferencePreview || defaultReferenceImage,
              prompt: apiPrompt,
              inputPrompt: prompt,
              baseRequest: apiBaseRequest,
            });
            setGenerationProgress({
              status: 'success',
              progress: 100,
              message: billed > 0
                ? `完成 · usage ${billed.toLocaleString()} 业务 token · 资源包扣减约 ${packageBilled.toLocaleString()} token`
                : '视频生成成功',
            });
          } else {
            if (pendingTask) updateNodeData(id, { pendingSeedanceTask: undefined } as Partial<VideoNodeData>, { recordUndo: false });
            setGenerationProgress({
              status: 'error',
              progress: 0,
              message: `生成失败: ${finalResult.message || finalResult.status || '未知错误'}`,
            });
          }
        } else {
          setGenerationProgress({ status: 'error', progress: 0, message: '任务提交失败' });
        }
      }
    } catch (error) {
      if (componentMountedRef.current) {
        setGenerationProgress({
          status: 'error',
          progress: 0,
          message: `错误: ${error instanceof Error ? error.message : '未知错误'}`
        });
      }
    } finally {
      if (componentMountedRef.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    if (
      !isMiniMaxH3Provider ||
      (generationProgress.status !== 'submitting' && generationProgress.status !== 'processing')
    ) {
      miniMaxH3SubmitRef.current = false;
    }
  }, [generationProgress.status, isMiniMaxH3Provider]);

  useAgentGenerationBridge(id, handleGenerate, generationProgress);

  const handleDownload = async () => {
    const downloadUrl = playableActiveVideoUrl || activeVideoUrl;
    if (!downloadUrl) return;
    try {
      await saveMediaToDisk(downloadUrl, `video-${Date.now()}.mp4`);
    } catch (error) {
      showDownloadError(error);
    }
  };

  const handleBatchExport = async () => {
    if (isBatchExporting) return;
    setIsBatchExporting(true);
    try {
      const group = collectNodeMediaExportGroup({ id, type: 'video', data: effectiveNodeData });
      if (!group) throw new Error('当前视频节点没有可导出的素材');
      const result = await exportNodeMediaGroups([group], '选择视频节点素材保存位置');
      const message = batchMediaExportMessage(result);
      if (message) window.alert(message);
    } catch (error) {
      showBatchMediaExportError(error);
    } finally {
      setIsBatchExporting(false);
    }
  };

  const handleRemoveSubtitles = async (options: {
    mode: SubtitleRemovalMode;
    region?: SubtitleRemovalRegion;
  }) => {
    const sourceUrl = playableActiveVideoUrl || activeVideoUrl;
    if (!sourceUrl || subtitleRemovalProgress !== null) return;
    setSubtitleRemovalProgress(0);
    const materialNodeId = createSubtitleRemovalMaterialNode({
      sourceNodeId: id,
      sourceHandle: 'video',
      fileName: subtitleRemovalOutputFileName(activeGeneratedVideo?.fileName, 'video'),
      fileType: 'video',
    });
    if (!materialNodeId) {
      setSubtitleRemovalProgress(null);
      return;
    }
    try {
      const result = await removeSubtitlesFromMedia({
        sourceUrl,
        fileName: activeGeneratedVideo?.fileName,
        mediaType: 'video',
        ...options,
      }, (progress) => {
        setSubtitleRemovalProgress(progress.progress);
        updateSubtitleRemovalMaterialProgress(materialNodeId, progress);
      });
      let posterUrl = activeGeneratedPosterUrl;
      try {
        const frame = await captureVideoFrameDataUrl(result.url, 0.5);
        posterUrl = frame.dataUrl;
      } catch {
        // The processed video remains usable even when a poster frame cannot be generated.
      }
      const cached = await persistVideoToMaterialCache(materialNodeId, result.url);
      const posterCacheId = `${materialNodeId}-poster`;
      const posterCached = posterUrl
        ? await persistImageToMaterialCache(posterCacheId, posterUrl)
        : false;
      completeSubtitleRemovalMaterialNode({
        materialNodeId,
        fileUrl: cached ? materialDiskPlayableUrl(materialNodeId, 'video') : result.url,
        thumbnailUrl: posterCached ? materialDiskPlayableUrl(posterCacheId, 'image') : posterUrl,
        fileName: result.fileName,
      });
    } catch (error) {
      failSubtitleRemovalMaterialNode(materialNodeId, error);
      showSubtitleRemovalError(error);
    } finally {
      setSubtitleRemovalProgress(null);
    }
  };

  const handleTrimGeneratedVideo = async (start: number, end: number) => {
    const trimVideo = window.magineDesktop?.materialVideoTrim;
    const sourceUrl = playableActiveVideoUrl || activeVideoUrl;
    if (!sourceUrl) throw new Error('当前视频不可用');
    if (!trimVideo) throw new Error('视频剪辑仅支持桌面客户端');
    const result = await trimVideo({
      sourceUrl,
      fileName: activeGeneratedVideo?.fileName,
      start,
      end,
    });
    await commitGeneratedVideo({
      videoUrl: result.url,
      posterUrl: activeGeneratedPosterUrl,
      prompt: activeGeneratedVideo?.prompt || sanitizedGenerationPrompt,
      inputPrompt: activeGeneratedVideo?.prompt || localPrompt,
      baseRequest: {
        ratio: (activeGeneratedVideo?.ratio as VideoNodeData['ratio']) || effectiveNodeData.ratio || '16:9',
        resolution: (activeGeneratedVideo?.resolution as VideoNodeData['resolution']) || effectiveNodeData.resolution || '720P',
        duration: result.duration || Math.max(1, end - start),
        model: activeGeneratedVideo?.model || currentModel,
      },
    });
    setMediaEditorOpen(false);
  };

  const compactLogoUrl = '/logo-symbol-relief.svg';
  const hasGeneratedVideoPreview = Boolean(activeVideoUrl);
  const activeVideoVersion = activeGeneratedVideo?.id || effectiveNodeData.activeGeneratedVideoId || '';
  const versionedPlayableActiveVideoUrl = withVideoCacheVersion(
    playableActiveVideoUrl || activeVideoUrl,
    activeVideoVersion,
  );
  const compactMediaUrl = hasGeneratedVideoPreview
    ? versionedPlayableActiveVideoUrl || playableActiveVideoUrl || activeVideoUrl
    : compactLogoUrl;
  const compactMediaType = hasGeneratedVideoPreview ? 'video' : 'image';
  const compactMediaKey = hasGeneratedVideoPreview
    ? `${activeGeneratedVideo?.id || 'video'}:${compactMediaUrl}`
    : 'video-logo-placeholder';
  const activeGeneratedPosterSourceUrl =
    activeGeneratedVideo?.posterUrl &&
    activeGeneratedVideo.posterUrl !== defaultReferencePreview &&
    activeGeneratedVideo.posterUrl !== defaultReferenceImage
      ? activeGeneratedVideo.posterUrl
      : undefined;
  const activeGeneratedPosterUrl = activeGeneratedPosterSourceUrl
    ? resolveMaterialPlayableUrl(activeGeneratedPosterSourceUrl, 'image')
    : undefined;
  const activeVideoDragItem: GeneratedVideoItem | null = activeVideoUrl
    ? activeGeneratedVideo || {
        id: 'active-generated-video',
        videoUrl: activeVideoUrl,
        createdAt: 0,
        fileName: makeGeneratedVideoFileName(0),
      }
    : null;
  const videoHoverActions = activeVideoDragItem ? (
    <div className="nodrag nopan absolute bottom-full right-0 z-10 mb-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        draggable
        title="拖入画布节点"
        aria-label="拖入画布节点"
        onDragStart={(event) => handleGeneratedVideoDragStart(event, activeVideoDragItem)}
        onClick={(event) => event.stopPropagation()}
        className="mc-node-frost-surface flex h-7 w-7 cursor-grab items-center justify-center rounded-lg border text-slate-300 transition-colors hover:border-white/25 hover:text-white active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="剪辑视频"
        aria-label="剪辑视频"
        onClick={(event) => {
          event.stopPropagation();
          setMediaEditorOpen(true);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className="mc-node-frost-surface flex h-7 w-7 items-center justify-center rounded-lg border text-slate-300 transition-colors hover:border-white/25 hover:text-white"
      >
        <Scissors className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title={subtitleRemovalProgress === null ? '去字幕' : `去字幕中 ${subtitleRemovalProgress}%`}
        aria-label={subtitleRemovalProgress === null ? '去除视频字幕' : `正在去除视频字幕 ${subtitleRemovalProgress}%`}
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
      <button
        type="button"
        title={isBatchExporting ? '正在批量导出' : '批量导出'}
        aria-label={isBatchExporting ? '正在批量导出视频素材' : '批量导出视频素材'}
        disabled={isBatchExporting}
        onClick={(event) => {
          event.stopPropagation();
          void handleBatchExport();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className="mc-node-frost-surface flex h-7 w-7 items-center justify-center rounded-lg border text-slate-300 transition-colors hover:border-white/25 hover:text-white disabled:cursor-wait disabled:opacity-60"
      >
        {isBatchExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderDown className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        title="下载素材"
        aria-label="下载素材"
        onClick={(event) => {
          event.stopPropagation();
          void handleDownload();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className="mc-node-frost-surface flex h-7 w-7 items-center justify-center rounded-lg border text-slate-300 transition-colors hover:border-white/25 hover:text-white"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    </div>
  ) : null;
  const videoMediaEditor = mediaEditorOpen && activeVideoUrl ? (
    <MaterialMediaEditor
      sourceUrl={playableActiveVideoUrl || activeVideoUrl}
      posterUrl={activeGeneratedPosterUrl}
      fileType="video"
      fileName={activeVideoDragItem?.fileName}
      onClose={() => setMediaEditorOpen(false)}
      onApplyImage={async () => {}}
      onTrimVideo={handleTrimGeneratedVideo}
      onTrimAudio={async () => {}}
      onCaptureFrame={(time) => handleCaptureVideoFrame('free', time)}
    />
  ) : null;
  const subtitleRemovalDialog = subtitleRemovalDialogOpen && activeVideoUrl ? (
    <SubtitleRemovalDialog
      sourceUrl={playableActiveVideoUrl || activeVideoUrl}
      posterUrl={activeGeneratedPosterUrl}
      mediaType="video"
      fileName={activeVideoDragItem?.fileName}
      onClose={() => setSubtitleRemovalDialogOpen(false)}
      onConfirm={(options) => {
        setSubtitleRemovalDialogOpen(false);
        void handleRemoveSubtitles(options);
      }}
    />
  ) : null;
  const handleOpenLargeVideoPreview = (playback: { currentTime: number; wasPlaying: boolean }) => {
    if (!hasGeneratedVideoPreview || !compactMediaUrl) return;
    setLargeVideoPreview({
      url: compactMediaUrl,
      posterUrl: activeGeneratedPosterUrl,
      currentTime: playback.currentTime,
      shouldPlay: playback.wasPlaying,
    });
  };
  const largeVideoPreviewPortal = largeVideoPreview && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="nodrag nopan nowheel fixed inset-0 z-[10040] flex items-center justify-center bg-black/58 p-5 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="视频大屏预览"
          onMouseDown={() => setLargeVideoPreview(null)}
        >
          <div
            className="relative aspect-[2/1] w-[min(82vw,1280px)] max-h-[78vh] overflow-hidden rounded-lg border border-white/18 bg-black shadow-[0_32px_100px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.08)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <CanvasVideoPlayer
              key={largeVideoPreview.url}
              src={largeVideoPreview.url}
              poster={largeVideoPreview.posterUrl}
              autoPlay={largeVideoPreview.shouldPlay}
              initialTime={largeVideoPreview.currentTime}
              size="large"
              videoClassName="object-contain"
              onLargePreview={() => setLargeVideoPreview(null)}
              largePreviewMode="close"
            />
          </div>
        </div>,
        document.body,
      )
    : null;
  const isGenerating = generationProgress.status === 'submitting' || generationProgress.status === 'processing';
  const generationPercent = Math.max(0, Math.min(100, Math.round(generationProgress.progress || 0)));
  const generationTaskSucceeded = Math.max(
    Math.max(0, Math.floor(Number(effectiveNodeData.generationTaskSucceeded) || 0)),
    generatedVideos.length,
  );
  const generationTaskTotal = Math.max(
    Math.max(0, Math.floor(Number(effectiveNodeData.generationTaskTotal) || 0)),
    generationTaskSucceeded + (isGenerating ? 1 : 0),
  );
  const nodeStatusMessage =
    generationProgress.status === 'error' ||
    (generationProgress.status === 'success' && showGenerationSuccessNotice)
      ? generationProgress.message
      : '';
  const nodeStatusTone =
    generationProgress.status === 'error'
      ? 'error'
      : generationProgress.status === 'success'
        ? 'success'
        : 'info';

  const previewFrame = (
    <div className="mc-node-media-frame-anchor mc-node-media-only-anchor relative w-full">
      {videoHoverActions}
      <Handle type="target" position={Position.Left} id="input" className="mc-node-handle mc-node-inner-frame-handle" />
      <CompactNodeFrame
      key={compactMediaKey}
      title={nodeData.label}
      icon={<Video className="h-3 w-3" />}
      mediaUrl={compactMediaUrl}
      posterUrl={activeGeneratedPosterUrl}
      mediaType={compactMediaType}
      text={sanitizedGenerationPrompt}
      badge={`${effectiveNodeData.duration || 5}s`}
      width="w-full"
      frameAspectRatio={videoFrameAspectRatio}
      accent="amber"
      variant="glass-inner"
      isLoading={isGenerating}
      progress={generationPercent}
      etaKey={`video:${effectiveBackend}:${currentProviderId}:${currentModel}`}
      etaSessionKey={`video:${id}`}
      etaBaselineSeconds={isMiniMaxH3Provider ? 1800 : effectiveBackend === 'dreamina-cli' ? 600 : 360}
      taskSummary={{ total: generationTaskTotal, succeeded: generationTaskSucceeded }}
      mediaFit={hasGeneratedVideoPreview ? 'cover' : 'contain'}
      mediaClassName={cn(
        !hasGeneratedVideoPreview && 'mc-node-logo-relief',
        isGenerating && 'mc-node-generating-fade',
      )}
      mediaFrameClassName={cn(isGlowing && !isGenerating && 'mc-node-success-glow')}
      mediaOnly
      statusMessage={nodeStatusMessage}
      statusTone={nodeStatusTone}
        onVideoLargePreview={hasGeneratedVideoPreview ? handleOpenLargeVideoPreview : undefined}
      />
      <Handle type="source" position={Position.Right} id="video" className="mc-node-handle mc-node-inner-frame-handle" />
    </div>
  );
  const showVideoHistoryStrip = generatedVideos.length > 0;
  const videoHistoryStrip = showVideoHistoryStrip ? (
    <div
      className="nodrag nopan nowheel mt-1.5 w-full overflow-x-auto overflow-y-hidden px-1"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex w-max min-w-full items-center gap-1.5">
        {generatedVideos.map((item) => {
          const active = activeGeneratedVideo ? item.id === activeGeneratedVideo.id : isSameGeneratedVideoUrl(item.videoUrl, activeVideoUrl);
          const posterUrl = item.posterUrl
            ? resolveMaterialPlayableUrl(item.posterUrl, 'image')
            : '';
          const posterIsBroken = Boolean(posterUrl && brokenHistoryPosters[item.id] === posterUrl);
          return (
            <div key={item.id} className="group relative h-9 w-12 shrink-0">
              <button
                type="button"
                draggable
                title={item.fileName || 'generated video'}
                onClick={(event) => {
                  event.stopPropagation();
                  handleOpenGeneratedVideo(item);
                }}
                onDragStart={(event) => handleGeneratedVideoDragStart(event, item)}
                className={cn(
                  'relative h-full w-full overflow-hidden rounded-md border bg-black/35 outline-none transition hover:border-white/45 focus:border-white/60',
                  active
                    ? 'border-amber-200/80 shadow-[0_0_12px_rgba(251,191,36,0.34)]'
                    : 'border-white/14'
                )}
              >
                <span className="absolute inset-0 flex items-center justify-center text-zinc-500">
                  <Video className="h-4 w-4" aria-hidden />
                </span>
                {posterUrl && !posterIsBroken && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={posterUrl}
                    alt=""
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    onError={() => {
                      setBrokenHistoryPosters((current) => (
                        current[item.id] === posterUrl
                          ? current
                          : { ...current, [item.id]: posterUrl }
                      ));
                      requestHistoryPosterRepair(item, true);
                    }}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/12">
                  <Play className="h-3.5 w-3.5 fill-white/80 text-white/90" aria-hidden />
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  if (!showSettingsPanel) {
    return (
      <>
        <div className="mc-node-edit-anchor group relative w-[360px] overflow-visible">
          <div>{previewFrame}</div>
          {videoHistoryStrip}
        </div>
        {largeVideoPreviewPortal}
        {videoMediaEditor}
        {subtitleRemovalDialog}
      </>
    );
  }

  return (
    <>
    <div className="mc-node-edit-anchor group relative w-[360px] overflow-visible">
      <div ref={previewFrameRef} className="relative w-[360px] overflow-visible">
        <div>{previewFrame}</div>
        {videoHistoryStrip}
      </div>

      <ScreenSpaceNodePanel
        anchorRef={previewFrameRef}
        className={cn(
          'mc-node-expanded mc-node-edit-panel mc-node-screen-space-panel nodrag nopan nowheel flex flex-col gap-2 overflow-hidden rounded-xl border border-white/22 bg-[#080a0d]/92 p-3 transition-colors mc-dur-12f',
          showSettingsPanel
            ? 'shadow-[0_0_32px_rgba(255,255,255,0.14),0_22px_50px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.2)]'
            : 'border-slate-300/10 hover:border-slate-300/18'
        )}
      >
        <MaterialPreviewStrip materials={previewMaterials} />

        <div data-tutorial-id="video-prompt-input" data-tutorial-node-id={id}>
          <ExpandableTextField
            title="视频提示词"
            value={localPrompt}
            onChange={(next) => updateNodeData(id, { customPrompt: next, promptEdited: true })}
            placeholder="请输入内容"
            materials={previewMaterials}
          >
            <MentionTextarea
              value={localPrompt}
              onChange={(next) => updateNodeData(id, { customPrompt: next, promptEdited: true })}
              materials={previewMaterials}
              placeholder="请输入内容"
              minHeight={previewMaterials.length > 0 ? 'min-h-[108px]' : 'min-h-[166px]'}
              minResizeWidth={620}
              minResizeHeight={previewMaterials.length > 0 ? 108 : 166}
              size={promptBoxSize}
              onSizeChange={(promptBoxSize) => updateNodeData(id, { promptBoxSize })}
              className="mc-node-frost-surface !border-white/10 !text-xs focus:!border-white/40 focus:!shadow-[0_0_12px_rgba(255,255,255,0.12)]"
            />
          </ExpandableTextField>
        </div>

        {activeVideoUrl && (
          <div className="mc-node-frost-strip flex min-h-8 items-center justify-between gap-2 rounded-lg px-2 py-1">
            <span className="min-w-0 truncate text-[10px] text-zinc-500">
              {frameCaptureMessage || '在节点视频上播放/拖动到目标画面后，点击自由截帧'}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
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
                    title={VIDEO_FRAME_CAPTURE_LABELS[mode]}
                    aria-label={VIDEO_FRAME_CAPTURE_LABELS[mode]}
                    onClick={() => void handleCaptureVideoFrame(mode)}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    className="mc-node-frost-surface flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[10px] text-slate-300 transition-colors hover:border-white/25 hover:text-white disabled:cursor-wait disabled:opacity-55"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                    <span>{VIDEO_FRAME_CAPTURE_LABELS[mode]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-auto flex w-full items-center gap-1.5">
          {dreaminaCliConfig.videoEnabled && (
            <div className="min-w-0 flex-1">
              <Select value={effectiveBackend} onValueChange={handleBackendChange} className="h-8 text-[11px]">
                {GENERATION_BACKEND_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </Select>
            </div>
          )}

          {effectiveBackend === 'dreamina-cli' && (
            <div className="min-w-0 flex-1">
              <Select value={effectiveDreaminaCliModel.value} onValueChange={handleDreaminaCliModelChange} className="h-8 text-[11px]">
                {DREAMINA_CLI_VIDEO_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </Select>
            </div>
          )}

          {effectiveBackend === 'dreamina-cli' && (
            <div className="min-w-0 flex-1">
              <Select value={effectiveDreaminaCliVideoMode} onValueChange={handleDreaminaCliVideoModeChange} className="h-8 text-[11px]">
                {DREAMINA_CLI_VIDEO_MODE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </Select>
            </div>
          )}

          {effectiveRatioOptions.length > 0 && (
            <div className="min-w-0 flex-1">
              <Select
                value={effectiveNodeData.ratio || effectiveRatioOptions[0].value}
                onValueChange={handleRatioChange}
                className="h-8 text-[11px]"
              >
                {effectiveRatioOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </Select>
            </div>
          )}

          {(effectiveBackend === 'dreamina-cli' || resolutionOptions.length > 0) && (
            <div className="min-w-0 flex-1">
              <Select value={effectiveNodeData.resolution || '720P'} onValueChange={handleResolutionChange} className="h-8 text-[11px]">
                {(effectiveBackend === 'dreamina-cli' ? dreaminaResolutionOptions : resolutionOptions).map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </Select>
            </div>
          )}

          {effectiveBackend !== 'dreamina-cli' && modeOptions.length > 0 && (
            <div className="min-w-0 flex-1">
              <Select value={effectiveNodeData.mode || modeOptions[0].value} onValueChange={handleModeChange} className="h-8 text-[11px]">
                {modeOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </Select>
            </div>
          )}

          {effectiveDurationOptions.length > 0 && (
            <div className="min-w-0 flex-1">
              <Select value={String(effectiveNodeData.duration || effectiveDurationOptions[0].value)} onValueChange={handleDurationChange} className="h-8 text-[11px]">
                {effectiveDurationOptions.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                ))}
              </Select>
            </div>
          )}

          {effectiveBackend !== 'dreamina-cli' && (
            <>
              <div className="min-w-0 flex-1">
                <Select value={currentProviderId} onValueChange={handleProviderChange} className="h-8 text-[11px]">
                  {providerOptions.length === 0 ? (
                    <SelectItem value="" disabled>????</SelectItem>
                  ) : (
                    providerOptions.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))
                  )}
                </Select>
              </div>
              <div className="min-w-0 flex-1">
                <Select value={currentModel} onValueChange={handleModelChange} className="h-8 text-[11px]">
                  {modelOptions.length === 0 ? (
                    <SelectItem value="" disabled>????</SelectItem>
                  ) : (
                    modelOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))
                  )}
                </Select>
              </div>
            </>
          )}

          {activeVideoUrl && (
            <button
              onClick={handleDownload}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              className="mc-node-frost-surface flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-slate-300 transition-colors hover:border-white/25 hover:text-white"
              title="下载视频"
            >
              <Download className="h-4 w-4" />
            </button>
          )}

          <Button
            data-tutorial-id="video-generate-button"
            data-tutorial-node-id={id}
            onClick={handleGenerate}
            disabled={
              isLoading ||
              isGenerating ||
              !canGenerate ||
              (effectiveBackend === 'dreamina-cli' ? !dreaminaCliConfig.loggedIn : !seedanceGenerateEnabled)
            }
            title="发送生成"
            className="h-9 w-9 shrink-0 rounded-xl border border-white/10 bg-white/12 p-0 text-zinc-100 shadow-none transition-all hover:bg-white/18 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        {effectiveBackend === 'dreamina-cli' ? (
          dreaminaCliConfig.loggedIn ? (
            <DreaminaCliCreditBar
              compact
              credit={{
                ...dreaminaCliCreditSync,
                sessionUsedCredits: dreaminaCliSessionUsedCredits,
              }}
              estimatedCost={dreaminaEstimatedCreditCost}
              modelLabel={`${effectiveDreaminaCliModel.label} · ${effectiveNodeData.resolution || '720P'} · ${effectiveNodeData.duration || 5}秒`}
              onRefresh={() => {
                void dreaminaCliCreditSync.refresh(true);
              }}
            />
          ) : (
            <div className="mc-node-frost-strip flex h-6 items-center rounded-md px-2 text-[10px] text-zinc-400">
              即梦CLI 未登录，无法同步额度
            </div>
          )
        ) : isKieVideoProvider ? (
          <>
          <KieUsageInfo usage={kieVideoUsage} lastCredits={effectiveNodeData.lastGenerationCredits} />
          <div className="hidden mc-node-frost-strip h-6 items-center gap-2 overflow-hidden rounded-md px-2 text-[11px] font-medium text-zinc-300">
            <span className="min-w-0 flex-1 truncate">{kieVideoUsage.currentText}</span>
            <span className="shrink-0">{kieVideoUsage.estimateText}</span>
            <span className="max-w-[260px] shrink-0 truncate text-zinc-100">
              {kieVideoUsage.balanceText} · {kieVideoUsage.usedText}
            </span>
          </div>
          </>
        ) : currentVideoProvider?.apiKey ? (
          <div className="mc-node-frost-strip flex h-6 items-center gap-2 overflow-hidden rounded-md px-2 text-[10px] text-zinc-400">
            <span className="min-w-0 flex-1 truncate">
              当前: {videoTokenEstimate.modelLabel} · {videoTokenEstimate.scenarioLabel} · {videoTokenEstimate.resolutionGroup}
            </span>
            <span className="shrink-0">预计扣减 {videoTokenEstimate.packageTokens.toLocaleString()} token</span>
            <span className="max-w-[150px] shrink-0 truncate">剩余 {remainingDisplay}</span>
          </div>
        ) : null}
      </ScreenSpaceNodePanel>
    </div>
    {largeVideoPreviewPortal}
    {videoMediaEditor}
    {subtitleRemovalDialog}
    </>
  );

}

export default memo(VideoNode);
