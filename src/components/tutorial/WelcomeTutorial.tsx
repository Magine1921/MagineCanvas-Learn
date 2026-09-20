'use client';

import {
  Check,
  ChevronLeft,
  FolderOpen,
  GraduationCap,
  Lightbulb,
  LocateFixed,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { VoiceAssistantWaveStrip } from '@/components/voice/VoiceAssistantWaveStrip';
import { useTutorialAudio } from './useTutorialAudio';

type WelcomeTutorialTarget =
  | 'welcome-brand'
  | 'welcome-primary-actions'
  | 'welcome-workspace-panels'
  | 'welcome-api-config'
  | 'api-config-tabs'
  | 'api-config-tabs-scroll'
  | 'api-config-tab-image'
  | 'api-config-tab-audio'
  | 'api-config-tab-dreamina-cli'
  | 'api-provider-card'
  | 'api-provider-key'
  | 'api-provider-test'
  | 'api-provider-save'
  | 'api-audio-assistant'
  | 'api-audio-panel-voice'
  | 'api-audio-panel-music'
  | 'api-audio-voice-tab-full'
  | 'api-audio-voice-tab-tts'
  | 'api-audio-voice-tab-stt'
  | 'api-audio-voice-api'
  | 'api-audio-voice-tts'
  | 'api-audio-voice-stt'
  | 'api-audio-music'
  | 'api-dreamina-install'
  | 'api-dreamina-browser'
  | 'api-dreamina-auth'
  | 'api-dreamina-backends';

type WelcomeTutorialAction = 'manual' | 'click' | 'scroll';

type WelcomeTutorialStep = {
  id: string;
  title: string;
  description: string;
  target?: WelcomeTutorialTarget;
  icon: LucideIcon;
  tip?: string;
  action?: WelcomeTutorialAction;
  audioId?: string;
  requiresApiConfig?: boolean;
  highlight?: boolean;
};

const STORAGE_KEY = 'magine-welcome-tutorial-step-v2';

const STEPS: WelcomeTutorialStep[] = [
  {
    id: 'intro',
    title: '欢迎使用 Magine Canvas',
    description: '这里是项目欢迎页。你可以创建新画布、打开已有工程，也可以从最近项目继续上一次创作。',
    target: 'welcome-brand',
    highlight: false,
    icon: GraduationCap,
  },
  {
    id: 'projects',
    title: '创建或打开画布',
    description: '“新建画布”用于创建新的无限画布；“打开文件”用于导入本机已有的工程文件。教学不会替你点击，避免意外创建或覆盖项目。',
    target: 'welcome-primary-actions',
    icon: FolderOpen,
    tip: '首次使用建议从“新建画布”开始。',
  },
  {
    id: 'workspace',
    title: '灵感与最近项目',
    description: '右侧可以记录临时灵感并查看最近项目。点击项目即可继续编辑，右键项目可以重命名、复制或删除。',
    target: 'welcome-workspace-panels',
    icon: Sparkles,
    tip: '窄屏设备会自动隐藏部分辅助面板，不影响新建和打开画布。',
  },
  {
    id: 'api-intro',
    title: '认识 API 配置',
    description: 'API 配置用于管理图片、画质提升、视频、LLM、语音/音乐和即梦 CLI。密钥只保存在本机。',
    target: 'welcome-api-config',
    icon: Settings2,
    audioId: 'api-configuration.intro',
    tip: '接下来直接在欢迎页完成模型服务配置教学。',
  },
  {
    id: 'api-open',
    title: '打开 API 配置',
    description: '点击屏幕右上角的“API配置”，打开模型服务设置。',
    target: 'welcome-api-config',
    icon: Settings2,
    action: 'click',
    audioId: 'api-configuration.open',
  },
  {
    id: 'api-category',
    title: '选择模型分类',
    description: '点击“图片”分类。视频、LLM 和语音/音乐的配置方式与此相同。',
    target: 'api-config-tab-image',
    icon: Settings2,
    action: 'click',
    audioId: 'api-configuration.category',
    requiresApiConfig: true,
  },
  {
    id: 'api-provider',
    title: '展开模型厂商',
    description: '查看高亮的模型厂商卡片。如果卡片处于收起状态，点击厂商名称展开，然后点击下一步。',
    target: 'api-provider-card',
    icon: Settings2,
    audioId: 'api-configuration.provider',
    requiresApiConfig: true,
  },
  {
    id: 'api-key',
    title: '填写 API Key',
    description: '将模型服务商提供的 API Key 填入密钥框。若当前已经配置，无需修改，直接进入下一步。',
    target: 'api-provider-key',
    icon: Settings2,
    audioId: 'api-configuration.key',
    requiresApiConfig: true,
    tip: '不要向他人展示或发送 API Key。教学模式不会读取、复制或上传密钥内容。',
  },
  {
    id: 'api-test',
    title: '测试连接',
    description: '点击“测试连接”可确认地址、密钥和权限是否有效。教学不会替你点击，也不会提交生成任务。',
    target: 'api-provider-test',
    icon: Settings2,
    audioId: 'api-configuration.test',
    requiresApiConfig: true,
  },
  {
    id: 'api-save',
    title: '保存配置',
    description: '连接通过后点击“保存配置”。配置只保存在当前设备本地。',
    target: 'api-provider-save',
    icon: Settings2,
    audioId: 'api-configuration.save',
    requiresApiConfig: true,
  },
  {
    id: 'api-audio-scroll',
    title: '滑动模型分类导航',
    description: '按住分类导航栏底部的横向滑块并向右拖动，直到“语音/音乐”与“即梦CLI”分类完整显示。',
    target: 'api-config-tabs-scroll',
    icon: Settings2,
    action: 'scroll',
    audioId: 'api-configuration.audio-scroll',
    requiresApiConfig: true,
    tip: '也可以将鼠标放在分类导航栏上，使用支持横向滚动的触控板操作。',
  },
  {
    id: 'api-audio-category',
    title: '进入语音/音乐配置',
    description: '点击“语音/音乐”，继续学习语音助手、语音合成、本地语音识别和音乐生成服务。',
    target: 'api-config-tab-audio',
    icon: Settings2,
    action: 'click',
    audioId: 'api-configuration.audio-category',
    requiresApiConfig: true,
  },
  {
    id: 'api-audio-assistant',
    title: '控制语音助手',
    description: '总开关控制语音助手及其界面是否启用。下方可以分别控制音色、STT、TTS 和自动启动；关闭总开关后，这些能力会一起停用。',
    target: 'api-audio-assistant',
    icon: Settings2,
    audioId: 'api-configuration.audio-assistant',
    requiresApiConfig: true,
    tip: 'STT 使用本地 SenseVoice，不消耗云端语音识别额度。',
  },
  {
    id: 'api-audio-voice-open',
    title: '打开语音配置',
    description: '点击“语音”，查看语音 API、TTS 和 STT 三个独立配置页。',
    target: 'api-audio-panel-voice',
    icon: Settings2,
    action: 'click',
    audioId: 'api-configuration.audio-voice-open',
    requiresApiConfig: true,
  },
  {
    id: 'api-audio-api-open',
    title: '选择语音 API',
    description: '点击“API”，查看 ElevenLabs 等语音服务的地址、密钥、模型和连接状态。',
    target: 'api-audio-voice-tab-full',
    icon: Settings2,
    action: 'click',
    audioId: 'api-configuration.audio-api-open',
    requiresApiConfig: true,
  },
  {
    id: 'api-audio-api',
    title: '配置语音 API',
    description: '在这里展开语音提供商，填写 API Key，测试连接并保存。该配置用于语音合成、音色和音频生成，不用于本地 STT。',
    target: 'api-audio-voice-api',
    icon: Settings2,
    audioId: 'api-configuration.audio-api',
    requiresApiConfig: true,
  },
  {
    id: 'api-audio-tts-open',
    title: '进入 TTS 配置',
    description: '点击“TTS”，配置文字转语音服务、朗读模型和自定义音色。',
    target: 'api-audio-voice-tab-tts',
    icon: Settings2,
    action: 'click',
    audioId: 'api-configuration.audio-tts-open',
    requiresApiConfig: true,
  },
  {
    id: 'api-audio-tts',
    title: '设置文字转语音',
    description: 'TTS 页面用于配置 MiniMax 等文字转语音提供商。保存提供商后，再在上方语音助手区域选择朗读引擎、音色和表现参数。',
    target: 'api-audio-voice-tts',
    icon: Settings2,
    audioId: 'api-configuration.audio-tts',
    requiresApiConfig: true,
  },
  {
    id: 'api-audio-stt-open',
    title: '查看本地 STT',
    description: '点击“STT”，查看本地语音转文字模型的运行说明。',
    target: 'api-audio-voice-tab-stt',
    icon: Settings2,
    action: 'click',
    audioId: 'api-configuration.audio-stt-open',
    requiresApiConfig: true,
  },
  {
    id: 'api-audio-stt',
    title: '认识本地语音识别',
    description: 'STT 使用本地 SenseVoice Small 模型。语音识别在本机完成，录音不会发送到云端 STT 服务。',
    target: 'api-audio-voice-stt',
    icon: Settings2,
    audioId: 'api-configuration.audio-stt',
    requiresApiConfig: true,
  },
  {
    id: 'api-audio-music-open',
    title: '打开音乐配置',
    description: '点击“音乐”，进入音乐与音效生成服务配置。',
    target: 'api-audio-panel-music',
    icon: Settings2,
    action: 'click',
    audioId: 'api-configuration.audio-music-open',
    requiresApiConfig: true,
  },
  {
    id: 'api-audio-music',
    title: '配置音乐生成模型',
    description: '音乐页面管理 MiniMax 音乐和 Kie Suno 等提供商。填写密钥后测试并保存，音乐/语音节点和自动分段配乐会使用这里启用的模型。',
    target: 'api-audio-music',
    icon: Settings2,
    audioId: 'api-configuration.audio-music',
    requiresApiConfig: true,
    tip: '生成前请确认云端余额和模型状态；配置教学不会发起音乐任务。',
  },
  {
    id: 'api-dreamina-category',
    title: '进入即梦 CLI 配置',
    description: '点击“即梦CLI”，配置本机命令行程序、授权浏览器和要绑定的即梦账号。',
    target: 'api-config-tab-dreamina-cli',
    icon: Settings2,
    action: 'click',
    audioId: 'api-configuration.dreamina-category',
    requiresApiConfig: true,
  },
  {
    id: 'api-dreamina-install',
    title: '安装并定位即梦 CLI',
    description: 'CLI 路径可以填写已经安装的 dreamina 命令，也可以粘贴安装命令后点击“自动安装”。安装成功后再检测登录状态。',
    target: 'api-dreamina-install',
    icon: Settings2,
    audioId: 'api-configuration.dreamina-install',
    requiresApiConfig: true,
    tip: '不要在教学过程中重复安装已经可用的 CLI。',
  },
  {
    id: 'api-dreamina-browser',
    title: '选择授权浏览器',
    description: '选择实际登录目标即梦账号的浏览器。OAuth 授权会用该浏览器打开官方页面，避免绑定到另一浏览器中的账号。',
    target: 'api-dreamina-browser',
    icon: Settings2,
    audioId: 'api-configuration.dreamina-browser',
    requiresApiConfig: true,
  },
  {
    id: 'api-dreamina-auth',
    title: '登录并检测账号',
    description: '未登录时点击“OAuth 登录”，按官方页面完成设备码授权；随后点击“检测登录”确认账号、UID 和积分，再保存配置。',
    target: 'api-dreamina-auth',
    icon: Settings2,
    audioId: 'api-configuration.dreamina-auth',
    requiresApiConfig: true,
    tip: '即梦 App 或网页已登录，不等于即梦 CLI 已完成授权。',
  },
  {
    id: 'api-dreamina-backends',
    title: '启用画布生成后端',
    description: '开启图片或视频后端后，对应生成节点才会显示“即梦CLI”选项。关闭某项只会隐藏该入口，不会删除已经生成的素材。',
    target: 'api-dreamina-backends',
    icon: Settings2,
    audioId: 'api-configuration.dreamina-backends',
    requiresApiConfig: true,
  },
  {
    id: 'api-done',
    title: 'API 配置教学完成',
    description: '你已经了解常规 API、语音/音乐服务和即梦 CLI 的配置流程。实际生成前，请分别确认连接测试、账户余额与模型状态。',
    target: 'api-config-tabs',
    icon: Check,
    audioId: 'api-configuration.done',
    requiresApiConfig: true,
  },
  {
    id: 'done',
    title: '欢迎页教学完成',
    description: '点击“创建项目并继续”，完成项目名称设置后会自动进入画布，并从画布基础教学的第一步继续。',
    icon: Check,
  },
];

const INTRO_SUBTITLE_CUES = [
  { start: 0, end: 2.45, text: '欢迎使用 Magine Canvas' },
  { start: 2.45, end: 4.55, text: '这里是项目欢迎页' },
  { start: 4.55, end: 10.9, text: '你可以创建新画布、打开已有工程，也可以从最近项目继续上一次创作' },
] as const;

const DONE_SUBTITLE_CUES = [
  { start: 0, end: 2.65, text: '欢迎页教学已经完成' },
  { start: 2.65, end: 5.1, text: '点击创建项目并继续' },
  { start: 5.1, end: 8.35, text: '设置项目名称后会自动进入画布' },
  { start: 8.35, end: 11.2, text: '并从画布基础教学继续' },
] as const;

type ImmersiveSubtitleCue = {
  start: number;
  end: number;
  text: string;
};

function WelcomeImmersiveNarration({
  audioLevelRef,
  currentTimeRef,
  isPlaying,
  muted,
  cues,
  buttonLabel,
  onNext,
}: {
  audioLevelRef: RefObject<number>;
  currentTimeRef: RefObject<number>;
  isPlaying: boolean;
  muted: boolean;
  cues: readonly ImmersiveSubtitleCue[];
  buttonLabel: string;
  onNext: () => void;
}) {
  const subtitleRef = useRef<HTMLParagraphElement | null>(null);
  const idleAudioLevelRef = useRef(0);
  const [subtitle, setSubtitle] = useState<string>(cues[0]?.text || '');
  const cueIndexRef = useRef(0);

  useEffect(() => {
    let frame = 0;
    const updateSubtitle = () => {
      const currentTime = currentTimeRef.current || 0;
      const cueIndex = cues.findIndex(
        (cue) => currentTime >= cue.start && currentTime < cue.end
      );
      const cue = cueIndex >= 0 ? cues[cueIndex] : null;

      if (cue && cueIndex !== cueIndexRef.current) {
        cueIndexRef.current = cueIndex;
        setSubtitle(cue.text);
      }

      if (subtitleRef.current) {
        if (!cue || !isPlaying || muted) {
          subtitleRef.current.style.opacity = '0';
          subtitleRef.current.style.transform = 'translateY(5px)';
        } else {
          const fadeIn = Math.min(1, Math.max(0, (currentTime - cue.start) / 0.42));
          const fadeOut = Math.min(1, Math.max(0, (cue.end - currentTime) / 0.48));
          const opacity = Math.min(fadeIn, fadeOut);
          subtitleRef.current.style.opacity = String(opacity);
          subtitleRef.current.style.transform = `translateY(${(1 - opacity) * 5}px)`;
        }
      }

      frame = window.requestAnimationFrame(updateSubtitle);
    };
    frame = window.requestAnimationFrame(updateSubtitle);
    return () => window.cancelAnimationFrame(frame);
  }, [cues, currentTimeRef, isPlaying, muted]);

  return (
    <div className="pointer-events-none fixed left-1/2 top-1/2 z-[1] flex w-full -translate-x-1/2 -translate-y-1/2 flex-col items-center px-6">
      <p
        ref={subtitleRef}
        className="min-h-9 max-w-[min(84vw,820px)] text-center text-xl font-normal leading-relaxed text-white transition-none sm:text-2xl"
        style={{
          opacity: 0,
          textShadow: '0 2px 16px rgba(0,0,0,0.82), 0 1px 2px rgba(0,0,0,0.95)',
        }}
      >
        {subtitle}
      </p>
      <VoiceAssistantWaveStrip
        active
        audioLevelRef={isPlaying && !muted ? audioLevelRef : idleAudioLevelRef}
        intensity={1.75}
        motionSpeed={1.55}
        className="mt-5 h-20 w-[min(78vw,760px)] items-center [&_svg]:!h-20"
      />
      <button
        type="button"
        onClick={onNext}
        className="pointer-events-auto mt-3 flex h-10 min-w-24 items-center justify-center rounded-md border border-white/20 bg-white/[0.07] px-6 text-sm font-medium text-white/90 shadow-[0_0_26px_rgba(255,255,255,0.13),inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-xl transition-colors hover:border-white/30 hover:bg-white/[0.12] hover:text-white"
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function resolveTarget(target: WelcomeTutorialTarget | undefined): HTMLElement | null {
  if (!target) return null;
  const matches = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-tutorial-id="${target}"]`)
  );
  return matches.find((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 4 && rect.height > 4 && style.display !== 'none' && style.visibility !== 'hidden';
  }) || null;
}

function getVisibleTargetRect(target: HTMLElement): DOMRect | null {
  const targetRect = target.getBoundingClientRect();
  let left = Math.max(0, targetRect.left);
  let top = Math.max(0, targetRect.top);
  let right = Math.min(window.innerWidth, targetRect.right);
  let bottom = Math.min(window.innerHeight, targetRect.bottom);

  let ancestor = target.parentElement;
  while (ancestor && ancestor !== document.body) {
    const style = window.getComputedStyle(ancestor);
    const ancestorRect = ancestor.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, ancestorRect.left);
      right = Math.min(right, ancestorRect.right);
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      top = Math.max(top, ancestorRect.top);
      bottom = Math.min(bottom, ancestorRect.bottom);
    }
    ancestor = ancestor.parentElement;
  }

  if (right - left <= 4 || bottom - top <= 4) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

function scrollTargetIntoView(target: HTMLElement, behavior: ScrollBehavior = 'smooth') {
  const ancestors: HTMLElement[] = [];
  let parent = target.parentElement;
  while (parent) {
    ancestors.push(parent);
    parent = parent.parentElement;
  }

  for (const ancestor of ancestors) {
    const style = window.getComputedStyle(ancestor);
    const canScrollX = /(auto|scroll)/.test(style.overflowX) && ancestor.scrollWidth > ancestor.clientWidth + 1;
    const canScrollY = /(auto|scroll)/.test(style.overflowY) && ancestor.scrollHeight > ancestor.clientHeight + 1;
    if (!canScrollX && !canScrollY) continue;

    const targetRect = target.getBoundingClientRect();
    const ancestorRect = ancestor.getBoundingClientRect();
    const nextLeft = canScrollX
      ? Math.max(0, ancestor.scrollLeft + targetRect.left + targetRect.width / 2 - ancestorRect.left - ancestorRect.width / 2)
      : ancestor.scrollLeft;
    const nextTop = canScrollY
      ? Math.max(0, ancestor.scrollTop + targetRect.top + targetRect.height / 2 - ancestorRect.top - ancestorRect.height / 2)
      : ancestor.scrollTop;

    ancestor.scrollTo({ left: nextLeft, top: nextTop, behavior });
  }
}

function readSavedStep(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) ? Math.min(STEPS.length - 1, Math.max(0, value)) : 0;
  } catch {
    return 0;
  }
}

export function WelcomeTutorial({
  isOpen,
  isApiConfigOpen,
  onClose,
  onComplete,
  onOpenApiConfig,
  onCloseApiConfig,
}: {
  isOpen: boolean;
  isApiConfigOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  onOpenApiConfig: () => void;
  onCloseApiConfig: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const idleAudioLevelRef = useRef(0);
  const step = STEPS[stepIndex];
  const tutorialAudio = useTutorialAudio(step.audioId || `welcome.${step.id}`, isOpen);

  const moveToStep = useCallback((nextIndex: number) => {
    const boundedIndex = Math.min(STEPS.length - 1, Math.max(0, nextIndex));
    const nextStep = STEPS[boundedIndex];
    if (nextStep.id === 'api-open' && isApiConfigOpen) onCloseApiConfig();
    if (nextStep.requiresApiConfig && !isApiConfigOpen) onOpenApiConfig();
    if (!nextStep.id.startsWith('api-') && isApiConfigOpen) onCloseApiConfig();
    setStepIndex(boundedIndex);
  }, [isApiConfigOpen, onCloseApiConfig, onOpenApiConfig]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => setStepIndex(readSavedStep()));
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(stepIndex));
    } catch {
      // Tutorial progress persistence is optional.
    }
  }, [isOpen, stepIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && stepIndex > 0) moveToStep(stepIndex - 1);
      if (event.key === 'ArrowRight' && (!step.action || step.action === 'manual') && stepIndex < STEPS.length - 1) moveToStep(stepIndex + 1);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, moveToStep, onClose, step.action, stepIndex]);

  useEffect(() => {
    if (!isOpen || step.action !== 'click' || !step.target) return;
    let frame = 0;
    const targetId = step.target;
    const handleTargetClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element?.closest(`[data-tutorial-id="${targetId}"]`)) return;
      frame = window.requestAnimationFrame(() => {
        setStepIndex((current) => current === stepIndex ? Math.min(STEPS.length - 1, current + 1) : current);
      });
    };
    document.addEventListener('click', handleTargetClick, true);
    return () => {
      document.removeEventListener('click', handleTargetClick, true);
      window.cancelAnimationFrame(frame);
    };
  }, [isOpen, step.action, step.target, stepIndex]);

  useEffect(() => {
    if (!isOpen || step.action !== 'scroll' || !step.target) return;
    const target = resolveTarget(step.target);
    if (!target) return;
    const initialScrollLeft = target.scrollLeft;
    const handleTargetScroll = () => {
      if (Math.abs(target.scrollLeft - initialScrollLeft) < 8) return;
      setStepIndex((current) => current === stepIndex ? Math.min(STEPS.length - 1, current + 1) : current);
    };
    target.addEventListener('scroll', handleTargetScroll, { passive: true });
    return () => target.removeEventListener('scroll', handleTargetScroll);
  }, [isOpen, step.action, step.target, stepIndex]);

  useEffect(() => {
    if (!isOpen || !step.requiresApiConfig || isApiConfigOpen) return;
    const apiOpenIndex = STEPS.findIndex((candidate) => candidate.id === 'api-open');
    const frame = window.requestAnimationFrame(() => setStepIndex(apiOpenIndex));
    return () => window.cancelAnimationFrame(frame);
  }, [isApiConfigOpen, isOpen, step.requiresApiConfig]);

  useEffect(() => {
    if (!isOpen || !isApiConfigOpen || !step.requiresApiConfig || !step.target) return;
    const timer = window.setTimeout(() => {
      const target = resolveTarget(step.target);
      if (!target) return;
      scrollTargetIntoView(target);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [isApiConfigOpen, isOpen, step.id, step.requiresApiConfig, step.target]);

  useEffect(() => {
    if (!isOpen) return;
    let frame = 0;
    if (!step.target) {
      frame = window.requestAnimationFrame(() => setTargetRect(null));
      return () => window.cancelAnimationFrame(frame);
    }
    let previous = '__initial__';
    const updateTarget = () => {
      const target = resolveTarget(step.target);
      const rect = target ? getVisibleTargetRect(target) : null;
      const next = rect
        ? `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`
        : '';
      if (next !== previous) {
        previous = next;
        setTargetRect(rect);
      }
      frame = window.requestAnimationFrame(updateTarget);
    };
    frame = window.requestAnimationFrame(updateTarget);
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, step.target]);

  const locateTarget = useCallback(() => {
    const target = resolveTarget(step.target);
    if (target) scrollTargetIntoView(target);
  }, [step.target]);

  const layout = useMemo(() => {
    const cardWidth = 352;
    const estimatedHeight = 390;
    if (!targetRect) {
      return {
        left: Math.max(20, (window.innerWidth - cardWidth) / 2),
        top: Math.max(20, (window.innerHeight - estimatedHeight) / 2),
      };
    }
    const right = targetRect.right + 18;
    const left = targetRect.left - cardWidth - 18;
    return {
      left: right + cardWidth <= window.innerWidth - 20 ? right : Math.max(20, left),
      top: Math.min(
        Math.max(20, window.innerHeight - estimatedHeight - 20),
        Math.max(20, targetRect.top)
      ),
    };
  }, [targetRect]);

  if (!isOpen || typeof document === 'undefined') return null;

  const StepIcon = step.icon;
  const isLast = stepIndex === STEPS.length - 1;
  const progress = Math.round(((stepIndex + 1) / STEPS.length) * 100);

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[10120]" data-tutorial-surface="true">
      {step.target && targetRect && step.highlight !== false ? (
        <div
          className="fixed rounded-lg border border-amber-100/80 shadow-[0_0_0_9999px_rgba(2,5,8,0.72),0_0_32px_rgba(251,191,36,0.28)] transition-[left,top,width,height] duration-200 ease-out"
          style={{
            left: Math.max(0, targetRect.left),
            top: Math.max(0, targetRect.top),
            width: targetRect.width,
            height: targetRect.height,
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px]" />
      )}

      {(step.id === 'intro' || step.id === 'done') && (
        <WelcomeImmersiveNarration
          audioLevelRef={tutorialAudio.audioLevelRef}
          currentTimeRef={tutorialAudio.currentTimeRef}
          isPlaying={tutorialAudio.isPlaying}
          muted={tutorialAudio.muted}
          cues={step.id === 'intro' ? INTRO_SUBTITLE_CUES : DONE_SUBTITLE_CUES}
          buttonLabel={step.id === 'intro' ? '下一步' : '创建项目并继续'}
          onNext={() => {
            if (step.id === 'done') {
              try {
                window.localStorage.setItem(STORAGE_KEY, '0');
              } catch {
                // Tutorial progress persistence is optional.
              }
              onComplete();
              return;
            }
            moveToStep(stepIndex + 1);
          }}
        />
      )}

      {step.id !== 'intro' && step.id !== 'done' && (
        <section
          className="pointer-events-auto fixed z-[2] w-[352px] overflow-hidden rounded-lg border border-white/14 bg-[#101416]/96 shadow-[0_24px_80px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl"
          style={layout}
          aria-label="欢迎页教学"
        >
        <div className="h-1 bg-white/8">
          <div className="h-full bg-amber-200/80 transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-amber-100/15 bg-amber-200/[0.08] text-amber-100">
                <StepIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] text-amber-100/65">欢迎页教学 · {stepIndex + 1}/{STEPS.length}</div>
                <h2 className="mt-1 text-base font-semibold text-zinc-100">{step.title}</h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/8 hover:text-white"
              title="关闭教学"
              aria-label="关闭欢迎页教学"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-4 text-sm leading-6 text-zinc-300">{step.description}</p>
          {step.tip && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-sky-200/12 bg-sky-300/[0.05] px-3 py-2.5 text-xs leading-5 text-sky-50/70">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-100/80" />
              {step.tip}
            </div>
          )}

          <VoiceAssistantWaveStrip
            active
            audioLevelRef={
              tutorialAudio.isPlaying && !tutorialAudio.muted
                ? tutorialAudio.audioLevelRef
                : idleAudioLevelRef
            }
            intensity={1.3}
            motionSpeed={1.55}
            className="mt-3 h-9 items-center overflow-hidden [&_svg]:!h-9"
          />

          <div className="mt-4 flex items-center border-t border-white/8 pt-3">
            {step.target && step.highlight !== false && (
              <button
                type="button"
                onClick={locateTarget}
                className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[11px] text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-100"
                title="重新定位当前区域"
              >
                <LocateFixed className="h-3.5 w-3.5" />重新定位
              </button>
            )}
            <button
              type="button"
              onClick={tutorialAudio.togglePlayback}
              className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-100"
              title={tutorialAudio.isPlaying ? '暂停教学语音' : '播放教学语音'}
              aria-label={tutorialAudio.isPlaying ? '暂停教学语音' : '播放教学语音'}
            >
              {tutorialAudio.isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={tutorialAudio.replay}
              className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-100"
              title="重新播放教学语音"
              aria-label="重新播放教学语音"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={tutorialAudio.toggleMuted}
              className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-100"
              title={tutorialAudio.muted ? '开启教学语音' : '静音教学语音'}
              aria-label={tutorialAudio.muted ? '开启教学语音' : '静音教学语音'}
            >
              {tutorialAudio.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
            <span className="ml-auto text-[10px] text-zinc-600">方向键可切换步骤</span>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => moveToStep(stepIndex - 1)}
              disabled={stepIndex === 0}
              className="flex h-9 items-center gap-1 rounded-md px-2 text-xs text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-25"
            >
              <ChevronLeft className="h-4 w-4" />上一步
            </button>
            {step.action === 'click' || step.action === 'scroll' ? (
              <span className="text-xs text-amber-100/65">
                {step.action === 'scroll' ? '拖动高亮区域底部滑块继续...' : '点击高亮区域继续...'}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (isLast) {
                    try {
                      window.localStorage.setItem(STORAGE_KEY, '0');
                    } catch {
                      // Tutorial progress persistence is optional.
                    }
                    onComplete();
                    return;
                  }
                  moveToStep(stepIndex + 1);
                }}
                className="flex h-9 items-center gap-1.5 rounded-md border border-amber-200/18 bg-amber-300/12 px-4 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-300/18"
              >
                {isLast ? <Check className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isLast ? '创建项目并继续' : '下一步'}
              </button>
            )}
          </div>
        </div>
        </section>
      )}
    </div>,
    document.body
  );
}
