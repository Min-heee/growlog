// 라이브러리 없이 만든 SVG 차트. 컨테이너의 실제 픽셀 너비로 그려서 글자 크기가 화면마다 일정하다.
import { esc, fmtHM } from './util.js';

// 툴팁 내용은 DOM 속성 대신 여기에 보관하고, 요소에는 id만 단다
const tips = new Map();
let seq = 0;
export const resetTips = () => tips.clear();
export const getTip = (id) => tips.get(id);
function tipAttrs(tip, focusable = true) {
  const id = `tip${++seq}`;
  tips.set(id, tip);
  return `data-tip="${id}"${focusable ? ' tabindex="0"' : ''}`;
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

function frame({ W, m, ph, ticks, y, unit, labels, xAt, now, only }) {
  let out = '';
  for (const v of ticks) {
    const yy = Math.round(y(v)) + 0.5;
    out += `<line class="${v === 0 ? 'axis' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
    out += `<text class="tick" x="${m.l - 6}" y="${yy}" text-anchor="end" dominant-baseline="middle">${fmtTick(v)}${unit}</text>`;
  }
  // 글자가 겹치지 않게 건너뛰되, 가장 최근 날짜는 항상 표시한다
  const widest = Math.max(...labels.map((label) => label.length));
  const fit = Math.max(1, Math.floor((W - m.l - m.r) / (widest <= 1 ? 20 : 36))); // 요일은 날짜보다 좁다
  const stride = Math.ceil(labels.length / fit);
  labels.forEach((label, i) => {
    if (only ? !only.includes(i) : (labels.length - 1 - i) % stride) return;
    const today = now && i === labels.length - 1;
    const anchor = today ? 'end' : only && i === 0 ? 'start' : 'middle';
    out += `<text class="tick${today ? ' now' : ''}" x="${xAt(i)}" y="${m.t + ph + 16}" text-anchor="${anchor}">${esc(today ? now : label)}</text>`;
  });
  return out;
}

/** 이어진 날들을 지나는 부드러운 곡선. 점은 그대로 지나가므로 값이 달라지지 않는다. */
function curve(run) {
  const f = (v) => v.toFixed(1);
  let d = `M${f(run[0][0])},${f(run[0][1])}`;
  for (let i = 0; i < run.length - 1; i++) {
    const [p0, p1, p2, p3] = [run[i - 1] ?? run[i], run[i], run[i + 1], run[i + 2] ?? run[i + 1]];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

const svg = (W, H, body, label) => `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${body}</svg>`;

/** 일별 누적 막대. days: [{ label, title, values: { 영역id: 분 } }], series: [{ id, label, color }] */
export function stackedColumns(el, { days, series, label }) {
  const W = Math.max(200, el.clientWidth);
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
  const W = Math.max(200, el.clientWidth);
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

/**
 * 쌓인 부하 추이. 숫자로 읽지 않도록 세로축 값을 쓰지 않고, 내 평소 범위를 띠로 깐다. 기록이 없는 날은 선을 끊는다.
 * points: [{ label, title, value|null, rows }], marks: 표시한 날의 points 번호, zoneTop: 평소 범위의 위쪽 값
 */
export function zoneChart(el, { points, marks, zoneTop, label }) {
  const W = Math.max(260, el.clientWidth);
  const H = 220;
  const m = { t: 16, r: 20, b: 26, l: 20 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = points.length;
  const values = points.map((p) => p.value).filter((v) => v != null);
  const low = Math.min(-2.5, ...values);
  const high = Math.max(zoneTop + 2, ...values) + 0.3;
  const xAt = (i) => m.l + (n > 1 ? (pw * i) / (n - 1) : pw / 2);
  const y = (v) => m.t + ph - ((v - low) / (high - low)) * ph;

  const base = y(low);
  let body = frame({ W, m, ph, ticks: [], y, unit: '', labels: points.map((p) => p.label), xAt, now: '오늘', only: [0, Math.round((n - 1) / 2), n - 1] });
  body += `<rect class="zone" x="0" y="${y(zoneTop)}" width="${W}" height="${base - y(zoneTop)}"/>`;
  const last = points.findLastIndex((p) => p.value != null);
  const stem = (i) => `M${xAt(i).toFixed(1)},${y(points[i].value).toFixed(1)}V${base}`;
  // 오늘에 가까울수록 밝아지는 막대. 하루 건너 하나만 그려 선이 돋보이게 한다.
  body += `<defs><linearGradient id="stem-fade" gradientUnits="userSpaceOnUse" x1="0" x2="${W}" y1="0" y2="0"><stop offset="0" style="stop-color:var(--axis)"/><stop offset="1" style="stop-color:var(--accent-line);stop-opacity:.45"/></linearGradient></defs>`;
  body += `<path class="stem" stroke="url(#stem-fade)" d="${points.map((p, i) => (p.value == null || i === last || (last - i) % 2 ? '' : stem(i))).join('')}"/>`;
  if (last >= 0) body += `<path class="now-stem" d="${stem(last)}"/>`;
  const runs = [[]];
  points.forEach((p, i) => {
    if (p.value != null) runs.at(-1).push([xAt(i), y(p.value)]);
    else if (runs.at(-1).length) runs.push([]);
  });
  body += `<path class="trend" d="${runs.filter((run) => run.length > 1).map(curve).join('')}"/>`;
  body += `<text class="zone-label" x="${m.l}" y="${y(zoneTop) + 20}">내 평소</text>`;
  // 양옆이 비어 선으로 안 보이는 점은 점으로 표시
  points.forEach((p, i) => {
    if (p.value == null || points[i - 1]?.value != null || points[i + 1]?.value != null) return;
    body += `<circle class="lone" cx="${xAt(i)}" cy="${y(p.value)}" r="3"/>`;
  });
  // 표시한 날에 값이 없으면 가장 가까운 날의 높이에 둔다
  const near = (i) => points.map((p, j) => [Math.abs(j - i), p.value]).filter(([, v]) => v != null).sort((a, b) => a[0] - b[0])[0]?.[1] ?? low;
  const nowAt = last >= 0 ? [xAt(last), y(points[last].value)] : null;
  if (nowAt) body += `<circle class="now-dot" cx="${nowAt[0]}" cy="${nowAt[1]}" r="6"/>`;
  // 오늘 점과 겹치는 동그라미는 속을 비워서 위에 그린다. 그래야 둘 다 보인다
  const overNow = (i) => nowAt && Math.hypot(xAt(i) - nowAt[0], y(near(i)) - nowAt[1]) < 15;
  for (const i of marks) body += `<circle class="mark${overNow(i) ? ' over-now' : ''}" cx="${xAt(i)}" cy="${y(near(i))}" r="6"/>`;
  if (marks.length) {
    const i = Math.max(...marks);
    const before = xAt(i) > 64; // 왼쪽 끝이면 글자가 잘리니 오른쪽에 쓴다
    body += `<text class="mark-label" x="${xAt(i) + (before ? -12 : 12)}" y="${Math.max(12, y(near(i)) - 8)}" text-anchor="${before ? 'end' : 'start'}">지친 날</text>`;
  }
  const half = n > 1 ? pw / (n - 1) / 2 : pw / 2;
  points.forEach((p, i) => {
    const x = xAt(i);
    const dot = p.value == null ? '' : `<circle class="hover-dot" cx="${x}" cy="${y(p.value)}" r="4"/>`;
    body += `<g class="hitg"><line class="xhair" x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ph}"/>${dot}<rect class="hit" x="${x - half}" y="${m.t}" width="${half * 2}" height="${ph}" ${tipAttrs({ title: p.title, rows: p.rows }, false)}/></g>`;
  });
  el.innerHTML = svg(W, H, body, label);
}
