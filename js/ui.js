// 여러 화면이 함께 쓰는 UI 조각: 다시 그리기, 토스트, 툴팁, 상태 배지, 기록 목록
import { getTip } from './charts.js';
import { esc, fmtHM } from './util.js';

let refresher = () => {};
export const setRefresher = (fn) => {
  refresher = fn;
};
/** 저장소 변경 없이 현재 화면을 다시 그린다 */
export const refresh = () => refresher();

export const areaColor = (area) => `var(--s${area?.color ?? 0})`;

// 상태 색은 늘 아이콘+글자와 함께 쓴다 (색만으로 의미를 전달하지 않기)
const STATUS_ICONS = {
  good: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.3l2.1 2.1 4.3-4.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warning: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.2l7.2 13.2H.8z" fill="currentColor"/><path d="M8 6v3.8M8 12.2v.01" stroke="#0b0b0b" stroke-width="1.8" stroke-linecap="round"/></svg>',
  serious: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.2l7.2 13.2H.8z" fill="currentColor"/><path d="M8 6v3.8M8 12.2v.01" stroke="#0b0b0b" stroke-width="1.8" stroke-linecap="round"/></svg>',
  critical: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.1 1h5.8L15 5.1v5.8L10.9 15H5.1L1 10.9V5.1z" fill="currentColor"/><path d="M8 4.6v4.2M8 11.4v.01" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',
};
export const statusBadge = (level) => `<span class="badge badge-${level.key}">${STATUS_ICONS[level.key]}${level.label}</span>`;

const X_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function entryItem(entry, area) {
  const where = area ? `${area.emoji} ${area.label}` : '삭제된 영역';
  return `<li class="entry">
    <span class="dot" style="background:${areaColor(area)}"></span>
    <div class="entry-main">
      <span class="entry-title">${esc(entry.title || area?.label || '기록')}</span>
      <span class="entry-meta">${esc(where)}${entry.source === 'timer' ? ' · 타이머' : ''}</span>
    </div>
    <span class="entry-min">${fmtHM(entry.minutes)}</span>
    <button type="button" class="icon-btn" data-action="delete-entry" data-id="${esc(entry.id)}" aria-label="기록 삭제">${X_ICON}</button>
  </li>`;
}

export const entryList = (entries, state) =>
  `<ul class="entries">${entries.map((e) => entryItem(e, state.areas.find((a) => a.id === e.areaId))).join('')}</ul>`;

let toastTimer = 0;
export function toast(message, action) {
  const el = document.getElementById('toast');
  const hide = () => el.classList.remove('show');
  const text = document.createElement('span');
  text.textContent = message;
  el.replaceChildren(text);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      action.onClick();
      hide();
    });
    el.append(button);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, action ? 5000 : 2400);
}

/** 지우기처럼 되돌릴 수 없는 일 앞에서 묻는 확인 창. true/false로 끝난다. */
export function ask(message, confirmLabel) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    const text = document.createElement('p');
    text.textContent = message;
    const row = document.createElement('div');
    row.className = 'btn-row';
    const close = (answer) => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: '취소' });
    const confirm = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small primary', textContent: confirmLabel });
    cancel.addEventListener('click', () => close(false));
    confirm.addEventListener('click', () => close(true));
    dialog.addEventListener('cancel', () => close(false)); // Esc 키
    row.append(cancel, confirm);
    dialog.append(text, row);
    document.body.append(dialog);
    dialog.showModal();
  });
}

// 차트 툴팁: data-tip이 달린 요소에 마우스를 올리거나 탭·포커스하면 보여준다.
// 영역 이름은 사용자가 입력한 값이라 textContent로만 넣는다.
export function initTooltips() {
  const el = document.getElementById('tooltip');
  const hide = () => {
    el.hidden = true;
  };
  const show = (target, x, y) => {
    const tip = getTip(target.dataset.tip);
    if (!tip) return hide();
    const title = document.createElement('div');
    title.className = 'tip-title';
    title.textContent = tip.title;
    el.replaceChildren(title);
    for (const row of tip.rows) {
      const line = document.createElement('div');
      line.className = 'tip-row';
      const key = document.createElement('i');
      key.className = 'tip-key';
      if (row.color) key.style.background = row.color;
      const value = document.createElement('strong');
      value.textContent = row.value;
      const label = document.createElement('span');
      label.textContent = row.label;
      line.append(key, value, label);
      el.append(line);
    }
    el.hidden = false;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, x + 14), innerWidth - width - 8);
    const top = y - height - 14 < 8 ? y + 18 : y - height - 14;
    el.style.transform = `translate(${left}px, ${top}px)`;
  };
  const fromPointer = (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (target) show(target, e.clientX, e.clientY);
    else hide();
  };
  document.addEventListener('pointermove', fromPointer);
  document.addEventListener('pointerdown', fromPointer);
  document.addEventListener('focusin', (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (!target || !target.matches(':focus-visible')) return;
    const r = target.getBoundingClientRect();
    show(target, r.left + r.width / 2, r.top + 12);
  });
  document.addEventListener('focusout', hide);
  addEventListener('scroll', hide, { passive: true });
}
