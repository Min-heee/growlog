// '내 상태' 탭의 계산: 요즘 흐름을 알아차리고, 무엇이 나를 채우고 지치게 하는지 보고, 이번 주에 해 볼 것을 고른다.
// 번아웃인지 맞히지 않는다. 내가 남긴 기록을 요약할 뿐이고, 패턴은 '그랬어요'로만 말하며 원인이라고 하지 않는다.
// 저장소와 화면을 모르는 순수 함수만 둔다.
import { addDays, rangeKeys, sleepHours, weekday } from './dates.js';
import { clockLabel, plansOn } from './plans.js';
import { isHard, isValid } from './strain.js';
import { avg, fmtHM, josa } from './util.js';

const FLOW_DAYS = 28;
const round1 = (n) => Math.round(n * 10) / 10;
const mean1 = (list) => {
  const v = list.filter((x) => x != null);
  return v.length ? round1(avg(v)) : null;
};
const count = (list, test) => list.filter(test).length;
const nightHours = (state, day) => {
  const n = state.sleep[day];
  return n ? sleepHours(n.bed, n.wake) : null;
};

/**
 * 최근 4주. days는 오래된 날부터 28개, rows는 그날 에너지·스트레스·기분(1~5)과 잔 시간(없으면 null),
 * hard는 힘든 날인지(평점이 둘 이상 없는 날은 null). recent는 최근 7일 평균, prev는 그 전 7일 평균.
 */
export function flowOf(state, today) {
  const days = rangeKeys(today, FLOW_DAYS);
  const c = (day) => state.checkins[day] ?? {};
  const rows = {
    energy: days.map((d) => c(d).energy ?? null),
    stress: days.map((d) => c(d).stress ?? null),
    mood: days.map((d) => c(d).mood ?? null),
    sleep: days.map((d) => nightHours(state, d)),
  };
  const hard = days.map((d) => (isValid(c(d)) ? isHard(c(d)) : null));
  const part = (from, to) => Object.fromEntries(Object.entries(rows).map(([key, list]) => [key, mean1(list.slice(from, to))]));
  const last14 = hard.slice(14);
  const prev14 = hard.slice(0, 14);
  return {
    days,
    rows,
    hard,
    recent: part(21, 28),
    prev: part(14, 21),
    hard14: count(last14, (h) => h === true),
    logged14: count(last14, (h) => h !== null),
    hardPrev14: count(prev14, (h) => h === true),
    loggedPrev14: count(prev14, (h) => h !== null),
    hard7: count(hard.slice(21), (h) => h === true),
  };
}

const ENOUGH = 4; // 2주에 이만큼은 컨디션을 남겨야 흐름을 말한다
/**
 * 큰 말과 그 아래 한 줄. kind는 'few'(기록이 적음), 'hidden'(추정 숨김), 'down', 'up', 'hard', 'calm', 'same'.
 * 판정이 아니라 지난 기록의 요약이다.
 */
export function flowWord(flow, hide) {
  const note = flow.logged14 < ENOUGH ? `최근 2주 컨디션 기록 ${flow.logged14}일` : flow.loggedPrev14 >= ENOUGH ? `지난 2주 힘든 날 ${flow.hard14}일, 그 전 2주는 ${flow.hardPrev14}일이었어요.` : `지난 2주 힘든 날 ${flow.hard14}일이에요.`;
  if (flow.logged14 < ENOUGH) return { kind: 'few', word: '기록이 쌓이면 흐름이 보여요', note: `${note}. 컨디션을 남길수록 또렷해져요.` };
  if (hide) return { kind: 'hidden', word: '요즘 내 흐름', note: `최근 2주 컨디션 기록 ${flow.logged14}일` };
  // 비율 차이 0.2를 정수로 견준다(부동소수 오차로 0.19999…가 되어 빠지지 않게): 5·(a/b − c/d) ≥ 1 ⇔ 5(ad − cb) ≥ bd
  const compare = flow.loggedPrev14 >= ENOUGH;
  const lift = 5 * (flow.hard14 * flow.loggedPrev14 - flow.hardPrev14 * flow.logged14);
  const span = flow.logged14 * flow.loggedPrev14;
  if (compare && lift >= span && flow.hard14 >= 3) return { kind: 'down', word: '요즘 조금 처지는 흐름이에요', note };
  if (compare && -lift >= span) return { kind: 'up', word: '요즘 나아지는 흐름이에요', note };
  if (2 * flow.hard14 >= flow.logged14) return { kind: 'hard', word: '힘든 날이 이어지고 있어요', note };
  if (!flow.hard14) return { kind: 'calm', word: '요즘 괜찮은 흐름이에요', note };
  return { kind: 'same', word: '요즘 비슷한 흐름이에요', note };
}

// ---- 나를 채우는 것과 지치게 하는 것 ----
const WINDOW = 90; // 최근 석 달의 기록을 본다
const MIN_TIMES = 4; // 이만큼은 있어야 말한다
const GAP = 0.4; // 에너지 평균이 이만큼은 달라야 말한다
const PER_SIDE = 2;
const atLeastGap = (a, b) => Math.round((a - b) * 10) >= GAP * 10; // 소수 한 자리 값끼리 0.4 차이를 정확히 센다
const one = (n) => n.toFixed(1); // 화면의 다른 평균처럼 소수 한 자리로 쓴다

/** 가운데 값 */
function median(list) {
  const s = [...list].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** p 지점 값 */
function quantile(list, p) {
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
}

/**
 * fills(나를 채워요)와 drains(나를 지치게 해요). 항목은 { key, what, num, why, strength, areaId?, ratio?: [m, n], minutes? }.
 * strength가 큰 것부터 쪽마다 2개까지.
 */
export function patterns(state, today) {
  const from = addDays(today, -(WINDOW - 1));
  const inWindow = (d) => d >= from && d <= today;
  const fills = [];
  const drains = [];

  // 그때그때 다른 일: 끝나고 나니
  for (const area of state.areas) {
    if (area.archived || area.kind !== 'varies') continue; // 해야 하는 일로 바꾼 영역의 옛 끝나고 나니는 계산에도 쓰지 않는다
    const felt = state.entries.filter((e) => e.areaId === area.id && e.feel && inWindow(e.date));
    if (felt.length < MIN_TIMES) continue;
    const n = felt.length;
    const filled = felt.filter((e) => e.feel === 'fill');
    const drained = count(felt, (e) => e.feel === 'drain');
    if (filled.length / n >= 0.6) {
      const minutes = Math.min(120, Math.max(10, Math.round(median(filled.map((e) => e.minutes)) / 10) * 10));
      fills.push({ key: `feel:${area.id}`, areaId: area.id, what: area.label, num: `${n}번 중 ${filled.length}번`, why: '하고 나서 채워졌어요', ratio: [filled.length, n], minutes, strength: filled.length / n });
    }
    if (drained / n >= 0.5) drains.push({ key: `feel:${area.id}`, areaId: area.id, what: area.label, num: `${n}번 중 ${drained}번`, why: '하고 나서 지쳤어요', ratio: [drained, n], strength: drained / n });
  }

  // 에너지 평소
  const energyDays = rangeKeys(today, WINDOW).filter((d) => state.checkins[d]?.energy);
  const energy = (d) => state.checkins[d]?.energy ?? null;
  if (energyDays.length >= 10) {
    const usual = round1(avg(energyDays.map(energy)));

    // 잠: 그날 에너지
    const goal = state.sleepGoal;
    const slept = energyDays.map((d) => [d, nightHours(state, d)]).filter(([, h]) => h != null);
    const good = slept.filter(([, h]) => h >= goal).map(([d]) => energy(d));
    const short = slept.filter(([, h]) => h < goal - 1).map(([d]) => energy(d));
    const goodE = good.length ? round1(avg(good)) : null;
    const shortE = short.length ? round1(avg(short)) : null;
    if (good.length >= MIN_TIMES && atLeastGap(goodE, usual)) fills.push({ key: 'sleep:good', what: `${goal}시간 이상 잔 날`, num: `에너지 ${one(goodE)}`, why: `그날 에너지가 평소(${one(usual)})보다 높았어요`, strength: goodE - usual });
    if (short.length >= MIN_TIMES && atLeastGap(usual, shortE)) drains.push({ key: 'sleep:short', what: `${goal - 1}시간보다 적게 잔 날`, num: `에너지 ${one(shortE)}`, why: `그날 에너지가 평소(${one(usual)})보다 낮았어요`, strength: usual - shortE });

    // 해야 하는 일: 오래 한 날의 다음 날 에너지
    for (const area of state.areas) {
      if (area.archived || area.kind !== 'load') continue;
      const perDay = new Map();
      for (const e of state.entries) if (e.areaId === area.id && inWindow(e.date)) perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.minutes);
      if (perDay.size < 6) continue;
      const line = Math.max(120, Math.round(quantile([...perDay.values()], 0.75) / 30) * 30);
      const next = [...perDay].filter(([d, m]) => m >= line && energy(addDays(d, 1)) != null).map(([d]) => energy(addDays(d, 1)));
      if (next.length < MIN_TIMES) continue;
      const after = round1(avg(next));
      if (atLeastGap(usual, after)) drains.push({ key: `load:${area.id}`, areaId: area.id, what: `${area.label} ${fmtHM(line)} 이상 한 날`, num: `다음 날 에너지 ${one(after)}`, why: `평소(${one(usual)})보다 낮았어요`, strength: usual - after });
    }
  }

  const top = (list) => list.sort((a, b) => b.strength - a.strength).slice(0, PER_SIDE);
  return { fills: top(fills), drains: top(drains) };
}

// ---- 이번 주 해 볼 것 ----
const AHEAD = 6; // 내일부터 이만큼 뒤까지의 계획을 본다
const BEDTIME_PLAN = '일찍 눕기';

/** 'HH:MM' → 저녁 6시부터 센 분. 자정을 넘긴 시각이 저녁보다 뒤로 오게 한다 */
const fromEvening = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h * 60 + m - 18 * 60 + 1440) % 1440;
};
const toClock = (minutes) => {
  const t = (((minutes + 18 * 60) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const dayName = (day, today) => (day === addDays(today, 1) ? '내일' : `${weekday(day)}요일`);

/**
 * 해 볼 것. 항목은 { key, say, why, label, action }이고 action은
 * { kind: 'rest', id, day } 또는 { kind: 'add', title, date, areaId?, minutes?, time? }.
 * dismissed는 { key: 이날까지 숨김 }이다.
 */
export function suggestions(state, today, { flow, word, pats, hide = false, dismissed = {}, now = 12 * 60 }) {
  const tips = [];
  const tomorrow = addDays(today, 1);
  const area = (id) => state.areas.find((a) => a.id === id && !a.archived);

  // 쉬어 가기: 요즘 처지거나 힘든 날이 이어질 때, 앞으로 7일 안의 반복 계획 하나
  const tired = !hide && (['down', 'hard'].includes(word.kind) || flow.hard7 >= 3);
  if (tired) {
    const drainAreas = new Set(pats.drains.map((d) => d.areaId).filter(Boolean));
    const upcoming = [];
    let rested = false; // 이미 쉬어 가기로 한 날이 있으면 더 쉬자고 하지 않는다(받아들이자마자 다음 날을 또 권하지 않게)
    for (let i = 1; i <= AHEAD; i++) {
      const day = addDays(today, i);
      for (const { plan, state: s } of plansOn(state.plans, day)) {
        if (!plan.repeat) continue;
        if (s === 'rest') rested = true;
        else if (s === 'todo') upcoming.push({ plan, day });
      }
    }
    const pick = rested ? null : upcoming.find((x) => drainAreas.has(x.plan.areaId)) ?? upcoming.find((x) => area(x.plan.areaId)?.kind === 'load') ?? upcoming[0];
    if (pick) {
      const { plan, day } = pick;
      const drain = pats.drains.find((d) => d.areaId && d.areaId === plan.areaId);
      const name = drain && area(drain.areaId)?.label;
      // 지치게 한다고 본 근거대로 말한다: 끝나고 나니로 본 것과 오래 한 다음 날 에너지로 본 것
      const reason = !name ? '' : drain.key.startsWith('feel:') ? `${name}${josa(name, '은', '는')} 하고 나서 지친 적이 많았어요. ` : `${name}${josa(name, '을', '를')} 오래 한 다음 날 에너지가 낮았어요. `;
      const lately = ['down', 'hard'].includes(word.kind) ? '요즘 힘든 날이 이어졌어요.' : `최근 7일 중 ${flow.hard7}일이 힘든 날이었어요.`;
      tips.push({
        key: 'rest', // 숨기면 한 주 동안 쉬어 가기 제안을 내지 않는다(날짜가 바뀌어도)
        say: `${dayName(day, today)} ${plan.title}${josa(plan.title, '은', '는')} 쉬어 갈까요?`,
        why: `${reason}${lately} 쉬는 것도 계획이에요.`,
        label: `${dayName(day, today)} 쉬어 가기`,
        action: { kind: 'rest', id: plan.id, day },
      });
    }
  }

  // 나를 채우는 활동 넣기: 내일 그 영역 계획이 없을 때
  const fill = pats.fills.find((f) => f.areaId && area(f.areaId));
  if (fill && !plansOn(state.plans, tomorrow).some((x) => x.plan.areaId === fill.areaId)) {
    tips.push({
      key: `fill:${fill.areaId}`,
      say: `내일 ${fill.what} ${fill.minutes}분을 넣어 볼까요?`,
      why: `${fill.what}${josa(fill.what, '은', '는')} ${fill.num} 나를 채웠어요.`,
      label: '내일 계획에 넣기',
      action: { kind: 'add', title: fill.what, date: tomorrow, areaId: fill.areaId, minutes: fill.minutes },
    });
  }

  // 일찍 눕기: 최근 7일 잠이 목표보다 적을 때
  const week = rangeKeys(today, 7);
  const hours = week.map((d) => nightHours(state, d)).filter((h) => h != null);
  const beds = week.map((d) => state.sleep[d]?.bed).filter(Boolean);
  if (hours.length >= 4 && beds.length >= 4 && avg(hours) < state.sleepGoal - 0.5) {
    const target = Math.floor((median(beds.map(fromEvening)) - 30) / 30) * 30; // 저녁 6시부터 센 분
    const time = toClock(target);
    // 지금 이미 자정을 넘긴 새벽(저녁 6시부터 센 시각이 12시간 뒤)이면 오늘, 아니면 자정을 넘기는 시각은 그날 밤인 내일 날짜에 넣는다
    const nowFromEvening = (now - 18 * 60 + 1440) % 1440;
    const nowAfterMidnight = nowFromEvening >= 6 * 60 && nowFromEvening < 12 * 60; // 지금 0시~6시
    const date = target >= 6 * 60 && !nowAfterMidnight ? tomorrow : today;
    const passed = nowFromEvening >= target && nowFromEvening < 12 * 60; // 오늘 밤 그 시각이 이미 지났다
    if (!passed && !plansOn(state.plans, date).some((x) => x.plan.title === BEDTIME_PLAN)) {
      tips.push({
        key: 'sleep',
        say: `오늘은 ${clockLabel(time)} 전에 누워 볼까요?`,
        why: `최근 7일 평균 ${round1(avg(hours))}시간 잤어요. 목표는 ${state.sleepGoal}시간이에요.`,
        label: '계획에 넣기',
        action: { kind: 'add', title: BEDTIME_PLAN, date, time },
      });
    }
  }

  return tips.filter((t) => !(dismissed[t.key] && dismissed[t.key] >= today));
}
