'use client';

import { getActiveModelOptions, findProviderIdForModel, findProviderForModel } from '@/components/seedance/SeedanceStore';
import type { ApiCategory, CategoryConfig, ProviderConfig } from '@/components/seedance/SeedanceStore';
import { IMAGE_GEN_MODEL_OPTIONS } from '@/components/api/ImageAPI';
import type { ImageGenModel } from '@/components/api/ImageAPI';

export interface ModelOption {
  value: string;
  label: string;
  providerId?: string;
  isCustom?: boolean;
}

const VIDEO_MODEL_DISPLAY_NAMES: Record<string, string> = {
  veo3: 'Kie Veo 3.1 Quality',
  veo3_fast: 'Kie Veo 3.1 Fast',
  veo3_lite: 'Kie Veo 3.1 Lite',
  'gemini-omni-video': 'Kie Gemini Omni Video',
};

export function getVideoModelDisplayName(model: string, fallback?: string): string {
  return VIDEO_MODEL_DISPLAY_NAMES[model] || fallback || model;
}

/** 合并内置硬编码模型选项与 store 中已配置的提供商模型 */
export function getImageModelOptions(categoryConfig: CategoryConfig): ModelOption[] {
  const seen = new Set<string>();
  const result: ModelOption[] = [];

  // Built-in defaults (always available)
  for (const opt of IMAGE_GEN_MODEL_OPTIONS) {
    seen.add(opt.value);
    result.push({ value: opt.value, label: opt.label, providerId: opt.value === 'gpt-image-2' ? 'gpt-image-2' : 'seedream' });
  }

  // Store-configured providers
  const storeOptions = getActiveModelOptions(categoryConfig, 'image');
  for (const opt of storeOptions) {
    if (!seen.has(opt.value)) {
      seen.add(opt.value);
      result.push({ value: opt.value, label: opt.label, providerId: opt.providerId });
    }
  }

  return result;
}

export function getVideoModelOptions(): ModelOption[] {
  return [
    { value: 'doubao-seedance-2.0', label: 'Seedance 2.0', providerId: 'seedance-2.0' },
    { value: 'doubao-seedance-2.0-fast', label: 'Seedance 2.0 Fast', providerId: 'seedance-2.0' },
    // 向后兼容旧 ID
    { value: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0', providerId: 'seedance-2.0' },
    { value: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast', providerId: 'seedance-2.0' },
    { value: 'seedance-2.0', label: 'Seedance 2.0', providerId: 'seedance-2.0' },
    { value: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast', providerId: 'seedance-2.0' },
  ];
}

/** 合并内置 + store 视频模型 */
export function getMergedVideoModelOptions(categoryConfig: CategoryConfig): ModelOption[] {
  const seen = new Set<string>();
  const result: ModelOption[] = [];
  for (const opt of getVideoModelOptions()) {
    seen.add(opt.value);
    result.push(opt);
  }
  const storeOptions = getActiveModelOptions(categoryConfig, 'video');
  for (const opt of storeOptions) {
    if (!seen.has(opt.value)) {
      seen.add(opt.value);
      result.push(opt);
    }
  }
  return result;
}

/** 根据选中的 model 值查找对应的 providerId */
export function resolveProviderForModel(
  categoryConfig: CategoryConfig,
  model: string,
  fallbackProviderId: string,
  category?: ApiCategory,
): string {
  return findProviderIdForModel(categoryConfig, model, category) || fallbackProviderId;
}

/** 获取 provider 配置 */
export function getProviderConfig(
  categoryConfig: CategoryConfig,
  providerId: string,
): ProviderConfig | undefined {
  return categoryConfig.providers[providerId] || categoryConfig.customProviders[providerId];
}

/** 获取 provider 的 token bucket key */
export function getTokenBucketKey(category: string, providerId: string): string {
  return `${category}.${providerId}`;
}
