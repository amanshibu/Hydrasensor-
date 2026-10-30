// hydration-model.js — weather-aware water-need estimate + a personal habit model learned on-device.

export const ACTIVITY = { sedentary: 1, light: 1.15, moderate: 1.3, active: 1.5 };
export const CONDITION_ML = { none: 0, pregnant: 300, breastfeeding: 700 };
export const MIN_DAYS = 7;

const r10 = n => Math.round(n / 10) * 10;
const r50 = n => Math.round(n / 50) * 50;

export function baseNeed(user) {
  return r10(user.weight * 35 * (ACTIVITY[user.activity] || 1)) + (CONDITION_ML[user.condition] || 0);
}

// w: { feels (peak feels-like °C), humidity (%), uv } — any may be missing.
export function weatherFactors(w) {
  if (!w || w.feels == null) return [];
  const out = [];
  if (w.feels > 24) out.push({ label: `Feels like ${Math.round(w.feels)}°C`, ml: r10(Math.min(700, (w.feels - 24) * 25)) });
  if (w.humidity != null && w.humidity < 30) out.push({ label: `Dry air (${Math.round(w.humidity)}%)`, ml: 150 });
  else if (w.humidity > 70 && w.feels > 26) out.push({ label: `Humid heat (${Math.round(w.humidity)}%)`, ml: 150 });
  if (w.uv >= 6) out.push({ label: `High UV (${Math.round(w.uv)})`, ml: 100 });
  return out;
}

export function predictNeed(user, w) {
  const base = baseNeed(user);
  const factors = weatherFactors(w);
  const extra = Math.min(1000, factors.reduce((s, f) => s + f.ml, 0));
  return { base, factors, extra, total: r50(base + extra) };
}

// Ridge-regularised linear regression: intake ~ feels-like + humidity + weekend.
// samples: [{ feels, humidity, weekend, total }]
const feat = s => [1, s.feels - 20, ((s.humidity ?? 50) - 50) / 10, s.weekend ? 1 : 0];

export function fitHabit(samples, lambda = 2) {
  if (samples.length < MIN_DAYS) return null;
  const k = 4;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (const s of samples) {
    const x = feat(s);
    for (let i = 0; i < k; i++) {
      b[i] += x[i] * s.total;
      for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j];
    }
  }
  for (let i = 1; i < k; i++) A[i][i] += lambda;
  const w = solve(A, b);
  if (!w) return null;

  const predict = s => Math.max(0, Math.round(feat(s).reduce((acc, x, i) => acc + x * w[i], 0)));
  const mean = samples.reduce((a, s) => a + s.total, 0) / samples.length;
  let ssTot = 0, ssRes = 0;
  for (const s of samples) { ssTot += (s.total - mean) ** 2; ssRes += (s.total - predict(s)) ** 2; }
  return {
    n: samples.length,
    weights: w,
    perDegree: Math.round(w[1]),
    r2: ssTot ? Math.max(0, 1 - ssRes / ssTot) : 0,
    predict,
    // intake at a given feels-like temp, typical humidity, weekday
    line: feels => predict({ feels, humidity: 50, weekend: false }),
  };
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
