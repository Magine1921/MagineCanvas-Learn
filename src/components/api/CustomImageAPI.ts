'use client';

import type { ProviderConfig } from '@/components/seedance/SeedanceStore';
import { customProviderFetchJson } from '@/lib/custom-provider-request';
import {
  extractValuesByPaths,
  getEffectiveApiProfile,
  resolveProviderEndpoint,
} from '@/lib/provider-api-profile';

export interface CustomImageGenerateParams {
  model: string;
  prompt: string;
  size?: string;
  ratio?: string;
  referenceImage?: string;
  referenceImages?: string[];
  extra?: Record<string, unknown>;
}

export interface CustomImageResponse {
  status: 'success' | 'error';
  imageUrl?: string;
  images?: string[];
  error?: string;
  raw?: unknown;
  usage?: Record<string, number>;
}

function normalizeImageUrl(url: string): string {
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `data:image/png;base64,${url}`;
}

/**
 * 通用自定义图片生成 API（基于 ProviderApiProfile 可配置端点与响应路径）。
 */
export function createCustomImageAPI(providerConfig: ProviderConfig) {
  const profile = getEffectiveApiProfile(providerConfig, 'image');

  async function generateImage(params: CustomImageGenerateParams): Promise<CustomImageResponse> {
    const endpoint = resolveProviderEndpoint(providerConfig, 'image', 'image');
    const body: Record<string, unknown> = {
      model: params.model,
      prompt: params.prompt,
      n: 1,
      size: params.size || '1024x1024',
      ...params.extra,
    };
    if (params.ratio) {
      body.ratio = params.ratio;
      body.aspect_ratio = params.ratio;
    }
    if (params.referenceImage) body.image = params.referenceImage;
    if (params.referenceImages?.length) body.images = params.referenceImages;

    try {
      const { ok, status, data, rawText } = await customProviderFetchJson(providerConfig, {
        targetUrl: endpoint,
        method: 'POST',
        body,
      });

      if (!ok) {
        return {
          status: 'error',
          error: `API error ${status}: ${rawText.slice(0, 300)}`,
          raw: data,
        };
      }

      const rawUrls = extractValuesByPaths(data, profile.response.imageUrls);
      const images = rawUrls.map(normalizeImageUrl).filter(Boolean);
      return {
        status: 'success',
        imageUrl: images[0],
        images,
        raw: data,
        usage: data.usage as Record<string, number> | undefined,
      };
    } catch (err) {
      return { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  return { generateImage };
}
