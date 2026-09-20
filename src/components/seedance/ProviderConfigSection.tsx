'use client';

import { useState } from 'react';
import type { ApiCategory, ProviderConfig, ProviderTokenBucket } from './SeedanceStore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Key,
  Globe,
  ChevronDown,
  Trash2,
  Mic,
} from 'lucide-react';
import { getDefaultApiProfile, type ProviderApiProfile } from '@/lib/provider-api-profile';
import { ProviderApiProfileEditor } from './ProviderApiProfileEditor';

// 模型友好名称映射（技术名 → UI 标签）
const friendlyModelNames: Record<string, string> = {
  'doubao-seedance-2.0': 'Seedance 2.0',
  'doubao-seedance-2.0-fast': 'Seedance 2.0 Fast',
  'doubao-seedance-2-0-260128': 'Seedance 2.0',
  'doubao-seedance-2-0-fast-260128': 'Seedance 2.0 Fast',
};

// 获取模型的友好名称
function getFriendlyModelName(model: string): string {
  return friendlyModelNames[model] || model;
}

interface ProviderConfigSectionProps {
  category: ApiCategory;
  providerId: string;
  config: ProviderConfig;
  tokenBucket?: ProviderTokenBucket;
  isCustom?: boolean;
  onSave: (providerId: string, config: ProviderConfig) => void;
  onTest: (providerId: string, config: ProviderConfig) => Promise<{ ok: boolean; message: string }>;
  onRemove?: (providerId: string) => void;
}

const FIELD_CLASS =
  'h-9 border-white/12 bg-[#080c10]/75 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:border-white/35 focus-visible:ring-1 focus-visible:ring-white/12';

const ACTION_BTN =
  'h-8 flex-1 gap-1.5 border border-white/14 bg-white/[0.04] text-[10px] font-medium text-zinc-100 transition-all mc-dur-12f hover:border-white/28 hover:bg-white/[0.08] hover:text-zinc-50 hover:shadow-[0_0_16px_rgba(255,255,255,0.08)] disabled:cursor-not-allowed disabled:opacity-45';

export function ProviderConfigSection({
  category,
  providerId,
  config,
  tokenBucket,
  isCustom,
  onSave,
  onTest,
  onRemove,
}: ProviderConfigSectionProps) {
  const [open, setOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState(config.apiUrl);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [voiceId, setVoiceId] = useState(config.voiceId || '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [testMessage, setTestMessage] = useState('');
  const [apiProfile, setApiProfile] = useState<ProviderApiProfile>(
    () => config.apiProfile || getDefaultApiProfile(category),
  );

  // Kling JWT: split combined apiKey back into AK/SK for editing, with optional direct API Key fallback
  const isKlingJwt = config.authType === 'kling-jwt';
  const [klingAk, setKlingAk] = useState(() => {
    if (!isKlingJwt) return '';
    const idx = config.apiKey.indexOf(':');
    return idx >= 0 ? config.apiKey.slice(0, idx) : '';
  });
  const [klingSk, setKlingSk] = useState(() => {
    if (!isKlingJwt) return '';
    const idx = config.apiKey.indexOf(':');
    return idx >= 0 ? config.apiKey.slice(idx + 1) : '';
  });
  const [klingApiKey, setKlingApiKey] = useState(() => {
    if (!isKlingJwt) return '';
    // If the stored apiKey doesn't contain ':', it's a raw API Key/JWT
    return config.apiKey.includes(':') ? '' : config.apiKey;
  });

  // effectiveApiKey: AK:SK for JWT generation, or raw API Key as fallback
  const effectiveApiKey = isKlingJwt
    ? (klingAk || klingSk ? `${klingAk}:${klingSk}` : klingApiKey)
    : apiKey;
  const isConfigured = !!config.enabled && !!effectiveApiKey;
  const quotaUnit = /api\.kie\.ai/i.test(apiUrl) || /^kie-/i.test(providerId)
    ? 'credits'
    : 'token';

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestMessage('测试连接中...');
    try {
      const result = await onTest(providerId, {
        ...config,
        apiUrl,
        apiKey: effectiveApiKey,
        voiceId,
        apiProfile,
      });
      setTestResult(result.ok ? 'success' : 'error');
      setTestMessage(result.message);
    } catch (e) {
      setTestResult('error');
      setTestMessage(e instanceof Error ? e.message : '连接失败');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    onSave(providerId, {
      ...config,
      apiUrl,
      apiKey: effectiveApiKey,
      voiceId,
      apiProfile,
      enabled: true,
    });
    setTestResult('success');
    setTestMessage('配置已保存');
  };

  return (
    <div
      data-tutorial-id="api-provider-card"
      className="rounded-xl border border-white/10 bg-white/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_28px_rgba(255,255,255,0.05)]"
    >
      {/* Header - click to toggle */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[11px] font-medium text-zinc-200 truncate">{config.label}</span>
          {isCustom && (
            <span className="shrink-0 rounded border border-purple-400/25 bg-purple-500/10 px-1 py-0.5 text-[8px] text-purple-300">自定义</span>
          )}
          {isConfigured && !isCustom && (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]" />
          )}
        </div>
        {isCustom && onRemove && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(providerId); }}
            className="shrink-0 flex items-center justify-center h-6 w-6 rounded border border-red-400/15 bg-red-500/5 text-red-400 hover:bg-red-500/15 hover:border-red-400/30 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform mc-dur-12f',
            open && 'rotate-180'
          )}
        />
      </button>

      {/* Body */}
      {open && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-white/5 pt-2.5">
          {config.description && (
            <p className="text-[9px] leading-relaxed text-zinc-500">{config.description}</p>
          )}

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
              <Globe className="h-2.5 w-2.5" />
              API 地址
            </label>
            <Input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder={config.apiUrl || 'https://api.example.com'}
              className={FIELD_CLASS}
            />
          </div>

          {isKlingJwt ? (
            <>
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                  <Key className="h-2.5 w-2.5" />
                  AccessKey
                </label>
                <Input
                  type="password"
                  value={klingAk}
                  onChange={(e) => setKlingAk(e.target.value)}
                  placeholder="粘贴 AccessKey"
                  className={FIELD_CLASS}
                />
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                  <Key className="h-2.5 w-2.5" />
                  SecretKey
                </label>
                <Input
                  type="password"
                  value={klingSk}
                  onChange={(e) => setKlingSk(e.target.value)}
                  placeholder="粘贴 SecretKey"
                  className={FIELD_CLASS}
                />
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                  <Key className="h-2.5 w-2.5" />
                  API Key（选填，直接使用 JWT Token 时填写）
                </label>
                <Input
                  type="password"
                  value={klingApiKey}
                  onChange={(e) => setKlingApiKey(e.target.value)}
                  placeholder="或直接粘贴 JWT Token"
                  className={FIELD_CLASS}
                />
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                <Key className="h-2.5 w-2.5" />
                API Key
              </label>
              <Input
                type="password"
                data-tutorial-id="api-provider-key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="粘贴 API Key"
                className={FIELD_CLASS}
              />
            </div>
          )}

          {category === 'audio' && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                <Mic className="h-2.5 w-2.5" />
                音色ID（可选）
              </label>
              <Input
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                placeholder="粘贴音色 ID，如 MFxKeOpi..."
                className={FIELD_CLASS}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
              模型
            </label>
            <div className="flex flex-wrap gap-1">
              {config.models.map((m) => (
                <span
                  key={m}
                  className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[8px] text-zinc-400"
                >
                  {getFriendlyModelName(m)}
                </span>
              ))}
            </div>
          </div>

          {isCustom ? (
            <ProviderApiProfileEditor
              category={category}
              profile={apiProfile}
              onChange={setApiProfile}
              compact
            />
          ) : null}

          {tokenBucket && (
            <div className="space-y-1.5 border-t border-white/5 pt-2.5">
              <label className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                {quotaUnit === 'credits' ? '剩余 credits / 积分（可选）' : '剩余额度（可选）'}
              </label>
              <Input
                type="text"
                value={tokenBucket.remainingTokens != null ? String(tokenBucket.remainingTokens) : ''}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  // Handled by parent via onSave; just display here
                }}
                placeholder="填写额度，用于本地估算"
                className={FIELD_CLASS}
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[8px] text-zinc-500/90">
                <span>已记录消耗: {tokenBucket.usedTokens.toLocaleString()} {quotaUnit}</span>
                <span>
                  估算剩余:{' '}
                  {tokenBucket.remainingTokens == null
                    ? '未设置'
                    : Math.max(0, tokenBucket.remainingTokens - tokenBucket.usedTokens).toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {testMessage && (
            <div
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px]',
                testResult === 'success'
                  ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
                  : testResult === 'error'
                    ? 'border-rose-400/28 bg-rose-500/12 text-rose-200'
                    : 'border-white/10 bg-white/[0.04] text-zinc-400'
              )}
            >
              {testResult === 'success' ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : testResult === 'error' ? (
                <AlertCircle className="w-3 h-3" />
              ) : null}
              {testMessage}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              data-tutorial-id="api-provider-test"
              onClick={handleTest}
              disabled={testing || !effectiveApiKey.trim()}
              className={cn(ACTION_BTN)}
            >
              {testing ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  测试中...
                </>
              ) : (
                '测试连接'
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-tutorial-id="api-provider-save"
              onClick={handleSave}
              disabled={!effectiveApiKey.trim()}
              className={cn(ACTION_BTN)}
            >
              保存配置
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
