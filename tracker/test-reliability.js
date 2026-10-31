// B58-B60 regression (spec §26.9 "M5b reliability, step 2"): node test-reliability.js. Temp folders only; never touches the live tracker or its data.
// B58: a run cut off by a force-killed tracker is saved, marked 'interrupted' on restart and never re-run automatically.
// B59: unreadable state files are kept as .corrupt-*, the previous save (.bak) is restored, a clean start writes nothing.
// B60: the doc sync lock names the bash process, so an orphaned sync_docs.sh blocks a new sync until it ends.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const T = process.env.REL_T || fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-rel-')), D = path.join(T, 'data'), PR = path.join(T, 'proj'), V = path.join(T, 'vault'), CP = path.join(T, 'cp');
Object.assign(process.env, { REL_T: T, NEXUS_DATA: D, NEXUS_PROJ: PR, NEXUS_VAULT: V, NEXUS_CLAUDE_PROJECTS: CP, CLAUDE_CONFIG_DIR: path.join(T, 'claude'), NEXUS_SKILLS: path.join(T, 'skills'), NEXUS_PCACHE: path.join(T, 'pc'), NEXUS_STATE: path.join(T, 'state.json'), NEXUS_AUTO_SPEED: '600' });
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s) };
const A = require('./auto.js'), K = require('./knowledge.js'), logs = [], sleep = ms => new Promise(f => setTimeout(f, ms));
const dep = { log: m => logs.push(m), analyze: () => { }, rep: () => ({ days: [], sessions: [], health: [] }), K, P: require('./projects.js') };
const ok = o => { const r = A.post({ confirm: true, ...o }); assert.strictEqual(r.res, 'ok', JSON.stringify(r)); return r };
const until = async (f, ms = 20e3) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout waiting: ' + f); await sleep(100) } };
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } };
const AF = path.join(D, 'automations.json'), RF = path.join(D, 'auto-runs.json'), LOCK = path.join(D, 'sync-locks', 'docs.lock'), OUT = path.join(PR, 'out.txt');
const restart = () => { A.stop(); A._.reset(); A.init(dep) };

if (process.argv[2] === 'child') { // the "tracker" that gets force-killed mid-run
  A.init(dep); ok({ op: 'guards', g: { cpu: 100, ram: 0.5, disk: 1, claude: false } });
  const id = ok({ op: 'save', item: { name: 'Slow sync', steps: [{ a: 'sync', o: {} }], sched: { type: 'demand' } } }).id; ok({ op: 'run', id });
  setInterval(() => { }, 1e3);
} else {
  w(path.join(PR, 'PROJECT_DOCS.md'), '# docs\n'); w(path.join(V, 'MEMORY.md'), '# m\n'); fs.mkdirSync(CP, { recursive: true });
  w(path.join(PR, 'sync_docs.sh'), 'sleep $(cat slow 2>/dev/null || echo 0)\necho "graph: 1 nodes, 0 edges, 0 unresolved links"\necho done >> out.txt\n');
  w(path.join(PR, 'slow'), '12');
  const pass = []; const step = async (n, f) => { await f(); pass.push(n); console.log('  ok  ' + n) };
  const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } };
  (async () => { let child, inner; try {
    await step('B58 + B60: tracker force-killed during a doc sync step leaves a saved running record and an orphaned bash that holds the lock', async () => {
      child = cp.spawn(process.execPath, [__filename, 'child'], { env: process.env, stdio: 'ignore', windowsHide: true });
      await until(() => readJ(RF)?.[0]?.res === 'running' && readJ(RF)[0].step === 0 && readJ(LOCK)?.inner);
      cp.execFileSync('powershell', ['-NoProfile', '-Command', 'Stop-Process -Id ' + child.pid + ' -Force']); await sleep(500);
      inner = readJ(LOCK).inner; assert(alive(inner) && !alive(readJ(LOCK).child), 'launcher gone, inner bash still running'); assert(!fs.existsSync(OUT)); });
    await step('B60: a restarted tracker refuses Sync All while the orphaned bash runs', async () => {
      assert.match(K.sync().res, /A doc sync is still running \(process \d+\)/); });
    await step('B58: restart marks the run interrupted (step 1 Doc sync, not retried) and tells the user', async () => {
      const S = readJ(AF), at = new Date(Date.now() - 3600e3), hm = String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0');
      Object.assign(S.items[0], { on: true, sched: { type: 'daily', at: hm }, enabledAt: Date.now() - 26 * 3600e3, created: Date.now() - 26 * 3600e3 }); w(AF, JSON.stringify(S)); // its daily slot 1 h ago would be "missed"
      A.init(dep); const r = A.runs().runs; assert.strictEqual(r.length, 1); assert.strictEqual(r[0].res, 'interrupted');
      assert.match(r[0].why, /step 1 \(Doc sync\); outcome unknown, not retried/); assert(logs.some(l => /Slow sync.*interrupted/.test(l)));
      assert.strictEqual(readJ(RF)[0].res, 'interrupted', 'saved'); await sleep(1500); assert.strictEqual(A.runs().total, 1, 'no catch-up run'); });
    await step('B60: once the orphan ends, its stale lock is cleared and a new sync runs and releases the lock', async () => {
      await until(() => !alive(inner), 25e3); await sleep(300); w(path.join(PR, 'slow'), '0'); // it dies at its first output line (broken pipe), so it never reaches out.txt
      console.log('      orphan ended; reached its end: ' + fs.existsSync(OUT));
      assert.strictEqual(K.sync().res, 'ok'); assert.strictEqual(K.sync().res, 'Sync All is already running.');
      await until(() => K.syncState() && !K.syncState().running); assert(!fs.existsSync(LOCK), 'lock released'); });
    await step('B60: lock held by another live process refused; dead or older than 60 min taken', async () => {
      const other = cp.spawn(process.execPath, ['-e', 'setTimeout(() => { }, 60e3)'], { stdio: 'ignore' });
      w(LOCK, JSON.stringify({ pid: other.pid, at: Date.now() })); assert.match(K.sync().res, new RegExp('still running \\(process ' + other.pid));
      w(LOCK, JSON.stringify({ pid: other.pid, at: Date.now() - 61 * 6e4 })); assert.strictEqual(K.sync().res, 'ok'); await until(() => !K.syncState().running);
      other.kill(); await sleep(300); w(LOCK, JSON.stringify({ pid: other.pid, at: Date.now() })); assert.strictEqual(K.sync().res, 'ok'); await until(() => !K.syncState().running);
      assert(!fs.existsSync(LOCK)); });
    await step('B58: no automatic retry for any result except missed (interrupted, failed, cancelled, skipped, success)', async () => {
      A.stop(); A._.reset(); const S = readJ(AF), R = readJ(RF), at = new Date(Date.now() - 3600e3), hm = String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0'), old = Date.now() - 26 * 3600e3;
      const res = ['interrupted', 'failed', 'cancelled', 'skipped', 'success'];
      for (const x of res) { S.items.push({ ...S.items[0], id: 'r-' + x, name: 'R ' + x, on: true, sched: { type: 'daily', at: hm }, enabledAt: old, created: old }); R.unshift({ id: 'z' + x, a: 'r-' + x, name: 'R ' + x, at: Date.now() - 6e4, trig: 'schedule', res: x, ms: 0, why: '', log: [] }) }
      S.items[0].on = false; w(AF, JSON.stringify(S)); w(RF, JSON.stringify(R));
      A.init(dep); await sleep(1500); for (const x of res) assert.strictEqual(A.runs({ id: 'r-' + x }).total, 1, x + ' re-run'); });
    await step('B59: a clean restart writes nothing; every save keeps the previous version as .bak', async () => {
      const m = fs.statSync(RF).mtimeMs, before = fs.readFileSync(AF, 'utf8'); await sleep(50); restart(); assert.strictEqual(fs.statSync(RF).mtimeMs, m, 'auto-runs.json not rewritten');
      ok({ op: 'pause', paused: false }); assert.strictEqual(fs.readFileSync(AF + '.bak', 'utf8'), before); });
    await step('B59: truncated auto-runs.json kept as .corrupt-*, previous save restored, user told', async () => {
      const good = A.runs().total; A.stop(); A._.reset(); fs.copyFileSync(RF, RF + '.bak'); w(RF, '[{"id":"tr'); logs.length = 0; A.init(dep);
      assert.strictEqual(A.runs().total, good); const c = fs.readdirSync(D).filter(f => f.startsWith('auto-runs.json.corrupt-')); assert.strictEqual(c.length, 1);
      assert.strictEqual(fs.readFileSync(path.join(D, c[0]), 'utf8'), '[{"id":"tr'); assert(logs.some(l => /auto-runs\.json could not be read; kept as .*restored the previous save/.test(l))); });
    await step('B59: zero-byte automations.json with no .bak: starts empty, bad copy kept and never overwritten by later saves', async () => {
      A.stop(); A._.reset(); fs.rmSync(AF + '.bak'); w(AF, ''); logs.length = 0; A.init(dep); assert.strictEqual(A.status().items.length, 0);
      assert(logs.some(l => /automations\.json could not be read; .*no earlier copy, starting empty/.test(l)));
      const c = fs.readdirSync(D).filter(f => f.startsWith('automations.json.corrupt-')); assert.strictEqual(c.length, 1);
      ok({ op: 'save', item: { name: 'New', steps: [{ a: 'health', o: {} }], sched: { type: 'demand' } } }); assert.strictEqual(readJ(AF).items.length, 1);
      assert.strictEqual(fs.readFileSync(path.join(D, c[0]), 'utf8'), ''); });
    await step('B59: invalid JSON automations.json restored from .bak', async () => {
      A.stop(); A._.reset(); fs.copyFileSync(AF, AF + '.bak'); w(AF, 'not json'); A.init(dep); assert.strictEqual(A.status().items.length, 1); });
    await step('page: Interrupted chip, counted as a problem and as finished', async () => {
      const s = fs.readFileSync(path.join(__dirname, 'app', 'js', 'pages', 'automation.js'), 'utf8');
      assert(s.includes("interrupted: ['err', 'Interrupted']") && s.includes("r.res === 'interrupted'") && s.includes('/success|failed|cancelled|interrupted/')); });
    A.stop(); console.log(JSON.stringify({ pass: pass.length, fail: 0 })); fs.rmSync(T, { recursive: true, force: true }); process.exit(0);
  } catch (e) { console.error('FAIL', e.stack); try { child && cp.execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { } A.stop(); process.exit(1) } })();
}
