'use client';

import { useEffect, useState } from 'react';
import { isRemovedProvider, useSeedanceStore } from './SeedanceStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Image,
  Video,
  MessageSquare,
  Headphones,
  Wand2,
  ExternalLink,
  Terminal,
  Mic,
  Volume2,
  Power,
  Eraser,
} from 'lucide-react';
import { Select, SelectItem } from '@/components/ui/select';
import { createKlingJwt } from '@/lib/kling-jwt';
import type { ImageApiProvider } from '@/components/api/ImageAPI';
import {
  isGeminiOpenAICompatApiUrl,
  isShiyunOpenAiV1ChatApiUrl,
  normalizeGeminiNativeV1BetaBase,
  normalizeGeminiOpenAICompatBase,
  normalizeShiyunOpenAiV1Base,
  normalizeUserGeminiApiKey,
} from '@/lib/gemini-api-url';
import { ProviderConfigSection } from './ProviderConfigSection';
import { resolveProviderEndpoint } from '@/lib/provider-api-profile';
import { inspectMiniMaxH3Connection } from '@/components/api/MiniMaxH3VideoAPI';
import {
  getKieProviderTokenBucket,
  isKieProvider as isKieApiProvider,
  KIE_GLOBAL_PROVIDER_TOKEN_KEY,
} from '@/lib/kie-usage-display';
import { MiniMaxVoiceManager } from './MiniMaxVoiceManager';
import {
  openDreaminaLoginUrl,
  requestDreaminaLogin,
  requestDreaminaUserCredit,
  type DreaminaLoginProgress,
} from '@/lib/dreamina-cli-client';
import type { ApiCategory, ProviderConfig, CategoryConfig, DreaminaLoginBrowser } from './SeedanceStore';

interface SeedanceConfigProps {
  onClose?: () => void;
}

type TabType = 'image' | 'enhance' | 'erase' | 'video' | 'llm' | 'audio' | 'dreamina-cli';

const tabs: { id: TabType; label: string; icon: typeof Image }[] = [
  { id: 'image', label: '图片', icon: Image },
  { id: 'enhance', label: '画质提升', icon: Wand2 },
  { id: 'video', label: '视频', icon: Video },
  { id: 'llm', label: 'LLM', icon: MessageSquare },
  { id: 'audio', label: '语音/音乐', icon: Headphones },
  { id: 'dreamina-cli', label: '即梦CLI', icon: Terminal },
  { id: 'erase', label: '去字幕', icon: Eraser },
];

const FIELD_CLASS =
  'h-9 border-white/12 bg-[#080c10]/75 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:border-white/35 focus-visible:ring-1 focus-visible:ring-white/12';

const ACTION_BTN =
  'h-9 flex-1 gap-1.5 border border-white/14 bg-white/[0.04] text-xs font-medium text-zinc-100 transition-all mc-dur-12f hover:border-white/28 hover:bg-white/[0.08] hover:text-zinc-50 hover:shadow-[0_0_16px_rgba(255,255,255,0.08)] disabled:cursor-not-allowed disabled:opacity-45';

const TENCENT_CLOUD_ACCESS_KEY_URL = 'https://console.cloud.tencent.com/cam/capi';
const TENCENT_CLOUD_COS_BUCKET_URL = 'https://console.cloud.tencent.com/cos5/bucket';

function tabToCategory(tab: TabType): ApiCategory | null {
  if (tab === 'dreamina-cli' || tab === 'erase') return null;
  return tab;
}

export default function SeedanceConfig({ onClose }: SeedanceConfigProps) {
  const {
    config,
    saveApiConfig,
    saveMultimodalApiConfig,
    saveProviderConfig,
    setDefaultLlmSource,
    setDefaultLlmModel,
    setProviderRemainingTokens,
    setVoiceAssistantSound,
    setVoiceAssistantEnabled,
    setVoiceAssistantTtsParams,
    setVoiceAssistantToggles,
    setVoiceAssistantAutoStart,
    saveDreaminaCliConfig,
    setDreaminaCliCredits,
    saveSubtitleRemovalApiConfig,
  } = useSeedanceStore();

  const [activeTab, setActiveTab] = useState<TabType>('image');

  // LLM tab state
  const [tempDefaultLlm, setTempDefaultLlm] = useState(config.defaultLlmSource);
  const [tempDefaultLlmModel, setTempDefaultLlmModel] = useState(config.defaultLlmModel);

  // Generic test/save state
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [testMessage, setTestMessage] = useState('');
  const [subtitleRemovalConfig, setSubtitleRemovalConfig] = useState(config.subtitleRemovalApi);
  const [subtitleRemovalBusy, setSubtitleRemovalBusy] = useState(false);

  // Voice assistant sound selection
  const [tempVoiceProviderId, setTempVoiceProviderId] = useState(config.voiceAssistantSoundProviderId);
  const [tempVoiceModel, setTempVoiceModel] = useState(config.voiceAssistantSoundModel);
  const [tempTtsStability, setTempTtsStability] = useState(config.voiceAssistantTtsStability);
  const [tempTtsStyle, setTempTtsStyle] = useState(config.voiceAssistantTtsStyle);
  const [tempTtsSimilarity, setTempTtsSimilarity] = useState(config.voiceAssistantTtsSimilarityBoost);
  const [tempTtsSpeed, setTempTtsSpeed] = useState(config.voiceAssistantTtsSpeed);
  const [voiceSaveMessage, setVoiceSaveMessage] = useState('');

  // Audio tab sub-sections
  const [audioPanel, setAudioPanel] = useState<'voice' | 'music'>('voice');
  const [voiceSubTab, setVoiceSubTab] = useState<'full' | 'tts' | 'stt'>('full');

  // ---- Dreamina CLI state ----
  const [tempDreaminaCliPath, setTempDreaminaCliPath] = useState(config.dreaminaCli.cliPath);
  const [tempDreaminaLoginBrowser, setTempDreaminaLoginBrowser] = useState<DreaminaLoginBrowser>(
    config.dreaminaCli.loginBrowser || 'system',
  );
  const [tempDreaminaLoginBrowserPath, setTempDreaminaLoginBrowserPath] = useState(
    config.dreaminaCli.loginBrowserPath || '',
  );
  const [tempDreaminaImageEnabled, setTempDreaminaImageEnabled] = useState(config.dreaminaCli.imageEnabled);
  const [tempDreaminaVideoEnabled, setTempDreaminaVideoEnabled] = useState(config.dreaminaCli.videoEnabled);
  const [dreaminaLoginCheckResult, setDreaminaLoginCheckResult] = useState<{
    status: 'idle' | 'checking' | 'success' | 'error';
    message: string;
  }>({ status: 'idle', message: '' });
  const [dreaminaInstallResult, setDreaminaInstallResult] = useState<{
    status: 'idle' | 'installing' | 'success' | 'error';
    message: string;
  }>({ status: 'idle', message: '' });
  const [dreaminaNeedsLogin, setDreaminaNeedsLogin] = useState(false);
  const [dreaminaBrowserLoginLoading, setDreaminaBrowserLoginLoading] = useState(false);
  const [dreaminaOAuthInfo, setDreaminaOAuthInfo] = useState<{ userCode?: string; verificationUri?: string }>({});

  // Active category
  const category = tabToCategory(activeTab);
  const catConfig: CategoryConfig | null = category ? (config[category] ?? null) : null;

  const isEnhanceTab = activeTab === 'enhance';
  const isSubtitleRemovalTab = activeTab === 'erase';
  const isDreaminaCliTab = activeTab === 'dreamina-cli';
  const getProviderTokenBucket = (cat: ApiCategory, providerId: string, provider: ProviderConfig) =>
    isKieApiProvider(provider, providerId)
      ? getKieProviderTokenBucket(config.providerTokens, `${cat}.${providerId}`)
      : config.providerTokens[`${cat}.${providerId}`];

  // ---- Test connection handlers ----

  function handleTabChange(tab: TabType) {
    setActiveTab(tab);
    setTestResult(null);
    setTestMessage('');
    if (tab === 'audio') {
      setTempVoiceProviderId(config.voiceAssistantSoundProviderId);
      setTempVoiceModel(config.voiceAssistantSoundModel);
      setTempTtsStability(config.voiceAssistantTtsStability);
      setTempTtsStyle(config.voiceAssistantTtsStyle);
      setTempTtsSimilarity(config.voiceAssistantTtsSimilarityBoost);
      setTempTtsSpeed(config.voiceAssistantTtsSpeed);
      setVoiceSaveMessage('');
    }
    if (tab === 'llm') {
      setTempDefaultLlm(config.defaultLlmSource);
      setTempDefaultLlmModel(config.defaultLlmModel);
    }
    if (tab === 'dreamina-cli') {
      setTempDreaminaCliPath(config.dreaminaCli.cliPath);
      setTempDreaminaLoginBrowser(config.dreaminaCli.loginBrowser || 'system');
      setTempDreaminaLoginBrowserPath(config.dreaminaCli.loginBrowserPath || '');
      setTempDreaminaImageEnabled(config.dreaminaCli.imageEnabled);
      setTempDreaminaVideoEnabled(config.dreaminaCli.videoEnabled);
      setDreaminaLoginCheckResult({ status: 'idle', message: '' });
      setDreaminaInstallResult({ status: 'idle', message: '' });
    }
    if (tab === 'erase') {
      setSubtitleRemovalConfig(config.subtitleRemovalApi);
      setSubtitleRemovalBusy(false);
    }
  }

  function handleSubtitleRemovalSave() {
    saveSubtitleRemovalApiConfig(subtitleRemovalConfig);
    setTestResult('success');
    setTestMessage('腾讯云 MPS 去字幕配置已保存到本机');
  }

  function openTencentCloudAccessKeyPage() {
    if (window.magineDesktop?.openExternal) {
      void window.magineDesktop.openExternal(TENCENT_CLOUD_ACCESS_KEY_URL);
      return;
    }
    window.open(TENCENT_CLOUD_ACCESS_KEY_URL, '_blank', 'noopener,noreferrer');
  }

  function openTencentCloudCosBucketPage() {
    if (window.magineDesktop?.openExternal) {
      void window.magineDesktop.openExternal(TENCENT_CLOUD_COS_BUCKET_URL);
      return;
    }
    window.open(TENCENT_CLOUD_COS_BUCKET_URL, '_blank', 'noopener,noreferrer');
  }

  async function handleSubtitleRemovalTest() {
    if (subtitleRemovalBusy) return;
    setSubtitleRemovalBusy(true);
    setTestResult(null);
    setTestMessage('正在检查 COS、MPS 和视频去字幕模板…');
    try {
      const response = await fetch('/api/tencent-mps/subtitle-removal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', config: subtitleRemovalConfig }),
      });
      const payload = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        message?: string;
        videoTemplateId?: number;
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `连接失败：HTTP ${response.status}`);
      }
      const nextConfig = payload.videoTemplateId
        ? { ...subtitleRemovalConfig, videoTemplateId: payload.videoTemplateId }
        : subtitleRemovalConfig;
      setSubtitleRemovalConfig(nextConfig);
      saveSubtitleRemovalApiConfig(nextConfig);
      setTestResult('success');
      setTestMessage(payload.message || '腾讯云 MPS 连接成功');
    } catch (error) {
      setTestResult('error');
      setTestMessage(error instanceof Error ? error.message : '腾讯云 MPS 连接失败');
    } finally {
      setSubtitleRemovalBusy(false);
    }
  }

  async function testProviderConnectionViaServer(
    providerId: string,
    providerConfig: ProviderConfig,
    testCategory?: ApiCategory,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      let modelsUrl: string | undefined;
      if (
        testCategory &&
        (providerId.startsWith('custom-') || providerConfig.apiProfile?.preset === 'custom')
      ) {
        modelsUrl = resolveProviderEndpoint(providerConfig, testCategory, 'models');
      }

      const response = await fetch('/api/provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          providerId,
          category: testCategory,
          apiKey: providerConfig.apiKey,
          apiUrl: providerConfig.apiUrl,
          authType: providerConfig.authType,
          modelsUrl,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      return {
        ok: result.ok === true,
        message: result.message || `连接测试失败（本地接口 HTTP ${response.status}）`,
      };
    } catch (e) {
      return { ok: false, message: `连接错误: ${e instanceof Error ? e.message : '未知错误'}` };
    }
  }

  async function handleProviderTest(
    providerId: string,
    providerConfig: ProviderConfig,
    testCategory?: ApiCategory,
  ): Promise<{ ok: boolean; message: string }> {
    const { apiKey, apiUrl } = providerConfig;
    if (!apiKey.trim() && providerId !== 'minimax-h3') return { ok: false, message: '请输入 API Key' };

    // Magine H3 Engine is managed locally and does not require an API key.
    if (providerId === 'minimax-h3') {
      return testMiniMaxH3Connection(apiKey, apiUrl);
    }

    // All Kie-backed providers share one account credit bucket. Test the official
    // credit endpoint first instead of probing provider-specific models routes.
    if (isKieApiProvider(providerConfig, providerId)) {
      return testKieCreditConnection(apiKey, apiUrl);
    }

    if (testCategory === 'enhance' && providerId === 'topaz') {
      try {
        const response = await fetch('/api/topaz/credit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey, apiUrl }),
        });
        const json = (await response.json().catch(() => ({}))) as { ok?: boolean; credits?: number; error?: string };
        if (!response.ok || json.ok === false) {
          return { ok: false, message: json.error || `连接失败: ${response.status}` };
        }
        const credits = typeof json.credits === 'number' ? json.credits : 0;
        setProviderRemainingTokens(KIE_GLOBAL_PROVIDER_TOKEN_KEY, credits);
        return { ok: true, message: `Topaz / Kie 连接成功，剩余 ${credits.toLocaleString()} credits` };
      } catch (e) {
        return { ok: false, message: `连接错误: ${e instanceof Error ? e.message : '未知错误'}` };
      }
    }

    return testProviderConnectionViaServer(providerId, providerConfig, testCategory);
  }

  async function testMiniMaxH3Connection(apiKey: string, apiUrl: string): Promise<{ ok: boolean; message: string }> {
    try {
      const report = await inspectMiniMaxH3Connection(apiUrl, apiKey);
      if (report.engine === 'comfyui') {
        if (!report.connected) {
          return { ok: false, message: '无法连接 ComfyUI，请确认服务已经启动并允许本机访问' };
        }
        if (!report.nodes.ready) {
          return { ok: false, message: `ComfyUI 缺少 H3 必需节点：${report.nodes.missing.join('、')}` };
        }
        if (!report.models.fl2vaReady && !report.models.ref2vaReady) {
          return { ok: false, message: report.warnings.join('；') || 'ComfyUI H3 权重尚未安装完整' };
        }
        const device = report.devices[0];
        const workflows = [report.models.fl2vaReady ? 'FL2VA' : '', report.models.ref2vaReady ? 'Ref2VA' : ''].filter(Boolean).join(' + ');
        return {
          ok: true,
          message: `ComfyUI ${report.version} 已连接 · ${workflows} · ${device?.name || '设备信息未知'} · 队列 ${report.queue.running}/${report.queue.pending}`,
        };
      }
      if (report.hardware.level === 'unsupported') {
        return { ok: false, message: `当前电脑不满足 H3 最低要求：${report.hardware.warnings.join('；') || '未检测到可用的 NVIDIA CUDA 显卡'}` };
      }
      if (!report.runtime.installed) {
        return { ok: false, message: 'Magine H3 Engine 运行环境尚未安装，请在当前模型卡片中点击“运行环境”' };
      }
      if (!report.runtime.ready) {
        return { ok: false, message: report.runtime.error || `H3 运行环境不完整：${report.runtime.missing?.join('、') || 'CUDA 不可用'}` };
      }
      if (!report.model.fl2vaReady && !report.model.ref2vaReady) {
        const legacy = report.model.format === 'legacy-comfy'
          ? '已检测到 ComfyUI safetensors，但独立引擎需要官方 Diffusers 格式。'
          : '';
        return { ok: false, message: `${legacy}请安装 FL2VA 或 Ref2VA 官方权重。` };
      }
      const gpu = report.hardware.gpus[0];
      const gpuInfo = gpu
        ? `${gpu.name} (${Math.round(gpu.vramBytes / 1024 / 1024 / 1024)}GB)`
        : '未检测到 GPU';
      const workflows = [report.model.fl2vaReady ? 'FL2VA' : '', report.model.ref2vaReady ? 'Ref2VA' : ''].filter(Boolean).join(' + ');
      return {
        ok: true,
        message: `Magine H3 Engine 已就绪 · ${workflows} · ${gpuInfo} · ${report.hardware.profile}`,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      return { ok: false, message: msg };
    }
  }

  async function testVolcengineConnection(apiKey: string, apiUrl: string): Promise<{ ok: boolean; message: string }> {
    const apiV3Base = apiUrl.replace(/\/+$/, '');
    const targetUrl = `${apiV3Base.endsWith('/api/v3') ? apiV3Base : `${apiV3Base}/api/v3`}/models`;
    try {
      const response = await fetch('/api/proxy/volcengine', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Target-URL': targetUrl, 'X-API-Key': apiKey },
      });
      if (response.ok) return { ok: true, message: 'API Key 验证通过' };
      const errBody = (await response.json().catch(() => ({}))) as { message?: string; error?: string | { message?: string } };
      const detail = typeof errBody.message === 'string' ? errBody.message
        : typeof errBody.error === 'string' ? errBody.error
        : typeof errBody.error === 'object' && errBody.error ? (errBody.error as { message?: string }).message || '' : '';
      let msg = `连接失败: ${response.status}`;
      if (response.status === 401) msg = '认证失败：API Key 无效';
      if (response.status === 403) msg = '权限不足';
      if (detail) msg = `${msg} — ${detail.slice(0, 200)}`;
      return { ok: false, message: msg };
    } catch (e) {
      return { ok: false, message: `连接错误: ${e instanceof Error ? e.message : '未知错误'}` };
    }
  }

  async function testGeminiConnection(apiKey: string, apiUrl: string): Promise<{ ok: boolean; message: string }> {
    const base = isShiyunOpenAiV1ChatApiUrl(apiUrl)
      ? normalizeShiyunOpenAiV1Base(apiUrl)
      : isGeminiOpenAICompatApiUrl(apiUrl)
        ? normalizeGeminiOpenAICompatBase(apiUrl)
        : normalizeGeminiNativeV1BetaBase(apiUrl);
    const targetUrl = isGeminiOpenAICompatApiUrl(apiUrl) || isShiyunOpenAiV1ChatApiUrl(apiUrl)
      ? `${base}/models`
      : `${base}/models?pageSize=1`;
    try {
      const response = await fetch('/api/proxy/gemini', {
        method: 'GET',
        headers: { 'X-Target-URL': targetUrl, 'X-Goog-Api-Key': normalizeUserGeminiApiKey(apiKey) },
      });
      if (response.ok) return { ok: true, message: 'API Key 验证通过' };
      let msg = `连接失败: ${response.status}`;
      if (response.status === 401 || response.status === 403) msg = '认证失败：API Key 无效';
      return { ok: false, message: msg };
    } catch (e) {
      return { ok: false, message: `连接错误: ${e instanceof Error ? e.message : '未知错误'}` };
    }
  }

  async function testStandardBearerConnection(
    apiKey: string,
    apiUrl: string,
    providerId?: string,
    providerTokenKey?: string,
  ): Promise<{ ok: boolean; message: string }> {
    const base = apiUrl.replace(/\/+$/, '');

    if (/api\.kie\.ai/i.test(base) || /^kie-/i.test(providerId || '')) {
      return testKieCreditConnection(apiKey, base);
    }
    
    // MiniMax LLM API（/v1/chat/completions）
    if (base.includes('minimaxi.com') && base.endsWith('/v1')) {
      try {
        const response = await fetch('/api/proxy/openai', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Target-URL': `${base}/chat/completions`,
            'X-API-Key': apiKey,
          },
          body: JSON.stringify({
            model: 'MiniMax-M2.7',
            messages: [{ role: 'user', content: 'Hi' }],
            max_completion_tokens: 5,
          }),
        });
        if (response.ok) return { ok: true, message: 'API Key 验证通过' };
        let msg = `连接失败: ${response.status}`;
        if (response.status === 401 || response.status === 403) msg = '认证失败：API Key 无效或无权访问';
        return { ok: false, message: msg };
      } catch (e) {
        return { ok: false, message: `连接错误: ${e instanceof Error ? e.message : '未知错误'}` };
      }
    }
    
    // HappyHorse 阿里云百炼 API
    if (base.includes('dashscope.aliyuncs.com')) {
      try {
        // HappyHorse 视频生成 API
        const response = await fetch('/api/proxy/openai', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Target-URL': `${base}/api/v1/services/aigc/video-generation/video-synthesis`,
            'X-API-Key': apiKey,
            'X-Dashscope-Async': 'enable',
          },
          body: JSON.stringify({
            model: 'happyhorse-1.0-i2v',
            input: {
              prompt: 'test',
              media: [],
            },
            parameters: {
              resolution: '720P',
              duration: 5,
            },
          }),
        });
        // HappyHorse API 返回 200 表示成功，400 是参数问题但 API Key 有效
        if (response.ok || response.status === 400) {
          return { ok: true, message: 'API Key 验证通过' };
        }
        let msg = `连接失败: ${response.status}`;
        if (response.status === 401 || response.status === 403) msg = '认证失败：API Key 无效或无权访问';
        return { ok: false, message: msg };
      } catch (e) {
        return { ok: false, message: `连接错误: ${e instanceof Error ? e.message : '未知错误'}` };
      }
    }
    
    // 其他API使用/v1/models端点验证
    const targetUrl = `${base}/v1/models`;
    try {
      const response = await fetch('/api/proxy/openai', {
        method: 'GET',
        headers: { 'X-Target-URL': targetUrl, 'X-API-Key': apiKey },
      });
      if (response.ok) return { ok: true, message: 'API Key 验证通过' };
      // Some providers do not expose /v1/models; users can still test generation directly.
      let msg = `连接失败: ${response.status}`;
      if (response.status === 401 || response.status === 403) msg = '认证失败：API Key 无效或无权访问';
      if (response.status === 404) msg = '端点不存在（/v1/models 不可用），可直接保存后试生成';
      return { ok: false, message: msg };
    } catch (e) {
      return { ok: false, message: `连接错误: ${e instanceof Error ? e.message : '未知错误'}` };
    }
  }

  async function testKieCreditConnection(apiKey: string, apiUrl: string): Promise<{ ok: boolean; message: string }> {
    try {
      const kieOrigin = (() => {
        try {
          return new URL(apiUrl || 'https://api.kie.ai').origin;
        } catch {
          return 'https://api.kie.ai';
        }
      })();
      const response = await fetch('/api/kie/credit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, apiUrl: kieOrigin }),
      });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; credits?: number; error?: string };
      if (response.ok && json.ok === true && typeof json.credits === 'number') {
        setProviderRemainingTokens(KIE_GLOBAL_PROVIDER_TOKEN_KEY, json.credits);
        return { ok: true, message: `Kie API 连接成功，剩余 ${json.credits.toLocaleString()} credits` };
      }
      return { ok: false, message: json.error || `Kie API 校验失败（HTTP ${response.status}）` };
    } catch (e) {
      return { ok: false, message: `Kie API 连接错误：${e instanceof Error ? e.message : '未知错误'}` };
    }
  }

  async function testElevenLabsConnection(apiKey: string): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await fetch(
        'https://api.elevenlabs.io/v1/text-to-speech/wOqiPOGlNVdIcEallTsU',
        {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: 'Hello',
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        }
      );
      if (response.ok) return { ok: true, message: 'API Key 验证通过' };
      return { ok: false, message: `连接失败: ${response.status}` };
    } catch (e) {
      return { ok: false, message: `连接错误: ${e instanceof Error ? e.message : '未知错误'}` };
    }
  }

  async function testKlingJwtConnection(apiKey: string, apiUrl: string): Promise<{ ok: boolean; message: string }> {
    const idx = apiKey.indexOf(':');
    const hasAkSk = idx > 0 && apiKey.slice(0, idx).trim() && apiKey.slice(idx + 1).trim();
    const rawToken = hasAkSk ? '' : apiKey.trim();
    if (!hasAkSk && !rawToken) return { ok: false, message: '请填写 AccessKey + SecretKey，或直接粘贴 JWT Token' };

    try {
      let jwt: string;
      if (hasAkSk) {
        const accessKey = apiKey.slice(0, idx);
        const secretKey = apiKey.slice(idx + 1);
        jwt = await createKlingJwt(accessKey, secretKey);
      } else {
        jwt = rawToken;
      }

      const base = apiUrl.replace(/\/+$/, '');
      const endpoint = `${base}/v1/videos/test_connection_check`;
      const response = await fetch('/api/proxy/openai', {
        method: 'GET',
        headers: {
          'X-Target-URL': endpoint,
          'X-API-Key': jwt,
        },
      });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: '认证失败：凭证无效' };
      }
      return { ok: true, message: '鉴权验证通过' };
    } catch (e) {
      return { ok: false, message: `连接错误: ${e instanceof Error ? e.message : '未知错误'}` };
    }
  }

  function handleProviderSave(providerId: string, providerConfig: ProviderConfig) {
    saveProviderConfig(category!, providerId, providerConfig);
    // Also update legacy fields for backward compat
    if (category === 'image') {
      const provider = (providerId === 'gpt-image-2' ? 'gpt-image-2' : 'seedream') as ImageApiProvider;
      saveApiConfig('image', providerConfig.apiKey, providerConfig.apiUrl, null, { imageProvider: provider });
    } else if (category === 'video') {
      saveApiConfig('video', providerConfig.apiKey, providerConfig.apiUrl, null);
    } else if (category === 'llm') {
      if (providerId === 'gemini') saveMultimodalApiConfig({ apiKey: providerConfig.apiKey, apiUrl: providerConfig.apiUrl, model: config.multimodalApi.model, arkRemainingTokens: null });
    }
  }

  // ---- Dreamina CLI handlers ----

  function resolveDreaminaCliPath(forcePath?: string): string {
    const rawPath = forcePath ?? tempDreaminaCliPath.trim();
    return /^curl\s.*\|\s*(bash|sh)/i.test(rawPath) ? 'dreamina' : (rawPath || 'dreamina');
  }

  function getDreaminaLoginBrowserConfig() {
    return {
      type: tempDreaminaLoginBrowser,
      path: tempDreaminaLoginBrowser === 'custom' ? tempDreaminaLoginBrowserPath.trim() : '',
    };
  }

  function applyDreaminaLoggedIn(
    cliPath: string,
    loginName: string,
    totalCredit: number,
    vipLevel?: string,
    userId?: number | string,
    usedPath?: string,
  ) {
    setDreaminaNeedsLogin(false);
    saveDreaminaCliConfig({ cliPath, loggedIn: true, loginName });
    setDreaminaCliCredits({
      totalCredit,
      vipLevel: vipLevel || '',
      userId: userId == null ? '' : String(userId),
      usedPath: usedPath || cliPath,
      syncing: false,
      syncError: '',
      lastSyncedAt: Date.now(),
    });
  }

  async function handleDreaminaCheckLogin(forcePath?: string): Promise<boolean> {
    const cliPath = resolveDreaminaCliPath(forcePath);
    setDreaminaLoginCheckResult({ status: 'checking', message: '正在检测登录状态 (dreamina user_credit)...' });

    try {
      let data = await requestDreaminaUserCredit(cliPath);

      if (!data.ok && data.needsRepair) {
        const repairRes = await fetch('/api/dreamina/repair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cliPath }),
          signal: AbortSignal.timeout(35000),
        });
        if (repairRes.ok) {
          data = await requestDreaminaUserCredit(cliPath);
        }
      }

      if (data.ok && data.loggedIn && typeof data.data?.total_credit === 'number') {
        applyDreaminaLoggedIn(cliPath, data.loginName || '', data.data.total_credit, data.data.vip_level, data.data.user_id, data.usedPath);
        const accountHint = data.data.user_id == null ? '' : `，UID ${data.data.user_id}`;
        setDreaminaLoginCheckResult({
          status: 'success',
          message: `已登录${data.loginName ? `：${data.loginName}` : ''}${accountHint}，CLI 可用积分 ${data.data.total_credit}${data.usedPath ? `，CLI ${data.usedPath}` : ''}`,
        });
        return true;
      }

      const errMsg = typeof data.error === 'string' ? data.error : '未登录';
      setDreaminaNeedsLogin(Boolean(data.needsLogin) || /未登录|请先登录/i.test(errMsg));
      saveDreaminaCliConfig({ loggedIn: false, loginName: '' });
      setDreaminaLoginCheckResult({
        status: 'error',
        message: errMsg.includes('CLI 未找到')
          ? `${errMsg}\n\n请先点击「自动安装」。`
          : `${errMsg}\n\n请点击「OAuth 登录」完成官方 Device Flow 授权。`,
      });
      return false;
    } catch (e) {
      setDreaminaLoginCheckResult({
        status: 'error',
        message: `连接错误: ${e instanceof Error ? e.message : '未知错误'}`,
      });
      return false;
    }
  }

  async function handleDreaminaBrowserLogin(forcePath?: string) {
    const cliPath = resolveDreaminaCliPath(forcePath);
    setDreaminaOAuthInfo({});
    setDreaminaBrowserLoginLoading(true);
    setDreaminaLoginCheckResult({
      status: 'checking',
      message: '正在执行官方 OAuth Device Flow（headless → checklogin）...',
    });

    const onProgress = (info: DreaminaLoginProgress) => {
      if (info.verificationUri || info.userCode) {
        setDreaminaOAuthInfo({
          verificationUri: info.verificationUri,
          userCode: info.userCode,
        });
      }
      if (info.message) {
        setDreaminaLoginCheckResult((prev) => ({
          ...prev,
          status: 'checking',
          message: info.message || prev.message,
        }));
      }
    };

    try {
      const data = await requestDreaminaLogin(cliPath, onProgress, true, getDreaminaLoginBrowserConfig());
      setDreaminaBrowserLoginLoading(false);

      if (!data.ok) {
        const hint = data.userCode ? `\n设备码：${data.userCode}` : '';
        const link = data.verificationUri ? `\n授权页：${data.verificationUri}` : '';
        setDreaminaLoginCheckResult({
          status: 'error',
          message: `${data.error || 'OAuth 登录失败'}${hint}${link}`,
        });
        return;
      }

      const totalCredit = data.data?.total_credit;
      if (typeof totalCredit === 'number') {
        applyDreaminaLoggedIn(cliPath, data.loginName || '', totalCredit, data.data?.vip_level, data.data?.user_id, data.usedPath);
        const accountHint = data.data?.user_id == null ? '' : `，UID ${data.data.user_id}`;
        setDreaminaLoginCheckResult({
          status: 'success',
          message: `${data.message || '已登录'}${accountHint}，CLI 可用积分 ${totalCredit}${data.usedPath ? `，CLI ${data.usedPath}` : ''}`,
        });
        return;
      }

      setDreaminaLoginCheckResult({
        status: 'error',
        message: data.message || '登录流程结束但未取得积分，请点「检测登录」重试',
      });
    } catch (e) {
      setDreaminaBrowserLoginLoading(false);
      setDreaminaLoginCheckResult({
        status: 'error',
        message: `登录失败: ${e instanceof Error ? e.message : '未知错误'}`,
      });
    }
  }

  function handleSaveDreaminaCli() {
    saveDreaminaCliConfig({
      cliPath: tempDreaminaCliPath.trim() || 'dreamina',
      loginBrowser: tempDreaminaLoginBrowser,
      loginBrowserPath: tempDreaminaLoginBrowserPath.trim(),
      imageEnabled: tempDreaminaImageEnabled,
      videoEnabled: tempDreaminaVideoEnabled,
    });
    setTestResult('success');
    setTestMessage('即梦CLI 配置已保存');
  }

  async function handleDreaminaInstall() {
    // If user pasted a curl install command, clear it — auto-install already runs the right command
    const rawPath = tempDreaminaCliPath.trim();
    const sanitizedPath = /^curl\s.*\|\s*(bash|sh)/i.test(rawPath) ? '' : rawPath;
    if (sanitizedPath !== rawPath) {
      setTempDreaminaCliPath('');
    }

    setDreaminaInstallResult({ status: 'installing', message: '正在安装即梦CLI，请稍候...' });
    try {
      const res = await fetch('/api/dreamina/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliPath: sanitizedPath }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
        detail?: string;
        manualCmd?: string;
        installPath?: string;
      };
      if (data.ok) {
        const resolvedPath = 'dreamina';
        setTempDreaminaCliPath(resolvedPath);
        setDreaminaInstallResult({
          status: 'success',
          message: `${data.message || '安装成功'}\n建议 CLI 路径使用: dreamina`,
        });
        setTimeout(() => handleDreaminaCheckLogin(resolvedPath), 500);
      } else {
        const manualHint = data.manualCmd ? `\n手动安装命令: ${data.manualCmd}` : '';
        const detail = typeof data.detail === 'string' ? `\n---\n${data.detail}` : '';
        setDreaminaInstallResult({
          status: 'error',
          message: `${data.error || data.message || '安装失败'}${detail}${manualHint}`,
        });
      }
    } catch (e) {
      setDreaminaInstallResult({
        status: 'error',
        message: `安装请求失败: ${e instanceof Error ? e.message : '网络错误'}`,
      });
    }
  }

  // ---- Render ----

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div
        data-tutorial-id="api-config-tabs"
        className="rounded-xl border border-white/14 bg-white/[0.04] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_0_28px_rgba(255,255,255,0.04)]"
      >
        <div
          data-tutorial-id="api-config-tabs-scroll"
          className={cn(
            'overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]',
            '[scrollbar-width:thin] [scrollbar-color:rgb(63_63_70/0.55)_transparent]',
            '[&::-webkit-scrollbar]:h-1.5',
            '[&::-webkit-scrollbar-track]:bg-transparent',
            '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-600/55',
            '[&::-webkit-scrollbar-thumb]:hover:bg-zinc-500/65'
          )}
        >
          <div className="flex w-max min-w-full flex-nowrap gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-tutorial-id={`api-config-tab-${tab.id}`}
                  onClick={() => handleTabChange(tab.id)}
                  className={cn(
                    'flex shrink-0 flex-row items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[10px] font-medium transition-all mc-dur-12f',
                    activeTab === tab.id
                      ? 'border border-white/22 bg-white/[0.09] text-zinc-50 shadow-[0_0_22px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.16)]'
                      : 'border border-transparent text-zinc-500 hover:border-white/12 hover:bg-white/[0.06] hover:text-zinc-200 hover:shadow-[0_0_14px_rgba(255,255,255,0.04)]'
                  )}
                >
                  <Icon className="h-3 w-3 shrink-0 opacity-90" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <>
        {isSubtitleRemovalTab && (
          <div className="space-y-3 rounded-xl border border-white/12 bg-white/[0.025] p-3">
            <div className="flex items-start gap-2">
              <Eraser className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
              <div>
                <h3 className="text-xs font-semibold text-zinc-100">腾讯云 MPS 云端去字幕</h3>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                  图片使用文字擦除编排，视频使用智能擦除模板。处理结果会写入 COS，再自动回存为画布素材。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1.5">
                <span className="flex items-center justify-between gap-2 text-[10px] font-medium text-zinc-400">
                  SecretId
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      openTencentCloudAccessKeyPage();
                    }}
                    className="inline-flex items-center gap-1 text-cyan-300 transition-colors hover:text-cyan-100"
                  >
                    获取密钥
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </span>
                <Input
                  value={subtitleRemovalConfig.secretId}
                  onChange={(event) => setSubtitleRemovalConfig((current) => ({ ...current, secretId: event.target.value.trim() }))}
                  placeholder="AKID..."
                  autoComplete="off"
                  className={FIELD_CLASS}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-medium text-zinc-400">SecretKey</span>
                <Input
                  type="password"
                  value={subtitleRemovalConfig.secretKey}
                  onChange={(event) => setSubtitleRemovalConfig((current) => ({ ...current, secretKey: event.target.value.trim() }))}
                  placeholder="腾讯云 SecretKey"
                  autoComplete="new-password"
                  className={FIELD_CLASS}
                />
              </label>
            </div>

            <label className="block space-y-1.5">
              <span className="flex items-center justify-between gap-2 text-[10px] font-medium text-zinc-400">
                COS Bucket 完整名称
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    openTencentCloudCosBucketPage();
                  }}
                  className="inline-flex items-center gap-1 text-cyan-300 transition-colors hover:text-cyan-100"
                >
                  打开 COS 控制台
                  <ExternalLink className="h-3 w-3" />
                </button>
              </span>
              <Input
                value={subtitleRemovalConfig.cosBucket}
                onChange={(event) => setSubtitleRemovalConfig((current) => ({ ...current, cosBucket: event.target.value.trim() }))}
                placeholder="examplebucket-1250000000"
                className={FIELD_CLASS}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1.5">
                <span className="text-[10px] font-medium text-zinc-400">COS 地域</span>
                <Input
                  value={subtitleRemovalConfig.cosRegion}
                  onChange={(event) => setSubtitleRemovalConfig((current) => ({ ...current, cosRegion: event.target.value.trim() }))}
                  placeholder="ap-guangzhou"
                  className={FIELD_CLASS}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-medium text-zinc-400">MPS API 地域</span>
                <Input
                  value={subtitleRemovalConfig.mpsRegion}
                  onChange={(event) => setSubtitleRemovalConfig((current) => ({ ...current, mpsRegion: event.target.value.trim() }))}
                  placeholder="ap-guangzhou"
                  className={FIELD_CLASS}
                />
              </label>
            </div>

            <div className="grid grid-cols-[1.45fr_1fr] gap-2">
              <label className="space-y-1.5">
                <span className="text-[10px] font-medium text-zinc-400">COS 临时目录</span>
                <Input
                  value={subtitleRemovalConfig.cosPrefix}
                  onChange={(event) => setSubtitleRemovalConfig((current) => ({ ...current, cosPrefix: event.target.value }))}
                  placeholder="maginecanvas/subtitle-removal"
                  className={FIELD_CLASS}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-medium text-zinc-400">视频模板 ID</span>
                <Input
                  inputMode="numeric"
                  value={subtitleRemovalConfig.videoTemplateId || ''}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setSubtitleRemovalConfig((current) => ({
                      ...current,
                      videoTemplateId: Number.isInteger(value) && value > 0 ? value : null,
                    }));
                  }}
                  placeholder="可自动检测"
                  className={FIELD_CLASS}
                />
              </label>
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className={ACTION_BTN} onClick={handleSubtitleRemovalSave}>
                保存配置
              </Button>
              <Button
                type="button"
                variant="outline"
                className={ACTION_BTN}
                disabled={subtitleRemovalBusy}
                onClick={() => { void handleSubtitleRemovalTest(); }}
              >
                {subtitleRemovalBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                检测并保存
              </Button>
            </div>

            {testMessage && (
              <div className={cn(
                'flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] leading-relaxed',
                testResult === 'success'
                  ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
                  : testResult === 'error'
                    ? 'border-rose-400/28 bg-rose-500/12 text-rose-200'
                    : 'border-white/10 bg-white/[0.04] text-zinc-400',
              )}>
                {testResult === 'success' ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" /> : testResult === 'error' ? <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> : null}
                <span>{testMessage}</span>
              </div>
            )}

            <p className="text-[9px] leading-relaxed text-zinc-500">
              密钥仅保存到本机设置；请求时用于调用腾讯云 MPS 与 COS。若视频模板 ID 留空，“检测并保存”会自动查找当前账号的去字幕模板。
              {' '}
              <a className="text-cyan-300 hover:text-cyan-200" href="https://cloud.tencent.com/document/product/862/119629" target="_blank" rel="noreferrer">智能擦除说明</a>
            </p>
          </div>
        )}

        {/* ---- LLM default source selector ---- */}
        {activeTab === 'llm' && (
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              默认 LLM 来源（「跟随默认」时使用）
            </label>
            <Select
              value={`${tempDefaultLlm}::${tempDefaultLlmModel}`}
              onValueChange={(v) => {
                if (!v) return;
                const sep = v.lastIndexOf('::');
                if (sep > 0) {
                  setTempDefaultLlm(v.slice(0, sep));
                  setTempDefaultLlmModel(v.slice(sep + 2));
                }
              }}
              className={FIELD_CLASS}
            >
              {(() => {
                const items: { value: string; label: string }[] = [];
                for (const [pid, p] of Object.entries(config.llm.providers)) {
                  if (isRemovedProvider('llm', pid)) continue;
                  if (!p.enabled) continue;
                  for (const model of p.models) {
                    items.push({
                      value: `${pid}::${model}`,
                      label: `${p.label} · ${model}`,
                    });
                  }
                }
                if (items.length === 0) {
                  items.push({ value: 'openai::gpt-5-5', label: 'Kie OpenAI · gpt-5-5' });
                  items.push({ value: 'gemini::gemini-2.5-pro', label: 'Kie Gemini（多模态） · gemini-2.5-pro' });
                }
                return items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ));
              })()}
            </Select>
            <div className="flex gap-2">
              <Button
                size="sm" variant="outline"
                onClick={() => {
                  setDefaultLlmSource(tempDefaultLlm);
                  setDefaultLlmModel(tempDefaultLlmModel);
                  setTestResult('success');
                  setTestMessage('更新成功');
                }}
                className={cn(ACTION_BTN, 'h-7')}
              >
                更新默认
              </Button>
            </div>

            {testMessage && (
              <div
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px]',
                  testResult === 'success'
                    ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
                    : 'border-white/10 bg-white/[0.04] text-zinc-400',
                )}
              >
                {testResult === 'success' ? <CheckCircle2 className="w-3 h-3" /> : null}
                {testMessage}
              </div>
            )}
          </div>
        )}

        {/* ---- Audio tab: 语音 / 音乐 ---- */}
        {activeTab === 'audio' && (
          <div className="space-y-3">
            {/* ====== 顶部：语音助手运行选择 ====== */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_28px_rgba(255,255,255,0.05)]">
              <div className="flex items-center gap-2">
                <Mic className="h-3.5 w-3.5 shrink-0 text-sky-200/90 drop-shadow-[0_0_10px_rgba(56,189,248,0.25)]" />
                <span className="text-[11px] font-semibold tracking-tight text-zinc-100">语音助手运行选择</span>
              </div>
              <p className="text-[9px] leading-relaxed text-zinc-500">
                启用或关闭语音助手各项能力。STT 使用本地 SenseVoice 模型，不需要云端 API Key。
              </p>

              <div
                data-tutorial-id="api-audio-assistant"
                className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2.5"
              >
                <div className="min-w-0 pr-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-100">
                    <Power className="h-3.5 w-3.5 text-sky-200/90" />
                    语音助手
                  </div>
                  <p className="mt-1 text-[8px] leading-relaxed text-zinc-500">
                    关闭后停止语音交互，并隐藏欢迎页和画布中的语音助手 UI。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setVoiceAssistantEnabled(!config.voiceAssistantEnabled)}
                  className={cn(
                    'relative box-border h-5 w-9 shrink-0 rounded-full transition-colors',
                    config.voiceAssistantEnabled ? 'bg-sky-500' : 'bg-white/15',
                  )}
                  aria-pressed={config.voiceAssistantEnabled}
                  aria-label={`语音助手：${config.voiceAssistantEnabled ? '开启' : '关闭'}`}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-[left]',
                      config.voiceAssistantEnabled ? 'left-[18px]' : 'left-0.5',
                    )}
                  />
                </button>
              </div>

              {/* 语音助手开关卡片：纵向排版，开关单独一行避免被裁切 */}
              <div
                className={cn(
                  'grid grid-cols-4 gap-1.5 transition-opacity',
                  !config.voiceAssistantEnabled && 'pointer-events-none opacity-35',
                )}
                aria-disabled={!config.voiceAssistantEnabled}
              >
                {([
                  {
                    key: 'timbre' as const,
                    label: '音色',
                    icon: Mic,
                    desc: '自定义TTS音色',
                    enabled: config.voiceAssistantTimbreEnabled,
                    disabled: false,
                  },
                  {
                    key: 'stt' as const,
                    label: 'STT',
                    icon: Headphones,
                    desc: '语音转文字',
                    enabled: config.voiceAssistantSttEnabled,
                    disabled: false,
                  },
                  {
                    key: 'tts' as const,
                    label: 'TTS',
                    icon: Volume2,
                    desc: '文字转语音',
                    enabled: config.voiceAssistantTtsEnabled,
                    disabled: false,
                  },
                  {
                    key: 'autoStart' as const,
                    label: '自启',
                    icon: Power,
                    desc: '加载后自动开启',
                    enabled: config.voiceAssistantAutoStart,
                    disabled: false,
                  },
                ] as const).map(({ key, label, icon: Icon, desc, enabled, disabled }) => {
                  const isOff = disabled || !enabled;
                  return (
                    <div
                      key={key}
                      className={cn(
                        'flex min-h-[4.75rem] flex-col gap-1.5 rounded-lg border p-1.5 transition-opacity',
                        disabled ? 'border-white/5 opacity-40' : 'border-white/10',
                      )}
                    >
                      <div className="flex items-center gap-1">
                        <Icon
                          className={cn(
                            'h-3 w-3 shrink-0',
                            isOff ? 'text-zinc-600' : 'text-sky-200/80',
                          )}
                        />
                        <span
                          className={cn(
                            'text-[10px] font-medium leading-none',
                            isOff ? 'text-zinc-600' : 'text-zinc-200',
                          )}
                        >
                          {label}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (key === 'autoStart') {
                            setVoiceAssistantAutoStart(!config.voiceAssistantAutoStart);
                          } else {
                            setVoiceAssistantToggles({
                              [key === 'timbre'
                                ? 'timbreEnabled'
                                : key === 'stt'
                                  ? 'sttEnabled'
                                  : 'ttsEnabled']: !enabled,
                            });
                          }
                        }}
                        className={cn(
                          'relative box-border h-4 w-7 shrink-0 self-end rounded-full transition-colors',
                          disabled ? 'cursor-not-allowed bg-white/10' : '',
                          !disabled && enabled ? 'bg-sky-500' : 'bg-white/15',
                        )}
                        aria-pressed={enabled && !disabled}
                        aria-label={`${label}：${enabled && !disabled ? '开启' : '关闭'}`}
                      >
                        <span
                          className={cn(
                            'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-[left]',
                            enabled && !disabled ? 'left-[14px]' : 'left-0.5',
                          )}
                        />
                      </button>
                      <p className="mt-auto text-[8px] leading-snug text-zinc-600">{desc}</p>
                    </div>
                  );
                })}
              </div>

              {/* 音色展开配置（仅当音色开关 ON 时显示） */}
              {config.voiceAssistantEnabled && config.voiceAssistantTimbreEnabled && (
                <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5 space-y-2">
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                      TTS 引擎
                    </label>
                    <Select
                      value={tempVoiceProviderId}
                      onValueChange={(v) => v && setTempVoiceProviderId(v)}
                      className={FIELD_CLASS}
                    >
                      {(() => {
                        const items: { value: string; label: string }[] = [];
                        for (const [pid, p] of Object.entries(config.audio.providers)) {
                          if (p.enabled && p.apiKey.trim()) {
                            items.push({ value: pid, label: p.label });
                          }
                        }
                        if (items.length === 0) {
                          items.push({ value: 'elevenlabs', label: 'ElevenLabs' });
                          items.push({ value: 'minimax-audio', label: 'MiniMax 音频' });
                        }
                        return items.map((item) => (
                          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                        ));
                      })()}
                    </Select>
                  </div>

                  {tempVoiceProviderId === 'elevenlabs' && (
                    <div className="space-y-1.5">
                      <label className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                        音色 ID
                      </label>
                      <Input
                        value={tempVoiceModel}
                        onChange={(e) => setTempVoiceModel(e.target.value)}
                        placeholder="wOqiPOGlNVdIcEallTsU"
                        className={FIELD_CLASS}
                      />
                    </div>
                  )}

                  {tempVoiceProviderId === 'minimax-audio' && (
                    <MiniMaxVoiceManager
                      apiKey={(config.audio.providers['minimax-audio']?.apiKey || '').trim()}
                      selectedVoiceId={tempVoiceModel}
                      onSelectVoice={(voiceId) => setTempVoiceModel(voiceId)}
                    />
                  )}

                  <div className="space-y-2 rounded-md border border-white/6 bg-black/15 p-2">
                    <p className="text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                      朗读表现
                    </p>
                    {tempVoiceProviderId === 'elevenlabs' ? (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-[10px] text-zinc-500">
                            稳定性 <span className="text-zinc-600">{tempTtsStability.toFixed(2)}</span>
                          </label>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={tempTtsStability}
                            onChange={(e) => setTempTtsStability(parseFloat(e.target.value))}
                            className="h-1 w-full accent-violet-400"
                          />
                          <p className="mt-0.5 text-[8px] leading-relaxed text-zinc-600">越低越有情感起伏</p>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] text-zinc-500">
                            表现力 <span className="text-zinc-600">{tempTtsStyle.toFixed(2)}</span>
                          </label>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={tempTtsStyle}
                            onChange={(e) => setTempTtsStyle(parseFloat(e.target.value))}
                            className="h-1 w-full accent-violet-400"
                          />
                          <p className="mt-0.5 text-[8px] leading-relaxed text-zinc-600">越高越不像念稿</p>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] text-zinc-500">
                            相似度 <span className="text-zinc-600">{tempTtsSimilarity.toFixed(2)}</span>
                          </label>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={tempTtsSimilarity}
                            onChange={(e) => setTempTtsSimilarity(parseFloat(e.target.value))}
                            className="h-1 w-full accent-violet-400"
                          />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="mb-1 block text-[10px] text-zinc-500">
                          语速 <span className="text-zinc-600">{tempTtsSpeed.toFixed(1)}</span>
                        </label>
                        <input
                          type="range"
                          min={0.5}
                          max={2}
                          step={0.1}
                          value={tempTtsSpeed}
                          onChange={(e) => setTempTtsSpeed(parseFloat(e.target.value))}
                          className="h-1 w-full accent-violet-400"
                        />
                        <p className="mt-0.5 text-[8px] leading-relaxed text-zinc-600">1.0 为正常语速</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setVoiceAssistantSound(tempVoiceProviderId, tempVoiceModel);
                        setVoiceAssistantTtsParams({
                          stability: tempTtsStability,
                          style: tempTtsStyle,
                          similarityBoost: tempTtsSimilarity,
                          speed: tempTtsSpeed,
                        });
                        setVoiceSaveMessage('保存成功');
                        window.setTimeout(() => setVoiceSaveMessage(''), 3000);
                      }}
                      className={cn(ACTION_BTN, 'h-7 self-start')}
                    >
                      保存声音设置
                    </Button>
                    {voiceSaveMessage ? (
                      <div
                        className="flex items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-[10px] text-emerald-200"
                        role="status"
                        aria-live="polite"
                      >
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        {voiceSaveMessage}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>

            {/* ====== 横向选择条：语音 | 音乐 ====== */}
            <div className="flex gap-1 rounded-lg border border-white/8 bg-white/[0.02] p-1">
              {(['voice', 'music'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  data-tutorial-id={`api-audio-panel-${key}`}
                  onClick={() => { setAudioPanel(key); if (key === 'voice') setVoiceSubTab('full'); }}
                  className={cn(
                    'flex-1 rounded-md px-3 py-1.5 text-[10px] font-medium transition-colors',
                    audioPanel === key
                      ? 'bg-white/[0.08] text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300',
                  )}
                >
                  {key === 'voice' ? '语音' : '音乐'}
                </button>
              ))}
            </div>

            {/* ====== 语音 板块 ====== */}
            {audioPanel === 'voice' && (
              <div className="rounded-xl border border-sky-400/12 bg-sky-500/[0.02] p-3 space-y-3">
                {/* 子选择条：API | TTS | STT */}
                <div className="flex gap-1 rounded-lg border border-white/8 bg-white/[0.02] p-1">
                  {([
                    ['full', 'API'],
                    ['tts', 'TTS'],
                    ['stt', 'STT'],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      data-tutorial-id={`api-audio-voice-tab-${key}`}
                      onClick={() => setVoiceSubTab(key)}
                      className={cn(
                        'flex-1 rounded-md px-2 py-1 text-[9px] font-medium transition-colors',
                        voiceSubTab === key
                          ? 'bg-white/[0.08] text-zinc-100'
                          : 'text-zinc-500 hover:text-zinc-300',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* ---- API ---- */}
                {voiceSubTab === 'full' && (
                  <div
                    data-tutorial-id="api-audio-voice-api"
                    className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5 space-y-1.5"
                  >
                    <p className="text-[8px] leading-relaxed text-zinc-600">语音 API 配置用于 TTS、音色和音频生成；STT 已改为本地 SenseVoice，不再使用这里的云端 API Key。</p>
                    {catConfig?.providers['elevenlabs'] ? (
                      <ProviderConfigSection
                        key="elevenlabs"
                        category="audio"
                        providerId="elevenlabs"
                        config={catConfig.providers['elevenlabs']!}
                        tokenBucket={config.providerTokens['audio.elevenlabs']}
                        onSave={handleProviderSave}
                        onTest={(id, cfg) => handleProviderTest(id, cfg, category!)}
                      />
                    ) : null}
                  </div>
                )}

                {/* ---- TTS ---- */}
                {voiceSubTab === 'tts' && (
                  <div
                    data-tutorial-id="api-audio-voice-tts"
                    className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5 space-y-1.5"
                  >
                    <p className="text-[8px] leading-relaxed text-zinc-600">TTS 文字转语音提供商配置。上方音色选择器控制全局朗读引擎。</p>
                    {catConfig?.providers['minimax-audio'] ? (
                      <ProviderConfigSection
                        key="minimax-audio"
                        category="audio"
                        providerId="minimax-audio"
                        config={catConfig.providers['minimax-audio']!}
                        tokenBucket={config.providerTokens['audio.minimax-audio']}
                        onSave={handleProviderSave}
                        onTest={(id, cfg) => handleProviderTest(id, cfg, category!)}
                      />
                    ) : null}
                  </div>
                )}

                {/* ---- STT ---- */}
                {voiceSubTab === 'stt' && (
                  <div
                    data-tutorial-id="api-audio-voice-stt"
                    className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5 space-y-2"
                  >
                    <p className="text-[8px] leading-relaxed text-zinc-600">
                      语音转文字服务已改为本地识别，不再调用 ElevenLabs / Qwen3-ASR 云端 STT。
                    </p>
                    <div className="flex items-center gap-1.5 rounded-md border border-emerald-400/15 bg-emerald-500/[0.06] px-2.5 py-1.5 text-[9px] text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      本地 STT：SenseVoice Small int8（sherpa-onnx，CPU）
                    </div>
                    <div className="rounded-md border border-white/8 bg-black/20 px-2.5 py-2 text-[8px] leading-relaxed text-zinc-500">
                      首次使用会自动下载约 228MB 的模型并缓存到本机；之后识别过程完全在本机运行，音频不会发送到云端 STT 服务。
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ====== 音乐 板块 ====== */}
            {audioPanel === 'music' && (
              <div
                data-tutorial-id="api-audio-music"
                className="rounded-xl border border-amber-400/12 bg-amber-500/[0.02] p-3 space-y-3"
              >
                <p className="text-[9px] leading-relaxed text-zinc-500">
                  音乐/音效生成 — MiniMax 音乐生成、Kie Suno 音乐生成
                </p>

                {(['minimax-audio', 'suno'] as const).map((providerId) => (
                  catConfig?.providers[providerId] ? (
                    <ProviderConfigSection
                      key={`${providerId}-music`}
                      category="audio"
                      providerId={providerId}
                      config={catConfig.providers[providerId]!}
                      tokenBucket={getProviderTokenBucket('audio', providerId, catConfig.providers[providerId]!)}
                      onSave={handleProviderSave}
                      onTest={(id, cfg) => handleProviderTest(id, cfg, category!)}
                    />
                  ) : null
                ))}

                {testMessage && (
                  <div
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px]',
                      testResult === 'success'
                        ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
                        : testResult === 'error'
                          ? 'border-rose-400/28 bg-rose-500/12 text-rose-200'
                          : 'border-white/10 bg-white/[0.04] text-zinc-400',
                    )}
                  >
                    {testResult === 'success' ? <CheckCircle2 className="w-3 h-3" /> : testResult === 'error' ? <AlertCircle className="w-3 h-3" /> : null}
                    {testMessage}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ---- Provider sections (non-audio tabs) ---- */}
        {category && catConfig && activeTab !== 'audio' && (
          <div className="space-y-2">
            {/* Built-in providers */}
            {Object.entries(catConfig.providers)
              .filter(([pid]) => !isRemovedProvider(category, pid))
              .filter(([pid]) => !isEnhanceTab || pid === 'topaz')
              .map(([pid, p]) => (
              <ProviderConfigSection
                key={pid}
                category={category}
                providerId={pid}
                config={p}
                tokenBucket={getProviderTokenBucket(category, pid, p)}
                onSave={handleProviderSave}
                onTest={(id, cfg) => handleProviderTest(id, cfg, category!)}
              />
            ))}

          </div>
        )}
      </>

      {/* ---- Dreamina CLI tab ---- */}
      {isDreaminaCliTab && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 shrink-0 text-emerald-200/90 drop-shadow-[0_0_10px_rgba(52,211,153,0.25)]" />
            <span className="text-[11px] font-semibold tracking-tight text-zinc-100">即梦CLI 服务端配置</span>
            {config.dreaminaCli.loggedIn && (
              <span className="ml-auto rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[8px] text-emerald-300">
                已登录{config.dreaminaCli.loginName ? `: ${config.dreaminaCli.loginName}` : ''}
              </span>
            )}
          </div>

          <div data-tutorial-id="api-dreamina-install" className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              CLI 路径
              {(() => {
                const raw = tempDreaminaCliPath.trim();
                if (/^curl\s.*\|\s*(bash|sh)/i.test(raw)) {
                  return <span className="text-[8px] text-emerald-300 bg-emerald-500/15 px-1.5 py-0.5 rounded-full">已识别安装命令</span>;
                }
                return null;
              })()}
            </label>
            <Input
              value={tempDreaminaCliPath}
              onChange={(e) => setTempDreaminaCliPath(e.target.value)}
              placeholder="粘贴 curl -fsSL https://jimeng.jianying.com/cli | bash 或填写 CLI 路径"
              className={FIELD_CLASS}
            />
            <p className="text-[9px] text-zinc-600">
              直接粘贴官方安装命令后点击「自动安装」即可一键完成。CLI 路径留空使用默认位置 ~/.local/bin/dreamina
            </p>
          </div>

          <div data-tutorial-id="api-dreamina-browser" className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              OAuth 授权浏览器
            </label>
            <Select
              value={tempDreaminaLoginBrowser}
              onValueChange={(value) => setTempDreaminaLoginBrowser((value || 'system') as DreaminaLoginBrowser)}
              className={cn(FIELD_CLASS, 'py-0')}
              popupClassName="z-[12000]"
            >
              <SelectItem value="system">系统默认浏览器</SelectItem>
              <SelectItem value="chrome">Google Chrome</SelectItem>
              <SelectItem value="edge">Microsoft Edge</SelectItem>
              <SelectItem value="firefox">Firefox</SelectItem>
              <SelectItem value="custom">自定义浏览器路径</SelectItem>
            </Select>
            {tempDreaminaLoginBrowser === 'custom' && (
              <Input
                value={tempDreaminaLoginBrowserPath}
                onChange={(e) => setTempDreaminaLoginBrowserPath(e.target.value)}
                placeholder="例如 C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
                className={FIELD_CLASS}
              />
            )}
            <p className="text-[9px] leading-relaxed text-zinc-600">
              OAuth 登录会强制重新授权，并用这里选择的浏览器打开官方授权页；请确保该浏览器当前登录的是要绑定的即梦账号。
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleDreaminaInstall}
              disabled={dreaminaInstallResult.status === 'installing'}
              className={cn(ACTION_BTN, 'h-7', 'border-emerald-400/20 hover:border-emerald-400/40')}
            >
              {dreaminaInstallResult.status === 'installing' ? (
                <><Loader2 className="w-3 h-3 animate-spin" />安装中...</>
              ) : (
                '自动安装'
              )}
            </Button>
          </div>

          {dreaminaInstallResult.message && (
            <div className={cn(
              'rounded-xl border px-3 py-2.5 text-xs whitespace-pre-wrap break-words',
              dreaminaInstallResult.status === 'success'
                ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
                : dreaminaInstallResult.status === 'error'
                  ? 'border-rose-400/28 bg-rose-500/12 text-rose-200'
                  : 'border-white/10 bg-white/[0.04] text-zinc-400'
            )}>
              {dreaminaInstallResult.status === 'success' ? <CheckCircle2 className="w-3 h-3 inline mr-1.5" /> : dreaminaInstallResult.status === 'error' ? <AlertCircle className="w-3 h-3 inline mr-1.5" /> : <Loader2 className="w-3 h-3 animate-spin inline mr-1.5" />}
              {dreaminaInstallResult.message}
            </div>
          )}

          <div data-tutorial-id="api-dreamina-auth" className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleDreaminaCheckLogin()}
              disabled={dreaminaLoginCheckResult.status === 'checking' && !dreaminaBrowserLoginLoading}
              className={cn(ACTION_BTN, 'h-7')}
            >
              {dreaminaLoginCheckResult.status === 'checking' && !dreaminaBrowserLoginLoading ? (
                <><Loader2 className="w-3 h-3 animate-spin" />检测中...</>
              ) : (
                '检测登录'
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleDreaminaBrowserLogin()}
              disabled={dreaminaBrowserLoginLoading}
              className={cn(ACTION_BTN, 'h-7', 'border-sky-400/25 hover:border-sky-400/45')}
            >
              {dreaminaBrowserLoginLoading ? (
                <><Loader2 className="w-3 h-3 animate-spin" />OAuth 登录中...</>
              ) : (
                <><ExternalLink className="w-3 h-3" />OAuth 登录</>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveDreaminaCli}
              className={cn(ACTION_BTN, 'h-7')}
            >
              保存配置
            </Button>
          </div>

          {(dreaminaOAuthInfo.userCode || dreaminaOAuthInfo.verificationUri) && (
            <div className="rounded-xl border border-sky-400/20 bg-sky-500/10 px-3 py-2.5 text-xs space-y-1.5">
              {dreaminaOAuthInfo.userCode && (
                <p className="text-sky-100">
                  设备码：<code className="text-sky-300 font-mono">{dreaminaOAuthInfo.userCode}</code>
                  （在授权页输入）
                </p>
              )}
              {dreaminaOAuthInfo.verificationUri && (
                <p className="text-sky-100 break-all">
                  授权页：
                  <button
                    type="button"
                    className="underline text-sky-300 hover:text-sky-200 ml-1"
                    onClick={() => void openDreaminaLoginUrl(dreaminaOAuthInfo.verificationUri!, getDreaminaLoginBrowserConfig())}
                  >
                    在浏览器中打开
                  </button>
                </p>
              )}
            </div>
          )}

          {dreaminaNeedsLogin && dreaminaLoginCheckResult.status === 'error' && (
            <p className="text-[9px] leading-relaxed text-amber-200/90">
              官方流程：dreamina login --headless 获取设备码 → 浏览器授权 → dreamina login checklogin 轮询。点击「OAuth 登录」可一键完成。
            </p>
          )}

          {dreaminaLoginCheckResult.message && (
            <div className={cn(
              'flex items-start gap-1.5 rounded-xl border px-3 py-2.5 text-xs whitespace-pre-wrap break-words',
              dreaminaLoginCheckResult.status === 'success'
                ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
                : dreaminaLoginCheckResult.status === 'error'
                  ? 'border-rose-400/28 bg-rose-500/12 text-rose-200'
                  : 'border-white/10 bg-white/[0.04] text-zinc-400'
            )}>
              {dreaminaLoginCheckResult.status === 'success' ? <CheckCircle2 className="w-3 h-3" /> : dreaminaLoginCheckResult.status === 'error' ? <AlertCircle className="w-3 h-3" /> : <Loader2 className="w-3 h-3 animate-spin" />}
              {dreaminaLoginCheckResult.message}
            </div>
          )}

          {testMessage && (
            <div className={cn(
              'flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs',
              testResult === 'success'
                ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
                : testResult === 'error'
                  ? 'border-rose-400/28 bg-rose-500/12 text-rose-200'
                  : 'border-white/10 bg-white/[0.04] text-zinc-400'
            )}>
              {testResult === 'success' ? <CheckCircle2 className="w-3 h-3" /> : testResult === 'error' ? <AlertCircle className="w-3 h-3" /> : null}
              {testMessage}
            </div>
          )}

          <div data-tutorial-id="api-dreamina-backends" className="space-y-2 border-t border-white/5 pt-3">
            <label className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              画布节点后端
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={tempDreaminaImageEnabled}
                onChange={(e) => setTempDreaminaImageEnabled(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/20 bg-white/[0.06] accent-emerald-400"
              />
              <span className="text-[10px] text-zinc-400">图片节点显示「即梦CLI」后端选项</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={tempDreaminaVideoEnabled}
                onChange={(e) => setTempDreaminaVideoEnabled(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/20 bg-white/[0.06] accent-emerald-400"
              />
              <span className="text-[10px] text-zinc-400">视频节点显示「即梦CLI」后端选项</span>
            </label>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-1.5">
            <p className="text-[9px] leading-relaxed text-zinc-500">
              官方 OAuth Device Flow：<code className="text-zinc-400">dreamina login --headless</code> → 浏览器输入设备码 →
              <code className="text-zinc-400"> checklogin --poll=30</code>。凭证保存在 <code className="text-zinc-400">~/.dreamina_cli/</code>。
            </p>
            <p className="text-[9px] leading-relaxed text-zinc-500">
              支持命令：
              <span className="text-zinc-400"> text2image</span> ·
              <span className="text-zinc-400"> text2video</span> ·
              <span className="text-zinc-400"> image2image</span> ·
              <span className="text-zinc-400"> image2video</span> ·
              <span className="text-zinc-400"> multimodal2video</span> ·
              <span className="text-zinc-400"> list_task</span> ·
              <span className="text-zinc-400"> query_result</span>
            </p>
            <p className="text-[9px] leading-relaxed text-zinc-600">
              安装后点「检测登录」；若未登录会自动引导浏览器授权。即梦 App 已登录不代表 CLI 已登录。<br />
              Agent 可通过 dreamina_text2image / dreamina_multimodal2video 等工具直接调用。
            </p>
          </div>
        </div>
      )}

      {/* Info text */}
      <p className="border-t border-white/10 pt-4 text-[10px] leading-relaxed text-zinc-500">
        {isDreaminaCliTab
          ? '即梦CLI 在服务端执行 dreamina 命令，通过本地登录会话鉴权。图片/视频节点可选择「即梦CLI」作为生成后端。'
          : isSubtitleRemovalTab
            ? '去字幕通过腾讯云 MPS 与 COS 执行。图片、视频和素材节点的原素材不会被覆盖，完成后会自动生成已连线的新素材节点。'
          : isEnhanceTab
          ? '画质提升：Topaz / Kie 超分 API，支持 credits 查询、Kie 临时文件上传和生成文件下载链接。'
          : activeTab === 'image'
            ? '图片节点根据所选模型自动路由到对应提供商 API。密钥仅存于本机浏览器。'
            : activeTab === 'video'
              ? '视频节点根据所选模型自动路由到对应提供商 API（Seedance / Kling / Veo / 本地 H3）。'
              : activeTab === 'llm'
                ? 'LLM 节点与 Agent 节点根据「LLM 路由」选择使用哪个提供商。默认来源在上方设置。'
                : '语音板块配置 TTS 引擎音色、本地 STT 状态。音乐板块配置音乐/音效生成。'}
      </p>
    </div>
  );
}
