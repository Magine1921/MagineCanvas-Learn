'use client';

import { Bot, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CanvasAgentFABProps {
  onToggle: () => void;
  isOpen: boolean;
  visible: boolean;
}

export function CanvasAgentFAB({ onToggle, isOpen, visible }: CanvasAgentFABProps) {
  return (
    <button
      type="button"
      data-tutorial-id="canvas-agent-entry"
      onClick={onToggle}
      className={cn(
        'fixed bottom-8 right-8 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-300',
        'bg-gradient-to-br from-indigo-500 to-purple-600',
        'hover:from-indigo-400 hover:to-purple-500',
        'hover:shadow-[0_0_30px_rgba(99,102,241,0.5)]',
        'active:scale-95',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-20 opacity-0 pointer-events-none'
      )}
      title={isOpen ? '关闭 AI 助手' : '打开 AI 助手'}
    >
      {isOpen ? (
        <X className="h-6 w-6 text-white" />
      ) : (
        <Bot className="h-6 w-6 text-white" />
      )}
    </button>
  );
}
