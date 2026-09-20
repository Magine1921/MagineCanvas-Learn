import type { CanvasAgentMessage, PermissionMode, AgentToolCall } from './agent-types';
import { useUserProfileStore } from '@/lib/user-profile-store';
import { useMemoryStore } from '@/lib/memory-store';

export interface SlashCommandContext {
  messages: CanvasAgentMessage[];
  setMessages: (msgs: CanvasAgentMessage[] | ((prev: CanvasAgentMessage[]) => CanvasAgentMessage[])) => void;
  permission: PermissionMode;
  setPermission: (mode: PermissionMode) => void;
  provider: string;
  currentModel: string;
  fastMode: boolean;
  setFastMode: (v: boolean) => void;
  planMode: boolean;
  setPlanMode: (v: boolean) => void;
  voiceListening: boolean;
  toggleVoice: () => void;
  tokenUsage: { total: number };
  undo: () => void;
  redo: () => void;
  clearCanvas: () => void;
  readFile: (path: string) => Promise<string>;
  globSearch: (pattern: string) => Promise<string[]>;
  grepSearch: (pattern: string, include?: string) => Promise<Array<{ file: string; line: number; content: string }>>;
  saveSession: (name: string) => void;
  loadSession: (name: string) => { messages: CanvasAgentMessage[]; meta: Record<string, unknown> } | null;
  listSessions: () => string[];
}

type SlashResult = { type: 'message'; content: string } | { type: 'action'; content: string; tool: AgentToolCall } | null;

export function executeSlashCommand(input: string, ctx: SlashCommandContext): SlashResult {
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const rest = parts.slice(1).join(' ');

  switch (cmd) {
    case '/help':
      return {
        type: 'message',
        content: [
          '可用命令：',
          '/help — 显示帮助',
          '/clear — 清空聊天',
          '/undo — 撤销',
          '/redo — 重做',
          '/permission <mode> — 设置权限（read-only|canvas-write|full-access）',
          '/model <name> — 切换模型',
          '/save <name> — 保存会话',
          '/load <name> — 加载会话',
          '/sessions — 列出已保存会话',
          '/status — 查看当前状态',
          '/voice — 切换语音',
          '/name [新称呼] — 查看或修改 AI 对你的称呼',
          '/memories — 查看已记录的记忆',
          '/forget <id> — 删除指定记忆',
        ].join('\n'),
      };

    case '/clear':
      ctx.setMessages([]);
      return { type: 'message', content: '聊天已清空。' };

    case '/undo':
      ctx.undo();
      return { type: 'message', content: '已撤销。' };

    case '/redo':
      ctx.redo();
      return { type: 'message', content: '已重做。' };

    case '/permission': {
      const mode = rest as PermissionMode;
      if (!['read-only', 'canvas-write', 'full-access'].includes(mode)) {
        return { type: 'message', content: '无效权限模式，可用：read-only, canvas-write, full-access' };
      }
      ctx.setPermission(mode);
      return { type: 'message', content: `权限已切换为「${mode}」。` };
    }

    case '/model': {
      if (!rest) return { type: 'message', content: `当前模型：${ctx.provider}/${ctx.currentModel}` };
      return { type: 'message', content: `模型已切换为 ${rest}（请在下拉菜单中手动选择）。` };
    }

    case '/save': {
      if (!rest) return { type: 'message', content: '用法：/save <会话名称>' };
      ctx.saveSession(rest);
      return { type: 'message', content: `会话「${rest}」已保存。` };
    }

    case '/load': {
      if (!rest) return { type: 'message', content: '用法：/load <会话名称>' };
      const session = ctx.loadSession(rest);
      if (!session) return { type: 'message', content: `会话「${rest}」不存在。` };
      ctx.setMessages(session.messages);
      return { type: 'message', content: `会话「${rest}」已加载。` };
    }

    case '/sessions': {
      const names = ctx.listSessions();
      return { type: 'message', content: names.length ? `已保存会话：\n${names.map((n) => `- ${n}`).join('\n')}` : '没有已保存的会话。' };
    }

    case '/status':
      return {
        type: 'message',
        content: [
          `权限：${ctx.permission}`,
          `模型：${ctx.provider}/${ctx.currentModel}`,
          `Token：${ctx.tokenUsage.total}`,
          `语音：${ctx.voiceListening ? '开' : '关'}`,
          `消息数：${ctx.messages.length}`,
        ].join('\n'),
      };

    case '/voice':
      ctx.toggleVoice();
      return { type: 'message', content: '语音已切换。' };

    case '/name': {
      if (!rest) {
        const currentName = useUserProfileStore.getState().profile.name;
        return { type: 'message', content: `当前称呼：「${currentName}」。使用 /name 新称呼 来修改。` };
      }
      useUserProfileStore.getState().setName(rest);
      return { type: 'message', content: `好的，以后就叫你「${rest}」了。` };
    }

    case '/memories': {
      const allMems = useMemoryStore.getState().getAllMemories();
      if (allMems.length === 0) return { type: 'message', content: '当前没有任何记忆。' };
      const memLines = allMems
        .slice(0, 10)
        .map((m) => `- [${m.type}] ${m.name}: ${m.description} (${m.id})`)
        .join('\n');
      return { type: 'message', content: `已记录的记忆 (${allMems.length} 条):\n${memLines}` };
    }

    case '/forget': {
      if (!rest) return { type: 'message', content: '用法：/forget <记忆ID>。使用 /memories 查看所有记忆。' };
      const target = useMemoryStore.getState().memories.find((m) => m.id === rest);
      if (!target) return { type: 'message', content: `未找到记忆 ${rest}。` };
      useMemoryStore.getState().deleteMemory(rest);
      return { type: 'message', content: `记忆「${target.name}」已删除。` };
    }

    default:
      return null;
  }
}
