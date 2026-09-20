'use client';

import { cn } from '@/lib/utils';

const LONG_LINE_THRESHOLD = 3;
const LONG_CHAR_THRESHOLD = 240;

export function isLongThinkingText(thinking: string): boolean {
  const lines = thinking.split('\n');
  return lines.length > LONG_LINE_THRESHOLD || thinking.length > LONG_CHAR_THRESHOLD;
}

export function AgentThinkingBlock({
  thinking,
  expanded,
  onToggleExpand,
  className,
  label = '思考过程',
}: {
  thinking: string;
  expanded: boolean;
  onToggleExpand: () => void;
  className?: string;
  label?: string;
}) {
  const isLong = isLongThinkingText(thinking);
  const lines = thinking.split('\n');
  const displayText = isLong && !expanded ? `${lines.slice(0, LONG_LINE_THRESHOLD).join('\n')}\n...` : thinking;

  return (
    <div className={cn('mb-1 max-w-[min(100%,20rem)]', className)}>
      <div className="rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-1.5">
        <button
          type="button"
          onClick={onToggleExpand}
          className="mb-0.5 flex w-full items-center gap-1 text-[9px] uppercase tracking-wide text-zinc-500 hover:text-zinc-400"
        >
          <span>{label}</span>
          {isLong ? <span className="text-zinc-600">[{expanded ? '收起' : '展开'}]</span> : null}
        </button>
        <div className={cn('text-[10px] leading-relaxed text-zinc-400', !expanded && isLong ? 'line-clamp-3' : '')}>
          <pre className="whitespace-pre-wrap break-words font-sans">{displayText}</pre>
        </div>
      </div>
    </div>
  );
}
