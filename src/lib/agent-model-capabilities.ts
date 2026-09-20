export type AgentToolTransport = 'native' | 'native-buffered' | 'text-json';
export type AgentToolChoiceMode = 'full' | 'auto-only' | 'omit';

export interface AgentModelCapabilities {
  toolTransport: AgentToolTransport;
  toolChoiceMode: AgentToolChoiceMode;
  replayReasoningOnToolCalls: boolean;
  requiresAssistantContentOnToolCalls: boolean;
}

const STANDARD_CAPABILITIES: AgentModelCapabilities = {
  toolTransport: 'native',
  toolChoiceMode: 'full',
  replayReasoningOnToolCalls: false,
  requiresAssistantContentOnToolCalls: false,
};

function providerHost(apiUrl: string): string {
  try {
    return new URL(apiUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function resolveAgentModelCapabilities(
  provider: string,
  model: string,
  apiUrl = '',
): AgentModelCapabilities {
  const providerId = provider.trim().toLowerCase();
  const modelId = model.trim().toLowerCase();
  const hostname = providerHost(apiUrl);

  if (providerId.includes('text-json')) {
    return {
      ...STANDARD_CAPABILITIES,
      toolTransport: 'text-json',
      toolChoiceMode: 'omit',
    };
  }

  const isDeepSeek = providerId.includes('deepseek')
    || modelId.startsWith('deepseek')
    || hostname === 'api.deepseek.com'
    || hostname.endsWith('.deepseek.com');
  if (isDeepSeek) {
    return {
      toolTransport: 'native-buffered',
      toolChoiceMode: 'omit',
      replayReasoningOnToolCalls: true,
      requiresAssistantContentOnToolCalls: true,
    };
  }

  return { ...STANDARD_CAPABILITIES };
}

export function isUnsupportedToolChoiceError(status: number, errorText: string): boolean {
  if (status !== 400 && status !== 422) return false;
  return /tool[_ -]?choice|forced tool|function choice/iu.test(errorText)
    && /not support|unsupported|invalid|does not allow|不支持|无效/iu.test(errorText);
}
