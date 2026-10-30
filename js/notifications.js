// notifications.js — in-app inbox + system notifications (→ flutter_local_notifications in Flutter)
// Timers run only while the app is open; background delivery would need a push server.

import { getSettings, getNotifs, saveNotifs, getNotifState, saveNotifState } from './storage.js';
import { dayKey } from './stats.js';

let timer = null;
let context = () => null; // app supplies { goal, total, streakBefore, prediction }

export function configure(provider) { context = provider; }

export function permission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

export async function requestPermission() {
  if (permission() === 'default') await Notification.requestPermission();
  return permission();
}

export function inQuietHours(s, d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  const { quietStart: a, quietEnd: b } = s;
  return a > b ? h >= a || h < b : h >= a && h < b;
}

// Share of today's goal you'd have drunk by now if spread evenly across waking hours.
export function expectedByNow(goal, s, d = new Date()) {
  const wake = s.quietEnd;
  const sleep = s.quietStart > wake ? s.quietStart : s.quietStart + 24;
  const h = d.getHours() + d.getMinutes() / 60;
  const f = Math.min(1, Math.max(0, (h - wake) / (sleep - wake)));
  return Math.round(goal * f);
}

export function unreadCount() { return getNotifs().filter(n => !n.read).length; }

export function markAllRead() {
  saveNotifs(getNotifs().map(n => ({ ...n, read: true })));
  window.dispatchEvent(new Event('hs:notifs'));
}

export function clearInbox() {
  saveNotifs([]);
  window.dispatchEvent(new Event('hs:notifs'));
}

// onceKey: skip if this key already fired (e.g. 'goal-2026-10-30').
export function notify(type, title, body, { onceKey, force = false } = {}) {
  if (onceKey) {
    const st = getNotifState();
    const once = st.once || {};
    if (once[onceKey]) return false;
    once[onceKey] = Date.now();
    const cutoff = Date.now() - 3 * 864e5;
    for (const k of Object.keys(once)) if (once[k] < cutoff) delete once[k];
    saveNotifState({ ...st, once });
  }

  const list = getNotifs();
  list.unshift({ id: Date.now() + Math.random(), type, title, body, ts: Date.now(), read: false });
  saveNotifs(list.slice(0, 50));
  window.dispatchEvent(new Event('hs:notifs'));

  const s = getSettings();
  const muted = !s.notificationsOn || inQuietHours(s) || s.snoozeUntil > Date.now();
  if (permission() === 'granted' && (force || !muted)) push(title, body);
  return true;
}

async function push(title, body) {
  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'hydrasense' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return await reg.showNotification(title, opts);
  } catch {}
  try { new Notification(title, opts); } catch {}
}

function tick() {
  const s = getSettings();
  const c = context();
  if (!s.notificationsOn || !c || inQuietHours(s)) return;
  const now = new Date();
  const today = dayKey(now);
  const left = c.goal - c.total;

  const st = getNotifState();
  if (s.remindersOn && s.snoozeUntil <= Date.now() && Date.now() - (st.lastReminder || 0) >= s.reminderInterval * 60000) {
    saveNotifState({ ...st, lastReminder: Date.now() });
    const behind = expectedByNow(c.goal, s, now) - c.total;
    if (left > 0 && (!s.smartReminders || behind > c.goal * 0.05)) {
      notify('reminder', 'Time for water', behind > 0
        ? `You're ${behind} ml behind pace, with ${left} ml left today.`
        : `${left} ml left today. Take a few sips.`);
    }
  }

  if (s.weatherAlerts && c.prediction?.extra >= 300) {
    const top = c.prediction.factors[0]?.label.toLowerCase() || 'hot weather';
    notify('weather', 'Hot day: drink more', `${top[0].toUpperCase() + top.slice(1)}. Aim for ${c.goal} ml today (+${c.prediction.extra} ml for the weather).`, { onceKey: `weather-${today}` });
  }

  if (s.streakAlerts && now.getHours() >= 19 && c.streakBefore > 0 && left > 0) {
    notify('streak', 'Streak at risk', `Your ${c.streakBefore}-day streak ends tonight. ${left} ml to go.`, { onceKey: `streak-${today}` });
  }
}

export function onIntakeLogged() {
  const s = getSettings();
  const c = context();
  if (s.goalAlerts && c && c.total >= c.goal) {
    notify('goal', 'Daily goal reached', `You drank ${c.total} ml today. Nice work.`, { onceKey: `goal-${dayKey(new Date())}` });
  }
}

export function startNotifications() {
  if (timer) clearInterval(timer);
  const st = getNotifState();
  if (!st.lastReminder) saveNotifState({ ...st, lastReminder: Date.now() });
  timer = setInterval(tick, 60 * 1000);
  setTimeout(tick, 4000);
}

export function sendTest() {
  return notify('test', 'Test notification', 'Notifications are working.', { force: true });
}
