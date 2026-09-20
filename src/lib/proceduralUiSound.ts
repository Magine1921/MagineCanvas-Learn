type ProceduralUiSound = 'welcome' | 'canvas' | 'voice-click';

interface Tone {
  delay: number;
  duration: number;
  fromHz: number;
  toHz: number;
  volume: number;
  wave: OscillatorType;
}

const PRESETS: Record<ProceduralUiSound, Tone[]> = {
  welcome: [
    { delay: 0, duration: 0.38, fromHz: 196, toHz: 294, volume: 0.055, wave: 'sine' },
    { delay: 0.07, duration: 0.42, fromHz: 294, toHz: 440, volume: 0.04, wave: 'sine' },
  ],
  canvas: [
    { delay: 0, duration: 0.32, fromHz: 146, toHz: 220, volume: 0.06, wave: 'sine' },
    { delay: 0.04, duration: 0.3, fromHz: 293, toHz: 392, volume: 0.035, wave: 'triangle' },
  ],
  'voice-click': [
    { delay: 0, duration: 0.085, fromHz: 540, toHz: 760, volume: 0.045, wave: 'sine' },
    { delay: 0.025, duration: 0.1, fromHz: 310, toHz: 430, volume: 0.025, wave: 'triangle' },
  ],
};

let sharedContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedContext && sharedContext.state !== 'closed') return sharedContext;
  const AudioContextConstructor = window.AudioContext
    || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  sharedContext = new AudioContextConstructor();
  return sharedContext;
}

function schedulePreset(context: AudioContext, preset: ProceduralUiSound): void {
  const startAt = context.currentTime + 0.008;
  for (const tone of PRESETS[preset]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const toneStart = startAt + tone.delay;
    const toneEnd = toneStart + tone.duration;

    oscillator.type = tone.wave;
    oscillator.frequency.setValueAtTime(tone.fromHz, toneStart);
    oscillator.frequency.exponentialRampToValueAtTime(tone.toHz, toneEnd);
    gain.gain.setValueAtTime(0.0001, toneStart);
    gain.gain.exponentialRampToValueAtTime(tone.volume, toneStart + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneEnd + 0.01);
  }
}

export function playProceduralUiSound(preset: ProceduralUiSound): void {
  try {
    const context = getAudioContext();
    if (!context) return;
    if (context.state === 'suspended') {
      void context.resume().then(() => schedulePreset(context, preset)).catch(() => undefined);
      return;
    }
    schedulePreset(context, preset);
  } catch {
    // Audio feedback is optional; unsupported or blocked audio must not interrupt the UI.
  }
}
