// 설정 화면: 활동 영역·주간 목표, 수면 목표, 테마, 백업
import { addArea, areaById, canAddArea, getState, isBackup, MAX_AREAS, removeArea, replaceState, resetState, setSleepGoal, setTheme, updateArea } from '../store.js';
import { buildSample } from '../sample.js';
import { todayKey } from '../dates.js';
import { installState, promptInstall } from '../pwa.js';
import { clamp, esc } from '../util.js';
import { areaColor, ask, toast } from '../ui.js';

const THEMES = [
  ['system', '시스템'],
  ['light', '라이트'],
  ['dark', '다크'],
];

const kindOptions = (kind) =>
  `<option value="load"${kind === 'load' ? ' selected' : ''}>부하</option><option value="recovery"${kind === 'recovery' ? ' selected' : ''}>회복</option>`;

function areaRow(a) {
  const id = esc(a.id);
  const name = esc(a.label);
  return `<div class="area-row">
    <input class="emoji-in" data-area-field="emoji" data-id="${id}" value="${esc(a.emoji)}" maxlength="8" aria-label="${name} 아이콘">
    <div class="name-in"><span class="dot" style="background:${areaColor(a)}"></span><input data-area-field="label" data-id="${id}" value="${name}" maxlength="12" aria-label="영역 이름"></div>
    <label class="suffix-in"><input type="number" data-area-field="goal" data-id="${id}" min="0" max="10080" step="10" value="${a.goal}" aria-label="${name} 주간 목표"><span>분/주</span></label>
    <select data-area-field="kind" data-id="${id}" aria-label="${name} 계산 방식">${kindOptions(a.kind)}</select>
    <button type="button" class="btn small ghost" data-action="hide-area" data-id="${id}">숨기기</button>
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

const addForm = () => `<form class="area-row add" data-form="add-area">
  <input class="emoji-in" name="emoji" maxlength="8" placeholder="📖" aria-label="새 영역 아이콘">
  <div class="name-in"><input name="label" maxlength="12" placeholder="새 영역 (예: 독서)" aria-label="새 영역 이름"></div>
  <label class="suffix-in"><input type="number" name="goal" min="0" max="10080" step="10" value="120" aria-label="새 영역 주간 목표"><span>분/주</span></label>
  <select name="kind" aria-label="새 영역 계산 방식">${kindOptions('recovery')}</select>
  <button type="submit" class="btn small primary">추가</button>
</form>`;

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
        <p class="hint">Safari에서 남긴 기록은 설치한 앱으로 옮겨지지 않을 수 있어요. 필요하면 먼저 아래 데이터 칸에서 내보내기를 해두세요.</p>`;
    default:
      return `<p class="sub flush">${why} 브라우저 메뉴에서 <b>앱 설치</b>나 <b>홈 화면에 추가</b>를 골라주세요.</p>`;
  }
}

export function render(state) {
  const active = state.areas.filter((a) => !a.archived);
  const hidden = state.areas.filter((a) => a.archived);
  const themes = THEMES.map(([value, label]) => `<button type="button" class="seg-btn" data-action="theme" data-value="${value}" aria-pressed="${state.theme === value}">${label}</button>`).join('');
  const limit = `<p class="hint">영역은 최대 ${MAX_AREAS}개까지 만들 수 있어요.${hidden.length ? ' 숨긴 영역을 삭제하면 자리가 생겨요.' : ''}</p>`;
  return `
    <header class="page-head">
      <p class="eyebrow">설정</p>
      <h1>목표와 데이터</h1>
    </header>
    <section class="card">
      <h2>앱으로 쓰기</h2>
      ${installBody()}
    </section>
    <section class="card">
      <h2>활동 영역과 주간 목표</h2>
      <p class="sub"><b>부하</b>는 공부·일처럼 에너지를 쓰는 활동, <b>회복</b>은 운동·산책처럼 에너지를 채우는 활동이에요. 번아웃 지수를 계산할 때 쓰여요.</p>
      ${active.map(areaRow).join('')}
      ${canAddArea(state) ? addForm() : limit}
      ${hidden.length ? `<h3 class="mini-title">숨긴 영역</h3>${hidden.map((a) => hiddenRow(a, state)).join('')}` : ''}
    </section>
    <section class="card">
      <h2>수면 목표</h2>
      <p class="sub">번아웃 지수와 수면 차트의 기준이에요.</p>
      <label class="suffix-in narrow"><input type="number" data-sleep-goal min="4" max="12" step="0.5" value="${state.sleepGoal}" aria-label="하루 수면 목표"><span>시간/일</span></label>
    </section>
    <section class="card">
      <h2>화면 테마</h2>
      <p class="sub">시스템을 고르면 기기 설정을 따라가요.</p>
      <div class="seg" role="group" aria-label="테마">${themes}</div>
    </section>
    <section class="card">
      <h2>데이터</h2>
      <p class="sub">모든 기록은 이 브라우저에만 저장돼요. 브라우저 데이터를 지우거나 기기를 바꾸기 전에 내보내기로 백업해두세요.</p>
      <div class="btn-row">
        <button type="button" class="btn" data-action="export">내보내기</button>
        <label class="btn">가져오기<input type="file" accept="application/json,.json" data-import hidden></label>
        <button type="button" class="btn" data-action="sample">샘플 데이터 넣기</button>
        <button type="button" class="btn danger" data-action="reset">모두 지우기</button>
      </div>
    </section>`;
}

async function exportData() {
  const file = new File([JSON.stringify(getState(), null, 2)], `growlog-backup-${todayKey()}.json`, { type: 'application/json' });
  // 폰에서는 공유 창을 띄워 파일 앱이나 메신저로 바로 보낼 수 있게 한다
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '그로우로그 백업' });
      toast('백업 파일을 보냈어요');
    } catch (err) {
      if (err.name !== 'AbortError') toast('공유하지 못했어요. 다시 시도해주세요.');
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('백업 파일을 내려받았어요');
}

async function importData(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!isBackup(data)) throw new Error('not a backup');
    if (await ask('백업 파일로 지금 데이터를 덮어쓸까요?', '덮어쓰기')) {
      replaceState(data);
      toast('백업을 불러왔어요');
    }
  } catch {
    toast('그로우로그 백업 파일이 아니에요');
  }
  input.value = '';
}

async function loadSample() {
  const { entries, checkins, sleep } = getState();
  const hasData = entries.length || Object.keys(checkins).length || Object.keys(sleep).length;
  if (hasData && !(await ask('지금 기록을 샘플 데이터로 바꿀까요? 기존 기록은 사라져요.', '바꾸기'))) return;
  replaceState(buildSample());
  toast('4주치 샘플 데이터를 넣었어요');
  location.hash = '#/today';
}

export const on = {
  async click(e) {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const { action, id, value } = button.dataset;
    if (action === 'hide-area') {
      updateArea(id, { archived: true });
      toast('영역을 숨겼어요. 기록은 그대로 남아요.');
    } else if (action === 'restore-area') updateArea(id, { archived: false });
    else if (action === 'remove-area') {
      const area = areaById(id);
      const count = getState().entries.filter((x) => x.areaId === id).length;
      if (await ask(`'${area.label}' 영역과 기록 ${count}개를 삭제할까요? 되돌릴 수 없어요.`, '삭제')) {
        removeArea(id);
        toast('삭제했어요');
      }
    } else if (action === 'theme') setTheme(value);
    else if (action === 'install') {
      if (await promptInstall()) toast('설치했어요. 홈 화면에서 열어보세요.');
    } else if (action === 'export') exportData();
    else if (action === 'sample') loadSample();
    else if (action === 'reset' && (await ask('모든 기록과 설정을 지울까요? 되돌릴 수 없어요.', '모두 지우기'))) {
      resetState();
      toast('모두 지웠어요');
    }
  },
  change(e) {
    const el = e.target;
    const field = el.dataset.areaField;
    // 입력칸을 고치는 동안 포커스가 날아가지 않도록 화면을 다시 그리지 않고 저장만 한다
    if (field) {
      const area = areaById(el.dataset.id);
      let value = el.value.trim();
      if (field === 'goal') value = Math.max(0, Math.round(Number(value) || 0));
      if (field === 'emoji' && !value) value = '✨';
      if (field === 'label' && !value) {
        el.value = area.label;
        toast('이름은 비워둘 수 없어요');
        return;
      }
      updateArea(el.dataset.id, { [field]: value }, { quiet: true });
      el.value = value;
      toast('저장했어요');
    } else if ('sleepGoal' in el.dataset) {
      const hours = clamp(Number(el.value) || 7, 4, 12);
      setSleepGoal(hours, { quiet: true });
      el.value = hours;
      toast('저장했어요');
    } else if ('import' in el.dataset) importData(el);
  },
  submit(e) {
    e.preventDefault();
    const { emoji, label, goal, kind } = e.target.elements;
    const name = label.value.trim();
    if (!name) return toast('영역 이름을 입력해주세요');
    addArea({ label: name, emoji: emoji.value.trim() || '✨', goal: Math.max(0, Math.round(Number(goal.value) || 0)), kind: kind.value });
    toast(`'${name}' 영역을 추가했어요`);
  },
};
