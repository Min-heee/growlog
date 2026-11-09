// 둘러보기용 14주치 샘플 데이터. 바쁜 시기를 세 번 넣고 그때마다 지친 날을 표시해, 기록이 쌓이면 무엇이 보이는지 보여준다.
import { createDefaultState } from './store.js';
import { addDays, fromKey, todayKey, weekStartKey } from './dates.js';
import { uid } from './util.js';

const SAMPLE_AREAS = [
  { id: 'exercise', label: '운동', emoji: '🏃', goal: 150, kind: 'varies', color: 1 },
  { id: 'study', label: '공부', emoji: '📚', goal: 420, kind: 'load', color: 2 },
  { id: 'dev', label: '개발', emoji: '💻', goal: 600, kind: 'load', color: 3 },
];

const TITLES = {
  exercise: ['러닝 5km', '헬스 하체', '요가', '동네 산책', '수영'],
  study: ['영어 단어 50개', '알고리즘 문제 풀이', '책 읽기: 클린 코드', '온라인 강의 수강', '자격증 기출 풀기'],
  dev: ['사이드 프로젝트 기능 개발', '리팩터링', '버그 수정', 'UI 다듬기', 'API 연동'],
};
// 며칠 전부터 며칠 전까지 바빴는지, 끝날 무렵 어떻게 표시했는지
const BUSY = [
  { from: 72, to: 58, sev: 1 },
  { from: 40, to: 27, sev: 2, closed: 22 },
  { from: 13, to: 2, sev: 2 },
];

// 넣을 때마다 같은 결과가 나오도록 씨앗값이 있는 난수를 쓴다
function seeded(seed) {
  let n = seed;
  return () => {
    n = (n * 1664525 + 1013904223) >>> 0;
    return n / 4294967296;
  };
}

export function buildSample(days = 98) {
  const rand = seeded(20261030);
  const between = (min, max) => min + rand() * (max - min);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const score = (min, max) => Math.min(5, Math.max(1, Math.round(between(min, max))));
  const hhmm = (minutes) => {
    const m = (((Math.round(minutes / 5) * 5) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };

  const state = createDefaultState();
  state.areas = SAMPLE_AREAS.map((a) => ({ ...a, archived: false }));
  state.sample = true;
  state.supportSeen = Date.now(); // 샘플에서 도움 안내가 뜨지 않게 한다
  const today = todayKey();
  for (let i = days; i >= 0; i--) {
    const date = addDays(today, -i);
    const busy = BUSY.some((b) => i <= b.from && i >= b.to);
    const bed = (busy ? 24 * 60 + 30 : 23 * 60 + 20) + between(-40, 40);
    const hours = busy ? between(5, 6.6) : between(6.6, 8);
    state.sleep[date] = { bed: hhmm(bed), wake: hhmm(bed + hours * 60), quality: score(busy ? 1.8 : 2.8, busy ? 3.8 : 5.2) };
    if (i === 0) continue; // 오늘의 컨디션과 활동은 직접 남겨볼 수 있게 비워둔다
    if (rand() < 0.08) continue; // 기록을 빠뜨린 날도 있다

    state.checkins[date] = {
      energy: score(busy ? 1.4 : 2.8, busy ? 3.4 : 5),
      stress: score(busy ? 3.2 : 1.4, busy ? 5.4 : 3.6),
      mood: score(busy ? 1.8 : 2.8, busy ? 3.8 : 5),
      detach: score(busy ? 1 : 2.4, busy ? 3 : 5),
    };
    const dayStart = fromKey(date).getTime();
    // 운동은 대개 개운했지만, 바쁜 때는 억지로 해서 지친 날도 있다. 난수를 더 쓰지 않아야 나머지 샘플이 그대로다.
    const feel = (areaId) => (areaId !== 'exercise' ? {} : { feel: busy && i % 3 === 0 ? 'drain' : i % 7 === 0 ? 'same' : 'fill' });
    const add = (areaId, minutes, hour) =>
      state.entries.push({
        id: uid(),
        date,
        areaId,
        minutes: Math.max(5, Math.round(minutes / 5) * 5),
        title: pick(TITLES[areaId]),
        source: rand() < 0.3 ? 'timer' : 'manual',
        createdAt: dayStart + hour * 3600000,
        ...feel(areaId),
      });
    if (rand() < (busy ? 0.25 : 0.65)) add('exercise', between(20, 60), 7);
    if (rand() < 0.85) add('study', busy ? between(90, 200) : between(30, 120), 12);
    if (rand() < 0.85) add('dev', busy ? between(200, 380) : between(60, 200), 20);
  }
  for (const { to, sev, closed } of BUSY) {
    const date = addDays(today, -to);
    const closedOn = closed ? { closedOn: addDays(today, -closed) } : {};
    state.marks.push({ id: uid(), date, sev, fuzz: 0, tag: '일', createdAt: fromKey(date).getTime(), ...closedOn });
  }
  for (const back of [21, 14, 7]) {
    const on = addDays(today, -back);
    state.weekly[weekStartKey(on)] = { built: back === 7 ? 4 : 3, distance: back === 7 ? 4 : 2, done: back === 7 ? 2 : 4, on };
  }
  state.plans = samplePlans(state, today);
  return state;
}

/** 계획 4개. 지난 날은 그날 남긴 같은 영역 기록이 있으면 했어요로 치고 그 기록과 잇는다. 난수를 쓰지 않아 다른 샘플 값은 그대로다 */
function samplePlans(state, today) {
  const start = addDays(today, -27);
  const plan = (fields) => ({ id: uid(), done: [], createdAt: fromKey(fields.date).getTime(), ...fields });
  const morning = plan({ title: '아침 운동', date: start, time: '07:00', minutes: 30, areaId: 'exercise', repeat: { days: [1, 3, 5], skip: [] } });
  const words = plan({ title: '공부 시간', date: start, minutes: 60, areaId: 'study', repeat: { days: [1, 2, 3, 4, 5], skip: [] } });
  for (const p of [morning, words]) {
    for (let day = start; day < today; day = addDays(day, 1)) {
      if (!p.repeat.days.includes(fromKey(day).getDay())) continue;
      const entry = state.entries.find((e) => e.date === day && e.areaId === p.areaId && !e.planId);
      if (entry) {
        p.done.push(day);
        entry.planId = p.id;
      } else if (p === morning && !p.repeat.skip.length && day >= addDays(today, -13)) p.repeat.skip.push(day); // 바빴던 때 하루는 쉬어 갔다
    }
  }
  return [morning, words, plan({ title: '장보기', date: today }), plan({ title: '친구 만나기', date: addDays(today, 1), time: '19:00' })];
}
