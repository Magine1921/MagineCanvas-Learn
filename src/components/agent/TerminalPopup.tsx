'use client';

import { memo, useEffect, useRef, useState, useCallback } from 'react';
import { X, Terminal, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TerminalSession {
  command: string;
  cwd?: string;
  resolve: (result: { stdout: string; stderr: string; exitCode: number }) => void;
}

interface TerminalLine {
  type: 'stdout' | 'stderr' | 'system';
  text: string;
}

export const TerminalPopup = memo(function TerminalPopup({
  session,
}: {
  session: TerminalSession | null;
}) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [status, setStatus] = useState<'running' | 'done' | 'error'>('running');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortedRef = useRef(false);

  const appendLine = useCallback((line: TerminalLine) => {
    setLines((prev) => [...prev.slice(-2000), line]);
  }, []);

  useEffect(() => {
    if (!session) return;

    setLines([]);
    setStatus('running');
    setExitCode(null);
    abortedRef.current = false;

    const controller = new AbortController();

    let fullStdout = '';
    let fullStderr = '';

    appendLine({ type: 'system', text: `$ ${session.command}` });

    (async () => {
      try {
        const res = await fetch('/api/agent/terminal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: session.command, cwd: session.cwd }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          appendLine({ type: 'stderr', text: `HTTP ${res.status}: 请求失败` });
          setStatus('error');
          session.resolve({ stdout: '', stderr: `HTTP ${res.status}`, exitCode: -1 });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            const lines = part.split('\n');
            let eventType = '';
            let data = '';

            for (const line of lines) {
              if (line.startsWith('event: ')) eventType = line.slice(7);
              else if (line.startsWith('data: ')) {
                if (data) data += '\n';
                data += line.slice(6);
              }
            }

            if (eventType === 'stdout' && data) {
              fullStdout += (fullStdout ? '\n' : '') + data;
              appendLine({ type: 'stdout', text: data });
            } else if (eventType === 'stderr' && data) {
              fullStderr += (fullStderr ? '\n' : '') + data;
              appendLine({ type: 'stderr', text: data });
            } else if (eventType === 'close') {
              const code = parseInt(data, 10);
              setExitCode(code);
              setStatus(code === 0 ? 'done' : 'error');
              appendLine({ type: 'system', text: code === 0 ? '命令执行完成' : `进程退出，退出码：${code}` });
              session.resolve({ stdout: fullStdout, stderr: fullStderr, exitCode: code });
              return;
            } else if (eventType === 'error') {
              fullStderr += (data || '');
              appendLine({ type: 'stderr', text: data || '未知错误' });
              setStatus('error');
              session.resolve({ stdout: fullStdout, stderr: fullStderr + (data || ''), exitCode: -1 });
              return;
            }
          }
        }
      } catch (err) {
        if (abortedRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        appendLine({ type: 'stderr', text: msg });
        setStatus('error');
        session.resolve({ stdout: fullStdout, stderr: msg, exitCode: -1 });
      }
    })();

    return () => {
      abortedRef.current = true;
      controller.abort();
    };
  }, [session?.command, session?.cwd]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  if (!session) return null;

  const handleClose = () => {
    abortedRef.current = true;
    session.resolve({ stdout: '', stderr: '用户关闭终端', exitCode: -1 });
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

      <div
        className="relative z-10 w-[600px] max-w-[92vw] rounded-2xl border border-white/12 shadow-2xl overflow-hidden"
        style={{
          background: 'rgba(10, 12, 14, 0.95)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
          <Terminal className={cn(
            'h-4 w-4',
            status === 'running' ? 'text-emerald-400 animate-pulse' :
            status === 'done' ? 'text-emerald-400' : 'text-rose-400'
          )} />
          <span className="text-xs font-medium text-zinc-300">终端</span>
          <span className="truncate text-[10px] text-zinc-500 ml-1">{session.command.slice(0, 60)}</span>

          <div className="ml-auto flex items-center gap-1.5">
            {status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />}
            {status === 'done' && <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />}
            {status === 'error' && exitCode !== -1 && <AlertCircle className="h-3.5 w-3.5 text-rose-400" />}
            {exitCode != null && (
              <span className={cn(
                'text-[10px] font-mono',
                exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'
              )}>
                exit: {exitCode}
              </span>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="ml-1 flex h-5 w-5 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] text-zinc-500 hover:text-zinc-200"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Terminal output */}
        <div
          ref={scrollRef}
          className="overflow-y-auto p-3 font-mono text-[11px] leading-relaxed max-h-[400px]"
          style={{ background: 'rgba(0,0,0,0.35)' }}
        >
          {lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                'whitespace-pre-wrap break-all',
                line.type === 'stdout' && 'text-emerald-50',
                line.type === 'stderr' && 'text-amber-300',
                line.type === 'system' && 'text-zinc-500'
              )}
            >
              {line.text || ' '}
            </div>
          ))}
          {status === 'running' && (
            <span className="inline-block w-2 h-4 bg-emerald-400 animate-pulse ml-0.5 align-middle" />
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
});
