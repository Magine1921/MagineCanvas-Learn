/**
 * 与方舟计费同量纲的粗略预估（实际以任务 succeeded 后返回的 usage 为准）。
 * Seedance 视频：输出 token 与时长、分辨率、是否 fast 强相关，这里用保守线性近似。
 */
export function estimateVideoTokens(params: {
  model: string;
  duration: number;
  resolution: string;
}): number {
  const fast = params.model.includes('fast');
  const d = Math.max(4, Math.min(15, params.duration));
  const res = (params.resolution || '720P').toUpperCase();
  let mult = 1;
  if (res === '480P') mult = 0.72;
  else if (res === '1080P') mult = 1.35;
  const basePerSec = fast ? 8200 : 10500;
  return Math.max(25000, Math.round(basePerSec * mult * d / 500) * 500);
}

export interface SeedanceVideoTokenEstimate {
  businessTokens: number;
  packageTokens: number;
  deductionRatio: number;
  scenarioLabel: string;
  modelLabel: string;
  resolutionGroup: '480P/720P' | '1080P';
}

export function getSeedanceVideoDeductionRatio(params: {
  model: string;
  resolution: string;
  hasVideoInput: boolean;
}): number {
  const fast = params.model.includes('fast');
  const res = (params.resolution || '720P').toUpperCase();

  if (fast) {
    return params.hasVideoInput ? 1 : 1.6819;
  }

  if (res === '1080P') {
    return params.hasVideoInput ? 1.10714 : 1.82142;
  }

  return params.hasVideoInput ? 1 : 1.6429;
}

export function convertVideoBusinessTokensToPackageTokens(params: {
  businessTokens: number;
  model: string;
  resolution: string;
  hasVideoInput: boolean;
}): number {
  const ratio = getSeedanceVideoDeductionRatio(params);
  return Math.max(0, Math.ceil(params.businessTokens * ratio));
}

export function estimateSeedanceVideoTokenUsage(params: {
  model: string;
  duration: number;
  resolution: string;
  hasVideoInput: boolean;
}): SeedanceVideoTokenEstimate {
  const businessTokens = estimateVideoTokens(params);
  const deductionRatio = getSeedanceVideoDeductionRatio(params);
  const resolutionGroup = (params.resolution || '720P').toUpperCase() === '1080P'
    ? '1080P'
    : '480P/720P';

  return {
    businessTokens,
    packageTokens: convertVideoBusinessTokensToPackageTokens({
      ...params,
      businessTokens,
    }),
    deductionRatio,
    scenarioLabel: params.hasVideoInput ? '含视频输入' : '无视频输入',
    modelLabel: params.model.includes('fast')
      ? 'Doubao-Seedance-2.0-fast'
      : 'Doubao-Seedance-2.0',
    resolutionGroup,
  };
}

export function estimateImageTokens(model: string | undefined, resolution?: string): number {
  const m = model || 'doubao-seedream-5-0-260128';
  const r = (resolution || '2K').toUpperCase();
  const resolutionMultiplier =
    r === '1K' ? 0.5 : r === '3K' ? 1.5 : r === '4K' || r === 'VR8K' ? 2 : 1;
  if (m === 'gpt-image-2' || m.includes('gpt-image')) {
    const base = 52000;
    return Math.round((base * resolutionMultiplier) / 500) * 500;
  }
  let base = 45000;
  if (m.includes('seedream-3-0') || m.includes('seedance-image-v1')) base = 26000;
  else if (m.includes('seedream-4-0')) base = 34000;
  else if (m.includes('seedream-4-5')) base = 39000;
  return Math.round((base * resolutionMultiplier) / 500) * 500;
}

export function estimateLlmTokens(prompt: string, output: string, fallback = 2048): number {
  const totalChars = (prompt || '').length + (output || '').length;
  if (totalChars <= 0) return fallback;
  return Math.max(1, Math.ceil(totalChars / 1.8));
}
