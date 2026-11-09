// 오늘 화면: 컨디션·수면 체크인, 오늘 계획(plan-card.js), 활동 기록, 이번 주 목표
// 매일 한 번 하는 칸(컨디션, 수면)은 마치면 한 줄 요약으로 접고, 여러 번 하는 활동 기록은 늘 펼쳐 둔다
import { activeAreas, addArea, addEntry, areaById, canAddArea, freeColors, getState, lastFeel, MAX_AREAS, resetState, setCheckin, setSleep, setSupportSeen } from '../store.js';
import { addDays, fmtDay, fmtLong, rangeKeys, sleepHours, todayKey, weekStartKey } from '../dates.js';
import { BANDS, bandWord, insight } from '../insight.js';
import { isIOS, isStandalone } from '../pwa.js';
import { openMarkForm } from './recovery.js';
import { avg, esc, fmtHM, fmtHours, sum } from '../util.js';
import { areaColor, ask, CHEV, colorChoices, entryList, fader, feelChoices, fieldSavedToast, ratingScale, refresh, savedToast, smooth, tickBar, toast } from '../ui.js';
import { closePlanPanel, planCard, resetPlanDrafts } from '../plan-card.js';

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
const ASK = ['오늘은', '어제는', '그제는', '3일 전은']; // 고른 날마다 '…어땠나요' 앞에 붙는 말
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
// 펼친 칸. null이면 아직 정하지 않아서 다음에 그릴 때 정한다(decideExpanded).
// 한 번 정한 뒤로는 사용자가 누를 때만 바꾼다. 세 번째 값을 누르자마자 칸이 접히면 손가락 아래가 바뀐다.
const UNDECIDED = { checkin: null, sleep: null, extra: null, list: false };
let expanded = { ...UNDECIDED };
const LONG_WORD = 13; // 이보다 긴 말은 큰 글씨로 쓰면 네 줄을 넘는다
const FIT_WORD = 11; // 이보다 긴 말은 한 단계 작게 써야 한 줄에 들어간다
const SHORT_WORD = 4; // 이 안의 말은 가장 큰 글씨로 써도 한 줄에 들어간다

const pickedDay = () => addDays(shownDay, -daysBack);
let dayKeyAt = 0; // 날 고르기를 키보드로 다룬 때
const KEYED_DAY = 10000; // 키를 누른 뒤 이 안에 날이 바뀌면 키보드로 고른 것으로 본다. 펼친 목록에서 고르는 시간까지 넉넉히 둔다
const checkinDone = (c) => SCALES.every((s) => c?.[s.field] != null);
const sleepDone = (night) => sleepHours(night?.bed, night?.wake) != null;

/** 펼친 칸을 처음 상태로 돌린다. 날이 바뀌거나 기록을 지웠을 때 쓴다. */
export function resetFolds() {
  expanded = { ...UNDECIDED };
}

/** 오늘 탭에 들어올 때마다(오래 떠나 있다 돌아올 때도) 오늘로 돌아오고, 펼칠 칸을 새로 정한다 */
export function enter() {
  daysBack = 0;
  resetFolds();
  closePlanPanel();
}

/** 매일 할 일 가운데 처음 비어 있는 칸 하나만 연다. 이미 정한 칸은 건드리지 않는다. */
function decideExpanded(state, day) {
  const c = state.checkins[day];
  if (expanded.checkin === null) expanded.checkin = !checkinDone(c);
  if (expanded.sleep === null) expanded.sleep = !expanded.checkin && !sleepDone(state.sleep[day]);
  if (expanded.extra === null) expanded.extra = !!(c?.note || c?.detach);
}

let makerWanted = false; // 다른 화면에서 영역을 만들러 왔다

/** 다른 화면에서 오늘로 넘어오며 영역 만들기 칸을 열어둔다 */
export function openAreaMaker() {
  maker.open = true;
  makerWanted = true;
}

export function arrive() {
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
    unknown: ['최근 컨디션 기록이 없어서 지금은 알 수 없어요', '아래에서 날짜를 골라 3일 전까지 채울 수 있어요.'],
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

const TODO = '<span class="todo">남기기</span>';
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

function checkinPart(state, day) {
  const c = state.checkins[day] || {};
  if (!expanded.checkin) {
    const cells = SCALES.map((s) => `<span class="stat"><span class="stat-label">${s.label}</span><b class="stat-val${c[s.field] == null ? ' none' : ''}">${c[s.field] ?? '–'}${c[s.field] == null ? '' : '<small aria-hidden="true">/5</small>'}</b></span>`).join('');
    const extra = [c.detach && `<span>벗어남 ${c.detach}</span>`, c.note && '<span>메모</span>'].filter(Boolean).join('');
    return `<div class="daily-part" id="checkin-part">
      <button type="button" class="stat-row" data-action="fold" data-value="checkin" aria-expanded="false">
        ${daysBack ? `<span class="stat-day">${CATCH_UP[daysBack][1]} · ${fmtDay(day)}</span>` : '<span class="sr-only">오늘 컨디션</span>'}
        <span class="stat-cells">${cells}</span>
        ${checkinDone(c) ? (extra ? `<span class="stat-side">${extra}</span>` : '') : TODO}${CHEV}
      </button>
    </div>`;
  }
  const hint = [c.detach && `벗어남 ${c.detach}`, c.note && '메모 있음'].filter(Boolean).join(' · ') || '벗어남 · 메모';
  const extra = expanded.extra
    ? `<div class="stack extra" id="checkin-extra">
        ${ratingScale(DETACH_SCALE, c.detach, 'checkin')}
        <label class="field"><span>한 줄 메모</span><input type="text" data-note maxlength="120" value="${esc(c.note || '')}" placeholder="오늘을 짧게 남겨보세요"></label>
      </div>`
    : '';
  return `<div class="daily-part open" id="checkin-part">
    <div class="part-head">
      <h2><button type="button" class="fold-head" data-action="fold" data-value="checkin" aria-expanded="true">${ASK[daysBack]} 어땠나요${CHEV}</button></h2>
      ${dayPill(day)}
    </div>
    <div class="faders">${SCALES.map((s) => fader(s, c[s.field], 'checkin')).join('')}</div>
    <div class="more-line">
      <button type="button" class="more-toggle" data-action="fold" data-value="extra" aria-expanded="${expanded.extra}"${expanded.extra ? ' aria-controls="checkin-extra"' : ''}><span class="more-title">더 남기기</span>${CHEV}<span class="more-hint">${hint}</span></button>
      <button type="button" class="btn small outline" data-action="mark-day">지친 날로 표시</button>
    </div>
    ${extra}
  </div>`;
}

/** 수면 칸의 머리. 시간을 고치는 동안에는 이 부분만 바꿔 끼우므로 입력칸을 넣지 않는다. */
function sleepHead(state, day) {
  const night = state.sleep[day] || {};
  const name = daysBack ? `${fmtDay(day)} 수면` : '어젯밤 수면';
  const big = duration(night);
  if (!expanded.sleep) {
    const side = big
      ? `<span class="stat-side"><span>${esc(night.bed)}–${esc(night.wake)}</span>${night.quality ? `<span>수면의 질 ${night.quality}</span>` : ''}</span>`
      : TODO;
    return `<button type="button" class="stat-row" data-action="fold" data-value="sleep" aria-expanded="false">
      <span class="stat"><span class="stat-label">${name}</span>${big || '<span class="stat-ask">몇 시에 잤나요?</span>'}</span>
      ${side}${CHEV}
    </button>`;
  }
  return `<div class="part-head">
    <h2><button type="button" class="fold-head" data-action="fold" data-value="sleep" aria-expanded="true">${name}${CHEV}</button></h2>
    ${big || '<b class="stat-val none">–</b>'}
  </div>`;
}

function sleepPart(state, day) {
  const night = state.sleep[day] || {};
  const form = expanded.sleep
    ? `<div class="stack" id="sleep-form">
        <div class="row">
          <label class="field grow"><span>잠든 시간</span><input type="time" data-sleep="bed" value="${esc(night.bed || '')}"></label>
          <label class="field grow"><span>일어난 시간</span><input type="time" data-sleep="wake" value="${esc(night.wake || '')}"></label>
        </div>
        ${ratingScale(SLEEP_SCALE, night.quality, 'sleep')}
      </div>`
    : '';
  return `<div class="daily-part${expanded.sleep ? ' open' : ''}" id="sleep-part"><div data-slot="sleep">${sleepHead(state, day)}</div>${form}</div>`;
}

/** 컨디션과 수면을 한 카드에 둔다. 밀린 날을 채우는 중이면 테두리로 알린다. */
function dailyCard(state, day) {
  return `<section class="card daily${daysBack ? ' past' : ''}" id="daily">${checkinPart(state, day)}${sleepPart(state, day)}</section>`;
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

/** 오늘 한 일. 없으면 아무것도 그리지 않는다(자리는 render의 data-slot="list"가 지킨다). */
function todayList(state, today) {
  const list = state.entries.filter((e) => e.date === today).sort((a, b) => b.createdAt - a.createdAt);
  if (!list.length) return '';
  const rows = expanded.list ? list : list.slice(0, LIST_FIRST);
  const more =
    list.length > LIST_FIRST
      ? `<button type="button" class="list-more" data-action="fold" data-value="list" aria-expanded="${expanded.list}">${expanded.list ? '접기' : `${list.length - LIST_FIRST}개 더 보기`}${CHEV}</button>`
      : '';
  return `<section class="card">
    <div class="card-head"><h2>오늘 한 일</h2><span class="hint">${list.length}개 · ${fmtHM(sum(list, (e) => e.minutes))}</span></div>
    ${entryList(rows, state)}${more}
  </section>`;
}

export function render(state) {
  const today = todayKey();
  if (today !== shownDay) {
    daysBack = 0; // 날이 바뀌면 어제 칸을 열어둔 채로 남기지 않는다
    resetFolds();
  }
  shownDay = today;
  const day = pickedDay();
  decideExpanded(state, day);
  const areas = activeAreas(state);
  // 활동 기록 칸에 글자를 쓰는 중이면 그 칸은 다시 그리지 않으니, 고른 영역도 몰래 바꾸지 않는다. 지워졌다면 기록할 때 알려준다.
  const typing = document.activeElement?.matches?.('input, select, textarea') && document.activeElement.closest('[data-card="entry"]');
  if (!typing && !areas.some((a) => a.id === draft.areaId)) draft.areaId = areas[0]?.id ?? null;
  const i = insight(state, today);
  // 맨 위 덩어리는 언제나 이 7개다. 입력 중에 다시 그릴 때(app.js renderAround) 덩어리 수가 같아야 입력칸이 없는 덩어리를 바꿔 끼울 수 있다.
  // 새 내용은 이 안에 넣고, 조건에 따라 생기고 사라지는 덩어리를 맨 위에 더하지 않는다.
  return `${notices(state, i)}
    <div data-slot="load">${loadHero(state, i)}</div>
    ${dailyCard(state, day)}
    <div data-slot="plan">${planCard(state, today, { where: 'today', today })}</div>
    ${entryCard(state, areas, today)}
    <div data-slot="list">${todayList(state, today)}</div>
    <div data-slot="week">${weekCard(state, areas, today)}</div>`;
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

const PART = { checkin: 'checkin-part', sleep: 'sleep-part', extra: 'checkin-extra' };

/** 접고 펴기. 펼친 칸이 탭 막대에 가리지 않게 보이는 곳까지만 내린다. */
function toggle(key) {
  expanded[key] = !expanded[key];
  // 컨디션을 접을 때 수면이 비어 있으면 이어서 연다
  const next = key === 'checkin' && !expanded.checkin && !sleepDone(getState().sleep[pickedDay()]);
  if (next) expanded.sleep = true;
  refresh();
  const target = next ? PART.sleep : expanded[key] ? PART[key] : null;
  if (target) document.getElementById(target)?.scrollIntoView({ block: 'nearest', behavior: smooth() });
}

export const on = {
  async click(e) {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const { action, field, value, id } = button.dataset;
    if (action === 'checkin') {
      const day = pickedDay();
      const before = getState();
      // 세 가지를 다 남긴 순간 그날 수면이 비어 있으면 바로 아래에 수면 칸을 연다. 컨디션 칸은 접지 않아 누르던 자리가 그대로다.
      const finished = !checkinDone(before.checkins[day]) && checkinDone({ ...before.checkins[day], [field]: Number(value) });
      const reveal = finished && !expanded.sleep && !sleepDone(before.sleep[day]);
      if (reveal) expanded.sleep = true;
      setCheckin(day, { [field]: Number(value) });
      if (reveal) document.getElementById(PART.sleep)?.scrollIntoView({ block: 'nearest', behavior: smooth() });
    } else if (action === 'sleep') setSleep(pickedDay(), { [field]: Number(value) });
    else if (action === 'fold') toggle(value);
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
    if ('day' in e.target.dataset) dayKeyAt = Date.now();
    if (e.target.dataset.maker === 'label' && e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) saveArea(); // 229: 한글 조합을 마치는 Enter
  },
  input(e) {
    const key = e.target.dataset.draft;
    if (key) draft[key] = e.target.value;
    else if (e.target.dataset.maker === 'label') maker.label = e.target.value;
    // 메모는 글자마다 저장해, 입력 중에 앱을 벗어나거나 화면을 다시 그려도 남게 한다
    else if ('note' in e.target.dataset) setCheckin(pickedDay(), { note: e.target.value.trim() }, { quiet: true });
  },
  change(e) {
    const el = e.target;
    if ('day' in el.dataset) {
      // 날을 골랐다면 그날을 고치려는 것이니 컨디션 칸은 펼쳐 두고, 수면과 더 남기기는 그날 기록을 보고 다시 정한다
      daysBack = Number(el.value);
      expanded = { ...UNDECIDED, checkin: true, list: expanded.list };
      el.blur(); // 포커스가 남아 있으면 입력 중으로 보고 다른 곳이 저장해도 다시 그리지 않는다
      refresh();
      // 다시 그리면 포커스가 화면 맨 위로 가므로, 키보드로 골랐다면 고른 날의 제목으로 옮겨 그 자리에서 이어지게 한다.
      // 손가락으로 골랐다면 옮기지 않는다. 옮기면 아이폰이 제목에 굵은 포커스 테두리를 띄운다.
      // select에 다시 두면 아이폰에서 고르는 창이 또 열릴 수 있다.
      if (Date.now() - dayKeyAt < KEYED_DAY) document.querySelector('[data-action="fold"][data-value="checkin"]')?.focus({ preventScroll: true });
    } else if (el.dataset.sleep) {
      // 시간 입력칸은 값을 고치는 도중에도 change가 불려서, 전체를 다시 그리지 않고 필요한 곳만 고친다
      setSleep(pickedDay(), { [el.dataset.sleep]: el.value }, { quiet: true });
      const state = getState();
      document.querySelector('[data-slot="sleep"]').innerHTML = sleepHead(state, pickedDay());
      document.querySelector('[data-slot="load"]').innerHTML = loadHero(state, insight(state, shownDay));
      document.querySelector('[data-slot="week"]').innerHTML = weekCard(state, activeAreas(state), shownDay);
    } else if ('note' in el.dataset) fieldSavedToast('메모를 저장했어요');
  },
  submit(e) {
    e.preventDefault();
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
