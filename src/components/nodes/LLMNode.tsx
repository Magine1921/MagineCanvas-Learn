'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { memo, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CanvasNodeData, useCanvasStore } from '../canvas/CanvasStore';
import { isRemovedProvider, useSeedanceStore, type ProviderConfig } from '../seedance/SeedanceStore';
import { streamLlmText } from '@/lib/invoke-llm-text';
import {
  resolveGeminiModelId,
  resolveLlmModelForProvider,
  resolveLlmTextProvider,
} from '@/lib/llm-text-provider';
import { mergeGeminiModelLists } from '@/lib/gemini-models-list';
import { Select, SelectItem } from '@/components/ui/select';
import { GeminiModelSelect } from '@/components/ui/GeminiModelSelect';
import { MaterialPreviewStrip } from '../canvas/MaterialPreviewStrip';
import { MentionTextarea, type MentionTextareaSize } from '../canvas/MentionTextarea';
import { useCanvasEdges, useMaterialRefs } from '../canvas/useCanvasDerivedData';
import { CompactNodeFrame } from '../canvas/CompactNodeFrame';
import { GenerationEta } from '../canvas/GenerationEta';
import { getMaterialsForGeneratorPreviewFromRefs } from '@/lib/material-mentions';
import { estimateLlmTokens } from '@/lib/ark-token-estimate';
import {
  buildKieUsageDisplay,
  fetchKieCredits,
  getKieProviderTokenBucket,
  isKieProvider,
  KIE_GLOBAL_PROVIDER_TOKEN_KEY,
} from '@/lib/kie-usage-display';
import { createStreamUiScheduler } from '@/lib/stream-ui-scheduler';
import { FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GenerationProgress {
  status: 'idle' | 'connecting' | 'generating' | 'success' | 'error';
  progress: number; // 0-100
  message: string;
}

const DEFAULT_TEXT_MODEL = 'gpt-5-5';

interface LLMNodeData extends CanvasNodeData {
  isLoading?: boolean;
  generationProgress?: GenerationProgress;
}

function LLMNode({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const nodeData = data as LLMNodeData;
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);

  const isLoading = nodeData.isLoading === true;
  const generationProgress: GenerationProgress =
    typeof nodeData.generationProgress === 'object' && nodeData.generationProgress
      ? nodeData.generationProgress as GenerationProgress
      : { status: 'idle' as const, progress: 0, message: '等待生成...' };

  const setIsLoading = (v: boolean) => updateNodeData(id, { isLoading: v } as Partial<LLMNodeData>);
  const setGenerationProgress = (v: GenerationProgress) => updateNodeData(id, { generationProgress: v } as Partial<LLMNodeData>);
  const [streamOutput, setStreamOutput] = useState('');
  const streamOutputRef = useRef('');
  const streamUiSchedulerRef = useRef(createStreamUiScheduler(() => {
    setStreamOutput(streamOutputRef.current);
  }));
  const isExpanded = useCanvasStore((state) => state.selectedNode?.id === id);
  const edges = useCanvasEdges();
  const materials = useMaterialRefs();
  const { config, tokenConfig, addUsedTokens, addProviderTokens, setProviderRemainingTokens } = useSeedanceStore();
  const explicitSource: string | undefined =
    typeof data.llmSource === 'string' && data.llmSource.trim() ? data.llmSource : undefined;
  const llmRouteSelectValue = explicitSource && !isRemovedProvider('llm', explicitSource)
    ? explicitSource
    : 'inherit';
  const savedTextModel =
    (typeof data.llmModel === 'string' && data.llmModel.trim())
    || (typeof data.llmVolcModel === 'string' && data.llmVolcModel.trim())
    || DEFAULT_TEXT_MODEL;
  const effectiveProvider = resolveLlmTextProvider(explicitSource, config.defaultLlmSource);
  const textModel = resolveLlmModelForProvider(
    config,
    effectiveProvider,
    savedTextModel,
    DEFAULT_TEXT_MODEL,
  );
  const geminiModelId = resolveGeminiModelId(
    typeof data.geminiModel === 'string' ? data.geminiModel : undefined,
    config.multimodalApi.model
  );
  const hasConfiguredKey = (() => {
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
  const tokenBucket = effectiveProvider === 'gemini' ? tokenConfig.multimodal : tokenConfig.llm;
  const geminiModelOptions = useMemo(() => {
    const provider = config.llm.providers.gemini ?? config.llm.customProviders.gemini;
    return provider?.models?.length ? provider.models : mergeGeminiModelLists([]);
  }, [config.llm]);

  // Build model options from all configured LLM providers.
  const llmStoreModelOptions = useMemo(() => {
    const all = { ...config.llm.providers, ...config.llm.customProviders };
    const seen = new Set<string>();
    const options: { value: string; label: string }[] = [];
    for (const [providerId, provider] of Object.entries(all)) {
      if (isRemovedProvider('llm', providerId)) continue;
      if (!provider.enabled || !provider.apiKey.trim()) continue;
      for (const model of provider.models) {
        if (seen.has(model)) continue;
        seen.add(model);
        options.push({ value: model, label: model });
      }
    }
    return options;
  }, [config.llm]);

  // Build provider route options from configured LLM providers
  const llmProviderRoutes = useMemo(() => {
    const all = { ...config.llm.providers, ...config.llm.customProviders };
    return Object.entries(all)
      .filter(([id, p]) => !isRemovedProvider('llm', id) && p.enabled && p.apiKey.trim())
      .map(([id, p]) => ({ value: id, label: p.label }));
  }, [config.llm]);

  const llmTokenConfig = tokenBucket;

  const effectivePrompt = (data.prompt as string) ?? '';
  const promptBoxSize = data.promptBoxSize as MentionTextareaSize | undefined;

  const previewMaterials = useMemo(
    () => getMaterialsForGeneratorPreviewFromRefs(id, effectivePrompt, materials, edges),
    [id, effectivePrompt, materials, edges]
  );

  const llmEstimate = 2048;
  const currentLlmProvider = useMemo(() => {
    const all = { ...config.llm.providers, ...config.llm.customProviders };
    return all[effectiveProvider] || null;
  }, [config.llm, effectiveProvider]);
  const currentLlmModel = effectiveProvider === 'gemini' ? geminiModelId : textModel;
  const isKieLlmProvider = isKieProvider(currentLlmProvider, effectiveProvider);
  const kieLlmUsage = useMemo(
    () =>
      buildKieUsageDisplay({
        kind: 'llm',
        providerId: effectiveProvider,
        provider: currentLlmProvider,
        bucket: getKieProviderTokenBucket(config.providerTokens, `llm.${effectiveProvider}`),
        usageBucket: config.providerTokens[`llm.${effectiveProvider}`],
        model: currentLlmModel,
        tokenEstimate: llmEstimate,
      }),
    [config.providerTokens, currentLlmModel, currentLlmProvider, effectiveProvider, llmEstimate]
  );
  const syncKieCredits = () => {
    if (!isKieLlmProvider) return;
    void fetchKieCredits(currentLlmProvider)
      .then((credits) => {
        if (credits != null) setProviderRemainingTokens(KIE_GLOBAL_PROVIDER_TOKEN_KEY, credits);
      })
      .catch(() => undefined);
  };
  const remainingDisplay =
    llmTokenConfig.arkRemainingTokens == null
      ? effectiveProvider === 'gemini'
        ? '请在 API 配置「多模态」中填写剩余 token（可选）'
        : '请在侧栏设置中填写 LLM API 剩余 token'
      : `${Math.max(0, llmTokenConfig.arkRemainingTokens - llmTokenConfig.usedTokens).toLocaleString()} token`;

  // Real LLM API call with streaming
  const handleGenerate = async () => {
    if (!hasConfiguredKey) {
      setGenerationProgress({
        status: 'error',
        progress: 0,
        message:
          effectiveProvider === 'gemini'
            ? '请先配置 Gemini API Key（API 配置 → 多模态）'
            : '请先配置 LLM API Key',
      });
      return;
    }

    setIsLoading(true);
    streamOutputRef.current = '';
    setStreamOutput('');
    streamUiSchedulerRef.current.cancel();
    setGenerationProgress({
      status: 'connecting',
      progress: 10,
      message: '连接 API 中...',
    });

    try {
      const prompt = effectivePrompt || '请生成一个视频分镜脚本';

      setGenerationProgress({
        status: 'generating',
        progress: 30,
        message: '正在生成脚本...',
      });

      let fullScript = '';

      for await (const chunk of streamLlmText({
        config,
        volcModel: textModel,
        provider: effectiveProvider,
        geminiModelId,
        prompt,
        systemPrompt:
          '你是一个专业的视频分镜脚本生成器。请生成详细的分镜脚本，包含场景描述、镜头运动、灯光、时长等信息。',
        temperature: 0.7,
        maxTokens: 2048,
      })) {
        fullScript += chunk;
        streamOutputRef.current = fullScript;
        streamUiSchedulerRef.current.flushNow();

        const estimatedProgress = Math.min(30 + (fullScript.length / 2000) * 60, 90);
        setGenerationProgress({
          status: 'generating',
          progress: estimatedProgress,
          message: `生成中... (${fullScript.length} 字符)`,
        });
      }

      streamUiSchedulerRef.current.flushNow();

      const billed = estimateLlmTokens(prompt, fullScript, llmEstimate);
      addUsedTokens(effectiveProvider === 'gemini' ? 'multimodal' : 'llm', billed);
      addProviderTokens(`llm.${effectiveProvider}`, billed);
      syncKieCredits();

      setGenerationProgress({
        status: 'success',
        progress: 100,
        message: `生成完成 · 本地估算 ${billed.toLocaleString()} token`
      });

      updateNodeData(id, { output: fullScript });
      setStreamOutput('');
      streamOutputRef.current = '';
      
      // Reset progress after 2 seconds
      setTimeout(() => {
        setGenerationProgress({
          status: 'idle',
          progress: 0,
          message: '等待生成...'
        });
      }, 2000);

    } catch (error) {
      console.error('LLM generation failed:', error);
      setGenerationProgress({
        status: 'error',
        progress: 0,
        message: `生成失败: ${error instanceof Error ? error.message : '未知错误'}`
      });
    } finally {
      streamUiSchedulerRef.current.cancel();
      setIsLoading(false);
    }
  };

  // Fallback mock generation if API key not configured
  const handleMockGenerate = async () => {
    setIsLoading(true);
    setGenerationProgress({
      status: 'generating',
      progress: 50,
      message: '模拟生成中...'
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const mockScript = `[Scene 1] ${effectivePrompt || 'A cinematic shot of...'}
- Camera: Medium shot, slight dolly in
- Lighting: Golden hour, warm tones
- Duration: 3-5 seconds

[Scene 2] Detail focus
- Camera: Close-up with subtle push in
- Lighting: Soft fill light
- Duration: 2-3 seconds`;

    updateNodeData(id, { output: mockScript });
    
    setGenerationProgress({
      status: 'success',
      progress: 100,
      message: '模拟生成完成'
    });
    
    setTimeout(() => {
      setGenerationProgress({
        status: 'idle',
        progress: 0,
        message: '等待生成...'
      });
    }, 2000);
    
    setIsLoading(false);
  };

  const finalGenerate = hasConfiguredKey ? handleGenerate : handleMockGenerate;
  const persistedOutput = (data.output as string) || '';
  const displayOutput = streamOutput || persistedOutput;
  const compactText = (displayOutput || effectivePrompt || '').trim();

  const isGenerating = generationProgress.status !== 'idle' && generationProgress.status !== 'error' && generationProgress.status !== 'success';

  if (!isExpanded) {
    return (
      <div className="relative mc-node-compact overflow-hidden rounded-lg">
        <Handle type="target" position={Position.Left} className="mc-node-handle" />
        <CompactNodeFrame
          title={(data.label as string) || '大模型'}
          icon={<FileText className="h-3 w-3" />}
          text={compactText}
          badge={isGenerating ? '生成中...' : persistedOutput ? '输出' : undefined}
          width="w-[280px]"
          accent="cyan"
          isLoading={isGenerating}
          progress={generationProgress.progress}
          etaKey={`llm:${effectiveProvider}:${currentLlmModel}`}
          etaSessionKey={`llm:${id}`}
          etaBaselineSeconds={45}
        />
        <Handle type="source" position={Position.Right} id="output" className="mc-node-handle" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'mc-node-glass-shell mc-node-expanded relative min-w-[280px] rounded-xl transition-colors mc-dur-12f',
        selected || isExpanded
          ? 'bg-white/[0.08] shadow-[0_0_32px_rgba(255,255,255,0.14),0_22px_50px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.2)]'
          : 'border-zinc-700/50 bg-zinc-900/60 shadow-black/20'
      )}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="mc-node-handle"
      />

      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-700/50">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-zinc-100 shadow-[0_0_10px_rgba(255,255,255,0.45)]" />
          <span className="text-xs font-medium text-zinc-300 uppercase tracking-wider">
            {data.label}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 space-y-3">
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">文本 LLM 路由</label>
            <Select
              value={llmRouteSelectValue}
              onValueChange={(v) => {
                if (!v) return;
                if (v === 'inherit') {
                  updateNodeData(id, { llmSource: undefined });
                  return;
                }
                if (v === 'gemini') {
                  updateNodeData(id, {
                    llmSource: 'gemini',
                    geminiModel: geminiModelId,
                  });
                  return;
                }
                // Dynamic provider — use its first model as default.
                const provider = config.llm.providers[v] || config.llm.customProviders[v];
                const defaultModel = provider?.models[0] || DEFAULT_TEXT_MODEL;
                updateNodeData(id, {
                  llmSource: v,
                  llmModel: defaultModel,
                });
              }}
              className="h-8 !min-h-0 !py-1 text-xs"
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
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Kie Gemini（多模态）模型</label>
              <GeminiModelSelect
                modelIds={geminiModelOptions}
                value={geminiModelId}
                onValueChange={(next) => updateNodeData(id, { geminiModel: next })}
                className="h-8 !min-h-0 !py-1 text-xs"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs text-zinc-500">LLM 模型</label>
              {llmStoreModelOptions.length > 0 ? (
                <Select
                  value={textModel}
                  onValueChange={(v) => {
                    if (!v) return;
                    updateNodeData(id, { llmModel: v });
                  }}
                  className="h-8 !min-h-0 !py-1 text-xs"
                >
                  {llmStoreModelOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </Select>
              ) : (
                <input
                  value={textModel}
                  onChange={(e) => updateNodeData(id, { llmModel: e.target.value })}
                  className="w-full rounded-md border border-zinc-600/50 bg-zinc-900/60 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              )}
            </div>
          )}
        </div>

        <MaterialPreviewStrip materials={previewMaterials} />

        <div>
          <label className="text-xs text-zinc-500 mb-1 block">提示词（@ 引用素材说明）</label>
          <MentionTextarea
            value={effectivePrompt}
            onChange={(next) => updateNodeData(id, { prompt: next })}
            materials={materials}
            placeholder="输入要处理的文本，@ 插入素材引用..."
            minHeight="min-h-[72px]"
            minResizeWidth={220}
            minResizeHeight={64}
            size={promptBoxSize}
            onSizeChange={(next) => updateNodeData(id, { promptBoxSize: next })}
          />
        </div>

        {hasConfiguredKey && (
          <div className="flex flex-col gap-0.5 rounded-md border border-[#ffffff08] bg-zinc-900/40 px-2 py-1.5 text-[10px] text-zinc-400">
            {isKieLlmProvider ? (
              <>
                <span>{kieLlmUsage.currentText}</span>
                <span>{kieLlmUsage.estimateText}</span>
                <span>{kieLlmUsage.balanceText} · {kieLlmUsage.usedText}</span>
              </>
            ) : (
              <>
                <span>预估约 {llmEstimate.toLocaleString()} token（流式接口以控制台为准）</span>
                <span>
                  LLM API 已记录消耗:{' '}
                  {llmTokenConfig.usedTokens.toLocaleString()} token
                </span>
                <span>剩余: {remainingDisplay}</span>
              </>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Progress
            value={generationProgress.progress}
            variant={generationProgress.status === 'error' ? 'error' : 
                    generationProgress.status === 'success' ? 'success' : 'cyan'}
            size="sm"
            showValue={true}
          />
          <div className="text-xs text-zinc-400 h-4 flex items-center">
            {generationProgress.message}
            {!hasConfiguredKey && (
              <span className="text-zinc-400 ml-1">(使用模拟 API)</span>
            )}
          </div>
          <GenerationEta
            active={isGenerating}
            progress={generationProgress.progress}
            estimateKey={`llm:${effectiveProvider}:${currentLlmModel}`}
            sessionKey={`llm:${id}`}
            defaultTotalSeconds={45}
            className="block text-right"
          />
        </div>

        <Button
          onClick={finalGenerate}
          disabled={isLoading}
          size="sm"
          className="w-full border border-white/22 bg-gradient-to-b from-white/[0.14] to-white/[0.06] text-zinc-100 text-xs h-7 shadow-[0_0_20px_rgba(255,255,255,0.12)] hover:from-white/20 hover:to-white/10"
        >
          {isLoading ? '生成中...' : '生成脚本'}
        </Button>

        {(displayOutput || isGenerating) && (
          <div className="p-2 rounded-md bg-zinc-800/50 border border-zinc-700/30">
            <label className="text-xs text-zinc-500 mb-1 block">输出脚本</label>
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono">
              {displayOutput || (isGenerating ? '…' : '')}
            </pre>
          </div>
        )}
      </div>

      {/* Output Handle */}
      <Handle type="source" position={Position.Right} id="output" className="mc-node-handle" />
    </div>
  );
}
