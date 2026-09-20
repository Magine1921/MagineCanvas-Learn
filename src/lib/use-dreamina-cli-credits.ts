'use client';

import { useCallback, useEffect } from 'react';
import { useSeedanceStore } from '@/components/seedance/SeedanceStore';
import { fetchDreaminaCliCredits } from '@/lib/dreamina-cli-credits';

const CREDIT_SYNC_MIN_INTERVAL_MS = 15_000;

/** 在即梦 CLI 后端激活时同步 user_credit 到全局 store */
export function useDreaminaCliCreditSync(enabled: boolean) {
  const dreaminaCli = useSeedanceStore((s) => s.config.dreaminaCli);
  const credit = useSeedanceStore((s) => s.dreaminaCliCredit);
  const setDreaminaCliCredits = useSeedanceStore((s) => s.setDreaminaCliCredits);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!dreaminaCli.loggedIn) {
      setDreaminaCliCredits({
        totalCredit: null,
        vipLevel: '',
        userId: '',
        usedPath: '',
        syncing: false,
        syncError: '请先在 API 配置中检测登录',
        lastSyncedAt: null,
      });
      return;
    }

    const lastSyncedAt = useSeedanceStore.getState().dreaminaCliCredit.lastSyncedAt;
    if (
      !force &&
      typeof lastSyncedAt === 'number' &&
      Date.now() - lastSyncedAt < CREDIT_SYNC_MIN_INTERVAL_MS
    ) {
      return;
    }

    setDreaminaCliCredits({ syncing: true, syncError: '' });
    try {
      const snapshot = await fetchDreaminaCliCredits(dreaminaCli);
      setDreaminaCliCredits({
        ...snapshot,
        syncing: false,
        lastSyncedAt: Date.now(),
      });
    } catch (error) {
      setDreaminaCliCredits({
        syncing: false,
        userId: '',
        usedPath: '',
        syncError: error instanceof Error ? error.message : '同步积分失败',
      });
    }
  }, [dreaminaCli, enabled, setDreaminaCliCredits]);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  return { ...credit, refresh };
}
