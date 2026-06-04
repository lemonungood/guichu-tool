const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SETTINGS_FILE = path.join(app.getPath('userData'), 'preferences.json');

const DEFAULTS = {
  theme: {
    mode: 'system',     // 'light' | 'dark' | 'system'
    accentColor: '#e94560',
    bgColor: '#1a1a2e',
    surfaceColor: '#16213e',
    textColor: '#e0e0e0',
  },
  window: {
    width: 1400,
    height: 900,
  }
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      cache = { ...DEFAULTS, ...JSON.parse(raw) };
    } else {
      cache = { ...DEFAULTS };
    }
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(settings) {
  cache = settings;
  try {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch {}
}

function get(key) {
  const s = load();
  const parts = key.split('.');
  let val = s;
  for (const p of parts) {
    if (val == null) return undefined;
    val = val[p];
  }
  return val;
}

function set(key, value) {
  const s = load();
  const parts = key.split('.');
  let obj = s;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]]) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
  save(s);
}

function getAll() {
  return { ...load() };
}

module.exports = { load, save, get, set, getAll, DEFAULTS };
