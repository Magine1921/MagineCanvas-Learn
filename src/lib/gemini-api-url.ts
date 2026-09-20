/** 判断多模态「API 根地址」是否走 Google OpenAI 兼容层（/v1beta/openai） */

const DEFAULT_NATIVE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_OPENAI_COMPAT = 'https://generativelanguage.googleapis.com/v1beta/openai';
const SHIYUN_HOST = 'shiyunapi.com';
const DEFAULT_SHIYUN_OPENAI_V1 = `https://${SHIYUN_HOST}/v1`;

export function isGeminiOpenAICompatApiUrl(apiUrl: string | undefined): boolean {
  return /\/v1beta\/openai(\/|$)/i.test(String(apiUrl || '').trim());
}

/** 兼容网关：根地址为 …/v1（非 /v1beta），走 OpenAI ChatGPT 兼容 /v1/chat/completions + Bearer */
export function isShiyunOpenAiV1ChatApiUrl(apiUrl: string | undefined): boolean {
  const s = String(apiUrl || '').trim();
  if (!s) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (u.hostname.toLowerCase() !== SHIYUN_HOST) return false;
    return !u.pathname.toLowerCase().includes('/v1beta');
  } catch {
    return false;
  }
}

/** 统一：Google OpenAI 兼容层 或 shiyunapi.com /v1 Chat */
export function isOpenAiStyleChatMultimodalBase(apiUrl: string | undefined): boolean {
  return isGeminiOpenAICompatApiUrl(apiUrl) || isShiyunOpenAiV1ChatApiUrl(apiUrl);
}

/** OpenAI 兼容根路径（默认 https://shiyunapi.com/v1） */
export function normalizeShiyunOpenAiV1Base(apiUrl: string): string {
  const raw = (apiUrl || DEFAULT_SHIYUN_OPENAI_V1).trim().replace(/\/+$/, '');
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.hostname.toLowerCase() !== SHIYUN_HOST) {
      return DEFAULT_SHIYUN_OPENAI_V1;
    }
    return `${u.origin}/v1`;
  } catch {
    return DEFAULT_SHIYUN_OPENAI_V1;
  }
}

/** Google /v1beta/openai 或兼容 /v1 → 用于拼接 /chat/completions、/models */
export function normalizeOpenAiStyleChatBase(apiUrl: string): string {
  if (isGeminiOpenAICompatApiUrl(apiUrl)) return normalizeGeminiOpenAICompatBase(apiUrl);
  if (isShiyunOpenAiV1ChatApiUrl(apiUrl)) return normalizeShiyunOpenAiV1Base(apiUrl);
  return normalizeGeminiOpenAICompatBase(apiUrl);
}

/** 原生 Gemini：…/v1beta（不含 /openai） */
export function normalizeGeminiNativeV1BetaBase(apiUrl: string): string {
  let t = (apiUrl || DEFAULT_NATIVE).trim().replace(/\/+$/, '');
  if (/\/v1beta\/openai/i.test(t)) {
    t = t.replace(/\/openai$/i, '');
  }
  if (/\/v1beta$/i.test(t)) return t;
  if (/generativelanguage\.googleapis\.com$/i.test(t)) return `${t}/v1beta`;
  return t.endsWith('/v1beta') ? t : `${t}/v1beta`;
}

/** OpenAI 兼容：…/v1beta/openai */
export function normalizeGeminiOpenAICompatBase(apiUrl: string): string {
  const t0 = (apiUrl || DEFAULT_OPENAI_COMPAT).trim().replace(/\/+$/, '');
  if (/\/v1beta\/openai$/i.test(t0)) return t0;
  if (/\/v1beta$/i.test(t0)) return `${t0}/openai`;
  return DEFAULT_OPENAI_COMPAT;
}

export function defaultGeminiNativeBase(): string {
  return DEFAULT_NATIVE;
}

export function defaultGeminiOpenAICompatBase(): string {
  return DEFAULT_OPENAI_COMPAT;
}

/** 去掉首尾空白、误粘贴的 Bearer/引号、常见不可见字符，便于通过代理校验 */
export function normalizeUserGeminiApiKey(raw: string): string {
  let s = String(raw ?? '').trim();
  s = s.replace(/^\s*Bearer\s+/i, '');
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[\u200b\u200c\u200d\ufeff\u00a0]/g, '');
  return s.trim();
}

/**
 * 多模态「测试连接」返回 API_KEY_INVALID 等时的说明（与本地代理实际鉴权方式一致）。
 * - shiyunapi.com …/v1：Bearer + GET /v1/models（裸域名 https://shiyunapi.com 也会归一成 /v1）
 * - shiyunapi.com …/v1beta：?key= + GET /v1beta/models
 * - Google OpenAI 兼容：Bearer + …/openai/models
 * - Google 原生：X-Goog-Api-Key + …/v1beta/models
 */
export function multimodalInvalidApiKeyHint(apiUrl: string): string {
  const raw = String(apiUrl || '').trim();
  if (isGeminiOpenAICompatApiUrl(raw)) {
    return '当前为 Google OpenAI 兼容根（…/v1beta/openai）：测试连接为 GET …/openai/models，代理使用 Authorization: Bearer。请使用对该兼容端点有效的密钥，并与根地址一致。';
  }
  if (isShiyunOpenAiV1ChatApiUrl(raw)) {
    return '当前为 OpenAI 兼容根（路径不含 /v1beta，例如 https://shiyunapi.com/v1；仅填域名也会按 /v1 处理）：测试连接为 GET …/v1/models，代理使用 Authorization: Bearer（不是 URL 的 ?key=）。若你只有「Gemini 原生 /v1beta」密钥，请把根地址改为含 /v1beta（如 https://shiyunapi.com/v1beta）。';
  }
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.hostname.toLowerCase() === SHIYUN_HOST) {
      return '当前为 Gemini 原生根（路径含 /v1beta，主机 shiyunapi.com）：测试连接为 GET …/v1beta/models，代理会把密钥追加为 ?key=。请到服务商控制台核对用于原生 Gemini 的密钥；不要使用 Google AI Studio 的官方 Key 作为该网关的 Key。';
    }
  } catch {
    /* noop */
  }
  return '当前为直连 Google Gemini 原生：测试连接为 GET …/v1beta/models，代理转发 X-Goog-Api-Key。请从 https://aistudio.google.com/apikey 获取密钥；若实际使用第三方中转，请把根地址改为该中转提供的 HTTPS 根，并换用对应控制台密钥。';
}
