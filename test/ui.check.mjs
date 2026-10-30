// Run: node test/ui.check.mjs [--shots <dir>]
// Zero-dependency UI audit: drives a local Chrome/Edge over the DevTools protocol through every screen
// at phone, tablet and laptop widths. Fails on JS errors, sideways scroll, content spilling out of cards,
// clipped text, overlapping elements, tiny tap targets, broken HTML structure and broken login.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(import.meta.dirname, '..');
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const WIDTHS = [[320, 640], [360, 740], [375, 667], [390, 844], [414, 896], [768, 1024], [1024, 768], [1366, 768], [1920, 1080]];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// — Static server (no caching) —
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(root, rel.endsWith('/') ? `${rel}index.html` : rel);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const APP = `http://127.0.0.1:${server.address().port}/`;

// — Browser —
const CANDIDATES = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const exe = CANDIDATES.find(p => p && existsSync(p));
if (!exe) { console.error('No Chrome/Edge found. Set CHROME=/path/to/chrome'); process.exit(2); }
const profile = mkdtempSync(join(tmpdir(), 'hs-ui-'));
const chrome = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let port;
for (let i = 0; i < 100 && !port; i++) { await sleep(100); try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {} }
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));

let seq = 0;
const pending = new Map();
const jsErrors = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); return m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') jsErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') jsErrors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${expression.slice(0, 60)} → ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
};
await send('Runtime.enable');
await send('Page.enable');

// — In-page audit —
const AUDIT = `(() => {
  const out = [], vw = document.documentElement.clientWidth;
  const name = el => el.id ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
  const shown = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.sr-only, .chart-tip'); };
  const floating = el => ['absolute', 'fixed'].includes(getComputedStyle(el).position);
  if (document.documentElement.scrollWidth > vw) out.push('page scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + vw);
  const scopes = [...document.querySelectorAll('.view.active, .modal-overlay.active')];
  if (getComputedStyle(document.getElementById('bottom-nav')).display !== 'none') scopes.push(document.getElementById('bottom-nav'));
  for (const scope of scopes) for (const el of scope.querySelectorAll('*')) {
    if (!shown(el) || el.closest('svg')) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.right > vw + 0.5 || r.left < -0.5) out.push(name(el) + ' off-screen (' + Math.round(r.left) + '-' + Math.round(r.right) + ' of ' + vw + ')');
    const box = el.parentElement.closest('.card, .stat-card, .modal-sheet, .auth-card, .bottom-nav, .tile, .fc, .ach, .chip, .btn, .pill-btn, .input-group, .toggle-row');
    if (box && !el.matches('.badge, .nav-pill')) {
      const c = box.getBoundingClientRect();
      if (r.right > c.right + 1 || r.left < c.left - 1) out.push(name(el) + ' spills out of ' + name(box));
    }
    if (cs.display !== 'inline' && el.scrollWidth > el.clientWidth + 1 && (cs.whiteSpace === 'nowrap' || cs.textOverflow === 'ellipsis') && !el.closest('.nav-item:not(.active)'))
      out.push(name(el) + ' text cut off: "' + el.textContent.trim().slice(0, 30) + '"');
    if (el.matches('button, select, input:not([type=checkbox]):not([type=range]), a[href]') && (r.width < 24 || r.height < 24)) out.push(name(el) + ' tap target ' + Math.round(r.width) + 'x' + Math.round(r.height));
    if (['flex', 'inline-flex', 'grid'].includes(cs.display)) {
      const kids = [...el.children].filter(k => shown(k) && !floating(k));
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 1 && oy > 1) out.push(name(kids[i]) + ' overlaps ' + name(kids[j]) + ' in ' + name(el));
      }
    }
    if (el.tagName === 'CANVAS' && !el.width) out.push(name(el) + ' chart not drawn');
  }
  // Bottom of the page must clear the floating nav.
  const view = document.querySelector('.view.active'), nav = document.getElementById('bottom-nav');
  if (view && getComputedStyle(nav).display !== 'none' && !document.querySelector('.modal-overlay.active')) {
    const y = scrollY; scrollTo(0, 1e6);
    const last = [...view.querySelectorAll('.card, .stat-card, .segmented, p')].filter(shown).pop();
    if (last && last.getBoundingClientRect().bottom > nav.getBoundingClientRect().top - 4) out.push(name(last) + ' hidden behind the bottom nav at the end of the page');
    scrollTo(0, y);
  }
  return [...new Set(out)];
})()`;

const STRUCTURE = `(() => {
  const out = [], ids = {};
  document.querySelectorAll('[id]').forEach(e => { ids[e.id] = (ids[e.id] || 0) + 1; });
  for (const [id, n] of Object.entries(ids)) if (n > 1) out.push('duplicate id #' + id);
  document.querySelectorAll('label[for]').forEach(l => { if (!document.getElementById(l.htmlFor)) out.push('label for missing #' + l.htmlFor); });
  document.querySelectorAll('button, [role=switch], input, select').forEach(b => {
    const label = b.getAttribute('aria-label') || b.textContent.trim() || b.labels?.[0]?.textContent.trim() || b.closest('label')?.textContent.trim();
    if (!label) out.push('control without a name: ' + b.outerHTML.slice(0, 80));
  });
  if (document.querySelectorAll('main').length !== 1) out.push('expected exactly one <main>');
  document.querySelectorAll('[aria-labelledby]').forEach(e => { if (!document.getElementById(e.getAttribute('aria-labelledby'))) out.push('aria-labelledby missing target'); });
  return out;
})()`;

// — Flow —
const problems = [];
const fail = (where, list) => list.forEach(p => problems.push(`[${where}] ${p}`));
const KOCHI = JSON.stringify({ location: { name: 'Kochi, Kerala, India', lat: 9.94, lon: 76.26 } });
async function fresh(storage = {}) {
  await send('Page.navigate', { url: APP });
  await sleep(300);
  await ev(`localStorage.clear(); localStorage.setItem('hs_settings', ${JSON.stringify(KOCHI)}); ${Object.entries(storage).map(([k, v]) => `localStorage.setItem('${k}', ${JSON.stringify(JSON.stringify(v))});`).join('')}`);
  await send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 50 && !(await ev('!!window.navigate').catch(() => false)); i++) await sleep(100);
}
const active = () => ev(`document.querySelector('.view.active')?.id`);
async function login(id, pass) {
  await ev(`document.getElementById('login-email').value = ${JSON.stringify(id)}; document.getElementById('login-pass').value = ${JSON.stringify(pass)}; document.querySelector('#view-auth form').requestSubmit();`);
  await sleep(200);
  return active();
}
async function shot(name) {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  writeFileSync(join(shotsDir, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
}

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  // Login cases
  await fresh();
  if (await active() !== 'view-auth') problems.push('[login] app should open on the sign-in screen');
  fail('structure', await ev(STRUCTURE));
  if (await login('admin', 'nope') !== 'view-auth' || await ev(`document.getElementById('login-error').hidden`)) problems.push('[login] wrong password should stay on sign-in with an error');
  if (await login(' Admin ', 'admin') !== 'view-dashboard') problems.push('[login] admin/admin (any case, stray spaces) should sign in');
  await fresh({ hs_user: { name: 'Riya', email: 'riya@mail.com', password: 'pw1', age: 22, weight: 55, gender: 'female', activity: 'light' } });
  if (await login('admin', 'admin') !== 'view-dashboard') problems.push('[login] admin/admin should sign in even when another account is registered');
  await ev('logout()');
  if (await login('riya@mail.com', 'pw1') !== 'view-dashboard') problems.push('[login] registered account should sign in');
  await fresh({ hs_user: { name: 'Test User', email: 'test@test.com', password: 'test123', age: 25, weight: 70, gender: 'male', activity: 'moderate' } });
  if (await login('admin', 'admin') !== 'view-dashboard') problems.push('[login] old test account should accept admin/admin');
  await send('Page.reload', {});
  await sleep(800);
  if (await active() !== 'view-dashboard') problems.push('[login] session should survive a reload');
  await ev('window.confirm = () => true; resetData()');
  if (await login('admin', 'admin') !== 'view-dashboard') problems.push('[login] admin/admin should work after Reset all data');

  // Settings: password change and profile edit
  await fresh({ hs_user: { name: 'Riya', email: 'riya@mail.com', password: 'pw1', age: 22, weight: 55, gender: 'female', activity: 'light' } });
  await login('riya@mail.com', 'pw1');
  await ev(`navigate('profile'); openSetting('set-password')`);
  const pw = (c, n, a) => ev(`pw_ = [${JSON.stringify(c)}, ${JSON.stringify(n)}, ${JSON.stringify(a)}]; ['pw-current','pw-new','pw-confirm'].forEach((id, i) => document.getElementById(id).value = pw_[i]); document.querySelector('#set-password form').requestSubmit(); document.getElementById('pw-error').hidden ? '' : document.getElementById('pw-error').textContent`);
  if (!(await pw('wrong', 'newpass', 'newpass'))) problems.push('[password] wrong current password should be rejected');
  if (!(await pw('pw1', 'newpass', 'other'))) problems.push('[password] mismatched confirmation should be rejected');
  if (await pw('pw1', 'newpass', 'newpass')) problems.push('[password] valid change was rejected');
  await ev('logout()');
  if (await login('riya@mail.com', 'pw1') !== 'view-auth') problems.push('[password] old password still signs in');
  if (await login('riya@mail.com', 'newpass') !== 'view-dashboard') problems.push('[password] new password should sign in');
  await ev(`navigate('profile'); openSetting('set-profile'); document.getElementById('prof-email-input').value = 'riya2'; document.getElementById('prof-weight').value = '60'; document.querySelector('#set-profile form').requestSubmit()`);
  const saved = await ev(`JSON.parse(localStorage.getItem('hs_user'))`);
  if (saved.email !== 'riya2' || saved.weight !== 60) problems.push('[profile] edit profile did not save email/weight');
  await ev(`navigate('profile'); openSetting('set-notifs')`);
  await send('Runtime.evaluate', { expression: 'history.back()' });
  await sleep(300);
  if (await ev(`document.getElementById('view-profile').classList.contains('has-page')`)) problems.push('[settings] back should return to the settings menu on phones');

  // Every screen at every width
  for (const [width, height] of WIDTHS) {
    const w = `${width}px`;
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await fresh();
    for (const [label, js] of [['sign-in', ''], ['register', `navigate('register')`]]) {
      if (js) await ev(js);
      await sleep(550);
      fail(`${w} ${label}`, await ev(AUDIT));
      await shot(`${width}-${label}`);
    }
    await ev(`navigate('auth')`);
    await login('admin', 'admin');
    await ev(`toggleDemo(); quickLog(250); quickLog(500)`);
    const states = [
      ['home', `navigate('dashboard')`],
      ['log-dialog', `openCustomLog()`],
      ['inbox', `closeModal(); testNotification(); openNotifs()`],
      ['stats-day', `closeModal(); navigate('history'); setStatsTab('day')`],
      ['stats-week', `setStatsTab('week')`],
      ['stats-month', `setStatsTab('month')`],
      ['stats-all', `setStatsTab('all')`],
      ['history', `navigate('streaks')`],
      ['settings', `navigate('profile')`],
      ...['set-profile', 'set-password', 'set-goal', 'set-location', 'set-notifs', 'set-quick', 'set-achievements', 'set-data', 'set-about']
        .map(id => [id, `openSetting('${id}')`]),
      ['set-goal-fixed', `openSetting('set-goal'); setGoalMode('manual')`],
    ];
    for (const [label, js] of states) {
      await ev(js);
      await sleep(label === 'home' ? 1500 : 550); // home waits for weather + ring animation
      fail(`${w} ${label}`, await ev(AUDIT));
      await shot(`${width}-${label}`);
    }
  }
} catch (e) {
  problems.push(`[runner] ${e.message}`);
} finally {
  fail('js error', [...new Set(jsErrors)]);
  ws.close();
  chrome.kill();
  server.close();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

if (problems.length) {
  console.error(`UI check failed (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`UI check passed: every screen at ${WIDTHS.length} sizes (320–1920px), login, password, profile, structure, no JS errors.`);
