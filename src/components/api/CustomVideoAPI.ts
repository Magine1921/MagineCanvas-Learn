'use client';

import type { ProviderConfig } from '@/components/seedance/SeedanceStore';
import { customProviderFetchJson } from '@/lib/custom-provider-request';
import {
  extractFirstString,
  extractValuesByPaths,
  getEffectiveApiProfile,
  isVideoTaskSuccessful,
  resolveProviderEndpoint,
} from '@/lib/provider-api-profile';

export interface CustomVideoGenerateParams {
  model: string;
  prompt: string;
  ratio?: string;
  duration?: number;
  resolution?: string;
  referenceImage?: string;
  extra?: Record<string, unknown>;
}

export interface CustomVideoTaskStatus {
  task_id: string;
  status: 'submitted' | 'processing' | 'succeed' | 'failed';
  video_url?: string;
  message?: string;
}

/**
 * 通用自定义视频生成 API（可配置 submit/poll 端点、响应字段与成功状态）。
 */
export function createCustomVideoAPI(providerConfig: ProviderConfig) {
  const profile = getEffectiveApiProfile(providerConfig, 'video');

  async function createTask(params: CustomVideoGenerateParams): Promise<{ task_id: string }> {
    const endpoint = resolveProviderEndpoint(providerConfig, 'video', 'videoSubmit');
    const body: Record<string, unknown> = {
      model: params.model,
      prompt: params.prompt,
      ...params.extra,
    };
    if (params.ratio) {
      body.ratio = params.ratio;
      body.aspect_ratio = params.ratio;
    }
    if (params.duration) body.duration = params.duration;
    if (params.resolution) body.resolution = params.resolution;
    if (params.referenceImage) {
      body.first_frame_image = params.referenceImage;
      body.image = params.referenceImage;
    }

    const { ok, status, data, rawText } = await customProviderFetchJson(providerConfig, {
      targetUrl: endpoint,
      method: 'POST',
      body,
    });

    if (!ok) {
      throw new Error(`Custom video API error ${status}: ${rawText.slice(0, 300)}`);
    }

    const taskId = extractFirstString(data, profile.response.taskId);
    if (!taskId) throw new Error('No task_id in response (请检查响应映射 taskId 路径)');

    return { task_id: taskId };
  }

  async function queryTask(taskId: string): Promise<CustomVideoTaskStatus> {
    const endpoint = resolveProviderEndpoint(providerConfig, 'video', 'videoPoll', {
      task_id: taskId,
    });
    const pollMethod = profile.videoPollMethod || 'GET';

    const { data } = await customProviderFetchJson(providerConfig, {
      targetUrl: endpoint,
      method: pollMethod,
      body: pollMethod === 'POST' ? { task_id: taskId } : undefined,
      omitContentType: pollMethod === 'GET',
    });

    const statusRaw = extractFirstString(data, profile.response.videoStatus) || 'processing';
    const videoUrl = extractFirstString(data, profile.response.videoUrl);
    const succeed = isVideoTaskSuccessful(statusRaw, profile.videoSuccessStatuses);

    let mapped: CustomVideoTaskStatus['status'] = 'processing';
    if (succeed && videoUrl) mapped = 'succeed';
    else if (['failed', 'error', 'cancelled', 'fail'].includes(statusRaw.toLowerCase())) {
      mapped = 'failed';
    } else if (statusRaw.toLowerCase() === 'submitted') {
      mapped = 'submitted';
    }

    const failReason = extractValuesByPaths(data, ['fail_reason', 'message', 'error'])[0];

    return {
      task_id: taskId,
      status: mapped,
      video_url: videoUrl,
      message: failReason,
    };
  }

  return { createTask, queryTask };
}
