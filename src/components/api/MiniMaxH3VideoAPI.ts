'use client';

import type { ProviderConfig } from '@/components/seedance/SeedanceStore';

export interface MiniMaxH3VideoParams {
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

export interface MiniMaxH3TaskStatus {
  task_id: string;
  status: 'submitted' | 'processing' | 'succeed' | 'failed';
  video_url?: string;
  video_path?: string;
  message?: string;
  progress?: number;
}

export type MiniMaxH3ConnectionReport =
  | (MagineH3EngineReport & { engine: 'magine'; endpoint: 'magine://h3-engine' })
  | (MagineH3ComfyReport & { engine: 'comfyui' });

export const MINIMAX_H3_FL2VA_MODEL = 'minimax_h3_fl2va_pruned_fp8_scaled.safetensors';
export const MINIMAX_H3_REF2VA_MODEL = 'minimax_h3_ref2va_pruned_fp8_scaled.safetensors';

export function isMiniMaxH3Ref2VAModel(model?: string): boolean {
  return (model || '').toLowerCase().includes('ref2va');
}

export function isComfyUIH3Endpoint(apiUrl?: string): boolean {
  return /^https?:\/\//i.test(String(apiUrl || '').trim());
}

function desktopBridge() {
  const bridge = window.magineDesktop;
  if (!bridge?.isDesktop) {
    throw new Error('Magine H3 Engine 仅支持 Electron 桌面版');
  }
  return bridge;
}

function normalizeTask(task: MagineH3TaskStatus): MiniMaxH3TaskStatus {
  return {
    ...task,
    status: task.status === 'queued' ? 'submitted' : task.status,
  };
}

export async function inspectMiniMaxH3Connection(
  apiUrl = 'magine://h3-engine',
  _apiKey = '',
): Promise<MiniMaxH3ConnectionReport> {
  void _apiKey;
  const bridge = desktopBridge();
  if (isComfyUIH3Endpoint(apiUrl)) {
    if (!bridge.h3ComfyInspect) throw new Error('当前桌面版本未包含 ComfyUI 兼容接口');
    return {
      ...(await bridge.h3ComfyInspect(apiUrl)),
      engine: 'comfyui',
    };
  }
  const inspect = bridge.h3EngineInspect;
  if (!inspect) throw new Error('当前桌面版本未包含 Magine H3 Engine');
  return {
    ...(await inspect()),
    engine: 'magine',
    endpoint: 'magine://h3-engine',
  };
}

export function createMiniMaxH3VideoAPI(providerConfig: ProviderConfig) {
  const bridge = desktopBridge();
  const comfyMode = isComfyUIH3Endpoint(providerConfig.apiUrl);

  async function createTask(params: MiniMaxH3VideoParams): Promise<{ task_id: string }> {
    if (comfyMode) {
      if (!bridge.h3ComfySubmit) throw new Error('当前桌面版本未包含 ComfyUI H3 任务接口');
      return bridge.h3ComfySubmit(providerConfig.apiUrl, params);
    }
    if (!bridge.h3EngineSubmit) throw new Error('当前桌面版本未包含 H3 任务接口');
    return bridge.h3EngineSubmit(params);
  }

  async function queryTask(taskId: string): Promise<MiniMaxH3TaskStatus> {
    if (taskId.startsWith('comfy:')) {
      if (!bridge.h3ComfyQuery) throw new Error('当前桌面版本未包含 ComfyUI H3 查询接口');
      return normalizeTask(await bridge.h3ComfyQuery(taskId));
    }
    if (!bridge.h3EngineQuery) throw new Error('当前桌面版本未包含 H3 查询接口');
    return normalizeTask(await bridge.h3EngineQuery(taskId));
  }

  async function findLatestTaskByPrompt(prompt: string): Promise<MiniMaxH3TaskStatus | null> {
    if (comfyMode) {
      if (!bridge.h3ComfyFindLatest) return null;
      const task = await bridge.h3ComfyFindLatest(prompt);
      return task ? normalizeTask(task) : null;
    }
    if (!bridge.h3EngineFindLatest) return null;
    const task = await bridge.h3EngineFindLatest(prompt);
    return task ? normalizeTask(task) : null;
  }

  async function downloadVideoContent(taskId: string): Promise<string> {
    const task = await queryTask(taskId);
    if (task.status !== 'succeed' || !task.video_url) {
      throw new Error(task.message || 'H3 任务尚未生成可播放视频');
    }
    return task.video_path || task.video_url;
  }

  async function cancelTask(taskId: string): Promise<boolean> {
    if (taskId.startsWith('comfy:')) {
      if (!bridge.h3ComfyCancel) return false;
      return (await bridge.h3ComfyCancel(taskId)).ok;
    }
    if (!bridge.h3EngineCancel) return false;
    return (await bridge.h3EngineCancel(taskId)).ok;
  }

  return {
    createTask,
    queryTask,
    findLatestTaskByPrompt,
    downloadVideoContent,
    cancelTask,
  };
}
