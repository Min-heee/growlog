// 오늘 화면: 컨디션·수면 체크인, 활동 기록, 이번 주 목표
import { activeAreas, addEntry, areaById, getState, resetState, setCheckin, setSleep } from '../store.js';
import { addDays, fmtLong, rangeKeys, sleepHours, todayKey, weekStartKey } from '../dates.js';
import { computeBurnout, MIN_DAYS } from '../burnout.js';
import { isIOS, isStandalone } from '../pwa.js';
import { avg, esc, fmtHM, fmtHours, sum } from '../util.js';
import { areaColor, ask, entryList, refresh, savedToast, statusBadge, toast } from '../ui.js';

const SCALES = [
  { field: 'energy', label: '에너지', low: '바닥', high: '넘침' },
  { field: 'stress', label: '스트레스', low: '평온', high: '극심' },
  { field: 'mood', label: '기분', low: '가라앉음', high: '최고' },
];
const SLEEP_SCALE = { field: 'quality', label: '수면의 질', low: '뒤척임', high: '개운함' };
const QUICK_MINUTES = [10, 30, 60];
const PLACEHOLDER = { exercise: '예: 러닝 5km', study: '예: 영어 단어 50개', dev: '예: 로그인 기능 구현' };

// 입력 중인 내용은 화면을 다시 그려도 남아 있어야 한다
let draft = { areaId: null, minutes: '', title: '', date: '' };
let savedAt = 0; // 저장 직후 한 번 더 눌려도 오류 안내로 덮지 않는다
// 자정을 넘겨 화면을 켜둔 채 입력해도 화면에 보이는 날짜로 저장되도록 그릴 때의 날짜를 쓴다
let shownDay = todayKey();
const OLDEST_DAYS = 29; // 통계에서 볼 수 있는 가장 오래된 날

function scale({ field, label, low, high }, value, action) {
  const buttons = [1, 2, 3, 4, 5]
    .map((n) => `<button type="button" class="seg-btn" data-action="${action}" data-field="${field}" data-value="${n}" aria-pressed="${value === n}" aria-label="${label} ${n}점">${n}</button>`)
    .join('');
  return `<div class="scale">
    <div class="scale-head"><span class="scale-label">${label}</span><span class="scale-hint">1 ${low} · 5 ${high}</span></div>
    <div class="seg" role="group" aria-label="${label}">${buttons}</div>
  </div>`;
}

function burnoutCard(state, today) {
  const b = computeBurnout(state, today);
  if (b.score == null) {
    return `<a class="card link-card" href="#/burnout">
      <div class="grow"><p class="eyebrow">번아웃 지수</p><p class="mini-advice">컨디션이나 수면을 ${MIN_DAYS}일 기록하면 지수를 알려드려요. (지금 ${b.dataDays}일)</p></div>
      <span class="chev" aria-hidden="true">›</span>
    </a>`;
  }
  return `<a class="card link-card" href="#/burnout">
    <div class="grow">
      <p class="eyebrow">번아웃 지수 · 최근 7일</p>
      <div class="mini-score"><strong>${b.score}</strong><span>/100</span>${statusBadge(b.level)}</div>
      <p class="mini-advice">${esc(b.advice[0].text)}</p>
    </div>
    <span class="chev" aria-hidden="true">›</span>
  </a>`;
}

function conditionCard(state, today) {
  const checkin = state.checkins[today] || {};
  const night = state.sleep[today] || {};
  const hours = sleepHours(night.bed, night.wake);
  return `<section class="card">
    <div class="card-head"><h2>오늘의 컨디션</h2></div>
    ${SCALES.map((s) => scale(s, checkin[s.field], 'checkin')).join('')}
    <div class="divider"></div>
    <div class="card-head"><h3>어젯밤 수면</h3><span class="sleep-total" data-sleep-total>${hours != null ? fmtHours(hours) : '–'}</span></div>
    <div class="stack">
      <div class="row">
        <label class="field grow"><span>잠든 시간</span><input type="time" data-sleep="bed" value="${esc(night.bed || '')}"></label>
        <label class="field grow"><span>일어난 시간</span><input type="time" data-sleep="wake" value="${esc(night.wake || '')}"></label>
      </div>
      ${scale(SLEEP_SCALE, night.quality, 'sleep')}
      <label class="field"><span>한 줄 메모</span><input type="text" data-note maxlength="120" value="${esc(checkin.note || '')}" placeholder="오늘 기분이나 컨디션을 짧게 남겨보세요"></label>
    </div>
  </section>`;
}

function entryCard(areas, today) {
  if (!areas.length) {
    return `<section class="card"><h2>활동 기록</h2><p class="sub">설정에서 활동 영역을 먼저 추가해주세요.</p><a class="btn" href="#/settings">설정으로 가기</a></section>`;
  }
  const chips = areas
    .map((a) => `<button type="button" class="chip" data-action="pick-area" data-id="${esc(a.id)}" aria-pressed="${a.id === draft.areaId}"><span class="dot" style="background:${areaColor(a)}"></span>${esc(a.emoji)} ${esc(a.label)}</button>`)
    .join('');
  const quick = QUICK_MINUTES.map((m) => `<button type="button" class="chip small" data-action="quick" data-value="${m}">+${m}분</button>`).join('');
  return `<section class="card">
    <h2>활동 기록</h2>
    <p class="sub">무엇을 얼마나 했는지 남겨요. 타이머를 쓰면 자동으로 기록돼요.</p>
    <form class="stack" data-form="entry" novalidate>
      <div class="chips" role="group" aria-label="영역">${chips}</div>
      <label class="field"><span>한 일</span><input name="title" data-draft="title" maxlength="60" value="${esc(draft.title)}" placeholder="${esc((Object.hasOwn(PLACEHOLDER, draft.areaId ?? '') && PLACEHOLDER[draft.areaId]) || '예: 무엇을 했는지 짧게')}"></label>
      <div class="row">
        <label class="field grow"><span>시간(분)</span><input name="minutes" data-draft="minutes" type="number" inputmode="numeric" min="1" max="1440" value="${esc(draft.minutes)}" placeholder="30"></label>
        <label class="field grow"><span>날짜</span><input name="date" data-draft="date" type="date" min="${addDays(today, -OLDEST_DAYS)}" max="${today}" value="${esc(draft.date || today)}"></label>
      </div>
      <div class="chips">${quick}</div>
      <button class="btn primary block" type="submit">기록하기</button>
    </form>
  </section>`;
}

function goalRow({ name, color, done, goal, ratio }) {
  const met = goal && ratio >= 1;
  return `<div class="goal">
    <div class="goal-head">
      <span class="goal-name"><span class="dot" style="background:${color}"></span>${name}</span>
      <span class="goal-val"><strong>${done}</strong>${goal ? ` / ${goal}` : ''}${met ? ' <span class="met">✓ 달성</span>' : ''}</span>
    </div>
    <div class="bar"><span style="width:${Math.min(100, ratio * 100).toFixed(1)}%;background:${color}"></span></div>
  </div>`;
}

function weekCard(state, areas, today) {
  const start = weekStartKey(today);
  const days = rangeKeys(today, 7).filter((k) => k >= start);
  const week = state.entries.filter((e) => e.date >= start && e.date <= today);
  const rows = areas.map((a) => {
    const done = sum(week.filter((e) => e.areaId === a.id), (e) => e.minutes);
    return goalRow({
      name: `${esc(a.emoji)} ${esc(a.label)}`,
      color: areaColor(a),
      done: fmtHM(done),
      goal: a.goal ? fmtHM(a.goal) : null,
      ratio: a.goal ? done / a.goal : 0,
    });
  });
  const sleepAvg = avg(days.map((k) => state.sleep[k]).filter(Boolean).map((n) => sleepHours(n.bed, n.wake)).filter((h) => h != null));
  rows.push(
    goalRow({
      name: '😴 평균 수면',
      color: 'var(--s7)',
      done: sleepAvg == null ? '기록 없음' : fmtHours(sleepAvg),
      goal: fmtHours(state.sleepGoal),
      ratio: sleepAvg == null ? 0 : sleepAvg / state.sleepGoal,
    }),
  );
  return `<section class="card">
    <div class="card-head"><h2>이번 주 목표</h2><span class="hint">${8 - days.length}일 남음</span></div>
    ${rows.join('')}
  </section>`;
}

function todayCard(state, today) {
  const list = state.entries.filter((e) => e.date === today).sort((a, b) => b.createdAt - a.createdAt);
  return `<section class="card">
    <div class="card-head"><h2>오늘 한 일</h2><span class="hint">${list.length ? `총 ${fmtHM(sum(list, (e) => e.minutes))}` : ''}</span></div>
    ${list.length ? entryList(list, state) : '<p class="empty">아직 기록이 없어요. 작은 것부터 남겨보세요.</p>'}
  </section>`;
}

export function render(state) {
  shownDay = todayKey();
  const today = shownDay;
  const areas = activeAreas(state);
  // 입력 중이면 고른 영역을 몰래 바꾸지 않는다. 지워졌다면 기록할 때 알려준다.
  if (!document.activeElement?.closest?.('[data-form="entry"]') && !areas.some((a) => a.id === draft.areaId)) draft.areaId = areas[0]?.id ?? null;
  const banner = state.sample
    ? '<div class="banner"><span>샘플 데이터로 둘러보는 중이에요.</span><button type="button" class="btn small" data-action="clear-sample">지우고 시작하기</button></div>'
    : '';
  const safariTip =
    isIOS() && !isStandalone()
      ? '<div class="banner"><span>Safari에만 둔 기록은 일주일쯤 열지 않으면 지워질 수 있어요.</span><a class="btn small" href="#/settings">홈 화면에 추가</a></div>'
      : '';
  return `${banner}${safariTip}
    <header class="page-head">
      <p class="eyebrow">오늘</p>
      <h1>${fmtLong(today)}</h1>
    </header>
    <div data-slot="burnout">${burnoutCard(state, today)}</div>
    ${conditionCard(state, today)}
    ${entryCard(areas, today)}
    <div data-slot="week">${weekCard(state, areas, today)}</div>
    ${todayCard(state, today)}`;
}

export const on = {
  async click(e) {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const { action, field, value, id } = button.dataset;
    if (action === 'checkin') setCheckin(shownDay, { [field]: Number(value) });
    else if (action === 'sleep') setSleep(shownDay, { [field]: Number(value) });
    else if (action === 'pick-area') {
      draft.areaId = id;
      refresh();
    } else if (action === 'quick') {
      const input = button.form.elements.minutes;
      draft.minutes = String((Number(input.value) || 0) + Number(value));
      input.value = draft.minutes;
    } else if (action === 'clear-sample' && (await ask('샘플 데이터와 그동안 직접 남긴 기록까지 모두 지워져요. 지우고 새로 시작할까요?', '모두 지우기'))) {
      resetState();
      savedToast('깨끗하게 비웠어요. 오늘부터 시작해봐요!');
    }
  },
  input(e) {
    const key = e.target.dataset.draft;
    if (key) draft[key] = e.target.value;
    // 메모는 글자마다 저장해, 입력 중에 앱을 벗어나거나 화면을 다시 그려도 남게 한다
    else if ('note' in e.target.dataset) setCheckin(shownDay, { note: e.target.value.trim() }, { quiet: true });
  },
  change(e) {
    const el = e.target;
    if (el.dataset.sleep) {
      // 시간 입력칸은 값을 고치는 도중에도 change가 불려서, 전체를 다시 그리지 않고 필요한 곳만 고친다
      setSleep(shownDay, { [el.dataset.sleep]: el.value }, { quiet: true });
      const state = getState();
      const night = state.sleep[shownDay];
      const hours = sleepHours(night.bed, night.wake);
      document.querySelector('[data-sleep-total]').textContent = hours != null ? fmtHours(hours) : '–';
      document.querySelector('[data-slot="burnout"]').innerHTML = burnoutCard(state, shownDay);
      document.querySelector('[data-slot="week"]').innerHTML = weekCard(state, activeAreas(state), shownDay);
    } else if ('note' in el.dataset) savedToast('메모를 저장했어요');
  },
  submit(e) {
    e.preventDefault();
    const complain = (message) => {
      document.activeElement?.blur(); // 키보드를 내려 안내가 가려지지 않게 한다
      toast(message);
    };
    if (!draft.minutes && Date.now() - savedAt < 500) return;
    const minutes = Math.round(Number(draft.minutes));
    const today = todayKey();
    const date = draft.date || shownDay;
    if (!areaById(draft.areaId)) {
      refresh(); // 다른 탭에서 지운 영역이 입력 중인 화면에 남아 있을 수 있다
      return complain('영역을 먼저 골라주세요');
    }
    if (!(minutes >= 1 && minutes <= 1440)) return complain('시간을 1~1440분 사이로 입력해주세요');
    if (date > today || date < addDays(today, -OLDEST_DAYS)) return complain('날짜는 오늘부터 최근 30일 안에서 골라주세요');
    const entry = { date, areaId: draft.areaId, minutes, title: draft.title };
    // addEntry가 곧바로 화면을 다시 그리므로 입력값을 먼저 비운다
    draft = { ...draft, minutes: '', title: '', date: '', areaId: activeAreas(getState()).some((a) => a.id === entry.areaId) ? entry.areaId : null };
    addEntry(entry);
    savedAt = Date.now();
    savedToast(`${areaById(entry.areaId).label} ${fmtHM(minutes)} 기록했어요`);
  },
};
