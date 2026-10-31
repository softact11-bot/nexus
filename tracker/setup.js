// M0 Setup preview: read-only detection of what NEXUS Setup.exe would find on this PC.
// Never installs, writes or deletes; only version queries, file existence, registry reads and settings.json reads.
// Paths in the answer have the home folder replaced by %USERPROFILE% (privacy rule §26).
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const HOME = os.homedir(), LAD = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), AD = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const red = s => String(s).split(HOME).join('%USERPROFILE%');
const run = (f, a, ms = 8000) => new Promise(ok => cp.execFile(f, a, { windowsHide: true, timeout: ms }, (e, o) => ok(e ? null : String(o).trim())));
const ex = f => { try { return fs.statSync(f).isFile() } catch { return false } };
const dir = f => { try { return fs.statSync(f).isDirectory() } catch { return false } };
const ver = (s, re) => (s && (s.match(re) || [])[1]) || null;
let cache = { at: 0, v: null, wait: null };

async function detect() {
  const [node, claude, git, uv, tools, rust, py, uvpy, wv, lx] = await Promise.all([
    run('node', ['-v']), run('claude', ['--version']), run('git', ['--version']), run('uv', ['--version']), run('uv', ['tool', 'list']), run('rustc', ['--version']), run('python', ['--version']), run('uv', ['python', 'list', '--only-installed']),
    run('reg', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', '/v', 'pv']),
    run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'])]);
  const obsExe = path.join(LAD, 'Programs', 'Obsidian', 'Obsidian.exe'), obs = ex(obsExe);
  const obsVer = obs ? await run('powershell', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${obsExe}').VersionInfo.ProductVersion`]) : null;
  // registered vaults: read obsidian.json + stat each folder; nothing inside a vault is opened except listing .obsidian/plugins
  let vl = null; try { vl = Object.values(JSON.parse(fs.readFileSync(path.join(AD, 'obsidian', 'obsidian.json'), 'utf8')).vaults || {}).map(v => {
    const d = path.join(v.path, '.obsidian'); let plugins = 0; try { plugins = fs.readdirSync(path.join(d, 'plugins')).length } catch { }
    return { name: path.basename(v.path), path: red(v.path), exists: dir(v.path), dot: dir(d), plugins, reg: true } }) } catch { }
  const vaults = vl && vl.length;
  const pyv = ver(py, /Python (\S+)/), uvPy = ver(uvpy, /cpython-(\d[\d.]*)/);
  const deps = [
    { id: 'webview2', name: 'Microsoft Edge WebView2', role: 'required', found: !!ver(wv, /pv\s+REG_SZ\s+(\S+)/), version: ver(wv, /pv\s+REG_SZ\s+(\S+)/), src: 'Built into Windows 11 (Microsoft)', check: 'Ships with Windows' },
    { id: 'node', name: 'Node.js', role: 'required', found: !!node, version: ver(node, /v?(\d[\w.]*)/), src: 'nodejs.org (LTS installer)', check: 'SHA-256 vs SHASUMS256.txt' },
    { id: 'claude', name: 'Claude Code', role: 'required', found: !!claude, version: ver(claude, /^(\S+)/), src: 'claude.ai/install.ps1 (Anthropic)', check: 'Official install script over HTTPS' },
    { id: 'obsidian', name: 'Obsidian', role: 'optional', found: obs, version: obsVer, note: vaults != null ? vaults + ' vault' + (vaults === 1 ? '' : 's') + ' registered' : null, src: 'obsidian.md / official GitHub releases', check: 'Authenticode signature' },
    { id: 'python', name: 'Python', role: 'optional', found: !!(pyv || uvPy), version: pyv || uvPy, note: !pyv && uvPy ? 'managed by uv' : null, src: 'python.org, or a uv-managed Python', check: 'Authenticode / uv hashes' },
    { id: 'uv', name: 'uv (Python tool runner)', role: 'optional', found: !!uv, version: ver(uv, /uv (\S+)/), src: 'astral.sh/uv', check: 'SHA-256 from the release' },
    { id: 'graphify', name: 'Graphify', role: 'optional', found: /graphifyy/.test(tools || ''), version: ver(tools, /graphifyy v(\S+)/), src: 'PyPI graphifyy via uv (third party)', check: 'uv lockfile hashes', needs: 'uv' },
    { id: 'git', name: 'Git for Windows', role: 'optional', found: !!git, version: ver(git, /version (\S+)/), src: 'git-scm.com', check: 'Authenticode signature' }];
  const shells = [['Windows PowerShell', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'], ['PowerShell 7', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'], ['Command Prompt', 'C:\\Windows\\System32\\cmd.exe'], ['Git Bash', 'C:\\Program Files\\Git\\bin\\bash.exe']]
    .filter(s => ex(s[1])).map(s => s[0]);
  if (ex('C:\\Windows\\System32\\wsl.exe') && lx) shells.push('WSL'); // wsl.exe alone ships with Windows; a registered distro means it is usable
  // existing NEXUS install (this tracker folder) + its Claude Code hooks, counted only
  const T = __dirname; let projects = 0, hooks = 0, plist = [];
  try { const p = JSON.parse(fs.readFileSync(path.join(T, 'projects.json'), 'utf8')); plist = (Array.isArray(p) ? p : p.items || p.projects || []); projects = plist.length } catch { }
  // per project: name, folder, the vault it already links, whether a Graphify graph exists (file check only)
  plist = plist.map(p => ({ name: p.name, dir: red(p.dir), vault: p.obsidian ? red(p.obsidian) : '', graph: !!p.dir && ex(path.join(p.dir, 'graphify-out', 'graph.json')) }));
  try { const s = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'settings.json'), 'utf8')); for (const g of Object.values(s.hooks || {})) for (const m of g) for (const h of m.hooks || []) if (/token-tracker[\\/]tracker\.js/.test(h.command || '')) hooks++ } catch { }
  let disk = null; try { const s = fs.statfsSync(path.parse(LAD).root); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize } } catch { }
  return { at: Date.now(), readOnly: true, os: os.release(), rust: !!rust, deps, shells, disk, vaults: vl || [], graphifySkill: dir(path.join(HOME, '.claude', 'skills', 'graphify')),
    existing: fs.existsSync(path.join(T, 'tracker.js')) ? { dir: red(T), projects, plist, hooks, manifest: ex(path.join(T, 'install-manifest.json')), automations: ex(path.join(T, 'automations.json')) } : null,
    paths: { program: '%LOCALAPPDATA%\\Programs\\NEXUS', data: '%APPDATA%\\NEXUS', backups: '%USERPROFILE%\\NEXUS Backups' } };
}
// one detection at a time, cached 60 s (?refresh=1 forces a new one)
module.exports = (refresh, cb) => {
  if (!refresh && cache.v && Date.now() - cache.at < 60000) return cb(cache.v);
  if (cache.wait) return cache.wait.push(cb);
  cache.wait = [cb];
  detect().catch(e => ({ error: red(e.message) })).then(v => { const w = cache.wait; cache = { at: Date.now(), v, wait: null }; w.forEach(f => f(v)) });
};
