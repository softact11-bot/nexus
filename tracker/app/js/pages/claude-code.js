// Claude Code workspace (Phase G). Read-only view of the selected project: sessions, files, git, live session activity, plus
// launchers (terminals, Claude sessions, AI Tools with an editable preset prompt). Nothing here edits files or Claude Code config.
// Data: /api, /api/proc, /api/projects(+?id), /api/inv, /api/cc/{tree,file,git,live} (cc.js; deny list + path checks on the server).
// Launches: POST /api/projects {op:'open'} after a confirm dialog. M5d, desktop app only (term.js): the Terminal tab holds embedded
// shells, and Open in Terminal / Git Bash / New Session / Resume open one there (Windows Terminal and AI Tools still launch outside). opts.preview (claude-code-preview.html): launches stop at the
// dialog and the layout is saved under jv.cc.preview.
import { tok, esc, chip, ago, bytes } from '../fmt.js';
import { icon, seg, kpi, stateBox, toast, MORE, more, errBox } from '../ui.js';
import { poll as apiPoll, retryText } from '../api.js';
import * as S from '../settings.js';
import * as X from '../term.js';

// M7d D3 Learn More (Claude Code copy, checked against cc.js / projects.js / this file). Read-only unless the entry says otherwise.
const RO = { tokens: 'None used', files: 'Nothing changed', privacy: 'Stays on this PC', load: 'Light: one read per refresh' };
Object.assign(MORE, {
  'cc-ses': { area: 'Claude Code', title: 'Current Session and Model', what: 'The Claude Code session that sent the newest request on this PC. Active = a request in the last 2 minutes, otherwise Idle. The time is first to last request; the 8 characters are the start of the session id.',
    when: ['Checking that the session you are working in is the one being tracked.'], impact: RO, notes: ['Model is the model of that session\'s last request.', 'The session can belong to another project than the one selected here.'], tech: 'GET /api/proc → cur (start, end, n, model).' },
  'cc-tok': { area: 'Claude Code', title: 'Token Usage · 5 h', what: 'All tokens (every type) in the current 5-hour usage window, for every project. The window starts at its first request and lasts 5 hours, so the reset time is an estimate.',
    when: ['Seeing how close you are to your plan limit.'], impact: RO, notes: ['A % shows only when you set your plan\'s 5-hour limit in Settings → Claude Code.', 'Same number as the 5-hour card on Home.'], tech: 'GET /api → window (tokens, limit, pct, resets).' },
  'cc-sys': { area: 'Claude Code', title: 'System', what: 'CPU is the NEXUS tracker process only (the bar is ×4 so small values show). RAM is memory in use on the whole PC. Disk is how full the system drive is.',
    when: ['Checking whether the PC is busy before starting heavy work.'], impact: RO, notes: ['Refreshes with this page (Settings → Claude Code page refresh). Paused while the window is hidden.'], tech: 'GET /api/proc → cpu, mem, disk.' },
  'cc-layout': { area: 'Claude Code', title: 'Layout', what: 'Balanced, Terminal Focus and Code Focus set the panel sizes. Drag the thin bars between panels, or focus one and use the arrow keys, to resize. The arrow on a panel collapses it; a column with every panel collapsed becomes an icon rail.',
    when: ['Giving the terminal or the code more room.'], impact: { tokens: 'None used', files: 'Nothing changed', privacy: 'Saved in this app only', load: 'None' }, notes: ['Any manual change shows "Custom layout".', 'Reset Layout goes back to Balanced and keeps the project and open files.'], tech: 'localStorage jv.cc (sizes, collapsed panels, tabs, open files).' },
  'cc-files': { area: 'Claude Code', title: 'Files', what: 'The selected project\'s folders and files, read-only. Click a file to show it with colours. Up to 8 files stay open as tabs.',
    when: ['Looking at code or docs without leaving NEXUS.'], impact: RO, notes: ['Files that may hold passwords or keys (.env, key files, credentials) are blocked here and by the tracker.', 'Files over 1 MB and binary files are not shown. Long files show their first 5,000 lines.', 'Up to 500 entries per folder. The filter only searches folders you have opened.', 'An open file is re-read when Claude edits it. Use Open in VS Code to edit.'], tech: 'GET /api/cc/tree and /api/cc/file (cc.js: deny list + path checks, 1 MB limit).' },
  'cc-term': { area: 'Claude Code', title: 'Terminal tabs', what: 'Terminal: in the desktop app, real shells in the project folder; in a browser, buttons that open a terminal outside. Claude Output: the last 40 requests of this project\'s newest session (or the active one). Problems: context over your warning, this session\'s estimated waste, git conflicts and tracker issues. Git: status and recent commits.',
    when: ['Watching what Claude is doing, or checking the repo, while you work.'], impact: RO, notes: ['No compiler or linter runs in Problems.', 'Claude Output reads only the last 512 KB of the session transcript.', 'Git is read-only: NEXUS never commits, pulls or pushes.', 'Commands you type in a Terminal shell run for real.'], tech: 'GET /api/cc/live (transcript tail), /api/cc/git (git status + log); term.js for embedded shells.' },
  'cc-ai': { area: 'Claude Code', title: 'AI Tools', what: 'Each button starts a new Claude Code session in the selected project with a ready prompt you can edit first. New Chat and Continue start or resume a session without a prompt.',
    when: ['Asking Claude for a summary, an explanation, a review or a planned change.'], impact: { tokens: 'Uses your Claude plan like any Claude Code chat', files: 'NEXUS changes nothing. Refactor, Generate and Optimize ask Claude to propose a plan and wait for your OK before editing', privacy: 'The prompt goes to Claude, like a typed message', load: 'One Claude Code session' },
    notes: ['A confirm window shows the prompt and command before anything starts.', 'Prompts are up to 4,096 characters, passed from a file, never run as a command.', 'Prompts name the open file when one is open.', 'The terminal used is set in Settings → Claude Code.'], tech: 'POST /api/projects {op:\'open\', what:\'ai\'} (projects.js).' },
  'cc-ins': { area: 'Claude Code', title: 'Insights', what: 'Activity: requests, context size and tokens of the session, how its context grew (dashed line = your context warning on an estimated 200K window), tool use in this project and the newest requests. Context: the project, open file, docs, skills, knowledge graph and git. Recent: the 8 newest files from docs, git changes and Claude\'s edits.',
    when: ['Deciding when to /compact, or finding a file Claude just changed.'], impact: RO, notes: ['The 200K window is an estimate; some models have more.', 'Sensitive files never show in Recent.'], tech: 'GET /api/cc/live, /api/cc/git, /api/projects?id, /api/inv.' },
  'cc-launch': { area: 'Claude Code', title: 'Launch buttons', what: 'New Session, Open in Terminal, Quick Access and Resume open a terminal, Claude Code, VS Code or Explorer in the project folder. A confirm window shows the exact command first.',
    when: ['Starting work in a project.'], impact: { tokens: 'None until you chat with Claude', files: 'Nothing changed by NEXUS', privacy: 'Stays on this PC', load: 'Starts one program' }, notes: ['In the desktop app, PowerShell, Git Bash, New Session and Resume open in the Terminal tab; Windows Terminal, VS Code and Explorer open outside.', 'Header buttons use the terminal set in Settings → Claude Code; Quick Access names its own.'], tech: 'POST /api/projects {op:\'open\'} (projects.js); term.js in the desktop app.' },
});
const NOREACH = "The tracker didn't answer, so nothing was launched. Check the message at the top of this page, then try again.";

const PRESETS = {
  balanced: { cl: 264, cr: 300, th: 38, fw: 260, min: {} },
  terminal: { cl: 240, cr: 280, th: 62, fw: 260, min: { files: 1 } },
  code: { cl: 240, cr: 280, th: 24, fw: 280, min: { side: 1 } },
};
const LIM = { cl: [220, 420], cr: [250, 460], th: [14, 80], fw: [200, 460] };
const RAIL = 52; // a column whose panels are all collapsed shrinks to an icon rail
const TTABS = [['term', 'Terminal'], ['out', 'Claude Output'], ['prob', 'Problems'], ['git', 'Git']];
const TERMS = { wt: 'Windows Terminal', pwsh: 'PowerShell', bash: 'Git Bash' };
// Same rule as cc.js. The server refuses these files; here it only greys the rows and skips the request.
const DENY = /^\.env|\.(pem|key|p12|pfx|kdbx|jks|keystore)$|^id_(rsa|dsa|ecdsa|ed25519)|^\.(npmrc|netrc|git-credentials)$|(^|[-_.])(secrets?|credentials?|passwords?)([-_.]|$)/i;
const AI = [
  ['new', 'New Chat', 'i-plus-folder', '#31D67A'], ['cont', 'Continue', 'i-play', '#5AB8F2'],
  ['sum', 'Summarize', 'i-book', '#A2F7C5'], ['ref', 'Refactor', 'i-wand', '#F2B544'],
  ['iss', 'Find Issues', 'i-shield', '#F2555A'], ['exp', 'Explain', 'i-info', '#5AB8F2'],
  ['gen', 'Generate', 'i-spark', '#C48BFF'], ['opt', 'Optimize', 'i-gauge', '#31D67A'],
];
const CTX = 200000; // est. context window for the context-growth warning line
const MAXL = 5000; // ponytail: lines rendered per file; the rest is one "open in VS Code" note (virtual scrolling if big files matter)

let root, O = {}, KEY, ui, r = null, p = null, projs = null, det = null, inv = null, timer = 0, offVis = null;
let kids = {}, files = {}, live = null, gitd = null, gen = 0; // per-project caches (gen drops answers for a project you left)
const $ = id => root?.querySelector('#' + id);
const clamp = (v, [a, b]) => Math.max(a, Math.min(b, v));
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ui)); } catch { } };
const proj = () => projs?.items.find(x => x.id === ui.proj) || null;
const kind = x => /token-tracker/i.test(x?.dir || '') ? 'nexus' : x?.type || 'other';
const model = m => m ? m.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^\w/, c => c.toUpperCase()) : '—';
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const getJ = u => fetch(u, { cache: 'no-store' }).then(x => x.ok ? x.json() : Promise.reject(x.status));
const getR = u => fetch(u, { cache: 'no-store' }).then(x => x.json().catch(() => ({ res: 'HTTP ' + x.status })), () => ({ res: 'Tracker not reachable.' })); // cc.js answers carry their reason
const q = o => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
const liveSid = () => { const c = p?.cur?.id, L = det?.sessions || []; return L.some(s => s.id === c) ? c : L[0]?.id || null; };
const tools = L => { const m = {}; for (const t of L) m[t] = (m[t] || 0) + 1; return Object.entries(m).map(([t, n]) => n > 1 ? `${t}×${n}` : t).join(', '); };

// ---------- syntax highlight (one regex per language; groups → comment, string, number, keyword, call) ----------
const KW = { js: 'const|let|var|function|return|if|else|for|while|import|export|from|async|await|new|class|of|in|true|false|null|undefined|try|catch|throw',
  lua: 'local|function|end|if|then|else|elseif|for|do|while|return|not|and|or|nil|true|false|in|repeat|until|break',
  py: 'def|class|return|if|elif|else|for|while|import|from|as|with|async|await|True|False|None|try|except|raise|in|not|and|or|self' };
const rx = (cm, kw) => new RegExp(`(${cm})|("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)|\\b(\\d+(?:\\.\\d+)?)\\b|\\b(${kw})\\b|\\b([A-Za-z_]\\w*)(?=\\()`, 'g');
const RX = { js: rx('\\/\\/.*$', KW.js), lua: rx('--.*$', KW.lua), py: rx('#.*$', KW.py), json: rx('$^', 'true|false|null'), css: rx('\\/\\*.*?\\*\\/', 'important') };
const LANG = { js: 'js', mjs: 'js', cjs: 'js', ts: 'js', lua: 'lua', luau: 'lua', py: 'py', json: 'json', css: 'css', md: 'md' };
const CLS = ['c', 's', 'n', 'k', 'f'];
function line(l, lang) {
  if (lang === 'md') return /^#{1,6} /.test(l) ? `<span class="h">${esc(l)}</span>` : esc(l).replace(/`([^`]+)`/g, '<span class="s">`$1`</span>').replace(/^(\s*[-*] )/, '<span class="p">$1</span>');
  const re = RX[lang]; if (!re || l.length > 2000) return esc(l);
  let o = '', i = 0;
  for (const m of l.matchAll(re)) { if (!m[0]) continue; o += esc(l.slice(i, m.index)) + `<span class="${CLS[m.slice(1).findIndex(x => x !== undefined)]}">${esc(m[0])}</span>`; i = m.index + m[0].length; }
  return o + esc(l.slice(i));
}
const hl = (L, lang) => `<code>${L.map(l => `<span class="l">${line(l, lang)}</span>`).join('')}</code>`;

// ---------- AI Tools: project-aware preset prompts ----------
const FOCUS = {
  roblox: { iss: ' Include RemoteEvent validation, DataStore safety and connection leaks.', opt: 'Roblox performance: per-frame work, instance counts, network traffic and memory', what: 'Roblox game' },
  blender: { iss: ' Include unapplied transforms, missing textures and high poly counts.', opt: 'Blender scene cost: poly counts, modifiers, texture sizes and export settings', what: 'Blender project' },
  nexus: { iss: ' Include route guards, path checks and cost on the Claude Code hook path.', opt: 'tracker speed and token use: hook-path time, polling, payload sizes', what: 'NEXUS tracker' },
  other: { iss: '', opt: 'speed, memory and token use', what: 'project' },
};
function prompt(t, x, file) {
  const f = FOCUS[kind(x)], tgt = file ? '`' + file + '`' : 'this ' + f.what, lean = ' Read only the files you need.';
  const plan = ' Inspect first, then propose a plan (what, why, risk) and wait for my approval before editing. Ask before anything destructive.';
  return {
    sum: `Summarize this ${f.what}: purpose, main systems and current state, from its docs (CLAUDE.md, PROJECT_MEMORY.md or README). Under 200 words. Don't edit anything.${lean}`,
    exp: `Explain ${tgt}: what it does, how it connects to the rest of the ${f.what}, and any risks. Don't edit anything.${lean}`,
    iss: `Review ${tgt} for bugs. List findings ranked by severity with file:line and a one-line fix each.${f.iss} Don't change code.${lean}`,
    ref: `Refactor ${tgt} for clarity and smaller code without changing behaviour.${plan}${lean}`,
    gen: `I want to add: <describe the feature>. Fit it to this ${f.what}'s existing patterns.${plan}${lean}`,
    opt: `Optimize ${tgt} for ${f.opt}. Measure or estimate before and after.${plan}${lean}`,
  }[t] || '';
}

// ---------- layout ----------
function apply(anim) {
  const ws = $('cc-ws'); if (!ws) return;
  if (anim && !S.reducedMotion()) { ws.classList.add('anim'); clearTimeout(apply.t); apply.t = setTimeout(() => ws.classList.remove('anim'), 460); }
  const lr = !!ui.min.nav, rr = !!(ui.min.ai && ui.min.side);
  ws.style.setProperty('--cl', (lr ? RAIL : ui.cl) + 'px'); ws.style.setProperty('--cr', (rr ? RAIL : ui.cr) + 'px'); ws.style.setProperty('--th', ui.th + '%'); ws.style.setProperty('--fw', ui.fw + 'px');
  ws.classList.toggle('lrail', lr); ws.classList.toggle('rrail', rr);
  $('cc-c').classList.toggle('tmin', !!ui.min.term); $('cc-top').classList.toggle('fmin', !!ui.min.files);
  root.querySelectorAll('[data-pn]').forEach(e => { const m = !!ui.min[e.dataset.pn]; e.classList.toggle('min', m); e.querySelector('.cc-x')?.setAttribute('aria-expanded', !m); });
  for (const [g, v] of [['l', ui.ltab], ['r', ui.rtab]]) root.querySelectorAll(`#cc-${g}tabs .tab`).forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); root.querySelector('#cc-' + b.dataset.v + 'w')?.toggleAttribute('hidden', !on); });
  root.querySelectorAll('#cc-pre .tab').forEach(b => { const on = b.dataset.v === ui.preset; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $('cc-custom').classList.toggle('on', ui.preset === 'custom');
}
const custom = () => { ui.preset = 'custom'; $('cc-custom').classList.add('on'); root.querySelectorAll('#cc-pre .tab').forEach(b => b.classList.remove('on')); };
function preset(k) { Object.assign(ui, JSON.parse(JSON.stringify(PRESETS[k])), { preset: k }); apply(true); save(); }
function drag(sp, e) {
  const ws = $('cc-ws'), c = $('cc-c').getBoundingClientRect(), t = $('cc-top').getBoundingClientRect(), w = ws.getBoundingClientRect(), k = sp.dataset.sp;
  const set = (x, y) => {
    if (k === '1') { ui.cl = clamp(x - w.left, [LIM.cl[0], Math.min(LIM.cl[1], w.width - ui.cr - 560)]); delete ui.min.nav; }
    if (k === '2') { ui.cr = clamp(w.right - x, [LIM.cr[0], Math.min(LIM.cr[1], w.width - ui.cl - 560)]); delete ui.min.ai; delete ui.min.side; }
    if (k === 'h') { ui.th = clamp((c.bottom - y) / c.height * 100, LIM.th); delete ui.min.term; }
    if (k === 'f') { ui.fw = clamp(t.right - x, [LIM.fw[0], Math.min(LIM.fw[1], t.width - 320)]); delete ui.min.files; }
    custom(); apply();
  };
  if (e.type === 'keydown') {
    const d = { ArrowLeft: -16, ArrowRight: 16, ArrowUp: -16, ArrowDown: 16 }[e.key]; if (!d) return; e.preventDefault();
    if (k === '1') set(w.left + ui.cl + d); if (k === '2') set(w.right - ui.cr + d); if (k === 'f') set(t.right - ui.fw + d);
    if (k === 'h') set(0, c.bottom - c.height * ui.th / 100 + d); return save();
  }
  sp.setPointerCapture(e.pointerId); sp.classList.add('drag'); ws.classList.add('dragging');
  const mv = ev => set(ev.clientX, ev.clientY), up = () => { sp.removeEventListener('pointermove', mv); sp.classList.remove('drag'); ws.classList.remove('dragging'); save(); };
  sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up, { once: true }); sp.addEventListener('pointercancel', up, { once: true });
}

// ---------- panels ----------
const pn = (id, ic, title, body, extra = '', cls = '') => `<section class="card pn ${cls}" data-pn="${id}" id="pn-${id}">
  <div class="card-h">${icon(ic)}<h2>${title}</h2>${extra}<button class="cc-x" data-min="${id}" aria-expanded="true" aria-label="Collapse ${title}" data-tip="Collapse / expand">${icon('i-chev')}</button></div>${body}</section>`;

function sessions() {
  const el = $('cc-ses'); if (!el) return;
  if (!det) { el.innerHTML = stateBox('loading', 'Loading sessions'); return; }
  const cur = p?.cur?.id, L = (det.sessions || []).slice(0, 8);
  el.innerHTML = L.length ? L.map(s => `<div class="cc-li${s.id === cur ? ' on' : ''}"><span class="tile-ic">${icon(s.id === cur ? 'i-pulse' : 'i-clock')}</span>
    <span><b>${esc(s.prompt || (s.id === cur ? 'This session' : 'Session ' + s.id.slice(0, 8)))}</b><small>${s.id === cur ? 'Active now · ' : ''}${ago(s.last)}${s.tokens != null ? ' · ' + tok(s.tokens) + ' tok' : ''}</small></span>
    <button class="btn sm ghost" data-launch="resume" data-sid="${esc(s.id)}" aria-label="Resume session" data-tip="Resume this session in ${TERMS[S.pref('cc.term')] || 'Windows Terminal'}">${icon('i-play')}</button></div>`).join('')
    : stateBox('empty', 'No sessions yet', 'Start one with New Session.');
}
function projects() {
  const el = $('cc-prj'); if (!el) return;
  if (!projs) { el.innerHTML = stateBox('loading', 'Loading projects'); return; }
  const IC = { roblox: 'i-roblox', blender: 'i-cube', nexus: 'i-term', other: 'i-folder' };
  el.innerHTML = projs.items.filter(x => x.status !== 'archived').map(x => `<button class="cc-li${x.id === ui.proj ? ' on' : ''}" data-proj="${esc(x.id)}">
    <span class="tile-ic">${icon(IC[kind(x)])}</span><span><b>${esc(x.name)}</b><small>${esc(x.dir)}</small></span><span></span></button>`).join('') || stateBox('empty', 'No projects', 'Add one on the Projects page.');
}
const ic = (n, cls) => icon(n).replace('class="ic"', `class="ic ${cls}"`);
function rows(dir, d, f) {
  const k = kids[dir];
  if (!k || k === 1) return `<div class="cc-note" style="--d:${d}">Loading…</div>`;
  if (k.res !== 'ok') return `<div class="cc-note" style="--d:${d}">${esc(k.res)}</div>`;
  return k.items.map(x => {
    const rel = dir ? dir + '/' + x.n : x.n;
    if (x.dir) { const o = !!ui.open?.[rel]; if (f && !o && !x.n.toLowerCase().includes(f)) return '';
      return `<button class="cc-tr${o ? ' open' : ''}" style="--d:${d}" data-dir="${esc(rel)}" aria-expanded="${o}">${ic('i-chev', 'chev')}${ic('i-folder', 'dir')}<span>${esc(x.n)}</span></button>` + (o ? rows(rel, d + 1, f) : ''); }
    if (f && !x.n.toLowerCase().includes(f)) return '';
    const off = x.lock || x.big || x.bin, why = x.lock ? 'Blocked: sensitive file (refused by the server too)' : x.big ? 'Over 1 MB: not shown' : x.bin ? 'Binary file: not shown' : 'Open read-only';
    return `<button class="cc-tr${off ? ' lock' : ''}${ui.cur === rel ? ' on' : ''}" style="--d:${d}" ${off ? 'aria-disabled="true"' : `data-file="${esc(rel)}"`} data-tip="${why}">
      <span style="width:12px;flex:none"></span>${ic(x.lock ? 'i-lock' : 'i-code', 'fil')}<span>${esc(x.n)}</span><small>${bytes(x.size)}</small></button>`;
  }).join('') + (k.more ? `<div class="cc-note" style="--d:${d}">+${k.more} more not listed</div>` : '');
}
function tree() {
  const el = $('cc-tree'); if (!el) return;
  if (!ui.proj) { el.innerHTML = stateBox('empty', 'No project'); return; }
  const f = ($('cc-filt')?.value || '').toLowerCase().trim(), s = el.scrollTop;
  el.innerHTML = `<button class="cc-tr open" style="--d:0" tabindex="-1">${ic('i-chev', 'chev')}${ic('i-folder', 'dir')}<span>${esc(proj()?.name || '')}</span></button>` + rows('', 1, f);
  el.scrollTop = s;
}
async function loadKids(dir) {
  const g = gen; kids[dir] = 1; const j = await getR('/api/cc/tree?' + q({ id: ui.proj, dir }));
  if (g !== gen) return; kids[dir] = j; if (j.res !== 'ok' && dir) { delete ui.open[dir]; save(); } tree();
}
function code() {
  const tabs = $('cc-ftabs'), body = $('cc-view'); if (!tabs) return;
  tabs.innerHTML = ui.files.map(f => `<button class="cc-ft${f === ui.cur ? ' on' : ''}" data-tab="${esc(f)}" data-tip="${esc(f)}">${icon('i-code')}${esc(f.split('/').pop())}<span class="cc-fx" role="button" data-close="${esc(f)}" aria-label="Close ${esc(f)}">${icon('i-x')}</span></button>`).join('') +
    `<span class="end">${ui.cur ? `<button class="btn sm" data-launch="vscode" data-tip="Open this file in VS Code to edit it">${icon('i-code')}Open in VS Code</button>` : ''}</span>`;
  if (!ui.cur) { body.innerHTML = `<div class="cc-empty">${icon('i-code')}<b>No file open</b><span>Pick a file in Files or Recent. Files open read-only.</span></div>`; return; }
  const c = files[ui.cur], cur = ui.cur;
  if (c === undefined) { files[cur] = 1; const g = gen; getR('/api/cc/file?' + q({ id: ui.proj, f: cur })).then(j => { if (g !== gen) return; files[cur] = { ...j, at: Date.now() }; if (ui.cur === cur) code(); }); }
  const path = `<div class="cc-path">${icon('i-lock')}<span>${esc((proj()?.dir || '') + '\\' + cur.replace(/\//g, '\\'))}</span><span style="margin-left:auto"></span>`;
  if (!c || c === 1) { body.innerHTML = path + `</div>${stateBox('loading', 'Reading file')}`; return; }
  if (c.res !== 'ok') { body.innerHTML = path + `</div><div class="cc-empty">${icon('i-lock')}<b>${esc(c.res)}</b><span>Open it in VS Code or Explorer if you need it.</span></div>`; return; }
  const ext = cur.split('.').pop().toLowerCase(), L = c.text.split(/\r?\n/), cut = L.length > MAXL;
  body.innerHTML = path + `<small class="cc-meta">${bytes(c.size)} · ${L.length.toLocaleString()} lines · saved ${ago(c.mtime)}</small><span class="chip" data-tip="Files can't be edited here. Use Open in VS Code.">READ-ONLY</span></div>
    <pre class="cc-src" tabindex="0" aria-label="${esc(cur)} (read-only)">${hl(cut ? L.slice(0, MAXL) : L, LANG[ext] || '')}${cut ? `<span class="cc-cut">Showing the first ${MAXL.toLocaleString()} of ${L.length.toLocaleString()} lines. Open in VS Code for the rest.</span>` : ''}</pre>`;
}
function term() {
  const el = $('cc-out'); if (!el) return;
  const x = proj(), cur = p?.cur, L = [];
  if (ui.tab === 'term' && X.app) { X.mount(el, x?.dir); return; }
  if (ui.tab === 'term') {
    el.innerHTML = `<span class="row m">Embedded shell comes with the desktop app. Launch a real terminal in this project:</span>
    <div class="cc-launch">
      <button class="btn" data-launch="term" data-t="wt">${icon('i-term')}Windows Terminal</button>
      <button class="btn" data-launch="term" data-t="pwsh">${icon('i-term')}PowerShell</button>
      <button class="btn" data-launch="term" data-t="bash">${icon('i-term')}Git Bash</button>
      <button class="btn pri" data-launch="resume" data-sid="${esc(det?.sessions?.[0]?.id || '')}" data-tip="Resume this project's latest Claude session">${icon('i-play')}Resume Claude Session</button>
    </div><span class="row"><span class="i">PS</span> ${esc(x?.dir || '')}&gt; <span class="cc-cur"></span></span>`;
    return;
  }
  if (ui.tab === 'out') {
    if (!live) L.push(`<span class="row m">${det && !liveSid() ? 'No Claude sessions in this project yet.' : 'Reading the session…'}</span>`);
    else if (live.res !== 'ok') L.push(`<span class="row m">${esc(live.res)}</span>`);
    else { L.push(`<span class="row"><span class="g">session ${esc(live.sid.slice(0, 8))}</span>${live.sid === cur?.id ? ' · active now' : ' · latest in this project, last activity ' + ago(live.last)} · last ${live.reqs.length} requests ${chip('live')}</span>`);
      for (const q of live.reqs) {
        if (q.ask) L.push(`<span class="row"><span class="t">[${hhmm(q.ask.t)}]</span> <span class="i">›</span> ${esc(q.ask.q)}</span>`);
        L.push(`<span class="row"><span class="t">[${hhmm(q.t)}]</span> ${esc(model(q.model))}  context <span class="${q.ctx / CTX * 100 >= (S.pref('cc.ctxWarn') || 70) ? 'w' : 'i'}">${tok(q.ctx)}</span>  out ${tok(q.out)}${q.tools.length ? `  <span class="m">${esc(tools(q.tools))}</span>` : ''}</span>`);
      }
      if (!live.reqs.length) L.push('<span class="row m">No requests in the last 512 KB of this session.</span>'); }
  }
  if (ui.tab === 'prob') {
    const last = cur?.ctx?.at(-1), pc = last ? last / CTX * 100 : 0, w = S.pref('cc.ctxWarn') || 70;
    if (pc >= w) L.push(`<span class="row"><span class="w">warn</span>  context at ${Math.round(pc)}% of ~200K (est.) · over your ${w}% warning · consider /compact</span>`);
    const row = cur && (r?.sessions || []).find(s => cur.id.startsWith(s[0]));
    if (row?.[8]) L.push(`<span class="row"><span class="w">warn</span>  this session: est. ${tok(row[8])} wasted tokens${row[9] ? ' · ' + esc(row[9]) : ''}</span>`);
    for (const c of (gitd?.changes || []).filter(c => c.conflict)) L.push(`<span class="row"><span class="e">conflict</span>  ${esc(c.f)} <span class="m">(git ${esc(c.st)})</span></span>`);
    for (const [k, ses, n, t] of (r?.issues || []).slice(0, 12)) { const [a, b] = k.split(':');
      L.push(`<span class="row"><span class="${t > 1e5 ? 'e' : 'w'}">${t > 1e5 ? 'high' : 'warn'}</span>  ${esc(a)} · <span class="i">${esc(b || '')}</span>  <span class="m">${ses} sessions, ${n}× ${t ? '· est. ' + tok(t) + ' tokens' : ''}</span></span>`); }
    if (!L.length) L.push('<span class="row g">No problems found.</span>');
    L.push(`<span class="row m">Context, this session's waste, git conflicts and tracker issues across sessions ${chip('live')}. No compiler or linter runs here.</span>`);
  }
  if (ui.tab === 'git') {
    const g = gitd;
    if (!g) L.push('<span class="row m">Reading git…</span>');
    else if (g.res !== 'ok') L.push(`<span class="row m">${esc(g.res)}</span>`);
    else if (!g.repo) L.push('<span class="row m">Not a git repository.</span>');
    else { L.push(`<span class="row"><span class="g">$</span> git status · branch <span class="i">${esc(g.branch)}</span> · ${g.changes.length ? g.changes.length + ' changed' : 'clean'} ${chip('live')}</span>`);
      for (const c of g.changes.slice(0, 30)) L.push(`<span class="row"><span class="${c.conflict ? 'e' : /\?/.test(c.st) ? 'm' : 'w'}">${esc(c.st.replace(/ /g, '·'))}</span>  ${esc(c.f)}</span>`);
      if (g.changes.length > 30) L.push(`<span class="row m">+${g.changes.length - 30} more</span>`);
      L.push(`<span class="row"><span class="g">$</span> git log --oneline -${g.log.length}</span>`);
      for (const c of g.log) L.push(`<span class="row"><span class="w">${esc(c.h)}</span>  <span class="t">${esc(ago(c.t).padEnd(11, ' '))}</span> ${esc(c.s)}</span>`); }
  }
  const end = el.scrollHeight - el.scrollTop - el.clientHeight < 24; el.innerHTML = L.join(''); if (ui.tab === 'out' && end) el.scrollTop = el.scrollHeight;
}
function activity() {
  const el = $('cc-act'); if (!el) return;
  const cur = p?.cur, mineCur = live?.res === 'ok' && live.sid === cur?.id, R = live?.res === 'ok' ? live.reqs : [];
  if (!cur && !R.length) { el.innerHTML = stateBox('empty', 'No session activity yet'); return; }
  const c = mineCur || !R.length ? cur?.ctx || [] : R.map(x => x.ctx), last = c.at(-1) || 0, sid = mineCur || !R.length ? cur?.id : live.sid, mine = det?.sessions?.find(s => s.id === sid);
  const W = 300, H = 64, mx = Math.max(CTX * .75, ...c), pts = c.map((v, i) => [(i / Math.max(1, c.length - 1)) * W, H - 4 - v / mx * (H - 8)]), wy = H - 4 - CTX * (S.pref('cc.ctxWarn') || 70) / 100 / mx * (H - 8);
  const tl = (proj()?.stats?.tools || []).slice(0, 6), tmax = tl[0]?.[1] || 1;
  el.innerHTML = `<div class="cc-stat"><div><small>Requests</small><b>${sid === cur?.id ? cur.n : R.length + (R.length >= 40 ? '+' : '')}</b></div><div><small>Context</small><b>${tok(last)}</b></div><div><small>Session tokens</small><b>${mine?.tokens != null ? tok(mine.tokens) : '—'}</b></div></div>
    <div class="cc-sub">Context growth ${chip('live', `Context size of each request in session ${(sid || '').slice(0, 8)}${sid === cur?.id ? ' (active now)' : ' (this project\'s latest)'}. Dashed line = your context warning, on an estimated 200K window.`)}</div>
    <svg class="cc-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Context grew to ${tok(last)} over ${c.length} requests">
      <line class="wl" x1="0" x2="${W}" y1="${wy}" y2="${wy}"/>${pts.length > 1 ? `<path class="a" d="M0 ${H} L${pts.map(q => q.join(' ')).join(' L')} L${W} ${H} Z"/><polyline class="ln" points="${pts.map(q => q.join(',')).join(' ')}"/>` : ''}</svg>
    <div class="cc-sub">Tool usage · this project ${chip('live', 'Tool calls in this project\'s tracked sessions.')}</div>
    ${tl.map(([n, v]) => `<div class="cc-bar"><span>${esc(n)}</span><i style="--p:${Math.round(v / tmax * 100)}%"></i><b>${tok(v)}</b></div>`).join('') || '<div class="cc-note">No tool calls tracked.</div>'}
    <div class="cc-sub">Recent requests ${chip('live', 'Newest requests of that session, read from its transcript.')}</div>
    ${R.slice(-5).reverse().map(x => `<div class="cc-req" data-tip="${esc(hhmm(x.t))} · ${esc(model(x.model))} · in ${tok(x.in)} · out ${tok(x.out)} · cache write ${tok(x.cw)} · cache read ${tok(x.cr)}"><time>${esc(ago(x.t))}</time><span>${x.tools.length ? `<b>${esc(tools(x.tools))}</b>` : '<b>Reply</b>'}</span><b>${tok(x.out)}</b></div>`).join('') || '<div class="cc-note">Reading the session…</div>'}`;
}
function context() {
  const el = $('cc-ctx'); if (!el) return;
  const x = proj(), sk = inv?.skills?.length ?? inv?.counts?.skills;
  const row = (ic, k, v) => `<span>${icon(ic)}${k}</span><b title="${esc(String(v))}">${esc(String(v))}</b>`;
  el.innerHTML = `<div class="cc-kv">${row('i-folder', 'Current Project', x?.name || '—')}${row('i-code', 'Active File', ui.cur || 'None')}
    ${row('i-book', 'Project Docs', det ? (det.docs || []).length + ' files' : '…')}${row('i-clock', 'Sessions', x?.stats?.sessions ?? '—')}
    ${row('i-puzzle', 'Claude Skills', sk != null ? sk + ' installed' : '…')}${row('i-graph', 'Knowledge Graph', det?.graph ? det.graph.nodes + ' notes' : '—')}
    ${row('i-git', 'Git', gitd?.repo ? `${gitd.branch} · ${gitd.changes.length ? gitd.changes.length + ' changed' : 'clean'}` : gitd ? 'No repo' : '…')}</div>`;
}
function recent() {
  const el = $('cc-rec'); if (!el) return;
  const m = new Map(), add = (f, t, why) => { if (f && t && !DENY.test(f.split('/').pop()) && (!m.has(f) || m.get(f).t < t)) m.set(f, { t, why }); };
  for (const d of det?.docs || []) add(d.f, d.mtime, 'doc');
  for (const c of gitd?.changes || []) if (!c.f.endsWith('/')) add(c.f, c.mtime, 'git ' + c.st.trim());
  if (live?.res === 'ok') for (const e of live.edits) add(e.f, e.t, 'edited by Claude');
  const L = [...m].sort((a, b) => b[1].t - a[1].t).slice(0, 8);
  el.innerHTML = L.map(([f, o]) => `<button class="cc-rf" data-file="${esc(f)}" data-tip="${esc(f)} · ${esc(o.why)}">${icon('i-code')}<span>${esc(f)}</span><small>${ago(o.t)}</small></button>`).join('') || '<div class="cc-note">No recent files.</div>';
}
function kpis() {
  const cur = p?.cur, x = proj(), set = (id, v, f, c = '') => { const e = $(id); if (!e) return; const b = e.querySelector('.v'); b.textContent = v; b.title = v; e.querySelector('.f').innerHTML = f; e.querySelector('.f').title = e.querySelector('.f').textContent; e.querySelector('.kc').innerHTML = c; };
  if (cur) { const on = Date.now() - cur.end < 120000, m = Math.round((cur.end - cur.start) / 60000);
    set('k-ses', on ? 'Active' : 'Idle', `<span class="dot ${on ? 'ok' : ''}"></span> ${m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'} · ${esc(cur.id.slice(0, 8))}`, chip('live')); }
  const w = r?.window; if (w) { const t = (w.tokens || []).reduce((a, b) => a + b, 0);
    set('k-tok', tok(t), w.limit ? `${w.pct}% of ${tok(w.limit)} · resets ${esc(w.resets)}` : `5 h window · resets ${esc(w.resets)}`, chip('live')); }
  if (cur) set('k-mod', model(cur.model), `${cur.n} requests this session`, chip('live'));
  if (x) set('k-prj', x.name, esc(x.dir));
  if (p) { const pc = (a, b) => b ? Math.round(a / b * 100) : 0, ram = pc(p.mem[1], p.mem[0]), dk = p.disk ? pc(p.disk[1], p.disk[0]) : 0, e = $('k-sys');
    if (e) e.querySelector('.cc-sys').innerHTML = [['CPU', p.cpu + '%', Math.min(100, p.cpu * 4), 'Tracker process CPU'], ['RAM', ram + '%', ram, 'PC memory in use'], ['Disk', dk + '%', dk, 'System drive used']]
      .map(([k, v, q, t]) => `<div data-tip="${t}"><span>${k}</span><b>${v}</b><i style="--p:${q}%"></i></div>`).join(''); }
}
const draw = () => { kpis(); sessions(); projects(); tree(); code(); term(); activity(); context(); recent(); };

// ---------- launch: confirm dialog, then POST /api/projects {op:'open'} ----------
function launch(b) {
  const x = proj(), t = b.dataset.t || S.pref('cc.term') || 'wt', a = b.dataset.launch, ai = b.dataset.ai, d = $('cc-dlg'); if (!x) return toast('Pick a project in Workspace → Projects first.', 'warn', 'No project selected');
  const dir = x.dir, tn = TERMS[t] || TERMS.wt, sid = b.dataset.sid || det?.sessions?.[0]?.id || '';
  let title, desc, cmd, txt = null, body;
  if (X.app && ((a === 'term' && b.dataset.t !== 'wt') || ((a === 'resume' || a === 'new') && !ai))) { // embedded shell in the Terminal tab
    const c = a === 'term' ? '' : a === 'resume' && /^[w-]+$/.test(sid) ? 'claude --resume ' + sid : 'claude';
    if (ui.tab !== 'term') root.querySelector('#cc-ttabs [data-v="term"]')?.click();
    if (ui.min.term) { delete ui.min.term; apply(true); save(); }
    return X.open(a === 'term' ? b.dataset.t : null, dir, c).then(e => e ? toast(e, 'err', "Couldn't open the terminal") : null);
  }
  if (a === 'term') { title = 'Open ' + tn; desc = 'A plain shell in the project folder.'; cmd = t === 'bash' ? `git-bash.exe --cd="${dir}"` : t === 'pwsh' ? `powershell.exe -NoExit   (in ${dir})` : `wt.exe -d "${dir}"`; body = { what: 'term', term: t }; }
  else if ((a === 'resume' || ai === 'cont') && sid) { title = 'Resume Claude session'; desc = `Continues session ${sid.slice(0, 8)} in ${tn}.`; cmd = `claude --resume ${sid}`; body = { what: 'session', resume: sid, term: t }; }
  else if (a === 'new' || ai === 'new' || a === 'resume' || ai === 'cont') { title = 'New Claude Code session'; desc = `A fresh session in ${tn}, in ${x.name}.${sid ? '' : ' (No earlier session to resume.)'}`; cmd = 'claude'; body = { what: 'session', term: t }; }
  else if (a === 'vscode') { title = 'Open in VS Code'; desc = 'VS Code opens it for editing. NEXUS never writes files.'; cmd = ui.cur ? `Code.exe "${dir}" -g "${dir}\\${ui.cur.replace(/\//g, '\\')}"` : `Code.exe "${dir}"`; body = { what: 'vscode', ...(ui.cur ? { f: ui.cur } : {}) }; }
  else if (a === 'explorer') { title = 'Open in Explorer'; desc = 'Shows the project folder.'; cmd = `explorer.exe "${dir}"`; body = { what: 'explorer' }; }
  else { const T = AI.find(q => q[0] === ai); if (!T) return; title = T[1]; desc = `Starts Claude Code in ${x.name} (${tn}) with this prompt. Edit it or cancel.`; txt = prompt(ai, x, ui.cur);
    cmd = t === 'bash' ? 'claude "$(cat <prompt file>)"' : 'powershell -EncodedCommand → claude (prompt read from a file, never run as a command)'; body = { what: 'ai', tool: ai, term: t }; }
  d.innerHTML = `<form method="dialog"><h3>${icon(a === 'ai' ? AI.find(q => q[0] === ai)[2] : 'i-term')}${esc(title)}</h3><p>${esc(desc)}</p>
    ${txt != null ? `<textarea id="cc-pt" aria-label="Prompt" spellcheck="false" maxlength="4096">${esc(txt)}</textarea>` : ''}
    <div class="cc-cmd">${esc(cmd)}<br><span style="color:var(--muted)">in ${esc(dir)}</span></div>
    <div class="row"><span class="muted">${O.preview ? 'Preview: nothing launches.' : ''}</span><button class="btn" value="cancel">Cancel</button>
    <button class="btn pri" value="go" ${O.preview ? 'disabled data-tip="Preview only. Launch from the real page (#/claude-code)."' : ''}>${icon('i-play')}Launch</button></div></form>`;
  d.onclose = async () => {
    if (d.returnValue !== 'go' || O.preview) return;
    if (txt != null) { body.prompt = $('cc-pt').value.trim(); if (!body.prompt || body.prompt.includes('<describe the feature>')) return toast(body.prompt ? 'Replace <describe the feature> with what you want, then press Launch again.' : 'Write a prompt, then press Launch again.', 'warn', 'Nothing launched'); }
    let res; try { res = (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'open', id: x.id, ...body }) })).json()).res; } catch { res = null; }
    res === 'ok' ? toast(title + ': launched') : toast(res ? 'The tracker answered: ' + res : NOREACH, 'err', `Couldn't launch ${title}`);
  };
  d.returnValue = ''; d.showModal(); d.querySelector('textarea,button[value=cancel]')?.focus();
}

// ---------- data ----------
async function loadLive() { const sid = liveSid(), g = gen; if (!sid) { live = null; return; } const j = await getR('/api/cc/live?' + q({ id: ui.proj, sid })); if (g !== gen) return;
  for (const e of j.edits || []) if (files[e.f]?.at && e.t > files[e.f].at) { delete files[e.f]; if (e.f === ui.cur) code(); } // Claude edited the open file: re-read it
  live = j; }
async function loadGit() { const g = gen, j = await getR('/api/cc/git?' + q({ id: ui.proj })); if (g === gen) gitd = j; }
async function loadDet() {
  gen++; det = null; kids = {}; files = {}; live = null; gitd = null; draw();
  const g = gen; loadKids(''); for (const d of Object.keys(ui.open || {}).sort((a, b) => a.split('/').length - b.split('/').length).slice(0, 20)) loadKids(d);
  try { det = await getJ('/api/projects?id=' + encodeURIComponent(ui.proj)); } catch { det = { sessions: [], top: [], docs: [] }; }
  if (g !== gen) return; draw();
  await Promise.all([loadLive(), loadGit()]); if (g === gen) { term(); activity(); recent(); context(); }
}
async function poll() {
  if (document.hidden || !root) return;
  try { p = await getJ('/api/proc'); } catch { return; }
  await Promise.all([loadLive(), ui.tab === 'git' || ui.tab === 'prob' || ui.rtab !== 'act' ? loadGit() : null]);
  if (!root) return; kpis(); activity(); sessions(); if (ui.tab !== 'term') term(); recent(); context();
}
function sched() { clearInterval(timer); const s = +S.pref('cc.refresh'); if (s > 0) timer = setInterval(poll, s * 1000); }

export async function mount(el, params = [], opts = {}) {
  root = el; O = opts; KEY = opts.preview ? 'jv.cc.preview' : 'jv.cc';
  ui = { preset: 'balanced', ...JSON.parse(JSON.stringify(PRESETS.balanced)), tab: 'term', ltab: 'ses', rtab: 'act', proj: null, files: [], cur: null, open: {} };
  try { Object.assign(ui, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { }
  el.innerHTML = `<div class="pg cc enter">
  <header class="pg-h" style="--i:0"><span class="tile-ic pg-ic">${icon('i-term')}</span>
    <div class="pg-t"><h1>Claude Code ${opts.preview ? chip('demo', 'Design preview: real data; launches stop at the confirm dialog.').replace('DEMO', 'PREVIEW') : ''}</h1><p>Terminal workspace with project context, live session activity and AI tools. Files are read-only here.</p></div>
    <div class="end"><button class="btn" data-launch="new">${icon('i-plus-folder')}New Session</button>
      <button class="btn pri" data-launch="term">${icon('i-term')}Open in Terminal</button>${more('cc-launch', 'Launch buttons')}</div></header>
  <div id="cc-err"></div>
  <div class="cc-k" style="--i:1">${kpi('k-ses', 'i-pulse', 'Current Session' + more('cc-ses', 'Current Session and Model'))}${kpi('k-tok', 'i-gauge', 'Token Usage · 5 h' + more('cc-tok', 'Token Usage · 5 h'))}${kpi('k-mod', 'i-chip', 'Model' + more('cc-ses', 'Current Session and Model'))}${kpi('k-prj', 'i-folder', 'Project')}
    <div class="kpi" id="k-sys"><span class="tile-ic">${icon('i-pulse')}</span><div class="kpi-b" style="flex:1"><span class="k">System${more('cc-sys', 'System')}</span><div class="cc-sys"></div></div></div></div>
  <div class="cc-tb" style="--i:2" role="toolbar" aria-label="Quick access and layout">
    <span class="cc-tb-l">Quick Access</span>
    <button class="btn sm ghost" data-launch="explorer" data-tip="Open the project folder in Explorer">${icon('i-folder')}Explorer</button>
    <button class="btn sm ghost" data-launch="term" data-t="wt" data-tip="Windows Terminal in the project folder">${icon('i-term')}Terminal</button>
    <button class="btn sm ghost" data-launch="term" data-t="bash" data-tip="Git Bash in the project folder">${icon('i-term')}Git Bash</button>
    <button class="btn sm ghost" data-launch="vscode" data-tip="Open the project (or the open file) in VS Code">${icon('i-code')}VS Code</button>
    <span class="cc-tb-sp"></span><span class="cc-custom" id="cc-custom">Custom layout</span>
    <div id="cc-pre">${seg([['balanced', 'Balanced'], ['terminal', 'Terminal Focus'], ['code', 'Code Focus']], ui.preset)}</div>
    <button class="btn sm ghost" data-a="reset" data-tip="Back to the default Balanced layout">${icon('i-undo')}Reset Layout</button>${more('cc-layout', 'Layout')}</div>
  <div class="cc-ws" id="cc-ws" style="--i:3">
    <div class="cc-col">
      ${pn('nav', 'i-layers', 'Workspace', `<div id="cc-sesw" class="pn-b"><div id="cc-ses"></div></div><div id="cc-prjw" class="pn-b" hidden><div id="cc-prj"></div></div>`,
        `<div id="cc-ltabs" class="cc-ptabs">${seg([['ses', 'Sessions'], ['prj', 'Projects']], ui.ltab)}</div><button class="cc-x cc-add" data-launch="new" aria-label="New session" data-tip="New session">${icon('i-plus-folder')}</button>`, 'cc-tabbed')}
    </div>
    <div class="cc-sp" data-sp="1" role="separator" aria-orientation="vertical" aria-label="Resize left column" tabindex="0"></div>
    <div class="cc-c" id="cc-c">
      <div class="cc-top" id="cc-top">
        <section class="card pn cc-code"><div class="cc-ftabs" id="cc-ftabs"></div><div id="cc-view" style="display:flex;flex-direction:column;flex:1;min-height:0"></div></section>
        <div class="cc-sp" data-sp="f" role="separator" aria-orientation="vertical" aria-label="Resize files panel" tabindex="0"></div>
        ${pn('files', 'i-folder', 'Files', '<input class="cc-filt" id="cc-filt" placeholder="Filter opened folders…" aria-label="Filter files"><div class="pn-b cc-tree" id="cc-tree"></div>', more('cc-files', 'Files'), 'cc-files')}
      </div>
      <div class="cc-sp h" data-sp="h" role="separator" aria-orientation="horizontal" aria-label="Resize terminal panel" tabindex="0"></div>
      ${pn('term', 'i-term', 'Terminal', '<div class="cc-out" id="cc-out" role="log"></div>', `<div id="cc-ttabs">${seg(TTABS, ui.tab)}</div>${more('cc-term', 'Terminal tabs')}`, 'cc-term')}
    </div>
    <div class="cc-sp" data-sp="2" role="separator" aria-orientation="vertical" aria-label="Resize right column" tabindex="0"></div>
    <div class="cc-col r">
      ${pn('ai', 'i-spark', 'AI Tools', `<div class="cc-ai">${AI.map(([k, t, ic, c]) => `<button class="btn" data-launch="ai" data-ai="${k}" style="--tc:${c}">${icon(ic)}${t}</button>`).join('')}</div>`, more('cc-ai', 'AI Tools'), 'fit')}
      ${pn('side', 'i-pulse', 'Insights', `<div id="cc-actw" class="pn-b"><div id="cc-act"></div></div><div id="cc-ctxw" class="pn-b" hidden><div id="cc-ctx"></div></div><div id="cc-recw" class="pn-b" hidden><div id="cc-rec"></div></div>`,
        `<div id="cc-rtabs" class="cc-ptabs">${seg([['act', 'Activity'], ['ctx', 'Context'], ['rec', 'Recent']], ui.rtab)}</div>${more('cc-ins', 'Insights')}`, 'cc-tabbed')}
    </div>
  </div>
  <dialog class="lx-dlg cc-dlg" id="cc-dlg" aria-label="Launch"></dialog></div>`;
  apply();
  el.addEventListener('click', click); el.addEventListener('input', e => e.target.id === 'cc-filt' && tree());
  el.querySelectorAll('.cc-sp').forEach(sp => { sp.addEventListener('pointerdown', e => drag(sp, e)); sp.addEventListener('keydown', e => drag(sp, e)); });
  const vis = () => !document.hidden && poll(); document.addEventListener('visibilitychange', vis);
  const off = S.onChange(k => (k === '*' || k === 'cc.refresh') && sched()); offVis = () => { document.removeEventListener('visibilitychange', vis); off(); };
  return boot();
}
let booting = 0;
async function boot() { // first load; again after the tracker comes back if it failed (D3: Retry now)
  booting = 1; let ok = true;
  try { [r, p, projs] = await Promise.all([getJ('/api'), getJ('/api/proc'), getJ('/api/projects')]); } catch { ok = false; }
  booting = 0; if (!root) return ok;
  getJ('/api/inv').then(j => { inv = j; context(); }).catch(() => { });
  if (projs?.items?.length && !projs.items.some(x => x.id === ui.proj)) ui.proj = (projs.items.find(x => p?.cur && x.dir.toLowerCase().endsWith(p.cur.project.toLowerCase())) || projs.items[0]).id;
  if (!ui.cur && !ui.files.length) { ui.files = ['CLAUDE.md']; ui.cur = 'CLAUDE.md'; }
  draw(); if (ui.proj) loadDet(); else if (!ok) $('cc-ses').innerHTML = stateBox('error', 'No sessions to show.', 'See the message at the top of the page.');
  sched();
  return ok;
}
function click(e) {
  const b = e.target.closest('button, [data-close]'); if (!b || b.disabled) return;
  if (b.dataset.close) { e.stopPropagation(); ui.files = ui.files.filter(f => f !== b.dataset.close); if (ui.cur === b.dataset.close) ui.cur = ui.files.at(-1) || null; save(); code(); tree(); context(); return; }
  if (b.dataset.min) { ui.min[b.dataset.min] = !ui.min[b.dataset.min]; if (!ui.min[b.dataset.min]) delete ui.min[b.dataset.min]; custom(); apply(true); return save(); }
  if (b.closest('#cc-pre') && b.dataset.v) return preset(b.dataset.v);
  if (b.closest('#cc-ltabs, #cc-rtabs') && b.dataset.v) { const L = !!b.closest('#cc-ltabs'); ui[L ? 'ltab' : 'rtab'] = b.dataset.v; delete ui.min[b.closest('[data-pn]')?.dataset.pn]; apply(true); save(); if (!L) { recent(); context(); if (b.dataset.v !== 'act' && !gitd) loadGit().then(() => { recent(); context(); }) } return; }
  if (b.closest('#cc-ttabs') && b.dataset.v) { ui.tab = b.dataset.v; root.querySelectorAll('#cc-ttabs .tab').forEach(t => { t.classList.toggle('on', t === b); t.setAttribute('aria-selected', t === b); }); save(); term(); if (ui.tab === 'git' || ui.tab === 'prob') loadGit().then(term); return; }
  if (b.dataset.a === 'reset') { try { localStorage.removeItem(KEY); } catch { } const keep = { proj: ui.proj, files: ui.files, cur: ui.cur, open: ui.open }; preset('balanced'); Object.assign(ui, keep, { tab: 'term', ltab: 'ses', rtab: 'act' }); apply(); save(); term(); return toast('Layout reset to Balanced'); }
  if (b.dataset.proj) { if (b.dataset.proj === ui.proj) return; ui.proj = b.dataset.proj; ui.files = []; ui.cur = null; ui.open = {}; save(); return loadDet(); }
  if (b.dataset.dir) { const d = b.dataset.dir, o = !ui.open?.[d]; ui.open = { ...ui.open }; if (o) ui.open[d] = 1; else delete ui.open[d]; save(); if (o && !kids[d]) loadKids(d); return tree(); }
  if (b.dataset.file) { const f = b.dataset.file; if (DENY.test(f.split('/').pop())) return toast('NEXUS never shows files that may hold passwords or keys. Open it in VS Code if you need it.', 'warn', 'Sensitive file blocked'); if (!ui.files.includes(f)) ui.files = [...ui.files, f].slice(-8); ui.cur = f; save(); code(); tree(); return context(); }
  if (b.dataset.tab) { ui.cur = b.dataset.tab; save(); code(); tree(); return context(); }
  if (b.dataset.launch) return launch(b);
  if (b.dataset.a === 'retry') return apiPoll();
}
export function update(st) {
  if (!root) return;
  const h = !st?.ok && st?.at ? errBox({ title: 'Tracker not reachable', where: 'Claude Code', what: "NEXUS can't reach its tracker, so this page can't read sessions, files, git or the terminal output.", why: (st.r ? 'Numbers on this page may be out of date. ' : 'Panels stay empty. ') + "Launch buttons won't work until it is back. Embedded terminals keep running.",
    affected: 'Sessions, files, git, activity and launches. ' + retryText(), steps: ['Make sure the tracker is running: node ~/.claude/token-tracker/tracker.js serve', 'Press Retry now.'], actions: [['retry', 'Retry now', true]], tech: 'GET /api failed (api.js poll). Retry now runs the same poll at once; this page then reloads its own data.' }) : '';
  const e = $('cc-err'); if (e && e._h !== h) { e._h = h; e.innerHTML = h; } // rebuilt only on change, so a focused Retry now keeps focus
  if (!st?.r) return; if (st.ok && !projs && !booting) boot();
  r = st.r; kpis(); if (ui.tab === 'prob') term(); } // main.js usage poll (10 s)
export function unmount() { clearInterval(timer); offVis?.(); root = null; gen++; }
