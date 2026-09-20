'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, RotateCcw, X } from 'lucide-react';

type DesktopUpdateState = {
  status: 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'downloaded' | 'preparing' | 'installing' | 'error' | 'disabled';
  currentVersion: string;
  version?: string;
  progress?: number;
  bytesPerSecond?: number;
  message?: string;
};

function formatRate(value?: number) {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB/s`;
  return `${Math.round(bytes / 1024)} KB/s`;
}

export function DesktopUpdateHost() {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState('');
  useEffect(() => {
    const desktop = window.magineDesktop;
    if (!desktop?.isDesktop) return;
    void desktop.updateGetStatus?.().then(setState).catch(() => {});
    const offStatus = desktop.onUpdateStatus?.(setState);
    const offPrepare = desktop.onUpdatePrepareInstall?.(() => {
      void (async () => {
        window.dispatchEvent(new Event('magine:prepare-update'));
        await new Promise((resolve) => window.setTimeout(resolve, 1600));
        const projects = window.localStorage.getItem('magine-canvas-projects');
        if (projects) await desktop.projectsSave(projects).catch(() => {});
        desktop.updatePrepared?.();
      })();
    });
    return () => { offStatus?.(); offPrepare?.(); };
  }, []);
  const visible = useMemo(() => {
    if (!state || ['idle', 'checking', 'disabled'].includes(state.status)) return false;
    if (state.status === 'current') return Boolean(state.message);
    return dismissedVersion !== (state.version || state.status);
  }, [dismissedVersion, state]);
  useEffect(() => {
    if (state?.status !== 'current') return;
    const timer = window.setTimeout(() => setDismissedVersion('current'), 3500);
    return () => window.clearTimeout(timer);
  }, [state?.status]);
  if (!visible || !state) return null;
  const busy = ['downloading', 'preparing', 'installing'].includes(state.status);
  const progress = Math.max(0, Math.min(100, Number(state.progress) || 0));
  return (
    <aside className="fixed left-1/2 top-3 z-[10000] w-[min(420px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-md border border-white/15 bg-[#101216]/95 text-zinc-100 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5">{busy ? <RefreshCw className="size-4 animate-spin" /> : <Download className="size-4" />}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{state.status === 'available' ? `发现新版本 ${state.version}` : state.message || '客户端更新'}</div>
          {state.status === 'available' ? <div className="mt-1 text-[11px] text-zinc-400">当前版本 {state.currentVersion}，更新不会覆盖本地工程和素材。</div> : null}
          {state.status === 'downloading' ? <div className="mt-2"><div className="mb-1 flex justify-between text-[10px] text-zinc-400"><span>{progress.toFixed(0)}%</span><span>{formatRate(state.bytesPerSecond)}</span></div><div className="h-1 overflow-hidden bg-white/10"><div className="h-full bg-amber-400 transition-[width] duration-300" style={{ width: `${progress}%` }} /></div></div> : null}
          {state.status === 'error' ? <div className="mt-1 break-words text-[11px] text-red-300">{state.message}</div> : null}
          <div className="mt-3 flex items-center gap-2">
            {state.status === 'available' ? <button type="button" onClick={() => void window.magineDesktop?.updateDownload?.()} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-400 px-3 text-[12px] font-medium text-black hover:bg-amber-300"><Download className="size-3.5" />下载更新</button> : null}
            {state.status === 'downloaded' ? <button type="button" onClick={() => void window.magineDesktop?.updateInstall?.()} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-400 px-3 text-[12px] font-medium text-black hover:bg-amber-300"><RotateCcw className="size-3.5" />重启并安装</button> : null}
            {state.status === 'error' ? <button type="button" onClick={() => void window.magineDesktop?.updateCheck?.()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 px-3 text-[12px] hover:bg-white/5"><RefreshCw className="size-3.5" />重新检查</button> : null}
          </div>
        </div>
        {!busy ? <button type="button" title="关闭" onClick={() => setDismissedVersion(state.version || state.status)} className="grid size-7 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-white/8 hover:text-white"><X className="size-4" /></button> : null}
      </div>
    </aside>
  );
}
