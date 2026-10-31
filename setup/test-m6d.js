// M6d exe check: node setup/test-m6d.js. Unit tests: `cargo test --offline` in setup/. Regression: test-m6c.js, test-m6b.js --no-picker, test-m6a.js.
// Throwaway roots in %TEMP% only. Covers: exact NEXUS version recorded in the install manifest at the end of a run and restored by Roll back,
// install status installed / outdated / unverified (file changed, file missing, version mismatch) / missing, and a hanging version check
// stopped at its time limit together with its child process, while an unrelated process keeps running.
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const EXE = path.join(__dirname, '../src-tauri/target/release/nexus-setup.exe');
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m);
const root = tag => require('./tmproot')('nexus-m6d-' + tag + '-');
const run = (T, args, extra = {}) => { const r = cp.spawnSync(EXE, ['--root', T, ...args], { env: { ...process.env, NEXUS_SETUP_NOBOX: '1', ...extra }, timeout: 60000, encoding: 'utf8' }); let j = null; try { j = JSON.parse(r.stdout.trim().split('\n').pop()) } catch { } return { code: r.status, j } };
const home = T => path.join(T, 'Users', 'nexususer'), prog = T => path.join(home(T), 'AppData', 'Local', 'Programs', 'NEXUS');
const put = (f, body) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body) };
const H = os.homedir(), realFiles = [path.join(H, '.claude', 'settings.json'), path.join(H, '.claude', 'token-tracker', 'projects.json'), path.join(process.env.APPDATA, 'obsidian', 'obsidian.json')].filter(f => fs.existsSync(f));
const rstat = () => realFiles.map(f => fs.statSync(f).mtimeMs).join(), r0 = rstat();
const pings = tag => +cp.execFileSync('powershell', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process | ? { $_.CommandLine -like '*${tag}*' -and $_.Name -eq 'PING.EXE' }).Count`], { encoding: 'utf8' }).trim();

// 1. install run records the exact version; detection uses it
const A = root('ver'), pd = path.join(A, 'payload'); put(path.join(pd, 'b'), 'DLL');
const plan = path.join(A, 'plan.json'), mf = path.join(prog(A), 'install-manifest.json'), man = () => JSON.parse(fs.readFileSync(mf, 'utf8'));
fs.writeFileSync(plan, JSON.stringify([{ path: path.join(prog(A), 'nexus.exe'), src: EXE }, { path: path.join(prog(A), 'core.dll'), src: path.join(pd, 'b') }]));
let r = run(A, ['--run', plan]);
const m = man();
ok(r.code === 0 && r.j.log.some(l => l.startsWith('version ')) && m.app && m.setup && m.installed, 'run records app version, Setup build id and install time in the manifest (' + JSON.stringify({ app: m.app, setup: m.setup }) + ')');
r = run(A, ['--detect']);
ok(r.j.install.status === 'installed' && r.j.install.recorded === r.j.appVersion && r.j.install.exeVersion === r.j.appVersion && r.j.install.version === m.app, 'detect: installed, recorded version = nexus.exe version = this Setup');
// 2. version mismatch between the record and nexus.exe = unverified (never guessed)
fs.writeFileSync(mf, JSON.stringify({ ...m, app: '0.0.9' }));
r = run(A, ['--detect']);
ok(r.j.install.status === 'unverified' && /differs/.test(r.j.install.note), 'recorded 0.0.9 but nexus.exe 0.0.1 = unverified (' + r.j.install.note + ')');
fs.writeFileSync(mf, JSON.stringify({ ...m, app: '0.0.0' }));
// nexus.exe has its own version resource, so an older record alone is a mismatch too; outdated needs both to agree (covered in test-m6c with a resource-less nexus.exe)
ok(run(A, ['--detect']).j.install.status === 'unverified', 'older record vs current nexus.exe = unverified, not outdated');
fs.writeFileSync(mf, JSON.stringify(m));
// 3. a NEXUS-owned file missing = unverified, counted as missing
fs.renameSync(path.join(prog(A), 'core.dll'), path.join(A, 'core.dll.away'));
r = run(A, ['--detect']);
ok(r.j.install.status === 'unverified' && r.j.install.missing === 1 && r.j.install.changed === 1, 'owned file missing = unverified, missing 1');
fs.renameSync(path.join(A, 'core.dll.away'), path.join(prog(A), 'core.dll'));
ok(run(A, ['--detect']).j.install.status === 'installed', 'file back = installed again');
// 4. Roll back the finished run: files removed, recorded version restored to before (none)
r = run(A, ['--rollback']);
const m2 = man();
ok(r.code === 0 && r.j.log.includes('recorded version restored') && m2.app == null && m2.setup == null && !fs.existsSync(path.join(prog(A), 'nexus.exe')), 'Roll back removes the files and restores the recorded version (none before)');
// 5. no manifest at all = missing (install: null)
const B = root('none');
ok(run(B, ['--detect']).j.install === null, 'no Setup install = missing (install null)');
// 6. crash after the last file, then Resume: version recorded once, previous value kept for Roll back
const C = root('crash'); put(path.join(C, 'p', 'x'), 'X');
const planC = path.join(C, 'plan.json'); fs.writeFileSync(planC, JSON.stringify([{ path: path.join(prog(C), 'x.txt'), src: path.join(C, 'p', 'x') }]));
run(C, ['--run', planC, '--crash-after', '0']);
r = run(C, ['--resume']);
const jn = JSON.parse(fs.readFileSync(path.join(home(C), 'AppData', 'Local', 'NEXUS', 'setup-journal.json'), 'utf8'));
ok(r.code === 0 && JSON.parse(fs.readFileSync(path.join(prog(C), 'install-manifest.json'), 'utf8')).app && jn.versionBefore && jn.versionBefore.app == null, 'crash + Resume: version recorded, journal keeps the value from before for Roll back');

// 7. hanging version check: stopped at the 8 s limit with its child; an unrelated process is untouched
const D = root('hang'), bin = path.join(D, 'bin');
put(path.join(bin, 'node.cmd'), '@ping -n 40 127.0.0.79 >nul\r\n@echo v20.0.0\r\n');
const other = cp.spawn(path.join(process.env.SystemRoot, 'System32', 'PING.EXE'), ['-n', '40', '127.0.0.80'], { stdio: 'ignore' });
const t = Date.now();
r = run(D, ['--detect'], { PATH: bin + ';' + path.join(process.env.SystemRoot, 'System32') });
const took = Date.now() - t, node = r.j.deps.find(d => d.id === 'node');
ok(node.status === 'unverified' && node.found && took < 20000, 'hanging node check = unverified after the time limit (' + took + ' ms)');
cp.execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500']);
ok(pings('127.0.0.79') === 0, 'timed-out check and its child process stopped (no leftover PING)');
ok(pings('127.0.0.80') === 1, 'unrelated process still running');
other.kill();

ok(rstat() === r0, 'real profile files (settings.json, tracker projects.json, obsidian.json) unchanged');
console.log(JSON.stringify({ pass, fail }, null, 1)); process.exitCode = fail.length ? 1 : 0;
