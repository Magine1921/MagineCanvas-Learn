'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

interface GenerationEtaProps {
  active: boolean;
  progress?: number;
  estimateKey: string;
  sessionKey?: string;
  defaultTotalSeconds?: number;
  className?: string;
}

interface EtaSession {
  startedAt: number;
  lastProgress: number;
}

const ETA_HISTORY_PREFIX = 'magine-generation-eta-v1:';
const ETA_HISTORY_LIMIT = 8;
const activeEtaSessions = new Map<string, EtaSession>();
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
let clockSecond = Math.floor(Date.now() / 1000);

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockTimer === null) {
    clockTimer = setInterval(() => {
      clockSecond = Math.floor(Date.now() / 1000);
      for (const notify of clockListeners) notify();
    }, 1_000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

function getClockSnapshot(): number {
  return clockSecond;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function storageKey(estimateKey: string): string {
  return `${ETA_HISTORY_PREFIX}${encodeURIComponent(estimateKey.slice(0, 180))}`;
}

function readDurations(estimateKey: string): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(estimateKey)) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((value): value is number => Number.isFinite(value) && value >= 2 && value <= 24 * 60 * 60)
      : [];
  } catch {
    return [];
  }
}

function rememberDuration(estimateKey: string, durationSeconds: number): void {
  if (typeof window === 'undefined' || !Number.isFinite(durationSeconds)) return;
  try {
    const next = [...readDurations(estimateKey), Math.round(durationSeconds)].slice(-ETA_HISTORY_LIMIT);
    window.localStorage.setItem(storageKey(estimateKey), JSON.stringify(next));
  } catch {
    // Local history is an optimization. Generation must not depend on it.
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function formatGenerationDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}小时${String(minutes).padStart(2, '0')}分`;
  if (minutes > 0) return `${minutes}分${String(remainder).padStart(2, '0')}秒`;
  return `${remainder}秒`;
}

export function estimateGenerationRemainingSeconds(
  elapsedSeconds: number,
  progress: number,
  baselineSeconds: number,
): number {
  const elapsed = Math.max(0, elapsedSeconds);
  const baseline = clamp(baselineSeconds, 5, 24 * 60 * 60);
  const normalizedProgress = clamp(progress, 0, 99.5);

  if (normalizedProgress < 1) {
    const adjustedTotal = elapsed >= baseline ? elapsed * 1.25 : baseline;
    return Math.max(1, adjustedTotal - elapsed);
  }

  const projectedTotal = elapsed / (normalizedProgress / 100);
  const progressTrust = clamp((normalizedProgress - 10) / 85, 0, 0.9);
  const estimatedTotal = Math.max(
    elapsed + (normalizedProgress >= 98 ? 2 : 5),
    baseline * (1 - progressTrust) + projectedTotal * progressTrust,
  );
  return Math.max(1, estimatedTotal - elapsed);
}

export function GenerationEta({
  active,
  progress = 0,
  estimateKey,
  sessionKey,
  defaultTotalSeconds = 90,
  className,
}: GenerationEtaProps) {
  const normalizedKey = estimateKey.trim() || 'generation';
  const normalizedSessionKey = sessionKey?.trim() || normalizedKey;
  const now = useSyncExternalStore(subscribeClock, getClockSnapshot, () => 0) * 1_000;
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const previousActiveRef = useRef(false);
  const baselineSeconds = useMemo(() => {
    const learned = median(readDurations(normalizedKey));
    return learned ?? defaultTotalSeconds;
  }, [defaultTotalSeconds, normalizedKey]);

  useEffect(() => {
    let cancelled = false;
    const normalizedProgress = clamp(Number(progress) || 0, 0, 100);
    if (active) {
      let session = activeEtaSessions.get(normalizedSessionKey);
      if (!session || normalizedProgress + 12 < session.lastProgress) {
        session = { startedAt: Date.now(), lastProgress: normalizedProgress };
        activeEtaSessions.set(normalizedSessionKey, session);
      } else {
        session.lastProgress = Math.max(session.lastProgress, normalizedProgress);
      }
      const nextStartedAt = session.startedAt;
      queueMicrotask(() => {
        if (cancelled) return;
        setStartedAt(nextStartedAt);
      });
    } else {
      const session = activeEtaSessions.get(normalizedSessionKey);
      if (previousActiveRef.current && session) {
        if (normalizedProgress >= 99) {
          rememberDuration(normalizedKey, (Date.now() - session.startedAt) / 1000);
        }
        activeEtaSessions.delete(normalizedSessionKey);
      }
      queueMicrotask(() => {
        if (!cancelled) setStartedAt(null);
      });
    }
    previousActiveRef.current = active;
    return () => {
      cancelled = true;
    };
  }, [active, normalizedKey, normalizedSessionKey, progress]);

  if (!active || startedAt === null) return null;

  const elapsedSeconds = Math.max(0, (now - startedAt) / 1000);
  const remainingSeconds = estimateGenerationRemainingSeconds(
    elapsedSeconds,
    Number(progress) || 0,
    baselineSeconds,
  );
  const remainingLabel = remainingSeconds <= 10
    ? '预计即将完成'
    : `预计剩余约 ${formatGenerationDuration(remainingSeconds)}`;

  return (
    <span
      className={cn('whitespace-nowrap text-[9px] font-normal text-zinc-300/90', className)}
      title={`已用时 ${formatGenerationDuration(elapsedSeconds)}，${remainingLabel}`}
    >
      已用时 {formatGenerationDuration(elapsedSeconds)} · {remainingLabel}
    </span>
  );
}
