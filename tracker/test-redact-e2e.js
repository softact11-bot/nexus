// M4c end-to-end check: node test-redact-e2e.js. Plants the home folder + fake keys into the real write paths on a fixture data dir
// (temp NEXUS_DATA, port 7797, background work removed), then scans every file written there and every error reply: none may carry them.
// Also a static check: no error text (e.message / err.message) reaches a log or reply in the tracker code without RED().
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), http = require('http');
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m), P = 7797, sleep = ms => new Promise(r => setTimeout(r, ms));
const H = os.homedir(), KEY = 'sk-ant-' + 'api03-' + 'fakeFakeFakeFakeFakeFake', HEX = 'c0ffee'.repeat(8), BAD = new RegExp([H, H.replace(/\\/g, '/'), H.replace(/\\/g, '\\\\'), KEY, HEX].map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-redact-')), DATA = path.join(T, 'data'); fs.mkdirSync(DATA);
const PLANT = `${H}\\Desktop\\secret.md ${KEY} token=${HEX}`;

// ---------- static: every error text in the sink files goes through RED ----------
for (const f of ['tracker.js', 'auto.js', 'sys.js', 'syncview.js', 'catalog.js', 'sync.js', 'pluginops.js', 'knowledge.js', 'launch.js']) {
  const raw = fs.readFileSync(path.join(__dirname, f), 'utf8').split('\n').flatMap((l, i) => [...l.matchAll(/(?<!RED\()(?<!RED\(\()\b(e|err)\.message\b/g)].map(() => f + ':' + (i + 1)));
  ok(!raw.length, 'all error text through RED in ' + f + (raw.length ? ' (raw: ' + raw.join(', ') + ')' : ''));
}

// ---------- launch.js: key file that cannot be written → guard.log line ----------
fs.mkdirSync(path.join(DATA, 'launch.key')); // a folder where the file should be: EISDIR names the full path
cp.spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(__dirname, 'launch.js'))})(${JSON.stringify(path.join(DATA, 'launch.key'))}, ${P})`], { env: { ...process.env, NEXUS_TOKEN: '' } });
const gl = fs.readFileSync(path.join(DATA, 'guard.log'), 'utf8'); ok(/launch\.key not written: .*~/.test(gl) && !BAD.test(gl), 'guard.log: path shown as ~ (' + gl.trim().slice(25, 110) + ')');

// ---------- auto.js: run log, run reason, export, notes ----------
const kid = cp.spawnSync(process.execPath, ['-e', `const A = require(${JSON.stringify(path.join(__dirname, 'auto.js'))}), logs = [];
  A.init({ log: m => logs.push(m) }); A.post({ op: 'import', confirm: true, items: [{ name: 'Nightly ${KEY.slice(0, 20)}', desc: ${JSON.stringify(PLANT)}, steps: [{ a: 'health' }], sched: { type: 'demand' } }] });
  const a = A._.S.items[0]; A._.RUNS.unshift({ a: a.id, at: Date.now(), res: 'failed', why: ${JSON.stringify(PLANT)}, log: [] });
  const ex = JSON.stringify(A.exportJ('all')); A.post({ op: 'delete', id: a.id, confirm: true }); A.stop(); console.log(JSON.stringify({ ex, logs }))`], { env: { ...process.env, NEXUS_DATA: DATA }, encoding: 'utf8' });
let ar = {}; try { ar = JSON.parse(kid.stdout.trim().split('\n').pop()) } catch { ok(false, 'auto child output: ' + (kid.stderr || kid.stdout).slice(0, 200)) }
ok(ar.ex && !BAD.test(ar.ex) && ar.ex.includes('~\\\\Desktop'), 'Automation export: home → ~, key hidden');
const runs = fs.existsSync(path.join(DATA, 'auto-runs.json')) ? fs.readFileSync(path.join(DATA, 'auto-runs.json'), 'utf8') : '';
ok(runs.includes('Desktop') && !BAD.test(runs), 'auto-runs.json: run reason redacted');

// ---------- error replies over HTTP ----------
const boot = `const fs = require('fs'), M = require('module'), f = ${JSON.stringify(path.join(__dirname, 'tracker.js'))}, m = new M(f);
  const s = fs.readFileSync(f, 'utf8').replace('PORT = 7788', 'PORT = ${P}').replace(".listen(PORT, '127.0.0.1', () => {", ".listen(PORT, '127.0.0.1', () => { return;");
  if (!s.includes('PORT = ${P}') || !s.includes('{ return;')) process.exit(3);
  m.filename = f; m.paths = M._nodeModulePaths(${JSON.stringify(__dirname)}); process.argv.length = 2; process.argv.push('serve'); m._compile(s, f);`;
const TOK = require('crypto').randomBytes(32).toString('hex');
const S = cp.spawn(process.execPath, ['-e', boot], { cwd: __dirname, env: { ...process.env, NEXUS_TOKEN: TOK, NEXUS_DATA: DATA, NEXUS_VAULT: '', NEXUS_PROJ: '' }, stdio: 'ignore', windowsHide: true });
const req = (p, body) => new Promise(r => { const x = http.request({ host: '127.0.0.1', port: P, path: p, method: body === undefined ? 'GET' : 'POST', headers: { host: '127.0.0.1:' + P, origin: 'http://127.0.0.1:' + P, 'content-type': 'application/json', 'x-nexus-token': TOK } }, y => { let b = ''; y.on('data', c => b += c).on('end', () => r({ c: y.statusCode, b })) }); x.on('error', e => r({ c: 0, b: e.message })); x.end(body) });
(async () => {
  try {
    let up = 0; for (let i = 0; i < 40 && up !== 200; i++) { await sleep(250); up = (await req('/api')).c } ok(up === 200, 'fixture server up');
    for (const p of ['/api/act', '/api/projects', '/api/vault', '/api/auto', '/api/sys', '/api/plugin', '/api/catalog', '/api/sync/run', '/api/sync/engine']) {
      const r = await req(p, PLANT + ' {'); ok(r.c >= 400 && r.c < 500 && !BAD.test(r.b), 'error reply ' + p + ' (' + r.c + ') carries no home path or key: ' + r.b.slice(0, 90));
    }
  } finally { S.kill() }
  await sleep(300);
  // ---------- scan: every file the run wrote ----------
  const files = []; (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? (e.name !== 'backups' && w(f)) : files.push(f) } })(DATA);
  const leaks = files.filter(f => BAD.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(DATA, f));
  ok(files.length >= 2 && !leaks.length, `fixture data scan: ${files.length} files, leaks: ${leaks.join(', ') || 'none'}`);
  fs.rmSync(T, { recursive: true, force: true });
  console.log(`test-redact-e2e: ${pass}/${pass + fail.length} passed` + (fail.length ? ' | FAIL: ' + fail.join(' | ') : ''));
  process.exit(fail.length ? 1 : 0);
})();
