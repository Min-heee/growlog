// 오늘 화면: 하루에 남길 것을 카드 한 장씩 옆으로 넘겨 본다. 컨디션 · 수면 · 계획(plan-card.js) · 활동 기록 · 마무리(메모, 이번 주 목표)
// 카드는 지금 보는 한 장만 그린다. 남긴 카드도 접지 않고 늘 펼쳐 두어, 다시 넘겨 오면 바로 고칠 수 있다.
import { activeAreas, addArea, addEntry, areaById, canAddArea, freeColors, getState, lastFeel, MAX_AREAS, resetState, setCheckin, setSleep, setSupportSeen, updateEntry } from '../store.js';
import { addDays, fmtDay, fmtLong, rangeKeys, sleepHours, todayKey, weekStartKey } from '../dates.js';
import { BANDS, bandWord, insight } from '../insight.js';
import { isIOS, isStandalone } from '../pwa.js';
import { openMarkForm } from './recovery.js';
import { avg, esc, fmtHM, fmtHours, sum } from '../util.js';
import { areaColor, ask, CHEV, colorChoices, entryItem, fader, feelChoices, fieldSavedToast, ratingScale, refresh, savedToast, smooth, tickBar, toast } from '../ui.js';
import { byKeyboard, closePlanPanel, planCard, resetPlanDrafts } from '../plan-card.js';
import { plansOn, progress } from '../plans.js';

const SCALES = [
  { field: 'energy', label: '에너지', low: '바닥', high: '넘침' },
  { field: 'stress', label: '스트레스', low: '평온', high: '극심' },
  { field: 'mood', label: '기분', low: '가라앉음', high: '최고' },
];
const DETACH_SCALE = { field: 'detach', label: '할 일 생각에서 벗어남', low: '계속 붙잡힘', high: '완전히 벗어남' };
const SLEEP_SCALE = { field: 'quality', label: '수면의 질', low: '뒤척임', high: '개운함' };
const CATCH_UP = [
  [0, '오늘'],
  [1, '어제'],
  [2, '그제'],
  [3, '3일 전'],
];
const ASK = ['오늘 컨디션은 어때요', '어제는 어땠나요', '그제는 어땠나요', '3일 전은 어땠나요']; // 고른 날마다 컨디션 카드의 제목
const CLOSE = ['오늘을 마무리해요', '어제를 마무리해요', '그제를 마무리해요', '3일 전을 마무리해요'];
const QUICK_MINUTES = [10, 30, 60];
const PLACEHOLDER = { exercise: '러닝 5km', study: '영어 단어 50개', dev: '로그인 기능 구현' };
const KINDS = [
  ['load', '해야 하는 일'],
  ['varies', '그때그때 달라요'],
];
const KIND_NOTES = {
  load: '공부, 일처럼 기록한 시간만큼 에너지를 쓴 것으로 쳐요.',
  varies: '운동, 게임, 취미처럼 기록할 때마다 끝나고 어땠는지 골라요.',
};
const LIST_FIRST = 3; // 오늘 한 일은 이만큼만 먼저 보여준다

// 입력 중인 내용은 화면을 다시 그려도 남아 있어야 한다
// feel: { areaId, value }. 고른 영역이 어떤 길로 바뀌어도 다른 영역의 값이 넘어가지 않게 영역과 함께 둔다. 없으면 그 영역에서 지난번에 고른 값
let draft = { areaId: null, minutes: '', title: '', date: '', feel: null };
const NEW_AREA = { open: false, label: '', color: null, kind: 'load' };
let maker = { ...NEW_AREA }; // 활동 기록 칸에서 새 영역을 만드는 중인 내용
let savedAt = 0; // 저장 직후 한 번 더 눌려도 오류 안내로 덮지 않는다
// 자정을 넘겨 화면을 켜둔 채 입력해도 화면에 보이는 날짜로 저장되도록 그릴 때의 날짜를 쓴다
let shownDay = todayKey();
const OLDEST_DAYS = 29; // 통계에서 볼 수 있는 가장 오래된 날
let daysBack = 0; // 밀린 날을 채우는 중이면 며칠 전인지
// 펼친 칸. 오늘 한 일은 처음에 몇 개만 보여준다
let expanded = { list: false };
// 카드. 지금 보는 한 장만 그린다
const CARDS = [
  { key: 'checkin', name: '컨디션' },
  { key: 'sleep', name: '수면' },
  { key: 'plan', name: '계획' },
  { key: 'entry', name: '활동', next: '활동 기록' },
  { key: 'close', name: '마무리' },
];
let slide = null; // 보고 있는 카드 번호. null이면 다음에 그릴 때 아직 안 남긴 첫 카드로 정한다
let entering = 0; // 방금 넘긴 방향(1 오른쪽 카드로, -1 왼쪽 카드로). 새 카드가 그쪽에서 들어온다
let entryEdit = null; // 고치는 중인 활동 기록 { id, minutes, title, feel }
const HINT_KEY = 'growlog:deck-hint'; // 넘길 수 있다는 안내를 본 적이 있는지. 지워져도 안내가 한 번 더 뜰 뿐이다
let hintSeen = (() => {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return true;
  }
})();
const LONG_WORD = 13; // 이보다 긴 말은 큰 글씨로 쓰면 네 줄을 넘는다
const FIT_WORD = 11; // 이보다 긴 말은 한 단계 작게 써야 한 줄에 들어간다
const SHORT_WORD = 4; // 이 안의 말은 가장 큰 글씨로 써도 한 줄에 들어간다

const pickedDay = () => addDays(shownDay, -daysBack);
let dayKeyAt = 0; // 날 고르기를 키보드로 다룬 때
const KEYED_DAY = 10000; // 키를 누른 뒤 이 안에 날이 바뀌면 키보드로 고른 것으로 본다. 펼친 목록에서 고르는 시간까지 넉넉히 둔다
const checkinDone = (c) => SCALES.every((s) => c?.[s.field] != null);
const sleepDone = (night) => sleepHours(night?.bed, night?.wake) != null;

/** 펼친 칸과 고치던 칸을 처음 상태로 돌린다. 날이 바뀌거나 기록을 지웠을 때 쓴다. */
export function resetFolds() {
  expanded = { list: false };
  entryEdit = null;
}

/**
 * 오늘 탭에 들어올 때마다 오늘로 돌아온다. 보던 카드는 그대로 둔다(다른 탭에 잠깐 다녀와도 같은 카드).
 * 오래 떠나 있다 돌아오면(long) 아직 안 남긴 첫 카드부터 다시 보여준다.
 */
export function enter({ long = false } = {}) {
  daysBack = 0;
  resetFolds();
  closePlanPanel();
  if (long && !makerWanted) slide = null;
}

/** 처음 보여줄 카드: 컨디션을 안 남겼으면 컨디션, 수면을 안 남겼으면 수면, 아니면 오늘 계획 */
function decideSlide(state, day) {
  if (slide !== null) return;
  slide = !checkinDone(state.checkins[day]) ? 0 : !sleepDone(state.sleep[day]) ? 1 : 2;
}

let makerWanted = false; // 다른 화면에서 영역을 만들러 왔다
// 달력에서 그날 기록을 고치러 왔다: { day, keyboard }. 며칠 전인지는 오늘 탭을 그리는 순간에 센다(그사이 자정을 넘겨도 고른 날이 열린다)
let dayWanted = null;
let focusDay = false; // 키보드로 왔다면 도착한 뒤 그날 컨디션 제목으로 포커스를 옮긴다

/** 달력에서 그날 기록을 고치러 온다. 컨디션 카드에서 그날을 골라 둔다 */
export function openDay(day, { keyboard = false } = {}) {
  dayWanted = { day, keyboard };
}

/** 다른 화면에서 오늘로 넘어오며 영역 만들기 칸을 열어둔다 */
export function openAreaMaker() {
  maker.open = true;
  makerWanted = true;
  slide = 3; // 활동 기록 카드
}

export function arrive() {
  if (focusDay) {
    focusDay = false;
    document.getElementById('checkin-head')?.focus({ preventScroll: true });
  }
  if (!makerWanted) return;
  makerWanted = false;
  const input = document.querySelector('[data-maker="label"]');
  input?.scrollIntoView({ block: 'center' });
  input?.focus({ preventScroll: true });
}

/** 기록을 지우거나 바꿔 끼웠을 때, 만들다 만 영역도 함께 비운다 */
export function resetTodayDrafts() {
  resetFolds();
  maker = { ...NEW_AREA };
  resetPlanDrafts();
}

function loadHero(state, i) {
  if (state.profile.hide) return '<div class="hero today"><h1 class="hero-word xl">오늘</h1></div>';
  const [word, note] = {
    empty: i.savedDays ? ['컨디션 기록이 아직 없어요', `기록 ${i.savedDays}일은 저장돼 있어요. 컨디션을 두 가지 이상 남기면 비교할 수 있어요.`] : ['기록을 시작해볼까요', '컨디션을 남기면 내 평소를 알아가기 시작해요.'],
    building: [BANDS.building, `기록 ${i.entries}${i.entries < 7 ? '/7' : '일'}. 쌓일수록 내 기준에 가까워져요.`],
    unknown: ['최근 컨디션 기록이 없어서 지금은 알 수 없어요', '컨디션 카드에서 날짜를 골라 3일 전까지 채울 수 있어요.'],
    restart: ['다시 시작해요', '쌓인 부하를 처음부터 다시 쌓아요.'],
    noUsual: [BANDS.building, '아직 비교할 평소가 없어요. 기록은 그대로 쌓이고 있어요.'],
    trend: [i.band ? bandWord(i) : '', `14일 중 <b>힘든 날 ${i.recent.hard}일</b>`],
  }[i.status];
  const days = i.recent.days.map((hard) => `<i${hard ? ' class="lit"' : hard === null ? ' class="none"' : ''}></i>`).join('');
  const size = word.length > LONG_WORD ? ' long' : word.length > FIT_WORD ? ' fit' : word.length <= SHORT_WORD ? ' xl' : '';
  return `<a class="hero today" href="#/recovery">
    <h1 class="hero-word${size}">${esc(word)}</h1>
    <div class="hero-meta">
      ${i.recent.logged ? `<div class="ticks" role="img" aria-label="최근 14일 중 힘든 날 ${i.recent.hard}일">${days}</div>` : ''}
      <p class="hero-note">${note}</p>
    </div>
  </a>`;
}

/** 안내 띠는 언제나 한 덩어리 안에 둔다. 띠가 생기고 사라져도 맨 위 덩어리 수가 그대로여야 입력 중에 나머지를 다시 그릴 수 있다. */
function notices(state, i) {
  const support = i.support
    ? `<div class="banner"><span>${esc(i.support.text)}</span><div class="banner-actions"><a class="btn small" href="#/help">도움받을 곳</a><button type="button" class="btn small ghost" data-action="support-close">닫기</button></div></div>`
    : '';
  const sample = state.sample ? '<div class="banner"><span>샘플 데이터로 둘러보는 중이에요.</span><button type="button" class="btn small" data-action="clear-sample">지우고 시작하기</button></div>' : '';
  const safari = isIOS() && !isStandalone() ? '<div class="banner"><span>Safari에만 둔 기록은 일주일쯤 열지 않으면 지워질 수 있어요.</span><a class="btn small" href="#/settings">홈 화면에 추가</a></div>' : '';
  return `<div class="notices">${support}${sample}${safari}</div>`; // 띠가 없으면 :empty로 숨도록 사이에 공백을 두지 않는다
}

const duration = (night) => {
  const hours = sleepHours(night.bed, night.wake);
  if (hours == null) return '';
  const total = Math.round(hours * 60);
  return `<b class="stat-val">${Math.floor(total / 60)}<small>시간</small>${total % 60 ? ` ${total % 60}<small>분</small>` : ''}</b>`;
};

function dayPill(day) {
  const options = CATCH_UP.map(([back, label]) => `<option value="${back}"${back === daysBack ? ' selected' : ''}>${label}</option>`).join('');
  // 보이는 글자는 고른 날. 누르면 그 위에 투명하게 덮인 select가 열린다. 16px보다 작으면 iOS가 확대한다.
  return `<label class="day-pill"><span aria-hidden="true">${CATCH_UP[daysBack][1]}</span>${CHEV}<select data-day aria-label="어느 날을 남길까요">${options}</select></label>`;
}

/** 다음 카드로 가는 버튼. 저절로 넘기지 않고 사람이 넘긴다 */
function nextButton(i) {
  const next = CARDS[i + 1];
  return next ? `<button type="button" class="btn block deck-next" data-action="deck-next" data-value="${i + 1}">다음 · ${next.next ?? next.name}<span aria-hidden="true"> ›</span></button>` : '';
}

/** 컨디션 카드. 지난날을 채우는 중이면 테두리로 알린다(컨디션·수면·마무리 카드가 고른 날을 따른다) */
function checkinCard(state, day) {
  const c = state.checkins[day] || {};
  return `<section class="card daily${daysBack ? ' past' : ''}" id="checkin-part">
    <div class="part-head">
      <h2 id="checkin-head" tabindex="-1">${ASK[daysBack]}</h2>
      ${dayPill(day)}
    </div>
    <div class="faders">${SCALES.map((s) => fader(s, c[s.field], 'checkin')).join('')}</div>
    <div class="more-line"><button type="button" class="btn small outline" data-action="mark-day">지친 날로 표시</button></div>
  </section>`;
}

/** 수면 카드의 잔 시간. 시간을 고치는 동안에는 이 부분만 바꿔 끼운다. */
const sleepHead = (state, day) => duration(state.sleep[day] || {}) || '<b class="stat-val none">–</b>';

function sleepCard(state, day) {
  const night = state.sleep[day] || {};
  return `<section class="card daily${daysBack ? ' past' : ''}" id="sleep-part">
    <div class="part-head"><h2 id="sleep-head" tabindex="-1">${daysBack ? `${fmtDay(day)} 수면` : '어젯밤 수면'}</h2>${dayPill(day)}</div>
    <div class="sleep-total" data-slot="sleep">${sleepHead(state, day)}</div>
    <div class="stack" id="sleep-form">
      <div class="row">
        <label class="field grow"><span>잠든 시간</span><input type="time" data-sleep="bed" value="${esc(night.bed || '')}"></label>
        <label class="field grow"><span>일어난 시간</span><input type="time" data-sleep="wake" value="${esc(night.wake || '')}"></label>
      </div>
      ${ratingScale(SLEEP_SCALE, night.quality, 'sleep')}
    </div>
  </section>`;
}

/** 마무리 카드. 하루를 한 줄로 남기고, 할 일 생각에서 벗어났는지, 이번 주 목표를 본다 */
function closeCard(state, day, areas, today) {
  const c = state.checkins[day] || {};
  return `<section class="card daily${daysBack ? ' past' : ''}" id="close-part">
    <div class="part-head"><h2 id="close-head" tabindex="-1">${CLOSE[daysBack]}</h2>${dayPill(day)}</div>
    <div class="stack">
      <label class="field"><span>오늘을 한 줄로</span><input type="text" data-note maxlength="120" value="${esc(c.note || '')}" placeholder="오늘을 짧게 남겨보세요"></label>
      ${ratingScale(DETACH_SCALE, c.detach, 'checkin')}
    </div>
  </section>
  <div data-slot="week">${weekCard(state, areas, today)}</div>`;
}

function areaMaker(state, areas) {
  const free = freeColors(state);
  const color = free.includes(maker.color) ? maker.color : free[0];
  const kinds = KINDS.map(([value, label]) => `<button type="button" class="seg-btn" data-action="maker-kind" data-value="${value}" aria-pressed="${maker.kind === value}">${label}</button>`).join('');
  return `<div class="maker stack" id="area-maker">
    <label class="field"><span>이름</span><input data-maker="label" maxlength="12" value="${esc(maker.label)}" placeholder="예: 독서, 러닝, 영어" enterkeyhint="done"></label>
    <div><div class="scale-head"><span class="scale-label">동그라미 색</span></div>${colorChoices(color, free, 'maker-color')}</div>
    <div><div class="scale-head"><span class="scale-label">이 활동은</span><span class="scale-hint">쌓인 부하 계산에 쓰여요</span></div><div class="seg" role="group" aria-label="이 활동은">${kinds}</div><p class="hint kind-note">${KIND_NOTES[maker.kind]}</p></div>
    <div class="btn-row">${areas.length ? '<button type="button" class="btn small" data-action="maker-close">취소</button>' : ''}<button type="button" class="btn small primary" data-action="maker-save">만들기</button></div>
  </div>`;
}

function entryCard(state, areas, today) {
  const chips = areas
    .map((a) => `<button type="button" class="chip" data-action="pick-area" data-id="${esc(a.id)}" aria-pressed="${a.id === draft.areaId}"><span class="dot" style="background:${areaColor(a)}"></span>${esc(a.label)}</button>`)
    .join('');
  // 영역이 없거나 쓰던 이름이 있으면 열어둔다. 다른 탭에서 영역이 생겨도 쓰던 이름이 사라지지 않는다.
  const open = canAddArea(state) && (maker.open || !areas.length || maker.label.trim() !== '');
  // 칩 줄 끝에 두면 좁은 화면에서 혼자 다음 줄로 떨어지므로 카드 머리에 둔다
  const add = areas.length && canAddArea(state) ? `<button type="button" class="btn small outline" data-action="maker-open" aria-expanded="${open}"${open ? ' aria-controls="area-maker"' : ''}>+ 새 영역</button>` : '';
  const quick = QUICK_MINUTES.map((m) => `<button type="button" class="chip quick" data-action="quick" data-value="${m}" aria-label="${m}분 더하기">+${m}</button>`).join('');
  const picked = areas.find((a) => a.id === draft.areaId);
  // 버튼마다 영역을 붙여, 다시 그리지 못한 칸이 남아 있어도 다른 영역의 값으로 저장되지 않게 한다
  const feel = picked?.kind === 'varies' ? feelChoices(draft.feel?.areaId === picked.id ? draft.feel.value : lastFeel(picked.id, state), 'feel', picked.id) : '';
  // 숨긴 영역도 자리를 차지하므로, 모두 숨겨 자리가 없으면 설정에서 되살리거나 지우게 한다
  const full = `<p class="sub flush">영역은 ${MAX_AREAS}개까지 만들 수 있어요. 설정의 숨긴 영역에서 되살리거나 지워주세요.</p><a class="btn" href="#/settings">설정으로 가기</a>`;
  const example = (Object.hasOwn(PLACEHOLDER, draft.areaId ?? '') && PLACEHOLDER[draft.areaId]) || '';
  const form = `<form class="stack" data-form="entry" novalidate>
      <input name="title" data-draft="title" maxlength="60" value="${esc(draft.title)}" placeholder="${esc(example ? `한 일 (선택) · ${example}` : '한 일 (선택)')}" aria-label="한 일">
      <div class="mins-row">
        <label class="suffix-in"><input name="minutes" data-draft="minutes" type="number" inputmode="numeric" min="1" max="1440" value="${esc(draft.minutes)}" placeholder="30" aria-label="시간(분)"><span aria-hidden="true">분</span></label>
        ${quick}
      </div>
      ${feel}
      <div class="submit-row">
        <input name="date" data-draft="date" type="date" min="${addDays(today, -OLDEST_DAYS)}" max="${today}" value="${esc(draft.date || today)}" aria-label="날짜">
        <button class="btn primary" type="submit">기록하기</button>
      </div>
    </form>`;
  return `<section class="card" data-card="entry">
    <div class="card-head"><h2>활동 기록</h2>${add}</div>
    ${areas.length ? '' : '<p class="sub">무엇을 기록할지 먼저 만들어요. 이름과 동그라미 색을 골라주세요.</p>'}
    <div class="stack">
      ${areas.length ? `<div class="chips" role="group" aria-label="영역">${chips}</div>` : ''}
      ${open ? areaMaker(state, areas) : !areas.length ? full : ''}
      ${areas.length ? form : ''}
    </div>
  </section>`;
}

function goalRow({ name, color, done, goal, ratio }) {
  const met = goal && ratio >= 1;
  return `<div class="goal">
    <div class="goal-head">
      <span class="goal-name"><span class="dot" style="background:${color}"></span>${name}</span>
      <span class="goal-val"><strong>${done}</strong>${met ? ' <span class="met">✓ 달성</span>' : goal ? ` / ${goal}` : ''}</span>
    </div>
    ${tickBar(ratio)}
  </div>`;
}

function weekCard(state, areas, today) {
  const start = weekStartKey(today);
  const days = rangeKeys(today, 7).filter((k) => k >= start);
  const week = state.entries.filter((e) => e.date >= start && e.date <= today);
  const rows = areas.map((a) => {
    const done = sum(week.filter((e) => e.areaId === a.id), (e) => e.minutes);
    return goalRow({
      name: esc(a.label),
      color: areaColor(a),
      done: fmtHM(done),
      goal: a.goal ? fmtHM(a.goal) : null,
      ratio: a.goal ? done / a.goal : 0,
    });
  });
  const sleepAvg = avg(days.map((k) => state.sleep[k]).filter(Boolean).map((n) => sleepHours(n.bed, n.wake)).filter((h) => h != null));
  rows.push(
    goalRow({
      name: '평균 수면',
      color: 'var(--s0)',
      done: sleepAvg == null ? '기록 없음' : fmtHours(sleepAvg),
      goal: fmtHours(state.sleepGoal),
      ratio: sleepAvg == null ? 0 : sleepAvg / state.sleepGoal,
    }),
  );
  return `<section class="card week-card">
    <div class="card-head"><h2>이번 주 목표</h2><span class="hint">${8 - days.length}일 남음</span></div>
    ${rows.join('')}
  </section>`;
}

/** 활동 기록을 고치는 칸. 그 줄 바로 아래에 펼친다 */
function entryPanel(entry, state) {
  const area = areaById(entry.areaId, state);
  // 고른 적 없는 기록은 아무것도 눌러 두지 않는다. 몰래 '그대로예요'가 붙으면 부하 계산에서 빠진다
  const feel = area?.kind === 'varies' ? feelChoices(entryEdit.feel ?? entry.feel ?? null, 'entry-edit-feel', entry.id) : '';
  return `<li class="plan-panel" id="entry-panel" tabindex="-1" aria-label="${esc(entry.title || area?.label || '기록')} 고치기">
    <form class="stack" data-form="entry-edit" novalidate>
      <label class="field"><span>한 일</span><input data-entry-edit="title" maxlength="120" value="${esc(entryEdit.title)}" placeholder="${esc(area?.label ?? '')}"></label>
      <div><div class="scale-head"><span class="scale-label">얼마나</span></div><label class="suffix-in narrow"><input type="number" inputmode="numeric" min="1" max="1440" data-entry-edit="minutes" value="${esc(entryEdit.minutes)}" aria-label="얼마나(분)"><span aria-hidden="true">분</span></label></div>
      ${feel}
      <div class="btn-row"><button type="submit" class="btn primary">저장</button><button type="button" class="btn" data-action="entry-edit-close">취소</button></div>
    </form>
  </li>`;
}

/** 오늘 한 일. 줄을 누르면 고칠 수 있다. 없으면 아무것도 그리지 않는다 */
function todayList(state, today) {
  const list = state.entries.filter((e) => e.date === today).sort((a, b) => b.createdAt - a.createdAt);
  if (entryEdit && !list.some((e) => e.id === entryEdit.id)) entryEdit = null; // 다른 곳에서 지웠다
  if (!list.length) return '';
  const first = expanded.list ? list : list.slice(0, LIST_FIRST);
  const rows = entryEdit && !first.some((e) => e.id === entryEdit.id) ? [...first, list.find((e) => e.id === entryEdit.id)] : first;
  const planIds = new Set(state.plans.map((p) => p.id));
  const more =
    list.length > LIST_FIRST
      ? `<button type="button" class="list-more" data-action="fold" data-value="list" aria-expanded="${expanded.list}">${expanded.list ? '접기' : `${list.length - LIST_FIRST}개 더 보기`}${CHEV}</button>`
      : '';
  const items = rows
    .map((e) => {
      const open = entryEdit?.id === e.id;
      const row = entryItem(e, areaById(e.areaId, state), planIds, { edit: true, open });
      return open ? row + entryPanel(e, state) : row;
    })
    .join('');
  return `<section class="card">
    <div class="card-head"><h2>오늘 한 일</h2><span class="hint">${list.length}개 · ${fmtHM(sum(list, (e) => e.minutes))}</span></div>
    <ul class="entries">${items}</ul>${more}
  </section>`;
}

/** 카드 이름 줄. 남긴 카드에는 ✓, 계획은 한 수, 활동은 기록 수. 안 한 것은 세지 않는다 */
function tabs(state, day, today) {
  const c = state.checkins[day];
  const plans = progress(plansOn(state.plans, today));
  const entries = state.entries.filter((e) => e.date === today).length;
  const status = [
    checkinDone(c) ? ['✓', '남겼어요'] : null,
    sleepDone(state.sleep[day]) ? ['✓', '남겼어요'] : null,
    !plans.total ? null : plans.done === plans.total ? ['✓', '다 했어요'] : plans.done ? [`${plans.done}/${plans.total}`, `${plans.total}개 중 ${plans.done}개 했어요`] : [`${plans.total}개`, `${plans.total}개 있어요`],
    entries ? [`${entries}개`, `${entries}개 기록했어요`] : null,
    c?.note || c?.detach ? ['✓', '남겼어요'] : null,
  ];
  return CARDS.map((card, i) => {
    const [mark, said] = status[i] ?? ['', ''];
    return `<button type="button" role="tab" class="deck-tab" id="deck-tab-${i}" data-action="deck-go" data-value="${i}" aria-selected="${i === slide}" aria-controls="deck-panel" tabindex="${i === slide ? 0 : -1}" aria-label="${card.name}${said ? `, ${said}` : ''}">
      <span class="deck-tab-name">${card.name}</span><span class="deck-tab-mark${mark === '✓' ? ' done' : ''}" aria-hidden="true">${mark}</span>
    </button>`;
  }).join('');
}

function deckCard(state, day, areas, today) {
  const body = [
    () => checkinCard(state, day),
    () => sleepCard(state, day),
    () => planCard(state, today, { where: 'today', today }),
    () => `${entryCard(state, areas, today)}<div data-slot="list">${todayList(state, today)}</div>`,
    () => closeCard(state, day, areas, today),
  ][slide]();
  const hint = hintSeen ? '' : '<p class="deck-hint">옆으로 넘기거나 위의 이름을 누르면 다음 카드가 나와요</p>';
  return `${hint}<section class="deck-card" id="deck-panel" role="tabpanel" aria-labelledby="deck-tab-${slide}" tabindex="-1">${body}${nextButton(slide)}</section>`;
}

export function render(state) {
  const today = todayKey();
  if (today !== shownDay) {
    daysBack = 0; // 날이 바뀌면 어제 칸을 열어둔 채로 남기지 않고, 아직 안 남긴 첫 카드부터 다시 보여준다
    resetFolds();
    if (!makerWanted) slide = null; // 영역 만들기로 왔다면 활동 기록 카드를 그대로 연다
  }
  shownDay = today;
  if (dayWanted) {
    const back = CATCH_UP.findIndex(([n]) => addDays(today, -n) === dayWanted.day);
    if (back >= 0) {
      daysBack = back;
      slide = 0; // 그날 컨디션 카드부터
      focusDay = dayWanted.keyboard;
    } else setTimeout(() => toast('이날은 이제 고칠 수 없어요. 3일 전까지 고칠 수 있어요'));
    dayWanted = null;
  }
  const day = pickedDay();
  decideSlide(state, day);
  const areas = activeAreas(state);
  // 활동 기록 칸에 글자를 쓰는 중이면 그 칸은 다시 그리지 않으니, 고른 영역도 몰래 바꾸지 않는다. 지워졌다면 기록할 때 알려준다.
  const typing = document.activeElement?.matches?.('input, select, textarea') && document.activeElement.closest('[data-card="entry"]');
  if (!typing && !areas.some((a) => a.id === draft.areaId)) draft.areaId = areas[0]?.id ?? null;
  const i = insight(state, today);
  // 맨 위 덩어리는 언제나 이 4개다. 입력 중에 다시 그릴 때(app.js renderAround) 덩어리 수가 같아야 입력칸이 없는 덩어리를 바꿔 끼울 수 있다.
  // 새 내용은 이 안에 넣고, 조건에 따라 생기고 사라지는 덩어리를 맨 위에 더하지 않는다.
  return `${notices(state, i)}
    <div data-slot="load">${loadHero(state, i)}</div>
    <div class="deck-tabs" role="tablist" aria-label="오늘 남길 것" data-slot="tabs">${tabs(state, day, today)}</div>
    <div class="deck" id="deck">${deckCard(state, day, areas, today)}</div>`;
}

// ---- 카드 넘기기 ----
const SWIPE_START = 10; // 이만큼 옆으로 움직여야 넘기기로 본다(그 전에는 누르기나 세로 스크롤)
const SWIPE_GO = 0.22; // 카드 폭의 이만큼 넘게 밀면 다음 카드로 간다

/** n번 카드로 간다. 넘긴 쪽에서 새 카드가 들어온다. 세로로 많이 내려가 있었다면 카드 머리가 보이게 올린다 */
function go(n, { keyboard = false } = {}) {
  if (n < 0 || n >= CARDS.length || n === slide) return;
  entering = n > slide ? 1 : -1;
  slide = n;
  entryEdit = null;
  closePlanPanel();
  if (!hintSeen) {
    hintSeen = true;
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {}
  }
  const onTab = document.activeElement?.classList?.contains('deck-tab');
  refresh();
  // 긴 카드에서 내려온 채 넘겼다면 이름 줄이 머리글(아이폰 앱은 안전 영역만큼 더 큼) 아래에 보이게 올린다
  const head = document.querySelector('.deck-tabs');
  const top = head?.getBoundingClientRect().top ?? 0;
  const bar = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 60) + (document.getElementById('save-warning')?.offsetHeight ?? 0);
  if (top < bar + 4) scrollBy({ top: top - bar - 12, behavior: smooth() });
  // 이름 줄에 포커스가 있었다면 고른 카드의 이름으로 옮긴다(손가락으로 넘겨도 탭 묶음의 포커스가 어긋나지 않게)
  if (onTab) document.getElementById(`deck-tab-${slide}`)?.focus({ preventScroll: true });
  else if (keyboard) document.getElementById('deck-panel')?.focus({ preventScroll: true });
}

/** 카드를 손가락으로 밀면 따라 움직이고, 충분히 밀면 옆 카드로 간다. 세로 스크롤은 브라우저에 맡긴다(touch-action: pan-y) */
// 카드 줄은 넘길 때마다 새로 그려지므로, 넘기기 사이에 이어져야 하는 값은 모듈에 둔다
let swallowUntil = 0; // 밀고 손을 뗀 직후에 오는 클릭은 누른 것이 아니다
let wheelAt = 0; // 마지막 가로 휠
let wheelGestureAt = 0; // 그 휠 손짓에서 카드를 넘긴 때. 관성으로 이어지는 휠은 한 장만 넘긴다
const zoomed = () => (globalThis.visualViewport?.scale ?? 1) > 1.01; // 두 손가락으로 확대한 동안에는 옆으로 밀면 화면을 옮긴다
// 확대한 동안에는 카드 위에서도 브라우저가 화면을 옆으로 옮기게 한다(.deck.zoomed의 touch-action)
globalThis.visualViewport?.addEventListener('resize', () => document.getElementById('deck')?.classList.toggle('zoomed', zoomed()));

function bindSwipe(deck) {
  let drag = null;
  const card = () => deck.querySelector('.deck-card');
  const settle = () => {
    const el = card();
    if (el) {
      el.style.transition = 'transform 0.2s ease-out';
      el.style.transform = '';
    }
  };
  deck.addEventListener('pointerdown', (e) => {
    swallowUntil = 0; // 새로 누른 손가락 뒤의 클릭은 진짜 누름이다
    if (!e.isPrimary) {
      // 두 번째 손가락이 닿으면 확대하려는 것이니 넘기기를 멈춘다
      if (drag?.on) settle();
      drag = null;
      return;
    }
    if (e.pointerType === 'mouse' || zoomed() || e.target.closest('input, select, textarea')) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, on: false, t: performance.now() };
  });
  deck.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dy) > SWIPE_START && Math.abs(dy) > Math.abs(dx)) return void (drag = null); // 세로 스크롤
      if (Math.abs(dx) < SWIPE_START) return;
      drag.on = true;
      try {
        deck.setPointerCapture(e.pointerId); // 손가락이 카드 밖으로 나가도 계속 따라오게
      } catch {} // 이미 끝난 포인터면 붙잡지 못해도 넘기기는 된다
    }
    const edge = (dx > 0 && slide === 0) || (dx < 0 && slide === CARDS.length - 1);
    drag.dx = edge ? dx / 4 : dx; // 끝 카드에서는 조금만 따라온다
    const el = card();
    if (el) {
      el.style.transition = 'none';
      el.style.transform = `translateX(${drag.dx}px)`;
    }
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { dx, on, t } = drag;
    drag = null;
    if (!on) return;
    swallowUntil = performance.now() + 400;
    const width = deck.clientWidth || 1;
    const fast = Math.abs(dx) / Math.max(1, performance.now() - t) > 0.6 && Math.abs(dx) > 40;
    const n = slide + (dx < 0 ? 1 : -1);
    if (e.type === 'pointerup' && (Math.abs(dx) > width * SWIPE_GO || fast) && n >= 0 && n < CARDS.length) return go(n);
    settle();
  };
  deck.addEventListener('pointerup', end);
  deck.addEventListener('pointercancel', end);
  deck.addEventListener(
    'click',
    (e) => {
      // 키보드나 보조 기기로 누른 것(detail 0)은 막지 않는다
      if (e.detail === 0 || performance.now() > swallowUntil) return;
      swallowUntil = 0;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  // 노트북 트랙패드로 옆으로 밀어도 넘긴다
  deck.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 2) return;
      const now = Date.now();
      const fresh = now - wheelAt > 200; // 휠이 잠깐 끊겼다가 다시 오면 새 손짓이다
      wheelAt = now;
      if (fresh) wheelGestureAt = 0;
      if (wheelGestureAt || Math.abs(e.deltaX) < 30) return;
      wheelGestureAt = now;
      go(slide + (e.deltaX > 0 ? 1 : -1));
    },
    { passive: true },
  );
}

/** 다시 그린 뒤 카드 줄에 넘기기를 붙이고, 방금 넘겼다면 새 카드를 넘긴 쪽에서 들어오게 한다 */
export function mount(root) {
  const deck = root.querySelector('#deck');
  if (!deck || deck.dataset.bound) return; // 입력 중이라 남겨 둔 카드 줄
  deck.dataset.bound = '1';
  deck.classList.toggle('zoomed', zoomed());
  bindSwipe(deck);
  const dir = entering;
  entering = 0;
  const el = deck.querySelector('.deck-card');
  if (dir && el?.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.animate([{ transform: `translateX(${dir * 48}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }
}

export const label = () => fmtLong(todayKey());

function saveArea() {
  const label = maker.label.trim();
  if (!label) {
    document.querySelector('[data-maker="label"]')?.focus();
    toast('이름을 먼저 적어주세요');
    return false;
  }
  const free = freeColors(getState());
  const id = addArea({ label, kind: maker.kind, color: free.includes(maker.color) ? maker.color : free[0] });
  if (!id) {
    refresh(); // 다른 탭에서 자리를 채웠을 수 있다
    toast(`영역은 최대 ${MAX_AREAS}개까지 만들 수 있어요`);
    return false;
  }
  maker = { ...NEW_AREA };
  draft.areaId = id;
  document.activeElement?.blur(); // 키보드를 내린다
  refresh();
  savedToast(`'${label}' 영역을 만들었어요`);
  return true;
}

/** 다시 그리지 않고 한 자리만 바꿔 끼운다. 입력 중인 칸이 그대로 남는다 */
function putSlot(slot, html) {
  const el = document.querySelector(`[data-slot="${slot}"]`);
  if (el) el.innerHTML = html;
}

/** 오늘 한 일 펼치고 접기 */
function toggle(key) {
  expanded[key] = !expanded[key];
  refresh();
}

/** 고친 활동 기록을 저장한다 */
function submitEntryEdit(form) {
  if (!entryEdit) return refresh(); // 그사이 닫혔다
  const entry = getState().entries.find((e) => e.id === entryEdit.id);
  if (!entry) {
    entryEdit = null;
    refresh();
    return toast('다른 곳에서 지운 기록이에요');
  }
  const minutes = Math.round(Number(form.querySelector('[data-entry-edit="minutes"]')?.value ?? entryEdit.minutes));
  if (!(minutes >= 1 && minutes <= 1440)) {
    document.activeElement?.blur();
    return toast('시간을 1~1440분 사이로 입력해주세요');
  }
  const title = form.querySelector('[data-entry-edit="title"]')?.value ?? entryEdit.title;
  const shown = form.querySelector('.feel [aria-pressed="true"]');
  const feel = areaById(entry.areaId)?.kind === 'varies' && shown?.dataset.id === entry.id ? shown.dataset.value : undefined;
  const id = entry.id;
  const keyboard = byKeyboard();
  entryEdit = null;
  if (!keyboard) document.activeElement?.blur(); // 아이폰 키보드를 내린다
  updateEntry(id, { minutes, title, feel });
  savedToast('고쳤어요');
  if (keyboard) (document.querySelector(`[data-action="entry-edit"][data-id="${CSS.escape(id)}"]`) ?? document.getElementById('deck-panel'))?.focus({ preventScroll: true });
}

export const on = {
  async click(e) {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const { action, field, value, id } = button.dataset;
    if (action === 'checkin') setCheckin(pickedDay(), { [field]: Number(value) }); // 다 남겨도 저절로 넘기지 않는다. 손가락 아래가 그대로다
    else if (action === 'sleep') setSleep(pickedDay(), { [field]: Number(value) });
    else if (action === 'deck-go' || action === 'deck-next') go(Number(value), { keyboard: action === 'deck-next' && e.detail === 0 });
    else if (action === 'entry-edit') {
      const entry = getState().entries.find((x) => x.id === id);
      const was = entryEdit?.id === id;
      entryEdit = was || !entry ? null : { id, minutes: String(entry.minutes), title: entry.title, feel: null };
      refresh();
      if (entryEdit) {
        const panel = document.getElementById('entry-panel');
        panel?.scrollIntoView({ block: 'nearest', behavior: smooth() });
        if (e.detail === 0) panel?.focus({ preventScroll: true });
      }
    } else if (action === 'entry-edit-close') {
      const was = entryEdit?.id;
      entryEdit = null;
      refresh();
      if (e.detail === 0 && was) document.querySelector(`[data-action="entry-edit"][data-id="${CSS.escape(was)}"]`)?.focus({ preventScroll: true });
    } else if (action === 'entry-edit-feel') {
      if (entryEdit) entryEdit.feel = value;
      refresh();
    } else if (action === 'fold') toggle(value);
    else if (action === 'mark-day') {
      openMarkForm(pickedDay());
      location.hash = '#/recovery';
    } else if (action === 'support-close') setSupportSeen();
    else if (action === 'pick-area') {
      draft.areaId = id;
      refresh();
    } else if (action === 'feel') {
      draft.feel = { areaId: id, value };
      refresh();
    } else if (action === 'maker-open') {
      maker.open = true;
      refresh();
      document.querySelector('[data-maker="label"]')?.focus();
    } else if (action === 'maker-close') {
      maker = { ...NEW_AREA };
      refresh();
      document.querySelector('[data-action="maker-open"]')?.focus({ preventScroll: true });
    } else if (action === 'maker-color') {
      maker.color = Number(value);
      refresh();
    } else if (action === 'maker-kind') {
      maker.kind = value;
      refresh();
    } else if (action === 'maker-save') {
      const { left, top, width, height } = button.getBoundingClientRect();
      if (!saveArea()) return;
      // 두 번 누르면 두 번째 탭이 만들기 자리에 새로 나타난 칸을 누른다. 그 칸만 잠깐 막는다.
      const under = document.elementFromPoint(left + width / 2, top + height / 2)?.closest('.field, .suffix-in, label, input, select, button, a');
      if (under) {
        under.style.pointerEvents = 'none';
        setTimeout(() => under.style.removeProperty('pointer-events'), 400);
      }
    } else if (action === 'quick') {
      const input = button.form.elements.minutes;
      draft.minutes = String((Number(input.value) || 0) + Number(value));
      input.value = draft.minutes;
    } else if (action === 'clear-sample' && (await ask('샘플 데이터와 그동안 직접 남긴 기록까지 모두 지워져요. 지우고 새로 시작할까요?', '모두 지우기'))) {
      resetTodayDrafts();
      resetState({ keepTheme: true });
      savedToast('깨끗하게 비웠어요. 오늘부터 시작해봐요!');
    }
  },
  keydown(e) {
    // 카드 이름 줄은 화살표로 옆 카드에 간다(탭 묶음의 보통 동작)
    const tab = e.target.closest?.('.deck-tab');
    if (tab) {
      const at = Number(tab.dataset.value);
      const n = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: CARDS.length - 1 }[e.key];
      if (n === undefined) return;
      e.preventDefault();
      go(Math.max(0, Math.min(CARDS.length - 1, n)));
      document.getElementById(`deck-tab-${slide}`)?.focus({ preventScroll: true });
      return;
    }
    if (e.key === 'Escape' && entryEdit && e.target.closest?.('#entry-panel')) {
      const was = entryEdit.id;
      entryEdit = null;
      refresh();
      document.querySelector(`[data-action="entry-edit"][data-id="${CSS.escape(was)}"]`)?.focus({ preventScroll: true });
      return;
    }
    if ('day' in e.target.dataset) dayKeyAt = Date.now();
    if (e.target.dataset.maker === 'label' && e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) saveArea(); // 229: 한글 조합을 마치는 Enter
  },
  input(e) {
    const key = e.target.dataset.draft;
    if (e.target.dataset.entryEdit) {
      if (entryEdit) entryEdit[e.target.dataset.entryEdit] = e.target.value;
    } else if (key) draft[key] = e.target.value;
    else if (e.target.dataset.maker === 'label') maker.label = e.target.value;
    // 메모는 글자마다 저장해, 입력 중에 앱을 벗어나거나 화면을 다시 그려도 남게 한다
    else if ('note' in e.target.dataset) {
      setCheckin(pickedDay(), { note: e.target.value.trim() }, { quiet: true });
      putSlot('tabs', tabs(getState(), pickedDay(), shownDay)); // 마무리 ✓를 바로 맞춘다. 칸을 벗어날 때 바꾸면 누르려던 이름이 바뀌어 클릭을 잃는다
    }
  },
  change(e) {
    const el = e.target;
    if ('day' in el.dataset) {
      // 날을 골랐다면 그날을 고치려는 것이니 보던 카드에서 그날 기록을 보여준다
      daysBack = Number(el.value);
      el.blur(); // 포커스가 남아 있으면 입력 중으로 보고 다른 곳이 저장해도 다시 그리지 않는다
      refresh();
      // 다시 그리면 포커스가 화면 맨 위로 가므로, 키보드로 골랐다면 고른 날의 제목으로 옮겨 그 자리에서 이어지게 한다.
      // 손가락으로 골랐다면 옮기지 않는다. 옮기면 아이폰이 제목에 굵은 포커스 테두리를 띄운다.
      // select에 다시 두면 아이폰에서 고르는 창이 또 열릴 수 있다.
      if (Date.now() - dayKeyAt < KEYED_DAY) document.querySelector('#deck-panel h2')?.focus({ preventScroll: true });
    } else if (el.dataset.sleep) {
      // 시간 입력칸은 값을 고치는 도중에도 change가 불려서, 전체를 다시 그리지 않고 필요한 곳만 고친다
      setSleep(pickedDay(), { [el.dataset.sleep]: el.value }, { quiet: true });
      const state = getState();
      putSlot('sleep', sleepHead(state, pickedDay()));
      putSlot('load', loadHero(state, insight(state, shownDay)));
      putSlot('tabs', tabs(state, pickedDay(), shownDay));
    } else if ('note' in el.dataset) fieldSavedToast('메모를 저장했어요');
  },
  submit(e) {
    e.preventDefault();
    if (e.target.dataset.form === 'entry-edit') return submitEntryEdit(e.target);
    if (e.target.dataset.form !== 'entry') return;
    const complain = (message) => {
      document.activeElement?.blur(); // 키보드를 내려 안내가 가려지지 않게 한다
      toast(message);
    };
    if (!draft.minutes && Date.now() - savedAt < 500) return;
    const minutes = Math.round(Number(draft.minutes));
    const today = todayKey();
    const date = draft.date || shownDay;
    if (!areaById(draft.areaId)) {
      refresh(); // 다른 탭에서 지운 영역이 입력 중인 화면에 남아 있을 수 있다
      return complain('영역을 먼저 골라주세요');
    }
    if (!(minutes >= 1 && minutes <= 1440)) return complain('시간을 1~1440분 사이로 입력해주세요');
    if (date > today || date < addDays(today, -OLDEST_DAYS)) return complain('날짜는 오늘부터 최근 30일 안에서 골라주세요');
    // 화면에 눌려 보이던 그 영역의 값을 남긴다. 그사이 다른 탭에서 기록이 늘어 지난번 값이 바뀌어도 보던 값이 저장된다.
    // 묻는 칸을 보지 못했다면(다른 탭에서 종류를 바꿨다면) 붙이지 않아, 보던 대로 해야 하는 일처럼 부하로 친다.
    const shown = e.target.querySelector('.feel [aria-pressed="true"]');
    const feel = areaById(draft.areaId).kind === 'varies' && shown?.dataset.id === draft.areaId ? shown.dataset.value : undefined;
    const entry = { date, areaId: draft.areaId, minutes, title: draft.title, feel };
    // addEntry가 곧바로 화면을 다시 그리므로 입력값을 먼저 비운다
    draft = { ...draft, minutes: '', title: '', date: '', feel: null, areaId: activeAreas(getState()).some((a) => a.id === entry.areaId) ? entry.areaId : null };
    addEntry(entry);
    savedAt = Date.now();
    savedToast(`${areaById(entry.areaId).label} ${fmtHM(minutes)} 기록했어요`);
  },
};
