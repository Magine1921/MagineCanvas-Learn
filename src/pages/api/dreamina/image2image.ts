import type { NextApiRequest, NextApiResponse } from 'next';
import { execDreaminaCli } from '@/lib/dreamina-cli-exec';
import { normalizeDreaminaCliImageResolution } from '@/lib/dreamina-cli-options';
import {
  appendDreaminaCliTrace,
  cleanupDreaminaTempFiles,
  materializeDreaminaImageInputs,
  parseDreaminaCliStdout,
  prepareDreaminaCliRoute,
  respondDreaminaCliExecError,
} from '@/lib/dreamina-cli-route.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

interface Image2ImageBody {
  cliPath?: string;
  prompt: string;
  images: string[];
  ratio?: string;
  resolution_type?: string;
  model_version?: string;
  style?: string;
  poll?: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!(await preparePagesApiJsonBody(req, res, 64 * 1024 * 1024))) return;

  const body = req.body as Image2ImageBody;
  const { cliPath } = await prepareDreaminaCliRoute(body);

  if (!body.prompt?.trim()) {
    return res.status(400).json({ ok: false, error: '缺少 prompt 参数' });
  }
  if (!body.images?.length) {
    return res.status(400).json({ ok: false, error: '缺少 images 参数' });
  }

  const modelVersion = body.model_version || '5.0';
  const { values: images, tempFiles } = await materializeDreaminaImageInputs(body.images);
  const args = [
    'image2image',
    '--images',
    ...images,
    '--prompt',
    body.prompt.trim(),
    '--ratio',
    body.ratio || '16:9',
    '--resolution_type',
    normalizeDreaminaCliImageResolution(modelVersion, body.resolution_type),
  ];

  if (body.model_version) args.push('--model_version', body.model_version);
  if (body.style) args.push('--style', body.style);
  args.push('--poll', String(body.poll ?? 0));

  const cmd = `${cliPath} ${args.join(' ')}`;

  try {
    const startedAt = Date.now();
    const { stdout, stderr } = await execDreaminaCli(cliPath, args, {
      timeout: 240000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const data = parseDreaminaCliStdout(stdout, stderr, { expectation: 'image-generation' });
    await appendDreaminaCliTrace('server-success', {
      route: 'dreamina/image2image',
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
    await respondDreaminaCliExecError(res, e, cmd, {
      route: 'dreamina/image2image',
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
