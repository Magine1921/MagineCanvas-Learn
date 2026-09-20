import { MarkerType, Node, Edge, Connection, OnNodesChange, OnEdgesChange, OnConnect, applyNodeChanges, applyEdgeChanges } from 'reactflow';
import { startTransition } from 'react';
import { flushSync } from 'react-dom';
import { create } from 'zustand';
import { isEditionNodeTypeDisabled } from '@/lib/edition';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { appendBeamConnectionsFromSources } from '@/lib/canvasMultiConnect';
import { getCanvasRfNodesOrFallback } from '@/lib/canvasRfNodesBridge';
import {
  applyRegionReparenting,
  attachUnparentedNodesOverlappingRegion,
  getAbsoluteTopLeft,
  sortNodesParentsFirst,
} from '@/lib/region-reparent';
import { shrinkWorkflowForLocalStorage, stripLargeDataUrlsDeep } from '@/lib/shrink-workflow-for-storage';
import {
  deleteMaterialBlob,
  deleteMaterialBlobsExcept,
  putMaterialBlob,
} from '@/lib/canvas-material-idb';
import { hydrateMaterialIdbRefsInNodes, offloadMaterialDataUrlsForPersist } from '@/lib/canvas-persist-material-offload';
import {
  hydratePanoramaDiskRefsInNodes,
  offloadPanoramaTexForPersist,
} from '@/lib/canvas-persist-panorama-offload';
import {
  hydrateImageVideoDiskRefs,
  offloadImageVideoForPersist,
} from '@/lib/canvas-persist-image-video-offload';
import {
  hydrateAudioIdbRefsInNodes,
  offloadAudioForPersist,
} from '@/lib/canvas-persist-audio-offload';
import {
  deleteMaterialProjectDiskCache,
  postMaterialToProjectDiskCache,
  postVideoToProjectDiskCache,
} from '@/lib/sync-material-project-disk-cache';
import { deletePanoramaProjectDiskCache } from '@/lib/sync-panorama-project-disk-cache';
import {
  canvasNodeChangeRecordsUndo,
  canvasNodeDataPatchRecordsUndo,
  canvasNodeDataUndoBurstKey,
} from '@/lib/canvas-undo';
import { changedNodeDataPatch } from '@/lib/node-data-patch';

// 节点数据类型
export interface CanvasNodeData {
  label: string;
  type:
    | 'prompt'
    | 'llm'
    | 'image'
    | 'video'
    | 'agent'
    | 'material'
    | 'region'
    | 'storyboard'
    | 'panorama'
    | 'topazEnhance'
    | 'faceCompliance'
    | 'music'
    | 'browser';
  [key: string]: unknown;
}

// NodeChange 和 EdgeChange 的类型
export type NodeChange = Parameters<OnNodesChange>[0];
export type EdgeChange = Parameters<OnEdgesChange>[0];

interface CanvasState {
  // React Flow 状态
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  selectedNode: Node<CanvasNodeData> | null;

  // 预计算索引：source node id → target node ids（O(1) 查下游，消除 N 节点×E 边的 O(N²) 扫描）
  downstreamNodeIdsBySource: Record<string, string[]>;
  _rebuildDownstreamIndex: () => void;

  // 节点生成成功闪烁
  glowingNodeIds: string[];
  addGlowingNode: (nodeId: string) => void;
  clearGlowingNode: (nodeId: string) => void;

  // 节点操作
  setNodes: (nodes: Node<CanvasNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  // 增删改节点
  addNode: (type: CanvasNodeData['type'], position?: { x: number; y: number }) => void;
  addNodeWithData: (
    type: CanvasNodeData['type'],
    position: { x: number; y: number },
    data: Partial<CanvasNodeData>,
    options?: { captureEntrance?: boolean; syncCommit?: boolean }
  ) => string;
  addRegionNode: (args: {
    position: { x: number; y: number };
    width: number;
    height: number;
    regionName?: string;
  }) => void;
  /** 侧栏 / 节点菜单选择「区域命名」后由画布消费，进入框选模式 */
  regionDrawRequested: boolean;
  requestRegionDraw: () => void;
  clearRegionDrawRequest: () => void;
  removeNode: (nodeId: string) => void;
  /** `recordUndo: false`：不写入全局撤销栈（如分镜笔划自有撤销，避免每笔记深拷整图） */
  updateNodeData: (
    nodeId: string,
    data: Partial<CanvasNodeData>,
    options?: { recordUndo?: boolean }
  ) => void;
  updateRegionGeometry: (
    nodeId: string,
    payload: { x: number; y: number; width: number; height: number }
  ) => void;
  updateStoryboardGeometry: (
    nodeId: string,
    payload: { x: number; y: number; width: number; height: number }
  ) => void;
  updatePanoramaGeometry: (
    nodeId: string,
    payload: { x: number; y: number; width: number; height: number }
  ) => void;
  updateAgentGeometry: (
    nodeId: string,
    payload: { x: number; y: number; width: number; height: number }
  ) => void;
  updateBrowserGeometry: (
    nodeId: string,
    payload: { x: number; y: number; width: number; height: number }
  ) => void;
  updateTopazEnhanceGeometry: (
    nodeId: string,
    payload: { x: number; y: number; width: number; height: number },
    options?: { recordUndo?: boolean }
  ) => void;
  updateMaterialGeometry: (
    nodeId: string,
    payload: { x: number; y: number; width: number; height: number },
    options?: { recordUndo?: boolean }
  ) => void;
  setSelectedNode: (node: Node<CanvasNodeData> | null) => void;

  // 工作流操作
  saveWorkflow: () => { nodes: Node<CanvasNodeData>[]; edges: Edge[] };
  loadWorkflow: (data: { nodes: Node<CanvasNodeData>[]; edges: Edge[] }) => void;
  clearCanvas: () => void;

  past: CanvasSnapshot[];
  future: CanvasSnapshot[];
  historyRevision: number;
  pushUndoSnapshot: () => void;
  undo: () => void;
  redo: () => void;
}

type PersistedCanvasState = Pick<CanvasState, 'nodes' | 'edges'>;

type CanvasSnapshot = { nodes: Node<CanvasNodeData>[]; edges: Edge[] };

/** 控制内存：整图深拷 × 档数，过大易 OOM；与 lighten 快照配合 */
const MAX_CANVAS_UNDO = 15;
const MAX_CANVAS_UNDO_BALANCED = 8;
const MAX_CANVAS_UNDO_DENSE = 4;

/** updateNodeData 高频合并窗口（毫秒） */
const UPDATE_NODE_DATA_BURST_MS = 1600;

const MAX_AGENT_CHAT_MESSAGES_IN_UNDO = 72;
const MAX_AGENT_MESSAGE_CHARS_IN_UNDO = 40_000;
const MAX_AGENT_ATTACHMENT_DATA_URL_IN_UNDO = 96_000;
const MAX_PANORAMA_TEX_HISTORY_IN_UNDO = 10;
const MAX_AGENT_OUTPUT_CHARS_IN_UNDO = 120_000;

/**
 * 写入 past/future 前的快照瘦身：仍 JSON 深拷，再裁 Agent 对话条数/正文、裁全景纹理历史条数、去掉超大附件 data URL，
 * 降低「撤销栈 × 整图」内存放大。素材主 fileUrl 等不在此清空（避免全局撤销丢图），依赖 persist offload + 降档数。
 */
function lightenNodesForUndoSnapshot(nodes: Node<CanvasNodeData>[]): void {
  for (const node of nodes) {
    if (!node.data || typeof node.data !== 'object') continue;
    const d = node.data as Record<string, unknown>;

    if (node.type === 'agent') {
      const h = d.agentChatHistory;
      if (Array.isArray(h)) {
        const tail =
          h.length > MAX_AGENT_CHAT_MESSAGES_IN_UNDO ? h.slice(-MAX_AGENT_CHAT_MESSAGES_IN_UNDO) : h;
        d.agentChatHistory = tail.map((msg: unknown) => {
          if (!msg || typeof msg !== 'object') return msg;
          const m = msg as Record<string, unknown>;
          const next: Record<string, unknown> = { ...m };
          const c = m.content;
          if (typeof c === 'string' && c.length > MAX_AGENT_MESSAGE_CHARS_IN_UNDO) {
            next.content = `${c.slice(0, MAX_AGENT_MESSAGE_CHARS_IN_UNDO)}\n…[快照截断]`;
          }
          const atts = m.attachments;
          if (Array.isArray(atts)) {
            next.attachments = atts.map((a: unknown) => {
              if (!a || typeof a !== 'object') return a;
              const att = a as Record<string, unknown>;
              const u = att.url;
              if (
                typeof u === 'string' &&
                u.startsWith('data:') &&
                u.length > MAX_AGENT_ATTACHMENT_DATA_URL_IN_UNDO
              ) {
                return { ...att, url: '' };
              }
              return a;
            });
          }
          return next;
        });
      }
      const out = d.output;
      if (typeof out === 'string' && out.length > MAX_AGENT_OUTPUT_CHARS_IN_UNDO) {
        d.output = `${out.slice(0, MAX_AGENT_OUTPUT_CHARS_IN_UNDO)}\n…[快照截断]`;
      }
    }

    if (node.type === 'panorama') {
      const th = d.panoramaTexHistory;
      if (Array.isArray(th) && th.length > MAX_PANORAMA_TEX_HISTORY_IN_UNDO) {
        d.panoramaTexHistory = th.slice(-MAX_PANORAMA_TEX_HISTORY_IN_UNDO);
      }
    }
  }
}

function cloneWorkflowForUndo(nodes: Node<CanvasNodeData>[], edges: Edge[]): CanvasSnapshot {
  const clone = <T,>(value: T): T => {
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(value);
      } catch {
        // Fall back for transient browser values that cannot be structured-cloned.
      }
    }
    return JSON.parse(JSON.stringify(value)) as T;
  };
  const snapshot: CanvasSnapshot = {
    nodes: clone(nodes),
    edges: clone(edges),
  };
  lightenNodesForUndoSnapshot(snapshot.nodes);
  return snapshot;
}

function undoLimitForNodeCount(nodeCount: number): number {
  if (nodeCount >= 180) return MAX_CANVAS_UNDO_DENSE;
  if (nodeCount >= 60) return MAX_CANVAS_UNDO_BALANCED;
  return MAX_CANVAS_UNDO;
}

function trimUndoSnapshots(snapshots: CanvasSnapshot[], nodeCount: number): CanvasSnapshot[] {
  return snapshots.slice(-undoLimitForNodeCount(nodeCount));
}

function appendUndoSnapshot(
  past: CanvasSnapshot[],
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
): CanvasSnapshot[] {
  return trimUndoSnapshots([...past, cloneWorkflowForUndo(nodes, edges)], nodes.length);
}

function shouldRecordNodesChange(changes: NodeChange): boolean {
  // Adds, resets and dimensions mirror store-driven changes from React Flow.
  // User resizing already records history through update*Geometry.
  return changes.some((change) => canvasNodeChangeRecordsUndo(change.type));
}

function shouldRecordEdgesChange(changes: EdgeChange): boolean {
  return changes.some((c) => c.type === 'remove');
}

let updateNodeDataBurstKey: string | null = null;
let updateNodeDataBurstTimer: ReturnType<typeof setTimeout> | null = null;
let historyRestoreGuardUntil = 0;
let canvasAuthorityRevision = 0;
let workflowLoadRevision = 0;

function beginHistoryRestoreGuard(): void {
  historyRestoreGuardUntil = Date.now() + 250;
}

function isHistoryRestoreGuardActive(): boolean {
  return Date.now() < historyRestoreGuardUntil;
}

function beginWorkflowLoad(): number {
  canvasAuthorityRevision += 1;
  workflowLoadRevision += 1;
  return workflowLoadRevision;
}

function invalidatePendingWorkflowLoad(): void {
  canvasAuthorityRevision += 1;
  workflowLoadRevision += 1;
}

function resetUpdateNodeDataBurst() {
  updateNodeDataBurstKey = null;
  if (updateNodeDataBurstTimer !== null) {
    clearTimeout(updateNodeDataBurstTimer);
    updateNodeDataBurstTimer = null;
  }
}

// 生成唯一 ID
const generateId = () => `node_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

function createCanvasNode(
  type: CanvasNodeData['type'],
  position: { x: number; y: number },
  data?: Partial<CanvasNodeData>,
  overrides?: Partial<Node<CanvasNodeData>>
): Node<CanvasNodeData> {
  const base: Node<CanvasNodeData> = {
    id: generateId(),
    type,
    position,
    data: {
      ...(getDefaultNodeData(type) as CanvasNodeData),
      ...data,
      type,
    },
  };
  return { ...base, ...overrides };
}

function createDebouncedJSONStorage<T>(delay = 0): PersistStorage<T> {
  let pendingKey: string | null = null;
  let pendingValue: StorageValue<T> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writeInFlight = false;
  let listenersAttached = false;

  const getStorage = () => {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  };

  const isDesktopProjectStorageActive = () =>
    typeof window !== 'undefined' &&
    Boolean((window as Window & { magineDesktop?: { isDesktop?: boolean } }).magineDesktop?.isDesktop);

  const isInteractionBusy = () =>
    typeof window !== 'undefined' &&
    Boolean((window as Window & { __magineCanvasInteractionBusy?: boolean }).__magineCanvasInteractionBusy);

  const writePersistPayload = async (key: string, wrapped: StorageValue<PersistedCanvasState>) => {
    const storage = getStorage();
    if (!storage) return;
    const st = wrapped.state;
    if (!st?.nodes) {
      storage.setItem(key, JSON.stringify(wrapped));
      return;
    }
    const shrunk = shrinkWorkflowForLocalStorage({
      nodes: st.nodes,
      edges: st.edges || [],
    });
    const offloadedMat = await offloadMaterialDataUrlsForPersist(shrunk);
    const offloadedPan = await offloadPanoramaTexForPersist(offloadedMat);
    const offloadedMedia = await offloadImageVideoForPersist(offloadedPan);
    const offloaded = await offloadAudioForPersist(offloadedMedia);
    storage.setItem(key, JSON.stringify({ ...wrapped, state: offloaded }));
  };

  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, delay);
  };

  const flush = () => {
    const storage = getStorage();
    if (!storage || !pendingKey || !pendingValue) return;

    if (isInteractionBusy()) {
      scheduleFlush();
      return;
    }

    if (writeInFlight) {
      return;
    }

    const key = pendingKey;
    const value = pendingValue;
    pendingKey = null;
    pendingValue = null;
    writeInFlight = true;

    void (async () => {
      try {
        await writePersistPayload(key, value as StorageValue<PersistedCanvasState>);
      } catch (e) {
        const quota =
          e instanceof DOMException &&
          (e.name === 'QuotaExceededError' || (e as DOMException).code === 22);
        if (!quota) {
          console.error('[MagineCanvas] 画布持久化写入失败', e);
          return;
        }
        const wrapped = value as StorageValue<PersistedCanvasState>;
        const st = wrapped.state;
        if (!st?.nodes) {
          console.warn('[MagineCanvas] 画布持久化失败：localStorage 配额已满');
          return;
        }
        try {
          const shrunk = shrinkWorkflowForLocalStorage({
            nodes: st.nodes,
            edges: st.edges || [],
          });
          const offloadedMat = await offloadMaterialDataUrlsForPersist(shrunk);
          const offloadedPan = await offloadPanoramaTexForPersist(offloadedMat);
          const offloadedMedia = await offloadImageVideoForPersist(offloadedPan);
          const offloaded = await offloadAudioForPersist(offloadedMedia);
          const emergency = {
            ...wrapped,
            state: stripLargeDataUrlsDeep(offloaded, 98_304),
          };
          storage.setItem(key, JSON.stringify(emergency));
        } catch {
          console.warn(
            '[MagineCanvas] 画布持久化失败：请清理浏览器站点数据，或减少画布中的内嵌大图 / 分镜导出。'
          );
        }
      } finally {
        writeInFlight = false;
        if (pendingKey && pendingValue) scheduleFlush();
      }
    })();
  };

  const attachFlushListeners = () => {
    if (listenersAttached || typeof window === 'undefined') return;
    listenersAttached = true;
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    });
  };

  return {
    getItem: async (name) => {
      if (isDesktopProjectStorageActive()) return null;
      const storage = getStorage();
      const raw = storage?.getItem(name);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StorageValue<T>;
      const st = (parsed as StorageValue<PersistedCanvasState>).state;
      if (Array.isArray(st?.nodes)) {
        const afterMat = await hydrateMaterialIdbRefsInNodes(st.nodes);
        const afterPan = await hydratePanoramaDiskRefsInNodes(afterMat);
        const afterMedia = await hydrateImageVideoDiskRefs(afterPan);
        const nodes = await hydrateAudioIdbRefsInNodes(afterMedia);
        (parsed as StorageValue<PersistedCanvasState>).state = { ...st, nodes };
      }
      return parsed;
    },
    setItem: (name, value) => {
      if (isDesktopProjectStorageActive()) return;
      attachFlushListeners();
      pendingKey = name;
      pendingValue = value;
      scheduleFlush();
    },
    removeItem: (name) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pendingKey = null;
      pendingValue = null;
      getStorage()?.removeItem(name);
    },
  };
}

// 获取节点默认数据
const getDefaultNodeData = (type: CanvasNodeData['type']): Partial<CanvasNodeData> => {
  switch (type) {
    case 'prompt':
      return { label: '文本', type: 'prompt', text: '' };
    case 'llm':
      return { label: '大模型', type: 'llm', prompt: '', output: '' };
    case 'image':
      return { label: '图像生成', type: 'image', prompt: '', imageUrl: '', aspectRatio: '16:9', imageResolution: '2K', model: 'doubao-seedream-5-0-260128' };
    case 'video':
      return { label: '视频生成', type: 'video', prompt: '', customPrompt: '', imageRef: '', videoUrl: '', ratio: '16:9', resolution: '720P', duration: 5, model: 'seedance-2.0', personReferenceMode: 'text-fallback', virtualHumanCardId: '' };
    case 'agent':
      return {
        label: 'Agent',
        type: 'agent',
        agentName: 'Agent',
        agentPrompt: '',
        prompt: '',
        output: '',
        model: 'deepseek-v4-flash',
        agentWidth: 380,
        agentHeight: 520,
        agentChatHistory: [],
      };
    case 'material':
      return {
        label: '素材',
        type: 'material',
        fileUrl: '',
        thumbnailUrl: '',
        fileName: '',
        fileType: '',
        seedanceAssetId: '',
        seedanceAssetUri: '',
        seedanceAssetGroupId: '',
        virtualHumanCardId: '',
        mentionSlug: `素材${Math.random().toString(36).slice(2, 6)}`,
        materialWidth: 360,
        materialHeight: 203,
        faceComplianceEnabled: false,
        faceComplianceProcessed: false,
        faceComplianceStatus: 'idle',
      };
    case 'region':
      return {
        label: '未命名区域',
        type: 'region',
        regionName: '未命名区域',
        regionWidth: 200,
        regionHeight: 120,
        regionLabelFontPx: 12,
      };
    case 'storyboard':
      return {
        label: '手绘分镜',
        type: 'storyboard',
        fileUrl: '',
        mentionSlug: `分镜${Math.random().toString(36).slice(2, 6)}`,
        storyboardWidth: 320,
        storyboardHeight: 220,
        strokes: [],
        fileType: 'image',
        fileName: '手绘分镜.png',
      };
    case 'panorama':
      return {
        label: '720°全景',
        type: 'panorama',
        panoramaTexUrl: '',
        panoramaWidth: 360,
        panoramaHeight: 300,
        panoramaAspect: '',
        panoramaMode: 'standard',
        panoramaAgentSceneImageDataUrl: '',
        panoramaAgentVisionLlmModel: 'doubao-seed-1-6-vision-250815',
        panoramaAgentImageProviderId: 'seedream',
        panoramaAgentImageModel: 'doubao-seedream-5-0-260128',
        panoramaAgentImageResolution: '2K',
        panoramaAgentImageAspect: '2:1',
        panoramaAgentLlmSupplement: '',
        panoramaTexHistory: [],
      };
    case 'topazEnhance':
      return {
        label: '画质增强',
        type: 'topazEnhance',
        outputImageUrl: '',
        outputVideoUrl: '',
        topazPanelMode: 'image',
        topazImageHistory: [],
        topazVideoHistory: [],
        topazWidth: 1090,
        topazHeight: 320,
        topazStatus: '',
        topazProgress: 0,
        topazLastError: '',
      };
    case 'faceCompliance':
      return {
        label: '人脸合规',
        type: 'faceCompliance',
        inputImageUrl: '',
        outputImageUrl: '',
        coverMode: 'both',
        faceCount: 0,
      };
    case 'music':
      return {
        label: '音乐/语音',
        type: 'music',
        prompt: '',
        audioUrl: '',
        duration: 30,
        model: 'music-2.6-free',
      };
    case 'browser':
      return {
        label: '浏览器',
        type: 'browser',
        browserUrl: 'https://chatgpt.com/',
        browserWidth: 920,
        browserHeight: 700,
        browserDownloads: [],
      };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
};

/** 素材 data URL 尽早写入 IndexedDB，降低「持久化尚未 flush / 应急裁剪」导致刷新后丢失的概率 */
const materialUrlPersistSig = new Map<string, string>();
let pendingMaterialMirrorNodes: Node<CanvasNodeData>[] | null = null;
let materialMirrorTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleMirrorInlineMaterialImagesToIdb(nodes: Node<CanvasNodeData>[]) {
  if (typeof window === 'undefined') return;
  pendingMaterialMirrorNodes = nodes;
  if (materialMirrorTimer) return;
  materialMirrorTimer = setTimeout(() => {
    materialMirrorTimer = null;
    const latestNodes = pendingMaterialMirrorNodes;
    pendingMaterialMirrorNodes = null;
    if (!latestNodes) return;
    void (async () => {
      for (const n of latestNodes) {
        if (n.type !== 'material') continue;
        const d = n.data as Record<string, unknown>;
        const fileUrl = typeof d.fileUrl === 'string' ? d.fileUrl : '';
        const thumbUrl = typeof d.thumbnailUrl === 'string' ? d.thumbnailUrl : '';
        if (!fileUrl.startsWith('data:') && !thumbUrl.startsWith('data:')) continue;
        const sig = `${fileUrl.length}|${thumbUrl.length}|${fileUrl.slice(0, 64)}`;
        if (materialUrlPersistSig.get(n.id) === sig) continue;
        materialUrlPersistSig.set(n.id, sig);
        try {
          await putMaterialBlob(n.id, {
            fileUrl: fileUrl || thumbUrl,
            thumbnailUrl: thumbUrl || fileUrl,
          });
        } catch {
          /* 无痕 / 禁用存储 */
        }
        try {
          const payload = fileUrl || thumbUrl;
          if (payload.startsWith('data:video/')) {
            await postVideoToProjectDiskCache(n.id, payload);
          } else {
            await postMaterialToProjectDiskCache(n.id, payload);
          }
        } catch {
          /* 本机未起服务或无写权限 */
        }
      }
    })();
  }, 200);
}

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      selectedNode: null,
      regionDrawRequested: false,
      past: [],
      future: [],
      historyRevision: 0,
      downstreamNodeIdsBySource: {},
      _rebuildDownstreamIndex: () => {
        const { edges } = get();
        const index: Record<string, string[]> = {};
        for (const e of edges) {
          (index[e.source] ??= []).push(e.target);
        }
        set({ downstreamNodeIdsBySource: index });
      },
      glowingNodeIds: [],
      addGlowingNode: (nodeId) => set((s) => ({
        glowingNodeIds: s.glowingNodeIds.includes(nodeId) ? s.glowingNodeIds : [...s.glowingNodeIds, nodeId],
      })),
      clearGlowingNode: (nodeId) => set((s) => ({
        glowingNodeIds: s.glowingNodeIds.filter((id) => id !== nodeId),
      })),

      requestRegionDraw: () => set({ regionDrawRequested: true }),
      clearRegionDrawRequest: () => set({ regionDrawRequested: false }),

      pushUndoSnapshot: () => {
        resetUpdateNodeDataBurst();
        const { nodes, edges, past } = get();
        set({
          past: appendUndoSnapshot(past, nodes, edges),
          future: [],
        });
      },

      undo: () => {
        resetUpdateNodeDataBurst();
        const state = get();
        if (state.past.length === 0) return;
        beginHistoryRestoreGuard();
        invalidatePendingWorkflowLoad();
        const snapshot = state.past[state.past.length - 1];
        const current = cloneWorkflowForUndo(state.nodes, state.edges);
        set({
          nodes: snapshot.nodes,
          edges: snapshot.edges,
          past: state.past.slice(0, -1),
          future: [current, ...state.future],
          selectedNode: null,
          historyRevision: state.historyRevision + 1,
        });
        get()._rebuildDownstreamIndex();
      },

      redo: () => {
        resetUpdateNodeDataBurst();
        const state = get();
        if (state.future.length === 0) return;
        beginHistoryRestoreGuard();
        invalidatePendingWorkflowLoad();
        const next = state.future[0];
        const current = cloneWorkflowForUndo(state.nodes, state.edges);
        set({
          nodes: next.nodes,
          edges: next.edges,
          future: state.future.slice(1),
          past: trimUndoSnapshots([...state.past, current], state.nodes.length),
          selectedNode: null,
          historyRevision: state.historyRevision + 1,
        });
        get()._rebuildDownstreamIndex();
      },

      setNodes: (nodes) => {
        startTransition(() => {
          void set({ nodes });
        });
      },
      setEdges: (edges) => {
        startTransition(() => {
          void set({ edges });
        });
        get()._rebuildDownstreamIndex();
      },

      onNodesChange: (changes) => {
        if (isHistoryRestoreGuardActive()) return;
        startTransition(() => {
          for (const c of changes) {
            if (c.type === 'remove') {
              materialUrlPersistSig.delete(c.id);
              const victim = get().nodes.find((n) => n.id === c.id);
              if (victim?.type === 'material') {
                void deleteMaterialBlob(c.id);
                void deleteMaterialProjectDiskCache(c.id);
              }
              if (victim?.type === 'panorama') {
                void deletePanoramaProjectDiskCache(c.id);
              }
            }
          }
          const record = shouldRecordNodesChange(changes);
          if (record) {
            const { nodes, edges, past } = get();
            set({
              past: appendUndoSnapshot(past, nodes, edges),
              future: [],
              nodes: applyNodeChanges(changes, nodes) as Node<CanvasNodeData>[],
            });
          } else {
            set({
              nodes: applyNodeChanges(changes, get().nodes) as Node<CanvasNodeData>[],
            });
          }
        });
      },

      onEdgesChange: (changes) => {
        startTransition(() => {
          const record = shouldRecordEdgesChange(changes);
          if (record) {
            const { nodes, edges, past } = get();
            set({
              past: appendUndoSnapshot(past, nodes, edges),
              future: [],
              edges: applyEdgeChanges(changes, edges),
            });
          } else {
            set({
              edges: applyEdgeChanges(changes, get().edges),
            });
          }
          get()._rebuildDownstreamIndex();
        });
      },

      onConnect: (connection: Connection) => {
        startTransition(() => {
          const { nodes, edges, past } = get();
          if (!connection.source || !connection.target) return;

          const nodesForConnect = getCanvasRfNodesOrFallback(nodes) as Node<CanvasNodeData>[];
          const { edges: nextEdges, added } = appendBeamConnectionsFromSources(connection, nodesForConnect, edges);
          if (added === 0) return;

          set({
            past: appendUndoSnapshot(past, nodes, edges),
            future: [],
            edges: nextEdges,
          });
          get()._rebuildDownstreamIndex();
        });
      },

      addNode: (type, position = { x: 250, y: 200 }) => {
        if (isEditionNodeTypeDisabled(type)) return;
        invalidatePendingWorkflowLoad();
        startTransition(() => {
          const { nodes, edges, past } = get();
          const overrides: Partial<Node<CanvasNodeData>> | undefined =
            type === 'storyboard'
              ? { style: { width: 320, height: 220 } }
              : type === 'panorama'
                ? { style: { width: 360, height: 300 } }
                : type === 'topazEnhance'
                  ? { style: { width: 1090, height: 320 } }
                  : type === 'material'
                    ? { style: { width: 360, height: 203 } }
                    : type === 'agent'
                      ? { style: { width: 380, height: 520 } }
                      : type === 'faceCompliance'
                        ? { style: { width: 280, height: 320 } }
                        : type === 'browser'
                          ? { style: { width: 300, height: 210 } }
                          : undefined;
          set({
            past: appendUndoSnapshot(past, nodes, edges),
            future: [],
            nodes: applyRegionReparenting(
              sortNodesParentsFirst([...nodes, createCanvasNode(type, position, undefined, overrides)])
            ),
          });
        });
      },

      addNodeWithData: (type, position, data, options) => {
        if (isEditionNodeTypeDisabled(type)) return '';
        invalidatePendingWorkflowLoad();
        const { nodes, edges, past } = get();
        const overrides: Partial<Node<CanvasNodeData>> = {};
        if (options?.captureEntrance && type === 'material') {
          overrides.className = 'mc-material-capture-entrance';
        }
        const newNode = createCanvasNode(type, position, data, overrides);
        const newId = newNode.id;
        const applyAdd = () => {
          set({
            past: appendUndoSnapshot(past, nodes, edges),
            future: [],
            nodes: applyRegionReparenting(sortNodesParentsFirst([...nodes, newNode])),
          });
        };
        if (options?.syncCommit) {
          flushSync(applyAdd);
        } else {
          startTransition(applyAdd);
        }
        if (options?.captureEntrance && type === 'material') {
          window.setTimeout(() => {
            useCanvasStore.setState((s) => ({
              nodes: s.nodes.map((n) => (n.id === newId ? { ...n, className: undefined } : n)),
            }));
          }, 820);
        }
        return newId;
      },

      addRegionNode: ({ position, width, height, regionName }) => {
        startTransition(() => {
          const { nodes, edges, past } = get();
          const w = Math.max(48, Math.round(width));
          const h = Math.max(48, Math.round(height));
          const name = (regionName?.trim() || '未命名区域').slice(0, 80);
          const node = createCanvasNode(
            'region',
            position,
            {
              regionName: name,
              regionWidth: w,
              regionHeight: h,
              label: name,
            },
            { style: { width: w, height: h }, zIndex: -8 }
          );
          let nextNodes = sortNodesParentsFirst([...nodes, node]);
          nextNodes = attachUnparentedNodesOverlappingRegion(nextNodes, node.id);
          nextNodes = applyRegionReparenting(nextNodes);
          set({
            past: appendUndoSnapshot(past, nodes, edges),
            future: [],
            nodes: nextNodes,
          });
        });
      },

      removeNode: (nodeId) => {
        startTransition(() => {
          const { nodes, edges, past } = get();
          const byId = new Map(nodes.map((n) => [n.id, n]));
          const removed = byId.get(nodeId);
          if (removed?.type === 'material') {
            void deleteMaterialBlob(nodeId);
            void deleteMaterialProjectDiskCache(nodeId);
          }
          if (removed?.type === 'panorama') {
            void deletePanoramaProjectDiskCache(nodeId);
          }
          const next = nodes
            .filter((n) => n.id !== nodeId)
            .map((n) => {
              const pid = n.parentId ?? (n as { parentNode?: string }).parentNode;
              if (pid === nodeId) {
                const abs = getAbsoluteTopLeft(n, byId);
                const nn = {
                  ...n,
                  position: { ...abs },
                  parentId: undefined,
                  extent: undefined,
                } as Node<CanvasNodeData>;
                delete (nn as { parentNode?: string }).parentNode;
                return nn;
              }
              return n;
            });
          set({
            past: appendUndoSnapshot(past, nodes, edges),
            future: [],
            nodes: sortNodesParentsFirst(next),
            edges: edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
            selectedNode: null,
          });
        });
      },

      updateRegionGeometry: (nodeId, { x, y, width, height }) => {
        startTransition(() => {
          const { nodes, edges, past } = get();
          const w = Math.max(48, Math.round(width));
          const h = Math.max(48, Math.round(height));
          set({
            past: appendUndoSnapshot(past, nodes, edges),
            future: [],
            nodes: sortNodesParentsFirst(
              nodes.map((node) =>
                node.id === nodeId
                  ? {
                      ...node,
                      position: { x, y },
                      style: { ...node.style, width: w, height: h },
                      data: {
                        ...node.data,
                        regionWidth: w,
                        regionHeight: h,
                      },
                    }
                  : node
              )
            ),
          });
        });
      },

      updateStoryboardGeometry: (nodeId, { x, y, width, height }) => {
        startTransition(() => {
          const { nodes, edges, past } = get();
          const w = Math.max(200, Math.round(width));
          const h = Math.max(140, Math.round(height));
          set({
            past: appendUndoSnapshot(past, nodes, edges),
            future: [],
            nodes: sortNodesParentsFirst(
              nodes.map((node) =>
                node.id === nodeId
                  ? {
                      ...node,
                      position: { x, y },
                      style: { ...node.style, width: w, height: h },
                      data: {
                        ...node.data,
                        storyboardWidth: w,
                        storyboardHeight: h,
                      },
                    }
                  : node
              )
            ),
          });
        });
      },

      updatePanoramaGeometry: (nodeId, { x, y, width, height }) => {
        startTransition(() => {
          const { nodes, edges, past } = get();
          const w = Math.max(260, Math.round(width));
          /** 与 PanoramaNode MIN_NODE_ABS_H 一致 */
          const h = Math.max(248, Math.round(height));
          set({
            past: appendUndoSnapshot(past, nodes, edges),
            future: [],
            nodes: sortNodesParentsFirst(
              nodes.map((node) =>
                node.id === nodeId
                  ? {
                      ...node,
                      position: { x, y },
                      style: { ...node.style, width: w, height: h },
                      data: {
                        ...node.data,
                        panoramaWidth: w,
                        panoramaHeight: h,
                      },
                    }
                  : node
              )
            ),
          });
        });
      },

      updateAgentGeometry: (nodeId, { x, y, width, height }) => {
        const { nodes, edges, past } = get();
        const w = Math.max(300, Math.round(width));
        const h = Math.max(330, Math.round(height));
        set({
          past: appendUndoSnapshot(past, nodes, edges),
          future: [],
          nodes: sortNodesParentsFirst(
            nodes.map((node) =>
              node.id === nodeId
                ? {
                    ...node,
                    position: { x, y },
                    width: w,
                    height: h,
                    style: { ...node.style, width: w, height: h },
                    data: {
                      ...node.data,
                      agentWidth: w,
                      agentHeight: h,
                    },
                  }
                : node
            )
          ),
        });
      },

      updateBrowserGeometry: (nodeId, { x, y, width, height }) => {
        startTransition(() => {
          const { nodes, edges, past } = get();
          const w = Math.max(480, Math.round(width));
          const h = Math.max(360, Math.round(height));
          set({
            past: appendUndoSnapshot(past, nodes, edges),
            future: [],
            nodes: sortNodesParentsFirst(
              nodes.map((node) =>
                node.id === nodeId
                  ? {
                      ...node,
                      position: { x, y },
                      width: w,
                      height: h,
                      style: { ...node.style, width: w, height: h },
                      data: {
                        ...node.data,
                        browserWidth: w,
                        browserHeight: h,
                      },
                    }
                  : node
              )
            ),
          });
        });
      },

      updateTopazEnhanceGeometry: (nodeId, { x, y, width, height }, options) => {
        startTransition(() => {
          const { nodes, edges, past } = get();
          const w = Math.max(240, Math.round(width));
          const h = Math.max(200, Math.round(height));
          const recordUndo = options?.recordUndo !== false;
          const nextNodes = sortNodesParentsFirst(
            nodes.map((node) =>
              node.id === nodeId
                ? {
                    ...node,
                    position: { x, y },
                    style: { ...node.style, width: w, height: h },
                    data: {
                      ...node.data,
                      topazWidth: w,
                      topazHeight: h,
                    },
                  }
                : node
            )
          );
          if (recordUndo) {
            set({
              past: appendUndoSnapshot(past, nodes, edges),
              future: [],
              nodes: nextNodes,
            });
          } else {
            set({ nodes: nextNodes });
          }
        });
      },

      updateMaterialGeometry: (nodeId, { x, y, width, height }, options) => {
        startTransition(() => {
          const { nodes, edges, past } = get();
          const w = Math.max(200, Math.round(width));
          const h = Math.max(120, Math.round(height));
          const recordUndo = options?.recordUndo !== false;
          const nextNodes = sortNodesParentsFirst(
            nodes.map((node) =>
              node.id === nodeId
                ? {
                    ...node,
                    position: { x, y },
                    width: w,
                    height: h,
                    style: { ...node.style, width: w, height: h },
                    data: {
                      ...node.data,
                      materialWidth: w,
                      materialHeight: h,
                    },
                  }
                : node
            )
          );
          if (recordUndo) {
            set({
              past: appendUndoSnapshot(past, nodes, edges),
              future: [],
              nodes: nextNodes,
            });
          } else {
            set({ nodes: nextNodes });
          }
        });
      },

      updateNodeData: (nodeId, data, options) => {
        const state = get();
        const currentNode = state.nodes.find((node) => node.id === nodeId);
        if (!currentNode) return;
        const changedData = changedNodeDataPatch(
          currentNode.data as Record<string, unknown>,
          data as Record<string, unknown>,
        ) as Partial<CanvasNodeData>;
        if (Object.keys(changedData).length === 0) return;
        const recordUndo = options?.recordUndo !== false
          && canvasNodeDataPatchRecordsUndo(changedData as Record<string, unknown>)
          && !isHistoryRestoreGuardActive();
        let nextPast = state.past;
        let nextFuture = state.future;
        if (recordUndo) {
          const burstKey = canvasNodeDataUndoBurstKey(
            nodeId,
            changedData as Record<string, unknown>,
          );
          if (updateNodeDataBurstKey !== burstKey) {
            nextPast = appendUndoSnapshot(state.past, state.nodes, state.edges);
            nextFuture = [];
            updateNodeDataBurstKey = burstKey;
          }
          if (updateNodeDataBurstTimer !== null) {
            clearTimeout(updateNodeDataBurstTimer);
          }
          updateNodeDataBurstTimer = setTimeout(() => {
            updateNodeDataBurstKey = null;
            updateNodeDataBurstTimer = null;
          }, UPDATE_NODE_DATA_BURST_MS);
        }

        set({
          past: nextPast,
          future: nextFuture,
          nodes: state.nodes.map((node) =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, ...changedData } }
              : node
          ),
        });
      },

      setSelectedNode: (node) => {
        const state = get();
        const cur = state.selectedNode;
        if (node == null) {
          if (cur != null) set({ selectedNode: null });
          return;
        }
        if (cur?.id === node.id) return;
        set({ selectedNode: state.nodes.find((item) => item.id === node.id) || node });
      },

      saveWorkflow: () => ({
        nodes: get().nodes,
        edges: get().edges,
      }),

      loadWorkflow: (data) => {
        const loadRevision = beginWorkflowLoad();
        materialUrlPersistSig.clear();
        const { nodes, edges, past } = get();
        const allowedNodes = data.nodes.filter(
          (node) => !isEditionNodeTypeDisabled(node.data.type || node.type)
        );
        const allowedNodeIds = new Set(allowedNodes.map((node) => node.id));
        const nextNodes = applyRegionReparenting(
          sortNodesParentsFirst(
            allowedNodes.map((node) =>
              migrateLegacyNodes(stripPersistedRfLayout(node as Node<CanvasNodeData>))
            )
          )
        );
        const nextEdges = data.edges
          .filter((edge) => allowedNodeIds.has(edge.source) && allowedNodeIds.has(edge.target))
          .map(migrateEdges);
        const currentMaterialNodeIds = nextNodes
          .filter((node) => node.type === 'material')
          .map((node) => node.id);
        void deleteMaterialBlobsExcept(new Set(currentMaterialNodeIds));

        set({
          past: appendUndoSnapshot(past, nodes, edges),
          future: [],
          nodes: nextNodes,
          edges: nextEdges,
          selectedNode: null,
        });
        get()._rebuildDownstreamIndex();

        void (async () => {
          try {
            const mat = await hydrateMaterialIdbRefsInNodes(nextNodes);
            if (loadRevision !== workflowLoadRevision) return;
            const afterPan = await hydratePanoramaDiskRefsInNodes(mat);
            if (loadRevision !== workflowLoadRevision) return;
            const afterMedia = await hydrateImageVideoDiskRefs(afterPan);
            if (loadRevision !== workflowLoadRevision) return;
            const hydrated = await hydrateAudioIdbRefsInNodes(afterMedia);
            if (loadRevision !== workflowLoadRevision) return;
            startTransition(() => {
              if (loadRevision !== workflowLoadRevision) return;
              set({
                nodes: hydrated,
                edges: nextEdges,
              });
              get()._rebuildDownstreamIndex();
            });
          } catch (e) {
            if (loadRevision !== workflowLoadRevision) return;
            console.error('[MagineCanvas] 工作流素材/全景还原失败', e);
          }
        })();
      },

      clearCanvas: () => {
        invalidatePendingWorkflowLoad();
        startTransition(() => {
          materialUrlPersistSig.clear();
          const { nodes, edges, past } = get();
          set({
            past: appendUndoSnapshot(past, nodes, edges),
            future: [],
            nodes: [],
            edges: [],
            selectedNode: null,
          });
          get()._rebuildDownstreamIndex();
        });
      },
    }),
    {
      name: 'magine-canvas-storage',
      storage: createDebouncedJSONStorage<PersistedCanvasState>(600),
      // Keep hot-path updates cheap. Media trimming/offload runs once when the debounced write flushes.
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
      }),
      // 自动迁移旧版边数据（升级直连边为贝塞尔曲线+动画）
      merge: (persisted, current) => {
        if (canvasAuthorityRevision > 0) {
          return {
            ...current,
            past: [],
            future: [],
          };
        }
        const nodes = sortNodesParentsFirst(
          ((persisted as Partial<CanvasState>)?.nodes || []).map((node) =>
            migrateLegacyNodes(stripPersistedRfLayout(node as Node<CanvasNodeData>))
          )
        );
        const edges = ((persisted as Partial<CanvasState>)?.edges || []).map(migrateEdges);
        return {
          ...current,
          ...(persisted as Partial<CanvasState>),
          past: [],
          future: [],
          nodes,
          edges,
        };
      },
    }
  )
);

useCanvasStore.subscribe((state, prev) => {
  if (state.nodes === prev.nodes) return;
  scheduleMirrorInlineMaterialImagesToIdb(state.nodes);
});

/** 持久化里带的 width/height 会让 RF 认为尺寸未变而跳过 handleBounds 重算；交给 DOM 重新测量 */
function stripPersistedRfLayout<N extends Node>(node: N): N {
  const next = { ...node } as N & { width?: unknown; height?: unknown; measured?: unknown; selected?: unknown };
  delete next.width;
  delete next.height;
  delete next.measured;
  delete next.selected;
  return next as N;
}

/** 移除已废弃的 test 节点类型，转为提示词节点 */
function migrateLegacyNodes(node: Node): Node<CanvasNodeData> {
  const t = node.type as string | undefined;
  const dataType = (node.data as { type?: string } | undefined)?.type;
  if (t === 'prompt' || dataType === 'prompt') {
    const prev = node.data as Record<string, unknown>;
    return {
      ...node,
      type: 'prompt',
      data: {
        ...prev,
        type: 'prompt',
        label: typeof prev.label === 'string' && prev.label !== '提示词' ? prev.label : '文本',
      } as CanvasNodeData,
    };
  }

  if (t === 'region' || dataType === 'region') {
    const prev = node.data as Record<string, unknown>;
    const legacyParent = (node as { parentNode?: string }).parentNode;
    const nextNode = { ...node } as Node<CanvasNodeData>;
    if (legacyParent && !nextNode.parentId) {
      (nextNode as { parentId?: string }).parentId = legacyParent;
      delete (nextNode as { parentNode?: string }).parentNode;
    }
    const font =
      typeof prev.regionLabelFontPx === 'number' && prev.regionLabelFontPx >= 10 && prev.regionLabelFontPx <= 28
        ? prev.regionLabelFontPx
        : 12;
    return {
      ...nextNode,
      type: 'region',
      zIndex: typeof node.zIndex === 'number' ? node.zIndex : -8,
      data: {
        ...getDefaultNodeData('region'),
        ...prev,
        type: 'region',
        regionLabelFontPx: font,
      } as CanvasNodeData,
    };
  }

  if (t === 'storyboard' || dataType === 'storyboard') {
    const prev = node.data as Record<string, unknown>;
    const strokes = Array.isArray(prev.strokes) ? prev.strokes : [];
    const migrated = { ...node } as Node<CanvasNodeData> & { dragHandle?: string };
    delete migrated.dragHandle;
    return {
      ...migrated,
      type: 'storyboard',
      data: {
        ...getDefaultNodeData('storyboard'),
        ...prev,
        type: 'storyboard',
        strokes,
      } as CanvasNodeData,
    };
  }

  if (t === 'panorama' || dataType === 'panorama') {
    const prev = node.data as Record<string, unknown>;
    const migrated = { ...node } as Node<CanvasNodeData> & { dragHandle?: string };
    delete migrated.dragHandle;
    return {
      ...migrated,
      type: 'panorama',
      data: {
        ...getDefaultNodeData('panorama'),
        ...prev,
        type: 'panorama',
      } as CanvasNodeData,
    };
  }

  if (t === 'topazEnhance' || dataType === 'topazEnhance') {
    const prev = node.data as Record<string, unknown>;
    const migrated = { ...node } as Node<CanvasNodeData> & { style?: Record<string, unknown> };
    if (migrated.style && typeof migrated.style === 'object') {
      const { height: _drop, ...rest } = migrated.style;
      migrated.style = Object.keys(rest).length ? rest : { width: 300 };
    }
    return {
      ...migrated,
      type: 'topazEnhance',
      data: {
        ...getDefaultNodeData('topazEnhance'),
        ...prev,
        type: 'topazEnhance',
      } as CanvasNodeData,
    };
  }

  if (t === 'llm' || dataType === 'llm') {
    const prev = node.data as Record<string, unknown>;
    const agentDefaults = getDefaultNodeData('agent') as CanvasNodeData;
    const prompt =
      typeof prev.prompt === 'string'
        ? prev.prompt
        : typeof prev.text === 'string'
          ? prev.text
          : '';
    const output = typeof prev.output === 'string' ? prev.output : '';
    return {
      ...node,
      type: 'agent',
      data: {
        ...agentDefaults,
        ...prev,
        type: 'agent',
        label: typeof prev.label === 'string' && prev.label !== '大模型' ? prev.label : agentDefaults.label,
        agentName: typeof prev.label === 'string' && prev.label !== '大模型' ? prev.label : 'Agent',
        prompt,
        output,
      },
    };
  }

  if (t !== 'test' && dataType !== 'test') {
    return node as Node<CanvasNodeData>;
  }
  const prev = node.data as Record<string, unknown>;
  const promptDefaults = getDefaultNodeData('prompt') as CanvasNodeData;
  return {
    ...node,
    type: 'prompt',
    data: {
      ...promptDefaults,
      ...prev,
      type: 'prompt',
      text: typeof prev.text === 'string' ? prev.text : typeof prev.value === 'string' ? prev.value : '',
      label: typeof prev.label === 'string' && prev.label !== '测试' ? prev.label : promptDefaults.label,
    },
  };
}

// 旧边迁移函数：将所有边升级为 beam 类型，清理内联 stroke
function migrateEdges(edge: Edge): Edge {
  const needsFullUpdate = edge.type === 'straight' || edge.animated;

  if (needsFullUpdate) {
    return {
      ...edge,
      type: 'beam',
      animated: false,
      style: { strokeWidth: 1.5 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#FB923C',
        width: 12,
        height: 12,
      },
    };
  }

  // 清理 stroke 内联样式 + 升级为 beam 类型
  const cleanStyle = edge.style ? { ...edge.style } : {};
  delete cleanStyle.stroke;
  return {
    ...edge,
    type: 'beam',
    animated: false,
    style: Object.keys(cleanStyle).length > 0 ? cleanStyle : { strokeWidth: 1.5 },
  };
}
