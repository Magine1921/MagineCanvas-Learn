/** 素材磁盘缓存引用前缀，与 canvas-persist-image-video-offload 一致 */
export const MATERIAL_DISK_REF_PREFIX = 'disk://magine/material/v1/';

export function isMaterialDiskRef(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith(MATERIAL_DISK_REF_PREFIX);
}

export function materialDiskRefToNodeId(ref: string): string {
  return ref.slice(MATERIAL_DISK_REF_PREFIX.length);
}

export function materialDiskNodeIdToRef(nodeId: string): string {
  return `${MATERIAL_DISK_REF_PREFIX}${nodeId}`;
}

/** 同源 API，供 `<video>` / `<img>` 播放磁盘缓存素材 */
export function materialDiskPlayableUrl(
  nodeId: string,
  kind: 'video' | 'image' | 'audio' = 'image',
): string {
  const q = kind === 'image' ? '' : `&kind=${kind}`;
  return `/api/project-cache/material?nodeId=${encodeURIComponent(nodeId)}${q}`;
}

export function isProjectCacheMaterialUrl(url: unknown): boolean {
  return typeof url === 'string' && url.includes('/api/project-cache/material');
}

export function isLocalFilesystemMediaPath(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  const t = url.trim();
  if (/^https?:\/\//i.test(t) || t.startsWith('data:')) return false;
  if (t.startsWith(MATERIAL_DISK_REF_PREFIX) || t.includes('/api/project-cache/material')) return false;
  if (t.startsWith('file://')) return true;
  if (/^[a-zA-Z]:[\\/]/.test(t)) return true;
  return t.startsWith('/');
}

/** 将 disk 引用或已是 cache API 的 URL 解析为可播放地址 */
export function resolveMaterialPlayableUrl(
  url: string,
  kind: 'video' | 'image' | 'audio' = 'image',
): string {
  if (!url) return '';
  if (isMaterialDiskRef(url)) {
    return materialDiskPlayableUrl(materialDiskRefToNodeId(url), kind);
  }
  if (isProjectCacheMaterialUrl(url)) return url;
  return url;
}
