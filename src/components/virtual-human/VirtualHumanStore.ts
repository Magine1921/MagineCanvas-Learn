'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AIVirtualHumanCard {
  id: string;
  name: string;
  prompt: string;
  thumbnailUrl?: string;
  referenceImageUrl?: string;
  sourceMaterialName?: string;
  sourceMaterialSlug?: string;
  createdAt: number;
  updatedAt: number;
}

interface UpsertVirtualHumanCardInput {
  id?: string;
  name: string;
  prompt: string;
  thumbnailUrl?: string;
  referenceImageUrl?: string;
  sourceMaterialName?: string;
  sourceMaterialSlug?: string;
}

interface VirtualHumanStore {
  cards: AIVirtualHumanCard[];
  upsertCard: (input: UpsertVirtualHumanCardInput) => string;
  removeCard: (id: string) => void;
}

function createCardId() {
  return `vh_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function buildDefaultVirtualHumanPrompt(name: string) {
  return [
    `虚构 AI 虚拟角色：${name}`,
    '保持同一角色的脸型、发型、服装气质、年龄感和整体辨识度一致。',
    '这是原创虚拟角色，不指向任何真实人物身份，不复刻公众人物或真人肖像。',
  ].join('\n');
}

export function formatVirtualHumanPrompt(card: AIVirtualHumanCard) {
  return [
    `【AI虚拟人角色卡：${card.name}】`,
    card.prompt,
    '生成视频时以这张角色卡作为主角设定；不要依赖或上传人脸参考图。',
  ]
    .filter(Boolean)
    .join('\n');
}

export const useVirtualHumanStore = create<VirtualHumanStore>()(
  persist(
    (set) => ({
      cards: [],
      upsertCard: (input) => {
        const now = Date.now();
        const id = input.id || createCardId();
        const name = input.name.trim() || 'AI虚拟人';
        const prompt = input.prompt.trim() || buildDefaultVirtualHumanPrompt(name);

        set((state) => {
          const existing = state.cards.find((card) => card.id === id);
          const next: AIVirtualHumanCard = {
            id,
            name,
            prompt,
            thumbnailUrl: input.thumbnailUrl || existing?.thumbnailUrl,
            referenceImageUrl: input.referenceImageUrl || existing?.referenceImageUrl,
            sourceMaterialName: input.sourceMaterialName || existing?.sourceMaterialName,
            sourceMaterialSlug: input.sourceMaterialSlug || existing?.sourceMaterialSlug,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
          };

          const cards = existing
            ? state.cards.map((card) => (card.id === id ? next : card))
            : [next, ...state.cards];

          return { cards };
        });

        return id;
      },
      removeCard: (id) =>
        set((state) => ({
          cards: state.cards.filter((card) => card.id !== id),
        })),
    }),
    {
      name: 'ai-virtual-human-library',
      partialize: (state) => ({ cards: state.cards }),
    }
  )
);
