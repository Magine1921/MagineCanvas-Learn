// 即梦CLI - 图生视频
import type { NextApiRequest, NextApiResponse } from 'next';
import { execDreaminaCli } from '@/lib/dreamina-cli-exec';
import { normalizeDreaminaCliVideoResolution } from '@/lib/dreamina-cli-options';
import {
  appendDreaminaCliTrace,
  cleanupDreaminaTempFiles,
  materializeDreaminaImageInputs,
  parseDreaminaCliStdout,
  prepareDreaminaCliRoute,
  respondDreaminaCliExecError,
} from '@/lib/dreamina-cli-route.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

interface Image2VideoBody {
  cliPath?: string;
  prompt: string;
  image?: string;
  images?: string[];
  ratio?: string;
  duration?: number;
  model_version?: string;
  resolution?: string;
  poll?: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!(await preparePagesApiJsonBody(req, res, 64 * 1024 * 1024))) return;

  const body = req.body as Image2VideoBody;
  const { cliPath } = await prepareDreaminaCliRoute(body);

  if (!body.prompt?.trim()) {
    return res.status(400).json({ ok: false, error: '缺少 prompt 参数' });
  }
  if (!body.image?.trim() && !body.images?.[0]?.trim()) {
    return res.status(400).json({ ok: false, error: '缺少参考图片 (image/images)' });
  }

  const modelVersion = body.model_version || 'seedance2.0fast';
  const rawImages =
    body.images && body.images.length > 0
      ? body.images
      : body.image
        ? [body.image]
        : [];
  const { values: materializedImages, tempFiles } = await materializeDreaminaImageInputs(rawImages);
  const args = [
    'image2video',
    '--prompt', body.prompt.trim(),
    '--duration', String(body.duration || 5),
    '--model_version', modelVersion,
    '--video_resolution', normalizeDreaminaCliVideoResolution(modelVersion, body.resolution),
  ];

  if (materializedImages[0]) {
    args.push('--image', materializedImages[0]);
  }
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
      route: 'dreamina/image2video',
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
    console.error(`[dreamina] ✗ image2video 失败`, e);
    await respondDreaminaCliExecError(res, e, cmd, {
      route: 'dreamina/image2video',
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
