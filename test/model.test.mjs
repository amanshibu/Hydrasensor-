// Run: node test/model.test.mjs
import assert from 'node:assert/strict';
import { predictNeed, fitHabit, MIN_DAYS } from '../js/hydration-model.js';
import { groupByDay, lastNDays, currentStreak, summarize, daySummary, dayKey, addDays } from '../js/stats.js';

const user = { weight: 70, activity: 'sedentary', condition: 'none' };

// Mild weather adds nothing; heat, humidity and UV each add.
assert.equal(predictNeed(user, null).total, 2450);
assert.equal(predictNeed(user, { feels: 20, humidity: 50, uv: 2 }).extra, 0);
const hot = predictNeed(user, { feels: 36, humidity: 80, uv: 9 });
assert.deepEqual(hot.factors.map(f => f.ml), [300, 150, 100]);
assert.equal(hot.total, 3000);
assert.equal(predictNeed({ ...user, condition: 'breastfeeding' }, null).total, 3150);
assert.ok(predictNeed(user, { feels: 60, humidity: 90, uv: 11 }).extra <= 1000);

// Habit model recovers a known temperature slope.
assert.equal(fitHabit(new Array(MIN_DAYS - 1).fill({ feels: 25, humidity: 50, total: 2000 })), null);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const samples = Array.from({ length: 60 }, (_, i) => {
  const feels = 15 + rnd() * 20, humidity = 30 + rnd() * 60, weekend = i % 7 >= 5;
  return { feels, humidity, weekend, total: 1800 + 40 * (feels - 20) - 250 * weekend + (rnd() - 0.5) * 100 };
});
const habit = fitHabit(samples);
assert.ok(Math.abs(habit.perDegree - 40) <= 4, `perDegree ${habit.perDegree}`);
assert.ok(habit.r2 > 0.8, `r2 ${habit.r2}`);
assert.ok(Math.abs(habit.line(30) - 2200) < 120, `line(30) ${habit.line(30)}`);

// Stats: streak, summaries, day breakdown.
const today = new Date(2026, 9, 30, 15);
const at = (daysAgo, h, amount) => ({ id: Math.random(), amount, timestamp: new Date(addDays(today, -daysAgo).setHours(h, 0, 0, 0)).toISOString() });
const intakes = [at(0, 9, 500), at(0, 13, 700), at(1, 10, 2500), at(2, 10, 2600), at(3, 10, 900)];
const byDay = groupByDay(intakes);
const goal = () => 2400;
assert.equal(currentStreak(byDay, goal, today), 2);
const week = lastNDays(byDay, 7, goal, today);
assert.equal(week.length, 7);
assert.equal(week[6].key, dayKey(today));
const s = summarize(week);
assert.equal(s.met, 2);
assert.equal(s.longestStreak, 2);
assert.equal(s.best.total, 2600);
const d = daySummary(byDay.get(dayKey(today)).items, 2400);
assert.equal(d.total, 1200);
assert.equal(d.longestGapMin, 240);
assert.equal(d.hourly[13], 700);

console.log('model + stats checks passed');
