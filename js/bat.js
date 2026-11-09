// 한 달 체크의 점수. 번아웃 평가 도구(BAT) 일하는 사람용 한국어판 23문항의 답만 받아 계산하는 순수 함수라서, 답을 고치면 처음부터 다시 계산된다.
// 계산 방법은 설문을 만든 연구진의 사용 안내를 따르고, 선과 그 근거는 docs/evidence.md의 '한 달 체크'에 있다.
import { addDays } from './dates.js';

export const COUNT = 23;
// 네 부분과 문항 번호(0부터). 공식 설문지의 순서 그대로다.
export const PARTS = [
  { label: '지친 정도', from: 0, to: 8 },
  { label: '일과 멀어진 정도', from: 8, to: 13 },
  { label: '집중하기 어려운 정도', from: 13, to: 18 },
  { label: '감정을 다루기 어려운 정도', from: 18, to: 23 },
];
// Schaufeli 외 2023이 세 나라 자료를 합쳐 정한 23문항 평균의 선. 평균은 소수 둘째 자리로 반올림한다.
// 답이 1~5의 정수라 평균이 2.57 다음은 2.61, 3.00 다음은 3.04여서, 합이 60 이상이면 2.59 이상, 70 이상이면 3.02 이상과 같다.
export const LINES = { mid: 2.59, high: 3.02 };
const SUM_LINES = { mid: 60, high: 70 };
export const WINDOW = 7; // 시작한 날부터 7일 안에는 이어서 하거나 답을 고칠 수 있다. 앱이 정한 값
export const GAP = 28; // 다음 체크는 시작한 날부터 28일 뒤에 열린다. 몇 번 해야 하는지 정한 연구가 없어 앱이 정한 값
const CHANGE_AFTER = 4;
// 측정 오차만으로는 잘 생기지 않는 차이. 1.96 × √2 × 표준편차 .64 × √(1 − 신뢰도 .96) ≈ 0.36 (테스트 매뉴얼의 값).
// 6개월 재검사 상관 .74로 계산하면 0.90이라, 가장 느슨한 쪽을 골랐다
const CHANGE_FLOOR = 0.36;

const total = (a) => a.reduce((s, x) => s + x, 0);
const round2 = (sum, n) => Math.round((sum * 100) / n) / 100;
export const answered = (a) => a.filter((x) => x != null).length;
export const isComplete = (a) => a.length === COUNT && a.every((x) => Number.isInteger(x) && x >= 1 && x <= 5);

/** 다 답했을 때만 평균, 범위, 네 부분의 평균. 빈 칸이 있으면 null이다. 빠진 문항을 채우는 규칙은 연구진이 정하지 않았다. */
export function score(a) {
  if (!isComplete(a)) return null;
  const sum = total(a);
  return {
    mean: round2(sum, COUNT),
    band: sum >= SUM_LINES.high ? 'high' : sum >= SUM_LINES.mid ? 'mid' : 'low',
    parts: PARTS.map((p) => round2(total(a.slice(p.from, p.to)), p.to - p.from)),
  };
}

/** 다 답한 체크를 오래된 것부터 */
export const results = (monthly) =>
  Object.keys(monthly)
    .sort()
    .flatMap((date) => {
      const s = score(monthly[date].a);
      return s ? [{ date, ...s }] : [];
    });

/**
 * 지금 다룰 체크. open은 답을 남기거나 고칠 수 있는 기록의 날짜로, 7일 안에 시작한 기록이 있으면 그 날이고,
 * 없으면 새 체크를 열 수 있을 때 오늘, 아직 열 수 없으면 null이다. next는 새 체크를 열 수 있는 날이다.
 */
export function status(monthly, today) {
  const list = results(monthly);
  const last = list.at(-1) ?? null;
  const next = last ? addDays(last.date, GAP) : today;
  // 서쪽으로 가서 날짜가 하루 돌아가도 시작한 기록을 이어 쓰도록, 오늘보다 뒤의 날짜도 이어 쓸 기록으로 친다
  const recent = Object.keys(monthly)
    .filter((d) => d > addDays(today, -WINDOW))
    .sort()
    .at(-1);
  return { list, last, next, open: recent ?? (next <= today ? today : null) };
}

/** 고칠 수 있는 마지막 날 */
export const editUntil = (date) => addDays(date, WINDOW - 1);

/** 네 번 이상 체크했을 때만, 마지막 평균이 지난 체크들의 평균과 측정 오차와 그동안 오르내린 폭보다 크게 다르면 'up' 또는 'down' */
export function change(list) {
  if (list.length < CHANGE_AFTER) return null;
  const before = list.slice(0, -1).map((r) => r.mean);
  const m = total(before) / before.length;
  const sd = Math.sqrt(total(before.map((x) => (x - m) ** 2)) / (before.length - 1));
  const diff = list.at(-1).mean - m;
  // 평균은 소수 둘째 자리라 그 단위로 비교한다. 그대로 빼면 0.36이 0.3599…가 되어 말하지 않는 일이 생긴다
  if (Math.round(Math.abs(diff) * 100) < Math.round(Math.max(1.96 * Math.SQRT2 * sd, CHANGE_FLOOR) * 100)) return null;
  return diff > 0 ? 'up' : 'down';
}

/** 도움 안내를 띄울 때. 마지막 체크가 28일 안에 있고, 두 번째 선 이상이면 'once', 그 전 체크와 함께 둘 다 첫 번째 선 이상이면 'twice' */
export function supportFrom(list, today) {
  const last = list.at(-1);
  if (!last || last.date <= addDays(today, -GAP)) return null;
  if (last.band === 'high') return 'once';
  if (last.band === 'mid' && list.at(-2) && list.at(-2).band !== 'low') return 'twice';
  return null;
}
