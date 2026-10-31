// NEXUS System Health sampler (spec §24). Runs only inside `node tracker.js serve`. Read-only: it never ends processes, starts or stops
// services or changes settings. Sources: one long-running `typeperf -si 5` (CPU, disk activity, network), os.freemem (RAM), nvidia-smi
// every 10 s (30 s while CPU > 85 %), statfs every 60 s. The per-process typeperf runs only while /api/sys/procs was asked for in the last 30 s.
// History: 24 h in memory, appended to NEXUS_DATA/sys-history.ndjson every 60 s, compacted on start + hourly, reloaded after a restart.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), RED = require('./redact.js'); // M4c: home → ~ and secrets masked in logs, exports and error text (spec §26.8)
const DATA = process.env.NEXUS_DATA || __dirname, HF = path.join(DATA, 'sys-history.ndjson'), AF = path.join(DATA, 'sys-alerts.json'), LF = path.join(DATA, 'sys-limits.json');
const STEP = 5e3, DAY = 864e5, MIN = 6e4, FLUSH = +process.env.NEXUS_SYS_FLUSH || MIN, KEEP_A = 7 * DAY, NCPU = os.cpus().length;
const LIMITS = { cpu: 90, ram: 1.5, disk: 10, gtemp: 83, sustain: 2, cooldown: 15 };
const LR = { cpu: [50, 100], ram: [0.5, 16], disk: [1, 200], gtemp: [60, 100], sustain: [1, 30], cooldown: [1, 240] };
// row = [t, cpu %, ram used %, disk activity %, rx B/s, tx B/s, gpu %, gpu °C, vram %, fan %]  (null = not measured)
const COLS = ['t', 'cpu', 'ram', 'disk', 'rx', 'tx', 'gpu', 'gtemp', 'vram', 'fan'];
const BG = new Set(['system', 'registry', 'memory compression', 'secure system', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'svchost', 'dwm', 'fontdrvhost', 'spoolsv',
  'msmpeng', 'nissrv', 'searchindexer', 'searchhost', 'runtimebroker', 'sihost', 'taskhostw', 'ctfmon', 'audiodg', 'wmiprvse', 'dllhost', 'conhost', 'smartscreen', 'securityhealthservice',
  'startmenuexperiencehost', 'shellexperiencehost', 'textinputhost', 'lockapp', 'wudfhost', 'dashost', 'explorer', 'applicationframehost', 'systemsettings', 'mpdefendercoreservice', 'lsaiso', 'vmmem']);
const DEV = /^(claude|robloxstudio.*|blender|obsidian|code)$/i, NOEXE = new Set(['system', 'registry', 'memory compression', 'secure system', 'vmmem']);
let dep = {}; // from tracker.js: rep(), tasks(cb), K (knowledge.js), A (auto.js)

const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
const writeJ = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o)); fs.renameSync(f + '.tmp', f) };
const r1 = v => v == null || !isFinite(v) ? null : Math.round(v * 10) / 10;
const csv = l => { const o = []; let i = 0; l = l.trim(); while (i < l.length) { const j = l.indexOf('"', i + 1); o.push(l.slice(i + 1, j)); i = j + 2; } return o; }; // typeperf: every field quoted

let H = [], buf = [], L = { ...LIMITS }, AL = [], since = {}, peak = {}, last = { at: 0 };
let tp = null, tpErr = null, tpHead = null, net = null, nTot = {}, gpu = { st: null, live: null, at: 0, err: null }, disks = [], started = Date.now(), timers = [];
let pr = { kid: null, want: 0, at: 0, list: null, head: null, started: 0, err: null, pid: {} };

// ---------- history ----------
function load() {
  const cut = Date.now() - DAY; let txt = ''; try { txt = fs.readFileSync(HF, 'utf8') } catch { }
  H = txt.split('\n').map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => Array.isArray(r) && r[0] > cut).sort((a, b) => a[0] - b[0]);
  compact(); L = { ...LIMITS, ...readJ(LF, {}) }; AL = readJ(AF, []).filter(a => a.at > Date.now() - KEEP_A);
}
function compact() { const cut = Date.now() - DAY; H = H.filter(r => r[0] > cut); fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(HF + '.tmp', H.map(r => JSON.stringify(r)).join('\n') + (H.length ? '\n' : '')); fs.renameSync(HF + '.tmp', HF); }
function flush() { if (!buf.length) return; try { fs.appendFileSync(HF, buf.map(r => JSON.stringify(r)).join('\n') + '\n'); buf = [] } catch { } }
function push(row) { H.push(row); buf.push(row); const cut = row[0] - DAY; while (H.length && H[0][0] < cut) H.shift(); }

// ---------- system sampler: one typeperf for the whole run ----------
const CTR = ['\\Processor(_Total)\\% Processor Time', '\\PhysicalDisk(_Total)\\% Idle Time', '\\Network Interface(*)\\Bytes Received/sec', '\\Network Interface(*)\\Bytes Sent/sec', '\\Network Interface(*)\\Current Bandwidth'];
function startTp() {
  tpHead = null; nTot = {}; let rest = '';
  if (stopped || P.at || tp) return; let me; // tp: a retry queued before a pause / resume finds the new one running
  try { me = tp = cp.spawn('typeperf', [...CTR, '-si', String(STEP / 1e3)], { windowsHide: true }) } catch (e) { tpErr = RED(e.message); return later(startTp, 3e4) }
  me.stdout.on('data', d => { if (tp !== me) return; const ls = (rest + d).split('\n'); rest = ls.pop(); for (const l of ls) line(l) }); // tp !== me: an old typeperf ended by pause still flushing
  me.on('error', e => { tpErr = 'typeperf: ' + RED(e.message) });
  me.on('exit', c => { if (tp !== me) return; tp = null; if (!stopped && !P.at) { tpErr = tpErr || 'typeperf stopped (code ' + c + '), restarting'; later(startTp, 1e4) } });
}
function line(l) {
  if (!l.trim() || l[0] !== '"') return; const c = csv(l);
  if (!tpHead) { tpHead = c; return; }
  const num = i => { const v = parseFloat(c[i]); return isFinite(v) ? v : null }, idx = re => tpHead.map((h, i) => re.test(h) ? i : -1).filter(i => i > 0);
  const cpu = num(1), idle = num(2), rx = idx(/Bytes Received\/sec$/), tx = idx(/Bytes Sent\/sec$/), bw = idx(/Current Bandwidth$/);
  const sum = a => a.reduce((s, i) => s + (num(i) || 0), 0);
  // adapter: the one that moved the most data since the tracker started (stable, no flipping); name = the counter instance
  bw.forEach((i, n) => { nTot[i] = (nTot[i] || 0) + (num(rx[n]) || 0) + (num(tx[n]) || 0) });
  const best = bw.map(i => [i, nTot[i], num(i) || 0]).sort((a, b) => b[1] - a[1] || b[2] - a[2])[0];
  net = best ? { name: tpHead[best[0]].match(/Network Interface\((.*)\)\\/)?.[1] || null, link: best[2] || null, up: bw.some(i => num(i) > 0) } : null;
  tpErr = null; sample({ cpu, dact: idle == null ? null : Math.max(0, Math.min(100, 100 - idle)), rx: sum(rx), tx: sum(tx) });
}
function sample(s) {
  if (P.at) return; const t = Date.now(), tot = os.totalmem(), free = os.freemem(), g = t - gpu.at < 25e3 ? gpu.live : null;
  const row = [t, r1(s.cpu), r1((tot - free) / tot * 100), r1(s.dact), Math.round(s.rx), Math.round(s.tx), g ? g.util : null, g ? g.temp : null, g && g.mt ? r1(g.mu / g.mt * 100) : null, g ? g.fan : null];
  push(row); last = { at: t, row, mem: [tot, tot - free] };
  check({ t, cpu: row[1], ramFree: free / 1e9, disks, gtemp: row[7] });
}

// ---------- GPU (nvidia-smi, read-only queries) ----------
const SMI = 'nvidia-smi', nv = v => { const x = parseFloat(v); return isFinite(x) ? x : null };
function smi(q, cb) { cp.execFile(SMI, ['--query-gpu=' + q, '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 5000 }, (e, out) => cb(e, e ? null : out.split('\n')[0].split(',').map(s => s.trim()))) }
function gpuTick(g = gen) { // g: loop generation; pause / resume start a new one, so a reading in flight never restarts an old loop
  if (stopped || P.at || g !== gen) return;
  if (!gpu.st) smi('name,power.limit,clocks.max.graphics,clocks.max.memory', (e, v) => { if (!e) gpu.st = { name: v[0], plim: nv(v[1]), maxgr: nv(v[2]), maxmem: nv(v[3]) } });
  smi('utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,fan.speed,clocks.gr,clocks.mem', (e, v) => {
    if (e) gpu.err = e.code === 'ENOENT' ? 'nvidia-smi not found (no NVIDIA driver tool on this PC)' : 'nvidia-smi: ' + RED((e.message || '').split('\n')[0]);
    else { gpu.err = null; gpu.at = Date.now(); gpu.live = { util: nv(v[0]), temp: nv(v[1]), mu: nv(v[2]), mt: nv(v[3]), pw: nv(v[4]), fan: nv(v[5]), gr: nv(v[6]), mem: nv(v[7]) } }
    later(() => gpuTick(g), (last.row?.[1] ?? 0) > 85 ? 3e4 : 1e4); // back off while the CPU is busy
  });
}

// ---------- drives ----------
function diskTick() {
  if (P.at) return; const out = []; for (const d of 'CDEFGHIJKLMNOPQRSTUVWXYZ') try { const s = fs.statfsSync(d + ':\\'); if (s.blocks) out.push([d + ':', s.blocks * s.bsize, (s.blocks - s.bfree) * s.bsize]) } catch { }
  disks = out;
}

// ---------- per-process sampler (only while the System Health page asks) ----------
function startPr() {
  pr.head = null; pr.pid = {}; pr.started = Date.now(); let rest = '';
  let me; try { me = pr.kid = cp.spawn('typeperf', ['\\Process(*)\\% Processor Time', '\\Process(*)\\ID Process', '\\Process(*)\\Working Set - Private', '-si', String(STEP / 1e3)], { windowsHide: true }) } catch (e) { pr.err = RED(e.message); return }
  me.stdout.on('data', d => { if (pr.kid !== me) return; const ls = (rest + d).split('\n'); rest = ls.pop(); for (const l of ls) prLine(l) });
  me.on('error', e => { pr.err = 'typeperf: ' + RED(e.message) });
  me.on('exit', () => { if (pr.kid === me) pr.kid = null });
}
function prLine(l) {
  if (!l.trim() || l[0] !== '"') return; const c = csv(l);
  if (!pr.head) { pr.head = c.map(h => h.match(/\\Process\((.*)\)\\(.*)$/)); return; }
  const by = {}; // instance → { cpu, pid, mem }
  pr.head.forEach((m, i) => { if (!m || i === 0) return; const v = parseFloat(c[i]); if (!isFinite(v) || v < 0) return; /* typeperf prints -1 when a process exited mid-read (B51): no reading */ const o = by[m[1]] ||= {};
    if (m[2] === '% Processor Time') o.cpu = v / NCPU; else if (m[2] === 'ID Process') o.pid = v; else o.mem = v; });
  // typeperf renumbers instances when a program exits (chrome#4 → chrome#3), so one column can compare two different processes:
  // a reading whose instance changed PID since the last one is dropped (counted as 0 this time), the rest capped at 100 %
  const pp = pr.pid; pr.pid = {}; for (const [inst, o] of Object.entries(by)) { pr.pid[inst] = o.pid; o.cpu = pp[inst] === o.pid ? Math.max(0, Math.min(100, o.cpu || 0)) : 0; }
  if (!Object.keys(pp).length) return; // first reading after a (re)start has nothing to compare with: publish from the second one
  const g = {}; // group by program name (chrome#3 → chrome)
  for (const [inst, o] of Object.entries(by)) { const n = inst.replace(/#\d+$/, ''), lo = n.toLowerCase(); if (lo === 'idle' || lo === '_total' || !o.pid) continue;
    const x = g[lo] ||= { n: NOEXE.has(lo) ? n : n + '.exe', cpu: 0, mem: 0, pids: [], cat: DEV.test(n) ? 'dev' : BG.has(lo) ? 'bg' : 'app' };
    x.cpu += o.cpu || 0; x.mem += o.mem || 0; x.pids.push(o.pid); if (o.pid === process.pid) x.cat = 'nexus'; }
  pr.list = Object.values(g).map(x => [x.n, r1(x.cpu), Math.round(x.mem), x.cat, x.pids.sort((a, b) => a - b)]).sort((a, b) => b[1] - a[1] || b[2] - a[2]); pr.at = Date.now();
}
function prTick() { // stop when nobody looked for 30 s; restart every 3 min so new programs appear (typeperf expands * only at start)
  if (P.at) return; const idle = Date.now() - pr.want > 3e4;
  if (pr.kid && (idle || Date.now() - pr.started > 18e4)) { pr.kid.kill(); pr.kid = null; if (idle) { pr.list = null; return; } }
  if (!pr.kid && !idle) startPr();
}
function procs() { if (P.at) return { at: 0, paused: P.at, warming: false, err: null, ncpu: NCPU, list: [] }; pr.want = Date.now(); if (!pr.kid) startPr(); return { at: pr.at, warming: !pr.list, err: pr.err, ncpu: NCPU, list: pr.list || [] }; }

// ---------- alerts (sustained 2 min by default; services right away; 15 min cooldown; recovery noted) ----------
const TXT = {
  cpu: (v, l) => ['CPU was very busy', `The processor stayed above ${l.cpu} % for ${l.sustain} min (peak ${Math.round(v)} %).`, 'Everything on the PC gets slower while the processor is this busy.', 'Check the Processes list for the heaviest program and close it if you do not need it. NEXUS never ends programs.'],
  ram: (v, l) => ['Free RAM was low', `Only ${v.toFixed(1)} GB of memory was free (limit ${l.ram} GB) for ${l.sustain} min.`, 'Apps may stutter or close unsaved work when memory runs out.', 'Save your work, then close browser tabs or apps you are not using.'],
  gtemp: (v, l) => ['GPU temperature was high', `The graphics card reached ${Math.round(v)} °C (limit ${l.gtemp} °C) for ${l.sustain} min.`, 'Long periods this hot make the card slow itself down to protect itself.', 'Keep the case vents clear; lower viewport or render quality if it keeps happening.'],
  disk: (v, l, d) => [`Drive ${d} is almost full`, `Only ${v.toFixed(1)} GB is free on ${d} (limit ${l.disk} GB).`, 'Low free space slows Windows updates, backups and saving big files.', 'Empty the Recycle Bin or move large files to another drive. NEXUS never deletes files.'],
};
let alertHook = null; // tests: observe raises
function raise(k, lvl, t, txt, v) {
  const prev = AL.find(a => a.k === k); if (prev && !prev.rec) return; // still open
  if (prev && t - prev.at < L.cooldown * MIN) return;
  const [title, what, why, todo] = txt; const a = { id: k + '-' + t, k, lvl, t: since[k] ?? t, at: t, rec: null, title, what, why, todo, v: r1(v) };
  for (const f in a) if (f !== 'k' && typeof a[f] === 'string') a[f] = RED(a[f]);
  AL.unshift(a); AL = AL.filter(x => x.at > t - KEEP_A).slice(0, 200); writeJ(AF, AL); alertHook?.(a);
}
function clear(k, t) { delete since[k]; delete peak[k]; const a = AL.find(x => x.k === k); if (a && !a.rec) { a.rec = t; writeJ(AF, AL) } }
function cond(k, bad, v, t, lvl, txt) {
  if (!bad) return clear(k, t);
  since[k] ??= t; peak[k] = k === 'ram' || k.startsWith('disk') ? Math.min(peak[k] ?? v, v) : Math.max(peak[k] ?? v, v);
  if (t - since[k] >= L.sustain * MIN) raise(k, lvl, t, txt(peak[k]), peak[k]);
}
function check(s) { // s = { t, cpu, ramFree (GB), disks: [[name, total, used]], gtemp }
  if (s.cpu != null) cond('cpu', s.cpu > L.cpu, s.cpu, s.t, 'warn', v => TXT.cpu(v, L));
  if (s.ramFree != null) cond('ram', s.ramFree < L.ram, s.ramFree, s.t, 'warn', v => TXT.ram(v, L));
  if (s.gtemp != null) cond('gtemp', s.gtemp > L.gtemp, s.gtemp, s.t, 'warn', v => TXT.gtemp(v, L));
  for (const [d, tot, used] of s.disks || []) { const f = (tot - used) / 1e9; cond('disk' + d, f < L.disk, f, s.t, 'warn', v => TXT.disk(v, L, d)); }
}

// ---------- services (only verified statuses) ----------
const ago = ms => ms < 6e4 ? Math.round(ms / 1e3) + ' s' : ms < 36e5 ? Math.round(ms / 6e4) + ' min' : ms < DAY ? (ms / 36e5).toFixed(1) + ' h' : Math.round(ms / DAY) + ' d';
const up = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m ${Math.floor(s % 60)}s` };
function services(apps) {
  const t = Date.now(), r = dep.rep?.() || {}, out = {};
  out.tracker = ['run', 'Running', 'up ' + up(process.uptime())];
  let rm = 0; try { rm = fs.statSync(dep.resp || '').mtimeMs } catch { }
  out.hook = r.error ? ['att', 'Error', String(r.error).split('\n')[0].slice(0, 120)] : rm ? ['run', 'Running', 'last request logged ' + ago(t - rm) + ' ago'] : ['na', 'No data', 'no usage log yet'];
  try { const a = dep.A.status(); out.auto = a.paused ? ['pause', 'Paused', 'scheduled runs off'] : ['run', 'Running', `${a.items.filter(x => x.on).length} enabled · last ${a.runs?.[0]?.res || 'no runs yet'}`] } catch (e) { out.auto = ['att', 'Error', RED(e.message)] }
  let s = null; try { s = dep.K.syncState() } catch { }
  out.sync = !s ? ['idle', 'Ready', 'no sync since the tracker started'] : s.running ? ['run', 'Syncing', 'sync_docs.sh running'] : s.conflicts?.length || s.code !== 0
    ? ['att', s.conflicts?.length ? 'Conflict' : 'Failed', s.conflicts?.length ? `${s.conflicts.length} CONFLICT · pick a version on Obsidian & Graphify` : 'sync_docs.sh exited with code ' + s.code + ' ' + ago(t - s.at) + ' ago']
    : ['run', 'OK', `last sync OK ${ago(t - s.at)} ago, ${s.written?.length ?? 0} written`];
  let gm = 0; try { gm = fs.statSync(dep.graph || '').mtimeMs } catch { }
  out.graph = !gm ? ['na', 'Missing', 'graph.json not built yet'] : s && !s.running && s.lines?.some(l => /GRAPH BUILD FAILED/.test(l)) ? ['att', 'Failed', 'GRAPH BUILD FAILED in the last sync'] : s && s.unresolved > 0 ? ['att', 'Broken links', s.unresolved + ' unresolved links'] : ['run', 'OK', `built ${ago(t - gm)} ago${s && s.unresolved === 0 ? ', 0 unresolved links' : ''}`];
  const m = Object.fromEntries(apps || []);
  out.obs = !apps ? ['na', 'Unknown', 'process list unavailable'] : m.Obsidian > 0 ? ['run', 'Running', fmtB(m.Obsidian) + ' memory'] : ['na', 'Closed', 'not running'];
  out.cc = !apps ? ['na', 'Unknown', 'process list unavailable'] : m['Claude Code'] > 0 ? ['run', 'Running', fmtB(m['Claude Code']) + ' memory'] : ['na', 'Closed', 'no session'];
  return out;
}
const fmtB = b => b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB';
const SVA = { hook: ['Usage tracking error', 'Analytics and Sessions stop growing until it works again.', 'Restart the tracker (node tracker.js serve). Nothing was changed.'],
  auto: ['Automation scheduler error', 'Scheduled automations cannot run.', 'Restart the tracker; your automations are kept.'],
  sync: ['Doc sync needs attention', 'The doc and its Obsidian copy may now differ; both versions were kept.', 'Open Obsidian & Graphify, choose which version to keep, then sync again.'],
  graph: ['Knowledge graph needs attention', 'Graph search and links can be out of date.', 'Fix the [[links]] the sync lists, then sync again.'] };
function svcTick() { // service failures alert right away (no sustain)
  const t = Date.now(), s = services(null);
  for (const k of Object.keys(SVA)) { const v = s[k]; if (v[0] === 'att') { const [title, why, todo] = SVA[k]; raise('svc-' + k, 'err', t, [title, `${v[1]}: ${v[2]}.`, why, todo]); } else clear('svc-' + k, t); }
}

// ---------- API ----------
let cpuLast = [process.cpuUsage(), Date.now()];
function status(cb) {
  const c = process.cpuUsage(cpuLast[0]), t = Date.now(), tcpu = (c.user + c.system) / 1e3 / Math.max(1, t - cpuLast[1]) * 100 / NCPU; cpuLast = [process.cpuUsage(), t];
  let hs = 0; try { hs = fs.statSync(HF).size } catch { }
  const sp = pr.list?.filter(p => /^(typeperf|nvidia-smi)\.exe$/i.test(p[0])).reduce((s, p) => s + p[1], 0);
  const done = apps => cb({ at: t, step: STEP, ncpu: NCPU, started, err: { tp: tpErr, gpu: gpu.err },
    cpu: { name: os.cpus()[0]?.model?.replace(/\s+/g, ' ').trim() || null, threads: NCPU },
    live: last.row ? Object.fromEntries(COLS.map((k, i) => [k, last.row[i]])) : null, mem: last.mem || [os.totalmem(), os.totalmem() - os.freemem()],
    gpu: gpu.st || gpu.live ? { ...gpu.st, ...(t - gpu.at < 25e3 ? gpu.live : {}), at: gpu.at } : null, net, disks,
    services: services(apps), apps, alerts: AL.slice(0, 50), limits: L, ranges: LR, paused: P.at, gaps: P.spans,
    foot: { cpu: r1(tcpu), rss: process.memoryUsage().rss, hist: hs, rows: H.length, sampler: sp == null ? null : r1(sp), procOn: !!pr.kid } });
  dep.tasks ? dep.tasks(done) : done(null);
}
const hist = since => ({ cols: COLS, step: STEP, rows: since ? H.filter(r => r[0] > since) : H });
const bell = () => (P.at ? [{ c: 'warn', txt: 'monitoring paused (Resume on the System Health page)', t: P.at }] : []).concat(AL.slice(0, 10).map(a => ({ c: a.rec ? 'ok' : a.lvl, txt: a.rec ? `${a.title} (back to normal)` : a.title, t: a.rec || a.at })));
function post(o, cb) {
  if (o.op === 'check') { const s = services(null); if (o.id === 'obs' || o.id === 'cc') return status(j => cb({ res: 'ok', svc: j.services })); return cb({ res: 'ok', svc: s }); }
  if (o.op === 'limits') {
    if (o.confirm !== true) return cb({ res: 'confirm required' });
    const n = {}; for (const k of Object.keys(LIMITS)) { const v = +o.l?.[k]; if (!isFinite(v) || v < LR[k][0] || v > LR[k][1]) return cb({ res: `${k} must be ${LR[k][0]}-${LR[k][1]}` }); n[k] = v; }
    L = n; writeJ(LF, L); return cb({ res: 'ok', limits: L });
  }
  if (o.op === 'pause') { pause(); return cb({ res: 'ok', paused: P.at }); }
  if (o.op === 'resume') { resume(); return cb({ res: 'ok', paused: null }); }
  if (o.op === 'reveal') { // Explorer opens with the program selected. Read-only; only PIDs from the current process list.
    const pid = +o.pid; if (!Number.isInteger(pid) || pid <= 4 || !pr.list?.some(p => p[4].includes(pid))) return cb({ res: 'unknown process' });
    return cp.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`], { windowsHide: true, timeout: 8000 }, (e, out) => {
      const f = (out || '').trim(); if (e || !f || !fs.existsSync(f)) return cb({ res: 'Windows does not share where this program lives (system or protected process).' });
      if (!process.env.NEXUS_SYS_NOREVEAL) cp.spawn('explorer.exe', ['/select,', f], { detached: true, stdio: 'ignore' }).unref(); cb({ res: 'ok', path: f }); }); // NOREVEAL: tests only
  }
  cb({ res: 'unknown op' });
}

// ---------- lifecycle ----------
let stopped = false;
const later = (f, ms) => { const h = setTimeout(f, ms); timers.push(h); if (timers.length > 50) timers = timers.filter(x => !x._destroyed); return h; };
const every = (f, ms) => timers.push(setInterval(f, ms));
// ---------- pause / resume (M4d, spec §26.8 + Q8): only the hardware readers stop (typeperf, nvidia-smi, statfs, process list).
// Service checks, token tracking, hooks, Automation and sync keep running. The paused time is a gap in history (no readings invented).
let P = { at: null, spans: [] }, gen = 0, samp = true; // P.at = paused since; spans = [from, to] of the last 24 h (the graphs mark them)
const PF = path.join(DATA, 'sys-paused.json'), saveP = () => { P.spans = P.spans.filter(s => s[1] > Date.now() - DAY).slice(-50); writeJ(PF, P) };
function run() { gen++; diskTick(); if (samp) { startTp(); gpuTick(); } }
function pause() {
  if (P.at) return; P.at = Date.now(); saveP(); gen++; flush();
  tp?.kill(); pr.kid?.kill(); tp = pr.kid = null; pr.list = null; last = { at: 0 }; disks = [];
  for (const k in since) if (!k.startsWith('svc-')) { delete since[k]; delete peak[k]; } // a sustained-limit count never spans the pause
}
function resume() { if (!P.at) return; P.spans.push([P.at, Date.now()]); P.at = null; saveP(); run(); }

function init(d = {}) {
  dep = d; stopped = false; started = Date.now(); samp = d.sampler !== false; load(); P = { at: null, spans: [], ...readJ(PF, {}) };
  if (!P.at) run(); // paused before a restart: stays paused
  every(flush, FLUSH); every(diskTick, MIN); every(prTick, STEP); every(svcTick, 3e4); every(() => { flush(); compact() }, 36e5);
  process.on('exit', flush);
}
function stop() { stopped = true; gen++; flush(); timers.forEach(h => { clearTimeout(h); clearInterval(h) }); timers = []; tp?.kill(); pr.kid?.kill(); tp = pr.kid = null; process.removeListener('exit', flush); }
module.exports = { init, stop, status, hist, procs, post, bell, flush, _check: check, _svc: svcTick, _push: push, _hook: f => { alertHook = f }, _prFeed: L => { pr.head = null; pr.pid = {}; pr.list = null; L.forEach(prLine); return pr.list }, _state: () => ({ H, AL, L, since, tp: !!tp, pr: !!pr.kid, gpu, net, disks, P, kids: [tp?.pid, pr.kid?.pid].filter(Boolean) }) };
