// M2 tests: node test-config.js. Mock Windows users (alice, bob) in a temp folder; never touches real NEXUS, vault or Claude files.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const sp = require('./safepath'), bk = require('./backup'), cfg = require('./config');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-m2-')), U = path.join(T, 'Users'), SAVE = { ...process.env };
let pass = 0; const fail = []; const ok = (c, m) => c ? pass++ : fail.push(m);
const throws = (f, m) => { try { f(); fail.push(m + ' (did not throw)') } catch { pass++ } };
const mk = (...p) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d };
function as(u) { const h = mk(U, u); Object.assign(process.env, { USERPROFILE: h, APPDATA: mk(h, 'AppData', 'Roaming'), LOCALAPPDATA: mk(h, 'AppData', 'Local'), NEXUS_DATA: mk(h, 'AppData', 'Local', 'NEXUS'), CLAUDE_CONFIG_DIR: path.join(h, '.claude') }); delete process.env.NEXUS_PROJ; delete process.env.NEXUS_VAULT; return h }
try {
  const A = as('alice'), B = path.join(U, 'bob'); mk(B, 'secret');
  // path checks
  ok(!sp.check('C:\\').ok, 'drive root refused'); ok(!sp.check(A).ok, 'whole profile refused'); ok(!sp.check(process.env.LOCALAPPDATA).ok, 'AppData root refused');
  ok(!sp.check(SAVE.SystemRoot || 'C:\\Windows').ok, 'Windows refused'); ok(!sp.check(SAVE.ProgramFiles || 'C:\\Program Files').ok, 'Program Files refused');
  ok(!sp.check('\\\\server\\share\\x').ok, 'UNC refused'); ok(!sp.check('Documents\\x').ok, 'relative refused'); ok(!sp.check(path.join(B, 'secret')).ok, 'other user refused');
  ok(!sp.check(path.join(A, '.ssh', 'x')).ok, '.ssh refused'); ok(!sp.check(path.join(A, '.claude', 'x')).ok, '.claude refused for projects');
  ok(sp.check(mk(A, 'Documents', 'Game')).ok, 'normal folder ok'); ok(!sp.check(path.join(A, 'Documents', '..', '..', 'bob', 'secret')).ok, 'traversal to other user refused');
  ok(sp.check(path.join(A, 'Documents', 'New', 'Deep')).ok, 'not-yet-existing folder ok'); ok(!!sp.check(mk(A, 'OneDrive', 'Game')).warn, 'OneDrive warned');
  fs.symlinkSync(path.join(B, 'secret'), path.join(A, 'Documents', 'jn'), 'junction');
  ok(!sp.check(path.join(A, 'Documents', 'jn', 'x')).ok, 'junction into other user refused');
  const long = mk(A, 'Documents', 'A very long folder name'), short = cp.execSync(`cmd /c for %I in ("${long}") do @echo %~sI`, { encoding: 'utf8' }).trim();
  ok(short === long || sp.check(short).path.toLowerCase() === long.toLowerCase(), '8.3 short name resolves to the long path');
  // data folder: only inside the current user's profile
  ok(sp.check(process.env.NEXUS_DATA, 'data').ok, 'own data folder ok'); ok(!sp.check(mk(T, 'Shared', 'NEXUS'), 'data').ok, 'shared data folder refused');
  ok(!sp.check(path.join(B, 'AppData', 'Local', 'NEXUS'), 'data').ok, 'other user data folder refused');
  // protected files: guard throws
  const V = mk(A, 'Vaults', 'Main'); mk(V, '.obsidian');
  throws(() => sp.guard(path.join(V, '.obsidian', 'app.json'), [A + '\\Vaults']), '.obsidian write refused');
  throws(() => sp.guard(path.join(A, 'Documents', 'Game', 'graphify-out', 'graph.json'), [A + '\\Documents']), 'graphify-out write refused');
  throws(() => sp.guard(path.join(A, '.claude', 'settings.json'), [A]), 'Claude settings write refused');
  throws(() => sp.guard(path.join(process.env.APPDATA, 'obsidian', 'obsidian.json'), [A]), 'obsidian.json write refused');
  throws(() => sp.guard(path.join(B, 'x.json'), [process.env.NEXUS_DATA]), 'write outside allowed roots refused');
  throws(() => sp.guard(path.join(A, 'Documents', 'jn', 'x.json'), [path.join(A, 'Documents')]), 'write through junction refused');
  ok(!!sp.guard(path.join(process.env.NEXUS_DATA, 'x.json'), [process.env.NEXUS_DATA]), 'write inside data ok');
  // backups + atomic write + journal
  const D = cfg.dataDir(), f = path.join(D, 't.json');
  ok(bk.writeJSON(f, { a: 1 }, D) === null, 'first write: nothing to back up');
  const b1 = bk.writeJSON(f, { a: 2 }, D, 't'), b2 = bk.writeJSON(f, { a: 3 }, D, 't'), man = JSON.parse(fs.readFileSync(path.join(b1, 'manifest.json')));
  ok(b1 !== b2 && fs.existsSync(b1) && fs.existsSync(b2), 'each backup is a new folder'); ok(JSON.parse(fs.readFileSync(path.join(b1, man.files[0].to))).a === 1, 'backup holds the old version');
  ok(bk.sha(fs.readFileSync(path.join(b1, man.files[0].to))) === man.files[0].sha256, 'backup hash verified'); ok(JSON.parse(fs.readFileSync(f)).a === 3, 'write landed');
  ok(!fs.readdirSync(D).some(x => /\.tmp/.test(x)), 'no temp files left');
  const j = new bk.Journal(path.join(D, 'j.json'), D); j.begin('s1', { x: 1 }); ok(j.open().length === 1, 'journal open step'); j.done('s1'); ok(j.open().length === 0, 'journal step done');
  // vault links: no overlap between projects
  const items = [{ id: 'a', name: 'Game A', vault: V, vaultFolder: 'Game A' }];
  ok(cfg.validateLink(items, 'b', { vault: V, vaultFolder: 'Game B' }).ok, 'same vault, separate folder ok');
  ok(!cfg.validateLink(items, 'b', { vault: V, vaultFolder: 'Game A/sub' }).ok, 'folder inside another project refused');
  ok(!cfg.validateLink(items, 'b', { vault: V }).ok, 'whole vault over a project folder refused');
  ok(!cfg.validateLink(items, 'b', { vault: V, vaultFolder: '../x' }).ok, '.. folder refused'); ok(!cfg.validateLink(items, 'b', { vault: V, vaultFolder: '.obsidian' }).ok, 'hidden folder refused');
  ok(!cfg.validateLink(items, 'b', { vault: mk(A, 'NotAVault') }).ok, 'non-vault refused'); ok(cfg.validateLink(items, 'a', { vault: V, vaultFolder: 'Game A' }).ok, 'own link re-saved ok');
  const P = { dir: mk(A, 'Desktop', 'my-game') };
  ok(!cfg.validateSettings(P, { graph: { mode: 'graphify', out: path.join(B, 'g') } }).ok, 'graph data in other user refused');
  ok(cfg.validateSettings(P, { graph: { mode: 'graphify', out: path.join(P.dir, 'graphify-out') }, sync: { mode: 'manual', cmd: 'bash sync_docs.sh' } }).ok, 'graph inside project ok');
  ok(!cfg.validateSettings(P, { sync: { mode: 'always' } }).ok, 'bad sync mode refused');
  // migration (mock this-PC layout)
  fs.writeFileSync(path.join(P.dir, 'sync_docs.sh'), 'V="$HOME/Desktop/VAULT/My Vault/Demo Game"\n'); mk(A, 'Desktop', 'VAULT', 'My Vault', '.obsidian');
  const pj = { items: [{ id: 'p1', dir: P.dir, name: 'Spooky', tags: ['Roblox'] }, { id: 'p2', dir: mk(A, 'Other'), name: 'Other' }], dismissed: ['x'] };
  fs.writeFileSync(path.join(D, 'projects.json'), JSON.stringify(pj));
  const pl = cfg.plan(); ok(pl.needed && pl.config.active === 'p1' && pl.fields.p1.vaultFolder === 'Demo Game', 'plan from today\'s values');
  ok(!fs.existsSync(cfg.file()), 'plan writes nothing');
  const m = cfg.migrate(), after = JSON.parse(fs.readFileSync(path.join(D, 'projects.json')));
  ok(m.res === 'ok' && fs.existsSync(m.backup), 'migration backed up projects.json'); ok(after.items[0].vault && after.items[0].tags[0] === 'Roblox' && after.dismissed[0] === 'x', 'fields added, old ones kept');
  ok(after.items[1].vault === undefined, 'other project untouched'); ok(cfg.load().active === 'p1', 'config written');
  ok(cfg.settings('p2').sync.mode === 'off', 'missing fields = defaults');
  const snapA = fs.readFileSync(path.join(D, 'projects.json'), 'utf8'); ok(cfg.migrate().res === 'nothing to do' && fs.readFileSync(path.join(D, 'projects.json'), 'utf8') === snapA, 'second migration changes nothing');
  // per-user isolation: bob sees nothing of alice
  as('bob'); ok(cfg.load() === null && cfg.projects === undefined && cfg.active() === null, 'bob has no config'); ok(cfg.dataDir() !== D, 'bob has his own data folder');
  process.env.NEXUS_DATA = D; throws(() => cfg.dataDir(), "bob can't point NEXUS at alice's data");
  throws(() => bk.writeJSON(path.join(D, 'x.json'), {}, D), "bob can't write alice's data");
  // the program folder of a shared install is never the data folder
  delete process.env.NEXUS_DATA; ok(sp.within(process.env.USERPROFILE, cfg.dataDir()), 'default data folder inside own profile');
} catch (e) { fail.push('crash: ' + e.stack.split('\n').slice(0, 3).join(' | ')) }
finally { for (const k of Object.keys(process.env)) if (!(k in SAVE)) delete process.env[k]; Object.assign(process.env, SAVE); fs.rmSync(T, { recursive: true, force: true }) }
console.log(JSON.stringify({ pass, fail }, null, 1)); process.exit(fail.length ? 1 : 0);
