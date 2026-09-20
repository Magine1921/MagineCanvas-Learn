import type { Edge, Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';
import {
  getMaterialBlob,
  putMaterialBlob,
} from '@/lib/canvas-material-idb';

const AUDIO_REF_PREFIX = 'idb://magine/audio/v1/';

export function isAudioIdbRef(url: unknown): boolean {
  return typeof url === 'string' && url.startsWith(AUDIO_REF_PREFIX);
}

function audioKeyToRef(key: string): string {
  return `${AUDIO_REF_PREFIX}${encodeURIComponent(key)}`;
}

function audioRefToKey(ref: string): string {
  return decodeURIComponent(ref.slice(AUDIO_REF_PREFIX.length));
}

function needsAudioOffload(url: string): boolean {
  if (!url || isAudioIdbRef(url)) return false;
  return url.startsWith('blob:')
    || url.startsWith('data:audio/')
    || /^https?:\/\//i.test(url)
    || (url.startsWith('/api/project-cache/material') && /[?&]kind=audio(?:&|$)/.test(url));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('audio FileReader failed'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(blob);
  });
}

async function audioUrlToDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:audio/')) return url;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`audio fetch failed: ${response.status}`);
  }
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

async function offloadAudioUrl(key: string, url: string): Promise<string> {
  if (!needsAudioOffload(url)) return url;
  try {
    const dataUrl = await audioUrlToDataUrl(url);
    if (!dataUrl.startsWith('data:audio/')) return url;
    await putMaterialBlob(key, {
      fileUrl: dataUrl,
      thumbnailUrl: dataUrl,
    });
    return audioKeyToRef(key);
  } catch {
    return url;
  }
}

async function hydrateAudioUrl(url: string): Promise<string> {
  if (!isAudioIdbRef(url)) return url;
  const blob = await getMaterialBlob(audioRefToKey(url));
  return blob?.fileUrl || url;
}

function generatedAudioKey(nodeId: string, mode: 'music' | 'tts', item: Record<string, unknown>, index: number): string {
  const rawId = typeof item.id === 'string' && item.id ? item.id : `${mode}-${index}`;
  return `${nodeId}-${mode}-${rawId}`;
}

export async function persistGeneratedAudioUrl(
  nodeId: string,
  mode: 'music' | 'tts',
  itemId: string,
  url: string
): Promise<string> {
  return offloadAudioUrl(`${nodeId}-${mode}-${itemId}`, url);
}

export async function hydratePersistedAudioUrl(url: string): Promise<string> {
  return hydrateAudioUrl(url);
}

export async function offloadAudioForPersist(workflow: {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
}): Promise<{ nodes: Node<CanvasNodeData>[]; edges: Edge[] }> {
  const nodes = await Promise.all(
    workflow.nodes.map(async (node) => {
      if (node.type !== 'music') return node;
      const data = { ...(node.data as Record<string, unknown>) };
      const urlMap = new Map<string, string>();

      const musicItems = Array.isArray(data.generatedMusic) ? [...data.generatedMusic] : [];
      data.generatedMusic = await Promise.all(
        musicItems.map(async (item, index) => {
          if (!item || typeof item !== 'object') return item;
          const next = { ...(item as Record<string, unknown>) };
          const url = typeof next.audioUrl === 'string' ? next.audioUrl : '';
          if (needsAudioOffload(url)) {
            const ref = await offloadAudioUrl(generatedAudioKey(node.id, 'music', next, index), url);
            next.audioUrl = ref;
            urlMap.set(url, ref);
          }
          return next;
        })
      );

      const ttsItems = Array.isArray(data.generatedTTS) ? [...data.generatedTTS] : [];
      data.generatedTTS = await Promise.all(
        ttsItems.map(async (item, index) => {
          if (!item || typeof item !== 'object') return item;
          const next = { ...(item as Record<string, unknown>) };
          const url = typeof next.audioUrl === 'string' ? next.audioUrl : '';
          if (needsAudioOffload(url)) {
            const ref = await offloadAudioUrl(generatedAudioKey(node.id, 'tts', next, index), url);
            next.audioUrl = ref;
            urlMap.set(url, ref);
          }
          return next;
        })
      );

      const audioUrl = typeof data.audioUrl === 'string' ? data.audioUrl : '';
      if (needsAudioOffload(audioUrl)) {
        data.audioUrl = urlMap.get(audioUrl) || await offloadAudioUrl(`${node.id}-music-active`, audioUrl);
      }

      const ttsAudioUrl = typeof data.ttsAudioUrl === 'string' ? data.ttsAudioUrl : '';
      if (needsAudioOffload(ttsAudioUrl)) {
        data.ttsAudioUrl = urlMap.get(ttsAudioUrl) || await offloadAudioUrl(`${node.id}-tts-active`, ttsAudioUrl);
      }

      return { ...node, data: data as unknown as CanvasNodeData };
    })
  );
  return { edges: workflow.edges, nodes };
}

export async function hydrateAudioIdbRefsInNodes(
  nodes: Node<CanvasNodeData>[]
): Promise<Node<CanvasNodeData>[]> {
  return Promise.all(
    nodes.map(async (node) => {
      if (node.type !== 'music') return node;
      const data = { ...(node.data as Record<string, unknown>) };
      const refMap = new Map<string, string>();

      const musicItems = Array.isArray(data.generatedMusic) ? [...data.generatedMusic] : [];
      data.generatedMusic = await Promise.all(
        musicItems.map(async (item) => {
          if (!item || typeof item !== 'object') return item;
          const next = { ...(item as Record<string, unknown>) };
          const url = typeof next.audioUrl === 'string' ? next.audioUrl : '';
          const hydrated = await hydrateAudioUrl(url);
          next.audioUrl = hydrated;
          if (hydrated !== url) refMap.set(url, hydrated);
          return next;
        })
      );

      const ttsItems = Array.isArray(data.generatedTTS) ? [...data.generatedTTS] : [];
      data.generatedTTS = await Promise.all(
        ttsItems.map(async (item) => {
          if (!item || typeof item !== 'object') return item;
          const next = { ...(item as Record<string, unknown>) };
          const url = typeof next.audioUrl === 'string' ? next.audioUrl : '';
          const hydrated = await hydrateAudioUrl(url);
          next.audioUrl = hydrated;
          if (hydrated !== url) refMap.set(url, hydrated);
          return next;
        })
      );

      const audioUrl = typeof data.audioUrl === 'string' ? data.audioUrl : '';
      if (isAudioIdbRef(audioUrl)) {
        data.audioUrl = refMap.get(audioUrl) || await hydrateAudioUrl(audioUrl);
      }

      const ttsAudioUrl = typeof data.ttsAudioUrl === 'string' ? data.ttsAudioUrl : '';
      if (isAudioIdbRef(ttsAudioUrl)) {
        data.ttsAudioUrl = refMap.get(ttsAudioUrl) || await hydrateAudioUrl(ttsAudioUrl);
      }

      return { ...node, data: data as unknown as CanvasNodeData };
    })
  );
}
