'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export type CanvasPerformanceProfile = 'normal' | 'balanced' | 'dense';

export interface CanvasPerformanceSnapshot {
  profile: CanvasPerformanceProfile;
  nodeCount: number;
  edgeCount: number;
  p95FrameMs: number;
  slowFrameCount: number;
  mountedVideoCount: number;
  playingVideoCount: number;
  sampledAt: number;
}

declare global {
  interface Window {
    __magineCanvasPerformance?: CanvasPerformanceSnapshot;
  }
}

const SAMPLE_WINDOW_MS = 2_000;
const MAX_FRAME_SAMPLES = 240;
const SLOW_FRAME_MS = 50;

export function canvasPerformanceProfileForLoad(
  nodeCount: number,
  edgeCount: number,
): CanvasPerformanceProfile {
  if (nodeCount >= 180 || edgeCount >= 360) return 'dense';
  if (nodeCount >= 60 || edgeCount >= 120) return 'balanced';
  return 'normal';
}

function profileRank(profile: CanvasPerformanceProfile): number {
  return profile === 'dense' ? 2 : profile === 'balanced' ? 1 : 0;
}

function profileAtRank(rank: number): CanvasPerformanceProfile {
  return rank >= 2 ? 'dense' : rank >= 1 ? 'balanced' : 'normal';
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

export function useCanvasPerformanceGovernor(
  nodeCount: number,
  edgeCount: number,
  forceLite: boolean,
): CanvasPerformanceSnapshot {
  const densityProfile = useMemo(
    () => canvasPerformanceProfileForLoad(nodeCount, edgeCount),
    [edgeCount, nodeCount],
  );
  const [runtimeRank, setRuntimeRank] = useState(0);
  const [metrics, setMetrics] = useState(() => ({
    p95FrameMs: 0,
    slowFrameCount: 0,
    mountedVideoCount: 0,
    playingVideoCount: 0,
    sampledAt: Date.now(),
  }));
  const runtimeRankRef = useRef(0);
  const slowWindowsRef = useRef(0);
  const healthyWindowsRef = useRef(0);

  useEffect(() => {
    runtimeRankRef.current = runtimeRank;
  }, [runtimeRank]);

  useEffect(() => {
    let frame = 0;
    let lastFrameAt = performance.now();
    let lastSampleAt = lastFrameAt;
    let frameSamples: number[] = [];

    const tick = (now: number) => {
      const delta = now - lastFrameAt;
      lastFrameAt = now;
      if (document.visibilityState === 'visible' && delta > 0 && delta < 1_000) {
        frameSamples.push(delta);
        if (frameSamples.length > MAX_FRAME_SAMPLES) frameSamples.shift();
      }

      if (now - lastSampleAt >= SAMPLE_WINDOW_MS) {
        const p95FrameMs = percentile95(frameSamples);
        const slowFrameCount = frameSamples.filter((value) => value >= SLOW_FRAME_MS).length;
        const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('.mc-canvas-shell video'));
        const mountedVideoCount = videos.length;
        const playingVideoCount = videos.filter((video) => !video.paused && !video.ended).length;
        const unhealthy = p95FrameMs >= 34 || slowFrameCount >= 6 || mountedVideoCount > 5;
        const healthy = p95FrameMs > 0 && p95FrameMs <= 22 && slowFrameCount <= 1;

        if (unhealthy) {
          slowWindowsRef.current += 1;
          healthyWindowsRef.current = 0;
        } else if (healthy) {
          healthyWindowsRef.current += 1;
          slowWindowsRef.current = 0;
        } else {
          slowWindowsRef.current = 0;
          healthyWindowsRef.current = 0;
        }

        if (slowWindowsRef.current >= 2 && runtimeRankRef.current < 2) {
          slowWindowsRef.current = 0;
          setRuntimeRank((rank) => Math.min(2, rank + 1));
        } else if (healthyWindowsRef.current >= 8 && runtimeRankRef.current > 0) {
          healthyWindowsRef.current = 0;
          setRuntimeRank((rank) => Math.max(0, rank - 1));
        }

        setMetrics({
          p95FrameMs: Number(p95FrameMs.toFixed(1)),
          slowFrameCount,
          mountedVideoCount,
          playingVideoCount,
          sampledAt: Date.now(),
        });
        frameSamples = [];
        lastSampleAt = now;
      }
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const forcedRank = forceLite ? 1 : 0;
  const profile = profileAtRank(Math.max(profileRank(densityProfile), runtimeRank, forcedRank));
  const snapshot = useMemo<CanvasPerformanceSnapshot>(() => ({
    profile,
    nodeCount,
    edgeCount,
    ...metrics,
  }), [edgeCount, metrics, nodeCount, profile]);

  useEffect(() => {
    window.__magineCanvasPerformance = snapshot;
    return () => {
      if (window.__magineCanvasPerformance === snapshot) {
        delete window.__magineCanvasPerformance;
      }
    };
  }, [snapshot]);

  return snapshot;
}
