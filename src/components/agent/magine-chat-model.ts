import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import {
  AIMessage,
  type AIMessageChunk,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { ChatResult } from '@langchain/core/outputs';
import type { Runnable } from '@langchain/core/runnables';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import { streamClaudeTurn, type AnthropicToolDef, type ClaudeConversationMessage } from '@/lib/claude-agent-stream';
import { streamOpenAIAgentTurn, type OpenAIToolDef } from '@/lib/openai-agent-stream';
import { resolveAgentModelCapabilities } from '@/lib/agent-model-capabilities';

export type MagineModelProvider = 'claude' | 'openai-compatible';

export interface MagineChatModelConfig extends BaseChatModelParams {
  provider: MagineModelProvider;
  providerId: string;
  apiKey: string;
  apiUrl?: string;
  model: string;
  responseMode?: 'stream' | 'buffered';
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  onModelStart?: () => void;
  onTextDelta?: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
}

interface MagineChatModelCallOptions extends BaseChatModelCallOptions {
  tools?: BindToolsInput[];
}

function normalizeToolDefinitions(tools: BindToolsInput[] | undefined): OpenAIToolDef[] {
  return (tools || []).map((input) => {
    const converted = convertToOpenAITool(input as Parameters<typeof convertToOpenAITool>[0]);
    return {
      type: 'function',
      function: {
        name: converted.function.name,
        description: converted.function.description || '',
        parameters: (converted.function.parameters || {
          type: 'object',
          properties: {},
        }) as Record<string, unknown>,
      },
    };
  });
}

function toAnthropicTools(tools: OpenAIToolDef[]): AnthropicToolDef[] {
  return tools.map((toolDefinition) => ({
    name: toolDefinition.function.name,
    description: toolDefinition.function.description,
    input_schema: {
      type: 'object',
      properties:
        (toolDefinition.function.parameters.properties as Record<string, unknown> | undefined) || {},
      required: Array.isArray(toolDefinition.function.parameters.required)
        ? (toolDefinition.function.parameters.required as string[])
        : undefined,
    },
  }));
}

function contentText(message: BaseMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string') {
        return block.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function convertOpenAIMessages(messages: BaseMessage[]) {
  const systemParts: string[] = [];
  const conversation: Array<{
    role: string;
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
    reasoning_content?: string;
    tool_call_id?: string;
  }> = [];

  for (const message of messages) {
    if (message.type === 'system') {
      const text = contentText(message);
      if (text) systemParts.push(text);
      continue;
    }
    if (message.type === 'tool' && ToolMessage.isInstance(message)) {
      conversation.push({
        role: 'tool',
        content: contentText(message),
        tool_call_id: message.tool_call_id,
      });
      continue;
    }
    if (message.type === 'ai' && AIMessage.isInstance(message)) {
      const toolCalls = (message.tool_calls || []).map((call, index) => ({
        id: call.id || `tool-${Date.now()}-${index}`,
        type: 'function' as const,
        function: { name: call.name, arguments: JSON.stringify(call.args || {}) },
      }));
      const additionalKwargs = message.additional_kwargs as Record<string, unknown> | undefined;
      const reasoningContent = typeof additionalKwargs?.reasoning_content === 'string'
        ? additionalKwargs.reasoning_content
        : '';
      const assistantContent = contentText(message);
      conversation.push({
        role: 'assistant',
        content: toolCalls.length ? assistantContent : assistantContent || null,
        reasoning_content: toolCalls.length && reasoningContent ? reasoningContent : undefined,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      });
      continue;
    }
    conversation.push({ role: 'user', content: contentText(message) });
  }

  return { systemPrompt: systemParts.join('\n\n'), conversation };
}

function appendClaudeMessage(
  messages: ClaudeConversationMessage[],
  next: ClaudeConversationMessage,
) {
  const previous = messages[messages.length - 1];
  if (!previous || previous.role !== next.role) {
    messages.push(next);
    return;
  }
  const previousBlocks = typeof previous.content === 'string'
    ? [{ type: 'text', text: previous.content }]
    : previous.content;
  const nextBlocks = typeof next.content === 'string'
    ? [{ type: 'text', text: next.content }]
    : next.content;
  previous.content = [...previousBlocks, ...nextBlocks];
}

function convertClaudeMessages(messages: BaseMessage[]) {
  const systemParts: string[] = [];
  const conversation: ClaudeConversationMessage[] = [];
  let pendingToolResults: Array<Record<string, unknown>> = [];

  const flushToolResults = () => {
    if (pendingToolResults.length === 0) return;
    appendClaudeMessage(conversation, { role: 'user', content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const message of messages) {
    if (message.type === 'system') {
      const text = contentText(message);
      if (text) systemParts.push(text);
      continue;
    }
    if (message.type === 'tool' && ToolMessage.isInstance(message)) {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: message.tool_call_id,
        content: contentText(message),
        is_error: message.status === 'error',
      });
      continue;
    }

    flushToolResults();
    if (message.type === 'ai' && AIMessage.isInstance(message)) {
      const blocks: Array<Record<string, unknown>> = [];
      const text = contentText(message);
      if (text) blocks.push({ type: 'text', text });
      for (const [index, call] of (message.tool_calls || []).entries()) {
        blocks.push({
          type: 'tool_use',
          id: call.id || `tool-${Date.now()}-${index}`,
          name: call.name,
          input: call.args || {},
        });
      }
      appendClaudeMessage(conversation, { role: 'assistant', content: blocks });
      continue;
    }
    appendClaudeMessage(conversation, { role: 'user', content: contentText(message) });
  }
  flushToolResults();

  return { systemPrompt: systemParts.join('\n\n'), conversation };
}

export class MagineChatModel extends BaseChatModel<MagineChatModelCallOptions> {
  private readonly config: MagineChatModelConfig;

  constructor(config: MagineChatModelConfig) {
    super(config);
    this.config = config;
  }

  _llmType(): string {
    // BaseChatModel calls this during super(), before this.config is assigned.
    return 'magine-canvas-agent';
  }

  invocationParams() {
    return {
      model: this.config.model,
      provider: this.config.providerId,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    };
  }

  bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<MagineChatModelCallOptions>,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, MagineChatModelCallOptions> {
    return this.withConfig({ ...kwargs, tools } as MagineChatModelCallOptions);
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.config.onModelStart?.();
    const tools = normalizeToolDefinitions(options.tools);
    const modelCapabilities = resolveAgentModelCapabilities(
      this.config.providerId,
      this.config.model,
      this.config.apiUrl,
    );
    let text = '';
    let reasoning = '';
    const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];

    if (this.config.provider === 'claude') {
      const converted = convertClaudeMessages(messages);
      for await (const event of streamClaudeTurn({
        apiKey: this.config.apiKey,
        apiUrl: this.config.apiUrl,
        model: this.config.model,
        systemPrompt: converted.systemPrompt,
        messages: converted.conversation,
        tools: toAnthropicTools(tools),
        signal: options.signal || this.config.signal,
      })) {
        if (event.type === 'text_delta') {
          text += event.text;
          this.config.onTextDelta?.(event.text);
          await runManager?.handleLLMNewToken(event.text);
        } else if (event.type === 'tool_use') {
          toolCalls.push({ id: event.tool.id, name: event.tool.name, args: event.tool.input });
        } else if (event.type === 'error') {
          throw new Error(event.message);
        } else if (event.type === 'stop' && event.stopReason === 'aborted') {
          throw new DOMException('Aborted', 'AbortError');
        }
      }
    } else {
      const converted = convertOpenAIMessages(messages);
      for await (const event of streamOpenAIAgentTurn({
        apiKey: this.config.apiKey,
        apiUrl: this.config.apiUrl || '',
        model: this.config.model,
        systemPrompt: converted.systemPrompt,
        messages: converted.conversation,
        tools,
        stream: this.config.responseMode !== 'buffered',
        temperature: this.config.temperature ?? 0.25,
        maxTokens: this.config.maxTokens ?? 4096,
        signal: options.signal || this.config.signal,
      })) {
        if (event.type === 'text_delta') {
          text += event.text;
          this.config.onTextDelta?.(event.text);
          await runManager?.handleLLMNewToken(event.text);
        } else if (event.type === 'reasoning_delta') {
          reasoning += event.text;
          this.config.onReasoningDelta?.(event.text);
        } else if (event.type === 'tool_use') {
          toolCalls.push({ id: event.tool.id, name: event.tool.name, args: event.tool.input });
        } else if (event.type === 'error') {
          throw new Error(event.message);
        } else if (event.type === 'stop' && event.stopReason === 'aborted') {
          throw new DOMException('Aborted', 'AbortError');
        }
      }
    }

    const message = new AIMessage({
      content: text,
      tool_calls: toolCalls.map((call) => ({
        type: 'tool_call' as const,
        id: call.id,
        name: call.name,
        args: call.args,
      })),
      additional_kwargs: modelCapabilities.replayReasoningOnToolCalls && reasoning
        ? { reasoning_content: reasoning }
        : undefined,
      response_metadata: reasoning ? { reasoning } : undefined,
    });
    return {
      generations: [{ text, message }],
      llmOutput: { provider: this.config.providerId, model: this.config.model },
    };
  }
}
