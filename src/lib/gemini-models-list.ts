/**
 * 从 Google 拉取模型列表（经本站 /api/proxy/gemini），与内置列表合并。
 * - 原生：`GET .../v1beta/models`
 * - OpenAI 兼容：`GET .../v1beta/openai/models`
 */

import { GEMINI_MODEL_OPTIONS } from '@/lib/llm-text-provider';
import {
  isGeminiOpenAICompatApiUrl,
  isShiyunOpenAiV1ChatApiUrl,
  normalizeGeminiNativeV1BetaBase,
  normalizeGeminiOpenAICompatBase,
  normalizeShiyunOpenAiV1Base,
  normalizeUserGeminiApiKey,
} from '@/lib/gemini-api-url';

const BUILTIN = GEMINI_MODEL_OPTIONS.map((o) => o.value);

function getProxyHeaders(apiKey: string, targetUrl: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Target-URL': targetUrl,
    'X-Goog-Api-Key': apiKey,
  };
}

interface NativeListModelsResponse {
  models?: Array<{
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }>;
  nextPageToken?: string;
}

interface OpenAIListModelsResponse {
  data?: Array<{ id?: string }>;
  object?: string;
}

function extractModelId(name: string): string {
  const n = name.trim();
  if (n.startsWith('models/')) return n.slice('models/'.length);
  return n;
}

/** 支持 generateContent 且名称含 gemini 的模型（原生 ListModels） */
export function isGeminiNativeMultimodalCapableModel(m: {
  name?: string;
  supportedGenerationMethods?: string[];
}): boolean {
  const id = (m.name && extractModelId(m.name)) || '';
  if (!id.toLowerCase().includes('gemini')) return false;
  const methods = m.supportedGenerationMethods || [];
  return methods.includes('generateContent');
}

function isGeminiChatLikeModelId(id: string): boolean {
  const k = id.toLowerCase();
  if (!k.includes('gemini')) return false;
  if (k.includes('embedding')) return false;
  if (k.includes('gemma')) return false;
  return true;
}

/** 兼容网关 /v1/models 等可能返回 gpt-* / 任意 id，仅排除明显非对话 */
function acceptOpenAiCompatibleListModelId(id: string): boolean {
  const k = id.trim().toLowerCase();
  if (!k) return false;
  if (k.includes('embedding')) return false;
  return true;
}

async function fetchNativeModels(params: {
  apiKey: string;
  base: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const out = new Set<string>();
  let pageToken: string | undefined;

  for (let i = 0; i < 20; i++) {
    const qs = new URLSearchParams({ pageSize: '100' });
    if (pageToken) qs.set('pageToken', pageToken);
    const targetUrl = `${params.base}/models?${qs.toString()}`;
    const res = await fetch('/api/proxy/gemini', {
      method: 'GET',
      headers: getProxyHeaders(params.apiKey, targetUrl) as HeadersInit,
      signal: params.signal,
      cache: 'no-store',
    } as RequestInit);
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`ListModels ${res.status}: ${raw.slice(0, 300)}`);
    }
    let body: NativeListModelsResponse = {};
    try {
      body = raw ? (JSON.parse(raw) as NativeListModelsResponse) : {};
    } catch {
      throw new Error('ListModels 响应不是有效 JSON');
    }
    for (const m of body.models || []) {
      if (isGeminiNativeMultimodalCapableModel(m) && m.name) {
        out.add(extractModelId(m.name));
      }
    }
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }

  return Array.from(out);
}

async function fetchOpenAICompatModels(params: {
  apiKey: string;
  base: string;
  signal?: AbortSignal;
  /** true：仅保留名称含 gemini 的 id（Google OpenAI 列表）；false：第三方列表宽松过滤 */
  strictGeminiName?: boolean;
}): Promise<string[]> {
  const targetUrl = `${params.base}/models`;
  const res = await fetch('/api/proxy/gemini', {
    method: 'GET',
    headers: getProxyHeaders(params.apiKey, targetUrl) as HeadersInit,
    signal: params.signal,
    cache: 'no-store',
  } as RequestInit);
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI ListModels ${res.status}: ${raw.slice(0, 300)}`);
  }
  let body: OpenAIListModelsResponse = {};
  try {
    body = raw ? (JSON.parse(raw) as OpenAIListModelsResponse) : {};
  } catch {
    throw new Error('OpenAI models 响应不是有效 JSON');
  }
  const out = new Set<string>();
  const pick =
    params.strictGeminiName !== false ? isGeminiChatLikeModelId : acceptOpenAiCompatibleListModelId;
  for (const row of body.data || []) {
    const id = String(row.id || '').trim();
    if (!id) continue;
    const clean = extractModelId(id);
    if (pick(clean)) out.add(clean);
  }
  return Array.from(out);
}

export async function fetchGeminiModelsFromApi(params: {
  apiKey: string;
  apiUrl?: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const key = normalizeUserGeminiApiKey(params.apiKey);
  if (!key) return [];

  const url = params.apiUrl || '';
  if (isShiyunOpenAiV1ChatApiUrl(url)) {
    const base = normalizeShiyunOpenAiV1Base(url);
    return fetchOpenAICompatModels({
      apiKey: key,
      base,
      signal: params.signal,
      strictGeminiName: false,
    });
  }
  if (isGeminiOpenAICompatApiUrl(url)) {
    const base = normalizeGeminiOpenAICompatBase(url);
    return fetchOpenAICompatModels({ apiKey: key, base, signal: params.signal, strictGeminiName: true });
  }
  const base = normalizeGeminiNativeV1BetaBase(url);
  return fetchNativeModels({ apiKey: key, base, signal: params.signal });
}

/** 合并 API 与内置，API 在前，去重 */
export function mergeGeminiModelLists(apiIds: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of apiIds) {
    const k = id.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    merged.push(k);
  }
  for (const id of BUILTIN) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}
