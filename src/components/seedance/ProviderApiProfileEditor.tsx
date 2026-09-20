'use client';

import type { ApiCategory, ProviderConfig } from '@/components/seedance/SeedanceStore';
import {
  getDefaultApiProfile,
  PROVIDER_API_PRESET_LABELS,
  type ProviderApiPreset,
  type ProviderApiProfile,
} from '@/lib/provider-api-profile';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

const FIELD_CLASS =
  'h-8 border-white/12 bg-[#080c10]/75 text-[10px] text-zinc-100 placeholder:text-zinc-600 focus-visible:border-white/35 focus-visible:ring-1 focus-visible:ring-white/12';

interface ProviderApiProfileEditorProps {
  category: ApiCategory;
  profile: ProviderApiProfile | undefined;
  onChange: (profile: ProviderApiProfile) => void;
  compact?: boolean;
}

export function ProviderApiProfileEditor({
  category,
  profile,
  onChange,
  compact,
}: ProviderApiProfileEditorProps) {
  const defaults = getDefaultApiProfile(category);
  const merged: ProviderApiProfile = {
    ...defaults,
    ...profile,
    endpoints: { ...defaults.endpoints, ...profile?.endpoints },
    response: { ...defaults.response, ...profile?.response },
  };
  const preset = merged.preset || defaults.preset || 'openai-v1';
  const isCustom = preset === 'custom';

  const patch = (next: Partial<ProviderApiProfile>) => {
    onChange({
      ...merged,
      ...next,
      endpoints: { ...merged.endpoints, ...next.endpoints },
      response: { ...merged.response, ...next.response },
    });
  };

  return (
    <div className={cn('space-y-2 rounded-lg border border-purple-400/15 bg-purple-500/[0.03] p-2.5', compact && 'p-2')}>
      <div className="text-[9px] font-medium text-purple-200/90">API 契约（端点与响应映射）</div>

      <div className="space-y-1">
        <label className="text-[9px] text-zinc-500">路径预设</label>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(PROVIDER_API_PRESET_LABELS) as ProviderApiPreset[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => patch({ preset: value })}
              className={cn(
                'rounded-md border px-2 py-1 text-[8px] transition-colors',
                preset === value
                  ? 'border-purple-400/35 bg-purple-500/15 text-purple-100'
                  : 'border-white/10 text-zinc-500 hover:border-white/20',
              )}
            >
              {PROVIDER_API_PRESET_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      {isCustom ? (
        <div className="grid gap-1.5">
          {(category === 'llm' || category === 'audio') && (
            <ProfileField
              label="Chat 路径"
              placeholder="{base}/v1/chat/completions"
              value={merged.endpoints?.chat || ''}
              onChange={(chat) => patch({ endpoints: { chat } })}
            />
          )}
          {(category === 'image' || category === 'llm') && (
            <ProfileField
              label="图片路径"
              placeholder="{base}/v1/images/generations"
              value={merged.endpoints?.image || ''}
              onChange={(image) => patch({ endpoints: { image } })}
            />
          )}
          {(category === 'video' || category === 'llm') && (
            <>
              <ProfileField
                label="视频提交"
                placeholder="{base}/v1/video/generation"
                value={merged.endpoints?.videoSubmit || ''}
                onChange={(videoSubmit) => patch({ endpoints: { videoSubmit } })}
              />
              <ProfileField
                label="视频轮询"
                placeholder="{base}/v1/video/query?task_id={task_id}"
                value={merged.endpoints?.videoPoll || ''}
                onChange={(videoPoll) => patch({ endpoints: { videoPoll } })}
              />
            </>
          )}
          <ProfileField
            label="测试/Models"
            placeholder="{base}/v1/models"
            value={merged.endpoints?.models || ''}
            onChange={(models) => patch({ endpoints: { models } })}
          />
        </div>
      ) : null}

      <details className="text-[9px] text-zinc-500">
        <summary className="cursor-pointer select-none text-zinc-400 hover:text-zinc-200">
          高级：响应字段映射（JSON 路径）
        </summary>
        <div className="mt-1.5 grid gap-1.5">
          {(category === 'image' || category === 'llm') && (
            <ProfileField
              label="图片 URL"
              placeholder="data[*].url, url"
              value={(merged.response?.imageUrls || []).join(', ')}
              onChange={(raw) =>
                patch({
                  response: {
                    imageUrls: raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
                  },
                })
              }
            />
          )}
          {category === 'video' && (
            <>
              <ProfileField
                label="taskId"
                placeholder="task_id, data.task_id"
                value={(merged.response?.taskId || []).join(', ')}
                onChange={(raw) =>
                  patch({
                    response: {
                      taskId: raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
                    },
                  })
                }
              />
              <ProfileField
                label="videoUrl"
                placeholder="video_url, data.video_url"
                value={(merged.response?.videoUrl || []).join(', ')}
                onChange={(raw) =>
                  patch({
                    response: {
                      videoUrl: raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
                    },
                  })
                }
              />
              <ProfileField
                label="成功状态值"
                placeholder="succeed, success, completed"
                value={(merged.videoSuccessStatuses || []).join(', ')}
                onChange={(raw) =>
                  patch({
                    videoSuccessStatuses: raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </>
          )}
          {category === 'llm' && (
            <div className="flex gap-1 pt-0.5">
              {(['openai', 'minimax'] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => patch({ llmBodyStyle: style })}
                  className={cn(
                    'rounded border px-2 py-0.5 text-[8px]',
                    merged.llmBodyStyle === style
                      ? 'border-purple-400/35 bg-purple-500/15 text-purple-100'
                      : 'border-white/10 text-zinc-500',
                  )}
                >
                  {style === 'openai' ? 'OpenAI body' : 'MiniMax body'}
                </button>
              ))}
            </div>
          )}
        </div>
      </details>

      <p className="text-[8px] leading-relaxed text-zinc-600">
        {'{base}'} = API 根地址；{'{task_id}'} = 任务 ID。自定义域名需由管理员加入服务端代理白名单。
      </p>
    </div>
  );
}

function ProfileField(props: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      <label className="text-[8px] text-zinc-500">{props.label}</label>
      <Input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className={FIELD_CLASS}
      />
    </div>
  );
}

export function mergeProviderApiProfile(
  provider: ProviderConfig,
  category: ApiCategory,
  profile?: ProviderApiProfile,
): ProviderConfig {
  return {
    ...provider,
    apiProfile: profile ?? provider.apiProfile ?? getDefaultApiProfile(category),
  };
}
