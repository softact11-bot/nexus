// Settings store: one localStorage key, JSON export / import. Survives a blocked or missing localStorage (then memory only).
// M4e: every save is mirrored to the server (POST /api/settings, same JSON as exportJSON); empty localStorage imports the server copy (end of file).
const KEY = 'nexus.settings.v1';
let s = {}, had = false, tm;
try { const v = localStorage.getItem(KEY); had = v != null; s = JSON.parse(v) || {}; } catch { }
const push = () => fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: exportJSON() }).catch(() => { });
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { } clearTimeout(tm); tm = setTimeout(push, 400); }; // ponytail: last write wins across windows; export stays the backup
const okFile = o => o?.version === 1 && !!o.settings && typeof o.settings === 'object' && !Array.isArray(o.settings);

export const get = (k, d) => s[k] ?? d;
export function set(k, v) { if (v === undefined) delete s[k]; else s[k] = v; save(); }
export const exportJSON = () => JSON.stringify({ version: 1, settings: s }, null, 2);
export function importJSON(txt) {
  const o = JSON.parse(txt);
  if (!okFile(o)) throw new Error('Not a NEXUS settings file (version 1).');
  s = o.settings; save(); emit('*'); // listeners (sound, motion, graph) apply the imported prefs at once
}

// ---------- preferences: defaults + change events (the future Settings page edits these keys; nothing else stores them) ----------
// Graph presets fill every graph.* value; a key set on its own (graph.bloom …) overrides its preset value.
export const GRAPH_PRESETS = {
  minimal: { bloom: .22, bright: .85, links: .6, particles: .12, size: .9, labels: .7, anim: .6, quality: 2 },
  balanced: { bloom: .45, bright: 1, links: .8, particles: .15, size: 1, labels: 1, anim: 1, quality: 1 },
  cinematic: { bloom: .8, bright: 1.15, links: 1, particles: .8, size: 1.1, labels: 1.2, anim: 1.2, quality: 0 },
};
export const DEFAULTS = {
  'graph.preset': 'balanced',
  'sound.mute': false, 'sound.volume': .5, 'sound.hover': true, 'sound.notify': true,
  'anim.speed': 1, 'anim.intensity': 1, 'anim.reduced': 'system', // system | on | off
  'ui.theme': 'glass', 'ui.accent': '#B794FF', 'ui.layout': 'standard', 'ui.bg': 'nebula', 'ui.glassBg': 'crt', 'ui.bgShuffle': false,
  'a11y.cb': 'off', 'a11y.contrast': false, 'a11y.scale': 100, 'a11y.focus': true,
  'cc.limit5h': null, 'cc.alertPct': 80, 'cc.wasteTok': 7500, 'cc.ctxWarn': 70, 'cc.monitor': true, 'cc.watch': true, 'cc.term': 'wt', 'cc.shell': 'pwsh', 'cc.refresh': 5,
  'obs.view': '3d', 'obs.mode': 'graphify', 'obs.tab': 'overview', 'obs.height': 540, 'obs.live': true, 'obs.toasts': true, 'obs.kgHealth': false,
  'obs.edFont': 14, 'obs.wrap': true, 'obs.confirm': true,
  'pl.refresh': 'manual', 'pl.days': 7, 'pl.dup': true, 'pl.alertTok': 20000, 'pl.freq': 'session', 'pl.risk': true, 'pl.tab': 'installed', 'pl.key': [],
  'au.notices': true, 'au.confirmSync': true, 'sh.bell': true,
  'perf.fps': 60, 'perf.live': 'live', // live (10 s) | slow (30 s) | manual
};
export const pref = k => s[k] ?? DEFAULTS[k];
export function graphPrefs() { const p = { ...(GRAPH_PRESETS[pref('graph.preset')] || GRAPH_PRESETS.balanced) }; for (const k in p) if (s['graph.' + k] != null) p[k] = s['graph.' + k]; return p; }
export const reducedMotion = () => { const r = pref('anim.reduced'); return r === 'on' || (r === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches); };
const subs = new Set();
export const onChange = f => { subs.add(f); return () => subs.delete(f); };
const emit = k => { for (const f of subs) try { f(k); } catch (e) { console.error(e); } };
export function setPref(k, v) { set(k, v); emit(k); }
// Settings page: edits preview in memory (draft) and are stored only on Save (persist). snapshot/load restore whole states (undo, discard).
export function draft(k, v) { if (v === undefined) delete s[k]; else s[k] = v; emit(k); }
export const persist = save;
export const snapshot = () => JSON.parse(JSON.stringify(s));
export function load(o, keep) { s = JSON.parse(JSON.stringify(o)); if (keep) save(); emit('*'); }
export const sandbox = false;
addEventListener('storage', e => { if (e.key !== KEY) return; try { s = JSON.parse(e.newValue) || {}; } catch { } emit('*'); }); // another NEXUS tab changed them
if (had) push(); // server copy follows this browser's prefs (first run after M4e included)
else fetch('/api/settings', { cache: 'no-store' }).then(x => x.json()).then(o => { if (!okFile(o) || Object.keys(s).length) return; s = o.settings; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { } emit('*'); }).catch(() => { });
