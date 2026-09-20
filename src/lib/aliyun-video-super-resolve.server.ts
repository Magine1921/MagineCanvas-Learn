import { Readable } from 'node:stream';
import * as $dara from '@darabonba/typescript';
import Client from '@alicloud/videoenhan20200320';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import {
  GetAsyncJobResultRequest,
  SuperResolveVideoAdvanceRequest,
  SuperResolveVideoRequest,
} from '@alicloud/videoenhan20200320';
import {
  DEFAULT_VIDEOENHAN_HOST,
  sanitizeViapiEnhanEndpoint,
} from '@/lib/aliyun-viapi-endpoint';

const DEFAULT_ENDPOINT = DEFAULT_VIDEOENHAN_HOST;
const DEFAULT_REGION = 'cn-shanghai';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseResultVideoUrl(raw: string): string {
  const o = JSON.parse(raw) as Record<string, unknown>;
  const u =
    (typeof o.VideoUrl === 'string' && o.VideoUrl.trim()) ||
    (typeof o.videoUrl === 'string' && o.videoUrl.trim()) ||
    '';
  if (!u) throw new Error('阿里云异步结果中未找到视频 URL');
  return u;
}

export type AliyunVideoenhanClientOpts = {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint?: string;
  regionId?: string;
};

export function createAliyunVideoenhanClient(opts: AliyunVideoenhanClientOpts): Client {
  const id = opts.accessKeyId.trim();
  const sec = opts.accessKeySecret.trim();
  if (!id || !sec) throw new Error('缺少阿里云 AccessKey');
  const endpoint = sanitizeViapiEnhanEndpoint(opts.endpoint, 'videoenhan', DEFAULT_ENDPOINT);
  const regionId = (opts.regionId || DEFAULT_REGION).trim() || DEFAULT_REGION;
  const cfg = new $OpenApiUtil.Config({
    accessKeyId: id,
    accessKeySecret: sec,
    endpoint,
    regionId,
  });
  return new Client(cfg);
}

async function pollAsyncJob(
  client: Client,
  jobId: string,
  opts: { maxWaitMs: number; intervalMs: number }
): Promise<string> {
  const runtime = new $dara.RuntimeOptions({});
  const deadline = Date.now() + opts.maxWaitMs;
  while (Date.now() < deadline) {
    const resp = await client.getAsyncJobResultWithOptions(
      new GetAsyncJobResultRequest({ jobId }),
      runtime
    );
    const data = resp.body?.data;
    const st = typeof data?.status === 'string' ? data.status.trim() : '';
    if (st === 'PROCESS_SUCCESS') {
      const raw = typeof data?.result === 'string' ? data.result.trim() : '';
      if (!raw) throw new Error('阿里云任务成功但结果为空');
      return parseResultVideoUrl(raw);
    }
    if (st === 'PROCESS_FAILED') {
      const code = data?.errorCode || '';
      const msg = data?.errorMessage || '';
      throw new Error(`阿里云处理失败${code ? ` (${String(code)})` : ''}: ${msg || '未知错误'}`);
    }
    await sleep(opts.intervalMs);
  }
  throw new Error('等待阿里云视频超分辨结果超时，请稍后重试或缩短视频时长');
}

export type SuperResolveVideoInput = { kind: 'url'; videoUrl: string } | { kind: 'buffer'; buffer: Buffer };

/**
 * 调用 `SuperResolveVideo` + `GetAsyncJobResult` 轮询，返回结果视频 URL（临时 OSS 带签链）。
 */
export async function superResolveVideoJob(opts: {
  client: Client;
  input: SuperResolveVideoInput;
  bitRate: number;
  poll?: { maxWaitMs: number; intervalMs: number };
}): Promise<string> {
  const runtime = new $dara.RuntimeOptions({});
  const poll = opts.poll ?? { maxWaitMs: 28 * 60_000, intervalMs: 2500 };

  if (opts.input.kind === 'url') {
    const submit = await opts.client.superResolveVideoWithOptions(
      new SuperResolveVideoRequest({
        videoUrl: opts.input.videoUrl,
        bitRate: opts.bitRate,
      }),
      runtime
    );
    const immediate = submit.body?.data?.videoUrl?.trim();
    if (immediate) return immediate;
    const jobId = submit.body?.requestId?.trim();
    if (!jobId) throw new Error('阿里云未返回异步任务 RequestId');
    return pollAsyncJob(opts.client, jobId, poll);
  }

  const stream = Readable.from(opts.input.buffer);
  const submit = await opts.client.superResolveVideoAdvance(
    new SuperResolveVideoAdvanceRequest({
      videoUrlObject: stream,
      bitRate: opts.bitRate,
    }),
    runtime
  );
  const immediate = submit.body?.data?.videoUrl?.trim();
  if (immediate) return immediate;
  const jobId = submit.body?.requestId?.trim();
  if (!jobId) throw new Error('阿里云未返回异步任务 RequestId');
  return pollAsyncJob(opts.client, jobId, poll);
}
