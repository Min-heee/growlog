// 말끝 통역: 계속 듣다가 말 끝에 정해둔 끝말(예: "번역")이 들리면 그 앞의 말을 바로 번역하고 읽어준다.
// 조용해질 때까지 기다리지 않으므로 주변 소리 때문에 말이 끝난 걸 못 알아채는 일이 없다.
import { findTrigger, joinResults, joinText, parseTriggers } from './trigger.js';

/** 언어별 음성 인식·읽기 코드, 기본 끝말, 말하는 사람에게 보여줄 안내 (그 사람의 언어로) */
const LANGS = {
  ko: { name: '한국어', voice: 'ko-KR', trigger: '번역', hint: (w) => `말을 마치면 "${w}"라고 말하세요` },
  en: { name: 'English', voice: 'en-US', trigger: 'translate', hint: (w) => `When you finish, say "${w}"` },
  ja: { name: '日本語', voice: 'ja-JP', trigger: '翻訳, ほんやく', hint: (w) => `話し終わったら「${w}」と言ってください` },
  'zh-CN': { name: '中文', voice: 'zh-CN', trigger: '翻译', hint: (w) => `说完后请说"${w}"` },
  es: { name: 'Español', voice: 'es-ES', trigger: 'traducir', hint: (w) => `Cuando termines, di "${w}"` },
  fr: { name: 'Français', voice: 'fr-FR', trigger: 'traduire', hint: (w) => `Quand vous avez fini, dites « ${w} »` },
  de: { name: 'Deutsch', voice: 'de-DE', trigger: 'übersetzen', hint: (w) => `Wenn Sie fertig sind, sagen Sie „${w}“` },
  vi: { name: 'Tiếng Việt', voice: 'vi-VN', trigger: 'dịch', hint: (w) => `Nói xong, hãy nói "${w}"` },
  th: { name: 'ไทย', voice: 'th-TH', trigger: 'แปล', hint: (w) => `พูดจบแล้วให้พูดว่า "${w}"` },
  id: { name: 'Bahasa Indonesia', voice: 'id-ID', trigger: 'terjemahkan', hint: (w) => `Setelah selesai, ucapkan "${w}"` },
  ru: { name: 'Русский', voice: 'ru-RU', trigger: 'переведи', hint: (w) => `Закончив, скажите «${w}»` },
};

const STORE = 'malkkeut:v1';
const DEFAULTS = { a: 'ko', b: 'en', triggers: {}, speak: true, autoSwitch: true, keepAwake: true, wait: 0.6, rate: 1 };
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const canSpeak = 'speechSynthesis' in window;

const settings = load();
let side = 'a'; // 지금 말하는 쪽. a는 나, b는 상대
let phase = 'idle'; // idle | listening | translating | speaking
let buffer = ''; // 이번 말에서 이미 끝난 인식 결과 (인식기가 중간에 끊겼다 다시 시작해도 이어 붙인다)
let live = ''; // 지금 인식 중인 결과
let rec = null;
let turn = 0; // 무언가 새로 시작할 때마다 올린다. 늦게 끝난 번역이 그다음 일을 이어가지 않게 한다
let confirmTimer = null;
let restartTimer = null;
let startedAt = 0;
let quickEnds = 0;
const log = [];

const $ = (id) => document.getElementById(id);

function load() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORE)) ?? {};
  } catch {}
  const merged = { ...DEFAULTS, ...saved, triggers: { ...saved.triggers } };
  if (!LANGS[merged.a]) merged.a = DEFAULTS.a;
  if (!LANGS[merged.b]) merged.b = DEFAULTS.b;
  return merged;
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(settings));
  } catch {}
}

const langOf = (s) => settings[s];
const other = (s) => (s === 'a' ? 'b' : 'a');
const triggerText = (code) => settings.triggers[code] ?? LANGS[code].trigger;
const triggersOf = (code) => parseTriggers(triggerText(code));
const spoken = () => joinText([buffer, live], langOf(side));

// ---------- 듣기 ----------

function listen(s) {
  if (!Recognition) return;
  turn++;
  cancelSpeech();
  stopRecognition();
  side = s;
  phase = 'listening';
  buffer = '';
  live = '';
  quickEnds = 0;
  notice('');
  keepAwake(true);
  startRecognition();
  render();
}

function startRecognition() {
  const r = new Recognition();
  r.lang = LANGS[langOf(side)].voice;
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.onresult = (event) => rec === r && heard(event);
  r.onerror = (event) => rec === r && failed(event.error);
  r.onend = () => rec === r && ended();
  rec = r;
  startedAt = Date.now();
  try {
    r.start();
  } catch {
    rec = null;
    ended();
  }
}

function stopRecognition() {
  clearTimeout(confirmTimer);
  clearTimeout(restartTimer);
  confirmTimer = restartTimer = null;
  const r = rec;
  rec = null; // 아래 abort가 부르는 onend와 늦게 온 결과는 무시된다
  try {
    r?.abort();
  } catch {}
}

function heard(event) {
  quickEnds = 0;
  live = joinResults(Array.from(event.results, (result) => result[0]?.transcript), langOf(side));
  check(event.results[event.results.length - 1]?.isFinal);
}

/** 끝말로 끝났는지 본다. 인식이 확정됐으면 바로, 아직 바뀔 수 있으면 잠깐 더 들어보고 보낸다 */
function check(final) {
  const hit = findTrigger(spoken(), triggersOf(langOf(side)));
  renderLive(hit);
  if (!hit) {
    clearTimeout(confirmTimer);
    confirmTimer = null;
    return;
  }
  if (final || settings.wait <= 0) {
    send(hit.before);
    return;
  }
  // "번역가"처럼 끝말로 시작하는 낱말이 들리는 중일 수 있다. 그동안 끝말이 사라지면 취소된다
  confirmTimer ??= setTimeout(() => {
    confirmTimer = null;
    const again = phase === 'listening' && findTrigger(spoken(), triggersOf(langOf(side)));
    if (again) send(again.before);
  }, settings.wait * 1000);
}

function failed(error) {
  const name = LANGS[langOf(side)].name;
  const messages = {
    'not-allowed': '마이크를 쓸 수 없어요. 브라우저의 마이크 권한을 허용해 주세요.',
    'service-not-allowed': '이 브라우저에서 음성 인식을 쓸 수 없어요. 아이폰은 설정에서 Siri와 받아쓰기를 켜주세요.',
    'audio-capture': '마이크를 찾지 못했어요. 구글 번역처럼 마이크를 쓰는 다른 앱이 열려 있다면 닫아주세요.',
    'language-not-supported': `이 브라우저는 ${name} 음성 인식을 지원하지 않아요.`,
  };
  if (messages[error]) {
    stop();
    notice(messages[error]);
  } else if (error === 'network') {
    notice('음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
  }
  // no-speech, aborted 같은 나머지는 onend에서 다시 듣는다
}

/** 인식기는 조용하거나 오래 들으면 스스로 끝난다. 끝말을 듣기 전이면 이어서 다시 듣는다 */
function ended() {
  rec = null;
  buffer = spoken();
  live = '';
  if (phase !== 'listening') return;
  const hit = findTrigger(buffer, triggersOf(langOf(side)));
  if (hit) {
    send(hit.before);
    return;
  }
  quickEnds = Date.now() - startedAt < 1500 ? quickEnds + 1 : 0;
  if (quickEnds >= 6) {
    stop();
    notice('음성 인식이 자꾸 끊겨요. 인터넷 연결과 마이크 권한을 확인한 뒤 다시 눌러주세요.');
    return;
  }
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (phase === 'listening' && !rec) startRecognition();
  }, quickEnds * 400);
  renderLive(null);
}

// ---------- 번역과 읽기 ----------

async function send(text) {
  const who = side;
  const my = ++turn;
  stopRecognition();
  buffer = '';
  live = '';
  if (!text.trim()) {
    listen(who);
    notice('끝말만 들렸어요. 할 말을 먼저 하고 끝에 끝말을 붙여주세요.');
    return;
  }
  navigator.vibrate?.(40); // 끝말을 알아들었다는 표시 (안드로이드)
  const entry = { who, from: langOf(who), to: langOf(other(who)), src: text, out: '', state: 'pending' };
  log.push(entry);
  phase = 'translating';
  render();
  await translateEntry(entry);
  if (my !== turn) return; // 그사이 다른 버튼을 눌렀다
  if (entry.state === 'done' && settings.speak) {
    phase = 'speaking';
    render();
    await speak(entry.out, entry.to);
    if (my !== turn) return;
  }
  // 번역이 잘 됐으면 상대가 대답할 차례. 실패했으면 같은 사람이 다시 말할 수 있게 둔다
  listen(entry.state === 'done' && settings.autoSwitch ? other(who) : who);
}

async function translateEntry(entry) {
  entry.state = 'pending';
  entry.error = '';
  renderLog();
  try {
    const result = await translate(entry.src, entry.from, entry.to);
    Object.assign(entry, { out: result.text, engine: result.engine, state: 'done' });
  } catch (err) {
    Object.assign(entry, { state: 'error', error: err.message });
  }
  renderLog();
}

/** 지난 번역을 다시 읽는다. 읽는 동안에는 마이크를 쉬어 읽는 소리를 받아 적지 않게 한다 */
async function replay(entry) {
  const resume = phase === 'idle' ? null : side;
  const my = ++turn;
  stopRecognition();
  phase = 'speaking';
  render();
  await speak(entry.out, entry.to);
  if (my !== turn) return;
  if (resume) listen(resume);
  else stop();
}

async function retry(entry) {
  await translateEntry(entry);
  if (entry.state === 'done' && settings.speak) replay(entry);
}

function stop() {
  turn++;
  stopRecognition();
  cancelSpeech();
  phase = 'idle';
  buffer = '';
  live = '';
  keepAwake(false);
  render();
}

async function getJSON(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    throw err.name === 'AbortError' ? new Error('응답이 너무 늦어요') : err;
  } finally {
    clearTimeout(timer);
  }
}

const translators = {};
const decode = (html) => new DOMParser().parseFromString(html, 'text/html').documentElement.textContent;

/** 앞에서부터 차례로 시도한다. 구글이 막히면 다른 곳으로 넘어간다 */
const ENGINES = [
  {
    name: 'Google',
    async run(text, from, to) {
      const q = encodeURIComponent(text);
      const data = await getJSON(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${q}`, 5000);
      return data[0].map((part) => part[0]).join('');
    },
  },
  {
    name: 'MyMemory',
    async run(text, from, to) {
      const q = encodeURIComponent(text);
      const data = await getJSON(`https://api.mymemory.translated.net/get?q=${q}&langpair=${from}|${to}`, 7000);
      if (Number(data.responseStatus) !== 200) throw new Error(data.responseDetails || `상태 ${data.responseStatus}`);
      return decode(data.responseData.translatedText);
    },
  },
  {
    // PC Chrome의 기기 안 번역. 언어 파일을 이미 받아둔 경우에만 쓴다 (받는 중에는 몇 분씩 응답이 없다)
    name: '브라우저 내장',
    async run(text, from, to) {
      if (!('Translator' in self)) throw new Error('지원하지 않음');
      const languages = { sourceLanguage: from.split('-')[0], targetLanguage: to.split('-')[0] };
      const pair = `${from}>${to}`;
      try {
        if (!translators[pair]) {
          if ((await withTimeout(self.Translator.availability(languages), 1500)) !== 'available') throw new Error('언어 파일 없음');
          translators[pair] = self.Translator.create(languages);
        }
        return await withTimeout(translators[pair].then((t) => t.translate(text)), 5000);
      } catch (err) {
        delete translators[pair];
        throw err;
      }
    },
  },
];

function withTimeout(promise, ms) {
  let timer;
  const late = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('응답이 너무 늦어요')), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

async function translate(text, from, to) {
  const errors = [];
  for (const engine of ENGINES) {
    try {
      const out = (await engine.run(text, from, to))?.trim();
      if (out) return { text: out, engine: engine.name };
      errors.push(`${engine.name}: 빈 결과`);
    } catch (err) {
      errors.push(`${engine.name}: ${err.message}`);
    }
  }
  throw new Error(errors.join(' · '));
}

let voices = [];
let speaking = null; // 읽는 도중 지워지면 끝 신호가 오지 않는 브라우저가 있어 잡아둔다
let unlocked = false;

if (canSpeak) {
  const loadVoices = () => (voices = speechSynthesis.getVoices());
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

function voiceFor(lang) {
  const norm = (v) => v.lang.toLowerCase().replace(/_/g, '-');
  const want = lang.toLowerCase();
  return voices.find((v) => norm(v) === want) ?? voices.find((v) => norm(v).startsWith(want.split('-')[0]));
}

/** 아이폰은 버튼을 누를 때 한 번 읽어둬야 나중에 저절로 읽을 수 있다 */
function unlockSpeech() {
  if (unlocked || !canSpeak) return;
  unlocked = true;
  const silent = new SpeechSynthesisUtterance(' ');
  silent.volume = 0;
  speechSynthesis.speak(silent);
}

function cancelSpeech() {
  if (canSpeak && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
}

function speak(text, code) {
  return new Promise((resolve) => {
    if (!canSpeak || !text) return resolve();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = LANGS[code].voice;
    const voice = voiceFor(utter.lang);
    if (voice) utter.voice = voice;
    utter.rate = settings.rate;
    let timer;
    const finish = () => {
      clearTimeout(timer);
      if (speaking === utter) speaking = null;
      resolve();
    };
    utter.onend = finish;
    utter.onerror = finish;
    // 끝났다는 신호를 주지 않는 브라우저가 있다. 넉넉히 기다린 뒤 넘어간다
    timer = setTimeout(finish, (4000 + [...text].length * 200) / settings.rate);
    cancelSpeech();
    speaking = utter;
    speechSynthesis.speak(utter);
  });
}

let wakeLock = null;
let wakeAsking = false;

async function keepAwake(on) {
  if (on && settings.keepAwake) {
    if (wakeLock || wakeAsking || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    wakeAsking = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => wakeLock === lock && (wakeLock = null));
      if (phase === 'idle') lock.release(); // 기다리는 사이 멈췄다
      else wakeLock = lock;
    } catch {
    } finally {
      wakeAsking = false;
    }
  } else if (wakeLock) {
    const lock = wakeLock;
    wakeLock = null;
    lock.release().catch(() => {});
  }
}

// ---------- 화면 ----------

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

function render() {
  for (const s of ['a', 'b']) {
    const code = langOf(s);
    const button = $(`mic-${s}`);
    button.querySelector('.mic-lang').textContent = LANGS[code].name;
    button.classList.toggle('on', phase !== 'idle' && side === s);
    button.setAttribute('aria-pressed', String(phase === 'listening' && side === s));
    button.disabled = !Recognition;
    $(`lang-${s}`).value = code;
  }
  $('send-now').disabled = phase !== 'listening';
  $('clear-now').disabled = phase !== 'listening';
  $('stop').disabled = phase === 'idle';
  document.body.dataset.phase = phase;
  renderLive(phase === 'listening' ? findTrigger(spoken(), triggersOf(langOf(side))) : null);
}

function renderLive(hit) {
  const code = langOf(side);
  const status = {
    idle: '멈춤 · 아래에서 말할 사람의 언어를 누르세요',
    listening: `듣는 중 · ${LANGS[code].name}`,
    translating: '번역 중…',
    speaking: '읽어주는 중…',
  };
  $('status').textContent = status[phase];
  const text = $('live-text');
  text.lang = code;
  text.replaceChildren();
  if (phase === 'listening') {
    const words = spoken();
    if (hit) text.append(hit.before, ' ', el('mark', { textContent: hit.word }));
    else text.append(words);
    text.classList.toggle('empty', !words);
  }
  const first = triggersOf(code)[0];
  const hint = $('hint');
  hint.lang = code;
  hint.textContent = phase !== 'listening' ? '' : first ? LANGS[code].hint(first) : '끝말이 없어요. 다 말한 뒤 "지금 번역"을 누르세요.';
}

function renderLog() {
  const list = $('log');
  if (!log.length) return;
  list.replaceChildren(
    ...log.map((entry) => {
      const actions = el('div', { className: 'entry-actions' });
      if (entry.state === 'done') {
        if (canSpeak) actions.append(el('button', { type: 'button', textContent: '다시 듣기', onclick: () => replay(entry) }));
        actions.append(el('span', { className: 'engine', textContent: entry.engine }));
      } else if (entry.state === 'error') {
        actions.append(el('button', { type: 'button', textContent: '다시 번역', onclick: () => retry(entry) }));
      }
      const out =
        entry.state === 'done'
          ? el('p', { className: 'out', lang: entry.to, textContent: entry.out })
          : entry.state === 'error'
            ? el('p', { className: 'out error', textContent: '번역하지 못했어요', title: entry.error })
            : el('p', { className: 'out pending', textContent: '번역 중…' });
      return el(
        'article',
        { className: `entry from-${entry.who}` },
        el('p', { className: 'src', lang: entry.from }, el('span', { className: 'tag', textContent: LANGS[entry.from].name }), entry.src),
        out,
        entry.state === 'error' ? el('p', { className: 'why', textContent: entry.error }) : null,
        actions,
      );
    }),
  );
  list.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

function fillSettings() {
  for (const s of ['a', 'b']) {
    const code = langOf(s);
    $(`trig-${s}-name`).textContent = LANGS[code].name;
    $(`trig-${s}`).value = triggerText(code);
    $(`trig-${s}`).placeholder = LANGS[code].trigger;
    $(`trig-${s}`).lang = code;
  }
  $('opt-speak').checked = settings.speak;
  $('opt-speak').disabled = !canSpeak;
  $('opt-switch').checked = settings.autoSwitch;
  $('opt-awake').checked = settings.keepAwake;
  $('opt-wait').value = settings.wait;
  $('wait-out').textContent = `${settings.wait.toFixed(1)}초`;
  $('opt-rate').value = settings.rate;
  $('rate-out').textContent = `${settings.rate.toFixed(1)}배`;
}

// ---------- 이벤트 ----------

function setup() {
  for (const s of ['a', 'b']) {
    const select = $(`lang-${s}`);
    select.append(...Object.entries(LANGS).map(([code, lang]) => el('option', { value: code, textContent: lang.name })));
    select.addEventListener('change', () => {
      const code = select.value;
      if (code === langOf(other(s))) settings[other(s)] = langOf(s); // 같은 언어를 고르면 서로 바꾼다
      settings[s] = code;
      save();
      fillSettings();
      if (phase === 'listening') listen(side); // 새 언어로 다시 듣는다
      else render();
    });
    $(`mic-${s}`).addEventListener('click', () => {
      unlockSpeech();
      if (phase === 'listening' && side === s) stop();
      else listen(s);
    });
    $(`trig-${s}`).addEventListener('input', (event) => {
      settings.triggers[langOf(s)] = event.target.value;
      save();
      render();
    });
  }
  $('send-now').addEventListener('click', () => {
    if (phase !== 'listening') return;
    const text = spoken();
    send(findTrigger(text, triggersOf(langOf(side)))?.before ?? text);
  });
  $('clear-now').addEventListener('click', () => phase === 'listening' && listen(side));
  $('stop').addEventListener('click', stop);

  const toggles = { 'opt-speak': 'speak', 'opt-switch': 'autoSwitch', 'opt-awake': 'keepAwake' };
  for (const [id, name] of Object.entries(toggles)) {
    $(id).addEventListener('change', (event) => {
      settings[name] = event.target.checked;
      save();
      if (name === 'keepAwake') keepAwake(settings.keepAwake && phase !== 'idle');
    });
  }
  $('opt-wait').addEventListener('input', (event) => {
    settings.wait = Number(event.target.value);
    $('wait-out').textContent = `${settings.wait.toFixed(1)}초`;
    save();
  });
  $('opt-rate').addEventListener('input', (event) => {
    settings.rate = Number(event.target.value);
    $('rate-out').textContent = `${settings.rate.toFixed(1)}배`;
    save();
  });
  $('reset-triggers').addEventListener('click', () => {
    delete settings.triggers[langOf('a')];
    delete settings.triggers[langOf('b')];
    save();
    fillSettings();
    render();
  });
  $('open-settings').addEventListener('click', () => {
    fillSettings();
    $('settings').showModal();
  });

  // 다른 앱으로 가면 브라우저가 마이크를 끊는다. 돌아왔을 때 헷갈리지 않게 멈춰둔다
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && phase !== 'idle') {
      stop();
      notice('화면을 떠나서 멈췄어요. 다시 말하려면 마이크를 누르세요.');
    }
  });

  if (!window.isSecureContext) notice('마이크는 https 주소나 localhost에서만 쓸 수 있어요.');
  else if (!Recognition) notice('이 브라우저는 음성 인식을 지원하지 않아요. 안드로이드와 PC는 Chrome, 아이폰은 Safari로 열어주세요.');

  fillSettings();
  render();
}

setup();
