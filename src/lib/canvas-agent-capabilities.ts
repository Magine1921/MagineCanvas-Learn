export type CanvasAgentNodeType =
  | 'prompt'
  | 'image'
  | 'video'
  | 'llm'
  | 'agent'
  | 'material'
  | 'region'
  | 'storyboard'
  | 'panorama'
  | 'topazEnhance'
  | 'faceCompliance'
  | 'music'
  | 'browser';

export type CanvasAgentNodeAction =
  | 'inspect'
  | 'configure'
  | 'move'
  | 'resize'
  | 'generate'
  | 'select_output'
  | 'navigate'
  | 'reload'
  | 'back'
  | 'forward'
  | 'export_frame'
  | 'export_video';

export interface CanvasAgentNodeCapability {
  type: CanvasAgentNodeType;
  label: string;
  configurableFields: readonly string[];
  actions: readonly CanvasAgentNodeAction[];
  outputFields: readonly string[];
}

export interface CanvasAgentNodeSnapshot {
  id: string;
  type: string;
  data: Record<string, unknown>;
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

export interface CanvasAgentNodeOutput {
  index: number;
  kind: 'image' | 'video' | 'audio' | 'file';
  uri: string;
  name: string;
  source: string;
}

const COMMON_FIELDS = ['label'] as const;
const COMMON_ACTIONS = ['inspect', 'configure', 'move', 'resize'] as const;

function capability(
  type: CanvasAgentNodeType,
  label: string,
  configurableFields: readonly string[],
  actions: readonly CanvasAgentNodeAction[] = COMMON_ACTIONS,
  outputFields: readonly string[] = [],
): CanvasAgentNodeCapability {
  return {
    type,
    label,
    configurableFields: [...COMMON_FIELDS, ...configurableFields],
    actions,
    outputFields,
  };
}

export const CANVAS_AGENT_NODE_CAPABILITIES: Record<CanvasAgentNodeType, CanvasAgentNodeCapability> = {
  prompt: capability('prompt', 'Text', ['text']),
  image: capability(
    'image',
    'Image generation',
    [
      'prompt',
      'customPrompt',
      'aspectRatio',
      'imageResolution',
      'model',
      'providerId',
      'generationBackend',
      'dreaminaCliModel',
      'dreaminaCliResolution',
    ],
    [...COMMON_ACTIONS, 'generate', 'select_output'],
    ['imageUrl'],
  ),
  video: capability(
    'video',
    'Video generation',
    [
      'prompt',
      'customPrompt',
      'ratio',
      'resolution',
      'duration',
      'mode',
      'model',
      'providerId',
      'personReferenceMode',
      'virtualHumanCardId',
      'generationBackend',
      'dreaminaCliModel',
      'dreaminaCliVideoMode',
    ],
    [...COMMON_ACTIONS, 'generate', 'select_output'],
    ['videoUrl'],
  ),
  llm: capability(
    'llm',
    'Large language model',
    ['prompt', 'llmSource', 'llmModel', 'geminiModel'],
  ),
  agent: capability(
    'agent',
    'Agent',
    ['agentName', 'agentPrompt', 'prompt', 'model', 'llmSource', 'geminiModel'],
  ),
  material: capability(
    'material',
    'Material',
    ['fileName', 'referenceName', 'mentionSlug'],
    [...COMMON_ACTIONS, 'select_output'],
    ['fileUrl', 'thumbnailUrl'],
  ),
  region: capability('region', 'Region', ['regionName', 'fontSize']),
  storyboard: capability(
    'storyboard',
    'Storyboard',
    ['fileName'],
    [...COMMON_ACTIONS, 'select_output'],
    ['fileUrl'],
  ),
  panorama: capability(
    'panorama',
    'Panorama',
    [
      'panoramaMode',
      'panoramaAgentImageProviderId',
      'panoramaAgentImageModel',
      'panoramaAgentImageResolution',
      'panoramaAgentImageAspect',
      'panoramaAgentLlmSupplement',
    ],
    [...COMMON_ACTIONS, 'generate', 'select_output'],
    ['panoramaTexUrl'],
  ),
  topazEnhance: capability(
    'topazEnhance',
    'Quality enhancement',
    ['topazPanelMode', 'viapiUpscaleFactor', 'topazProvider'],
    [...COMMON_ACTIONS, 'generate', 'select_output'],
    ['outputImageUrl', 'outputVideoUrl'],
  ),
  faceCompliance: capability(
    'faceCompliance',
    'Face compliance',
    [],
    [...COMMON_ACTIONS, 'generate', 'select_output'],
    ['outputUrl', 'outputImageUrl', 'processedUrl'],
  ),
  music: capability(
    'music',
    'Music and speech generation',
    [
      'prompt',
      'customPrompt',
      'duration',
      'model',
      'providerId',
      'sunoStyle',
      'elevenLabsStyle',
      'mode',
      'ttsProviderId',
      'ttsModel',
      'ttsVoiceId',
      'ttsVoiceMode',
      'ttsSpeed',
      'ttsVol',
      'ttsPitch',
      'ttsStability',
      'ttsSimilarityBoost',
    ],
    [...COMMON_ACTIONS, 'generate', 'select_output'],
    ['audioUrl'],
  ),
  browser: capability(
    'browser',
    'Browser',
    ['browserUrl'],
    [...COMMON_ACTIONS, 'navigate', 'reload', 'back', 'forward'],
  ),
};

const HISTORY_FIELDS = [
  'history',
  'generationHistory',
  'generatedImages',
  'generatedVideos',
  'imageHistory',
  'videoHistory',
  'audioHistory',
  'generatedMusic',
  'generatedTTS',
  'panoramaTexHistory',
  'topazImageHistory',
  'topazVideoHistory',
  'processedResults',
  'outputs',
] as const;

const URI_FIELDS = [
  'imageUrl',
  'videoUrl',
  'audioUrl',
  'fileUrl',
  'panoramaTexUrl',
  'outputImageUrl',
  'outputVideoUrl',
  'outputUrl',
  'processedUrl',
  'finalVideoUrl',
  'composedVideoUrl',
  'exportedImageUrl',
  'exportedVideoUrl',
  'url',
  'uri',
] as const;

const RUNTIME_FIELDS = [
  'status',
  'statusMessage',
  'progress',
  'isLoading',
  'error',
  'errorMessage',
  'taskId',
  'currentTaskId',
  'currentSequenceIndex',
  'activeSequenceIndex',
  'sequenceIndex',
] as const;

export function getCanvasAgentNodeCapability(type: string): CanvasAgentNodeCapability | null {
  return CANVAS_AGENT_NODE_CAPABILITIES[type as CanvasAgentNodeType] || null;
}

export function listCanvasAgentNodeCapabilities(): CanvasAgentNodeCapability[] {
  return Object.values(CANVAS_AGENT_NODE_CAPABILITIES);
}

export function validateCanvasAgentNodePatch(
  type: string,
  patch: Record<string, unknown>,
): { valid: true; patch: Record<string, unknown> } | { valid: false; message: string } {
  const nodeCapability = getCanvasAgentNodeCapability(type);
  if (!nodeCapability) return { valid: false, message: `Unsupported node type: ${type}` };

  const allowed = new Set(nodeCapability.configurableFields);
  const invalid = Object.keys(patch).filter((key) => !allowed.has(key));
  if (invalid.length > 0) {
    return {
      valid: false,
      message: `Fields cannot be configured on ${type}: ${invalid.join(', ')}. Allowed fields: ${[...allowed].join(', ')}`,
    };
  }
  return { valid: true, patch: { ...patch } };
}

function compactValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return `<data-url:${value.length} chars>`;
    return value.length > 800 ? `${value.slice(0, 800)}...` : value;
  }
  if (depth >= 2) {
    if (Array.isArray(value)) return `<array:${value.length}>`;
    return '<object>';
  }
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => compactValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 40)
        .map(([key, item]) => [key, compactValue(item, depth + 1)]),
    );
  }
  return String(value);
}

export function describeCanvasAgentNode(node: CanvasAgentNodeSnapshot): Record<string, unknown> {
  const nodeCapability = getCanvasAgentNodeCapability(node.type);
  const configured = nodeCapability
    ? Object.fromEntries(
        nodeCapability.configurableFields
          .filter((key) => node.data[key] !== undefined)
          .map((key) => [key, compactValue(node.data[key])]),
      )
    : {};
  const runtime = Object.fromEntries(
    RUNTIME_FIELDS
      .filter((key) => node.data[key] !== undefined)
      .map((key) => [key, compactValue(node.data[key])]),
  );

  return {
    id: node.id,
    type: node.type,
    label: nodeCapability?.label || node.type,
    position: node.position,
    size: {
      width: node.width ?? node.data.width,
      height: node.height ?? node.data.height,
    },
    configured,
    runtime,
    actions: nodeCapability?.actions || ['inspect'],
    outputCount: collectCanvasAgentNodeOutputs(node).length,
  };
}

function inferOutputKind(uri: string, field: string): CanvasAgentNodeOutput['kind'] {
  const value = `${field} ${uri}`.toLowerCase();
  if (/video|\.mp4|\.mov|\.webm|\.mkv/.test(value)) return 'video';
  if (/audio|\.mp3|\.wav|\.m4a|\.aac|\.flac/.test(value)) return 'audio';
  if (/image|panorama|thumbnail|\.png|\.jpe?g|\.webp|\.gif/.test(value)) return 'image';
  return 'file';
}

export function collectCanvasAgentNodeOutputs(node: CanvasAgentNodeSnapshot): CanvasAgentNodeOutput[] {
  const seen = new Set<string>();
  const outputs: Omit<CanvasAgentNodeOutput, 'index'>[] = [];

  const add = (uri: unknown, source: string, name?: unknown) => {
    if (typeof uri !== 'string' || !uri.trim() || seen.has(uri)) return;
    seen.add(uri);
    outputs.push({
      kind: inferOutputKind(uri, source),
      uri,
      name: typeof name === 'string' && name.trim() ? name : `${node.type} ${outputs.length + 1}`,
      source,
    });
  };

  const directFields = getCanvasAgentNodeCapability(node.type)?.outputFields || URI_FIELDS;
  for (const field of directFields) add(node.data[field], field, node.data.fileName || node.data.label);

  for (const historyField of HISTORY_FIELDS) {
    const history = node.data[historyField];
    if (!Array.isArray(history)) continue;
    history.forEach((item, itemIndex) => {
      if (typeof item === 'string') {
        add(item, `${historyField}[${itemIndex}]`);
        return;
      }
      if (!item || typeof item !== 'object') return;
      const record = item as Record<string, unknown>;
      for (const uriField of URI_FIELDS) {
        add(record[uriField], `${historyField}[${itemIndex}].${uriField}`, record.name || record.fileName || record.title);
      }
    });
  }

  return outputs.map((output, index) => ({ ...output, index }));
}

export function outputSelectionPatch(
  type: string,
  output: CanvasAgentNodeOutput,
): Record<string, unknown> | null {
  if (type === 'image') return { imageUrl: output.uri };
  if (type === 'video') return { videoUrl: output.uri };
  if (type === 'music') return { audioUrl: output.uri };
  if (type === 'material' || type === 'storyboard') return { fileUrl: output.uri };
  if (type === 'panorama') return { panoramaTexUrl: output.uri };
  if (type === 'topazEnhance') {
    return output.kind === 'video' ? { outputVideoUrl: output.uri } : { outputImageUrl: output.uri };
  }
  if (type === 'faceCompliance') return { outputImageUrl: output.uri };
  return null;
}

export function canvasAgentNodeTaskState(node: CanvasAgentNodeSnapshot): Record<string, unknown> {
  const data = node.data;
  const outputs = collectCanvasAgentNodeOutputs(node);
  const nestedProgress = data.generationProgress && typeof data.generationProgress === 'object'
    ? data.generationProgress as Record<string, unknown>
    : {};
  const hasError = Boolean(data.error || data.errorMessage || data.topazLastError);
  const status = data.status
    ?? nestedProgress.status
    ?? (hasError
      ? 'error'
      : data.isLoading
        ? 'processing'
        : outputs.length > 0
          ? 'success'
          : 'idle');
  return {
    nodeId: node.id,
    nodeType: node.type,
    status,
    progress: data.progress ?? nestedProgress.progress ?? data.topazProgress ?? null,
    message: data.statusMessage
      ?? nestedProgress.message
      ?? data.errorMessage
      ?? data.error
      ?? data.topazLastError
      ?? data.topazStatus
      ?? '',
    taskId: data.taskId ?? data.currentTaskId ?? null,
    outputCount: outputs.length,
  };
}
