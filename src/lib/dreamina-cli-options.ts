/** Shared Dreamina CLI option sets for canvas image/video nodes. */

export type DreaminaCliImageResolution = '1k' | '2k' | '4k';

export const DREAMINA_CLI_IMAGE_MODELS = [
  { value: '5.0', label: '即梦 5.0', desc: '最新模型 · 2K / 4K', resolutions: ['2k', '4k'] as const },
  { value: '4.7', label: '即梦 4.7', desc: '2K / 4K', resolutions: ['2k', '4k'] as const },
  { value: '4.6', label: '即梦 4.6', desc: '2K / 4K', resolutions: ['2k', '4k'] as const },
  { value: '4.5', label: '即梦 4.5', desc: '2K / 4K', resolutions: ['2k', '4k'] as const },
  { value: '4.1', label: '即梦 4.1', desc: '2K / 4K', resolutions: ['2k', '4k'] as const },
  { value: '4.0', label: '即梦 4.0', desc: '2K / 4K', resolutions: ['2k', '4k'] as const },
  { value: '3.1', label: '即梦 3.1', desc: '1K / 2K', resolutions: ['1k', '2k'] as const },
  { value: '3.0', label: '即梦 3.0', desc: '1K / 2K', resolutions: ['1k', '2k'] as const },
] as const;

export const DREAMINA_CLI_IMAGE_RESOLUTION_LABELS: Record<DreaminaCliImageResolution, string> = {
  '1k': '1K 标准',
  '2k': '2K 高清',
  '4k': '4K 超清',
};

export const DREAMINA_CLI_IMAGE_RATIO_OPTIONS = [
  { value: '21:9', label: '21:9', desc: '宽银幕' },
  { value: '16:9', label: '16:9', desc: '横屏' },
  { value: '3:2', label: '3:2', desc: '横构图' },
  { value: '4:3', label: '4:3', desc: '标准' },
  { value: '1:1', label: '1:1', desc: '方形' },
  { value: '3:4', label: '3:4', desc: '人像' },
  { value: '2:3', label: '2:3', desc: '竖构图' },
  { value: '9:16', label: '9:16', desc: '竖屏' },
] as const;

export const DREAMINA_CLI_VIDEO_MODELS = [
  { value: 'seedance2.5', label: 'Seedance 2.5', desc: '最新模型 · CLI 当前支持 720p · 4–30 秒 · 约 130 积分/次', creditCost: 130, minDuration: 4, maxDuration: 30, resolutions: ['720P'] as const },
  { value: 'seedance2.0_vip', label: 'Seedance 2.0 VIP', desc: 'VIP 优先队列 · 720p/1080p · 约 55 积分/次', creditCost: 55, minDuration: 4, maxDuration: 15, resolutions: ['720P', '1080P'] as const },
  { value: 'seedance2.0fast_vip', label: 'Seedance 2.0 Fast VIP', desc: 'VIP 优先队列 · 720p · 约 55 积分/次', creditCost: 55, minDuration: 4, maxDuration: 15, resolutions: ['720P'] as const },
  { value: 'seedance2.0mini', label: 'Seedance 2.0 Mini VIP', desc: 'VIP 轻量模型 · 720p · 积分以即梦实际扣除为准', creditCost: 35, minDuration: 4, maxDuration: 15, resolutions: ['720P'] as const },
  { value: 'seedance2.0', label: 'Seedance 2.0', desc: '普通队列 · 720p · 约 10 积分/次', creditCost: 10, minDuration: 4, maxDuration: 15, resolutions: ['720P'] as const },
  { value: 'seedance2.0fast', label: 'Seedance 2.0 Fast', desc: '普通队列 · 720p · 约 10 积分/次', creditCost: 10, minDuration: 4, maxDuration: 15, resolutions: ['720P'] as const },
] as const;

/** 未指定模型时的默认值（普通快速，积分门槛更低） */
export const DREAMINA_CLI_DEFAULT_VIDEO_MODEL = 'seedance2.0fast';

export type DreaminaCliVideoMode = 'all-reference' | 'first-last-frame';

export const DREAMINA_CLI_VIDEO_MODE_OPTIONS = [
  { value: 'all-reference', label: '全能参考', desc: '图片、视频、音频混合参考，使用 multimodal2video' },
  { value: 'first-last-frame', label: '首尾帧', desc: '两张图生成首尾帧过渡；单张图回退首帧图生视频' },
] as const satisfies readonly {
  value: DreaminaCliVideoMode;
  label: string;
  desc: string;
}[];

export function normalizeDreaminaCliVideoMode(value?: string): DreaminaCliVideoMode {
  return DREAMINA_CLI_VIDEO_MODE_OPTIONS.some((opt) => opt.value === value)
    ? (value as DreaminaCliVideoMode)
    : 'all-reference';
}

export const DREAMINA_CLI_VIDEO_RATIO_OPTIONS = [
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: '9:16', label: '9:16' },
  { value: '21:9', label: '21:9' },
] as const;

export const DREAMINA_CLI_VIDEO_RESOLUTION_OPTIONS = [
  { value: '720P', label: '720p' },
  { value: '1080P', label: '1080p' },
] as const;

export const DREAMINA_CLI_VIDEO_DURATION_OPTIONS = Array.from({ length: 12 }, (_, i) => {
  const value = i + 4;
  return { value, label: `${value}秒` };
});

export function getDreaminaCliVideoDurationOptions(modelVersion?: string) {
  const model = getDreaminaCliVideoModel(modelVersion);
  return Array.from({ length: model.maxDuration - model.minDuration + 1 }, (_, index) => {
    const value = model.minDuration + index;
    return { value, label: `${value}秒` };
  });
}

export function getDreaminaCliImageModel(value?: string) {
  return (
    DREAMINA_CLI_IMAGE_MODELS.find((m) => m.value === value) ||
    DREAMINA_CLI_IMAGE_MODELS[0]
  );
}

export function normalizeDreaminaCliImageResolution(
  modelVersion: string,
  resolution?: string,
): DreaminaCliImageResolution {
  const model = getDreaminaCliImageModel(modelVersion);
  const supported = model.resolutions as readonly DreaminaCliImageResolution[];
  const normalized = (resolution || '').toLowerCase() as DreaminaCliImageResolution;
  if (supported.includes(normalized)) return normalized;
  if (supported.includes('2k')) return '2k';
  return supported[0];
}

export function getDreaminaCliImageCreditCost(
  modelValue?: string,
  resolution?: string,
): number {
  const model = getDreaminaCliImageModel(modelValue);
  const normalized = normalizeDreaminaCliImageResolution(model.value, resolution);
  if (normalized === '4k') return 16;
  if (normalized === '2k') return 3;
  return 4;
}

export function getDreaminaCliVideoModel(value?: string) {
  if (value) {
    const found = DREAMINA_CLI_VIDEO_MODELS.find((m) => m.value === value);
    if (found) return found;
  }
  return (
    DREAMINA_CLI_VIDEO_MODELS.find((m) => m.value === DREAMINA_CLI_DEFAULT_VIDEO_MODEL) ||
    DREAMINA_CLI_VIDEO_MODELS[0]
  );
}

/** 标准化为 CLI 要求的小写格式 (720p/1080p) */
export function normalizeDreaminaCliVideoResolution(
  modelVersion: string,
  resolution?: string,
): string {
  const model = getDreaminaCliVideoModel(modelVersion);
  const supported = model.resolutions as readonly string[];
  const lower = (resolution || supported[0] || '720p').trim().toLowerCase();
  const matched = supported.find((value) => value.toLowerCase() === lower);
  if (matched) return matched.toLowerCase();
  return (supported[0] || '720P').toLowerCase();
}

export function getDreaminaCliVideoCreditCost(value?: string): number {
  return getDreaminaCliVideoModel(value).creditCost;
}

export type DreaminaSafetyFailureKind = 'face' | 'post-generation' | null;

export function classifyDreaminaSafetyFailure(reason: string): DreaminaSafetyFailureKind {
  if (
    /(?:face|facial|portrait|identity)[\s_-]*(?:check|review|verification|policy|safety|compliance|not pass|failed)|(?:人脸|肖像|身份).*(?:审核|校验|合规|安全).*(?:失败|未通过|拒绝)/i.test(reason)
  ) {
    return 'face';
  }
  if (
    /post[-\s]?TNS|TNS[\s_-]*(?:check|review)|content[\s_-]*(?:safety|moderation)|safety[\s_-]*(?:check|review)|内容安全审核/i.test(reason)
  ) {
    return 'post-generation';
  }
  return null;
}

/** 将 CLI fail_reason 转为更易读的中文提示 */
export function formatDreaminaFailReason(
  reason: string,
  _context?: { totalCredit?: number | null; requiredCredit?: number; modelLabel?: string },
): string {
  const safetyFailure = classifyDreaminaSafetyFailure(reason);
  if (safetyFailure === 'face') {
    return '即梦人物人脸或身份合规审核未通过';
  }
  if (safetyFailure === 'post-generation') {
    return '即梦生成后内容安全审核未通过，可能涉及人物参考图、暴力血腥描写、武器攻击或其他平台安全策略';
  }
  if (
    /seedance2\.(?:0mini|5)/i.test(reason)
    && /unsupported|not supported|invalid|unknown|model_version|model version|参数/i.test(reason)
  ) {
    const modelLabel = /seedance2\.5/i.test(reason) ? 'Seedance 2.5' : 'Seedance 2.0 Mini VIP';
    return `当前本机即梦 CLI 版本尚不支持 ${modelLabel}，请在模型列表设置中更新即梦 CLI 后重试。`;
  }
  if (/CreditPreDeductNotEnough|\bret\s*[=:]\s*1006\b/i.test(reason)) {
    return '即梦积分额度不足';
  }
  if (reason.includes('AigcComplianceConfirmationRequired')) {
    return '需先在即梦 Web 端完成该模型的授权确认，然后再用 CLI 重试。';
  }
  if (
    /upload resource[\s\S]*(?:ApplyImageUpload|upload image)[\s\S]*(?:context deadline exceeded|timeout|timed out)/i.test(reason)
  ) {
    return '即梦素材上传超时，请检查系统代理或网络连接后重试。';
  }
  if (/Maximum call stack size exceeded/i.test(reason)) {
    return '本地参考素材解析失败：大尺寸 Base64 图片触发了解析器调用栈溢出';
  }
  return reason;
}

const DREAMINA_EXECUTION_STATUS_SUFFIX = /\s*[；;]\s*(?:同一位置(?:第|连续)|AI\s*助手正在|任务已停止|已停止，可|可修正后|可修改后)[\s\S]*$/i;

export function normalizeDreaminaFailureReason(reason?: string): string {
  const normalized = (reason || '')
    .replace(/^失败原因[：:]\s*/i, '')
    .replace(DREAMINA_EXECUTION_STATUS_SUFFIX, '')
    .trim();
  return normalized ? formatDreaminaFailReason(normalized) : '';
}

export function isGenericDreaminaFailureReason(reason?: string): boolean {
  const normalized = normalizeDreaminaFailureReason(reason);
  if (!normalized) return true;
  return /^(?:请求失败\s*\(\s*\d+\s*\)|HTTP\s*5\d\d|Internal Error(?:,?\s*Please try again later)?|fetch failed|failed to fetch|network error|任务失败|未知错误)$/i.test(
    normalized,
  );
}

/**
 * 同一任务链可能先返回明确的业务失败，随后自动重试只返回空 500。
 * 明确的审核、额度或参数原因必须优先于后续传输/执行状态。
 */
export function preferDreaminaFailureReason(
  currentReason?: string,
  candidateReason?: string,
): string {
  const current = normalizeDreaminaFailureReason(currentReason);
  const candidate = normalizeDreaminaFailureReason(candidateReason);
  if (!current) return candidate;
  if (!candidate) return current;
  const priority = (reason: string) => {
    if (isGenericDreaminaFailureReason(reason)) return 0;
    if (
      classifyDreaminaSafetyFailure(reason)
      || /(?:积分|额度|余额).*(?:不足|用完)|credits?.*(?:insufficient|not enough)|quota|token plan|模型.*不支持|授权确认/i.test(reason)
    ) {
      return 2;
    }
    return 1;
  };
  return priority(candidate) > priority(current) ? candidate : current;
}

export function dreaminaCliResolutionToSeedream(
  resolution: DreaminaCliImageResolution,
): '1K' | '2K' | '4K' {
  return resolution.toUpperCase() as '1K' | '2K' | '4K';
}
