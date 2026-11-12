// node --test tests/ 로 실행한다. '내 상태' 탭의 흐름, 나를 채우고 지치게 하는 것, 해 볼 것을 확인한다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays } from '../js/dates.js';
import { flowOf, flowWord, patterns, suggestions } from '../js/selfcare.js';

const TODAY = '2026-11-12'; // 목요일
const back = (n) => addDays(TODAY, -n);
const base = () => ({ areas: [], entries: [], sleep: {}, checkins: {}, plans: [], sleepGoal: 7, profile: { hide: false } });
const ok = { energy: 4, stress: 2, mood: 4 };
const bad = { energy: 2, stress: 4, mood: 2 };

test('흐름은 최근 4주를 오래된 날부터 담고, 최근 7일과 그 전 7일 평균, 2주씩 힘든 날을 센다', () => {
  const s = base();
  for (let i = 0; i < 28; i++) s.checkins[back(i)] = i < 14 ? (i % 2 ? bad : ok) : ok;
  s.checkins[back(27)] = { energy: 3 }; // 평점이 하나뿐인 날은 힘든 날을 세지 않는다
  s.sleep[back(0)] = { bed: '23:00', wake: '06:00' };
  const f = flowOf(s, TODAY);
  assert.equal(f.days.length, 28);
  assert.equal(f.days.at(-1), TODAY);
  assert.equal(f.rows.sleep.at(-1), 7);
  assert.equal(f.hard[0], null);
  assert.deepEqual([f.hard14, f.logged14, f.hardPrev14, f.loggedPrev14], [7, 14, 0, 13]);
  assert.equal(f.recent.energy, 3.1); // 4,2,4,2,4,2,4
  assert.equal(f.prev.energy, 2.9); // 2,4,2,4,2,4,2
  assert.equal(f.recent.sleep, 7);
  assert.equal(f.prev.sleep, null);
});

test('흐름의 말은 기록이 적으면 기다리고, 숨기면 판정하지 않고, 그 밖에는 힘든 날 비율로 정한다', () => {
  const f = (hard14, logged14, hardPrev14, loggedPrev14) => ({ hard14, logged14, hardPrev14, loggedPrev14, hard7: 0 });
  assert.equal(flowWord(f(0, 3, 0, 10), false).kind, 'few');
  assert.equal(flowWord(f(6, 12, 1, 12), true).kind, 'hidden');
  assert.equal(flowWord(f(6, 12, 2, 12), false).kind, 'down');
  assert.match(flowWord(f(6, 12, 2, 12), false).note, /지난 2주 힘든 날 6일, 그 전 2주는 2일이었어요/);
  assert.equal(flowWord(f(1, 12, 6, 12), false).kind, 'up');
  assert.equal(flowWord(f(7, 12, 7, 12), false).kind, 'hard');
  assert.equal(flowWord(f(0, 12, 0, 12), false).kind, 'calm');
  assert.equal(flowWord(f(2, 12, 2, 12), false).kind, 'same');
  assert.equal(flowWord(f(2, 12, 0, 2), false).note, '지난 2주 힘든 날 2일이에요.'); // 그 전 2주 기록이 적으면 비교하지 않는다
});

test('끝나고 나니를 4번 넘게 고른 영역은 채워졌어요가 많으면 채워요, 지쳤어요가 많으면 지치게 해요', () => {
  const s = base();
  s.areas = [{ id: 'walk', label: '산책', kind: 'varies' }, { id: 'run', label: '러닝', kind: 'varies' }, { id: 'few', label: '수영', kind: 'varies' }];
  const add = (areaId, feel, i, minutes = 30) => s.entries.push({ id: `${areaId}${i}`, areaId, feel, date: back(i), minutes, createdAt: i });
  ['fill', 'fill', 'fill', 'fill', 'same'].forEach((f, i) => add('walk', f, i, i < 2 ? 20 : 25));
  ['drain', 'drain', 'drain', 'fill', 'same', 'drain'].forEach((f, i) => add('run', f, i));
  ['fill', 'fill', 'fill'].forEach((f, i) => add('few', f, i)); // 3번뿐이다
  add('walk', 'drain', 120); // 석 달보다 오래된 기록은 보지 않는다
  const p = patterns(s, TODAY);
  assert.deepEqual(p.fills.map((x) => [x.what, x.num, x.minutes]), [['산책', '5번 중 4번', 20]]);
  assert.deepEqual(p.drains.map((x) => [x.what, x.num]), [['러닝', '6번 중 4번']]);
});

test('잠과 오래 한 일은 에너지 평소와 0.4 넘게 다를 때만 말한다', () => {
  const s = base();
  s.areas = [{ id: 'dev', label: '개발', kind: 'load' }];
  // 20일: 짝수 날은 잘 자고 에너지 4, 홀수 날은 적게 자고 에너지 2
  for (let i = 1; i <= 20; i++) {
    const even = i % 2 === 0;
    s.checkins[back(i)] = { energy: even ? 4 : 2 };
    s.sleep[back(i)] = even ? { bed: '23:00', wake: '07:00' } : { bed: '01:00', wake: '06:30' };
    // 개발은 홀수 날 다음 날(짝수 날 전날이 아니라 그 앞날)에 오래: 오래 한 다음 날이 에너지 2인 날이 되게 짝수 날에 4시간
    s.entries.push({ id: `d${i}`, areaId: 'dev', date: back(i), minutes: even ? 240 : 30, createdAt: i });
  }
  const p = patterns(s, TODAY);
  assert.deepEqual(p.fills.map((x) => x.key), ['sleep:good']);
  assert.equal(p.fills[0].num, '에너지 4.0'); // 다른 평균처럼 소수 한 자리
  assert.deepEqual(p.drains.map((x) => x.key).sort(), ['load:dev', 'sleep:short']);
  assert.match(p.drains.find((x) => x.key === 'load:dev').what, /개발 4시간 이상 한 날/);
  // 에너지 기록이 10일보다 적으면 잠과 일은 말하지 않는다
  const few = base();
  for (let i = 1; i <= 9; i++) {
    few.checkins[back(i)] = { energy: 4 };
    few.sleep[back(i)] = { bed: '23:00', wake: '07:00' };
  }
  assert.deepEqual(patterns(few, TODAY), { fills: [], drains: [] });
});

test('힘든 날이 이어지면 앞으로 7일 안의 반복 계획 하나를 쉬어 가자고 하고, 지치게 하는 영역을 먼저 고른다', () => {
  const s = base();
  s.areas = [{ id: 'run', label: '러닝', kind: 'varies' }, { id: 'study', label: '공부', kind: 'load' }];
  s.plans = [
    { id: 'p1', title: '공부 시간', date: back(10), areaId: 'study', repeat: { days: [0, 1, 2, 3, 4, 5, 6], skip: [] }, done: [], createdAt: 1 },
    { id: 'p2', title: '저녁 러닝', date: back(10), areaId: 'run', repeat: { days: [0], skip: [] }, done: [], createdAt: 2 }, // 일요일
  ];
  const flow = { hard7: 3 };
  const word = { kind: 'same' };
  const pats = { fills: [], drains: [{ key: 'feel:run', areaId: 'run' }] };
  const tips = suggestions(s, TODAY, { flow, word, pats });
  assert.equal(tips.length, 1);
  assert.deepEqual(tips[0].action, { kind: 'rest', id: 'p2', day: '2026-11-15' });
  assert.equal(tips[0].say, '일요일 저녁 러닝은 쉬어 갈까요?');
  assert.equal(tips[0].label, '일요일 쉬어 가기');
  assert.match(tips[0].why, /^러닝은 하고 나서 지친 적이 많았어요/);
  const byLoad = suggestions(s, TODAY, { flow, word, pats: { fills: [], drains: [{ key: 'load:study', areaId: 'study' }] } });
  assert.match(byLoad[0].why, /^공부를 오래 한 다음 날 에너지가 낮았어요/); // 근거대로 말한다
  // 지치게 하는 영역이 없으면 해야 하는 일 계획, 내일이면 '내일'
  const study = suggestions(s, TODAY, { flow, word, pats: { fills: [], drains: [] } });
  assert.deepEqual(study[0].action, { kind: 'rest', id: 'p1', day: '2026-11-13' });
  assert.equal(study[0].say, '내일 공부 시간은 쉬어 갈까요?');
  // 추정을 숨겼거나 흐름이 괜찮으면 쉬어 가자고 하지 않는다
  assert.equal(suggestions(s, TODAY, { flow, word, pats, hide: true }).length, 0);
  assert.equal(suggestions(s, TODAY, { flow: { hard7: 1 }, word: { kind: 'calm' }, pats }).length, 0);
  // 그대로 할게요로 숨기면 그날까지(날짜가 바뀌어도) 쉬어 가기를 띄우지 않는다
  assert.equal(suggestions(s, TODAY, { flow, word, pats, dismissed: { rest: '2026-11-18' } }).length, 0);
  assert.equal(suggestions(s, addDays(TODAY, 3), { flow, word, pats, dismissed: { rest: '2026-11-18' } }).length, 0);
  // 하나를 쉬어 가기로 하면 다음 날을 또 쉬자고 하지 않는다
  s.plans[1].repeat.skip = ['2026-11-15'];
  assert.equal(suggestions(s, TODAY, { flow, word, pats }).length, 0);
  s.plans[1].repeat.skip = [];
  // 이유는 실제 조건대로: 흐름이 처질 때와 최근 7일 힘든 날 때문일 때
  assert.match(tips[0].why, /최근 7일 중 3일이 힘든 날이었어요/);
  assert.match(suggestions(s, TODAY, { flow, word: { kind: 'down' }, pats })[0].why, /요즘 힘든 날이 이어졌어요/);
});

test('나를 채우는 영역은 내일 계획이 없을 때 넣어 보자고 한다', () => {
  const s = base();
  s.areas = [{ id: 'walk', label: '산책', kind: 'varies' }];
  const pats = { fills: [{ key: 'feel:walk', areaId: 'walk', what: '산책', num: '5번 중 4번', minutes: 20 }], drains: [] };
  const tips = suggestions(s, TODAY, { flow: { hard7: 0 }, word: { kind: 'calm' }, pats });
  assert.equal(tips[0].say, '내일 산책 20분을 넣어 볼까요?');
  // 괜찮아요로 숨기면 다음 날에도 숨어 있다
  assert.equal(suggestions(s, addDays(TODAY, 2), { flow: { hard7: 0 }, word: { kind: 'calm' }, pats, dismissed: { 'fill:walk': '2026-11-18' } }).length, 0);
  assert.deepEqual(tips[0].action, { kind: 'add', title: '산책', date: '2026-11-13', areaId: 'walk', minutes: 20 });
  s.plans = [{ id: 'w', title: '산책', date: '2026-11-13', areaId: 'walk', done: [], createdAt: 1 }];
  assert.equal(suggestions(s, TODAY, { flow: { hard7: 0 }, word: { kind: 'calm' }, pats }).length, 0);
});

test('최근 7일 잠이 목표보다 적으면 평소 잠든 시각보다 30분 일찍 눕자고 한다(자정을 넘겨도)', () => {
  const s = base();
  ['00:40', '01:10', '00:20', '23:50', '01:00'].forEach((bed, i) => {
    s.sleep[back(i)] = { bed, wake: '06:30' };
  });
  const calm = { flow: { hard7: 0 }, word: { kind: 'calm' }, pats: { fills: [], drains: [] } };
  const tips = suggestions(s, TODAY, { ...calm, now: 21 * 60 });
  assert.equal(tips.length, 1);
  // 자정을 넘기는 시각은 그날 밤, 곧 내일 날짜의 0시에 넣는다
  assert.deepEqual(tips[0].action, { kind: 'add', title: '일찍 눕기', date: '2026-11-13', time: '00:00' });
  assert.equal(tips[0].say, '오늘은 밤 12시 전에 누워 볼까요?');
  // 이미 자정을 넘긴 새벽이면 오늘 날짜, 그 시각이 지났으면 띄우지 않는다
  assert.equal(suggestions(s, TODAY, { ...calm, now: 0 })[0]?.action.date, undefined); // 0시 = 이미 그 시각
  s.sleep = {};
  ['01:40', '02:10', '01:20', '01:50', '02:00'].forEach((bed, i) => {
    s.sleep[back(i)] = { bed, wake: '07:30' };
  });
  assert.deepEqual(suggestions(s, TODAY, { ...calm, now: 30 })[0].action, { kind: 'add', title: '일찍 눕기', date: TODAY, time: '01:00' });
  assert.equal(suggestions(s, TODAY, { ...calm, now: 30 })[0].say, '오늘은 새벽 1시 전에 누워 볼까요?');
  assert.equal(suggestions(s, TODAY, { ...calm, now: 90 }).length, 0); // 새벽 1시 반이면 이미 지났다
  // 잠이 충분하면 말하지 않는다
  const rested = base();
  for (let i = 0; i < 5; i++) rested.sleep[back(i)] = { bed: '23:00', wake: '07:00' };
  assert.equal(suggestions(rested, TODAY, { flow: { hard7: 0 }, word: { kind: 'calm' }, pats: { fills: [], drains: [] } }).length, 0);
});

test('경계값 0.2와 0.4는 부동소수 오차 없이 이상으로 센다', () => {
  const f = (hard14, logged14, hardPrev14, loggedPrev14) => ({ hard14, logged14, hardPrev14, loggedPrev14, hard7: 0 });
  assert.equal(flowWord(f(3, 10, 1, 10), false).kind, 'down'); // 0.3 − 0.1
  assert.equal(flowWord(f(4, 10, 6, 10), false).kind, 'up'); // 0.6 − 0.4
  const s = base();
  for (let i = 1; i <= 20; i++) {
    const good = i % 2 === 0;
    s.checkins[back(i)] = { energy: good ? (i % 4 === 0 ? 4 : 3) : 3 }; // 잘 잔 날 3.5, 전체 평균 3.25 → 3.3
    s.sleep[back(i)] = good ? { bed: '23:00', wake: '07:00' } : { bed: '23:30', wake: '06:00' };
  }
  // 잘 잔 날 평균 3.5와 평소 3.3의 차이는 0.2라 말하지 않는다
  assert.deepEqual(patterns(s, TODAY).fills, []);
});
