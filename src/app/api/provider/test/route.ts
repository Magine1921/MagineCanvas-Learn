import { createHmac } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  assertSafeOutboundUrl,
  fetchSafeOutboundUrl,
  parseServerHostAllowlist,
} from '@/lib/server-outbound-request';
import { hasValidDesktopApiToken } from '@/lib/desktop-api-token.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProviderAuthType =
  | 'volcengine-bearer'
  | 'gemini-bearer'
  | 'standard-bearer'
  | 'elevenlabs-api-key'
  | 'kling-jwt';

interface ProviderTestRequest {
  providerId?: string;
  category?: string;
  apiKey?: string;
  apiUrl?: string;
  authType?: ProviderAuthType;
  modelsUrl?: string;
}

interface ProbeSpec {
  url: URL;
  headers: Record<string, string>;
  acceptsUnsupportedEndpoint?: boolean;
  label: string;
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function createKlingJwt(apiKey: string): string {
  const separator = apiKey.indexOf(':');
  if (separator < 1) return apiKey.trim();

  const accessKey = apiKey.slice(0, separator).trim();
  const secretKey = apiKey.slice(separator + 1).trim();
  if (!accessKey || !secretKey) throw new Error('可灵 AccessKey 或 SecretKey 为空');

  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = encodeBase64Url(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 }));
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', secretKey).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

const BUILTIN_PROVIDER_TEST_HOSTS = new Set([
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
  'api.elevenlabs.io',
  'api.kie.ai',
  'generativelanguage.googleapis.com',
  'volces.com',
  'volcengineapi.com',
]);

function providerTestAllowedHosts(): Set<string> {
  return new Set([
    ...BUILTIN_PROVIDER_TEST_HOSTS,
    ...parseServerHostAllowlist(process.env.PROVIDER_TEST_ALLOWED_HOSTS),
    ...parseServerHostAllowlist(process.env.OPENAI_PROXY_ALLOWED_HOSTS),
    ...parseServerHostAllowlist(process.env.GEMINI_PROXY_EXTRA_HOSTS),
    ...parseServerHostAllowlist(process.env.VOLCENGINE_PROXY_ALLOWED_HOSTS),
  ]);
}

function isAllowedProviderTestUrl(url: URL, desktopAuthorized = false): boolean {
  const hostname = url.hostname.toLowerCase();
  return url.protocol === 'https:' && (
    desktopAuthorized
    || providerTestAllowedHosts().has(hostname)
    || hostname.endsWith('.maas.aliyuncs.com')
    || hostname.endsWith('.volces.com')
    || hostname.endsWith('.volcengineapi.com')
  );
}

function parseHttpsUrl(value: string, field: string, desktopAuthorized = false): URL {
  try {
    return assertSafeOutboundUrl(value, {
      allowedProtocols: ['https:'],
      isAllowedUrl: (url) => isAllowedProviderTestUrl(url, desktopAuthorized),
    });
  } catch {
    throw new Error(`${field} 不是有效且已由服务端放行的 HTTPS URL`);
  }
}

function apiOriginBase(apiUrl: string, desktopAuthorized = false): URL {
  const url = parseHttpsUrl(apiUrl, 'API 地址', desktopAuthorized);
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '') || '';
  return url;
}

function appendPath(base: URL, path: string): URL {
  const url = new URL(base.toString());
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  return url;
}

function openAiModelsUrl(apiUrl: string, desktopAuthorized = false): URL {
  const url = parseHttpsUrl(apiUrl, 'API 地址', desktopAuthorized);
  url.search = '';
  url.hash = '';
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = /\/v1$/i.test(path) ? `${path}/models` : `${path}/v1/models`;
  return url;
}

function buildProbe(
  input: Required<Pick<ProviderTestRequest, 'apiKey' | 'apiUrl' | 'authType'>> & ProviderTestRequest,
  desktopAuthorized = false,
): ProbeSpec {
  const providerId = (input.providerId || '').toLowerCase();
  const apiKey = input.apiKey.trim();
  const base = apiOriginBase(input.apiUrl, desktopAuthorized);

  if (input.authType === 'elevenlabs-api-key' || providerId === 'elevenlabs') {
    return {
      url: appendPath(base, '/v1/user/subscription'),
      headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
      label: 'ElevenLabs',
    };
  }

  if (input.authType === 'gemini-bearer') {
    const isGoogleNative = base.hostname.toLowerCase() === 'generativelanguage.googleapis.com';
    const url = input.modelsUrl
      ? parseHttpsUrl(input.modelsUrl, '模型列表地址', desktopAuthorized)
      : isGoogleNative
        ? appendPath(base, '/v1beta/models')
        : openAiModelsUrl(input.apiUrl, desktopAuthorized);
    if (isGoogleNative) url.searchParams.set('pageSize', '1');
    return {
      url,
      headers: isGoogleNative
        ? { 'x-goog-api-key': apiKey, Accept: 'application/json' }
        : { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      label: 'Gemini',
    };
  }

  if (input.authType === 'volcengine-bearer') {
    return {
      url: appendPath(base, '/api/v3/models'),
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      acceptsUnsupportedEndpoint: true,
      label: '火山方舟',
    };
  }

  if (input.authType === 'kling-jwt') {
    return {
      url: appendPath(base, '/v1/videos/test_connection_check'),
      headers: { Authorization: `Bearer ${createKlingJwt(apiKey)}`, Accept: 'application/json' },
      acceptsUnsupportedEndpoint: true,
      label: '可灵',
    };
  }

  if (/minimax/i.test(providerId) || /minimax(i)?\.(com|io)$/i.test(base.hostname)) {
    const url = appendPath(base, '/v1/files/list');
    url.searchParams.set('purpose', 't2a_async_input');
    return {
      url,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      label: 'MiniMax',
    };
  }

  if (providerId === 'happyhorse' || /dashscope/i.test(base.hostname)) {
    const url = appendPath(base, '/api/v1/files');
    url.searchParams.set('page_no', '1');
    url.searchParams.set('page_size', '1');
    return {
      url,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      label: '阿里云百炼',
    };
  }

  return {
    url: input.modelsUrl
      ? parseHttpsUrl(input.modelsUrl, '模型列表地址', desktopAuthorized)
      : openAiModelsUrl(input.apiUrl, desktopAuthorized),
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    acceptsUnsupportedEndpoint: false,
    label: providerId || 'API',
  };
}

function readNested(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

function responseDetail(data: unknown, rawText: string): string {
  const paths = [
    'message',
    'error.message',
    'error_msg',
    'base_resp.status_msg',
    'output.message',
    'code',
    'error.code',
  ];
  const parts = paths
    .map((path) => readNested(data, path))
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map(String)
    .map((value) => value.trim())
    .filter(Boolean);
  const detail = parts.join(' · ') || rawText.trim();
  return detail.replace(/\s+/g, ' ').slice(0, 280);
}

function embeddedCode(data: unknown): string {
  const value = readNested(data, 'base_resp.status_code') ?? readNested(data, 'error.code') ?? readNested(data, 'code');
  return value == null ? '' : String(value);
}

function isAuthFailure(status: number, code: string, detail: string): boolean {
  if (status === 401 || status === 403) return true;
  if (['1004', '2049', 'invalid_api_key', 'authentication_error'].includes(code.toLowerCase())) return true;
  return /invalid.?api.?key|incorrect.?api.?key|api.?key.{0,20}(invalid|expired)|unauthori[sz]ed|authentication failed|invalid.?token|token.{0,20}(invalid|expired)|鉴权失败|认证失败|未授权|密钥无效|无效.{0,8}(密钥|token|key)/i.test(detail);
}

function isQuotaFailure(status: number, code: string, detail: string): boolean {
  if (status === 402 || status === 429) return true;
  if (['1008', '2056', 'insufficient_quota'].includes(code.toLowerCase())) return true;
  return /insufficient.{0,12}(quota|credit|balance)|quota.{0,12}(exceed|limit)|余额不足|额度不足|积分不足|用量上限/i.test(detail);
}

async function runProbe(
  spec: ProbeSpec,
  desktopAuthorized = false,
): Promise<{ ok: boolean; message: string; upstreamStatus?: number }> {
  let response: Response;
  try {
    response = await fetchSafeOutboundUrl(spec.url, {
      method: 'GET',
      headers: spec.headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    }, {
      allowedProtocols: ['https:'],
      isAllowedUrl: (url) => isAllowedProviderTestUrl(url, desktopAuthorized),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知网络错误';
    return { ok: false, message: `${spec.label} 网络连接失败：${message}` };
  }

  const rawText = await response.text();
  let data: unknown = rawText;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    // Keep the original text for diagnostics.
  }

  const detail = responseDetail(data, rawText);
  const code = embeddedCode(data);
  const embeddedFailure = code !== '' && code !== '0' && code.toLowerCase() !== 'success';

  if (isAuthFailure(response.status, code, detail)) {
    return {
      ok: false,
      upstreamStatus: response.status,
      message: `${spec.label} 认证失败：API Key 无效、已过期或没有接口权限${detail ? `（${detail}）` : ''}`,
    };
  }

  if (isQuotaFailure(response.status, code, detail)) {
    return {
      ok: true,
      upstreamStatus: response.status,
      message: `${spec.label} 连接成功，API Key 有效，但当前额度不足或已达到用量上限${detail ? `（${detail}）` : ''}`,
    };
  }

  if (response.ok && !embeddedFailure) {
    return { ok: true, upstreamStatus: response.status, message: `${spec.label} 连接成功，API Key 验证通过` };
  }

  if (spec.acceptsUnsupportedEndpoint && [400, 404, 405, 422].includes(response.status)) {
    return {
      ok: true,
      upstreamStatus: response.status,
      message: `${spec.label} 服务可达，API Key 未被拒绝；该厂商未提供通用的无消耗校验接口，可保存后进行实际生成`,
    };
  }

  return {
    ok: false,
    upstreamStatus: response.status,
    message: `${spec.label} 连接失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`,
  };
}

export async function POST(request: NextRequest) {
  let input: ProviderTestRequest;
  try {
    input = (await request.json()) as ProviderTestRequest;
  } catch {
    return NextResponse.json({ ok: false, message: '测试请求不是有效 JSON' }, { status: 400 });
  }

  const apiKey = input.apiKey?.trim() || '';
  const apiUrl = input.apiUrl?.trim() || '';
  const authType = input.authType;
  if (!apiKey) return NextResponse.json({ ok: false, message: '请输入 API Key' }, { status: 400 });
  if (!apiUrl) return NextResponse.json({ ok: false, message: '请输入 API 地址' }, { status: 400 });
  if (!authType) return NextResponse.json({ ok: false, message: '缺少鉴权类型' }, { status: 400 });

  try {
    const desktopAuthorized = hasValidDesktopApiToken(request.headers);
    const result = await runProbe(
      buildProbe({ ...input, apiKey, apiUrl, authType }, desktopAuthorized),
      desktopAuthorized,
    );
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : '无法建立测试请求' },
      { status: 400 },
    );
  }
}
