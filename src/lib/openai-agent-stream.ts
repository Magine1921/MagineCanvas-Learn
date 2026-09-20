// OpenAI-compatible streaming with native tool-call support
// Works with Volcengine / DeepSeek / OpenAI / MiniMax / Gemini(OpenAI mode)

import {
  extractChatCompletionText,
  responseLooksLikeEventStream,
  yieldTextDeltas,
} from '@/lib/llm-stream-parse';
import { extractCompletedAgentToolUses } from '@/lib/agent-tool-protocol';
import { extractKieResponsesFailure } from '@/lib/kie-responses-events';
import { normalizeLlmModelForProvider } from '@/lib/llm-provider-model';
import {
  isUnsupportedToolChoiceError,
  resolveAgentModelCapabilities,
} from '@/lib/agent-model-capabilities';

export interface OpenAIToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type OpenAIAgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_use'; tool: OpenAIToolUse }
  | { type: 'stop'; stopReason: string }
  | { type: 'error'; message: string };

export interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type OpenAIToolChoice =
  | 'auto'
  | 'none'
  | { type: 'function'; function: { name: string } };

interface OpenAIAgentTurnParams {
  apiKey: string;
  apiUrl: string;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: string | null; reasoning_content?: string; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>; tool_call_id?: string }>;
  tools: OpenAIToolDef[];
  toolChoice?: OpenAIToolChoice;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

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

function normalizeKieChatApiUrl(origin: string, model: string): string {
  const modelPath = KIE_CHAT_MODEL_PATHS[normalizeKieModel(model)] || 'gpt-5-2';
  return `${origin}/${modelPath}/v1`;
}

function normalizeKieModel(model: string): string {
  const trimmed = model.trim();
  if (KIE_CHAT_MODEL_ALIASES[trimmed]) return KIE_CHAT_MODEL_ALIASES[trimmed];
  if (KIE_CHAT_MODEL_PATHS[trimmed]) return trimmed;
  throw new Error(`Kie Agent 暂不支持模型“${trimmed || '(空)'}”，请在模型列表中选择已接入的模型`);
}

function normalizeKieResponsesModel(model: string): string | null {
  const trimmed = model.trim();
  return KIE_RESPONSES_MODELS.has(trimmed) ? trimmed : null;
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

const RETRYABLE_AGENT_HTTP_STATUS = new Set([429, 502, 503, 504]);

function waitForAgentRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, delayMs);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function fetchAgentResponse(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, init);
      if (!RETRYABLE_AGENT_HTTP_STATUS.has(response.status) || attempt === 2) {
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      lastError = error;
      if (attempt === 2) throw error;
    }
    await waitForAgentRetry(attempt === 0 ? 450 : 1_100, signal);
  }
  throw lastError instanceof Error ? lastError : new Error('fetch failed');
}

function normalizeAgentApiUrl(apiUrl: string, model: string): { normalizedUrl: string; proxyPath: string; authHeaderKey: string } {
  const trimmed = (apiUrl || 'https://ark.cn-beijing.volces.com').replace(/\/+$/, '');
  const url = new URL(trimmed);
  const hostname = url.hostname.toLowerCase();

  if (hostname === 'api.kie.ai') {
    if (/\/[^/]+\/v1$/i.test(url.pathname)) {
      return { normalizedUrl: trimmed, proxyPath: '/api/proxy/openai', authHeaderKey: 'X-API-Key' };
    }
    return { normalizedUrl: normalizeKieChatApiUrl(url.origin, model), proxyPath: '/api/proxy/openai', authHeaderKey: 'X-API-Key' };
  }

  // Volcengine
  if (hostname.endsWith('.volces.com') || hostname.endsWith('.volcengineapi.com')) {
    const normalizedUrl = trimmed.endsWith('/api/v3') ? trimmed : `${trimmed}/api/v3`;
    return { normalizedUrl, proxyPath: '/api/proxy/volcengine', authHeaderKey: 'X-API-Key' };
  }

  // Native Gemini API → convert to OpenAI-compatible /v1beta/openai
  if (hostname === 'generativelanguage.googleapis.com') {
    const base = trimmed.replace(/\/v1beta$/, '');
    return { normalizedUrl: `${base}/v1beta/openai`, proxyPath: '/api/proxy/gemini', authHeaderKey: 'X-Goog-Api-Key' };
  }

  // Shiyun native /v1beta → convert to /v1 for OpenAI-compatible
  if (hostname === 'shiyunapi.com' && url.pathname.startsWith('/v1beta') && !url.pathname.includes('/openai')) {
    const base = trimmed.replace(/\/v1beta.*/, '');
    return { normalizedUrl: `${base}/v1`, proxyPath: '/api/proxy/openai', authHeaderKey: 'X-API-Key' };
  }

  // Default: OpenAI-compatible
  return { normalizedUrl: trimmed, proxyPath: '/api/proxy/openai', authHeaderKey: 'X-API-Key' };
}

function buildKieResponsesInput(params: OpenAIAgentTurnParams): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  if (params.systemPrompt) {
    input.push({ role: 'system', content: [{ type: 'input_text', text: params.systemPrompt }] });
  }
  for (const message of params.messages) {
    if (message.tool_calls) {
      if (message.content) {
        input.push({
          role: message.role,
          content: [{ type: 'output_text', text: message.content }],
        });
      }
      for (const call of message.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
      continue;
    }
    if (message.role === 'tool' && message.tool_call_id) {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: message.content || '',
      });
      continue;
    }
    if (!message.content) continue;
    input.push({
      role: message.role,
      content: [
        {
          type: message.role === 'assistant' ? 'output_text' : 'input_text',
          text: message.content,
        },
      ],
    });
  }
  return input.length ? input : [{ role: 'user', content: [{ type: 'input_text', text: '' }] }];
}

function convertToolsForKieResponses(tools: OpenAIToolDef[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
}

async function* streamKieResponsesAgentTurn(params: OpenAIAgentTurnParams, origin: string, model: string): AsyncGenerator<OpenAIAgentEvent> {
  const responseTools = convertToolsForKieResponses(params.tools);
  const useStream = params.stream !== false;
  const body: Record<string, unknown> = {
    model,
    stream: useStream,
    input: buildKieResponsesInput(params),
    reasoning: { effort: 'low' },
  };
  if (responseTools.length > 0) {
    body.tools = responseTools;
    body.tool_choice = typeof params.toolChoice === 'object'
      ? { type: 'function', name: params.toolChoice.function.name }
      : (params.toolChoice || 'auto');
  }

  try {
    const sendRequest = () => fetchAgentResponse('/api/proxy/openai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: useStream ? 'text/event-stream' : 'application/json',
        'X-Target-URL': `${origin}/codex/v1/responses`,
        'X-API-Key': params.apiKey,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: params.signal,
    }, params.signal);

    let response = await sendRequest();
    if (!response.ok && body.tool_choice) {
      const errorText = await response.text().catch(() => '');
      if (
        isUnsupportedToolChoiceError(response.status, errorText)
        || /thinking mode does not support this tool_choice/iu.test(errorText)
      ) {
        delete body.tool_choice;
        response = await sendRequest();
      } else {
        yield { type: 'error', message: `HTTP ${response.status}: ${errorText || 'API request failed'}` };
        return;
      }
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      yield { type: 'error', message: `HTTP ${response.status}: ${errText || 'API 请求失败'}` };
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!responseLooksLikeEventStream(contentType)) {
      const raw = await response.text();
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const failure = extractKieResponsesFailure(parsed);
        if (failure) {
          yield { type: 'error', message: failure };
          return;
        }
        const { content, reasoning } = extractChatCompletionText(parsed);
        for await (const part of yieldTextDeltas(reasoning)) yield { type: 'reasoning_delta', text: part.text };
        for await (const part of yieldTextDeltas(content)) yield { type: 'text_delta', text: part.text };
        for (const tool of extractCompletedAgentToolUses(parsed)) {
          yield { type: 'tool_use', tool };
        }
        yield { type: 'stop', stopReason: 'stop' };
      } catch {
        yield { type: 'error', message: `Response parse failed: ${raw.slice(0, 400)}` };
      }
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', message: 'Unable to read response stream' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    let finishReason = 'stop';
    let emittedText = false;
    const toolCalls = new Map<string, { id: string; name: string; arguments: string }>();
    const unbindAbort = bindAbortToReader(reader, params.signal);

    try {
    while (true) {
      if (params.signal?.aborted) {
        yield { type: 'stop', stopReason: 'aborted' };
        return;
      }
      const { done, value } = await reader.read();
      if (params.signal?.aborted) {
        yield { type: 'stop', stopReason: 'aborted' };
        return;
      }
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
        if (data === '[DONE]') {
          if (!emittedText && toolCalls.size === 0) {
            yield {
              type: 'error',
              message: 'Kie Responses 返回了空结果：没有文本，也没有工具调用',
            };
            return;
          }
          for (const [, tc] of toolCalls) {
            let input: Record<string, unknown> = {};
            try { input = JSON.parse(tc.arguments || '{}'); } catch { /* keep empty */ }
            yield { type: 'tool_use', tool: { id: tc.id, name: tc.name, input } };
          }
          yield { type: 'stop', stopReason: finishReason };
          return;
        }

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const type = String(parsed.type || eventType || '');
          const failure = extractKieResponsesFailure(parsed, eventType);
          if (failure) {
            yield { type: 'error', message: failure };
            return;
          }
          const delta = typeof parsed.delta === 'string' ? parsed.delta : '';
          if (delta && type.includes('output_text')) {
            emittedText = true;
            yield { type: 'text_delta', text: delta };
          } else if (delta && type.includes('reasoning')) {
            yield { type: 'reasoning_delta', text: delta };
          } else if (type.includes('function_call_arguments')) {
            const key = String(parsed.item_id || parsed.output_index || '0');
            const current = toolCalls.get(key) || { id: key, name: '', arguments: '' };
            const completedArguments = typeof parsed.arguments === 'string' ? parsed.arguments : '';
            current.arguments = type.endsWith('.done') && completedArguments
              ? completedArguments
              : current.arguments + delta;
            if (typeof parsed.name === 'string' && parsed.name) current.name = parsed.name;
            toolCalls.set(key, current);
          } else if (type === 'response.output_item.added' || type === 'response.output_item.done') {
            const item = parsed.item as Record<string, unknown> | undefined;
            if (item?.type === 'function_call') {
              const key = String(item.id || item.call_id || parsed.output_index || toolCalls.size);
              toolCalls.set(key, {
                id: String(item.call_id || item.id || key),
                name: String(item.name || ''),
                arguments: String(item.arguments || toolCalls.get(key)?.arguments || ''),
              });
            }
          } else if (type === 'response.completed') {
            const responsePayload = parsed.response as Record<string, unknown> | undefined;
            if (responsePayload && !emittedText) {
              const { content, reasoning } = extractChatCompletionText(responsePayload);
              for await (const part of yieldTextDeltas(reasoning)) yield { type: 'reasoning_delta', text: part.text };
              for await (const part of yieldTextDeltas(content)) {
                emittedText = true;
                yield { type: 'text_delta', text: part.text };
              }
            }
            if (responsePayload) {
              for (const tool of extractCompletedAgentToolUses(responsePayload)) {
                const alreadyTracked = [...toolCalls.values()].some(
                  (current) => current.id === tool.id && current.name === tool.name,
                );
                if (!alreadyTracked) {
                  const key = tool.id || `completed-${toolCalls.size}`;
                  toolCalls.set(key, {
                    id: tool.id,
                    name: tool.name,
                    arguments: JSON.stringify(tool.input),
                  });
                }
              }
            }
            finishReason = 'stop';
          }
        } catch {
          /* skip malformed chunks */
        }
      }
    }
    } finally {
      unbindAbort();
    }
    if (!emittedText && toolCalls.size === 0) {
      yield {
        type: 'error',
        message: 'Kie Responses 返回了空结果：没有文本，也没有工具调用',
      };
      return;
    }
    for (const [, tc] of toolCalls) {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(tc.arguments || '{}'); } catch { /* keep empty */ }
      yield { type: 'tool_use', tool: { id: tc.id, name: tc.name, input } };
    }
    yield { type: 'stop', stopReason: finishReason };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      yield { type: 'stop', stopReason: 'aborted' };
      return;
    }
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function* streamOpenAIAgentTurn(params: OpenAIAgentTurnParams): AsyncGenerator<OpenAIAgentEvent> {
  const {
    apiKey,
    apiUrl,
    model,
    systemPrompt,
    messages,
    tools,
    toolChoice,
    stream = true,
    temperature,
    maxTokens,
    signal,
  } = params;

  const isKieApi = (() => {
    try {
      return new URL(apiUrl || '').hostname.toLowerCase() === 'api.kie.ai';
    } catch {
      return false;
    }
  })();
  const kieResponsesModel = isKieApi ? normalizeKieResponsesModel(model) : null;
  if (kieResponsesModel) {
    const origin = new URL((apiUrl || 'https://api.kie.ai').replace(/\/+$/, '')).origin;
    yield* streamKieResponsesAgentTurn(params, origin, kieResponsesModel);
    return;
  }
  const requestModel = isKieApi
    ? normalizeKieModel(model)
    : normalizeLlmModelForProvider(model, apiUrl);
  const { normalizedUrl, proxyPath, authHeaderKey } = normalizeAgentApiUrl(apiUrl, requestModel);
  const targetUrl = `${normalizedUrl}/chat/completions`;
  const modelCapabilities = resolveAgentModelCapabilities('', requestModel, apiUrl);

  const requestMessages: Array<Record<string, unknown>> = [];
  if (systemPrompt) {
    requestMessages.push({ role: 'system', content: systemPrompt });
  }
  for (const m of messages) {
    const entry: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.reasoning_content) {
      entry.reasoning_content = m.reasoning_content;
    }
    if (m.tool_calls) {
      entry.tool_calls = m.tool_calls;
      entry.content = m.content ?? null;
    }
    if (m.tool_call_id) {
      entry.tool_call_id = m.tool_call_id;
    }
    requestMessages.push(entry);
  }

  const body: Record<string, unknown> = {
    model: requestModel,
    messages: requestMessages,
    stream,
    max_tokens: maxTokens ?? 4096,
    ...(typeof temperature === 'number' ? { temperature } : {}),
  };

  if (tools.length > 0) {
    body.tools = tools;
    if (modelCapabilities.toolChoiceMode !== 'omit') {
      body.tool_choice = modelCapabilities.toolChoiceMode === 'auto-only'
        ? 'auto'
        : (toolChoice || 'auto');
    }
  }

  try {
    const sendRequest = () => fetchAgentResponse(proxyPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: stream ? 'text/event-stream' : 'application/json',
          'X-Target-URL': targetUrl,
          [authHeaderKey]: apiKey,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal,
      }, signal);

    let response = await sendRequest();
    let responseErrorText = '';
    if (!response.ok && body.tool_choice) {
      responseErrorText = await response.text().catch(() => '');
      if (isUnsupportedToolChoiceError(response.status, responseErrorText)) {
        delete body.tool_choice;
        response = await sendRequest();
        responseErrorText = '';
      }
    }

    if (!response.ok) {
      const errText = responseErrorText || await response.text().catch(() => '');
      let errorMsg = `API ${response.status}`;
      try {
        const err = JSON.parse(errText);
        errorMsg = err.error?.message || err.message || errorMsg;
      } catch { /* raw */ }
      yield { type: 'error', message: `HTTP ${response.status}: ${errorMsg}` };
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!responseLooksLikeEventStream(contentType)) {
      const raw = await response.text();
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const { content, reasoning } = extractChatCompletionText(parsed);
        for await (const part of yieldTextDeltas(reasoning)) {
          yield { type: 'reasoning_delta', text: part.text };
        }
        for await (const part of yieldTextDeltas(content)) {
          yield { type: 'text_delta', text: part.text };
        }
        for (const tool of extractCompletedAgentToolUses(parsed)) {
          yield { type: 'tool_use', tool };
        }
        yield { type: 'stop', stopReason: 'stop' };
      } catch {
        yield { type: 'error', message: `响应解析失败: ${raw.slice(0, 400)}` };
      }
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', message: '无法读取响应流' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason = '';
    let emittedContentText = '';
    let emittedReasoningText = '';
    const emittedCompletedToolKeys = new Set<string>();

    // Multiple tool calls can be in a single response, keyed by index
    const toolCallAccum: Map<number, { id: string; name: string; arguments: string }> = new Map();
    const unbindAbort = bindAbortToReader(reader, signal);

    const rememberDelta = (kind: 'text_delta' | 'reasoning_delta', text: string) => {
      if (!text) return;
      if (kind === 'text_delta') emittedContentText += text;
      else emittedReasoningText += text;
    };

    const getFreshFullText = (kind: 'text_delta' | 'reasoning_delta', text: string): string => {
      if (!text) return '';
      const previous = kind === 'text_delta' ? emittedContentText : emittedReasoningText;
      if (text.startsWith(previous)) {
        const fresh = text.slice(previous.length);
        if (kind === 'text_delta') emittedContentText = text;
        else emittedReasoningText = text;
        return fresh;
      }
      if (previous.includes(text)) return '';
      if (kind === 'text_delta') emittedContentText += text;
      else emittedReasoningText += text;
      return text;
    };

    try {
    while (true) {
      if (signal?.aborted) {
        yield { type: 'stop', stopReason: 'aborted' };
        return;
      }
      const { done, value } = await reader.read();
      if (signal?.aborted) {
        yield { type: 'stop', stopReason: 'aborted' };
        return;
      }
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) continue;
        const data = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
        if (data === '[DONE]') {
          // Emit accumulated tool calls before stop
          for (const [, tc] of toolCallAccum) {
            let input: Record<string, unknown> = {};
            try { input = JSON.parse(tc.arguments); } catch { /* emit with empty input */ }
            yield { type: 'tool_use', tool: { id: tc.id, name: tc.name, input } };
          }
          yield { type: 'stop', stopReason: finishReason || 'stop' };
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          if (!choice) {
            for (const tool of extractCompletedAgentToolUses(parsed)) {
              const key = `${tool.id}\u0000${tool.name}\u0000${JSON.stringify(tool.input)}`;
              if (!emittedCompletedToolKeys.has(key)) {
                emittedCompletedToolKeys.add(key);
                yield { type: 'tool_use', tool };
              }
            }
            const { content, reasoning } = extractChatCompletionText(parsed);
            const reasoningFresh = getFreshFullText('reasoning_delta', reasoning);
            if (reasoningFresh) yield { type: 'reasoning_delta', text: reasoningFresh };
            const contentFresh = getFreshFullText('text_delta', content);
            if (contentFresh) yield { type: 'text_delta', text: contentFresh };
            continue;
          }

          const delta = choice.delta;
          if (!delta) {
            for (const tool of extractCompletedAgentToolUses(parsed)) {
              const key = `${tool.id}\u0000${tool.name}\u0000${JSON.stringify(tool.input)}`;
              if (!emittedCompletedToolKeys.has(key)) {
                emittedCompletedToolKeys.add(key);
                yield { type: 'tool_use', tool };
              }
            }
            const { content, reasoning } = extractChatCompletionText(parsed);
            const reasoningFresh = getFreshFullText('reasoning_delta', reasoning);
            if (reasoningFresh) yield { type: 'reasoning_delta', text: reasoningFresh };
            const contentFresh = getFreshFullText('text_delta', content);
            if (contentFresh) yield { type: 'text_delta', text: contentFresh };
            continue;
          }

          // Text content
          if (delta.content) {
            rememberDelta('text_delta', delta.content);
            yield { type: 'text_delta', text: delta.content };
          } else if (delta.reasoning_content) {
            rememberDelta('reasoning_delta', delta.reasoning_content);
            yield { type: 'reasoning_delta', text: delta.reasoning_content };
          }

          // Tool calls
          const toolCalls = delta.tool_calls;
          if (toolCalls) {
            for (const tc of toolCalls) {
              const idx: number = tc.index ?? 0;
              let entry = toolCallAccum.get(idx);
              if (!entry) {
                entry = { id: tc.id || '', name: '', arguments: '' };
                toolCallAccum.set(idx, entry);
              }
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name = tc.function.name;
              if (tc.function?.arguments) entry.arguments += tc.function.arguments;
            }
          }

          // Track finish reason
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        } catch {
          /* skip malformed chunks */
        }
      }
    }
    } finally {
      unbindAbort();
    }

    // Stream ended without [DONE] — emit remaining tool calls
    for (const [, tc] of toolCallAccum) {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(tc.arguments); } catch { /* empty */ }
      yield { type: 'tool_use', tool: { id: tc.id, name: tc.name, input } };
    }
    yield { type: 'stop', stopReason: finishReason || 'stop' };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      yield { type: 'stop', stopReason: 'aborted' };
      return;
    }
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
