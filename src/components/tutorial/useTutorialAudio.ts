'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type TutorialAudioStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

type TutorialAudioSettings = {
  muted: boolean;
};

const SETTINGS_KEY = 'magine-tutorial-audio-settings-v1';
const AUDIO_REVISION = '20260802-17';
const DEFAULT_SETTINGS: TutorialAudioSettings = { muted: false };

let activeAudio: HTMLAudioElement | null = null;
let activeOwner: symbol | null = null;

function readSettings(): TutorialAudioSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<TutorialAudioSettings>;
    return { muted: saved.muted === true };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: TutorialAudioSettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Audio preferences are optional and must not interrupt the tutorial.
  }
}

function resolveAudioSource(clipId: string) {
  const separator = clipId.indexOf('.');
  const group = separator >= 0 ? clipId.slice(0, separator) : 'welcome';
  const step = separator >= 0 ? clipId.slice(separator + 1) : clipId;
  return `/tutorial-audio/zh-CN/${group}/${step}.mp3?v=${AUDIO_REVISION}`;
}

export function useTutorialAudio(clipId: string, enabled = true) {
  const ownerRef = useRef(Symbol('tutorial-audio'));
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserFrameRef = useRef(0);
  const audioLevelRef = useRef(0);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const [status, setStatus] = useState<TutorialAudioStatus>('idle');
  const [muted, setMuted] = useState(() => readSettings().muted);

  const resumeAudioContext = useCallback(() => {
    const context = audioContextRef.current;
    if (context?.state === 'suspended') void context.resume();
  }, []);

  useEffect(() => {
    if (!enabled || typeof Audio === 'undefined') return;

    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    }

    const owner = ownerRef.current;
    const audio = new Audio(resolveAudioSource(clipId));
    audio.preload = 'auto';
    audio.volume = 0.9;
    audio.muted = readSettings().muted;
    audioRef.current = audio;
    activeAudio = audio;
    activeOwner = owner;

    try {
      const AudioContextConstructor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextConstructor) {
        const context = new AudioContextConstructor();
        const source = context.createMediaElementSource(audio);
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);
        analyser.connect(context.destination);
        audioContextRef.current = context;
        audioSourceRef.current = source;
        analyserRef.current = analyser;

        void context.resume();
      }
    } catch {
      // Audio playback remains available if Web Audio analysis is unavailable.
    }

    const samples = new Uint8Array(256);
    const updateAudioMetrics = () => {
      currentTimeRef.current = audio.currentTime || 0;
      durationRef.current = Number.isFinite(audio.duration) ? audio.duration : 0;

      const analyser = analyserRef.current;
      const context = audioContextRef.current;
      if (analyser && context?.state === 'running' && !audio.paused && !audio.ended) {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const sample = ((samples[index] ?? 128) - 128) / 128;
          sum += sample * sample;
        }
        const rms = Math.sqrt(sum / samples.length);
        const normalized = Math.max(0, Math.min(1, (rms - 0.008) * 9.5));
        audioLevelRef.current = audioLevelRef.current * 0.34 + normalized * 0.66;
      } else {
        audioLevelRef.current *= 0.72;
      }

      analyserFrameRef.current = window.requestAnimationFrame(updateAudioMetrics);
    };
    analyserFrameRef.current = window.requestAnimationFrame(updateAudioMetrics);

    const handlePlaying = () => setStatus('playing');
    const handlePause = () => {
      if (!audio.ended) setStatus('paused');
    };
    const handleEnded = () => setStatus('ended');
    const handleError = () => setStatus('error');

    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    void audio.play().catch(() => setStatus('paused'));

    return () => {
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      window.cancelAnimationFrame(analyserFrameRef.current);
      audioLevelRef.current = 0;
      currentTimeRef.current = 0;
      durationRef.current = 0;
      audioSourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
      const audioContext = audioContextRef.current;
      audioSourceRef.current = null;
      analyserRef.current = null;
      audioContextRef.current = null;
      if (audioContext && audioContext.state !== 'closed') void audioContext.close();
      audio.pause();
      audio.currentTime = 0;
      if (audioRef.current === audio) audioRef.current = null;
      if (activeOwner === owner) {
        activeAudio = null;
        activeOwner = null;
      }
    };
  }, [clipId, enabled]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
    saveSettings({ muted });
  }, [muted]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused || audio.ended) {
      if (audio.ended) audio.currentTime = 0;
      setStatus('loading');
      resumeAudioContext();
      void audio.play().catch(() => setStatus('error'));
    } else {
      audio.pause();
    }
  }, [resumeAudioContext]);

  const replay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setStatus('loading');
    resumeAudioContext();
    void audio.play().catch(() => setStatus('error'));
  }, [resumeAudioContext]);

  const toggleMuted = useCallback(() => setMuted((value) => !value), []);

  return {
    status,
    isPlaying: status === 'playing' || status === 'loading',
    muted,
    audioLevelRef,
    currentTimeRef,
    durationRef,
    togglePlayback,
    replay,
    toggleMuted,
  };
}
