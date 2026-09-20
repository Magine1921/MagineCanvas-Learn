const VOLCENGINE_MODEL_ALIASES: Record<string, string> = {
  'deepseek-v4-flash': 'deepseek-v4-flash-260425',
  'deepseek-v4-pro': 'deepseek-v4-pro-260425',
};

function isVolcengineApi(apiUrl: string, authType?: string): boolean {
  if (authType === 'volcengine-bearer') return true;
  try {
    const hostname = new URL(apiUrl).hostname.toLowerCase();
    return hostname.endsWith('.volces.com') || hostname.endsWith('.volcengineapi.com');
  } catch {
    return false;
  }
}

export function normalizeLlmModelForProvider(
  model: string,
  apiUrl: string,
  authType?: string,
): string {
  const trimmed = model.trim();
  if (!isVolcengineApi(apiUrl, authType)) return trimmed;
  return VOLCENGINE_MODEL_ALIASES[trimmed] || trimmed;
}
