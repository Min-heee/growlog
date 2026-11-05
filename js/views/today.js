// 오늘 화면: 컨디션·수면 체크인, 활동 기록, 이번 주 목표
import { activeAreas, addArea, addEntry, areaById, canAddArea, freeColors, getState, lastFeel, MAX_AREAS, resetState, setCheckin, setSleep, setSupportSeen } from '../store.js';
import { addDays, fmtDay, fmtLong, rangeKeys, sleepHours, todayKey, weekStartKey } from '../dates.js';
import { BANDS, bandWord, insight } from '../insight.js';
import { isIOS, isStandalone } from '../pwa.js';
import { openMarkForm } from './recovery.js';
import { avg, esc, fmtHM, fmtHours, sum } from '../util.js';
import { areaColor, ask, colorChoices, entryList, fader, feelChoices, fieldSavedToast, ratingScale, refresh, savedToast, tickBar, toast } from '../ui.js';

const SCALES = [
  { field: 'energy', label: '에너지', low: '바닥', high: '넘침' },
  { field: 'stress', label: '스트레스', low: '평온', high: '극심' },
  { field: 'mood', label: '기분', low: '가라앉음', high: '최고' },
];
const DETACH_SCALE = { field: 'detach', label: '할 일 생각에서 벗어남 (선택)', low: '계속 붙잡힘', high: '완전히 벗어남' };
const SLEEP_SCALE = { field: 'quality', label: '수면의 질', low: '뒤척임', high: '개운함' };
const CATCH_UP = [
  [0, '오늘'],
  [1, '어제'],
  [2, '그제'],
  [3, '3일 전'],
];
const QUICK_MINUTES = [10, 30, 60];
const PLACEHOLDER = { exercise: '예: 러닝 5km', study: '예: 영어 단어 50개', dev: '예: 로그인 기능 구현' };
const KINDS = [
  ['load', '해야 하는 일'],
  ['varies', '그때그때 달라요'],
];
const KIND_NOTES = {
  load: '공부, 일처럼 기록한 시간만큼 에너지를 쓴 것으로 쳐요.',
  varies: '운동, 게임, 취미처럼 기록할 때마다 끝나고 어땠는지 골라요.',
};

// 입력 중인 내용은 화면을 다시 그려도 남아 있어야 한다
// feel: { areaId, value }. 고른 영역이 어떤 길로 바뀌어도 다른 영역의 값이 넘어가지 않게 영역과 함께 둔다. 없으면 그 영역에서 지난번에 고른 값
let draft = { areaId: null, minutes: '', title: '', date: '', feel: null };
const NEW_AREA = { open: false, label: '', color: null, kind: 'load' };
let maker = { ...NEW_AREA }; // 활동 기록 칸에서 새 영역을 만드는 중인 내용
let savedAt = 0; // 저장 직후 한 번 더 눌려도 오류 안내로 덮지 않는다
// 자정을 넘겨 화면을 켜둔 채 입력해도 화면에 보이는 날짜로 저장되도록 그릴 때의 날짜를 쓴다
let shownDay = todayKey();
const OLDEST_DAYS = 29; // 통계에서 볼 수 있는 가장 오래된 날
let daysBack = 0; // 밀린 날을 채우는 중이면 며칠 전인지
let sleepOpen = null; // 수면 입력칸. null이면 아직 정해지지 않아서, 그날 수면 기록이 없으면 연다.
let sleepShown = false; // 저절로 열린 입력칸을 타일을 눌러 이미 보여줬는지
const LONG_WORD = 13; // 이보다 긴 말은 큰 글씨로 쓰면 네 줄을 넘는다
const SHORT_WORD = 11; // 이 안의 말은 가장 큰 글씨로 써도 두 줄에 들어간다

const pickedDay = () => addDays(shownDay, -daysBack);

/** 수면 입력칸을 처음 상태로 돌린다. 날이 바뀌거나 기록을 지웠을 때 쓴다. */
export function resetSleepForm() {
  sleepOpen = null;
  sleepShown = false;
}

let makerWanted = false; // 다른 화면에서 영역을 만들러 왔다

/** 다른 화면에서 오늘로 넘어오며 영역 만들기 칸을 열어둔다 */
export function openAreaMaker() {
  maker.open = true;
  makerWanted = true;
}

export function arrive() {
  if (!makerWanted) return;
  makerWanted = false;
  const input = document.querySelector('[data-maker="label"]');
  input?.scrollIntoView({ block: 'center' });
  input?.focus({ preventScroll: true });
}

/** 기록을 지우거나 바꿔 끼웠을 때, 만들다 만 영역도 함께 비운다 */
export function resetTodayDrafts() {
  resetSleepForm();
  maker = { ...NEW_AREA };
}

function loadHero(state, i) {
  if (state.profile.hide) return '<div class="hero"><h1 class="hero-word">오늘</h1></div>';
  const [word, note] = {
    empty: i.savedDays ? ['컨디션 기록이 아직 없어요', `기록 ${i.savedDays}일은 저장돼 있어요. 컨디션을 두 가지 이상 남기면 비교할 수 있어요.`] : ['기록을 시작해볼까요', '컨디션을 남기면 내 평소를 알아가기 시작해요.'],
    building: [BANDS.building, `기록 ${i.entries}${i.entries < 7 ? '/7' : '일'}. 쌓일수록 내 기준에 가까워져요.`],
    unknown: ['최근 컨디션 기록이 없어서 지금은 알 수 없어요', '아래에서 3일 전까지 채울 수 있어요.'],
    restart: ['다시 시작해요', '쌓인 부하를 처음부터 다시 쌓아요.'],
    noUsual: [BANDS.building, '아직 비교할 평소가 없어요. 기록은 그대로 쌓이고 있어요.'],
    trend: [i.band ? bandWord(i) : '', `최근 14일 중 <b>힘든 날 ${i.recent.hard}일</b>`],
  }[i.status];
  const days = i.recent.days.map((hard) => `<i${hard ? ' class="lit"' : hard === null ? ' class="none"' : ''}></i>`).join('');
  return `<a class="hero" href="#/recovery">
    <h1 class="hero-word${word.length > LONG_WORD ? ' long' : word.length <= SHORT_WORD ? ' xl' : ''}">${esc(word)}</h1>
    ${i.recent.logged ? `<div class="ticks" role="img" aria-label="최근 14일 중 힘든 날 ${i.recent.hard}일">${days}</div>` : ''}
    <p class="hero-note">${note}</p>
  </a>`;
}

function supportLine({ support }) {
  return support
    ? `<div class="banner"><span>${esc(support.text)}</span><div class="banner-actions"><a class="btn small" href="#/help">도움받을 곳</a><button type="button" class="btn small ghost" data-action="support-close">닫기</button></div></div>`
    : '';
}

function dayChips(today) {
  const chips = CATCH_UP.map(([back, label]) => `<button type="button" class="chip small" data-action="back" data-value="${back}" aria-pressed="${back === daysBack}">${label}</button>`).join('');
  return `<div class="chips" role="group" aria-label="어느 날을 남길까요">${chips}</div>`;
}

function conditionCard(state, today) {
  const day = addDays(today, -daysBack);
  const checkin = state.checkins[day] || {};
  return `<section class="card">
    <div class="card-head"><h2>${daysBack ? `<span class="nowrap">${fmtDay(day)}은</span> 어땠나요` : '오늘은 어땠나요'}</h2><button type="button" class="btn small outline" data-action="mark-day">지친 날로 표시</button></div>
    <div class="stack">
      ${dayChips(today)}
      <div class="faders">${SCALES.map((s) => fader(s, checkin[s.field], 'checkin')).join('')}</div>
      ${ratingScale(DETACH_SCALE, checkin.detach, 'checkin')}
      <label class="field"><span>한 줄 메모 (선택)</span><input type="text" data-note maxlength="120" value="${esc(checkin.note || '')}" placeholder="오늘을 짧게 남겨보세요"></label>
    </div>
  </section>`;
}

function sleepTile(state, day) {
  const night = state.sleep[day] || {};
  const hours = sleepHours(night.bed, night.wake);
  const total = hours == null ? null : Math.round(hours * 60);
  const big = total == null ? '<span>–</span>' : `<span>${Math.floor(total / 60)}<small>시간</small></span>${total % 60 ? `<span>${total % 60}<small>분</small></span>` : ''}`;
  return `<button type="button" class="card sleep-tile" data-action="sleep-open" aria-expanded="${!!sleepOpen}"${sleepOpen ? ' aria-controls="sleep-form"' : ''}>
    <span class="sleep-name">${daysBack ? `${fmtDay(day)} 수면` : '어젯밤 수면'}</span>
    <span class="sleep-big">${big}</span>
    <span class="sleep-range">${total != null ? `${esc(night.bed)}–${esc(night.wake)}` : sleepOpen ? '아래에 남기기' : '눌러서 남기기'}</span>
  </button>`;
}

function sleepForm(state, day) {
  if (!sleepOpen) return '';
  const night = state.sleep[day] || {};
  return `<section class="card" id="sleep-form">
    <div class="stack">
      <div class="row">
        <label class="field grow"><span>잠든 시간</span><input type="time" data-sleep="bed" value="${esc(night.bed || '')}"></label>
        <label class="field grow"><span>일어난 시간</span><input type="time" data-sleep="wake" value="${esc(night.wake || '')}"></label>
      </div>
      ${ratingScale(SLEEP_SCALE, night.quality, 'sleep')}
    </div>
  </section>`;
}

function areaMaker(state, areas) {
  const free = freeColors(state);
  const color = free.includes(maker.color) ? maker.color : free[0];
  const kinds = KINDS.map(([value, label]) => `<button type="button" class="seg-btn" data-action="maker-kind" data-value="${value}" aria-pressed="${maker.kind === value}">${label}</button>`).join('');
  return `<div class="maker stack" id="area-maker">
    <label class="field"><span>이름</span><input data-maker="label" maxlength="12" value="${esc(maker.label)}" placeholder="예: 독서, 러닝, 영어" enterkeyhint="done"></label>
    <div><div class="scale-head"><span class="scale-label">동그라미 색</span></div>${colorChoices(color, free, 'maker-color')}</div>
    <div><div class="scale-head"><span class="scale-label">이 활동은</span><span class="scale-hint">쌓인 부하 계산에 쓰여요</span></div><div class="seg" role="group" aria-label="이 활동은">${kinds}</div><p class="hint kind-note">${KIND_NOTES[maker.kind]}</p></div>
    <div class="btn-row">${areas.length ? '<button type="button" class="btn small" data-action="maker-close">취소</button>' : ''}<button type="button" class="btn small primary" data-action="maker-save">만들기</button></div>
  </div>`;
}

function entryCard(state, areas, today) {
  const chips = areas
    .map((a) => `<button type="button" class="chip" data-action="pick-area" data-id="${esc(a.id)}" aria-pressed="${a.id === draft.areaId}"><span class="dot" style="background:${areaColor(a)}"></span>${esc(a.label)}</button>`)
    .join('');
  // 영역이 없거나 쓰던 이름이 있으면 열어둔다. 다른 탭에서 영역이 생겨도 쓰던 이름이 사라지지 않는다.
  const open = canAddArea(state) && (maker.open || !areas.length || maker.label.trim() !== '');
  const add = areas.length && canAddArea(state) ? `<button type="button" class="chip add" data-action="maker-open" aria-expanded="${open}"${open ? ' aria-controls="area-maker"' : ''}>+ 새 영역</button>` : '';
  const quick = QUICK_MINUTES.map((m) => `<button type="button" class="chip small" data-action="quick" data-value="${m}">+${m}분</button>`).join('');
  const picked = areas.find((a) => a.id === draft.areaId);
  // 버튼마다 영역을 붙여, 다시 그리지 못한 칸이 남아 있어도 다른 영역의 값으로 저장되지 않게 한다
  const feel = picked?.kind === 'varies' ? feelChoices(draft.feel?.areaId === picked.id ? draft.feel.value : lastFeel(picked.id, state), 'feel', picked.id) : '';
  // 숨긴 영역도 자리를 차지하므로, 모두 숨겨 자리가 없으면 설정에서 되살리거나 지우게 한다
  const full = `<p class="sub flush">영역은 ${MAX_AREAS}개까지 만들 수 있어요. 설정의 숨긴 영역에서 되살리거나 지워주세요.</p><a class="btn" href="#/settings">설정으로 가기</a>`;
  const form = `<form class="stack" data-form="entry" novalidate>
      <label class="field"><span>한 일</span><input name="title" data-draft="title" maxlength="60" value="${esc(draft.title)}" placeholder="${esc((Object.hasOwn(PLACEHOLDER, draft.areaId ?? '') && PLACEHOLDER[draft.areaId]) || '예: 무엇을 했는지 짧게')}"></label>
      <div class="row">
        <label class="field grow"><span>시간(분)</span><input name="minutes" data-draft="minutes" type="number" inputmode="numeric" min="1" max="1440" value="${esc(draft.minutes)}" placeholder="30"></label>
        <label class="field grow"><span>날짜</span><input name="date" data-draft="date" type="date" min="${addDays(today, -OLDEST_DAYS)}" max="${today}" value="${esc(draft.date || today)}"></label>
      </div>
      <div class="chips">${quick}</div>
      ${feel}
      <button class="btn primary block" type="submit">기록하기</button>
    </form>`;
  return `<section class="card" data-card="entry">
    <h2>활동 기록</h2>
    <p class="sub">${areas.length ? '무엇을 얼마나 했는지 남겨요. 타이머를 쓰면 자동으로 기록돼요.' : '무엇을 기록할지 먼저 만들어요. 이름과 동그라미 색을 골라주세요.'}</p>
    <div class="stack">
      ${areas.length ? `<div class="chips" role="group" aria-label="영역">${chips}${add}</div>` : ''}
      ${open ? areaMaker(state, areas) : !areas.length ? full : ''}
      ${areas.length ? form : ''}
    </div>
  </section>`;
}

function goalRow({ name, done, goal, ratio }) {
  const met = goal && ratio >= 1;
  return `<div class="goal">
    <div class="goal-head">
      <span class="goal-name">${name}</span>
      <span class="goal-val"><strong>${done}</strong>${met ? ' <span class="met">✓ 달성</span>' : goal ? ` / ${goal}` : ''}</span>
    </div>
    ${tickBar(ratio, 30)}
  </div>`;
}

function weekCard(state, areas, today) {
  const start = weekStartKey(today);
  const days = rangeKeys(today, 7).filter((k) => k >= start);
  const week = state.entries.filter((e) => e.date >= start && e.date <= today);
  const rows = areas.map((a) => {
    const done = sum(week.filter((e) => e.areaId === a.id), (e) => e.minutes);
    return goalRow({
      name: esc(a.label),
      done: fmtHM(done),
      goal: a.goal ? fmtHM(a.goal) : null,
      ratio: a.goal ? done / a.goal : 0,
    });
  });
  const sleepAvg = avg(days.map((k) => state.sleep[k]).filter(Boolean).map((n) => sleepHours(n.bed, n.wake)).filter((h) => h != null));
  rows.push(
    goalRow({
      name: '평균 수면',
      done: sleepAvg == null ? '기록 없음' : fmtHours(sleepAvg),
      goal: fmtHours(state.sleepGoal),
      ratio: sleepAvg == null ? 0 : sleepAvg / state.sleepGoal,
    }),
  );
  return `<section class="card goals-tile">
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
  const today = todayKey();
  if (today !== shownDay) {
    daysBack = 0; // 날이 바뀌면 어제 칸을 열어둔 채로 남기지 않는다
    resetSleepForm();
  }
  shownDay = today;
  const day = pickedDay();
  // 입력을 마쳐도 고르던 칸이 사라지지 않도록, 한 번 열린 뒤로는 사용자가 누를 때만 바꾼다
  if (sleepOpen === null && sleepHours(state.sleep[day]?.bed, state.sleep[day]?.wake) == null) sleepOpen = true;
  const areas = activeAreas(state);
  // 활동 기록 칸에 글자를 쓰는 중이면 그 칸은 다시 그리지 않으니, 고른 영역도 몰래 바꾸지 않는다. 지워졌다면 기록할 때 알려준다.
  const typing = document.activeElement?.matches?.('input, select, textarea') && document.activeElement.closest('[data-card="entry"]');
  if (!typing && !areas.some((a) => a.id === draft.areaId)) draft.areaId = areas[0]?.id ?? null;
  const banner = state.sample
    ? '<div class="banner"><span>샘플 데이터로 둘러보는 중이에요.</span><button type="button" class="btn small" data-action="clear-sample">지우고 시작하기</button></div>'
    : '';
  const safariTip =
    isIOS() && !isStandalone()
      ? '<div class="banner"><span>Safari에만 둔 기록은 일주일쯤 열지 않으면 지워질 수 있어요.</span><a class="btn small" href="#/settings">홈 화면에 추가</a></div>'
      : '';
  const i = insight(state, today);
  return `${banner}${safariTip}
    ${supportLine(i)}
    <div data-slot="load">${loadHero(state, i)}</div>
    ${conditionCard(state, today)}
    <div class="bento">
      <div data-slot="sleep">${sleepTile(state, day)}</div>
      <div data-slot="week">${weekCard(state, areas, today)}</div>
    </div>
    <div>${sleepForm(state, day)}</div>
    ${entryCard(state, areas, today)}
    ${todayCard(state, today)}`;
}

export const label = () => fmtLong(todayKey());

function saveArea() {
  const label = maker.label.trim();
  if (!label) {
    document.querySelector('[data-maker="label"]')?.focus();
    toast('이름을 먼저 적어주세요');
    return false;
  }
  const free = freeColors(getState());
  const id = addArea({ label, kind: maker.kind, color: free.includes(maker.color) ? maker.color : free[0] });
  if (!id) {
    refresh(); // 다른 탭에서 자리를 채웠을 수 있다
    toast(`영역은 최대 ${MAX_AREAS}개까지 만들 수 있어요`);
    return false;
  }
  maker = { ...NEW_AREA };
  draft.areaId = id;
  document.activeElement?.blur(); // 키보드를 내린다
  refresh();
  savedToast(`'${label}' 영역을 만들었어요`);
  return true;
}

export const on = {
  async click(e) {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const { action, field, value, id } = button.dataset;
    if (action === 'checkin') setCheckin(pickedDay(), { [field]: Number(value) });
    else if (action === 'sleep') setSleep(pickedDay(), { [field]: Number(value) });
    else if (action === 'back') {
      daysBack = Number(value);
      resetSleepForm();
      refresh();
    } else if (action === 'sleep-open') {
      // 열려 있어도 탭 막대에 가려 있었다면 닫지 않고 보여주기만 한다.
      // 좁은 화면에서는 입력칸과 타일이 한 화면에 들어가지 않으니, 보여주는 건 한 번만 하고 다음에는 닫는다.
      const before = scrollY;
      if (sleepOpen && !sleepShown) document.getElementById('sleep-form')?.scrollIntoView({ block: 'nearest' });
      sleepShown = true;
      if (scrollY !== before) return;
      sleepOpen = !sleepOpen;
      refresh();
      if (sleepOpen) document.getElementById('sleep-form').scrollIntoView({ block: 'nearest' });
    } else if (action === 'mark-day') {
      openMarkForm(pickedDay());
      location.hash = '#/recovery';
    } else if (action === 'support-close') setSupportSeen();
    else if (action === 'pick-area') {
      draft.areaId = id;
      refresh();
    } else if (action === 'feel') {
      draft.feel = { areaId: id, value };
      refresh();
    } else if (action === 'maker-open') {
      maker.open = true;
      refresh();
      document.querySelector('[data-maker="label"]')?.focus();
    } else if (action === 'maker-close') {
      maker = { ...NEW_AREA };
      refresh();
      document.querySelector('[data-action="maker-open"]')?.focus({ preventScroll: true });
    } else if (action === 'maker-color') {
      maker.color = Number(value);
      refresh();
    } else if (action === 'maker-kind') {
      maker.kind = value;
      refresh();
    } else if (action === 'maker-save') {
      const { left, top, width, height } = button.getBoundingClientRect();
      if (!saveArea()) return;
      // 두 번 누르면 두 번째 탭이 만들기 자리에 새로 나타난 칸을 누른다. 그 칸만 잠깐 막는다.
      const under = document.elementFromPoint(left + width / 2, top + height / 2)?.closest('.field, button, a');
      if (under) {
        under.style.pointerEvents = 'none';
        setTimeout(() => under.style.removeProperty('pointer-events'), 400);
      }
    } else if (action === 'quick') {
      const input = button.form.elements.minutes;
      draft.minutes = String((Number(input.value) || 0) + Number(value));
      input.value = draft.minutes;
    } else if (action === 'clear-sample' && (await ask('샘플 데이터와 그동안 직접 남긴 기록까지 모두 지워져요. 지우고 새로 시작할까요?', '모두 지우기'))) {
      resetTodayDrafts();
      resetState({ keepTheme: true, keepProfile: true });
      savedToast('깨끗하게 비웠어요. 오늘부터 시작해봐요!');
    }
  },
  keydown(e) {
    if (e.target.dataset.maker === 'label' && e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) saveArea(); // 229: 한글 조합을 마치는 Enter
  },
  input(e) {
    const key = e.target.dataset.draft;
    if (key) draft[key] = e.target.value;
    else if (e.target.dataset.maker === 'label') maker.label = e.target.value;
    // 메모는 글자마다 저장해, 입력 중에 앱을 벗어나거나 화면을 다시 그려도 남게 한다
    else if ('note' in e.target.dataset) setCheckin(pickedDay(), { note: e.target.value.trim() }, { quiet: true });
  },
  change(e) {
    const el = e.target;
    if (el.dataset.sleep) {
      // 시간 입력칸은 값을 고치는 도중에도 change가 불려서, 전체를 다시 그리지 않고 필요한 곳만 고친다
      setSleep(pickedDay(), { [el.dataset.sleep]: el.value }, { quiet: true });
      const state = getState();
      document.querySelector('[data-slot="sleep"]').innerHTML = sleepTile(state, pickedDay());
      document.querySelector('[data-slot="load"]').innerHTML = loadHero(state, insight(state, shownDay));
      document.querySelector('[data-slot="week"]').innerHTML = weekCard(state, activeAreas(state), shownDay);
    } else if ('note' in el.dataset) fieldSavedToast('메모를 저장했어요');
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
    // 화면에 눌려 보이던 그 영역의 값을 남긴다. 그사이 다른 탭에서 기록이 늘어 지난번 값이 바뀌어도 보던 값이 저장된다.
    // 묻는 칸을 보지 못했다면(다른 탭에서 종류를 바꿨다면) 붙이지 않아, 보던 대로 해야 하는 일처럼 부하로 친다.
    const shown = e.target.querySelector('.feel [aria-pressed="true"]');
    const feel = areaById(draft.areaId).kind === 'varies' && shown?.dataset.id === draft.areaId ? shown.dataset.value : undefined;
    const entry = { date, areaId: draft.areaId, minutes, title: draft.title, feel };
    // addEntry가 곧바로 화면을 다시 그리므로 입력값을 먼저 비운다
    draft = { ...draft, minutes: '', title: '', date: '', feel: null, areaId: activeAreas(getState()).some((a) => a.id === entry.areaId) ? entry.areaId : null };
    addEntry(entry);
    savedAt = Date.now();
    savedToast(`${areaById(entry.areaId).label} ${fmtHM(minutes)} 기록했어요`);
  },
};
