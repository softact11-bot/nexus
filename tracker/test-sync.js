// M3 sync engine tests: node test-sync.js. Mock users alice / bob, mock vaults and projects in a temp folder; never touches real data.
// Covers: first-sync preview writes nothing, push / pull / merge / conflict, damaged ancestor, encoding + line endings, missing files,
// changed-since-preview, refusals (.., junctions, graphify-out, other user, bad names), lock (another process), atomic writes,
// verified + recoverable backups, modes, history cap, no deletes, privacy between users and projects.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), crypto = require('crypto');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sync-')), SAVE = { ...process.env };
let pass = 0; const fail = []; const ok = (c, m) => c ? pass++ : fail.push(m);
const mk = (...p) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d };
const W = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }, R = f => fs.readFileSync(f, 'utf8');
const sp = require('./safepath'), sha = b => crypto.createHash('sha256').update(b).digest('hex');
const tree = d => { const o = {}; const go = x => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isSymbolicLink()) o[p] = 'link'; else if (e.isDirectory()) go(p); else o[p] = sha(fs.readFileSync(p)) } }; if (fs.existsSync(d)) go(d); return o };
const user = n => { const H = mk(T, 'Users', n), D = mk(H, 'AppData', 'Local', 'NEXUS');
  Object.assign(process.env, { USERPROFILE: H, APPDATA: mk(H, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(H, 'AppData', 'Local'), NEXUS_DATA: D, CLAUDE_CONFIG_DIR: path.join(H, '.claude') }); return { H, D } };
try {
  const { H, D } = user('alice'), S = require('./sync.js');
  const V = mk(H, 'Vaults', 'Main'); mk(V, '.obsidian'); W(path.join(V, '.obsidian', 'app.json'), '{}');
  const PA = mk(H, 'Games', 'A'), GA = mk(V, 'Game A'); W(path.join(GA, 'Other note.md'), '# mine, not synced\n');
  W(path.join(PA, 'PROJECT_MEMORY.md'), '# A rules\nline 2\nline 3\nline 4\nline 5\n'); W(path.join(PA, 'PROJECT_DOCS.md'), '# Docs\n'); W(path.join(PA, 'docs', 'Spec.md'), '# Spec\n');
  const pa = { id: 'pa', name: 'Game A', dir: PA, vault: V, vaultFolder: 'Game A', sync: { mode: 'manual', cmd: '' } };
  const vf = n => path.join(GA, n + '.md'), act = (pl, n) => pl.items.find(i => i.note === n)?.action;
  // 1. first sync: preview only, nothing written anywhere
  const t0 = { ...tree(PA), ...tree(V), ...tree(D) }; let pl = S.plan(pa);
  ok(pl.first && pl.items.length === 3 && pl.items.every(i => i.action === 'create-vault'), 'first sync preview lists 3 new notes ' + JSON.stringify(pl.counts));
  ok(JSON.stringify({ ...tree(PA), ...tree(V), ...tree(D) }) === JSON.stringify(t0), 'preview wrote nothing');
  ok(!JSON.stringify(pl).includes('"_m"') && !JSON.stringify(pl).includes('"type":"Buffer"'), 'preview JSON has no file contents');
  // 2. modes and confirmation
  ok(/preview first/.test(S.run(pa).res), 'manual run without a preview refused');
  ok(/off/.test(S.run({ ...pa, sync: { mode: 'off' } }, { preview: pl }).res), 'mode off: nothing runs');
  ok(/own sync command/.test(S.run({ ...pa, sync: { mode: 'manual', cmd: 'bash sync_docs.sh' } }, { preview: pl }).res), 'custom command: built-in engine does not run');
  ok(/not on/.test(S.run(pa, { auto: true }).res), 'auto run refused when mode is manual');
  ok(/first sync needs a preview/.test(S.run({ ...pa, sync: { mode: 'auto', cmd: '' } }, { auto: true }).res), 'auto: first sync needs a preview');
  ok(JSON.stringify({ ...tree(PA), ...tree(V) }) === JSON.stringify({ ...tree(PA), ...tree(V) }) && !fs.existsSync(vf('Project Memory')), 'refused runs wrote nothing');
  // 3. confirmed first sync
  let r = S.run(pa, { preview: pl });
  ok(r.res === 'ok' && r.created.length === 3 && R(vf('Project Memory')) === R(path.join(PA, 'PROJECT_MEMORY.md')) && R(vf('Spec')) === '# Spec\n', 'confirmed first sync created 3 notes');
  const man = JSON.parse(R(path.join(D, 'sync-base', 'pa', 'base.json'))); ok(Object.keys(man.notes).length === 3 && man.notes['Project Memory'].sha === sha(fs.readFileSync(vf('Project Memory'))), 'common ancestor recorded with sha256');
  ok(R(path.join(GA, 'Other note.md')) === '# mine, not synced\n', 'unrelated vault note untouched');
  pl = S.plan(pa); ok(!pl.first && pl.items.every(i => i.action === 'same'), 'second preview: all in step');
  const m0 = fs.statSync(vf('Project Memory')).mtimeMs; r = S.run(pa, { preview: pl }); ok(r.res === 'ok' && fs.statSync(vf('Project Memory')).mtimeMs === m0 && !r.backup, 'nothing changed: no writes, no backup');
  // 4. push with verified, recoverable backup
  const oldV = fs.readFileSync(vf('Project Docs')); W(path.join(PA, 'PROJECT_DOCS.md'), '# Docs\nnew line\n'); pl = S.plan(pa); ok(act(pl, 'Project Docs') === 'push', 'project edit → push');
  r = S.run(pa, { preview: pl }); ok(r.pushed.includes('Project Docs') && R(vf('Project Docs')) === '# Docs\nnew line\n', 'push wrote the vault note');
  const bm = JSON.parse(R(path.join(r.backup, 'manifest.json'))), be = bm.files.find(f => f.from === vf('Project Docs'));
  ok(be && fs.readFileSync(path.join(r.backup, be.to)).equals(oldV) && be.sha256 === sha(oldV), 'backup holds the old vault note (sha verified)');
  const rc = path.join(T, 'restore.md'); fs.copyFileSync(path.join(r.backup, be.to), rc); ok(fs.readFileSync(rc).equals(oldV), 'backup restores byte for byte');
  // 5. pull
  W(vf('Spec'), '# Spec\nfrom Obsidian\n'); pl = S.plan(pa); ok(act(pl, 'Spec') === 'pull', 'vault edit → pull');
  r = S.run(pa, { preview: pl }); ok(r.pulled.includes('Spec') && R(path.join(PA, 'docs', 'Spec.md')) === '# Spec\nfrom Obsidian\n', 'pull wrote the project file');
  // 6. merge (different lines) and conflict (same line)
  W(path.join(PA, 'PROJECT_MEMORY.md'), '# A rules CHANGED\nline 2\nline 3\nline 4\nline 5\n'); W(vf('Project Memory'), '# A rules\nline 2\nline 3\nline 4\nline 5 vault\n');
  pl = S.plan(pa); ok(act(pl, 'Project Memory') === 'merge', 'both sides, different lines → merge');
  r = S.run(pa, { preview: pl }); const mg = '# A rules CHANGED\nline 2\nline 3\nline 4\nline 5 vault\n';
  ok(r.merged.includes('Project Memory') && R(vf('Project Memory')) === mg && R(path.join(PA, 'PROJECT_MEMORY.md')) === mg, 'merge combined both edits on both sides');
  W(path.join(PA, 'PROJECT_MEMORY.md'), mg.replace('line 3', 'line 3 project')); W(vf('Project Memory'), mg.replace('line 3', 'line 3 vault'));
  const c0 = { p: R(path.join(PA, 'PROJECT_MEMORY.md')), v: R(vf('Project Memory')) }; pl = S.plan(pa); const ci = pl.items.find(i => i.note === 'Project Memory');
  ok(ci.action === 'conflict' && ci.kind === 'same-lines', 'same line on both sides → conflict');
  r = S.run(pa, { preview: pl }); ok(r.conflicts.length === 1 && R(path.join(PA, 'PROJECT_MEMORY.md')) === c0.p && R(vf('Project Memory')) === c0.v, 'conflict: both files untouched');
  ok(r.conflictDir && ['project', 'vault', 'base'].every(k => fs.existsSync(path.join(r.conflictDir, 'Project Memory.' + k + '.md'))), 'conflict: project, vault and ancestor copies saved');
  const ra = S.run({ ...pa, sync: { mode: 'auto', cmd: '' } }, { auto: true }); ok(ra.switchToManual && ra.conflicts.length === 1, 'auto mode: conflict → switch to manual');
  r = S.run(pa, { preview: S.plan(pa), choices: { 'Project Memory': 'vault' } }); ok(r.pulled.includes('Project Memory') && R(path.join(PA, 'PROJECT_MEMORY.md')) === c0.v && r.backup, 'conflict resolved by choice (keep vault), with backup');
  // 7. damaged ancestor → conflict, never a guess
  fs.appendFileSync(path.join(D, 'sync-base', 'pa', 'Spec.md'), 'x'); W(vf('Spec'), '# Spec\nfrom Obsidian\nmore\n');
  pl = S.plan(pa); ok(pl.items.find(i => i.note === 'Spec').kind === 'base-damaged', 'changed ancestor → conflict (base-damaged), not a guess');
  W(vf('Spec'), '# Spec\nfrom Obsidian\n'); r = S.run(pa, { preview: S.plan(pa) }); ok(r.recorded.includes('Spec') && S.plan(pa).items.find(i => i.note === 'Spec').why === '', 'sides identical again → ancestor re-recorded (repaired)');
  // 8. encoding + line endings
  const bomCrlf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# BOM\r\nl2\r\nl3\r\n')]); fs.writeFileSync(path.join(PA, 'docs', 'Bom.md'), bomCrlf);
  r = S.run(pa, { preview: S.plan(pa) }); ok(fs.readFileSync(vf('Bom')).equals(bomCrlf), 'BOM + CRLF copied byte for byte');
  fs.writeFileSync(path.join(PA, 'docs', 'Bom.md'), Buffer.concat([bomCrlf, Buffer.from('p\r\n')])); fs.writeFileSync(vf('Bom'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# BOM v\r\nl2\r\nl3\r\n')]));
  pl = S.plan(pa); ok(act(pl, 'Bom') === 'merge', 'BOM + CRLF both sides → merge'); r = S.run(pa, { preview: pl });
  const bb = fs.readFileSync(vf('Bom')); ok(bb[0] === 0xef && bb.toString().includes('# BOM v\r\n') && bb.toString().includes('p\r\n') && !/[^\r]\n/.test(bb.toString()), 'merge kept BOM and CRLF');
  fs.writeFileSync(path.join(PA, 'docs', 'Bom.md'), Buffer.from('# BOM\nl2\nl3 lf\np\n')); fs.writeFileSync(vf('Bom'), Buffer.concat([bb, Buffer.from('v2\r\n')]));
  pl = S.plan(pa); ok(pl.items.find(i => i.note === 'Bom').kind === 'format', 'different encoding / line endings on both sides → conflict');
  r = S.run(pa, { preview: S.plan(pa), choices: { Bom: 'vault' } });
  // 9. missing files, no deletes
  fs.rmSync(vf('Spec')); pl = S.plan(pa); ok(act(pl, 'Spec') === 'create-vault', 'note missing in the vault → copied back');
  r = S.run(pa, { preview: pl, choices: { Spec: 'project' } }); ok(fs.existsSync(vf('Spec')), 'vault note restored');
  const nV = Object.keys(tree(V)).length; fs.rmSync(path.join(PA, 'docs', 'Spec.md')); pl = S.plan(pa); const ms = pl.items.find(i => i.note === 'Spec');
  ok(ms.action === 'conflict' && ms.kind === 'missing-project', 'project file deleted → conflict, not a delete');
  r = S.run(pa, { preview: pl }); ok(fs.existsSync(vf('Spec')) && Object.keys(tree(V)).length === nV, 'vault note kept (no deletes)');
  r = S.run(pa, { preview: S.plan(pa), choices: { Spec: 'vault' } }); ok(fs.existsSync(path.join(PA, 'docs', 'Spec.md')), 'choice: vault note copied back into the project');
  // 10. changed after the preview → not touched
  pl = S.plan(pa); W(path.join(PA, 'PROJECT_DOCS.md'), '# Docs\nedited after preview\n'); const v1 = R(vf('Project Docs'));
  r = S.run(pa, { preview: pl }); ok(r.changed.includes('Project Docs') && R(vf('Project Docs')) === v1, 'file changed after the preview → skipped, reported');
  r = S.run(pa, { preview: S.plan(pa) });
  // 11. first sync with existing different notes: user picks per file; nothing written without a choice
  const PB = mk(H, 'Games', 'B'), GB = mk(V, 'Game B'); W(path.join(PB, 'PROJECT_MEMORY.md'), '# B project\n'); W(path.join(GB, 'Project Memory.md'), '# B vault\n'); W(path.join(PB, 'INDEX.md'), '# same\n'); W(path.join(GB, 'File Index.md'), '# same\n');
  const pb = { id: 'pb', name: 'Game B', dir: PB, vault: V, vaultFolder: 'Game B', sync: { mode: 'manual', cmd: '' } };
  pl = S.plan(pb); ok(pl.first && pl.items.find(i => i.note === 'Project Memory').kind === 'first-sync' && act(pl, 'File Index') === 'same', 'first sync: differing file → pick a side; identical → same');
  r = S.run(pb, { preview: pl }); ok(R(path.join(GB, 'Project Memory.md')) === '# B vault\n' && R(path.join(PB, 'PROJECT_MEMORY.md')) === '# B project\n' && r.conflicts.length === 1, 'no choice → nothing overwritten');
  r = S.run(pb, { preview: S.plan(pb), choices: { 'Project Memory': 'project' } }); ok(R(path.join(GB, 'Project Memory.md')) === '# B project\n' && r.backup, 'choice keep project → vault note replaced after backup');
  // 12. refusals
  const ex = (f, re, m) => { let e = ''; try { f() } catch (x) { e = x.message } ok(re.test(e), m + ' (' + e.slice(0, 70) + ')') };
  ex(() => S.plan({ ...pa, vaultFolder: '../x' }), /Bad vault folder/, '.. in the vault folder refused');
  const OUT = mk(H, 'Elsewhere'); fs.symlinkSync(OUT, path.join(V, 'Jn'), 'junction'); ex(() => S.plan({ ...pa, id: 'pj', vaultFolder: 'Jn' }), /outside the vault/, 'vault folder junction leading outside refused');
  ex(() => S.plan({ ...pa, id: 'pv', vault: mk(H, 'NotVault') }), /not an Obsidian vault/, 'non-vault refused');
  const PJ = mk(H, 'Games', 'J'); W(path.join(OUT, 'x.md'), 'outside'); fs.symlinkSync(OUT, path.join(PJ, 'docs'), 'junction'); W(path.join(PJ, 'PROJECT_MEMORY.md'), '# J\n');
  const GJ = mk(V, 'Game J'), pj = { id: 'pj2', name: 'J', dir: PJ, vault: V, vaultFolder: 'Game J', sync: { mode: 'manual', cmd: '' } };
  pl = S.plan(pj, { pairs: [{ src: 'PROJECT_MEMORY.md', note: 'Project Memory' }, { src: 'docs/x.md', note: 'x' }] }); ok(act(pl, 'x') === 'refused', 'project file behind a junction → refused');
  fs.symlinkSync(OUT, path.join(GJ, 'Sub'), 'junction'); pl = S.plan(pj, { pairs: [{ src: 'PROJECT_MEMORY.md', note: 'Sub/evil' }, { src: '../up.md', note: 'up' }, { src: 'PROJECT_MEMORY.md', note: '.obsidian' }] });
  ok(pl.items.every(i => i.action === 'refused'), 'bad note names / .. / dot notes refused');
  W(path.join(PJ, 'graphify-out', 'g.md'), 'g'); pl = S.plan(pj, { pairs: [{ src: 'graphify-out/g.md', note: 'g' }] }); W(path.join(GJ, 'g.md'), 'vault g');
  r = S.run(pj, { preview: S.plan(pj, { pairs: [{ src: 'graphify-out/g.md', note: 'g' }] }), pairs: [{ src: 'graphify-out/g.md', note: 'g' }], choices: { g: 'vault' } });
  ok(R(path.join(PJ, 'graphify-out', 'g.md')) === 'g' && r.refused.some(x => /Graphify/.test(x)), 'write into graphify-out refused');
  ok(!fs.readdirSync(OUT).some(f => f !== 'x.md'), 'nothing written through junctions');
  const BOB = mk(T, 'Users', 'bob', 'Game'); ex(() => S.plan({ ...pa, id: 'pbob', dir: BOB }), /another Windows user/, "another user's project folder refused");
  // 13. lock: another process holding the lock → refused; dead process lock cleared
  const lockF = path.join(D, 'sync-locks', crypto.createHash('sha1').update(fs.realpathSync.native(GA).toLowerCase()).digest('hex') + '.lock');
  const ch = cp.spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)'], { stdio: 'ignore' }); W(lockF, JSON.stringify({ pid: ch.pid, at: Date.now() }));
  ex(() => S.run(pa, { preview: S.plan(pa) }), /Another sync/, 'second sync while one runs refused'); ch.kill();
  W(lockF, JSON.stringify({ pid: 999999, at: 0 })); r = S.run(pa, { preview: S.plan(pa) }); ok(r.res === 'ok' && !fs.existsSync(lockF), 'lock from a crashed run cleared, lock released after run');
  // two real processes at once: exactly one runs, the files stay whole
  W(path.join(PA, 'PROJECT_DOCS.md'), '# Docs\nrace\n'); const pre = JSON.stringify(S.plan(pa)), pf = path.join(T, 'pre.json'); fs.writeFileSync(pf, pre);
  const kid = `process.env.NEXUS_DATA=${JSON.stringify(D)};const S=require(${JSON.stringify(path.join(__dirname, 'sync.js'))});try{const r=S.run(${JSON.stringify(pa)},{preview:JSON.parse(require('fs').readFileSync(${JSON.stringify(pf)},'utf8'))});console.log(r.pushed.length?'ran':'nothing')}catch(e){console.log('refused '+e.message)}`;
  const ps = [0, 1].map(() => cp.spawn(process.execPath, ['-e', kid], { env: process.env })), outs = ps.map(p => new Promise(ok => { let s = ''; p.stdout.on('data', d => s += d); p.on('close', () => ok(s.trim())) }));
  module.exports.wait = Promise.all(outs).then(o => { ok(o.filter(x => x === 'ran').length === 1 && o.every(x => /^(ran|nothing|refused Another sync)/.test(x)), 'two processes at once: one ran, the other refused or found nothing (' + o.join(' / ') + ')');
    ok(R(vf('Project Docs')) === '# Docs\nrace\n', 'note whole after the race') });
  // 14. history cap, atomic leftovers, privacy
  return void module.exports.wait.then(() => {
    const hf = path.join(D, 'sync-history.json'), h = JSON.parse(R(hf)); h.runs = Array.from({ length: 199 }, (_, i) => ({ at: i, project: 'pa' })); fs.writeFileSync(hf, JSON.stringify(h));
    S.run(pa, { preview: S.plan(pa) }); S.run(pa, { preview: S.plan(pa) }); ok(JSON.parse(R(hf)).runs.length === 200 && S.historyOf('pb').every(r => r.project === 'pb'), 'history keeps the last 200 runs; per project filter');
    ok(!Object.keys({ ...tree(PA), ...tree(V), ...tree(D) }).some(f => /\.nexus-\d+\.tmp$|\.tmp-\d+$/.test(f)), 'no temp files left (atomic writes)');
    ok(Object.keys(tree(path.join(V, '.obsidian'))).length === 1 && R(path.join(V, '.obsidian', 'app.json')) === '{}', 'Obsidian settings untouched');
    ok(Object.keys(tree(D)).every(f => sp.within(H, f)), "all sync data inside alice's profile");
    ok(!JSON.stringify(S.plan(pa)).includes('Game B') && !JSON.stringify(S.plan(pb)).includes(path.join('Games', 'A')), "a project's preview never lists another project's files");
    // default mapping (gate c): sync_docs.sh's table wins; defaults never pair CLAUDE.md; same text under another name = conflict, never a new duplicate note
    const PC = mk(H, 'Games', 'C'), GC = mk(V, 'Game C'), pc = { id: 'pc', name: 'Game C', dir: PC, vault: V, vaultFolder: 'Game C', sync: { mode: 'manual', cmd: '' } };
    for (const [f, t] of [['CLAUDE.md', '# C rules\n'], ['PROJECT_DOCS.md', '# C docs\n'], ['PROJECT_MEMORY.md', '# C mem\n'], ['INDEX.md', '# C index\n'], ['docs/Art.md', '# art\n']]) W(path.join(PC, f), t);
    const dn = S.pairs(pc).map(x => x.src + '>' + x.note).join();
    ok(dn === 'PROJECT_DOCS.md>Project Docs,PROJECT_MEMORY.md>Project Memory,INDEX.md>File Index,docs/Art.md>Art', 'default pairs: friendly names, no CLAUDE.md (' + dn + ')');
    W(path.join(PC, 'sync_docs.sh'), 'sync1 "$P/PROJECT_DOCS.md"   "C Docs"\nsync1 "$P/INDEX.md" "C Index"\nfor f in "$P"/docs/*.md; do sync1 "$f" "$(basename "$f" .md)"; done\n');
    const sn = S.pairs(pc).map(x => x.src + '>' + x.note).join(); ok(sn === 'PROJECT_DOCS.md>C Docs,INDEX.md>C Index,docs/Art.md>Art', 'project with sync_docs.sh → its own pair table (' + sn + ')');
    W(path.join(GC, 'C Docs.md'), '# C docs\n'); W(path.join(GC, 'Old Index.md'), '# C index\n'); pl = S.plan(pc); const ci = pl.items.find(i => i.note === 'C Index');
    ok(act(pl, 'C Docs') === 'same' && ci.kind === 'duplicate-content' && /Old Index/.test(ci.why), 'same text already in the vault under another name → conflict, not a duplicate note');
    r = S.run(pc, { preview: pl }); ok(!fs.existsSync(path.join(GC, 'C Index.md')) && !(r.created || []).includes('C Index'), 'duplicate-content conflict never written without a choice');
    // bob: own data folder, sees none of alice's sync data, cannot use her project or vault, cannot point his data into her profile
    const B = user('bob'), CF = require('./config.js'); ok(CF.dataDir() === fs.realpathSync.native(B.D), "bob's NEXUS data folder is his own");
    ok(S.historyOf().length === 0, "bob sees none of alice's sync history");
    ex(() => S.plan(pa), /another Windows user/, "bob cannot preview alice's project");
    ex(() => S.plan({ id: 'pb2', dir: mk(B.H, 'G'), vault: V, vaultFolder: 'Game A', sync: { mode: 'manual', cmd: '' } }), /another Windows user/, "bob cannot link alice's vault");
    process.env.NEXUS_DATA = D; ex(() => CF.dataDir(), /another Windows user|inside your own user folder/, "bob's NEXUS data cannot point into alice's profile");
  }).catch(e => fail.push('crash: ' + e.stack.split('\n').slice(0, 3).join(' | '))).finally(done);
} catch (e) { fail.push('crash: ' + e.stack.split('\n').slice(0, 3).join(' | ')); done() }
function done() { for (const k of Object.keys(process.env)) if (!(k in SAVE)) delete process.env[k]; Object.assign(process.env, SAVE); try { fs.rmSync(T, { recursive: true, force: true }) } catch { }
  console.log(JSON.stringify({ pass, fail }, null, 1)); process.exit(fail.length ? 1 : 0) }
