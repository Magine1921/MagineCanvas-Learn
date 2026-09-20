import type { NextApiRequest, NextApiResponse } from 'next';
import { execDreaminaCli } from '@/lib/dreamina-cli-exec';
import { normalizeDreaminaCliImageResolution } from '@/lib/dreamina-cli-options';
import {
  appendDreaminaCliTrace,
  parseDreaminaCliStdout,
  prepareDreaminaCliRoute,
  respondDreaminaCliExecError,
} from '@/lib/dreamina-cli-route.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

interface Text2ImageBody {
  cliPath?: string;
  prompt: string;
  ratio?: string;
  resolution_type?: string;
  model_version?: string;
  quality?: string;
  style?: string;
  negative_prompt?: string;
  num_images?: number;
  poll?: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!(await preparePagesApiJsonBody(req, res))) return;

  const body = req.body as Text2ImageBody;
  const { cliPath } = await prepareDreaminaCliRoute(body);

  if (!body.prompt?.trim()) {
    return res.status(400).json({ ok: false, error: '缺少 prompt 参数' });
  }

  const modelVersion = body.model_version || '5.0';
  const args = [
    'text2image',
    '--prompt',
    body.prompt.trim(),
    '--ratio',
    body.ratio || '16:9',
    '--resolution_type',
    normalizeDreaminaCliImageResolution(modelVersion, body.resolution_type),
  ];

  if (body.model_version) args.push('--model_version', body.model_version);
  if (body.quality) args.push('--quality', body.quality);
  if (body.style) args.push('--style', body.style);
  if (body.negative_prompt) args.push('--negative_prompt', body.negative_prompt);
  if (body.num_images != null) args.push('--num_images', String(body.num_images));
  args.push('--poll', String(body.poll ?? 0));

  const cmd = `${cliPath} ${args.join(' ')}`;

  try {
    const startedAt = Date.now();
    const { stdout, stderr } = await execDreaminaCli(cliPath, args, {
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const data = parseDreaminaCliStdout(stdout, stderr, { expectation: 'image-generation' });
    await appendDreaminaCliTrace('server-success', {
      route: 'dreamina/text2image',
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
      route: 'dreamina/text2image',
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
