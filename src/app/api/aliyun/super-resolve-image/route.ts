import { NextRequest, NextResponse } from 'next/server';
import {
  createAliyunImageenhanClient,
  DEFAULT_IMAGEENHAN_ENDPOINT,
  DEFAULT_IMAGEENHAN_REGION,
  superResolveImageJob,
  type SuperResolveImageInput,
} from '@/lib/aliyun-image-super-resolve.server';
import { loadImageForAliyun, resolveAliyunCredentials } from '@/lib/aliyun-media-input.server';
import { formatAliyunApiError } from '@/lib/aliyun-api-error';
import { sanitizeViapiEnhanEndpoint } from '@/lib/aliyun-viapi-endpoint';

export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '请求体须为 JSON' }, { status: 400 });
  }

  const creds = resolveAliyunCredentials(body);
  if (creds instanceof NextResponse) return creds;

  const endpoint = sanitizeViapiEnhanEndpoint(
    typeof body.endpoint === 'string' ? body.endpoint : undefined,
    'imageenhan',
    DEFAULT_IMAGEENHAN_ENDPOINT
  );
  const regionId =
    (typeof body.regionId === 'string' && body.regionId.trim()) || DEFAULT_IMAGEENHAN_REGION;

  const mode = typeof body.mode === 'string' && body.mode.trim() ? body.mode.trim() : 'base';
  let upscaleFactor = Number(body.upscaleFactor);
  if (!Number.isFinite(upscaleFactor)) upscaleFactor = 2;
  upscaleFactor = Math.min(4, Math.max(1, Math.round(upscaleFactor)));

  const loaded = await loadImageForAliyun(body, req);
  if (loaded instanceof NextResponse) return loaded;

  const input: SuperResolveImageInput =
    loaded.kind === 'url' ? { kind: 'url', imageUrl: loaded.url } : { kind: 'buffer', buffer: loaded.buffer };

  try {
    const client = createAliyunImageenhanClient({
      accessKeyId: creds.ak,
      accessKeySecret: creds.sk,
      endpoint,
      regionId,
    });
    const outputUrl = await superResolveImageJob({
      client,
      input,
      mode,
      upscaleFactor,
    });
    return NextResponse.json({ outputUrl, progress: 100 });
  } catch (e) {
    const msg = formatAliyunApiError(e);
    console.error('[POST /api/aliyun/super-resolve-image]', e);
    return NextResponse.json({ error: msg.slice(0, 800) }, { status: 502 });
  }
}
