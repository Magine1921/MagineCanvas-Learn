import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSafeMaterialNodeId, MATERIAL_DISK_RETENTION_MS } from '@/lib/project-material-disk-cache.server';
import { getMagineCacheRoot, MATERIAL_DISK_CACHE_SEGMENT } from '@/lib/magine-cache-root.server';
import { fetchSafeOutboundUrl } from '@/lib/server-outbound-request';

/** 全景纹理缓存：`<magine-cache>/panoramas/<nodeId>/image.jpg` */
export { MATERIAL_DISK_CACHE_SEGMENT };
export const PANORAMA_DISK_PANORAMAS_DIR = 'panoramas' as const;
const CACHE_IMAGE_JPEG = 'image.jpg';

export function getPanoramaDiskCacheRoot(): string {
  return path.join(getMagineCacheRoot(), PANORAMA_DISK_PANORAMAS_DIR);
}

function parseDataUrlToBuffer(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const t = dataUrl.trim();
  const base64Idx = t.indexOf(';base64,');
  if (base64Idx === -1) return null;
  const header = t.slice(5, base64Idx);
  const mime = header || 'application/octet-stream';
  const b64 = t.slice(base64Idx + ';base64,'.length);
  if (!b64) return null;
  try {
    return { mime, buffer: Buffer.from(b64, 'base64') };
  } catch {
    return null;
  }
}

async function encodeBufferToJpeg(buffer: Buffer): Promise<Buffer | null> {
  try {
    const sharp = (await import('sharp')).default;
    return await sharp(buffer).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  } catch {
    return null;
  }
}

async function fetchUrlToBuffer(imageUrl: string): Promise<Buffer | null> {
  const u = imageUrl.trim();
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    const res = await fetchSafeOutboundUrl(u, {}, { allowedProtocols: ['http:', 'https:'] });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

export async function purgeExpiredPanoramaDiskCache(maxAgeMs = MATERIAL_DISK_RETENTION_MS): Promise<void> {
  const root = getPanoramaDiskCacheRoot();
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    const dir = path.join(root, name);
    let stat;
    try {
      stat = await fs.stat(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const metaPath = path.join(dir, 'meta.json');
    let savedAt = stat.mtimeMs;
    try {
      const raw = await fs.readFile(metaPath, 'utf8');
      const j = JSON.parse(raw) as { savedAt?: string };
      if (typeof j.savedAt === 'string') {
        const t = new Date(j.savedAt).getTime();
        if (Number.isFinite(t)) savedAt = t;
      }
    } catch {
      /* */
    }
    if (now - savedAt > maxAgeMs) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  }
}

/** 将 data URL 或远程图片 URL 转为 JPEG 写入缓存 */
export async function savePanoramaTexToDiskCache(nodeId: string, source: string): Promise<boolean> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return false;
  const t = source.trim();
  let raw: Buffer | null = null;
  let sourceKind: 'data' | 'http' = 'data';
  if (t.startsWith('data:')) {
    const parsed = parseDataUrlToBuffer(t);
    raw = parsed?.buffer ?? null;
    sourceKind = 'data';
  } else if (/^https?:\/\//i.test(t)) {
    raw = await fetchUrlToBuffer(t);
    sourceKind = 'http';
  }
  if (!raw || raw.length === 0) return false;
  const jpeg = await encodeBufferToJpeg(raw);
  if (!jpeg || jpeg.length === 0) return false;
  const dir = path.join(getPanoramaDiskCacheRoot(), id);
  await fs.mkdir(dir, { recursive: true });
  const meta = {
    savedAt: new Date().toISOString(),
    mime: 'image/jpeg',
    format: 'jpeg',
    sourceKind,
    bytes: jpeg.length,
  };
  await fs.writeFile(path.join(dir, CACHE_IMAGE_JPEG), jpeg);
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 0), 'utf8');
  return true;
}

export async function readPanoramaTexFromDiskCache(
  nodeId: string
): Promise<{ buffer: Buffer; mime: string } | null> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return null;
  const jpgPath = path.join(getPanoramaDiskCacheRoot(), id, CACHE_IMAGE_JPEG);
  try {
    const buf = await fs.readFile(jpgPath);
    return { buffer: buf, mime: 'image/jpeg' };
  } catch {
    return null;
  }
}

export async function deletePanoramaDiskCache(nodeId: string): Promise<void> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return;
  const dir = path.join(getPanoramaDiskCacheRoot(), id);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* */
  }
}

export async function deleteAllPanoramaDiskCache(): Promise<void> {
  const root = getPanoramaDiskCacheRoot();
  try {
    await fs.rm(root, { recursive: true, force: true });
  } catch {
    /* */
  }
  await fs.mkdir(root, { recursive: true });
}

export async function deletePanoramaDiskCacheExcept(keepIds: ReadonlySet<string>): Promise<void> {
  const root = getPanoramaDiskCacheRoot();
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return;
  }
  for (const name of names) {
    if (keepIds.has(name)) continue;
    const safe = assertSafeMaterialNodeId(name);
    if (!safe) continue;
    await deletePanoramaDiskCache(safe);
  }
}
