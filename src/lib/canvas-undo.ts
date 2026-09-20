export function canvasNodeDataUndoBurstKey(
  nodeId: string,
  data: Record<string, unknown>,
): string {
  return `${nodeId}\u0000${Object.keys(data).sort().join('\u0001')}`;
}

export function canvasNodeChangeRecordsUndo(changeType: string): boolean {
  return changeType === 'remove';
}

const TRANSIENT_NODE_DATA_KEYS = new Set([
  'isLoading',
  'generationProgress',
  'pendingSeedanceTask',
  'generationStartedAt',
  'generationElapsedMs',
  'taskProgress',
  'currentTaskIndex',
  'currentTaskNumber',
  'statusMessage',
]);

export function canvasNodeDataPatchRecordsUndo(data: Record<string, unknown>): boolean {
  const keys = Object.keys(data);
  return keys.length > 0 && keys.some((key) => !TRANSIENT_NODE_DATA_KEYS.has(key));
}
