import type { AgentToolExecution } from '@/components/agent/agent-types';
import {
  canvasAgentNodeTaskState,
  collectCanvasAgentNodeOutputs,
  type CanvasAgentNodeSnapshot,
} from './canvas-agent-capabilities.ts';
import { probeAgentMediaOutput } from './agent-media-verification.ts';

export interface PendingAgentNodeJob {
  nodeId: string;
  expectedKind?: 'image' | 'video' | 'audio' | 'file';
}

export interface AgentTaskSupervisionResult {
  success: boolean;
  message: string;
  evidence: Array<Record<string, unknown>>;
}

const ERROR_STATES = new Set(['error', 'failed', 'cancelled', 'canceled']);

function resultData(execution: AgentToolExecution): Record<string, unknown> {
  return execution.result.data && typeof execution.result.data === 'object'
    ? execution.result.data as Record<string, unknown>
    : {};
}

export function collectPendingAgentNodeJobs(
  executions: AgentToolExecution[],
): PendingAgentNodeJob[] {
  const jobs = new Map<string, PendingAgentNodeJob>();
  for (const execution of executions) {
    if (!execution.result.success || execution.result.verification?.status !== 'pending') continue;
    const data = resultData(execution);
    let nodeId = '';
    let expectedKind: PendingAgentNodeJob['expectedKind'];
    if (
      execution.tool.name === 'run_generation'
      || (
        execution.tool.name === 'execute_node_action'
        && String(execution.tool.params.action || '').toLowerCase() === 'generate'
      )
    ) {
      nodeId = String(execution.tool.params.node_id || '');
    }
    if (nodeId) jobs.set(nodeId, { nodeId, expectedKind });
  }
  return [...jobs.values()];
}

export async function superviseAgentNodeJobs(args: {
  jobs: PendingAgentNodeJob[];
  getNodes: () => CanvasAgentNodeSnapshot[];
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (summary: string) => void;
}): Promise<AgentTaskSupervisionResult> {
  const deadline = Date.now() + Math.max(1_000, args.timeoutMs);
  const completed = new Set<string>();
  const evidence = new Map<string, Record<string, unknown>>();

  while (Date.now() < deadline) {
    if (args.signal?.aborted) {
      return { success: false, message: 'Task supervision was cancelled.', evidence: [...evidence.values()] };
    }

    const nodes = args.getNodes();
    for (const job of args.jobs) {
      if (completed.has(job.nodeId)) continue;
      const node = nodes.find((item) => item.id === job.nodeId);
      if (!node) {
        return {
          success: false,
          message: `Generation node ${job.nodeId} no longer exists.`,
          evidence: [...evidence.values()],
        };
      }
      const task = canvasAgentNodeTaskState(node);
      const status = String(task.status || '').toLowerCase();
      evidence.set(job.nodeId, task);
      if (ERROR_STATES.has(status)) {
        return {
          success: false,
          message: String(task.message || `Generation node ${job.nodeId} failed.`),
          evidence: [...evidence.values()],
        };
      }

      const outputs = collectCanvasAgentNodeOutputs(node)
        .filter((output) => !job.expectedKind || output.kind === job.expectedKind);
      for (const output of outputs) {
        const probe = await probeAgentMediaOutput(output);
        if (!probe.ok) continue;
        completed.add(job.nodeId);
        evidence.set(job.nodeId, { ...task, output, probe });
        break;
      }
    }

    if (completed.size === args.jobs.length) {
      return {
        success: true,
        message: `Verified ${completed.size} generated node output(s).`,
        evidence: [...evidence.values()],
      };
    }
    args.onProgress?.(`Waiting for generated outputs (${completed.size}/${args.jobs.length}).`);
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }

  return {
    success: false,
    message: 'Timed out while waiting for generated outputs.',
    evidence: [...evidence.values()],
  };
}
