import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AgentToolCall, AgentToolName } from '@/components/agent/agent-types';
import { useMemoryStore } from '@/lib/memory-store';

const WORK_STYLE_MEMORY_NAME = 'canvas-work-style';
const MAX_EVENTS = 300;
const MAX_ROUTINES = 24;

export type CanvasWorkEventKind =
  | 'node_add'
  | 'node_remove'
  | 'node_update'
  | 'connect'
  | 'layout'
  | 'workflow_setup'
  | 'generation'
  | 'tool_success'
  | 'voice_command';

export interface CanvasWorkEvent {
  kind: CanvasWorkEventKind;
  detail: string;
  at: number;
}

export interface WorkRoutine {
  id: string;
  label: string;
  keywords: string[];
  userHint: string;
  tools: AgentToolCall[];
  successCount: number;
  lastUsedAt: number;
  createdAt: number;
}

interface WorkStyleStats {
  nodeTypes: Record<string, number>;
  layouts: Record<string, number>;
  workflows: Record<string, number>;
  tools: Record<string, number>;
  voiceHints: string[];
}

interface CanvasWorkStyleState {
  events: CanvasWorkEvent[];
  stats: WorkStyleStats;
  routines: WorkRoutine[];
  lastReflectAt: number;
  sessionToolRuns: number;

  recordEvent: (kind: CanvasWorkEventKind, detail: string) => void;
  recordToolSuccess: (tool: AgentToolName, params: Record<string, unknown>) => void;
  recordRoutineFromSession: (userText: string, tools: AgentToolCall[]) => void;
  markRoutineUsed: (id: string) => void;
  findRoutine: (query: string) => WorkRoutine | null;
  getContextMarkdown: () => string;
  reflectToMemory: () => boolean;
}

function bump(map: Record<string, number>, key: string, n = 1) {
  map[key] = (map[key] || 0) + n;
}

function extractKeywords(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const words = t
    .replace(/[，。！？、；：""''（）\s]+/g, ' ')
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && w.length <= 12);
  const extras: string[] = [];
  if (/图|image|seedream|图片/i.test(t)) extras.push('图像');
  if (/视频|video|seedance|即梦/i.test(t)) extras.push('视频');
  if (/音乐|播放|轻音乐/i.test(t)) extras.push('音乐');
  if (/排列|布局|整理/i.test(t)) extras.push('布局');
  return [...new Set([...words.slice(0, 6), ...extras])];
}

function routineLabelFromTools(tools: AgentToolCall[], userText: string): string {
  const names = tools.map((t) => t.name).join(' → ');
  const hint = userText.trim().slice(0, 24);
  return hint ? `${hint}（${names}）` : names;
}

function summarizeStats(stats: WorkStyleStats): string[] {
  const lines: string[] = [];
  const topNodes = Object.entries(stats.nodeTypes).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (topNodes.length) {
    lines.push(`- 常用节点：${topNodes.map(([k, v]) => `${k}×${v}`).join('、')}`);
  }
  const topTools = Object.entries(stats.tools).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (topTools.length) {
    lines.push(`- 常用操作：${topTools.map(([k, v]) => `${k}×${v}`).join('、')}`);
  }
  const topLayouts = Object.entries(stats.layouts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (topLayouts.length) {
    lines.push(`- 偏好布局：${topLayouts.map(([k]) => k).join('、')}`);
  }
  const topWf = Object.entries(stats.workflows).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (topWf.length) {
    lines.push(`- 常用工作流模板：${topWf.map(([k]) => k).join('、')}`);
  }
  return lines;
}

export const useCanvasWorkStyleStore = create<CanvasWorkStyleState>()(
  persist(
    (set, get) => ({
      events: [],
      stats: { nodeTypes: {}, layouts: {}, workflows: {}, tools: {}, voiceHints: [] },
      routines: [],
      lastReflectAt: 0,
      sessionToolRuns: 0,

      recordEvent(kind, detail) {
        const at = Date.now();
        set((s) => ({
          events: [{ kind, detail, at }, ...s.events].slice(0, MAX_EVENTS),
          sessionToolRuns: kind === 'tool_success' ? s.sessionToolRuns + 1 : s.sessionToolRuns,
        }));

        set((s) => {
          const stats = { ...s.stats, voiceHints: [...s.stats.voiceHints] };
          if (kind === 'node_add') {
            const type = detail.split(':')[0]?.trim();
            if (type) bump(stats.nodeTypes, type);
          } else if (kind === 'layout') {
            bump(stats.layouts, detail || 'grid');
          } else if (kind === 'workflow_setup') {
            bump(stats.workflows, detail);
          } else if (kind === 'voice_command') {
            const hint = detail.trim().slice(0, 80);
            if (hint) stats.voiceHints = [hint, ...stats.voiceHints.filter((h) => h !== hint)].slice(0, 20);
          }
          return { stats };
        });
      },

      recordToolSuccess(tool, params) {
        get().recordEvent('tool_success', `${tool} ${JSON.stringify(params).slice(0, 120)}`);
        set((s) => {
          const stats = { ...s.stats };
          bump(stats.tools, tool);
          return { stats, sessionToolRuns: s.sessionToolRuns + 1 };
        });
      },

      recordRoutineFromSession(userText, tools) {
        const canvasTools = tools.filter((t) =>
          /^(add_node|remove_node|update_node|connect_nodes|disconnect_nodes|arrange_nodes|setup_workflow|run_generation|music_)/.test(
            t.name,
          ),
        );
        if (canvasTools.length < 2) return;

        const keywords = extractKeywords(userText);
        const label = routineLabelFromTools(canvasTools, userText);
        const fingerprint = canvasTools.map((t) => `${t.name}:${JSON.stringify(t.params)}`).join('|');

        set((s) => {
          const existing = s.routines.find(
            (r) => r.tools.map((t) => `${t.name}:${JSON.stringify(t.params)}`).join('|') === fingerprint,
          );
          if (existing) {
            return {
              routines: s.routines.map((r) =>
                r.id === existing.id
                  ? {
                      ...r,
                      successCount: r.successCount + 1,
                      lastUsedAt: Date.now(),
                      keywords: [...new Set([...r.keywords, ...keywords])].slice(0, 12),
                    }
                  : r,
              ),
            };
          }

          const routine: WorkRoutine = {
            id: `routine-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            label,
            keywords,
            userHint: userText.trim().slice(0, 120),
            tools: canvasTools,
            successCount: 1,
            lastUsedAt: Date.now(),
            createdAt: Date.now(),
          };
          return { routines: [routine, ...s.routines].slice(0, MAX_ROUTINES) };
        });
      },

      markRoutineUsed(id) {
        set((s) => ({
          routines: s.routines.map((r) =>
            r.id === id ? { ...r, successCount: r.successCount + 1, lastUsedAt: Date.now() } : r,
          ),
        }));
      },

      findRoutine(query) {
        const q = query.trim().toLowerCase();
        if (!q) return null;
        const { routines } = get();
        const replayHints = /像上次|再来一遍|同样的|重复|照上次|再来一次|老样子/;
        const search = replayHints.test(q) ? q.replace(replayHints, '').trim() || q : q;

        let best: WorkRoutine | null = null;
        let bestScore = 0;
        for (const r of routines) {
          let score = 0;
          if (r.label.toLowerCase().includes(search)) score += 5;
          if (r.userHint.toLowerCase().includes(search)) score += 4;
          for (const kw of r.keywords) {
            if (search.includes(kw.toLowerCase()) || kw.toLowerCase().includes(search)) score += 2;
          }
          if (replayHints.test(q)) score += r.successCount * 0.1 + (r.lastUsedAt / 1e15);
          if (score > bestScore) {
            bestScore = score;
            best = r;
          }
        }
        return bestScore >= 2 || (replayHints.test(q) && best) ? best : null;
      },

      getContextMarkdown() {
        const { stats, routines, events } = get();
        const statLines = summarizeStats(stats);
        const recent = events.slice(0, 12).map((e) => `- [${e.kind}] ${e.detail}`).join('\n');
        const routineLines = routines
          .slice(0, 8)
          .map(
            (r) =>
              `- **${r.label}**（成功×${r.successCount}，关键词：${r.keywords.slice(0, 5).join('、') || '无'}）`,
          )
          .join('\n');

        const parts: string[] = [];
        if (statLines.length) {
          parts.push('### 统计画像', statLines.join('\n'));
        }
        if (routineLines) {
          parts.push(
            '### 可复现套路',
            '用户说「像上次一样」「再来一遍」时，优先用 `replay_work_routine` 匹配以下套路：',
            routineLines,
          );
        }
        if (recent) {
          parts.push('### 近期操作轨迹', recent);
        }
        if (stats.voiceHints.length) {
          parts.push(`### 近期语音指令`, stats.voiceHints.slice(0, 8).map((h) => `- ${h}`).join('\n'));
        }
        return parts.join('\n\n');
      },

      reflectToMemory() {
        const ctx = get().getContextMarkdown();
        if (!ctx.trim()) return false;

        const description = '画布工作风格与可复现操作套路（系统自动学习）';
        const content = `# 画布工作风格\n\n${ctx}\n\n**How to apply:**\n- 新任务前先 recall_work_style / recall_memories\n- 用户要求重复操作时调用 replay_work_routine\n- 默认沿用上述常用节点、布局与工作流偏好`;

        const memStore = useMemoryStore.getState();
        const existing = memStore.memories.find((m) => m.name === WORK_STYLE_MEMORY_NAME);
        if (existing) {
          memStore.updateMemory(existing.id, content);
        } else {
          memStore.addMemory({
            name: WORK_STYLE_MEMORY_NAME,
            description,
            type: 'user',
            content,
          });
        }
        set({ lastReflectAt: Date.now() });
        return true;
      },
    }),
    {
      name: 'magine-canvas-work-style',
      partialize: (s) => ({
        events: s.events,
        stats: s.stats,
        routines: s.routines,
        lastReflectAt: s.lastReflectAt,
      }),
    },
  ),
);

export function getWorkStyleContextForPrompt(): string {
  return useCanvasWorkStyleStore.getState().getContextMarkdown();
}

export function recordCanvasWorkEvent(kind: CanvasWorkEventKind, detail: string) {
  useCanvasWorkStyleStore.getState().recordEvent(kind, detail);
}

export function recordCanvasToolSuccess(tool: AgentToolName, params: Record<string, unknown>) {
  useCanvasWorkStyleStore.getState().recordToolSuccess(tool, params);
}

export function recordCanvasRoutine(userText: string, tools: AgentToolCall[]) {
  useCanvasWorkStyleStore.getState().recordRoutineFromSession(userText, tools);
}

export function findWorkRoutine(query: string) {
  return useCanvasWorkStyleStore.getState().findRoutine(query);
}

export function markWorkRoutineUsed(id: string) {
  useCanvasWorkStyleStore.getState().markRoutineUsed(id);
}

/** 语音：匹配「像上次一样」等并返回可执行工具序列 */
export function matchVoiceWorkRoutine(text: string): AgentToolCall[] | null {
  const routine = findWorkRoutine(text);
  if (!routine) return null;
  markWorkRoutineUsed(routine.id);
  return routine.tools.map((t) => ({ name: t.name, params: { ...t.params } }));
}
