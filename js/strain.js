// 쌓인 부하 추정 모델. 저장된 기록만 입력받는 순수 함수라서, 지난 기록을 고치거나 지친 날을 뒤늦게 표시해도 처음부터 다시 계산된다.
// 계산 결과는 저장하지 않는다. 번아웃을 재는 값이 아니라 '내 평소와의 차이'를 요약한 값이고, 상수의 근거는 docs/evidence.md에 있다.
import { addDays, rangeKeys, sleepHours } from './dates.js';

export const K = {
  LAMBDA: 0.10, T_HIGH: 2, THETA0: 3.0, THETA_MIN: 2.5, THETA_MAX: 4.5,
  K_MEAN: 2, K_SEG: 7, NU0: 14, WIN: 84, GUARD: 14, GUARD_MIN: 42, SKIP: 3,
  S0_R: 0.6, FL_R: 0.4, S0_L: 60, FL_L: 30, S0_U: 0.75, FL_U: 0.4, S0_D: 0.8, FL_D: 0.5,
  RHO: 6 / 7, CREDIT: 1.5, DMAX: 21, V_EX: 0.15, V_DET: 0.10, K_NEED: 14,
  TAIL: 0.10, ON: 3, OFF: 3, COOL: 14, TREND_MIN: 28,
  GAP_UNKNOWN: 4, GAP_RESTART: 14, HOLD_RETURN: 3, HOLD_RESTART: 7, HOLD_SEG: 14,
  MERGE: 14, LOOKBACK: 14, MIN_COVER: 7, K_EVENT: 5, EVENT_GATE: 5,
};
const WEIGHTS = { default: { R: 0.40, L: 0.35, D: 0.25 }, student: { R: 0.40, L: 0.20, D: 0.40 } };
const NEED0 = { u18: 8, adult: 7, senior: 7 };
const TAU = { u18: 210, adult: 75, senior: 75 };

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const num = (x) => (x == null ? NaN : x);
const finite = (a) => a.filter(Number.isFinite);
export function quantile(a, p) {
  const s = Float64Array.from(a).sort();
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
}
const median = (a) => quantile(a, 0.5);
function variance(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
}
const t975 = (nu) => 1.96 + 2.37 / nu + 2.82 / (nu * nu);
export const dayNum = (key) => Date.parse(`${key}T00:00:00Z`) / 864e5;
export const dayKey = (t) => new Date(t * 864e5).toISOString().slice(0, 10);
const isWeekend = (t) => [0, 6].includes(new Date(t * 864e5).getUTCDay());

/** 기본값과 내 기록을 섞는다. 기록이 쌓일수록 내 값의 비중이 커지고, k가 0이면 중심값에는 기본값을 쓰지 않는다. */
function blend(v, mu0, k, s0, nu0, floor) {
  const n = v.length;
  const df = Math.max(0, n - 1);
  const c = n + k > 0 ? ((n ? n * median(v) : 0) + k * mu0) / (n + k) : mu0;
  const s = Math.max(floor, Math.sqrt((nu0 * s0 * s0 + df * variance(v)) / (nu0 + df)));
  return { c, s, n };
}

/** 베타이항분포에서 n일 중 x일 이상 힘든 날이 나올 확률 */
export function tailProb(x, n, a, b) {
  let p = 1;
  let cdf = 0;
  for (let i = 0; i < n; i++) p *= (b + i) / (a + b + i);
  for (let k = 0; k < x; k++) {
    cdf += p;
    p *= ((n - k) / (k + 1)) * ((a + k) / (b + n - k - 1));
  }
  return Math.max(0, 1 - cdf);
}

export const isHard = (d) => (num(d.stress) >= 4) + (num(d.energy) <= 2) + (num(d.mood) <= 2) >= 2;
export const isValid = (e) => finite([num(e.energy), num(e.stress), num(e.mood)]).length >= 2;

/** 앱 상태를 날짜별 한 줄로 펼친다. 활동을 안 쓰는 사람의 빈 날은 0이 아니라 '모름'으로 둔다. */
export function dailyLog(state, today) {
  const kinds = new Map(state.areas.map((a) => [a.id, a.kind]));
  const load = new Map();
  const rec = new Map();
  for (const e of state.entries) {
    const kind = kinds.get(e.areaId);
    if (!kind) continue;
    const map = kind === 'recovery' ? rec : load;
    map.set(e.date, (map.get(e.date) || 0) + e.minutes);
  }
  const usesLog = (date) => rangeKeys(addDays(date, 7), 15).some((k) => load.has(k));
  const dates = new Set([...Object.keys(state.checkins), ...Object.keys(state.sleep), ...load.keys(), ...rec.keys()]);
  return [...dates]
    .filter((date) => date <= today)
    .sort()
    .map((date) => {
      const c = state.checkins[date] || {};
      const night = state.sleep[date] || {};
      // 오늘은 아직 끝나지 않았으니 부하를 빼고 계산한다. 끝난 날은 기록이 없으면 쉰 날이다.
      const loadMin = date === today ? null : load.get(date) ?? (usesLog(date) ? 0 : null);
      return { date, energy: c.energy, stress: c.stress, mood: c.mood, detach: c.detach, sleepQ: night.quality, tibH: sleepHours(night.bed, night.wake), loadMin, loadRaw: load.get(date) || 0, recMin: rec.get(date) || 0 };
    });
}

function episodesAt(t, marks, days, first, loads) {
  const eps = [];
  for (const e of marks) {
    if (e.t > t) break;
    const p = eps[eps.length - 1];
    if (p && e.t - p.t2 <= K.MERGE) {
      p.t2 = e.t;
      p.sev = Math.max(p.sev, e.sev);
      p.fuzz = Math.max(p.fuzz, e.fuzz || 0);
      p.marks.push(e);
    } else eps.push({ t1: e.t, t2: e.t, sev: e.sev, fuzz: e.fuzz || 0, marks: [e] });
  }
  for (const p of eps) {
    const slice = (from, to) => days.slice(Math.max(0, from - first), Math.max(0, to - first + 1));
    const seen = slice(p.t1 - K.LOOKBACK - p.fuzz, Math.min(t, p.t2 + p.fuzz)).filter((d) => d.logged && d.T != null);
    p.level = seen.length >= K.MIN_COVER ? Math.max(...seen.map((d) => d.T)) : null;
    p.visible = p.level != null && p.level >= K.T_HIGH;
    // '얼마나 쌓였을 때 왔는지': 가장 심했던 표시까지의 2주를 그대로 보여준다. 돌아보기로 남긴 약한 표시는 기준으로 삼지 않는다.
    const real = p.marks.filter((m) => !m.soft);
    const pool = real.length ? real : p.marks;
    const top = Math.max(...pool.map((m) => m.sev));
    const anchor = pool.filter((m) => m.sev === top).at(-1).t;
    const from = anchor - K.LOOKBACK + 1;
    const window = slice(from, anchor);
    const before = window.filter((d) => d.logged);
    const slept = window.filter((d) => d.slept);
    let loadMin = 0;
    for (let day = from; day <= anchor; day++) loadMin += loads.byDay.get(day) || 0;
    p.logged = before.length;
    p.hardDays = before.filter((d) => d.hard).length;
    p.debtH = slept.length ? Math.max(...slept.map((d) => d.debt)) : null;
    // 달력 기준으로 더한다. 기록한 날의 평균에 7을 곱하면 쉰 주말까지 일한 것처럼 부풀려진다.
    // 앱을 쓰기 전의 날은 쉰 날이 아니니 뺀다. 며칠뿐이면 한 주로 친다.
    const span = Math.max(7, anchor - Math.max(from, loads.first) + 1);
    p.loadHoursPerWeek = loadMin ? loadMin / 60 / (span / 7) : null;
  }
  return eps;
}

/** 표시나 회복 중인 기간이 이 높았던 구간과 겹치면 '표시 없이 지나간 때'가 아니다 */
const covers = (e, f) => e.t <= f.to + K.COOL && (e.closedOn ? dayNum(e.closedOn) : e.sev >= 2 ? Infinity : e.t) >= f.from - K.LOOKBACK;

function thetaAt(t, marks, days, first, spans, loads) {
  const vis = marks.length ? episodesAt(t, marks, days, first, loads).filter((p) => p.visible) : [];
  const nEff = vis.reduce((s, p) => s + (p.sev === 1 ? 0.5 : 1), 0);
  let theta = K.THETA0;
  if (nEff >= K.EVENT_GATE) {
    const q25 = quantile(vis.map((p) => Math.min(p.level, 6)), 0.25);
    theta = (K.K_EVENT * K.THETA0 + nEff * q25) / (K.K_EVENT + nEff);
  }
  const quiet = spans.filter((f) => f.to != null && !f.cut && t - f.to > K.COOL && t - f.from <= 180 && !marks.some((e) => covers(e, f))).length;
  return { theta: clamp(theta + 0.25 * Math.min(quiet, 2), K.THETA_MIN, K.THETA_MAX), nEff, quiet };
}

/** 평소를 계산할 기록: 최근 2주와 힘들었던 날을 빼서, 서서히 지쳐가는 동안의 기록이 평소로 굳지 않게 한다 */
function baseline(hist, t, seg, segCount) {
  const base = [];
  const recent = [];
  for (let i = hist.length - 1; i >= 0 && hist[i].seg === seg && base.length < K.WIN; i--) {
    const h = hist[i];
    if (!h.ok) continue;
    if (segCount < K.GUARD_MIN || h.t <= t - K.GUARD) base.push(h);
    else recent.push(h);
  }
  // 회복 중이던 날을 빼면 최근 2주밖에 남지 않을 수 있다. 그때는 최근 2주라도 평소로 쓴다.
  return base.length >= K.MIN_COVER ? base : [...recent, ...base];
}

/**
 * log: dailyLog의 결과. events: 지친 날 { date, sev, fuzz, closedOn } 또는 새 평소 { date, rebase: true, closedOn }.
 * profile: { role, age, sleepGoal }.
 */
export function derive(log, events, profile, today) {
  const all = new Map(log.map((e) => [dayNum(e.date), e]));
  const byDay = new Map([...all].filter(([, e]) => isValid(e)));
  const last = dayNum(today);
  // 평점 없이 수면만 남긴 날부터 세어야 수면 부족이 쌓인다
  const nights = [...all].filter(([, e]) => Number.isFinite(num(e.tibH))).map(([t]) => t);
  const first = byDay.size || nights.length ? Math.min(...byDay.keys(), ...nights) : last + 1;
  const loadDays = [...all].filter(([, e]) => e.loadRaw > 0);
  const loads = { byDay: new Map(loadDays.map(([t, e]) => [t, e.loadRaw])), first: loadDays.length ? Math.min(...loadDays.map(([t]) => t)) : Infinity };
  const ev = events.map((e) => ({ ...e, t: dayNum(e.date) })).sort((a, b) => a.t - b.t);
  const marks = ev.filter((e) => !e.rebase);
  const segEnds = ev.filter((e) => (e.sev === 3 || e.rebase) && e.closedOn).map((e) => ({ t: dayNum(e.closedOn), rebase: !!e.rebase })).sort((a, b) => a.t - b.t);
  const w = WEIGHTS[profile.role === 'student' ? 'student' : 'default'];
  const prior = NEED0[profile.age] ?? NEED0.adult;
  // 목표를 권장량보다 높게 잡았다면 그 목표를 따르고, 낮게 잡았다면 권장량에서 시작한다
  const need0 = clamp(profile.sleepGoal ?? prior, prior, prior + 2);
  const tau = TAU[profile.age] ?? TAU.adult;
  const hist = [];
  const days = [];
  const flags = [];
  const spans = []; // 높았던 구간 { from, to }
  const rec7 = [];
  let S = 0;
  let D = 0;
  let need = need0;
  let lastNight = -Infinity;
  let ownNeed = null; // 새 구간에서 평소가 다시 쌓일 때까지 이어 쓰는, 그 전까지 배운 필요 수면
  let count = 0;
  let segCount = 0;
  let okCount = 0; // 평소가 될 수 있는 날의 수. 적으면 비교하지 않는다.
  let lastT = null;
  let flagged = false;
  let offRun = 0;
  let onRun = 0;
  let cool = 0;
  let hold = 0;
  let seg = 0;
  let segRebase = false;
  let hadUsual = true; // 이 구간 전에 평소가 있었는지
  let settle = false; // 심한 표시를 닫은 첫 기록에서 쌓인 값의 상한을 잡는다
  let spreadU = K.S0_U; // 새 구간에서도 내 흩어진 정도를 이어 쓴다
  let lastSpread = K.S0_U;
  let priorC = 3;
  let kC = K.K_MEAN;
  let lastC = 3;
  let sinceRestart = K.HOLD_RESTART + 1;
  let restartFor = K.HOLD_RESTART;

  const endFlag = (t, cut = false) => {
    if (flagged) Object.assign(spans.at(-1), { to: t, cut });
    flagged = false;
  };
  const addNight = (tib, t) => {
    const short = need - tib;
    D = clamp(K.RHO * D + (short > 0 ? short : -Math.min(K.CREDIT, -short)), 0, K.DMAX);
    lastNight = t;
  };

  for (let t = first; t <= last; t++) {
    const d = byDay.get(t);
    rec7.push(all.get(t)?.recMin || 0); // 컨디션을 안 남긴 날의 운동도 회복으로 친다
    if (rec7.length > 7) rec7.shift();
    if (cool > 0) cool--;
    const gap = t - (lastT ?? first);
    if (gap === K.GAP_UNKNOWN) {
      hold = Math.max(hold, K.HOLD_RETURN);
      onRun = 0;
    }
    if (gap === K.GAP_RESTART) {
      S = 0;
      endFlag(t, true); // 기록이 끊겨 끝난 것이지, 표시 없이 지나간 것이 아니다
      hold = Math.max(hold, K.HOLD_RESTART);
      onRun = 0;
      sinceRestart = 0;
      restartFor = Math.max(K.HOLD_RESTART, hold);
    }
    if (gap >= K.GAP_RESTART && t - lastNight >= K.GAP_RESTART) D = 0;
    if (!d) {
      const night = num(all.get(t)?.tibH);
      if (Number.isFinite(night)) addNight(night, t); // 평점을 못 남긴 날의 잠도 수면 부족에는 더한다
      days.push({ t, logged: false, known: gap < K.GAP_UNKNOWN, T: null, slept: Number.isFinite(night), debt: D });
      continue;
    }
    lastT = t;
    count++;
    sinceRestart++;
    const ended = segEnds.filter((c) => c.t < t);
    const nowSeg = ended.length;
    if (nowSeg !== seg) {
      seg = nowSeg;
      segCount = 0;
      priorC = lastC;
      segRebase = ended.at(-1).rebase;
      hadUsual = okCount >= K.MIN_COVER;
      spreadU = lastSpread;
      kC = segRebase || !hadUsual ? K.K_MEAN : K.K_SEG; // 새 평소라고 답했거나 옛 평소가 없었다면 오래 묶어두지 않는다
      hold = K.HOLD_SEG;
      endFlag(t);
      onRun = 0;
      if (segRebase) {
        // 옛 평소 기준으로 쌓인 값은 버리고, 새 평소가 잡히는 동안에는 비교한다고 말하지 않는다
        S = 0;
        sinceRestart = 1;
        restartFor = K.HOLD_SEG;
      } else settle = hadUsual;
    }
    const energy = num(d.energy);
    const stress = num(d.stress);
    const mood = num(d.mood);
    const sleepQ = num(d.sleepQ);
    const comp = mean(finite([6 - energy, stress, 6 - mood, 6 - sleepQ]));
    const hard = isHard(d);
    const tib = num(d.tibH);
    const det = num(d.detach);
    const loadMin = num(d.loadMin);

    const base = baseline(hist, t, seg, segCount);
    segCount++;
    const thin = okCount < K.MIN_COVER;
    const bR = blend(base.map((h) => h.comp), priorC, kC, K.S0_R, K.NU0, K.FL_R);
    lastC = bR.c;
    const zR = clamp((comp - bR.c) / bR.s, -3, 3);

    need = need0;
    let needOwn = false;
    if (base.length >= K.TREND_MIN) {
      const en = median(finite(base.map((h) => h.energy)));
      const good = finite(base.filter((h) => h.energy >= en).map((h) => h.tib));
      if (good.length) {
        need = clamp((K.K_NEED * need0 + good.length * median(good)) / (K.K_NEED + good.length), need0 - 1, need0 + 2);
        needOwn = true;
        ownNeed = need;
      }
    }
    if (!needOwn && ownNeed != null) {
      need = ownNeed;
      needOwn = true;
    }
    if (Number.isFinite(tib)) addNight(tib, t);
    const zD = Number.isFinite(tib) ? clamp(D / 7, 0, 3) : null;

    const wknd = isWeekend(t);
    const lv = finite(base.filter((h) => h.wknd === wknd).map((h) => h.loadMin));
    let zL = null;
    if (Number.isFinite(loadMin) && lv.length >= 4) {
      const bL = blend(lv, 0, 0, K.S0_L, K.NU0, K.FL_L);
      zL = clamp((loadMin - bL.c) / bL.s, -3, 3);
    }
    let sum = w.R * zR;
    let wSum = w.R;
    if (zL != null) {
      sum += w.L * zL;
      wSum += w.L;
    }
    if (zD != null) {
      sum += w.D * zD;
      wSum += w.D;
    }

    const R7 = rec7.reduce((a, b) => a + b, 0);
    let V = K.V_EX * (1 - Math.exp(-R7 / tau));
    if (Number.isFinite(det)) {
      const bD = blend(finite(base.map((h) => h.det)), 3, K.K_MEAN, K.S0_D, K.NU0, K.FL_D);
      V += (K.V_DET * clamp((det - bD.c) / bD.s, 0, 2)) / 2;
    }
    const U = sum / wSum - V;

    const bU = blend(base.map((h) => h.U), 0, 0, spreadU, K.NU0, K.FL_U);
    if (base.length >= K.TREND_MIN) lastSpread = bU.s;
    const n = base.length;
    const g = (t975(n + K.NU0 - 1) / 1.96) * Math.sqrt(1 + 1 / Math.max(n, 1));
    const se = bU.s * Math.sqrt(K.LAMBDA / (2 - K.LAMBDA)) * g;
    // 괜찮아졌다고 답했으니 지난 일의 무게로 다시 알리지 않되, 힘든 날이 이어지면 바로 쌓이도록 값은 남겨둔다
    if (settle) S = Math.min(S, K.THETA0 * se);
    settle = false;
    if (hist.length >= K.SKIP && !(segRebase && segCount <= K.HOLD_SEG)) S = (1 - K.LAMBDA) * S + K.LAMBDA * U;
    if (thin) S = 0; // 비교할 평소가 없는 동안에는 쌓을 기준도 없다
    S = Math.max(S, -2 * se); // 긴 휴가로 부하를 미리 깎아둘 수는 없다
    const T = S / se;

    let x = hard ? 1 : 0;
    let m = 1;
    for (let i = hist.length - 1; i >= 0 && hist[i].t > t - 14; i--) {
      x += hist[i].hard ? 1 : 0;
      m++;
    }
    const hits = base.filter((h) => h.hard).length;
    const tail = m >= 10 ? tailProb(x, m, 1 + hits, 4 + base.length - hits) : 1;

    const { theta } = thetaAt(t, marks, days, first, spans, loads);
    onRun = T >= theta ? onRun + 1 : 0;
    if (!flagged && !thin && count >= K.TREND_MIN && hold === 0 && cool === 0 && onRun >= K.ON && tail <= K.TAIL) {
      flagged = true;
      offRun = 0;
      flags.push(t);
      spans.push({ from: t, to: null });
    } else if (flagged) {
      offRun = T < K.T_HIGH ? offRun + 1 : 0;
      if (offRun >= K.OFF) {
        endFlag(t);
        cool = K.COOL;
      }
    }
    if (hold > 0) hold--;
    const during = (e) => e.sev >= 2 && e.t <= t && (!e.closedOn || dayNum(e.closedOn) >= t);
    const recovering = marks.some(during);
    // 새 평소로 삼았다면 그 전에 시작한 일 때문에 평소를 비워두지 않는다
    const since = ended.filter((c) => c.rebase).at(-1)?.t ?? -Infinity;
    const resting = marks.some((e) => e.t > since && during(e));
    // 심했던 일을 닫은 직후의 힘든 날은 평소가 아니다. 다시 힘들어졌는데 평소로 굳으면 알아볼 수 없다.
    const relapse = hard && seg > 0 && !segRebase && hadUsual && segCount <= K.HOLD_SEG;
    const ok = hist.length >= K.SKIP && !flagged && !resting && !relapse;
    if (ok) okCount++;
    hist.push({ t, seg, comp, hard, U, energy, stress, mood, tib, det, loadMin, wknd, ok });
    let band = T >= K.T_HIGH ? 'higher' : 'usual';
    if (flagged) band = 'sustained';
    if (sinceRestart <= restartFor) band = 'restart'; // 다시 시작했을 뿐, 회복했다는 뜻이 아니다
    if (thin || count < K.TREND_MIN) band = 'building';
    days.push({
      t, logged: true, known: true, thin, T: count >= K.TREND_MIN && !thin ? T : null, S, U, zR, zL, zD, V, comp, hard,
      debt: D, slept: Number.isFinite(tib), need, needOwn, loadMin, hardCount: x, hardWindow: m, tail, theta, flagged, recovering, resting, band,
    });
  }
  const line = thetaAt(last, marks, days, first, spans, loads);
  return {
    days, flags, hist, entries: count, need0, seg, segCount, debt: D, sleepKnown: last - lastNight < K.GAP_RESTART, ...line,
    base: baseline(hist, last + 1, seg, segCount),
    episodes: episodesAt(last, marks, days, first, loads),
  };
}
