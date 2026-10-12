import { frequency } from './engine.js';

const PIANO_ANCHORS = [48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84];
// Measured Salamander fundamentals against A440 equal temperament: FFT over
// 0.35–1.8 s at 44.1 kHz with parabolic log-spectrum interpolation. Correct
// their tuning at playback, preserving the original recorded MP3 files.
const PIANO_TUNING_CENTS = {
  48: -13.7, 51: -1.8, 54: -5.1, 57: 0.9, 60: 1.1, 63: 1.9, 66: -3.6,
  69: 0, 72: 4.7, 75: 2.6, 78: 1.9, 81: 7.9, 84: 6.4,
};
const validNotes = notes => Array.isArray(notes) ? notes.filter(note => Number.isInteger(note) && note >= 21 && note <= 108) : [];
const sampleFor = midi => PIANO_ANCHORS.reduce((nearest, anchor) => Math.abs(anchor - midi) < Math.abs(nearest - midi) ? anchor : nearest);

export class AudioEngine {
  constructor() {
    this.context = null;
    this.active = new Set();
    this.generation = 0;
    this.completion = null;
    this.samples = new Map();
  }

  async unlock() {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) throw new Error('This browser does not support audio playback.');
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext();
      this.samples = new Map();
    }
    const context = this.context;
    if (context.state !== 'running') await context.resume();
    if (context.state !== 'running') throw new Error('Audio is paused. Tap Play to enable sound.');
    return context;
  }

  loadSample(anchor, context) {
    const cache = this.samples;
    if (!cache.has(anchor)) {
      const loading = (async () => {
        try {
          const response = await fetch(new URL(`../assets/piano/${anchor}.mp3`, import.meta.url));
          if (!response.ok) throw new Error(`Sample request failed (${response.status}).`);
          return await context.decodeAudioData(await response.arrayBuffer());
        } catch (cause) {
          const error = new Error('Piano samples could not be loaded. Check your connection and try Play again.', { cause });
          error.code = 'PIANO_SAMPLE_LOAD';
          throw error;
        }
      })();
      cache.set(anchor, loading);
      // A failed request must remain retryable; don't evict a newer request.
      loading.catch(() => { if (cache.get(anchor) === loading) cache.delete(anchor); });
    }
    return cache.get(anchor);
  }

  async preload(notes) {
    const context = await this.unlock();
    const anchors = [...new Set(validNotes(notes).map(sampleFor))];
    await Promise.all(anchors.map(anchor => this.loadSample(anchor, context)));
    return true;
  }

  stop() {
    this.generation++;
    if (this.completion) {
      clearTimeout(this.completion.timer);
      this.completion.resolve(false);
      this.completion = null;
    }
    for (const voice of this.active) {
      try { voice.gain.gain.cancelScheduledValues(0); voice.gain.gain.value = 0; } catch { /* already disposed */ }
      try { voice.source.stop(); } catch { /* already stopped */ }
      try { voice.source.disconnect(); voice.gain.disconnect(); } catch { /* already disconnected */ }
    }
    this.active.clear();
  }

  async play(notes, { sequence = true, timbre = 'piano', volume = 0.65 } = {}) {
    this.stop();
    const generation = this.generation;
    const valid = validNotes(notes);
    const level = Math.min(1, Math.max(0, Number(volume) || 0));
    return new Promise((resolve, reject) => {
      const completion = { timer: null, resolve };
      this.completion = completion;
      const prepare = async () => {
        try {
          const context = await this.unlock();
          if (generation !== this.generation) return;
          const samples = new Map();
          if (timbre !== 'sine') {
            const anchors = [...new Set(valid.map(sampleFor))];
            await Promise.all(anchors.map(async anchor => samples.set(anchor, await this.loadSample(anchor, context))));
            if (generation !== this.generation) return;
          }
          if (!valid.length) {
            this.completion = null;
            resolve(true);
            return;
          }
          const start = context.currentTime + 0.025;
          const duration = timbre === 'sine' ? 0.8 : 1.15;
          const spacing = 0.72;
          valid.forEach((midi, index) => {
            const when = start + (sequence ? index * spacing : 0);
            const gain = context.createGain();
            const source = timbre === 'sine' ? context.createOscillator() : context.createBufferSource();
            const voice = { source, gain };
            const peak = level * (timbre === 'sine' ? 0.22 : 0.7) / (sequence ? 1 : Math.sqrt(valid.length));
            if (timbre === 'sine') {
              source.type = 'sine';
              source.frequency.value = frequency(midi);
              gain.gain.setValueAtTime(0, when);
              gain.gain.linearRampToValueAtTime(peak, when + 0.008);
              gain.gain.exponentialRampToValueAtTime(Math.max(0.00001, peak * 0.3), when + 0.12);
              gain.gain.exponentialRampToValueAtTime(0.00001, when + duration - 0.05);
            } else {
              const anchor = sampleFor(midi);
              source.buffer = samples.get(anchor);
              source.playbackRate.value = 2 ** ((midi - anchor) / 12 - PIANO_TUNING_CENTS[anchor] / 1200);
              // Preserve the recorded hammer attack, then taper the tail before stopping.
              gain.gain.setValueAtTime(peak, when);
              gain.gain.setValueAtTime(peak, when + duration - 0.18);
            }
            gain.gain.linearRampToValueAtTime(0, when + duration);
            source.connect(gain);
            gain.connect(context.destination);
            this.active.add(voice);
            source.onended = () => {
              this.active.delete(voice);
              source.disconnect();
              gain.disconnect();
            };
            source.start(when);
            source.stop(when + duration + 0.02);
          });
          const total = ((sequence ? (valid.length - 1) * spacing : 0) + duration + 0.07) * 1000;
          completion.timer = setTimeout(() => {
            if (this.completion === completion) this.completion = null;
            resolve(generation === this.generation);
          }, total);
        } catch (error) {
          if (generation !== this.generation) return;
          this.completion = null;
          this.stop();
          reject(error);
        }
      };
      void prepare();
    });
  }
}
