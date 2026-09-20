/**
 * 媒体总线（Media Bus）：无限画布入边 → 剪辑台素材池的路由与元数据归一化。
 * 缩略图重型管线见 edit-station-thumbnail-pipeline.ts（WebCodecs / Worker 扩展点）。
 */
import type { Edge, Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';
import type { InboundEditClipCandidate } from '@/lib/edit-timeline-types';
import { resolveEditStationInboundClips } from '@/lib/resolve-edit-station-inbound';

export type MediaBusInbound = InboundEditClipCandidate;

export function resolveMediaBusInbound(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
  editStationNodeId: string
): MediaBusInbound[] {
  return resolveEditStationInboundClips(nodes, edges, editStationNodeId);
}
