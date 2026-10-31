// Settings (Phase F). Every control previews at once (S.draft: memory only, the real systems react) and is stored only on Save
// Changes (S.persist → nexus.settings.v1). Undo/Redo, Discard, Reset to Default (previews defaults), leave guard. Consumers:
// look.js (ui.*, a11y.*), main.js (anim.* motion, bell alerts cc.* / pl.* / au.notices, perf.live, catalog refresh), graph3d.js
// (graph.*, perf.fps), sound.js (sound.*), pages knowledge / plugins / projects (obs.*, pl.*, cc.term, au.confirmSync).
// The two tracker values (5-hour limit, waste-tip size) go to the tracker's config.json on Save, after a confirm.
// settings-preview.html runs this same page on the memory-only sandbox store (S.sandbox): Save there stores nothing.
// Data: GET /api/graph, /api/inv, /api/proc, /api/vault, /api. Nothing here runs a job.
import * as S from '../settings.js';
import * as Sound from '../sound.js';
import { CVD } from '../look.js';
import { esc, ago } from '../fmt.js';
import { toast, MORE, more, errBox } from '../ui.js';

// M7d D3 Learn More (approved Settings copy)
Object.assign(MORE, {
 "set-limit5h": {
  "title": "5-hour window limit",
  "what": "How many tokens Claude allows you in a 5-hour window, so NEXUS can show how much is used as a % and warn you before you run out. Empty = unknown.",
  "when": [
   "You know your plan's 5-hour limit and want the % and usage alerts."
  ],
  "impact": {
   "tokens": "None used",
   "privacy": "Stays on this PC",
   "files": "Tracker config.json, after you confirm",
   "load": "None"
  },
  "notes": [
   "Saved only when you press Save Changes and confirm.",
   "It only changes what NEXUS shows. Your real Claude limit stays the same.",
   "Usage alerts need this value."
  ],
  "tech": "Save → POST /api/act {a:\"config\", fiveHourLimitTokens}. Only that key changes in config.json.",
  "area": "Settings"
 },
 "set-wastetip": {
  "title": "Waste tip size",
  "what": "Tool outputs bigger than this many tokens get a \"narrow it down\" tip, so you can spot commands that waste usage.",
  "when": [
   "You get too many tips (raise it) or want to catch smaller waste (lower it)."
  ],
  "impact": {
   "tokens": "None used",
   "privacy": "Stays on this PC",
   "files": "Tracker config.json, after you confirm",
   "load": "None"
  },
  "notes": [
   "Saved only when you press Save Changes and confirm."
  ],
  "tech": "Stored as characters: oversizedChars = tokens × 4 (POST /api/act {a:\"config\"}).",
  "area": "Settings"
 },
 "set-guards": {
  "title": "Resource guards",
  "what": "Delays or skips automations while your PC is busy, low on RAM or disk, or while Claude is working.",
  "when": [
   "Automations slow down games, Studio or Blender.",
   "You want automations to wait while Claude is busy."
  ],
  "impact": {
   "tokens": "None used",
   "privacy": "Stays on this PC",
   "files": "NEXUS_DATA/automations.json, after you confirm",
   "load": "None"
  },
  "notes": [
   "Has its own Save guards button: Save Changes does not save these.",
   "Blank per-automation values use the values above."
  ],
  "tech": "POST /api/auto {op:\"guards\", g, over, confirm:true}. Busy = Claude wrote its transcript in the last 120 s, or a turn is still open.",
  "area": "Settings"
 },
 "set-limits": {
  "title": "Alert limits",
  "what": "When System Health sends an alert: CPU, RAM, disk, GPU temperature, how long a problem must last, and how long to wait before repeating it.",
  "when": [
   "Alerts come too often (raise the limits or the wait) or too late (lower them)."
  ],
  "impact": {
   "tokens": "None used",
   "privacy": "Stays on this PC",
   "files": "NEXUS_DATA/sys-limits.json, after you confirm",
   "load": "None"
  },
  "notes": [
   "Has its own Save limits button: Save Changes does not save these.",
   "The disk limit applies right away.",
   "A NEXUS service failure always alerts at once."
  ],
  "tech": "POST /api/sys {op:\"limits\", l, confirm:true}. Readings every 5 s.",
  "area": "Settings"
 },
 "set-reset": {
  "title": "Reset to Default",
  "what": "Shows every setting at its default value so you can look first.",
  "when": [
   "Something looks wrong and you want a clean start."
  ],
  "impact": {
   "tokens": "None used",
   "privacy": "Stays on this PC",
   "files": "Nothing until you press Save Changes",
   "load": "None"
  },
  "notes": [
   "Discard brings your own values back.",
   "Resource guards and alert limits are not reset (they save on their own)."
  ],
  "tech": "Loads an empty settings snapshot into the editor; S.persist() runs only on Save Changes.",
  "area": "Settings"
 },
 "set-io": {
  "title": "Export and Import",
  "what": "Export saves your NEXUS settings to a .json file. Import loads one back in.",
  "when": [
   "Backing up your settings, or moving them to another PC."
  ],
  "impact": {
   "tokens": "None used",
   "privacy": "Stays on this PC",
   "files": "Export writes the file you download; Import changes nothing until Save Changes",
   "load": "None"
  },
  "notes": [
   "Import is only a preview until you press Save Changes.",
   "Files that are not NEXUS settings version 1 are refused."
  ],
  "tech": "File format: { version: 1, settings: {...} }.",
  "area": "Settings"
 }
});
const LM = { 'cc.limit5h': 'set-limit5h', 'cc.wasteTok': 'set-wastetip' };
const NOSAVE = "NEXUS couldn't reach its tracker, so nothing was saved. Your changes are still on screen. Retry once the tracker is running.";
const refused = r => toast('The tracker refused the save, so nothing changed. Your changes are still on screen. Reason: ' + r, 'err', "Couldn't save");

const sb = S.sandbox, $ = id => document.getElementById(id);
const getJ = async u => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };

// ---------- status marks (no fake toggles) ----------
const MARK = { live: ['live', 'Live now', sb ? 'Real NEXUS systems use this; here they run on sandbox values.' : 'Works now: previews at once, stored when you press Save Changes.'],
  p11: ['demo', 'Phase 11', 'Arrives with Phase 11 (Living UI). Shown so the layout has room; not adjustable yet.'],
  pe: ['est', 'Phase E', 'Planned for Phase E. Not adjustable yet.'], ro: ['unk', 'Read-only', 'Shown from real files; change it where the note says.'] };
const mark = m => { const [c, t, tip] = MARK[m]; return `<span class="chip ${c}" title="${esc(tip)}">${t}</span>`; };
const icon = id => `<svg class="ic"><use href="#${id}"/></svg>`;
const TERM = { wt: 'Windows Terminal', pwsh: 'PowerShell', bash: 'Git Bash' };

// ---------- categories + controls ----------
// control: [key, label, type, opts, mark, help]   type: seg | tog | range | sel | num | swatch | tiles | info | link | hooks | keys
const pct = v => Math.round(v * 100) + '%';
const CATS = [
  { id: 'look', ic: 'i-palette', t: 'Appearance & Themes', sub: 'Themes, colours, layout', pv: 'look', cards: [
    ['Theme', [['ui.theme', 'Theme', 'tiles', [['glass', 'Purple glass'], ['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto'], ['cyber', 'Cyber']], 'live', 'Auto follows the Windows light/dark setting.']]],
    ['Accent colour', [['ui.accent', 'Accent', 'swatch', ['#B794FF', '#31D67A', '#3D8BFF', '#7A6BFF', '#E05FD0', '#FF8A3D', '#F2B544', '#2EE6D6', '#E85D75'], 'live']]],
    ['Layout & background', [['ui.layout', 'Layout', 'seg', [['standard', 'Standard'], ['compact', 'Compact'], ['wide', 'Wide']], 'live', 'Compact tightens spacing; Wide narrows the sidebar and lets pages use the full width.'],
      ['ui.bg', 'Background', 'sel', [['nebula', 'Nebula glow'], ['aurora', 'Aurora'], ['grid', 'Grid'], ['plain', 'Plain']], 'live', 'Dark, Light, Auto and Cyber themes.'],
      ['ui.glassBg', 'Purple glass background', 'sel', [['crt', 'CRT Warp (default)'], ['ripple', 'Ripple Distortion'], ['waves', 'Pattern Waves'], ['flux', 'Flux Lines'], ['shapes', 'Shape Waves'], ['fibers', 'Ghost Fibers'], ['molten', 'Molten Metal'], ['bends', 'Color Bends'], ['pillar', 'Light Pillar'], ['terminal', 'Faulty Terminal'], ['galaxy', 'Galaxy'], ['silk', 'Silk'], ['slats', 'Micro Slats']], 'live', 'Animated React Bits backdrop behind the app (Purple glass theme).'],
      ['ui.bgShuffle', 'Shuffle background every 10 min', 'tog', null, 'live', 'Picks a different random Purple glass background every 10 minutes.']]] ] },
  { id: 'graph', ic: 'i-graph', t: 'Graph Customization', sub: 'Knowledge graph, nodes, effects', pv: 'graph', cards: [
    ['Presets', [['graph.preset', 'Preset', 'seg', [['minimal', 'Minimal'], ['balanced', 'Balanced'], ['cinematic', 'Cinematic']], 'live', 'A preset fills every value below. Moving a slider makes it Custom.']]],
    ['Look', [['graph.bright', 'Node brightness', 'range', [.5, 1.5, .05, pct], 'live'], ['graph.links', 'Connection opacity', 'range', [.1, 1, .05, pct], 'live'],
      ['graph.bloom', 'Bloom intensity', 'range', [0, 1.2, .02, pct], 'live'], ['graph.particles', 'Particle density', 'range', [0, 1, .02, pct], 'live'],
      ['graph.size', 'Node size', 'range', [.6, 1.6, .05, pct], 'live'], ['graph.labels', 'Label visibility', 'range', [.3, 2, .05, pct], 'live', 'How many node labels fit at a given zoom.'],
      ['graph.anim', 'Animation speed', 'range', [0, 2, .05, pct], 'live', 'Auto-rotate and flow speed.']]] ] },
  { id: 'anim', ic: 'i-wand', t: 'Animations & Visual Effects', sub: 'Motion, particles, performance', pv: 'anim', cards: [
    ['Animation intensity', [['anim.intensity', 'Intensity', 'seg', [[0, 'Off'], [.5, 'Subtle'], [1, 'Balanced'], [1.6, 'Cinematic']], 'live', 'How far pages and panels slide in.'],
      ['anim.speed', 'Interface speed', 'range', [.5, 2, .05, v => v.toFixed(2) + '×'], 'live', 'Page, menu and dialog transition speed.'],
      ['anim.reduced', 'Reduced motion', 'seg', [['system', 'Follow Windows'], ['on', 'On'], ['off', 'Off']], 'live', 'On stops slides, auto-rotate and graph flow.']]],
    ['Living UI', [['anim.continuous', 'Continuous graph animation', 'tog', null, 'p11'], ['anim.pulses', 'Energy pulses on links', 'tog', null, 'p11'],
      ['anim.particles', 'Particles near important nodes', 'tog', null, 'p11'], ['anim.move', 'Graph movement speed', 'range', [0, 2, .1, pct], 'p11'],
      ['anim.charts', 'Chart and counter motion', 'tog', null, 'p11']]] ] },
  { id: 'sound', ic: 'i-vol', t: 'Sound Effects & Notifications', sub: 'Audio, alerts, feedback', pv: 'sound', cards: [
    ['Sound', [['sound.mute', 'Mute all sounds', 'tog', null, 'live'], ['sound.volume', 'Master volume', 'range', [0, 1, .05, pct], 'live'],
      ['sound.hover', 'Hover sounds', 'tog', null, 'live', 'Only on main buttons and the sidebar.'], ['sound.notify', 'Notification sounds', 'tog', null, 'live', 'Sync, success, warning and error chimes.']]],
    ['Always on', [['', 'Background activity stays silent', 'info', 'Sounds only follow something you did in the last 8 seconds, so live updates and background jobs never make noise.', 'ro']]] ] },
  { id: 'a11y', ic: 'i-a11y', t: 'Accessibility', sub: 'Colour blind, contrast, text', pv: 'a11y', cards: [
    ['Colour blind support', [['a11y.cb', 'Mode', 'seg', [['off', 'Off'], ['protan', 'Protanopia'], ['deutan', 'Deuteranopia'], ['tritan', 'Tritanopia']], 'live', 'Tuned status colours in every mode, with icons and line patterns, so colour is never the only cue.']]],
    ['Reading', [['a11y.scale', 'Interface scale', 'range', [90, 120, 5, v => v + '%'], 'live'], ['a11y.contrast', 'High contrast', 'tog', null, 'live', 'Brighter text and borders.'],
      ['a11y.focus', 'Keyboard focus rings', 'tog', null, 'live', 'A clear ring around the focused control when using Tab.']]],
    ['Motion', [['', 'Reduced motion', 'link', 'anim', 'live']]] ] },
  { id: 'cc', ic: 'i-term', t: 'Claude Code Preferences', sub: 'Alerts, tips, terminal', pv: 'cc', cards: [
    ['Token Tracker & alerts', [['cc.limit5h', '5-hour window limit (tokens)', 'num', [0, 1e10, 100000, 'Unknown'], 'live', 'Empty = unknown (the tracker shows no %). Written to the tracker\'s config.json when you press Save Changes, after you confirm.'],
      ['cc.alertPct', 'Usage alert at', 'range', [50, 95, 5, v => v + '% of window'], 'live', 'A bell notice once the window passes this share of your limit (needs a limit).'],
      ['cc.wasteTok', 'Waste tip: tool output over', 'range', [2500, 20000, 500, v => v.toLocaleString() + ' tok'], 'live', 'Written to config.json (oversizedChars = tokens × 4) on Save, after you confirm.'],
      ['cc.ctxWarn', 'Context warning in NEXUS at', 'range', [50, 90, 5, v => v + '% context'], 'live', 'A bell notice in NEXUS. The Context Advisor hook itself is not changed.']]],
    ['Monitoring & terminal', [['cc.monitor', 'Plugin and skill monitoring', 'tog', null, 'live', 'Bell alerts for duplicate loads and heavy tools (details under Plugins & Skills).'],
      ['cc.watch', 'Session alerts', 'tog', null, 'live', 'A toast when a Claude Code session on this PC needs you (permission, question) or finishes after 30 s+ of work. The bell keeps them either way.'],
      ['cc.term', 'Open terminals in', 'seg', [['wt', 'Windows Terminal'], ['pwsh', 'PowerShell'], ['bash', 'Git Bash']], 'live', 'Used by New Session, Resume, terminals and AI Tools on the Projects and Claude Code pages.'],
      ['cc.shell', 'Embedded terminal shell (desktop app)', 'seg', [['pwsh', 'PowerShell 7'], ['powershell', 'PowerShell'], ['cmd', 'cmd'], ['bash', 'Git Bash'], ['wsl', 'WSL']], 'live', 'New terminals in the Claude Code page of the desktop app. A shell that is not installed falls back to the first one found.'],
      ['cc.refresh', 'Claude Code page refresh', 'seg', [[2, '2 s'], [5, '5 s'], [10, '10 s'], [30, '30 s'], [0, 'Off']], 'live', 'How often the Claude Code page reads the live session, git and system data. Paused while the tab is hidden.']]] ] },
  { id: 'obs', ic: 'i-book', t: 'Obsidian & Graphify', sub: 'Sync, graph, notes, view', pv: 'obs', cards: [
    ['Graph defaults', [['obs.mode', 'Default graph view', 'seg', [['graphify', 'Graphify communities'], ['nexus', 'NEXUS clusters']], 'live'], ['obs.view', 'Dimension', 'seg', [['3d', '3D'], ['2d', '2D']], 'live'],
      ['obs.tab', 'Default tab', 'sel', [['overview', 'Overview'], ['notes', 'Notes'], ['graph', 'Graph View'], ['tags', 'Tags'], ['search', 'Search'], ['analytics', 'Analytics']], 'live'],
      ['obs.height', 'Graph height', 'range', [360, 800, 20, v => v + ' px'], 'live', 'Saving sets these as the page\'s current view; changes made on the page itself still stick.']]],
    ['Live updates', [['obs.live', 'Live graph updates', 'tog', null, 'live', 'Off = the page reads the vault once; Refresh reads it again. Does not affect the end-of-turn sync hook and never starts a rebuild.'], ['obs.toasts', 'Vault-change toasts', 'tog', null, 'live', 'A short toast when notes are added or removed.'],
      ['obs.kgHealth', 'Count the auto-generated Knowledge Graph note in Graph Health', 'tog', null, 'live', 'Recommended: off. That note is written by the graph script, so its links say nothing about your writing; counting it inflates the score.']]],
    ['Note editor', [['obs.edFont', 'Editor font size', 'range', [12, 18, 1, v => v + ' px'], 'live'], ['obs.wrap', 'Line wrap', 'tog', null, 'live'], ['obs.confirm', 'Confirm before save', 'tog', null, 'live', 'Shows the diff before a note is saved. Off saves at once (the old file is still backed up).']]] ] },
  { id: 'pl', ic: 'i-puzzle', t: 'Plugins & Skills', sub: 'Tools, alerts, refresh', pv: 'pl', cards: [
    ['Catalog', [['pl.refresh', 'Catalog refresh', 'seg', [['manual', 'Manual'], ['days', 'Every N days']], 'live', 'Refresh only reads the marketplaces, when NEXUS opens and the catalog is older than N days. It never installs, updates, removes, enables or disables anything.'],
      ['pl.days', 'Days between refreshes', 'range', [1, 30, 1, v => v + ' d'], 'live'], ['pl.tab', 'Default tab', 'sel', [['installed', 'Installed'], ['catalog', 'My Catalog'], ['discover', 'Discover'], ['security', 'Security']], 'live']]],
    ['Alerts', [['pl.dup', 'Duplicate-load alerts', 'tog', null, 'live'], ['pl.alertTok', 'Alert when a tool adds more than', 'range', [5000, 60000, 1000, v => v.toLocaleString() + ' tok'], 'live', 'Only where the marketplace catalog counts it; nothing is estimated for this alert.'],
      ['pl.freq', 'Alert frequency', 'seg', [['session', 'Each session'], ['daily', 'Daily'], ['weekly', 'Weekly']], 'live'], ['pl.risk', 'Show status badges on cards', 'tog', null, 'live', 'Compatible / Warning / Review tags. The Security tab always shows its findings.']]],
    ['Key Tools (shared with Claude Code)', [['pl.key', 'Key Tools', 'keys', null, 'live']]] ] },
  { id: 'auto', ic: 'i-flow', t: 'Automation', sub: 'Sync, memory, rebuilds', pv: 'auto', cards: [
    ['NEXUS behaviour', [['au.notices', 'Show automation notices in the bell', 'tog', null, 'live', 'Runs from the Automation page (sync, memory saves, rebuilds). Context Advisor notes always show.'], ['au.confirmSync', 'Confirm before Sync All', 'tog', null, 'live', 'Sync All runs sync_docs.sh. It never runs from this page.']]],
    ['Existing automations', [['', 'hooks', 'hooks', null, 'ro']]],
    ['Resource guards', [['', 'guards', 'guards', null, 'live']]] ] },
  { id: 'system', ic: 'i-pulse', t: 'System Health', sub: 'Alert limits, notifications', pv: 'system', cards: [
    ['Notifications', [['sh.bell', 'Show System Health alerts in the bell', 'tog', null, 'live', 'Alerts are still recorded on the System Health page when this is off.']]],
    ['Alert limits', [['', 'shlim', 'shlim', null, 'live']]] ] },
  { id: 'perf', ic: 'i-gauge', t: 'Performance & Resources', sub: 'Quality, frame rate, updates', pv: 'perf', cards: [
    ['3D rendering', [['graph.quality', 'Best quality allowed', 'seg', [[0, 'High'], [1, 'Medium'], [2, 'Low']], 'live', 'The graph still steps down by itself when frames get slow.'],
      ['perf.fps', 'Frame-rate limit', 'seg', [[30, '30'], [60, '60'], [0, 'Unlimited']], 'live', 'Idle graphs already drop to about 30 fps.']]],
    ['Background & updates', [['', 'Pause when hidden', 'info', 'Always on: the graph and Home core stop rendering off-page, when the tab is hidden or the window is minimised.', 'ro'],
      ['perf.live', 'Live data', 'seg', [['live', 'Every 10 s'], ['slow', 'Every 30 s'], ['manual', 'Manual']], 'live', 'How often NEXUS reads the tracker. Manual reads it when you change page. The Obsidian page has its own switch.']]],
    ['Planned (Phase E)', [['pe.adv', 'Advanced performance profiles', 'tog', null, 'pe']]] ] },
];
const KEYS = CATS.flatMap(c => c.cards.flatMap(([, cs]) => cs.map(x => x[0]))).filter(Boolean);
const catOf = id => CATS.find(c => c.id === id) || CATS[0];

// ---------- history: live preview, Save to store ----------
let root = null, ac = null, saved = S.snapshot(), past = [], future = [], pend = null, cat = 'look', shown = '';
try { cat = sessionStorage.getItem('sp.cat') || cat; } catch { }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const dirty = () => !same(S.snapshot(), saved);
const changed = () => { const a = S.snapshot(); return [...new Set([...Object.keys(a), ...Object.keys(saved)])].filter(k => !same(a[k], saved[k])); };
const val = k => k.startsWith('graph.') && k !== 'graph.preset' ? S.graphPrefs()[k.slice(6)] : k === 'cc.limit5h' ? S.get(k) ?? api?.window?.limit ?? null : S.pref(k);
function change(k, v, live) { // live: slider drag (one undo step per drag)
  if (!pend) pend = S.snapshot();
  if (k === 'graph.preset') for (const g in S.GRAPH_PRESETS.balanced) S.draft('graph.' + g, undefined);
  S.draft(k, v);
  if (!live) commit(); else head();
}
function commit() { if (!pend) return; if (!same(pend, S.snapshot())) { past.push(pend); future = []; } pend = null; head(); }
const step = (from, to) => { if (!from.length) return; to.push(S.snapshot()); S.load(from.pop()); render(); };

// ---------- controls ----------
// inputs and selects get the row label as their accessible name (buttons already have text)
const ctl = c => ctl0(c).replace(/<(input|select)([^>]*?) data-k="/g, `<$1$2 aria-label="${esc(c[1])}" data-k="`);
function ctl0([k, label, type, o, m, help]) {
  const v = k && val(k), h = help ? `<p class="sp-help">${esc(help)}</p>` : '', dis = m === 'p11' || m === 'pe' ? ' disabled' : '', top = `<div class="sp-lab"><span>${esc(label)}</span>${mark(m)}${LM[k] ? more(LM[k], label) : ''}</div>`;
  if (type === 'info') return `<div class="sp-row ro">${top}<p class="sp-help">${esc(o)}</p></div>`;
  if (type === 'link') return `<div class="sp-row">${top}<p class="sp-help">Set under <a href="javascript:" data-cat="${o}">Animations & Visual Effects</a>: currently <b>${esc(S.pref('anim.reduced'))}</b>.</p></div>`;
  if (type === 'hooks') return hooksBox();
  if (type === 'guards') return guardsBox();
  if (type === 'shlim') return limBox();
  if (type === 'keys') return keysBox(v || []);
  if (type === 'tog') return `<label class="sp-row sp-tog${dis}">${top.replace('</div>', `<input type="checkbox" data-k="${k}"${v && !dis ? ' checked' : ''}${dis}><i></i></div>`)}${h}</label>`;
  if (type === 'range') { const [mn, mx, st, f] = o, x = dis ? (mn + mx) / 2 : +v;
    return `<div class="sp-row${dis}">${top}<div class="sp-rng"><input type="range" data-k="${k}" min="${mn}" max="${mx}" step="${st}" value="${x}"${dis} style="--p:${(x - mn) / (mx - mn) * 100}%"><output>${dis ? '—' : esc(f(x))}</output></div>${h}</div>`; }
  if (type === 'num') return `<div class="sp-row">${top}<input class="btn sp-num" type="number" data-k="${k}" min="${o[0]}" step="${o[2]}" placeholder="${o[3]}" value="${v ?? ''}">${h}</div>`;
  if (type === 'sel') return `<div class="sp-row">${top}<select class="btn" data-k="${k}">${o.map(([x, t]) => `<option value="${x}"${x === v ? ' selected' : ''}>${t}</option>`).join('')}</select>${h}</div>`;
  if (type === 'swatch') return `<div class="sp-row">${top}<div class="sp-sw">${o.map(c => `<button data-k="${k}" data-v="${c}" class="${c === v ? 'on' : ''}" style="--c:${c}" aria-label="Accent ${c}" title="${c}"></button>`).join('')}<label class="sp-cus" title="Custom colour"><input type="color" data-k="${k}" value="${esc(v)}"></label></div>${h}</div>`;
  if (type === 'tiles') return `<div class="sp-row">${top}<div class="sp-tiles">${o.map(([x, t]) => `<button data-k="${k}" data-v="${x}" class="${x === v ? 'on' : ''}"><i class="th-${x}"><b></b><b></b><b></b></i>${t}</button>`).join('')}</div>${h}</div>`;
  const custom = k === 'graph.preset' && KEYS.some(x => x.startsWith('graph.') && x !== 'graph.preset' && x !== 'graph.quality' && S.get(x) != null);
  return `<div class="sp-row${dis}">${top}<div class="tabs sp-seg" role="tablist">${o.map(([x, t]) => `<button class="tab${String(x) === String(v) && !custom ? ' on' : ''}" data-k="${k}" data-v="${x}"${dis}>${t}</button>`).join('')}${custom ? '<button class="tab on" disabled>Custom</button>' : ''}</div>${h}</div>`;
}
let inv = null, proc = null, vault = null, api = null, invErr = '', au = null;
// Resource guards live in the scheduler (auto.js), not in browser prefs: saved on their own with a confirm, never by Save Changes.
const GK = [['cpu', 'Postpone when system CPU is above', '%'], ['ram', 'Postpone when free RAM is below', 'GB'], ['disk', 'Refuse when free disk is below', 'GB'], ['wait', 'Postpone by', 'min'], ['max', 'Postpones before a run is skipped', 'times']];
const guardsBox = () => { if (!au) return errBox({ title: 'Scheduler not reachable', where: 'Settings → Resource guards', what: "NEXUS couldn't read the automation scheduler from its tracker.", why: "Without it, these values can't be shown or saved.", affected: 'Only this section. Your other settings still work.', steps: ['Make sure the NEXUS tracker is running.', 'Press Refresh.'], actions: [['refresh', 'Refresh', true]], more: ['set-guards', 'Resource guards'], tech: 'GET /api/auto failed. Start it with: node tracker.js serve' }); const g = au.guards, R = au.ranges;
  return `<div class="sp-list sp-gd">${GK.map(([k, t, u]) => `<label class="sp-row"><div class="sp-lab"><span>${t}</span></div><span><input class="btn sp-num" type="number" id="sp-g-${k}" min="${R[k][0]}" max="${R[k][1]}" step="${k === 'ram' ? 0.1 : 1}" value="${g[k]}" aria-label="${t}"> ${u} <span class="muted">(${R[k][0]}-${R[k][1]})</span></span></label>`).join('')}
    <label class="sp-row sp-tog"><div class="sp-lab"><span>Wait while Claude is busy</span><input type="checkbox" id="sp-g-claude" ${g.claude ? 'checked' : ''}><i></i></div><p class="sp-help">Busy = Claude wrote its transcript in the last 120 s, or a turn is still open.</p></label>
    ${au.items.length ? `<p class="sp-help"><b>Per automation</b> (blank = use the values above)</p><table class="tbl"><thead><tr><th>Automation</th><th>CPU %</th><th>RAM GB</th><th>Disk GB</th><th>Claude</th></tr></thead><tbody>${au.items.map(a => `<tr data-gid="${esc(a.id)}"><td>${esc(a.name)}</td>${['cpu', 'ram', 'disk'].map(k => `<td><input class="btn sp-num" type="number" data-g="${k}" min="${R[k][0]}" max="${R[k][1]}" step="${k === 'ram' ? 0.1 : 1}" value="${a.guards?.[k] ?? ''}" aria-label="${esc(a.name)} ${k}"></td>`).join('')}<td><select class="btn" data-g="claude" aria-label="${esc(a.name)} wait for Claude"><option value="">Default</option><option value="1" ${a.guards?.claude === true ? 'selected' : ''}>Wait</option><option value="0" ${a.guards?.claude === false ? 'selected' : ''}>Don't wait</option></select></td></tr>`).join('')}</tbody></table>` : ''}
    <div class="sp-dlg-b"><button class="btn pri" data-a="guards" ${sb ? 'disabled title="Preview sandbox: nothing saves"' : ''}>Save guards…</button>${more('set-guards', 'Resource guards')}</div></div>`; };
async function saveGuards() {
  const num = v => v === '' ? null : +v, g = { claude: $('sp-g-claude').checked }, over = {};
  for (const [k] of GK) g[k] = num($('sp-g-' + k).value);
  for (const tr of root.querySelectorAll('tr[data-gid]')) { const o = {}; for (const x of tr.querySelectorAll('[data-g]')) { const v = x.value; if (v === '') continue; o[x.dataset.g] = x.dataset.g === 'claude' ? v === '1' : +v; } over[tr.dataset.gid] = o; }
  const b = { op: 'guards', g, over, confirm: true };
  if (await ask('Save resource guards?', `Writes the guards to the scheduler (NEXUS_DATA/automations.json). Nothing else changes. Request: POST /api/auto ${JSON.stringify(b)}`, [['ok', 'Save guards', 'pri'], ['no', 'Cancel']]) !== 'ok') return;
  try { const j = await (await fetch('/api/auto', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
    if (j.res !== 'ok') return refused(j.res); au = await getJ('/api/auto'); render(); toast('Resource guards saved.'); } catch (e) { toast(NOSAVE, 'err', "Couldn't save"); }
}
// System Health alert limits live in the tracker (sys.js → NEXUS_DATA/sys-limits.json), saved on their own with a confirm.
let shs = null;
const LK = [['cpu', 'Alert when CPU is above', '%'], ['ram', 'Alert when free RAM is below', 'GB'], ['disk', 'Alert when free space on a drive is below', 'GB'], ['gtemp', 'Alert when GPU temperature is above', '°C'], ['sustain', 'Only if it lasts at least', 'min'], ['cooldown', 'Wait before repeating the same alert', 'min']];
const limBox = () => { if (!shs) return errBox({ title: 'Monitoring not reachable', where: 'Settings → Alert limits', what: "NEXUS couldn't read the System Health monitor from its tracker.", why: "Without it, these values can't be shown or saved.", affected: 'Only this section. Your other settings still work.', steps: ['Make sure the NEXUS tracker is running.', 'Press Refresh.'], actions: [['refresh', 'Refresh', true]], more: ['set-limits', 'Alert limits'], tech: 'GET /api/sys failed. Start it with: node tracker.js serve' }); const l = shs.limits, R = shs.ranges;
  return `<div class="sp-list sp-gd">${LK.map(([k, t, u]) => `<label class="sp-row"><div class="sp-lab"><span>${t}</span></div><span><input class="btn sp-num" type="number" id="sp-l-${k}" min="${R[k][0]}" max="${R[k][1]}" step="${k === 'ram' ? 0.1 : 1}" value="${l[k]}" aria-label="${t}"> ${u} <span class="muted">(${R[k][0]}-${R[k][1]})</span></span></label>`).join('')}
    <p class="sp-help">The disk limit applies right away (no waiting). A NEXUS service failure always alerts at once. Readings are taken every 5 s; the process list only runs while the System Health page is open.</p>
    <div class="sp-dlg-b"><button class="btn pri" data-a="shlim" ${sb ? 'disabled title="Preview sandbox: nothing saves"' : ''}>Save limits…</button>${more('set-limits', 'Alert limits')}</div></div>`; };
async function saveLim() {
  const l = {}; for (const [k] of LK) l[k] = +$('sp-l-' + k).value; const b = { op: 'limits', l, confirm: true };
  if (await ask('Save alert limits?', `Writes the limits to the monitor (NEXUS_DATA/sys-limits.json). Nothing else changes. Request: POST /api/sys ${JSON.stringify(b)}`, [['ok', 'Save limits', 'pri'], ['no', 'Cancel']]) !== 'ok') return;
  try { const j = await (await fetch('/api/sys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
    if (j.res !== 'ok') return refused(j.res); shs = await getJ('/api/sys'); render(); toast('Alert limits saved.'); } catch (e) { toast(NOSAVE, 'err', "Couldn't save"); }
}
const sysSample = () => S.pref('sh.bell') ? `<div class="sp-alerts">${(api?.sys || []).slice(0, 4).map(a => `<div class="sp-al">${icon('i-pulse')}<div><b>${ago(a.t)}</b><span>System Health: ${esc(a.txt)}</span></div></div>`).join('') || '<p class="sp-help">No System Health alerts in the last 7 days.</p>'}</div>` : '<p class="sp-help">Off: System Health alerts stay on their page only.</p>';
const hooksBox = () => `<div class="sp-list">${inv ? inv.hooks.map(h => `<div><b>${esc(h.event)}</b><code>${esc(h.cmd.replace(/^bash\s+/, ''))}</code></div>`).join('') + '<p class="sp-help">From ~/.claude/settings.json. NEXUS never edits hooks: change them in that file or with /hooks in a claude terminal.</p>' : `<p class="sp-help">${invErr ? 'Inventory not reachable: ' + esc(invErr) : 'Reading hooks…'}</p>`}</div>`;
function keysBox(sel) {
  if (!inv) return '<p class="sp-help">Reading skills…</p>';
  const names = [...new Set(inv.skills.map(s => s.name))].sort();
  return `<div class="sp-row"><div class="sp-lab"><span>Key Tools</span>${mark('live')}</div><p class="sp-help">Listed first, with a ★, on the Plugins & Skills page (and Claude Code when it is built). ${sel.length} picked.</p><div class="tabs chips sp-keys">${names.map(n => `<button class="tab${sel.includes(n) ? ' on' : ''}" data-key="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>`;
}

// ---------- page ----------
function render() {
  if (!root) return;
  const c = catOf(cat), en = shown !== cat ? ' enter' : ''; shown = cat; // entry animation only when the category changes
  root.innerHTML = `<div class="pg sp">
    <div class="pg-h"><span class="pg-ic tile-ic">${icon('i-gear')}</span><div class="pg-t"><h1>Settings${sb ? ' <span class="chip demo" title="Design preview. Saving keeps changes in this sandbox only.">Preview</span>' : ''}</h1><p>Customize your NEXUS experience, visualizations, sounds and system preferences.</p></div>
      <div class="end"><span class="sp-dirty" id="sp-dirty" title="Unsaved changes"><i></i>Unsaved changes</span>
        <button class="btn icon" id="sp-undo" title="Undo (Ctrl+Z)">${icon('i-undo')}</button><button class="btn icon" id="sp-redo" title="Redo (Ctrl+Y)">${icon('i-redo')}</button>
        <button class="btn" id="sp-reset">${icon('i-refresh')}Reset to Default</button>${more('set-reset', 'Reset to Default')}<button class="btn" id="sp-discard" data-tip="Throws away the changes you have not saved and brings your saved values back.">Discard</button><button class="btn pri" id="sp-save">${icon('i-save')}Save Changes</button></div></div>
    <div class="sp-grid">
      <nav class="card sp-cats" aria-label="Settings categories">${CATS.map(x => `<button class="sp-cat${x.id === cat ? ' on' : ''}" data-cat="${x.id}"><span class="tile-ic">${icon(x.ic)}</span><span><b>${x.t}</b><small>${x.sub}</small></span></button>`).join('')}
        <div class="sp-qa" style="grid-template-columns: 1fr 1fr auto"><button class="btn" id="sp-exp">${icon('i-dl')}Export</button><label class="btn">${icon('i-ul')}Import<input type="file" accept=".json,application/json" id="sp-imp" hidden></label>${more('set-io', 'Export and Import')}</div></nav>
      <section class="sp-mid" id="sp-mid">${c.cards.map(([t, cs], i) => `<div class="card sp-card${en}" style="--i:${i}"><div class="card-h">${i ? '' : icon(c.ic)}<h2>${i ? esc(t) : esc(c.t)}</h2>${i ? '' : '<span class="end"><span class="chip live">Live Preview</span></span>'}</div>${cs.map(ctl).join('')}</div>`).join('')}
        ${c.id === 'obs' ? '<button class="btn" id="sp-obs-def">Restore Recommended Defaults</button>' : ''}${c.id === 'cc' || c.id === 'pl' || c.id === 'obs' || c.id === 'auto' ? roCard(c.id) : ''}</section>
      <aside class="card sp-pv" id="sp-pv"></aside>
    </div></div>`;
  preview(c); head();
}
function head() {
  const d = dirty(); $('sp-dirty')?.classList.toggle('on', d);
  if ($('sp-undo')) { $('sp-undo').disabled = !past.length && !pend; $('sp-redo').disabled = !future.length; $('sp-discard').disabled = !d; }
}
// read-only real data cards
function roCard(id) {
  const box = (t, rows, foot = '') => `<div class="card sp-card"><div class="card-h">${icon('i-lock')}<h2>${t}</h2><span class="end">${mark('ro')}<button class="btn icon" data-a="refresh" title="Refresh (GET only)">${icon('i-refresh')}</button></span></div><dl class="sp-dl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${foot}</div>`;
  const na = '<span class="muted">Not reported by the tracker</span>', wait = '<span class="muted">Reading…</span>';
  if (id === 'cc') return box('Claude Code configuration', [['Connection', inv ? '<span class="sp-ok">' + icon('i-check') + 'Tracker connected</span>' : invErr ? `<span class="sp-err">${esc(invErr)}</span>` : wait],
    ['Model in settings.json', inv ? `<code>${esc(inv.model || '—')}</code>` : wait], ['This session\'s model', proc?.cur ? `<code>${esc(proc.cur.model)}</code>` : wait],
    ['Thinking effort', na], ['Permission mode', na], ['Hooks', inv ? inv.hooks.length + ' (' + [...new Set(inv.hooks.map(h => h.event))].join(', ') + ')' : wait],
    ['Plugins / skills', inv ? `${inv.plugins.length} / ${inv.skills.length}` : wait], ['Open issues', inv ? inv.issues.length : wait]],
    '<p class="sp-help">Change these in a claude terminal (<code>/model</code>, <code>/config</code>, <code>/hooks</code>) or in <code>~/.claude/settings.json</code>. NEXUS only reads them.</p>');
  if (id === 'pl') return box('Inventory', inv ? [['Plugins', inv.plugins.length], ['Skills', inv.skills.length], ['Marketplaces', inv.markets.length], ['Hooks', inv.hooks.length], ['Issues', inv.issues.length], ['Catalog read', inv.catalogAt ? ago(inv.catalogAt) + ' (' + inv.catalog.length + ' entries)' : 'never']] : [['Inventory', invErr || wait]]);
  if (id === 'obs') return box('Vault & graph', vault ? [['Vault', `<code>${esc(vault.vault)}</code>`], ['Connection', vault.vaultOk ? '<span class="sp-ok">' + icon('i-check') + 'Readable</span>' : '<span class="sp-err">Not found</span>'], ['graph.json', `<code>${esc(vault.graph?.path || '—')}</code>`],
    ['Graph built', vault.graph?.built ? ago(vault.graph.built) : '—'], ['Sync All this session', vault.sync ? esc(vault.sync.res || 'ran') : 'Not run']] : [['Vault', wait]], '<p class="sp-help">Paths are fixed by the project; Settings never moves the vault, graph.json or memory files.</p>');
  if (id === 'auto') return box('Recent automation runs', api ? (api.auto || []).slice(0, 5).map(a => [ago(a[0]), esc(a[1])]) : [['Runs', wait]]);
  return '';
}

// ---------- live preview panel (adapts per category) ----------
let G = null, gHost = null, gData = null, statT = 0;
async function graph(host, h) {
  if (!gHost) { gHost = document.createElement('div'); gHost.className = 'g3 sp-g'; }
  host.append(gHost); gHost.style.height = h ? h + 'px' : '';
  if (!G) { const m = await import('../graph3d.js'); if (G || !root) return; G = m.createGraph(gHost, {});
    try { gData ||= await getJ('/api/graph'); G?.setData(gData.nodes, gData.links); } catch (e) { gHost.insertAdjacentHTML('beforeend', `<div class="state error"><b>Graph data not reachable</b>${esc(e.message)}</div>`); } }
  G?.setMode(S.pref('obs.mode')); G?.setDim(S.pref('obs.view') === '3d'); G?.pause(false); requestAnimationFrame(() => G?.resize());
}
const parkGraph = () => { G?.pause(true); gHost?.remove(); };
function preview(c) {
  const pv = $('sp-pv'); if (!pv) return; clearInterval(statT); parkGraph();
  const hd = (t, s) => `<div class="card-h">${icon('i-play')}<h2>Live Preview</h2><span class="end"><span class="chip live">${t}</span></span></div><p class="sp-help">${s}</p>`;
  const k = c.pv, gs = sb ? 'with your sandbox values' : 'with your values (not stored until you save)';
  if (k === 'look') { pv.innerHTML = hd('Theme', 'The whole app is already showing your choice.') + uiSample() + '<div id="sp-gh"></div>'; graph($('sp-gh'), 0); }
  else if (k === 'graph' || k === 'anim') { pv.innerHTML = hd(k === 'graph' ? 'Real graph' : 'Motion', 'The real knowledge graph, same engine as the Obsidian page, ' + gs + '.') + '<div id="sp-gh"></div>' + (k === 'anim' ? '<button class="btn" id="sp-motion">Play a page transition</button><div class="sp-mo" id="sp-mo"><div class="card">Sample panel</div><div class="card">Sample panel</div></div>' : ''); graph($('sp-gh'), 0); }
  else if (k === 'obs') { pv.innerHTML = hd('Graph + editor', 'Graph at your default height and view; editor text at your size.') + '<div id="sp-gh"></div>' + `<pre class="sp-ed" style="font-size:${S.pref('obs.edFont')}px;white-space:${S.pref('obs.wrap') ? 'pre-wrap' : 'pre'}">## Next action\nRead docs/NEXT CHAT.md and continue where we left off. Long lines ${S.pref('obs.wrap') ? 'wrap at the edge of the editor.' : 'scroll sideways instead of wrapping.'}</pre>`; graph($('sp-gh'), Math.round(S.pref('obs.height') / 2.2)); }
  else if (k === 'perf') { pv.innerHTML = hd('Real rendering info', 'Measured from the graph below and from /api/proc, refreshed every second.') + '<div id="sp-gh"></div><dl class="sp-dl" id="sp-st"></dl>'; graph($('sp-gh'), 0); statT = setInterval(perfStats, 1000); perfStats(); }
  else if (k === 'sound') pv.innerHTML = hd('Samples', 'Play each sound at your volume. Previews ignore the hover/notification switches so you can hear them.') + `<div class="sp-snd">${Sound.names.map(n => `<button class="btn" data-snd="${n}">${icon('i-play')}${n}</button>`).join('')}</div><p class="sp-help" id="sp-sndst"></p>`;
  else if (k === 'a11y') pv.innerHTML = hd('Compare', 'Status, chart lines and clusters in the selected mode, with the cues that never depend on colour.') + a11ySample();
  else if (k === 'cc') pv.innerHTML = hd('Alerts', 'How the alerts read with your thresholds, from this session\'s real numbers.') + ccSample();
  else if (k === 'pl') pv.innerHTML = hd('Alerts', 'Real findings from the inventory, shown with your alert settings.') + plSample();
  else if (k === 'auto') pv.innerHTML = hd('Notices', 'What the bell shows for automations.') + autoSample();
  else if (k === 'system') pv.innerHTML = hd('Alerts', 'What the bell shows from System Health (real alerts, last 7 days).') + sysSample();
}
const uiSample = () => `<div class="sp-ui"><div class="sp-ui-c"><b>Token Usage</b><span class="sp-st ok">${icon('i-check')}Healthy</span><div class="bar"><i style="width:62%"></i></div><div class="sp-ui-b"><button class="btn pri">Primary</button><button class="btn">Secondary</button></div></div></div>`;
function a11ySample() {
  const [st, se, cl] = CVD[S.pref('a11y.cb')] || CVD.off, days = (api?.days || []).slice(-9), dash = ['', '6 4', '2 3', '10 3 2 3'];
  const lines = [1, 2, 3, 4].map((col, j) => { const v = days.map(d => d[col]), mx = Math.max(1, ...v); return `<polyline fill="none" stroke="${se[j]}" stroke-width="2.2" stroke-dasharray="${dash[j]}" points="${v.map((x, i) => `${(i / Math.max(1, v.length - 1) * 280).toFixed(1)},${(78 - x / mx * 70).toFixed(1)}`).join(' ')}"/>`; }).join('');
  const shp = ['circle', 'diamond', 'square', 'tri', 'hex', 'ring'];
  return `<div class="sp-sts">${[['ok', 'i-check', 'Healthy'], ['warn', 'i-warn', 'Warning'], ['err', 'i-x', 'Error'], ['info', 'i-info', 'Info']].map(([c, i, t], j) => `<span class="sp-st" style="--c:${st[j]}">${icon(i)}${t}</span>`).join('')}</div>
    <svg class="sp-ch" viewBox="0 0 280 80">${days.length ? lines : ''}</svg><div class="sp-leg">${['Input', 'Output', 'Cache write', 'Cache read'].map((t, j) => `<span><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="${se[j]}" stroke-width="2.2" stroke-dasharray="${dash[j]}"/></svg>${t}</span>`).join('')}</div>
    <p class="sp-help">Real daily tokens from /api, each line scaled to its own peak.</p>
    <div class="sp-cl">${['Obsidian', 'Roblox', 'Claude Code', 'Plugins', 'Blender', 'References'].map((t, j) => `<span><i class="shp ${shp[j]}" style="--c:${cl[j]}"></i>${t}</span>`).join('')}</div>
    <div class="sp-txt"><b>Readable text sample</b><p>Graph Health counts resolved wiki-links. <span class="muted">Muted text stays readable</span> at ${S.pref('a11y.scale')}% scale.</p></div>`;
}
function ccSample() {
  const w = api?.window, used = w ? w.tokens.slice(0, 3).reduce((a, b) => a + b, 0) : null, lim = val('cc.limit5h'), ctx = proc?.cur?.ctx?.at(-1);
  const p = lim && used != null ? used / lim * 100 : null;
  return `<div class="sp-alerts">
    <div class="sp-al ${p != null && p >= S.pref('cc.alertPct') ? 'warn' : ''}">${icon('i-gauge')}<div><b>5-hour window</b><span>${used == null ? 'Reading…' : used.toLocaleString() + ' billed tokens'}${p != null ? ` · ${p.toFixed(1)}% of your limit (alert at ${S.pref('cc.alertPct')}%)` : ' · limit unknown, so no % is shown'}</span></div></div>
    <div class="sp-al">${icon('i-bolt')}<div><b>Waste tip</b><span>Tool outputs over ${S.pref('cc.wasteTok').toLocaleString()} tokens get a "narrow it down" tip.</span></div></div>
    <div class="sp-al ${ctx && ctx / 2e5 * 100 >= S.pref('cc.ctxWarn') ? 'warn' : ''}">${icon('i-layers')}<div><b>Context</b><span>${ctx ? `This session: ${ctx.toLocaleString()} tokens of context (${(ctx / 2e5 * 100).toFixed(0)}% of 200k, estimate). NEXUS warns at ${S.pref('cc.ctxWarn')}%.` : 'Reading…'}</span></div></div>
    <div class="sp-al">${icon('i-term')}<div><b>Terminal</b><span>New sessions open in ${TERM[S.pref('cc.term')]}.</span></div></div></div>`;
}
function plSample() {
  if (!inv) return `<p class="sp-help">${invErr || 'Reading…'}</p>`;
  const by = {}; for (const s of inv.skills) (by[s.name] ||= []).push(s.owner || s.source); const dup = Object.entries(by).filter(([, o]) => o.length > 1);
  const heavy = inv.plugins.filter(p => p.tokens?.always_on > S.pref('pl.alertTok'));
  return `<div class="sp-alerts">${!S.pref('cc.monitor') ? '<p class="sp-help">Plugin and skill monitoring is off (Claude Code Preferences): no bell alerts.</p>' : ''}${S.pref('pl.dup') ? (dup.length ? dup.map(([n, o]) => `<div class="sp-al warn">${icon('i-layers')}<div><b>Loaded ${o.length}×: ${esc(n)}</b><span>${o.map(esc).join(' · ')}</span></div></div>`).join('') : '<div class="sp-al">' + icon('i-check') + '<div><b>No duplicate loads</b></div></div>') : '<p class="sp-help">Duplicate-load alerts are off.</p>'}
    ${heavy.map(p => `<div class="sp-al warn">${icon('i-db')}<div><b>${esc(p.name)}</b><span>~${p.tokens.always_on.toLocaleString()} tokens in every session (catalog count)</span></div></div>`).join('')}
    ${inv.issues.map(i => `<div class="sp-al ${i.sev === 'low' ? '' : 'warn'}">${icon('i-info')}<div><b>${S.pref('pl.risk') ? `<span class="chip ${i.sev === 'low' ? 'unk' : 'est'}">${esc(i.sev)}</span> ` : ''}${esc(i.item)}</b><span>${esc(i.text)}</span></div></div>`).join('')}
    <p class="sp-help">Token cost per tool: only the marketplace catalog's count is used (${inv.plugins.filter(p => p.tokens?.always_on != null).length} of ${inv.plugins.length} plugins have one); nothing is invented. Alerts show ${{ session: 'once per NEXUS session', daily: 'at most daily', weekly: 'at most weekly' }[S.pref('pl.freq')]}.</p></div>`;
}
const autoSample = () => (S.pref('au.notices') ? `<div class="sp-alerts">${(api?.auto || []).slice(0, 4).map(a => `<div class="sp-al">${icon('i-flow')}<div><b>${ago(a[0])}</b><span>${esc(a[1].replace(/\. Backup:.*$/, ''))}</span></div></div>`).join('') || '<p class="sp-help">No runs yet.</p>'}</div>` : '<p class="sp-help">Automation notices are hidden from the bell.</p>') + (S.pref('au.confirmSync') ? '<p class="sp-help">Sync All shows what it does and waits for your OK.</p>' : '<p class="sp-help">Sync All runs as soon as you press it.</p>');
async function perfStats() {
  const s = G?.stats?.(); try { proc = await getJ('/api/proc'); } catch { }
  const el = $('sp-st'); if (!el) return;
  el.innerHTML = [['Graph fps', s ? s.fps : '—'], ['Quality tier', s ? ['High', 'Medium', 'Low', 'Lowest'][s.tier] ?? s.tier : '—'], ['Pixel ratio', s?.pr?.toFixed(2) ?? '—'], ['Bloom', s ? (s.bloom ? 'on' : 'off') : '—'], ['Draw calls', s?.calls ?? '—'], ['Nodes / links', s ? `${s.nodes} / ${s.links}` : '—'],
    ['Tracker CPU', proc ? proc.cpu + '%' : '—'], ['Tracker memory', proc ? (proc.rss / 1048576).toFixed(0) + ' MB' : '—'], ['JS heap', performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MB' : '—'], ['Frame limit', S.pref('perf.fps') || 'Unlimited']].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---------- save ----------
async function save() {
  commit(); const ch = changed(); if (!ch.length) return true;
  if (sb) { saved = S.snapshot(); head(); toast('Saved to the preview sandbox. Your real NEXUS settings are unchanged.'); return true; }
  const lim = val('cc.limit5h'), cfg = ch.includes('cc.limit5h') || ch.includes('cc.wasteTok');
  if (cfg) { const r = await ask('Update the tracker too?', `The 5-hour limit (${lim == null ? 'unknown' : lim.toLocaleString() + ' tokens'}) and the waste-tip size (${S.pref('cc.wasteTok').toLocaleString()} tokens) are tracker values: Save writes them to the tracker's config.json. Nothing else in that file changes.`, [['ok', 'Save and update', 'pri'], ['no', 'Cancel']]);
    if (r !== 'ok') return false;
    try { const x = await fetch('/api/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 'config', fiveHourLimitTokens: lim, oversizedChars: S.pref('cc.wasteTok') * 4 }) }), { res } = await x.json();
      if (res !== 'ok' && res !== 'unchanged') { refused(res); return false; } } catch (e) { toast(NOSAVE, 'err', "Couldn't save"); return false; } }
  S.persist(); saved = S.snapshot(); head();
  // Obsidian defaults become the page's current view (jv.kg holds its last view; the page also listens for nexus:saved)
  const O = { 'obs.mode': 'mode', 'obs.view': 'dim', 'obs.tab': 'tab' };
  if (ch.some(k => k in O || k === 'obs.height')) try { const j = JSON.parse(localStorage.getItem('jv.kg') || '{}'); for (const k in O) if (ch.includes(k)) j[O[k]] = S.pref(k); if (ch.includes('obs.height')) (j.pw ||= {}).gh = S.pref('obs.height'); localStorage.setItem('jv.kg', JSON.stringify(j)); } catch { }
  dispatchEvent(new CustomEvent('nexus:saved', { detail: ch }));
  toast(`Saved ${ch.length} setting${ch.length === 1 ? '' : 's'}.`); return true;
}

// ---------- events ----------
function onInput(e) { const t = e.target, k = t.dataset.k; if (!k) return;
  if (t.type === 'range') { const v = +t.value, r = t.closest('.sp-row'), f = catOf(cat).cards.flatMap(c => c[1]).find(x => x[0] === k)[3][3]; t.style.setProperty('--p', (v - t.min) / (t.max - t.min) * 100 + '%'); r.querySelector('output').textContent = f(v); change(k, v, true); }
  else if (t.type === 'color') change(k, t.value.toUpperCase(), true); }
function onChange(e) { const t = e.target, k = t.dataset.k;
  if (t.id === 'sp-imp') return imp(t);
  if (!k) return;
  if (t.type === 'range' || t.type === 'color') { commit(); render(); }
  else if (t.type === 'checkbox') { change(k, t.checked); if (catOf(cat).pv !== 'look') preview(catOf(cat)); }
  else if (t.tagName === 'SELECT') { change(k, t.value); render(); }
  else if (t.type === 'number') { change(k, t.value === '' ? null : Math.max(0, +t.value)); render(); } }
function onClick(e) {
  const b = e.target.closest('button, a[data-cat]'); if (!b || b.disabled) return;
  if (b.dataset.cat) { if (!sb) { location.hash = '#/settings/' + b.dataset.cat; return; } return nav([b.dataset.cat]); }
  if (b.dataset.k) { const raw = b.dataset.v, cur = val(b.dataset.k), v = typeof cur === 'number' || /^-?[\d.]+$/.test(raw) && b.dataset.k !== 'ui.accent' ? +raw : raw; change(b.dataset.k, v); return render(); }
  if (b.dataset.key) { const l = [...(S.pref('pl.key') || [])], i = l.indexOf(b.dataset.key); i < 0 ? l.push(b.dataset.key) : l.splice(i, 1); change('pl.key', l); return render(); }
  if (b.dataset.snd) { Sound.play(b.dataset.snd, { preview: true }); const d = Sound.diag(); $('sp-sndst').textContent = S.pref('sound.mute') ? 'Muted: nothing plays.' : `Played "${b.dataset.snd}" at ${Math.round(S.pref('sound.volume') * 100)}% (audio ${d.state}).`; return; }
  if (b.dataset.a === 'refresh') return loadData(true);
  if (b.dataset.a === 'guards') return saveGuards();
  if (b.dataset.a === 'shlim') return saveLim();
  const id = b.id;
  if (id === 'sp-undo') { commit(); step(past, future); }
  else if (id === 'sp-redo') step(future, past);
  else if (id === 'sp-save') save();
  else if (id === 'sp-discard') { S.load(saved); past = []; future = []; render(); toast('Changes discarded.'); }
  else if (id === 'sp-reset') ask('Reset to defaults?', 'Every setting shows its default now so you can look first. Nothing is stored until you press Save Changes, and Discard brings your values back.', [['ok', 'Preview defaults', 'pri'], ['no', 'Cancel']]).then(r => { if (r !== 'ok') return; past.push(S.snapshot()); future = []; S.load({}); render(); });
  else if (id === 'sp-obs-def') { past.push(S.snapshot()); future = []; const o = S.snapshot(); for (const k in o) if (k.startsWith('obs.')) delete o[k]; S.load(o); render(); }
  else if (id === 'sp-exp') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([S.exportJSON()], { type: 'application/json' })); a.download = sb ? 'nexus-settings-preview.json' : 'nexus-settings.json'; a.click(); URL.revokeObjectURL(a.href); }
  else if (id === 'sp-motion') { const m = $('sp-mo'); m.classList.remove('go'); void m.offsetWidth; m.classList.add('go'); }
}
async function imp(t) { const f = t.files[0]; t.value = ''; if (!f) return; // previewed like any change; stored on Save
  try { const o = JSON.parse(await f.text()); if (o?.version !== 1 || !o.settings || typeof o.settings !== 'object' || Array.isArray(o.settings)) throw new Error('Not a NEXUS settings file (version 1).');
    past.push(S.snapshot()); future = []; S.load(o.settings); render(); toast('Imported. Press Save Changes to keep it.'); } catch (e) { toast("That file isn't a NEXUS settings file. Your settings didn't change.", 'err', "Couldn't import"); } }
function onKey(e) { if (!(e.ctrlKey || e.metaKey) || e.target.matches?.('input[type=number], input:not([type])')) return; const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); $('sp-undo')?.click(); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); $('sp-redo')?.click(); } else if (k === 's') { e.preventDefault(); save(); } }

function ask(t, msg, btns) { let d = $('sp-dlg'); if (!d) { d = document.createElement('dialog'); d.id = 'sp-dlg'; d.className = 'sp-dlg'; document.body.append(d); }
  d.innerHTML = `<form method="dialog"><h2>${esc(t)}</h2><p>${esc(msg)}</p><div class="sp-dlg-b">${btns.map(([v, l, c]) => `<button class="btn ${c || ''}" value="${v}">${l}</button>`).join('')}</div></form>`;
  d.returnValue = ''; d.showModal(); return new Promise(r => d.addEventListener('close', () => r(d.returnValue), { once: true })); }

// ---------- data (GET only) ----------
async function loadData(force) {
  const [a, b, c, d, e, g] = await Promise.allSettled([getJ('/api/inv'), getJ('/api/proc'), getJ('/api/vault'), getJ('/api'), getJ('/api/auto'), getJ('/api/sys')]); au = e.value || au; shs = g.value || shs;
  inv = a.value && !a.value.error ? a.value : inv; invErr = a.reason?.message || a.value?.error || ''; proc = b.value || proc; vault = c.value || vault; api = d.value || api;
  if (!root) return;
  if (!root.contains(document.activeElement) || force) render(); else preview(catOf(cat));
  if (force) toast('Refreshed (read-only).');
  return a.value;
}

// ---------- page API (main.js router; settings-preview.html calls the same) ----------
export function mount(el, params = []) {
  root = el; ac = new AbortController(); const o = { signal: ac.signal };
  if (CATS.some(c => c.id === params[0])) cat = params[0];
  saved = S.snapshot(); past = []; future = []; pend = null; shown = '';
  el.addEventListener('input', onInput, o); el.addEventListener('change', onChange, o); el.addEventListener('click', onClick, o);
  addEventListener('keydown', onKey, o); addEventListener('beforeunload', e => { if (dirty()) e.preventDefault(); }, o);
  addEventListener('pagehide', unmount, o);
  render(); return loadData();
}
export function nav(params = []) { cat = CATS.some(c => c.id === params[0]) ? params[0] : cat; try { sessionStorage.setItem('sp.cat', cat); } catch { } render(); root?.closest('#page')?.scrollTo({ top: 0 }); }
export function update(st) { if (!st?.r || !root) return; api = st.r; proc = st.p || proc; const c = catOf(cat); if (c.pv === 'cc' || c.pv === 'auto') preview(c); }
export function resize() { G?.resize(); }
export function unmount() {
  if (!root) return; if (dirty()) S.load(saved); // never leave an unsaved preview applied
  ac?.abort(); clearInterval(statT); parkGraph(); root = null; // M7b: graph kept paused (no frames), so a return visit skips the ~300 ms layout + new WebGL context
}
// Leaving with unsaved changes: Save / Discard / Continue Editing. Returns true when it took over the navigation.
export function leave(to, fromKey) {
  if (!dirty()) return false;
  if (fromKey) history.replaceState(null, '', '#/' + fromKey.replace(/\/$/, ''));
  ask('Unsaved changes', 'You changed settings and did not save them.', [['save', 'Save', 'pri'], ['discard', 'Discard'], ['stay', 'Continue Editing']]).then(async r => {
    if (r === 'stay' || !r) return; if (r === 'save' && !await save()) return; if (r === 'discard') S.load(saved), saved = S.snapshot();
    location.href = to; });
  return true;
}
export const diag = () => ({ dirty: dirty(), changed: changed(), stats: G?.stats?.() }); // tests only
