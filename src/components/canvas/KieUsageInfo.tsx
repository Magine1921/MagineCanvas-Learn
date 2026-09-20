'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { KieUsageDisplay } from '@/lib/kie-usage-display';

function formatCredits(value?: number): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '上次任务: 暂无记录';
  return `上次任务: ${Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 })} credits`;
}

export function KieUsageInfo({
  usage,
  lastCredits,
  className,
}: {
  usage: KieUsageDisplay;
  lastCredits?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'mc-node-frost-strip rounded-md px-2 py-1 text-[12px] font-semibold leading-5 text-zinc-300',
        className,
      )}
    >
      {expanded && (
        <div className="mb-1 grid gap-0.5 border-b border-white/8 pb-1 text-[11px] font-medium leading-relaxed text-zinc-400">
          <span>{usage.estimateText}</span>
          <span>{usage.balanceText}</span>
          <span>{usage.usedText}</span>
        </div>
      )}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className="flex min-h-6 w-full cursor-pointer items-center gap-2 overflow-hidden text-left"
      >
        <span className="min-w-0 flex-1 truncate">{usage.currentText}</span>
        <span className="shrink-0 text-cyan-100/90">{formatCredits(lastCredits)}</span>
        <span className={cn('shrink-0 text-[10px] text-zinc-500 transition-transform', expanded && 'rotate-180')}>
          v
        </span>
      </button>
    </div>
  );
}
