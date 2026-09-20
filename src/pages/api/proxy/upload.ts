// 文件上传代理 — 专用端点
// 接收 base64 编码的文件数据（JSON），转发为 multipart/form-data 到目标 API
// 支持 MiniMax /v1/files/upload 等需要 multipart 上传的端点

import type { NextApiRequest, NextApiResponse } from 'next';
import { pagesApiBodyErrorStatus, readPagesApiJsonBody } from '@/lib/pages-api-body.server';
import {
  fetchSafeOutboundUrl,
  parseServerHostAllowlist,
} from '@/lib/server-outbound-request';
import { hasValidDesktopApiToken } from '@/lib/desktop-api-token.server';

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Same allowlist as openai proxy
function getAllowedUploadHosts(): Set<string> {
  const envHosts = parseServerHostAllowlist(process.env.OPENAI_PROXY_ALLOWED_HOSTS);
  const defaults = [
    'api.openai.com',
    'api.deepseek.com',
    'api.klingai.com',
    'api-beijing.klingai.com',
    'api.minimaxi.com',
    'api-bj.minimaxi.com',
    'api.hailuoai.com',
    'shiyunapi.com',
  ];
  return new Set([...defaults, ...envHosts]);
}

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const requestBody = await readPagesApiJsonBody<Record<string, unknown>>(req, 100 * 1024 * 1024);
    const targetUrl = getHeaderValue(req.headers['x-target-url']);
    const apiKey = (getHeaderValue(req.headers['x-api-key']) || '').trim();
    const desktopAuthorized = hasValidDesktopApiToken(req.headers);

    if (!targetUrl) return res.status(400).json({ error: 'Missing target URL' });
    if (!apiKey) return res.status(400).json({ error: 'Missing API Key' });

    let parsedTargetUrl: URL;
    try {
      parsedTargetUrl = new URL(targetUrl);
      if (
        parsedTargetUrl.protocol !== 'https:'
        || (!desktopAuthorized && !getAllowedUploadHosts().has(parsedTargetUrl.hostname.toLowerCase()))
      ) {
        return res.status(400).json({ error: 'Invalid or disallowed target URL' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid target URL format' });
    }

    const { fileBase64, fileName, fileType } = requestBody as {
      fileBase64?: string;
      fileName?: string;
      fileType?: string;
    };

    if (!fileBase64) {
      return res.status(400).json({ error: 'Missing fileBase64 — encode the file as base64 and send in JSON body' });
    }

    // Build multipart form with Node.js FormData
    const binaryData = Buffer.from(fileBase64, 'base64');
    const mimeType = fileType || 'audio/mpeg';
    const name = fileName || 'audio.mp3';

    const form = new FormData();
    // Copy non-file fields from req.body
    for (const [key, value] of Object.entries(requestBody)) {
      if (key === 'fileBase64' || key === 'fileName' || key === 'fileType') continue;
      if (typeof value === 'string' || typeof value === 'number') {
        form.append(key, String(value));
      }
    }
    form.append('file', new Blob([binaryData], { type: mimeType }), name);

    console.log(`[upload-proxy] → POST ${parsedTargetUrl} apiKey len=${apiKey.length}`);

    const response = await fetchSafeOutboundUrl(parsedTargetUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: form,
    }, {
      allowedProtocols: ['https:'],
      isAllowedUrl: (url) => desktopAuthorized || getAllowedUploadHosts().has(url.hostname.toLowerCase()),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.log(`[upload-proxy] ← ${response.status} ${responseText.slice(0, 500)}`);
    }

    let data: unknown = responseText;

    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch { /* keep as text */ }

    res.status(response.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (typeof data === 'string') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(data);
    }
    return res.json(data);
  } catch (error) {
    console.error('Upload proxy error:', error);
    return res.status(pagesApiBodyErrorStatus(error) === 500 ? 502 : pagesApiBodyErrorStatus(error)).json({
      error: 'Upload proxy error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
