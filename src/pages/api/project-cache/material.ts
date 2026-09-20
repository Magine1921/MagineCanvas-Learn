import type { NextApiRequest, NextApiResponse } from 'next';
import {
  deleteAllMaterialDiskCache,
  deleteMaterialDiskCache,
  deleteMaterialDiskCacheExcept,
  readAudioFromDiskCache,
  readMaterialFromDiskCache,
  saveAudioFromUrlToDiskCache,
  saveAudioToDiskCache,
  saveMaterialFromUrlToDiskCache,
  saveMaterialToDiskCache,
  saveVideoFromLocalPathToDiskCache,
  saveVideoFromUrlToDiskCache,
  saveVideoToDiskCache,
  readVideoFromDiskCache,
} from '@/lib/project-material-disk-cache.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';
import {
  cloudflareMaterialObjectKey,
  deleteCloudflareMaterialNode,
  fallbackCloudflareMaterialMime,
  getCloudflareMaterialBucket,
  parseCloudflareMediaRange,
  putCloudflareMaterialBytes,
  putCloudflareMaterialFromUrl,
  type CloudflareMaterialKind,
  type CloudflareMaterialWriteResult,
} from '@/lib/cloudflare-material-cache.server';

export const config = {
  api: {
    bodyParser: false,
  },
};

function sendCachedMedia(
  req: NextApiRequest,
  res: NextApiResponse,
  data: { mime: string; buffer: Buffer },
) {
  const isRangedMedia = /^(?:video|audio)\//i.test(data.mime);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', data.mime);

  if (!isRangedMedia) {
    res.status(200).send(data.buffer);
    return;
  }

  const size = data.buffer.length;
  res.setHeader('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', String(size));
    res.status(200).send(data.buffer);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.setHeader('Content-Range', `bytes */${size}`);
    res.status(416).end();
    return;
  }

  const startText = match[1] || '';
  const endText = match[2] || '';
  let start = startText ? Number(startText) : 0;
  let end = endText ? Number(endText) : size - 1;

  if (!startText && endText) {
    const suffix = Number(endText);
    start = Math.max(size - suffix, 0);
    end = size - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    res.setHeader('Content-Range', `bytes */${size}`);
    res.status(416).end();
    return;
  }

  end = Math.min(end, size - 1);
  const chunk = data.buffer.subarray(start, end + 1);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Content-Length', String(chunk.length));
  res.status(206).send(chunk);
}

function cloudflareMaterialKind(value: unknown): CloudflareMaterialKind {
  if (value === 'video' || value === 'audio') return value;
  return 'image';
}

function parseBase64MediaDataUrl(value: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(value.trim());
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[2], 'base64');
    return buffer.length > 0
      ? { mime: match[1].toLowerCase(), bytes: new Uint8Array(buffer) }
      : null;
  } catch {
    return null;
  }
}

async function pipeCloudflareMaterial(
  req: NextApiRequest,
  res: NextApiResponse,
  bucket: MagineMediaR2Bucket,
  nodeId: string,
  kind: CloudflareMaterialKind,
): Promise<void> {
  const key = cloudflareMaterialObjectKey(nodeId, kind);
  if (!key) {
    res.status(400).json({ ok: false, error: 'invalid node id' });
    return;
  }

  const head = await bucket.head(key);
  if (!head || head.size <= 0) {
    res.status(404).end();
    return;
  }

  const rawRange = typeof req.headers.range === 'string' ? req.headers.range : '';
  const range = rawRange ? parseCloudflareMediaRange(rawRange, head.size) : undefined;
  if (rawRange && !range) {
    res.setHeader('Content-Range', `bytes */${head.size}`);
    res.status(416).end();
    return;
  }

  const object = await bucket.get(key, range ? { range } : undefined);
  if (!object) {
    res.status(404).end();
    return;
  }

  const contentLength = range?.length || object.size;
  const mime = object.httpMetadata?.contentType || head.httpMetadata?.contentType || fallbackCloudflareMaterialMime(kind);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Content-Length', String(contentLength));
  res.setHeader('Cache-Control', object.httpMetadata?.cacheControl || 'private, max-age=300');
  if (object.httpEtag || head.httpEtag) res.setHeader('ETag', object.httpEtag || head.httpEtag!);
  if (kind === 'video' || kind === 'audio') res.setHeader('Accept-Ranges', 'bytes');
  if (range) {
    res.setHeader(
      'Content-Range',
      `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`,
    );
  }

  res.status(range ? 206 : 200);
  if (typeof (res as NodeJS.WritableStream & { flushHeaders?: () => void }).flushHeaders === 'function') {
    (res as NodeJS.WritableStream & { flushHeaders: () => void }).flushHeaders();
  }

  const reader = object.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => res.once('drain', resolve));
      }
    }
  } finally {
    reader.releaseLock();
  }
  res.end();
}

async function handleCloudflareMaterialRequest(
  req: NextApiRequest,
  res: NextApiResponse,
  bucket: MagineMediaR2Bucket,
): Promise<void> {
  const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId : '';
  const kind = cloudflareMaterialKind(req.query.kind);

  if (req.method === 'HEAD') {
    const key = cloudflareMaterialObjectKey(nodeId, kind);
    const object = key ? await bucket.head(key) : null;
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(object && object.size > 0 ? 200 : 404).end();
    return;
  }

  if (req.method === 'GET') {
    await pipeCloudflareMaterial(req, res, bucket, nodeId, kind);
    return;
  }

  if (req.method === 'POST') {
    if (!(await preparePagesApiJsonBody(req, res, 32 * 1024 * 1024))) return;
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as {
      action?: string;
      nodeId?: string;
      dataUrl?: string;
      imageUrl?: string;
      kind?: string;
      keepNodeIds?: string[];
    };
    if (body.action === 'gc') {
      // The R2 bucket is shared by web-trial users. A client may never delete another
      // user's objects just because they are absent from its own workflow.
      res.status(200).json({ ok: true, storage: 'r2', gc: 'shared-bucket-skipped' });
      return;
    }

    const bodyNodeId = typeof body.nodeId === 'string' ? body.nodeId : '';
    const bodyKind = cloudflareMaterialKind(body.kind);
    const remoteUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
    const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
    let writeResult: CloudflareMaterialWriteResult;
    if (remoteUrl) {
      writeResult = await putCloudflareMaterialFromUrl(bucket, bodyNodeId, bodyKind, remoteUrl);
    } else {
      const parsed = parseBase64MediaDataUrl(dataUrl);
      writeResult = parsed
        ? await putCloudflareMaterialBytes(bucket, bodyNodeId, bodyKind, parsed.bytes, parsed.mime)
        : { ok: false, error: 'valid dataUrl or imageUrl required' };
    }
    if (!writeResult.ok) {
      let sourceHost = '';
      try {
        sourceHost = remoteUrl ? new URL(remoteUrl).hostname : '';
      } catch {
        sourceHost = '';
      }
      console.error('[project-media-cache] R2 write failed', {
        nodeId: bodyNodeId,
        kind: bodyKind,
        sourceHost,
        error: writeResult.error,
      });
      res.status(422).json({ ok: false, error: writeResult.error || 'R2 media cache write failed' });
      return;
    }
    console.info('[project-media-cache] R2 write complete', {
      nodeId: bodyNodeId,
      kind: bodyKind,
      bytes: writeResult.bytes,
    });
    res.status(200).json({ ok: true, storage: 'r2', bytes: writeResult.bytes, mime: writeResult.mime });
    return;
  }

  if (req.method === 'DELETE') {
    const purge = typeof req.query.purge === 'string' ? req.query.purge : '';
    if (purge === 'all') {
      res.status(200).json({ ok: true, storage: 'r2', purge: 'shared-bucket-skipped' });
      return;
    }
    await deleteCloudflareMaterialNode(bucket, nodeId);
    res.status(200).json({ ok: true, storage: 'r2' });
    return;
  }

  res.setHeader('Allow', 'HEAD, GET, POST, DELETE');
  res.status(405).end();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId : '';
    const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
    const data =
      kind === 'video'
        ? await readVideoFromDiskCache(nodeId)
        : kind === 'audio'
          ? await readAudioFromDiskCache(nodeId)
          : await readMaterialFromDiskCache(nodeId);
    if (!data && !kind) {
      const videoFallback = await readVideoFromDiskCache(nodeId);
      if (videoFallback) {
        sendCachedMedia(req, res, videoFallback);
        return;
      }
    }
    if (!data) {
      res.status(404).end();
      return;
    }
    sendCachedMedia(req, res, data);
    return;
  }

  if (req.method === 'POST') {
    if (!(await preparePagesApiJsonBody(req, res, 32 * 1024 * 1024))) return;
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as {
      action?: string;
      nodeId?: string;
      dataUrl?: string;
      imageUrl?: string;
      localPath?: string;
      kind?: string;
      keepNodeIds?: string[];
    };
    if (body.action === 'gc' && Array.isArray(body.keepNodeIds)) {
      const keep = new Set(body.keepNodeIds.filter((x) => typeof x === 'string'));
      await deleteMaterialDiskCacheExcept(keep);
      res.status(200).json({ ok: true });
      return;
    }
    const nodeId = typeof body.nodeId === 'string' ? body.nodeId : '';
    const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
    const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
    const localPath = typeof body.localPath === 'string' ? body.localPath : '';
    const isRemoteUrl = /^https?:\/\//i.test(imageUrl);
    if (localPath.trim() && body.kind === 'video') {
      const ok = await saveVideoFromLocalPathToDiskCache(nodeId, localPath);
      if (!ok) {
        res.status(400).json({ ok: false, error: 'save local video failed' });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }
    if (isRemoteUrl) {
      const isVideo = body.kind === 'video';
      const isAudio = body.kind === 'audio';
      const ok = isVideo
        ? await saveVideoFromUrlToDiskCache(nodeId, imageUrl)
        : isAudio
          ? await saveAudioFromUrlToDiskCache(nodeId, imageUrl)
          : await saveMaterialFromUrlToDiskCache(nodeId, imageUrl);
      if (!ok) {
        res.status(400).json({ ok: false, error: 'save failed' });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }
    if (!dataUrl.startsWith('data:')) {
      res.status(400).json({ ok: false, error: 'dataUrl or imageUrl required' });
      return;
    }
    const isVideo =
      body.kind === 'video' || /^data:video\//i.test(dataUrl);
    const isAudio =
      body.kind === 'audio' || /^data:audio\//i.test(dataUrl);
    const ok = isVideo
      ? await saveVideoToDiskCache(nodeId, dataUrl)
      : isAudio
        ? await saveAudioToDiskCache(nodeId, dataUrl)
        : await saveMaterialToDiskCache(nodeId, dataUrl);
    if (!ok) {
      res.status(400).json({ ok: false, error: 'save failed' });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === 'DELETE') {
    const purge = typeof req.query.purge === 'string' ? req.query.purge : '';
    if (purge === 'all') {
      await deleteAllMaterialDiskCache();
      res.status(200).json({ ok: true });
      return;
    }
    const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId : '';
    await deleteMaterialDiskCache(nodeId);
    res.status(200).json({ ok: true });
    return;
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  res.status(405).end();
}
