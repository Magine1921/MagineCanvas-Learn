import type { Edge, Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';

export interface ConnectedMaterialMedia {
  sourceNodeId: string;
  fileUrl: string;
  thumbnailUrl?: string;
  fileName: string;
  fileType: 'image' | 'video';
  aspectW?: number;
  aspectH?: number;
}

function recordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function mediaAspect(value: unknown): { aspectW?: number; aspectH?: number } {
  const match = stringValue(value).match(/(\d+(?:\.\d+)?)\s*(?::|\/|x|×)\s*(\d+(?:\.\d+)?)/i);
  if (!match) return {};
  const aspectW = Number(match[1]);
  const aspectH = Number(match[2]);
  return aspectW > 0 && aspectH > 0 ? { aspectW, aspectH } : {};
}

function imageNodeMedia(node: Node<CanvasNodeData>): ConnectedMaterialMedia | null {
  const data = node.data as Record<string, unknown>;
  const history = recordList(data.generatedImages);
  const activeId = stringValue(data.activeGeneratedImageId);
  const selected = history.find((item) => activeId && stringValue(item.id) === activeId);
  const dataUrl = stringValue(data.imageUrl);
  const item = selected || history.find((candidate) => stringValue(candidate.imageUrl) === dataUrl) || history[0];
  const fileUrl = stringValue(selected?.imageUrl) || dataUrl || stringValue(item?.imageUrl);
  const label = stringValue(data.label) || '图片节点';
  return {
    sourceNodeId: node.id,
    fileUrl,
    thumbnailUrl: stringValue(item?.thumbnailUrl) || fileUrl || undefined,
    fileName: stringValue(item?.fileName) || `${label}.png`,
    fileType: 'image',
    ...mediaAspect(item?.size || item?.aspectRatio || data.aspectRatio),
  };
}

function videoNodeMedia(node: Node<CanvasNodeData>): ConnectedMaterialMedia | null {
  const data = node.data as Record<string, unknown>;
  const history = recordList(data.generatedVideos);
  const activeId = stringValue(data.activeGeneratedVideoId);
  const selected = history.find((item) => activeId && stringValue(item.id) === activeId);
  const dataUrl = stringValue(data.videoUrl);
  const item = selected || history.find((candidate) => stringValue(candidate.videoUrl) === dataUrl) || history[0];
  const fileUrl = stringValue(selected?.videoUrl) || dataUrl || stringValue(item?.videoUrl);
  const label = stringValue(data.label) || '视频节点';
  return {
    sourceNodeId: node.id,
    fileUrl,
    thumbnailUrl: stringValue(item?.posterUrl) || stringValue(data.posterUrl) || stringValue(data.thumbnailUrl) || undefined,
    fileName: stringValue(item?.fileName) || stringValue(data.fileName) || `${label}.mp4`,
    fileType: 'video',
    ...mediaAspect(item?.ratio || data.ratio),
  };
}

export function resolveConnectedMaterialMedia(
  targetId: string,
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
): ConnectedMaterialMedia | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index];
    if (edge.target !== targetId) continue;
    const source = nodeById.get(edge.source);
    if (source?.type === 'image') {
      return imageNodeMedia(source);
    }
    if (source?.type === 'video') {
      return videoNodeMedia(source);
    }
  }
  return null;
}
