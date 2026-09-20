'use client';

import {
  isValidElement,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { MaterialRef } from '@/lib/material-mentions';
import { MaterialPreviewStrip } from '@/components/canvas/MaterialPreviewStrip';
import { MentionTextarea } from '@/components/canvas/MentionTextarea';

interface ExpandableTextFieldProps {
  title: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  materials?: MaterialRef[];
  children: ReactNode;
}

export function ExpandableTextField({
  title,
  value,
  onChange,
  placeholder,
  materials,
  children,
}: ExpandableTextFieldProps) {
  const [expanded, setExpanded] = useState(false);
  const childMaterials = isValidElement(children)
    ? (children.props as { materials?: MaterialRef[] }).materials
    : undefined;
  const editorMaterials = materials || childMaterials || [];

  useEffect(() => {
    if (!expanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setExpanded(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expanded]);

  const openEditor = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setExpanded(true);
  };

  const closeEditor = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setExpanded(false);
  };

  return (
    <div className="mc-expandable-text-field relative min-h-0 w-full [&_.mention-rich-editor]:!pr-10 [&>textarea]:!pr-10">
      {children}
      <button
        type="button"
        title={`放大编辑${title}`}
        aria-label={`放大编辑${title}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={openEditor}
        className="nodrag nopan absolute right-1.5 top-1.5 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-white/12 bg-[#242424] text-zinc-400 transition-colors hover:border-white/24 hover:bg-[#303030] hover:text-zinc-100"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
      {expanded && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${title}大编辑面板`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
              className="nodrag nopan nowheel fixed inset-0 z-[10100] flex items-center justify-center bg-black/70 p-6"
            >
              <section className="flex h-[min(78vh,760px)] w-[min(1120px,92vw)] min-h-[360px] flex-col overflow-hidden rounded-lg border border-white/18 bg-[#2a2a2a] shadow-[0_24px_80px_rgba(0,0,0,0.48)]">
                <header className="flex h-12 shrink-0 items-center border-b border-white/10 bg-[#343434] px-4">
                  <span className="truncate text-sm font-medium text-zinc-100">{title}</span>
                  <button
                    type="button"
                    title={`收起${title}`}
                    aria-label={`收起${title}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={closeEditor}
                    className="ml-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-white/12 bg-[#292929] text-zinc-300 transition-colors hover:border-white/25 hover:bg-[#3a3a3a] hover:text-white"
                  >
                    <Minimize2 className="h-4 w-4" />
                  </button>
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-2 bg-[#222222] p-3">
                  <MaterialPreviewStrip
                    materials={editorMaterials}
                    showLabel={false}
                    className="max-h-[92px] shrink-0 overflow-y-auto bg-[#292929]"
                  />
                  <div className="min-h-0 flex-1">
                    <MentionTextarea
                      value={value}
                      onChange={onChange}
                      materials={editorMaterials}
                      placeholder={placeholder}
                      minHeight="min-h-[320px]"
                      minResizeWidth={640}
                      minResizeHeight={320}
                      fillHeight
                      autoFocus
                      className="mc-large-text-editor !border-white/10 !bg-[#222222] text-sm leading-7"
                    />
                  </div>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
