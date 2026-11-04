// 집중 타이머: 포모도로·스톱워치. 시작 시각을 저장해두어 새로고침하거나 다른 화면으로 가도 이어진다.
import { activeAreas, addEntry, areaById, canAddArea, getState } from '../store.js';
import { toKey, todayKey } from '../dates.js';
import { esc, fmtHM, isNativeApp, sendToApp, sum } from '../util.js';
import { areaColor, entryList, refresh, savedToast, toast } from '../ui.js';
import { openAreaMaker } from './today.js';

const KEY = 'growlog:timer';
const PRESETS = [
  { min: 25, label: '25분', rest: 5 },
  { min: 50, label: '50분', rest: 10 },
  { min: 0, label: '스톱워치', rest: 5 },
];
const DIAL = 150; // 다이얼의 눈금 수
const MAX_BANKED = 3650 * 864e5; // 저장된 값이 깨졌을 때 날짜 계산이 무너지지 않게 막는 선

// phase: idle(대기) | running(집중) | paused(일시정지) | break(휴식)
const fresh = () => ({ areaId: null, title: '', preset: 25, phase: 'idle', startedAt: 0, banked: 0, finished: false });

// 저장된 값도 화면과 기록에 그대로 쓰이므로 형식이 틀린 값은 버린다
function clean(x) {
  const time = (v, max) => (Number.isFinite(v) && v > 0 && v <= max ? v : 0);
  const phase = ['running', 'paused', 'break'].includes(x.phase) ? x.phase : 'idle';
  const startedAt = time(x.startedAt, Date.now() + 864e5);
  return {
    areaId: typeof x.areaId === 'string' ? x.areaId : null,
    title: typeof x.title === 'string' ? x.title.slice(0, 60) : '',
    preset: PRESETS.some((p) => p.min === x.preset) ? x.preset : fresh().preset,
    phase: (phase === 'running' || phase === 'break') && !startedAt ? 'idle' : phase,
    startedAt,
    banked: time(x.banked, MAX_BANKED),
    finished: x.finished === true,
  };
}

function readStored() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? clean(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const stage = ({ phase, startedAt }) => `${phase}:${startedAt}`;
let saveWorks = true;
let savedStage = ''; // 저장소가 알고 있는 마지막 단계
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
    saveWorks = true;
    savedStage = stage(t);
  } catch {
    saveWorks = false; // 저장이 막혀도 타이머는 동작
  }
}
/** 저장소의 값을 따른다 */
function follow(record) {
  t = record;
  saveWorks = true;
  savedStage = stage(t);
}
// 저장되지 못해 다른 탭은 모르는 단계라면, 저장된 값은 이보다 오래된 것이니 믿지 않는다
const onlyHere = () => !saveWorks && t.phase !== 'idle' && stage(t) !== savedStage;
const storedNow = () => (onlyHere() ? null : readStored());

let t = fresh();
follow(readStored() ?? fresh());

const ticking = () => t.phase === 'running' || t.phase === 'break';
const elapsed = () => t.banked + (ticking() ? Math.max(0, Date.now() - t.startedAt) : 0);
const preset = () => PRESETS.find((p) => p.min === t.preset) || PRESETS[0];
const targetMs = () => (t.phase === 'break' ? preset().rest : t.preset) * 60000; // 0이면 스톱워치
const countsUp = () => targetMs() === 0;

function displayMs() {
  if (t.phase === 'idle') return t.preset * 60000;
  return countsUp() ? elapsed() : Math.max(0, targetMs() - elapsed());
}
function progress() {
  if (t.phase === 'idle') return 0;
  return countsUp() ? (elapsed() % 60000) / 60000 : Math.min(1, elapsed() / targetMs());
}
function clock(ms) {
  const total = countsUp() ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
}

// 눈금 150개를 요소로 두지 않고 선 하나로 그려서, 눈금이 늘어날 때 d만 바꾼다
function spoke(i, inner, outer = 172) {
  const angle = (i / DIAL) * 2 * Math.PI;
  const at = (r) => `${(175 + Math.sin(angle) * r).toFixed(1)} ${(175 - Math.cos(angle) * r).toFixed(1)}`;
  return `M${at(outer)}L${at(inner)}`;
}
const TICKS = Array.from({ length: DIAL }, (_, i) => spoke(i, i % 30 ? 159 : 149)); // 5칸마다 긴 눈금
const litTicks = () => Math.round(progress() * DIAL);
const litPath = () => TICKS.slice(0, litTicks()).join('');
const needlePath = () => (t.phase === 'idle' ? '' : spoke(litTicks(), 142, 174));

// ---- 알림음 ----
let audio = null;
function unlockAudio() {
  // 브라우저는 사용자가 누른 뒤에만 소리를 허용하므로 시작 버튼에서 준비해둔다
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
  } catch {
    audio = null;
  }
}
function chime() {
  navigator.vibrate?.([180, 80, 180]);
  sendToApp({ buzz: true }); // 아이폰은 무음 모드면 소리가 안 나니 진동으로도 알린다
  if (!audio) return;
  audio.resume();
  const now = audio.currentTime;
  [0, 0.22, 0.44].forEach((delay, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = i === 2 ? 880 : 660;
    gain.gain.setValueAtTime(0.0001, now + delay);
    gain.gain.exponentialRampToValueAtTime(0.18, now + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.18);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + delay);
    osc.stop(now + delay + 0.2);
  });
}

// ---- 화면 꺼짐 방지 ----
// 폰 화면이 꺼지면 앱이 멈춰 알림음을 낼 수 없다. 시간이 도는 동안에는 화면을 켜둔다.
// 앱을 벗어나면 브라우저가 풀어버리므로, 돌아왔을 때 다음 틱에서 다시 잡는다.
let wakeLock = null;
let wakePending = false; // 요청은 한 번에 하나만. 겹치면 놓지 못하는 잠금이 남는다.
let wakeRefused = false; // 거부됐다면 사용자가 다시 누르거나 앱으로 돌아올 때까지 묻지 않는다
let appAwake = null; // 아이폰 앱에 화면을 켜두라고 말해둔 상태. 페이지를 다시 열면 모르니 처음 한 번은 꼭 알린다.

async function syncWakeLock() {
  if (isNativeApp()) {
    if (appAwake !== ticking()) sendToApp({ keepAwake: (appAwake = ticking()) });
    return;
  }
  if (!navigator.wakeLock) return;
  if (!ticking()) {
    wakeLock?.release();
    wakeLock = null;
    wakeRefused = false;
    return;
  }
  if (wakeLock || wakePending || wakeRefused || document.hidden) return;
  wakePending = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!ticking()) {
      lock.release(); // 기다리는 사이에 세션이 끝났다
      return;
    }
    wakeLock = lock;
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch {
    wakeRefused = true; // 저전력 모드 등에서는 거부될 수 있고, 그래도 타이머는 시작 시각 기준으로 정확하다
  } finally {
    wakePending = false;
  }
}
document.addEventListener('visibilitychange', () => {
  wakeRefused = false;
});

// 새로고침한 뒤에는 화면을 한 번 눌러야 브라우저가 소리와 화면 유지를 허용한다
document.addEventListener('click', () => {
  if (!ticking()) return;
  unlockAudio();
  wakeRefused = false;
  syncWakeLock();
});

// ---- 진행 ----
const isLongClock = (text) => text.length > 7; // 스톱워치가 10시간을 넘긴 경우

function paint() {
  syncWakeLock();
  const time = document.querySelector('[data-timer-time]');
  if (time) {
    time.textContent = clock(displayMs());
    time.classList.toggle('long', isLongClock(time.textContent));
  }
  const lit = document.querySelector('[data-dial-lit]');
  if (lit && lit.dataset.count !== String(litTicks())) {
    lit.dataset.count = litTicks();
    lit.setAttribute('d', litPath());
    document.querySelector('[data-dial-needle]').setAttribute('d', needlePath());
  }
  document.title =ticking() ? `${clock(displayMs())} · ${t.phase === 'break' ? '휴식' : '집중'} | 그로우로그` : '그로우로그';
}

const idle = (patch = {}) => ({ ...t, phase: 'idle', startedAt: 0, banked: 0, finished: false, ...patch });

const restMs = (session) => (PRESETS.find((p) => p.min === session.preset) ?? PRESETS[0]).rest * 60000;

/** 뒤에 숨은 탭이 먼저 끝내면 소리가 나지 않으니, 보고 있는 화면에서 대신 알린다 */
function announce(before) {
  if (document.hidden || t.phase !== 'idle') return;
  if (before.phase === 'running' && t.finished) {
    chime();
    if (areaById(before.areaId)) savedToast(`${before.preset}분 집중 완료! 기록해뒀어요.`);
    else toast('영역이 사라져서 이 세션은 기록하지 못했어요');
  } else if (before.phase === 'break' && Date.now() - before.startedAt >= restMs(before)) {
    chime();
    toast('휴식 끝! 다음 세션을 시작해볼까요?');
  }
}

function finishFocus() {
  // 다른 탭이나 앱이 먼저 끝냈거나 멈췄다면 다시 기록하지 않는다
  const stored = storedNow();
  if (stored && (stored.phase !== 'running' || stored.startedAt !== t.startedAt)) {
    const before = t;
    follow(stored);
    announce(before);
    refresh({ background: true });
    return;
  }
  const { areaId, title, preset: minutes } = t;
  // 앱을 나중에 열어도 세션이 실제로 끝난 날짜로 기록한다
  const endedAt = t.startedAt + minutes * 60000 - t.banked;
  // 화면을 그리다 오류가 나도 같은 세션을 또 기록하지 않도록 상태부터 저장한다
  t = idle({ finished: true });
  save();
  chime();
  if (areaById(areaId)) {
    addEntry({ date: toKey(new Date(endedAt)), areaId, minutes, title, source: 'timer', createdAt: endedAt }, { background: true });
    savedToast(`${minutes}분 집중 완료! 기록해뒀어요.`);
  } else {
    refresh({ background: true });
    toast('영역이 사라져서 이 세션은 기록하지 못했어요');
  }
}

function finishBreak() {
  t = idle();
  save();
  chime();
  refresh({ background: true });
  toast('휴식 끝! 다음 세션을 시작해볼까요?');
}

function tick() {
  if (t.phase === 'running' && t.preset && elapsed() >= t.preset * 60000) finishFocus();
  else if (t.phase === 'break' && elapsed() >= preset().rest * 60000) finishBreak();
  paint();
}

let ticker = null;
export function startTicker() {
  if (ticker) return;
  ticker = setInterval(tick, 500);
  tick();
}

function stopAndLog() {
  const stored = storedNow();
  if (stored?.phase === 'idle') {
    follow(stored);
    refresh();
    return;
  }
  const spent = Math.round(elapsed() / 60000);
  const minutes = Math.min(1440, spent); // 하루 기록 한도
  const { areaId, title } = t;
  const known = areaById(areaId);
  t = idle();
  save();
  if (minutes >= 1 && known) addEntry({ date: todayKey(), areaId, minutes, title, source: 'timer' });
  else refresh();
  if (!known) toast('영역이 사라져서 이 세션은 기록하지 못했어요');
  else if (minutes < 1) toast('1분 미만이라 기록하지 않았어요');
  else savedToast(spent > minutes ? '하루 최대인 24시간까지만 기록했어요' : `${fmtHM(minutes)} 기록했어요`);
}

/** 설정의 '모두 지우기'에서 진행 중인 세션까지 함께 비운다 */
export function resetTimer() {
  t = fresh();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 저장소를 못 써도 메모리 상태는 비워졌다 */
  }
}

// 다른 탭이나 앱에서 멈추거나 끝낸 것을 이쪽에도 반영한다
addEventListener('storage', (e) => {
  if (e.key !== KEY && e.key !== null) return;
  if (onlyHere() && e.newValue !== null) return;
  const before = t;
  follow(readStored() ?? fresh());
  announce(before);
  // 모두 지우기를 했는데 입력 중이던 칸에 글자가 남으면 다음 입력 때 다시 저장된다
  if (e.newValue === null) {
    const input = document.querySelector('[data-timer-title]');
    if (input) input.value = '';
  }
  if (location.hash === '#/timer') refresh({ background: true });
  paint();
});

/** 진행 중인 세션의 영역은 바꾸지 않는다. 숨긴 영역이어도 끝나면 그 영역에 기록된다. */
function pickArea(state) {
  const areas = activeAreas(state);
  if (t.phase === 'idle' && !areas.some((a) => a.id === t.areaId)) t.areaId = areas[0]?.id ?? null;
}

// 입력 중에는 화면을 나중에 그리므로, 이미 지나간 단계의 버튼이 눌릴 수 있다
const ALLOWED = {
  preset: ['idle'],
  start: ['idle'],
  break: ['idle'],
  pause: ['running'],
  resume: ['paused'],
  finish: ['running', 'paused'],
  reset: ['running', 'paused'],
  'skip-break': ['break'],
};

function act(action, value) {
  if (ALLOWED[action] && !ALLOWED[action].includes(t.phase)) {
    refresh();
    return;
  }
  switch (action) {
    case 'preset':
      t = idle({ preset: Number(value) });
      break;
    case 'timer-area':
      if (activeAreas(getState()).some((a) => a.id === value)) t.areaId = value; // 다른 탭에서 지운 영역의 칩이 남아 있을 수 있다
      break;
    case 'start':
      pickArea(getState());
      if (!t.areaId) {
        refresh();
        return;
      }
      unlockAudio();
      t = { ...t, phase: 'running', startedAt: Date.now(), banked: 0, finished: false };
      break;
    case 'pause':
      t = { ...t, phase: 'paused', banked: elapsed(), startedAt: 0 };
      break;
    case 'resume':
      unlockAudio();
      t = { ...t, phase: 'running', startedAt: Date.now() };
      break;
    case 'finish':
      stopAndLog();
      return;
    case 'reset':
    case 'skip-break':
      t = idle();
      break;
    case 'break':
      unlockAudio();
      t = { ...t, phase: 'break', startedAt: Date.now(), banked: 0, finished: false };
      break;
    default:
      return;
  }
  save();
  refresh();
  paint();
}

// ---- 화면 ----
function heading(area) {
  if (t.phase === 'break') return '잠깐 쉬어가요';
  if (t.phase === 'running') return t.title.trim() || `${area?.label ?? ''} 집중 중`;
  if (t.phase === 'paused') return '잠시 멈췄어요';
  return t.finished ? '한 세션 끝! 잘했어요' : '집중할 준비 됐나요?';
}
function phaseLabel() {
  if (t.phase === 'break') return `휴식 ${preset().rest}분`;
  if (t.phase !== 'idle') return t.preset ? `${t.preset}분 세션` : '스톱워치';
  return t.preset ? `${t.preset}분 집중` : '스톱워치';
}

const ICONS = {
  finish: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  resume: '<path d="M8 5.5l10 6.5-10 6.5z"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 4.5v4h4"/>',
  rest: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

function actions(area, sessions) {
  const tile = (action, label, kind, name) => `<button type="button" class="act ${kind}" data-action="${action}"><span class="act-icon">${icon(name)}</span>${label}</button>`;
  const wide = (action, label) => `<button type="button" class="act primary wide" data-action="${action}">${label}</button>`;
  const rest = `<div class="act low"><span>오늘의 집중</span><b>${sessions.length}회 · ${fmtHM(sum(sessions, (e) => e.minutes))}</b></div>
    <button type="button" class="act quiet" data-action="reset">${icon('reset')}초기화</button>`;
  if (t.phase === 'running') return tile('finish', '끝내고 기록', 'primary', 'finish') + tile('pause', '일시정지', '', 'pause') + rest;
  if (t.phase === 'paused') return tile('resume', '계속하기', 'primary', 'resume') + tile('finish', '끝내고 기록', '', 'finish') + rest;
  if (t.phase === 'break') return wide('skip-break', '휴식 건너뛰기');
  if (t.finished) return area ? tile('break', `${preset().rest}분 휴식`, 'primary', 'rest') + tile('start', '다음 세션', '', 'resume') : wide('break', `${preset().rest}분 휴식`);
  if (area) return wide('start', '시작');
  // 숨긴 영역도 자리를 차지하므로, 자리가 없으면 설정에서 되살리게 한다
  return canAddArea() ? wide('make-area', '영역을 먼저 만들어주세요') : '<a class="act wide" href="#/settings">숨긴 영역을 되살려주세요</a>';
}

export function label(state) {
  const area = areaById(t.areaId, state);
  if (t.phase === 'running') return `${area?.label ?? ''} 집중 중`;
  if (t.phase === 'paused') return `${area?.label ?? ''} 일시정지`;
  return t.phase === 'break' ? '휴식 중' : '집중 타이머';
}
export const live = () => t.phase === 'running';

export function render(state) {
  const areas = activeAreas(state);
  pickArea(state);
  const area = areaById(t.areaId, state);
  const today = todayKey();
  const sessions = state.entries.filter((e) => e.date === today && e.source === 'timer').sort((a, b) => b.createdAt - a.createdAt);
  const presets = PRESETS.map((p) => `<button type="button" class="seg-btn" data-action="preset" data-value="${p.min}" aria-pressed="${t.preset === p.min}">${p.label}</button>`).join('');
  const time = clock(displayMs());
  const chips = areas
    .map((a) => `<button type="button" class="chip" data-action="timer-area" data-id="${esc(a.id)}" aria-pressed="${a.id === t.areaId}"><span class="dot" style="background:${areaColor(a)}"></span>${esc(a.label)}</button>`)
    .join('');
  return `
    <h1 class="timer-title" data-timer-heading>${esc(heading(area))}</h1>
    <div class="timer-presets">${t.phase === 'idle' ? `<div class="seg" role="group" aria-label="타이머 종류">${presets}</div>` : ''}</div>
    <div class="dial${t.phase === 'break' ? ' resting' : ''}">
      <svg viewBox="0 0 350 350" aria-hidden="true">
        <path class="ticks-off" d="${TICKS.join('')}"/>
        <path class="ticks-on" data-dial-lit data-count="${litTicks()}" d="${litPath()}"/>
        <path class="needle" data-dial-needle d="${needlePath()}"/>
      </svg>
      <div class="dial-core">
        <div class="timer-time${isLongClock(time) ? ' long' : ''}" data-timer-time>${time}</div>
        <div class="timer-phase">${phaseLabel()}</div>
      </div>
    </div>
    <div class="timer-actions">${actions(area, sessions)}</div>
    <p class="hint timer-note">화면이 꺼지거나 다른 앱으로 가면 알림음이 울리지 않아요. 시간은 그대로 기록돼요.</p>
    <section class="card">
      <h2>무엇에 집중하나요?</h2>
      <p class="sub">세션이 끝나면 고른 영역에 자동으로 기록돼요.</p>
      <div class="stack">
        ${areas.length ? `<div class="chips" role="group" aria-label="영역">${chips}</div>` : '<p class="sub flush">영역이 있어야 타이머를 시작하고 기록할 수 있어요.</p>'}
        <label class="field"><span>할 일</span><input data-timer-title maxlength="60" value="${esc(t.title)}" placeholder="예: 알고리즘 문제 2개"></label>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>오늘의 집중</h2><span class="hint">${sessions.length}회 · ${fmtHM(sum(sessions, (e) => e.minutes))}</span></div>
      ${sessions.length ? entryList(sessions, state) : '<p class="empty">아직 집중 세션이 없어요.</p>'}
    </section>`;
}

export const on = {
  click(e) {
    const button = e.target.closest('[data-action]');
    if (button?.dataset.action === 'make-area') {
      openAreaMaker();
      location.hash = '#/today';
    } else if (button) act(button.dataset.action, button.dataset.value ?? button.dataset.id);
  },
  input(e) {
    if ('timerTitle' in e.target.dataset) {
      t.title = e.target.value;
      save();
      document.querySelector('[data-timer-heading]').textContent = heading(areaById(t.areaId));
    }
  },
};
