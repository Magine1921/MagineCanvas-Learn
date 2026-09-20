import { getToolRequiredPermission } from './agent-permissions.ts';
import { resolveProactiveAgentToolCall } from './agent-intent.ts';

const OPERATION_VERBS =
  /创建|新建|添加|删除|移除|连接|断开|打开|关闭|生成|制作|做|处理|运行|执行|设置|修改|更新|移动|排列|整理|导入|导出|上传|下载|播放|暂停|继续|恢复|撤回|重做|清空|配置|切换|搭建|写入|保存|搜索|查找|修复|替换|调用|create|add|delete|remove|connect|disconnect|open|close|generate|run|execute|set|update|move|arrange|import|export|upload|download|play|pause|resume|configure|switch|fix|replace/iu;

const OPERATION_TARGETS =
  /画布|节点|连线|素材|工作流|文件|目录|项目|模型|API|图片|图像|视频|音乐|语音|全景|摄像机|故事板|分镜|角色|场景|道具|浏览器|网页|任务|canvas|node|edge|asset|workflow|file|folder|project|model|image|video|music|audio|browser|task/iu;

const DIRECT_COMMAND_PREFIX =
  /^(?:请|麻烦|帮我|给我|立即|现在|开始|执行|继续|重新|把|将|去|直接|please)\s*/iu;

const EXPLANATION_PREFIX =
  /^(?:为什么|为何|怎么|如何|怎样|什么是|能否|可不可以|是否|有没有|请问|解释|介绍|分析原因)/u;

const CREATIVE_SOURCE_MARKERS =
  /(?:^|\n)\s*(?:△|场\s*[:：]?\s*\d|镜头\s*\d|【(?:日|夜|内|外|切|镜头|后拉|下到)|(?:OS|VO)\s*[:：]|旁白\s*[:：]|台词\s*[:：])/imu;

const EXPLICIT_CREATIVE_INSTRUCTION =
  /(?:请|请你|帮我|给我|我要|我想要|需要你|把|将|基于|根据).{0,36}(?:续写|改写|润色|修改|整理|分析|总结|拆分|提取|生成|制作|创作|写入|放入|添加|替换|执行|运行|搭建|创建|转成|转换)/iu;

const EXECUTION_AUTHORIZATION =
  /(?:无需|不用|不必).{0,8}(?:询问|确认|沟通|追问)|(?:直接|立即|马上|现在).{0,8}(?:执行|开始|操作|创建|生成|修改|运行|搭建)|^(?:按默认(?:执行|开始)?|确认执行|开始执行|执行生成|开始生成|直接生成|生成吧)[。！!\s]*$/iu;

const EXECUTION_CANCEL = /^(?:取消|算了|不用了?|先不|停止|不做了?)[。！!\s]*$/u;
const EXPLICIT_REPAIR_INTENT = /修复|解决|恢复正常|重新执行|重新生成|排除故障|fix|repair|resolve/iu;
const PLAIN_CONVERSATION_SWITCH =
  /^(?:你好|您好|hello|hi|hey|谢谢|ok|好的|你是谁|你能做什么|介绍一下|聊聊)[，,。！？!?\s]*$/iu;
const CLARIFICATION_LANGUAGE =
  /(?:请|需要|想要|希望|是否|要不要|是不是).{0,24}(?:确认|补充|告诉|提供|选择|说明|执行)|[?？]\s*$/u;
const EXECUTION_OFFER_LANGUAGE =
  /(?:如果|若)(?:你|您)?(?:要|需要|愿意)|我可以.{0,48}(?:下一步|直接|继续|生成|整理|搭建|执行)|下一步.{0,36}(?:可以|将会|能够).{0,24}(?:生成|整理|搭建|执行)/u;
const CONTINUATION_REPLY =
  /^(?:下一步|继续|接着|接着做|继续做|开始吧?|执行吧?|执行生成|开始生成|直接生成|生成吧|你定|你来定|你看着办|按你说的|按默认(?:执行|开始)?|确认(?:执行)?|自由发挥)[，,。！？!?\s]*$/u;

type AgentConversationMessageLike = {
  role: string;
  content: string;
  toolExecutions?: Array<{
    tool?: { name?: string };
    result?: { success?: boolean };
  }>;
};

export type AgentExecutionIntent = {
  executionText: string;
  continuation: boolean;
  shouldClarify: boolean;
  pendingOperation?: string | null;
};

/** Prevent story/script source text from being mistaken for canvas commands. */
export function isCreativeSourceWithoutAgentInstruction(text: string): boolean {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length < 60 || !CREATIVE_SOURCE_MARKERS.test(normalized)) return false;
  return !EXPLICIT_CREATIVE_INSTRUCTION.test(normalized);
}

function isCanvasDiagnosisRequest(text: string): boolean {
  const canvasTarget =
    /画布|节点|连线|素材|工作流|任务|生成|故事板|分镜|资产|组合|全景|摄像机|Agent|AI助手/u;
  const diagnosticIntent =
    /为什么|原因|检查|分析|排查|诊断|卡住|卡死|停止|失败|报错|错误|异常|无响应|没反应|不动|丢失|进度|状态|是否.*网络|网络.*原因/u;
  return canvasTarget.test(text) && diagnosticIntent.test(text);
}

export function agentRequestRequiresToolExecution(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (normalized.startsWith('/')) return true;
  if (isCreativeSourceWithoutAgentInstruction(text)) return false;
  if (isCanvasDiagnosisRequest(normalized)) return true;
  if (EXPLANATION_PREFIX.test(normalized)) return false;

  const hasOperation = OPERATION_VERBS.test(normalized);
  if (!hasOperation) return false;

  return (
    OPERATION_TARGETS.test(normalized) ||
    DIRECT_COMMAND_PREFIX.test(normalized) ||
    /(?:帮我|给我|请你|需要你|你来).{0,12}(?:创建|添加|删除|生成|执行|设置|修改|修复|打开|关闭|播放|导出|搜索)/u.test(
      normalized,
    )
  );
}

export function agentRequestRequiresMutation(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const explicitlyRepairs = EXPLICIT_REPAIR_INTENT.test(normalized);
  if (
    !normalized
    || isCreativeSourceWithoutAgentInstruction(text)
    || (isCanvasDiagnosisRequest(normalized) && !explicitlyRepairs)
    || (EXPLANATION_PREFIX.test(normalized) && !explicitlyRepairs)
  ) return false;
  return /创建|新建|添加|删除|移除|连接|断开|打开|关闭|生成|制作|做|处理|运行|执行|设置|修改|更新|移动|排列|整理|导入|导出|上传|下载|播放|暂停|继续|恢复|撤回|重做|清空|配置|切换|搭建|写入|保存|修复|替换|调用|create|add|delete|remove|connect|disconnect|open|close|generate|run|execute|set|update|move|arrange|import|export|upload|download|play|pause|resume|configure|switch|fix|replace/iu.test(normalized);
}

export function agentRequestExplicitlyAuthorizesExecution(text: string): boolean {
  return EXECUTION_AUTHORIZATION.test(text.replace(/\s+/g, ' ').trim());
}

function pendingAgentOperation(history: AgentConversationMessageLike[]): string | null {
  const conversational = history.filter(
    (message) => (message.role === 'user' || message.role === 'assistant') && message.content.trim(),
  );
  const assistant = conversational.at(-1);
  const user = conversational.at(-2);
  if (!assistant || assistant.role !== 'assistant' || !user || user.role !== 'user') return null;
  if (
    !CLARIFICATION_LANGUAGE.test(assistant.content.trim())
    && !EXECUTION_OFFER_LANGUAGE.test(assistant.content.trim())
  ) return null;
  if (hasSuccessfulMutation(assistant)) return null;
  return agentRequestRequiresMutation(user.content) ? user.content.trim() : null;
}

function hasSuccessfulMutation(message: AgentConversationMessageLike): boolean {
  return Boolean(message.toolExecutions?.some((execution) => {
    const toolName = execution.tool?.name;
    const requiredPermission = toolName ? getToolRequiredPermission(toolName) : undefined;
    return Boolean(
      execution.result?.success
      && requiredPermission
      && requiredPermission !== 'read-only',
    );
  }));
}

function recentUnfinishedAgentOperation(history: AgentConversationMessageLike[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.role !== 'user') continue;
    const candidate = message.content.trim();
    if (
      !candidate
      || CONTINUATION_REPLY.test(candidate)
      || !agentRequestRequiresMutation(candidate)
      || !agentRequestRequiresToolExecution(candidate)
    ) continue;

    const completedAfterRequest = history
      .slice(index + 1)
      .some((laterMessage) => hasSuccessfulMutation(laterMessage));
    return completedAfterRequest ? null : candidate;
  }
  return null;
}

/**
 * Rebuild the executable intent after the assistant's clarification turn.
 * This keeps short replies such as "按默认" or a bare aspect ratio attached to the
 * original canvas request, including after the conversation is restored.
 */
export function resolveAgentExecutionIntent(
  currentText: string,
  history: AgentConversationMessageLike[] = [],
  persistedPendingText?: string | null,
): AgentExecutionIntent {
  const normalized = currentText.replace(/\s+/g, ' ').trim();
  const isContinuationReply = CONTINUATION_REPLY.test(normalized);
  const pending = persistedPendingText?.trim()
    || pendingAgentOperation(history)
    || (isContinuationReply ? recentUnfinishedAgentOperation(history) : null);
  const cancelsPending = EXECUTION_CANCEL.test(normalized);
  const switchesConversation = PLAIN_CONVERSATION_SWITCH.test(normalized)
    || (EXPLANATION_PREFIX.test(normalized) && !agentRequestExplicitlyAuthorizesExecution(normalized));

  if (pending && normalized && !cancelsPending && !switchesConversation) {
    return {
      executionText: `${pending}\n\n用户已补充或确认执行：${currentText.trim()}`,
      continuation: true,
      shouldClarify: false,
      pendingOperation: pending,
    };
  }

  if (pending && (cancelsPending || switchesConversation)) {
    return {
      executionText: currentText.trim(),
      continuation: false,
      shouldClarify: false,
      pendingOperation: null,
    };
  }

  if (isContinuationReply) {
    return {
      executionText: currentText.trim(),
      continuation: false,
      shouldClarify: false,
    };
  }

  const hasProactiveTask = Boolean(resolveProactiveAgentToolCall(currentText));
  const explicitlyAuthorized = agentRequestExplicitlyAuthorizesExecution(currentText)
    || hasProactiveTask;
  const requiresToolExecution = agentRequestRequiresToolExecution(currentText);
  const shouldClarify = agentRequestRequiresMutation(currentText)
    && !explicitlyAuthorized
    && !requiresToolExecution;

  return {
    executionText: currentText.trim(),
    continuation: false,
    shouldClarify,
    pendingOperation: shouldClarify
      ? currentText.trim()
      : explicitlyAuthorized
        ? null
        : undefined,
  };
}

export function shouldRetryMissingAgentToolCall(params: {
  requestText: string;
  turn: number;
  executedToolCount: number;
  executionSatisfied?: boolean;
}): boolean {
  return (
    !(params.executionSatisfied ?? (params.executedToolCount > 0)) &&
    params.turn < 3 &&
    agentRequestRequiresToolExecution(params.requestText)
  );
}
