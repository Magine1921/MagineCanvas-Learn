import { isHostLikelyUnreachableFromExternalService } from '@/lib/external-media-reachability';
import { MATERIAL_DISK_REF_PREFIX } from '@/lib/material-disk-playable-url';
import { isPanoramaDiskRef } from '@/lib/sync-panorama-project-disk-cache';
import { isSameSiteUrlLoose } from '@/lib/topaz-same-site-url';

function hostnameCloudCanFetchDirectly(hostname: string): boolean {
  return !isHostLikelyUnreachableFromExternalService(hostname);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = typeof fr.result === 'string' ? fr.result : '';
      if (s) resolve(s);
      else reject(new Error('读取为 Data URL 失败'));
    };
    fr.onerror = () => reject(fr.error ?? new Error('读取失败'));
    fr.readAsDataURL(blob);
  });
}

async function readUrlAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`无法读取媒体（HTTP ${res.status}）`);
  }
  return blobToDataUrl(await res.blob());
}

/**
 * Before calling Topaz/Kie routes: keep public https and same-site URLs as URLs,
 * and convert browser-only addresses to `data:` so the server can upload them.
 */
export async function coalesceTopazImageUrlForApi(url: string): Promise<string> {
  const u = url.trim();
  if (!u) throw new Error('图片地址为空');
  if (u.startsWith('data:')) return u;
  if (u.startsWith(MATERIAL_DISK_REF_PREFIX) || isPanoramaDiskRef(u)) return u;
  /** Keep same-site http(s) as URL so the server can fetch and upload it. */
  if (typeof window !== 'undefined') {
    try {
      const parsed = new URL(u, window.location.href);
      const page = new URL(window.location.href);
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        isSameSiteUrlLoose(page, parsed)
      ) {
        return u;
      }
    } catch {
      /* fall through */
    }
  }
  if (u.startsWith('https://')) {
    try {
      if (hostnameCloudCanFetchDirectly(new URL(u).hostname)) return u;
    } catch {
      /* fall through */
    }
  }
  if (u.startsWith('blob:') || u.startsWith('asset:') || u.startsWith('http://') || u.startsWith('https://')) {
    return readUrlAsDataUrl(u);
  }
  throw new Error('不支持的图片地址');
}

/** 内联进 JSON 的体积上限，避免 dev 服务/代理对超大 body 直接拒绝 */
const MAX_VIDEO_INLINE_BYTES = 12 * 1024 * 1024;

/**
 * Same handling for video inputs.
 * Very large video should be provided as public https to avoid oversized JSON bodies.
 */
export async function coalesceTopazVideoUrlForApi(url: string): Promise<string> {
  const u = url.trim();
  if (!u) throw new Error('视频地址为空');
  if (u.startsWith('data:')) return u;
  if (u.startsWith(MATERIAL_DISK_REF_PREFIX)) return u;
  /** Same-site URLs are fetched by the local Topaz route and uploaded server-side. */
  if (typeof window !== 'undefined') {
    try {
      const parsed = new URL(u, window.location.href);
      const page = new URL(window.location.href);
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        isSameSiteUrlLoose(page, parsed)
      ) {
        return u;
      }
    } catch {
      /* fall through */
    }
  }
  if (u.startsWith('https://')) {
    try {
      if (hostnameCloudCanFetchDirectly(new URL(u).hostname)) return u;
    } catch {
      /* fall through */
    }
  }
  if (u.startsWith('blob:') || u.startsWith('asset:') || u.startsWith('http://') || u.startsWith('https://')) {
    const res = await fetch(u);
    if (!res.ok) {
      throw new Error(`无法读取视频（HTTP ${res.status}）`);
    }
    const blob = await res.blob();
    if (blob.size > MAX_VIDEO_INLINE_BYTES) {
      const mb = Math.max(1, Math.round(blob.size / (1024 * 1024)));
      const cap = Math.round(MAX_VIDEO_INLINE_BYTES / (1024 * 1024));
      throw new Error(
        `视频约 ${mb}MB，超过内联上限 ${cap}MB。请将视频导出为公网 https 后再连接画质节点，或压缩/裁剪后再试。`
      );
    }
    return blobToDataUrl(blob);
  }
  throw new Error('不支持的视频地址');
}
