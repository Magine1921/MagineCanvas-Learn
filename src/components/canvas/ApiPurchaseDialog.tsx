'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Coins, CreditCard, ShieldCheck, Sparkles, X } from 'lucide-react';

interface ApiPurchaseDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const packages = [
  { name: '轻量额度包', credits: '适合体验与轻量创作' },
  { name: '创作额度包', credits: '适合持续图片与视频生成' },
  { name: '专业额度包', credits: '适合高频工作流使用' },
];

export function ApiPurchaseDialog({ isOpen, onClose }: ApiPurchaseDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[10080] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label="API购买">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-xl"
        aria-label="关闭API购买界面"
        onClick={onClose}
      />

      <section className="relative w-full max-w-[680px] overflow-hidden rounded-3xl border border-white/12 bg-[#15191a]/45 text-zinc-100 shadow-[0_36px_100px_rgba(0,0,0,0.5),0_0_42px_rgba(255,255,255,0.06),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-2xl">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/22 bg-white/[0.07] text-zinc-100 shadow-[0_0_22px_rgba(255,255,255,0.14),inset_0_1px_0_rgba(255,255,255,0.14)]">
              <Coins className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="mb-0.5 text-[10px] font-medium text-zinc-400">该功能暂未开放</div>
              <h2 className="text-base font-semibold text-zinc-50">API购买</h2>
              <p className="mt-0.5 text-xs text-zinc-500">购买与管理模型调用额度</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-400 transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-zinc-100"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-5 p-6">
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3.5">
            <div>
              <div className="text-xs text-zinc-500">可用 API Credits</div>
              <div className="mt-1 text-xl font-semibold text-zinc-100">--</div>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <ShieldCheck className="h-4 w-4 text-zinc-300/80" />
              账户服务待接入
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-zinc-400" />
              <h3 className="text-sm font-medium text-zinc-200">选择额度包</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {packages.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  disabled
                  className="min-h-[116px] cursor-not-allowed rounded-lg border border-white/12 bg-white/[0.035] p-4 text-left opacity-80 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_20px_rgba(255,255,255,0.025)]"
                >
                  <div className="text-sm font-semibold text-zinc-100">{item.name}</div>
                  <div className="mt-2 text-xs leading-5 text-zinc-400">{item.credits}</div>
                  <div className="mt-3 text-xs font-medium text-zinc-300">价格待定</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-zinc-400" />
              <h3 className="text-sm font-medium text-zinc-200">支付方式</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" disabled className="h-10 cursor-not-allowed rounded-lg border border-white/10 bg-white/[0.035] text-xs text-zinc-500">微信支付</button>
              <button type="button" disabled className="h-10 cursor-not-allowed rounded-lg border border-white/10 bg-white/[0.035] text-xs text-zinc-500">支付宝</button>
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-white/10 px-6 py-4">
          <span className="text-xs text-zinc-500">购买功能正在准备中</span>
          <button type="button" disabled className="h-9 cursor-not-allowed rounded-lg border border-white/10 bg-white/[0.05] px-5 text-xs font-medium text-zinc-500">确认购买</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
