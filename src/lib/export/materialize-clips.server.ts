import fs from 'node:fs/promises';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import type { EditClip } from '@/lib/edit-timeline-types';
import type { MaterializedClipFile } from '@/lib/edit-timeline-ir';
import {
  assertSafeMaterialNodeId,
  readAudioFromDiskCache,
  readMaterialFromDiskCache,
  readVideoFromDiskCache,
} from '@/lib/project-material-disk-cache.server';
import { materialRefToNodeId } from '@/lib/canvas-material-idb';
import { fetchSafeOutboundUrl } from '@/lib/server-outbound-request';

const IDB_REF_PREFIX = 'idb://magine/material/v1/';

function isIdbMaterialRef(url: string): boolean {
  return url.startsWith(IDB_REF_PREFIX);
}

function projectCacheMaterialNodeId(url: string): string | null {
  if (!url.includes('/api/project-cache/material')) return null;
  try {
    const parsed = new URL(url, 'http://magine.local');
    if (parsed.pathname !== '/api/project-cache/material') return null;
    const nodeId = parsed.searchParams.get('nodeId')?.trim() || '';
    return assertSafeMaterialNodeId(nodeId) ? nodeId : null;
  } catch {
    return null;
  }
}

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const t = dataUrl.trim();
  const idx = t.indexOf(';base64,');
  if (idx === -1) return null;
  const mime = t.slice(5, idx) || 'application/octet-stream';
  try {
    const buf = Buffer.from(t.slice(idx + ';base64,'.length), 'base64');
    if (!buf.length) return null;
    return { mime, buffer: buf };
  } catch {
    return null;
  }
}

function extFromMime(mime: string, mediaKind: EditClip['mediaKind']): string {
  const m = mime.toLowerCase();
  if (m.includes('mp4') || m.includes('quicktime')) return '.mp4';
  if (m.includes('webm')) return '.webm';
  if (m.includes('mpeg') || m.includes('mp3')) return '.mp3';
  if (m.includes('wav')) return '.wav';
  if (m.includes('png')) return '.png';
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (mediaKind === 'video') return '.mp4';
  if (mediaKind === 'audio') return '.mp3';
  return '.jpg';
}

function safeBaseName(fileName: string | undefined, clipId: string, ext: string): string {
  const raw = (fileName || clipId).replace(/[^\w.\-()\u4e00-\u9fff]+/g, '_').slice(0, 80);
  const base = raw.replace(/\.[a-z0-9]+$/i, '') || clipId;
  return `${base}${ext}`;
}

async function fetchUrlBuffer(url: string): Promise<Buffer> {
  const res = await fetchSafeOutboundUrl(url, {}, { allowedProtocols: ['http:', 'https:'] });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}: ${url.slice(0, 120)}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function resolveClipBuffer(
  clip: EditClip,
  req?: NextRequest
): Promise<{ buffer: Buffer; mime: string }> {
  const srcUrl: string = clip.url.trim();
  if (!srcUrl) throw new Error(`片段 ${clip.id} 缺少媒体地址`);

  if (srcUrl.indexOf('data:') === 0) {
    const p = parseDataUrl(srcUrl);
    if (!p) throw new Error(`片段 ${clip.id} data URL 无效`);
    return p;
  }

  const projectCacheNodeId = projectCacheMaterialNodeId(srcUrl);
  if (projectCacheNodeId) {
    if (clip.mediaKind === 'video') {
      const video = await readVideoFromDiskCache(projectCacheNodeId);
      if (video) return video;
    }
    if (clip.mediaKind === 'audio') {
      const audio = await readAudioFromDiskCache(projectCacheNodeId);
      if (audio) return audio;
    }
    const material = await readMaterialFromDiskCache(projectCacheNodeId);
    if (material) return material;
    throw new Error(`片段 ${clip.id} 磁盘缓存未找到 (${projectCacheNodeId})`);
  }

  if (srcUrl.indexOf('http://') === 0 || srcUrl.indexOf('https://') === 0) {
    const buf = await fetchUrlBuffer(srcUrl);
    return { buffer: buf, mime: 'application/octet-stream' };
  }

  if (isIdbMaterialRef(srcUrl)) {
    const nodeId = materialRefToNodeId(srcUrl);
    if (!nodeId) throw new Error(`片段 ${clip.id} IDB 引用无效`);
    if (clip.mediaKind === 'video') {
      const v = await readVideoFromDiskCache(nodeId);
      if (v) return v;
    }
    if (clip.mediaKind === 'audio') {
      const audio = await readAudioFromDiskCache(nodeId);
      if (audio) return audio;
    }
    const img = await readMaterialFromDiskCache(nodeId);
    if (img) return img;
    throw new Error(`片段 ${clip.id} 磁盘缓存未找到 (${nodeId})`);
  } else {
    const nodeId = clip.sourceNodeId;
    if (assertSafeMaterialNodeId(nodeId)) {
      if (clip.mediaKind === 'video') {
        const v = await readVideoFromDiskCache(nodeId);
        if (v) return v;
      }
      if (clip.mediaKind === 'audio') {
        const audio = await readAudioFromDiskCache(nodeId);
        if (audio) return audio;
      }
      const img = await readMaterialFromDiskCache(nodeId);
      if (img) return img;
    }
  }

  if (srcUrl.indexOf('/') === 0 && req) {
    throw new Error(`片段 ${clip.id} 不允许读取未识别的本地接口地址`);
  }

  throw new Error(`片段 ${clip.id} 不支持的地址格式`);
}

export async function materializeClipsForExport(opts: {
  clips: EditClip[];
  workDir: string;
  req?: NextRequest;
  mediaDirectoryName?: string;
}): Promise<MaterializedClipFile[]> {
  const mediaDirectoryName = opts.mediaDirectoryName === undefined ? 'media' : opts.mediaDirectoryName;
  const mediaDir = mediaDirectoryName ? path.join(opts.workDir, mediaDirectoryName) : opts.workDir;
  await fs.mkdir(mediaDir, { recursive: true });
  const out: MaterializedClipFile[] = [];

  for (let i = 0; i < opts.clips.length; i++) {
    const clip = opts.clips[i];
    const { buffer, mime } = await resolveClipBuffer(clip, opts.req);
    const ext = extFromMime(mime, clip.mediaKind);
    const fileName = safeBaseName(clip.fileName, clip.id, ext);
    const relativePath = mediaDirectoryName
      ? path.posix.join(mediaDirectoryName, `${String(i + 1).padStart(3, '0')}_${fileName}`)
      : `${String(i + 1).padStart(3, '0')}_${fileName}`;
    const absolutePath = path.join(opts.workDir, relativePath);
    await fs.writeFile(absolutePath, buffer);
    out.push({
      clipId: clip.id,
      relativePath: relativePath.replace(/\\/g, '/'),
      absolutePath,
      mediaKind: clip.mediaKind,
      fileName,
    });
  }

  return out;
}
