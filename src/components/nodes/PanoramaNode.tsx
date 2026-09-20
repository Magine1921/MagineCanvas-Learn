'use client';

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { Handle, NodeProps, Position, useUpdateNodeInternals, useViewport } from 'reactflow';
import { NodeResizer } from '@reactflow/node-resizer';
import { useShallow } from 'zustand/react/shallow';
import * as THREE from 'three';
import { Camera, Download, Globe, ImagePlus, Loader2, Upload, X } from 'lucide-react';
import type { Edge, Node } from 'reactflow';

import { useCanvasStore, type CanvasNodeData } from '../canvas/CanvasStore';
import { useIncomingMaterialRefs } from '../canvas/useCanvasDerivedData';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select, SelectItem } from '@/components/ui/select';
import { createKieMarketImageAPI } from '../api/KieMarketAPI';
import { KieUsageInfo } from '../canvas/KieUsageInfo';
import { GenerationEta } from '../canvas/GenerationEta';
import { materializeKieReferencesForCloud } from '@/lib/kie-reference-upload-client';
import { persistInlineMaterialDataToProjectSidecar } from '@/lib/persist-inline-material-sidecar';
import { MentionTextarea, type MentionTextareaSize } from '../canvas/MentionTextarea';
import {
  ImageAPI,
  SEEDREAM_RESOLUTION_LABELS,
  getSupportedSeedreamResolutions,
  isSeedreamTextOnlyModel,
  normalizeSeedreamModel,
  normalizeSeedreamResolution,
  type SeedreamAspectRatio,
  type SeedreamResolution,
} from '../api/ImageAPI';
import { useSeedanceStore } from '../seedance/SeedanceStore';
import { useAgentGenerationBridge } from '@/lib/useAgentGenerationBridge';
import { getImageModelOptions } from '@/lib/model-options';
import {
  fetchPanoramaDiskCacheAsDataUrl,
  isPanoramaDiskRef,
  makePanoramaHistoryCacheId,
  panoramaDiskRefToNodeId,
  postPanoramaTexToProjectDiskCache,
  panoramaNodeIdToDiskRef,
} from '@/lib/sync-panorama-project-disk-cache';
import { PANORAMA_AGENT_IMAGE_GEN_BUILTIN_PROMPT } from '@/lib/panorama-auto-prompt';
import {
  getPanoramaEquirectangularGuideDataUrl,
  PANORAMA_AGENT_IMAGE_GEN_ASPECT_RATIO,
} from '@/lib/panorama-equirectangular-guide-data-url';
import {
  buildKieUsageDisplay,
  getKieProviderTokenBucket,
  isKieProvider,
  KIE_GLOBAL_PROVIDER_TOKEN_KEY,
} from '@/lib/kie-usage-display';

interface PanoramaNodeData extends CanvasNodeData {
  type: 'panorama';
  panoramaTexUrl?: string;
  panoramaWidth?: number;
  panoramaHeight?: number;
  panoramaAspect?: string;
  /** standard：左侧连线 / 下方 URL；agent_auto：场景图 + 图像模型生图（无识图 LLM） */
  panoramaMode?: 'standard' | 'agent_auto';
  panoramaAgentSceneImageDataUrl?: string;
  /** 以下字段为历史工作流保留，当前智能体模式不再展示或使用 */
  panoramaAgentVisionLlmModel?: string;
  panoramaAgentLlmSource?: 'volcengine' | 'gemini';
  panoramaAgentGeminiModel?: string;
  panoramaAgentImageProviderId?: string;
  panoramaAgentImageModel?: string;
  panoramaAgentImageResolution?: SeedreamResolution;
  /** 仅影响节点内下方预览框宽高（与 panoramaAspect 同步写入）；智能体生图 ratio 固定为内置引导线图比例 */
  panoramaAgentImageAspect?: SeedreamAspectRatio;
  panoramaAgentLlmSupplement?: string;
  panoramaPromptSupplementSize?: MentionTextareaSize;
  /** 曾显示过的全景纹理（不含当前 `panoramaTexUrl`），用于缩略图快速切回 */
  panoramaTexHistory?: Array<{ url: string; createdAt: number }>;
  lastGenerationCredits?: number;
}

const MIN_W = 260;
const MIN_VIEWER_INNER_H = 100;
/** 在尚未 layout 到测量 ref 时的 chrome 回退估值 */
const FALLBACK_CHROME_PX = 148;
/** 节点外框绝对最小高度（chrome + 一条最小可视带） */
const MIN_NODE_ABS_H = FALLBACK_CHROME_PX + MIN_VIEWER_INNER_H;
const DEFAULT_PROMPT_SUPPLEMENT_SIZE: MentionTextareaSize = { width: 240, height: 56 };

/** 标准模式与智能体模式共用同一套比例选项与标签 */
const PANORAMA_ASPECT_OPTIONS: { value: SeedreamAspectRatio; label: string }[] = [
  { value: '2:1', label: '2:1 全景' },
  { value: '21:9', label: '21:9' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '1:1', label: '1:1' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '9:16', label: '9:16' },
];

const PANORAMA_ASPECT_SET = new Set<SeedreamAspectRatio>(PANORAMA_ASPECT_OPTIONS.map((o) => o.value));

function isPanoramaImageModelOption(model: string): boolean {
  return model !== 'gpt-image-2-text-to-image';
}

function resolvePanoramaFrameAspect(data: {
  panoramaAgentImageAspect?: unknown;
  panoramaAspect?: unknown;
}): SeedreamAspectRatio {
  const primary = data.panoramaAgentImageAspect;
  const legacy = data.panoramaAspect;
  for (const v of [primary, legacy]) {
    if (typeof v === 'string' && v.trim() && PANORAMA_ASPECT_SET.has(v as SeedreamAspectRatio)) {
      return v as SeedreamAspectRatio;
    }
  }
  return '2:1';
}

function parseAspectWh(key: SeedreamAspectRatio): { rw: number; rh: number } {
  const parts = key.split(':');
  const rw = parseInt(parts[0] || '2', 10);
  const rh = parseInt(parts[1] || '1', 10);
  if (!Number.isFinite(rw) || !Number.isFinite(rh) || rw <= 0 || rh <= 0) return { rw: 2, rh: 1 };
  return { rw, rh };
}

/** 根据预览区实测宽高，反推与选项列表最接近的比例（用于手动缩放节点后与下拉框同步） */
function pickClosestSeedreamAspectFromSize(cssWidth: number, cssHeight: number): SeedreamAspectRatio {
  const actual = cssWidth / Math.max(1, cssHeight);
  let best: SeedreamAspectRatio = PANORAMA_ASPECT_OPTIONS[0].value;
  let bestScore = Infinity;
  for (const { value } of PANORAMA_ASPECT_OPTIONS) {
    const { rw, rh } = parseAspectWh(value);
    const target = rw / rh;
    const score = Math.abs(Math.log(actual / target));
    if (score < bestScore) {
      bestScore = score;
      best = value;
    }
  }
  return best;
}

function readNodePixelSize(node: Node<CanvasNodeData> | undefined): { w: number; h: number } {
  if (!node) return { w: 360, h: 320 };
  const sty = node.style || {};
  const sw = sty.width;
  const sh = sty.height;
  const d = node.data as PanoramaNodeData;
  const wRaw =
    typeof sw === 'number'
      ? sw
      : typeof sw === 'string'
        ? parseInt(sw, 10)
        : typeof node.width === 'number'
          ? node.width
          : d.panoramaWidth;
  const hRaw =
    typeof sh === 'number'
      ? sh
      : typeof sh === 'string'
        ? parseInt(sh, 10)
        : typeof node.height === 'number'
          ? node.height
          : d.panoramaHeight;
  const wn = Number(wRaw);
  const hn = Number(hRaw);
  const w = Number.isFinite(wn) && wn > 0 ? Math.round(wn) : 360;
  const h = Number.isFinite(hn) && hn > 0 ? Math.round(hn) : 320;
  return { w: Math.max(MIN_W, w), h: Math.max(MIN_NODE_ABS_H, h) };
}

/** 与 StoryboardNode / ImageNode 一致：当前展示图 URL */
function resolveImageNodeBaseUrl(d: Record<string, unknown>): string {
  const direct = typeof d.imageUrl === 'string' ? d.imageUrl.trim() : '';
  if (direct) return direct;
  const raw = d.generatedImages;
  if (!Array.isArray(raw)) return '';
  let best = '';
  let bestCreated = -1;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const u =
      typeof r.imageUrl === 'string'
        ? r.imageUrl
        : typeof r.image_url === 'string'
          ? r.image_url
          : '';
    const url = typeof u === 'string' ? u.trim() : '';
    if (!url) continue;
    const created = typeof r.createdAt === 'number' ? r.createdAt : 0;
    if (created >= bestCreated) {
      bestCreated = created;
      best = url;
    }
  }
  return best;
}

function resolveMaterialBaseUrl(d: Record<string, unknown>): string {
  const fileUrl = typeof d.fileUrl === 'string' ? d.fileUrl.trim() : '';
  const thumb = typeof d.thumbnailUrl === 'string' ? d.thumbnailUrl.trim() : '';
  const seedUri =
    typeof d.seedanceAssetUri === 'string'
      ? d.seedanceAssetUri.trim()
      : typeof d.seedanceAssetId === 'string' && d.seedanceAssetId.trim()
        ? `asset://${d.seedanceAssetId.trim()}`
        : '';
  if (fileUrl) return fileUrl;
  if (thumb) return thumb;
  return seedUri;
}

function isLikelyMaterialImageUrl(fileUrl: string): boolean {
  const t = fileUrl.trim();
  if (!t) return false;
  if (/^data:image\//i.test(t)) return true;
  if (/^disk:\/\/magine\/material\/v1\//i.test(t)) return true;
  if (t.includes('/api/project-cache/material')) return true;
  if (/^asset:\/\//i.test(t)) return true;
  if (/\.(mp4|webm|mov|mpe?g|mp3|wav|m4a|aac)(\?|#|$)/i.test(t)) return false;
  if (/\.(png|jpe?g|webp|gif|bmp|avif|heic)(\?|#|$)/i.test(t)) return true;
  return /^(https?:\/\/|blob:)/i.test(t);
}

function guessPanoramaDownloadFilename(url: string, blobMime: string): string {
  const ts = Date.now();
  const path = url.split('?')[0]?.toLowerCase() || '';
  let ext = 'png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) ext = 'jpg';
  else if (path.endsWith('.webp')) ext = 'webp';
  else if (path.endsWith('.png')) ext = 'png';
  else if (url.startsWith('data:image/jpeg')) ext = 'jpg';
  else if (url.startsWith('data:image/webp')) ext = 'webp';
  else if (blobMime.includes('jpeg')) ext = 'jpg';
  else if (blobMime.includes('webp')) ext = 'webp';
  else if (blobMime.includes('png')) ext = 'png';
  return `panorama-${ts}.${ext}`;
}

/** 将当前全景纹理 URL 转为可写入素材节点的 data URL（便于持久化与连线） */
function readBlobAsDataUrl(blob: Blob): Promise<{ dataUrl: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const dataUrl = typeof fr.result === 'string' ? fr.result : '';
      if (!dataUrl) reject(new Error('读取图片失败'));
      else resolve({ dataUrl, mime: blob.type || 'application/octet-stream' });
    };
    fr.onerror = () => reject(fr.error ?? new Error('读取图片失败'));
    fr.readAsDataURL(blob);
  });
}

async function textureUrlToMaterialDataUrl(url: string): Promise<{ dataUrl: string; mime: string }> {
  const trimmed = url.trim();
  if (trimmed.startsWith('data:')) {
    const semi = trimmed.indexOf(';');
    const mime =
      semi > 5 ? trimmed.slice(5, semi) : trimmed.slice(5, trimmed.indexOf(',')) || 'image/png';
    return { dataUrl: trimmed, mime };
  }
  if (trimmed.startsWith('blob:')) {
    const response = await fetch(trimmed);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return readBlobAsDataUrl(await response.blob());
  }

  const response = await fetch('/api/panorama/materialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: trimmed }),
  });
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; dataUrl?: string; mime?: string; error?: string }
    | null;
  if (!response.ok || !payload?.ok || !payload.dataUrl) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return { dataUrl: payload.dataUrl, mime: payload.mime || 'image/png' };
}

async function materializePanoramaKieReferenceImages(
  apiKey: string,
  inputs: string[],
  cacheKeyPrefix?: string,
): Promise<string[]> {
  const uniqueInputs = [...new Set(inputs.map((input) => input.trim()).filter(Boolean))].slice(0, 16);
  if (uniqueInputs.length === 0) return [];
  const urls = await materializeKieReferencesForCloud({
    apiKey,
    inputs: uniqueInputs,
    kind: 'image',
    cacheKeyPrefix,
  });
  if (urls.length === 0) {
    throw new Error('Kie reference upload returned no public image URLs');
  }
  return urls;
}

async function createStablePanoramaHistoryUrl(
  nodeId: string,
  sourceUrl: string,
  createdAt: number,
): Promise<string> {
  const source = sourceUrl.trim();
  if (!source) return '';

  let cacheSource = source;
  if (isPanoramaDiskRef(source)) {
    try {
      const sourceNodeId = panoramaDiskRefToNodeId(source);
      if (sourceNodeId !== nodeId) return source;
      const dataUrl = await fetchPanoramaDiskCacheAsDataUrl(sourceNodeId);
      if (!dataUrl) return source;
      cacheSource = dataUrl;
    } catch {
      return source;
    }
  } else if (!source.startsWith('data:') && !/^https?:\/\//i.test(source)) {
    try {
      cacheSource = (await textureUrlToMaterialDataUrl(source)).dataUrl;
    } catch {
      return source;
    }
  }

  const historyCacheId = makePanoramaHistoryCacheId(nodeId, createdAt);
  const ok = await postPanoramaTexToProjectDiskCache(historyCacheId, cacheSource);
  return ok ? panoramaNodeIdToDiskRef(historyCacheId) : source;
}

function normalizePanoramaTexHistory(raw: unknown): Array<{ url: string; createdAt: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ url: string; createdAt: number }> = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const u = typeof (x as { url?: unknown }).url === 'string' ? (x as { url: string }).url.trim() : '';
    if (!u) continue;
    const c = (x as { createdAt?: unknown }).createdAt;
    const createdAt = typeof c === 'number' && Number.isFinite(c) ? c : Date.now();
    if (!out.some((e) => e.url === u)) out.push({ url: u, createdAt });
  }
  return out.slice(0, 16);
}

function resolvePanoramaInboundUrls(nodes: Node<CanvasNodeData>[], edges: Edge[], panoramaId: string): string[] {
  const urls: string[] = [];
  for (const e of edges) {
    if (e.target !== panoramaId) continue;
    const n = nodes.find((x) => x.id === e.source);
    if (!n?.data) continue;
    const d = n.data as Record<string, unknown>;
    const nodeType = String(n.type ?? d.type ?? '');

    if (nodeType === 'material') {
      const fileType = typeof d.fileType === 'string' ? d.fileType : '';
      const visualUrl = resolveMaterialBaseUrl(d);
      if (!visualUrl || fileType === 'video' || fileType === 'audio') continue;
      if (fileType === 'image' || fileType === '') {
        if (fileType === '' && !isLikelyMaterialImageUrl(visualUrl)) continue;
        urls.push(visualUrl);
      }
    } else if (nodeType === 'image') {
      const imageUrl = resolveImageNodeBaseUrl(d);
      if (imageUrl) urls.push(imageUrl);
    } else if (nodeType === 'storyboard') {
      const fileUrl = typeof d.fileUrl === 'string' ? d.fileUrl : '';
      if (fileUrl) urls.push(fileUrl);
    }
  }
  return urls;
}

/**
 * 球内看等距图：mipmap 在掠射角会快速切到低 mip，主观「发糊」明显；全景一律全 mip 关 + 线性采样。
 * 各向异性仍开满，减轻斜视方向上的纹理拖尾。
 */
function configureEquirectTexture(tex: THREE.Texture, renderer: THREE.WebGLRenderer) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
}

/**
 * React Flow 视口 zoom≠1 时：节点在 DOM 里的 clientWidth/Height 不变，但整块画布被 scale(zoom) 放大/缩小，
 * 等效「屏幕占位」≈ layout×zoom， framebuffer 需按 dpr×zoom 提升，否则会欠采样发糊。
 */
const PANORAMA_MAX_FRAMEBUFFER_PIXELS = 16_000_000;
const PANORAMA_PIXEL_RATIO_HARD_CAP = 8;

function getPanoramaRendererPixelRatio(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  flowViewportZoom: number
): number {
  const w = Math.max(1, cssWidth);
  const h = Math.max(1, cssHeight);
  /** 部分高分屏 dpr>3，封顶略放宽以免预览偏糊（仍受面积与硬顶限制） */
  const dpr = Math.max(1, Math.min(devicePixelRatio || 1, 4));
  const z = Math.max(0.08, Math.min(flowViewportZoom || 1, 12));
  const symmetric = Math.max(z, 1 / z);
  const target = dpr * symmetric;
  const maxByArea = Math.sqrt(PANORAMA_MAX_FRAMEBUFFER_PIXELS / (w * h));
  /** 略抬下限，减轻视口缩放后球面采样偏糊（仍受面积与硬顶约束） */
  return Math.max(1.15, Math.min(PANORAMA_PIXEL_RATIO_HARD_CAP, maxByArea, target));
}

/** 统一设置 drawing buffer 与相机，避免 ResizeObserver / zoom / 多处逻辑不一致 */
function applyPanoramaRendererDrawingBuffer(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  mount: HTMLElement,
  flowViewportZoom: number
) {
  const w = Math.max(64, Math.round(mount.clientWidth));
  const h = Math.max(64, Math.round(mount.clientHeight));
  const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const pr = getPanoramaRendererPixelRatio(w, h, rawDpr, flowViewportZoom);
  renderer.setPixelRatio(pr);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

export type PanoramaViewerHandle = {
  capturePngDataUrl: () => string | null;
};

const PanoramaViewer = forwardRef<
  PanoramaViewerHandle,
  { imageUrl: string; className?: string; viewportZoom?: number }
>(function PanoramaViewer({ imageUrl, className, viewportZoom = 1 }, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewportZoomRef = useRef(viewportZoom);
  viewportZoomRef.current = viewportZoom;

  const viewRef = useRef({
    lon: 0,
    lat: 0,
    fov: 62,
    dragging: false,
    ptrId: -1,
    lastX: 0,
    lastY: 0,
  });
  const engineRef = useRef<{
    renderer: THREE.WebGLRenderer | null;
    scene: THREE.Scene | null;
    camera: THREE.PerspectiveCamera | null;
    disposed: boolean;
  }>({ renderer: null, scene: null, camera: null, disposed: false });

  useImperativeHandle(ref, () => ({
    capturePngDataUrl: () => {
      const mount = mountRef.current;
      const t = engineRef.current;
      if (!t.renderer || !t.scene || !t.camera || t.disposed || !mount) return null;
      const cw = Math.max(1, Math.round(mount.clientWidth));
      const ch = Math.max(1, Math.round(mount.clientHeight));
      const long = Math.max(cw, ch);
      const screenPr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const targetLongPx = 4096;
      const basePr = getPanoramaRendererPixelRatio(cw, ch, screenPr, viewportZoomRef.current);
      const maxByArea = Math.sqrt(PANORAMA_MAX_FRAMEBUFFER_PIXELS / (cw * ch));
      const exportPr = Math.min(
        PANORAMA_PIXEL_RATIO_HARD_CAP,
        maxByArea,
        Math.max(basePr, targetLongPx / long)
      );
      const prevPr = t.renderer.getPixelRatio();
      try {
        t.renderer.setPixelRatio(exportPr);
        t.renderer.setSize(cw, ch, false);
        t.camera.aspect = cw / ch;
        t.camera.updateProjectionMatrix();
        t.renderer.render(t.scene, t.camera);
        return t.renderer.domElement.toDataURL('image/png');
      } catch {
        return null;
      } finally {
        t.renderer.setPixelRatio(prevPr);
        t.renderer.setSize(cw, ch, false);
        t.camera.aspect = cw / ch;
        t.camera.updateProjectionMatrix();
      }
    },
  }));

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    engineRef.current.disposed = false;
    let disposed = false;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
    camera.position.set(0, 0, 0.01);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
      precision: 'highp',
    });
    renderer.setClearColor(0x0a0a0b, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;

    engineRef.current.renderer = renderer;
    engineRef.current.scene = scene;
    engineRef.current.camera = camera;

    const sphereGeo = new THREE.SphereGeometry(500, 200, 100);
    sphereGeo.scale(-1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1d22 });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    scene.add(mesh);

    mount.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    /** 与壳层 backdrop / 父级 transform 分层，减轻 WebGL 与磨砂合成时的发糊 */
    canvas.style.isolation = 'isolate';
    canvas.style.transform = 'translateZ(0)';

    const setSize = () => {
      applyPanoramaRendererDrawingBuffer(renderer, camera, mount, viewportZoomRef.current);
    };
    setSize();
    const ro = new ResizeObserver(setSize);
    ro.observe(mount);

    const onWindowResize = () => setSize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', onWindowResize);
    }

    let currentTex: THREE.Texture | null = null;
    const loader = new THREE.TextureLoader();

    const applyUrl = (url: string) => {
      if (!url.trim()) {
        if (currentTex) {
          currentTex.dispose();
          currentTex = null;
        }
        mat.map = null;
        mat.color.setHex(0x1a1d22);
        mat.needsUpdate = true;
        return;
      }
      loader.setCrossOrigin('anonymous');
      loader.load(
        url,
        (tex) => {
          if (disposed) {
            tex.dispose();
            return;
          }
          configureEquirectTexture(tex, renderer);
          if (currentTex) currentTex.dispose();
          currentTex = tex;
          mat.map = tex;
          mat.color.setHex(0xffffff);
          mat.needsUpdate = true;
          setSize();
        },
        undefined,
        () => {
          if (disposed) return;
          if (currentTex) {
            currentTex.dispose();
            currentTex = null;
          }
          mat.map = null;
          mat.color.setHex(0x3f2020);
          mat.needsUpdate = true;
        }
      );
    };

    applyUrl(imageUrl);

    const syncCamera = () => {
      const v = viewRef.current;
      camera.fov = v.fov;
      camera.updateProjectionMatrix();
      const lat = Math.max(-Math.PI / 2 + 0.08, Math.min(Math.PI / 2 - 0.08, v.lat));
      v.lat = lat;
      const x = Math.cos(lat) * Math.sin(v.lon);
      const y = Math.sin(lat);
      const z = Math.cos(lat) * Math.cos(v.lon);
      camera.lookAt(x, y, z);
    };

    let raf = 0;
    const tick = () => {
      if (disposed) return;
      syncCamera();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const v = viewRef.current;
      v.dragging = true;
      v.ptrId = e.pointerId;
      v.lastX = e.clientX;
      v.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const v = viewRef.current;
      if (!v.dragging || e.pointerId !== v.ptrId) return;
      const dx = e.clientX - v.lastX;
      const dy = e.clientY - v.lastY;
      v.lastX = e.clientX;
      v.lastY = e.clientY;
      v.lon -= dx * 0.004;
      v.lat += dy * 0.004;
    };
    const onUp = (e: PointerEvent) => {
      const v = viewRef.current;
      if (e.pointerId !== v.ptrId) return;
      v.dragging = false;
      v.ptrId = -1;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const v = viewRef.current;
      v.fov = Math.max(38, Math.min(80, v.fov + e.deltaY * 0.035));
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      disposed = true;
      engineRef.current.disposed = true;
      engineRef.current.renderer = null;
      engineRef.current.scene = null;
      engineRef.current.camera = null;
      cancelAnimationFrame(raf);
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', onWindowResize);
      }
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
      sphereGeo.dispose();
      mat.dispose();
      if (currentTex) currentTex.dispose();
      renderer.dispose();
    };
  }, [imageUrl]);

  useEffect(() => {
    const mount = mountRef.current;
    const r = engineRef.current.renderer;
    const cam = engineRef.current.camera;
    if (!mount || !r || !cam || engineRef.current.disposed) return;
    applyPanoramaRendererDrawingBuffer(r, cam, mount, viewportZoom);
  }, [viewportZoom]);

  return <div ref={mountRef} className={cn('h-full w-full min-h-[120px]', className)} />;
});

function PanoramaNode({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const nodeData = data as PanoramaNodeData;
  const { zoom } = useViewport();
  const connectedMaterials = useIncomingMaterialRefs(id);
  const updateNodeInternals = useUpdateNodeInternals();
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updatePanoramaGeometry = useCanvasStore((s) => s.updatePanoramaGeometry);
  const addNodeWithData = useCanvasStore((s) => s.addNodeWithData);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);

  const nodeRootRef = useRef<HTMLDivElement>(null);
  const viewerShellRef = useRef<HTMLDivElement>(null);
  const viewerStageRef = useRef<HTMLDivElement>(null);
  const historyStripRef = useRef<HTMLDivElement>(null);
  /** `panoramaTexUrl` 切到 disk:// 后，异步 hydrate 完成前用上一帧可画 URL，避免纹理瞬间为空 */
  const diskTexHydrateFallbackRef = useRef('');

  const inboundUrls = useCanvasStore(
    useShallow((state) => resolvePanoramaInboundUrls(state.nodes, state.edges, id))
  );
  const inboundUrl = inboundUrls[0] || '';
  const manualUrl = typeof nodeData.panoramaTexUrl === 'string' ? nodeData.panoramaTexUrl.trim() : '';
  const panoramaHistoryForHydrate = useMemo(
    () => normalizePanoramaTexHistory(nodeData.panoramaTexHistory),
    [nodeData.panoramaTexHistory]
  );
  const [resolvedManualTex, setResolvedManualTex] = useState('');
  useEffect(() => {
    const raw = manualUrl.trim();
    if (!raw) {
      setResolvedManualTex('');
      diskTexHydrateFallbackRef.current = '';
      return;
    }
    if (!isPanoramaDiskRef(raw)) {
      diskTexHydrateFallbackRef.current = '';
      setResolvedManualTex(raw);
      return;
    }
    /** 避免仍沿用切到 disk 之前的 https 文案，否则下方 WebGL 一直显示旧图 / 空白 */
    setResolvedManualTex('');
    let cancelled = false;
    void (async () => {
      try {
        const pid = panoramaDiskRefToNodeId(raw);
        const dataUrl = await fetchPanoramaDiskCacheAsDataUrl(pid);
        if (!cancelled) {
          setResolvedManualTex(dataUrl || '');
          if (dataUrl) diskTexHydrateFallbackRef.current = '';
        }
      } catch {
        if (!cancelled) setResolvedManualTex('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manualUrl, panoramaHistoryForHydrate]);

  const effectiveManualUrl = useMemo(() => {
    const raw = manualUrl.trim();
    if (!raw) return '';
    if (isPanoramaDiskRef(raw)) {
      const r = resolvedManualTex.trim();
      /** 磁盘 hydrate 结果为 data/blob；https 等为切盘前残留，须忽略以免与新生成错位 */
      if (r.startsWith('data:image') || r.startsWith('blob:')) return r;
      return diskTexHydrateFallbackRef.current.trim();
    }
    return raw;
  }, [manualUrl, resolvedManualTex]);

  const panoramaHistory = useMemo(
    () => normalizePanoramaTexHistory(nodeData.panoramaTexHistory),
    [nodeData.panoramaTexHistory]
  );
  const panoramaMode = nodeData.panoramaMode === 'agent_auto' ? 'agent_auto' : 'standard';
  /** 智能体模式：左侧连线作为「场景图」输入（与上传二选一，上传优先）；纹理仍只用生成结果 / 手动 URL；disk:// 引用需解析为可加载 URL */
  const textureUrl =
    panoramaMode === 'agent_auto' ? effectiveManualUrl : inboundUrl || effectiveManualUrl;
  const showPanoramaHistoryStrip =
    panoramaHistory.length > 0 && (panoramaMode === 'agent_auto' || !inboundUrl.trim());
  const [displayTextureUrl, setDisplayTextureUrl] = useState('');
  const [textureResolveError, setTextureResolveError] = useState('');
  const [historyThumbUrls, setHistoryThumbUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const raw = textureUrl.trim();
    setTextureResolveError('');
    if (!raw) {
      setDisplayTextureUrl('');
      return;
    }
    if (raw.startsWith('data:image/') || raw.startsWith('blob:')) {
      setDisplayTextureUrl(raw);
      return;
    }

    let cancelled = false;
    setDisplayTextureUrl('');
    void (async () => {
      try {
        const { dataUrl } = await textureUrlToMaterialDataUrl(raw);
        if (!cancelled) setDisplayTextureUrl(dataUrl);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setTextureResolveError(message || '图片读取失败');
        if (/^(https?:\/\/|\/)/i.test(raw)) setDisplayTextureUrl(raw);
        else setDisplayTextureUrl('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [textureUrl]);

  useEffect(() => {
    let cancelled = false;
    const urls = panoramaHistory.map((h) => h.url.trim()).filter(Boolean);
    if (urls.length === 0) {
      setHistoryThumbUrls({});
      return;
    }

    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        urls.map(async (url) => {
          if (url.startsWith('data:image/') || url.startsWith('blob:') || /^https?:\/\//i.test(url)) {
            next[url] = url;
            return;
          }
          if (isPanoramaDiskRef(url)) {
            try {
              const dataUrl = await fetchPanoramaDiskCacheAsDataUrl(panoramaDiskRefToNodeId(url));
              if (dataUrl) next[url] = dataUrl;
            } catch {
              /* ignore broken history thumbnails */
            }
          }
        })
      );
      if (!cancelled) setHistoryThumbUrls(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [panoramaHistory]);

  const { imageCategoryConfig, addUsedTokens, addProviderTokens } = useSeedanceStore(useShallow((state) => ({
    imageCategoryConfig: state.config.image,
    addUsedTokens: state.addUsedTokens,
    addProviderTokens: state.addProviderTokens,
  })));
  const imageModelOptions = useMemo(() => getImageModelOptions(imageCategoryConfig), [imageCategoryConfig]);

  const imageProviderOptions = useMemo(() => {
    const all = { ...imageCategoryConfig.providers, ...imageCategoryConfig.customProviders };
    return Object.entries(all)
      .filter(([, p]) => p.enabled && p.apiKey.trim())
      .map(([id, p]) => ({ value: id, label: p.label, models: p.models }));
  }, [imageCategoryConfig]);

  const currentImageProviderId = useMemo(() => {
    const savedProviderId =
      typeof nodeData.panoramaAgentImageProviderId === 'string'
        ? nodeData.panoramaAgentImageProviderId.trim()
        : '';
    if (savedProviderId && imageProviderOptions.some((p) => p.value === savedProviderId)) {
      return savedProviderId;
    }
    const model = typeof nodeData.panoramaAgentImageModel === 'string' ? nodeData.panoramaAgentImageModel.trim() : '';
    if (model) {
      for (const p of imageProviderOptions) {
        if (p.models.includes(model)) return p.value;
      }
    }
    return imageProviderOptions[0]?.value || '';
  }, [nodeData.panoramaAgentImageProviderId, nodeData.panoramaAgentImageModel, imageProviderOptions]);

  const currentImageProvider = useMemo(() => {
    const all = { ...imageCategoryConfig.providers, ...imageCategoryConfig.customProviders };
    return all[currentImageProviderId] || null;
  }, [imageCategoryConfig, currentImageProviderId]);

  const currentImageModelOptions = useMemo(() => {
    const provider = imageProviderOptions.find((p) => p.value === currentImageProviderId);
    if (!provider) return imageModelOptions.filter((option) => isPanoramaImageModelOption(option.value));
    return provider.models
      .filter(isPanoramaImageModelOption)
      .map((model) => ({
        value: model,
        label: model,
        providerId: currentImageProviderId,
      }));
  }, [imageProviderOptions, currentImageProviderId, imageModelOptions]);

  const currentImageModel = useMemo(() => {
    const rawModel =
      typeof nodeData.panoramaAgentImageModel === 'string'
        ? nodeData.panoramaAgentImageModel.trim()
        : '';
    if (rawModel && currentImageModelOptions.some((m) => m.value === rawModel)) {
      return rawModel;
    }
    const normalized = normalizeSeedreamModel(rawModel);
    if (normalized && currentImageModelOptions.some((m) => m.value === normalized)) {
      return normalized;
    }
    return currentImageModelOptions[0]?.value || '';
  }, [nodeData.panoramaAgentImageModel, currentImageModelOptions]);
  const sceneImage =
    typeof nodeData.panoramaAgentSceneImageDataUrl === 'string'
      ? nodeData.panoramaAgentSceneImageDataUrl.trim()
      : '';
  const isCurrentKieImageProvider = isKieProvider(currentImageProvider, currentImageProviderId);
  const panoramaKieTokenBucket = useSeedanceStore((state) =>
    getKieProviderTokenBucket(state.config.providerTokens, `image.${currentImageProviderId}`)
  );
  const panoramaKieUsage = useMemo(
    () =>
      buildKieUsageDisplay({
        kind: 'image',
        providerId: currentImageProviderId,
        provider: currentImageProvider,
        bucket: panoramaKieTokenBucket,
        model: currentImageModel,
        resolution: nodeData.panoramaAgentImageResolution || '2K',
        hasInput: Boolean(sceneImage || connectedMaterials.length > 0),
      }),
    [
      connectedMaterials.length,
      currentImageModel,
      currentImageProvider,
      currentImageProviderId,
      nodeData.panoramaAgentImageResolution,
      panoramaKieTokenBucket,
      sceneImage,
    ]
  );
  /** 智能体模式：与标准模式同源解析（素材 / 生图 / 分镜），作为场景图外部输入 */
  const agentInboundSceneUrls = panoramaMode === 'agent_auto' ? inboundUrls.map((u) => u.trim()).filter(Boolean) : [];
  const agentInboundSceneUrl = agentInboundSceneUrls[0] || '';
  const hasAgentSceneInput = Boolean(sceneImage || agentInboundSceneUrls.length > 0);
  const agentScenePreviewUrl = sceneImage || agentInboundSceneUrl;
  const imageGenModel = currentImageModel;
  const imageGenRes = normalizeSeedreamResolution(
    imageGenModel,
    typeof nodeData.panoramaAgentImageResolution === 'string' ? nodeData.panoramaAgentImageResolution : undefined
  );
  const supportedImageRes = getSupportedSeedreamResolutions(imageGenModel);
  const promptSupplement =
    typeof nodeData.panoramaAgentLlmSupplement === 'string'
      ? nodeData.panoramaAgentLlmSupplement.trim()
      : '';
  const promptSupplementSize: MentionTextareaSize =
    nodeData.panoramaPromptSupplementSize || DEFAULT_PROMPT_SUPPLEMENT_SIZE;
  const frameAspect = resolvePanoramaFrameAspect(nodeData);
  const previewAspectStyle = useMemo(() => {
    const { rw, rh } = parseAspectWh(frameAspect);
    return { aspectRatio: `${rw} / ${rh}` as const };
  }, [frameAspect]);

  const sceneFileRef = useRef<HTMLInputElement>(null);
  const [agentSubmitting, setAgentSubmitting] = useState(false);
  const [agentProgress, setAgentProgress] = useState({ progress: 0, message: '' });

  const onSceneFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === 'string' ? reader.result : '';
        if (url) updateNodeData(id, { panoramaAgentSceneImageDataUrl: url });
      };
      reader.readAsDataURL(file);
    },
    [id, updateNodeData]
  );

  const handleAgentSubmit = useCallback(async () => {
    const inboundScenes = panoramaMode === 'agent_auto'
      ? inboundUrls.map((u) => u.trim()).filter(Boolean)
      : [];
    if (!sceneImage && inboundScenes.length === 0) {
      setAgentProgress({ progress: 0, message: '请先上传场景图，或从左侧接入图片类节点' });
      return;
    }
    if (!currentImageProvider?.apiKey) {
      setAgentProgress({ progress: 0, message: '请先在设置中配置图像生成 API Key' });
      return;
    }
    const isSeedreamProvider = currentImageProviderId === 'seedream';
    const isKieImageProvider =
      currentImageProviderId === 'gpt-image-2' ||
      currentImageProviderId === 'nano-banana' ||
      currentImageProviderId === 'kie-gpt-image' ||
      currentImageProviderId === 'kie-nano-banana';

    if (!isSeedreamProvider && !isKieImageProvider) {
      setAgentProgress({ progress: 0, message: `当前图片厂商暂不支持 720° 全景智能生成：${currentImageProvider?.label || currentImageProviderId}` });
      return;
    }

    if (isSeedreamProvider && isSeedreamTextOnlyModel(imageGenModel)) {
      setAgentProgress({
        progress: 0,
        message: '当前为纯文生图模型，无法将场景图作为参考注入，请更换支持参考图的图像模型',
      });
      return;
    }

    setAgentSubmitting(true);
    setAgentProgress({ progress: 12, message: '正在准备图像生成…' });

    try {
      const uploadPart = sceneImage.trim();
      const inboundParts: string[] = [];
      const inboundReadErrors: string[] = [];
      if (inboundScenes.length > 0) {
        setAgentProgress({ progress: 10, message: `正在读取左侧连入图像（${inboundScenes.length} 张）…` });
        for (const url of inboundScenes) {
          try {
            const { dataUrl } = await textureUrlToMaterialDataUrl(url);
            if (dataUrl) inboundParts.push(dataUrl);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            inboundReadErrors.push(msg || 'unknown error');
          }
        }
      }
      const sceneRefs: string[] = [];
      if (uploadPart) sceneRefs.push(uploadPart);
      for (const part of inboundParts) {
        if (part !== uploadPart) sceneRefs.push(part);
      }
      if (sceneRefs.length === 0) {
        if (inboundReadErrors.length > 0) {
          throw new Error(`左侧参考图读取失败：${inboundReadErrors.slice(0, 2).join('；')}`);
        }
        throw new Error('未能解析场景图（请检查左侧连线或重新上传）');
      }

      const guideDataUrl = await getPanoramaEquirectangularGuideDataUrl();
      const freshSupplement = (
        (useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as PanoramaNodeData | undefined)
          ?.panoramaAgentLlmSupplement || ''
      ).trim();
      const imageGenPrompt = freshSupplement
        ? `${PANORAMA_AGENT_IMAGE_GEN_BUILTIN_PROMPT}\n\n【用户补充】\n${freshSupplement}`
        : PANORAMA_AGENT_IMAGE_GEN_BUILTIN_PROMPT;

      let referenceImages = [...sceneRefs, ...(guideDataUrl ? [guideDataUrl] : [])];

      setAgentProgress({
        progress: 48,
        message: guideDataUrl
          ? '正在生成全景图（已注入场景参考图与内置引导线图）…'
          : '正在生成全景图（已注入场景参考图；引导线图加载失败）…',
      });

      const imageApi = isSeedreamProvider
        ? new ImageAPI(currentImageProvider.apiKey, currentImageProvider.apiUrl, {
            provider: 'seedream',
          })
        : null;
      const kieApi = isKieImageProvider ? createKieMarketImageAPI(currentImageProvider) : null;
      if (kieApi) {
        setAgentProgress({
          progress: 42,
          message: `正在上传 ${referenceImages.length} 张参考图到 Kie 临时文件服务...`,
        });
        try {
          referenceImages = await materializePanoramaKieReferenceImages(
            currentImageProvider.apiKey,
            referenceImages,
            `panorama-${id}-ref`,
          );
        } catch (uploadError) {
          if (!guideDataUrl || sceneRefs.length === 0) {
            throw uploadError;
          }
          referenceImages = await materializePanoramaKieReferenceImages(
            currentImageProvider.apiKey,
            sceneRefs,
            `panorama-${id}-scene`,
          );
        }
        setAgentProgress({
          progress: 48,
          message: `正在生成全景图（已注入 ${referenceImages.length} 张 Kie 公网参考图）...`,
        });
      }

      let imageUrl = '';
      let imageUsage: Awaited<ReturnType<ImageAPI['generateImage']>>['usage'] | undefined;

      if (kieApi) {
        const result = await kieApi.generateImage({
          prompt: imageGenPrompt,
          ratio: PANORAMA_AGENT_IMAGE_GEN_ASPECT_RATIO,
          resolution: imageGenRes,
          model: imageGenModel,
          referenceImages,
        });
        setAgentProgress({ progress: 55, message: 'Kie 图像任务处理中…' });
        const finalResult = await kieApi.pollTaskUntilComplete(
          result.task_id,
          (status, apiProgress) => {
            setAgentProgress((prev) => ({
              ...prev,
              progress:
                typeof apiProgress === 'number'
                  ? Math.max(48, Math.min(95, apiProgress))
                  : Math.min(92, prev.progress + 4),
              message: `Kie 图像任务：${status}`,
            }));
          },
          120,
          3000
        );
        imageUsage = finalResult.usage;
        if (finalResult.status === 'success' && finalResult.result?.image_url) {
          imageUrl = finalResult.result.image_url;
        } else {
          throw new Error(finalResult.message || 'Kie 图像生成失败');
        }
      } else {
        const result = await imageApi!.generateImage({
          prompt: imageGenPrompt,
          ratio: PANORAMA_AGENT_IMAGE_GEN_ASPECT_RATIO,
          resolution: imageGenRes,
          model: imageGenModel,
          referenceImages,
        });
        imageUrl = result.result?.image_url || '';
        imageUsage = result.usage;
        if (!imageUrl && result.task_id) {
          setAgentProgress({ progress: 55, message: '图像任务处理中…' });
          const finalResult = await imageApi!.pollTaskUntilComplete(
            result.task_id,
            (status, apiProgress) => {
              setAgentProgress((prev) => ({
                ...prev,
                progress:
                  typeof apiProgress === 'number'
                    ? Math.max(48, Math.min(95, apiProgress))
                    : Math.min(92, prev.progress + 4),
                message: `图像任务：${status}`,
              }));
            },
            60,
            3000
          );
          imageUsage = finalResult.usage;
          if (finalResult.status === 'success' && finalResult.result?.image_url) {
            imageUrl = finalResult.result.image_url;
          } else {
            throw new Error(finalResult.message || '图像生成失败');
          }
        }
      }

      if (!imageUrl) {
        throw new Error('图像接口未返回可用 URL');
      }

      const imgBilled = imageUsage?.total_tokens ?? imageUsage?.completion_tokens ?? 0;
      if (imgBilled > 0) addUsedTokens('image', imgBilled);
      if (imgBilled > 0 && isKieImageProvider) addProviderTokens(KIE_GLOBAL_PROVIDER_TOKEN_KEY, imgBilled);

      const snap = useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as PanoramaNodeData | undefined;
      const prevUrl = (typeof snap?.panoramaTexUrl === 'string' ? snap.panoramaTexUrl : '').trim();
      const prevHist = normalizePanoramaTexHistory(snap?.panoramaTexHistory);
      let nextHist = prevHist.filter((h) => h.url !== imageUrl);
      if (prevUrl && prevUrl !== imageUrl) {
        const createdAt = Date.now();
        const stablePrevUrl = await createStablePanoramaHistoryUrl(id, prevUrl, createdAt);
        if (stablePrevUrl) {
          nextHist = [
            { url: stablePrevUrl, createdAt },
            ...nextHist.filter((h) => h.url !== stablePrevUrl && h.url !== prevUrl),
          ].slice(0, 16);
        }
      }
      let nextTexUrl = imageUrl;
      const diskOk = await postPanoramaTexToProjectDiskCache(id, imageUrl);
      if (diskOk) {
        diskTexHydrateFallbackRef.current = imageUrl;
        nextTexUrl = panoramaNodeIdToDiskRef(id);
      } else {
        diskTexHydrateFallbackRef.current = '';
      }
      updateNodeData(id, {
        panoramaTexUrl: nextTexUrl,
        panoramaTexHistory: nextHist,
        lastGenerationCredits: isKieImageProvider ? imgBilled : undefined,
      });
      setAgentProgress({ progress: 100, message: '全景图已生成，可拖动环视' });
    } catch (err) {
      console.error('智能体自动全景失败:', err);
      setAgentProgress({
        progress: 0,
        message: `失败：${err instanceof Error ? err.message : '未知错误'}`,
      });
    } finally {
      setAgentSubmitting(false);
      setTimeout(() => {
        setAgentProgress((cur) =>
          cur.progress === 100 ? { progress: 0, message: '' } : cur
        );
      }, 3200);
    }
  }, [
    addUsedTokens,
    currentImageProvider,
    currentImageProviderId,
    id,
    imageGenModel,
    imageGenRes,
    inboundUrls,
    panoramaMode,
    sceneImage,
    updateNodeData,
  ]);

  useAgentGenerationBridge(
    id,
    handleAgentSubmit,
    {
      status: agentSubmitting
        ? 'processing'
        : agentProgress.progress >= 100
          ? 'success'
          : agentProgress.message
            ? 'error'
            : 'idle',
      message: agentProgress.message,
    },
  );

  const viewerRef = useRef<PanoramaViewerHandle>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureErr, setCaptureErr] = useState('');
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadErr, setDownloadErr] = useState('');
  const [spawnMaterialBusy, setSpawnMaterialBusy] = useState(false);
  const [spawnMaterialErr, setSpawnMaterialErr] = useState('');

  const onManualUrlChange = useCallback(
    (next: string) => {
      updateNodeData(id, { panoramaTexUrl: next });
    },
    [id, updateNodeData]
  );

  const label = useMemo(
    () => ((typeof nodeData.label === 'string' && nodeData.label.trim()) || '720°全景') as string,
    [nodeData.label]
  );

  const applyViewerFrameAspect = useCallback(
    (ratioKey: SeedreamAspectRatio) => {
      const node = useCanvasStore.getState().nodes.find((n) => n.id === id);
      if (!node) return;

      const root = nodeRootRef.current;
      const shell = viewerShellRef.current;
      const { rw, rh } = parseAspectWh(ratioKey);

      const chromeH =
        root && shell ? Math.max(72, root.clientHeight - shell.clientHeight) : FALLBACK_CHROME_PX;

      let vw = shell && shell.clientWidth > 8 ? Math.round(shell.clientWidth) : readNodePixelSize(node).w;
      vw = Math.max(MIN_W, vw);

      let vh = Math.round((vw * rh) / rw);
      if (vh < MIN_VIEWER_INNER_H) {
        vh = MIN_VIEWER_INNER_H;
        vw = Math.round((vh * rw) / rh);
      }
      if (vw < MIN_W) {
        vw = MIN_W;
        vh = Math.round((vw * rh) / rw);
      }

      const histH = Math.round(historyStripRef.current?.getBoundingClientRect().height ?? 0);
      const outerH = Math.max(MIN_NODE_ABS_H, chromeH + histH + vh);
      const outerW = Math.max(MIN_W, vw);

      updatePanoramaGeometry(id, {
        x: node.position.x,
        y: node.position.y,
        width: outerW,
        height: outerH,
      });
      updateNodeData(id, {
        panoramaAgentImageAspect: ratioKey,
        panoramaAspect: ratioKey,
      });
    },
    [id, updateNodeData, updatePanoramaGeometry]
  );

  const handleDownloadPanorama = useCallback(async () => {
    const url = textureUrl.trim();
    if (!url) return;
    setDownloadErr('');
    setDownloadBusy(true);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const name = guessPanoramaDownloadFilename(url, blob.type || '');
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      console.error('全景图下载失败:', e);
      setDownloadErr(
        '下载失败（跨域或网络限制时可尝试在浏览器中打开图片链接后另存为）'
      );
    } finally {
      setDownloadBusy(false);
    }
  }, [textureUrl]);

  const handleSpawnPanoramaAsMaterial = useCallback(async () => {
    const url = textureUrl.trim();
    if (!url) return;
    setSpawnMaterialErr('');
    setSpawnMaterialBusy(true);
    try {
      const { dataUrl, mime } = await textureUrlToMaterialDataUrl(url);
      const pano = useCanvasStore.getState().nodes.find((n) => n.id === id);
      if (!pano) return;
      const { w, h } = readNodePixelSize(pano);
      const offsetX = w + 56;
      const pos = { x: pano.position.x + offsetX, y: pano.position.y + Math.min(120, Math.round(h * 0.15)) };
      const ts = Date.now();
      const ext =
        mime.includes('jpeg') || /image\/jpe?g/i.test(mime) ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
      const fileName = `全景图-${ts}.${ext}`;
      const newId = addNodeWithData(
        'material',
        pos,
        {
          label: '素材',
          type: 'material',
          fileUrl: dataUrl,
          thumbnailUrl: dataUrl,
          fileName,
          fileType: 'image',
        },
        { captureEntrance: true, syncCommit: true }
      );
      const created = useCanvasStore.getState().nodes.find((x) => x.id === newId);
      const fu = created ? (created.data as { fileUrl?: string }).fileUrl : '';
      if (
        created &&
        typeof fu === 'string' &&
        fu.startsWith('data:')
      ) {
        try {
          await persistInlineMaterialDataToProjectSidecar(
            newId,
            fu,
            (created.data as { thumbnailUrl?: string }).thumbnailUrl
          );
        } catch (e) {
          console.warn('[MagineCanvas] 全景→素材侧车保存失败', e);
        }
      }
      requestAnimationFrame(() => {
        const n = useCanvasStore.getState().nodes.find((x) => x.id === newId);
        if (n) setSelectedNode(n);
      });
    } catch (e) {
      console.error('全景抓取为素材失败:', e);
      setSpawnMaterialErr('抓取失败（跨域、资源不可用或体积过大）');
    } finally {
      setSpawnMaterialBusy(false);
    }
  }, [addNodeWithData, id, setSelectedNode, textureUrl]);

  const handleCapture = useCallback(async () => {
    setCaptureErr('');
    if (!textureUrl.trim()) {
      setCaptureErr('请先连接或填写全景图');
      return;
    }
    setCaptureBusy(true);
    try {
      const dataUrl = viewerRef.current?.capturePngDataUrl();
      if (!dataUrl || !dataUrl.startsWith('data:image')) {
        setCaptureErr('截取失败（跨域图片可能无法导出，请换同源或 data URL）');
        return;
      }
      const pano = useCanvasStore.getState().nodes.find((n) => n.id === id);
      if (!pano) return;
      const { w } = readNodePixelSize(pano);
      const offsetX = w + 56;
      const pos = { x: pano.position.x + offsetX, y: pano.position.y };
      const ts = Date.now();
      const fileName = `全景视角-${ts}.png`;
      const newId = addNodeWithData(
        'material',
        pos,
        {
          label: '素材',
          type: 'material',
          fileUrl: dataUrl,
          thumbnailUrl: dataUrl,
          fileName,
          fileType: 'image',
        },
        { captureEntrance: true, syncCommit: true }
      );
      const created = useCanvasStore.getState().nodes.find((x) => x.id === newId);
      const fu = created ? (created.data as { fileUrl?: string }).fileUrl : '';
      if (
        created &&
        typeof fu === 'string' &&
        fu.startsWith('data:')
      ) {
        try {
          await persistInlineMaterialDataToProjectSidecar(
            newId,
            fu,
            (created.data as { thumbnailUrl?: string }).thumbnailUrl
          );
        } catch (e) {
          console.warn('[MagineCanvas] 全景截取素材侧车保存失败', e);
        }
      }
      requestAnimationFrame(() => {
        const n = useCanvasStore.getState().nodes.find((x) => x.id === newId);
        if (n) setSelectedNode(n);
      });
    } finally {
      setCaptureBusy(false);
    }
  }, [addNodeWithData, id, setSelectedNode, textureUrl]);

  const activatePanoramaFromHistory = useCallback(
    async (pickUrl: string) => {
      const t = pickUrl.trim();
      if (!t) return;
      const snap = useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as PanoramaNodeData | undefined;
      const current = (typeof snap?.panoramaTexUrl === 'string' ? snap.panoramaTexUrl : '').trim();
      let hist = normalizePanoramaTexHistory(snap?.panoramaTexHistory).filter((h) => h.url !== t);
      if (current && current !== t) {
        const createdAt = Date.now();
        const stableCurrent = await createStablePanoramaHistoryUrl(id, current, createdAt);
        if (stableCurrent) {
          hist = [
            { url: stableCurrent, createdAt },
            ...hist.filter((h) => h.url !== stableCurrent && h.url !== current),
          ].slice(0, 16);
        }
      }
      updateNodeData(id, { panoramaTexUrl: t, panoramaTexHistory: hist });
    },
    [id, updateNodeData]
  );

  return (
    <div
      ref={nodeRootRef}
      className="mc-node-port-shell mc-panorama-node relative h-full w-full min-w-[260px] overflow-visible"
      style={{ minHeight: MIN_NODE_ABS_H }}
    >
      <NodeResizer
        nodeId={id}
        isVisible={selected}
        minWidth={MIN_W}
        minHeight={MIN_NODE_ABS_H}
        color="rgba(255,255,255,0.35)"
        lineClassName="!border-0 !bg-transparent opacity-0"
        handleClassName="!h-2.5 !w-2.5 !rounded-sm !border !border-white/35 !bg-[#1b2021]/90 !shadow-[0_0_10px_rgba(255,255,255,0.12)]"
        onResizeEnd={(_, p) => {
          updatePanoramaGeometry(id, { x: p.x, y: p.y, width: p.width, height: p.height });
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const stage = viewerStageRef.current;
              const shell = viewerShellRef.current;
              const w = (stage?.clientWidth ?? shell?.clientWidth) ?? 0;
              const h = stage?.clientHeight ?? 0;
              if (w > 8 && h > 8) {
                const closest = pickClosestSeedreamAspectFromSize(w, h);
                updateNodeData(id, {
                  panoramaAspect: closest,
                  panoramaAgentImageAspect: closest,
                });
                applyViewerFrameAspect(closest);
              }
            });
          });
        }}
      />

      <Handle
        type="target"
        position={Position.Left}
        isConnectable
        title={
          panoramaMode === 'agent_auto'
            ? '接入素材 / 生图 / 分镜等图片节点，作为智能体场景图（可与本地上传并存，生成时优先使用上传图）'
            : '接入素材 / 生图 / 分镜等作为全景纹理'
        }
        className="mc-node-handle"
      />

      <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-white/16 bg-[#121418]/96 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="flex flex-col border-b border-white/10 bg-black/28">
        <div className="mc-panorama-drag flex w-full min-w-0 cursor-grab items-center gap-2 px-2.5 py-2 active:cursor-grabbing">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/18 bg-white/[0.07] text-zinc-100">
            <Globe className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 truncate text-xs font-medium text-zinc-100" title="节点名称">
            {label}
          </span>
          <span className="ml-auto hidden shrink-0 text-[10px] text-zinc-500 sm:inline">环视 · 滚轮调视野</span>
        </div>

        <div className="nodrag nopan flex gap-1 border-t border-white/6 px-2 py-1.5">
          <button
            type="button"
            title="使用左侧连线或下方 URL 作为全景纹理"
            onClick={() => updateNodeData(id, { panoramaMode: 'standard' })}
            className={cn(
              'rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors',
              panoramaMode === 'standard'
                ? 'border-white/35 bg-white/14 text-zinc-50'
                : 'border-white/12 bg-black/30 text-zinc-400 hover:border-white/22 hover:bg-white/10'
            )}
          >
            标准
          </button>
          <button
            type="button"
            title="上传或左侧接入场景图，由图像模型结合内置提示词与引导线参考生成全景"
            onClick={() => {
              updateNodeData(id, { panoramaMode: 'agent_auto' });
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  const n = useCanvasStore.getState().nodes.find((x) => x.id === id);
                  const asp = resolvePanoramaFrameAspect((n?.data as PanoramaNodeData) || {});
                  applyViewerFrameAspect(asp);
                });
              });
            }}
            className={cn(
              'rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors',
              panoramaMode === 'agent_auto'
                ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-50'
                : 'border-white/12 bg-black/30 text-zinc-400 hover:border-white/22 hover:bg-white/10'
            )}
          >
            智能体自动全景
          </button>
        </div>

        {panoramaMode === 'agent_auto' ? (
          <div className="nodrag nopan space-y-2 border-t border-white/6 bg-black/20 px-2 py-2">
            <div className="flex flex-wrap items-end gap-2">
              <input
                ref={sceneFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onSceneFile}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 border-white/14 bg-black/35 text-[11px] text-zinc-100"
                onClick={() => sceneFileRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                上传场景图
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={agentSubmitting || !hasAgentSceneInput}
                className="h-8 gap-1 bg-cyan-600/85 text-[11px] text-white hover:bg-cyan-500/90 disabled:opacity-45"
                onClick={() => void handleAgentSubmit()}
              >
                {agentSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    处理中
                  </>
                ) : (
                  '生成'
                )}
              </Button>
            </div>
            {hasAgentSceneInput ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-start gap-2">
                  {sceneImage ? (
                    <div className="relative shrink-0">
                      <img
                        src={sceneImage}
                        alt="场景预览"
                        className="h-12 w-20 rounded border border-white/12 object-cover"
                      />
                      <button
                        type="button"
                        title="移除本地上传"
                        disabled={agentSubmitting}
                        onClick={(e) => {
                          e.stopPropagation();
                          updateNodeData(id, { panoramaAgentSceneImageDataUrl: '' });
                        }}
                        className={cn(
                          'nodrag nopan absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-white/25 bg-black/85 text-zinc-200 shadow-md transition-colors',
                          agentSubmitting
                            ? 'cursor-not-allowed opacity-40'
                            : 'hover:border-red-400/50 hover:bg-red-950/90 hover:text-red-100'
                        )}
                      >
                        <X className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                      </button>
                    </div>
                  ) : null}
                  {agentInboundSceneUrls.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {agentInboundSceneUrls.slice(0, 6).map((url, i) => (
                        <img
                          key={`${i}-${url.slice(0, 40)}`}
                          src={url}
                          alt={`参考 ${i + 1}`}
                          className="h-12 w-20 shrink-0 rounded border border-white/12 object-cover"
                        />
                      ))}
                      {agentInboundSceneUrls.length > 6 ? (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-white/12 bg-black/30 text-[10px] text-zinc-400">
                          +{agentInboundSceneUrls.length - 6}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <span className="text-[10px] text-zinc-500">
                  {sceneImage && agentInboundSceneUrls.length > 0
                    ? `已选本地上传 + ${agentInboundSceneUrls.length} 张连线参考图，点击「生成」调用图像模型`
                    : sceneImage
                      ? '已选本地上传场景图，点击「生成」调用图像模型'
                      : `已连线 ${agentInboundSceneUrls.length} 张参考图，点击「生成」调用图像模型`}
                </span>
              </div>
            ) : (
              <p className="text-[10px] text-zinc-500">
                支持本地上传图片，或将素材 / 生图 / 分镜等节点连到左侧作为场景图；大文件可能受存储配额限制。
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-0.5 block text-[10px] text-zinc-500">图片厂商</label>
                <Select
                  value={currentImageProviderId}
                  onValueChange={(value) => {
                    if (!value) return;
                    const provider = imageProviderOptions.find((p) => p.value === value);
                    const firstModel = provider?.models.find(isPanoramaImageModelOption) || '';
                    const nextRes = normalizeSeedreamResolution(firstModel, imageGenRes);
                    updateNodeData(id, {
                      panoramaAgentImageProviderId: value,
                      panoramaAgentImageModel: firstModel,
                      panoramaAgentImageResolution: nextRes,
                    });
                  }}
                  className="h-8 !min-h-0 !py-1 text-[11px]"
                >
                  {imageProviderOptions.length === 0 ? (
                    <SelectItem value="" disabled>暂无可用厂商</SelectItem>
                  ) : (
                    imageProviderOptions.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))
                  )}
                </Select>
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] text-zinc-500">图片模型</label>
                <Select
                  value={imageGenModel}
                  onValueChange={(v) => {
                    if (!v) return;
                    const nextRes = normalizeSeedreamResolution(v, imageGenRes);
                    updateNodeData(id, {
                      panoramaAgentImageProviderId: currentImageProviderId,
                      panoramaAgentImageModel: v,
                      panoramaAgentImageResolution: nextRes,
                    });
                  }}
                  className="h-8 !min-h-0 !py-1 text-[11px]"
                >
                  {currentImageModelOptions.length === 0 ? (
                    <SelectItem value="" disabled>暂无可用模型</SelectItem>
                  ) : (
                    currentImageModelOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))
                  )}
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-0.5 block text-[10px] text-zinc-500">预览框比例</label>
                <Select
                  value={frameAspect}
                  onValueChange={(v) => {
                    if (!v) return;
                    const next = v as SeedreamAspectRatio;
                    requestAnimationFrame(() => applyViewerFrameAspect(next));
                  }}
                  className="h-8 !min-h-0 !py-1 text-[11px]"
                >
                  {PANORAMA_ASPECT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] text-zinc-500">生成分辨率</label>
                <Select
                  value={imageGenRes}
                  onValueChange={(v) => {
                    if (!v) return;
                    updateNodeData(id, { panoramaAgentImageResolution: v as SeedreamResolution });
                  }}
                  className="h-8 !min-h-0 !py-1 text-[11px]"
                >
                  {supportedImageRes.map((r) => (
                    <SelectItem key={r} value={r}>
                      {SEEDREAM_RESOLUTION_LABELS[r]}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] text-zinc-500">提示词补充</label>
              <MentionTextarea
                value={promptSupplement}
                onChange={(next) => updateNodeData(id, { panoramaAgentLlmSupplement: next })}
                materials={connectedMaterials}
                placeholder="补充描述，会追加到内置提示词末尾…"
                minHeight="min-h-[48px]"
                minResizeWidth={200}
                minResizeHeight={40}
                size={promptSupplementSize}
                onLiveSizeChange={(size) => {
                  if (nodeRootRef.current) {
                    nodeRootRef.current.style.width = `${Math.max(MIN_W, size.width + 32)}px`;
                  }
                }}
                onSizeChange={(size) => {
                  updateNodeData(id, { panoramaPromptSupplementSize: size });
                  if (nodeRootRef.current) {
                    const w = Math.max(MIN_W, size.width + 32);
                    const h = nodeRootRef.current.clientHeight;
                    const node = useCanvasStore.getState().nodes.find((n) => n.id === id);
                    if (node) {
                      updatePanoramaGeometry(id, { x: node.position.x, y: node.position.y, width: w, height: h });
                    }
                  }
                  setTimeout(() => updateNodeInternals(id), 0);
                }}
                className="mc-panorama-prompt-supplement mc-node-frost-surface !border-white/10 !text-xs focus:!border-white/40"
              />
            </div>
            {agentProgress.message ? (
              <div className="space-y-1">
                <Progress
                  value={agentSubmitting ? Math.max(6, agentProgress.progress) : agentProgress.progress}
                  className="h-1"
                />
                <p className="text-[10px] text-zinc-400">{agentProgress.message}</p>
                <GenerationEta
                  active={agentSubmitting}
                  progress={agentProgress.progress}
                  estimateKey={`panorama:${currentImageProviderId}:${imageGenModel}`}
                  sessionKey={`panorama:${id}`}
                  defaultTotalSeconds={240}
                  className="block text-right"
                />
              </div>
            ) : null}
            {isCurrentKieImageProvider ? (
              <KieUsageInfo usage={panoramaKieUsage} lastCredits={nodeData.lastGenerationCredits} />
            ) : null}
          </div>
        ) : (
          <div className="nodrag nopan flex flex-wrap items-center gap-2 border-t border-white/6 px-2 py-1.5">
            <span className="shrink-0 text-[10px] text-zinc-500">预览框比例</span>
            <Select
              value={frameAspect}
              onValueChange={(v) => {
                if (!v) return;
                const next = v as SeedreamAspectRatio;
                requestAnimationFrame(() => applyViewerFrameAspect(next));
              }}
              className="h-8 min-w-[140px] flex-1 !py-1 text-[11px] sm:max-w-[220px]"
            >
              {PANORAMA_ASPECT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </Select>
          </div>
        )}
      </div>

      <div
        ref={viewerShellRef}
        className="nodrag nopan nowheel flex min-h-0 min-w-0 flex-1 flex-col bg-black"
      >
        {showPanoramaHistoryStrip ? (
          <div
            ref={historyStripRef}
            className="nodrag nopan flex shrink-0 flex-col gap-1 border-b border-white/10 bg-black/50 px-2 py-1.5"
          >
            <span className="text-[9px] font-medium uppercase tracking-wide text-zinc-500">历史全景</span>
            <div className="flex min-w-0 gap-1.5 overflow-x-auto overflow-y-hidden">
              {panoramaHistory.map((h) => (
                <button
                  key={`${h.createdAt}-${h.url.slice(0, 64)}`}
                  type="button"
                  title="点击切回该全景"
                  onClick={() => void activatePanoramaFromHistory(h.url)}
                  className="overflow-hidden rounded-md border border-white/15 bg-black/40 shadow-sm transition-colors hover:border-cyan-400/45 hover:bg-white/[0.06]"
                >
                  {historyThumbUrls[h.url] ? (
                    <img
                      src={historyThumbUrls[h.url]}
                      alt=""
                      className="h-10 w-[4.5rem] object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="flex h-10 w-[4.5rem] items-center justify-center text-zinc-600">
                      <Globe className="h-4 w-4" aria-hidden />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div
          ref={viewerStageRef}
          className="relative w-full shrink-0 overflow-hidden bg-black"
          style={previewAspectStyle}
        >
          {displayTextureUrl ? (
            <PanoramaViewer
              ref={viewerRef}
              imageUrl={displayTextureUrl}
              viewportZoom={zoom}
              className="!min-h-0 h-full w-full"
            />
          ) : (
            <div className="flex h-full min-h-0 flex-col items-center justify-center gap-1 px-4 py-6 text-center text-[11px] text-zinc-500">
              <Globe className="h-8 w-8 text-zinc-600" aria-hidden />
              {textureUrl.trim() ? (
                <>
                  <p>{textureResolveError ? '输入图读取失败' : '正在读取输入图...'}</p>
                  {textureResolveError ? (
                    <p className="max-w-[18rem] text-[10px] text-red-200/80">{textureResolveError}</p>
                  ) : null}
                </>
              ) : panoramaMode === 'agent_auto' ? (
                <>
                  <p>
                    上传或左侧接入场景图后点「生成」：环视区按上方「预览框比例」显示；生图宽高比由内置引导线图决定（见内置提示词）。分辨率在上方选择；手动缩放节点后会自动对齐最接近的预览比例。
                  </p>
                  <p className="text-zinc-600">生成完成后可在此拖动环视（与标准模式一致）。</p>
                </>
              ) : (
                <>
                  <p>从左侧连接「图像生成」「素材」或「手绘分镜」输出，或在下方粘贴全景图 URL。</p>
                  <p className="text-zinc-600">建议使用 2:1 等距柱状投影（Equirectangular）全景图。</p>
                </>
              )}
            </div>
          )}
          {textureUrl.trim() ? (
            <button
              type="button"
              title="截取当前视角为图片，并在画布上生成素材节点"
              disabled={captureBusy}
              onClick={() => void handleCapture()}
              className={cn(
                'absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium shadow-md backdrop-blur-md transition-colors',
                captureBusy
                  ? 'cursor-wait border-white/12 bg-black/70 text-zinc-500'
                  : 'border-emerald-500/45 bg-emerald-950/80 text-emerald-50 hover:border-emerald-400/60 hover:bg-emerald-900/90'
              )}
            >
              <Camera className="h-3 w-3 shrink-0" aria-hidden />
              一键截取
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 bg-black" aria-hidden />
      </div>

      {textureUrl.trim() ? (
        <div className="nodrag nopan flex flex-col gap-1 border-t border-white/8 bg-black/28 px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={downloadBusy}
              className="h-8 gap-1.5 border-white/14 bg-black/35 text-[11px] text-zinc-100"
              onClick={() => void handleDownloadPanorama()}
            >
              {downloadBusy ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              ) : (
                <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              下载全景图
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={spawnMaterialBusy}
              title="将当前完整全景纹理写入画布上的素材节点（可再连线或导出）"
              className="h-8 gap-1.5 border-cyan-500/25 bg-cyan-950/35 text-[11px] text-cyan-50 hover:border-cyan-400/40"
              onClick={() => void handleSpawnPanoramaAsMaterial()}
            >
              {spawnMaterialBusy ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              ) : (
                <ImagePlus className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              将全景图生成素材节点
            </Button>
            <span className="min-w-[8rem] flex-1 text-[10px] text-zinc-500">
              下载保存到磁盘；「将全景图生成素材节点」在画布右侧放置整张贴图素材，可再连线或导出。
            </span>
          </div>
          {downloadErr ? (
            <p className="text-[10px] text-amber-200/90">{downloadErr}</p>
          ) : null}
          {spawnMaterialErr ? (
            <p className="text-[10px] text-amber-200/90">{spawnMaterialErr}</p>
          ) : null}
        </div>
      ) : null}

      {captureErr ? (
        <p className="nodrag nopan border-t border-red-500/20 bg-red-950/35 px-2 py-1 text-[10px] text-red-200/90">
          {captureErr}
        </p>
      ) : null}

      {panoramaMode === 'standard' ? (
        <div className="nodrag nopan flex flex-col gap-1.5 border-t border-white/8 bg-black/22 px-2 py-1.5">
          <label className="text-[10px] text-zinc-500">全景图 URL（无连线时使用）</label>
          <Input
            value={manualUrl}
            onChange={(e) => onManualUrlChange(e.target.value)}
            placeholder="https://… 或 data:image/…"
            className="h-7 border-white/12 bg-black/30 text-[11px] text-zinc-200 placeholder:text-zinc-600"
          />
        </div>
      ) : null}
      </div>
    </div>
  );
}

export default memo(PanoramaNode);
