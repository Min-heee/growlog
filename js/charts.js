// 라이브러리 없이 만든 SVG 차트. 컨테이너의 실제 픽셀 너비로 그려서 글자 크기가 화면마다 일정하다.
import { esc, fmtHM } from './util.js';

// 툴팁 내용은 DOM 속성 대신 여기에 보관하고, 요소에는 id만 단다
const tips = new Map();
let seq = 0;
export const resetTips = () => tips.clear();
export const getTip = (id) => tips.get(id);
function tipAttrs(tip) {
  const id = `tip${++seq}`;
  tips.set(id, tip);
  return `data-tip="${id}" tabindex="0"`;
}

function niceScale(top, steps = 4) {
  const raw = top / steps;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((n) => n * mag).find((s) => s >= raw);
  return { max: step * Math.ceil(top / step), step };
}
const ticksOf = ({ max, step }) => Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
const fmtTick = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** 끝(위쪽)만 4px 둥글고 기준선은 각진 막대 */
function roundedTop(x, y, w, h, r = 4) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}A${rr},${rr} 0 0 1 ${x + rr},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}V${y + h}Z`;
}

function frame({ W, m, ph, ticks, y, unit, labels, xAt }) {
  let out = '';
  for (const v of ticks) {
    const yy = Math.round(y(v)) + 0.5;
    out += `<line class="${v === 0 ? 'axis' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
    out += `<text class="tick" x="${m.l - 6}" y="${yy}" text-anchor="end" dominant-baseline="middle">${fmtTick(v)}${unit}</text>`;
  }
  // 글자가 겹치지 않게 건너뛰되, 가장 최근 날짜는 항상 표시한다
  const fit = Math.max(1, Math.floor((W - m.l - m.r) / 36));
  const stride = Math.ceil(labels.length / fit);
  labels.forEach((label, i) => {
    if ((labels.length - 1 - i) % stride) return;
    out += `<text class="tick" x="${xAt(i)}" y="${m.t + ph + 16}" text-anchor="middle">${esc(label)}</text>`;
  });
  return out;
}

const svg = (W, H, body, label) => `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${body}</svg>`;

/** 일별 누적 막대. days: [{ label, title, values: { 영역id: 분 } }], series: [{ id, label, color }] */
export function stackedColumns(el, { days, series, label }) {
  const W = Math.max(260, el.clientWidth);
  const H = 200;
  const m = { t: 10, r: 4, b: 26, l: 34 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const totals = days.map((d) => series.reduce((acc, s) => acc + (d.values[s.id] || 0), 0));
  const scale = niceScale(Math.max(...totals, 120) / 60);
  const y = (v) => m.t + ph - (v / scale.max) * ph;
  const band = pw / days.length;
  const bw = Math.min(24, Math.max(3, band * 0.6));
  const xAt = (i) => m.l + band * i + band / 2;

  let body = frame({ W, m, ph, ticks: ticksOf(scale), y, unit: 'h', labels: days.map((d) => d.label), xAt });
  days.forEach((d, i) => {
    const x = xAt(i) - bw / 2;
    const present = series.filter((s) => d.values[s.id] > 0);
    let acc = 0;
    let marks = '';
    present.forEach((s, j) => {
      const bottom = y(acc) - (j ? 2 : 0); // 조각 사이 2px 간격
      acc += d.values[s.id] / 60;
      const top = y(acc);
      const h = bottom - top;
      if (h < 0.5) return;
      marks += j === present.length - 1
        ? `<path d="${roundedTop(x, top, bw, h)}" style="fill:${s.color}"/>`
        : `<rect x="${x}" y="${top}" width="${bw}" height="${h}" style="fill:${s.color}"/>`;
    });
    const rows = [{ label: '합계', value: fmtHM(totals[i]) }, ...series.map((s) => ({ color: s.color, label: s.label, value: fmtHM(d.values[s.id] || 0) }))];
    body += `<g class="col">${marks}<rect class="hit" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ph}" ${tipAttrs({ title: d.title, rows })}/></g>`;
  });
  el.innerHTML = svg(W, H, body, label);
}

/** 단일 계열 막대 + 목표선. points: [{ label, title, value|null, rows }], ref: { value, label } */
export function columns(el, { points, color, ref, label }) {
  const W = Math.max(260, el.clientWidth);
  const H = 180;
  const m = { t: 12, r: ref ? 52 : 4, b: 26, l: 30 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const scale = niceScale(Math.max(...points.map((p) => p.value ?? 0), (ref?.value ?? 0) * 1.15, 1));
  const y = (v) => m.t + ph - (v / scale.max) * ph;
  const band = pw / points.length;
  const bw = Math.min(24, Math.max(3, band * 0.6));
  const xAt = (i) => m.l + band * i + band / 2;

  let body = frame({ W, m, ph, ticks: ticksOf(scale), y, unit: 'h', labels: points.map((p) => p.label), xAt });
  points.forEach((p, i) => {
    const bar = p.value ? `<path d="${roundedTop(xAt(i) - bw / 2, y(p.value), bw, y(0) - y(p.value))}" style="fill:${color}"/>` : '';
    body += `<g class="col">${bar}<rect class="hit" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ph}" ${tipAttrs({ title: p.title, rows: p.rows })}/></g>`;
  });
  if (ref) {
    const ry = Math.round(y(ref.value)) + 0.5;
    body += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${ry}" y2="${ry}"/>`;
    body += `<text class="ref-label" x="${W - m.r + 6}" y="${ry}" dominant-baseline="middle">${esc(ref.label)}</text>`;
  }
  el.innerHTML = svg(W, H, body, label);
}

/** 선 그래프. points: [{ label, title, value|null }] — 기록이 없는 날은 선을 끊는다 */
export function lineChart(el, { points, color, max = 100, ticks = [0, 50, 100], name, label }) {
  const W = Math.max(260, el.clientWidth);
  const H = 180;
  const m = { t: 12, r: 30, b: 26, l: 30 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = points.length;
  const xAt = (i) => m.l + (n > 1 ? (pw * i) / (n - 1) : pw / 2);
  const y = (v) => m.t + ph - (v / max) * ph;

  let body = frame({ W, m, ph, ticks, y, unit: '', labels: points.map((p) => p.label), xAt });
  let d = '';
  points.forEach((p, i) => {
    if (p.value == null) return;
    d += `${points[i - 1]?.value != null ? 'L' : 'M'}${xAt(i).toFixed(1)},${y(p.value).toFixed(1)}`;
  });
  body += `<path d="${d}" fill="none" style="stroke:${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  // 양옆이 비어 선으로 안 보이는 점은 점으로 표시
  points.forEach((p, i) => {
    if (p.value == null || points[i - 1]?.value != null || points[i + 1]?.value != null) return;
    body += `<circle cx="${xAt(i)}" cy="${y(p.value)}" r="3" style="fill:${color}"/>`;
  });
  const last = points.findLastIndex((p) => p.value != null);
  if (last >= 0) {
    const cx = xAt(last);
    const cy = y(points[last].value);
    body += `<circle cx="${cx}" cy="${cy}" r="4" style="fill:${color};stroke:var(--surface)" stroke-width="2"/>`;
    body += `<text class="end-label" x="${cx + 8}" y="${cy}" dominant-baseline="middle">${points[last].value}</text>`;
  }
  const half = n > 1 ? pw / (n - 1) / 2 : pw / 2;
  points.forEach((p, i) => {
    const x = xAt(i);
    const tip = { title: p.title, rows: [{ color, label: name, value: p.value == null ? '기록 없음' : String(p.value) }] };
    const dot = p.value == null ? '' : `<circle class="hover-dot" cx="${x}" cy="${y(p.value)}" r="4" style="fill:${color};stroke:var(--surface)" stroke-width="2"/>`;
    body += `<g class="hitg"><line class="xhair" x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ph}"/>${dot}<rect class="hit" x="${x - half}" y="${m.t}" width="${half * 2}" height="${ph}" ${tipAttrs(tip)}/></g>`;
  });
  el.innerHTML = svg(W, H, body, label);
}
