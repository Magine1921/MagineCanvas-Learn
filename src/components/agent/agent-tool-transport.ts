import {
  resolveAgentModelCapabilities,
  type AgentToolTransport,
} from '../../lib/agent-model-capabilities.ts';

export type { AgentToolTransport } from '../../lib/agent-model-capabilities.ts';

/**
 * DeepSeek's OpenAI-compatible streaming responses have historically returned
 * incomplete tool-call deltas. Use a complete non-streaming response for its
 * tool turns so native function arguments arrive atomically.
 */
export function resolveAgentToolTransport(provider: string, model: string): AgentToolTransport {
  return resolveAgentModelCapabilities(provider, model).toolTransport;
}

export function missingAgentToolInstruction(transport: AgentToolTransport): string {
  if (transport === 'text-json') {
    return [
      '这是一个需要实际操作的请求，但你没有输出可执行的工具指令。',
      '请立即在回复末尾输出 JSON 工具调用，不要只描述步骤或声称已经完成。',
      '格式：{"name":"tool_name","params":{...}}',
    ].join('\n');
  }
  return '这是一个需要实际操作的请求，但你没有调用任何工具。请立即使用已提供的原生 function tools 执行，不要输出工具 JSON，不要只描述步骤或声称已经完成。';
}
