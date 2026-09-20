'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Edge, Node } from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import { ShieldAlert } from 'lucide-react';

import Canvas from '@/components/canvas/Canvas';
import Sidebar from '@/components/canvas/Sidebar';
import WelcomePage, { type WelcomeProject, type NewCanvasInfo } from '@/components/canvas/WelcomePage';
import { ApiConfigDialog } from '@/components/seedance/ApiConfigDialog';
import { CanvasAgentWindow } from '@/components/agent/CanvasAgentWindow';
import { CanvasAgentFAB } from '@/components/agent/CanvasAgentFAB';
import { type CanvasNodeData, useCanvasStore } from '@/components/canvas/CanvasStore';
import { cn } from '@/lib/utils';
import { offloadWorkflowForProjectPersist } from '@/lib/workflow-project-persist';
import { shrinkWorkflowForLocalStorage, stripLargeDataUrlsDeep } from '@/lib/shrink-workflow-for-storage';
import {
  postEngineeringProjectSnapshot,
  type EngineeringProjectSnapshotV1,
} from '@/lib/sync-engineering-project-disk-cache';
import { mcF } from '@/lib/motion';
import { playCanvasEntranceSound } from '@/lib/canvasEntranceSound';
import { playWelcomeEntranceSound } from '@/lib/welcomeEntranceSound';
import { VoiceAssistantProvider } from '@/components/voice/voiceAssistantContext';
import { CanvasVoiceWave } from '@/components/voice/CanvasVoiceWave';
import { VoiceAssistantProactiveHost } from '@/components/voice/voice-assistant-proactive-interaction';
import { WorkStyleObserver } from '@/components/canvas/WorkStyleObserver';
import { TutorialHost } from '@/components/tutorial/TutorialHost';
import { useVoiceAssistantActivityStore } from '@/components/voice/voice-assistant-activity-store';
import { useSeedanceStore } from '@/components/seedance/SeedanceStore';

type CanvasWorkflow = {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
};

const useBrowserLayoutEffect =
  typeof document !== 'undefined' ? useLayoutEffect : useEffect;
const IS_WEB_TRIAL = process.env.NEXT_PUBLIC_MAGINE_WEB_TRIAL === '1';

/**
 * Electron 壳：预加载注入、html 上的 `mc-electron-no-entrance-blur`、或 UA 兜底。
 * 用于跳过易在 Electron 里卡死的入场 `filter: blur()`（仅依赖 magineDesktop 时 dev/旧包可能仍糊屏）。
 */
function isElectronMagineShell(): boolean {
  if (typeof window === 'undefined') return false;
  if (getMagineDesktop()?.isDesktop) {
    return true;
  }
  if (typeof navigator !== 'undefined' && /Electron\//.test(navigator.userAgent)) {
    return true;
  }
  try {
    return document.documentElement.classList.contains('mc-electron-no-entrance-blur');
  } catch {
    return false;
  }
}

type StoredProject = WelcomeProject & {
  workflow: CanvasWorkflow;
};

const PROJECTS_STORAGE_KEY = 'magine-canvas-projects';
const MAX_RECENT_PROJECTS = 24;
const ENGINEERING_DISK_AUTOSAVE_MS = 3 * 60 * 1000;
/** 画布编辑页省 GPU：localStorage `0`/`1` 覆盖；未设置时默认关闭（保留节点磨砂） */
const EDITOR_GPU_LITE_KEY = 'magine-editor-gpu-lite';

function readEditorGpuLite(): boolean {
  if (typeof window === 'undefined') return false;
  const v = window.localStorage.getItem(EDITOR_GPU_LITE_KEY);
  if (v === '0') return false;
  if (v === '1') return true;
  return false;
}

function getTimestamp() {
  return Date.now();
}

function createProjectId() {
  return `project_${getTimestamp()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sortProjects(projects: StoredProject[]) {
  return [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
}

function normalizeWorkflow(data: unknown): CanvasWorkflow {
  const workflow = data as Partial<CanvasWorkflow> | null;
  return {
    nodes: Array.isArray(workflow?.nodes) ? workflow.nodes : [],
    edges: Array.isArray(workflow?.edges) ? workflow.edges : [],
  };
}

type MagineDesktopBridge = {
  isDesktop?: boolean;
  projectsLoad?: () => Promise<string | null>;
  projectsSave?: (json: string) => Promise<void>;
  projectsIndexLoad?: () => Promise<string | null>;
  projectsIndexSave?: (json: string) => Promise<void>;
  projectLoad?: (projectId: string) => Promise<string | null>;
  projectSave?: (projectId: string, json: string) => Promise<void>;
  projectDelete?: (projectId: string) => Promise<void>;
};

function getMagineDesktop(): MagineDesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { magineDesktop?: MagineDesktopBridge }).magineDesktop;
}

function parseProjectsFromRaw(raw: string | null): StoredProject[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return sortProjects(
      parsed
        .filter((item): item is StoredProject => Boolean(item?.id && item?.title))
        .map((item) => ({
          ...item,
          workflow: normalizeWorkflow(item.workflow),
        }))
    );
  } catch {
    return [];
  }
}

function readProjects() {
  if (typeof window === 'undefined') return [];
  return parseProjectsFromRaw(window.localStorage.getItem(PROJECTS_STORAGE_KEY));
}

/** 桌面 JSON 与当前站点 localStorage 合并：同 id 取 updatedAt 较新的一方，避免旧/空磁盘文件盖掉 Electron dev 里的列表 */
function mergeProjectLists(disk: StoredProject[], local: StoredProject[]): StoredProject[] {
  const byId = new Map<string, StoredProject>();
  for (const p of disk) {
    byId.set(p.id, p);
  }
  for (const p of local) {
    const existing = byId.get(p.id);
    if (!existing || p.updatedAt > existing.updatedAt) {
      byId.set(p.id, p);
    }
  }
  return sortProjects([...byId.values()]).slice(0, MAX_RECENT_PROJECTS);
}

const DESKTOP_PROJECTS_LOAD_MS = 2500;

function projectMetadata(project: StoredProject) {
  const { workflow: _workflow, coverImage, ...metadata } = project;
  return {
    ...metadata,
    coverImage:
      typeof coverImage === 'string' && coverImage.startsWith('data:') && coverImage.length > 256 * 1024
        ? null
        : coverImage,
  };
}

function parseProjectIndex(raw: string | null): Array<Omit<StoredProject, 'workflow'>> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Partial<StoredProject>>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Omit<StoredProject, 'workflow'> => Boolean(item?.id && item?.title))
      .slice(0, MAX_RECENT_PROJECTS);
  } catch {
    return [];
  }
}

async function loadProjectsFromDesktopFile(): Promise<StoredProject[]> {
  const md = getMagineDesktop();
  if (md?.projectsIndexLoad && md.projectLoad) {
    try {
      const indexRaw = await Promise.race([
        md.projectsIndexLoad(),
        new Promise<string | null>((resolve) => setTimeout(() => resolve(null), DESKTOP_PROJECTS_LOAD_MS)),
      ]);
      const index = parseProjectIndex(indexRaw);
      if (index.length > 0) {
        const projects = await Promise.all(index.map(async (metadata) => {
          const raw = await md.projectLoad!(metadata.id);
          if (!raw) return { ...metadata, workflow: { nodes: [], edges: [] } };
          const loaded = parseProjectsFromRaw(`[${raw}]`)[0];
          return loaded || { ...metadata, workflow: { nodes: [], edges: [] } };
        }));
        return sortProjects(projects);
      }
    } catch {
      // Fall through to the legacy monolithic project file for migration.
    }
  }
  if (!md?.projectsLoad) return [];
  try {
    const raw = await Promise.race([
      md.projectsLoad(),
      new Promise<string | null>((resolve) =>
        setTimeout(() => resolve(null), DESKTOP_PROJECTS_LOAD_MS)
      ),
    ]);
    return parseProjectsFromRaw(typeof raw === 'string' ? raw : null);
  } catch {
    return [];
  }
}

/** Electron 内嵌站点的端口与浏览器不同，localStorage 不互通；用主进程 userData JSON 持久化并与本页 localStorage 合并 */
let desktopProjectWriteQueue: Promise<void> = Promise.resolve();

function mirrorProjectsToDesktopFiles(
  projects: StoredProject[],
  changedProjectIds: string[],
  deletedProjectIds: string[],
): boolean {
  const md = getMagineDesktop();
  if (!md?.projectsIndexSave || !md.projectSave) return false;
  const sorted = sortProjects(projects).slice(0, MAX_RECENT_PROJECTS);
  const byId = new Map(sorted.map((project) => [project.id, project]));
  desktopProjectWriteQueue = desktopProjectWriteQueue
    .catch(() => undefined)
    .then(async () => {
      for (const projectId of changedProjectIds) {
        const project = byId.get(projectId);
        if (!project) continue;
        const payload = {
          ...project,
          workflow: shrinkWorkflowForLocalStorage(project.workflow),
        };
        await md.projectSave!(projectId, JSON.stringify(payload));
      }
      if (md.projectDelete) {
        for (const projectId of deletedProjectIds) await md.projectDelete(projectId);
      }
      await md.projectsIndexSave!(JSON.stringify(sorted.map(projectMetadata)));
      window.localStorage.removeItem(PROJECTS_STORAGE_KEY);
    })
    .catch((error) => {
      console.warn('[MagineCanvas] Desktop per-project save failed.', error);
    });
  return true;
}

function mirrorProjectsToDesktopFile(json: string) {
  const md = getMagineDesktop();
  if (md?.projectsSave) {
    void md.projectsSave(json).catch(() => {
      console.warn('[MagineCanvas] 桌面端项目文件保存失败（请检查用户目录磁盘与权限）');
    });
  }
}

function writeProjects(
  projects: StoredProject[],
  options?: { changedProjectIds?: string[]; deletedProjectIds?: string[] },
) {
  if (typeof window === 'undefined') return;
  const sorted = sortProjects(projects).slice(0, MAX_RECENT_PROJECTS);
  const changedProjectIds = options?.changedProjectIds ?? sorted.map((project) => project.id);
  if (mirrorProjectsToDesktopFiles(sorted, changedProjectIds, options?.deletedProjectIds ?? [])) return;
  const payload = sorted.map((p) => ({
    ...p,
    workflow: shrinkWorkflowForLocalStorage(p.workflow),
  }));
  let out: string | null = null;
  try {
    out = JSON.stringify(payload);
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, out);
  } catch (e) {
    const isQuota =
      e instanceof DOMException &&
      (e.name === 'QuotaExceededError' || e.code === 22);
    if (!isQuota) throw e;
    console.warn(
      '[MagineCanvas] localStorage 配额不足，尝试进一步压缩项目数据（超长 data URL 将被移除）'
    );
    const lean = payload.map((p) => ({
      ...p,
      workflow: stripLargeDataUrlsDeep(p.workflow, 4096),
    }));
    try {
      out = JSON.stringify(lean);
      window.localStorage.setItem(PROJECTS_STORAGE_KEY, out);
    } catch {
      const fewer = lean.slice(0, Math.min(8, lean.length));
      try {
        out = JSON.stringify(fewer);
        window.localStorage.setItem(PROJECTS_STORAGE_KEY, out);
      } catch {
        out = null;
        console.warn(
          '[MagineCanvas] 无法在 localStorage 保存项目列表，请清理浏览器站点数据或删除部分项目。'
        );
      }
    }
  }
  if (out) mirrorProjectsToDesktopFile(out);
}

function createProject(title: string, description: string, coverImage: string | null, workflow: CanvasWorkflow): StoredProject {
  const now = getTimestamp();
  return {
    id: createProjectId(),
    title,
    description,
    coverImage,
    createdAt: now,
    updatedAt: now,
    workflow,
  };
}

function updateProjectWorkflow(
  projects: StoredProject[],
  projectId: string,
  workflow: CanvasWorkflow
) {
  const now = getTimestamp();
  return sortProjects(
    projects.map((project) =>
      project.id === projectId
        ? {
            ...project,
            updatedAt: now,
            workflow,
          }
        : project
    )
  ).slice(0, MAX_RECENT_PROJECTS);
}

function duplicateProject(projects: StoredProject[], projectId: string): StoredProject[] {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return projects;

  const now = getTimestamp();
  const duplicated: StoredProject = {
    ...project,
    id: createProjectId(),
    title: `${project.title} - 副本`,
    createdAt: now,
    updatedAt: now,
  };

  return sortProjects([duplicated, ...projects]).slice(0, MAX_RECENT_PROJECTS);
}

function deleteProject(projects: StoredProject[], projectId: string): StoredProject[] {
  return sortProjects(
    projects.filter((project) => project.id !== projectId)
  );
}

function renameProject(
  projects: StoredProject[],
  projectId: string,
  newTitle: string
): StoredProject[] {
  const now = getTimestamp();
  return sortProjects(
    projects.map((project) =>
      project.id === projectId
        ? {
            ...project,
            title: newTitle,
            updatedAt: now,
          }
        : project
    )
  );
}

const TRANSIENT_NODE_KEYS = new Set([
  'data',
  'selected',
  'dragging',
  'measured',
  'width',
  'height',
  'resizing',
]);
const TRANSIENT_NODE_DATA_KEYS = new Set(['isLoading', 'generationProgress']);

function shallowEqualExcept(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
  ignoredKeys: Set<string>,
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return previous === next;
  const previousKeys = Object.keys(previous).filter((key) => !ignoredKeys.has(key));
  const nextKeys = Object.keys(next).filter((key) => !ignoredKeys.has(key));
  if (previousKeys.length !== nextKeys.length) return false;
  return previousKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(next, key) && Object.is(previous[key], next[key]),
  );
}

function hasDurableWorkflowChange(
  previous: CanvasWorkflow,
  next: CanvasWorkflow,
): boolean {
  if (previous.edges !== next.edges) return true;
  if (previous.nodes === next.nodes) return false;
  if (previous.nodes.length !== next.nodes.length) return true;

  const previousById = new Map(previous.nodes.map((node) => [node.id, node]));
  for (const node of next.nodes) {
    const previousNode = previousById.get(node.id);
    if (!previousNode) return true;
    if (previousNode === node) continue;
    if (!shallowEqualExcept(
      previousNode as unknown as Record<string, unknown>,
      node as unknown as Record<string, unknown>,
      TRANSIENT_NODE_KEYS,
    )) return true;
    if (!shallowEqualExcept(
      previousNode.data as unknown as Record<string, unknown>,
      node.data as unknown as Record<string, unknown>,
      TRANSIENT_NODE_DATA_KEYS,
    )) return true;
  }
  return false;
}

/** 仅在画布模式下订阅 nodes/edges，防抖写回项目列表（须定义在 Home 外以满足 static-components 规则） */
function CanvasAutoSave({
  projectId,
  setProjects,
}: {
  projectId: string;
  setProjects: Dispatch<SetStateAction<StoredProject[]>>;
}) {
  const { nodes, edges } = useCanvasStore(
    useShallow((state) => ({
      nodes: state.nodes,
      edges: state.edges,
    }))
  );
  const latestWorkflowRef = useRef<CanvasWorkflow>({ nodes, edges });
  const comparedWorkflowRef = useRef<CanvasWorkflow>({ nodes, edges });
  const previousProjectIdRef = useRef(projectId);
  const saveTimerRef = useRef<number | null>(null);
  const saveRevisionRef = useRef(0);

  useEffect(() => {
    const nextWorkflow = { nodes, edges };
    const projectChanged = previousProjectIdRef.current !== projectId;
    const shouldSave = projectChanged || hasDurableWorkflowChange(comparedWorkflowRef.current, nextWorkflow);
    latestWorkflowRef.current = nextWorkflow;
    comparedWorkflowRef.current = nextWorkflow;
    previousProjectIdRef.current = projectId;
    if (!shouldSave) return;

    saveRevisionRef.current += 1;
    const revision = saveRevisionRef.current;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void (async () => {
        const offloaded = await offloadWorkflowForProjectPersist(latestWorkflowRef.current);
        if (revision !== saveRevisionRef.current) return;
        setProjects((current) => {
          const next = updateProjectWorkflow(current, projectId, offloaded);
          writeProjects(next, { changedProjectIds: [projectId] });
          return next;
        });
      })();
    }, 2000);
  }, [edges, nodes, projectId, setProjects]);

  useEffect(() => {
    return () => {
      saveRevisionRef.current += 1;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  return null;
}

type EngineeringMetaRef = RefObject<{
  title: string;
  description?: string;
  coverImage: string | null;
  createdAt: number;
  updatedAt: number;
}>;

/** 每 3 分钟将当前工程（节点、引用图等）写入 `.magine-cache/engineering/<projectId>/`，目录内最多保留 3 份快照 */
function CanvasEngineeringDiskAutoSave({
  projectId,
  metaRef,
}: {
  projectId: string;
  metaRef: EngineeringMetaRef;
}) {
  useEffect(() => {
    const id = window.setInterval(() => {
      void (async () => {
        const meta = metaRef.current;
        if (!meta?.title) return;
        const { nodes, edges } = useCanvasStore.getState();
        const wf = { nodes, edges };
        const offloaded = await offloadWorkflowForProjectPersist(wf);
        const shrunk = shrinkWorkflowForLocalStorage(offloaded);
        const snapshot: EngineeringProjectSnapshotV1 = {
          version: 1,
          projectId,
          savedAt: Date.now(),
          title: meta.title,
          description: meta.description,
          coverImage: meta.coverImage,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          workflow: shrunk,
        };
        const ok = await postEngineeringProjectSnapshot(snapshot);
        if (!ok) {
          console.warn('[MagineCanvas] 工程磁盘快照保存失败（可检查 dev 服务是否可用）');
        }
      })();
    }, ENGINEERING_DISK_AUTOSAVE_MS);
    return () => window.clearInterval(id);
  }, [projectId, metaRef]);

  return null;
}

export default function HomeClient() {
  const voiceAssistantEnabled = useSeedanceStore(
    (state) => state.config.voiceAssistantEnabled,
  );
  const {
    clearCanvas,
    loadWorkflow,
    saveWorkflow,
  } = useCanvasStore(
    useShallow((state) => ({
      clearCanvas: state.clearCanvas,
      loadWorkflow: state.loadWorkflow,
      saveWorkflow: state.saveWorkflow,
    }))
  );
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [screen, setScreen] = useState<'welcome' | 'canvas'>('welcome');
  /** 0: 镜头拉近+虚焦；1: 后拉变实进行中；2: 镜头节奏收尾（如 fitView） */
  const [canvasEntrancePhase, setCanvasEntrancePhase] = useState<0 | 1 | 2>(0);
  /** 四周 UI：略大缩回、400ms 缓入；与镜头后拉（phase 1）同一帧开始 */
  const [canvasChromeReveal, setCanvasChromeReveal] = useState(false);
  const [welcomeEntrancePhase, setWelcomeEntrancePhase] = useState<0 | 1 | 2>(0);
  const [welcomeChromeReveal, setWelcomeChromeReveal] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [canvasToast, setCanvasToast] = useState<{ title: string; visible: boolean } | null>(null);
  const [canvasApiConfigOpen, setCanvasApiConfigOpen] = useState(false);
  const [canvasApiConfigClosing, setCanvasApiConfigClosing] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentInitialPrompt, setAgentInitialPrompt] = useState('');
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialAutoStartRequest, setTutorialAutoStartRequest] = useState<{
    courseId: 'canvas-basics';
    requestId: number;
  } | null>(null);
  const [welcomeAgentOpen, setWelcomeAgentOpen] = useState(false);
  const [editorGpuLite, setEditorGpuLite] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.dataset.magineRendererReady = 'true';
    return () => {
      delete document.documentElement.dataset.magineRendererReady;
    };
  }, []);
  const engineeringMetaRef = useRef({
    title: '',
    description: undefined as string | undefined,
    coverImage: null as string | null,
    createdAt: 0,
    updatedAt: 0,
  });

  useEffect(() => {
    if (!activeProjectId) return;
    const p = projects.find((x) => x.id === activeProjectId);
    if (!p) return;
    engineeringMetaRef.current = {
      title: p.title,
      description: p.description,
      coverImage: p.coverImage ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }, [projects, activeProjectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setEditorGpuLite(readEditorGpuLite());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const toggleEditorGpuLite = useCallback(() => {
    setEditorGpuLite((prev) => {
      const next = !prev;
      window.localStorage.setItem(EDITOR_GPU_LITE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const fromLs = readProjects();
        const fromDisk = await loadProjectsFromDesktopFile();
        const merged = mergeProjectLists(fromDisk, fromLs);
        setProjects(merged);
        if (getMagineDesktop()?.projectsIndexSave) {
          if (merged.length > 0) writeProjects(merged);
        } else if (merged.length > 0) {
          const syncPayload = merged.map((p) => ({
            ...p,
            workflow: shrinkWorkflowForLocalStorage(p.workflow),
          }));
          const json = JSON.stringify(syncPayload);
          try {
            window.localStorage.setItem(PROJECTS_STORAGE_KEY, json);
          } catch {
            /* 配额不足时仍写桌面文件，避免列表彻底丢失 */
          }
          mirrorProjectsToDesktopFile(json);
        }
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useBrowserLayoutEffect(() => {
    if (!isElectronMagineShell()) return;
    if (screen === 'welcome') {
      setWelcomeEntrancePhase(2);
      setWelcomeChromeReveal(true);
    } else if (screen === 'canvas') {
      setCanvasEntrancePhase(2);
      setCanvasChromeReveal(true);
    }
  }, [screen]);

  // 当进入画布时重置工作会话
  useEffect(() => {
    if (screen === 'canvas') {
      const today = new Date().toDateString();
      const lastSession = useVoiceAssistantActivityStore.getState().lastSessionDate;

      if (lastSession !== today) {
        useVoiceAssistantActivityStore.getState().resetWorkSession();
        useVoiceAssistantActivityStore.getState().setLastSessionDate(today);
      }
    }
  }, [screen]);

  useEffect(() => {
    if (screen !== 'canvas') {
      setCanvasEntrancePhase(0);
      setCanvasChromeReveal(false);
      return;
    }
    if (isElectronMagineShell()) {
      setCanvasEntrancePhase(2);
      setCanvasChromeReveal(true);
      return;
    }
    setCanvasEntrancePhase(0);
    setCanvasChromeReveal(false);
    let cancelled = false;
    let raf2 = 0;
    let tidPhase: number | undefined;
    let tidRafFallback: number | undefined;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        setCanvasEntrancePhase(1);
        setCanvasChromeReveal(true);
      });
    });
    tidRafFallback = window.setTimeout(() => {
      if (cancelled) return;
      setCanvasEntrancePhase((p) => {
        if (p === 0) {
          setCanvasChromeReveal(true);
          return 1;
        }
        return p;
      });
    }, 80);
    tidPhase = window.setTimeout(() => {
      if (!cancelled) setCanvasEntrancePhase(2);
    }, 1150);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (tidPhase !== undefined) window.clearTimeout(tidPhase);
      if (tidRafFallback !== undefined) window.clearTimeout(tidRafFallback);
    };
  }, [screen]);

  useEffect(() => {
    if (screen !== 'welcome') {
      setWelcomeEntrancePhase(0);
      setWelcomeChromeReveal(false);
      return;
    }
    if (isElectronMagineShell()) {
      setWelcomeEntrancePhase(2);
      setWelcomeChromeReveal(true);
      return;
    }
    setWelcomeEntrancePhase(0);
    setWelcomeChromeReveal(false);
    let cancelled = false;
    let raf2 = 0;
    let tidPhase: number | undefined;
    let tidRafFallback: number | undefined;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        setWelcomeEntrancePhase(1);
        setWelcomeChromeReveal(true);
      });
    });
    tidRafFallback = window.setTimeout(() => {
      if (cancelled) return;
      setWelcomeEntrancePhase((p) => {
        if (p === 0) {
          setWelcomeChromeReveal(true);
          return 1;
        }
        return p;
      });
    }, 80);
    tidPhase = window.setTimeout(() => {
      if (!cancelled) setWelcomeEntrancePhase(2);
    }, 1150);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (tidPhase !== undefined) window.clearTimeout(tidPhase);
      if (tidRafFallback !== undefined) window.clearTimeout(tidRafFallback);
    };
  }, [screen]);

  /** 欢迎页玻璃 UI 入场后短延迟播放入场 MP3（与镜头节奏略错位） */
  useEffect(() => {
    if (screen !== 'welcome' || !welcomeChromeReveal) return;
    const tid = window.setTimeout(() => {
      playWelcomeEntranceSound();
    }, mcF(12));
    return () => window.clearTimeout(tid);
  }, [screen, welcomeChromeReveal]);

  /** 无限画布页玻璃 UI Reveal 后短延迟播放入场 MP3（与欢迎页节奏一致） */
  useEffect(() => {
    if (screen !== 'canvas' || !canvasChromeReveal) return;
    const tid = window.setTimeout(() => {
      playCanvasEntranceSound();
    }, mcF(12));
    return () => window.clearTimeout(tid);
  }, [screen, canvasChromeReveal]);

  const publicProjects = useMemo(
    () =>
      projects.map(({ id, title, coverImage, createdAt, updatedAt }) => ({
        id,
        title,
        coverImage,
        createdAt,
        updatedAt,
      })),
    [projects]
  );

  const saveActiveProject = useCallback(() => {
    if (!activeProjectId) return;
    void (async () => {
      const workflow = saveWorkflow();
      const offloaded = await offloadWorkflowForProjectPersist(workflow);
      setProjects((current) => {
        const next = updateProjectWorkflow(current, activeProjectId, offloaded);
        writeProjects(next, { changedProjectIds: [activeProjectId] });
        return next;
      });
    })();
  }, [activeProjectId, saveWorkflow, setProjects]);

  useEffect(() => {
    const handlePrepareUpdate = () => saveActiveProject();
    window.addEventListener('magine:prepare-update', handlePrepareUpdate);
    return () => window.removeEventListener('magine:prepare-update', handlePrepareUpdate);
  }, [saveActiveProject]);

  const showCanvasToast = useCallback((title: string) => {
    setCanvasToast({ title, visible: false });
    requestAnimationFrame(() => {
      setCanvasToast({ title, visible: true });
    });
    const timer = setTimeout(() => {
      setCanvasToast((prev) => (prev ? { ...prev, visible: false } : null));
      setTimeout(() => setCanvasToast(null), mcF(42));
    }, 3000);
    return timer;
  }, []);

  const enterProject = useCallback(
    (project: StoredProject) => {
      if (project.id !== activeProjectId) {
        loadWorkflow(project.workflow);
      }
      setActiveProjectId(project.id);
      setScreen('canvas');
      showCanvasToast(project.title);
    },
    [activeProjectId, loadWorkflow, showCanvasToast]
  );

  const handleNewProject = useCallback(
    (info: NewCanvasInfo) => {
      const nextIndex = projects.length + 1;
      const project = createProject(
        info.title || `新建画布 ${nextIndex}`,
        info.description || '',
        info.coverImage || null,
        { nodes: [], edges: [] }
      );
      const nextProjects = sortProjects([project, ...projects]).slice(0, MAX_RECENT_PROJECTS);
      writeProjects(nextProjects, { changedProjectIds: [project.id] });
      setProjects(nextProjects);
      clearCanvas();
      setActiveProjectId(project.id);
      setScreen('canvas');
      if (info.startTutorial) {
        setTutorialAutoStartRequest({ courseId: 'canvas-basics', requestId: Date.now() });
        setTutorialOpen(true);
      }
      showCanvasToast(project.title);
    },
    [clearCanvas, projects, showCanvasToast]
  );

  // Agent 创建项目 → 返回结果（不切换屏幕，由 Agent 后续 navigateToCanvas 触发跳转）
  const handleAgentCreateProject = useCallback(
    (title: string, description?: string) => {
      try {
        const project = createProject(title, description || '', null, { nodes: [], edges: [] });
        const nextProjects = sortProjects([project, ...projects]).slice(0, MAX_RECENT_PROJECTS);
        writeProjects(nextProjects, { changedProjectIds: [project.id] });
        setProjects(nextProjects);
        return { success: true as const, projectId: project.id, message: `项目「${title}」已创建` };
      } catch (e) {
        return { success: false as const, message: e instanceof Error ? e.message : '创建项目失败' };
      }
    },
    [projects]
  );

  // Agent 跳转到画布编辑器
  const handleAgentNavigateToCanvas = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (project) {
        enterProject(project);
      } else {
        clearCanvas();
        setActiveProjectId(projectId);
        setScreen('canvas');
        showCanvasToast('画布已就绪');
      }
    },
    [clearCanvas, enterProject, projects, showCanvasToast]
  );

  const handleOpenProject = useCallback(
    (projectId: string) => {
      const project = projects.find((item) => item.id === projectId);
      if (!project) return;
      enterProject(project);
    },
    [enterProject, projects]
  );

  const handleOpenFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const workflow = normalizeWorkflow(JSON.parse(await file.text()));
        const title = file.name.replace(/\.[^.]+$/, '') || `导入画布 ${projects.length + 1}`;
        const project = createProject(title, '', null, workflow);
        const nextProjects = sortProjects([project, ...projects]).slice(0, MAX_RECENT_PROJECTS);
        writeProjects(nextProjects, { changedProjectIds: [project.id] });
        setProjects(nextProjects);
        enterProject(project);
      } catch {
        console.error('无效的工作流文件');
      } finally {
        event.target.value = '';
      }
    },
    [enterProject, projects]
  );

  const handleBackHome = useCallback(() => {
    saveActiveProject();
    setTutorialOpen(false);
    setTutorialAutoStartRequest(null);
    setScreen('welcome');
  }, [saveActiveProject]);

  const handleDuplicateProject = useCallback((projectId: string) => {
    setProjects((current) => {
      const next = duplicateProject(current, projectId);
      const duplicated = next.find((project) => !current.some((item) => item.id === project.id));
      writeProjects(next, { changedProjectIds: duplicated ? [duplicated.id] : [] });
      return next;
    });
  }, []);

  const handleDeleteProject = useCallback((projectId: string) => {
    setProjects((current) => {
      const next = deleteProject(current, projectId);
      writeProjects(next, { changedProjectIds: [], deletedProjectIds: [projectId] });
      return next;
    });
  }, []);

  const handleRenameProject = useCallback((projectId: string, newTitle: string) => {
    setProjects((current) => {
      const next = renameProject(current, projectId, newTitle);
      writeProjects(next, { changedProjectIds: [projectId] });
      return next;
    });
  }, []);

  const handleOpenCanvasApiConfig = useCallback(() => {
    setCanvasApiConfigOpen(true);
    setCanvasApiConfigClosing(true);
    setTimeout(() => {
      setCanvasApiConfigClosing(false);
    }, 20);
  }, []);

  const handleCloseCanvasApiConfig = useCallback(() => {
    setCanvasApiConfigClosing(true);
    setTimeout(() => {
      setCanvasApiConfigOpen(false);
      setCanvasApiConfigClosing(false);
    }, 700);
  }, []);

  return (
    <VoiceAssistantProvider>
      <WorkStyleObserver />
      {voiceAssistantEnabled ? (
        <VoiceAssistantProactiveHost
          idleThresholdMinutes={15}
          workIntensityThresholdHours={2}
        />
      ) : null}
      {IS_WEB_TRIAL && (
        <div className="relative z-[250] flex h-9 shrink-0 items-center justify-center gap-3 border-b border-white/10 bg-black/72 px-4 text-zinc-200 shadow-[0_8px_24px_rgba(0,0,0,0.24)] backdrop-blur-xl">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white">
            <ShieldAlert aria-hidden="true" className="h-3.5 w-3.5" />
            在线试用体验版
          </span>
          <span className="h-3.5 w-px bg-white/14" aria-hidden="true" />
          <span className="text-[12px] font-normal text-zinc-400">
            完整功能在线体验；生成服务请自行配置 API，源码与 API 服务可在欢迎页购买
          </span>
        </div>
      )}
      <main
        className={cn(
          'mc-app-shell relative w-screen overflow-hidden',
          IS_WEB_TRIAL ? 'h-[calc(100vh-36px)]' : 'h-screen'
        )}
      >
        {screen === 'welcome' ? (
          <WelcomePage
            projects={publicProjects}
            entrancePhase={welcomeEntrancePhase}
            chromeReveal={welcomeChromeReveal}
            onNewProject={handleNewProject}
            onOpenFile={handleOpenFile}
            onOpenProject={handleOpenProject}
            onDuplicateProject={handleDuplicateProject}
            onDeleteProject={handleDeleteProject}
            onRenameProject={handleRenameProject}
            agentOpen={welcomeAgentOpen}
            onToggleAgent={() => setWelcomeAgentOpen((prev) => !prev)}
            onAgentCreateProject={handleAgentCreateProject}
            onAgentNavigateToCanvas={handleAgentNavigateToCanvas}
            voiceAssistantEnabled={voiceAssistantEnabled}
          />
        ) : null}
        {activeProjectId ? (
          <div
            className={cn(
              'absolute inset-0 h-full min-h-0 w-full',
              screen !== 'canvas' && 'hidden',
              editorGpuLite && 'mc-editor-gpu-lite',
              canvasEntrancePhase < 2 && 'overflow-hidden'
            )}
            aria-hidden={screen !== 'canvas'}
          >
            <Canvas
              key={activeProjectId}
              gpuLite={editorGpuLite}
              onGpuLiteToggle={toggleEditorGpuLite}
              entrancePhase={canvasEntrancePhase}
              chromeReveal={canvasChromeReveal}
            />
            <Sidebar
              onHome={handleBackHome}
              onOpenApiConfig={handleOpenCanvasApiConfig}
              onOpenTutorial={() => setTutorialOpen(true)}
              chromeReveal={canvasChromeReveal}
            />
            <ApiConfigDialog
              isOpen={canvasApiConfigOpen}
              isClosing={canvasApiConfigClosing}
              onClose={handleCloseCanvasApiConfig}
            />
            <CanvasAgentWindow
              isOpen={agentOpen}
              projectId={activeProjectId}
              onClose={() => setAgentOpen(false)}
              initialPrompt={agentInitialPrompt}
              onInitialPromptConsumed={() => setAgentInitialPrompt('')}
            />
            <TutorialHost
              isOpen={tutorialOpen && screen === 'canvas'}
              autoStartCourseId={tutorialAutoStartRequest?.courseId}
              autoStartRequestId={tutorialAutoStartRequest?.requestId}
              onClose={() => setTutorialOpen(false)}
              onOpenApiConfig={handleOpenCanvasApiConfig}
              isAgentOpen={agentOpen}
              onOpenAgentWindow={() => setAgentOpen(true)}
              onCloseAgentWindow={() => setAgentOpen(false)}
              onOpenAgent={(prompt) => {
                setAgentInitialPrompt(prompt);
                setAgentOpen(true);
              }}
            />
            <CanvasAgentFAB
              onToggle={() => setAgentOpen((prev) => !prev)}
              isOpen={agentOpen}
              visible={screen === 'canvas'}
            />
            {activeProjectId && (
              <>
                <CanvasAutoSave projectId={activeProjectId} setProjects={setProjects} />
                <CanvasEngineeringDiskAutoSave
                  projectId={activeProjectId}
                  metaRef={engineeringMetaRef}
                />
              </>
            )}

            {/* Canvas entry toast — 视口正中 */}
            {canvasToast && (
              <div
                className={cn(
                  'fixed left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 transition-all mc-dur-42f ease-out',
                  canvasToast.visible
                    ? 'opacity-100 scale-100'
                    : 'pointer-events-none opacity-0 scale-95'
                )}
              >
                <div className="flex items-center gap-3 rounded-2xl border border-white/12 bg-[#15191a]/85 px-6 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-300/22 bg-emerald-500/12">
                    <svg className="h-4 w-4 text-emerald-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">进入画布</div>
                    <div className="text-xs text-zinc-400">{canvasToast.title}</div>
                  </div>
                </div>
              </div>
            )}

            {voiceAssistantEnabled ? (
              <CanvasVoiceWave chromeReveal={canvasChromeReveal} />
            ) : null}
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
      </main>
    </VoiceAssistantProvider>
  );
}
