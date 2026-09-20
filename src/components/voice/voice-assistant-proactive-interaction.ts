'use client';

import { useContext, useEffect, useRef } from 'react';
import { useVoiceAssistantActivityStore } from './voice-assistant-activity-store';
import { VoiceAssistantContext } from './voiceAssistantContext';
import { useSeedanceStore } from '@/components/seedance/SeedanceStore';
import { resolveVoiceTtsConfig, speakText } from '@/lib/elevenlabs/ttsPlayback';
import { getUserName } from '@/lib/user-profile-store';
import { isMusicCurrentlyPlaying, playProactiveAmbientMusic } from '@/lib/voice-music-intent';

interface ProactiveInteractionOptions {
  idleThresholdMinutes: number;
  workIntensityThresholdHours: number;
}

const COOLDOWN_MS = 120_000;
const IDLE_CHECK_INTERVAL = 15000;
const ENABLE_PROACTIVE_MUSIC = false;

// ---- 话术库 ----

function getTimePeriodGreeting(): string | null {
  const now = new Date();
  const h = now.getHours();
  const day = now.getDay();
  const isWeekend = day === 0 || day === 6;
  const N = getUserName();

  if (h >= 5 && h < 9) {
    return isWeekend ? `早上好${N}，周末还这么早开工？厉害了。` : `早上好${N}，今天这么早就开工了？`;
  }
  if (h >= 9 && h < 12) {
    if (isWeekend) return `周末好${N}，今天也在忙项目？`;
    return null;
  }
  if (h >= 12 && h < 14) {
    return isWeekend ? `中午了${N}，周末也别忘了按时吃饭。` : `中午了${N}，别忘了吃饭。`;
  }
  if (h >= 14 && h < 18) {
    return null;
  }
  if (h >= 18 && h < 21) {
    if (day === 5) return `周五傍晚了${N}，今天进度怎么样？快周末了。`;
    if (isWeekend) return `傍晚了${N}，周末还在忙，辛苦了。`;
    return `傍晚了${N}，今天进度怎么样？`;
  }
  if (h >= 21 && h < 23) {
    if (day === 5) return `周五晚上还在忙？差不多该放松一下了${N}。`;
    return `晚上好${N}，还在忙？`;
  }
  if (h >= 23 || h < 5) {
    return `夜深了${N}，注意休息，明天还有时间。`;
  }
  return null;
}

function getIdlePrompt(idleMinutes: number): string {
  if (idleMinutes >= 60) {
    return `${getUserName()}，你已经${Math.round(idleMinutes / 60)}小时没操作了，需要暂停会话吗？`;
  }
  if (idleMinutes >= 30) {
    return `已经${idleMinutes}分钟没有操作了，${getUserName()}还在忙别的吗？`;
  }
  if (idleMinutes >= 15) {
    return `${getUserName()}，${idleMinutes}分钟没动了，有什么需要我帮忙的吗？`;
  }
  return `${getUserName()}？还在吗？`;
}

function getWorkIntensityPrompt(hours: number, clicks: number, keys: number, scroll: number): string | null {
  const totalActions = clicks + keys;
  if (totalActions > 4000 && scroll > 80000 && hours >= 3) {
    return `${getUserName()}，你已高强度工作了大概${hours}个小时：${totalActions}次操作、滚了${Math.round(scroll / 1000)}k像素。建议起来走走，眼睛和手腕都需要放松。`;
  }
  if (totalActions > 2000 && hours >= 2) {
    return `${getUserName()}，连续工作了大概${hours}个小时，操作了${totalActions}次。要不要起来喝杯咖啡？`;
  }
  if (hours >= 4) {
    return `${getUserName()}，已经${hours}个小时了，请注意休息。`;
  }
  return null;
}

function getMilestonePrompt(hours: number, clicks: number, keys: number): string | null {
  if (hours === 3 && clicks + keys > 1000) {
    return `${getUserName()}，你已经连续工作 3 小时了，操作量也很大。休息五分钟，效率会更高。`;
  }
  if (hours === 6) {
    return `${getUserName()}，已经 6 小时了。真的有必要歇一下，长时间坐着对腰不好。`;
  }
  if (hours === 8) {
    return `${getUserName()}，你已经在线 8 小时了。这是正常一个工作日了，该收工了。`;
  }
  return null;
}

export function useVoiceAssistantProactiveInteraction(opts: ProactiveInteractionOptions) {
  const { idleThresholdMinutes, workIntensityThresholdHours } = opts;
  const recordActivity = useVoiceAssistantActivityStore((s) => s.recordActivity);
  const incrementMouseClicks = useVoiceAssistantActivityStore((s) => s.incrementMouseClicks);
  const incrementKeystrokes = useVoiceAssistantActivityStore((s) => s.incrementKeystrokes);
  const addScrollDistance = useVoiceAssistantActivityStore((s) => s.addScrollDistance);
  const incrementCopyPaste = useVoiceAssistantActivityStore((s) => s.incrementCopyPaste);
  const markSessionGreeted = useVoiceAssistantActivityStore((s) => s.markSessionGreeted);
  const setIdleStart = useVoiceAssistantActivityStore((s) => s.setIdleStart);
  const clearIdle = useVoiceAssistantActivityStore((s) => s.clearIdle);
  const setTabHidden = useVoiceAssistantActivityStore((s) => s.setTabHidden);
  const clearTabHidden = useVoiceAssistantActivityStore((s) => s.clearTabHidden);
  const voiceCtx = useContext(VoiceAssistantContext);

  // ---- Per-scenario one-shot guards ----
  const cooldownUntilRef = useRef(0);
  const timeGreetedRef = useRef(false);
  const returnGreetedRef = useRef(false);
  const idlePromptedRef = useRef(false);
  const workPromptedRef = useRef(false);
  const lateNightPromptedRef = useRef(false);
  const scrollFatiguePromptedRef = useRef(false);
  const copyPastePromptedRef = useRef(false);
  const errorBurstPromptedRef = useRef(false);
  const tabReturnPromptedRef = useRef(false);
  const tabTogglePromptedRef = useRef(false);
  const midnightPromptedRef = useRef(false);
  const keystrokeBurstPromptedRef = useRef(false);
  const keyboardOnlyPromptedRef = useRef(false);
  const milestonePromptedRef = useRef<Record<number, boolean>>({});
  const musicInvitePromptedRef = useRef(false);
  const musicAmbientPlayedRef = useRef(false);

  const idleStartRef = useRef(0);
  const prevIdleRef = useRef(false);
  const lastKeystrokeTimeRef = useRef(0);
  const keystrokeBurstStartRef = useRef(0);
  const lastMidnightDateRef = useRef('');

  function speak(text: string) {
    if (!voiceCtx) return;
    voiceCtx.pushAgentSubtitle(text);
    const tts = resolveVoiceTtsConfig();
    if (!tts.apiKey) return;
    void speakText(text, tts.apiKey, tts.voiceId || undefined, (ratio) => {
      voiceCtx.setAgentTtsProgress(ratio);
    }, tts.providerId)
      .then(() => voiceCtx.notifyAgentVoiceEnded())
      .catch(() => voiceCtx.notifyAgentVoiceEnded());
  }

  function trySpeak(text: string, guard: { current: boolean }) {
    if (guard.current) return;
    if (Date.now() < cooldownUntilRef.current) return;
    guard.current = true;
    cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
    speak(text);
  }

  function trySpeakWithAmbientMusic(intro: string, guard: { current: boolean }, query = '轻音乐') {
    if (guard.current) return;
    if (Date.now() < cooldownUntilRef.current) return;
    if (isMusicCurrentlyPlaying()) return;
    guard.current = true;
    cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
    void (async () => {
      const played = await playProactiveAmbientMusic(query);
      const N = getUserName();
      const text = played.ok
        ? `${N}，${intro}给你放首「${played.trackName}」。`
        : `${N}，${intro}可以说「放首轻音乐」，我来给你播。`;
      speak(text);
    })();
  }

  // ---- 鼠标 / 键盘 / 滚动 / 复制粘贴 / 标签页可见性 ----
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let lastScrollY = window.scrollY;

    const onPointerMove = () => recordActivity();
    const onPointerDown = () => incrementMouseClicks();
    const onKeyDown = () => {
      incrementKeystrokes();
      lastKeystrokeTimeRef.current = Date.now();
    };
    const onScroll = () => {
      const dy = window.scrollY - lastScrollY;
      lastScrollY = window.scrollY;
      if (dy !== 0) {
        addScrollDistance(Math.abs(dy));
        recordActivity();
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        addScrollDistance(Math.abs(e.deltaY));
        recordActivity();
      }
    };
    const onCopy = () => incrementCopyPaste();
    const onPaste = () => incrementCopyPaste();
    const onVisibility = () => {
      if (document.hidden) {
        setTabHidden(Date.now());
      } else {
        clearTabHidden();
        recordActivity();
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('keydown', onKeyDown, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('wheel', onWheel);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [recordActivity, incrementMouseClicks, incrementKeystrokes, addScrollDistance, incrementCopyPaste, setTabHidden, clearTabHidden]);

  // ---- 综合检测定时器 ----
  useEffect(() => {
    if (!voiceCtx) return;

    const timer = setInterval(() => {
      const state = useVoiceAssistantActivityStore.getState();
      const now = Date.now();
      const elapsed = now - state.lastActivityTimestamp;
      const sessionDuration = now - state.sessionStartTimestamp;
      const sessionMinutes = Math.round(sessionDuration / 60000);
      const sessionHours = Math.floor(sessionDuration / 3600000);
      const idleMinutes = Math.round(elapsed / 60000);
      const idleMs = idleThresholdMinutes * 60 * 1000;
      const isIdle = elapsed >= idleMs;
      const waveActive = voiceCtx.waveActive;

      // ============================================================
      // 场景 1：时间问候（会话 > 1 分钟时触发一次，含周末语调）
      // ============================================================
      if (!state.sessionGreeted && sessionDuration > 60000 && !waveActive) {
        const greeting = getTimePeriodGreeting();
        if (greeting) {
          markSessionGreeted();
          trySpeak(greeting, timeGreetedRef);
        } else {
          markSessionGreeted();
        }
      }

      // ============================================================
      // 场景 2：空闲状态追踪（内部状态）
      // ============================================================
      if (isIdle && idleStartRef.current === 0) {
        idleStartRef.current = now;
        setIdleStart(now);
      }

      // ============================================================
      // 场景 3：空闲回归问候
      // ============================================================
      if (!isIdle && prevIdleRef.current) {
        const idleDuration = now - idleStartRef.current;
        idleStartRef.current = 0;
        if (idleDuration > 120000 && !waveActive) {
          const mins = Math.round(idleDuration / 60000);
          const snapshot = {
            mouseClicks: state.mouseClicks,
            keystrokes: state.keystrokes,
            scrollDistance: state.scrollDistance,
            copyPasteCount: state.copyPasteCount,
            timestamp: now,
          };
          clearIdle(snapshot);
          returnGreetedRef.current = false;
          const extra = mins >= 30 ? '刚才的上下文都在，需要我复述一下当前画布状态吗？' : '有什么需要继续的吗？';
          trySpeak(`${getUserName()}你回来了，刚才离开了大概${mins}分钟。${extra}`, returnGreetedRef);
        }
      }

      // ============================================================
      // 场景 4：空闲层级提示
      // ============================================================
      if (isIdle && elapsed >= idleMs && !idlePromptedRef.current && !waveActive) {
        idlePromptedRef.current = true;
        speak(getIdlePrompt(idleMinutes));
      }
      if (!isIdle && elapsed < 5000) {
        idlePromptedRef.current = false;
      }

      // ============================================================
      // 场景 5：工作强度提醒（含滚动数据）
      // ============================================================
      if (
        sessionDuration >= workIntensityThresholdHours * 60 * 60 * 1000 &&
        !workPromptedRef.current &&
        !waveActive
      ) {
        const hours = Math.round(sessionDuration / 3600000);
        const prompt = getWorkIntensityPrompt(hours, state.mouseClicks, state.keystrokes, state.scrollDistance);
        if (prompt) {
          workPromptedRef.current = true;
          speak(prompt);
        }
      }

      // ============================================================
      // 场景 6：深夜提醒（23:00-05:00 每小时）
      // ============================================================
      if (!waveActive) {
        const h = new Date().getHours();
        if ((h >= 23 || h < 5) && sessionMinutes > 30 && sessionMinutes % 60 < 2) {
          trySpeak(`${getUserName()}，已经很晚了，今天先休息吧。身体是革命的本钱。`, lateNightPromptedRef);
        }
        if (sessionMinutes % 60 > 5) {
          lateNightPromptedRef.current = false;
        }
      }

      // ============================================================
      // 场景 7：滚轮疲劳
      // ============================================================
      if (
        !waveActive &&
        state.scrollDistance > 50000 &&
        state.mouseClicks < 20 &&
        sessionMinutes > 10 &&
        !scrollFatiguePromptedRef.current
      ) {
        trySpeak(`${getUserName()}，你滚了很久的页面。是在找什么东西吗？我可以帮你搜索。`, scrollFatiguePromptedRef);
      }

      // ============================================================
      // 场景 8：高频复制粘贴
      // ============================================================
      if (
        !waveActive &&
        state.copyPasteCount > 30 &&
        sessionMinutes > 5 &&
        !copyPastePromptedRef.current
      ) {
        trySpeak(`${getUserName()}，看到你在大量复制粘贴。需要我帮你批量处理这些内容吗？`, copyPastePromptedRef);
      }

      // ============================================================
      // 场景 9：连续错误爆发
      // ============================================================
      if (!waveActive && state.consecutiveErrors >= 3 && !errorBurstPromptedRef.current) {
        errorBurstPromptedRef.current = true;
        speak('最近连续出现了几次错误，建议检查一下 API 配置或网络连接。需要我帮你诊断吗？');
      }
      if (state.consecutiveErrors === 0) errorBurstPromptedRef.current = false;

      // ============================================================
      // 场景 10：标签页切回问候
      // ============================================================
      if (!waveActive && state.tabHiddenTimestamp > 0) {
        const hiddenDuration = now - state.tabHiddenTimestamp;
        if (hiddenDuration > 180000) {
          // 离开 > 3 分钟才触发
          const mins = Math.round(hiddenDuration / 60000);
          trySpeak(`${getUserName()}你回来看我了。刚才离开了${mins}分钟，一切正常。`, tabReturnPromptedRef);
          clearTabHidden();
        } else {
          clearTabHidden();
        }
      }

      // ============================================================
      // 场景 11：跨午夜提醒
      // ============================================================
      if (!waveActive) {
        const today = new Date().toDateString();
        const h = new Date().getHours();
        if (h >= 0 && h < 3 && today !== lastMidnightDateRef.current) {
          lastMidnightDateRef.current = today;
          trySpeak(`${getUserName()}，已经过了零点了。早点休息，明天还有时间。`, midnightPromptedRef);
        }
      }

      // ============================================================
      // 场景 12：键盘爆发 — 连续快速打字 30 秒
      // ============================================================
      if (!waveActive && !isIdle) {
        const sinceLastKey = now - lastKeystrokeTimeRef.current;
        if (sinceLastKey < 3000 && keystrokeBurstStartRef.current === 0) {
          keystrokeBurstStartRef.current = now;
        }
        if (sinceLastKey > 5000) {
          keystrokeBurstStartRef.current = 0;
        }
        if (
          keystrokeBurstStartRef.current > 0 &&
          now - keystrokeBurstStartRef.current > 30000 &&
          !keystrokeBurstPromptedRef.current
        ) {
          keystrokeBurstPromptedRef.current = true;
          trySpeak(`${getUserName()}，键盘敲得飞快，写作灵感来了？需要我帮你整理思路或者润色文字吗？`, keystrokeBurstPromptedRef);
        }
      }
      // 活动间隙重置键盘爆发守卫
      if (isIdle) {
        keystrokeBurstStartRef.current = 0;
        keystrokeBurstPromptedRef.current = false;
      }

      // ============================================================
      // 场景 13：整点里程碑
      // ============================================================
      if (!waveActive && sessionHours >= 3 && sessionMinutes % 60 < 2) {
        const prompt = getMilestonePrompt(sessionHours, state.mouseClicks, state.keystrokes);
        if (prompt && !milestonePromptedRef.current[sessionHours]) {
          milestonePromptedRef.current[sessionHours] = true;
          speak(prompt);
        }
      }
      // 重置里程碑守卫（跨小时后可再触发）
      if (sessionMinutes % 60 > 5) {
        // 不清除已触发的，里程碑每小时只触发一次
      }
      // 新的一小时重置未触发的保护
      if (sessionMinutes % 60 < 2) {
        // 只有当前小时触发
      }

      // ============================================================
      // 场景 14：长时间无点击仅键盘操作
      // ============================================================
      if (
        !waveActive &&
        !isIdle &&
        state.keystrokes > 300 &&
        state.mouseClicks < 5 &&
        sessionMinutes > 15 &&
        !keyboardOnlyPromptedRef.current
      ) {
        // 纯键盘流 — 可能在写代码
        trySpeak(`${getUserName()}，看起来你在纯键盘操作。在写代码吗？有需要随时叫我。`, keyboardOnlyPromptedRef);
      }

      // ============================================================
      // 场景 15：标签页频繁切换
      // ============================================================
      if (
        !waveActive &&
        state.tabToggleCount > 20 &&
        sessionMinutes > 10 &&
        !tabTogglePromptedRef.current
      ) {
        trySpeak(`${getUserName()}，看到你在频繁切换窗口。是在对比资料吗？我可以帮你把信息整合到画布上。`, tabTogglePromptedRef);
      }

      // ============================================================
      // 场景 16：工作起步 — 邀请背景音乐（仅话术，等用户语音确认）
      // ============================================================
      if (
        ENABLE_PROACTIVE_MUSIC &&
        !waveActive &&
        !isIdle &&
        sessionMinutes >= 5 &&
        sessionMinutes <= 45 &&
        state.mouseClicks + state.keystrokes >= 80 &&
        !isMusicCurrentlyPlaying() &&
        !musicInvitePromptedRef.current
      ) {
        trySpeak(
          `${getUserName()}，要不要来点背景音乐？说「来点音乐」或「放首轻音乐」就行。`,
          musicInvitePromptedRef,
        );
      }

      // ============================================================
      // 场景 17：长时间 / 深夜工作 — 主动播放轻音乐
      // ============================================================
      const hour = new Date().getHours();
      const isLateNight = hour >= 23 || hour < 5;
      const longWorkSession =
        sessionHours >= 2 ||
        (sessionHours >= 1 && state.mouseClicks + state.keystrokes > 1500);
      if (
        ENABLE_PROACTIVE_MUSIC &&
        !waveActive &&
        !isIdle &&
        sessionMinutes >= 30 &&
        longWorkSession &&
        (isLateNight || sessionHours >= 2) &&
        !isMusicCurrentlyPlaying() &&
        !musicAmbientPlayedRef.current
      ) {
        trySpeakWithAmbientMusic('工作挺久了，', musicAmbientPlayedRef);
      }

      prevIdleRef.current = isIdle;
    }, IDLE_CHECK_INTERVAL);

    return () => clearInterval(timer);
  }, [idleThresholdMinutes, workIntensityThresholdHours, voiceCtx, markSessionGreeted, setIdleStart, clearIdle, setTabHidden, clearTabHidden]);

  // ---- 标签可见性回归的即时响应（不用等定时器） ----
  useEffect(() => {
    if (!voiceCtx) return;

    const onVisible = () => {
      const state = useVoiceAssistantActivityStore.getState();
      const now = Date.now();
      if (state.tabHiddenTimestamp > 0) {
        const hiddenDuration = now - state.tabHiddenTimestamp;
        if (hiddenDuration > 300000 && !voiceCtx.waveActive) {
          // 超过 5 分钟即时问候
          const mins = Math.round(hiddenDuration / 60000);
          if (Date.now() > cooldownUntilRef.current) {
            cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
            speak(`${getUserName()}，${mins}分钟不见，欢迎回来。`);
          }
        }
        clearTabHidden();
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) onVisible();
    });
  }, [voiceCtx, clearTabHidden]);
}

/** 供外部调用：记录一次 Agent 错误。连续错误达到阈值时自动触发提示。 */
export function reportAgentError() {
  useVoiceAssistantActivityStore.getState().recordError();
}

/** 挂载于 VoiceAssistantProvider 内部，驱动主动场景检测 */
export function VoiceAssistantProactiveHost(opts: ProactiveInteractionOptions) {
  useVoiceAssistantProactiveInteraction(opts);
  return null;
}
