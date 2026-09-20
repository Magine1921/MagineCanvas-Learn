'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  ChevronDown,
  Coins,
  ExternalLink,
  FolderOpen,
  GraduationCap,
  Grid3X3,
  Hand,
  Image as ImageIcon,
  Import,
  MoreHorizontal,
  MousePointer2,
  Network,
  PenLine,
  Play,
  Plus,
  Search,
  Settings,
  ShoppingCart,
  Share2,
  Shapes,
  StickyNote,
  TriangleAlert,
  Type,
  Upload,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { MC_CHROME_ENTRANCE_SCALE_START, MC_CHROME_ENTRANCE_TF } from '@/lib/motion';
import { useAutoHideSearchBar } from '@/hooks/useAutoHideSearchBar';
import WaterBackground from './WaterBackground';
import {
  DEFAULT_INSPIRATION_LAYOUT,
  WelcomeInspirationNote,
  type InspirationLayout,
} from './WelcomeInspirationNote';
import { WelcomeVoiceWave } from '@/components/voice/WelcomeVoiceWave';
import { ApiConfigDialog } from '@/components/seedance/ApiConfigDialog';
import { WelcomeAgent } from '@/components/agent/WelcomeAgent';
import { WelcomeTutorial } from '@/components/tutorial/WelcomeTutorial';

const KIE_PURCHASE_URL = 'https://kie.ai?ref=296742715562ed5361182aa543ee85a5';
const SOURCE_PURCHASE_URL = 'https://h5.m.goofish.com/item?id=1064747523825';
const IS_WEB_TRIAL = process.env.NEXT_PUBLIC_MAGINE_WEB_TRIAL === '1';

export interface WelcomeProject {
  id: string;
  title: string;
  description?: string;
  coverImage?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewCanvasInfo {
  title: string;
  description: string;
  coverImage: string | null;
  startTutorial?: boolean;
}

interface ProjectContextMenuProps {
  projectId: string;
  projectTitle: string;
  position: { x: number; y: number };
  onClose: () => void;
  onOpen: (projectId: string) => void;
  onCopy: (projectId: string) => void;
  onDelete: (projectId: string) => void;
  onRename: (projectId: string, newTitle: string) => void;
}

function ProjectContextMenu({
  projectId,
  projectTitle,
  position,
  onClose,
  onOpen,
  onCopy,
  onDelete,
  onRename,
}: ProjectContextMenuProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(projectTitle);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 200);
  };

  const handleRenameSubmit = () => {
    if (renameTitle.trim()) {
      onRename(projectId, renameTitle.trim());
    }
    handleClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60]"
        onClick={handleClose}
      />

      {/* Menu */}
      <div
        className={cn(
          'mc-popover fixed z-[70] min-w-[180px] overflow-hidden rounded-xl border border-white/12 bg-[#1b2021]/90 shadow-[0_24px_60px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl transition-all mc-dur-12f',
          isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
        )}
        style={{
          left: position.x,
          top: position.y,
        }}
      >
        {isRenaming ? (
          <div className="p-3">
            <input
              ref={renameInputRef}
              type="text"
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit();
                if (e.key === 'Escape') {
                  setIsRenaming(false);
                  setRenameTitle(projectTitle);
                }
              }}
              className="w-full rounded-lg border border-white/10 bg-[#15191a]/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500/70 outline-none transition-colors focus:border-white/22"
              placeholder="输入新名称..."
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsRenaming(false);
                  setRenameTitle(projectTitle);
                }}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleRenameSubmit}
                disabled={!renameTitle.trim()}
                className={cn(
                  'flex-1 rounded-lg border border-orange-300/20 px-3 py-1.5 text-xs font-medium text-orange-100 transition-all',
                  renameTitle.trim()
                    ? 'bg-orange-500/20 hover:bg-orange-500/30 hover:brightness-110'
                    : 'cursor-not-allowed bg-white/5 opacity-50'
                )}
              >
                确定
              </button>
            </div>
          </div>
        ) : (
          <div className="py-2">
            <button
              type="button"
              onClick={() => onOpen(projectId)}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-white/10"
            >
              <FolderOpen className="h-4 w-4" />
              打开
            </button>
            <button
              type="button"
              onClick={() => onCopy(projectId)}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-white/10"
            >
              <Shapes className="h-4 w-4" />
              复制
            </button>
            <button
              type="button"
              onClick={() => setIsRenaming(true)}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-white/10"
            >
              <Type className="h-4 w-4" />
              重命名
            </button>
            <div className="my-2 h-px bg-white/10" />
            <button
              type="button"
              onClick={() => onDelete(projectId)}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
            >
              <X className="h-4 w-4" />
              删除
            </button>
          </div>
        )}
      </div>
    </>
  );
}

interface WelcomePageProps {
  projects: WelcomeProject[];
  /** 0: 镜头拉近+虚焦；1: 后拉变实；2: 镜头节奏收尾 */
  entrancePhase?: 0 | 1 | 2;
  /** 四周 UI：略大缩回、400ms 缓入（与镜头后拉同时，由首页调度） */
  chromeReveal?: boolean;
  onNewProject: (info: NewCanvasInfo) => void;
  onOpenFile: () => void;
  onOpenProject: (projectId: string) => void;
  onDuplicateProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onRenameProject?: (projectId: string, newTitle: string) => void;
  agentOpen: boolean;
  onToggleAgent: () => void;
  onAgentCreateProject: (title: string, description?: string) => { success: boolean; projectId?: string; message: string };
  onAgentNavigateToCanvas: (projectId: string) => void;
  voiceAssistantEnabled?: boolean;
}

function formatProjectTime(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const oneDay = 24 * 60 * 60 * 1000;
  const diff = now.getTime() - date.getTime();

  if (diff < oneDay && date.getDate() === now.getDate()) {
    return `编辑于 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (diff < oneDay * 2) return '编辑于 昨天';
  if (diff < oneDay * 7) return `编辑于 ${Math.max(1, Math.floor(diff / oneDay))} 天前`;
  return `编辑于 ${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`;
}

const INSPIRATION_STORAGE_KEY = 'magine-welcome-inspiration-v1';
const DEFAULT_INSPIRATION_TEXT = '"所有的限制，都是思维的假象。"';

export default function WelcomePage({
  projects,
  entrancePhase = 2,
  chromeReveal = true,
  onNewProject,
  onOpenFile,
  onOpenProject,
  onDuplicateProject,
  onDeleteProject,
  onRenameProject,
  agentOpen,
  onToggleAgent,
  onAgentCreateProject,
  onAgentNavigateToCanvas,
  voiceAssistantEnabled = true,
}: WelcomePageProps) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [isNewCanvasDialogOpen, setIsNewCanvasDialogOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProjectTitle, setSelectedProjectTitle] = useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetTitle, setDeleteTargetTitle] = useState('');
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [tutorialProjectHandoff, setTutorialProjectHandoff] = useState(false);

  // Streaming platforms modal
  const [isStreamingOpen, setIsStreamingOpen] = useState(false);
  const [isStreamingClosing, setIsStreamingClosing] = useState(false);

  const streamingPlatforms = [
    { name: '微信视频号', image: '/streaming/wechat-channel.jpg', hoverScale: 2.2 },
    { name: 'YouTube', image: '/streaming/youtube.png', hoverScale: 2.2 },
    { name: 'B站', image: '/streaming/bilibili.png', hoverScale: 2.2 },
    { name: '小红书', image: '/streaming/xiaohongshu.jpg', hoverScale: 2.2 },
    { name: '快手', image: '/streaming/kuaishou.jpg', hoverScale: 2.2 },
    { name: '抖音', image: '/streaming/douyin.png', hoverScale: 2.2 },
  ];

  const handleOpenStreaming = () => {
    setIsStreamingOpen(true);
    setIsStreamingClosing(true);
    setTimeout(() => {
      setIsStreamingClosing(false);
    }, 20);
  };

  const handleCloseStreaming = () => {
    setIsStreamingClosing(true);
    setTimeout(() => {
      setIsStreamingOpen(false);
      setIsStreamingClosing(false);
    }, 700);
  };

  // Donation modal
  const [isDonationOpen, setIsDonationOpen] = useState(false);
  const [isDonationClosing, setIsDonationClosing] = useState(false);

  const donationPlatforms = [
    { name: '微信赞赏', image: '/streaming/wechat-pay.jpg', hoverScale: 2.2 },
    { name: '支付宝赞赏', image: '/streaming/alipay.jpg', hoverScale: 2.2 },
  ];

  const handleOpenDonation = () => {
    setIsDonationOpen(true);
    setIsDonationClosing(true);
    setTimeout(() => {
      setIsDonationClosing(false);
    }, 20);
  };

  const handleCloseDonation = () => {
    setIsDonationClosing(true);
    setTimeout(() => {
      setIsDonationOpen(false);
      setIsDonationClosing(false);
    }, 700);
  };

  const [isApiConfigOpen, setIsApiConfigOpen] = useState(false);
  const [isApiConfigClosing, setIsApiConfigClosing] = useState(false);

  const handleOpenApiConfig = () => {
    setIsApiConfigOpen(true);
    setIsApiConfigClosing(true);
    setTimeout(() => {
      setIsApiConfigClosing(false);
    }, 20);
  };

  const handleCloseApiConfig = () => {
    setIsApiConfigClosing(true);
    setTimeout(() => {
      setIsApiConfigOpen(false);
      setIsApiConfigClosing(false);
    }, 700);
  };

  // New canvas form state
  const [canvasTitle, setCanvasTitle] = useState('');
  const [canvasDescription, setCanvasDescription] = useState('');
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const prepareNewCanvasDialog = () => {
    setCanvasTitle('');
    setCanvasDescription('');
    setCoverImage(null);
    setIsNewCanvasDialogOpen(true);
    setIsClosing(false);
    setTimeout(() => titleInputRef.current?.focus(), 100);
  };

  const handleOpenNewCanvasDialog = () => {
    setTutorialProjectHandoff(false);
    prepareNewCanvasDialog();
  };

  const handleWelcomeTutorialComplete = () => {
    setIsTutorialOpen(false);
    if (isApiConfigOpen) handleCloseApiConfig();
    setTutorialProjectHandoff(true);
    prepareNewCanvasDialog();
  };

  const handleCloseWelcomeTutorial = () => {
    setIsTutorialOpen(false);
    if (isApiConfigOpen) handleCloseApiConfig();
  };

  const handleCloseNewCanvasDialog = () => {
    setIsClosing(true);
    setTutorialProjectHandoff(false);
    setTimeout(() => {
      setIsNewCanvasDialogOpen(false);
      setIsClosing(false);
    }, 560);
  };

  const handleCreateCanvas = () => {
    if (!canvasTitle.trim()) {
      titleInputRef.current?.focus();
      return;
    }
    onNewProject({
      title: canvasTitle.trim(),
      description: canvasDescription.trim(),
      coverImage,
      startTutorial: tutorialProjectHandoff,
    });
    handleCloseNewCanvasDialog();
  };

  const handleCoverUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setCoverImage(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      handleCreateCanvas();
    }
    if (event.key === 'Escape') {
      handleCloseNewCanvasDialog();
    }
  };

  // Context menu handlers
  const handleMenuOpen = (event: React.MouseEvent, project: WelcomeProject) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.right - 180, y: rect.bottom + 4 });
    setSelectedProjectId(project.id);
    setSelectedProjectTitle(project.title);
    setOpenMenuId(project.id);
  };

  const handleMenuClose = () => {
    setOpenMenuId(null);
    setSelectedProjectId(null);
    setSelectedProjectTitle('');
  };

  const handleMenuAction = (action: string, projectId: string) => {
    switch (action) {
      case 'open':
        onOpenProject(projectId);
        break;
      case 'copy':
        if (onDuplicateProject) {
          onDuplicateProject(projectId);
        }
        break;
      case 'delete':
        // Show custom delete confirmation dialog
        const project = projects.find((p) => p.id === projectId);
        setDeleteTargetId(projectId);
        setDeleteTargetTitle(project?.title || '');
        setIsDeleteConfirmOpen(true);
        break;
      case 'rename':
        // Rename is handled in the context menu component
        break;
    }
    handleMenuClose();
  };

  const handleDeleteConfirm = () => {
    if (deleteTargetId && onDeleteProject) {
      onDeleteProject(deleteTargetId);
    }
    setIsDeleteConfirmOpen(false);
    setDeleteTargetId(null);
    setDeleteTargetTitle('');
  };

  const handleDeleteCancel = () => {
    setIsDeleteConfirmOpen(false);
    setDeleteTargetId(null);
    setDeleteTargetTitle('');
  };

  const handleRename = (projectId: string, newTitle: string) => {
    if (onRenameProject) {
      onRenameProject(projectId, newTitle);
    }
  };

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? projects.filter((project) => project.title.toLowerCase().includes(normalized))
      : projects;
    return showAll ? filtered : filtered.slice(0, 12);
  }, [projects, query, showAll]);

  const { collapsed: searchCollapsed, bump: bumpSearchIdle, expand: expandSearch, searchShellHandlers } =
    useAutoHideSearchBar(10_000, chromeReveal);

  const uiIn = chromeReveal;

  const [inspirationLayout, setInspirationLayout] = useState<InspirationLayout>(DEFAULT_INSPIRATION_LAYOUT);
  const [inspirationText, setInspirationText] = useState(DEFAULT_INSPIRATION_TEXT);
  const [inspirationHydrated, setInspirationHydrated] = useState(false);
  const inspirationDockTargetRef = useRef<HTMLElement | null>(null);
  const [inspirationSlotPreviewH, setInspirationSlotPreviewH] = useState(0);
  const [inspirationFloatDragActive, setInspirationFloatDragActive] = useState(false);

  const handleInspirationSlotPreviewHeight = useCallback((px: number) => {
    setInspirationSlotPreviewH(px);
  }, []);

  const handleInspirationFloatDragActive = useCallback((active: boolean) => {
    setInspirationFloatDragActive(active);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(INSPIRATION_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { layout?: Partial<InspirationLayout>; text?: string };
        setInspirationLayout({ ...DEFAULT_INSPIRATION_LAYOUT, ...p.layout });
        if (typeof p.text === 'string') setInspirationText(p.text);
      }
    } catch {
      /* noop */
    }
    setInspirationHydrated(true);
  }, []);

  useEffect(() => {
    if (!inspirationHydrated) return;
    try {
      localStorage.setItem(
        INSPIRATION_STORAGE_KEY,
        JSON.stringify({ layout: inspirationLayout, text: inspirationText })
      );
    } catch {
      /* noop */
    }
  }, [inspirationHydrated, inspirationLayout, inspirationText]);

  useEffect(() => {
    if (inspirationLayout.docked) {
      setInspirationSlotPreviewH(0);
      setInspirationFloatDragActive(false);
    }
  }, [inspirationLayout.docked]);

  const handleResetWelcomePanels = () => {
    setInspirationLayout(DEFAULT_INSPIRATION_LAYOUT);
  };

  const inspirationSlotReserveH = inspirationLayout.docked ? inspirationLayout.h : inspirationSlotPreviewH;
  const inspirationSlotGapBottom =
    inspirationLayout.docked
      ? 32
      : inspirationSlotPreviewH <= 0
        ? 0
        : Math.round((32 * inspirationSlotPreviewH) / Math.max(120, inspirationLayout.h));

  return (
    <div
      className={cn(
        'mc-welcome-shell relative h-full w-full overflow-hidden bg-[#040505]',
        entrancePhase === 0 && 'mc-welcome-entrance--pull'
      )}
    >
      <div className="mc-welcome-entrance-scene-inner pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <WaterBackground />
        <main
          data-tutorial-id="welcome-primary-actions"
          className="pointer-events-auto absolute left-[19.6vw] top-[24.5vh] z-10"
        >
          <h2 className="text-[56px] font-light leading-none tracking-[0.02em] text-zinc-50">欢迎回来</h2>
          <p className="mt-7 text-[22px] font-light tracking-wide text-zinc-100/92">释放灵感，创造无限可能。</p>
          <p className="mt-3 text-[20px] font-light text-zinc-300/82">Infinite Canvas, infinite Possibilities.</p>
          <div className="mt-12 flex items-center gap-6">
            <button
              type="button"
              onClick={handleOpenNewCanvasDialog}
              className="group flex h-16 min-w-[164px] items-center justify-center gap-6 rounded-xl border border-white/22 bg-white/[0.08] px-7 text-lg font-medium text-zinc-100 shadow-[0_0_32px_rgba(255,255,255,0.14),0_22px_50px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-xl transition-all hover:border-white/32 hover:bg-white/[0.12] hover:shadow-[0_0_44px_rgba(255,255,255,0.2),0_22px_50px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.26)]"
            >
              新建画布
              <Plus className="h-5 w-5 drop-shadow-[0_0_10px_rgba(255,255,255,0.35)] transition-transform group-hover:rotate-90" />
            </button>
            <button
              type="button"
              onClick={onOpenFile}
              className="flex h-16 min-w-[164px] items-center justify-center gap-6 rounded-xl border border-white/22 bg-white/[0.08] px-7 text-lg font-medium text-zinc-100 shadow-[0_0_32px_rgba(255,255,255,0.14),0_22px_50px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-xl transition-all hover:border-white/32 hover:bg-white/[0.12] hover:shadow-[0_0_44px_rgba(255,255,255,0.2),0_22px_50px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.26)]"
            >
              打开文件
              <FolderOpen className="h-5 w-5 drop-shadow-[0_0_10px_rgba(255,255,255,0.35)]" />
            </button>
          </div>
        </main>
      </div>

      {/* Header */}
      <header
        data-tutorial-id="welcome-brand"
        className={cn(
          'absolute left-8 top-8 z-10 origin-left',
          uiIn
            ? cn('translate-x-0 scale-100 visible', MC_CHROME_ENTRANCE_TF)
            : cn('-translate-x-[110vw]', MC_CHROME_ENTRANCE_SCALE_START, 'invisible pointer-events-none transition-none')
        )}
      >
        <div className="leading-tight">
          <h1
            className="text-[30px] font-semibold leading-none tracking-[0] text-zinc-50"
            style={{ fontFamily: '"Avenir Next", "Segoe UI Variable Display", "Segoe UI", sans-serif' }}
          >
            Magine Canvas
          </h1>
          <p className="mt-1 text-sm text-zinc-300/88">AI Workflow Builder</p>
        </div>
      </header>

      {searchCollapsed && uiIn && (
        <button
          type="button"
          aria-label="展开搜索框"
          onClick={expandSearch}
          className="fixed left-1/2 top-0 z-[80] flex min-h-4 w-[128px] items-end justify-center rounded-b-md border border-t-0 border-white/14 bg-[#15191a]/90 pb-1 pt-0.5 text-zinc-400 shadow-[0_10px_32px_rgba(0,0,0,0.42)] backdrop-blur-md transition-colors hover:border-white/22 hover:bg-[#1a1f20]/95 hover:text-zinc-200"
        >
          <ChevronDown className="h-3 w-3" strokeWidth={2.25} />
        </button>
      )}

      <div
        className={cn(
          'absolute left-1/2 top-8 z-10 w-[426px] origin-top -translate-x-1/2',
          uiIn
            ? cn('translate-y-0 scale-100 visible', MC_CHROME_ENTRANCE_TF)
            : cn('-translate-y-[110vh]', MC_CHROME_ENTRANCE_SCALE_START, 'invisible pointer-events-none transition-none')
        )}
      >
        <div
          className={cn(
            'group flex h-14 w-full items-center gap-3 rounded-[24px] border border-white/12 bg-[#15191a]/35 px-5 text-zinc-300 shadow-[0_22px_60px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-2xl transition-transform mc-dur-30f ease-out focus-within:border-white/12 focus-within:!outline-none focus-within:!ring-0',
            searchCollapsed && uiIn && '-translate-y-[calc(100%+40px)] pointer-events-none'
          )}
          {...searchShellHandlers}
        >
        <Search className="h-5 w-5 text-zinc-100/88" />
        <input
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-400/86 !outline-none !ring-0 focus:!outline-none focus:!ring-0 focus-visible:!outline-none"
          placeholder="搜索文件、画布、插件..."
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            bumpSearchIdle();
          }}
        />
        </div>
      </div>

      {/* Top right buttons */}
      <div
        className={cn(
          'mc-welcome-top-actions absolute right-8 top-8 z-10 flex origin-right items-center gap-3',
          'max-[1600px]:[&_.mc-ref-share-button]:gap-0 max-[1600px]:[&_.mc-ref-share-button]:px-3 max-[1600px]:[&_.mc-ref-share-button]:text-[0px]',
          IS_WEB_TRIAL && 'gap-2 [&_.mc-ref-share-button]:!gap-2 [&_.mc-ref-share-button]:!px-3 [&_.mc-ref-share-button]:!text-[13px]',
          uiIn
            ? cn('translate-x-0 scale-100 visible', MC_CHROME_ENTRANCE_TF)
            : cn('translate-x-[110vw]', MC_CHROME_ENTRANCE_SCALE_START, 'invisible pointer-events-none transition-none')
        )}
      >
        <a
          href="https://magine-trial.magine1921.workers.dev/"
          target="_blank"
          rel="noopener noreferrer"
          className="mc-ref-share-button mc-welcome-official-button"
          title="正式版"
          aria-label="在系统默认浏览器打开正式版"
        >
          <ExternalLink className="h-5 w-5 text-zinc-100 drop-shadow-[0_0_10px_rgba(255,255,255,0.22)]" />
          正式版
        </a>
        {IS_WEB_TRIAL && (
          <a
            href={SOURCE_PURCHASE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mc-ref-share-button"
            title="源码购买"
            aria-label="源码购买"
          >
            <ShoppingCart className="h-5 w-5 text-zinc-100 drop-shadow-[0_0_10px_rgba(255,255,255,0.22)]" />
            源码购买
          </a>
        )}
        <a
          href={KIE_PURCHASE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mc-ref-share-button"
          title="API购买"
          aria-label="API购买"
        >
          <Coins className="h-5 w-5 text-zinc-100 drop-shadow-[0_0_10px_rgba(255,255,255,0.22)]" />
          API购买
        </a>
        <button className="mc-ref-share-button" type="button" onClick={handleOpenStreaming} title="流媒体平台" aria-label="流媒体平台">
          <Play className="h-5 w-5 text-zinc-100 drop-shadow-[0_0_10px_rgba(255,255,255,0.22)]" />
          流媒体平台
        </button>
        <button className="mc-ref-share-button" type="button" onClick={handleOpenDonation} title="赞赏作者" aria-label="赞赏作者">
          <Coins className="h-5 w-5 text-zinc-100 drop-shadow-[0_0_10px_rgba(255,255,255,0.22)]" />
          赞赏作者
        </button>
        <button
          data-tutorial-id="welcome-api-config"
          className="mc-ref-share-button"
          type="button"
          onClick={handleOpenApiConfig}
          title="API配置"
          aria-label="打开API配置"
        >
          <Settings className="h-5 w-5" />
          API配置
        </button>
        <button
          data-tutorial-id="welcome-agent"
          className={cn(
            'mc-ref-share-button',
            agentOpen && 'border-violet-400/35 bg-violet-500/20 shadow-[0_0_22px_rgba(139,92,246,0.3)]'
          )}
          type="button"
          onClick={onToggleAgent}
          title="AI助手"
          aria-label="打开AI助手"
        >
          <Bot className={cn('h-5 w-5', agentOpen && 'text-violet-100 drop-shadow-[0_0_10px_rgba(139,92,246,0.6)]')} />
          AI助手
        </button>
        <button
          className={cn(
            'mc-ref-share-button',
            isTutorialOpen && 'border-amber-200/35 bg-amber-200/12 shadow-[0_0_22px_rgba(251,191,36,0.18)]'
          )}
          type="button"
          onClick={() => setIsTutorialOpen(true)}
          title="教学模式"
          aria-label="打开欢迎页教学模式"
        >
          <GraduationCap className="h-5 w-5" />
          教学模式
        </button>
      </div>

      {/* Right side panels：灵感槽位高度 + 下边距缓动，项目区随之上移 / 让位 */}
      <section
        data-tutorial-id="welcome-workspace-panels"
        ref={inspirationDockTargetRef}
        className={cn(
          'absolute right-8 top-[144px] z-10 hidden w-[508px] origin-right flex flex-col xl:flex',
          uiIn
            ? cn('translate-x-0 scale-100 visible', MC_CHROME_ENTRANCE_TF)
            : cn('translate-x-[110vw]', MC_CHROME_ENTRANCE_SCALE_START, 'invisible pointer-events-none transition-none')
        )}
      >
        <div
          className={cn(
            'shrink-0 overflow-hidden',
            inspirationFloatDragActive && !inspirationLayout.docked
              ? 'transition-none'
              : 'transition-[height,margin-bottom] duration-500 ease-[cubic-bezier(0.33,1,0.36,1)] will-change-[height,margin-bottom]'
          )}
          style={{
            height: inspirationSlotReserveH,
            marginBottom: inspirationSlotGapBottom,
          }}
        >
          {inspirationLayout.docked && (
            <div className="h-full min-h-0 w-full overflow-visible">
              <WelcomeInspirationNote
                layout={inspirationLayout}
                onLayoutChange={setInspirationLayout}
                text={inspirationText}
                onTextChange={setInspirationText}
                dockTargetRef={inspirationDockTargetRef}
                onSlotPreviewHeightChange={handleInspirationSlotPreviewHeight}
                onFloatDragActiveChange={handleInspirationFloatDragActive}
                chromeReveal={uiIn}
              />
            </div>
          )}
        </div>

        <div className="mc-ref-panel p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-100">最近项目</h2>
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="text-sm text-zinc-300/82 hover:text-zinc-100"
            >
              {showAll ? '收起' : '查看全部'}
            </button>
          </div>
          <div className="max-h-[400px] space-y-4 overflow-y-auto">
            {visibleProjects.length === 0 ? (
              <button
                type="button"
                onClick={handleOpenNewCanvasDialog}
                className="flex w-full items-center gap-4 rounded-xl p-2 text-left transition hover:bg-white/7"
              >
                <div className="h-14 w-14 rounded-xl border border-white/8 bg-[radial-gradient(circle_at_66%_30%,#ffd7ad_0,#f97316_25%,#111719_62%,#050606_100%)]" />
                <div>
                  <div className="text-[15px] font-semibold text-zinc-100">创建你的第一个项目</div>
                  <div className="mt-1 text-sm text-zinc-500">点击新建画布开始</div>
                </div>
              </button>
            ) : (
              visibleProjects.map((project, index) => (
                <div
                  key={project.id}
                  className="group flex w-full items-center gap-4 rounded-xl p-2 transition hover:bg-white/7"
                >
                  <button
                    type="button"
                    onClick={() => onOpenProject(project.id)}
                    className="flex min-w-0 flex-1 items-center gap-4 text-left"
                  >
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/8 bg-[#141719] shadow-inner shadow-white/5">
                      <div
                        className={cn(
                          'h-full w-full',
                          index % 4 === 3
                            ? 'bg-[linear-gradient(135deg,#f3f4f6,#b7b2aa)]'
                            : 'bg-[radial-gradient(circle_at_66%_30%,#ffd7ad_0,#f97316_25%,#111719_62%,#050606_100%)]'
                        )}
                      />
                      {project.coverImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={project.coverImage}
                          alt={`${project.title}封面`}
                          draggable={false}
                          onError={(event) => event.currentTarget.remove()}
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold text-zinc-100">{project.title}</div>
                      <div className="mt-1 text-sm text-zinc-500">{formatProjectTime(project.updatedAt)}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleMenuOpen(e, project)}
                    className="shrink-0 rounded-lg p-1.5 text-zinc-300/70 opacity-0 transition-all hover:bg-white/10 hover:text-zinc-100 group-hover:opacity-100"
                    title="更多操作"
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {!inspirationLayout.docked && (
        <div className="hidden xl:contents">
          <WelcomeInspirationNote
            layout={inspirationLayout}
            onLayoutChange={setInspirationLayout}
            text={inspirationText}
            onTextChange={setInspirationText}
            dockTargetRef={inspirationDockTargetRef}
            onSlotPreviewHeightChange={handleInspirationSlotPreviewHeight}
            onFloatDragActiveChange={handleInspirationFloatDragActive}
            chromeReveal={uiIn}
          />
        </div>
      )}

      <div
        className={cn(
          'absolute bottom-8 right-8 z-10 flex origin-bottom-right flex-col items-end gap-2',
          uiIn
            ? cn('translate-y-0 scale-100 visible', MC_CHROME_ENTRANCE_TF)
            : cn('translate-y-[110vh]', MC_CHROME_ENTRANCE_SCALE_START, 'invisible pointer-events-none transition-none')
        )}
      >
        <button
          type="button"
          onClick={handleResetWelcomePanels}
          className="rounded-xl border border-white/14 bg-[#15191a]/40 px-4 py-2 text-xs font-medium text-zinc-200 shadow-[0_12px_36px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-colors hover:border-white/26 hover:bg-white/[0.09] hover:text-zinc-50 hover:shadow-[0_0_22px_rgba(255,255,255,0.1)]"
        >
          一键整理画布
        </button>
      </div>

      {voiceAssistantEnabled ? <WelcomeVoiceWave chromeReveal={uiIn} /> : null}

      <WelcomeAgent
        isOpen={agentOpen}
        onClose={onToggleAgent}
        onCreateProject={onAgentCreateProject}
        onNavigateToCanvas={onAgentNavigateToCanvas}
      />

      <WelcomeTutorial
        isOpen={isTutorialOpen}
        isApiConfigOpen={isApiConfigOpen}
        onClose={handleCloseWelcomeTutorial}
        onComplete={handleWelcomeTutorialComplete}
        onOpenApiConfig={handleOpenApiConfig}
        onCloseApiConfig={handleCloseApiConfig}
      />

      {/* ===== New Canvas Dialog ===== */}
      {isNewCanvasDialogOpen && (
        <>
          {/* Backdrop */}
          <div
            className={cn(
              'fixed inset-0 z-40 bg-black/40 backdrop-blur-xl transition-opacity mc-dur-34f',
              isClosing ? 'opacity-0' : 'opacity-100'
            )}
            onClick={handleCloseNewCanvasDialog}
          />

          {/* Dialog */}
          <div
            className={cn(
              'mc-welcome-new-canvas-dialog mc-popover fixed left-1/2 top-1/2 z-50 w-[520px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/12 bg-[#15191a]/45 shadow-[0_36px_100px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-2xl',
              isClosing ? 'closing' : ''
            )}
            onKeyDown={handleKeyDown}
          >
            {/* Dialog Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/18 bg-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_22px_rgba(255,255,255,0.06)]">
                  <Plus className="h-4 w-4 text-zinc-100/90" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-zinc-100">新建画布</div>
                  <div className="text-[10px] text-zinc-500">创建一个新的 AI 工作流画布</div>
                </div>
              </div>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/8 text-sm text-zinc-400 transition-colors hover:border-white/28 hover:bg-white/10 hover:text-zinc-100"
                type="button"
                onClick={handleCloseNewCanvasDialog}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Dialog Body */}
            <div className="p-6">
              {tutorialProjectHandoff && (
                <div className="mb-4 rounded-lg border border-amber-200/14 bg-amber-300/[0.06] px-3 py-2 text-xs text-amber-100/80">
                  创建成功后将自动进入画布基础教学
                </div>
              )}
              {/* Cover Image Upload */}
              <div className="mb-5">
                <label className="mb-2 block text-xs font-medium text-zinc-400">封面</label>
                <div
                  className={cn(
                    'group relative flex h-36 w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-all mc-dur-12f',
                    coverImage
                      ? 'border-white/28 bg-[#1a1a1e] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_24px_rgba(255,255,255,0.04)]'
                      : 'border-white/12 bg-[#15191a]/60 hover:border-white/30 hover:bg-[#1a1e20]'
                  )}
                  onClick={() => coverInputRef.current?.click()}
                >
                  {coverImage ? (
                    <>
                      <img
                        src={coverImage}
                        alt="封面预览"
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                        <Upload className="h-6 w-6 text-white" />
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-zinc-500">
                      <ImageIcon className="h-8 w-8" />
                      <span className="text-xs">点击上传封面图片</span>
                      <span className="text-[10px] text-zinc-600">支持 JPG、PNG 格式</span>
                    </div>
                  )}
                </div>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleCoverUpload}
                  className="hidden"
                />
              </div>

              {/* Canvas Title */}
              <div className="mb-4">
                <label className="mb-2 block text-xs font-medium text-zinc-400">
                  画布名称 <span className="text-white/45">*</span>
                </label>
                <input
                  ref={titleInputRef}
                  type="text"
                  value={canvasTitle}
                  onChange={(e) => setCanvasTitle(e.target.value)}
                  placeholder="给你的画布取个名字..."
                  maxLength={50}
                  className="w-full rounded-xl border border-white/10 bg-[#15191a]/60 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500/70 outline-none transition-all focus:border-white/28"
                />
              </div>

              {/* Canvas Description */}
              <div className="mb-2">
                <label className="mb-2 block text-xs font-medium text-zinc-400">描述</label>
                <textarea
                  value={canvasDescription}
                  onChange={(e) => setCanvasDescription(e.target.value)}
                  placeholder="简要描述这个画布的用途..."
                  rows={3}
                  maxLength={200}
                  className="w-full resize-none rounded-xl border border-white/10 bg-[#15191a]/60 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500/70 outline-none transition-all focus:border-white/28"
                />
              </div>
            </div>

            {/* Dialog Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-white/10 px-6 py-4">
              <button
                type="button"
                onClick={handleCloseNewCanvasDialog}
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:bg-white/10 hover:text-zinc-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateCanvas}
                disabled={!canvasTitle.trim()}
                className={cn(
                  'flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-medium transition-all',
                  canvasTitle.trim()
                    ? 'border-white/20 bg-white/[0.09] text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_28px_rgba(255,255,255,0.08)] hover:border-white/28 hover:bg-white/[0.12] hover:shadow-[0_0_34px_rgba(255,255,255,0.1)]'
                    : 'cursor-not-allowed border-white/8 bg-white/5 text-zinc-500 opacity-50'
                )}
              >
                {tutorialProjectHandoff ? '创建并开始教学' : '创建画布'}
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}

      <ApiConfigDialog
        isOpen={isApiConfigOpen}
        isClosing={isApiConfigClosing}
        onClose={handleCloseApiConfig}
      />

      {/* Project Context Menu */}
      {openMenuId && selectedProjectId && (
        <ProjectContextMenu
          projectId={selectedProjectId}
          projectTitle={selectedProjectTitle}
          position={menuPosition}
          onClose={handleMenuClose}
          onOpen={(id) => handleMenuAction('open', id)}
          onCopy={(id) => handleMenuAction('copy', id)}
          onDelete={(id) => handleMenuAction('delete', id)}
          onRename={handleRename}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {isDeleteConfirmOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-xl"
            onClick={handleDeleteCancel}
          />

          {/* Dialog */}
          <div
            className="mc-popover fixed left-1/2 top-1/2 z-[90] w-[420px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/12 bg-[#15191a]/45 shadow-[0_36px_100px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-2xl"
          >
            {/* Dialog Header */}
            <div className="flex items-center gap-3 border-b border-white/10 px-6 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-400/20 bg-red-500/10">
                <TriangleAlert className="h-4 w-4 text-red-400" />
              </div>
              <div className="text-sm font-semibold text-zinc-100">删除确认</div>
            </div>

            {/* Dialog Body */}
            <div className="px-6 py-5">
              <p className="text-sm leading-relaxed text-zinc-300">
                确定要删除项目 <span className="font-medium text-orange-300">"{deleteTargetTitle}"</span> 吗？
              </p>
              <p className="mt-2 text-xs text-zinc-500">此操作不可恢复，所有数据将被永久删除。</p>
            </div>

            {/* Dialog Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-white/10 px-6 py-4">
              <button
                type="button"
                onClick={handleDeleteCancel}
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:bg-white/10 hover:text-zinc-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/20 px-5 py-2.5 text-sm font-medium text-red-300 shadow-[0_18px_40px_rgba(220,38,38,0.2),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all hover:bg-red-500/30 hover:brightness-110"
              >
                确认删除
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Streaming Platforms Modal */}
      {isStreamingOpen && (
        <>
          {/* Backdrop */}
          <div
            className={cn(
              'fixed inset-0 z-40 bg-black/40 backdrop-blur-xl transition-opacity mc-dur-42f',
              isStreamingClosing ? 'opacity-0' : 'opacity-100'
            )}
            onClick={handleCloseStreaming}
          />

          {/* Modal */}
          <div
            className={cn(
              'fixed left-1/2 z-50 -translate-x-1/2 transition-all mc-dur-42f ease-out',
              isStreamingClosing
                ? 'top-full opacity-0 pointer-events-none'
                : 'top-1/2 -translate-y-1/2 opacity-100'
            )}
          >
            <div className="overflow-hidden rounded-3xl border border-white/12 bg-[#15191a]/45 shadow-[0_36px_100px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-8 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/22 bg-white/[0.07] shadow-[0_0_22px_rgba(255,255,255,0.14),inset_0_1px_0_rgba(255,255,255,0.14)]">
                  <Play className="h-4 w-4 text-zinc-100 drop-shadow-[0_0_10px_rgba(255,255,255,0.28)]" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-zinc-100">流媒体平台</div>
                  <div className="text-[10px] text-zinc-500">扫码关注我们的各平台账号</div>
                </div>
              </div>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/8 text-sm text-zinc-400 transition-colors hover:border-white/28 hover:bg-white/[0.12] hover:text-zinc-100 hover:shadow-[0_0_18px_rgba(255,255,255,0.1)]"
                type="button"
                onClick={handleCloseStreaming}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* QR Code Grid */}
            <div className="grid grid-cols-3 gap-5 p-8">
              {streamingPlatforms.map((platform) => (
                <div
                  key={platform.name}
                  className="flex flex-col items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-5 transition-all hover:border-white/16 hover:bg-white/[0.06]"
                >
                  <div className="flex h-[100px] w-[100px] items-center justify-center overflow-hidden rounded-xl bg-white [&:has(img:hover)]:overflow-visible">
                    <img
                      src={platform.image}
                      alt={platform.name}
                      className="h-full w-full cursor-pointer rounded-xl object-contain transition-transform mc-dur-12f ease-out hover:scale-[var(--hover-scale)]"
                      style={{
                        '--hover-scale': platform.hoverScale,
                        transformOrigin: 'center',
                      } as React.CSSProperties}
                    />
                  </div>
                  <span className="text-xs font-medium text-zinc-300/90">{platform.name}</span>
                </div>
              ))}
            </div>
          </div>
          </div>
        </>
      )}

      {/* Donation Modal */}
      {isDonationOpen && (
        <>
          {/* Backdrop */}
          <div
            className={cn(
              'fixed inset-0 z-40 bg-black/40 backdrop-blur-xl transition-opacity mc-dur-42f',
              isDonationClosing ? 'opacity-0' : 'opacity-100'
            )}
            onClick={handleCloseDonation}
          />

          {/* Modal */}
          <div
            className={cn(
              'fixed left-1/2 z-50 -translate-x-1/2 transition-all mc-dur-42f ease-out',
              isDonationClosing
                ? 'top-full opacity-0 pointer-events-none'
                : 'top-1/2 -translate-y-1/2 opacity-100'
            )}
          >
            <div className="overflow-hidden rounded-3xl border border-white/12 bg-[#15191a]/45 shadow-[0_36px_100px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-8 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/22 bg-white/[0.07] shadow-[0_0_22px_rgba(255,255,255,0.14),inset_0_1px_0_rgba(255,255,255,0.14)]">
                  <Coins className="h-4 w-4 text-zinc-100 drop-shadow-[0_0_10px_rgba(255,255,255,0.28)]" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-zinc-100">赞赏作者</div>
                  <div className="text-[10px] text-zinc-500">感谢您的支持与鼓励</div>
                </div>
              </div>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/8 text-sm text-zinc-400 transition-colors hover:border-white/28 hover:bg-white/[0.12] hover:text-zinc-100 hover:shadow-[0_0_18px_rgba(255,255,255,0.1)]"
                type="button"
                onClick={handleCloseDonation}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* QR Code Grid */}
            <div className="flex justify-center gap-8 p-8">
              {donationPlatforms.map((platform) => (
                <div
                  key={platform.name}
                  className="flex flex-col items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-6 transition-all hover:border-white/16 hover:bg-white/[0.06]"
                >
                  <div className="flex h-[120px] w-[120px] items-center justify-center overflow-hidden rounded-xl bg-white [&:has(img:hover)]:overflow-visible">
                    <img
                      src={platform.image}
                      alt={platform.name}
                      className="h-full w-full cursor-pointer rounded-xl object-contain transition-transform mc-dur-12f ease-out hover:scale-[var(--hover-scale)]"
                      style={{
                        '--hover-scale': platform.hoverScale,
                        transformOrigin: 'center',
                      } as React.CSSProperties}
                    />
                  </div>
                  <span className="text-xs font-medium text-zinc-300/90">{platform.name}</span>
                </div>
              ))}
            </div>
          </div>
          </div>
        </>
      )}
    </div>
  );
}
