// Automation (Phase H). Built-in tracker scheduler: approved actions only, chained 1-4 steps, schedules, guards, history, logs.
// Real page: automations, runs, logs, guards and the scheduler come from auto.js (/api/auto); every change / run goes through a confirm
// dialog showing the exact request and commands, then POST /api/auto with confirm:true. Preview (automation-preview.html, opts.preview)
// keeps the DEMO samples and a disabled confirm button. Also: /api (built-in log), /api/proc, /api/vault, /api/inv, /api/projects.
import { esc, chip, ago, dur } from '../fmt.js';
import { icon, seg, kpi, stateBox, toast, MORE, more, errBox } from '../ui.js';

// M7d D3 Learn More (approved Automation copy), checked against auto.js. Panels change nothing.
Object.assign(MORE, {
  'au-sched': { area: 'Automation', title: 'Scheduler', what: 'Pausing stops scheduled runs from starting. Run Now keeps working, and a job that is already running finishes.',
    when: ['Stopping all scheduled jobs for a while without disabling each one.'], impact: { tokens: 'None used', files: 'Nothing changed', privacy: 'Stays on this PC', load: 'None' },
    notes: ['It runs only while the NEXUS tracker (node tracker.js serve) is running.', 'Every pause and resume asks you to confirm first.'], tech: 'POST /api/auto {"op":"pause","paused":true|false,"confirm":true}' },
  'au-guards': { area: 'Automation', title: 'Guards', what: 'Checks made before every run. Free disk under the limit: the run is refused and skipped, with no retry. Claude busy, CPU over the limit or free RAM under the limit: the run is postponed and tried again, then skipped.',
    when: ['Working out why a run was postponed or skipped.'], impact: { tokens: 'None used', files: 'Nothing changed', privacy: 'Stays on this PC', load: 'One CPU / RAM / disk reading per run' },
    notes: ['Defaults: CPU 80 %, free RAM 1.5 GB, free disk 5 GB, wait 5 min, up to 3 times. Change them in Settings → Automation.', 'Claude busy = a transcript was written in the last 120 s, or a turn is still open.', 'One job runs at a time; the same automation is never queued twice.'],
    tech: 'auto.js blocked(): disk → skipped (hard); Claude busy / CPU / RAM → postponed every wait min, after max postponements → skipped.' },
  'au-actions': { area: 'Automation', title: 'Steps and actions', what: 'An automation is 1 to 4 steps from four approved actions, run top to bottom. A failed step stops the rest unless it is set to Continue on failure.',
    when: ['Building or checking an automation.'], impact: { tokens: 'None used: no action calls Claude', files: 'Doc sync edits project docs and vault notes; backup and report make new files; health changes none', privacy: 'Stays on this PC', load: 'Light; a backup copies many files' },
    notes: ['Doc sync: bash sync_docs.sh, 5 min timeout, can\'t be cancelled once started. On a CONFLICT it fails and keeps both versions.', 'Project backup: copies text files into a new stamped folder, 10 min timeout. Never overwrites a backup.', 'Re-analyse + health: 1 min timeout. Usage report: writes a new file, 1 min timeout.'],
    tech: 'auto.js ACT: sync / backup / health / report. Nothing else can be a step.' },
  'au-skip': { area: 'Automation', title: 'Skip missed runs', what: 'Off: if a run was missed while the tracker was off, one catch-up run starts 2 min after the tracker starts. On: missed runs are skipped.',
    when: ['Turn it on for jobs that only make sense at their set time.'], impact: { tokens: 'None used', files: 'Nothing changed until a catch-up run runs', privacy: 'Stays on this PC', load: 'None' },
    notes: ['One catch-up per automation, for the newest missed time only.', 'The missed time shows in history as Missed.', 'An interrupted run is never re-run automatically.'], tech: 'auto.js catchUp(): runs 2 min after tracker start, skips automations with skipMissed.' },
  'au-health': { area: 'Automation', title: 'Automation Health', what: 'A summary of the last 7 days. Failed: a run failed or was interrupted. Attention: a run was postponed, skipped or missed. All Clear: neither.',
    when: ['A quick check that scheduled jobs really ran.'], impact: { tokens: 'None used', files: 'Nothing changed', privacy: 'Stays on this PC', load: 'None' },
    notes: ['Click the Automation Health card to see only the runs that need attention.'], tech: 'From the saved runs (auto-runs.json) of the last 7 days.' },
  'au-hist': { area: 'Automation', title: 'Execution History', what: 'Every run with its time, trigger, result, duration and reason. Pick a run to see its log.',
    when: ['Checking what ran, when and why it stopped.'], impact: { tokens: 'None used', files: 'Export saves a new file to Downloads', privacy: 'Stays on this PC', load: 'None' },
    notes: ['Keeps the last 500 runs or 90 days, with 200 log lines per run.', 'Export (CSV, or JSON with logs) only reads: nothing on the scheduler changes.'], tech: 'GET /api/auto/runs. Kept in auto-runs.json.' },
  'au-import': { area: 'Automation', title: 'Import automations', what: 'Adds automations from a NEXUS automations JSON file, after checking each one against the approved actions and schedule rules.',
    when: ['Moving automations from another PC or a saved Export.'], impact: { tokens: 'None used', files: 'Adds automations to the scheduler after you confirm', privacy: 'Stays on this PC', load: 'None' },
    notes: ['Up to 50 items per file.', 'Imported automations arrive disabled.', 'Replacing an existing automation asks a second time; its run history is kept.'], tech: 'POST /api/auto {"op":"import","items":[…],"confirm":true}' },
});

// The approved action list (spec §23). Nothing else can be a step.
const ACT = {
  sync: { t: 'Doc sync', ic: 'i-refresh', c: '#5AB8F2', to: 5, min: 15, cmd: () => `bash sync_docs.sh   (in ${actP()?.name || 'the active project'})`, cancel: false,
    what: 'Two-way doc merge + Graphify rebuild. On CONFLICT the step fails, both versions are kept, nothing is resolved.' },
  backup: { t: 'Project backup', ic: 'i-db', c: '#F2B544', to: 10, min: 60, cmd: o => `copy text files of "${pname(o.proj)}" → NEXUS_DATA/project-backups/${o.proj || '?'}/<new stamp>`, cancel: true,
    what: 'Copies text files OUT of the project into a new stamped folder. Never overwrites or deletes a backup.' },
  health: { t: 'Re-analyse + health', ic: 'i-gauge', c: '#31D67A', to: 1, min: 15, cmd: () => 'tracker re-analysis (act analyze) + CPU / RAM / disk snapshot', cancel: true,
    what: 'Recounts tracker stats and records CPU, RAM, disk and tracker issues; bell notice over the thresholds.' },
  report: { t: 'Usage report', ic: 'i-chart', c: '#C48BFF', to: 1, min: 60, cmd: o => `write NEXUS_DATA/reports/<date>-${o.period || 'day'}.md (new file)`, cancel: true,
    what: 'Token and session summary for the day or week, written as a new file.' },
};
const TYPES = [['demand', 'On demand'], ['interval', 'Interval'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly']];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const GUARD = { cpu: 80, ram: 1.5, disk: 5, wait: 5, max: 3 }; // defaults; per-automation overrides live in Settings → Automation
const TPL = [
  ['Doc sync', [['sync', {}]], { type: 'demand' }], ['Project backup', [['backup', { proj: '' }]], { type: 'demand' }],
  ['Health check', [['health', {}]], { type: 'interval', every: 360 }], ['Usage report', [['report', { period: 'day' }]], { type: 'daily', at: '21:00' }],
  ['Daily Docs', [['sync', {}], ['health', {}]], { type: 'daily', at: '10:00' }], ['Nightly Backup', [['backup', { proj: '' }]], { type: 'daily', at: '03:00' }],
  ['Weekly Report', [['report', { period: 'week' }]], { type: 'weekly', day: 1, at: '09:00' }],
];

let ac = null, root, O = {}, KEY, ui, api = null, proc = null, vault = null, inv = null, projs = null, A = [], RUNS = [], draft = null, tick = 0, offVis = null, SV = null, G = GUARD;
const LOGS = {}; // run id → log lines (fetched from /api/auto/runs)
const $ = id => root?.querySelector('#' + id);
const pname = id => projs?.items?.find(p => p.id === id)?.name || id || '?';
const actP = () => (projs?.items || []).find(p => p.id === projs?.active) || (projs?.items || []).find(p => /my-game/i.test(p.dir || '')); // active project (M2), else the original default
const defProj = () => actP()?.id || projs?.items?.[0]?.id || '';
const SRC = () => O.preview ? chip('demo', 'Sample automation (design preview).') : SV ? chip('live', 'From the NEXUS scheduler (auto.js).') : chip('unk', 'The scheduler is not answering, so this may be out of date.');
const FIELDS = ['id', 'name', 'desc', 'steps', 'sched', 'notify', 'skipMissed', 'guards'];
const pick = a => Object.fromEntries(FIELDS.filter(k => a[k] !== undefined).map(k => [k, k === 'sched' ? Object.fromEntries(Object.entries(a.sched).filter(([x]) => ['type', 'every', 'at', 'days', 'day'].includes(x))) : clone(a[k])]));
const reqTxt = b => `<div class="cc-cmd">POST /api/auto ${esc(JSON.stringify({ ...b, confirm: true }).slice(0, 400))}</div>`;
let SVat = 0, SVerr = ''; // last good /api/auto time + last failure (B73 status card)
async function load() { // real mode: whole scheduler state
  if (O.preview) return; try { SV = await getJ('/api/auto'); } catch (e) { SV = null; SVerr = e?.message || 'HTTP ' + e; return; }
  SVat = Date.now(); A = SV.items; RUNS = SV.runs; G = SV.guards; ui.paused = SV.paused;
  if (SV.running) { const r = RUNS.find(x => x.id === SV.running.run); if (r) LOGS[r.id] = SV.running.log; }
  if (!ui.sel || (!ui.sel.startsWith('b-') && !A.some(a => a.id === ui.sel) && draft?.id !== ui.sel)) ui.sel = A[0]?.id || null;
}
async function send(b, msg) {
  try { const x = await fetch('/api/auto', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, confirm: true }) }), j = await x.json();
    if (j.res !== 'ok') { toast(`The scheduler answered: ${j.res}.`, 'err', "Couldn't " + (OPS[b.op] || 'finish that')); return null; } if (msg) toast(j.note || msg, j.note ? 'warn' : 'ok'); await load(); draw(); return j; }
  catch (e) { toast(`The tracker didn't answer (${e.message}), so the request may not have arrived. Check the status at the top of this page, then try again.`, 'err', "Couldn't " + (OPS[b.op] || 'finish that') + ': tracker not reachable'); return null; }
}
const OPS = { save: 'save', run: 'start the run', cancel: 'stop', toggle: 'turn it on / off', delete: 'delete', pause: 'pause / resume', import: 'import' };
const NOREACH = "The tracker didn't answer, so nothing was exported.";
// B73: scheduler status card, redrawn only when the state changes (focus on Retry now survives failed polls).
function status() {
  const el = $('au-st'); if (!el) return; const k = O.preview || SV ? '' : SVat ? 'stale' : 'first'; if (el._k === k) return; el._k = k; el.hidden = !k;
  el.innerHTML = !k ? '' : errBox({ title: 'Scheduler not reachable', where: 'Automation',
    what: k === 'first' ? "NEXUS can't reach the scheduler in its tracker, so no automations or runs can be shown." : `The scheduler stopped answering. The automations and runs below are from ${hm(SVat)} and may be out of date.`,
    why: "Saving, Run Now and Stop can't reach it until it answers. If the tracker is off, scheduled runs don't start until it is back.",
    affected: 'Automations, runs, logs and guards on this page. NEXUS checks again every 5 s.',
    steps: ['Make sure the tracker is running: node ~/.claude/token-tracker/tracker.js serve', 'Press Retry now.'], actions: [['retry', 'Retry now', true]], more: ['au-sched', 'Scheduler'],
    tech: `GET /api/auto failed: ${SVerr}. The page asks every 5 s; Retry now repeats that one request and never runs an automation.` });
}
// Redraw without losing keyboard focus: refocus the rebuilt control with the same id / data-* key.
const keep = fn => { const f = document.activeElement, q = root?.contains(f) ? [...f.attributes].find(x => x.name === 'id' || (x.name.startsWith('data-') && x.name !== 'data-tip')) : null;
  fn(); if (q && !f.isConnected) root?.querySelector(`[${q.name}="${CSS.escape(q.value)}"]`)?.focus(); };
const sig = () => JSON.stringify([SV?.running?.run, SV?.runs?.[0]?.id, SV?.runs?.[0]?.res, SV?.queue, SV?.paused, A.length, !SV]);
async function refresh() { // real mode: one /api/auto read (poll and Retry now)
  const was = sig(); await load(); if (!root) return; status();
  keep(() => { if (was !== sig()) { kpis(); list(); history(); if (!draft) detail(); else { logs(); const c = $('au-d')?.querySelector('.card-h > .chip'); if (c) c.outerHTML = SRC(); } } else if (SV?.running?.id === ui.sel) logs(); });
}
const download = (name, text, type = 'application/json') => { const u = URL.createObjectURL(new Blob([text], { type })), l = document.createElement('a'); l.href = u; l.download = name; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ui)); } catch { } };
const getJ = u => fetch(u, { cache: 'no-store' }).then(x => x.ok ? x.json() : Promise.reject(x.status));
const clone = o => JSON.parse(JSON.stringify(o));
const sel = () => draft && draft.id === ui.sel ? draft : A.find(a => a.id === ui.sel) || null;
const hm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const when = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + hm(t);
const left = t => { const s = Math.max(0, Math.round((t - Date.now()) / 1000)); return s >= 86400 ? Math.floor(s / 86400) + 'd ' + Math.floor(s % 86400 / 3600) + 'h' : s >= 3600 ? Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's'; };
const secs = ms => ms < 60000 ? Math.round(ms / 1000) + 's' : Math.floor(ms / 60000) + 'm ' + String(Math.round(ms % 60000 / 1000)).padStart(2, '0') + 's';

// ---------- schedule maths + validation (same rules the server will enforce) ----------
export function next(s, from = Date.now(), n = 5) {
  if (!s || s.type === 'demand') return [];
  if (s.type === 'interval') { const e = s.every * 60000, b = s.last || s.since || from; let t = b + e; if (t <= from) t += Math.ceil((from - t + 1) / e) * e; return Array.from({ length: n }, (_, i) => t + i * e); }
  const [h, m] = (s.at || '').split(':').map(Number), ok = s.type === 'daily' ? () => true : s.type === 'weekly' ? d => d === +s.day : d => (s.days || []).includes(d), out = [];
  for (let i = 0; out.length < n && i < 400; i++) { const d = new Date(from); d.setDate(d.getDate() + i); d.setHours(h, m, 0, 0); if (d > from && ok(d.getDay())) out.push(+d); }
  return out;
}
export function check(a) {
  const e = [], s = a.sched || {};
  if (!a.name?.trim() || a.name.length > 60) e.push('Name: 1-60 characters.');
  if (!Array.isArray(a.steps) || a.steps.length < 1 || a.steps.length > 4) e.push('Steps: 1 to 4 approved actions.');
  for (const st of a.steps || []) if (!ACT[st.a]) e.push(`Unknown action "${st.a}": only ${Object.keys(ACT).join(', ')} are allowed.`);
    else if (st.a === 'backup' && !st.o?.proj) e.push('Project backup: pick a project.');
  if (!TYPES.some(t => t[0] === s.type)) e.push('Schedule type is not valid.');
  const min = Math.max(15, ...(a.steps || []).map(st => ACT[st.a]?.min || 15));
  if (s.type === 'interval' && !(Number.isInteger(s.every) && s.every >= min && s.every <= 1440)) e.push(`Interval: ${min} min to 24 h${min > 15 ? ' (backup and report run at most hourly)' : ''}.`);
  if (/daily|weekdays|weekly/.test(s.type) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.at || '')) e.push('Time: pick a valid time (HH:MM).');
  if (s.type === 'weekdays' && !(s.days || []).length) e.push('Weekdays: pick at least one day.');
  if (s.type === 'weekly' && !(+s.day >= 0 && +s.day <= 6)) e.push('Weekly: pick a day.');
  return e;
}
const schedTxt = s => !s || s.type === 'demand' ? 'On demand' : s.type === 'interval' ? (s.every % 60 ? `Every ${s.every} min` : `Every ${s.every / 60} h`) : s.type === 'daily' ? `Daily · ${s.at}` : s.type === 'weekly' ? `Weekly · ${DAYS[s.day]} ${s.at}` : `${(s.days || []).map(d => DAYS[d]).join(', ')} · ${s.at}`;

// ---------- DEMO data (preview only: no scheduler yet) ----------
function demo() {
  const mk = (id, name, desc, steps, sched, on) => ({ id, name, desc, steps: steps.map(([a, o]) => ({ a, o: o || {}, cont: false })), sched, on, notify: { fail: true, post: true, ok: false }, skipMissed: false });
  A = [mk('a1', 'Daily Docs', 'Syncs project docs with the vault, rebuilds the graph, then records tracker health.', [['sync'], ['health']], { type: 'daily', at: '10:00' }, true),
    mk('a2', 'Nightly Backup', 'Copies the active project\'s text files to a new backup folder.', [['backup', { proj: 'my-game' }]], { type: 'daily', at: '03:00' }, true),
    mk('a3', 'Health Check', 'Tracker re-analysis and a CPU / RAM / disk snapshot.', [['health']], { type: 'interval', every: 360 }, true),
    mk('a4', 'Weekly Report', 'Writes last week\'s token and session summary.', [['report', { period: 'week' }]], { type: 'weekly', day: 1, at: '09:00' }, false),
    mk('a5', 'Doc Sync', 'Same as Sync All on the Obsidian page.', [['sync']], { type: 'demand' }, false)];
  const D = 864e5, now = Date.now(), day = (k, at) => { const d = new Date(now - k * D); const [h, m] = at.split(':'); d.setHours(+h, +m, 0, 0); return +d; };
  RUNS = [];
  const run = (a, at, res, ms, why = '', trig = 'schedule') => RUNS.push({ id: a + at, a, at, res, ms, why, trig });
  for (let k = 0; k < 14; k++) {
    if (k === 3) run('a1', day(k, '10:00'), 'postponed', 0, 'Claude busy: last request 38 s ago. Retried 10:05.');
    run('a1', day(k, k === 3 ? '10:05' : '10:00'), k === 9 ? 'failed' : 'success', 128000 + (k * 7919) % 20000, k === 9 ? 'Step 1 Doc sync: CONFLICT PROJECT_DOCS.md (both sides changed). Both versions kept, nothing resolved.' : '');
    run('a2', day(k, '03:00'), k === 5 ? 'missed' : 'success', k === 5 ? 0 : 41000 + (k * 3571) % 9000, k === 5 ? 'Tracker was off at 03:00. Caught up at 08:12.' : '', k === 5 ? 'catch-up' : 'schedule');
    for (const at of ['00:00', '06:00', '12:00', '18:00']) if (day(k, at) < now) run('a3', day(k, at), k === 1 && at === '12:00' ? 'skipped' : 'success', 900 + (k * 131) % 400, k === 1 && at === '12:00' ? 'Busy 3 times (CPU 91 %, Claude busy, Claude busy). Next normal run 18:00.' : '');
  }
  run('a5', now - 2 * D, 'success', 31000, '', 'manual');
  RUNS = RUNS.filter(r => r.at < now).sort((x, y) => y.at - x.at);
  for (const a of A) if (a.sched.type === 'interval') a.sched.last = RUNS.find(r => r.a === a.id && r.res === 'success')?.at;
}
const LOG = { sync: ['Starting Doc sync (bash sync_docs.sh)', 'sync: 14 files checked, 2 written, 0 conflicts', 'graph: 312 nodes, 1236 links, 0 unresolved links', 'Doc sync done'],
  backup: ['Starting Project backup (my-game)', 'copying text files (no binaries, .git, node_modules, backups)', '1,284 files, 38 MB → project-backups/my-game/<stamp>', 'Project backup done (nothing overwritten)'],
  health: ['Starting Re-analyse + health', 'tracker re-analysis done', 'CPU 4 % · RAM 61 % · disk 41 % · 0 tracker issues', 'Health snapshot saved'],
  report: ['Starting Usage report (week)', 'summarising 7 days of sessions', 'wrote reports/<date>-week.md (new file)', 'Usage report done'] };
function logOf(r) {
  const a = A.find(x => x.id === r.a), t0 = r.at; let t = t0; const L = [], at = () => `[${new Date(t).toLocaleTimeString([], { hour12: false })}]`;
  if (r.res === 'postponed' || r.res === 'skipped' || r.res === 'missed') return [[at(), r.why, 'w']];
  (a?.steps || []).forEach((s, i) => { for (const l of LOG[s.a]) { t += Math.round(r.ms / (a.steps.length * 4)); const bad = r.res === 'failed' && i === 0 && l.startsWith('sync:'); L.push([at(), bad ? 'CONFLICT PROJECT_DOCS.md: both sides changed (both versions saved in backups/sync_conflicts/)' : l, bad ? 'e' : '']); if (bad) return; } });
  L.push([at(), r.res === 'failed' ? 'Stopped: step 1 failed, later steps skipped.' : `All steps completed in ${secs(r.ms)}.`, r.res === 'failed' ? 'e' : 'ok']);
  return L;
}

// ---------- built-in (real, read-only) ----------
function builtins() {
  const hk = inv?.hooks || [], has = re => hk.some(h => re.test(h.cmd)), sy = vault?.sync;
  return [
    { id: 'b-stop', name: 'Stop-hook doc sync', desc: 'Runs sync_docs.sh after Claude turns when a doc changed (the project\'s .claude/settings.json).', ic: 'i-refresh', sched: 'After each Claude turn', real: true },
    { id: 'b-snap', name: 'Auto-save before compact / clear', desc: 'PreCompact + SessionEnd hooks save recent context to the vault.', ic: 'i-save', sched: has(/tracker\.js.*snap/) ? 'On compact / clear' : 'Hook not found', real: true },
    { id: 'b-tick', name: 'Tracker analysis', desc: 'Recounts usage, tips and checks while the tracker runs.', ic: 'i-gauge', sched: 'Every 30 s', last: api?.at ?? null, real: true },
    { id: 'b-sync', name: 'Obsidian Sync All', desc: 'Manual sync_docs.sh run from the Obsidian & Graphify page.', ic: 'i-graph', sched: 'Manual', last: sy?.at || null, res: sy ? (sy.failed ? 'failed' : 'success') : null, ms: sy?.ms, log: sy?.lines, real: true },
  ];
}

// ---------- render ----------
const sw = (on, attrs, label) => `<label class="au-sw" data-tip="${esc(label)}"><input type="checkbox" ${on ? 'checked' : ''} ${attrs} aria-label="${esc(label)}"><i></i></label>`;
const RES = { success: ['ok', 'Success'], failed: ['err', 'Failed'], postponed: ['warn', 'Postponed'], skipped: ['warn', 'Skipped'], cancelled: ['', 'Cancelled'], missed: ['info', 'Missed'], running: ['ok', 'Running'], interrupted: ['err', 'Interrupted'] };
const resChip = r => `<span class="au-res ${RES[r]?.[0] || ''}">${RES[r]?.[1] || '—'}</span>`;
const stepsTxt = a => a.steps.map(s => ACT[s.a].t).join(' → ');
const health7 = () => { const w = RUNS.filter(r => r.at > Date.now() - 7 * 864e5), f = w.filter(r => r.res === 'failed' || r.res === 'interrupted'), p = w.filter(r => /postponed|skipped|missed/.test(r.res)); return { f, p, last: f[0] || p[0] || null }; };

function kpis() {
  const on = A.filter(a => a.on), sch = on.filter(a => a.sched.type !== 'demand'), nx = ui.paused ? null : sch.map(a => [a, next(a.sched)[0]]).sort((x, y) => x[1] - y[1])[0];
  const set = (id, v, f) => { const e = $(id); if (!e) return; e.querySelector('.v').textContent = v; e.querySelector('.f').innerHTML = f; e.querySelector('.kc').innerHTML = O.preview ? chip('demo', 'Sample automations (design preview).') : SV ? chip('live', 'From the NEXUS scheduler.') : chip('unk', SVat ? 'Last data from ' + hm(SVat) + ': the scheduler is not answering.' : 'The scheduler is not answering.'); };
  set('k-n', A.length, `${on.length} active · ${A.length - on.length} inactive`);
  set('k-s', sch.length, nx ? `Next: ${esc(nx[0].name)} in <span data-at="${nx[1]}">${left(nx[1])}</span>` : ui.paused ? 'Scheduler paused' : 'Nothing scheduled');
  const ok = RUNS.filter(r => r.res === 'success').length, done = RUNS.filter(r => /success|failed|cancelled|interrupted/.test(r.res)).length;
  const tot = SV?.total ?? RUNS.length; set('k-r', tot, `Success rate: ${done ? Math.round(ok / done * 100) + '%' : '—'} · kept ${tot} of 500`);
  const h = health7(), e = $('k-h'), st = h.f.length ? ['err', 'Failed'] : h.p.length ? ['warn', 'Attention'] : ['ok', 'All Clear'];
  set('k-h', st[1], h.last ? `${h.f.length} failed · ${h.p.length} postponed / skipped / missed · ${esc(ago(h.last.at))}` : 'No failed, postponed or skipped runs in 7 days');
  e.dataset.st = st[0]; e.dataset.tip = h.last ? 'Newest: ' + h.last.why : 'Last 7 days';
}
function guards() {
  const el = $('au-g'); if (!el) return;
  if (!proc && !SV) { el.innerHTML = `<span class="muted">Guard status: tracker not reachable</span>`; return; }
  const free = SV ? SV.free.ram : proc.mem ? (proc.mem[0] - proc.mem[1]) / 1e9 : null, dk = SV ? SV.free.disk : proc.disk ? (proc.disk[0] - proc.disk[1]) / 1e9 : null, cpu = SV ? SV.cpu : proc.cpu;
  const busyS = proc?.cur ? Math.round((Date.now() - proc.cur.end) / 1000) : null, busy = busyS != null && busyS < 120, qn = SV ? SV.queue.length + (SV.running ? 1 : 0) : 0;
  const g = (k, v, ok, tip) => `<span class="au-gi ${ok ? 'ok' : 'warn'}" data-tip="${esc(tip)}"><span class="dot ${ok ? 'ok' : 'warn'}"></span>${k}<b>${v}</b></span>`;
  keep(() => el.innerHTML = `<span class="au-gl">${icon('i-shield')}Guards ${chip('live', O.preview ? 'From /api/proc, refreshed every 5 s.' : 'From the scheduler (/api/auto), refreshed every 5 s.')}${more('au-guards', 'Guards')}</span>`
    + g('Scheduler', ui.paused ? 'Paused' : 'Running', !ui.paused, O.preview ? 'Preview: this switch shows how pausing looks.' : 'Runs only while the NEXUS tracker (node tracker.js serve) is running.')
    + g('Queue', SV?.running ? `${qn} · running` : String(qn), true, 'One job at a time; the same automation is never queued twice.')
    + g('Claude', busy ? `Busy · ${busyS}s ago` : 'Idle', !busy, `Busy = a Claude request in the last 120 s or a turn in progress. Jobs wait ${G.wait} min, up to ${G.max} times.${G.claude === false ? ' (Wait for Claude is off in Settings.)' : ''} This strip shows the last request time; at run time the scheduler also reads the transcript tail.${SV?.busy ? ' Last check: ' + SV.busy.why : ''}`)
    + g(O.preview ? 'Tracker CPU' : 'System CPU', cpu == null ? '—' : cpu + '%', cpu == null || cpu <= G.cpu, `${O.preview ? '' : 'All cores, sampled every 5 s. '}Postpone above ${G.cpu} %`)
    + g('Free RAM', free == null ? '—' : free.toFixed(1) + ' GB', free == null || free >= G.ram, `Postpone below ${G.ram} GB`)
    + g('Free disk', dk == null ? '—' : Math.round(dk) + ' GB', dk == null || dk >= G.disk, `Refuse below ${G.disk} GB`));
}
function list() {
  const el = $('au-list'); if (!el) return;
  const qs = (ui.q || '').toLowerCase(), f = ui.f;
  if (f === 'built') { el.innerHTML = builtins().filter(b => b.name.toLowerCase().includes(qs)).map(b => `<button class="au-li${ui.sel === b.id ? ' on' : ''}" data-sel="${b.id}"><span class="tile-ic" style="--tc:var(--info)">${icon(b.ic)}</span>
    <span><b>${esc(b.name)}</b><small>${esc(b.sched)}${b.last ? ' · ' + esc(ago(b.last)) : ''}</small></span><span class="au-ro" data-tip="Built-in: read-only. NEXUS never edits hooks.">${icon('i-lock')}</span></button>`).join(''); return; }
  const L = [...A, ...(draft && !A.some(a => a.id === draft.id) ? [draft] : [])].filter(a => (f === 'all' || (f === 'on') === !!a.on) && a.name.toLowerCase().includes(qs));
  el.innerHTML = L.map(a => { const r = RUNS.find(x => x.a === a.id), run = SV?.running?.id === a.id || SV?.queue.includes(a.id), dot = run ? 'info' : !a.on ? '' : /^(failed|interrupted)$/.test(r?.res) ? 'err' : r && /postponed|skipped|missed/.test(r.res) ? 'warn' : 'ok', ac = ACT[a.steps[0]?.a] || ACT.sync;
    return `<div class="au-li${ui.sel === a.id ? ' on' : ''}" data-sel="${a.id}" role="button" tabindex="0"><span class="tile-ic" style="--tc:${ac.c}">${icon(ac.ic)}</span>
    <span><b>${esc(a.name)}${draft?.id === a.id ? ' <i class="au-dirty" data-tip="Unsaved draft"></i>' : ''}</b><small>${esc(stepsTxt(a))}</small><small>${icon('i-clock')}${esc(schedTxt(a.sched))}<span class="dot ${dot}"${run ? ' data-tip="Running or queued"' : ''}></span></small></span>
    ${sw(a.on, `data-tog="${a.id}"`, a.on ? 'Disable' : 'Enable')}<button class="au-more" data-menu="${a.id}" aria-label="More actions for ${esc(a.name)}">⋮</button></div>`; }).join('') || stateBox('empty', 'No automations', 'Use a template or New Automation.');
}
function detail() {
  const el = $('au-d'); if (!el) return;
  const b = builtins().find(x => x.id === ui.sel);
  if (b) { el.innerHTML = `<div class="card-h"><span class="tile-ic" style="--tc:var(--info)">${icon(b.ic)}</span><h2>${esc(b.name)}</h2>${chip('live', 'Real automation that already exists. Read-only here.')}</div>
    <div class="au-box"><span class="k">Description</span><p>${esc(b.desc)}</p></div>
    <dl class="au-dl"><dt>${icon('i-cal')}Trigger</dt><dd>${esc(b.sched)}</dd><dt>${icon('i-clock')}Last run</dt><dd>${b.last ? esc(when(b.last)) + ' ' + (b.res ? resChip(b.res) : '') : 'Not reported by the tracker'}</dd>${b.ms ? `<dt>${icon('i-timer')}Duration</dt><dd>${secs(b.ms)}</dd>` : ''}</dl>
    <p class="au-help">${icon('i-lock')}Built-in automations are shown, never changed: hooks live in Claude Code's settings files and are edited there.</p>`; logs(); return; }
  const a = sel(); if (!a) { el.innerHTML = stateBox('empty', 'Pick an automation'); return; }
  const R = RUNS.filter(r => r.a === a.id), last = R[0], nx = a.on && !ui.paused ? next(a.sched)[0] : null, ok = R.filter(r => r.res === 'success'), fin = R.filter(r => /success|failed|cancelled|interrupted/.test(r.res));
  const dirty = draft?.id === a.id, err = check(a);
  el.innerHTML = `<div class="card-h"><span class="tile-ic" style="--tc:${ACT[a.steps[0]?.a]?.c || 'var(--primary)'}">${icon(ACT[a.steps[0]?.a]?.ic || 'i-flow')}</span><h2>${esc(a.name)}</h2>${SRC()}
    <div class="end">${dirty ? `<span class="au-unsaved"><i class="au-dirty"></i>Unsaved</span><button class="btn sm ghost" data-a="discard">Discard</button><button class="btn sm pri" data-a="review" ${err.length ? 'disabled data-tip="Fix the errors first"' : ''}>${icon('i-save')}Review &amp; Save</button>` : ''}${sw(a.on, `data-tog="${a.id}"`, a.on ? 'Disable' : 'Enable')}</div></div>
    ${seg([['ov', 'Overview'], ['steps', 'Steps'], ['sched', 'Schedule'], ['set', 'Settings']], ui.tab, 'tabs au-tabs')}
    <div class="au-pane" id="au-pane">${({ ov, steps, sched, set }[ui.tab] || ov)(a, { R, last, nx, ok, fin, err })}</div>`;
  logs();
}
const ov = (a, { R, last, nx, ok, fin }) => `<div class="au-box"><span class="k">Description</span><p>${esc(a.desc || 'No description.')}</p></div>
  <dl class="au-dl"><dt>${icon('i-cal')}Trigger</dt><dd>${esc(schedTxt(a.sched))}${a.on ? '' : ' <span class="muted">(disabled)</span>'}</dd>
  <dt>${icon('i-clock')}Last run</dt><dd>${last ? esc(when(last.at)) + ' ' + resChip(last.res) : 'Never'}</dd>
  <dt>${icon('i-timer')}Next run</dt><dd>${nx ? esc(when(nx)) + ` <span class="au-cd" data-at="${nx}">${left(nx)}</span>` : !a.on ? 'Disabled' : a.sched.type === 'demand' ? 'On demand only' : 'Scheduler paused'}</dd></dl>
  <div class="au-st"><div><span>${icon('i-play')}Total runs</span><b>${R.length}</b></div><div><span>${icon('i-check')}Success rate</span><b>${fin.length ? Math.round(ok.length / fin.length * 100) + '%' : '—'}</b></div><div><span>${icon('i-timer')}Avg duration</span><b>${ok.length ? secs(ok.reduce((s, r) => s + r.ms, 0) / ok.length) : '—'}</b></div></div>
  <div class="au-sub"><h3>Recent Runs</h3><button class="au-link" data-hist="${a.id}">View All</button></div>
  <div class="au-runs">${R.slice(0, 5).map(r => `<button class="au-run${ui.run === r.id ? ' on' : ''}" data-run="${r.id}">${resChip(r.res)}<span>${esc(when(r.at))}</span><span class="muted">${r.res === 'success' ? 'Completed in ' + secs(r.ms) : r.res === 'running' ? 'Running…' : esc((r.why || '').split('.')[0])}</span>${icon('i-chev')}</button>`).join('') || '<p class="au-help">No runs yet.</p>'}</div>`;
const steps = a => `<p class="au-help">${icon('i-info')}Runs top to bottom, one at a time. A failed step stops the rest unless it is set to continue. Max 4 steps, approved actions only.${more('au-actions', 'Steps and actions')}</p>
  <ol class="au-steps">${a.steps.map((s, i) => { const x = ACT[s.a]; return `<li style="--tc:${x.c}"><span class="tile-ic">${icon(x.ic)}</span><div><b>${i + 1}. ${x.t}</b><small>${esc(x.what)}</small>
    ${s.a === 'backup' ? `<label class="au-in">Project <select data-so="${i}:proj">${s.o.proj ? '' : '<option value="" selected>Pick a project…</option>'}${(projs?.items || [{ id: s.o.proj, name: pname(s.o.proj) }]).map(p => `<option value="${esc(p.id)}" ${p.id === s.o.proj || p.name === s.o.proj ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
    ${s.a === 'report' ? `<label class="au-in">Period <select data-so="${i}:period"><option value="day" ${s.o.period !== 'week' ? 'selected' : ''}>Day</option><option value="week" ${s.o.period === 'week' ? 'selected' : ''}>Week</option></select></label>` : ''}
    <code>${esc(x.cmd(s.o))}</code><span class="au-meta">Timeout ${x.to} min · ${x.cancel ? 'Cancel supported' : 'Cancel not supported once started'}</span>
    <label class="au-chk"><input type="checkbox" data-cont="${i}" ${s.cont ? 'checked' : ''}> Continue on failure</label></div>
    <span class="au-ord"><button class="au-ib" data-mv="${i}:-1" ${i ? '' : 'disabled'} aria-label="Move up">${icon('i-arrow-up')}</button><button class="au-ib" data-mv="${i}:1" ${i < a.steps.length - 1 ? '' : 'disabled'} aria-label="Move down">${icon('i-arrow-down')}</button><button class="au-ib" data-rm="${i}" ${a.steps.length > 1 ? '' : 'disabled'} aria-label="Remove step">${icon('i-x')}</button></span></li>`; }).join('')}</ol>
  ${a.steps.length < 4 ? `<div class="au-add"><span class="muted">Add step</span>${Object.entries(ACT).map(([k, x]) => `<button class="btn sm ghost" data-add="${k}" style="--tc:${x.c}">${icon(x.ic)}${x.t}</button>`).join('')}</div>` : '<p class="au-help">4 steps is the maximum.</p>'}`;
function sched(a, { err }) {
  const s = a.sched, N = next(s);
  return `${seg(TYPES, s.type, 'tabs chips au-types')}
  <div class="au-sf">${s.type === 'demand' ? '<p class="au-help">Runs only when you press Run Now.</p>' : ''}
    ${s.type === 'interval' ? `<label class="au-in">Every <input type="number" min="15" max="1440" step="15" value="${s.every}" data-s="every" aria-label="Interval in minutes"> minutes <span class="muted">(${s.every % 60 ? '' : s.every / 60 + ' h, '}15 min to 24 h)</span></label>` : ''}
    ${/daily|weekdays|weekly/.test(s.type) ? `<label class="au-in">At <input type="time" value="${s.at || ''}" data-s="at" aria-label="Time"> <span class="muted">local PC time</span></label>` : ''}
    ${s.type === 'weekdays' ? `<div class="au-days" role="group" aria-label="Weekdays">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="${(s.days || []).includes(d) ? 'on' : ''}" data-day="${d}" aria-pressed="${(s.days || []).includes(d)}">${DAYS[d]}</button>`).join('')}</div>` : ''}
    ${s.type === 'weekly' ? `<div class="au-days" role="group" aria-label="Day">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="${+s.day === d ? 'on' : ''}" data-wday="${d}" aria-pressed="${+s.day === d}">${DAYS[d]}</button>`).join('')}</div>` : ''}
    <label class="au-chk"><input type="checkbox" data-skip ${a.skipMissed ? 'checked' : ''}> Skip missed runs <span class="muted">(off: one catch-up run 2 min after the tracker starts)</span></label>${more('au-skip', 'Skip missed runs')}</div>
  ${err.length ? `<div class="au-err" role="alert">${err.map(e => `<span>${icon('i-warn')}${esc(e)}</span>`).join('')}</div>` : ''}
  <div class="au-sub"><h3>Next 5 runs</h3>${a.on ? '' : '<span class="muted">shown for when it is enabled</span>'}</div>
  <ol class="au-next">${N.length ? N.map((t, i) => `<li style="--d:${i}"><span>${esc(new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))}</span><b>${hm(t)}</b><span class="au-cd" data-at="${t}">${left(t)}</span></li>`).join('') : '<li class="muted">No scheduled runs.</li>'}</ol>`;
}
const set = a => `<div class="au-sub"><h3>Notifications</h3><span class="muted">bell notice</span></div>
  ${[['fail', 'Failed runs'], ['post', 'Postponed, skipped or missed runs'], ['ok', 'Successful runs']].map(([k, t]) => `<label class="au-chk"><input type="checkbox" data-nt="${k}" ${a.notify[k] ? 'checked' : ''}> ${t}</label>`).join('')}
  <div class="au-sub"><h3>Resource guards</h3><button class="au-link" data-a="settings" data-tip="Defaults and per-automation thresholds are edited in Settings → Automation">Edit in Settings → Automation</button></div>
  ${(() => { const g = { ...G, ...(a.guards || {}) }, ov = k => a.guards?.[k] != null ? ' <span class="muted">(this automation)</span>' : ''; return `<dl class="au-dl g"><dt>System CPU</dt><dd>postpone above ${g.cpu} %${ov('cpu')}</dd><dt>Free RAM</dt><dd>postpone below ${g.ram} GB${ov('ram')}</dd><dt>Free disk</dt><dd>refuse below ${g.disk} GB${ov('disk')}</dd>
  <dt>Claude busy</dt><dd>${g.claude === false ? 'not checked' : 'wait'}${ov('claude')}; postpone ${g.wait} min, up to ${g.max} times, then skip (reason in history + bell)</dd>`; })()}<dt>Overlap</dt><dd>one job at a time; never queued twice</dd>
  <dt>Timeouts</dt><dd>${a.steps.map(s => `${ACT[s.a].t} ${ACT[s.a].to} min`).join(' · ')}</dd></dl>`;

function logs() {
  const el = $('au-log'); if (!el) return;
  const b = builtins().find(x => x.id === ui.sel);
  if (b) { el.innerHTML = b.log?.length ? `<div class="au-lh">${chip('live', 'Real output of the last Sync All')}<span class="muted">${esc(when(b.last))}</span></div><pre>${b.log.slice(-40).map(l => `<span class="${/CONFLICT|FAIL|ERROR/.test(l) ? 'e' : ''}">${esc(l)}</span>`).join('\n')}</pre>`
    : b.id === 'b-tick' ? `<div class="au-lh">${chip('live')}<span class="muted">tracker automation log</span></div><pre>${(api?.auto || []).slice(0, 12).map(([t, m]) => `<span>[${esc(when(t))}] ${esc(m)}</span>`).join('\n') || 'No entries.'}</pre>` : '<p class="au-help">This automation keeps no log NEXUS can read.</p>'; return; }
  const a = sel(), r = RUNS.find(x => x.id === ui.run && x.a === a?.id) || RUNS.find(x => x.a === a?.id);
  if (r && !O.preview && !LOGS[r.id]) { el.innerHTML = '<p class="au-help">Loading log…</p>'; getJ('/api/auto/runs?id=' + encodeURIComponent(r.a) + '&limit=100').then(j => { for (const x of j.runs) LOGS[x.id] = x.log; LOGS[r.id] ||= []; logs(); }).catch(() => { el.innerHTML = '<p class="au-help">Log not loaded: the tracker didn\'t answer. Pick the run again to retry.</p>'; }); return; }
  const lines = r ? O.preview ? logOf(r) : LOGS[r.id].map(([t, l, c]) => [`[${new Date(t).toLocaleTimeString([], { hour12: false })}]`, l, c]) : [];
  el.innerHTML = r ? `<div class="au-lh">${O.preview ? chip('demo', 'Sample log') : chip('live', r.res === 'running' ? 'Live: refreshed every 5 s' : 'Saved run log (last 200 lines)')}<span class="muted">${esc(when(r.at))} · ${esc(r.trig)}</span>${resChip(r.res)}</div><pre>${(lines.length ? lines : [['', 'No log lines.', '']]).map(([t, l, c]) => `<span class="${c}">${t} ${esc(l)}</span>`).join('\n')}</pre>` : '<p class="au-help">No runs yet.</p>';
}
function templates() {
  const el = $('au-tpl'); if (!el) return;
  el.innerHTML = TPL.map(([n, st, s], i) => { const x = ACT[st[0][0]]; return `<div class="au-tp"><span class="tile-ic" style="--tc:${x.c}">${icon(st.length > 1 ? 'i-flow' : x.ic)}</span><span><b>${n}</b><small>${st.map(q => ACT[q[0]].t).join(' → ')} · ${esc(schedTxt(s))}</small></span><button class="btn sm" data-tpl="${i}">Use</button></div>`; }).join('');
}
function history() {
  const el = $('au-h'); if (!el) return;
  const f = ui.hf || 'all', who = ui.ha || '', L = RUNS.filter(r => (f === 'all' || (f === 'attn' ? /failed|postponed|skipped|missed/.test(r.res) : r.res === f)) && (!who || r.a === who));
  const ran = d => { const w = RUNS.filter(r => r.ms && r.at > Date.now() - d * 864e5); return w.length ? `${secs(w.reduce((s, r) => s + r.ms, 0))} total · ${secs(w.reduce((s, r) => s + r.ms, 0) / w.length)} avg` : '—'; };
  $('au-hs').innerHTML = `<span data-tip="Measured run time of runs that started${O.preview ? ' (demo data in the preview)' : ''}">7 d: <b>${ran(7)}</b></span><span>30 d: <b>${ran(30)}</b></span>`;
  el.innerHTML = `<table class="tbl au-tbl"><thead><tr><th><button>Time</button></th><th><button>Automation</button></th><th><button>Trigger</button></th><th><button>Result</button></th><th class="n"><button>Duration</button></th><th><button>Reason</button></th></tr></thead><tbody>
  ${L.slice(0, ui.hn || 12).map(r => `<tr data-run="${r.id}" tabindex="0"><td>${esc(when(r.at))}</td><td>${esc(A.find(a => a.id === r.a)?.name || (r.name ? r.name + ' (deleted)' : 'Deleted'))}</td><td>${esc(r.trig)}</td><td>${resChip(r.res)}</td><td class="n">${r.ms ? secs(r.ms) : '—'}</td><td class="au-why" title="${esc(r.why)}">${esc(r.why || '—')}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">No runs match.</td></tr>`}</tbody></table>
  ${L.length > (ui.hn || 12) ? `<button class="btn sm ghost au-more-h" data-a="more">Show more (${L.length - (ui.hn || 12)})</button>` : ''}`;
  root.querySelectorAll('#au-hf .tab').forEach(b => { const on = b.dataset.v === f; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
}
const draw = () => { status(); kpis(); guards(); list(); detail(); templates(); history(); };

// ---------- dialogs: every change / run waits for Confirm (preview: the button is disabled) ----------
function dlg(ic, title, desc, body, go = 'Confirm', onGo = null) {
  const d = $('au-dlg');
  d.innerHTML = `<form method="dialog"><h3>${icon(ic)}${esc(title)}</h3><p>${desc}</p>${body}
    <div class="row"><span class="muted">${O.preview ? 'Preview: nothing runs or saves.' : ''}</span><button class="btn" value="cancel">Cancel</button>
    <button class="btn pri" value="go" ${O.preview ? 'disabled data-tip="Preview only: nothing runs or saves."' : ''}>${esc(go)}</button></div></form>`;
  d.returnValue = ''; d.onclose = () => { if (d.returnValue === 'go' && onGo && !O.preview) onGo(d); }; d.showModal(); d.querySelector('button[value=cancel]').focus();
}
const act = (ic, title, desc, body, go, b, msg, then) => dlg(ic, title, desc, body + (O.preview ? '' : reqTxt(b)), go, () => send(b, msg).then(j => j && then?.(j)));
const plan = a => `<ol class="au-plan">${a.steps.map((s, i) => `<li><b>${ACT[s.a].t}</b>${s.cont ? ' <span class="muted">(continue on failure)</span>' : ''}<div class="cc-cmd">${esc(!draft && a.cmds?.[i] || ACT[s.a].cmd(s.o))}</div></li>`).join('')}</ol>`;
function diff(a) {
  const o = A.find(x => x.id === a.id), row = (k, x, y) => x === y ? '' : `<tr><td>${k}</td><td class="del">${esc(x ?? '—')}</td><td class="add">${esc(y)}</td></tr>`;
  const r = o ? row('Name', o.name, a.name) + row('Steps', stepsTxt(o), stepsTxt(a)) + row('Schedule', schedTxt(o.sched), schedTxt(a.sched)) + row('Skip missed', String(o.skipMissed), String(a.skipMissed)) + row('Notify', JSON.stringify(o.notify), JSON.stringify(a.notify)) : row('New', null, `${a.name}: ${stepsTxt(a)} · ${schedTxt(a.sched)} (disabled)`);
  return `<table class="tbl au-diff"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${r || '<tr><td colspan="3" class="muted">No changes.</td></tr>'}</tbody></table>`;
}
async function exportDlg(a) {
  let o = { nexus: 'automations', v: 1, items: (a ? [a] : A).map(pick) };
  if (!O.preview) try { o = await getJ('/api/auto/export?id=' + encodeURIComponent(a ? a.id : 'all')); } catch { return toast(NOREACH, 'err', "Couldn't export: tracker not reachable"); }
  const j = JSON.stringify(o, null, 2), name = `nexus-automations-${a ? a.name.replace(/[^\w-]+/g, '-') : 'all'}-${new Date().toISOString().slice(0, 10)}.json`;
  dlg('i-dl', a ? 'Export ' + a.name : 'Export all automations', `Saves <b>${esc(name)}</b> to your Downloads folder (read-only: nothing on the scheduler changes). Runs and logs are exported from History.`, `<div class="cc-cmd">GET /api/auto/export?id=${esc(a ? a.id : 'all')}</div><pre class="au-json">${esc(j)}</pre>`, 'Download JSON', () => download(name, j));
}
function importDlg() {
  dlg('i-ul', 'Import automations', 'Pick a NEXUS automations JSON. Every item is checked against the approved actions and schedule rules; imports arrive <b>disabled</b> and never replace an existing automation without a separate confirm.',
    `<input type="file" accept="application/json,.json" id="au-file" class="au-file" aria-label="Automations file"><div id="au-imp"></div>`, 'Import (disabled)');
  let items = null; const go = root.querySelector('#au-dlg button[value=go]'); go.disabled = true;
  $('au-dlg').onclose = () => { const d = $('au-dlg'); if (d.returnValue !== 'go' || !items || O.preview) return; const ok = items.filter(x => !check(x).length);
    const rep = [...d.querySelectorAll('[data-rep]:checked')].map(x => x.dataset.rep), b = { op: 'import', items };
    if (!rep.length) return send(b, `Imported ${ok.length} (disabled)`);
    act('i-warn', 'Replace ' + rep.length + ' existing automation' + (rep.length > 1 ? 's' : ''), 'These saved automations are overwritten by the imported version and turned <b>off</b>. Their run history is kept.', `<ul>${rep.map(id => `<li>${esc(A.find(a => a.id === id)?.name || id)}</li>`).join('')}</ul>`, 'Replace', { ...b, replace: rep, confirmReplace: true }, 'Imported (disabled)'); };
  $('au-file').onchange = async e => {
    const out = $('au-imp'); let j; items = null; go.disabled = true; try { j = JSON.parse(await e.target.files[0].text()); } catch { out.innerHTML = '<div class="au-err"><span>This file isn\'t valid JSON. Pick a file saved with Export on this page.</span></div>'; return; }
    const L = j?.nexus === 'automations' && Array.isArray(j.items) ? j.items.slice(0, 50) : null;
    if (!L) { out.innerHTML = '<div class="au-err"><span>Not a NEXUS automations file (it needs "nexus": "automations" and an items list). Pick a file saved with Export on this page.</span></div>'; return; }
    out.innerHTML = L.map(x => { const it = { ...x, steps: Array.isArray(x?.steps) ? x.steps.map(s => ({ a: s?.a, o: s?.o || {} })) : [] }, e2 = check(it), dup = A.some(a => a.id === x.id);
      return `<div class="au-ii ${e2.length ? 'bad' : ''}"><b>${esc(x?.name || '(no name)')}</b><small>${e2.length ? 'Rejected: ' + esc(e2.join(' ')) : esc(stepsTxt(it) + ' · ' + schedTxt(it.sched)) + (dup ? ' · same id exists: imported as a copy' : ' · new')}</small>${!e2.length && dup && !O.preview ? `<label class="au-chk"><input type="checkbox" data-rep="${esc(x.id)}"> Replace the existing one instead (asks again)</label>` : ''}</div>`; }).join('')
      + (O.preview ? '' : `<div class="cc-cmd">POST /api/auto {"op":"import","items":[${L.length} item${L.length > 1 ? 's' : ''}],"confirm":true}</div>`);
    items = L; go.disabled = O.preview || !L.some(x => !check({ ...x, steps: Array.isArray(x?.steps) ? x.steps : [] }).length);
  };
}
function menu(id, btn) {
  const m = $('au-menu'), a = A.find(x => x.id === id) || sel(); ui.sel = id; list(); detail();
  m.innerHTML = [['run', 'i-play', 'Run Now'], ['dup', 'i-layers', 'Duplicate'], ['exp', 'i-dl', 'Export'], ['del', 'i-x', 'Delete']].map(([k, ic, t]) => `<button data-q="${k}" class="${k === 'del' ? 'bad' : ''}">${icon(ic)}${t}</button>`).join('');
  const r = btn.getBoundingClientRect(), h = root.getBoundingClientRect(); m.style.left = (r.right - h.left - 170) + 'px'; m.style.top = (r.bottom - h.top + 4) + 'px'; m.hidden = false; m.querySelector('button').focus();
  void a;
}
function quick(k) {
  const a = sel(); if (!a) return toast(builtins().some(b => b.id === ui.sel) ? 'Built-in automations are read-only' : 'Pick an automation first', 'warn');
  if (!A.some(x => x.id === a.id) && k !== 'edit') return toast('Save the draft first (Review & Save)', 'warn');
  const busy = SV?.running?.id === a.id, queued = SV?.queue.includes(a.id);
  if (k === 'run') act('i-play', 'Run ' + a.name + ' now', `Queued behind any running job; the guards still apply (Claude busy → waits ${G.wait} min, up to ${G.max} times). Steps:`, plan(a), 'Run Now', { op: 'run', id: a.id }, 'Queued: ' + a.name);
  else if (k === 'stop') { if (!O.preview && !busy && !queued) return toast('Nothing is running for ' + a.name, 'warn'); const st = busy ? a.steps[SV.running.step] : null;
    act('i-x', 'Stop ' + a.name, queued ? 'Removes it from the queue. Nothing has started.' : 'Cancels the running job. Doc sync can\'t be cancelled once started (it could leave half-merged docs), so a running sync finishes first and the later steps are skipped; a cancelled backup keeps its partial folder marked "cancelled (partial)".', O.preview ? '<p class="au-help">Nothing is running in this preview.</p>' : st ? `<p class="au-help">Now running: step ${SV.running.step + 1} ${ACT[st.a].t}${ACT[st.a].cancel ? '' : ' (finishes first)'}.</p>` : '', 'Stop', { op: 'cancel', id: a.id }, 'Stopping ' + a.name); }
  else if (k === 'edit') { ui.tab = 'steps'; save(); detail(); }
  else if (k === 'dup') { const c = { ...pick(a), name: (a.name + ' (copy)').slice(0, 60) }; delete c.id; act('i-layers', 'Duplicate ' + a.name, 'Creates "' + esc(c.name) + '", disabled, with the same steps and schedule.', plan(a), 'Duplicate', { op: 'save', item: c }, 'Duplicated (disabled)'); }
  else if (k === 'exp') exportDlg(a);
  else if (k === 'del') act('i-x', 'Delete ' + a.name, 'Removes the automation' + (queued ? ' and its queued run' : '') + '. Its run history is kept (marked "deleted"); no files are deleted.' + (busy ? ' A run in progress finishes first.' : ''), '', 'Delete', { op: 'delete', id: a.id }, 'Deleted ' + a.name);
}
function toggle(id) {
  const a = A.find(x => x.id === id) || (draft?.id === id && draft); if (!a) return;
  if (!O.preview && !A.some(x => x.id === id)) { draw(); return toast('Save the draft first: new automations are saved disabled', 'warn'); }
  if (!O.preview && draft?.id === id) { draw(); return toast('Save or discard the unsaved changes first', 'warn'); }
  const N = next({ ...a.sched, since: Date.now(), last: undefined });
  act('i-flow', (a.on ? 'Disable ' : 'Enable ') + a.name, a.on ? 'Stops future scheduled runs. Run Now keeps working.' : `Turns the schedule on: ${esc(schedTxt(a.sched))}.${N[0] ? ' First run ' + esc(when(N[0])) + '.' : ''}${ui.paused ? ' The scheduler is paused, so nothing runs until you resume it.' : ''}`, a.on ? '' : plan(a), a.on ? 'Disable' : 'Enable', { op: 'toggle', id: a.id, on: !a.on }, a.name + (a.on ? ' disabled' : ' enabled'));
  draw(); // the switch snaps back: nothing changes until confirmed
}
function histExport() { // read-only download of the runs in the current filter
  const f = ui.hf || 'all', L = RUNS.filter(r => (f === 'all' || (f === 'attn' ? /failed|postponed|skipped|missed/.test(r.res) : r.res === f)) && (!ui.ha || r.a === ui.ha)), day = new Date().toISOString().slice(0, 10);
  const csv = () => 'time,automation,trigger,result,duration_s,reason\n' + L.map(r => [new Date(r.at).toISOString(), r.name || A.find(x => x.id === r.a)?.name || r.a, r.trig, r.res, Math.round((r.ms || 0) / 1000), r.why || ''].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  const json = async () => { if (O.preview) return JSON.stringify(L, null, 2); const j = await getJ('/api/auto/runs?limit=500' + (ui.ha ? '&id=' + encodeURIComponent(ui.ha) : '')), ids = new Set(L.map(r => r.id)); return JSON.stringify(j.runs.filter(r => ids.has(r.id)), null, 2); };
  dlg('i-dl', 'Export history', `${L.length} run${L.length === 1 ? '' : 's'} in the current filter, saved to your Downloads folder (read-only). JSON includes each run's log.`,
    `<label class="au-chk"><input type="radio" name="hx" value="csv" checked> CSV</label><label class="au-chk"><input type="radio" name="hx" value="json"> JSON with logs</label><div class="cc-cmd">GET /api/auto/runs?limit=500</div>`, 'Download',
    async d => { const k = d.querySelector('[name=hx]:checked').value; try { k === 'csv' ? download(`nexus-runs-${day}.csv`, csv(), 'text/csv') : download(`nexus-runs-${day}.json`, await json()); } catch { toast(NOREACH, 'err', "Couldn't export history: tracker not reachable"); } });
}
function edit(fn) { const a = sel(); if (!a || builtins().some(b => b.id === a.id)) return; if (draft?.id !== a.id) draft = clone(a); fn(draft); list(); detail(); }

export async function mount(el, params = [], opts = {}) {
  root = el; O = opts; KEY = opts.preview ? 'jv.auto.preview' : 'jv.auto';
  ui = { sel: opts.preview ? 'a1' : null, tab: 'ov', f: 'all', q: '', hf: 'all', ha: '', paused: false };
  try { Object.assign(ui, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { }
  draft = null; if (opts.preview) demo(); else { A = []; RUNS = []; await load(); }
  el.innerHTML = `<div class="pg au enter">
  <header class="pg-h" style="--i:0"><span class="tile-ic pg-ic">${icon('i-flow')}</span>
    <div class="pg-t"><h1>Automation ${opts.preview ? chip('demo', 'Design preview: real guard data; automations and runs are samples; nothing runs.').replace('DEMO', 'PREVIEW') : ''}</h1><p>Scheduled and one-click jobs from an approved action list. Runs only while the NEXUS tracker is running.</p></div>
    <div class="end"><span class="au-sch">${sw(!ui.paused, 'data-a="pause"', 'Pause or resume all scheduled runs')}<span>Scheduler</span>${more('au-sched', 'Scheduler')}</span>
      <button class="btn pri" data-a="new">${icon('i-plus-folder')}New Automation</button><button class="btn" data-a="tpl">${icon('i-book')}Templates</button>
      <button class="btn" data-a="import">${icon('i-ul')}Import</button>${more('au-import', 'Import automations')}<button class="btn" data-a="export">${icon('i-dl')}Export</button></div></header>
  <div id="au-st" hidden></div>
  <div class="kpis k4 au-k" style="--i:1">${kpi('k-n', 'i-flow', 'Automations')}${kpi('k-s', 'i-cal', 'Scheduled')}${kpi('k-r', 'i-play', 'Total Runs')}
    <button class="au-kb" data-a="health" aria-label="Open history filtered to runs that need attention">${kpi('k-h', 'i-shield', 'Automation Health')}</button></div>
  <div class="au-g" id="au-g" style="--i:2"></div>
  <div class="au-grid" style="--i:3">
    <section class="card au-l"><div class="card-h"><h2>Automations</h2><div class="end"><button class="au-ib" data-a="new" aria-label="New automation" data-tip="New automation">${icon('i-plus-folder')}</button></div></div>
      <label class="au-search">${icon('i-search')}<input id="au-q" placeholder="Search automations…" aria-label="Search automations" value="${esc(ui.q)}"></label>
      <div id="au-f">${seg([['all', 'All'], ['on', 'Active'], ['off', 'Inactive'], ['built', 'Built-in']], ui.f, 'tabs chips')}</div>
      <div class="au-list" id="au-list"></div></section>
    <section class="card au-d" id="au-d"></section>
    <div class="au-r">
      <section class="card"><div class="card-h"><h2>Quick Actions</h2></div><div class="au-q">
        ${[['run', 'i-play', 'Run Now', 'ok'], ['stop', 'i-x', 'Stop run', 'err'], ['edit', 'i-wand', 'Edit', 'info'], ['dup', 'i-layers', 'Duplicate', ''], ['exp', 'i-dl', 'Export', ''], ['del', 'i-x', 'Delete', 'err']].map(([k, ic, t, c]) => `<button class="au-qb ${c}" data-q="${k}">${icon(ic)}${t}</button>`).join('')}</div></section>
      <section class="card" id="au-tplc"><div class="card-h"><h2>Templates</h2><span class="muted end">Use = new draft, disabled</span></div><div id="au-tpl" class="au-tpl"></div></section>
      <section class="card au-logc"><div class="card-h"><h2>Automation Logs</h2><div class="end"><button class="au-link" data-hist="sel">View All</button></div></div><div id="au-log" class="au-log" role="log"></div></section>
    </div></div>
  <section class="card au-hc" id="au-hc" style="--i:4"><div class="card-h"><h2>Execution History</h2>${more('au-hist', 'Execution History')}${opts.preview ? chip('demo', 'Sample runs: 14 days') : chip('live', 'Saved runs (auto-runs.json)')}<div class="au-hs" id="au-hs"></div>
    <div class="end"><select id="au-ha" aria-label="Filter by automation"><option value="">All automations</option>${A.map(a => `<option value="${a.id}" ${ui.ha === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
    <button class="btn sm ghost" data-a="hexp">${icon('i-dl')}Export CSV / JSON</button></div></div>
    <div id="au-hf">${seg([['all', 'All'], ['attn', 'Needs attention'], ['success', 'Success'], ['failed', 'Failed'], ['postponed', 'Postponed'], ['skipped', 'Skipped'], ['cancelled', 'Cancelled'], ['missed', 'Missed']], ui.hf, 'tabs chips')}${more('au-health', 'Automation Health')}</div>
    <div class="tbl-wrap" id="au-h"></div><p class="au-help">Kept: last 500 runs or 90 days, 200 log lines per run. Export before older runs expire.</p></section>
  <div class="au-menu" id="au-menu" hidden role="menu"></div>
  <dialog class="lx-dlg au-dlg" id="au-dlg" aria-label="Confirm"></dialog></div>`;
  ac?.abort(); ac = new AbortController(); const lo = { signal: ac.signal };
  el.addEventListener('click', click, lo); el.addEventListener('change', change, lo); el.addEventListener('input', input, lo); el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches?.('[data-sel],tr[data-run]')) click(e); if (e.key === 'Escape') $('au-menu').hidden = true; }, lo);
  draw();
  const poll = async () => { if (document.hidden || !root) return; try { proc = await getJ('/api/proc'); } catch { proc = null; }
    if (!O.preview) await refresh(); if (root) guards(); };
  const cd = () => root?.querySelectorAll('[data-at]').forEach(e => { e.textContent = left(+e.dataset.at); });
  tick = setInterval(cd, 1000); const pt = setInterval(poll, 5000), vis = () => !document.hidden && poll(); document.addEventListener('visibilitychange', vis);
  offVis = () => { clearInterval(pt); document.removeEventListener('visibilitychange', vis); };
  let ok = true;
  try { [api, proc] = await Promise.all([getJ('/api'), getJ('/api/proc')]); } catch { ok = false; }
  if (!root) return ok;
  await Promise.all([getJ('/api/vault').then(j => { vault = j; }).catch(() => { }), getJ('/api/inv').then(j => { inv = j; }).catch(() => { }), getJ('/api/projects').then(j => { projs = j; }).catch(() => { })]);
  if (root) draw();
  return ok;
}
function click(e) {
  const m = $('au-menu'); if (!e.target.closest('#au-menu, [data-menu]')) m.hidden = true;
  const t = e.target.closest('[data-sel], button, tr[data-run]'); if (!t || t.disabled) return;
  if (t.dataset.menu) { e.stopPropagation(); return menu(t.dataset.menu, t); }
  if (t.closest('.au-sw') || t.closest('label')) return;
  if (t.dataset.q) { m.hidden = true; return quick(t.dataset.q); }
  if (t.matches('[data-sel]')) { if (t.dataset.sel !== ui.sel) { ui.sel = t.dataset.sel; ui.run = null; save(); list(); detail(); } return; }
  if (t.closest('.au-tabs') && t.dataset.v) { ui.tab = t.dataset.v; save(); return detail(); }
  if (t.closest('#au-f') && t.dataset.v) { ui.f = t.dataset.v; save(); if (ui.f === 'built' && !ui.sel.startsWith('b-')) ui.sel = 'b-sync'; else if (ui.f !== 'built' && ui.sel.startsWith('b-')) ui.sel = A[0]?.id; list(); return detail(); }
  if (t.closest('#au-hf') && t.dataset.v) { ui.hf = t.dataset.v; ui.hn = 12; save(); return history(); }
  if (t.closest('.au-types') && t.dataset.v) return edit(d => { const v = t.dataset.v; d.sched = { type: v, ...(v === 'interval' ? { every: 360 } : v === 'demand' ? {} : { at: d.sched.at || '10:00' }), ...(v === 'weekdays' ? { days: [1, 2, 3, 4, 5] } : {}), ...(v === 'weekly' ? { day: 1 } : {}) }; });
  if (t.dataset.day) return edit(d => { const n = +t.dataset.day, s = new Set(d.sched.days); s.has(n) ? s.delete(n) : s.add(n); d.sched.days = [...s].sort(); });
  if (t.dataset.wday) return edit(d => { d.sched.day = +t.dataset.wday; });
  if (t.dataset.mv) return edit(d => { const [i, k] = t.dataset.mv.split(':').map(Number); [d.steps[i], d.steps[i + k]] = [d.steps[i + k], d.steps[i]]; });
  if (t.dataset.rm) return edit(d => d.steps.splice(+t.dataset.rm, 1));
  if (t.dataset.add) return edit(d => d.steps.push({ a: t.dataset.add, o: t.dataset.add === 'backup' ? { proj: defProj() } : t.dataset.add === 'report' ? { period: 'day' } : {}, cont: false }));
  if (t.dataset.run) { ui.run = t.dataset.run; const r = RUNS.find(x => x.id === ui.run); if (r && r.a !== ui.sel) { ui.sel = r.a; list(); detail(); } else { root.querySelectorAll('.au-run').forEach(b => b.classList.toggle('on', b.dataset.run === ui.run)); logs(); } return; }
  if (t.dataset.hist) { ui.ha = t.dataset.hist === 'sel' ? (ui.sel?.startsWith('b-') ? '' : ui.sel) : t.dataset.hist; ui.hf = 'all'; $('au-ha').value = ui.ha; history(); return $('au-hc').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  if (t.dataset.tpl != null) { const [n, st, s] = TPL[+t.dataset.tpl]; draft = { id: 'new' + Date.now(), name: n, desc: 'From the ' + n + ' template.', steps: st.map(([a, o]) => ({ a, o: a === 'backup' ? { proj: defProj() } : { ...o }, cont: false })), sched: { ...s }, on: false, notify: { fail: true, post: true, ok: false }, skipMissed: false };
    ui.sel = draft.id; ui.tab = 'steps'; ui.f = 'all'; list(); detail(); return toast('Draft from template: review it, then Review & Save'); }
  const a = t.dataset.a;
  if (a === 'new') { draft = { id: 'new' + Date.now(), name: 'New automation', desc: '', steps: [{ a: 'health', o: {}, cont: false }], sched: { type: 'demand' }, on: false, notify: { fail: true, post: true, ok: false }, skipMissed: false }; ui.sel = draft.id; ui.tab = 'steps'; ui.f = 'all'; list(); return detail(); }
  if (a === 'tpl') return $('au-tplc').scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (a === 'import') return importDlg();
  if (a === 'export') return exportDlg(null);
  if (a === 'health') { ui.hf = 'attn'; ui.ha = ''; $('au-ha').value = ''; history(); return $('au-hc').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  if (a === 'discard') { const id = draft?.id; draft = null; if (!A.some(x => x.id === id)) ui.sel = A[0]?.id || null; list(); return detail(); }
  if (a === 'review') { const d = draft, isNew = !A.some(x => x.id === d.id), item = pick(d); if (isNew) delete item.id;
    return act('i-save', 'Save ' + d.name, 'Review the change. ' + (isNew ? 'New automations are saved <b>disabled</b>.' : 'It keeps its on/off state; the new schedule applies from its next run.'), diff(d) + plan(d), 'Save', { op: 'save', item }, 'Saved ' + d.name,
      j => { if (draft === d) draft = null; ui.sel = j.id; save(); list(); detail(); }); }
  if (a === 'more') { ui.hn = (ui.hn || 12) + 20; return history(); }
  if (a === 'hexp') return histExport();
  if (a === 'retry') return refresh().then(() => root && guards()); // B73: one GET /api/auto; never runs an automation
  if (a === 'settings') { location.hash = '#/settings/auto'; return; }
}
function change(e) {
  const x = e.target;
  if (x.dataset.tog) return toggle(x.dataset.tog);
  if (x.dataset.a === 'pause') { act('i-flow', ui.paused ? 'Resume the scheduler' : 'Pause the scheduler', ui.paused ? 'Scheduled runs start again from their next time.' : 'No scheduled runs start until you resume. Run Now keeps working; a running job finishes.', '', ui.paused ? 'Resume' : 'Pause', { op: 'pause', paused: !ui.paused }, ui.paused ? 'Scheduler resumed' : 'Scheduler paused'); x.checked = !ui.paused; return; }
  if (x.id === 'au-ha') { ui.ha = x.value; save(); return history(); }
  if (x.dataset.cont) return edit(d => { d.steps[+x.dataset.cont].cont = x.checked; });
  if (x.dataset.so) return edit(d => { const [i, k] = x.dataset.so.split(':'); d.steps[+i].o[k] = x.value; });
  if (x.dataset.nt) return edit(d => { d.notify[x.dataset.nt] = x.checked; });
  if (x.matches('[data-skip]')) return edit(d => { d.skipMissed = x.checked; });
  if (x.dataset.s) return edit(d => { d.sched[x.dataset.s] = x.dataset.s === 'every' ? Math.round(+x.value) : x.value; });
}
function input(e) { if (e.target.id === 'au-q') { ui.q = e.target.value; list(); } }
export function update(st) { if (!root || !st?.r) return; api = st.r; if (ui.sel === 'b-tick') logs(); }
export function unmount() { clearInterval(tick); offVis?.(); ac?.abort(); root = null; }
