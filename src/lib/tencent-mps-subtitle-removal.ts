export interface TencentMpsSubtitleRemovalConfig {
  secretId: string;
  secretKey: string;
  mpsRegion: string;
  cosBucket: string;
  cosRegion: string;
  cosPrefix: string;
  videoTemplateId: number | null;
}

export const defaultTencentMpsSubtitleRemovalConfig: TencentMpsSubtitleRemovalConfig = {
  secretId: '',
  secretKey: '',
  mpsRegion: 'ap-guangzhou',
  cosBucket: '',
  cosRegion: 'ap-guangzhou',
  cosPrefix: 'maginecanvas/subtitle-removal',
  videoTemplateId: null,
};

export function normalizeTencentMpsSubtitleRemovalConfig(
  value: Partial<TencentMpsSubtitleRemovalConfig> | null | undefined,
): TencentMpsSubtitleRemovalConfig {
  const templateId = Number(value?.videoTemplateId);
  return {
    secretId: String(value?.secretId || '').trim(),
    secretKey: String(value?.secretKey || '').trim(),
    mpsRegion: String(value?.mpsRegion || defaultTencentMpsSubtitleRemovalConfig.mpsRegion).trim(),
    cosBucket: String(value?.cosBucket || '').trim(),
    cosRegion: String(value?.cosRegion || defaultTencentMpsSubtitleRemovalConfig.cosRegion).trim(),
    cosPrefix: String(value?.cosPrefix || defaultTencentMpsSubtitleRemovalConfig.cosPrefix)
      .trim()
      .replace(/^\/+|\/+$/g, ''),
    videoTemplateId: Number.isInteger(templateId) && templateId > 0 ? templateId : null,
  };
}

export function missingTencentMpsSubtitleRemovalFields(
  config: TencentMpsSubtitleRemovalConfig,
): string[] {
  const missing: string[] = [];
  if (!config.secretId) missing.push('SecretId');
  if (!config.secretKey) missing.push('SecretKey');
  if (!config.cosBucket) missing.push('COS Bucket');
  if (!config.cosRegion) missing.push('COS 地域');
  if (!config.mpsRegion) missing.push('MPS 地域');
  return missing;
}
