import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import type {
  AgentToolExecution,
  AgentToolName,
  AgentToolResult,
  PermissionMode,
} from './agent-types';
import { AGENT_TOOL_DEFS, getOpenAITools } from './agent-tools';
import {
  DEEP_AGENT_TOOL_ALIASES,
  selectDeepAgentToolNames,
} from './agent-deep-policy';
import { formatToolResultForModel } from './agent-runtime';

type ExecuteTool = (
  call: { name: AgentToolName; params: Record<string, unknown> },
  executionHint?: string,
) => Promise<AgentToolResult>;

export interface DeepAgentToolCallbacks {
  onToolStart?: (name: AgentToolName) => void;
  onToolFinish?: (execution: AgentToolExecution) => void;
}

interface CreateDeepAgentToolsParams extends DeepAgentToolCallbacks {
  userText: string;
  permission: PermissionMode;
  includeMusicTools: boolean;
  maxToolResultChars: number;
  execute: ExecuteTool;
}

export function createDeepAgentTools(params: CreateDeepAgentToolsParams): StructuredToolInterface[] {
  const permissionByName = Object.fromEntries(
    AGENT_TOOL_DEFS.map((definition) => [definition.name, definition.permission]),
  ) as Partial<Record<AgentToolName, PermissionMode>>;
  const selected = new Set(
    selectDeepAgentToolNames(params.userText, params.permission, permissionByName),
  );
  const definitions = getOpenAITools(params.permission, {
    includeMusicTools: params.includeMusicTools,
  }).filter((definition) => selected.has(definition.function.name as AgentToolName));

  let mutationQueue = Promise.resolve<unknown>(undefined);

  return definitions.map((definition) => {
    const originalName = definition.function.name as AgentToolName;
    const exposedName = DEEP_AGENT_TOOL_ALIASES[originalName] || originalName;
    const permissionLevel = permissionByName[originalName] || 'read-only';

    return tool(
      async (input) => {
        const call = {
          name: originalName,
          params:
            input && typeof input === 'object' && !Array.isArray(input)
              ? (input as Record<string, unknown>)
              : {},
        };
        const startedAt = performance.now();
        params.onToolStart?.(originalName);

        const run = async () => params.execute(call, `deep-${exposedName}-${startedAt}`);
        let result: AgentToolResult;
        if (permissionLevel === 'read-only') {
          result = await run();
        } else {
          const queued = mutationQueue.then(run, run);
          mutationQueue = queued.then(
            () => undefined,
            () => undefined,
          );
          result = await queued;
        }

        const execution: AgentToolExecution = {
          tool: call,
          result,
          startedAt,
          finishedAt: performance.now(),
        };
        params.onToolFinish?.(execution);
        return formatToolResultForModel(result, params.maxToolResultChars);
      },
      {
        name: exposedName,
        description:
          originalName === exposedName
            ? definition.function.description
            : `${definition.function.description}。这是实际项目文件工具，不是 Agent 临时工作区文件工具。`,
        schema: definition.function.parameters,
      },
    );
  });
}
