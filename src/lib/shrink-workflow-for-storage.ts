import type { Edge, Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';
import { isPanoramaDiskRef } from '@/lib/sync-panorama-project-disk-cache';

/**
 * 超长 data URL 截断，避免整份 JSON 撑爆 localStorage。
 * 主图 / 全景等用较大上限，刷新后仍能恢复常见生成结果；缩略图与参考图用较小上限以控制总体积。
 */
const MAX_DATA_URL_PREMIUM = 1_400_000;
const MAX_DATA_URL_STANDARD = 220_000;

function truncateDataUrl(value: unknown, maxLen: number): unknown {
  if (typeof value !== 'string') return value;
  if (!value.startsWith('data:')) return value;
  if (value.length <= maxLen) return value;
  return '';
}

const PREMIUM_DATA_URL_KEYS = new Set<string>([
  'panoramaTexUrl',
  'imageUrl',
  'outputImageUrl',
  'outputVideoUrl',
  'topazViewingImageUrl',
  'topazViewingVideoUrl',
  'panoramaAgentSceneImageDataUrl',
  'fileUrl',
  'imageRef',
]);

function shrinkGeneratedImages(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const o = { ...(item as Record<string, unknown>) };
    o.imageUrl = truncateDataUrl(o.imageUrl, MAX_DATA_URL_PREMIUM);
    o.thumbnailUrl = truncateDataUrl(o.thumbnailUrl, MAX_DATA_URL_STANDARD);
    return o;
  });
}

function shrinkGeneratedVideos(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const o = { ...(item as Record<string, unknown>) };
    o.videoUrl = truncateDataUrl(o.videoUrl, MAX_DATA_URL_PREMIUM);
    o.posterUrl = truncateDataUrl(o.posterUrl, MAX_DATA_URL_STANDARD);
    return o;
  });
}

function shrinkPanoramaTexHistory(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return item;
      const o = { ...(item as Record<string, unknown>) };
      if (typeof o.url === 'string') {
        o.url = truncateDataUrl(o.url, MAX_DATA_URL_PREMIUM);
      }
      return o;
    })
    .filter((x) => {
      if (!x || typeof x !== 'object') return false;
      const url = (x as { url?: unknown }).url;
      return typeof url === 'string' && url.trim().length > 0;
    });
}

/**
 * 缩小写入 localStorage 的工作流体积。
 * - 分镜：去掉可再由 strokes+底图重算的导出 PNG。
 * - 素材节点：`fileUrl` / `thumbnailUrl` 不在此截断（大图由 IndexedDB 侧车 + 短引用持久化）。
 */
export function shrinkWorkflowForLocalStorage(workflow: {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
}): { nodes: Node<CanvasNodeData>[]; edges: Edge[] } {
  const keysToClamp = [
    'fileUrl',
    'thumbnailUrl',
    'imageUrl',
    'imageRef',
    'videoUrl',
    'panoramaTexUrl',
    'panoramaAgentSceneImageDataUrl',
    'outputImageUrl',
    'outputVideoUrl',
    'topazViewingImageUrl',
    'topazViewingVideoUrl',
  ] as const;

  return {
    edges: workflow.edges,
    nodes: workflow.nodes.map((node) => {
      const data = { ...(node.data as Record<string, unknown>) };

      if (node.type === 'storyboard') {
        data.fileUrl = '';
      }

      for (const key of keysToClamp) {
        if (key in data) {
          if (node.type === 'material' && (key === 'fileUrl' || key === 'thumbnailUrl')) {
            continue;
          }
          if (key === 'panoramaTexUrl' && isPanoramaDiskRef(data[key])) {
            continue;
          }
          const max = PREMIUM_DATA_URL_KEYS.has(key) ? MAX_DATA_URL_PREMIUM : MAX_DATA_URL_STANDARD;
          data[key] = truncateDataUrl(data[key], max);
        }
      }

      if (node.type === 'panorama' && Array.isArray(data.panoramaTexHistory)) {
        data.panoramaTexHistory = shrinkPanoramaTexHistory(data.panoramaTexHistory);
      }

      if (node.type === 'topazEnhance') {
        for (const key of ['topazImageHistory', 'topazVideoHistory'] as const) {
          const arr = data[key];
          if (!Array.isArray(arr)) continue;
          (data as Record<string, unknown>)[key] = arr.map((item: unknown) =>
            truncateDataUrl(item, MAX_DATA_URL_STANDARD)
          );
        }
      }

      if (node.type === 'image' && Array.isArray(data.generatedImages)) {
        data.generatedImages = shrinkGeneratedImages(data.generatedImages);
      }

      if (node.type === 'video' && Array.isArray(data.generatedVideos)) {
        data.generatedVideos = shrinkGeneratedVideos(data.generatedVideos);
      }

      if (node.type === 'faceCompliance' && Array.isArray(data.processedResults)) {
        data.processedResults = (data.processedResults as Array<Record<string, unknown>>).map((item) => {
          const next = { ...item };
          next.outputUrl = truncateDataUrl(next.outputUrl, MAX_DATA_URL_PREMIUM);
          next.inputUrl = truncateDataUrl(next.inputUrl, MAX_DATA_URL_STANDARD);
          return next;
        });
      }

      return { ...node, className: undefined, data: data as CanvasNodeData };
    }),
  };
}

/** 配额仍不足时：移除任意嵌套对象中超过 maxLen 的 data URL（最后手段） */
export function stripLargeDataUrlsDeep(
  workflow: { nodes: Node<CanvasNodeData>[]; edges: Edge[] },
  maxLen: number
): { nodes: Node<CanvasNodeData>[]; edges: Edge[] } {
  const stripVal = (v: unknown, preserveMaterialMedia: boolean): unknown => {
    if (typeof v === 'string') {
      if (v.startsWith('data:') && v.length > maxLen) return '';
      return v;
    }
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => stripVal(x, false));
    const o = { ...(v as Record<string, unknown>) };
    for (const k of Object.keys(o)) {
      if (preserveMaterialMedia && (k === 'fileUrl' || k === 'thumbnailUrl')) continue;
      o[k] = stripVal(o[k], false);
    }
    return o;
  };

  return {
    edges: workflow.edges,
    nodes: workflow.nodes.map((node) => ({
      ...node,
      data: stripVal(node.data, node.type === 'material') as CanvasNodeData,
    })),
  };
}
