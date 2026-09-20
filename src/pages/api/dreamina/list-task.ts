import type { NextApiRequest, NextApiResponse } from 'next';
import { execDreaminaCli } from '@/lib/dreamina-cli-exec';
import {
  appendDreaminaCliTrace,
  parseDreaminaCliStdout,
  prepareDreaminaCliRoute,
  respondDreaminaCliExecError,
} from '@/lib/dreamina-cli-route.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

interface ListTaskBody {
  cliPath?: string;
  gen_status?: string;
  submit_id?: string;
  limit?: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (req.method === 'POST' && !(await preparePagesApiJsonBody(req, res))) return;

  const body = (req.method === 'POST' ? req.body : req.query) as ListTaskBody;
  const { cliPath } = await prepareDreaminaCliRoute(body);
  const args = ['list_task'];

  if (body.gen_status) args.push('--gen_status', body.gen_status);
  if (body.submit_id) args.push('--submit_id', body.submit_id);
  if (body.limit != null) args.push('--limit', String(body.limit));

  const cmd = `${cliPath} ${args.join(' ')}`;

  try {
    const startedAt = Date.now();
    const { stdout, stderr } = await execDreaminaCli(cliPath, args, {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (!stdout.trim() && stderr.trim()) {
      await appendDreaminaCliTrace('server-success', {
        route: 'dreamina/list-task',
        cliPath,
        cmd,
        args,
        body: body as unknown as Record<string, unknown>,
        stdout,
        stderr,
        data: { tasks: [], message: stderr.trim() },
        elapsedMs: Date.now() - startedAt,
      });
      return res.json({ ok: true, tasks: [], message: stderr.trim() });
    }

    const data = parseDreaminaCliStdout(stdout, stderr);
    await appendDreaminaCliTrace('server-success', {
      route: 'dreamina/list-task',
      cliPath,
      cmd,
      args,
      body: body as unknown as Record<string, unknown>,
      stdout,
      stderr,
      data,
      elapsedMs: Date.now() - startedAt,
    });
    return res.json({
      ok: true,
      data,
      tasks: Array.isArray(data) ? data : Array.isArray(data.tasks) ? data.tasks : [],
    });
  } catch (e) {
    await respondDreaminaCliExecError(res, e, cmd, {
      route: 'dreamina/list-task',
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
