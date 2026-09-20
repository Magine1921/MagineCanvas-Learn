'use client';

import SeedanceConfig from '@/components/seedance/SeedanceConfig';
import { cn } from '@/lib/utils';
import { ExternalLink, ReceiptText, Settings, X } from 'lucide-react';
import { useState } from 'react';

export interface ApiConfigDialogProps {
  isOpen: boolean;
  isClosing: boolean;
  onClose: () => void;
}

const TENCENT_MPS_PRICING_URL = 'https://cloud.tencent.com/document/product/862/36180';

const imagePricing = [
  ['720P', '¥0.01/张'],
  ['1080P', '¥0.02/张'],
  ['2K', '¥0.04/张'],
  ['4K', '¥0.08/张'],
  ['8K', '¥0.16/张'],
] as const;

const videoPricing = [
  { label: '去字幕（无痕）', hd: '¥1.50', fhd: '¥3.00', high: '¥6.00' },
  { label: '去水印（无痕）', hd: '¥1.50', fhd: '¥3.00', high: '¥6.00' },
  { label: '去水印（模糊）', hd: '¥0.17', fhd: '¥0.34', high: '¥0.67 / ¥1.34' },
] as const;

function openTencentMpsPricingPage() {
  if (typeof window === 'undefined') return;
  if (window.magineDesktop?.openExternal) {
    void window.magineDesktop.openExternal(TENCENT_MPS_PRICING_URL);
    return;
  }
  window.open(TENCENT_MPS_PRICING_URL, '_blank', 'noopener,noreferrer');
}

export function ApiConfigDialog({ isOpen, isClosing, onClose }: ApiConfigDialogProps) {
  if (!isOpen) return null;

  return <ApiConfigDialogContent isClosing={isClosing} onClose={onClose} />;
}

function ApiConfigDialogContent({
  isClosing,
  onClose,
}: Pick<ApiConfigDialogProps, 'isClosing' | 'onClose'>) {
  const [activeView, setActiveView] = useState<'api' | 'billing'>('api');
  const isBillingOpen = activeView === 'billing';

  return (
    <>
      <div
        data-tutorial-id="api-config-dialog"
        className={cn(
          'fixed inset-0 z-[10070] bg-black/40 backdrop-blur-xl transition-opacity mc-dur-42f',
          isClosing ? 'opacity-0' : 'opacity-100'
        )}
        onClick={onClose}
      />

      <div
        className={cn(
          'fixed left-1/2 z-[10075] w-[min(calc(100vw-2rem),24rem)] -translate-x-1/2 transition-all mc-dur-42f ease-out',
          isClosing
            ? 'top-full opacity-0 pointer-events-none'
            : 'top-1/2 -translate-y-1/2 opacity-100'
        )}
      >
        <div className="overflow-hidden rounded-3xl border border-white/12 bg-[#15191a]/45 shadow-[0_36px_100px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-8 py-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/22 bg-white/[0.07] shadow-[0_0_22px_rgba(255,255,255,0.14),inset_0_1px_0_rgba(255,255,255,0.14)]">
                <Settings className="h-4 w-4 text-zinc-100" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-100">API配置</div>
                <div className="text-[10px] text-zinc-500">多提供商 API 密钥管理（仅本地保存）</div>
              </div>
            </div>
            <button
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/8 text-sm text-zinc-400 transition-colors hover:border-white/28 hover:bg-white/[0.12] hover:text-zinc-100 hover:shadow-[0_0_18px_rgba(255,255,255,0.1)]"
              type="button"
              onClick={onClose}
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[min(70vh,520px)] overflow-y-auto px-8 py-6">
            <SeedanceConfig onClose={onClose} />
          </div>
          <div className="border-t border-white/10 px-8 py-4">
            <button
              type="button"
              onClick={() => setActiveView('billing')}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/14 bg-white/[0.05] px-4 text-sm font-medium text-zinc-200 transition-colors hover:border-white/28 hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
            >
              <ReceiptText className="h-4 w-4" aria-hidden="true" />
              计费规则
            </button>
          </div>
        </div>

        <div
          className={cn(
            'mc-api-config-panel absolute inset-x-0 top-0 overflow-hidden rounded-3xl border border-white/12 bg-[#15191a]/95 shadow-[0_36px_100px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-2xl',
            'transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
            isBillingOpen
              ? 'translate-y-0 scale-100 opacity-100'
              : 'pointer-events-none translate-y-5 scale-[0.98] opacity-0'
          )}
          role="dialog"
          aria-modal="true"
          aria-labelledby="billing-rules-title"
          aria-hidden={!isBillingOpen}
          inert={!isBillingOpen}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/22 bg-white/[0.07] shadow-[0_0_22px_rgba(255,255,255,0.14),inset_0_1px_0_rgba(255,255,255,0.14)]">
                <ReceiptText className="h-4 w-4 text-zinc-100" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div id="billing-rules-title" className="text-sm font-semibold text-zinc-100">计费规则</div>
                <div className="text-[10px] text-zinc-500">腾讯云 MPS 去字幕与去水印</div>
              </div>
            </div>
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/8 text-zinc-400 transition-colors hover:border-white/28 hover:bg-white/[0.12] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
              type="button"
              onClick={() => setActiveView('api')}
              aria-label="收起计费规则并返回API配置"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[min(76vh,620px)] space-y-4 overflow-y-auto px-6 py-5">
            <section className="space-y-2" aria-labelledby="image-billing-title">
              <div>
                <h3 id="image-billing-title" className="text-xs font-semibold text-zinc-100">图片去文字/去水印</h3>
                <p className="mt-1 text-[10px] text-zinc-500">按成功处理的图片张数计费</p>
              </div>
              <div className="grid grid-cols-5 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                {imagePricing.map(([resolution, price]) => (
                  <div key={resolution} className="border-r border-white/10 px-1.5 py-2.5 text-center last:border-r-0">
                    <div className="text-[9px] text-zinc-500">{resolution}</div>
                    <div className="mt-1 whitespace-nowrap text-[9px] font-semibold tabular-nums text-zinc-200">{price}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-2" aria-labelledby="video-billing-title">
              <div>
                <h3 id="video-billing-title" className="text-xs font-semibold text-zinc-100">视频去字幕/去水印</h3>
                <p className="mt-1 text-[10px] text-zinc-500">按输入视频时长和短边分辨率计费，单位：元/分钟</p>
              </div>
              <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20 text-[9px]">
                <div className="grid grid-cols-[1.45fr_repeat(3,0.8fr)] border-b border-white/10 bg-white/[0.04] text-zinc-500">
                  <div className="px-2 py-2">处理方式</div>
                  <div className="px-1 py-2 text-center">720P</div>
                  <div className="px-1 py-2 text-center">1080P</div>
                  <div className="px-1 py-2 text-center">2K / 4K</div>
                </div>
                {videoPricing.map((item) => (
                  <div key={item.label} className="grid grid-cols-[1.45fr_repeat(3,0.8fr)] border-b border-white/8 text-zinc-300 last:border-b-0">
                    <div className="px-2 py-2.5">{item.label}</div>
                    <div className="px-1 py-2.5 text-center tabular-nums">{item.hd}</div>
                    <div className="px-1 py-2.5 text-center tabular-nums">{item.fhd}</div>
                    <div className="px-1 py-2.5 text-center tabular-nums">{item.high}</div>
                  </div>
                ))}
              </div>
              <p className="text-[9px] leading-relaxed text-zinc-500">
                模糊去水印的 2K / 4K 单价分别为 ¥0.67 / ¥1.34。无痕同时去字幕和去水印时，两项费用相加：720P ¥3、1080P ¥6、2K / 4K ¥12 每分钟。
              </p>
            </section>

            <section className="space-y-2 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-3" aria-labelledby="billing-notes-title">
              <h3 id="billing-notes-title" className="text-[10px] font-semibold text-amber-100/90">结算说明</h3>
              <ul className="list-disc space-y-1 pl-4 text-[9px] leading-relaxed text-zinc-400">
                <li>默认日结，结算周期内累计总秒数换算成分钟后向上取整。</li>
                <li>例如当天仅处理一条 15 秒的 1080P 去字幕视频，可能按 1 分钟计费，即 ¥3。</li>
                <li>COS 存储、上传下载及公网流量费用另行计算。</li>
                <li>价格可能调整，最终费用以腾讯云实际账单为准。</li>
              </ul>
            </section>

            <button
              type="button"
              onClick={openTencentMpsPricingPage}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] px-4 text-xs font-medium text-cyan-100 transition-colors hover:border-cyan-200/35 hover:bg-cyan-300/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/35"
            >
              查看腾讯云官方价格
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
