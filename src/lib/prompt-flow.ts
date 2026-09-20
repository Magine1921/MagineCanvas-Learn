import type { Edge, Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';

export interface PromptSource {
  nodeId: string;
  nodeType: CanvasNodeData['type'];
  label: string;
  text: string;
}

export type ConnectedPromptTargetField =
  | 'text'
  | 'prompt'
  | 'panoramaAgentLlmSupplement';

export function getConnectedPromptTargetField(
  nodeType: CanvasNodeData['type'] | string | undefined,
): ConnectedPromptTargetField | null {
  switch (nodeType) {
    case 'prompt':
      return 'text';
    case 'image':
    case 'video':
    case 'music':
    case 'llm':
      return 'prompt';
    case 'panorama':
      return 'panoramaAgentLlmSupplement';
    default:
      return null;
  }
}

function asText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().length > 0 ? value : '';
}

/** Agent 节点默认出点：取最新助手回复等 */
export function getAgentForwardPromptText(data: CanvasNodeData, sourceHandle: string | null): string {
  void sourceHandle;
  const record = data as Record<string, unknown>;
  const h = record.agentChatHistory;
  if (Array.isArray(h) && h.length > 0) {
    for (let j = h.length - 1; j >= 0; j -= 1) {
      const m = h[j] as { role?: unknown; content?: unknown };
      if (m?.role === 'assistant' && typeof m.content === 'string') {
        const t = asText(m.content);
        if (t) return t;
      }
    }
  }
  return asText(record.output) || asText(record.agentPrompt);
}

export function getPromptTextForEdgeSource(
  node: Node<CanvasNodeData>,
  sourceHandle?: string | null
): string {
  const t = node.type;
  if (t === 'agent') {
    return getAgentForwardPromptText(node.data, sourceHandle ?? null);
  }
  return getPromptTextFromNodeData(t, node.data);
}

export function getPromptTextFromNodeData(
  nodeType: string | undefined,
  data: CanvasNodeData
): string {
  const record = data as Record<string, unknown>;

  switch (nodeType) {
    case 'prompt':
      return asText(record.text);
    case 'llm':
    case 'agent': {
      return getAgentForwardPromptText(data, null);
    }
    case 'image':
      return '';
    case 'storyboard':
    case 'panorama':
    case 'topazEnhance':
    case 'material':
      return '';
    case 'video':
      return asText(record.customPrompt) || asText(record.prompt);
    default:
      return '';
  }
}

export function getIncomingPromptSources(
  targetId: string,
  nodes: Node<CanvasNodeData>[],
  edges: Edge[]
): PromptSource[] {
  return edges
    .filter((edge) => edge.target === targetId)
    .map((edge) => {
      const node = nodes.find((n) => n.id === edge.source);
      if (!node || node.type === 'material' || node.type === 'storyboard' || node.type === 'panorama' || node.type === 'topazEnhance') {
        return null;
      }
      const text = getPromptTextForEdgeSource(node, edge.sourceHandle ?? null);
      if (!text) return null;

      return {
        nodeId: node.id,
        nodeType: node.data.type,
        label: typeof node.data.label === 'string' ? node.data.label : '上游节点',
        text,
      };
    })
    .filter((source): source is PromptSource => !!source);
}

export function normalizePromptText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function isSamePromptText(a: string, b: string): boolean {
  return normalizePromptText(a) === normalizePromptText(b);
}

export function composePrompt(parts: Array<string | null | undefined | boolean>): string {
  const seen = new Set<string>();
  const normalizedParts: string[] = [];

  for (const part of parts) {
    if (typeof part !== 'string') continue;
    const text = part.trim();
    if (!text) continue;

    const key = normalizePromptText(text);
    if (seen.has(key)) continue;

    seen.add(key);
    normalizedParts.push(text);
  }

  return normalizedParts.join('\n\n');
}

/** 保证连入的文本可见，同时保留生成节点内已经手动追加的内容。 */
export function mergeConnectedPromptText(upstream: string, local: string): string {
  const upstreamText = upstream.trim();
  const localText = local.trim();
  if (!upstreamText) return local;
  if (!localText) return upstream;

  const normalizedUpstream = normalizePromptText(upstreamText);
  const normalizedLocal = normalizePromptText(localText);
  if (
    normalizedLocal === normalizedUpstream
    || normalizedLocal.includes(normalizedUpstream)
  ) {
    return local;
  }
  if (normalizedUpstream.includes(normalizedLocal)) return upstream;
  return `${upstreamText}\n\n${localText}`;
}
