// 여러 화면이 함께 쓰는 UI 조각: 다시 그리기, 토스트, 툴팁, 평점 버튼, 기록 목록
import { getTip } from './charts.js';
import { hasSaveFailed } from './store.js';
import { esc, fmtHM } from './util.js';

let refresher = () => {};
export const setRefresher = (fn) => {
  refresher = fn;
};
/** 저장소 변경 없이 현재 화면을 다시 그린다. background면 사용자가 입력을 마친 뒤에 그린다. */
export const refresh = (opts) => refresher(opts);

export const areaColor = (area) => `var(--s${area?.color ?? 0})`;

/** 1~5점 버튼 묶음. { field, label, low, high }, 지금 값, 눌렀을 때의 data-action */
export function ratingScale({ field, label, low, high }, value, action) {
  const buttons = [1, 2, 3, 4, 5]
    .map((n) => `<button type="button" class="seg-btn" data-action="${action}" data-field="${field}" data-value="${n}" aria-pressed="${value === n}" aria-label="${label} ${n}점">${n}</button>`)
    .join('');
  return `<div class="scale">
    <div class="scale-head"><span class="scale-label">${label}</span><span class="scale-hint">1 ${low} · 5 ${high}</span></div>
    <div class="seg" role="group" aria-label="${label}">${buttons}</div>
  </div>`;
}

/** 눈금 막대. 칸이 통째로 켜지고, 다 채우지 못했으면 마지막 칸은 켜지 않는다. */
export function tickBar(ratio, n = 52, kind = '') {
  const on = ratio >= 1 ? n : ratio > 0 ? Math.min(n - 1, Math.max(1, Math.round(ratio * n))) : 0;
  return `<div class="bar ${kind}">${Array.from({ length: n }, (_, i) => `<i${i < on ? ' class="on"' : ''}></i>`).join('')}</div>`;
}

const UPDOWN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4-4 4 4M8 14l4 4 4-4"/></svg>';

/** 1~5점 세로 페이더. 끌면 페이지 스크롤과 부딪히므로 높이마다 놓인 버튼을 눌러 고른다. */
export function fader({ field, label, low, high }, value, action) {
  const buttons = [5, 4, 3, 2, 1]
    .map((n) => `<button type="button" data-action="${action}" data-field="${field}" data-value="${n}" aria-pressed="${value === n}" aria-label="${label} ${n}점"></button>`)
    .join('');
  const place = { 1: ' above', 5: ' full' }[value] ?? ''; // 양 끝에서는 숫자가 위아래 글자와 겹치지 않게 옮긴다
  const level = value
    ? `<span class="fader-fill"></span><span class="fader-line${place}"></span><span class="fader-num${place}">${value}</span>`
    : `<span class="fader-knob">${UPDOWN_ICON}</span>`;
  return `<div class="fader-col">
    <p class="fader-name">${label}</p>
    <div class="fader"${value ? ` style="--level:${value * 20}%"` : ''}>
      ${level}
      <span class="fader-end top">5 ${high}</span>
      <span class="fader-end bottom">1 ${low}</span>
      <div class="fader-btns" role="group" aria-label="${label}">${buttons}</div>
    </div>
  </div>`;
}

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
  const hide = () => {
    el.classList.remove('show');
    el.querySelector('button')?.remove(); // 보이지 않는 되돌리기가 눌리거나 키보드로 잡히지 않게 한다
  };
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
    const hideSoon = () => {
      clearTimeout(toastTimer);
      toastTimer = setTimeout(hide, 1500);
    };
    let pressed = false; // 이 버튼에서 왼쪽 버튼이나 손가락으로 누르기 시작했는지
    // 되돌리려고 누르는 사이에 사라지지 않게 한다
    button.addEventListener('pointerdown', (e) => {
      pressed = e.button === 0;
      if (pressed) clearTimeout(toastTimer);
    });
    button.addEventListener('pointercancel', hideSoon);
    // 마우스로 누른 채 벗어나면 pointercancel도 클릭도 오지 않는다
    button.addEventListener('pointerleave', () => {
      if (pressed) hideSoon();
    });
    el.append(button);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, action ? 5000 : 2400);
}

/** 저장했다고 알리는 안내. 저장이 안 되는 동안에는 성공했다고 말하지 않는다. */
export const savedToast = (message, action) => toast(hasSaveFailed() ? '화면에는 보이지만 저장되지 않았어요' : message, action);

/** 칸을 벗어나며 띄우는 안내. 되돌리기나 새로고침을 누르는 순간에 나오면 그 버튼을 없애버리므로, 버튼이 떠 있으면 말하지 않는다. */
export const fieldToast = (message, show = toast) => {
  if (!document.querySelector('#toast button')) show(message);
};
export const fieldSavedToast = (message) => fieldToast(message, savedToast);

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
  let marked = null; // 터치에는 hover가 없어서, 지금 가리키는 점을 클래스로 표시한다
  const mark = (group) => {
    marked?.classList.remove('active');
    marked = group;
    marked?.classList.add('active');
  };
  const hide = () => {
    el.hidden = true;
    mark(null);
  };
  const show = (target, x, y) => {
    const tip = getTip(target.dataset.tip);
    if (!tip) return hide();
    mark(target.closest('.hitg'));
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
    // 터치로 끌 때 e.target은 처음 누른 막대에 고정되므로 손가락 아래 요소를 직접 찾는다
    const under = e.pointerType === 'touch' ? document.elementFromPoint(e.clientX, e.clientY) : e.target;
    const target = under?.closest?.('[data-tip]');
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
  document.addEventListener('focusout', (e) => {
    // 다른 막대를 탭해 포커스가 옮겨갈 때는 방금 띄운 툴팁을 닫지 않는다
    if (!e.relatedTarget?.closest?.('[data-tip]')) hide();
  });
  addEventListener('scroll', hide, { passive: true });
}
