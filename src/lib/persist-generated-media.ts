import {
  postMaterialToProjectDiskCache,
  postMaterialUrlToProjectDiskCache,
  postVideoLocalPathToProjectDiskCache,
  postVideoToProjectDiskCache,
  postVideoUrlToProjectDiskCache,
} from '@/lib/sync-material-project-disk-cache';
import {
  isLocalFilesystemMediaPath,
  isProjectCacheMaterialUrl,
} from '@/lib/material-disk-playable-url';

export function generatedImageCacheKey(nodeId: string, index: number): string {
  return `${nodeId}-img-${index}`;
}

export function generatedVideoCacheKey(nodeId: string, index: number): string {
  return `${nodeId}-vid-${index}`;
}

export async function persistImageToMaterialCache(nodeId: string, url: string): Promise<boolean> {
  if (!url) return false;
  if (isProjectCacheMaterialUrl(url)) return true;
  if (/^https?:\/\//i.test(url)) {
    return postMaterialUrlToProjectDiskCache(nodeId, url);
  }
  if (url.startsWith('data:')) {
    return postMaterialToProjectDiskCache(nodeId, url);
  }
  return false;
}

export async function persistVideoToMaterialCache(nodeId: string, url: string): Promise<boolean> {
  if (!url) return false;
  if (isProjectCacheMaterialUrl(url)) {
    try {
      const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      return response.ok;
    } catch {
      return false;
    }
  }
  if (/^https?:\/\//i.test(url)) {
    return postVideoUrlToProjectDiskCache(nodeId, url);
  }
  if (/^data:video\//i.test(url)) {
    return postVideoToProjectDiskCache(nodeId, url);
  }
  if (isLocalFilesystemMediaPath(url)) {
    return postVideoLocalPathToProjectDiskCache(nodeId, url);
  }
  return false;
}
