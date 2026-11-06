'use client';

import { useCallback, useEffect, useState } from 'react';

export type ProductionSound = 'credits' | 'completed' | 'error';

let audioContext: AudioContext | null = null;

export function isOpenAICreditError(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value ?? '');
  if (/rate_limit_exceeded|requests per min|tokens per min/i.test(message)) return false;
  return /insufficient_quota|billing_hard_limit_reached|exceeded your current quota|out of credits|credit balance is too low|billing quota exceeded|credits? (?:are )?(?:exhausted|depleted)/i.test(message);
}

export function productionSoundEnabled(): boolean {
  try { return typeof window === 'undefined' || localStorage.getItem('paletteiq-production-sounds') !== 'off'; }
  catch { return true; }
}

export function primeProductionAudio(): void {
  if (typeof window === 'undefined' || !window.AudioContext) return;
  try {
    audioContext ??= new window.AudioContext();
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
  } catch { /* Sound is optional; visual notices must still work. */ }
}

export function playProductionSound(kind: ProductionSound): void {
  if (typeof window === 'undefined' || !window.AudioContext) return;
  try {
    if (audioContext?.state === 'closed') audioContext = null;
    audioContext ??= new window.AudioContext();
    const context = audioContext;
    const schedule = () => {
      const start = context.currentTime + 0.02;
      if (kind === 'error') {
        // Original cinematic jump-scare sting: sharp dissonant brass hit,
        // descending sub-bass and a brief burst of filtered noise.
        // Master limiter keeps the effect audible without digital clipping.
        const master = context.createDynamicsCompressor();
        master.threshold.value = -18;
        master.knee.value = 8;
        master.ratio.value = 12;
        master.attack.value = 0.002;
        master.release.value = 0.18;
        master.connect(context.destination);
        const tones = [
          { hz: 92, end: 48, at: 0, duration: 0.86, level: 0.42, type: 'sawtooth' as OscillatorType },
          { hz: 392, end: 131, at: 0.015, duration: 0.58, level: 0.27, type: 'sawtooth' as OscillatorType },
          { hz: 415, end: 155, at: 0.025, duration: 0.63, level: 0.24, type: 'square' as OscillatorType },
          { hz: 587, end: 246, at: 0.04, duration: 0.45, level: 0.18, type: 'sawtooth' as OscillatorType },
        ];
        for (const tone of tones) {
          const osc = context.createOscillator();
          const gain = context.createGain();
          const at = start + tone.at;
          osc.type = tone.type;
          osc.frequency.setValueAtTime(tone.hz, at);
          osc.frequency.exponentialRampToValueAtTime(tone.end, at + tone.duration);
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(tone.level, at + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.duration);
          osc.connect(gain);
          gain.connect(master);
          osc.start(at);
          osc.stop(at + tone.duration + 0.02);
        }
        const noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.28), context.sampleRate);
        const samples = noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        const source = context.createBufferSource();
        source.buffer = noise;
        const filter = context.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 900;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.29, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        source.start(start);
        source.stop(start + 0.28);
        return;
      }
      const notes = kind === 'credits'
        ? [{ frequency: 740, at: 0, length: 0.19 }, { frequency: 470, at: 0.27, length: 0.25 }, { frequency: 370, at: 0.59, length: 0.34 }]
        : kind === 'error'
          ? [{ frequency: 220, at: 0, length: 0.3 }, { frequency: 233, at: 0.11, length: 0.33 }, { frequency: 155, at: 0.48, length: 0.48 }, { frequency: 110, at: 0.71, length: 0.47 }]
          : [{ frequency: 523, at: 0, length: 0.12 }, { frequency: 659, at: 0.14, length: 0.12 }, { frequency: 784, at: 0.28, length: 0.12 }, { frequency: 1047, at: 0.44, length: 0.33 }];
      for (const note of notes) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        const at = start + note.at;
        osc.type = kind === 'error' ? 'sawtooth' : kind === 'credits' ? 'triangle' : 'sine';
        osc.frequency.value = note.frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(kind === 'error' ? 0.15 : 0.24, at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + note.length);
        osc.connect(gain);
        gain.connect(context.destination);
        osc.start(at);
        osc.stop(at + note.length + 0.02);
      }
    };
    if (context.state === 'suspended') void context.resume().then(schedule).catch(() => {});
    else if (context.state === 'running') schedule();
  } catch { /* Audio may be unavailable in a restricted desktop session. */ }
}

export function useProductionSounds() {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setEnabled(localStorage.getItem('paletteiq-production-sounds') !== 'off'); }
      catch { /* Local storage is optional. */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const toggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    try { localStorage.setItem('paletteiq-production-sounds', next ? 'on' : 'off'); } catch { /* Optional. */ }
    if (next) { primeProductionAudio(); playProductionSound('completed'); }
  }, [enabled]);

  const play = useCallback((kind: ProductionSound) => {
    if (enabled) playProductionSound(kind);
  }, [enabled]);

  return { enabled, toggle, play };
}
