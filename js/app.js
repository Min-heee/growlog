// 앱 진입점: 해시 라우팅, 화면 그리기, 이벤트 위임
import { deleteEntry, getState, restoreEntry, subscribe } from './store.js';
import { resetTips } from './charts.js';
import { todayKey } from './dates.js';
import { initPWA } from './pwa.js';
import { initTooltips, setRefresher, toast } from './ui.js';
import * as today from './views/today.js';
import * as timer from './views/timer.js';
import * as stats from './views/stats.js';
import * as burnout from './views/burnout.js';
import * as settings from './views/settings.js';

const views = { today, timer, stats, burnout, settings };
const root = document.getElementById('view');

function routeName() {
  const name = location.hash.replace(/^#\/?/, '');
  return Object.hasOwn(views, name) ? name : 'today';
}

// 다시 그린 뒤에도 키보드 포커스가 같은 버튼에 남도록 data-* 속성으로 찾아간다
const FOCUS_KEYS = ['action', 'field', 'value', 'id'];
function focusSelector(el) {
  if (!el || el === root || !root.contains(el)) return null;
  const parts = FOCUS_KEYS.filter((k) => el.dataset[k] != null).map((k) => `[data-${k}="${CSS.escape(el.dataset[k])}"]`);
  return parts.length ? parts.join('') : null;
}

function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'light' || theme === 'dark') html.dataset.theme = theme;
  else delete html.dataset.theme;
  // 폰 상태 표시줄 색도 앱 안에서 고른 테마를 따라가게 한다
  const page = getComputedStyle(html).getPropertyValue('--page').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.content = page;
  });
}

let renderedDay = todayKey();

function render() {
  renderedDay = todayKey();
  const state = getState();
  const name = routeName();
  const view = views[name];
  const focus = focusSelector(document.activeElement);
  applyTheme(state.theme);
  resetTips();
  root.innerHTML = view.render(state);
  view.mount?.(root, state);
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (focus) root.querySelector(focus)?.focus({ preventScroll: true });
}

// 기록 삭제는 여러 화면에 있으니 여기서 한 번에 처리한다
function handleShared(e) {
  const button = e.target.closest('[data-action="delete-entry"]');
  if (!button) return false;
  const entry = getState().entries.find((x) => x.id === button.dataset.id);
  if (entry) {
    deleteEntry(entry.id);
    toast('기록을 삭제했어요', { label: '되돌리기', onClick: () => restoreEntry(entry) });
  }
  return true;
}

for (const type of ['click', 'input', 'change', 'submit']) {
  root.addEventListener(type, (e) => {
    if (type === 'click' && handleShared(e)) return;
    views[routeName()].on?.[type]?.(e);
  });
}

subscribe((_, { quiet }) => {
  if (!quiet) render();
});
addEventListener('hashchange', () => {
  render();
  scrollTo(0, 0);
});
// 자정을 넘겨 다시 열었을 때 '오늘'이 바뀌도록. 폰에서 앱을 오갈 때마다 다시 그리면 입력 중인 칸의 포커스가 풀린다.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && todayKey() !== renderedDay) render();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getState().theme));

// 차트는 실제 너비로 그리므로 폭이 바뀔 때만 차트만 다시 그린다 (키보드가 열려 높이만 바뀌는 건 무시)
let lastWidth = root.clientWidth;
addEventListener('resize', () => {
  if (root.clientWidth === lastWidth) return;
  lastWidth = root.clientWidth;
  resetTips();
  views[routeName()].drawCharts?.(root);
});

setRefresher(render);
initTooltips();
initPWA();
render();
timer.startTicker();
