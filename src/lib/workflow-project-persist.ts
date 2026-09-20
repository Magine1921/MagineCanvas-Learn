import type { Edge, Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';
import { offloadMaterialDataUrlsForPersist } from '@/lib/canvas-persist-material-offload';
import { offloadPanoramaTexForPersist } from '@/lib/canvas-persist-panorama-offload';
import { offloadImageVideoForPersist } from '@/lib/canvas-persist-image-video-offload';
import { generatedImageCacheKey, generatedVideoCacheKey } from '@/lib/persist-generated-media';

const DISK_REF_PREFIX = 'disk://magine/material/v1/';

function materialCacheIdFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  if (url.startsWith(DISK_REF_PREFIX)) return url.slice(DISK_REF_PREFIX.length);
  if (!url.includes('/api/project-cache/material')) return null;
  try {
    const parsed = new URL(url, 'http://magine.local');
    if (parsed.pathname !== '/api/project-cache/material') return null;
    return parsed.searchParams.get('nodeId')?.trim() || null;
  } catch {
    return null;
  }
}

function generatedVideoItemCacheKey(nodeId: string, item: unknown, index: number): string {
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    const fromVideo = materialCacheIdFromUrl(o.videoUrl);
    if (fromVideo) return fromVideo;
    if (typeof o.cacheKey === 'string' && o.cacheKey.trim()) return o.cacheKey.trim();
    const fromPoster = materialCacheIdFromUrl(o.posterUrl)?.replace(/-poster$/, '');
    if (fromPoster) return fromPoster;
    if (typeof o.id === 'string') {
      const match = /^generated-video-(\d+)$/.exec(o.id);
      if (match) return generatedVideoCacheKey(nodeId, Number(match[1]));
    }
  }
  return generatedVideoCacheKey(nodeId, index);
}

function addDiskRefCacheId(ids: Set<string>, url: unknown): void {
  if (typeof url !== 'string') return;
  if (url.startsWith(DISK_REF_PREFIX)) {
    ids.add(url.slice(DISK_REF_PREFIX.length));
    return;
  }
  if (!url.includes('/api/project-cache/material')) return;
  try {
    const parsed = new URL(url, 'http://magine.local');
    if (parsed.pathname === '/api/project-cache/material') {
      const nodeId = parsed.searchParams.get('nodeId')?.trim();
      if (nodeId) ids.add(nodeId);
    }
  } catch {
    /* ignore malformed cache urls */
  }
}

/** 工作流引用的全部素材磁盘缓存 id（material / image / video / faceCompliance），供 GC 保留 */
export function collectMaterialDiskCacheKeepIds(nodes: Node<CanvasNodeData>[]): string[] {
  const ids = new Set<string>();

  for (const node of nodes) {
    const data = node.data as Record<string, unknown>;

    if (node.type === 'material') {
      ids.add(node.id);
      continue;
    }

    if (node.type === 'image') {
      ids.add(node.id);
      addDiskRefCacheId(ids, data.imageUrl);
      const genImages = data.generatedImages;
      if (Array.isArray(genImages)) {
        genImages.forEach((item, i) => {
          ids.add(generatedImageCacheKey(node.id, i));
          ids.add(`${generatedImageCacheKey(node.id, i)}-thumb`);
          if (item && typeof item === 'object') {
            const o = item as Record<string, unknown>;
            addDiskRefCacheId(ids, o.imageUrl);
            addDiskRefCacheId(ids, o.thumbnailUrl);
          }
        });
      }
      continue;
    }

    if (node.type === 'video') {
      ids.add(node.id);
      addDiskRefCacheId(ids, data.videoUrl);
      const genVideos = data.generatedVideos;
      if (Array.isArray(genVideos)) {
        genVideos.forEach((item, i) => {
          const key = generatedVideoItemCacheKey(node.id, item, i);
          ids.add(key);
          ids.add(`${key}-poster`);
          if (item && typeof item === 'object') {
            const o = item as Record<string, unknown>;
            addDiskRefCacheId(ids, o.videoUrl);
            addDiskRefCacheId(ids, o.posterUrl);
          }
        });
      }
      continue;
    }

    if (node.type === 'faceCompliance') {
      ids.add(node.id);
      ids.add(`${node.id}-input`);
      addDiskRefCacheId(ids, data.outputImageUrl);
      addDiskRefCacheId(ids, data.inputImageUrl);
      const results = data.processedResults;
      if (Array.isArray(results)) {
        results.forEach((item, i) => {
          ids.add(`${node.id}-fc-${i}`);
          ids.add(`${node.id}-fc-${i}-input`);
          if (item && typeof item === 'object') {
            const o = item as Record<string, unknown>;
            addDiskRefCacheId(ids, o.outputUrl);
            addDiskRefCacheId(ids, o.inputUrl);
          }
        });
      }
    }
  }

  return [...ids];
}

/** 项目持久化：素材 / 全景 / 图视频生成结果统一落盘并替换为 disk:// 引用 */
export async function offloadWorkflowForProjectPersist(workflow: {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
}): Promise<{ nodes: Node<CanvasNodeData>[]; edges: Edge[] }> {
  const offMat = await offloadMaterialDataUrlsForPersist(workflow);
  const offPano = await offloadPanoramaTexForPersist(offMat);
  return offloadImageVideoForPersist(offPano);
}
