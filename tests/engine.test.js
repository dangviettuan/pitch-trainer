import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveWeights, createQuestion, emptyProfile, evaluateAnswer, frequency, MAX_ATTEMPTS, noteName, notePool, recordAttempt, summarize, validateProfile } from '../src/engine.js';
import { AudioEngine } from '../src/audio.js';

test('piano ranges preserve octaves and accidental settings', () => {
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(61), 'C#4');
  assert.equal(frequency(69), 440);
  assert.deepEqual(notePool(), [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.equal(notePool('C3-C5', true).length, 25);
  assert.equal(notePool('C4-C6').at(-1), 84);
  assert.throws(() => notePool('C5-C4'), RangeError);
});

test('melody grading requires all three notes in exact order', () => {
  assert.equal(evaluateAnswer([60, 64, 67], [60, 64, 67]), true);
  assert.equal(evaluateAnswer([60, 64, 67], [67, 64, 60]), false);
  assert.equal(evaluateAnswer([60, 64, 67], [60, 64]), false);
  assert.equal(evaluateAnswer([], []), false);
  const question = createQuestion({ mode: 'melody', pool: [60, 64, 67], random: () => 0 });
  assert.deepEqual(question.notes, [60, 64, 60]);
  assert.deepEqual(question.answer, question.notes);
});

test('interval answer is the second note and reference is distinct', () => {
  const question = createQuestion({ mode: 'interval', pool: [60, 62], random: () => 0 });
  assert.deepEqual(question.notes, [60, 62]);
  assert.deepEqual(question.answer, [62]);
  assert.throws(() => createQuestion({ mode: 'interval', pool: [60] }), RangeError);
});

test('mistakes and response time increase weight while assisted trials do not', () => {
  let profile = emptyProfile();
  for (let index = 0; index < 8; index++) {
    profile = recordAttempt(profile, { question: { mode: 'note', notes: [60] }, answer: [62], elapsedMs: 9000 });
    profile = recordAttempt(profile, { question: { mode: 'note', notes: [62] }, answer: [62], elapsedMs: 1000 });
    profile = recordAttempt(profile, { question: { mode: 'note', notes: [64] }, answer: [64], elapsedMs: 9000 });
    profile = recordAttempt(profile, { question: { mode: 'note', notes: [65] }, answer: [60], elapsedMs: 9000, assisted: true });
  }
  const [mistake, mastered, slow, assisted] = adaptiveWeights([60, 62, 64, 65], profile);
  assert.ok(mistake > slow && slow > mastered);
  assert.equal(assisted, 1.3);
  let picks = 0;
  for (let index = 0; index < 100; index++) {
    const question = createQuestion({ pool: [60, 62], profile, random: () => (index + 0.5) / 100 });
    if (question.notes[0] === 60) picks++;
  }
  assert.ok(picks > 70, `mistaken note selected ${picks}% of the time`);
});

test('profile validation drops corrupt entries and bounds stored history', () => {
  const attempt = { mode: 'note', notes: [60], answer: [62], correct: true, elapsedMs: Infinity, at: -1, assisted: 'true' };
  const profile = validateProfile({ version: 1, attempts: [null, { ...attempt, notes: [999] }, attempt] });
  assert.equal(profile.attempts.length, 1);
  assert.equal(profile.attempts[0].correct, false);
  assert.equal(profile.attempts[0].elapsedMs, null);
  assert.equal(profile.attempts[0].assisted, false);
  assert.deepEqual(validateProfile({ version: 99, attempts: [attempt] }), emptyProfile());
  assert.equal(validateProfile({ version: 1, attempts: Array(MAX_ATTEMPTS + 50).fill(attempt) }).attempts.length, MAX_ATTEMPTS);
  const restored = validateProfile(JSON.parse(JSON.stringify(profile)));
  assert.deepEqual(restored, profile);
});

test('assistance excluded from mastery and original profile stays immutable', () => {
  const original = emptyProfile();
  let profile = recordAttempt(original, { question: { mode: 'note', notes: [60] }, answer: [60], elapsedMs: 1000, correct: false });
  profile = recordAttempt(profile, { question: { mode: 'note', notes: [62] }, answer: [62], elapsedMs: 1000, assisted: true });
  assert.equal(original.attempts.length, 0);
  const summary = summarize(profile);
  assert.equal(summary.attempts, 2);
  assert.equal(summary.scoredAttempts, 1);
  assert.equal(summary.accuracy, 1);
  assert.equal(summary.assisted, 1);
  assert.equal(summary.streak, 0);
  assert.equal(summary.weakNotes.length, 1);
});

test('audio stop cancels every scheduled note and resolves playback as cancelled', async () => {
  const previous = globalThis.AudioContext;
  const oscillators = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  globalThis.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = {}; }
    createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
    createOscillator() {
      const oscillator = { frequency: param(), stops: 0, connect() {}, disconnect() {}, start() {}, stop() { this.stops++; } };
      oscillators.push(oscillator);
      return oscillator;
    }
  };
  try {
    const engine = new AudioEngine();
    const playing = engine.play([60, 64, 67]);
    await Promise.resolve();
    engine.stop();
    assert.equal(await playing, false);
    assert.equal(oscillators.length, 18);
    assert.ok(oscillators.every(oscillator => oscillator.stops === 2));
    assert.equal(engine.active.size, 0);
  } finally {
    globalThis.AudioContext = previous;
  }
});

test('audio cancellation during context resume prevents scheduling stale sound', async () => {
  const previous = globalThis.AudioContext;
  let resume;
  let scheduled = 0;
  globalThis.AudioContext = class {
    constructor() { this.state = 'suspended'; }
    resume() { return new Promise(resolve => { resume = () => { this.state = 'running'; resolve(); }; }); }
    createOscillator() { scheduled++; }
  };
  try {
    const engine = new AudioEngine();
    const playing = engine.play([60]);
    engine.stop();
    resume();
    assert.equal(await playing, false);
    assert.equal(scheduled, 0);
  } finally {
    globalThis.AudioContext = previous;
  }
});
