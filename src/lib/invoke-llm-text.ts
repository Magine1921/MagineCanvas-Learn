import type { SeedanceConfig } from '@/components/seedance/SeedanceStore';
import { createLLMAPI, type LlmStreamPart } from '@/components/api/LLMAPI';
import { createGeminiMultimodalAPI } from '@/components/api/GeminiMultimodalAPI';
import type { LlmTextProviderId } from '@/lib/llm-text-provider';
import { getLlmProviderRecord } from '@/lib/llm-text-provider';
import type { LlmMediaInput } from '@/lib/llm-media-input';

export function resolveV2LlmConfig(config: SeedanceConfig, providerId?: string): { apiKey: string; apiUrl: string } {
  const llmCat = config.llm;
  const allProviders = { ...llmCat.providers, ...llmCat.customProviders };

  // 1) Specific provider requested — always use its config
  if (providerId) {
    const target = allProviders[providerId];
    if (target?.apiKey?.trim()) {
      const resolved = { apiKey: target.apiKey.trim(), apiUrl: target.apiUrl };
      console.log(`[resolveV2LlmConfig] using provider="${providerId}" apiUrl="${resolved.apiUrl}" hasKey=${!!resolved.apiKey}`);
      return resolved;
    }
    console.log(`[resolveV2LlmConfig] provider="${providerId}" NOT found or no key, hasProvider=${!!target}`);
  }

  // 2) Active provider
  const activeProvider = allProviders[llmCat.activeProviderId];
  if (activeProvider?.apiKey?.trim()) {
    console.log(`[resolveV2LlmConfig] using active provider="${llmCat.activeProviderId}" apiUrl="${activeProvider.apiUrl}"`);
    return { apiKey: activeProvider.apiKey.trim(), apiUrl: activeProvider.apiUrl };
  }

  // 3) Scan all configured providers.
  for (const p of Object.values(allProviders)) {
    if (p.apiKey?.trim()) {
      console.log(`[resolveV2LlmConfig] using scanned provider="${p.label}" apiUrl="${p.apiUrl}"`);
      return { apiKey: p.apiKey.trim(), apiUrl: p.apiUrl };
    }
  }

  console.log('[resolveV2LlmConfig] NO configured LLM provider found');
  return { apiKey: '', apiUrl: '' };
}

export function resolveV2GeminiConfig(config: SeedanceConfig): { apiKey: string; apiUrl: string } {
  const llmCat = config.llm;
  const geminiProvider = llmCat.providers.gemini || llmCat.customProviders.gemini;
  if (geminiProvider?.apiKey?.trim()) {
    return { apiKey: geminiProvider.apiKey.trim(), apiUrl: geminiProvider.apiUrl || config.multimodalApi.apiUrl.trim() };
  }

  const mm = config.multimodalApi;
  const mmKey = mm.apiKey.trim();
  const mmUrl = mm.apiUrl.trim();
  if (mmKey) return { apiKey: mmKey, apiUrl: mmUrl };
  return { apiKey: mmKey, apiUrl: mmUrl };
}

function isKieApiUrl(apiUrl: string | undefined): boolean {
  try {
    return new URL(apiUrl || '').hostname.toLowerCase() === 'api.kie.ai';
  } catch {
    return false;
  }
}

function resolveKieGeminiModel(provider: ReturnType<typeof getLlmProviderRecord>, requested: string | undefined): string {
  const saved = requested?.trim() || '';
  const alias = saved === 'gemini-3.5-flash' ? 'gemini-3.5-flash-openai' : saved;
  if (alias && provider?.models?.includes(alias)) return alias;
  if (saved && provider?.models?.includes(saved)) return saved;
  return provider?.models?.[0] || 'gemini-2.5-pro';
}

export async function generateLlmText(params: {
  config: SeedanceConfig;
  volcModel: string;
  provider?: LlmTextProviderId;
  geminiModelId?: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  mediaInputs?: LlmMediaInput[];
  imageUrls?: string[];
}): Promise<{ content: string; usage?: { total_tokens?: number } }> {
  const provider = params.provider ?? 'openai';
  if (provider === 'claude') {
    throw new Error('Claude provider cannot use generateLlmText — use streamClaudeTurn() from claude-agent-stream instead.');
  }
  if (provider === 'gemini') {
    const mm = resolveV2GeminiConfig(params.config);
    const providerRecord = getLlmProviderRecord(params.config, provider);
    if (isKieApiUrl(mm.apiUrl) && providerRecord) {
      const model = resolveKieGeminiModel(providerRecord, params.geminiModelId);
      const llm = createLLMAPI(mm.apiKey, mm.apiUrl, providerRecord);
      const r = await llm.generate({
        prompt: params.prompt,
        model,
        systemPrompt: params.systemPrompt,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        mediaInputs: params.mediaInputs,
        imageUrls: params.imageUrls,
      });
      return {
        content: r.content,
        usage: r.usage?.total_tokens != null ? { total_tokens: r.usage.total_tokens } : undefined,
      };
    }
    const gem = createGeminiMultimodalAPI(mm.apiKey, mm.apiUrl);
    const model = (params.geminiModelId || params.config.multimodalApi.model || 'gemini-2.5-pro').trim();
    const r = await gem.generate({
      prompt: params.prompt,
      model,
      systemPrompt: params.systemPrompt,
      temperature: params.temperature,
      maxOutputTokens: params.maxTokens,
      mediaInputs: params.mediaInputs,
      imageUrls: params.imageUrls,
    });
    const total =
      r.usage?.total_tokens ??
      (typeof r.usage?.prompt_tokens === 'number' || typeof r.usage?.completion_tokens === 'number'
        ? (r.usage?.prompt_tokens ?? 0) + (r.usage?.completion_tokens ?? 0)
        : undefined);
    return {
      content: r.content,
      usage: total != null ? { total_tokens: total } : undefined,
    };
  }

  const llmConfig = resolveV2LlmConfig(params.config, provider);
  const providerRecord = getLlmProviderRecord(params.config, provider);
  const llm = createLLMAPI(llmConfig.apiKey, llmConfig.apiUrl, providerRecord);
  const r = await llm.generate({
    prompt: params.prompt,
    model: params.volcModel,
    systemPrompt: params.systemPrompt,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    mediaInputs: params.mediaInputs,
    imageUrls: params.imageUrls,
  });
  return {
    content: r.content,
    usage: r.usage?.total_tokens != null ? { total_tokens: r.usage.total_tokens } : undefined,
  };
}

export type { LlmStreamPart };

export async function* streamLlmTextParts(params: {
  config: SeedanceConfig;
  volcModel: string;
  provider?: LlmTextProviderId;
  geminiModelId?: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  mediaInputs?: LlmMediaInput[];
  imageUrls?: string[];
  signal?: AbortSignal;
}): AsyncGenerator<LlmStreamPart> {
  const provider = params.provider ?? 'openai';
  if (provider === 'claude') {
    throw new Error('Claude provider cannot use streamLlmTextParts — use streamClaudeTurn() from claude-agent-stream instead.');
  }
  if (provider === 'gemini') {
    const mm = resolveV2GeminiConfig(params.config);
    const providerRecord = getLlmProviderRecord(params.config, provider);
    if (isKieApiUrl(mm.apiUrl) && providerRecord) {
      const model = resolveKieGeminiModel(providerRecord, params.geminiModelId);
      const llm = createLLMAPI(mm.apiKey, mm.apiUrl, providerRecord);
      yield* llm.generateStream({
        prompt: params.prompt,
        model,
        systemPrompt: params.systemPrompt,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        jsonMode: params.jsonMode,
        mediaInputs: params.mediaInputs,
        imageUrls: params.imageUrls,
        signal: params.signal,
      });
      return;
    }
    const gem = createGeminiMultimodalAPI(mm.apiKey, mm.apiUrl);
    const model = (params.geminiModelId || params.config.multimodalApi.model || 'gemini-2.5-pro').trim();
    for await (const chunk of gem.streamGenerate({
      prompt: params.prompt,
      model,
      systemPrompt: params.systemPrompt,
      temperature: params.temperature,
      maxOutputTokens: params.maxTokens,
      mediaInputs: params.mediaInputs,
      imageUrls: params.imageUrls,
      signal: params.signal,
    })) {
      yield { kind: 'content', text: chunk };
    }
    return;
  }

  const llmConfig = resolveV2LlmConfig(params.config, provider);
  const providerRecord = getLlmProviderRecord(params.config, provider);
  const llm = createLLMAPI(llmConfig.apiKey, llmConfig.apiUrl, providerRecord);
  yield* llm.generateStream({
    prompt: params.prompt,
    model: params.volcModel,
    systemPrompt: params.systemPrompt,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    jsonMode: params.jsonMode,
    mediaInputs: params.mediaInputs,
    imageUrls: params.imageUrls,
    signal: params.signal,
  });
}

export async function* streamLlmText(params: {
  config: SeedanceConfig;
  volcModel: string;
  provider?: LlmTextProviderId;
  geminiModelId?: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  mediaInputs?: LlmMediaInput[];
  imageUrls?: string[];
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  for await (const part of streamLlmTextParts(params)) {
    if (part.kind === 'content') yield part.text;
  }
}
