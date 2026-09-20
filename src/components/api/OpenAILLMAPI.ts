'use client';

import type { ProviderConfig } from '@/components/seedance/SeedanceStore';
import { buildProxyHeaders, getProxyUrl } from './APIFactory';
import { normalizeLlmModelForProvider } from '@/lib/llm-provider-model';

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIChatCompletionParams {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

export function createOpenAILLMAPI(providerConfig: ProviderConfig) {
  const { apiKey, apiUrl } = providerConfig;
  const proxyUrl = getProxyUrl(providerConfig);

  async function* streamChatCompletion(
    params: OpenAIChatCompletionParams,
    signal?: AbortSignal,
  ): AsyncGenerator<{ text: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
    const targetUrl = `${apiUrl.replace(/\/+$/, '')}/v1/chat/completions`;
    const headers = buildProxyHeaders(providerConfig, targetUrl);

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: normalizeLlmModelForProvider(params.model, apiUrl, providerConfig.authType),
        messages: params.messages,
        max_tokens: params.max_tokens ?? 4096,
        temperature: params.temperature ?? 0.7,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 500)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) {
            yield { text: delta.content };
          }
          if (json.usage) {
            yield { text: '', usage: json.usage };
          }
        } catch { /* skip malformed chunks */ }
      }
    }
  }

  return { streamChatCompletion };
}
