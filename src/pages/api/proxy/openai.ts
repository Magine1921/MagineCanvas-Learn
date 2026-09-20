// 通用 OpenAI 兼容 API 代理端点
// 支持 Bearer 鉴权的第三方 API：OpenAI、DeepSeek、Kling、Hailuo、MiniMax 等
// 允许的主机名通过环境变量 OPENAI_PROXY_ALLOWED_HOSTS 配置（逗号分隔）

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

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getAllowedHosts(): Set<string> {
  const envHosts = parseServerHostAllowlist(process.env.OPENAI_PROXY_ALLOWED_HOSTS);
  // 默认允许的知名 API 主机
  const defaults = [
    'api.openai.com',
    'api.deepseek.com',
    'api.klingai.com',
    'api-beijing.klingai.com',
    'api-singapore.klingai.com',
    'api.minimaxi.com',
    'api-bj.minimaxi.com',
    'api.hailuoai.com',
    'shiyunapi.com',
    'dashscope.aliyuncs.com',
    'dashscope-intl.aliyuncs.com',
    'dashscope-us.aliyuncs.com',
    'api.suno.ai',
    'api.elevenlabs.io',
    'api.kie.ai',
  ];
  return new Set([...defaults, ...envHosts]);
}

function isAllowedTarget(target: URL, desktopAuthorized = false): boolean {
  const hostname = target.hostname.toLowerCase();
  if (desktopAuthorized) return true;
  if (getAllowedHosts().has(hostname)) return true;
  if (hostname.endsWith('.maas.aliyuncs.com')) return true;
  return false;
}

function parseTargetUrl(value: string | undefined, desktopAuthorized = false): { url: URL } | { error: string } {
  if (!value) return { error: 'Missing X-Target-URL header' };

  // 净化：去掉可能误附的前缀（HTTP 方法名、空格等）
  let sanitized = value.trim();
  sanitized = sanitized.replace(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+/i, '');
  // 如果值是完整 HTTP 请求行（如 "POST /path HTTP/1.1"），提取路径部分没有任何意义，跳过
  // 如果值以 https:// 开头，使用从该位置开始的部分
  const httpsIdx = sanitized.indexOf('https://');
  if (httpsIdx > 0) {
    console.log(`[openai-proxy] X-Target-URL 包含额外前缀，已净化: "${value.slice(0, 200)}" → "${sanitized.slice(httpsIdx, 200)}"`);
    sanitized = sanitized.slice(httpsIdx);
  }

  let target: URL;
  try {
    target = new URL(sanitized);
  } catch {
    return { error: `无法解析目标 URL: ${value.slice(0, 200)}` };
  }
  if (target.protocol !== 'https:') {
    return { error: `仅支持 HTTPS 协议: ${target.protocol}//${target.hostname}` };
  }
  if (!isAllowedTarget(target, desktopAuthorized)) {
    console.log(`[openai-proxy] BLOCKED host: "${target.hostname}" — 不在 OPENAI_PROXY_ALLOWED_HOSTS 白名单中`);
    return { error: `Host "${target.hostname}" 不在代理白名单中。请由服务端管理员将可信域名加入 OPENAI_PROXY_ALLOWED_HOSTS。` };
  }
  return { url: target };
}

const CORS_ALLOW_HEADERS =
  'Content-Type, Authorization, X-Target-URL, X-API-Key, X-ElevenLabs-Api-Key, X-Goog-Api-Key, X-Dashscope-Async';

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
    responseLimit: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
    return res.status(204).end();
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const requestBody = req.method === 'POST'
      ? await readPagesApiJsonBody<Record<string, unknown>>(req, 64 * 1024 * 1024)
      : {};
    const targetHeader = getHeaderValue(req.headers['x-target-url']);
    const apiKey = (getHeaderValue(req.headers['x-api-key']) || '').trim();
    const elevenLabsApiKey = (getHeaderValue(req.headers['x-elevenlabs-api-key']) || '').trim();
    const desktopAuthorized = hasValidDesktopApiToken(req.headers);
    const parsed = parseTargetUrl(targetHeader, desktopAuthorized);

    if (!targetHeader) {
      return res.status(400).json({ error: 'Missing target URL' });
    }
    if ('error' in parsed) {
      return res.status(400).json({ error: 'Invalid or disallowed target URL', message: parsed.error });
    }
    
    const hasValidKey = apiKey || elevenLabsApiKey;
    if (!hasValidKey) {
      return res.status(400).json({ error: 'Missing API Key' });
    }

    const targetUrl = parsed.url;

    if (isGenerationSubmission(targetUrl, req.method)) {
      const trialLimit = await consumeWebTrialGeneration(hasValidKey);
      applyTrialLimitHeaders((name, value) => res.setHeader(name, value), trialLimit);
      if (!trialLimit.allowed) {
        const errorBody = trialLimitErrorBody(trialLimit);
        res.setHeader('Retry-After', String(trialLimit.retryAfterSeconds));
        applyProxyCorsHeaders(res, CORS_ALLOW_HEADERS);
        return res.status(errorBody.error === 'WEB_TRIAL_DAILY_LIMIT' ? 429 : 503).json(errorBody);
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // 根据 API Key 类型设置认证头
    if (elevenLabsApiKey) {
      headers['xi-api-key'] = elevenLabsApiKey;
      console.log(`[openai-proxy] Using ElevenLabs authentication`);
    } else if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const forwardHeaders = ['Accept', 'Accept-Language', 'User-Agent', 'X-Dashscope-Async'];
    for (const h of forwardHeaders) {
      const v = getHeaderValue(req.headers[h.toLowerCase()]);
      if (v) headers[h] = v;
    }

    const body = req.method === 'POST' ? JSON.stringify(requestBody) : undefined;

    console.log(`[openai-proxy] → ${req.method} ${targetUrl.toString()}`);
    console.log(`[openai-proxy]   authType=${elevenLabsApiKey ? 'elevenlabs' : 'standard'} apiKey len=${hasValidKey.length}`);
    if (body) console.log(`[openai-proxy]   body len=${body.length} preview=${body.slice(0, 200)}`);

    const wantsStream = requestWantsStream(requestBody);

    const response = await fetchSafeOutboundUrl(targetUrl, {
      method: req.method,
      headers,
      body,
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

    const contentType = response.headers.get('content-type') || '';
    const responseText = await response.text();

    if (!response.ok) {
      console.log(`[openai-proxy] ← ${response.status} ${responseText.slice(0, 500)}`);
    }

    let data: unknown = responseText;

    if (contentType.includes('application/json') || responseText.trim().startsWith('{') || responseText.trim().startsWith('[')) {
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch { /* keep as text */ }
    }

    res.status(response.status);

    const copyHeaders = ['content-type', 'cache-control', 'expires'];
    for (const h of copyHeaders) {
      const v = response.headers.get(h);
      if (v) res.setHeader(h, v);
    }

    applyProxyCorsHeaders(res, CORS_ALLOW_HEADERS);

    if (typeof data === 'string') {
      if (!res.getHeader('content-type')) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      }
      return res.send(data);
    }
    return res.json(data);
  } catch (error) {
    console.error('OpenAI proxy error:', error);
    return res.status(pagesApiBodyErrorStatus(error) === 500 ? 502 : pagesApiBodyErrorStatus(error)).json({
      error: 'Proxy error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
