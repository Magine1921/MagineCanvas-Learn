'use client';

import { useCanvasStore } from '@/components/canvas/CanvasStore';
import { useSeedanceStore } from '@/components/seedance/SeedanceStore';
import { fileNameToMentionSlug } from '@/lib/material-import-from-file';
import {
  isMaterialDiskRef,
  materialDiskRefToNodeId,
  materialDiskPlayableUrl,
} from '@/lib/material-disk-playable-url';
import {
  missingTencentMpsSubtitleRemovalFields,
  normalizeTencentMpsSubtitleRemovalConfig,
} from '@/lib/tencent-mps-subtitle-removal';
import {
  normalizeSubtitleRemovalRegion,
  type SubtitleRemovalMode,
  type SubtitleRemovalRegion,
} from '@/lib/subtitle-removal-region';

export interface SubtitleRemovalProgress {
  requestId: string;
  progress: number;
  status: 'queued' | 'processing' | 'complete' | 'error';
  message: string;
}

interface SubtitleRemovalApiResponse {
  ok?: boolean;
  error?: string;
  taskId?: string;
  inputKey?: string;
  mediaType?: 'image' | 'video';
  fileName?: string;
  status?: 'processing' | 'complete';
  progress?: number;
  url?: string;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readResponse(response: Response): Promise<SubtitleRemovalApiResponse> {
  const payload = await response.json().catch(() => ({})) as SubtitleRemovalApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `腾讯云去字幕请求失败：HTTP ${response.status}`);
  }
  return payload;
}

function playableSourceUrl(sourceUrl: string, mediaType: 'image' | 'video') {
  return isMaterialDiskRef(sourceUrl)
    ? materialDiskPlayableUrl(materialDiskRefToNodeId(sourceUrl), mediaType)
    : sourceUrl;
}

async function appendSourceToForm(
  form: FormData,
  sourceUrl: string,
  fileName: string,
  mediaType: 'image' | 'video',
) {
  const playableUrl = playableSourceUrl(sourceUrl, mediaType);
  if (/^(?:https?:|\/api\/)/i.test(playableUrl)) {
    form.set('sourceUrl', playableUrl);
    return;
  }
  try {
    const response = await fetch(playableUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    form.set('file', new File([blob], fileName, {
      type: blob.type || (mediaType === 'video' ? 'video/mp4' : 'image/png'),
    }));
  } catch {
    throw new Error('当前素材无法上传到腾讯云，请先重新上传或下载后再导入');
  }
}

export async function removeSubtitlesFromMedia(
  request: {
    sourceUrl: string;
    fileName?: string;
    mediaType: 'image' | 'video';
    mode?: SubtitleRemovalMode;
    region?: SubtitleRemovalRegion;
  },
  onProgress?: (progress: SubtitleRemovalProgress) => void,
) {
  const config = normalizeTencentMpsSubtitleRemovalConfig(
    useSeedanceStore.getState().config.subtitleRemovalApi,
  );
  const missing = missingTencentMpsSubtitleRemovalFields(config);
  if (missing.length > 0) {
    throw new Error(`请先打开“API 配置 → 去字幕”，填写 ${missing.join('、')}`);
  }

  const requestId = `subtitle-remove-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const sourceName = request.fileName?.trim()
    || `${request.mediaType}-${Date.now()}.${request.mediaType === 'video' ? 'mp4' : 'png'}`;
  const report = (
    progress: number,
    status: SubtitleRemovalProgress['status'],
    message: string,
  ) => onProgress?.({ requestId, progress, status, message });

  report(2, 'queued', '正在准备素材');
  const form = new FormData();
  form.set('action', 'submit');
  form.set('mediaType', request.mediaType);
  form.set('fileName', sourceName);
  form.set('config', JSON.stringify(config));
  const mode: SubtitleRemovalMode = request.mode === 'custom' ? 'custom' : 'auto';
  const region = normalizeSubtitleRemovalRegion(request.region);
  if (mode === 'custom' && !region) throw new Error('指定区域擦除缺少有效框选区域');
  form.set('mode', mode);
  if (region) form.set('region', JSON.stringify(region));
  await appendSourceToForm(form, request.sourceUrl, sourceName, request.mediaType);
  report(8, 'processing', '正在上传到腾讯云 COS');

  const submitted = await readResponse(await fetch('/api/tencent-mps/subtitle-removal', {
    method: 'POST',
    body: form,
  }));
  if (!submitted.taskId || !submitted.inputKey) throw new Error('腾讯云未返回有效任务');
  report(15, 'processing', '腾讯云 MPS 正在去字幕');

  const deadline = Date.now() + 2 * 60 * 60 * 1000;
  while (Date.now() < deadline) {
    await wait(2_000);
    const queried = await readResponse(await fetch('/api/tencent-mps/subtitle-removal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'query',
        config,
        taskId: submitted.taskId,
        inputKey: submitted.inputKey,
        mediaType: request.mediaType,
      }),
    }));
    const remoteProgress = Math.max(0, Math.min(100, Number(queried.progress || 0)));
    const progress = queried.status === 'complete' ? 100 : Math.max(15, Math.min(99, 15 + Math.round(remoteProgress * 0.84)));
    report(progress, queried.status === 'complete' ? 'complete' : 'processing', queried.status === 'complete' ? '去字幕完成' : '腾讯云 MPS 正在去字幕');
    if (queried.status === 'complete') {
      if (!queried.url) throw new Error('腾讯云任务成功，但没有返回结果地址');
      return {
        url: queried.url,
        fileName: submitted.fileName || sourceName.replace(/(\.[^.]+)?$/, `-subtitle-removed$1`),
      };
    }
  }
  throw new Error('腾讯云去字幕任务等待超时，请稍后重试');
}

export function subtitleRemovalErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  if (/AuthFailure|InvalidCredential|SecretId|SecretKey/i.test(message)) {
    return `腾讯云密钥无效或无权限。请检查 API 配置中的 SecretId、SecretKey 和 MPS/COS 权限。${message}`;
  }
  if (/UnauthorizedOperation|UnsupportedOperation|not authorized/i.test(message)) {
    return `腾讯云账号尚未开通对应能力或缺少权限。请确认已开通 MPS 智能擦除、图片处理和 COS。${message}`;
  }
  return message;
}

export function showSubtitleRemovalError(error: unknown) {
  window.alert(`去字幕失败：${subtitleRemovalErrorMessage(error)}`);
}

export function subtitleRemovalOutputFileName(
  fileName: string | undefined,
  fileType: 'image' | 'video',
) {
  const extension = fileType === 'video' ? 'mp4' : 'png';
  const sourceName = fileName?.trim() || `material.${extension}`;
  const baseName = sourceName.replace(/\.[^.]+$/, '') || 'material';
  return `${baseName}-subtitle-removed.${extension}`;
}

export function updateSubtitleRemovalMaterialProgress(
  materialNodeId: string,
  progress: SubtitleRemovalProgress,
) {
  if (!materialNodeId) return;
  const isRemoteComplete = progress.status === 'complete';
  useCanvasStore.getState().updateNodeData(materialNodeId, {
    subtitleRemovalStatus: isRemoteComplete ? 'processing' : progress.status,
    subtitleRemovalProgress: isRemoteComplete ? 99 : progress.progress,
    subtitleRemovalMessage: isRemoteComplete ? '正在保存去字幕结果' : progress.message,
    subtitleRemovalRequestId: progress.requestId,
  }, { recordUndo: false });
}

export function completeSubtitleRemovalMaterialNode(options: {
  materialNodeId: string;
  fileUrl: string;
  thumbnailUrl?: string;
  fileName: string;
}) {
  if (!options.materialNodeId) return;
  useCanvasStore.getState().updateNodeData(options.materialNodeId, {
    fileUrl: options.fileUrl,
    thumbnailUrl: options.thumbnailUrl || options.fileUrl,
    fileName: options.fileName,
    mentionSlug: fileNameToMentionSlug(options.fileName),
    subtitleRemovalStatus: 'complete',
    subtitleRemovalProgress: 100,
    subtitleRemovalMessage: '去字幕完成',
  }, { recordUndo: false });
  useCanvasStore.getState().addGlowingNode(options.materialNodeId);
}

export function failSubtitleRemovalMaterialNode(materialNodeId: string, error: unknown) {
  if (!materialNodeId) return;
  useCanvasStore.getState().updateNodeData(materialNodeId, {
    subtitleRemovalStatus: 'error',
    subtitleRemovalMessage: `去字幕失败：${subtitleRemovalErrorMessage(error)}`,
  }, { recordUndo: false });
}

export function createSubtitleRemovalMaterialNode(options: {
  sourceNodeId: string;
  sourceHandle: 'image' | 'video' | null;
  fileUrl?: string;
  thumbnailUrl?: string;
  fileName: string;
  fileType: 'image' | 'video';
}) {
  const store = useCanvasStore.getState();
  const sourceNode = store.nodes.find((node) => node.id === options.sourceNodeId);
  const exportedIndices = store.nodes
    .filter(
      (node) =>
        node.type === 'material' &&
        node.data.sourceSubtitleRemovalNodeId === options.sourceNodeId,
    )
    .map((node) => Number(node.data.sourceSubtitleRemovalIndex))
    .filter(Number.isFinite);
  const exportIndex = exportedIndices.length > 0 ? Math.max(...exportedIndices) + 1 : 0;
  const sourceWidth = Number(sourceNode?.width || sourceNode?.style?.width || 360);
  const position = sourceNode
    ? {
        x: sourceNode.position.x + sourceWidth + 80,
        y: sourceNode.position.y + exportIndex * 225,
      }
    : { x: 440, y: 240 };
  const materialNodeId = store.addNodeWithData(
    'material',
    position,
    {
      label: '素材',
      type: 'material',
      fileUrl: options.fileUrl || '',
      thumbnailUrl: options.thumbnailUrl || options.fileUrl || '',
      fileName: options.fileName,
      fileType: options.fileType,
      mentionSlug: fileNameToMentionSlug(options.fileName),
      sourceSubtitleRemovalNodeId: options.sourceNodeId,
      sourceSubtitleRemovalIndex: exportIndex,
      connectedMediaSourceNodeId: options.sourceNodeId,
      connectedMediaLocked: true,
      subtitleRemovalStatus: options.fileUrl ? 'complete' : 'queued',
      subtitleRemovalProgress: options.fileUrl ? 100 : 0,
      subtitleRemovalMessage: options.fileUrl ? '去字幕完成' : '正在准备去字幕',
    },
    { captureEntrance: true, syncCommit: true },
  );
  if (!materialNodeId) return '';
  useCanvasStore.getState().onConnect({
    source: options.sourceNodeId,
    sourceHandle: options.sourceHandle,
    target: materialNodeId,
    targetHandle: null,
  });
  if (options.fileUrl) useCanvasStore.getState().addGlowingNode(materialNodeId);
  return materialNodeId;
}
