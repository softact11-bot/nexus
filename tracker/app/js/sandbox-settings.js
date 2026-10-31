// Settings PREVIEW sandbox: same exports as settings.js, memory only. settings-preview.html maps "./js/settings.js" here through its
// import map, so the real graph3d.js / sound.js run unchanged against these values. Starts from a read-only copy of the saved prefs;
// never writes localStorage, never listens to other tabs. DEFAULTS mirror settings.js (this file
// stands in for it through the import map, so it cannot import it).
const KEY = 'nexus.settings.v1';
let s = {};
try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { }

export const get = (k, d) => s[k] ?? d;
export function set(k, v) { if (v === undefined) delete s[k]; else s[k] = v; }
export const exportJSON = () => JSON.stringify({ version: 1, settings: s }, null, 2);
export function importJSON(txt) {
  const o = JSON.parse(txt);
  if (o?.version !== 1 || !o.settings || typeof o.settings !== 'object' || Array.isArray(o.settings)) throw new Error('Not a NEXUS settings file (version 1).');
  s = o.settings; emit('*');
}

export const GRAPH_PRESETS = {
  minimal: { bloom: .22, bright: .85, links: .6, particles: .12, size: .9, labels: .7, anim: .6, quality: 2 },
  balanced: { bloom: .45, bright: 1, links: .8, particles: .15, size: 1, labels: 1, anim: 1, quality: 1 },
  cinematic: { bloom: .8, bright: 1.15, links: 1, particles: .8, size: 1.1, labels: 1.2, anim: 1.2, quality: 0 },
};
export const DEFAULTS = {
  'graph.preset': 'balanced',
  'sound.mute': false, 'sound.volume': .5, 'sound.hover': true, 'sound.notify': true,
  'anim.speed': 1, 'anim.intensity': 1, 'anim.reduced': 'system',
  // proposed (preview only until the Settings page ships)
  'ui.theme': 'glass', 'ui.accent': '#B794FF', 'ui.layout': 'standard', 'ui.bg': 'nebula', 'ui.glassBg': 'crt', 'ui.bgShuffle': false,
  'a11y.cb': 'off', 'a11y.contrast': false, 'a11y.scale': 100, 'a11y.focus': true,
  'cc.limit5h': null, 'cc.alertPct': 80, 'cc.wasteTok': 7500, 'cc.ctxWarn': 70, 'cc.monitor': true, 'cc.term': 'wt',
  'obs.view': '3d', 'obs.mode': 'graphify', 'obs.tab': 'overview', 'obs.height': 540, 'obs.live': true, 'obs.toasts': true, 'obs.kgHealth': false,
  'obs.edFont': 14, 'obs.wrap': true, 'obs.confirm': true,
  'pl.refresh': 'manual', 'pl.days': 7, 'pl.dup': true, 'pl.alertTok': 20000, 'pl.freq': 'session', 'pl.risk': true, 'pl.tab': 'installed', 'pl.key': [],
  'au.notices': true, 'au.confirmSync': true, 'sh.bell': true,
  'perf.fps': 60, 'perf.live': 'live',
};
export const pref = k => s[k] ?? DEFAULTS[k];
export function graphPrefs() { const p = { ...(GRAPH_PRESETS[pref('graph.preset')] || GRAPH_PRESETS.balanced) }; for (const k in p) if (s['graph.' + k] != null) p[k] = s['graph.' + k]; return p; }
export const reducedMotion = () => { const r = pref('anim.reduced'); return r === 'on' || (r === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches); };
const subs = new Set();
export const onChange = f => { subs.add(f); return () => subs.delete(f); };
const emit = k => { for (const f of subs) try { f(k); } catch (e) { console.error(e); } };
export function setPref(k, v) { set(k, v); emit(k); }
export const draft = setPref, persist = () => { }, sandbox = true; // Save is a no-op here
// preview-only extras: whole-state snapshot / restore (undo, redo, discard, reset)
export const snapshot = () => JSON.parse(JSON.stringify(s));
export function load(o) { s = JSON.parse(JSON.stringify(o)); emit('*'); }
