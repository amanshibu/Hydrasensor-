// app.js — Router + screens (→ GoRouter / Navigator in Flutter)

import * as S from './storage.js';
import { getWeather, searchCity } from './weather.js';
import { predictNeed, fitHabit, MIN_DAYS } from './hydration-model.js';
import {
  dayKey, keyToDate, addDays, groupByDay, lastNDays, summarize, currentStreak,
  daySummary, timeOfDay, PARTS, weekdayAverages, WEEKDAYS, monthlyAverages,
} from './stats.js';
import { drawRing, drawBars, drawScatter, attachTooltip, COLORS, fmtVol } from './charts.js';
import * as N from './notifications.js';
import { buildDemo } from './demo.js';

let currentView = 'loading';
let weather = null;
let statsTab = 'week';
let statsDay = dayKey(new Date());
let locResults = [];

// — Helpers —
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ml = n => `${Math.round(n).toLocaleString('en')} ml`;
const litres = n => (n / 1000).toLocaleString('en', { maximumFractionDigits: 2 });
const r50 = n => Math.round(n / 50) * 50;
const time = ts => new Date(ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
const hm = h => { const m = Math.round(h * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const shortDate = d => d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;
const hasDemo = () => S.getIntakes().some(i => i.demo);
const REMINDER_LABELS = { 30: 'Every 30 min', 60: 'Every hour', 90: 'Every 90 min', 120: 'Every 2 hours' };

const ICONS = {
  drop: '<svg viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
};
const NOTIF_ICON = { reminder: 'drop', weather: 'sun', goal: 'check', streak: 'flame', test: 'bell' };

// — Goal + model —
function goalLookup() {
  const days = S.getDays();
  const fallback = S.getUser()?.dailyGoal || 2500;
  return k => days[k]?.goal || fallback;
}

// The day's peak conditions drive the model, not the reading at this moment.
function modelWeather() {
  if (!weather || weather.fallback) return null;
  const f = weather.forecast[0];
  return f ? { feels: f.feels, humidity: f.humidity, uv: f.uv } : { feels: weather.feels, humidity: weather.humidity, uv: weather.uv };
}

function refreshGoal() {
  const user = S.getUser();
  if (!user) return null;
  const p = predictNeed(user, modelWeather());
  user.baseGoal = p.base;
  user.dailyGoal = user.goalMode === 'manual' && user.manualGoal > 0 ? user.manualGoal : p.total;
  S.saveUser(user);
  S.saveDay(dayKey(new Date()), { goal: user.dailyGoal, ...(modelWeather() || {}) });
  return p;
}

function habitSamples(byDay) {
  const today = dayKey(new Date());
  return Object.entries(S.getDays())
    .filter(([k, d]) => k < today && d.feels != null && (byDay.get(k)?.total || 0) > 0)
    .map(([k, d]) => ({ key: k, feels: d.feels, humidity: d.humidity, weekend: isWeekend(keyToDate(k)), total: byDay.get(k).total }));
}

async function loadWeather(force = false) {
  weather = await getWeather(force);
  refreshGoal();
  if (currentView === 'dashboard') renderDashboard();
  if (currentView === 'history') renderStats();
  if (currentView === 'profile') { renderGoalCard(); renderLocation(); }
}

function notifContext() {
  const user = S.getUser();
  if (!user || !S.isSignedIn()) return null;
  const byDay = groupByDay(S.getIntakes());
  const total = byDay.get(dayKey(new Date()))?.total || 0;
  const streak = currentStreak(byDay, goalLookup());
  return {
    goal: user.dailyGoal,
    total,
    streakBefore: streak - (total >= user.dailyGoal ? 1 : 0),
    prediction: user.goalMode === 'manual' ? null : predictNeed(user, modelWeather()),
  };
}

// — Init —
// Test account: username "admin", password "admin". Re-created whenever no account exists.
function seedTestUser() {
  S.saveUser({ name: 'Admin', email: 'admin', password: 'admin', age: 25, weight: 70, gender: 'male', activity: 'moderate', condition: 'none', goalMode: 'auto' });
}

function startSession() {
  S.setSignedIn(true);
  refreshGoal();
  navigate('dashboard');
  loadWeather(true);
  N.startNotifications();
}

window.addEventListener('DOMContentLoaded', () => {
  if (!S.getUser()) seedTestUser();
  const user = S.getUser();
  user.condition ??= 'none';
  user.goalMode ??= 'auto';
  // Older builds seeded test@test.com / test123; move it to the admin login.
  if (user.email === 'test@test.com' && user.password === 'test123') Object.assign(user, { email: 'admin', password: 'admin' });
  S.saveUser(user);

  N.configure(notifContext);
  window.addEventListener('hs:notifs', updateBell);
  if (S.isSignedIn()) startSession();
  else navigate('auth');
});

// — Navigation —
const TABS = ['dashboard', 'history', 'streaks', 'profile'];
window.navigate = navigate;
function navigate(view, anchor) {
  // New page slides in from the side of the tab you moved towards.
  const from = TABS.indexOf(currentView), to = TABS.indexOf(view);
  const el = $(`view-${view}`);
  if (el) el.style.setProperty('--dx', from < 0 || to < 0 || from === to ? '0px' : `${to > from ? 28 : -28}px`);

  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  el?.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === view);
    if (n.dataset.view === view) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
  });
  const authViews = ['auth', 'register', 'onboarding', 'loading'];
  $('bottom-nav').style.display = authViews.includes(view) ? 'none' : 'flex';
  movePill();

  ({ dashboard: renderDashboard, history: renderStats, streaks: renderStreaks, profile: renderProfile })[view]?.();
  if (view === 'profile') return anchor ? openSetting(anchor) : showSetting(wide() ? 'set-profile' : null);
  if (anchor) requestAnimationFrame(() => $(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  else window.scrollTo(0, 0);
}

// — Settings pages: tap a menu row to open its page. Phones show one at a time; laptops keep the menu beside it. —
const wide = () => window.matchMedia('(min-width: 960px)').matches;
function showSetting(id) {
  const page = id ? $(id) : null;
  document.querySelectorAll('.settings-page').forEach(p => { p.hidden = p !== page; });
  document.querySelectorAll('[data-setting]').forEach(b => b.classList.toggle('current', !!page && b.dataset.setting === id));
  $('view-profile').classList.toggle('has-page', !!page);
  window.scrollTo(0, 0);
}
// One history entry for "a settings page is open", so the phone's back gesture returns to the menu
// instead of leaving the app. Switching pages replaces it, so back never lands on an older page.
window.openSetting = id => {
  if (history.state?.setting) history.replaceState({ setting: id }, '');
  else history.pushState({ setting: id }, '');
  showSetting(id);
};
window.closeSetting = () => (history.state?.setting ? history.back() : showSetting(wide() ? 'set-profile' : null));
window.addEventListener('popstate', e => {
  if (currentView === 'profile') showSetting(e.state?.setting || (wide() ? 'set-profile' : null));
});

// The dark pill glides after the active tab while that tab's label expands (CSS transition).
const pill = { x: 0, w: 0, raf: 0, last: 0 };
function movePill() {
  cancelAnimationFrame(pill.raf);
  const el = $('nav-pill'), end = performance.now() + 600;
  const snap = !pill.w || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  pill.last = performance.now();
  const step = now => {
    const a = document.querySelector('.nav-item.active');
    if (!a || !a.offsetParent) return;
    const k = snap ? 1 : 1 - Math.exp(-(now - pill.last) / 90);
    pill.last = now;
    pill.x += (a.offsetLeft - pill.x) * k;
    pill.w += (a.offsetWidth - pill.w) * k;
    el.style.transform = `translateX(${pill.x}px)`;
    el.style.width = `${pill.w}px`;
    if (now < end) pill.raf = requestAnimationFrame(step);
  };
  step(pill.last);
}

// — Auth —
function formError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.hidden = !msg;
}

// admin / admin always signs in, even when someone has registered their own account on this device.
window.handleLogin = function () {
  const id = $('login-email').value.trim().toLowerCase();
  const pass = $('login-pass').value.trim();
  if (!id || !pass) return formError('login-error', 'Enter your username and password.');
  const isTest = id === 'admin' && pass === 'admin';
  if (!S.getUser() && isTest) seedTestUser();
  const user = S.getUser();
  if (!user) return formError('login-error', 'No account found. Create one first.');
  const match = String(user.email || '').toLowerCase() === id && String(user.password || '').trim() === pass;
  if (!isTest && !match) return formError('login-error', 'Wrong username or password.');
  formError('login-error', '');
  $('login-pass').value = '';
  startSession();
};

window.handleRegister = function () {
  const name = $('reg-name').value.trim();
  const email = $('reg-email').value.trim();
  const pass = $('reg-pass').value.trim();
  const age = parseInt($('reg-age').value);
  const weight = parseFloat($('reg-weight').value);
  if (!name || !email || !pass) return formError('reg-error', 'Fill in your name, email and password.');
  if (!/^\S+@\S+\.\S+$/.test(email)) return formError('reg-error', 'Enter a valid email address.');
  if (!(age >= 5 && age <= 120)) return formError('reg-error', 'Enter an age between 5 and 120.');
  if (!(weight >= 30 && weight <= 250)) return formError('reg-error', 'Enter a weight between 30 and 250 kg.');
  formError('reg-error', '');
  S.saveUser({
    name, email, password: pass,
    age,
    weight,
    gender: $('reg-gender').value,
    activity: $('reg-activity').value,
    condition: 'none',
    goalMode: 'auto',
  });
  N.requestPermission();
  startSession();
  showToast(`Welcome, ${name}! Today's goal: ${ml(S.getUser().dailyGoal)}`);
};

window.goToRegister = () => navigate('register');
window.goToLogin = () => navigate('auth');

// — Dashboard —
function intakeList(items) {
  return items.map(i => `
    <div class="intake-item">
      <div class="intake-icon"><span class="icon">${ICONS.drop}</span></div>
      <div class="intake-info">
        <div class="intake-amount">${ml(i.amount)}${i.demo ? ' <span class="demo-tag">demo</span>' : ''}</div>
        <div class="intake-time">${time(i.timestamp)}</div>
      </div>
      <button class="icon-btn" onclick="removeIntake(${Number(i.id)})" aria-label="Remove ${i.amount} ml entry"><span class="icon">${ICONS.x}</span></button>
    </div>`).join('');
}

function renderDashboard() {
  const user = S.getUser();
  if (!user) return navigate('auth');
  const s = S.getSettings();
  const byDay = groupByDay(S.getIntakes());
  const today = byDay.get(dayKey(new Date()));
  const total = today?.total || 0;
  const goal = user.dailyGoal;
  const pct = Math.min(total / goal, 1);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  $('dash-greeting').textContent = `${greeting}, ${user.name.split(' ')[0]}`;
  $('dash-date').textContent = now.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' });

  const ring = $('ring-canvas');
  drawRing(ring, pct, total, goal);
  ring.setAttribute('aria-label', `${Math.round(pct * 100)}% of daily goal: ${total} of ${goal} ml`);

  const [cls, label] = total >= goal ? ['chip-success', 'Goal reached']
    : pct >= 0.8 ? ['chip-success', 'On track']
    : pct >= 0.4 ? ['chip-accent', `${ml(goal - total)} to go`]
    : ['chip-warning', `${ml(goal - total)} to go`];
  $('led-status').innerHTML = `<span class="chip ${cls}"><span class="dot"></span>${label}</span>`;
  $('dash-streak').textContent = currentStreak(byDay, goalLookup());

  $('quick-log').innerHTML = s.quickAmounts.map(a => `<button class="pill-btn" onclick="quickLog(${Number(a)})">+${Number(a)} ml</button>`).join('')
    + '<button class="pill-btn pill-dark" onclick="openCustomLog()">Custom</button>';

  renderPrediction(user, byDay);

  $('dash-reminder').textContent = !s.notificationsOn ? 'Notifications off' : !s.remindersOn ? 'Reminders off'
    : s.snoozeUntil > Date.now() ? `Snoozed until ${time(s.snoozeUntil)}` : (REMINDER_LABELS[s.reminderInterval] || `Every ${s.reminderInterval} min`);
  $('dash-quiet').textContent = `Quiet from ${hm(s.quietStart)} to ${hm(s.quietEnd)}`;

  const ds = daySummary(today?.items || [], goal);
  drawBars($('hourly-canvas'), hourlyBars(ds.hourly), { height: 130, maxBarW: 14 });
  attachTooltip($('hourly-canvas'));

  const recent = ds.items.slice(-5).reverse();
  $('dash-recent').innerHTML = recent.length ? intakeList(recent)
    : '<div class="empty-state"><strong>Nothing logged yet</strong>Tap a size above after your next glass.</div>';
  updateBell();
}

function hourlyBars(hourly) {
  return hourly.map((v, h) => ({ value: v, label: h % 6 === 0 ? `${h}h` : '', tip: v ? `${hm(h)}–${hm(h + 1)} · ${ml(v)}` : '' }));
}

function renderPrediction(user, byDay) {
  const el = $('dash-predict');
  if (!weather) { el.innerHTML = '<div class="skeleton"></div>'; return; }
  const p = predictNeed(user, modelWeather());
  const rows = [`<li><span>Body &amp; activity</span><b>${ml(p.base)}</b></li>`]
    .concat(p.factors.map(f => `<li><span>${esc(f.label)}</span><b>+${ml(f.ml)}</b></li>`));

  let context;
  if (weather.fallback) {
    context = `<div class="predict-warn">
      <p class="note">${weather.reason === 'location' ? 'Location is off, so this is your baseline with no weather adjustment.' : "Couldn't reach the weather service, so this is your baseline."}</p>
      <button class="pill-btn pill-sm" onclick="navigate('profile', 'set-location')">Set location</button>
    </div>`;
  } else {
    const peak = Math.round(weather.forecast[0]?.feels ?? weather.feels);
    context = `<p class="note note-gap">${esc(weather.place)}${weather.approx ? ' (approx.)' : ''} · now ${Math.round(weather.temp)}°C, ${weather.label.toLowerCase()}, ${weather.humidity}% humidity. Peak feels-like today: ${peak}°C.</p>`
      + forecastStrip(user) + habitLine(user, byDay);
  }

  el.innerHTML = `
    <div class="card-head"><h2>Today's water need</h2><span class="chip chip-sm chip-accent">Weather model</span></div>
    <div class="predict-hero"><span class="predict-val">${litres(p.total)}</span><span class="predict-unit">L recommended minimum</span></div>
    <ul class="factor-list">${rows.join('')}</ul>
    ${user.goalMode === 'manual' ? `<p class="note note-gap">You've set a fixed goal of ${ml(user.manualGoal)}, so the ring uses that.</p>` : ''}
    ${context}`;
}

function forecastStrip(user) {
  const days = weather.forecast.slice(1, 7);
  if (!days.length) return '';
  return `<p class="mini-label">Next ${days.length} days · peak feels-like and water need</p>
    <div class="forecast">${days.map(d => `
      <div class="fc">
        <span class="fc-day">${keyToDate(d.date).toLocaleDateString('en', { weekday: 'short' })}</span>
        <span class="fc-temp">${Math.round(d.feels)}°</span>
        <span class="fc-need">${(predictNeed(user, d).total / 1000).toFixed(1)} L</span>
      </div>`).join('')}</div>`;
}

function habitLine(user, byDay) {
  const samples = habitSamples(byDay);
  const habit = fitHabit(samples);
  if (!habit) return `<p class="habit">Personal model is learning your habits: ${samples.length} of ${MIN_DAYS} days with weather recorded.</p>`;
  const t = weather.forecast[1];
  if (!t) return '';
  const usual = habit.predict({ feels: t.feels, humidity: t.humidity, weekend: isWeekend(keyToDate(t.date)) });
  const need = predictNeed(user, t).total;
  const gap = need - usual;
  return `<p class="habit">Tomorrow you'll need about ${fmtVol(need)}. On days like it you usually drink ${fmtVol(usual)}${gap > 150 ? `, so plan for an extra ${ml(r50(gap))}.` : ', so you\'re on track.'}</p>`;
}

// — Logging —
function afterLog(msg) {
  if (currentView === 'dashboard') renderDashboard();
  showToast(msg);
  N.onIntakeLogged();
}

window.quickLog = function (amount) {
  S.addIntake(amount);
  afterLog(`+${amount} ml logged`);
  if (navigator.vibrate) navigator.vibrate(30);
};

window.openCustomLog = function () {
  $('custom-modal').classList.add('active');
  $('custom-amount').textContent = 200;
  $('custom-slider').value = 200;
  $('custom-slider').focus({ preventScroll: true });
};

window.closeModal = function () {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
};

window.syncSlider = val => { $('custom-amount').textContent = val; };

window.submitCustomLog = function () {
  const amount = parseInt($('custom-amount').textContent);
  if (amount > 0) {
    S.addIntake(amount);
    closeModal();
    afterLog(`+${amount} ml logged`);
  }
};

window.removeIntake = function (id) {
  S.deleteIntake(id);
  if (currentView === 'history') renderStats(); else renderDashboard();
  showToast('Entry removed');
};

// — Statistics —
window.setStatsTab = tab => { statsTab = tab; renderStats(); };
window.shiftDay = n => {
  const next = dayKey(addDays(keyToDate(statsDay), n));
  if (next > dayKey(new Date())) return;
  statsDay = next;
  renderStats();
};
window.openDay = key => { statsDay = key; statsTab = 'day'; navigate('history'); };
window.openDayStats = () => window.openDay(dayKey(new Date()));

const tile = (label, val, sub = '') => `<div class="stat-card"><div class="stat-val">${val}</div><div class="stat-label">${label}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
const volVal = v => (v >= 1000 ? `${(v / 1000).toLocaleString('en', { maximumFractionDigits: 1 })}<small>L</small>` : `${Math.round(v)}<small>ml</small>`);
function delta(cur, prev, label) {
  if (!prev) return '';
  const d = Math.round(((cur - prev) / prev) * 100);
  return `<span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}%</span> vs ${label}`;
}
const LEGEND = '<div class="legend"><span><i class="sw sw-dark"></i>Goal met</span><span><i class="sw sw-below"></i>Below goal</span><span><i class="sw sw-goal"></i>Goal</span></div>';

function dayBars(days, labelFn) {
  const today = dayKey(new Date());
  return days.map((d, i) => ({
    key: d.key,
    value: d.total,
    goal: d.goal,
    color: d.met ? COLORS.met : COLORS.below,
    label: labelFn(d, i),
    strong: d.key === today,
    tip: `${shortDate(d.date)} · ${ml(d.total)} of ${ml(d.goal)}`,
  }));
}

function partsCard(byDay, keys) {
  const parts = timeOfDay(byDay, keys);
  const sum = parts.reduce((a, b) => a + b, 0);
  if (!sum) return '';
  const hours = ['5–12', '12–17', '17–22', '22–5'];
  const top = parts.indexOf(Math.max(...parts));
  return `<section class="card"><h2>Time of day</h2>
    <div class="hbars">${PARTS.map((p, i) => {
      const pc = Math.round((parts[i] / sum) * 100);
      return `<div class="hbar"><span class="hbar-label">${p}<small>${hours[i]}</small></span><span class="hbar-track"><span class="hbar-fill" style="width:${pc}%"></span></span><span class="hbar-val">${pc}%</span></div>`;
    }).join('')}</div>
    <p class="note note-gap">Most of your water comes in the ${PARTS[top].toLowerCase()}.</p></section>`;
}

function renderStats() {
  document.querySelectorAll('[data-tab]').forEach(b => {
    const on = b.dataset.tab === statsTab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  const ctx = { byDay: groupByDay(S.getIntakes()), g: goalLookup(), user: S.getUser() };
  ({ day: statsDayView, week: statsWeek, month: statsMonth, all: statsAll })[statsTab](ctx);
  if (hasDemo()) $('stats-body').insertAdjacentHTML('afterbegin', '<p class="demo-banner">Includes demo data. Remove it in Settings → Your data.</p>');
  document.querySelectorAll('#stats-body canvas').forEach(attachTooltip);
}

function statsDayView({ byDay, g }) {
  const today = dayKey(new Date());
  const key = statsDay;
  const date = keyToDate(key);
  const goal = g(key);
  const ds = daySummary(byDay.get(key)?.items || [], goal);
  const snap = S.getDays()[key];
  const title = key === today ? 'Today' : key === dayKey(addDays(new Date(), -1)) ? 'Yesterday'
    : date.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' });
  const left = goal - ds.total;
  $('stats-sub').textContent = 'One day, hour by hour';

  $('stats-body').innerHTML = `
    <div class="day-nav">
      <button class="round-btn" onclick="shiftDay(-1)" aria-label="Previous day"><span class="icon">${ICONS.left}</span></button>
      <div class="day-title">${title}</div>
      <button class="round-btn" onclick="shiftDay(1)" aria-label="Next day" ${key >= today ? 'disabled' : ''}><span class="icon">${ICONS.right}</span></button>
    </div>
    <section class="card">
      <div class="day-hero">
        <div>
          <div class="big-num">${volVal(ds.total)}</div>
          <div class="note">${Math.round(ds.pct * 100)}% of ${ml(goal)} goal${snap?.feels != null ? ` · peak feels-like ${Math.round(snap.feels)}°C` : ''}</div>
        </div>
        <span class="chip ${left <= 0 ? 'chip-success' : 'chip-accent'}"><span class="dot"></span>${left <= 0 ? 'Goal met' : `${ml(left)} ${key === today ? 'to go' : 'short'}`}</span>
      </div>
      <div class="chart-wrap"><canvas id="st-day" role="img" aria-label="Water by hour on ${esc(title)}: ${ml(ds.total)} total"></canvas></div>
    </section>
    <div class="stat-grid">
      ${tile('Drinks', ds.count)}
      ${tile('Average drink', ds.count ? volVal(ds.avgSip) : '—')}
      ${tile('First drink', ds.count ? time(ds.first) : '—', ds.count > 1 ? `Last at ${time(ds.last)}` : '')}
      ${tile('Longest gap', ds.count > 1 ? `${Math.floor(ds.longestGapMin / 60)}<small>h</small> ${ds.longestGapMin % 60}<small>m</small>` : '—')}
    </div>
    <section class="card"><h2>Log</h2>${ds.items.length ? intakeList([...ds.items].reverse())
      : '<div class="empty-state"><strong>No drinks logged</strong>Nothing was recorded on this day.</div>'}</section>`;

  drawBars($('st-day'), hourlyBars(ds.hourly), { height: 190, maxBarW: 16 });
}

function statsWeek({ byDay, g }) {
  const today = dayKey(new Date());
  const days = lastNDays(byDay, 7, g);
  const s = summarize(days), p = summarize(lastNDays(byDay, 7, g, addDays(new Date(), -7)));
  $('stats-sub').textContent = `${shortDate(days[0].date)} – ${shortDate(days[6].date)}`;

  $('stats-body').innerHTML = `
    <section class="card">
      <div class="card-head"><h2>Daily intake</h2>${LEGEND}</div>
      <div class="chart-wrap"><canvas id="st-week" role="img" aria-label="Daily intake for the last 7 days, goal met on ${s.met} of 7"></canvas></div>
      <p class="note">Tap a bar to open that day.</p>
    </section>
    <div class="stat-grid">
      ${tile('Daily average', volVal(s.avg), delta(s.avg, p.avg, 'last week'))}
      ${tile('Total', volVal(s.sum), delta(s.sum, p.sum, 'last week'))}
      ${tile('Goals met', `${s.met}<small>/7</small>`)}
      ${tile('Best day', s.best.total ? volVal(s.best.total) : '—', s.best.total ? s.best.date.toLocaleDateString('en', { weekday: 'long' }) : '')}
    </div>
    ${partsCard(byDay, days.map(d => d.key))}`;

  drawBars($('st-week'), dayBars(days, d => (d.key === today ? 'Today' : d.date.toLocaleDateString('en', { weekday: 'short' }))), { height: 230 });
}

function statsMonth({ byDay, g }) {
  const days = lastNDays(byDay, 30, g);
  const s = summarize(days), p = summarize(lastNDays(byDay, 30, g, addDays(new Date(), -30)));
  const wk = weekdayAverages(days);
  const hi = wk.indexOf(Math.max(...wk)), lo = wk.indexOf(Math.min(...wk));
  $('stats-sub').textContent = `${shortDate(days[0].date)} – ${shortDate(days[29].date)}`;

  $('stats-body').innerHTML = `
    <section class="card">
      <div class="card-head"><h2>Last 30 days</h2>${LEGEND}</div>
      <div class="chart-wrap"><canvas id="st-month" role="img" aria-label="Daily intake for the last 30 days, goal met on ${s.met} of 30"></canvas></div>
      <p class="note">Tap a bar to open that day.</p>
    </section>
    <div class="stat-grid">
      ${tile('Daily average', volVal(s.avg), delta(s.avg, p.avg, 'previous 30 days'))}
      ${tile('Goal hit rate', `${s.hitRate}<small>%</small>`, `${s.met} of 30 days`)}
      ${tile('Longest streak', `${s.longestStreak}<small>days</small>`)}
      ${tile('Total', volVal(s.sum))}
    </div>
    <div class="cols">
      <section class="card">
        <h2>Average by weekday</h2>
        <div class="chart-wrap"><canvas id="st-weekday" role="img" aria-label="Average intake by weekday"></canvas></div>
        ${s.sum ? `<p class="note note-gap">You drink most on ${WEEKDAYS[hi]}s and least on ${WEEKDAYS[lo]}s.</p>` : ''}
      </section>
      ${partsCard(byDay, days.map(d => d.key))}
    </div>`;

  drawBars($('st-month'), dayBars(days, (d, i) => (i % 5 === 4 ? String(d.date.getDate()) : '')), { height: 230, maxBarW: 18 });
  drawBars($('st-weekday'), wk.map((v, i) => ({ value: v, label: WEEKDAYS[i], tip: `${WEEKDAYS[i]} · avg ${ml(v)}` })), { height: 190, maxBarW: 28 });
}

function statsAll({ byDay, g }) {
  const keys = [...byDay.keys()].sort();
  if (!keys.length) {
    $('stats-sub').textContent = 'Everything you have logged';
    $('stats-body').innerHTML = `<section class="card"><div class="empty-state"><strong>No history yet</strong>Log a few drinks, or load demo data to explore the charts.</div>
      <button class="btn btn-secondary" onclick="toggleDemo()">Load demo data</button></section>`;
    return;
  }
  const first = keyToDate(keys[0]);
  const n = Math.round((keyToDate(dayKey(new Date())) - first) / 864e5) + 1;
  const days = lastNDays(byDay, n, g);
  const s = summarize(days);
  const months = monthlyAverages(days).slice(-12);
  const samples = habitSamples(byDay);
  const habit = fitHabit(samples);
  $('stats-sub').textContent = `Since ${first.toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' })}`;

  let weatherNote;
  if (habit) {
    const per = habit.perDegree;
    weatherNote = `Each extra 1°C of feels-like temperature, you drink about ${Math.abs(per)} ml ${per >= 0 ? 'more' : 'less'}. Fit from ${habit.n} days (R² ${habit.r2.toFixed(2)}).`;
  } else {
    weatherNote = `The personal model needs ${MIN_DAYS} days with weather recorded. You have ${samples.length} so far.`;
  }

  $('stats-body').innerHTML = `
    <div class="stat-grid stat-grid-3">
      ${tile('Lifetime', volVal(s.sum))}
      ${tile('Days logged', `${s.active}<small>/${n}</small>`)}
      ${tile('Daily average', volVal(s.avg))}
      ${tile('Longest streak', `${s.longestStreak}<small>days</small>`)}
      ${tile('Best day', volVal(s.best.total), shortDate(s.best.date))}
      ${tile('Goal hit rate', `${s.hitRate}<small>%</small>`)}
    </div>
    <div class="cols">
      <section class="card">
        <h2>Monthly average</h2>
        <div class="chart-wrap"><canvas id="st-months" role="img" aria-label="Average daily intake per month"></canvas></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Weather vs. intake</h2>
          <div class="legend"><span><i class="sw sw-dot"></i>A day</span>${habit ? '<span><i class="sw sw-goal"></i>Your trend</span>' : ''}</div>
        </div>
        ${samples.length >= 3 ? '<div class="chart-wrap"><canvas id="st-scatter" role="img" aria-label="Daily intake against peak feels-like temperature"></canvas></div>' : ''}
        <p class="note note-gap">${weatherNote}</p>
      </section>
    </div>`;

  drawBars($('st-months'), months.map(m => ({
    value: m.avg,
    label: m.date.toLocaleDateString('en', { month: 'short' }),
    tip: `${m.date.toLocaleDateString('en', { month: 'long', year: 'numeric' })} · avg ${ml(m.avg)} per day`,
  })), { height: 200, maxBarW: 36 });
  if (samples.length >= 3) {
    drawScatter($('st-scatter'), samples.map(x => ({ x: x.feels, y: x.total, tip: `${shortDate(keyToDate(x.key))} · ${Math.round(x.feels)}°C · ${ml(x.total)}` })), { height: 220, trend: habit?.line });
  }
}

// — History (streak calendar) —
function renderStreaks() {
  const byDay = groupByDay(S.getIntakes());
  const g = goalLookup();
  const streak = currentStreak(byDay, g);
  $('streak-count').textContent = streak;
  $('streak-milestones').innerHTML = [3, 7, 14, 30, 60, 100].map(m => `
    <div class="milestone ${streak >= m ? 'achieved' : ''}">
      <div class="milestone-num">${m}</div>
      <div class="milestone-label">${m}d</div>
    </div>`).join('');

  const today = dayKey(new Date());
  $('streak-calendar').innerHTML = lastNDays(byDay, 30, g).map(d => {
    const cls = (d.key === today ? 'today ' : '') + (d.met ? 'met' : d.total > 0 ? 'partial' : '');
    return `<button class="cal-day ${cls}" onclick="openDay('${d.key}')" aria-label="${shortDate(d.date)}: ${ml(d.total)}">${d.date.getDate()}</button>`;
  }).join('');
}

// — Settings —
function renderProfile() {
  const user = S.getUser();
  if (!user) return;
  const s = S.getSettings();
  const byDay = groupByDay(S.getIntakes());
  const g = goalLookup();

  $('prof-name').textContent = user.name;
  $('prof-initial').textContent = (user.name[0] || 'U').toUpperCase();
  $('prof-email').textContent = user.email;

  const keys = [...byDay.keys()].sort();
  const all = keys.length ? lastNDays(byDay, Math.round((keyToDate(dayKey(new Date())) - keyToDate(keys[0])) / 864e5) + 1, g) : [];
  const sum = summarize(all);
  $('prof-stats').innerHTML = [['Lifetime', fmtVol(sum.sum)], ['Days logged', sum.active], ['Best streak', `${sum.longestStreak} d`]]
    .map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');

  $('prof-name-input').value = user.name;
  $('prof-email-input').value = user.email;
  $('prof-age').value = user.age;
  $('prof-weight').value = user.weight;
  $('prof-gender').value = user.gender;
  $('prof-activity').value = user.activity;
  $('prof-condition').value = user.condition || 'none';
  renderGoalCard();
  renderLocation();

  $('n-on').checked = s.notificationsOn;
  $('n-rem').checked = s.remindersOn;
  $('n-smart').checked = s.smartReminders;
  $('n-weather').checked = s.weatherAlerts;
  $('n-goal').checked = s.goalAlerts;
  $('n-streak').checked = s.streakAlerts;
  $('prof-reminder').value = s.reminderInterval;
  $('n-wake').value = hm(s.quietEnd);
  $('n-sleep').value = hm(s.quietStart);
  renderPerm();

  s.quickAmounts.forEach((a, i) => { $(`qa-${i}`).value = a; });

  const ach = achievements(byDay, all, sum);
  const done = ach.filter(a => a.p >= a.of).length;
  $('ach-count').textContent = `${done} / ${ach.length}`;
  $('achievements').innerHTML = ach.map(a => {
    const ok = a.p >= a.of;
    return `<div class="ach ${ok ? 'done' : ''}">
      <span class="ach-icon">${ok ? ICONS.check : ICONS.drop}</span>
      <div class="ach-text"><b>${a.t}</b><small>${a.d}${ok ? '' : ` · ${a.p}/${a.of}`}</small>
        ${ok ? '' : `<span class="ach-bar"><span style="width:${Math.round((a.p / a.of) * 100)}%"></span></span>`}
      </div>
    </div>`;
  }).join('');

  $('demo-btn').textContent = hasDemo() ? 'Remove demo data' : 'Load demo data';
  $('sum-ach').textContent = `${done} of ${ach.length} unlocked`;
  $('pw-note').textContent = user.email === 'admin'
    ? 'At least 4 characters. This is the test account, so admin / admin keeps working as well.'
    : 'At least 4 characters.';
  renderSummary();
}

// One-line summaries under each Settings menu row.
const ACTIVITY_LABELS = { sedentary: 'Sedentary', light: 'Light activity', moderate: 'Moderate activity', active: 'Active' };
function renderSummary() {
  const user = S.getUser();
  if (!user) return;
  const s = S.getSettings();
  $('sum-profile').textContent = `${user.age} yrs · ${user.weight} kg · ${ACTIVITY_LABELS[user.activity] || user.activity}`;
  $('sum-goal').textContent = `${ml(user.dailyGoal)} · ${user.goalMode === 'manual' ? 'fixed' : 'follows the weather'}`;
  $('sum-location').textContent = s.location ? s.location.name.split(',')[0]
    : weather?.approx ? `${weather.place} (approximate)` : weather?.fallback ? 'Not available' : 'Device location';
  $('sum-notifs').textContent = !s.notificationsOn ? 'Off'
    : `${s.remindersOn ? REMINDER_LABELS[s.reminderInterval] || `Every ${s.reminderInterval} min` : 'Reminders off'} · quiet ${hm(s.quietStart)}–${hm(s.quietEnd)}`;
  $('sum-quick').textContent = `${s.quickAmounts.join(' · ')} ml`;
  $('sum-data').textContent = hasDemo() ? 'Demo data loaded · export, reset' : 'Export, demo data, reset';
}

function achievements(byDay, all, sum) {
  const items = S.getIntakes();
  const days = S.getDays();
  const litresTotal = Math.floor(sum.sum / 1000);
  const maxDrinks = Math.max(0, ...[...byDay.values()].map(d => d.items.length));
  return [
    { t: 'First sip', d: 'Log your first drink', p: items.length ? 1 : 0, of: 1 },
    { t: 'Goal getter', d: 'Hit your daily goal', p: Math.min(1, sum.met), of: 1 },
    { t: 'On a roll', d: '3-day streak', p: Math.min(3, sum.longestStreak), of: 3 },
    { t: 'Full week', d: '7-day streak', p: Math.min(7, sum.longestStreak), of: 7 },
    { t: 'Habit formed', d: '30-day streak', p: Math.min(30, sum.longestStreak), of: 30 },
    { t: '10 L club', d: 'Drink 10 litres in total', p: Math.min(10, litresTotal), of: 10 },
    { t: '100 L club', d: 'Drink 100 litres in total', p: Math.min(100, litresTotal), of: 100 },
    { t: 'Early bird', d: 'A drink before 8 am', p: items.some(i => new Date(i.timestamp).getHours() < 8) ? 1 : 0, of: 1 },
    { t: 'Steady sipper', d: '8 drinks in one day', p: Math.min(8, maxDrinks), of: 8 },
    { t: 'Heat hero', d: 'Hit your goal on a 30°C+ day', p: all.some(d => d.met && days[d.key]?.feels >= 30) ? 1 : 0, of: 1 },
  ];
}

function renderGoalCard() {
  const user = S.getUser();
  if (!user) return;
  const p = predictNeed(user, modelWeather());
  const manual = user.goalMode === 'manual';
  $('prof-goal').textContent = ml(user.dailyGoal);
  $('prof-goal-sub').textContent = manual
    ? `Fixed by you. The weather model recommends ${ml(p.total)} today.`
    : `Base ${ml(p.base)}${p.extra ? ` + ${ml(p.extra)} for today's weather` : weather?.fallback ? ' · no weather data yet' : ' · no weather adjustment today'}`;
  document.querySelectorAll('[data-goal-mode]').forEach(b => {
    const on = b.dataset.goalMode === (manual ? 'manual' : 'auto');
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on);
  });
  $('manual-goal-row').hidden = !manual;
  $('prof-manual-goal').value = user.manualGoal || user.dailyGoal;
  renderSummary();
}

function renderLocation() {
  renderSummary();
  const loc = S.getSettings().location;
  $('loc-current').textContent = loc ? `Using ${loc.name}`
    : weather?.approx ? `Using approximate location near ${weather.place}. ${window.isSecureContext ? 'Allow location access for a precise reading, or search your city.' : 'Precise GPS needs the app opened over https. Search your city for an exact match.'}`
    : weather?.fallback && weather.reason === 'location' ? 'Location unavailable. Search for your city instead.'
    : 'Using your device location';
}

function renderPerm() {
  const states = {
    granted: ['chip-success', 'System notifications allowed', ''],
    denied: ['chip-warning', 'Blocked in browser settings', ''],
    default: ['chip-accent', 'System notifications not enabled', '<button class="pill-btn pill-sm pill-dark" onclick="enableNotifications()">Enable</button>'],
    unsupported: ['chip-offline', 'In-app only on this device', ''],
  };
  const [c, t, b] = states[N.permission()];
  $('perm-row').innerHTML = `<span class="chip chip-sm ${c}"><span class="dot"></span>${t}</span>${b}`;
}

window.updateProfile = function () {
  const user = S.getUser();
  const name = $('prof-name-input').value.trim();
  const email = $('prof-email-input').value.trim();
  const age = parseInt($('prof-age').value);
  const weight = parseFloat($('prof-weight').value);
  if (!name) return formError('prof-error', "Name can't be empty.");
  if (!email || /\s/.test(email)) return formError('prof-error', 'Enter an email or username with no spaces.');
  if (!(age >= 5 && age <= 120)) return formError('prof-error', 'Enter an age between 5 and 120.');
  if (!(weight >= 30 && weight <= 250)) return formError('prof-error', 'Enter a weight between 30 and 250 kg.');
  formError('prof-error', '');
  Object.assign(user, { name, email, age, weight, gender: $('prof-gender').value, activity: $('prof-activity').value, condition: $('prof-condition').value });
  S.saveUser(user);
  refreshGoal();
  renderProfile();
  showToast(`Profile saved · goal ${ml(S.getUser().dailyGoal)}`);
};

window.changePassword = function () {
  const user = S.getUser();
  const cur = $('pw-current').value.trim(), next = $('pw-new').value.trim(), again = $('pw-confirm').value.trim();
  if (String(user.password || '').trim() !== cur) return formError('pw-error', 'Your current password is wrong.');
  if (next.length < 4) return formError('pw-error', 'The new password needs at least 4 characters.');
  if (next !== again) return formError('pw-error', "The new passwords don't match.");
  if (next === cur) return formError('pw-error', 'Choose a password different from the current one.');
  formError('pw-error', '');
  user.password = next;
  S.saveUser(user);
  ['pw-current', 'pw-new', 'pw-confirm'].forEach(id => { $(id).value = ''; });
  showToast('Password changed');
  closeSetting();
};

window.setGoalMode = function (mode) {
  const user = S.getUser();
  if (mode === 'manual' && !user.manualGoal) user.manualGoal = user.dailyGoal;
  user.goalMode = mode;
  S.saveUser(user);
  refreshGoal();
  renderGoalCard();
  showToast(mode === 'auto' ? 'Smart goal on: it follows the weather' : 'Fixed goal on');
};

window.saveManualGoal = function () {
  const v = r50(+$('prof-manual-goal').value);
  if (!(v >= 500 && v <= 6000)) return showToast('Enter a goal between 500 and 6000 ml');
  const user = S.getUser();
  user.manualGoal = v;
  user.goalMode = 'manual';
  S.saveUser(user);
  refreshGoal();
  renderGoalCard();
  showToast(`Goal set to ${ml(v)}`);
};

window.findCity = async function () {
  const q = $('loc-query').value.trim();
  if (q.length < 2) return showToast('Type at least 2 letters');
  $('loc-results').innerHTML = '<p class="note">Searching…</p>';
  try {
    locResults = await searchCity(q);
  } catch {
    $('loc-results').innerHTML = '<p class="note">Search failed. Check your connection and try again.</p>';
    return;
  }
  $('loc-results').innerHTML = locResults.length
    ? locResults.map((r, i) => `<button class="loc-item" onclick="pickCity(${i})">${esc(r.name)}</button>`).join('')
    : '<p class="note">No matching places.</p>';
};

window.pickCity = async function (i) {
  const loc = locResults[i];
  if (!loc) return;
  S.updateSettings({ location: loc });
  $('loc-results').innerHTML = '';
  $('loc-query').value = '';
  renderLocation();
  showToast(`Weather location: ${loc.name.split(',')[0]}`);
  await loadWeather(true);
};

window.useDeviceLocation = async function () {
  S.updateSettings({ location: null });
  showToast('Finding your location…');
  await loadWeather(true);
  renderLocation();
  showToast(weather.fallback ? "Couldn't get a location. Search your city instead."
    : weather.approx ? `Approximate location: ${weather.place}` : 'Using device location');
};

const SETTING_NAMES = { notificationsOn: 'Notifications', remindersOn: 'Water reminders', smartReminders: 'Smart reminders', weatherAlerts: 'Hot-weather alerts', goalAlerts: 'Goal alerts', streakAlerts: 'Streak alerts' };
window.toggleSetting = async function (key, val) {
  S.updateSettings({ [key]: val });
  renderSummary();
  showToast(`${SETTING_NAMES[key]} ${val ? 'on' : 'off'}`);
  if (key === 'notificationsOn' && val) { await N.requestPermission(); renderPerm(); }
};

window.updateReminder = function () {
  S.updateSettings({ reminderInterval: +$('prof-reminder').value });
  renderSummary();
  N.startNotifications();
  showToast('Reminder interval updated');
};

window.updateQuietHours = function () {
  const toH = v => { const [h, m] = v.split(':').map(Number); return h + m / 60; };
  const wake = $('n-wake').value, sleep = $('n-sleep').value;
  if (!wake || !sleep) return;
  if (wake === sleep) return showToast('Wake-up and bedtime must be different');
  S.updateSettings({ quietEnd: toH(wake), quietStart: toH(sleep) });
  renderSummary();
  showToast(`Quiet from ${sleep} to ${wake}`);
};

window.enableNotifications = async function () {
  const p = await N.requestPermission();
  renderPerm();
  showToast(p === 'granted' ? 'Notifications enabled' : p === 'denied' ? 'Blocked. Allow them in your browser settings.' : 'Notifications not enabled');
};

window.testNotification = async function () {
  if (N.permission() === 'default') await N.requestPermission();
  renderPerm();
  N.sendTest();
  showToast(N.permission() === 'granted' ? 'Test notification sent' : 'Test added to your in-app inbox');
};

window.saveQuickAmounts = function () {
  const vals = [0, 1, 2].map(i => Math.round(+$(`qa-${i}`).value / 10) * 10);
  if (vals.some(v => !(v >= 10 && v <= 2000))) return showToast('Each size must be 10 to 2000 ml');
  S.updateSettings({ quickAmounts: vals.sort((a, b) => a - b) });
  renderProfile();
  showToast('Quick-log sizes saved');
};

window.exportCsv = function () {
  const pad = n => String(n).padStart(2, '0');
  const rows = [...S.getIntakes()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).map(i => {
    const d = new Date(i.timestamp);
    return [dayKey(d), `${pad(d.getHours())}:${pad(d.getMinutes())}`, i.amount, i.demo ? 'yes' : 'no'].join(',');
  });
  if (!rows.length) return showToast('Nothing to export yet');
  const blob = new Blob([['date,time,amount_ml,demo', ...rows].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hydrasense-${dayKey(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast(`Exported ${rows.length} entries`);
};

window.toggleDemo = function () {
  if (hasDemo()) {
    S.saveIntakes(S.getIntakes().filter(i => !i.demo));
    const d = S.getDays();
    for (const k of Object.keys(d)) if (d[k].demo) delete d[k];
    S.saveDays(d);
    showToast('Demo data removed');
  } else {
    const { intakes, snapshots } = buildDemo(S.getUser());
    S.saveIntakes([...S.getIntakes(), ...intakes]);
    S.saveDays({ ...snapshots, ...S.getDays() });
    showToast('Loaded 60 days of demo data');
  }
  if (currentView === 'profile') renderProfile();
  if (currentView === 'history') renderStats();
};

window.logout = () => { S.setSignedIn(false); navigate('auth'); };

window.resetData = function () {
  if (confirm('Clear all data?')) {
    S.clearAll();
    seedTestUser();
    navigate('auth');
  }
};

// — Notification inbox —
function updateBell() {
  const n = N.unreadCount();
  const b = $('bell-badge');
  b.hidden = !n;
  b.textContent = n > 9 ? '9+' : n;
  $('bell-btn').setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
}

function relTime(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return shortDate(new Date(ts));
}

function renderNotifList() {
  const list = S.getNotifs();
  const s = S.getSettings();
  $('notif-list').innerHTML = list.length ? list.map(n => `
    <div class="notif ${n.read ? '' : 'unread'}">
      <span class="notif-icon type-${esc(n.type)}"><span class="icon">${ICONS[NOTIF_ICON[n.type]] || ICONS.bell}</span></span>
      <div class="notif-text"><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${relTime(n.ts)}</small></div>
    </div>`).join('')
    : '<div class="empty-state"><strong>All caught up</strong>Reminders and alerts will show up here.</div>';
  $('snooze-btn').textContent = s.snoozeUntil > Date.now() ? `Snoozed until ${time(s.snoozeUntil)} · resume` : 'Snooze 1 hour';
}

window.openNotifs = function () {
  renderNotifList();
  $('notif-modal').classList.add('active');
  $('notif-modal').querySelector('.modal-sheet').focus({ preventScroll: true });
  N.markAllRead();
};

window.snooze = function () {
  const on = S.getSettings().snoozeUntil > Date.now();
  S.updateSettings({ snoozeUntil: on ? 0 : Date.now() + 3600e3 });
  renderNotifList();
  if (currentView === 'dashboard') renderDashboard();
  showToast(on ? 'Reminders resumed' : 'Reminders snoozed for 1 hour');
};

window.clearNotifs = function () {
  N.clearInbox();
  renderNotifList();
};

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove('show'), 2500);
}

// Canvas charts are drawn at a fixed pixel size, so redraw when the layout width changes.
let redrawQueued = false;
let lastWidth = window.innerWidth;
function redrawCharts() {
  movePill();
  // Laptops always show a page beside the menu; phones may show the menu alone.
  if (currentView === 'profile' && wide() && !$('view-profile').classList.contains('has-page')) showSetting('set-profile');
  if (currentView === 'dashboard') renderDashboard();
  if (currentView === 'history') renderStats();
}
window.addEventListener('resize', () => {
  if (redrawQueued || window.innerWidth === lastWidth) return; // ignore height-only changes (mobile keyboard, URL bar)
  lastWidth = window.innerWidth;
  redrawQueued = true;
  requestAnimationFrame(() => { redrawQueued = false; redrawCharts(); });
});
document.fonts?.load('500 16px Manrope').then(redrawCharts).catch(() => {});

window.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// — Service Worker —
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
