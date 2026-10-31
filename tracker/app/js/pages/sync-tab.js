// Knowledge page → Sync tab (M3 gates d + e1, spec §26.7): the approved gate (c) panels on GET /api/sync (syncview.js). Writes only on a confirmed
// Sync now (POST /api/sync/run with the preview's one-time token) or a confirmed mode / engine change (POST /api/sync/engine). Automatic stays locked.
// One project at a time: data, choices and diffs are kept per project id and only the selected project's are ever drawn.
import { esc } from '../fmt.js';
import { more as lm } from '../ui.js';

const GROUP = { 'create-vault': 'create', push: 'update', pull: 'update', merge: 'update', same: 'same', conflict: 'conflict', refused: 'refused', none: 'same' };
const DIR = { 'create-vault': 'Project → Vault', push: 'Project → Vault', pull: 'Vault → Project', merge: 'Project ⇄ Vault', same: 'no change', none: 'no change', conflict: 'waits for you', refused: 'not touched' };
const BACKUP = { 'create-vault': ['New note: nothing to back up', 0], push: ['Vault note backed up first', 1], pull: ['Project file backed up first', 1], merge: ['Both files backed up first', 1],
  same: ['Not touched', 0], none: ['Not touched', 0], conflict: ['Every version copied to sync-conflicts before your choice is applied', 1], refused: ['Not touched', 0] };
const WHY = { 'create-vault': 'New note in the vault, copied from the project file.', push: 'Changed in the project since the last sync; the vault note gets the new text.',
  pull: 'Changed in Obsidian since the last sync; the project file gets the new text.', merge: 'Both sides changed different lines; both edits are kept in one file.', same: 'Both sides already match.' };
const KIND = { 'same-lines': 'The same lines were changed in the project and in Obsidian.', 'first-sync': 'First sync and the two versions differ: there is no last synced copy to tell which side is newer.',
  'duplicate-content': 'The vault already has this exact text under another name; creating the note would make a duplicate.', 'base-damaged': 'The last synced copy is missing or damaged, so NEXUS cannot tell which side changed.',
  format: 'Both sides changed and their encoding or line endings differ.', 'missing-project': 'The project file is missing; NEXUS never deletes.', duplicate: 'Two project files map to the same note.' };
const LEGEND = [['create', 'Create', 'A new note is added to the vault from a project file. Nothing existing is changed.'],
  ['update', 'Update', 'One side changed since the last sync: the other side gets the new text after a verified backup. Changes on both sides in different lines are merged.'],
  ['same', 'Unchanged', 'Both sides match. Nothing is written.'],
  ['conflict', 'Conflict', 'NEXUS cannot safely decide. Nothing is written until you pick a version; it never overwrites on its own.'],
  ['refused', 'Refused', 'Outside the allowed folders (symlink, junction, Obsidian or Graphify files, another user). Never touched.']];
const MODES = [['off', 'Off'], ['manual', 'Manual'], ['auto', 'Automatic']];
const MODE_TXT = { off: 'Sync is off for this project. The preview below is for information only.',
  manual: 'Sync runs only when you press Sync now and confirm the list.',
  auto: 'Automatic is locked until a first real manual sync has been approved and completed.' };
const ENG = [['builtin', 'Built-in (NEXUS)'], ['command', 'Own command']];
const ENG_TXT = { builtin: 'NEXUS syncs this project itself from this tab (preview → confirm → backup → write).', command: 'Sync All runs your own command; this tab only previews.' };
const CH = { project: 'keep the project version', vault: 'keep the Obsidian version', skip: 'leave both as they are' };

let list = null, listErr = null, cur = null, redraw = () => { };
const D = {}, S = {}, X = {}; // per project id: /api/sync answer, UI state, conflict texts
const st = id => S[id] ||= { filter: 'all', sel: null, choice: {}, msg: '' };

// D3 B96/B97: plain sentences instead of raw fetch errors and tracker codes
const NET = 'Tracker not reachable, so nothing was changed. Start it with node ~/.claude/token-tracker/tracker.js serve, then try again.';
const why = r => /^(HTTP \d+|bad request|unknown op|unknown action)$/.test(r || '') ? 'The tracker did not accept this request, so nothing was changed. Press Refresh, then try again.' : r;
async function get(u) {
  let r; try { r = await fetch(u, { cache: 'no-store' }); } catch { throw new Error('Tracker not reachable. Start it with node ~/.claude/token-tracker/tracker.js serve, then press Refresh.'); }
  if (!/json/.test(r.headers.get('content-type') || '')) throw Object.assign(new Error('restart'), { restart: true }); // route not in the running tracker yet
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(why(j.res || 'HTTP ' + r.status)); return j;
}
function loadList() {
  list = []; get('/api/projects').then(j => { list = j.items.map(x => ({ id: x.id, name: x.name })); cur = list.some(x => x.id === j.active) ? j.active : list[0]?.id || null; load(cur) },
    e => { listErr = e.message; redraw() });
}
function load(id, force) {
  if (!id || (D[id] && !force)) return redraw();
  D[id] = { loading: true }; delete X[id]; redraw();
  get('/api/sync?id=' + encodeURIComponent(id)).then(j => { D[id] = j }, e => { D[id] = { err: e.restart ? 'restart' : e.message } }).finally(() => { if (id === cur) redraw() });
}
function loadDiff(id, note) {
  const k = (X[id] ||= {}); if (k[note]) return;
  k[note] = { loading: true }; get('/api/sync/diff?id=' + encodeURIComponent(id) + '&note=' + encodeURIComponent(note)).then(j => { k[note] = j }, e => { k[note] = { err: e.message } }).finally(() => { if (id === cur) redraw() });
}

// line diff (LCS): marks lines only on one side
function diff(a, b) {
  const x = a.split('\n'), y = b.split('\n'), n = x.length, m = y.length;
  if (n * m > 4e6) return [x.map(t => [t, 0]), y.map(t => [t, 0])]; // ponytail: huge notes shown without marks
  const T = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i][j] = x[i] === y[j] ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
  const A = new Set(), B = new Set(); let i = 0, j = 0;
  while (i < n && j < m) { if (x[i] === y[j]) { i++; j++ } else if (T[i + 1][j] >= T[i][j + 1]) A.add(i++); else B.add(j++) }
  while (i < n) A.add(i++); while (j < m) B.add(j++);
  return [x.map((t, k) => [t, A.has(k)]), y.map((t, k) => [t, B.has(k)])];
}
const pre = (rows, cls) => `<pre>${rows.map(([t, d], k) => `<div data-n="${k + 1}"${d ? ` class="${cls}"` : ''}>${esc(t)}</div>`).join('')}</pre>`;
const seg = (name, val, opts, dis) => `<div class="lk-seg" role="radiogroup">${opts.map(([v, t]) => `<label${v === val ? ' class="on"' : ''}><input type="radio" name="${name}" value="${v}"${v === val ? ' checked' : ''}${dis.includes(v) ? ' disabled' : ''}>${t}</label>`).join('')}</div>`;
const when = t => new Date(t).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const card = (id, h, body, end = '') => `<section class="card syn-sec" id="${id}"><div class="card-h"><h2>${h}</h2>${end ? `<div class="end">${end}</div>` : ''}</div>${body}</section>`;

function settingsCard(p) {
  if (!p.vault) return card('syn-set', 'Sync settings', `<p class="syn-note">Link a vault to ${esc(p.name)} on the Projects page first. Until then there is nothing to sync.</p>`);
  const m = p.sync.mode, msg = st(p.id).msg;
  return card('syn-set', 'Sync settings', `${seg('sy-mode', m, MODES, ['auto'])}
    <p class="syn-note">${esc(MODE_TXT[m] || '')}</p>
    ${p.sync.cmd ? `${seg('sy-eng', p.engine, ENG, [])}<p class="syn-note">${esc(ENG_TXT[p.engine])}</p>` : ''}${msg ? `<p class="syn-note warn" id="sy-msg">${esc(msg)}</p>` : ''}
    <dl class="syn-kv"><dt>Project folder</dt><dd class="syn-path">${esc(p.dir)}</dd><dt>Vault folder</dt><dd class="syn-path">${esc(p.plan?.vaultFolder || p.vault)}</dd>
      ${p.sync.cmd ? `<dt>Sync All runs</dt><dd class="syn-path">${esc(p.sync.cmd)}</dd>` : ''}<dt>File pairs</dt><dd>${esc(p.mapping)}</dd>
      <dt>Last synced copy</dt><dd>${esc(p.plan?.ancestor || '—')}</dd>
      <dt>Safety</dt><dd>Verified backup before every write · atomic writes · encoding and line endings kept · never deletes · one sync at a time</dd></dl>
    <p class="syn-note warn">Changing a setting asks first and backs up the project list. Automatic stays locked until a first real manual sync is approved and completed.</p>`,
    `<span class="chip ${m === 'off' ? 'unk' : 'live'}">${esc((MODES.find(x => x[0] === m) || ['', m])[1].toUpperCase())}</span>`);
}

function graphCard(p) {
  if (!p.vault) return card('syn-graph', 'Knowledge graph', `<span class="syn-src none" data-src="none"><i></i>No graph</span><p class="syn-note">No Obsidian vault is linked to ${esc(p.name)}, so there is no graph.</p>`);
  const g = p.graph, src = g.source === 'graphify' ? 'graphify' : g.fallback ? 'fallback' : 'builtin';
  const badge = { graphify: 'Using Graphify', builtin: 'Using built-in graph', fallback: 'Using built-in graph (Graphify not found)' }[src];
  return card('syn-graph', 'Knowledge graph', `<dl class="syn-kv">
      <dt>Chosen</dt><dd>${g.mode === 'graphify' ? 'Graphify (NEXUS only reads its output)' : 'Built-in (no extra installs)'}</dd>
      ${src === 'graphify' ? `<dt>Graphify output</dt><dd class="syn-path">${esc(g.file)}</dd><dt>Nodes / links</dt><dd>${g.stats ? g.stats.nodes.toLocaleString() + ' / ' + g.stats.links.toLocaleString() : '—'}</dd><dt>Last built</dt><dd>${g.stats ? esc(when(g.stats.at)) : '—'}</dd>` : ''}
      ${src === 'fallback' ? `<dt>Notice</dt><dd class="syn-note warn">${esc(g.notice)}</dd>` : ''}
      ${src !== 'graphify' ? `<dt>Built-in graph</dt><dd>The Graph View tab builds it from the vault with Graphify’s vault rules (same node ids). Saved copies keep metadata only, no note text.</dd>` : ''}
      <dt>Graph View</dt><dd>${src === 'graphify' ? 'Shows the vault graph with Graphify’s communities on top. Graphify and sync_docs.sh are unchanged.' : 'Shows the built-in graph.'}</dd></dl>`,
    `<span class="syn-src ${src}" data-src="${src}"><i></i>${badge}</span>`);
}

function previewCard(p, s) {
  if (!p.vault) return card('syn-prev', 'Sync preview', '<div class="syn-empty">No vault linked: nothing to compare.</div>');
  if (!p.plan) return card('syn-prev', 'Sync preview', `<div class="syn-empty">${esc(p.why || 'No preview.')}</div>`);
  const c = { create: 0, update: 0, same: 0, conflict: 0, refused: 0 }; for (const i of p.plan.items) c[GROUP[i.action]]++;
  const rows = p.plan.items.filter(i => s.filter === 'all' || GROUP[i.action] === s.filter), vt = i => i.vault || '', pj = i => i.project || i.src || '';
  const kp = [['create', 'Create'], ['update', 'Update'], ['same', 'Unchanged'], ['conflict', 'Conflicts'], ['refused', 'Refused']];
  return card('syn-prev', 'Sync preview' + (p.plan.first ? ' · first sync' : ''), `
    ${p.plan.first ? '<p class="syn-note warn">First sync of this project: nothing would be written until you confirm this list and choose a version for each conflict.</p>' : ''}
    <div class="syn-kpis">${kp.map(([k, t]) => `<button type="button" class="syn-kpi${s.filter === k ? ' on' : ''}" data-sf="${k}" aria-pressed="${s.filter === k}"><b>${c[k]}</b><span>${t}</span></button>`).join('')}</div>
    <div class="tbl-wrap"><table class="tbl syn-tbl"><thead><tr><th>Action</th><th>Note</th><th>Source → destination</th><th>Direction</th><th>Backup</th></tr></thead>
    <tbody>${rows.map(i => { const g = GROUP[i.action], [bk, y] = BACKUP[i.action] || BACKUP.same, ch = s.choice[i.note];
      const from = i.action === 'pull' ? vt(i) : pj(i), to = i.action === 'pull' ? pj(i) : vt(i);
      return `<tr data-note="${esc(i.note)}"><td class="syn-ac"><span class="syn-a ${g}">${esc({ create: 'Create', update: i.action === 'merge' ? 'Merge' : 'Update', same: 'Unchanged', conflict: 'Conflict', refused: 'Refused' }[g])}</span></td>
        <td><b>${esc(i.note)}</b><div class="syn-why">${esc(i.action === 'conflict' ? (KIND[i.kind] || '') + ' ' + (i.why || '') : i.why || WHY[i.action] || '')}${ch ? ` <span class="ch">· your choice: ${esc(CH[ch])}</span>` : ''}</div></td>
        <td><div class="syn-path">${esc(from)}</div><div class="syn-path">→ ${esc(to)}</div></td><td class="syn-dir">${esc(DIR[i.action] || '')}</td><td class="syn-bk${y ? ' y' : ''}">${esc(bk)}</td></tr>` }).join('') || '<tr><td colspan="5"><div class="syn-empty">Nothing in this group.</div></td></tr>'}</tbody></table></div>
    <ul class="syn-legend">${LEGEND.map(([k, t, d]) => `<li><span class="syn-a ${k}">${t}</span>${esc(d)}</li>`).join('')}</ul>
    <div class="syn-acts"><button class="btn pri" type="button" data-sy="run"${p.token ? '' : ` disabled data-tip="${esc(p.runWhy || 'Refresh the preview first.')}"`}>Sync now</button><button class="btn" type="button" data-sy="refresh">Refresh preview</button>
      <span class="syn-note">${p.token ? 'Nothing is written until you confirm the list. Files changed after this preview are skipped.' : esc(p.runWhy || '') + ' This list is read only.'}</span></div>`,
    `<span class="syn-note">Checked ${esc(when(p.plan.at))}</span>`);
}

function conflictCard(p, s) {
  const C = (p.plan?.items || []).filter(i => i.action === 'conflict');
  if (!C.length) return card('syn-cfl', 'Conflicts', `<div class="syn-empty">${p.vault ? 'No conflicts in this preview.' : 'No vault linked.'}</div>`);
  if (!C.some(i => i.note === s.sel)) s.sel = C[0].note;
  const it = C.find(i => i.note === s.sel), d = X[p.id]?.[it.note], ch = s.choice[it.note] || ''; if (!d && it.src) loadDiff(p.id, it.note);
  const dup = it.kind === 'duplicate-content', right = dup ? d?.twinText : d?.vault;
  const opts = dup ? [['skip', 'Leave it', `Do not create “${it.note}”. The existing note stays as it is.`], ['project', 'Create it anyway', 'Adds a second note with the same text. Usually not what you want.']]
    : [['project', 'Keep the project version', 'The Obsidian note would be replaced by the project file, after a verified backup.'], ['vault', 'Keep the Obsidian version', 'The project file would be replaced by the Obsidian note, after a verified backup.'], ['skip', 'Leave both as they are', 'Nothing is written. The conflict shows again next time.']];
  const body = !it.src ? `<p class="syn-note">${esc(it.why || '')}</p>` : !d || d.loading ? '<div class="syn-empty">Reading both versions…</div>' : d.err ? `<div class="syn-empty">${esc(d.err)}</div>`
    : (() => { const [l, r] = diff(d.project ?? '', right ?? ''); return `<div class="syn-diff"><div class="syn-pane"><h4>Project file<span>${esc(it.src)}</span></h4>${pre(l, 'del')}</div><div class="syn-pane"><h4>${dup ? 'Existing note “' + esc(d.twin || '') + '”' : 'Obsidian note'}<span>${esc(dup ? d.twin : it.note)}.md</span></h4>${pre(r, 'add')}</div></div>
      ${d.base != null ? `<details><summary class="syn-note">Last synced copy (ancestor)</summary><div class="syn-pane">${pre(d.base.split('\n').map(t => [t, 0]), '')}</div></details>` : ''}` })();
  return card('syn-cfl', 'Conflicts · ' + C.length, `<div class="syn-cfl"><div class="syn-cl" role="listbox" aria-label="Conflicts">${C.map(i => `<button type="button" class="syn-ci${i.note === s.sel ? ' on' : ''}" data-ssel="${esc(i.note)}" role="option" aria-selected="${i.note === s.sel}"><b>${esc(i.note)}</b><small>${esc(i.kind || '')}</small>${s.choice[i.note] ? `<small class="ch">✓ ${esc(CH[s.choice[i.note]])}</small>` : '<small>no choice yet</small>'}</button>`).join('')}</div>
    <div class="syn-sec"><p class="syn-note">${esc(KIND[it.kind] || '')} Red = lines only in this version, green = lines only in the other version.</p>${body}
      <div class="syn-res" role="radiogroup" aria-label="Resolve ${esc(it.note)}">${opts.map(([v, t, x]) => `<label${ch === v ? ' class="on"' : ''}><input type="radio" name="sy-res" value="${v}"${ch === v ? ' checked' : ''}><span>${esc(t)}<small>${esc(x)}</small></span></label>`).join('')}</div>
      <p class="syn-note">Your choice is applied only when you press Sync now and confirm, after a verified backup. Without a choice the conflict stays untouched.</p></div></div>`,
    '<span class="chip est">NEVER AUTOMATIC</span>');
}

function historyCard(p) {
  const H = p.history || [];
  return card('syn-hist', 'Sync history', H.length ? `<div class="tbl-wrap"><table class="tbl syn-tbl"><thead><tr><th>When</th><th>Started by</th><th>Result</th><th>Created / updated / merged / recorded / conflicts</th><th>Refused</th></tr></thead><tbody>
    ${H.map(h => `<tr><td class="syn-ac">${esc(when(h.at))}</td><td>${esc(h.mode)}</td><td><span class="syn-a ${h.conflicts ? 'conflict' : 'update'}">${h.conflicts ? 'Partial' : 'OK'}</span></td>
      <td class="mono">${[h.created, h.pushed + h.pulled, h.merged, h.recorded ?? 0, h.conflicts].join(' / ')}</td><td class="mono">${h.refused}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="syn-empty">No NEXUS syncs yet for ${esc(p.name)}. Sync All (your own command) keeps its own record.</div>`, '<span class="syn-note">This project only · last 200 runs kept</span>');
}

export function syncTab(onDraw) {
  redraw = onDraw; if (!list) loadList();
  const sel = list?.length ? `<label class="syn-note">Project <select class="btn sm" id="sy-p">${list.map(x => `<option value="${esc(x.id)}"${x.id === cur ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : '';
  const p = D[cur], top = `<div class="syn-top"><h2 class="syn-h">Sync &amp; graph</h2>${lm('kg-synctab', 'Sync tab')}${sel}<button class="btn sm" type="button" data-sy="refresh"${p?.loading ? ' disabled' : ''}>Refresh</button></div>
    <div class="syn-ban" role="note"><b>${p?.token ? 'MANUAL' : 'READ ONLY'}</b><span>Computed from your real project and vault, one project at a time. Nothing is written until you press Sync now and confirm the list (verified backup first, never deletes). Automatic stays locked; Sync All (sync_docs.sh) is unchanged.</span></div>`;
  const body = listErr ? `<div class="syn-empty">Could not read the project list: ${esc(listErr)}</div>` : !cur || !p || p.loading ? '<div class="syn-empty">Reading this project’s files…</div>'
    : p.err === 'restart' ? '<div class="syn-empty" id="sy-restart">The running tracker does not have the Sync tab’s read-only route yet. It loads after the next approved tracker restart.</div>'
    : p.err ? `<div class="syn-empty">${esc(p.err)}</div>`
    : `<div class="syn-row">${settingsCard(p)}${graphCard(p)}</div>${previewCard(p, st(cur))}${conflictCard(p, st(cur))}${historyCard(p)}`;
  return `<section class="syn full enter" id="k-sync" data-project="${esc(cur || '')}">${top}${body}</section>`;
}

export function syncOn(e) {
  const t = e.target; if (!t.closest?.('#k-sync')) return;
  if (e.type === 'change') {
    if (t.id === 'sy-p') { cur = t.value; return load(cur) }
    if (t.name === 'sy-res') { st(cur).choice[st(cur).sel] = t.value; return redraw() }
    if (t.name === 'sy-mode' || t.name === 'sy-eng') return setEngine(t);
    return;
  }
  const s = st(cur), f = t.closest('[data-sf]')?.dataset.sf; if (f) { s.filter = s.filter === f ? 'all' : f; return redraw() }
  const sel = t.closest('[data-ssel]')?.dataset.ssel; if (sel) { s.sel = sel; return redraw() }
  const a = t.closest('[data-sy]')?.dataset.sy; if (a === 'refresh') load(cur, true); if (a === 'run') confirmRun();
}
// ---------- writes (gate e1): always a confirm dialog first ----------
function dlg(h) {
  let d = document.getElementById('sy-dlg'); if (!d) { d = document.createElement('dialog'); d.className = 'lx-dlg'; d.id = 'sy-dlg'; d.setAttribute('aria-labelledby', 'sy-dlg-t'); document.body.append(d) }
  d.innerHTML = `<form method="dialog" class="lx-f syn">${h}</form>`; d.returnValue = ''; if (!d.open) d.showModal(); return d;
}
const ask = (title, body, ok) => new Promise(res => { const d = dlg(`<div class="card-h"><h2 id="sy-dlg-t">${esc(title)}</h2></div>${body}<div class="lx-fa"><button class="btn ghost" value="x">Cancel</button><button class="btn pri" value="ok">${esc(ok)}</button></div>`);
  d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true }) });
async function post(u, b) {
  let r; try { r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); } catch { return { res: NET }; } // B97: was an unhandled rejection
  if (!/json/.test(r.headers.get('content-type') || '')) return { res: 'The running tracker does not have this yet. It works after the next approved tracker restart.' };
  const j = await r.json().catch(() => ({ res: 'HTTP ' + r.status })); return { ...j, res: why(j.res) };
}
async function setEngine(t) {
  const id = cur, p = D[id], s = st(id), mode = t.name === 'sy-mode' ? t.value : p.sync.mode, engine = t.name === 'sy-eng' ? t.value : p.engine;
  const go = await ask('Change sync settings?', `<p class="kg-ask">${esc(p.name)}: mode <b>${esc(mode)}</b>, engine <b>${esc((ENG.find(x => x[0] === engine) || [])[1] || engine)}</b>.</p><p class="syn-note">${esc(ENG_TXT[engine])} The project list is backed up first. Nothing is synced by this change.</p>`, 'Save setting');
  if (!go) return redraw(); // radios back to the saved values
  const r = await post('/api/sync/engine', { id, mode, engine }); s.msg = r.res === 'ok' ? '' : r.res; load(id, true);
}
const WRITE = { push: ['Project → Vault', 'vault note backed up first'], pull: ['Vault → Project', 'project file backed up first'], merge: ['Project ⇄ Vault', 'both files backed up first'], 'create-vault': ['Project → Vault', 'new note'] };
async function confirmRun() {
  const id = cur, p = D[id], s = st(id); if (!p?.token) return;
  const I = p.plan.items, rows = [], rec = I.filter(i => i.record).length, left = [];
  for (const i of I) {
    if (WRITE[i.action]) rows.push([i.note, ...WRITE[i.action]]);
    else if (i.action === 'conflict') { const c = s.choice[i.note]; if (c === 'project' || c === 'vault') rows.push([i.note, c === 'project' ? 'Project → Vault' : 'Vault → Project', 'every version copied first']); else left.push(i.note) }
  }
  const n = rows.length, body = `<p class="kg-ask">${esc(p.name)}: ${n ? n + ' file' + (n === 1 ? '' : 's') + ' will be written' : 'no project or vault file will be written'}.</p>
    ${n ? `<div class="tbl-wrap"><table class="tbl syn-tbl" id="sy-writes"><thead><tr><th>Note</th><th>Direction</th><th>Backup</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${esc(r[0])}</b></td><td class="syn-dir">${esc(r[1])}</td><td class="syn-bk y">${esc(r[2])}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${rec ? `<p class="syn-note">${rec} matching pair${rec === 1 ? '' : 's'} recorded as the last synced copy, in your NEXUS data folder only (not in the project or the vault).</p>` : ''}
    ${left.length ? `<p class="syn-note warn">Left untouched (no choice, or "leave"): ${left.map(esc).join(', ')}.</p>` : ''}
    <p class="syn-note">Backups go to your NEXUS data folder. Files changed after this preview are skipped. Nothing is deleted.</p>`;
  if (!await ask('Sync now?', body, n ? 'Sync ' + n + ' file' + (n === 1 ? '' : 's') : 'Record and finish')) return;
  const r = await post('/api/sync/run', { id, token: p.token, choices: s.choice, confirm: true }), R = r.result;
  dlg(`<div class="card-h"><h2 id="sy-dlg-t">${r.res === 'ok' ? 'Sync finished' : 'Not synced'}</h2></div>${r.res !== 'ok' ? `<p class="kg-ask" id="sy-res">${esc(r.res)}</p>` : `<dl class="syn-kv" id="sy-res">
    ${[['Created', R.created], ['Project → Vault', R.pushed], ['Vault → Project', R.pulled], ['Merged', R.merged], ['Recorded', R.recorded], ['Conflicts left', R.conflicts.map(c => c.note)], ['Left by you', R.skipped.map(c => c.note)], ['Changed since the preview (skipped)', R.changed], ['Refused', R.refused]]
      .map(([k, v]) => `<dt>${k}</dt><dd>${v.length}${v.length ? ': ' + v.map(esc).join(', ') : ''}</dd>`).join('')}
    <dt>Backup</dt><dd class="syn-path">${esc(R.backup || 'nothing was overwritten')}</dd></dl>`}<div class="lx-fa"><button class="btn pri" value="x">Close</button></div>`);
  if (r.res === 'ok') s.choice = {}; load(id, true);
}
export const syncDebug = () => ({ cur, ids: list?.map(x => x.id) || [], data: D, state: S, texts: X }); // tests
