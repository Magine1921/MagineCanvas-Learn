// 即梦CLI - 文生视频
import type { NextApiRequest, NextApiResponse } from 'next';
import { execDreaminaCli } from '@/lib/dreamina-cli-exec';
import { normalizeDreaminaCliVideoResolution } from '@/lib/dreamina-cli-options';
import {
  appendDreaminaCliTrace,
  parseDreaminaCliStdout,
  prepareDreaminaCliRoute,
  respondDreaminaCliExecError,
} from '@/lib/dreamina-cli-route.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

interface Text2VideoBody {
  cliPath?: string;
  prompt: string;
  ratio?: string;
  duration?: number;
  model_version?: string;
  resolution?: string;
  negative_prompt?: string;
  poll?: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!(await preparePagesApiJsonBody(req, res))) return;

  const body = req.body as Text2VideoBody;
  const { cliPath } = await prepareDreaminaCliRoute(body);

  if (!body.prompt?.trim()) {
    return res.status(400).json({ ok: false, error: '缺少 prompt 参数' });
  }

  const modelVersion = body.model_version || 'seedance2.0fast';
  const args = [
    'text2video',
    '--prompt', body.prompt.trim(),
    '--ratio', body.ratio || '16:9',
    '--duration', String(body.duration || 5),
    '--model_version', modelVersion,
    '--video_resolution', normalizeDreaminaCliVideoResolution(modelVersion, body.resolution),
  ];

  if (body.negative_prompt) args.push('--negative_prompt', body.negative_prompt);
  args.push('--poll', String(body.poll ?? 0));

  const cmd = `${cliPath} ${args.join(' ')}`;

  try {
    const startedAt = Date.now();
    const { stdout, stderr } = await execDreaminaCli(cliPath, args, {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const data = parseDreaminaCliStdout(stdout, stderr, { expectation: 'video-generation' });
    await appendDreaminaCliTrace('server-success', {
      route: 'dreamina/text2video',
      cliPath,
      cmd,
      args,
      body: body as unknown as Record<string, unknown>,
      stdout,
      stderr,
      data,
      elapsedMs: Date.now() - startedAt,
    });
    return res.json({ ok: true, data });
  } catch (e) {
    console.error(`[dreamina] ✗ text2video 失败`, e);
    await respondDreaminaCliExecError(res, e, cmd, {
      route: 'dreamina/text2video',
      cliPath,
      args,
      body: body as unknown as Record<string, unknown>,
    });
  }
}

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};
