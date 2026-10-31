// M6b exe check: node setup/test-m6b.js [--no-picker]. Unit tests: `cargo test --offline` in setup/. Regression: node setup/test-m6a.js.
// Throwaway roots in %TEMP% only. Covers: install-folder lock (also after a kill), real crash mid-step (abort) → Resume / Roll back,
// consent-only replace with verified backup, and the real Windows folder picker (driven by window messages to that dialog's own controls; no keystrokes).
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const EXE = path.join(__dirname, '../src-tauri/target/release/nexus-setup.exe');
const env = { ...process.env, NEXUS_SETUP_NOBOX: '1' }, sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m);
const root = tag => require('./tmproot')('nexus-m6b-' + tag + '-');
const run = (T, ...a) => { const r = cp.spawnSync(EXE, ['--root', T, ...a], { env, timeout: 60000, encoding: 'utf8' }); let j = null; try { j = JSON.parse(r.stdout.trim().split('\n').pop()) } catch { } return { code: r.status, j, err: r.stderr } };
const home = T => path.join(T, 'Users', 'nexususer'), prog = T => path.join(home(T), 'AppData', 'Local', 'Programs', 'NEXUS');
const rd = f => { try { return fs.readFileSync(f, 'utf8') } catch { return null } };
function plan(T, name, files) { // files: [[target, body, replace]]
  const pd = path.join(T, 'payload-' + name); fs.mkdirSync(pd, { recursive: true });
  const ops = files.map(([t, body, replace], i) => { const src = path.join(pd, i + '.bin'); fs.writeFileSync(src, body); return { path: path.join(prog(T), t), src, replace: !!replace } });
  const f = path.join(T, name + '.json'); fs.writeFileSync(f, JSON.stringify(ops)); return f;
}
(async () => {
  // 1. lock: a running Setup holds the folder; a second one is refused (exit 3); another folder is fine; a killed Setup frees it
  const A = root('lock'), B = root('lock2'), gui = cp.spawn(EXE, ['--root', A], { env, stdio: 'ignore' });
  for (let t = 0; t < 80 && !/ui ready/.test(rd(path.join(A, 'setup.log')) || ''); t++) await sleep(250);
  let r = run(A, '--resume');
  ok(r.code === 3 && /Another NEXUS Setup/.test(r.err), 'second Setup on the same folder refused (exit ' + r.code + ')');
  ok(run(B, '--resume').code === 1, 'other folder not blocked (no open run → exit 1)');
  cp.spawnSync('taskkill', ['/PID', String(gui.pid), '/T', '/F']); await sleep(500);
  ok(run(A, '--resume').code === 1, 'lock released after the first Setup was killed');

  // 2. existing file without permission: refused, untouched, no backup
  const T = root('crash'); fs.mkdirSync(prog(T), { recursive: true }); fs.writeFileSync(path.join(prog(T), 'config.json'), 'USER');
  r = run(T, '--run', plan(T, 'noperm', [['config.json', 'NEW']]));
  ok(r.code === 1 && /only with your permission/.test(r.j?.error) && rd(path.join(prog(T), 'config.json')) === 'USER' && !fs.existsSync(path.join(home(T), 'NEXUS Backups')), 'existing file without permission: refused, unchanged, no backup');

  // 3. real crash mid-run (abort after step 1 is written), new run refused, Resume finishes, backup holds the original
  const P1 = plan(T, 'p1', [['nexus.exe', 'APP'], ['core.dll', 'DLL'], ['config.json', 'NEW', true], ['readme.txt', 'TXT']]);
  r = run(T, '--run', P1, '--crash-after', '1');
  ok(r.code !== 0 && r.code !== 1 && rd(path.join(prog(T), 'core.dll')) === 'DLL' && !fs.existsSync(path.join(prog(T), 'readme.txt')), 'crash after step 1: process died (code ' + r.code + '), later steps not run');
  ok(run(T, '--run', P1).j?.error?.includes('unfinished'), 'new run refused while the crashed one is open');
  r = run(T, '--resume');
  ok(r.code === 0 && r.j.log.filter(l => !l.startsWith('version ')).length === 3 && /already written/.test(r.j.log[0]) && /^version .* recorded$/.test(r.j.log.at(-1)), 'Resume: step 1 recognised as written, rest done (' + r.j?.log?.length + ')');
  ok(['nexus.exe', 'core.dll', 'readme.txt'].every((f, i) => rd(path.join(prog(T), f)) === ['APP', 'DLL', 'TXT'][i]) && rd(path.join(prog(T), 'config.json')) === 'NEW', 'all files in place after Resume');
  const bdir = fs.readdirSync(path.join(home(T), 'NEXUS Backups')).map(d => path.join(home(T), 'NEXUS Backups', d));
  ok(bdir.length === 1 && rd(path.join(bdir[0], '000_config.json')) === 'USER' && JSON.parse(rd(path.join(bdir[0], 'manifest.json'))).files.length === 1, 'backup made before the change, original + manifest inside');
  const man = JSON.parse(rd(path.join(prog(T), 'install-manifest.json'))).files, own = o => Object.entries(man).filter(([, v]) => v.owner === o).length;
  ok(own('nexus') === 3 && own('external') === 1, 'manifest: 3 NEXUS-owned, replaced pre-existing file stays external');

  // 4. second crash, user edits a written file meanwhile, Roll back: created file removed, replaced file restored, edited file kept
  const P2 = plan(T, 'p2', [['extra.txt', 'X'], ['readme.txt', 'TXT2', true], ['late.txt', 'L']]);
  r = run(T, '--run', P2, '--crash-after', '1');
  fs.writeFileSync(path.join(prog(T), 'extra.txt'), 'user edited');
  r = run(T, '--rollback');
  ok(r.code === 0 && rd(path.join(prog(T), 'readme.txt')) === 'TXT' && rd(path.join(prog(T), 'extra.txt')) === 'user edited' && !fs.existsSync(path.join(prog(T), 'late.txt')), 'Roll back: replaced file restored, user-edited file kept, unrun step untouched');
  ok(fs.readdirSync(path.join(home(T), 'NEXUS Backups')).length === 2, 'each run with replacements gets its own backup folder (none overwritten)');

  // 5. real folder picker
  if (!process.argv.includes('--no-picker')) {
    const want = path.join(home(T), 'Documents', 'Game'); fs.mkdirSync(want, { recursive: true });
    const pick = async (dir) => {
      const p = cp.spawn(EXE, ['--root', T, '--pick', 'folder'], { env }); let so = ''; p.stdout.on('data', d => so += d);
      const ps = `Add-Type -Name D -Namespace U -MemberDefinition @'
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern System.IntPtr FindWindow(string c, string t);
[DllImport("user32.dll")] public static extern int GetDlgCtrlID(System.IntPtr h);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool EnumChildWindows(System.IntPtr p, EnumProc f, System.IntPtr l);
public delegate bool EnumProc(System.IntPtr h, System.IntPtr l);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern System.IntPtr SendMessage(System.IntPtr h, int m, System.IntPtr w, string l);
public static System.IntPtr Find(System.IntPtr p, int id, string cls) { System.IntPtr r = System.IntPtr.Zero; EnumChildWindows(p, (h, l) => { var b = new System.Text.StringBuilder(64); GetClassName(h, b, 64); if (GetDlgCtrlID(h) == id && (cls == null || b.ToString() == cls)) { r = h; return false; } return true; }, System.IntPtr.Zero); return r; }
public static System.IntPtr Edit(System.IntPtr p) { System.IntPtr c = Find(p, 1152, null), r = System.IntPtr.Zero; EnumChildWindows(c, (h, l) => { var b = new System.Text.StringBuilder(64); GetClassName(h, b, 64); if (b.ToString() == "Edit") { r = h; return false; } return true; }, System.IntPtr.Zero); return r == System.IntPtr.Zero ? c : r; }
'@
for ($i = 0; $i -lt 40; $i++) { $w = [U.D]::FindWindow('#32770', 'NEXUS Setup: choose a folder'); if ($w -ne [IntPtr]::Zero) { break }; Start-Sleep -Milliseconds 250 }
if ($w -eq [IntPtr]::Zero) { 'NOWIN'; exit }
Start-Sleep -Milliseconds 800
$path = __PATH__
if ($path) { [void][U.D]::SendMessage([U.D]::Edit($w), 0x000C, [IntPtr]::Zero, $path); [void][U.D]::SendMessage([U.D]::Find($w, 1, 'Button'), 0x00F5, [IntPtr]::Zero, $null) }
else { [void][U.D]::SendMessage([U.D]::Find($w, 2, 'Button'), 0x00F5, [IntPtr]::Zero, $null) }
'SENT'`;
      const s = cp.spawnSync('powershell', ['-NoProfile', '-Command', ps.replace('__PATH__', "'" + (dir || '').replace(/'/g, "''") + "'")], { encoding: 'utf8', timeout: 30000 }).stdout.trim();
      for (let t = 0; t < 20 && p.exitCode === null; t++) await sleep(250);
      if (p.exitCode === null) cp.spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F']);
      let j = null; try { j = JSON.parse(so.trim()) } catch { } return { s, j };
    };
    let k = await pick(want);
    ok(k.s === 'SENT' && k.j?.ok && k.j.result.path.toLowerCase() === want.toLowerCase(), 'picker: folder inside the test root chosen (' + k.s + ' ' + JSON.stringify(k.j?.result) + ')');
    k = await pick(os.tmpdir());
    ok(k.s === 'SENT' && k.j && !k.j.ok && /inside the test root/.test(k.j.result?.error), 'picker: folder outside the test root refused (' + JSON.stringify(k.j?.result) + ')');
    k = await pick(null);
    ok(k.s === 'SENT' && k.j && k.j.result === null, 'picker: Cancel = nothing chosen');
  }
  console.log(JSON.stringify({ pass, fail }, null, 1)); process.exitCode = fail.length ? 1 : 0;
})();
