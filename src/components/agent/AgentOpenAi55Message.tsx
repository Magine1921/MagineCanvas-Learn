'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Clipboard, Download, Expand, FileText, Pencil, X } from 'lucide-react';
import {
  parseOpenAi55MessageLayout,
  replaceOpenAi55ArtifactBody,
} from '@/lib/agent-openai55-layout';
import { cn } from '@/lib/utils';

function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${index}-${part}`} className="font-semibold text-zinc-100">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${index}-${part}`} className="rounded bg-black/30 px-1 py-0.5 text-[0.92em] text-zinc-200">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function OpenAi55Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2.5 text-[15px] leading-7 text-zinc-200">
      {text.split(/\r?\n/).map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <div key={`space-${index}`} className="h-1" aria-hidden />;
        const heading = /^(#{1,3})\s+(.+)$/.exec(line);
        if (heading) {
          const level = heading[1].length;
          return (
            <div
              key={`heading-${index}`}
              className={cn('font-semibold text-zinc-50', level === 1 ? 'text-lg' : level === 2 ? 'text-base' : 'text-[15px]')}
            >
              {renderInlineMarkdown(heading[2])}
            </div>
          );
        }
        const bullet = /^[-*+]\s+(.+)$/.exec(line);
        if (bullet) {
          return (
            <div key={`bullet-${index}`} className="flex items-start gap-2 pl-1">
              <span className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
              <span>{renderInlineMarkdown(bullet[1])}</span>
            </div>
          );
        }
        const ordered = /^(\d+[.)])\s+(.+)$/.exec(line);
        if (ordered) {
          return (
            <div key={`ordered-${index}`} className="flex items-start gap-2 pl-1">
              <span className="shrink-0 text-zinc-500">{ordered[1]}</span>
              <span>{renderInlineMarkdown(ordered[2])}</span>
            </div>
          );
        }
        return <p key={`line-${index}`}>{renderInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

function iconButtonClass(active = false): string {
  return cn(
    'nodrag nopan flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-zinc-400 transition-colors hover:bg-white/[0.07] hover:text-zinc-100',
    active ? 'border-white/20 bg-white/[0.08] text-zinc-100' : 'border-transparent',
  );
}

export function AgentOpenAi55Message({
  content,
  disabled = false,
  onChange,
}: {
  content: string;
  disabled?: boolean;
  onChange: (nextContent: string) => void;
}) {
  const layout = useMemo(() => parseOpenAi55MessageLayout(content), [content]);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState(layout.artifact?.body || '');

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  const saveDraft = () => {
    if (!layout.artifact) return;
    onChange(replaceOpenAi55ArtifactBody(content, draft));
    setEditing(false);
  };

  const copyArtifact = async () => {
    if (!layout.artifact) return;
    try {
      await navigator.clipboard.writeText(editing ? draft : layout.artifact.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const downloadArtifact = () => {
    if (!layout.artifact) return;
    const blob = new Blob([editing ? draft : layout.artifact.body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${layout.artifact.title.replace(/[\\/:*?"<>|]/g, '_') || 'OpenAI 输出'}.md`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const renderArtifactBody = (expandedView = false) => (
    <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3', !expandedView && 'max-h-[360px]')}>
      {editing ? (
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          className={cn(
            'nodrag nopan nowheel w-full resize-none rounded-lg border border-white/12 bg-[#202020] p-4 text-[15px] leading-7 text-zinc-100 outline-none focus:border-white/24',
            expandedView ? 'h-full min-h-[420px]' : 'min-h-[260px]',
          )}
        />
      ) : (
        <OpenAi55Markdown text={layout.artifact?.body || ''} />
      )}
    </div>
  );

  const renderToolbar = () => (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/8 px-3">
      <button
        type="button"
        title={editing ? '完成编辑' : '编辑文档'}
        onClick={editing ? saveDraft : () => {
          setDraft(layout.artifact?.body || '');
          setEditing(true);
        }}
        disabled={disabled}
        className={cn('nodrag nopan flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40', editing ? 'border-white/18 bg-white/[0.08] text-zinc-100' : 'border-transparent text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100')}
      >
        {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
        {editing ? '完成' : '编辑'}
      </button>
      <div className="flex items-center gap-0.5">
        <button type="button" title="复制文档" onClick={() => { void copyArtifact(); }} className={iconButtonClass(copied)}>
          {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
        </button>
        <button type="button" title="下载 Markdown" onClick={downloadArtifact} className={iconButtonClass()}>
          <Download className="h-4 w-4" />
        </button>
        <button type="button" title="放大查看" onClick={() => setExpanded(true)} className={iconButtonClass()}>
          <Expand className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="nodrag nopan w-full max-w-[42rem] text-left">
      {layout.intro ? (
        <div className="mb-2 px-1">
          <OpenAi55Markdown text={layout.intro} />
        </div>
      ) : null}
      {layout.artifact ? (
        <>
          <div className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-1 text-xs text-zinc-400">
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{layout.artifact.title}</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/12 bg-[#292929] shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
            {renderToolbar()}
            {renderArtifactBody()}
          </div>
        </>
      ) : null}
      {expanded && layout.artifact && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/70 p-6" onMouseDown={() => setExpanded(false)}>
              <div
                role="dialog"
                aria-modal="true"
                aria-label={layout.artifact.title}
                className="nodrag nopan nowheel flex h-[min(82vh,820px)] w-[min(92vw,980px)] flex-col overflow-hidden rounded-xl border border-white/16 bg-[#292929] shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="flex h-12 shrink-0 items-center border-b border-white/8 px-4">
                  <FileText className="mr-2 h-4 w-4 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">{layout.artifact.title}</span>
                  <button type="button" title="收起" onClick={() => setExpanded(false)} className={iconButtonClass()}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {renderToolbar()}
                {renderArtifactBody(true)}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
