// weather.js — Open-Meteo forecast + geocoding, no key needed (→ http package in Flutter)

import { getSettings } from './storage.js';

let cache = null; // { key, at, data }
const CACHE_MS = 30 * 60 * 1000;

function devicePosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, name: 'Current location' }),
      reject,
      { timeout: 10000, maximumAge: 30 * 60 * 1000 },
    );
  });
}

// City-level position from the network. Needs no permission or HTTPS, so it covers
// phones opening the app over plain http on the LAN, where browsers block GPS.
async function networkPosition() {
  for (const url of ['https://get.geojs.io/v1/ip/geo.json', 'https://ipwho.is/']) {
    try {
      const d = await (await fetch(url)).json();
      const lat = +d.latitude, lon = +d.longitude;
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, name: d.city || d.region || 'Your area', approx: true };
    } catch {}
  }
  throw new Error('no network location');
}

// Returns live weather, or { fallback: true, reason } when it can't be fetched.
export async function getWeather(force = false) {
  let loc = getSettings().location;
  if (!loc) {
    try {
      loc = await devicePosition();
    } catch {
      try { loc = await networkPosition(); } catch { return { fallback: true, reason: 'location', forecast: [] }; }
    }
  }

  const key = `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;
  if (!force && cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.data;

  try {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${loc.lat}&longitude=${loc.lon}`
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,uv_index'
      + '&daily=weather_code,temperature_2m_max,apparent_temperature_max,relative_humidity_2m_mean,uv_index_max'
      + '&forecast_days=7&timezone=auto';
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    const c = d.current, dl = d.daily;
    const data = {
      place: loc.name,
      approx: !!loc.approx,
      temp: c.temperature_2m,
      feels: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      uv: c.uv_index ?? 0,
      code: c.weather_code,
      label: weatherLabel(c.weather_code),
      forecast: dl.time.map((date, i) => ({
        date,
        tempMax: dl.temperature_2m_max[i],
        feels: dl.apparent_temperature_max[i],
        humidity: dl.relative_humidity_2m_mean[i],
        uv: dl.uv_index_max[i],
        code: dl.weather_code[i],
        label: weatherLabel(dl.weather_code[i]),
      })),
    };
    cache = { key, at: Date.now(), data };
    return data;
  } catch {
    return { fallback: true, reason: 'network', place: loc.name, forecast: [] };
  }
}

export async function searchCity(q) {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
  if (!res.ok) throw new Error(res.status);
  const d = await res.json();
  return (d.results || []).map(x => ({
    name: [x.name, x.admin1, x.country].filter(Boolean).join(', '),
    lat: x.latitude,
    lon: x.longitude,
  }));
}

export function weatherLabel(code) {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Cloudy';
  if (code <= 49) return 'Foggy';
  if (code <= 69) return 'Rainy';
  if (code <= 79) return 'Snowy';
  if (code <= 99) return 'Stormy';
  return 'Unknown';
}
