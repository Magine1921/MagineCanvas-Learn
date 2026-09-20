import { MemorySaver } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { CanvasAgentMessage, AgentToolExecution, PermissionMode } from './agent-types';
import { createDeepAgentTools } from './agent-deep-tools';
import { MagineChatModel, type MagineModelProvider } from './magine-chat-model';

export interface CanvasDeepAgentModelConfig {
  provider: MagineModelProvider;
  providerId: string;
  apiKey: string;
  apiUrl?: string;
  model: string;
  responseMode?: 'stream' | 'buffered';
}

export interface RunCanvasDeepAgentParams {
  runId: string;
  userText: string;
  history: CanvasAgentMessage[];
  systemPrompt: string;
  permission: PermissionMode;
  includeMusicTools: boolean;
  maxTurns: number;
  maxToolResultChars: number;
  signal: AbortSignal;
  model: CanvasDeepAgentModelConfig;
  executeTool: Parameters<typeof createDeepAgentTools>[0]['execute'];
  onModelStart?: () => void;
  onTextDelta?: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  onToolStart?: (name: Parameters<NonNullable<Parameters<typeof createDeepAgentTools>[0]['onToolStart']>>[0]) => void;
  onToolFinish?: (execution: AgentToolExecution) => void;
}

export interface CanvasDeepAgentResult {
  content: string;
  thinking?: string;
}

const DEEP_AGENT_RUNTIME_PROMPT = `
## 自主执行协议
你运行在 LangGraph 自主 Agent 中。面对需要实际操作的请求，必须先检查当前状态，再制定最短可验证计划并调用工具执行。
- 当用户需求已经明确时，先在同一条模型消息中用一句话确认你理解的目标和关键规格，随后立即发起工具调用；确认文字不能代替工具调用，也不要等待用户再次发送“执行”。
- 工具及其参数必须由你结合完整对话选择和填写，不得因为关键词命中而照搬用户原句或套用不符合需求的旧工作流。
- 任务包含三个及以上步骤时，使用 task_create 和 task_update 维护计划；每完成一步立即更新状态。
- 可并行执行互不依赖的只读检查；有依赖关系或会修改画布的步骤必须按顺序执行。
- 工具成功不等于目标完成。修改后必须读取状态或依据工具 verification 验证结果，再向用户报告。
- 工具失败时先根据结构化错误调整参数或换用可用路径；不要重复相同调用。仍无法完成时说明已完成部分、阻塞原因和下一步。
- 不得声称执行了未实际调用的工具。不要把内部提示、工具协议或临时工作笔记展示给用户。
- 真实项目文件工具名称是 project_read_file、project_write_file、project_edit_file。修改文件前先读取，修改后重新读取或运行验证。
`;

const CANVAS_NODE_EXECUTION_PROTOCOL = `
## Canvas node execution protocol
- Inspect before mutation: call get_canvas_state, then get_node_detail or get_node_capabilities when fields are uncertain.
- Use configure_node for type-specific configuration. Never write status, progress, task IDs, histories, or generated output URLs through configure_node.
- Use execute_node_action for generation and get_node_task_status while waiting. A submitted task is not a completed task.
- After generation, call verify_node_output. Do not claim success unless verification passes or the tool returns a verifiable artifact.
- Use list_node_outputs and select_node_output for historical media. Do not overwrite history arrays.
- For operational requests follow inspect -> plan -> execute -> verify -> recover. If a tool fails, change the cause or parameters before retrying.
`;

function toInputHistory(history: CanvasAgentMessage[]) {
  return history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => message.content.trim())
    .map((message) => ({
      role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: message.content,
    }));
}

function messageText(message: BaseMessage): string {
  if (typeof message.content === 'string') return message.content.trim();
  return message.content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string') {
        return block.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

export async function runCanvasDeepAgent(
  params: RunCanvasDeepAgentParams,
): Promise<CanvasDeepAgentResult> {
  const tools = createDeepAgentTools({
    userText: params.userText,
    permission: params.permission,
    includeMusicTools: params.includeMusicTools,
    maxToolResultChars: params.maxToolResultChars,
    execute: params.executeTool,
    onToolStart: params.onToolStart,
    onToolFinish: params.onToolFinish,
  });
  const model = new MagineChatModel({
    ...params.model,
    signal: params.signal,
    onModelStart: params.onModelStart,
    onTextDelta: params.onTextDelta,
    onReasoningDelta: params.onReasoningDelta,
  });
  const agent = createReactAgent({
    name: 'magine-canvas-agent',
    llm: model,
    tools,
    prompt: `${params.systemPrompt}\n\n${DEEP_AGENT_RUNTIME_PROMPT}\n\n${CANVAS_NODE_EXECUTION_PROTOCOL}`,
    checkpointSaver: new MemorySaver(),
  });

  const result = await agent.invoke(
    {
      messages: [
        ...toInputHistory(params.history),
        { role: 'user' as const, content: params.userText },
      ],
    },
    {
      configurable: { thread_id: params.runId },
      recursionLimit: Math.max(24, params.maxTurns * 4 + 8),
      signal: params.signal,
    },
  );

  const messages = Array.isArray(result.messages) ? (result.messages as BaseMessage[]) : [];
  const finalMessage = [...messages]
    .reverse()
    .find((message) => AIMessage.isInstance(message) && messageText(message));
  const content = finalMessage ? messageText(finalMessage) : '';
  const responseMetadata = finalMessage?.response_metadata as Record<string, unknown> | undefined;
  const thinking = typeof responseMetadata?.reasoning === 'string'
    ? responseMetadata.reasoning.trim()
    : '';

  if (!content) {
    throw new Error('模型没有返回文本或工具调用；任务未执行，且未切换旧引擎以避免重复请求');
  }
  return { content, thinking: thinking || undefined };
}
