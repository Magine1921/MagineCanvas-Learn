'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { CanvasNodeData, useCanvasStore } from '../canvas/CanvasStore';
import { isRemovedProvider, useSeedanceStore } from '../seedance/SeedanceStore';
import {
  ImageAPI,
} from '../api/ImageAPI';
import { createCustomImageAPI } from '../api/CustomImageAPI';
import { createKieMarketImageAPI } from '../api/KieMarketAPI';
import { DreaminaCLIAPI, extractImageUrl, extractImagesFromResult, extractTaskId, isSubmitSuccess, logDreaminaClientTrace } from '../api/DreaminaCLIAPI';
import {
  SeedreamAspectRatio,
  SeedreamResolution,
  getSupportedSeedreamResolutions,
  isSeedreamImageInput,
  isSeedreamTextOnlyModel,
  mapSeedreamToGptImage2Size,
  normalizeSeedreamModel,
  normalizeSeedreamResolution,
  SEEDREAM_RESOLUTION_LABELS,
} from '../api/ImageAPI';
import { getImageModelOptions, resolveProviderForModel, getTokenBucketKey } from '@/lib/model-options';
import { useAgentGenerationBridge } from '@/lib/useAgentGenerationBridge';
import { persistImageToMaterialCache, generatedImageCacheKey } from '@/lib/persist-generated-media';
import { MaterialPreviewStrip } from '../canvas/MaterialPreviewStrip';
import { MentionTextarea, type MentionTextareaSize } from '../canvas/MentionTextarea';
import { ExpandableTextField } from '../canvas/ExpandableTextField';
import { CompactNodeFrame } from '../canvas/CompactNodeFrame';
import { ScreenSpaceNodePanel } from '../canvas/ScreenSpaceNodePanel';
import { MaterialThumbWithHover } from '../canvas/MaterialThumbWithHover';
import { KieUsageInfo } from '../canvas/KieUsageInfo';
import { estimateImageTokens } from '@/lib/ark-token-estimate';
import {
  getMaterialReferenceKind,
  getMaterialReferenceUrl,
  getCharacterMaterialPrompt,
  resolvePromptMaterials,
  stripMaterialMentionTokens,
} from '@/lib/material-mentions';
import { useIncomingMaterialRefs, useIncomingPromptSources } from '../canvas/useCanvasDerivedData';
import { composePrompt, mergeConnectedPromptText } from '@/lib/prompt-flow';
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
import { Button } from '@/components/ui/button';
import { Select, SelectItem } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Image as ImageIcon, Loader2, Download, ArrowRight, Crop, GripVertical, FolderDown, Eraser } from 'lucide-react';
import {
  GENERATED_IMAGE_DND_TYPE,
  makeGeneratedImageFileName,
  type GeneratedImageDragPayload,
} from '@/lib/generated-image-dnd';
import {
  DREAMINA_CLI_IMAGE_MODELS,
  DREAMINA_CLI_IMAGE_RATIO_OPTIONS,
  DREAMINA_CLI_IMAGE_RESOLUTION_LABELS,
  getDreaminaCliImageModel,
  getDreaminaCliImageCreditCost,
  normalizeDreaminaCliImageResolution,
  dreaminaCliResolutionToSeedream,
  type DreaminaCliImageResolution,
} from '@/lib/dreamina-cli-options';
import { extractDreaminaCreditCount } from '@/lib/dreamina-cli-credits';
import { useDreaminaCliCreditSync } from '@/lib/use-dreamina-cli-credits';
import { DreaminaCliCreditBar } from '../seedance/DreaminaCliCreditBar';
import {
  buildKieUsageDisplay,
  fetchKieCredits,
  getKieProviderTokenBucket,
  isKieProvider,
  KIE_GLOBAL_PROVIDER_TOKEN_KEY,
} from '@/lib/kie-usage-display';
import { materializeKieMaterialRefsForCloud } from '@/lib/kie-reference-upload-client';
import { materialDiskPlayableUrl } from '@/lib/material-disk-playable-url';
import {
  MaterialMediaEditor,
  type MaterialImageEditResult,
} from './MaterialMediaEditor';

interface GeneratedImageItem {
  id: string;
  imageUrl: string;
  thumbnailUrl?: string;
  createdAt: number;
  fileName?: string;
  prompt?: string;
  size?: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  providerId?: string;
  generationBackend?: ImageNodeData['generationBackend'];
  dreaminaCliModel?: string;
  dreaminaCliResolution?: DreaminaCliImageResolution;
}

interface ImageNodeData extends CanvasNodeData {
  prompt?: string;
  customPrompt?: string;
  promptEdited?: boolean;
  imageUrl?: string;
  promptBoxSize?: MentionTextareaSize;
  aspectRatio?: SeedreamAspectRatio;
  imageResolution?: SeedreamResolution;
  model?: string;
  providerId?: string;
  status?: string;
  generatedImages?: GeneratedImageItem[];
  activeGeneratedImageId?: string;
  lastGenerationCredits?: number;
  generationBackend?: 'api' | 'dreamina-cli';
  dreaminaCliModel?: string;
  dreaminaCliResolution?: DreaminaCliImageResolution;
}

interface GenerationProgress {
  status: 'idle' | 'submitting' | 'processing' | 'success' | 'error';
  progress: number; // 0-100
  message: string;
}

const GENERATION_BACKEND_OPTIONS = [
  { value: 'api', label: 'API' },
  { value: 'dreamina-cli', label: '即梦CLI' },
];

const RATIO_OPTIONS = [
  { value: '16:9', label: '16:9', desc: '横屏' },
  { value: '9:16', label: '9:16', desc: '竖屏' },
  { value: '4:3', label: '4:3', desc: '标准' },
  { value: '3:4', label: '3:4', desc: '人像' },
  { value: '1:1', label: '1:1', desc: '方形' },
  { value: '3:2', label: '3:2', desc: '横构图' },
  { value: '2:3', label: '2:3', desc: '竖构图' },
  { value: '21:9', label: '21:9', desc: '宽银幕' },
];

function isGeneratedImageItem(value: unknown): value is GeneratedImageItem {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<GeneratedImageItem>;
  return typeof record.imageUrl === 'string' && record.imageUrl.length > 0;
}

function getGeneratedImages(data: ImageNodeData): GeneratedImageItem[] {
  const map = new Map<string, GeneratedImageItem>();
  const rawItems = Array.isArray(data.generatedImages) ? data.generatedImages : [];

  for (const item of rawItems) {
    if (!isGeneratedImageItem(item)) continue;
    const itemId = item.id || `generated-${map.size}`;
    map.set(itemId || item.imageUrl, {
      ...item,
      id: itemId,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
    });
  }

  if (data.imageUrl && !Array.from(map.values()).some((item) => item.imageUrl === data.imageUrl)) {
    map.set(data.imageUrl, {
      id: 'legacy-current-image',
      imageUrl: data.imageUrl,
      createdAt: 0,
      fileName: makeGeneratedImageFileName(0),
    });
  }

  return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
}

function buildGeneratedImageItems(params: {
  images: Array<{ image_url: string; size?: string }>;
  prompt: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  providerId?: string;
  generationBackend?: ImageNodeData['generationBackend'];
  dreaminaCliModel?: string;
  dreaminaCliResolution?: DreaminaCliImageResolution;
}): GeneratedImageItem[] {
  const now = Date.now();
  return params.images.map((image, index) => {
    const createdAt = now + index;
    return {
      id: `generated-${createdAt}-${index}`,
      imageUrl: image.image_url,
      createdAt,
      fileName: makeGeneratedImageFileName(createdAt),
      prompt: params.prompt,
      size: image.size,
      model: params.model,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      providerId: params.providerId,
      generationBackend: params.generationBackend,
      dreaminaCliModel: params.dreaminaCliModel,
      dreaminaCliResolution: params.dreaminaCliResolution,
    };
  });
}

function ratioToCssAspect(value?: string): string | undefined {
  if (!value) return undefined;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return `${width} / ${height}`;
}

interface ImagePreviewMeta {
  thumbnailUrl: string;
  size?: string;
}

async function makeImagePreviewMeta(sourceUrl: string, maxSize = 520): Promise<ImagePreviewMeta> {
  if (!sourceUrl) return { thumbnailUrl: '' };

  return new Promise((resolve) => {
    const img = new Image();
    if (/^https?:\/\//i.test(sourceUrl)) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      const naturalWidth = img.naturalWidth || img.width;
      const naturalHeight = img.naturalHeight || img.height;
      const size =
        naturalWidth > 0 && naturalHeight > 0
          ? `${Math.round(naturalWidth)}x${Math.round(naturalHeight)}`
          : undefined;
      try {
        const longestSide = Math.max(naturalWidth, naturalHeight);
        const scale = Math.min(1, maxSize / Math.max(1, longestSide));
        const width = Math.max(1, Math.round(naturalWidth * scale));
        const height = Math.max(1, Math.round(naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ thumbnailUrl: sourceUrl, size });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve({ thumbnailUrl: canvas.toDataURL('image/jpeg', 0.78), size });
      } catch {
        resolve({ thumbnailUrl: sourceUrl, size });
      }
    };

    img.onerror = () => resolve({ thumbnailUrl: sourceUrl });
    img.src = sourceUrl;
  });
}

function ImageNode({ id, data }: NodeProps<CanvasNodeData>) {
  const nodeData = data as ImageNodeData;
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const dreaminaCliSubmitRef = useRef(false);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);

  const isLoading = nodeData.isLoading === true;
  const generationProgress: GenerationProgress =
    typeof nodeData.generationProgress === 'object' && nodeData.generationProgress
      ? nodeData.generationProgress as GenerationProgress
      : { status: 'idle' as const, progress: 0, message: '等待生成...' };

  const setIsLoading = (v: boolean) => updateNodeData(id, { isLoading: v } as Partial<ImageNodeData>);
  const setGenerationProgress = (v: GenerationProgress) => {
    const currentNode = useCanvasStore.getState().nodes.find((node) => node.id === id);
    const currentData = currentNode?.data as ImageNodeData | undefined;
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
    updateNodeData(id, { generationProgress: { ...v, progress } } as Partial<ImageNodeData>);
  };
  const isExpanded = useCanvasStore((state) => state.selectedNode?.id === id);
  const showSettingsPanel = isExpanded;
  const isGlowing = useCanvasStore((state) => state.glowingNodeIds.includes(id));
  const addGlowingNode = useCanvasStore((state) => state.addGlowingNode);
  const clearGlowingNode = useCanvasStore((state) => state.clearGlowingNode);
  const [largeImagePreviewUrl, setLargeImagePreviewUrl] = useState('');
  const [mediaEditorOpen, setMediaEditorOpen] = useState(false);
  const [isBatchExporting, setIsBatchExporting] = useState(false);
  const [subtitleRemovalProgress, setSubtitleRemovalProgress] = useState<number | null>(null);
  const [subtitleRemovalDialogOpen, setSubtitleRemovalDialogOpen] = useState(false);

  useEffect(() => {
    if (!largeImagePreviewUrl) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLargeImagePreviewUrl('');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [largeImagePreviewUrl]);

  // Clear glow when user clicks the node to view it
  useEffect(() => {
    if (showSettingsPanel && isGlowing) {
      clearGlowingNode(id);
    }
  }, [showSettingsPanel, isGlowing, id, clearGlowingNode]);

  const connectedMaterials = useIncomingMaterialRefs(id);
  const {
    imageCategoryConfig,
    imageTokenConfig,
    dreaminaCliConfig,
    imageApiConfig,
    addUsedTokens,
    addProviderTokens,
    setProviderRemainingTokens,
    dreaminaCliSessionUsedCredits,
    applyDreaminaCliCreditSpend,
  } = useSeedanceStore(useShallow((state) => ({
    imageCategoryConfig: state.config.image,
    imageTokenConfig: state.tokenConfig.image,
    dreaminaCliConfig: state.config.dreaminaCli,
    imageApiConfig: state.config.imageApi,
    addUsedTokens: state.addUsedTokens,
    addProviderTokens: state.addProviderTokens,
    setProviderRemainingTokens: state.setProviderRemainingTokens,
    dreaminaCliSessionUsedCredits: state.dreaminaCliSessionUsedCredits,
    applyDreaminaCliCreditSpend: state.applyDreaminaCliCreditSpend,
  })));

  const effectiveNodeData = nodeData;

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

  const previewMaterials = connectedMaterials;

  const providerOptions = useMemo(() => {
    const all = { ...imageCategoryConfig.providers, ...imageCategoryConfig.customProviders };
    return Object.entries(all)
      .filter(([id]) => !isRemovedProvider('image', id))
      .filter(([, p]) => p.enabled && p.apiKey.trim())
      .map(([id, p]) => ({ value: id, label: p.label, models: p.models }));
  }, [imageCategoryConfig]);

  const imageModelOptions = useMemo(() => getImageModelOptions(imageCategoryConfig), [imageCategoryConfig]);

  const currentProviderId = useMemo(() => {
    if (effectiveNodeData.providerId && providerOptions.some((p) => p.value === effectiveNodeData.providerId)) {
      return effectiveNodeData.providerId;
    }
    if (effectiveNodeData.model) {
      const pid = resolveProviderForModel(imageCategoryConfig, effectiveNodeData.model, '', 'image');
      if (pid && providerOptions.some((p) => p.value === pid)) return pid;
    }
    return providerOptions[0]?.value || '';
  }, [effectiveNodeData.providerId, effectiveNodeData.model, providerOptions, imageCategoryConfig]);

  const currentImageProvider = useMemo(() => {
    const all = { ...imageCategoryConfig.providers, ...imageCategoryConfig.customProviders };
    return all[currentProviderId] || null;
  }, [imageCategoryConfig, currentProviderId]);

  const modelOptions = useMemo(() => {
    const provider = providerOptions.find((p) => p.value === currentProviderId);
    if (!provider) return imageModelOptions;
    return provider.models.map((model) => ({
      value: model,
      label: model,
      providerId: currentProviderId,
    }));
  }, [providerOptions, currentProviderId, imageModelOptions]);

  const currentModel = useMemo(() => {
    if (effectiveNodeData.model && modelOptions.some((m) => m.value === effectiveNodeData.model)) {
      return effectiveNodeData.model;
    }
    const normalized = normalizeSeedreamModel(effectiveNodeData.model);
    if (normalized && modelOptions.some((m) => m.value === normalized)) return normalized;
    return modelOptions[0]?.value || 'seedream-4.5';
  }, [effectiveNodeData.model, modelOptions]);

  const selectedResolution = useMemo(
    () => normalizeSeedreamResolution(currentModel, effectiveNodeData.imageResolution),
    [currentModel, effectiveNodeData.imageResolution]
  );
  const resolutionOptions = useMemo(
    () => getSupportedSeedreamResolutions(currentModel),
    [currentModel]
  );
  const generatedImages = useMemo(
    () => getGeneratedImages(effectiveNodeData),
    [effectiveNodeData]
  );
  const selectedGeneratedImage = useMemo(
    () =>
      effectiveNodeData.activeGeneratedImageId
        ? generatedImages.find((item) => item.id === effectiveNodeData.activeGeneratedImageId) || null
        : null,
    [effectiveNodeData.activeGeneratedImageId, generatedImages]
  );
  const activeImageUrl = selectedGeneratedImage?.imageUrl || effectiveNodeData.imageUrl || generatedImages[0]?.imageUrl || '';
  const activeGeneratedImage = useMemo(
    () =>
      selectedGeneratedImage ||
      generatedImages.find((item) => item.imageUrl === activeImageUrl) ||
      (activeImageUrl
        ? {
            id: 'active-generated-image',
            imageUrl: activeImageUrl,
            createdAt: 0,
            fileName: makeGeneratedImageFileName(0),
          }
        : null),
    [activeImageUrl, generatedImages, selectedGeneratedImage]
  );
  const thumbnailImages = useMemo(
    () =>
      generatedImages.filter(
        (item) => item.id !== activeGeneratedImage?.id && item.imageUrl !== activeImageUrl
      ),
    [activeGeneratedImage?.id, activeImageUrl, generatedImages]
  );

  const estimatedTokens = useMemo(
    () => estimateImageTokens(currentModel, selectedResolution),
    [currentModel, selectedResolution]
  );

  const imageRemainingTokens =
    imageTokenConfig.arkRemainingTokens == null
      ? null
      : Math.max(0, imageTokenConfig.arkRemainingTokens - imageTokenConfig.usedTokens);
  const estimatedRemainingImages =
    imageRemainingTokens == null ? null : Math.floor(imageRemainingTokens / Math.max(1, estimatedTokens));

  const remainingDisplay =
    imageRemainingTokens == null
      ? '请在侧栏设置中填写图片 API 剩余 token'
      : `${imageRemainingTokens.toLocaleString()} token`;
  const isKieImageProvider = isKieProvider(currentImageProvider, currentProviderId);
  const kieImageTokenBucket = useSeedanceStore((state) =>
    getKieProviderTokenBucket(state.config.providerTokens, `image.${currentProviderId}`)
  );
  const kieImageUsage = useMemo(
    () =>
      buildKieUsageDisplay({
        kind: 'image',
        providerId: currentProviderId,
        provider: currentImageProvider,
        bucket: kieImageTokenBucket,
        model: currentModel,
        resolution: SEEDREAM_RESOLUTION_LABELS[selectedResolution] || selectedResolution,
        hasInput: previewMaterials.length > 0,
      }),
    [currentImageProvider, currentModel, currentProviderId, kieImageTokenBucket, previewMaterials.length, selectedResolution]
  );
  const syncKieCredits = () => {
    if (!isKieImageProvider) return;
    void fetchKieCredits(currentImageProvider)
      .then((credits) => {
        if (credits != null) setProviderRemainingTokens(KIE_GLOBAL_PROVIDER_TOKEN_KEY, credits);
      })
      .catch(() => undefined);
  };

  const handleRatioChange = (value: string | null) => {
    if (value) {
      updateNodeData(id, { aspectRatio: value as ImageNodeData['aspectRatio'] });
    }
  };

  const handleProviderChange = (value: string | null) => {
    if (!value) return;
    const provider = providerOptions.find((p) => p.value === value);
    const firstModel = provider?.models[0] || '';
    updateNodeData(id, { providerId: value, model: firstModel });
  };

  const handleModelChange = (value: string | null) => {
    if (value) {
      const nextModel = modelOptions.some((m) => m.value === value)
        ? value
        : normalizeSeedreamModel(value);
      updateNodeData(id, {
        model: nextModel,
        imageResolution: normalizeSeedreamResolution(nextModel, selectedResolution),
      });
    }
  };

  const handleResolutionChange = (value: string | null) => {
    if (value) {
      updateNodeData(id, {
        imageResolution: normalizeSeedreamResolution(currentModel, value),
      });
    }
  };

  const effectiveBackend: 'api' | 'dreamina-cli' =
    effectiveNodeData.generationBackend === 'dreamina-cli' && dreaminaCliConfig.imageEnabled
      ? 'dreamina-cli'
      : 'api';

  const effectiveDreaminaCliModel = getDreaminaCliImageModel(effectiveNodeData.dreaminaCliModel);
  const selectedDreaminaCliResolution = normalizeDreaminaCliImageResolution(
    effectiveDreaminaCliModel.value,
    effectiveNodeData.dreaminaCliResolution,
  );
  const dreaminaCliResolutionOptions = useMemo(
    () => [...effectiveDreaminaCliModel.resolutions],
    [effectiveDreaminaCliModel],
  );
  const dreaminaCliCreditSync = useDreaminaCliCreditSync(effectiveBackend === 'dreamina-cli');
  const dreaminaEstimatedCreditCost = useMemo(
    () => getDreaminaCliImageCreditCost(effectiveDreaminaCliModel.value, selectedDreaminaCliResolution),
    [effectiveDreaminaCliModel.value, selectedDreaminaCliResolution],
  );

  const recordDreaminaCreditSpend = async (result: Record<string, unknown>) => {
    const spent = extractDreaminaCreditCount(result) ?? dreaminaEstimatedCreditCost;
    applyDreaminaCliCreditSpend(spent);
    await dreaminaCliCreditSync.refresh(true);
  };

  const handleDreaminaCliModelChange = (value: string | null) => {
    if (!value || !DREAMINA_CLI_IMAGE_MODELS.some((m) => m.value === value)) return;
    updateNodeData(id, {
      dreaminaCliModel: value,
      dreaminaCliResolution: normalizeDreaminaCliImageResolution(
        value,
        effectiveNodeData.dreaminaCliResolution,
      ),
    });
  };

  const handleDreaminaCliResolutionChange = (value: string | null) => {
    if (!value) return;
    updateNodeData(id, {
      dreaminaCliResolution: normalizeDreaminaCliImageResolution(
        effectiveDreaminaCliModel.value,
        value,
      ),
    });
  };

  const handleBackendChange = (value: string | null) => {
    if (value === 'api' || value === 'dreamina-cli') {
      const patch: Partial<ImageNodeData> = {
        generationBackend: value as ImageNodeData['generationBackend'],
      };
      if (value === 'dreamina-cli') {
        patch.dreaminaCliModel = effectiveDreaminaCliModel.value;
        patch.dreaminaCliResolution = selectedDreaminaCliResolution;
      }
      updateNodeData(id, patch);
    }
  };

  const handleGeneratedImageDragStart = (
    event: React.DragEvent<HTMLElement>,
    item: GeneratedImageItem
  ) => {
    event.stopPropagation();
    const payload: GeneratedImageDragPayload = {
      imageUrl: item.imageUrl,
      thumbnailUrl: item.thumbnailUrl,
      fileName: item.fileName || makeGeneratedImageFileName(item.createdAt),
      prompt: item.prompt,
    };
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(GENERATED_IMAGE_DND_TYPE, JSON.stringify(payload));
    event.dataTransfer.setData('text/uri-list', item.imageUrl);
  };

  const handleOpenGeneratedImage = (item: GeneratedImageItem) => {
    updateNodeData(id, {
      imageUrl: item.imageUrl,
      activeGeneratedImageId: item.id,
      ...(item.prompt !== undefined ? { customPrompt: item.prompt, promptEdited: true } : {}),
      ...(item.model ? { model: item.model } : {}),
      ...(item.providerId ? { providerId: item.providerId } : {}),
      ...(item.aspectRatio ? { aspectRatio: item.aspectRatio as ImageNodeData['aspectRatio'] } : {}),
      ...(item.resolution ? { imageResolution: item.resolution as SeedreamResolution } : {}),
      ...(item.generationBackend ? { generationBackend: item.generationBackend } : {}),
      ...(item.dreaminaCliModel ? { dreaminaCliModel: item.dreaminaCliModel } : {}),
      ...(item.dreaminaCliResolution ? { dreaminaCliResolution: item.dreaminaCliResolution } : {}),
    });
  };

  const commitGeneratedImages = async (params: {
    images: Array<{ image_url: string; size?: string }>;
    prompt: string;
    inputPrompt?: string;
    model: string;
    imageResolution: SeedreamResolution;
    lastGenerationCredits?: number;
  }) => {
    const rawNextImages = buildGeneratedImageItems({
      images: params.images,
      prompt: params.prompt,
      model: params.model,
      aspectRatio: effectiveNodeData.aspectRatio || '16:9',
      resolution: params.imageResolution,
      providerId: currentProviderId,
      generationBackend: effectiveBackend,
      dreaminaCliModel: effectiveBackend === 'dreamina-cli' ? effectiveDreaminaCliModel.value : undefined,
      dreaminaCliResolution: effectiveBackend === 'dreamina-cli' ? selectedDreaminaCliResolution : undefined,
    });
    rawNextImages.forEach((item) => {
      item.prompt = params.inputPrompt ?? params.prompt;
    });
    const nextImages = await Promise.all(
      rawNextImages.map(async (item) => {
        const previewMeta = await makeImagePreviewMeta(item.imageUrl);
        return {
          ...item,
          thumbnailUrl: previewMeta.thumbnailUrl,
          size: item.size || previewMeta.size,
        };
      })
    );
    const nextActiveImage = nextImages[0];
    if (!nextActiveImage) return;

    const seen = new Set(nextImages.map((item) => item.imageUrl));
    const retainedImages = generatedImages.filter((item) => !seen.has(item.imageUrl));
    updateNodeData(id, {
      imageUrl: nextActiveImage.imageUrl,
      activeGeneratedImageId: nextActiveImage.id,
      generatedImages: [...nextImages, ...retainedImages].slice(0, 50),
      model: params.model,
      imageResolution: params.imageResolution,
      lastGenerationCredits: params.lastGenerationCredits,
      isLoading: false,
      status: 'success',
      generationProgress: { status: 'success', progress: 100, message: '图像生成完成' },
    });
    addGlowingNode(id);
    // Fire-and-forget: persist to disk cache for browser refresh survival
    await Promise.all([
      persistImageToMaterialCache(id, nextActiveImage.imageUrl),
      ...nextImages.map((item, i) => persistImageToMaterialCache(generatedImageCacheKey(id, i), item.imageUrl)),
    ]);
  };

  const handleDreaminaCliGenerate = async () => {
    let succeeded = false;
    const prompt = localPrompt;

    if (!dreaminaCliConfig.loggedIn) {
      setGenerationProgress({ status: 'error', progress: 0, message: '即梦CLI 未登录，请在 API 配置中检测登录状态' });
      return;
    }
    if (!prompt) {
      setGenerationProgress({ status: 'error', progress: 0, message: '请连接提示词节点' });
      return;
    }

    if (dreaminaCliSubmitRef.current) return;
    dreaminaCliSubmitRef.current = true;
    setIsLoading(true);
    setGenerationProgress({ status: 'submitting', progress: 10, message: '即梦CLI: 正在提交任务...' });

    try {
      const cli = new DreaminaCLIAPI(dreaminaCliConfig);
      const connectedMaterialSlugs = new Set(previewMaterials.map((m) => m.slug));
      const { cleanPrompt: resolvedCleanPrompt } = resolvePromptMaterials(prompt, previewMaterials);
      const cleanPrompt = stripMaterialMentionTokens(resolvedCleanPrompt, connectedMaterialSlugs);
      const referenceImages = Array.from(
        new Set(
          previewMaterials
            .filter((material) => getMaterialReferenceKind(material) === 'image')
            .map((material) => material.fileUrl || getMaterialReferenceUrl(material))
            .filter((url): url is string => Boolean(url && !/^asset:\/\//i.test(url)))
        )
      ).slice(0, 14);
      const cliPrompt = composePrompt([
        cleanPrompt || '图像生成',
        ...previewMaterials.map(getCharacterMaterialPrompt),
      ]);

      const cliModel = effectiveDreaminaCliModel.value;
      const cliResolution = selectedDreaminaCliResolution;
      const storedResolution = dreaminaCliResolutionToSeedream(cliResolution);

      const result = referenceImages.length > 0
        ? await cli.image2image({
            prompt: cliPrompt,
            images: referenceImages,
            ratio: effectiveNodeData.aspectRatio || '16:9',
            resolution_type: cliResolution,
            model_version: cliModel,
          })
        : await cli.text2image({
            prompt: cliPrompt,
            ratio: effectiveNodeData.aspectRatio || '16:9',
            resolution_type: cliResolution,
            model_version: cliModel,
          });

      // Check for sync result (image_url returned immediately by CLI)
      const syncImage = extractImageUrl(result);
      if (syncImage) {
        succeeded = true;
        await commitGeneratedImages({
          images: [{ image_url: syncImage }],
          prompt: cliPrompt,
          inputPrompt: prompt,
          model: `dreamina-${cliModel}`,
          imageResolution: storedResolution,
        });
        await recordDreaminaCreditSpend(result);
        setGenerationProgress({ status: 'success', progress: 100, message: '即梦CLI: 图像生成成功' });
        setIsLoading(false);
        setTimeout(() => { setGenerationProgress({ status: 'idle', progress: 0, message: '等待生成...' }); }, 3000);
        return;
      }

      // Check for images array
      const syncImagesArr = extractImagesFromResult(result);
      if (syncImagesArr.length > 0) {
        succeeded = true;
        await commitGeneratedImages({
          images: syncImagesArr,
          prompt: cliPrompt,
          inputPrompt: prompt,
          model: `dreamina-${cliModel}`,
          imageResolution: storedResolution,
        });
        await recordDreaminaCreditSpend(result);
        setGenerationProgress({ status: 'success', progress: 100, message: `即梦CLI: ${syncImagesArr.length} 张图生成成功` });
        setIsLoading(false);
        setTimeout(() => { setGenerationProgress({ status: 'idle', progress: 0, message: '等待生成...' }); }, 3000);
        return;
      }

      // Validate async submission per CLI docs (SKILL.md)
      const submitCheck = isSubmitSuccess(result);
      if (!submitCheck.ok) {
        setGenerationProgress({ status: 'error', progress: 0, message: submitCheck.reason || '任务提交失败' });
        setIsLoading(false);
        return;
      }

      const taskId = submitCheck.taskId!;
      setGenerationProgress({ status: 'processing', progress: 20, message: `即梦CLI: 任务已提交 ${taskId.slice(0, 8)}...` });

      const finalResult = await cli.pollUntilComplete(
        taskId,
        (status) => {
          const queueMatch = status.match(/队列 #(\d+)\/(\d+)/);
          const waitMatch = status.match(/等待素材地址\s+(\d+)\/(\d+)/);
          let progress = 60;
          let message = `即梦CLI: ${status}`;
          if (queueMatch) {
            progress = 35;
            message = `排队中 #${queueMatch[1]}/${queueMatch[2]}`;
          } else if (waitMatch) {
            progress = 90;
            message = `正在保存素材 ${waitMatch[1]}/${waitMatch[2]}`;
          } else if (status.includes('已出队列')) {
            progress = 75;
            message = '已出队列，正在生成图像...';
          } else if (status.includes('querying')) {
            progress = 45;
          }
          setGenerationProgress({
            status: 'processing',
            progress,
            message,
          });
        },
        undefined, undefined, id,
        (pollResult) => extractImagesFromResult(pollResult).length > 0,
      );

      const finalImages = extractImagesFromResult(finalResult);
      if (finalImages.length > 0) {
        succeeded = true;
        await commitGeneratedImages({
          images: finalImages,
          prompt: cliPrompt,
          inputPrompt: prompt,
          model: `dreamina-${cliModel}`,
          imageResolution: storedResolution,
        });
        await recordDreaminaCreditSpend(finalResult);
        setGenerationProgress({ status: 'success', progress: 100, message: '即梦CLI: 图像生成成功' });
      } else if (finalResult.images && finalResult.images.length > 0) {
        succeeded = true;
        await commitGeneratedImages({
          images: finalResult.images,
          prompt: cliPrompt,
          inputPrompt: prompt,
          model: `dreamina-${cliModel}`,
          imageResolution: storedResolution,
        });
        await recordDreaminaCreditSpend(finalResult);
        setGenerationProgress({ status: 'success', progress: 100, message: `即梦CLI: ${finalResult.images.length} 张图生成成功` });
      } else {
        logDreaminaClientTrace('image-node-no-result', {
          nodeId: id,
          finalResult,
          prompt: cliPrompt,
          model: cliModel,
          resolution: cliResolution,
        });
        setGenerationProgress({ status: 'error', progress: 0, message: `生成失败: ${finalResult.fail_reason || '未返回图片'}` });
      }
    } catch (error) {
      logDreaminaClientTrace('image-node-error', {
        nodeId: id,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
        prompt,
        backend: effectiveBackend,
      });
      setGenerationProgress({ status: 'error', progress: 0, message: `即梦CLI 错误: ${error instanceof Error ? error.message : '未知错误'}` });
    } finally {
      dreaminaCliSubmitRef.current = false;
      setIsLoading(false);
      if (succeeded) {
        setTimeout(() => { setGenerationProgress({ status: 'idle', progress: 0, message: '等待生成...' }); }, 3000);
      }
    }
  };

  const handleGenerate = async () => {
    if (effectiveBackend === 'dreamina-cli') {
      return handleDreaminaCliGenerate();
    }

    let succeeded = false;
    if (!currentImageProvider?.apiKey) {
      setGenerationProgress({
        status: 'error',
        progress: 0,
        message: '请先配置 API Key'
      });
      return;
    }

    const prompt = localPrompt;
    if (!prompt) {
      setGenerationProgress({
        status: 'error',
        progress: 0,
        message: '请连接提示词节点'
      });
      return;
    }

    try {
      // ── 根据 provider 分发 ──
      const isSeedream = currentProviderId === 'seedream';
      const isGptImage2 = currentProviderId === 'gpt-image-2';

      const api = isSeedream || isGptImage2
        ? new ImageAPI(currentImageProvider.apiKey, currentImageProvider.apiUrl, {
            provider: isSeedream ? 'seedream' : 'gpt-image-2',
          })
        : null;
      const model = currentModel;
      const imageResolution = selectedResolution;
      const connectedMaterialSlugs = new Set(previewMaterials.map((material) => material.slug));
      const { cleanPrompt: resolvedCleanPrompt } = resolvePromptMaterials(prompt, previewMaterials);
      const cleanPrompt = stripMaterialMentionTokens(resolvedCleanPrompt, connectedMaterialSlugs);
      const rawReferenceImageMaterials = previewMaterials
        .filter((material) => getMaterialReferenceKind(material) === 'image')
        .slice(0, 14);
      const rawReferenceImages = Array.from(
        new Set(
          rawReferenceImageMaterials
            .map((material) =>
              material.fileUrl && isSeedreamImageInput(material.fileUrl)
                ? material.fileUrl
                : getMaterialReferenceUrl(material)
            )
            .filter(Boolean)
        )
      ).slice(0, 14);
      const referenceImages = rawReferenceImages.filter(isSeedreamImageInput).slice(0, 14);
      const referencesWillBeIgnored =
        isSeedreamTextOnlyModel(model) && referenceImages.length > 0;
      const apiPrompt =
        composePrompt([
          cleanPrompt ||
            (referenceImages.length > 0 ? '结合参考图生成画面' : '') ||
            '图像生成',
          ...previewMaterials.map(getCharacterMaterialPrompt),
        ]);

      setIsLoading(true);
      setGenerationProgress({
        status: 'submitting',
        progress: 10,
        message: referencesWillBeIgnored
          ? 'Seedream 3.0 是文生图模型，本次不会传入参考图'
          : referenceImages.length > 0
            ? `正在提交 ${imageResolution} 图片，包含 ${referenceImages.length} 张参考图...`
            : `正在提交 ${imageResolution} 图片...`,
      });

      if (
        currentProviderId === 'gpt-image-2' ||
        currentProviderId === 'nano-banana' ||
        currentProviderId === 'kie-gpt-image' ||
        currentProviderId === 'kie-nano-banana'
      ) {
        const kieApi = createKieMarketImageAPI(currentImageProvider);
        const kieReferenceImages = await materializeKieMaterialRefsForCloud({
          apiKey: currentImageProvider.apiKey,
          materials: rawReferenceImageMaterials,
          kind: 'image',
          max: 14,
        });
        const result = await kieApi.generateImage({
          prompt: apiPrompt,
          ratio: effectiveNodeData.aspectRatio || '16:9',
          resolution: imageResolution,
          model,
          referenceImages: kieReferenceImages,
        });

        setGenerationProgress({
          status: 'processing',
          progress: 20,
          message: `Kie task submitted ${result.task_id.slice(0, 8)}...`,
        });

        const finalResult = await kieApi.pollTaskUntilComplete(
          result.task_id,
          (status, apiProgress) => {
            const progress =
              typeof apiProgress === 'number'
                ? Math.max(20, Math.min(95, apiProgress))
                : status === 'processing'
                  ? 55
                  : 30;
            setGenerationProgress({
              status: 'processing',
              progress,
              message:
                typeof apiProgress === 'number'
                  ? `Kie image generating ${Math.round(apiProgress)}%...`
                  : status === 'processing'
                    ? 'Kie image generating...'
                    : 'Kie image queued...',
            });
          },
          120,
          3000,
        );

        if (finalResult.status === 'success' && finalResult.result?.image_url) {
          succeeded = true;
          const billed = finalResult.usage?.total_tokens ?? 0;
          if (billed > 0) {
            addProviderTokens(KIE_GLOBAL_PROVIDER_TOKEN_KEY, billed);
          }
          syncKieCredits();
          await commitGeneratedImages({
            images: [{ image_url: finalResult.result.image_url }],
            prompt: apiPrompt,
            inputPrompt: prompt,
            model,
            imageResolution,
            lastGenerationCredits: billed,
          });
          setGenerationProgress({
            status: 'success',
            progress: 100,
            message: billed > 0 ? `Kie image done - ${billed} credits` : 'Kie image generated',
          });
        } else {
          setGenerationProgress({
            status: 'error',
            progress: 0,
            message: `Kie image failed: ${finalResult.message || 'unknown error'}`,
          });
        }
      } else if (isSeedream || isGptImage2) {
        const result = await api!.generateImage({
          prompt: apiPrompt,
          ratio: effectiveNodeData.aspectRatio || '16:9',
          resolution: imageResolution,
          model,
          referenceImages,
        });

      if (result.result?.image_url) {
        succeeded = true;
        const billed = result.usage?.total_tokens ?? result.usage?.completion_tokens ?? 0;
        if (billed > 0) {
          addUsedTokens('image', billed);
          addProviderTokens(`image.${currentProviderId}`, billed);
        }
        const generatedCount = result.result.images?.length || 1;
        await commitGeneratedImages({
          images: result.result.images?.length
            ? result.result.images
            : [{ image_url: result.result.image_url }],
          prompt: apiPrompt,
          inputPrompt: prompt,
          model,
          imageResolution,
        });
        setGenerationProgress({
          status: 'success',
          progress: 100,
          message:
            billed > 0
              ? `完成 · ${generatedCount} 张图 · 方舟扣费 ${billed.toLocaleString()} token`
              : `图像生成成功 · ${generatedCount} 张图`,
        });
      } else if (result.task_id) {
        setGenerationProgress({
          status: 'processing',
          progress: 20,
          message: `任务已提交: ${result.task_id.slice(0, 8)}...`
        });

        // 轮询任务状态并更新进度
        const finalResult = await api!.pollTaskUntilComplete(
          result.task_id,
          (status, apiProgress) => {
            // 根据状态更新进度
            let progress = 20;
            let message = `处理中: ${status}`;
            
            if (typeof apiProgress === 'number') {
              progress = Math.max(20, Math.min(95, apiProgress));
              message = `Image generating ${Math.round(apiProgress)}%`;
            } else if (status === 'pending') {
              progress = 30;
              message = '任务排队中...';
            } else if (status === 'processing') {
              progress = 50;
              message = '图像生成中...';
            } else if (status === 'rendering') {
              progress = 70;
              message = '图像渲染中...';
            } else if (status === 'finalizing') {
              progress = 90;
              message = '图像处理完成...';
            }
            
            setGenerationProgress({
              status: 'processing',
              progress,
              message
            });
          },
          60,
          3000
        );

        if (finalResult.status === 'success' && finalResult.result?.image_url) {
          succeeded = true;
          const billed =
            finalResult.usage?.total_tokens ?? finalResult.usage?.completion_tokens ?? 0;
          if (billed > 0) {
            addUsedTokens('image', billed);
          addProviderTokens(`image.${currentProviderId}`, billed);
          }
          await commitGeneratedImages({
            images: [{ image_url: finalResult.result.image_url }],
            prompt: apiPrompt,
            inputPrompt: prompt,
            model,
            imageResolution,
          });
          setGenerationProgress({
            status: 'success',
            progress: 100,
            message:
              billed > 0
                ? `完成 · 方舟扣费 ${billed.toLocaleString()} token`
                : '图像生成成功！',
          });
        } else {
          setGenerationProgress({
            status: 'error',
            progress: 0,
            message: `生成失败: ${finalResult.message || '未知错误'}`
          });
        }
        } else {
          setGenerationProgress({
            status: 'error',
            progress: 0,
            message: '图片接口没有返回可用结果'
          });
        }
      } else {
        // ── 自定义 / Nano Banana: OpenAI 兼容 ──
        const customApi = createCustomImageAPI(currentImageProvider!);
        const mainRef = referenceImages.length > 0 ? referenceImages[0] : undefined;
        const selectedRatio = effectiveNodeData.aspectRatio || '16:9';
        const result = await customApi.generateImage({
          model,
          prompt: apiPrompt,
          size: mapSeedreamToGptImage2Size(selectedRatio, imageResolution),
          ratio: selectedRatio,
          referenceImage: mainRef,
        });

        const imageList = result.images || (result.imageUrl ? [result.imageUrl] : []);
        if (imageList.length > 0) {
          succeeded = true;
          addProviderTokens(`image.${currentProviderId}`, 0);
          await commitGeneratedImages({
            images: imageList.map((url: string) => ({ image_url: url })),
            prompt: apiPrompt,
            inputPrompt: prompt,
            model,
            imageResolution,
          });
          setGenerationProgress({
            status: 'success',
            progress: 100,
            message: `图像生成成功 · ${imageList.length} 张图`,
          });
        } else {
          setGenerationProgress({
            status: 'error',
            progress: 0,
            message: '图片接口没有返回可用结果'
          });
        }
      }
    } catch (error) {
      setGenerationProgress({
        status: 'error',
        progress: 0,
        message: `错误: ${error instanceof Error ? error.message : '未知错误'}`
      });
    } finally {
      setIsLoading(false);
      if (succeeded) {
        setTimeout(() => {
          setGenerationProgress({
            status: 'idle',
            progress: 0,
            message: '等待生成...',
          });
        }, 3000);
      }
    }
  };

  useAgentGenerationBridge(id, handleGenerate, generationProgress);

  const handleDownload = async () => {
    if (!activeImageUrl) return;
    try {
      await saveMediaToDisk(activeImageUrl, `image-${Date.now()}.png`);
    } catch (error) {
      showDownloadError(error);
    }
  };

  const handleBatchExport = async () => {
    if (isBatchExporting) return;
    setIsBatchExporting(true);
    try {
      const group = collectNodeMediaExportGroup({ id, type: 'image', data: effectiveNodeData });
      if (!group) throw new Error('当前图片节点没有可导出的素材');
      const result = await exportNodeMediaGroups([group], '选择图片节点素材保存位置');
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
    if (!activeImageUrl || subtitleRemovalProgress !== null) return;
    setSubtitleRemovalProgress(0);
    const materialNodeId = createSubtitleRemovalMaterialNode({
      sourceNodeId: id,
      sourceHandle: 'image',
      fileName: subtitleRemovalOutputFileName(activeGeneratedImage?.fileName, 'image'),
      fileType: 'image',
    });
    if (!materialNodeId) {
      setSubtitleRemovalProgress(null);
      return;
    }
    try {
      const result = await removeSubtitlesFromMedia({
        sourceUrl: activeImageUrl,
        fileName: activeGeneratedImage?.fileName,
        mediaType: 'image',
        ...options,
      }, (progress) => {
        setSubtitleRemovalProgress(progress.progress);
        updateSubtitleRemovalMaterialProgress(materialNodeId, progress);
      });
      const previewMeta = await makeImagePreviewMeta(result.url);
      const cached = await persistImageToMaterialCache(materialNodeId, result.url);
      completeSubtitleRemovalMaterialNode({
        materialNodeId,
        fileUrl: cached ? materialDiskPlayableUrl(materialNodeId, 'image') : result.url,
        thumbnailUrl: previewMeta.thumbnailUrl,
        fileName: result.fileName,
      });
    } catch (error) {
      failSubtitleRemovalMaterialNode(materialNodeId, error);
      showSubtitleRemovalError(error);
    } finally {
      setSubtitleRemovalProgress(null);
    }
  };

  const handleApplyImageEdit = async (result: MaterialImageEditResult) => {
    const createdAt = Date.now();
    const cacheId = `${id}-image-edit-${createdAt.toString(36)}`;
    const cached = await persistImageToMaterialCache(cacheId, result.dataUrl);
    const imageUrl = cached ? materialDiskPlayableUrl(cacheId, 'image') : result.dataUrl;
    const previewMeta = await makeImagePreviewMeta(result.dataUrl);
    const editedImage: GeneratedImageItem = {
      id: `generated-${createdAt}-edit`,
      imageUrl,
      thumbnailUrl: previewMeta.thumbnailUrl,
      createdAt,
      fileName: `image-edited-${createdAt}.png`,
      prompt: localPrompt,
      size: previewMeta.size || `${result.width}x${result.height}`,
      model: currentModel,
      aspectRatio: effectiveNodeData.aspectRatio || '16:9',
      resolution: selectedResolution,
      providerId: currentProviderId,
      generationBackend: effectiveBackend,
      dreaminaCliModel: effectiveBackend === 'dreamina-cli' ? effectiveDreaminaCliModel.value : undefined,
      dreaminaCliResolution: effectiveBackend === 'dreamina-cli' ? selectedDreaminaCliResolution : undefined,
    };
    updateNodeData(id, {
      imageUrl,
      activeGeneratedImageId: editedImage.id,
      generatedImages: [editedImage, ...generatedImages].slice(0, 50),
    });
    setMediaEditorOpen(false);
  };

  const preview = previewMaterials[0];
  const compactLogoUrl = '/logo-symbol-relief.svg';
  const hasGeneratedImagePreview = Boolean(activeImageUrl);
  const compactMediaUrl = hasGeneratedImagePreview
    ? activeImageUrl
    : compactLogoUrl;
  const compactThumbnailUrl = hasGeneratedImagePreview
    ? activeGeneratedImage?.thumbnailUrl
    : undefined;
  const activeImagePreviewUrl = activeGeneratedImage?.thumbnailUrl || activeImageUrl;
  const activeImageDragItem: GeneratedImageItem | null = activeImageUrl
    ? activeGeneratedImage || {
        id: 'active-generated-image',
        imageUrl: activeImageUrl,
        createdAt: 0,
        fileName: makeGeneratedImageFileName(0),
      }
    : null;
  const imageHoverActions = activeImageDragItem ? (
    <div className="nodrag nopan absolute bottom-full right-0 z-10 mb-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        draggable
        title="拖入画布节点"
        aria-label="拖入画布节点"
        onDragStart={(event) => handleGeneratedImageDragStart(event, activeImageDragItem)}
        onClick={(event) => event.stopPropagation()}
        className="mc-node-frost-surface flex h-7 w-7 cursor-grab items-center justify-center rounded-lg border text-slate-300 transition-colors hover:border-white/25 hover:text-white active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="裁剪与编辑图片"
        aria-label="裁剪与编辑图片"
        onClick={(event) => {
          event.stopPropagation();
          setMediaEditorOpen(true);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className="mc-node-frost-surface flex h-7 w-7 items-center justify-center rounded-lg border text-slate-300 transition-colors hover:border-white/25 hover:text-white"
      >
        <Crop className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title={subtitleRemovalProgress === null ? '去字幕' : `去字幕中 ${subtitleRemovalProgress}%`}
        aria-label={subtitleRemovalProgress === null ? '去除图片字幕' : `正在去除图片字幕 ${subtitleRemovalProgress}%`}
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
        aria-label={isBatchExporting ? '正在批量导出图片素材' : '批量导出图片素材'}
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
  const compactMediaType = 'image';
  const compactMediaKey = hasGeneratedImagePreview
    ? `${activeGeneratedImage?.id || 'image'}:${compactThumbnailUrl || compactMediaUrl}`
    : 'image-logo-placeholder';
  const imageFrameAspectRatio =
    ratioToCssAspect(activeGeneratedImage?.size) ||
    ratioToCssAspect(activeGeneratedImage?.aspectRatio) ||
    ratioToCssAspect(effectiveNodeData.aspectRatio) ||
    '16 / 9';
  const openActiveImagePreview = () => {
    if (activeImageUrl) setLargeImagePreviewUrl(activeImageUrl);
  };
  const largeImagePreviewPortal = largeImagePreviewUrl && typeof document !== 'undefined'
    ? createPortal(
        <button
          type="button"
          title="收起大图"
          aria-label="收起图像生成大图"
          onClick={() => setLargeImagePreviewUrl('')}
          className="nodrag nopan nowheel fixed inset-0 z-[10040] flex cursor-zoom-out items-center justify-center border-0 bg-black/82 p-5 backdrop-blur-sm"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={largeImagePreviewUrl}
            alt="图像生成大图"
            draggable={false}
            decoding="async"
            className="max-h-[calc(100vh-40px)] max-w-[calc(100vw-40px)] select-none object-contain shadow-[0_32px_100px_rgba(0,0,0,0.72)]"
          />
        </button>,
        document.body,
      )
    : null;
  const imageMediaEditor = mediaEditorOpen && activeImageUrl ? (
    <MaterialMediaEditor
      sourceUrl={activeImageUrl}
      fileType="image"
      fileName={activeImageDragItem?.fileName}
      onClose={() => setMediaEditorOpen(false)}
      onApplyImage={handleApplyImageEdit}
      onTrimVideo={async () => {}}
      onTrimAudio={async () => {}}
      onCaptureFrame={async () => {}}
    />
  ) : null;
  const subtitleRemovalDialog = subtitleRemovalDialogOpen && activeImageUrl ? (
    <SubtitleRemovalDialog
      sourceUrl={activeImageUrl}
      posterUrl={activeImagePreviewUrl}
      mediaType="image"
      fileName={activeImageDragItem?.fileName}
      onClose={() => setSubtitleRemovalDialogOpen(false)}
      onConfirm={(options) => {
        setSubtitleRemovalDialogOpen(false);
        void handleRemoveSubtitles(options);
      }}
    />
  ) : null;

  const isGenerating = generationProgress.status === 'submitting' || generationProgress.status === 'processing';
  const generationPercent = Math.max(0, Math.min(100, Math.round(generationProgress.progress || 0)));
  const nodeStatusMessage =
    generationProgress.status === 'error' || generationProgress.status === 'success'
      ? generationProgress.message
      : '';
  const nodeStatusTone =
    generationProgress.status === 'error'
      ? 'error'
      : generationProgress.status === 'success'
        ? 'success'
        : 'info';
  const showImageHistoryStrip = generatedImages.length > 0;
  const imageHistoryStrip = showImageHistoryStrip ? (
    <div
      className="nodrag nopan nowheel mt-1.5 w-full overflow-x-auto overflow-y-hidden px-1"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex w-max min-w-full items-center gap-1.5">
        {generatedImages.map((item) => {
          const active = item.id === activeGeneratedImage?.id || item.imageUrl === activeImageUrl;
          return (
            <div key={item.id} className="group relative h-9 w-12 shrink-0">
              <button
                type="button"
                draggable
                title={item.fileName || 'generated image'}
                onClick={() => handleOpenGeneratedImage(item)}
                onDragStart={(event) => handleGeneratedImageDragStart(event, item)}
                className={cn(
                  'h-full w-full overflow-hidden rounded-md border bg-black/35 outline-none transition hover:border-white/45 focus:border-white/60',
                  active
                    ? 'border-cyan-200/80 shadow-[0_0_12px_rgba(103,232,249,0.35)]'
                    : 'border-white/14'
                )}
              >
                <MaterialThumbWithHover
                  thumbSrc={item.thumbnailUrl || item.imageUrl}
                  fullSrc={item.imageUrl}
                  alt=""
                  className="h-full w-full overflow-hidden rounded-[5px]"
                  imgClassName="h-full w-full object-cover"
                  enableHover={Boolean(item.imageUrl)}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  if (!showSettingsPanel) {
    return (
      <div className="mc-node-edit-anchor group relative w-[360px] overflow-visible">
        <div className="mc-node-media-frame-anchor mc-node-media-only-anchor relative w-full">
        {imageHoverActions}
        <Handle type="target" position={Position.Left} id="prompt" className="mc-node-handle mc-node-inner-frame-handle" />
        <CompactNodeFrame
          key={compactMediaKey}
          title={nodeData.label}
          icon={<ImageIcon className="h-3 w-3" />}
          mediaUrl={compactMediaUrl}
          imageThumbnailUrl={compactThumbnailUrl}
          posterUrl={preview?.fileType === 'video' ? preview.thumbnailUrl?.trim() || undefined : undefined}
          mediaType={compactMediaType}
          text={localPrompt}
          badge={isGenerating ? '生成中...' : `${effectiveNodeData.aspectRatio || '16:9'} ${selectedResolution}`}
          width="w-full"
          frameAspectRatio={imageFrameAspectRatio}
          accent="cyan"
          variant="glass-inner"
          isLoading={isGenerating}
          progress={generationPercent}
          etaKey={`image:${effectiveBackend}:${currentProviderId}:${currentModel}`}
          etaSessionKey={`image:${id}`}
          etaBaselineSeconds={effectiveBackend === 'dreamina-cli' ? 180 : 120}
          mediaFit={hasGeneratedImagePreview ? 'cover' : 'contain'}
          mediaClassName={cn(
            !hasGeneratedImagePreview && 'mc-node-logo-relief',
            isGenerating && 'mc-node-generating-fade',
          )}
          mediaFrameClassName={cn(isGlowing && !isGenerating && 'mc-node-success-glow')}
          mediaOnly
          onImageLargePreview={hasGeneratedImagePreview ? openActiveImagePreview : undefined}
          statusMessage={nodeStatusMessage}
          statusTone={nodeStatusTone}
        />
        <Handle type="source" position={Position.Right} id="image" className="mc-node-handle mc-node-inner-frame-handle" />
        </div>
        {imageHistoryStrip}
        {largeImagePreviewPortal}
        {imageMediaEditor}
        {subtitleRemovalDialog}
      </div>
    );
  }

  return (
    <div className="mc-node-edit-anchor group relative w-[360px] overflow-visible">
      <div ref={previewFrameRef} className="relative w-[360px] overflow-visible">
        <div className="mc-node-media-frame-anchor mc-node-media-only-anchor relative w-full">
        {imageHoverActions}
        <Handle type="target" position={Position.Left} id="prompt" className="mc-node-handle mc-node-inner-frame-handle" />
        <CompactNodeFrame
          key={compactMediaKey}
          title={nodeData.label}
          icon={<ImageIcon className="h-3 w-3" />}
          mediaUrl={compactMediaUrl}
          imageThumbnailUrl={compactThumbnailUrl}
          posterUrl={preview?.fileType === 'video' ? preview.thumbnailUrl?.trim() || undefined : undefined}
          mediaType={compactMediaType}
          text={localPrompt}
          badge={isGenerating ? '生成中...' : `${effectiveNodeData.aspectRatio || '16:9'} ${selectedResolution}`}
          width="w-full"
          frameAspectRatio={imageFrameAspectRatio}
          accent="cyan"
          variant="glass-inner"
          isLoading={isGenerating}
          progress={generationPercent}
          etaKey={`image:${effectiveBackend}:${currentProviderId}:${currentModel}`}
          etaSessionKey={`image:${id}`}
          etaBaselineSeconds={effectiveBackend === 'dreamina-cli' ? 180 : 120}
          mediaFit={hasGeneratedImagePreview ? 'cover' : 'contain'}
          mediaClassName={cn(
            !hasGeneratedImagePreview && 'mc-node-logo-relief',
            isGenerating && 'mc-node-generating-fade',
          )}
          mediaFrameClassName={cn(isGlowing && !isGenerating && 'mc-node-success-glow')}
          mediaOnly
          onImageLargePreview={hasGeneratedImagePreview ? openActiveImagePreview : undefined}
          statusMessage={nodeStatusMessage}
          statusTone={nodeStatusTone}
        />
        <Handle type="source" position={Position.Right} id="image" className="mc-node-handle mc-node-inner-frame-handle" />
        </div>
        {imageHistoryStrip}
      </div>
      <ScreenSpaceNodePanel
        anchorRef={previewFrameRef}
        className={cn(
          'mc-node-expanded mc-node-edit-panel mc-node-screen-space-panel nodrag nopan nowheel min-h-[292px] overflow-visible rounded-xl border border-white/22 bg-[#080a0d]/92 transition-colors mc-dur-12f',
          showSettingsPanel
            ? 'shadow-[0_0_32px_rgba(255,255,255,0.14),0_22px_50px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.2)]'
            : 'border-slate-300/10 hover:border-slate-300/18'
        )}
      >
        <div className="flex min-h-[292px] flex-col p-3">
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            {previewMaterials.length > 0 && (
              <MaterialPreviewStrip
                materials={previewMaterials}
                className="shrink-0 max-h-[52px] overflow-hidden"
              />
            )}
            <div
              className="shrink-0"
              data-tutorial-id="image-prompt-input"
              data-tutorial-node-id={id}
            >
              <ExpandableTextField
                title="图像提示词"
                value={localPrompt}
                onChange={(next) => updateNodeData(id, { customPrompt: next, promptEdited: true })}
                placeholder="可直接文字生图，或上传图片输入文字指令对图片进行编辑，如：将背景改为雪夜"
                materials={previewMaterials}
              >
                <MentionTextarea
                  value={localPrompt}
                  onChange={(next) => updateNodeData(id, { customPrompt: next, promptEdited: true })}
                  materials={previewMaterials}
                  placeholder="可直接文字生图，或上传图片输入文字指令对图片进行编辑，如：将背景改为雪夜"
                  minHeight={previewMaterials.length > 0 ? 'min-h-[128px]' : 'min-h-[188px]'}
                  minResizeWidth={620}
                  minResizeHeight={previewMaterials.length > 0 ? 128 : 188}
                  className="mc-node-frost-surface !border-white/10 !text-xs focus:!border-white/40 focus:!shadow-[0_0_12px_rgba(255,255,255,0.12)]"
                />
              </ExpandableTextField>
            </div>

            <div className="mt-auto flex w-full items-center gap-2">
              {dreaminaCliConfig.imageEnabled && (
                <div className="min-w-0 flex-1">
                  <Select value={effectiveBackend} onValueChange={handleBackendChange} className="h-8 text-[11px]">
                    {GENERATION_BACKEND_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </Select>
                </div>
              )}

              {effectiveBackend === 'dreamina-cli' ? (
                <>
                  <div className="min-w-0 flex-1">
                    <Select value={effectiveNodeData.aspectRatio || '16:9'} onValueChange={handleRatioChange} className="h-8 text-[11px]">
                      {DREAMINA_CLI_IMAGE_RATIO_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label} {opt.desc}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Select value={selectedDreaminaCliResolution} onValueChange={handleDreaminaCliResolutionChange} className="h-8 text-[11px]">
                      {dreaminaCliResolutionOptions.map((resolution) => (
                        <SelectItem key={resolution} value={resolution}>
                          {DREAMINA_CLI_IMAGE_RESOLUTION_LABELS[resolution]}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Select value={effectiveDreaminaCliModel.value} onValueChange={handleDreaminaCliModelChange} className="h-8 text-[11px]">
                      {DREAMINA_CLI_IMAGE_MODELS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                </>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <Select value={effectiveNodeData.aspectRatio || '16:9'} onValueChange={handleRatioChange} className="h-8 text-[11px]">
                      {RATIO_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label} {opt.desc}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Select value={selectedResolution} onValueChange={handleResolutionChange} className="h-8 text-[11px]">
                      {resolutionOptions.map((resolution) => (
                        <SelectItem key={resolution} value={resolution}>
                          {SEEDREAM_RESOLUTION_LABELS[resolution]}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Select value={currentProviderId} onValueChange={handleProviderChange} className="h-8 text-[11px]">
                      {providerOptions.length === 0 ? (
                        <SelectItem value="" disabled>暂无厂商</SelectItem>
                      ) : (
                        providerOptions.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))
                      )}
                    </Select>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Select value={currentModel} onValueChange={handleModelChange} className="h-8 text-[11px]">
                      {modelOptions.length === 0 ? (
                        <SelectItem value="" disabled>暂无模型</SelectItem>
                      ) : (
                        modelOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))
                      )}
                    </Select>
                  </div>
                </>
              )}

              <div className="flex shrink-0 items-center gap-2">
              {activeImageUrl && (
                <button
                  onClick={handleDownload}
                  onMouseDown={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="mc-node-frost-surface flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-slate-300 transition-colors hover:border-white/25 hover:text-white"
                  title="下载图片"
                >
                  <Download className="h-4 w-4" />
                </button>
              )}

              <Button
                data-tutorial-id="image-generate-button"
                data-tutorial-node-id={id}
                onClick={handleGenerate}
                disabled={
                  isLoading ||
                  !localPrompt ||
                  (effectiveBackend === 'dreamina-cli' ? !dreaminaCliConfig.loggedIn : false)
                }
                title="生成图像"
                className="h-9 w-9 shrink-0 rounded-xl border border-white/10 bg-white/12 p-0 text-zinc-100 shadow-none transition-all hover:bg-white/18 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
              </div>
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
                  modelLabel={`${effectiveDreaminaCliModel.label} · ${DREAMINA_CLI_IMAGE_RESOLUTION_LABELS[selectedDreaminaCliResolution]}`}
                  onRefresh={() => {
                    void dreaminaCliCreditSync.refresh(true);
                  }}
                />
              ) : (
                <div className="mc-node-frost-strip flex h-6 items-center rounded-md px-2 text-[10px] text-zinc-400">
                  即梦CLI 未登录，当前模型预计 {dreaminaEstimatedCreditCost.toLocaleString()} 积分/次
                </div>
              )
            ) : isKieImageProvider ? (
              <>
              <KieUsageInfo usage={kieImageUsage} lastCredits={effectiveNodeData.lastGenerationCredits} />
              <div className="hidden mc-node-frost-strip h-6 items-center gap-2 overflow-hidden rounded-md px-2 text-[11px] font-medium text-zinc-300">
                <span className="min-w-0 flex-1 truncate">{kieImageUsage.currentText}</span>
                <span className="shrink-0">{kieImageUsage.estimateText}</span>
                <span className="max-w-[260px] shrink-0 truncate text-zinc-100">
                  {kieImageUsage.balanceText} · {kieImageUsage.usedText}
                </span>
              </div>
              </>
            ) : (
              <div className="mc-node-frost-strip flex h-6 items-center gap-2 overflow-hidden rounded-md px-2 text-[10px] text-zinc-400">
                <span className="min-w-0 flex-1 truncate">
                  当前: {currentImageProvider?.label || currentProviderId || '图片 API'} · {currentModel} · {SEEDREAM_RESOLUTION_LABELS[selectedResolution] || selectedResolution}
                </span>
                <span className="shrink-0">预计扣减 {estimatedTokens.toLocaleString()} token</span>
                <span className="max-w-[170px] shrink-0 truncate">
                  {currentImageProvider?.apiKey ? `剩余 ${remainingDisplay}` : '图片 API 未配置'}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-300/10 px-3 py-2.5 mc-node-frost-header">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/22 bg-white/[0.08] shadow-[0_0_12px_rgba(255,255,255,0.12)]">
          <ImageIcon className="h-4 w-4 text-zinc-100 drop-shadow-[0_0_8px_rgba(255,255,255,0.35)]" />
        </div>
        <span className="text-xs font-medium text-white">{nodeData.label}</span>
        {imageApiConfig.apiKey && (
          <span className="ml-auto rounded-md border border-white/18 bg-white/[0.08] px-1.5 py-0.5 text-[8px] text-zinc-200 shadow-[0_0_10px_rgba(255,255,255,0.1)]">
            API 已配置
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-3 space-y-3">
        <MaterialPreviewStrip materials={previewMaterials} />

        <div className="min-w-0">
          <label className="text-[10px] text-zinc-500 mb-1 block">提示词（可接上游或在此编辑，@ 引用素材）</label>
          <MentionTextarea
            value={localPrompt}
            onChange={(next) => updateNodeData(id, { customPrompt: next, promptEdited: true })}
            materials={previewMaterials}
            placeholder="描述画面，@ 插入素材..."
            minHeight="min-h-[64px]"
            minResizeWidth={180}
            minResizeHeight={56}
            size={effectiveNodeData.promptBoxSize}
            onSizeChange={(promptBoxSize) => updateNodeData(id, { promptBoxSize })}
            className="mc-node-frost-surface !border-white/10 !text-xs focus:!border-white/40 focus:!shadow-[0_0_12px_rgba(255,255,255,0.12)]"
          />
        </div>

        {/* Backend Select */}
        {dreaminaCliConfig.imageEnabled && (
          <div>
            <label className="text-[10px] text-zinc-500 mb-1 block">生成后端</label>
            <Select
              value={effectiveBackend}
              onValueChange={handleBackendChange}
              className="h-8 text-xs"
            >
              {GENERATION_BACKEND_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </Select>
          </div>
        )}

        {/* Parameters */}
        {effectiveBackend === 'dreamina-cli' ? (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">画面比例</label>
              <Select
                value={effectiveNodeData.aspectRatio || '16:9'}
                onValueChange={handleRatioChange}
                className="h-8 text-xs"
              >
                {DREAMINA_CLI_IMAGE_RATIO_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label} {opt.desc}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">分辨率</label>
              <Select
                value={selectedDreaminaCliResolution}
                onValueChange={handleDreaminaCliResolutionChange}
                className="h-8 text-xs"
              >
                {dreaminaCliResolutionOptions.map((resolution) => (
                  <SelectItem key={resolution} value={resolution}>
                    {DREAMINA_CLI_IMAGE_RESOLUTION_LABELS[resolution]}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-zinc-500 mb-1 block">即梦模型</label>
              <Select
                value={effectiveDreaminaCliModel.value}
                onValueChange={handleDreaminaCliModelChange}
                className="h-8 text-xs"
              >
                {DREAMINA_CLI_IMAGE_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </Select>
              <p className="text-[9px] text-zinc-600 mt-0.5">{effectiveDreaminaCliModel.desc}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">画面比例</label>
              <Select
                value={effectiveNodeData.aspectRatio || '16:9'}
                onValueChange={handleRatioChange}
                className="h-8 text-xs"
              >
                {RATIO_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label} {opt.desc}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">分辨率</label>
              <Select
                value={selectedResolution}
                onValueChange={handleResolutionChange}
                className="h-8 text-xs"
              >
                {resolutionOptions.map((resolution) => (
                  <SelectItem key={resolution} value={resolution}>
                    {SEEDREAM_RESOLUTION_LABELS[resolution]}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">厂商</label>
              <Select
                value={currentProviderId}
                onValueChange={handleProviderChange}
                className="h-8 text-xs"
              >
                {providerOptions.length === 0 ? (
                  <SelectItem value="" disabled>暂无可用厂商</SelectItem>
                ) : (
                  providerOptions.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))
                )}
              </Select>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">模型</label>
              <Select
                value={currentModel}
                onValueChange={handleModelChange}
                className="h-8 text-xs"
              >
                {modelOptions.length === 0 ? (
                  <SelectItem value="" disabled>暂无可用模型</SelectItem>
                ) : (
                  modelOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))
                )}
              </Select>
            </div>
          </div>
        )}

        {/* Progress Visualization */}
        <div className="space-y-1">
          <Progress
            value={generationProgress.progress}
            variant={generationProgress.status === 'error' ? 'error' : 
                    generationProgress.status === 'success' ? 'success' : 'cyan'}
            size="sm"
            showValue={true}
          />
          <div className="text-xs text-zinc-400 h-4 flex items-center">
            {generationProgress.message}
          </div>
        </div>

        {/* Generate Button */}
        <Button
          onClick={handleGenerate}
          disabled={
            isLoading ||
            !localPrompt ||
            (effectiveBackend === 'dreamina-cli' ? !dreaminaCliConfig.loggedIn : false)
          }
          title={
            effectiveBackend === 'dreamina-cli'
              ? !dreaminaCliConfig.loggedIn
                ? '即梦CLI 未登录，请在 API 配置中检测登录'
                : !localPrompt
                  ? '请连接提示词节点'
                  : undefined
              : !localPrompt
                ? '请连接提示词节点'
                : undefined
          }
          className={cn(
            'h-8 w-full gap-1.5 border border-white/10 bg-white/10 text-xs text-zinc-100 shadow-none transition-all hover:bg-white/16',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <ImageIcon className="w-3 h-3" />
              生成图像
            </>
          )}
        </Button>

        {/* Image Preview */}
        {activeImageUrl && activeGeneratedImage && (
          <div className="space-y-1.5">
            {thumbnailImages.length > 0 && (
              <div className="nodrag nopan nowheel mc-node-frost-strip flex gap-1.5 overflow-x-auto rounded-lg p-1">
                {thumbnailImages.map((item) => (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    draggable
                    onClick={() => handleOpenGeneratedImage(item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleOpenGeneratedImage(item);
                      }
                    }}
                    onDragStart={(event) => handleGeneratedImageDragStart(event, item)}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    title={item.fileName || 'generated image'}
                    className="mc-node-frost-thumb h-12 w-16 shrink-0 cursor-pointer overflow-visible rounded-md border outline-none transition hover:border-white/40 focus:border-white/55 focus:shadow-[0_0_12px_rgba(255,255,255,0.12)]"
                  >
                    <MaterialThumbWithHover
                      thumbSrc={item.thumbnailUrl || item.imageUrl}
                      fullSrc={item.imageUrl}
                      alt="Generated thumbnail"
                      className="h-full w-full overflow-hidden rounded-md"
                      imgClassName="h-full w-full object-cover"
                      enableHover={Boolean(item.imageUrl)}
                    />
                  </div>
                ))}
              </div>
            )}

            <div
              draggable
              onDragStart={(event) => handleGeneratedImageDragStart(event, activeGeneratedImage)}
              onClick={(event) => {
                event.stopPropagation();
                openActiveImagePreview();
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              title="点击查看大图"
              className="nodrag nopan nowheel mc-node-frost-media-well group relative h-56 cursor-zoom-in overflow-hidden rounded-lg border shadow-inner shadow-black/30"
            >
              {/* Data URLs / arbitrary origins: plain img is appropriate */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeImagePreviewUrl}
                alt="Generated"
                draggable={false}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-contain"
              />
              {/* Overlay quick actions on hover - removed download and external link buttons */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 pointer-events-none">
                {/* 只保留图片预览，不显示自定义按钮 */}
              </div>
            </div>
            {/* Persistent action buttons - only download button */}
            <div className="flex gap-2 mt-1.5">
              <button
                onClick={handleDownload}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                className="mc-node-frost-surface flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[10px] text-slate-400 transition-colors hover:border-white/25 hover:text-slate-100"
              >
                <Download className="w-3 h-3" />
                下载图片
              </button>
            </div>
          </div>
        )}

        </div>

        {/* Token / Dreamina Credit Info Bar */}
        {effectiveBackend === 'dreamina-cli' ? (
          dreaminaCliConfig.loggedIn ? (
            <DreaminaCliCreditBar
              compact
              credit={{
                ...dreaminaCliCreditSync,
                sessionUsedCredits: dreaminaCliSessionUsedCredits,
              }}
              estimatedCost={dreaminaEstimatedCreditCost}
              modelLabel={`${effectiveDreaminaCliModel.label} · ${DREAMINA_CLI_IMAGE_RESOLUTION_LABELS[selectedDreaminaCliResolution]}`}
              onRefresh={() => {
                void dreaminaCliCreditSync.refresh(true);
              }}
            />
          ) : (
            <div className="mc-node-frost-strip flex h-6 items-center rounded-md px-2 text-[10px] text-zinc-400">
              即梦CLI 未登录，当前模型预计 {dreaminaEstimatedCreditCost.toLocaleString()} 积分/次
            </div>
          )
        ) : isKieImageProvider ? (
          <div className="mc-node-frost-strip flex flex-col gap-1 rounded-md px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-400">
              <span className="flex min-w-0 items-center gap-1 truncate">
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-100 shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
                <span className="truncate">{kieImageUsage.currentText}</span>
              </span>
              <span>{kieImageUsage.estimateText}</span>
            </div>
            <div className="text-[11px] font-medium text-zinc-100">
              {kieImageUsage.balanceText} · {kieImageUsage.usedText}
            </div>
          </div>
        ) : imageApiConfig.apiKey ? (
          <div className="mc-node-frost-strip flex flex-col gap-1 rounded-md px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-400">
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-100 shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
                预估约 {estimatedTokens.toLocaleString()} token（以任务返回 usage 为准）
              </span>
              <span>图片 API 已记录消耗: {imageTokenConfig.usedTokens.toLocaleString()} token</span>
            </div>
            <div className="text-[11px] font-medium text-zinc-100">剩余: {remainingDisplay}</div>
            <div className="text-[9px] text-zinc-500">
              预计还可生成: {estimatedRemainingImages == null ? '请先填写图片 API 剩余 token' : `${estimatedRemainingImages.toLocaleString()} 张图片`}
            </div>
          </div>
        ) : null}
        </div>
      </ScreenSpaceNodePanel>
      {imageMediaEditor}
      {largeImagePreviewPortal}
      {subtitleRemovalDialog}
    </div>
  );
}

export default memo(ImageNode);
