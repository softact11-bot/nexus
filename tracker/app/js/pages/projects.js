// Projects: every folder you work in with Claude Code, as a project profile. The list is projects.json in the NEXUS data dir
// (tracker /api/projects): found from your transcript folders, or added with New / Import Project. Project files are never changed:
// New Project only creates the empty folder you confirm, backups are copied OUT of the project, Remove only drops it from this list.
// Stats come from transcripts (sessions, active time), the tracker's state.json (tokens, tools) and a folder walk (size). No polling.
import { tok, esc, chip, ago, bytes, dur } from '../fmt.js';
import { icon, seg, stateBox, kpi, setKpi, toast, download, MORE, more as lm, errBox } from '../ui.js';
import { retryText } from '../api.js';
import * as P from '../settings.js';

// M7d D3 Learn More (Projects copy, checked against tracker projects.js). Read-only unless a note says otherwise.
const RO = { tokens: 'None used', files: 'Nothing changed', privacy: 'Stays on this PC', load: 'None' };
Object.assign(MORE, {
  'pj-list': { area: 'Projects', title: 'Where projects come from', what: 'Every folder you used Claude Code in is found from its transcript folder and added automatically. New Project and Import Project add one by hand. The list is saved in NEXUS (projects.json), never in the project.',
    when: ['Checking why a folder is or is not listed.'], impact: RO, notes: ['Remove from NEXUS hides it for good: it is not added back automatically. Import it again any time.', 'Archived projects only show in the Archived tab.', 'A transcript folder that points to a deleted folder is listed in a note above the cards, not added.'], tech: 'GET /api/projects → projects.json in the NEXUS data folder (dismissed list for removed folders).' },
  'pj-ses': { area: 'Projects', title: 'Sessions', what: 'Claude Code sessions (transcripts) that ran in the project folder. The big number counts the last 7 days, rolling; all time is shown below it.',
    when: ['Seeing which projects you worked on lately.'], impact: RO, notes: ['Session folders in Project Settings add the sessions of other folders to this project.'], tech: 'projects.js stats: sessions = transcripts, week = transcripts with activity in the last 7 days.' },
  'pj-time': { area: 'Projects', title: 'Development time', what: 'An estimate of active time: the time between transcript messages, counting only gaps of 10 minutes or less. Idle time is left out.',
    when: ['Comparing roughly how much time projects took.'], impact: RO, notes: ['Not billing and not wall-clock time.', 'The big number is the last 7 days, rolling.'], tech: 'Sum of message gaps ≤ 10 min per transcript, grouped per day.' },
  'pj-store': { area: 'Projects', title: 'Project storage', what: 'The size of every file in the project folders. Folders are walked at most every 10 minutes, up to 50,000 files each; a "+" means the count stopped there.',
    when: ['Spotting a project that grew a lot.'], impact: RO, notes: ['"Changed in the last 7 days" = the size of files modified in that time.'], tech: 'projects.js walk(): cached 10 min, 50,000-file cap.' },
  'pj-status': { area: 'Projects', title: 'Status', what: 'Active, Paused, Completed and Archived are labels in NEXUS only. Nothing in the folder changes.',
    when: ['Keeping the list tidy.'], impact: { ...RO, files: 'Saves the label in projects.json (NEXUS)' }, notes: ['Archived hides the project from All and the type tabs; find it under Archived.'], tech: 'POST /api/projects { op: "update", set: { status } }.' },
  'pj-tok': { area: 'Projects', title: 'Tracked tokens', what: 'All token types (input, output, cache write, cache read) for the sessions the tracker still keeps. Older sessions are not counted.',
    when: ['Seeing roughly what a project used recently.'], impact: RO, notes: ['"N of M sessions" says how many of the project\'s sessions are counted.'], tech: 'Sum over state.json sessions whose folder belongs to the project.' },
  'pj-tasks': { area: 'Projects', title: 'Progress', what: 'Your tasks and milestones for this project. They are saved in NEXUS, not in the project folder.',
    when: ['Keeping a short to-do list next to the project.'], impact: { ...RO, files: 'Adding or ticking saves to projects.json (NEXUS)' }, notes: ['Open checklist items found in the project docs and ASSET_REGISTRY.md counts are shown read-only.'], tech: 'POST /api/projects ops addTask / task / delTask (up to 200 tasks).' },
  'pj-ins': { area: 'Projects', title: 'Insights', what: 'Fixed rules over real data. Each one says what it read: git status, backups, tracker issues (re-reads, oversized output, context rebuilds), transcript sizes, doc dates and open tasks.',
    when: ['Finding the next thing to tidy in a project.'], impact: RO, notes: ['No AI and no tokens: nothing is guessed.', 'Not a rating of the project.'], tech: 'projects.js insightsOf() in the page.' },
  'pj-bk': { area: 'Projects', title: 'Backups', what: 'Create Backup copies the text files (code, docs, configs, each up to 5 MB) to the NEXUS backups folder, outside the project. Binaries, .git, node_modules, backups/, graphify-out/ and hidden folders are skipped.',
    when: ['Before a big change you may want to undo by hand.'], impact: { tokens: 'None used', files: 'Writes a new copy outside the project; the project is not changed', privacy: 'Stays on this PC', load: 'Short disk read while copying' }, notes: ['NEXUS never restores or reverts. Copy files back yourself or use git.', 'An interrupted backup is marked Incomplete.'], tech: 'token-tracker/project-backups/<id>/<date>/' },
  'pj-vault': { area: 'Projects', title: 'Link vault', what: 'Which Obsidian vault (and folder inside it) holds this project\'s notes, how its docs sync and which graph the Knowledge page uses.',
    when: ['Setting up notes for a project.'], impact: { ...RO, files: 'Saves projects.json only (backed up first)' }, notes: ['Your vault, Obsidian settings and Graphify data are never changed here.', 'Open in Obsidian uses this vault unless Project Settings names another one.'], tech: 'POST /api/projects { op: "link" }, checked by config.js.' },
  'pj-resume': { area: 'Projects', title: 'Resume a session', what: 'Opens your terminal (Settings → Claude Code) in the project folder and runs claude --resume with that session id.',
    when: ['Continuing an earlier chat where it stopped.'], impact: { tokens: 'Uses your Claude plan once you send messages', files: 'Claude Code may change files when you ask it to', privacy: 'Like any Claude Code session', load: 'One terminal window' }, notes: ['Tokens are shown for sessions the tracker still keeps.'], tech: 'POST /api/projects { op: "open", what: "session", resume }.' },
});
const vaultOf = p => p?.obsidian || p?.vault || ''; // B82: Project Settings vault wins, else the Link Vault one
// Windows folder-name rules (B80): no \ / : * ? " < > |, no trailing dot or space, no reserved device names.
const badName = s => /[\\/:*?"<>|\x00-\x1f]/.test(s) ? 'A folder name can\'t contain \\ / : * ? " < > |' : /[. ]$/.test(s) ? 'A folder name can\'t end with a dot or a space' : /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s) ? `"${s}" is reserved by Windows` : '';
const FAIL = o => o.op === 'open' ? { explorer: "Couldn't open File Explorer", session: o.resume ? "Couldn't resume the session" : "Couldn't start Claude Code", obsidian: "Couldn't open Obsidian", reveal: "Couldn't show the file" }[o.what]
  : { backup: "Couldn't create the backup", remove: "Couldn't remove the project", addTask: "Couldn't add the task", task: "Couldn't update the task", delTask: "Couldn't delete the task", link: "Couldn't save the vault link", active: "Couldn't set the active project" }[o.op]
  || (o.op === 'add' ? (o.create ? "Couldn't create the project" : "Couldn't import the folder") : o.op === 'update' ? (Object.keys(o.set).join() === 'status' ? "Couldn't change the status" : "Couldn't save the settings") : "Couldn't finish that");

const TABS = [['all', 'All Projects'], ['roblox', 'Roblox'], ['blender', 'Blender'], ['other', 'Other'], ['archived', 'Archived']];
const TYPE = { roblox: ['Roblox', 'i-roblox', '#31D67A'], blender: ['Blender', 'i-cube', '#F2B544'], other: ['Other', 'i-folder', '#5AB8F2'] };
const STAT = { active: ['ok', 'Active'], paused: ['n', 'Paused'], completed: ['c', 'Completed'], archived: ['u', 'Archived'] };
const DSUB = [['overview', 'Overview'], ['files', 'Files'], ['sessions', 'Sessions'], ['tools', 'Tools'], ['insights', 'Insights'], ['backups', 'Backups']];
const REC = { roblox: /roblox|luau|rojo|studio/, blender: /blender|\b3d\b|mesh/, any: /graph|obsidian|memory|headroom/ };
let draft = null, shownRT = ''; // { id, v, k, f }: unsaved Add-task text
let root, data = null, err = null, det = {}, inv = null, invErr = false, busy = false, loading = false;
let ui = { tab: 'all', q: '', st: 'all', sort: 'recent', view: 'grid', sel: null, dsub: 'overview' };
try { Object.assign(ui, JSON.parse(localStorage.getItem('jv.pj') || '{}'), { q: '' }); } catch { }
const keep = () => { try { localStorage.setItem('jv.pj', JSON.stringify({ ...ui, q: '' })); } catch { } };
const $ = id => root?.querySelector('#' + id);
const day = t => t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const when = t => t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const hrs = ms => ms ? dur(ms) : '0m';
const n0 = n => String(Math.round(n));
const sel = () => data?.items.find(p => p.id === ui.sel) || null;
const typeOf = p => TYPE[p.type] || TYPE.other;

export function mount(el, params = []) {
  root = el; if (TABS.some(t => t[0] === params[0])) ui.tab = params[0];
  el.innerHTML = `<div class="pg enter">
  <header class="pg-h" style="--i:0">
    <span class="tile-ic pg-ic">${icon('i-folder')}</span>
    <div class="pg-t"><h1>Projects</h1><p>Your project folders, their Claude Code sessions, time, tools, files and backups. Project files are never changed from here.</p></div>
    <div class="end"><span class="muted sm" id="p-at"></span>
    <button class="btn" data-a="refresh" data-tip="Re-reads transcripts, folder sizes and the project list now. Nothing runs in the background.">${icon('i-undo')}Refresh</button>
    <button class="btn" data-a="import" data-tip="Add an existing folder as a project. Nothing in it is changed.">${icon('i-arrow-down')}Import Project</button>
    <button class="btn pri" data-a="new" data-tip="Create a new, empty project folder (after you confirm) and add it here.">${icon('i-plus-folder')}New Project</button></div>
  </header>
  <div id="p-err"></div>
  <div class="kpis k5" style="--i:1">${kpi('p-tot', 'i-layers', 'Total Projects')}${kpi('p-act', 'i-folder', 'Active Projects')}${kpi('p-ses', 'i-clock', 'Sessions · 7 days')}${kpi('p-sto', 'i-db', 'Project Storage')}${kpi('p-dev', 'i-timer', 'Dev Time · 7 days')}</div>
  <div class="pgrid pj-l enter"><div class="pj-main"><section class="card ws pj-ws" style="--i:2"><nav class="otabs" id="p-tabs"></nav><div id="p-body"></div></section>
    <section class="card pj-qa" id="p-qa"></section><section class="card pj-rec" id="p-rec"></section></div><aside class="card pj-det" id="p-det" style="--i:3"></aside></div>
  <dialog class="lx-dlg pj-dlg" id="p-dlg" aria-labelledby="p-dlg-t"></dialog>
</div>`;
  const pg = el.querySelector('.pg');
  pg.addEventListener('click', onClick); pg.addEventListener('input', onInput); pg.addEventListener('change', onInput);
  pg.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.pj-c, tr[data-a]')) { e.preventDefault(); e.target.click(); } });
  load();
}
export function nav(params = []) { if (TABS.some(t => t[0] === params[0])) { ui.tab = params[0]; keep(); draw(); } }
// Called on the app's usage poll (perf.live: 10 s / 30 s / page change). B83: retries only while this page is in error and the
// tracker answered that poll, one request at a time; otherwise it just refreshes the "Checked … ago" text (M4). No extra timers.
export function update(st) { if (!root) return; if (err && st?.ok && !loading) load(); else if (err && retryText() !== shownRT) draw(); else if (data && !err) $('p-at').textContent = 'Checked ' + ago(data.at); } // redraw the box only when perf.live changed its retry text
export function unmount() { root = null; }

// ---------- data ----------
// E3: a failed request (TypeError) = tracker not reachable; an answer with res = the tracker refused.
async function getJ(u) { const x = await fetch(u, { cache: 'no-store' }); const j = await x.json(); if (!x.ok) throw new Error(j.res || 'HTTP ' + x.status); return j; }
const why = e => e instanceof TypeError ? 'Tracker not reachable' : 'The tracker refused: ' + e.message;
async function load(refresh) {
  loading = true;
  try { data = await getJ('/api/projects' + (refresh ? '?refresh=1' : '')); err = null; } catch (e) { err = why(e); } finally { loading = false; }
  if (!root) return; if (data && !err && !sel()) ui.sel = (data.items.find(p => p.main) || list()[0] || data.items[0])?.id || null;
  if (refresh && !err) det = {}; draw(); if (ui.sel && !err) loadDet(ui.sel);
  if (!inv && !err) fetchInv();
}
function fetchInv() {
  invErr = false; fetch('/api/inv', { cache: 'no-store' }).then(r => r.json()).then(j => { inv = j.error ? null : j; invErr = !!j.error; }, () => { invErr = true; }).then(() => { if (root) rec(); });
}
async function loadDet(id, force) {
  if (det[id] && !det[id].fail && !force) return detail();
  try { det[id] = await getJ('/api/projects?id=' + encodeURIComponent(id)); } catch (e) { det[id] = { res: why(e), fail: true }; } // B78: errors are retried, not cached
  if (root && ui.sel === id) { detail(); qa(); }
}
async function post(o) {
  try { const x = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }); return await x.json().catch(() => ({ res: 'The tracker answered HTTP ' + x.status + '.' })); }
  catch (e) { return { res: 'Tracker not reachable. Start it with node ~/.claude/token-tracker/tracker.js serve, then try again.' }; }
}
function list() {
  if (!data) return [];
  let L = data.items.filter(p => ui.tab === 'archived' ? p.status === 'archived' : p.status !== 'archived' && (ui.tab === 'all' || p.type === ui.tab));
  const s = ui.q.toLowerCase(); if (s) L = L.filter(p => (p.name + ' ' + p.desc + ' ' + p.tags.join(' ') + ' ' + p.dir).toLowerCase().includes(s));
  if (ui.st !== 'all') L = L.filter(p => p.status === ui.st);
  const by = { recent: (a, b) => b.stats.last - a.stats.last, name: (a, b) => a.name.localeCompare(b.name), time: (a, b) => b.stats.active - a.stats.active, sessions: (a, b) => b.stats.sessions - a.stats.sessions, size: (a, b) => (b.stats.bytes || 0) - (a.stats.bytes || 0) };
  return L.sort((a, b) => (b.main - a.main) || by[ui.sort](a, b));
}

// ---------- draw ----------
function draw() {
  if (!root) return;
  const n = data ? { archived: data.items.filter(p => p.status === 'archived').length } : {};
  $('p-tabs').innerHTML = seg(TABS.map(([v, t]) => [v, t + (data ? ` (${v === 'all' ? data.items.filter(p => p.status !== 'archived').length : v === 'archived' ? n.archived : data.items.filter(p => p.status !== 'archived' && p.type === v).length})` : ''), '#/projects/' + v]), ui.tab) + lm('pj-list', 'Where projects come from');
  const down = err?.startsWith('Tracker not reachable');
  shownRT = retryText(); $('p-err').innerHTML = err ? errBox({ title: down ? 'Tracker not reachable' : 'Projects could not load', where: 'Projects', what: down ? "NEXUS can't reach its tracker, so the project list can't load." : err + '.',
    why: 'Project stats, details and actions need the tracker. Nothing is lost: projects.json and your folders are untouched.', affected: 'The project list, details, quick actions and recommendations. ' + retryText(),
    steps: down ? ['Make sure the tracker is running: node ~/.claude/token-tracker/tracker.js serve', 'Press Retry now.'] : ['Press Retry now.'], actions: [['retry', 'Retry now', true]], tech: 'GET /api/projects failed (' + err + '). Retry now asks again once.' }) : ''; // E1: at the top, like Sessions (B76)
  if (err || !data) {
    $('p-body').innerHTML = err ? stateBox('error', 'No projects to show.', 'See the message at the top of the page.') : stateBox('loading', 'Reading your projects…', 'First run scans your transcripts once; later runs only read what changed.');
    if (err) { // B83: no stale numbers or blank side cards while the tracker is down
      $('p-at').textContent = ''; const u = chip('unk', 'Unknown until the tracker answers.');
      for (const id of ['p-tot', 'p-act', 'p-ses', 'p-sto', 'p-dev']) setKpi($(id), null, () => '—', 'waiting for the tracker', u);
      for (const id of ['p-det', 'p-qa', 'p-rec']) $(id).innerHTML = stateBox('empty', 'Waiting for the tracker', 'See the message at the top of the page.');
    }
    return;
  }
  $('p-at').textContent = 'Checked ' + ago(data.at);
  kpis(); body(); detail(); qa(); rec();
}
function kpis() {
  const I = data.items, A = I.filter(p => p.status === 'active'), S = k => I.reduce((a, p) => a + (p.stats[k] || 0), 0), c = t => A.filter(p => p.type === t).length;
  setKpi($('p-tot'), I.length, n0, `${A.length} active · ${I.length - A.length} other`, chip('live', `Saved in projects.json (NEXUS data). Found from your Claude Code transcript folders or added by you.`));
  setKpi($('p-act'), A.length, n0, `${c('roblox')} Roblox · ${c('blender')} Blender · ${c('other')} other`, chip('live', 'Projects with status Active. Change a status in the detail panel.'));
  setKpi($('p-ses'), S('week'), n0, `last 7 days · ${S('sessions')} all time`, chip('live', 'Claude Code transcripts in each project folder with activity in the last 7 days.') + lm('pj-ses', 'Sessions'));
  setKpi($('p-sto'), S('bytes'), bytes, `${bytes(S('weekBytes'))} changed in the last 7 days`, chip('live', 'Every file in the project folders (walked at most every 10 minutes, up to 50,000 files each).') + lm('pj-store', 'Project storage'));
  setKpi($('p-dev'), S('activeWeek'), hrs, `last 7 days · ${hrs(S('active'))} all time`, chip('est', 'Estimate: time between transcript messages, counting only gaps of 10 minutes or less (idle time is left out).') + lm('pj-time', 'Development time'));
}
function body() {
  const L = list(), opt = (id, v, all, items, lab) => `<select class="btn" id="${id}" aria-label="${lab}">${all ? `<option value="all">${all}</option>` : ''}${items.map(([k, t]) => `<option value="${k}"${k === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  const miss = data.missing.length ? `<p class="px-note">${icon('i-search')}${data.missing.length} transcript folder${data.missing.length > 1 ? 's point' : ' points'} to a folder that no longer exists: ${data.missing.map(m => `<code>${esc(m.dir)}</code> (${m.sessions} session${m.sessions === 1 ? '' : 's'})`).join(', ')}. Not added. Use Import Project if it moved.</p>` : '';
  $('p-body').innerHTML = `<div class="px-fl"><label class="field">${icon('i-search')}<input id="p-q" placeholder="Search projects, tags, folders…" value="${esc(ui.q)}" aria-label="Search projects"></label>
    ${opt('p-st', ui.st, 'All Status', Object.entries(STAT).filter(([k]) => ui.tab === 'archived' ? k === 'archived' : k !== 'archived').map(([k, [, t]]) => [k, t]), 'Status')}
    ${opt('p-sort', ui.sort, '', [['recent', 'Last Active'], ['name', 'Name'], ['time', 'Most Time'], ['sessions', 'Most Sessions'], ['size', 'Largest']], 'Sort')}
    <div class="pj-vt" role="group" aria-label="View">${[['grid', 'i-layers', 'Grid view'], ['list', 'i-chart', 'List view']].map(([v, ic, t]) => `<button class="btn sm${ui.view === v ? ' on' : ''}" data-a="view" data-v="${v}" aria-pressed="${ui.view === v}" aria-label="${t}" data-tip="${t}">${icon(ic)}</button>`).join('')}</div></div>${miss}
  ${!data.items.length ? `<div class="px-empty">${icon('i-folder')}<h3>No projects yet</h3><p>Projects appear here once you use Claude Code in a folder, or add one now.</p><div class="px-act"><button class="btn pri" data-a="new">${icon('i-plus-folder')}New Project</button><button class="btn" data-a="import">${icon('i-arrow-down')}Import Project</button></div></div>`
    : !L.length ? stateBox('empty', 'Nothing matches.', ui.tab === 'archived' ? 'No archived projects. Archive one from its ⋯ menu.' : 'Clear the search or filters.')
    : ui.view === 'grid' ? `<div class="pj-grid">${L.map(card).join('')}</div>` : table(L)}`;
}
function thumb(p, cls = '') {
  const [, ic, col] = typeOf(p), ini = p.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return `<div class="pj-th ${cls}" style="--tc:${col}">${p.thumb && p.exists ? `<img src="/api/projects/img?id=${p.id}&f=${encodeURIComponent(p.thumb)}" alt="" loading="lazy">` : `<span class="pj-art" aria-hidden="true">${icon(ic)}<b>${esc(ini)}</b></span>`}</div>`;
}
const stTag = p => p.exists ? `<span class="tg ${STAT[p.status][0]} pj-st"><i></i>${STAT[p.status][1]}</span>` : '<span class="tg w pj-st" data-tip="The folder is missing: it was moved, renamed or deleted.">Folder missing</span>';
const tags = p => `<div class="px-tags"><span class="tg c">${typeOf(p)[0]}</span>${p.tags.filter(t => t !== typeOf(p)[0]).slice(0, 3).map(t => `<span class="tg">${esc(t)}</span>`).join('')}${p.main ? '<span class="tg ok">Main</span>' : ''}</div>`;
function more(p) {
  const arch = p.status === 'archived';
  return `<details class="lx-more"><summary aria-label="More options for ${esc(p.name)}">⋯</summary><div>
    <button data-a="session" data-k="${p.id}" ${p.exists ? '' : 'disabled'}>${icon('i-term')}New Claude session here</button>
    <button data-a="obsidian" data-k="${p.id}" ${vaultOf(p) && p.exists ? '' : 'disabled'} ${vaultOf(p) ? '' : 'data-tip="Link a vault first: Link Vault in the details panel."'}>${icon('i-book')}Open in Obsidian</button>
    <button data-a="settings" data-k="${p.id}">${icon('i-gear')}Project settings</button>
    <button data-a="copy" data-v="${esc(p.dir)}">${icon('i-folder')}Copy folder path</button>
    <button data-a="status" data-k="${p.id}" data-v="${arch ? 'active' : 'archived'}">${icon(arch ? 'i-undo' : 'i-layers')}${arch ? 'Unarchive' : 'Archive'}</button>
    <button data-a="remove" data-k="${p.id}">${icon('i-x')}Remove from NEXUS</button></div></details>`;
}
function card(p) {
  const s = p.stats;
  return `<article class="pj-c${p.id === ui.sel ? ' on' : ''}" data-a="sel" data-k="${p.id}" tabindex="0" aria-label="${esc(p.name)}" style="--tc:${typeOf(p)[2]}">
    <div class="pj-ct">${thumb(p)}${stTag(p)}</div>
    <div class="pj-cb"><b title="${esc(p.name)}">${esc(p.name)}</b><p title="${esc(p.desc || p.dir)}">${esc(p.desc || p.dir)}</p>${tags(p)}
    <div class="pj-meta"><span data-tip="Last activity in a Claude Code session">${icon('i-cal')}${s.last ? new Date(s.last).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}</span>
      <span data-tip="Active time, estimated from transcript timestamps (gaps over 10 min left out)">${icon('i-timer')}${hrs(s.active)}</span>
      <span data-tip="Claude Code sessions in this folder">${icon('i-clock')}${s.sessions}</span></div>
    <div class="pj-cf"><button class="btn sm pri" data-a="explorer" data-k="${p.id}" ${p.exists ? '' : 'disabled'} data-tip="Opens the folder in File Explorer.">${icon('i-folder')}Open</button>${more(p)}
      <button class="btn sm ghost pj-go" data-a="sel" data-k="${p.id}" aria-label="Show details" data-tip="Show details">›</button></div></div></article>`;
}
function table(L) {
  return `<table class="tbl click px-t pj-t"><thead><tr><th>Project</th><th>Type</th><th>Status</th><th class="n">Sessions</th><th class="n">Time (est.)</th><th class="n">Size</th><th>Last active</th><th></th></tr></thead><tbody>
  ${L.map(p => `<tr data-a="sel" data-k="${p.id}" tabindex="0" class="${p.id === ui.sel ? 'on' : ''}"><td><b>${esc(p.name)}</b>${p.main ? ' <span class="tg ok">Main</span>' : ''}<small class="muted pj-dir">${esc(p.dir)}</small></td><td>${typeOf(p)[0]}</td><td>${stTag(p)}</td>
    <td class="n">${p.stats.sessions}</td><td class="n">${hrs(p.stats.active)}</td><td class="n">${bytes(p.stats.bytes)}</td><td>${p.stats.last ? ago(p.stats.last) : '—'}</td><td class="n">${more(p)}</td></tr>`).join('')}</tbody></table>`;
}

// ---------- detail ----------
function detail() {
  const el = $('p-det'), p = sel(); if (!el) return;
  if (!p) return void (el.innerHTML = stateBox('empty', 'Select a project', 'Pick a card to see its stats, sessions, files and backups.'));
  const D = det[p.id], sub = ui.dsub, open = el.querySelector('details[open]'); if (open) return; // never redraw under an open menu
  if (document.activeElement?.id === 'p-task' && draft) draft.f = true;
  el.innerHTML = `<div class="pj-dh">${thumb(p, 'lg')}<div class="pj-dt"><div class="pj-dn"><b>${esc(p.name)}</b>
      <select class="btn sm pj-ss st-${p.status}" id="p-status" aria-label="Status">${Object.entries(STAT).map(([k, [, t]]) => `<option value="${k}"${k === p.status ? ' selected' : ''}>${t}</option>`).join('')}</select>${lm('pj-status', 'Status')}</div>
    <p class="${p.desc ? '' : 'muted'}">${esc(p.desc || 'No description yet. Add one in Project Settings.')}</p>${tags(p)}</div></div>
    <div class="px-act pj-da"><button class="btn pri" data-a="explorer" data-k="${p.id}" ${p.exists ? '' : 'disabled'} data-tip="${p.exists ? 'Opens the folder in File Explorer.' : 'The folder is missing: it was moved, renamed or deleted.'}">${icon('i-folder')}Open Project</button><button class="btn" data-a="settings" data-k="${p.id}" data-tip="Name, type, status, tags, thumbnail and session folders. Saved in NEXUS, not in the project.">${icon('i-gear')}Project Settings</button><button class="btn" data-a="link" data-k="${p.id}" data-tip="Link this project to an Obsidian vault folder, choose doc sync and the knowledge graph.">${icon('i-book')}Link Vault</button>${lm('pj-vault', 'Link vault')}${more(p)}</div>
    <nav class="px-dt" role="tablist">${DSUB.map(([v, t]) => `<button class="${v === sub ? 'on' : ''}" role="tab" aria-selected="${v === sub}" data-a="dsub" data-v="${v}">${t}</button>`).join('')}</nav>
    <div class="pj-dp">${!p.exists ? stateBox('error', 'Folder missing', `<code>${esc(p.dir)}</code> no longer exists. Remove it from NEXUS, or add the new location with Import Project.`)
      : !D ? stateBox('loading', 'Reading the project…') : D.res !== 'ok' ? errBox({ title: "Couldn't read this project", where: 'Projects · ' + p.name, what: D.res + '.', why: 'Stats, files, sessions and backups for this project stay hidden until it loads.', steps: ['Press Retry.'], actions: [['detretry', 'Retry', true]], tech: 'GET /api/projects?id=' + p.id }) : ({ overview, files, sessions, tools, insights, backups }[sub])(p, D)}</div>`;
  const n = el.querySelector('#p-task'); if (n && draft?.id === p.id) { n.value = draft.v; el.querySelector('#p-kind').value = draft.k; if (draft.f) { n.focus(); draft.f = false; } } // unsaved task text survives refreshes
}
function overview(p, D) {
  const s = p.stats, T = p.tasks, open = T.filter(t => !t.done), doc = D.todo, R = Object.entries(D.reg);
  const st = (l, v, sub, tip) => `<div${tip ? ` data-tip="${esc(tip)}"` : ''}><small>${l}</small><b>${v}</b><small>${sub}</small></div>`;
  return `<div class="pj-box"><h3>Project Stats</h3><div class="pj-sg">
      ${st('Last active', s.last ? ago(s.last) : '—', s.last ? new Date(s.last).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'no sessions')}${st('Total sessions ' + lm('pj-ses', 'Sessions'), s.sessions, `${s.week} in the last 7 days`)}
      ${st('Dev time ' + chip('est', 'Time between transcript messages, gaps over 10 minutes left out.') + lm('pj-time', 'Development time'), hrs(s.active), `${hrs(s.activeWeek)} in the last 7 days`)}
      ${st('Tracked tokens ' + lm('pj-tok', 'Tracked tokens'), s.tracked ? tok(s.tokens) : '—', `${s.tracked} of ${s.sessions} sessions`, `All token types (input, output, cache write, cache read) for the ${s.tracked} session${s.tracked === 1 ? '' : 's'} the tracker still keeps in state.json. Older sessions aren't counted.`)}
      ${st('Project size ' + lm('pj-store', 'Project storage'), bytes(s.bytes), `${(s.files ?? 0).toLocaleString()} files${s.capped ? '+' : ''}`)}${st('First session', day(isFinite(s.first) ? s.first : null), `${Object.keys(s.days).length} active days`)}</div></div>
    <div class="pj-box"><h3>Development Activity <span class="muted sm">last 14 days, hours (est.)</span></h3><div class="pj-bars" id="p-bars">${bars(s.days)}</div></div>
  <div class="pj-box"><h3>Top Tools Used <span class="muted sm">tracked sessions</span></h3>${toolBars(s.tools, 5)}</div>
  <div class="pj-box"><h3>Progress ${lm('pj-tasks', 'Progress')} <span class="muted sm">${open.length} open · ${T.length - open.length} done</span></h3>
    <div class="pj-tasks">${T.length ? T.slice().sort((a, b) => a.done - b.done || (b.kind === 'milestone') - (a.kind === 'milestone')).map(t => `<label class="pj-task${t.done ? ' done' : ''}"><input type="checkbox" data-a="task" data-k="${t.id}" ${t.done ? 'checked' : ''}><span>${t.kind === 'milestone' ? `<span class="tg c">Milestone</span> ` : ''}${esc(t.t)}</span><button class="btn sm ghost" data-a="deltask" data-k="${t.id}" aria-label="Delete task">${icon('i-x')}</button></label>`).join('') : '<p class="muted sm">No tasks or milestones yet. They are saved in NEXUS, not in the project.</p>'}</div>
    <form class="pj-add" data-a="addtask"><label class="field">${icon('i-check')}<input id="p-task" maxlength="200" placeholder="Add a task or milestone…" aria-label="New task"></label><select class="btn sm" id="p-kind" aria-label="Kind"><option value="task">Task</option><option value="milestone">Milestone</option></select><button class="btn sm pri" type="submit">Add</button></form>
    ${doc.length ? `<p class="muted sm">${doc.filter(t => !t.done).length} open checklist items in the project docs (read-only): ${esc([...new Set(doc.map(t => t.f))].slice(0, 3).join(', '))}</p>` : ''}
    ${R.length ? `<div class="pj-reg"><span class="muted sm">ASSET_REGISTRY.md:</span>${R.sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="tg ${k === 'Approved' ? 'ok' : k === 'Pending' ? 'n' : ''}">${v} ${esc(k)}</span>`).join('')}</div>` : ''}</div>`;
}
function bars(days) {
  const K = [...Array(14)].map((_, i) => new Date(Date.now() - (13 - i) * 864e5).toLocaleDateString('sv')), V = K.map(k => (days[k] || 0) / 36e5), mx = Math.max(1, Math.ceil(Math.max(...V)));
  return `<div class="pj-y">${[mx, mx / 2, 0].map(v => `<span>${+v.toFixed(1)}h</span>`).join('')}</div><div class="pj-cols">${K.map((k, i) => `<div class="pj-col" data-tip="${esc(new Date(k + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ': ' + (V[i] ? hrs(V[i] * 36e5) : 'no activity') + ' (est.)')}"><i style="height:${V[i] / mx * 100}%"></i>${i % 3 === 1 || i === 13 ? `<small>${new Date(k + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}</small>` : ''}</div>`).join('')}</div>`;
}
const TIC = { 'Roblox Studio': 'i-roblox', Blender: 'i-cube', 'Files (read/edit)': 'i-book', Search: 'i-search', Shell: 'i-term', Browser: 'i-graph', 'Agents & skills': 'i-spark', Planning: 'i-check', Other: 'i-puzzle' };
function toolBars(G, n) {
  const tot = G.reduce((a, [, c]) => a + c, 0); if (!tot) return '<p class="muted sm">No tool calls in the tracked sessions.</p>';
  const top = G.slice(0, n), rest = G.slice(n).reduce((a, [, c]) => a + c, 0), rows = rest ? [...top, ['Others', rest]] : top;
  return `<div class="pj-tools">${rows.map(([g, c]) => `<div data-tip="${c.toLocaleString()} tool calls"><span class="px-ic">${icon(TIC[g] || 'i-puzzle')}</span><span><b>${esc(g)}</b><small>${Math.round(c / tot * 100)}%</small><i><em style="width:${c / tot * 100}%"></em></i></span></div>`).join('')}</div>`;
}
function files(p, D) {
  const g = D.graph;
  return `<div class="pj-box"><h3>Docs <span class="muted sm">${D.docs.length} markdown files (top level + one folder down)</span></h3>
    ${D.docs.length ? `<div class="pj-fl">${D.docs.slice().sort((a, b) => b.mtime - a.mtime).slice(0, 40).map(d => `<div><span>${icon('i-book')}<b title="${esc(d.f)}">${esc(d.f)}</b></span><small class="muted">${bytes(d.size)} · ${ago(d.mtime)}</small><button class="btn sm ghost" data-a="reveal" data-k="${p.id}" data-v="${esc(d.f)}" data-tip="Shows it selected in File Explorer. Nothing is opened or run.">Show</button></div>`).join('')}</div>` : '<p class="muted sm">No markdown docs found.</p>'}</div>
  <div class="pj-box"><h3>Folder <span class="muted sm">top level · ${D.top.length} items</span></h3><div class="pj-fl">${D.top.map(f => `<div><span>${icon(f.dir ? 'i-folder' : 'i-code')}<b title="${esc(f.n)}">${esc(f.n)}</b></span><small class="muted">${f.dir ? 'folder' : bytes(f.size)} · ${ago(f.mtime)}</small><button class="btn sm ghost" data-a="reveal" data-k="${p.id}" data-v="${esc(f.n)}" data-tip="Shows it selected in File Explorer. Nothing is opened or run.">Show</button></div>`).join('')}</div></div>
  <div class="pj-box"><h3>Knowledge</h3><div class="px-chk">
    <div class="${g ? 'ok' : 'no'}">${icon(g ? 'i-graph' : 'i-x')}<span>${g ? `Graphify graph: ${g.nodes ?? '?'} nodes, ${g.links ?? '?'} links, built ${ago(g.mtime)}${g.report ? ' · GRAPH_REPORT.md' : ''}` : 'No Graphify graph (graphify-out/graph.json) in this folder.'}</span></div>
    <div class="${vaultOf(p) ? 'ok' : 'no'}">${icon(vaultOf(p) ? 'i-book' : 'i-x')}<span>${vaultOf(p) ? `Obsidian vault: <code>${esc(vaultOf(p))}</code>${p.obsidian ? '' : ' (linked with Link Vault)'}` : 'No Obsidian vault linked. Use Link Vault in the details panel.'}</span></div></div></div>`;
}
function sessions(p, D) {
  if (!D.sessions.length) return stateBox('empty', 'No Claude Code sessions in this folder yet.');
  return `<p class="px-note">${icon('i-term')}Resume opens ${{ wt: 'Windows Terminal', pwsh: 'PowerShell', bash: 'Git Bash' }[P.pref('cc.term')] || 'Windows Terminal'} in the project folder with <code>claude --resume &lt;id&gt;</code>. Tokens are shown for sessions the tracker still keeps. ${lm('pj-resume', 'Resume a session')}</p>
  <div class="pj-sl">${D.sessions.map(s => `<div class="pj-s"><div><b title="${esc(s.prompt || '(no prompt text)')}">${esc(s.prompt || '(no prompt text)')}</b>
    <small class="muted">${when(s.first)} · active ${hrs(s.active)} · ${bytes(s.size)}${s.tokens != null ? ` · ${tok(s.tokens)} tokens` : ''}${s.compacts ? ` · compacted ${s.compacts}×` : ''}</small></div>
    <span class="pj-sa">${s.tokens != null ? `<a class="btn sm ghost" href="#/sessions/${esc(s.id)}" data-tip="Open in the Sessions page">${icon('i-chart')}</a>` : ''}<button class="btn sm" data-a="resume" data-k="${p.id}" data-v="${esc(s.id)}" data-tip="Opens your terminal here and runs claude --resume. Uses your Claude plan.">${icon('i-play')}Resume</button></span></div>`).join('')}</div>`;
}
function tools(p) {
  const s = p.stats, cfg = p.tools;
  return `<div class="pj-box"><h3>Tool groups <span class="muted sm">${s.tracked} tracked sessions</span></h3>${toolBars(s.tools, 8)}</div>
  <div class="pj-box"><h3>Most-used tools</h3>${s.toolsRaw.length ? `<div class="pj-raw">${s.toolsRaw.slice(0, 15).map(([n, c]) => `<div><code title="${esc(n)}">${esc(n.replace(/^mcp__/, '').replace(/__/g, ' · '))}</code><b>${c.toLocaleString()}</b></div>`).join('')}</div>` : '<p class="muted sm">None tracked.</p>'}</div>
  <div class="pj-box"><h3>Skills used</h3>${s.skills.length ? `<div class="px-tags">${s.skills.map(([n, c]) => `<span class="tg">${esc(n)} <b>${c}</b></span>`).join('')}</div>` : '<p class="muted sm">No skill calls in the tracked sessions.</p>'}</div>
  <div class="pj-box"><h3>Project tools <span class="muted sm">your list</span></h3>${cfg.length ? `<div class="px-tags">${cfg.map(t => `<span class="tg ok">${esc(t)}</span>`).join('')}</div>` : '<p class="muted sm">None set. Add the apps and tools this project uses in Project Settings.</p>'}</div>`;
}
// Rule-based; every insight names what it is based on. Nothing is invented.
function insightsOf(p, D) {
  const s = p.stats, out = [], add = (lvl, t, basis) => out.push({ lvl, t, basis }), I = Object.entries(s.issues || {}), cnt = k => I.filter(([n]) => n.startsWith(k + ':')).reduce((a, [, v]) => a + v, 0);
  if (D.git?.dirty) add('w', `${D.git.dirty} uncommitted change${D.git.dirty === 1 ? '' : 's'} in the git repo.`, 'git status --porcelain');
  if (!D.git) add('n', 'Not a git repository: there is no history to roll back to.', 'git log');
  const lastBk = Math.max(0, ...D.backups.map(b => b.at || 0), ...D.folders.map(f => f.mtime));
  if (!lastBk) add('w', 'No backups found for this project.', 'NEXUS snapshots + the project\'s backups/ folder');
  else if (Date.now() - lastBk > 7 * 864e5) add('n', `Last backup ${ago(lastBk)}.`, 'NEXUS snapshots + backups/ folder dates');
  if (cnt('reread')) add('n', `${cnt('reread')} files were re-read in the tracked sessions. Read once, then use offset/limit or Grep.`, 'tracker issues: reread');
  if (cnt('oversized')) add('n', `${cnt('oversized')} oversized tool outputs (${I.filter(([n]) => n.startsWith('oversized:')).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => n.slice(10).replace(/^mcp__/, '') + ' ' + v).join(', ')}).`, 'tracker issues: oversized');
  if (cnt('rebuild')) add('n', `Context was rebuilt ${cnt('rebuild')} times after a cache expiry.`, 'tracker issues: rebuild');
  if (s.compacts) add('u', `${s.compacts} compaction${s.compacts === 1 ? '' : 's'} in the tracked sessions.`, 'state.json compacted');
  const big = D.sessions.filter(x => x.size > 50e6).length; if (big) add('u', `${big} session${big === 1 ? ' has' : 's have'} a transcript over 50 MB: long sessions re-send more context each turn.`, 'transcript file sizes');
  if (D.stale.length) add('u', `${D.stale.length} doc${D.stale.length === 1 ? '' : 's'} not updated in 14+ days: ${D.stale.slice(0, 3).map(d => d.f).join(', ')}.`, 'updated: front matter');
  const open = p.tasks.filter(t => !t.done).length; if (open) add('u', `${open} open task${open === 1 ? '' : 's'} in Progress.`, 'your task list');
  if (!out.length) add('ok', 'Nothing to flag by these rules.', 'git, backups, tracker issues, docs');
  return out;
}
function insights(p, D) {
  return `<p class="px-note">${icon('i-spark')}Rule-based checks on real data. Each one says what it is based on. Not a rating. ${lm('pj-ins', 'Insights')}</p>
  <div class="px-rl">${insightsOf(p, D).map(r => `<div class="px-r"><span class="tg ${r.lvl}">${{ w: 'Act', n: 'Tip', u: 'Info', ok: 'OK' }[r.lvl]}</span><small>${esc(r.t)}<br><span class="muted">Based on: ${esc(r.basis)}</span></small></div>`).join('')}</div>`;
}
function backups(p, D) {
  const g = D.git;
  return `<div class="pj-box"><h3>NEXUS snapshots ${lm('pj-bk', 'Backups')} <span class="muted sm">text files copied outside the project</span><span class="end"></span><button class="btn sm pri" data-a="backup" data-k="${p.id}">${icon('i-db')}Create Backup</button></h3>
    ${D.backups.length ? `<div class="pj-fl">${D.backups.map(b => `<div><span>${icon('i-db')}<b>${esc(b.n)}</b></span><small class="muted">${b.incomplete ? 'Incomplete (interrupted): not a usable backup' : `${b.files ?? '?'} files · ${bytes(b.bytes)}${b.skipped ? ` · ${b.skipped} skipped` : ''}`}</small></div>`).join('')}</div>` : '<p class="muted sm">None yet.</p>'}</div>
  <div class="pj-box"><h3>Project backups/ folder <span class="muted sm">read-only</span></h3>${D.folders.length ? `<div class="pj-fl">${D.folders.map(f => `<div><span>${icon('i-folder')}<b>${esc(f.n)}</b></span><small class="muted">${f.snaps} snapshot${f.snaps === 1 ? '' : 's'}${f.latest ? ' · latest ' + esc(f.latest) : ''}</small><button class="btn sm ghost" data-a="reveal" data-k="${p.id}" data-v="${esc('backups/' + f.n)}">Show</button></div>`).join('')}</div>` : '<p class="muted sm">No backups/ folder.</p>'}</div>
  <div class="pj-box"><h3>Git history <span class="muted sm">${g ? (g.dirty ? `${g.dirty} uncommitted` : 'clean') : 'not a repo'}</span></h3>${g?.log.length ? `<div class="pj-git">${g.log.map(c => `<div><code>${esc(c.h)}</code><span title="${esc(c.s)}">${esc(c.s)}</span><small class="muted">${ago(c.t)}</small></div>`).join('')}</div>` : '<p class="muted sm">No commits to show.</p>'}
    <p class="muted sm">Recovery: NEXUS never restores or reverts. Copy files back from a snapshot or use git yourself.</p></div>`;
}

// ---------- quick actions + recommended ----------
function qa() {
  const p = sel(), el = $('p-qa'); if (!el) return; const ok = p?.exists, A = [
    ['session', 'i-term', 'New Session', 'Claude Code in this folder', ok], ['explorer', 'i-folder', 'Open in Explorer', 'Show the project folder', ok],
    ['obsidian', 'i-book', 'Open in Obsidian', vaultOf(p) ? 'Open the linked vault' : 'Link a vault first', ok && vaultOf(p)], ['backup', 'i-db', 'Create Backup', 'Snapshot text files', ok],
    ['analyze', 'i-spark', 'Re-read Project', 'Stats, files and insights · no AI, no tokens', ok], ['report', 'i-arrow-down', 'Generate Report', 'Download a Markdown summary', ok && det[p.id]?.res === 'ok']];
  el.innerHTML = `<div class="card-h">${icon('i-bolt')}<h2>Quick Actions</h2></div><div class="pj-qg">${A.map(([a, ic, t, s, en]) => `<button class="pj-q" data-a="${a}" data-k="${p?.id || ''}" ${en ? '' : `disabled data-tip="${!p ? 'Pick a project first.' : !ok ? 'The folder is missing: it was moved, renamed or deleted.' : a === 'obsidian' ? 'Link a vault first: Link Vault in the details panel.' : 'Wait until the project details have loaded.'}"`}><span class="px-ic">${icon(ic)}</span><span><b>${t}</b><small>${esc(s)}</small></span></button>`).join('')}</div>`;
}
function rec() {
  const el = $('p-rec'), p = sel(); if (!el) return;
  if (!inv) return void (el.innerHTML = `<div class="card-h">${icon('i-puzzle')}<h2>Recommended Tools &amp; Skills</h2></div>${invErr ? `${stateBox('error', "Couldn't read installed plugins and skills.", 'The tracker did not return the list. Nothing was installed or changed.')}<div class="px-act"><button class="btn sm" data-a="invretry">Retry</button></div>` : stateBox('loading', 'Reading installed plugins and skills…')}`);
  const re = [REC[p?.type], REC.any].filter(Boolean), m = x => re.some(r => r.test((x.name + ' ' + (x.description || '')).toLowerCase()));
  const seen = new Set(), L = [...inv.plugins.filter(m).map(x => ({ n: x.name, d: x.description, k: 'Plugin' })), ...inv.skills.filter(s => !s.same && m(s)).map(x => ({ n: x.name, d: x.description, k: 'Skill' }))].filter(x => !seen.has(x.n.toLowerCase()) && seen.add(x.n.toLowerCase())).slice(0, 6);
  el.innerHTML = `<div class="card-h">${icon('i-puzzle')}<h2>Recommended Tools &amp; Skills</h2><div class="end"><a class="btn sm ghost" href="#/plugins/discover" data-tip="Find more in Plugins & Skills. Nothing is installed from Projects.">Find more</a></div></div>
    ${L.length ? `<div class="pj-rg">${L.map(x => `<a class="pj-r" href="#/plugins/installed" data-tip="${esc(x.d || '')}"><span class="px-ic">${icon(/roblox|luau/i.test(x.n) ? 'i-roblox' : /blender|3d/i.test(x.n) ? 'i-cube' : /graph/i.test(x.n) ? 'i-graph' : 'i-book')}</span><span><b>${esc(x.n)}</b><small>${x.k}</small></span><span class="tg ok">Installed</span></a>`).join('')}</div>
    <p class="muted sm">Installed tools that match ${p ? typeOf(p)[0] : 'your'} work by name or description.</p>` : `<p class="muted sm">Nothing installed matches this project type. Look in <a href="#/plugins/discover">Discover</a>.</p>`}`;
}

// ---------- dialogs ----------
function dlg(h) { const d = $('p-dlg'); d.innerHTML = `<form method="dialog" class="lx-f">${h}</form>`; if (!d.open) d.showModal(); return d; }
const head = (ic, t) => `<div class="card-h">${icon(ic)}<h2 id="p-dlg-t">${t}</h2><div class="end"><button class="btn sm ghost" value="x" aria-label="Close">${icon('i-x')}</button></div></div>`;
const typeSel = (v, auto) => `<select class="btn" name="type">${auto ? '<option value="">Detect from files</option>' : ''}${Object.entries(TYPE).map(([k, [t]]) => `<option value="${k}"${k === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
function newDlg() {
  dlg(head('i-plus-folder', 'New Project') + `<p class="muted sm">Creates one empty folder and adds it here. Nothing else is created or installed.</p>
  <div class="pj-form"><label>Project name<input class="pj-in" name="name" maxlength="80" required placeholder="My New Game"></label>
    <label>Create in folder<input class="pj-in" name="parent" maxlength="200" required value="${esc(data?.items[0]?.dir.replace(/\\[^\\]+$/, '') || '')}" placeholder="C:\\Users\\you\\Desktop"></label>
    <label>Folder name<input class="pj-in" name="folder" maxlength="60" required pattern="[^\\\\/:*?&quot;<>|]+" placeholder="MyNewGame"></label><label>Type${typeSel('roblox')}</label>
    <p class="muted sm" id="p-path"></p><label class="px-ack"><input type="checkbox" id="p-ok"> Create this folder now.</label></div>
  <div class="lx-fa"><button class="btn ghost" value="x">Cancel</button><button class="btn pri" type="button" data-a="create" disabled>${icon('i-plus-folder')}Create Project</button></div>`);
  const f = $('p-dlg').querySelector('form'), path = () => (f.parent.value.trim().replace(/[\\/]+$/, '') + '\\' + f.folder.value.trim());
  f.oninput = () => { if (!f.folder.dataset.edited) f.folder.value = f.name.value.replace(/[^\w -]/g, '').replace(/\s+/g, ''); const bad = f.folder.value && badName(f.folder.value.trim()); $('p-path').textContent = bad ? bad + '.' : f.folder.value ? 'Folder: ' + path() : ''; f.querySelector('[data-a="create"]').disabled = !($('p-ok').checked && !bad && f.checkValidity()); };
  f.folder.addEventListener('input', () => { f.folder.dataset.edited = f.folder.value ? '1' : ''; });
  f.name.focus();
}
function importDlg() {
  dlg(head('i-arrow-down', 'Import Project') + `<p class="muted sm">Adds an existing folder. NEXUS only reads it: nothing in it is changed.</p>
  <div class="pj-form"><label>Folder path<input class="pj-in" name="dir" maxlength="260" required placeholder="C:\\Users\\you\\Desktop\\MyGame"></label>
    <label>Name <span class="muted sm">(optional)</span><input class="pj-in" name="name" maxlength="80" placeholder="From CLAUDE.md / README.md title, else the folder name"></label><label>Type${typeSel('', true)}</label></div>
  <div class="lx-fa"><button class="btn ghost" value="x">Cancel</button><button class="btn pri" type="button" data-a="doimport">${icon('i-arrow-down')}Import</button></div>`);
  $('p-dlg').querySelector('[name="dir"]').focus();
}
// ---------- Link vault & settings (M2, approved preview /preview/projects-link-preview.html) ----------
// Vaults come from Obsidian's own list (read-only). Live checks here are for guidance; the tracker re-checks everything on save.
const lkTarget = (v, f) => v ? v.replace(/[\\/]+$/, '') + (f ? '\\' + f.replace(/\//g, '\\') : '') : '';
function lkChecks(p, f) {
  const vp = (f.vpath.value.trim() || f.querySelector('[name="v"]:checked')?.value || '').replace(/[\\/]+$/, ''), folder = f.folder.value.trim().replace(/^[\\/]+|[\\/]+$/g, ''), L = [];
  if (!vp) return [['warn', 'No vault linked. Pick one above, or leave it empty to keep this project without a vault.'], vp, folder];
  const known = (data?.vaults || []).find(x => x.path.toLowerCase() === vp.toLowerCase());
  if (known && !known.ok) return [['no', 'No .obsidian folder inside, so it is not an Obsidian vault.'], vp, folder];
  L.push(known ? ['', 'Obsidian vault (registered in Obsidian)'] : ['warn', 'Typed path: NEXUS checks it is your own folder and an Obsidian vault when you save.']);
  if (folder && folder.split(/[\\/]/).some(x => x === '..' || x.startsWith('.'))) return [[...L, ['no', 'The folder must be a plain folder inside the vault (no .., no hidden folders).']], vp, folder];
  const t = lkTarget(vp, folder).toLowerCase(), hit = (data?.items || []).find(o => o.id !== p.id && o.vault && (() => { const u = lkTarget(o.vault, o.vaultFolder).toLowerCase(); return u === t || t.startsWith(u + '\\') || u.startsWith(t + '\\') })());
  L.push(hit ? ['no', `"${hit.name}" already uses ${hit.vaultFolder ? 'the folder ' + hit.vaultFolder : 'the whole vault'} here. Pick a separate folder so the projects never mix.`] : ['', 'Not used by another project']);
  if (/[\\/]OneDrive[^\\/]*([\\/]|$)/i.test(vp)) L.push(['warn', 'This vault is synced by OneDrive: its files can leave this PC through that sync.']);
  return [L, vp, folder];
}
function lkRefresh(p, f) {
  const [L, vp, folder] = lkChecks(p, f), list = Array.isArray(L[0]) ? L : [L];
  f.querySelector('.lk-checks').innerHTML = list.map(([k, t]) => `<li class="${k}">${esc(t)}</li>`).join('');
  f.querySelector('.lk-path').textContent = vp ? lkTarget(vp, folder) : '—';
  f.querySelector('[data-a="lksave"]').disabled = list.some(c => c[0] === 'no');
  f.querySelectorAll('.lk-v').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
  const g = f.querySelector('[name="graph"]:checked')?.value; f.querySelector('.lk-gout').hidden = g !== 'graphify'; f.querySelector('.lk-gnote').textContent = g === 'graphify' ? 'NEXUS only reads this graph. It must be inside this project or your NEXUS data folder.' : 'Knowledge → Graph View draws it from this vault.';
  const sy = f.querySelector('[name="sync"]:checked')?.value; f.querySelector('.lk-snote').textContent = sy === 'auto' ? 'Automatic sync is locked for now: docs sync only when you press Sync on the Knowledge page.' : sy === 'off' ? 'Sync is off for this project: the Sync button does nothing for it.' : 'Manual: docs sync when you press Sync on the Knowledge page. It always asks first.';
}
function linkDlg(p) {
  const V = data?.vaults || [], cur = (p.vault || '').toLowerCase(), inList = V.some(x => x.path.toLowerCase() === cur), sy = p.sync?.mode || 'off', gr = p.graph?.mode || 'builtin';
  const segR = (name, curV, opts) => `<div class="lk-seg" role="radiogroup">${opts.map(([v, t, tip, off]) => `<label data-tip="${esc(tip)}"><input type="radio" name="${name}" value="${v}"${v === curV ? ' checked' : ''}${off ? ' disabled' : ''}>${t}</label>`).join('')}</div>`;
  dlg(head('i-link', 'Link vault &amp; settings · ' + esc(p.name)) + `<p class="muted sm">Where this project's notes live in Obsidian, how its docs sync and which graph it uses. Saving changes only NEXUS's own project list (backed up first). Your vault, Obsidian settings and Graphify data are never changed here.</p>
  <div class="pj-form">
    <section class="lk-sec"><h3>1 · Obsidian vault <span class="muted sm">a vault is a folder of notes that Obsidian opens</span></h3>
      <div class="lk-vaults" role="radiogroup" aria-label="Vault">${V.length ? V.map(x => `<label class="lk-v${x.ok ? '' : ' off'}" title="${esc(x.ok ? x.path : 'No .obsidian folder inside, so it is not an Obsidian vault.')}"><input type="radio" name="v" value="${esc(x.path)}"${x.path.toLowerCase() === cur ? ' checked' : ''}${x.ok ? '' : ' disabled'}><b>${esc(x.name)}</b><small>${x.ok ? 'registered in Obsidian' : 'not a vault'}</small></label>`).join('') : '<p class="muted sm">No vaults found in Obsidian. Install Obsidian and create a vault, or type a vault folder below.</p>'}</div>
      <label>Or type a vault folder <span class="muted sm">(read from Obsidian's vault list above; NEXUS never edits it)</span><input class="pj-in" name="vpath" maxlength="260" value="${inList ? '' : esc(p.vault || '')}" placeholder="C:\\Users\\you\\Documents\\My Vault"></label>
      <label>Folder inside the vault <span class="muted sm">(this project's notes go here; empty = the whole vault)</span><input class="pj-in" name="folder" maxlength="120" value="${esc(p.vaultFolder || '')}" placeholder="e.g. ${esc(p.name)}"></label>
      <ul class="lk-checks" aria-live="polite"></ul>
      <div><small class="muted">Notes for this project will go to</small><div class="lk-path"></div></div></section>
    <section class="lk-sec"><h3>2 · Doc sync <span class="muted sm">keeps project docs and vault notes in step</span></h3>
      ${segR('sync', sy, [['off', 'Off', 'No doc sync for this project.'], ['manual', 'Manual (Sync button)', 'Sync when you press Sync on the Knowledge page.'], ['auto', 'Automatic', 'Locked for now, as on the Knowledge page.', true]])}
      <label>Custom sync command <span class="muted sm">(optional, saved for the sync engine)</span><input class="pj-in" name="cmd" maxlength="300" value="${esc(p.sync?.cmd || '')}" placeholder="e.g. bash sync_docs.sh"></label>
      <p class="muted sm lk-note lk-snote"></p></section>
    <section class="lk-sec"><h3>3 · Knowledge graph <span class="muted sm">a map of how your notes link together</span></h3>
      ${segR('graph', gr, [['builtin', 'Built-in (no extra installs)', 'NEXUS draws the graph itself.'], ['graphify', 'Graphify', 'Use graph.json made by Graphify (an optional extra tool).']])}
      <label class="lk-gout">Graphify output folder<input class="pj-in" name="out" maxlength="260" value="${esc(p.graph?.out || '')}" placeholder="${esc(p.dir)}\\graphify-out"></label>
      <p class="muted sm lk-note lk-gnote"></p></section>
    <label class="px-ack"><input type="checkbox" name="active"${data?.active === p.id ? ' checked disabled' : ''}> Make this the active project (Knowledge, Automation and Home follow it)</label>
  </div>
  <div class="lx-fa">${p.vault ? `<button class="btn ghost" type="button" data-a="lkunlink" data-k="${p.id}">Unlink vault</button>` : ''}<button class="btn ghost" value="x">Cancel</button><button class="btn pri" type="button" data-a="lksave" data-k="${p.id}">${icon('i-check')}Save link</button></div>`);
  const f = $('p-dlg').querySelector('form'); f.oninput = () => lkRefresh(p, f); f.onchange = () => lkRefresh(p, f); lkRefresh(p, f);
}
async function linkSave(p, f, unlink) {
  const [, vp, folder] = lkChecks(p, f), sync = { mode: f.querySelector('[name="sync"]:checked').value, cmd: f.cmd.value.trim() }, gm = f.querySelector('[name="graph"]:checked').value;
  const r = await act({ op: 'link', id: p.id, unlink, vault: vp, vaultFolder: folder, sync, graph: { mode: gm, out: gm === 'graphify' ? f.out.value.trim() : '' } }); if (!r) return;
  if (f.active.checked && !f.active.disabled && !await act({ op: 'active', id: p.id })) return;
  $('p-dlg').close(); await reload(p.id); toast(unlink ? `Vault unlinked from ${p.name}. The vault and its notes were not touched.` : r.warn ? r.warn : `${p.name}: link saved (projects.json backed up first).`, r.warn ? 'warn' : undefined);
}
function settingsDlg(p) {
  const D = det[p.id], imgs = D?.img || [];
  dlg(head('i-gear', 'Project Settings: ' + esc(p.name)) + `<div class="pj-form g2">
    <label>Name<input class="pj-in" name="name" maxlength="80" value="${esc(p.name)}" required></label><label>Type${typeSel(p.type)}</label>
    <label class="full">Description<textarea class="pj-in" name="desc" maxlength="400" rows="2">${esc(p.desc)}</textarea></label>
    <label>Status<select class="btn" name="status">${Object.entries(STAT).map(([k, [, t]]) => `<option value="${k}"${k === p.status ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    <label>Tags <span class="muted sm">comma separated, up to 8</span><input class="pj-in" name="tags" maxlength="220" value="${esc(p.tags.join(', '))}"></label>
    <label class="full">Thumbnail <span class="muted sm">${imgs.length} pictures in the folder</span><select class="btn" name="thumb"><option value="">Generated art</option>${imgs.map(f => `<option${f === p.thumb ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
    <div class="full pj-tp" id="p-tp">${p.thumb ? `<img src="/api/projects/img?id=${p.id}&f=${encodeURIComponent(p.thumb)}" alt="">` : ''}</div>
    <label class="full">Vault to open in Obsidian <span class="muted sm">optional; empty = the vault from Link Vault. Must contain a .obsidian folder</span><input class="pj-in" name="obsidian" maxlength="260" value="${esc(p.obsidian)}" placeholder="${esc(p.vault || 'C:\\Users\\you\\Documents\\Vault')}"></label>
    <label class="full">Session folders <span class="muted sm">other folders whose Claude sessions belong to this project, one per line</span><textarea class="pj-in" name="aliases" rows="2" maxlength="2100">${esc(p.aliases.join('\n'))}</textarea></label>
    <label class="full">Project tools <span class="muted sm">apps and tools it uses, comma separated</span><input class="pj-in" name="tools" maxlength="800" value="${esc(p.tools.join(', '))}" placeholder="Roblox Studio, Blender, Obsidian"></label>
    <label class="px-ack full"><input type="checkbox" name="main" ${p.main ? 'checked' : ''}> Main project (listed first, selected on open)</label>
    <p class="muted sm full">Folder: <code>${esc(p.dir)}</code> · Saved in NEXUS (projects.json), not in the project.</p></div>
  <div class="lx-fa"><button class="btn ghost" value="x">Cancel</button><button class="btn pri" type="button" data-a="save" data-k="${p.id}">${icon('i-check')}Save</button></div>`);
  const f = $('p-dlg').querySelector('form'); f.thumb.onchange = () => { $('p-tp').innerHTML = f.thumb.value ? `<img src="/api/projects/img?id=${p.id}&f=${encodeURIComponent(f.thumb.value)}" alt="">` : ''; };
}
const confirmDlg = (ic, t, body, a, k, label, danger) => dlg(head(ic, t) + body + `<div class="lx-fa"><button class="btn ghost" value="x">Cancel</button><button class="btn ${danger ? 'px-danger' : 'pri'}" type="button" data-a="${a}" data-k="${k}">${icon(ic)}${label}</button></div>`);
function report(p) {
  const D = det[p.id], s = p.stats, L = [`# ${p.name}`, '', p.desc || '', '', `- Folder: ${p.dir}`, `- Type: ${typeOf(p)[0]} · Status: ${STAT[p.status][1]}${p.tags.length ? ' · Tags: ' + p.tags.join(', ') : ''}`,
    `- Sessions: ${s.sessions} (${s.week} in the last 7 days) · Development time (est.): ${hrs(s.active)}`, `- Tracked tokens: ${s.tracked ? tok(s.tokens) + ` (${s.tracked} sessions in state.json)` : 'none tracked'}`, `- Size: ${bytes(s.bytes)}, ${s.files} files`,
    '', '## Top tools', ...s.tools.slice(0, 8).map(([g, c]) => `- ${g}: ${c}`), '', '## Insights', ...insightsOf(p, D).map(r => `- ${r.t} (based on: ${r.basis})`),
    '', '## Tasks', ...(p.tasks.length ? p.tasks.map(t => `- [${t.done ? 'x' : ' '}] ${t.kind === 'milestone' ? '(milestone) ' : ''}${t.t}`) : ['- none']),
    '', '## Recent sessions', ...D.sessions.slice(0, 15).map(x => `- ${when(x.first)} · ${hrs(x.active)} · ${x.prompt || '(no prompt text)'}`),
    '', '## Git', ...(D.git ? [`- Uncommitted: ${D.git.dirty}`, ...D.git.log.slice(0, 10).map(c => `- ${c.h} ${c.s}`)] : ['- not a repo']), '', `Generated by NEXUS ${new Date().toLocaleString()}. Time values are estimates.`];
  download(`${p.name.replace(/[^\w -]/g, '').trim() || 'project'}-report.md`, L.join('\n'), 'text/markdown');
}

// ---------- events ----------
async function copy(v) { try { await navigator.clipboard.writeText(v); toast('Copied to clipboard.'); } catch { toast(`Windows did not allow NEXUS to use the clipboard. Select the path and press Ctrl+C: ${v}`, 'warn', 'Copy failed'); } } // E9
function pick(id) { if (ui.sel !== id) { ui.sel = id; keep(); } root.querySelectorAll('.pj-c.on, .pj-t tr.on').forEach(c => c.classList.remove('on')); root.querySelectorAll(`[data-a="sel"][data-k="${id}"].pj-c, tr[data-k="${id}"]`).forEach(c => c.classList.add('on')); detail(); qa(); rec(); loadDet(id); }
// E6 titled error per action, E8 no silent no-op while another action runs
async function act(o, okMsg) { if (busy) { toast('Still working on the last action. Try again in a moment.', 'warn', 'Busy'); return null; } busy = true; const r = await post(o); busy = false; if (r.res !== 'ok') { toast(r.res, 'err', FAIL(o)); return null; } if (okMsg) toast(okMsg); return r; }
async function reload(id) { await load(); if (id) await loadDet(id, true); }
async function onClick(e) {
  const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
  const a = b.dataset.a, k = b.dataset.k, p = k ? data?.items.find(x => x.id === k) : null;
  if (a === 'task') return; // checkbox: handled on change
  if (b.tagName === 'BUTTON' && b.closest('details')) b.closest('details').removeAttribute('open');
  if (a === 'addtask') return;
  if (['sel', 'explorer', 'session', 'obsidian', 'settings', 'status', 'remove', 'backup', 'reveal', 'resume', 'deltask', 'analyze', 'report', 'copy', 'save', 'create', 'doimport', 'rmok', 'bkok', 'link', 'lksave', 'lkunlink'].includes(a)) { e.preventDefault(); e.stopPropagation(); }
  if (a === 'copy') return copy(b.dataset.v);
  if (a === 'retry') { if (!loading) await load(true); return; }
  if (a === 'invretry') { inv = null; fetchInv(); return rec(); }
  if (a === 'detretry') { det[ui.sel] = null; detail(); return loadDet(ui.sel, true); }
  if (a === 'refresh') { b.disabled = true; b.classList.add('busy'); await load(true); b.disabled = false; b.classList.remove('busy'); return err ? toast(err + '. See the message at the top of the page.', 'err', "Couldn't refresh projects") : toast(`Checked ${data?.items.length ?? 0} projects.`); } // B77
  if (a === 'new') return newDlg();
  if (a === 'import') return importDlg();
  if (a === 'view') { ui.view = b.dataset.v; keep(); return body(); }
  if (a === 'dsub') { ui.dsub = b.dataset.v; keep(); return detail(); }
  if (a === 'sel') { pick(k); if (innerWidth <= 1280) $('p-det').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (a === 'create') { const f = b.form, dir = f.parent.value.trim().replace(/[\\/]+$/, '') + '\\' + f.folder.value.trim();
    const r = await act({ op: 'add', dir, name: f.name.value, type: f.type.value, create: true }); if (!r) return; $('p-dlg').close(); ui.sel = r.item.id; ui.tab = 'all'; keep(); await reload(r.item.id); return toast(`Created ${dir} and added it.`); }
  if (a === 'doimport') { const f = b.form; const r = await act({ op: 'add', dir: f.dir.value.trim(), name: f.name.value, type: f.type.value || undefined }); if (!r) return; $('p-dlg').close(); ui.sel = r.item.id; ui.tab = 'all'; keep(); await reload(r.item.id); return toast(`Imported ${r.item.name}. Nothing in the folder was changed.`); }
  if (a === 'analyze') { b.disabled = true; await load(true); return err ? toast(err + '. See the message at the top of the page.', 'err', "Couldn't re-read the project") : toast('Stats, files and insights re-read.'); }
  if (!p && !['deltask'].includes(a)) return;
  if (a === 'explorer') return act({ op: 'open', id: k, what: 'explorer' }, 'Opened in File Explorer.');
  const TN = { wt: 'Windows Terminal', pwsh: 'PowerShell', bash: 'Git Bash' }[P.pref('cc.term')] || 'Windows Terminal'; // Settings → Claude Code: Open terminals in
  if (a === 'session') return act({ op: 'open', id: k, what: 'session', term: P.pref('cc.term') }, `Started Claude Code in ${TN}.`);
  if (a === 'obsidian') return act({ op: 'open', id: k, what: 'obsidian' }, 'Opening the vault in Obsidian.');
  if (a === 'reveal') return act({ op: 'open', id: k, what: 'reveal', f: b.dataset.v }, 'Shown in File Explorer.');
  if (a === 'resume') return act({ op: 'open', id: k, what: 'session', resume: b.dataset.v, term: P.pref('cc.term') }, `Resuming in ${TN}.`);
  if (a === 'settings') { pick(k); await loadDet(k); return settingsDlg(p); }
  if (a === 'link') { pick(k); return linkDlg(p); }
  if (a === 'lksave' || a === 'lkunlink') return linkSave(p, b.form, a === 'lkunlink');
  if (a === 'status') { if (await act({ op: 'update', id: k, set: { status: b.dataset.v } }, `${p.name}: ${STAT[b.dataset.v][1].toLowerCase()}.`)) return reload(); return; }
  if (a === 'remove') return confirmDlg('i-x', 'Remove from NEXUS: ' + esc(p.name), `<div class="px-chk"><div class="ok">${icon('i-check')}<span>Removes it from this list only. The folder <code>${esc(p.dir)}</code> and every file in it stay exactly as they are.</span></div><div class="ok">${icon('i-check')}<span>It won't be re-added automatically. Import it again any time.</span></div><div class="no">${icon('i-bolt')}<span>Its NEXUS tasks, tags and settings are dropped.</span></div></div>`, 'rmok', k, 'Remove from NEXUS', true);
  if (a === 'rmok') { if (!await act({ op: 'remove', id: k }, `${p.name} removed from NEXUS. No files were touched.`)) return; $('p-dlg').close(); ui.sel = null; return reload(); }
  if (a === 'backup') return confirmDlg('i-db', 'Create Backup: ' + esc(p.name), `<dl class="lx-dl"><dt>Copies</dt><dd>Text files only: code, docs, configs (.md .lua .luau .js .json .py .sh .html .css …), each up to 5 MB.</dd><dt>Skips</dt><dd>Binaries (.blend, .fbx, images, .rbxl), .git, node_modules, backups/, graphify-out/ and hidden folders.</dd>
    <dt>To</dt><dd><code>token-tracker/project-backups/${esc(p.id)}/&lt;date&gt;/</code>, outside the project. The project isn't changed.</dd></dl>`, 'bkok', k, 'Create Backup');
  if (a === 'bkok') { b.disabled = true; b.classList.add('busy'); const r = await act({ op: 'backup', id: k, confirm: true }); $('p-dlg').close(); if (!r) return; toast(`Backup done: ${r.backup.files} files, ${bytes(r.backup.bytes)}.`); return loadDet(k, true); }
  if (a === 'report') { if (det[k]?.res === 'ok') report(p); return; }
  if (a === 'save') { const f = b.form, set = { name: f.name.value, desc: f.desc.value, type: f.type.value, status: f.status.value, tags: f.tags.value.split(',').map(x => x.trim()).filter(Boolean), thumb: f.thumb.value,
      obsidian: f.obsidian.value.trim(), aliases: f.aliases.value.split('\n').map(x => x.trim()).filter(Boolean), tools: f.tools.value.split(',').map(x => x.trim()).filter(Boolean), main: f.main.checked };
    if (!await act({ op: 'update', id: k, set }, 'Saved.')) return; $('p-dlg').close(); return reload(); }
  if (a === 'deltask') { const P = sel(); if (await act({ op: 'delTask', id: P.id, tid: k })) return reload(); }
}
async function onInput(e) {
  const t = e.target, ch = e.type === 'change';
  if (t.id === 'p-task' || t.id === 'p-kind') { draft = { id: ui.sel, v: $('p-task').value, k: $('p-kind').value, f: false }; return; }
  if (t.id === 'p-q') { ui.q = t.value; const c = t.selectionStart; body(); const n = $('p-q'); n.focus(); n.setSelectionRange(c, c); }
  else if (ch && t.id === 'p-st') { ui.st = t.value; keep(); body(); }
  else if (ch && t.id === 'p-sort') { ui.sort = t.value; keep(); body(); }
  else if (ch && t.id === 'p-status') { const p = sel(); if (await act({ op: 'update', id: p.id, set: { status: t.value } }, `${p.name}: ${STAT[t.value][1].toLowerCase()}.`)) { await reload(); $('p-status')?.focus(); } else t.value = p.status; }
  else if (ch && t.dataset.a === 'task') { const p = sel(), k = t.dataset.k; if (await act({ op: 'task', id: p.id, tid: k, done: t.checked })) { await reload(); root?.querySelector(`input[data-a="task"][data-k="${k}"]`)?.focus(); } else t.checked = !t.checked; }
}
// task form submit (Enter or Add)
addEventListener('submit', async e => {
  if (!root || !e.target.matches?.('.pj-add')) return; e.preventDefault(); const p = sel(), v = $('p-task').value.trim(); if (!p || !v) return $('p-task')?.focus();
  if (await act({ op: 'addTask', id: p.id, t: v, kind: $('p-kind').value }, 'Added.')) { draft = null; $('p-task').value = ''; await reload(); $('p-task')?.focus(); }
});
