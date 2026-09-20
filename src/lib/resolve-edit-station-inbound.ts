import type { Edge, Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';
import type { EditClipSourceKind, EditMediaKind, InboundEditClipCandidate } from '@/lib/edit-timeline-types';
import {
  resolveTopazEffectiveImageUrl,
  resolveTopazEffectiveVideoUrl,
} from '@/lib/resolve-topaz-inbound-url';

function resolveVideoNodePlayableUrl(d: Record<string, unknown>): string {
  const direct = typeof d.videoUrl === 'string' ? d.videoUrl.trim() : '';
  if (direct) return direct;
  const gv = d.generatedVideos;
  if (!Array.isArray(gv) || gv.length === 0) return '';
  for (let i = gv.length - 1; i >= 0; i -= 1) {
    const it = gv[i];
    if (!it || typeof it !== 'object') continue;
    const u =
      typeof (it as Record<string, unknown>).videoUrl === 'string'
        ? String((it as Record<string, unknown>).videoUrl).trim()
        : '';
    if (u) return u;
  }
  return '';
}

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

function mediaKindFromMaterial(fileType: string): EditMediaKind {
  const ft = fileType.toLowerCase();
  if (ft === 'video' || ft.startsWith('video/')) return 'video';
  if (ft === 'audio' || ft.startsWith('audio/')) return 'audio';
  return 'image';
}

function resolveFromSourceNode(node: Node<CanvasNodeData>): InboundEditClipCandidate | null {
  const d = node.data as Record<string, unknown>;
  const typ = String(node.type ?? d.type ?? '') as EditClipSourceKind | string;

  if (typ === 'material') {
    const fileUrl = typeof d.fileUrl === 'string' ? d.fileUrl.trim() : '';
    const fileType = typeof d.fileType === 'string' ? d.fileType : 'image';
    const fileName = typeof d.fileName === 'string' ? d.fileName.trim() : '';
    const thumb = typeof d.thumbnailUrl === 'string' ? d.thumbnailUrl.trim() : '';
    if (!fileUrl) return null;
    return {
      sourceNodeId: node.id,
      sourceKind: 'material',
      mediaKind: mediaKindFromMaterial(fileType),
      url: fileUrl,
      fileName: fileName || undefined,
      thumbnailUrl: thumb || undefined,
    };
  }

  if (typ === 'video') {
    const url = resolveVideoNodePlayableUrl(d);
    if (!url) return null;
    return {
      sourceNodeId: node.id,
      sourceKind: 'video',
      mediaKind: 'video',
      url,
      fileName: typeof d.fileName === 'string' ? d.fileName.trim() || undefined : undefined,
    };
  }

  if (typ === 'image') {
    const url = resolveImageNodeBaseUrl(d);
    if (!url) return null;
    let fn = '';
    try {
      const path = new URL(url, 'https://canvas.invalid').pathname;
      const m = /\.([a-z0-9]+)$/i.exec(path);
      if (m) fn = `image.${m[1].toLowerCase()}`;
    } catch {
      /* ignore */
    }
    if (!fn) fn = 'image.png';
    return {
      sourceNodeId: node.id,
      sourceKind: 'image',
      mediaKind: 'image',
      url,
      fileName: fn,
    };
  }

  if (typ === 'storyboard') {
    const url = typeof d.fileUrl === 'string' ? d.fileUrl.trim() : '';
    if (!url) return null;
    return {
      sourceNodeId: node.id,
      sourceKind: 'storyboard',
      mediaKind: 'image',
      url,
      fileName: typeof d.fileName === 'string' ? d.fileName.trim() || 'storyboard.png' : 'storyboard.png',
    };
  }

  if (typ === 'topazEnhance') {
    const vid = resolveTopazEffectiveVideoUrl(d);
    if (vid) {
      return {
        sourceNodeId: node.id,
        sourceKind: 'topazEnhance',
        mediaKind: 'video',
        url: vid,
        fileName: 'enhanced.mp4',
      };
    }
    const img = resolveTopazEffectiveImageUrl(d);
    if (img) {
      return {
        sourceNodeId: node.id,
        sourceKind: 'topazEnhance',
        mediaKind: 'image',
        url: img,
        fileName: 'enhanced.png',
      };
    }
    return null;
  }

  return null;
}

/** 解析指向剪辑台节点的入边素材（同一源节点仅保留一条） */
export function resolveEditStationInboundClips(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
  targetId: string
): InboundEditClipCandidate[] {
  const bySource = new Map<string, InboundEditClipCandidate>();
  for (const e of edges) {
    if (e.target !== targetId) continue;
    const n = nodes.find((x) => x.id === e.source);
    if (!n?.data) continue;
    const c = resolveFromSourceNode(n);
    if (c) bySource.set(c.sourceNodeId, c);
  }
  return [...bySource.values()];
}
