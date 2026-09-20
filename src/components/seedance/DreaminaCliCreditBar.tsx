'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DreaminaCliCreditSnapshot } from '@/lib/dreamina-cli-credits';

interface DreaminaCliCreditBarProps {
  credit: DreaminaCliCreditSnapshot & { sessionUsedCredits: number };
  estimatedCost: number;
  modelLabel: string;
  detail?: string;
  compact?: boolean;
  onRefresh?: () => void;
}

export function DreaminaCliCreditBar({
  credit,
  estimatedCost,
  modelLabel,
  detail,
  compact = false,
  onRefresh,
}: DreaminaCliCreditBarProps) {
  const { totalCredit, vipLevel, userId, usedPath, syncing, syncError, sessionUsedCredits } = credit;
  const hasVipEntitlement = Boolean(vipLevel && !/^free$/i.test(vipLevel));
  const insufficient =
    !hasVipEntitlement && typeof totalCredit === 'number' && estimatedCost > 0 && totalCredit < estimatedCost;
  const estimatedRemaining =
    typeof totalCredit === 'number' && estimatedCost > 0
      ? Math.floor(totalCredit / estimatedCost)
      : null;

  const balanceDisplay =
    syncing && totalCredit == null
      ? '同步中...'
      : typeof totalCredit === 'number'
        ? `${totalCredit.toLocaleString()} 积分`
        : syncError || '未同步';
  const accountDisplay = [
    vipLevel,
    userId ? `UID ${userId}` : '',
    usedPath ? `CLI ${usedPath}` : '',
  ].filter(Boolean).join(' · ');

  if (compact) {
    return (
      <div
        className="mc-node-frost-strip flex h-6 items-center gap-2 overflow-hidden rounded-md px-2 text-[11px] font-medium text-zinc-300"
        title={accountDisplay || undefined}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
          {syncing ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-zinc-400" />
          ) : (
            <span
              className={cn(
                'inline-block h-1.5 w-1.5 shrink-0 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.5)]',
                insufficient ? 'bg-amber-300' : 'bg-zinc-100',
              )}
            />
          )}
          <span className="truncate">CLI 余额: {balanceDisplay}{accountDisplay ? ` · ${accountDisplay}` : ''}</span>
        </span>
        <span className="shrink-0">预计 {estimatedCost.toLocaleString()}/次</span>
        <span className="shrink-0">本次已用 {sessionUsedCredits.toLocaleString()}</span>
        {onRefresh ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRefresh();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className="shrink-0 text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
          >
            刷新
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mc-node-frost-strip flex flex-col gap-1 rounded-md px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-400">
        <span className="flex items-center gap-1">
          {syncing ? (
            <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
          ) : (
            <span
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.5)]',
                insufficient ? 'bg-amber-300' : 'bg-zinc-100',
              )}
            />
          )}
          CLI 可用积分: {balanceDisplay}
          {accountDisplay ? ` · ${accountDisplay}` : ''}
        </span>
        {onRefresh ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRefresh();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className="text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
          >
            刷新
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-zinc-400">
        <span>当前模型: {modelLabel}</span>
        <span>预计消耗: 约 {estimatedCost.toLocaleString()} 积分/次</span>
        <span>本次会话已消耗: {sessionUsedCredits.toLocaleString()} 积分</span>
        <span>
          预计还可生成:{' '}
          {estimatedRemaining == null ? '同步余额后显示' : `${estimatedRemaining.toLocaleString()} 次`}
        </span>
      </div>
      {detail ? <div className="text-[8px] leading-relaxed text-zinc-600">{detail}</div> : null}
      {insufficient ? (
        <div className="text-[8px] leading-relaxed text-amber-300/90">
          当前余额不足以使用此模型（约需 {estimatedCost} 积分）。可换用更低消耗模型或充值后再试。
        </div>
      ) : null}
      {syncError && !syncing ? (
        <div className="text-[8px] leading-relaxed text-red-300/90">{syncError}</div>
      ) : null}
      <div className="text-[8px] leading-relaxed text-zinc-600">
        说明: 余额来自 dreamina user_credit 的 total_credit；预估消耗为参考值，实际以任务扣费为准。
      </div>
    </div>
  );
}
