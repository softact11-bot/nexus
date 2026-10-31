// Obsidian & Graphify: the vault, its Graphify knowledge graph (3D) and quick note tools. Data: tracker /api/vault (status, notes,
// search, writes) and /api/graph/live (SSE: one snapshot, then patches when a vault note, graph.json, the project docs, a skill or
// projects.json changes; nothing polls). The graph uses Graphify's rules (knowledge.js), so ids match graph.json; communities come
// from graph.json. Writes: new notes/folders/daily notes/templates, and edits to notes NOT synced from the active project, each after
// a confirm (edits show a diff first, the old file is backed up). Sync All runs sync_docs.sh after a confirm and never resolves conflicts.
import { esc, ago, bytes, chip } from '../fmt.js';
import { icon, seg, stateBox, toast, download, ring, setRing, MORE, more as lm, errBox } from '../ui.js';
import { play } from '../sound.js';
import * as P from '../settings.js';
import { syncTab, syncOn } from './sync-tab.js'; // M3 gate (d) Sync tab: read-only

const TABS = [['overview', 'Overview'], ['notes', 'Notes'], ['graph', 'Graph View'], ['tags', 'Tags'], ['backlinks', 'Backlinks'], ['search', 'Search'], ['templates', 'Templates'], ['daily', 'Daily Notes'], ['analytics', 'Analytics'], ['export', 'Export'], ['sync', 'Sync']];
const FILTERS = [['all', 'All'], ['projects', 'Projects'], ['claude', 'Claude Code'], ['plugins', 'Plugins'], ['assets', 'Assets'], ['refs', 'References'], ['orphans', 'Orphans']];
const FF = { all: null, projects: n => n.k === 'roblox' || n.o === 'nexus' || n.t === 'project', claude: n => n.k === 'claude', plugins: n => n.k === 'plugins', assets: n => n.k === 'blender', refs: n => n.k === 'refs', orphans: n => n.id.startsWith('note_') && !n.rdeg };
const RANGES = [['7', '7D'], ['30', '30D'], ['90', '90D'], ['365', '1Y'], ['all', 'All']];
const TAGC = ['#31D67A', '#A26BFF', '#3D8BFF', '#FF8A3D', '#FFC23D', '#FF4D6A', '#2EE6D6', '#F25FD0', '#9BE15D', '#5AB8F2', '#C9A0FF', '#F2B544'];
const REL = { references: 'links', mentions: 'mentions (inferred)', contains: 'contains', tagged: 'tagged', provides: 'provides', documented_in: 'documented in', defines: 'defines' };

let perfT = 0, root, st = null, err = null, snap = null, G = null, gbox = null, gInit = false, det = null, detErr = null, edit = null, syncS = null, tick = 0;
const live = { es: null, v: 0, at: 0, ok: false, warn: null, retry: 0, t: null, wait: 0 };
let ui = { col: {}, pw: { ex: 300, rn: 320, gh: P.pref('obs.height') }, tab: P.pref('obs.tab'), filter: 'all', dim: P.pref('obs.view'), mode: P.pref('obs.mode'), range: '30', open: { '': 1 }, note: null, tag: null, q: '' };
try { Object.assign(ui, JSON.parse(localStorage.getItem('jv.kg') || '{}'), { q: '' }); if (ui.pw?.gh === 468) ui.pw.gh = 540; if (!ui.m2) { ui.mode = P.pref('obs.mode'); ui.m2 = 1; } } catch { } // 468 = old default: move to the new one, keep custom heights
const activity = [], recentRel = []; // this session only: live patches, sync runs and links added while the page was open
addEventListener('nexus:saved', e => { const k = e.detail; if (k.includes('obs.mode')) ui.mode = P.pref('obs.mode'); if (k.includes('obs.view')) ui.dim = P.pref('obs.view'); if (k.includes('obs.tab')) ui.tab = P.pref('obs.tab'); if (k.includes('obs.height')) ui.pw.gh = P.pref('obs.height'); if (k.includes('obs.live') && root) { live.v = -1; connect(); } }); // obs.live: a fresh snapshot, so live off applies at once
const keep = () => { try { localStorage.setItem('jv.kg', JSON.stringify({ ...ui, q: '' })); } catch { } };
const $ = id => document.getElementById(id);
const base = p => p.split('/').pop().replace(/\.md$/i, ''), dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const day = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const when = t => { const d = new Date(t), n = new Date(); if (d.toDateString() === n.toDateString()) return 'Today ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  n.setDate(n.getDate() - 1); return d.toDateString() === n.toDateString() ? 'Yesterday ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : day(t) };
const n0 = n => n == null ? '—' : Number(n).toLocaleString();
// Settings → Obsidian: optionally count the auto-generated Knowledge Graph note's links in Graph Health (kgLinks = [resolved, unresolved])
const gq = S => { const g = S.graph || {}, k = g.kgLinks; if (!P.pref('obs.kgHealth') || !k) return g; const r = (g.resolved || 0) + k[0], u = (g.unresolved || 0) + k[1]; return { ...g, resolved: r, unresolved: u, health: r + u ? Math.round(r / (r + u) * 1000) / 10 : null }; };
const kgTxt = () => P.pref('obs.kgHealth') ? 'including the auto-generated Knowledge Graph note (Settings)' : 'excluding the auto-generated Knowledge Graph note';
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
// D3: down = the live stream is lost (not when Settings turned it off) or a request could not reach the tracker. Recovery rides on the stream's own reconnect.
let netDown = false, down = false;
const NET = 'Tracker not reachable', OFF = 'The tracker is not reachable. This works again once it reconnects.';
const LOCK = ['sync', 'doSync', 'newNote', 'newFolder', 'daily', 'tplInit', 'edit', 'review', 'doSave', 'doNote', 'doFolder', 'openVault', 'openFolder', 'openGraph', 'obsNote', 'refresh'].map(a => `[data-a="${a}"]`).join(', '); // writes + app launches; browsing is never locked
// B96: a plain sentence instead of a raw tracker code
const why = r => r === NET ? 'Tracker not reachable, so nothing was changed. Start it with node ~/.claude/token-tracker/tracker.js serve, then try again.'
  : /^(HTTP \d+|bad request|unknown op|unknown action)$|JSON|Unexpected token/.test(r || '') ? 'The tracker did not accept this request, so nothing was changed. Press Refresh, then try again.'
  : `${String(r || 'Unknown problem').replace(/^./, c => c.toUpperCase()).replace(/\.$/, '')}. Nothing was changed.`;
const RO = { tokens: 'None: this page uses no AI tokens.', files: 'None: reading only.', privacy: 'Stays on this PC.', load: 'Light: the tracker sends only what changed.' };
Object.assign(MORE, {
  'kg-page': { area: 'Obsidian & Graphify', title: 'What this page does', what: 'Shows your Obsidian vault, the Graphify knowledge graph built from it, and quick note tools. The tracker sends changes here as they happen; nothing polls.',
    when: ['Seeing what is in the vault and how it links together.', 'Creating or editing a note, a folder, a daily note or a template.'], impact: RO, notes: ['Every write (new note, folder, daily note, template, edit, Sync All) asks first.', 'If the tracker is lost, the last data stays on screen and writes are off until it reconnects.'], tech: 'GET /api/vault (status, notes, search), POST /api/vault (writes), SSE /api/graph/live (snapshot, then patches).' },
  'kg-obs': { area: 'Obsidian & Graphify', title: 'Obsidian card', what: 'Notes, Tags, Attachments, Modified Today and Vault Size are counted from the vault folder. Dot folders such as .obsidian are skipped, same as Graphify.',
    when: ['Checking the vault is the right one and is reachable.'], impact: RO, notes: ['Vault connected = the vault folder was found. App running = the Obsidian app was running when the vault was last read.', 'Open Vault and Show in File Explorer launch apps on this PC.'], tech: 'GET /api/vault → vaultOk, obsidian, notes, tags, attachments, modifiedToday, bytes.' },
  'kg-gfy': { area: 'Obsidian & Graphify', title: 'Graphify card', what: 'graph.json is the graph Graphify last built. The page also builds a live graph from the current vault with the same rules, so "N pending" counts what graph.json does not have yet.',
    when: ['Seeing whether graph.json is up to date.'], impact: RO, notes: ['In sync = graph.json matches the live vault exactly.', 'Sync All runs sync_docs.sh, which rebuilds graph.json.', 'Clusters are Graphify communities; Orphans are notes with no link in or out.'], tech: 'graph.drift (newNodes, goneNodes, newLinks, deadLinks), graph.projNewer.' },
  'kg-health': { area: 'Obsidian & Graphify', title: 'Graph Health', what: 'Resolved [[links]] ÷ all [[links]] in vault notes. A link is resolved when it names an existing note or alias.',
    when: ['Finding broken links.'], impact: RO, notes: ['Settings → Obsidian & Graphify decides whether the auto-generated Knowledge Graph note counts.', 'Backlinks → Vault Problems lists every unresolved link and orphan note.', 'The Clusters ring is a count only, not a share.'], tech: 'graph.resolved, graph.unresolved, graph.kgLinks.' },
  'kg-live': { area: 'Obsidian & Graphify', title: 'Live status', what: 'Live = the tracker is connected and sends every change at once. Stale = the connection is down or an update failed; the last good data stays on screen.',
    when: ['Checking whether what you see is current.'], impact: RO, notes: ['NEXUS reconnects on its own after 1, 2, 4 … up to 30 s between tries.', 'Live updates off (Settings) reads the vault once; Refresh reads it again.'], tech: 'SSE /api/graph/live with backoff; warn events from the tracker.' },
  'kg-graph': { area: 'Obsidian & Graphify', title: 'Knowledge Graph', what: 'Every note, tag, skill, plugin and project as a node, linked by [[links]], inferred mentions, folders and tags. 3D or 2D, grouped by NEXUS clusters or Graphify communities.',
    when: ['Exploring how notes connect.', 'Finding orphan or isolated notes.'], impact: { ...RO, load: 'The graph uses the GPU; it pauses on other tabs.' }, notes: ['Keyboard: use Find a node, then Enter. The canvas itself needs a mouse.', 'Focus Mode shows only the graph (Esc leaves). Double-click a cluster, or use – in the legend, to collapse it.'], tech: 'graph3d.js (three.js), filters FF, G.find / G.select.' },
  'kg-stats': { area: 'Obsidian & Graphify', title: 'Vault Statistics', what: 'Notes created, notes modified and attachments added per day or week over the chosen range.',
    when: ['Seeing how active the vault is.'], impact: RO, notes: ['Created = file creation time. Modified = only the last change of each note; older edits are not recorded.', 'A copied or re-synced vault resets creation times.'], tech: 'status.series [birth, mtime], attSeries.' },
  'kg-edit': { area: 'Obsidian & Graphify', title: 'Editing a note here', what: 'Edit opens the note text. Review & Save shows a diff first and saves only after you confirm; the old file is backed up to vault-backups in the NEXUS data folder.',
    when: ['Quick fixes without opening Obsidian.'], impact: { ...RO, files: 'Saving changes this one note, after a backup.' }, notes: ['Notes synced from the project are read-only here: sync_docs.sh would overwrite them.', 'Notes over 2 MB open in Obsidian only.', 'If the tracker is lost, your text stays in the editor and Save waits until it reconnects.'], tech: 'POST /api/vault {op: save, base: hash}.' },
  'kg-sync': { area: 'Obsidian & Graphify', title: 'Sync All', what: 'Runs bash sync_docs.sh in the active project: two-way merge of the project docs and vault notes, then Graphify rebuilds graph.json and the Knowledge Graph note.',
    when: ['After editing docs or notes, to bring both sides and the graph up to date.'], impact: { ...RO, files: 'Writes project docs, vault notes and graph.json (sync_docs.sh).' }, notes: ['If both sides changed the same lines it reports CONFLICT and changes neither file. NEXUS never resolves conflicts.', 'Hide keeps it running. If the tracker is lost mid-run the outcome shows as unknown until it answers.'], tech: 'POST /api/vault {op: sync}; progress on the live stream (sync events).' },
  'kg-tpl': { area: 'Obsidian & Graphify', title: 'Templates and Daily Notes', what: 'Templates live in Templates/ in the vault; {{title}}, {{date}} and {{time}} are filled in. Daily notes are Daily Notes/YYYY-MM-DD.md.',
    when: ['Starting notes with the same layout.', 'Keeping a daily log.'], impact: { ...RO, files: 'Creates new files only; nothing is overwritten.' }, notes: ['The starter set (Note, Asset, Meeting) is added after a confirm.', 'The first daily note creates the Daily Notes folder, after a confirm.'], tech: 'POST /api/vault {op: templatesInit | fromTemplate | daily}.' },
  'kg-prob': { area: 'Obsidian & Graphify', title: 'Vault Problems', what: 'Unresolved links point to no note; orphan notes have no link in or out and no inferred mention.',
    when: ['Cleaning up the vault.'], impact: RO, notes: ['Fix a link by creating the missing note or correcting the [[name]] in Obsidian.', 'Link an orphan from a related note so it joins the graph.'], tech: 'graph.unresolvedList, graph.orphanList.' },
  'kg-exp': { area: 'Obsidian & Graphify', title: 'Export', what: 'Downloads the live graph, notes, tags, unresolved links or vault statistics as JSON or CSV.',
    when: ['Using the data in another tool.'], impact: { ...RO, files: 'A new file in your Downloads folder; nothing in the vault changes.' }, notes: ['The data is what this page shows now, also while the tracker is lost.'], tech: 'Built in the page from the live graph and status.' },
  'kg-synctab': { area: 'Obsidian & Graphify', title: 'Sync tab', what: 'A read-only preview of what a NEXUS sync would do for one project: create, update, merge, conflicts and refused files.',
    when: ['Checking a sync before running it.'], impact: { ...RO, files: 'Only Sync now or a settings change writes, each after a confirm and a backup.' }, notes: ['Automatic stays locked until a first manual sync is approved and completed.', 'Sync All (sync_docs.sh) is not changed by this tab.'], tech: 'GET /api/sync, POST /api/sync/run, POST /api/sync/engine.' },
});

export function mount(el, params = []) {
  root = el; if (TABS.some(t => t[0] === params[0])) ui.tab = params[0];
  el.innerHTML = `<div class="pg kg enter">
  <header class="pg-h" style="--i:0">
    <span class="tile-ic pg-ic">${icon('i-graph')}</span>
    <div class="pg-t"><h1>Obsidian &amp; Graphify</h1><p>Your Obsidian vault and its Graphify knowledge graph, updated live as notes change.</p></div>
    <div class="end">${lm('kg-page', 'Obsidian & Graphify')}<span class="kg-at" id="k-at"></span>${lm('kg-live', 'Live status')}
    <button class="btn pri" data-a="sync" data-tip="Runs bash sync_docs.sh in the active project (asks first): two-way doc sync, then Graphify rebuilds graph.json.">${icon('i-undo')}Sync All</button>${lm('kg-sync', 'Sync All')}</div>
  </header>
  <div class="kg-warn" id="k-warn" role="alert" hidden></div>
  <div class="kg-con" style="--i:1"><section class="card kg-cc ob" id="k-obs"></section><section class="card kg-cc gf" id="k-gfy"></section></div>
  <nav class="otabs kg-tabs" id="k-tabs" style="--i:2"></nav>
  <div id="k-body" class="kg-body"></div>
  <dialog class="lx-dlg kg-dlg" id="k-dlg" aria-labelledby="k-dlg-t"></dialog>
</div>`;
  const pg = el.querySelector('.pg');
  pg.addEventListener('click', onClick); pg.addEventListener('input', onInput); pg.addEventListener('change', onInput); pg.addEventListener('click', syncOn); pg.addEventListener('change', syncOn);
  pg.addEventListener('pointerdown', onRz); pg.addEventListener('dblclick', e => { const h = e.target.closest('.kg-rz'); if (h) { setRz(h, h.dataset.rz, RZ[h.dataset.rz][3]); keep(); } }); pg.addEventListener('keydown', rzKey);
  pg.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role=button][data-note],[role=button][data-dir],[role=button][data-a]')) { e.preventDefault(); e.target.click(); } }); // U1: Space too, without scrolling
  makeGbox(); draw(); loadStatus(); connect(); initGraph(); if (ui.note) loadNote(ui.note);
  tick = setInterval(liveLine, 15000);
  document.addEventListener('fullscreenchange', onFs); document.addEventListener('keydown', zenKey);
}
export function nav(params = []) { if (TABS.some(t => t[0] === params[0])) { ui.tab = params[0]; keep(); draw(); } }
export function update() { } // this page has its own live stream; nothing to do on the usage poll
export function resize() { G?.resize(); drawChart(); }
export function unmount() {
  live.es?.close(); live.es = null; clearTimeout(live.t); clearInterval(tick); clearInterval(perfT); document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('keydown', zenKey); document.body.classList.remove('kg-zen-on');
  G?.dispose(); G = null; gInit = false; gbox = null; root = null; snap = null; live.v = 0;
}

// ---------- data ----------
const net = v => { if (netDown !== v) { netDown = v; setDown(); } };
async function getJ(u) {
  let x; try { x = await fetch(u, { cache: 'no-store' }); } catch { net(true); throw new Error(NET); }
  net(false); const j = await x.json().catch(() => null); if (!x.ok || !j) throw new Error(j?.res || 'HTTP ' + x.status); return j;
}
async function post(o) {
  try { const x = await fetch('/api/vault', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }); net(false); return await x.json().catch(() => ({ res: 'HTTP ' + x.status })); }
  catch { net(true); return { res: NET }; }
}
let stT = null;
async function loadStatus() {
  try { st = await getJ('/api/vault'); err = null; } catch (e) { err = e.message; }
  if (!root) return; if (!err) relost(st.sync); if (st?.sync && !syncS) syncS = st.sync; draw(true);
}
function relost(y) { // E4/B95: after contact was lost mid-run, the tracker's own record decides; none = it restarted
  if (!syncS?.lost) return false; syncS = !y ? { ...syncS, lost: false, running: false, gone: true } : y.running ? { running: true, lines: y.lines } : y;
  if (y && !y.running) { log('Sync All ' + (y.failed ? 'finished with problems' : 'done') + ' while the connection was down', y.failed ? 'w' : 'ok'); toast('Sync All ' + (y.failed ? 'finished with problems' : 'finished') + ' while the connection was down: see the report.', y.failed ? 'err' : 'ok', 'Sync All finished with problems'); }
  syncView(); return true;
}
function setDown() { // E1/E2: recompute, then repaint the status cards, the top card and the locks only when it changed
  const d = netDown || (!live.ok && !live.off && live.retry > 0); if (d === down || !root) return; down = d;
  const f = focusOf(); conn(); paint(); warnLine(); refocus(f);
}
function paint() { // writes and app launches off with the reason while down; each button's own state and tip come back after
  for (const s of [root, gbox]) for (const b of s?.querySelectorAll(down ? LOCK : '[data-off]') || []) {
    if (down) { if (!b.dataset.off) { b.dataset.off = b.disabled ? '2' : '1'; b.dataset.tip0 = b.dataset.tip ?? ''; } b.disabled = true; b.dataset.tip = OFF; }
    else { b.disabled = b.dataset.off === '2'; if (b.dataset.tip0) b.dataset.tip = b.dataset.tip0; else delete b.dataset.tip; delete b.dataset.off; delete b.dataset.tip0; } }
}
function focusOf() { const a = document.activeElement; if (!a || a === document.body || !root?.contains(a)) return null;
  const s = a.id ? '#' + CSS.escape(a.id) : ['a', 'v', 'note', 'dir', 'more', 'rz'].filter(d => a.dataset[d] != null).map(d => `[data-${d}="${CSS.escape(a.dataset[d])}"]`).join('') || (a.getAttribute('href') ? `[href="${CSS.escape(a.getAttribute('href'))}"]` : null);
  return s && { s, a, p: typeof a.selectionStart === 'number' ? a.selectionStart : null }; }
function refocus(f) { if (!f || f.a.isConnected) return; const n = root?.querySelector(f.s); if (!n) return; n.focus({ preventScroll: true }); if (f.p != null) n.setSelectionRange?.(f.p, f.p); }
const statusSoon = () => { clearTimeout(stT); stT = setTimeout(loadStatus, 400); };
async function loadNote(p, quiet) {
  ui.note = p; keep(); if (!quiet) { det = null; detErr = null; if (ui.tab === 'notes' || ui.tab === 'backlinks') draw(); }
  try { const d = await getJ('/api/vault?op=note&p=' + encodeURIComponent(p)); if (d.res !== 'ok') throw new Error(d.res); if (ui.note === p) { det = d; detErr = null; } }
  catch (e) { if (ui.note === p) { det = null; detErr = e.message; } }
  if (root && (ui.tab === 'notes' || ui.tab === 'backlinks')) draw();
}
function openNote(p) { if (edit && !leaveEdit()) return; loadNote(p); if (ui.tab !== 'notes' && ui.tab !== 'backlinks') location.hash = '#/knowledge/notes'; }

// ---------- live stream (SSE): snapshot, then patches. Reconnects with backoff 1, 2, 4 … 30 s; the last data stays, marked stale ----------
function connect() {
  live.es?.close(); clearTimeout(live.t);
  const es = live.es = new EventSource('/api/graph/live?v=' + live.v);
  const J = f => e => { if (live.es !== es || !root) return; try { f(JSON.parse(e.data)); } catch (x) { console.error(x); } };
  es.addEventListener('snapshot', J(s => {
    live.v = s.v; snap = { nodes: new Map(s.nodes.map(n => [n.id, n])), links: new Map(s.links.map(l => [l.k, l])), stats: s.stats };
    seen(s); if (!relost(s.sync) && s.sync) syncS = s.sync.running ? { running: true, lines: s.sync.lines } : s.sync;
    G?.setData(s.nodes, s.links); draw();
    if (!P.pref('obs.live') && !syncS?.running) { es.close(); live.off = true; liveLine(); warnLine(); } // Settings: live graph updates off
  }));
  es.addEventListener('patch', J(p => {
    if ('add' in p) {
      if (!snap || p.v !== live.v + 1) { live.v = -1; return connect(); } // missed a version: ask for a fresh snapshot
      for (const id of p.remove) snap.nodes.delete(id); for (const k of p.linksRemove) snap.links.delete(k);
      for (const n of [...p.add, ...p.update]) snap.nodes.set(n.id, n); for (const l of p.linksAdd) snap.links.set(l.k, l);
      G?.patch(p); statusSoon(); logPatch(p); if (P.pref('obs.toasts') && (p.add.some(n => n.id.startsWith('note_')) || p.remove.some(id => id.startsWith('note_')))) toast(`Vault changed: ${[p.add.filter(n => n.id.startsWith('note_')).length && '+' + p.add.filter(n => n.id.startsWith('note_')).length + ' note(s)', p.remove.filter(id => id.startsWith('note_')).length && '−' + p.remove.filter(id => id.startsWith('note_')).length + ' note(s)'].filter(Boolean).join(' · ')}`); if (ui.note && (ui.tab === 'notes' || ui.tab === 'backlinks') && !edit) loadNote(ui.note, true);
    }
    live.v = p.v; if (snap) snap.stats = p.stats; seen(p); if (st) Object.assign(st, p.stats); draw(true);
  }));
  es.addEventListener('warn', J(w => { live.warn = w.warn; warnLine(); }));
  es.addEventListener('sync', J(s => { syncS = s.running ? { running: true, lines: [...(syncS?.running ? syncS.lines : []), s.line] } : s; syncView(); if (!s.running) { play(s.failed ? 'warn' : 'success', { task: true }); log(s.failed ? 'Sync All finished with problems' : 'Sync All done' + (s.written ? ` · ${s.written.length} files written` : ''), s.failed ? 'w' : 'ok'); toast(s.failed ? 'Sync All finished with problems: see the report.' : 'Sync All done.', s.failed ? 'err' : 'ok'); statusSoon(); } }));
  es.onopen = () => { live.off = false; live.ok = true; live.retry = 0; setDown(); liveLine(); warnLine();
    if (err || live.lost) { live.lost = false; loadStatus(); } }; // B94: one status read brings back the explorer, templates, daily notes, app status and a lost Sync All (no snapshot comes when nothing changed)
  es.onerror = () => { es.close(); if (live.es !== es || !root) return; live.ok = false; live.lost = true; if (syncS?.running) { syncS.lost = true; syncView(); } // E4: outcome unknown, not running, not failed
    const s = Math.min(30, 2 ** live.retry++); live.wait = Date.now() + s * 1000; live.t = setTimeout(connect, s * 1000); setDown(); liveLine(); warnLine(); };
}
function seen(o) { live.at = o.at || Date.now(); live.ok = true; live.warn = o.warn ?? null; setDown(); liveLine(); warnLine(); }
function liveLine() {
  const t = live.at ? ago(live.at) : '—', s = !live.off && (!live.ok || !!live.warn);
  if (live.off) { const a = $('k-at'); if (a) a.innerHTML = `<span class="muted sm" data-tip="Live graph updates are off (Settings → Obsidian & Graphify). Refresh re-reads the vault once.">Live updates off · last read ${esc(t)}</span>`; const b = gbox?.querySelector('#k-live'); if (b) b.innerHTML = '<span class="tg n">Paused</span>'; return; }
  const h = s ? `<span class="tg n kg-stale" data-tip="The live link to the tracker is down or an update failed. Showing the last good data from ${esc(t)}.">Stale</span> <span class="muted sm">Last synced ${esc(t)}${!live.ok && live.wait ? ` · retrying in ${Math.max(1, Math.round((live.wait - Date.now()) / 1000))} s` : ''}</span>`
    : `<span class="kg-dot" aria-hidden="true"></span><span class="muted sm" data-tip="Live: the tracker watches the vault, graph.json, the project docs, skills and plugins, and sends changes here as they happen.">Live · last synced ${esc(t)}</span>`;
  const a = $('k-at'); if (a) a.innerHTML = h; const b = gbox?.querySelector('#k-live'); if (b) b.innerHTML = s ? '<span class="tg n">Stale</span>' : '<span class="kg-dot"></span>Live';
}
function warnLine() {
  const w = $('k-warn'); if (!w) return; const at = live.at || st?.at, t = at && new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const h = down ? errBox({ title: 'Tracker not reachable', where: 'Obsidian & Graphify', // E1
    what: live.off ? "NEXUS can't reach its tracker. Live updates are off (Settings), so it does not reconnect on its own: press Retry now." : 'The live connection to the tracker is lost. NEXUS reconnects on its own, waiting 1, 2, 4 … up to 30 s between tries; the header shows the next try.',
    why: st || snap ? `What you see is the last data, from ${t || 'earlier'}. Writes and app launches are off until the tracker is back; browsing, search, filters, the graph and Export still work, and an open edit keeps its text.` : 'No vault data can show until the tracker answers.',
    affected: 'Sync All, New Note, New Folder, Daily Note, templates, Save, Open in Obsidian, Show in File Explorer, Open Graph and Re-read status.', steps: ['Make sure the tracker is running: node ~/.claude/token-tracker/tracker.js serve', 'Press Retry now.'],
    actions: [['kRetry', 'Retry now', true]], more: ['kg-live', 'Live status'], tech: 'SSE /api/graph/live or GET/POST /api/vault failed. Retry now reconnects at once instead of waiting for the next try.' }).replace(' role="alert"', '') // #k-warn itself is the alert
    : live.warn ? `${icon('i-pulse')}<span>${esc(live.warn)}</span>` : '';
  if (h === w._h) return; w._h = h; w.hidden = !h; w.className = down ? '' : 'kg-warn'; w.innerHTML = h; // U3/B100: rewritten only when the text changes, so it is announced once
}

// ---------- draw ----------
function draw(soft) {
  if (!root) return; const fo = focusOf(); // U2/B98: focus survives live redraws
  conn();
  $('k-tabs').innerHTML = seg(TABS.map(([v, t]) => [v, t, '#/knowledge/' + v]), ui.tab);
  const S = st || snap?.stats;
  if (!S) { $('k-body').innerHTML = err ? stateBox('error', err === NET ? 'No vault data yet.' : "Couldn't read the vault", err === NET ? 'See the message at the top of the page.' : esc(why(err))) : stateBox('loading', 'Reading your vault…', 'Graphify rules run over every note once; later updates only re-read what changed.'); paint(); return refocus(fo); } // M5
  if (soft && document.activeElement?.closest?.('#k-body') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { parkGraph(); paint(); return refocus(fo); } // don't wipe a field the user is typing in
  const B = $('k-body'), f = { overview, notes, graph: graphTab, tags, backlinks, search, templates, daily, analytics, exporter, sync: syncPane }[ui.tab === 'export' ? 'exporter' : ui.tab];
  const sc = [...B.querySelectorAll('.kg-tree,.kg-rl,.kg-act')].map(e => [e.className, e.scrollTop]);
  const slot = soft && $('k-slot'); B.classList.toggle('k-soft', !!soft); B.innerHTML = f(S);
  if (soft) { if (slot) $('k-slot')?.replaceWith(slot); B.querySelectorAll('.enter').forEach(e => e.classList.remove('enter')); } // live update: no replayed entry animation, the graph keeps its canvas (no flash)
  parkGraph(); after(S); for (const [c, t] of sc) { const e = B.getElementsByClassName(c)[0]; if (e) e.scrollTop = t; }
  paint(); refocus(fo);
}
function after(S) {
  drawChart(); const g = gq(S);
  setRing($('k-r1'), g.health, g.health == null ? '—' : g.health + '%', g.health != null && g.health < 90);
  const N = snap ? [...snap.nodes.values()] : [], L = snap ? [...snap.links.values()] : [];
  setRing($('k-r2'), N.length ? N.filter(n => n.o === 'graphify').length / N.length * 100 : null, short(g.nodes));
  setRing($('k-r3'), L.length ? L.filter(l => l.o === 'graphify').length / L.length * 100 : null, short(g.links));
  setRing($('k-r4'), g.communities ? 100 : 0, n0(g.communities));
  if (ui.tab === 'search') { const i = $('k-sq'); if (i && !i.value && ui.q) i.value = ui.q; }
}
const short = n => n == null ? '—' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);

function conn() {
  const S = st || snap?.stats; if (!S) return; const g = gq(S), d = g.drift || {}, pend = (d.newNodes || 0) + (d.goneNodes || 0) + (d.newLinks || 0) + (d.deadLinks || 0);
  const old = down && `<span class="tg u" data-tip="The tracker is not reachable: these numbers are the last data, from ${esc(ago(live.at || st?.at || Date.now()))}.">Last data ${esc(ago(live.at || st?.at || Date.now()))}</span>`; // B99
  const stat = (ic, v, l, tip, col) => `<div class="kg-s" data-tip="${esc(tip)}"${col ? ` style="--tc:${col}"` : ''}><span class="tile-ic">${icon(ic)}</span><div><b>${v}</b><small>${l}</small></div></div>`;
  $('k-obs').innerHTML = `<div class="kg-ch"><span class="kg-logo ob">${icon('i-book')}</span><div class="kg-ct"><h2>Obsidian ${old || `<span class="tg ${S.vaultOk ? 'ok' : 'w'}"><i class="kg-dot"></i>${S.vaultOk ? 'Vault connected' : 'Vault not found'}</span>`}
      <span class="tg ${st?.obsidian && !down ? 'ok' : 'u'}" data-tip="${esc(`Whether the Obsidian app was running when the vault was last read (${st?.at ? ago(st.at) : 'not yet'}).`)}">${st?.obsidian == null || down ? 'App: unknown' : st.obsidian ? 'App running' : 'App closed'}</span>${lm('kg-obs', 'Obsidian card')}</h2><p class="mono">${esc(S.vault)}</p></div>
    <div class="end"><button class="btn" data-a="openVault" data-tip="Opens this vault in the Obsidian app.">${icon('i-book')}Open Vault</button>${menu([['openFolder', 'i-folder', 'Show in File Explorer'], ['copy', 'i-layers', 'Copy vault path', S.vault], ['refresh', 'i-undo', 'Re-read status now']])}</div></div>
  <div class="kg-ss">${stat('i-book', n0(S.notes), 'Notes', 'Markdown notes in the vault (dot folders like .obsidian are skipped, same as Graphify).', '#A26BFF')}
    ${stat('i-layers', n0(S.tags), 'Tags', 'Distinct tags in note frontmatter.', '#FFC23D')}
    ${stat('i-cube', n0(S.attachments), 'Attachments', 'Files in the vault that are not notes (images, PDFs, .blend …).', '#3D8BFF')}
    ${stat('i-clock', n0(S.modifiedToday), 'Modified Today', 'Notes whose file changed since midnight.', '#FF8A3D')}
    ${stat('i-db', bytes(S.bytes), 'Vault Size', 'Every file in the vault folder except dot folders.', '#2EE6D6')}</div>`;
  const built = g.built ? ago(g.built) : 'never';
  $('k-gfy').innerHTML = `<div class="kg-ch"><span class="kg-logo gf">${icon('i-graph')}</span><div class="kg-ct"><h2>Graphify <span class="tg ${g.ok ? 'ok' : 'w'}"><i class="kg-dot"></i>${g.ok ? 'graph.json found' : 'graph.json missing'}</span>
      ${old || ''}<span${old ? ' style="display:none"' : ''} class="tg ${pend || g.projNewer?.length ? 'n' : 'u'}" data-tip="${esc(pend || g.projNewer?.length ? `The live vault differs from graph.json: ${d.newNodes} new and ${d.goneNodes} removed nodes, ${d.newLinks} new and ${d.deadLinks} dead links${g.projNewer?.length ? `; ${g.projNewer.length} project doc(s) changed since the build` : ''}. Sync All rebuilds it.` : 'graph.json matches the live vault exactly.')}">${pend || g.projNewer?.length ? `${pend + (g.projNewer?.length || 0)} pending` : 'In sync'}</span>${lm('kg-gfy', 'Graphify card')}</h2>
      <p class="mono" data-tip="${esc(g.path || '')}">graph.json built ${esc(built)}${g.commit ? ' · commit ' + esc(g.commit.slice(0, 7)) : ''}</p></div>
    <div class="end"><button class="btn" data-a="openGraph" data-tip="Opens Graphify's own interactive graph.html in your browser.">${icon('i-graph')}Open Graph</button>${menu([['sync', 'i-undo', 'Sync All…'], ['tab', 'i-chart', 'Graph analytics', 'analytics'], ['tab', 'i-arrow-down', 'Export', 'export']])}</div></div>
  <div class="kg-ss">${stat('i-graph', n0(g.nodes), 'Nodes', 'Live nodes (Graphify rules over the current vault, skills and projects). graph.json itself may lag until Sync All.', '#31D67A')}
    ${stat('i-flow', n0(g.links), 'Connections', 'Live links: [[wiki links]], inferred mentions, folders, tags, skills.', '#3D8BFF')}
    ${stat('i-layers', n0(g.communities), 'Clusters', 'Graphify communities in graph.json (Leiden clustering).', '#A26BFF')}
    ${stat('i-search', n0(g.orphans), 'Orphans', 'Notes with no [[link]] in or out and no inferred mention.', '#FF4D6A')}
    ${stat('i-heart', g.health == null ? '—' : g.health + '%', 'Graph Health', 'Graph Health = resolved [[links]] ÷ all [[links]] in vault notes (' + kgTxt() + '; .obsidian/.claude/copilot folders skipped). ' + `${n0(g.resolved)} resolved, ${n0(g.unresolved)} unresolved.`, '#FFC23D')}</div>`;
}
const menu = items => `<details class="lx-more"><summary aria-label="More options">⋯</summary><div>${items.map(([a, ic, t, v]) => `<button data-a="${a}"${v != null ? ` data-v="${esc(v)}"` : ''}>${icon(ic)}${t}</button>`).join('')}</div></details>`;

// ---------- tabs ----------
function overview(S) {
  const w = k => ui.col[k] ? 46 : ui.pw[k];
  return `<div class="kg-ov enter${ui.col.ex && ui.col.rn ? ' c2' : ''}" style="--w1:${w('ex')}px;--w2:${w('rn')}px;--gh:${ui.pw.gh}px">
  ${pane('ex', 'Vault Explorer', 3, () => `${explorerHead(true)}<div class="kg-tree" id="k-tree">${treeHtml()}</div>`)}
  ${pane('rn', 'Recent Notes', 4, () => `<div class="card-h"><h2>Recent Notes</h2>${chip('live', 'Newest file changes in the vault.')}<a class="end kg-va" href="#/knowledge/notes">View all</a>${colBtn('rn', 'Recent Notes')}</div>
    <div class="kg-rl">${(S.recent || []).slice(0, 8).map(r => `<div class="kg-row kg-rnr" role="button" tabindex="0" data-note="${esc(r.p)}"><span class="kg-fi" style="--c:${colOf(r.p)}">${icon('i-book')}</span>
      <div><b>${esc(base(r.p))}</b><span class="kg-tags">${r.tags.map(t => `<span class="kg-tag">#${esc(t)}</span>`).join('') || `<small class="muted">${esc(dirOf(r.p) || 'Vault root')}</small>`}</span></div><time>${when(r.mtime)}</time></div>`).join('') || stateBox('empty', 'No notes yet.')}</div>`)}
  <section class="card kg-gc" id="k-slot" style="--i:5"><div class="kg-rz h" data-rz="gh" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="Resize graph height" data-tip="Drag to resize · double-click to reset"></div></section>
  <section class="card kg-qa" style="--i:6"><div class="card-h"><h2>${icon('i-bolt')}Quick Actions</h2></div><div class="kg-qg">
    ${[['newNote', 'i-plus-folder', 'New Note', '#3D8BFF', 'Create a note (pick folder and template).'], ['newFolder', 'i-folder', 'New Folder', '#31D67A', 'Create a folder in the vault.'], ['daily', 'i-cal', 'Daily Note', '#FFC23D', 'Open today\'s note in Daily Notes/ (created after you confirm, the first time).'],
      ['tab', 'i-layers', 'Template', '#A26BFF', 'Templates: create a note from one, or add the starter set.', 'templates'], ['tab', 'i-search', 'Smart Search', '#2EE6D6', 'Search note titles and text.', 'search'], ['openVault', 'i-book', 'Open in Obsidian', '#A26BFF', 'Opens the vault in the Obsidian app.']]
      .map(([a, ic, t, c, tip, v]) => `<button class="kg-q" data-a="${a}"${v ? ` data-v="${v}"` : ''} style="--c:${c}" data-tip="${tip}">${icon(ic)}<span>${t}</span></button>`).join('')}</div></section>
  </div>
  <div class="kg-bot enter">
    <section class="card kg-vs" style="--i:7">${statHead()}<div class="kg-ch2" id="k-chart"></div>${chartLegend()}</section>
    <section class="card kg-tt" style="--i:8"><div class="card-h"><h2>Top Tags</h2>${chip('live', 'Notes per tag, from frontmatter.')}<a class="end kg-va" href="#/knowledge/tags">View all</a></div>${tagBars(S.topTags || [], 7)}</section>
    <section class="card kg-ga" style="--i:9"><div class="card-h"><h2>Graph Analytics</h2>${lm('kg-health', 'Graph Health')}<a class="end kg-va" href="#/knowledge/analytics">View details</a></div>${gaRings(S)}</section>
    <section class="card kg-at" style="--i:10"><div class="card-h"><h2>Recent Attachments</h2>${chip('live', 'Newest non-note files in the vault.')}</div>${attList(S)}</section>
  </div>`;
}
const colBtn = (k, t) => `<button class="btn sm ghost kg-colb" data-a="pcol" data-v="${k}" aria-label="Collapse ${t}" aria-expanded="true" data-tip="Collapse">${icon('i-chev')}</button>`;
const pane = (k, t, i, body) => ui.col[k]
  ? `<section class="card kg-${k} rail" style="--i:${i}"><button class="kg-rail" data-a="pcol" data-v="${k}" aria-label="Expand ${t}" aria-expanded="false" data-tip="Expand ${t}">${icon('i-chev')}<span>${t}</span></button></section>`
  : `<section class="card kg-${k}" style="--i:${i}">${body()}<div class="kg-rz" data-rz="${k}" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize ${t}" data-tip="Drag to resize · double-click to reset"></div></section>`;
const explorerHead = col => `<div class="card-h"><h2>Vault Explorer</h2><div class="end"><button class="btn sm ghost" data-a="newNote" aria-label="New note" data-tip="New note">${icon('i-plus-folder')}</button>
  <button class="btn sm ghost" data-a="newFolder" aria-label="New folder" data-tip="New folder">${icon('i-folder')}</button><button class="btn sm ghost" data-a="refresh" aria-label="Refresh" data-tip="Re-read the folder tree">${icon('i-undo')}</button>${col ? colBtn('ex', 'Vault Explorer') : ''}</div></div>`;
function treeHtml() {
  if (!st?.tree) return stateBox('loading', 'Reading folders…');
  const ro = new Set(st.readOnly || []), go = (items, depth) => items.map(x => x.d
    ? `<div class="kg-row kg-tf${ui.open[x.p] ? ' open' : ''}" role="button" tabindex="0" data-dir="${esc(x.p)}" style="--d:${depth}" aria-expanded="${!!ui.open[x.p]}"><i class="kg-car"></i>${icon('i-folder')}<span>${esc(x.n)}</span><small>${x.c}</small></div>${ui.open[x.p] ? go(x.d, depth + 1) : ''}`
    : /\.md$/i.test(x.n) ? `<div class="kg-row kg-tn${ui.note === x.p ? ' on' : ''}" role="button" tabindex="0" data-note="${esc(x.p)}" style="--d:${depth}">${icon('i-book')}<span>${esc(x.n.slice(0, -3))}</span>${ro.has(x.p) ? '<small class="kg-ro" data-tip="Synced from the my-game project: read-only here.">synced</small>' : ''}</div>`
    : `<div class="kg-row kg-tn att" style="--d:${depth}">${icon('i-cube')}<span>${esc(x.n)}</span></div>`).join('');
  return `<div class="kg-row kg-tf open kg-root" style="--d:0">${icon('i-db')}<span>${esc(st.vaultName)}</span><small>${st.notes}</small></div>` + go(st.tree, 1);
}
const colOf = p => { const n = snap?.nodes.get('note_' + slug(base(p))); return { obsidian: '#8B5CF6', roblox: '#E8742A', claude: '#22B868', plugins: '#3474E0', blender: '#D9A02B', refs: '#D9405C' }[n?.k] || '#A26BFF'; };
const statHead = () => `<div class="card-h"><h2>Vault Statistics</h2>${lm('kg-stats', 'Vault Statistics')}${chip('est', 'Created = file creation time; Modified = the last change of each note (older edits are not recorded). A copied or re-synced vault resets creation times.')}<div class="end" id="k-rng">${seg(RANGES, ui.range)}</div></div>`;
const chartLegend = () => `<div class="kg-lg"><span style="--c:#31D67A">Notes Created</span><span style="--c:#A26BFF">Notes Modified (last change)</span><span style="--c:#3D8BFF">Attachments Added</span></div>`;
function tagBars(T, n) {
  if (!T.length) return stateBox('empty', 'No tags yet.', 'Add <code>tags: [x]</code> to a note\'s frontmatter.');
  const m = T[0][1] || 1; return `<div class="kg-tb">${T.slice(0, n).map(([t, c], i) => `<div class="kg-row kg-tbr" role="button" tabindex="0" data-a="tag" data-v="${esc(t)}" style="--c:${TAGC[i % TAGC.length]}"><span><i></i>#${esc(t)}</span><span class="kg-bar"><b style="width:${c / m * 100}%"></b></span><small>${c}</small></div>`).join('')}</div>`;
}
function gaRings(S) {
  const g = gq(S), d = g.drift || {}, pend = (d.newNodes || 0) + (d.goneNodes || 0) + (d.newLinks || 0) + (d.deadLinks || 0) + (g.projNewer?.length || 0), img = (S.att || []).filter(a => a.img).length;
  const tip = (t, h) => `<div data-tip="${esc(t)}">${h}</div>`;
  return `<div class="kg-rings">${tip('Graph Health = resolved [[links]] ÷ all [[links]] in vault notes. A link is resolved when it names an existing note or alias.', ring('k-r1', 'Health'))}${tip('Live nodes. The ring shows the share already in graph.json.', ring('k-r2', 'Nodes'))}
    ${tip('Live links. The ring shows the share already in graph.json.', ring('k-r3', 'Links'))}${tip('Graphify communities in graph.json. Count only: the ring is not a share.', ring('k-r4', 'Clusters'))}</div>
  <div class="kg-gf">${[['i-search', g.orphans, 'Orphans', 'Notes with no links in or out.'], ['i-x', g.unresolved, 'Unresolved', '[[links]] that point to no note.'], ['i-cube', img, 'Recent images', 'Image attachments in the vault (of the newest 8 files).'], ['i-book', S.notes, 'Notes', 'Notes in the vault.'], ['i-clock', pend, 'Pending', 'Changes the live vault has that graph.json does not yet (Sync All adds them).']]
    .map(([ic, v, l, t]) => `<div data-tip="${esc(t)}">${icon(ic)}<b>${n0(v)}</b><small>${l}</small></div>`).join('')}</div>`;
}
function attList(S) {
  if (!S.att?.length) return stateBox('empty', 'No attachments in this vault.', 'Images, PDFs and other files you add to the vault show here. Right now it holds notes only.');
  return `<div class="kg-al">${S.att.map(a => `<div class="kg-ai"><span class="kg-fi">${icon(a.img ? 'i-cube' : 'i-layers')}</span><div><b>${esc(a.p.split('/').pop())}</b><small>${bytes(a.size)} · ${ago(a.mtime)}</small></div></div>`).join('')}</div>`;
}

const syncPane = () => syncTab(() => { const e = $('k-sync'); if (ui.tab === 'sync' && e) e.outerHTML = syncPane(); }); // redraws only its own section
function graphTab() { return `<section class="card kg-gc full enter" id="k-slot"></section>`; }

function notes() {
  return `<div class="kg-nt enter"><section class="card kg-ex">${explorerHead()}<div class="kg-tree" id="k-tree">${treeHtml()}</div></section>
  <section class="card kg-nv">${viewer()}</section><aside class="card kg-nl">${linksSide()}</aside></div>`;
}
function viewer() {
  if (!ui.note) return stateBox('empty', 'Pick a note.', 'Choose a note in the explorer, Recent Notes, search or the graph.');
  if (detErr) return stateBox('error', "Couldn't open the note", esc(detErr === NET ? why(NET) : why(detErr).replace('Nothing was changed.', 'It may have been renamed or deleted.')));
  if (!det) return stateBox('loading', 'Opening ' + base(ui.note) + '…');
  const D = det, ro = D.readOnly;
  const head = `<div class="card-h kg-vh"><span class="kg-fi" style="--c:${colOf(D.p)}">${icon('i-book')}</span><div class="kg-vt"><h2>${esc(base(D.p))}</h2><small class="mono">${esc(D.p)}</small></div><div class="end">${lm('kg-edit', 'Editing a note here')}
    ${ro ? `<span class="tg n" data-tip="${esc('This note is copied into the vault from ' + ro + ' by sync_docs.sh, so edits here would be overwritten. Edit it in the project or open it in Obsidian.')}">${icon('i-shield')}Read-only</span>` : ''}
    ${edit ? `<button class="btn" data-a="cancelEdit">Cancel</button><button class="btn pri" data-a="review">${icon('i-check')}Review &amp; Save</button>`
      : `<button class="btn" data-a="edit" ${ro || D.tooBig ? `disabled data-tip="${ro ? 'Synced from the project: read-only here.' : 'Too large to edit here.'}"` : 'data-tip="Edit here. You see a diff and confirm before anything is saved; the old version is backed up."'}>${icon('i-code')}Edit</button>
      <button class="btn" data-a="showGraph" ${D.id ? '' : 'disabled data-tip="Not in the graph yet: Sync All adds it."'}>${icon('i-graph')}Show in graph</button><button class="btn" data-a="obsNote">${icon('i-book')}Open in Obsidian</button>`}</div></div>
  <div class="kg-meta"><span>${bytes(D.size)}</span><span>Modified ${when(D.mtime)}</span><span>Created ${D.birth ? day(D.birth) : '—'}</span>${D.node?.o === 'live' ? '<span class="tg n" data-tip="Not in graph.json yet: Sync All adds it.">New since last Graphify build</span>' : ''}</div>`;
  if (edit) return head + `<textarea class="kg-ed" id="k-ed" style="font-size:${P.pref('obs.edFont')}px;white-space:${P.pref('obs.wrap') ? 'pre-wrap' : 'pre'}" spellcheck="false" aria-label="Note text">${esc(edit.text)}</textarea>`;
  return head + (D.tooBig ? stateBox('empty', 'This note is over 2 MB.', 'Open it in Obsidian.') : `<article class="kg-md">${md(D.text)}</article>`);
}
function linksSide() {
  if (!det) return `<div class="card-h"><h2>Links</h2></div><p class="muted sm">Backlinks and outgoing links of the open note show here.</p>`;
  const L = (t, a, tip) => `<h3 data-tip="${tip}">${t} <small>${a.length}</small></h3>${a.length ? a.map(x => x.p ? `<div class="kg-row kg-ln" role="button" tabindex="0" data-note="${esc(x.p)}">${icon('i-book')}<span>${esc(x.l)}</span>${x.r === 'mentions' ? '<small>inferred</small>' : ''}</div>` : `<div class="kg-row kg-ln" role="button" tabindex="0" data-a="gsel" data-v="${esc(x.id)}">${icon('i-graph')}<span>${esc(x.l)}</span>${x.r === 'mentions' ? '<small>inferred</small>' : ''}</div>`).join('') : '<p class="muted sm">None.</p>'}`;
  return `<div class="card-h"><h2>Links</h2></div>${L('Backlinks', det.back, 'Notes with a [[link]] to this note.')}${L('Outgoing', det.out, '[[links]] in this note, plus skills it names (inferred mentions, Graphify rule).')}
    <h3 data-tip="[[links]] in this note that point to no note.">Unresolved <small>${det.unresolved.length}</small></h3>${det.unresolved.length ? det.unresolved.map(u => `<div class="kg-row kg-ln bad">${icon('i-x')}<span>${esc(u)}</span></div>`).join('') : '<p class="muted sm">None.</p>'}`;
}

function allTags() { const m = new Map(); for (const n of snap?.nodes.values() || []) if (n.id.startsWith('note_')) for (const t of n.tags || []) m.set(t, (m.get(t) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); }
function tags() {
  const T = allTags(), cur = ui.tag && T.some(t => t[0] === ui.tag) ? ui.tag : T[0]?.[0], N = cur ? [...snap.nodes.values()].filter(n => n.id.startsWith('note_') && n.tags?.includes(cur)).sort((a, b) => (b.mt || 0) - (a.mt || 0)) : [];
  return `<div class="kg-2 enter"><section class="card"><div class="card-h"><h2>All Tags</h2><span class="muted sm">${T.length}</span>${chip('live', 'Tags in note frontmatter.')}</div>${tagBars(T, 999).replace('kg-tb"', 'kg-tb kg-scroll"')}</section>
  <section class="card"><div class="card-h"><h2>${cur ? '#' + esc(cur) : 'Notes'}</h2><span class="muted sm">${N.length} note${N.length === 1 ? '' : 's'}</span></div>
    <div class="kg-scroll">${N.map(n => `<div class="kg-row kg-ln" role="button" tabindex="0" data-note="${esc(n.p)}">${icon('i-book')}<span>${esc(n.l)}</span><small>${esc(dirOf(n.p))}</small></div>`).join('') || stateBox('empty', 'No tags.')}</div></section></div>`;
}
function backlinks(S) {
  const g = gq(S), top = snap ? [...snap.nodes.values()].filter(n => n.id.startsWith('note_')).map(n => [n, [...snap.links.values()].filter(l => l.r === 'references' && (l.a === n.id || l.b === n.id)).length]).sort((a, b) => b[1] - a[1]).slice(0, 40) : [];
  return `<div class="kg-3 enter"><section class="card"><div class="card-h"><h2>Most Linked Notes</h2>${chip('live', 'Notes with the most [[link]] connections (in or out).')}</div><div class="kg-scroll">${top.map(([n, c]) => `<div class="kg-row kg-ln${ui.note === n.p ? ' on' : ''}" role="button" tabindex="0" data-note="${esc(n.p)}">${icon('i-book')}<span>${esc(n.l)}</span><small>${c}</small></div>`).join('')}</div></section>
  <section class="card">${ui.note ? `<div class="card-h"><h2>${esc(base(ui.note))}</h2></div>` : ''}${det ? linksSide().replace(/^<div class="card-h"><h2>Links<\/h2><\/div>/, '') : ui.note ? stateBox('loading', 'Reading links…') : stateBox('empty', 'Pick a note.', 'Its backlinks, outgoing and unresolved links show here.')}</section>
  <section class="card"><div class="card-h"><h2>Vault Problems</h2>${lm('kg-prob', 'Vault Problems')}</div>
    <h3 class="kg-h3" data-tip="[[links]] anywhere in the vault that point to no note, with how often.">Unresolved links <small>${n0(g.unresolved)}</small></h3>${g.unresolvedList?.length ? g.unresolvedList.map(([t, c]) => `<div class="kg-row kg-ln bad">${icon('i-x')}<span>${esc(t)}</span><small>${c}×</small></div>`).join('') : '<p class="muted sm">None. Every [[link]] resolves.</p>'}
    <h3 class="kg-h3" data-tip="Notes with no [[link]] in or out and no inferred mention.">Orphan notes <small>${n0(g.orphans)}</small></h3>${g.orphanList?.length ? g.orphanList.map(p => `<div class="kg-row kg-ln" role="button" tabindex="0" data-note="${esc(p)}">${icon('i-book')}<span>${esc(base(p))}</span></div>`).join('') : '<p class="muted sm">None. Every note is linked.</p>'}</section></div>`;
}
let sres = null, sT = null;
function search() {
  return `<section class="card kg-sr enter"><div class="card-h"><h2>Smart Search</h2><span class="muted sm">Note titles and full text (whole vault)</span></div>
  <label class="field kg-sf">${icon('i-search')}<input id="k-sq" placeholder="Search notes…" value="${esc(ui.q)}" autocomplete="off" aria-label="Search notes"></label><div id="k-sres">${sresHtml()}</div></section>`;
}
function sresHtml() {
  if (!ui.q.trim()) return '<p class="muted sm">Type to search. Matching titles come first, then notes with the most matches.</p>';
  if (!sres) return stateBox('loading', 'Searching…');
  if (!sres.hits.length) return stateBox('empty', 'No notes match "' + sres.q + '".');
  const hl = s => esc(s).replace(new RegExp(sres.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'), 'gi'), m => `<mark>${m}</mark>`);
  return `<p class="muted sm">${sres.hits.length}${sres.hits.length === 60 ? '+' : ''} note${sres.hits.length === 1 ? '' : 's'}</p>` + sres.hits.map(h => `<div class="kg-row kg-hit" role="button" tabindex="0" data-note="${esc(h.p)}"><b>${hl(base(h.p))}</b><small>${esc(dirOf(h.p) || 'Vault root')} · ${h.count} match${h.count === 1 ? '' : 'es'} · ${when(h.mtime)}</small>${h.snip ? `<p>${hl(h.snip)}</p>` : ''}</div>`).join('');
}
async function runSearch() { const q = ui.q.trim(); if (!q) { sres = null; return $('k-sres') && ($('k-sres').innerHTML = sresHtml()); } sres = null; try { const r = await getJ('/api/vault?op=search&q=' + encodeURIComponent(q)); if (q === ui.q.trim()) sres = r; } catch (e) { sres = { q, hits: [] }; toast(why(e.message).replace('nothing was changed', 'nothing was searched').replace(' Nothing was changed.', ''), 'err', 'Search failed'); } if ($('k-sres')) $('k-sres').innerHTML = sresHtml(); }
function templates() {
  const T = st?.templates || [], miss = ['Note', 'Asset', 'Meeting'].filter(k => !T.includes(k));
  return `<section class="card enter"><div class="card-h"><h2>Templates</h2>${lm('kg-tpl', 'Templates and Daily Notes')}<span class="muted sm">Templates/ in your vault · {{title}}, {{date}}, {{time}} are filled in</span>${miss.length ? `<div class="end"><button class="btn" data-a="tplInit">${icon('i-plus-folder')}${T.length ? 'Add missing starter templates' : 'Create starter templates'}</button></div>` : ''}</div>
  ${T.length ? `<div class="kg-tg">${T.map(t => `<div class="kg-tc"><span class="kg-fi" style="--c:#A26BFF">${icon('i-layers')}</span><b>${esc(t)}</b><small class="mono">Templates/${esc(t)}.md</small><div><button class="btn sm pri" data-a="newNote" data-v="${esc(t)}">${icon('i-plus-folder')}New note</button><button class="btn sm" data-note="Templates/${esc(t)}.md">View</button></div></div>`).join('')}</div>`
    : stateBox('empty', 'No templates yet.', 'Create the starter set (Note, Asset, Meeting) after a confirm. Obsidian\'s own settings are not changed.')}</section>`;
}
function daily() {
  const D = st?.daily || [], today = new Date().toLocaleDateString('en-CA');
  return `<section class="card enter"><div class="card-h"><h2>Daily Notes</h2>${lm('kg-tpl', 'Templates and Daily Notes')}<span class="muted sm">Daily Notes/YYYY-MM-DD.md</span><div class="end"><button class="btn pri" data-a="daily">${icon('i-cal')}${D.includes(today) ? 'Open today' : 'Create today\'s note'}</button></div></div>
  ${D.length ? `<div class="kg-dg">${D.map(d => `<div class="kg-row kg-dn${d === today ? ' on' : ''}" role="button" tabindex="0" data-note="Daily Notes/${d}.md">${icon('i-cal')}<b>${new Date(d + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</b>${d === today ? '<span class="tg ok">Today</span>' : ''}</div>`).join('')}</div>`
    : stateBox('empty', 'No daily notes yet.', 'The first one creates the Daily Notes folder, after you confirm.')}</section>`;
}
function analytics(S) {
  const g = gq(S), d = g.drift || {}, H = G?.hubs() || [];
  return `<div class="kg-an enter"><section class="card kg-vs wide">${statHead()}<div class="kg-ch2 tall" id="k-chart"></div>${chartLegend()}</section>
  <section class="card"><div class="card-h"><h2>Graph Analytics</h2>${lm('kg-health', 'Graph Health')}</div>${gaRings(S)}<p class="muted sm kg-fx">Graph Health = resolved [[links]] ÷ all [[links]] in vault notes = ${n0(g.resolved)} ÷ ${n0((g.resolved || 0) + (g.unresolved || 0))}. A link is resolved when it names an existing note or alias; the auto-generated Knowledge Graph note is ${P.pref('obs.kgHealth') ? 'counted (Settings)' : 'not counted'}. Orphans = notes with no [[link]] in or out and no inferred mention.</p></section>
  <section class="card"><div class="card-h"><h2>Live vs graph.json</h2>${chip('live', 'Live vault (Graphify rules) compared with the graph.json Graphify last built.')}</div>
    <div class="kg-kv">${[['New nodes', d.newNodes], ['Removed nodes', d.goneNodes], ['New links', d.newLinks], ['Dead links', d.deadLinks], ['Project docs changed since build', g.projNewer?.length || 0]].map(([k, v]) => `<div><span>${k}</span><b class="${v ? 'warn' : ''}">${n0(v)}</b></div>`).join('')}</div>
    <p class="muted sm">graph.json built ${g.built ? when(g.built) : 'never'}${g.commit ? ' at commit ' + esc(g.commit.slice(0, 7)) : ''}. ${(d.newNodes || d.goneNodes || d.newLinks || d.deadLinks || g.projNewer?.length) ? 'Sync All brings it up to date.' : 'Up to date.'}</p></section>
  ${connectivity()}
  <section class="card"><div class="card-h"><h2>Clusters</h2><span class="muted sm">${ui.mode === 'nexus' ? 'NEXUS clusters' : 'Graphify communities'}</span></div>
    ${H.length ? `<div class="kg-cl">${H.map(h => `<div class="kg-row" role="button" tabindex="0" data-a="ghub" data-v="${esc(h.k)}" data-tip="${esc(h.rule)}"><i style="--c:${h.color}"></i><span>${esc(h.name)}</span><small>${h.count}</small></div>`).join('')}</div>` : stateBox('loading', 'Loading the graph…')}</section></div>`;
}
function connectivity() {
  const notes = snap ? [...snap.nodes.values()].filter(n => n.id.startsWith('note_')) : [], deg = new Map();
  for (const l of snap?.links.values() || []) if (l.r === 'references' || l.r === 'mentions') for (const k of [l.a, l.b]) deg.set(k, (deg.get(k) || 0) + 1);
  const con = notes.filter(n => deg.get(n.id)).length, iso = notes.length - con, top = notes.map(n => [n, deg.get(n.id) || 0]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const nm = id => snap?.nodes.get(id)?.l || id;
  return `<section class="card"><div class="card-h"><h2>Connectivity</h2>${chip('live', 'Counted from the live graph: a note is connected when it has a [[link]] or an inferred mention, in or out.')}</div>
    <div class="kg-kv"><div><span>Notes</span><b>${n0(notes.length)}</b></div><div><span>Connected notes</span><b>${n0(con)}</b></div><div><span>Isolated notes</span><b class="${iso ? 'warn' : ''}">${n0(iso)}</b></div><div><span>Note links</span><b>${n0([...deg.values()].reduce((a, b) => a + b, 0) / 2)}</b></div></div>
    <div class="kg-bar" role="img" aria-label="${con} connected, ${iso} isolated"><b style="--c:#31D67A;width:${notes.length ? con / notes.length * 100 : 0}%"></b></div>
    <h4 class="kg-h4">Most connected notes</h4>${top.map(([n, d]) => `<div class="kg-row" role="button" tabindex="0" data-a="gsel" data-v="${esc(n.id)}"><i style="--c:${colOf(n.p || '')}"></i><span>${esc(n.l)}</span><small>${d}</small></div>`).join('') || '<p class="muted sm">No notes yet.</p>'}</section>
  <section class="card"><div class="card-h"><h2>Live Activity</h2>${chip('live', 'Changes the tracker pushed to this page since you opened it, and Sync All runs. Nothing older is recorded.')}</div>
    <div class="kg-act">${activity.length ? activity.map(a => `<div class="kg-ai ${a.c}"><i></i><span>${esc(a.t)}</span><time>${ago(a.at)}</time></div>`).join('') : '<p class="muted sm">No changes since this page opened. Edits to the vault show up here within a second.</p>'}</div>
    ${recentRel.length ? `<h4 class="kg-h4">Recent relationships</h4>${recentRel.slice(0, 8).map(l => `<div class="kg-row" role="button" tabindex="0" data-a="gsel" data-v="${esc(l.a)}"><span>${esc(nm(l.a))} <small>→</small> ${esc(nm(l.b))}</span><small>${esc(REL[l.r] || l.r)}</small></div>`).join('')}` : ''}
    <p class="muted sm">graph.json last built ${(st || snap?.stats)?.graph?.built ? when((st || snap.stats).graph.built) : 'never'}.</p></section>`;
}
function log(t, c = '') { activity.unshift({ t, c, at: Date.now() }); activity.length = Math.min(activity.length, 30); }
function logPatch(p) {
  const n = p.add.length, u = p.update.length, x = p.remove.length, la = p.linksAdd.length, lr = p.linksRemove.length; if (!(n + u + x + la + lr)) return;
  log([n && `+${n} node${n > 1 ? 's' : ''}`, x && `−${x} node${x > 1 ? 's' : ''}`, u && `${u} updated`, la && `+${la} link${la > 1 ? 's' : ''}`, lr && `−${lr} link${lr > 1 ? 's' : ''}`].filter(Boolean).join(' · '), x || lr ? 'w' : 'ok');
  recentRel.unshift(...p.linksAdd.filter(l => l.r === 'references' || l.r === 'mentions')); recentRel.length = Math.min(recentRel.length, 20);
}
// ---------- panel resize + Focus Mode ----------
const RZ = { ex: ['--w1', 240, 480, 300], rn: ['--w2', 240, 480, 320], gh: ['--gh', 360, 900, 540] };
function setRz(h, k, v) { const [cv, lo, hi] = RZ[k]; ui.pw[k] = Math.round(Math.min(hi, Math.max(lo, v))); h.closest('.kg-ov')?.style.setProperty(cv, ui.pw[k] + 'px'); G?.resize(); }
function onRz(e) {
  const h = e.target.closest('.kg-rz'); if (!h || e.button) return; e.preventDefault();
  const k = h.dataset.rz, v0 = ui.pw[k], x0 = e.clientX, y0 = e.clientY; h.setPointerCapture(e.pointerId); h.classList.add('on'); document.body.classList.add('kg-drag');
  const mv = ev => setRz(h, k, v0 + (k === 'gh' ? ev.clientY - y0 : ev.clientX - x0));
  const up = () => { h.classList.remove('on'); document.body.classList.remove('kg-drag'); h.removeEventListener('pointermove', mv); keep(); };
  h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up, { once: true }); h.addEventListener('lostpointercapture', up, { once: true });
}
function rzKey(e) { const h = e.target.closest?.('.kg-rz'); if (!h) return; const k = h.dataset.rz, d = { ArrowLeft: -16, ArrowUp: -16, ArrowRight: 16, ArrowDown: 16 }[e.key]; if (d) { e.preventDefault(); setRz(h, k, ui.pw[k] + d); keep(); } }
// Focus Mode: the graph box moves to <body> (a transformed card would trap position:fixed)
function zen(on) { if (!gbox || on === gbox.classList.contains('zen')) return; gbox.classList.toggle('zen', on); if (on) document.body.append(gbox); else if ($('k-slot')) $('k-slot').append(gbox); document.body.classList.toggle('kg-zen-on', on); gbox.querySelector('[data-a="gzen"]')?.setAttribute('aria-pressed', on); G?.resize(); }
function zenKey(e) { if (e.key === 'Escape' && gbox?.classList.contains('zen') && !document.querySelector('dialog[open]')) zen(false); }
function exporter() {
  const X = [['graph', 'i-graph', 'Live graph (JSON)', 'Every node and link the page shows, with cluster, community and source.'], ['notes', 'i-book', 'Notes (CSV)', 'Path, folder, modified, created, tags, cluster, links.'],
    ['tags', 'i-layers', 'Tags (CSV)', 'Tag and note count.'], ['problems', 'i-x', 'Unresolved links (CSV)', 'Link target and count.'], ['stats', 'i-chart', 'Vault statistics (JSON)', 'Every number on this page.']];
  return `<section class="card enter"><div class="card-h"><h2>Export</h2>${lm('kg-exp', 'Export')}<span class="muted sm">Downloads only. Nothing in the vault changes.</span><div class="end"><button class="btn" data-a="openGraph">${icon('i-graph')}Open graph.html</button></div></div>
  <div class="kg-xg">${X.map(([k, ic, t, s]) => `<button class="kg-x" data-a="exp" data-v="${k}">${icon(ic)}<b>${t}</b><small>${s}</small></button>`).join('')}</div></section>`;
}

// ---------- chart (created / modified / attachments per bucket) ----------
function drawChart() {
  const el = $('k-chart'), S = st || snap?.stats; if (!el || !S?.series) return;
  const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
  const D = 864e5, end = new Date(); end.setHours(0, 0, 0, 0); const E = end.getTime() + D, births = S.series.map(s => s[0]).filter(Boolean);
  const span = ui.range === 'all' ? Math.max(7, Math.ceil((E - Math.min(E - 7 * D, ...births)) / D)) : +ui.range, step = Math.max(1, Math.ceil(span / 45)), nB = Math.ceil(span / step), start = E - nB * step * D;
  const b = () => new Array(nB).fill(0), cr = b(), mo = b(), at = b(), put = (a, t) => { if (t >= start && t < E) a[Math.floor((t - start) / (step * D))]++; };
  for (const [c, m] of S.series) { put(cr, c); put(mo, m); } for (const t of S.attSeries || []) put(at, t);
  const keys = cr.map((_, i) => new Date(start + i * step * D)), lab = d => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const L = 34, R = 10, T = 10, Bm = 22, iw = W - L - R, ih = H - T - Bm, mx = Math.max(4, ...cr, ...mo, ...at), e = 10 ** Math.floor(Math.log10(mx)), f = mx / e, m = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
  const x = i => L + (nB < 2 ? iw / 2 : i / (nB - 1) * iw), y = v => T + ih - v / m * ih;
  const path = a => a.map((v, i) => i ? `C${(x(i - 1) + x(i)) / 2},${y(a[i - 1])} ${(x(i - 1) + x(i)) / 2},${y(v)} ${x(i)},${y(v)}` : `M${x(0)},${y(v)}`).join('');
  const S3 = [[cr, '#31D67A', 'Created'], [mo, '#A26BFF', 'Modified'], [at, '#3D8BFF', 'Attachments']];
  let g = ''; for (let i = 0; i <= 3; i++) { const yy = T + ih * i / 3; g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 7}" y="${yy + 4}" text-anchor="end">${Math.round(m * (1 - i / 3))}</text>`; }
  const ev = Math.max(1, Math.ceil(nB / Math.max(2, Math.floor(iw / 62)))); keys.forEach((k, i) => { if ((nB - 1 - i) % ev === 0) g += `<text x="${x(i)}" y="${H - 5}" text-anchor="${i === nB - 1 ? 'end' : 'middle'}">${lab(k)}</text>`; });
  const hw = nB < 2 ? iw : iw / (nB - 1), hits = keys.map((k, i) => `<rect class="hit" x="${x(i) - hw / 2}" y="${T}" width="${hw}" height="${ih}" data-html="1" data-tip="${esc(`<b>${lab(k)}${step > 1 ? ' – ' + lab(new Date(+k + (step - 1) * D)) : ''}</b><br>Created ${cr[i]} · Modified ${mo[i]} · Attachments ${at[i]}`)}"/>`).join('');
  const tot = a => a.reduce((x, y) => x + y, 0), bi = cr.map((v, i) => v + mo[i] + at[i]).reduce((b, v, i, A) => v > A[b] ? i : b, 0); // U4: one-sentence summary for screen readers
  const sum = `Vault statistics, ${lab(keys[0])} to ${lab(new Date(E - D))}: ${tot(cr)} notes created, ${tot(mo)} modified, ${tot(at)} attachments added${tot(cr) + tot(mo) + tot(at) ? `; busiest ${step > 1 ? 'period' : 'day'} ${lab(keys[bi])}` : ''}.`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="kg-svg" role="img" aria-label="${esc(sum)}"><defs>${S3.map(([, c], j) => `<linearGradient id="kgg${j}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".28"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>`).join('')}</defs>${g}
    ${S3.map(([a, c], j) => `<path d="${path(a)}L${x(nB - 1)},${T + ih}L${x(0)},${T + ih}Z" fill="url(#kgg${j})"/><path class="kg-pl" d="${path(a)}" stroke="${c}" pathLength="1"/>${nB <= 31 ? a.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="2.6" fill="${c}"/>`).join('') : ''}`).join('')}${hits}</svg>`;
}

// ---------- 3D graph (lazy: three.js loads only here) ----------
function makeGbox() {
  gbox = document.createElement('div'); gbox.className = 'kg-gbox';
  gbox.innerHTML = `<div class="card-h kg-gh"><h2>${icon('i-graph')}Knowledge Graph</h2>${lm('kg-graph', 'Knowledge Graph')}<span class="kg-live" id="k-live"></span><div class="end">
    <label class="field kg-gq">${icon('i-search')}<input id="k-gq" placeholder="Find a node…" autocomplete="off" aria-label="Find a node"><div class="drop" id="k-gdrop" role="listbox"></div></label>
    <select class="btn sm" id="k-dim" aria-label="View"><option value="3d">3D View</option><option value="2d">2D View</option></select>
    <select class="btn sm" id="k-mode" aria-label="Grouping" data-tip="NEXUS clusters (fixed rules) or Graphify's own communities from graph.json"><option value="nexus">NEXUS Clusters</option><option value="graphify">Graphify Communities</option></select>
    <button class="btn sm ghost" data-a="greset" aria-label="Reset view" data-tip="Reset view">${icon('i-undo')}</button><button class="btn sm ghost" data-a="gzen" aria-label="Focus Mode" aria-pressed="false" data-tip="Focus Mode: only the graph (Esc leaves)">${icon('i-focus')}</button><button class="btn sm ghost" data-a="gfs" aria-label="Fullscreen" data-tip="Fullscreen">${icon('i-layers')}</button></div></div>
  <div class="kg-fil" id="k-fil"></div>
  <div class="g3w"><div class="g3" id="k-g3" role="group" aria-label="Knowledge graph (3D). Use Find a node to reach a node by keyboard."><div id="k-g3st">${stateBox('loading', 'Starting the 3D graph…')}</div></div><div class="g3-leg" id="k-leg"></div><aside class="g3-det" id="k-det" hidden></aside><div class="g3-tip" id="k-gtip" hidden></div>
  <div class="g3-help">Drag to rotate · right-drag to pan · scroll to zoom · click a node · double-click a cluster to collapse it</div><div class="g3-perf" id="k-perf"></div></div>`;
  gbox.addEventListener('click', onClick); gbox.addEventListener('input', onInput); gbox.addEventListener('change', onInput);
  gbox.querySelector('#k-dim').value = ui.dim; gbox.querySelector('#k-mode').value = ui.mode; filters();
  gbox.querySelector('#k-gq').addEventListener('keydown', e => { const h = gbox.querySelectorAll('#k-gdrop [data-v]'); if (e.key === 'Enter' && h[0]) h[0].click(); if (e.key === 'Escape') e.target.blur(); });
  gbox.querySelector('#k-gq').addEventListener('blur', () => setTimeout(() => gbox?.querySelector('#k-gdrop').classList.remove('open'), 150));
}
function filters() { const c = snap ? FILTERS.map(([k]) => [k, k === 'all' ? snap.nodes.size : [...snap.nodes.values()].filter(n => FF[k](orphanable(n))).length]) : [];
  gbox.querySelector('#k-fil').innerHTML = seg(FILTERS.map(([k, t], i) => [k, t + (c[i] ? ` ${c[i][1]}` : '')]), ui.filter, 'tabs kg-chips'); }
const orphanable = n => n.rdeg != null ? n : { ...n, rdeg: snap.links.size && [...snap.links.values()].some(l => (l.r === 'references' || l.r === 'mentions') && (l.a === n.id || l.b === n.id)) ? 1 : 0 };
function parkGraph() {
  const slot = $('k-slot'); if (slot) { if (gbox.parentNode !== slot && !gbox.classList.contains('zen')) slot.append(gbox); G?.pause(false); G?.resize(); } else { zen(false); gbox.remove(); G?.pause(true); }
  if (snap) filters(); legend(); liveLine();
}
async function initGraph() {
  if (gInit) return; gInit = true;
  try {
    const m = await import('../graph3d.js'); if (!root) return;
    const host = gbox.querySelector('#k-g3'); host.querySelector('#k-g3st')?.remove();
    G = m.createGraph(host, { onSelect: detail, onHover: hoverTip });
    G.setMode(ui.mode); G.setDim(ui.dim === '3d'); G.setFilter(FF[ui.filter]); if (snap) G.setData([...snap.nodes.values()], [...snap.links.values()]);
    if (!$('k-slot')) G.pause(true); legend(); if (ui.tab === 'analytics') draw();
    perfT = setInterval(() => { const p = gbox?.querySelector('#k-perf'); if (!p || !G) return; const s = G.stats(); p.textContent = s.running ? `${s.fps} fps · ${s.nodes} nodes · ${s.links} links · quality ${['high', 'medium', 'low', 'lowest'][s.tier]}${s.reduced ? ' · reduced motion' : ''}` : 'paused'; }, 1000);
    window.nexus.graph = G; // diagnostics only (G.stats(), G.state())
  } catch (e) { const h = gbox.querySelector('#k-g3'); h.innerHTML = stateBox('error', 'The 3D graph could not start.', esc(e.message) + '. WebGL may be off in this browser. The rest of the page works.'); console.error(e); }
}
function legend() {
  const el = gbox?.querySelector('#k-leg'); if (!el || !G) return;
  el.innerHTML = G.hubs().map(h => `<div class="g3-li${h.collapsed ? ' off' : ''}${h.count ? '' : ' empty'}"><button data-a="ghub" data-v="${esc(h.k)}" data-tip="${esc(h.rule)}"><i style="--c:${h.color}"></i>${esc(h.name)}<small>${h.count}</small></button><button class="g3-eye" data-a="gcol" data-v="${esc(h.k)}" aria-label="${h.collapsed ? 'Expand' : 'Collapse'} ${esc(h.name)}" data-tip="${h.collapsed ? 'Expand' : 'Collapse'} this cluster">${h.collapsed ? '+' : '–'}</button></div>`).join('');
}
function hoverTip(i, e) {
  const t = gbox?.querySelector('#k-gtip'); if (!t) return; if (!i) { t.hidden = true; return; }
  const r = gbox.querySelector('.g3w').getBoundingClientRect(); t.hidden = false;
  t.innerHTML = i.hub ? `<b style="color:${i.color}">${esc(i.name)}</b><small>${i.count} nodes · click for details</small>` : `<b style="color:${i.color}">${esc(i.l)}</b><small>${esc(i.cluster || '')} · ${i.nbs.length} link${i.nbs.length === 1 ? '' : 's'}</small>`;
  t.style.left = Math.min(r.width - 220, e.clientX - r.left + 14) + 'px'; t.style.top = (e.clientY - r.top + 14) + 'px';
}
function detail(i) {
  const d = gbox?.querySelector('#k-det'); if (!d) return; legend(); if (!i) { d.hidden = true; return; } d.hidden = false;
  if (i.hub) { d.innerHTML = `<div class="g3-dh"><i style="--c:${i.color}"></i><b>${esc(i.name)}</b><button class="btn sm ghost" data-a="gclose" aria-label="Close">${icon('i-x')}</button></div>
    <p class="muted sm">${esc(i.rule)}</p><div class="kg-kv"><div><span>Nodes</span><b>${i.count}</b></div></div>
    ${i.top.length ? `<h4>Most connected</h4>${i.top.map(n => `<div class="kg-row kg-ln" role="button" tabindex="0" data-a="gsel" data-v="${esc(n.id)}">${icon('i-graph')}<span>${esc(n.l)}</span><small>${n.d}</small></div>`).join('')}` : '<p class="muted sm">0 notes match this cluster\'s rule yet.</p>'}
    <div class="g3-da"><button class="btn sm" data-a="gcol" data-v="${esc(i.k)}">${i.collapsed ? 'Expand cluster' : 'Collapse cluster'}</button></div>`; return; }
  const src = { graphify: ['ok', 'In graph.json', 'Graphify has this node; the live vault still has it.'], live: ['n', 'New · not in graph.json yet', 'Found in the live vault; Graphify adds it on the next Sync All.'], nexus: ['c', 'NEXUS project', 'From projects.json (Projects page). Not part of Graphify.'] }[i.o] || ['u', i.o, ''];
  const by = {}; for (const n of i.nbs) (by[n.r] ||= []).push(n);
  d.innerHTML = `<div class="g3-dh"><i style="--c:${i.color}"></i><b>${esc(i.l)}</b><button class="btn sm ghost" data-a="gclose" aria-label="Close">${icon('i-x')}</button></div>
  <div class="g3-tags"><span class="tg">${esc(i.cluster || '—')}</span><span class="tg">${esc(i.t || 'node')}</span><span class="tg ${src[0]}" data-tip="${esc(src[2])}">${esc(src[1])}</span></div>
  <div class="kg-kv"><div><span>Group</span><b>${esc(i.g || '—')}</b></div><div><span>Community</span><b>${i.c == null ? '—' : esc(i.cn || 'Community ' + i.c)}</b></div><div><span>Links</span><b>${i.nbs.length}</b></div>${i.p ? `<div class="full"><span>File</span><b class="mono">${esc(i.p)}</b></div>` : i.s ? `<div class="full"><span>Source</span><b class="mono">${esc(String(i.s).replace(/^.*[\\/](\.claude|Desktop)[\\/]/, '…/$1/'))}</b></div>` : ''}</div>
  ${i.tags?.length ? `<div class="g3-tags">${i.tags.map(t => `<span class="kg-tag">#${esc(t)}</span>`).join('')}</div>` : ''}
  <h4>Connections</h4><div class="g3-nb">${Object.entries(by).map(([r, a]) => `<small class="g3-rel">${esc(REL[r] || r)} · ${a.length}</small>${a.slice(0, 12).map(n => `<div class="kg-row kg-ln" role="button" tabindex="0" data-a="gsel" data-v="${esc(n.id)}"><i style="--c:${n.color}"></i><span>${esc(n.l)}</span></div>`).join('')}${a.length > 12 ? `<small class="muted">+${a.length - 12} more</small>` : ''}`).join('') || '<p class="muted sm">No connections.</p>'}</div>
  <div class="g3-da">${i.note ? `<button class="btn sm pri" data-note="${esc(i.note)}">${icon('i-book')}Open note</button><button class="btn sm" data-a="obsNote" data-v="${esc(i.note)}">Open in Obsidian</button>` : ''}<button class="btn sm" data-a="gfocus" data-v="${esc(i.id)}">Center</button></div>`; paint();
}
function onFs() { G?.resize(); gbox?.classList.toggle('fs', document.fullscreenElement === gbox); }

// ---------- markdown (preview only: escape first, then a small subset) ----------
function md(t) {
  let fm = ''; t = t.replace(/\r\n?/g, '\n').replace(/^---\n([\s\S]*?)\n---\n?/, (_, b) => { fm = `<div class="kg-fm">${b.split('\n').filter(Boolean).map(l => { const [k, ...v] = l.split(':'); return `<div><span>${esc(k.trim())}</span><b>${esc(v.join(':').trim())}</b></div>`; }).join('')}</div>`; return ''; });
  const inl = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>').replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/!?\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, a, h, l) => `<a class="kg-wl" data-wl="${a}">${l || a}${h && !l ? h : ''}</a>`)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>').replace(/(^|\s)#([\w/-]+)/g, '$1<span class="kg-tag">#$2</span>');
  const out = [], L = t.split('\n'); let i = 0, list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  while (i < L.length) {
    const l = L[i];
    if (/^```/.test(l)) { close(); const a = []; i++; while (i < L.length && !/^```/.test(L[i])) a.push(L[i++]); i++; out.push(`<pre><code>${esc(a.join('\n'))}</code></pre>`); continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(L[i + 1] || '')) { close(); const row = (r, c) => '<tr>' + r.trim().replace(/^\||\|$/g, '').split('|').map(x => `<${c}>${inl(x.trim())}</${c}>`).join('') + '</tr>'; let h = '<table>' + row(l, 'th'); i += 2; while (i < L.length && /^\s*\|/.test(L[i])) h += row(L[i++], 'td'); out.push(h + '</table>'); continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.*)/.exec(l))) { close(); out.push(`<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`); }
    else if (/^\s*([-*_])\1\1+\s*$/.test(l)) { close(); out.push('<hr>'); }
    else if ((m = /^\s*>\s?(.*)/.exec(l))) { close(); out.push(`<blockquote>${inl(m[1])}</blockquote>`); }
    else if ((m = /^(\s*)([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?(.*)/.exec(l))) { const k = /\d/.test(m[2]) ? 'ol' : 'ul'; if (list !== k) { close(); out.push(`<${k}>`); list = k; }
      out.push(`<li style="margin-left:${Math.floor(m[1].length / 2) * 16}px">${m[3] ? `<input type="checkbox" disabled${/x/i.test(m[3]) ? ' checked' : ''}> ` : ''}${inl(m[4])}</li>`); }
    else if (!l.trim()) close();
    else { close(); out.push(`<p>${inl(l)}</p>`); }
    i++;
  }
  close(); return fm + out.join('');
}

// ---------- line diff (LCS) for the save confirm ----------
function diff(a, b) {
  a = a.replace(/\r\n?/g, '\n').split('\n'); b = b.replace(/\r\n?/g, '\n').split('\n');
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const A = a.slice(s, a.length - e), B = b.slice(s, b.length - e), n = A.length, m = B.length, ops = [];
  if (n * m > 4e6) { A.forEach(x => ops.push(['-', x])); B.forEach(x => ops.push(['+', x])); } // ponytail: huge rewrite shows as replace-all; LCS would be O(n·m)
  else { const T = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1)); for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i][j] = A[i] === B[j] ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
    let i = 0, j = 0; while (i < n || j < m) { if (i < n && j < m && A[i] === B[j]) { ops.push([' ', A[i]]); i++; j++; } else if (j < m && (i >= n || T[i][j + 1] >= T[i + 1][j])) ops.push(['+', B[j++]]); else ops.push(['-', A[i++]]); } }
  const pre = a.slice(Math.max(0, s - 2), s).map(x => [' ', x]), post = a.slice(a.length - e, a.length - e + 2).map(x => [' ', x]);
  return { ops: [...pre, ...ops.filter((o, k, X) => o[0] !== ' ' || X.slice(Math.max(0, k - 2), k + 3).some(z => z[0] !== ' ')), ...post], add: ops.filter(o => o[0] === '+').length, del: ops.filter(o => o[0] === '-').length, at: s + 1 };
}

// ---------- dialogs ----------
function dlg(h) { const d = $('k-dlg'); d.innerHTML = `<form method="dialog" class="lx-f">${h}</form>`; if (!d.open) d.showModal(); paint(); return d; }
const head = (ic, t) => `<div class="card-h">${icon(ic)}<h2 id="k-dlg-t">${t}</h2><div class="end"><button class="btn sm ghost" value="x" aria-label="Close">${icon('i-x')}</button></div></div>`;
function ask(title, msg, ok, ic = 'i-shield') {
  return new Promise(res => { const d = dlg(head(ic, esc(title)) + `<p class="kg-ask">${esc(msg)}</p><div class="lx-fa"><button class="btn ghost" value="x">Cancel</button><button class="btn pri" value="ok">${esc(ok)}</button></div>`);
    d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true }); });
}
const TITLE = { create: "Couldn't create the note", fromTemplate: "Couldn't create the note", daily: "Couldn't open today's note", mkdir: "Couldn't create the folder", templatesInit: "Couldn't add the templates", open: "Couldn't open it" };
async function act(o, okMsg) { // POST; when the tracker asks for a confirm, show its question, then send again with confirm: true
  let r = await post(o);
  if (r.res === 'confirm') { if (!await ask('Please confirm', r.ask, 'Yes, create it')) return null; r = await post({ ...o, confirm: true }); }
  if (r.res !== 'ok') { toast(why(r.res), 'err', o.what === 'note' || o.what === 'vault' ? "Couldn't open in Obsidian" : TITLE[o.op] || "Couldn't finish that"); return null; } // E3
  if (okMsg) toast(okMsg); statusSoon(); return r;
}
function folders() { const a = [['', st?.vaultName || 'Vault root']], go = (x, pre) => { for (const f of x) if (f.d) { a.push([f.p, pre + f.n]); go(f.d, pre + f.n + ' / '); } }; go(st?.tree || [], ''); return a; }
function newDlg(kind, tpl) {
  const cur = ui.note ? dirOf(ui.note) : '', T = st?.templates || [];
  dlg(head(kind === 'folder' ? 'i-folder' : 'i-plus-folder', kind === 'folder' ? 'New Folder' : 'New Note') + `<div class="pj-form">
    <label>${kind === 'folder' ? 'Folder' : 'Note'} name<input class="pj-in" name="name" maxlength="120" required placeholder="${kind === 'folder' ? 'Ideas' : 'My new note'}"></label>
    <label>In folder<select class="btn" name="dir">${folders().map(([p, t]) => `<option value="${esc(p)}"${p === cur ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    ${kind === 'folder' ? '' : `<label>Template<select class="btn" name="tpl"><option value="">None (title only)</option>${T.map(t => `<option${t === tpl ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`}
    <p class="muted sm">Creates one new ${kind === 'folder' ? 'folder' : '.md file'}. Existing files are never overwritten.</p></div>
  <div class="lx-fa"><button class="btn ghost" value="x">Cancel</button><button class="btn pri" type="button" data-a="${kind === 'folder' ? 'doFolder' : 'doNote'}">${icon('i-check')}Create</button></div>`);
  $('k-dlg').querySelector('[name="name"]').focus();
}
function syncDlg() {
  if (syncS?.running) return syncView(true);
  dlg(head('i-undo', 'Sync All') + `<p class="kg-ask">Runs <code>bash sync_docs.sh</code> in the active project:</p><ul class="kg-ul"><li>two-way merge of the project docs and the vault notes (Obsidian edits are pulled back),</li><li>Graphify rebuilds <code>graphify-out/graph.json</code> and the Knowledge Graph note,</li><li>if both sides changed the same lines it reports <b>CONFLICT</b>, changes neither file and saves both versions in <code>backups/sync_conflicts/</code>. NEXUS never resolves conflicts: you choose.</li></ul>
  <div class="lx-fa"><button class="btn ghost" value="x">Cancel</button><button class="btn pri" type="button" data-a="doSync">${icon('i-undo')}Run Sync All</button></div>`);
}
function syncView(open) {
  const d = $('k-dlg'); if (!d || (!open && !(d.open && d.querySelector('#k-sync')))) return;
  const s = syncS || {}, res = !s.running && s.code != null;
  dlg(head('i-undo', 'Sync All') + `<div id="k-sync">${s.lost || s.gone ? `<div class="kg-sres bad" id="k-sunk"><b>Sync All: outcome unknown</b><p class="kg-ask">${s.gone ? 'The tracker answered again but has no record of this run (it may have restarted). Check the project docs and the vault, then run Sync All again if needed.' : 'Lost contact with the tracker. Sync All may still be running or may have finished; the result shows here once the tracker answers. This is not shown as a failure.'}</p></div>` : s.running ? `<p class="kg-ask"><span class="spin"></span> Running sync_docs.sh…</p>` : res ? `<div class="kg-sres ${s.failed ? 'bad' : 'good'}">
    <b>${s.failed ? 'Finished with problems' : 'Done'}</b> in ${(s.ms / 1000).toFixed(1)} s · exit code ${s.code}
    <div class="kg-kv"><div><span>Files written</span><b>${s.written.length}</b></div><div><span>Unresolved links</span><b class="${s.unresolved ? 'warn' : ''}">${s.unresolved ?? '—'}</b></div><div><span>Conflicts</span><b class="${s.conflicts.length ? 'warn' : ''}">${s.conflicts.length}</b></div><div><span>Broken links</span><b class="${s.broken.length ? 'warn' : ''}">${s.broken.length}</b></div></div>
    ${s.conflicts.length ? `<p class="kg-bad">${s.conflicts.map(esc).join('<br>')}<br>Both versions are saved in backups/sync_conflicts/. Pick the version to keep, write it to both files, then run Sync All again.</p>` : ''}
    ${s.written.length ? `<details><summary>Files written</summary><p class="mono sm">${s.written.map(esc).join('<br>')}</p></details>` : ''}</div>` : ''}
    <pre class="kg-log" id="k-log">${esc((s.lines || []).join('\n'))}</pre></div>
  <div class="lx-fa"><button class="btn ${s.running && !s.lost ? 'ghost' : 'pri'}" value="x">${s.running && !s.lost ? 'Hide (keeps running)' : 'Close'}</button></div>`);
  const lg = $('k-log'); if (lg) lg.scrollTop = lg.scrollHeight;
}
function leaveEdit() { if (!edit || edit.text === edit.orig || confirm('Discard your unsaved changes to this note?')) { edit = null; return true; } return false; }
function reviewDlg() {
  const t = $('k-ed')?.value ?? edit.text; edit.text = t; const D = diff(edit.orig, t);
  if (!D.add && !D.del) return toast('No changes to save.');
  dlg(head('i-code', 'Review changes: ' + esc(base(det.p))) + `<p class="muted sm">${D.add} line${D.add === 1 ? '' : 's'} added · ${D.del} removed (from line ${D.at}). The current file is backed up to the NEXUS data folder (vault-backups) before saving.</p>
  <pre class="kg-diff">${D.ops.slice(0, 600).map(([k, x]) => `<span class="${k === '+' ? 'add' : k === '-' ? 'del' : ''}">${k} ${esc(x)}</span>`).join('\n')}${D.ops.length > 600 ? `\n… ${D.ops.length - 600} more lines` : ''}</pre>
  <div class="lx-fa"><button class="btn ghost" value="x">Keep editing</button><button class="btn pri" type="button" data-a="doSave">${icon('i-check')}Save changes</button></div>`);
}
const csv = rows => rows.map(r => r.map(v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : v ?? '').join(',')).join('\n');
function exp(k) {
  const S = st || snap?.stats, N = snap ? [...snap.nodes.values()] : [], L = snap ? [...snap.links.values()] : [], d = new Date().toLocaleDateString('en-CA');
  if (k === 'graph') return download(`nexus-graph-${d}.json`, JSON.stringify({ exported: new Date().toISOString(), version: live.v, nodes: N, links: L }, null, 1), 'application/json');
  if (k === 'notes') return download(`vault-notes-${d}.csv`, csv([['path', 'folder', 'modified', 'tags', 'cluster', 'community', 'links', 'in_graph_json'], ...N.filter(n => n.id.startsWith('note_')).map(n => [n.p, dirOf(n.p || ''), n.mt ? new Date(n.mt).toISOString() : '', (n.tags || []).join(' '), n.k, n.cn ?? n.c ?? '', L.filter(l => l.a === n.id || l.b === n.id).length, n.o === 'graphify'])]));
  if (k === 'tags') return download(`vault-tags-${d}.csv`, csv([['tag', 'notes'], ...allTags()]));
  if (k === 'problems') return download(`vault-unresolved-${d}.csv`, csv([['link target', 'count'], ...(S.graph?.unresolvedList || [])]));
  if (k === 'stats') { const { series, attSeries, ...o } = S; return download(`vault-stats-${d}.json`, JSON.stringify(o, null, 1), 'application/json'); }
}

// ---------- events ----------
async function runSync() { if (live.off) connect(); play('sync'); syncS = { running: true, lines: [] }; syncView(true); const r = await post({ op: 'sync', confirm: true }); if (r.res !== 'ok') { syncS = null; $('k-dlg').close(); toast(why(r.res), 'err', "Couldn't start Sync All"); } }
async function saveNote(b) { // b: the review dialog's Save button (none when Settings turned the review step off)
  if (b) b.disabled = true; const r = await post({ op: 'save', p: edit.p, text: edit.text, base: det.hash, confirm: true });
  if (r.res !== 'ok') { if (b) b.disabled = down; return toast(why(r.res) + ' Your text is still in the editor.', 'err', "Couldn't save the note"); }
  if ($('k-dlg')?.open) $('k-dlg').close(); edit = null; toast('Saved. Backup: ' + r.backup.split(/[\\/]/).slice(-3).join('/')); loadNote(r.p, true);
}
async function onClick(e) {
  if (e._kg) return; e._kg = 1; // the graph box sits inside the page: one handler per event
  const tab = e.target.closest('#k-rng [data-v]'); if (tab) { ui.range = tab.dataset.v; keep(); $('k-rng').innerHTML = seg(RANGES, ui.range); return drawChart(); }
  const fb = e.target.closest('#k-fil [data-v]'); if (fb) { ui.filter = fb.dataset.v; keep(); G?.setFilter(FF[ui.filter]); return filters(); }
  const wl = e.target.closest('[data-wl]'); if (wl) { const t = wl.dataset.wl.trim().toLowerCase(), o = det?.out.find(x => x.l.toLowerCase() === t.split('/').pop()) || snap?.nodes.get('note_' + slug(t.split('/').pop())); return o?.p ? openNote(o.p) : toast('No note named "' + wl.dataset.wl + '" (unresolved link).', 'err'); }
  const dir = e.target.closest('[data-dir]'); if (dir) { const p = dir.dataset.dir; ui.open[p] ? delete ui.open[p] : ui.open[p] = 1; keep(); return $('k-tree') && ($('k-tree').innerHTML = treeHtml()); }
  const nt = e.target.closest('[data-note]'); if (nt && !e.target.closest('[data-a]')) { e.preventDefault(); return openNote(nt.dataset.note); }
  const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a, v = b.dataset.v;
  if (b.disabled) return; b.closest('details')?.removeAttribute('open');
  if (a === 'kRetry') { clearTimeout(live.t); connect(); if (live.ok) loadStatus(); return; } // the waiting reconnect, now
  if (a === 'tab') location.hash = '#/knowledge/' + v;
  else if (a === 'refresh') { loadStatus(); if (live.off) connect(); toast('Re-reading the vault…'); }
  else if (a === 'copy') { navigator.clipboard?.writeText(v).then(() => toast('Copied.'), () => toast('Copy failed.', 'err')); }
  else if (a === 'openVault') act({ op: 'open', what: 'vault' }, 'Opening the vault in Obsidian…');
  else if (a === 'openFolder') act({ op: 'open', what: 'folder' });
  else if (a === 'openGraph') act({ op: 'open', what: 'graph' }, 'Opening graph.html…');
  else if (a === 'obsNote') act({ op: 'open', what: 'note', p: v || det?.p }, 'Opening in Obsidian…');
  else if (a === 'sync') { if (P.pref('au.confirmSync') || syncS?.running) syncDlg(); else runSync(); } // Settings → Automation: confirm before Sync All
  else if (a === 'doSync') runSync();
  else if (a === 'newNote') newDlg('note', v);
  else if (a === 'newFolder') newDlg('folder');
  else if (a === 'doNote' || a === 'doFolder') {
    const f = $('k-dlg').querySelector('form'), name = f.name.value.trim(); if (!name) return f.name.focus();
    const tpl = f.tpl?.value, r = await act(a === 'doFolder' ? { op: 'mkdir', dir: f.dir.value, name } : tpl ? { op: 'fromTemplate', dir: f.dir.value, name, template: tpl } : { op: 'create', dir: f.dir.value, name }, a === 'doFolder' ? 'Folder created.' : 'Note created.');
    if (r) { $('k-dlg').close(); if (a === 'doFolder') { ui.open[f.dir.value] = 1; ui.open[r.p] = 1; keep(); } else openNote(r.p); }
  }
  else if (a === 'daily') { const r = await act({ op: 'daily' }); if (r) { if (!r.existed) toast('Today\'s note created.'); openNote(r.p); } }
  else if (a === 'tplInit') { const r = await act({ op: 'templatesInit' }); if (r) toast(r.made.length ? 'Added ' + r.made.join(', ') + '.' : 'All starter templates already exist.'); }
  else if (a === 'tag') { ui.tag = v; keep(); if (ui.tab !== 'tags') location.hash = '#/knowledge/tags'; else draw(); }
  else if (a === 'edit') { if (det && !det.readOnly) { const t = det.text.replace(/\r\n?/g, '\n'); edit = { p: det.p, orig: t, text: t }; draw(); $('k-ed')?.focus(); } }
  else if (a === 'cancelEdit') { if (leaveEdit()) draw(); }
  else if (a === 'review') { if (P.pref('obs.confirm')) reviewDlg(); else { const t = $('k-ed')?.value ?? edit.text; edit.text = t; if (t === edit.orig) toast('No changes to save.'); else saveNote(); } }
  else if (a === 'doSave') saveNote(b);
  else if (a === 'showGraph') { const id = det?.id; location.hash = '#/knowledge/graph'; setTimeout(() => detail(G?.select(id)), 250); }
  else if (a === 'exp') exp(v);
  else if (a === 'greset') { G?.reset(); detail(null); }
  else if (a === 'gfs') { document.fullscreenElement ? document.exitFullscreen() : gbox.requestFullscreen?.().catch(() => toast('Fullscreen is blocked here.', 'err')); }
  else if (a === 'gclose') { G?.select(null, false); detail(null); }
  else if (a === 'gsel' || a === 'gfocus') { if (!$('k-slot')) location.hash = '#/knowledge/graph'; setTimeout(() => detail(G?.select(v)), $('k-slot') ? 0 : 250); }
  else if (a === 'ghub') { if (!$('k-slot')) location.hash = '#/knowledge/graph'; setTimeout(() => detail(G?.select('hub:' + v)), $('k-slot') ? 0 : 250); }
  else if (a === 'pcol') { ui.col[v] = !ui.col[v]; keep(); draw(); }
  else if (a === 'gzen') zen(!gbox.classList.contains('zen'));
  else if (a === 'gcol') { G?.toggleCluster(v); legend(); }
}
function onInput(e) {
  if (e._kg) return; e._kg = 1; const t = e.target;
  if (t.id === 'k-dim' && e.type === 'change') { ui.dim = t.value; keep(); G?.setDim(ui.dim === '3d'); }
  else if (t.id === 'k-mode' && e.type === 'change') { ui.mode = t.value; keep(); G?.setMode(ui.mode); detail(null); legend(); }
  else if (t.id === 'k-gq' && e.type === 'input') {
    const d = gbox.querySelector('#k-gdrop'), h = G?.find(t.value) || [];
    d.innerHTML = h.length ? h.map(x => `<div class="drop-i" data-a="gsel" data-v="${esc(x.id)}"><i class="kg-cd" style="--c:${x.color}"></i>${esc(x.l)}<small>${esc(x.cluster || '')}</small></div>`).join('') : t.value.trim() ? '<div class="drop-empty">No node matches.</div>' : '';
    d.classList.toggle('open', !!t.value.trim());
  }
  else if (t.id === 'k-sq' && e.type === 'input') { ui.q = t.value; clearTimeout(sT); sT = setTimeout(runSearch, 250); }
  else if (t.id === 'k-ed') edit.text = t.value;
}
