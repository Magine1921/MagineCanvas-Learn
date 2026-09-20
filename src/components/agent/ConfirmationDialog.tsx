'use client';

import { memo, useState } from 'react';
import { AlertTriangle, ShieldAlert, ShieldCheck, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ConfirmationRequest {
  tool: string;
  summary: string;
  risk: 'high' | 'medium';
  resolve: (approved: boolean) => void;
}

export const ConfirmationDialog = memo(function ConfirmationDialog({
  request,
}: {
  request: ConfirmationRequest | null;
}) {
  const [waiting, setWaiting] = useState(false);

  if (!request) return null;

  const isHigh = request.risk === 'high';

  function handleApprove() {
    setWaiting(true);
    request!.resolve(true);
  }

  function handleDeny() {
    request!.resolve(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleDeny} />

      {/* Dialog */}
      <div
        className={cn(
          'relative z-10 w-[380px] max-w-[90vw] rounded-2xl border shadow-2xl',
          isHigh
            ? 'border-rose-500/30 bg-[#0f0808] shadow-rose-500/10'
            : 'border-amber-500/25 bg-[#0f0c08] shadow-amber-500/10'
        )}
        style={{
          backdropFilter: 'blur(20px) saturate(1.2)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
        }}
      >
        {/* Header */}
        <div className={cn(
          'flex items-center gap-2.5 border-b px-4 py-3',
          isHigh ? 'border-rose-500/20' : 'border-amber-500/20'
        )}>
          {isHigh ? (
            <ShieldAlert className="h-5 w-5 text-rose-400" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-amber-400" />
          )}
          <span className={cn(
            'text-sm font-semibold',
            isHigh ? 'text-rose-200' : 'text-amber-200'
          )}>
            {isHigh ? '高级权限操作确认' : '敏感操作确认'}
          </span>
          <button
            type="button"
            onClick={handleDeny}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] text-zinc-500 hover:text-zinc-200"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-3 px-4 py-4">
          <div className="rounded-lg border border-white/8 bg-white/[0.04] px-3 py-2.5">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">操作工具</div>
            <div className="text-xs font-medium text-zinc-200">{request.tool}</div>
          </div>

          <div className="rounded-lg border border-white/8 bg-white/[0.04] px-3 py-2.5">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">操作摘要</div>
            <div className="max-h-24 overflow-y-auto text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap break-all">
              {request.summary}
            </div>
          </div>

          <div className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs',
            isHigh
              ? 'border-rose-500/20 bg-rose-500/8 text-rose-300'
              : 'border-amber-500/20 bg-amber-500/8 text-amber-300'
          )}>
            {isHigh ? (
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              {isHigh
                ? '此操作需要系统高级权限，可能修改系统配置、安装软件或访问受保护资源。请确认你信任此操作。'
                : '此操作可能修改敏感文件或执行系统命令。请确认操作内容无误。'}
            </span>
          </div>
        </div>

        {/* Buttons */}
        <div className={cn(
          'flex gap-2.5 border-t px-4 py-3',
          isHigh ? 'border-rose-500/20' : 'border-amber-500/20'
        )}>
          <button
            type="button"
            onClick={handleDeny}
            disabled={waiting}
            className="flex-1 rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200 disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleApprove}
            disabled={waiting}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all',
              isHigh
                ? 'border-rose-500/40 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30 active:scale-95'
                : 'border-amber-500/40 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30 active:scale-95'
            )}
          >
            {waiting ? (
              <><Loader2 className="h-3 w-3 animate-spin" />执行中...</>
            ) : (
              '确认执行'
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
