export const PANORAMA_DISK_REF_PREFIX = 'disk://magine/panorama/v1/';

export function isPanoramaDiskRef(url: unknown): boolean {
  return typeof url === 'string' && url.startsWith(PANORAMA_DISK_REF_PREFIX);
}

export function panoramaDiskRefToNodeId(ref: string): string {
  return decodeURIComponent(ref.slice(PANORAMA_DISK_REF_PREFIX.length));
}

export function panoramaNodeIdToDiskRef(nodeId: string): string {
  return `${PANORAMA_DISK_REF_PREFIX}${encodeURIComponent(nodeId)}`;
}

export function makePanoramaHistoryCacheId(nodeId: string, createdAt: number): string {
  const safeBase = (nodeId || 'node_panorama')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+/, '');
  const prefixed = safeBase.startsWith('node_') ? safeBase : `node_${safeBase}`;
  const suffix = `_pano_${Math.max(0, Math.floor(createdAt))}`;
  return `${prefixed.slice(0, Math.max(5, 120 - suffix.length))}${suffix}`;
}

/** 将生成结果（data URL 或 https 图链）存为项目下 JPG 缓存 */
export async function postPanoramaTexToProjectDiskCache(nodeId: string, urlOrData: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const t = urlOrData.trim();
  if (!t) return false;
  const body =
    t.startsWith('data:') ? { nodeId, dataUrl: t } : /^https?:\/\//i.test(t) ? { nodeId, imageUrl: t } : null;
  if (!body) return false;
  try {
    const r = await fetch('/api/project-cache/panorama', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function deletePanoramaProjectDiskCache(nodeId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await fetch(`/api/project-cache/panorama?nodeId=${encodeURIComponent(nodeId)}`, { method: 'DELETE' });
  } catch {
    /* */
  }
}

export async function purgeAllPanoramaProjectDiskCache(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await fetch('/api/project-cache/panorama?purge=all', { method: 'DELETE' });
  } catch {
    /* */
  }
}

export async function gcPanoramaProjectDiskCache(keepNodeIds: readonly string[]): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await fetch('/api/project-cache/panorama', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'gc', keepNodeIds: [...keepNodeIds] }),
    });
  } catch {
    /* */
  }
}

export async function fetchPanoramaDiskCacheAsDataUrl(nodeId: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const r = await fetch(`/api/project-cache/panorama?nodeId=${encodeURIComponent(nodeId)}`);
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
