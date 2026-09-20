'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { MC_CHROME_ENTRANCE_SCALE_START, MC_CHROME_ENTRANCE_TF } from '@/lib/motion';
import { useVoiceAssistant } from '@/components/voice/voiceAssistantContext';
import { TriangleAlert } from 'lucide-react';

const W = 800;
const H = 120;
const MID = H / 2;

const LINE_COLORS = ['#fbbf24', '#22d3ee', '#fb923c', '#7dd3fc'];
const EDGE_AMPLITUDE_POW = 2.35;

const MAX_VISIBLE_CHARS = 35;
const MAX_THINKING_VISIBLE_CHARS = 56;
/** TTS 启动前的宽限期（ms），期间不显示任何文字，确保不出声先出字 */
const TTS_START_GRACE_MS = 1500;

function cleanSubtitleText(text: string): string {
  return text
    .replace(/[^一-鿿㐀-䶿a-zA-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeLineStarts(text: string, maxChars: number): number[] {
  if (text.length <= maxChars) return [0];
  const starts: number[] = [0];
  let pos = 0;
  while (pos + maxChars < text.length) {
    const breakAt = pos + maxChars;
    let splitIdx = text.lastIndexOf(' ', breakAt);
    if (splitIdx <= pos) splitIdx = breakAt;
    pos = splitIdx + 1;
    starts.push(pos);
  }
  return starts;
}

/** 返回 TTS 当前进度对应的完整段文字（不逐字，整段显示） */
function getCurrentSegment(text: string, starts: number[], revealedTotal: number): string {
  if (revealedTotal <= 0 || starts.length === 0) return '';
  let segIdx = 0;
  for (let i = starts.length - 1; i >= 0; i--) {
    if (revealedTotal > starts[i]!) { segIdx = i; break; }
  }
  const segStart = starts[segIdx]!;
  const segEnd = segIdx + 1 < starts.length ? starts[segIdx + 1]! : text.length;
  return text.slice(segStart, segEnd);
}

function buildWavePath(
  phase: number,
  timeMs: number,
  level: number,
  active: boolean
): string {
  const amp = active ? 6 + 38 * Math.pow(level, 0.85) : 0;
  let d = `M 0 ${MID}`;
  const steps = 140;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = u * W;
    const taper = Math.pow(Math.sin(Math.PI * u), EDGE_AMPLITUDE_POW);
    const wob =
      taper *
      amp *
      (0.42 * Math.sin(u * Math.PI * 11 + timeMs * 0.0033 + phase) +
        0.33 * Math.sin(u * Math.PI * 7 - timeMs * 0.0024 + phase * 1.2) +
        0.25 * Math.sin(u * Math.PI * 17 + timeMs * 0.0048 + phase * 0.7));
    d += ` L ${x.toFixed(1)} ${(MID + wob).toFixed(1)}`;
  }
  return d;
}

export function WelcomeVoiceWave({ chromeReveal = true }: { chromeReveal?: boolean }) {
  const {
    waveActive,
    subtitleText,
    subtitleMode,
    ttsNotice,
    subtitlePlaybackOpacity,
    ttsRevealChars,
    audioLevelRef,
    toggleListen,
    error,
    liveTranscript,
  } = useVoiceAssistant();

  const pathEls = useRef<(SVGPathElement | null)[]>([]);
  const [displayLine, setDisplayLine] = useState('');
  const ttsRevealRef = useRef(ttsRevealChars);
  ttsRevealRef.current = ttsRevealChars;
  const isNoticeLine = ttsNotice.trim().length > 0;
  const isThinkingLine = subtitleMode === 'thinking' && displayLine.length > 0 && !liveTranscript.trim();

  // 字幕整段显示，段切换跟随 TTS 进度；用户语音转录时完整显示
  useEffect(() => {
    const notice = ttsNotice.trim();
    if (notice) {
      setDisplayLine(notice);
      return;
    }

    const isUserTranscript = liveTranscript.trim().length > 0;

    if (isUserTranscript) {
      setDisplayLine(cleanSubtitleText(subtitleText));
      return;
    }

    if (subtitleText && subtitlePlaybackOpacity > 0) {
      const raw = subtitleText;
      const fullClean = cleanSubtitleText(raw);
      if (!fullClean) { setDisplayLine(''); return; }

      if (subtitleMode === 'thinking') {
        const starts = computeLineStarts(fullClean, MAX_THINKING_VISIBLE_CHARS);
        setDisplayLine(getCurrentSegment(fullClean, starts, fullClean.length));
        return;
      }

      const starts = computeLineStarts(fullClean, MAX_VISIBLE_CHARS);
      const startTime = performance.now();
      let raf = 0;

      const tick = () => {
        const chars = ttsRevealRef.current;
        const elapsed = performance.now() - startTime;
        let revealedCleanLen: number;
        if (chars > 0) {
          const revealedRaw = Math.min(chars, raw.length);
          revealedCleanLen = cleanSubtitleText(raw.slice(0, revealedRaw)).length;
        } else if (elapsed < TTS_START_GRACE_MS) {
          revealedCleanLen = 0;
        } else {
          revealedCleanLen = 0; // 超时仍无 TTS 进度则不显示（不回退到估算，避免文字领先语音）
        }
        setDisplayLine(getCurrentSegment(fullClean, starts, revealedCleanLen));
        if (revealedCleanLen < fullClean.length) {
          raf = requestAnimationFrame(tick);
        }
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    } else {
      setDisplayLine('');
    }
  }, [subtitleText, subtitleMode, subtitlePlaybackOpacity, liveTranscript, ttsNotice]);

  useEffect(() => {
    let id = 0;
    const tick = (time: number) => {
      const lv = audioLevelRef.current;
      pathEls.current.forEach((el, i) => {
        if (!el) return;
        const phase = i * 1.17;
        el.setAttribute('d', buildWavePath(phase, time, lv, true));
      });
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [audioLevelRef]);

  if (!waveActive) {
    return (
      <div
        className={cn(
          'pointer-events-none fixed bottom-10 left-1/2 z-[45] -translate-x-1/2 select-none',
          chromeReveal
            ? cn('translate-y-0 scale-100 visible', MC_CHROME_ENTRANCE_TF)
            : cn('translate-y-[110vh]', MC_CHROME_ENTRANCE_SCALE_START, 'invisible transition-none')
        )}
      >
        <button
          type="button"
          onClick={toggleListen}
          className="pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full outline-none"
          title="开始语音"
          aria-pressed={false}
        >
          <span className="absolute inset-0 rounded-full blur-md bg-gradient-to-br from-amber-400/40 via-orange-400/35 to-cyan-400/35" />
          <span className="absolute inset-[3px] rounded-full border border-white/25 bg-[#0c0f12]/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]" />
          <span className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-amber-200/90 to-cyan-200/75 shadow-[0_0_22px_rgba(251,191,36,0.45)]">
            <span className="block h-3 w-3 rounded-full bg-white/90 shadow-[0_0_12px_rgba(255,255,255,0.9)]" />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'pointer-events-auto fixed bottom-10 left-1/2 z-[45] flex w-[min(92vw,760px)] origin-bottom -translate-x-1/2 flex-col items-center gap-2 select-none cursor-pointer',
        chromeReveal
          ? cn('translate-y-0 scale-100 visible', MC_CHROME_ENTRANCE_TF)
          : cn('translate-y-[110vh]', MC_CHROME_ENTRANCE_SCALE_START, 'invisible transition-none')
      )}
      onClick={toggleListen}
    >
      <div
        className={cn(
          'pointer-events-none min-h-[1.75rem] w-full text-center leading-snug',
          isNoticeLine
            ? 'max-w-[min(92%,680px)] rounded-md border border-amber-300/25 bg-[#120d04]/80 px-3 py-2 text-xs font-medium text-amber-200 shadow-[0_8px_28px_rgba(0,0,0,0.35)]'
            : cn('max-w-[min(92%,560px)] px-4', isThinkingLine ? 'text-[11px] font-light text-zinc-400/70' : 'text-sm font-medium text-white')
        )}
        style={{
          opacity: displayLine ? (isNoticeLine ? 1 : subtitlePlaybackOpacity * (isThinkingLine ? 0.68 : 1)) : 0,
          transition: 'opacity 0.3s',
          textShadow: isNoticeLine
            ? '0 1px 2px rgba(0,0,0,0.7)'
            : isThinkingLine
            ? '0 1px 1px rgba(0,0,0,0.38)'
            : '0 1px 2px rgba(0,0,0,0.92), 0 2px 14px rgba(0,0,0,0.55), 0 0 1px rgba(0,0,0,0.9)',
        }}
      >
        {displayLine}
      </div>

      <div className="relative h-[120px] w-full">
        <svg
          className="h-full w-full overflow-visible"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          <defs>
            <linearGradient
              id="mc-voice-line-fade-w"
              gradientUnits="userSpaceOnUse"
              x1="0" y1="0" x2={W} y2="0"
            >
              <stop offset="0%" stopColor="#fff" stopOpacity="0" />
              <stop offset="11%" stopColor="#fff" stopOpacity="0.4" />
              <stop offset="24%" stopColor="#fff" stopOpacity="1" />
              <stop offset="76%" stopColor="#fff" stopOpacity="1" />
              <stop offset="89%" stopColor="#fff" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id="mc-voice-line-mask-w" maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
              <rect width={W} height={H} fill="url(#mc-voice-line-fade-w)" />
            </mask>
            <filter id="mc-voice-glow" x="-20%" y="-60%" width="140%" height="220%">
              <feGaussianBlur stdDeviation="2.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g mask="url(#mc-voice-line-mask-w)">
            {LINE_COLORS.map((stroke, i) => (
              <path
                key={stroke}
                ref={(el) => { pathEls.current[i] = el; }}
                fill="none"
                stroke={stroke}
                strokeWidth={i === 0 || i === 1 ? 1.65 : 1.15}
                strokeLinecap="butt"
                strokeLinejoin="round"
                opacity={i < 2 ? 0.95 : 0.55}
                filter="url(#mc-voice-glow)"
                d={`M 0 ${MID} L ${W} ${MID}`}
              />
            ))}
          </g>
        </svg>
      </div>

      {error && (
        <div className="pointer-events-auto max-w-md w-full mx-auto px-4">
          <div className="bg-red-900/80 backdrop-blur-md border border-red-500/50 rounded-xl p-4 shadow-lg">
            <div className="flex items-start gap-3">
              <TriangleAlert className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-100 leading-relaxed">{error}</p>
                {error.includes('权限') && (
                  <p className="text-xs text-red-300 mt-2">
                    💡 提示：通常可以在浏览器地址栏左侧点击锁图标来重新允许麦克风权限
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
