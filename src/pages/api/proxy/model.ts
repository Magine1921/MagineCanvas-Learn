// 模型文件下载代理 — 代理 HuggingFace 等 CDN 的 ONNX 模型文件
// 绕过浏览器 CORS 限制，让 ONNX Runtime Web 能加载模型

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  fetchSafeOutboundUrl,
  parseServerHostAllowlist,
} from '@/lib/server-outbound-request';
import { hasValidDesktopApiToken } from '@/lib/desktop-api-token.server';

const ALLOWED_MODEL_HOSTS = new Set([
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'hf-mirror.com',
]);

function getAllowedOrigins(): Set<string> {
  const env = parseServerHostAllowlist(process.env.MODEL_PROXY_ALLOWED_HOSTS);
  return new Set([...ALLOWED_MODEL_HOSTS, ...env]);
}

const MODEL_CACHE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year — ONNX models are immutable

export const config = {
  api: {
    responseLimit: '32mb',
    externalResolver: true,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const urlParam = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  if (!urlParam) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(urlParam);
    if (targetUrl.protocol !== 'https:') {
      return res.status(400).json({ error: 'Only HTTPS URLs are allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const allowedHosts = getAllowedOrigins();
  const desktopAuthorized = hasValidDesktopApiToken(req.headers);
  if (!desktopAuthorized && !allowedHosts.has(targetUrl.hostname.toLowerCase())) {
    return res.status(403).json({ error: 'Host not in allowed model proxy hosts' });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const response = await fetchSafeOutboundUrl(targetUrl, {
      headers: {
        'User-Agent': 'MagineCanvas/1.0 (model-proxy)',
      },
      signal: controller.signal,
    }, {
      allowedProtocols: ['https:'],
      isAllowedUrl: (url) => desktopAuthorized || allowedHosts.has(url.hostname.toLowerCase()),
    });
    clearTimeout(timer);

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Upstream fetch failed: ${response.status} ${response.statusText}`,
      });
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', `public, max-age=${MODEL_CACHE_MAX_AGE}, immutable`);
    res.setHeader('Content-Length', buffer.byteLength.toString());
    res.send(Buffer.from(buffer));
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const cause =
      error instanceof Error && 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined;
    console.error(`[model-proxy] fetch failed: ${targetUrl.toString()} — ${msg}`, cause ? `cause: ${String(cause)}` : '');
    return res.status(502).json({
      error: 'Model proxy error',
      message: msg,
      url: targetUrl.toString(),
    });
  }
}
