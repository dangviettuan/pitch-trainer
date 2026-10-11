import { AudioEngine } from './audio.js';
import { noteName, notePool, createQuestion, evaluateAnswer, emptyProfile, recordAttempt, summarize, validateProfile } from './engine.js';

const $ = id => document.getElementById(id);
const KEYS = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12 };
const SOLFEGE = ['Đô', 'Đô♯', 'Rê', 'Rê♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const MODE_NAMES = { note: 'Nốt đơn', interval: 'Quãng', melody: 'Giai điệu' };
const TITLES = { note: 'Nhận diện nốt nhạc', interval: 'Lắng nghe khoảng cách', melody: 'Ghi nhớ giai điệu' };
const PROFILE_KEY = 'pitch.profile.v1';
const SETTINGS_KEY = 'pitch.settings.v1';
const audio = new AudioEngine();
let storageAvailable = true;
function readJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
let profile = validateProfile(readJSON(PROFILE_KEY));
const rawSettings = readJSON(SETTINGS_KEY) || {};
const settings = {
  mode: ['note', 'interval', 'melody'].includes(rawSettings.mode) ? rawSettings.mode : 'note',
  range: ['C4-C5', 'C3-C5', 'C4-C6'].includes(rawSettings.range) ? rawSettings.range : 'C4-C5',
  timbre: ['piano', 'sine'].includes(rawSettings.timbre) ? rawSettings.timbre : 'piano',
  accidentals: rawSettings.accidentals === true,
  labels: rawSettings.labels !== false,
  challenge: rawSettings.challenge === true,
  computerKeyboard: rawSettings.computerKeyboard === true,
};
const state = { phase: 'idle', question: null, index: 0, session: [], selected: [], assisted: false, heard: false, startedAt: 0, attempt: null, error: '', playbackBusy: false, view: 'practice' };
let playbackToken = 0;
let midiAccess = null;
let clearArmed = false;
let clearTimer = null;
let pendingExerciseFocus = null;
const speakerIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4V5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7V5Z" fill="currentColor" stroke="none"/></svg>';
const waveform = playing => `<div class="waveform${playing ? ' playing' : ''}" aria-hidden="true">${'<i></i>'.repeat(13)}</div>`;
const formatNotes = notes => notes.map(n => noteName(n).replace('#', '♯')).join(' → ');
const percent = value => value === null ? '—' : `${Math.round(value * 100)}%`;
const seconds = ms => ms === null || !Number.isFinite(ms) ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')}s`;
const isActive = () => ['ready', 'listening', 'awaiting', 'answered'].includes(state.phase);
function announce(message) { $('announcement').textContent = message; }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { storageAvailable = false; $('settings-note').textContent = 'Trình duyệt không cho lưu dữ liệu. Tiến độ chỉ tồn tại trong lần mở này.'; } }
function saveSettings() { save(SETTINGS_KEY, settings); }
function syncSettings() {
  for (const name of ['mode', 'range', 'timbre']) $(name).value = settings[name];
  for (const name of ['accidentals', 'labels', 'challenge']) $(name).checked = settings[name];
  $('computer-keyboard').checked = settings.computerKeyboard;
  $('settings-fields').disabled = isActive();
  $('settings-note').textContent = !storageAvailable ? 'Trình duyệt không cho lưu dữ liệu. Tiến độ chỉ tồn tại trong lần mở này.' : isActive() ? 'Thiết lập được giữ cố định trong phiên. Kết thúc phiên để đổi.' : 'Các nốt cần luyện thêm sẽ xuất hiện thường hơn.';
  $('exercise-title').textContent = TITLES[settings.mode];
  $('practice-tip-text').textContent = settings.mode === 'melody' ? 'Nghe hình dáng của giai điệu: đi lên, đi xuống hay trở về nốt đầu? Chọn đủ 3 nốt theo thứ tự.' : settings.mode === 'interval' ? 'Nốt đầu là mốc nghe. So sánh nốt thứ hai với mốc ấy, rồi chọn riêng nốt thứ hai.' : 'Bắt đầu với một quãng tám. Hát thầm nốt vừa nghe trước khi chọn phím.';
}
function renderStats() {
  const summary = summarize(profile);
  $('total-stat').textContent = summary.attempts;
  $('accuracy-stat').textContent = percent(summary.practiceAccuracy);
  $('streak-stat').textContent = summary.practiceStreak;
  $('accuracy-stat').parentElement.title = `${summary.attempts} câu đã trả lời, gồm ${summary.assisted} câu nghe lại hoặc dùng nốt mẫu. Độ chính xác không hỗ trợ: ${percent(summary.accuracy)}.`;
}
function correctionDetails(attempt) {
  const expected = state.question.answer;
  if (settings.mode === 'melody') return `<div class="melody-review" aria-label="So sánh từng vị trí">${expected.map((note, index) => `<span class="review-note ${note === attempt.answer[index] ? 'match' : 'mismatch'}"><small>Nốt ${index + 1}</small>${formatNotes([attempt.answer[index]])} → <strong>${formatNotes([note])}</strong></span>`).join('')}</div>`;
  const distance = attempt.answer[0] - expected[0];
  return distance ? `<p class="correction-hint">Bạn chọn ${distance > 0 ? 'cao' : 'thấp'} hơn đáp án ${Math.abs(distance)} bán âm. Nghe bạn chọn trước, rồi đáp án.</p>` : '';
}
function renderExercise() {
  if ($('exercise-body').contains(document.activeElement) && document.activeElement.id) pendingExerciseFocus = document.activeElement.id;
  const active = isActive();
  $('session-progress').hidden = !active && state.phase !== 'results';
  $('session-progress-fill').style.width = `${state.phase === 'results' ? 100 : (state.index + (state.phase === 'answered' ? 1 : 0)) * 10}%`;
  $('session-count').textContent = active ? `Câu ${String(state.index + 1).padStart(2, '0')} / 10` : state.phase === 'results' ? `${state.session.length} câu hoàn thành` : '10 câu / phiên';
  let content = '';
  if (state.phase === 'idle') {
    const desc = settings.mode === 'note' ? 'Nghe một nốt, rồi tìm lại trên đàn piano.' : settings.mode === 'interval' ? 'Nghe hai nốt liên tiếp. Chọn nốt thứ hai trên đàn.' : 'Nghe giai điệu ngắn. Chọn lại 3 nốt theo thứ tự.';
    content = `<div class="listen-space">${waveform(false)}<h3>${settings.mode === 'note' ? 'Nghe và tìm lại một nốt.' : settings.mode === 'interval' ? 'Nghe khoảng cách giữa hai nốt.' : 'Nhớ và chọn lại 3 nốt.'}</h3><p>${desc}<br>${MODE_NAMES[settings.mode]} · ${settings.range.replace('-', ' – ')} · 10 câu / phiên.</p><button class="primary-button" id="start-session" type="button">${playIcon}Bắt đầu luyện tập</button><p class="micro-note">${settings.challenge ? 'Thử thách: mỗi câu chỉ nghe một lần.' : 'Tốt nhất khi nghe bằng tai nghe.'}</p>${state.error ? `<p class="error-message">${state.error}</p>` : ''}</div><div class="card-bottom"><span>${speakerIcon}Âm thanh bật khi bạn bắt đầu</span><button class="text-button" id="adjust-settings" type="button">Đổi bài luyện / phạm vi</button></div>`;
  } else if (state.phase === 'results') {
    const sessionSummary = summarize({ version: 1, attempts: state.session });
    const weak = sessionSummary.weakNotes.filter(n => n.mistakes > 0).slice(0, 3).map(n => n.name.replace('#', '♯'));
    content = `<div class="results-space"><div class="result-symbol" aria-hidden="true">✓</div><h3>Một phiên luyện tập trọn vẹn.</h3><p>${state.session.length === 10 ? 'Bạn đã dành thời gian cho đôi tai của mình.' : `Bạn đã hoàn thành ${state.session.length} câu trong phiên này.`}</p><div class="result-metrics"><div><strong>${percent(sessionSummary.practiceAccuracy)}</strong><span>Trả lời đúng</span></div><div><strong>${sessionSummary.practiceCorrect}/${sessionSummary.attempts}</strong><span>Câu đúng / đã luyện</span></div><div><strong>${seconds(sessionSummary.averageMs)}</strong><span>Thời gian không hỗ trợ</span></div></div><div class="session-answer-list" aria-label="${sessionSummary.practiceCorrect} câu đúng, ${sessionSummary.attempts - sessionSummary.practiceCorrect} câu sai, ${sessionSummary.assisted} câu có hỗ trợ">${state.session.map((a, i) => `<span class="result-dot ${a.correct ? 'ok' : 'no'}" title="Câu ${i + 1}: ${`${a.correct ? 'đúng' : 'sai'}${a.assisted ? ', có hỗ trợ' : ''}`}"></span>`).join('')}</div><div class="button-row"><button class="primary-button" id="start-session" type="button">${playIcon}Luyện thêm một phiên</button><button class="secondary-button" id="view-progress" type="button">Xem tiến độ ↗</button></div><div class="results-details">${sessionSummary.assisted ? `${sessionSummary.assisted} câu có nghe lại hoặc nốt mẫu; vẫn tính vào kết quả luyện.<br>` : ''}${weak.length ? `Lần tới, tập trung thêm vào <strong>${weak.join(', ')}</strong>.` : 'Giữ nhịp luyện tập nhỏ này mỗi ngày.'}</div></div><div class="card-bottom"><span>Tiến độ ${storageAvailable ? 'đã lưu trên thiết bị' : 'chỉ lưu trong lần mở này'}</span><button class="end-session" id="reset-session" type="button">Đổi thiết lập</button></div>`;
  } else if (state.phase === 'answered') {
    const a = state.attempt;
    const correct = a.correct;
    const chosen = formatNotes(a.answer);
    const expected = formatNotes(state.question.answer);
    const reference = settings.mode === 'interval' ? `Nốt mốc: ${formatNotes([state.question.notes[0]])}. ` : '';
    content = `<div class="listen-space answered-space">${waveform(false)}<div class="feedback ${correct ? '' : 'incorrect'}"><span class="feedback-icon" aria-hidden="true">${correct ? '✓' : '↗'}</span><div><strong>${correct ? 'Đúng rồi. Bạn nghe rất rõ!' : 'Chưa đúng. Cùng nghe sự khác biệt.'}</strong><p>${reference}Bạn chọn <span class="feedback-notes">${chosen}</span>${correct ? '.' : `. Đáp án: <span class="feedback-notes">${expected}</span>.`}</p></div></div>${correctionDetails(a)}<div class="session-meta"><span>${seconds(a.elapsedMs)} để trả lời</span><span>${a.assisted ? 'Có hỗ trợ · Đã ghi kết quả' : correct ? 'Lần trả lời đầu tiên · Đúng' : 'Lần trả lời đầu tiên · Sai'}</span></div><div class="button-row"><button class="secondary-button" id="hear-correct" type="button" ${state.playbackBusy ? 'disabled' : ''}>${speakerIcon}Nghe đáp án</button>${correct ? '' : `<button class="secondary-button" id="compare-answer" type="button" ${state.playbackBusy ? 'disabled' : ''}>${speakerIcon}${settings.mode === 'melody' ? 'So sánh giai điệu' : 'So sánh hai âm'}</button>`}<button class="primary-button" id="next-question" type="button">${state.index === 9 ? 'Xem kết quả' : 'Câu tiếp theo'}<span aria-hidden="true">→</span></button></div>${state.error ? `<p class="error-message">${state.error}</p>` : ''}</div><div class="card-bottom"><span>Phím xanh: đáp án${correct ? '' : ' · Viền cam: nốt chọn sai vị trí'}</span><button class="end-session" id="end-session" type="button">Kết thúc phiên</button></div>`;
  } else {
    const listening = state.phase === 'listening';
    const headlines = { note: 'Bạn vừa nghe nốt nào?', interval: 'Nốt thứ hai là nốt nào?', melody: 'Giai điệu vừa rồi là gì?' };
    const instructions = { note: 'Chọn một phím trên đàn để trả lời.', interval: `Nốt mốc: ${formatNotes([state.question.notes[0]])}. Chọn riêng nốt thứ hai.`, melody: 'Chọn 3 phím theo thứ tự, rồi xác nhận.' };
    const ready = state.phase === 'ready';
    const melodySelection = settings.mode === 'melody' ? `<div class="selection-sequence" aria-label="Các nốt bạn đã chọn">${[0, 1, 2].map(i => `<span class="note-slot ${state.selected[i] === undefined ? 'empty' : ''}">${state.selected[i] === undefined ? '·' : noteName(state.selected[i]).replace('#', '♯')}</span>`).join('')}</div>` : '';
    content = `<div class="listen-space">${waveform(listening)}${state.assisted ? '<span class="mini-badge">Có nghe lại / nốt mẫu</span>' : ''}<h3>${listening ? 'Lắng nghe…' : ready ? 'Sẵn sàng lắng nghe?' : headlines[settings.mode]}</h3><p>${listening ? 'Đợi âm thanh kết thúc trước khi chọn phím.' : ready ? 'Bấm nghe để phát câu hỏi.' : instructions[settings.mode]}</p>${melodySelection}<div class="button-row">${ready ? `<button class="primary-button" id="play-target" type="button">${speakerIcon}Nghe câu hỏi</button>` : `<button class="secondary-button" id="replay-target" type="button" ${listening || settings.challenge ? 'disabled' : ''}>${speakerIcon}${settings.challenge ? 'Chỉ nghe một lần' : 'Nghe lại'}</button>`}${settings.mode === 'note' && !settings.challenge ? `<button class="secondary-button" id="play-reference" type="button" ${!state.heard || listening ? 'disabled' : ''}>Nốt mẫu C4</button>` : ''}${settings.mode === 'melody' ? `<button class="primary-button" id="submit-melody" type="button" ${state.selected.length !== 3 || listening || ready ? 'disabled' : ''}>Xác nhận<span aria-hidden="true">→</span></button>` : ''}</div>${settings.mode === 'melody' && state.selected.length ? `<button class="text-button" id="undo-selection" type="button" ${listening ? 'disabled' : ''}>Xóa nốt cuối</button>` : ''}<p class="micro-note">${settings.challenge ? 'Thử thách · Không nghe lại, không nốt mẫu' : 'Cứ nghe lại khi cần. Kết quả luyện vẫn được ghi.'}</p>${settings.mode === 'note' && !settings.challenge ? '<p class="micro-note">C4 là mốc để nghe tương đối; bỏ mốc để luyện nhớ cao độ.</p>' : ''}${state.error ? `<p class="error-message">${state.error}</p>` : ''}</div><div class="card-bottom"><span>${settings.mode === 'melody' ? `${state.selected.length} / 3 nốt đã chọn` : 'Trả lời bằng đàn bên dưới'}</span><button class="end-session" id="end-session" type="button">Kết thúc phiên</button></div>`;
  }
  $('exercise-body').innerHTML = content;
  $('piano-description').textContent = state.phase === 'answered' ? 'So sánh đáp án. Bấm “Câu tiếp theo” khi sẵn sàng.' : state.phase === 'listening' || state.phase === 'ready' ? 'Nghe hết câu hỏi trước khi chọn phím.' : state.phase === 'awaiting' ? settings.mode === 'melody' ? 'Chọn 3 phím theo thứ tự nghe được.' : 'Chọn một phím để gửi câu trả lời.' : 'Chạm phím để làm quen với âm thanh.';
  $('piano-title').textContent = state.phase === 'awaiting' ? 'Chọn phím · Không phát âm' : state.phase === 'answered' ? 'Chạm phím để tập lại' : 'Đàn piano của bạn';
  if (state.phase === 'answered') $('piano-description').textContent = 'Chạm phím để nghe và tập lại. Kết quả câu trả lời đã được ghi.';
  updatePianoState();
  if (pendingExerciseFocus && !state.playbackBusy && state.view === 'practice' && (state.phase !== 'ready' || state.error)) {
    const replacement = $(pendingExerciseFocus);
    const target = replacement && !replacement.disabled ? replacement : state.phase === 'awaiting' ? $('piano').querySelector('button:not(:disabled)') : state.phase === 'answered' ? $('next-question') : state.phase === 'ready' ? $('play-target') : $('start-session');
    target?.focus({ preventScroll: true });
    pendingExerciseFocus = null;
  }
}
function renderPiano() {
  const all = notePool(settings.range, true);
  const white = all.filter(n => !noteName(n).includes('#'));
  let whiteIndex = 0;
  const base = all.includes(60) ? 60 : all[0];
  const shortcuts = Object.fromEntries(Object.entries(KEYS).map(([key, offset]) => [base + offset, key.toUpperCase()]));
  $('piano').classList.toggle('single-octave', white.length === 8);
  $('piano').style.width = `calc(var(--white-width) * ${white.length})`;
  $('piano').innerHTML = all.map(midi => {
    const black = noteName(midi).includes('#');
    const left = black ? `calc(var(--white-width) * ${whiteIndex} - var(--black-width) / 2)` : `calc(var(--white-width) * ${whiteIndex++})`;
    const label = settings.labels ? `<span class="note-solfege">${SOLFEGE[midi % 12]}</span><span>${noteName(midi).replace('#', '♯')}</span>` : '';
    const shortcut = settings.computerKeyboard && shortcuts[midi] ? `<span class="key-shortcut">${shortcuts[midi]}</span>` : '';
    return `<button class="piano-key ${black ? 'black' : 'white'}" data-midi="${midi}" type="button" style="left:${left}" aria-label="${SOLFEGE[midi % 12]}, ${noteName(midi)}">${shortcut}${label}</button>`;
  }).join('');
  $('piano-range').textContent = settings.range.replace('-', ' — ');
  $('input-hint').textContent = settings.computerKeyboard ? 'A W S E D F T G Y H U J K · Từ C4' : 'Chạm hoặc nhấp vào phím';
  updatePianoState();
}
function updatePianoState() {
  const available = new Set(notePool(settings.range, settings.accidentals));
  for (const button of $('piano').querySelectorAll('[data-midi]')) {
    const midi = Number(button.dataset.midi);
    button.disabled = !available.has(midi) || (isActive() && !['awaiting', 'answered'].includes(state.phase)) || state.playbackBusy || (settings.mode === 'melody' && state.phase === 'awaiting' && state.selected.length >= 3);
    // A key can be correct at one position and wrong at another in a melody.
    const wrongPosition = state.phase === 'answered' && state.attempt.answer.some((note, index) => note === midi && note !== state.question.answer[index]);
    button.classList.toggle('correct-key', state.phase === 'answered' && state.question.answer.includes(midi));
    button.classList.toggle('wrong-key', wrongPosition);
  }
}
function render() { document.body.classList.toggle('session-active', isActive() && state.view === 'practice'); syncSettings(); renderStats(); renderExercise(); }
function audioError() { state.error = 'Không thể phát âm thanh. Kiểm tra âm lượng và quyền âm thanh của trình duyệt, rồi bấm nghe lại.'; announce(state.error); }
async function playTarget(assisted = false) {
  if (!state.question || state.phase === 'answered' || state.phase === 'results' || state.phase === 'listening') return;
  if (assisted && settings.challenge) return;
  const token = ++playbackToken;
  // Mark help only after the requested sound actually completes.
  state.phase = 'listening'; state.error = ''; state.playbackBusy = true;
  render();
  try {
    const completed = await audio.play(state.question.notes, { sequence: true, timbre: settings.timbre });
    if (token !== playbackToken || !completed) return;
    state.heard = true;
    if (assisted) state.assisted = true;
    // Time always starts after the first successful target playback, including replay time thereafter.
    if (!state.startedAt) state.startedAt = performance.now();
    state.phase = 'awaiting';
    announce(settings.mode === 'melody' ? 'Đã phát xong. Chọn 3 nốt theo thứ tự.' : 'Đã phát xong. Chọn phím để trả lời.');
  } catch {
    if (token !== playbackToken) return;
    state.phase = state.heard ? 'awaiting' : 'ready';
    audioError();
  } finally {
    if (token === playbackToken) { state.playbackBusy = false; render(); }
  }
}
function newQuestion() {
  ++playbackToken; audio.stop();
  state.question = createQuestion({ mode: settings.mode, pool: notePool(settings.range, settings.accidentals), profile });
  state.phase = 'ready'; state.selected = []; state.assisted = false; state.heard = false; state.startedAt = 0; state.attempt = null; state.error = ''; state.playbackBusy = false;
  render();
  void playTarget();
}
function startSession() {
  if (isActive()) return;
  state.session = []; state.index = 0; newQuestion();
  if (matchMedia('(max-width: 640px)').matches) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}
async function playReference() {
  if (state.phase !== 'awaiting' || settings.challenge || settings.mode !== 'note') return;
  const token = ++playbackToken;
  state.phase = 'listening'; state.playbackBusy = true; state.error = ''; render();
  try { if (await audio.play([60], { timbre: settings.timbre }) && token === playbackToken) state.assisted = true; }
  catch { if (token === playbackToken) audioError(); }
  finally { if (token === playbackToken) { state.phase = 'awaiting'; state.playbackBusy = false; render(); if (!state.error) announce('Nốt mẫu C4. Kết quả luyện vẫn được ghi.'); } }
}
function flashKey(midi) {
  const key = $('piano').querySelector(`[data-midi="${midi}"]`);
  if (!key) return;
  key.classList.add('pressed'); setTimeout(() => key.classList.remove('pressed'), 200);
}
function chooseNote(midi) {
  if (!notePool(settings.range, settings.accidentals).includes(midi)) return;
  if (state.phase === 'idle' || state.phase === 'results') {
    flashKey(midi);
    audio.play([midi], { timbre: settings.timbre }).catch(() => { state.error = 'Không thể phát âm thanh. Kiểm tra quyền âm thanh của trình duyệt.'; renderExercise(); });
    return;
  }
  if (state.phase === 'answered') { if (!state.playbackBusy) { flashKey(midi); void hearAnswer([midi]); } return; }
  if (state.phase !== 'awaiting' || !state.heard) return;
  flashKey(midi);
  if (settings.mode === 'melody') {
    if (state.selected.length >= 3) return;
    state.selected.push(midi); renderExercise();
    if (state.selected.length === 3) $('submit-melody').focus({ preventScroll: true });
    // Answer entry stays silent so repeated notes cannot serve as a reference during the trial.
    announce(`Đã chọn ${state.selected.length} trên 3 nốt: ${formatNotes(state.selected)}.`);
  } else submitAnswer([midi]);
}
function submitAnswer(answer) {
  if (state.phase !== 'awaiting' || !state.heard) return;
  if (settings.mode === 'melody' && answer.length !== 3) return;
  const correct = evaluateAnswer(state.question.answer, answer);
  profile = recordAttempt(profile, { question: state.question, answer, correct, elapsedMs: performance.now() - state.startedAt, assisted: state.assisted });
  state.attempt = profile.attempts.at(-1);
  state.session.push(state.attempt); state.phase = 'answered';
  save(PROFILE_KEY, profile); render();
  $('next-question').focus({ preventScroll: true });
  announce(`${correct ? 'Đúng.' : 'Chưa đúng.'} Bạn chọn ${formatNotes(answer)}. Đáp án ${formatNotes(state.question.answer)}.${state.assisted ? ' Câu có hỗ trợ, đã ghi kết quả luyện.' : ''} Bấm câu tiếp theo khi sẵn sàng.`);
}
function finishSession() {
  ++playbackToken; audio.stop(); state.playbackBusy = false; state.error = '';
  if (state.session.length) { state.phase = 'results'; announce('Phiên luyện tập kết thúc. Kết quả đã hiển thị.'); }
  else { state.phase = 'idle'; state.question = null; announce('Đã kết thúc phiên. Chưa có câu trả lời nào được ghi.'); }
  render();
}
function nextQuestion() { if (state.phase !== 'answered') return; if (state.index === 9) finishSession(); else { state.index++; newQuestion(); } }
async function hearAnswer(notes) {
  if (state.phase !== 'answered' || state.playbackBusy) return;
  const token = ++playbackToken; state.playbackBusy = true; state.error = ''; renderExercise();
  try { await audio.play(notes, { timbre: settings.timbre }); } catch { if (token === playbackToken) audioError(); }
  finally { if (token === playbackToken) { state.playbackBusy = false; renderExercise(); } }
}
function renderProgress() {
  const summary = summarize(profile);
  if (!summary.attempts) {
    $('progress-content').innerHTML = `<div class="empty-progress">${waveform(false)}<h3>Mọi tiến bộ bắt đầu từ nốt đầu tiên.</h3><p>Hoàn thành một phiên luyện tập để thấy độ chính xác, những nốt cần luyện thêm và lịch sử trả lời của bạn.</p></div>`;
    return;
  }
  const notes = [...summary.weakNotes].sort((a, b) => a.midi - b.midi);
  const history = profile.attempts.slice(-20).reverse();
  $('progress-content').innerHTML = `<div class="progress-section"><h3>Độ chính xác không hỗ trợ theo từng nốt</h3><p>Kết quả luyện: ${summary.practiceCorrect}/${summary.attempts} câu đúng (${percent(summary.practiceAccuracy)}).<br>Không hỗ trợ: ${percent(summary.accuracy)} trên ${summary.scoredAttempts} câu · ${summary.assisted} câu có nghe lại hoặc nốt mẫu. Thời gian trung bình cho câu đúng: ${seconds(summary.averageMs)}.<br>Với giai điệu, mỗi vị trí nốt được đánh giá riêng; cả câu đúng khi đủ 3 nốt theo thứ tự.</p>${notes.length ? `<div class="note-progress-list">${notes.map(n => `<div class="note-progress"><div class="note-progress-head">${n.name.replace('#', '♯')}<span>${percent(n.accuracy)}</span></div><div class="note-progress-bar"><span style="width:${Math.round(n.accuracy * 100)}%"></span></div><small>${n.attempts} lần nghe · ${n.mistakes} lần chưa đúng</small></div>`).join('')}</div>` : '<p>Chưa có câu không dùng hỗ trợ. Luyện thêm để theo dõi từng nốt.</p>'}</div><div class="progress-section"><h3>Lịch sử trả lời gần đây</h3><p>Lưu tối đa 500 câu gần nhất trên thiết bị này. Bảng hiển thị 20 câu mới nhất.</p><div class="history-table-wrap"><table><thead><tr><th>Thời gian</th><th>Kiểu luyện</th><th>Đáp án</th><th>Bạn chọn</th><th>Kết quả</th><th>Phản hồi</th></tr></thead><tbody>${history.map(a => `<tr><td>${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(a.at)}</td><td>${MODE_NAMES[a.mode]}</td><td>${formatNotes(a.mode === 'interval' ? [a.notes[1]] : a.notes)}</td><td>${formatNotes(a.answer)}</td><td><span class="history-outcome ${a.assisted ? 'help' : a.correct ? '' : 'no'}">${a.assisted ? `Hỗ trợ · ${a.correct ? 'Đúng' : 'Sai'}` : a.correct ? 'Đúng' : 'Chưa đúng'}</span></td><td>${seconds(a.elapsedMs)}</td></tr>`).join('')}</tbody></table></div></div><div class="data-actions"><p>Dữ liệu thuộc về bạn và được lưu trên trình duyệt này.<br>Kết quả luyện tính mọi câu trả lời. Chỉ số không hỗ trợ dùng riêng các câu không nghe lại hoặc dùng nốt mẫu.</p><button class="danger-button" id="clear-data" type="button">${clearArmed ? 'Bấm lần nữa để xóa toàn bộ' : 'Xóa tiến độ'}</button></div>`;
}
function showView(view) {
  state.view = view;
  document.body.classList.toggle('session-active', isActive() && view === 'practice');
  $('practice-view').hidden = view !== 'practice'; $('progress-view').hidden = view !== 'progress';
  $('practice-tab').classList.toggle('selected', view === 'practice'); $('progress-tab').classList.toggle('selected', view === 'progress');
  $('practice-tab').toggleAttribute('aria-current', view === 'practice'); $('progress-tab').toggleAttribute('aria-current', view === 'progress');
  if (view === 'practice') $('practice-tab').setAttribute('aria-current', 'page'); else $('progress-tab').setAttribute('aria-current', 'page');
  $('page-title').innerHTML = view === 'practice' ? 'Nghe kỹ. <span>Chạm đúng.</span>' : 'Từng nốt. <span>Từng tiến bộ.</span>';
  $('page-description').textContent = view === 'practice' ? 'Rèn đôi tai của bạn, từng nốt nhạc một.' : 'Nhìn lại những điều đôi tai bạn đã học được.';
  if (view === 'progress') renderProgress();
}
$('exercise-body').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  const actions = { 'start-session': startSession, 'adjust-settings': () => { $('mode').focus(); $('mode').scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 'play-target': () => playTarget(), 'replay-target': () => playTarget(true), 'play-reference': playReference, 'next-question': nextQuestion, 'end-session': finishSession, 'submit-melody': () => submitAnswer([...state.selected]), 'undo-selection': () => { if (state.phase === 'awaiting') { state.selected.pop(); renderExercise(); announce(`Đã xóa nốt cuối. Còn ${state.selected.length} trên 3 nốt.`); } }, 'hear-correct': () => hearAnswer(state.question.answer), 'compare-answer': () => { announce('Nghe phần bạn chọn trước, rồi đáp án.'); return hearAnswer([...state.attempt.answer, ...state.question.answer]); }, 'view-progress': () => showView('progress'), 'reset-session': () => { state.phase = 'idle'; state.question = null; render(); } };
  actions[button.id]?.();
});
for (const id of ['mode', 'range', 'timbre', 'accidentals', 'labels', 'challenge']) {
  $(id).addEventListener('change', () => {
    if (isActive()) { syncSettings(); return; }
    settings[id] = ['accidentals', 'labels', 'challenge'].includes(id) ? $(id).checked : $(id).value;
    if (state.phase === 'results') { state.phase = 'idle'; state.question = null; }
    state.error = ''; saveSettings(); renderPiano(); render();
  });
}
$('computer-keyboard').addEventListener('change', () => { settings.computerKeyboard = $('computer-keyboard').checked; saveSettings(); renderPiano(); });
$('piano').addEventListener('click', event => { const key = event.target.closest('[data-midi]'); if (key && !key.disabled) chooseNote(Number(key.dataset.midi)); });
document.addEventListener('keydown', event => {
  if (!settings.computerKeyboard || state.view !== 'practice' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable) return;
  const offset = KEYS[event.key.toLowerCase()]; if (offset === undefined) return;
  event.preventDefault(); chooseNote(60 + offset);
});
$('practice-tab').addEventListener('click', () => showView('practice'));
$('progress-tab').addEventListener('click', () => showView('progress'));
$('back-to-practice').addEventListener('click', () => showView('practice'));
$('progress-content').addEventListener('click', event => {
  if (event.target.id !== 'clear-data') return;
  if (isActive()) { announce('Kết thúc phiên luyện tập trước khi xóa tiến độ.'); return; }
  if (!clearArmed) { clearArmed = true; renderProgress(); announce('Bấm lần nữa trong 8 giây để xóa toàn bộ tiến độ.'); clearTimer = setTimeout(() => { clearArmed = false; renderProgress(); }, 8000); return; }
  clearTimeout(clearTimer); clearArmed = false; profile = emptyProfile(); save(PROFILE_KEY, profile); state.session = []; state.phase = 'idle'; state.question = null; render(); renderProgress(); announce('Đã xóa tiến độ luyện tập.');
});
function midiStatus(message) { $('midi-status').hidden = false; $('midi-status').textContent = message; }
function attachMidiInputs() {
  const inputs = [...midiAccess.inputs.values()].filter(input => input.state === 'connected');
  for (const input of midiAccess.inputs.values()) {
    input.onmidimessage = event => { const [status, midi, velocity] = event.data; if ((status & 0xf0) === 0x90 && velocity > 0 && state.view === 'practice') { if (!notePool(settings.range, settings.accidentals).includes(midi)) announce(`Nốt ${noteName(midi)} nằm ngoài phạm vi bài luyện.`); else chooseNote(midi); } };
  }
  $('midi-button').textContent = inputs.length ? 'MIDI đã kết nối ✓' : 'Tìm lại thiết bị MIDI ↗';
  midiStatus(inputs.length ? `Đã kết nối ${inputs.map(input => input.name || 'đàn MIDI').join(', ')}. Dùng phím trong phạm vi đang chọn.` : 'Chưa thấy đàn MIDI. Cắm thiết bị rồi thử lại; bạn vẫn có thể dùng đàn ảo.');
}
$('midi-button').addEventListener('click', async () => {
  if (!navigator.requestMIDIAccess) { midiStatus('Trình duyệt này chưa hỗ trợ MIDI. Bạn có thể dùng đàn ảo hoặc bàn phím máy tính.'); return; }
  $('midi-button').disabled = true;
  try { midiAccess ||= await navigator.requestMIDIAccess({ sysex: false }); midiAccess.onstatechange = attachMidiInputs; attachMidiInputs(); }
  catch { midiStatus('Chưa được cấp quyền MIDI. Cho phép trong trình duyệt rồi thử lại, hoặc dùng đàn ảo.'); }
  finally { $('midi-button').disabled = false; }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  const interrupted = state.phase === 'listening';
  ++playbackToken; audio.stop(); state.playbackBusy = false;
  if (interrupted) { state.phase = state.heard ? 'awaiting' : 'ready'; state.error = 'Âm thanh đã dừng khi bạn chuyển trang. Bấm nghe lại khi sẵn sàng.'; render(); }
});
syncSettings(); renderPiano(); render();
if ('serviceWorker' in navigator) {
  // An already-open, idle app should pick up a new deployment without retaining the old layout.
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && state.phase === 'idle') location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {
      announce('Chưa thể bật chế độ offline. Bạn vẫn có thể luyện khi có mạng.');
    });
  });
}
