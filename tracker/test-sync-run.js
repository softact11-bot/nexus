// M3 gate (e1) check: node test-sync-run.js. POST /api/sync/run + /api/sync/engine on a fixture tracker (spare port 7792, temp NEXUS data,
// temp projects + vaults) only. The real tracker, projects, vaults and NEXUS data are never written; their hashes are compared before / after.
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), crypto = require('crypto');
const { server, up, snap, WATCH, NEW, TOK } = require('./test-sync-tab.js'), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m);
const PORT = 7792, O = 'http://127.0.0.1:' + PORT, sha = f => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') } catch { return 'missing' } };
const files = d => { const o = []; (function w(x) { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const f = path.join(x, e.name); e.isDirectory() ? w(f) : o.push(f) } })(d); return o.sort() };
const hashes = ds => ds.flatMap(files).map(f => f + ':' + sha(f)).join('\n');

function fixture() {
  const R = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sync-run-')), mk = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) };
  const P = (k, extra = {}) => ({ id: k + 'proj', name: k + ' game', dir: path.join(R, k + '-game'), vault: path.join(R, k + '-vault'), vaultFolder: '', sync: { mode: 'manual', cmd: '' }, graph: { mode: 'builtin', out: '' }, type: 'roblox', status: 'active', tags: [], aliases: [], ...extra });
  const A = P('alpha'), B = P('beta'), C = P('gamma', { sync: { mode: 'manual', cmd: 'echo own' } });
  for (const p of [A, B, C]) { mk(path.join(p.vault, '.obsidian', 'app.json'), '{}'); mk(path.join(p.dir, 'PROJECT_DOCS.md'), '# docs\r\nsame\r\n'); mk(path.join(p.vault, 'Project Docs.md'), '# docs\r\nsame\r\n') }
  mk(path.join(A.dir, 'docs', 'Lantern.md'), '# Lantern\nPrice: 300\n'); mk(path.join(A.vault, 'Lantern.md'), '# Lantern\nPrice: 275\n'); // first-sync conflict
  mk(path.join(A.dir, 'docs', 'Push.md'), '﻿# Push\nonly in the project\n'); // new note for the vault (BOM kept)
  mk(path.join(B.dir, 'docs', 'Kart.md'), '# Kart\nSpeed 9\n'); mk(path.join(B.vault, 'Kart.md'), '# Kart\nSpeed 7\n');
  const data = path.join(R, 'data'); mk(path.join(data, 'projects.json'), JSON.stringify({ items: [A, B, C] })); mk(path.join(data, 'nexus-config.json'), JSON.stringify({ version: 1, active: A.id }));
  return { R, data, A, B, C };
}
const req = (method, p, body, h = {}) => new Promise(res => { const b = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const q = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { host: '127.0.0.1:' + PORT, origin: O, 'content-type': 'application/json', 'content-length': Buffer.byteLength(b), 'x-nexus-token': TOK, ...h } }, r => { let t = ''; r.on('data', c => t += c).on('end', () => { let j = null; try { j = JSON.parse(t) } catch { } res({ c: r.statusCode, j }) }) });
  q.end(b) });
const view = async id => (await req('GET', '/api/sync?id=' + id)).j;

(async () => {
  const before = snap(), fx = fixture(), S = server(PORT, { NEXUS_DATA: fx.data, NEXUS_VAULT: '', NEXUS_PROJ: '' }), { A, B, C } = fx;
  try {
    ok(await up(PORT), 'fixture server starts');
    // ---------- guards ----------
    let v = await view(A.id); ok(v.engine === 'builtin' && v.token && !v.runWhy && v.plan.first, 'built-in manual project: preview gets a one-time token');
    ok(v.plan.items.find(i => i.note === 'Project Docs')?.record === true, 'matching pair marked to be recorded');
    const bA = hashes([A.dir, A.vault]), bB = hashes([B.dir, B.vault, C.dir, C.vault]);
    ok((await req('POST', '/api/sync/run', { id: A.id, token: v.token, confirm: true }, { origin: 'http://evil.example' })).c === 403, 'foreign Origin 403');
    ok((await req('POST', '/api/sync/run', { id: A.id, token: v.token, confirm: true }, { host: 'evil.example:' + PORT })).c === 403, 'foreign Host 403');
    ok((await req('POST', '/api/sync/run', { id: A.id, token: v.token, confirm: true }, { 'content-type': 'text/plain' })).c === 403, 'non-JSON 403');
    ok((await req('PUT', '/api/sync/run', {})).c === 405, 'PUT 405'); ok((await req('POST', '/api/sync', {})).c === 405, 'POST on the preview route 405');
    ok((await req('POST', '/api/sync/run', { id: A.id, token: v.token })).j?.res === 'Confirm the list first.', 'run without confirm refused');
    ok(/out of date/.test((await req('POST', '/api/sync/run', { id: A.id, token: 'x' + v.token, confirm: true })).j?.res), 'wrong token refused (and burns the preview)');
    ok(/out of date/.test((await req('POST', '/api/sync/run', { id: A.id, token: v.token, confirm: true })).j?.res), 'burnt token refused');
    v = await view(A.id); ok(/Unknown conflict choice/.test((await req('POST', '/api/sync/run', { id: A.id, token: v.token, confirm: true, choices: { 'Project Docs': 'vault' } })).j?.res), 'choice for a non-conflict refused');
    v = await view(A.id); ok(/Unknown conflict choice/.test((await req('POST', '/api/sync/run', { id: A.id, token: v.token, confirm: true, choices: { Lantern: 'delete' } })).j?.res), 'unknown choice value refused');
    ok((await req('POST', '/api/sync/run', { id: '../x', token: 'a', confirm: true })).c === 400, 'bad id 400');
    ok(hashes([A.dir, A.vault]) === bA && !fs.existsSync(path.join(fx.data, 'sync-base')), 'refused requests wrote nothing');
    // ---------- engine / mode ----------
    ok(/locked/.test((await req('POST', '/api/sync/engine', { id: A.id, mode: 'auto', engine: 'builtin' })).j?.res), 'Automatic refused (locked)');
    ok((await req('POST', '/api/sync/engine', { id: A.id, mode: 'manual', engine: 'magic' })).c === 400, 'unknown engine refused');
    ok(/no own sync command/.test((await req('POST', '/api/sync/engine', { id: A.id, mode: 'manual', engine: 'command' })).j?.res), 'own command needs a command');
    let g = await view(C.id); ok(g.engine === 'command' && !g.token && /own command/.test(g.runWhy) && /\.sync_base|first sync/.test(g.plan.ancestor), 'own-command project: preview only, no token');
    ok(/own command/.test((await req('POST', '/api/sync/run', { id: C.id, token: 'a', confirm: true })).j?.res), 'own-command project: run refused');
    const pj0 = fs.readFileSync(path.join(fx.data, 'projects.json'), 'utf8');
    let e = await req('POST', '/api/sync/engine', { id: C.id, mode: 'manual', engine: 'builtin' });
    ok(e.j?.res === 'ok' && e.j.sync.engine === 'builtin' && e.j.sync.cmd === 'echo own', 'engine → built-in saved, own command kept');
    ok(files(fx.data).some(f => f.includes('projects-link')), 'project list backed up before the change');
    g = await view(C.id); ok(g.engine === 'builtin' && g.token, 'built-in now: preview gets a token');
    e = await req('POST', '/api/sync/engine', { id: C.id, mode: 'off', engine: 'builtin' }); g = await view(C.id); ok(e.j?.res === 'ok' && !g.token && /Manual/.test(g.runWhy), 'mode Off: no token, run refused');
    await req('POST', '/api/sync/engine', { id: C.id, mode: 'manual', engine: 'command' }); g = await view(C.id); ok(g.engine === 'command' && g.sync.mode === 'manual', 'back to own command');
    ok(JSON.parse(fs.readFileSync(path.join(fx.data, 'projects.json'), 'utf8')).items.filter(x => x.id !== C.id).every(x => JSON.stringify(x) === JSON.stringify(JSON.parse(pj0).items.find(y => y.id === x.id))), 'engine change touched only that project');
    // ---------- real run on fixture A ----------
    const lantern0 = fs.readFileSync(path.join(A.dir, 'docs', 'Lantern.md')), n0 = files(A.dir).length + files(A.vault).length;
    v = await view(A.id); let r = await req('POST', '/api/sync/run', { id: A.id, token: v.token, confirm: true, choices: { Lantern: 'vault' } }), R = r.j?.result || {};
    ok(r.j?.res === 'ok', 'run ok (' + r.j?.res + ')');
    ok(R.created?.join() === 'Push' && R.pulled?.join() === 'Lantern' && R.recorded?.join() === 'Project Docs' && !R.pushed.length && !R.conflicts.length && !R.changed.length && !R.refused.length, 'result: created Push, pulled Lantern, recorded Project Docs (' + JSON.stringify(R) + ')');
    ok(sha(path.join(A.vault, 'Push.md')) === sha(path.join(A.dir, 'docs', 'Push.md')) && fs.readFileSync(path.join(A.vault, 'Push.md'))[0] === 0xef, 'new vault note = project file, BOM kept');
    ok(sha(path.join(A.dir, 'docs', 'Lantern.md')) === sha(path.join(A.vault, 'Lantern.md')), 'Lantern: project now has the vault version');
    const m = R.backup && JSON.parse(fs.readFileSync(path.join(R.backup, 'manifest.json'), 'utf8')), e1 = m?.files.find(x => x.from === path.join(A.dir, 'docs', 'Lantern.md'));
    ok(e1 && fs.readFileSync(path.join(R.backup, e1.to)).equals(lantern0), 'backup holds the old project Lantern byte for byte');
    ok(R.backup.startsWith(fx.data), 'backup inside the NEXUS data folder');
    ok(files(A.dir).length + files(A.vault).length === n0 + 1, 'one file added, none deleted');
    ok(['Project Docs', 'Lantern', 'Push'].every(n => fs.existsSync(path.join(fx.data, 'sync-base', A.id, n + '.md'))), 'last synced copies recorded in NEXUS data');
    ok(hashes([B.dir, B.vault, C.dir, C.vault]) === bB && !fs.existsSync(path.join(fx.data, 'sync-base', B.id)), 'other projects untouched');
    v = await view(A.id); ok(v.plan.counts.same === 3 && !v.plan.first && v.plan.ancestor === 'NEXUS last synced copies' && v.history[0]?.recorded === 1 && v.history[0]?.created === 1, 'next preview: all unchanged, history entry');
    ok(/out of date/.test((await req('POST', '/api/sync/run', { id: A.id, token: 'reuse', confirm: true })).j?.res), 'old token cannot run twice');
    // ---------- changed after the preview: skipped ----------
    fs.appendFileSync(path.join(A.dir, 'PROJECT_DOCS.md'), 'edit 1\r\n'); v = await view(A.id); ok(v.plan.items.find(i => i.note === 'Project Docs')?.action === 'push', 'project edit → push in the preview');
    fs.appendFileSync(path.join(A.dir, 'PROJECT_DOCS.md'), 'edit 2\r\n'); const vd = sha(path.join(A.vault, 'Project Docs.md'));
    R = (await req('POST', '/api/sync/run', { id: A.id, token: v.token, confirm: true })).j?.result || {};
    ok(R.changed?.join() === 'Project Docs' && !R.pushed.length && sha(path.join(A.vault, 'Project Docs.md')) === vd, 'changed after the preview: skipped, vault untouched');
    v = await view(A.id); R = (await req('POST', '/api/sync/run', { id: A.id, token: v.token, confirm: true })).j?.result || {};
    ok(R.pushed?.join() === 'Project Docs' && fs.readFileSync(path.join(A.vault, 'Project Docs.md'), 'utf8') === '# docs\r\nsame\r\nedit 1\r\nedit 2\r\n', 'fresh preview: pushed, CRLF kept');
    // ---------- Leave / no choice on B: nothing written ----------
    const b0 = hashes([B.dir, B.vault]); v = await view(B.id);
    R = (await req('POST', '/api/sync/run', { id: B.id, token: v.token, confirm: true, choices: { Kart: 'skip' } })).j?.result || {};
    ok(R.skipped?.length === 1 && hashes([B.dir, B.vault]) === b0, 'Leave: B files untouched');
    v = await view(B.id); R = (await req('POST', '/api/sync/run', { id: B.id, token: v.token, confirm: true })).j?.result || {};
    ok(R.conflicts?.[0]?.note === 'Kart' && hashes([B.dir, B.vault]) === b0 && R.conflictDir?.startsWith(fx.data), 'no choice: conflict kept, both versions copied to NEXUS data, files untouched');
  } catch (e) { fail.push('crash: ' + e.stack) }
  finally { try { S.kill() } catch { } await sleep(400); try { fs.rmSync(fx.R, { recursive: true, force: true }) } catch { } }
  const after = snap(), diffs = WATCH.filter((f, i) => before[i] !== after[i]).concat(NEW.filter((f, i) => before[WATCH.length + i] !== after[WATCH.length + i]));
  ok(!diffs.length, 'real protected files unchanged (' + WATCH.length + ' files + ' + NEW.length + ' NEXUS folders) ' + diffs.join(', '));
  console.log(pass + '/' + (pass + fail.length) + ' passed' + (fail.length ? '\nFAIL:\n- ' + fail.join('\n- ') : ''));
  process.exit(fail.length ? 1 : 0);
})();
