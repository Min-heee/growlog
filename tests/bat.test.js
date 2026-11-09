// node --test tests/ 로 실행한다. 한 달 체크의 점수, 범위, 다룰 기록, 바뀐 정도, 도움 안내를 확인한다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { change, COUNT, editUntil, results, score, status, supportFrom } from '../js/bat.js';
import { ANCHORS, INTRO, ITEMS, READY } from '../js/bat-items.js';
import { addDays } from '../js/dates.js';
import { BAT_ITEMS } from '../js/store.js';
import { insight } from '../js/insight.js';
import { createDefaultState } from '../js/store.js';

const TODAY = '2026-11-09';

/** 합이 sum이 되는 23개의 답 */
function withSum(sum) {
  const a = Array(COUNT).fill(1);
  let left = sum - COUNT;
  for (let i = 0; left > 0; i = (i + 1) % COUNT) {
    if (a[i] < 5) {
      a[i]++;
      left--;
    }
  }
  return a;
}
const checks = (...pairs) => Object.fromEntries(pairs.map(([date, sum]) => [date, { a: withSum(sum) }]));

test('문항 수는 저장소와 점수 계산이 같다', () => {
  assert.equal(BAT_ITEMS, COUNT);
  assert.equal(ITEMS.length, COUNT);
  assert.equal(ANCHORS.length, 5);
});

test('문항을 넣었다면 23개가 모두 차 있고 짧은 판 표시가 없다', () => {
  if (!READY) return; // 문항을 넣기 전에는 한 달 체크를 열지 않는다
  assert.ok(INTRO.trim());
  for (const text of [...ANCHORS, ...ITEMS]) {
    assert.ok(text.trim());
    assert.doesNotMatch(text, /\*/);
  }
  assert.equal(new Set(ITEMS).size, COUNT);
});

test('평균은 23으로 나눠 소수 둘째 자리로 반올림하고, 범위는 2.59와 3.02에서 나뉜다', () => {
  assert.deepEqual([59, 60, 69, 70].map((sum) => score(withSum(sum))).map((s) => [s.mean, s.band]), [
    [2.57, 'low'],
    [2.61, 'mid'],
    [3, 'mid'],
    [3.04, 'high'],
  ]);
  assert.equal(score(Array(COUNT).fill(1)).mean, 1);
  assert.equal(score(Array(COUNT).fill(5)).mean, 5);
});

test('네 부분은 공식 설문지의 1~8, 9~13, 14~18, 19~23번 평균이다', () => {
  const a = [...Array(8).fill(4), ...Array(5).fill(2), ...Array(5).fill(1), ...Array(5).fill(3)];
  assert.deepEqual(score(a).parts, [4, 2, 1, 3]);
  const mixed = [5, 4, 4, 4, 4, 4, 4, 4, ...Array(15).fill(1)];
  assert.equal(score(mixed).parts[0], 4.13); // 33/8 = 4.125
});

test('빈 칸이 있으면 점수를 내지 않는다', () => {
  const a = withSum(70);
  a[8] = null;
  assert.equal(score(a), null);
  assert.equal(score(withSum(70).slice(1)), null);
  assert.deepEqual(results({ [TODAY]: { a } }), []);
});

test('처음이면 오늘 새로 시작하고, 7일 안에는 시작한 날의 기록을 이어서 한다', () => {
  assert.equal(status({}, TODAY).open, TODAY);
  const half = withSum(40).map((x, i) => (i < 10 ? x : null));
  const started = addDays(TODAY, -6);
  assert.equal(status({ [started]: { a: half } }, TODAY).open, started); // 자정을 넘기거나 며칠 뒤에 와도 같은 기록에 이어 쓴다
  assert.equal(editUntil(started), TODAY);
  assert.equal(status({ [addDays(TODAY, -7)]: { a: half } }, TODAY).open, TODAY); // 7일이 지난 기록은 버리고 새로 시작한다
  assert.equal(status({ [addDays(TODAY, 1)]: { a: half } }, TODAY).open, addDays(TODAY, 1)); // 서쪽으로 가 날짜가 돌아가도 이어 쓴다
});

test('다 답한 체크는 7일 동안 고칠 수 있고, 그 뒤로는 28일이 지나야 새로 열린다', () => {
  const done = addDays(TODAY, -3);
  let s = status(checks([done, 50]), TODAY);
  assert.equal(s.open, done);
  assert.equal(s.next, addDays(done, 28));
  s = status(checks([addDays(TODAY, -10), 50]), TODAY);
  assert.equal(s.open, null);
  assert.equal(s.last.date, addDays(TODAY, -10));
  assert.equal(status(checks([addDays(TODAY, -28), 50]), TODAY).open, TODAY);
});

test('바뀐 정도는 네 번 이상 체크하고 측정 오차보다 클 때만 말한다', () => {
  const list = (...sums) => results(checks(...sums.map((sum, i) => [addDays(TODAY, (i - sums.length + 1) * 28), sum])));
  assert.equal(change(list(50, 50, 80)), null); // 세 번으로는 말하지 않는다
  assert.equal(change(list(50, 50, 50, 51)), null); // 지난 체크가 모두 같아도 0.04 차이로는 말하지 않는다
  assert.equal(change(list(50, 50, 50, 58)), null); // 0.35 차이는 아직이고
  assert.equal(change(list(50, 50, 50, 59)), 'up');
  assert.equal(change(list(50, 50, 50, 41)), 'down');
  assert.equal(change(list(40, 60, 50, 60)), null); // 오르내린 폭이 크면 그만큼 더 달라야 한다
  assert.equal(change(list(23, 23, 25, 32)), 'up'); // 1.00, 1.00, 1.09의 평균 1.03과 1.39는 딱 0.36 차이다
});

test('도움 안내는 최근 체크가 두 번째 선 이상이거나 두 번 이어서 첫 번째 선 이상일 때 뜬다', () => {
  const at = (back, sum) => [addDays(TODAY, -back), sum];
  assert.equal(supportFrom(results(checks(at(3, 70))), TODAY), 'once');
  assert.equal(supportFrom(results(checks(at(3, 69))), TODAY), null);
  assert.equal(supportFrom(results(checks(at(31, 60), at(3, 60))), TODAY), 'twice');
  assert.equal(supportFrom(results(checks(at(31, 59), at(3, 60))), TODAY), null);
  assert.equal(supportFrom(results(checks(at(28, 80))), TODAY), null); // 한 달이 지난 결과로는 띄우지 않는다
  const state = createDefaultState();
  state.profile.role = 'worker';
  state.monthly = checks(at(2, 75));
  const support = insight(state, TODAY).support;
  assert.equal(support?.id, 'H4');
  assert.doesNotMatch(support.text, /\d|높은 쪽|사이/); // 점수나 선, 범위 이름은 말하지 않는다
  assert.equal(insight({ ...state, supportSeen: Date.now() }, TODAY).support, null);
  // 한 달 체크를 숨겼거나 열 수 없는 사람에게는 그 체크를 들어 말하지 않는다
  assert.equal(insight({ ...state, profile: { ...state.profile, monthlyOff: true } }, TODAY).support, null);
  assert.equal(insight({ ...state, profile: { ...state.profile, role: 'student' } }, TODAY).support, null);
});
