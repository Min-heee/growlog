// 회복 화면: 내 평소와 비교한 부하, 지친 날 기록, 이번 주 돌아보기, 계산 근거
import { addMark, addRebase, BAT_ITEMS, closeMarks, deleteMarks, getState, MARK_TAGS, reopenMarks, restoreMarks, setMonthly, setSupportSeen, setWeekly } from '../store.js';
import { addDays, fmtDay, fmtMonthDay, rangeKeys, sleepHours, todayKey, weekStartKey } from '../dates.js';
import { BANDS, bandWord, insight, MILESTONES, SEVERITY } from '../insight.js';
import { K } from '../strain.js';
import { answered, change, editUntil, isComplete, LINES, PARTS, status } from '../bat.js';
import { ANCHORS, INTRO, ITEMS, READY } from '../bat-items.js';
import { zoneChart } from '../charts.js';
import { esc, fmt1, fmtHM, fmtHours, josa } from '../util.js';
import { ask, ratingScale, refresh, savedToast, tickBar, toast } from '../ui.js';

const HEADER = '<header class="page-head"><h1>부하와 회복</h1></header>';
const CLAIM = '기록하신 내용을 바탕으로, 최근의 부하·수면·회복이 내 평소와 얼마나 다른지 요약해요. 번아웃이나 건강 상태를 판단하지 않아요.';
const HIDDEN_CLAIM = '기록은 그대로 쌓이고 추정만 숨겼어요. 번아웃이나 건강 상태를 판단하지 않아요.';
// 한 달 체크를 하는 분에게는 설문 결과도 진단이 아니라고 함께 말한다
const BAT_CLAIM = '기록하신 내용을 바탕으로, 최근의 부하·수면·회복이 내 평소와 얼마나 다른지 요약해요. 한 달 체크는 설문 답을 유럽 연구의 두 선과 견주어 보여줘요. 둘 다 번아웃이나 건강 상태를 진단하지 않아요.';
const BAT_HIDDEN_CLAIM = '기록은 그대로 쌓이고 추정만 숨겼어요. 한 달 체크를 포함해 번아웃이나 건강 상태를 진단하지 않아요.';
const OLDEST_MARK = 90; // 지난 일도 떠올려 남길 수 있게 3개월까지 받는다
const FUZZ = [
  [0, '정확해요'],
  [3, '3일쯤 전후'],
  [7, '일주일쯤 전후'],
];
const WORK_WORD = { worker: '일', student: '공부', other: '할 일' };
const BAND_NOTE = {
  usual: '최근 기록이 내 평소와 비슷해요. 괜찮다는 판정은 아니에요.',
  higher: '최근 기록이 내 평소보다 높은 쪽에 있어요.',
  sustained: '며칠째 내 평소보다 높은 쪽에 있어요.',
  restart: '며칠 더 기록하면 다시 비교할 수 있어요. 회복했다는 뜻은 아니에요.',
};

const CLOSED_FORM = { open: false, date: '', closedOn: '', fuzz: 0, sev: null, tag: null };
let form = { ...CLOSED_FORM };
let chart = null; // 차트를 다시 그릴 때 쓰는 데이터
let batOpen = false; // 한 달 체크 문항을 펼쳐 두었는지

/** 화면에 들어올 때마다 한 달 체크 문항은 접어 둔다. 23문항이 길게 펼쳐진 채로 다시 보이지 않게 한다 */
export function enter() {
  batOpen = false;
}

/** 오늘 화면에서 '지친 날로 표시'를 눌렀을 때 표시 칸을 열어둔다 */
export function openMarkForm(date) {
  form = { ...CLOSED_FORM, open: true, date: date || '' };
}

const LONG_WORD = 13; // 이보다 긴 말은 큰 글씨로 쓰면 네 줄을 넘는다
const nextMilestone = (n) => MILESTONES.find((m) => n < m) ?? MILESTONES.at(-1);

function buildingText(n) {
  if (n < 7) return `기록 ${n}/7. 아직 내 평소를 알 만큼 쌓이지 않았어요.`;
  if (n < 14) return `기록 ${n}일. 잠정 평소를 만들었어요. 첫 기록은 평소보다 높게 나올 수 있어요.`;
  return `기록 ${n}일. 2주 요약을 볼 수 있어요. 28일이 되면 추세를 보여드려요.`;
}

function noUsualNote(i) {
  if (i.episodes.some((e) => e.open)) return '회복 중인 날이 많아서 아직 비교할 평소가 없어요. 회복 중 표시를 닫으면 평소를 잡기 시작해요.';
  return '회복 중이던 날이 많아서 아직 비교할 평소가 없어요. 며칠 더 기록하면 평소를 잡기 시작해요.';
}

function hero(i) {
  const card = (title, note, more = '') => `<header class="hero">
    <h1 class="hero-word mid${title.length > LONG_WORD ? ' long' : ''}">${title}</h1>
    <p class="hero-note">${note}</p>
    ${more}
  </header>`;
  switch (i.status) {
    case 'empty':
      if (i.savedDays) return card('컨디션 기록이 아직 없어요', `기록 ${i.savedDays}일은 저장돼 있어요. 오늘의 컨디션을 두 가지 이상 남기면 내 평소와 비교할 수 있어요.`);
      return card('기록을 시작해볼까요', '오늘의 컨디션을 남기면 내 평소를 알아가기 시작해요. 7일, 14일, 28일마다 보이는 내용이 늘어나요.');
    case 'unknown':
      return card('최근 컨디션 기록이 없어서 지금은 알 수 없어요', `마지막 컨디션 기록은 ${i.gap}일 전이에요. 오늘 화면에서 3일 전까지 채울 수 있어요.`);
    case 'restart':
      return card('다시 시작해요', `쉬었던 동안 어땠는지는 알 수 없어서, 쌓인 부하를 처음부터 다시 쌓아요.${i.entries >= 7 && !i.noUsual ? ' 내 평소는 그대로 남아 있어요.' : ''}`);
    case 'noUsual':
      return card(BANDS.building, noUsualNote(i));
    case 'building': {
      const goal = nextMilestone(i.entries);
      return card(BANDS.building, buildingText(i.entries), `${tickBar(i.entries / goal, 52, 'milestone')}
        <p class="hint strip-hint">다음 단계까지 기록 ${goal - i.entries}일</p>`);
    }
    default:
      return card(bandWord(i), i.sleepOnly ? '수면이 필요한 양보다 적은 날이 이어져서 높게 나왔어요. 다른 기록은 내 평소와 비슷해요.' : BAND_NOTE[i.band]);
  }
}

function readouts(i) {
  if (!i.entries) return '';
  return `<div class="readouts">
    <span>기록 <b>${i.entries}일</b></span>
    <span>표시한 때 <b>${i.episodes.length}번</b></span>
    <span>최근 14일 중 힘든 날 <b>${i.recent.hard}일</b></span>
  </div>`;
}

function flagCard(i) {
  if (!i.flag) return '';
  return `<section class="card">
    <h2>요즘 이렇게 기록됐어요</h2>
    <p class="lead flush">${esc(i.flag.text)}</p>
    <p class="suggest">${esc(i.flag.idea)}</p>
    <p class="hint">기록을 요약한 것이며, 앞으로 일어날 일을 말해주지 않아요.</p>
  </section>`;
}

function supportCard(i) {
  if (!i.support) return '';
  return `<section class="card support">
    <p class="lead flush">${esc(i.support.text)}</p>
    <div class="btn-row">
      <a class="btn small primary" href="#/help">도움받을 곳 보기</a>
      <button type="button" class="btn small" data-action="support-close">닫기</button>
    </div>
  </section>`;
}

function newNormalCard(i) {
  if (!i.newNormal) return '';
  return `<section class="card">
    <h2>요즘이 내 새로운 평소인가요?</h2>
    <p class="sub">이 상태가 오래 이어졌어요. 그렇다면 내일부터 평소를 새로 계산할게요. 아니라면 지금 기준을 그대로 둘게요.</p>
    <button type="button" class="btn small" data-action="rebase">네, 새로 계산해요</button>
  </section>`;
}

function helpedCard(i) {
  if (!i.helped.length) return '';
  return `<section class="card">
    <h2>최근 7일, 쉬어가는 데 도움이 된 것</h2>
    <div class="chips static">${i.helped.map((text) => `<span class="fact">${esc(text)}</span>`).join('')}</div>
  </section>`;
}

function notesCard(i) {
  if (!i.notes.length) return '';
  return `<section class="card">
    <h2>기록에서 보인 것</h2>
    <ul class="advice">${i.notes.map((text) => `<li><span>${esc(text)}</span></li>`).join('')}</ul>
  </section>`;
}

const NO_RATING = { few: '컨디션 기록이 적어요', other: '컨디션 기록 없음' };
const noRating = (p) => NO_RATING[p.saved] ?? '기록 없음';

/** 묶인 표시도 하나하나 보이도록 표시한 날을 모두 꺼낸다 */
const markedDays = (i) => new Set(i.episodes.flatMap((e) => e.dates));

function trendRows(i) {
  const marked = markedDays(i);
  return [...i.trend]
    .reverse()
    .filter((p) => p.band || marked.has(p.key))
    .map((p) => `<tr><td>${marked.has(p.key) ? '○ ' : ''}${esc(fmtDay(p.key))}</td><td>${esc(p.band ? BANDS[p.band] : noRating(p))}</td><td>${p.hardWindow ? `${p.hardCount}/${p.hardWindow}일` : '–'}</td></tr>`)
    .join('');
}

function trendCard(i) {
  if (i.entries < K.TREND_MIN || i.noUsual) return '';
  return `<section class="trend-block" aria-label="최근 60일 쌓인 부하">
    <div class="chart bleed" data-chart="trend"></div>
    <p class="hint strip-hint">최근 60일이에요. 띠는 내 평소 범위, 동그라미는 표시한 날이에요. 점수가 아니라 내 평소와의 차이를 그린 그림이에요.</p>
    <details class="table-view"><summary>표로 보기</summary><div class="table-wrap"><table><thead><tr><th>날짜</th><th>상태</th><th>최근 14일 힘든 날</th></tr></thead><tbody>${trendRows(i)}</tbody></table></div></details>
  </section>`;
}

function usualRow(label, value, range) {
  return `<div class="usual-row"><span>${label}</span><strong>${value}</strong><span class="hint">${range || ''}</span></div>`;
}

function usualCard(i) {
  if (i.entries < 7) return '';
  const tentative = i.entries < 14;
  const rating = (r) => (r ? [`${r.mid}`, tentative ? '' : `대체로 ${r.lo}~${r.hi}`] : ['–', '']);
  let about = i.guarded ? '최근 2주와, 회복 중이거나 한동안 높았던 날을 뺀 기록의 가운데 값이에요.' : '지금까지 기록의 가운데 값이에요. 기록이 더 쌓이면 최근 2주는 빼고 계산해요.';
  if (tentative) about = '아직 며칠 안 되는 기록이라 바뀔 수 있어요.';
  if (i.rebuilding) about = '평소를 새로 잡는 중이에요. 그동안은 그 전 평소를 보여드려요.';
  if (i.status === 'noUsual' || (i.noUsual && !tentative)) about = '아직 비교할 평소가 없어서 지금까지의 기록을 보여드려요.';
  const debt = i.debt == null ? '' : `수면 부족 누적 ${fmtHours(i.debt)}. `;
  return `<section class="card">
    <h2>${tentative ? '잠정 평소' : '내 평소'}</h2>
    <p class="sub">${about}</p>
    ${usualRow('에너지', ...rating(i.usual.energy))}
    ${usualRow('스트레스', ...rating(i.usual.stress))}
    ${usualRow('기분', ...rating(i.usual.mood))}
    ${usualRow('수면', i.usual.sleep == null ? '–' : fmtHours(i.usual.sleep))}
    ${usualRow('하루 부하', i.usual.load == null ? '–' : fmtHM(i.usual.load))}
    ${i.entries >= 14 ? `<p class="hint strip-hint">${debt}최근 14일 중 ${i.recent.logged}일 기록했고, 힘든 날은 ${i.recent.hard}일이에요.</p>` : ''}
  </section>`;
}

const percent = (x) => Math.round(x * 100);

function personalCard(i, profile) {
  if (i.entries < 3) return '';
  const p = i.personal;
  const own = percent(p.own);
  let line = `아직 기본값이에요. 기록으로 확인된 표시가 ${p.gate}번 쌓이면 내 기록으로 옮겨가요. 지금 ${fmt1(p.nEff)}번이에요. '${SEVERITY[1]}'는 0.5번으로 세요.`;
  if (p.eventOwn) line = `내 기록 ${percent(p.eventOwn)}%, 기본값 ${100 - percent(p.eventOwn)}%로 정했어요.${p.line < 0 ? ' 기본값보다 이 말이 일찍 나와요.' : p.line > 0 ? ' 기본값보다 이 말이 늦게 나와요.' : ''}`;
  else if (p.quiet && p.line > 0) line = '표시 없이 지나간 때가 있어서, 이 말이 기본값보다 조금 늦게 나와요.';
  return `<section class="card">
    <h2>내 기록이 얼마나 반영됐나요</h2>
    <p class="sub">처음에는 기본값으로 시작하고, 기록이 쌓일수록 내 값으로 옮겨가요. 기본값의 근거는 아래 계산 방법에 있어요.</p>
    <div class="goal">
      <div class="goal-head"><span class="goal-name">내 평소</span><span class="goal-val"><strong>내 기록 ${own}%</strong></span></div>
      ${tickBar(p.own)}
    </div>
    <p class="mini-advice"><b>'한동안 평소보다 높아요' 기준.</b> ${esc(line)}</p>
    <p class="mini-advice"><b>필요한 수면.</b> ${p.showNeed ? `내 기록으로는 ${esc(fmtHours(p.need))}이에요.` : `기본값 ${esc(fmtHours(p.need0))}이에요. 잠과 컨디션 기록이 쌓이면 내 기록을 반영해요.`}</p>
    ${profile.role === 'other' ? `<p class="hint strip-hint">일하는 분이나 학생, 18세 미만이라면 <a href="#/settings">나에게 맞추기</a>에서 알려주세요. 필요한 수면과 안내가 달라져요.${READY && profile.age !== 'u18' ? ' 일하는 분은 한 달 체크도 할 수 있어요.' : ''}</p>` : ''}
  </section>`;
}

function markForm(today) {
  if (!form.open) return '';
  const fuzz = FUZZ.map(([value, label]) => `<button type="button" class="seg-btn" data-action="mark-fuzz" data-value="${value}" aria-pressed="${form.fuzz === value}">${label}</button>`).join('');
  const severity = [1, 2, 3].map((sev) => `<button type="button" class="option" data-action="mark-sev" data-value="${sev}" aria-pressed="${form.sev === sev}">${SEVERITY[sev]}</button>`).join('');
  const tags = MARK_TAGS.map((tag) => `<button type="button" class="chip small" data-action="mark-tag" data-value="${tag}" aria-pressed="${form.tag === tag}">${tag}</button>`).join('');
  form.shown = today;
  const past = (form.date || today) < today;
  return `<div class="stack mark-form" tabindex="-1">
    <label class="field"><span>언제였나요</span><input type="date" data-mark-date min="${addDays(today, -OLDEST_MARK)}" max="${today}" value="${esc(form.date || today)}"></label>
    <label class="field" data-mark-after ${past ? '' : 'hidden'}><span>언제 괜찮아졌나요 (아직이면 비워두세요)</span><input type="date" data-mark-closed min="${esc(form.date || today)}" max="${today}" value="${esc(form.closedOn)}"></label>
    <div class="seg" role="group" aria-label="날짜가 얼마나 정확한가요">${fuzz}</div>
    <div class="options" role="group" aria-label="어느 정도였나요">${severity}</div>
    <div class="chips" role="group" aria-label="무엇 때문이었나요 (선택)">${tags}</div>
    <div class="btn-row">
      <button type="button" class="btn primary grow" data-action="mark-save">남기기</button>
      <button type="button" class="btn" data-action="mark-cancel">닫기</button>
    </div>
  </div>`;
}

function episodeFacts(e, theta, hide) {
  const fact = (name, value) => `<div><span>${name}</span><b>${value}</b></div>`;
  const facts = e.logged >= 3 ? [fact('그 전 2주 중', `${e.logged}<small>일 기록</small>`), fact('힘든 날', `${e.hardDays}<small>일</small>`)] : [];
  if (e.debtH != null && !hide) facts.push(fact('수면 부족 누적', `${fmt1(e.debtH)}<small>시간</small>`));
  if (e.loadHoursPerWeek != null) facts.push(fact('부하', `<small>주 </small>${Math.round(e.loadHoursPerWeek)}<small>시간</small>`));
  if (!facts.length) return '<p class="hint">그 전 기록이 적어서 비교하지 못했어요.</p>';
  let level = e.logged < 3 ? '컨디션 기록이 적어서 힘든 날은 세지 못했어요' : '';
  if (hide) level = '';
  else if (e.level != null && !e.visible) level = '기록상 잘 보이지 않았어요';
  else if (e.level != null) level = e.level >= theta ? '쌓인 부하는 평소보다 꽤 높았어요' : '쌓인 부하는 평소보다 조금 높았어요';
  return `<div class="fact-grid">${facts.join('')}</div>${level ? `<p class="hint">${level}</p>` : ''}`;
}

function episodeRow(e, theta, hide) {
  const when = e.from === e.to ? fmtDay(e.from) : `${fmtDay(e.from)} ~ ${fmtDay(e.to)}`;
  const about = e.ids.length ? SEVERITY[e.sev] : '돌아보기에서 많이 쌓였다고 답한 주';
  const fuzzy = e.fuzz ? ` (${e.fuzz}일쯤 전후)` : '';
  const buttons = [];
  if (e.open) buttons.push(`<button type="button" class="btn primary block" data-action="mark-close" data-id="${esc(e.ids.join(','))}">이제 괜찮아졌어요</button>`);
  buttons.push(`<button type="button" class="btn small ghost" data-action="mark-delete" data-id="${esc(e.ids.join(','))}" data-weeks="${esc(e.weeks.join(','))}">지우기</button>`);
  return `<div class="episode">
    <div class="episode-head"><strong>${esc(when)}${fuzzy}</strong>${e.open ? '<span class="pill-on">회복 중</span>' : ''}</div>
    <p class="episode-sev">${esc(about)}${e.tags.length ? ` · ${esc(e.tags.join(', '))}` : ''}</p>
    ${episodeFacts(e, theta, hide)}
    ${buttons.length ? `<div class="btn-row">${buttons.join('')}</div>` : ''}
  </div>`;
}

function overlayLine(o) {
  const range = ({ lo, hi }, unit, round = Math.round) => (round(lo) === round(hi) ? `${round(lo)}${unit}` : `${round(lo)}~${round(hi)}${unit}`);
  const parts = [`힘든 날 ${range(o.hard, '일')}`];
  if (o.debt) parts.push(`수면 부족 누적 ${range(o.debt, '시간')}`);
  if (o.load) parts.push(`주 ${range(o.load, '시간')} 부하`);
  return `비교할 수 있는 표시 ${o.count}번을 보면, 그 전 2주 동안 ${parts.join(', ')}${josa(parts.at(-1), '이었어요', '였어요')}. ${o.count}번뿐이라 규칙이라고 말할 수 없어요.`;
}

function marksCard(i, today, hide) {
  return `<section class="card marks-card">
    <div class="card-head"><h2>지친 날</h2>${form.open ? '' : '<button type="button" class="btn small outline" data-action="mark-open">지친 날로 표시</button>'}</div>
    <p class="sub">남겨두면 그때까지 무엇이 얼마나 쌓였는지 볼 수 있어요. 번아웃처럼 느껴진 날도 여기에 표시해 주세요. 지난 날도 괜찮아요.</p>
    ${markForm(today)}
    ${i.overlay && !hide ? `<p class="lead">${esc(overlayLine(i.overlay))}</p>` : ''}
    ${i.episodes.map((e) => episodeRow(e, i.theta, hide)).join('')}
  </section>`;
}

/** 그날그날 남긴 평점과 메모를 다시 볼 수 있게 한다 */
function diaryCard(state, today) {
  const rows = rangeKeys(today, 30)
    .reverse()
    .filter((k) => Object.values(state.checkins[k] ?? {}).some(Boolean))
    .map((k) => {
      const c = state.checkins[k];
      const night = state.sleep[k];
      const hours = night ? sleepHours(night.bed, night.wake) : null;
      return `<tr><td>${esc(fmtDay(k))}</td><td>${c.energy ?? '–'}</td><td>${c.stress ?? '–'}</td><td>${c.mood ?? '–'}</td><td>${hours == null ? '–' : esc(fmtHours(hours))}</td><td>${esc(c.note ?? '')}</td></tr>`;
    });
  if (!rows.length) return '';
  return `<section class="card">
    <details class="table-view"><summary>날짜별 기록 보기 (최근 30일)</summary><div class="table-wrap"><table><thead><tr><th>날짜</th><th>에너지</th><th>스트레스</th><th>기분</th><th>수면</th><th>메모</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></details>
  </section>`;
}

function weeklyCard(state, i, today) {
  if (i.entries < 14) return '';
  const week = weekStartKey(today);
  const answer = state.weekly[week] || {};
  const word = WORK_WORD[state.profile.role];
  const past = Object.keys(state.weekly).filter((k) => k < week).sort().slice(-4).map((k) => state.weekly[k]);
  const history = [['쌓인 정도', 'built'], ['멀게 느껴진 정도', 'distance'], ['해낸 느낌', 'done']]
    .map(([label, field]) => [label, past.map((w) => w[field]).filter(Boolean)])
    .filter(([, values]) => values.length)
    .map(([label, values]) => `${label} ${values.join(', ')}`);
  const items = [
    { field: 'built', label: '이번 주 쌓인 정도', low: '거의 없음', high: '많이 쌓임' },
    { field: 'distance', label: `${word}${josa(word, '이', '가')} 멀게 느껴진 정도`, low: '가까움', high: '많이 멂' },
    { field: 'done', label: '해낸 느낌', low: '거의 없음', high: '잘 해냄' },
  ];
  return `<section class="card">
    <h2>이번 주 돌아보기</h2>
    <p class="sub">한 주에 한 번이면 돼요. 쌓인 정도에 5를 고르면 지친 주로 함께 남아요.</p>
    ${items.map((item) => ratingScale(item, answer[item.field], 'weekly')).join('')}
    ${history.length ? `<p class="hint strip-hint">지난 ${past.length}주 ${history.join(' · ')}</p>` : ''}
  </section>`;
}

// ---- 한 달 체크 ----
// 일하는 사람용 한국어판뿐이라 일하는 성인에게만 연다. 학생용이나 일하지 않는 사람용 한국어판이 없고, 문항을 바꿔 쓰면 안 된다.
const batFor = (profile) => READY && profile.role === 'worker' && profile.age !== 'u18' && !profile.monthlyOff;
const BAND = {
  low: { label: '낮은 쪽이에요', text: `유럽 연구가 정한 첫 번째 선(${LINES.mid})보다 낮아요. 괜찮다는 판정은 아니에요. 힘들다면 점수보다 그 느낌을 믿어 주세요.` },
  mid: { label: '두 선 사이예요', text: `유럽 연구가 정한 두 선(${LINES.mid}와 ${LINES.high}) 사이예요.` },
  high: { label: '높은 쪽이에요', text: `유럽 연구가 정한 두 번째 선(${LINES.high}) 이상이에요. 혼자 버티기 어렵다면 도움받을 곳이 있어요.` },
};
const CHANGE = { up: '지난 체크들보다 평균이 높아졌어요.', down: '지난 체크들보다 평균이 낮아졌어요.' };
const BAT_SOURCES = [
  ['https://doi.org/10.3390/ijerph17249495', 'Schaufeli·Desart·De Witte 2020, Burnout Assessment Tool (BAT): Development, Validity, and Reliability. IJERPH 17(24):9495'],
  ['https://burnoutassessmenttool.be/wp-content/uploads/2020/08/Test-Manual-BAT-English-version-2.0-1.pdf', 'Schaufeli·De Witte·Desart 2019, Burnout Assessment Tool (BAT) Test Manual. KU Leuven'],
  ['https://doi.org/10.24230/kjiop.v33i4.461-499', '조수현 2020, 한국판 직무소진평가척도(K-BAT) 타당화를 위한 예비연구. 한국심리학회지: 산업 및 조직 33(4):461-499'],
  ['https://doi.org/10.5271/sjweh.4093', 'Schaufeli 외 2023, How to assess severe burnout? Cutoff points for the Burnout Assessment Tool (BAT) based on three European samples. Scand J Work Environ Health 49(4):293-302'],
  ['https://burnoutassessmenttool.be/wp-content/uploads/2020/08/BAT-Korean.pdf', '공식 한국어 설문지 (KU Leuven)'],
];
const BAT_METHOD = `<details class="table-view method">
  <summary>선과 출처</summary>
  <p>두 선은 유럽 세 나라(네덜란드, 벨기에, 핀란드) 직장인 자료로 정했어요. 일 때문에 많이 지쳐 도움을 받던 사람들과 일반 직장인의 답을 견주어 골랐어요. 도움을 받던 사람 중에는 스스로 그렇다고 답한 사람도 있어요. 많이 지쳤던 사람은 92%가 ${LINES.mid} 이상, 74%가 ${LINES.high} 이상이었어요. 일반 직장인은 79%가 ${LINES.mid} 아래, 91%가 ${LINES.high} 아래였어요. 연구진도 더 확인해야 하는 잠정 기준이라고 했어요.</p>
  <p>선을 넘었어도 많이 지친 상태가 아닐 수 있고, 선 아래여도 많이 지친 상태일 수 있어요. 같은 사람도 체크할 때마다 점수가 조금씩 달라서, 선 가까이에서는 범위가 바뀌기 쉬워요. 이 점수로는 진단할 수 없어요. 지친 것인지 기분이 오래 가라앉은 것인지도 가르지 못해요.</p>
  <p>한국에서 이 설문을 확인한 연구는 회사원을 대상으로 한 한 편이에요. 그 연구에서는 9번 문항이 잘 맞지 않아 빼고 22문항으로 봤고, 전체 평균 하나보다 네 부분을 따로 보는 편이 더 맞았어요. 이 앱은 공식 설문지대로 23문항을 모두 써요. 유럽의 선이 23문항으로 정해졌기 때문이에요.</p>
  <p>높아졌다거나 낮아졌다는 말은 네 번 이상 체크한 뒤에만 해요. 지난 체크들의 평균과 0.36 이상 다르고, 그동안 오르내린 폭보다도 클 때예요. 한 달 간격과 답을 고칠 수 있는 7일은 앱이 정했어요. 얼마나 자주 해야 하는지 정한 연구는 없어요.</p>
  <p>문항과 고르는 말은 공식 한국어판 그대로예요. 종이에 표시하라는 안내 한 문장만 앱에 맞지 않아 뺐어요. 답은 이 기기에만 남아요.</p>
  <ul class="sources">${BAT_SOURCES.map(([href, text]) => `<li><a href="${href}" target="_blank" rel="noopener noreferrer">${esc(text)}</a></li>`).join('')}</ul>
</details>`;

function batResult(r, list) {
  const before = list.filter((x) => x.date < r.date).slice(-4).reverse();
  const moved = list.at(-1) === r ? change(list) : null;
  return `<div class="bat-result">
    <p class="bat-band" id="bat-result-head" tabindex="-1"><span class="fact">${BAND[r.band].label}</span></p>
    <p class="sub">${esc(BAND[r.band].text)}</p>
    <p class="bat-mean">답의 평균 <b>${r.mean.toFixed(2)}</b><small>1에서 5 사이</small></p>
    <div class="fact-grid">${PARTS.map((p, i) => `<div><span>${p.label}</span><b>${r.parts[i].toFixed(2)}</b></div>`).join('')}</div>
    <p class="hint">부분 점수에는 선을 두지 않았어요. 위의 두 선은 전체 평균에만 써요.</p>
    ${moved ? `<p class="lead">${CHANGE[moved]}</p>` : ''}
    ${before.length ? `<p class="hint">지난 체크 ${before.map((x) => `${fmtMonthDay(x.date)} ${x.mean.toFixed(2)}`).join(' · ')}</p>` : ''}
    <p class="hint">이 선은 유럽 세 나라 직장인 자료로 정했어요. 한국 사람에게도 맞는지는 아직 확인되지 않았어요. 진단이 아니라 참고로 봐 주세요.</p>
    <div class="bat-help">
      <p class="hint">많이 힘들면 점수와 상관없이 도움받을 곳을 볼 수 있어요.</p>
      <a class="btn small${r.band === 'high' ? ' primary' : ''}" href="#/help">도움받을 곳 보기</a>
    </div>
    ${BAT_METHOD}
  </div>`;
}

function batList(key, a) {
  const left = a.map((x, i) => (x == null ? i : -1)).filter((i) => i >= 0);
  const rows = ITEMS.map((q, i) => {
    const buttons = [1, 2, 3, 4, 5]
      .map((n) => `<button type="button" class="seg-btn" data-action="bat" data-id="${key}" data-field="${i}" data-value="${n}" aria-pressed="${a[i] === n}" aria-label="${n} ${esc(ANCHORS[n - 1])}">${n}</button>`)
      .join('');
    return `<div class="bat-row"><p class="bat-q" id="bat-q${i}">${i + 1}. ${esc(q)}</p><div class="seg" role="group" aria-labelledby="bat-q${i}">${buttons}</div></div>`;
  }).join('');
  return `<div class="bat-list" id="bat-list">
    <p class="bat-intro">${esc(INTRO)}</p>
    <p class="hint">숫자를 눌러 하나씩 골라 주세요.</p>
    <div class="bat-legend" aria-hidden="true">${ANCHORS.map((t, i) => `<span><b>${i + 1}</b>${esc(t)}</span>`).join('')}</div>
    ${rows}
    ${left.length ? `<div class="bat-left"><p class="hint">아직 ${left.length}문항이 남았어요.</p><button type="button" class="btn small" data-action="bat-jump" data-value="${left[0]}">${left[0] + 1}번으로 가기</button></div>` : '<div class="bat-left"><p class="hint">다 답했어요.</p><button type="button" class="btn small primary" data-action="bat-done">결과 보기</button></div>'}
  </div>`;
}

function monthlyCard(state, today) {
  if (!batFor(state.profile)) return '';
  const hide = state.profile.hide;
  const { list, last, next, open } = status(state.monthly, today);
  if (!open) batOpen = false; // 고칠 수 있는 7일이 펼쳐 둔 채로 지났다
  const a = (open && state.monthly[open]?.a) || Array(BAT_ITEMS).fill(null);
  const n = answered(a);
  const done = open != null && isComplete(a);
  const current = done ? list.find((r) => r.date === open) : null;
  let toggle = '';
  if (open) {
    const word = batOpen ? '접기' : done ? '답 고치기' : n ? `이어서 하기 ${n}/${BAT_ITEMS}` : '시작하기';
    toggle = `<button type="button" class="btn small outline" data-action="bat-open" aria-expanded="${batOpen}" aria-controls="bat-list">${word}</button>`;
  }
  const until = open && fmtMonthDay(editUntil(open));
  let body;
  if (batOpen) body = batList(open, a);
  else if (current && !hide) body = `<div id="bat-result">${batResult(current, list)}</div><p class="hint">${until}까지 답을 고칠 수 있어요.</p>`;
  else if (current) body = `<details class="bat-past" id="bat-result"><summary>${fmtMonthDay(current.date)} 체크 결과 보기</summary>${batResult(current, list)}</details><p class="hint">${until}까지 답을 고칠 수 있어요.</p>`;
  else if (open) {
    body = `<p class="sub">일하면서 느끼는 것을 묻는 ${BAT_ITEMS}문항이에요. 한 달에 한 번, 5분쯤 걸려요. 하고 싶을 때만 해도 돼요. 연구에서 쓰는 설문이라 문항과 고르는 말을 그대로 보여드려요.</p>
      ${n ? `<p class="hint">${until}까지 이어서 할 수 있어요.</p>` : ''}
      ${last ? `<details class="bat-past"><summary>지난 체크 ${fmtMonthDay(last.date)} 결과 보기</summary>${batResult(last, list)}</details>` : ''}`;
  } else {
    body = `<details class="bat-past"><summary>지난 체크 ${fmtMonthDay(last.date)} 결과 보기</summary>${batResult(last, list)}</details>
      <p class="hint">다음 체크는 ${fmtMonthDay(next)}부터 할 수 있어요.</p>`;
  }
  return `<section class="card bat-card" id="bat">
    <div class="card-head"><h2>한 달 체크</h2>${toggle}</div>
    ${body}
  </section>`;
}

/** 그 문항을 화면 가운데로 옮기고 첫 번째 답에 포커스를 둔다 */
function jumpTo(index) {
  const row = document.getElementById(`bat-q${index}`);
  row?.scrollIntoView({ block: 'center' });
  row?.nextElementSibling.querySelector('button').focus({ preventScroll: true });
}

/** 마지막 문항에 답하면 문항이 접히고 결과가 그 자리에 나오므로, 결과로 옮겨 가서 화면 읽기 프로그램도 결과부터 읽게 한다 */
function showBatResult() {
  const el = document.getElementById('bat-result');
  if (!el) return;
  document.getElementById('bat').scrollIntoView({ block: 'start' }); // 카드 제목부터 보이게 한다
  const warning = document.getElementById('save-warning');
  if (warning && !warning.hidden) scrollBy(0, -warning.offsetHeight);
  // 범위 이름부터 읽게 한다. 추정을 숨겼다면 접힌 결과의 제목으로 간다
  (el.tagName === 'DETAILS' ? el.querySelector('summary') : document.getElementById('bat-result-head')).focus({ preventScroll: true });
}

const METHOD = `<section class="card">
  <details class="table-view method">
    <summary>이 추정은 어떻게 계산하나요</summary>
    <p>하루 기록을 내 평소와 비교해 부하·수면 부족을 더하고, 회복 활동과 쉬어간 정도를 조금 빼요. 그 값을 약 7일 반감기로 천천히 쌓아요. 평소 범위를 벗어나면 <b>평소보다 조금 높아요</b>, 사흘 이상 이어지고 힘든 날도 평소보다 많으면 <b>한동안 평소보다 높아요</b>라고 말해요. 하루 나쁜 날만으로 이 말이 나오지는 않아요.</p>
    <p><b>부하와 회복 활동</b>은 영역 종류로 나눠요. 해야 하는 일은 기록한 시간을 그대로 부하로 쳐요. 그때그때 달라요로 정한 영역은 기록마다 고른 대로, 채워졌어요면 회복 활동, 지쳤어요면 부하로 치고, 그대로예요면 넣지 않아요. 같은 활동이라도 그 시간에 쉬어졌는지에 따라 달라서예요. 해야 하는 일이던 때 남긴 기록처럼 고른 값이 없는 기록은 부하로 쳐요. 앞뒤 7일 안에 해야 하는 일 기록이 없는 날은 비교할 평소 부하가 없어서, 쌓인 부하를 계산할 때 지쳤어요 시간도 평소와 비교하지 않아요. 하루 12시간, 주 52·55시간, 30% 급증 같은 기록한 시간 메모에는 지쳤어요 시간도 들어가요.</p>
    <p><b>힘든 날</b>은 스트레스 4 이상, 에너지 2 이하, 기분 2 이하 중 두 가지 이상인 날이에요. 기록이 비어 있는 날은 평균으로 채우지 않아요. 4일 이상 끊기면 알 수 없다고 말하고, 14일 이상 끊기면 다시 쌓아요.</p>
    <p><b>'한동안 평소보다 높아요' 기준</b>은 기록으로 확인된 표시가 5번 쌓일 때까지 내 기록으로 옮겨가지 않아요. 두세 번으로는 우연과 구별할 수 없어서예요. '많이 지쳤지만 할 일은 했어요'는 0.5번으로 세요. 다만 표시 없이 지나간 때가 있으면 조금 올라가요.</p>
    <h3>기본값과 근거 강도</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>항목</th><th>기본값</th><th>근거</th></tr></thead>
      <tbody>
        <tr><td>필요한 수면</td><td>성인 7시간, 14~17세 8시간</td><td>합의문</td></tr>
        <tr><td>수면 부족 추세</td><td>7일 평균 6시간 이하, 또는 필요량보다 1시간 이상 적음</td><td>실험 연구, 기준선은 설계 판단</td></tr>
        <tr><td>수면 회복</td><td>하룻밤 최대 1.5시간</td><td>약함</td></tr>
        <tr><td>주 55시간 이상 기록</td><td>건강 메모 (일하는 분만)</td><td>뇌졸중·심장 질환은 강함, 우울은 불확실, 번아웃은 한 시점 조사뿐</td></tr>
        <tr><td>회복 활동</td><td>채워졌어요를 고른 시간. 주 150분(18세 미만은 하루 60분)이면 회복으로 빼는 몫(원래 작아요)을 거의 다 채워요. 못 채워도 실패가 아니에요</td><td>운동은 건강에 중간, 번아웃에는 입증 안 됨. 다른 활동은 근거가 없어 운동 기준을 빌려 써요</td></tr>
        <tr><td>끝나고 나니</td><td>그때그때 다른 일을 기록할 때마다 골라요</td><td>기록마다 고르는 방식은 앱이 정했어요. 일이 끝난 뒤의 시간에 일에서 벗어난 정도가 지친 정도와 관련 있었다는 연구(직장인 대상, 관련만 확인)를, 회복을 운동 시간만으로 보지 않는 근거로 삼았어요</td></tr>
        <tr><td>에너지·스트레스·기분</td><td>기준치 없음, 내 평소와 비교</td><td>사람마다 달라 인구 기준을 쓰지 않아요</td></tr>
        <tr><td>공부 시간, 쉬는 날 수</td><td>기준치 없음</td><td>근거를 찾지 못했어요</td></tr>
        <tr><td>힘든 날 정의, 평소 범위, 쌓이는 속도</td><td>앱이 정한 값</td><td>관례. 모의 데이터로만 맞췄어요</td></tr>
      </tbody>
    </table></div>
    <h3>출처</h3>
    <ul class="sources">
      <li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC5233687/" target="_blank" rel="noopener noreferrer">Wendsche·Lohmann-Haislah 2017, 일에서 벗어남 메타분석</a></li>
      <li><a href="https://www.who.int/news/item/28-05-2019-burn-out-an-occupational-phenomenon-international-classification-of-diseases" target="_blank" rel="noopener noreferrer">WHO 2019, 번아웃의 정의</a></li>
      <li><a href="https://www.cambridge.org/core/journals/epidemiology-and-psychiatric-sciences/article/psychometric-properties-of-burnout-measures-a-systematic-review/D5244F95FF7F2C56C65004C1DDE2608F" target="_blank" rel="noopener noreferrer">Shoman 외 2021, 번아웃 척도 체계적 고찰</a></li>
      <li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4434546/" target="_blank" rel="noopener noreferrer">Watson 외 2015, 성인 수면 합의문</a></li>
      <li><a href="https://pubmed.ncbi.nlm.nih.gov/12683469/" target="_blank" rel="noopener noreferrer">Van Dongen 외 2003, 수면 제한의 누적 영향</a></li>
      <li><a href="https://stacks.cdc.gov/view/cdc/230295" target="_blank" rel="noopener noreferrer">Rugulies 외 2021, 장시간 노동과 우울</a></li>
      <li><a href="https://doi.org/10.1016/j.envint.2020.105746" target="_blank" rel="noopener noreferrer">Descatha 외 2020, 장시간 노동과 뇌졸중</a></li>
      <li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC7339147/" target="_blank" rel="noopener noreferrer">Li 외 2020, 장시간 노동과 심장 질환</a></li>
      <li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC9602979/" target="_blank" rel="noopener noreferrer">Shoman 외 2022, 번아웃 관련 요인 메타분석</a></li>
      <li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC7719906/" target="_blank" rel="noopener noreferrer">Bull 외 2020, WHO 신체활동 지침</a></li>
      <li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC6142277" target="_blank" rel="noopener noreferrer">Fisher 외 2018, 집단 결과가 개인에게 맞지 않는 문제</a></li>
      <li><a href="https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc324.htm" target="_blank" rel="noopener noreferrer">NIST 핸드북, 지수가중이동평균</a></li>
      <li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC8649413" target="_blank" rel="noopener noreferrer">Martin 외 2021, 적은 사례로 예측 모델을 만들 때의 한계</a></li>
    </ul>
    <p>이 방식 자체는 번아웃 예측에 검증된 적이 없어요. 내 기록을 돌아보는 도구로만 써주세요.</p>
  </details>
</section>`;

export function render(state) {
  const today = todayKey();
  const i = insight(state, today);
  chart = i.entries >= K.TREND_MIN && !i.noUsual && !state.profile.hide ? i : null;
  if (state.profile.hide) {
    return `${HEADER}
      ${supportCard(i)}
      <section class="card"><h2>추정을 숨겨뒀어요</h2><p class="sub flush">기록은 그대로 쌓여요. 다시 보려면 설정에서 바꿀 수 있어요.</p></section>
      ${marksCard(i, today, true)}
      ${weeklyCard(state, i, today)}
      ${monthlyCard(state, today)}
      ${diaryCard(state, today)}
      <p class="disclaimer">${batFor(state.profile) ? BAT_HIDDEN_CLAIM : HIDDEN_CLAIM}</p>`;
  }
  return `${supportCard(i)}
    ${hero(i)}
    ${trendCard(i)}
    ${readouts(i)}
    ${marksCard(i, today, false)}
    ${flagCard(i)}
    ${newNormalCard(i)}
    ${helpedCard(i)}
    ${notesCard(i)}
    ${weeklyCard(state, i, today)}
    ${monthlyCard(state, today)}
    ${diaryCard(state, today)}
    ${usualCard(i)}
    ${personalCard(i, state.profile)}
    ${METHOD}
    <p class="disclaimer">${batFor(state.profile) ? BAT_CLAIM : CLAIM}</p>`;
}

export const label = (state) => (state.profile.hide ? '회복' : '쌓인 부하 (추정)');

export function drawCharts(root) {
  const el = root.querySelector('[data-chart="trend"]');
  if (!el || !chart) return;
  const marked = markedDays(chart);
  const points = chart.trend.map((p) => {
    const rows = [{ label: '', value: p.band ? BANDS[p.band] : noRating(p) }];
    if (marked.has(p.key)) rows.push({ label: '', value: '지친 날로 표시' });
    if (p.hardWindow) rows.push({ label: '최근 14일 힘든 날', value: `${p.hardCount}/${p.hardWindow}일` });
    if (p.debt != null) rows.push({ label: '수면 부족 누적', value: fmtHours(p.debt) });
    return { label: fmtMonthDay(p.key), title: fmtDay(p.key), value: p.T, rows };
  });
  const keys = chart.trend.map((p) => p.key);
  const marks = [...marked].map((k) => keys.indexOf(k)).filter((n) => n >= 0);
  zoneChart(el, { points, marks, zoneTop: K.T_HIGH, label: '최근 60일 쌓인 부하와 내 평소 범위' });
}

export const mount = (root) => drawCharts(root);

/** 오늘 화면에서 넘어왔다면 표시 칸이 바로 보이게 한다 */
export function arrive(root) {
  const el = root.querySelector('.mark-form');
  if (!el) return;
  el.scrollIntoView({ block: 'start' });
  const warning = document.getElementById('save-warning');
  if (warning && !warning.hidden) scrollBy(0, -warning.offsetHeight);
  el.focus({ preventScroll: true });
}

function saveMark() {
  const today = todayKey();
  const date = form.date || form.shown || today; // 자정을 넘겨 눌러도 화면에 보이는 날짜로 저장한다
  const closedOn = date < today ? form.closedOn : '';
  document.activeElement?.blur(); // 키보드에 가려지지 않도록
  if (date > today || date < addDays(today, -OLDEST_MARK)) return toast('날짜는 오늘부터 최근 90일 안에서 골라주세요');
  if (closedOn && (closedOn < date || closedOn > today)) return toast('괜찮아진 날은 그날부터 오늘 사이로 골라주세요');
  if (!form.sev) return toast('어느 정도였는지 골라주세요');
  const { sev, fuzz, tag } = form;
  form = { ...CLOSED_FORM };
  addMark({ date, sev, fuzz, tag: tag ?? undefined, closedOn: closedOn || undefined });
  if (sev === 3 && !closedOn) scrollTo(0, 0); // 바로 뜨는 도움 안내가 보이게 한다
  savedToast('남겨뒀어요. 오늘은 조금 쉬어가도 돼요.');
}

function finishMarks(ids) {
  const open = getState().marks.filter((m) => ids.includes(m.id) && !m.closedOn).map((m) => m.id);
  closeMarks(open, todayKey());
  savedToast('다행이에요. 오늘부터 회복 중 표시를 뗄게요.', { label: '되돌리기', onClick: () => reopenMarks(open) });
}

function removeMarks(ids, weeks) {
  const state = getState();
  const marks = state.marks.filter((m) => ids.includes(m.id));
  const answers = weeks.map((week) => [week, state.weekly[week]?.built]);
  deleteMarks(ids);
  weeks.forEach((week) => setWeekly(week, { built: undefined }));
  const count = ids.length + weeks.length;
  savedToast(count > 1 ? `표시 ${count}개를 지웠어요` : '지웠어요', {
    label: '되돌리기',
    onClick: () => {
      restoreMarks(marks);
      answers.forEach(([week, built]) => setWeekly(week, { built }));
    },
  });
}

export const on = {
  async click(e) {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const { action, field, value, id } = button.dataset;
    if (action === 'mark-open') {
      openMarkForm();
      refresh();
    } else if (action === 'mark-fuzz') {
      form.fuzz = Number(value);
      refresh();
    } else if (action === 'mark-sev') {
      form.sev = Number(value);
      refresh();
    } else if (action === 'mark-tag') {
      form.tag = form.tag === value ? null : value;
      refresh();
    } else if (action === 'mark-save') saveMark();
    else if (action === 'mark-cancel') {
      form = { ...CLOSED_FORM };
      refresh();
    } else if (action === 'mark-close') finishMarks(id.split(','));
    else if (action === 'mark-delete') removeMarks(id.split(',').filter(Boolean), button.dataset.weeks.split(',').filter(Boolean));
    else if (action === 'weekly') {
      const today = todayKey();
      // 쌓인 정도에 답한 날만 표시 날짜로 남긴다. 다른 칸을 나중에 답해도 날짜가 옮겨가지 않게 한다.
      setWeekly(weekStartKey(today), field === 'built' ? { built: Number(value), on: today } : { [field]: Number(value) });
    } else if (action === 'bat-open') {
      batOpen = !batOpen;
      refresh();
      // 이어서 할 때는 처음 빈 문항으로 데려간다. 23문항을 다시 내려가지 않게 한다
      const empty = batOpen ? document.querySelector('.bat-left [data-action="bat-jump"]') : null;
      if (empty && document.querySelector('[data-action="bat"][aria-pressed="true"]')) jumpTo(empty.dataset.value);
    } else if (action === 'bat') {
      const index = Number(field);
      const answer = Number(value);
      const a = getState().monthly[id]?.a ?? Array(BAT_ITEMS).fill(null);
      const finishing = !isComplete(a) && isComplete(a.map((x, i) => (i === index ? answer : x)));
      if (finishing) batOpen = false; // 다 답하면 접고 결과를 보여준다
      // 답을 고치다 범위가 바뀌면 맨 위에 도움 안내가 생기거나 사라져 목록이 밀린다. 누른 버튼이 손가락 아래에 그대로 있게 한다
      const before = button.getBoundingClientRect().top;
      setMonthly(id, index, answer);
      if (finishing) showBatResult();
      else {
        const after = document.querySelector(`[data-action="bat"][data-field="${index}"][data-value="${answer}"]`)?.getBoundingClientRect().top;
        if (after != null && after !== before) scrollBy(0, after - before);
      }
    } else if (action === 'bat-done') {
      batOpen = false;
      refresh();
      showBatResult();
    } else if (action === 'bat-jump') jumpTo(value); else if (action === 'support-close') setSupportSeen();
    else if (action === 'rebase' && (await ask('내일부터 평소를 새로 계산할까요? 지금까지의 기록은 그대로 남아요.', '새로 계산'))) {
      addRebase(todayKey());
      savedToast('내일부터 새로 계산할게요');
    }
  },
  input(e) {
    const el = e.target;
    if ('markClosed' in el.dataset) form.closedOn = el.value;
    if (!('markDate' in el.dataset)) return;
    form.date = el.value;
    // 다시 그리면 날짜를 고르던 칸이 사라지므로 필요한 곳만 고친다
    document.querySelector('[data-mark-after]').hidden = !(el.value && el.value < todayKey());
    document.querySelector('[data-mark-closed]').min = el.value;
  },
};
