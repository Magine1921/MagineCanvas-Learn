import type { Edge, Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';
import {
  getMaterialBlob,
  isMaterialIdbRef,
  materialNodeIdToRef,
  materialRefToNodeId,
  putMaterialBlob,
} from './canvas-material-idb';
import { fetchMaterialDiskCacheAsDataUrl } from './sync-material-project-disk-cache';

function hasInlineDataUrl(url: string): boolean {
  return url.trim().startsWith('data:');
}

/**
 * 将素材节点中的 data URL 写入 IndexedDB，并把 fileUrl/thumbnailUrl 替换为短引用，便于 localStorage 稳定保存。
 * 写入失败时保留原字段，由上层决定是否仍尝试 setItem。
 */
export async function offloadMaterialDataUrlsForPersist(workflow: {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
}): Promise<{ nodes: Node<CanvasNodeData>[]; edges: Edge[] }> {
  const nodes = await Promise.all(
    workflow.nodes.map(async (node) => {
      if (node.type !== 'material') return node;
      const data = { ...(node.data as Record<string, unknown>) };
      const fileUrl = typeof data.fileUrl === 'string' ? data.fileUrl : '';
      const thumbUrl = typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : '';
      if (isMaterialIdbRef(fileUrl) && isMaterialIdbRef(thumbUrl)) {
        return node;
      }
      const need = hasInlineDataUrl(fileUrl) || hasInlineDataUrl(thumbUrl);
      if (!need) return node;

      try {
        await putMaterialBlob(node.id, {
          fileUrl: fileUrl || thumbUrl,
          thumbnailUrl: thumbUrl || fileUrl,
        });
        const ref = materialNodeIdToRef(node.id);
        return {
          ...node,
          data: {
            ...data,
            fileUrl: ref,
            thumbnailUrl: ref,
          } as unknown as CanvasNodeData,
        };
      } catch {
        return node;
      }
    })
  );
  return { edges: workflow.edges, nodes };
}

export async function hydrateMaterialIdbRefsInNodes(
  nodes: Node<CanvasNodeData>[]
): Promise<Node<CanvasNodeData>[]> {
  return Promise.all(
    nodes.map(async (node) => {
      if (node.type !== 'material') return node;
      const data = node.data as Record<string, unknown>;
      const fu = typeof data.fileUrl === 'string' ? data.fileUrl : '';
      if (!isMaterialIdbRef(fu)) return node;
      let nodeId: string;
      try {
        nodeId = materialRefToNodeId(fu);
      } catch {
        return node;
      }
      const blob = await getMaterialBlob(nodeId);
      if (blob) {
        return {
          ...node,
          data: {
            ...data,
            fileUrl: blob.fileUrl,
            thumbnailUrl: blob.thumbnailUrl,
          } as unknown as CanvasNodeData,
        };
      }
      const diskUrl = await fetchMaterialDiskCacheAsDataUrl(nodeId);
      if (diskUrl) {
        try {
          await putMaterialBlob(nodeId, { fileUrl: diskUrl, thumbnailUrl: diskUrl });
        } catch {
          /* */
        }
        return {
          ...node,
          data: {
            ...data,
            fileUrl: diskUrl,
            thumbnailUrl: diskUrl,
          } as unknown as CanvasNodeData,
        };
      }
      return node;
    })
  );
}
