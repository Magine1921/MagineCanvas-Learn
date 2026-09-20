// 火山引擎API代理端点
// 解决CORS问题，将前端请求转发到火山引擎API

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  applyProxyCorsHeaders,
  maybePipeStreamingResponse,
  requestWantsStream,
} from '@/lib/proxy-stream-passthrough.server';
import { pagesApiBodyErrorStatus, readPagesApiJsonBody } from '@/lib/pages-api-body.server';
import {
  fetchSafeOutboundUrl,
  parseServerHostAllowlist,
} from '@/lib/server-outbound-request';
import { hasValidDesktopApiToken } from '@/lib/desktop-api-token.server';
import {
  applyTrialLimitHeaders,
  consumeWebTrialGeneration,
  isGenerationSubmission,
  trialLimitErrorBody,
} from '@/lib/web-trial-generation-limit.server';

const ALLOWED_HOST_SUFFIXES = ['.volces.com', '.volcengineapi.com'];
const ALLOWED_HOSTS = new Set(['volces.com', 'volcengineapi.com']);

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getExtraAllowedHosts(): Set<string> {
  return parseServerHostAllowlist(process.env.VOLCENGINE_PROXY_ALLOWED_HOSTS);
}

function isAllowedTarget(target: URL, desktopAuthorized = false): boolean {
  const hostname = target.hostname.toLowerCase();
  if (desktopAuthorized) return true;
  if (ALLOWED_HOSTS.has(hostname) || getExtraAllowedHosts().has(hostname)) {
    return true;
  }
  if (ALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return true;
  }
  return false;
}

function parseTargetUrl(value: string | undefined, desktopAuthorized = false): URL | null {
  if (!value) return null;
  try {
    const target = new URL(value);
    if (target.protocol !== 'https:' || !isAllowedTarget(target, desktopAuthorized)) {
      return null;
    }
    return target;
  } catch {
    return null;
  }
}

const CORS_ALLOW_HEADERS =
  'Content-Type, Authorization, X-Target-URL, X-API-Key';

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
    responseLimit: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Target-URL, X-API-Key'
    );
    return res.status(204).end();
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const requestBody = req.method === 'POST'
      ? await readPagesApiJsonBody<Record<string, unknown>>(req, 64 * 1024 * 1024)
      : {};
    // 从请求头中获取目标URL和API Key
    const targetHeader = getHeaderValue(req.headers['x-target-url']);
    const apiKey = getHeaderValue(req.headers['x-api-key']);
    const desktopAuthorized = hasValidDesktopApiToken(req.headers);
    const targetUrl = parseTargetUrl(targetHeader, desktopAuthorized);

    if (!targetHeader) {
      return res.status(400).json({ error: 'Missing target URL' });
    }

    if (!targetUrl) {
      return res.status(400).json({
        error: 'Invalid target URL',
        message:
          'Only HTTPS Volcengine/Volces API hosts are allowed. Set VOLCENGINE_PROXY_ALLOWED_HOSTS for trusted private gateways.',
      });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'Missing API Key' });
    }

    if (isGenerationSubmission(targetUrl, req.method)) {
      const trialLimit = await consumeWebTrialGeneration(apiKey);
      applyTrialLimitHeaders((name, value) => res.setHeader(name, value), trialLimit);
      if (!trialLimit.allowed) {
        const errorBody = trialLimitErrorBody(trialLimit);
        res.setHeader('Retry-After', String(trialLimit.retryAfterSeconds));
        applyProxyCorsHeaders(res, CORS_ALLOW_HEADERS);
        return res.status(errorBody.error === 'WEB_TRIAL_DAILY_LIMIT' ? 429 : 503).json(errorBody);
      }
    }

    // 构建请求头
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };

    // 复制其他必要的请求头
    const forwardHeaders = ['Accept', 'Accept-Language', 'User-Agent'];
    forwardHeaders.forEach(header => {
      if (req.headers[header.toLowerCase()]) {
        headers[header] = req.headers[header.toLowerCase()] as string;
      }
    });

    const wantsStream = requestWantsStream(requestBody);

    // 转发请求到火山引擎API
    const response = await fetchSafeOutboundUrl(targetUrl, {
      method: req.method,
      headers,
      body: req.method === 'POST' ? JSON.stringify(requestBody) : undefined,
    }, {
      allowedProtocols: ['https:'],
      isAllowedUrl: (url) => isAllowedTarget(url, desktopAuthorized),
    });

    if (
      await maybePipeStreamingResponse(response, res, {
        wantsStream,
        allowHeaders: CORS_ALLOW_HEADERS,
      })
    ) {
      return;
    }

    // 获取响应内容。部分网关会声明 JSON 但返回空文本/非标准 JSON，
    // 这里用文本兜底，避免代理层吞掉上游真实错误。
    const contentType = response.headers.get('content-type') || '';
    const responseText = await response.text();
    let data: unknown = responseText;

    if (contentType.includes('application/json') || responseText.trim().startsWith('{')) {
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        data = responseText;
      }
    }

    // 转发响应状态码和头
    res.status(response.status);
    
    // 复制响应头（除了CORS相关头）
    const responseHeaders = ['content-type', 'cache-control', 'expires'];
    responseHeaders.forEach(header => {
      const value = response.headers.get(header);
      if (value) {
        res.setHeader(header, value);
      }
    });

    applyProxyCorsHeaders(res, CORS_ALLOW_HEADERS);

    if (typeof data === 'string') {
      if (!res.getHeader('content-type')) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      }
      return res.send(data);
    }
    return res.json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    const targetHeader = getHeaderValue(req.headers['x-target-url']);
    let targetHost = '';
    let targetPath = '';
    try {
      if (targetHeader) {
        const targetUrl = new URL(targetHeader);
        targetHost = targetUrl.host;
        targetPath = targetUrl.pathname;
      }
    } catch {
      // ignore diagnostic parse errors
    }

    return res.status(pagesApiBodyErrorStatus(error) === 500 ? 502 : pagesApiBodyErrorStatus(error)).json({
      error: 'Proxy error',
      message: error instanceof Error ? error.message : 'Unknown error',
      target_host: targetHost,
      target_path: targetPath,
    });
  }
}
