import type { Edge, Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';
import {
  fetchPanoramaDiskCacheAsDataUrl,
  isPanoramaDiskRef,
  makePanoramaHistoryCacheId,
  panoramaDiskRefToNodeId,
  panoramaNodeIdToDiskRef,
  postPanoramaTexToProjectDiskCache,
} from '@/lib/sync-panorama-project-disk-cache';

function needsPanoramaDiskOffload(tex: string): boolean {
  const t = tex.trim();
  if (!t) return false;
  if (isPanoramaDiskRef(t)) return false;
  if (t.startsWith('data:image/') || t.startsWith('data:application/octet-stream')) return true;
  if (/^https?:\/\//i.test(t)) return true;
  return false;
}

/**
 * 持久化前：将全景主纹理 URL 写入项目 JPG 缓存，并把 `panoramaTexUrl` 换为短引用，减轻 localStorage 与刷新丢图。
 */
export async function offloadPanoramaTexForPersist(workflow: {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
}): Promise<{ nodes: Node<CanvasNodeData>[]; edges: Edge[] }> {
  const nodes = await Promise.all(
    workflow.nodes.map(async (node) => {
      if (node.type !== 'panorama') return node;
      const data = { ...(node.data as Record<string, unknown>) };
      const tex = typeof data.panoramaTexUrl === 'string' ? data.panoramaTexUrl : '';
      let changed = false;

      if (needsPanoramaDiskOffload(tex)) {
        const ok = await postPanoramaTexToProjectDiskCache(node.id, tex);
        if (ok) {
          data.panoramaTexUrl = panoramaNodeIdToDiskRef(node.id);
          changed = true;
        }
      }

      if (Array.isArray(data.panoramaTexHistory)) {
        const history = await Promise.all(
          data.panoramaTexHistory.map(async (item, index) => {
            if (!item || typeof item !== 'object') return item;
            const next = { ...(item as Record<string, unknown>) };
            const url = typeof next.url === 'string' ? next.url : '';
            if (!needsPanoramaDiskOffload(url)) return item;
            const createdAt = typeof next.createdAt === 'number' ? next.createdAt : Date.now() + index;
            const cacheId = makePanoramaHistoryCacheId(node.id, createdAt);
            const ok = await postPanoramaTexToProjectDiskCache(cacheId, url);
            if (!ok) return item;
            next.url = panoramaNodeIdToDiskRef(cacheId);
            changed = true;
            return next;
          })
        );
        data.panoramaTexHistory = history;
      }

      if (!changed) return node;
      return {
        ...node,
        data: {
          ...data,
        } as unknown as CanvasNodeData,
      };
    })
  );
  return { edges: workflow.edges, nodes };
}

export async function hydratePanoramaDiskRefsInNodes(
  nodes: Node<CanvasNodeData>[]
): Promise<Node<CanvasNodeData>[]> {
  return Promise.all(
    nodes.map(async (node) => {
      if (node.type !== 'panorama') return node;
      const data = { ...(node.data as Record<string, unknown>) };
      const tex = typeof data.panoramaTexUrl === 'string' ? data.panoramaTexUrl : '';
      if (!isPanoramaDiskRef(tex)) return node;
      let nodeId: string;
      try {
        nodeId = panoramaDiskRefToNodeId(tex);
      } catch {
        return node;
      }
      const restored = await fetchPanoramaDiskCacheAsDataUrl(nodeId);
      if (!restored) return node;
      return {
        ...node,
        data: {
          ...data,
          panoramaTexUrl: restored,
        } as unknown as CanvasNodeData,
      };
    })
  );
}
