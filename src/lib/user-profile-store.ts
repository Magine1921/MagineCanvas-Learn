'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UserProfile {
  /** 用户称呼，默认「马老师」 */
  name: string;
  /** 是否已完成初次问候 */
  onboarded: boolean;
}

interface UserProfileStore {
  profile: UserProfile;
  setName: (name: string) => void;
  markOnboarded: () => void;
  resetProfile: () => void;
}

const DEFAULT_NAME = '马老师';

const defaultProfile: UserProfile = {
  name: DEFAULT_NAME,
  onboarded: false,
};

export const useUserProfileStore = create<UserProfileStore>()(
  persist(
    (set) => ({
      profile: { ...defaultProfile },

      setName: (name) =>
        set((s) => ({
          profile: { ...s.profile, name: name.trim() || DEFAULT_NAME },
        })),

      markOnboarded: () =>
        set((s) => ({
          profile: { ...s.profile, onboarded: true },
        })),

      resetProfile: () => set({ profile: { ...defaultProfile } }),
    }),
    {
      name: 'magine-user-profile',
      partialize: (state) => ({ profile: state.profile }),
      merge: (persisted, current) => {
        const p = persisted as { profile?: Partial<UserProfile> } | undefined;
        return {
          ...current,
          profile: {
            name: p?.profile?.name?.trim() || DEFAULT_NAME,
            onboarded: Boolean(p?.profile?.onboarded),
          },
        };
      },
    }
  )
);

/** 获取当前用户名（纯函数，可在任何地方调用） */
export function getUserName(): string {
  return useUserProfileStore.getState().profile.name || DEFAULT_NAME;
}

/** 获取系统提示词中用到的用户身份描述 */
export function getUserIdentityDescription(): string {
  const name = getUserName();
  if (name === DEFAULT_NAME) {
    return '马老师正在打造自动化自媒体平台和 AIGC 课程的个体户/导演';
  }
  return `${name}，正在使用 MagineCanvas 进行创作和工作`;
}
