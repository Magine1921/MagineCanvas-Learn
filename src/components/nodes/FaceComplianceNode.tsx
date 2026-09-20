'use client';

import { memo, useCallback, useMemo, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { EyeOff, Loader2, ShieldCheck, Image as ImageIcon } from 'lucide-react';
import { CanvasNodeData, useCanvasStore } from '../canvas/CanvasStore';
import { CompactNodeFrame } from '../canvas/CompactNodeFrame';
import { GenerationEta } from '../canvas/GenerationEta';
import { useIncomingMaterialRefs } from '../canvas/useCanvasDerivedData';
import {
  resolveInputImageUrl,
  applyFaceCompliance,
  type ComplianceResult,
} from '@/lib/face-compliance';
import { persistImageToMaterialCache } from '@/lib/persist-generated-media';
import { cn } from '@/lib/utils';
import { useAgentGenerationBridge } from '@/lib/useAgentGenerationBridge';

interface ProcessedEntry {
  inputUrl: string;
  outputUrl: string;
  faceCount: number;
  eyesCount: number;
  mouthCount: number;
}

function readProcessedResults(nodeData: Record<string, unknown>): ProcessedEntry[] {
  const raw = nodeData.processedResults;
  if (Array.isArray(raw)) return raw as ProcessedEntry[];
  // backward compat: migrate single result
  const outputUrl = typeof nodeData.outputImageUrl === 'string' ? nodeData.outputImageUrl : '';
  if (outputUrl) {
    return [{
      inputUrl: (typeof nodeData.inputImageUrl === 'string' ? nodeData.inputImageUrl : '') || outputUrl,
      outputUrl,
      faceCount: typeof nodeData.faceCount === 'number' ? nodeData.faceCount : 0,
      eyesCount: typeof nodeData.eyesCount === 'number' ? nodeData.eyesCount : 0,
      mouthCount: typeof nodeData.mouthCount === 'number' ? nodeData.mouthCount : 0,
    }];
  }
  return [];
}

function FaceComplianceNode({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const nodeData = data as Record<string, unknown>;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const isExpanded = useCanvasStore((s) => s.selectedNode?.id === id);
  const materials = useIncomingMaterialRefs(id);

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(-1);

  const processedResults = readProcessedResults(nodeData);
  const hasResults = processedResults.length > 0;
  const totalFaces = processedResults.reduce((s, r) => s + r.faceCount, 0);

  // collect all input URLs
  const inputUrls = useMemo(() => {
    const urls: string[] = [];
    for (const m of materials) {
      if (m.fileUrl) urls.push(m.fileUrl);
    }
    const fallback = resolveInputImageUrl(nodeData);
    if (fallback && !urls.includes(fallback)) urls.push(fallback);
    return urls;
  }, [materials, nodeData]);

  const canProcess = inputUrls.length > 0 && !processing;

  const handleProcess = useCallback(async () => {
    if (inputUrls.length === 0) return;
    setProcessing(true);
    setError('');
    const entries: ProcessedEntry[] = [];
    try {
      for (let i = 0; i < inputUrls.length; i++) {
        setCurrentIndex(i);
        const result: ComplianceResult = await applyFaceCompliance(inputUrls[i]);
        entries.push({
          inputUrl: inputUrls[i],
          outputUrl: result.dataUrl,
          faceCount: result.faceCount,
          eyesCount: result.eyesCount,
          mouthCount: result.mouthCount,
        });
      }
      // also derive legacy flat fields from first entry
      const first = entries[0];
      updateNodeData(id, {
        processedResults: entries,
        inputImageUrl: first.inputUrl,
        outputImageUrl: first.outputUrl,
        faceCount: first.faceCount,
        eyesCount: first.eyesCount,
        mouthCount: first.mouthCount,
        status: entries.some((e) => e.faceCount > 0) ? 'success' : 'noFace',
      });
      void Promise.all(
        entries.map((e, i) => {
          const key = i === 0 ? id : `${id}-fc-${i}`;
          return persistImageToMaterialCache(key, e.outputUrl);
        })
      ).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : '处理失败');
    } finally {
      setProcessing(false);
      setCurrentIndex(-1);
    }
  }, [id, inputUrls, updateNodeData]);

  useAgentGenerationBridge(
    id,
    async () => {
      if (inputUrls.length === 0) throw new Error('No input image is connected to the face compliance node.');
      await handleProcess();
    },
    {
      status: processing ? 'processing' : error ? 'error' : hasResults ? 'success' : 'idle',
      message: error || (processing ? 'Processing face compliance' : hasResults ? 'Face compliance completed' : ''),
    },
  );

  const compactPreview = hasResults ? processedResults[0].inputUrl : inputUrls[0] || '';

  // ---- 紧凑态 ----
  if (!isExpanded) {
    return (
      <div className="relative mc-node-glass-shell mc-node-compact overflow-visible rounded-lg">
        <Handle type="target" position={Position.Left} className="mc-node-handle" />
        <CompactNodeFrame
          title="人脸合规"
          icon={<ShieldCheck className="h-3 w-3" />}
          mediaUrl={compactPreview}
          mediaType="image"
          text={
            hasResults
              ? '已处理'
              : inputUrls.length > 0
                ? `待处理 · ${inputUrls.length} 张`
                : '请接入图片'
          }
          badge={hasResults ? `InsightFace · ${totalFaces}脸` : undefined}
          width="w-[260px]"
          accent="cyan"
          variant="glass-inner"
          isLoading={processing}
          progress={inputUrls.length > 0 && currentIndex >= 0 ? ((currentIndex + 0.5) / inputUrls.length) * 100 : 0}
          etaKey="face-compliance:local"
          etaSessionKey={`face-compliance:${id}`}
          etaBaselineSeconds={Math.max(8, inputUrls.length * 4)}
        />
        <Handle type="source" position={Position.Right} className="mc-node-handle" />
      </div>
    );
  }

  // ---- 展开态 ----
  return (
    <div
      className={cn(
        'mc-node-glass-shell mc-node-expanded w-[260px] rounded-xl border border-white/22 transition-colors mc-dur-12f',
        selected
          ? 'shadow-[0_0_32px_rgba(255,255,255,0.14),0_22px_50px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.2)]'
          : 'border-slate-300/10 hover:border-slate-300/18',
      )}
    >
      <Handle type="target" position={Position.Left} className="mc-node-handle" />

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-300/10 px-3 py-2.5 mc-node-frost-header">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/22 bg-white/[0.08] shadow-[0_0_12px_rgba(255,255,255,0.12)]">
          <ShieldCheck className="h-4 w-4 text-zinc-100" />
        </div>
        <span className="text-xs font-medium text-white">人脸合规</span>
        {hasResults && (
          <span className="ml-auto rounded-md border border-emerald-400/35 bg-emerald-500/15 px-1.5 py-0.5 text-[8px] text-emerald-100">
            {totalFaces} 脸
          </span>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* 输入概览 */}
        {inputUrls.length > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <ImageIcon className="h-3 w-3 shrink-0" />
            接入 {inputUrls.length} 张图片{processing && ` · 进度 ${currentIndex + 1}/${inputUrls.length}`}
          </div>
        )}

        {/* 处理按钮 */}
        <button
          onClick={handleProcess}
          disabled={!canProcess}
          className={cn(
            'flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/10 text-xs text-zinc-100 transition-all hover:bg-white/16',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {processing ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              检测中 ({currentIndex + 1}/{inputUrls.length})...
            </>
          ) : (
            <>
              <EyeOff className="w-3 h-3" />
              {hasResults ? '重新处理全部' : '开始处理'}
            </>
          )}
        </button>

        <GenerationEta
          active={processing}
          progress={inputUrls.length > 0 && currentIndex >= 0 ? ((currentIndex + 0.5) / inputUrls.length) * 100 : 0}
          estimateKey="face-compliance:local"
          sessionKey={`face-compliance:${id}`}
          defaultTotalSeconds={Math.max(8, inputUrls.length * 4)}
          className="block text-center"
        />

        {/* 错误 */}
        {error && (
          <div className="break-words rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-300">
            {error}
          </div>
        )}

        {/* 无输入提示 */}
        {inputUrls.length === 0 && !error && (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-white/10 bg-white/[0.02] px-3 py-3 text-[10px] text-zinc-500">
            <ImageIcon className="h-3.5 w-3.5 shrink-0" />
            从上游图像/素材节点连线接入图片，或在上方粘贴图片 URL
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="mc-node-handle" />
    </div>
  );
}

export default memo(FaceComplianceNode);
