import type { NextApiRequest, NextApiResponse } from 'next';
import { execDreaminaCli } from '@/lib/dreamina-cli-exec';
import {
  appendDreaminaCliTrace,
  cleanupDreaminaTempFiles,
  materializeDreaminaImageInputs,
  parseDreaminaCliStdout,
  prepareDreaminaCliRoute,
  respondDreaminaCliExecError,
} from '@/lib/dreamina-cli-route.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

interface Multiframe2VideoBody {
  cliPath?: string;
  prompt?: string;
  images?: string[];
  duration?: number;
  poll?: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!(await preparePagesApiJsonBody(req, res, 128 * 1024 * 1024))) return;

  const body = req.body as Multiframe2VideoBody;
  const { cliPath } = await prepareDreaminaCliRoute(body);
  const rawImages = Array.isArray(body.images) ? body.images.filter((value) => value?.trim()) : [];
  if (rawImages.length < 2) {
    return res.status(400).json({ ok: false, error: '智能多帧至少需要 2 张图片素材' });
  }

  const imageInputs = await materializeDreaminaImageInputs(rawImages.slice(0, 20));
  const tempFiles = imageInputs.tempFiles;
  const args = ['multiframe2video', '--images', imageInputs.values.join(',')];

  const prompt = body.prompt?.trim() || '生成连贯的视频过渡';
  if (imageInputs.values.length === 2) {
    args.push('--prompt', prompt);
    if (body.duration != null) args.push('--duration', String(body.duration));
  } else {
    for (let i = 0; i < imageInputs.values.length - 1; i += 1) {
      args.push('--transition-prompt', prompt);
    }
  }
  args.push('--poll', String(body.poll ?? 0));

  try {
    const startedAt = Date.now();
    const { stdout, stderr } = await execDreaminaCli(cliPath, args, {
      timeout: 600000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const data = parseDreaminaCliStdout(stdout, stderr, { expectation: 'video-generation' });
    await appendDreaminaCliTrace('server-success', {
      route: 'dreamina/multiframe2video',
      cliPath,
      cmd: `${cliPath} ${args.join(' ')}`,
      args,
      body: body as unknown as Record<string, unknown>,
      stdout,
      stderr,
      data,
      elapsedMs: Date.now() - startedAt,
    });
    return res.json({ ok: true, data });
  } catch (e) {
    await respondDreaminaCliExecError(res, e, `${cliPath} ${args.join(' ')}`, {
      route: 'dreamina/multiframe2video',
      cliPath,
      args,
      body: body as unknown as Record<string, unknown>,
    });
  } finally {
    await cleanupDreaminaTempFiles(tempFiles);
  }
}

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};
