// 통계 화면: 7/30일 활동 시간, 영역별 합계, 수면, 기록 목록
import { fmtDay, fmtShort, rangeKeys, sleepHours, todayKey, weekday } from '../dates.js';
import { columns, stackedColumns } from '../charts.js';
import { avg, esc, fmt1, fmtHM, fmtHours, sum } from '../util.js';
import { areaColor, entryList, refresh } from '../ui.js';

const RANGE_KEY = 'growlog:range';
const RANGES = [7, 30];

function readRange() {
  try {
    return localStorage.getItem(RANGE_KEY) === '30' ? 30 : 7;
  } catch {
    return 7;
  }
}

let range = readRange();
let model = null; // 차트를 다시 그릴 때 쓰는 데이터

const tile = (label, value) => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div></div>`;
const tableView = (head, rows) => `<details class="table-view"><summary>표로 보기</summary><div class="table-wrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div></details>`;

function activityTable(days, series) {
  const head = `<tr><th>날짜</th>${series.map((s) => `<th>${esc(s.label)}</th>`).join('')}<th>합계</th></tr>`;
  const rows = [...days]
    .reverse()
    .map((d) => {
      const cells = series.map((s) => `<td>${d.values[s.id] ? fmtHM(d.values[s.id]) : '–'}</td>`).join('');
      return `<tr><td>${esc(d.title)}</td>${cells}<td>${fmtHM(sum(series, (s) => d.values[s.id] || 0))}</td></tr>`;
    })
    .join('');
  return tableView(head, rows);
}

function sleepTable(nights) {
  const head = '<tr><th>날짜</th><th>수면</th><th>잠든 시간</th><th>일어난 시간</th><th>질</th></tr>';
  const rows = [...nights]
    .reverse()
    .filter((n) => n.night)
    .map((n) => `<tr><td>${esc(n.title)}</td><td>${n.value != null ? fmtHours(n.value) : '–'}</td><td>${esc(n.night.bed || '–')}</td><td>${esc(n.night.wake || '–')}</td><td>${n.night.quality ? `${n.night.quality}/5` : '–'}</td></tr>`)
    .join('');
  return tableView(head, rows);
}

export function render(state) {
  const end = todayKey();
  const keys = rangeKeys(end, range);
  const label = (k) => (range === 7 ? weekday(k) : fmtShort(k));
  const entries = state.entries.filter((e) => e.date >= keys[0] && e.date <= end);
  const used = new Set(entries.map((e) => e.areaId));
  // 숨긴 영역도 이 기간에 기록이 있으면 함께 보여준다. 색은 영역에 고정돼 있어 바뀌지 않는다.
  const series = state.areas.filter((a) => !a.archived || used.has(a.id));

  const days = keys.map((k) => {
    const values = Object.create(null); // 영역 id가 constructor 같은 이름이어도 안전하게
    for (const e of entries) if (e.date === k) values[e.areaId] = (values[e.areaId] || 0) + e.minutes;
    return { key: k, label: label(k), title: fmtDay(k), values };
  });
  const nights = keys.map((k) => {
    const night = state.sleep[k];
    return { label: label(k), title: fmtDay(k), value: night ? sleepHours(night.bed, night.wake) : null, night };
  });
  model = { days, series, nights, sleepGoal: state.sleepGoal };

  const counted = entries.filter((e) => series.some((s) => s.id === e.areaId));
  const total = sum(counted, (e) => e.minutes);
  const sleepAvg = avg(nights.map((n) => n.value).filter((v) => v != null));
  const activeDays = new Set(counted.map((e) => e.date)).size;

  const totals = series.map((a) => ({ a, minutes: sum(counted.filter((e) => e.areaId === a.id), (e) => e.minutes) })).sort((x, y) => y.minutes - x.minutes);
  const totalRows = totals
    .map(({ a, minutes }) => {
      const share = total ? Math.round((minutes / total) * 100) : 0;
      return `<div class="goal">
        <div class="goal-head"><span class="goal-name"><span class="dot" style="background:${areaColor(a)}"></span>${esc(a.emoji)} ${esc(a.label)}</span><span class="goal-val"><strong>${fmtHM(minutes)}</strong> · ${share}%</span></div>
        <div class="bar"><span style="width:${share}%;background:${areaColor(a)}"></span></div>
      </div>`;
    })
    .join('');

  const legend = series.length > 1 ? `<ul class="legend">${series.map((s) => `<li><span class="swatch" style="background:${areaColor(s)}"></span>${esc(s.label)}</li>`).join('')}</ul>` : '';
  const groups = [...keys]
    .reverse()
    .map((k) => ({ k, list: entries.filter((e) => e.date === k).sort((a, b) => b.createdAt - a.createdAt) }))
    .filter((g) => g.list.length)
    .map((g) => `<div class="day-group"><h3><span>${fmtDay(g.k)}</span><span>${fmtHM(sum(g.list, (e) => e.minutes))}</span></h3>${entryList(g.list, state)}</div>`)
    .join('');
  const buttons = RANGES.map((r) => `<button type="button" class="seg-btn" data-action="range" data-value="${r}" aria-pressed="${range === r}">최근 ${r}일</button>`).join('');

  return `
    <header class="page-head">
      <p class="eyebrow">통계</p>
      <h1>나의 기록</h1>
    </header>
    <div class="filters"><div class="seg inline" role="group" aria-label="기간">${buttons}</div></div>
    <div class="tiles">
      ${tile('총 활동', fmtHM(total))}
      ${tile('하루 평균', fmtHM(total / range))}
      ${tile('평균 수면', sleepAvg == null ? '–' : fmtHours(sleepAvg))}
      ${tile('기록한 날', `${activeDays}<small>/ ${range}일</small>`)}
    </div>
    <section class="card">
      <h2>일별 활동 시간</h2>
      <p class="sub">막대에 마우스를 올리거나 탭하면 자세히 보여요.</p>
      ${legend}
      <div class="chart" data-chart="activity"></div>
      ${activityTable(days, series)}
    </section>
    <section class="card">
      <h2>영역별 합계</h2>
      <p class="sub">최근 ${range}일 동안 시간을 어디에 썼는지 보여줘요.</p>
      ${totalRows || '<p class="empty">활동 영역이 없어요.</p>'}
    </section>
    <section class="card">
      <h2>수면 시간</h2>
      <p class="sub">일어난 날짜 기준이에요. 선은 목표 ${fmt1(state.sleepGoal)}시간이에요.</p>
      <div class="chart" data-chart="sleep"></div>
      ${sleepAvg == null ? '' : sleepTable(nights)}
    </section>
    <section class="card">
      <h2>기록 목록</h2>
      ${groups || '<p class="empty">이 기간에는 기록이 없어요.</p>'}
    </section>`;
}

export function drawCharts(root) {
  const activity = root.querySelector('[data-chart="activity"]');
  if (activity) {
    stackedColumns(activity, {
      days: model.days,
      series: model.series.map((s) => ({ id: s.id, label: s.label, color: areaColor(s) })),
      label: '일별 활동 시간',
    });
  }
  const sleep = root.querySelector('[data-chart="sleep"]');
  if (sleep) {
    const points = model.nights.map((n) => {
      const rows = n.value == null ? [{ label: '수면', value: '기록 없음', color: 'var(--s7)' }] : [{ label: '수면', value: fmtHours(n.value), color: 'var(--s7)' }];
      if (n.night?.bed && n.night?.wake) rows.push({ label: '잠든·일어난 시간', value: `${n.night.bed} → ${n.night.wake}` });
      if (n.night?.quality) rows.push({ label: '수면의 질', value: `${n.night.quality}/5` });
      return { label: n.label, title: n.title, value: n.value, rows };
    });
    columns(sleep, { points, color: 'var(--s7)', ref: { value: model.sleepGoal, label: `목표 ${fmt1(model.sleepGoal)}h` }, label: '일별 수면 시간' });
  }
}

export const mount = (root) => drawCharts(root);

export const on = {
  click(e) {
    const button = e.target.closest('[data-action="range"]');
    if (!button) return;
    range = Number(button.dataset.value);
    try {
      localStorage.setItem(RANGE_KEY, String(range));
    } catch {
      /* 기억하지 못해도 동작에는 문제 없음 */
    }
    refresh();
  },
};
