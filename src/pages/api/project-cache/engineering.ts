import type { NextApiRequest, NextApiResponse } from 'next';
import { saveEngineeringProjectSnapshot } from '@/lib/project-engineering-disk-cache.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).end();
    return;
  }
  if (!(await preparePagesApiJsonBody(req, res, 32 * 1024 * 1024))) return;

  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as {
    snapshot?: unknown;
  };
  const snapshot = body.snapshot;
  if (snapshot === undefined || snapshot === null) {
    res.status(400).json({ ok: false, error: 'snapshot required' });
    return;
  }

  let projectId = '';
  if (typeof snapshot === 'object' && snapshot !== null && 'projectId' in snapshot) {
    projectId = typeof (snapshot as { projectId?: unknown }).projectId === 'string'
      ? (snapshot as { projectId: string }).projectId
      : '';
  }

  let json: string;
  try {
    json = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
  } catch {
    res.status(400).json({ ok: false, error: 'snapshot not serializable' });
    return;
  }

  if (!projectId) {
    res.status(400).json({ ok: false, error: 'snapshot.projectId required' });
    return;
  }

  const result = await saveEngineeringProjectSnapshot(projectId, json);
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }

  res.status(200).json({ ok: true });
}
