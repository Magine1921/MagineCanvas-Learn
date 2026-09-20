import type { ProviderConfig, ProviderTokenBucket } from '@/components/seedance/SeedanceStore';

export type KieUsageKind = 'image' | 'video' | 'audio' | 'llm' | 'enhance';
export const KIE_GLOBAL_PROVIDER_TOKEN_KEY = 'kie.global';
const EMPTY_PROVIDER_TOKEN_BUCKET: ProviderTokenBucket = {
  remainingTokens: null,
  usedTokens: 0,
};

export interface KieUsageInput {
  kind: KieUsageKind;
  providerId: string;
  provider?: Pick<ProviderConfig, 'label' | 'apiUrl'> | null;
  bucket?: ProviderTokenBucket;
  usageBucket?: ProviderTokenBucket;
  model?: string;
  resolution?: string;
  duration?: number;
  hasInput?: boolean;
  tokenEstimate?: number;
}

export interface KieUsageDisplay {
  isKie: boolean;
  currentText: string;
  estimateText: string;
  balanceText: string;
  usedText: string;
}

export function isKieProvider(provider?: Pick<ProviderConfig, 'apiUrl'> | null, providerId = ''): boolean {
  const id = providerId.toLowerCase();
  if (id.startsWith('kie-')) return true;
  try {
    return new URL(provider?.apiUrl || '').hostname.toLowerCase() === 'api.kie.ai';
  } catch {
    return /api\.kie\.ai/i.test(provider?.apiUrl || '');
  }
}

export function getKieProviderTokenBucket(
  providerTokens: Record<string, ProviderTokenBucket>,
  fallbackKey?: string,
): ProviderTokenBucket {
  return (
    providerTokens[KIE_GLOBAL_PROVIDER_TOKEN_KEY] ||
    (fallbackKey ? providerTokens[fallbackKey] : undefined) ||
    EMPTY_PROVIDER_TOKEN_BUCKET
  );
}

export async function fetchKieCredits(provider?: Pick<ProviderConfig, 'apiKey' | 'apiUrl'> | null): Promise<number | null> {
  const apiKey = provider?.apiKey?.trim();
  if (!apiKey) return null;
  const response = await fetch('/api/kie/credit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, apiUrl: provider?.apiUrl || 'https://api.kie.ai' }),
  });
  if (!response.ok) return null;
  const json = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    credits?: number;
  };
  if (json.ok === true && typeof json.credits === 'number') return json.credits;
  return null;
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function normalizeResolution(value?: string): string {
  return String(value || '').trim().toUpperCase();
}

function estimateSeedanceCredits(resolution?: string, duration?: number, hasInput?: boolean): number | null {
  const seconds = Math.max(1, Number(duration || 5));
  const res = normalizeResolution(resolution);
  const table = hasInput
    ? { '480P': 11.5, '720P': 25, '1080P': 62 }
    : { '480P': 19, '720P': 41, '1080P': 102 };
  const perSecond = table[res as keyof typeof table];
  return perSecond == null ? null : perSecond * seconds;
}

export function estimateKieCredits(input: KieUsageInput): number | null {
  const model = String(input.model || '').toLowerCase();
  if (model.includes('seedance')) {
    return estimateSeedanceCredits(input.resolution, input.duration, input.hasInput);
  }
  return null;
}

function buildMeta(input: KieUsageInput): string {
  const parts = [input.model, input.resolution, input.duration ? `${input.duration}s` : ''].filter(Boolean);
  return parts.join(' · ');
}

export function buildKieUsageDisplay(input: KieUsageInput): KieUsageDisplay {
  const isKie = isKieProvider(input.provider, input.providerId);
  const providerLabel = input.provider?.label || input.providerId || 'Kie API';
  const meta = buildMeta(input);
  const estimatedCredits = estimateKieCredits(input);
  const remaining = input.bucket?.remainingTokens;
  const used = Math.max(0, (input.usageBucket || input.bucket)?.usedTokens || 0);

  let estimateText: string;
  if (estimatedCredits != null) {
    estimateText = `预计消耗约 ${formatNumber(estimatedCredits)} credits`;
  } else if (input.kind === 'llm' && input.tokenEstimate) {
    estimateText = `预计输出上限 ${formatNumber(input.tokenEstimate)} token，credits 以 Kie 账单为准`;
  } else {
    estimateText = '预计消耗以 Kie 返回 creditsConsumed 为准';
  }

  return {
    isKie,
    currentText: `当前: ${providerLabel}${meta ? ` · ${meta}` : ''}`,
    estimateText,
    balanceText: remaining == null
      ? 'Kie credits 余额未同步，请在 API 配置中测试连接或填写余额'
      : `Kie credits 余额 ${formatNumber(remaining)}`,
    usedText: input.kind === 'llm'
      ? `已记录 token ${formatNumber(used)}`
      : `已记录总消耗 ${formatNumber(used)} credits`,
  };
}
