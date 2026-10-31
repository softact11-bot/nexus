// M6a exe check: node setup/test-m6a.js [exe]. Unit tests (paths, guard, manifest, journal) run with `cargo test --offline` in setup/.
// Starts the built Setup.exe only with throwaway roots in %TEMP%; the live app, shortcut, tracker and real profile are only read.
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const EXE = process.argv[2] || path.join(__dirname, '../src-tauri/target/release/nexus-setup.exe');
const L = process.env.LOCALAPPDATA, liveLog = path.join(L, 'local.nexus.m5a', 'startup.log'), stray = path.join(L, 'local.nexus.setup');
const mt = f => { try { return fs.statSync(f).mtimeMs } catch { return 0 } };
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m);
const env = { ...process.env, NEXUS_SETUP_NOBOX: '1' }, sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const live0 = mt(liveLog), stray0 = fs.existsSync(stray);
  let r = cp.spawnSync(EXE, [], { env, timeout: 15000 });
  ok(r.status === 2 && /test build/.test(r.stderr), 'no --root: refused, exit 2 (' + r.status + ')');
  const out = 'C:\\nexus-m6a-not-temp-' + process.pid;
  r = cp.spawnSync(EXE, ['--root', out], { env, timeout: 15000 });
  ok(r.status === 2 && !fs.existsSync(out), 'root outside %TEMP%: refused, nothing created');
  const T = require('./tmproot')('nexus-m6a-exe-'), log = path.join(T, 'setup.log');
  const t0 = Date.now(), p = cp.spawn(EXE, ['--root', T], { env, stdio: 'ignore' });
  let lines = [];
  while (Date.now() - t0 < 20000) { await sleep(250); try { lines = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) } catch { } if (lines.some(l => l.event === 'ui ready')) break }
  const start = lines.find(l => l.event === 'start');
  ok(start && /;release;setup$/.test(start.id), 'start logged with build id (' + start?.id + ')');
  ok(lines.some(l => l.event === 'ui ready'), 'window loaded the M0 screens + IPC works (' + (Date.now() - t0) + ' ms)');
  ok(['Users/nexususer/Desktop', 'Users/nexususer/AppData/Local/Programs/NEXUS', 'Users/nexususer/AppData/Local/NEXUS'].every(d => fs.existsSync(path.join(T, d))), 'mock profile created in the root');
  if (process.argv.includes('--keep')) { console.log('left running for a screenshot: pid ' + p.pid); return report() }
  cp.spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F']);
  report();
  function report() {
    ok(mt(liveLog) === live0, 'live app startup.log untouched');
    ok(fs.existsSync(stray) === stray0, 'no %LOCALAPPDATA%\\local.nexus.setup folder created');
    console.log(JSON.stringify({ pass, fail, root: T }, null, 1)); process.exitCode = fail.length ? 1 : 0;
  }
})();
