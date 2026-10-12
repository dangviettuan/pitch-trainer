import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/audio.js';

// Independent fixture of measured source tuning, used to verify the audible
// result instead of duplicating the playback-rate calculation.
const measuredCents = {
  48: -13.7, 51: -1.8, 54: -5.1, 57: 0.9, 60: 1.1, 63: 1.9, 66: -3.6,
  69: 0, 72: 4.7, 75: 2.6, 78: 1.9, 81: 7.9, 84: 6.4,
};
const expectedHz = midi => 440 * 2 ** ((midi - 69) / 12);
const outputHz = source => expectedHz(source.buffer.anchor) * 2 ** (measuredCents[source.buffer.anchor] / 1200) * source.playbackRate.value;

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

function mockAudio(t, { fetchResponse, decode } = {}) {
  const requests = [], contexts = [], sources = [];
  const originalContext = globalThis.AudioContext;
  const originalFetch = globalThis.fetch;
  const param = () => ({
    value: 0, events: [],
    setValueAtTime(...args) { this.events.push(['set', ...args]); },
    linearRampToValueAtTime(...args) { this.events.push(['linear', ...args]); },
    exponentialRampToValueAtTime(...args) { this.events.push(['exponential', ...args]); },
    cancelScheduledValues() {},
  });
  globalThis.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 10; this.destination = {}; this.decodes = []; contexts.push(this); }
    createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
    createBufferSource() { return this.source('buffer'); }
    createOscillator() { return this.source('oscillator'); }
    source(kind) {
      const source = { kind, frequency: param(), playbackRate: param(), stops: [], starts: [], disconnects: 0,
        connect(gain) { this.gain = gain; }, disconnect() { this.disconnects++; },
        start(time) { this.starts.push(time); }, stop(time) { this.stops.push(time); } };
      sources.push(source);
      return source;
    }
    async decodeAudioData(data) {
      this.decodes.push(data);
      return decode ? decode(data) : { anchor: data.anchor, duration: 8 };
    }
  };
  globalThis.fetch = async url => {
    requests.push(url);
    return fetchResponse ? fetchResponse(url) : { ok: true, arrayBuffer: async () => ({ anchor: Number(url.pathname.match(/(\d+)\.mp3$/)[1]) }) };
  };
  t.after(() => { globalThis.AudioContext = originalContext; globalThis.fetch = originalFetch; });
  return { requests, contexts, sources };
}

test('sampled piano maps all notes, calibrates A440 pitch and semitone spacing, and retains attack', async t => {
  const { requests, sources } = mockAudio(t);
  const engine = new AudioEngine();
  t.after(() => engine.stop());
  const notes = Array.from({ length: 37 }, (_, index) => index + 48);
  const playing = engine.play(notes);
  await flush();
  assert.equal(requests.length, 13);
  assert.equal(sources.length, 37);
  for (const [index, source] of sources.entries()) {
    const midi = notes[index];
    const anchor = 48 + Math.round((midi - 48) / 3) * 3;
    assert.equal(source.kind, 'buffer');
    assert.equal(source.buffer.anchor, anchor);
    const pitchErrorCents = 1200 * Math.log2(outputHz(source) / expectedHz(midi));
    assert.ok(Math.abs(pitchErrorCents) < 0.001, `MIDI ${midi} tuning error: ${pitchErrorCents} cents`);
    if (index > 0) {
      const intervalCents = 1200 * Math.log2(outputHz(source) / outputHz(sources[index - 1]));
      assert.ok(Math.abs(intervalCents - 100) < 0.001, `MIDI ${midi - 1}–${midi}: ${intervalCents} cents`);
    }
    assert.ok(Math.abs(source.starts[0] - (10.025 + index * 0.72)) < 1e-9);
    assert.deepEqual(source.gain.gain.events.map(event => event[0]), ['set', 'set', 'linear']);
    assert.equal(source.gain.gain.events[0][1], 0.65 * 0.7);
    assert.ok(Math.abs(source.stops[0] - source.starts[0] - 1.17) < 1e-9);
  }
  assert.equal(requests[0].href, new URL('../assets/piano/48.mp3', import.meta.url).href);
  engine.stop();
  assert.equal(await playing, false);
  assert.ok(sources.every(source => source.stops.length === 2 && source.disconnects === 1));
  assert.equal(engine.active.size, 0);
});

test('preload and overlapping playback share each pending sample request and decoded buffer', async t => {
  const pending = deferred();
  const { requests, contexts, sources } = mockAudio(t, { decode: () => pending.promise });
  const engine = new AudioEngine();
  t.after(() => engine.stop());
  const warming = engine.preload([60, 61, 59]);
  const first = engine.play([60]);
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(contexts[0].decodes.length, 1);
  const second = engine.play([61, 59], { sequence: false });
  assert.equal(await first, false);
  pending.resolve({ anchor: 60 });
  await warming;
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].buffer, sources[1].buffer);
  assert.equal(sources[0].starts[0], sources[1].starts[0]);
  engine.stop();
  assert.equal(await second, false);
  await engine.preload([60]);
  assert.equal(requests.length, 1);
});

test('failed sample requests and decode failures report a clear error and allow retry', async t => {
  let failFetch = true, failDecode = true;
  const { requests, sources } = mockAudio(t, {
    fetchResponse: async () => ({ ok: !failFetch, status: 503, arrayBuffer: async () => ({ anchor: 60 }) }),
    decode: async data => { if (failDecode) throw new Error('bad audio'); return data; },
  });
  const engine = new AudioEngine();
  t.after(() => engine.stop());
  await assert.rejects(engine.play([60]), { code: 'PIANO_SAMPLE_LOAD', message: /Piano samples could not be loaded/ });
  assert.equal(sources.length, 0);
  failFetch = false;
  await assert.rejects(engine.preload([60]), { code: 'PIANO_SAMPLE_LOAD', message: /Piano samples could not be loaded/ });
  failDecode = false;
  const playing = engine.play([60]);
  await flush();
  assert.equal(requests.length, 3);
  assert.equal(sources.length, 1);
  engine.stop();
  assert.equal(await playing, false);
});

test('stop during a pending download immediately cancels playback and never schedules stale audio', async t => {
  const download = deferred();
  const { contexts, sources } = mockAudio(t, { fetchResponse: () => download.promise });
  const engine = new AudioEngine();
  const playing = engine.play([60]);
  await flush();
  engine.stop();
  assert.equal(await playing, false);
  download.resolve({ ok: true, arrayBuffer: async () => ({ anchor: 60 }) });
  await flush();
  assert.equal(contexts[0].decodes.length, 1);
  assert.equal(sources.length, 0);
});

test('stop during a pending decode prevents scheduling and a later play can reuse the buffer', async t => {
  const decoded = deferred();
  const { requests, sources } = mockAudio(t, { decode: () => decoded.promise });
  const engine = new AudioEngine();
  t.after(() => engine.stop());
  const playing = engine.play([60]);
  await flush();
  engine.stop();
  assert.equal(await playing, false);
  decoded.resolve({ anchor: 60 });
  await flush();
  assert.equal(sources.length, 0);
  const later = engine.play([61]);
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(sources.length, 1);
  engine.stop();
  assert.equal(await later, false);
});

test('recreating a closed AudioContext resets its sample cache', async t => {
  const { contexts, requests } = mockAudio(t);
  const engine = new AudioEngine();
  await engine.preload([60]);
  contexts[0].state = 'closed';
  await engine.preload([60]);
  assert.equal(contexts.length, 2);
  assert.equal(requests.length, 2);
  assert.equal(contexts[1].decodes.length, 1);
});

test('sine playback never downloads samples and natural completion resolves true', async t => {
  const { requests, sources } = mockAudio(t);
  const engine = new AudioEngine();
  t.after(() => engine.stop());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const playing = engine.play([69], { timbre: 'sine' });
  await flush();
  assert.equal(requests.length, 0);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].kind, 'oscillator');
  assert.equal(sources[0].frequency.value, 440);
  t.mock.timers.tick(1000);
  assert.equal(await playing, true);
});


test('an error partway through scheduling silences all created voices and rejects playback', async t => {
  const { contexts, sources } = mockAudio(t);
  const engine = new AudioEngine();
  await engine.preload([60, 63, 66]);
  const context = contexts[0];
  const originalCreate = context.createBufferSource.bind(context);
  context.createBufferSource = () => {
    const source = originalCreate();
    if (sources.length === 2) source.start = () => { throw new Error('Scheduling failed'); };
    return source;
  };
  await assert.rejects(engine.play([60, 63, 66]), /Scheduling failed/);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].starts.length, 1);
  assert.equal(sources[0].stops.length, 2);
  assert.equal(sources[1].stops.length, 1);
  assert.ok(sources.every(source => source.gain.gain.value === 0 && source.disconnects === 1));
  assert.equal(engine.active.size, 0);
  assert.equal(engine.completion, null);
});
