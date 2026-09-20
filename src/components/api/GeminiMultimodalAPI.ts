// Google Gemini：原生 generateContent，或 OpenAI 兼容 chat/completions（经 /api/proxy/gemini）

import {
  isOpenAiStyleChatMultimodalBase,
  normalizeGeminiNativeV1BetaBase,
  normalizeOpenAiStyleChatBase,
  normalizeUserGeminiApiKey,
} from '@/lib/gemini-api-url';
import {
  mediaMimeType,
  mergeLlmMediaInputs,
  type LlmMediaInput,
} from '@/lib/llm-media-input';

export interface GeminiGenerateResponse {
  content: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface GeminiCandidate {
  content?: {
    parts?: Array<{ text?: string }>;
    role?: string;
  };
}

interface GeminiGenerateBody {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string; code?: number };
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  return { mimeType: m[1].trim() || 'image/png', base64: m[2].trim() };
}

function buildGeminiNativeParts(
  prompt: string,
  mediaInputs?: LlmMediaInput[],
  imageUrls?: string[]
): Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> {
  const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];
  for (const media of mergeLlmMediaInputs(mediaInputs, imageUrls)) {
    const u = media.url.trim();
    if (!u) continue;
    if (u.startsWith('data:')) {
      const parsed = parseDataUrl(u);
      if (parsed) {
        parts.push({
          inline_data: { mime_type: mediaMimeType(media) || parsed.mimeType, data: parsed.base64 },
        });
      }
      continue;
    }
    throw new Error('Gemini 原生接口需要可读取的本地图片、音频或视频数据，请重新添加素材后再试。');
  }
  parts.push({ text: prompt });
  return parts;
}

type OpenAIUserContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

function buildOpenAIUserContent(
  prompt: string,
  mediaInputs?: LlmMediaInput[],
  imageUrls?: string[],
): OpenAIUserContent {
  const media = mergeLlmMediaInputs(mediaInputs, imageUrls);
  if (!media.length) return prompt;
  const parts: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: prompt }];
  for (const item of media) {
    parts.push({ type: 'image_url', image_url: { url: item.url } });
  }
  return parts;
}

function extractNativeText(payload: GeminiGenerateBody): string {
  const parts = payload.candidates?.[0]?.content?.parts;
  if (!parts?.length) return '';
  return parts.map((p) => p.text || '').join('');
}

function extractOpenAIText(payload: OpenAIChatCompletionResponse): string {
  const c = payload.choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : '';
}

export class GeminiMultimodalAPI {
  private apiKey: string;
  private readonly openAiMode: boolean;
  private readonly nativeBase: string;
  private readonly openAiBase: string;

  constructor(apiKey: string, apiUrl: string = 'https://shiyunapi.com/v1') {
    this.apiKey = apiKey;
    this.openAiMode = isOpenAiStyleChatMultimodalBase(apiUrl);
    this.openAiBase = this.openAiMode ? normalizeOpenAiStyleChatBase(apiUrl) : '';
    this.nativeBase = normalizeGeminiNativeV1BetaBase(
      this.openAiMode ? 'https://generativelanguage.googleapis.com/v1beta' : apiUrl
    );
  }

  private getProxyHeaders(targetUrl: string): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-Target-URL': targetUrl,
      'X-Goog-Api-Key': this.apiKey,
    };
  }

  private buildNativeBody(params: {
    prompt: string;
    systemPrompt?: string;
    temperature?: number;
    maxOutputTokens?: number;
    mediaInputs?: LlmMediaInput[];
    imageUrls?: string[];
  }) {
    const body: Record<string, unknown> = {
      contents: [
        {
          role: 'user',
          parts: buildGeminiNativeParts(params.prompt, params.mediaInputs, params.imageUrls),
        },
      ],
      generationConfig: {
        maxOutputTokens: params.maxOutputTokens ?? 2048,
        ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
      },
    };
    if (params.systemPrompt?.trim()) {
      body.systemInstruction = {
        parts: [{ text: params.systemPrompt.trim() }],
      };
    }
    return body;
  }

  private buildOpenAIChatBody(params: {
    model: string;
    prompt: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    mediaInputs?: LlmMediaInput[];
    imageUrls?: string[];
  }) {
    const messages: Array<{ role: string; content: OpenAIUserContent }> = [];
    if (params.systemPrompt?.trim()) {
      messages.push({ role: 'system', content: params.systemPrompt.trim() });
    }
    messages.push({
      role: 'user',
      content: buildOpenAIUserContent(params.prompt, params.mediaInputs, params.imageUrls),
    });
    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 2048,
      ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
    };
    if (params.stream) body.stream = true;
    return body;
  }

  async generate(params: {
    prompt: string;
    model: string;
    systemPrompt?: string;
    temperature?: number;
    maxOutputTokens?: number;
    mediaInputs?: LlmMediaInput[];
    imageUrls?: string[];
  }): Promise<GeminiGenerateResponse> {
    const model = params.model.trim() || 'gemini-2.5-pro';

    if (this.openAiMode) {
      const targetUrl = `${this.openAiBase}/chat/completions`;
      const response = await fetch('/api/proxy/gemini', {
        method: 'POST',
        headers: this.getProxyHeaders(targetUrl) as HeadersInit,
        body: JSON.stringify(
          this.buildOpenAIChatBody({
            model,
            prompt: params.prompt,
            systemPrompt: params.systemPrompt,
            temperature: params.temperature,
            maxTokens: params.maxOutputTokens,
            stream: false,
            mediaInputs: params.mediaInputs,
            imageUrls: params.imageUrls,
          })
        ),
        cache: 'no-store',
      } as RequestInit);

      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`Gemini（OpenAI 兼容）请求失败: ${response.status} - ${raw.slice(0, 400)}`);
      }
      let payload: OpenAIChatCompletionResponse = {};
      try {
        payload = raw ? (JSON.parse(raw) as OpenAIChatCompletionResponse) : {};
      } catch {
        throw new Error(`Gemini 响应解析失败: ${raw.slice(0, 200)}`);
      }
      if (payload.error?.message) {
        throw new Error(`Gemini: ${payload.error.message}`);
      }
      const content = extractOpenAIText(payload).trim();
      const u = payload.usage;
      return {
        content,
        usage: u
          ? {
              prompt_tokens: u.prompt_tokens,
              completion_tokens: u.completion_tokens,
              total_tokens: u.total_tokens,
            }
          : undefined,
      };
    }

    const targetUrl = `${this.nativeBase}/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch('/api/proxy/gemini', {
      method: 'POST',
      headers: this.getProxyHeaders(targetUrl) as HeadersInit,
      body: JSON.stringify(this.buildNativeBody(params)),
      cache: 'no-store',
    } as RequestInit);

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Gemini 请求失败: ${response.status} - ${raw.slice(0, 400)}`);
    }
    let payload: GeminiGenerateBody = {};
    try {
      payload = raw ? (JSON.parse(raw) as GeminiGenerateBody) : {};
    } catch {
      throw new Error(`Gemini 响应解析失败: ${raw.slice(0, 200)}`);
    }
    if (payload.error?.message) {
      throw new Error(`Gemini: ${payload.error.message}`);
    }
    const content = extractNativeText(payload).trim();
    const u = payload.usageMetadata;
    return {
      content,
      usage: u
        ? {
            prompt_tokens: u.promptTokenCount,
            completion_tokens: u.candidatesTokenCount,
            total_tokens: u.totalTokenCount,
          }
        : undefined,
    };
  }

  async *streamGenerate(params: {
    prompt: string;
    model: string;
    systemPrompt?: string;
    temperature?: number;
    maxOutputTokens?: number;
    mediaInputs?: LlmMediaInput[];
    imageUrls?: string[];
    signal?: AbortSignal;
  }): AsyncGenerator<string> {
    const model = params.model.trim() || 'gemini-2.5-pro';

    if (this.openAiMode) {
      const targetUrl = `${this.openAiBase}/chat/completions`;
      const response = await fetch('/api/proxy/gemini', {
        method: 'POST',
        headers: this.getProxyHeaders(targetUrl) as HeadersInit,
        body: JSON.stringify(
          this.buildOpenAIChatBody({
            model,
            prompt: params.prompt,
            systemPrompt: params.systemPrompt,
            temperature: params.temperature,
            maxTokens: params.maxOutputTokens,
            stream: true,
            mediaInputs: params.mediaInputs,
            imageUrls: params.imageUrls,
          })
        ),
        cache: 'no-store',
      } as RequestInit);

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini（OpenAI 兼容）流式失败: ${response.status} - ${err.slice(0, 400)}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取 Gemini 流');

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
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string | null } }>;
            };
            const piece = parsed.choices?.[0]?.delta?.content;
            if (piece) yield piece;
          } catch {
            /* 半包或非 JSON 行 */
          }
        }
      }
      return;
    }

    const targetUrl = `${this.nativeBase}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const response = await fetch('/api/proxy/gemini', {
      method: 'POST',
      headers: this.getProxyHeaders(targetUrl) as HeadersInit,
      body: JSON.stringify(this.buildNativeBody(params)),
      cache: 'no-store',
    } as RequestInit);

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini 流式失败: ${response.status} - ${err.slice(0, 400)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取 Gemini 流');

    const decoder = new TextDecoder();
    let buffer = '';
    let lastAccumulated = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data) as GeminiGenerateBody;
          const piece = extractNativeText(parsed);
          if (!piece) continue;
          const delta = piece.startsWith(lastAccumulated)
            ? piece.slice(lastAccumulated.length)
            : piece;
          lastAccumulated = piece;
          if (delta) yield delta;
        } catch {
          /* 半包 */
        }
      }
    }
  }
}

export function createGeminiMultimodalAPI(apiKey: string, apiUrl?: string): GeminiMultimodalAPI {
  const k = normalizeUserGeminiApiKey(apiKey);
  if (!k) throw new Error('请先配置 Gemini API Key');
  return new GeminiMultimodalAPI(k, apiUrl);
}
