// 앱 데이터 저장소: 브라우저 localStorage에 저장하고, 바뀌면 구독한 화면에 알린다.
import { fromKey } from './dates.js';
import { applyEdit, endFrom, isHidden, scheduled } from './plans.js';
import { sendToApp, uid } from './util.js';

const KEY = 'growlog:v1';
// 기록 형식. 2부터 영역 종류 varies와 기록의 feel이 있고, 3부터 한 달 체크(monthly)와 계획(plans, 기록의 planId)이 있다. 형식을 바꾸면 sw.js의 '기록 형식' 줄도 고쳐야 새 서비스 워커가 설치되고,
// 옛 코드가 떠 있는 창을 모두 다시 연다. 옛 코드는 모르는 값을 지우고 저장하기 때문이다.
export const VERSION = 3;
export const BAT_ITEMS = 23; // 한 달 체크 문항 수. 바꾸면 저장된 체크가 모두 버려지니, 옮기는 코드를 함께 써야 한다
export const MAX_AREAS = 8;
export const AREA_COLORS = 10; // 영역마다 1~10번 색 가운데 하나를 고른다. 영역끼리는 겹치지 않는다
const COLOR_IDS = Array.from({ length: AREA_COLORS }, (_, i) => i + 1);
// 영역 종류. load: 공부·일처럼 한 시간이 곧 부하. varies: 운동·게임·취미처럼 기록마다 끝나고 어땠는지(feel)를 고른다
export const KINDS = ['load', 'varies'];
export const FEELS = ['fill', 'same', 'drain'];
export const MARK_TAGS = ['일', '공부', '관계', '건강', '기타'];
const ROLES = ['worker', 'student', 'other'];
const AGES = ['adult', 'u18', 'senior'];

export function createDefaultState() {
  return {
    version: VERSION,
    areas: [], // 무엇을 기록할지는 사용자가 직접 만든다
    entries: [], // { id, date, areaId, minutes, title, source: 'manual'|'timer', createdAt, feel?: 'fill'|'same'|'drain', planId? }
    sleep: {}, // 일어난 날짜 → { bed, wake, quality }
    checkins: {}, // 날짜 → { energy, stress, mood, detach, note }
    marks: [], // 지친 날 { id, date, sev, fuzz, tag, closedOn, createdAt } 또는 새 평소 { id, date, rebase, closedOn, createdAt }
    weekly: {}, // 그 주의 월요일 → { built, distance, done, on }
    monthly: {}, // 한 달 체크를 시작한 날 → { a: 23문항의 답(1~5, 아직 안 고른 칸은 null) }
    plans: [], // 계획 { id, title, date, time?, minutes?, areaId?, repeat?: { days, until?, skip }, done, createdAt }
    profile: { role: 'other', age: 'adult', hide: false, monthlyOff: false },
    supportSeen: 0, // 도움 안내를 마지막으로 닫은 시각
    sleepGoal: 7,
    theme: 'dark',
    sample: false,
  };
}

// ---- 검증 ----
// 저장된 값과 백업 파일은 모두 여기를 지나 화면에 쓰이므로, 형식이 틀린 값은 고치거나 버린다.
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const number = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const rating = (v) => (Number.isInteger(v) && v >= 1 && v <= 5 ? v : undefined);
const clock = (v) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : undefined);
function isDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  // Date는 두 자리 연도를 1900년대로 바꾸므로, 윤년만 같은 해로 옮겨 날짜 수를 잰다
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(2000 + y % 400, m, 0)).getUTCDate();
}
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''));

function cleanAreas(list) {
  const seen = new Set();
  const areas = list
    .filter((a) => {
      if (!isMap(a) || typeof a.id !== 'string' || !a.id || !text(a.label, 40).trim() || seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    })
    .slice(0, MAX_AREAS)
    .map((a) => ({
      id: a.id,
      label: text(a.label, 40),
      emoji: text(a.emoji, 16) || '✨',
      goal: Math.min(10080, Math.round(number(a.goal, 0, Number.MAX_VALUE) ?? 0)),
      kind: KINDS.includes(a.kind) || a.kind === 'recovery' ? a.kind : 'load', // 예전 'recovery'는 normalize에서 옮긴다
      color: number(a.color, 1, AREA_COLORS),
      archived: a.archived === true,
      ...(FEELS.includes(a.feel) && { feel: a.feel }), // 기록이 없을 때 끝나고 나니의 처음 값
    }));
  const used = new Set();
  const free = () => COLOR_IDS.find((c) => !used.has(c) && !areas.some((a) => a.color === c));
  for (const area of areas) {
    if (!Number.isInteger(area.color) || used.has(area.color)) area.color = free();
    used.add(area.color);
  }
  return areas;
}

function cleanEntry(e) {
  if (!isMap(e) || !isDate(e.date) || typeof e.areaId !== 'string') return null;
  const minutes = number(e.minutes, 1, Number.MAX_VALUE);
  if (minutes === null) return null;
  const entry = {
    id: typeof e.id === 'string' && e.id ? e.id : uid(),
    date: e.date,
    areaId: e.areaId,
    minutes: Math.min(1440, Math.round(minutes)), // 예전 스톱워치는 하루를 넘겨 기록할 수 있었다. 버리지 않고 하루 한도로 줄인다.
    title: text(e.title, 120),
    source: e.source === 'timer' ? 'timer' : 'manual',
    createdAt: number(e.createdAt, 0, Number.MAX_SAFE_INTEGER) ?? fromKey(e.date).getTime(),
  };
  if (FEELS.includes(e.feel)) entry.feel = e.feel;
  if (shortId(e.planId)) entry.planId = e.planId; // 이 계획에서 남긴 기록. 계획을 지워도 남겨 두어 되돌리면 다시 이어진다. 화면은 지금 있는 계획일 때만 이어진 것으로 본다
  return entry;
}

// ---- 계획 ----
// 깨진 백업을 막는 상한이다. 쓰다가 닿을 일은 없고, 그보다 먼저 저장 공간이 차면 지금처럼 저장 경고가 뜬다.
const MAX_PLANS = 20000;
const MAX_DAYS = 10000; // 계획마다 했어요·쉬어 가요 날짜 수. 매일 반복해도 27년
const shortId = (v) => (typeof v === 'string' && v.length >= 1 && v.length <= 64 ? v : undefined);
const dateSet = (v) => (Array.isArray(v) ? [...new Set(v.filter(isDate))].sort().slice(-MAX_DAYS) : []);

function cleanPlan(p) {
  if (!isMap(p) || !isDate(p.date)) return null;
  const title = text(p.title, 60).trim();
  if (!title) return null;
  const { date } = p;
  const done = dateSet(p.done).filter((d) => d >= date);
  let repeat;
  if (isMap(p.repeat) && Array.isArray(p.repeat.days)) {
    const days = [...new Set(p.repeat.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    let until = isDate(p.repeat.until) ? p.repeat.until : undefined;
    if (until && until < date) until = date; // 끝낸 계획이 끝없는 반복으로 되살아나지 않게 첫날까지로 둔다
    // 같은 날이 했어요와 쉬어 가요 둘 다면 했어요를 남긴다
    if (days.length) repeat = compact({ days, until, skip: dateSet(p.repeat.skip).filter((d) => d >= date && (!until || d <= until) && !done.includes(d)) });
  }
  const minutes = number(p.minutes, 1, 1440);
  return compact({
    id: shortId(p.id) ?? uid(),
    title,
    date,
    time: clock(p.time),
    minutes: minutes === null ? undefined : Math.round(minutes),
    areaId: shortId(p.areaId), // 그 영역이 지금 없어도 남긴다
    repeat,
    done: repeat ? done : done.filter((d) => d === date), // 반복이면 요일을 바꿨어도 해낸 날은 남긴다
    createdAt: number(p.createdAt, 0, Number.MAX_SAFE_INTEGER) ?? fromKey(date).getTime(),
  });
}

function cleanPlans(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(); // 같은 id가 다시 나오면 뒤엣것을 버린다
  return list
    .map(cleanPlan)
    .filter((p) => p && !seen.has(p.id) && seen.add(p.id))
    .slice(0, MAX_PLANS);
}

/** 예전에는 영역마다 '에너지를 채워요'를 정해뒀다. 그 영역은 그때그때 다른 일이 되고, 그동안의 기록과 앞으로의 처음 값은 채워졌어요로 친다. */
function migrateRecovery(areas, entries) {
  const filled = new Set(areas.filter((a) => a.kind === 'recovery').map((a) => a.id));
  for (const area of areas) if (area.kind === 'recovery') Object.assign(area, { kind: 'varies', feel: area.feel ?? 'fill' });
  for (const entry of entries) if (filled.has(entry.areaId) && !entry.feel) entry.feel = 'fill';
  return { areas, entries };
}

function cleanMark(m) {
  if (!isMap(m) || !isDate(m.date)) return null;
  const base = {
    id: typeof m.id === 'string' && m.id ? m.id : uid(),
    date: m.date,
    closedOn: isDate(m.closedOn) ? m.closedOn : undefined,
    createdAt: number(m.createdAt, 0, Number.MAX_SAFE_INTEGER) ?? fromKey(m.date).getTime(),
  };
  if (m.rebase === true) return compact({ ...base, rebase: true });
  if (![1, 2, 3].includes(m.sev)) return null;
  return compact({ ...base, sev: m.sev, fuzz: [3, 7].includes(m.fuzz) ? m.fuzz : 0, tag: MARK_TAGS.includes(m.tag) ? m.tag : undefined });
}

/** 한 달 체크는 답만 남긴다. 문항 수가 다르거나 하나도 답하지 않은 기록은 버린다 */
function cleanMonthly(map) {
  if (!isMap(map)) return {};
  return Object.fromEntries(
    Object.entries(map)
      .filter(([date, value]) => isDate(date) && isMap(value) && Array.isArray(value.a) && value.a.length === BAT_ITEMS)
      .map(([date, value]) => [date, { a: value.a.map((x) => rating(x) ?? null) }])
      .filter(([, value]) => value.a.some((x) => x !== null)),
  );
}

const cleanProfile = (p) => ({
  role: ROLES.includes(p?.role) ? p.role : 'other',
  age: AGES.includes(p?.age) ? p.age : 'adult',
  hide: p?.hide === true,
  monthlyOff: p?.monthlyOff === true,
});

function cleanByDate(map, clean) {
  if (!isMap(map)) return {};
  return Object.fromEntries(
    Object.entries(map)
      .filter(([date, value]) => isDate(date) && isMap(value))
      .map(([date, value]) => [date, compact(clean(value))])
      .filter(([, value]) => Object.keys(value).length),
  );
}

export function normalize(data) {
  const base = createDefaultState();
  if (!isMap(data)) return base;
  const { areas, entries } = migrateRecovery(Array.isArray(data.areas) ? cleanAreas(data.areas) : base.areas, Array.isArray(data.entries) ? data.entries.map(cleanEntry).filter(Boolean) : []);
  return {
    version: VERSION,
    areas,
    entries,
    sleep: cleanByDate(data.sleep, (n) => ({ bed: clock(n.bed), wake: clock(n.wake), quality: rating(n.quality) })),
    checkins: cleanByDate(data.checkins, (c) => ({ energy: rating(c.energy), stress: rating(c.stress), mood: rating(c.mood), detach: rating(c.detach), note: text(c.note, 200) })),
    marks: Array.isArray(data.marks) ? data.marks.map(cleanMark).filter(Boolean) : [],
    weekly: cleanByDate(data.weekly, (w) => ({ built: rating(w.built), distance: rating(w.distance), done: rating(w.done), on: isDate(w.on) ? w.on : undefined })),
    monthly: cleanMonthly(data.monthly),
    plans: cleanPlans(data.plans),
    profile: cleanProfile(data.profile),
    supportSeen: number(data.supportSeen, 0, Number.MAX_SAFE_INTEGER) ?? 0,
    sleepGoal: number(data.sleepGoal, 4, 12) ?? base.sleepGoal,
    theme: ['light', 'auto'].includes(data.theme) ? data.theme : 'dark', // 예전의 'system'은 다크로 옮긴다
    sample: data.sample === true,
  };
}

/** 이 코드보다 새 형식이면 읽고 저장하면서 모르는 값을 지우게 되니 건드리지 않는다 */
export const isNewer = (data) => isMap(data) && Number.isInteger(data.version) && data.version > VERSION;
export const isBackup = (data) => !isNewer(data) && isMap(data) && Array.isArray(data.areas) && Array.isArray(data.entries) && (cleanAreas(data.areas).length > 0 || data.areas.length === 0);

// ---- 읽기·쓰기 ----
/** 저장소를 읽지 못하면 undefined, 기록이 없거나 깨졌으면 null. 둘을 구분해야 일시적인 오류로 기록을 덮어쓰지 않는다. */
function read() {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return undefined;
  }
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    newerOnDisk = isNewer(parsed);
    if (newerOnDisk) return undefined; // 더 새 버전 앱이 남긴 기록이다. 덮어쓰지 않도록 읽지 못한 것으로 둔다
    const data = parsed ? normalize(parsed) : null;
    if (data) lastGood = raw;
    return data;
  } catch {
    newerOnDisk = false;
    return null;
  }
}

/** 지우기처럼 되돌릴 수 없는 일은 진짜 기록을 읽을 수 있을 때만 한다. 못 읽을 때 보이는 화면은 기본값이다. */
export function canRead() {
  if (read() === undefined) return false;
  retrySave(); // 방금 읽을 수 있게 됐다면 기본값이 아니라 진짜 기록을 보고 판단하게 한다
  return true;
}

function storageWorks() {
  try {
    localStorage.setItem(`${KEY}:probe`, '1');
    localStorage.removeItem(`${KEY}:probe`);
    return true;
  } catch {
    return false;
  }
}

let lastGood = null; // 마지막으로 읽거나 쓴 기록. 알림 없이 기록이 사라져도 메모리의 기록을 버리지 않게 한다.
let newerOnDisk = false; // 더 새 버전 앱이 남긴 기록이 있어서 읽지도 덮어쓰지도 않는 중
const stored = read();
let state = stored ?? createDefaultState();
let saveFailed = stored === undefined || !storageWorks();
let pending = []; // 저장하지 못한 변경. 전체를 덮어쓰지 않고, 저장소가 돌아오면 그때의 최신 값 위에 다시 적용한다.
const listeners = new Set();

export const getState = () => state;
export const hasSaveFailed = () => saveFailed;
export const hasNewerData = () => newerOnDisk;
/** 저장된 글 그대로. 더 새 버전의 기록은 화면에 보이는 빈 기본값 대신 이것을 백업해야 잃지 않는다 */
export function storedText() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = (quiet, background) => listeners.forEach((fn) => fn(state, { quiet, background }));

/** 다른 탭이나 설치한 앱이 먼저 저장했을 수 있으니, 저장된 최신 값 위에 밀린 변경을 얹어 저장한다. 저장소를 읽지 못하면 false */
function sync() {
  const disk = read();
  if (disk === undefined) {
    saveFailed = true;
    return false;
  }
  const base = disk ?? (lastGood ? normalize(JSON.parse(lastGood)) : createDefaultState());
  state = pending.reduce((s, mutate) => mutate(s) ?? s, base);
  if (!pending.length) {
    if (saveFailed) saveFailed = !storageWorks();
    return true;
  }
  try {
    const json = JSON.stringify(state);
    localStorage.setItem(KEY, json);
    sendToApp({ save: json }); // 아이폰 앱은 OS가 웹 저장소를 비워도 되살리도록 파일로도 남긴다
    lastGood = json;
    pending = [];
    saveFailed = false;
  } catch {
    saveFailed = true;
  }
  return true;
}

/** 저장소가 돌아왔을 수 있으니, 앱으로 돌아올 때 못 한 저장을 다시 해본다 */
export function retrySave() {
  if (!saveFailed) return;
  sync();
  if (!saveFailed) notify(false, true);
}

/**
 * quiet: 입력칸처럼 화면을 다시 그리면 포커스가 날아가는 곳에서 쓴다.
 * background: 타이머처럼 사용자가 누르지 않았는데 일어난 변경. 입력 중이면 화면을 나중에 그린다.
 */
function commit(mutate, { quiet = false, background = false } = {}) {
  pending.push(mutate);
  if (!sync()) state = mutate(state) ?? state; // 읽지도 못하는 동안에는 화면에만 반영한다
  notify(quiet, background);
}

globalThis.addEventListener?.('storage', (e) => {
  if (e.key !== KEY && e.key !== null) return; // null이면 저장소 전체가 지워진 것
  if (e.newValue === null) lastGood = null;
  if (sync() || newerOnDisk) notify(false, true); // 다른 창이 더 새 버전으로 저장했다면 경고를 바로 띄운다
});

// ---- 조회 ----
export const activeAreas = (s = state) => s.areas.filter((a) => !a.archived);
export const areaById = (id, s = state) => s.areas.find((a) => a.id === id);

// ---- 활동 기록 ----
/** 기록을 남기고 id를 돌려준다. feel은 그때그때 다른 일에만 붙인다. */
export function addEntry({ id = uid(), date, areaId, minutes, title = '', source = 'manual', createdAt = Date.now(), feel, planId }, opts) {
  // 저장에 실패하면 다시 적용될 수 있으니 id는 변경 밖에서 정한다
  const entry = { id, date, areaId, minutes: Math.round(minutes), title: title.trim(), source, createdAt, ...(FEELS.includes(feel) && { feel }), ...(shortId(planId) && { planId }) };
  commit((s) => void s.entries.push({ ...entry }), opts);
  return entry.id;
}
export const setEntryFeel = (id, feel) =>
  commit((s) => {
    const entry = s.entries.find((e) => e.id === id);
    if (entry && FEELS.includes(feel)) entry.feel = feel;
  });
/** 그 영역에서 마지막으로 고른 끝나고 나니. 처음이면 영역의 처음 값, 그것도 없으면 계산에 넣지 않는 그대로예요 */
export function lastFeel(areaId, s = state) {
  let last = null;
  for (const e of s.entries) if (e.areaId === areaId && e.feel && (!last || e.createdAt >= last.createdAt)) last = e;
  return last?.feel ?? areaById(areaId, s)?.feel ?? 'same';
}
export const restoreEntry = (entry) =>
  commit((s) => {
    if (!s.entries.some((e) => e.id === entry.id)) s.entries.push(entry);
  });
export const deleteEntry = (id) =>
  commit((s) => {
    s.entries = s.entries.filter((e) => e.id !== id);
  });

// ---- 컨디션·수면 ----
export const setCheckin = (date, patch, opts) =>
  commit((s) => {
    s.checkins[date] = { ...s.checkins[date], ...patch };
  }, opts);
export const setSleep = (date, patch, opts) =>
  commit((s) => {
    s.sleep[date] = { ...s.sleep[date], ...patch };
  }, opts);

// ---- 지친 날·돌아보기 ----
export function addMark({ date, sev, fuzz, tag, closedOn }) {
  const mark = compact({ id: uid(), date, sev, fuzz, tag, closedOn, createdAt: Date.now() });
  commit((s) => void s.marks.push({ ...mark }));
}
export const restoreMarks = (marks) => commit((s) => void s.marks.push(...marks));
export const deleteMarks = (ids) =>
  commit((s) => {
    s.marks = s.marks.filter((m) => !ids.includes(m.id));
  });
export const closeMarks = (ids, date) =>
  commit((s) => {
    for (const mark of s.marks) if (ids.includes(mark.id) && !mark.closedOn) mark.closedOn = date;
  });
export const reopenMarks = (ids) =>
  commit((s) => {
    for (const mark of s.marks) if (ids.includes(mark.id)) delete mark.closedOn;
  });
/** 요즘을 새로운 평소로 삼는다. 이튿날부터 평소를 새로 계산한다. */
export function addRebase(date) {
  const mark = { id: uid(), date, rebase: true, closedOn: date, createdAt: Date.now() };
  commit((s) => void s.marks.push({ ...mark }));
}
export const setWeekly = (week, patch) =>
  commit((s) => {
    s.weekly[week] = { ...s.weekly[week], ...patch };
  });
/** 한 달 체크의 한 문항에 답한다. date는 화면이 고른 기록의 날짜다. 새 기록을 만들 때는 끝내지 못하고 남은 기록을 지운다 */
export const setMonthly = (date, index, value) =>
  commit((s) => {
    if (!isDate(date) || !Number.isInteger(index) || index < 0 || index >= BAT_ITEMS || !rating(value)) return;
    if (!s.monthly[date]) for (const [key, check] of Object.entries(s.monthly)) if (check.a.includes(null)) delete s.monthly[key];
    const a = [...(s.monthly[date]?.a ?? Array(BAT_ITEMS).fill(null))];
    a[index] = value;
    s.monthly[date] = { a };
  });

// ---- 계획 ----
// 저장하지 못하면 변경 함수가 디스크의 최신 값 위에 다시 적용되므로, 뒤집지 않고 목표 값을 받고 같은 id는 두 번 넣지 않는다.
const planById = (s, id) => s.plans.find((p) => p.id === id);

/** 계획을 더하고 id를 돌려준다. 제목이나 날짜가 틀리면 null */
export function addPlan({ id = uid(), title, date, time, minutes, areaId, days = [], createdAt = Date.now() }) {
  const plan = cleanPlan({ id, title, date, time, minutes, areaId, repeat: days.length ? { days, skip: [] } : undefined, done: [], createdAt });
  if (!plan) return null;
  commit((s) => {
    if (!planById(s, plan.id)) s.plans.push(structuredClone(plan));
  });
  return planById(state, plan.id) ? plan.id : null;
}
/** 그날 했어요(done = true) 또는 풀기. 잡힌 날에만 체크한다. 쉬어 가요였던 날을 체크하면 쉬기를 푼다 */
export const setPlanDone = (id, day, done) =>
  commit((s) => {
    const plan = planById(s, id);
    if (!plan || !isDate(day)) return;
    if (!done) {
      plan.done = plan.done.filter((d) => d !== day);
      if (isHidden(plan)) s.plans = s.plans.filter((p) => p !== plan); // 끝낸 계획의 마지막 했어요를 풀어 어디에도 보이지 않게 됐다
    } else if (!plan.done.includes(day) && scheduled(plan, day)) {
      plan.done = [...plan.done, day].sort();
      if (plan.repeat) plan.repeat.skip = plan.repeat.skip.filter((d) => d !== day);
    }
  });
/** 반복 계획의 그날을 쉬어 가요(skip = true) 또는 다시 할래요 */
export const skipPlan = (id, day, skip) =>
  commit((s) => {
    const plan = planById(s, id);
    if (!plan?.repeat || !isDate(day)) return;
    if (!skip) plan.repeat.skip = plan.repeat.skip.filter((d) => d !== day);
    else if (!plan.repeat.skip.includes(day) && scheduled(plan, day)) {
      plan.repeat.skip = [...plan.repeat.skip, day].sort();
      plan.done = plan.done.filter((d) => d !== day);
    }
  });
/**
 * 계획을 고친다(plans.js applyEdit). 고친 값이 틀리면 그대로 둔다.
 * 끝낸 계획의 요일을 바꿔 어느 날에도 보이지 않게 되면 지운다. 'edited', 'removed', 또는 계획이 없으면 null
 */
export function editPlan(id, patch) {
  if (!planById(state, id)) return null;
  commit((s) => {
    const i = s.plans.findIndex((p) => p.id === id);
    const next = i < 0 ? null : cleanPlan(applyEdit(s.plans[i], patch));
    if (next && isHidden(next)) s.plans.splice(i, 1);
    else if (next) s.plans[i] = next;
  });
  return planById(state, id) ? 'edited' : 'removed';
}
/** 반복 계획을 from 전날까지만 남긴다(plans.js endFrom). 남길 날이 없으면 지운다. 'ended', 'removed', 또는 계획이 없으면 null */
export function endPlan(id, from, today) {
  if (!planById(state, id) || !isDate(from) || !isDate(today)) return null;
  commit((s) => {
    const i = s.plans.findIndex((p) => p.id === id);
    if (i < 0) return;
    const next = endFrom(s.plans[i], from, today);
    const clean = next && cleanPlan(next);
    if (clean) s.plans[i] = clean;
    else s.plans.splice(i, 1);
  });
  return planById(state, id) ? 'ended' : 'removed';
}
/** removeIds를 지우고 plans를 id로 바꿔 끼우거나 넣는다. 지우기는 replacePlans([id], []), 되돌리기는 replacePlans([], [그때 값]) */
export const replacePlans = (removeIds, plans) =>
  commit((s) => {
    s.plans = s.plans.filter((p) => !removeIds.includes(p.id));
    for (const plan of plans) {
      const i = s.plans.findIndex((p) => p.id === plan.id);
      if (i < 0) s.plans.push(structuredClone(plan));
      else s.plans[i] = structuredClone(plan);
    }
  });
/** 이미 남긴 활동 기록을 계획과 잇는다. 지금 있는 다른 계획과 이어진 기록은 건드리지 않는다 */
export const linkEntry = (entryId, planId) =>
  commit((s) => {
    const entry = s.entries.find((e) => e.id === entryId);
    if (entry && shortId(planId) && (!entry.planId || entry.planId === planId || !planById(s, entry.planId))) entry.planId = planId;
  });
export const unlinkEntry = (entryId, planId) =>
  commit((s) => {
    const entry = s.entries.find((e) => e.id === entryId);
    if (entry?.planId === planId) delete entry.planId;
  });

export const setProfile = (patch, opts) =>
  commit((s) => {
    s.profile = { ...s.profile, ...patch };
  }, opts);
export const setSupportSeen = () =>
  commit((s) => {
    s.supportSeen = Date.now();
  });

// ---- 활동 영역 ----
export const canAddArea = (s = state) => s.areas.length < MAX_AREAS;

/** 다른 영역이 쓰지 않는 색. except 영역의 지금 색은 비어 있는 것으로 본다 */
export const freeColors = (s = state, except = null) => COLOR_IDS.filter((c) => !s.areas.some((a) => a.color === c && a.id !== except));

/** 새 영역을 만들고 id를 돌려준다. 자리가 없으면 null */
export function addArea({ label, emoji = '✨', goal = 0, kind = 'load', color }) {
  if (!KINDS.includes(kind)) kind = 'load';
  if (!canAddArea()) return null;
  const id = uid();
  commit((s) => {
    const free = freeColors(s);
    if (s.areas.length < MAX_AREAS && free.length) s.areas.push({ id, label, emoji, goal, kind, color: free.includes(color) ? color : free[0], archived: false });
  });
  return areaById(id) ? id : null;
}
/** 색은 다른 영역이 쓰고 있지 않을 때만 바꾼다 */
export const updateArea = (id, { color, ...patch }, opts) =>
  commit((s) => {
    const area = areaById(id, s);
    if (!area) return;
    if (patch.kind !== undefined && !KINDS.includes(patch.kind)) delete patch.kind;
    Object.assign(area, patch);
    if (color !== undefined && freeColors(s, id).includes(color)) area.color = color;
  }, opts);
export const removeArea = (id) =>
  commit((s) => {
    s.areas = s.areas.filter((a) => a.id !== id);
    s.entries = s.entries.filter((e) => e.areaId !== id);
    for (const plan of s.plans) if (plan.areaId === id) delete plan.areaId; // 계획은 남기고 연결만 뗀다
  });

// ---- 설정·데이터 ----
export const setSleepGoal = (hours, opts) =>
  commit((s) => {
    s.sleepGoal = hours;
  }, opts);
export const setTheme = (theme) =>
  commit((s) => {
    s.theme = theme;
  });
export function replaceState(data) {
  const next = normalize(data);
  commit(() => structuredClone(next));
}
/** keepTheme: 기록만 비우는 경우. 고른 화면 테마까지 몰래 되돌리지 않는다. */
export const resetState = ({ keepTheme = false } = {}) => commit((s) => ({ ...createDefaultState(), ...(keepTheme && { theme: s.theme }) }));
