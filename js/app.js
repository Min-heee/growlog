// 앱 진입점: 해시 라우팅, 화면 그리기, 이벤트 위임
import { deleteEntry, getState, hasSaveFailed, restoreEntry, retrySave, subscribe } from './store.js';
import { exportData } from './backup.js';
import { resetTips } from './charts.js';
import { todayKey } from './dates.js';
import { initPWA } from './pwa.js';
import { initTooltips, savedToast, setRefresher } from './ui.js';
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
const FOCUS_KEYS = { action: 'action', field: 'field', value: 'value', id: 'id', areaField: 'area-field' };
function focusSelector(el) {
  if (!el || el === root || !root.contains(el)) return null;
  const parts = Object.entries(FOCUS_KEYS)
    .filter(([key]) => el.dataset[key] != null)
    .map(([key, attr]) => `[data-${attr}="${CSS.escape(el.dataset[key])}"]`);
  return parts.length ? parts.join('') : null;
}

// 화면을 그리다 오류가 나도 기록을 꺼낼 수 있도록 내보내기만 있는 화면을 보여준다
const CRASH_SCREEN = `<section class="card">
  <h2>화면을 열지 못했어요</h2>
  <p class="sub">기록은 이 기기에 그대로 있어요. 먼저 백업을 받아두고 새로고침해보세요.</p>
  <div class="btn-row">
    <button type="button" class="btn primary" data-action="crash-export">백업 받기</button>
    <button type="button" class="btn" data-action="crash-reload">새로고침</button>
  </div>
</section>`;

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
let renderLater = false;

const editing = () => {
  const el = document.activeElement;
  return root.contains(el) && el.matches('input, select, textarea');
};

/** 업데이트 직후에는 옛 index.html과 새 스크립트가 만날 수 있어 경고 칸이 없을 수도 있다 */
function showSaveWarning() {
  const warning = document.getElementById('save-warning');
  if (warning) warning.hidden = !hasSaveFailed();
}

// 타이머가 끝나거나 다른 탭이 저장해도 입력 중인 칸은 그대로 둔다. 다시 그리면 키보드가 내려가고 글자가 사라진다.
function requestRender({ background = false } = {}) {
  if (background && editing()) renderLater = true;
  else render();
}

function render() {
  renderLater = false;
  renderedDay = todayKey();
  const state = getState();
  const name = routeName();
  const view = views[name];
  const focus = focusSelector(document.activeElement);
  applyTheme(state.theme);
  resetTips();
  try {
    root.innerHTML = view.render(state);
    view.mount?.(root, state);
  } catch (err) {
    console.error(err);
    root.innerHTML = CRASH_SCREEN;
  }
  showSaveWarning();
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (focus) root.querySelector(focus)?.focus({ preventScroll: true });
}

// 기록 삭제는 여러 화면에 있으니 여기서 한 번에 처리한다
function handleShared(e) {
  const crash = e.target.closest('[data-action^="crash-"]');
  if (crash) {
    if (crash.dataset.action === 'crash-export') exportData();
    else location.reload();
    return true;
  }
  const button = e.target.closest('[data-action="delete-entry"]');
  if (!button) return false;
  const entry = getState().entries.find((x) => x.id === button.dataset.id);
  if (entry) {
    deleteEntry(entry.id);
    savedToast('기록을 삭제했어요', { label: '되돌리기', onClick: () => restoreEntry(entry) });
  }
  return true;
}

for (const type of ['click', 'input', 'change', 'submit']) {
  root.addEventListener(type, (e) => {
    if (type === 'click' && handleShared(e)) return;
    views[routeName()].on?.[type]?.(e);
  });
}

root.addEventListener('focusout', () => {
  // 포커스가 다음 칸으로 옮겨가는 중일 수 있으니 옮겨간 뒤에 확인한다
  setTimeout(() => {
    if (renderLater && !editing()) render();
  });
});

subscribe((_, { quiet, background }) => {
  if (!quiet) requestRender({ background });
  showSaveWarning();
});
addEventListener('hashchange', () => {
  render();
  scrollTo(0, 0);
});
// 자정을 넘겨 다시 열었을 때 '오늘'이 바뀌도록. 폰에서 앱을 오갈 때마다 다시 그리면 입력 중인 칸의 포커스가 풀린다.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  retrySave();
  if (todayKey() !== renderedDay) render();
});
addEventListener('focus', retrySave);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getState().theme));

// 차트는 실제 너비로 그리므로 폭이 바뀔 때만 차트만 다시 그린다 (키보드가 열려 높이만 바뀌는 건 무시)
let lastWidth = root.clientWidth;
addEventListener('resize', () => {
  if (root.clientWidth === lastWidth) return;
  lastWidth = root.clientWidth;
  resetTips();
  views[routeName()].drawCharts?.(root);
});

setRefresher(requestRender);
initTooltips();
initPWA();
render();
timer.startTicker();
