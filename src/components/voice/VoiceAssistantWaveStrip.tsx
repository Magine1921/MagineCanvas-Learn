'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { cn } from '@/lib/utils';

/** 与 CanvasVoiceWave 一致的多色与边缘衰减 */
const LINE_COLORS = ['#fbbf24', '#22d3ee', '#fb923c', '#7dd3fc'] as const;
const EDGE_AMPLITUDE_POW = 2.35;

const VB_W = 240;
const VB_H = 36;
const MID_Y = VB_H / 2;

/** 横向震动线（语音助手同款数学形态，沿 X 前进、Y 摆动） */
function buildWavePathHorizontal(
  phase: number,
  timeMs: number,
  level: number,
  active: boolean,
  intensity: number
): string {
  const amp = active ? (1.1 + 6.8 * Math.pow(Math.max(0, Math.min(1, level)), 0.72)) * intensity : 0;
  let d = `M 0 ${MID_Y}`;
  const steps = 140;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = u * VB_W;
    const taper = Math.pow(Math.sin(Math.PI * u), EDGE_AMPLITUDE_POW);
    const wob =
      taper *
      amp *
      (0.42 * Math.sin(u * Math.PI * 11 + timeMs * 0.0033 + phase) +
        0.33 * Math.sin(u * Math.PI * 7 - timeMs * 0.0024 + phase * 1.2) +
        0.25 * Math.sin(u * Math.PI * 17 + timeMs * 0.0048 + phase * 0.7));
    d += ` L ${x.toFixed(1)} ${(MID_Y + wob).toFixed(1)}`;
  }
  return d;
}

export type VoiceAssistantWaveStripProps = {
  active: boolean;
  /** 0–1，不传时在 active 下用轻微起伏模拟「有声」 */
  audioLevel?: number;
  audioLevelRef?: RefObject<number | undefined>;
  forceMotion?: boolean;
  intensity?: number;
  motionSpeed?: number;
  className?: string;
};

/**
 * 与画布语音助手相同的「多色震动线」视觉，横向条带，用于 Agent 等紧凑区域。
 */
export function VoiceAssistantWaveStrip({
  active,
  audioLevel,
  audioLevelRef: externalAudioLevelRef,
  forceMotion = false,
  intensity = 1,
  motionSpeed = 1,
  className,
}: VoiceAssistantWaveStripProps) {
  const pathEls = useRef<(SVGPathElement | null)[]>([]);
  const syntheticRef = useRef(0.38);
  const audioLevelRef = useRef<number | undefined>(audioLevel);
  const visualLevelRef = useRef(0.38);
  const lastInputLevelRef = useRef<number | undefined>(undefined);
  const flatInputFramesRef = useRef(0);

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    if (!active) {
      pathEls.current.forEach((el) => {
        if (el) el.setAttribute('d', `M 0 ${MID_Y} L ${VB_W} ${MID_Y}`);
      });
      return;
    }
    let id = 0;
    const getSyntheticLevel = (time: number) => {
      const base = forceMotion ? 0.56 : 0.32;
      const swing = forceMotion ? 0.34 : 0.14;
      syntheticRef.current =
        base +
        swing * (
          0.55 * Math.sin(time * 0.0048) +
          0.28 * Math.sin(time * 0.0081 + 1.7) +
          0.17 * Math.sin(time * 0.0126 + 0.4)
        );
      return syntheticRef.current;
    };
    const tick = (time: number) => {
      let level: number;
      const inputLevel = externalAudioLevelRef?.current ?? audioLevelRef.current;
      if (typeof inputLevel === 'number') {
        const targetLevel = Math.max(0, Math.min(1, inputLevel));
        const previous = lastInputLevelRef.current;
        if (typeof previous === 'number' && Math.abs(previous - targetLevel) < 0.006) {
          flatInputFramesRef.current += 1;
        } else {
          flatInputFramesRef.current = 0;
        }
        lastInputLevelRef.current = targetLevel;
        const syntheticLevel = getSyntheticLevel(time);
        const effectiveTarget =
          forceMotion && (flatInputFramesRef.current > 18 || targetLevel <= 0.14)
            ? syntheticLevel
            : Math.max(targetLevel, forceMotion ? syntheticLevel * 0.28 : 0);
        visualLevelRef.current = visualLevelRef.current * 0.32 + effectiveTarget * 0.68;
        level = visualLevelRef.current;
      } else {
        flatInputFramesRef.current = 0;
        lastInputLevelRef.current = undefined;
        level = getSyntheticLevel(time);
      }
      pathEls.current.forEach((el, i) => {
        if (!el) return;
        const phase = i * 1.17;
        el.setAttribute('d', buildWavePathHorizontal(phase, time * motionSpeed, level, true, intensity));
      });
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [active, externalAudioLevelRef, forceMotion, intensity, motionSpeed]);

  return (
    <div className={cn('nodrag nopan flex w-full justify-center', className)} aria-hidden>
      <svg
        className="h-5 w-full max-w-full overflow-visible"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient
            id="mc-agent-voice-line-fade-h"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1={MID_Y}
            x2={VB_W}
            y2={MID_Y}
          >
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="8%" stopColor="#fff" stopOpacity="0.45" />
            <stop offset="18%" stopColor="#fff" stopOpacity="1" />
            <stop offset="82%" stopColor="#fff" stopOpacity="1" />
            <stop offset="92%" stopColor="#fff" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="mc-agent-voice-line-mask-h" maskUnits="userSpaceOnUse" x="0" y="0" width={VB_W} height={VB_H}>
            <rect width={VB_W} height={VB_H} fill="url(#mc-agent-voice-line-fade-h)" />
          </mask>
          <filter id="mc-agent-voice-glow-h" x="-12%" y="-160%" width="124%" height="420%">
            <feGaussianBlur stdDeviation="1.1" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g mask="url(#mc-agent-voice-line-mask-h)">
          {LINE_COLORS.map((stroke, i) => (
            <path
              key={stroke}
              ref={(el) => {
                pathEls.current[i] = el;
              }}
              fill="none"
              stroke={stroke}
              strokeWidth={i === 0 || i === 1 ? 1.45 : 1.05}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={active ? (i < 2 ? 0.92 : 0.52) : 0.12}
              filter="url(#mc-agent-voice-glow-h)"
              d={`M 0 ${MID_Y} L ${VB_W} ${MID_Y}`}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
