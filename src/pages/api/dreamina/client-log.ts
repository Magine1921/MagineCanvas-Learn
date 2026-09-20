import type { NextApiRequest, NextApiResponse } from 'next';
import { appendDreaminaCliTrace } from '@/lib/dreamina-cli-route.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!(await preparePagesApiJsonBody(req, res, 2 * 1024 * 1024))) return;

  try {
    await appendDreaminaCliTrace('client-event', {
      route: 'dreamina/client-log',
      body: req.body as Record<string, unknown>,
    });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
