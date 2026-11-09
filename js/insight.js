// 쌓인 부하 모델의 결과를 화면에 쓸 말과 숫자로 바꾼다. 화면은 여기서 나온 값만 쓴다.
import { results, supportFrom } from './bat.js';
import { addDays, rangeKeys } from './dates.js';
import { dailyLog, dayKey, dayNum, derive, isHard, isValid, K, quantile } from './strain.js';
import { avg, fmt1, fmtHours, sum } from './util.js';

export const MILESTONES = [7, 14, 28, 60];
export const BANDS = {
  usual: '내 평소 범위예요',
  higher: '평소보다 조금 높아요',
  sustained: '한동안 평소보다 높아요',
  restart: '다시 시작했어요',
  building: '평소를 알아가는 중이에요',
};
const SLEEP_BAND = '수면이 부족한 쪽이에요';
export const bandWord = (i) => (i.sleepOnly ? SLEEP_BAND : BANDS[i.band]);
export const SEVERITY = {
  1: '많이 지쳤지만 할 일은 했어요',
  2: '할 일을 미루거나 줄였어요',
  3: '일상을 멈춰야 했어요',
};
const SUPPORT_GAP = 14 * 864e5;

const finite = (a) => a.filter(Number.isFinite);

/** 정수 평점의 가운데와 가운데 절반 범위. 평점에는 소수를 쓰지 않는다. */
function middle(values) {
  const v = finite(values);
  if (!v.length) return null;
  return { mid: Math.round(quantile(v, 0.5)), lo: Math.round(quantile(v, 0.25)), hi: Math.round(quantile(v, 0.75)) };
}

/** 돌아보기에서 '많이 쌓였다'고 답한 주는 약한 표시로 친다. 답을 고치면 함께 바뀌도록 저장하지 않고 그때그때 만든다. */
const softMarks = (state) =>
  Object.entries(state.weekly)
    .filter(([, w]) => w.built === 5 && w.on)
    .map(([week, w]) => ({ date: w.on, sev: 1, fuzz: 3, soft: true, week }));

/** 마지막 기록부터 거슬러 올라가며 test를 만족한 날이 며칠째인지 센다. 하루이틀 빠진 날은 끊긴 것으로 보지 않는다. */
function runDays(days, test, since = -Infinity) {
  let start = null;
  let end = null;
  for (let i = days.length - 1; i >= 0 && days[i].t > since; i--) {
    if (!days[i].logged) continue;
    if (start != null && start - days[i].t >= K.GAP_UNKNOWN) break; // 며칠 끊겼다면 그 사이가 이어졌다고 볼 수 없다
    if (!test(days[i])) break;
    start = days[i].t;
    end ??= start;
  }
  return start == null ? 0 : end - start + 1;
}

/** 추세가 없는 날에 무엇이 저장돼 있는지 */
function savedKind(e) {
  if (!e) return null;
  return e.energy || e.stress || e.mood ? 'few' : 'other';
}

/** 수면 안내는 나이와, 안내가 나온 이유인 필요한 수면에 맞춘다 */
function sleepGuide(state, need) {
  if (state.profile.age === 'u18') return '14~17세 권장은 8시간 이상이에요.';
  return need > 7.5 ? `필요한 수면으로 잡은 ${fmtHours(need)}보다 적어요.` : '성인 권장은 7시간 이상이에요.';
}

function contextNotes(state, ctx) {
  const { today, lastDays, log, need } = ctx;
  const notes = [];
  const sleep = finite(lastDays(7).map((e) => e.tibH));
  if (sleep.length >= 5) {
    const mean = avg(sleep);
    if (mean <= 6 || mean <= need - 1) notes.push(`최근 7일 평균 수면이 ${fmtHours(mean)}이에요. ${sleepGuide(state, need)}`);
  }
  const rawLoad = (keys) => sum(keys.map((k) => ctx.byDate.get(k)?.loadRaw || 0), (x) => x);
  const longDay = [today, addDays(today, -1)].find((k) => rawLoad([k]) >= 720);
  if (longDay) notes.push(`${longDay === today ? '오늘' : '어제'} 기록한 부하가 12시간을 넘었어요.`);
  if (state.profile.role === 'worker') {
    const keys = rangeKeys(today, 28);
    const active = keys.filter((k) => ctx.byDate.get(k)?.loadRaw).length;
    const week = rawLoad(keys) / 4 / 60;
    const shown = fmt1(Math.ceil(week * 10) / 10);
    if (active >= 14 && week >= 55) notes.push(`최근 4주 기록이 주 평균 ${shown}시간이에요. 일하는 시간이 이만큼 오래 이어지면 건강에 좋지 않다고 보고됐어요. 연구는 일한 시간을 봤고, 이 숫자는 기록한 시간 기준이에요. 자세한 내용은 아래 계산 근거에 있어요.`);
    else if (active >= 14 && week > 52) notes.push(`최근 4주 기록이 주 평균 ${shown}시간으로, 주 52시간(40시간 + 연장 12시간)보다 많아요. 기록한 시간 기준이에요.`);
  }
  if (log[0] && log[0].date <= addDays(today, -91)) {
    const recent = rawLoad(rangeKeys(today, 7));
    const before = rawLoad(rangeKeys(addDays(today, -7), 84)) / 12;
    if (before > 0 && recent >= before * 1.3) notes.push('이번 7일 기록이 지난 12주 평균보다 30% 이상 많아요.');
  }
  return notes;
}

function helped(state, ctx) {
  const week = ctx.lastDays(7);
  const out = [];
  const rec = sum(week, (e) => e.recMin);
  if (rec) out.push(`회복 활동 ${rec}분`);
  const slept = week.filter((e) => e.tibH >= ctx.need).length;
  if (slept) out.push(`필요한 만큼 잔 밤 ${slept}일`);
  const off = week.filter((e) => e.detach >= 4).length;
  if (off) out.push(`할 일 생각에서 벗어난 날 ${off}일`);
  const light = week.filter((e) => isValid(e) && !isHard(e)).length;
  if (light) out.push(`무난하게 지나간 날 ${light}일`);
  return out;
}

/** 안내 문구는 무엇이 기록됐는지를 말한다. 일어날 일을 말하지 않고, 하나를 덜어내는 제안만 한다. */
function flagCard(ctx) {
  const { recent, usualSleep, lastDays, usualLoad, sleepOnly } = ctx;
  const lead = recent.hard ? `지난 14일 중 ${recent.hard}일이 힘든 날이었` : `지난 14일 중 ${recent.logged}일을 기록했`;
  const sleep = avg(finite(lastDays(7).map((e) => e.tibH)));
  const load = avg(finite(lastDays(8).map((e) => e.loadMin)));
  const shortSleep = sleep != null && usualSleep != null && sleep < usualSleep - 0.25;
  const heavy = load != null && usualLoad != null && load > usualLoad * 1.15;
  if (sleepOnly) return { text: `최근 7일 평균 수면이 ${fmtHours(sleep)}으로, 필요한 수면보다 적은 날이 이어졌어요.`, idea: '오늘은 평소보다 30분만 일찍 누워보세요.' };
  let text = `${lead}어요.`;
  if (shortSleep) text = `${lead}고, 수면은 평소보다 적었어요.`;
  else if (heavy) text = `${lead}고, 부하는 평소보다 많았어요.`;
  let idea = '오늘 할 일 중 하나만 내일로 미뤄보세요.';
  if (shortSleep) idea = '오늘은 평소보다 30분만 일찍 누워보세요.';
  else if (heavy) idea = '이번 주 일정에서 하나만 빼보세요.';
  return { text, idea };
}

function supportCard(state, ctx) {
  const { today, days, gap, lastDays } = ctx;
  const seen = state.supportSeen;
  if (state.marks.some((m) => m.sev === 3 && !m.closedOn && m.createdAt > seen)) {
    return { id: 'H3', text: '일상을 멈춰야 했던 날을 남겨주셨네요. 혼자 버티지 않아도 괜찮아요. 누군가와 이야기해 보는 것도 도움이 될 수 있어요.' };
  }
  if (Date.now() - seen < SUPPORT_GAP) return null;
  const talk = '누군가와 이야기해 보는 것도 도움이 될 수 있어요.';
  // 한 달 체크를 숨겼거나 열 수 없게 바뀐 사람에게는 그 체크를 들어 말하지 않는다
  const { role, age, monthlyOff } = state.profile;
  const bat = role === 'worker' && age !== 'u18' && !monthlyOff ? supportFrom(results(state.monthly ?? {}), today) : null;
  if (bat === 'once') return { id: 'H4', text: `이번 한 달 체크에서 일하면서 힘든 순간이 적지 않다고 답해 주셨네요. ${talk}` };
  if (bat === 'twice') return { id: 'H4', text: `지난 두 번의 한 달 체크 모두 일하면서 힘든 순간이 적지 않다고 답해 주셨네요. ${talk}` };
  const low = lastDays(14).filter(isValid);
  if (low.length >= 10 && low.filter((e) => e.mood <= 2 || e.energy <= 2).length / low.length >= 0.75) return { id: 'H1', text: `기운이나 기분이 낮은 날이 이어졌네요. ${talk}` };
  if (gap < K.GAP_UNKNOWN && ctx.recent.hard && runDays(days, (d) => d.flagged) >= 14) return { id: 'H2', text: `요즘 쉽지 않은 날이 이어진 것 같아요. ${talk}` };
  const open = state.marks.filter((m) => m.sev >= 2 && !m.closedOn).map((m) => m.date).sort()[0];
  if (open && open <= addDays(today, -28)) return { id: 'H5', text: `회복 중 표시가 이어지고 있어요. 괜찮아졌다면 지친 날 칸에서 이제 괜찮아졌어요를 눌러주세요. 아직 힘들다면 ${talk}` };
  const sleep = finite(lastDays(7).map((e) => e.tibH));
  if (state.profile.age === 'u18' && sleep.length >= 5 && avg(sleep) < 5) return { id: 'H6', text: `잠이 많이 부족한 날이 이어졌네요. ${talk}` };
  return null;
}

function episodeView(p) {
  const real = p.marks.filter((m) => m.id);
  return {
    from: dayKey(p.t1),
    to: dayKey(p.t2),
    sev: p.sev,
    fuzz: real.length ? Math.max(...real.map((m) => m.fuzz || 0)) : p.fuzz, // 정확하다고 남긴 날이 돌아보기 때문에 어림으로 바뀌지 않게 한다
    ids: real.map((m) => m.id),
    weeks: p.marks.filter((m) => m.week).map((m) => m.week),
    dates: p.marks.map((m) => dayKey(m.t)),
    marks: real,
    count: p.marks.length,
    open: real.some((m) => m.sev >= 2 && !m.closedOn),
    tags: [...new Set(real.map((m) => m.tag).filter(Boolean))],
    level: p.level,
    visible: p.visible,
    logged: p.logged,
    hardDays: p.hardDays,
    debtH: p.debtH,
    loadHoursPerWeek: p.loadHoursPerWeek,
  };
}

/** 표시가 3번 이상이면 그때마다 얼마나 쌓였는지를 범위로 묶는다. 규칙이라고 말할 수는 없는 개수다. */
function overlay(episodes) {
  const seen = episodes.filter((e) => e.level != null && e.logged >= 3);
  if (seen.length < 3) return null;
  const range = (pick) => {
    const v = finite(seen.map(pick));
    return v.length ? { lo: Math.min(...v), hi: Math.max(...v) } : null;
  };
  return { count: seen.length, hard: range((e) => e.hardDays), debt: range((e) => e.debtH), load: range((e) => e.loadHoursPerWeek) };
}

export function insight(state, today) {
  const log = dailyLog(state, today);
  const byDate = new Map(log.map((e) => [e.date, e]));
  const model = derive(log, [...state.marks, ...softMarks(state)], { ...state.profile, sleepGoal: state.sleepGoal }, today);
  const { days, hist, entries } = model;
  const logged = days.filter((d) => d.logged);
  const last = logged.at(-1) ?? null;
  const gap = last ? dayNum(today) - last.t : null;
  const lastDays = (n) => rangeKeys(today, n).map((k) => byDate.get(k)).filter(Boolean);
  // 평소를 새로 잡는 동안에는 힘들었던 때가 평소로 보이지 않도록 그 전 평소를 보여준다
  const noUsual = !!last?.thin;
  const okDays = hist.filter((h) => h.ok);
  const held = noUsual && hist.length - K.SKIP > okDays.length; // 회복 중이라 평소에서 뺀 날이 있다
  const calm = okDays.filter((h) => h.seg < model.seg).slice(-K.WIN);
  const rebuilding = model.seg > 0 && model.base.length < K.TREND_MIN && calm.length > 0;
  let pool = hist;
  if (!noUsual) pool = rebuilding ? calm : model.base.length ? model.base : hist;
  const recentDays = lastDays(14).filter(isValid);
  const recent = {
    logged: recentDays.length,
    hard: recentDays.filter(isHard).length,
    days: rangeKeys(today, 14).map((k) => (byDate.has(k) && isValid(byDate.get(k)) ? isHard(byDate.get(k)) : null)), // 기록이 없는 날은 null
  };
  const need = last?.need ?? model.need0;
  const usualSleep = finite(pool.map((h) => h.tib));
  const usualLoad = finite(pool.map((h) => h.loadMin));
  let status = 'trend';
  if (!entries) status = 'empty';
  else if (gap >= K.GAP_RESTART) status = 'restart';
  else if (gap >= K.GAP_UNKNOWN) status = 'unknown';
  else if (held && entries >= 7) status = 'noUsual';
  else if (entries < K.TREND_MIN) status = 'building';
  // 수면은 내 평소가 아니라 필요한 양과 비교해서, 늘 적게 자면 다른 기록이 그대로여도 높게 나온다
  const nights = finite(lastDays(7).map((e) => e.tibH));
  const shortNow = nights.length >= 5 && avg(nights) < need - 0.5;
  const near = (n, limit) =>
    ['zR', 'zL'].every((key) => {
      const v = finite(logged.slice(-n).map((d) => d[key]));
      return !v.length || avg(v) <= limit;
    });
  const shortAlone = shortNow && model.debt / 7 > 0.5;
  const elevated = last?.band === 'higher' || last?.band === 'sustained';
  // 막 힘들어지기 시작한 때를 수면 탓으로 돌리지 않도록 최근 7개도 조금 느슨하게 본다
  const sleepOnly = status === 'trend' && elevated && shortAlone && near(14, 0.5) && near(7, 0.8);
  const ctx = {
    today, log, byDate, days, gap, lastDays, recent, need, sleepOnly,
    usualSleep: usualSleep.length ? quantile(usualSleep, 0.5) : null,
    usualLoad: usualLoad.length ? quantile(usualLoad, 0.5) : null,
  };

  const flagged = status === 'trend' && !!last?.flagged;

  const rebases = state.marks.filter((m) => m.rebase).map((m) => dayNum(m.date));
  const dayAt = new Map(days.map((d) => [dayKey(d.t), d]));
  const episodes = model.episodes.map(episodeView).reverse();
  // 새 구간의 시작값은 기본값이 아니라 내 예전 평소이므로 지난 구간의 기록도 내 기록으로 친다
  const n = status === 'noUsual' ? 0 : okDays.length;
  return {
    status,
    band: status === 'trend' ? last.band : null,
    sleepOnly,
    rebuilding,
    guarded: model.segCount >= K.GUARD_MIN && model.base.every((h) => h.t <= dayNum(today) + 1 - K.GUARD),
    noUsual,
    savedDays: log.filter((e) => e.energy || e.stress || e.mood || e.detach || e.sleepQ || e.tibH != null || e.loadRaw || e.recMin || e.otherMin).length,
    entries,
    gap,
    last,
    flagged,
    flag: flagged ? flagCard(ctx) : null,
    recent,
    usual: {
      energy: middle(pool.map((h) => h.energy)),
      stress: middle(pool.map((h) => h.stress)),
      mood: middle(pool.map((h) => h.mood)),
      sleep: ctx.usualSleep,
      load: ctx.usualLoad,
    },
    debt: model.sleepKnown ? model.debt : null,
    notes: contextNotes(state, ctx),
    helped: helped(state, ctx),
    support: supportCard(state, ctx),
    newNormal: status === 'trend' && logged.slice(-7).filter((d) => d.T >= K.T_HIGH).length >= 5 && !(shortAlone && near(28, 0.5)) && runDays(days, (d) => d.flagged || d.resting, Math.max(-Infinity, ...rebases)) >= 56,
    trend: rangeKeys(today, 60).map((key) => {
      const d = dayAt.get(key);
      return { key, band: d?.band ?? null, T: d?.T ?? null, hardCount: d?.hardCount, hardWindow: d?.hardWindow, debt: d?.slept ? d.debt : null, saved: savedKind(byDate.get(key)) };
    }),
    episodes,
    overlay: overlay(episodes),
    theta: model.theta,
    personal: {
      own: n / (n + K.K_MEAN),
      nEff: model.nEff,
      gate: K.EVENT_GATE,
      eventOwn: model.nEff >= K.EVENT_GATE ? model.nEff / (K.K_EVENT + model.nEff) : 0,
      quiet: model.quiet,
      line: Math.sign(Math.round((model.theta - K.THETA0) * 100)),
      need,
      need0: model.need0,
      showNeed: !!last?.needOwn,
    },
  };
}
