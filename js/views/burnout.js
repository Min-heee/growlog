// 번아웃 화면: 지수, 회복 조언, 요인별 점수, 14일 추이
import { burnoutTrend, computeBurnout, LEVELS, MIN_DAYS } from '../burnout.js';
import { fmtDay, fmtShort, todayKey } from '../dates.js';
import { lineChart } from '../charts.js';
import { esc, fmt1, fmtHours } from '../util.js';
import { statusBadge } from '../ui.js';

const ICONS = { stress: '🧘', energy: '🔋', mood: '💬', sleep: '😴', workload: '🗓️', recovery: '🚶', good: '🌿' };
const DISCLAIMER = '이 지수는 내가 남긴 기록으로 계산한 참고용 지표이고, 의학적 진단이 아니에요. 지친 느낌이 2주 이상 이어지거나 일상이 힘들다면 전문가와 상담해보세요.';
const HEADER = '<header class="page-head"><p class="eyebrow">번아웃 관리</p><h1>번아웃 지수</h1></header>';

let trend = [];

const tile = (label, value) => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div></div>`;

function factorRow(f) {
  const known = f.value != null;
  const percent = known ? Math.round(f.value * 100) : 0;
  return `<div class="factor${known ? '' : ' na'}">
    <div><div class="factor-name">${f.label}</div><div class="factor-detail">${esc(f.detail)}</div></div>
    <div class="factor-bar"><span style="width:${percent}%"></span></div>
    <div class="factor-val">${known ? percent : '–'}</div>
  </div>`;
}

export function render(state) {
  const today = todayKey();
  const b = computeBurnout(state, today);
  trend = burnoutTrend(state, today, 14);
  if (b.score == null) {
    return `${HEADER}
      <section class="card">
        <h2>아직 기록이 부족해요</h2>
        <p class="sub">하루치 기록만으로는 지친 정도를 알기 어려워요. 최근 7일 중 ${MIN_DAYS}일 이상 컨디션이나 수면을 기록하면 지수를 계산해드려요. (지금 ${b.dataDays}일)</p>
        <a class="btn primary" href="#/today">컨디션 기록하러 가기</a>
      </section>
      <p class="disclaimer">${DISCLAIMER}</p>`;
  }
  const { stats } = b;
  const scaleMarks = [...LEVELS].reverse().map((l) => `<span style="left:${l.min}%">${l.label}</span>`).join('');
  const rows = [...trend].reverse().map((p) => `<tr><td>${esc(fmtDay(p.key))}</td><td>${p.score ?? '–'}</td></tr>`).join('');
  return `${HEADER}
    <section class="card">
      <div class="hero-row">
        <div class="hero-num">${b.score}<span>/100</span></div>
        ${statusBadge(b.level)}
      </div>
      <div class="meter" style="--status:var(--${b.level.key})"><span style="width:${b.score}%"></span></div>
      <div class="meter-scale" aria-hidden="true">${scaleMarks}</div>
      <p class="lead">${esc(b.level.desc)}</p>
      <p class="hint">최근 7일 중 ${b.dataDays}일의 기록으로 계산했어요.${b.dataDays < 5 ? ' 기록이 쌓일수록 정확해져요.' : ''}</p>
    </section>
    <section class="card">
      <h2>회복 조언</h2>
      <p class="sub">지수를 가장 많이 올린 요인부터 골랐어요.</p>
      <ul class="advice">
        ${b.advice.map((a) => `<li><span class="advice-icon" aria-hidden="true">${ICONS[a.key]}</span><span>${esc(a.text)}</span></li>`).join('')}
      </ul>
    </section>
    <section class="card">
      <h2>요인별 점수</h2>
      <p class="sub">0~100으로 나타냈고 높을수록 부담이 커요. 스트레스·에너지·수면이 가장 크게 반영돼요.</p>
      ${b.factors.map(factorRow).join('')}
    </section>
    <section class="card">
      <h2>최근 14일 추이</h2>
      <p class="sub">날마다 그날까지의 7일을 기준으로 계산했어요.</p>
      <div class="chart" data-chart="trend"></div>
      <details class="table-view"><summary>표로 보기</summary><div class="table-wrap"><table><thead><tr><th>날짜</th><th>지수</th></tr></thead><tbody>${rows}</tbody></table></div></details>
    </section>
    <section class="card">
      <h2>최근 7일 요약</h2>
      <p class="sub">기록을 바탕으로 낸 평균이에요.</p>
      <div class="tiles">
        ${tile('평균 수면', stats.sleep == null ? '–' : fmtHours(stats.sleep))}
        ${tile('평균 스트레스', stats.stress == null ? '–' : `${fmt1(stats.stress)}<small>/5</small>`)}
        ${tile('평균 에너지', stats.energy == null ? '–' : `${fmt1(stats.energy)}<small>/5</small>`)}
        ${tile('쉰 날', `${stats.restDays}<small>/ ${stats.spanDays}일</small>`)}
      </div>
    </section>
    <p class="disclaimer">${DISCLAIMER}</p>`;
}

export function drawCharts(root) {
  const el = root.querySelector('[data-chart="trend"]');
  if (!el) return;
  lineChart(el, {
    points: trend.map((p) => ({ label: fmtShort(p.key), title: fmtDay(p.key), value: p.score })),
    color: 'var(--ink-2)',
    name: '번아웃 지수',
    label: '최근 14일 번아웃 지수 추이',
  });
}

export const mount = (root) => drawCharts(root);
