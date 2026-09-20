export type KieReferenceKind = 'image' | 'video';

import {
  MATERIAL_DISK_REF_PREFIX,
  materialDiskNodeIdToRef,
  isProjectCacheMaterialUrl,
} from '@/lib/material-disk-playable-url';
import {
  postMaterialToProjectDiskCache,
  postVideoToProjectDiskCache,
} from '@/lib/sync-material-project-disk-cache';

type KieMaterialUploadRef = {
  nodeId?: string;
  fileUrl?: string;
  thumbnailUrl?: string;
  seedanceAssetUri?: string;
};

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function materialCacheNodeId(prefix: string, index: number): string {
  const safeBase = (prefix || 'kie-reference')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+/, '');
  const prefixed = safeBase.startsWith('node_') ? safeBase : `node_${safeBase}`;
  const suffix = `-${index}`;
  return `${prefixed.slice(0, Math.max(5, 120 - suffix.length))}${suffix}`;
}

function isPublicHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

async function blobUrlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Kie reference blob read failed: HTTP ${response.status}`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Kie reference blob read returned empty data'));
    };
    reader.onerror = () => reject(reader.error || new Error('Kie reference blob read failed'));
    reader.readAsDataURL(blob);
  });
}

async function cacheLocalInputForServer(input: string, kind: KieReferenceKind, cacheNodeId?: string): Promise<string> {
  const trimmed = input.trim();
  if (
    !trimmed ||
    isPublicHttpUrl(trimmed) ||
    trimmed.startsWith(MATERIAL_DISK_REF_PREFIX) ||
    isProjectCacheMaterialUrl(trimmed) ||
    !cacheNodeId
  ) {
    return trimmed;
  }

  let dataUrl = trimmed;
  if (trimmed.startsWith('blob:')) {
    dataUrl = await blobUrlToDataUrl(trimmed);
  }
  if (!dataUrl.startsWith('data:')) return trimmed;

  const ok =
    kind === 'video'
      ? await postVideoToProjectDiskCache(cacheNodeId, dataUrl)
      : await postMaterialToProjectDiskCache(cacheNodeId, dataUrl);
  return ok ? materialDiskNodeIdToRef(cacheNodeId) : trimmed;
}

export async function materializeKieReferencesForCloud(params: {
  apiKey: string;
  inputs: string[];
  kind: KieReferenceKind;
  cacheKeyPrefix?: string;
}): Promise<string[]> {
  const apiKey = params.apiKey.trim();
  const preparedInputs = await Promise.all(
    params.inputs.map((input, index) =>
      cacheLocalInputForServer(
        input,
        params.kind,
        params.cacheKeyPrefix ? materialCacheNodeId(params.cacheKeyPrefix, index) : undefined,
      )
    )
  );
  const inputs = uniqueNonEmpty(preparedInputs);
  if (!apiKey || inputs.length === 0) return inputs;

  const localInputs = inputs.filter((input) => !isPublicHttpUrl(input));
  if (localInputs.length === 0) return inputs;

  const response = await fetch('/api/kie/materialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, inputs: localInputs, kind: params.kind }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    urls?: string[];
    error?: string;
  };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Kie reference upload failed: HTTP ${response.status}`);
  }

  const uploaded = uniqueNonEmpty(payload.urls || []);
  if (uploaded.length === 0) {
    throw new Error('Kie reference upload returned no public URLs');
  }

  const uploadedByInput = new Map<string, string>();
  localInputs.forEach((input, index) => {
    const url = uploaded[index];
    if (url) uploadedByInput.set(input, url);
  });

  return inputs
    .map((input) => (isPublicHttpUrl(input) ? input : uploadedByInput.get(input) || ''))
    .filter(Boolean);
}

export async function materializeKieMaterialRefsForCloud(params: {
  apiKey: string;
  materials: KieMaterialUploadRef[];
  kind: KieReferenceKind;
  max?: number;
}): Promise<string[]> {
  const inputs: string[] = [];
  const max = params.max || params.materials.length;
  for (const material of params.materials.slice(0, max)) {
    const input = (material.fileUrl || material.thumbnailUrl || '').trim();
    if (!input || /^asset:\/\//i.test(input)) continue;
    inputs.push(await cacheLocalInputForServer(input, params.kind, material.nodeId));
  }

  return materializeKieReferencesForCloud({
    apiKey: params.apiKey,
    inputs,
    kind: params.kind,
  });
}
