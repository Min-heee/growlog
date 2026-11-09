// node --test tests/ 로 실행한다. 계획의 잡힌 날, 상태, 달력 요약, 말, 고치기, 그만하기, 기록과 잇기를 확인한다.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addMonths,
  applyEdit,
  clockLabel,
  endFrom,
  endStart,
  isHidden,
  logInfo,
  looseEntries,
  monthKeys,
  monthSummary,
  nextOn,
  occursOn,
  plansOn,
  progress,
  repeatLabel,
  samePlan,
  scheduled,
  stateOn,
} from '../js/plans.js';

const TODAY = '2026-11-10'; // 화요일
const once = (fields = {}) => ({ id: 'o', title: '장보기', date: TODAY, done: [], createdAt: 1, ...fields });
// 11월 2일(월)부터 월·수·금
const mwf = (fields = {}) => ({ id: 'r', title: '운동', date: '2026-11-02', repeat: { days: [1, 3, 5], skip: [] }, done: [], createdAt: 2, ...fields });

test('한 번짜리는 그날만, 반복은 시작한 날부터 고른 요일마다 잡힌다', () => {
  assert.equal(occursOn(once(), TODAY), true);
  assert.equal(occursOn(once(), '2026-11-11'), false);
  const wed = { ...mwf(), date: '2026-11-09', repeat: { days: [3], skip: [] } }; // 월요일에 만든 수요일 계획
  assert.equal(occursOn(wed, '2026-11-09'), false);
  assert.equal(occursOn(wed, '2026-11-11'), true);
  assert.equal(occursOn(mwf(), '2026-10-30'), false); // 시작 전 금요일
  const ended = mwf({ repeat: { days: [1, 3, 5], until: '2026-11-06', skip: [] } });
  assert.equal(occursOn(ended, '2026-11-06'), true);
  assert.equal(occursOn(ended, '2026-11-09'), false);
  const rest = mwf({ repeat: { days: [1, 3, 5], skip: ['2026-11-04'] } });
  assert.equal(occursOn(rest, '2026-11-04'), false);
  assert.equal(scheduled(rest, '2026-11-04'), true);
});

test('했어요는 잡힌 날이 아니어도 남고, 쉬어 가요는 rest다', () => {
  const moved = mwf({ repeat: { days: [2, 4], skip: ['2026-11-12'] }, done: ['2026-11-02'] }); // 월요일에 하고 화·목으로 바꿨다
  assert.equal(stateOn(moved, '2026-11-02'), 'done');
  assert.equal(stateOn(moved, '2026-11-03'), 'todo');
  assert.equal(stateOn(moved, '2026-11-12'), 'rest');
  assert.equal(stateOn(moved, '2026-11-04'), null);
});

test('그날 목록은 시간 있는 것을 시간순으로 먼저, 체크해도 순서가 그대로다', () => {
  const plans = [
    once({ id: 'a', title: '아무 때', createdAt: 1 }),
    once({ id: 'b', title: '저녁', time: '19:00', createdAt: 2 }),
    once({ id: 'c', title: '아침', time: '07:00', createdAt: 3 }),
    once({ id: 'd', title: '아무 때 2', createdAt: 0 }),
  ];
  const order = (list) => plansOn(list, TODAY).map((x) => x.plan.id);
  assert.deepEqual(order(plans), ['c', 'b', 'd', 'a']);
  plans[2].done = [TODAY];
  assert.deepEqual(order(plans), ['c', 'b', 'd', 'a']);
  const items = plansOn([...plans, mwf({ id: 'z', date: TODAY, repeat: { days: [2], skip: [TODAY] } })], TODAY);
  assert.deepEqual(progress(items), { total: 4, done: 1 }); // 쉬어 가요는 세지 않는다
});

test('달력은 월요일부터 시작하고, 달을 넘겨 더해도 네 자리 연도 안에 있다', () => {
  const nov = monthKeys('2026-11');
  assert.equal(nov.flat().length, 42);
  assert.deepEqual(nov[0].slice(0, 7), [null, null, null, null, null, null, '2026-11-01']);
  const feb27 = monthKeys('2027-02').flat();
  assert.equal(feb27.length, 28);
  assert.equal(feb27[0], '2027-02-01');
  const feb28 = monthKeys('2028-02').flat();
  assert.equal(feb28.filter(Boolean).length, 29);
  assert.equal(feb28[0], null);
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('9999-12', 1), '9999-12');
  assert.equal(addMonths('1000-01', -1), '1000-01');
});

test('달력 점은 지난 날에는 했어요만, 오늘과 앞날에는 할 일도 그린다', () => {
  const plans = [
    mwf({ id: 'r', areaId: 'x', done: ['2026-11-02'], repeat: { days: [1, 3, 5], skip: ['2026-11-13'] } }),
    once({ id: 'a', date: '2026-11-11', createdAt: 3 }),
    once({ id: 'b', date: '2026-11-11', createdAt: 4 }),
    once({ id: 'c', date: '2026-11-11', createdAt: 5 }),
  ];
  const map = monthSummary(plans, '2026-11', TODAY);
  assert.deepEqual(map.get('2026-11-02'), { total: 1, done: 1, dots: [{ areaId: 'x', done: true }], more: false });
  assert.deepEqual(map.get('2026-11-04'), { total: 1, done: 0, dots: [], more: false }); // 지난 날의 안 한 계획은 점이 없다
  assert.equal(map.get('2026-11-11').dots.length, 3);
  assert.equal(map.get('2026-11-11').more, true);
  assert.equal(map.get('2026-11-11').dots[0].done, false);
  assert.equal(map.has('2026-11-13'), false); // 쉬어 가요만 있는 날
  assert.equal(map.has('2026-11-10'), false);
});

test('반복과 시간을 쉬운 말로 쓴다', () => {
  assert.equal(repeatLabel([0, 1, 2, 3, 4, 5, 6]), '매일');
  assert.equal(repeatLabel([5, 1, 2, 3, 4]), '평일');
  assert.equal(repeatLabel([6, 0]), '주말');
  assert.equal(repeatLabel([0, 3, 1]), '월·수·일');
  assert.equal(repeatLabel([1]), '월요일'); // '월마다'는 매달로 읽힌다
  assert.equal(repeatLabel([0]), '일요일');
  assert.deepEqual(['07:00', '07:30', '12:00', '00:00', '19:05', '12:30', '25:00', ''].map(clockLabel), [
    '오전 7시',
    '오전 7시 30분',
    '낮 12시',
    '밤 12시',
    '오후 7시 5분',
    '낮 12시 30분',
    '',
    '',
  ]);
});

test('다음에 할 날은 쉬어 가요를 건너뛰고, 끝난 반복은 null이다', () => {
  assert.equal(nextOn(mwf(), TODAY), '2026-11-11');
  assert.equal(nextOn(mwf({ repeat: { days: [1, 3, 5], skip: ['2026-11-11'] } }), TODAY), '2026-11-13');
  assert.equal(nextOn(mwf({ repeat: { days: [1, 3, 5], until: '2026-11-09', skip: [] } }), TODAY), null);
  assert.equal(nextOn(once({ date: '2026-11-20' }), TODAY), '2026-11-20');
  assert.equal(nextOn(once({ date: '2026-11-01' }), TODAY), null);
});

test('반복 계획을 고치면 모든 날이 바뀌고 했어요와 쉬어 가요는 그대로다', () => {
  const plan = mwf({ time: '07:00', minutes: 30, areaId: 'x', done: ['2026-11-02'], repeat: { days: [1, 3, 5], skip: ['2026-11-04'] } });
  const next = applyEdit(plan, { title: '저녁 운동', time: '19:00', minutes: null, days: [2, 4] });
  assert.equal(next.title, '저녁 운동');
  assert.equal(next.time, '19:00');
  assert.equal('minutes' in next, false);
  assert.equal(next.areaId, 'x');
  assert.deepEqual(next.repeat, { days: [2, 4], skip: ['2026-11-04'] });
  assert.deepEqual(next.done, ['2026-11-02']);
  assert.equal(next.date, '2026-11-02');
  assert.deepEqual(plan.repeat.days, [1, 3, 5]); // 원래 값은 건드리지 않는다
  // 요일을 0개로 만들 수 없고 시작한 날도 그대로다
  assert.deepEqual(applyEdit(plan, { days: [], date: '2026-11-20' }).repeat.days, [1, 3, 5]);
  assert.equal(applyEdit(plan, { date: '2026-11-20' }).date, '2026-11-02');
});

test('한 번짜리는 날짜를 옮길 수 있고, 했어요인 동안은 옮기지 않는다. 요일을 고르면 그날부터 반복이다', () => {
  assert.equal(applyEdit(once(), { date: '2026-11-12' }).date, '2026-11-12');
  assert.equal(applyEdit(once({ done: [TODAY] }), { date: '2026-11-12' }).date, TODAY);
  const repeat = applyEdit(once({ done: [TODAY] }), { days: [2, 4] });
  assert.deepEqual(repeat.repeat, { days: [2, 4], skip: [] });
  assert.deepEqual(repeat.done, [TODAY]);
  assert.equal(repeat.id, 'o');
});

test('바뀐 것이 없으면 samePlan이다', () => {
  const plan = mwf({ time: '07:00' });
  assert.equal(samePlan(plan, { title: '운동', time: '07:00', minutes: null, areaId: null, days: [5, 3, 1] }), true);
  assert.equal(samePlan(plan, { time: null }), false);
  assert.equal(samePlan(plan, { days: [1, 3] }), false);
  assert.equal(samePlan(plan, { date: '2026-11-20' }), true); // 반복의 날짜는 보지 않는다
  assert.equal(samePlan(once(), { date: '2026-11-20' }), false);
});

test('그만하기는 오늘 이전의 했어요를 지키고, 한 번도 안 한 반복은 지운다', () => {
  const plan = mwf({ done: ['2026-11-02', '2026-11-06'], repeat: { days: [1, 3, 5], skip: ['2026-11-04', '2026-11-13'] } });
  const ended = endFrom(plan, TODAY, TODAY);
  assert.deepEqual(ended.repeat, { days: [1, 3, 5], until: '2026-11-09', skip: ['2026-11-04'] });
  assert.deepEqual(ended.done, ['2026-11-02', '2026-11-06']);
  assert.equal(endFrom(mwf(), TODAY, TODAY), null);
  assert.equal(endFrom(mwf({ date: '2026-11-20' }), '2026-11-20', TODAY), null);
  // 첫날 했어요를 누르고 그날 그만두면 첫날 하루만 남는다
  const first = endFrom(mwf({ date: TODAY, repeat: { days: [2], skip: [] }, done: [TODAY] }), TODAY, TODAY);
  assert.equal(first.repeat.until, TODAY);
  assert.equal(stateOn(first, TODAY), 'done');
  // 더 일찍 끝나 있던 계획은 늦추지 않는다
  assert.equal(endFrom(mwf({ done: ['2026-11-02'], repeat: { days: [1, 3, 5], until: '2026-11-04', skip: [] } }), TODAY, TODAY).repeat.until, '2026-11-04');
  assert.equal(endFrom(once({ date: '2026-11-01' }), TODAY, TODAY).date, '2026-11-01');
  assert.equal(endFrom(once(), TODAY, TODAY), null);
});

test('오늘 했어요인 계획을 그만두면 내일부터 그만두고, 오늘 것은 남는다', () => {
  const daily = mwf({ repeat: { days: [0, 1, 2, 3, 4, 5, 6], skip: [] }, done: [TODAY] });
  const from = endStart(daily, TODAY, TODAY);
  assert.equal(from, '2026-11-11');
  const ended = endFrom(daily, from, TODAY);
  assert.equal(stateOn(ended, TODAY), 'done');
  assert.equal(stateOn(ended, '2026-11-11'), null);
  assert.equal(endStart(mwf(), '2026-11-04', TODAY), TODAY); // 지난 날에서 눌러도 오늘부터
  assert.equal(endStart(mwf(), '2026-11-13', TODAY), '2026-11-13');
});

test('기록하기는 했어요이고 숨기지 않은 영역이고 30일 안이며 아직 기록하지 않은 계획에만 나온다', () => {
  const areas = [{ id: 'x', label: '운동' }, { id: 'h', label: '숨김', archived: true }];
  const yoga = once({ id: 'p1', areaId: 'x', done: [TODAY] });
  const run = once({ id: 'p2', areaId: 'x', done: [TODAY] });
  const entries = [{ id: 'e1', date: TODAY, areaId: 'x', minutes: 30, createdAt: 5, planId: 'p1' }];
  // 같은 날 같은 영역 계획이 둘이어도 따로 판단한다
  assert.equal(logInfo(yoga, TODAY, { areas, entries }, TODAY).entry.id, 'e1');
  assert.deepEqual(logInfo(run, TODAY, { areas, entries }, TODAY), { can: true });
  assert.deepEqual(logInfo(once({ areaId: 'h', done: [TODAY] }), TODAY, { areas, entries }, TODAY), {});
  assert.deepEqual(logInfo(once({ areaId: 'x' }), TODAY, { areas, entries }, TODAY), {}); // 아직 안 했다
  assert.deepEqual(logInfo(once({ areaId: 'x' }), TODAY, { areas, entries: [] }, TODAY), {});
  const old = once({ date: '2026-10-11', areaId: 'x', done: ['2026-10-11'] });
  assert.deepEqual(logInfo(old, '2026-10-11', { areas, entries }, TODAY), {});
  const edge = once({ date: '2026-10-12', areaId: 'x', done: ['2026-10-12'] });
  assert.deepEqual(logInfo(edge, '2026-10-12', { areas, entries }, TODAY), { can: true });
});

test('이을 수 있는 기록은 그날 그 영역에서 계획과 잇지 않은 것을 최근 것부터 3개까지다', () => {
  const entries = [
    { id: 'a', date: TODAY, areaId: 'x', createdAt: 1 },
    { id: 'b', date: TODAY, areaId: 'x', createdAt: 4, planId: 'p' },
    { id: 'c', date: TODAY, areaId: 'x', createdAt: 3 },
    { id: 'd', date: TODAY, areaId: 'y', createdAt: 9 },
    { id: 'e', date: '2026-11-09', areaId: 'x', createdAt: 9 },
    { id: 'f', date: TODAY, areaId: 'x', createdAt: 2 },
    { id: 'g', date: TODAY, areaId: 'x', createdAt: 0 },
  ];
  assert.deepEqual(looseEntries(entries, [{ id: 'p' }], 'x', TODAY).map((e) => e.id), ['c', 'f', 'a']);
  // 지운 계획을 가리키는 기록은 다시 이을 수 있다
  assert.deepEqual(looseEntries(entries, [], 'x', TODAY).map((e) => e.id), ['b', 'c', 'f']);
});

test('앞날부터 그만두면 한 번도 안 했어도 그 전 날까지는 남는다', () => {
  const daily = mwf({ date: TODAY, repeat: { days: [0, 1, 2, 3, 4, 5, 6], skip: [] } });
  const ended = endFrom(daily, '2026-11-17', TODAY);
  assert.equal(ended.repeat.until, '2026-11-16');
  assert.equal(occursOn(ended, '2026-11-16'), true);
  assert.equal(occursOn(ended, '2026-11-17'), false);
  // 오늘부터 그만두면 남길 것이 없으니 지운다
  assert.equal(endFrom(daily, TODAY, TODAY), null);
  // 앞날까지 잡힌 날이 없으면(목요일만인데 수요일부터 그만두기) 지운다
  assert.equal(endFrom(mwf({ date: TODAY, repeat: { days: [4], skip: [] } }), '2026-11-11', TODAY), null);
});

test('끝낸 반복이 했어요도 잡힌 날도 없으면 어디에도 보이지 않는 계획이다', () => {
  assert.equal(isHidden(mwf({ repeat: { days: [2], until: '2026-11-02', skip: [] } })), true);
  assert.equal(isHidden(mwf({ repeat: { days: [2], until: '2026-11-02', skip: [] }, done: ['2026-11-02'] })), false);
  assert.equal(isHidden(mwf({ repeat: { days: [1], until: '2026-11-02', skip: [] } })), false);
  assert.equal(isHidden(mwf()), false);
  assert.equal(isHidden(once()), false);
});
