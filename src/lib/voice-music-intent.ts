import type { AgentToolCall, AgentToolResult } from '@/components/agent/agent-types';

export type VoiceMusicRoute =
  | { type: 'tool'; call: AgentToolCall }
  | { type: 'recommend_and_play' };

const REMOVED_MUSIC_TOOL_NAMES = new Set([
  'music_search',
  'music_play',
  'music_pause',
  'music_resume',
  'music_next',
  'music_prev',
  'music_set_volume',
  'music_get_state',
  'music_load_playlists',
  'music_play_playlist',
  'music_get_recommend',
]);

export function isAgentMusicToolName(toolName: string): boolean {
  return REMOVED_MUSIC_TOOL_NAMES.has(toolName);
}

export function shouldExposeMusicToolsForUserText(_text?: string): boolean {
  return false;
}

export function routeVoiceMusicIntent(_text: string): VoiceMusicRoute | null {
  return null;
}

export async function tryExecuteVoiceMusicIntent(
  _text: string,
  _runTool: (call: AgentToolCall) => Promise<AgentToolResult>,
): Promise<{ call: AgentToolCall; result: AgentToolResult } | null> {
  return null;
}

export function looksLikeMusicPromiseWithoutTools(
  _userText: string,
  _assistantText: string,
  _executions: Array<{ tool: { name: string } }>,
): boolean {
  return false;
}

export function guardAgentMusicTool(
  toolName: string,
  _userText?: string,
): { allowed: boolean; message?: string } {
  if (!REMOVED_MUSIC_TOOL_NAMES.has(toolName)) return { allowed: true };
  return { allowed: false, message: '音乐播放服务已移除' };
}

export function voiceMusicSummary(result: AgentToolResult): string {
  return result.message.trim() || (result.success ? '操作完成' : '操作失败');
}

export function isMusicCurrentlyPlaying(): boolean {
  return false;
}

export type ProactiveMusicPlayResult =
  | { ok: true; trackName: string; artists: string }
  | { ok: false; reason: 'already_playing' | 'failed'; message?: string };

export async function playProactiveAmbientMusic(
  _query = '轻音乐',
): Promise<ProactiveMusicPlayResult> {
  return { ok: false, reason: 'failed', message: '音乐播放服务已移除' };
}
