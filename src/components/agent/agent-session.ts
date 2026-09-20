import type { CanvasAgentMessage } from './agent-types';
import type { PermissionMode } from './agent-types';

const AUTO_SAVE_KEY = 'magine-agent-autosave';
const AUTO_CONVERSATION_KEY = 'magine-agent-conversation';
const SESSION_PREFIX = 'magine-agent-session-';
const PERMISSION_KEY = 'magine-agent-permission';
const PENDING_OPERATION_PREFIX = 'magine-agent-pending-operation-';
const PENDING_OPERATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const PERMISSION_MODES: PermissionMode[] = ['read-only', 'canvas-write', 'full-access'];

export interface AgentConversationMeta {
  id: string;
  title: string;
  preview: string;
  startedAt: number;
  titleGenerated: boolean;
}

export interface AgentPendingOperation {
  conversationId: string;
  requestText: string;
  createdAt: number;
}

function pendingOperationKey(conversationId: string): string {
  return `${PENDING_OPERATION_PREFIX}${conversationId}`;
}

export function saveAgentPendingOperation(operation: AgentPendingOperation): void {
  if (!operation.conversationId || !operation.requestText.trim()) return;
  try {
    localStorage.setItem(pendingOperationKey(operation.conversationId), JSON.stringify(operation));
  } catch {
    // localStorage unavailable
  }
}

export function loadAgentPendingOperation(conversationId: string): AgentPendingOperation | null {
  if (!conversationId) return null;
  try {
    const key = pendingOperationKey(conversationId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AgentPendingOperation>;
    const valid = Boolean(parsed.conversationId === conversationId
      && typeof parsed.requestText === 'string'
      && parsed.requestText.trim()
      && typeof parsed.createdAt === 'number'
      && Date.now() - parsed.createdAt <= PENDING_OPERATION_MAX_AGE_MS);
    if (!valid) {
      localStorage.removeItem(key);
      return null;
    }
    return {
      conversationId,
      requestText: parsed.requestText!.trim(),
      createdAt: parsed.createdAt!,
    };
  } catch {
    return null;
  }
}

export function clearAgentPendingOperation(conversationId: string): void {
  if (!conversationId) return;
  try {
    localStorage.removeItem(pendingOperationKey(conversationId));
  } catch {
    // localStorage unavailable
  }
}

function createConversationId(): string {
  try {
    return `conversation-${crypto.randomUUID()}`;
  } catch {
    return `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function createAgentConversationMeta(startedAt = Date.now()): AgentConversationMeta {
  return {
    id: createConversationId(),
    title: '新对话',
    preview: '',
    startedAt,
    titleGenerated: false,
  };
}

export function normalizeAgentConversationTitle(value: string): string {
  const normalized = value
    .replace(/<think>[\s\S]*?<\/think>/giu, ' ')
    .replace(/^(?:会话)?标题\s*[:：]\s*/u, '')
    .replace(/^[\s“”"'‘’《》【】]+|[\s“”"'‘’《》【】]+$/gu, '')
    .split(/\r?\n/u)[0]
    .replace(/^[#*\-\d.、\s]+/u, '')
    .replace(/[\s“”"'‘’《》【】。！？!?，,；;：:]+$/gu, '')
    .trim();
  return Array.from(normalized).slice(0, 24).join('');
}

export function resolveAgentConversationPreview(
  messages: CanvasAgentMessage[],
  maxLength = 72,
): string {
  const latest = [...messages]
    .reverse()
    .find((message) =>
      message.role !== 'system' && (
        message.content.trim() || message.textOutputs?.some((output) => output.trim())
      ),
    );
  if (!latest) return '';
  const compact = (latest.content.trim() || latest.textOutputs?.at(-1) || '')
    .replace(/\s+/gu, ' ')
    .trim();
  const chars = Array.from(compact);
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join('')}…` : compact;
}

export function resolveFirstAgentConversationExchange(
  messages: CanvasAgentMessage[],
): { user: string; assistant: string } | null {
  const firstUserIndex = messages.findIndex(
    (message) => message.role === 'user' && message.content.trim(),
  );
  if (firstUserIndex < 0) return null;
  const firstAssistant = messages
    .slice(firstUserIndex + 1)
    .find((message) =>
      message.role === 'assistant' && (
        message.content.trim() || message.textOutputs?.some((output) => output.trim())
      ),
    );
  if (!firstAssistant) return null;
  return {
    user: messages[firstUserIndex].content.trim(),
    assistant: firstAssistant.content.trim() || firstAssistant.textOutputs?.at(-1)?.trim() || '',
  };
}

export function autoSaveConversationMeta(meta: AgentConversationMeta): void {
  try {
    localStorage.setItem(AUTO_CONVERSATION_KEY, JSON.stringify(meta));
  } catch {
    // localStorage unavailable
  }
}

export function autoLoadConversationMeta(): AgentConversationMeta | null {
  try {
    const raw = localStorage.getItem(AUTO_CONVERSATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AgentConversationMeta>;
    if (typeof parsed.id !== 'string' || !parsed.id) return null;
    return {
      id: parsed.id,
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : '新对话',
      preview: typeof parsed.preview === 'string' ? parsed.preview : '',
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : Date.now(),
      titleGenerated: parsed.titleGenerated === true,
    };
  } catch {
    return null;
  }
}

export function loadAgentPermission(): PermissionMode {
  try {
    const saved = localStorage.getItem(PERMISSION_KEY);
    if (saved === 'full-access') return 'canvas-write';
    return PERMISSION_MODES.includes(saved as PermissionMode)
      ? saved as PermissionMode
      : 'canvas-write';
  } catch {
    return 'canvas-write';
  }
}

export function saveAgentPermission(permission: PermissionMode): void {
  try {
    localStorage.setItem(PERMISSION_KEY, permission === 'full-access' ? 'canvas-write' : permission);
  } catch {
    // localStorage unavailable
  }
}

export function autoSaveSession(messages: CanvasAgentMessage[]): void {
  try {
    localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(messages));
  } catch {
    // localStorage full or unavailable
  }
}

export function autoLoadSession(): CanvasAgentMessage[] | null {
  try {
    const raw = localStorage.getItem(AUTO_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as CanvasAgentMessage[];
    return null;
  } catch {
    return null;
  }
}

export function saveSession(
  name: string,
  messages: CanvasAgentMessage[],
  meta: Record<string, unknown>
): void {
  try {
    const data = { messages, meta, savedAt: Date.now() };
    localStorage.setItem(SESSION_PREFIX + name, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function loadSession(
  name: string
): { messages: CanvasAgentMessage[]; meta: Record<string, unknown> } | null {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + name);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function listSessions(): string[] {
  const names: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(SESSION_PREFIX)) {
        names.push(key.replace(SESSION_PREFIX, ''));
      }
    }
  } catch {
    // ignore
  }
  return names;
}
