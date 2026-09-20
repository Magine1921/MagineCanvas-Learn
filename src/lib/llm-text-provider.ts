import type { ProviderConfig, SeedanceConfig } from '@/components/seedance/SeedanceStore';

/** LLM 文本 provider ID — 包含内置和自定义提供商 */
export type LlmTextProviderId = string;

export type LlmModelOption = { value: string; label: string };

export const GEMINI_MODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash（预览）' },
  { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite' },
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
];

const REMOVED_LLM_PROVIDER_IDS = new Set(['volcengine', 'claude', 'minimax']);

export function resolveLlmTextProvider(
  llmSource: string | undefined,
  defaultLlmSource: LlmTextProviderId | undefined
): LlmTextProviderId {
  const explicit = llmSource?.trim() || '';
  if (explicit && !REMOVED_LLM_PROVIDER_IDS.has(explicit)) return explicit;
  const d = (defaultLlmSource || '').trim();
  if (d && !REMOVED_LLM_PROVIDER_IDS.has(d)) return d;
  return 'openai';
}

export function resolveDefaultLlmModel(
  defaultLlmSource: LlmTextProviderId | undefined,
  defaultLlmModel: string | undefined,
): string {
  return (defaultLlmModel || '').trim() || 'gpt-5-5';
}

export function resolveGeminiModelId(
  modelId: string | undefined,
  multimodalModel: string | undefined
): string {
  const m = (modelId || '').trim();
  if (m) return m;
  const d = (multimodalModel || '').trim();
  return d || 'gemini-2.5-pro';
}

export function getLlmProviderRecord(
  config: SeedanceConfig,
  providerId: LlmTextProviderId
): ProviderConfig | undefined {
  const all = { ...config.llm.providers, ...config.llm.customProviders };
  return all[providerId];
}

/** 指定 LLM 路由下的模型列表（不含 Gemini，Gemini 走 GeminiModelSelect） */
export function buildLlmModelOptionsForProvider(
  config: SeedanceConfig,
  providerId: LlmTextProviderId
): LlmModelOption[] {
  if (providerId === 'gemini') return [];

  const provider = getLlmProviderRecord(config, providerId);
  if (provider?.models?.length) {
    return provider.models.map((model) => ({ value: model, label: model }));
  }

  return [];
}

export function resolveLlmModelForProvider(
  config: SeedanceConfig,
  providerId: LlmTextProviderId,
  savedModel: string | undefined,
  fallbackModel = 'gpt-5-5'
): string {
  const options = buildLlmModelOptionsForProvider(config, providerId);
  const saved = (savedModel || '').trim();

  if (saved && options.some((o) => o.value === saved)) return saved;

  const defaultSource = resolveLlmTextProvider(undefined, config.defaultLlmSource);
  if (providerId === defaultSource) {
    const fromGlobal = resolveDefaultLlmModel(config.defaultLlmSource, config.defaultLlmModel);
    if (fromGlobal && options.some((o) => o.value === fromGlobal)) return fromGlobal;
  }

  if (options.length > 0) return options[0].value;
  return saved || fallbackModel;
}
