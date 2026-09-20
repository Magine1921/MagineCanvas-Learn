function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export type ProactiveAgentToolCall = {
  name: 'add_node';
  params: { type: string; label: string };
};

const DIRECT_NODE_TYPES: Array<{ pattern: RegExp; type: string; label: string }> = [
  { pattern: /图像|图片/u, type: 'image', label: '图像生成' },
  { pattern: /视频/u, type: 'video', label: '视频生成' },
  { pattern: /语音|音乐/u, type: 'music', label: '音乐/语音' },
  { pattern: /素材/u, type: 'material', label: '素材' },
  { pattern: /浏览器/u, type: 'browser', label: '浏览器' },
  { pattern: /720\s*全景|全景/u, type: 'panorama', label: '720°全景' },
  { pattern: /手绘分镜|故事板/u, type: 'storyboard', label: '手绘分镜' },
  { pattern: /Agent|智能体/iu, type: 'agent', label: 'Agent' },
  { pattern: /文本|提示词/u, type: 'prompt', label: '文本' },
];

export function resolveProactiveAgentToolCall(
  rawText: string,
  _options: { hasMedia?: boolean } = {},
): ProactiveAgentToolCall | null {
  const text = normalizeText(rawText);
  const directNodeCommand = /^(?:请|麻烦)?(?:你)?(?:给我|帮我)?(?:直接)?(?:创建|新建|添加)(?:一个|个)?(.{1,24}?)节点[。！？!?\s]*$/u.exec(text);
  if (!directNodeCommand) return null;
  const nodeType = DIRECT_NODE_TYPES.find(({ pattern }) => pattern.test(directNodeCommand[1]));
  return nodeType
    ? { name: 'add_node', params: { type: nodeType.type, label: nodeType.label } }
    : null;
}

export function isAgentCapabilityQuestion(text: string): boolean {
  return /^(你是谁|你能做什么|你会做什么|介绍一下(?:你自己)?)[，。！？!?'"\s]*$/iu.test(
    normalizeText(text),
  );
}

export function buildAgentCapabilityReply(): string {
  return [
    '我是 Magine 画布执行助手。我的核心能力是读取并操作当前项目，而不只是聊天。',
    '我可以创建、修改、连接、删除和整理节点，检查生成任务并从失败处继续；也可以管理项目与文件、查询模型配置和额度、联网检索资料，以及分析输入的图片、视频和音频。',
    '复杂任务会拆分步骤、调用工具并核对执行结果后再汇报。',
  ].join('\n\n');
}

export function isOpenCanvasCommand(text: string): boolean {
  return /^(打开|进入)(当前|最近|上次)?(?:的)?(画布|项目|工程)[，。！？!?'"\s]*$/iu.test(
    normalizeText(text),
  );
}

export function isExplicitWebSearchRequest(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (/web\s*search|websearch|google|谷歌|bing|必应|duckduckgo/iu.test(normalized)) return true;
  const webScope = /联网|上网|网上|网络|网页|网址|官网|官方文档|官方资料|最新|新闻/u;
  const searchAction = /搜索|搜一下|查一下|查询|查阅|检索|浏览|找一下/u;
  return (
    (webScope.test(normalized) && searchAction.test(normalized))
    || /(?:联网|上网)\s*(?:查|搜|搜索|查询|检索)/u.test(normalized)
  );
}

export function isCanvasDiagnosisRequest(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const canvasTarget = /画布|节点|连线|素材|工作流|任务|生成|故事板|分镜|资产|组合|全景|Agent|AI助手/u;
  const diagnosticIntent = /为什么|原因|检查|分析|排查|诊断|卡住|卡死|停止|失败|报错|错误|异常|无响应|没反应|不动|丢失|进度|状态|是否.*网络|网络.*原因/u;
  return canvasTarget.test(normalized) && diagnosticIntent.test(normalized);
}

export function buildAgentRequestGuidance(
  rawText: string,
  _options: { hasMedia?: boolean } = {},
): string {
  const text = normalizeText(rawText);
  if (isExplicitWebSearchRequest(text)) {
    return '用户的问题需要时效性资料。请调用 web_search 或 web_fetch，并基于真实来源回答。';
  }
  if (isCanvasDiagnosisRequest(text)) {
    return [
      '这是对当前画布、节点或运行状态的诊断请求。',
      '先调用 get_canvas_state 和 get_node_detail 读取真实状态、进度与连线，再结合用户问题回答。',
      '如果状态指向 API 或模型连接问题，再调用 get_api_config 或 test_api_connection；不要脱离当前状态猜测。',
    ].join('\n');
  }
  if (isAgentCapabilityQuestion(text)) {
    return '这是能力咨询，请自然、直接地回答，不要调用无关工具。';
  }
  return '';
}
