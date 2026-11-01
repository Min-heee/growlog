// 아이폰 앱으로 감싸서 실행할 때 Swift 쪽과 이야기하는 통로. 브라우저에서는 없다.
const appBridge = () => globalThis.webkit?.messageHandlers?.growlog ?? null;
export const isNativeApp = () => appBridge() !== null;
/** 아이폰 앱 안이면 메시지를 보내고 true, 아니면 false */
export function sendToApp(message) {
  appBridge()?.postMessage(message);
  return isNativeApp();
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const sum = (list, fn = (x) => x) => list.reduce((acc, x) => acc + fn(x), 0);
export const avg = (list) => (list.length ? sum(list) / list.length : null);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** 사용자가 입력한 글자를 HTML에 넣기 전에 반드시 거친다 */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** 분 → "1시간 30분" */
export function fmtHM(minutes) {
  const total = Math.round(minutes);
  if (total < 60) return `${total}분`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

/** 소수 한 자리 */
export const fmt1 = (n) => String(Math.round(n * 10) / 10);
/** 시간(소수) → "6.5시간" */
export const fmtHours = (hours) => `${fmt1(hours)}시간`;

/** 받침에 맞는 조사: josa('공부', '을', '를') → '를' */
export function josa(word, withBatchim, without) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${withBatchim}(${without})`;
  return code % 28 ? withBatchim : without;
}
