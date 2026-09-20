'use client';

import { create } from 'zustand';
import type { DreaminaCliCreditSnapshot } from '@/lib/dreamina-cli-credits';
import { defaultDreaminaCliCreditSnapshot } from '@/lib/dreamina-cli-credits';
import { persist } from 'zustand/middleware';
import { createDesktopDualStorage } from '@/lib/desktop-settings-persist';
import type { LlmTextProviderId } from '@/lib/llm-text-provider';
import type { ProviderApiProfile } from '@/lib/provider-api-profile';
import { normalizeUserGeminiApiKey } from '@/lib/gemini-api-url';
import { sanitizeViapiEnhanEndpoint } from '@/lib/aliyun-viapi-endpoint';
import type { ImageApiProvider } from '@/components/api/ImageAPI';
import {
  defaultTencentMpsSubtitleRemovalConfig,
  normalizeTencentMpsSubtitleRemovalConfig,
  type TencentMpsSubtitleRemovalConfig,
} from '@/lib/tencent-mps-subtitle-removal';

interface APIConfig {
  apiKey: string;
  apiUrl: string;
}

// ---- Provider architecture (V2) ----

export type AuthType =
  | 'volcengine-bearer'
  | 'gemini-bearer'
  | 'standard-bearer'
  | 'elevenlabs-api-key'
  | 'kling-jwt';

export type ApiCategory = 'image' | 'video' | 'audio' | 'llm' | 'enhance';

export interface ProviderConfig {
  label: string;
  enabled: boolean;
  apiKey: string;
  apiUrl: string;
  models: string[];
  authType: AuthType;
  purchaseUrl?: string;
  description?: string;
  voiceId?: string;
  /** 自定义提供商 API 契约（端点路径、响应字段映射） */
  apiProfile?: ProviderApiProfile;
}

export interface CategoryConfig {
  activeProviderId: string;
  providers: Record<string, ProviderConfig>;
  customProviders: Record<string, ProviderConfig>;
}

export interface ProviderTokenBucket {
  remainingTokens: number | null;
  usedTokens: number;
}

export type ProviderTokenKey = string; // "category.providerId"

export interface ImageApiConfig extends APIConfig {
  /** Image nodes use Seedream or GPT-image compatible generation APIs. */
  provider: ImageApiProvider;
}

export interface MultimodalApiConfig extends APIConfig {
  model: string;
}

export interface ClaudeApiConfig extends APIConfig {
  model: string;
}

export type ApiTokenKind = 'image' | 'video' | 'llm' | 'multimodal' | 'claude';

interface TokenBucket {
  arkRemainingTokens: number | null;
  usedTokens: number;
}

interface TokenConfig {
  image: TokenBucket;
  video: TokenBucket;
  llm: TokenBucket;
  multimodal: TokenBucket;
  claude: TokenBucket;
}

export interface ElevenLabsApiConfig {
  apiKey: string;
  voiceId: string;
}

/**
 * Legacy Aliyun VIAPI config kept for old saved workflows.
 * The active quality-enhance node now uses Topaz / Kie provider config.
 */
export interface EnhanceApiConfig {
  aliyunAccessKeyId: string;
  aliyunAccessKeySecret: string;
  /** 图像超分：`imageenhan.cn-shanghai.aliyuncs.com` */
  aliyunImageEnhanEndpoint: string;
  /** 视频超分：`videoenhan.cn-shanghai.aliyuncs.com` */
  aliyunVideoEnhanEndpoint: string;
  /** Region matching the endpoint, e.g. `cn-shanghai`. */
  aliyunRegionId: string;
  /** `MakeSuperResolutionImage` Mode, e.g. base. */
  aliyunImageSuperResolveMode: string;
  /** `MakeSuperResolutionImage` UpscaleFactor, e.g. 2. */
  aliyunImageSuperResolveUpscaleFactor: number;
  /** `SuperResolveVideo` BitRate, e.g. 5. */
  aliyunSuperResolveBitRate: number;
}

export type DreaminaLoginBrowser = 'system' | 'chrome' | 'edge' | 'firefox' | 'custom';

export interface DreaminaCliConfig {
  /** CLI binary path, defaults to 'dreamina' from PATH. */
  cliPath: string;
  /** OAuth 授权页使用哪个浏览器打开 */
  loginBrowser: DreaminaLoginBrowser;
  /** 自定义浏览器 exe 路径 */
  loginBrowserPath: string;
  /** 是否已通过 dreamina login 登录 */
  loggedIn: boolean;
  /** Login user name from user_credit JSON. */
  loginName: string;
  /** Enabled model list. */
  enabledModels: string[];
  /** 是否在图片节点中显示 CLI 后端选项 */
  imageEnabled: boolean;
  /** 是否在视频节点中显示 CLI 后端选项 */
  videoEnabled: boolean;
}

export interface VoiceHistoryItem {
  voice_id: string;
  voice_name?: string;
  source: 'clone' | 'design';
  demo_audio?: string;  // base64-encoded MP3
  created_at: string;
}

export interface SeedanceConfig {
  imageApi: ImageApiConfig;
  videoApi: APIConfig;
  multimodalApi: MultimodalApiConfig;
  claudeApi?: ClaudeApiConfig;
  /** Legacy quality-enhance config retained for migration/backward compatibility. */
  enhanceApi: EnhanceApiConfig;
  /** Tencent Cloud MPS smart subtitle removal. */
  subtitleRemovalApi: TencentMpsSubtitleRemovalConfig;
  /** Text LLM source used when nodes follow the default. */
  defaultLlmSource: LlmTextProviderId;
  /** Default model used when nodes follow the default. */
  defaultLlmModel: string;
  elevenLabs: ElevenLabsApiConfig;
  /** Voice assistant TTS providerId from the audio category. */
  voiceAssistantSoundProviderId: string;
  /** 语音助手 TTS 声音模型/音色 ID */
  voiceAssistantSoundModel: string;
  /** Voice assistant master switch. */
  voiceAssistantEnabled: boolean;
  /** 语音助手运行开关：音色 */
  voiceAssistantTimbreEnabled: boolean;
  /** Deprecated full-modal switch retained for old config migration. */
  voiceAssistantFullModalEnabled: boolean;
  /** 语音助手运行开关：STT */
  voiceAssistantSttEnabled: boolean;
  /** 语音助手运行开关：TTS */
  voiceAssistantTtsEnabled: boolean;
  /** Voice assistant STT provider id, currently local SenseVoice. */
  voiceAssistantSttProviderId: string;
  /** Auto-start voice interaction after page load. */
  voiceAssistantAutoStart: boolean;
  /** ElevenLabs TTS stability, default 0.35. */
  voiceAssistantTtsStability: number;
  /** ElevenLabs TTS style, default 0.5. */
  voiceAssistantTtsStyle: number;
  /** ElevenLabs TTS similarity boost, default 0.75. */
  voiceAssistantTtsSimilarityBoost: number;
  /** MiniMax TTS speed, 0.5 to 2.0, default 1.0. */
  voiceAssistantTtsSpeed: number;
  /** MiniMax voice history with generated voice previews. */
  voiceHistory: VoiceHistoryItem[];
  /** 即梦CLI 配置 */
  dreaminaCli: DreaminaCliConfig;
  // ---- V2 provider architecture ----
  image: CategoryConfig;
  video: CategoryConfig;
  audio: CategoryConfig;
  llm: CategoryConfig;
  enhance: CategoryConfig;
  providerTokens: Record<ProviderTokenKey, ProviderTokenBucket>;
}

interface SeedanceStore {
  config: SeedanceConfig;
  tokenConfig: TokenConfig;
  tokenUsageVersion: number;
  configVersion: number;
  dreaminaCliCredit: DreaminaCliCreditSnapshot;
  dreaminaCliSessionUsedCredits: number;
  saveApiConfig: (
    kind: 'image' | 'video',
    apiKey: string,
    apiUrl: string,
    arkRemainingTokens: number | null,
    opts?: { imageProvider?: ImageApiProvider }
  ) => void;
  saveElevenLabsConfig: (voiceId: string, apiKey: string) => void;
  saveVideoTabConfig: (opts: {
    apiKey: string;
    apiUrl: string;
    arkRemainingTokens: number | null;
  }) => void;
  saveMultimodalApiConfig: (opts: {
    apiKey: string;
    apiUrl: string;
    model: string;
    arkRemainingTokens: number | null;
  }) => void;
  saveEnhanceApiConfig: (patch: Partial<EnhanceApiConfig>) => void;
  saveSubtitleRemovalApiConfig: (patch: Partial<TencentMpsSubtitleRemovalConfig>) => void;
  setDefaultLlmSource: (source: LlmTextProviderId) => void;
  setMultimodalApiKey: (apiKey: string) => void;
  setMultimodalApiUrl: (apiUrl: string) => void;
  setMultimodalModel: (model: string) => void;
  setImageApiKey: (apiKey: string) => void;
  setImageApiUrl: (apiUrl: string) => void;
  setVideoApiKey: (apiKey: string) => void;
  setVideoApiUrl: (apiUrl: string) => void;
  setTokenConfig: (config: Partial<TokenConfig>) => void;
  setArkRemainingTokens: (kind: ApiTokenKind, n: number | null) => void;
  addUsedTokens: (kind: ApiTokenKind, amount: number) => void;
  // ---- V2 provider methods ----
  saveProviderConfig: (category: ApiCategory, providerId: string, config: ProviderConfig) => void;
  setActiveProvider: (category: ApiCategory, providerId: string) => void;
  addProviderTokens: (key: ProviderTokenKey, amount: number) => void;
  setProviderRemainingTokens: (key: ProviderTokenKey, n: number | null) => void;
  saveDreaminaCliConfig: (patch: Partial<DreaminaCliConfig>) => void;
  setDreaminaCliCredits: (patch: Partial<DreaminaCliCreditSnapshot>) => void;
  addDreaminaCliSessionUsedCredits: (amount: number) => void;
  applyDreaminaCliCreditSpend: (amount: number) => void;
  setDefaultLlmModel: (model: string) => void;
  setVoiceAssistantSound: (providerId: string, voiceModel: string) => void;
  setVoiceAssistantEnabled: (enabled: boolean) => void;
  setVoiceAssistantTtsParams: (params: {
    stability?: number;
    style?: number;
    similarityBoost?: number;
    speed?: number;
  }) => void;
  setVoiceAssistantToggles: (toggles: {
    timbreEnabled?: boolean;
    fullModalEnabled?: boolean;
    sttEnabled?: boolean;
    ttsEnabled?: boolean;
  }) => void;
  setVoiceAssistantSttProvider: (providerId: string) => void;
  setVoiceAssistantAutoStart: (enabled: boolean) => void;
  addVoiceHistoryItem: (item: VoiceHistoryItem) => void;
  removeVoiceHistoryItem: (voiceId: string) => void;
}

const defaultElevenLabs: ElevenLabsApiConfig = { apiKey: '', voiceId: 'wOqiPOGlNVdIcEallTsU' };

const defaultClaudeConfig: ClaudeApiConfig = {
  apiKey: '',
  apiUrl: 'https://api.kie.ai/claude',
  model: 'claude-sonnet-4-5',
};

// ---- V2 default provider configs ----

function emptyProviderConfig(
  label: string,
  apiUrl: string,
  models: string[],
  authType: AuthType,
  purchaseUrl?: string,
  description?: string,
): ProviderConfig {
  return { label, enabled: false, apiKey: '', apiUrl, models, authType, purchaseUrl, description };
}

const KIE_PURCHASE_URL = 'https://kie.ai?ref=296742715562ed5361182aa543ee85a5';
const KIE_API_URL = 'https://api.kie.ai';
const KIE_GPT_IMAGE_MODELS = ['gpt-image-2-text-to-image', 'gpt-image-2-image-to-image'];
const KIE_NANO_BANANA_MODELS = ['nano-banana-2', 'nano-banana-pro', 'google/nano-banana', 'google/nano-banana-edit'];
const KIE_VEO_VIDEO_MODELS = ['veo3', 'veo3_fast', 'veo3_lite'];
const KIE_GEMINI_OMNI_VIDEO_MODELS = ['gemini-omni-video'];
const KIE_SUNO_MODELS = ['V5_5', 'V5', 'V4_5PLUS', 'V4_5', 'V4_5ALL', 'V4', 'V3_5'];
const KIE_GEMINI_MODELS = [
  'gemini-2.5-pro',
  'gemini-3-pro',
  'gemini-3.1-pro',
  'gemini-2.5-flash',
  'gemini-3-flash',
  'gemini-3.5-flash-openai',
];
const KIE_OPENAI_MODELS = ['gpt-5-2', 'gpt-5-4', 'gpt-5-5'];
const KIE_TOPAZ_MODELS = ['topaz/image-upscale', 'topaz/video-upscale'];

const defaultImageProviders: Record<string, ProviderConfig> = {
  seedream: emptyProviderConfig(
    'Seedream', 'https://ark.cn-beijing.volces.com',
    ['doubao-seedream-5-0-260128', 'doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828', 'doubao-seedream-3-0-t2i-250415'],
    'volcengine-bearer', 'https://console.volcengine.com/ark/region:ark+cn-beijing/billing',
    '火山方舟 Seedream 系列图片生成模型',
  ),
  'gpt-image-2': emptyProviderConfig(
    'Kie GPT Image-2', KIE_API_URL,
    KIE_GPT_IMAGE_MODELS,
    'standard-bearer', KIE_PURCHASE_URL,
    'OpenAI 兼容 GPT-Image-2 图片生成',
  ),
  'nano-banana': emptyProviderConfig(
    'Kie Nano Banana', KIE_API_URL,
    KIE_NANO_BANANA_MODELS,
    'standard-bearer', KIE_PURCHASE_URL,
    'Nano Banana image generation via Kie',
  ),
};

const defaultVideoProviders: Record<string, ProviderConfig> = {
  'seedance-2.0': emptyProviderConfig(
    'Seedance 2.0（官方版）', 'https://ark.cn-beijing.volces.com',
    ['doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128'],
    'volcengine-bearer', 'https://console.volcengine.com/ark/region:ark+cn-beijing/billing',
    'Seedance 2.0 video generation',
  ),
  'seedance-2.0-relay': {
    ...emptyProviderConfig(
      'Seedance 2.0（中转站）', 'https://api.tokenriver.cn',
      ['doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128'],
      'standard-bearer', 'https://tokenriver.cn',
      '通过 TokenRiver 中转站调用与官方配置一致的 Seedance 2.0',
    ),
    apiProfile: {
      preset: 'custom',
      endpoints: {
        models: '{base}/v1/models',
        videoSubmit: '{base}/seedance/v3/contents/generations/tasks',
        videoPoll: '{base}/seedance/v3/contents/generations/tasks/{task_id}',
      },
      response: {
        taskId: ['id', 'task_id'],
        videoUrl: ['content.video_url', 'video_url'],
        videoStatus: ['status'],
      },
      videoPollMethod: 'GET',
      videoSuccessStatuses: ['succeeded', 'success'],
    },
  },
  kling: emptyProviderConfig(
    'Kling', 'https://api-beijing.klingai.com',
    ['kling-v3-omni', 'kling-v3', 'kling-v2-6', 'kling-v2-master', 'kling-v2-1', 'kling-v2', 'kling-v1-6', 'kling-v1-5', 'kling-v1'],
    'kling-jwt', 'https://app.klingai.com',
    'Kling video generation via JWT auth',
  ),
  happyhorse: emptyProviderConfig(
    'HappyHorse', 'https://dashscope.aliyuncs.com',
    ['happyhorse-1.0-t2v', 'happyhorse-1.0-i2v', 'happyhorse-1.0-r2v', 'happyhorse-1.0-video-edit'],
    'standard-bearer', 'https://bailian.console.aliyun.com',
    'HappyHorse video generation',
  ),
  'kie-veo': emptyProviderConfig(
    'Kie Veo', KIE_API_URL,
    KIE_VEO_VIDEO_MODELS,
    'standard-bearer', KIE_PURCHASE_URL,
    'Google Veo 3.1 video generation via Kie',
  ),
  'kie-gemini-omni': emptyProviderConfig(
    'Kie Gemini Omni', KIE_API_URL,
    KIE_GEMINI_OMNI_VIDEO_MODELS,
    'standard-bearer', KIE_PURCHASE_URL,
    'Gemini Omni video generation via Kie',
  ),
  'minimax-h3': emptyProviderConfig(
    'Magine H3 Engine（本地）', 'magine://h3-engine',
    [
      'minimax_h3_fl2va_pruned_fp8_scaled.safetensors',
      'minimax_h3_ref2va_pruned_fp8_scaled.safetensors',
    ],
    'standard-bearer', 'https://github.com/MiniMax-AI/MiniMax-H3',
    '支持 Magine 内置引擎与 ComfyUI 兼容模式。FL2VA 支持文生与首尾帧，Ref2VA 支持图片、视频和音频参考。',
  ),
};

const defaultAudioProviders: Record<string, ProviderConfig> = {
  elevenlabs: emptyProviderConfig(
    'ElevenLabs', 'https://api.elevenlabs.io',
    ['eleven-music-v1', 'eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_flash_v2_5'],
    'elevenlabs-api-key', 'https://elevenlabs.io/app/subscription',
    'ElevenLabs audio, music and speech',
  ),
  'minimax-audio': emptyProviderConfig(
    'MiniMax 音频', 'https://api.minimaxi.com',
    ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo', 'speech-02-hd', 'speech-02-turbo', 'speech-01-hd', 'speech-01-turbo', 'music-2.6', 'music-2.6-free'],
    'standard-bearer', 'https://platform.minimaxi.com',
    'MiniMax TTS and music generation',
  ),
  suno: emptyProviderConfig(
    'Kie Suno', KIE_API_URL,
    KIE_SUNO_MODELS,
    'standard-bearer', KIE_PURCHASE_URL,
    'Suno AI 音乐生成',
  ),
};

const defaultLlmProviders: Record<string, ProviderConfig> = {
  gemini: emptyProviderConfig(
    'Kie Gemini（多模态）', KIE_API_URL,
    KIE_GEMINI_MODELS,
    'standard-bearer', KIE_PURCHASE_URL,
    'Google Gemini multimodal / text LLM',
  ),
  openai: emptyProviderConfig(
    'Kie OpenAI', KIE_API_URL,
    KIE_OPENAI_MODELS,
    'standard-bearer', KIE_PURCHASE_URL,
    'OpenAI GPT 系列 LLM',
  ),
  'deepseek-native': emptyProviderConfig(
    'DeepSeek', 'https://api.deepseek.com',
    ['deepseek-v4-flash', 'deepseek-v4-pro'],
    'standard-bearer', 'https://platform.deepseek.com',
    'DeepSeek 官方 API',
  ),
};

const TOPAZ_PURCHASE_URL = 'https://kie.ai?ref=296742715562ed5361182aa543ee85a5';

const defaultEnhanceProviders: Record<string, ProviderConfig> = {
  topaz: emptyProviderConfig(
    'Topaz / Kie', 'https://api.kie.ai',
    KIE_TOPAZ_MODELS,
    'standard-bearer', TOPAZ_PURCHASE_URL,
    'Kie Topaz upscale API. Assets are uploaded to Kie temp file service before task submission.',
  ),
};

const defaultCategoryConfigs = {
  image: {
    activeProviderId: 'seedream',
    providers: defaultImageProviders,
    customProviders: {} as Record<string, ProviderConfig>,
  },
  video: {
    activeProviderId: 'seedance-2.0',
    providers: defaultVideoProviders,
    customProviders: {} as Record<string, ProviderConfig>,
  },
  audio: {
    activeProviderId: 'elevenlabs',
    providers: defaultAudioProviders,
    customProviders: {} as Record<string, ProviderConfig>,
  },
  llm: {
    activeProviderId: 'openai',
    providers: defaultLlmProviders,
    customProviders: {} as Record<string, ProviderConfig>,
  },
  enhance: {
    activeProviderId: 'topaz',
    providers: defaultEnhanceProviders,
    customProviders: {} as Record<string, ProviderConfig>,
  },
};

const REMOVED_PROVIDER_IDS: Partial<Record<ApiCategory, Set<string>>> = {
  image: new Set(['midjourney']),
  video: new Set(['hailuo', 'kie-hailuo', 'veo-omni']),
  llm: new Set(['volcengine', 'claude', 'minimax']),
};

export function isRemovedProvider(category: ApiCategory, providerId: string): boolean {
  return REMOVED_PROVIDER_IDS[category]?.has(providerId) ?? false;
}

function pruneRemovedProviders(category: ApiCategory, config: CategoryConfig, fallback: CategoryConfig): CategoryConfig {
  const providers = { ...config.providers };
  const customProviders: Record<string, ProviderConfig> = {};
  for (const providerId of REMOVED_PROVIDER_IDS[category] ?? []) {
    delete providers[providerId];
    delete customProviders[providerId];
  }
  const activeProviderId =
    config.activeProviderId && providers[config.activeProviderId]
      ? config.activeProviderId
      : fallback.activeProviderId;
  return { ...config, activeProviderId, providers, customProviders };
}

const defaultProviderTokenBucket: ProviderTokenBucket = {
  remainingTokens: null,
  usedTokens: 0,
};

const emptyProviderTokens: Record<string, ProviderTokenBucket> = {};

const defaultDreaminaCli: DreaminaCliConfig = {
  cliPath: 'dreamina',
  loginBrowser: 'system',
  loginBrowserPath: '',
  loggedIn: false,
  loginName: '',
  enabledModels: [],
  imageEnabled: true,
  videoEnabled: true,
};

const defaultConfig: SeedanceConfig = {
  imageApi: { apiKey: '', apiUrl: 'https://ark.cn-beijing.volces.com', provider: 'seedream' },
  videoApi: { apiKey: '', apiUrl: 'https://ark.cn-beijing.volces.com' },
  multimodalApi: {
    apiKey: '',
    apiUrl: 'https://shiyunapi.com/v1',
    model: 'gemini-2.5-pro',
  },
  claudeApi: { ...defaultClaudeConfig },
  enhanceApi: {
    aliyunAccessKeyId: '',
    aliyunAccessKeySecret: '',
    aliyunImageEnhanEndpoint: 'imageenhan.cn-shanghai.aliyuncs.com',
    aliyunVideoEnhanEndpoint: 'videoenhan.cn-shanghai.aliyuncs.com',
    aliyunRegionId: 'cn-shanghai',
    aliyunImageSuperResolveMode: 'base',
    aliyunImageSuperResolveUpscaleFactor: 2,
    aliyunSuperResolveBitRate: 5,
  },
  subtitleRemovalApi: { ...defaultTencentMpsSubtitleRemovalConfig },
  defaultLlmSource: 'openai',
  defaultLlmModel: 'gpt-5-5',
  elevenLabs: { ...defaultElevenLabs },
  voiceAssistantSoundProviderId: 'elevenlabs',
  voiceAssistantSoundModel: defaultElevenLabs.voiceId,
  voiceAssistantEnabled: true,
  voiceAssistantTimbreEnabled: true,
  voiceAssistantFullModalEnabled: false,
  voiceAssistantSttEnabled: true,
  voiceAssistantTtsEnabled: true,
  voiceAssistantSttProviderId: 'local-sensevoice',
  voiceAssistantAutoStart: false,
  voiceAssistantTtsStability: 0.35,
  voiceAssistantTtsStyle: 0.5,
  voiceAssistantTtsSimilarityBoost: 0.75,
  voiceAssistantTtsSpeed: 1.0,
  voiceHistory: [],
  dreaminaCli: { ...defaultDreaminaCli },
  // V2 fields
  image: defaultCategoryConfigs.image,
  video: defaultCategoryConfigs.video,
  audio: defaultCategoryConfigs.audio,
  llm: defaultCategoryConfigs.llm,
  enhance: defaultCategoryConfigs.enhance,
  providerTokens: { ...emptyProviderTokens },
};

function normalizeApiBlock(incoming: APIConfig | undefined, fallback: APIConfig): APIConfig {
  return {
    apiKey: String(incoming?.apiKey ?? fallback.apiKey).trim(),
    apiUrl: String(incoming?.apiUrl ?? fallback.apiUrl).trim() || fallback.apiUrl,
  };
}

function normalizeImageApi(incoming: Partial<ImageApiConfig> | undefined, fallback: ImageApiConfig): ImageApiConfig {
  const base = normalizeApiBlock(incoming as APIConfig | undefined, fallback);
  const p = incoming?.provider;
  const provider: ImageApiProvider = p === 'gpt-image-2' ? 'gpt-image-2' : 'seedream';
  return { ...base, provider };
}

function normalizeElevenLabs(
  incoming: ElevenLabsApiConfig | undefined,
  fallback: ElevenLabsApiConfig
): ElevenLabsApiConfig {
  return {
    apiKey: String(incoming?.apiKey ?? fallback.apiKey).trim(),
    voiceId: String(incoming?.voiceId ?? fallback.voiceId).trim(),
  };
}

function normalizeMultimodalApi(
  incoming: Partial<MultimodalApiConfig> | undefined,
  fallback: MultimodalApiConfig
): MultimodalApiConfig {
  return {
    apiKey: normalizeUserGeminiApiKey(String(incoming?.apiKey ?? fallback.apiKey)),
    apiUrl: String(incoming?.apiUrl ?? fallback.apiUrl).trim() || fallback.apiUrl,
    model: String(incoming?.model ?? fallback.model).trim() || fallback.model,
  };
}

function normalizeEnhanceApi(
  incoming: (Partial<EnhanceApiConfig> & Record<string, unknown>) | undefined,
  fallback: EnhanceApiConfig
): EnhanceApiConfig {
  const rec = (incoming || {}) as Partial<EnhanceApiConfig> & Record<string, unknown>;
  const aliyunAccessKeyId = String(rec.aliyunAccessKeyId ?? fallback.aliyunAccessKeyId).trim();
  const aliyunAccessKeySecret = String(rec.aliyunAccessKeySecret ?? fallback.aliyunAccessKeySecret).trim();
  const legacyEndpoint = String(rec.aliyunEnhanEndpoint ?? rec.aliyunEndpoint ?? '').trim();
  let aliyunImageEnhanEndpoint = sanitizeViapiEnhanEndpoint(
    String(rec.aliyunImageEnhanEndpoint ?? '').trim() ||
      (legacyEndpoint.includes('imageenhan') ? legacyEndpoint : ''),
    'imageenhan',
    fallback.aliyunImageEnhanEndpoint
  );
  let aliyunVideoEnhanEndpoint = sanitizeViapiEnhanEndpoint(
    String(rec.aliyunVideoEnhanEndpoint ?? '').trim() ||
      (legacyEndpoint.includes('videoenhan') ? legacyEndpoint : ''),
    'videoenhan',
    fallback.aliyunVideoEnhanEndpoint
  );
  let aliyunRegionId = String(rec.aliyunRegionId ?? fallback.aliyunRegionId).trim();
  if (!aliyunRegionId) aliyunRegionId = fallback.aliyunRegionId;
  const aliyunImageSuperResolveMode = String(
    rec.aliyunImageSuperResolveMode ?? fallback.aliyunImageSuperResolveMode
  ).trim() || fallback.aliyunImageSuperResolveMode;
  let uf = Number(rec.aliyunImageSuperResolveUpscaleFactor);
  if (!Number.isFinite(uf)) uf = fallback.aliyunImageSuperResolveUpscaleFactor;
  const aliyunImageSuperResolveUpscaleFactor = Math.min(4, Math.max(1, Math.round(uf)));
  let br = Number(rec.aliyunSuperResolveBitRate);
  if (!Number.isFinite(br)) br = fallback.aliyunSuperResolveBitRate;
  const aliyunSuperResolveBitRate = Math.min(20, Math.max(1, Math.round(br)));
  return {
    aliyunAccessKeyId,
    aliyunAccessKeySecret,
    aliyunImageEnhanEndpoint,
    aliyunVideoEnhanEndpoint,
    aliyunRegionId,
    aliyunImageSuperResolveMode,
    aliyunImageSuperResolveUpscaleFactor,
    aliyunSuperResolveBitRate,
  };
}

function normalizeDefaultLlmSource(v: unknown): LlmTextProviderId {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s) return s;
  return 'openai';
}

/** Bump when persisted shape changes so token buckets reset safely. */
const TOKEN_USAGE_VERSION = 11;

/** Bump when provider URLs need migration (e.g., MiniMax API endpoint change). */
const CONFIG_VERSION = 19;

const apiConfigKeys = {
  image: 'imageApi',
  video: 'videoApi',
} as const satisfies Record<'image' | 'video', 'imageApi' | 'videoApi'>;

const defaultBucket: TokenBucket = {
  arkRemainingTokens: null,
  usedTokens: 0,
};

const defaultTokenConfig: TokenConfig = {
  image: { ...defaultBucket },
  video: { ...defaultBucket },
  llm: { ...defaultBucket },
  multimodal: { ...defaultBucket },
  claude: { ...defaultBucket },
};

function normalizeTokenBucket(
  value: unknown,
  fallbackRemaining: number | null,
  resetUsedTokens: boolean
): TokenBucket {
  const record = value && typeof value === 'object' ? (value as Partial<TokenBucket>) : {};
  return {
    arkRemainingTokens:
      typeof record.arkRemainingTokens === 'number'
        ? record.arkRemainingTokens
        : fallbackRemaining,
    usedTokens:
      resetUsedTokens || typeof record.usedTokens !== 'number' ? 0 : record.usedTokens,
  };
}

// ---- V2 migration helpers ----

/** Fill provider metadata (purchaseUrl, description, authType) from defaults for built-in providers. */
function patchProviderMetadata(persisted: CategoryConfig, fallback: CategoryConfig): CategoryConfig {
  const patchedProviders = { ...persisted.providers };
  for (const [pid, pConfig] of Object.entries(persisted.providers)) {
    const def = fallback.providers[pid];
    if (!def) continue;
    const shouldPatchPurchaseUrl =
      Boolean(def.purchaseUrl) &&
      (!pConfig.purchaseUrl ||
        (pid === 'topaz' && pConfig.purchaseUrl !== def.purchaseUrl) ||
        (def.purchaseUrl === KIE_PURCHASE_URL && pConfig.purchaseUrl !== def.purchaseUrl));
    const needsPatch =
      shouldPatchPurchaseUrl ||
      (!pConfig.description && def.description) ||
      (pConfig.authType !== def.authType);
    if (needsPatch) {
      patchedProviders[pid] = {
        ...pConfig,
        authType: def.authType,
        purchaseUrl: shouldPatchPurchaseUrl ? def.purchaseUrl : pConfig.purchaseUrl,
        description: pConfig.description || def.description,
      };
    }
    // 合并默认模型列表：保留用户已有的，补充默认新增的
    if (def.models.length > 0) {
      const currentModels = pConfig.models || [];
      const merged = [...currentModels];
      for (const m of def.models) {
        if (!merged.includes(m)) merged.push(m);
      }
      if (merged.length !== currentModels.length) {
        patchedProviders[pid] = { ...(patchedProviders[pid] || pConfig), models: merged };
      }
    }
  }
  return { ...persisted, providers: patchedProviders };
}

function migrateCategoryConfig(
  partial: Partial<SeedanceConfig> & { image?: Partial<CategoryConfig>; video?: Partial<CategoryConfig>; audio?: Partial<CategoryConfig>; llm?: Partial<CategoryConfig> },
  category: ApiCategory,
  fallback: CategoryConfig,
  needsConfigMigration: boolean = false,
): CategoryConfig {
  const v2 = (partial as Record<string, unknown>)[category] as Partial<CategoryConfig> | undefined;
  const hasV2 = v2 && (v2.providers || v2.customProviders);
  if (hasV2) {
    const persistedProviders = v2.providers || {};
    const result = {
      activeProviderId: v2.activeProviderId || fallback.activeProviderId,
      providers: Object.fromEntries(
        Object.entries(fallback.providers).map(([providerId, provider]) => [
          providerId,
          { ...provider, ...(persistedProviders[providerId] || {}) },
        ]),
      ),
      customProviders: {},
    };

    const syncBuiltInProviderDefaults = (providerIds: string[]) => {
      for (const providerId of providerIds) {
        const current = result.providers[providerId];
        const nextDefault = fallback.providers[providerId];
        if (!current || !nextDefault) continue;
        result.providers[providerId] = {
          ...current,
          label: nextDefault.label,
          apiUrl: nextDefault.apiUrl,
          models: [...nextDefault.models],
          authType: nextDefault.authType,
          purchaseUrl: nextDefault.purchaseUrl,
          description: nextDefault.description,
        };
      }
    };

    const mergeProviderAlias = (aliasId: string, canonicalId: string) => {
      const alias = result.providers[aliasId];
      const canonical = result.providers[canonicalId];
      if (!alias || !canonical) return;

      const aliasKey = alias.apiKey?.trim() || '';
      const canonicalKey = canonical.apiKey?.trim() || '';
      const canonicalWasAlreadyKie = /api\.kie\.ai/i.test(canonical.apiUrl || '');
      const shouldUseAliasKey =
        Boolean(aliasKey) &&
        (!canonicalKey || !canonicalWasAlreadyKie || (alias.enabled && !canonical.enabled));
      result.providers[canonicalId] = {
        ...canonical,
        apiKey: shouldUseAliasKey ? alias.apiKey : canonical.apiKey,
        enabled: Boolean(canonical.enabled || alias.enabled),
      };
      if (result.activeProviderId === aliasId) {
        result.activeProviderId = canonicalId;
      }
      delete result.providers[aliasId];
    };

    if (needsConfigMigration && category === 'image') {
      mergeProviderAlias('kie-gpt-image', 'gpt-image-2');
      mergeProviderAlias('kie-nano-banana', 'nano-banana');
      syncBuiltInProviderDefaults(['gpt-image-2', 'nano-banana']);
    }
    if (needsConfigMigration && category === 'video') {
      const legacyVeoOmni = result.providers['veo-omni'];
      if (legacyVeoOmni) {
        for (const providerId of ['kie-veo', 'kie-gemini-omni']) {
          const provider = result.providers[providerId];
          if (!provider) continue;
          result.providers[providerId] = {
            ...provider,
            apiKey: provider.apiKey.trim() ? provider.apiKey : legacyVeoOmni.apiKey,
            enabled: Boolean(provider.enabled || legacyVeoOmni.enabled),
          };
        }
        if (result.activeProviderId === 'veo-omni') {
          result.activeProviderId = 'kie-veo';
        }
        delete result.providers['veo-omni'];
      }
      syncBuiltInProviderDefaults(['kie-veo', 'kie-gemini-omni']);
      const minimaxH3 = result.providers['minimax-h3'];
      const minimaxH3Default = fallback.providers['minimax-h3'];
      if (minimaxH3 && minimaxH3Default) {
        result.providers['minimax-h3'] = {
          ...minimaxH3,
          apiUrl: minimaxH3Default.apiUrl,
          models: [...minimaxH3Default.models],
          authType: minimaxH3Default.authType,
          purchaseUrl: minimaxH3Default.purchaseUrl,
          description: minimaxH3Default.description,
        };
      }
    }
    if (needsConfigMigration && category === 'audio') {
      mergeProviderAlias('kie-suno', 'suno');
      syncBuiltInProviderDefaults(['suno']);
    }
    if (needsConfigMigration && category === 'llm') {
      syncBuiltInProviderDefaults(['gemini', 'claude', 'openai']);
    }
    
    // 强制迁移MiniMax API URL
    if (needsConfigMigration && category === 'llm' && result.providers.minimax) {
      const minimaxProvider = result.providers.minimax;
      if (minimaxProvider.apiUrl && minimaxProvider.apiUrl.includes('/anthropic')) {
        result.providers.minimax = {
          ...minimaxProvider,
          apiUrl: minimaxProvider.apiUrl.replace('/anthropic', '/v1'),
        };
      }
    }
    
    // Migrate DeepSeek V3 model ids to V4.
    if (needsConfigMigration && category === 'llm') {
      const deepseekModelIdMap: Record<string, string> = {
        'deepseek-v3-2-251201': 'deepseek-v4-flash',
        'deepseekv3.2': 'deepseek-v4-flash',
        'deepseek-v3.2': 'deepseek-v4-flash',
        'deepseek-v3-2': 'deepseek-v4-flash',
        'deepseek-chat': 'deepseek-v4-flash',
        'deepseek-reasoner': 'deepseek-v4-pro',
      };
      const v4Models = ['deepseek-v4-flash', 'deepseek-v4-pro'];
      for (const providerId of ['deepseek-native'] as const) {
        const provider = result.providers[providerId];
        if (!provider?.models?.length) continue;
        const hasV4 = provider.models.some((m) => v4Models.includes(m));
        if (!hasV4) {
          provider.models = v4Models;
        } else {
          provider.models = [...new Set(provider.models.map((m) => deepseekModelIdMap[m] || m))];
        }
      }
    }

    if (needsConfigMigration && category === 'enhance' && result.providers.topaz && fallback.providers.topaz) {
      const current = result.providers.topaz;
      const nextDefault = fallback.providers.topaz;
      const isLegacyTopazLabs = /topazlabs\.com/i.test(current.apiUrl || '');
      result.providers.topaz = {
        ...current,
        label: nextDefault.label,
        apiUrl: isLegacyTopazLabs ? nextDefault.apiUrl : (current.apiUrl || nextDefault.apiUrl),
        models: [...nextDefault.models],
        authType: nextDefault.authType,
        purchaseUrl: nextDefault.purchaseUrl,
        description: nextDefault.description,
      };
      if (!result.activeProviderId || result.activeProviderId === 'aliyun') {
        result.activeProviderId = 'topaz';
      }
    }

    // 合并seedance-2.0-fast到seedance-2.0
    if (needsConfigMigration && category === 'video') {
      const fastProvider = result.providers['seedance-2.0-fast'];
      const standardProvider = result.providers['seedance-2.0'];
      if (fastProvider && standardProvider) {
        // Carry seedance-2.0-fast credentials into seedance-2.0 during migration.
        if (fastProvider.apiKey && !standardProvider.apiKey) {
          result.providers['seedance-2.0'] = {
            ...standardProvider,
            apiKey: fastProvider.apiKey,
            apiUrl: fastProvider.apiUrl || standardProvider.apiUrl,
            enabled: fastProvider.enabled,
          };
        }
        // 删除seedance-2.0-fast配置
        delete result.providers['seedance-2.0-fast'];
        // 如果当前激活的是seedance-2.0-fast，改为seedance-2.0
        if (result.activeProviderId === 'seedance-2.0-fast') {
          result.activeProviderId = 'seedance-2.0';
        }
      }
      // Migrate old video model ids to new technical names.
      const videoModelIdMap: Record<string, string> = {
        'doubao-seedance-2.0': 'doubao-seedance-2-0-260128',
        'doubao-seedance-2.0-fast': 'doubao-seedance-2-0-fast-260128',
        'seedance-2.0': 'doubao-seedance-2-0-260128',
        'seedance-2.0-fast': 'doubao-seedance-2-0-fast-260128',
      };
      for (const [, provider] of Object.entries(result.providers)) {
        provider.models = provider.models.map((m) => videoModelIdMap[m] || m);
      }
    }

    return pruneRemovedProviders(category, result, fallback);
  }
  // Migrate from legacy flat config
  const cat = structuredClone(fallback);
  const imgProvider =
    partial.imageApi && 'provider' in (partial.imageApi as ImageApiConfig)
      ? (partial.imageApi as ImageApiConfig).provider
      : undefined;
  if (category === 'image') {
    const apiKey = partial.imageApi?.apiKey ?? '';
    const apiUrl = partial.imageApi?.apiUrl ?? '';
    if (apiKey && imgProvider && imgProvider in cat.providers) {
      cat.providers[imgProvider] = {
        ...cat.providers[imgProvider],
        apiKey,
        apiUrl,
        enabled: true,
      };
      cat.activeProviderId = imgProvider;
    }
  } else if (category === 'video') {
    const apiKey = partial.videoApi?.apiKey ?? '';
    const apiUrl = partial.videoApi?.apiUrl ?? '';
    if (apiKey && cat.providers['seedance-2.0']) {
      cat.providers['seedance-2.0'] = { ...cat.providers['seedance-2.0'], apiKey, apiUrl, enabled: true };
    }
  } else if (category === 'audio') {
    const apiKey = partial.elevenLabs?.apiKey ?? '';
    if (apiKey && cat.providers.elevenlabs) {
      cat.providers.elevenlabs = { ...cat.providers.elevenlabs, apiKey, apiUrl: 'https://api.elevenlabs.io', enabled: true };
    }
  } else if (category === 'llm') {
    if (partial.multimodalApi?.apiKey && cat.providers.gemini) {
      cat.providers.gemini = { ...cat.providers.gemini, apiKey: partial.multimodalApi.apiKey, enabled: true };
    }
    if (partial.claudeApi?.apiKey && cat.providers.claude) {
      cat.providers.claude = { ...cat.providers.claude, apiKey: partial.claudeApi.apiKey, enabled: true };
      cat.activeProviderId = 'claude';
    }
  }
  
  // Migrate legacy MiniMax API URL.
  if (needsConfigMigration && category === 'llm' && cat.providers.minimax) {
    const minimaxProvider = cat.providers.minimax;
    if (minimaxProvider.apiUrl && minimaxProvider.apiUrl.includes('/anthropic')) {
      cat.providers.minimax = {
        ...minimaxProvider,
        apiUrl: minimaxProvider.apiUrl.replace('/anthropic', '/v1'),
      };
    }
  }
  
  return pruneRemovedProviders(category, cat, fallback);
}

function migrateProviderTokens(
  partial: Partial<SeedanceConfig> & { providerTokens?: Record<string, Partial<ProviderTokenBucket>> },
  legacyTokenConfig: Partial<TokenConfig> & { arkRemainingTokens?: number | null; usedTokens?: number; image?: TokenBucket; video?: TokenBucket; llm?: TokenBucket; multimodal?: TokenBucket; claude?: TokenBucket } | undefined,
  fallback: Record<string, ProviderTokenBucket>,
): Record<string, ProviderTokenBucket> {
  if (partial.providerTokens && Object.keys(partial.providerTokens).length > 0) {
    const result: Record<string, ProviderTokenBucket> = {};
    for (const [k, v] of Object.entries(partial.providerTokens)) {
      result[k] = {
        remainingTokens: typeof v.remainingTokens === 'number' ? v.remainingTokens : null,
        usedTokens: typeof v.usedTokens === 'number' ? v.usedTokens : 0,
      };
    }
    return result;
  }
  // Migrate from legacy token config
  const result = { ...fallback };
  const tc = legacyTokenConfig;
  if (tc?.image?.arkRemainingTokens != null || tc?.image?.usedTokens) {
    result['image.seedream'] = {
      remainingTokens: tc.image.arkRemainingTokens ?? null,
      usedTokens: tc.image.usedTokens ?? 0,
    };
  }
  if (tc?.video?.arkRemainingTokens != null || tc?.video?.usedTokens) {
    result['video.seedance-2.0'] = {
      remainingTokens: tc.video.arkRemainingTokens ?? null,
      usedTokens: tc.video.usedTokens ?? 0,
    };
  }
  if (tc?.multimodal?.arkRemainingTokens != null || tc?.multimodal?.usedTokens) {
    result['llm.gemini'] = {
      remainingTokens: tc.multimodal.arkRemainingTokens ?? null,
      usedTokens: tc.multimodal.usedTokens ?? 0,
    };
  }
  if (tc?.claude?.arkRemainingTokens != null || tc?.claude?.usedTokens) {
    result['llm.claude'] = {
      remainingTokens: tc.claude.arkRemainingTokens ?? null,
      usedTokens: tc.claude.usedTokens ?? 0,
    };
  }
  return result;
}

export const useSeedanceStore = create<SeedanceStore>()(
  persist(
    (set) => ({
      config: defaultConfig,
      tokenConfig: defaultTokenConfig,
      tokenUsageVersion: TOKEN_USAGE_VERSION,
      configVersion: CONFIG_VERSION,
      dreaminaCliCredit: { ...defaultDreaminaCliCreditSnapshot },
      dreaminaCliSessionUsedCredits: 0,
      saveElevenLabsConfig: (voiceId, apiKey) =>
        set((state) => ({
          config: {
            ...state.config,
            elevenLabs: {
              voiceId: voiceId.trim() || state.config.elevenLabs.voiceId,
              apiKey: apiKey.trim() || state.config.elevenLabs.apiKey,
            },
          },
        })),
      saveEnhanceApiConfig: (patch) =>
        set((state) => ({
          config: {
            ...state.config,
            enhanceApi: normalizeEnhanceApi(
              { ...state.config.enhanceApi, ...patch },
              defaultConfig.enhanceApi
            ),
          },
        })),
      saveSubtitleRemovalApiConfig: (patch) =>
        set((state) => ({
          config: {
            ...state.config,
            subtitleRemovalApi: normalizeTencentMpsSubtitleRemovalConfig({
              ...state.config.subtitleRemovalApi,
              ...patch,
            }),
          },
        })),
      saveMultimodalApiConfig: ({ apiKey, apiUrl, model, arkRemainingTokens }) =>
        set((state) => {
          const normalizedApiKey = normalizeUserGeminiApiKey(apiKey);
          const normalizedApiUrl =
            apiUrl.trim() || defaultConfig.multimodalApi.apiUrl;
          const normalizedModel = model.trim() || defaultConfig.multimodalApi.model;
          const prevApi = state.config.multimodalApi;
          const prevBucket = state.tokenConfig.multimodal;
          const apiChanged =
            prevApi.apiKey !== normalizedApiKey ||
            prevApi.apiUrl !== normalizedApiUrl ||
            prevApi.model !== normalizedModel;
          const baselineChanged = prevBucket.arkRemainingTokens !== arkRemainingTokens;
          const resetMmTokens = apiChanged || baselineChanged;

          return {
            config: {
              ...state.config,
              multimodalApi: {
                apiKey: normalizedApiKey,
                apiUrl: normalizedApiUrl,
                model: normalizedModel,
              },
            },
            tokenConfig: {
              ...state.tokenConfig,
              multimodal: {
                arkRemainingTokens,
                usedTokens: resetMmTokens ? 0 : prevBucket.usedTokens,
              },
            },
          };
        }),
      setDefaultLlmSource: (source) =>
        set((state) => {
          const normalized = normalizeDefaultLlmSource(source);
          if (!(normalized in state.config.llm.providers)) return {};
          return {
            config: {
              ...state.config,
              defaultLlmSource: normalized,
            },
          };
        }),
      setDefaultLlmModel: (model) =>
        set((state) => ({
          config: { ...state.config, defaultLlmModel: String(model || '').trim() },
        })),
      setMultimodalApiKey: (apiKey) =>
        set((state) => ({
          config: {
            ...state.config,
            multimodalApi: { ...state.config.multimodalApi, apiKey },
          },
        })),
      setMultimodalApiUrl: (apiUrl) =>
        set((state) => ({
          config: {
            ...state.config,
            multimodalApi: { ...state.config.multimodalApi, apiUrl },
          },
        })),
      setMultimodalModel: (model) =>
        set((state) => ({
          config: {
            ...state.config,
            multimodalApi: { ...state.config.multimodalApi, model },
          },
        })),
      saveVideoTabConfig: ({ apiKey, apiUrl, arkRemainingTokens }) =>
        set((state) => {
          const normalizedApiKey = apiKey.trim();
          const normalizedApiUrl = apiUrl.trim() || defaultConfig.videoApi.apiUrl;
          const prevApi = state.config.videoApi;
          const prevBucket = state.tokenConfig.video;
          const apiChanged =
            prevApi.apiKey !== normalizedApiKey || prevApi.apiUrl !== normalizedApiUrl;
          const baselineChanged = prevBucket.arkRemainingTokens !== arkRemainingTokens;
          const resetVideoTokens = apiChanged || baselineChanged;

          return {
            config: {
              ...state.config,
              videoApi: { apiKey: normalizedApiKey, apiUrl: normalizedApiUrl },
            },
            tokenConfig: {
              ...state.tokenConfig,
              video: {
                arkRemainingTokens,
                usedTokens: resetVideoTokens ? 0 : prevBucket.usedTokens,
              },
            },
          };
        }),
      saveApiConfig: (kind, apiKey, apiUrl, arkRemainingTokens, opts) =>
        set((state) => {
          const configKey = apiConfigKeys[kind];
          const normalizedApiKey = apiKey.trim();
          const normalizedApiUrl = apiUrl.trim() || defaultConfig[configKey].apiUrl;
          const previousApi = state.config[configKey];
          const previousBucket = state.tokenConfig[kind];
          const nextImageProvider: ImageApiProvider =
            opts?.imageProvider === 'gpt-image-2' ? 'gpt-image-2' : 'seedream';
          const nextBlock: APIConfig | ImageApiConfig =
            kind === 'image'
              ? {
                  apiKey: normalizedApiKey,
                  apiUrl: normalizedApiUrl,
                  provider: nextImageProvider,
                }
              : { apiKey: normalizedApiKey, apiUrl: normalizedApiUrl };
          const apiChanged =
            previousApi.apiKey !== normalizedApiKey ||
            previousApi.apiUrl !== normalizedApiUrl ||
            (kind === 'image' &&
              (previousApi as ImageApiConfig).provider !== (nextBlock as ImageApiConfig).provider);
          const baselineChanged =
            previousBucket.arkRemainingTokens !== arkRemainingTokens;

          return {
            config: {
              ...state.config,
              [configKey]: nextBlock,
            },
            tokenConfig: {
              ...state.tokenConfig,
              [kind]: {
                arkRemainingTokens,
                usedTokens:
                  apiChanged || baselineChanged ? 0 : previousBucket.usedTokens,
              },
            },
          };
        }),
      setImageApiKey: (apiKey) =>
        set((state) => ({
          config: {
            ...state.config,
            imageApi: { ...state.config.imageApi, apiKey },
          },
        })),
      setImageApiUrl: (apiUrl) =>
        set((state) => ({
          config: {
            ...state.config,
            imageApi: { ...state.config.imageApi, apiUrl },
          },
        })),
      setVideoApiKey: (apiKey) =>
        set((state) => ({
          config: { ...state.config, videoApi: { ...state.config.videoApi, apiKey } },
        })),
      setVideoApiUrl: (apiUrl) =>
        set((state) => ({
          config: { ...state.config, videoApi: { ...state.config.videoApi, apiUrl } },
        })),
      setTokenConfig: (partial) =>
        set((state) => ({
          tokenConfig: { ...state.tokenConfig, ...partial },
        })),
      setArkRemainingTokens: (kind, n) =>
        set((state) => ({
          tokenConfig: {
            ...state.tokenConfig,
            [kind]: { arkRemainingTokens: n, usedTokens: 0 },
          },
        })),
      addUsedTokens: (kind, amount) =>
        set((state) => ({
          tokenConfig: {
            ...state.tokenConfig,
            [kind]: {
              ...state.tokenConfig[kind],
              usedTokens:
                state.tokenConfig[kind].usedTokens + Math.max(0, Math.round(amount)),
            },
          },
        })),
      // ---- V2 provider methods ----
      saveProviderConfig: (category, providerId, config) =>
        set((state) => {
          if (isRemovedProvider(category, providerId)) return {};
          const cat = structuredClone(state.config[category]);
          const isBuiltIn = providerId in cat.providers;
          if (!isBuiltIn) return {};
          const target = { ...cat.providers };
          target[providerId] = { ...target[providerId], ...config, enabled: true };
          const tk = `${category}.${providerId}`;
          const oldCfg = state.config[category].providers[providerId];
          const prevBucket = state.config.providerTokens[tk];
          const apiChanged = oldCfg && (
            config.apiKey !== oldCfg.apiKey ||
            config.apiUrl !== oldCfg.apiUrl
          );
          cat.providers = target;
          
          // Sync audio.elevenlabs provider credentials into legacy elevenLabs config.
          let elevenLabsUpdate: Partial<ElevenLabsApiConfig> | undefined;
          if (category === 'audio' && providerId === 'elevenlabs') {
            elevenLabsUpdate = {
              apiKey: config.apiKey.trim(),
            };
          }

          return {
            config: {
              ...state.config,
              [category]: cat,
              ...(elevenLabsUpdate ? { elevenLabs: { ...state.config.elevenLabs, ...elevenLabsUpdate } } : {}),
              providerTokens: {
                ...state.config.providerTokens,
                [tk]: apiChanged
                  ? { remainingTokens: null, usedTokens: 0 }
                  : (prevBucket || { remainingTokens: null, usedTokens: 0 }),
              },
            },
          };
        }),
      setActiveProvider: (category, providerId) =>
        set((state) => {
          if (isRemovedProvider(category, providerId) || !(providerId in state.config[category].providers)) return {};
          return {
            config: {
              ...state.config,
              [category]: { ...state.config[category], activeProviderId: providerId },
            },
          };
        }),
      addProviderTokens: (key, amount) =>
        set((state) => {
          const bucket = state.config.providerTokens[key] || { remainingTokens: null, usedTokens: 0 };
          const safeAmount = Math.max(0, Math.round(amount));
          const nextRemaining =
            key === 'kie.global' && typeof bucket.remainingTokens === 'number'
              ? Math.max(0, bucket.remainingTokens - safeAmount)
              : bucket.remainingTokens;
          return {
            config: {
              ...state.config,
              providerTokens: {
                ...state.config.providerTokens,
                [key]: { ...bucket, remainingTokens: nextRemaining, usedTokens: bucket.usedTokens + safeAmount },
              },
            },
          };
        }),
      setProviderRemainingTokens: (key, n) =>
        set((state) => ({
          config: {
            ...state.config,
            providerTokens: {
              ...state.config.providerTokens,
              [key]: {
                remainingTokens: n,
                usedTokens: state.config.providerTokens[key]?.usedTokens ?? 0,
              },
            },
          },
        })),
      saveDreaminaCliConfig: (patch) =>
        set((state) => ({
          config: {
            ...state.config,
            dreaminaCli: { ...state.config.dreaminaCli, ...patch },
          },
        })),
      setDreaminaCliCredits: (patch) =>
        set((state) => ({
          dreaminaCliCredit: { ...state.dreaminaCliCredit, ...patch },
        })),
      addDreaminaCliSessionUsedCredits: (amount) =>
        set((state) => ({
          dreaminaCliSessionUsedCredits:
            state.dreaminaCliSessionUsedCredits + Math.max(0, Math.round(amount)),
        })),
      applyDreaminaCliCreditSpend: (amount) =>
        set((state) => {
          const spend = Math.max(0, Math.round(amount));
          const totalCredit = state.dreaminaCliCredit.totalCredit;
          return {
            dreaminaCliSessionUsedCredits: state.dreaminaCliSessionUsedCredits + spend,
            dreaminaCliCredit: {
              ...state.dreaminaCliCredit,
              totalCredit:
                typeof totalCredit === 'number' ? Math.max(0, totalCredit - spend) : totalCredit,
            },
          };
        }),
      setVoiceAssistantSound: (providerId, voiceModel) =>
        set((state) => {
          const pid = providerId.trim() || state.config.voiceAssistantSoundProviderId;
          const vm = voiceModel.trim() || state.config.voiceAssistantSoundModel;
          return {
            config: {
              ...state.config,
              voiceAssistantSoundProviderId: pid,
              voiceAssistantSoundModel: vm,
              // Keep audio activeProviderId in sync for voice assistant settings.
              audio: {
                ...state.config.audio,
                activeProviderId: (pid in (state.config.audio.providers || {}) || pid in (state.config.audio.customProviders || {})) ? pid : state.config.audio.activeProviderId,
              },
            },
          };
        }),
      setVoiceAssistantEnabled: (enabled) =>
        set((state) => ({
          config: {
            ...state.config,
            voiceAssistantEnabled: Boolean(enabled),
          },
        })),
      setVoiceAssistantTtsParams: (params) =>
        set((state) => {
          const clamp01 = (n: number | undefined, fallback: number) =>
            typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
          const clampSpeed = (n: number | undefined, fallback: number) =>
            typeof n === 'number' && Number.isFinite(n) ? Math.max(0.5, Math.min(2, n)) : fallback;
          return {
            config: {
              ...state.config,
              voiceAssistantTtsStability: clamp01(params.stability, state.config.voiceAssistantTtsStability),
              voiceAssistantTtsStyle: clamp01(params.style, state.config.voiceAssistantTtsStyle),
              voiceAssistantTtsSimilarityBoost: clamp01(
                params.similarityBoost,
                state.config.voiceAssistantTtsSimilarityBoost
              ),
              voiceAssistantTtsSpeed: clampSpeed(params.speed, state.config.voiceAssistantTtsSpeed),
            },
          };
        }),
      setVoiceAssistantToggles: (toggles) =>
        set((state) => ({
          config: {
            ...state.config,
            voiceAssistantTimbreEnabled: typeof toggles.timbreEnabled === 'boolean'
              ? toggles.timbreEnabled
              : state.config.voiceAssistantTimbreEnabled,
            voiceAssistantFullModalEnabled: false,
            voiceAssistantSttEnabled: typeof toggles.sttEnabled === 'boolean'
              ? toggles.sttEnabled
              : state.config.voiceAssistantSttEnabled,
            voiceAssistantTtsEnabled: typeof toggles.ttsEnabled === 'boolean'
              ? toggles.ttsEnabled
              : state.config.voiceAssistantTtsEnabled,
          },
        })),
      setVoiceAssistantSttProvider: () =>
        set((state) => ({
          config: {
            ...state.config,
            voiceAssistantSttProviderId: 'local-sensevoice',
          },
        })),
      setVoiceAssistantAutoStart: (enabled) =>
        set((state) => ({
          config: {
            ...state.config,
            voiceAssistantAutoStart: Boolean(enabled),
          },
        })),
      addVoiceHistoryItem: (item) =>
        set((state) => ({
          config: {
            ...state.config,
            voiceHistory: [
              item,
              ...state.config.voiceHistory.filter((v) => v.voice_id !== item.voice_id),
            ].slice(0, 50),
          },
        })),
      removeVoiceHistoryItem: (voiceId) =>
        set((state) => ({
          config: {
            ...state.config,
            voiceHistory: state.config.voiceHistory.filter((v) => v.voice_id !== voiceId),
          },
        })),
    }),
    {
      name: 'seedance-storage',
      storage: createDesktopDualStorage<Pick<SeedanceStore, 'config' | 'tokenConfig' | 'tokenUsageVersion' | 'configVersion'>>('seedance-storage'),
      partialize: (state) => ({
        config: state.config,
        tokenConfig: state.tokenConfig,
        tokenUsageVersion: state.tokenUsageVersion,
        configVersion: state.configVersion,
      }),
      merge: (persisted, current) => {
        const p = persisted as {
          config?: Partial<SeedanceConfig>;
          tokenUsageVersion?: number;
          configVersion?: number;
          tokenConfig?: Partial<TokenConfig> & {
            arkRemainingTokens?: number | null;
            usedTokens?: number;
            totalQuota?: number;
            multimodal?: TokenBucket;
            claude?: TokenBucket;
          };
        };
        const legacyRemaining =
          typeof p?.tokenConfig?.arkRemainingTokens === 'number'
            ? p.tokenConfig.arkRemainingTokens
            : typeof p?.tokenConfig?.totalQuota === 'number'
              ? p.tokenConfig.totalQuota
              : null;
        const resetUsedTokens = p?.tokenUsageVersion !== TOKEN_USAGE_VERSION;
        const needsConfigMigration = !p?.configVersion || p.configVersion < CONFIG_VERSION;

        const partial = (p?.config || {}) as Partial<SeedanceConfig> & {
          multimodalApi?: Partial<MultimodalApiConfig>;
          claudeApi?: Partial<ClaudeApiConfig>;
          defaultLlmSource?: unknown;
          image?: Partial<CategoryConfig>;
          video?: Partial<CategoryConfig>;
          audio?: Partial<CategoryConfig>;
          llm?: Partial<CategoryConfig>;
          providerTokens?: Record<string, Partial<ProviderTokenBucket>>;
        };
        const base = current.config;

        // Migrate V2 category configs from persisted or legacy flat data
        const migratedImage = migrateCategoryConfig(partial, 'image', base.image, needsConfigMigration);
        const migratedVideo = migrateCategoryConfig(partial, 'video', base.video, needsConfigMigration);
        const migratedAudio = migrateCategoryConfig(partial, 'audio', base.audio, needsConfigMigration);
        const migratedLlm = migrateCategoryConfig(partial, 'llm', base.llm, needsConfigMigration);
        const migratedEnhance = migrateCategoryConfig(partial, 'enhance', base.enhance, needsConfigMigration);
        const migratedProviderTokens = migrateProviderTokens(partial, p?.tokenConfig, base.providerTokens);
        const allowedProviderTokenKeys = new Set([
          ...Object.keys(migratedImage.providers).map((id) => `image.${id}`),
          ...Object.keys(migratedVideo.providers).map((id) => `video.${id}`),
          ...Object.keys(migratedAudio.providers).map((id) => `audio.${id}`),
          ...Object.keys(migratedLlm.providers).map((id) => `llm.${id}`),
          ...Object.keys(migratedEnhance.providers).map((id) => `enhance.${id}`),
          'kie.global',
        ]);
        const providerTokens = Object.fromEntries(
          Object.entries(migratedProviderTokens).filter(([key]) => allowedProviderTokenKeys.has(key)),
        );
        const requestedDefaultLlmSource = normalizeDefaultLlmSource(
          partial.defaultLlmSource ?? base.defaultLlmSource,
        );
        const configuredLlmSource = Object.entries(migratedLlm.providers)
          .find(([, provider]) => provider.enabled && provider.apiKey.trim())?.[0];
        const defaultLlmSource = migratedLlm.providers[requestedDefaultLlmSource]
          ? requestedDefaultLlmSource
          : configuredLlmSource || base.defaultLlmSource;
        const deepseekModelIdMap: Record<string, string> = {
          'deepseek-v3-2-251201': 'deepseek-v4-flash',
          'deepseekv3.2': 'deepseek-v4-flash',
          'deepseek-v3.2': 'deepseek-v4-flash',
          'deepseek-v3-2': 'deepseek-v4-flash',
        };
        const requestedDefaultLlmModel = String(
          partial.defaultLlmModel ?? base.defaultLlmModel ?? '',
        ).trim();
        const normalizedDefaultLlmModel = deepseekModelIdMap[requestedDefaultLlmModel]
          || requestedDefaultLlmModel;
        const defaultLlmModels = migratedLlm.providers[defaultLlmSource]?.models || [];
        const defaultLlmModel = defaultLlmModels.includes(normalizedDefaultLlmModel)
          ? normalizedDefaultLlmModel
          : defaultLlmModels.includes(base.defaultLlmModel)
            ? base.defaultLlmModel
            : (defaultLlmModels[0] || base.defaultLlmModel);
        const requestedVoiceProviderId = String(
          partial.voiceAssistantSoundProviderId ?? base.voiceAssistantSoundProviderId,
        ).trim();
        const voiceAssistantSoundProviderId = migratedAudio.providers[requestedVoiceProviderId]
          ? requestedVoiceProviderId
          : base.voiceAssistantSoundProviderId;
        const voiceAssistantSoundModel = voiceAssistantSoundProviderId === requestedVoiceProviderId
          ? String(partial.voiceAssistantSoundModel ?? base.voiceAssistantSoundModel).trim()
            || base.voiceAssistantSoundModel
          : base.voiceAssistantSoundModel;

        const config: SeedanceConfig = {
          imageApi: normalizeImageApi(
            partial.imageApi as Partial<ImageApiConfig> | undefined,
            base.imageApi
          ),
          videoApi: normalizeApiBlock(partial.videoApi, base.videoApi),
          multimodalApi: normalizeMultimodalApi(partial.multimodalApi, base.multimodalApi),
          claudeApi: { ...defaultClaudeConfig },
          enhanceApi: normalizeEnhanceApi(
            partial.enhanceApi as (Partial<EnhanceApiConfig> & Record<string, unknown>) | undefined,
            base.enhanceApi
          ),
          subtitleRemovalApi: normalizeTencentMpsSubtitleRemovalConfig(
            partial.subtitleRemovalApi as Partial<TencentMpsSubtitleRemovalConfig> | undefined,
          ),
          defaultLlmSource,
          defaultLlmModel,
          elevenLabs: normalizeElevenLabs(partial.elevenLabs, base.elevenLabs),
          voiceAssistantSoundProviderId,
          voiceAssistantSoundModel,
          voiceAssistantEnabled: typeof partial.voiceAssistantEnabled === 'boolean'
            ? partial.voiceAssistantEnabled
            : base.voiceAssistantEnabled,
          voiceAssistantTimbreEnabled: typeof partial.voiceAssistantTimbreEnabled === 'boolean'
            ? partial.voiceAssistantTimbreEnabled
            : base.voiceAssistantTimbreEnabled,
          voiceAssistantFullModalEnabled: false,
          voiceAssistantSttEnabled: typeof partial.voiceAssistantSttEnabled === 'boolean'
            ? partial.voiceAssistantSttEnabled
            : base.voiceAssistantSttEnabled,
          voiceAssistantTtsEnabled: typeof partial.voiceAssistantTtsEnabled === 'boolean'
            ? partial.voiceAssistantTtsEnabled
            : base.voiceAssistantTtsEnabled,
          voiceAssistantSttProviderId: base.voiceAssistantSttProviderId,
          voiceAssistantAutoStart: typeof partial.voiceAssistantAutoStart === 'boolean'
            ? partial.voiceAssistantAutoStart
            : base.voiceAssistantAutoStart,
          voiceAssistantTtsStability:
            typeof partial.voiceAssistantTtsStability === 'number'
              ? Math.max(0, Math.min(1, partial.voiceAssistantTtsStability))
              : (base.voiceAssistantTtsStability ?? 0.35),
          voiceAssistantTtsStyle:
            typeof partial.voiceAssistantTtsStyle === 'number'
              ? Math.max(0, Math.min(1, partial.voiceAssistantTtsStyle))
              : (base.voiceAssistantTtsStyle ?? 0.5),
          voiceAssistantTtsSimilarityBoost:
            typeof partial.voiceAssistantTtsSimilarityBoost === 'number'
              ? Math.max(0, Math.min(1, partial.voiceAssistantTtsSimilarityBoost))
              : (base.voiceAssistantTtsSimilarityBoost ?? 0.75),
          voiceAssistantTtsSpeed:
            typeof partial.voiceAssistantTtsSpeed === 'number'
              ? Math.max(0.5, Math.min(2, partial.voiceAssistantTtsSpeed))
              : (base.voiceAssistantTtsSpeed ?? 1.0),
          voiceHistory: Array.isArray(partial.voiceHistory)
            ? partial.voiceHistory.slice(0, 50)
            : (Array.isArray(base.voiceHistory) ? base.voiceHistory : []),
          dreaminaCli: {
            ...defaultDreaminaCli,
            ...(partial.dreaminaCli || {}),
          },
          image: patchProviderMetadata(migratedImage, base.image),
          video: patchProviderMetadata(migratedVideo, base.video),
          audio: patchProviderMetadata(migratedAudio, base.audio),
          llm: patchProviderMetadata(migratedLlm, base.llm),
          enhance: patchProviderMetadata(migratedEnhance, base.enhance),
          providerTokens,
        };

        return {
          ...current,
          config,
          tokenUsageVersion: TOKEN_USAGE_VERSION,
          configVersion: CONFIG_VERSION,
          tokenConfig: {
            image: normalizeTokenBucket(
              p?.tokenConfig?.image,
              legacyRemaining,
              resetUsedTokens
            ),
            video: normalizeTokenBucket(
              p?.tokenConfig?.video,
              legacyRemaining,
              resetUsedTokens
            ),
            llm: normalizeTokenBucket(
              p?.tokenConfig?.llm,
              legacyRemaining,
              resetUsedTokens
            ),
            multimodal: normalizeTokenBucket(
              p?.tokenConfig?.multimodal,
              null,
              resetUsedTokens
            ),
            claude: normalizeTokenBucket(
              p?.tokenConfig?.claude,
              null,
              resetUsedTokens
            ),
          },
        };
      },
    }
  )
);

// ---- V2 standalone selectors (pure functions, usable in zustand selectors) ----

export interface ModelOption {
  value: string;
  label: string;
  providerId: string;
}

export function getActiveModelOptions(categoryConfig: CategoryConfig, category?: ApiCategory): ModelOption[] {
  const options: ModelOption[] = [];
  const addProvider = (providers: Record<string, ProviderConfig>) => {
    for (const [pid, p] of Object.entries(providers)) {
      if (category && isRemovedProvider(category, pid)) continue;
      if (!p.enabled) continue;
      for (const m of p.models) {
        options.push({ value: m, label: `${p.label} - ${m}`, providerId: pid });
      }
    }
  };
  addProvider(categoryConfig.providers);
  return options;
}

export function findProviderForModel(categoryConfig: CategoryConfig, model: string, category?: ApiCategory): ProviderConfig | undefined {
  const search = (providers: Record<string, ProviderConfig>) => {
    for (const [pid, p] of Object.entries(providers)) {
      if (category && isRemovedProvider(category, pid)) continue;
      if (p.enabled && p.models.includes(model)) return p;
    }
    return undefined;
  };
  return search(categoryConfig.providers);
}

export function findProviderIdForModel(categoryConfig: CategoryConfig, model: string, category?: ApiCategory): string | undefined {
  const search = (providers: Record<string, ProviderConfig>) => {
    for (const [pid, p] of Object.entries(providers)) {
      if (category && isRemovedProvider(category, pid)) continue;
      if (p.enabled && p.models.includes(model)) return pid;
    }
    return undefined;
  };
  return search(categoryConfig.providers);
}
