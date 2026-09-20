import type { NextApiRequest, NextApiResponse } from 'next';
import { normalizeUserGeminiApiKey } from '@/lib/gemini-api-url';
import {
  applyProxyCorsHeaders,
  maybePipeStreamingResponse,
  requestWantsStream,
} from '@/lib/proxy-stream-passthrough.server';
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

const DEFAULT_GEMINI_HOST = 'generativelanguage.googleapis.com';

/** 第三方 Gemini 兼容中转：hostname（可含 https://），逗号/空格/分号分隔。仅服务端读取。 */
function parseExtraAllowedGeminiHosts(raw: string | undefined): string[] {
  return [...parseServerHostAllowlist(raw)];
}

/** 内置放行的第三方 Gemini 原生网关（与 OpenAPI 示例一致）；更多域名用 GEMINI_PROXY_EXTRA_HOSTS */
const BUILTIN_EXTRA_GEMINI_HOSTS = ['shiyunapi.com'];

const EXTRA_GEMINI_PROXY_HOSTS = parseExtraAllowedGeminiHosts(process.env.GEMINI_PROXY_EXTRA_HOSTS);
const ALLOWED_GEMINI_PROXY_HOSTS = new Set<string>([
  DEFAULT_GEMINI_HOST,
  ...BUILTIN_EXTRA_GEMINI_HOSTS,
  ...EXTRA_GEMINI_PROXY_HOSTS,
]);

function allowedHostsHint(): string {
  return [...ALLOWED_GEMINI_PROXY_HOSTS].sort().join(', ');
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isAllowedTarget(target: URL, desktopAuthorized = false): boolean {
  return target.protocol === 'https:'
    && (desktopAuthorized || ALLOWED_GEMINI_PROXY_HOSTS.has(target.hostname.toLowerCase()));
}

function parseTargetUrl(value: string | undefined, desktopAuthorized = false): URL | null {
  if (!value) return null;
  try {
    const target = new URL(value);
    if (!isAllowedTarget(target, desktopAuthorized)) return null;
    return target;
  } catch {
    return null;
  }
}

const CORS_ALLOW_HEADERS =
  'Content-Type, X-Target-URL, X-Goog-Api-Key, X-API-Key, Authorization';

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
    responseLimit: false,
  },
};

function readRequestBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function extractBearerToken(authorization: string | undefined): string {
  if (!authorization) return '';
  const m = /^\s*Bearer\s+(.+)$/i.exec(authorization);
  return m ? m[1].trim() : '';
}

/** Node fetch 失败时展开 cause 链（如 getaddrinfo / certificate） */
function formatErrorChain(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const segments: string[] = [err.message];
  let c: unknown = err.cause;
  for (let i = 0; i < 6 && c instanceof Error; i++) {
    segments.push(c.message);
    c = c.cause;
  }
  return segments.filter(Boolean).join(' → ');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Target-URL, X-Goog-Api-Key, X-API-Key, Authorization'
    );
    return res.status(204).end();
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const targetHeader = getHeaderValue(req.headers['x-target-url']);
    const rawKey =
      getHeaderValue(req.headers['x-goog-api-key']) ||
      getHeaderValue(req.headers['x-api-key']) ||
      extractBearerToken(getHeaderValue(req.headers.authorization));
    const apiKey = normalizeUserGeminiApiKey(rawKey);
    const desktopAuthorized = hasValidDesktopApiToken(req.headers);
    const targetUrl = parseTargetUrl(targetHeader, desktopAuthorized);

    if (!targetHeader) {
      return res.status(400).json({ error: 'Missing target URL' });
    }

    if (!targetUrl) {
      const extraHint = `当前允许的主机：${allowedHostsHint()}。若使用其它 HTTPS 中转，请在环境变量 GEMINI_PROXY_EXTRA_HOSTS 中加入其 hostname（逗号分隔），并重启 Next。`;
      return res.status(400).json({
        error: 'Invalid target URL',
        message: extraHint,
      });
    }

    if (!apiKey) {
      return res.status(400).json({
        error: 'Missing API key',
        message: '请通过 X-Goog-Api-Key、X-API-Key 或 Authorization: Bearer 传入密钥',
      });
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

    const hostLower = targetUrl.hostname.toLowerCase();
    const pathLower = targetUrl.pathname.toLowerCase();
    const isGoogleGenerativeLanguage = hostLower === DEFAULT_GEMINI_HOST;
    const openAiCompatGoogle = isGoogleGenerativeLanguage && pathLower.includes('/openai/');
    const isShiyun = hostLower === 'shiyunapi.com';
    const isShiyunV1Beta = isShiyun && pathLower.includes('/v1beta');

    const upstreamHeaders: Record<string, string> = {};
    let upstreamUrl = targetUrl.toString();

    if (isGoogleGenerativeLanguage) {
      if (openAiCompatGoogle) {
        upstreamHeaders.Authorization = `Bearer ${apiKey}`;
      } else {
        upstreamHeaders['x-goog-api-key'] = apiKey;
      }
    } else if (isShiyunV1Beta) {
      const u = new URL(targetUrl.toString());
      u.searchParams.set('key', apiKey);
      upstreamUrl = u.toString();
    } else if (isShiyun) {
      upstreamHeaders.Authorization = `Bearer ${apiKey}`;
      upstreamHeaders.Accept = 'application/json';
    } else {
      const u = new URL(targetUrl.toString());
      u.searchParams.set('key', apiKey);
      upstreamUrl = u.toString();
    }

    if (req.method !== 'GET') {
      const inboundContentType = getHeaderValue(req.headers['content-type']) || '';
      if (inboundContentType.includes('multipart/form-data')) {
        upstreamHeaders['Content-Type'] = inboundContentType;
      } else {
        upstreamHeaders['Content-Type'] = inboundContentType || 'application/json';
      }
    }

    const outboundUrl = upstreamUrl;

    const requestBody =
      req.method === 'POST' ? await readRequestBody(req) : undefined;

    let wantsStream = false;
    if (requestBody?.length) {
      try {
        wantsStream = requestWantsStream(JSON.parse(requestBody.toString('utf8')));
      } catch {
        /* non-JSON body */
      }
    }

    const response = await fetchSafeOutboundUrl(outboundUrl, {
      method: req.method,
      headers: upstreamHeaders,
      body: requestBody?.length ? Uint8Array.from(requestBody) : undefined,
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
    let data: unknown = responseText;
    if (contentType.includes('application/json') || responseText.trim().startsWith('{')) {
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        data = responseText;
      }
    }

    res.status(response.status);
    const passHeaders = ['content-type', 'cache-control'];
    passHeaders.forEach((h) => {
      const v = response.headers.get(h);
      if (v) res.setHeader(h, v);
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
    console.error('Gemini proxy error:', error);
    const chain = formatErrorChain(error);
    const isLikelyOutbound =
      /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|certificate|TLS|getaddrinfo|network|socket|SSL|UNABLE_TO_VERIFY/i.test(
        chain
      );

    let targetHost = '';
    let attempted = '';
    try {
      const th = getHeaderValue(req.headers['x-target-url']);
      const tu = th ? new URL(th) : null;
      if (tu) {
        targetHost = tu.hostname;
        attempted = tu.toString();
      }
    } catch {
      /* noop */
    }

    const message = isLikelyOutbound
      ? `${chain}。代理出站失败：目标主机「${targetHost || '未知'}」，完整请求 URL「${attempted || '未知'}」。说明：该请求由运行 Next 的 Node 进程发起（与浏览器能否打开网页无关）。请在本机终端执行 curl -I「该 URL」或检查 DNS、防火墙、公司代理；若需 HTTP(S) 代理，为 Node 配置环境变量 HTTPS_PROXY 后重启 dev 服务器。其它中转域名需在 GEMINI_PROXY_EXTRA_HOSTS 中放行。`
      : chain;
    return res.status(502).json({
      error: 'Proxy error',
      message,
    });
  }
}
