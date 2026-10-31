// M6f installer audit (CLI): node setup/test-m6f.js. GUI part: test-m6f-gui.js. Throwaway roots in %TEMP% only.
// Covers: Apps & features record + Setup copy, lock file + empty program folder cleanup (never a user or changed file), uninstall started from the
// installed Setup copy, damaged install record, an interrupted Update at every step (Roll back = old install exactly, Resume = new install exactly),
// read-only and locked files (permission failures roll back), a broken package, Update with unchanged files, and the real profile unchanged.
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const EXE = path.join(__dirname, '../src-tauri/target/release/nexus-setup.exe');
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m);
const root = tag => require('./tmproot')('nexus-m6f-' + tag + '-');
const run = (T, args, exe = EXE) => { const r = cp.spawnSync(exe, ['--root', T, ...args], { env: { ...process.env, NEXUS_SETUP_NOBOX: '1' }, timeout: 90000, encoding: 'utf8' }); let j = null; try { j = JSON.parse(r.stdout.trim().split('\n').pop()) } catch { } return { code: r.status, j: j || {} } };
const act = (T, kind, pl, opts = {}, extra = [], exe) => run(T, ['--apply', kind, ...(pl ? ['--payload', pl] : []), '--opts', JSON.stringify(opts), ...extra], exe);
const home = T => path.join(T, 'Users', 'nexususer'), prog = T => path.join(home(T), 'AppData', 'Local', 'Programs', 'NEXUS'), data = T => path.join(home(T), 'AppData', 'Local', 'NEXUS');
const desk = T => path.join(home(T), 'Desktop', 'NEXUS.lnk'), reg = T => path.join(T, 'registry', 'HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion');
const arp = T => path.join(reg(T), 'Uninstall', 'NEXUS'), runv = T => path.join(reg(T), 'Run', 'NEXUS'), mf = T => path.join(prog(T), 'install-manifest.json');
const put = (f, b) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b) };
const rd = f => fs.readFileSync(f, 'utf8'), ex = f => fs.existsSync(f), man = T => JSON.parse(rd(mf(T)));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const pkg = (T, name, files) => { const d = path.join(T, name); put(path.join(d, 'nexus.exe'), fs.readFileSync(EXE)); for (const [f, b] of Object.entries(files)) put(path.join(d, f), b); return d };
const ALL = { desk: true, start: true, boot: true };
// everything Setup can place, as relative path → content hash (text files with the root path normalised; shortcuts by existence only)
const walk = (d, out = []) => { if (ex(d)) for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name), out) : out.push(path.join(d, e.name)); return out };
const snap = T => Object.fromEntries([prog(T), path.join(home(T), 'Desktop'), path.join(home(T), 'AppData', 'Roaming'), reg(T)].flatMap(d => walk(d))
  .filter(f => !/install-manifest\.json$|\.setup\.lock$/.test(f)).map(f => [path.relative(T, f), f.endsWith('.lnk') ? 'lnk' : /\.(exe)$/.test(f) ? sha(f) : crypto.createHash('sha256').update(rd(f).split(T).join('<T>')).digest('hex')]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]).map(k => path.basename(k) + (k in a ? '' : '+') + (k in b ? '' : '-')).join(',');

// real profile, Desktop shortcut and HKCU Run / Uninstall values (read only, before / after)
const H = os.homedir(), realFiles = [path.join(H, '.claude', 'settings.json'), path.join(H, '.claude', 'token-tracker', 'projects.json'), path.join(process.env.APPDATA, 'obsidian', 'obsidian.json')].filter(ex);
const q = k => { try { return cp.execFileSync('reg', ['query', k, ...(k.endsWith('Run') ? ['/v', 'NEXUS'] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return 'absent' } };
const rstate = () => JSON.stringify([realFiles.map(f => fs.statSync(f).mtimeMs), ex(path.join(H, 'Desktop', 'NEXUS.lnk')), q('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'), q('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NEXUS')]), r0 = rstate();

// 1. Apps & features record + Setup copy
const A = root('arp'), P1 = pkg(A, 'pkg1', { 'core.dll': 'CORE1', 'tracker/tracker.js': '//' });
let r = act(A, 'install', P1, ALL);
const kv = ex(arp(A)) ? Object.fromEntries(rd(arp(A)).trim().split('\n').map(l => l.split(/=(.*)/s).slice(0, 2))) : {};
ok(r.code === 0 && kv.DisplayName === 'NEXUS' && kv.DisplayVersion === man(A).app && kv.InstallLocation === prog(A) && kv.UninstallString === `"${path.join(prog(A), 'NEXUS Setup.exe')}"` && +kv.EstimatedSize > 0, 'Apps & features record written with name, version, location, uninstall command, size (' + (r.j.error || '') + ')');
ok(ex(path.join(prog(A), 'NEXUS Setup.exe')) && sha(path.join(prog(A), 'NEXUS Setup.exe')) === sha(EXE) && man(A).files[Object.keys(man(A).files).find(k => k.endsWith('NEXUS Setup.exe'))]?.owner === 'nexus', 'Setup copy placed in the program folder, recorded as NEXUS-owned');
ok(!ex(path.join(prog(A), '.setup.lock')), 'lock file deleted when Setup exits');
ok(act(A, 'repair', P1).j.log?.[0]?.startsWith('nothing to do'), 'Repair right after install: nothing to do (record and Setup copy stable)');

// 2. uninstall started from the installed Setup copy (as Apps & features does): it keeps only itself and says why
r = act(A, 'uninstall', null, {}, [], path.join(prog(A), 'NEXUS Setup.exe'));
ok(r.code === 0 && r.j.preview.kept.some(k => k.path.endsWith('NEXUS Setup.exe') && /running/.test(k.why)) && !ex(path.join(prog(A), 'core.dll')) && !ex(arp(A)) && !ex(desk(A)) && !ex(runv(A)) && !ex(mf(A)), 'uninstall from the installed Setup: everything removed except the running Setup copy (listed: "Setup is running from here")');
ok(fs.readdirSync(prog(A)).join() === 'NEXUS Setup.exe', 'left behind: only NEXUS Setup.exe (no lock file, no empty tracker folder)');

// 3. normal uninstall: the program folder disappears; with a user file it stays with exactly that file
const B = root('clean'), PB = pkg(B, 'pkg', { 'core.dll': 'C', 'tracker/tracker.js': '//' });
act(B, 'install', PB, ALL); r = act(B, 'uninstall', null, {});
ok(r.code === 0 && !ex(prog(B)) && ex(data(B)), 'uninstall: Programs\\NEXUS removed entirely (lock + empty folders), data folder kept');
act(B, 'install', PB, {}); put(path.join(prog(B), 'tracker', 'my-notes.txt'), 'mine'); fs.writeFileSync(path.join(prog(B), 'core.dll'), 'user changed');
r = act(B, 'uninstall', null, {});
ok(r.code === 0 && rd(path.join(prog(B), 'tracker', 'my-notes.txt')) === 'mine' && rd(path.join(prog(B), 'core.dll')) === 'user changed' && !ex(path.join(prog(B), 'nexus.exe')) && !ex(path.join(prog(B), '.setup.lock')), 'uninstall with a user file + a changed file: both kept, folder kept for them, NEXUS files and lock gone');
const E = root('empty'); run(E, ['--detect']);
ok(!ex(prog(E)), 'starting Setup without installing leaves no Programs\\NEXUS folder behind');
const J = path.join(home(B), 'AppData', 'Local', 'junction-target'); put(path.join(J, 'keep', 'x.txt'), 'x'); fs.mkdirSync(path.join(J, 'empty-keep'));
const B2 = root('junction'); fs.mkdirSync(prog(B2), { recursive: true }); fs.symlinkSync(J, path.join(prog(B2), 'link'), 'junction');
run(B2, ['--detect']);
ok(ex(path.join(J, 'empty-keep')) && rd(path.join(J, 'keep', 'x.txt')) === 'x', 'cleanup never follows a junction: empty folders behind it are kept');

// 4. damaged install record: every action refused, nothing changed
const C = root('damaged'), PC = pkg(C, 'pkg', { 'core.dll': 'C' }); act(C, 'install', PC, ALL);
fs.writeFileSync(mf(C), '{ "files": {'); const sc = snap(C);
const refused = ['update', 'repair', 'uninstall'].map(k => act(C, k, PC, {}));
ok(refused.every(x => x.code === 1 && /damaged/.test(x.j.error)) && same(snap(C), sc) && rd(mf(C)) === '{ "files": {', 'damaged install-manifest.json: Update, Repair, Uninstall refused, nothing changed');
ok(/damaged/.test(act(C, 'install', PC, {}).j.error), 'damaged record: a new install is refused too (no overwrite of an unknown state)');

// 5. interrupted Update at every step: Roll back = the old install exactly, Resume = the new install exactly
const mk = tag => { const T = root(tag), P = pkg(T, 'p1', { 'a.dll': 'A1', 'b.dll': 'B1', 'c.dll': 'C1', 'tracker/tracker.js': '//1' }); act(T, 'install', P, ALL);
  fs.writeFileSync(mf(T), JSON.stringify({ ...man(T), app: '0.0.0' })); return [T, pkg(T, 'p2', { 'a.dll': 'A2', 'b.dll': 'B1', 'd.dll': 'D2', 'tracker/tracker.js': '//2' })] };
const [R0, Q0] = mk('ref'), before = snap(R0); r = act(R0, 'update', Q0, {}); const after = snap(R0), n = r.j.preview.steps.length;
ok(r.code === 0 && n >= 4 && !same(before, after) && run(R0, ['--detect']).j.install.status === 'installed', `reference Update: ${n} steps, detect installed`);
const bad = [];
for (let k = 0; k < n; k++) {
  for (const way of ['rollback', 'resume']) {
    const [T, Q] = mk(`k${k}${way[2]}`), b0 = snap(T), st0 = run(T, ['--detect']).j.install.status;
    const c1 = act(T, 'update', Q, {}, ['--crash-after', String(k)]);
    const blocked = act(T, 'repair', Q, {});
    const fin = run(T, ['--' + way]), st = run(T, ['--detect']).j.install;
    const good = c1.code !== 0 && /unfinished/.test(blocked.j.error || '') && fin.code === 0 && (way === 'rollback' ? same(snap(T), b0) && man(T).app === '0.0.0' && st.status === st0 : same(snap(T), after) && st.status === 'installed');
    if (!good) bad.push(`${way}@${k}: ${fin.j.error || ''} ${st.status} diff[${diff(snap(T), way === 'rollback' ? b0 : after)}]`);
  }
}
ok(!bad.length, `crash after each of the ${n} update steps: another action is blocked until Resume / Roll back; Roll back = old install byte for byte (same detect status as before), Resume = new install byte for byte (status installed) ${bad.join('; ')}`);

// 6. permission failures: a read-only program file and a file locked by a running process both roll the Update back
// read-only file: the swap fails; snap() would also catch a leftover .nexus-tmp file
const [RO, QR] = mk('readonly'), bro = snap(RO); cp.execFileSync('attrib', ['+R', path.join(prog(RO), 'a.dll')]);
r = act(RO, 'update', QR, {});
ok(r.code === 1 && r.j.rolledBack === true && same(snap(RO), bro) && man(RO).app === '0.0.0', 'read-only a.dll: Update fails, rolled back to the old install exactly (' + r.code + ' ' + (r.j.error || '').slice(0, 80) + ' diff[' + diff(snap(RO), bro) + '])');
cp.execFileSync('attrib', ['-R', path.join(prog(RO), 'a.dll')]); r = act(RO, 'update', QR, {});
ok(r.code === 0 && same(snap(RO), after), 'read-only flag cleared: the same Update then succeeds');
const [LK, QL] = mk('locked'), blk = snap(LK);
const holder = cp.spawn('powershell', ['-NoProfile', '-Command', `$f=[IO.File]::Open('${path.join(prog(LK), 'c.dll')}','Open','Read','Read'); Start-Sleep 20; $f.Close()`], { stdio: 'ignore' });
cp.execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 1500']);
r = act(LK, 'uninstall', null, {}); holder.kill();
ok(r.code === 1 && r.j.rolledBack === true && same(snap(LK), blk) && ex(mf(LK)), 'uninstall with a file in use (app running): rolled back, install complete again, record kept');

// 7. broken package + Update whose files all match + version mismatch
const G = root('pkg'), PG = pkg(G, 'p', { 'core.dll': 'C' }); act(G, 'install', PG, {});
const Pbad = path.join(G, 'nopkg'); put(path.join(Pbad, 'core.dll'), 'x');
ok(act(G, 'repair', Pbad, {}).j.error?.includes('no nexus.exe') && rd(path.join(prog(G), 'core.dll')) === 'C', 'package without nexus.exe: refused, nothing changed');
fs.writeFileSync(mf(G), JSON.stringify({ ...man(G), app: '0.0.0' }));
ok(run(G, ['--detect']).j.install.status === 'unverified', 'older record vs the nexus.exe version: detect unverified (M6d rule)');
r = act(G, 'update', PG, {});
ok(r.code === 0 && man(G).app !== '0.0.0' && run(G, ['--detect']).j.install.status === 'installed', 'Update with identical files still records the new version (no endless "outdated")');

// 8. real profile untouched
ok(rstate() === r0, 'real settings.json / tracker / obsidian.json mtimes, Desktop NEXUS.lnk, HKCU Run "NEXUS" and Uninstall\\NEXUS unchanged');
console.log(JSON.stringify({ pass, fail }, null, 1));
process.exit(fail.length ? 1 : 0);
