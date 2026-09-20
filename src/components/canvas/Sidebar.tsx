'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Bot,
  BoxSelect,
  Compass,
  Globe,
  GraduationCap,
  House,
  Image as ImageIcon,
  Layers,
  Music,
  Pencil,
  Redo2,
  Settings,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Upload,
  Video,
  Zap,
} from 'lucide-react';

import { CanvasNodeData, useCanvasStore } from './CanvasStore';
import { randomOffset } from './placement';
import { cn } from '@/lib/utils';
import { isEditionNodeTypeDisabled } from '@/lib/edition';
import { MC_CHROME_ENTRANCE_SCALE_START, MC_CHROME_ENTRANCE_TF } from '@/lib/motion';
import { fileToMaterialNodeData, getMaterialKindFromFile } from '@/lib/material-import-from-file';
import { WORKFLOW_TEMPLATES, getTemplateById } from '@/lib/workflow-templates';
import {
  deleteUserWorkflowPreset,
  getUserWorkflowPresetById,
  hideBuiltInWorkflowPreset,
  readHiddenBuiltInWorkflowPresetIds,
  readUserWorkflowPresets,
  subscribeUserWorkflowPresets,
} from '@/lib/user-workflow-presets';
import {
  centerCanvasNodePosition,
  requestCanvasViewportCenter,
} from '@/lib/canvas-node-placement';
import {
  consumeTutorialCreationCenter,
  notifyTutorialNodeCreated,
} from '@/lib/tutorial-events';

type ToolbarAction =
  | { kind: 'node'; label: string; icon: ReactNode; nodeType: CanvasNodeData['type'] }
  | { kind: 'action'; label: string; icon: ReactNode; action: 'import' | 'api-config' };

interface SidebarProps {
  onHome?: () => void;
  onOpenApiConfig?: () => void;
  onOpenTutorial?: () => void;
  /** 与画布镜头结束后，四周 UI 再滑入 */
  chromeReveal?: boolean;
}

export default function Sidebar({ onHome, onOpenApiConfig, onOpenTutorial, chromeReveal = true }: SidebarProps) {
  const { addNode, addNodeWithData, clearCanvas, undo, redo, requestRegionDraw, setEdges, pushUndoSnapshot } = useCanvasStore(
    useShallow((state) => ({
      addNode: state.addNode,
      addNodeWithData: state.addNodeWithData,
      clearCanvas: state.clearCanvas,
      undo: state.undo,
      redo: state.redo,
      requestRegionDraw: state.requestRegionDraw,
      setEdges: state.setEdges,
      pushUndoSnapshot: state.pushUndoSnapshot,
    }))
  );
  const pastLen = useCanvasStore((s) => s.past.length);
  const futureLen = useCanvasStore((s) => s.future.length);
  const selectedNodeHasTutorial = useCanvasStore((s) => {
    const type = s.selectedNode?.data.type;
    return Boolean(type && [
      'prompt',
      'image',
      'video',
      'material',
      'panorama',
      'music',
      'agent',
      'browser',
      'storyboard',
      'topazEnhance',
      'region',
    ].includes(type));
  });
  const [mounted, setMounted] = useState(false);
  const [workflowDropdownOpen, setWorkflowDropdownOpen] = useState(false);
  const [userWorkflowTemplates, setUserWorkflowTemplates] = useState<ReturnType<typeof readUserWorkflowPresets>>([]);
  const [hiddenBuiltInPresetIds, setHiddenBuiltInPresetIds] = useState<string[]>([]);
  const mediaImportInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const syncPresets = () => {
      setUserWorkflowTemplates(readUserWorkflowPresets());
      setHiddenBuiltInPresetIds(readHiddenBuiltInWorkflowPresetIds());
    };
    syncPresets();
    return subscribeUserWorkflowPresets(syncPresets);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setWorkflowDropdownOpen(false);
      }
    };
    if (workflowDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [workflowDropdownOpen]);

  const uiIn = mounted && chromeReveal;

  const handleAddNode = (type: CanvasNodeData['type']) => {
    if (type === 'region') {
      requestRegionDraw();
      return;
    }
    const previousNodeIds = new Set(useCanvasStore.getState().nodes.map((node) => node.id));
    const center = consumeTutorialCreationCenter(type) || requestCanvasViewportCenter();
    addNode(
      type,
      center
        ? centerCanvasNodePosition(type, center)
        : randomOffset(420, 300, 180, 120),
    );
    const createdNode = [...useCanvasStore.getState().nodes]
      .reverse()
      .find((node) => node.data.type === type && !previousNodeIds.has(node.id));
    notifyTutorialNodeCreated({ nodeId: createdNode?.id, nodeType: type });
  };

  const handleToolbarImportMedia = () => {
    mediaImportInputRef.current?.click();
  };

  const handleMediaImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files;
    if (!list?.length) return;

    const files = Array.from(list);
    const colW = 248;
    const rowH = 168;
    const cols = 4;
    const supportedCount = files.filter((file) => getMaterialKindFromFile(file)).length;
    const usedCols = Math.max(1, Math.min(cols, supportedCount));
    const usedRows = Math.max(1, Math.ceil(supportedCount / cols));
    const center = requestCanvasViewportCenter();
    const baseX = center
      ? center.x - ((usedCols - 1) * colW + 240) / 2
      : 320 + Math.random() * 80;
    const baseY = center
      ? center.y - ((usedRows - 1) * rowH + 170) / 2
      : 200 + Math.random() * 60;
    let slot = 0;

    for (const file of files) {
      if (!getMaterialKindFromFile(file)) {
        console.warn('已跳过不支持的文件:', file.name);
        continue;
      }
      try {
        const data = await fileToMaterialNodeData(file);
        const col = slot % cols;
        const row = Math.floor(slot / cols);
        slot += 1;
        addNodeWithData('material', { x: baseX + col * colW, y: baseY + row * rowH }, data);
      } catch (err) {
        console.error('导入素材失败:', file.name, err);
      }
    }

    event.target.value = '';
  };

  const handleClear = () => {
    if (confirm('确定要清空画布吗？此操作不可撤销。')) {
      clearCanvas();
    }
  };

  const handleLoadWorkflowTemplate = (templateId: string) => {
    const template = getUserWorkflowPresetById(templateId) || getTemplateById(templateId);
    if (!template) return;

    const center = requestCanvasViewportCenter();
    const templateMinX = Math.min(...template.nodes.map((node) => node.x));
    const templateMinY = Math.min(...template.nodes.map((node) => node.y));
    const templateMaxX = Math.max(...template.nodes.map((node) => node.x + 300));
    const templateMaxY = Math.max(...template.nodes.map((node) => node.y + 210));
    const offsetX = center ? center.x - (templateMinX + templateMaxX) / 2 : 0;
    const offsetY = center ? center.y - (templateMinY + templateMaxY) / 2 : 0;
    const nodeIdMap: Record<string, string> = {};
    for (const nodeTemplate of template.nodes) {
      const data: Record<string, unknown> = {};
      if (nodeTemplate.label) data.label = nodeTemplate.label;
      if (nodeTemplate.data) Object.assign(data, nodeTemplate.data);
      const nodeId = addNodeWithData(
        nodeTemplate.type,
        { x: nodeTemplate.x + offsetX, y: nodeTemplate.y + offsetY },
        data,
      );
      nodeIdMap[nodeTemplate.id] = nodeId;
    }

    const state = useCanvasStore.getState();
    const existingEdges = state.edges;
    const newEdges = [];
    for (const edge of template.edges) {
      const sourceId = nodeIdMap[edge.source];
      const targetId = nodeIdMap[edge.target];
      if (sourceId && targetId && !existingEdges.some((e) => e.source === sourceId && e.target === targetId)) {
        newEdges.push({
          id: `wf-e-${sourceId}-${targetId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          source: sourceId,
          target: targetId,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          type: 'beam' as const,
        });
      }
    }

    if (newEdges.length > 0) {
      pushUndoSnapshot();
      setEdges([...existingEdges, ...newEdges]);
    }

    setWorkflowDropdownOpen(false);
  };

  const handleDeleteWorkflowTemplate = (templateId: string, builtIn: boolean) => {
    if (builtIn) hideBuiltInWorkflowPreset(templateId);
    else deleteUserWorkflowPreset(templateId);
  };

  const toolbarItems: ToolbarAction[] = [
    { kind: 'node', label: '文本', icon: <Type className="h-5 w-5" />, nodeType: 'prompt' },
    { kind: 'node', label: '图像', icon: <ImageIcon className="h-5 w-5" />, nodeType: 'image' },
    { kind: 'node', label: '视频', icon: <Video className="h-5 w-5" />, nodeType: 'video' },
    { kind: 'node', label: '浏览器', icon: <Compass className="h-5 w-5" />, nodeType: 'browser' },
    { kind: 'node', label: '素材', icon: <Layers className="h-5 w-5" />, nodeType: 'material' },
    { kind: 'node', label: '分镜', icon: <Pencil className="h-5 w-5" />, nodeType: 'storyboard' },
    { kind: 'node', label: '全景', icon: <Globe className="h-5 w-5" />, nodeType: 'panorama' },
    { kind: 'node', label: '画质', icon: <Sparkles className="h-5 w-5" />, nodeType: 'topazEnhance' },
    { kind: 'node', label: '音乐/语音', icon: <Music className="h-5 w-5" />, nodeType: 'music' },
    { kind: 'node', label: 'Agent', icon: <Bot className="h-5 w-5" />, nodeType: 'agent' },
    { kind: 'node', label: '区域', icon: <BoxSelect className="h-5 w-5" />, nodeType: 'region' },
    { kind: 'action', label: '导入', icon: <Upload className="h-5 w-5" />, action: 'import' },
    { kind: 'action', label: 'API配置', icon: <Settings className="h-5 w-5" />, action: 'api-config' },
  ];

  const handleToolbarImport = () => {
    handleToolbarImportMedia();
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      <header
        className={cn(
          'pointer-events-auto absolute left-8 top-8 flex origin-left items-start gap-3',
          uiIn
            ? cn('translate-x-0 scale-100 visible', MC_CHROME_ENTRANCE_TF)
            : cn('-translate-x-[110vw]', MC_CHROME_ENTRANCE_SCALE_START, 'invisible pointer-events-none transition-none')
        )}
      >
        {onHome ? (
          <button
            type="button"
            onClick={onHome}
            aria-label="返回欢迎页"
            title="返回欢迎页"
            className="flex h-[52px] w-11 shrink-0 items-center justify-center rounded-xl border border-white/12 bg-[#15191a]/55 text-zinc-200 shadow-[0_12px_32px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl transition-all mc-dur-12f hover:border-white/26 hover:bg-white/[0.09] hover:text-zinc-50 hover:shadow-[0_0_22px_rgba(255,255,255,0.1)]"
          >
            <House className="h-5 w-5 shrink-0 text-zinc-200/90" />
          </button>
        ) : null}
        <div className="min-w-0 leading-tight">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-400">Magine Canvas</h1>
          <p className="mt-1 text-sm text-zinc-500">Infinite Canvas</p>
        </div>
      </header>

      <div
        className={cn(
          'pointer-events-auto absolute right-8 top-8 flex origin-right items-center gap-3',
          uiIn
            ? cn('translate-x-0 scale-100 visible', MC_CHROME_ENTRANCE_TF)
            : cn('translate-x-[110vw]', MC_CHROME_ENTRANCE_SCALE_START, 'invisible pointer-events-none transition-none')
        )}
      >
        {onOpenTutorial && (
          <button
            type="button"
            data-tutorial-id="tutorial-entry"
            onClick={onOpenTutorial}
            className="mc-ref-icon-button relative"
            title="教学模式"
            aria-label="打开教学模式"
          >
            <GraduationCap className="h-5 w-5" />
            {selectedNodeHasTutorial && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-200 shadow-[0_0_8px_rgba(253,230,138,0.8)]" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => undo()}
          disabled={pastLen === 0}
          className={cn('mc-ref-icon-button', pastLen === 0 && 'opacity-35')}
          title="撤销"
          aria-label="撤销"
        >
          <Undo2 className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => redo()}
          disabled={futureLen === 0}
          className={cn('mc-ref-icon-button', futureLen === 0 && 'opacity-35')}
          title="重做"
          aria-label="重做"
        >
          <Redo2 className="h-5 w-5" />
        </button>
      </div>

      <nav
        data-tutorial-id="canvas-sidebar"
        className={cn(
          'mc-canvas-sidebar pointer-events-auto absolute left-7 top-[116px] flex w-[76px] origin-left flex-col items-center rounded-[20px] border border-white/12 bg-[#201f1d]/58 p-2 shadow-[0_28px_70px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl',
          uiIn
            ? cn('translate-x-0 scale-100 visible', MC_CHROME_ENTRANCE_TF)
            : cn('-translate-x-[110vw]', MC_CHROME_ENTRANCE_SCALE_START, 'invisible pointer-events-none transition-none')
        )}
      >
        {toolbarItems.filter(
          (item) => item.kind !== 'node' || !isEditionNodeTypeDisabled(item.nodeType)
        ).map((item, index) => {
          const onClick =
            item.kind === 'node'
              ? () => handleAddNode(item.nodeType)
              : item.action === 'import'
                ? () => handleToolbarImport()
                : () => onOpenApiConfig?.();

          return (
            <button
              key={`${item.label}-${index}`}
              type="button"
              data-tutorial-id={
                item.kind === 'node'
                  ? `sidebar-node-${item.nodeType}`
                  : `sidebar-action-${item.action}`
              }
              onClick={onClick}
              disabled={item.kind === 'action' && item.action === 'api-config' && !onOpenApiConfig}
              className={cn(
                'mc-canvas-sidebar-item group relative flex w-full flex-col items-center gap-0.5 rounded-xl py-1 text-[11px] font-medium text-zinc-300/78 transition-all mc-dur-12f hover:bg-white/8 hover:text-zinc-50',
                item.kind === 'action' && item.action === 'api-config' && !onOpenApiConfig && 'opacity-35'
              )}
              title={
                item.kind === 'action'
                  ? item.action === 'import'
                    ? '导入图像、视频、音频（可多选）'
                    : 'API 配置（图像、视频、语音等）'
                  : item.label
              }
            >
              <span className="mc-canvas-sidebar-icon flex h-6 w-6 items-center justify-center rounded-lg text-zinc-100/90 transition-all mc-dur-12f group-hover:bg-white/12 group-hover:text-zinc-50">
                {item.icon}
              </span>
              <span className="mc-canvas-sidebar-label text-center leading-tight">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      <input
        ref={mediaImportInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        onChange={handleMediaImportChange}
        className="hidden"
      />
      <div
        className={cn(
          'pointer-events-auto absolute bottom-8 left-8 z-[45] hidden origin-bottom-left items-center gap-2 2xl:flex',
          uiIn
            ? cn('translate-y-0 scale-100 visible', MC_CHROME_ENTRANCE_TF)
            : cn('translate-y-[110vh]', MC_CHROME_ENTRANCE_SCALE_START, 'invisible pointer-events-none transition-none')
        )}
      >
        {(
          [
            {
              key: 'clear',
              label: '清空',
              icon: <Trash2 className="h-4 w-4 shrink-0" />,
              onClick: handleClear,
              hover: 'hover:border-red-400/28 hover:bg-red-500/10 hover:text-red-200/95',
            },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            data-tutorial-id={'tutorialId' in item ? item.tutorialId : undefined}
            onClick={item.onClick}
            className={cn(
              'flex h-11 min-w-[5.75rem] items-center justify-center gap-2 rounded-full border border-white/10 bg-[#1b2021]/70 px-4 text-xs font-medium text-zinc-300/90 shadow-2xl shadow-black/35 backdrop-blur-2xl transition-all mc-dur-12f',
              item.hover
            )}
          >
            {item.icon}
            {item.label}
          </button>
        ))}

        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setWorkflowDropdownOpen(!workflowDropdownOpen)}
            className={cn(
              'flex h-11 min-w-[5.75rem] items-center justify-center gap-2 rounded-full border border-white/10 bg-[#1b2021]/70 px-4 text-xs font-medium text-zinc-300/90 shadow-2xl shadow-black/35 backdrop-blur-2xl transition-all mc-dur-12f',
              workflowDropdownOpen ? 'border-emerald-400/28 bg-emerald-500/10 text-emerald-200/95' : 'hover:border-emerald-400/28 hover:bg-emerald-500/10 hover:text-emerald-200/95'
            )}
          >
            <Zap className="h-4 w-4 shrink-0" />
            <span>预设</span>
          </button>
          {workflowDropdownOpen && (
            <div className="absolute bottom-full mb-2 left-0 w-72 max-h-80 overflow-y-auto rounded-2xl border border-white/12 bg-[#15191a]/95 p-2 shadow-[0_28px_70px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
              <div className="mb-2 px-2 text-xs font-medium text-zinc-500">预设工作流</div>
              <div className="space-y-1">
                {userWorkflowTemplates.length > 0 && (
                  <div className="px-2 pb-1 pt-0.5 text-[11px] font-medium text-zinc-500">我的预设</div>
                )}
                {userWorkflowTemplates.map((template) => (
                  <div key={template.id} className="group relative">
                    <button type="button" onClick={() => handleLoadWorkflowTemplate(template.id)} className="w-full rounded-xl px-3 py-2.5 pr-10 text-left text-xs transition-colors hover:bg-white/8">
                      <div className="font-medium text-zinc-200">{template.name}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">{template.description}</div>
                    </button>
                    <button type="button" title="删除预设" aria-label={`删除预设 ${template.name}`} onClick={(event) => { event.stopPropagation(); handleDeleteWorkflowTemplate(template.id, false); }} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-600 opacity-0 transition-all hover:bg-red-500/12 hover:text-red-300 group-hover:opacity-100 focus:opacity-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {userWorkflowTemplates.length > 0 && (
                  <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-zinc-500">内置预设</div>
                )}
                {Object.values(WORKFLOW_TEMPLATES).filter((template) => !hiddenBuiltInPresetIds.includes(template.id)).map((template) => (
                  <div key={template.id} className="group relative">
                    <button type="button" onClick={() => handleLoadWorkflowTemplate(template.id)} className="w-full rounded-xl px-3 py-2.5 pr-10 text-left text-xs transition-colors hover:bg-white/8">
                      <div className="font-medium text-zinc-200">{template.name}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">{template.description}</div>
                    </button>
                    <button type="button" title="删除预设" aria-label={`删除预设 ${template.name}`} onClick={(event) => { event.stopPropagation(); handleDeleteWorkflowTemplate(template.id, true); }} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-600 opacity-0 transition-all hover:bg-red-500/12 hover:text-red-300 group-hover:opacity-100 focus:opacity-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
