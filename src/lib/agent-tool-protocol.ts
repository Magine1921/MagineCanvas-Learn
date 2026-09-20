export interface ExtractedAgentToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseToolInput(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value)) || {};
    } catch {
      return {};
    }
  }
  return asRecord(value) || {};
}

/**
 * Extracts completed tool calls from OpenAI Chat Completions, OpenAI
 * Responses, and Gemini native response payloads.
 */
export function extractCompletedAgentToolUses(payload: unknown): ExtractedAgentToolUse[] {
  const root = asRecord(payload);
  if (!root) return [];

  const extracted: ExtractedAgentToolUse[] = [];
  const seen = new Set<string>();

  const add = (idValue: unknown, nameValue: unknown, inputValue: unknown) => {
    const name = typeof nameValue === 'string' ? nameValue.trim() : '';
    if (!name) return;
    const input = parseToolInput(inputValue);
    const id =
      typeof idValue === 'string' && idValue.trim()
        ? idValue
        : `tool-${extracted.length + 1}`;
    const key = `${id}\u0000${name}\u0000${JSON.stringify(input)}`;
    if (seen.has(key)) return;
    seen.add(key);
    extracted.push({ id, name, input });
  };

  const readOpenAIToolCalls = (value: unknown) => {
    for (const callValue of asArray(value)) {
      const call = asRecord(callValue);
      const fn = asRecord(call?.function);
      if (!call || !fn) continue;
      add(call.id, fn.name, fn.arguments);
    }
  };

  readOpenAIToolCalls(root.tool_calls);
  const legacyFunctionCall = asRecord(root.function_call);
  if (legacyFunctionCall) {
    add(root.id, legacyFunctionCall.name, legacyFunctionCall.arguments);
  }

  for (const choiceValue of asArray(root.choices)) {
    const choice = asRecord(choiceValue);
    const message = asRecord(choice?.message);
    const delta = asRecord(choice?.delta);
    readOpenAIToolCalls(message?.tool_calls);
    readOpenAIToolCalls(delta?.tool_calls);
    const functionCall = asRecord(message?.function_call);
    if (functionCall) {
      add(message?.id, functionCall.name, functionCall.arguments);
    }
  }

  const responsesPayload = asRecord(root.response) || root;
  for (const itemValue of asArray(responsesPayload.output)) {
    const item = asRecord(itemValue);
    if (!item || item.type !== 'function_call') continue;
    add(item.call_id || item.id, item.name, item.arguments);
  }

  for (const candidateValue of asArray(root.candidates)) {
    const candidate = asRecord(candidateValue);
    const content = asRecord(candidate?.content);
    for (const partValue of asArray(content?.parts)) {
      const part = asRecord(partValue);
      const functionCall =
        asRecord(part?.functionCall) || asRecord(part?.function_call);
      if (!functionCall) continue;
      add(
        functionCall.id || part?.id,
        functionCall.name,
        functionCall.args ?? functionCall.arguments,
      );
    }
  }

  return extracted;
}
