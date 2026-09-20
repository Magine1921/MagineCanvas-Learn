import type { NextApiRequest, NextApiResponse } from 'next';
import {
  deleteAllPanoramaDiskCache,
  deletePanoramaDiskCache,
  deletePanoramaDiskCacheExcept,
  readPanoramaTexFromDiskCache,
  savePanoramaTexToDiskCache,
} from '@/lib/project-panorama-disk-cache.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId : '';
    const data = await readPanoramaTexFromDiskCache(nodeId);
    if (!data) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Content-Type', data.mime);
    res.status(200).send(data.buffer);
    return;
  }

  if (req.method === 'POST') {
    if (!(await preparePagesApiJsonBody(req, res, 32 * 1024 * 1024))) return;
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as {
      action?: string;
      nodeId?: string;
      dataUrl?: string;
      imageUrl?: string;
      keepNodeIds?: string[];
    };
    if (body.action === 'gc' && Array.isArray(body.keepNodeIds)) {
      const keep = new Set(body.keepNodeIds.filter((x) => typeof x === 'string'));
      await deletePanoramaDiskCacheExcept(keep);
      res.status(200).json({ ok: true });
      return;
    }
    const nodeId = typeof body.nodeId === 'string' ? body.nodeId : '';
    const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
    const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
    const source = dataUrl.trim() || imageUrl.trim();
    if (!source) {
      res.status(400).json({ ok: false, error: 'dataUrl or imageUrl required' });
      return;
    }
    const ok = await savePanoramaTexToDiskCache(nodeId, source);
    if (!ok) {
      res.status(400).json({ ok: false, error: 'save failed' });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === 'DELETE') {
    const purge = typeof req.query.purge === 'string' ? req.query.purge : '';
    if (purge === 'all') {
      await deleteAllPanoramaDiskCache();
      res.status(200).json({ ok: true });
      return;
    }
    const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId : '';
    await deletePanoramaDiskCache(nodeId);
    res.status(200).json({ ok: true });
    return;
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  res.status(405).end();
}
