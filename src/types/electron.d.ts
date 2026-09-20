export {};

interface MagineBrowserTab {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  active?: boolean;
  audible?: boolean;
  attachedNodeId?: string;
}

interface MagineBrowserTabFrame {
  type: 'frame';
  nodeId: string;
  tabId: number;
  data: string;
  metadata?: Record<string, unknown>;
}

interface MagineUpdateState {
  status: 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'downloaded' | 'preparing' | 'installing' | 'error' | 'disabled';
  currentVersion: string;
  edition: 'full' | 'learn';
  installed: boolean;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string | unknown[];
  progress?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  message?: string;
}

declare global {
  interface Window {
    magineDesktop?: {
      isDesktop: boolean;
      projectsLoad: () => Promise<string | null>;
      projectsSave: (json: string) => Promise<void>;
      projectsIndexLoad: () => Promise<string | null>;
      projectsIndexSave: (json: string) => Promise<void>;
      projectLoad: (projectId: string) => Promise<string | null>;
      projectSave: (projectId: string, json: string) => Promise<void>;
      projectDelete: (projectId: string) => Promise<void>;
      selectDirectory?: (defaultPath?: string, title?: string) => Promise<string | null>;
      saveMedia?: (request: {
        sourceUrl?: string;
        bytes?: Uint8Array;
        suggestedName: string;
        mimeType?: string;
      }) => Promise<{
        ok: boolean;
        canceled: boolean;
        savedPath?: string;
        error?: string;
      }>;
      saveMediaBatch?: (request: {
        requestId: string;
        title?: string;
        groups: Array<{
          nodeId: string;
          folderName: string;
          items: Array<{
            sourceUrl?: string;
            bytes?: Uint8Array;
            suggestedName: string;
            mimeType?: string;
          }>;
        }>;
      }) => Promise<{
        ok: boolean;
        canceled: boolean;
        directory?: string;
        savedCount: number;
        failedCount: number;
        folders?: Array<{
          nodeId: string;
          folderPath: string;
          savedCount: number;
          failedCount: number;
        }>;
        error?: string;
      }>;
      onMediaBatchProgress?: (cb: (progress: {
        requestId: string;
        completedCount: number;
        totalCount: number;
        savedCount: number;
        failedCount: number;
        nodeId?: string;
        fileName?: string;
      }) => void) => () => void;
      settingsLoad: (key: string) => Promise<string | null>;
      settingsSave: (key: string, json: string) => Promise<void>;
      settingsRemove: (key: string) => Promise<void>;
      updateGetStatus?: () => Promise<MagineUpdateState>;
      updateCheck?: () => Promise<MagineUpdateState>;
      updateDownload?: () => Promise<MagineUpdateState>;
      updateInstall?: () => Promise<MagineUpdateState>;
      updatePrepared?: () => void;
      onUpdateStatus?: (cb: (status: MagineUpdateState) => void) => () => void;
      onUpdatePrepareInstall?: (cb: (payload: { version: string }) => void) => () => void;
      h3EngineInspect?: () => Promise<MagineH3EngineReport>;
      h3EngineConfigure?: (modelRoot: string) => Promise<MagineH3EngineReport>;
      h3EngineInstallRuntime?: () => Promise<MagineH3EngineReport>;
      h3EngineInstallModel?: (workflow: 'fl2va' | 'ref2va') => Promise<{ task_id: string }>;
      h3EngineStart?: () => Promise<unknown>;
      h3EngineSubmit?: (params: MagineH3SubmitParams) => Promise<{ task_id: string }>;
      h3EngineQuery?: (taskId: string) => Promise<MagineH3TaskStatus>;
      h3EngineFindLatest?: (prompt: string) => Promise<MagineH3TaskStatus | null>;
      h3EngineCancel?: (taskId: string) => Promise<{ ok: boolean }>;
      h3EngineStop?: () => Promise<boolean>;
      h3ComfyInspect?: (endpoint: string) => Promise<MagineH3ComfyReport>;
      h3ComfyDiscover?: (preferred?: string) => Promise<MagineH3ComfyReport>;
      h3ComfyManagedInspect?: () => Promise<MagineH3ComfyManagedReport>;
      h3ComfyConfigure?: (options: { installRoot: string; modelRoot: string }) => Promise<MagineH3ComfyManagedReport>;
      h3ComfyInstallAll?: () => Promise<MagineH3ComfyManagedReport>;
      h3ComfyStart?: () => Promise<MagineH3ComfyManagedReport>;
      h3ComfyStop?: () => Promise<MagineH3ComfyManagedReport>;
      h3ComfySubmit?: (endpoint: string, params: MagineH3SubmitParams) => Promise<{ task_id: string }>;
      h3ComfyQuery?: (taskId: string) => Promise<MagineH3TaskStatus>;
      h3ComfyFindLatest?: (prompt: string) => Promise<MagineH3TaskStatus | null>;
      h3ComfyCancel?: (taskId: string) => Promise<{ ok: boolean }>;
      onH3EngineEvent?: (cb: (payload: unknown) => void) => () => void;
      openExternal?: (url: string) => Promise<boolean>;
      openPurchaseUrl?: (url: string) => Promise<boolean>;
      browserTabStatus?: () => Promise<{
        connected: boolean;
        port: number;
        extensionPath: string;
      }>;
      browserTabSetup?: () => Promise<{ extensionPath: string }>;
      browserTabList?: () => Promise<MagineBrowserTab[]>;
      browserTabAttach?: (
        nodeId: string,
        tabId: number,
        viewport?: { width: number; height: number },
      ) => Promise<MagineBrowserTab>;
      browserTabDetach?: (nodeId: string) => Promise<boolean>;
      browserTabCommand?: (
        nodeId: string,
        command: 'navigate' | 'reload' | 'back' | 'forward',
        value?: string,
      ) => Promise<boolean>;
      browserTabInput?: (nodeId: string, input: Record<string, unknown>) => void;
      browserTabDropMedia?: (
        nodeId: string,
        request: {
          sourceUrl: string;
          fileName: string;
          fileType: 'image' | 'video' | 'audio';
          mimeType?: string;
          x: number;
          y: number;
        },
      ) => Promise<boolean>;
      browserTabExtractMedia?: (
        nodeId: string,
        point: { x: number; y: number },
      ) => Promise<{
        sourceUrl: string;
        originalUrl?: string;
        fileName: string;
        fileType: 'image' | 'video' | 'audio';
      } | null>;
      onBrowserTabFrame?: (cb: (payload: MagineBrowserTabFrame) => void) => () => void;
      onBrowserTabState?: (cb: (payload: {
        type: 'tab-state';
        nodeId: string;
        tab: MagineBrowserTab;
      }) => void) => () => void;
      onBrowserTabDetached?: (cb: (payload: {
        type: 'detached';
        nodeId: string;
        tabId: number;
        reason?: string;
      }) => void) => () => void;
      onBrowserTabStatus?: (cb: (payload: {
        type: 'status';
        connected: boolean;
        error?: string;
      }) => void) => () => void;
      browserRegisterGuest?: (nodeId: string, guestId: number) => Promise<boolean>;
      browserDesktopListWindows?: () => Promise<Array<{
        id: string;
        title: string;
        processName: string;
        processId: number;
        attachedNodeId?: string;
      }>>;
      browserDesktopAttach?: (
        nodeId: string,
        windowId: string,
        bounds: { x: number; y: number; width: number; height: number; visible?: boolean },
      ) => Promise<boolean>;
      browserDesktopSetBounds?: (
        nodeId: string,
        bounds: { x: number; y: number; width: number; height: number; visible?: boolean },
      ) => Promise<boolean>;
      browserDesktopFocus?: (nodeId: string) => Promise<boolean>;
      browserDesktopBlur?: (nodeId: string) => Promise<boolean>;
      browserDesktopDetach?: (nodeId: string) => Promise<boolean>;
      browserImportMedia?: (request: {
        sourceUrl: string;
        fileName?: string;
        fileType?: 'image' | 'video' | 'audio';
      }) => Promise<{
        url: string;
        fileName: string;
        fileType: 'image' | 'video' | 'audio';
        mimeType?: string;
      }>;
      browserCanAcceptCanvasMediaDrag?: () => boolean;
      browserPrepareCanvasMediaDrag?: (request: {
        dragId: string;
        sourceUrl?: string;
        bytes?: Uint8Array;
        fileName: string;
        fileType: 'image' | 'video' | 'audio';
        mimeType?: string;
      }) => Promise<boolean>;
      browserStartPreparedCanvasMediaDrag?: (dragId: string) => void;
      browserCancelCanvasMediaDrag?: (dragId: string) => Promise<boolean>;
      materialVideoTrim?: (request: {
        sourceUrl: string;
        fileName?: string;
        start: number;
        end: number;
      }) => Promise<{
        url: string;
        fileName: string;
        duration: number;
      }>;
      materialAudioTrim?: (request: {
        sourceUrl: string;
        fileName?: string;
        start: number;
        end: number;
      }) => Promise<{
        url: string;
        fileName: string;
        duration: number;
      }>;
      materialVideoThumbnail?: (request: {
        sourceUrl: string;
        time?: number;
        maxEdge?: number;
      }) => Promise<{
        dataUrl: string;
      }>;
      onBrowserMediaDownloaded?: (cb: (media: {
        id: string;
        nodeId: string;
        fileName: string;
        fileType: 'image' | 'video' | 'audio';
        mimeType?: string;
        url: string;
        createdAt: number;
      }) => void) => () => void;
      dreaminaUserCredit?: (cliPath: string) => Promise<unknown>;
      dreaminaLogin?: (
        cliPath: string,
        forceRelogin?: boolean,
        browser?: { type?: 'system' | 'chrome' | 'edge' | 'firefox' | 'custom'; path?: string },
      ) => Promise<unknown>;
      dreaminaOpenLoginUrl?: (
        url: string,
        browser?: { type?: 'system' | 'chrome' | 'edge' | 'firefox' | 'custom'; path?: string },
      ) => Promise<boolean>;
      onDreaminaLoginProgress?: (cb: (info: unknown) => void) => () => void;
      mobileCameraStart?: (nodeId: string, aspect?: string, recordingDuration?: number) => Promise<{
        sessionId: string;
        url: string;
        secureUrl: string;
        certificateUrl: string;
        profileUrl: string;
        qrDataUrl: string;
        expiresAt: number;
        port: number;
        securePort: number;
        address: string;
      }>;
      mobileCameraStop?: (sessionId: string) => Promise<boolean>;
      mobileCameraPreview?: (
        sessionId: string,
        bytes: Uint8Array,
        mimeType?: 'image/jpeg' | 'image/webp',
        aspect?: string,
        recording?: boolean,
        recordingRemainingMs?: number,
      ) => void;
      onMobileCameraInput?: (cb: (input: {
        type: 'status' | 'pose' | 'command';
        sessionId: string;
        nodeId: string;
        receivedAt: number;
        status?: 'connected' | 'disconnected';
        command?: 'calibrate' | 'record-start' | 'record-stop' | 'straighten';
        seq?: number;
        orientation?: {
          alpha: number;
          beta: number;
          gamma: number;
          screen: number;
          available: boolean;
        };
        move?: { x: number; y: number; z: number };
        zoom?: number;
        stabilization?: boolean;
        tracking?: {
          position: { x: number; y: number; z: number };
          orientation?: {
            x: number;
            y: number;
            z: number;
            w: number;
          } | null;
          available: boolean;
          confidence: number;
          source?: 'webxr' | 'imu' | 'none';
          state?: 'tracking' | 'limited' | 'unavailable';
          timestamp?: number;
        };
      }) => void) => () => void;
    };
  }

  interface MagineH3SubmitParams {
    sourceNodeId?: string;
    model: string;
    prompt: string;
    duration?: number;
    ratio?: string;
    resolution?: '720P' | '1080P';
    referenceImage?: string;
    endImage?: string;
    referenceImages?: string[];
    referenceVideos?: string[];
    referenceAudios?: string[];
    seed?: number;
    numInferenceSteps?: number;
  }

  interface MagineH3TaskStatus {
    task_id: string;
    status: 'submitted' | 'queued' | 'processing' | 'succeed' | 'failed';
    video_url?: string;
    video_path?: string;
    message?: string;
    progress?: number;
  }

  interface MagineH3EngineReport {
    running: boolean;
    modelRoot: string;
    outputRoot: string;
    hardware: {
      level: 'unsupported' | 'experimental' | 'supported' | 'recommended';
      profile: 'constrained' | 'consumer' | 'workstation';
      cpu: string;
      logicalCores: number;
      ramBytes: number;
      warnings: string[];
      gpus: Array<{ name: string; vramBytes: number; driver?: string }>;
      disk?: { root: string; freeBytes: number; totalBytes: number } | null;
    };
    model: {
      root: string;
      format: 'missing' | 'legacy-comfy' | 'diffusers';
      fl2vaReady: boolean;
      ref2vaReady: boolean;
      missingCommon: string[];
      legacyFiles: string[];
      estimatedInstallBytes: {
        fl2va: number;
        ref2va: number;
      };
    };
    runtime: {
      installed: boolean;
      ready: boolean;
      missing?: string[];
      error?: string;
      pythonVersion?: string;
      cudaAvailable?: boolean;
      deviceName?: string;
    };
  }

  interface MagineH3ComfyReport {
    endpoint: string;
    connected: boolean;
    version: string;
    system: {
      os?: string;
      ram_total?: number;
      ram_free?: number;
      python_version?: string;
      pytorch_version?: string;
    };
    devices: Array<{
      name?: string;
      type?: string;
      vram_total?: number;
      vram_free?: number;
    }>;
    queue: { running: number; pending: number };
    nodes: { ready: boolean; missing: string[] };
    models: {
      fl2va: string[];
      ref2va: string[];
      textEncoders: string[];
      videoVaes: string[];
      audioVaes: string[];
      fl2vaReady: boolean;
      ref2vaReady: boolean;
    };
    references: { images: boolean; videos: boolean; audios: boolean };
    warnings: string[];
  }

  interface MagineH3ComfyManagedReport {
    installRoot: string;
    modelRoot: string;
    endpoint: string;
    runtime: {
      installed: boolean;
      running: boolean;
      managedProcess: boolean;
      root?: string;
    };
    models: {
      ready: boolean;
      totalBytes: number;
      installedBytes: number;
      missingBytes: number;
      files: Array<{
        folder: string;
        name: string;
        size: number;
        sha256: string;
        path: string;
        installedBytes: number;
        ready: boolean;
      }>;
    };
    hardware: {
      nvidiaDetected: boolean;
      vramBytes: number;
      oneClickSupported: boolean;
    };
    installDisk: { root: string; freeBytes: number; totalBytes: number } | null;
    modelDisk: { root: string; freeBytes: number; totalBytes: number } | null;
    service: MagineH3ComfyReport | null;
    ready: boolean;
  }
}
