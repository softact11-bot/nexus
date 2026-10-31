// M3 gate (c) preview: Knowledge page sync + graph controls. Isolated sample data, no fetch, nothing read, written or synced (spec §26.7).
// Actions, reasons and backup rules mirror sync.js (plan / run) and graph.js (source); every project keeps its own sample data and state.
import { esc } from './fmt.js';
const $ = id => document.getElementById(id);
const L = (...a) => a.join('\n');
const SPOOKY_PAIRS = [['PROJECT_DOCS.md', 'Project Docs'], ['PROJECT_MEMORY.md', 'Project Memory'], ['redesign/SESSION_CONTEXT.md', 'Redesign Context'], ['SESSION_CONTEXT.md', 'Merchant Context'],
  ['cursors/SESSION_CONTEXT.md', 'Cursors Context'], ['INDEX.md', 'File Index'], ['ASSET_REGISTRY.md', 'Asset Registry']];
// sample projects (made up; folder names only look like a real setup)
const DATA = {
  spooky: { name: 'Demo Game', dir: 'C:\\Users\\you\\Desktop\\Demo Game', vault: 'C:\\Users\\you\\Documents\\Game Vault', folder: 'Demo Game',
    mapping: 'sync_docs.sh pair table (7 files + docs\\*.md), kept as is', sync: { mode: 'cmd', cmd: 'bash sync_docs.sh' },
    graph: { mode: 'graphify', out: 'C:\\Users\\you\\Desktop\\Demo Game\\graphify-out', found: true, nodes: 312, links: 1241, built: '2026-10-15 21:02' },
    items: [
      ...SPOOKY_PAIRS.map(([src, note]) => ({ src, note, action: note === 'Project Docs' ? 'push' : note === 'Project Memory' ? 'pull' : note === 'Asset Registry' ? 'merge' : 'same' })),
      { src: 'docs/Pumpkin Boss.md', note: 'Pumpkin Boss', action: 'create-vault' },
      { src: 'docs/Lantern Shop.md', note: 'Lantern Shop', action: 'conflict', kind: 'same-lines' },
      { src: 'docs/Graveyard Map.md', note: 'Graveyard Map', action: 'same' }],
    conflicts: { 'Lantern Shop': { base: L('# Lantern Shop', 'Price: 250 candy', 'Opens at night', 'Sells 3 lanterns'), project: L('# Lantern Shop', 'Price: 300 candy', 'Opens at night', 'Sells 3 lanterns'), vault: L('# Lantern Shop', 'Price: 275 candy', 'Opens at night', 'Sells 3 lanterns', 'Added in Obsidian: glow upgrade') } },
    history: [
      { at: '2026-10-15 20:41', by: 'Custom command (sync_docs.sh)', res: 'ok', c: { create: 0, update: 2, same: 26, conflict: 0 }, backup: 'backups\\sync-2026-10-15-20-41-07' },
      { at: '2026-10-14 18:03', by: 'Custom command (sync_docs.sh)', res: 'ok', c: { create: 1, update: 0, same: 27, conflict: 0 }, backup: 'none needed' }] },
  arcade: { name: 'Haunted Arcade', dir: 'C:\\Users\\you\\Desktop\\Haunted Arcade', vault: 'C:\\Users\\you\\Documents\\Game Vault', folder: 'Haunted Arcade',
    mapping: 'default pairs: PROJECT_DOCS.md → Project Docs, PROJECT_MEMORY.md → Project Memory, INDEX.md → File Index, docs\\*.md (CLAUDE.md never synced)', sync: { mode: 'manual', cmd: '' }, first: true,
    graph: { mode: 'graphify', out: 'C:\\Users\\you\\Desktop\\Haunted Arcade\\graphify-out', found: false, nodes: 64, links: 151, built: '2026-10-15 21:10' },
    items: [
      { src: 'PROJECT_DOCS.md', note: 'Project Docs', action: 'create-vault' }, { src: 'PROJECT_MEMORY.md', note: 'Project Memory', action: 'create-vault' },
      { src: 'INDEX.md', note: 'File Index', action: 'conflict', kind: 'duplicate-content', twin: 'Arcade Index' },
      { src: 'docs/Claw Machine.md', note: 'Claw Machine', action: 'conflict', kind: 'first-sync' },
      { src: 'docs/Ticket Booth.md', note: 'Ticket Booth', action: 'same' },
      { src: 'docs/Linked Notes.md', note: 'Linked Notes', action: 'refused', why: 'Not touched: vault note: is a junction pointing outside the linked folder' }],
    conflicts: { 'File Index': { base: null, project: L('# File Index', '- docs/Claw Machine.md', '- docs/Ticket Booth.md'), vault: L('# File Index', '- docs/Claw Machine.md', '- docs/Ticket Booth.md'), twinNote: 'Arcade Index' },
      'Claw Machine': { base: null, project: L('# Claw Machine', 'Prize odds: 1 in 12', 'Costs 5 tickets'), vault: L('# Claw Machine', 'Prize odds: 1 in 10', 'Costs 5 tickets', 'Idea: golden claw') } },
    history: [] },
  tycoon: { name: 'Pumpkin Tycoon', dir: 'C:\\Users\\you\\Desktop\\Pumpkin Tycoon', vault: 'C:\\Users\\you\\Documents\\Tycoon Vault', folder: '',
    mapping: 'default pairs: PROJECT_DOCS.md → Project Docs, PROJECT_MEMORY.md → Project Memory, docs\\*.md', sync: { mode: 'auto', cmd: '' },
    graph: { mode: 'builtin', out: '', found: false, nodes: 41, links: 88, built: '2026-10-15 19:55' },
    items: [{ src: 'PROJECT_DOCS.md', note: 'Project Docs', action: 'same' }, { src: 'PROJECT_MEMORY.md', note: 'Project Memory', action: 'pull' }, { src: 'docs/Farm Plots.md', note: 'Farm Plots', action: 'same' }],
    conflicts: {},
    history: [
      { at: '2026-10-15 19:55', by: 'Automatic', res: 'ok', c: { create: 0, update: 1, same: 2, conflict: 0 }, backup: 'backups\\sync-2026-10-15-19-55-31' },
      { at: '2026-10-15 17:34', by: 'Manual', res: 'ok', c: { create: 0, update: 1, same: 2, conflict: 0 }, backup: 'backups\\sync-2026-10-15-17-34-12' },
      { at: '2026-10-15 17:20', by: 'Automatic', res: 'manual', c: { create: 0, update: 0, same: 2, conflict: 1 }, backup: 'sync-conflicts\\2026-10-15-17-20-02-tycoon', note: 'Conflict found: automatic sync stopped and switched this project to Manual. Resolved by hand at 17:34.' } ] },
  racer: { name: 'Ghost Racer', dir: 'C:\\Users\\you\\Desktop\\Ghost Racer', vault: '', folder: '', mapping: '', sync: { mode: 'off', cmd: '' }, graph: { mode: 'builtin' }, items: [], conflicts: {}, history: [] } };

const GROUP = { 'create-vault': 'create', push: 'update', pull: 'update', merge: 'update', same: 'same', conflict: 'conflict', refused: 'refused', none: 'same' };
const DIR = { 'create-vault': 'Project → Vault', push: 'Project → Vault', pull: 'Vault → Project', merge: 'Project ⇄ Vault', same: 'no change', conflict: 'waits for you', refused: 'not touched' };
const BACKUP = { 'create-vault': ['New note: nothing to back up', 0], push: ['Vault note backed up first', 1], pull: ['Project file backed up first', 1], merge: ['Both files backed up first', 1],
  same: ['Not touched', 0], conflict: ['Every version copied to sync-conflicts before your choice is applied', 1], refused: ['Not touched', 0] };
const WHY = { 'create-vault': 'New note in the vault, copied from the project file.', push: 'Changed in the project since the last sync; the vault note gets the new text.',
  pull: 'Changed in Obsidian since the last sync; the project file gets the new text.', merge: 'Both sides changed different lines; both edits are kept in one file.',
  same: 'Both sides already match.' };
const KIND = { 'same-lines': 'The same lines were changed in the project and in Obsidian.', 'first-sync': 'First sync and the two versions differ: there is no last synced copy to tell which side is newer.',
  'duplicate-content': 'The vault already has this exact text under another name; creating the note would make a duplicate.', 'base-damaged': 'The last synced copy is missing or damaged, so NEXUS cannot tell which side changed.',
  format: 'Both sides changed and their encoding or line endings differ.', 'missing-project': 'The project file is missing; NEXUS never deletes.' };
const LEGEND = [['create', 'Create', 'A new note is added to the vault from a project file. Nothing existing is changed.'],
  ['update', 'Update', 'One side changed since the last sync: the other side gets the new text after a verified backup. Changes on both sides in different lines are merged.'],
  ['same', 'Unchanged', 'Both sides match. Nothing is written.'],
  ['conflict', 'Conflict', 'NEXUS cannot safely decide. Nothing is written until you pick a version below; it never overwrites on its own.'],
  ['refused', 'Refused', 'Outside the allowed folders (symlink, junction, Obsidian or Graphify files, another user). Never touched.']];
const MODES = [['off', 'Off'], ['manual', 'Manual'], ['auto', 'Automatic'], ['cmd', 'Custom command']];
const MODE_TXT = { off: 'Sync is off for this project. Nothing runs, the preview below is for information only.',
  manual: 'Sync runs only when you press Sync, after this preview. The first sync of a project is always preview + per-file choices.',
  auto: 'Runs after a doc changes, only once a first manual sync has recorded the last synced copy. Any conflict stops it and switches this project back to Manual.',
  cmd: 'Your own command runs in the project folder (it asks first). NEXUS’s engine does not run; the preview shows what the built-in engine would do with the same pairs.' };

const S = {}; // per-project UI state; never shared between projects
const st = id => S[id] ||= { filter: 'all', sel: null, choice: {}, sync: { ...DATA[id].sync }, graph: DATA[id].graph.mode, hist: [], msg: '' };
let cur = new URLSearchParams(location.search).get('p') || 'spooky'; if (!DATA[cur]) cur = 'spooky';

const pj = (p, src) => p.dir + '\\' + src.replace(/\//g, '\\'), vt = (p, note) => p.vault + (p.folder ? '\\' + p.folder : '') + '\\' + note + '.md';
const seg = (name, val, opts, dis = []) => `<div class="lk-seg" role="radiogroup">${opts.map(([v, t]) => `<label${v === val ? ' class="on"' : ''}><input type="radio" name="${name}" value="${v}"${v === val ? ' checked' : ''}${dis.includes(v) ? ' disabled' : ''}>${t}</label>`).join('')}</div>`;
const conflicts = p => p.items.filter(i => i.action === 'conflict');
function counts(p) { const c = { create: 0, update: 0, same: 0, conflict: 0, refused: 0 }; for (const i of p.items) c[GROUP[i.action]]++; return c }

// line diff (LCS) for the conflict panel: marks lines only on one side
function diff(a, b) {
  const x = a.split('\n'), y = b.split('\n'), n = x.length, m = y.length, T = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i][j] = x[i] === y[j] ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
  const A = new Set(), B = new Set(); let i = 0, j = 0;
  while (i < n && j < m) { if (x[i] === y[j]) { i++; j++ } else if (T[i + 1][j] >= T[i][j + 1]) A.add(i++); else B.add(j++) }
  while (i < n) A.add(i++); while (j < m) B.add(j++);
  return [x.map((t, k) => [t, A.has(k)]), y.map((t, k) => [t, B.has(k)])];
}
const pre = (rows, cls) => `<pre>${rows.map(([t, d], k) => `<div data-n="${k + 1}"${d ? ` class="${cls}"` : ''}>${esc(t)}</div>`).join('')}</pre>`;

function graphCard(p, s) {
  if (!p.vault) return `<section class="card syn-sec" id="syn-graph"><div class="card-h"><h2>Knowledge graph</h2></div><span class="syn-src none" data-src="none"><i></i>No graph</span><p class="syn-note">No Obsidian vault is linked to ${esc(p.name)}, so there is no graph. Link a vault on the Projects page.</p></section>`;
  const g = p.graph, want = s.graph, src = want === 'graphify' ? (g.found ? 'graphify' : 'fallback') : 'builtin';
  const badge = { graphify: 'Using Graphify', builtin: 'Using built-in graph', fallback: 'Using built-in graph (Graphify not found)' }[src];
  return `<section class="card syn-sec" id="syn-graph"><div class="card-h"><h2>Knowledge graph</h2><div class="end"><span class="syn-src ${src}" data-src="${src}"><i></i>${badge}</span></div></div>
    ${seg('graph', want, [['graphify', 'Graphify'], ['builtin', 'Built-in (no extra installs)']])}
    <dl class="syn-kv">
      ${want === 'graphify' ? `<dt>Graphify output</dt><dd class="syn-path">${esc(g.out)}\\graph.json</dd><dt>Status</dt><dd>${g.found ? 'Found and readable. NEXUS only reads it; Graphify keeps building it.' : '<span class="syn-note warn">Not found. NEXUS shows its built-in graph until graph.json is back. Graphify’s folder is never written.</span>'}</dd>` : ''}
      ${src !== 'graphify' ? `<dt>Built-in graph</dt><dd class="syn-path">&lt;NEXUS data&gt;\\graphs\\${esc(cur)}\\graph.json</dd><dt>Note cache</dt><dd>Metadata only: tags, aliases, link targets and skill names. No note text is stored. Kept in your own Windows profile, per project.</dd>` : ''}
      <dt>Nodes / links</dt><dd>${g.nodes.toLocaleString()} / ${g.links.toLocaleString()} <span class="chip demo" title="Sample numbers">SAMPLE</span></dd>
      <dt>Last built</dt><dd>${esc(g.built)}</dd>
      <dt>Includes</dt><dd>${esc(p.folder ? 'Vault folder “' + p.folder + '” and unlinked folders; other projects’ linked folders are left out' : 'The whole vault (no other project uses it)')}</dd></dl>
    <div class="syn-acts"><button class="btn sm" type="button" data-a="rebuild"${src === 'graphify' ? ' disabled title="Graphify builds this graph"' : ''}>Rebuild built-in graph</button><span class="syn-note">Same rules as Graphify’s vault graph, so node ids match.</span></div></section>`;
}

function settingsCard(p, s) {
  if (!p.vault) return `<section class="card syn-sec" id="syn-set"><div class="card-h"><h2>Sync settings</h2></div><p class="syn-note">Link a vault to ${esc(p.name)} first. Until then there is nothing to sync.</p></section>`;
  const m = s.sync.mode, needAnc = !!p.first;
  return `<section class="card syn-sec" id="syn-set"><div class="card-h"><h2>Sync settings</h2><div class="end"><span class="chip ${m === 'off' ? 'unk' : 'live'}">${esc(MODES.find(x => x[0] === m)[1].toUpperCase())}</span></div></div>
    ${seg('mode', m, MODES, needAnc ? ['auto'] : [])}
    ${needAnc ? '<p class="syn-note warn">Automatic is available after the first manual sync records the last synced copy.</p>' : ''}
    ${m === 'cmd' ? `<label class="syn-note">Command (runs in the project folder)<input class="syn-in" name="cmd" maxlength="300" value="${esc(s.sync.cmd)}" placeholder="bash sync_docs.sh"></label>` : ''}
    <p class="syn-note">${esc(MODE_TXT[m])}</p>
    <dl class="syn-kv"><dt>Project folder</dt><dd class="syn-path">${esc(p.dir)}</dd><dt>Vault folder</dt><dd class="syn-path">${esc(p.vault + (p.folder ? '\\' + p.folder : ''))}</dd><dt>File pairs</dt><dd>${esc(p.mapping)}</dd>
      <dt>Safety</dt><dd>Verified backup before every write · atomic writes · encoding and line endings kept · never deletes · one sync at a time</dd></dl>
    <div class="syn-acts"><button class="btn sm pri" type="button" data-a="save">Save settings</button></div></section>`;
}

function previewCard(p, s) {
  if (!p.vault) return `<section class="card syn-sec" id="syn-prev"><div class="card-h"><h2>Sync preview</h2></div><div class="syn-empty">No vault linked: nothing to compare.</div></section>`;
  const c = counts(p), rows = p.items.filter(i => s.filter === 'all' || GROUP[i.action] === s.filter);
  const kp = [['create', 'Create'], ['update', 'Update'], ['same', 'Unchanged'], ['conflict', 'Conflicts'], ['refused', 'Refused']];
  return `<section class="card syn-sec" id="syn-prev"><div class="card-h"><h2>Sync preview${p.first ? ' · first sync' : ''}</h2><div class="end"><span class="chip demo" title="Isolated sample data">SAMPLE DATA</span></div></div>
    ${p.first ? '<p class="syn-note warn">First sync of this project: nothing is written until you confirm this list and choose a version for each conflict.</p>' : ''}
    <div class="syn-kpis">${kp.map(([k, t]) => `<button type="button" class="syn-kpi${s.filter === k ? ' on' : ''}" data-f="${k}" aria-pressed="${s.filter === k}"><b>${c[k]}</b><span>${t}</span></button>`).join('')}</div>
    <div class="tbl-wrap"><table class="tbl syn-tbl"><thead><tr><th><button type="button" data-f="all">Action</button></th><th><button type="button">Note</button></th><th><button type="button">Source → destination</button></th><th><button type="button">Direction</button></th><th><button type="button">Backup</button></th></tr></thead>
    <tbody>${rows.map(i => { const g = GROUP[i.action], [bk, y] = BACKUP[i.action] || BACKUP.same, ch = s.choice[i.note];
      const from = i.action === 'pull' ? vt(p, i.note) : pj(p, i.src), to = i.action === 'pull' ? pj(p, i.src) : vt(p, i.note);
      return `<tr data-note="${esc(i.note)}"><td class="syn-ac"><span class="syn-a ${g}">${esc({ create: 'Create', update: i.action === 'merge' ? 'Merge' : 'Update', same: 'Unchanged', conflict: 'Conflict', refused: 'Refused' }[g])}</span></td>
        <td><b>${esc(i.note)}</b><div class="syn-why">${esc(i.action === 'conflict' ? KIND[i.kind] + (i.twin ? ' (“' + i.twin + '”)' : '') : i.why || WHY[i.action] || '')}${ch ? ` <span class="ch">· your choice: ${esc(CH[ch])}</span>` : ''}</div></td>
        <td><div class="syn-path">${esc(from)}</div><div class="syn-path">→ ${esc(to)}</div></td><td class="syn-dir">${esc(DIR[i.action])}</td><td class="syn-bk${y ? ' y' : ''}">${esc(bk)}</td></tr>` }).join('') || '<tr><td colspan="5"><div class="syn-empty">Nothing in this group.</div></td></tr>'}</tbody></table></div>
    <ul class="syn-legend">${LEGEND.map(([k, t, d]) => `<li><span class="syn-a ${k}">${t}</span>${esc(d)}</li>`).join('')}</ul>
    <div class="syn-acts"><button class="btn pri" type="button" disabled title="Sync is disabled during checkpoint (c)">Sync now</button><button class="btn" type="button" data-a="sim">Simulate this sync</button>
      <span class="syn-note">Real sync is disabled in this checkpoint. “Simulate” only adds a simulated line to the history below; no file is read or written.</span></div></section>`;
}
const CH = { project: 'keep the project version', vault: 'keep the Obsidian version', skip: 'leave both as they are' };

function conflictCard(p, s) {
  const C = conflicts(p);
  if (!p.vault || !C.length) return `<section class="card syn-sec" id="syn-cfl"><div class="card-h"><h2>Conflicts</h2></div><div class="syn-empty">${p.vault ? 'No conflicts in this preview.' : 'No vault linked.'}</div></section>`;
  if (!C.some(i => i.note === s.sel)) s.sel = C[0].note;
  const it = C.find(i => i.note === s.sel), d = p.conflicts[it.note], [l, r] = diff(d.project, d.vault), ch = s.choice[it.note] || '';
  const opts = it.kind === 'duplicate-content' ? [['skip', 'Leave it', `Do not create “${it.note}”. The existing note “${d.twinNote}” stays as it is.`], ['project', 'Create it anyway', 'Adds a second note with the same text. Usually not what you want.']]
    : [['project', 'Keep the project version', 'The Obsidian note is replaced by the project file, after a verified backup.'], ['vault', 'Keep the Obsidian version', 'The project file is replaced by the Obsidian note, after a verified backup.'], ['skip', 'Leave both as they are', 'Nothing is written. The conflict shows again next time.']];
  return `<section class="card syn-sec" id="syn-cfl"><div class="card-h"><h2>Conflicts · ${C.length}</h2><div class="end"><span class="chip est">NEVER AUTOMATIC</span></div></div>
    <div class="syn-cfl"><div class="syn-cl" role="listbox" aria-label="Conflicts">${C.map(i => `<button type="button" class="syn-ci${i.note === s.sel ? ' on' : ''}" data-sel="${esc(i.note)}" role="option" aria-selected="${i.note === s.sel}"><b>${esc(i.note)}</b><small>${esc(i.kind)}</small>${s.choice[i.note] ? `<small class="ch">✓ ${esc(CH[s.choice[i.note]])}</small>` : '<small>no choice yet</small>'}</button>`).join('')}</div>
    <div class="syn-sec"><p class="syn-note">${esc(KIND[it.kind])} ${d.base ? 'Red = lines only in this version, green = lines only in the other version.' : 'There is no last synced copy for this note.'}</p>
      <div class="syn-diff"><div class="syn-pane"><h4>Project file<span>${esc(it.src)}</span></h4>${pre(l, 'del')}</div><div class="syn-pane"><h4>${it.kind === 'duplicate-content' ? 'Existing note “' + esc(d.twinNote) + '”' : 'Obsidian note'}<span>${esc(it.kind === 'duplicate-content' ? d.twinNote : it.note)}.md</span></h4>${pre(r, 'add')}</div></div>
      ${d.base ? `<details><summary class="syn-note">Last synced copy (ancestor)</summary><div class="syn-pane">${pre(d.base.split('\n').map(t => [t, 0]), '')}</div></details>` : ''}
      <div class="syn-res" role="radiogroup" aria-label="Resolve ${esc(it.note)}">${opts.map(([v, t, x]) => `<label${ch === v ? ' class="on"' : ''}><input type="radio" name="res" value="${v}"${ch === v ? ' checked' : ''}><span>${esc(t)}<small>${esc(x)}</small></span></label>`).join('')}</div>
      <p class="syn-note">Choosing only marks the note for the next sync. Before anything is written, every version is copied to &lt;NEXUS data&gt;\\backups\\sync-conflicts.</p></div></div></section>`;
}

function historyCard(p, s) {
  const H = [...s.hist, ...p.history];
  return `<section class="card syn-sec" id="syn-hist"><div class="card-h"><h2>Sync history</h2><div class="end"><span class="syn-note">This project only · last 200 runs kept</span></div></div>
    ${H.length ? `<div class="tbl-wrap"><table class="tbl syn-tbl"><thead><tr><th><button type="button">When</button></th><th><button type="button">Started by</button></th><th><button type="button">Result</button></th><th><button type="button">Created / updated / unchanged / conflicts</button></th><th><button type="button">Backup</button></th></tr></thead><tbody>
    ${H.map(h => `<tr><td class="syn-ac">${esc(h.at)}${h.sim ? ' <span class="chip demo">SIMULATED</span>' : ''}</td><td>${esc(h.by)}</td><td><span class="syn-a ${h.res === 'ok' ? 'update' : 'conflict'}">${h.res === 'ok' ? 'OK' : h.res === 'manual' ? 'Stopped' : 'Partial'}</span>${h.note ? `<div class="syn-why">${esc(h.note)}</div>` : ''}</td>
      <td class="mono">${[h.c.create, h.c.update, h.c.same, h.c.conflict].join(' / ')}</td><td class="syn-path">${esc(h.backup)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="syn-empty">No syncs yet for ${esc(p.name)}.${p.first ? ' The first sync is preview-only until you confirm it.' : ''}</div>`}</section>`;
}

function draw() {
  const p = DATA[cur], s = st(cur);
  $('syn').innerHTML = `<div class="syn-top"><h1>KNOWLEDGE · SYNC &amp; GRAPH</h1>
      <label class="syn-note">Project <select class="btn sm" id="syn-p">${Object.entries(DATA).map(([k, x]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>
    <div class="syn-ban" role="note"><b>PREVIEW</b><span>Checkpoint (c): sync is disabled. Isolated sample data only: nothing is read from or written to your projects, vaults, Graphify or Claude Code files.</span></div>
    <div class="syn-row">${settingsCard(p, s)}${graphCard(p, s)}</div>
    ${previewCard(p, s)}${conflictCard(p, s)}${historyCard(p, s)}
    <p class="syn-msg" role="status" id="syn-msg">${esc(s.msg)}</p>`;
  s.msg = '';
}
function project(id) { if (!DATA[id]) return; cur = id; history.replaceState(null, '', location.pathname + '?p=' + id); draw() }
const say = t => { st(cur).msg = t; draw() };

document.addEventListener('change', e => { const t = e.target, s = st(cur);
  if (t.id === 'syn-p') return project(t.value);
  if (t.name === 'mode') { s.sync.mode = t.value; draw() }
  else if (t.name === 'graph') { s.graph = t.value; draw() }
  else if (t.name === 'res') { s.choice[s.sel] = t.value; draw() }
  else if (t.name === 'cmd') s.sync.cmd = t.value });
document.addEventListener('click', e => { const s = st(cur), p = DATA[cur];
  const f = e.target.closest('[data-f]')?.dataset.f; if (f) { s.filter = s.filter === f ? 'all' : f; return draw() }
  const sel = e.target.closest('[data-sel]')?.dataset.sel; if (sel) { s.sel = sel; return draw() }
  const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
  if (a === 'save') say('Preview: nothing saved. The real button saves only NEXUS’s own project list, after a backup.');
  if (a === 'rebuild') say('Preview: no graph built. The real button rebuilds the built-in graph from metadata in a few seconds.');
  if (a === 'sim') { const c = counts(p), C = conflicts(p), done = C.filter(i => s.choice[i.note] && s.choice[i.note] !== 'skip').length, left = C.length - done;
    s.hist.unshift({ sim: 1, at: new Date().toISOString().slice(0, 16).replace('T', ' '), by: 'You (simulated)', res: left ? 'partial' : 'ok', c: { create: c.create, update: c.update + done, same: c.same, conflict: left },
      backup: c.update + done ? 'would be: backups\\sync-<time>' : 'none needed', note: left ? left + ' conflict(s) left unresolved: nothing would be written for them.' : '' });
    say('Simulated only: no file was read or written.') } });
window.SX = { project, cur: () => cur, state: id => st(id || cur), data: Object.keys(DATA), names: id => [DATA[id].name, ...DATA[id].items.map(i => i.note), ...Object.keys(DATA[id].conflicts)] };
draw();
