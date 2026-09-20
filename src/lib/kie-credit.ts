type JsonRecord = Record<string, unknown>;

export type KieCreditCheck =
  | { ok: true; credits: number }
  | { ok: false; code: number; message: string; retryable: boolean };

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function asNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function asMessage(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeKieApiKey(value: string): string {
  return String(value || '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

export function interpretKieCreditResponse(httpStatus: number, payload: unknown): KieCreditCheck {
  const root = asRecord(payload);
  const code = asNumber(root.code) ?? httpStatus;
  const credits = asNumber(root.data);
  const detail = [root.msg, root.message, root.error].map(asMessage).find(Boolean) || '';
  if (httpStatus >= 200 && httpStatus < 300 && (code === 200 || root.code == null) && credits != null) {
    return { ok: true, credits };
  }
  if (code === 401 || httpStatus === 401 || httpStatus === 403) {
    return { ok: false, code: 401, message: 'Kie API Key 无效、已失效，或当前密钥没有访问权限', retryable: false };
  }
  if (code === 402 || httpStatus === 402) {
    return { ok: false, code: 402, message: 'Kie 账户 credits 不足，请先补充余额', retryable: false };
  }
  if (code === 429 || httpStatus === 429) {
    return { ok: false, code: 429, message: 'Kie 请求过于频繁，已触发限流，请稍后重试', retryable: true };
  }
  if (code === 455 || httpStatus === 455) {
    return { ok: false, code: 455, message: 'Kie 服务正在维护，暂时不可用，请稍后重试', retryable: true };
  }
  if (code === 505 || httpStatus === 505) {
    return { ok: false, code: 505, message: 'Kie 当前已停用该接口或账户功能，请在 Kie 控制台确认服务状态', retryable: false };
  }
  if (code >= 500 || httpStatus >= 500) {
    return { ok: false, code: code >= 500 ? code : httpStatus, message: `Kie 云端接口暂时异常${detail ? `：${detail}` : ''}，这不代表本地 API Key 配置错误，请稍后重试`, retryable: true };
  }
  return { ok: false, code, message: detail ? `Kie 校验失败：${detail}` : `Kie 校验失败（错误码 ${code}）`, retryable: false };
}

export function kieCreditHttpStatus(result: Exclude<KieCreditCheck, { ok: true }>): number {
  if (result.code === 401) return 401;
  if (result.code === 402) return 402;
  if (result.code === 429) return 429;
  if (result.code === 505) return 503;
  if (result.retryable) return 503;
  return 400;
}
