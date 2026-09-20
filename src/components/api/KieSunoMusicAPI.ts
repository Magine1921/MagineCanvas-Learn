'use client';

import type { ProviderConfig } from '@/components/seedance/SeedanceStore';
import { customProviderFetchJson } from '@/lib/custom-provider-request';

export interface KieSunoMusicParams {
  prompt: string;
  model?: string;
  duration?: number;
  style?: string;
  callBackUrl?: string;
}

export interface KieSunoMusicResponse {
  task_id?: string;
  audioUrl?: string;
  status?: string;
  fail_reason?: string;
}

interface KieSunoSubmitResponse {
  code?: number;
  msg?: string;
  data?: {
    taskId?: string;
  };
}

interface KieSunoRecordResponse {
  code?: number;
  msg?: string;
  data?: {
    status?: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    response?: {
      sunoData?: Array<{
        audioUrl?: string;
        streamAudioUrl?: string;
      }>;
    };
  };
}

function getBase(provider: ProviderConfig): string {
  return (provider.apiUrl || 'https://api.kie.ai').replace(/\/+$/, '');
}

function normalizeSunoModel(model?: string): string {
  const raw = (model || '').trim();
  const upper = raw.toUpperCase().replace(/[-.]/g, '_');
  if (
    upper === 'V5_5' ||
    upper === 'V5' ||
    upper === 'V4_5PLUS' ||
    upper === 'V4_5' ||
    upper === 'V4_5ALL' ||
    upper === 'V4' ||
    upper === 'V3_5'
  ) {
    return upper;
  }
  if (/SUNO[_-]?V3[_-]?5/i.test(raw)) return 'V3_5';
  if (/SUNO[_-]?V4/i.test(raw)) return 'V4';
  return 'V5';
}

function titleFromPrompt(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 48) : 'Magine Canvas Music';
}

export function createKieSunoMusicAPI(providerConfig: ProviderConfig) {
  const base = getBase(providerConfig);

  async function generateMusic(params: KieSunoMusicParams): Promise<KieSunoMusicResponse> {
    const customMode = Boolean(params.style?.trim());
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      customMode,
      instrumental: true,
      model: normalizeSunoModel(params.model),
      callBackUrl: params.callBackUrl || 'https://your-app.com/callback',
    };
    if (customMode) {
      body.style = params.style;
      body.title = titleFromPrompt(params.prompt);
    }

    const { ok, status, data, rawText } = await customProviderFetchJson(providerConfig, {
      targetUrl: `${base}/api/v1/generate`,
      method: 'POST',
      body,
    });

    if (!ok) {
      throw new Error(`Kie Suno Music error ${status}: ${rawText.slice(0, 500)}`);
    }

    const payload = data as KieSunoSubmitResponse;
    if (payload.code && payload.code !== 200) {
      throw new Error(`Kie Suno Music error: ${payload.msg || JSON.stringify(payload).slice(0, 300)}`);
    }

    return {
      task_id: payload.data?.taskId,
      status: payload.msg,
    };
  }

  async function queryMusicTask(taskId: string): Promise<KieSunoMusicResponse> {
    const { ok, status, data, rawText } = await customProviderFetchJson(providerConfig, {
      targetUrl: `${base}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
      method: 'GET',
      omitContentType: true,
    });

    if (!ok) {
      throw new Error(`Kie Suno Music query error ${status}: ${rawText.slice(0, 500)}`);
    }

    const payload = data as KieSunoRecordResponse;
    const record = payload.data;
    const audioUrl =
      record?.response?.sunoData?.find((item) => item.audioUrl)?.audioUrl ||
      record?.response?.sunoData?.find((item) => item.streamAudioUrl)?.streamAudioUrl;
    const taskStatus = record?.status || payload.msg;
    const failedStatuses = new Set([
      'CREATE_TASK_FAILED',
      'GENERATE_AUDIO_FAILED',
      'CALLBACK_EXCEPTION',
      'SENSITIVE_WORD_ERROR',
    ]);

    return {
      task_id: taskId,
      audioUrl,
      status: taskStatus,
      fail_reason:
        record?.errorMessage ||
        (record?.errorCode ? String(record.errorCode) : undefined) ||
        (taskStatus && failedStatuses.has(taskStatus) ? taskStatus : undefined),
    };
  }

  return { generateMusic, queryMusicTask };
}
