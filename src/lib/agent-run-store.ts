'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AgentRun,
  AgentRunBudget,
  AgentRunEvent,
  AgentRunStatus,
  AgentTrackedTask,
  AgentTrackedTaskStatus,
  AgentToolCall,
  AgentToolResult,
  CanvasAgentMessage,
} from '@/components/agent/agent-types';
import { DEFAULT_AGENT_RUN_BUDGET } from '@/components/agent/agent-runtime';

const MAX_RUNS = 40;
const MAX_EVENTS_PER_RUN = 300;

function snapshotRunConversation(messages: CanvasAgentMessage[]): CanvasAgentMessage[] {
  return messages.map((message) => ({
    ...message,
    thinkingOutputs: message.thinkingOutputs ? [...message.thinkingOutputs] : undefined,
    textOutputs: message.textOutputs ? [...message.textOutputs] : undefined,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
    toolExecutions: message.toolExecutions?.map((execution) => ({
      ...execution,
      tool: {
        ...execution.tool,
        params: { ...execution.tool.params },
      },
      result: {
        ...execution.result,
        error: execution.result.error ? { ...execution.result.error } : undefined,
        artifacts: execution.result.artifacts?.map((artifact) => ({
          ...artifact,
          metadata: artifact.metadata ? { ...artifact.metadata } : undefined,
        })),
        verification: execution.result.verification
          ? { ...execution.result.verification }
          : undefined,
      },
    })),
    sources: message.sources?.map((source) => ({ ...source })),
  }));
}

export function resolveAgentRunConversation(run: AgentRun): CanvasAgentMessage[] {
  if (run.conversation?.length) return snapshotRunConversation(run.conversation);

  const eventSummaries = run.events
    .filter((event) => event.type !== 'run_started' && event.type !== 'model_turn')
    .slice(-6)
    .map((event) => event.summary.trim())
    .filter(Boolean);
  const statusSummary = run.lastError
    ? `任务执行失败：${run.lastError}`
    : run.status === 'completed'
      ? '任务已完成。'
      : run.status === 'interrupted'
        ? '任务已中断，可以在此继续补充要求。'
        : `任务当前状态：${run.status}`;

  return [
    { role: 'user', content: run.goal, createdAt: run.createdAt },
    {
      role: 'assistant',
      content: [statusSummary, ...eventSummaries].join('\n'),
      createdAt: run.finishedAt || run.updatedAt,
    },
  ];
}

function makeId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function terminalStatus(status: AgentRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function appendEvent(run: AgentRun, event: AgentRunEvent): AgentRun {
  return {
    ...run,
    updatedAt: event.at,
    events: [...run.events, event].slice(-MAX_EVENTS_PER_RUN),
  };
}

type AgentRunStoreState = {
  runs: AgentRun[];
  tasks: AgentTrackedTask[];
  activeRunId: string | null;
  createRun(args: {
    goal: string;
    provider: string;
    model: string;
    conversationId?: string;
    conversationTitle?: string;
    conversationPreview?: string;
    budget?: Partial<AgentRunBudget>;
    resumedFromRunId?: string;
    conversation?: CanvasAgentMessage[];
  }): AgentRun;
  setStatus(runId: string, status: AgentRunStatus, summary?: string): void;
  recordEvent(runId: string, event: Omit<AgentRunEvent, 'id' | 'at'> & { at?: number }): void;
  recordToolStarted(runId: string, executionId: string, tool: AgentToolCall): void;
  recordToolFinished(
    runId: string,
    executionId: string,
    tool: AgentToolCall,
    result: AgentToolResult,
    durationMs: number,
  ): void;
  updateCounters(runId: string, patch: { turns?: number; toolCalls?: number; contextSummary?: string }): void;
  saveConversation(runId: string, messages: CanvasAgentMessage[]): void;
  updateConversationMetadata(
    conversationId: string,
    patch: { title?: string; preview?: string },
  ): void;
  recoverInterruptedRuns(): number;
  latestInterruptedRun(): AgentRun | null;
  createTask(description: string, parentId?: string, runId?: string): AgentTrackedTask;
  updateTask(taskId: string, status: AgentTrackedTaskStatus): AgentTrackedTask | null;
  getTask(taskId: string): AgentTrackedTask | null;
  removeRun(runId: string): void;
  removeConversation(conversationId: string): void;
  clearFinishedRuns(): void;
};

export const useAgentRunStore = create<AgentRunStoreState>()(
  persist(
    (set, get) => ({
      runs: [],
      tasks: [],
      activeRunId: null,

      createRun(args) {
        const now = Date.now();
        const run: AgentRun = {
          id: makeId('run'),
          conversationId: args.conversationId,
          conversationTitle: args.conversationTitle,
          conversationPreview: args.conversationPreview,
          goal: args.goal,
          status: 'running',
          provider: args.provider,
          model: args.model,
          budget: { ...DEFAULT_AGENT_RUN_BUDGET, ...(args.budget || {}) },
          createdAt: now,
          updatedAt: now,
          startedAt: now,
          turns: 0,
          toolCalls: 0,
          resumedFromRunId: args.resumedFromRunId,
          conversation: args.conversation?.length
            ? snapshotRunConversation(args.conversation)
            : undefined,
          events: [
            {
              id: makeId('evt'),
              type: 'run_started',
              at: now,
              summary: args.resumedFromRunId ? '从中断检查点恢复任务' : '任务已开始',
            },
          ],
        };
        set((state) => ({
          runs: [run, ...state.runs].slice(0, MAX_RUNS),
          activeRunId: run.id,
        }));
        return run;
      },

      setStatus(runId, status, summary) {
        const now = Date.now();
        set((state) => ({
          activeRunId: terminalStatus(status) && state.activeRunId === runId ? null : state.activeRunId,
          runs: state.runs.map((run) => {
            if (run.id !== runId) return run;
            const next = appendEvent(run, {
              id: makeId('evt'),
              type:
                status === 'completed'
                  ? 'run_completed'
                  : status === 'failed'
                    ? 'error'
                    : status === 'cancelled'
                      ? 'run_cancelled'
                      : 'checkpoint',
              at: now,
              summary: summary || `任务状态更新为 ${status}`,
            });
            return {
              ...next,
              status,
              finishedAt: terminalStatus(status) ? now : undefined,
              lastError: status === 'failed' ? summary : next.lastError,
            };
          }),
        }));
      },

      recordEvent(runId, event) {
        const at = event.at ?? Date.now();
        set((state) => ({
          runs: state.runs.map((run) =>
            run.id === runId
              ? appendEvent(run, { ...event, id: makeId('evt'), at })
              : run,
          ),
        }));
      },

      recordToolStarted(runId, executionId, tool) {
        get().recordEvent(runId, {
          type: 'tool_started',
          executionId,
          tool: tool.name,
          summary: `开始执行 ${tool.name}`,
        });
      },

      recordToolFinished(runId, executionId, tool, result, durationMs) {
        get().recordEvent(runId, {
          type: 'tool_finished',
          executionId,
          tool: tool.name,
          summary: result.message.slice(0, 600),
          success: result.success,
          durationMs,
          verification: result.verification,
          error: result.error,
        });
      },

      updateCounters(runId, patch) {
        set((state) => ({
          runs: state.runs.map((run) =>
            run.id === runId
              ? {
                  ...run,
                  turns: patch.turns ?? run.turns,
                  toolCalls: patch.toolCalls ?? run.toolCalls,
                  contextSummary: patch.contextSummary ?? run.contextSummary,
                  updatedAt: Date.now(),
                }
              : run,
          ),
        }));
      },

      saveConversation(runId, messages) {
        const conversation = snapshotRunConversation(messages);
        set((state) => ({
          runs: state.runs.map((run) =>
            run.id === runId
              ? { ...run, conversation, updatedAt: Date.now() }
              : run,
          ),
        }));
      },

      updateConversationMetadata(conversationId, patch) {
        set((state) => ({
          runs: state.runs.map((run) =>
            (run.conversationId || run.id) === conversationId
              ? {
                  ...run,
                  conversationTitle: patch.title ?? run.conversationTitle,
                  conversationPreview: patch.preview ?? run.conversationPreview,
                  updatedAt: Date.now(),
                }
              : run,
          ),
        }));
      },

      recoverInterruptedRuns() {
        let recovered = 0;
        const now = Date.now();
        set((state) => ({
          activeRunId: null,
          runs: state.runs.map((run) => {
            if (run.status !== 'running' && run.status !== 'waiting' && run.status !== 'cancelling') {
              return run;
            }
            recovered += 1;
            return appendEvent(
              { ...run, status: 'interrupted' },
              {
                id: makeId('evt'),
                type: 'checkpoint',
                at: now,
                summary: '检测到应用上次未正常结束，任务已转为可恢复状态',
              },
            );
          }),
        }));
        return recovered;
      },

      latestInterruptedRun() {
        return (
          get().runs
            .filter((run) => run.status === 'interrupted')
            .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null
        );
      },

      createTask(description, parentId, runId) {
        const now = Date.now();
        const task: AgentTrackedTask = {
          id: makeId('task'),
          description,
          status: 'pending',
          runId,
          parentId,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ tasks: [task, ...state.tasks].slice(0, 200) }));
        return task;
      },

      updateTask(taskId, status) {
        let updated: AgentTrackedTask | null = null;
        set((state) => ({
          tasks: state.tasks.map((task) => {
            if (task.id !== taskId) return task;
            updated = { ...task, status, updatedAt: Date.now() };
            return updated;
          }),
        }));
        return updated;
      },

      getTask(taskId) {
        return get().tasks.find((task) => task.id === taskId) || null;
      },

      removeRun(runId) {
        set((state) => ({
          runs: state.runs.filter((run) => run.id !== runId),
          tasks: state.tasks.filter((task) => task.runId !== runId),
          activeRunId: state.activeRunId === runId ? null : state.activeRunId,
        }));
      },

      removeConversation(conversationId) {
        set((state) => {
          const removedIds = new Set(
            state.runs
              .filter((run) => (run.conversationId || run.id) === conversationId)
              .map((run) => run.id),
          );
          return {
            runs: state.runs.filter((run) => !removedIds.has(run.id)),
            tasks: state.tasks.filter((task) => !task.runId || !removedIds.has(task.runId)),
            activeRunId: state.activeRunId && removedIds.has(state.activeRunId)
              ? null
              : state.activeRunId,
          };
        });
      },

      clearFinishedRuns() {
        set((state) => {
          const removedIds = new Set(
            state.runs.filter((run) => terminalStatus(run.status)).map((run) => run.id),
          );
          return {
            runs: state.runs.filter((run) => !removedIds.has(run.id)),
            tasks: state.tasks.filter((task) => !task.runId || !removedIds.has(task.runId)),
          };
        });
      },
    }),
    {
      name: 'magine-agent-runs-v1',
      merge: (persisted, current) => {
        const stored = (persisted || {}) as Partial<AgentRunStoreState>;
        return {
          ...current,
          ...stored,
          runs: Array.isArray(stored.runs) ? stored.runs : [],
          tasks: Array.isArray(stored.tasks) ? stored.tasks : [],
          activeRunId: typeof stored.activeRunId === 'string' ? stored.activeRunId : null,
        };
      },
      partialize: (state) => ({
        runs: state.runs,
        tasks: state.tasks,
        activeRunId: state.activeRunId,
      }),
    },
  ),
);
