'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchGeminiModelsFromApi, mergeGeminiModelLists } from '@/lib/gemini-models-list';
import { GeminiModelSelect } from '@/components/ui/GeminiModelSelect';

export interface MultimodalGeminiModelSelectProps {
  apiKey: string;
  apiUrl: string;
  value: string;
  onValueChange: (next: string) => void;
  className?: string;
  disabled?: boolean;
}

export function MultimodalGeminiModelSelect({
  apiKey,
  apiUrl,
  value,
  onValueChange,
  className,
  disabled,
}: MultimodalGeminiModelSelectProps) {
  const [mergedIds, setMergedIds] = useState<string[]>(() => mergeGeminiModelLists([]));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const key = apiKey.trim();
    if (!key) {
      setMergedIds(mergeGeminiModelLists([]));
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    fetchGeminiModelsFromApi({ apiKey: key, apiUrl, signal: ac.signal })
      .then((api) => setMergedIds(mergeGeminiModelLists(api)))
      .catch(() => setMergedIds(mergeGeminiModelLists([])))
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [apiKey, apiUrl]);

  const hint = useMemo(() => {
    if (!apiKey.trim()) return '填写 API Key 后将尝试从 Google 拉取可用模型并合并到列表';
    if (loading) return '正在拉取模型列表…';
    return '已合并 API 返回与内置模型；若列表为空请检查 Key 与代理';
  }, [apiKey, loading]);

  return (
    <div className="space-y-1.5">
      <GeminiModelSelect
        modelIds={mergedIds}
        value={value}
        onValueChange={onValueChange}
        className={className}
        disabled={disabled || !apiKey.trim()}
      />
      <p className="text-[9px] leading-relaxed text-zinc-500">{hint}</p>
    </div>
  );
}
