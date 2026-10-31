// NEXUS Setup preview (M0). Pure design simulation: every action below only changes this page.
// The one network call is GET /api/setup/detect (read-only, see setup.js). Nothing is installed, written or deleted.
const $ = s => document.querySelector(s);
import { crtWarp, CRT_WARP_PREVIEW } from './crtwarp.js';
crtWarp(document.getElementById('setup-bg'), { ...CRT_WARP_PREVIEW, color: '#8f7cc0', backgroundColor: '#131118' }); // same backdrop as the app's purple glass default
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = {
  check: '<path d="M20 6 9 17l-5-5"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>', lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>', term: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>', up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="10" cy="18" r="2.5"/><path d="m8.5 6.4 7 1.2M7 8.3l2 7.4M16.6 10.1l-5.2 6"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', gem: '<path d="M12 2 4 9l3 11h10l3-11z"/><path d="M12 2 9 9l3 11 3-11zM4 9h16"/>', node: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M12 22V12M3 7l9 5 9-5"/>',
  git: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 8v8M8 6.5c5 0 8 2 8 3.5"/>', window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>', undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', back: '<path d="M19 12H5M11 6l-6 6 6 6"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', play: '<path d="M7 4v16l13-8z"/>'
};
const ic = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
const DI = { webview2: 'window', node: 'node', claude: 'spark', obsidian: 'gem', uv: 'bolt', graphify: 'graph', git: 'git' };
const gb = n => (n / 1e9).toFixed(n > 1e11 ? 0 : 1) + ' GB';
const VER = '1.0.0', NEWVER = '1.1.0', STAMP = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, s => s === 'T' ? '_' : '');

// simulated machines (labelled SIMULATED in the UI); "this PC" uses the real read-only detection
const CLEAN = (real, m) => ({ sim: true, vaults: m?.vaults || [], graphifySkill: false, readOnly: true, rust: false, shells: ['Windows PowerShell', 'Command Prompt'], disk: { free: 412e9, total: 512e9 }, existing: null,
  deps: (real?.deps || []).map(d => ({ ...d, found: d.id === 'webview2' || !!m?.found[d.id], version: d.id === 'webview2' ? d.version : m?.found[d.id] || null, note: null })), paths: real?.paths || { program: '%LOCALAPPDATA%\\Programs\\NEXUS', data: '%APPDATA%\\NEXUS', backups: '%USERPROFILE%\\NEXUS Backups' } });
const HOOKS = ['SessionStart', 'UserPromptSubmit', 'Stop', 'PreCompact'];
const INTEG = ['obsidian', 'python', 'uv', 'graphify']; // set up on their own steps, not on Components
const U = '%USERPROFILE%\\';
// "Maintenance · new layout" mock (SIMULATED): Obsidian with several vaults (one without .obsidian, one whose folder is gone), Python only, two projects
const MOCK = { found: { obsidian: '1.9.10', python: '3.12.4' }, plist: [{ name: 'My Game', dir: U + 'Documents\\My Game', vault: '', graph: false }, { name: 'Website', dir: U + 'Documents\\Website', vault: '', graph: false }],
  vaults: [{ name: 'Work Notes', path: U + 'Documents\\Work Notes', exists: true, dot: true, plugins: 3, reg: true }, { name: 'Game Design', path: U + 'OneDrive\\Game Design', exists: true, dot: true, plugins: 0, reg: true },
    { name: 'Projects', path: U + 'Documents\\Projects', exists: true, dot: false, plugins: 0, reg: true }, { name: 'Old Vault', path: 'D:\\Archive\\Old Vault', exists: false, dot: false, plugins: 0, reg: true }] };
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
// paths break only after a backslash; the full path stays in the tooltip
const pth = s => `<code class="pth" title="${esc(s)}">${esc(s).replace(/\\/g, '\\<wbr>')}</code>`;
const li = (cls, i, t, path = '', tag = '') => `<li class="${cls}">${ic(i)}<div class="tx"><div>${t}</div>${path ? pth(path) : ''}</div>${tag ? `<span class="tag">${tag}</span>` : ''}</li>`;
// emblem: layered hex core + two tilted orbits (SMIL dots, CSS opacity/dash only: no layout, no filters)
const LOGO = (c = '') => `<svg class="logo ${c}" viewBox="0 0 160 160" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#B794FF"/><stop offset="1" stop-color="#8F5BFF"/></linearGradient>
  <radialGradient id="lh"><stop offset="0" stop-color="#B794FF" stop-opacity=".3"/><stop offset=".6" stop-color="#8F5BFF" stop-opacity=".06"/><stop offset="1" stop-color="#8F5BFF" stop-opacity="0"/></radialGradient></defs>
  <circle class="l-halo" cx="80" cy="80" r="78" fill="url(#lh)"/>
  ${[[-28, 9], [32, 14]].map(([r, s], i) => `<g transform="rotate(${r} 80 80)"><ellipse cx="80" cy="80" rx="72" ry="24" fill="none" stroke="url(#lg)" stroke-opacity="${i ? .28 : .45}" stroke-width="1.2"/>
    <circle ${RM ? 'cx="152" cy="80"' : ''} r="${i ? 2.2 : 3}" fill="${i ? '#B794FF' : '#8F5BFF'}">${RM ? '' : `<animateMotion dur="${s}s" repeatCount="indefinite" path="M8 80a72 24 0 1 0 144 0a72 24 0 1 0 -144 0"/>`}</circle></g>`).join('')}
  <polygon class="l-hexo" points="80,36 118.1,58 118.1,102 80,124 41.9,102 41.9,58" fill="rgba(4,17,10,.6)" stroke="url(#lg)" stroke-width="2" stroke-dasharray="14 6"/>
  <polygon points="80,50 106,65 106,95 80,110 54,95 54,65" fill="url(#lg)"/><polygon points="80,50 106,65 80,80 54,65" fill="#fff" fill-opacity=".2"/>
  <path d="M69 93V67l22 26V67" fill="none" stroke="#1A0B33" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const S = { scen: 'this', real: null, err: null, flow: [], i: 0, dir: 1, c: {}, run: 0, prog: null, modal: null };
const det = () => S.scen === 'new' ? CLEAN(S.real) : S.scen === 'mnew' ? CLEAN(S.real, MOCK) : S.real;
const adopt = () => S.scen === 'this' || S.scen === 'mthis';
const maint = () => S.scen[0] === 'm';
const dep = id => det()?.deps.find(x => x.id === id) || {};
const projs = () => (adopt() ? det()?.existing?.plist : S.scen === 'mnew' ? MOCK.plist : null) || [];
const integ = () => maint() && S.c.act === 'integ';
const eb = () => maint() ? 'Integrations' : 'Step ' + (S.i + 1);

function reset() {
  const d = det();
  S.c = { type: d?.existing ? 'adopt' : 'new', dep: {}, hooks: 'add', desk: true, start: true, boot: false, close: 'tray', shell: d?.shells?.[0] || 'Windows PowerShell', launch: true, consent: false, terms: false, skills: Object.fromEntries(SKILLS.map(s => [s.id, true])),
    prog: d?.paths?.program || '', data: d?.paths?.data || '', act: 'update', delData: false, typed: '', rmHooks: true, bk: 0, rolled: false, failed: false, retried: false, fallback: false };
  for (const x of d?.deps || []) if (!x.found) S.c.dep[x.id] = x.role === 'required' ? 'auto' : 'skip';
  // Obsidian: nothing is pre-selected except vaults the existing NEXUS already links (the user's earlier choice, never a name match)
  const kept = [...new Set(projs().map(p => p.vault).filter(Boolean))];
  S.c.obs = { mode: dep('obsidian').found ? 'use' : 'skip', sel: Object.fromEntries(kept.map(p => [p, true])), use: Object.fromEntries(projs().filter(p => p.vault).map(p => [p.vault, p.name])), kept, extra: [], create: false, cpath: U + 'Documents\\NEXUS Vault', bpath: '', berr: '', ok: false };
  // Graphify: an existing install is reused; folders that already have a Graphify graph start on, everything else off
  S.c.gfy = { mode: dep('graphify').found ? 'graphify' : 'builtin', scope: Object.fromEntries(projs().filter(p => p.graph).map(p => [p.dir, true])), extra: [], fpath: '', ferr: '' };
  S.flow = maint() ? ['mwelcome', 'mupdate', 'progress', 'done'] : ['welcome', 'terms', 'type', 'location', 'deps', 'claude', 'obsidian', 'graphify', 'skills', 'options', 'review', 'progress', 'done'];
  S.i = 0; S.dir = 1; S.run++; S.prog = null; S.modal = null;
}
const TERMS = [
`# MIT License`,
`Copyright (c) 2026 the NEXUS authors`,
`Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:`,
`The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.`,
`THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`];
// Recommended Claude Code skills/plugins: all on by default, each can be switched off
const SKILLS = [
  { id: 'caveman', name: 'Caveman', d: 'Short, direct replies. Cuts tokens on every answer.' },
  { id: 'claude-mem', name: 'Claude Mem', d: 'Persistent memory across Claude Code sessions.' },
  { id: 'skill-creator', name: 'Skill Creator', d: 'Create, edit and test your own skills.' },
  { id: 'ponytail', name: 'Ponytail', d: 'Simplest working code: no bloat, no over-engineering.' },
  { id: 'ui-ux-pro-max', name: 'UI/UX Pro Max', d: 'Design guidance for pages, components, colour and accessibility.' },
  { id: 'roblox-dev', name: 'Roblox Dev', d: 'Roblox, Luau and Studio scripting, debugging and best practice.' }];
const LBL = { welcome: 'Welcome', terms: 'Terms', type: 'Install type', location: 'Location', deps: 'Components', claude: 'Claude Code', obsidian: 'Obsidian', graphify: 'Graphify', skills: 'Skills', options: 'Options', review: 'Review', progress: 'Installing', done: 'Finish',
  mwelcome: 'Choose action', mupdate: 'Update', mrepair: 'Repair', muninst: 'Uninstall', mrestore: 'Restore' };
const PLBL = { update: 'Updating', repair: 'Repairing', uninstall: 'Uninstalling', restore: 'Restoring', integ: 'Configuring' };

/* ---------------- screens: each returns { h: html, next, back, hint } ---------------- */
const scr = {
  welcome() {
    const d = det(), e = d?.existing;
    return { h: `<div class="hero">${LOGO()}<div><div class="eyebrow">NEXUS Setup · ${VER}</div><h1>Welcome to <em>NEXUS</em></h1>
      <p class="lead">Your local command center for Claude Code: token intelligence, projects, Obsidian vaults, knowledge graph, automations and system health, in one desktop app.</p>
      ${e ? `<div class="note">${ic('link')}<div><b>Existing NEXUS found</b> · ${e.projects} project${e.projects === 1 ? '' : 's'} · ${e.hooks} Claude Code hook${e.hooks === 1 ? '' : 's'}${e.automations ? ' · automations' : ''}${pth(e.dir)}Setup connects the desktop app to it. Nothing is moved, reset or overwritten.</div></div>` : ''}
      ${d?.sim ? `<div class="note info">${ic('info')}<div><b>Simulated new PC.</b> Detection results below are a mock clean Windows 11, not this machine.</div></div>` : ''}</div></div>
      <div class="feat"><div class="card">${ic('lock')}<b>Local and private</b><span>Runs on 127.0.0.1 only. No telemetry, no uploads, nothing shared without your OK.</span></div>
      <div class="card">${ic('folder')}<b>Per-user install</b><span>No admin rights. Program and personal data kept apart.</span></div>
      <div class="card">${ic('shield')}<b>Verified sources</b><span>Components come only from official sources, checked before they run.</span></div></div>`,
      next: { t: 'Get started', ok: !!d } };
  },
  terms() {
    const body = TERMS.map(l => l.startsWith('## ') ? `<h4>${l.slice(3)}</h4>` : l.startsWith('# ') ? `<h3>${l.slice(2)}</h3>` : l.startsWith('- ') ? `<li>${l.slice(2)}</li>` : `<p>${l}</p>`)
      .join('').replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>');
    return { h: `<div class="eyebrow">${eb()}</div><h1>License</h1><p class="lead">NEXUS is open source under the MIT license.</p>
      <div class="terms" tabindex="0" role="document" aria-label="NEXUS MIT license">${body}</div>
      <label class="consent"><input type="checkbox" data-terms ${S.c.terms ? 'checked' : ''}><span>I have read and accept the <b>MIT license</b>.</span></label>`,
      next: { t: 'Accept and continue', ok: S.c.terms } };
  },
  type() {
    const e = det()?.existing, o = (v, dis, inner) => `<button class="opt" role="radio" data-type="${v}" aria-checked="${S.c.type === v}" ${dis ? 'aria-disabled="true"' : ''}><span class="tick">${ic('check')}</span>${inner}</button>`;
    return { h: `<div class="eyebrow">${eb()}</div><h1>How should NEXUS be set up?</h1><p class="lead">Setup looked for an earlier NEXUS on this PC (read-only).</p>
      <div class="opts" role="radiogroup">
      ${o('adopt', !e, `${ic('link', 'big')}<b>Connect to my existing NEXUS</b>${e ? '<span class="badge">Recommended · found on this PC</span>' : '<span class="badge dim">No existing install found</span>'}
        <span>Keep the tracker, projects, vaults, Graphify, hooks, skills, plugins, automations and settings exactly where and as they are.</span>
        <ul><li>App files go to the program folder</li><li>Your data folder is used in place</li><li>Full backup before any change</li></ul>`)}
      ${o('new', !!e, `${ic('box', 'big')}<b>New install</b>${e ? '<span class="badge dim">Not offered: existing data found</span>' : '<span class="badge">Recommended</span>'}
        <span>Fresh, organized layout with the program and your personal data in separate folders.</span>
        <ul><li>Program: replaced by updates</li><li>Data: never touched by updates</li><li>Same features and protections</li></ul>`)}
      </div>`, next: { t: 'Next', ok: true } };
  },
  location() {
    const d = det(), a = S.c.type === 'adopt', need = 160e6 + depNeed(), free = d?.disk?.free || 0, bad = locErr();
    return { h: `<div class="eyebrow">${eb()}</div><h1>Install location</h1><p class="lead">Per-user folders, so Windows never asks for admin rights.</p>
      <div class="field"><label for="f-prog">Program folder</label><div class="path"><input id="f-prog" class="mono" value="${esc(S.c.prog)}" spellcheck="false"><button class="b sec" data-browse>${ic('folder')}Browse</button></div><span class="dim" style="font-size:12.5px">App files only. Replaced on update.</span></div>
      <div class="field"><label for="f-data">Personal data folder</label><div class="path"><input id="f-data" class="mono" value="${esc(a ? d.existing.dir : S.c.data)}" spellcheck="false" ${a ? 'readonly' : ''}>${a ? `<span class="badge" style="align-self:center">${ic('lock')}Kept in place</span>` : `<button class="b sec" data-browse>${ic('folder')}Browse</button>`}</div>
        <span class="dim" style="font-size:12.5px">${a ? 'Your existing NEXUS folder. Nothing in it is moved, renamed or recreated.' : 'Projects, settings, history and caches. Never in the program folder, never in a build.'}</span></div>
      ${bad ? `<div class="note err">${ic('alert')}<div>${esc(bad)}</div></div>` : ''}
      <div class="feat fmap"><div class="card">${ic('box')}<b>Program</b><span>App files only. Updates replace this folder and nothing else.</span></div>
      <div class="card">${ic(a ? 'lock' : 'folder')}<b>Personal data</b><span>${a ? 'Your existing folder, used in place.' : 'Projects, settings, history, caches.'} Updates never touch it.</span></div>
      <div class="card">${ic('shield')}<b>Backups</b>${pth(d?.paths?.backups || '')}<span>Made before every change.</span></div></div>
      <div class="space"><div style="display:flex;justify-content:space-between"><b>Disk space</b><span class="muted">${gb(need)} needed · ${gb(free)} free${d?.sim ? ' (simulated)' : ''}</span></div>
      <div class="bar"><i style="width:${Math.min(100, (1 - free / (d?.disk?.total || 1)) * 100).toFixed(1)}%"></i><i class="n" style="width:${Math.max(.6, need / (d?.disk?.total || 1) * 100).toFixed(2)}%"></i></div>
      <span class="dim">Includes the components selected on the next step (estimate).</span></div>`,
      next: { t: 'Next', ok: !bad } };
  },
  deps() {
    const d = det(); if (!d) return { h: '<div class="skel"></div>', next: { t: 'Next', ok: false } };
    const rows = d.deps.filter(x => !INTEG.includes(x.id)).map((x, i) => {
      const v = S.c.dep[x.id], seg = x.found ? `<span class="kept badge">${ic('check')}Installed${x.version ? ' · ' + esc(x.version) : ''}</span>`
        : `<div class="seg" role="radiogroup" aria-label="${esc(x.name)}">${[['auto', 'Install for me'], ['manual', 'I\'ll install it'], ['skip', 'Skip']].map(([k, t]) => `<button role="radio" data-dep="${x.id}" data-v="${k}" aria-checked="${v === k}" ${k === 'skip' && x.role === 'required' ? 'disabled title="Required"' : ''}>${t}</button>`).join('')}</div>`;
      return `<div class="dep ${x.found ? '' : 'miss'}" style="--i:${i}" data-row="${x.id}"><span class="di">${ic(DI[x.id] || 'box')}</span>
        <div class="nm">${esc(x.name)} <span class="badge ${x.role === 'required' ? '' : 'dim'}">${x.role}</span>${x.found ? '' : '<span class="badge warn">Not found</span>'}</div>${seg}
        <div class="meta">${x.found ? `Found${x.note ? ' · ' + esc(x.note) : ''} · kept as is` : `Source <b>${esc(x.src)}</b> · check <b>${esc(x.check)}</b>`} · <button class="why" data-why="${x.id}">Details</button></div>
        <div class="more">${esc(WHY[x.id] || '')}${!x.found && v === 'manual' ? `<br><b>Manual:</b> Setup opens the official page (${esc(x.src)}); install it, then press Re-scan.` : ''}${x.needs && !x.found ? '<br>Needs uv; selecting it also selects uv.' : ''}</div></div>`;
    }).join('');
    const miss = d.deps.filter(x => !x.found && !INTEG.includes(x.id)).length;
    return { h: `<div class="eyebrow">${eb()}</div><h1>Components</h1><p class="lead">${miss ? `${miss} component${miss === 1 ? '' : 's'} not found. Choose how each is installed; nothing downloads before you confirm on Review.` : 'Everything NEXUS uses is already installed. Nothing will be downloaded.'}</p>
      ${d.sim ? `<div class="note info">${ic('info')}<div>Simulated clean PC. On this PC the same list shows real, read-only results.</div></div>` : `<div class="note">${ic('shield')}<div>Read-only scan of this PC: version checks and file lookups only.</div></div>`}
      <div class="deps">${rows}</div>
      <div class="loghd"><span>Optional integrations (Obsidian, Graphify) have their own steps next. Shells found: ${esc(d.shells.join(' · '))}</span><button class="pv-btn" data-rescan>${ic('refresh')} Re-scan</button></div>`, next: { t: 'Next', ok: true } };
  },
  claude() {
    const e = det()?.existing, a = S.c.type === 'adopt';
    if (a) return { h: `<div class="eyebrow">${eb()}</div><h1>Claude Code integration</h1><p class="lead">NEXUS reads token usage through Claude Code hooks.</p>
      <div class="note">${ic('check')}<div><b>${e.hooks} NEXUS hook${e.hooks === 1 ? '' : 's'} already in your Claude Code settings.</b> They stay exactly as they are. Setup makes no change to settings.json, skills, plugins or credentials.</div></div>
      <div class="feat"><div class="card">${ic('lock')}<b>settings.json</b><span>Read to count NEXUS hooks. Never rewritten.</span></div>
      <div class="card">${ic('box')}<b>Skills + plugins</b><span>Not opened, moved or changed.</span></div>
      <div class="card">${ic('shield')}<b>Credentials</b><span>Never read, copied or sent anywhere.</span></div></div>
      <h3>Proposed change · ~/.claude/settings.json</h3><div class="diff">  (no change: the ${e.hooks} existing NEXUS hook${e.hooks === 1 ? '' : 's'} already point at your tracker)</div>`, next: { t: 'Next', ok: true } };
    const lines = HOOKS.map(h => `<span class="a">+ "${h}": [{ "hooks": [{ "type": "command", "command": "node \\"%LOCALAPPDATA%/Programs/NEXUS/tracker/tracker.js\\" ${h === 'SessionStart' ? 'boot' : h === 'UserPromptSubmit' ? 'hook' : 'snap'}" }] }]</span>`).join('');
    const o = (v, inner) => `<button class="opt" role="radio" data-hooks="${v}" aria-checked="${S.c.hooks === v}"><span class="tick">${ic('check')}</span>${inner}</button>`;
    return { h: `<div class="eyebrow">${eb()}</div><h1>Claude Code integration</h1><p class="lead">NEXUS can add hooks to Claude Code so it sees token usage live. Your other settings are never changed.</p>
      <div class="opts" role="radiogroup">${o('add', `${ic('link', 'big')}<b>Add NEXUS hooks</b><span class="badge">Recommended</span><span>${HOOKS.length} entries added. settings.json is backed up first; uninstall removes only these.</span>`)}
      ${o('skip', `${ic('x', 'big')}<b>Don't add hooks</b><span>Token tracking stays off. You can add them later in Settings.</span>`)}</div>
      ${S.c.hooks === 'add' ? `<h3>Proposed change · ~/.claude/settings.json</h3><div class="diff">  "hooks": {\n${lines}  }</div>` : ''}`, next: { t: 'Next', ok: true } };
  },
  obsidian() {
    const d = det(), o = S.c.obs, x = dep('obsidian'), use = o.mode === 'use', vs = vlist(), P = projs(), nv = newVaults(), ce = createErr(), n = o.kept.length + nv.length;
    const opt = (v, i, b, s) => `<button class="opt" role="radio" data-obs="${v}" aria-checked="${o.mode === v}"><span class="tick">${ic('check')}</span>${ic(i, 'big')}<b>${b}</b><span>${s}</span></button>`;
    const app = x.found ? `<div class="dep"><span class="di">${ic('gem')}</span><div class="nm">Obsidian <span class="badge dim">optional integration</span></div><span class="kept badge">${ic('check')}Installed${x.version ? ' · ' + esc(x.version) : ''}</span>
        <div class="meta">${vs.filter(v => v.reg).length} registered vault${vs.filter(v => v.reg).length === 1 ? '' : 's'} found (read-only)${d.sim ? ' · simulated' : ''} · app, settings and plugins kept as is</div></div>`
      : `<div class="dep miss"><span class="di">${ic('gem')}</span><div class="nm">Obsidian <span class="badge dim">optional integration</span><span class="badge warn">Not found</span></div>
        <div class="seg" role="radiogroup" aria-label="Obsidian">${[['auto', 'Install for me'], ['manual', 'I\'ll install it']].map(([k, t]) => `<button role="radio" data-dep="obsidian" data-v="${k}" aria-checked="${S.c.dep.obsidian === k}">${t}</button>`).join('')}</div>
        <div class="meta">Source <b>${esc(x.src)}</b> · check <b>${esc(x.check)}</b> · downloaded only after you agree on Review</div></div>`;
    const chk = v => v.sim ? `<span class="ck">${ic('info')}not checked in the preview; the real Setup checks the folder and .obsidian first</span>`
      : [['folder exists', v.exists], ['.obsidian found', v.dot], ['registered in Obsidian', v.reg]].map(([t, g]) => `<span class="ck ${g ? 'ok' : 'no'}">${ic(g ? 'check' : 'x')}${t}</span>`).join('');
    const row = v => { const k = o.kept.includes(v.path), bad = !v.sim && !(v.exists && v.dot), on = !!o.sel[v.path] && !bad;
      return `<div class="vrow ${on ? 'on' : ''} ${bad ? 'bad' : ''}"><input type="checkbox" data-vault="${esc(v.path)}" aria-label="Connect ${esc(v.name)}" ${on ? 'checked' : ''} ${bad || k ? 'disabled' : ''}>
        <div class="tx"><div class="vn"><b>${esc(v.name)}</b>${k ? '<span class="badge">Connected by your existing NEXUS · kept</span>' : ''}${bad ? `<span class="badge err">${v.exists ? 'Not a vault: no .obsidian folder' : 'Folder not found'}</span>` : ''}${v.plugins ? `<span class="dim">${v.plugins} plugin${v.plugins === 1 ? '' : 's'}</span>` : ''}</div>${pth(v.path)}<div class="cks">${chk(v)}</div></div>
        ${on && P.length ? (k ? `<span class="dim use">Used for ${esc(o.use[v.path] || 'all projects')}</span>` : `<select data-use="${esc(v.path)}" aria-label="Project for ${esc(v.name)}"><option value="">All projects</option>${P.map(p => `<option ${o.use[v.path] === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`) : ''}</div>` };
    const er = m => m ? `<div class="note err" style="margin:6px 0 0">${ic('alert')}<div>${esc(m)}</div></div>` : '';
    return { h: `<div class="eyebrow">${eb()}</div><h1>Obsidian vaults</h1><p class="lead">NEXUS keeps project docs, decisions and memory as Markdown notes in an Obsidian vault and builds its knowledge graph from them. Optional: NEXUS works without it.</p>
      ${x.found ? '' : `<div class="note info">${ic('info')}<div><b>Obsidian is not installed.</b> It is a free note app (made by Obsidian, not NEXUS) that keeps every note as a plain file on this PC. Setup can install it from the official source if you allow it, you can install it yourself, or skip it.</div></div>`}
      <div class="opts" role="radiogroup">${opt('use', 'gem', x.found ? 'Connect vaults' : 'Set up Obsidian', x.found ? 'You choose which vaults NEXUS may use. Nothing is selected for you.' : 'Install Obsidian, then create a vault or connect one.')}
      ${opt('skip', 'x', 'Skip for now', 'Vault features stay hidden. Set Obsidian up later in Settings › Integrations.')}</div>
      ${use ? `<h3>Obsidian app</h3>${app}
        <h3>Vaults ${d.sim ? '<span class="badge info">simulated</span>' : '<span class="badge dim">read-only scan</span>'}</h3>
        ${vs.length ? `<div class="vl">${vs.map(row).join('')}</div>` : `<div class="note">${ic('info')}<div>No vaults found on this PC. Create one below, or add a folder you already use.</div></div>`}
        <div class="field" style="margin-top:12px"><label for="f-vault">Browse for a different vault</label><div class="path"><input id="f-vault" class="mono" value="${esc(o.bpath)}" placeholder="${esc(U)}Documents\\My Vault" spellcheck="false"><button class="b sec" data-vadd>${ic('folder')}Add vault</button></div>${er(o.berr)}</div>
        <div class="tg"><b>Create a new vault</b><span>An empty folder with a starter note. Never inside another vault.</span><button class="sw" role="switch" data-obscreate aria-checked="${o.create}" aria-label="Create a new vault"></button></div>
        ${o.create ? `<div class="field"><label for="f-cpath">New vault folder</label><div class="path"><input id="f-cpath" class="mono" value="${esc(o.cpath)}" spellcheck="false"><button class="b sec" data-browse>${ic('folder')}Browse</button></div>${er(ce)}</div>` : ''}
        ${vs.length ? `<div class="note">${ic('lock')}<div><b>Your vaults stay exactly as they are.</b> Notes, attachments, plugins and settings are never changed, moved, merged or deleted. NEXUS keeps its links in its own data folder, not in the vault.</div></div>` : ''}
        ${nv.length ? `<div class="confirm"><h3>Confirm before connecting</h3><ul class="rv">${nv.map(v => li(v.create ? 'dl' : '', v.create ? 'folder' : 'gem', v.create ? `<b>Create</b> ${esc(v.name)}` : `<b>Connect</b> ${esc(v.name)} · used for ${esc(o.use[v.path] || 'all projects')}`, v.path, v.create ? 'new' : v.sim ? 'not checked' : 'verified')).join('')}</ul>
          <label class="consent"><input type="checkbox" data-obsok ${o.ok ? 'checked' : ''}><span>${nv.length === 1 ? 'This is the right folder' : 'These are the right folders'}. NEXUS may read ${nv.length === 1 ? 'it' : 'them'} and writes nothing into a vault without asking first.</span></label></div>` : ''}` : ''}`,
      next: { t: 'Next', ok: !use || (n > 0 && !ce && (!nv.length || o.ok) && (x.found || S.c.dep.obsidian !== 'skip')) },
      hint: use && !n ? 'Select or create a vault, or choose Skip' : use && nv.length && !o.ok ? 'Confirm the vault paths to continue' : '' };
  },
  graphify() {
    const d = det(), g = S.c.gfy, on = g.mode === 'graphify', x = dep('graphify'), u = dep('uv'), py = dep('python'), src = gsrc(), k = src.filter(s => g.scope[s.path]).length, P = projs().filter(p => p.graph).length;
    const other = (d.vaults || []).filter(v => !src.some(s => norm(s.path) === norm(v.path))).length;
    const opt = (v, i, b, s) => `<button class="opt" role="radio" data-gmode="${v}" aria-checked="${g.mode === v}"><span class="tick">${ic('check')}</span>${ic(i, 'big')}<b>${b}</b><span>${s}</span></button>`;
    const seg = id => `<div class="seg" role="radiogroup" aria-label="${id}">${[['auto', 'Install for me'], ['manual', 'I\'ll install it']].map(([v, t]) => `<button role="radio" data-dep="${id}" data-v="${v}" aria-checked="${S.c.dep[id] === v}">${t}</button>`).join('')}</div>`;
    const st = (y, i, tag, miss, soft) => `<div class="dep ${y.found || soft ? '' : 'miss'}"><span class="di">${ic(i)}</span><div class="nm">${esc(y.name)} ${tag}${y.found ? '' : `<span class="badge ${soft ? 'dim' : 'warn'}">Not found</span>`}</div>
      ${y.found ? `<span class="kept badge">${ic('check')}Installed${y.version ? ' · ' + esc(y.version) : ''}</span>` : miss}<div class="meta">${y.found ? `Found${y.note ? ' · ' + esc(y.note) : ''} · kept as is` : soft ? 'Not needed separately: uv brings its own Python for Graphify' : `Source <b>${esc(y.src)}</b> · check <b>${esc(y.check)}</b>`}</div></div>`;
    const srow = s => `<div class="tg"><b>${esc(s.name)} <span class="badge dim">${esc(s.kind)}</span>${s.graph ? '<span class="badge">existing graph · reused</span>' : ''}</b>${pth(s.path)}<button class="sw" role="switch" data-gscope="${esc(s.path)}" aria-checked="${!!g.scope[s.path]}" aria-label="Graphify reads ${esc(s.name)}"></button></div>`;
    return { h: `<div class="eyebrow">${eb()}</div><h1>Knowledge graph</h1><p class="lead">NEXUS maps how your notes and code connect. Graphify, a third-party tool, builds a richer graph; the built-in graph needs no extra software.</p>
      ${x.found ? `<div class="note">${ic('check')}<div><b>Existing Graphify found${d.graphifySkill ? ' (plus its Claude Code skill)' : ''}.</b> Reused exactly as it is: nothing is reinstalled, updated or rebuilt.${P ? ` ${P} folder${P === 1 ? '' : 's'} already ha${P === 1 ? 's' : 've'} a Graphify graph and start${P === 1 ? 's' : ''} switched on.` : ''}</div></div>` : ''}
      <div class="opts" role="radiogroup">${opt('graphify', 'graph', 'Use Graphify', x.found ? 'Your existing install, on the folders you allow.' : 'Install uv + Graphify, then choose the folders it may read.')}
      ${opt('builtin', 'node', 'Built-in graph', 'No extra software. Works for every connected project.')}</div>
      ${on ? `<h3>Components <span class="badge dim">read-only scan${d.sim ? ' · simulated' : ''}</span></h3><div class="deps">${st(x, 'graph', '<span class="badge info">third-party tool</span>', seg('graphify'))}${st(u, 'bolt', '<span class="badge dim">runs Graphify</span>', seg('uv'))}${st(py, 'box', '<span class="badge dim">used by Graphify</span>', '', 1)}</div>
        <h3>Folders Graphify may read</h3>
        ${src.length ? src.map(srow).join('') : `<div class="note">${ic('info')}<div>No vaults or projects connected yet. Add a folder below, or use the built-in graph.</div></div>`}
        <div class="field" style="margin-top:6px"><label for="f-gdir">Add a folder</label><div class="path"><input id="f-gdir" class="mono" value="${esc(g.fpath)}" placeholder="${esc(U)}Documents\\My Project" spellcheck="false"><button class="b sec" data-gadd>${ic('folder')}Add</button></div>${g.ferr ? `<div class="note err" style="margin:6px 0 0">${ic('alert')}<div>${esc(g.ferr)}</div></div>` : ''}</div>
        <div class="note info">${ic('lock')}<div><b>Graphify reads only the folders switched on here.</b> Other vaults, projects and personal files are never passed to it${other ? ` (${other} vault${other === 1 ? '' : 's'} you did not connect ${other === 1 ? 'is' : 'are'} not even listed)` : ''}. If Graphify fails or is removed, NEXUS switches to the built-in graph and keeps your data.</div></div>`
      : x.found ? `<div class="note warn">${ic('info')}<div><b>Graphify stays installed.</b> Its skill and graph files are kept, not deleted; NEXUS just doesn't run it. Switch it on later in Settings › Integrations.</div></div>`
      : `<div class="note">${ic('info')}<div>NEXUS uses its built-in graph. Add Graphify later in Settings › Integrations.</div></div>`}`,
      next: { t: 'Next', ok: !on || (k > 0 && (x.found || ['auto', 'manual'].includes(S.c.dep.graphify))) }, hint: on && !k ? 'Switch on at least one folder, or use the built-in graph' : '' };
  },
  skills() {
    const n = SKILLS.filter(s => S.c.skills[s.id]).length;
    return { h: `<div class="eyebrow">${eb()}</div><h1>Recommended skills</h1><p class="lead">Claude Code skills that make NEXUS and Claude work better. All are <b>highly recommended</b> and on by default: switch off any you don't want.</p>
      ${SKILLS.map(s => `<div class="tg"><b>${s.name} <span class="badge">Recommended</span></b><span>${s.d}</span><button class="sw" role="switch" data-skill="${s.id}" aria-checked="${!!S.c.skills[s.id]}" aria-label="Install ${s.name}"></button></div>`).join('')}
      <div class="note info">${ic('info')}<div><b>${n} of ${SKILLS.length} will be installed.</b> Skills you already have are kept as they are. Add or remove skills later in Settings › Integrations.</div></div>`,
      next: { t: 'Next', ok: true } };
  },
  options() {
    const d = det(), t = (k, b, s) => `<div class="tg"><b>${b}</b><span>${s}</span><button class="sw" role="switch" data-opt="${k}" aria-checked="${!!S.c[k]}" aria-label="${b}"></button></div>`;
    return { h: `<div class="eyebrow">${eb()}</div><h1>Options</h1><p class="lead">All of these can be changed later in NEXUS Settings.</p>
      <div class="grid2"><div>${t('desk', 'Desktop shortcut', 'NEXUS icon on the desktop')}${t('start', 'Start menu entry', 'Search “NEXUS” from Start')}${t('boot', 'Start with Windows', 'Off by default; opens to the tray')}</div>
      <div><div class="tg"><b>Close button</b><span>Tray keeps NEXUS running in the background</span><select data-sel="close"><option value="tray" ${S.c.close === 'tray' ? 'selected' : ''}>Minimize to tray</option><option value="quit" ${S.c.close === 'quit' ? 'selected' : ''}>Quit the app</option></select></div>
      <div class="tg"><b>Default terminal shell</b><span>${d.shells.length} shell${d.shells.length === 1 ? '' : 's'} found on this PC${d.sim ? ' (simulated)' : ''}</span><select data-sel="shell">${d.shells.map(s => `<option ${s === S.c.shell ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      ${t('launch', 'Open NEXUS when finished', 'Launches the desktop app after Setup')}</div></div>
      <div class="note info">${ic('lock')}<div>Quitting NEXUS never stops the tracker or your Claude Code hooks.</div></div>`, next: { t: 'Next', ok: true } };
  },
  review() {
    const d = det(), ig = integ(), a = S.c.type === 'adopt' || ig && adopt(), want = x => !x.found && (!ig || INTEG.includes(x.id)), auto = d.deps.filter(x => want(x) && S.c.dep[x.id] === 'auto'), man = d.deps.filter(x => want(x) && S.c.dep[x.id] === 'manual');
    const o = S.c.obs, g = S.c.gfy, nv = newVaults(), src = gsrc().filter(s => g.scope[s.path]);
    const keep = [...man.map(x => li('keep', 'info', `<b>You install ${esc(x.name)}</b> yourself`, '', esc(x.src))),
      ...(o.mode === 'use' ? o.kept.map(p => li('keep', 'lock', '<b>Vault kept as connected</b> · nothing in it changes', p)) : []),
      ...(a && !ig ? [li('keep', 'lock', `<b>Kept exactly as is:</b> projects, Obsidian vaults, Graphify, ${d.existing.hooks} hooks, skills, plugins, automations, settings`)] : [])];
    const irows = (o.mode === 'use' ? nv.map(v => v.create ? li('', 'folder', `<b>Create vault ${esc(v.name)}</b> · empty folder + starter note`, v.path, 'new')
      : li('', 'gem', `<b>Connect vault ${esc(v.name)}</b> · used for ${esc(o.use[v.path] || 'all projects')}`, v.path, v.sim ? 'not checked' : 'verified')).join('') : li('keep', 'gem', '<b>Obsidian skipped</b> · set it up later in Settings'))
      + (g.mode === 'graphify' ? li('', 'graph', `<b>Let Graphify read ${src.length} folder${src.length === 1 ? '' : 's'}</b> · ${esc(src.map(s => s.name).join(', '))}`, '', 'third party') : li('keep', 'graph', '<b>Use the built-in knowledge graph</b> · Graphify not run'));
    const dl = auto.map(x => li('dl', 'download', `<b>Download + install ${esc(x.name)}</b> · ${esc(x.check)}`, '', esc(x.src))).join('');
    const consent = auto.length ? `<label class="consent"><input type="checkbox" data-consent ${S.c.consent ? 'checked' : ''}><span>I agree to download and install <b>${auto.map(x => esc(x.name)).join(', ')}</b> from the official sources above. Each file is checked before it runs; a failed check stops that install.${auto.some(x => x.id === 'graphify') ? ' Graphify is a third-party tool, not made by NEXUS.' : ''}</span></label>` : '';
    if (ig) return { h: `<div class="eyebrow">${eb()}</div><h1>Ready to apply</h1><p class="lead">Exactly what Setup will do, in order. Nothing has happened yet.</p>
      <h3>Setup will</h3><ol class="rv num">${li('', 'shield', '<b>Back up</b> NEXUS settings', `${U}NEXUS Backups\\${STAMP}`)}${dl}${irows}${li('', 'shield', '<b>Save</b> integration settings in NEXUS data')}</ol>
      ${keep.length ? `<h3>Not done by Setup</h3><ul class="rv">${keep.join('')}</ul>` : ''}<h3>Privacy summary</h3>${privacy(auto)}${consent}`,
      next: { t: 'Apply', ic: 'check', ok: !auto.length || S.c.consent }, hint: 'Preview: Apply runs a simulation only' };
    return { h: `<div class="eyebrow">${eb()}</div><h1>Ready to install</h1><p class="lead">Exactly what Setup will do, in order. Nothing has happened yet.</p>
      <h3>Setup will</h3><ol class="rv num">
      ${a ? li('', 'shield', '<b>Back up</b> your existing NEXUS code and data', `%USERPROFILE%\\NEXUS Backups\\${STAMP}`) : ''}
      ${dl}
      ${li('', 'box', `<b>Install NEXUS ${VER}</b> app files`, S.c.prog)}
      ${li('', a ? 'link' : 'folder', a ? '<b>Use your existing data folder</b> in place, nothing moved' : '<b>Create your personal data folder</b>', a ? d.existing.dir : S.c.data)}
      ${irows}
      ${(sk => sk.length ? li('', 'bolt', `<b>Install ${sk.length} Claude Code skill${sk.length === 1 ? '' : 's'}</b> · ${sk.map(s => s.name).join(', ')}`, '~/.claude/skills') : li('keep', 'bolt', '<b>No skills installed</b> · add them later in Settings'))(SKILLS.filter(s => S.c.skills[s.id]))}
      ${!a && S.c.hooks === 'add' ? li('', 'link', `<b>Add ${HOOKS.length} Claude Code hooks</b> after backing up settings.json`, '~/.claude/settings.json') : ''}
      ${S.c.desk || S.c.start ? li('', 'window', `<b>Create shortcuts:</b> ${[S.c.desk && 'desktop', S.c.start && 'Start menu'].filter(Boolean).join(' + ')}`) : ''}
      ${S.c.boot ? li('', 'play', '<b>Start with Windows</b>', '', 'per-user entry') : ''}
      ${li('', 'shield', '<b>Write the install manifest</b>: uninstall can only remove what it lists')}
      </ol>
      ${keep.length ? `<h3>Not done by Setup</h3><ul class="rv">${keep.join('')}</ul>` : ''}
      <h3>Privacy summary</h3>${privacy(auto)}${consent}`,
      next: { t: 'Install', ic: 'download', ok: !auto.length || S.c.consent }, hint: 'Preview: Install runs a simulation only' };
  },
  mwelcome() {
    const d = det(), e = d?.existing, o = (v, i, b, s, badge = '') => `<button class="opt" role="radio" data-act="${v}" aria-checked="${S.c.act === v}"><span class="tick">${ic('check')}</span>${ic(i, 'big')}<b>${b}</b>${badge}<span>${s}</span></button>`;
    return { h: `<div class="hero" style="padding-top:0">${LOGO("m")}<div><div class="eyebrow">NEXUS Setup · ${NEWVER}</div><h1>NEXUS is already installed</h1>
      <p class="lead" style="margin:0">Installed <b>${VER}</b> · ${adopt() ? `connected to your existing data (${esc(e?.dir || '')})` : 'new layout'} · this Setup is <b>${NEWVER}</b>.</p></div></div>
      ${d?.sim ? `<div class="note info">${ic('info')}<div>Simulated new-layout install (data created by Setup).</div></div>` : ''}
      <div class="opts three" role="radiogroup" style="margin-top:12px">
      ${o('update', 'up', `Update to ${NEWVER}`, 'Replace app files only. Every project, setting, vault and integration is kept.', '<span class="badge">Recommended</span>')}
      ${o('repair', 'wrench', 'Repair', 'Check app files, shortcuts and records against the manifest and fix what is missing. Data untouched.')}
      ${o('uninstall', 'trash', 'Uninstall', 'Remove NEXUS app files, shortcuts and records. Your data is kept by default.')}</div>
      <div class="loghd"><span>Backups live in %USERPROFILE%\\NEXUS Backups</span><span class="row2"><button class="pv-btn" data-act-integ>${ic('gem')} Obsidian + Graphify</button><button class="pv-btn" data-act-restore>${ic('undo')} Restore from a backup</button></span></div>`,
      next: { t: 'Continue', ok: true } };
  },
  mupdate() {
    return { h: `<div class="eyebrow">Update</div><h1>Update to <em>${NEWVER}</em></h1><p class="lead">Only program files change. A backup is made first and restored automatically if anything fails.</p>
      <div class="cols"><div class="card"><b>What's new</b><span class="dim">(sample notes; real notes come from the signed update)</span><ul class="muted" style="font-size:13px;padding-left:18px"><li>Faster graph rebuilds</li><li>New terminal themes</li><li>Fixes and security updates</li></ul></div>
      <div class="card"><b>Kept as is</b><ul class="muted" style="font-size:13px;padding-left:18px"><li>Projects, settings, history</li><li>Obsidian vaults + Graphify</li><li>Claude Code hooks, skills, plugins</li><li>Automations + credentials</li></ul></div></div>
      <div class="note info" style="margin-top:14px">${ic('shield')}<div>The update package's signature is checked against the NEXUS public key before anything is replaced. The NEXUS window closes during the update; the tracker keeps running.</div></div>`,
      next: { t: 'Update now', ic: 'up', ok: true } };
  },
  mrepair() {
    return { h: `<div class="eyebrow">Repair</div><h1>Repair NEXUS</h1><p class="lead">Setup compares what is on disk with the install manifest and restores what is missing or damaged. Your data is not touched.</p>
      <ul class="rv">
      ${li('', 'check', '<b>Program files</b> · checked against manifest hashes', S.c.prog)}
      ${li('', 'check', '<b>Shortcuts</b> · desktop, Start menu')}
      ${li('', 'check', '<b>Uninstall record</b> · Apps &amp; features entry')}
      ${li('keep', 'lock', '<b>Claude Code hooks</b> · checked only, never rewritten without asking')}
      ${li('keep', 'lock', '<b>Personal data</b> · not scanned, not changed')}</ul>
      <div class="note warn" style="margin-top:14px">${ic('info')}<div>Preview sample finding: <b>Start menu shortcut missing</b>; Repair recreates it.</div></div>`,
      next: { t: 'Repair', ic: 'wrench', ok: true } };
  },
  muninst() {
    const d = det(), a = adopt(), dataN = [['Settings + preferences', '0.2 MB'], ['Projects registry + covers', '6.4 MB'], ['Token history + reports', '31.8 MB'], ['Caches (graph, inventory)', '12.1 MB'], ['Logs', '1.3 MB']];
    const hooksDiff = HOOKS.map(h => `<span class="d">- "${h}": [ … NEXUS tracker.js … ]</span>`).join('');
    return { h: `<div class="eyebrow">Uninstall</div><h1>Uninstall NEXUS</h1><p class="lead">Only what Setup installed (listed in its manifest) is removed. Everything else is out of reach.</p>
      <div class="cols"><div><h3>Removed</h3><ul class="rv">
        ${li('del', 'trash', '<b>App files</b>', S.c.prog)}
        ${li('del', 'trash', '<b>Shortcuts</b> · desktop, Start menu')}
        ${li('del', 'trash', '<b>Startup entry</b> (if on) + uninstall record')}</ul></div>
      <div><h3>Kept</h3><ul class="rv">
        ${li('keep', 'lock', '<b>Your data folder</b>', a ? d?.existing?.dir : S.c.data)}
        ${li('keep', 'lock', '<b>Obsidian vaults, Roblox projects, skills, plugins, credentials</b> · never deleted')}
        ${a ? `${li('keep', 'lock', `<b>${d?.existing?.hooks ?? 0} Claude Code hooks</b> · existed before Setup, not removed`)}` : ''}</ul></div></div>
      ${a ? `<div class="note" style="margin-top:14px">${ic('shield')}<div><b>No data deletion offered.</b> This data existed before Setup, so it is marked external in the manifest and can never be listed for deletion. The tracker and the browser dashboard keep working after uninstall.</div></div>`
        : `<div class="tg" style="margin-top:14px"><b>Remove the ${HOOKS.length} hooks NEXUS added to Claude Code</b><span>settings.json is backed up first; only exact NEXUS entries are removed.</span><button class="sw" role="switch" data-opt="rmHooks" aria-checked="${S.c.rmHooks}" aria-label="Remove NEXUS hooks"></button></div>
        ${S.c.rmHooks ? `<div class="diff">~/.claude/settings.json\n${hooksDiff}</div>` : ''}
        <div class="dz"><label class="chk"><input type="checkbox" data-deldata ${S.c.delData ? 'checked' : ''}><span>Also delete NEXUS-owned app data <span class="dim" style="font-weight:600">(off by default)</span></span></label>
        ${S.c.delData ? `<ul class="rv" style="margin:10px 0 0">${dataN.map(([n, s]) => li('del', 'trash', n, '', s + ' · simulated')).join('')}</ul>
          <p class="muted" style="font-size:13px;margin:10px 0 0">Created by NEXUS in ${esc(S.c.data)} (sizes simulated). A zip backup goes to %USERPROFILE%\\NEXUS Backups\\${STAMP} first; restore it from Setup anytime.</p>
          <label class="muted" style="display:block;margin-top:10px;font-size:13px">Type <b class="mono" style="color:var(--error)">DELETE</b> to confirm<br><input class="typed" data-typed value="${esc(S.c.typed)}" autocomplete="off" spellcheck="false" aria-label="Type DELETE to confirm"></label>` : ''}</div>`}`,
      next: { t: 'Uninstall', ic: 'trash', dan: true, ok: !S.c.delData || S.c.typed === 'DELETE' } };
  },
  mrestore() {
    const bks = adopt() ? [['2026-10-15 09:12', 'Before update to 1.0.0', '412 MB']] : [['2026-10-15 14:02', 'Before data delete', '52 MB'], ['2026-10-12 18:40', 'Before update to 1.0.0', '49 MB']];
    return { h: `<div class="eyebrow">Restore</div><h1>Restore from a backup</h1><p class="lead">Your current data is backed up first, so a restore can be undone too. (Backups below are simulated.)</p>
      <div class="opts" role="radiogroup">${bks.map((b, i) => `<button class="opt" role="radio" data-bk="${i}" aria-checked="${S.c.bk === i}"><span class="tick">${ic('check')}</span>${ic('undo', 'big')}<b>${b[0]}</b><span>${b[1]} · ${b[2]}</span></button>`).join('')}</div>`,
      next: { t: 'Restore', ic: 'undo', ok: true } };
  },
  progress() {
    const p = S.prog, act = maint() ? S.c.act : 'install', C = 2 * Math.PI * 76, k = pk(p), bad = p?.err && !p.rb, fi = p ? p.done : 0, ft = p?.tasks[fi];
    const nb = p?.back || 0, undo = p?.tasks.filter(t => t.s === 'rb' && !t.real).length || 0;
    const STL = { run: p?.rb ? 'undoing' : 'running', ok: 'done', bad: 'failed', rb: 'undone', skip: 'not run' };
    return { h: `<div class="eyebrow">${p?.rb ? 'Rolling back' : esc(PLBL[act] || 'Installing')} · simulation</div><h1>${bad ? 'Something went wrong' : p?.rb ? (S.c.rolled ? 'Rollback complete' : 'Undoing changes') : act === 'install' ? 'Installing <em>NEXUS</em>' : esc(PLBL[act]) + ' <em>NEXUS</em>'}</h1>
      ${bad ? `<div class="note err">${ic('alert')}<div><b>Step ${fi + 1} of ${p.tasks.length} failed: ${esc(ft.t)}</b><br>${esc(p.err)}. ${fi} completed step${fi === 1 ? ' is' : 's are'} intact; nothing from this step was kept.<br><b>Retry</b> runs this step again. <b>Roll back</b> undoes the ${fi} completed step${fi === 1 ? '' : 's'}, newest first.</div></div>`
        : p?.rb ? `<div class="note warn">${ic('undo')}<div><b>${undo} of ${nb} completed step${nb === 1 ? '' : 's'} undone</b>, newest first. The failed step kept nothing; later steps never started.</div></div>`
        : '<p class="lead">Each step is checked before the next starts. Here every <b>SIM</b> step is only a timer, so nothing is written.</p>'}
      <div class="prog"><div class="ring ${bad ? 'err' : p?.rb ? 'rb' : ''}"><svg viewBox="0 0 170 170"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#B794FF"/><stop offset="1" stop-color="#8F5BFF"/></linearGradient></defs>
        <circle class="bg" cx="85" cy="85" r="76"/><circle class="fg" cx="85" cy="85" r="76" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - k.v)}"/></svg><div class="pc"><b>${Math.round(k.v * 100)}%</b><span>${k.l}</span></div></div>
      <div><div class="legend"><span class="kind">SIM</span>simulated, nothing written<span class="kind real">REAL</span>read-only check on this PC</div>
      <ul class="tasks">${(p?.tasks || []).map(t => `<li class="${t.s || 'wait'}${t.warn ? ' warn' : ''}"><span class="st">${t.s === 'ok' ? ic('check') : t.s === 'rb' ? ic('undo') : t.s === 'bad' ? ic('x') : ''}</span><span class="tn">${esc(t.t)}${t.sub ? `<small>${esc(t.sub)}</small>` : ''}</span><span class="kind ${t.real ? 'real' : ''}">${t.real ? 'REAL' : 'SIM'}</span><span class="state">${t.warn && t.s === 'ok' ? 'fallback' : STL[t.s] || 'waiting'}</span></li>`).join('')}</ul>
      <div class="loghd"><span>Log</span><span>preview: kept in this page only, never saved</span></div><div class="log" id="log">${(p?.log || []).join('<br>')}</div></div></div>`,
      next: bad ? { t: 'Retry', ic: 'refresh', ok: true, fn: retry } : { t: 'Next', ok: false }, alt: bad ? { t: 'Roll back', ic: 'undo', fn: rollback } : null, back: false, cancel: false,
      hint: 'Simulation · nothing on this PC is changed' };
  },
  done() {
    const p = S.prog, act = maint() ? S.c.act : 'install', rb = S.c.rolled, ts = p?.tasks || [];
    const sim = ts.filter(t => !t.real && ['ok', 'rb', 'bad'].includes(t.s)).length, real = ts.filter(t => t.real && ['ok', 'rb'].includes(t.s)).length, und = ts.filter(t => !t.real && t.s === 'rb').length;
    const NAME = { install: 'Install', update: 'Update', repair: 'Repair', uninstall: 'Uninstall', restore: 'Restore', integ: 'Integration setup' }[act];
    const T = rb ? 'your PC would be exactly as it was before Setup started: the backup restored and new files removed.' : {
      install: adopt() ? 'the desktop app would now be connected to your existing NEXUS, with nothing of yours moved or changed.' : 'NEXUS would now be installed, with program and personal data in separate folders.',
      update: `app files would now be ${NEWVER}, with every project, setting and integration kept and the pre-update backup in NEXUS Backups.`,
      repair: 'missing pieces would be restored from the manifest, with your data untouched.',
      uninstall: adopt() ? 'app files and shortcuts would be removed; your data folder, hooks and everything else kept, and the browser dashboard would still work.' : S.c.delData ? 'the app and NEXUS-owned data would be removed, with a backup kept in NEXUS Backups to restore from.' : 'app files would be removed and your data folder kept, so reinstalling picks it up again.',
      integ: 'your Obsidian and Graphify choices would be saved in NEXUS data, with every vault, note and Graphify file left exactly as it was.',
      restore: 'your data would be back to the selected backup, with the data from just before the restore saved too.' }[act];
    const stat = (v, b, s, c = '') => `<div class="stat ${c}"><b>${v}</b><span>${b}</span><small>${s}</small></div>`;
    const notes = [S.c.fallback && li('keep', 'graph', 'Real Setup: Graphify could not be installed, so NEXUS uses its built-in graph. Nothing was lost; retry from Settings › Integrations.'),
      !rb && (act === 'install' || act === 'integ') && li('keep', 'gem', 'Real Setup: Obsidian and Graphify can be added, changed or disconnected later in NEXUS Settings › Integrations.'),
      !rb && act === 'install' && li('keep', 'lock', 'Real Setup: automatic updates are off. Run a newer Setup to update.'),
      !rb && act === 'install' && det().deps.some(x => !x.found && S.c.dep[x.id] === 'manual') && li('keep', 'info', 'Real Setup: install the components you chose to install yourself; NEXUS shows them on Home until found.')].filter(Boolean);
    return { mid: true, h: `<div class="done"><div class="simtag">${ic('info')}Preview simulation · nothing was installed, changed or deleted</div>
      <span class="big ${rb ? 'warn' : ''}">${ic(rb ? 'undo' : 'check')}</span><h1>${NAME} ${rb ? 'rolled back' : 'simulation complete'}</h1><p class="lead">In the real Setup, ${esc(T)}</p>
      <div class="stats">${stat(sim, 'Simulated steps', rb ? `${und} undone · 1 failed` : 'timers only, nothing written')}${stat(real, 'Real actions', real ? 'read-only scan of this PC' : 'none: simulated PC', 'real')}${stat(0, 'Changes to this PC', 'the preview has no write calls', 'zero')}</div>
      ${notes.length ? `<ul class="rv sum">${notes.join('')}</ul>` : ''}</div>`,
      next: { t: 'Finish preview', ok: true, fn: () => toast(act === 'install' && !rb && S.c.launch ? 'Preview: the real Setup opens the NEXUS desktop app here.' : 'Preview: the real Setup closes here.') },
      alt: { t: 'Run again', ic: 'refresh', fn: () => { reset(); cur = null; render() } }, back: false, cancel: false };
  }
};
const WHY = {
  webview2: 'Renders the NEXUS window and this Setup. Part of Windows 11; never downloaded by Setup.',
  node: 'Runs the NEXUS tracker (token usage, projects, automations, system health). Required.',
  claude: 'The Claude Code CLI NEXUS monitors and launches. Installed with Anthropic\'s official script.',
  obsidian: 'Optional: open and sync project vaults. NEXUS works without it; vault features stay hidden.',
  uv: 'Optional: runs Python tools such as Graphify in their own isolated environment.',
  graphify: 'Optional: advanced knowledge graphs. Without it NEXUS uses its built-in graph.',
  git: 'Optional: Git Bash shell and repository status on project pages.'
};
const depNeed = () => (det()?.deps || []).filter(x => !x.found && S.c.dep[x.id] === 'auto').reduce((n, x) => n + ({ node: 90e6, claude: 220e6, obsidian: 330e6, uv: 40e6, graphify: 60e6, git: 360e6 }[x.id] || 0), 0);
const vname = p => p.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop();
const norm = s => s.trim().replace(/[\\/]+$/, '').toLowerCase();
const within = (a, b) => { a = norm(a); b = norm(b); return a === b || a.startsWith(b + '\\') };
// folders a vault or Graphify may never point at: whole drives, the whole profile, system + app folders, credential folders, the NEXUS program folder
function folderErr(p) {
  const l = norm(p);
  if (!/^([A-Za-z]:\\|%[A-Za-z]+%(\\|$))/.test(p.trim())) return 'Use a full folder path, such as %USERPROFILE%\\Documents\\My Vault.';
  if (/^[a-z]:$/.test(l) || l === '%userprofile%') return 'Choose a specific folder, not a whole drive or your entire user folder.';
  if (/^(%(appdata|localappdata|programfiles|programdata|windir|systemroot)%|[a-z]:\\(windows|program files|program files \(x86\)|programdata))(\\|$)/.test(l)) return 'System and app folders are off limits.';
  if (/\\(\.claude|\.ssh|\.aws|\.gnupg|\.config|appdata)(\\|$)/.test(l)) return 'That folder holds credentials or app settings, so NEXUS never connects it.';
  if (/[<>"|?*]/.test(p) || /:.*:/.test(p)) return 'Folder names cannot contain < > : " | ? *';
  if (S.c.prog && within(p, S.c.prog)) return 'That is inside the NEXUS program folder, which updates replace.';
  return '';
}
const vlist = () => [...(det()?.vaults || []), ...S.c.obs.extra];
function createErr() {
  const o = S.c.obs; if (!o.create) return '';
  const e = folderErr(o.cpath); if (e) return e;
  const v = vlist().find(v => within(o.cpath, v.path) || within(v.path, o.cpath)); if (!v) return '';
  return norm(v.path) === norm(o.cpath) ? `A vault already exists there (${v.name}). Setup never writes into an existing vault; connect it from the list instead.`
    : within(o.cpath, v.path) ? `That folder is inside the vault ${v.name}. Choose a folder outside it, so neither vault is changed.` : `That folder contains the vault ${v.name}. Choose an empty folder.`;
}
// vaults this run would newly connect or create (vaults the existing NEXUS already links are kept, not re-connected)
const newVaults = () => { const o = S.c.obs; if (o.mode !== 'use') return [];
  return [...vlist().filter(v => o.sel[v.path] && !o.kept.includes(v.path) && (v.sim || v.exists && v.dot)), ...(o.create && !createErr() ? [{ name: vname(o.cpath), path: o.cpath.trim(), create: true }] : [])] };
// what Graphify may be offered: only vaults connected on the Obsidian step, the user's projects, and folders added on its own step
function gsrc() {
  const o = S.c.obs, m = new Map(), put = (path, name, kind, graph) => { const k = norm(path), e = m.get(k); if (e) { e.kind += ' + ' + kind.toLowerCase(); e.graph ||= graph } else m.set(k, { path, name, kind, graph }) };
  if (o.mode === 'use') { for (const p of o.kept) put(p, vname(p), 'Vault'); for (const v of newVaults()) put(v.path, v.name, 'Vault') }
  for (const p of projs()) put(p.dir, p.name, 'Project', p.graph);
  for (const p of S.c.gfy.extra) put(p, vname(p), 'Folder');
  return [...m.values()];
}
function privacy(auto) {
  const o = S.c.obs, g = S.c.gfy, n = o.mode === 'use' ? o.kept.length + newVaults().length : 0, k = gsrc().filter(s => g.scope[s.path]).length, gon = g.mode === 'graphify';
  const r = (i, t, a, w, x, c) => `<div class="pr">${ic(i)}<b>${t}</b><span>${a}</span><span>${w}</span><span class="${c}">${x}</span></div>`;
  return `<div class="pvt"><div class="pr hd"><span></span><span>Part</span><span>Accesses</span><span>Stored in</span><span>External contact</span></div>
    ${r('lock', 'NEXUS', 'Token usage from Claude Code hooks; the projects you add', 'Your data folder, this Windows user only', 'None · 127.0.0.1 only', 'ok')}
    ${r('gem', 'Obsidian', n ? `${n} vault${n === 1 ? '' : 's'} you confirmed: reads notes, writes only with your OK` : 'Not used', n ? 'Vault links in NEXUS data; vault files unchanged' : '-', 'None by NEXUS', 'ok')}
    ${r('graph', 'Graphify<small>third party</small>', gon ? `${k} folder${k === 1 ? '' : 's'} you allowed, nothing else` : 'Not used', gon ? 'graphify-out inside each allowed folder' : 'Built-in graph in NEXUS data', 'None by NEXUS', 'ok')}
    ${r('download', 'Downloads', auto.length ? esc(auto.map(x => x.name).join(', ')) : 'None', auto.length ? 'Installed for this Windows user' : '-', auto.length ? 'During install only: ' + esc([...new Set(auto.map(x => x.src))].join(' · ')) : 'None', auto.length ? 'warn' : 'ok')}
    ${r('box', 'Desktop window<small>Microsoft WebView2</small>', 'Shows the NEXUS page from 127.0.0.1 only', 'WebView2 profile in %LOCALAPPDATA%, this Windows user only', 'Microsoft WebView2 runtime service (HTTPS, run by Windows, not NEXUS)', 'warn')}</div>
    <p class="dim pvn">NEXUS itself: no telemetry, no account, no uploads. Logs and backups stay on this PC and never contain credentials; other Windows users can't read your NEXUS data.</p>`;
}
function locErr() {
  const p = S.c.prog.trim(), d = S.c.type === 'adopt' ? '' : S.c.data.trim(), ok = s => /^([A-Za-z]:\\|%[A-Z]+%\\)/.test(s);
  if (!ok(p)) return 'Program folder must be a full path such as %LOCALAPPDATA%\\Programs\\NEXUS.';
  if (/\\(Program Files|Windows)(\\| \(x86\)|$)/i.test(p)) return 'That folder needs admin rights. Choose a folder in your user profile.';
  if (d && !ok(d)) return 'Data folder must be a full path.';
  if (d && (d.toLowerCase() === p.toLowerCase() || d.toLowerCase().startsWith(p.toLowerCase() + '\\'))) return 'Keep personal data outside the program folder, so updates can never touch it.';
  return '';
}

/* ---------------- progress simulation ---------------- */
function tasksFor() {
  const d = det(), a = adopt(), T = [], add = (t, sub, ms = 650, fail, soft) => T.push({ t, sub, ms, fail, soft });
  const act = maint() ? S.c.act : 'install';
  // optional installs; a failed Graphify install is not fatal: NEXUS falls back to its built-in graph
  const inst = () => { for (const x of d.deps.filter(x => !x.found && S.c.dep[x.id] === 'auto' && (act !== 'integ' || INTEG.includes(x.id)))) add('Install ' + x.name, x.check, 1400, null, x.id === 'graphify' && 'install failed (simulated) · built-in graph used, nothing lost') };
  const integT = () => { const o = S.c.obs, nv = newVaults(), c = nv.filter(v => !v.create).length, k = gsrc().filter(s => S.c.gfy.scope[s.path]).length;
    if (o.mode === 'use') { if (c) add('Verify ' + c + ' vault folder' + (c === 1 ? '' : 's'), 'exists · .obsidian · path confirmed', 500); if (nv.some(v => v.create)) add('Create vault ' + vname(o.cpath), 'empty folder + starter note', 500);
      add(nv.length ? 'Link ' + nv.length + ' vault' + (nv.length === 1 ? '' : 's') + ' in NEXUS data' : 'Obsidian vaults', nv.length ? 'vault files untouched' : 'kept as connected', 400) }
    if (S.c.gfy.mode === 'graphify') { add('Save Graphify access list', k + ' folder' + (k === 1 ? '' : 's') + ', nothing else', 400); T.at(-1).g = 1; add('Check Graphify', 'built-in graph as fallback', 500); T.at(-1).g = 1 } };
  const real = S.scen.endsWith('this'); add('Pre-flight check', real ? 'read-only scan of this PC' : 'mock clean PC, nothing scanned', 700); T[0].real = real;
  if (act === 'install') {
    if (a) add('Back up existing NEXUS (code + data)', 'NEXUS Backups\\' + STAMP, 1100);
    inst();
    add('Install NEXUS ' + VER + ' app files', 'signature check', 1200, 'Package signature did not match (simulated failure)');
    add(a ? 'Connect existing data folder' : 'Create personal data folder', a ? 'nothing moved' : '', 500); integT();
    if (a) add('Claude Code hooks', 'kept as is', 350); else if (S.c.hooks === 'add') { add('Back up Claude Code settings.json', '', 400); add('Add ' + HOOKS.length + ' NEXUS hooks', 'exact entries', 500) }
    if (S.c.desk || S.c.start) add('Create shortcuts', '', 400);
    if (S.c.boot) add('Add Start with Windows entry', 'per-user', 350);
    add('Write install manifest', '', 400); add('Final check', 'tracker on 127.0.0.1', 800);
  } else if (act === 'update') {
    add('Back up current version + data', 'NEXUS Backups\\' + STAMP, 1000); add('Verify update signature', 'NEXUS public key', 700); add('Close NEXUS window', 'tracker keeps running', 400);
    add('Replace app files', NEWVER, 1300, 'A program file was in use and could not be replaced (simulated failure)'); add('Migrate settings', 'schema unchanged', 400); add('Update install manifest', '', 400); add('Final check', '', 700);
  } else if (act === 'repair') {
    add('Check app files against manifest', '', 1100); add('Recreate Start menu shortcut', '', 500, 'Could not write the shortcut (simulated failure)'); add('Check uninstall record', 'ok', 400); add('Check Claude Code hooks', 'no change', 400); add('Final check', '', 600);
  } else if (act === 'uninstall') {
    add('Close NEXUS window', 'tracker keeps running', 400);
    if (!a && S.c.delData) { add('Back up NEXUS data', 'zip · NEXUS Backups\\' + STAMP, 1100); add('Delete NEXUS-owned data', '5 items from manifest', 700) }
    if (!a && S.c.rmHooks) { add('Back up Claude Code settings.json', '', 400); add('Remove ' + HOOKS.length + ' NEXUS hook entries', 'exact match', 500) }
    add('Remove app files', 'manifest only', 1000, 'A program file was in use (simulated failure)'); add('Remove shortcuts + startup entry', '', 400); add('Remove uninstall record', '', 400);
    add('Final check', a || !S.c.delData ? 'data folder untouched' : '', 500);
  } else if (act === 'integ') {
    add('Back up NEXUS settings', 'NEXUS Backups\\' + STAMP, 700); inst(); integT();
    add('Save integration settings', 'NEXUS data only', 500, 'The settings file was locked (simulated failure)'); add('Final check', 'vaults + Graphify files unchanged', 500);
  } else { add('Back up current data', 'NEXUS Backups\\' + STAMP, 900); add('Verify backup archive', 'hash', 600, 'Backup archive is damaged (simulated failure)'); add('Restore data files', '', 1000); add('Final check', '', 500) }
  return T;
}
const tm = () => new Date().toTimeString().slice(0, 8);
// progress = time-weighted: finished steps count their full simulated duration, the running one its elapsed share (capped at 95%)
function pk(p) {
  if (!p) return { v: 0, l: '' };
  if (p.rb) { const u = p.tasks.filter(t => t.s === 'rb' && !t.real).length; return { v: p.back ? u / p.back : 1, l: `undone ${u} of ${p.back}` } }
  const all = p.tasks.reduce((n, t) => n + t.ms, 0), now = performance.now();
  let v = 0; for (const t of p.tasks) v += t.s === 'ok' ? t.ms : t.s === 'run' ? Math.min(.95, (now - t.t0) / t.ms) * t.ms : 0;
  return { v: v / all, l: p.err ? `stopped at step ${p.done + 1} of ${p.tasks.length}` : p.done >= p.tasks.length ? `${p.tasks.length} of ${p.tasks.length} steps` : `step ${p.done + 1} of ${p.tasks.length} · ~${Math.ceil((all - v) / 1000)} s left` };
}
function tick() {
  const p = S.prog, fg = $('.ring .fg'); if (!p || !fg || p.rb || !p.tasks.some(t => t.s === 'run')) { clearInterval(S.tk); S.tk = 0; return }
  const k = pk(p); fg.style.strokeDashoffset = 2 * Math.PI * 76 * (1 - k.v); $('.ring .pc b').textContent = Math.round(k.v * 100) + '%'; $('.ring .pc span').textContent = k.l;
}
function startRun() { const real = S.scen.endsWith('this'); S.prog = { tasks: tasksFor().map(t => ({ ...t, sub0: t.sub })), done: 0, back: 0, log: [`<span class="o">${tm()} Setup ${maint() ? NEWVER : VER} · ${real ? 'this PC' : 'simulated PC'} · preview run: [sim] steps are timers, [real] steps are read-only</span>`], err: null, rb: false }; step(S.run) }
function step(run) {
  const p = S.prog; if (run !== S.run || !p) return;
  const t = p.tasks[p.done]; if (!t) { p.log.push(`<span class="o">${tm()} done · nothing on this PC was changed</span>`); render(); return setTimeout(() => run === S.run && go(1), 700) }
  t.s = 'run'; t.t0 = performance.now(); p.log.push(`${tm()} ${t.real ? '[real]' : '[sim]'} ${esc(t.t)}…`); render(); if (!S.tk) S.tk = setInterval(tick, 150);
  const fin = () => {
    if (run !== S.run) return;
    if (t.fail && $('#fail').checked && !S.c.retried) { t.s = 'bad'; t.sub = 'failed · nothing from this step kept'; p.err = t.fail; S.c.failed = true; p.log.push(`<span class="e">${tm()} [sim] ERROR ${esc(t.fail)}</span>`); return render() }
    if (t.soft && $('#fail').checked) { t.warn = 1; t.sub = t.soft; S.c.fallback = true; p.tasks.filter(x => x.g).forEach(x => { x.sub = 'skipped: built-in graph used' }); p.log.push(`<span class="w">${tm()} [sim] ${esc(t.t)} failed · optional, continuing with the built-in graph</span>`) }
    t.s = 'ok'; p.done++; p.log.push(`<span class="o">${tm()} ok</span> ${esc(t.t)}`); step(run);
  };
  if (!t.real) return setTimeout(fin, t.ms);
  // the one real step: the same read-only GET as the Components scan (cached 60 s server side)
  fetch('/api/setup/detect', { cache: 'no-store' }).then(r => r.json()).then(j => { const f = j.deps.filter(x => x.found).length; t.sub = `read-only scan · ${f} of ${j.deps.length} components found`; p.log.push(`${tm()} [real] GET /api/setup/detect · ${f}/${j.deps.length} found · nothing written`) })
    .catch(() => { t.sub = 'read-only scan unavailable; earlier result used' }).finally(() => setTimeout(fin, Math.max(0, t.ms - (performance.now() - t.t0))));
}
function retry() { S.c.retried = true; const p = S.prog, t = p.tasks[p.done]; t.s = ''; t.sub = t.sub0; p.err = null; p.log.push(`<span class="w">${tm()} retry</span> ${esc(t.t)}`); step(S.run) }
function rollback() {
  const p = S.prog, run = S.run, back = p.tasks.slice(0, p.done).reverse(); p.rb = true; p.back = back.filter(t => !t.real).length; p.tasks[p.done].s = 'bad';
  p.tasks.slice(p.done + 1).forEach(t => { t.s = 'skip' });
  p.log.push(`<span class="w">${tm()} rolling back ${p.back} completed step${p.back === 1 ? '' : 's'}</span>`);
  const nxt = () => { if (run !== S.run) return; const t = back.shift(); if (!t) { S.c.rolled = true; p.log.push(`<span class="o">${tm()} rollback complete</span>`); render(); return setTimeout(() => run === S.run && go(1), 900) }
    if (t.real) { t.s = 'rb'; t.sub = 'read-only, nothing to undo'; return nxt() }
    t.s = 'run'; t.sub = 'undoing'; render(); setTimeout(() => { if (run !== S.run) return; t.s = 'rb'; t.sub = 'undone'; p.log.push(`<span class="w">${tm()} [sim] undone</span> ${esc(t.t)}`); nxt() }, 420) };
  render(); nxt();
}

/* ---------------- render + navigation ---------------- */
let cur = null;
function render() {
  const id = S.flow[S.i], v = scr[id](), same = cur === id; cur = id;
  const body = $('#body'), top = body.scrollTop;
  body.innerHTML = `<section class="sc ${v.mid ? 'mid ' : ''}${same ? 'still' : S.dir < 0 ? 'back' : ''}">${v.h}</section>`;
  if (same) body.scrollTop = top;
  const lg = $('#log'); if (lg) lg.scrollTop = lg.scrollHeight;
  $('#steps').innerHTML = S.flow.map((f, i) => `<li class="${i < S.i ? 'done' : i === S.i ? 'cur' : ''} ${i === S.i && S.prog?.err && !S.prog.rb && f === 'progress' ? 'err' : ''}"><span class="n">${i < S.i ? '✓' : i + 1}</span><span class="t">${esc(f === 'progress' && maint() ? PLBL[S.c.act] : LBL[f])}</span></li>`).join('');
  const d = det();
  $('#railfoot').innerHTML = maint() ? `<b>${adopt() ? 'Connected install' : 'New layout'}</b>Installed ${VER} → ${NEWVER}` : `<b>${S.c.type === 'adopt' ? 'Connect existing' : 'New install'}</b>Per-user · no admin rights${d?.sim ? '<br>Simulated PC' : ''}`;
  $('#ver').textContent = maint() ? NEWVER : VER;
  const n = v.next, back = v.back !== false && S.i > 0, cancel = v.cancel !== false;
  $('#ft').innerHTML = `${cancel ? '<button class="b ghost" data-cancel>Cancel</button>' : ''}${back ? `<button class="b sec" data-back>${ic('back')}Back</button>` : ''}<span class="sp"></span>
    <span class="hint">${S.err && !d ? 'Detection unavailable: ' + esc(S.err) : v.hint || ''}</span>
    ${v.alt ? `<button class="b sec" data-alt>${ic(v.alt.ic)}${esc(v.alt.t)}</button>` : ''}
    ${id === 'progress' && !n.fn ? '' : `<button class="b ${n.dan ? 'dan' : 'pri'}" data-next aria-disabled="${!n.ok}">${esc(n.t)}${n.ic ? ic(n.ic) : ic('arrow')}</button>`}`;
  S.view = v; $('#win').classList.toggle('busy', id === 'progress');
  $('[data-modal]')?.remove();
  if (S.modal) $('#win').insertAdjacentHTML('beforeend', S.modal);
}
function go(dir) {
  S.dir = dir; S.i = Math.max(0, Math.min(S.flow.length - 1, S.i + dir)); S.modal = null;
  if (S.flow[S.i] === 'progress' && dir > 0) { cur = null; startRun() } else { cur = null; render() }
  $('#body').scrollTop = 0;
}
function setAct(a) { S.c.act = a; S.flow = a === 'integ' ? ['mwelcome', 'obsidian', 'graphify', 'review', 'progress', 'done'] : ['mwelcome', { update: 'mupdate', repair: 'mrepair', uninstall: 'muninst', restore: 'mrestore' }[a], 'progress', 'done'] }
function modal(t, p, yes, cls = 'pri') { S.modal = `<div class="modal" data-modal><div role="alertdialog" aria-label="${esc(t)}"><h2>${esc(t)}</h2><p>${p}</p><div class="row"><button class="b sec" data-m="no">Go back</button><button class="b ${cls}" data-m="yes">${esc(yes)}</button></div></div></div>`; S.onYes = null; render() }
let tt; function toast(m) { const e = $('#toast'); e.textContent = m; e.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => e.classList.remove('on'), 2600) }

document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-consent], [data-deldata]'); if (!t) return;
  const D = t.dataset;
  if (D.s) return setScen(D.s);
  if (D.m) { const y = D.m === 'yes', k = S.mk; S.modal = null; if (y && k === 'cancel') { toast('Preview: the real Setup closes here. Nothing was changed.'); return render() } if (y && k === 'go') return go(1); return render() }
  if ('next' in D) { if (t.getAttribute('aria-disabled') === 'true') return; const n = S.view.next; if (n.fn) return n.fn();
    const id = S.flow[S.i];
    if (id === 'muninst') { S.mk = 'go'; return modal('Uninstall NEXUS?', adopt() ? 'App files, shortcuts and records are removed. Your data folder, hooks and everything else are kept.' : `App files are removed${S.c.rmHooks ? ', the ' + HOOKS.length + ' NEXUS hooks are removed (settings.json backed up)' : ''}${S.c.delData ? ', and NEXUS data is <b>deleted after a backup</b>' : ', your data is kept'}.`, 'Uninstall', 'dan') }
    if (id === 'mrestore') { S.mk = 'go'; return modal('Restore this backup?', 'Your current data is backed up first, then replaced by the selected backup.', 'Restore') }
    return go(1) }
  if ('back' in D) return go(-1);
  if ('alt' in D) return S.view.alt.fn();
  if ('cancel' in D) { S.mk = 'cancel'; return modal('Exit Setup?', 'Nothing has been changed on your PC.', 'Exit Setup') }
  if (D.type && t.getAttribute('aria-disabled') !== 'true') { S.c.type = D.type; return render() }
  if (D.hooks) { S.c.hooks = D.hooks; return render() }
  if (D.act) { setAct(D.act); return render() }
  if ('actRestore' in D) { setAct('restore'); return go(1) }
  if ('actInteg' in D) { setAct('integ'); return go(1) }
  if (D.obs) { S.c.obs.mode = D.obs; S.c.obs.ok = false; if (!dep('obsidian').found) S.c.dep.obsidian = D.obs === 'skip' ? 'skip' : S.c.dep.obsidian === 'manual' ? 'manual' : 'auto'; return render() }
  if (D.gmode) { const d = S.c.dep; S.c.gfy.mode = D.gmode; if (!dep('graphify').found) d.graphify = D.gmode === 'builtin' ? 'skip' : d.graphify === 'manual' ? 'manual' : 'auto';
    if (!dep('uv').found) d.uv = d.graphify === 'skip' ? 'skip' : d.graphify; return render() }
  if ('obscreate' in D) { S.c.obs.create = !S.c.obs.create; S.c.obs.ok = false; return render() }
  if ('vadd' in D) { const o = S.c.obs, p = o.bpath.trim(), v = vlist().find(v => norm(v.path) === norm(p)); o.berr = folderErr(p) || (v ? `Already listed as ${v.name}${o.sel[v.path] ? ' and selected' : ': tick it in the list'}.` : '');
    if (!o.berr) { o.extra.push({ name: vname(p), path: p, sim: true, reg: false }); o.sel[p] = true; o.bpath = ''; o.ok = false } return render() }
  if ('gadd' in D) { const g = S.c.gfy, p = g.fpath.trim(); g.ferr = folderErr(p) || (gsrc().some(s => norm(s.path) === norm(p)) ? 'That folder is already in the list.' : ''); if (!g.ferr) { g.extra.push(p); g.scope[p] = true; g.fpath = '' } return render() }
  if ('gscope' in D) { S.c.gfy.scope[D.gscope] = !S.c.gfy.scope[D.gscope]; return render() }
  if (D.bk) { S.c.bk = +D.bk; return render() }
  if (D.dep && !t.disabled) { const d = S.c.dep; d[D.dep] = D.v; if (D.dep === 'graphify' && D.v === 'auto' && 'uv' in d && d.uv !== 'auto') { d.uv = 'auto'; toast('uv selected too: Graphify needs it.') }
    if (D.dep === 'uv' && D.v !== 'auto' && d.graphify === 'auto') { d.graphify = D.v === 'manual' ? 'manual' : 'skip'; toast('Graphify changed too: it needs uv.') } return render() }
  if (D.why) { t.closest('.dep').classList.toggle('open'); return }
  if (D.opt) { S.c[D.opt] = !S.c[D.opt]; return render() }
  if (D.skill) { S.c.skills[D.skill] = !S.c.skills[D.skill]; return render() }
  if ('browse' in D) return toast('Preview: the real Setup opens the Windows folder picker here.');
  if ('rescan' in D) return detect(true);
});
document.addEventListener('change', e => {
  const t = e.target, D = t.dataset;
  if ('consent' in D) { S.c.consent = t.checked; render() }
  else if ('terms' in D) { S.c.terms = t.checked; render() }
  else if ('deldata' in D) { S.c.delData = t.checked; S.c.typed = ''; render() }
  else if ('vault' in D) { S.c.obs.sel[D.vault] = t.checked; S.c.obs.ok = false; render() }
  else if ('obsok' in D) { S.c.obs.ok = t.checked; render() }
  else if ('use' in D) { S.c.obs.use[D.use] = t.value; S.c.obs.ok = false; render() }
  else if (D.sel) { S.c[D.sel] = t.value; render() }
  else if (t.id === 'fail') { S.c.retried = false; toast(t.checked ? 'The next install, update, repair, uninstall or restore will fail at one step.' : 'Failure simulation off.') }
});
document.addEventListener('input', e => {
  const t = e.target;
  if ('typed' in t.dataset) { S.c.typed = t.value; const b = $('[data-next]'); if (b) b.setAttribute('aria-disabled', String(S.c.typed !== 'DELETE')) }
  else if (t.id === 'f-vault') S.c.obs.bpath = t.value;
  else if (t.id === 'f-gdir') S.c.gfy.fpath = t.value;
  else if (t.id === 'f-cpath') { S.c.obs.cpath = t.value; S.c.obs.ok = false; const pos = t.selectionStart; cur = S.flow[S.i]; render(); const f = $('#f-cpath'); f.focus(); f.setSelectionRange(pos, pos) }
  else if (t.id === 'f-prog' || t.id === 'f-data') { S.c[t.id === 'f-prog' ? 'prog' : 'data'] = t.value; const err = locErr(), b = $('[data-next]'); if (b) b.setAttribute('aria-disabled', String(!!err));
    const n = $('.body .note.err'); if (!!n !== !!err || (n && n.textContent !== err)) { const pos = t.selectionStart, id = t.id; cur = S.flow[S.i]; render(); const f = $('#' + id); f.focus(); f.setSelectionRange(pos, pos) } }
});
function setScen(s) { S.scen = s; try { localStorage.setItem('nexus.setupPreview.scen', s) } catch { } document.querySelectorAll('#scen button').forEach(b => b.setAttribute('aria-checked', b.dataset.s === s)); reset(); cur = null; render() }
async function detect(refresh) {
  if (refresh) toast('Re-running read-only detection…');
  try { const r = await fetch('/api/setup/detect' + (refresh ? '?refresh=1' : ''), { cache: 'no-store' }); const j = await r.json(); if (j.error || !j.deps) throw new Error(j.error || 'bad answer'); S.real = j; S.err = null }
  catch (e) { S.err = e.message; if (!S.real) S.real = null }
  const keep = S.flow[S.i]; reset(); if (refresh && keep && S.flow.includes(keep) && keep !== 'progress' && keep !== 'done') S.i = S.flow.indexOf(keep); cur = null; render();
}
$('#redetect').onclick = () => detect(true);
let s0 = 'this'; try { s0 = localStorage.getItem('nexus.setupPreview.scen') || 'this' } catch { }
document.querySelectorAll('#scen button').forEach(b => b.setAttribute('aria-checked', b.dataset.s === s0)); S.scen = s0; reset(); render(); detect(false);
window.__setup = S; // test hook (preview only)
