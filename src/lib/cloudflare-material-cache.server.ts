import {
  assertSafeOutboundUrl,
  fetchSafeOutboundUrl,
  type OutboundRequestOptions,
} from './server-outbound-request.ts';

const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__');

export type CloudflareMaterialKind = 'image' | 'video' | 'audio';

export interface CloudflareMaterialWriteResult {
  ok: boolean;
  bytes?: number;
  mime?: string;
  error?: string;
}

const MATERIAL_PREFIX = 'project-material/v1/';
const MAX_REMOTE_MEDIA_BYTES = 512 * 1024 * 1024;
const REMOTE_FETCH_DELAYS_MS = [0, 800, 1800, 3500, 6000] as const;

export function getCloudflareMaterialBucket(): MagineMediaR2Bucket | null {
  const scope = globalThis as unknown as Record<
    symbol,
    { env?: CloudflareEnv } | undefined
  >;
  return scope[CLOUDFLARE_CONTEXT_SYMBOL]?.env?.WEB_TRIAL_MEDIA_BUCKET || null;
}

export function safeCloudflareMaterialNodeId(nodeId: string): string | null {
  if (!nodeId || nodeId.length > 120) return null;
  return /^node_[a-zA-Z0-9_-]+$/.test(nodeId) ? nodeId : null;
}

export function cloudflareMaterialObjectKey(
  nodeId: string,
  kind: CloudflareMaterialKind,
): string | null {
  const id = safeCloudflareMaterialNodeId(nodeId);
  return id ? `${MATERIAL_PREFIX}${id}/${kind}` : null;
}

export function cloudflareMaterialNodePrefix(nodeId: string): string | null {
  const id = safeCloudflareMaterialNodeId(nodeId);
  return id ? `${MATERIAL_PREFIX}${id}/` : null;
}

export function fallbackCloudflareMaterialMime(kind: CloudflareMaterialKind): string {
  if (kind === 'video') return 'video/mp4';
  if (kind === 'audio') return 'audio/mpeg';
  return 'image/jpeg';
}

function normalizeMime(value: string | null | undefined): string {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

export function isAcceptableCloudflareMaterialMime(
  kind: CloudflareMaterialKind,
  value: string | null | undefined,
): boolean {
  const mime = normalizeMime(value);
  if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') return true;
  if (kind === 'video') return mime.startsWith('video/');
  if (kind === 'audio') return mime.startsWith('audio/') || mime === 'video/mp4';
  return mime.startsWith('image/');
}

function resolvedCloudflareMaterialMime(
  kind: CloudflareMaterialKind,
  value: string | null | undefined,
): string {
  const mime = normalizeMime(value);
  return isAcceptableCloudflareMaterialMime(kind, mime) && mime && !mime.includes('octet-stream')
    ? mime
    : fallbackCloudflareMaterialMime(kind);
}

function parseRemoteMediaUrl(value: string): URL | null {
  try {
    return assertSafeOutboundUrl(value, { allowedProtocols: ['https:'] });
  } catch {
    return null;
  }
}

function retryableRemoteStatus(status: number): boolean {
  return status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function putCloudflareMaterialBytes(
  bucket: MagineMediaR2Bucket,
  nodeId: string,
  kind: CloudflareMaterialKind,
  value: ArrayBuffer | Uint8Array,
  sourceMime?: string,
): Promise<CloudflareMaterialWriteResult> {
  const key = cloudflareMaterialObjectKey(nodeId, kind);
  const bytes = value instanceof Uint8Array ? value.byteLength : value.byteLength;
  if (!key) return { ok: false, error: 'invalid node id' };
  if (bytes <= 0 || bytes > MAX_REMOTE_MEDIA_BYTES) {
    return { ok: false, error: 'media is empty or too large' };
  }
  if (!isAcceptableCloudflareMaterialMime(kind, sourceMime)) {
    return { ok: false, error: `unexpected media type: ${sourceMime || 'unknown'}` };
  }

  const mime = resolvedCloudflareMaterialMime(kind, sourceMime);
  await bucket.put(key, value, {
    httpMetadata: {
      contentType: mime,
      contentDisposition: 'inline',
      cacheControl: 'private, max-age=300',
    },
    customMetadata: {
      kind,
      savedAt: new Date().toISOString(),
    },
  });
  const stored = await bucket.head(key);
  return stored && stored.size > 0
    ? { ok: true, bytes: stored.size, mime }
    : { ok: false, error: 'R2 verification failed' };
}

export async function putCloudflareMaterialFromUrl(
  bucket: MagineMediaR2Bucket,
  nodeId: string,
  kind: CloudflareMaterialKind,
  sourceUrl: string,
  outboundOptions: OutboundRequestOptions = {},
): Promise<CloudflareMaterialWriteResult> {
  const key = cloudflareMaterialObjectKey(nodeId, kind);
  const parsed = parseRemoteMediaUrl(sourceUrl);
  if (!key) return { ok: false, error: 'invalid node id' };
  if (!parsed) return { ok: false, error: 'invalid or unsafe media URL' };

  let lastError = 'remote media is not ready';
  for (let attempt = 0; attempt < REMOTE_FETCH_DELAYS_MS.length; attempt += 1) {
    const delayMs = REMOTE_FETCH_DELAYS_MS[attempt];
    if (delayMs > 0) await wait(delayMs);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetchSafeOutboundUrl(parsed, {
        signal: controller.signal,
        headers: {
          Accept: kind === 'video' ? 'video/*,*/*;q=0.8' : kind === 'audio' ? 'audio/*,*/*;q=0.8' : 'image/*,*/*;q=0.8',
          'User-Agent': 'MagineCanvas/0.2 CloudMediaCache',
        },
      }, { ...outboundOptions, allowedProtocols: ['https:'] });
      if (!response.ok || !response.body) {
        lastError = `upstream HTTP ${response.status}`;
        if (!retryableRemoteStatus(response.status)) break;
        continue;
      }

      const contentLength = Number(response.headers.get('content-length') || 0);
      if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_MEDIA_BYTES) {
        return { ok: false, error: 'remote media is too large' };
      }

      const sourceMime = response.headers.get('content-type');
      if (!isAcceptableCloudflareMaterialMime(kind, sourceMime)) {
        lastError = `unexpected upstream media type: ${sourceMime || 'unknown'}`;
        continue;
      }

      const mime = resolvedCloudflareMaterialMime(kind, sourceMime);
      await bucket.put(key, response.body, {
        httpMetadata: {
          contentType: mime,
          contentDisposition: 'inline',
          cacheControl: 'private, max-age=300',
        },
        customMetadata: {
          kind,
          savedAt: new Date().toISOString(),
          sourceHost: parsed.hostname.slice(0, 120),
        },
      });
      const stored = await bucket.head(key);
      if (stored && stored.size > 0) {
        return { ok: true, bytes: stored.size, mime };
      }
      lastError = 'R2 verification failed';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, error: lastError };
}

export function parseCloudflareMediaRange(
  header: string,
  size: number,
): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0) return null;
  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return null;

  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    const length = Math.min(size, Math.floor(suffix));
    return { offset: size - length, length };
  }

  const offset = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (
    !Number.isFinite(offset)
    || !Number.isFinite(requestedEnd)
    || offset < 0
    || requestedEnd < offset
    || offset >= size
  ) {
    return null;
  }
  const end = Math.min(size - 1, Math.floor(requestedEnd));
  return { offset: Math.floor(offset), length: end - Math.floor(offset) + 1 };
}

export async function deleteCloudflareMaterialNode(
  bucket: MagineMediaR2Bucket,
  nodeId: string,
): Promise<void> {
  const prefix = cloudflareMaterialNodePrefix(nodeId);
  if (!prefix) return;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    const keys = page.objects.map((object) => object.key);
    if (keys.length > 0) await bucket.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
