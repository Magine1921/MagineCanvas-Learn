'use client';

import type { Edge, Node } from 'reactflow';

import type { CanvasNodeData } from '@/components/canvas/CanvasStore';
import type { WorkflowNodeTemplate, WorkflowTemplate } from '@/lib/workflow-templates';

const STORAGE_KEY = 'magine-user-workflow-presets-v1';
const HIDDEN_BUILT_IN_STORAGE_KEY = 'magine-hidden-built-in-workflow-presets-v1';
const CHANGE_EVENT = 'magine:user-workflow-presets-changed';

const VOLATILE_KEYS = new Set([
  'agentChatHistory', 'error', 'errorMessage', 'faceComplianceError', 'faceComplianceProcessed',
  'faceComplianceResults', 'faceComplianceStatus', 'fileName', 'fileType', 'fileUrl',
  'generatedAudios', 'generatedImages', 'generatedVideos', 'imageHistory', 'imageUrl', 'imageUrls',
  'isGenerating', 'isProcessing', 'musicHistory', 'output', 'previewUrl', 'progress', 'result',
  'results', 'seedanceAssetGroupId', 'seedanceAssetId', 'seedanceAssetUri', 'status',
  'statusMessage', 'taskId', 'taskIds', 'thumbnailUrl', 'ttsHistory', 'videoHistory', 'videoUrl',
  'virtualHumanCardId',
]);

function sanitizePresetValue(value: unknown, key?: string): unknown {
  if (key && VOLATILE_KEYS.has(key)) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('idb://') || trimmed.startsWith('disk://') || trimmed.includes('/api/project-cache/')) return undefined;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizePresetValue(item)).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  const next: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    const sanitized = sanitizePresetValue(childValue, childKey);
    if (sanitized !== undefined) next[childKey] = sanitized;
  }
  return next;
}

function isWorkflowTemplate(value: unknown): value is WorkflowTemplate {
  if (!value || typeof value !== 'object') return false;
  const template = value as Partial<WorkflowTemplate>;
  return typeof template.id === 'string' && typeof template.name === 'string' && Array.isArray(template.nodes) && Array.isArray(template.edges);
}

export function readUserWorkflowPresets(): WorkflowTemplate[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isWorkflowTemplate) : [];
  } catch {
    return [];
  }
}

export function getUserWorkflowPresetById(id: string): WorkflowTemplate | null {
  return readUserWorkflowPresets().find((template) => template.id === id) || null;
}

export function readHiddenBuiltInWorkflowPresetIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HIDDEN_BUILT_IN_STORAGE_KEY) || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveUserWorkflowPreset(template: WorkflowTemplate): void {
  if (typeof window === 'undefined') return;
  const presets = readUserWorkflowPresets().filter((item) => item.id !== template.id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([template, ...presets]));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function deleteUserWorkflowPreset(id: string): void {
  if (typeof window === 'undefined') return;
  const presets = readUserWorkflowPresets().filter((item) => item.id !== id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function hideBuiltInWorkflowPreset(id: string): void {
  if (typeof window === 'undefined') return;
  const hiddenIds = new Set(readHiddenBuiltInWorkflowPresetIds());
  hiddenIds.add(id);
  window.localStorage.setItem(HIDDEN_BUILT_IN_STORAGE_KEY, JSON.stringify([...hiddenIds]));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function subscribeUserWorkflowPresets(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

export function createUserWorkflowPreset(name: string, selectedNodes: Node<CanvasNodeData>[], allEdges: Edge[]): WorkflowTemplate {
  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const minX = Math.min(...selectedNodes.map((node) => node.position.x));
  const minY = Math.min(...selectedNodes.map((node) => node.position.y));
  const nodes: WorkflowNodeTemplate[] = selectedNodes.map((node) => {
    const nodeType = (node.data.type || node.type) as WorkflowNodeTemplate['type'];
    const sanitized = sanitizePresetValue(node.data) as Record<string, unknown>;
    const label = typeof sanitized.label === 'string' ? sanitized.label : undefined;
    delete sanitized.label;
    delete sanitized.type;
    return { id: node.id, type: nodeType, x: Math.round(node.position.x - minX + 100), y: Math.round(node.position.y - minY + 100), label, data: sanitized };
  });
  const edges = allEdges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)).map((edge, index) => ({ id: `edge-${index + 1}`, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle }));
  return { id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: name.trim(), description: `${nodes.length} 个节点 · ${edges.length} 条连线`, category: 'composite', nodes, edges };
}
