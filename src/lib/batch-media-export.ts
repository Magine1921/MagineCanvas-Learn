export type BatchMediaKind = 'image' | 'video';

export interface BatchMediaExportItem {
  sourceUrl?: string;
  bytes?: Uint8Array;
  suggestedName: string;
  mimeType?: string;
}

export interface BatchMediaExportGroup {
  nodeId: string;
  folderName: string;
  items: BatchMediaExportItem[];
}

export interface BatchMediaExportResult {
  ok: boolean;
  canceled: boolean;
  directory?: string;
  savedCount: number;
  failedCount: number;
  folders?: Array<{
    nodeId: string;
    folderPath: string;
    savedCount: number;
    failedCount: number;
  }>;
  error?: string;
}

export interface BatchMediaExportProgress {
  requestId: string;
  completedCount: number;
  totalCount: number;
  savedCount: number;
  failedCount: number;
  nodeId?: string;
  fileName?: string;
}

export interface MediaExportNodeLike {
  id: string;
  type?: string;
  data: Record<string, unknown>;
}

interface RawMediaItem {
  url: string;
  fileName?: string;
  createdAt: number;
}

const MATERIAL_DISK_REF_PREFIX = 'disk://magine/material/v1/';

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function mediaExtension(url: string, kind: BatchMediaKind): string {
  if (url.startsWith('data:')) {
    const mime = /^data:([^;,]+)/i.exec(url)?.[1]?.toLowerCase();
    if (mime === 'image/jpeg') return '.jpg';
    if (mime === 'image/webp') return '.webp';
    if (mime === 'image/gif') return '.gif';
    if (mime === 'video/webm') return '.webm';
    if (mime === 'video/quicktime') return '.mov';
  }

  try {
    const pathname = new URL(url, 'http://magine.local').pathname;
    const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (match) {
      const extension = `.${match[1].toLowerCase()}`;
      const allowed = kind === 'image'
        ? new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'])
        : new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v']);
      if (allowed.has(extension)) return extension;
    }
  } catch {
    /* use the media kind fallback */
  }
  return kind === 'image' ? '.png' : '.mp4';
}

function exportFileName(item: RawMediaItem, kind: BatchMediaKind, index: number): string {
  const provided = stringValue(item.fileName);
  if (provided) {
    return /\.[a-z0-9]{2,5}$/i.test(provided)
      ? provided
      : `${provided}${mediaExtension(item.url, kind)}`;
  }
  const order = String(index + 1).padStart(2, '0');
  const stamp = item.createdAt > 0
    ? `-${new Date(item.createdAt).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '')}`
    : '';
  return `${kind === 'image' ? 'image' : 'video'}-${order}${stamp}${mediaExtension(item.url, kind)}`;
}

function rawHistoryItems(data: Record<string, unknown>, kind: BatchMediaKind): RawMediaItem[] {
  const historyKey = kind === 'image' ? 'generatedImages' : 'generatedVideos';
  const urlKey = kind === 'image' ? 'imageUrl' : 'videoUrl';
  const rawHistory = Array.isArray(data[historyKey]) ? data[historyKey] : [];
  const items: RawMediaItem[] = [];
  const seen = new Set<string>();

  for (const value of rawHistory) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const url = stringValue(record[urlKey]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({
      url,
      fileName: stringValue(record.fileName) || undefined,
      createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
        ? record.createdAt
        : 0,
    });
  }

  const currentUrl = stringValue(data[urlKey]);
  if (currentUrl && !seen.has(currentUrl)) {
    items.push({ url: currentUrl, createdAt: 0 });
  }

  return items.sort((a, b) => b.createdAt - a.createdAt);
}

function playableSourceUrl(url: string, kind: BatchMediaKind): string {
  if (!url.startsWith(MATERIAL_DISK_REF_PREFIX)) return url;
  const nodeId = url.slice(MATERIAL_DISK_REF_PREFIX.length);
  const kindQuery = kind === 'image' ? '' : `&kind=${kind}`;
  return `/api/project-cache/material?nodeId=${encodeURIComponent(nodeId)}${kindQuery}`;
}

export function collectNodeMediaExportGroup(node: MediaExportNodeLike): BatchMediaExportGroup | null {
  const nodeType = stringValue(node.data.type) || stringValue(node.type);
  const kind: BatchMediaKind | null = nodeType === 'image'
    ? 'image'
    : nodeType === 'video' ? 'video' : null;
  if (!kind) return null;

  const items = rawHistoryItems(node.data, kind).map((item, index) => ({
    sourceUrl: playableSourceUrl(item.url, kind),
    suggestedName: exportFileName(item, kind, index),
  }));
  if (items.length === 0) return null;

  const label = stringValue(node.data.label) || (kind === 'image' ? '图片节点' : '视频节点');
  return {
    nodeId: node.id,
    folderName: `${label}-素材`,
    items,
  };
}

export function collectNodeMediaExportGroups(nodes: MediaExportNodeLike[]): BatchMediaExportGroup[] {
  return nodes
    .map(collectNodeMediaExportGroup)
    .filter((group): group is BatchMediaExportGroup => Boolean(group));
}

function resolveExportUrl(sourceUrl: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(sourceUrl) || sourceUrl.startsWith('file:')) return sourceUrl;
  return new URL(sourceUrl, window.location.href).toString();
}

async function prepareExportItem(item: BatchMediaExportItem): Promise<BatchMediaExportItem> {
  const sourceUrl = stringValue(item.sourceUrl);
  if (!sourceUrl) return item;
  const resolvedUrl = resolveExportUrl(sourceUrl);
  if (!/^(?:blob:|data:)/i.test(resolvedUrl)) {
    return { ...item, sourceUrl: resolvedUrl };
  }

  try {
    const response = await fetch(resolvedUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return {
      suggestedName: item.suggestedName,
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: blob.type || item.mimeType,
    };
  } catch {
    // 交给桌面端按单个素材记录失败，避免一个已失效的临时地址阻断整批导出。
    return { ...item, sourceUrl: resolvedUrl };
  }
}

export async function exportNodeMediaGroups(
  groups: BatchMediaExportGroup[],
  title = '选择批量保存位置',
  onProgress?: (progress: BatchMediaExportProgress) => void,
): Promise<BatchMediaExportResult> {
  if (groups.length === 0) throw new Error('没有可导出的图片或视频素材');
  const desktopExport = window.magineDesktop?.saveMediaBatch;
  if (!desktopExport) throw new Error('批量导出文件夹仅支持桌面客户端');

  const requestId = `media-batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const totalCount = groups.reduce((total, group) => total + group.items.length, 0);
  onProgress?.({ requestId, completedCount: 0, totalCount, savedCount: 0, failedCount: 0 });
  const unsubscribe = window.magineDesktop?.onMediaBatchProgress?.((progress) => {
    if (progress.requestId === requestId) onProgress?.(progress);
  });

  try {
    const preparedGroups: BatchMediaExportGroup[] = [];
    for (const group of groups) {
      const items: BatchMediaExportItem[] = [];
      for (const item of group.items) items.push(await prepareExportItem(item));
      preparedGroups.push({ ...group, items });
    }

    return await desktopExport({ requestId, title, groups: preparedGroups });
  } finally {
    unsubscribe?.();
  }
}

export function batchMediaExportMessage(result: BatchMediaExportResult): string {
  if (result.canceled) return '';
  const location = result.directory ? `\n保存位置：${result.directory}` : '';
  if (result.savedCount > 0 && result.failedCount === 0) {
    return `批量保存完成，共保存 ${result.savedCount} 个素材。${location}`;
  }
  if (result.savedCount > 0) {
    return `批量保存完成，共保存 ${result.savedCount} 个素材，${result.failedCount} 个素材失败。${location}`;
  }
  return result.error || '批量保存失败，没有素材成功写入';
}

export function batchMediaExportErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error || '未知错误');
  if (/No handler registered for ['"]magine-save-media-batch['"]/i.test(detail)) {
    return '桌面主进程尚未加载批量保存功能，请完全退出并重新打开 MagineCanvas 后重试。';
  }
  return detail;
}

export function showBatchMediaExportError(error: unknown): void {
  const detail = batchMediaExportErrorMessage(error);
  console.error('批量保存失败:', error);
  window.alert(`批量保存失败：${detail}`);
}
