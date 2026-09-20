import { putMaterialBlob } from '@/lib/canvas-material-idb';
import {
  postMaterialToProjectDiskCache,
  postVideoToProjectDiskCache,
} from '@/lib/sync-material-project-disk-cache';

/** 将带 data URL 的素材立即写入 IndexedDB 与项目 JPG 磁盘缓存，便于刷新前落盘、与画布持久化一致 */
export async function persistInlineMaterialDataToProjectSidecar(
  nodeId: string,
  fileUrl: string,
  thumbnailUrl?: string
): Promise<void> {
  const fu = fileUrl.trim();
  if (!fu.startsWith('data:')) return;
  const tu = (thumbnailUrl?.trim() || fu).trim();
  await putMaterialBlob(nodeId, { fileUrl: fu, thumbnailUrl: tu });
  if (fu.startsWith('data:video/')) {
    await postVideoToProjectDiskCache(nodeId, fu);
  } else {
    await postMaterialToProjectDiskCache(nodeId, fu);
  }
}
