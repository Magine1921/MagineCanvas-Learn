import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMagineCacheRoot, MATERIAL_DISK_CACHE_SEGMENT } from '@/lib/magine-cache-root.server';
import { fetchSafeOutboundUrl } from '@/lib/server-outbound-request';

/** 素材磁盘缓存：`<magine-cache>/materials/<nodeId>/` */
export { MATERIAL_DISK_CACHE_SEGMENT };
export const MATERIAL_DISK_MATERIALS_DIR = 'materials' as const;

const CACHE_IMAGE_JPEG = 'image.jpg';
const CACHE_IMAGE_LEGACY = 'image.bin';
const CACHE_VIDEO_MP4 = 'video.mp4';
const CACHE_AUDIO_FILE = 'audio.bin';

export type MaterialDiskCacheKind = 'image' | 'video' | 'audio';

export const MATERIAL_DISK_RETENTION_MS = 15 * 24 * 60 * 60 * 1000;

export function getMaterialDiskCacheRoot(): string {
  return path.join(getMagineCacheRoot(), MATERIAL_DISK_MATERIALS_DIR);
}

/** 与画布节点 id 一致（node_ 前缀 + 安全字符） */
export function assertSafeMaterialNodeId(nodeId: string): string | null {
  if (!nodeId || nodeId.length > 120) return null;
  if (!/^node_[a-zA-Z0-9_-]+$/.test(nodeId)) return null;
  return nodeId;
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

/** 将任意常见位图解码并统一存为 JPEG，减小缓存体积并满足「以 JPG 落盘」 */
async function encodeBufferToJpeg(buffer: Buffer): Promise<Buffer | null> {
  try {
    const sharp = (await import('sharp')).default;
    return await sharp(buffer).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  } catch {
    return null;
  }
}

function detectImageMime(buffer: Buffer, source = ''): string {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  const ext = path.extname(source).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function waitForReadableFile(filePath: string, attempts = 20, delayMs = 500): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile() && stat.size > 0) return true;
    } catch {
      // The Dreamina CLI can report result_json.images[].path before the file is flushed.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function waitForStableReadableFile(filePath: string, attempts = 40, delayMs = 500): Promise<boolean> {
  let lastSize = -1;
  let stableCount = 0;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile() && stat.size > 0) {
        if (stat.size === lastSize) {
          stableCount += 1;
          if (stableCount >= 2) return true;
        } else {
          stableCount = 0;
          lastSize = stat.size;
        }
      }
    } catch {
      stableCount = 0;
      lastSize = -1;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function writeImageCache(
  nodeId: string,
  buffer: Buffer,
  meta: Record<string, unknown>,
  source = '',
): Promise<boolean> {
  if (buffer.length === 0) return false;
  const root = getMaterialDiskCacheRoot();
  const dir = path.join(root, nodeId);
  await fs.mkdir(dir, { recursive: true });

  const jpeg = await encodeBufferToJpeg(buffer);
  if (jpeg && jpeg.length > 0) {
    await fs.writeFile(path.join(dir, CACHE_IMAGE_JPEG), jpeg);
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({
      ...meta,
      mime: 'image/jpeg',
      format: 'jpeg',
      bytes: jpeg.length,
    }, null, 0), 'utf8');
    try {
      await fs.unlink(path.join(dir, CACHE_IMAGE_LEGACY));
    } catch {
      /* no legacy file */
    }
    return true;
  }

  const mime = detectImageMime(buffer, source);
  if (!mime.startsWith('image/')) return false;
  await fs.writeFile(path.join(dir, CACHE_IMAGE_LEGACY), buffer);
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({
    ...meta,
    mime,
    format: path.extname(source).replace('.', '').toLowerCase() || 'original',
    bytes: buffer.length,
    jpegFallback: true,
  }, null, 0), 'utf8');
  try {
    await fs.unlink(path.join(dir, CACHE_IMAGE_JPEG));
  } catch {
    /* no jpeg file */
  }
  return true;
}

async function fetchUrlToBuffer(url: string, attempts = 3): Promise<Buffer | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetchSafeOutboundUrl(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'MagineCanvas/0.2 ProjectMediaCache' },
      }, { allowedProtocols: ['http:', 'https:'] });
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > 0) return buffer;
      }
    } catch {
      // Temporary image hosts can fail intermittently; retry before giving up.
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  return null;
}

export async function saveMaterialFromUrlToDiskCache(nodeId: string, imageUrl: string): Promise<boolean> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return false;
  const buffer = await fetchUrlToBuffer(imageUrl);
  if (!buffer || buffer.length === 0) return false;
  return writeImageCache(id, buffer, {
    savedAt: new Date().toISOString(),
    sourceKind: 'http',
    sourceUrl: imageUrl,
  }, imageUrl);
}

export async function saveMaterialFromLocalPathToDiskCache(nodeId: string, localPath: string): Promise<boolean> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return false;
  const resolved = resolveLocalVideoPath(localPath);
  if (!resolved) return false;
  try {
    const ready = await waitForReadableFile(resolved);
    if (!ready) return false;
    const buffer = await fs.readFile(resolved);
    return writeImageCache(id, buffer, {
      savedAt: new Date().toISOString(),
      sourceKind: 'local',
      sourcePath: resolved,
    }, resolved);
  } catch {
    return false;
  }
}

function resolveLocalVideoPath(localPath: string): string | null {
  const trimmed = localPath.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith('file://')) {
      return fileURLToPath(trimmed);
    }
    return path.resolve(trimmed);
  } catch {
    return null;
  }
}

/** 将 CLI 落盘的本地 mp4 复制到项目素材缓存 */
export async function saveVideoFromLocalPathToDiskCache(nodeId: string, localPath: string): Promise<boolean> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return false;
  const resolved = resolveLocalVideoPath(localPath);
  if (!resolved) return false;
  try {
    const ready = await waitForStableReadableFile(resolved);
    if (!ready) return false;
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size <= 0) return false;
    const buffer = await fs.readFile(resolved);
    const root = getMaterialDiskCacheRoot();
    const dir = path.join(root, id);
    await fs.mkdir(dir, { recursive: true });
    const meta = {
      savedAt: new Date().toISOString(),
      mime: 'video/mp4',
      format: 'mp4',
      kind: 'video',
      sourceKind: 'local',
      sourcePath: resolved,
      bytes: buffer.length,
    };
    await fs.writeFile(path.join(dir, CACHE_VIDEO_MP4), buffer);
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 0), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export async function saveVideoFromUrlToDiskCache(nodeId: string, videoUrl: string): Promise<boolean> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return false;
  const buffer = await fetchUrlToBuffer(videoUrl);
  if (!buffer || buffer.length === 0) return false;
  const root = getMaterialDiskCacheRoot();
  const dir = path.join(root, id);
  await fs.mkdir(dir, { recursive: true });
  const meta = {
    savedAt: new Date().toISOString(),
    mime: 'video/mp4',
    format: 'mp4',
    kind: 'video',
    sourceKind: 'http',
    bytes: buffer.length,
  };
  await fs.writeFile(path.join(dir, CACHE_VIDEO_MP4), buffer);
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 0), 'utf8');
  return true;
}

function detectAudioMime(buffer: Buffer, source = ''): string {
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF') return 'audio/wav';
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'fLaC') return 'audio/flac';
  const ext = path.extname(source).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg' || ext === '.opus') return 'audio/ogg';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.m4a' || ext === '.aac') return 'audio/mp4';
  return 'audio/mpeg';
}

async function writeAudioCache(
  nodeId: string,
  buffer: Buffer,
  source = '',
  sourceMime = '',
): Promise<boolean> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id || buffer.length === 0) return false;
  const mime = sourceMime.toLowerCase().startsWith('audio/')
    ? sourceMime
    : detectAudioMime(buffer, source);
  const dir = path.join(getMaterialDiskCacheRoot(), id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, CACHE_AUDIO_FILE), buffer);
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({
    savedAt: new Date().toISOString(),
    mime,
    kind: 'audio',
    sourceUrl: /^https?:\/\//i.test(source) ? source : undefined,
    bytes: buffer.length,
  }, null, 0), 'utf8');
  return true;
}

export async function saveAudioFromUrlToDiskCache(nodeId: string, audioUrl: string): Promise<boolean> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return false;
  const buffer = await fetchUrlToBuffer(audioUrl);
  if (!buffer) return false;
  return writeAudioCache(id, buffer, audioUrl);
}

export async function saveAudioToDiskCache(nodeId: string, dataUrl: string): Promise<boolean> {
  const parsed = parseDataUrlToBuffer(dataUrl);
  if (!parsed || parsed.buffer.length === 0 || !parsed.mime.toLowerCase().startsWith('audio/')) {
    return false;
  }
  return writeAudioCache(nodeId, parsed.buffer, '', parsed.mime);
}

export async function readAudioFromDiskCache(
  nodeId: string,
): Promise<{ buffer: Buffer; mime: string } | null> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return null;
  const dir = path.join(getMaterialDiskCacheRoot(), id);
  try {
    const [buffer, metaRaw] = await Promise.all([
      fs.readFile(path.join(dir, CACHE_AUDIO_FILE)),
      fs.readFile(path.join(dir, 'meta.json'), 'utf8').catch(() => '{}'),
    ]);
    const meta = JSON.parse(metaRaw) as { mime?: string };
    return {
      buffer,
      mime: typeof meta.mime === 'string' && meta.mime.startsWith('audio/')
        ? meta.mime
        : detectAudioMime(buffer),
    };
  } catch {
    return null;
  }
}

/** 删除超过保留期的子目录（按 meta.json 的 savedAt） */
export async function purgeExpiredMaterialDiskCache(maxAgeMs = MATERIAL_DISK_RETENTION_MS): Promise<void> {
  const root = getMaterialDiskCacheRoot();
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
      /* 无 meta 时用目录 mtime */
    }
    if (now - savedAt > maxAgeMs) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

export async function saveMaterialToDiskCache(nodeId: string, dataUrl: string): Promise<boolean> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return false;
  const parsed = parseDataUrlToBuffer(dataUrl);
  if (!parsed || parsed.buffer.length === 0) return false;
  return writeImageCache(id, parsed.buffer, {
    savedAt: new Date().toISOString(),
    sourceMime: parsed.mime,
  });
}

export async function saveMaterialBufferToDiskCache(
  nodeId: string,
  buffer: Buffer,
  sourceMime = 'application/octet-stream',
): Promise<boolean> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id || buffer.length === 0) return false;
  return writeImageCache(id, buffer, {
    savedAt: new Date().toISOString(),
    sourceKind: 'upload',
    sourceMime,
  });
}

export async function readMaterialFromDiskCache(
  nodeId: string
): Promise<{ buffer: Buffer; mime: string } | null> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return null;
  const dir = path.join(getMaterialDiskCacheRoot(), id);
  const jpgPath = path.join(dir, CACHE_IMAGE_JPEG);
  try {
    const buf = await fs.readFile(jpgPath);
    return { buffer: buf, mime: 'image/jpeg' };
  } catch {
    /* 兼容旧版 image.bin */
  }
  const legacyPath = path.join(dir, CACHE_IMAGE_LEGACY);
  try {
    const [buf, metaRaw] = await Promise.all([
      fs.readFile(legacyPath),
      fs.readFile(path.join(dir, 'meta.json'), 'utf8').catch(() => '{}'),
    ]);
    let mime = 'application/octet-stream';
    try {
      const j = JSON.parse(metaRaw) as { mime?: string };
      if (typeof j.mime === 'string' && j.mime) mime = j.mime;
    } catch {
      /* */
    }
    return { buffer: buf, mime };
  } catch {
    return null;
  }
}

export async function hasMaterialDiskCache(
  nodeId: string,
  kind: MaterialDiskCacheKind = 'image',
): Promise<boolean> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return false;
  const dir = path.join(getMaterialDiskCacheRoot(), id);
  const candidates = kind === 'video'
    ? [CACHE_VIDEO_MP4]
    : kind === 'audio'
      ? [CACHE_AUDIO_FILE]
      : [CACHE_IMAGE_JPEG, CACHE_IMAGE_LEGACY];

  for (const fileName of candidates) {
    try {
      const stat = await fs.stat(path.join(dir, fileName));
      if (stat.isFile() && stat.size > 0) return true;
    } catch {
      // Try the next compatible cache file.
    }
  }
  return false;
}

export async function deleteMaterialDiskCache(nodeId: string): Promise<void> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return;
  const dir = path.join(getMaterialDiskCacheRoot(), id);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* */
  }
}

export async function deleteAllMaterialDiskCache(): Promise<void> {
  const root = getMaterialDiskCacheRoot();
  try {
    await fs.rm(root, { recursive: true, force: true });
  } catch {
    /* */
  }
  await fs.mkdir(root, { recursive: true });
}

/** 仅保留给定节点 id 对应的目录，其余删除（导入工作流时 GC） */
/** 将 data:video/* 原样写入侧车（剪辑台导出 / 大视频持久化） */
export async function saveVideoToDiskCache(nodeId: string, dataUrl: string): Promise<boolean> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return false;
  const parsed = parseDataUrlToBuffer(dataUrl);
  if (!parsed || parsed.buffer.length === 0) return false;
  if (!parsed.mime.toLowerCase().startsWith('video/') && !parsed.mime.includes('octet-stream')) {
    return false;
  }
  const root = getMaterialDiskCacheRoot();
  const dir = path.join(root, id);
  await fs.mkdir(dir, { recursive: true });
  const meta = {
    savedAt: new Date().toISOString(),
    mime: parsed.mime.includes('video') ? parsed.mime : 'video/mp4',
    format: 'mp4',
    kind: 'video',
    bytes: parsed.buffer.length,
  };
  await fs.writeFile(path.join(dir, CACHE_VIDEO_MP4), parsed.buffer);
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 0), 'utf8');
  return true;
}

export async function readVideoFromDiskCache(
  nodeId: string
): Promise<{ buffer: Buffer; mime: string } | null> {
  const id = assertSafeMaterialNodeId(nodeId);
  if (!id) return null;
  const videoPath = path.join(getMaterialDiskCacheRoot(), id, CACHE_VIDEO_MP4);
  try {
    const buf = await fs.readFile(videoPath);
    let mime = 'video/mp4';
    try {
      const metaRaw = await fs.readFile(path.join(getMaterialDiskCacheRoot(), id, 'meta.json'), 'utf8');
      const j = JSON.parse(metaRaw) as { mime?: string };
      if (typeof j.mime === 'string' && j.mime) mime = j.mime;
    } catch {
      /* */
    }
    return { buffer: buf, mime };
  } catch {
    return null;
  }
}

export async function deleteMaterialDiskCacheExcept(keepIds: ReadonlySet<string>): Promise<void> {
  const root = getMaterialDiskCacheRoot();
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
    await deleteMaterialDiskCache(safe);
  }
}
