interface AgentCanvasTaskCall {
  name: string;
  params: Record<string, unknown>;
}

interface AgentCanvasTaskResult {
  data?: unknown;
  artifacts?: Array<{ id?: string; kind?: string }>;
}

const SINGLE_NODE_TASKS = new Set([
  'configure_node',
  'move_resize_node',
  'execute_node_action',
  'select_node_output',
  'update_node',
  'run_generation',
]);

function uniqueNodeIds(ids: unknown[]): string[] {
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
}

export function resolveAgentCanvasTaskFocusBefore(call: AgentCanvasTaskCall): string[] {
  if (SINGLE_NODE_TASKS.has(call.name)) {
    if (call.name === 'execute_node_action' && String(call.params.action || '').toLowerCase() === 'focus') {
      return [];
    }
    return uniqueNodeIds([call.params.node_id]);
  }
  if (call.name === 'connect_nodes' || call.name === 'disconnect_nodes') {
    return uniqueNodeIds([call.params.source_id, call.params.target_id]);
  }
  return [];
}

export function resolveAgentCanvasTaskFocusAfter(
  call: AgentCanvasTaskCall,
  result: AgentCanvasTaskResult,
  currentNodeIds: readonly string[],
): string[] {
  if (call.name === 'arrange_nodes') return uniqueNodeIds([...currentNodeIds]);
  if (call.name !== 'add_node' && call.name !== 'setup_workflow') return [];

  const data = result.data && typeof result.data === 'object'
    ? result.data as Record<string, unknown>
    : {};
  const dataNodeIds = Array.isArray(data.nodeIds) ? data.nodeIds : [data.nodeId];
  const artifactNodeIds = (result.artifacts || [])
    .filter((artifact) => artifact.kind === 'node')
    .map((artifact) => artifact.id);
  return uniqueNodeIds([...dataNodeIds, ...artifactNodeIds]);
}
