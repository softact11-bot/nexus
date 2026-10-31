// M3 gate (d) + (e1) check: node test-sync-tab.js. Runs this folder's tracker.js routes on spare ports (7790 real data, 7791 isolated fixture) with
// no background work (no usage scan, automations or health monitor), then drives headless Chrome: all nav pages load, the Knowledge Sync tab
// shows the real read-only preview (own-command project: Sync now off), never sends anything but GET to the real data, project switching shows only that project's data, 4 window sizes fit.
// The real tracker (7788) is not touched. Protected files, both sides of every pair, the vault and NEXUS data are hashed before and after.
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const CF = require('./config'), sleep = ms => new Promise(r => setTimeout(r, ms)), H = os.homedir();
const OUT = path.join(os.tmpdir(), 'nexus-sync-tab-shots'); fs.mkdirSync(OUT, { recursive: true });
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m);

// ---------- protected-file hashes ----------
const DATA = CF.dataDir(), PJ = JSON.parse(fs.readFileSync(path.join(DATA, 'projects.json'), 'utf8')).items;
const walk = (d, o = []) => { let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { } for (const x of e) { const f = path.join(d, x.name); if (x.isDirectory()) { if (!/^(node_modules|\.git|backups|graphify-out|leaderboards)$/.test(x.name)) walk(f, o) } else if (/\.(md|json|sh|py|canvas)$/i.test(x.name)) o.push(f) } return o };
let OBS = path.join(process.env.APPDATA || '', 'obsidian', 'obsidian.json'), VAULTS = []; try { VAULTS = Object.values(JSON.parse(fs.readFileSync(OBS, 'utf8')).vaults || {}).map(v => v.path) } catch { }
const WATCH = [...new Set([path.join(H, '.claude', 'settings.json'), path.join(H, '.claude', '.credentials.json'), OBS, ...['projects.json', 'nexus-config.json', 'sync-history.json'].map(f => path.join(DATA, f)),
  ...PJ.flatMap(p => [...walk(p.dir), ...(p.vault ? walk(p.vault) : []), path.join(p.dir, 'graphify-out', 'graph.json')]), ...VAULTS.flatMap(v => walk(path.join(v, '.obsidian')))])]
  .filter(f => path.basename(f) !== 'Token Optimizer.md'); // B53: the live tracker (7788) rewrites this note on its own timer; the test servers never write it
const NEW = [path.join(DATA, 'sync-base'), path.join(DATA, 'graphs'), path.join(DATA, 'backups', 'sync-conflicts')]; // must not appear / change
const hash = f => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') } catch { return 'missing' } };
const snap = () => [...WATCH.map(hash), ...NEW.map(d => fs.existsSync(d) ? fs.readdirSync(d).join('|') : 'none')];

const AU = require('./test-auth.js'), TOK = require('crypto').randomBytes(32).toString('hex'); // M4b: test servers get their own token (no launch.key)
// ---------- isolated servers: tracker.js routes on another port, background work removed ----------
function server(port, env = {}) { // the patch is applied in the child: same file, other port, listen callback returns before any background work
  const boot = `const fs = require('fs'), M = require('module'), f = ${JSON.stringify(path.join(__dirname, 'tracker.js'))}, m = new M(f);
    const s = fs.readFileSync(f, 'utf8').replace('PORT = 7788', 'PORT = ${port}').replace(".listen(PORT, '127.0.0.1', () => {", ".listen(PORT, '127.0.0.1', () => { return;");
    if (!s.includes('PORT = ${port}') || !s.includes('{ return;')) process.exit(3);
    m.filename = f; m.paths = M._nodeModulePaths(${JSON.stringify(__dirname)}); process.argv[2] = 'serve'; process.argv[3] = '--manual'; m._compile(s, f);`;
  return cp.spawn(process.execPath, ['-e', boot], { cwd: __dirname, env: { ...process.env, NEXUS_TOKEN: TOK, ...env }, stdio: 'ignore', windowsHide: true });
}
const up = async port => { for (let i = 0; i < 160; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/preview/index.html`, { headers: { 'x-nexus-token': TOK } })).ok) return true } catch { } await sleep(250) } return false };

// ---------- fixture: two projects, two vaults, nothing shared ----------
function fixture() {
  const R = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sync-tab-')), mk = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) };
  const P = (k, note, a, b) => { const dir = path.join(R, k + '-game'), vault = path.join(R, k + '-vault');
    mk(path.join(vault, '.obsidian', 'app.json'), '{}'); mk(path.join(dir, 'PROJECT_DOCS.md'), `# ${k} docs\n`); mk(path.join(vault, 'Project Docs.md'), `# ${k} docs\n`);
    mk(path.join(dir, 'docs', note + '.md'), a); mk(path.join(vault, note + '.md'), b);
    return { id: k + 'proj', name: k[0].toUpperCase() + k.slice(1) + ' Fixture Game', dir, vault, vaultFolder: '', sync: { mode: 'manual', cmd: '' }, graph: { mode: 'builtin', out: '' }, type: 'roblox', status: 'active', tags: [], aliases: [] } };
  const A = P('alpha', 'Alpha Secret Lantern', '# Lantern\nPrice: 300\nOpens at night\n', '# Lantern\nPrice: 275\nOpens at night\nIdea: gold\n'), B = P('beta', 'Beta Hidden Kart', '# Kart\nSpeed 9\n', '# Kart\nSpeed 9\n');
  const data = path.join(R, 'data'); mk(path.join(data, 'projects.json'), JSON.stringify({ items: [A, B] })); mk(path.join(data, 'nexus-config.json'), JSON.stringify({ version: 1, active: A.id }));
  return { R, data, A, B };
}

module.exports = { server, up, snap, WATCH, NEW, TOK };
if (require.main === module) (async () => {
  const before = snap(), fx = fixture(), S1 = server(7790), S2 = server(7791, { NEXUS_DATA: fx.data, NEXUS_VAULT: '', NEXUS_PROJ: '' });
  const PROF = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sync-tab-chrome-'));
  const ch = cp.spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9336', '--user-data-dir=' + PROF, '--no-first-run', '--disable-extensions', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  try {
    ok(await up(7790) && await up(7791), 'isolated servers start');
    // ---------- API (real data) ----------
    const spooky = PJ.find(p => p.vault), other = PJ.find(p => p !== spooky), BI = spooky.sync?.engine === 'builtin'; // real engine: own command until e2, built-in after
    const J = async (u, o) => { const r = await fetch('http://127.0.0.1:7790' + u, { ...o, headers: { 'x-nexus-token': TOK, ...o?.headers } }); return { c: r.status, t: r.headers.get('content-type'), j: /json/.test(r.headers.get('content-type') || '') ? await r.json() : null } };
    const a = await J('/api/sync?id=' + spooky.id);
    ok(a.c === 200 && a.j.plan, 'GET /api/sync real project'); const pl = a.j.plan || { items: [], counts: {} };
    const N = require('./sync.js').pairs(spooky).length; // the pair count follows sync_docs.sh (was 21, grows with docs/*.md)
    ok(N > 0 && pl.items.length === N && pl.counts.same === N, `real preview: ${N} pairs, all unchanged (` + JSON.stringify(pl.counts) + ')');
    ok(/sync_docs\.sh/.test(a.j.mapping) && (BI ? /NEXUS last synced|none yet/ : /\.sync_base/).test(pl.ancestor), 'uses sync_docs.sh pairs + ' + pl.ancestor);
    ok(a.j.graph.source === 'graphify' && a.j.graph.stats?.nodes > 0, 'graph source Graphify (' + a.j.graph.stats?.nodes + ' nodes)');
    ok(a.j.realSync === false && a.j.sync.mode !== 'auto', 'real sync off, not automatic');
    ok(!JSON.stringify(a.j).includes('"text"') && !JSON.stringify(a.j).includes('buf'), 'no note text in the answer');
    const b = await J('/api/sync?id=' + other.id); ok(b.c === 200 && !b.j.plan && /No Obsidian vault/.test(b.j.why), 'other project: no vault, no plan');
    ok(!JSON.stringify(b.j).includes('my-game') && !b.j.history.length && !b.j.plan, 'other project answer has none of Spooky\'s paths, plan or history');
    ok((await J('/api/sync?id=' + spooky.id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).c === 403, 'POST without Origin refused (403, M4a guard)');
    ok((await J('/api/sync?id=' + spooky.id, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:7790' }, body: '{}' })).c === 405, 'same-origin POST to the read-only route refused (405)');
    ok((await J('/api/sync?id=nope')).c === 400, 'unknown project 400'); ok((await J('/api/sync?id=..%2F..')).c === 400, 'bad id 400');
    ok((await J('/api/sync/diff?id=' + spooky.id + '&note=Project%20Docs')).c === 400, 'diff only for conflicts');
    const bad = await new Promise(r => require('http').get({ host: '127.0.0.1', port: 7790, path: '/api/sync?id=' + spooky.id, headers: { host: 'evil.example:7790' } }, x => { x.resume(); r(x.statusCode) }));
    ok(bad === 403, 'foreign Host header refused (403)');

    // ---------- browser ----------
    let tgt; for (let i = 0; i < 120 && !tgt; i++) { await sleep(250); try { tgt = (await (await fetch('http://127.0.0.1:9336/json/list')).json()).find(t => t.type === 'page') } catch { } }
    if (!tgt) throw new Error('headless Chrome DevTools on port 9336 not ready after 30 s (B53)');
    const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
    let id = 0; const pend = {}, errs = [], reqs = [];
    ws.onmessage = m => { const j = JSON.parse(m.data); if (j.id && pend[j.id]) { (j.error ? pend[j.id].no : pend[j.id].ok)(j.error || j.result); delete pend[j.id] }
      else if (j.method === 'Runtime.exceptionThrown') errs.push(j.params.exceptionDetails.exception?.description?.split('\n')[0] || j.params.exceptionDetails.text);
      else if (j.method === 'Runtime.consoleAPICalled' && j.params.type === 'error') errs.push(j.params.args.map(a => a.value || a.description).join(' '))
      else if (j.method === 'Network.requestWillBeSent') reqs.push([j.params.request.method, j.params.request.url]) };
    const send = (method, params = {}) => new Promise((o, n) => { const i = ++id; pend[i] = { ok: o, no: n }; ws.send(JSON.stringify({ id: i, method, params })) });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value };
    const size = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(r.data, 'base64')) };
    const tab = `document.getElementById('k-sync')`, txt = `((e => { if (!e) return ''; const c = e.cloneNode(true); c.querySelector('select')?.remove(); c.querySelectorAll('input[type=radio]').forEach(i => i.removeAttribute('name')); document.body.append(c); const t = c.innerText; c.remove(); return t })(${tab}))` /* without the project list */;
    const wait = async (cond, ms = 15000) => { for (let t = 0; t < ms; t += 250) { if (await ev(cond)) return true; await sleep(250) } return false };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await AU.cookie(send, 7790, TOK); await AU.cookie(send, 7791, TOK); await size(1440, 900);

    await send('Page.navigate', { url: 'http://127.0.0.1:7790/preview#/home' }); await sleep(3500);
    const pages = await ev(`[...new Set([...document.querySelectorAll('a.nav-i[href^="#/"]')].map(a => a.getAttribute('href')))]`);
    ok(pages.length === 12, 'nav has 12 pages (' + pages.length + ')');
    for (const p of pages) { const e0 = errs.length; await ev(`location.hash = ${JSON.stringify(p)}`); await sleep(2200);
      const t = await ev(`(document.querySelector('main')?.innerText || '').length`); ok(t > 100 && errs.length === e0, `page ${p} loads (${t} chars${errs.length > e0 ? ', ' + errs.slice(e0).join(' | ') : ''})`) }

    // Knowledge: existing tabs untouched, Sync tab added at the end
    await ev(`location.hash = '#/knowledge/overview'`); await sleep(3000);
    const tabs = await ev(`[...document.querySelectorAll('#k-tabs a, #k-tabs button')].map(x => x.textContent.trim())`);
    ok(tabs.join('|') === 'Overview|Notes|Graph View|Tags|Backlinks|Search|Templates|Daily Notes|Analytics|Export|Sync', 'Knowledge tabs: 10 existing + Sync (' + tabs.join('|') + ')');
    ok(await ev(`!!document.querySelector('[data-a=sync]') && /Sync All/.test(document.querySelector('[data-a=sync]').textContent)`), 'Sync All button kept');
    await shot('knowledge-overview-1440');
    const r0 = reqs.length; await ev(`location.hash = '#/knowledge/sync'`);
    ok(await wait(`${txt}.includes('Sync preview') && !${txt}.includes('Reading this project')`), 'Sync tab loads the real preview');
    const T = await ev(txt);
    for (const s of [...(BI ? ['MANUAL', 'Built-in (NEXUS)'] : ['READ ONLY', 'Own command', 'own command (Sync All)', '.sync_base']), 'Using Graphify', 'sync_docs.sh pair table', 'Project Docs', 'Conflicts', 'Sync history']) ok(T.includes(s), 'Sync tab shows: ' + s);
    ok(await ev(`${tab}.querySelector('.syn-kpi[data-f=same] b, .syn-kpi[data-sf=same] b')?.textContent`) === String(N), 'Unchanged = ' + N);
    ok(await ev(`[...${tab}.querySelectorAll('input[name=sy-mode]')].map(i => i.value + ':' + i.disabled).join()`) === 'off:false,manual:false,auto:true', 'mode: Off / Manual selectable, Automatic locked');
    ok(await ev(`${tab}.querySelector('input[name=sy-eng][value=${BI ? 'builtin' : 'command'}]')?.checked === true`), 'engine selected: ' + (BI ? 'Built-in' : 'Own command'));
    ok(await ev(`[...${tab}.querySelectorAll('button')].find(b => b.textContent === 'Sync now')?.disabled === ${!BI}`), 'real project: Sync now ' + (BI ? 'enabled (built-in, manual; never clicked here)' : 'disabled (own command)'));
    await ev(`${tab}.querySelector('[data-sf=same]').click()`); await sleep(200); ok(await ev(`${tab}.querySelectorAll('tbody tr[data-note]').length`) === N, 'filter Unchanged: ' + N + ' rows');
    await ev(`${tab}.querySelector('[data-sf=create]').click()`); await sleep(200); ok(await ev(`/Nothing in this group/.test(${txt})`), 'filter Create: empty');
    await ev(`${tab}.querySelector('[data-sf=create]').click()`); await sleep(200);
    // window sizes
    for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 800], [1024, 768]]) { await size(w, h); await sleep(600);
      const o = await ev(`(() => { const e = ${tab}, r = e.getBoundingClientRect(), m = document.querySelector('main').getBoundingClientRect(); return { sw: e.scrollWidth, cw: e.clientWidth, inside: r.right <= m.right + 1 && r.left >= m.left - 1, cards: [...e.querySelectorAll('.card')].every(c => c.scrollWidth <= c.clientWidth + 1) } })()`);
      ok(o.sw <= o.cw + 1 && o.inside && o.cards, `${w}×${h}: Sync tab fits (${o.sw}/${o.cw})`); await shot(`sync-real-${w}`) }
    await size(1440, 900); await sleep(400); await ev(`document.getElementById('syn-prev').scrollIntoView()`); await sleep(300); await shot('sync-real-preview');
    // switch to the other real project and back
    await ev(`(() => { const s = document.getElementById('sy-p'); s.value = ${JSON.stringify(other.id)}; s.dispatchEvent(new Event('change', { bubbles: true })) })()`);
    ok(await wait(`/No Obsidian vault is linked/.test(${txt})`), 'switch: other real project shows its own state');
    ok(await ev(`!${txt}.includes('my-game') && !${txt}.includes('Project Docs') && !${tab}.querySelector('tbody tr[data-note]')`), 'switch: none of Spooky\'s notes, paths or rows');
    await shot('sync-real-other');
    await ev(`(() => { const s = document.getElementById('sy-p'); s.value = ${JSON.stringify(spooky.id)}; s.dispatchEvent(new Event('change', { bubbles: true })) })()`);
    ok(await wait(`${txt}.includes('Project Docs')`), 'switch back: Spooky preview again');
    ok(reqs.slice(r0).every(([m]) => m === 'GET'), 'Sync tab sent only GET requests (' + [...new Set(reqs.slice(r0).map(x => x[0]))] + ')');

    // ---------- fixture: isolation + conflict panel ----------
    await send('Page.navigate', { url: 'http://127.0.0.1:7791/preview#/knowledge/sync' });
    ok(await wait(`${txt}.includes('Conflicts · 1')`), 'fixture A: one first-sync conflict');
    const A = await ev(txt); ok(A.includes('Alpha Secret Lantern') && !/Beta|beta-/.test(A), 'fixture A shows only A');
    ok(await wait(`${txt}.includes('Price: 275') && ${txt}.includes('Price: 300')`), 'conflict: both versions side by side');
    await ev(`${tab}.querySelector('input[name=sy-res][value=vault]').click()`); await sleep(300);
    ok(/your choice: keep the Obsidian version/.test(await ev(txt)), 'choice shown (page only)');
    await ev(`document.getElementById('syn-cfl').scrollIntoView()`); await sleep(300); await shot('sync-fixture-conflict');
    await ev(`(() => { const s = document.getElementById('sy-p'); s.value = ${JSON.stringify(fx.B.id)}; s.dispatchEvent(new Event('change', { bubbles: true })) })()`);
    ok(await wait(`${txt}.includes('Beta Hidden Kart')`), 'switch to fixture B');
    const B = await ev(txt); ok(!/Alpha|alpha-|Lantern|Price: 2|your choice/.test(B), 'fixture B shows none of A\'s notes, paths, diff or choices');
    ok(/No conflicts in this preview/.test(B), 'fixture B: no conflicts');
    await ev(`(() => { const s = document.getElementById('sy-p'); s.value = ${JSON.stringify(fx.A.id)}; s.dispatchEvent(new Event('change', { bubbles: true })) })()`);
    ok(await wait(`/your choice: keep the Obsidian version/.test(${txt})`), 'back to A: its own choice kept');
    const fxFiles = [fx.A, fx.B].flatMap(p => [...walk(p.dir), ...walk(p.vault)]).length;
    ok(fxFiles === 10 && !fs.existsSync(path.join(fx.data, 'sync-base')) && !fs.existsSync(path.join(fx.data, 'sync-history.json')), 'fixture: nothing created (' + fxFiles + ' files)');
    // ---------- gate e1: confirmed manual sync on fixture A (temp files only) ----------
    const fxh = () => [fx.A, fx.B].flatMap(p => [...walk(p.dir), ...walk(p.vault)]).map(hash).join(), h0 = fxh(), pj0 = hash(path.join(fx.data, 'projects.json'));
    const btn = t => `[...${tab}.querySelectorAll('button')].find(b => b.textContent === '${t}')`, dl = `document.getElementById('sy-dlg')`;
    ok(await ev(`${btn('Sync now')}.disabled === false && /MANUAL/.test(${txt})`), 'fixture A (built-in, manual): Sync now enabled');
    await ev(`${btn('Sync now')}.click()`); ok(await wait(`${dl}?.open`), 'Sync now opens the confirm dialog');
    const W = await ev(`${dl}.innerText`); ok(/1 file will be written/.test(W) && /Alpha Secret Lantern/.test(W) && /Vault → Project/.test(W) && /1 matching pair recorded/.test(W), 'dialog lists exactly the writes (' + W.replace(/\s+/g, ' ').slice(0, 160) + ')');
    await shot('sync-e1-confirm');
    await ev(`${dl}.querySelector('button[value=x]').click()`); await sleep(400); ok(!(await ev(`${dl}.open`)) && fxh() === h0 && !fs.existsSync(path.join(fx.data, 'sync-base')), 'Cancel: nothing written');
    await ev(`${btn('Sync now')}.click()`); await wait(`${dl}?.open`); await ev(`${dl}.querySelector('button[value=ok]').click()`);
    ok(await wait(`/Sync finished/.test(${dl}.innerText)`), 'confirm: sync finished');
    const RS = await ev(`${dl}.innerText`); ok(/Vault → Project\s*1: Alpha Secret Lantern/.test(RS) && /Recorded\s*1/.test(RS), 'result lists the write + backup (' + RS.replace(/\s+/g, ' ').slice(0, 200) + ')');
    await shot('sync-e1-result'); await ev(`${dl}.querySelector('button[value=x]').click()`);
    const AL = n => path.join(n === 'p' ? path.join(fx.A.dir, 'docs') : fx.A.vault, 'Alpha Secret Lantern.md');
    ok(hash(AL('p')) === hash(AL('v')) && /Price: 275/.test(fs.readFileSync(AL('p'), 'utf8')), 'fixture A: project now has the Obsidian version');
    ok(await wait(`${tab}.querySelector('.syn-kpi[data-sf=same] b')?.textContent === '2' && ${tab}.querySelectorAll('#syn-hist tbody tr').length === 1`), 'preview reloads: 2 unchanged, 1 history row');
    ok([fx.B].flatMap(p => [...walk(p.dir), ...walk(p.vault)]).length === 5 && !fs.existsSync(path.join(fx.data, 'sync-base', fx.B.id)), 'fixture B untouched');
    await ev(`${tab}.querySelector('input[name=sy-mode][value=off]').click()`); ok(await wait(`${dl}?.open && /Change sync settings/.test(${dl}.innerText)`), 'mode change asks first');
    await ev(`${dl}.querySelector('button[value=x]').click()`); await sleep(500);
    ok(await ev(`${tab}.querySelector('input[name=sy-mode][value=manual]').checked`) && hash(path.join(fx.data, 'projects.json')) === pj0, 'Cancel: mode stays Manual, project list unchanged');
    ok(reqs.filter(([m]) => m !== 'GET').every(([, u]) => u.startsWith('http://127.0.0.1:7791/')), 'every POST went to the fixture server only');
    ok(!errs.length, 'no script errors (' + errs.join(' | ') + ')');
  } catch (e) { fail.push('crash: ' + e.message) }
  finally { // B53: Chrome's child processes can keep port 9336 for the next run, so end the whole tree first
    try { cp.execFileSync('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch { }
    for (const p of [ch, S1, S2]) try { p.kill() } catch { } await sleep(500); try { fs.rmSync(fx.R, { recursive: true, force: true }) } catch { } }
  const after = snap(), diffs = WATCH.filter((f, i) => before[i] !== after[i]).concat(NEW.filter((f, i) => before[WATCH.length + i] !== after[WATCH.length + i]));
  ok(!diffs.length, 'protected files unchanged (' + WATCH.length + ' files + ' + NEW.length + ' NEXUS folders) ' + diffs.join(', '));
  console.log(pass + '/' + (pass + fail.length) + ' passed' + (fail.length ? '\nFAIL: ' + fail.join(' | ') : '') + '\nscreenshots: ' + OUT);
  process.exit(fail.length ? 1 : 0);
})();
