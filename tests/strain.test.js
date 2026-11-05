// node --test 로 실행한다
import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays } from '../js/dates.js';
import { dailyLog, dayKey, dayNum, derive, effectOf, K, tailProb } from '../js/strain.js';

const TODAY = '2026-10-31';
const PROFILE = { role: 'other', age: 'adult', sleepGoal: 7 };

function seeded(seed) {
  let n = seed;
  return () => {
    n = (n * 1664525 + 1013904223) >>> 0;
    return n / 4294967296;
  };
}

/** 5점 척도로 반올림한 가우시안 AR(.3) 평점. 앞뒤 날이 조금 닮은 사람을 흉내 낸다. */
function person(days, { seed = 1, shift = () => 0, skip = 0.15, today = TODAY } = {}) {
  const rand = seeded(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  let ar = 0;
  const log = [];
  for (let i = 0; i < days; i++) {
    ar = 0.3 * ar + Math.sqrt(1 - 0.09) * gauss();
    if (rand() < skip) continue;
    const add = shift(i) * 0.8;
    const rate = (sign) => Math.min(5, Math.max(1, Math.round(3 + sign * (0.8 * (0.6 * ar + 0.8 * gauss()) + add))));
    log.push({ date: addDays(today, i - days + 1), energy: rate(-1), stress: rate(1), mood: rate(-1), sleepQ: rate(-1), tibH: 7 + 0.5 * gauss() - shift(i) * 0.5, loadMin: 300 + 60 * gauss() + shift(i) * 60, recMin: 0 });
  }
  return log;
}

test('기록이 없으면 빈 결과를 낸다', () => {
  const r = derive([], [], PROFILE, TODAY);
  assert.equal(r.entries, 0);
  assert.deepEqual(r.days, []);
  assert.equal(r.theta, K.THETA0);
});

test('기록이 없어도 지친 날은 라벨로 남는다', () => {
  const r = derive([], [{ date: TODAY, sev: 2 }], PROFILE, TODAY);
  assert.equal(r.episodes.length, 1);
  assert.equal(r.episodes[0].level, null);
  assert.equal(r.episodes[0].visible, false);
});

test('NaN 없이 끝나고, 28일 전에는 단계 말을 하지 않는다', () => {
  const r = derive(person(120), [], PROFILE, TODAY);
  for (const d of r.days.filter((x) => x.logged)) {
    assert.ok(Number.isFinite(d.S) && Number.isFinite(d.U) && Number.isFinite(d.debt), `day ${d.t}`);
  }
  const early = r.days.filter((d) => d.logged).slice(0, K.TREND_MIN - 1);
  assert.ok(early.every((d) => d.band === 'building' && d.T == null));
});

test('하루 나쁜 날로는 알리지 않는다', () => {
  const log = person(90, { skip: 0 });
  Object.assign(log.at(-1), { energy: 1, stress: 5, mood: 1, sleepQ: 1, tibH: 3 });
  const r = derive(log, [], PROFILE, TODAY);
  assert.equal(r.days.at(-1).flagged, false);
});

test('안정적인 사람에게는 거의 알리지 않고, 오래 높아지면 알린다', () => {
  let calm = 0;
  let found = 0;
  const runs = 40;
  for (let seed = 1; seed <= runs; seed++) {
    calm += derive(person(365, { seed }), [], PROFILE, TODAY).flags.length;
    const log = person(365, { seed, shift: (i) => (i >= 245 ? 1 : 0) });
    if (derive(log, [], PROFILE, TODAY).flags.some((t) => t >= dayNum(TODAY) - 120)) found++;
  }
  assert.ok(calm / runs < 0.8, `stationary flags/year ${calm / runs}`);
  assert.ok(found / runs > 0.85, `sustained rise caught ${found / runs}`);
});

test('한 번의 긴 잠으로 수면 빚이 다 사라지지 않는다', () => {
  const short = Array.from({ length: 14 }, (_, i) => ({ date: addDays(TODAY, i - 14), energy: 3, stress: 3, mood: 3, tibH: 5, loadMin: null, recMin: 0 }));
  const before = derive(short, [], PROFILE, addDays(TODAY, -1)).days.at(-1).debt;
  const after = derive([...short, { date: TODAY, energy: 3, stress: 3, mood: 3, tibH: 12, loadMin: null, recMin: 0 }], [], PROFILE, TODAY).days.at(-1).debt;
  assert.ok(before > 8, `debt ${before}`);
  assert.ok(after > before * 0.6, `after ${after}`);
});

test('기록이 2주 끊기면 부하를 0에서 다시 시작하지만 평소는 남긴다', () => {
  const log = person(120, { shift: () => 1 }).filter((e) => dayNum(e.date) <= dayNum(TODAY) - 20);
  const r = derive(log, [], PROFILE, TODAY);
  assert.equal(r.days.at(-1).logged, false);
  const back = derive([...log, { date: TODAY, energy: 3, stress: 3, mood: 3, loadMin: null, recMin: 0 }], [], PROFILE, TODAY);
  const day = back.days.at(-1);
  assert.ok(Math.abs(day.S) < 0.2);
  assert.ok(back.base.length > 0);
  assert.equal(day.flagged, false);
});

test('표시 두 번으로는 기준이 움직이지 않는다', () => {
  const log = person(200, { seed: 7, skip: 0, shift: (i) => (i >= 150 && i < 165 ? 1.5 : 0) });
  const date = addDays(TODAY, -36);
  const one = derive(log, [{ date, sev: 2, closedOn: addDays(TODAY, -30) }], PROFILE, TODAY);
  const two = derive(log, [{ date, sev: 2, closedOn: addDays(TODAY, -30) }, { date: addDays(TODAY, -5), sev: 2 }], PROFILE, TODAY);
  assert.equal(one.theta, K.THETA0);
  assert.equal(two.theta, K.THETA0);
  assert.equal(one.episodes.length, 1);
});

test('14일 안의 표시는 한 번으로 묶는다', () => {
  const log = person(100, { skip: 0 });
  const a = addDays(TODAY, -30);
  const r = derive(log, [{ date: a, sev: 1 }, { date: addDays(a, 10), sev: 3, closedOn: addDays(a, 12) }], PROFILE, TODAY);
  assert.equal(r.episodes.length, 1);
  assert.equal(r.episodes[0].sev, 3);
  assert.equal(r.episodes[0].marks.length, 2);
});

test('심하게 멈췄던 일을 닫으면 그 뒤로 평소를 새로 잡는다', () => {
  const log = person(120, { skip: 0 });
  const closed = addDays(TODAY, -20);
  const r = derive(log, [{ date: addDays(TODAY, -30), sev: 3, closedOn: closed }], PROFILE, TODAY);
  const after = r.hist.filter((h) => h.t > dayNum(closed));
  assert.ok(after.every((h) => h.seg === 1));
  assert.ok(r.base.every((h) => h.seg === 1));
  const flagsSoon = r.flags.filter((t) => t > dayNum(closed) && t <= dayNum(closed) + K.HOLD_SEG);
  assert.equal(flagsSoon.length, 0);
});

test('뒤늦게 표시해도 같은 결과로 다시 계산된다', () => {
  const log = person(100);
  const marks = [{ date: addDays(TODAY, -10), sev: 2 }];
  assert.deepEqual(derive(log, marks, PROFILE, TODAY).days, derive(log, [...marks], PROFILE, TODAY).days);
});

test('요즘을 새 평소로 삼으면 회복 중 표시가 열려 있어도 평소를 새로 쌓는다', () => {
  const log = person(330, { seed: 1, skip: 0.05, shift: (i) => (i >= 150 ? 2 : 0) });
  const open = { date: addDays(TODAY, -150), sev: 2 };
  const rebase = { date: addDays(TODAY, -60), rebase: true, closedOn: addDays(TODAY, -60) };
  const r = derive(log, [open, rebase], PROFILE, TODAY);
  assert.ok(r.base.length > 20, `base ${r.base.length}`);
  assert.equal(r.days.at(-1).recovering, true);
  assert.ok(r.days.slice(-30).filter((d) => d.logged).every((d) => d.zL != null));
});

test('새 평소로 삼으면 2주 동안 다시 비교하지 않고, 평소 범위라고 말하지 않는다', () => {
  const rebaseAt = addDays(TODAY, -5);
  const log = person(200, { skip: 0, shift: () => 1.5 });
  const r = derive(log, [{ date: rebaseAt, rebase: true, closedOn: rebaseAt }], PROFILE, TODAY);
  const after = r.days.filter((d) => d.t > dayNum(rebaseAt));
  assert.ok(after.length >= 4);
  assert.ok(after.every((d) => d.band === 'restart'));
});

test('심한 표시를 닫은 뒤에도 힘든 날이 이어지면 평소 범위라고 말하지 않고 다시 알린다', () => {
  const calm = { energy: 4, stress: 2, mood: 4, tibH: 7, loadMin: 300, recMin: 0 };
  const hard = { energy: 1, stress: 5, mood: 1, tibH: 5, loadMin: 600, recMin: 0 };
  const log = Array.from({ length: 100 }, (_, i) => ({ date: addDays(TODAY, i - 99), ...(i < 60 ? calm : hard) }));
  const mark = { date: addDays(TODAY, -35), sev: 3, closedOn: addDays(TODAY, -30) };
  const r = derive(log, [mark], PROFILE, TODAY);
  const after = r.days.filter((d) => d.t > dayNum(mark.closedOn));
  assert.ok(after.every((d) => d.band !== 'usual'), after.map((d) => d.band).join());
  assert.ok(after.some((d) => d.flagged));
  assert.ok(r.base.every((h) => !h.hard));
});

test('심한 표시를 닫고 괜찮아지면 평소 범위로 돌아온다', () => {
  const calm = { energy: 4, stress: 2, mood: 4, tibH: 7, loadMin: 300, recMin: 0 };
  const hard = { energy: 1, stress: 5, mood: 1, tibH: 5, loadMin: 600, recMin: 0 };
  const log = Array.from({ length: 150 }, (_, i) => ({ date: addDays(TODAY, i - 149), ...(i >= 60 && i < 90 ? hard : calm) }));
  const r = derive(log, [{ date: addDays(TODAY, -65), sev: 3, closedOn: addDays(TODAY, -60) }], PROFILE, TODAY);
  assert.equal(r.days.at(-1).band, 'usual');
  assert.ok(r.base.length > 20);
});

test('기록이 끊긴 사이 하룻밤만 남겼어도 오래 끊기면 수면 부족을 비운다', () => {
  const short = Array.from({ length: 60 }, (_, i) => ({ date: addDays(TODAY, i - 130), energy: 3, stress: 3, mood: 3, tibH: 4.5, loadMin: null, recMin: 0 }));
  const lastDay = short.at(-1).date;
  const r = derive([...short, { date: addDays(lastDay, 1), tibH: 4.5, loadMin: null, recMin: 0 }, { date: TODAY, energy: 3, stress: 3, mood: 3, loadMin: null, recMin: 0 }], [], PROFILE, TODAY);
  assert.equal(r.debt, 0);
});

test('기록이 끊겨 끝난 높은 구간은 표시 없이 지나간 때로 세지 않는다', () => {
  const log = person(200, { skip: 0, shift: (i) => (i > 170 ? 2.5 : 0) }).filter((e) => dayNum(e.date) <= dayNum(TODAY) - 2);
  const stopped = log.filter((e) => e.date <= addDays(TODAY, -3));
  const a = derive(stopped, [], PROFILE, addDays(TODAY, 40));
  assert.ok(a.flags.length >= 1);
  assert.equal(a.quiet, 0);
});

test('2주 공백은 닫은 뒤의 쉬는 기간을 줄이지 않는다', () => {
  const hard = { energy: 1, stress: 5, mood: 1, tibH: 5, loadMin: 600, recMin: 0 };
  const calm = { energy: 4, stress: 2, mood: 4, tibH: 7, loadMin: 300, recMin: 0 };
  const dates = Array.from({ length: 120 }, (_, i) => addDays(TODAY, i - 119));
  const close = dates[80];
  const log = dates.filter((d) => d <= dates[81] || d >= dates[97]).map((date, i) => ({ date, ...(i < 70 ? calm : hard) }));
  const r = derive(log, [{ date: dates[75], sev: 3, closedOn: close }], PROFILE, TODAY);
  const after = r.hist.filter((h) => h.t > dayNum(close)).map((h) => h.t);
  assert.ok(!r.flags.some((t) => after.indexOf(t) >= 0 && after.indexOf(t) < K.HOLD_SEG), `flags ${r.flags.map((t) => after.indexOf(t))}`);
});

test('새 평소로 삼은 뒤 2주가 지나도 옛 평소로 다시 알리지 않는다', () => {
  const rebaseAt = addDays(TODAY, -60);
  for (let seed = 1; seed <= 6; seed++) {
    const log = person(330, { seed, skip: 0.05, shift: (i) => (i >= 150 ? 2 : 0) });
    const r = derive(log, [{ date: rebaseAt, rebase: true, closedOn: rebaseAt }], PROFILE, TODAY);
    const soon = r.flags.filter((t) => t > dayNum(rebaseAt) && t <= dayNum(rebaseAt) + K.HOLD_SEG + 1);
    assert.equal(soon.length, 0, `seed ${seed}`);
  }
});

test('딱 14일 만에 돌아와도 처음부터 다시 쌓는다', () => {
  const stopped = person(200, { skip: 0, shift: (i) => (i > 150 ? 2 : 0) }).filter((e) => dayNum(e.date) <= dayNum(TODAY) - 14);
  const r = derive([...stopped, { date: TODAY, energy: 3, stress: 3, mood: 3, loadMin: null, recMin: 0 }], [], PROFILE, TODAY);
  const day = r.days.at(-1);
  assert.equal(day.band, 'restart');
  assert.equal(day.flagged, false);
  assert.ok(Math.abs(day.S) < 0.2);
});

test('그 전 2주는 14일이고, 여러 번 표시했으면 가장 심했던 표시까지를 본다', () => {
  const hardDay = { energy: 1, stress: 5, mood: 1, tibH: 4, loadMin: 600, recMin: 0 };
  const calmDay = { energy: 4, stress: 2, mood: 4, tibH: 7, loadMin: 300, recMin: 0 };
  const log = Array.from({ length: 60 }, (_, i) => ({ date: addDays(TODAY, i - 59), ...(i >= 44 ? hardDay : calmDay) }));
  const worst = addDays(TODAY, -2);
  const r = derive(log, [{ date: addDays(TODAY, -13), sev: 1 }, { date: worst, sev: 3 }], PROFILE, TODAY);
  assert.equal(r.episodes.length, 1);
  assert.equal(r.episodes[0].logged, 14);
  assert.equal(r.episodes[0].hardDays, 14);
});

test('약한 표시는 2주를 세는 기준이 되지 않는다', () => {
  const hardDay = { energy: 1, stress: 5, mood: 1, tibH: 7, loadMin: 300, recMin: 0 };
  const log = Array.from({ length: 40 }, (_, i) => ({ date: addDays(TODAY, i - 39), energy: 3, stress: 3, mood: 3, tibH: 7, loadMin: 300, recMin: 0, ...(i >= 26 ? hardDay : {}) }));
  const r = derive(log, [{ date: addDays(TODAY, -13), sev: 1, fuzz: 3, soft: true }, { date: addDays(TODAY, -1), sev: 2 }], PROFILE, TODAY);
  assert.equal(r.episodes[0].hardDays, 13);
});

test('표시한 힘든 시기는 표시 없이 지나간 때로 세지 않는다', () => {
  const log = person(300, { seed: 3, skip: 0, shift: (i) => (i >= 200 && i < 225 ? 2.5 : 0) });
  const quietRun = derive(log, [], PROFILE, TODAY);
  assert.ok(quietRun.flags.length >= 1);
  const flag = quietRun.flags.at(-1);
  const marked = derive(log, [{ date: dayKey(flag + 15), sev: 2, closedOn: dayKey(flag + 20) }], PROFILE, TODAY);
  assert.equal(marked.quiet, 0);
});

test('컨디션을 안 남긴 날의 수면도 수면 부족에 더한다', () => {
  const log = person(40, { skip: 0 }).map((e) => ({ ...e, tibH: 7 }));
  const nights = Array.from({ length: 6 }, (_, i) => ({ date: addDays(TODAY, i - 5), tibH: 3.5, loadMin: null, recMin: 0 }));
  const older = log.filter((e) => e.date < nights[0].date);
  const r = derive([...older, ...nights], [], PROFILE, TODAY);
  assert.ok(r.debt > 10, `debt ${r.debt}`);
  assert.equal(r.sleepKnown, true);
});

test('tailProb는 확률이다', () => {
  assert.ok(Math.abs(tailProb(0, 14, 1, 4) - 1) < 1e-9);
  assert.ok(tailProb(14, 14, 1, 4) < 0.01);
  let last = 1;
  for (let x = 0; x <= 14; x++) {
    const p = tailProb(x, 14, 2, 8);
    assert.ok(p <= last + 1e-9 && p >= 0);
    last = p;
  }
});

test('dayKey와 dayNum은 서로 되돌린다', () => {
  assert.equal(dayKey(dayNum('2026-02-28')), '2026-02-28');
});

test('dailyLog: 해야 하는 일을 쓰는 사람의 빈 날은 0, 안 쓰는 사람은 모름, 오늘은 뺀다', () => {
  const state = {
    areas: [{ id: 'dev', kind: 'load' }, { id: 'run', kind: 'varies' }],
    entries: [
      { date: '2026-10-30', areaId: 'dev', minutes: 120 },
      { date: '2026-10-31', areaId: 'dev', minutes: 60 },
      { date: '2026-10-30', areaId: 'run', minutes: 30, feel: 'fill' },
      { date: '2026-10-30', areaId: 'gone', minutes: 500 },
    ],
    checkins: { '2026-10-29': { energy: 3, stress: 3 }, '2026-10-30': { energy: 3, stress: 3 }, '2026-10-31': { energy: 3, stress: 3 }, '2026-01-01': { energy: 3, stress: 3 } },
    sleep: { '2026-10-30': { bed: '23:00', wake: '06:30', quality: 4 } },
  };
  const log = dailyLog(state, TODAY);
  const on = (date) => log.find((e) => e.date === date);
  assert.equal(on('2026-10-30').loadMin, 120);
  assert.equal(on('2026-10-30').recMin, 30);
  assert.equal(on('2026-10-30').tibH, 7.5);
  assert.equal(on('2026-10-29').loadMin, 0);
  assert.equal(on('2026-01-01').loadMin, null);
  assert.equal(on(TODAY).loadMin, null);
});

test('그때그때 다른 일은 끝나고 나니에 따라 회복, 부하, 어디에도 안 넣음으로 나뉜다', () => {
  const state = {
    areas: [{ id: 'dev', kind: 'load' }, { id: 'game', kind: 'varies' }],
    entries: [
      { date: '2026-10-28', areaId: 'game', minutes: 60, feel: 'fill' },
      { date: '2026-10-28', areaId: 'game', minutes: 240, feel: 'drain' },
      { date: '2026-10-28', areaId: 'dev', minutes: 30, feel: 'fill' }, // 해야 하는 일에는 고른 값을 쓰지 않는다
      { date: '2026-10-29', areaId: 'game', minutes: 90, feel: 'same' },
      { date: '2026-10-30', areaId: 'game', minutes: 45 }, // 해야 하는 일이던 때 남긴 기록
    ],
    checkins: {},
    sleep: {},
  };
  const log = dailyLog(state, TODAY);
  const on = (date) => log.find((e) => e.date === date);
  assert.deepEqual([on('2026-10-28').loadRaw, on('2026-10-28').recMin], [270, 60]);
  assert.deepEqual([on('2026-10-29').loadRaw, on('2026-10-29').recMin, on('2026-10-29').otherMin], [0, 0, 90]);
  assert.equal(on('2026-10-29').loadMin, 0); // 앞뒤로 부하 기록이 있으니 쉰 날이다
  assert.equal(on('2026-10-30').loadRaw, 45);
  assert.equal(effectOf({ kind: 'varies' }, { feel: 'toString' }), 'work');
});

/** 36일 컨디션, 마지막 8일은 힘들다. 러닝 40분 한 번을 feel로 남긴다. withWork면 평일마다 해야 하는 일을 기록한다. */
function feelCase(feel, withWork, extra = () => {}) {
  const state = { areas: [{ id: 'run', kind: 'varies' }, { id: 'dev', kind: 'load' }], entries: [], checkins: {}, sleep: {} };
  for (let i = 0; i < 36; i++) {
    const date = addDays(TODAY, i - 36);
    state.checkins[date] = i >= 28 ? { energy: 2, stress: 4, mood: 2 } : { energy: 3 + (i % 2), stress: 2 + (i % 3 === 0), mood: 3 + (i % 2) };
    if (withWork && i % 7 < 5) state.entries.push({ date, areaId: 'dev', minutes: 240 + 30 * (i % 3) });
  }
  if (feel) state.entries.push({ date: addDays(TODAY, -4), areaId: 'run', minutes: 40, feel });
  extra(state);
  return derive(dailyLog(state, TODAY), [], PROFILE, TODAY).days.filter((d) => d.logged);
}

test('지쳤어요는 비교할 평소가 없으면 아무것도 바꾸지 않고, 있으면 그날의 부하를 해야 하는 일처럼 늘린다', () => {
  // 취미만 기록하면 비교할 평소 부하가 없어서 아무것도 바뀌지 않는다
  const sameOnly = feelCase('same', false);
  feelCase('drain', false).forEach((d, i) => assert.equal(d.U, sameOnly[i].U));
  // 해야 하는 일을 기록하면 지친 날의 부하와 그날의 쌓인 값이 늘어난다. 기록한 날과 모르는 날은 바뀌지 않는다.
  // 그 뒤의 날은 평소에 그날이 들어가 조금 낮아질 수 있는데, 같은 시간을 해야 하는 일로 남겨도 똑같다.
  const same = feelCase('same', true);
  const drain = feelCase('drain', true);
  const day = drain.findIndex((d) => d.loadMin === 340);
  assert.ok(day > 0);
  assert.ok(drain[day].U > same[day].U && drain[day].S > same[day].S);
  drain.forEach((d, i) => assert.equal(d.loadMin == null, same[i].loadMin == null));
  const asWork = feelCase(null, true, (state) => state.entries.push({ date: addDays(TODAY, -4), areaId: 'dev', minutes: 40 }));
  drain.forEach((d, i) => assert.equal(d.U, asWork[i].U));
});

test('해야 하는 일을 기록하지 않으면 지쳤어요만으로 빈 날을 쉰 날로 치지 않는다', () => {
  const log = dailyLog({ areas: [{ id: 'run', kind: 'varies' }], entries: [{ date: '2026-10-27', areaId: 'run', minutes: 40, feel: 'drain' }], checkins: { '2026-10-26': { energy: 3, stress: 3 } }, sleep: {} }, TODAY);
  assert.equal(log.find((e) => e.date === '2026-10-26').loadMin, null);
  assert.equal(log.find((e) => e.date === '2026-10-27').loadMin, null);
  assert.equal(log.find((e) => e.date === '2026-10-27').loadRaw, 40); // 기록한 시간 메모에는 들어간다
});
