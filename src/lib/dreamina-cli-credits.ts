import type { DreaminaCliConfig } from '@/components/seedance/SeedanceStore';

export interface DreaminaCliCreditSnapshot {
  totalCredit: number | null;
  vipLevel: string;
  userId: string;
  usedPath: string;
  syncing: boolean;
  syncError: string;
  lastSyncedAt: number | null;
}

export const defaultDreaminaCliCreditSnapshot: DreaminaCliCreditSnapshot = {
  totalCredit: null,
  vipLevel: '',
  userId: '',
  usedPath: '',
  syncing: false,
  syncError: '',
  lastSyncedAt: null,
};

export async function fetchDreaminaCliCredits(
  cliConfig: DreaminaCliConfig,
): Promise<Pick<DreaminaCliCreditSnapshot, 'totalCredit' | 'vipLevel' | 'userId' | 'usedPath' | 'syncError'>> {
  const res = await fetch('/api/dreamina/user-credit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cliPath: cliConfig.cliPath || 'dreamina' }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    loggedIn?: boolean;
    error?: string;
    usedPath?: string;
    data?: { total_credit?: number; vip_level?: string; user_id?: number | string };
  };

  if (!data.ok || !data.loggedIn) {
    return {
      totalCredit: null,
      vipLevel: '',
      userId: '',
      usedPath: data.usedPath || '',
      syncError: data.error || '未登录或查询失败',
    };
  }

  return {
    totalCredit: typeof data.data?.total_credit === 'number' ? data.data.total_credit : null,
    vipLevel: typeof data.data?.vip_level === 'string' ? data.data.vip_level : '',
    userId: data.data?.user_id == null ? '' : String(data.data.user_id),
    usedPath: data.usedPath || cliConfig.cliPath || 'dreamina',
    syncError: '',
  };
}

/** CLI 响应里可能携带的单次消耗积分 */
function finiteCreditCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

export function extractDreaminaCreditCount(result: Record<string, unknown>): number | undefined {
  const direct = finiteCreditCount(result['credit_count']);
  if (direct != null) return direct;

  for (const key of ['commerce_info', 'data', 'result', 'result_json']) {
    const child = result[key];
    if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
    const nested = extractDreaminaCreditCount(child as Record<string, unknown>);
    if (nested != null) return nested;
  }

  return undefined;
}
