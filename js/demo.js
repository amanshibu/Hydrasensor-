// demo.js — clearly flagged sample history (demo: true) for showing charts and the habit model.

import { predictNeed } from './hydration-model.js';
import { dayKey, addDays } from './stats.js';

export function buildDemo(user, days = 60, today = new Date()) {
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const intakes = [];
  const snapshots = {};

  for (let i = days; i >= 1; i--) {
    const date = addDays(today, -i);
    const key = dayKey(date);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const feels = Math.round((27 + 6 * Math.sin(i / 9) + (rnd() - 0.5) * 6) * 10) / 10;
    const humidity = Math.round(55 + 25 * Math.sin(i / 13 + 1) + (rnd() - 0.5) * 10);
    const uv = Math.round((5 + 4 * rnd()) * 10) / 10;
    const goal = predictNeed(user, { feels, humidity, uv }).total;
    snapshots[key] = { goal, feels, humidity, uv, temp: feels - 3, demo: true };

    const target = Math.max(600, Math.round(goal * (0.8 + rnd() * 0.3) + 30 * (feels - 27) - (weekend ? 250 : 0)));
    const sips = 4 + Math.floor(rnd() * 5);
    for (let s = 0; s < sips; s++) {
      const hour = 7 + Math.floor((s / sips) * 14 + rnd() * 2);
      const t = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.min(hour, 22), Math.floor(rnd() * 60));
      intakes.push({ id: t.getTime() + s, amount: Math.max(50, Math.round(target / sips / 10) * 10), timestamp: t.toISOString(), note: '', demo: true });
    }
  }
  return { intakes, snapshots };
}
