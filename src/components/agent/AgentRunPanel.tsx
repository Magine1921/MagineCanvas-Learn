'use client';

import { Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveAgentRunConversation, useAgentRunStore } from '@/lib/agent-run-store';
import type { AgentRun, AgentRunStatus } from './agent-types';

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  queued: '排队中',
  running: '执行中',
  waiting: '等待中',
  cancelling: '取消中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '可恢复',
};

function statusClass(status: AgentRunStatus): string {
  if (status === 'completed') return 'text-emerald-200/85';
  if (status === 'failed') return 'text-red-200/90';
  if (status === 'interrupted') return 'text-amber-200/90';
  if (status === 'running' || status === 'waiting') return 'text-sky-200/90';
  return 'text-zinc-400';
}

export interface AgentConversationRecord {
  id: string;
  title: string;
  preview: string;
  latestRun: AgentRun;
  runs: AgentRun[];
}

function fallbackPreview(run: AgentRun): string {
  const conversation = resolveAgentRunConversation(run);
  const message = [...conversation]
    .reverse()
    .find((item) => item.role !== 'system' && item.content.trim());
  return message?.content.replace(/\s+/gu, ' ').trim() || run.events.at(-1)?.summary || '';
}

export function groupAgentRunsByConversation(runs: AgentRun[]): AgentConversationRecord[] {
  const groups = new Map<string, AgentConversationRecord>();
  for (const run of [...runs].sort((left, right) => right.updatedAt - left.updatedAt)) {
    const id = run.conversationId || run.id;
    const existing = groups.get(id);
    if (existing) {
      existing.runs.push(run);
      continue;
    }
    groups.set(id, {
      id,
      title: run.conversationTitle?.trim() || run.goal.trim() || '新对话',
      preview: run.conversationPreview?.trim() || fallbackPreview(run),
      latestRun: run,
      runs: [run],
    });
  }
  return [...groups.values()];
}

export function AgentRunPanel({
  onClose,
  onOpenRun,
}: {
  onClose: () => void;
  onOpenRun: (run: AgentRun) => void;
}) {
  const storedRuns = useAgentRunStore((state) => state.runs);
  const storedTasks = useAgentRunStore((state) => state.tasks);
  const activeRunId = useAgentRunStore((state) => state.activeRunId);
  const removeConversation = useAgentRunStore((state) => state.removeConversation);
  const clearFinishedRuns = useAgentRunStore((state) => state.clearFinishedRuns);
  const conversations = groupAgentRunsByConversation(storedRuns).slice(0, 12);

  return (
    <div className="absolute right-3 top-11 z-[70] w-[340px] overflow-hidden rounded-lg border border-white/16 bg-zinc-950/88 shadow-2xl backdrop-blur-xl">
      <div className="flex h-9 items-center border-b border-white/10 px-3">
        <div className="min-w-0 flex-1 text-[11px] font-medium text-zinc-100">Agent 任务记录</div>
        <button
          type="button"
          onClick={clearFinishedRuns}
          className="mr-2 text-[9px] text-zinc-500 hover:text-zinc-200"
        >
          清理已结束
        </button>
        <button
          type="button"
          title="关闭任务记录"
          onClick={onClose}
          className="flex h-5 w-5 items-center justify-center text-zinc-500 hover:text-zinc-100"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="max-h-[300px] overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <div className="px-2 py-6 text-center text-[10px] text-zinc-500">暂无任务记录</div>
        ) : (
          conversations.map((conversation) => {
            const run = conversation.latestRun;
            const runTasks = storedTasks.filter((task) => task.runId === run.id).slice(0, 4);
            const openingBlocked = Boolean(
              activeRunId && !conversation.runs.some((item) => item.id === activeRunId),
            );
            return (
              <div
                key={conversation.id}
                className="relative mb-1.5 overflow-hidden rounded-md border border-white/8 bg-white/[0.035] transition-colors last:mb-0 hover:border-white/16 hover:bg-white/[0.06] focus-within:border-white/18"
              >
                <button
                  type="button"
                  title={openingBlocked ? '当前任务执行完成后可打开此对话' : `打开对话：${conversation.title}`}
                  aria-label={`打开任务对话：${conversation.title}`}
                  disabled={openingBlocked}
                  onClick={() => onOpenRun(run)}
                  className="block w-full px-2.5 py-2 pr-9 text-left disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-100" title={conversation.title}>
                      {conversation.title}
                    </div>
                    <span className={`shrink-0 text-[9px] ${statusClass(run.status)}`}>
                      {STATUS_LABEL[run.status]}
                    </span>
                  </div>
                  <div
                    className="mt-1 line-clamp-2 text-[9px] leading-4 text-zinc-500"
                    title={conversation.preview}
                  >
                    {conversation.preview || '暂无对话摘要'}
                  </div>
                  {runTasks.length > 0 ? (
                    <div className="mt-1.5 space-y-0.5 border-t border-white/8 pt-1.5">
                      {runTasks.map((task) => (
                        <div key={task.id} className="flex items-center gap-1.5 text-[9px] text-zinc-400">
                          <span
                            className={cn(
                              'h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600',
                              task.status === 'in_progress' && 'bg-sky-300',
                              task.status === 'completed' && 'bg-emerald-300',
                              task.status === 'failed' && 'bg-red-300',
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">{task.description}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </button>
                <button
                  type="button"
                  title="删除此记录"
                  aria-label={`删除任务记录：${conversation.title}`}
                  onClick={() => removeConversation(conversation.id)}
                  className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-white/[0.08] hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
