import { NextRequest, NextResponse } from 'next/server';
import * as $dara from '@darabonba/typescript';
import { GetAsyncJobResultRequest } from '@alicloud/videoenhan20200320';
import { MakeSuperResolutionImageRequest } from '@alicloud/imageenhan20190930';
import { createAliyunVideoenhanClient } from '@/lib/aliyun-video-super-resolve.server';
import {
  createAliyunImageenhanClient,
  DEFAULT_IMAGEENHAN_ENDPOINT,
  DEFAULT_IMAGEENHAN_REGION,
} from '@/lib/aliyun-image-super-resolve.server';
import { sanitizeViapiEnhanEndpoint } from '@/lib/aliyun-viapi-endpoint';

const DEFAULT_VIDEO_ENDPOINT = 'videoenhan.cn-shanghai.aliyuncs.com';
const DEFAULT_VIDEO_REGION = 'cn-shanghai';

function classifyVerifyError(e: unknown): NextResponse {
  const err = e as { code?: string; message?: string; data?: { Message?: string; Code?: string } };
  const code = err?.code || err?.data?.Code || '';
  const msg = err?.message || err?.data?.Message || String(e);
  if (
    String(code).includes('InvalidAccessKeyId') ||
    String(msg).includes('InvalidAccessKeyId') ||
    String(msg).includes('SignatureDoesNotMatch') ||
    String(msg).includes('not found') ||
    String(msg).includes('403')
  ) {
    return NextResponse.json({ ok: false, message: `AccessKey 无效或未授权：${msg}` }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    message: `已连通阿里云接口（探测返回：${String(msg).slice(0, 200)}）`,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: '请求体须为 JSON' }, { status: 400 });
  }

  const ak =
    (typeof body.accessKeyId === 'string' && body.accessKeyId.trim()) ||
    process.env.ALIBABA_CLOUD_ACCESS_KEY_ID ||
    '';
  const sk =
    (typeof body.accessKeySecret === 'string' && body.accessKeySecret.trim()) ||
    process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET ||
    '';
  if (!ak || !sk) {
    return NextResponse.json(
      {
        ok: false,
        message: '缺少 AccessKey：请填写或配置 ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET',
      },
      { status: 400 }
    );
  }

  const product = body.product === 'image' ? 'image' : 'video';
  const regionId =
    (typeof body.regionId === 'string' && body.regionId.trim()) ||
    (product === 'image' ? DEFAULT_IMAGEENHAN_REGION : DEFAULT_VIDEO_REGION);

  try {
    const runtime = new $dara.RuntimeOptions({});
    if (product === 'image') {
      const endpoint = sanitizeViapiEnhanEndpoint(
        typeof body.endpoint === 'string' ? body.endpoint : undefined,
        'imageenhan',
        DEFAULT_IMAGEENHAN_ENDPOINT
      );
      const client = createAliyunImageenhanClient({
        accessKeyId: ak,
        accessKeySecret: sk,
        endpoint,
        regionId,
      });
      await client.makeSuperResolutionImageWithOptions(
        new MakeSuperResolutionImageRequest({
          url: 'http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imageenhan/MakeSuperResolutionImage/MakeSuperResolutionImage1.png',
          mode: 'base',
          upscaleFactor: 2,
        }),
        runtime
      );
      return NextResponse.json({ ok: true, message: '凭证可用（已连通 imageenhan MakeSuperResolutionImage）' });
    }

    const endpoint = sanitizeViapiEnhanEndpoint(
      typeof body.endpoint === 'string' ? body.endpoint : undefined,
      'videoenhan',
      DEFAULT_VIDEO_ENDPOINT
    );
    const client = createAliyunVideoenhanClient({
      accessKeyId: ak,
      accessKeySecret: sk,
      endpoint,
      regionId,
    });
    await client.getAsyncJobResultWithOptions(
      new GetAsyncJobResultRequest({ jobId: '00000000-0000-0000-0000-000000000001' }),
      runtime
    );
    return NextResponse.json({ ok: true, message: '凭证可用（已连通 videoenhan GetAsyncJobResult）' });
  } catch (e: unknown) {
    return classifyVerifyError(e);
  }
}
