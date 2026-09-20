import { NextResponse } from 'next/server';
import {
  interpretKieCreditResponse,
  kieCreditHttpStatus,
  normalizeKieApiKey,
  type KieCreditCheck,
} from '@/lib/kie-credit';
import { fetchSafeOutboundUrl } from '@/lib/server-outbound-request';

export const runtime = 'nodejs';

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveKieOrigin(apiUrl: unknown): string | null {
  try {
    const raw = String(apiUrl || 'https://api.kie.ai').trim();
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'api.kie.ai' ? url.origin : null;
  } catch {
    return null;
  }
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 300) };
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as { apiKey?: unknown; apiUrl?: unknown };
  const apiKey = normalizeKieApiKey(typeof body.apiKey === 'string' ? body.apiKey : '');
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: '请输入 Kie API Key' }, { status: 400 });
  }

  const origin = resolveKieOrigin(body.apiUrl);
  if (!origin) {
    return NextResponse.json({ ok: false, error: 'Kie API 地址无效，必须使用 https://api.kie.ai' }, { status: 400 });
  }

  let lastFailure: Exclude<KieCreditCheck, { ok: true }> | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchSafeOutboundUrl(`${origin}/api/v1/chat/credit`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      }, {
        allowedProtocols: ['https:'],
        isAllowedUrl: (url) => url.hostname === 'api.kie.ai',
      });
      const result = interpretKieCreditResponse(response.status, await readPayload(response));
      if (result.ok) {
        return NextResponse.json({ ok: true, credits: result.credits });
      }
      lastFailure = result;
      if (!result.retryable || attempt === MAX_ATTEMPTS) break;
    } catch (error) {
      const timedOut = controller.signal.aborted;
      lastFailure = {
        ok: false,
        code: timedOut ? 504 : 502,
        message: timedOut
          ? '连接 Kie 超时，请检查网络后重试'
          : `本地无法连接 Kie API：${error instanceof Error ? error.message : '未知网络错误'}`,
        retryable: true,
      };
      if (attempt === MAX_ATTEMPTS) break;
    } finally {
      clearTimeout(timeout);
    }
    await wait(350 * 2 ** (attempt - 1));
  }

  const failure = lastFailure || {
    ok: false as const,
    code: 500,
    message: 'Kie API 校验失败，请稍后重试',
    retryable: true,
  };
  return NextResponse.json(
    { ok: false, error: failure.message, upstreamCode: failure.code },
    { status: kieCreditHttpStatus(failure) },
  );
}
