export type CanvasGenerationResult = {
  success: boolean;
  message: string;
  taskId?: string;
  state?: 'running' | 'completed' | 'failed';
};

export interface StartGenerationSequenceOptions {
  waitForCompletion?: boolean;
}

type GenerationHandler = () => Promise<CanvasGenerationResult>;
type NodeActionHandler = (params: Record<string, unknown>) => Promise<CanvasGenerationResult>;

const handlers = new Map<string, GenerationHandler>();
const actionHandlers = new Map<string, Map<string, NodeActionHandler>>();
const backgroundTasks = new Map<string, Promise<CanvasGenerationResult>>();
const nodeTasks = new Map<string, Promise<CanvasGenerationResult>>();
const nodeActionTasks = new Map<string, Promise<CanvasGenerationResult>>();
const DEFAULT_TIMEOUT_MS = 600_000;
const REGISTRATION_TIMEOUT_MS = 3_000;

export function registerCanvasGenerationHandler(nodeId: string, handler: GenerationHandler): () => void {
  handlers.set(nodeId, handler);
  return () => {
    handlers.delete(nodeId);
  };
}

export function registerCanvasNodeActionHandler(
  nodeId: string,
  action: string,
  handler: NodeActionHandler,
): () => void {
  const nodeHandlers = actionHandlers.get(nodeId) || new Map<string, NodeActionHandler>();
  nodeHandlers.set(action, handler);
  actionHandlers.set(nodeId, nodeHandlers);
  return () => {
    const current = actionHandlers.get(nodeId);
    if (!current || current.get(action) !== handler) return;
    current.delete(action);
    if (current.size === 0) actionHandlers.delete(nodeId);
  };
}

export async function requestCanvasNodeAction(
  nodeId: string,
  action: string,
  params: Record<string, unknown> = {},
): Promise<CanvasGenerationResult> {
  const taskKey = `${nodeId}:${action}`;
  const activeTask = nodeActionTasks.get(taskKey);
  if (activeTask) return activeTask;

  const handler = actionHandlers.get(nodeId)?.get(action);
  if (!handler) {
    return { success: false, message: `Node ${nodeId} does not expose action ${action}` };
  }

  const task = handler(params).catch((error: unknown) => ({
    success: false,
    message: error instanceof Error ? error.message : String(error),
  }));
  nodeActionTasks.set(taskKey, task);
  try {
    return await task;
  } finally {
    if (nodeActionTasks.get(taskKey) === task) nodeActionTasks.delete(taskKey);
  }
}

async function waitForGenerationHandler(nodeId: string): Promise<GenerationHandler | undefined> {
  const registrationDeadline = Date.now() + REGISTRATION_TIMEOUT_MS;
  let handler = handlers.get(nodeId);
  while (!handler && Date.now() < registrationDeadline) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    handler = handlers.get(nodeId);
  }
  return handler;
}

async function runGenerationHandler(
  handler: GenerationHandler,
  timeoutMs: number,
): Promise<CanvasGenerationResult> {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      handler(),
      new Promise<CanvasGenerationResult>((resolve) => {
        timeoutId = window.setTimeout(
          () => resolve({ success: false, message: '生成超时' }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

export async function requestNodeGeneration(
  nodeId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<CanvasGenerationResult> {
  const activeTask = nodeTasks.get(nodeId);
  if (activeTask) return activeTask;

  const handler = await waitForGenerationHandler(nodeId);
  if (!handler) {
    return {
      success: false,
      message: `节点 ${nodeId} 未在当前画布视图渲染；若仍在欢迎页，请先进入画布后再执行生成`,
    };
  }

  const task = runGenerationHandler(handler, timeoutMs);
  nodeTasks.set(nodeId, task);
  try {
    return await task;
  } finally {
    if (nodeTasks.get(nodeId) === task) nodeTasks.delete(nodeId);
  }
}

export async function startNodeGenerationSequence(
  nodeIds: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  options: StartGenerationSequenceOptions = {},
): Promise<CanvasGenerationResult> {
  const generationNodeIds = nodeIds.filter(Boolean);
  if (generationNodeIds.length === 0) {
    return { success: false, message: '没有可启动的生成节点' };
  }

  const taskKey = generationNodeIds.join('|');
  const activeTask = backgroundTasks.get(taskKey);
  if (activeTask && options.waitForCompletion) return activeTask;
  if (backgroundTasks.has(taskKey)) {
    return { success: true, message: '生成任务已在进行中' };
  }

  const firstHandler = await waitForGenerationHandler(generationNodeIds[0]);
  if (!firstHandler) {
    return {
      success: false,
      message: `节点 ${generationNodeIds[0]} 未在当前画布视图渲染，无法启动生成`,
    };
  }

  const task = (async () => {
    for (let index = 0; index < generationNodeIds.length; index += 1) {
      const nodeId = generationNodeIds[index];
      const handler = index === 0 ? firstHandler : await waitForGenerationHandler(nodeId);
      if (!handler) {
        return { success: false, message: `节点 ${nodeId} 未渲染，后续生成已停止` };
      }
      const result = await runGenerationHandler(handler, timeoutMs);
      if (!result.success) return result;
    }
    return { success: true, message: '生成任务已完成' };
  })().catch((error: unknown) => ({
    success: false,
    message: error instanceof Error ? error.message : String(error),
  }));

  backgroundTasks.set(taskKey, task);
  void task.finally(() => {
    if (backgroundTasks.get(taskKey) === task) backgroundTasks.delete(taskKey);
  });

  if (options.waitForCompletion) {
    const result = await task;
    return {
      ...result,
      taskId: taskKey,
      state: result.success ? 'completed' : 'failed',
    };
  }

  return {
    success: true,
    message: generationNodeIds.length > 1
      ? `已启动 ${generationNodeIds.length} 个节点的顺序生成`
      : '生成任务已启动',
  };
}

export function waitForGenerationProgress(
  getStatus: () => { status: string; message: string },
  timeoutMs: number
): Promise<CanvasGenerationResult> {
  const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

  return (async () => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const { status, message } = getStatus();
      if (status === 'error') {
        return { success: false, message: message || '生成失败' };
      }
      if (status === 'submitting' || status === 'processing') {
        break;
      }
      await sleep(100);
    }

    while (Date.now() < deadline) {
      const { status, message } = getStatus();
      if (status === 'success') {
        return { success: true, message: message || '生成成功' };
      }
      if (status === 'error') {
        return { success: false, message: message || '生成失败' };
      }
      await sleep(200);
    }

    return { success: false, message: '生成超时' };
  })();
}
