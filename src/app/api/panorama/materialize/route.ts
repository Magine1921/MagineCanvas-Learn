import { NextRequest, NextResponse } from 'next/server';
import { isMaterialDiskRef, materialDiskRefToNodeId } from '@/lib/material-disk-playable-url';
import { readMaterialFromDiskCache } from '@/lib/project-material-disk-cache.server';
import { readPanoramaTexFromDiskCache } from '@/lib/project-panorama-disk-cache.server';
import { isPanoramaDiskRef, panoramaDiskRefToNodeId } from '@/lib/sync-panorama-project-disk-cache';
import { fetchSafeOutboundUrl } from '@/lib/server-outbound-request';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 48 * 1024 * 1024;

function dataUrlMime(dataUrl: string): string {
  const semi = dataUrl.indexOf(';');
  const comma = dataUrl.indexOf(',');
  const end = semi > 0 ? semi : comma;
  return end > 5 ? dataUrl.slice(5, end) : 'image/png';
}

function detectImageMime(buffer: Buffer, source = ''): string {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  const path = source.split('?')[0]?.toLowerCase() || '';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

function toDataUrl(buffer: Buffer, mime: string): string {
  return `data:${mime || 'application/octet-stream'};base64,${buffer.toString('base64')}`;
}

async function readKnownProjectImage(
  input: string,
  requestUrl: string,
): Promise<{ buffer: Buffer; mime: string } | null> {
  if (isMaterialDiskRef(input)) {
    return readMaterialFromDiskCache(materialDiskRefToNodeId(input));
  }
  if (isPanoramaDiskRef(input)) {
    return readPanoramaTexFromDiskCache(panoramaDiskRefToNodeId(input));
  }

  let parsed: URL;
  try {
    parsed = new URL(input, requestUrl);
  } catch {
    return null;
  }

  const current = new URL(requestUrl);
  if (parsed.origin !== current.origin) return null;

  if (parsed.pathname === '/api/project-cache/material') {
    const nodeId = parsed.searchParams.get('nodeId') || '';
    return readMaterialFromDiskCache(nodeId);
  }
  if (parsed.pathname === '/api/project-cache/panorama') {
    const nodeId = parsed.searchParams.get('nodeId') || '';
    return readPanoramaTexFromDiskCache(nodeId);
  }
  return null;
}

async function fetchRemoteImage(input: string, requestUrl: string): Promise<{ buffer: Buffer; mime: string }> {
  const url = new URL(input, requestUrl);
  if (!/^https?:$/i.test(url.protocol)) {
    throw new Error('Only http(s), data URL, and project cache images are supported');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetchSafeOutboundUrl(url, { signal: controller.signal }, {
      allowedProtocols: ['http:', 'https:'],
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const headerMime = (response.headers.get('content-type') || '').split(';')[0]?.trim() || '';
    const mime = headerMime || detectImageMime(buffer, url.toString());
    return { buffer, mime };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Request body must be JSON' }, { status: 400 });
  }

  const input = (typeof body.url === 'string' ? body.url : typeof body.inputUrl === 'string' ? body.inputUrl : '')
    .trim();
  if (!input) {
    return NextResponse.json({ ok: false, error: 'Missing image URL' }, { status: 400 });
  }

  if (input.startsWith('data:image/')) {
    return NextResponse.json({ ok: true, dataUrl: input, mime: dataUrlMime(input), source: 'data' });
  }
  if (input.startsWith('asset://')) {
    return NextResponse.json(
      { ok: false, error: 'asset:// is an asset id, not a directly readable image URL' },
      { status: 400 },
    );
  }

  try {
    const local = await readKnownProjectImage(input, req.url);
    const image = local || (await fetchRemoteImage(input, req.url));
    if (image.buffer.length <= 0) {
      return NextResponse.json({ ok: false, error: 'Image is empty' }, { status: 400 });
    }
    if (image.buffer.length > MAX_IMAGE_BYTES) {
      return NextResponse.json({ ok: false, error: 'Image is too large' }, { status: 413 });
    }
    const mime = image.mime.startsWith('image/') ? image.mime : detectImageMime(image.buffer, input);
    if (!mime.startsWith('image/')) {
      return NextResponse.json({ ok: false, error: 'Input is not an image' }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      dataUrl: toDataUrl(image.buffer, mime),
      mime,
      bytes: image.buffer.length,
      source: local ? 'project-cache' : 'remote',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message || 'Image materialize failed' }, { status: 502 });
  }
}
