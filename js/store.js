// 앱 데이터 저장소: 브라우저 localStorage에 저장하고, 바뀌면 구독한 화면에 알린다.
import { fromKey } from './dates.js';
import { sendToApp, uid } from './util.js';

const KEY = 'growlog:v1';
export const MAX_AREAS = 6; // 색 1~6번은 활동 영역, 7번은 수면에 고정
export const MARK_TAGS = ['일', '공부', '관계', '건강', '기타'];
const ROLES = ['worker', 'student', 'other'];
const AGES = ['adult', 'u18', 'senior'];

const DEFAULT_AREAS = [
  { id: 'exercise', label: '운동', emoji: '🏃', goal: 150, kind: 'recovery', color: 1 },
  { id: 'study', label: '공부', emoji: '📚', goal: 420, kind: 'load', color: 2 },
  { id: 'dev', label: '개발', emoji: '💻', goal: 600, kind: 'load', color: 3 },
];

export function createDefaultState() {
  return {
    version: 1,
    areas: DEFAULT_AREAS.map((a) => ({ ...a, archived: false })),
    entries: [], // { id, date, areaId, minutes, title, source: 'manual'|'timer', createdAt }
    sleep: {}, // 일어난 날짜 → { bed, wake, quality }
    checkins: {}, // 날짜 → { energy, stress, mood, detach, note }
    marks: [], // 지친 날 { id, date, sev, fuzz, tag, closedOn, createdAt } 또는 새 평소 { id, date, rebase, closedOn, createdAt }
    weekly: {}, // 그 주의 월요일 → { built, distance, done, on }
    profile: { role: 'other', age: 'adult', hide: false },
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
      kind: a.kind === 'recovery' ? 'recovery' : 'load',
      color: number(a.color, 1, MAX_AREAS),
      archived: a.archived === true,
    }));
  const used = new Set();
  const free = () => [1, 2, 3, 4, 5, 6].find((c) => !used.has(c) && !areas.some((a) => a.color === c));
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
  return {
    id: typeof e.id === 'string' && e.id ? e.id : uid(),
    date: e.date,
    areaId: e.areaId,
    minutes: Math.min(1440, Math.round(minutes)), // 예전 스톱워치는 하루를 넘겨 기록할 수 있었다. 버리지 않고 하루 한도로 줄인다.
    title: text(e.title, 120),
    source: e.source === 'timer' ? 'timer' : 'manual',
    createdAt: number(e.createdAt, 0, Number.MAX_SAFE_INTEGER) ?? fromKey(e.date).getTime(),
  };
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

const cleanProfile = (p) => ({
  role: ROLES.includes(p?.role) ? p.role : 'other',
  age: AGES.includes(p?.age) ? p.age : 'adult',
  hide: p?.hide === true,
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
  return {
    version: 1,
    areas: Array.isArray(data.areas) ? cleanAreas(data.areas) : base.areas,
    entries: Array.isArray(data.entries) ? data.entries.map(cleanEntry).filter(Boolean) : [],
    sleep: cleanByDate(data.sleep, (n) => ({ bed: clock(n.bed), wake: clock(n.wake), quality: rating(n.quality) })),
    checkins: cleanByDate(data.checkins, (c) => ({ energy: rating(c.energy), stress: rating(c.stress), mood: rating(c.mood), detach: rating(c.detach), note: text(c.note, 200) })),
    marks: Array.isArray(data.marks) ? data.marks.map(cleanMark).filter(Boolean) : [],
    weekly: cleanByDate(data.weekly, (w) => ({ built: rating(w.built), distance: rating(w.distance), done: rating(w.done), on: isDate(w.on) ? w.on : undefined })),
    profile: cleanProfile(data.profile),
    supportSeen: number(data.supportSeen, 0, Number.MAX_SAFE_INTEGER) ?? 0,
    sleepGoal: number(data.sleepGoal, 4, 12) ?? base.sleepGoal,
    theme: ['light', 'auto'].includes(data.theme) ? data.theme : 'dark', // 예전의 'system'은 다크로 옮긴다
    sample: data.sample === true,
  };
}

export const isBackup = (data) => isMap(data) && Array.isArray(data.areas) && Array.isArray(data.entries) && (cleanAreas(data.areas).length > 0 || data.areas.length === 0);

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
    const data = raw ? normalize(JSON.parse(raw)) : null;
    if (data) lastGood = raw;
    return data;
  } catch {
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
const stored = read();
let state = stored ?? createDefaultState();
let saveFailed = stored === undefined || !storageWorks();
let pending = []; // 저장하지 못한 변경. 전체를 덮어쓰지 않고, 저장소가 돌아오면 그때의 최신 값 위에 다시 적용한다.
const listeners = new Set();

export const getState = () => state;
export const hasSaveFailed = () => saveFailed;
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
  if (sync()) notify(false, true);
});

// ---- 조회 ----
export const activeAreas = (s = state) => s.areas.filter((a) => !a.archived);
export const areaById = (id, s = state) => s.areas.find((a) => a.id === id);

// ---- 활동 기록 ----
export function addEntry({ date, areaId, minutes, title = '', source = 'manual', createdAt = Date.now() }, opts) {
  // 저장에 실패하면 다시 적용될 수 있으니 id는 변경 밖에서 정한다
  const entry = { id: uid(), date, areaId, minutes: Math.round(minutes), title: title.trim(), source, createdAt };
  commit((s) => void s.entries.push(entry), opts);
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

export function addArea({ label, emoji, goal, kind }) {
  const free = (s) => [1, 2, 3, 4, 5, 6].find((c) => !s.areas.some((a) => a.color === c));
  if (!free(state)) return false;
  const id = uid();
  commit((s) => {
    const color = free(s);
    if (color) s.areas.push({ id, label, emoji, goal, kind, color, archived: false });
  });
  return true;
}
export const updateArea = (id, patch, opts) =>
  commit((s) => {
    const area = areaById(id, s);
    if (area) Object.assign(area, patch);
  }, opts);
export const removeArea = (id) =>
  commit((s) => {
    s.areas = s.areas.filter((a) => a.id !== id);
    s.entries = s.entries.filter((e) => e.areaId !== id);
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
