// 둘러보기용 4주치 샘플 데이터. 최근 일주일은 일부러 바쁘고 피곤하게 만들어 번아웃 지수가 움직이는 걸 보여준다.
import { createDefaultState } from './store.js';
import { addDays, fromKey, todayKey } from './dates.js';
import { uid } from './util.js';

const TITLES = {
  exercise: ['러닝 5km', '헬스 하체', '요가', '동네 산책', '수영'],
  study: ['영어 단어 50개', '알고리즘 문제 풀이', '책 읽기: 클린 코드', '온라인 강의 수강', '자격증 기출 풀기'],
  dev: ['사이드 프로젝트 기능 개발', '리팩터링', '버그 수정', 'UI 다듬기', 'API 연동'],
};

// 넣을 때마다 같은 결과가 나오도록 씨앗값이 있는 난수를 쓴다
function seeded(seed) {
  let n = seed;
  return () => {
    n = (n * 1664525 + 1013904223) >>> 0;
    return n / 4294967296;
  };
}

export function buildSample(days = 27) {
  const rand = seeded(20261030);
  const between = (min, max) => min + rand() * (max - min);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const score = (min, max) => Math.min(5, Math.max(1, Math.round(between(min, max))));
  const hhmm = (minutes) => {
    const m = (((Math.round(minutes / 5) * 5) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };

  const state = createDefaultState();
  state.sample = true;
  const today = todayKey();
  for (let i = days; i >= 0; i--) {
    const date = addDays(today, -i);
    const busy = i <= 7;
    const bed = (busy ? 24 * 60 + 30 : 23 * 60 + 20) + between(-40, 40);
    const hours = busy ? between(5, 6.6) : between(6.4, 8);
    state.sleep[date] = { bed: hhmm(bed), wake: hhmm(bed + hours * 60), quality: score(busy ? 1.8 : 2.8, busy ? 3.8 : 5.2) };
    if (i === 0) continue; // 오늘의 컨디션과 활동은 직접 남겨볼 수 있게 비워둔다

    state.checkins[date] = {
      energy: score(busy ? 1.6 : 2.8, busy ? 3.6 : 5),
      stress: score(busy ? 3 : 1.4, busy ? 5.2 : 3.6),
      mood: score(busy ? 2 : 2.8, busy ? 4 : 5),
    };
    const dayStart = fromKey(date).getTime();
    const add = (areaId, minutes, hour) =>
      state.entries.push({
        id: uid(),
        date,
        areaId,
        minutes: Math.max(5, Math.round(minutes / 5) * 5),
        title: pick(TITLES[areaId]),
        source: rand() < 0.3 ? 'timer' : 'manual',
        createdAt: dayStart + hour * 3600000,
      });
    if (rand() < (busy ? 0.3 : 0.65)) add('exercise', between(20, 60), 7);
    if (rand() < 0.85) add('study', busy ? between(60, 180) : between(30, 120), 12);
    if (rand() < 0.85) add('dev', busy ? between(180, 360) : between(60, 200), 20);
  }
  return state;
}
