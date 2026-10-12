import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const baseURL = process.env.PITCH_BASE_URL || 'http://localhost:4173/pitch-trainer/';
await mkdir('test-results', { recursive: true });
let browser, page;
const errors = [];
const phoneViewports = [
 {width:320,height:568}, {width:360,height:640}, {width:390,height:660},
 {width:390,height:704}, {width:430,height:740},
];
async function inspectAudio(context) {
 await context.addInitScript(() => {
  window.__audioEvidence = { buffers: [], oscillators: 0 };
  const startBuffer = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
   const data = this.buffer?.getChannelData(0);
   let peak = 0;
   if (data) for (const sample of data) peak = Math.max(peak, Math.abs(sample));
   window.__audioEvidence.buffers.push({ duration: this.buffer?.duration, rate: this.playbackRate.value, peak });
   return startBuffer.apply(this, args);
  };
  const startOscillator = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...args) {
   window.__audioEvidence.oscillators++;
   return startOscillator.apply(this, args);
  };
 });
}
async function changeSettings(target, configure) {
 await target.click('#open-settings');
 await target.waitForSelector('#settings-dialog[open]');
 await configure();
 await target.click('#close-settings');
 assert.equal(await target.locator('#settings-dialog').isVisible(), false, 'settings close before returning to practice');
}
async function visibleBox(target, selector, label) {
 const box = await target.locator(selector).boundingBox();
 const viewport = target.viewportSize();
 assert(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
  `${label} fully visible at ${viewport.width}x${viewport.height}: ${JSON.stringify(box)}`);
 return box;
}
async function pianoGeometry(target, phase) {
 // Measure layout after the intentional key-press animation returns to rest.
 await target.waitForFunction(() => [...document.querySelectorAll('.piano-key')].every(key => !key.classList.contains('pressed') && getComputedStyle(key).transform === 'none'));
 assert.equal(await target.locator('.piano-key.white').count(), 8, `${phase} retains all eight white keys`);
 const boxes = [];
 for (const key of await target.locator('.piano-key').all()) {
  const midi = await key.getAttribute('data-midi');
  boxes.push(await visibleBox(target, `[data-midi="${midi}"]`, `${phase}: key ${midi}`));
 }
 assert(await target.evaluate(() => document.documentElement.scrollHeight <= innerHeight && scrollY === 0), `${phase} requires no vertical scrolling`);
 assert(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#piano-scroll').scrollLeft === 0), `${phase} requires no horizontal scrolling`);
 return boxes;
}
function sameGeometry(actual, expected, label) {
 assert.equal(actual.length, expected.length);
 actual.forEach((box, index) => {
  for (const property of ['x','y','width','height']) {
   assert(Math.abs(box[property] - expected[index][property]) <= 1, `${label}: control ${index} ${property} stays stable (${box[property]} vs ${expected[index][property]})`);
  }
 });
}
(async()=>{
 browser=await chromium.launch({headless:true});
 // Fresh contexts reproduce the first screen, before focus or a click can scroll it.
 for (const viewport of phoneViewports) {
  const initial = await browser.newContext({viewport});
  await initial.addInitScript(() => {Math.random = () => 0});
  page = await initial.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(baseURL);
  await page.waitForSelector('#start-session');
  assert(await page.evaluate(() => document.querySelector('#exercise-body').closest('.practice-card') === document.querySelector('#piano').closest('.practice-card')), 'exercise and piano share one practice card');
  await visibleBox(page, '#start-session', 'initial start button');
  const idleKeys = await pianoGeometry(page, 'initial idle');
  await page.screenshot({path:`test-results/idle-${viewport.width}x${viewport.height}.png`});
  await page.click('#open-settings');
  await page.waitForSelector('#settings-dialog[open]');
  await page.click('#close-settings');
  sameGeometry(await pianoGeometry(page, 'after settings'), idleKeys, 'closing settings preserves piano');
  await page.click('#start-session');
  await page.waitForFunction(() => !document.querySelector('[data-midi="60"]').disabled);
  assert(await page.locator('#open-settings').isDisabled(), 'active session keeps settings fixed');
  sameGeometry(await pianoGeometry(page, 'after start'), idleKeys, 'start preserves piano');
  const hear = await visibleBox(page, '#replay-target', 'hear button');
  await page.click('#replay-target');
  await page.waitForFunction(() => !document.querySelector('[data-midi="60"]').disabled);
  sameGeometry(await pianoGeometry(page, 'after hear'), idleKeys, 'hearing preserves piano');
  sameGeometry([await visibleBox(page, '#replay-target', 'hear after playback')], [hear], 'hear button stays stable');
  await page.click('[data-midi="60"]');
  await visibleBox(page, '#next-question', 'next button');
  sameGeometry(await pianoGeometry(page, 'answered'), idleKeys, 'feedback preserves piano');
  await page.click('#next-question');
  await page.waitForFunction(() => !document.querySelector('[data-midi="60"]').disabled);
  sameGeometry(await pianoGeometry(page, 'after next'), idleKeys, 'next preserves piano');
  sameGeometry([await visibleBox(page, '#replay-target', 'hear on next question')], [hear], 'next preserves hear position');
  await page.click('#end-session');
  await page.waitForSelector('.result-metrics');
  sameGeometry(await pianoGeometry(page, 'results'), idleKeys, 'results retain piano position');
  await initial.close();
 }

 const context=await browser.newContext({viewport:{width:390,height:660}});
 await inspectAudio(context);
 await context.addInitScript(()=>{Math.random=()=>0});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(baseURL);
 await page.waitForSelector('#start-session');
 await page.screenshot({path:'test-results/mobile.png',fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.click('#start-session');
 await page.waitForFunction(()=>!document.querySelector('[data-midi="60"]').disabled);
 assert(await page.locator('#mode').isDisabled());
 const firstAudio = await page.evaluate(() => window.__audioEvidence);
 assert.equal(firstAudio.oscillators,0, 'default piano uses recordings, not oscillator synthesis');
 assert(firstAudio.buffers.length > 0 && firstAudio.buffers.every(b => b.duration > 5 && b.peak > 0.01), 'real MP3 recordings decode and play successfully');
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.midi),'60', 'Start hands focus to the piano after playback');
 async function assertKeyboardVisible(note=60) {
  const box = await page.locator(`[data-midi="${note}"]`).boundingBox();
  const viewport = page.viewportSize();
  assert(box.y >= 0 && box.y + box.height <= viewport.height,
    `piano stays onscreen at ${viewport.width}x${viewport.height}: ${JSON.stringify(box)}`);
  assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight), 'practice does not require page scrolling');
 }
 for (const viewport of phoneViewports) {
  await page.setViewportSize(viewport);
  await assertKeyboardVisible();
  const replay = await page.locator('#replay-target').boundingBox();
  assert(replay.y >= 0 && replay.y + replay.height <= viewport.height, 'listen button is onscreen');
  const key = await page.locator('[data-midi="60"]').boundingBox();
  console.log('Mobile control positions:', JSON.stringify({viewport,key,replay,gap:key.y-(replay.y+replay.height)}));
  assert(key.y - (replay.y + replay.height) <= 140, 'listen and piano controls stay close');
 }
 await page.setViewportSize({width:390,height:660});
 await page.screenshot({path:'test-results/mobile-active.png',fullPage:false});
 await page.click('#progress-tab'); await page.click('#back-to-practice');
 await assertKeyboardVisible();
 for(let i=0;i<10;i++){
  await page.waitForFunction(()=>!document.querySelector('[data-midi="60"]').disabled);
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.midi),'60', 'Next hands focus to the piano after playback');
  await page.click('[data-midi="60"]');
  assert(await page.locator('[data-midi="60"]').isEnabled(), 'answer can be rehearsed after scoring');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'next-question');
  await page.click('#next-question');
 }
 assert.equal(await page.locator('#total-stat').innerText(),'10');
 assert.equal(await page.locator('#accuracy-stat').innerText(),'100%');
 await page.click('#reset-session');await changeSettings(page, () => page.selectOption('#mode','interval'));
 await page.click('#start-session');await page.waitForFunction(()=>!document.querySelector('[data-midi="62"]').disabled);
 await assertKeyboardVisible(62);
 await page.click('[data-midi="62"]'); assert((await page.locator('#exercise-body').innerText()).includes('Đúng rồi'));
 await page.click('#end-session');await page.click('#reset-session');await changeSettings(page, () => page.selectOption('#mode','melody'));
 await page.click('#start-session');await page.waitForFunction(()=>!document.querySelector('[data-midi="60"]').disabled);
 await assertKeyboardVisible();
 for(const n of [60,62,64]) await page.click(`[data-midi="${n}"]`);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'submit-melody');
 await page.click('#undo-selection');
 assert.equal(await page.locator('.note-slot:not(.empty)').count(),2);
 await page.click('[data-midi="60"]');
 await page.click('#submit-melody');assert((await page.locator('#exercise-body').innerText()).includes('Đúng rồi'));
 await page.click('#end-session');await page.click('#reset-session');await changeSettings(page, () => page.selectOption('#mode','note'));
 await page.click('#start-session');await page.waitForFunction(()=>!document.querySelector('[data-midi="60"]').disabled);
 await page.click('#replay-target');await page.waitForFunction(()=>!document.querySelector('[data-midi="60"]').disabled);await page.click('[data-midi="60"]');
 assert((await page.locator('#exercise-body').innerText()).includes('Có hỗ trợ'));
 assert.equal(await page.locator('#streak-stat').innerText(),'13', 'replay supports practice without erasing a correct streak');
 assert.equal(await page.locator('#accuracy-stat').innerText(),'100%');
 await page.click('#end-session');await page.click('#reset-session');
 await changeSettings(page, async () => {await page.check('#accidentals');await page.selectOption('#range','C3-C5')});
 assert(await page.locator('[data-midi="61"]').isEnabled());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.reload();assert.equal(await page.locator('#total-stat').innerText(),'13');
 assert.equal(await page.locator('#settings-dialog').isVisible(), false, 'reloading never reopens settings');
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
 assert.equal(await page.evaluate(async () => {
  const keys = await caches.keys();
  const paths = new Set();
  for (const name of keys) for (const request of await (await caches.open(name)).keys())
   if (/\/assets\/piano\/\d+\.mp3$/.test(new URL(request.url).pathname)) paths.add(request.url);
  return paths.size;
 }),13, 'all piano anchors are cached before going offline');
 await context.setOffline(true);await page.reload(); await page.waitForSelector('#start-session');
 assert.equal(await page.locator('#total-stat').innerText(),'13');
 await page.click('#start-session');await page.waitForFunction(()=>!document.querySelector('[data-midi="48"]').disabled);
 assert((await page.evaluate(() => window.__audioEvidence.buffers)).length > 0, 'previously unheard low-range piano notes play offline');
 await page.click('[data-midi="48"]');assert.equal(await page.locator('#total-stat').innerText(),'14');
 await page.click('#next-question');
 await page.waitForFunction(()=>!document.querySelector('[data-midi="50"]').disabled);
 await page.click('[data-midi="50"]');
 assert((await page.locator('#exercise-body').innerText()).includes('Đáp án:'));
 assert((await page.locator('.correction-hint').innerText()).includes('cao hơn đáp án 2 bán âm'));
 const beforeRehearsal = await page.evaluate(()=>JSON.parse(localStorage.getItem('pitch.profile.v1')).attempts.length);
 await page.click('#compare-answer');
 await page.waitForFunction(()=>!document.querySelector('#compare-answer').disabled);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'compare-answer', 'comparison retains keyboard focus');
 await page.click('[data-midi="48"]');
 await page.waitForFunction(()=>!document.querySelector('#hear-correct').disabled);
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.midi),'48', 'rehearsal restores focus to the played key');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pitch.profile.v1')).attempts.length),beforeRehearsal, 'correction rehearsal never changes the original score');
 assert.equal(await page.locator('#accuracy-stat').innerText(),'93%');
 assert.equal(await page.locator('#streak-stat').innerText(),'0');
 await page.click('#end-session'); await page.click('#reset-session');
 await changeSettings(page, () => page.check('#challenge')); await page.click('#start-session');
 await page.waitForFunction(()=>!document.querySelector('[data-midi="48"]').disabled);
 assert(await page.locator('#replay-target').isDisabled());
 assert.equal(await page.locator('#play-reference').count(),0);
 await page.click('#end-session');
 await page.setViewportSize({width:360,height:800});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'test-results/mobile-360.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS: initial idle, start, hear, feedback, next, and retained results piano stable at five phone viewports without scrolling, 10-round session, interval, ordered melody, replay scoring, dark keys, persistence, subpath offline audio/gameplay, mobile overflow, no page errors');
 await context.setOffline(false);await page.close();
 const desktop=await context.newPage();await desktop.setViewportSize({width:1440,height:1000});await desktop.goto(baseURL);await desktop.screenshot({path:'test-results/desktop.png',fullPage:true});
 await desktop.check('#computer-keyboard');
 await desktop.click('#open-settings');
 await desktop.keyboard.press('a');
 assert.equal(await desktop.locator('.piano-key.pressed').count(),0, 'keyboard input respects the settings dialog');
 await desktop.click('#close-settings');
 await desktop.keyboard.press('a');
 assert.equal(await desktop.locator('.piano-key.pressed').count(),1, 'keyboard audition resumes after settings close');
 const learner = await browser.newContext({viewport:{width:844,height:390}});
 await learner.addInitScript(()=>{Math.random=()=>0});
 page=await learner.newPage();page.on('pageerror',e=>errors.push(e.message)); await page.goto(baseURL);
 await changeSettings(page, () => page.selectOption('#mode','melody')); await page.click('#start-session');
 await page.waitForFunction(()=>!document.querySelector('[data-midi="60"]').disabled);
 for(const viewport of [{width:844,height:390},{width:667,height:375},{width:320,height:568}]) {
  await page.setViewportSize(viewport); await assertKeyboardVisible();
  for(const id of ['replay-target','submit-melody']) {
   const box=await page.locator(`#${id}`).boundingBox();
   assert(box.y>=0 && box.y+box.height<=viewport.height, `${id} visible for melody at ${JSON.stringify(viewport)}: ${JSON.stringify(box)}`);
  }
 }
 await page.setViewportSize({width:844,height:390});
 await page.screenshot({path:'test-results/landscape-active.png'});
 for(const note of [62,60,62]) await page.click(`[data-midi="${note}"]`);
 await page.click('#submit-melody');
 assert.equal(await page.locator('.review-note.mismatch').count(),3);
 assert.equal(await page.locator('.piano-key.wrong-key').count(),2, 'wrong melody positions are shown even when note identities overlap');
 const feedbackPane=await page.locator('.practice-card').boundingBox();
 for(const chip of await page.locator('.review-note').all()) {
  const box=await chip.boundingBox();
  assert(box.y>=feedbackPane.y && box.y+box.height<=feedbackPane.y+feedbackPane.height, 'melody position feedback stays inside the question pane');
 }
 await page.screenshot({path:'test-results/landscape-feedback.png'});
 await page.click('#end-session'); await page.click('#reset-session');
 await changeSettings(page, () => page.selectOption('#mode','note')); await page.click('#start-session');
 await page.waitForFunction(()=>!document.querySelector('[data-midi="60"]').disabled);
 await page.click('#replay-target'); await page.waitForFunction(()=>!document.querySelector('[data-midi="60"]').disabled);
 await page.click('[data-midi="60"]');
 assert.equal(await page.locator('#accuracy-stat').innerText(),'50%');
 await page.click('#end-session');
 assert((await page.locator('.result-metrics').innerText()).includes('100%'), 'a wholly assisted practice still has an understandable result');
 await page.click('#view-progress');
 assert((await page.locator('#progress-content').innerText()).includes('Không hỗ trợ: 0% trên 1 câu'), 'unassisted measurement stays distinct');
 assert.deepEqual(errors,[]);
 await learner.close();
 const recovery = await browser.newContext({viewport:{width:390,height:660},serviceWorkers:'block'});
 await recovery.addInitScript(() => {Math.random = () => 0});
 await inspectAudio(recovery);
 page = await recovery.newPage(); page.on('pageerror',e=>errors.push(e.message));
 let denySamples = true;
 await page.route('**/assets/piano/*.mp3', route => denySamples ? route.fulfill({status:503,body:'unavailable'}) : route.continue());
 await page.goto(baseURL); await page.click('#start-session');
 await page.waitForSelector('#play-target');
 assert((await page.locator('.error-message').innerText()).includes('Chưa tải được âm piano'));
 assert.equal(await page.locator('#total-stat').innerText(),'0', 'failed loading never records a trial');
 assert.equal((await page.evaluate(() => window.__audioEvidence.buffers)).length,0, 'missing samples never silently become fake piano');
 assert.equal(await page.evaluate(() => window.__audioEvidence.oscillators),0);
 denySamples = false; await page.click('#play-target');
 await page.waitForFunction(()=>!document.querySelector('[data-midi="60"]').disabled);
 assert((await page.evaluate(() => window.__audioEvidence.buffers)).length > 0, 'sample loading recovers on retry');
 await page.click('#end-session');
 await changeSettings(page, () => page.selectOption('#timbre','sine'));
 denySamples = true; const beforeSine = await page.evaluate(() => window.__audioEvidence.oscillators);
 await page.click('#start-session'); await page.waitForFunction(()=>!document.querySelector('[data-midi="60"]').disabled);
 assert((await page.evaluate(() => window.__audioEvidence.oscillators)) > beforeSine, 'sine stays available without piano files');
 assert.deepEqual(errors,[]);
 await recovery.close(); await browser.close();
})().catch(async e=>{console.error(e);await page?.screenshot({path:'test-results/failure.png',fullPage:true}).catch(()=>{});await browser?.close();process.exitCode=1});
