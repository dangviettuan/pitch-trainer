export const MAX_ATTEMPTS = 500;
const MODES = ['note', 'interval', 'melody'];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const validNote = value => Number.isInteger(value) && value >= 21 && value <= 108;
const isNotes = value => Array.isArray(value) && value.every(validNote);

export function noteName(midi) {
  if (!validNote(midi)) return '—';
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function frequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function notePool(range = 'C4-C5', accidentals = false) {
  const match = /^C([0-8])-C([0-8])$/.exec(range);
  if (!match) throw new RangeError('Choose a range such as C4-C5.');
  const low = 12 * (Number(match[1]) + 1);
  const high = 12 * (Number(match[2]) + 1);
  if (low > high || low < 21 || high > 108) throw new RangeError('Range must fit the piano.');
  return Array.from({ length: high - low + 1 }, (_, index) => low + index)
    .filter(midi => accidentals || !NAMES[midi % 12].includes('#'));
}

export function evaluateAnswer(expected, actual) {
  return isNotes(expected) && isNotes(actual) && expected.length > 0 &&
    expected.length === actual.length && expected.every((note, index) => note === actual[index]);
}

export function emptyProfile() {
  return { version: 1, attempts: [] };
}

function expectedFor(mode, notes) {
  return mode === 'interval' ? [notes[1]] : mode === 'melody' ? notes : [notes[0]];
}

function sanitizeAttempt(raw) {
  if (!raw || !MODES.includes(raw.mode) || !isNotes(raw.notes) || !isNotes(raw.answer)) return null;
  const length = raw.mode === 'note' ? 1 : raw.mode === 'interval' ? 2 : 3;
  if (raw.notes.length !== length || raw.answer.length > 3) return null;
  const elapsedMs = Number.isFinite(raw.elapsedMs) && raw.elapsedMs >= 0
    ? Math.min(Math.round(raw.elapsedMs), 120000) : null;
  const at = Number.isFinite(raw.at) && raw.at >= 0 ? Math.min(raw.at, 8640000000000000) : 0;
  return {
    mode: raw.mode,
    notes: [...raw.notes],
    answer: [...raw.answer],
    correct: evaluateAnswer(expectedFor(raw.mode, raw.notes), raw.answer),
    elapsedMs,
    assisted: raw.assisted === true,
    at,
  };
}

export function validateProfile(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.attempts)) return emptyProfile();
  return { version: 1, attempts: raw.attempts.slice(-MAX_ATTEMPTS).map(sanitizeAttempt).filter(Boolean) };
}

export function recordAttempt(profile, { question, answer, elapsedMs, assisted = false, at = Date.now() }) {
  const next = validateProfile(profile);
  const mode = question?.mode ?? (question?.notes?.length === 3 ? 'melody' : question?.notes?.length === 2 ? 'interval' : 'note');
  const attempt = sanitizeAttempt({ mode, notes: question?.notes, answer, elapsedMs, assisted, at });
  if (attempt) next.attempts.push(attempt);
  next.attempts = next.attempts.slice(-MAX_ATTEMPTS);
  return next;
}

function timed(attempt) {
  return attempt.elapsedMs !== null && attempt.elapsedMs >= 150 && attempt.elapsedMs <= 60000;
}

function noteEvidence(attempts) {
  const stats = new Map();
  for (const attempt of attempts) {
    if (attempt.assisted) continue;
    const expected = expectedFor(attempt.mode, attempt.notes);
    expected.forEach((midi, index) => {
      const stat = stats.get(midi) || { midi, attempts: 0, mistakes: 0, times: [] };
      stat.attempts++;
      stat.mistakes += attempt.answer[index] !== midi ? 1 : 0;
      // Sequence time is divided across its notes so melody trials do not look artificially slow.
      if (timed(attempt)) stat.times.push(attempt.elapsedMs / expected.length);
      stats.set(midi, stat);
    });
  }
  return stats;
}

export function summarize(profile) {
  const attempts = validateProfile(profile).attempts;
  const scored = attempts.filter(attempt => !attempt.assisted);
  const correct = scored.filter(attempt => attempt.correct).length;
  const times = scored.filter(attempt => attempt.correct && timed(attempt)).map(attempt => attempt.elapsedMs);
  let streak = 0;
  for (let index = attempts.length - 1; index >= 0; index--) {
    if (attempts[index].assisted || !attempts[index].correct) break;
    streak++;
  }
  const practiceCorrect = attempts.filter(attempt => attempt.correct).length;
  let practiceStreak = 0;
  for (let index = attempts.length - 1; index >= 0 && attempts[index].correct; index--) practiceStreak++;
  const weakNotes = [...noteEvidence(scored).values()].map(stat => ({
    midi: stat.midi, name: noteName(stat.midi), attempts: stat.attempts, mistakes: stat.mistakes,
    accuracy: (stat.attempts - stat.mistakes) / stat.attempts,
    averageMs: stat.times.length ? stat.times.reduce((sum, time) => sum + time, 0) / stat.times.length : null,
  })).sort((a, b) => b.mistakes / (b.attempts + 2) - a.mistakes / (a.attempts + 2) || (b.averageMs || 0) - (a.averageMs || 0));
  const byMode = Object.fromEntries(MODES.map(mode => {
    const trials = scored.filter(attempt => attempt.mode === mode);
    const successes = trials.filter(attempt => attempt.correct).length;
    return [mode, { attempts: trials.length, correct: successes, accuracy: trials.length ? successes / trials.length : null }];
  }));
  return {
    attempts: attempts.length, scoredAttempts: scored.length, correct,
    accuracy: scored.length ? correct / scored.length : null,
    averageMs: times.length ? times.reduce((sum, time) => sum + time, 0) / times.length : null,
    assisted: attempts.length - scored.length, streak, weakNotes, byMode,
    practiceCorrect, practiceStreak,
    practiceAccuracy: attempts.length ? practiceCorrect / attempts.length : null,
  };
}

export function adaptiveWeights(pool, profile) {
  const evidence = noteEvidence(validateProfile(profile).attempts.slice(-100));
  return pool.map(midi => {
    const stat = evidence.get(midi);
    if (!stat) return 1.3; // Keep exploring notes without evidence.
    const errorRate = stat.mistakes / (stat.attempts + 2);
    const averageMs = stat.times.length ? stat.times.reduce((sum, time) => sum + time, 0) / stat.times.length : 0;
    const slowness = Math.min(1, Math.max(0, (averageMs - 2500) / 7500));
    return 1 + errorRate * 3 + slowness * 0.7;
  });
}

function sample(pool, weights, random) {
  const unit = Math.min(1 - Number.EPSILON, Math.max(0, Number(random()) || 0));
  let target = unit * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < pool.length; index++) {
    target -= weights[index];
    if (target < 0) return pool[index];
  }
  return pool[pool.length - 1];
}

export function createQuestion({ mode = 'note', pool = notePool(), profile = emptyProfile(), random = Math.random } = {}) {
  if (!MODES.includes(mode)) throw new RangeError('Unknown practice mode.');
  const available = [...new Set(pool)].filter(validNote).sort((a, b) => a - b);
  if (!available.length) throw new RangeError('Choose at least one piano note.');
  const weights = adaptiveWeights(available, profile);
  const choose = candidates => sample(candidates, candidates.map(note => weights[available.indexOf(note)]), random);
  let notes;
  if (mode === 'note') notes = [choose(available)];
  else if (mode === 'interval') {
    const reference = sample(available, available.map(() => 1), random);
    const nearby = available.filter(note => note !== reference && Math.abs(note - reference) <= 12);
    const candidates = nearby.length ? nearby : available.filter(note => note !== reference);
    if (!candidates.length) throw new RangeError('Interval practice needs at least two different notes.');
    notes = [reference, choose(candidates)];
  } else {
    notes = [choose(available)];
    while (notes.length < 3) {
      const candidates = available.filter(note => note !== notes[notes.length - 1]);
      notes.push(choose(candidates.length ? candidates : available));
    }
  }
  return { mode, notes, answer: [...expectedFor(mode, notes)], label: mode === 'note' ? 'Identify the note' : mode === 'interval' ? 'Identify the second note' : 'Play the three notes in order' };
}
