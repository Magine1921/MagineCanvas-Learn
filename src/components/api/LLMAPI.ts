// 澶ц瑷€妯″瀷 API 妯″潡锛氱伀灞辨柟鑸?OpenAI-compatible Chat Completions

import type { ProviderConfig } from '@/components/seedance/SeedanceStore';
import { buildProxyHeaders, getProxyUrl as getProxyUrlForProvider } from './APIFactory';
import {
  getEffectiveApiProfile,
  hostnameFromUrl,
  resolveProviderApiBase,
  resolveProviderEndpoint,
} from '@/lib/provider-api-profile';
import { customProviderFetch } from '@/lib/custom-provider-request';
import {
  extractChatCompletionText,
  responseLooksLikeEventStream,
  yieldLlmPartsFromText,
} from '@/lib/llm-stream-parse';
import {
  mergeLlmMediaInputs,
  type LlmMediaInput,
} from '@/lib/llm-media-input';
import { structuredOutputRequestOptions } from '@/lib/llm-structured-output';
import { normalizeLlmModelForProvider } from '@/lib/llm-provider-model';

export type LlmStreamPart = { kind: 'reasoning' | 'content'; text: string };

export interface LLMGenerateResponse {
  content: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
}

interface ChatCompletionResponse {
  model?: string;
  usage?: LLMGenerateResponse['usage'];
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
    };
    delta?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
}

const MODEL_ALIASES: Record<string, string> = {
  'deepseekv3.2': 'deepseek-v4-flash',
  'deepseek-v3.2': 'deepseek-v4-flash',
  'deepseek-v3-2': 'deepseek-v4-flash',
  'deepseek-v3-2-251201': 'deepseek-v4-flash',
  'DeepSeek V3.2': 'deepseek-v4-flash',
  'deepseekv4.flash': 'deepseek-v4-flash',
  'deepseekv4.pro': 'deepseek-v4-pro',
};

const KIE_CHAT_MODEL_PATHS: Record<string, string> = {
  'gpt-5-2': 'gpt-5-2',
  'gemini-2.5-pro': 'gemini-2.5-pro',
  'gemini-3-pro': 'gemini-3-pro',
  'gemini-3.1-pro': 'gemini-3.1-pro',
  'gemini-3-flash': 'gemini-3-flash',
  'gemini-3.5-flash': 'gemini-3-5-flash',
  'gemini-3.5-flash-openai': 'gemini-3-5-flash-openai',
  'gemini-2.5-flash': 'gemini-2.5-flash',
};

const KIE_CHAT_MODEL_ALIASES: Record<string, string> = {
  'gemini-3.5-flash': 'gemini-3.5-flash-openai',
};

const KIE_RESPONSES_MODELS = new Set(['gpt-5-4', 'gpt-5-5']);

function normalizeModel(model?: string): string {
  const trimmed = model?.trim() || 'deepseek-v4-flash';
  return MODEL_ALIASES[trimmed] || trimmed;
}

function normalizeKieChatModel(model?: string): string {
  const normalized = normalizeModel(model);
  if (KIE_CHAT_MODEL_ALIASES[normalized]) return KIE_CHAT_MODEL_ALIASES[normalized];
  if (KIE_CHAT_MODEL_PATHS[normalized]) return normalized;
  if (normalized.toLowerCase().startsWith('gemini-')) return 'gemini-2.5-pro';
  return 'gpt-5-2';
}

function normalizeKieResponsesModel(model?: string): string | null {
  const normalized = normalizeModel(model);
  return KIE_RESPONSES_MODELS.has(normalized) ? normalized : null;
}

function resolveKieChatEndpoint(apiUrl: string, model?: string): string | null {
  const raw = (apiUrl || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.hostname.toLowerCase() !== 'api.kie.ai') return null;
    if (normalizeKieResponsesModel(model)) return null;
    const modelPath = KIE_CHAT_MODEL_PATHS[normalizeKieChatModel(model)];
    if (modelPath) return `${url.origin}/${modelPath}/v1/chat/completions`;
    if (/\/[^/]+\/v1$/i.test(url.pathname)) return `${raw}/chat/completions`;
    return `${url.origin}/gpt-5-2/v1/chat/completions`;
  } catch {
    return null;
  }
}

function resolveKieResponsesEndpoint(apiUrl: string): string | null {
  const raw = (apiUrl || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.hostname.toLowerCase() !== 'api.kie.ai') return null;
    return `${url.origin}/codex/v1/responses`;
  } catch {
    return null;
  }
}

function bindAbortToReader(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal): () => void {
  if (!signal) return () => {};
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal.aborted) {
    cancelReader();
    return () => {};
  }
  signal.addEventListener('abort', cancelReader, { once: true });
  return () => signal.removeEventListener('abort', cancelReader);
}

type VisionContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

function buildUserMessageContent(
  prompt: string,
  imageUrls?: string[],
  mediaInputs?: LlmMediaInput[],
): string | VisionContentPart[] {
  const media = mergeLlmMediaInputs(mediaInputs, imageUrls);
  if (!media.length) return prompt;
  return [
    { type: 'text', text: prompt },
    ...media.map((item) => ({ type: 'image_url' as const, image_url: { url: item.url } })),
  ];
}

function buildKieResponsesInput(
  prompt: string,
  systemPrompt?: string,
  imageUrls?: string[],
  mediaInputs?: LlmMediaInput[],
): Array<{ role: string; content: Array<Record<string, string>> }> {
  const result: Array<{ role: string; content: Array<Record<string, string>> }> = [];
  if (systemPrompt) {
    result.push({ role: 'system', content: [{ type: 'input_text', text: systemPrompt }] });
  }
  const content: Array<Record<string, string>> = [{ type: 'input_text', text: prompt }];
  for (const item of mergeLlmMediaInputs(mediaInputs, imageUrls)) {
    if (item.kind === 'image') content.push({ type: 'input_image', image_url: item.url });
  }
  result.push({ role: 'user', content });
  return result;
}

function normalizeApiV3Base(apiUrl: string): string {
  const trimmed = (apiUrl || 'https://ark.cn-beijing.volces.com').replace(/\/+$/, '');
  // 鍙鐏北寮曟搸API娣诲姞/api/v3
  const url = new URL(trimmed);
  if (url.hostname.toLowerCase().endsWith('.volces.com') || url.hostname.toLowerCase().endsWith('.volcengineapi.com')) {
    return trimmed.endsWith('/api/v3') ? trimmed : `${trimmed}/api/v3`;
  }
  // 鍏朵粬API淇濇寔鍘熸牱
  return trimmed;
}

function getErrorMessage(status: number, body: string): string {
  if (status === 502) {
    try {
      const payload = JSON.parse(body) as { error?: unknown; message?: unknown };
      if (payload.error === 'Proxy error') {
        const detail = typeof payload.message === 'string' ? payload.message.trim() : '';
        return `本地代理与上游 LLM 连接中断${detail ? `（${detail}）` : ''}。请检查 API 地址、代理/VPN 和网络连接后重试。`;
      }
    } catch {
      // Keep the original response body when the proxy did not return JSON.
    }
  }
  if (status === 404) {
    return 'LLM API endpoint was not found. Check the configured API base URL.';
  }
  if (status === 401 || status === 403) {
    return 'Authentication failed or permission denied. Check the LLM API key and model access.';
  }
  return body || `HTTP ${status}`;
}

export class LLMAPI {
  private apiKey: string;
  private apiUrl: string;
  private providerConfig?: ProviderConfig;

  constructor(
    apiKey: string,
    apiUrl: string = 'https://ark.cn-beijing.volces.com',
    providerConfig?: ProviderConfig,
  ) {
    this.apiKey = apiKey;
    this.providerConfig = providerConfig;
    if (providerConfig) {
      const preset = getEffectiveApiProfile(providerConfig, 'llm').preset || 'openai-root-v1';
      this.apiUrl = resolveProviderApiBase(apiUrl, preset);
    } else {
      this.apiUrl = normalizeApiV3Base(apiUrl);
    }
  }

  private getChatEndpoint(model?: string): string {
    const kieEndpoint = resolveKieChatEndpoint(this.apiUrl, model);
    if (kieEndpoint) return kieEndpoint;
    if (this.providerConfig) {
      return resolveProviderEndpoint(this.providerConfig, 'llm', 'chat');
    }
    return `${this.apiUrl}/chat/completions`;
  }

  private isKieApi(): boolean {
    try {
      return new URL(this.apiUrl).hostname.toLowerCase() === 'api.kie.ai';
    } catch {
      return false;
    }
  }

  private getProxyHeaders(targetUrl: string, streaming = false): HeadersInit {
    if (this.providerConfig) {
      return buildProxyHeaders(this.providerConfig, targetUrl, { streaming });
    }
    return {
      'Content-Type': 'application/json',
      ...(streaming ? { Accept: 'text/event-stream' } : {}),
      'X-Target-URL': targetUrl,
      'X-API-Key': this.apiKey,
    };
  }

  private getProxyUrl(): string {
    if (this.providerConfig) {
      return getProxyUrlForProvider(this.providerConfig);
    }
    const hostname = hostnameFromUrl(this.apiUrl);
    if (hostname.endsWith('.volces.com') || hostname.endsWith('.volcengineapi.com')) {
      return '/api/proxy/volcengine';
    }
    return '/api/proxy/openai';
  }

  private isMiniMaxBody(): boolean {
    if (this.providerConfig?.apiProfile?.llmBodyStyle === 'minimax') return true;
    return hostnameFromUrl(this.apiUrl).includes('minimaxi.com');
  }

  private async postChatCompletions(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const targetUrl = this.getChatEndpoint(typeof body.model === 'string' ? body.model : undefined);
    const streaming = body.stream === true;
    if (this.providerConfig) {
      return customProviderFetch(this.providerConfig, {
        targetUrl,
        method: 'POST',
        body,
        streaming,
        signal,
      });
    }
    return fetch(this.getProxyUrl(), {
      method: 'POST',
      headers: this.getProxyHeaders(targetUrl, streaming),
      body: JSON.stringify(body),
      cache: 'no-store',
      priority: 'high',
      signal,
    } as RequestInit);
  }

  private async postKieResponses(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const targetUrl = resolveKieResponsesEndpoint(this.apiUrl);
    if (!targetUrl) throw new Error('Kie Responses endpoint is not available for this provider');
    const streaming = body.stream === true;
    if (this.providerConfig) {
      return customProviderFetch(this.providerConfig, {
        targetUrl,
        method: 'POST',
        body,
        streaming,
        signal,
      });
    }
    return fetch(this.getProxyUrl(), {
      method: 'POST',
      headers: this.getProxyHeaders(targetUrl, streaming),
      body: JSON.stringify(body),
      cache: 'no-store',
      priority: 'high',
      signal,
    } as RequestInit);
  }

  private async generateKieResponse(params: {
    prompt: string;
    model?: string;
    systemPrompt?: string;
    imageUrls?: string[];
    mediaInputs?: LlmMediaInput[];
  }): Promise<LLMGenerateResponse> {
    const model = normalizeKieResponsesModel(params.model) || 'gpt-5-4';
    const request = {
      model,
      stream: false,
      input: buildKieResponsesInput(params.prompt, params.systemPrompt, params.imageUrls, params.mediaInputs),
      reasoning: { effort: 'low' },
    };

    const response = await this.postKieResponses(request);
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`LLM Responses 生成失败: ${response.status} - ${getErrorMessage(response.status, responseText)}`);
    }

    const payload = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : {};
    const { content, reasoning } = extractChatCompletionText(payload as ChatCompletionResponse);
    const usage = payload.usage && typeof payload.usage === 'object'
      ? payload.usage as Record<string, number>
      : undefined;
    return {
      content: content || reasoning,
      usage: usage
        ? {
            prompt_tokens: usage.input_tokens,
            completion_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens,
          }
        : undefined,
      model: typeof payload.model === 'string' ? payload.model : model,
    };
  }

  private async *generateKieResponseStream(params: {
    prompt: string;
    model?: string;
    systemPrompt?: string;
    imageUrls?: string[];
    mediaInputs?: LlmMediaInput[];
    signal?: AbortSignal;
  }): AsyncGenerator<LlmStreamPart> {
    const model = normalizeKieResponsesModel(params.model) || 'gpt-5-4';
    const request = {
      model,
      stream: true,
      input: buildKieResponsesInput(params.prompt, params.systemPrompt, params.imageUrls, params.mediaInputs),
      reasoning: { effort: 'low' },
    };

    const response = await this.postKieResponses(request, params.signal);
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM Responses 流式生成失败: ${response.status} - ${getErrorMessage(response.status, error)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!responseLooksLikeEventStream(contentType)) {
      const raw = await response.text();
      try {
        const parsed = JSON.parse(raw) as ChatCompletionResponse;
        const { content, reasoning } = extractChatCompletionText(parsed);
        yield* yieldLlmPartsFromText(content, reasoning);
      } catch {
        throw new Error(`LLM Responses 响应解析失败: ${raw.slice(0, 400)}`);
      }
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Unable to read response stream');

    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    let emittedContent = false;
    const unbindAbort = bindAbortToReader(reader, params.signal);

    try {
    while (true) {
      if (params.signal?.aborted) return;
      const { done, value } = await reader.read();
      if (params.signal?.aborted) return;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('event:')) {
          eventType = trimmed.slice(6).trim();
          continue;
        }
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const type = String(parsed.type || eventType || '');
          const delta = typeof parsed.delta === 'string' ? parsed.delta : '';
          if (delta && type.includes('output_text')) {
            emittedContent = true;
            yield { kind: 'content', text: delta };
          } else if (delta && type.includes('reasoning')) {
            yield { kind: 'reasoning', text: delta };
          } else if (!emittedContent && type === 'response.completed') {
            const responsePayload = parsed.response as ChatCompletionResponse | undefined;
            if (responsePayload) {
              const { content, reasoning } = extractChatCompletionText(responsePayload);
              yield* yieldLlmPartsFromText(content, reasoning);
            }
          }
        } catch {
          // Ignore partial or non-JSON SSE chunks.
        }
      }
    }
    } finally {
      unbindAbort();
    }
  }

  async generate(params: {
    prompt: string;
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    /** data:image/鈥?base64,鈥?鎴?https 鍏綉鍥?URL锛岄渶浣跨敤宸插紑閫氱殑澶氭ā鎬?Endpoint */
    imageUrls?: string[];
    mediaInputs?: LlmMediaInput[];
  }): Promise<LLMGenerateResponse> {
    if (this.isKieApi() && normalizeKieResponsesModel(params.model)) {
      return this.generateKieResponse(params);
    }

    const userContent = buildUserMessageContent(params.prompt, params.imageUrls, params.mediaInputs);
    const isMiniMax = this.isMiniMaxBody();
    
    const messages = [
      params.systemPrompt
        ? {
            role: 'system',
            content: params.systemPrompt,
          }
        : null,
      {
        role: 'user',
        content: userContent,
      },
    ].filter(Boolean);

    // MiniMax浣跨敤max_completion_tokens锛屽叾浠朅PI浣跨敤max_tokens
    // MiniMax鐨刴ax_completion_tokens涓婇檺鏄?048
    const maxTokensValue = isMiniMax 
      ? Math.min(params.maxTokens ?? 2048, 2048)
      : (params.maxTokens ?? 2048);

    const request = {
      model: this.isKieApi()
        ? normalizeKieChatModel(params.model)
        : normalizeLlmModelForProvider(
            normalizeModel(params.model),
            this.apiUrl,
            this.providerConfig?.authType,
          ),
      messages,
      stream: false,
      ...(isMiniMax 
        ? { max_completion_tokens: maxTokensValue }
        : { max_tokens: maxTokensValue }
      ),
      ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
    };

    const response = await this.postChatCompletions(request);

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`LLM 生成失败: ${response.status} - ${getErrorMessage(response.status, responseText)}`);
    }

    const payload = responseText ? (JSON.parse(responseText) as ChatCompletionResponse) : {};
    const content =
      payload.choices?.[0]?.message?.content ||
      payload.choices?.[0]?.message?.reasoning_content ||
      '';

    return {
      content,
      usage: payload.usage,
      model: payload.model,
    };
  }

  async *generateStream(params: {
    prompt: string;
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
    imageUrls?: string[];
    mediaInputs?: LlmMediaInput[];
    signal?: AbortSignal;
  }): AsyncGenerator<LlmStreamPart> {
    if (this.isKieApi() && normalizeKieResponsesModel(params.model)) {
      yield* this.generateKieResponseStream(params);
      return;
    }

    const userContent = buildUserMessageContent(params.prompt, params.imageUrls, params.mediaInputs);
    const isMiniMax = this.isMiniMaxBody();
    
    const messages = [
      params.systemPrompt
        ? {
            role: 'system',
            content: params.systemPrompt,
          }
        : null,
      {
        role: 'user',
        content: userContent,
      },
    ].filter(Boolean);

    // MiniMax浣跨敤max_completion_tokens锛屽叾浠朅PI浣跨敤max_tokens
    // MiniMax鐨刴ax_completion_tokens涓婇檺鏄?048
    const maxTokensValue = isMiniMax 
      ? Math.min(params.maxTokens ?? 2048, 2048)
      : (params.maxTokens ?? 2048);

    const request = {
      model: this.isKieApi()
        ? normalizeKieChatModel(params.model)
        : normalizeLlmModelForProvider(
            normalizeModel(params.model),
            this.apiUrl,
            this.providerConfig?.authType,
          ),
      messages,
      stream: true,
      ...(isMiniMax 
        ? { max_completion_tokens: maxTokensValue }
        : { max_tokens: maxTokensValue }
      ),
      ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
      ...structuredOutputRequestOptions(this.apiUrl, params.jsonMode),
    };

    const response = await this.postChatCompletions(request, params.signal);

    if (!response.ok) {
      const error = await response.text();
      const detail = getErrorMessage(response.status, error);
      console.error(
        `[LLMAPI] generateStream FAILED\n` +
        `  status: ${response.status}\n` +
        `  targetUrl: ${this.getChatEndpoint(request.model)}\n` +
        `  proxyUrl: ${this.getProxyUrl()}\n` +
        `  model: ${request.model}\n` +
        `  responseBody: ${error.slice(0, 500)}`
      );
      throw new Error(`LLM 流式生成失败: ${response.status} - ${detail}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!responseLooksLikeEventStream(contentType)) {
      const raw = await response.text();
      try {
        const parsed = JSON.parse(raw) as ChatCompletionResponse;
        const { content, reasoning } = extractChatCompletionText(parsed);
        yield* yieldLlmPartsFromText(content, reasoning);
      } catch {
        throw new Error(`LLM 流式响应解析失败: ${raw.slice(0, 400)}`);
      }
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Unable to read response stream');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let emittedContentText = '';
    let emittedReasoningText = '';
    const unbindAbort = bindAbortToReader(reader, params.signal);

    const rememberDelta = (kind: LlmStreamPart['kind'], text: string) => {
      if (!text) return;
      if (kind === 'content') emittedContentText += text;
      else emittedReasoningText += text;
    };

    const getFreshFullText = (kind: LlmStreamPart['kind'], text: string): string => {
      if (!text) return '';
      const previous = kind === 'content' ? emittedContentText : emittedReasoningText;
      if (text.startsWith(previous)) {
        const fresh = text.slice(previous.length);
        if (kind === 'content') emittedContentText = text;
        else emittedReasoningText = text;
        return fresh;
      }
      if (previous.includes(text)) return '';
      if (kind === 'content') emittedContentText += text;
      else emittedReasoningText += text;
      return text;
    };

    try {
      while (true) {
        if (params.signal?.aborted) return;
        const { done, value } = await reader.read();
        if (params.signal?.aborted) return;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) continue;

          const data = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data) as ChatCompletionResponse;
            const delta = parsed.choices?.[0]?.delta;
            let emittedChoiceDelta = false;
            if (delta?.reasoning_content) {
              rememberDelta('reasoning', delta.reasoning_content);
              yield { kind: 'reasoning', text: delta.reasoning_content };
              emittedChoiceDelta = true;
            }
            if (delta?.content) {
              rememberDelta('content', delta.content);
              yield { kind: 'content', text: delta.content };
              emittedChoiceDelta = true;
            }
            if (!emittedChoiceDelta) {
              const { content, reasoning } = extractChatCompletionText(parsed);
              const reasoningFresh = getFreshFullText('reasoning', reasoning);
              if (reasoningFresh) yield { kind: 'reasoning', text: reasoningFresh };
              const contentFresh = getFreshFullText('content', content);
              if (contentFresh) yield { kind: 'content', text: contentFresh };
            }
          } catch {
            // Ignore partial or non-JSON SSE chunks.
          }
        }
      }
    } catch (error) {
      if (params.signal?.aborted) return;
      const message = error instanceof Error ? error.message : String(error || '未知错误');
      if (/terminated|fetch failed|network|socket|ECONN|ETIMEDOUT|UND_ERR/i.test(message)) {
        throw new Error(`LLM 流式连接中断：${message}。请检查 API 地址、代理/VPN 和网络连接后重试。`);
      }
      throw error;
    } finally {
      unbindAbort();
    }
  }
}

export function createLLMAPI(
  apiKey: string,
  apiUrl?: string,
  providerConfig?: ProviderConfig,
): LLMAPI {
  if (!apiKey) {
    throw new Error('请先配置 API Key');
  }
  return new LLMAPI(apiKey, apiUrl, providerConfig);
}
