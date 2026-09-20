import { isMaterialDiskRef, materialDiskRefToNodeId } from '@/lib/material-disk-playable-url';
import {
  readMaterialFromDiskCache,
  readVideoFromDiskCache,
} from '@/lib/project-material-disk-cache.server';
import { readPanoramaTexFromDiskCache } from '@/lib/project-panorama-disk-cache.server';
import { isPanoramaDiskRef, panoramaDiskRefToNodeId } from '@/lib/sync-panorama-project-disk-cache';
import { isSameSiteUrlLoose } from '@/lib/topaz-same-site-url';
import {
  assertSafeOutboundUrl,
  fetchSafeOutboundUrl,
  parseServerHostAllowlist,
} from '@/lib/server-outbound-request';
import sharp from 'sharp';

export type KieTopazMediaKind = 'image' | 'video';

const DEFAULT_KIE_API_BASE = 'https://api.kie.ai';
const KIE_UPLOAD_BASE = 'https://kieai.redpandaai.co';
const KIE_UPLOAD_URL_HOSTS = new Set(['kieai.redpandaai.co', 'tempfile.redpandaai.co']);
const TOPAZ_MODEL_BY_KIND: Record<KieTopazMediaKind, string> = {
  image: 'topaz/image-upscale',
  video: 'topaz/video-upscale',
};
const KIE_IMAGE_UPSCALE_FACTORS = [1, 2, 4, 8] as const;
const KIE_VIDEO_UPSCALE_FACTORS = [1, 2, 4] as const;
const KIE_BASE64_UPLOAD_RECOMMENDED_BYTES = 1024 * 1024;
const TOPAZ_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const TOPAZ_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const TOPAZ_RELIABLE_IMAGE_INPUT_LONG_EDGE = 2048;
const TOPAZ_RELIABLE_IMAGE_OUTPUT_LONG_EDGE = 4096;
const TOPAZ_RELIABLE_IMAGE_OUTPUT_PIXELS = 18_000_000;
const TOPAZ_FETCH_TIMEOUT_MS = {
  credit: 15_000,
  downloadUrl: 15_000,
  uploadedProbe: 6_000,
  uploadBase64: 45_000,
  uploadStream: 60_000,
  uploadUrl: 45_000,
  inputFetch: 30_000,
  createTask: 20_000,
  recordInfo: 15_000,
} as const;

type JsonRecord = Record<string, unknown>;

export type KieMaterializedInput = {
  url: string;
  alternateUrls: string[];
  width?: number;
  height?: number;
  byteLength?: number;
  contentType?: string;
  localBytes?: Uint8Array;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function bearerHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey.trim()}` };
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error || 'unknown error');
  const cause = error.cause;
  if (cause && typeof cause === 'object') {
    const c = cause as Record<string, unknown>;
    const details = [
      typeof c.code === 'string' ? c.code : '',
      typeof c.errno === 'string' || typeof c.errno === 'number' ? `errno=${c.errno}` : '',
      typeof c.hostname === 'string' ? `host=${c.hostname}` : '',
      typeof c.address === 'string' ? `address=${c.address}` : '',
      typeof c.port === 'number' ? `port=${c.port}` : '',
    ].filter(Boolean);
    if (details.length) return `${error.message} (${details.join(', ')})`;
  }
  return error.message;
}

async function fetchWithTopazTimeout(
  input: string | URL,
  init: RequestInit,
  label: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    const carriesCredentials = headers.has('authorization');
    return await fetchSafeOutboundUrl(input, { ...init, signal: controller.signal }, {
      allowedProtocols: ['http:', 'https:'],
      isAllowedUrl: carriesCredentials
        ? (url) => kieServiceAllowedHosts().has(url.hostname.toLowerCase())
        : undefined,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new Error(`${label} failed: ${describeError(err)}`);
  } finally {
    clearTimeout(timeout);
  }
}

function messageFrom(raw: unknown, fallback: string): string {
  const root = asRecord(raw);
  const data = asRecord(root.data);
  const parts = [
    asString(data.failMsg),
    asString(data.fail_msg),
    asString(data.errorMessage),
    asString(data.error_message),
    asString(data.message),
    asString(data.error),
    asString(root.error),
    asString(root.message),
    asString(root.msg),
  ].filter(Boolean);
  const message = parts.find((part) => part.toLowerCase() !== 'success');
  return message || fallback;
}

async function readJsonResponse(response: Response, fallback: string): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    if (!response.ok) throw new Error(`${fallback}: HTTP ${response.status}`);
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${fallback}: non-JSON response ${response.status} ${text.slice(0, 220)}`);
  }
}

function assertKieSuccess(response: Response, raw: unknown, fallback: string): void {
  const root = asRecord(raw);
  const code = asNumber(root.code);
  const success = root.success === true;
  if (response.ok && (success || code === 200 || code === undefined)) return;
  throw new Error(messageFrom(raw, `${fallback}: HTTP ${response.status}`));
}

export function normalizeKieApiBase(apiUrl?: string): string {
  const raw = String(apiUrl || '').trim();
  if (!raw) return DEFAULT_KIE_API_BASE;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return assertSafeOutboundUrl(withProtocol, {
    allowedProtocols: ['https:'],
    isAllowedUrl: (url) => kieServiceAllowedHosts().has(url.hostname.toLowerCase()),
  }).toString().replace(/\/+$/, '');
}

function kieServiceAllowedHosts(): Set<string> {
  return new Set([
    'api.kie.ai',
    ...KIE_UPLOAD_URL_HOSTS,
    ...parseServerHostAllowlist(process.env.KIE_API_ALLOWED_HOSTS),
  ]);
}

export function normalizeKieUpscaleFactor(value: unknown, kind: KieTopazMediaKind = 'image'): 1 | 2 | 4 | 8 {
  const n = asNumber(value);
  const allowed: readonly number[] = kind === 'video' ? KIE_VIDEO_UPSCALE_FACTORS : KIE_IMAGE_UPSCALE_FACTORS;
  if (n != null && allowed.includes(n)) return n as 1 | 2 | 4 | 8;
  if (kind === 'image' && n != null && n >= 6) return 8;
  if (n != null && n >= 3) return 4;
  if (n != null && n < 1.5) return 1;
  return 2;
}

export async function getKieCredits(opts: { apiKey: string; apiUrl?: string }): Promise<number> {
  const base = normalizeKieApiBase(opts.apiUrl);
  const response = await fetchWithTopazTimeout(
    `${base}/api/v1/chat/credit`,
    {
      method: 'GET',
      headers: bearerHeaders(opts.apiKey),
      cache: 'no-store',
    },
    'Topaz credit query',
    TOPAZ_FETCH_TIMEOUT_MS.credit,
  );
  const raw = await readJsonResponse(response, 'Topaz credit query failed');
  assertKieSuccess(response, raw, 'Topaz credit query failed');
  const credits = asNumber(asRecord(raw).data);
  if (credits == null) throw new Error('Topaz credit response missing data');
  return credits;
}

export async function getKieDownloadUrl(opts: {
  apiKey: string;
  apiUrl?: string;
  url: string;
}): Promise<string> {
  const base = normalizeKieApiBase(opts.apiUrl);
  const response = await fetchWithTopazTimeout(
    `${base}/api/v1/common/download-url`,
    {
      method: 'POST',
      headers: { ...bearerHeaders(opts.apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: opts.url }),
    },
    'Topaz download-url',
    TOPAZ_FETCH_TIMEOUT_MS.downloadUrl,
  );
  const raw = await readJsonResponse(response, 'Topaz download-url failed');
  assertKieSuccess(response, raw, 'Topaz download-url failed');
  const downloadUrl = asString(asRecord(raw).data);
  if (!downloadUrl) throw new Error('Topaz download-url response missing data');
  return downloadUrl;
}

function inferExtFromContentType(contentType: string, kind: KieTopazMediaKind): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('quicktime')) return 'mov';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('mp4')) return 'mp4';
  return kind === 'video' ? 'mp4' : 'png';
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = /^data:([^;,]*)(;base64)?,([\s\S]+)$/i.exec(dataUrl);
  if (!m || !m[2]) throw new Error('Topaz data URL must be base64 encoded');
  const contentType = m[1] || 'application/octet-stream';
  const raw = m[3].replace(/\s+/g, '');
  return { bytes: new Uint8Array(Buffer.from(raw, 'base64')), contentType };
}

function buildUploadFileName(kind: KieTopazMediaKind, ext: string): string {
  const suffix = Math.random().toString(36).slice(2, 9);
  return `magine-topaz-${kind}-${Date.now()}-${suffix}.${ext.replace(/^\./, '') || (kind === 'video' ? 'mp4' : 'png')}`;
}

function uploadPathFor(kind: KieTopazMediaKind): string {
  return `magine-canvas/topaz/${kind}s`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isKieUploadUrl(url: URL): boolean {
  return KIE_UPLOAD_URL_HOSTS.has(url.hostname.toLowerCase());
}

function extractUploadedUrls(raw: unknown): string[] {
  const root = asRecord(raw);
  const data = asRecord(root.data);
  const urls = uniqueStrings([
    asString(data.downloadUrl) ||
      asString(data.download_url) ||
      asString(data.url),
    asString(data.fileUrl) || asString(data.file_url),
    asString(root.downloadUrl) ||
      asString(root.download_url) ||
      asString(root.url),
    asString(root.fileUrl) || asString(root.file_url),
  ]);
  if (urls.length === 0) throw new Error('Topaz upload response missing fileUrl/downloadUrl');
  return urls;
}

function assertTopazUploadSize(kind: KieTopazMediaKind, byteLength: number): void {
  const max = kind === 'video' ? TOPAZ_VIDEO_MAX_BYTES : TOPAZ_IMAGE_MAX_BYTES;
  if (byteLength <= max) return;
  const mb = (byteLength / 1024 / 1024).toFixed(1);
  const maxMb = Math.round(max / 1024 / 1024);
  throw new Error(`Topaz ${kind} input is too large: ${mb}MB, maximum ${maxMb}MB`);
}

async function normalizeImageUploadForTopaz(bytes: Uint8Array): Promise<{
  bytes: Uint8Array;
  contentType: string;
  width?: number;
  height?: number;
}> {
  const input = Buffer.from(bytes);
  const image = sharp(input, { failOn: 'none', limitInputPixels: false }).rotate();
  const metadata = await image.metadata();
  const sourceWidth = metadata.width || 0;
  const sourceHeight = metadata.height || 0;
  const longEdge = Math.max(sourceWidth, sourceHeight);
  const normalizedImage =
    longEdge > TOPAZ_RELIABLE_IMAGE_INPUT_LONG_EDGE
      ? image
          .clone()
          .resize({
            width: sourceWidth >= sourceHeight ? TOPAZ_RELIABLE_IMAGE_INPUT_LONG_EDGE : undefined,
            height: sourceHeight > sourceWidth ? TOPAZ_RELIABLE_IMAGE_INPUT_LONG_EDGE : undefined,
            fit: 'inside',
            withoutEnlargement: true,
          })
      : image.clone();

  if (metadata.hasAlpha) {
    const png = await normalizedImage
      .clone()
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer({ resolveWithObject: true });
    if (png.data.byteLength <= TOPAZ_IMAGE_MAX_BYTES) {
      return {
        bytes: new Uint8Array(png.data),
        contentType: 'image/png',
        width: png.info.width,
        height: png.info.height,
      };
    }
  }

  for (const quality of [94, 90, 84, 76, 68]) {
    const jpeg = await normalizedImage
      .clone()
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality, progressive: false, mozjpeg: false })
      .toBuffer({ resolveWithObject: true });
    if (jpeg.data.byteLength <= TOPAZ_IMAGE_MAX_BYTES) {
      return {
        bytes: new Uint8Array(jpeg.data),
        contentType: 'image/jpeg',
        width: jpeg.info.width,
        height: jpeg.info.height,
      };
    }
  }

  assertTopazUploadSize('image', input.byteLength);
  throw new Error('Topaz image input cannot be compressed below 10MB');
}

async function resolveFetchableUploadedUrl(url: string, kind: KieTopazMediaKind): Promise<string> {
  let lastError = '';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetchWithTopazTimeout(
        url,
        {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
          redirect: 'follow',
          cache: 'no-store',
        },
        'Topaz uploaded URL check',
        TOPAZ_FETCH_TIMEOUT_MS.uploadedProbe,
      );
      if (response.ok || response.status === 206) {
        await response.body?.cancel().catch(() => undefined);
        return url;
      }
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await delay(Math.min(3200, 350 * 2 ** attempt));
  }
  throw new Error(`Topaz uploaded ${kind} URL is not fetchable: ${lastError || 'unknown error'}`);
}

async function resolveFetchableUploadedUrls(urls: string[], kind: KieTopazMediaKind): Promise<string[]> {
  const resolved: string[] = [];
  let lastError = '';
  for (const url of uniqueStrings(urls)) {
    try {
      resolved.push(await resolveFetchableUploadedUrl(url, kind));
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (resolved.length === 0) {
    throw new Error(`Topaz uploaded ${kind} URL is not fetchable: ${lastError || 'unknown error'}`);
  }
  return resolved;
}

async function uploadDataUrlToKie(opts: {
  apiKey: string;
  dataUrl: string;
  kind: KieTopazMediaKind;
}): Promise<KieMaterializedInput> {
  const decoded = decodeDataUrl(opts.dataUrl);
  return uploadBufferToKie({
    apiKey: opts.apiKey,
    bytes: decoded.bytes,
    contentType: decoded.contentType,
    kind: opts.kind,
  });
}

async function uploadBytesWithBase64ToKie(opts: {
  apiKey: string;
  bytes: Uint8Array;
  contentType: string;
  kind: KieTopazMediaKind;
  fileName: string;
}): Promise<string[]> {
  const response = await fetchWithTopazTimeout(
    `${KIE_UPLOAD_BASE}/api/file-base64-upload`,
    {
      method: 'POST',
      headers: { ...bearerHeaders(opts.apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base64Data: `data:${opts.contentType};base64,${Buffer.from(opts.bytes).toString('base64')}`,
        uploadPath: uploadPathFor(opts.kind),
        fileName: opts.fileName,
      }),
    },
    'Topaz base64 upload',
    TOPAZ_FETCH_TIMEOUT_MS.uploadBase64,
  );
  const raw = await readJsonResponse(response, 'Topaz base64 upload failed');
  assertKieSuccess(response, raw, 'Topaz base64 upload failed');
  return extractUploadedUrls(raw);
}

async function uploadBytesWithStreamToKie(opts: {
  apiKey: string;
  bytes: Uint8Array;
  contentType: string;
  kind: KieTopazMediaKind;
  fileName: string;
}): Promise<string[]> {
  const form = new FormData();
  const arrayBuffer = new ArrayBuffer(opts.bytes.byteLength);
  new Uint8Array(arrayBuffer).set(opts.bytes);
  const blob = new Blob([arrayBuffer], {
    type: opts.contentType || (opts.kind === 'video' ? 'video/mp4' : 'image/jpeg'),
  });
  form.append('file', blob, opts.fileName);
  form.append('uploadPath', uploadPathFor(opts.kind));
  form.append('fileName', opts.fileName);

  const response = await fetchWithTopazTimeout(
    `${KIE_UPLOAD_BASE}/api/file-stream-upload`,
    {
      method: 'POST',
      headers: bearerHeaders(opts.apiKey),
      body: form,
    },
    'Topaz file upload',
    TOPAZ_FETCH_TIMEOUT_MS.uploadStream,
  );
  const raw = await readJsonResponse(response, 'Topaz file upload failed');
  assertKieSuccess(response, raw, 'Topaz file upload failed');
  return extractUploadedUrls(raw);
}

async function uploadRemoteUrlToKie(opts: {
  apiKey: string;
  url: URL;
  kind: KieTopazMediaKind;
}): Promise<KieMaterializedInput> {
  const pathExt = opts.url.pathname.split('/').pop()?.split('.').pop() || '';
  const ext = inferExtFromContentType(pathExt ? `image/${pathExt}` : '', opts.kind);
  const response = await fetchWithTopazTimeout(
    `${KIE_UPLOAD_BASE}/api/file-url-upload`,
    {
      method: 'POST',
      headers: { ...bearerHeaders(opts.apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileUrl: opts.url.toString(),
        uploadPath: uploadPathFor(opts.kind),
        fileName: buildUploadFileName(opts.kind, ext),
      }),
    },
    'Topaz URL upload',
    TOPAZ_FETCH_TIMEOUT_MS.uploadUrl,
  );
  const raw = await readJsonResponse(response, 'Topaz URL upload failed');
  assertKieSuccess(response, raw, 'Topaz URL upload failed');
  const urls = await resolveFetchableUploadedUrls(extractUploadedUrls(raw), opts.kind);
  return {
    url: urls[0],
    alternateUrls: urls.slice(1),
  };
}

async function uploadBufferToKie(opts: {
  apiKey: string;
  bytes: Uint8Array;
  contentType: string;
  kind: KieTopazMediaKind;
}): Promise<KieMaterializedInput> {
  const normalized =
    opts.kind === 'image'
      ? await normalizeImageUploadForTopaz(opts.bytes)
      : { bytes: opts.bytes, contentType: opts.contentType || 'video/mp4' };
  assertTopazUploadSize(opts.kind, normalized.bytes.byteLength);

  const ext = inferExtFromContentType(normalized.contentType, opts.kind);
  const fileName = buildUploadFileName(opts.kind, ext);
  let uploadedUrls: string[] = [];
  try {
    uploadedUrls =
      opts.kind === 'image' && normalized.bytes.byteLength <= KIE_BASE64_UPLOAD_RECOMMENDED_BYTES
        ? await uploadBytesWithBase64ToKie({
            apiKey: opts.apiKey,
            bytes: normalized.bytes,
            contentType: normalized.contentType,
            kind: opts.kind,
            fileName,
          })
        : await uploadBytesWithStreamToKie({
            apiKey: opts.apiKey,
            bytes: normalized.bytes,
            contentType: normalized.contentType,
            kind: opts.kind,
            fileName,
          });
  } catch (primaryError) {
    const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
    if (opts.kind !== 'image' || normalized.bytes.byteLength > KIE_BASE64_UPLOAD_RECOMMENDED_BYTES) {
      throw new Error(`Topaz file upload failed: ${primaryMessage}`);
    }
    try {
      uploadedUrls = await uploadBytesWithStreamToKie({
        apiKey: opts.apiKey,
        bytes: normalized.bytes,
        contentType: normalized.contentType,
        kind: opts.kind,
        fileName,
      });
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`Topaz file upload failed: ${primaryMessage}; ${fallbackMessage}`);
    }
  }

  if (uploadedUrls.length === 0) {
    throw new Error('Topaz file upload failed: response contained no usable URL');
  }

  const urls = await resolveFetchableUploadedUrls(uploadedUrls, opts.kind);
  return {
    url: urls[0],
    alternateUrls: urls.slice(1),
    width: opts.kind === 'image' ? normalized.width : undefined,
    height: opts.kind === 'image' ? normalized.height : undefined,
    byteLength: normalized.bytes.byteLength,
    contentType: normalized.contentType,
    localBytes: opts.kind === 'image' ? normalized.bytes : undefined,
  };
}

async function fetchAndUploadUrl(opts: {
  apiKey: string;
  url: URL;
  kind: KieTopazMediaKind;
}): Promise<KieMaterializedInput> {
  if (opts.url.pathname === '/api/topaz/enhance') {
    throw new Error('Topaz input URL points to the enhance endpoint itself');
  }
  if (opts.url.pathname !== '/api/project-cache/material' && opts.url.pathname !== '/api/project-cache/panorama') {
    throw new Error('Topaz local input URL is not an allowed project-cache endpoint');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOPAZ_FETCH_TIMEOUT_MS.inputFetch);
  let response: Response;
  try {
    response = await fetch(opts.url, {
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`Topaz input fetch failed: HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || (opts.kind === 'video' ? 'video/mp4' : 'image/png');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength <= 0) throw new Error('Topaz input fetch returned empty file');
  return uploadBufferToKie({ apiKey: opts.apiKey, bytes, contentType, kind: opts.kind });
}

async function materializeHttpInput(opts: {
  apiKey: string;
  url: URL;
  kind: KieTopazMediaKind;
  requestUrl: URL;
}): Promise<KieMaterializedInput> {
  if (isKieUploadUrl(opts.url)) {
    return { url: opts.url.toString(), alternateUrls: [] };
  }
  if (isSameSiteUrlLoose(opts.requestUrl, opts.url)) {
    return fetchAndUploadUrl({ apiKey: opts.apiKey, url: opts.url, kind: opts.kind });
  }
  return {
    url: opts.url.toString(),
    alternateUrls: [],
  };
}

async function readMaterialCacheInput(
  nodeId: string,
  kind: KieTopazMediaKind,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const data = kind === 'video' ? await readVideoFromDiskCache(nodeId) : await readMaterialFromDiskCache(nodeId);
  if (data) return { bytes: data.buffer, contentType: data.mime };
  if (kind === 'image') {
    const videoFallback = await readVideoFromDiskCache(nodeId);
    if (videoFallback) return { bytes: videoFallback.buffer, contentType: videoFallback.mime };
  }
  return null;
}

async function readProjectCacheUrlInput(
  url: URL,
  kind: KieTopazMediaKind,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (url.pathname === '/api/project-cache/material') {
    const nodeId = url.searchParams.get('nodeId') || '';
    const requestedKind = url.searchParams.get('kind') === 'video' ? 'video' : kind;
    return readMaterialCacheInput(nodeId, requestedKind);
  }
  if (url.pathname === '/api/project-cache/panorama') {
    const nodeId = url.searchParams.get('nodeId') || '';
    const data = await readPanoramaTexFromDiskCache(nodeId);
    return data ? { bytes: data.buffer, contentType: data.mime } : null;
  }
  return null;
}

async function uploadLocalProjectCacheInput(opts: {
  apiKey: string;
  inputUrl: string;
  kind: KieTopazMediaKind;
  requestUrl: URL;
}): Promise<KieMaterializedInput | null> {
  let data: { bytes: Uint8Array; contentType: string } | null = null;
  let recognizedCacheInput = false;
  if (isMaterialDiskRef(opts.inputUrl)) {
    recognizedCacheInput = true;
    data = await readMaterialCacheInput(materialDiskRefToNodeId(opts.inputUrl), opts.kind);
  } else if (isPanoramaDiskRef(opts.inputUrl)) {
    recognizedCacheInput = true;
    const panorama = await readPanoramaTexFromDiskCache(panoramaDiskRefToNodeId(opts.inputUrl));
    data = panorama ? { bytes: panorama.buffer, contentType: panorama.mime } : null;
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(opts.inputUrl, opts.requestUrl);
    } catch {
      parsed = null;
    }
    if (
      parsed &&
      (parsed.pathname === '/api/project-cache/material' || parsed.pathname === '/api/project-cache/panorama')
    ) {
      recognizedCacheInput = true;
      data = await readProjectCacheUrlInput(parsed, opts.kind);
    }
  }

  if (!data) {
    if (recognizedCacheInput) throw new Error('Topaz input cache file was not found');
    return null;
  }
  if (data.bytes.byteLength <= 0) throw new Error('Topaz input cache file is empty');
  return uploadBufferToKie({
    apiKey: opts.apiKey,
    bytes: data.bytes,
    contentType: data.contentType,
    kind: opts.kind,
  });
}

export async function materializeKieInput(opts: {
  apiKey: string;
  inputUrl: string;
  kind: KieTopazMediaKind;
  requestUrl: string;
}): Promise<KieMaterializedInput> {
  const input = opts.inputUrl.trim();
  if (!input) throw new Error('Topaz input url is empty');
  if (input.startsWith('data:')) {
    return uploadDataUrlToKie({ apiKey: opts.apiKey, dataUrl: input, kind: opts.kind });
  }

  const requestUrl = new URL(opts.requestUrl);
  const localProjectCacheUpload = await uploadLocalProjectCacheInput({
    apiKey: opts.apiKey,
    inputUrl: input,
    kind: opts.kind,
    requestUrl,
  });
  if (localProjectCacheUpload) {
    return localProjectCacheUpload;
  }

  let parsed: URL;
  try {
    parsed = new URL(input, requestUrl);
  } catch {
    throw new Error('Topaz input url is not supported');
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return materializeHttpInput({ apiKey: opts.apiKey, url: parsed, kind: opts.kind, requestUrl });
  }

  throw new Error('Topaz only supports http(s), data URL, and project-cache inputs');
}

export async function materializeKieInputUrl(opts: {
  apiKey: string;
  inputUrl: string;
  kind: KieTopazMediaKind;
  requestUrl: string;
}): Promise<string> {
  return (await materializeKieInput(opts)).url;
}

export function resolveKieTopazRequestedFactors(
  value: unknown,
  kind: KieTopazMediaKind,
  input?: Pick<KieMaterializedInput, 'width' | 'height'>,
): Array<1 | 2 | 4 | 8> {
  const requested = normalizeKieUpscaleFactor(value, kind);
  const allowed =
    kind === 'video'
      ? KIE_VIDEO_UPSCALE_FACTORS
      : KIE_IMAGE_UPSCALE_FACTORS.filter((factor) => factor > 1);
  const width = input?.width || 0;
  const height = input?.height || 0;

  const factors = allowed
    .filter((factor) => factor <= requested)
    .filter((factor) => {
      if (kind !== 'image' || !width || !height) return true;
      const longEdge = Math.max(width, height) * factor;
      const pixels = width * height * factor * factor;
      return longEdge <= TOPAZ_RELIABLE_IMAGE_OUTPUT_LONG_EDGE && pixels <= TOPAZ_RELIABLE_IMAGE_OUTPUT_PIXELS;
    })
    .sort((a, b) => b - a);

  return (factors.length > 0 ? factors : [2]) as Array<1 | 2 | 4 | 8>;
}

export async function createKieTopazTask(opts: {
  apiKey: string;
  apiUrl?: string;
  kind: KieTopazMediaKind;
  inputUrl: string;
  upscaleFactor: unknown;
}): Promise<{ taskId: string; raw: unknown }> {
  const base = normalizeKieApiBase(opts.apiUrl);
  const mediaKey = opts.kind === 'video' ? 'video_url' : 'image_url';
  const input: Record<string, unknown> = {
    [mediaKey]: opts.inputUrl,
    upscale_factor: String(normalizeKieUpscaleFactor(opts.upscaleFactor, opts.kind)),
  };
  const response = await fetchWithTopazTimeout(
    `${base}/api/v1/jobs/createTask`,
    {
      method: 'POST',
      headers: { ...bearerHeaders(opts.apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TOPAZ_MODEL_BY_KIND[opts.kind],
        input,
      }),
    },
    'Topaz createTask',
    TOPAZ_FETCH_TIMEOUT_MS.createTask,
  );
  const raw = await readJsonResponse(response, 'Topaz createTask failed');
  assertKieSuccess(response, raw, 'Topaz createTask failed');
  const taskId = asString(asRecord(asRecord(raw).data).taskId) || asString(asRecord(raw).taskId);
  if (!taskId) throw new Error('Topaz createTask response missing taskId');
  return { taskId, raw };
}

export async function queryKieTask(opts: {
  apiKey: string;
  apiUrl?: string;
  taskId: string;
}): Promise<unknown> {
  const base = normalizeKieApiBase(opts.apiUrl);
  const url = `${base}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(opts.taskId)}`;
  const response = await fetchWithTopazTimeout(
    url,
    {
      method: 'GET',
      headers: bearerHeaders(opts.apiKey),
      cache: 'no-store',
    },
    'Topaz recordInfo',
    TOPAZ_FETCH_TIMEOUT_MS.recordInfo,
  );
  const raw = await readJsonResponse(response, 'Topaz recordInfo failed');
  const root = asRecord(raw);
  const code = asNumber(root.code);
  const record = asRecord(root.data);
  if (!response.ok || (code != null && code !== 200 && !taskState(record))) {
    throw new Error(messageFrom(raw, `Topaz recordInfo failed: HTTP ${response.status}`));
  }
  return raw;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
}

function firstUrlInValue(value: unknown, seen = new WeakSet<object>()): string {
  if (typeof value === 'string') return /^https?:\/\//i.test(value.trim()) ? value.trim() : '';
  if (!value || typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const u = firstUrlInValue(item, seen);
      if (u) return u;
    }
    return '';
  }
  const obj = asRecord(value);
  const direct =
    asString(obj.url) ||
    asString(obj.outputUrl) ||
    asString(obj.output_url) ||
    asString(obj.imageUrl) ||
    asString(obj.image_url) ||
    asString(obj.videoUrl) ||
    asString(obj.video_url) ||
    asString(obj.downloadUrl) ||
    asString(obj.download_url);
  if (direct) return direct;
  for (const key of ['resultUrls', 'result_urls', 'urls', 'files', 'images', 'videos', 'outputs', 'data']) {
    if (!(key in obj)) continue;
    const u = firstUrlInValue(obj[key], seen);
    if (u) return u;
  }
  return '';
}

function extractTaskRecord(raw: unknown): JsonRecord {
  const root = asRecord(raw);
  return asRecord(root.data);
}

function extractResultUrl(record: JsonRecord): string {
  const resultJson = parseMaybeJson(record.resultJson);
  const fromResultJson = firstUrlInValue(resultJson);
  if (fromResultJson) return fromResultJson;

  for (const key of ['resultUrls', 'result_urls', 'result', 'output', 'outputs', 'data']) {
    const u = firstUrlInValue(parseMaybeJson(record[key]));
    if (u) return u;
  }
  return (
    asString(record.outputUrl) ||
    asString(record.resultUrl) ||
    asString(record.imageUrl) ||
    asString(record.videoUrl) ||
    asString(record.downloadUrl) ||
    asString(record.url)
  );
}

function taskState(record: JsonRecord): string {
  return (
    asString(record.state) ||
    asString(record.status) ||
    asString(record.taskStatus) ||
    asString(record.task_status)
  ).toLowerCase();
}

function taskFailureMessage(raw: unknown, record: JsonRecord): string {
  const taskId = asString(record.taskId) || asString(record.task_id) || asString(record.id);
  const code =
    asString(record.failCode) ||
    asString(record.fail_code) ||
    asString(record.errorCode) ||
    asString(record.error_code) ||
    asString(record.code);
  const message = messageFrom({ data: record }, 'Topaz task failed');
  const state = taskState(record) || 'failed';
  const details = [
    `state=${state}`,
    taskId ? `taskId=${taskId}` : '',
    code ? `code=${code}` : '',
  ].filter(Boolean);
  return details.length ? `${message} (${details.join(', ')})` : message;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /fetch failed|network|socket|terminated|ECONN|ETIMEDOUT|UND_ERR/i.test(message);
}

export async function pollKieTopazTask(opts: {
  apiKey: string;
  apiUrl?: string;
  taskId: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<{
  outputUrl: string;
  raw: unknown;
  record: JsonRecord;
  creditsConsumed?: number;
  progress?: number;
}> {
  const timeoutMs = opts.timeoutMs ?? 20 * 60 * 1000;
  const startedAt = Date.now();
  let intervalMs = opts.intervalMs ?? 2500;
  let lastRaw: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastRaw = await queryKieTask(opts);
    } catch (error) {
      if (!isTransientFetchError(error)) throw error;
      await delay(intervalMs);
      intervalMs = Math.min(8000, Math.round(intervalMs * 1.18));
      continue;
    }
    const record = extractTaskRecord(lastRaw);
    const state = taskState(record);
    const outputUrl = extractResultUrl(record);
    const progress = asNumber(record.progress);

    if (outputUrl && (!state || ['success', 'succeeded', 'completed', 'complete', 'done'].includes(state))) {
      return {
        outputUrl,
        raw: lastRaw,
        record,
        creditsConsumed: asNumber(record.creditsConsumed),
        progress,
      };
    }

    if (['success', 'succeeded', 'completed', 'complete', 'done'].includes(state)) {
      throw new Error('Topaz task completed but no result URL was returned');
    }

    if (['fail', 'failed', 'error', 'cancelled', 'canceled'].includes(state)) {
      throw new Error(taskFailureMessage(lastRaw, record));
    }

    await delay(intervalMs);
    intervalMs = Math.min(8000, Math.round(intervalMs * 1.18));
  }

  throw new Error(`Topaz task timed out: ${opts.taskId}`);
}
