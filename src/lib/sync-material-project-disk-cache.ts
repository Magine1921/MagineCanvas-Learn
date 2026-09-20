/**
 * 将素材大图同步到本机 Next 服务下的项目磁盘缓存（`/api/project-cache/material`）。
 * 服务端会统一转码为 **JPEG** 写入 `<magine-cache>/materials/<nodeId>/image.jpg`；仅在导入工作流 GC 时清理未引用目录。
 * Electron 安装版缓存根目录为 `%APPDATA%/magine-canvas/magine-cache`（见 MAGINE_CACHE_ROOT）。
 * 仅在本机 dev / 同源部署时有效；失败静默。
 */

const successfulCacheWriteSignatures = new Map<string, string>();
const cacheWriteQueues = new Map<string, Promise<boolean>>();
const MAX_REMEMBERED_CACHE_WRITES = 2048;

function cacheWriteSignature(value: string): string {
  let hash = 2166136261;
  const stride = Math.max(1, Math.floor(value.length / 4096));
  for (let index = 0; index < value.length; index += stride) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length}:${(hash >>> 0).toString(36)}`;
}

function rememberSuccessfulCacheWrite(key: string, signature: string): void {
  successfulCacheWriteSignatures.delete(key);
  successfulCacheWriteSignatures.set(key, signature);
  while (successfulCacheWriteSignatures.size > MAX_REMEMBERED_CACHE_WRITES) {
    const oldestKey = successfulCacheWriteSignatures.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    successfulCacheWriteSignatures.delete(oldestKey);
  }
}

function clearRememberedCacheWrites(nodeId?: string): void {
  if (!nodeId) {
    successfulCacheWriteSignatures.clear();
    return;
  }
  const prefix = `${nodeId}|`;
  for (const key of successfulCacheWriteSignatures.keys()) {
    if (key.startsWith(prefix)) successfulCacheWriteSignatures.delete(key);
  }
}

function runCoalescedCacheWrite(
  nodeId: string,
  kind: string,
  source: string,
  write: () => Promise<boolean>,
): Promise<boolean> {
  const key = `${nodeId}|${kind}`;
  const signature = cacheWriteSignature(source);
  if (successfulCacheWriteSignatures.get(key) === signature) {
    return Promise.resolve(true);
  }

  const previous = cacheWriteQueues.get(key) || Promise.resolve(true);
  const queued = previous
    .catch(() => false)
    .then(async () => {
      if (successfulCacheWriteSignatures.get(key) === signature) return true;
      const ok = await write();
      if (ok) rememberSuccessfulCacheWrite(key, signature);
      return ok;
    })
    .finally(() => {
      if (cacheWriteQueues.get(key) === queued) cacheWriteQueues.delete(key);
    });
  cacheWriteQueues.set(key, queued);
  return queued;
}

export async function postMaterialToProjectDiskCache(nodeId: string, dataUrl: string): Promise<boolean> {
  if (typeof window === 'undefined' || !dataUrl.startsWith('data:')) return false;
  return runCoalescedCacheWrite(nodeId, 'image-data', dataUrl, async () => {
    try {
      const r = await fetch('/api/project-cache/material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, dataUrl }),
      });
      return r.ok;
    } catch {
      return false;
    }
  });
}

export async function postMaterialFileToProjectDiskCache(
  nodeId: string,
  file: File,
): Promise<boolean> {
  if (typeof window === 'undefined' || !nodeId || !file.type.startsWith('image/')) return false;
  const source = `${file.name}|${file.type}|${file.size}|${file.lastModified}`;
  return runCoalescedCacheWrite(nodeId, 'image-file', source, async () => {
    try {
      const form = new FormData();
      form.append('nodeId', nodeId);
      form.append('file', file, file.name);
      const response = await fetch('/api/project-cache/material-upload', {
        method: 'POST',
        body: form,
      });
      return response.ok;
    } catch {
      return false;
    }
  });
}

export async function postVideoToProjectDiskCache(nodeId: string, dataUrl: string): Promise<boolean> {
  if (typeof window === 'undefined' || !dataUrl.startsWith('data:video/')) return false;
  return runCoalescedCacheWrite(nodeId, 'video-data', dataUrl, async () => {
    try {
      const r = await fetch('/api/project-cache/material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, dataUrl, kind: 'video' }),
      });
      return r.ok;
    } catch {
      return false;
    }
  });
}

export async function postMaterialUrlToProjectDiskCache(nodeId: string, imageUrl: string): Promise<boolean> {
  if (typeof window === 'undefined' || !/^https?:\/\//i.test(imageUrl)) return false;
  return runCoalescedCacheWrite(nodeId, 'image-url', imageUrl, async () => {
    try {
      const r = await fetch('/api/project-cache/material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, imageUrl }),
      });
      return r.ok;
    } catch {
      return false;
    }
  });
}

export async function postVideoUrlToProjectDiskCache(nodeId: string, videoUrl: string): Promise<boolean> {
  if (typeof window === 'undefined' || !/^https?:\/\//i.test(videoUrl)) return false;
  return runCoalescedCacheWrite(nodeId, 'video-url', videoUrl, async () => {
    try {
      const r = await fetch('/api/project-cache/material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, imageUrl: videoUrl, kind: 'video' }),
      });
      return r.ok;
    } catch {
      return false;
    }
  });
}

export async function postAudioUrlToProjectDiskCache(nodeId: string, audioUrl: string): Promise<boolean> {
  if (typeof window === 'undefined' || !/^https?:\/\//i.test(audioUrl)) return false;
  return runCoalescedCacheWrite(nodeId, 'audio-url', audioUrl, async () => {
    try {
      const response = await fetch('/api/project-cache/material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, imageUrl: audioUrl, kind: 'audio' }),
      });
      return response.ok;
    } catch {
      return false;
    }
  });
}

export async function postAudioToProjectDiskCache(nodeId: string, dataUrl: string): Promise<boolean> {
  if (typeof window === 'undefined' || !dataUrl.startsWith('data:audio/')) return false;
  return runCoalescedCacheWrite(nodeId, 'audio-data', dataUrl, async () => {
    try {
      const response = await fetch('/api/project-cache/material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, dataUrl, kind: 'audio' }),
      });
      return response.ok;
    } catch {
      return false;
    }
  });
}

export async function hasMaterialProjectDiskCache(
  nodeId: string,
  kind: 'image' | 'video' | 'audio' = 'image',
): Promise<boolean> {
  if (typeof window === 'undefined' || !nodeId) return false;
  const kindQuery = kind === 'image' ? '' : `&kind=${kind}`;
  try {
    const response = await fetch(
      `/api/project-cache/material?nodeId=${encodeURIComponent(nodeId)}${kindQuery}`,
      { method: 'HEAD', cache: 'no-store' },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function postVideoLocalPathToProjectDiskCache(nodeId: string, localPath: string): Promise<boolean> {
  if (typeof window === 'undefined' || !localPath.trim()) return false;
  return runCoalescedCacheWrite(nodeId, 'video-local-path', localPath, async () => {
    try {
      const r = await fetch('/api/project-cache/material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, localPath, kind: 'video' }),
      });
      return r.ok;
    } catch {
      return false;
    }
  });
}

export async function deleteMaterialProjectDiskCache(nodeId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  clearRememberedCacheWrites(nodeId);
  try {
    await fetch(`/api/project-cache/material?nodeId=${encodeURIComponent(nodeId)}`, { method: 'DELETE' });
  } catch {
    /* */
  }
}

export async function purgeAllMaterialProjectDiskCache(): Promise<void> {
  if (typeof window === 'undefined') return;
  clearRememberedCacheWrites();
  try {
    await fetch('/api/project-cache/material?purge=all', { method: 'DELETE' });
  } catch {
    /* */
  }
}

export async function gcMaterialProjectDiskCache(keepNodeIds: readonly string[]): Promise<void> {
  if (typeof window === 'undefined') return;
  const keep = new Set(keepNodeIds);
  for (const key of successfulCacheWriteSignatures.keys()) {
    const separator = key.indexOf('|');
    const nodeId = separator >= 0 ? key.slice(0, separator) : key;
    if (!keep.has(nodeId)) successfulCacheWriteSignatures.delete(key);
  }
  try {
    await fetch('/api/project-cache/material', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'gc', keepNodeIds: [...keepNodeIds] }),
    });
  } catch {
    /* */
  }
}

export async function fetchMaterialDiskCacheAsDataUrl(nodeId: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const r = await fetch(`/api/project-cache/material?nodeId=${encodeURIComponent(nodeId)}`);
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise<string | null>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
