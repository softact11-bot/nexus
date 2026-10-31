// NEXUS Automation scheduler (spec §23). Runs only inside `node tracker.js serve`. Approved actions only (Doc sync, Project backup,
// Re-analyse + health, Usage report); a step is { a, o, cont } checked against ACT. No shell strings, no Windows tasks, never deletes files,
// never touches Claude Code config. One worker, FIFO queue, the same automation is never queued twice. New / imported automations start disabled.
const fs = require('fs'), path = require('path'), os = require('os'), RED = require('./redact.js'); // M4c: home → ~ and secrets masked in logs, exports and error text (spec §26.8)
const DATA = process.env.NEXUS_DATA || __dirname, AF = path.join(DATA, 'automations.json'), RF = path.join(DATA, 'auto-runs.json'), REP = path.join(DATA, 'reports');
const CLAUDE = process.env.NEXUS_CLAUDE_PROJECTS || path.join(os.homedir(), '.claude', 'projects');
const MIN = 6e4, SM = MIN / (+process.env.NEXUS_AUTO_SPEED || 1), DAY = 864e5, KEEP = 500, KEEP_MS = 90 * DAY, LINES = 200, BUSY_MS = 120e3;
const GUARD = { cpu: 80, ram: 1.5, disk: 5, wait: 5, max: 3, claude: true };
const GR = { cpu: [30, 100], ram: [0.5, 16], disk: [1, 100], wait: [1, 30], max: [0, 10] };
const TYPES = ['demand', 'interval', 'daily', 'weekdays', 'weekly'];
let dep = {}; // from tracker.js: log(msg), analyze(), rep(), K (knowledge.js), P (projects.js)

const { readJ, writeJ, BAD } = require('./backup.js'); // B59 store, shared with tracker.js + projects.js (P2a T4)
let S = null, RUNS = null; // S = { v, paused, guards, items }
const load = () => { if (!S) { S = readJ(AF, null) || { v: 1, paused: false, guards: { ...GUARD }, items: [] }; S.guards = { ...GUARD, ...S.guards }; RUNS = readJ(RF, []) } };
const saveS = () => writeJ(AF, S), saveR = () => { for (const r of RUNS) if (r.why) r.why = RED(r.why); const cut = Date.now() - KEEP_MS; RUNS = RUNS.filter(r => r.at > cut).slice(0, KEEP); writeJ(RF, RUNS) };

// ---------- actions ----------
const ACT = {
  sync: { t: 'Doc sync', to: 5, min: 15, cancel: false, opts: {}, cmd: () => { const w = require('./knowledge.js').where(); return 'bash sync_docs.sh   (in ' + w.proj.replace(require('os').homedir(), '%USERPROFILE%') + ')' } },
  backup: { t: 'Project backup', to: 10, min: 60, cancel: true, opts: { proj: v => typeof v === 'string' && !!dep.P?.byId(v) }, cmd: o => `copy text files of "${dep.P?.byId(o.proj)?.name || o.proj}" → NEXUS_DATA/project-backups/${o.proj}/<new stamp>` },
  health: { t: 'Re-analyse + health', to: 1, min: 15, cancel: true, opts: {}, cmd: () => 'tracker re-analysis (act analyze) + CPU / RAM / disk snapshot' },
  report: { t: 'Usage report', to: 1, min: 60, cancel: true, opts: { period: v => v === 'day' || v === 'week' }, cmd: o => `write NEXUS_DATA/reports/<date>-${o.period || 'day'}.md (new file)` },
};
const sleep = ms => new Promise(f => setTimeout(f, ms));
async function doSync(job, L) {
  const K = dep.K, r = K.sync({ low: true }); if (r.res !== 'ok') throw new Error(r.res);
  let seen = 0, warned = false; const t0 = Date.now();
  for (;;) { await sleep(500); const s = K.syncState() || {}; const lines = s.lines || [];
    if (s.running) { for (const l of lines.slice(seen)) L(l, /CONFLICT|ERROR/.test(l) ? 'e' : ''); seen = lines.length;
      if (!warned && Date.now() - t0 > ACT.sync.to * MIN) { warned = true; L(`Still running after ${ACT.sync.to} min: Doc sync can't be cancelled safely, waiting for it to finish.`, 'w'); dep.log(`Automation "${job.name}": Doc sync is taking longer than ${ACT.sync.to} min`) } continue }
    if (!seen) for (const l of lines) L(l, /CONFLICT|ERROR/.test(l) ? 'e' : '');
    if (s.conflicts?.length) throw new Error(`CONFLICT: ${s.conflicts.map(c => c.replace(/^CONFLICT /, '')).join(', ')}. Both versions kept, nothing resolved.`);
    if (s.failed) throw new Error(`sync_docs.sh failed (exit ${s.code})`);
    return `Doc sync done: ${s.written?.length || 0} files written, ${s.unresolved ?? '?'} unresolved links`;
  }
}
async function doBackup(job, L, o) {
  const p = dep.P.byId(o.proj); if (!p) throw new Error('Project not found: ' + o.proj);
  if (free().disk != null && free().disk < S.guards.disk) throw new Error('Free disk below ' + S.guards.disk + ' GB');
  L(`Copying text files of ${p.name} (no binaries, .git, node_modules, backups)`);
  const g = dep.P.backupSteps(p, () => job.stop), t0 = Date.now(); let x;
  while (!(x = g.next()).done) { if (x.value % 200 === 0) { L(`${x.value} files copied`); await sleep(0) } if (Date.now() - t0 > ACT.backup.to * MIN && !job.stop) job.stop = 'timeout' }
  const b = x.value.backup; if (x.value.res === 'cancelled') throw Object.assign(new Error(`${b.files} files copied, partial folder kept (${b.cancelled})`), { cancel: true });
  return `${b.files} files, ${(b.bytes / 1e6).toFixed(1)} MB → project-backups/${p.id}/${b.n} (nothing overwritten)`;
}
async function doHealth(job, L) {
  dep.analyze(); const f = free(), cpu = await cpuNow(), R = dep.rep() || {}, iss = (R.health || []).filter(h => !h[1]);
  const m = `CPU ${cpu}% · free RAM ${f.ram.toFixed(1)} GB · free disk ${f.disk == null ? '?' : Math.round(f.disk) + ' GB'} · ${iss.length} tracker issues`; L('Tracker re-analysis done'); L(m);
  const g = gOf(job.item); if (cpu > g.cpu || f.ram < g.ram || (f.disk != null && f.disk < g.disk) || iss.length) dep.log(`Health check: ${m}${iss.length ? ' (' + iss.map(i => i[0]).join(', ') + ')' : ''}`);
  return 'Health snapshot saved';
}
function brief(W = require('./watch.js')) {
  const s = W.status(), lw = s.limits.windows, t = (k, n) => lw[k]?.pct == null ? null : `${n} ${lw[k].pct}%${lw[k].expired ? ' (window reset since)' : lw[k].resets ? ' (resets ' + new Date(lw[k].resets).toLocaleString() + ')' : ''}`;
  const lim = [t('five_hour', '5-hour'), t('seven_day', '7-day')].filter(Boolean), need = s.sessions.filter(x => x.state === 'needs');
  return `\n**Plan limits (reported by Claude Code):** ${lim.length ? lim.join(' · ') + (lw.five_hour?.stale ? ' · over 30 min old' : '') : 'not reported yet (any Assistant answer or Sessions → Check limits)'}\n\n**Needs you now:** ${need.length ? need.map(x => `${x.name} (${x.why})`).join(', ') : 'no Claude Code session is waiting'}\n`;
}
async function doReport(job, L, o) {
  const R = dep.rep() || {}, n = o.period === 'week' ? 7 : 1, day = d => new Date(d).toISOString().slice(0, 10), since = day(Date.now() - (n - 1) * DAY);
  const days = (R.days || []).filter(d => d[0] >= since), sum = i => days.reduce((s, d) => s + (d[i] || 0), 0);
  const ses = (R.sessions || []).filter(s => { const t = Date.parse(s[2]); return t && day(t) >= since });
  let f = path.join(REP, `${day(Date.now())}-${o.period || 'day'}.md`), k = 2; while (fs.existsSync(f)) f = f.replace(/(-\d+)?\.md$/, `-${k++}.md`);
  const md = `# NEXUS usage report (${o.period === 'week' ? 'last 7 days' : 'today'})\nWritten ${new Date().toLocaleString()} by automation "${job.name}". Counts from the tracker (logged usage).\n\n| Day | Input | Output | Cache write | Cache read |\n|---|---|---|---|---|\n${days.map(d => `| ${d[0]} | ${d.slice(1, 5).map(v => (v || 0).toLocaleString()).join(' | ')} |`).join('\n') || '| (no usage) | | | | |'}\n\n**Total:** input ${sum(1).toLocaleString()} · output ${sum(2).toLocaleString()} · cache write ${sum(3).toLocaleString()} · cache read ${sum(4).toLocaleString()}\n\n**Sessions:** ${ses.length}${ses.length ? ' (' + [...new Set(ses.map(s => s[1]))].join(', ') + ')' : ''}\n`;
  fs.mkdirSync(REP, { recursive: true }); fs.writeFileSync(f, md + brief(), { flag: 'wx' }); L(`Summarised ${days.length} day(s), ${ses.length} session(s)`);
  return 'Wrote reports/' + path.basename(f) + ' (new file)';
}
const RUN = { sync: doSync, backup: doBackup, health: doHealth, report: doReport };

// ---------- schedule maths + validation (same rules as the page) ----------
function next(s, from = Date.now(), n = 5) {
  if (!s || s.type === 'demand') return [];
  if (s.type === 'interval') { const e = s.every * SM, b = s.last || s.since || from; let t = b + e; if (t <= from) t += Math.ceil((from - t + 1) / e) * e; return Array.from({ length: n }, (_, i) => t + i * e) }
  const [h, m] = (s.at || '').split(':').map(Number), ok = s.type === 'daily' ? () => true : s.type === 'weekly' ? d => d === +s.day : d => (s.days || []).includes(d), out = [];
  for (let i = 0; out.length < n && i < 400; i++) { const d = new Date(from); d.setDate(d.getDate() + i); d.setHours(h, m, 0, 0); if (+d > from && ok(d.getDay())) out.push(+d) } // local time, DST via Date
  return out;
}
const KEYS = { id: 1, name: 1, desc: 1, steps: 1, sched: 1, on: 1, notify: 1, skipMissed: 1, guards: 1, created: 1 }, SK = { type: 1, every: 1, at: 1, days: 1, day: 1, last: 1, since: 1 };
function check(a) {
  const e = []; if (!a || typeof a !== 'object' || Array.isArray(a)) return ['Not an automation object.'];
  for (const k of Object.keys(a)) if (!KEYS[k]) e.push(`Unknown field "${k}".`);
  if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 60) e.push('Name: 1-60 characters.');
  if (a.desc != null && (typeof a.desc !== 'string' || a.desc.length > 300)) e.push('Description: up to 300 characters.');
  if (!Array.isArray(a.steps) || a.steps.length < 1 || a.steps.length > 4) e.push('Steps: 1 to 4 approved actions.');
  for (const st of Array.isArray(a.steps) ? a.steps : []) { const x = ACT[st?.a]; if (!x) { e.push(`Unknown action "${st?.a}": only ${Object.keys(ACT).join(', ')} are allowed.`); continue }
    for (const k of Object.keys(st)) if (!['a', 'o', 'cont'].includes(k)) e.push(`Step field "${k}" is not allowed.`);
    for (const [k, v] of Object.entries(st.o || {})) if (!x.opts[k] || !x.opts[k](v)) e.push(`${x.t}: option ${k} = ${JSON.stringify(v)} is not allowed.`);
    for (const k of Object.keys(x.opts)) if (st.o?.[k] == null) e.push(`${x.t}: pick a ${k === 'proj' ? 'project' : k}.`);
    if (st.cont != null && typeof st.cont !== 'boolean') e.push('Continue on failure must be on or off.') }
  const s = a.sched || {}; for (const k of Object.keys(s)) if (!SK[k]) e.push(`Schedule field "${k}" is not allowed.`);
  if (!TYPES.includes(s.type)) e.push('Schedule type is not valid.');
  const min = Math.max(15, ...(Array.isArray(a.steps) ? a.steps : []).map(st => ACT[st?.a]?.min || 15));
  if (s.type === 'interval' && !(Number.isInteger(s.every) && s.every >= min && s.every <= 1440)) e.push(`Interval: ${min} min to 24 h${min > 15 ? ' (backup and report run at most hourly)' : ''}.`);
  if (/daily|weekdays|weekly/.test(s.type) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.at || '')) e.push('Time: pick a valid time (HH:MM).');
  if (s.type === 'weekdays' && !(Array.isArray(s.days) && s.days.length && s.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6))) e.push('Weekdays: pick at least one day.');
  if (s.type === 'weekly' && !(Number.isInteger(+s.day) && +s.day >= 0 && +s.day <= 6)) e.push('Weekly: pick a day.');
  if (a.notify != null && (typeof a.notify !== 'object' || Object.entries(a.notify).some(([k, v]) => !['fail', 'post', 'ok'].includes(k) || typeof v !== 'boolean'))) e.push('Notify: fail / post / ok on or off.');
  if (a.guards != null) e.push(...checkGuards(a.guards));
  return e;
}
function checkGuards(g) { const e = []; if (!g || typeof g !== 'object') return ['Guards must be an object.'];
  for (const [k, v] of Object.entries(g)) { if (k === 'claude') { if (typeof v !== 'boolean') e.push('Wait for Claude must be on or off.'); continue }
    if (!GR[k]) e.push(`Unknown guard "${k}".`); else if (typeof v !== 'number' || v < GR[k][0] || v > GR[k][1]) e.push(`${k}: ${GR[k][0]} to ${GR[k][1]}.`) } return e }
const clean = a => ({ id: a.id, name: a.name.trim(), desc: (a.desc || '').trim(), steps: a.steps.map(s => ({ a: s.a, o: { ...(s.o || {}) }, cont: !!s.cont })),
  sched: Object.fromEntries(Object.entries(a.sched).filter(([k]) => ['type', 'every', 'at', 'days', 'day'].includes(k))), on: !!a.on, notify: { fail: true, post: true, ok: false, ...(a.notify || {}) }, skipMissed: !!a.skipMissed, ...(a.guards && Object.keys(a.guards).length ? { guards: { ...a.guards } } : {}), created: a.created || Date.now() });
const gOf = a => ({ ...S.guards, ...(a?.guards || {}) });

// ---------- guards ----------
let cpuPrev = null, cpuLast = null; // system CPU % (all cores) since the previous sample
const snap = () => os.cpus().reduce((s, c) => { for (const v of Object.values(c.times)) s.t += v; s.i += c.times.idle; return s }, { t: 0, i: 0 });
function cpuSample() { const a = cpuPrev, b = snap(); cpuPrev = b; const dt = a ? b.t - a.t : 0; if (dt > 0) cpuLast = Math.round((1 - (b.i - a.i) / dt) * 100); return cpuLast }
function cpuNow() { cpuSample(); return sleep(1000).then(() => cpuSample() ?? 0) } // guard check: a fresh 1 s window
function free() { let disk = null; try { const s = fs.statfsSync(path.parse(DATA).root); disk = s.bavail * s.bsize / 1e9 } catch { } return { ram: os.freemem() / 1e9, disk } }
let busyAt = 0, busyV = null;
function claudeBusy() { // genuine activity: newest transcript written in the last 120 s, or its last record is a prompt / tool result with no end_turn after it
  if (Date.now() - busyAt < 30e3 && busyV) return busyV; busyAt = Date.now();
  let best = null; try { for (const d of fs.readdirSync(CLAUDE)) { let fl; try { fl = fs.readdirSync(path.join(CLAUDE, d)) } catch { continue }
    for (const f of fl) if (f.endsWith('.jsonl')) try { const m = fs.statSync(path.join(CLAUDE, d, f)).mtimeMs; if (!best || m > best.m) best = { f: path.join(CLAUDE, d, f), m } } catch { } } } catch { }
  if (!best) return busyV = { busy: false, why: 'No Claude transcripts found' };
  const ago = Date.now() - best.m; if (ago < BUSY_MS) return busyV = { busy: true, why: `Claude wrote its transcript ${Math.round(ago / 1000)} s ago`, at: best.m };
  let open = false; try { const fd = fs.openSync(best.f, 'r'), sz = fs.fstatSync(fd).size, n = Math.min(4096, sz), b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, sz - n); fs.closeSync(fd);
    const last = b.toString('utf8').trim().split('\n').pop(); const j = JSON.parse(last); open = j.type === 'user' && ago < 30 * MIN } catch { }
  return busyV = open ? { busy: true, why: 'A Claude turn is in progress (waiting on a prompt or tool result)', at: best.m } : { busy: false, why: `Last Claude activity ${Math.round(ago / 1000)} s ago`, at: best.m };
}
async function blocked(a) { const g = gOf(a), f = free(), cpu = await cpuNow(), c = g.claude ? claudeBusy() : { busy: false };
  if (f.disk != null && f.disk < g.disk) return { hard: true, why: `Free disk ${f.disk.toFixed(1)} GB is below ${g.disk} GB` };
  if (c.busy) return { why: 'Claude busy: ' + c.why }; if (cpu > g.cpu) return { why: `CPU ${cpu}% is above ${g.cpu}%` }; if (f.ram < g.ram) return { why: `Free RAM ${f.ram.toFixed(1)} GB is below ${g.ram} GB` };
  return null }

// ---------- worker + scheduler ----------
const Q = []; let cur = null, timer = null, started = Date.now();
const runRec = (a, trig, extra = {}) => ({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), a: a.id, name: a.name, at: Date.now(), trig, res: 'running', ms: 0, why: '', log: [], ...extra });
function note(a, kind, msg) { const n = a.notify || {}; if ((kind === 'fail' && n.fail !== false) || (kind === 'post' && n.post !== false) || (kind === 'ok' && n.ok)) dep.log(`Automation "${a.name}": ${msg}`) }
function enqueue(a, trig, tries = 0) { if (cur?.item.id === a.id || Q.some(j => j.item.id === a.id)) return false; Q.push({ item: a, trig, tries }); pump(); return true }
async function pump() {
  if (cur || !Q.length) return; const j = Q.shift(), a = S.items.find(x => x.id === j.item.id); if (!a) return pump();
  cur = { item: a, name: a.name, trig: j.trig, stop: null };
  const b = await blocked(a);
  if (b) { const g = gOf(a), r = runRec(a, j.trig, { ms: 0 });
    if (b.hard || j.tries >= g.max) { r.res = 'skipped'; r.why = b.hard ? b.why + '. Refused.' : `Busy ${j.tries + 1} times (${b.why}). Skipped until the next run.`; note(a, 'post', 'skipped: ' + r.why) }
    else { r.res = 'postponed'; r.why = `${b.why}. Retry in ${g.wait} min (${j.tries + 1} of ${g.max}).`; note(a, 'post', 'postponed: ' + b.why); setTimeout(() => enqueue(a, j.trig, j.tries + 1), g.wait * SM) }
    r.log = [[Date.now(), r.why, 'w']]; RUNS.unshift(r); saveR(); cur = null; return pump() }
  const r = runRec(a, j.trig), L = (l, c = '') => { r.log.push([Date.now(), RED(String(l)).slice(0, 500), c]); if (r.log.length > LINES) r.log.splice(0, r.log.length - LINES) };
  cur.run = r; RUNS.unshift(r); saveR(); const t0 = Date.now(); let failed = null; // B58: on disk before step 1
  for (const [i, st] of a.steps.entries()) {
    if (cur.stop) { r.res = 'cancelled'; L('Cancelled before step ' + (i + 1), 'w'); break }
    const x = ACT[st.a]; L(`Step ${i + 1}: ${x.t}  (${x.cmd(st.o)})`); cur.step = r.step = i; saveR(); // B58: journal: which step was started
    let to; const timeout = x.cancel ? new Promise((_, no) => { to = setTimeout(() => { cur.stop = 'timeout'; no(new Error(`Timed out after ${x.to} min`)) }, x.to * MIN + (st.a === 'backup' ? 5e3 : 0)) }) : null;
    try { const m = await (timeout ? Promise.race([RUN[st.a](cur, L, st.o), timeout]) : RUN[st.a](cur, L, st.o)); L(m, 'ok') }
    catch (e) { L(`Step ${i + 1} ${x.t} ${e.cancel ? 'cancelled' : 'failed'}: ${RED(e.message)}`, 'e'); if (e.cancel && cur.stop !== 'timeout') { r.res = 'cancelled'; r.why = `Step ${i + 1} ${x.t}: ${RED(e.message)}`; break }
      failed ??= `Step ${i + 1} ${x.t}: ${RED(e.message)}`; if (!st.cont) { if (i < a.steps.length - 1) L('Stopped: later steps skipped.', 'e'); break } if (cur.stop === 'timeout') cur.stop = null }
    finally { clearTimeout(to) }
  }
  r.ms = Date.now() - t0; if (r.res === 'running') { r.res = failed ? 'failed' : 'success'; r.why = failed || '' }
  if (r.res === 'success') L(`All steps completed in ${Math.round(r.ms / 1000)} s.`, 'ok');
  note(a, r.res === 'failed' ? 'fail' : r.res === 'success' ? 'ok' : 'post', r.res === 'success' ? 'completed' : `${r.res}: ${r.why}`);
  if (a.sched.type === 'interval') { a.sched.last = r.at; saveS() } saveR(); cur = null; plan(); pump();
}
function lastRun(a) { return RUNS.find(r => r.a === a.id && r.res !== 'postponed')?.at || 0 }
function plan() { // one timer to the next due time
  clearTimeout(timer); if (S.paused) return; const now = Date.now();
  const due = S.items.filter(a => a.on && a.sched.type !== 'demand').map(a => [a, next(a.sched, now, 1)[0]]).filter(x => x[1]).sort((x, y) => x[1] - y[1]);
  if (!due.length) return; const t = due[0][1];
  timer = setTimeout(() => { const n2 = Date.now(); for (const [a, at] of due) if (at <= n2 + 1000) enqueue(a, 'schedule'); plan() }, Math.min(Math.max(0, t - now), 2 ** 31 - 1));
}
function catchUp() { // missed while the tracker was off: one catch-up run per automation, 2 min after start
  const now = Date.now(); for (const a of S.items) { if (!a.on || a.sched.type === 'demand' || a.skipMissed) continue;
    const since = Math.max(lastRun(a), a.enabledAt || a.created || 0); if (!since) continue; const due = next(a.sched, since, 1)[0];
    if (due && due < now - SM) setTimeout(() => { const r = runRec(a, 'catch-up', { res: 'missed', why: `Tracker was off at ${new Date(due).toLocaleString()}. Caught up now.`, at: due }); r.log = [[due, r.why, 'w']]; RUNS.unshift(r); saveR(); note(a, 'post', 'missed run, catching up'); enqueue(a, 'catch-up') }, 2 * SM) }
}

// ---------- API ----------
function status() { load(); const now = Date.now();
  return { at: now, paused: S.paused, guards: S.guards, ranges: GR, actions: Object.fromEntries(Object.entries(ACT).map(([k, x]) => [k, { t: x.t, to: x.to, min: x.min, cancel: x.cancel }])),
    items: S.items.map(a => ({ ...a, next: a.on && !S.paused ? next(a.sched, now) : next(a.sched, now), cmds: a.steps.map(s => ACT[s.a].cmd(s.o)) })),
    queue: Q.map(j => j.item.id), running: cur ? { id: cur.item.id, run: cur.run?.id, step: cur.step, at: cur.run?.at, log: cur.run?.log.slice(-40) } : null,
    busy: busyV, free: free(), cpu: cpuSample(), started, runs: RUNS.map(({ log, ...r }) => r), total: RUNS.length };
}
function runs(q = {}) { load(); const L = RUNS.filter(r => (!q.id || r.a === q.id) && (!q.result || r.res === q.result)); return { total: L.length, runs: L.slice(0, Math.min(+q.limit || 100, KEEP)) } }
function exportJ(id) { load(); const items = (id && id !== 'all' ? S.items.filter(a => a.id === id) : S.items).map(({ id, name, desc, steps, sched, notify, skipMissed, guards }) => ({ id, name, desc, steps, sched: { type: sched.type, every: sched.every, at: sched.at, days: sched.days, day: sched.day }, notify, skipMissed, ...(guards ? { guards } : {}) }));
  return { nexus: 'automations', v: 1, at: Date.now(), items: JSON.parse(RED(JSON.stringify(items))) } }
const nid = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function post(b) { load();
  if (!b || b.confirm !== true) return { res: 'Confirm first: every change needs confirm:true from the confirm dialog.' };
  const a = b.id ? S.items.find(x => x.id === b.id) : null, done = (o = {}) => (saveS(), plan(), { res: 'ok', ...o });
  if (b.op === 'save') { const it = b.item, e = check(it); if (e.length) return { res: 'Rejected: ' + e.join(' '), errors: e };
    const old = S.items.find(x => x.id === it.id);
    if (old) { const n = clean({ ...it, on: old.on, created: old.created }); if (old.sched.type === n.sched.type && n.sched.type === 'interval' && old.sched.every === n.sched.every) n.sched.last = old.sched.last; if (old.enabledAt) n.enabledAt = old.enabledAt; Object.assign(old, n); for (const k of Object.keys(old)) if (!(k in n) && k !== 'enabledAt') delete old[k]; return done({ id: old.id }) }
    const n = clean({ ...it, id: nid(), on: false, created: Date.now() }); S.items.push(n); return done({ id: n.id }) } // new = disabled
  if (b.op === 'pause') { S.paused = !!b.paused; dep.log(`Automation scheduler ${S.paused ? 'paused' : 'resumed'}`); return done() }
  if (b.op === 'guards') { const e = checkGuards(b.g || {}); if (e.length) return { res: 'Rejected: ' + e.join(' ') };
    for (const [id, g] of Object.entries(b.over || {})) { const x = S.items.find(i => i.id === id); if (!x) return { res: 'Unknown automation ' + id }; const e2 = checkGuards(g || {}); if (e2.length) return { res: 'Rejected: ' + e2.join(' ') } }
    S.guards = { ...S.guards, ...b.g }; for (const [id, g] of Object.entries(b.over || {})) { const x = S.items.find(i => i.id === id); if (g && Object.keys(g).length) x.guards = { ...g }; else delete x.guards } return done() }
  if (b.op === 'import') { const items = Array.isArray(b.items) ? b.items.slice(0, 50) : null; if (!items) return { res: 'Not a NEXUS automations file.' };
    const out = []; for (const it of items) { const e = check({ ...it, on: false }); if (e.length) { out.push({ name: it?.name, res: 'rejected', errors: e }); continue }
      const ex = S.items.find(x => x.id === it.id), mode = b.replace?.includes(it.id) && b.confirmReplace === true && ex ? 'replace' : 'copy';
      if (mode === 'replace') { const n = clean({ ...it, id: ex.id, on: false, created: ex.created }); Object.assign(ex, n); delete ex.enabledAt; out.push({ name: n.name, res: 'replaced (disabled)' }) }
      else { const n = clean({ ...it, id: nid(), name: ex || S.items.some(x => x.name === it.name) ? (it.name + ' (imported)').slice(0, 60) : it.name, on: false, created: Date.now() }); S.items.push(n); out.push({ name: n.name, res: 'imported (disabled)' }) } }
    return done({ imported: out }) }
  if (!a) return { res: 'Unknown automation.' };
  if (b.op === 'toggle') { const on = !!b.on; if (on && check(a).length) return { res: 'Fix it first: ' + check(a).join(' ') }; a.on = on; if (on) { a.enabledAt = Date.now(); if (a.sched.type === 'interval') a.sched.since = Date.now() } dep.log(`Automation "${a.name}" ${on ? 'enabled' : 'disabled'}`); return done() }
  if (b.op === 'delete') { S.items = S.items.filter(x => x !== a); Q.splice(0, Q.length, ...Q.filter(j => j.item.id !== a.id)); for (const r of RUNS) if (r.a === a.id) r.deleted = true; saveR(); dep.log(`Automation "${a.name}" deleted (history kept)`);
    const o = done(); try { fs.copyFileSync(AF, AF + '.bak') } catch { } return o } // B59 .bak: a deleted automation leaves no copy behind
  if (b.op === 'run') return enqueue(a, 'manual') ? { res: 'ok', queued: Q.length, running: cur?.item.id === a.id } : { res: `"${a.name}" is already queued or running.` };
  if (b.op === 'cancel') { const qi = Q.findIndex(j => j.item.id === a.id); if (qi >= 0) { Q.splice(qi, 1); return { res: 'ok', removed: true } }
    if (cur?.item.id !== a.id) return { res: 'Nothing is running for this automation.' };
    const st = a.steps[cur.step]; if (st && !ACT[st.a].cancel) { cur.stop = 'cancelled by you'; return { res: 'ok', note: 'Doc sync can\'t be cancelled once started: it finishes, then the remaining steps are skipped.' } }
    cur.stop = 'cancelled by you'; return { res: 'ok' } }
  return { res: 'Unknown operation.' };
}
function init(d) { dep = d; load(); started = Date.now(); let ch = false;
  for (const r of RUNS) if (r.res === 'running') { // B58: outcome unknown → 'interrupted', never re-run automatically (lastRun counts it, so catch-up skips it)
    const a = S.items.find(x => x.id === r.a), st = a?.steps[r.step], n = r.step == null ? null : r.step + 1;
    r.res = 'interrupted'; r.why = `Tracker stopped during ${n ? `step ${n}${st ? ' (' + ACT[st.a]?.t + ')' : ''}` : 'the run'}; outcome unknown, not retried. Check the result, then run it again by hand if needed.`;
    r.log.push([Date.now(), r.why, 'e']); dep.log(`Automation "${r.name}": interrupted. ${r.why}`); ch = true }
  for (const m of BAD.splice(0)) dep.log('Automation data: ' + m);
  if (ch) saveR(); catchUp(); plan() }
function stop() { clearTimeout(timer) }
module.exports = { init, stop, status, runs, exportJ, post, _: { next, check, brief, checkGuards, clean, claudeBusy, blocked, enqueue, get cur() { return cur }, get Q() { return Q }, get S() { return S }, get RUNS() { return RUNS }, reset() { S = null; RUNS = null; Q.length = 0; cur = null; busyV = null; busyAt = 0; clearTimeout(timer) } } };
