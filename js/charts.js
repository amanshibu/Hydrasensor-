// charts.js — Canvas chart helpers

// roundRect polyfill for Safari < 16
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
    const r = Array.isArray(radii) ? radii[0] || 0 : radii || 0;
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.arcTo(x + w, y, x + w, y + r, r);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.lineTo(x, y + r);
    this.arcTo(x, y, x + r, y, r);
    this.closePath();
  };
}

export const COLORS = {
  text: '#171619',
  dim: '#625F69',
  met: '#171619',
  below: '#8A7AB5',
  series: '#5E4E88',
  track: '#E7E1EE',
  grid: 'rgba(23,22,25,0.07)',
  surface: '#F7F5F0',
};
const ACCENT = '#A99BC7';
const FONT = 'Manrope, system-ui, sans-serif';

// Sizes the canvas to its parent's box so CSS never stretches it.
function fit(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export const fmtVol = v => (v >= 1000 ? `${+(v / 1000).toFixed(1)} L` : `${Math.round(v)} ml`);
const niceMax = v => { const step = v > 2000 ? 1000 : v > 1000 ? 500 : 250; return Math.max(step, Math.ceil(v / step) * step); };

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const easeOut = t => 1 - (1 - t) ** 3;
const RING_MS = 1100;

// Tweens from whatever is on screen to the new value; waves keep drifting while the ring is visible.
export function drawRing(canvas, percent, consumed, goal, unit = 'ml') {
  const box = canvas.parentElement;
  const size = Math.min(box.clientWidth, box.clientHeight || box.clientWidth);
  if (size <= 0) return;
  const st = canvas._ring ||= { p: 0, v: 0 };
  if (st.size !== size) { st.ctx = fit(canvas, size, size); st.size = size; }
  Object.assign(st, { fromP: st.p, fromV: st.v, toP: Math.min(percent, 1), toV: consumed, goal, unit, t0: performance.now() });
  if (!st.raf) st.raf = requestAnimationFrame(t => ringFrame(canvas, st, t));
}

// ponytail: runs every frame while Home is open; rAF pauses it in background tabs, and it stops when the view hides.
function ringFrame(canvas, st, now) {
  st.raf = 0;
  if (!canvas.isConnected || !canvas.offsetParent) return; // view hidden; next drawRing restarts it
  const still = reduceMotion();
  const k = still ? 1 : easeOut(Math.min(1, (now - st.t0) / RING_MS));
  st.p = st.fromP + (st.toP - st.fromP) * k;
  st.v = st.fromV + (st.toV - st.fromV) * k;
  paintRing(st, still ? 0 : now / 1000);
  if (!still) st.raf = requestAnimationFrame(t => ringFrame(canvas, st, t));
}

function wave(ctx, level, amp, w, phase, color) {
  ctx.beginPath();
  ctx.moveTo(0, w);
  for (let x = 0; x <= w; x += 4) ctx.lineTo(x, level + Math.sin((x / w) * Math.PI * 2 + phase) * amp);
  ctx.lineTo(w, w);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function paintRing({ ctx, size, p, v, goal, unit }, t) {
  const lineWidth = Math.max(10, size * 0.065);
  const cx = size / 2, cy = size / 2, r = size / 2 - lineWidth / 2 - 2;
  const start = -Math.PI / 2;
  ctx.clearRect(0, 0, size, size);

  // Water level inside the ring follows progress.
  if (p > 0) {
    const inner = r - lineWidth / 2 - 5;
    const level = cy + inner - 2 * inner * p;
    const amp = size * 0.02;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.clip();
    wave(ctx, level - amp * 0.5, amp, size, t * 1.7, 'rgba(169,155,199,0.35)');
    wave(ctx, level, amp, size, -t * 1.2 + 2, 'rgba(169,155,199,0.5)');
    ctx.restore();
  }

  ctx.lineCap = 'round';
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = COLORS.track;
  ctx.stroke();

  if (p > 0) {
    let stroke = COLORS.text;
    if (p < 1 && ctx.createConicGradient) {
      stroke = ctx.createConicGradient(start, cx, cy);
      stroke.addColorStop(0, ACCENT);
      stroke.addColorStop(p, COLORS.series);
    } else if (p < 1) {
      stroke = COLORS.series;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + Math.PI * 2 * p);
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.text;
  ctx.font = `500 ${Math.round(size * 0.21)}px ${FONT}`;
  ctx.fillText(`${Math.round(p * 100)}%`, cx, cy - size * 0.04);
  ctx.font = `500 ${Math.round(size * 0.058)}px ${FONT}`;
  ctx.fillStyle = COLORS.dim;
  ctx.fillText(`${Math.round(v).toLocaleString('en')} / ${goal.toLocaleString('en')} ${unit}`, cx, cy + size * 0.13);
}

function axisY(ctx, max, left, top, plotW, chartH) {
  ctx.font = `500 11px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const t of [0, max / 2, max]) {
    const y = Math.round(top + chartH - (t / max) * chartH) + 0.5;
    ctx.fillStyle = COLORS.grid;
    ctx.fillRect(left, y, plotW, 1);
    ctx.fillStyle = COLORS.dim;
    ctx.fillText(t ? fmtVol(t) : '0', 0, y);
  }
}

// bars: [{ value, label?, tip, color?, goal? }]
export function drawBars(canvas, bars, { height = 200, maxBarW = 40 } = {}) {
  const w = canvas.parentElement.clientWidth;
  if (w <= 0 || !bars.length) return;
  const ctx = fit(canvas, w, height);

  const left = 44, top = 10, bottom = 26;
  const plotW = w - left, chartH = height - top - bottom;
  const max = niceMax(Math.max(1, ...bars.map(b => Math.max(b.value, b.goal || 0))) * 1.05);
  axisY(ctx, max, left, top, plotW, chartH);

  const slot = plotW / bars.length;
  const bw = Math.max(2, Math.min(maxBarW, slot - Math.max(2, slot * 0.35)));
  const radius = Math.min(4, bw / 2);
  const hits = [];

  bars.forEach((b, i) => {
    const sx = left + i * slot;
    const x = sx + (slot - bw) / 2;
    const bh = b.value > 0 ? Math.max(3, (b.value / max) * chartH) : 0;
    const y = top + chartH - bh;
    if (bh) {
      ctx.fillStyle = b.color || COLORS.series;
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, [radius, radius, 0, 0]);
      ctx.fill();
    }
    if (b.goal) {
      const gy = Math.round(top + chartH - (b.goal / max) * chartH);
      ctx.fillStyle = COLORS.surface;
      ctx.fillRect(x - 3, gy - 2, bw + 6, 4);
      ctx.fillStyle = COLORS.dim;
      ctx.fillRect(x - 3, gy - 1, bw + 6, 2);
    }
    if (b.label) {
      ctx.fillStyle = b.strong ? COLORS.text : COLORS.dim;
      ctx.font = `${b.strong ? 600 : 500} 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(b.label, x + bw / 2, height - 6);
    }
    hits.push({ x0: sx, x1: sx + slot, cx: x + bw / 2, cy: Math.min(y, b.goal ? top + chartH - (b.goal / max) * chartH : y), tip: b.tip, key: b.key });
  });

  canvas._hit = px => hits.find(h => px >= h.x0 && px < h.x1);
}

// points: [{ x, y, tip }]; trend: x => y (optional)
export function drawScatter(canvas, points, { height = 240, trend = null, xUnit = '°C' } = {}) {
  const w = canvas.parentElement.clientWidth;
  if (w <= 0 || !points.length) return;
  const ctx = fit(canvas, w, height);

  const left = 44, top = 10, bottom = 30, right = 22;
  const plotW = w - left - right, chartH = height - top - bottom;
  const xs = points.map(p => p.x);
  const x0 = Math.floor(Math.min(...xs) - 1), x1 = Math.ceil(Math.max(...xs) + 1);
  const max = niceMax(Math.max(...points.map(p => p.y)) * 1.05);
  axisY(ctx, max, left, top, plotW, chartH);

  const px = x => left + ((x - x0) / (x1 - x0)) * plotW;
  const py = y => top + chartH - (Math.max(0, y) / max) * chartH;

  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const step = Math.max(1, Math.ceil((x1 - x0) / 6));
  for (let x = x0; x <= x1; x += step) ctx.fillText(`${x}${xUnit}`, px(x), height - 8);

  const hits = [];
  for (const p of points) {
    const cx = px(p.x), cy = py(p.y);
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.below;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.surface;
    ctx.stroke();
    hits.push({ cx, cy, tip: p.tip });
  }

  if (trend) {
    ctx.beginPath();
    ctx.moveTo(px(x0), py(trend(x0)));
    ctx.lineTo(px(x1), py(trend(x1)));
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  canvas._hit = (mx, my) => {
    let best = null, bd = 24 * 24;
    for (const h of hits) { const d = (h.cx - mx) ** 2 + (h.cy - my) ** 2; if (d < bd) { bd = d; best = h; } }
    return best;
  };
}

// One tooltip per chart; reads canvas._hit set by the last draw.
export function attachTooltip(canvas) {
  if (canvas._tipBound) return;
  canvas._tipBound = true;
  const wrap = canvas.parentElement;
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.setAttribute('role', 'tooltip');
  wrap.appendChild(tip);

  const show = e => {
    const r = canvas.getBoundingClientRect();
    const h = canvas._hit?.(e.clientX - r.left, e.clientY - r.top);
    if (!h || !h.tip) return hide();
    tip.textContent = h.tip;
    tip.style.left = `${Math.min(Math.max(h.cx, 60), r.width - 60)}px`;
    tip.style.top = `${h.cy}px`;
    tip.classList.add('show');
  };
  const hide = () => tip.classList.remove('show');
  canvas.addEventListener('pointermove', show);
  canvas.addEventListener('pointerdown', show);
  canvas.addEventListener('pointerleave', hide);
  // Bars that carry a day key open that day.
  canvas.addEventListener('click', e => {
    const r = canvas.getBoundingClientRect();
    const h = canvas._hit?.(e.clientX - r.left, e.clientY - r.top);
    if (h?.key) window.openDay?.(h.key);
  });
}
