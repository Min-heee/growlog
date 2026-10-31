// 앱 데이터 저장소: 브라우저 localStorage에 저장하고, 바뀌면 구독한 화면에 알린다.
import { uid } from './util.js';

const KEY = 'growlog:v1';
export const MAX_AREAS = 6; // 색 1~6번은 활동 영역, 7번은 수면에 고정

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
    checkins: {}, // 날짜 → { energy, stress, mood, note }
    sleepGoal: 7,
    theme: 'system',
    sample: false,
  };
}

const asMap = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export function normalize(data) {
  const base = createDefaultState();
  if (!data || typeof data !== 'object') return base;
  return {
    ...base,
    ...data,
    areas: Array.isArray(data.areas) ? data.areas.map((a) => ({ kind: 'load', goal: 0, archived: false, ...a })) : base.areas,
    entries: Array.isArray(data.entries) ? data.entries : [],
    sleep: asMap(data.sleep),
    checkins: asMap(data.checkins),
  };
}

export const isBackup = (data) => !!data && Array.isArray(data.areas) && Array.isArray(data.entries);

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    /* 저장소를 못 쓰면 빈 상태로 시작 */
  }
  return createDefaultState();
}

let state = load();
const listeners = new Set();

export const getState = () => state;
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** quiet: 입력칸처럼 화면을 다시 그리면 포커스가 날아가는 곳에서 쓴다 */
function commit(mutate, { quiet = false } = {}) {
  const next = mutate(state);
  if (next) state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 저장이 막혀도 화면은 계속 동작 */
  }
  listeners.forEach((fn) => fn(state, { quiet }));
}

// ---- 조회 ----
export const activeAreas = (s = state) => s.areas.filter((a) => !a.archived);
export const areaById = (id, s = state) => s.areas.find((a) => a.id === id);

// ---- 활동 기록 ----
export function addEntry({ date, areaId, minutes, title = '', source = 'manual' }) {
  commit((s) => {
    s.entries.push({ id: uid(), date, areaId, minutes: Math.round(minutes), title: title.trim(), source, createdAt: Date.now() });
  });
}
export const restoreEntry = (entry) => commit((s) => void s.entries.push(entry));
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

// ---- 활동 영역 ----
export const canAddArea = (s = state) => s.areas.length < MAX_AREAS;

export function addArea({ label, emoji, goal, kind }) {
  const used = new Set(state.areas.map((a) => a.color));
  const color = [1, 2, 3, 4, 5, 6].find((c) => !used.has(c));
  if (!color) return false;
  commit((s) => void s.areas.push({ id: uid(), label, emoji, goal, kind, color, archived: false }));
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
export const replaceState = (data) => commit(() => normalize(data));
export const resetState = () => commit(() => createDefaultState());
