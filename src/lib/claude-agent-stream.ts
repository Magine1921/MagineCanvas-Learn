// Claude Messages API streaming via raw fetch (avoids @anthropic-ai/sdk Node.js deps)

export interface ClaudeToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ClaudeAgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_use'; tool: ClaudeToolUse }
  | { type: 'stop'; stopReason: string }
  | { type: 'error'; message: string };

export interface AnthropicToolDef {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

interface ClaudeTurnParams {
  apiKey: string;
  apiUrl?: string;
  model: string;
  systemPrompt: string;
  messages: ClaudeConversationMessage[];
  tools: AnthropicToolDef[];
  includeReasoning?: boolean;
  signal?: AbortSignal;
}

export interface ClaudeConversationMessage {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
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

interface SSEContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block:
    | { type: 'text'; text: string }
    | { type: 'thinking'; thinking: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
}

interface SSEContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'signature_delta'; signature: string }
    | { type: 'input_json_delta'; partial_json: string };
}

interface SSEContentBlockStop {
  type: 'content_block_stop';
  index: number;
}

interface SSEMessageDelta {
  type: 'message_delta';
  delta: { stop_reason: string | null };
}

type SSEEvent =
  | { type: 'message_start'; message: unknown }
  | SSEContentBlockStart
  | SSEContentBlockDelta
  | SSEContentBlockStop
  | SSEMessageDelta
  | { type: 'message_stop' }
  | { type: 'error'; error: { message: string } };

export async function* streamClaudeTurn(params: ClaudeTurnParams): AsyncGenerator<ClaudeAgentEvent> {
  const { apiKey, apiUrl, model, systemPrompt, messages, tools, includeReasoning, signal } = params;

  const rawBaseUrl = (apiUrl || 'https://api.kie.ai/claude').replace(/\/+$/, '');
  const baseUrl = (() => {
    try {
      const url = new URL(rawBaseUrl);
      if (url.hostname.toLowerCase() === 'api.kie.ai' && (url.pathname === '' || url.pathname === '/')) {
        return `${url.origin}/claude`;
      }
    } catch {
      /* keep raw */
    }
    return rawBaseUrl;
  })();
  const isKieClaude = (() => {
    try {
      return new URL(baseUrl).hostname.toLowerCase() === 'api.kie.ai';
    } catch {
      return false;
    }
  })();
  const endpoint = `${baseUrl}/v1/messages`;

  const body: Record<string, unknown> = {
    model,
    max_tokens: 8192,
    messages,
    stream: true,
  };

  if (includeReasoning && /claude-(?:sonnet|opus|haiku)-4/i.test(model)) {
    body.thinking = { type: 'enabled', budget_tokens: 2048 };
  }

  if (systemPrompt) {
    body.system = systemPrompt;
  }
  if (tools.length > 0) {
    body.tools = tools;
  }

  try {
    const response = await fetch(isKieClaude ? '/api/proxy/openai' : endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(isKieClaude
          ? { 'X-Target-URL': endpoint, 'X-API-Key': apiKey }
          : { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }),
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      let errorMsg = `Claude API ${response.status}`;
      try {
        const err = JSON.parse(errorBody);
        errorMsg = err.error?.message || errorMsg;
      } catch { /* use raw status */ }
      yield { type: 'error', message: errorMsg };
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('text/event-stream')) {
      const raw = await response.text();
      try {
        const payload = JSON.parse(raw) as {
          content?: Array<Record<string, unknown>>;
          stop_reason?: string;
        };
        for (const block of payload.content || []) {
          if (block.type === 'text' && typeof block.text === 'string') {
            yield { type: 'text_delta', text: block.text };
          }
          if (block.type === 'thinking' && typeof block.thinking === 'string') {
            yield { type: 'reasoning_delta', text: block.thinking };
          }
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            yield {
              type: 'tool_use',
              tool: {
                id: typeof block.id === 'string' ? block.id : `tool-${Date.now()}`,
                name: block.name,
                input:
                  block.input && typeof block.input === 'object' && !Array.isArray(block.input)
                    ? (block.input as Record<string, unknown>)
                    : {},
              },
            };
          }
        }
        yield { type: 'stop', stopReason: payload.stop_reason || 'end_turn' };
      } catch {
        yield { type: 'error', message: `Claude 响应解析失败: ${raw.slice(0, 400)}` };
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
    const toolUses: Map<number, { id: string; name: string; inputJson: string }> = new Map();
    const emittedToolIndexes = new Set<number>();
    const unbindAbort = bindAbortToReader(reader, signal);

    const completedTool = (index: number): ClaudeToolUse | null => {
      const tool = toolUses.get(index);
      if (!tool || emittedToolIndexes.has(index)) return null;
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tool.inputJson || '{}');
      } catch {
        return null;
      }
      emittedToolIndexes.add(index);
      return { id: tool.id, name: tool.name, input };
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

        if (trimmed.startsWith('event:')) {
          continue;
        }

        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();

        let parsed: SSEEvent;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        if (parsed.type === 'error') {
          yield { type: 'error', message: parsed.error?.message || 'Claude API 错误' };
          return;
        }

        if (parsed.type === 'content_block_start') {
          const block = parsed.content_block;
          if (block.type === 'thinking' && block.thinking) {
            yield { type: 'reasoning_delta', text: block.thinking };
          }
          if (block.type === 'tool_use') {
            const initialInput =
              block.input && Object.keys(block.input).length > 0
                ? JSON.stringify(block.input)
                : '';
            toolUses.set(parsed.index, { id: block.id, name: block.name, inputJson: initialInput });
          }
        }

        if (parsed.type === 'content_block_delta') {
          if (parsed.delta.type === 'text_delta') {
            yield { type: 'text_delta', text: parsed.delta.text };
          }
          if (parsed.delta.type === 'thinking_delta') {
            yield { type: 'reasoning_delta', text: parsed.delta.thinking };
          }
          if (parsed.delta.type === 'input_json_delta') {
            const entry = toolUses.get(parsed.index);
            if (entry) {
              entry.inputJson += parsed.delta.partial_json;
            }
          }
        }

        if (parsed.type === 'content_block_stop') {
          const tool = completedTool(parsed.index);
          if (tool) yield { type: 'tool_use', tool };
        }

        if (parsed.type === 'message_delta') {
          const stopReason = parsed.delta.stop_reason || 'end_turn';
          for (const [index] of toolUses) {
            const tool = completedTool(index);
            if (tool) yield { type: 'tool_use', tool };
          }
          yield { type: 'stop', stopReason };
          return;
        }
      }
    }
    } finally {
      unbindAbort();
    }
    for (const [index] of toolUses) {
      const tool = completedTool(index);
      if (tool) yield { type: 'tool_use', tool };
    }
    yield { type: 'stop', stopReason: 'end_turn' };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      yield { type: 'stop', stopReason: 'aborted' };
      return;
    }
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
