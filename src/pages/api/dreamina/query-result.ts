// 即梦CLI - 查询异步任务结果
import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execDreaminaCli } from '@/lib/dreamina-cli-exec';
import {
  extractImagesFromResult,
  extractLocalImagePath,
  extractLocalVideoPath,
  extractVideoUrl,
} from '@/lib/dreamina-cli-result';
import {
  assertSafeMaterialNodeId,
  saveMaterialFromLocalPathToDiskCache,
  saveMaterialFromUrlToDiskCache,
  saveMaterialToDiskCache,
  saveVideoFromLocalPathToDiskCache,
  saveVideoFromUrlToDiskCache,
} from '@/lib/project-material-disk-cache.server';
import { getMagineCacheRoot } from '@/lib/magine-cache-root.server';
import {
  appendDreaminaCliTrace,
  parseDreaminaCliStdout,
  prepareDreaminaCliRoute,
  respondDreaminaCliExecError,
} from '@/lib/dreamina-cli-route.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

interface QueryResultBody {
  cliPath?: string;
  submit_id: string;
  download_dir?: string;
  nodeId?: string;
}

function buildPlayableVideoUrl(nodeId: string, version?: string): string {
  const v = version ? `&v=${encodeURIComponent(version)}` : '';
  return `/api/project-cache/material?nodeId=${encodeURIComponent(nodeId)}&kind=video${v}`;
}

function buildPlayableImageUrl(nodeId: string, version?: string): string {
  const v = version ? `&v=${encodeURIComponent(version)}` : '';
  return `/api/project-cache/material?nodeId=${encodeURIComponent(nodeId)}${v}`;
}

function isLocalFileLike(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (trimmed.startsWith('data:')) return false;
  if (trimmed.startsWith('/api/')) return false;
  return trimmed.startsWith('file://') || /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('/');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function inspectLocalFileForTrace(localPath?: string): Promise<Record<string, unknown> | null> {
  if (!localPath) return null;
  try {
    const stat = await fs.stat(localPath);
    return {
      path: localPath,
      exists: true,
      isFile: stat.isFile(),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch (e) {
    return {
      path: localPath,
      exists: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function buildImageCacheNodeId(nodeId: string, submitId: string, index: number, source: string): string {
  const hash = crypto.createHash('sha1').update(`${submitId}|${index}|${source}`).digest('hex').slice(0, 12);
  const suffix = `-img-${hash}-${index}`;
  return `${nodeId.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`;
}

function buildVideoCacheNodeId(nodeId: string, submitId: string, source: string): string {
  const hash = crypto.createHash('sha1').update(`${submitId}|${source}`).digest('hex').slice(0, 16);
  const suffix = `-vid-${hash}`;
  return `${nodeId.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`;
}

function replaceImageUrls(
  value: unknown,
  images: Array<{ image_url: string; size?: string }>,
  seen = new Set<object>(),
  depth = 0,
): void {
  if (depth > 5 || value == null || images.length === 0) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      replaceImageUrls(item, images, seen, depth + 1);
    }
    return;
  }

  const record = asRecord(value);
  if (!record || seen.has(record)) return;
  seen.add(record);

  if (Array.isArray(record.images)) {
    record.images = record.images.map((item, index) => ({
      ...(asRecord(item) || {}),
      ...images[Math.min(index, images.length - 1)],
    }));
  }

  if (typeof record.image_url === 'string') {
    record.image_url = images[0].image_url;
  }

  for (const key of ['data', 'result', 'result_json', 'response', 'output', 'outputs', 'payload']) {
    replaceImageUrls(record[key], images, seen, depth + 1);
  }
}

async function attachPlayableImageUrl(
  data: Record<string, unknown>,
  nodeId: string | null,
  submitId: string,
): Promise<void> {
  if (!nodeId) return;

  try {
    const extracted = extractImagesFromResult(data);
    const sources = extracted.length > 0
      ? extracted.map((item) => ({ source: item.image_url, size: item.size }))
      : [];
    if (sources.length === 0) {
      const localSource = extractLocalImagePath(data);
      if (localSource) sources.push({ source: localSource, size: undefined });
    }
    if (sources.length === 0) return;

    const source = sources.map((item) => item.source).join(', ');
    const localSource = '';
    const playableImages: Array<{ image_url: string; size?: string }> = [];
    for (const [index, item] of sources.entries()) {
      const cacheSource = item.source.trim();
      if (!cacheSource) continue;
      const cacheNodeId = buildImageCacheNodeId(nodeId, submitId, index, cacheSource);
      const cached = isLocalFileLike(cacheSource)
        ? await saveMaterialFromLocalPathToDiskCache(cacheNodeId, cacheSource)
        : /^https?:\/\//i.test(cacheSource)
          ? await saveMaterialFromUrlToDiskCache(cacheNodeId, cacheSource)
          : cacheSource.startsWith('data:')
            ? await saveMaterialToDiskCache(cacheNodeId, cacheSource)
            : false;
      if (!cached) continue;
      playableImages.push({
        image_url: buildPlayableImageUrl(cacheNodeId, `${submitId}-${index}`),
        size: item.size,
      });
    }

    if (playableImages.length > 0) {
      data.image_url = playableImages[0].image_url;
      data.images = playableImages;
      replaceImageUrls(data, playableImages);
    } else {
      data.cache_status = 'image-cache-failed';
      data.fail_reason =
        typeof data.fail_reason === 'string' && data.fail_reason.trim()
          ? data.fail_reason
          : `生成已完成，但本地素材缓存失败：${localSource || source}`;
    }
  } catch (e) {
    console.warn('[dreamina] query_result 图片缓存失败（仍返回原始 CLI 结果）', e);
    data.cache_status = 'image-cache-error';
    data.fail_reason =
      typeof data.fail_reason === 'string' && data.fail_reason.trim()
        ? data.fail_reason
        : `生成已完成，但图片缓存异常：${e instanceof Error ? e.message : String(e)}`;
  }
}

async function attachPlayableVideoUrl(
  data: Record<string, unknown>,
  nodeId: string | null,
  submitId: string,
): Promise<void> {
  if (!nodeId) return;

  try {
    const source = extractVideoUrl(data) || extractLocalVideoPath(data);
    if (!source) return;
    const cacheNodeId = buildVideoCacheNodeId(nodeId, submitId, source);

    let cached = false;
    if (/^https?:\/\//i.test(source)) {
      cached = await saveVideoFromUrlToDiskCache(cacheNodeId, source);
    } else {
      cached = await saveVideoFromLocalPathToDiskCache(cacheNodeId, source);
    }

    if (cached) {
      data.video_url = buildPlayableVideoUrl(cacheNodeId, submitId);
    }
  } catch (e) {
    console.warn('[dreamina] query_result 视频缓存失败（仍返回原始 CLI 结果）:', e);
  }
}

async function findNewestFileByExt(
  dir: string,
  extensions: readonly string[],
  minMtimeMs = 0,
  depth = 0,
): Promise<string | null> {
  if (depth > 3) return null;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  let best: { path: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findNewestFileByExt(full, extensions, minMtimeMs, depth + 1);
      if (!nested) continue;
      try {
        const stat = await fs.stat(nested);
        if (stat.isFile() && stat.mtimeMs >= minMtimeMs && (!best || stat.mtimeMs > best.mtimeMs)) {
          best = { path: nested, mtimeMs: stat.mtimeMs };
        }
      } catch {
        /* ignore unreadable nested file */
      }
      continue;
    }
    if (!entry.isFile()) continue;
    if (!extensions.includes(path.extname(entry.name).toLowerCase())) continue;
    try {
      const stat = await fs.stat(full);
      if (stat.isFile() && stat.size > 0 && stat.mtimeMs >= minMtimeMs && (!best || stat.mtimeMs > best.mtimeMs)) {
        best = { path: full, mtimeMs: stat.mtimeMs };
      }
    } catch {
      /* ignore unreadable file */
    }
  }
  return best?.path || null;
}

async function buildDownloadDirFallbackResult(
  downloadDir: string | undefined,
  nodeId: string | null,
  submitId: string,
  minMtimeMs = 0,
): Promise<Record<string, unknown> | null> {
  if (!downloadDir || !nodeId) return null;

  const localVideo = await findNewestFileByExt(downloadDir, ['.mp4', '.mov', '.webm', '.m4v'], minMtimeMs);
  if (!localVideo) return null;

  const cacheNodeId = buildVideoCacheNodeId(nodeId, submitId, localVideo);
  const cached = await saveVideoFromLocalPathToDiskCache(cacheNodeId, localVideo);
  if (!cached) return null;

  return {
    ok: true,
    submit_id: submitId,
    gen_status: 'success',
    status: 'success',
    video_url: buildPlayableVideoUrl(cacheNodeId, submitId),
    local_video_path: localVideo,
    cache_status: 'fallback-from-download-dir',
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (req.method === 'POST' && !(await preparePagesApiJsonBody(req, res))) return;

  const body = (req.method === 'POST' ? req.body : req.query) as QueryResultBody;
  const { cliPath } = await prepareDreaminaCliRoute(body);
  const submitId = (body.submit_id || '').trim();
  const nodeIdRaw = typeof body.nodeId === 'string' ? body.nodeId : '';
  const safeNodeId = nodeIdRaw ? assertSafeMaterialNodeId(nodeIdRaw) : null;

  if (!submitId) {
    return res.status(400).json({ ok: false, error: '缺少 submit_id 参数' });
  }

  let downloadDir: string | undefined;
  if (typeof body.download_dir === 'string' && body.download_dir.trim()) {
    downloadDir = body.download_dir.trim();
  } else if (safeNodeId) {
    downloadDir = path.join(getMagineCacheRoot(), 'dreamina-results', safeNodeId);
    try {
      await fs.mkdir(downloadDir, { recursive: true });
    } catch (e) {
      const failedDownloadDir = downloadDir || '';
      const args = ['query_result', '--submit_id', submitId, '--download_dir', failedDownloadDir];
      const cmd = `${cliPath} ${args.join(' ')}`;
      console.error('[dreamina] query_result download_dir create failed', failedDownloadDir, e);
      await respondDreaminaCliExecError(res, e, cmd, {
        route: 'dreamina/query-result',
        cliPath,
        args,
        body: body as unknown as Record<string, unknown>,
        note: `downloadDir=${failedDownloadDir}`,
      });
      return;
    }
  }

  const args = ['query_result', '--submit_id', submitId];
  if (downloadDir) args.push('--download_dir', downloadDir);

  const cmd = `${cliPath} ${args.join(' ')}`;
  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await execDreaminaCli(cliPath, args, {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const data = parseDreaminaCliStdout(stdout, stderr);
    const beforeCache = {
      images: extractImagesFromResult(data),
      localImagePath: extractLocalImagePath(data),
      videoUrl: extractVideoUrl(data),
      localVideoPath: extractLocalVideoPath(data),
    };
    const beforeCacheFile = {
      localImageFile: await inspectLocalFileForTrace(beforeCache.localImagePath),
      localVideoFile: await inspectLocalFileForTrace(beforeCache.localVideoPath),
    };
    await attachPlayableImageUrl(data, safeNodeId, submitId);
    await attachPlayableVideoUrl(data, safeNodeId, submitId);
    const fallbackVideo =
      safeNodeId && !extractVideoUrl(data)
        ? await buildDownloadDirFallbackResult(downloadDir, safeNodeId, submitId, startedAt)
        : null;
    if (fallbackVideo) {
      await appendDreaminaCliTrace('server-success-download-dir-fallback', {
        route: 'dreamina/query-result',
        cliPath,
        cmd,
        args,
        body: body as unknown as Record<string, unknown>,
        stdout,
        stderr,
        data: { result: fallbackVideo, original: data, downloadDir, safeNodeId },
        elapsedMs: Date.now() - startedAt,
      });
      return res.json({ ok: true, data: fallbackVideo });
    }
    const afterCache = {
      images: extractImagesFromResult(data),
      localImagePath: extractLocalImagePath(data),
      videoUrl: extractVideoUrl(data),
      localVideoPath: extractLocalVideoPath(data),
      topLevelImageUrl: data.image_url,
      topLevelVideoUrl: data.video_url,
    };
    await appendDreaminaCliTrace('server-success', {
      route: 'dreamina/query-result',
      cliPath,
      cmd,
      args,
      body: body as unknown as Record<string, unknown>,
      stdout,
      stderr,
      data: { result: data, cache: { beforeCache, beforeCacheFile, afterCache, downloadDir, safeNodeId } },
      elapsedMs: Date.now() - startedAt,
    });
    return res.json({ ok: true, data });
  } catch (e) {
    console.error(`[dreamina] ✗ query_result 失败`, e);
    const fallback = await buildDownloadDirFallbackResult(downloadDir, safeNodeId, submitId, startedAt);
    if (fallback) {
      await appendDreaminaCliTrace('server-fallback-success', {
        route: 'dreamina/query-result',
        cliPath,
        cmd,
        args,
        body: body as unknown as Record<string, unknown>,
        data: { result: fallback, downloadDir, safeNodeId },
        error: e,
      });
      return res.json({ ok: true, data: fallback });
    }
    await respondDreaminaCliExecError(res, e, cmd, {
      route: 'dreamina/query-result',
      cliPath,
      args,
      body: body as unknown as Record<string, unknown>,
    });
  }
}

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};
