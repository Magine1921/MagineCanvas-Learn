'use client';

import { useEffect, useRef, useState } from 'react';

interface SaveWorkflowPresetDialogProps {
  initialName: string;
  nodeCount: number;
  onCancel: () => void;
  onSave: (name: string) => void;
}

export default function SaveWorkflowPresetDialog({ initialName, nodeCount, onCancel, onSave }: SaveWorkflowPresetDialogProps) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmedName = name.trim();

  return (
    <div
      className="fixed inset-0 z-[300000] flex items-center justify-center bg-black/55 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <form
        className="w-[min(380px,calc(100vw-32px))] rounded-lg border border-white/15 bg-[#171a1c]/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.58)] backdrop-blur-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmedName) onSave(trimmedName);
        }}
      >
        <div className="text-base font-semibold text-zinc-100">保存工作流预设</div>
        <div className="mt-1 text-xs text-zinc-500">将保存已框选的 {nodeCount} 个节点及内部连线</div>
        <label className="mt-5 block text-xs font-medium text-zinc-400" htmlFor="workflow-preset-name">预设名称</label>
        <input
          ref={inputRef}
          id="workflow-preset-name"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
          className="mt-2 h-11 w-full rounded-md border border-white/12 bg-black/30 px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-white/30"
          placeholder="请输入预设名称"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-9 px-4 text-sm text-zinc-400 transition-colors hover:text-zinc-100">取消</button>
          <button type="submit" disabled={!trimmedName} className="h-9 rounded-md border border-white/18 bg-white/10 px-4 text-sm font-medium text-zinc-100 transition-colors hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-40">保存</button>
        </div>
      </form>
    </div>
  );
}
