import { getMaterialBlob, materialRefToNodeId } from '@/lib/canvas-material-idb';

const IDB_REF_PREFIX = 'idb://magine/material/v1/';

function isIdbMaterialRef(url: string): boolean {
  return url.startsWith(IDB_REF_PREFIX);
}
import { fetchMaterialDiskCacheAsDataUrl } from '@/lib/sync-material-project-disk-cache';
import type { EditClip } from '@/lib/edit-timeline-types';

async function readUrlAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`无法读取媒体 HTTP ${res.status}`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : '');
    fr.onerror = () => reject(fr.error ?? new Error('读取失败'));
    fr.readAsDataURL(blob);
  });
}

/** 导出前将 idb / 同源相对路径 转为服务端可处理的 URL */
export async function coalesceEditClipForExport(clip: EditClip): Promise<EditClip> {
  const srcUrl: string = clip.url.trim();
  if (!srcUrl) return clip;
  if (srcUrl.indexOf('data:') === 0 || srcUrl.indexOf('https://') === 0) return clip;

  if (isIdbMaterialRef(srcUrl)) {
    const nodeId = materialRefToNodeId(srcUrl);
    const blob = nodeId ? await getMaterialBlob(nodeId) : null;
    const fileUrl = blob?.fileUrl?.trim();
    if (fileUrl?.startsWith('data:')) return { ...clip, url: fileUrl };
    const disk = nodeId ? await fetchMaterialDiskCacheAsDataUrl(nodeId) : null;
    if (disk) return { ...clip, url: disk };
    throw new Error(`素材 ${clip.fileName || clip.id} 的本地缓存不可用，请重新打开素材节点`);
  } else if (srcUrl.indexOf('http://') === 0 || srcUrl.indexOf('blob:') === 0 || srcUrl.indexOf('/') === 0) {
    try {
      const resolved =
        srcUrl.indexOf('/') === 0 && typeof window !== 'undefined'
          ? new URL(srcUrl, window.location.origin).href
          : srcUrl;
      if (resolved.startsWith('https://')) return { ...clip, url: resolved };
      const data = await readUrlAsDataUrl(resolved);
      return { ...clip, url: data };
    } catch (e) {
      throw new Error(
        `无法读取 ${clip.fileName || clip.id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const disk = await fetchMaterialDiskCacheAsDataUrl(clip.sourceNodeId);
  if (disk) return { ...clip, url: disk };

  return clip;
}

export async function coalesceClipsForExport(clips: EditClip[]): Promise<EditClip[]> {
  return Promise.all(clips.map((c) => coalesceEditClipForExport(c)));
}
