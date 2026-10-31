// 날짜는 모두 로컬 시간 기준 'YYYY-MM-DD' 문자열로 다룬다.
const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const todayKey = () => toKey(new Date());

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

/** endKey로 끝나는 days일치 날짜 목록 (오래된 날부터) */
export const rangeKeys = (endKey, days) => Array.from({ length: days }, (_, i) => addDays(endKey, i - days + 1));

/** 그 주의 월요일 */
export function weekStartKey(key) {
  const d = fromKey(key);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toKey(d);
}

export const weekday = (key) => WEEKDAYS[fromKey(key).getDay()];
export function fmtLong(key) {
  const d = fromKey(key);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
}
export function fmtDay(key) {
  const d = fromKey(key);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}
export function fmtShort(key) {
  const d = fromKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 잠든 시각·일어난 시각('HH:MM')으로 수면 시간(시간 단위)을 구한다. 자정을 넘겨도 된다. */
export function sleepHours(bed, wake) {
  if (!bed || !wake) return null;
  const toMin = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const diff = (toMin(wake) - toMin(bed) + 1440) % 1440;
  // 같은 시각이거나 16시간이 넘으면 오전·오후를 잘못 고른 경우로 보고 값을 내지 않는다
  return diff === 0 || diff > 960 ? null : diff / 60;
}
