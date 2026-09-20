'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Handle, Position, NodeProps, useUpdateNodeInternals, type Node } from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import { ArrowDown, AudioLines, Bot, ChevronDown, FileText, Paperclip, Send, Video } from 'lucide-react';
import { CanvasNodeData, useCanvasStore } from '../canvas/CanvasStore';
import { isRemovedProvider, useSeedanceStore, type ProviderConfig } from '../seedance/SeedanceStore';
import { CompactNodeFrame } from '../canvas/CompactNodeFrame';
import { GenerationEta } from '../canvas/GenerationEta';
import { streamLlmTextParts } from '@/lib/invoke-llm-text';
import { streamClaudeTurn } from '@/lib/claude-agent-stream';
import { extractAndCleanText } from '@/components/agent/agent-tools';
import { createStreamUiScheduler } from '@/lib/stream-ui-scheduler';
import { estimateLlmTokens } from '@/lib/ark-token-estimate';
import {
  buildKieUsageDisplay,
  fetchKieCredits,
  getKieProviderTokenBucket,
  isKieProvider,
  KIE_GLOBAL_PROVIDER_TOKEN_KEY,
} from '@/lib/kie-usage-display';
import { KieUsageInfo } from '../canvas/KieUsageInfo';
import {
  buildLlmModelOptionsForProvider,
  getLlmProviderRecord,
  resolveGeminiModelId,
  resolveLlmModelForProvider,
  resolveLlmTextProvider,
} from '@/lib/llm-text-provider';
import { mergeGeminiModelLists } from '@/lib/gemini-models-list';
import { Select, SelectItem } from '@/components/ui/select';
import { GeminiModelSelect } from '@/components/ui/GeminiModelSelect';
import { useIncomingMaterialRefs, useIncomingPromptSources } from '../canvas/useCanvasDerivedData';
import { MentionTextarea } from '../canvas/MentionTextarea';
import { VoiceAssistantWaveStrip } from '@/components/voice/VoiceAssistantWaveStrip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MaterialRef } from '@/lib/material-mentions';
import { composePrompt, getAgentForwardPromptText, isSamePromptText } from '@/lib/prompt-flow';
import { cn } from '@/lib/utils';
import { AgentThinkingBlock } from '@/components/agent/AgentThinkingBlock';
import { AgentOpenAi55Message } from '@/components/agent/AgentOpenAi55Message';
import type { LlmMediaInput, LlmMediaKind } from '@/lib/llm-media-input';
import { materializeKieAgentMedia } from '@/lib/kie-agent-media-client';
import {
  isOpenAi55AgentModel,
  OPENAI55_ARTIFACT_SYSTEM_INSTRUCTION,
} from '@/lib/agent-openai55-layout';
import {
  AGENT_CHAT_MEDIA_ATTR,
  blobUrlToDataUrl,
  clearChatComposer,
  createMediaChipElement,
  handleComposerBackspace,
  isImeComposingKeyboardEvent,
  prependMediaChip,
  serializeChatComposer,
} from '@/lib/agent-chat-composer-dom';

type AgentChatRole = 'user' | 'assistant';

export type AgentChatAttachment = {
  id: string;
  name: string;
  kind: 'image' | 'audio' | 'video' | 'file';
  url: string;
};

export type AgentChatMessage = {
  role: AgentChatRole;
  content: string;
  thinking?: string;
  attachments?: AgentChatAttachment[];
  provider?: string;
  model?: string;
};

interface AgentNodeData extends CanvasNodeData {
  agentName?: string;
  agentPrompt?: string;
  prompt?: string;
  output?: string;
  model?: string;
  llmSource?: string;
  geminiModel?: string;
  documentNames?: string[];
  agentChatHistory?: AgentChatMessage[];
  agentWidth?: number;
  agentHeight?: number;
  isGenerating?: boolean;
  generationProgress?: GenerationProgress;
  lastGenerationCredits?: number;
}

interface GenerationProgress {
  status: 'idle' | 'connecting' | 'generating' | 'success' | 'error';
  progress: number;
  message: string;
}

const DEFAULT_TEXT_MODEL = 'gpt-5-5';
const DOCUMENT_ACCEPT = [
  'text/*',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.log',
  '.srt',
  '.vtt',
  '.doc',
  '.docx',
  '.pdf',
].join(',');

const ROLE_UPLOAD_ACCEPT = `${DOCUMENT_ACCEPT},image/*,audio/*,video/*` as const;
const CHAT_UPLOAD_ACCEPT = `${DOCUMENT_ACCEPT},image/*,audio/*,video/*` as const;

const ROLE_IMAGE_INLINE_MAX_BYTES = 240_000;
const AGENT_MEDIA_MAX_BYTES: Record<LlmMediaKind, number> = {
  image: 12 * 1024 * 1024,
  audio: 30 * 1024 * 1024,
  video: 45 * 1024 * 1024,
  document: 15 * 1024 * 1024,
};

function readFileAsDataUrl(file: File, maxBytes: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (file.size > maxBytes) {
      resolve(null);
      return;
    }
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

function revokeComposerBlobUrls(editor: HTMLElement) {
  editor.querySelectorAll(`span[${AGENT_CHAT_MEDIA_ATTR}="1"]`).forEach((el) => {
    // Upstream chips borrow the source node URL; revoking it invalidates that node.
    if (el.hasAttribute('data-ext-node-id')) return;
    const u = el.getAttribute('data-url');
    if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
  });
}

function inferIncomingMediaKind(fileType: string | undefined, url: string): 'image' | 'audio' | 'video' | 'file' {
  const ft = (fileType || '').toLowerCase();
  if (ft.startsWith('video') || /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(url)) return 'video';
  if (ft.startsWith('audio') || /\.(mp3|wav|m4a|aac|flac|ogg)(\?|$)/i.test(url)) return 'audio';
  if (ft.startsWith('image') || /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url)) return 'image';
  return 'file';
}

function isReadableTextFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return (
    file.type.startsWith('text/') ||
    /\.(txt|md|markdown|csv|json|ya?ml|xml|html?|log|srt|vtt)$/i.test(lowerName)
  );
}

function appendPromptDocument(prompt: string, fileName: string, content: string) {
  const trimmed = prompt.trimEnd();
  const prefix = trimmed ? `${trimmed}\n\n` : '';
  return `${prefix}【上传文档：${fileName}】\n${content.trim()}`;
}

function getAgentName(data: AgentNodeData) {
  return (data.agentName || data.label || 'Agent').trim() || 'Agent';
}

function isValidChatAttachment(v: unknown): v is AgentChatAttachment {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.url === 'string' &&
    (o.kind === 'image' || o.kind === 'audio' || o.kind === 'video' || o.kind === 'file')
  );
}

function isAgentChatMessage(v: unknown): v is AgentChatMessage {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  if (typeof m.content !== 'string' || (m.role !== 'user' && m.role !== 'assistant')) return false;
  if (m.provider != null && typeof m.provider !== 'string') return false;
  if (m.model != null && typeof m.model !== 'string') return false;
  if (m.attachments == null) return true;
  if (!Array.isArray(m.attachments)) return false;
  return m.attachments.every(isValidChatAttachment);
}

/** 仅比较会写入工程的字段；忽略 React Flow 拖拽时变化的 position 等，减轻重绘卡顿 */
function agentPersistSlice(data: AgentNodeData) {
  return {
    label: data.label,
    agentName: data.agentName,
    agentPrompt: data.agentPrompt,
    prompt: data.prompt,
    output: data.output,
    model: data.model,
    llmSource: data.llmSource,
    geminiModel: data.geminiModel,
    documentNames: data.documentNames,
    agentChatHistory: data.agentChatHistory,
    agentWidth: data.agentWidth,
    agentHeight: data.agentHeight,
  };
}

function agentNodePropsEqual(prev: NodeProps, next: NodeProps): boolean {
  if (prev.id !== next.id) return false;
  if (prev.selected !== next.selected) return false;
  if (prev.data === next.data) return true;
  try {
    return (
      JSON.stringify(agentPersistSlice(prev.data as AgentNodeData)) ===
      JSON.stringify(agentPersistSlice(next.data as AgentNodeData))
    );
  } catch {
    return false;
  }
}

function formatHistoryEntry(m: AgentChatMessage): string {
  const head = m.role === 'user' ? `用户：${m.content}` : `助手：${m.content}`;
  if (m.role !== 'user' || !m.attachments?.length) return head;
  const tail = m.attachments
    .map((a) =>
      a.kind === 'image'
        ? `  [图片: ${a.name}]`
        : a.kind === 'audio'
          ? `  [音频: ${a.name}]`
          : a.kind === 'video'
            ? `  [视频: ${a.name}]`
            : `  [文件: ${a.name}]`
    )
    .join('\n');
  return `${head}\n${tail}`;
}

function buildAgentLlmPrompt(args: {
  agentPrompt: string;
  upstreamInput: string;
  history: AgentChatMessage[];
}): string {
  const blocks: string[] = [];
  if (args.agentPrompt.trim()) {
    blocks.push(`【Agent 角色与指令】\n${args.agentPrompt.trim()}`);
  }
  if (args.upstreamInput.trim()) {
    blocks.push(`【画布输入端】\n${args.upstreamInput.trim()}`);
  }
  if (args.history.length > 0) {
    const lines = args.history.map(formatHistoryEntry);
    blocks.push(`【对话】\n${lines.join('\n\n')}`);
  }
  return composePrompt(blocks);
}

const STREAMING_THOUGHT_KEY = -1;

function resolveAssistantMessage(msg: AgentChatMessage): { content: string; thinking?: string } {
  if (msg.role !== 'assistant') return { content: msg.content };
  if (msg.thinking) return { content: msg.content, thinking: msg.thinking };
  const { cleaned, thinking } = extractAndCleanText(msg.content);
  return { content: cleaned, thinking };
}

function mergeThinkingParts(...parts: Array<string | undefined>): string | undefined {
  const merged = parts.map((p) => p?.trim()).filter(Boolean).join('\n\n');
  return merged || undefined;
}

function resolveAgentOutputTokenLimit(provider: string, model: string): number {
  const identity = `${provider}:${model}`.toLowerCase();
  return /deepseek|reasoner|thinking/.test(identity) ? 8192 : 4096;
}


const COMPOSER_BTN_PX = 32;
const COMPOSER_EDITOR_PX = 76;

function AgentNode({ id, data, selected }: NodeProps) {
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeData = data as AgentNodeData;
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const isExpanded = useCanvasStore((state) => state.selectedNode?.id === id);
  const downstreamNodes = useCanvasStore(
    useShallow((state) => {
      const ids = state.downstreamNodeIdsBySource[id] ?? [];
      if (ids.length === 0) return [] as Node<CanvasNodeData>[];
      const byId = new Map(state.nodes.map((node) => [node.id, node]));
      return ids.map((targetId) => byId.get(targetId)).filter((node): node is Node<CanvasNodeData> => Boolean(node));
    })
  );
  const { config, addUsedTokens, addProviderTokens, setProviderRemainingTokens } = useSeedanceStore(
    useShallow((s) => ({
      config: s.config,
      addUsedTokens: s.addUsedTokens,
      addProviderTokens: s.addProviderTokens,
      setProviderRemainingTokens: s.setProviderRemainingTokens,
    }))
  );
  const incomingPromptSources = useIncomingPromptSources(id);
  const connectedMaterials = useIncomingMaterialRefs(id);
  const roleFileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const chatEditorRef = useRef<HTMLDivElement>(null);
  const chatEditorComposingRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowLatestRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const generationRunIdRef = useRef(0);
  const connectedMaterialsRef = useRef<MaterialRef[]>([]);
  const promptOnlyUpstreamRef = useRef('');
  const prevExtMaterialIdsRef = useRef<Set<string>>(new Set());
  const [composerTick, setComposerTick] = useState(0);
  // Node data is not reflected synchronously by React Flow props, so keep a local
  // UI flag for immediate cancel/send button feedback and persist it to node data.
  const persistedIsGenerating = nodeData.isGenerating === true;
  const [uiIsGenerating, setUiIsGenerating] = useState(persistedIsGenerating);
  useEffect(() => {
    setUiIsGenerating(persistedIsGenerating);
  }, [persistedIsGenerating]);
  const isGenerating = uiIsGenerating;
  const generationProgress: GenerationProgress =
    typeof nodeData.generationProgress === 'object' && nodeData.generationProgress
      ? nodeData.generationProgress as GenerationProgress
      : { status: 'idle' as const, progress: 0, message: '' };
  const setIsGenerating = (v: boolean) => {
    setUiIsGenerating(v);
    updateNodeData(id, { isGenerating: v } as Partial<AgentNodeData>, { recordUndo: false });
  };
  const setGenerationProgress = (v: GenerationProgress) =>
    updateNodeData(id, { generationProgress: v } as Partial<AgentNodeData>, { recordUndo: false });
  /** 流式生成时 UI 草稿（不写入 store，避免每 token 触发整画布） */
  const [streamDraft, setStreamDraft] = useState('');
  const [streamThinkingDraft, setStreamThinkingDraft] = useState('');
  const [optimisticChatHistory, setOptimisticChatHistory] = useState<AgentChatMessage[] | null>(null);
  const [streamingAssistantMessage, setStreamingAssistantMessage] = useState<AgentChatMessage | null>(null);
  const [expandedThoughts, setExpandedThoughts] = useState<Set<number>>(() => new Set());
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const streamAccRef = useRef('');
  const streamThinkingRef = useRef('');
  const streamUiSchedulerRef = useRef(createStreamUiScheduler(() => {
    const { cleaned, thinking: tagThinking } = extractAndCleanText(streamAccRef.current);
    const thinking = mergeThinkingParts(streamThinkingRef.current, tagThinking);
    setStreamThinkingDraft(thinking || '');
    setStreamDraft(cleaned);
    setStreamingAssistantMessage({ role: 'assistant', content: cleaned, thinking: thinking || undefined });
  }));
  const cancelGeneration = useCallback(() => {
    generationRunIdRef.current += 1;
    const controller = abortRef.current;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    abortRef.current = null;
    flushSync(() => {
      streamUiSchedulerRef.current.cancel();
      streamAccRef.current = '';
      streamThinkingRef.current = '';
      setStreamDraft('');
      setStreamThinkingDraft('');
      setOptimisticChatHistory(null);
      setStreamingAssistantMessage(null);
      setUiIsGenerating(false);
      updateNodeData(id, {
        isGenerating: false,
        generationProgress: { status: 'idle', progress: 0, message: '' },
      } as Partial<AgentNodeData>, { recordUndo: false });
    });
  }, [id, updateNodeData]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      streamUiSchedulerRef.current.cancel();
    };
  }, []);
  const upstreamInput = useMemo(
    () => composePrompt(incomingPromptSources.map((source) => source.text)),
    [incomingPromptSources]
  );
  const promptOnlyUpstream = useMemo(
    () =>
      composePrompt(
        incomingPromptSources
          .filter((s) => s.nodeType === 'prompt' || s.nodeType === 'material')
          .map((s) => s.text)
      ),
    [incomingPromptSources]
  );
  const extMaterialSig = useMemo(
    () =>
      connectedMaterials
        .map((m) => `${m.nodeId}:${m.fileUrl || ''}:${m.seedanceAssetUri || ''}:${m.fileType || ''}:${m.characterDescription || ''}:${m.characterVoiceReferenceUrl || ''}`)
        .join('|'),
    [connectedMaterials]
  );
  const extPromptSyncSig = useMemo(() => {
    const t = promptOnlyUpstream.trim();
    return `${t.length}:${t}`;
  }, [promptOnlyUpstream]);

  connectedMaterialsRef.current = connectedMaterials;
  promptOnlyUpstreamRef.current = promptOnlyUpstream;
  const legacyPrompt = typeof nodeData.prompt === 'string' ? nodeData.prompt : '';
  const agentName = getAgentName(nodeData);
  const agentPrompt =
    typeof nodeData.agentPrompt === 'string'
      ? nodeData.agentPrompt
      : legacyPrompt && !isSamePromptText(legacyPrompt, upstreamInput)
        ? legacyPrompt
        : '';
  const output = nodeData.output || '';
  const forwardedText = getAgentForwardPromptText(nodeData, null);
  useEffect(() => {
    if (!forwardedText) return;
    downstreamNodes.forEach((targetNode) => {
      const targetType = (targetNode.type || targetNode.data.type) as string;
      if (targetType === 'agent') return;

      if (targetType === 'prompt') {
        if (targetNode.data.text === forwardedText) return;
        updateNodeData(targetNode.id, { text: forwardedText });
        return;
      }

      if (targetNode.data.promptEdited === true || targetNode.data.prompt === forwardedText) return;
      updateNodeData(targetNode.id, { prompt: forwardedText });
    });
  }, [downstreamNodes, forwardedText, updateNodeData]);
  const explicitSource: string | undefined =
    typeof nodeData.llmSource === 'string' && nodeData.llmSource.trim() ? nodeData.llmSource : undefined;
  const llmRouteSelectValue = explicitSource && !isRemovedProvider('llm', explicitSource)
    ? explicitSource
    : 'inherit';
  const effectiveProvider = resolveLlmTextProvider(explicitSource, config.defaultLlmSource);
  const volcModelId = resolveLlmModelForProvider(
    config,
    effectiveProvider,
    typeof nodeData.model === 'string' ? nodeData.model : undefined,
    DEFAULT_TEXT_MODEL
  );
  const routeModelOptions = useMemo(
    () => buildLlmModelOptionsForProvider(config, effectiveProvider),
    [config, effectiveProvider]
  );
  const effectiveProviderRecord = getLlmProviderRecord(config, effectiveProvider);
  const routeProviderLabel = effectiveProviderRecord?.label || effectiveProvider;
  const isKieAgentProvider = isKieProvider(effectiveProviderRecord, effectiveProvider);
  const kieAgentUsage = useMemo(
    () =>
      buildKieUsageDisplay({
        kind: 'llm',
        providerId: effectiveProvider,
        provider: effectiveProviderRecord,
        bucket: getKieProviderTokenBucket(config.providerTokens, `llm.${effectiveProvider}`),
        model: effectiveProvider === 'gemini' ? nodeData.geminiModel || config.multimodalApi.model : volcModelId,
        tokenEstimate: 2048,
      }),
    [config.providerTokens, config.multimodalApi.model, effectiveProvider, effectiveProviderRecord, nodeData.geminiModel, volcModelId]
  );
  const geminiModelId = resolveGeminiModelId(
    typeof nodeData.geminiModel === 'string' ? nodeData.geminiModel : undefined,
    config.multimodalApi.model
  );
  const geminiModelOptions = useMemo(() => {
    const provider = config.llm.providers.gemini ?? config.llm.customProviders.gemini;
    return provider?.models?.length ? provider.models : mergeGeminiModelLists([]);
  }, [config.llm]);

  // Build provider route options from configured LLM providers
  const llmProviderRoutes = useMemo(() => {
    const all = { ...config.llm.providers, ...config.llm.customProviders };
    return Object.entries(all)
      .filter(([id, p]) => !isRemovedProvider('llm', id) && p.enabled && p.apiKey.trim())
      .map(([id, p]) => ({ value: id, label: p.label }));
  }, [config.llm]);

  const canUseRealLlm = (() => {
    if (effectiveProvider === 'gemini') {
      if (config.multimodalApi.apiKey.trim()) return true;
      const v2Gemini = config.llm.providers.gemini ?? config.llm.customProviders.gemini;
      if (v2Gemini?.apiKey.trim()) return true;
      return false;
    }
    if (effectiveProvider === 'claude') {
      if (config.claudeApi?.apiKey.trim()) return true;
      const v2Claude = config.llm.providers.claude ?? config.llm.customProviders.claude;
      if (v2Claude?.apiKey.trim()) return true;
      return false;
    }
    const v2Provider = config.llm.providers[effectiveProvider] ?? config.llm.customProviders[effectiveProvider];
    return Boolean(v2Provider?.apiKey.trim());
  })();
  const documentNames = Array.isArray(nodeData.documentNames) ? nodeData.documentNames : [];

  const chatHistory = useMemo((): AgentChatMessage[] => {
    const raw = nodeData.agentChatHistory;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.filter((m): m is AgentChatMessage => isAgentChatMessage(m));
    }
    if (output.trim()) {
      return [{ role: 'assistant', content: output.trim() }];
    }
    return [];
  }, [nodeData.agentChatHistory, output]);
  const displayChatHistory = useMemo(() => {
    const base = optimisticChatHistory ?? chatHistory;
    return streamingAssistantMessage ? [...base, streamingAssistantMessage] : base;
  }, [chatHistory, optimisticChatHistory, streamingAssistantMessage]);

  useEffect(() => {
    const raw = nodeData.agentChatHistory;
    if (Array.isArray(raw) && raw.length > 0) return;
    const out = typeof nodeData.output === 'string' ? nodeData.output.trim() : '';
    if (!out) return;
    updateNodeData(id, { agentChatHistory: [{ role: 'assistant', content: out }] });
  }, [id, nodeData.agentChatHistory, nodeData.output, updateNodeData]);

  const last = displayChatHistory.length ? displayChatHistory[displayChatHistory.length - 1] : undefined;
  const lastAttSig = last?.attachments?.map((a) => a.id).join(',') || '';
  const lastMsgSig = last
    ? `${last.role}:${last.content.length}:${last.thinking?.length || 0}:${lastAttSig}:${last.content.slice(0, 48)}`
    : '0';

  const scrollChatToLatest = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    shouldFollowLatestRef.current = true;
    setShowScrollToLatest(false);
    el.scrollTop = el.scrollHeight;
  }, []);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const isNearLatest = el.scrollHeight - el.scrollTop - el.clientHeight <= 36;
    shouldFollowLatestRef.current = isNearLatest;
    setShowScrollToLatest(!isNearLatest);
  }, []);

  useEffect(() => {
    if (!isExpanded) return;
    shouldFollowLatestRef.current = true;
    setShowScrollToLatest(false);
    const el = chatScrollRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [isExpanded]);

  useEffect(() => {
    if (!shouldFollowLatestRef.current) return;
    const el = chatScrollRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      if (shouldFollowLatestRef.current) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [displayChatHistory.length, lastMsgSig]);

  const toggleThoughtExpanded = useCallback((key: number) => {
    setExpandedThoughts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const updateAssistantMessageContent = useCallback((messageIndex: number, nextContent: string) => {
    const target = chatHistory[messageIndex];
    if (!target || target.role !== 'assistant') return;
    const nextHistory = chatHistory.map((message, index) => (
      index === messageIndex ? { ...message, content: nextContent } : message
    ));
    let lastAssistantIndex = -1;
    nextHistory.forEach((message, index) => {
      if (message.role === 'assistant') lastAssistantIndex = index;
    });
    updateNodeData(id, {
      agentChatHistory: nextHistory,
      ...(lastAssistantIndex === messageIndex ? { output: nextContent } : {}),
    });
  }, [chatHistory, id, updateNodeData]);

  useEffect(() => {
    return () => {
      streamUiSchedulerRef.current.cancel();
    };
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => updateNodeInternals(id));
    return () => cancelAnimationFrame(raf);
  }, [
    id,
    updateNodeInternals,
    chatHistory.length,
    lastMsgSig,
    isExpanded,
    upstreamInput,
    extMaterialSig,
    extPromptSyncSig,
    composerTick,
  ]);

  const composerSync = useCallback(() => {
    const el = chatEditorRef.current;
    if (!el) return;

    const extNow = new Set(
      [...el.querySelectorAll(`span[${AGENT_CHAT_MEDIA_ATTR}="1"][data-ext-node-id]`)].map(
        (n) => (n as HTMLElement).getAttribute('data-ext-node-id') || ''
      ).filter(Boolean)
    );
    const prev = prevExtMaterialIdsRef.current;
    const removed = [...prev].filter((sid) => !extNow.has(sid));
    if (removed.length > 0) {
      const { edges, onEdgesChange } = useCanvasStore.getState();
      const rm = new Set(removed);
      const drops = edges
        .filter((e) => e.target === id && rm.has(e.source))
        .map((e) => ({ type: 'remove' as const, id: e.id }));
      if (drops.length > 0) {
        onEdgesChange(drops);
        queueMicrotask(() => updateNodeInternals([id, ...removed]));
      }
    }
    prevExtMaterialIdsRef.current = extNow;

    const { plainText, attachments } = serializeChatComposer(el);
    el.setAttribute('data-empty', !plainText.trim() && attachments.length === 0 ? '1' : '0');
    setComposerTick((n) => n + 1);
  }, [id, updateNodeInternals]);

  useEffect(() => {
    if (!isExpanded) return;
    const frame = requestAnimationFrame(() => composerSync());
    return () => cancelAnimationFrame(frame);
  }, [isExpanded, composerSync]);

  const canSendComposer = useMemo(() => {
    const el = chatEditorRef.current;
    if (!el) return false;
    const { plainText, attachments } = serializeChatComposer(el);
    return Boolean(plainText.trim() || attachments.length > 0);
  }, [composerTick]);

  const applyUpstreamComposerSync = useCallback(() => {
    if (!isExpanded) return;
    const editor = chatEditorRef.current;
    if (!editor) return;

    const mats = connectedMaterialsRef.current;
    const promptText = promptOnlyUpstreamRef.current.trim();

    editor.querySelectorAll(`span[${AGENT_CHAT_MEDIA_ATTR}="1"][data-ext-node-id]`).forEach((el) => el.remove());
    editor.querySelector('[data-ext-prompt-sync="1"]')?.remove();

    for (const m of [...mats].reverse()) {
      const url = (m.fileUrl || m.seedanceAssetUri || '').trim();
      if (url) {
        const kind = inferIncomingMediaKind(m.fileType, url);
        const chip = createMediaChipElement({
          id: `ext_${m.nodeId}`,
          name: (m.fileName || m.slug || '素材').trim() || '素材',
          kind,
          displayUrl: url,
          extSourceNodeId: m.nodeId,
        });
        prependMediaChip(editor, chip);
      }
      const voiceUrl = m.characterMaterial ? m.characterVoiceReferenceUrl?.trim() : '';
      if (voiceUrl) {
        const voiceChip = createMediaChipElement({
          id: `ext_${m.nodeId}_character_voice`,
          name: m.characterVoiceFileName || `${m.slug}参考音色`,
          kind: 'audio',
          displayUrl: voiceUrl,
          extSourceNodeId: m.nodeId,
        });
        prependMediaChip(editor, voiceChip);
      }
    }

    if (promptText) {
      const span = document.createElement('span');
      span.setAttribute('data-ext-prompt-sync', '1');
      span.className = 'text-zinc-400/95 select-text';
      span.contentEditable = 'false';
      span.textContent = promptText;
      let insertBefore: ChildNode | null = null;
      for (const child of [...editor.childNodes]) {
        if (
          child instanceof HTMLElement &&
          child.getAttribute(AGENT_CHAT_MEDIA_ATTR) === '1' &&
          child.hasAttribute('data-ext-node-id')
        ) {
          continue;
        }
        insertBefore = child;
        break;
      }
      editor.insertBefore(span, insertBefore);
    }

    composerSync();
  }, [isExpanded, composerSync]);

  useEffect(() => {
    applyUpstreamComposerSync();
  }, [extMaterialSig, extPromptSyncSig, isExpanded, applyUpstreamComposerSync]);

  useEffect(() => {
    if (!isGenerating) applyUpstreamComposerSync();
  }, [isGenerating, applyUpstreamComposerSync]);

  const handleRoleUploadClick = () => {
    roleFileInputRef.current?.click();
  };

  const handleChatUploadClick = () => {
    chatFileInputRef.current?.click();
  };

  const handleRoleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    let nextAgentPrompt = agentPrompt;
    const nextNames = [...documentNames];

    for (const file of files) {
      nextNames.push(file.name);
      const mime = file.type || '';
      if (mime.startsWith('image/')) {
        const dataUrl = await readFileAsDataUrl(file, ROLE_IMAGE_INLINE_MAX_BYTES);
        if (dataUrl) {
          const base = nextAgentPrompt.trimEnd();
          const imgLine = `![${file.name}](${dataUrl})`;
          nextAgentPrompt = base ? `${base}\n\n${imgLine}` : imgLine;
        } else {
          nextAgentPrompt = appendPromptDocument(
            nextAgentPrompt,
            file.name,
            `【图片】文件较大（约超过 ${Math.round(ROLE_IMAGE_INLINE_MAX_BYTES / 1000)}KB），未内联到指令。请压缩后重试或在此用文字描述画面要点。`
          );
        }
      } else if (mime.startsWith('video/')) {
        nextAgentPrompt = appendPromptDocument(
          nextAgentPrompt,
          file.name,
          '【视频】已记录文件名。视频无法完整写入指令区，请用文字描述关键镜头、时长与台词要点。'
        );
      } else if (mime.startsWith('audio/')) {
        nextAgentPrompt = appendPromptDocument(
          nextAgentPrompt,
          file.name,
          '【音频】已记录文件名。请在下方聊天输入区添加该音频，以便多模态模型直接识别。'
        );
      } else if (isReadableTextFile(file)) {
        const text = await file.text();
        nextAgentPrompt = appendPromptDocument(nextAgentPrompt, file.name, text);
      } else {
        nextAgentPrompt = appendPromptDocument(
          nextAgentPrompt,
          file.name,
          '已添加该文档名称。当前前端可直接读取文本类文件；PDF、Word 等二进制文档请粘贴关键内容。'
        );
      }
    }

    updateNodeData(id, {
      agentPrompt: nextAgentPrompt.trim(),
      documentNames: Array.from(new Set(nextNames)).slice(-12),
    });
    event.target.value = '';
  };

  const handleChatFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const editor = chatEditorRef.current;
    event.target.value = '';
    if (!editor || files.length === 0) return;

    for (const file of [...files].reverse()) {
      const mime = file.type || '';
      let kind: 'image' | 'audio' | 'video' | 'file' = 'file';
      if (mime.startsWith('image/')) kind = 'image';
      else if (mime.startsWith('audio/')) kind = 'audio';
      else if (mime.startsWith('video/')) kind = 'video';
      const displayUrl = URL.createObjectURL(file);
      const attId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const chip = createMediaChipElement({ id: attId, name: file.name, kind, displayUrl });
      prependMediaChip(editor, chip);
    }
    composerSync();
  };

  const runMockReply = useCallback(
    async (historyAfterUser: AgentChatMessage[], signal?: AbortSignal) => {
      await new Promise((resolve) => setTimeout(resolve, 280));
      if (signal?.aborted) return;
      const mockResponse = `【${agentName}】（模拟）已结合角色指令与对话上下文生成回复。\n\n当前未配置 LLM API，此为占位内容。`;
      const next = [...historyAfterUser, { role: 'assistant' as const, content: mockResponse }];
      updateNodeData(id, { agentChatHistory: next, output: mockResponse });
      setGenerationProgress({ status: 'success', progress: 100, message: '模拟完成' });
    },
    [agentName, id, updateNodeData]
  );

  const handleSend = useCallback(async () => {
    if (isGenerating) return;

    const editor = chatEditorRef.current;
    if (!editor) return;

    let { plainText, attachments } = serializeChatComposer(editor);
    const syncedPrompt = (editor.querySelector('[data-ext-prompt-sync="1"]')?.textContent || '').trim();
    let trimmedText = plainText.trim();
    if (!trimmedText && syncedPrompt) trimmedText = syncedPrompt;

    if (!trimmedText && attachments.length === 0) return;

    const hasMultimodalAttachment = attachments.some((a) => a.kind !== 'file');
    if (hasMultimodalAttachment && effectiveProvider !== 'gemini') {
      setGenerationProgress({
        status: 'error',
        progress: 0,
        message: '当前模型路由不支持图片、音频或视频理解，请选择具备多模态能力的 Gemini 模型。',
      });
      return;
    }

    const resolved: AgentChatAttachment[] = [];
    for (const a of attachments) {
      let url = a.url;
      const isMedia = a.kind === 'image' || a.kind === 'audio' || a.kind === 'video';
      const needsInlineData =
        url.startsWith('blob:') ||
        (isMedia && effectiveProvider === 'gemini' && !isKieAgentProvider && !url.startsWith('data:'));
      if (needsInlineData) {
        const limit = a.kind === 'file' ? 450_000 : AGENT_MEDIA_MAX_BYTES[a.kind];
        const next = await blobUrlToDataUrl(url, limit);
        if (!next) {
          setGenerationProgress({
            status: 'error',
            progress: 0,
            message: `无法读取“${a.name}”或文件超过模型输入限制，请换用较小素材后重试。`,
          });
          return;
        }
        url = next;
      }
      resolved.push({ id: a.id, name: a.name, kind: a.kind, url });
    }

    const userMsg: AgentChatMessage = {
      role: 'user',
      content: trimmedText,
      attachments: resolved.length > 0 ? resolved : undefined,
    };
    let historyWithUser: AgentChatMessage[] = [...chatHistory, userMsg];

    const composed = buildAgentLlmPrompt({
      agentPrompt,
      upstreamInput,
      history: historyWithUser,
    });
    if (!composed.trim()) {
      setGenerationProgress({
        status: 'error',
        progress: 0,
        message: '请先填写角色指令、连接画布输入，或输入有效消息。',
      });
      return;
    }

    revokeComposerBlobUrls(editor);
    clearChatComposer(editor);
    // Recreate connected chips before composerSync checks for removals. The old
    // order treated this temporary empty state as an explicit edge deletion.
    applyUpstreamComposerSync();

    shouldFollowLatestRef.current = true;
    setShowScrollToLatest(false);

    updateNodeData(id, { agentChatHistory: historyWithUser }, { recordUndo: false });
    setOptimisticChatHistory(historyWithUser);
    setStreamingAssistantMessage({ role: 'assistant', content: '' });

    setIsGenerating(true);
    setGenerationProgress({ status: 'connecting', progress: 15, message: '准备请求…' });
    const controller = new AbortController();
    const runId = ++generationRunIdRef.current;
    abortRef.current = controller;

    let mediaInputs: LlmMediaInput[] = resolved
      .filter((item): item is AgentChatAttachment & { kind: LlmMediaKind } => item.kind !== 'file')
      .map((item) => ({
        kind: item.kind,
        url: item.url,
        name: item.name,
      }));

    try {
      if (!canUseRealLlm) {
        await runMockReply(historyWithUser, controller.signal);
        return;
      }

      streamAccRef.current = '';
      streamThinkingRef.current = '';
      setStreamDraft('');
      setStreamThinkingDraft('');

      if (mediaInputs.length > 0 && effectiveProvider === 'gemini' && isKieAgentProvider) {
        const apiKey = effectiveProviderRecord?.apiKey.trim() || config.multimodalApi.apiKey.trim();
        setGenerationProgress({ status: 'connecting', progress: 22, message: '正在上传多模态素材…' });
        mediaInputs = await materializeKieAgentMedia({
          apiKey,
          media: mediaInputs,
          signal: controller.signal,
        });
        let mediaIndex = 0;
        const persistedAttachments = resolved.map((attachment) => {
          if (attachment.kind === 'file') return attachment;
          const uploaded = mediaInputs[mediaIndex++];
          return uploaded ? { ...attachment, url: uploaded.url } : attachment;
        });
        historyWithUser = [
          ...chatHistory,
          { ...userMsg, attachments: persistedAttachments },
        ];
        updateNodeData(id, { agentChatHistory: historyWithUser }, { recordUndo: false });
        setOptimisticChatHistory(historyWithUser);
      }

      setGenerationProgress({ status: 'generating', progress: 35, message: '思考中…' });

      const baseSystemPrompt = `你是名为「${agentName}」的专业 AI Agent。严格依据「Agent 角色与指令」与对话内容回复，条理清晰、可执行。消息附带图片、音频或视频时，必须直接识别并分析素材内容。`;
      const systemPrompt = isOpenAi55AgentModel(effectiveProvider, volcModelId)
        ? `${baseSystemPrompt}\n\n${OPENAI55_ARTIFACT_SYSTEM_INSTRUCTION}`
        : baseSystemPrompt;
      const outputTokenLimit = resolveAgentOutputTokenLimit(effectiveProvider, volcModelId);
      const streamParams = {
        config,
        volcModel: volcModelId,
        provider: effectiveProvider,
        geminiModelId,
        prompt: composed,
        systemPrompt,
        maxTokens: outputTokenLimit,
        mediaInputs: mediaInputs.length ? mediaInputs : undefined,
        signal: controller.signal,
      };

      const scheduleStreamUiFlush = () => {
        streamUiSchedulerRef.current.flushNow();
      };

      let lastProgressAt = 0;
      const applyStreamText = (kind: 'content' | 'reasoning', text: string) => {
        if (kind === 'reasoning') {
          streamThinkingRef.current += text;
        } else {
          streamAccRef.current += text;
        }
        scheduleStreamUiFlush();
        const len = streamAccRef.current.length + streamThinkingRef.current.length;
        const now = performance.now();
        if (now - lastProgressAt > 140 || len < 32) {
          lastProgressAt = now;
          const estimatedProgress = Math.min(35 + (len / 2000) * 50, 92);
          setGenerationProgress({
            status: 'generating',
            progress: estimatedProgress,
            message: `思考中…（${len} 字）`,
          });
        }
      };

      if (effectiveProvider === 'claude') {
        const v2ClaudeProvider = config.llm.providers.claude ?? config.llm.customProviders.claude;
        const claudeApiKey = v2ClaudeProvider?.apiKey.trim() || config.claudeApi?.apiKey?.trim() || '';
        const claudeApiUrl = v2ClaudeProvider?.apiUrl || config.claudeApi?.apiUrl;
        if (!claudeApiKey) {
          throw new Error('请先配置 Claude API Key');
        }
        for await (const event of streamClaudeTurn({
          apiKey: claudeApiKey,
          apiUrl: claudeApiUrl,
          model: volcModelId,
          systemPrompt,
          messages: [{ role: 'user', content: composed }],
          tools: [],
          includeReasoning: true,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted || generationRunIdRef.current !== runId) break;
          if (event.type === 'text_delta') {
            applyStreamText('content', event.text);
          } else if (event.type === 'reasoning_delta') {
            applyStreamText('reasoning', event.text);
          } else if (event.type === 'error') {
            throw new Error(event.message);
          } else if (event.type === 'stop' && event.stopReason === 'aborted') {
            throw new DOMException('Aborted', 'AbortError');
          }
        }
      } else {
        for await (const part of streamLlmTextParts(streamParams)) {
          if (controller.signal.aborted || generationRunIdRef.current !== runId) break;
          applyStreamText(part.kind, part.text);
        }
      }

      if (controller.signal.aborted || generationRunIdRef.current !== runId) return;

      streamUiSchedulerRef.current.flushNow();

      const { cleaned: assistantText, thinking: tagThinking } = extractAndCleanText(streamAccRef.current);
      const thinking = mergeThinkingParts(streamThinkingRef.current, tagThinking);
      if (!assistantText.trim()) {
        throw new Error(
          thinking
            ? '模型已完成思考，但没有返回正文。请重试；若连续出现，请切换该厂商的非推理模型。'
            : '模型没有返回可显示的正文。请重试或切换模型。',
        );
      }
      const billed = estimateLlmTokens(composed, assistantText, outputTokenLimit);
      if (billed > 0) {
        addUsedTokens(effectiveProvider === 'gemini' ? 'multimodal' : 'llm', billed);
        addProviderTokens(`llm.${effectiveProvider}`, billed);
        if (isKieAgentProvider) {
          void fetchKieCredits(effectiveProviderRecord)
            .then((credits) => {
              if (credits != null) setProviderRemainingTokens(KIE_GLOBAL_PROVIDER_TOKEN_KEY, credits);
            })
            .catch(() => undefined);
        }
      }

      const nextHist: AgentChatMessage[] = [
        ...historyWithUser,
        {
          role: 'assistant',
          content: assistantText,
          thinking,
          provider: effectiveProvider,
          model: effectiveProvider === 'gemini' ? geminiModelId : volcModelId,
        },
      ];
      if (generationRunIdRef.current === runId) {
        setOptimisticChatHistory(nextHist);
        setStreamingAssistantMessage(null);
        updateNodeData(id, { agentChatHistory: nextHist, output: assistantText }, { recordUndo: false });
        setGenerationProgress({ status: 'success', progress: 100, message: '完成' });
        requestAnimationFrame(() => {
          if (generationRunIdRef.current === runId) {
            setOptimisticChatHistory(null);
            setStreamingAssistantMessage(null);
          }
        });
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        if (generationRunIdRef.current === runId) {
          setOptimisticChatHistory(null);
          setStreamingAssistantMessage(null);
          setGenerationProgress({ status: 'idle', progress: 0, message: '' });
        }
        return;
      }
      if (generationRunIdRef.current !== runId) return;
      console.error('Agent 生成失败:', error);
      streamUiSchedulerRef.current.cancel();
      streamAccRef.current = '';
      streamThinkingRef.current = '';
      setStreamDraft('');
      setStreamThinkingDraft('');
      setOptimisticChatHistory(null);
      setStreamingAssistantMessage(null);
      setGenerationProgress({
        status: 'error',
        progress: 0,
        message: `失败：${error instanceof Error ? error.message : '未知错误'}`,
      });
    } finally {
      if (generationRunIdRef.current === runId) {
        streamUiSchedulerRef.current.cancel();
        streamAccRef.current = '';
        streamThinkingRef.current = '';
        setStreamDraft('');
        setStreamThinkingDraft('');
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      if (generationRunIdRef.current === runId) {
        setIsGenerating(false);
        setTimeout(() => {
          if (generationRunIdRef.current === runId && generationProgress.status === 'success') {
            setGenerationProgress({ status: 'idle', progress: 0, message: '' });
          }
        }, 1600);
      }
    }
  }, [
    addUsedTokens,
    agentName,
    agentPrompt,
    applyUpstreamComposerSync,
    canUseRealLlm,
    chatHistory,
    config,
    effectiveProvider,
    effectiveProviderRecord,
    geminiModelId,
    id,
    isGenerating,
    isKieAgentProvider,
    runMockReply,
    upstreamInput,
    updateNodeData,
    volcModelId,
  ]);

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (chatEditorComposingRef.current || isImeComposingKeyboardEvent(e)) return;
    const ed = chatEditorRef.current;
    if (ed && handleComposerBackspace(ed, e as React.KeyboardEvent<HTMLElement>)) {
      composerSync();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const previewText = useMemo(() => {
    const last = chatHistory.filter((m) => m.role === 'assistant').pop();
    if (last?.content) return last.content;
    const u = chatHistory.filter((m) => m.role === 'user').pop();
    if (u?.content) return u.content;
    return agentPrompt || upstreamInput || 'Agent';
  }, [agentPrompt, chatHistory, upstreamInput]);

  const showAgentVoiceLine =
    isGenerating &&
    (generationProgress.status === 'connecting' || generationProgress.status === 'generating');
  const showAgentErrorLine =
    generationProgress.status === 'error' && Boolean(generationProgress.message.trim());

  useEffect(() => {
    if (!shouldFollowLatestRef.current) return;
    const el = chatScrollRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      if (shouldFollowLatestRef.current) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [showAgentVoiceLine, showAgentErrorLine]);

  if (!isExpanded) {
    return (
      <div className="mc-node-edit-anchor relative w-[360px] overflow-visible">
        <div className="mc-node-media-frame-anchor mc-node-media-only-anchor relative w-full">
          <Handle type="target" position={Position.Left} className="mc-node-handle mc-node-inner-frame-handle" />
          <CompactNodeFrame
            title={agentName}
            icon={<Bot className="h-3 w-3" />}
            text={previewText}
            badge={isGenerating ? '思考中...' : effectiveProvider === 'gemini' ? 'Gemini' : '方舟'}
            width="w-full"
            frameAspectRatio="16 / 9"
            mediaFrameClassName="[&_p]:!text-base [&_p]:!leading-7"
            accent="violet"
            variant="glass-inner"
            isLoading={isGenerating}
            progress={generationProgress.progress}
            etaKey={`agent:${effectiveProvider}:${volcModelId}`}
            etaSessionKey={`agent:${id}`}
            etaBaselineSeconds={90}
            mediaOnly
          />
          <Handle type="source" position={Position.Right} className="mc-node-handle mc-node-inner-frame-handle" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'mc-agent-chat-node mc-node-expanded mc-node-glass-shell relative flex h-full w-full min-h-0 flex-col rounded-xl border border-white/22',
        selected || isExpanded
          ? 'shadow-[0_0_32px_rgba(255,255,255,0.14),0_22px_50px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.2)]'
          : 'border-slate-300/10 hover:border-slate-300/18'
      )}
    >
      <div className="mc-agent-expand-core flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-300/10 px-3 py-2 mc-node-frost-header">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/22 bg-white/[0.08] shadow-[0_0_12px_rgba(255,255,255,0.12)]">
          <Bot className="h-4 w-4 text-zinc-100 drop-shadow-[0_0_8px_rgba(255,255,255,0.35)]" />
        </div>
        <div
          className="min-w-0 flex-1 truncate px-0 text-base font-medium leading-7 text-white"
          title={agentName}
        >
          {agentName}
        </div>
        {!canUseRealLlm && (
          <span className="shrink-0 rounded border border-white/18 bg-white/[0.08] px-1.5 py-0.5 text-[10px] text-zinc-200">
            模拟
          </span>
        )}
      </div>

      <details className="group shrink-0 border-b border-slate-300/10 bg-black/20">
        <summary className="nodrag nopan flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
          <span>角色与指令（可选）</span>
          {documentNames.length > 0 && (
            <span className="ml-auto text-xs text-zinc-500">{documentNames.length} 个文档引用</span>
          )}
        </summary>
        <div className="border-t border-white/6 px-3 pb-3 pt-1">
          <div className="relative min-w-0">
            <MentionTextarea
              value={agentPrompt}
              onChange={(next) => updateNodeData(id, { agentPrompt: next })}
              materials={connectedMaterials}
              placeholder="描述 Agent 的角色、能力与输出规则；右下角上传会合并到这里…"
              minResizeHeight={96}
              maxHeight={160}
              className="mc-agent-clear-field mc-node-frost-surface !border-white/14 !pb-9 !text-base focus:!border-white/40"
            />
            <input
              ref={roleFileInputRef}
              type="file"
              multiple
              accept={ROLE_UPLOAD_ACCEPT}
              onChange={handleRoleFileUpload}
              className="hidden"
            />
            <Button
              type="button"
              variant="ghost"
              title="上传到角色与指令"
              onClick={handleRoleUploadClick}
              className="nodrag nopan absolute bottom-1 right-1 z-10 h-7 w-7 shrink-0 rounded-md border border-white/12 bg-black/50 p-0 text-zinc-300 hover:bg-white/10"
            >
              <Paperclip className="h-3.5 w-3.5" />
            </Button>
          </div>
          {documentNames.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {documentNames.map((name) => (
                <span
                  key={name}
                  className="mc-node-frost-surface inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-slate-500"
                  title={name}
                >
                  <FileText className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{name}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </details>

      {upstreamInput ? (
        <div className="shrink-0 border-b border-white/6 px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-sm text-zinc-500">画布输入端</span>
            <span className="text-[11px] text-zinc-600">{incomingPromptSources.length} 路</span>
          </div>
          <p className="max-h-16 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-400">
            {upstreamInput}
          </p>
        </div>
      ) : null}

      <div
        ref={chatScrollRef}
        onScroll={handleChatScroll}
        className="nopan nowheel relative z-10 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-3 py-2"
      >
        {displayChatHistory.length === 0 ? (
          <p className="py-6 text-center text-base leading-relaxed text-zinc-500">
            在下方输入消息，Enter 发送，Shift+Enter 换行
          </p>
        ) : (
          <>
            {displayChatHistory.map((msg, idx) => {
              const resolved = msg.role === 'assistant' ? resolveAssistantMessage(msg) : { content: msg.content, thinking: undefined as string | undefined };
              const messageProvider = msg.provider || effectiveProvider;
              const messageModel = msg.model || (messageProvider === 'gemini' ? geminiModelId : volcModelId);
              const useOpenAi55Layout = msg.role === 'assistant'
                && Boolean(resolved.content)
                && isOpenAi55AgentModel(messageProvider, messageModel);
              return (
              <div
                key={`${idx}-${msg.role}-${msg.attachments?.map((a) => a.id).join('-') ?? 'na'}-${msg.content.length}-${msg.content.slice(0, 48)}`}
                className={cn('flex w-full flex-col', msg.role === 'user' ? 'items-end' : 'items-start')}
              >
                {msg.role === 'assistant' && resolved.thinking ? (
                  <AgentThinkingBlock
                    className="max-w-[min(100%,34rem)] [&_button]:!text-xs [&_pre]:!text-sm"
                    thinking={resolved.thinking}
                    expanded={expandedThoughts.has(idx)}
                    onToggleExpand={() => toggleThoughtExpanded(idx)}
                  />
                ) : null}
                {useOpenAi55Layout ? (
                  <AgentOpenAi55Message
                    content={resolved.content}
                    disabled={isGenerating}
                    onChange={(nextContent) => updateAssistantMessageContent(idx, nextContent)}
                  />
                ) : (
                <div
                  className={cn(
                    'nodrag nopan mc-agent-bubble w-fit max-w-[min(100%,34rem)] rounded-xl border px-3.5 py-3 text-base leading-7',
                    msg.role === 'user'
                      ? 'mc-agent-bubble--user border-cyan-500/25 bg-cyan-500/10 text-zinc-100'
                      : 'mc-agent-bubble--assistant border-white/12 bg-white/[0.06] text-zinc-200'
                  )}
                >
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">
                    {msg.role === 'user' ? '你' : agentName}
                  </div>
                  {msg.role === 'user' && msg.attachments && msg.attachments.length > 0 ? (
                    <div className="mb-1.5 flex flex-wrap items-center gap-1">
                      {msg.attachments.map((att) =>
                        att.kind === 'image' ? (
                          <span
                            key={att.id}
                            className="relative inline-block h-14 w-14 shrink-0 overflow-hidden rounded-md border border-white/20 bg-black/40"
                            title={att.name}
                          >
                            <img src={att.url} alt={att.name} className="h-full w-full object-cover" />
                          </span>
                        ) : att.kind === 'audio' ? (
                          <span
                            key={att.id}
                            title={att.name}
                            className="inline-flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-white/20 bg-black/40 px-1 text-center"
                          >
                            <AudioLines className="h-5 w-5 text-cyan-300/90" />
                            <span className="line-clamp-2 w-full break-all text-[10px] leading-tight text-zinc-400">
                              {att.name}
                            </span>
                          </span>
                        ) : att.kind === 'video' ? (
                          <span
                            key={att.id}
                            className="relative inline-block h-14 w-14 shrink-0 overflow-hidden rounded-md border border-white/20 bg-black/40"
                            title={att.name}
                          >
                            <video
                              src={att.url}
                              muted
                              playsInline
                              preload="metadata"
                              className="h-full w-full object-cover"
                            />
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
                              <Video className="h-5 w-5 text-white/90" />
                            </span>
                          </span>
                        ) : (
                          <span
                            key={att.id}
                            title={att.name}
                            className="inline-flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-white/20 bg-black/40 px-1 text-center"
                          >
                            <FileText className="h-4 w-4 text-zinc-400" />
                            <span className="line-clamp-2 w-full break-all text-[10px] leading-tight text-zinc-500">
                              {att.name}
                            </span>
                          </span>
                        )
                      )}
                    </div>
                  ) : null}
                  {resolved.content ? (
                    <div className="select-text cursor-text whitespace-pre-wrap break-words">{resolved.content}</div>
                  ) : msg.role === 'assistant' && isGenerating && idx === displayChatHistory.length - 1 ? (
                    <div className="min-w-[4.5rem] whitespace-nowrap text-zinc-400">思考中…</div>
                  ) : null}
                </div>
                )}
              </div>
            );
            })}
            {false && isGenerating && canUseRealLlm && streamThinkingDraft ? (
              <div className="flex w-full flex-col items-start">
                <AgentThinkingBlock
                  className="max-w-[min(100%,34rem)] [&_button]:!text-xs [&_pre]:!text-sm"
                  thinking={streamThinkingDraft}
                  expanded={expandedThoughts.has(STREAMING_THOUGHT_KEY)}
                  onToggleExpand={() => toggleThoughtExpanded(STREAMING_THOUGHT_KEY)}
                />
              </div>
            ) : null}
            {false && isGenerating && canUseRealLlm ? (
              streamDraft ? (
                <div className="flex w-full justify-start">
                  <div className="nodrag nopan mc-agent-bubble mc-agent-bubble--assistant w-fit max-w-[min(100%,34rem)] rounded-xl border border-white/12 bg-white/[0.06] px-3.5 py-3 text-base leading-7 text-zinc-200">
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">{agentName}</div>
                    <div className="select-text cursor-text whitespace-pre-wrap break-words">{streamDraft}</div>
                  </div>
                </div>
              ) : null
            ) : null}
            <div className={cn('shrink-0', showAgentVoiceLine ? 'h-3' : 'h-1')} aria-hidden />
          </>
        )}
      </div>

      {(showAgentVoiceLine || showAgentErrorLine) && (
        <div
          className="relative z-0 shrink-0 overflow-hidden border-t border-white/8 px-2 py-1"
          aria-live={showAgentErrorLine ? 'polite' : undefined}
        >
          {showAgentErrorLine ? (
            <p className="text-center text-sm leading-snug text-red-300/95">
              {generationProgress.message}
            </p>
          ) : (
            <>
              <VoiceAssistantWaveStrip active={showAgentVoiceLine} className="min-h-5 overflow-hidden" />
              <GenerationEta
                active={showAgentVoiceLine}
                progress={generationProgress.progress}
                estimateKey={`agent:${effectiveProvider}:${volcModelId}`}
                sessionKey={`agent:${id}`}
                defaultTotalSeconds={90}
                className="block text-center"
              />
            </>
          )}
        </div>
      )}

      {showScrollToLatest ? (
        <div className="relative z-30 h-0 shrink-0">
          <Button
            type="button"
            variant="ghost"
            title="回到最新消息"
            aria-label="回到最新消息"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={scrollChatToLatest}
            className="nodrag nopan absolute bottom-2 right-3 h-8 w-8 rounded-full border border-white/14 bg-[#2a2a2a] p-0 text-zinc-200 shadow-[0_4px_16px_rgba(0,0,0,0.32)] hover:bg-[#343434] hover:text-white"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      <div className="shrink-0 border-t border-slate-300/10 px-3 pb-2 pt-1.5">
        <div className="relative min-h-[118px] overflow-hidden rounded-[18px] border border-white/16 bg-[#242424] focus-within:border-white/28">
          <div
            ref={chatEditorRef}
            role="textbox"
            aria-multiline="true"
            data-placeholder="输入消息…"
            data-empty="1"
            contentEditable
            suppressContentEditableWarning
            onInput={composerSync}
            onKeyDown={onComposerKeyDown}
            onCompositionStart={() => {
              chatEditorComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              chatEditorComposingRef.current = false;
              composerSync();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            spellCheck={false}
            style={{
              height: COMPOSER_EDITOR_PX,
              minHeight: COMPOSER_EDITOR_PX,
              maxHeight: COMPOSER_EDITOR_PX,
            }}
            className="mc-agent-chat-editor nodrag nopan nowheel relative w-full min-h-0 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-3 pb-1 pt-2.5 text-left text-base leading-6 text-zinc-100 outline-none"
          />
          <input
            ref={chatFileInputRef}
            type="file"
            multiple
            accept={CHAT_UPLOAD_ACCEPT}
            onChange={handleChatFileUpload}
            className="hidden"
            aria-label="上传图片、视频、音频或文档"
          />
          <div className="absolute inset-x-2 bottom-2 flex h-8 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              title="添加附件到本条消息"
              aria-label="添加附件到本条消息"
              onClick={handleChatUploadClick}
              className="nodrag nopan shrink-0 rounded-md border-0 bg-transparent p-0 text-zinc-300 shadow-none hover:bg-white/[0.07]"
              style={{ width: COMPOSER_BTN_PX, height: COMPOSER_BTN_PX, minWidth: COMPOSER_BTN_PX }}
            >
              <Paperclip className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              title={isGenerating ? '取消任务' : '发送'}
              aria-label={isGenerating ? '取消任务' : '发送'}
              onClick={() => {
                if (isGenerating) {
                  cancelGeneration();
                  return;
                }
                void handleSend();
              }}
              disabled={!isGenerating && !canSendComposer}
              className="nodrag nopan ml-auto shrink-0 rounded-xl border-0 bg-zinc-100 p-0 text-zinc-900 shadow-[0_4px_16px_rgba(255,255,255,0.1)] hover:bg-white disabled:opacity-40"
              style={{ width: COMPOSER_BTN_PX, height: COMPOSER_BTN_PX, minWidth: COMPOSER_BTN_PX }}
            >
              {isGenerating ? (
                <span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-current" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-300/10 bg-black/24 px-2.5 py-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <label className="mb-1 block truncate text-xs text-zinc-500">文本 LLM 路由</label>
            <Select
              value={llmRouteSelectValue}
              onValueChange={(v) => {
                if (!v) return;
                if (v === 'inherit') {
                  const inheritProvider = resolveLlmTextProvider(undefined, config.defaultLlmSource);
                  updateNodeData(id, {
                    llmSource: undefined,
                    model: resolveLlmModelForProvider(
                      config,
                      inheritProvider,
                      config.defaultLlmModel,
                      DEFAULT_TEXT_MODEL
                    ),
                  });
                  return;
                }
                if (v === 'gemini') {
                  updateNodeData(id, { llmSource: 'gemini', geminiModel: geminiModelId });
                  return;
                }
                const routeId = v;
                const provider = getLlmProviderRecord(config, routeId);
                const defaultModel = resolveLlmModelForProvider(
                  config,
                  routeId,
                  provider?.models[0],
                  DEFAULT_TEXT_MODEL
                );
                updateNodeData(id, { llmSource: routeId, model: defaultModel });
              }}
              className="mc-agent-clear-select mc-node-frost-surface h-8 w-full !min-h-0 !py-1 text-sm"
            >
              <SelectItem value="inherit">
                跟随默认（{(() => { const allP = { ...config.llm.providers, ...config.llm.customProviders }; const p = allP[config.defaultLlmSource]; return p ? `${p.label} · ${config.defaultLlmModel || p.models[0]}` : config.defaultLlmSource; })()}）
              </SelectItem>
              <SelectItem value="gemini">Kie Gemini（多模态）</SelectItem>
              {llmProviderRoutes
                .filter((r) => r.value !== 'gemini')
                .map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
            </Select>
          </div>
          {effectiveProvider === 'gemini' ? (
            <div className="min-w-0">
              <label className="mb-1 block truncate text-xs text-zinc-500">Kie Gemini（多模态）模型</label>
              <GeminiModelSelect
                modelIds={geminiModelOptions}
                value={geminiModelId}
                onValueChange={(next) => updateNodeData(id, { geminiModel: next })}
                className="mc-agent-clear-select mc-node-frost-surface h-8 w-full !min-h-0 !py-1 text-sm"
              />
            </div>
          ) : (
            <div className="min-w-0">
              <label className="mb-1 block truncate text-xs text-zinc-500">
                {routeProviderLabel} 模型
              </label>
              {routeModelOptions.length > 0 ? (
                <Select
                  value={volcModelId}
                  onValueChange={(v) => {
                    if (!v) return;
                    updateNodeData(id, { model: v });
                  }}
                  className="mc-agent-clear-select mc-node-frost-surface h-8 w-full !min-h-0 !py-1 text-sm"
                >
                  {routeModelOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </Select>
              ) : (
                <Input
                  value={volcModelId}
                  onChange={(e) => updateNodeData(id, { model: e.target.value })}
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder={DEFAULT_TEXT_MODEL}
                  className="mc-agent-clear-select nodrag nopan nowheel mc-node-frost-surface h-8 w-full border text-sm"
                />
              )}
            </div>
          )}
        </div>
        {isKieAgentProvider ? (
          <KieUsageInfo usage={kieAgentUsage} className="mt-2" />
        ) : null}
      </div>
      </div>

      <div className="pointer-events-none absolute inset-0 z-[35]">
        <Handle
          type="target"
          position={Position.Left}
          className="nodrag nopan mc-node-handle pointer-events-auto"
        />
        <Handle type="source" position={Position.Right} className="nodrag nopan mc-node-handle pointer-events-auto" />
      </div>
    </div>
  );
}

export default memo(AgentNode, agentNodePropsEqual);
