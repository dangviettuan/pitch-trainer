import { frequency } from './engine.js';

export class AudioEngine {
  constructor() {
    this.context = null;
    this.active = new Set();
    this.generation = 0;
    this.completion = null;
  }

  async unlock() {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) throw new Error('This browser does not support audio playback.');
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext();
    if (this.context.state !== 'running') await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Audio is paused. Tap Play to enable sound.');
    return this.context;
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
      try { voice.oscillator.stop(); } catch { /* already stopped */ }
      try { voice.oscillator.disconnect(); voice.gain.disconnect(); } catch { /* already disconnected */ }
    }
    this.active.clear();
  }

  async play(notes, { sequence = true, timbre = 'piano', volume = 0.65 } = {}) {
    this.stop();
    const generation = this.generation;
    const context = await this.unlock();
    if (generation !== this.generation) return false;
    const valid = Array.isArray(notes) ? notes.filter(note => Number.isInteger(note) && note >= 21 && note <= 108) : [];
    if (!valid.length) return true;
    const level = Math.min(1, Math.max(0, Number(volume) || 0));
    const start = context.currentTime + 0.025;
    const duration = timbre === 'sine' ? 0.8 : 1.15;
    const spacing = 0.72;
    valid.forEach((midi, index) => {
      const when = start + (sequence ? index * spacing : 0);
      const fundamental = frequency(midi);
      const partials = timbre === 'sine' ? [1] : [1, 0.42, 0.2, 0.11, 0.06, 0.025];
      partials.forEach((amplitude, harmonic) => {
        if (fundamental * (harmonic + 1) >= context.sampleRate / 2) return;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const voice = { oscillator, gain };
        oscillator.type = 'sine';
        oscillator.frequency.value = fundamental * (harmonic + 1);
        // Higher harmonics fade faster, producing a soft struck-string envelope.
        const peak = Math.max(0.00001, level * amplitude * 0.22 / (sequence ? 1 : Math.sqrt(valid.length)));
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(peak, when + 0.008);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.00001, peak * 0.3), when + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.00001, when + duration / (1 + harmonic * 0.18));
        gain.gain.linearRampToValueAtTime(0, when + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        this.active.add(voice);
        oscillator.onended = () => {
          this.active.delete(voice);
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(when);
        oscillator.stop(when + duration + 0.02);
      });
    });
    const total = ((sequence ? (valid.length - 1) * spacing : 0) + duration + 0.07) * 1000;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        if (this.completion?.timer === timer) this.completion = null;
        resolve(generation === this.generation);
      }, total);
      this.completion = { timer, resolve };
    });
  }
}
