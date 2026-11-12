// 계획: 그날 할 일, 몇 시에 할 일, 요일마다 반복하는 일. 저장소와 화면을 모르는 순수 함수만 둔다.
// 계획은 마음먹은 것이고 활동 기록은 실제로 한 것이다. 계획은 쌓인 부하 계산에 들어가지 않는다.
// 반복 계획을 고치면 모든 날이 함께 바뀐다. 날마다의 했어요(done)와 쉬어 가요(repeat.skip)는 날짜로 남아 그대로다.
import { addDays, fromKey } from './dates.js';

export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 화면에 놓는 순서. 이번 주 목표처럼 월요일부터
export const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
export const dayNum = (day) => fromKey(day).getDay();

/** 잡힌 날인지. 쉬어 가요는 따지지 않는다 */
export function scheduled(plan, day) {
  if (!plan.repeat) return day === plan.date;
  const { days, until } = plan.repeat;
  return plan.date <= day && (!until || day <= until) && days.includes(dayNum(day));
}

/** 그날 할 일인지. 잡힌 날이고 쉬어 가요가 아니다 */
export const occursOn = (plan, day) => scheduled(plan, day) && !plan.repeat?.skip.includes(day);

/**
 * 그날의 상태. 했어요를 누른 날은 잡힌 날이 아니어도 'done'이다. 요일을 바꾸거나 그만둬도 해낸 날은 남는다.
 * 잡힌 날이면 쉬어 가요는 'rest', 아니면 'todo'. 그 밖은 null
 */
export function stateOn(plan, day) {
  if (plan.done.includes(day)) return 'done';
  if (!scheduled(plan, day)) return null;
  return plan.repeat?.skip.includes(day) ? 'rest' : 'todo';
}

/** 시간이 있는 것을 먼저 시간순으로, 그다음 시간 없는 것. 상태가 바뀌어도 순서는 그대로다(누른 줄이 손가락 아래에서 옮겨 가지 않게) */
export function byTime(a, b) {
  if (a.time !== b.time) {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : 1;
  }
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** 그날 보이는 계획과 상태 */
export const plansOn = (plans, day) =>
  plans
    .map((plan) => ({ plan, state: stateOn(plan, day) }))
    .filter((x) => x.state)
    .sort((a, b) => byTime(a.plan, b.plan));

/** 쉬어 가요는 세지 않는다 */
export function progress(items) {
  const counted = items.filter((x) => x.state !== 'rest');
  return { total: counted.length, done: counted.filter((x) => x.state === 'done').length };
}

/** from부터 처음으로 할 일인 날. 끝났거나 400일 안에 없으면 null */
export function nextOn(plan, from, limit = 400) {
  let day = plan.date > from ? plan.date : from;
  for (let i = 0; i < limit; i++, day = addDays(day, 1)) {
    if (plan.repeat?.until && day > plan.repeat.until) return null;
    if (occursOn(plan, day)) return day;
    if (!plan.repeat) return null;
  }
  return null;
}

// ---- 달력 ----
export const monthOf = (day) => day.slice(0, 7);
/** 'YYYY-MM'에 n달을 더한다. 저장소가 네 자리 연도만 받으니 그 안으로 묶는다 */
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const total = Math.min(9999 * 12 + 11, Math.max(1000 * 12, y * 12 + (m - 1) + n));
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}
/** 월요일부터 시작하는 주의 목록. 달 밖의 칸은 null */
export function monthKeys(month) {
  const first = `${month}-01`;
  const days = [];
  for (let day = first; monthOf(day) === month; day = addDays(day, 1)) days.push(day);
  const cells = [...Array((dayNum(first) + 6) % 7).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

const DOTS = 3;
/**
 * 달력 칸에 쓸 요약. 날짜 → { total, done, dots, more }. dots는 { areaId, done }이고 앞에서 3개까지다.
 * 지난 날은 했어요만 점으로 그린다. 안 한 것을 못 한 날처럼 보이게 하지 않는다. 쉬어 가요는 점이 없다.
 * 쉬어 가요를 빼고 보이는 계획이 없는 날은 키가 없다.
 */
export function monthSummary(plans, month, today) {
  const map = new Map();
  for (const day of monthKeys(month).flat()) {
    if (!day) continue;
    const items = plansOn(plans, day).filter((x) => x.state !== 'rest');
    if (!items.length) continue;
    const shown = day < today ? items.filter((x) => x.state === 'done') : items;
    map.set(day, {
      total: items.length,
      done: items.filter((x) => x.state === 'done').length,
      dots: shown.slice(0, DOTS).map((x) => ({ areaId: x.plan.areaId ?? null, done: x.state === 'done' })),
      more: shown.length > DOTS,
    });
  }
  return map;
}

// ---- 화면에 쓰는 말 ----
/** 요일 목록 → '매일', '평일', '주말', '월요일', '월·수·금'. 하나면 '월마다'가 매달로 읽히지 않게 요일까지 쓴다 */
export function repeatLabel(days) {
  const set = new Set(days);
  if (set.size === 7) return '매일';
  if (set.size === 1) return `${DAY_NAMES[[...set][0]]}요일`;
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return '평일';
  if (set.size === 2 && set.has(0) && set.has(6)) return '주말';
  return DAY_ORDER.filter((d) => set.has(d)).map((d) => DAY_NAMES[d]).join('·');
}

/** 'HH:MM' → '오전 7시', '오후 7시 5분', '낮 12시', '밤 12시', '새벽 1시'. 틀린 값이면 '' */
export function clockLabel(hhmm) {
  if (typeof hhmm !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const part = h === 0 ? '밤' : h < 6 ? '새벽' : h === 12 ? '낮' : h < 12 ? '오전' : '오후';
  return `${part} ${h % 12 || 12}시${m ? ` ${m}분` : ''}`;
}

// ---- 활동 기록과 잇기 ----
const LOG_DAYS = 29; // 활동 기록 폼처럼 오늘부터 30일 안에서만 남긴다

/** 이 계획에서 그날 남긴 기록 */
export const linkedEntry = (entries, planId, day) => entries.find((e) => e.planId === planId && e.date === day);

/** 기록이 지금 있는 계획과 이어져 있는지. 지운 계획을 가리키는 기록은 이어지지 않은 것으로 본다 */
export const isLinked = (entry, plans) => !!entry.planId && plans.some((p) => p.id === entry.planId);

/** 그날 그 영역 기록 가운데 아직 어느 계획과도 잇지 않은 것. 최근 것부터 */
export const looseEntries = (entries, plans, areaId, day, max = 3) =>
  entries
    .filter((e) => e.date === day && e.areaId === areaId && !isLinked(e, plans))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, max);

/** 이어 둔 기록이 있으면 { entry }, 했어요인데 아직 기록하지 않았고 남길 수 있으면 { can: true }, 그 밖은 {} */
export function logInfo(plan, day, { areas, entries }, today) {
  const entry = linkedEntry(entries, plan.id, day);
  if (entry) return { entry };
  const area = plan.areaId && areas.find((a) => a.id === plan.areaId);
  const inRange = day <= today && day >= addDays(today, -LOG_DAYS);
  return stateOn(plan, day) === 'done' && area && !area.archived && inRange ? { can: true } : {};
}

// ---- 고치기와 그만하기 ----
const OPTIONAL = ['time', 'minutes', 'areaId'];
const sortedDays = (days) => [...new Set(days)].sort((a, b) => a - b);

/** 고칠 값이 지금과 모두 같으면 true. null과 없는 칸은 같다고 본다 */
export function samePlan(plan, patch) {
  if (patch.title !== undefined && patch.title !== plan.title) return false;
  for (const key of OPTIONAL) if (patch[key] !== undefined && (patch[key] ?? undefined) !== plan[key]) return false;
  if (patch.days?.length && sortedDays(patch.days).join() !== (plan.repeat?.days ?? []).join()) return false;
  if (!plan.repeat && patch.date !== undefined && patch.date !== plan.date) return false;
  return true;
}

/**
 * 계획을 고친 새 값. 반복 계획은 모든 날이 함께 바뀐다.
 * patch: title, time·minutes·areaId(null이면 뺀다), days(반복 요일), date(한 번짜리만).
 * 반복은 요일을 0개로 만들 수 없고(그만하기로 멈춘다), 시작한 날도 바꾸지 않는다.
 * 한 번짜리는 했어요인 동안 날짜를 옮기지 않는다. 요일을 고르면 그 날짜부터 반복이 된다.
 */
export function applyEdit(plan, patch) {
  const next = structuredClone(plan);
  if (patch.title !== undefined) next.title = patch.title;
  for (const key of OPTIONAL) {
    if (patch[key] === null) delete next[key];
    else if (patch[key] !== undefined) next[key] = patch[key];
  }
  const days = patch.days?.length ? sortedDays(patch.days) : null;
  if (next.repeat) {
    if (days) next.repeat.days = days;
  } else {
    if (patch.date !== undefined && !plan.done.length) next.date = patch.date;
    if (days) next.repeat = { days, skip: [] };
  }
  return next;
}

/** 그만하기를 시작할 날. 본 날과 오늘 가운데 늦은 날이고, 그날 이미 했어요면 다음 날부터 그만둔다(오늘 한 것은 오늘 목록에 남는다) */
export function endStart(plan, day, today) {
  const from = day > today ? day : today;
  return plan.done.includes(from) ? addDays(from, 1) : from;
}

/** first부터 last까지(둘 다 포함) 잡힌 날이 있는지. 요일 반복이라 7일만 보면 된다 */
function hasScheduled(plan, first, last) {
  for (let i = 0, day = first; i < 7 && day <= last; i++, day = addDays(day, 1)) if (scheduled(plan, day)) return true;
  return false;
}

/** 끝낸 반복인데 했어요도 잡힌 날도 없어서 어느 날에도 보이지 않는 계획. 고치거나 지울 길이 없으니 남기지 않는다 */
export const isHidden = (plan) => !!plan.repeat?.until && !plan.done.length && !hasScheduled(plan, plan.date, plan.repeat.until);

/**
 * from 전날까지만 남긴 반복 계획. 했어요는 지우지 않는다.
 * 한 번도 했어요를 누르지 않았고 오늘부터 from 전날까지 잡힌 날도 없으면 남길 것이 없으니 null(통째로 지운다).
 * 한 번짜리는 from 전의 계획이면 그대로, 아니면 null이다.
 */
export function endFrom(plan, from, today) {
  if (!plan.repeat) return plan.date < from ? plan : null;
  const last = addDays(from, -1);
  if (!plan.done.length && !hasScheduled(plan, plan.date > today ? plan.date : today, last)) return null;
  let until = plan.repeat.until && plan.repeat.until < last ? plan.repeat.until : last;
  if (until < plan.date) until = plan.date;
  return { ...plan, repeat: { ...plan.repeat, until, skip: plan.repeat.skip.filter((d) => d <= until) } };
}
