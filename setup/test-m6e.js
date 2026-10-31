// M6e exe check: node setup/test-m6e.js. Unit tests: `cargo test --offline` in setup/. Regression: test-m6d.js, test-m6c.js, test-m6b.js --no-picker, test-m6a.js.
// Throwaway roots in %TEMP% only. Covers install (new layout + adopt), shortcuts / Start with Windows only when ticked, Claude Code hooks opt-in
// (diff, backup, hash re-check, other settings kept in order), Update (code only, owner kept, removed / kept files, auto Roll back on failure, no downgrade),
// Repair, Uninstall (keeps data, vault note, changed files; hooks only NEXUS entries; typed DELETE data removal with backup + recovery), crash + Resume,
// and the real profile, Desktop and HKCU Run value unchanged.
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const EXE = path.join(__dirname, '../src-tauri/target/release/nexus-setup.exe');
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m);
const root = tag => require('./tmproot')('nexus-m6e-' + tag + '-');
const run = (T, args) => { const r = cp.spawnSync(EXE, ['--root', T, ...args], { env: { ...process.env, NEXUS_SETUP_NOBOX: '1' }, timeout: 90000, encoding: 'utf8' }); let j = null; try { j = JSON.parse(r.stdout.trim().split('\n').pop()) } catch { } return { code: r.status, j: j || {} } };
const act = (T, kind, pl, opts = {}, extra = []) => run(T, ['--apply', kind, ...(pl ? ['--payload', pl] : []), '--opts', JSON.stringify(opts), ...extra]);
const home = T => path.join(T, 'Users', 'nexususer'), prog = T => path.join(home(T), 'AppData', 'Local', 'Programs', 'NEXUS'), data = T => path.join(home(T), 'AppData', 'Local', 'NEXUS');
const lnk = { desk: T => path.join(home(T), 'Desktop', 'NEXUS.lnk'), start: T => path.join(home(T), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'NEXUS.lnk') };
const runv = T => path.join(T, 'registry', 'HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Run', 'NEXUS');
const sj = T => path.join(home(T), '.claude', 'settings.json'), mf = T => path.join(prog(T), 'install-manifest.json');
const put = (f, body) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body) };
const rd = f => fs.readFileSync(f, 'utf8'), ex = f => fs.existsSync(f), man = T => JSON.parse(rd(mf(T)));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const target = f => cp.execFileSync('powershell', ['-NoProfile', '-Command', `(New-Object -ComObject WScript.Shell).CreateShortcut('${f.replace(/'/g, "''")}').TargetPath`], { encoding: 'utf8' }).trim();
const pkg = (T, name, files) => { const d = path.join(T, name); put(path.join(d, 'nexus.exe'), fs.readFileSync(EXE)); for (const [f, b] of Object.entries(files)) put(path.join(d, f), b); return d };
const USER_HOOK = { matcher: 'startup', hooks: [{ type: 'command', command: 'bash user.sh' }] };
const settings = { permissions: { allow: [] }, model: 'x', hooks: { SessionStart: [USER_HOOK] }, zeta: 1 };

// real profile: files, Desktop shortcut, HKCU Run "NEXUS" value (read only, before / after)
const H = os.homedir(), realFiles = [path.join(H, '.claude', 'settings.json'), path.join(H, '.claude', 'token-tracker', 'projects.json'), path.join(process.env.APPDATA, 'obsidian', 'obsidian.json')].filter(ex);
const regRun = () => { try { return cp.execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'NEXUS'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return 'absent' } };
const rstate = () => JSON.stringify([realFiles.map(f => fs.statSync(f).mtimeMs), ex(path.join(H, 'Desktop', 'NEXUS.lnk')), regRun()]), r0 = rstate();

// 1. new-layout install, everything ticked: plan changes nothing, apply places files, shortcuts, startup entry, hooks after a backup
const A = root('new'); put(sj(A), JSON.stringify(settings, null, 2)); const s0 = sha(sj(A));
const P1 = pkg(A, 'pkg1', { 'core.dll': 'CORE1', 'old.dll': 'OLD', 'extra.dll': 'EXTRA', 'zz.dll': 'ZZ1', 'tracker/tracker.js': '// tracker' });
const ALL = { desk: true, start: true, boot: true, hooks: true };
let r = run(A, ['--plan', 'install', '--payload', P1, '--opts', JSON.stringify(ALL)]);
ok(r.j.ok && r.j.preview.hooksDiff.length === 4 && r.j.preview.steps.length === 12 && !ex(path.join(prog(A), 'nexus.exe')) && !ex(lnk.desk(A)) && sha(sj(A)) === s0, 'plan: 12 steps (incl. Setup copy + Apps & features record) + 4-line hooks diff shown, nothing written (' + (r.j.error || r.j.preview?.steps.length) + ')');
r = act(A, 'install', P1, ALL);
const m1 = ex(mf(A)) ? man(A) : {};
ok(r.code === 0 && rd(path.join(prog(A), 'core.dll')) === 'CORE1' && ex(path.join(prog(A), 'tracker', 'tracker.js')), 'install: program files placed (' + (r.j.error || '') + ')');
ok(target(lnk.desk(A)).toLowerCase() === path.join(prog(A), 'nexus.exe').toLowerCase() && target(lnk.start(A)).toLowerCase() === path.join(prog(A), 'nexus.exe').toLowerCase(), 'Desktop + Start menu shortcuts point at the installed nexus.exe');
ok(ex(runv(A)) && rd(runv(A)) === `"${path.join(prog(A), 'nexus.exe')}" --hidden`, 'Start with Windows: Run value "NEXUS" = "<nexus.exe>" --hidden (mock registry in the test root)');
const S1 = JSON.parse(rd(sj(A)));
ok(Object.keys(S1).join() === 'permissions,model,hooks,zeta' && S1.hooks.SessionStart.length === 2 && JSON.stringify(S1.hooks.SessionStart[0]) === JSON.stringify(USER_HOOK) && ['UserPromptSubmit', 'Stop', 'PreCompact'].every(e => S1.hooks[e].length === 1 && /tracker\/tracker\.js" (hook|snap)$/.test(S1.hooks[e][0].hooks[0].command)), 'hooks: 4 NEXUS entries added; user hook, other settings and key order kept');
const bk = r.j.backup && fs.readdirSync(r.j.backup).find(f => f.endsWith('settings.json'));
ok(bk && sha(path.join(r.j.backup, bk)) === s0, 'settings.json backed up first (verified copy of the original)');
ok(m1.mode === 'new' && m1.dataCreated === true && m1.hooks.length === 4 && m1.options.boot === true && m1.files[Object.keys(m1.files).find(k => /settings\.json$/.test(k))] === undefined, 'manifest: mode new, data created by NEXUS, 4 hooks recorded, settings.json not listed as a NEXUS file');
ok(run(A, ['--detect']).j.install.status === 'installed', 'detect after install: installed');
ok(act(A, 'install', P1, ALL).j.error?.includes('already installed'), 'second install refused: use Update / Repair / Uninstall');

// 2. nothing ticked: no shortcut, no startup entry, settings.json not created
const B = root('plain'); const PB = pkg(B, 'pkg', { 'core.dll': 'C' });
r = act(B, 'install', PB, {});
ok(r.code === 0 && !ex(lnk.desk(B)) && !ex(lnk.start(B)) && !ex(runv(B)) && !ex(sj(B)), 'nothing ticked: no shortcuts, no startup entry, no settings.json');

// 3. adopt mode (existing tracker): hooks never written even if asked, data deletion never offered
const C = root('adopt'); put(path.join(home(C), '.claude', 'token-tracker', 'tracker.js'), '//'); put(sj(C), JSON.stringify(settings, null, 2)); const sc = sha(sj(C));
put(path.join(data(C), 'projects.json'), '[]');
r = act(C, 'install', pkg(C, 'pkg', { 'core.dll': 'C', 'tracker/tracker.js': '//' }), ALL);
ok(r.code === 0 && sha(sj(C)) === sc && r.j.preview.mode === 'adopt' && r.j.preview.hooksDiff.length === 0 && man(C).mode === 'adopt', 'adopt mode: hooks asked for, settings.json untouched (hash same), mode adopt');
ok(act(C, 'uninstall', null, { delData: true, typed: 'DELETE' }).j.error?.includes('did not create'), 'adopt mode: deleting data refused even with DELETE typed');
ok(ex(path.join(data(C), 'projects.json')), 'adopt data still there');

// 4. hash re-check: crash before the hooks step, user edits settings.json, Resume stops; Roll back keeps the user's edit
const D = root('recheck'); put(sj(D), JSON.stringify(settings, null, 2));
r = act(D, 'install', pkg(D, 'pkg', { 'core.dll': 'C', 'tracker/tracker.js': '//' }), { hooks: true }, ['--crash-after', '0']);
ok(r.code !== 0 && ex(path.join(prog(D), 'core.dll')), 'crash after step 1 (process aborted)');
put(sj(D), JSON.stringify({ ...settings, model: 'user changed' }, null, 2)); const sd = sha(sj(D));
r = run(D, ['--resume']);
ok(r.code === 1 && /changed since Setup started/.test(r.j.error) && sha(sj(D)) === sd, 'Resume: settings.json changed since the diff was made, so it stops and writes nothing');
r = run(D, ['--rollback']);
ok(r.code === 0 && !ex(path.join(prog(D), 'core.dll')) && sha(sj(D)) === sd, 'Roll back: program files removed, the edited settings.json kept');

// 5. Update (code only): changed file replaced + backed up, dropped file removed, user-changed file kept, data + settings untouched
put(path.join(data(A), 'projects.json'), '["mine"]'); const dataSha = sha(path.join(data(A), 'projects.json')), sA = sha(sj(A));
fs.writeFileSync(path.join(prog(A), 'extra.dll'), 'user changed');
ok(act(A, 'update', P1, {}).j.error?.includes('already this version'), 'Update to the same version refused (Repair instead)');
fs.writeFileSync(mf(A), JSON.stringify({ ...man(A), app: '9.9.9' }));
ok(act(A, 'update', P1, {}).j.error?.includes('never downgrades'), 'newer NEXUS recorded: Update refused (no downgrade)');
// detect says "newer" when nothing contradicts the record (a nexus.exe without a version resource, as in test-m6c)
const F = root('newer'), PF = path.join(F, 'pkg'); put(path.join(PF, 'nexus.exe'), 'no version resource');
act(F, 'install', PF, {}); fs.writeFileSync(mf(F), JSON.stringify({ ...man(F), app: '9.9.9' }));
ok(run(F, ['--detect']).j.install.status === 'newer' && act(F, 'update', PF, {}).j.error?.includes('never downgrades'), 'detect: newer than this Setup; Update refused');
fs.writeFileSync(mf(A), JSON.stringify({ ...man(A), app: '0.0.0' }));
const P2 = pkg(A, 'pkg2', { 'core.dll': 'CORE2', 'zz.dll': 'ZZ2', 'new.dll': 'NEW', 'tracker/tracker.js': '// tracker' });
// 5a. a locked file makes the update fail part way: everything rolls back to the old version
const lockP = cp.spawn('powershell', ['-NoProfile', '-Command', `$f=[IO.File]::Open('${path.join(prog(A), 'zz.dll')}','Open','Read','Read'); Start-Sleep 25; $f.Close()`], { stdio: 'ignore' });
cp.execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 1500']);
r = act(A, 'update', P2, {});
lockP.kill();
ok(r.code === 1 && r.j.rolledBack === true && rd(path.join(prog(A), 'core.dll')) === 'CORE1' && ex(path.join(prog(A), 'old.dll')) && !ex(path.join(prog(A), 'new.dll')) && man(A).app === '0.0.0', 'Update fails on a locked file: rolled back at once, old files + old version back (' + (r.j.error || '').slice(0, 60) + ')');
cp.execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 800']);
r = act(A, 'update', P2, {});
const m2 = man(A), key = f => Object.keys(m2.files).find(k => k.toLowerCase() === path.join(prog(A), f).toLowerCase());
ok(r.code === 0 && rd(path.join(prog(A), 'core.dll')) === 'CORE2' && rd(path.join(prog(A), 'new.dll')) === 'NEW' && !ex(path.join(prog(A), 'old.dll')) && rd(path.join(prog(A), 'extra.dll')) === 'user changed', 'Update: core.dll replaced, new.dll added, old.dll removed, user-changed extra.dll kept (' + (r.j.error || '') + ')');
ok(r.j.preview.kept.some(k => k.path.endsWith('extra.dll')) && m2.files[key('core.dll')].owner === 'nexus' && m2.app === r.j.preview.version, 'Update: kept file listed, replaced file stays NEXUS-owned, new version recorded');
const bk2 = fs.readdirSync(r.j.backup).find(f => f.endsWith('core.dll'));
ok(bk2 && rd(path.join(r.j.backup, bk2)) === 'CORE1', 'Update: old core.dll in a verified backup');
ok(sha(path.join(data(A), 'projects.json')) === dataSha && sha(sj(A)) === sA && ex(lnk.desk(A)), 'Update: data, settings.json, shortcuts untouched');

// 6. Repair: missing shortcut + damaged file restored, a user file in the program folder left alone; then nothing to do
fs.rmSync(lnk.desk(A)); fs.writeFileSync(path.join(prog(A), 'core.dll'), 'damaged'); put(path.join(prog(A), 'my-notes.txt'), 'mine');
r = act(A, 'repair', P2, {});
ok(r.code === 0 && ex(lnk.desk(A)) && rd(path.join(prog(A), 'core.dll')) === 'CORE2' && rd(path.join(prog(A), 'my-notes.txt')) === 'mine' && r.j.preview.steps.length === 2, 'Repair: shortcut recreated, damaged core.dll restored, user file untouched (' + (r.j.error || r.j.preview?.steps.length) + ')');
ok(act(A, 'repair', P2, {}).j.log?.[0].startsWith('nothing to do'), 'Repair again: nothing to do');

// 7. Uninstall (default): program files, shortcuts, startup entry, install record go; data, vault note, changed file, hooks stay
ok(run(A, ['--new-vault', path.join(home(A), 'Documents', 'My Notes')]).code === 0, 'new vault made (starter note is NEXUS-owned)');
r = act(A, 'uninstall', null, {});
ok(r.code === 0 && !ex(path.join(prog(A), 'nexus.exe')) && !ex(lnk.desk(A)) && !ex(lnk.start(A)) && !ex(runv(A)) && !ex(mf(A)), 'Uninstall: program files, shortcuts, startup entry, install record removed (' + (r.j.error || '') + ')');
ok(ex(path.join(data(A), 'projects.json')) && ex(path.join(home(A), 'Documents', 'My Notes', 'Welcome to NEXUS.md')) && rd(path.join(prog(A), 'extra.dll')) === 'user changed' && rd(path.join(prog(A), 'my-notes.txt')) === 'mine' && sha(sj(A)) === sA, 'Uninstall kept: data, vault note, user-changed file, user file, settings.json (hooks not ticked)');
ok(run(A, ['--detect']).j.install === null, 'detect after uninstall: not installed');
// 8. Roll back the uninstall: everything back, detect installed again
r = run(A, ['--rollback']);
ok(r.code === 0 && ex(path.join(prog(A), 'nexus.exe')) && ex(lnk.desk(A)) && ex(runv(A)) && ex(mf(A)) && man(A).hooks.length === 4, 'Roll back the uninstall: files, shortcuts, startup entry, install record back');
fs.rmSync(path.join(prog(A), 'extra.dll')); // the user's own change, gone so detection can verify again
ok(['installed', 'unverified'].includes(run(A, ['--detect']).j.install?.status), 'detect after recovery: install found again');
// 9. Uninstall with hooks + data: DELETE must be typed; only NEXUS hook entries go; data backed up and recoverable
r = act(A, 'uninstall', null, { rmHooks: true, delData: true, typed: 'delete' });
ok(r.code === 1 && /Type DELETE/.test(r.j.error) && ex(mf(A)) && ex(path.join(data(A), 'projects.json')), 'data removal without the exact word DELETE refused, nothing changed');
r = run(A, ['--plan', 'uninstall', '--opts', JSON.stringify({ rmHooks: true, delData: true, typed: 'DELETE' })]);
ok(r.j.ok && r.j.preview.data.length === 1 && r.j.preview.data[0].includes('%USERPROFILE%') && r.j.preview.hooksDiff.length === 4 && r.j.preview.hooksDiff.every(l => l.startsWith('- ')), 'uninstall plan lists exactly the data file that would go (redacted) + the 4 hook removals');
r = act(A, 'uninstall', null, { rmHooks: true, delData: true, typed: 'DELETE' });
const S2 = JSON.parse(rd(sj(A)));
ok(r.code === 0 && !ex(path.join(data(A), 'projects.json')) && ex(path.join(data(A), 'setup-journal.json')), 'typed DELETE: NEXUS data removed (journal kept for recovery)');
ok(JSON.stringify(S2) === JSON.stringify(settings), 'hooks removed: settings.json back to exactly the user\'s own settings + hook');
r = run(A, ['--rollback']);
ok(r.code === 0 && rd(path.join(data(A), 'projects.json')) === '["mine"]' && JSON.parse(rd(sj(A))).hooks.Stop?.length === 1 && ex(mf(A)), 'recovery: Roll back brings the data, the hooks and the install back');

// 10. uninstall crash + Resume finishes it
const E = root('ucrash'); act(E, 'install', pkg(E, 'pkg', { 'a.dll': 'A', 'b.dll': 'B' }), { desk: true });
r = act(E, 'uninstall', null, {}, ['--crash-after', '0']);
ok(r.code !== 0 && ex(mf(E)), 'uninstall crash after its first step');
r = run(E, ['--resume']);
ok(r.code === 0 && !ex(mf(E)) && !ex(path.join(prog(E), 'nexus.exe')) && !ex(lnk.desk(E)), 'Resume finishes the uninstall');

ok(rstate() === r0, 'real profile files, real Desktop NEXUS.lnk and real HKCU Run "NEXUS" value unchanged');
console.log(JSON.stringify({ pass, fail }, null, 1)); process.exitCode = fail.length ? 1 : 0;
