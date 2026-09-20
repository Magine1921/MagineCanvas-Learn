'use client';

import { useState } from 'react';
import type { ApiCategory, ProviderConfig, AuthType } from './SeedanceStore';
import { getDefaultApiProfile, type ProviderApiProfile } from '@/lib/provider-api-profile';
import { ProviderApiProfileEditor } from './ProviderApiProfileEditor';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, X } from 'lucide-react';

interface CustomProviderFormProps {
  category: ApiCategory;
  onAdd: (providerId: string, config: ProviderConfig) => void;
  onCancel: () => void;
}

const FIELD_CLASS =
  'h-9 border-white/12 bg-[#080c10]/75 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:border-white/35 focus-visible:ring-1 focus-visible:ring-white/12';

export function CustomProviderForm({ category, onAdd, onCancel }: CustomProviderFormProps) {
  const [name, setName] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelIds, setModelIds] = useState('');
  const [authType, setAuthType] = useState<AuthType>('standard-bearer');
  const [purchaseUrl, setPurchaseUrl] = useState('');
  const [apiProfile, setApiProfile] = useState<ProviderApiProfile>(() => getDefaultApiProfile(category));

  const handleAdd = () => {
    if (!name.trim() || !apiUrl.trim() || !apiKey.trim()) return;
    const models = modelIds
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (models.length === 0) {
      models.push(name.trim().toLowerCase().replace(/\s+/g, '-'));
    }
    const providerId = `custom-${Date.now()}`;
    const config: ProviderConfig = {
      label: name.trim(),
      enabled: false,
      apiKey: apiKey.trim(),
      apiUrl: apiUrl.trim(),
      models,
      authType,
      purchaseUrl: purchaseUrl.trim() || undefined,
      apiProfile,
    };
    onAdd(providerId, config);
  };

  const isValid = name.trim() && apiUrl.trim() && apiKey.trim();

  return (
    <div className="rounded-xl border border-purple-400/20 bg-purple-500/[0.03] p-3 space-y-2.5 shadow-[0_0_20px_rgba(167,139,250,0.06)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-purple-300">添加自定义提供商</span>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-6 w-6 items-center justify-center rounded border border-white/10 text-zinc-500 hover:text-zinc-200 hover:border-white/25"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-[9px] text-zinc-500">名称</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：My Custom API"
          className={FIELD_CLASS}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-[9px] text-zinc-500">API 根地址</label>
        <Input
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          placeholder={
            category === 'llm'
              ? 'https://api.example.com/v1'
              : 'https://api.example.com'
          }
          className={FIELD_CLASS}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-[9px] text-zinc-500">API Key</label>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="粘贴 API Key"
          className={FIELD_CLASS}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-[9px] text-zinc-500">鉴权方式</label>
        <div className="flex gap-1.5 flex-wrap">
          {(['standard-bearer', 'volcengine-bearer', 'gemini-bearer', 'elevenlabs-api-key'] as AuthType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setAuthType(t)}
              className={cn(
                'rounded-md border px-2 py-1 text-[9px] transition-colors',
                authType === t
                  ? 'border-purple-400/30 bg-purple-500/15 text-purple-200'
                  : 'border-white/10 text-zinc-500 hover:border-white/20 hover:text-zinc-300'
              )}
            >
              {t === 'standard-bearer' ? 'Bearer' : t === 'volcengine-bearer' ? '火山 Bearer' : t === 'gemini-bearer' ? 'Gemini Bearer' : 'API Key Header'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[9px] text-zinc-500">模型 ID（逗号分隔）</label>
        <Input
          value={modelIds}
          onChange={(e) => setModelIds(e.target.value)}
          placeholder="model-v1, model-v2"
          className={FIELD_CLASS}
        />
      </div>

      <ProviderApiProfileEditor
        category={category}
        profile={apiProfile}
        onChange={setApiProfile}
        compact
      />

      <div className="space-y-1.5">
        <label className="text-[9px] text-zinc-500">购买链接（可选）</label>
        <Input
          value={purchaseUrl}
          onChange={(e) => setPurchaseUrl(e.target.value)}
          placeholder="https://example.com/billing"
          className={FIELD_CLASS}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={handleAdd}
          disabled={!isValid}
          className={cn(
            'h-8 flex-1 gap-1.5 border border-purple-400/25 bg-purple-500/10 text-xs text-purple-200 transition-all hover:border-purple-400/40 hover:bg-purple-500/20',
            'disabled:opacity-40 disabled:cursor-not-allowed'
          )}
        >
          <Plus className="h-3 w-3" />
          添加
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          className="h-8 flex-1 border border-white/10 bg-white/[0.04] text-xs text-zinc-400"
        >
          取消
        </Button>
      </div>
    </div>
  );
}
