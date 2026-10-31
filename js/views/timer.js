// 집중 타이머: 포모도로·스톱워치. 시작 시각을 저장해두어 새로고침하거나 다른 화면으로 가도 이어진다.
import { activeAreas, addEntry, areaById } from '../store.js';
import { todayKey } from '../dates.js';
import { esc, fmtHM, sum } from '../util.js';
import { areaColor, entryList, refresh, toast } from '../ui.js';

const KEY = 'growlog:timer';
const PRESETS = [
  { min: 25, label: '25분', rest: 5 },
  { min: 50, label: '50분', rest: 10 },
  { min: 0, label: '스톱워치', rest: 5 },
];
const RING = 2 * Math.PI * 108;

// phase: idle(대기) | running(집중) | paused(일시정지) | break(휴식)
const fresh = () => ({ areaId: null, title: '', preset: 25, phase: 'idle', startedAt: 0, banked: 0, finished: false });

function load() {
  try {
    return { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return fresh();
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* 저장이 막혀도 타이머는 동작 */
  }
}

let t = load();

const ticking = () => t.phase === 'running' || t.phase === 'break';
const elapsed = () => t.banked + (ticking() ? Date.now() - t.startedAt : 0);
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
  if (!audio) return;
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
let wakeWaiting = false; // 요청 중이거나 거부된 상태. 거부됐다면 앱으로 돌아오거나 타이머가 멈출 때까지 다시 묻지 않는다.

async function syncWakeLock() {
  if (!navigator.wakeLock) return;
  if (!ticking()) {
    wakeLock?.release();
    wakeLock = null;
    wakeWaiting = false;
    return;
  }
  if (wakeLock || wakeWaiting || document.hidden) return;
  wakeWaiting = true;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeWaiting = false;
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch {
    /* 저전력 모드 등에서는 거부될 수 있고, 그래도 타이머는 시작 시각 기준으로 정확하다 */
  }
}
document.addEventListener('visibilitychange', () => {
  wakeWaiting = false;
});

// ---- 진행 ----
function paint() {
  syncWakeLock();
  const time = document.querySelector('[data-timer-time]');
  if (time) time.textContent = clock(displayMs());
  const ring = document.querySelector('[data-timer-ring]');
  if (ring) ring.style.strokeDashoffset = String(RING * (1 - progress()));
  document.title = ticking() ? `${clock(displayMs())} · ${t.phase === 'break' ? '휴식' : '집중'} | 그로우로그` : '그로우로그';
}

const idle = (patch = {}) => ({ ...t, phase: 'idle', startedAt: 0, banked: 0, finished: false, ...patch });

function logSession(minutes) {
  addEntry({ date: todayKey(), areaId: t.areaId, minutes, title: t.title, source: 'timer' });
}

function finishFocus() {
  const minutes = t.preset;
  const known = areaById(t.areaId);
  const done = idle({ finished: true });
  chime();
  if (known) logSession(minutes);
  t = done;
  save();
  refresh();
  toast(`${minutes}분 집중 완료! 기록해뒀어요.`);
}

function finishBreak() {
  t = idle();
  save();
  chime();
  refresh();
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
  const minutes = Math.round(elapsed() / 60000);
  const canLog = minutes >= 1 && areaById(t.areaId);
  if (canLog) logSession(minutes);
  t = idle();
  save();
  refresh();
  toast(canLog ? `${fmtHM(minutes)} 기록했어요` : '1분 미만이라 기록하지 않았어요');
}

function act(action, value) {
  switch (action) {
    case 'preset':
      if (t.phase === 'idle') t = idle({ preset: Number(value) });
      break;
    case 'timer-area':
      t.areaId = value;
      break;
    case 'start':
      unlockAudio();
      t = { ...t, phase: 'running', startedAt: Date.now(), banked: 0, finished: false };
      break;
    case 'pause':
      t = { ...t, phase: 'paused', banked: elapsed(), startedAt: 0 };
      break;
    case 'resume':
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
  if (t.phase === 'running') return `${esc(area?.label ?? '')} 집중 중`;
  if (t.phase === 'paused') return '잠시 멈췄어요';
  return t.finished ? '한 세션 끝! 잘했어요' : '집중할 준비 됐나요?';
}
function phaseLabel(area) {
  if (t.phase === 'break') return `휴식 ${preset().rest}분`;
  if (t.phase !== 'idle') return area ? `${esc(area.emoji)} ${esc(area.label)}` : '';
  return t.preset ? `${t.preset}분 집중` : '스톱워치';
}
function actions(area) {
  const button = (action, label, kind = '') => `<button type="button" class="btn ${kind}" data-action="${action}">${label}</button>`;
  if (t.phase === 'running') return button('pause', '일시정지', 'primary') + button('finish', '끝내고 기록') + button('reset', '초기화', 'ghost');
  if (t.phase === 'paused') return button('resume', '계속하기', 'primary') + button('finish', '끝내고 기록') + button('reset', '초기화', 'ghost');
  if (t.phase === 'break') return button('skip-break', '휴식 건너뛰기', 'primary');
  if (t.finished) return button('break', `${preset().rest}분 휴식`, 'primary') + button('start', '바로 다음 세션');
  return area ? button('start', '시작', 'primary') : '<a class="btn" href="#/settings">영역을 먼저 추가해주세요</a>';
}

export function render(state) {
  const areas = activeAreas(state);
  if (!areas.some((a) => a.id === t.areaId)) t.areaId = areas[0]?.id ?? null;
  const area = areaById(t.areaId, state);
  const today = todayKey();
  const sessions = state.entries.filter((e) => e.date === today && e.source === 'timer').sort((a, b) => b.createdAt - a.createdAt);
  const ringColor = t.phase === 'break' ? 'var(--ink-2)' : areaColor(area);
  const presets = PRESETS.map((p) => `<button type="button" class="seg-btn" data-action="preset" data-value="${p.min}" aria-pressed="${t.preset === p.min}" ${t.phase === 'idle' ? '' : 'disabled'}>${p.label}</button>`).join('');
  const chips = areas
    .map((a) => `<button type="button" class="chip" data-action="timer-area" data-id="${esc(a.id)}" aria-pressed="${a.id === t.areaId}"><span class="dot" style="background:${areaColor(a)}"></span>${esc(a.emoji)} ${esc(a.label)}</button>`)
    .join('');
  return `
    <header class="page-head">
      <p class="eyebrow">집중 타이머</p>
      <h1>${heading(area)}</h1>
    </header>
    <section class="card">
      <div class="seg" role="group" aria-label="타이머 종류">${presets}</div>
      <div class="timer-face">
        <svg viewBox="0 0 240 240" aria-hidden="true">
          <circle class="track" cx="120" cy="120" r="108" fill="none" stroke-width="10"/>
          <circle class="prog" data-timer-ring cx="120" cy="120" r="108" fill="none" stroke-width="10" style="stroke:${ringColor};stroke-dasharray:${RING};stroke-dashoffset:${RING * (1 - progress())}"/>
        </svg>
        <div class="timer-center">
          <div class="timer-time" data-timer-time>${clock(displayMs())}</div>
          <div class="timer-phase">${phaseLabel(area)}</div>
        </div>
      </div>
      <div class="timer-actions">${actions(area)}</div>
    </section>
    <section class="card">
      <h2>무엇에 집중하나요?</h2>
      <p class="sub">세션이 끝나면 고른 영역에 자동으로 기록돼요.</p>
      <div class="stack">
        <div class="chips" role="group" aria-label="영역">${chips}</div>
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
    if (button) act(button.dataset.action, button.dataset.value ?? button.dataset.id);
  },
  input(e) {
    if ('timerTitle' in e.target.dataset) {
      t.title = e.target.value;
      save();
    }
  },
};
