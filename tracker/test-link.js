// M2 wiring tests: node test-link.js. Mock user + vaults in a temp folder: link / unlink / active via projects.post, refusals,
// backups, knowledge.js (and auto.js sync text, via where()) following the active project. Never touches the real NEXUS data, vaults or Claude files.
const fs = require('fs'), path = require('path'), os = require('os');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-link-')), SAVE = { ...process.env };
let pass = 0; const fail = []; const ok = (c, m) => c ? pass++ : fail.push(m);
const mk = (...p) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d };
const H = mk(T, 'Users', 'alice'), D = mk(H, 'AppData', 'Local', 'NEXUS');
Object.assign(process.env, { USERPROFILE: H, APPDATA: mk(H, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(H, 'AppData', 'Local'), NEXUS_DATA: D, CLAUDE_CONFIG_DIR: path.join(H, '.claude'), NEXUS_STATE: path.join(D, 'state.json') });
for (const k of ['NEXUS_VAULT', 'NEXUS_PROJ']) delete process.env[k];
try {
  const V1 = mk(H, 'Vaults', 'Main'), V2 = mk(H, 'Vaults', 'Second'), NV = mk(H, 'Vaults', 'Plain'); mk(V1, '.obsidian'); mk(V2, '.obsidian'); mk(V1, 'Game A'); fs.writeFileSync(path.join(V1, 'Game A', 'n.md'), '# A');
  mk(process.env.APPDATA, 'obsidian'); const OBS = path.join(process.env.APPDATA, 'obsidian', 'obsidian.json');
  fs.writeFileSync(OBS, JSON.stringify({ vaults: { a: { path: V1 }, b: { path: V2 }, c: { path: NV } } })); const obs0 = fs.readFileSync(OBS, 'utf8');
  const PA = mk(H, 'Games', 'A'), PB = mk(H, 'Games', 'B'); mk(PA, 'docs'); mk(PA, 'graphify-out'); mk(H, '.claude', 'plugins'); // A has every watched folder, B has none
  fs.writeFileSync(path.join(D, 'projects.json'), JSON.stringify({ items: [{ id: 'pa', dir: PA, name: 'Game A', type: 'roblox', tasks: [] }, { id: 'pb', dir: PB, name: 'Game B', type: 'other', tasks: [] }], dismissed: [] }));
  const P = require('./projects.js'), K = require('./knowledge.js'), CF = require('./config.js'), bkDir = path.join(D, 'backups', 'nexus');
  const nb = () => fs.existsSync(bkDir) ? fs.readdirSync(bkDir).length : 0, items = () => JSON.parse(fs.readFileSync(path.join(D, 'projects.json'))).items;
  // status lists Obsidian's vaults read-only, with validity
  const st = P.status(); ok(st.vaults.length === 3 && st.vaults.find(v => v.path === NV).ok === false && st.active === null, 'status: vaults + no active');
  // default paths before any config: nothing linked (no personal default paths in the code)
  ok(K.where().proj === path.join(D, 'no-project-linked') && K.where().folder === 'Demo Game', 'no config: no personal default (M7a portability), nothing linked');
  // link A, then refusals for B
  let b0 = nb(), r = P.post({ op: 'link', id: 'pa', vault: V1, vaultFolder: 'Game A', sync: { mode: 'manual', cmd: 'bash sync_docs.sh' }, graph: { mode: 'builtin', out: '' } });
  ok(r.res === 'ok' && items()[0].vault === V1 && items()[0].vaultFolder === 'Game A' && items()[0].sync.mode === 'manual', 'link A saved'); ok(nb() === b0 + 1, 'projects.json backed up before link');
  ok(P.post({ op: 'link', id: 'pb', vault: V1, vaultFolder: 'Game A/Levels', sync: { mode: 'off' } }).res.includes('already uses'), 'B inside A refused');
  ok(P.post({ op: 'link', id: 'pb', vault: V1, vaultFolder: '', sync: { mode: 'off' } }).res.includes('already uses'), 'B whole vault refused');
  ok(/not an Obsidian vault/.test(P.post({ op: 'link', id: 'pb', vault: NV }).res), 'non-vault refused');
  ok(/another Windows user/.test(P.post({ op: 'link', id: 'pb', vault: mk(T, 'Users', 'bob', 'V') }).res), 'other user vault refused');
  ok(/plain folder/.test(P.post({ op: 'link', id: 'pb', vault: V1, vaultFolder: '../x' }).res), '.. refused');
  ok(/Unknown sync mode/.test(P.post({ op: 'link', id: 'pb', vault: V2, sync: { mode: 'always' } }).res), 'bad sync mode refused');
  ok(/inside this project|Graph data/.test(P.post({ op: 'link', id: 'pb', vault: V2, graph: { mode: 'graphify', out: path.join(PA, 'graphify-out') } }).res), 'graph out in another project refused');
  ok(items()[1].vault === undefined, 'refusals saved nothing');
  ok(P.post({ op: 'link', id: 'pb', vault: V1, vaultFolder: 'Game B', sync: { mode: 'auto', cmd: '' }, graph: { mode: 'graphify', out: path.join(PB, 'graphify-out') } }).res === 'ok', 'B separate folder in shared vault ok');
  // switching the active project: knowledge + auto follow
  ok(P.post({ op: 'active', id: 'pa' }).res === 'ok' && CF.load().active === 'pa' && P.status().active === 'pa', 'active = A');
  let w = K.where(); ok(w.vault === V1 && w.proj === PA && w.folder === 'Game A' && w.name === 'Game A', 'knowledge follows A');
  P.post({ op: 'active', id: 'pb' }); w = K.where(); ok(w.proj === PB && w.folder === 'Game B' && w.graph === path.join(PB, 'graphify-out', 'graph.json'), 'switch to B: knowledge follows');
  let kerr = ''; try { K.status() } catch (e) { kerr = e.message } ok(!kerr, 'knowledge status runs after switch ' + kerr);
  // a watch warning from one project doesn't stick after switching back
  P.post({ op: 'active', id: 'pb' }); K.live({ on: () => { } }, { writeHead() { }, write() { }, on() { } }, 0); P.post({ op: 'active', id: 'pa' }); const w2 = K.graph().warn; ok(!w2 || !w2.includes(PB), 'no stale warning from project B after switching (' + (w2 || 'none') + ')');
  // unlink: link removed, vault untouched
  ok(P.post({ op: 'link', id: 'pa', unlink: true }).res === 'ok' && items()[0].vault === undefined && fs.existsSync(path.join(V1, 'Game A', 'n.md')), 'unlink keeps the vault');
  ok(fs.readFileSync(OBS, 'utf8') === obs0 && !fs.existsSync(path.join(V1, '.obsidian', 'app.json')), "Obsidian's files untouched");
  ok(!JSON.stringify(P.status()).includes(path.join(T, 'Users', 'bob')), 'no other-user data in status');
} catch (e) { fail.push('crash: ' + e.stack.split('\n').slice(0, 3).join(' | ')) }
finally { for (const k of Object.keys(process.env)) if (!(k in SAVE)) delete process.env[k]; Object.assign(process.env, SAVE); try { fs.rmSync(T, { recursive: true, force: true }) } catch { } }
console.log(JSON.stringify({ pass, fail }, null, 1)); process.exit(fail.length ? 1 : 0);
