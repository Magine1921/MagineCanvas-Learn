import type { NextApiRequest, NextApiResponse } from 'next';
import { normalizeDreaminaCliVideoResolution } from '@/lib/dreamina-cli-options';
import { execDreaminaCli } from '@/lib/dreamina-cli-exec';
import {
  appendDreaminaCliTrace,
  cleanupDreaminaTempFiles,
  materializeDreaminaMediaInputs,
  parseDreaminaCliStdout,
  prepareDreaminaCliRoute,
  respondDreaminaCliExecError,
} from '@/lib/dreamina-cli-route.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

interface Multimodal2VideoBody {
  cliPath?: string;
  prompt?: string;
  image?: string;
  images?: string[];
  video?: string;
  videos?: string[];
  audio?: string;
  audios?: string[];
  ratio?: string;
  duration?: number;
  model_version?: string;
  video_resolution?: string;
  poll?: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!(await preparePagesApiJsonBody(req, res, 128 * 1024 * 1024))) return;

  const body = req.body as Multimodal2VideoBody;
  const rawImages = body.images?.length ? body.images : body.image ? [body.image] : [];
  const rawVideos = body.videos?.length ? body.videos : body.video ? [body.video] : [];
  const rawAudios = body.audios?.length ? body.audios : body.audio ? [body.audio] : [];

  if (rawImages.length === 0 && rawVideos.length === 0) {
    return res.status(400).json({ ok: false, error: '缺少图片或视频参考素材' });
  }

  let cliPath = body.cliPath?.trim() || 'dreamina';
  let args: string[] = [];
  const tempFiles: string[] = [];

  try {
    ({ cliPath } = await prepareDreaminaCliRoute(body));
    const imageInputs = await materializeDreaminaMediaInputs(rawImages.slice(0, 9), 'image');
    tempFiles.push(...imageInputs.tempFiles);
    const videoInputs = await materializeDreaminaMediaInputs(rawVideos.slice(0, 3), 'video');
    tempFiles.push(...videoInputs.tempFiles);
    const audioInputs = await materializeDreaminaMediaInputs(rawAudios.slice(0, 3), 'audio');
    tempFiles.push(...audioInputs.tempFiles);

    args = [
      'multimodal2video',
      '--ratio',
      body.ratio || '16:9',
      '--duration',
      String(body.duration || 5),
    ];

    if (body.prompt?.trim()) args.push('--prompt', body.prompt.trim());
    for (const image of imageInputs.values) args.push('--image', image);
    for (const video of videoInputs.values) args.push('--video', video);
    for (const audio of audioInputs.values) args.push('--audio', audio);
    if (body.model_version) args.push('--model_version', body.model_version);
    if (body.video_resolution) {
      args.push(
        '--video_resolution',
        normalizeDreaminaCliVideoResolution(body.model_version || 'seedance2.0fast', body.video_resolution),
      );
    }
    args.push('--poll', String(body.poll ?? 0));

    const startedAt = Date.now();
    const { stdout, stderr } = await execDreaminaCli(cliPath, args, {
      timeout: 600000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const data = parseDreaminaCliStdout(stdout, stderr, { expectation: 'video-generation' });
    await appendDreaminaCliTrace('server-success', {
      route: 'dreamina/multimodal2video',
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
      route: 'dreamina/multimodal2video',
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
