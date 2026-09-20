import { NextRequest, NextResponse } from 'next/server';
import {
  createAliyunVideoenhanClient,
  superResolveVideoJob,
  type SuperResolveVideoInput,
} from '@/lib/aliyun-video-super-resolve.server';
import { loadVideoForAliyun, resolveAliyunCredentials } from '@/lib/aliyun-media-input.server';
import { formatAliyunApiError } from '@/lib/aliyun-api-error';
import {
  DEFAULT_VIDEOENHAN_HOST,
  sanitizeViapiEnhanEndpoint,
} from '@/lib/aliyun-viapi-endpoint';

export const maxDuration = 900;

const DEFAULT_ENDPOINT = DEFAULT_VIDEOENHAN_HOST;
const DEFAULT_REGION = 'cn-shanghai';

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
    'videoenhan',
    DEFAULT_ENDPOINT
  );
  const regionId = (typeof body.regionId === 'string' && body.regionId.trim()) || DEFAULT_REGION;

  let bitRate = Number(body.bitRate);
  if (!Number.isFinite(bitRate)) bitRate = 5;
  bitRate = Math.min(20, Math.max(1, Math.round(bitRate)));

  const loaded = await loadVideoForAliyun(body, req);
  if (loaded instanceof NextResponse) return loaded;

  const input: SuperResolveVideoInput =
    loaded.kind === 'url' ? { kind: 'url', videoUrl: loaded.url } : { kind: 'buffer', buffer: loaded.buffer };

  try {
    const client = createAliyunVideoenhanClient({
      accessKeyId: creds.ak,
      accessKeySecret: creds.sk,
      endpoint,
      regionId,
    });
    const outputUrl = await superResolveVideoJob({
      client,
      input,
      bitRate,
    });
    return NextResponse.json({ outputUrl, progress: 100 });
  } catch (e) {
    const msg = formatAliyunApiError(e);
    console.error('[POST /api/aliyun/super-resolve-video]', e);
    return NextResponse.json({ error: msg.slice(0, 800) }, { status: 502 });
  }
}
