// Self-check for auto.js: validation, schedule maths, guards, busy detection, worker, cancel, import, history. Throwaway NEXUS_DATA and
// fake Claude transcripts in temp; fake doc sync / backup (spawns nothing, copies nothing). Cleans up.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'au-')); process.env.NEXUS_DATA = path.join(T, 'data'); process.env.NEXUS_CLAUDE_PROJECTS = path.join(T, 'cp');
const A = require('./auto.js'), { next, check, brief } = A._, sleep = ms => new Promise(f => setTimeout(f, ms)), logs = [];
let syncS = null, gen = 0;
const P = { byId: id => id === 'p1' ? { id: 'p1', name: 'Proj', dir: T } : null,
  *backupSteps(p, why) { let n = 0, stop = null; while (n < 1e7 && !stop) { n++; gen = n; yield n; stop = why() } return { res: stop ? 'cancelled' : 'ok', backup: { n: 'stamp', files: n, bytes: n * 10, ...(stop ? { cancelled: stop + ' (partial)' } : {}) } } } };
const K = { sync: () => ({ res: 'ok' }), syncState: () => syncS };
const base = (o = {}) => ({ name: 'T', steps: [{ a: 'health', o: {} }], sched: { type: 'demand' }, ...o });
(async () => { try {
  A.init({ log: m => logs.push(m), analyze: () => { }, rep: () => ({ days: [[new Date().toISOString().slice(0, 10), 1, 2, 3, 4]], sessions: [], health: [['Tracking', true]] }), K, P });
  const ok = o => { const r = A.post({ confirm: true, ...o }); assert.strictEqual(r.res, 'ok', JSON.stringify(r)); return r };
  // validation + refusals
  assert.deepStrictEqual(check(base()), []); assert(check(base({ steps: [{ a: 'shell', o: {} }] }))[0].includes('Unknown action'));
  assert(check(base({ evil: 1 })).some(e => e.includes('evil'))); assert(check(base({ sched: { type: 'interval', every: 5 } })).some(e => e.includes('Interval')));
  assert(check(base({ steps: [{ a: 'backup', o: { proj: 'nope' } }] })).some(e => e.includes('proj'))); assert(check(base({ name: 'x'.repeat(61) })).length);
  assert(check(base({ steps: [{ a: 'report', o: { period: 'day' } }], sched: { type: 'interval', every: 30 } })).some(e => e.includes('hourly')));
  assert(check(base({ sched: { type: 'weekdays', at: '09:00', days: [] } })).length); assert(check(base({ sched: { type: 'daily', at: '25:00' } })).length);
  assert.match(A.post({ op: 'save', item: base() }).res, /Confirm/);
  // schedule maths (local time): daily, weekdays, weekly, interval
  const from = new Date(2026, 2, 27, 12, 0).getTime(); // Fri 27 Mar 2026, DST changes on the 29th in Europe
  const d = next({ type: 'daily', at: '09:30' }, from, 3).map(t => new Date(t)); assert.deepStrictEqual(d.map(x => [x.getDate(), x.getHours(), x.getMinutes()]), [[28, 9, 30], [29, 9, 30], [30, 9, 30]]);
  assert.deepStrictEqual(next({ type: 'weekdays', at: '08:00', days: [1, 3] }, from, 2).map(t => new Date(t).getDay()), [1, 3]);
  assert.strictEqual(new Date(next({ type: 'weekly', at: '07:00', day: 0 }, from, 1)[0]).getDate(), 29);
  assert.deepStrictEqual(next({ type: 'interval', every: 60, since: from - 90 * 6e4 }, from, 2), [from + 30 * 6e4, from + 90 * 6e4]); assert.deepStrictEqual(next({ type: 'demand' }), []);
  // save = disabled, edit keeps on/off, toggle, delete keeps history
  const id = ok({ op: 'save', item: base({ on: true }) }).id; assert.strictEqual(A._.S.items[0].on, false, 'new starts disabled');
  ok({ op: 'guards', g: { cpu: 100, ram: 0.5, disk: 1, claude: false } }); assert.match(A.post({ confirm: true, op: 'guards', g: { cpu: 5 } }).res, /Rejected/);
  // worker: one run, no duplicate queueing
  ok({ op: 'run', id }); assert.match(A.post({ confirm: true, op: 'run', id }).res, /already/); await sleep(2500);
  let r = A.runs({ id }).runs[0]; assert.strictEqual(r.res, 'success', JSON.stringify(r)); assert(r.log.some(l => l[1].includes('CPU')));
  // guards: low RAM postpones, max postpones skips, low disk refuses
  const fm = os.freemem; os.freemem = () => 1e8; ok({ op: 'guards', g: { ram: 1 } });
  ok({ op: 'run', id }); await sleep(2300); r = A.runs({ id }).runs[0]; assert.strictEqual(r.res, 'postponed'); assert.match(r.why, /RAM.*Retry in 5 min \(1 of 3\)/);
  A._.enqueue(A._.S.items[0], 'schedule', 3); await sleep(2300); r = A.runs({ id }).runs[0]; assert.strictEqual(r.res, 'skipped'); assert.match(r.why, /Skipped/);
  os.freemem = fm; ok({ op: 'guards', g: { ram: 0.5 } });
  // doc sync conflict = failed step, never resolved
  syncS = { running: false, lines: ['CONFLICT PROJECT_DOCS.md'], conflicts: ['CONFLICT PROJECT_DOCS.md'], code: 1, failed: false };
  const sid = ok({ op: 'save', item: base({ name: 'S', steps: [{ a: 'sync', o: {} }, { a: 'health', o: {} }] }) }).id; ok({ op: "run", id: sid }); await sleep(4000);
  r = A.runs({ id: sid }).runs[0]; assert.strictEqual(r.res, 'failed'); assert.match(r.why, /CONFLICT/); assert(r.log.some(l => l[1].includes('later steps skipped')));
  // backup cancel keeps partial folder, marked cancelled
  const bid = ok({ op: 'save', item: base({ name: 'B', steps: [{ a: 'backup', o: { proj: 'p1' } }] }) }).id; ok({ op: "run", id: bid }); await sleep(1300);
  ok({ op: 'cancel', id: bid }); await sleep(300); r = A.runs({ id: bid }).runs[0]; assert.strictEqual(r.res, 'cancelled', JSON.stringify(r)); assert(gen < 1e7);
  // busy detection: fresh transcript, open turn, finished turn
  const cp = path.join(T, 'cp', 'x'), f = path.join(cp, 's.jsonl'); fs.mkdirSync(cp, { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ type: 'user' }) + '\n'); assert(A._.claudeBusy().busy, 'fresh = busy');
  const old = (Date.now() - 600e3) / 1000; fs.utimesSync(f, old, old); A._.reset(); A.status(); assert(A._.claudeBusy().busy, 'open turn = busy');
  fs.writeFileSync(f, JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn' } }) + '\n'); fs.utimesSync(f, old, old); A._.reset(); A.status(); assert(!A._.claudeBusy().busy, 'finished = idle');
  // import: rejects unknown action / bad schedule, imports disabled copies; export round-trip
  const ex = A.exportJ('all'); assert.strictEqual(ex.items.length, 3);
  const im = ok({ op: 'import', items: [...ex.items, base({ steps: [{ a: 'rm', o: {} }] }), base({ sched: { type: 'hourly' } })] }).imported;
  assert.strictEqual(im.filter(x => x.res === 'rejected').length, 2); assert(A._.S.items.every(x => !x.on)); assert(A._.S.items.some(x => x.name === 'T (imported)'));
  ok({ op: 'toggle', id, on: true }); assert(A.status().items.find(x => x.id === id).on); ok({ op: 'delete', id });
  assert(A.runs({ id }).runs.every(x => x.deleted), 'history kept, marked deleted'); assert(!A.status().items.some(x => x.id === id));
  // history persisted + trimmed
  const saved = JSON.parse(fs.readFileSync(path.join(T, 'data', 'auto-runs.json'))); assert(saved.length >= 5 && saved.length <= 500);
  assert.match(A.post({ confirm: true, op: 'nope', id: sid }).res, /Unknown operation/);
  { const fw = { status: () => ({ sessions: [{ state: 'needs', name: 'App', why: 'permission to run Bash' }, { state: 'idle', name: 'B' }], limits: { windows: { five_hour: { pct: 76, resets: 1 }, seven_day: { pct: null } } } }) }, b = brief(fw), b0 = brief({ status: () => ({ sessions: [], limits: { windows: {} } }) });
    assert(/5-hour 76%/.test(b) && !/7-day/.test(b) && b.includes('App (permission to run Bash)') && !b.includes('B ('), 'daily brief: limits + needs-you'); assert(/not reported yet/.test(b0) && /no Claude Code session is waiting/.test(b0), 'daily brief: empty') }
  console.log('test-auto: all passed');
} catch (e) { console.error(e); process.exitCode = 1 } finally { A.stop(); fs.rmSync(T, { recursive: true, force: true }); process.exit() } })();
