import type { Edge, Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';
import { isPanoramaDiskRef } from '@/lib/sync-panorama-project-disk-cache';

export type TopazInboundMediaKind = 'image' | 'video';

/** 上游为视频时可播放地址；否则空 */
function resolveVideoNodePlayableUrl(d: Record<string, unknown>): string {
  const direct = typeof d.videoUrl === 'string' ? d.videoUrl.trim() : '';
  if (direct) return direct;
  const gv = d.generatedVideos;
  if (!Array.isArray(gv) || gv.length === 0) return '';
  for (let i = gv.length - 1; i >= 0; i -= 1) {
    const it = gv[i];
    if (!it || typeof it !== 'object') continue;
    const u = typeof (it as Record<string, unknown>).videoUrl === 'string'
      ? String((it as Record<string, unknown>).videoUrl).trim()
      : '';
    if (u) return u;
  }
  return '';
}

/** 画质节点对外展示的图像（历史回看时可能覆盖 outputImageUrl） */
export function resolveTopazEffectiveImageUrl(d: Record<string, unknown>): string {
  const view = typeof d.topazViewingImageUrl === 'string' ? d.topazViewingImageUrl.trim() : '';
  const out = typeof d.outputImageUrl === 'string' ? d.outputImageUrl.trim() : '';
  return view || out;
}

/** 画质节点对外展示的视频 */
export function resolveTopazEffectiveVideoUrl(d: Record<string, unknown>): string {
  const view = typeof d.topazViewingVideoUrl === 'string' ? d.topazViewingVideoUrl.trim() : '';
  const out = typeof d.outputVideoUrl === 'string' ? d.outputVideoUrl.trim() : '';
  return view || out;
}

/** 下游是否应按「视频」语义接收画质节点的输出（单出点时据此在图/视频间自动选择） */
export function consumerWantsTopazOutboundVideo(target: Node<CanvasNodeData> | undefined): boolean {
  if (!target) return false;
  if (target.type === 'video') return true;
  if (target.type === 'topazEnhance') {
    const td = target.data as Record<string, unknown>;
    return td.topazPanelMode === 'video';
  }
  if (target.type === 'material') {
    const ft = String((target.data as Record<string, unknown>).fileType || '').toLowerCase();
    return ft === 'video';
  }
  return false;
}

function classifyInboundKind(
  sourceNode: Node<CanvasNodeData>,
  edge: Edge,
  nodes: Node<CanvasNodeData>[]
): TopazInboundMediaKind | null {
  const d = sourceNode.data as Record<string, unknown>;
  const typ = String(sourceNode.type ?? d.type ?? '');
  if (typ === 'video') return 'video';
  if (typ === 'image') return 'image';
  if (typ === 'material') {
    const ft = typeof d.fileType === 'string' ? d.fileType : '';
    return ft === 'video' ? 'video' : 'image';
  }
  if (typ === 'storyboard' || typ === 'panorama') return 'image';
  if (typ === 'topazEnhance') {
    const target = nodes.find((x) => x.id === edge.target);
    const vid = resolveTopazEffectiveVideoUrl(d);
    const img = resolveTopazEffectiveImageUrl(d);
    if (consumerWantsTopazOutboundVideo(target)) {
      if (vid) return 'video';
      if (img) return 'image';
      return null;
    }
    if (img) return 'image';
    if (vid) return 'video';
    return null;
  }
  return null;
}

/** 第一条入边上游的素材类型（画质单出点：按下游节点自动判定图 / 视频） */
export function resolveTopazInboundKind(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
  targetId: string
): TopazInboundMediaKind | null {
  for (const e of edges) {
    if (e.target !== targetId) continue;
    const n = nodes.find((x) => x.id === e.source);
    if (!n?.data) continue;
    const k = classifyInboundKind(n, e, nodes);
    if (k) return k;
  }
  return null;
}

/** 可播放视频 URL（视频节点 / 视频素材）；非视频源为空 */
export function resolveTopazInboundVideoUrl(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
  targetId: string
): string {
  const consumer = nodes.find((x) => x.id === targetId);
  for (const e of edges) {
    if (e.target !== targetId) continue;
    const n = nodes.find((x) => x.id === e.source);
    if (!n?.data) continue;
    const d = n.data as Record<string, unknown>;
    const typ = String(n.type ?? d.type ?? '');
    if (typ === 'video') {
      const u = resolveVideoNodePlayableUrl(d);
      if (u) return u;
    }
    if (typ === 'material' && d.fileType === 'video') {
      const fileUrl = typeof d.fileUrl === 'string' ? d.fileUrl.trim() : '';
      if (fileUrl) return fileUrl;
    }
    if (typ === 'topazEnhance' && consumerWantsTopazOutboundVideo(consumer)) {
      const u = resolveTopazEffectiveVideoUrl(d);
      if (u) return u;
    }
  }
  return '';
}

/** 与 ImageNode「当前展示图」一致 */
function resolveImageNodeBaseUrl(d: Record<string, unknown>): string {
  const direct = typeof d.imageUrl === 'string' ? d.imageUrl.trim() : '';
  if (direct) return direct;
  const raw = d.generatedImages;
  if (!Array.isArray(raw) || raw.length === 0) return '';
  let best = '';
  let bestAt = -1;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const u = typeof r.imageUrl === 'string' ? r.imageUrl.trim() : '';
    const ca = typeof r.createdAt === 'number' ? r.createdAt : 0;
    if (u && ca >= bestAt) {
      best = u;
      bestAt = ca;
    }
  }
  return best;
}

function resolveMaterialLikeUrl(d: Record<string, unknown>): string {
  const fileUrl = typeof d.fileUrl === 'string' ? d.fileUrl.trim() : '';
  const seedId = typeof d.seedanceAssetId === 'string' ? d.seedanceAssetId.trim() : '';
  const seedUri =
    (typeof d.seedanceAssetUri === 'string' ? d.seedanceAssetUri.trim() : '') ||
    (seedId ? `asset://${seedId}` : '');
  const thumb = typeof d.thumbnailUrl === 'string' ? d.thumbnailUrl.trim() : '';
  const fileType = typeof d.fileType === 'string' ? d.fileType.toLowerCase() : '';
  if (fileType === 'video' && thumb) return thumb;
  return fileUrl || seedUri || thumb;
}

function resolveFromNode(node: Node<CanvasNodeData>, edge: Edge, nodes: Node<CanvasNodeData>[]): string {
  const d = node.data as Record<string, unknown>;
  const typ = String(node.type ?? d.type ?? '');

  if (typ === 'image') {
    return resolveImageNodeBaseUrl(d);
  }
  if (typ === 'material' || typ === 'storyboard') {
    return resolveMaterialLikeUrl(d);
  }
  if (typ === 'panorama') {
    const u = typeof d.panoramaTexUrl === 'string' ? d.panoramaTexUrl.trim() : '';
    if (isPanoramaDiskRef(u)) return u;
    if (u.startsWith('data:') || u.startsWith('http') || u.startsWith('https') || u.startsWith('blob:')) {
      return u;
    }
    return '';
  }
  if (typ === 'video') {
    const poster = typeof d.posterUrl === 'string' ? d.posterUrl.trim() : '';
    const thumb = typeof d.thumbnailUrl === 'string' ? d.thumbnailUrl.trim() : '';
    if (poster || thumb) return poster || thumb;
    const gv = d.generatedVideos;
    if (Array.isArray(gv) && gv.length > 0) {
      for (let i = gv.length - 1; i >= 0; i -= 1) {
        const it = gv[i];
        if (!it || typeof it !== 'object') continue;
        const o = it as Record<string, unknown>;
        const p = typeof o.posterUrl === 'string' ? o.posterUrl.trim() : '';
        if (p) return p;
      }
    }
    return '';
  }
  if (typ === 'topazEnhance') {
    return resolveTopazEffectiveImageUrl(d);
  }
  return '';
}

/** 取指向本节点的第一条入边来源上的可用图像 URL（用于 Topaz 画质增强） */
export function resolveTopazInboundImageUrl(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
  targetId: string
): string {
  for (const e of edges) {
    if (e.target !== targetId) continue;
    const n = nodes.find((x) => x.id === e.source);
    if (!n?.data) continue;
    const url = resolveFromNode(n, e, nodes);
    if (url) return url;
  }
  return '';
}
