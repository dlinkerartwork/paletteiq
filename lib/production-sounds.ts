'use client';

import { useCallback, useEffect, useState } from 'react';

export type ProductionSound = 'credits' | 'completed';

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
      const notes = kind === 'credits'
        ? [{ frequency: 740, at: 0, length: 0.19 }, { frequency: 470, at: 0.27, length: 0.25 }, { frequency: 370, at: 0.59, length: 0.34 }]
        : [{ frequency: 523, at: 0, length: 0.13 }, { frequency: 659, at: 0.18, length: 0.13 }, { frequency: 784, at: 0.36, length: 0.24 }];
      for (const note of notes) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        const at = start + note.at;
        osc.type = kind === 'credits' ? 'triangle' : 'sine';
        osc.frequency.value = note.frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.11, at + 0.015);
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
