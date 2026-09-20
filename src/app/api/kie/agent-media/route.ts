import { NextRequest, NextResponse } from 'next/server';
import type { LlmMediaInput, LlmMediaKind } from '@/lib/llm-media-input';
import { fetchSafeOutboundUrl } from '@/lib/server-outbound-request';

export const runtime = 'nodejs';
export const maxDuration = 180;

const KIE_UPLOAD_ENDPOINT = 'https://kieai.redpandaai.co/api/file-stream-upload';
const MAX_MEDIA_ITEMS = 12;
const MAX_ITEM_BYTES: Record<LlmMediaKind, number> = {
  image: 12 * 1024 * 1024,
  audio: 30 * 1024 * 1024,
  video: 45 * 1024 * 1024,
  document: 15 * 1024 * 1024,
};

function isMediaKind(value: unknown): value is LlmMediaKind {
  return value === 'image' || value === 'audio' || value === 'video' || value === 'document';
}

function safeFileName(name: string | undefined, kind: LlmMediaKind, mimeType: string): string {
  const fallbackExt = kind === 'image' ? 'png' : kind === 'audio' ? 'mp3' : kind === 'video' ? 'mp4' : 'pdf';
  const mimeExt = mimeType.split('/')[1]?.replace(/^x-/, '').replace('quicktime', 'mov').replace('mpeg', kind === 'audio' ? 'mp3' : 'mpg');
  const raw = (name || `${kind}.${mimeExt || fallbackExt}`).replace(/[^a-zA-Z0-9._-]+/g, '_');
  const withExt = raw.includes('.') ? raw : `${raw}.${mimeExt || fallbackExt}`;
  return `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${withExt}`.slice(-160);
}

function parseDataUrl(value: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(value.trim());
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  return { bytes: new Uint8Array(buffer), mimeType: match[1] || 'application/octet-stream' };
}

function extractUploadedUrl(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const root = payload as Record<string, unknown>;
  const candidates: unknown[] = [root, root.data, root.result];
  if (root.data && typeof root.data === 'object') {
    const data = root.data as Record<string, unknown>;
    candidates.push(data.data, data.result, data.file);
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate;
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    for (const key of ['downloadUrl', 'fileUrl', 'url']) {
      const value = record[key];
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
    }
  }
  return '';
}

function getKieFailureDetail(payload: unknown, raw: string): string {
  const records: Record<string, unknown>[] = [];
  if (payload && typeof payload === 'object') {
    const root = payload as Record<string, unknown>;
    records.push(root);
    if (root.data && typeof root.data === 'object') records.push(root.data as Record<string, unknown>);
    if (root.error && typeof root.error === 'object') records.push(root.error as Record<string, unknown>);
  }

  let code = '';
  let message = '';
  for (const record of records) {
    if (!code && record.code != null) code = String(record.code);
    for (const key of ['msg', 'message', 'error', 'detail']) {
      const value = record[key];
      if (!message && typeof value === 'string' && value.trim()) message = value.trim();
    }
  }

  const rawFallback = raw.trim().replace(/\s+/g, ' ').slice(0, 300);
  return [code ? `业务码 ${code}` : '', message || rawFallback].filter(Boolean).join('：');
}

function isLoopbackHost(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost' || value === '127.0.0.1' || value === '::1';
}

function isPublicRemoteUrl(req: NextRequest, value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin !== new URL(req.url).origin && !isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

async function readLocalMedia(req: NextRequest, media: LlmMediaInput): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const inline = parseDataUrl(media.url);
  if (inline) return inline;

  const sourceUrl = new URL(media.url, req.url);
  if (sourceUrl.origin !== new URL(req.url).origin) {
    throw new Error(`媒体“${media.name || media.kind}”不是可读取的本地素材`);
  }
  if (sourceUrl.pathname !== '/api/project-cache/material' && sourceUrl.pathname !== '/api/project-cache/panorama') {
    throw new Error(`媒体“${media.name || media.kind}”使用了不允许的本地接口地址`);
  }
  const response = await fetch(sourceUrl, { cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error(`读取媒体“${media.name || media.kind}”失败（HTTP ${response.status}）`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get('content-type')?.split(';')[0] || media.mimeType || 'application/octet-stream',
  };
}

async function uploadMedia(apiKey: string, media: LlmMediaInput, bytes: Uint8Array, mimeType: string): Promise<string> {
  const limit = MAX_ITEM_BYTES[media.kind];
  if (bytes.byteLength > limit) {
    throw new Error(`媒体“${media.name || media.kind}”超过 ${Math.floor(limit / 1024 / 1024)}MB 限制`);
  }
  const form = new FormData();
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  const fileName = safeFileName(media.name, media.kind, mimeType);
  form.append('file', new Blob([arrayBuffer], { type: mimeType }), fileName);
  form.append('uploadPath', `agent-multimodal/${media.kind}`);
  form.append('fileName', fileName);

  const response = await fetchSafeOutboundUrl(KIE_UPLOAD_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  }, {
    allowedProtocols: ['https:'],
    isAllowedUrl: (url) => url.hostname === 'kieai.redpandaai.co',
  });
  const raw = await response.text();
  let payload: unknown = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }
  const url = extractUploadedUrl(payload);
  if (!response.ok || !url) {
    const detail = getKieFailureDetail(payload, raw);
    console.error('[Kie Agent Upload] failed', {
      httpStatus: response.status,
      detail,
      mediaKind: media.kind,
      mediaName: media.name,
      mediaBytes: bytes.byteLength,
    });
    throw new Error(
      `Kie 上传“${media.name || media.kind}”失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`
    );
  }
  return url;
}

async function handleMultipartPost(req: NextRequest): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: '无法读取上传的素材文件' }, { status: 400 });
  }

  const apiKey = String(form.get('apiKey') || '').trim();
  const kindValue = String(form.get('kind') || '');
  const file = form.get('file');
  if (!apiKey) return NextResponse.json({ ok: false, error: '缺少 Kie API Key' }, { status: 400 });
  if (!isMediaKind(kindValue) || !(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: '上传素材的类型或文件无效' }, { status: 400 });
  }

  const uploadFile = file as Blob & { name?: string };
  const name = String(form.get('name') || uploadFile.name || kindValue);
  const mimeType = String(form.get('mimeType') || file.type || 'application/octet-stream');
  const media: LlmMediaInput = { kind: kindValue, url: '', name, mimeType };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const url = await uploadMedia(apiKey, media, bytes, mimeType);
    return NextResponse.json({ ok: true, media: [{ ...media, url }] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if ((req.headers.get('content-type') || '').toLowerCase().includes('multipart/form-data')) {
    return handleMultipartPost(req);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: '请求体必须是 JSON' }, { status: 400 });
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const rawMedia = Array.isArray(body.media) ? body.media.slice(0, MAX_MEDIA_ITEMS) : [];
  if (!apiKey) return NextResponse.json({ ok: false, error: '缺少 Kie API Key' }, { status: 400 });

  const media = rawMedia.filter((item): item is LlmMediaInput => {
    if (!item || typeof item !== 'object') return false;
    const value = item as Record<string, unknown>;
    return isMediaKind(value.kind) && typeof value.url === 'string' && value.url.trim().length > 0;
  });
  if (!media.length) return NextResponse.json({ ok: false, error: '没有可上传的多模态媒体' }, { status: 400 });

  try {
    const result: LlmMediaInput[] = [];
    for (const item of media) {
      const url = item.url.trim();
      if (/^https?:\/\//i.test(url) && isPublicRemoteUrl(req, url)) {
        result.push({ ...item, url });
        continue;
      }
      const loaded = await readLocalMedia(req, item);
      result.push({
        ...item,
        url: await uploadMedia(apiKey, item, loaded.bytes, loaded.mimeType),
        mimeType: loaded.mimeType,
      });
    }
    return NextResponse.json({ ok: true, media: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
