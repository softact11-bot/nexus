// System Health sampler tests (sys.js + /api/sys). Isolated NEXUS_DATA; the real tracker is only read (plus refused / invalid POSTs).
// Run: node test-sys.js   (~2 min: real typeperf + nvidia-smi readings, process sampler start / idle stop, restart recovery)
const A = require('./test-auth.js'); // M4b launch token + port
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), http = require('http');
const D = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sys-'));
process.env.NEXUS_DATA = D; process.env.NEXUS_SYS_FLUSH = '2000'; process.env.NEXUS_SYS_NOREVEAL = '1';
const HF = path.join(D, 'sys-history.ndjson'), AF = path.join(D, 'sys-alerts.json');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m) } else { fail++; console.log('FAIL', m) } };
const sleep = ms => new Promise(f => setTimeout(f, ms)), MIN = 6e4;
const st = Y => new Promise(f => Y.status(f)), post = (Y, o) => new Promise(f => Y.post(o, f));
const get = (p, o = {}) => new Promise(f => { const q = http.request({ host: '127.0.0.1', port: A.PORT, path: p, method: o.method || 'GET', headers: { ...A.H, ...o.headers } }, r => { let b = ''; r.on('data', c => b += c).on('end', () => f({ code: r.statusCode, b })) }); q.on('error', e => f({ code: 0, b: e.message })); if (o.body) q.write(o.body); q.end() });
const smi = () => { try { return cp.execFileSync('nvidia-smi', ['--query-gpu=temperature.gpu,memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).split(',').map(Number) } catch { return null } };

(async () => {
  // ---- 1. restart recovery: a first "tracker" (child process) samples, then exits; old + broken lines in the file are handled ----
  const old = Date.now() - 25 * 36e5; fs.writeFileSync(HF, JSON.stringify([old, 50, 50, 1, 0, 0, null, null, null, null]) + '\nnot json\n');
  const kid = cp.spawn(process.execPath, ['-e', `const Y=require(${JSON.stringify(path.join(__dirname, 'sys.js'))});Y.init({});setTimeout(()=>{Y.stop();process.exit(0)},20000)`], { env: process.env, stdio: 'ignore' });
  await new Promise(f => kid.on('exit', f));
  const first = fs.readFileSync(HF, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean);
  ok(first.length >= 2 && first.every(r => r[0] > old), `first run wrote ${first.length} readings to sys-history.ndjson; >24 h row + broken line dropped`);

  const Y = require('./sys.js'), tasks = cb => cb([['Claude Code', 1e9], ['Obsidian', 0]]);
  let syncS = null, repE = null;
  Y.init({ rep: () => repE ? { error: repE } : {}, tasks, K: { syncState: () => syncS }, A: { status: () => ({ paused: false, items: [], runs: [] }) }, resp: __filename, graph: __filename });
  ok(Y.hist().rows.length === first.length && Y.hist().rows[0][0] === first[0][0], 'restart: history reloaded from disk (' + first.length + ' readings, same first timestamp)');
  const gapT = first.at(-1)[0];

  // ---- 2. live readings vs independent sources ----
  await sleep(12000); const s = await st(Y), L = s.live, smiNow = smi();
  ok(L && Date.now() - L.t < 8000, 'live reading is fresh (' + (L ? Math.round((Date.now() - L.t) / 1e3) + ' s old' : 'none') + ')');
  ok(L && L.cpu >= 0 && L.cpu <= 100 && L.disk >= 0 && L.disk <= 100, `CPU ${L?.cpu} %, disk activity ${L?.disk} % in range`);
  const ramNow = (os.totalmem() - os.freemem()) / os.totalmem() * 100; ok(L && Math.abs(L.ram - ramNow) < 3, `RAM ${L?.ram} % vs os ${ramNow.toFixed(1)} %`);
  ok(L && L.rx >= 0 && L.tx >= 0 && s.net?.name && s.net.link > 0, `network ${L?.rx} / ${L?.tx} B/s on "${s.net?.name}" (${s.net?.link / 1e6} Mbps)`);
  const sf = fs.statfsSync('C:\\'), c = s.disks.find(x => x[0] === 'C:'); ok(c && Math.abs(c[1] - sf.blocks * sf.bsize) < 1e6 && Math.abs(c[2] - (sf.blocks - sf.bfree) * sf.bsize) < 5e8, `C: ${(c?.[2] / 1e9).toFixed(1)} / ${(c?.[1] / 1e9).toFixed(1)} GB matches statfs; drives: ${s.disks.map(x => x[0]).join(' ')}`);
  if (smiNow) { ok(s.gpu?.name && Math.abs(s.gpu.temp - smiNow[0]) <= 4 && Math.abs(s.gpu.mu - smiNow[1]) < 600, `GPU "${s.gpu?.name}" ${s.gpu?.temp} °C / ${s.gpu?.mu} MB vs nvidia-smi ${smiNow[0]} °C / ${smiNow[1]} MB`);
    ok(s.gpu.pw === null || s.gpu.pw > 0, 'power draw shown only when the driver reports it (' + s.gpu.pw + ')'); }
  else ok(s.gpu === null && s.err.gpu, 'no nvidia-smi: GPU hidden with reason');
  ok(s.err.tp === null, 'typeperf running without errors');
  const rows = Y.hist(gapT).rows; ok(rows.length >= 1 && rows[0][0] - gapT > 5000, `new readings after the restart (${rows.length}); the gap is kept, never filled`);
  await sleep(2500); ok(fs.readFileSync(HF, 'utf8').trim().split('\n').length >= first.length + rows.length, 'new readings flushed to disk');

  // ---- 3. process sampler: on demand only, grouped, stops when not asked ----
  ok(!Y._state().pr, 'process sampler off until the page asks');
  let p = Y.procs(); ok(p.warming, 'first /procs call: warming');
  await sleep(17000); p = Y.procs();
  const me = p.list.find(x => x[4].includes(process.pid));
  ok(p.list.length > 20 && !p.list.some(x => /#\d+/.test(x[0]) || /^(idle|_total)/i.test(x[0])), `${p.list.length} programs, grouped (no #n instances, no Idle/_Total)`);
  ok(me && me[0] === 'node.exe' && me[3] === 'nexus', 'this process found as node.exe, category nexus');
  const tot = p.list.reduce((a, x) => a + x[1], 0); ok(p.list.every(x => x[1] >= 0 && x[1] <= 100 && x[2] >= 0) && tot <= 105, `CPU per program 0-100 % of the whole CPU, total ${tot.toFixed(1)} % ≤ 100 % (top: ${p.list.slice(0, 2).map(x => x[0] + ' ' + x[1]).join(', ')})`);
  ok(p.list.some(x => x[3] === 'bg'), 'Windows background helpers categorised');
  const s2 = await st(Y); ok(s2.foot.sampler != null && s2.foot.sampler < 3, `sampler cost (typeperf + nvidia-smi) ${s2.foot.sampler} % of the CPU`);
  // performance: tracker-side CPU while sampling
  const c0 = process.cpuUsage(), t0 = Date.now(); await sleep(10000); const cu = process.cpuUsage(c0), pct = (cu.user + cu.system) / 1e3 / (Date.now() - t0) * 100 / os.cpus().length;
  p = Y.procs(); const tpC = p.list.filter(x => /^typeperf\.exe$/i.test(x[0])).reduce((a, x) => a + x[1], 0);
  ok(pct < 1, `node sampling cost ${pct.toFixed(2)} % of the CPU over 10 s (process list on)`); ok(tpC < 3, `typeperf processes ${tpC.toFixed(1)} % of the CPU`);
  ok(process.memoryUsage().rss < 200e6, `memory ${Math.round(process.memoryUsage().rss / 1e6)} MB`);
  await sleep(36000); ok(!Y._state().pr, 'process sampler stopped by itself 30 s after the last request');

  // ---- 4. reveal: only PIDs from the current list ----
  ok((await post(Y, { op: 'reveal', pid: 999999 })).res === 'unknown process', 'reveal refuses an unknown PID');
  Y.procs(); await sleep(17000); const rv = await post(Y, { op: 'reveal', pid: process.pid }); ok(rv.res === 'ok' && /node\.exe$/i.test(rv.path), 'reveal resolves node.exe path (' + rv.path + '; Explorer not opened in tests)');
  ok((await post(Y, { op: 'reveal', pid: 4 })).res !== 'ok', 'reveal refuses System (PID 4)');

  // ---- 5. alerts: sustain, no duplicates, recovery, cooldown, persistence ----
  const raised = []; Y._hook(a => raised.push(a)); const T = Date.now() + 36e5, snap = (t, o) => Y._check({ t, cpu: 10, ramFree: 8, gtemp: 50, disks: [['C:', 1e12, 5e11], ['Z:', 1e11, 0.95e11]], ...o });
  for (let i = 0; i <= 12; i++) snap(T + i * 5000, { cpu: 95 }); ok(!raised.some(a => a.k === 'cpu'), 'CPU 95 % for 1 min: no alert');
  for (let i = 13; i <= 30; i++) snap(T + i * 5000, { cpu: 95 + (i === 20 ? 4 : 0) }); const ca = raised.filter(a => a.k === 'cpu');
  ok(ca.length === 1 && ca[0].v === 99 && /peak 99/.test(ca[0].what), 'CPU over 90 % for 2 min: exactly one alert, peak recorded');
  ok(raised.filter(a => a.k === 'diskZ:').length === 1 && !raised.some(a => a.k === 'diskC:'), 'drive Z: (5 GB free) alerts, C: (500 GB free) does not');
  snap(T + 31 * 5000, {}); const rec = Y._state().AL.find(a => a.k === 'cpu'); ok(rec.rec === T + 31 * 5000, 'CPU back to normal: alert marked recovered');
  for (let i = 32; i <= 70; i++) snap(T + i * 5000, { cpu: 96 }); ok(raised.filter(a => a.k === 'cpu').length === 1, 'again within the 15 min cooldown: no new alert');
  for (let i = 0; i <= 25; i++) snap(T + 16 * MIN + i * 5000, { cpu: 96 }); ok(raised.filter(a => a.k === 'cpu').length === 2, 'after the cooldown: new alert');
  for (let i = 0; i <= 25; i++) snap(T + 40 * MIN + i * 5000, { ramFree: 1.1, gtemp: 86 }); ok(raised.some(a => a.k === 'ram') && raised.some(a => a.k === 'gtemp'), 'low RAM (1.1 GB) and hot GPU (86 °C) alert after 2 min');
  ok(JSON.parse(fs.readFileSync(AF, 'utf8')).length === Y._state().AL.length, 'alerts saved to sys-alerts.json');
  ok(Y.bell().length > 0 && Y.bell().every(b => b.txt && b.t && ['ok', 'warn', 'err'].includes(b.c)), 'bell feed: ' + Y.bell().length + ' items');

  // ---- 6. services ----
  let v = (await st(Y)).services; ok(v.tracker[0] === 'run' && v.sync[0] === 'idle' && v.cc[0] === 'run' && v.obs[1] === 'Closed', 'services: tracker run, sync Ready, Claude Code running, Obsidian closed');
  syncS = { running: false, code: 1, at: Date.now(), conflicts: ['CONFLICT PROJECT_DOCS.md'], lines: [] }; repE = 'boom';
  Y._svc(); v = (await st(Y)).services; ok(v.sync[1] === 'Conflict' && v.hook[0] === 'att', 'sync CONFLICT and usage-tracking error shown');
  ok(raised.some(a => a.k === 'svc-sync' && a.lvl === 'err') && raised.some(a => a.k === 'svc-hook'), 'service failures alert right away');
  syncS = { running: false, code: 0, at: Date.now(), conflicts: [], written: [1], unresolved: 0, lines: [] }; repE = null; Y._svc();
  ok(Y._state().AL.find(a => a.k === 'svc-sync').rec, 'service recovered: alert marked recovered');
  ok((await post(Y, { op: 'check', id: 'sync' })).svc.sync[1] === 'OK', 'Check Again re-reads the status');

  // ---- 7. limits ----
  ok((await post(Y, { op: 'limits', l: { cpu: 80 } })).res === 'confirm required', 'limits need confirm:true');
  ok(/must be/.test((await post(Y, { op: 'limits', l: { ...Y._state().L, cpu: 20 }, confirm: true })).res), 'out-of-range limit refused');
  ok((await post(Y, { op: 'limits', l: { ...Y._state().L, cpu: 80 }, confirm: true })).res === 'ok' && JSON.parse(fs.readFileSync(path.join(D, 'sys-limits.json'), 'utf8')).cpu === 80, 'limits saved to sys-limits.json');
  ok((await post(Y, { op: 'nope' })).res === 'unknown op', 'unknown op refused');

  // ---- 7b. pause / resume (M4d): only the hardware readers stop; history keeps a gap; survives a restart ----
  Y.procs(); await sleep(6000); const kids = Y._state().kids, alive = p => { try { process.kill(p, 0); return true } catch { return false } };
  ok(kids.length === 2, 'before pause: typeperf + process sampler running (' + kids.length + ')');
  Y._check({ t: Date.now(), cpu: 95, ramFree: 8, gtemp: 50, disks: [] }); ok('cpu' in Y._state().since, 'a sustained-limit count is open before the pause');
  const pz = await post(Y, { op: 'pause' }); ok(pz.res === 'ok' && pz.paused > 0, 'pause op ok');
  ok((await post(Y, { op: 'pause' })).paused === pz.paused, 'pause twice: same pause, no new gap');
  await sleep(1500); ok(!Y._state().tp && !Y._state().pr && kids.every(p => !alive(p)), 'paused: typeperf processes ended (' + kids.join(', ') + ' gone)');
  ok(!('cpu' in Y._state().since), 'paused: open sustained-limit counts cleared (an alert never spans the pause)');
  const pS = await st(Y); ok(pS.paused === pz.paused && pS.live === null && pS.disks.length === 0 && pS.services.tracker[0] === 'run', 'status: paused, no live reading, no drives, services still checked');
  const pp = Y.procs(); ok(pp.paused && !pp.list.length && !Y._state().pr, '/procs while paused: no process sampler started');
  ok(Y.bell()[0].c === 'warn' && /paused/.test(Y.bell()[0].txt), 'bell feed: paused note first');
  ok(JSON.parse(fs.readFileSync(path.join(D, 'sys-paused.json'), 'utf8')).at === pz.paused, 'pause saved to sys-paused.json');
  const nH = Y.hist().rows.length; await sleep(12000); ok(Y.hist().rows.length === nH && !Y._state().tp, 'paused 12 s: no new history rows, typeperf not restarted');
  Y.stop();
  // restart #2: alerts + limits survive, still paused
  delete require.cache[require.resolve('./sys.js')]; const Y2 = require('./sys.js'); Y2.init({ sampler: false });
  ok(Y2._state().AL.length === raised.length && Y2._state().L.cpu === 80, 'restart: alerts (' + raised.length + ') and limits reloaded');
  ok(Y2._state().P.at === pz.paused, 'restart: still paused'); Y2.stop();
  // restart #3 with the full sampler: stays paused, resume restarts it, the gap is kept
  delete require.cache[require.resolve('./sys.js')]; const Y3 = require('./sys.js'); Y3.init({});
  await sleep(6000); ok(!Y3._state().tp && Y3.hist(pz.paused).rows.length === 0, 'restart with sampler: stays paused, no readings');
  const rz = await post(Y3, { op: 'resume' }); ok(rz.res === 'ok' && rz.paused === null && Y3._state().tp, 'resume: typeperf restarted at once (no tracker restart)');
  await sleep(12000); const after = Y3.hist(pz.paused).rows, g = (await st(Y3)).gaps;
  ok(after.length >= 1 && after[0][0] - pz.paused > 18000, 'resume: new readings (' + after.length + '); the paused time is a gap, nothing filled in');
  ok(g.length === 1 && g[0][0] === pz.paused && g[0][1] >= g[0][0], 'gap marker saved: ' + Math.round((g[0][1] - g[0][0]) / 1e3) + ' s');
  ok((await st(Y3)).live && !Y3.bell().some(b => /paused/.test(b.txt)), 'resume: live readings back, bell note gone');
  ok((await post(Y3, { op: 'resume' })).res === 'ok' && Y3._state().P.spans.length === 1, 'resume when not paused: no-op');
  Y3.stop();

  // ---- 8. the real tracker (127.0.0.1:7788) ----
  let r1; for (let t = Date.now(); ; await new Promise(f => setTimeout(f, 1000))) { r1 = await get('/api/sys'); let j = null; try { j = JSON.parse(r1.b) } catch { }
    if (r1.code === 200 && j?.live && Date.now() - j.live.t < 10000 && JSON.parse((await get('/api/sys/hist')).b).rows.length > 0 || Date.now() - t > 20000) break } // a tracker that has just started has no reading yet: wait up to 20 s
  if (r1.code !== 200) ok(false, 'real tracker /api/sys reachable (' + r1.code + ')');
  else { const j = JSON.parse(r1.b); ok(j.live && Date.now() - j.live.t < 10000 && j.services && j.limits, 'real tracker: /api/sys live (' + Math.round((Date.now() - j.live.t) / 1e3) + ' s old)');
    const h = JSON.parse((await get('/api/sys/hist')).b); ok(h.rows.length > 0 && h.cols.length === 10, 'real tracker: /api/sys/hist ' + h.rows.length + ' readings');
    ok(JSON.parse((await get('/api/sys/hist?since=' + (Date.now() - 6e3))).b).rows.length <= 2, 'real tracker: ?since returns only new readings');
    ok(Array.isArray(JSON.parse((await get('/api')).b).sys), 'real tracker: /api carries the bell feed');
    ok((await get('/api/sys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"op":"limits"}' })).code === 403, 'real tracker: POST without NEXUS origin refused (403)');
    ok((await get('/api/sys', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:' + A.PORT, host: '127.0.0.1:' + A.PORT }, body: '{"op":"limits","l":{}}' })).code === 400, 'real tracker: limits without confirm refused (400)');
    ok((await get('/api/sys', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example', host: '127.0.0.1:' + A.PORT }, body: '{"op":"check"}' })).code === 403, 'real tracker: foreign origin refused'); }
  fs.rmSync(D, { recursive: true, force: true });
  console.log(fail ? `${fail} FAILED, ${pass} passed` : `all ${pass} passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e.stack); process.exit(1) });
