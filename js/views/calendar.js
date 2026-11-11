// 달력 화면: 한 달 칸에 지난 날은 그날 기분을 눈금으로, 앞날은 계획을 점으로 찍는다.
// 날을 고르면 아래에 그날 일기(한 줄 메모, 컨디션, 잠, 한 일)와 그날 계획 카드를 둔다.
// 맨 위 덩어리는 언제나 달력과 고른 날 2개다. 입력 중에 다시 그릴 때(app.js renderAround) 덩어리 수가 같아야 한다.
import { areaById } from '../store.js';
import { fmtLong, sleepHours, todayKey } from '../dates.js';
import { addMonths, DAY_NAMES, DAY_ORDER, monthKeys, monthOf, monthSummary } from '../plans.js';
import { closePlanPanel, planCard } from '../plan-card.js';
import { isHard } from '../strain.js';
import { areaColor, entryList, refresh } from '../ui.js';
import { esc, fmtHM, fmtHours, sum } from '../util.js';
import { openDay } from './today.js';

let month = monthOf(todayKey());
let picked = todayKey();
const FILL_BACK = 3; // 오늘 탭에서 이만큼 지난 날까지 컨디션·수면·메모를 고칠 수 있다(today.js CATCH_UP)

/** 달력 탭에 들어올 때마다 이번 달 오늘로 돌아온다 */
export function enter() {
  month = monthOf(todayKey());
  picked = todayKey();
  closePlanPanel();
}

export const label = () => '달력';

const ARROW = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
const tired = (state) => new Set(state.marks.filter((m) => !m.rebase).map((m) => m.date)); // '지친 날로 표시'한 날

/** 그날 기분(1~5, 없으면 0)과 힘든 날인지. 기분 없이 힘든 날도 있다. 추정을 숨긴 사람에게는 힘든 날을 가리지 않는다 */
function moodOf(state, day) {
  const c = state.checkins[day];
  if (!c) return null;
  const hard = !state.profile.hide && isHard(c);
  return c.mood || hard ? { mood: c.mood ?? 0, hard } : null;
}

function dayLabel(day, info, mood, flagged, today) {
  const parts = [fmtLong(day)];
  if (mood?.mood) parts.push(`기분 5점 중 ${mood.mood}`);
  if (mood?.hard) parts.push('힘든 날');
  if (flagged) parts.push('지친 날로 표시한 날');
  if (info && day < today && info.done) parts.push(`계획 ${info.done}개 했어요`); // 지난 날에 안 한 수는 세지 않는다
  else if (info && day >= today) parts.push(`계획 ${info.total}개${info.done ? ` 중 ${info.done}개 했어요` : ''}`);
  return parts.join(', ');
}

function dayCell(day, info, today, state, flags) {
  // 기분을 남긴 날은 숫자 아래에 기분 눈금 5칸, 그렇지 않은 날은 계획 점
  const mood = day <= today ? moodOf(state, day) : null;
  const under = mood
    ? `<span class="cal-mood${mood.hard ? ' hard' : ''}">${[1, 2, 3, 4, 5].map((n) => `<i${n <= mood.mood ? ' class="on"' : ''}></i>`).join('')}</span>`
    : `<span class="cal-dots">${info ? info.dots.map((dot) => `<i class="cal-dot${dot.done ? '' : ' hollow'}" style="--c:${dot.areaId ? areaColor(areaById(dot.areaId, state)) : 'var(--ink-2)'}"></i>`).join('') + (info.more ? '<i class="cal-more">+</i>' : '') : ''}</span>`;
  const flagged = flags.has(day);
  return `<button type="button" class="cal-day" data-action="cal-pick" data-value="${day}" aria-pressed="${day === picked}"${day === today ? ' aria-current="date"' : ''} aria-label="${dayLabel(day, info, mood, flagged, today)}">
    ${flagged ? '<span class="cal-flag" aria-hidden="true"></span>' : ''}<span class="cal-num">${Number(day.slice(8))}</span><span aria-hidden="true">${under}</span>
  </button>`;
}

/** 달력 아래 작은 풀이. 이 달에 보이는 표시만 적는다 */
function legend(cells, state) {
  const items = [];
  if (cells.includes('cal-mood')) items.push('<span><span class="cal-mood"><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i></i></span>기분</span>');
  if (cells.includes('cal-mood hard')) items.push('<span><span class="cal-mood hard"><i class="on"></i><i class="on"></i><i></i><i></i><i></i></span>힘든 날</span>');
  if (cells.includes('cal-flag')) items.push('<span><i class="cal-flag"></i>지친 날로 표시한 날</span>');
  return items.length ? `<div class="cal-legend" aria-hidden="true">${items.join('')}</div>` : '';
}

const RELATIVE = ['오늘', '어제', '그제'];
const bar5 = (n) => `<span class="level-bar" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i${i <= n ? ' class="on"' : ''}></i>`).join('')}</span>`;

/** 고른 날의 일기. 지난 날과 오늘에만 있다. 남긴 것만 보여주고, 비어 있으면 남기러 가는 길을 둔다 */
function journalCard(state, day, today, flagged) {
  const back = daysBetween(day, today);
  const c = state.checkins[day] || {};
  const night = state.sleep[day];
  const hours = night ? sleepHours(night.bed, night.wake) : null;
  const entries = state.entries.filter((e) => e.date === day).sort((a, b) => a.createdAt - b.createdAt);
  const levels = [
    ['에너지', c.energy],
    ['스트레스', c.stress],
    ['기분', c.mood],
  ].filter(([, v]) => v);
  const cells = levels.map(([name, v]) => `<div class="level"><span class="level-name">${name}</span><b class="level-val">${v}<small>/5</small></b>${bar5(v)}</div>`);
  if (hours != null) cells.push(`<div class="level"><span class="level-name">잠</span><b class="level-val">${fmtHours(hours).replace('시간', '')}<small>시간</small></b>${bar5(Math.min(5, Math.round((hours / state.sleepGoal) * 5)))}</div>`);
  // 눈금으로 보여주지 않는 것도 남긴 기록이다
  const extras = [c.detach && `할 일 생각에서 벗어남 ${c.detach}/5`, hours == null && (night?.bed || night?.wake) && `${night.bed ? `${night.bed}에 잠` : ''}${night.bed && night.wake ? ', ' : ''}${night.wake ? `${night.wake}에 일어남` : ''}`, night?.quality && `수면의 질 ${night.quality}/5`, flagged && '지친 날로 표시했어요'].filter(Boolean);
  const anything = c.note || cells.length || entries.length || extras.length;
  const editable = back <= FILL_BACK;
  const go = editable ? `<button type="button" class="btn block" data-action="cal-open-day" data-value="${day}">${back ? '이날' : '오늘'} 기록 ${anything ? '고치기' : '남기기'}</button>` : '';
  const when = RELATIVE[back] ?? `${back}일 전`;
  return `<section class="card journal" aria-labelledby="journal-head">
    <p class="journal-when">${when}</p>
    <h2 id="journal-head">${fmtLong(day)}</h2>
    ${c.note ? `<p class="journal-quote">${esc(c.note)}</p>` : ''}
    ${cells.length ? `<div class="levels">${cells.join('')}</div>` : ''}
    ${extras.length ? `<p class="journal-extra">${extras.join('<br>')}</p>` : ''}
    ${entries.length ? `<p class="journal-sub">한 일 ${entries.length}개 · ${fmtHM(sum(entries, (e) => e.minutes))}</p>${entryList(entries, state)}` : ''}
    ${anything ? '' : `<p class="sub flush">${back ? '이날 남긴 기록이 없어요.' : '오늘은 아직 남긴 기록이 없어요.'}</p>`}
    ${go}
  </section>`;
}

export function render(state) {
  const today = todayKey();
  const [y, m] = month.split('-').map(Number);
  const summary = monthSummary(state.plans, month, today);
  const flags = tired(state);
  const cells = monthKeys(month)
    .flat()
    .map((day) => (day ? dayCell(day, summary.get(day), today, state, flags) : '<span class="cal-empty"></span>'))
    .join('');
  const away = month !== monthOf(today) || picked !== today;
  const past = picked <= today;
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
      ${legend(cells, state)}
    </section>
    <div data-slot="plan">${past ? journalCard(state, picked, today, flags.has(picked)) : ''}${planCard(state, picked, { where: 'calendar', today, title: past ? '계획' : null })}</div>`;
}

export const on = {
  click(e) {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const { action, value } = button.dataset;
    const today = todayKey();
    if (action === 'cal-open-day') {
      openDay(value, { keyboard: e.detail === 0 }); // 오늘 탭의 컨디션 카드에서 그날을 고친다
      location.hash = '#/today';
      return;
    }
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
