// 달력 화면: 한 달 칸에 계획을 점으로 찍고, 고른 날의 계획 카드를 아래에 둔다.
// 맨 위 덩어리는 언제나 달력과 계획 카드 2개다. 입력 중에 다시 그릴 때(app.js renderAround) 덩어리 수가 같아야 한다.
import { areaById } from '../store.js';
import { fmtLong, todayKey } from '../dates.js';
import { addMonths, DAY_NAMES, DAY_ORDER, monthKeys, monthOf, monthSummary } from '../plans.js';
import { closePlanPanel, planCard } from '../plan-card.js';
import { areaColor, refresh } from '../ui.js';

let month = monthOf(todayKey());
let picked = todayKey();

/** 달력 탭에 들어올 때마다 이번 달 오늘로 돌아온다 */
export function enter() {
  month = monthOf(todayKey());
  picked = todayKey();
  closePlanPanel();
}

export const label = () => '달력';

const ARROW = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function dayLabel(day, info, today) {
  if (!info) return fmtLong(day);
  if (day < today) return info.done ? `${fmtLong(day)}, ${info.done}개 했어요` : fmtLong(day); // 지난 날에 안 한 수는 세지 않는다
  return `${fmtLong(day)}, 계획 ${info.total}개${info.done ? ` 중 ${info.done}개 했어요` : ''}`;
}

function dayCell(day, info, today, state) {
  const dots = info
    ? info.dots.map((dot) => `<i class="cal-dot${dot.done ? '' : ' hollow'}" style="--c:${dot.areaId ? areaColor(areaById(dot.areaId, state)) : 'var(--ink-2)'}"></i>`).join('') + (info.more ? '<i class="cal-more">+</i>' : '')
    : '';
  return `<button type="button" class="cal-day" data-action="cal-pick" data-value="${day}" aria-pressed="${day === picked}"${day === today ? ' aria-current="date"' : ''} aria-label="${dayLabel(day, info, today)}">
    <span class="cal-num">${Number(day.slice(8))}</span><span class="cal-dots" aria-hidden="true">${dots}</span>
  </button>`;
}

export function render(state) {
  const today = todayKey();
  const [y, m] = month.split('-').map(Number);
  const summary = monthSummary(state.plans, month, today);
  const cells = monthKeys(month)
    .flat()
    .map((day) => (day ? dayCell(day, summary.get(day), today, state) : '<span class="cal-empty"></span>'))
    .join('');
  const away = month !== monthOf(today) || picked !== today;
  // '오늘로'는 화살표 앞에 둔다. 생기고 사라져도 화살표 자리가 그대로여야 연달아 눌러도 다른 버튼이 눌리지 않는다
  return `<section class="cal" aria-label="${y}년 ${m}월 달력">
      <div class="cal-head">
        <h1 class="cal-title"><small>${y}년</small> ${m}월</h1>
        <button type="button" class="btn small outline" data-action="cal-today"${away ? '' : ' hidden'}>오늘로</button>
        <button type="button" class="icon-btn" data-action="cal-month" data-value="-1" aria-label="지난달">${ARROW('M15 5l-7 7 7 7')}</button>
        <button type="button" class="icon-btn" data-action="cal-month" data-value="1" aria-label="다음 달">${ARROW('M9 5l7 7-7 7')}</button>
      </div>
      <div class="cal-week" aria-hidden="true">${DAY_ORDER.map((d) => `<span>${DAY_NAMES[d]}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
    </section>
    <div data-slot="plan">${planCard(state, picked, { where: 'calendar', today })}</div>`;
}

export const on = {
  click(e) {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const { action, value } = button.dataset;
    const today = todayKey();
    if (action === 'cal-pick') picked = value;
    else if (action === 'cal-month') {
      month = addMonths(month, Number(value));
      picked = month === monthOf(today) ? today : `${month}-01`;
    } else if (action === 'cal-today') {
      month = monthOf(today);
      picked = today;
    } else return;
    closePlanPanel();
    refresh();
    // 달을 넘기면 화살표에 포커스가 그대로라 바뀐 달을 읽어 주지 않는다. 화면 밖의 알림 칸에 적어 화면 읽기가 말하게 한다
    const announce = document.getElementById('announce');
    if (announce && action !== 'cal-pick') announce.textContent = `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;
    // '오늘로'는 누르면 사라지니, 키보드로 눌렀다면 오늘 칸으로 포커스를 옮긴다
    if (action === 'cal-today' && e.detail === 0) document.querySelector(`[data-action="cal-pick"][data-value="${today}"]`)?.focus({ preventScroll: true });
  },
};
