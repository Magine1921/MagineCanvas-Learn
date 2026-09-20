'use client';

import {
  createElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react';
import { Handle, NodeProps, Position } from 'reactflow';
import { NodeResizer } from '@reactflow/node-resizer';
import {
  ArrowLeft,
  ArrowRight,
  Download,
  ExternalLink,
  Globe2,
  GripVertical,
  Image as ImageIcon,
  Music,
  RefreshCw,
  Search,
  Video,
  X,
} from 'lucide-react';
import { CanvasNodeData, useCanvasStore } from '../canvas/CanvasStore';
import { CompactNodeFrame } from '../canvas/CompactNodeFrame';
import {
  GENERATED_AUDIO_DND_TYPE,
  GENERATED_IMAGE_DND_TYPE,
  GENERATED_VIDEO_DND_TYPE,
} from '@/lib/generated-image-dnd';
import { cn } from '@/lib/utils';
import { registerCanvasNodeActionHandler } from '@/lib/canvas-generation-bridge';

interface BrowserMediaItem {
  id: string;
  fileName: string;
  fileType: 'image' | 'video' | 'audio';
  mimeType?: string;
  url: string;
  createdAt: number;
}

interface BrowserNodeData extends CanvasNodeData {
  browserUrl?: string;
  browserWidth?: number;
  browserHeight?: number;
  browserDownloads?: BrowserMediaItem[];
}

type BrowserWebview = HTMLElement & {
  getWebContentsId: () => number;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  loadURL: (url: string) => Promise<void>;
  executeJavaScript: (code: string) => Promise<unknown>;
  getURL: () => string;
};

const DEFAULT_BROWSER_URL = 'https://chatgpt.com/';
const DEFAULT_SEARCH_URL = 'https://www.bing.com/search?q=';
const MAX_BROWSER_DOWNLOADS = 50;
const MIN_BROWSER_WIDTH = 480;
const MIN_BROWSER_HEIGHT = 360;
const FORCE_SAME_TAB_NAVIGATION_SCRIPT = String.raw`
  (() => {
    if (window.__magineSameTabNavigationInstalled) return true;
    window.__magineSameTabNavigationInstalled = true;
    document.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const source = event.target;
      const anchor = source instanceof Element ? source.closest('a[href]') : null;
      if (!anchor || String(anchor.target || '').toLowerCase() !== '_blank') return;
      const href = anchor.href;
      if (!/^https?:\/\//i.test(href)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(href);
    }, true);
    return true;
  })()
`;

function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_BROWSER_URL;
  const isExplicitUrl = /^https?:\/\//i.test(trimmed);
  const isLocalAddress = /^(?:localhost|127(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/i.test(trimmed);
  const isIpv4Address = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#]|$)/.test(trimmed);
  const looksLikeDomain = /^[^\s/]+\.[^\s/]{2,}(?:[/?#]|$)/u.test(trimmed);
  if (!isExplicitUrl && !isLocalAddress && !isIpv4Address && !looksLikeDomain) {
    return `${DEFAULT_SEARCH_URL}${encodeURIComponent(trimmed)}`;
  }
  const withProtocol = isExplicitUrl
    ? trimmed
    : `${isLocalAddress || isIpv4Address ? 'http' : 'https'}://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : DEFAULT_BROWSER_URL;
  } catch {
    return DEFAULT_BROWSER_URL;
  }
}

function BrowserNode({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const nodeData = data as BrowserNodeData;
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const updateBrowserGeometry = useCanvasStore((state) => state.updateBrowserGeometry);
  const isExpanded = useCanvasStore((state) => state.selectedNode?.id === id);
  const [webview, setWebview] = useState<BrowserWebview | null>(null);
  const [address, setAddress] = useState(nodeData.browserUrl || DEFAULT_BROWSER_URL);
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [liveResize, setLiveResize] = useState(false);
  const handleWebviewRef = useCallback((element: BrowserWebview | null) => {
    setWebview((current) => current === element ? current : element);
  }, []);
  const downloads = useMemo(
    () => Array.isArray(nodeData.browserDownloads) ? nodeData.browserDownloads : [],
    [nodeData.browserDownloads],
  );
  const currentUrl = normalizeBrowserUrl(nodeData.browserUrl || DEFAULT_BROWSER_URL);
  const [webviewInitialUrl] = useState(currentUrl);
  const partition = useMemo(
    () => `persist:magine-browser-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [id],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setAddress(nodeData.browserUrl || DEFAULT_BROWSER_URL);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [nodeData.browserUrl]);

  useEffect(() => {
    const unsubscribe = window.magineDesktop?.onBrowserMediaDownloaded?.((media) => {
      if (media.nodeId !== id) return;
      const latestNode = useCanvasStore.getState().nodes.find((node) => node.id === id);
      const latest = Array.isArray(latestNode?.data.browserDownloads)
        ? latestNode.data.browserDownloads as BrowserMediaItem[]
        : [];
      updateNodeData(id, {
        browserDownloads: [media, ...latest.filter((item) => item.id !== media.id)]
          .slice(0, MAX_BROWSER_DOWNLOADS),
      });
    });
    return unsubscribe;
  }, [id, updateNodeData]);

  useEffect(() => {
    if (!webview) return;
    const updateNavigation = () => {
      try {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
        const url = webview.getURL();
        if (url) {
          setAddress(url);
          updateNodeData(id, { browserUrl: url }, { recordUndo: false });
        }
      } catch {
        // The guest can be replaced while a navigation event is completing.
      }
    };
    const registerGuest = () => {
      try {
        void window.magineDesktop?.browserRegisterGuest?.(id, webview.getWebContentsId());
      } catch {
        // Browser registration is only available in the desktop build.
      }
      try {
        void webview.executeJavaScript(FORCE_SAME_TAB_NAVIGATION_SCRIPT).catch(() => {
          // Some browser-internal pages reject injected scripts; normal navigation still works.
        });
      } catch {
        // The immediate registration path can run before the guest emits dom-ready.
      }
      updateNavigation();
    };
    const startLoading = () => setLoading(true);
    const stopLoading = () => {
      setLoading(false);
      updateNavigation();
    };
    webview.addEventListener('dom-ready', registerGuest);
    webview.addEventListener('did-navigate', updateNavigation);
    webview.addEventListener('did-navigate-in-page', updateNavigation);
    webview.addEventListener('did-start-loading', startLoading);
    webview.addEventListener('did-stop-loading', stopLoading);
    registerGuest();
    return () => {
      webview.removeEventListener('dom-ready', registerGuest);
      webview.removeEventListener('did-navigate', updateNavigation);
      webview.removeEventListener('did-navigate-in-page', updateNavigation);
      webview.removeEventListener('did-start-loading', startLoading);
      webview.removeEventListener('did-stop-loading', stopLoading);
    };
  }, [id, updateNodeData, webview]);

  const navigate = useCallback((event: FormEvent) => {
    event.preventDefault();
    const nextUrl = normalizeBrowserUrl(address);
    setAddress(nextUrl);
    if (webview) {
      void webview.loadURL(nextUrl).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('(-3)')) {
          console.warn('[browser] 页面打开失败:', message);
        }
      });
    } else {
      updateNodeData(id, { browserUrl: nextUrl });
    }
  }, [address, id, updateNodeData, webview]);

  useEffect(() => {
    const unregister = [
      registerCanvasNodeActionHandler(id, 'navigate', async (params) => {
        const rawTarget = typeof params.url === 'string'
          ? params.url
          : typeof params.query === 'string'
            ? params.query
            : '';
        if (!rawTarget.trim()) {
          return { success: false, message: 'Browser navigation requires url or query' };
        }
        const nextUrl = normalizeBrowserUrl(rawTarget);
        setAddress(nextUrl);
        updateNodeData(id, { browserUrl: nextUrl });
        if (webview) await webview.loadURL(nextUrl);
        return { success: true, message: `Browser opened ${nextUrl}` };
      }),
      registerCanvasNodeActionHandler(id, 'reload', async () => {
        if (!webview) return { success: false, message: 'Browser view is not ready' };
        webview.reload();
        return { success: true, message: 'Browser reloaded' };
      }),
      registerCanvasNodeActionHandler(id, 'back', async () => {
        if (!webview || !webview.canGoBack()) {
          return { success: false, message: 'Browser has no previous page' };
        }
        webview.goBack();
        return { success: true, message: 'Browser moved back' };
      }),
      registerCanvasNodeActionHandler(id, 'forward', async () => {
        if (!webview || !webview.canGoForward()) {
          return { success: false, message: 'Browser has no next page' };
        }
        webview.goForward();
        return { success: true, message: 'Browser moved forward' };
      }),
    ];
    return () => unregister.forEach((dispose) => dispose());
  }, [id, updateNodeData, webview]);

  const removeDownload = useCallback((mediaId: string) => {
    updateNodeData(id, {
      browserDownloads: downloads.filter((item) => item.id !== mediaId),
    });
  }, [downloads, id, updateNodeData]);

  const startMediaDrag = useCallback((
    event: DragEvent<HTMLElement>,
    media: BrowserMediaItem,
  ) => {
    event.dataTransfer.effectAllowed = 'copy';
    if (media.fileType === 'image') {
      event.dataTransfer.setData(GENERATED_IMAGE_DND_TYPE, JSON.stringify({
        imageUrl: media.url,
        thumbnailUrl: media.url,
        fileName: media.fileName,
      }));
    } else if (media.fileType === 'video') {
      event.dataTransfer.setData(GENERATED_VIDEO_DND_TYPE, JSON.stringify({
        videoUrl: media.url,
        fileName: media.fileName,
      }));
    } else {
      event.dataTransfer.setData(GENERATED_AUDIO_DND_TYPE, JSON.stringify({
        audioUrl: media.url,
        fileName: media.fileName,
      }));
    }
    event.dataTransfer.setData('text/uri-list', media.url);
  }, []);

  if (!isExpanded) {
    return (
      <div className="relative h-full w-full overflow-hidden rounded-lg">
        <CompactNodeFrame
          title="浏览器"
          icon={<Globe2 className="h-3 w-3" />}
          text={nodeData.browserUrl || DEFAULT_BROWSER_URL}
          badge={downloads.length ? `${downloads.length} 个媒体` : '网页'}
          width="w-full"
          accent="cyan"
          variant="glass-inner"
          isLoading={loading}
        />
        <Handle type="source" position={Position.Right} className="mc-node-handle" />
      </div>
    );
  }

  const isDesktop = typeof window !== 'undefined' && Boolean(window.magineDesktop?.isDesktop);

  return (
    <div className="relative h-full w-full">
      <NodeResizer
        nodeId={id}
        isVisible={selected}
        minWidth={MIN_BROWSER_WIDTH}
        minHeight={MIN_BROWSER_HEIGHT}
        color="rgba(255,255,255,0.35)"
        lineClassName="!border-0 !bg-transparent opacity-0"
        handleClassName="!z-50 !h-2.5 !w-2.5 !rounded-sm !border !border-white/40 !bg-[#1b2021]/95 !shadow-[0_0_10px_rgba(255,255,255,0.16)]"
        onResizeStart={() => setLiveResize(true)}
        onResizeEnd={(_, params) => {
          updateBrowserGeometry(id, {
            x: params.x,
            y: params.y,
            width: params.width,
            height: params.height,
          });
          window.requestAnimationFrame(() => setLiveResize(false));
        }}
      />
      <div
        className={cn(
          'mc-node-expanded mc-node-glass-shell relative flex h-full w-full min-h-0 flex-col overflow-hidden rounded-lg border border-white/20 bg-[#111516]',
          selected && 'shadow-[0_18px_48px_rgba(0,0,0,0.42)]',
        )}
      >
        <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-white/10 bg-[#171a1c] px-2">
        <span title="拖动浏览器节点" className="flex h-7 w-4 cursor-move items-center justify-center text-zinc-600">
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <button
          type="button"
          title="后退"
          aria-label="后退"
          disabled={!canGoBack}
          onClick={() => webview?.goBack()}
          className="nodrag flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-zinc-300 hover:bg-white/[0.08] disabled:opacity-30"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="前进"
          aria-label="前进"
          disabled={!canGoForward}
          onClick={() => webview?.goForward()}
          className="nodrag flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-zinc-300 hover:bg-white/[0.08] disabled:opacity-30"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="刷新"
          aria-label="刷新"
          onClick={() => webview?.reload()}
          className="nodrag flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-zinc-300 hover:bg-white/[0.08]"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
        <form onSubmit={navigate} className="nodrag flex min-w-0 flex-1">
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            aria-label="网址或搜索关键词"
            placeholder="输入网址或搜索关键词"
            className="h-8 w-full rounded-md border border-white/10 bg-black/30 px-3 text-[10px] text-zinc-200 outline-none focus:border-white/30"
          />
          <button
            type="submit"
            title="搜索或打开"
            aria-label="搜索或打开"
            className="nodrag ml-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 text-zinc-300 hover:bg-white/[0.08]"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </form>
        <button
          type="button"
          title="在系统浏览器打开"
          aria-label="在系统浏览器打开"
          onClick={() => void window.magineDesktop?.openExternal?.(normalizeBrowserUrl(address))}
          className="nodrag flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-zinc-300 hover:bg-white/[0.08]"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        </div>

        <div className={cn(
          'nodrag nopan nowheel min-h-0 flex-1 bg-white',
          liveResize && 'pointer-events-none select-none',
        )}>
        {isDesktop
          ? createElement('webview' as never, {
              ref: handleWebviewRef,
              src: webviewInitialUrl,
              partition,
              allowpopups: 'true',
              className: 'h-full w-full',
              style: { display: 'flex', width: '100%', height: '100%' },
            })
          : (
            <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#111516] px-8 text-center text-zinc-500">
              <Globe2 className="h-8 w-8" />
              <p className="text-xs">浏览器节点需要在 MagineCanvas 桌面端运行</p>
              <button
                type="button"
                onClick={() => window.open(currentUrl, '_blank', 'noopener,noreferrer')}
                className="nodrag flex h-8 items-center gap-1.5 rounded-md border border-white/12 bg-white/[0.05] px-3 text-[10px] text-zinc-200"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                打开网页
              </button>
            </div>
          )}
        </div>

        <div className="nodrag nopan nowheel h-[116px] shrink-0 border-t border-white/10 bg-[#15191a]">
        <div className="flex h-8 items-center gap-2 border-b border-white/8 px-3 text-[9px] text-zinc-500">
          <Download className="h-3 w-3" />
          <span>媒体下载</span>
          <span className="text-zinc-700">网页中下载图片、视频或音频后，可从这里拖到画布</span>
          <span className="ml-auto">{downloads.length}</span>
        </div>
        <div className="nodrag nopan nowheel flex h-[84px] gap-2 overflow-x-auto p-2">
          {downloads.length ? downloads.map((media) => (
            <article
              key={media.id}
              draggable
              onDragStart={(event) => startMediaDrag(event, media)}
              title={`拖到画布：${media.fileName}`}
              className="group relative h-[66px] w-28 shrink-0 cursor-grab overflow-hidden rounded-md border border-white/10 bg-black/35 active:cursor-grabbing"
            >
              {media.fileType === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media.url} alt="" draggable={false} className="h-10 w-full object-cover" />
              ) : media.fileType === 'video' ? (
                <div className="flex h-10 items-center justify-center bg-black">
                  <Video className="h-4 w-4 text-orange-200" />
                </div>
              ) : (
                <div className="flex h-10 items-center justify-center bg-black/50">
                  <Music className="h-4 w-4 text-cyan-200" />
                </div>
              )}
              <div className="flex h-6 items-center gap-1 px-1.5 text-[8px] text-zinc-300">
                {media.fileType === 'image' ? <ImageIcon className="h-2.5 w-2.5 shrink-0" /> : null}
                <span className="min-w-0 flex-1 truncate">{media.fileName}</span>
              </div>
              <button
                type="button"
                title="从列表移除"
                aria-label={`移除${media.fileName}`}
                onClick={(event) => {
                  event.stopPropagation();
                  removeDownload(media.id);
                }}
                className="nodrag absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-md bg-black/75 text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </article>
          )) : (
            <div className="flex h-full w-full items-center justify-center text-[9px] text-zinc-700">
              暂无媒体下载
            </div>
          )}
        </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="mc-node-handle" />
    </div>
  );
}

export default memo(BrowserNode);
