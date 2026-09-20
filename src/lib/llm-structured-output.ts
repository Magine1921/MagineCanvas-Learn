export function structuredOutputRequestOptions(
  apiUrl: string,
  jsonMode: boolean | undefined,
): Record<string, unknown> {
  if (!jsonMode) return {};
  try {
    if (new URL(apiUrl).hostname.toLowerCase() !== 'api.deepseek.com') return {};
  } catch {
    return {};
  }
  return {
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
  };
}
