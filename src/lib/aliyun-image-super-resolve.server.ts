import { Readable } from 'node:stream';
import * as $dara from '@darabonba/typescript';
import Client from '@alicloud/imageenhan20190930';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import {
  MakeSuperResolutionImageAdvanceRequest,
  MakeSuperResolutionImageRequest,
} from '@alicloud/imageenhan20190930';
import {
  DEFAULT_IMAGEENHAN_HOST,
  sanitizeViapiEnhanEndpoint,
} from '@/lib/aliyun-viapi-endpoint';

export const DEFAULT_IMAGEENHAN_ENDPOINT = DEFAULT_IMAGEENHAN_HOST;
export const DEFAULT_IMAGEENHAN_REGION = 'cn-shanghai';

export type AliyunImageenhanClientOpts = {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint?: string;
  regionId?: string;
};

export function createAliyunImageenhanClient(opts: AliyunImageenhanClientOpts): Client {
  const id = opts.accessKeyId.trim();
  const sec = opts.accessKeySecret.trim();
  if (!id || !sec) throw new Error('缺少阿里云 AccessKey');
  const endpoint = sanitizeViapiEnhanEndpoint(opts.endpoint, 'imageenhan', DEFAULT_IMAGEENHAN_ENDPOINT);
  const regionId = (opts.regionId || DEFAULT_IMAGEENHAN_REGION).trim() || DEFAULT_IMAGEENHAN_REGION;
  const cfg = new $OpenApiUtil.Config({
    accessKeyId: id,
    accessKeySecret: sec,
    endpoint,
    regionId,
  });
  return new Client(cfg);
}

export type SuperResolveImageInput = { kind: 'url'; imageUrl: string } | { kind: 'buffer'; buffer: Buffer };

/**
 * 调用 `MakeSuperResolutionImage` / Advance，返回结果图 URL（临时 OSS 带签链）。
 */
export async function superResolveImageJob(opts: {
  client: Client;
  input: SuperResolveImageInput;
  mode: string;
  upscaleFactor: number;
}): Promise<string> {
  const runtime = new $dara.RuntimeOptions({});
  const mode = opts.mode.trim() || 'base';
  const upscaleFactor = Math.min(4, Math.max(1, Math.round(opts.upscaleFactor)));

  let resp;
  if (opts.input.kind === 'url') {
    resp = await opts.client.makeSuperResolutionImageWithOptions(
      new MakeSuperResolutionImageRequest({
        url: opts.input.imageUrl,
        mode,
        upscaleFactor,
      }),
      runtime
    );
  } else {
    const stream = Readable.from(opts.input.buffer);
    resp = await opts.client.makeSuperResolutionImageAdvance(
      new MakeSuperResolutionImageAdvanceRequest({
        urlObject: stream,
        mode,
        upscaleFactor,
      }),
      runtime
    );
  }

  const out = resp.body?.data?.url?.trim();
  if (!out) throw new Error('阿里云响应缺少结果图片 URL');
  return out;
}
