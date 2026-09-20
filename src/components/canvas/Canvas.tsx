'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  MarkerType,
  MiniMap,
  Panel,
  ReactFlowProvider,
  ReactFlowInstance,
  SelectionMode,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
  type OnConnectEnd,
  type OnConnectStart,
  type Viewport,
} from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import { Grid3X3, Maximize2, Minus, Plus, Cpu, Loader2 } from 'lucide-react';

import { setCanvasRfGetNodes } from '@/lib/canvasRfNodesBridge';
import {
  CANVAS_FOCUS_NODES_EVENT,
  type CanvasFocusNodesDetail,
} from '@/lib/canvas-focus-events';
import {
  CANVAS_VIEWPORT_CENTER_REQUEST_EVENT,
  type CanvasViewportCenterRequestDetail,
} from '@/lib/canvas-node-placement';
import {
  applyRegionReparenting,
  attachUnparentedNodesOverlappingRegion,
  regionMembershipChanged,
} from '@/lib/region-reparent';
import { useCanvasStore, CanvasNodeData, type NodeChange, type EdgeChange } from './CanvasStore';
import PromptNode from '../nodes/PromptNode';
import ImageNode from '../nodes/ImageNode';
import VideoNode from '../nodes/VideoNode';
import AgentNode from '../nodes/AgentNode';
import MaterialNode from '../nodes/MaterialNode';
import RegionNode from '../nodes/RegionNode';
import StoryboardNode from '../nodes/StoryboardNode';
import PanoramaNode from '../nodes/PanoramaNode';
import TopazEnhanceNode from '../nodes/TopazEnhanceNode';
import FaceComplianceNode from '../nodes/FaceComplianceNode';
import MusicNode from '../nodes/MusicNode';
import BrowserNode from '../nodes/BrowserNode';
import NodeMenu from './NodeMenu';
import CanvasContextMenu from './CanvasContextMenu';
import SaveWorkflowPresetDialog from './SaveWorkflowPresetDialog';
import BeamEdge from './BeamEdge';
import {
  GENERATED_AUDIO_DND_TYPE,
  GENERATED_IMAGE_DND_TYPE,
  GENERATED_VIDEO_DND_TYPE,
  GeneratedAudioDragPayload,
  GeneratedImageDragPayload,
  GeneratedVideoDragPayload,
  makeGeneratedAudioSlug,
  makeGeneratedImageSlug,
  makeGeneratedVideoSlug,
} from '@/lib/generated-image-dnd';
import { cn } from '@/lib/utils';
import { getCanvasNodeSize, layoutCanvasNodes } from '@/lib/canvas-layout';
import { isNativeTextUndoTarget } from '@/lib/keyboard-undo-target';
import { mcF, MC_CHROME_ENTRANCE_SCALE_START, MC_CHROME_ENTRANCE_TF } from '@/lib/motion';
import {
  notifyTutorialNodeCreated,
  notifyTutorialCanvasInteraction,
  setTutorialCreationCenter,
  TUTORIAL_PREPARE_CREATION_AREA_EVENT,
  type TutorialCanvasInteraction,
  type TutorialPrepareCreationAreaDetail,
} from '@/lib/tutorial-events';
import {
  createUserWorkflowPreset,
  saveUserWorkflowPreset,
} from '@/lib/user-workflow-presets';
import type { WorkflowTemplate } from '@/lib/workflow-templates';
import { materialNodeDisplaySize } from '@/lib/material-import-from-file';
import { snapCanvasNodeRect, type CanvasSnapRect } from '@/lib/canvas-node-snapping';
import {
  batchMediaExportMessage,
  collectNodeMediaExportGroups,
  exportNodeMediaGroups,
  showBatchMediaExportError,
  type BatchMediaExportProgress,
} from '@/lib/batch-media-export';
import { useCanvasPerformanceGovernor } from '@/lib/canvas-performance-governor';

// 注册自定义节点类型
const nodeTypes = {
  prompt: PromptNode,
  image: ImageNode,
  video: VideoNode,
  agent: AgentNode,
  material: MaterialNode,
  region: RegionNode,
  storyboard: StoryboardNode,
  panorama: PanoramaNode,
  topazEnhance: TopazEnhanceNode,
  faceCompliance: FaceComplianceNode,
  music: MusicNode,
  browser: BrowserNode,
};

// 注册自定义边类型
const edgeTypes = {
  beam: BeamEdge,
};

const defaultEdgeOptions = {
  type: 'beam',
  animated: false,
  interactionWidth: 18,
  style: { strokeWidth: 1.5 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: '#FB923C',
    width: 12,
    height: 12,
  },
};

const proOptions = { hideAttribution: true };
const NODE_ALIGNMENT_SNAP_PX = 10;
const NODE_ALIGNMENT_GUIDE_PADDING_PX = 72;
const CONNECTABLE_TARGET_NODE_TYPES: readonly CanvasNodeData['type'][] = [
  'prompt',
  'agent',
  'image',
  'video',
  'material',
  'storyboard',
  'panorama',
  'topazEnhance',
  'faceCompliance',
  'music',
];

function getTargetHandleId(type: CanvasNodeData['type']): string | null {
  switch (type) {
    case 'image':
      return 'prompt';
    case 'video':
    case 'music':
      return 'input';
    case 'topazEnhance':
      return 'in';
    default:
      return null;
  }
}

interface NodeMenuState {
  x: number;
  y: number;
  pendingConnection?: {
    sourceNodeId: string;
    sourceHandleId: string | null;
  };
}

const MINIMAP_NODE_COLORS: Record<string, string> = {
  prompt: '#e7e5e4',
  image: '#fb923c',
  video: '#f97316',
  agent: '#d6d3d1',
  material: '#e7e5e4',
  region: '#d4d4d8',
  storyboard: '#d6d3d1',
  panorama: '#22c55e',
  topazEnhance: '#a78bfa',
  browser: '#22d3ee',
};

function minimapNodeColor(node: Node): string {
  return MINIMAP_NODE_COLORS[(node.data as CanvasNodeData).type] || '#e7e5e4';
}

const CONTEXT_MENU_WIDTH = 238;
const CONTEXT_MENU_HEIGHT = 304;

/** 点画布后连线由亮缓回常态；与 globals 中 `.mc-edge-fading` 动画时长一致 */
const MC_EDGE_PANE_FADE_MS = 700;

/** 已是空数组时不要 setState([])，否则新引用会触发 edgesForRf 全量重建 → 整画布闪一下 */
function clearStringIdArrayIfNonEmpty(prev: string[]): string[] {
  return prev.length === 0 ? prev : [];
}

function computeMcBeamEdgeClassName(
  e: Edge,
  dissolving: Set<string>,
  selected: Set<string>,
  fading: Set<string>
): string {
  return cn(
    e.className,
    dissolving.has(e.id) && 'mc-edge-dissolving',
    selected.has(e.id) && !dissolving.has(e.id) && 'mc-edge-locked',
    fading.has(e.id) && !selected.has(e.id) && !dissolving.has(e.id) && 'mc-edge-fading',
  );
}

/** 连线断开：缓出后再从 store 移除；与 globals 中 `.mc-edge-dissolving` 动画时长一致 */
const MC_EDGE_DISSOLVE_MS = 640;

/** 画布底栏图标：悬停/停留反馈 — 柔光淡白（勿用橙褐） */
const MC_CANVAS_CHROME_ICON_HOVER =
  'hover:border-white/26 hover:bg-white/[0.095] hover:text-zinc-50 hover:shadow-[0_0_22px_rgba(255,255,255,0.11)]';

function setCanvasInteractionBusy(value: boolean) {
  if (typeof window === 'undefined') return;
  (window as Window & { __magineCanvasInteractionBusy?: boolean }).__magineCanvasInteractionBusy = value;
}

/** 折叠态紧凑 UI 尺寸；RF 命中盒须与此一致，否则连线锚点会脱离节点 */
const AGENT_COLLAPSED_FLOW_W = 280;
const AGENT_COLLAPSED_FLOW_H = 248;
const TOPAZ_COLLAPSED_FLOW_W = 280;
const TOPAZ_COLLAPSED_FLOW_H = 192;
const FACECOMPLIANCE_COLLAPSED_FLOW_W = 260;
const FACECOMPLIANCE_COLLAPSED_FLOW_H = 200;
const BROWSER_COLLAPSED_FLOW_W = 300;
const BROWSER_COLLAPSED_FLOW_H = 210;
const SCREEN_SPACE_EXPANDED_NODE_TYPES = new Set<CanvasNodeData['type']>([
  'image',
  'video',
  'material',
  'music',
]);

function withFlowDimensions(
  node: Node<CanvasNodeData>,
  width: number,
  height: number,
): Node<CanvasNodeData> {
  const style = node.style as { width?: unknown; height?: unknown } | undefined;
  if (
    node.width === width
    && node.height === height
    && style?.width === width
    && style?.height === height
  ) {
    return node;
  }
  return { ...node, width, height, style: { ...node.style, width, height } };
}

function withCollapsibleNodeFlowDimensions(
  nodes: Node<CanvasNodeData>[],
  expandedNodeId: string | null
): Node<CanvasNodeData>[] {
  return nodes.map((node) => {
    const expanded = expandedNodeId != null && expandedNodeId === node.id;

    if (node.type === 'agent') {
      if (expanded) {
        const fallbackSize = getCanvasNodeSize(node);
        const width = typeof node.data.agentWidth === 'number' ? node.data.agentWidth : fallbackSize.width;
        const height = typeof node.data.agentHeight === 'number' ? node.data.agentHeight : fallbackSize.height;
        return { ...node, width, height, style: { ...node.style, width, height } };
      }
      return {
        ...node,
        width: AGENT_COLLAPSED_FLOW_W,
        height: AGENT_COLLAPSED_FLOW_H,
        style: { ...node.style, width: AGENT_COLLAPSED_FLOW_W, height: AGENT_COLLAPSED_FLOW_H },
      };
    }

    if (node.type === 'topazEnhance') {
      if (expanded) {
        const { width, height } = getCanvasNodeSize(node);
        return { ...node, width, height, style: { ...node.style, width, height } };
      }
      return {
        ...node,
        width: TOPAZ_COLLAPSED_FLOW_W,
        height: TOPAZ_COLLAPSED_FLOW_H,
        style: { ...node.style, width: TOPAZ_COLLAPSED_FLOW_W, height: TOPAZ_COLLAPSED_FLOW_H },
      };
    }

    if (node.type === 'material') {
      const size = materialNodeDisplaySize(
        node.data.fileType,
        node.data.materialAspectW,
        node.data.materialAspectH,
      );
      return {
        ...node,
        width: size.width,
        height: size.height,
        style: { ...node.style, width: size.width, height: size.height },
      };
    }

    if (node.type === 'faceCompliance') {
      if (expanded) {
        const { width, height } = getCanvasNodeSize(node);
        return { ...node, width, height, style: { ...node.style, width, height } };
      }
      return {
        ...node,
        width: FACECOMPLIANCE_COLLAPSED_FLOW_W,
        height: FACECOMPLIANCE_COLLAPSED_FLOW_H,
        style: { ...node.style, width: FACECOMPLIANCE_COLLAPSED_FLOW_W, height: FACECOMPLIANCE_COLLAPSED_FLOW_H },
      };
    }

    if (node.type === 'browser') {
      if (expanded) {
        const persistedWidth = typeof node.data.browserWidth === 'number'
          ? Math.max(480, node.data.browserWidth)
          : 920;
        const persistedHeight = typeof node.data.browserHeight === 'number'
          ? Math.max(360, node.data.browserHeight)
          : 700;
        const width = node.resizing && typeof node.width === 'number'
          ? node.width
          : persistedWidth;
        const height = node.resizing && typeof node.height === 'number'
          ? node.height
          : persistedHeight;
        return withFlowDimensions(node, width, height);
      }
      return withFlowDimensions(node, BROWSER_COLLAPSED_FLOW_W, BROWSER_COLLAPSED_FLOW_H);
    }

    return node;
  });
}

/** 仅含影响 RF 布局/命中盒的字段；不含 selected（点画布会刷 selected 但不应整表 setNodes） */
function canvasNodeLayoutSig(flowNodes: Node<CanvasNodeData>[]): string {
  return flowNodes
    .map((node) => `${node.id}:${canvasNodeLayoutValueSig(node)}`)
    .join('|');
}

function canvasNodeLayoutValueSig(node: Node<CanvasNodeData>): string {
  const style = node.style as { width?: unknown; height?: unknown } | undefined;
  return [
    node.type,
    node.position.x.toFixed(4),
    node.position.y.toFixed(4),
    node.width ?? '',
    node.height ?? '',
    String(style?.width ?? ''),
    String(style?.height ?? ''),
    node.parentId ?? '',
    node.zIndex ?? '',
    (node as { className?: string }).className ?? '',
  ].join(':');
}

const EXPANDED_NODE_Z_INDEX = 10000;

function withExpandedNodeZIndex(
  flowNodes: Node<CanvasNodeData>[],
  selectedNodeId: string | null
): Node<CanvasNodeData>[] {
  if (!selectedNodeId) return flowNodes;
  return flowNodes.map((node) => {
    if (node.id !== selectedNodeId) return node;
    const zIndex = Math.max(node.zIndex ?? 0, EXPANDED_NODE_Z_INDEX);
    return node.zIndex === zIndex ? node : { ...node, zIndex };
  });
}

function changedStoreNodeDataIds(
  nodes: Node<CanvasNodeData>[],
  prevDataById: Map<string, CanvasNodeData>
): string[] {
  const changed: string[] = [];
  for (const n of nodes) {
    if (prevDataById.get(n.id) !== n.data) changed.push(n.id);
  }
  return changed;
}

// 主画布组件
function CanvasInner({
  gpuLite,
  onGpuLiteToggle,
  entrancePhase = 2,
  chromeReveal = true,
}: {
  gpuLite: boolean;
  onGpuLiteToggle?: () => void;
  /** 0: 虚焦拉近；1: 后拉变实；2: 镜头节奏收尾（如 fitView） */
  entrancePhase?: 0 | 1 | 2;
  /** 底部栏等：略大缩回、400ms 缓入（与 phase 1 镜头后拉同时开始） */
  chromeReveal?: boolean;
}) {
  const {
    nodes: storeNodes,
    edges: storeEdges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    setNodes: setStoreNodes,
    setEdges: setStoreEdges,
    setSelectedNode,
    addNode,
    addNodeWithData,
    addRegionNode,
  } = useCanvasStore(
    useShallow((state) => ({
      nodes: state.nodes,
      edges: state.edges,
      onNodesChange: state.onNodesChange,
      onEdgesChange: state.onEdgesChange,
      onConnect: state.onConnect,
      setNodes: state.setNodes,
      setEdges: state.setEdges,
      setSelectedNode: state.setSelectedNode,
      addNode: state.addNode,
      addNodeWithData: state.addNodeWithData,
      addRegionNode: state.addRegionNode,
    }))
  );
  const regionDrawRequested = useCanvasStore((s) => s.regionDrawRequested);
  const historyRevision = useCanvasStore((s) => s.historyRevision);
  const selectedNodeId = useCanvasStore((s) => s.selectedNode?.id ?? null);
  /** 与节点内 `isExpanded` 一致：折叠态用紧凑命中盒，避免连线锚点错位 */
  const flowExpandedNodeId = useCanvasStore((s) => {
    const selected = s.selectedNode;
    if (!selected) return null;
    const t = selected.type || selected.data?.type || s.nodes.find((node) => node.id === selected.id)?.data.type;
    if (t === 'agent' || t === 'topazEnhance' || t === 'material' || t === 'browser') {
      return selected.id;
    }
    return null;
  });
  const nodesForFlow = useMemo(
    () =>
      withExpandedNodeZIndex(
        withCollapsibleNodeFlowDimensions(storeNodes, flowExpandedNodeId),
        selectedNodeId
      ),
    [storeNodes, flowExpandedNodeId, selectedNodeId]
  );
  const flowLayoutSig = useMemo(() => canvasNodeLayoutSig(nodesForFlow), [nodesForFlow]);
  const performance = useCanvasPerformanceGovernor(storeNodes.length, storeEdges.length, gpuLite);
  const effectiveGpuLite = performance.profile !== 'normal';
  const denseCanvas = performance.profile === 'dense';
  /** 屏幕坐标（用于固定定位节点菜单） */
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
  const [regionPickActive, setRegionPickActive] = useState(false);
  const [regionBand, setRegionBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    flowPosition: { x: number; y: number };
    selectedNodeIds: string[];
  } | null>(null);
  const [batchSaveProgress, setBatchSaveProgress] = useState<BatchMediaExportProgress | null>(null);
  const [workflowPresetDraft, setWorkflowPresetDraft] = useState<{
    template: WorkflowTemplate;
    nodeCount: number;
  } | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [zoom, setZoom] = useState(1);
  /** 与底栏 zoom 文案同步；避免纯平移松手时 getZoom 与 state 完全一致仍 setState → 整棵 CanvasInner 白重渲 */
  const zoomDisplayRef = useRef(1);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  /** 右键按住 + 滚轮缩放：跟踪右键状态 */
  const isRightMouseRef = useRef(false);
  const isCtrlKeyRef = useRef(false);
  const didScrollDuringRightHoldRef = useRef(false);
  const connectionStartRef = useRef<{
    nodeId: string;
    handleId: string | null;
    handleType: 'source' | 'target';
  } | null>(null);
  const connectionCompletedRef = useRef(false);
  const updateNodeInternals = useUpdateNodeInternals();
  const canvasRootRef = useRef<HTMLDivElement>(null);
  const dotGridRef = useRef<HTMLDivElement>(null);
  const verticalAlignmentGuideRef = useRef<HTMLDivElement>(null);
  const horizontalAlignmentGuideRef = useRef<HTMLDivElement>(null);
  const dragSnapCandidatesRef = useRef<CanvasSnapRect[]>([]);
  const zoomSharpLowRef = useRef<boolean | null>(null);
  const isNodeDraggingRef = useRef(false);
  /** NodeResizer 拖拽中：RF 的 ResizeObserver 仍会逐帧上报 dimensions（无 resizing 字段），若写入 zustand 会与缩放抢主线程 */
  const nodeResizerLiveRef = useRef(false);
  const isViewportMovingRef = useRef(false);
  const regionPickActiveRef = useRef(false);
  const regionDragRef = useRef<{ pointerId: number; sx: number; sy: number } | null>(null);
  const regionBandRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const regionBandRafRef = useRef<number | null>(null);
  const dragStopSyncFrameRef = useRef<number | null>(null);
  /** 拖放写回 layout 的 rAF 链代数：新拖开始则丢弃链尾 sync，避免与下一轮交错 */
  const flowLayoutCommitSeqRef = useRef(0);
  const prevFlowLayoutSigRef = useRef('');
  const prevFlowLayoutByIdRef = useRef<Map<string, string>>(new Map());
  const prevStoreDataByIdRef = useRef<Map<string, CanvasNodeData>>(new Map());
  /** 视口平移代数：新平移开始则丢弃上一轮末尾的 deferred syncFlowMovingVisual */
  const panVisualSeqRef = useRef(0);
  /** setStoreNodes → effect setNodes 与 updateNodeInternals 交错时会导致其它节点闪一下 */
  const isFlowLayoutCommitRef = useRef(false);
  const interactionIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tutorialMoveInteractionRef = useRef<TutorialCanvasInteraction | null>(null);
  const tutorialMiniMapGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const hideAlignmentGuides = useCallback(() => {
    if (verticalAlignmentGuideRef.current) verticalAlignmentGuideRef.current.style.opacity = '0';
    if (horizontalAlignmentGuideRef.current) horizontalAlignmentGuideRef.current.style.opacity = '0';
  }, []);

  useEffect(() => {
    if (historyRevision === 0) return;
    flowLayoutCommitSeqRef.current += 1;
    if (dragStopSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(dragStopSyncFrameRef.current);
      dragStopSyncFrameRef.current = null;
    }
    isNodeDraggingRef.current = false;
    isFlowLayoutCommitRef.current = false;
    dragSnapCandidatesRef.current = [];
    hideAlignmentGuides();
    setCanvasInteractionBusy(false);
    canvasRootRef.current?.classList.remove(
      'is-flow-moving',
      'is-flow-moving-pan',
      'is-flow-moving-nodes',
    );
    reactFlowInstanceRef.current?.setNodes(
      nodesForFlow as Node<CanvasNodeData>[],
    );
  }, [hideAlignmentGuides, historyRevision, nodesForFlow]);

  useEffect(() => {
    let outerFrame: number | null = null;
    let innerFrame: number | null = null;
    const handleFocusNodes = (event: Event) => {
      const detail = (event as CustomEvent<CanvasFocusNodesDetail>).detail;
      const nodeIds = Array.isArray(detail?.nodeIds) ? detail.nodeIds.filter(Boolean) : [];
      if (nodeIds.length === 0) return;

      if (detail.selectNode !== false) {
        const selectedNodeId = detail.selectedNodeId || nodeIds[0];
        const selected = useCanvasStore.getState().nodes.find((node) => node.id === selectedNodeId);
        if (selected) setSelectedNode(selected);
      }

      if (outerFrame !== null) window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
      outerFrame = window.requestAnimationFrame(() => {
        innerFrame = window.requestAnimationFrame(() => {
          reactFlowInstanceRef.current?.fitView({
            nodes: nodeIds.map((id) => ({ id })),
            padding: 0.16,
            minZoom: 0.28,
            maxZoom: 0.88,
            duration: 520,
          });
        });
      });
    };

    window.addEventListener(CANVAS_FOCUS_NODES_EVENT, handleFocusNodes);
    return () => {
      window.removeEventListener(CANVAS_FOCUS_NODES_EVENT, handleFocusNodes);
      if (outerFrame !== null) window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
  }, [setSelectedNode]);

  useEffect(() => {
    const handleViewportCenterRequest = (event: Event) => {
      const instance = reactFlowInstanceRef.current;
      const root = canvasRootRef.current;
      const resolve = (
        event as CustomEvent<CanvasViewportCenterRequestDetail>
      ).detail?.resolve;
      if (!instance || !root || typeof resolve !== 'function') return;

      const rect = root.getBoundingClientRect();
      resolve(
        instance.screenToFlowPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        }),
      );
    };

    window.addEventListener(
      CANVAS_VIEWPORT_CENTER_REQUEST_EVENT,
      handleViewportCenterRequest,
    );
    return () => {
      window.removeEventListener(
        CANVAS_VIEWPORT_CENTER_REQUEST_EVENT,
        handleViewportCenterRequest,
      );
    };
  }, []);

  useEffect(() => {
    const handlePrepareCreationArea = (event: Event) => {
      const nodeType = (event as CustomEvent<TutorialPrepareCreationAreaDetail>).detail?.nodeType;
      const instance = reactFlowInstanceRef.current;
      const root = canvasRootRef.current;
      if (!nodeType || !instance || !root) return;

      const rect = root.getBoundingClientRect();
      const currentCenter = instance.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
      const topLevelNodes = useCanvasStore.getState().nodes.filter((node) => !node.parentId);
      const maxRight = topLevelNodes.length > 0
        ? Math.max(...topLevelNodes.map((node) => node.position.x + getCanvasNodeSize(node).width))
        : currentCenter.x - 1000;
      const center = {
        x: Math.max(currentCenter.x + 760, maxRight + 1000),
        y: currentCenter.y,
      };

      setTutorialCreationCenter({ nodeType, ...center });
      void instance.setCenter(center.x, center.y, {
        zoom: Math.min(instance.getZoom(), 0.88),
        duration: 520,
      });
    };

    window.addEventListener(TUTORIAL_PREPARE_CREATION_AREA_EVENT, handlePrepareCreationArea);
    return () => window.removeEventListener(TUTORIAL_PREPARE_CREATION_AREA_EVENT, handlePrepareCreationArea);
  }, []);

  useEffect(() => {
    const root = canvasRootRef.current;
    if (!root) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.react-flow__minimap')) return;
      tutorialMiniMapGestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
    };
    const handlePointerMove = (event: PointerEvent) => {
      const gesture = tutorialMiniMapGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return;
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= 3) {
        gesture.moved = true;
      }
    };
    const finishGesture = (event: PointerEvent) => {
      const gesture = tutorialMiniMapGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      tutorialMiniMapGestureRef.current = null;
      if (gesture.moved) notifyTutorialCanvasInteraction('minimap-pan');
    };

    root.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', finishGesture, true);
    window.addEventListener('pointercancel', finishGesture, true);
    return () => {
      root.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', finishGesture, true);
      window.removeEventListener('pointercancel', finishGesture, true);
    };
  }, []);

  /** 连线多选：Ctrl/⌘+点击加入或移出；无修饰键点已选中的任一条则全部断开；常亮 mc-edge-locked */
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  /** 点画布后：由亮态缓回常态（与 globals 中 mc-edge-fading 时长一致） */
  const [fadingEdgeIds, setFadingEdgeIds] = useState<string[]>([]);
  const edgePaneFadeTimerRef = useRef<number | null>(null);

  /** 连线断开中：先播缓出，再真正 remove */
  const [dissolvingEdgeIds, setDissolvingEdgeIds] = useState<string[]>([]);
  const pendingEdgeRemovalsRef = useRef<string[]>([]);
  const edgeDissolveTimerRef = useRef<number | null>(null);

  const dissolvingEdgeIdSet = useMemo(() => new Set(dissolvingEdgeIds), [dissolvingEdgeIds]);

  const clearEdgeDissolveTimer = useCallback(() => {
    if (edgeDissolveTimerRef.current !== null) {
      clearTimeout(edgeDissolveTimerRef.current);
      edgeDissolveTimerRef.current = null;
    }
  }, []);

  const flushPendingEdgeRemovals = useCallback(() => {
    clearEdgeDissolveTimer();
    const toRemove = pendingEdgeRemovalsRef.current;
    pendingEdgeRemovalsRef.current = [];
    setDissolvingEdgeIds((prev) => {
      if (toRemove.length > 0) return [];
      return clearStringIdArrayIfNonEmpty(prev);
    });
    if (toRemove.length > 0) {
      onEdgesChange(toRemove.map((id) => ({ type: 'remove', id })));
    }
  }, [clearEdgeDissolveTimer, onEdgesChange]);

  const scheduleEdgeRemovals = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      flushPendingEdgeRemovals();
      pendingEdgeRemovalsRef.current = ids;
      setDissolvingEdgeIds(ids);
      edgeDissolveTimerRef.current = window.setTimeout(() => {
        edgeDissolveTimerRef.current = null;
        const pending = pendingEdgeRemovalsRef.current;
        pendingEdgeRemovalsRef.current = [];
        setDissolvingEdgeIds(clearStringIdArrayIfNonEmpty);
        if (pending.length > 0) {
          onEdgesChange(pending.map((id) => ({ type: 'remove', id })));
        }
      }, MC_EDGE_DISSOLVE_MS);
    },
    [flushPendingEdgeRemovals, onEdgesChange]
  );

  const selectedEdgeIdSet = useMemo(() => new Set(selectedEdgeIds), [selectedEdgeIds]);
  const fadingEdgeIdSet = useMemo(() => new Set(fadingEdgeIds), [fadingEdgeIds]);

  /** 受控 edges 引用不变时 React Flow 不会整表同步边 → 避免节点层跟闪 */
  const edgesForRfStableRef = useRef<{ sig: string; storeRef: Edge[] | null; list: Edge[] }>({
    sig: '',
    storeRef: null,
    list: [],
  });

  const clearPaneEdgeFadeTimer = useCallback(() => {
    if (edgePaneFadeTimerRef.current !== null) {
      clearTimeout(edgePaneFadeTimerRef.current);
      edgePaneFadeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const ids = new Set(storeEdges.map((e) => e.id));
    setSelectedEdgeIds((prev) => {
      const next = prev.filter((id) => ids.has(id));
      return next.length === prev.length ? prev : next;
    });
    setFadingEdgeIds((prev) => {
      const next = prev.filter((id) => ids.has(id));
      return next.length === prev.length ? prev : next;
    });
    setDissolvingEdgeIds((prev) => {
      const next = prev.filter((id) => ids.has(id));
      if (next.length !== prev.length) {
        pendingEdgeRemovalsRef.current = pendingEdgeRemovalsRef.current.filter((id) => ids.has(id));
      }
      return next.length === prev.length ? prev : next;
    });
  }, [storeEdges]);

  const edgesForRf = useMemo(() => {
    const dissolve = dissolvingEdgeIdSet;
    const selected = selectedEdgeIdSet;
    const fading = fadingEdgeIdSet;
    const sig = `${denseCanvas ? 'dense' : 'standard'}\n${storeEdges
      .map((e) => {
        const ui = computeMcBeamEdgeClassName(e, dissolve, selected, fading);
        return `${e.id}|${e.source}|${e.target}|${ui}`;
      })
      .join('\n')}`;
    const prev = edgesForRfStableRef.current;
    if (sig === prev.sig && storeEdges === prev.storeRef && prev.list.length === storeEdges.length) {
      return prev.list;
    }
    const list = storeEdges.map((e) => ({
      ...e,
      className: computeMcBeamEdgeClassName(e, dissolve, selected, fading),
      interactionWidth: denseCanvas ? 0 : (e.interactionWidth ?? 18),
    }));
    edgesForRfStableRef.current = { sig, storeRef: storeEdges, list };
    return list;
  }, [storeEdges, dissolvingEdgeIdSet, selectedEdgeIdSet, fadingEdgeIdSet, denseCanvas]);

  const setInteractionBusyNow = useCallback((value: boolean) => {
    if (interactionIdleTimerRef.current !== null) {
      clearTimeout(interactionIdleTimerRef.current);
      interactionIdleTimerRef.current = null;
    }
    setCanvasInteractionBusy(value);
  }, []);

  const releaseInteractionBusySoon = useCallback(() => {
    if (interactionIdleTimerRef.current !== null) {
      clearTimeout(interactionIdleTimerRef.current);
    }

    interactionIdleTimerRef.current = setTimeout(() => {
      interactionIdleTimerRef.current = null;
      if (!isNodeDraggingRef.current && !isViewportMovingRef.current) {
        setCanvasInteractionBusy(false);
      }
    }, 900);
  }, []);

  /**
   * 与 globals.css 联动：降压动画与滤镜。
   * - is-flow-moving：任意画布交互（含视口平移）
   * - is-flow-moving-pan：仅视口平移（避免给每个节点挂 contain/will-change，减轻卡顿）
   * - is-flow-moving-nodes：节点/区域框选拖动（保留 per-node 合成层优化）
   * 注意：框选矩形（selection）不计入 nodeBusy，否则点画布会短暂挂上 is-flow-moving 导致全节点 backdrop 被剥掉 → 闪一下。
   */
  const syncFlowMovingVisual = useCallback(() => {
    const root = canvasRootRef.current;
    if (!root) return;
    const nodeBusy = isNodeDraggingRef.current || regionPickActiveRef.current;
    const viewportBusy = isViewportMovingRef.current;
    const anyBusy = nodeBusy || viewportBusy;
    const panOnly = viewportBusy && !nodeBusy;
    root.classList.toggle('is-flow-moving', anyBusy);
    root.classList.toggle('is-flow-moving-pan', panOnly);
    root.classList.toggle('is-flow-moving-nodes', nodeBusy);
  }, []);

  const exitRegionPick = useCallback(() => {
    if (regionBandRafRef.current !== null) {
      window.cancelAnimationFrame(regionBandRafRef.current);
      regionBandRafRef.current = null;
    }
    regionPickActiveRef.current = false;
    setRegionPickActive(false);
    setRegionBand(null);
    regionDragRef.current = null;
    regionBandRef.current = { x: 0, y: 0, w: 0, h: 0 };
    setInteractionBusyNow(false);
    syncFlowMovingVisual();
  }, [setInteractionBusyNow, syncFlowMovingVisual]);

  const handleRegionOverlayPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    regionDragRef.current = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY };
    const band = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
    regionBandRef.current = band;
    if (regionBandRafRef.current !== null) {
      window.cancelAnimationFrame(regionBandRafRef.current);
      regionBandRafRef.current = null;
    }
    setRegionBand(band);
  }, []);

  const handleRegionOverlayPointerMove = useCallback((e: React.PointerEvent) => {
    const d = regionDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.preventDefault();
    const x = Math.min(d.sx, e.clientX);
    const y = Math.min(d.sy, e.clientY);
    const w = Math.abs(e.clientX - d.sx);
    const h = Math.abs(e.clientY - d.sy);
    const band = { x, y, w, h };
    regionBandRef.current = band;
    if (regionBandRafRef.current !== null) return;
    regionBandRafRef.current = window.requestAnimationFrame(() => {
      regionBandRafRef.current = null;
      const b = regionBandRef.current;
      setRegionBand({ x: b.x, y: b.y, w: b.w, h: b.h });
    });
  }, []);

  const handleRegionOverlayPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = regionDragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      e.preventDefault();
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      regionDragRef.current = null;
      if (regionBandRafRef.current !== null) {
        window.cancelAnimationFrame(regionBandRafRef.current);
        regionBandRafRef.current = null;
      }
      const { x, y, w, h } = regionBandRef.current;
      setRegionBand(null);

      const inst = reactFlowInstanceRef.current;
      if (w >= 24 && h >= 24 && inst) {
        const p0 = inst.screenToFlowPosition({ x, y });
        const p1 = inst.screenToFlowPosition({ x: x + w, y: y + h });
        const minX = Math.min(p0.x, p1.x);
        const minY = Math.min(p0.y, p1.y);
        const fw = Math.abs(p1.x - p0.x);
        const fh = Math.abs(p1.y - p0.y);
        addRegionNode({ position: { x: minX, y: minY }, width: fw, height: fh });
        window.requestAnimationFrame(() => {
          notifyTutorialNodeCreated({ nodeType: 'region' });
        });
        exitRegionPick();
      }
    },
    [addRegionNode, exitRegionPick]
  );

  const handleRegionOverlayPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      regionDragRef.current = null;
      if (regionBandRafRef.current !== null) {
        window.cancelAnimationFrame(regionBandRafRef.current);
        regionBandRafRef.current = null;
      }
      setRegionBand(null);
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      exitRegionPick();
    },
    [exitRegionPick]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange) => {
      const filtered: NodeChange = [];
      for (const ch of changes) {
        /** RF 的选中态留在 RF 内部即可；写入 zustand 会换新 nodes 引用并拖垮所有订阅 state.nodes 的节点重渲 → 闪动 */
        if (ch.type === 'select') {
          continue;
        }
        if (ch.type === 'dimensions') {
          const state = useCanvasStore.getState();
          const expandedAgentId =
            state.selectedNode?.type === 'agent' ? state.selectedNode.id : null;
          const storeAgent = state.nodes.find((n) => n.id === ch.id);
          if (storeAgent?.type === 'agent' && expandedAgentId !== ch.id) {
            if (ch.resizing === true) nodeResizerLiveRef.current = true;
            else if (ch.resizing === false && ch.dimensions == null) nodeResizerLiveRef.current = false;
            continue;
          }
          if (ch.resizing === true) {
            nodeResizerLiveRef.current = true;
            continue;
          }
          if (ch.resizing === false && ch.dimensions == null) {
            nodeResizerLiveRef.current = false;
            filtered.push(ch);
            continue;
          }
          if (
            nodeResizerLiveRef.current &&
            ch.dimensions != null &&
            ch.resizing === undefined
          ) {
            continue;
          }
        }
        filtered.push(ch);
      }
      if (filtered.length === 0) return;

      const hasPositionChange = filtered.some((change) => change.type === 'position');
      if (!hasPositionChange || !isNodeDraggingRef.current) {
        onNodesChange(filtered);
      }
    },
    [onNodesChange]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange) => {
      onEdgesChange(changes);
    },
    [onEdgesChange]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      connectionCompletedRef.current = true;
      onConnect(connection);
    },
    [onConnect]
  );

  const handleConnectStart: OnConnectStart = useCallback((_event, params) => {
    connectionCompletedRef.current = false;
    connectionStartRef.current = params.nodeId && params.handleType
      ? {
          nodeId: params.nodeId,
          handleId: params.handleId,
          handleType: params.handleType,
        }
      : null;
  }, []);

  const handleConnectEnd: OnConnectEnd = useCallback((event) => {
    const start = connectionStartRef.current;
    const didConnect = connectionCompletedRef.current;
    connectionStartRef.current = null;
    connectionCompletedRef.current = false;

    if (!start || start.handleType !== 'source' || didConnect) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.classList.contains('react-flow__pane')) return;

    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    if (!point) return;
    setContextMenu(null);
    setNodeMenu({
      x: point.clientX,
      y: point.clientY,
      pendingConnection: {
        sourceNodeId: start.nodeId,
        sourceHandleId: start.handleId,
      },
    });
  }, []);

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node<CanvasNodeData>) => {
      flushPendingEdgeRemovals();
      clearPaneEdgeFadeTimer();
      setFadingEdgeIds(clearStringIdArrayIfNonEmpty);
      setSelectedEdgeIds((prev) => (prev.length === 0 ? prev : []));
      if (!event.ctrlKey && !event.metaKey) {
        const selectedNode = useCanvasStore.getState().nodes.find((n) => n.id === node.id) ?? node;
        setSelectedNode(selectedNode);
        window.requestAnimationFrame(() => updateNodeInternals(node.id));
      }
    },
    [clearPaneEdgeFadeTimer, flushPendingEdgeRemovals, setSelectedNode, updateNodeInternals],
  );

  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.stopPropagation();
      flushPendingEdgeRemovals();
      clearPaneEdgeFadeTimer();
      setFadingEdgeIds(clearStringIdArrayIfNonEmpty);
      const multi = event.ctrlKey || event.metaKey;

      if (multi) {
        setSelectedEdgeIds((prev) => {
          if (prev.includes(edge.id)) {
            return prev.filter((id) => id !== edge.id);
          }
          return [...prev, edge.id];
        });
        return;
      }

      if (selectedEdgeIdSet.has(edge.id) && selectedEdgeIds.length > 0) {
        const toRemove = [...selectedEdgeIds];
        setSelectedEdgeIds([]);
        scheduleEdgeRemovals(toRemove);
        return;
      }

      setSelectedEdgeIds([edge.id]);
    },
    [
      clearPaneEdgeFadeTimer,
      flushPendingEdgeRemovals,
      scheduleEdgeRemovals,
      selectedEdgeIdSet,
      selectedEdgeIds,
      setSelectedNode,
    ],
  );

  const handleNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: Node<CanvasNodeData>) => {
      if (dragStopSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(dragStopSyncFrameRef.current);
        dragStopSyncFrameRef.current = null;
      }
      useCanvasStore.getState().pushUndoSnapshot();
      flowLayoutCommitSeqRef.current += 1;
      isNodeDraggingRef.current = true;
      hideAlignmentGuides();
      setInteractionBusyNow(true);
      syncFlowMovingVisual();

      if (node.type === 'region' || node.data?.type === 'region') {
        const currentNodes = useCanvasStore.getState().nodes;
        let nextNodes = attachUnparentedNodesOverlappingRegion(currentNodes, node.id, {
          expandedNodeId: flowExpandedNodeId,
        });
        nextNodes = applyRegionReparenting(nextNodes, { expandedNodeId: flowExpandedNodeId });
        if (regionMembershipChanged(currentNodes, nextNodes)) {
          setStoreNodes(nextNodes);
          reactFlowInstanceRef.current?.setNodes(
            withCollapsibleNodeFlowDimensions(nextNodes, flowExpandedNodeId) as Node<CanvasNodeData>[]
          );
        }
      }

      const liveNodes = (reactFlowInstanceRef.current?.getNodes() || []) as Node<CanvasNodeData>[];
      dragSnapCandidatesRef.current = liveNodes
        .filter((item) => !item.hidden && item.id !== node.id)
        .map((item) => {
          const size = getCanvasNodeSize(item);
          return {
            id: item.id,
            x: item.position.x,
            y: item.position.y,
            width: size.width,
            height: size.height,
            parentId: item.parentId,
          };
        });
    },
    [flowExpandedNodeId, hideAlignmentGuides, setInteractionBusyNow, setStoreNodes, syncFlowMovingVisual]
  );

  /** 拖拽中只微调当前节点的吸附位置，不编组或写入 store；松手后在 commitNodesAfterDrag 统一处理。 */
  const handleNodeDrag = useCallback(
    (_event: React.MouseEvent | null, node: Node<CanvasNodeData>) => {
      const instance = reactFlowInstanceRef.current;
      const root = canvasRootRef.current;
      if (!instance || !root) return;

      const liveNodes = instance.getNodes() as Node<CanvasNodeData>[];
      let selectedCount = 0;
      for (const item of liveNodes) {
        if (item.selected) selectedCount += 1;
        if (selectedCount > 1) break;
      }
      if (selectedCount > 1) {
        hideAlignmentGuides();
        return;
      }

      const liveMovingNode = liveNodes.find((item) => item.id === node.id) ?? node;
      const movingNode = { ...liveMovingNode, position: node.position };
      const movingSize = getCanvasNodeSize(movingNode);
      const snapResult = snapCanvasNodeRect(
        {
          id: movingNode.id,
          x: movingNode.position.x,
          y: movingNode.position.y,
          width: movingSize.width,
          height: movingSize.height,
          parentId: movingNode.parentId,
        },
        dragSnapCandidatesRef.current,
        NODE_ALIGNMENT_SNAP_PX / Math.max(instance.getZoom(), 0.01),
      );

      if (snapResult.guides.length === 0) {
        hideAlignmentGuides();
        return;
      }

      instance.setNodes((currentNodes) => currentNodes.map((item) => (
        item.id === movingNode.id
          ? { ...item, position: snapResult.position }
          : item
      )));

      const positionAbsolute = (movingNode as Node<CanvasNodeData> & {
        positionAbsolute?: { x: number; y: number };
      }).positionAbsolute;
      const parentOffsetX = positionAbsolute ? positionAbsolute.x - movingNode.position.x : 0;
      const parentOffsetY = positionAbsolute ? positionAbsolute.y - movingNode.position.y : 0;
      const absolutePosition = {
        x: snapResult.position.x + parentOffsetX,
        y: snapResult.position.y + parentOffsetY,
      };
      const nodeScreenPosition = instance.flowToScreenPosition(absolutePosition);
      const rootRect = root.getBoundingClientRect();
      const nodeScreenWidth = movingSize.width * instance.getZoom();
      const nodeScreenHeight = movingSize.height * instance.getZoom();
      const xGuide = snapResult.guides.find((guide) => guide.axis === 'x');
      const yGuide = snapResult.guides.find((guide) => guide.axis === 'y');

      if (xGuide && verticalAlignmentGuideRef.current) {
        const screen = instance.flowToScreenPosition({
          x: xGuide.coordinate + parentOffsetX,
          y: absolutePosition.y,
        });
        const element = verticalAlignmentGuideRef.current;
        element.style.transform = `translate3d(${screen.x - rootRect.left}px, ${nodeScreenPosition.y - rootRect.top - NODE_ALIGNMENT_GUIDE_PADDING_PX}px, 0)`;
        element.style.height = `${nodeScreenHeight + NODE_ALIGNMENT_GUIDE_PADDING_PX * 2}px`;
        element.style.opacity = '1';
      } else if (verticalAlignmentGuideRef.current) {
        verticalAlignmentGuideRef.current.style.opacity = '0';
      }

      if (yGuide && horizontalAlignmentGuideRef.current) {
        const screen = instance.flowToScreenPosition({
          x: absolutePosition.x,
          y: yGuide.coordinate + parentOffsetY,
        });
        const element = horizontalAlignmentGuideRef.current;
        element.style.transform = `translate3d(${nodeScreenPosition.x - rootRect.left - NODE_ALIGNMENT_GUIDE_PADDING_PX}px, ${screen.y - rootRect.top}px, 0)`;
        element.style.width = `${nodeScreenWidth + NODE_ALIGNMENT_GUIDE_PADDING_PX * 2}px`;
        element.style.opacity = '1';
      } else if (horizontalAlignmentGuideRef.current) {
        horizontalAlignmentGuideRef.current.style.opacity = '0';
      }
    },
    [hideAlignmentGuides]
  );

  const commitNodesAfterDrag = useCallback(() => {
    if (dragStopSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(dragStopSyncFrameRef.current);
    }

    const scheduledSeq = flowLayoutCommitSeqRef.current;
    dragStopSyncFrameRef.current = window.requestAnimationFrame(() => {
      dragStopSyncFrameRef.current = null;
      if (scheduledSeq !== flowLayoutCommitSeqRef.current) {
        isNodeDraggingRef.current = false;
        return;
      }
      isFlowLayoutCommitRef.current = true;
      const inst = reactFlowInstanceRef.current ?? reactFlowInstance;
      const liveNodes = (inst?.getNodes() || storeNodes) as Node<CanvasNodeData>[];
      const nextNodes = applyRegionReparenting(liveNodes, { expandedNodeId: flowExpandedNodeId });
      const flowNodes = withCollapsibleNodeFlowDimensions(
        nextNodes,
        flowExpandedNodeId
      ) as Node<CanvasNodeData>[];
      const previousById = new Map(storeNodes.map((item) => [item.id, item]));
      const changedNodeIds = nextNodes
        .filter((item) => {
          const previous = previousById.get(item.id);
          return !previous
            || previous.position.x !== item.position.x
            || previous.position.y !== item.position.y
            || previous.parentId !== item.parentId;
        })
        .map((item) => item.id);
      setStoreNodes(nextNodes);
      inst?.setNodes(flowNodes);
      prevFlowLayoutSigRef.current = canvasNodeLayoutSig(flowNodes);
      prevFlowLayoutByIdRef.current = new Map(
        flowNodes.map((item) => [item.id, canvasNodeLayoutValueSig(item)]),
      );
      prevStoreDataByIdRef.current = new Map(nextNodes.map((item) => [item.id, item.data]));
      /* 拖拽中不再每帧 updateNodeInternals；提交后只刷新实际移动或换组节点的连线锚点；
       * syncFlowMovingVisual 须再延后一帧：否则先去掉 is-flow-moving 再测 handleBounds，其它节点会闪一下 */
      window.requestAnimationFrame(() => {
        if (scheduledSeq !== flowLayoutCommitSeqRef.current) {
          isFlowLayoutCommitRef.current = false;
          isNodeDraggingRef.current = false;
          return;
        }
        if (changedNodeIds.length) updateNodeInternals(changedNodeIds);
        window.requestAnimationFrame(() => {
          if (scheduledSeq !== flowLayoutCommitSeqRef.current) {
            isFlowLayoutCommitRef.current = false;
            isNodeDraggingRef.current = false;
            return;
          }
          syncFlowMovingVisual();
          isFlowLayoutCommitRef.current = false;
          isNodeDraggingRef.current = false;
        });
      });
    });
  }, [flowExpandedNodeId, reactFlowInstance, setStoreNodes, storeNodes, syncFlowMovingVisual, updateNodeInternals]);

  const handleNodeDragStop = useCallback(() => {
    dragSnapCandidatesRef.current = [];
    hideAlignmentGuides();
    if (!isViewportMovingRef.current) {
      releaseInteractionBusySoon();
    }
    commitNodesAfterDrag();
  }, [commitNodesAfterDrag, hideAlignmentGuides, releaseInteractionBusySoon]);

  const handleSelectionDragStart = useCallback(() => {
    if (dragStopSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(dragStopSyncFrameRef.current);
      dragStopSyncFrameRef.current = null;
    }
    useCanvasStore.getState().pushUndoSnapshot();
    flowLayoutCommitSeqRef.current += 1;
    isNodeDraggingRef.current = true;
    hideAlignmentGuides();
    setInteractionBusyNow(true);
    syncFlowMovingVisual();
  }, [hideAlignmentGuides, setInteractionBusyNow, syncFlowMovingVisual]);

  /** 框选拖拽中不编组，避免跳闪；松手后 commitNodesAfterDrag 统一处理 */
  const handleSelectionDrag = useCallback(
    (_event: React.MouseEvent, _nodes: Node<CanvasNodeData>[]) => {},
    []
  );

  const handleSelectionDragStop = useCallback(() => {
    hideAlignmentGuides();
    if (!isViewportMovingRef.current) {
      releaseInteractionBusySoon();
    }
    commitNodesAfterDrag();
  }, [commitNodesAfterDrag, hideAlignmentGuides, releaseInteractionBusySoon]);

  const handleMoveStart = useCallback((event?: MouseEvent | TouchEvent | null) => {
    if (isNodeDraggingRef.current) return;
    tutorialMoveInteractionRef.current = null;
    if (event instanceof MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.react-flow__minimap')) {
        tutorialMoveInteractionRef.current = 'minimap-pan';
      } else if (event.button === 1) {
        tutorialMoveInteractionRef.current = 'middle-pan';
      }
    }
    panVisualSeqRef.current += 1;
    isViewportMovingRef.current = true;
    setInteractionBusyNow(true);
    syncFlowMovingVisual();
  }, [setInteractionBusyNow, syncFlowMovingVisual]);

  const commitZoomDisplay = useCallback((next: number) => {
    if (!Number.isFinite(next)) return;
    const shell = canvasRootRef.current;
    if (shell) {
      const low = next < 0.52;
      if (zoomSharpLowRef.current !== low) {
        zoomSharpLowRef.current = low;
        if (low) shell.setAttribute('data-mc-zoom-sharp', '');
        else shell.removeAttribute('data-mc-zoom-sharp');
      }
    }
    if (Math.abs(next - zoomDisplayRef.current) <= 0.0025) return;
    zoomDisplayRef.current = next;
    setZoom(next);
  }, []);

  const syncCanvasDotGrid = useCallback((viewport: Viewport) => {
    const grid = dotGridRef.current;
    const z = viewport.zoom;
    if (!grid || !Number.isFinite(z) || z <= 0) return;

    const gap = (effectiveGpuLite ? 28 : 22) * z;
    const viewportX = Number.isFinite(viewport.x) ? viewport.x : 0;
    const viewportY = Number.isFinite(viewport.y) ? viewport.y : 0;
    const offsetX = ((viewportX % gap) + gap) % gap;
    const offsetY = ((viewportY % gap) + gap) % gap;
    const backgroundSize = `${gap.toFixed(3)}px ${gap.toFixed(3)}px`;
    const backgroundPosition = `${offsetX.toFixed(3)}px ${offsetY.toFixed(3)}px`;
    const dotCoreRadius = `${z.toFixed(3)}px`;
    const dotSoftRadius = `${((effectiveGpuLite ? 1.35 : 1.4) * z).toFixed(3)}px`;
    const dotEdgeRadius = `${((effectiveGpuLite ? 1.75 : 1.85) * z).toFixed(3)}px`;
    const dotOpacity = z <= 0.28 ? 0 : z >= 0.5 ? 1 : (z - 0.28) / 0.22;

    if (grid.style.backgroundSize !== backgroundSize) {
      grid.style.backgroundSize = backgroundSize;
    }
    if (grid.style.backgroundPosition !== backgroundPosition) {
      grid.style.backgroundPosition = backgroundPosition;
    }
    if (grid.style.getPropertyValue('--mc-dot-core-radius') !== dotCoreRadius) {
      grid.style.setProperty('--mc-dot-core-radius', dotCoreRadius);
    }
    if (grid.style.getPropertyValue('--mc-dot-soft-radius') !== dotSoftRadius) {
      grid.style.setProperty('--mc-dot-soft-radius', dotSoftRadius);
    }
    if (grid.style.getPropertyValue('--mc-dot-edge-radius') !== dotEdgeRadius) {
      grid.style.setProperty('--mc-dot-edge-radius', dotEdgeRadius);
    }
    const opacity = dotOpacity.toFixed(3);
    if (grid.style.opacity !== opacity) {
      grid.style.opacity = opacity;
    }
  }, [effectiveGpuLite]);

  useEffect(() => {
    const instance = reactFlowInstanceRef.current;
    if (instance) syncCanvasDotGrid(instance.getViewport());
  }, [syncCanvasDotGrid]);

  const handleViewportMove = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    syncCanvasDotGrid(viewport);
    const z = viewport.zoom;
    if (!Number.isFinite(z)) return;
    const shell = canvasRootRef.current;
    if (!shell) return;
    const low = z < 0.52;
    if (zoomSharpLowRef.current === low) return;
    zoomSharpLowRef.current = low;
    if (low) shell.setAttribute('data-mc-zoom-sharp', '');
    else shell.removeAttribute('data-mc-zoom-sharp');
  }, [syncCanvasDotGrid]);

  const handleMoveEnd = useCallback(
    (_event?: MouseEvent | TouchEvent | null, viewport?: Viewport) => {
      isViewportMovingRef.current = false;
      const seq = panVisualSeqRef.current;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (seq !== panVisualSeqRef.current) return;
          syncFlowMovingVisual();
        });
      });
      const instance = reactFlowInstanceRef.current || reactFlowInstance;
      const nextZoom = viewport?.zoom ?? instance?.getZoom();
      if (typeof nextZoom === 'number') {
        commitZoomDisplay(nextZoom);
      }
      if (!isNodeDraggingRef.current) {
        releaseInteractionBusySoon();
      }
      const tutorialInteraction = tutorialMoveInteractionRef.current;
      tutorialMoveInteractionRef.current = null;
      if (tutorialInteraction) notifyTutorialCanvasInteraction(tutorialInteraction);
    },
    [commitZoomDisplay, reactFlowInstance, releaseInteractionBusySoon, syncFlowMovingVisual]
  );

  const handlePaneClick = useCallback(() => {
    flushPendingEdgeRemovals();
    clearPaneEdgeFadeTimer();
    if (selectedEdgeIds.length > 0) {
      setFadingEdgeIds([...selectedEdgeIds]);
      setSelectedEdgeIds([]);
      edgePaneFadeTimerRef.current = window.setTimeout(() => {
        edgePaneFadeTimerRef.current = null;
        setFadingEdgeIds(clearStringIdArrayIfNonEmpty);
      }, MC_EDGE_PANE_FADE_MS);
    } else {
      setFadingEdgeIds(clearStringIdArrayIfNonEmpty);
    }
    const selectedNode = useCanvasStore.getState().selectedNode;
    const keepExpandedAgent = selectedNode?.type === 'agent' || selectedNode?.data.type === 'agent';
    if (!keepExpandedAgent) setSelectedNode(null);
    setNodeMenu(null);
    setContextMenu(null);
  }, [clearPaneEdgeFadeTimer, flushPendingEdgeRemovals, selectedEdgeIds, setSelectedNode]);

  const handlePaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const t = event.target as Element;
      if (!t.closest) return; // 安全检查
      if (t.closest('.react-flow__node')) return;
      if (t.closest('.react-flow__controls')) return;
      if (t.closest('.react-flow__minimap')) return;
      if (!t.closest('.react-flow__pane')) return;
      event.preventDefault();
      event.stopPropagation();
      window.getSelection()?.removeAllRanges();
      setContextMenu(null);
      setNodeMenu({ x: event.clientX, y: event.clientY });
      notifyTutorialCanvasInteraction('double-click-menu');
      window.requestAnimationFrame(() => {
        window.getSelection()?.removeAllRanges();
      });
    },
    []
  );

  const openContextMenu = useCallback(
    (event: React.MouseEvent, contextNodes?: Node<CanvasNodeData> | Node<CanvasNodeData>[]) => {
      const target = event.target as Element;
      if (!target.closest) return;
      if (target.closest('.react-flow__controls')) return;
      if (target.closest('.react-flow__minimap')) return;
      if (!reactFlowInstance) return;

      event.preventDefault();
      event.stopPropagation();
      window.getSelection()?.removeAllRanges();
      setNodeMenu(null);

      const maxX = Math.max(8, window.innerWidth - CONTEXT_MENU_WIDTH - 8);
      const maxY = Math.max(8, window.innerHeight - CONTEXT_MENU_HEIGHT - 8);
      setContextMenu({
        x: Math.min(event.clientX, maxX),
        y: Math.min(event.clientY, maxY),
        flowPosition: reactFlowInstance.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        }),
        selectedNodeIds: Array.isArray(contextNodes)
          ? contextNodes.map((node) => node.id)
          : reactFlowInstance.getNodes()
              .filter((node) => node.selected)
              .map((node) => node.id),
      });
      notifyTutorialCanvasInteraction('context-menu');
    },
    [reactFlowInstance]
  );

  const handleOpenSaveWorkflowPreset = useCallback(() => {
    if (!contextMenu?.selectedNodeIds.length || !reactFlowInstance) return;

    const selectedIds = new Set(contextMenu.selectedNodeIds);
    const livePositions = new Map(
      reactFlowInstance.getNodes().map((node) => [node.id, node.position]),
    );
    const state = useCanvasStore.getState();
    const selectedNodes = state.nodes
      .filter((node) => selectedIds.has(node.id))
      .map((node) => ({
        ...node,
        position: livePositions.get(node.id) || node.position,
      })) as Node<CanvasNodeData>[];

    if (!selectedNodes.length) return;
    setWorkflowPresetDraft({
      template: createUserWorkflowPreset('未命名工作流', selectedNodes, state.edges),
      nodeCount: selectedNodes.length,
    });
    setContextMenu(null);
  }, [contextMenu, reactFlowInstance]);

  const handleConfirmSaveWorkflowPreset = useCallback((name: string) => {
    if (!workflowPresetDraft) return;
    saveUserWorkflowPreset({ ...workflowPresetDraft.template, name });
    setWorkflowPresetDraft(null);
  }, [workflowPresetDraft]);

  const handleBatchSaveSelectedMedia = useCallback(async () => {
    if (!contextMenu?.selectedNodeIds.length || batchSaveProgress) return;
    const selectedIds = new Set(contextMenu.selectedNodeIds);
    const selectedNodes = useCanvasStore.getState().nodes.filter((node) => selectedIds.has(node.id));
    try {
      const groups = collectNodeMediaExportGroups(selectedNodes);
      if (groups.length === 0) throw new Error('框选的图片、视频节点中没有可保存的素材');
      const totalCount = groups.reduce((total, group) => total + group.items.length, 0);
      setBatchSaveProgress({
        requestId: '',
        completedCount: 0,
        totalCount,
        savedCount: 0,
        failedCount: 0,
      });
      const result = await exportNodeMediaGroups(
        groups,
        '选择框选节点素材保存位置',
        setBatchSaveProgress,
      );
      setBatchSaveProgress(null);
      const message = batchMediaExportMessage(result);
      if (message) window.alert(message);
    } catch (error) {
      showBatchMediaExportError(error);
    } finally {
      setBatchSaveProgress(null);
    }
  }, [batchSaveProgress, contextMenu]);

  const handleSelectNodeType = useCallback(
    (type: CanvasNodeData['type']) => {
      if (type === 'region') {
        setNodeMenu(null);
        setContextMenu(null);
        useCanvasStore.getState().requestRegionDraw();
        return;
      }
      if (nodeMenu && reactFlowInstance) {
        const previousNodeIds = new Set(useCanvasStore.getState().nodes.map((node) => node.id));
        const flowPos = reactFlowInstance.screenToFlowPosition({
          x: nodeMenu.x,
          y: nodeMenu.y,
        });
        addNode(type, flowPos);
        const createdNode = [...useCanvasStore.getState().nodes].reverse().find(
          (node) => node.data.type === type && !previousNodeIds.has(node.id),
        );
        if (createdNode && nodeMenu.pendingConnection) {
          onConnect({
            source: nodeMenu.pendingConnection.sourceNodeId,
            sourceHandle: nodeMenu.pendingConnection.sourceHandleId,
            target: createdNode.id,
            targetHandle: getTargetHandleId(type),
          });
        }
        notifyTutorialNodeCreated({ nodeId: createdNode?.id, nodeType: type });
        setNodeMenu(null);
        setContextMenu(null);
      }
    },
    [nodeMenu, addNode, onConnect, reactFlowInstance]
  );

  useEffect(() => {
    if (!regionDrawRequested) return;
    useCanvasStore.getState().clearRegionDrawRequest();
    regionPickActiveRef.current = true;
    setRegionPickActive(true);
    setInteractionBusyNow(true);
    setNodeMenu(null);
    setContextMenu(null);
    syncFlowMovingVisual();
  }, [regionDrawRequested, setInteractionBusyNow, syncFlowMovingVisual]);

  useEffect(() => {
    if (!regionPickActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      exitRegionPick();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [regionPickActive, exitRegionPick]);

  // 右键按住 + 滚轮缩放画布
  useEffect(() => {
    const container = canvasRootRef.current;
    if (!container) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        isRightMouseRef.current = true;
        didScrollDuringRightHoldRef.current = false;
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) {
        isRightMouseRef.current = false;
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') isCtrlKeyRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') isCtrlKeyRef.current = false;
    };
    const onWindowBlur = () => {
      isCtrlKeyRef.current = false;
      isRightMouseRef.current = false;
    };
    const onWheel = (e: WheelEvent) => {
      const eventTarget = e.target instanceof Element ? e.target : null;
      if (!eventTarget || !container.contains(eventTarget)) return;
      const isCtrlZoom =
        e.ctrlKey ||
        e.metaKey ||
        e.getModifierState('Control') ||
        e.getModifierState('Meta') ||
        isCtrlKeyRef.current;
      if (!isRightMouseRef.current && !isCtrlZoom) return;
      if (!isCtrlZoom && eventTarget.closest('.nowheel')) return;
      if (isCtrlZoom && eventTarget.closest('input, textarea, select, [contenteditable="true"]')) return;
      const inst = reactFlowInstanceRef.current;
      if (!inst) return;
      e.preventDefault();
      e.stopPropagation();
      if (isRightMouseRef.current) didScrollDuringRightHoldRef.current = true;
      if (e.deltaY > 0) {
        inst.zoomOut({ duration: 80 });
      } else {
        inst.zoomIn({ duration: 80 });
      }
      if (isCtrlZoom) notifyTutorialCanvasInteraction('ctrl-wheel-zoom');
    };
    const onContextMenu = (e: MouseEvent) => {
      if (didScrollDuringRightHoldRef.current) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        didScrollDuringRightHoldRef.current = false;
      }
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    container.addEventListener('contextmenu', onContextMenu, true);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('wheel', onWheel, true);
      container.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, []);

  const handleArrangeCanvas = useCallback(() => {
    const instance = reactFlowInstanceRef.current || reactFlowInstance;
    const stateNodes = useCanvasStore.getState().nodes;
    const rfLive = instance?.getNodes() as Node<CanvasNodeData>[] | undefined;
    const currentNodes =
      rfLive && rfLive.length > 0
        ? stateNodes.map((sn) => {
            const live = rfLive.find((n) => n.id === sn.id);
            if (!live) return sn;
            const measured = (live as Node<CanvasNodeData> & {
              measured?: { width?: number; height?: number };
            }).measured;
            return {
              ...sn,
              position: live.position,
              width: live.width ?? sn.width,
              height: live.height ?? sn.height,
              ...(measured ? { measured } : {}),
            } as Node<CanvasNodeData>;
          })
        : stateNodes;
    const currentEdges = instance?.getEdges() || storeEdges;
    if (currentNodes.length === 0) return;

    const arrangedNodes = layoutCanvasNodes(currentNodes, currentEdges);
    const arrangedFlowNodes = withExpandedNodeZIndex(
      withCollapsibleNodeFlowDimensions(arrangedNodes, flowExpandedNodeId),
      selectedNodeId
    );
    useCanvasStore.getState().pushUndoSnapshot();
    instance?.setNodes(arrangedFlowNodes);
    setStoreNodes(arrangedNodes);
    setNodeMenu(null);
    setContextMenu(null);

    window.requestAnimationFrame(() => {
      if (instance) {
        const ids = instance.getNodes().map((n) => n.id);
        if (ids.length) updateNodeInternals(ids);
      }
      window.requestAnimationFrame(() => {
        instance?.fitView({ padding: 0.18, duration: mcF(21) });
        window.setTimeout(() => {
          if (instance) {
            commitZoomDisplay(instance.getZoom());
          }
        }, mcF(23));
      });
    });
  }, [
    commitZoomDisplay,
    flowExpandedNodeId,
    reactFlowInstance,
    selectedNodeId,
    setStoreNodes,
    storeEdges,
    updateNodeInternals,
  ]);

  const handleInit = useCallback(
    (instance: ReactFlowInstance) => {
      reactFlowInstanceRef.current = instance;
      setCanvasRfGetNodes(() => instance.getNodes());
      setReactFlowInstance(instance);
      syncCanvasDotGrid(instance.getViewport());
      commitZoomDisplay(instance.getZoom());
      /* 首帧后重算连线锚点：避免在场景层 scale(入场) 下测得的 handleBounds 与后续坐标系不一致 */
      window.requestAnimationFrame(() => {
        const ids = instance.getNodes().map((n) => n.id);
        if (ids.length) updateNodeInternals(ids);
      });
    },
    [commitZoomDisplay, syncCanvasDotGrid, updateNodeInternals]
  );

  const handleZoomOut = useCallback(() => {
    const instance = reactFlowInstanceRef.current || reactFlowInstance;
    if (!instance) return;
    instance.zoomOut({ duration: mcF(11) });
    window.setTimeout(() => commitZoomDisplay(instance.getZoom()), mcF(14));
  }, [commitZoomDisplay, reactFlowInstance]);

  const handleZoomIn = useCallback(() => {
    const instance = reactFlowInstanceRef.current || reactFlowInstance;
    if (!instance) return;
    instance.zoomIn({ duration: mcF(11) });
    window.setTimeout(() => commitZoomDisplay(instance.getZoom()), mcF(14));
  }, [commitZoomDisplay, reactFlowInstance]);

  const handleFitCanvas = useCallback(() => {
    const instance = reactFlowInstanceRef.current || reactFlowInstance;
    if (!instance) return;
    instance.fitView({ padding: 0.2, duration: mcF(16) });
    window.setTimeout(() => commitZoomDisplay(instance.getZoom()), mcF(18));
  }, [commitZoomDisplay, reactFlowInstance]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    const types = Array.from(event.dataTransfer.types);
    if (
      types.includes(GENERATED_IMAGE_DND_TYPE)
      || types.includes(GENERATED_VIDEO_DND_TYPE)
      || types.includes(GENERATED_AUDIO_DND_TYPE)
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      const rawImage = event.dataTransfer.getData(GENERATED_IMAGE_DND_TYPE);
      const rawVideo = event.dataTransfer.getData(GENERATED_VIDEO_DND_TYPE);
      const rawAudio = event.dataTransfer.getData(GENERATED_AUDIO_DND_TYPE);
      if ((!rawImage && !rawVideo && !rawAudio) || !reactFlowInstance) return;

      event.preventDefault();
      event.stopPropagation();

      try {
        const flowPos = reactFlowInstance.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        if (rawVideo) {
          const payload = JSON.parse(rawVideo) as GeneratedVideoDragPayload;
          if (!payload.videoUrl) return;
          const fileName = payload.fileName || 'generated-video.mp4';
          addNodeWithData('material', flowPos, {
            label: '素材',
            fileUrl: payload.videoUrl,
            thumbnailUrl: payload.posterUrl,
            fileName,
            fileType: 'video',
            mentionSlug: makeGeneratedVideoSlug(fileName),
          });
          return;
        }

        if (rawAudio) {
          const payload = JSON.parse(rawAudio) as GeneratedAudioDragPayload;
          if (!payload.audioUrl) return;
          const fileName = payload.fileName || 'generated-audio.mp3';
          addNodeWithData('material', flowPos, {
            label: '素材',
            fileUrl: payload.audioUrl,
            fileName,
            fileType: 'audio',
            mentionSlug: makeGeneratedAudioSlug(fileName),
          });
          return;
        }

        const payload = JSON.parse(rawImage) as GeneratedImageDragPayload;
        if (!payload.imageUrl) return;
        const fileName = payload.fileName || 'generated-image.png';
        const mediaWidth = Number(payload.mediaWidth);
        const mediaHeight = Number(payload.mediaHeight);
        const hasMediaAspect = mediaWidth > 0 && mediaHeight > 0;
        const displaySize = hasMediaAspect
          ? materialNodeDisplaySize('image', mediaWidth, mediaHeight)
          : undefined;

        addNodeWithData('material', flowPos, {
          label: '素材',
          fileUrl: payload.imageUrl,
          thumbnailUrl: payload.thumbnailUrl,
          fileName,
          fileType: 'image',
          mentionSlug: makeGeneratedImageSlug(fileName),
          materialAspectW: hasMediaAspect ? mediaWidth : undefined,
          materialAspectH: hasMediaAspect ? mediaHeight : undefined,
          materialWidth: displaySize?.width,
          materialHeight: displaySize?.height,
        });
      } catch (error) {
        console.error('Failed to create material from generated media:', error);
      }
    },
    [addNodeWithData, reactFlowInstance]
  );

  const handleNodeDoubleClick = useCallback(() => {
    /* 节点上双击交给节点自身，不弹出画布菜单 */
  }, []);

  const getContextFlowPosition = useCallback(() => {
    return contextMenu?.flowPosition || { x: 250, y: 200 };
  }, [contextMenu]);

  const handleContextUpload = useCallback(() => {
    addNodeWithData('material', getContextFlowPosition(), {
      label: '素材',
    });
  }, [addNodeWithData, getContextFlowPosition]);

  const handleContextAddNode = useCallback(() => {
    if (!contextMenu) return;
    setNodeMenu({ x: contextMenu.x, y: contextMenu.y });
  }, [contextMenu]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (isNativeTextUndoTarget(el)) return;
      const selected = useCanvasStore.getState().selectedNode;
      const selectedType = selected?.type || selected?.data.type;
      if (
        selectedType === 'storyboard'
        && (e.ctrlKey || e.metaKey)
        && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          useCanvasStore.getState().redo();
        } else {
          useCanvasStore.getState().undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useCanvasStore.getState().redo();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Fit a newly mounted project once; the keyed Canvas drops stale viewport/media state.
  useEffect(() => {
    if (entrancePhase < 2) return;
    if (reactFlowInstance && storeNodes.length > 0) {
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.2 });
      }, 100);
    }
  }, [reactFlowInstance, storeNodes.length, entrancePhase]);

  /* 入场镜头结束（场景层 scale 回到 1）后强制刷新手柄测量，否则边锚点会整体偏移 */
  useEffect(() => {
    if (entrancePhase < 2 || !reactFlowInstance) return;
    const refresh = () => {
      const inst = reactFlowInstanceRef.current ?? reactFlowInstance;
      const ids = inst.getNodes().map((n) => n.id);
      if (ids.length) updateNodeInternals(ids);
    };
    const raf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(refresh);
    });
    const tid = window.setTimeout(refresh, 1200);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(tid);
    };
  }, [entrancePhase, reactFlowInstance, storeNodes.length, updateNodeInternals]);

  useEffect(() => {
    if (!reactFlowInstance) return;

    const layoutSame = prevFlowLayoutSigRef.current === flowLayoutSig;
    const dataChangedIds = changedStoreNodeDataIds(storeNodes, prevStoreDataByIdRef.current);
    const structureChanged = storeNodes.length !== prevStoreDataByIdRef.current.size;
    const nextLayoutById = new Map(
      nodesForFlow.map((node) => [node.id, canvasNodeLayoutValueSig(node)]),
    );
    const layoutChangedIds = nodesForFlow
      .filter((node) => prevFlowLayoutByIdRef.current.get(node.id) !== nextLayoutById.get(node.id))
      .map((node) => node.id);

    // 点画布等仅更新 node.selected 时 store 会换新引用，但布局与 data 引用不变，避免 setNodes 造成整表跳闪
    if (
      !isNodeDraggingRef.current
      && !isFlowLayoutCommitRef.current
      && (!layoutSame || structureChanged || dataChangedIds.length > 0)
    ) {
      prevFlowLayoutSigRef.current = flowLayoutSig;
      prevFlowLayoutByIdRef.current = nextLayoutById;
      prevStoreDataByIdRef.current = new Map(storeNodes.map((n) => [n.id, n.data]));
      reactFlowInstance.setNodes(nodesForFlow as Node<CanvasNodeData>[]);

      const internalsIds = [...new Set([...layoutChangedIds, ...dataChangedIds])];
      if (internalsIds.length > 0) {
        window.requestAnimationFrame(() => updateNodeInternals(internalsIds));
      }
    }
  }, [reactFlowInstance, storeNodes, flowLayoutSig, nodesForFlow, updateNodeInternals]);

  useEffect(() => {
    if (!reactFlowInstance || !selectedNodeId || entrancePhase < 2) return;

    let outerFrame: number | null = null;
    let innerFrame: number | null = null;
    let panelRetryTimer: number | null = null;
    const selectedNode = useCanvasStore.getState().nodes.find((node) => node.id === selectedNodeId);
    if (!selectedNode) return;

    const focusSelection = () => {
      const instance = reactFlowInstanceRef.current ?? reactFlowInstance;
      const nodeType = selectedNode.data.type || selectedNode.type;

      if (nodeType && SCREEN_SPACE_EXPANDED_NODE_TYPES.has(nodeType)) {
        const renderedNode = [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
          .find((element) => element.dataset.id === selectedNodeId);
        const editPanel = [...document.querySelectorAll<HTMLElement>('[data-screen-space-node-id]')]
          .find((element) => element.dataset.screenSpaceNodeId === selectedNodeId);

        if (!renderedNode || !editPanel) return false;
        const nodeRect = renderedNode.getBoundingClientRect();
        const panelRect = editPanel.getBoundingClientRect();
        const groupCenter = {
          x: (Math.min(nodeRect.left, panelRect.left) + Math.max(nodeRect.right, panelRect.right)) / 2,
          y: (Math.min(nodeRect.top, panelRect.top) + Math.max(nodeRect.bottom, panelRect.bottom)) / 2,
        };
        const flowCenter = instance.screenToFlowPosition(groupCenter);
        void instance.setCenter(flowCenter.x, flowCenter.y, {
          zoom: Math.min(instance.getZoom(), 0.92),
          duration: 520,
        });
        return true;
      }

      const focusMaxZoom = Math.min(instance.getZoom(), 0.92);
      void instance.fitView({
        nodes: [{ id: selectedNodeId }],
        padding: 0.14,
        minZoom: Math.min(focusMaxZoom, 0.28),
        maxZoom: focusMaxZoom,
        duration: 520,
      });
      return true;
    };

    outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        if (!focusSelection()) {
          panelRetryTimer = window.setTimeout(focusSelection, 80);
        }
      });
    });

    return () => {
      if (outerFrame !== null) window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
      if (panelRetryTimer !== null) window.clearTimeout(panelRetryTimer);
    };
  }, [entrancePhase, reactFlowInstance, selectedNodeId]);

  useEffect(
    () => () => {
      if (dragStopSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(dragStopSyncFrameRef.current);
      }
      flowLayoutCommitSeqRef.current += 1;
      panVisualSeqRef.current += 1;
      isFlowLayoutCommitRef.current = false;
      if (regionBandRafRef.current !== null) {
        window.cancelAnimationFrame(regionBandRafRef.current);
        regionBandRafRef.current = null;
      }
      if (interactionIdleTimerRef.current !== null) {
        clearTimeout(interactionIdleTimerRef.current);
      }
      if (edgePaneFadeTimerRef.current !== null) {
        clearTimeout(edgePaneFadeTimerRef.current);
      }
      if (edgeDissolveTimerRef.current !== null) {
        clearTimeout(edgeDissolveTimerRef.current);
        edgeDissolveTimerRef.current = null;
      }
      const pendingEdgeRemovals = pendingEdgeRemovalsRef.current;
      pendingEdgeRemovalsRef.current = [];
      if (pendingEdgeRemovals.length > 0) {
        useCanvasStore.getState().onEdgesChange(pendingEdgeRemovals.map((id) => ({ type: 'remove', id })));
      }
      nodeResizerLiveRef.current = false;
      setCanvasRfGetNodes(null);
      const root = canvasRootRef.current;
      root?.classList.remove('is-flow-moving', 'is-flow-moving-pan', 'is-flow-moving-nodes');
      root?.removeAttribute('data-mc-zoom-sharp');
      zoomSharpLowRef.current = null;
      setCanvasInteractionBusy(false);
    },
    []
  );

  return (
    <div
      ref={canvasRootRef}
      data-mc-performance-profile={performance.profile}
      data-mc-gpu-lite={effectiveGpuLite ? 'true' : 'false'}
      className={cn(
        'flow-drag-performance mc-canvas-shell mc-canvas-performance h-full w-full',
        entrancePhase === 0 && 'mc-canvas-entrance--pull',
        entrancePhase < 2 && 'overflow-hidden'
      )}
    >
      {batchSaveProgress ? (() => {
        const totalCount = Math.max(1, batchSaveProgress.totalCount);
        const completedCount = Math.min(totalCount, Math.max(0, batchSaveProgress.completedCount));
        const percent = Math.min(100, Math.round((completedCount / totalCount) * 100));
        return (
          <div
            className="pointer-events-none absolute left-1/2 top-3 z-[80] w-[min(520px,calc(100%-32px))] -translate-x-1/2 rounded-xl border border-white/14 bg-[#15191a]/96 px-4 py-3 text-zinc-100 shadow-[0_18px_48px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl"
            role="status"
            aria-live="polite"
            aria-label={`批量保存中，已处理 ${completedCount} 个，共 ${totalCount} 个`}
          >
            <div className="mb-2 flex items-center justify-between gap-4 text-xs font-medium">
              <span className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300 motion-reduce:animate-none" aria-hidden />
                批量保存中
              </span>
              <span className="tabular-nums text-zinc-300">
                {completedCount}/{totalCount} · {percent}%
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="批量保存进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-1.5 overflow-hidden rounded-full bg-white/10"
            >
              <div
                className="h-full rounded-full bg-cyan-300 transition-[width] duration-200 ease-out motion-reduce:transition-none"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        );
      })() : null}
      <div className="mc-canvas-entrance-scene-inner absolute inset-0 overflow-hidden">
        {/* 独立点阵层：勿画在 ::before 上（mc-canvas-performance 会把伪元素 opacity 压到 0.38）；勿用亚像素点 */}
        <div ref={dotGridRef} className="mc-canvas-dot-grid" aria-hidden />
        <ReactFlow
          className="mc-react-flow !cursor-default"
          defaultNodes={nodesForFlow}
          edges={edgesForRf}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onNodeDragStart={handleNodeDragStart}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onSelectionDragStart={handleSelectionDragStart}
          onSelectionDrag={handleSelectionDrag}
          onSelectionDragStop={handleSelectionDragStop}
          onMoveStart={handleMoveStart}
          onMove={handleViewportMove}
          onMoveEnd={handleMoveEnd}
          onNodeDoubleClick={handleNodeDoubleClick}
          onPaneClick={handlePaneClick}
          onPaneContextMenu={openContextMenu}
          onNodeContextMenu={openContextMenu}
          onSelectionContextMenu={openContextMenu}
          onDoubleClick={handlePaneDoubleClick}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onInit={handleInit}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          snapToGrid={false}
          defaultEdgeOptions={defaultEdgeOptions}
          minZoom={0.1}
          maxZoom={2}
          selectionMode={SelectionMode.Partial}
          onlyRenderVisibleElements
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect={false}
          nodesFocusable={false}
          edgesFocusable={false}
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          panOnScroll={false}
          panOnDrag={[1]}
          selectionOnDrag
          multiSelectionKeyCode={['Control', 'Meta']}
          autoPanOnNodeDrag={false}
          autoPanOnConnect={false}
          proOptions={proOptions}
        >
          <Panel position="bottom-center" className="!mb-8">
            <div
              className={cn(
                chromeReveal
                  ? cn('translate-y-0 scale-100 origin-bottom visible', MC_CHROME_ENTRANCE_TF)
                  : cn(
                      'translate-y-[110vh]',
                      MC_CHROME_ENTRANCE_SCALE_START,
                      'origin-bottom invisible pointer-events-none transition-none'
                    )
              )}
            >
              <div
                data-tutorial-id="canvas-zoom-controls"
                className={cn(
                  'nodrag nopan nowheel flex h-16 items-center gap-3 rounded-[22px] border border-white/12 px-4 text-zinc-200 shadow-[0_28px_76px_rgba(0,0,0,0.46),inset_0_1px_0_rgba(255,255,255,0.08)]',
                  effectiveGpuLite ? 'bg-[#1b2021]' : 'bg-[#1b2021]/74 backdrop-blur-2xl'
                )}
              >
            <button
              type="button"
              onClick={handleZoomOut}
              title="缩小"
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-white/6 text-zinc-200',
                MC_CANVAS_CHROME_ICON_HOVER
              )}
            >
              <Minus className="h-5 w-5" />
            </button>
            <div className="min-w-[76px] text-center text-[15px] font-medium text-zinc-100">
              {Math.round(zoom * 100)}%
            </div>
            <button
              type="button"
              onClick={handleZoomIn}
              title="放大"
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-white/6 text-zinc-200',
                MC_CANVAS_CHROME_ICON_HOVER
              )}
            >
              <Plus className="h-5 w-5" />
            </button>

            <div className="mx-2 h-8 w-px bg-white/10" />

            <button
              type="button"
              onClick={handleArrangeCanvas}
              title="一键整理画布"
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/7 text-zinc-200',
                MC_CANVAS_CHROME_ICON_HOVER
              )}
            >
              <Grid3X3 className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleFitCanvas}
              title="适配视图"
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/7 text-zinc-200',
                MC_CANVAS_CHROME_ICON_HOVER
              )}
            >
              <Maximize2 className="h-5 w-5" />
            </button>
            {onGpuLiteToggle && (
              <button
                type="button"
                onClick={onGpuLiteToggle}
                title={
                  effectiveGpuLite
                    ? '省 GPU 已开（关模糊 / 关小地图 / 关边光效），点此恢复全特效'
                    : '点此开启省 GPU（核显推荐）'
                }
                className={cn(
                  'ml-0.5 flex h-11 w-11 items-center justify-center rounded-2xl border text-zinc-200 transition-colors',
                  effectiveGpuLite
                    ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/22'
                    : cn('border-white/8 bg-white/7', MC_CANVAS_CHROME_ICON_HOVER)
                )}
              >
                <Cpu className="h-5 w-5" />
              </button>
            )}
          </div>
            </div>
        </Panel>
        {!effectiveGpuLite && (
          <MiniMap
            position="bottom-left"
            pannable
            nodeColor={minimapNodeColor}
            maskColor="rgba(3, 7, 18, 0.58)"
            className={cn(
              '!mb-[7.5rem] !ml-7 !rounded-[22px] origin-bottom-left',
              chromeReveal
                ? cn('translate-x-0 translate-y-0 scale-100 visible', MC_CHROME_ENTRANCE_TF)
                : cn(
                    'translate-x-[110vw] translate-y-[110vh]',
                    MC_CHROME_ENTRANCE_SCALE_START,
                    'invisible pointer-events-none transition-none'
                  )
            )}
            style={{
              backgroundColor: 'rgba(27, 32, 33, 0.94)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '22px',
              boxShadow: '0 18px 48px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          />
        )}
      </ReactFlow>
        <div className="pointer-events-none absolute inset-0 z-[12] overflow-hidden" aria-hidden>
          <div
            ref={verticalAlignmentGuideRef}
            data-canvas-alignment-guide="vertical"
            className="mc-node-alignment-guide mc-node-alignment-guide--vertical"
          />
          <div
            ref={horizontalAlignmentGuideRef}
            data-canvas-alignment-guide="horizontal"
            className="mc-node-alignment-guide mc-node-alignment-guide--horizontal"
          />
        </div>
        {regionPickActive ? (
          <div
            className="absolute inset-0 z-[45] cursor-crosshair touch-none bg-black/15"
            onPointerDown={handleRegionOverlayPointerDown}
            onPointerMove={handleRegionOverlayPointerMove}
            onPointerUp={handleRegionOverlayPointerUp}
            onPointerCancel={handleRegionOverlayPointerCancel}
          >
            {regionBand && regionBand.w > 0 && regionBand.h > 0 ? (
              <div
                className="pointer-events-none fixed rounded-md border border-white/35 bg-white/[0.08] shadow-[0_0_24px_rgba(255,255,255,0.12)]"
                style={{
                  left: regionBand.x,
                  top: regionBand.y,
                  width: regionBand.w,
                  height: regionBand.h,
                }}
              />
            ) : null}
            <div className="pointer-events-none fixed left-1/2 top-6 z-[1] max-w-[min(92vw,420px)] -translate-x-1/2 rounded-lg border border-white/12 bg-[#1b2021]/92 px-4 py-2 text-center text-xs leading-snug text-zinc-200 shadow-lg backdrop-blur-xl">
              按住拖拽框选区域，松开完成
              <span className="text-zinc-500"> · </span>
              Esc 取消
            </div>
          </div>
        ) : null}
      </div>

      {/* Node Selection Menu */}
      {nodeMenu && (
        <NodeMenu
          position={nodeMenu}
          onSelect={handleSelectNodeType}
          onClose={() => setNodeMenu(null)}
          allowedTypes={nodeMenu.pendingConnection ? CONNECTABLE_TARGET_NODE_TYPES : undefined}
        />
      )}
      {contextMenu && (
        <CanvasContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onUpload={handleContextUpload}
          onAddNode={handleContextAddNode}
          canSaveWorkflowPreset={contextMenu.selectedNodeIds.length > 0}
          onSaveWorkflowPreset={handleOpenSaveWorkflowPreset}
          canBatchSaveMedia={contextMenu.selectedNodeIds.some((nodeId) => {
            const node = storeNodes.find((candidate) => candidate.id === nodeId);
            const type = node?.data.type || node?.type;
            return type === 'image' || type === 'video';
          })}
          onBatchSaveMedia={handleBatchSaveSelectedMedia}
          onArrangeCanvas={handleArrangeCanvas}
        />
      )}
      {workflowPresetDraft && (
        <SaveWorkflowPresetDialog
          initialName={workflowPresetDraft.template.name}
          nodeCount={workflowPresetDraft.nodeCount}
          onCancel={() => setWorkflowPresetDraft(null)}
          onSave={handleConfirmSaveWorkflowPreset}
        />
      )}
    </div>
  );
}

// 包装组件，提供 ReactFlowProvider
type CanvasProps = {
  /** 默认 true：减弱模糊、动画与小地图以降低核显占用 */
  gpuLite?: boolean;
  onGpuLiteToggle?: () => void;
  entrancePhase?: 0 | 1 | 2;
  chromeReveal?: boolean;
};

export default function Canvas({
  gpuLite = true,
  onGpuLiteToggle,
  entrancePhase = 2,
  chromeReveal = true,
}: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner
        gpuLite={gpuLite}
        onGpuLiteToggle={onGpuLiteToggle}
        entrancePhase={entrancePhase}
        chromeReveal={chromeReveal}
      />
    </ReactFlowProvider>
  );
}
