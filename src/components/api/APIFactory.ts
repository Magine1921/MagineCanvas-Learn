'use client';

import type { ProviderConfig } from '@/components/seedance/SeedanceStore';
import { ImageAPI, createImageAPI } from './ImageAPI';
import type { ImageApiProvider } from './ImageAPI';
import { VideoAPI, createVideoAPI } from './VideoAPI';

export { ImageAPI, createImageAPI, VideoAPI, createVideoAPI };

/** 根据 providerId 解析 ImageAPI 的 provider 参数 */
export function resolveImageProvider(providerId: string): ImageApiProvider {
  if (providerId === 'gpt-image-2') return 'gpt-image-2';
  return 'seedream';
}

/** 根据 provider 配置创建 ImageAPI 实例 */
export function createImageAPIFromProvider(cfg: ProviderConfig & { providerId?: string }, providerId?: string): ImageAPI {
  const pid = providerId || cfg.providerId || 'seedream';
  return new ImageAPI(cfg.apiKey, cfg.apiUrl, { provider: resolveImageProvider(pid) });
}

/** 根据 provider 配置创建 VideoAPI 实例 */
export function createVideoAPIFromProvider(cfg: ProviderConfig): VideoAPI {
  return new VideoAPI(cfg.apiKey, cfg.apiUrl);
}

/** 判断是否为自定义 provider（需走通用代理） */
export function isCustomProvider(providerId: string, category: 'image' | 'video' | 'audio' | 'llm'): boolean {
  // 内置 provider ID 列表
  const builtInImage = new Set(['seedream', 'gpt-image-2', 'nano-banana', 'kie-gpt-image', 'kie-nano-banana']);
  const builtInVideo = new Set(['seedance-2.0', 'kling', 'happyhorse', 'veo-omni', 'kie-veo', 'kie-gemini-omni']);
  const builtInAudio = new Set(['elevenlabs', 'minimax-audio', 'suno', 'kie-suno']);
  const builtInLlm = new Set(['volcengine', 'gemini', 'claude', 'openai', 'deepseek-native']);

  const sets: Record<string, Set<string>> = {
    image: builtInImage,
    video: builtInVideo,
    audio: builtInAudio,
    llm: builtInLlm,
  };
  return !sets[category]?.has(providerId);
}

/** 获取提供商对应的代理 URL（前端 fetch 路径） */
export function getProxyUrl(cfg: ProviderConfig): string {
  switch (cfg.authType) {
    case 'volcengine-bearer':
      return '/api/proxy/volcengine';
    case 'gemini-bearer':
      return '/api/proxy/gemini';
    case 'standard-bearer':
    case 'elevenlabs-api-key':
      return '/api/proxy/openai';
    case 'kling-jwt':
      return '/api/proxy/openai'; // Kling JWT 走代理转发
    default:
      return '/api/proxy/openai';
  }
}

/** 构建前端 fetch 的 headers */
export function buildProxyHeaders(
  cfg: ProviderConfig,
  targetUrl: string,
  opts?: { omitContentType?: boolean; streaming?: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!opts?.omitContentType) {
    headers['Content-Type'] = 'application/json';
  }
  if (opts?.streaming) {
    headers['Accept'] = 'text/event-stream';
  }
  if (cfg.authType === 'elevenlabs-api-key') {
    headers['X-Target-URL'] = targetUrl;
    headers['X-ElevenLabs-Api-Key'] = cfg.apiKey;
  } else if (cfg.authType === 'standard-bearer' || cfg.authType === 'volcengine-bearer') {
    headers['X-Target-URL'] = targetUrl;
    headers['X-API-Key'] = cfg.apiKey;
  } else if (cfg.authType === 'gemini-bearer') {
    headers['X-Target-URL'] = targetUrl;
    headers['X-Goog-Api-Key'] = cfg.apiKey;
  }
  return headers;
}
