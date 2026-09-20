import type { Connection, Edge, Node } from 'reactflow';
import { addEdge, MarkerType } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';

/** 与节点组件中 source Handle 的 id 约定一致（undefined/null 表示默认柄） */
export function supportsSourceHandle(
  nodeType: CanvasNodeData['type'] | undefined,
  handle: string | null
): boolean {
  if (!nodeType) return false;
  switch (nodeType) {
    case 'image':
      return handle === 'image';
    case 'video':
      return handle === 'video';
    case 'llm':
      return handle === 'output';
    case 'prompt':
    case 'material':
    case 'storyboard':
      return handle === null;
    case 'topazEnhance':
      return handle === 'out' || handle === 'image' || handle === 'video' || handle === null;
    case 'agent':
      return handle === null;
    case 'browser':
      return handle === null;
    case 'faceCompliance':
      return handle === null;
    case 'region':
      return false;
    default:
      return false;
  }
}

function edgeAlreadyExists(
  edges: Edge[],
  source: string,
  target: string,
  sourceHandle: string | null,
  targetHandle: string | null
): boolean {
  return edges.some(
    (e) =>
      e.source === source &&
      e.target === target &&
      (e.sourceHandle ?? null) === sourceHandle &&
      (e.targetHandle ?? null) === targetHandle
  );
}

/**
 * 多选节点时从其一拖出连线：对所有「已选 + 同类型 + 同一 source 柄」的节点各连一条到同一目标。
 * 否则仅返回拖拽起点节点 id。
 */
export function resolveConnectSources(
  connection: Connection,
  nodes: Node<CanvasNodeData>[]
): string[] {
  const srcId = connection.source;
  const tgtId = connection.target;
  if (!srcId || !tgtId || srcId === tgtId) return srcId ? [srcId] : [];

  const sourceNode = nodes.find((n) => n.id === srcId);
  if (!sourceNode) return [srcId];

  const sourceHandle = connection.sourceHandle ?? null;
  const srcType = sourceNode.data?.type;
  if (!srcType || !supportsSourceHandle(srcType, sourceHandle)) return [srcId];
  if (!sourceNode.selected) return [srcId];

  const selected = nodes.filter((n) => n.selected);
  if (selected.length < 2) return [srcId];

  const batch = selected
    .filter(
      (n) =>
        n.id !== tgtId &&
        n.data?.type === srcType &&
        supportsSourceHandle(n.data?.type, sourceHandle)
    )
    .map((n) => n.id);

  if (batch.length >= 2 && batch.includes(srcId)) return batch;
  return [srcId];
}

export function appendBeamConnectionsFromSources(
  connection: Connection,
  nodes: Node<CanvasNodeData>[],
  edges: Edge[]
): { edges: Edge[]; added: number } {
  const tgtId = connection.target;
  if (!tgtId) return { edges, added: 0 };

  const sources = resolveConnectSources(connection, nodes);
  const sourceHandle = connection.sourceHandle ?? null;
  const targetHandle = connection.targetHandle ?? null;

  const beamDefaults = {
    type: 'beam' as const,
    animated: false,
    style: { strokeWidth: 1.5 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: '#FB923C',
      width: 12,
      height: 12,
    },
  };

  let next = edges;
  let added = 0;

  for (const source of sources) {
    if (source === tgtId) continue;
    if (edgeAlreadyExists(next, source, tgtId, sourceHandle, targetHandle)) continue;
    const partial: Connection = {
      source,
      target: tgtId,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
    };
    next = addEdge({ ...beamDefaults, ...partial }, next);
    added += 1;
  }

  return { edges: next, added };
}
