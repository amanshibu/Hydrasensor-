// stats.js — pure aggregations over intake records { id, amount, timestamp }.

const pad = n => String(n).padStart(2, '0');
export const dayKey = d => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
export const keyToDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function groupByDay(intakes) {
  const m = new Map();
  for (const i of intakes) {
    const k = dayKey(i.timestamp);
    let g = m.get(k);
    if (!g) m.set(k, g = { total: 0, items: [] });
    g.total += i.amount;
    g.items.push(i);
  }
  return m;
}

// n consecutive days ending on `end` (inclusive), oldest first.
export function lastNDays(byDay, n, goalFor, end = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(end, -i);
    const key = dayKey(date);
    const total = byDay.get(key)?.total || 0;
    const goal = goalFor(key);
    out.push({ key, date, total, goal, met: total >= goal });
  }
  return out;
}

export function longestRun(days) {
  let best = 0, cur = 0;
  for (const d of days) { cur = d.met ? cur + 1 : 0; best = Math.max(best, cur); }
  return best;
}

export function summarize(days) {
  const n = days.length || 1;
  const sum = days.reduce((a, d) => a + d.total, 0);
  const met = days.filter(d => d.met).length;
  const best = days.reduce((b, d) => (!b || d.total > b.total ? d : b), null);
  return {
    sum, n, met,
    avg: Math.round(sum / n),
    best,
    hitRate: Math.round((met / n) * 100),
    active: days.filter(d => d.total > 0).length,
    longestStreak: longestRun(days),
  };
}

export function currentStreak(byDay, goalFor, today = new Date()) {
  let streak = 0;
  for (let d = addDays(today, -1); ; d = addDays(d, -1)) {
    const k = dayKey(d);
    if ((byDay.get(k)?.total || 0) >= goalFor(k)) streak++;
    else break;
  }
  const tk = dayKey(today);
  if ((byDay.get(tk)?.total || 0) >= goalFor(tk)) streak++;
  return streak;
}

export function daySummary(items, goal) {
  const sorted = [...items].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const hourly = new Array(24).fill(0);
  let gap = 0;
  sorted.forEach((it, i) => {
    hourly[new Date(it.timestamp).getHours()] += it.amount;
    if (i) gap = Math.max(gap, new Date(it.timestamp) - new Date(sorted[i - 1].timestamp));
  });
  const total = sorted.reduce((s, i) => s + i.amount, 0);
  return {
    total,
    pct: goal ? total / goal : 0,
    count: sorted.length,
    first: sorted[0]?.timestamp,
    last: sorted[sorted.length - 1]?.timestamp,
    longestGapMin: Math.round(gap / 60000),
    avgSip: sorted.length ? Math.round(total / sorted.length) : 0,
    hourly,
    items: sorted,
  };
}

export const PARTS = ['Morning', 'Afternoon', 'Evening', 'Night'];
const partOf = h => (h >= 5 && h < 12 ? 0 : h >= 12 && h < 17 ? 1 : h >= 17 && h < 22 ? 2 : 3);

export function timeOfDay(byDay, keys) {
  const out = [0, 0, 0, 0];
  for (const k of keys) for (const i of byDay.get(k)?.items || []) out[partOf(new Date(i.timestamp).getHours())] += i.amount;
  return out;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function weekdayAverages(days) {
  const sum = new Array(7).fill(0), cnt = new Array(7).fill(0);
  for (const d of days) { const w = (d.date.getDay() + 6) % 7; sum[w] += d.total; cnt[w]++; }
  return sum.map((s, i) => (cnt[i] ? Math.round(s / cnt[i]) : 0));
}

// Average per day for each calendar month that overlaps `days`.
export function monthlyAverages(days) {
  const m = new Map();
  for (const d of days) {
    const k = `${d.date.getFullYear()}-${d.date.getMonth()}`;
    const g = m.get(k) || { date: d.date, sum: 0, n: 0 };
    g.sum += d.total; g.n++;
    m.set(k, g);
  }
  return [...m.values()].map(g => ({ date: g.date, avg: Math.round(g.sum / g.n), days: g.n }));
}
