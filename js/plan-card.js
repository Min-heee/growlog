// 계획 카드: 오늘 탭과 달력 탭이 함께 쓴다. 그날의 계획 목록, 더하기 폼, 고치기 칸, 기록하기 칸이 들어 있다.
// 이벤트는 app.js가 화면보다 먼저 planOn에 넘기고, 카드([data-plan-where]) 안의 이벤트만 여기서 처리한다.
import { activeAreas, addEntry, addPlan, areaById, deleteEntry, editPlan, endPlan, getState, lastFeel, linkEntry, replacePlans, setPlanDone, skipPlan, unlinkEntry } from './store.js';
import { addDays, fmtDay, fmtLong, fmtMonthDay, fromKey, toKey, todayKey } from './dates.js';
import { clockLabel, DAY_NAMES, DAY_ORDER, endStart, linkedEntry, logInfo, looseEntries, nextOn, occursOn, plansOn, progress, repeatLabel, samePlan, scheduled, stateOn } from './plans.js';
import { esc, fmtHM, uid } from './util.js';
import { areaColor, CHEV, feelChoices, refresh, savedToast, smooth, toast } from './ui.js';

// 쓰던 내용은 다시 그려도 남아 있어야 하니 모듈에 둔다. 오늘 탭에 쓰던 제목이 달력에 보이지 않게 화면마다 따로 둔다.
const emptyAdd = () => ({ title: '', time: '', more: false, areaId: null, minutes: '', days: [] });
let adds = { today: emptyAdd(), calendar: emptyAdd() };
// 한 번에 하나만 연다. { kind: 'edit', where, day, id, title, time, date, minutes, areaId, days } 또는 { kind: 'log', where, day, id, minutes, feel }
let panel = null;
let savedAt = 0; // 한글 입력을 마치는 엔터로 submit이 두 번 와도 두 번째의 빈 제목은 조용히 넘긴다

export const closePlanPanel = () => {
  panel = null;
};
export function resetPlanDrafts() {
  adds = { today: emptyAdd(), calendar: emptyAdd() };
  panel = null;
}

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 12.5l3.2 3.2L17 9"/></svg>';
const MAX_MINUTES = 1440;
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && toKey(fromKey(v)) === v;
/** 받침이 있는 한글로 끝나면 을, 없으면 를. 한글로 끝나지 않으면 조사를 붙이지 않는다 */
function quoted(title) {
  const code = title.charCodeAt(title.length - 1) - 0xac00;
  const particle = code < 0 || code > 11171 ? ' ' : code % 28 ? '을 ' : '를 ';
  return `'${title}'${particle}`;
}
const usableArea = (id, state) => {
  const area = id ? areaById(id, state) : null;
  return area && !area.archived ? area : null;
};

// ---- 그리기 ----
function hintFor(items, day, today) {
  if (!items.length) return '';
  const { total, done } = progress(items);
  if (day < today) return done ? `${done}개 했어요` : ''; // 지난 날에 안 한 수는 세지 않는다
  if (!total) return day === today ? '오늘은 쉬어 가요' : '쉬어 가는 날이에요';
  if (!done) return `${total}개`;
  return done === total ? '다 했어요' : `${total}개 중 ${done}개 했어요`;
}

function emptyText(day, today) {
  if (day === today) return '오늘은 아직 비어 있어요. 느긋한 하루도 좋아요.';
  return day > today ? '이날은 비어 있어요. 미리 적어 둘 수 있어요.' : '이날은 비어 있어요.';
}

function metaFor(plan, day, state, info) {
  const area = plan.areaId ? areaById(plan.areaId, state) : null;
  const parts = [];
  if (area) parts.push(`<span class="dot" style="background:${areaColor(area)}"></span>${esc(area.label)}`);
  if (info.entry) parts.push(`기록했어요 ${fmtHM(info.entry.minutes)}`);
  else if (plan.minutes) parts.push(fmtHM(plan.minutes));
  if (plan.repeat) parts.push(repeatLabel(plan.repeat.days));
  return parts.length ? `<span class="plan-meta">${parts.join('<span aria-hidden="true"> · </span>')}</span>` : '';
}

function planRow({ plan, state: s }, day, today, state) {
  const info = logInfo(plan, day, state, today);
  const later = day > today;
  const open = panel?.id === plan.id && panel.day === day ? panel.kind : null;
  const label = later ? `${plan.title}, 그날이 되면 체크할 수 있어요` : `${plan.title} 했어요`;
  const check = `<button type="button" class="plan-check" data-action="plan-done" data-id="${esc(plan.id)}" data-value="${day}" aria-pressed="${s === 'done'}" aria-label="${esc(label)}"${later ? ' disabled' : ''}><span>${CHECK}</span></button>`;
  const time = plan.time ? `<span class="plan-time">${clockLabel(plan.time)}</span>` : '';
  const main = `<button type="button" class="plan-main" data-action="plan-edit" data-id="${esc(plan.id)}" aria-expanded="${open === 'edit'}"${open === 'edit' ? ' aria-controls="plan-panel"' : ''}>
      ${time}<span class="plan-title">${esc(plan.title)}</span>${metaFor(plan, day, state, info)}
    </button>`;
  const side =
    s === 'rest'
      ? '<span class="plan-pill">쉬어 가요</span>'
      : info.can
        ? `<button type="button" class="btn small outline" data-action="plan-log" data-id="${esc(plan.id)}" aria-expanded="${open === 'log'}"${open === 'log' ? ' aria-controls="plan-panel"' : ''} aria-label="${esc(plan.title)} 기록하기">기록하기</button>`
        : '';
  return `<li class="plan${s === 'done' ? ' done' : s === 'rest' ? ' rest' : ''}">${check}${main}${side}</li>`;
}

function areaChips(selected, field, state) {
  const areas = activeAreas(state);
  const kept = selected && !areas.some((a) => a.id === selected) ? areaById(selected, state) : null; // 숨긴 영역에 이어 둔 계획을 고칠 때 몰래 떼지 않는다
  const chip = (id, label, color) =>
    `<button type="button" class="chip" data-action="plan-area" data-field="${field}" data-value="${esc(id)}" aria-pressed="${(selected ?? '') === id}">${color ? `<span class="dot" style="background:${color}"></span>` : ''}${esc(label)}</button>`;
  return [...areas, ...(kept ? [kept] : [])].map((a) => chip(a.id, a.label, areaColor(a))).join('') + chip('', '없음', '');
}

/** 활동, 얼마나, 반복. 더하기 폼(add)과 고치기 칸(edit)이 함께 쓴다 */
function extras(draft, field, state) {
  const days = DAY_ORDER.map(
    (d) => `<button type="button" class="seg-btn" data-action="plan-day" data-field="${field}" data-value="${d}" aria-pressed="${draft.days.includes(d)}" aria-label="${DAY_NAMES[d]}요일마다">${DAY_NAMES[d]}</button>`,
  ).join('');
  const minutesField = field === 'add' ? 'plan-minutes' : 'plan-edit-minutes';
  return `<div><div class="scale-head"><span class="scale-label">활동과 이어 두기</span><span class="scale-hint">다 하고 나서 바로 기록할 수 있어요</span></div><div class="chips" role="group" aria-label="활동">${areaChips(draft.areaId, field, state)}</div></div>
    <div><div class="scale-head"><span class="scale-label">얼마나</span></div><label class="suffix-in narrow"><input type="number" inputmode="numeric" min="1" max="${MAX_MINUTES}" data-field="${minutesField}" value="${esc(draft.minutes)}" placeholder="30" aria-label="얼마나(분)"><span aria-hidden="true">분</span></label></div>
    <div><div class="scale-head"><span class="scale-label">반복</span><span class="scale-hint">고른 요일마다 보여요</span></div><div class="days" role="group" aria-label="반복 요일">${days}</div></div>`;
}

/** 시간 칸은 비우기 어려워서 버튼을 둔다. 시간을 고를 때마다 다시 그리지 않도록 hidden만 바꾼다 */
const timeClear = (field, time) => `<button type="button" class="btn small ghost plan-clear" data-action="plan-time-clear" data-field="${field}"${time ? '' : ' hidden'}>시간 빼기</button>`;

function addSummary(draft, state) {
  const parts = [usableArea(draft.areaId, state)?.label, draft.minutes && Number(draft.minutes) > 0 ? fmtHM(Number(draft.minutes)) : '', draft.days.length ? repeatLabel(draft.days) : ''].filter(Boolean);
  return parts.length ? esc(parts.join(' · ')) : '활동 · 얼마나 · 반복';
}

function addForm(where, state) {
  const draft = adds[where];
  return `<form class="plan-add stack" data-form="plan" novalidate>
    <div class="row">
      <label class="field grow"><span>무엇을 할까요</span><input data-field="plan-title" maxlength="60" enterkeyhint="done" placeholder="예: 장보기, 러닝" value="${esc(draft.title)}"></label>
      <label class="field plan-time-in"><span>몇 시에 (선택)</span><input type="time" data-field="plan-time" value="${esc(draft.time)}"></label>
    </div>
    ${timeClear('add', draft.time)}
    <div class="more-line">
      <button type="button" class="more-toggle" data-action="plan-more" aria-expanded="${draft.more}"${draft.more ? ' aria-controls="plan-more-add"' : ''}><span class="more-title">더 정하기</span>${CHEV}<span class="more-hint">${addSummary(draft, state)}</span></button>
      <button type="submit" class="btn primary">더하기</button>
    </div>
    ${draft.more ? `<div class="stack extra" id="plan-more-add">${extras(draft, 'add', state)}</div>` : ''}
  </form>`;
}

function editPanel(plan, item, day, today, state) {
  const p = panel;
  const repeat = !!plan.repeat;
  const dateField =
    !repeat && !plan.done.length
      ? `<label class="field grow"><span>${p.days.length ? '시작하는 날' : '날짜'}</span><input type="date" data-field="plan-edit-date" value="${esc(p.date)}"></label>`
      : '';
  const notes = [
    !repeat && plan.done.length ? '했어요를 풀면 날짜를 옮길 수 있어요.' : '',
    repeat ? '반복하는 모든 날에 바뀌어요. 했어요는 그대로 남아요.' : '',
  ].filter(Boolean);
  let more = '';
  if (!repeat) more = '<button type="button" class="btn small outline" data-action="plan-remove" data-id="' + esc(plan.id) + '">지우기</button>';
  else {
    const here = day === today ? '오늘은' : '이날은';
    const rest =
      item.state === 'todo'
        ? `<button type="button" class="btn small outline" data-action="plan-rest" data-id="${esc(plan.id)}">${here} 쉬어 가요</button>`
        : item.state === 'rest'
          ? `<button type="button" class="btn small outline" data-action="plan-unrest" data-id="${esc(plan.id)}">다시 할래요</button>`
          : '';
    const from = endStart(plan, day, today);
    const when = from === today ? '오늘부터' : from === addDays(today, 1) ? '내일부터' : `${fmtMonthDay(from)}부터`;
    more = `${rest}<button type="button" class="btn small outline" data-action="plan-end" data-id="${esc(plan.id)}">${when} 그만하기</button>`;
  }
  return `<li class="plan-panel" id="plan-panel" tabindex="-1" aria-label="${esc(plan.title)} 고치기">
    <form class="stack" data-form="plan-edit" novalidate>
      <label class="field"><span>무엇을</span><input data-field="plan-edit-title" maxlength="60" enterkeyhint="done" value="${esc(p.title)}"></label>
      <div class="row">
        <label class="field grow"><span>몇 시에 (선택)</span><input type="time" data-field="plan-edit-time" value="${esc(p.time)}"></label>
        ${dateField}
      </div>
      ${timeClear('edit', p.time)}
      ${extras(p, 'edit', state)}
      ${notes.map((n) => `<p class="hint flush">${n}</p>`).join('')}
      <div class="btn-row"><button type="submit" class="btn primary">저장</button><button type="button" class="btn" data-action="plan-close">취소</button></div>
      <div class="btn-row plan-actions">${more}</div>
    </form>
  </li>`;
}

function logPanel(plan, day, state) {
  const area = areaById(plan.areaId, state);
  const feel = area?.kind === 'varies' ? feelChoices(panel.feel ?? lastFeel(area.id, state), 'plan-log-feel', plan.id) : '';
  const loose = area ? looseEntries(state.entries, state.plans, area.id, day) : [];
  const link = loose.length
    ? `<div><p class="hint flush">같은 ${esc(area.label)} 기록을 이미 남겼다면 골라 주세요. 두 번 쌓이지 않아요.</p>
        <div class="chips plan-links">${loose
          .map((e) => `<button type="button" class="chip" data-action="plan-link" data-id="${esc(e.id)}"><span class="chip-text">${esc(e.title || area.label)}</span><span class="chip-side">${fmtHM(e.minutes)}${e.source === 'timer' ? ' · 타이머' : ''}</span></button>`)
          .join('')}</div></div>`
    : '';
  return `<li class="plan-panel" id="plan-panel" tabindex="-1" aria-label="${esc(plan.title)} 기록하기">
    <form class="stack" data-form="plan-log" novalidate>
      <div><div class="scale-head"><span class="scale-label">얼마나 했나요</span></div><label class="suffix-in narrow"><input type="number" inputmode="numeric" min="1" max="${MAX_MINUTES}" data-field="plan-log-minutes" value="${esc(panel.minutes)}" placeholder="30" aria-label="얼마나 했나요(분)"><span aria-hidden="true">분</span></label></div>
      ${feel}
      ${link}
      <div class="btn-row"><button type="submit" class="btn primary">남기기</button><button type="button" class="btn" data-action="plan-close">닫기</button></div>
    </form>
  </li>`;
}

/** 그날의 계획 카드. where는 'today' 또는 'calendar', today는 그릴 때의 오늘, title은 제목을 바꿀 때(달력에서 위에 날짜가 이미 있을 때) */
export function planCard(state, day, { where, today, title = null }) {
  const items = plansOn(state.plans, day);
  const hint = hintFor(items, day, today);
  // 체크를 풀었거나 다른 곳에서 기록을 남겨 기록하기 칸을 그릴 수 없게 되면 닫는다. 남겨 두면 나중에 저절로 다시 열린다
  const mine = panel?.where === where && panel.day === day ? items.find((x) => x.plan.id === panel.id) : null;
  if (panel?.kind === 'log' && panel.where === where && panel.day === day && !(mine && logInfo(mine.plan, day, state, today).can)) panel = null;
  const rows = items
    .map((item) => {
      const row = planRow(item, day, today, state);
      if (panel?.where !== where || panel.day !== day || panel.id !== item.plan.id) return row;
      if (panel.kind === 'edit') return row + editPanel(item.plan, item, day, today, state);
      return logInfo(item.plan, day, state, today).can ? row + logPanel(item.plan, day, state) : row;
    })
    .join('');
  return `<section class="card plan-card" data-plan-where="${where}" data-plan-day="${day}" data-plan-today="${today}" aria-labelledby="plan-head-${where}">
    <div class="card-head"><h2 id="plan-head-${where}" tabindex="-1">${title ?? (day === today ? '오늘 계획' : fmtDay(day))}</h2>${hint ? `<span class="hint">${hint}</span>` : ''}</div>
    ${items.length ? `<ul class="plans">${rows}</ul>` : `<p class="sub">${emptyText(day, today)}</p>`}
    ${addForm(where, state)}
  </section>`;
}

// ---- 이벤트 ----
const cardOf = (e) => e.target.closest?.('[data-plan-where]');
// 저장은 엔터로도 오니 클릭의 detail로 키보드인지 알 수 없다. 손가락·마우스를 마지막으로 쓴 때로 가른다
let pointerAt = 0;
globalThis.addEventListener?.('pointerdown', () => {
  pointerAt = Date.now();
}, true);
export const byKeyboard = () => Date.now() - pointerAt > 1000 && !matchMedia('(pointer: coarse)').matches;

/** 칸을 닫는 동작 뒤 키보드로 쓰던 사람의 포커스를 그 줄로 돌린다. 줄이 없어졌으면 카드 제목으로. 손가락이면 옮기지 않는다(아이폰 포커스 테두리) */
function returnFocus(where, id, keyboard) {
  if (!keyboard) return;
  const card = document.querySelector(`[data-plan-where="${where}"]`);
  (card?.querySelector(`[data-action="plan-edit"][data-id="${CSS.escape(id)}"]`) ?? card?.querySelector('h2'))?.focus({ preventScroll: true });
}
const planOf = (id) => getState().plans.find((p) => p.id === id);
const draftOf = (field, where) => (field === 'edit' ? (panel?.kind === 'edit' ? panel : null) : adds[where]);

/** 칸을 연 뒤 저장 버튼이 탭 막대에 가리지 않게 보이는 곳까지만 내린다. 키보드로 열었으면 칸으로 포커스를 옮긴다 */
function reveal(id, keyboard) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ block: 'nearest', behavior: smooth() });
  if (keyboard) el?.focus({ preventScroll: true });
}

function closePanel(keyboard) {
  const was = panel;
  panel = null;
  refresh();
  if (keyboard && was) document.querySelector(`[data-action="${was.kind === 'log' ? 'plan-log' : 'plan-edit'}"][data-id="${CSS.escape(was.id)}"]`)?.focus({ preventScroll: true });
}

function complain(message) {
  document.activeElement?.blur(); // 키보드를 내려 안내가 가려지지 않게 한다
  toast(message);
}

/** 1~1440분이면 그 수, 비었으면 null, 틀리면 false */
function minutesFrom(value) {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_MINUTES ? n : false;
}

function toggleDay(draft, d, field) {
  if (draft.days.includes(d)) {
    const plan = field === 'edit' ? planOf(panel.id) : null;
    if (plan?.repeat && draft.days.length === 1) return toast("반복을 멈추려면 '그만하기'를 눌러 주세요");
    draft.days = draft.days.filter((x) => x !== d);
  } else draft.days = [...draft.days, d];
  refresh();
}

function onDone(button, day) {
  const { id } = button.dataset;
  const plan = planOf(id);
  if (!plan) return refresh();
  const done = button.getAttribute('aria-pressed') !== 'true';
  const today = todayKey();
  const before = structuredClone(plan);
  const wasAll = day === today && allDone(day);
  setPlanDone(id, day, done);
  if (done) {
    if (day === today && !wasAll && allDone(day)) savedToast('오늘 계획을 다 했어요 🌱');
  } else if (!scheduled(before, day)) savedToast('체크를 풀었어요', { label: '되돌리기', onClick: () => replacePlans([], [before]) }); // 요일을 바꿔서 이날은 다시 체크할 수 없다
  else if (linkedEntry(getState().entries, id, day)) savedToast('체크를 풀었어요. 활동 기록은 그대로예요');
}
function allDone(day) {
  const { total, done } = progress(plansOn(getState().plans, day));
  return total > 0 && done === total;
}

function openPanel(kind, id, card, keyboard) {
  const { planWhere: where, planDay: day } = card.dataset;
  if (panel?.kind === kind && panel.id === id && panel.where === where && panel.day === day) return closePanel(keyboard);
  const plan = planOf(id);
  if (!plan) return refresh();
  panel =
    kind === 'edit'
      ? { kind, where, day, id, title: plan.title, time: plan.time ?? '', date: plan.date, minutes: plan.minutes ? String(plan.minutes) : '', areaId: plan.areaId ?? null, days: plan.repeat?.days ?? [], orig: structuredClone(plan) }
      : { kind, where, day, id, minutes: plan.minutes ? String(plan.minutes) : '', feel: null };
  refresh();
  reveal('plan-panel', keyboard);
}

function onPanelAction(action, id, day, where, keyboard) {
  const plan = planOf(id);
  panel = null;
  if (!plan) return refresh();
  const before = structuredClone(plan);
  const undo = { label: '되돌리기', onClick: () => replacePlans([], [before]) };
  const today = todayKey();
  const here = day === today ? '오늘은' : '이날은';
  if (action === 'plan-remove') {
    replacePlans([id], []);
    savedToast('계획을 지웠어요', undo);
  } else if (action === 'plan-rest') {
    skipPlan(id, day, true);
    savedToast(`${here} 쉬어 가요. 쉬는 것도 계획이에요`, { label: '되돌리기', onClick: () => skipPlan(id, day, false) });
  } else if (action === 'plan-unrest') skipPlan(id, day, false);
  else if (action === 'plan-end') {
    const from = endStart(plan, day, today);
    const result = endPlan(id, from, today);
    const when = from === today ? '오늘부터는' : from === addDays(today, 1) ? '내일부터는' : `${fmtMonthDay(from)}부터는`;
    if (result) savedToast(result === 'removed' ? '계획을 지웠어요' : `${when} 보이지 않아요`, undo);
    else refresh();
  }
  returnFocus(where, id, keyboard);
}

function onClick(e) {
  const card = cardOf(e);
  const button = card && e.target.closest('[data-action]');
  if (!button?.dataset.action.startsWith('plan-')) return false;
  const { action, id, field, value } = button.dataset;
  const { planWhere: where, planDay: day } = card.dataset;
  const keyboard = e.detail === 0; // 손가락이나 마우스가 아니라 키보드로 눌렀으면 0이다
  if (action === 'plan-done') onDone(button, value);
  else if (action === 'plan-edit' || action === 'plan-log') openPanel(action === 'plan-edit' ? 'edit' : 'log', id, card, keyboard);
  else if (action === 'plan-close') closePanel(keyboard);
  else if (action === 'plan-more') {
    adds[where].more = !adds[where].more;
    refresh();
    if (adds[where].more) reveal('plan-more-add', false);
  } else if (action === 'plan-area') {
    const draft = draftOf(field, where);
    if (draft) draft.areaId = value || null;
    refresh();
  } else if (action === 'plan-day') {
    const draft = draftOf(field, where);
    if (draft) toggleDay(draft, Number(value), field);
  } else if (action === 'plan-time-clear') {
    const draft = draftOf(field, where);
    if (draft) draft.time = '';
    refresh();
    // 누른 버튼은 숨으니, 키보드로 눌렀다면 같은 폼의 시간 칸으로 옮긴다
    if (keyboard) document.querySelector(field === 'edit' ? '#plan-panel [data-field="plan-edit-time"]' : `[data-plan-where="${where}"] [data-field="plan-time"]`)?.focus({ preventScroll: true });
  } else if (action === 'plan-log-feel') {
    if (panel?.kind === 'log') panel.feel = value;
    refresh();
  } else if (action === 'plan-link') {
    const plan = panel?.kind === 'log' ? planOf(panel.id) : null;
    panel = null;
    if (!plan) refresh();
    else {
      linkEntry(id, plan.id);
      savedToast('그 기록으로 이어 뒀어요', { label: '되돌리기', onClick: () => unlinkEntry(id, plan.id) });
      returnFocus(where, plan.id, keyboard);
    }
  } else if (['plan-remove', 'plan-rest', 'plan-unrest', 'plan-end'].includes(action)) onPanelAction(action, id, day, where, keyboard);
  return true;
}

// 입력칸은 값만 기억하고 다시 그리지 않는다. 시간·날짜 칸은 고르는 도중에도 change가 온다
const FIELDS = {
  'plan-title': ['add', 'title'],
  'plan-time': ['add', 'time'],
  'plan-minutes': ['add', 'minutes'],
  'plan-edit-title': ['edit', 'title'],
  'plan-edit-time': ['edit', 'time'],
  'plan-edit-date': ['edit', 'date'],
  'plan-edit-minutes': ['edit', 'minutes'],
  'plan-log-minutes': ['log', 'minutes'],
};
function onInput(e) {
  const card = cardOf(e);
  const spot = card && FIELDS[e.target.dataset.field];
  if (!spot) return false;
  const [kind, key] = spot;
  const draft = kind === 'add' ? adds[card.dataset.planWhere] : panel?.kind === kind ? panel : null;
  if (draft) draft[key] = e.target.value;
  if (key === 'time') {
    const clear = e.target.closest('form')?.querySelector('[data-action="plan-time-clear"]');
    if (clear) clear.hidden = !e.target.value;
  }
  return true;
}

function onKeydown(e) {
  if (e.key !== 'Escape' || !panel || !e.target.closest?.('#plan-panel')) return false;
  e.preventDefault();
  closePanel(true);
  return true;
}

function submitAdd(form, card) {
  const { planWhere: where, planDay: day } = card.dataset;
  const draft = adds[where];
  const state = getState();
  const area = usableArea(draft.areaId, state);
  const title = (form.querySelector('[data-field="plan-title"]')?.value ?? draft.title).trim() || area?.label || '';
  if (!title) {
    if (Date.now() - savedAt < 500) return; // 방금 더한 뒤 한 번 더 온 엔터
    return complain('무엇을 할지 적어주세요');
  }
  const minutes = minutesFrom(String(form.querySelector('[data-field="plan-minutes"]')?.value ?? draft.minutes));
  if (minutes === false) return complain(`시간을 1~${MAX_MINUTES}분 사이로 입력해주세요`);
  const time = form.querySelector('[data-field="plan-time"]')?.value ?? draft.time;
  const days = [...draft.days];
  // 다시 그리면 폼이 새 줄만큼 아래로 내려간다. 같은 자리에 두어야 두 번째 탭이 다른 칸을 누르지 않는다
  const top = form.getBoundingClientRect().top;
  adds[where] = emptyAdd(); // addPlan이 곧바로 다시 그리니 먼저 비운다
  document.activeElement?.blur(); // 키보드를 내려 안내가 보이게 한다
  const id = addPlan({ id: uid(), title, date: day, time: time || undefined, minutes: minutes ?? undefined, areaId: area?.id, days });
  savedAt = Date.now();
  const moved = document.querySelector(`[data-plan-where="${where}"] [data-form="plan"]`);
  if (moved) scrollBy(0, moved.getBoundingClientRect().top - top);
  const plan = id && planOf(id);
  if (!plan) return toast('계획을 더하지 못했어요');
  const today = todayKey();
  const next = plan.repeat && !occursOn(plan, day) ? nextOn(plan, day > today ? day : today) : null; // 지난 날을 골라 더해도 '다음'은 오늘부터 찾는다
  savedToast(next ? `${repeatLabel(days)}마다 보여요. 다음은 ${fmtLong(next)}이에요` : `${quoted(title)}더했어요`);
}

function submitEdit(form) {
  if (panel?.kind !== 'edit') return; // 한글 엔터로 두 번 왔다
  const p = panel;
  const plan = planOf(p.id);
  if (!plan) {
    panel = null;
    refresh();
    return toast('다른 곳에서 지운 계획이에요');
  }
  const value = (field) => form.querySelector(`[data-field="${field}"]`)?.value;
  const title = (value('plan-edit-title') ?? p.title).trim();
  if (!title) return complain('무엇을 할지 적어주세요');
  const minutes = minutesFrom(String(value('plan-edit-minutes') ?? p.minutes));
  if (minutes === false) return complain(`시간을 1~${MAX_MINUTES}분 사이로 입력해주세요`);
  const date = value('plan-edit-date');
  if (date !== undefined && !isDay(date)) return complain('날짜를 다시 골라주세요');
  const time = value('plan-edit-time') ?? p.time;
  const areaId = p.areaId && areaById(p.areaId) ? p.areaId : null;
  // 칸을 연 뒤에 바꾼 칸만 고친다. 그사이 다른 창에서 바꾼 다른 칸을 옛 값으로 되돌리지 않게 한다
  const o = p.orig;
  const patch = {};
  if (title !== o.title) patch.title = title;
  if ((time || undefined) !== o.time) patch.time = time || null;
  if ((minutes ?? undefined) !== o.minutes) patch.minutes = minutes;
  if ((areaId ?? undefined) !== o.areaId) patch.areaId = areaId;
  if ([...p.days].sort((a, b) => a - b).join() !== (o.repeat?.days ?? []).join()) patch.days = p.days;
  if (date !== undefined && date !== o.date) patch.date = date;
  const keyboard = byKeyboard();
  panel = null;
  if (!keyboard) document.activeElement?.blur(); // 아이폰 키보드를 내린다
  if (!Object.keys(patch).length || samePlan(plan, patch)) {
    refresh();
    return returnFocus(p.where, p.id, keyboard);
  }
  const before = structuredClone(plan);
  const result = editPlan(p.id, patch);
  if (!result) toast('다른 곳에서 지운 계획이에요');
  else if (result === 'removed') savedToast('남은 날이 없어서 계획을 지웠어요', { label: '되돌리기', onClick: () => replacePlans([], [before]) });
  else {
    const next = planOf(p.id);
    const shownAt = next?.repeat ? nextOn(next, todayKey()) : null;
    if (next && !stateOn(next, p.day)) savedToast(next.repeat ? (shownAt ? `고쳤어요. ${repeatLabel(next.repeat.days)}마다 보여요` : '고쳤어요') : `${fmtMonthDay(next.date)}로 옮겼어요`);
    else savedToast('고쳤어요');
  }
  returnFocus(p.where, p.id, keyboard);
}

function submitLog(form) {
  if (panel?.kind !== 'log') return refresh(); // 그사이 닫힌 칸이 입력 중이라 화면에 남아 있었다
  const p = panel;
  const plan = planOf(p.id);
  const state = getState();
  if (!plan || linkedEntry(state.entries, plan.id, p.day)) {
    panel = null;
    return refresh();
  }
  const area = usableArea(plan.areaId, state);
  if (!area) {
    panel = null;
    refresh();
    return toast('영역이 사라져서 기록하지 못했어요');
  }
  const minutes = minutesFrom(String(form.querySelector('[data-field="plan-log-minutes"]')?.value ?? p.minutes));
  if (!minutes) return complain(`시간을 1~${MAX_MINUTES}분 사이로 입력해주세요`);
  // 화면에 눌려 보이던 값을 남긴다. 묻는 칸을 보지 못했다면(그사이 종류가 바뀌었다면) 붙이지 않는다
  const shown = form.querySelector('.feel [aria-pressed="true"]');
  const feel = area.kind === 'varies' && shown?.dataset.id === plan.id ? shown.dataset.value : undefined;
  const id = uid();
  const keyboard = byKeyboard();
  panel = null;
  if (!keyboard) document.activeElement?.blur();
  addEntry({ id, date: p.day, areaId: area.id, minutes, title: plan.title, feel, planId: plan.id });
  savedToast(`${area.label} ${fmtHM(minutes)} 기록했어요`, { label: '되돌리기', onClick: () => deleteEntry(id) });
  returnFocus(p.where, plan.id, keyboard);
}

function onSubmit(e) {
  const card = cardOf(e);
  const kind = card && e.target.dataset.form;
  if (!kind?.startsWith('plan')) return false;
  e.preventDefault();
  if (kind === 'plan') submitAdd(e.target, card);
  else if (kind === 'plan-edit') submitEdit(e.target);
  else if (kind === 'plan-log') submitLog(e.target);
  return true;
}

/** 처리했으면 true. 카드 밖의 이벤트는 화면에 넘긴다 */
export const planOn = { click: onClick, input: onInput, change: onInput, keydown: onKeydown, submit: onSubmit };
