import type { ApiCategory, AuthType, ProviderConfig } from '@/components/seedance/SeedanceStore';

/** API 路径约定预设 */
export type ProviderApiPreset =
  | 'openai-v1'
  | 'openai-root-v1'
  | 'openai-compat'
  | 'custom';

export interface ProviderApiEndpoints {
  chat?: string;
  models?: string;
  image?: string;
  videoSubmit?: string;
  videoPoll?: string;
}

export interface ProviderApiResponseMap {
  imageUrls?: string[];
  taskId?: string[];
  videoUrl?: string[];
  videoStatus?: string[];
  chatContent?: string[];
}

export interface ProviderApiProfile {
  preset?: ProviderApiPreset;
  endpoints?: ProviderApiEndpoints;
  response?: ProviderApiResponseMap;
  videoPollMethod?: 'GET' | 'POST';
  videoSuccessStatuses?: string[];
  llmBodyStyle?: 'openai' | 'minimax';
}

export const PROVIDER_API_PRESET_LABELS: Record<ProviderApiPreset, string> = {
  'openai-v1': 'OpenAI 标准（base 不含 /v1）',
  'openai-root-v1': 'OpenAI（base 已含 /v1）',
  'openai-compat': '兼容网关（chat 在 /chat/completions）',
  custom: '完全自定义路径',
};

const DEFAULT_RESPONSE: ProviderApiResponseMap = {
  imageUrls: ['data[*].url', 'data[*].b64_json', 'url', 'result.images[*].url'],
  taskId: ['task_id', 'data.task_id', 'id', 'data.id'],
  videoUrl: ['video_url', 'data.video_url', 'output.url', 'result.video_url'],
  videoStatus: ['status', 'data.status', 'gen_status'],
  chatContent: ['choices.0.message.content', 'choices.0.delta.content', 'content'],
};

const PRESET_ENDPOINTS: Record<ProviderApiPreset, ProviderApiEndpoints> = {
  'openai-v1': {
    chat: '{base}/v1/chat/completions',
    models: '{base}/v1/models',
    image: '{base}/v1/images/generations',
    videoSubmit: '{base}/v1/video/generation',
    videoPoll: '{base}/v1/video/query?task_id={task_id}',
  },
  'openai-root-v1': {
    chat: '{base}/chat/completions',
    models: '{base}/models',
    image: '{base}/images/generations',
    videoSubmit: '{base}/video/generation',
    videoPoll: '{base}/video/query?task_id={task_id}',
  },
  'openai-compat': {
    chat: '{base}/chat/completions',
    models: '{base}/models',
    image: '{base}/images/generations',
    videoSubmit: '{base}/video/generation',
    videoPoll: '{base}/video/query?task_id={task_id}',
  },
  custom: {},
};

export function getDefaultApiProfile(category: ApiCategory): ProviderApiProfile {
  const preset: ProviderApiPreset =
    category === 'llm' ? 'openai-root-v1' : 'openai-v1';
  return {
    preset,
    endpoints: { ...PRESET_ENDPOINTS[preset] },
    response: { ...DEFAULT_RESPONSE },
    videoPollMethod: 'GET',
    videoSuccessStatuses: ['succeed', 'success', 'completed', 'succeeded'],
    llmBodyStyle: 'openai',
  };
}

export function getEffectiveApiProfile(
  provider: ProviderConfig,
  category: ApiCategory,
): Required<
  Pick<ProviderApiProfile, 'preset' | 'videoPollMethod' | 'llmBodyStyle' | 'videoSuccessStatuses'>
> &
  ProviderApiProfile & {
    endpoints: ProviderApiEndpoints;
    response: ProviderApiResponseMap;
  } {
  const defaults = getDefaultApiProfile(category);
  const preset = provider.apiProfile?.preset || defaults.preset || 'openai-v1';
  const presetEndpoints = PRESET_ENDPOINTS[preset] || PRESET_ENDPOINTS['openai-v1'];
  return {
    preset,
    endpoints: {
      ...presetEndpoints,
      ...defaults.endpoints,
      ...provider.apiProfile?.endpoints,
    },
    response: {
      ...DEFAULT_RESPONSE,
      ...defaults.response,
      ...provider.apiProfile?.response,
    },
    videoPollMethod: provider.apiProfile?.videoPollMethod || defaults.videoPollMethod || 'GET',
    videoSuccessStatuses:
      provider.apiProfile?.videoSuccessStatuses || defaults.videoSuccessStatuses || ['success'],
    llmBodyStyle: provider.apiProfile?.llmBodyStyle || defaults.llmBodyStyle || 'openai',
  };
}

/** 根据 preset 规范化 API 根地址 */
export function resolveProviderApiBase(apiUrl: string, preset: ProviderApiPreset): string {
  let trimmed = (apiUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) trimmed = `https://${trimmed}`;

  if (preset === 'openai-root-v1') {
    if (trimmed.endsWith('/v1')) return trimmed;
    if (/\/v1$/i.test(trimmed)) return trimmed;
    return `${trimmed}/v1`;
  }

  if (preset === 'openai-v1') {
    return trimmed.replace(/\/v1$/i, '');
  }

  // openai-compat & custom: 保持用户输入
  return trimmed;
}

export function resolveProviderEndpoint(
  provider: ProviderConfig,
  category: ApiCategory,
  kind: keyof ProviderApiEndpoints,
  vars: Record<string, string> = {},
): string {
  const profile = getEffectiveApiProfile(provider, category);
  const preset = profile.preset || 'openai-v1';
  const base = resolveProviderApiBase(provider.apiUrl, preset);
  const template = profile.endpoints[kind];
  if (!template) {
    throw new Error(`未配置 ${kind} 端点，请在自定义提供商高级设置中填写路径`);
  }
  return applyEndpointTemplate(template, base, vars);
}

export function applyEndpointTemplate(
  template: string,
  base: string,
  vars: Record<string, string> = {},
): string {
  let url = template.replace(/\{base\}/g, base);
  for (const [key, value] of Object.entries(vars)) {
    url = url.replace(new RegExp(`\\{${key}\\}`, 'g'), encodeURIComponent(value));
  }
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) {
    try {
      const origin = new URL(base.includes('://') ? base : `https://${base}`).origin;
      return `${origin}${url}`;
    } catch {
      return url;
    }
  }
  return url;
}

/** 简单 JSON 路径提取（支持 a.b、a[*].b） */
export function extractValuesByPaths(data: unknown, paths: string[] | undefined): string[] {
  if (!paths?.length) return [];
  for (const path of paths) {
    const values = extractSinglePath(data, path);
    if (values.length > 0) return values;
  }
  return [];
}

export function extractFirstString(data: unknown, paths: string[] | undefined): string | undefined {
  return extractValuesByPaths(data, paths)[0];
}

function extractSinglePath(data: unknown, path: string): string[] {
  if (!path.trim()) return [];
  const segments = path.split('.');
  return walkPath(data, segments, 0);
}

function walkPath(node: unknown, segments: string[], index: number): string[] {
  if (index >= segments.length) {
    if (typeof node === 'string' && node.trim()) return [node.trim()];
    if (typeof node === 'number' && Number.isFinite(node)) return [String(node)];
    return [];
  }

  const raw = segments[index];
  const arrayMatch = raw.match(/^(.+)\[\*\]$/);

  if (arrayMatch) {
    const key = arrayMatch[1];
    const next = getChild(node, key);
    if (!Array.isArray(next)) return [];
    const rest = segments.slice(index + 1);
    const out: string[] = [];
    for (const item of next) {
      out.push(...walkPath(item, rest, 0));
    }
    return out;
  }

  const child = getChild(node, raw);
  return walkPath(child, segments, index + 1);
}

function getChild(node: unknown, key: string): unknown {
  if (!node || typeof node !== 'object') return undefined;
  return (node as Record<string, unknown>)[key];
}

export function isVideoTaskSuccessful(
  status: string | undefined,
  successStatuses: string[] | undefined,
): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return (successStatuses || ['success', 'succeed', 'completed']).some(
    (s) => s.toLowerCase() === normalized,
  );
}

export function resolveProxyPathForAuth(authType: AuthType): string {
  switch (authType) {
    case 'volcengine-bearer':
      return '/api/proxy/volcengine';
    case 'gemini-bearer':
      return '/api/proxy/gemini';
    default:
      return '/api/proxy/openai';
  }
}

export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}
