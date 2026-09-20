'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { memo, useEffect, useRef } from 'react';
import { CanvasNodeData, useCanvasStore } from '../canvas/CanvasStore';
import { MentionTextarea, type MentionTextareaSize } from '../canvas/MentionTextarea';
import { useIncomingMaterialRefs } from '../canvas/useCanvasDerivedData';
import { CompactNodeFrame } from '../canvas/CompactNodeFrame';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  composePrompt,
  getConnectedPromptTargetField,
  getIncomingPromptSources,
  mergeConnectedPromptText,
} from '@/lib/prompt-flow';

function removePreviouslySyncedText(value: string, previous: string): string {
  if (!previous) return value;
  const index = value.indexOf(previous);
  if (index < 0) return value;
  return `${value.slice(0, index)}\n${value.slice(index + previous.length)}`.trim();
}

function PromptNode({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const isExpanded = useCanvasStore((state) => state.selectedNode?.id === id);
  const previousTargetIdsRef = useRef<string[]>([]);
  const outgoingConnectionSignature = useCanvasStore((state) => state.edges
    .map((edge, index) => edge.source === id
      ? `${index}:${edge.id}:${edge.target}:${edge.sourceHandle ?? ''}`
      : '')
    .filter(Boolean)
    .join('|'));
  const materials = useIncomingMaterialRefs(id);
  const promptBoxSize = data.promptBoxSize as MentionTextareaSize | undefined;
  const title = (data.label as string) === '提示词' ? '文本' : ((data.label as string) || '文本');

  // Merge all incoming text once per target in connection order.
  useEffect(() => {
    const state = useCanvasStore.getState();
    const currentTargetIds = state.edges
      .filter((edge) => edge.source === id)
      .map((edge) => edge.target)
      .filter((targetId, index, ids) => ids.indexOf(targetId) === index);
    const targetIds = [...previousTargetIdsRef.current, ...currentTargetIds]
      .filter((targetId, index, ids) => ids.indexOf(targetId) === index);
    previousTargetIdsRef.current = currentTargetIds;

    targetIds.forEach((targetId) => {
      const targetNode = state.nodes.find((node) => node.id === targetId);
      if (!targetNode) return;
      const targetType = (targetNode.type || targetNode.data.type) as string;
      if (targetType === 'agent') return;
      const targetField = getConnectedPromptTargetField(targetType);
      if (!targetField) return;

      const connectedText = composePrompt(
        getIncomingPromptSources(targetId, state.nodes, state.edges)
          .map((source) => source.text)
      );
      const currentValue = typeof targetNode.data[targetField] === 'string'
        ? targetNode.data[targetField] as string
        : '';

      if (targetField === 'text') {
        if (currentValue !== connectedText) {
          updateNodeData(targetNode.id, { text: connectedText }, { recordUndo: false });
        }
        return;
      }
      if (targetField === 'prompt') {
        if (currentValue === connectedText || targetNode.data.promptEdited === true) return;
        updateNodeData(targetNode.id, { prompt: connectedText }, { recordUndo: false });
        return;
      }

      const previousSyncedText = typeof targetNode.data.connectedPromptText === 'string'
        ? targetNode.data.connectedPromptText
        : '';
      const localText = removePreviouslySyncedText(currentValue, previousSyncedText);
      const nextValue = mergeConnectedPromptText(connectedText, localText);
      if (currentValue === nextValue && previousSyncedText === connectedText) return;
      updateNodeData(targetNode.id, {
        [targetField]: nextValue,
        connectedPromptText: connectedText,
      }, { recordUndo: false });
    });
  }, [data.text, id, outgoingConnectionSignature, updateNodeData]);

  if (!isExpanded) {
    return (
      <div className="relative mc-node-glass-shell mc-node-compact overflow-hidden rounded-lg">
        <Handle type="target" position={Position.Left} className="mc-node-handle" />
        <CompactNodeFrame
          title={title}
          icon={<FileText className="h-3 w-3" />}
          text={(data.text as string) || ''}
          width="w-[240px]"
          accent="cyan"
          variant="glass-inner"
        />
        <Handle type="source" position={Position.Right} className="mc-node-handle" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'mc-node-glass-shell mc-node-expanded relative min-w-[240px] rounded-xl border border-white/22 transition-colors mc-dur-12f',
        selected || isExpanded
          ? 'shadow-[0_0_32px_rgba(255,255,255,0.14),0_22px_50px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.2)]'
          : 'border-slate-300/10 hover:border-slate-300/18'
      )}
    >
      <Handle type="target" position={Position.Left} className="mc-node-handle" />

      <div className="border-b border-slate-300/10 px-3 py-2 mc-node-frost-header">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-zinc-100 shadow-[0_0_10px_rgba(255,255,255,0.45)]" />
          <span className="text-xs font-medium uppercase tracking-wider text-slate-300">{title}</span>
        </div>
      </div>

      <div className="p-3">
        <p className="mb-1.5 text-[10px] text-slate-500">输入 @ 可插入画布上的素材引用</p>
        <MentionTextarea
          value={(data.text as string) || ''}
          onChange={(next) => updateNodeData(id, { text: next })}
          materials={materials}
          placeholder="输入文本，@ 引用素材..."
          minHeight="min-h-[88px]"
          minResizeWidth={180}
          minResizeHeight={72}
          size={promptBoxSize}
          onSizeChange={(next) => updateNodeData(id, { promptBoxSize: next })}
        />
      </div>

      <Handle type="source" position={Position.Right} className="mc-node-handle" />
    </div>
  );
}

export default memo(PromptNode);
