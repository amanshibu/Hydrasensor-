// storage.js — localStorage CRUD wrapper (→ SharedPreferences / Firebase in Flutter)

const KEYS = {
  USER: 'hs_user',
  INTAKES: 'hs_intakes',
  SETTINGS: 'hs_settings',
  DAYS: 'hs_days',          // { 'YYYY-MM-DD': { goal, feels, temp, humidity, uv, demo? } }
  NOTIFS: 'hs_notifs',      // in-app notification inbox
  NSTATE: 'hs_notif_state', // reminder bookkeeping
  SESSION: 'hs_session',    // true while signed in
};

const DEFAULT_SETTINGS = {
  unit: 'ml',
  quietStart: 22,           // bedtime, decimal hours
  quietEnd: 7,              // wake-up, decimal hours
  reminderInterval: 60,
  notificationsOn: true,
  remindersOn: true,
  smartReminders: true,
  weatherAlerts: true,
  goalAlerts: true,
  streakAlerts: true,
  snoozeUntil: 0,
  quickAmounts: [100, 250, 500],
  location: null,           // { name, lat, lon } — null = use device location
};

function get(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function set(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function remove(key) {
  try { localStorage.removeItem(key); } catch {}
}

// User
export function getUser() { return get(KEYS.USER); }
export function saveUser(u) { set(KEYS.USER, u); }
export function clearUser() { remove(KEYS.USER); }
export const isSignedIn = () => get(KEYS.SESSION) === true;
export const setSignedIn = on => (on ? set(KEYS.SESSION, true) : remove(KEYS.SESSION));

// Intakes — array of { id, amount, timestamp, note, demo? }
export function getIntakes() { return get(KEYS.INTAKES) || []; }
export function saveIntakes(list) { set(KEYS.INTAKES, list); }

export function addIntake(amount, note = '') {
  const list = getIntakes();
  list.push({ id: Date.now(), amount, timestamp: new Date().toISOString(), note });
  saveIntakes(list);
  return list;
}

export function deleteIntake(id) {
  const list = getIntakes().filter(i => i.id !== id);
  saveIntakes(list);
  return list;
}

// Settings
export function getSettings() { return { ...DEFAULT_SETTINGS, ...(get(KEYS.SETTINGS) || {}) }; }
export function saveSettings(s) { set(KEYS.SETTINGS, s); }
export function updateSettings(patch) { const s = { ...getSettings(), ...patch }; saveSettings(s); return s; }

// Per-day snapshots (goal + weather) used by stats and the habit model
export function getDays() { return get(KEYS.DAYS) || {}; }
export function saveDays(d) { set(KEYS.DAYS, d); }
export function saveDay(key, data) { const d = getDays(); d[key] = { ...d[key], ...data }; saveDays(d); }

// Notifications
export function getNotifs() { return get(KEYS.NOTIFS) || []; }
export function saveNotifs(list) { set(KEYS.NOTIFS, list); }
export function getNotifState() { return get(KEYS.NSTATE) || {}; }
export function saveNotifState(s) { set(KEYS.NSTATE, s); }

// Helpers
export function getTodayIntakes() {
  const today = new Date().toDateString();
  return getIntakes().filter(i => new Date(i.timestamp).toDateString() === today);
}

export function getTodayTotal() {
  return getTodayIntakes().reduce((sum, i) => sum + i.amount, 0);
}

export function clearAll() {
  Object.values(KEYS).forEach(k => remove(k));
}
