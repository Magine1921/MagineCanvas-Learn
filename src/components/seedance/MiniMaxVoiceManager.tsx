'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { useSeedanceStore } from './SeedanceStore';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Upload,
  Mic,
  Wand2,
  Search,
  Trash2,
  Play,
  ChevronDown,
} from 'lucide-react';

interface MiniMaxVoiceManagerProps {
  apiKey: string;
  selectedVoiceId?: string;
  onSelectVoice: (voiceId: string) => void;
}

const FIELD_CLASS =
  'h-9 border-white/12 bg-[#080c10]/75 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:border-white/35 focus-visible:ring-1 focus-visible:ring-white/12';

const ACTION_BTN =
  'h-8 gap-1.5 border border-white/14 bg-white/[0.04] text-[10px] font-medium text-zinc-100 transition-all mc-dur-12f hover:border-white/28 hover:bg-white/[0.08] hover:text-zinc-50 hover:shadow-[0_0_16px_rgba(255,255,255,0.08)] disabled:cursor-not-allowed disabled:opacity-45';

type VoiceInfo = {
  voice_id: string;
  voice_name?: string;
  description?: string[];
  created_time?: string;
  demo_audio?: string;
};

type Section = 'clone' | 'design' | 'preset' | null;

export function MiniMaxVoiceManager({ apiKey, selectedVoiceId, onSelectVoice }: MiniMaxVoiceManagerProps) {
  const voiceHistory = useSeedanceStore((s) => s.config.voiceHistory);
  const addVoiceHistoryItem = useSeedanceStore((s) => s.addVoiceHistoryItem);
  const removeVoiceHistoryItem = useSeedanceStore((s) => s.removeVoiceHistoryItem);
  const [activeSection, setActiveSection] = useState<Section>(null);

  // ---- Clone state ----
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [clonePromptFile, setClonePromptFile] = useState<File | null>(null);
  const [clonePromptText, setClonePromptText] = useState('');
  const [cloneText, setCloneText] = useState('');
  const [cloneModel, setCloneModel] = useState('speech-2.8-hd');
  const [cloneLoading, setCloneLoading] = useState(false);
  const [cloneResult, setCloneResult] = useState<{ ok: boolean; message: string; demoAudio?: string } | null>(null);

  // ---- Design state ----
  const [designPrompt, setDesignPrompt] = useState('');
  const [designPreviewText, setDesignPreviewText] = useState('');
  const [designLoading, setDesignLoading] = useState(false);
  const [designResult, setDesignResult] = useState<{ ok: boolean; message: string; voiceId?: string; trialAudio?: ArrayBuffer } | null>(null);

  // ---- Query state ----
  const [voices, setVoices] = useState<{ system: VoiceInfo[]; cloning: VoiceInfo[]; generation: VoiceInfo[] } | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState('');

  // ---- Delete state ----
  const [deletingId, setDeletingId] = useState('');

  // ---- Preview state ----
  const [previewingId, setPreviewingId] = useState('');

  const proxyUrl = '/api/proxy/openai';
  const uploadProxyUrl = '/api/proxy/upload';

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip data:...;base64, prefix
        const base64 = result.includes(',') ? result.split(',')[1]! : result;
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  }

  function formatMiniMaxError(data: Record<string, unknown>): string {
    const baseResp = data.base_resp as { status_code?: number; status_msg?: string } | undefined;
    const code = baseResp?.status_code;
    const msg = baseResp?.status_msg || '';
    if (code === 1002) return `触发限流 (1002)：${msg || '请稍后再试'}`;
    if (code === 1004) return `鉴权失败 (1004)：${msg || '请检查 API Key 是否正确'}`;
    if (code === 1008) return `账户余额不足 (1008)：${msg || '请确认：1) 平台已完成实名认证 2) 账户余额≥2元（音色设计按量计费）。前往 platform.minimaxi.com 充值'}`;
    if (code === 2013) return `参数异常 (2013)：${msg || '请检查输入是否按要求填写'}`;
    if (code != null && code !== 0) return `错误码 ${code}：${msg || '未知错误'}`;
    return msg || '请求失败';
  }

  async function callMiniMax(endpoint: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Target-URL': `https://api.minimaxi.com${endpoint}`,
        'X-API-Key': apiKey.trim(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return data;
  }

  async function handleUploadFile(file: File, purpose: string): Promise<number | null> {
    const fileBase64 = await fileToBase64(file);

    const payload: Record<string, unknown> = {
      purpose,
      fileBase64,
      fileName: file.name,
      fileType: file.type || 'audio/mpeg',
    };

    const response = await fetch(uploadProxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Target-URL': 'https://api.minimaxi.com/v1/files/upload',
        'X-API-Key': apiKey.trim(),
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const baseResp = data.base_resp as { status_code?: number; status_msg?: string } | undefined;
    if (!response.ok || (baseResp && baseResp.status_code !== 0)) {
      throw new Error(formatMiniMaxError(data));
    }
    const fileObj = data.file as { file_id?: number } | undefined;
    return fileObj?.file_id ?? null;
  }

  // ---- Clone ----
  async function handleClone() {
    if (!cloneFile) {
      setCloneResult({ ok: false, message: '请选择要复刻的音频文件' });
      return;
    }

    const generatedVoiceId = `voice_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    setCloneLoading(true);
    setCloneResult(null);
    try {
      const fileId = await handleUploadFile(cloneFile, 'voice_clone');
      if (fileId == null) throw new Error('上传复刻音频失败，未获取到 file_id');

      let promptAudioId: number | null = null;
      if (clonePromptFile) {
        promptAudioId = await handleUploadFile(clonePromptFile, 'prompt_audio');
      }

      const body: Record<string, unknown> = {
        file_id: fileId,
        voice_id: generatedVoiceId,
      };
      if (promptAudioId != null && clonePromptText.trim()) {
        body.clone_prompt = { prompt_audio: promptAudioId, prompt_text: clonePromptText.trim() };
      }
      if (cloneText.trim()) {
        body.text = cloneText.trim();
        body.model = cloneModel;
      }

      const data = await callMiniMax('/v1/voice_clone', body);
      const baseResp = data.base_resp as { status_code?: number; status_msg?: string } | undefined;
      if (baseResp && baseResp.status_code !== 0) {
        throw new Error(formatMiniMaxError(data));
      }

      const demoAudio = typeof data.demo_audio === 'string' ? data.demo_audio : undefined;
      onSelectVoice(generatedVoiceId);
      addVoiceHistoryItem({
        voice_id: generatedVoiceId,
        source: 'clone',
        demo_audio: demoAudio,
        created_at: new Date().toISOString(),
      });
      setCloneResult({
        ok: true,
        message: `音色 ${generatedVoiceId} 复刻成功`,
        demoAudio,
      });
    } catch (e) {
      setCloneResult({ ok: false, message: e instanceof Error ? e.message : '复刻失败' });
    } finally {
      setCloneLoading(false);
    }
  }

  // ---- Design ----
  async function handleDesign() {
    if (!designPrompt.trim()) {
      setDesignResult({ ok: false, message: '请输入音色描述' });
      return;
    }
    if (!designPreviewText.trim()) {
      setDesignResult({ ok: false, message: '请输入试听文本' });
      return;
    }

    setDesignLoading(true);
    setDesignResult(null);
    try {
      const data = await callMiniMax('/v1/voice_design', {
        prompt: designPrompt.trim(),
        preview_text: designPreviewText.trim(),
      });
      const baseResp = data.base_resp as { status_code?: number; status_msg?: string } | undefined;
      if (baseResp && baseResp.status_code !== 0) {
        throw new Error(formatMiniMaxError(data));
      }

      const voiceId = typeof data.voice_id === 'string' ? data.voice_id : '';
      const trialHex = typeof data.trial_audio === 'string' ? data.trial_audio : undefined;

      let trialAudio: ArrayBuffer | undefined;
      if (trialHex) {
        const bytes = new Uint8Array(trialHex.length / 2);
        for (let i = 0; i < trialHex.length; i += 2) {
          bytes[i / 2] = parseInt(trialHex.substring(i, i + 2), 16);
        }
        trialAudio = bytes.buffer;
      }

      if (voiceId) onSelectVoice(voiceId);
      addVoiceHistoryItem({
        voice_id: voiceId || `design_${Date.now().toString(36)}`,
        source: 'design',
        demo_audio: trialAudio ? arrayBufferToBase64(trialAudio) : undefined,
        created_at: new Date().toISOString(),
      });
      setDesignResult({
        ok: true,
        message: voiceId ? `音色 ${voiceId} 设计成功` : '音色设计成功',
        voiceId: voiceId || undefined,
        trialAudio,
      });
    } catch (e) {
      setDesignResult({ ok: false, message: e instanceof Error ? e.message : '设计失败' });
    } finally {
      setDesignLoading(false);
    }
  }

  // ---- Query ----
  async function handleQuery() {
    setQueryLoading(true);
    setQueryError('');
    try {
      const data = await callMiniMax('/v1/get_voice', { voice_type: 'all' });

      const baseResp = data.base_resp as { status_code?: number; status_msg?: string } | undefined;
      if (baseResp && baseResp.status_code !== 0) {
        throw new Error(formatMiniMaxError(data));
      }

      const mapVoices = (arr: unknown): VoiceInfo[] => {
        if (!Array.isArray(arr)) return [];
        return arr.map((v: unknown) => {
          const item = v as Record<string, unknown>;
          return {
            voice_id: String(item.voice_id || ''),
            voice_name: typeof item.voice_name === 'string' ? item.voice_name : undefined,
            description: Array.isArray(item.description) ? item.description.map(String) : undefined,
            created_time: typeof item.created_time === 'string' ? item.created_time : undefined,
            demo_audio: typeof item.demo_audio === 'string' ? item.demo_audio : undefined,
          };
        });
      };

      setVoices({
        system: mapVoices(data.system_voice),
        cloning: mapVoices(data.voice_cloning),
        generation: mapVoices(data.voice_generation),
      });
    } catch (e) {
      setQueryError(e instanceof Error ? e.message : '查询失败');
    } finally {
      setQueryLoading(false);
    }
  }

  // ---- Delete ----
  async function handleDelete(voiceId: string, voiceType: 'voice_cloning' | 'voice_generation') {
    setDeletingId(voiceId);
    try {
      const data = await callMiniMax('/v1/delete_voice', { voice_id: voiceId, voice_type: voiceType });
      const baseResp = data.base_resp as { status_code?: number; status_msg?: string } | undefined;
      if (baseResp && baseResp.status_code !== 0) {
        throw new Error(formatMiniMaxError(data));
      }
      // Refresh
      void handleQuery();
    } catch (e) {
      setQueryError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeletingId('');
    }
  }

  // ---- Preview ----
  async function handlePreviewVoice(voiceId: string) {
    setPreviewingId(voiceId);
    try {
      const data = await callMiniMax('/v1/t2a_v2', {
        model: 'speech-2.8-hd',
        text: '你好，这是音色试听。',
        stream: false,
        voice_setting: { voice_id: voiceId },
      });
      const baseResp = data.base_resp as { status_code?: number; status_msg?: string } | undefined;
      if (baseResp && baseResp.status_code !== 0) {
        throw new Error(formatMiniMaxError(data));
      }
      const audioHex = typeof data.data === 'object' && data.data ? (data.data as Record<string, unknown>).audio : undefined;
      if (typeof audioHex === 'string' && audioHex) {
        playHexAudio(audioHex);
      } else if (typeof (data as Record<string, unknown>).audio === 'string') {
        playHexAudio((data as Record<string, unknown>).audio as string);
      } else {
        throw new Error('未获取到试听音频');
      }
    } catch (e) {
      setQueryError(e instanceof Error ? e.message : '试听失败');
    } finally {
      setPreviewingId('');
    }
  }

  function playHexAudio(hex: string) {
    try {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
      }
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play().catch(() => {});
    } catch { /* noop */ }
  }

  function playBufferAudio(buf: ArrayBuffer) {
    try {
      const blob = new Blob([buf], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play().catch(() => {});
    } catch { /* noop */ }
  }

  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
  }

  function playBase64Audio(base64: string) {
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play().catch(() => {});
    } catch { /* noop */ }
  }

  return (
    <div className="space-y-2 border-t border-white/5 pt-2.5">
      <label className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
        <Mic className="h-2.5 w-2.5" />
        音色管理（MiniMax）
      </label>

      {/* Section toggles */}
      <div className="flex flex-wrap gap-1">
        {([
          ['clone', '音色复刻', Upload],
          ['design', '音色设计', Wand2],
          ['preset', '预设音色', Search],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveSection(activeSection === key ? null : key)}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] transition-colors',
              activeSection === key
                ? 'border-sky-400/30 bg-sky-500/10 text-sky-200'
                : 'border-white/10 bg-white/[0.03] text-zinc-500 hover:border-white/18 hover:text-zinc-300',
            )}
          >
            <Icon className="h-2.5 w-2.5" />
            {label}
            <ChevronDown className={cn('h-2.5 w-2.5 transition-transform', activeSection === key && 'rotate-180')} />
          </button>
        ))}
      </div>

      {/* ---- Clone section ---- */}
      {activeSection === 'clone' && (
        <div className="space-y-2 rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
          <div className="space-y-1.5">
            <label className="text-[8px] text-zinc-500">上传复刻音频（mp3/m4a/wav，10s-5min，≤20MB）</label>
            <input
              type="file"
              accept="audio/mp3,audio/mpeg,audio/m4a,audio/wav,audio/x-wav"
              onChange={(e) => setCloneFile(e.target.files?.[0] || null)}
              className="text-[10px] text-zinc-400 file:mr-2 file:rounded file:border file:border-white/10 file:bg-white/[0.04] file:px-2 file:py-1 file:text-[10px] file:text-zinc-200"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[8px] text-zinc-500">示例音频（可选，&lt;8s，用于增强相似度）</label>
            <input
              type="file"
              accept="audio/mp3,audio/mpeg,audio/m4a,audio/wav,audio/x-wav"
              onChange={(e) => setClonePromptFile(e.target.files?.[0] || null)}
              className="text-[10px] text-zinc-400 file:mr-2 file:rounded file:border file:border-white/10 file:bg-white/[0.04] file:px-2 file:py-1 file:text-[10px] file:text-zinc-200"
            />
            {clonePromptFile && (
              <Input
                value={clonePromptText}
                onChange={(e) => setClonePromptText(e.target.value)}
                placeholder="示例音频对应的文本内容"
                className={cn(FIELD_CLASS, 'h-7')}
              />
            )}
          </div>

          <div className="flex gap-2">
            <div className="flex-1 space-y-1.5">
              <label className="text-[8px] text-zinc-500">试听文本</label>
              <Input
                value={cloneText}
                onChange={(e) => setCloneText(e.target.value)}
                placeholder="试听文本（≤1000字符）"
                className={cn(FIELD_CLASS, 'h-7')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[8px] text-zinc-500">模型选择</label>
            <Select value={cloneModel} onValueChange={(v) => v && setCloneModel(v)} className={cn(FIELD_CLASS, 'h-7', 'w-40')}>
              <SelectItem value="speech-2.8-hd">speech-2.8-hd</SelectItem>
              <SelectItem value="speech-2.8-turbo">speech-2.8-turbo</SelectItem>
              <SelectItem value="speech-2.6-hd">speech-2.6-hd</SelectItem>
              <SelectItem value="speech-2.6-turbo">speech-2.6-turbo</SelectItem>
            </Select>
          </div>

          {/* Clone history */}
          {voiceHistory.filter((v) => v.source === 'clone').length > 0 && (
            <div className="space-y-1 border-t border-white/5 pt-2">
              <label className="text-[8px] font-medium text-zinc-500">历史复刻音色</label>
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {voiceHistory.filter((v) => v.source === 'clone').map((v) => (
                  <div
                    key={v.voice_id}
                    className="flex items-center gap-2 rounded-md border border-white/6 bg-white/[0.02] px-2 py-1"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[8px] text-zinc-300 truncate">{v.voice_id}</div>
                      <div className="text-[7px] text-zinc-500">{new Date(v.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    {v.demo_audio && (
                      <button type="button" onClick={() => playBase64Audio(v.demo_audio!)} className="shrink-0 rounded border border-white/10 px-1 py-0.5 text-[7px] text-zinc-400 hover:border-amber-400/30 hover:text-amber-200 transition-colors">
                        <Play className="h-2.5 w-2.5" />
                      </button>
                    )}
                    <button type="button" onClick={() => onSelectVoice(v.voice_id)} className="shrink-0 rounded border border-white/10 px-1 py-0.5 text-[7px] text-zinc-400 hover:border-sky-400/30 hover:text-sky-200 transition-colors">{selectedVoiceId === v.voice_id ? '选用中' : '选用'}</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button
            size="sm" variant="outline" onClick={handleClone} disabled={cloneLoading}
            className={cn(ACTION_BTN, 'h-7')}
          >
            {cloneLoading ? <><Loader2 className="w-3 h-3 animate-spin" />复刻中...</> : '开始复刻'}
          </Button>

          {cloneResult && (
            <div className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px]',
              cloneResult.ok ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200' : 'border-rose-400/28 bg-rose-500/12 text-rose-200',
            )}>
              {cloneResult.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
              {cloneResult.message}
              {cloneResult.demoAudio && (
                <button type="button" onClick={() => playHexAudio(cloneResult.demoAudio!)} className="ml-auto flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[8px] hover:border-white/20">
                  <Play className="h-2.5 w-2.5" />试听
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- Design section ---- */}
      {activeSection === 'design' && (
        <div className="space-y-2 rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
          <div className="space-y-1.5">
            <label className="text-[8px] text-zinc-500">音色描述（描述你想要的声音特征）</label>
            <Input
              value={designPrompt}
              onChange={(e) => setDesignPrompt(e.target.value)}
              placeholder="如：讲述悬疑故事的播音员，声音低沉富有磁性"
              className={FIELD_CLASS}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[8px] text-zinc-500">试听文本（将产生 2 元/万字符的费用）</label>
            <Input
              value={designPreviewText}
              onChange={(e) => setDesignPreviewText(e.target.value)}
              placeholder="用于试听合成的声音文本"
              className={FIELD_CLASS}
            />
          </div>

          {/* Design history */}
          {voiceHistory.filter((v) => v.source === 'design').length > 0 && (
            <div className="space-y-1 border-t border-white/5 pt-2">
              <label className="text-[8px] font-medium text-zinc-500">历史设计音色</label>
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {voiceHistory.filter((v) => v.source === 'design').map((v) => (
                  <div
                    key={v.voice_id}
                    className="flex items-center gap-2 rounded-md border border-white/6 bg-white/[0.02] px-2 py-1"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[8px] text-zinc-300 truncate">{v.voice_id}</div>
                      <div className="text-[7px] text-zinc-500">{new Date(v.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    {v.demo_audio && (
                      <button type="button" onClick={() => playBase64Audio(v.demo_audio!)} className="shrink-0 rounded border border-white/10 px-1 py-0.5 text-[7px] text-zinc-400 hover:border-amber-400/30 hover:text-amber-200 transition-colors">
                        <Play className="h-2.5 w-2.5" />
                      </button>
                    )}
                    <button type="button" onClick={() => onSelectVoice(v.voice_id)} className="shrink-0 rounded border border-white/10 px-1 py-0.5 text-[7px] text-zinc-400 hover:border-sky-400/30 hover:text-sky-200 transition-colors">{selectedVoiceId === v.voice_id ? '选用中' : '选用'}</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="outline" onClick={handleDesign} disabled={designLoading}
              className={cn(ACTION_BTN, 'h-7')}
            >
              {designLoading ? <><Loader2 className="w-3 h-3 animate-spin" />生成中...</> : '生成音色'}
            </Button>
            <a
              href="https://platform.minimaxi.com/user-center/basic-information/interface-key"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-[8px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              充值 →
            </a>
          </div>

          {designResult && (
            <div className="space-y-1.5">
              <div className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px]',
                designResult.ok ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200' : 'border-rose-400/28 bg-rose-500/12 text-rose-200',
              )}>
                {designResult.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                {designResult.message}
                {designResult.trialAudio && (
                  <button type="button" onClick={() => playBufferAudio(designResult.trialAudio!)} className="ml-auto flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[8px] hover:border-white/20">
                    <Play className="h-2.5 w-2.5" />试听
                  </button>
                )}
              </div>
              {!designResult.ok && designResult.message.includes('余额不足') && (
                <a
                  href="https://platform.minimaxi.com/user-center/basic-information/interface-key"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[8px] text-sky-300/80 hover:text-sky-200 transition-colors"
                >
                  前往 MiniMax 平台充值 →
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- Preset section ---- */}
      {activeSection === 'preset' && (
        <div className="space-y-2 rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
          <Button
            size="sm" variant="outline" onClick={handleQuery} disabled={queryLoading}
            className={cn(ACTION_BTN, 'h-7')}
          >
            {queryLoading ? <><Loader2 className="w-3 h-3 animate-spin" />查询中...</> : '刷新列表'}
          </Button>

          {queryError && (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-400/28 bg-rose-500/12 px-2.5 py-2 text-[10px] text-rose-200">
              <AlertCircle className="w-3 h-3" />{queryError}
            </div>
          )}

          {voices && (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {(['system', 'cloning', 'generation'] as const).map((type) => {
                const items = type === 'system' ? voices.system : type === 'cloning' ? voices.cloning : voices.generation;
                if (items.length === 0) return null;
                const label = type === 'system' ? '系统音色' : type === 'cloning' ? '克隆音色' : '设计音色';
                return (
                  <div key={type} className="space-y-1">
                    <span className="text-[8px] font-medium text-zinc-500">{label}</span>
                    {items.map((v) => (
                      <div
                        key={v.voice_id}
                        className="flex items-center gap-2 rounded-md border border-white/6 bg-white/[0.02] px-2 py-1.5"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[9px] text-zinc-200 truncate">{v.voice_id}</div>
                          {v.voice_name && <div className="text-[8px] text-zinc-500 truncate">{v.voice_name}</div>}
                          {v.description && v.description.length > 0 && (
                            <div className="text-[7px] text-zinc-600 truncate">{v.description[0]}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handlePreviewVoice(v.voice_id)}
                          disabled={previewingId === v.voice_id}
                          className="shrink-0 rounded border border-white/10 px-1 py-0.5 text-[7px] text-zinc-400 hover:border-amber-400/30 hover:text-amber-200 transition-colors"
                        >
                          {previewingId === v.voice_id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Play className="h-2.5 w-2.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectVoice(v.voice_id)}
                          className="shrink-0 rounded border border-white/10 px-1 py-0.5 text-[7px] text-zinc-400 hover:border-sky-400/30 hover:text-sky-200 transition-colors"
                        >
                          {selectedVoiceId === v.voice_id ? '选用中' : '选用'}
                        </button>
                        {type !== 'system' && (
                          <button
                            type="button"
                            onClick={() => handleDelete(v.voice_id, type === 'cloning' ? 'voice_cloning' : 'voice_generation')}
                            disabled={deletingId === v.voice_id}
                            className="shrink-0 rounded border border-red-400/15 px-1 py-0.5 text-[7px] text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            {deletingId === v.voice_id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Trash2 className="h-2.5 w-2.5" />}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!apiKey.trim() && (
        <p className="text-[8px] text-zinc-600">请先在 MiniMax 音频提供商区块中填写 API Key 后再使用音色管理功能。</p>
      )}
    </div>
  );
}
