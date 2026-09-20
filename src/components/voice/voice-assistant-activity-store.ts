import { create } from 'zustand';

export interface ActivitySnapshot {
  mouseClicks: number;
  keystrokes: number;
  scrollDistance: number;
  copyPasteCount: number;
  timestamp: number;
}

interface VoiceAssistantActivityState {
  lastSessionDate: string;
  lastActivityTimestamp: number;
  sessionStartTimestamp: number;
  mouseClicks: number;
  keystrokes: number;
  scrollDistance: number;
  copyPasteCount: number;
  /** 本次会话是否已被问候过（开场白） */
  sessionGreeted: boolean;
  /** 当前空闲开始时间戳，0 表示非空闲 */
  idleStartTimestamp: number;
  /** 上次空闲结束时的快照（用于回归检测） */
  lastIdleSnapshot: ActivitySnapshot | null;
  /** 连续生成失败次数（外部喂入） */
  consecutiveErrors: number;
  /** 上次标签页隐藏的时间戳，0 表示当前可见 */
  tabHiddenTimestamp: number;
  /** 标签页隐藏/恢复次数 */
  tabToggleCount: number;

  setLastSessionDate: (date: string) => void;
  resetWorkSession: () => void;
  recordActivity: () => void;
  incrementMouseClicks: (n?: number) => void;
  incrementKeystrokes: (n?: number) => void;
  addScrollDistance: (px: number) => void;
  incrementCopyPaste: (n?: number) => void;
  markSessionGreeted: () => void;
  setIdleStart: (ts: number) => void;
  clearIdle: (snapshot: ActivitySnapshot) => void;
  recordError: () => void;
  clearErrors: () => void;
  setTabHidden: (ts: number) => void;
  clearTabHidden: () => void;
}

export const useVoiceAssistantActivityStore = create<VoiceAssistantActivityState>((set) => ({
  lastSessionDate: '',
  lastActivityTimestamp: Date.now(),
  sessionStartTimestamp: Date.now(),
  mouseClicks: 0,
  keystrokes: 0,
  scrollDistance: 0,
  copyPasteCount: 0,
  sessionGreeted: false,
  idleStartTimestamp: 0,
  lastIdleSnapshot: null,
  consecutiveErrors: 0,
  tabHiddenTimestamp: 0,
  tabToggleCount: 0,

  setLastSessionDate: (date) => set({ lastSessionDate: date }),

  resetWorkSession: () =>
    set({
      sessionStartTimestamp: Date.now(),
      lastActivityTimestamp: Date.now(),
      mouseClicks: 0,
      keystrokes: 0,
      scrollDistance: 0,
      copyPasteCount: 0,
      sessionGreeted: false,
      idleStartTimestamp: 0,
      lastIdleSnapshot: null,
      consecutiveErrors: 0,
      tabHiddenTimestamp: 0,
      tabToggleCount: 0,
    }),

  recordActivity: () => set({ lastActivityTimestamp: Date.now() }),

  incrementMouseClicks: (n = 1) =>
    set((s) => ({ mouseClicks: s.mouseClicks + n, lastActivityTimestamp: Date.now() })),

  incrementKeystrokes: (n = 1) =>
    set((s) => ({ keystrokes: s.keystrokes + n, lastActivityTimestamp: Date.now() })),

  addScrollDistance: (px) =>
    set((s) => ({ scrollDistance: s.scrollDistance + Math.abs(px), lastActivityTimestamp: Date.now() })),

  incrementCopyPaste: (n = 1) =>
    set((s) => ({ copyPasteCount: s.copyPasteCount + n, lastActivityTimestamp: Date.now() })),

  markSessionGreeted: () => set({ sessionGreeted: true }),

  setIdleStart: (ts) => set({ idleStartTimestamp: ts }),

  clearIdle: (snapshot) =>
    set({
      idleStartTimestamp: 0,
      lastIdleSnapshot: snapshot,
    }),

  recordError: () =>
    set((s) => ({ consecutiveErrors: s.consecutiveErrors + 1 })),

  clearErrors: () => set({ consecutiveErrors: 0 }),

  setTabHidden: (ts) =>
    set((s) => ({ tabHiddenTimestamp: ts, tabToggleCount: s.tabToggleCount + 1 })),

  clearTabHidden: () => set({ tabHiddenTimestamp: 0 }),
}));
