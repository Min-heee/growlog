// 설정 화면: 활동 영역·주간 목표, 수면 목표, 테마, 백업
import { addArea, areaById, canAddArea, canRead, createDefaultState, freeColors, getState, isBackup, MAX_AREAS, normalize, removeArea, replaceState, resetState, setProfile, setSleepGoal, setTheme, updateArea } from '../store.js';
import { exportData } from '../backup.js';
import { buildSample } from '../sample.js';
import { installState, promptInstall } from '../pwa.js';
import { resetTodayDrafts } from './today.js';
import { resetTimer } from './timer.js';
import { clamp, esc, isNativeApp } from '../util.js';
import { areaColor, ask, colorChoices, fieldSavedToast, fieldToast, refresh, savedToast, toast } from '../ui.js';

const THEMES = [
  ['dark', '다크'],
  ['light', '라이트'],
  ['auto', '기기 설정'],
];

const ROLES = [
  ['worker', '일'],
  ['student', '공부'],
  ['other', '그 외'],
];
const AGES = [
  ['u18', '18세 미만'],
  ['adult', '18~64세'],
  ['senior', '65세 이상'],
];

const kindOptions = (kind) =>
  `<option value="load"${kind === 'load' ? ' selected' : ''}>부하</option><option value="recovery"${kind === 'recovery' ? ' selected' : ''}>회복</option>`;

let colorOpen = null; // 색을 고르는 중인 영역

function areaRow(a, state) {
  const id = esc(a.id);
  const name = esc(a.label);
  const colors = colorOpen === a.id ? `<div class="area-colors" id="colors-${id}">${colorChoices(a.color, freeColors(state, a.id), 'area-color', a.id)}</div>` : '';
  return `<div class="area-row">
    <input class="emoji-in" data-area-field="emoji" data-id="${id}" value="${esc(a.emoji)}" maxlength="8" aria-label="${name} 아이콘">
    <div class="name-in"><button type="button" class="dot-btn" data-action="area-color-open" data-id="${id}" aria-expanded="${colorOpen === a.id}"${colors ? ` aria-controls="colors-${id}"` : ''} aria-label="${name} 색 바꾸기"><span class="dot" style="background:${areaColor(a)}"></span></button><input data-area-field="label" data-id="${id}" value="${name}" maxlength="12" aria-label="영역 이름"></div>
    <label class="suffix-in"><input type="number" data-area-field="goal" data-id="${id}" min="0" max="10080" step="10" value="${a.goal}" aria-label="${name} 주간 목표"><span>분/주</span></label>
    <select data-area-field="kind" data-id="${id}" aria-label="${name} 계산 방식">${kindOptions(a.kind)}</select>
    <button type="button" class="btn small ghost" data-action="hide-area" data-id="${id}">숨기기</button>
    ${colors}
  </div>`;
}

function hiddenRow(a, state) {
  const count = state.entries.filter((e) => e.areaId === a.id).length;
  return `<div class="hidden-row">
    <span class="grow">${esc(a.emoji)} ${esc(a.label)} <small>기록 ${count}개</small></span>
    <button type="button" class="btn small" data-action="restore-area" data-id="${esc(a.id)}">되살리기</button>
    <button type="button" class="btn small danger" data-action="remove-area" data-id="${esc(a.id)}">삭제</button>
  </div>`;
}

// 입력 중인 내용은 화면을 다시 그려도 남아 있어야 한다
const EMPTY_DRAFT = { emoji: '', label: '', goal: '120', kind: 'recovery', color: null };
let draft = { ...EMPTY_DRAFT };

const addForm = (state) => {
  const free = freeColors(state);
  const color = free.includes(draft.color) ? draft.color : free[0];
  return `<form class="area-row add" data-form="add-area">
  <input class="emoji-in" name="emoji" maxlength="8" value="${esc(draft.emoji)}" placeholder="📖" aria-label="새 영역 아이콘">
  <div class="name-in"><input name="label" maxlength="12" value="${esc(draft.label)}" placeholder="새 영역 (예: 독서)" aria-label="새 영역 이름"></div>
  <label class="suffix-in"><input type="number" name="goal" min="0" max="10080" step="10" value="${esc(draft.goal)}" aria-label="새 영역 주간 목표"><span>분/주</span></label>
  <select name="kind" aria-label="새 영역 계산 방식">${kindOptions(draft.kind)}</select>
  <button type="submit" class="btn small primary">추가</button>
  <div class="area-colors">${colorChoices(color, free, 'draft-color')}</div>
</form>`;
};

function installBody() {
  const why = '홈 화면에 추가하면 주소창 없이 앱처럼 열리고, 인터넷이 없어도 쓸 수 있어요.';
  switch (installState()) {
    case 'installed':
      return '<p class="sub flush">앱으로 실행 중이에요. 인터넷이 없어도 열 수 있어요.</p>';
    case 'done':
      return '<p class="sub flush">설치했어요. 이제 홈 화면의 아이콘으로 열어보세요.</p>';
    case 'ready':
      return `<p class="sub">${why}</p><button type="button" class="btn primary" data-action="install">앱 설치하기</button>`;
    case 'ios':
      return `<p class="sub">${why}</p>
        <ol class="steps">
          <li>Safari에서 <b>공유</b> 버튼을 눌러요.</li>
          <li><b>홈 화면에 추가</b>를 골라요.</li>
          <li>오른쪽 위의 <b>추가</b>를 눌러요.</li>
        </ol>
        <p class="hint">Safari에만 둔 기록은 일주일쯤 열지 않으면 지워질 수 있어요. 또 Safari에서 남긴 기록은 설치한 앱으로 옮겨지지 않을 수 있으니, 먼저 아래 데이터 칸에서 내보내기를 해두세요.</p>`;
    default:
      return `<p class="sub flush">${why} 브라우저 메뉴에서 <b>앱 설치</b>나 <b>홈 화면에 추가</b>를 골라주세요.</p>`;
  }
}

function profileCard({ role, age, hide }) {
  const choice = (field, list, value) =>
    list.map(([v, label]) => `<button type="button" class="seg-btn" data-action="profile" data-field="${field}" data-value="${v}" aria-pressed="${value === v}">${label}</button>`).join('');
  return `<section class="card">
    <h2>나에게 맞추기</h2>
    <p class="sub">부하와 회복을 계산할 때 어떤 기본값에서 시작할지 정해요. 기록이 쌓이면 내 값으로 옮겨가요.</p>
    <div class="stack">
      <div><div class="scale-head"><span class="scale-label">주로 하는 일</span></div><div class="seg" role="group" aria-label="주로 하는 일">${choice('role', ROLES, role)}</div></div>
      <div><div class="scale-head"><span class="scale-label">나이</span></div><div class="seg" role="group" aria-label="나이">${choice('age', AGES, age)}</div></div>
      <div class="hidden-row">
        <span class="grow">쌓인 부하 추정 숨기기<small class="block">기록은 그대로 쌓이고, 추정만 안 보여요.</small></span>
        <button type="button" class="btn small" data-action="hide-estimate" aria-pressed="${hide}">${hide ? '다시 보기' : '숨기기'}</button>
      </div>
    </div>
  </section>`;
}

export const label = () => '설정';

export function render(state) {
  const active = state.areas.filter((a) => !a.archived);
  if (!active.some((a) => a.id === colorOpen)) colorOpen = null; // 숨기거나 지운 영역의 색 고르기는 닫는다
  const hidden = state.areas.filter((a) => a.archived);
  const themes = THEMES.map(([value, label]) => `<button type="button" class="seg-btn" data-action="theme" data-value="${value}" aria-pressed="${state.theme === value}">${label}</button>`).join('');
  const limit = `<p class="hint">영역은 최대 ${MAX_AREAS}개까지 만들 수 있어요.${hidden.length ? ' 숨긴 영역을 삭제하면 자리가 생겨요.' : ''}</p>`;
  return `
    <header class="page-head">
      <h1>목표와 데이터</h1>
    </header>
    <section class="card">
      <h2>앱으로 쓰기</h2>
      ${installBody()}
    </section>
    <section class="card">
      <h2>활동 영역과 주간 목표</h2>
      <p class="sub"><b>부하</b>는 공부·일처럼 에너지를 쓰는 활동, <b>회복</b>은 운동·산책처럼 에너지를 채우는 활동이에요. 부하와 회복을 계산할 때 쓰여요.</p>
      ${active.map((a) => areaRow(a, state)).join('')}
      ${canAddArea(state) ? addForm(state) : limit}
      ${hidden.length ? `<h3 class="mini-title">숨긴 영역</h3>${hidden.map((a) => hiddenRow(a, state)).join('')}` : ''}
    </section>
    ${profileCard(state.profile)}
    <section class="card">
      <h2>수면 목표</h2>
      <p class="sub">수면 차트의 기준이에요. 권장량보다 높게 잡으면 필요한 수면의 시작값도 함께 올라가요.</p>
      <label class="suffix-in narrow"><input type="number" data-sleep-goal min="4" max="12" step="0.5" value="${state.sleepGoal}" aria-label="하루 수면 목표"><span>시간/일</span></label>
    </section>
    <section class="card">
      <h2>화면 테마</h2>
      <p class="sub">기기 설정을 고르면 기기의 라이트·다크를 따라가요.</p>
      <div class="seg" role="group" aria-label="테마">${themes}</div>
    </section>
    <section class="card">
      <h2>데이터</h2>
      <p class="sub">${isNativeApp() ? '모든 기록은 이 아이폰에만 저장돼요. 앱을 지우면 기록도 함께 지워지니, 앱을 지우거나 기기를 바꾸기 전에 내보내기로 백업해두세요.' : '모든 기록은 이 브라우저에만 저장돼요. 브라우저 데이터를 지우거나 기기를 바꾸기 전에 내보내기로 백업해두세요.'}</p>
      <div class="btn-row data-actions">
        <button type="button" class="btn" data-action="export">내보내기</button>
        <label class="btn" for="import-file" role="button" tabindex="0" data-action="import">가져오기</label>
        <button type="button" class="btn" data-action="sample">샘플 데이터 넣기</button>
        <button type="button" class="btn danger" data-action="reset">모두 지우기</button>
      </div>
    </section>`;
}

// 파일을 고르는 사이에 화면을 다시 그려도 사라지지 않도록 화면 바깥에 둔다
const picker = Object.assign(document.createElement('input'), { id: 'import-file', type: 'file', accept: 'application/json,.json', hidden: true });
picker.dataset.import = '';
picker.addEventListener('change', importData);
document.body.append(picker);

const UNREADABLE = '저장된 기록을 읽지 못하고 있어요. 앱을 다시 연 뒤에 해주세요.';

async function importData() {
  const file = picker.files?.[0];
  if (!file) return;
  picker.value = '';
  if (!canRead()) return toast(UNREADABLE);
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    data = null;
  }
  // 덮어쓰기 전에 파일부터 검증한다. 틀린 파일이면 지금 기록은 그대로 둔다.
  if (!isBackup(data)) return toast('그로우로그 백업 파일이 아니에요');
  const skipped = data.entries.length - normalize(data).entries.length;
  const note = skipped ? ` 형식이 잘못된 기록 ${skipped}개는 빼고 불러와요.` : '';
  if (!(await ask(`백업 파일로 지금 데이터를 덮어쓸까요?${note}`, '덮어쓰기'))) return;
  const before = getState();
  resetTodayDrafts();
  replaceState(data);
  savedToast('백업을 불러왔어요', { label: '되돌리기', onClick: () => replaceState(before) });
}

function hasUserData() {
  const s = getState();
  const base = createDefaultState();
  return s.entries.length > 0 || Object.keys(s.checkins).length > 0 || Object.keys(s.sleep).length > 0 || s.marks.length > 0 || Object.keys(s.weekly).length > 0 || s.sleepGoal !== base.sleepGoal || JSON.stringify(s.areas) !== JSON.stringify(base.areas);
}

async function loadSample() {
  if (hasUserData() && !(await ask('지금 기록과 영역 설정을 샘플 데이터로 바꿀까요? 기존 내용은 사라져요.', '바꾸기'))) return;
  resetTodayDrafts();
  replaceState({ ...buildSample(), theme: getState().theme });
  savedToast('14주치 샘플 데이터를 넣었어요');
  location.hash = '#/today';
}

/** 입력칸의 값을 저장할 형태로 바꾼다. 이름이 비어 있으면 null */
function areaFieldValue(el, field) {
  const value = el.value.trim();
  if (field === 'goal') return clamp(Math.round(Number(value) || 0), 0, 10080);
  if (field === 'emoji') return value || '✨';
  if (field === 'label') return value || null;
  return value;
}

export const on = {
  async click(e) {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const { action, id, value } = button.dataset;
    if (['remove-area', 'sample', 'reset'].includes(action) && !canRead()) return toast(UNREADABLE);
    if (action === 'area-color-open') {
      colorOpen = colorOpen === id ? null : id;
      refresh();
    } else if (action === 'area-color') {
      colorOpen = null;
      updateArea(id, { color: Number(value) });
      document.querySelector(`[data-action="area-color-open"][data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    } else if (action === 'draft-color') {
      draft.color = Number(value);
      refresh();
    } else if (action === 'hide-area') {
      updateArea(id, { archived: true });
      savedToast('영역을 숨겼어요. 기록은 그대로 남아요.');
    } else if (action === 'restore-area') updateArea(id, { archived: false });
    else if (action === 'remove-area') {
      const area = areaById(id);
      if (!area) return refresh(); // 진짜 기록을 다시 불러오니 없는 영역이었다
      const count = getState().entries.filter((x) => x.areaId === id).length;
      if (await ask(`'${area.label}' 영역과 기록 ${count}개를 삭제할까요? 되돌릴 수 없어요.`, '삭제')) {
        removeArea(id);
        savedToast('삭제했어요');
      }
    } else if (action === 'theme') setTheme(value);
    else if (action === 'profile') setProfile({ [button.dataset.field]: value });
    else if (action === 'hide-estimate') setProfile({ hide: !getState().profile.hide });
    else if (action === 'install') {
      if (await promptInstall()) toast('설치했어요. 홈 화면에서 열어보세요.');
    } else if (action === 'export') exportData();
    else if (action === 'sample') loadSample();
    else if (action === 'reset' && (await ask('모든 기록과 설정을 지울까요? 되돌릴 수 없어요.', '모두 지우기'))) {
      resetTimer();
      resetTodayDrafts();
      resetState();
      savedToast('모두 지웠어요');
    }
  },
  // 라벨은 키보드로 눌리지 않으니 파일 고르는 창을 직접 연다
  keydown(e) {
    if (e.target.dataset.action === 'import' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      picker.click();
    }
  },
  // 타이머가 끝나 화면을 다시 그리거나 앱을 벗어나도 고치던 내용이 남도록 글자마다 저장한다
  input(e) {
    const el = e.target;
    const field = el.dataset.areaField;
    if (el.form?.dataset.form === 'add-area') draft[el.name] = el.value;
    else if (field && field !== 'kind' && areaFieldValue(el, field) !== null) updateArea(el.dataset.id, { [field]: areaFieldValue(el, field) }, { quiet: true });
  },
  change(e) {
    const el = e.target;
    const field = el.dataset.areaField;
    // 입력칸을 고치는 동안 포커스가 날아가지 않도록 화면을 다시 그리지 않고 저장만 한다
    if (field) {
      const value = areaFieldValue(el, field);
      if (value === null) {
        // 글자마다 저장하므로 저장된 이름은 지우다 남은 글자다. 고치기 전 이름으로 되돌린다.
        el.value = el.defaultValue;
        updateArea(el.dataset.id, { label: el.defaultValue }, { quiet: true });
        fieldToast('이름은 비워둘 수 없어요');
        return;
      }
      updateArea(el.dataset.id, { [field]: value }, { quiet: true });
      el.value = value;
      el.defaultValue = value;
      fieldSavedToast('저장했어요');
    } else if ('sleepGoal' in el.dataset) {
      const hours = clamp(Number(el.value) || 7, 4, 12);
      setSleepGoal(hours, { quiet: true });
      el.value = hours;
      fieldSavedToast('저장했어요');
    }
  },
  submit(e) {
    e.preventDefault();
    const { emoji, label, goal, kind } = e.target.elements;
    const name = label.value.trim();
    if (!name) {
      document.activeElement?.blur(); // 키보드에 가려지지 않도록
      return toast('영역 이름을 입력해주세요');
    }
    const area = { label: name, emoji: emoji.value.trim() || '✨', goal: clamp(Math.round(Number(goal.value) || 0), 0, 10080), kind: kind.value, color: draft.color };
    draft = { ...EMPTY_DRAFT };
    if (addArea(area)) savedToast(`'${name}' 영역을 추가했어요`);
    else {
      refresh();
      toast(`영역은 최대 ${MAX_AREAS}개까지 만들 수 있어요`);
    }
  },
};
