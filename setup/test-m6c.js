// M6c exe check: node setup/test-m6c.js. Unit tests: `cargo test --offline` in setup/. Regression: node setup/test-m6b.js --no-picker, node setup/test-m6a.js.
// Throwaway roots in %TEMP% only. Covers: read-only detection (root + real profile files unchanged), existing tracker install, a NEXUS placed by Setup
// (installed / outdated / unverified), component status (installed / missing / outdated / unverified), privacy redaction, new vault only in a new / empty folder.
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const EXE = path.join(__dirname, '../src-tauri/target/release/nexus-setup.exe');
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m);
const root = tag => require('./tmproot')('nexus-m6c-' + tag + '-');
const run = (T, args, extra = {}) => { const r = cp.spawnSync(EXE, ['--root', T, ...args], { env: { ...process.env, NEXUS_SETUP_NOBOX: '1', ...extra }, timeout: 60000, encoding: 'utf8' }); let j = null; try { j = JSON.parse(r.stdout.trim().split('\n').pop()) } catch { } return { code: r.status, j, out: r.stdout } };
const home = T => path.join(T, 'Users', 'nexususer'), prog = T => path.join(home(T), 'AppData', 'Local', 'Programs', 'NEXUS');
const put = (f, body) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body) };
const dep = (j, id) => j.deps.find(d => d.id === id) || {};
// every file under a folder with size + mtime (setup.log excluded: Setup's own log)
const snap = d => { const o = {}; const w = p => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) w(f); else if (e.name !== 'setup.log') { const s = fs.statSync(f); o[f] = s.size + ':' + s.mtimeMs } } }; w(d); return JSON.stringify(o) };
const H = os.homedir(), realFiles = [path.join(H, '.claude', 'settings.json'), path.join(H, '.claude', 'token-tracker', 'projects.json'), path.join(process.env.APPDATA, 'obsidian', 'obsidian.json')].filter(f => fs.existsSync(f));
const rstat = () => realFiles.map(f => fs.statSync(f).mtimeMs).join();

// 1. clean mock profile: nothing of the user's found in the profile, the run writes nothing, real profile files untouched
const A = root('clean'), r0 = rstat();
run(A, ['--detect']); const a0 = snap(A); let r = run(A, ['--detect']);
ok(r.code === 0 && r.j.readOnly && r.j.existing === null && r.j.install === null && dep(r.j, 'obsidian').status === 'missing' && r.j.vaults.length === 0, 'clean profile: no existing NEXUS, no Obsidian, no vaults');
ok(snap(A) === a0, 'detection wrote nothing in the test root');
ok(['webview2', 'node', 'claude', 'git'].every(id => dep(r.j, id).status), 'every component has a status (' + r.j.deps.map(d => d.id + '=' + d.status).join(' ') + ')');
ok(!r.out.includes(H), 'no real home path in the result (redacted to %USERPROFILE%)');

// 2. existing NEXUS (tracker), Claude Code hooks, Obsidian + vaults, all as fixtures in the mock profile
const B = root('found'), cl = path.join(home(B), '.claude'), tt = path.join(cl, 'token-tracker'), docs = path.join(home(B), 'Documents');
put(path.join(tt, 'tracker.js'), '//'); put(path.join(tt, 'automations.json'), '[]');
put(path.join(docs, 'Game', 'graphify-out', 'graph.json'), '{}');
put(path.join(tt, 'projects.json'), JSON.stringify([{ name: 'Game', dir: path.join(docs, 'Game'), obsidian: path.join(docs, 'Vault A') }, { name: 'Site', dir: path.join(docs, 'Site') }]));
const hook = c => ({ hooks: [{ type: 'command', command: c }] });
put(path.join(cl, 'settings.json'), JSON.stringify({ hooks: { Stop: [hook('node "' + tt + '\\tracker.js" stop')], UserPromptSubmit: [hook('node ' + tt.replace(/\\/g, '/') + '/tracker.js prompt'), hook('echo other')] } }));
for (const p of ['a', 'b', 'c']) fs.mkdirSync(path.join(docs, 'Vault A', '.obsidian', 'plugins', p), { recursive: true });
put(path.join(home(B), 'AppData', 'Roaming', 'obsidian', 'obsidian.json'), JSON.stringify({ vaults: { v1: { path: path.join(docs, 'Vault A') }, v2: { path: path.join(docs, 'Gone') } } }));
put(path.join(home(B), 'AppData', 'Local', 'Programs', 'Obsidian', 'Obsidian.exe'), 'not a real exe');
run(B, ['--detect']); const b0 = snap(B); r = run(B, ['--detect']); const e = r.j?.existing || {}; // first start creates the M6b .setup.lock, so snapshot after it
ok(e.kind === 'tracker' && e.status === 'installed' && e.projects === 2 && e.hooks === 2 && e.automations && e.plist[0].graph && !e.plist[1].graph, 'existing tracker found: 2 projects, 2 NEXUS hooks (other hook ignored), graph only where one exists');
ok(e.dir === '%USERPROFILE%\\.claude\\token-tracker' && e.plist[0].vault === '%USERPROFILE%\\Documents\\Vault A', 'install paths redacted to %USERPROFILE%');
const va = r.j.vaults.find(v => v.name === 'Vault A'), vg = r.j.vaults.find(v => v.name === 'Gone');
ok(va?.exists && va.dot && va.plugins === 3 && vg && !vg.exists && dep(r.j, 'obsidian').note === '2 vaults registered', 'vaults read from obsidian.json: one valid (3 plugins), one missing folder');
ok(dep(r.j, 'obsidian').status === 'unverified' && dep(r.j, 'obsidian').found, 'Obsidian.exe without a version resource = unverified (kept, never reinstalled)');
ok(snap(B) === b0, 'detection changed no fixture file (tracker, settings.json, obsidian.json, vaults)');
fs.copyFileSync(EXE, path.join(home(B), 'AppData', 'Local', 'Programs', 'Obsidian', 'Obsidian.exe'));
ok(dep(run(B, ['--detect']).j, 'obsidian').status === 'installed', 'Obsidian.exe with a version resource = installed with its version');
put(path.join(tt, 'projects.json'), '{broken');
ok(run(B, ['--detect']).j.existing.status === 'unverified', 'unreadable projects.json = existing install unverified (not repaired)');

// 3. outdated / missing components: a PATH with only an old fake node
const bin = path.join(B, 'bin'); put(path.join(bin, 'node.cmd'), '@echo v16.20.0');
r = run(B, ['--detect'], { PATH: bin + ';' + path.join(process.env.SystemRoot, 'System32') });
ok(dep(r.j, 'node').status === 'outdated' && dep(r.j, 'node').version === '16.20.0' && dep(r.j, 'node').min === '18', 'Node 16 = outdated (needs 18+)');
ok(['claude', 'git', 'uv', 'graphify'].every(id => dep(r.j, id).status === 'missing' && !dep(r.j, id).found), 'tools not on PATH = missing');

// 4. NEXUS placed by Setup: installed (same version, files verified) → unverified (file changed) → outdated (older version)
const C = root('inst'), pd = path.join(C, 'payload'); put(path.join(pd, 'a'), 'APP'); put(path.join(pd, 'b'), 'DLL');
fs.writeFileSync(path.join(C, 'plan.json'), JSON.stringify([{ path: path.join(prog(C), 'nexus.exe'), src: EXE, replace: false }, { path: path.join(prog(C), 'core.dll'), src: path.join(pd, 'b'), replace: false }]));
ok(run(C, ['--run', path.join(C, 'plan.json')]).code === 0, 'fixture install through the M6b journal');
r = run(C, ['--detect']);
ok(r.j.install?.status === 'installed' && r.j.install.version === r.j.appVersion && r.j.install.owned === 2 && r.j.install.changed === 0, 'Setup install: installed, same version as this Setup, 2 files verified (' + JSON.stringify(r.j.install) + ')');
fs.writeFileSync(path.join(prog(C), 'core.dll'), 'tampered');
r = run(C, ['--detect']);
ok(r.j.install.status === 'unverified' && r.j.install.changed === 1 && fs.readFileSync(path.join(prog(C), 'core.dll'), 'utf8') === 'tampered', 'changed program file = unverified, file left as is');
fs.writeFileSync(path.join(prog(C), 'core.dll'), 'DLL'); fs.writeFileSync(path.join(prog(C), 'nexus.exe'), 'no version resource');
const mf = path.join(prog(C), 'install-manifest.json'), m = JSON.parse(fs.readFileSync(mf, 'utf8'));
m.files[Object.keys(m.files).find(k => k.endsWith('nexus.exe'))].sha256 = require('crypto').createHash('sha256').update('no version resource').digest('hex'); m.app = '0.0.0';
fs.writeFileSync(mf, JSON.stringify(m));
ok(run(C, ['--detect']).j.install.status === 'outdated', 'older installed version (manifest app 0.0.0) = outdated');

// 5. new vault: refused in an existing vault / non-empty folder, created in a new folder, Obsidian config never written
const oj = path.join(home(B), 'AppData', 'Roaming', 'obsidian', 'obsidian.json'), oj0 = fs.readFileSync(oj, 'utf8');
ok(!run(B, ['--new-vault', path.join(docs, 'Vault A', 'Sub')]).j.ok, 'new vault inside a registered vault refused');
ok(!run(B, ['--new-vault', path.join(docs, 'Game')]).j.ok, 'new vault in a non-empty folder refused');
r = run(B, ['--new-vault', path.join(docs, 'NEXUS Vault')]);
ok(r.j.ok && fs.existsSync(path.join(docs, 'NEXUS Vault', 'Welcome to NEXUS.md')) && r.j.result.open.startsWith('obsidian://open?path=') && fs.readFileSync(oj, 'utf8') === oj0 && !fs.existsSync(path.join(docs, 'NEXUS Vault', '.obsidian')), 'new vault created in a new folder; obsidian.json + .obsidian untouched; open link returned only');

ok(rstat() === r0, 'real profile files (settings.json, tracker projects.json, obsidian.json) unchanged');
console.log(JSON.stringify({ pass, fail }, null, 1)); process.exitCode = fail.length ? 1 : 0;
