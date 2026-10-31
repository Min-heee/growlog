// node --test tests/ 로 실행한다
import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, weekStartKey } from '../js/dates.js';
import { insight } from '../js/insight.js';
import { buildSample } from '../js/sample.js';
import { createDefaultState, isBackup, normalize } from '../js/store.js';

const TODAY = '2026-10-31';

function stateWith(days, patch = {}, rating = { energy: 3, stress: 3, mood: 3 }) {
  const state = createDefaultState();
  for (let i = 0; i < days; i++) {
    const date = addDays(TODAY, -i);
    state.checkins[date] = { ...rating };
    state.sleep[date] = { bed: '23:00', wake: '06:30', quality: 3 };
  }
  return Object.assign(state, patch);
}

test('기록 수에 따라 단계가 달라진다', () => {
  assert.equal(insight(createDefaultState(), TODAY).status, 'empty');
  assert.equal(insight(stateWith(6), TODAY).status, 'building');
  assert.equal(insight(stateWith(27), TODAY).status, 'building');
  const trend = insight(stateWith(28), TODAY);
  assert.equal(trend.status, 'trend');
  assert.equal(trend.band, 'usual');
});

test('기록이 끊기면 모른다고 말한다', () => {
  const shifted = (back) => {
    const state = stateWith(40);
    for (const date of Object.keys(state.checkins)) if (date > addDays(TODAY, -back)) delete state.checkins[date];
    return state;
  };
  assert.equal(insight(shifted(3), TODAY).status, 'trend');
  assert.equal(insight(shifted(5), TODAY).status, 'unknown');
  assert.equal(insight(shifted(20), TODAY).status, 'restart');
});

test('다시 시작한 뒤 며칠은 평소 범위라고 말하지 않는다', () => {
  const state = stateWith(60);
  for (const date of Object.keys(state.checkins)) if (date > addDays(TODAY, -20) && date < addDays(TODAY, -1)) delete state.checkins[date];
  const i = insight(state, TODAY);
  assert.equal(i.status, 'trend');
  assert.equal(i.band, 'restart');
});

test('지친 날 표시는 그 전 2주를 함께 보여준다', () => {
  const state = stateWith(40, { marks: [{ id: 'a', date: addDays(TODAY, -3), sev: 2, fuzz: 0, createdAt: 0 }], supportSeen: Date.now() });
  const [episode] = insight(state, TODAY).episodes;
  assert.equal(episode.open, true);
  assert.equal(episode.hardDays, 0);
  assert.equal(episode.logged, 14);
  assert.ok(episode.level != null);
});

test('돌아보기의 5는 약한 표시로 치고, 답을 고치면 사라진다', () => {
  const on = TODAY;
  const week = weekStartKey(on);
  assert.equal(insight(stateWith(30, { weekly: { [week]: { built: 5, on } } }), TODAY).episodes.length, 1);
  assert.equal(insight(stateWith(30, { weekly: { [week]: { built: 4, on } } }), TODAY).episodes.length, 0);
});

test('심한 표시는 도움 안내를 바로 띄우고, 닫으면 사라진다', () => {
  const mark = { id: 'a', date: TODAY, sev: 3, fuzz: 0, createdAt: 1000 };
  assert.equal(insight(stateWith(5, { marks: [mark], supportSeen: 0 }), TODAY).support?.id, 'H3');
  assert.equal(insight(stateWith(5, { marks: [mark], supportSeen: 2000 }), TODAY).support, null);
});

test('2주 대부분이 낮은 평점이면 안내하고, 그래도 숫자는 말하지 않는다', () => {
  const i = insight(stateWith(14, {}, { energy: 2, stress: 3, mood: 3 }), TODAY);
  assert.equal(i.support?.id, 'H1');
  assert.doesNotMatch(i.support.text, /\d/);
});

test('낮은 평소가 안내를 가리지 않는다: 28일 내내 낮아도 안내한다', () => {
  assert.equal(insight(stateWith(60, {}, { energy: 1, stress: 3, mood: 1 }), TODAY).support?.id, 'H1');
});

test('오래된 회복 중 표시와 긴 표시 상태는 새 평소를 묻는다', () => {
  const state = stateWith(120, { marks: [{ id: 'a', date: addDays(TODAY, -60), sev: 2, fuzz: 0, createdAt: 0 }], supportSeen: Date.now() });
  for (let i = 0; i < 60; i++) state.checkins[addDays(TODAY, -i)] = { energy: 2, stress: 4, mood: 2 };
  assert.equal(insight(state, TODAY).newNormal, true);
  state.marks.push({ id: 'b', date: addDays(TODAY, -2), rebase: true, closedOn: addDays(TODAY, -2), createdAt: 0 });
  assert.equal(insight(state, TODAY).newNormal, false);
});

test('일하는 사람에게만 주 52·55시간 메모를 보여준다', () => {
  const state = stateWith(40);
  state.areas = [{ id: 'dev', kind: 'load', label: '개발' }];
  for (let i = 1; i <= 28; i++) state.entries.push({ date: addDays(TODAY, -i), areaId: 'dev', minutes: 500, id: `e${i}`, createdAt: 0 });
  const note = () => insight(state, TODAY).notes.find((n) => n.includes('주 평균'));
  assert.equal(note(), undefined);
  state.profile.role = 'worker';
  assert.match(note(), /건강/);
  assert.doesNotMatch(note(), /뇌졸중|심장/);
});

test('주 52시간을 조금 넘으면 52시간보다 많다고 앞뒤가 맞게 말한다', () => {
  const state = stateWith(40, { profile: { role: 'worker', age: 'adult', hide: false } });
  state.areas = [{ id: 'dev', kind: 'load', label: '개발' }];
  for (let i = 1; i <= 28; i++) state.entries.push({ date: addDays(TODAY, -i), areaId: 'dev', minutes: 465, id: `e${i}`, createdAt: 0 });
  assert.match(insight(state, TODAY).notes.find((n) => n.includes('주 평균')), /주 평균 52\.\d시간으로/);
});

test('18세 미만에게는 성인 권장 수면을 말하지 않는다', () => {
  const state = stateWith(10, { profile: { role: 'student', age: 'u18', hide: false } });
  for (let i = 0; i < 7; i++) state.sleep[addDays(TODAY, -i)] = { bed: '00:00', wake: '06:30' };
  const note = insight(state, TODAY).notes.find((n) => n.includes('평균 수면'));
  assert.match(note, /14~17세/);
});

test('기록을 멈춘 것을 힘든 날이 이어진 것으로 보지 않는다', () => {
  const state = stateWith(70, { supportSeen: 1 });
  for (let i = 1; i <= 4; i++) state.checkins[addDays(TODAY, -13 - i)] = { energy: 1, stress: 5, mood: 1 };
  for (const date of Object.keys(state.checkins)) if (date > addDays(TODAY, -13)) delete state.checkins[date];
  const i = insight(state, TODAY);
  assert.notEqual(i.support?.id, 'H2');
  assert.equal(i.newNormal, false);
});

test('평소를 새로 잡는 동안에는 그 전 평소를 보여준다', () => {
  const state = stateWith(70, { marks: [{ id: 'a', date: addDays(TODAY, -5), sev: 3, fuzz: 0, closedOn: addDays(TODAY, -1), createdAt: 1 }], supportSeen: Date.now() });
  state.checkins[TODAY] = { energy: 1, stress: 5, mood: 1 };
  const i = insight(state, TODAY);
  assert.equal(i.rebuilding, true);
  assert.notEqual(i.usual.stress.mid, 5);
  assert.ok(i.personal.own > 0.9);
});

test('2주쯤 끊겼다 돌아온 하루로 긴 상태라고 말하지 않는다', () => {
  const state = stateWith(120, { supportSeen: 1 });
  for (let i = 12; i < 80; i++) state.checkins[addDays(TODAY, -i)] = { energy: 1, stress: 5, mood: 1 };
  for (let i = 1; i < 12; i++) delete state.checkins[addDays(TODAY, -i)];
  state.checkins[TODAY] = { energy: 3, stress: 3, mood: 3 };
  const i = insight(state, TODAY);
  assert.equal(i.newNormal, false);
});

test('닫은 심한 표시는 도움 안내를 계속 띄우지 않는다', () => {
  const mark = { id: 'a', date: addDays(TODAY, -40), sev: 3, fuzz: 0, closedOn: addDays(TODAY, -30), createdAt: 1000 };
  assert.equal(insight(stateWith(50, { marks: [mark], supportSeen: 0 }), TODAY).support?.id ?? null, null);
});

test('평점 없이 수면과 타이머만 있어도 저장된 기록을 알려주고 부하를 보여준다', () => {
  const state = stateWith(0, { supportSeen: Date.now() });
  state.areas = [{ id: 'dev', kind: 'load', label: '개발' }];
  for (let i = 0; i < 30; i++) {
    const date = addDays(TODAY, -i);
    state.sleep[date] = { bed: '01:00', wake: '06:30' };
    state.entries.push({ date, areaId: 'dev', minutes: 480, id: `e${i}`, createdAt: 0 });
  }
  state.marks = [{ id: 'a', date: addDays(TODAY, -1), sev: 2, fuzz: 0, createdAt: 0 }];
  const i = insight(state, TODAY);
  assert.equal(i.status, 'empty');
  assert.equal(i.savedDays, 30);
  assert.equal(i.episodes[0].loadHoursPerWeek, 56);
});

test('정확하다고 남긴 표시는 돌아보기와 묶여도 어림으로 바뀌지 않는다', () => {
  const on = addDays(TODAY, -3);
  const state = stateWith(30, { marks: [{ id: 'a', date: TODAY, sev: 2, fuzz: 0, createdAt: 0 }], weekly: { [weekStartKey(on)]: { built: 5, on } }, supportSeen: Date.now() });
  const [episode] = insight(state, TODAY).episodes;
  assert.equal(episode.fuzz, 0);
  assert.deepEqual([...episode.dates].sort(), [on, TODAY]);
});

test('늘 적게 자는 사람에게는 평소보다 높다고 하지 않고 새 평소도 묻지 않는다', () => {
  const state = stateWith(120, { supportSeen: Date.now() });
  for (const date of Object.keys(state.checkins)) state.sleep[date] = { bed: '02:00', wake: '06:30' };
  const i = insight(state, TODAY);
  assert.equal(i.newNormal, false);
  if (i.band === 'higher' || i.band === 'sustained') assert.equal(i.sleepOnly, true);
});

test('숨겨둔 추정을 도움 안내가 말하지 않고, 힘든 날 수와 어긋나지 않는다', () => {
  const low = stateWith(30, { supportSeen: 1 });
  for (let i = 0; i < 12; i++) low.checkins[addDays(TODAY, -i)] = { energy: 2, stress: 3, mood: 3 };
  const i = insight(low, TODAY);
  assert.equal(i.support?.id, 'H1');
  assert.equal(i.recent.hard, 0);
  assert.doesNotMatch(i.support.text, /힘든 날|평소/);
});

test('빠진 날로 긴 상태가 채워지지 않는다', () => {
  const state = stateWith(110, { supportSeen: 1 });
  for (let i = 4; i < 17; i++) state.checkins[addDays(TODAY, -i)] = { energy: 1, stress: 5, mood: 1 };
  for (let i = 1; i < 4; i++) delete state.checkins[addDays(TODAY, -i)];
  state.checkins[TODAY] = { energy: 3, stress: 3, mood: 3 };
  assert.notEqual(insight(state, TODAY).support?.id, 'H2');
});

test('고쳐 쓰다 지운 메모는 저장된 기록으로 세지 않는다', () => {
  const state = stateWith(0);
  state.checkins[TODAY] = { note: '' };
  assert.equal(insight(state, TODAY).savedDays, 0);
});

test('평점 없이 수면만 남겨도 지친 날에 수면 부족이 나온다', () => {
  const state = stateWith(0, { supportSeen: Date.now(), marks: [{ id: 'a', date: addDays(TODAY, -1), sev: 2, fuzz: 0, createdAt: 0 }] });
  for (let i = 0; i < 20; i++) state.sleep[addDays(TODAY, -i)] = { bed: '01:00', wake: '06:00' };
  const [episode] = insight(state, TODAY).episodes;
  assert.ok(episode.debtH > 5, `debt ${episode.debtH}`);
});

test('차트는 늘 최근 60일을 그리고, 기록이 시작되기 전에 표시한 날도 들어간다', () => {
  const state = stateWith(30, { supportSeen: Date.now(), marks: [{ id: 'a', date: addDays(TODAY, -45), sev: 1, fuzz: 0, createdAt: 0 }] });
  const i = insight(state, TODAY);
  assert.equal(i.trend.length, 60);
  assert.ok(i.trend.some((p) => p.key === addDays(TODAY, -45)));
  assert.equal(i.trend.find((p) => p.key === addDays(TODAY, -45)).debt, null);
});

test('수면 기록이 없는 날의 수면 부족은 차트에 나오지 않는다', () => {
  const state = stateWith(40, { sleep: {} });
  assert.ok(insight(state, TODAY).trend.every((p) => p.debt == null));
});

test('회복 중 표시를 잊었어도 평소 범위인 사람에게 새 평소를 묻지 않는다', () => {
  const state = stateWith(120, { marks: [{ id: 'a', date: addDays(TODAY, -80), sev: 2, fuzz: 0, createdAt: 0 }], supportSeen: Date.now() });
  const i = insight(state, TODAY);
  assert.equal(i.band, 'usual');
  assert.equal(i.newNormal, false);
});

test('막 힘들어지기 시작한 때를 수면 탓이라고 말하지 않는다', () => {
  const state = stateWith(60, { supportSeen: Date.now() });
  for (let i = 0; i < 60; i++) state.sleep[addDays(TODAY, -i)] = { bed: '23:30', wake: '06:45' };
  for (let i = 0; i < 6; i++) state.sleep[addDays(TODAY, -i)] = { bed: '01:30', wake: '06:30' };
  for (let i = 0; i < 3; i++) state.checkins[addDays(TODAY, -i)] = { energy: 2, stress: 5, mood: 2 };
  assert.equal(insight(state, TODAY).sleepOnly, false);
});

test('처음부터 회복 중만 있으면 평소와 비교한다고 말하지 않는다', () => {
  const state = stateWith(40, { marks: [{ id: 'a', date: addDays(TODAY, -41), sev: 2, fuzz: 0, createdAt: 0 }], supportSeen: Date.now() });
  const i = insight(state, TODAY);
  assert.equal(i.status, 'noUsual');
  assert.equal(i.band, null);
  assert.equal(i.flag, null);
  assert.ok(i.trend.every((p) => p.T == null));
});

test('지친 채로 시작해 표시를 닫고 그대로 지내면 첫 비교부터 평소 범위로 나온다', () => {
  const start = addDays(TODAY, -60);
  const state = stateWith(0, { supportSeen: Date.now(), marks: [{ id: 'a', date: start, sev: 3, fuzz: 0, closedOn: addDays(start, 44), createdAt: 0 }] });
  for (let i = 0; i <= 60; i++) {
    const date = addDays(start, i);
    state.checkins[date] = { energy: 2, stress: 4, mood: 2 };
    state.sleep[date] = { bed: '23:00', wake: '06:00' };
  }
  const bands = Array.from({ length: 16 }, (_, k) => insight(state, addDays(start, 45 + k)));
  const first = bands.find((i) => i.status === 'trend');
  assert.ok(first, bands.map((i) => i.status).join());
  assert.equal(first.band, 'usual');
  assert.equal(first.flagged, false);
});

test('새로 쓰는 사람의 잠정 평소에는 내 기록이 조금씩 반영된다', () => {
  assert.ok(insight(stateWith(8), TODAY).personal.own > 0.5);
});

test('회복 중으로 뺀 날이 있으면 잠정 평소가 생겼다고 말하지 않는다', () => {
  const state = stateWith(9, { marks: [{ id: 'a', date: addDays(TODAY, -8), sev: 2, fuzz: 0, createdAt: 0 }], supportSeen: Date.now() });
  const i = insight(state, TODAY);
  assert.equal(i.status, 'noUsual');
  assert.equal(i.personal.own, 0);
});

test('하루 이틀뿐인 평소로 비교하지 않는다', () => {
  const state = stateWith(40, { marks: [{ id: 'a', date: addDays(TODAY, -35), sev: 2, fuzz: 0, createdAt: 0 }], supportSeen: Date.now() });
  assert.equal(insight(state, TODAY).status, 'noUsual');
});

test('회복 중 표시를 닫으면 며칠 뒤 평소를 잡기 시작하고, 평소를 못 잡아 멈춰 있지 않는다', () => {
  const state = stateWith(120, { supportSeen: Date.now(), marks: [{ id: 'a', date: addDays(TODAY, -120), sev: 2, fuzz: 0, closedOn: addDays(TODAY, -75), createdAt: 0 }] });
  for (const date of Object.keys(state.checkins)) state.checkins[date] = { energy: 2, stress: 4, mood: 2 };
  assert.equal(insight(state, addDays(TODAY, -72)).status, 'noUsual');
  const i = insight(state, TODAY);
  assert.equal(i.status, 'trend');
  assert.equal(i.band, 'usual');
});

test('며칠 끊긴 동안에는 새 평소를 묻지 않는다', () => {
  const state = stateWith(120, { supportSeen: Date.now() });
  for (let i = 6; i < 70; i++) state.checkins[addDays(TODAY, -i)] = { energy: 2, stress: 4, mood: 2 };
  for (let i = 0; i < 6; i++) delete state.checkins[addDays(TODAY, -i)];
  assert.equal(insight(state, TODAY).status, 'unknown');
  assert.equal(insight(state, TODAY).newNormal, false);
});

test('오래 열린 표시가 있어도 오늘 처음 높아졌으면 새 평소를 묻지 않는다', () => {
  const state = stateWith(120, { marks: [{ id: 'a', date: addDays(TODAY, -80), sev: 2, fuzz: 0, createdAt: 0 }], supportSeen: Date.now() });
  for (let i = 0; i < 2; i++) state.checkins[addDays(TODAY, -i)] = { energy: 1, stress: 5, mood: 1 };
  assert.equal(insight(state, TODAY).newNormal, false);
});

test('수면 기록이 없으면 수면 부족을 0시간이라고 말하지 않는다', () => {
  const state = stateWith(40, { sleep: {}, marks: [{ id: 'a', date: addDays(TODAY, -3), sev: 2, fuzz: 0, createdAt: 0 }], supportSeen: Date.now() });
  const i = insight(state, TODAY);
  assert.equal(i.debt, null);
  assert.equal(i.episodes[0].debtH, null);
});

test('14일 넘게 끊기면 예전 수면 부족을 보여주지 않는다', () => {
  const state = stateWith(40);
  for (const date of Object.keys(state.sleep)) state.sleep[date] = { bed: '02:00', wake: '06:00' };
  for (const map of [state.checkins, state.sleep]) for (const date of Object.keys(map)) if (date > addDays(TODAY, -20)) delete map[date];
  const i = insight(state, TODAY);
  assert.equal(i.status, 'restart');
  assert.equal(i.debt, null);
});

test('표시하지 않은 주말까지 일한 것처럼 부하를 부풀리지 않는다', () => {
  const state = stateWith(30, { marks: [{ id: 'a', date: addDays(TODAY, -1), sev: 1, fuzz: 0, createdAt: 0 }], supportSeen: Date.now() });
  state.areas = [{ id: 'dev', kind: 'load', label: '개발' }];
  state.entries.push({ date: addDays(TODAY, -25), areaId: 'dev', minutes: 600, id: 'older', createdAt: 0 });
  for (let i = 1; i <= 14; i++) if (i % 7 > 1) state.entries.push({ date: addDays(TODAY, -i), areaId: 'dev', minutes: 600, id: `e${i}`, createdAt: 0 });
  for (let i = 1; i <= 14; i++) if (i % 7 <= 1) delete state.checkins[addDays(TODAY, -i)];
  assert.equal(insight(state, TODAY).episodes[0].loadHoursPerWeek, 50);
});

test('샘플은 모든 화면을 보여줄 수 있다', () => {
  const i = insight(buildSample(), addDays(new Date().toISOString().slice(0, 10), 0));
  assert.ok(i.entries >= 60);
  assert.equal(i.status, 'trend');
  assert.equal(i.episodes.length, 3);
  assert.ok(i.overlay);
});

test('백업에는 표시와 돌아보기가 함께 들어가고, 잘못된 값은 버린다', () => {
  const state = buildSample();
  const copy = normalize(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(copy.marks, state.marks);
  assert.deepEqual(copy.weekly, state.weekly);
  assert.ok(isBackup(state));
  const bad = normalize({ areas: [], entries: [], marks: [null, { date: 'x', sev: 2 }, { date: TODAY, sev: 9 }, { date: TODAY, sev: 2, tag: '<b>', fuzz: 99, closedOn: 'y' }], weekly: { nope: { built: 3 }, [TODAY]: { built: 9, on: 'z' } }, profile: { role: 'x', age: 1, hide: 'y' }, supportSeen: 'q' });
  assert.equal(bad.marks.length, 1);
  assert.equal(bad.marks[0].tag, undefined);
  assert.equal(bad.marks[0].fuzz, 0);
  assert.equal(bad.marks[0].closedOn, undefined);
  assert.deepEqual(bad.weekly, {});
  assert.deepEqual(bad.profile, { role: 'other', age: 'adult', hide: false });
  assert.equal(bad.supportSeen, 0);
});

test('예전 백업은 표시 없이 그대로 열린다', () => {
  const old = normalize({ areas: [], entries: [], checkins: { [TODAY]: { energy: 3, stress: 3, mood: 3, note: '메모' } } });
  assert.deepEqual(old.marks, []);
  assert.deepEqual(old.weekly, {});
  assert.equal(old.checkins[TODAY].note, '메모');
  assert.equal(insight(old, TODAY).status, 'building');
});
