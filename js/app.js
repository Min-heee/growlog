// 앱 진입점: 해시 라우팅, 화면 그리기, 이벤트 위임
import { deleteEntry, getState, hasNewerData, hasSaveFailed, restoreEntry, retrySave, subscribe } from './store.js';
import { exportData } from './backup.js';
import { resetTips } from './charts.js';
import { todayKey } from './dates.js';
import { initPWA } from './pwa.js';
import { initTooltips, savedToast, setRefresher } from './ui.js';
import { isNativeApp, sendToApp } from './util.js';
import { planOn } from './plan-card.js';
import * as today from './views/today.js';
import * as calendar from './views/calendar.js';
import * as timer from './views/timer.js';
import * as stats from './views/stats.js';
import * as recovery from './views/recovery.js';
import * as settings from './views/settings.js';
import * as help from './views/help.js';

const views = { today, calendar, timer, stats, recovery, settings, help };
const ALIASES = { burnout: 'recovery' }; // 설치된 앱의 옛 바로가기
const root = document.getElementById('view');
document.documentElement.classList.toggle('native', isNativeApp());

function routeName() {
  const hash = location.hash.replace(/^#\/?/, '');
  const name = Object.hasOwn(ALIASES, hash) ? ALIASES[hash] : hash;
  return Object.hasOwn(views, name) ? name : 'today';
}
let shown = routeName(); // 지금 그려져 있는 화면. 주소가 먼저 바뀐 뒤에 오는 입력 이벤트도 이 화면이 받는다.

// 다시 그린 뒤에도 키보드 포커스가 같은 버튼에 남도록 data-* 속성으로 찾아간다
const FOCUS_KEYS = { action: 'action', field: 'field', value: 'value', id: 'id', areaField: 'area-field' };
function focusSelector(el) {
  if (!el || el === root || !root.contains(el)) return null;
  const parts = Object.entries(FOCUS_KEYS)
    .filter(([key]) => el.dataset[key] != null)
    .map(([key, attr]) => `[data-${attr}="${CSS.escape(el.dataset[key])}"]`);
  if (!parts.length && el.id) return `#${CSS.escape(el.id)}`; // 키보드로 연 계획 칸(#plan-panel)처럼 data-*가 없는 곳
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
  html.dataset.theme = theme;
  // 폰 상태 표시줄 색도 앱 안에서 고른 테마를 따라가게 한다
  const page = getComputedStyle(html).getPropertyValue('--page').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.content = page;
  });
  sendToApp({ theme }); // 아이폰 앱의 키보드와 시간 선택창도 고른 테마를 따른다
}

let renderedDay = todayKey();
let renderLater = false;
let pressing = false;
const RELEASE_DELAY = 100; // 터치는 손을 뗀 뒤에 클릭이 온다. 그 전에 그리면 옆 항목이 눌린다.

const editing = () => {
  const el = document.activeElement;
  return root.contains(el) && el.matches('input, select, textarea');
};

/** 업데이트 직후에는 옛 index.html과 새 스크립트가 만날 수 있어 경고 칸이 없을 수도 있다 */
function showSaveWarning() {
  const warning = document.getElementById('save-warning');
  if (!warning) return;
  warning.hidden = !hasSaveFailed();
  warning.dataset.usual ??= warning.textContent;
  warning.textContent = hasNewerData() ? '더 새 버전 앱이 남긴 기록이 있어요. 새로고침하거나 앱을 업데이트해주세요. 그때까지 여기서 바꾼 내용은 저장되지 않아요.' : warning.dataset.usual;
  // 위에 붙어 있는 다른 칸(한 달 체크의 고르는 말)이 경고 아래로 내려가도록 높이를 알려준다
  document.documentElement.style.setProperty('--warn-h', warning.hidden ? '0px' : `${warning.offsetHeight + 4}px`);
}

/** 머리글의 작은 글자: 화면마다 지금 무엇을 보는지 말한다 */
function showLabel(state) {
  const label = document.getElementById('top-label');
  if (!label) return;
  const view = views[shown];
  label.textContent = view.label?.(state) ?? '그로우로그';
  label.parentElement.classList.toggle('live', view.live?.() === true);
}

// 다시 그려도 펼쳐둔 표나 설명이 닫히지 않게 한다. 닫히면 아래 내용이 위로 밀려 보던 자리를 잃는다.
function detailsByKey() {
  const seen = new Map();
  return [...root.querySelectorAll('details')].map((el) => {
    const text = el.querySelector('summary')?.textContent;
    seen.set(text, (seen.get(text) ?? 0) + 1);
    return [`${text}:${seen.get(text)}`, el]; // 표로 보기처럼 이름이 같은 것은 순서로 나눈다
  });
}
const openDetails = () => detailsByKey().filter(([, el]) => el.open).map(([key]) => key);
function reopenDetails(open) {
  detailsByKey().forEach(([key, el]) => {
    if (open.includes(key)) el.open = true;
  });
}

/** 입력 중인 칸이 든 덩어리만 남기고 나머지를 새로 그린다. 덩어리 구성이 바뀌었으면 입력이 끝날 때까지 기다린다. */
function renderAround(field) {
  if (shown !== routeName() || todayKey() !== renderedDay) return; // 자정을 넘겼다면 입력 중인 칸은 지난날의 칸이니 그대로 두고 나중에 그린다
  const next = document.createElement('template');
  try {
    next.innerHTML = views[shown].render(getState());
  } catch (err) {
    console.error(err);
    return;
  }
  const parts = [...next.content.children];
  const now = [...root.children];
  if (parts.length !== now.length) return;
  const open = openDetails();
  resetTips();
  now.forEach((el, i) => {
    if (!el.contains(field)) el.replaceWith(parts[i]);
  });
  views[shown].mount?.(root, getState());
  reopenDetails(open);
  showLabel(getState());
}

// 타이머가 끝나거나 다른 탭이 저장해도 입력 중인 칸은 그대로 둔다. 다시 그리면 키보드가 내려가고 글자가 사라진다.
function requestRender({ background = false } = {}) {
  if (background && pressing) renderLater = true;
  else if (background && editing()) {
    renderLater = true;
    renderAround(document.activeElement);
  } else render();
}

// 누르는 사이에 화면을 바꾸면 손을 뗀 곳이 다른 요소가 되어 클릭이 사라지므로, 손을 뗀 뒤에 그린다.
// 포커스가 다음 칸으로 옮겨가는 중일 수도 있으니 옮겨간 뒤에 확인한다.
function catchUp(delay = 0) {
  setTimeout(() => {
    if (!renderLater || pressing) return;
    if (editing()) renderAround(document.activeElement);
    else render();
  }, delay);
}

function render() {
  renderLater = false;
  renderedDay = todayKey();
  const state = getState();
  const name = routeName();
  const view = views[name];
  const open = shown === name ? openDetails() : [];
  shown = name;
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
  reopenDetails(open);
  showSaveWarning();
  showLabel(state);
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

for (const type of ['click', 'keydown', 'input', 'change', 'submit']) {
  root.addEventListener(type, (e) => {
    if (type === 'click' && handleShared(e)) return;
    if (planOn[type]?.(e)) return; // 오늘·달력의 계획 카드 안에서 일어난 일은 카드가 처리한다
    views[shown].on?.[type]?.(e);
  });
}

root.addEventListener('focusout', () => catchUp());
addEventListener('pointerdown', () => {
  pressing = true;
}, true);
function release() {
  pressing = false;
  catchUp(RELEASE_DELAY);
}
addEventListener('pointerup', release, true);
addEventListener('pointercancel', release, true);
addEventListener('blur', release); // 캡처하면 입력칸의 blur까지 받아 누르는 중에 그리게 된다

subscribe((_, { quiet, background }) => {
  if (!quiet) requestRender({ background });
  showSaveWarning();
});
addEventListener('hashchange', () => {
  if (root.contains(document.activeElement)) document.activeElement.blur(); // 뒤로 가기로 떠나도 입력하던 칸이 저장되게 한다
  views[routeName()].enter?.(); // 화면에 들어올 때마다 펼쳐 둘 칸을 새로 정한다
  render();
  scrollTo(0, 0);
  views[shown].arrive?.(root);
});
// 자정을 넘겨 다시 열었을 때 '오늘'이 바뀌도록. 폰에서 앱을 오갈 때마다 다시 그리면 입력 중인 칸의 포커스가 풀린다.
// 아이폰 앱은 화면을 계속 살려 두므로, 오래 떠나 있다 돌아오면 탭에 새로 들어온 것처럼 펼칠 칸을 다시 정한다. 입력 중이면 건드리지 않는다.
const REENTER_AFTER = 30 * 60 * 1000;
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  retrySave();
  if (hiddenAt && Date.now() - hiddenAt >= REENTER_AFTER && !editing() && views[shown].enter) {
    views[shown].enter({ long: true });
    render();
    scrollTo(0, 0);
  } else if (todayKey() !== renderedDay) render();
});
addEventListener('focus', retrySave);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getState().theme));

// 차트는 실제 너비로 그리므로 폭이 바뀔 때만 차트만 다시 그린다 (키보드가 열려 높이만 바뀌는 건 무시)
let lastWidth = root.clientWidth;
addEventListener('resize', () => {
  if (root.clientWidth === lastWidth) return;
  lastWidth = root.clientWidth;
  resetTips();
  views[shown].drawCharts?.(root);
});

setRefresher(requestRender);
initTooltips();
initPWA();
render();
timer.startTicker();
