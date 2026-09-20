import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MemoryEntry, MemoryType } from '@/components/agent/agent-types';

function generateSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ses-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

interface MemoryStoreState {
  memories: MemoryEntry[];
  sessionId: string;

  addMemory(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'originSessionId'>): MemoryEntry;
  updateMemory(id: string, content: string): void;
  deleteMemory(id: string): void;
  getMemoriesByType(type: MemoryType): MemoryEntry[];
  getAllMemories(): MemoryEntry[];
  clearAllMemories(): void;
  getMemoriesForContext(limit?: number, projectId?: string): string;
}

export const useMemoryStore = create<MemoryStoreState>()(
  persist(
    (set, get) => ({
      memories: [],
      sessionId: generateSessionId(),

      addMemory(entry) {
        const memory: MemoryEntry = {
          ...entry,
          id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          originSessionId: get().sessionId,
        };
        set((s) => ({ memories: [memory, ...s.memories] }));
        return memory;
      },

      updateMemory(id, content) {
        set((s) => ({
          memories: s.memories.map((m) =>
            m.id === id ? { ...m, content, updatedAt: Date.now() } : m
          ),
        }));
      },

      deleteMemory(id) {
        set((s) => ({ memories: s.memories.filter((m) => m.id !== id) }));
      },

      getMemoriesByType(type) {
        return get().memories.filter((m) => m.type === type);
      },

      getAllMemories() {
        return get().memories;
      },

      clearAllMemories() {
        set({ memories: [] });
      },

      getMemoriesForContext(limit = 20, projectId) {
        const all = get().memories.filter((memory) => (
          memory.type !== 'project'
          || (!projectId && !memory.projectId)
          || Boolean(projectId && memory.projectId === projectId)
        ));
        if (all.length === 0) return '';

        const recent = [...all]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, limit);

        const userMemories = recent.filter((m) => m.type === 'user');
        const feedbackMemories = recent.filter((m) => m.type === 'feedback');
        const projectMemories = recent.filter((m) => m.type === 'project');

        const lines: string[] = [];

        if (userMemories.length > 0) {
          lines.push('### 用户偏好 (user)');
          for (const m of userMemories) {
            lines.push(`- **${m.name}**: ${m.description}`);
          }
          lines.push('');
        }

        if (feedbackMemories.length > 0) {
          lines.push('### 反馈学习 (feedback)');
          for (const m of feedbackMemories) {
            const howToIdx = m.content.indexOf('**How to apply:**');
            const compact =
              howToIdx !== -1 ? m.content.slice(howToIdx) : m.content.slice(0, 200);
            lines.push(`- **${m.name}**: ${compact}`);
          }
          lines.push('');
        }

        if (projectMemories.length > 0) {
          lines.push('### 项目知识 (project)');
          for (const m of projectMemories) {
            lines.push(`- **${m.name}**: ${m.description}`);
          }
          lines.push('');
        }

        return lines.join('\n');
      },
    }),
    {
      name: 'magine-agent-memories',
      partialize: (state) => ({ memories: state.memories }),
    }
  )
);
