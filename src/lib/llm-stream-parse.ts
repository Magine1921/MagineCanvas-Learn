import type { LlmStreamPart } from '@/components/api/LLMAPI';

type ChatLikePayload = {
  choices?: Array<{
    message?: { content?: string; reasoning_content?: string };
    delta?: { content?: string; reasoning_content?: string };
  }>;
  message?: { content?: string; reasoning_content?: string };
  delta?: string | { content?: string; text?: string; reasoning_content?: string };
  content?: string | Array<{ type?: string; text?: string }>;
  text?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
    summary?: Array<{ text?: string }>;
  }>;
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
  }>;
};

export function responseLooksLikeEventStream(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.includes('text/event-stream') || ct.includes('application/stream+json');
}

function extractResponsesText(payload: ChatLikePayload): { content: string; reasoning: string } {
  if (typeof payload.output_text === 'string' && payload.output_text) {
    return { content: payload.output_text, reasoning: '' };
  }
  let content = '';
  let reasoning = '';
  for (const item of payload.output || []) {
    if (item.type === 'reasoning') {
      reasoning += (item.summary || []).map((s) => s.text || '').join('');
      continue;
    }
    for (const part of item.content || []) {
      if (part.type === 'output_text' || part.type === 'text') {
        content += part.text || '';
      }
    }
  }
  return { content, reasoning };
}

function extractGeminiCandidateText(payload: ChatLikePayload): { content: string; reasoning: string } {
  let content = '';
  let reasoning = '';
  const parts = payload.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (!part.text) continue;
    if (part.thought) reasoning += part.text;
    else content += part.text;
  }
  return { content, reasoning };
}

function extractLooseText(payload: ChatLikePayload): { content: string; reasoning: string } {
  let content = '';
  let reasoning = '';
  const directDelta = payload.delta;
  if (typeof directDelta === 'string') {
    content += directDelta;
  } else if (directDelta && typeof directDelta === 'object') {
    content += directDelta.content || directDelta.text || '';
    reasoning += directDelta.reasoning_content || '';
  }
  content += payload.message?.content || '';
  reasoning += payload.message?.reasoning_content || '';
  if (typeof payload.content === 'string') {
    content += payload.content;
  } else if (Array.isArray(payload.content)) {
    content += payload.content.map((part) => part.text || '').join('');
  }
  content += typeof payload.text === 'string' ? payload.text : '';
  return { content, reasoning };
}

export function extractChatCompletionText(payload: ChatLikePayload): {
  content: string;
  reasoning: string;
} {
  const choice = payload.choices?.[0];
  const message = choice?.message;
  const delta = choice?.delta;
  const responses = extractResponsesText(payload);
  const gemini = extractGeminiCandidateText(payload);
  const loose = extractLooseText(payload);
  return {
    content: String(message?.content || delta?.content || responses.content || gemini.content || loose.content || ''),
    reasoning: String(message?.reasoning_content || delta?.reasoning_content || responses.reasoning || gemini.reasoning || loose.reasoning || ''),
  };
}

/** 非 SSE 整包 JSON 时，拆成小块 yield，让 UI 仍能逐段刷新 */
export async function* yieldLlmPartsFromText(
  content: string,
  reasoning: string,
  chunkSize = 4,
): AsyncGenerator<LlmStreamPart> {
  if (reasoning) {
    for (let i = 0; i < reasoning.length; i += chunkSize) {
      yield { kind: 'reasoning', text: reasoning.slice(i, i + chunkSize) };
    }
  }
  if (content) {
    for (let i = 0; i < content.length; i += chunkSize) {
      yield { kind: 'content', text: content.slice(i, i + chunkSize) };
    }
  }
}

export async function* yieldTextDeltas(text: string, chunkSize = 4): AsyncGenerator<{ text: string }> {
  for (let i = 0; i < text.length; i += chunkSize) {
    yield { text: text.slice(i, i + chunkSize) };
  }
}
