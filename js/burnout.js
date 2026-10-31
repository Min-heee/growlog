// 번아웃 지수: 최근 7일의 컨디션·수면·작업량·회복 활동을 합쳐 0~100 점수로 만든다 (높을수록 위험).
// 의학적 진단이 아니라 스스로 돌아보기 위한 참고 지표다.
import { rangeKeys, sleepHours, todayKey } from './dates.js';
import { avg, clamp, fmt1, fmtHM, josa, sum } from './util.js';

export const LEVELS = [
  { min: 70, key: 'critical', label: '위험', desc: '많이 지쳐 있을 수 있어요. 일정을 덜어내고 회복을 최우선으로 두세요.' },
  { min: 50, key: 'serious', label: '경고', desc: '피로가 꾸준히 쌓이고 있어요. 이번 주는 속도를 늦추는 게 좋아요.' },
  { min: 30, key: 'warning', label: '주의', desc: '지친 신호가 조금 보여요. 수면과 쉬는 시간을 챙겨주세요.' },
  { min: 0, key: 'good', label: '안정', desc: '일과 회복의 균형이 잘 맞고 있어요.' },
];
export const levelFor = (score) => LEVELS.find((l) => score >= l.min);

const FACTORS = {
  stress: { label: '스트레스', weight: 25 },
  energy: { label: '에너지 저하', weight: 20 },
  sleep: { label: '수면 부족', weight: 20 },
  workload: { label: '작업량', weight: 15 },
  mood: { label: '기분 저하', weight: 10 },
  recovery: { label: '회복 부족', weight: 10 },
};
// 하루치 기록만으로 '위험'이라고 말하지 않도록, 컨디션이나 수면을 남긴 날이 이만큼 쌓여야 점수를 낸다
export const MIN_DAYS = 3;

function earliestKey(state) {
  const keys = [...state.entries.map((e) => e.date), ...Object.keys(state.checkins), ...Object.keys(state.sleep)];
  return keys.length ? keys.reduce((min, k) => (k < min ? k : min)) : null;
}

function buildAdvice(factors, stats, state) {
  const names = (kind, fallback) => state.areas.filter((a) => a.kind === kind && !a.archived).map((a) => a.label).join('·') || fallback;
  const load = names('load', '일');
  const recovery = names('recovery', '회복 활동');
  const text = {
    stress: () => `최근 평균 스트레스가 ${fmt1(stats.stress)}/5예요. 하루 10분이라도 아무것도 하지 않는 시간을 일정에 넣어보세요.`,
    energy: () => `에너지가 평균 ${fmt1(stats.energy)}/5로 낮아요. 오늘은 가장 중요한 일 하나만 끝내는 걸 목표로 해보세요.`,
    mood: () => '기분이 가라앉은 날이 이어지고 있어요. 믿을 만한 사람과 짧게라도 이야기를 나눠보세요.',
    sleep: () =>
      stats.sleep != null && stats.sleep < state.sleepGoal - 0.25
        ? `평균 수면이 ${fmt1(stats.sleep)}시간으로 목표보다 ${fmt1(state.sleepGoal - stats.sleep)}시간 부족해요. 오늘은 30분 일찍 잠자리에 들어보세요.`
        : '수면의 질이 낮은 편이에요. 잠들기 1시간 전에는 화면을 멀리해보세요.',
    workload: () =>
      stats.restDays === 0 && stats.spanDays >= 5
        ? `최근 ${stats.spanDays}일 동안 쉬는 날이 없었어요. 이번 주에 ${load}${josa(load, '을', '를')} 쉬는 날을 하루 정해두세요.`
        : `하루 평균 ${fmtHM(stats.avgLoad)} 동안 ${load}에 시간을 썼어요. 목표를 조금 낮춰도 괜찮아요.`,
    recovery: () => `${recovery} 시간이 목표의 ${Math.round((stats.recoveryMin / stats.recoveryGoal) * 100)}%예요. 가볍게 20분 걷기부터 시작해보세요.`,
  };
  const picked = factors
    .filter((f) => f.value != null && f.value >= 0.35)
    .sort((a, b) => b.weight * b.value - a.weight * a.value)
    .slice(0, 3);
  if (!picked.length) return [{ key: 'good', text: '균형이 잘 잡혀 있어요. 지금 리듬을 그대로 이어가 보세요.' }];
  return picked.map((f) => ({ key: f.key, text: text[f.key]() }));
}

export function computeBurnout(state, endKey, first = earliestKey(state)) {
  const keys = rangeKeys(endKey, 7);
  // 기록을 시작하기 전의 날은 '쉰 날'로 세지 않는다
  const span = first ? keys.filter((k) => k >= first) : [];
  const values = {};
  const stats = {};

  const checkins = keys.map((k) => state.checkins[k]).filter(Boolean);
  const scores = (field) => checkins.map((c) => c[field]).filter((v) => typeof v === 'number');
  stats.stress = avg(scores('stress'));
  stats.energy = avg(scores('energy'));
  stats.mood = avg(scores('mood'));
  values.stress = stats.stress == null ? null : (stats.stress - 1) / 4;
  values.energy = stats.energy == null ? null : (5 - stats.energy) / 4;
  values.mood = stats.mood == null ? null : (5 - stats.mood) / 4;

  const nights = keys.map((k) => state.sleep[k]).filter(Boolean);
  stats.sleep = avg(nights.map((n) => sleepHours(n.bed, n.wake)).filter((h) => h != null));
  stats.quality = avg(nights.map((n) => n.quality).filter((v) => typeof v === 'number'));
  const deficit = stats.sleep == null ? null : clamp((state.sleepGoal - stats.sleep) / 2.5, 0, 1);
  const poorSleep = stats.quality == null ? null : (5 - stats.quality) / 4;
  values.sleep = deficit != null && poorSleep != null ? 0.7 * deficit + 0.3 * poorSleep : deficit ?? poorSleep;

  const kindOf = new Map(state.areas.map((a) => [a.id, a.kind]));
  const loadByDay = new Map(span.map((k) => [k, 0]));
  const entryDays = new Set();
  let recoveryMin = 0;
  for (const e of state.entries) {
    if (!loadByDay.has(e.date)) continue;
    entryDays.add(e.date);
    if (kindOf.get(e.areaId) === 'load') loadByDay.set(e.date, loadByDay.get(e.date) + e.minutes);
    if (kindOf.get(e.areaId) === 'recovery') recoveryMin += e.minutes;
  }
  // 아직 끝나지 않은 오늘은, 충분히 활동하기 전까지 '쉰 날'이나 평균에 넣지 않는다
  const today = todayKey();
  const loads = [...loadByDay].filter(([k, m]) => k !== today || m >= 30).map(([, m]) => m);
  stats.avgLoad = loads.length ? sum(loads) / loads.length : 0;
  stats.restDays = loads.filter((m) => m < 30).length;
  stats.spanDays = loads.length;
  stats.recoveryMin = recoveryMin;
  stats.recoveryGoal = (sum(state.areas.filter((a) => a.kind === 'recovery' && !a.archived), (a) => a.goal || 0) * span.length) / 7;

  if (entryDays.size) {
    const heavy = clamp((stats.avgLoad - 240) / 300, 0, 1); // 하루 4시간까지는 부담 없음, 9시간이면 최대
    const noRest = loads.length >= 5 ? (stats.restDays === 0 ? 1 : stats.restDays === 1 ? 0.4 : 0) : 0;
    values.workload = 0.65 * heavy + 0.35 * noRest;
    values.recovery = stats.recoveryGoal > 0 ? 1 - clamp(recoveryMin / stats.recoveryGoal, 0, 1) : null;
  } else {
    values.workload = null;
    values.recovery = null;
  }

  const detail = {
    stress: () => `평균 ${fmt1(stats.stress)}/5`,
    energy: () => `평균 ${fmt1(stats.energy)}/5`,
    mood: () => `평균 ${fmt1(stats.mood)}/5`,
    sleep: () => (stats.sleep != null ? `평균 ${fmt1(stats.sleep)}시간` : `질 ${fmt1(stats.quality)}/5`),
    workload: () => `하루 ${fmtHM(stats.avgLoad)}`,
    recovery: () => `${fmtHM(recoveryMin)} / ${fmtHM(stats.recoveryGoal)}`,
  };
  const factors = Object.entries(FACTORS).map(([key, f]) => ({
    key,
    ...f,
    value: values[key],
    detail: values[key] == null ? '기록 없음' : detail[key](),
  }));

  const known = factors.filter((f) => f.value != null);
  // 메모만 남긴 날은 세지 않는다
  const rated = (k) => {
    const c = state.checkins[k];
    const n = state.sleep[k];
    return (c && (c.stress || c.energy || c.mood)) || (n && (n.quality || sleepHours(n.bed, n.wake) != null));
  };
  const dataDays = keys.filter(rated).length;
  const weights = sum(known, (f) => f.weight);
  const score = dataDays >= MIN_DAYS && weights > 0 ? Math.round((100 * sum(known, (f) => f.weight * f.value)) / weights) : null;

  return {
    score,
    level: score == null ? null : levelFor(score),
    factors,
    stats,
    dataDays,
    advice: score == null ? [] : buildAdvice(factors, stats, state),
  };
}

/** 날마다 그날로 끝나는 7일 구간의 지수를 구한다 */
export function burnoutTrend(state, endKey, days = 14) {
  const first = earliestKey(state);
  return rangeKeys(endKey, days).map((key) => ({
    key,
    score: first && key >= first ? computeBurnout(state, key, first).score : null,
  }));
}
