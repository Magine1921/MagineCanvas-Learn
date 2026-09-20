import type { Edge, Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';

export type EngineeringProjectSnapshotV1 = {
  version: 1;
  projectId: string;
  savedAt: number;
  title: string;
  description?: string;
  coverImage?: string | null;
  createdAt: number;
  updatedAt: number;
  workflow: { nodes: Node<CanvasNodeData>[]; edges: Edge[] };
};

export async function postEngineeringProjectSnapshot(
  snapshot: EngineeringProjectSnapshotV1
): Promise<boolean> {
  try {
    const r = await fetch('/api/project-cache/engineering', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
