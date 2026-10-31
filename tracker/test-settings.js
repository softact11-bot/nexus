// M4e check: node test-settings.js. GET / POST /api/settings on this folder's tracker.js (port 7796, temp NEXUS_DATA, background work
// removed like test-local). Round trip equals the export JSON, 64 KB cap, bad / foreign bodies refused, guard + token required.
// Client half: app/js/settings.js run with fake localStorage + fetch (empty storage imports the server copy, saves mirror to the server).
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m), P = 7796;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-set-')), SF = path.join(DATA, 'settings.json');
const TOK = require('crypto').randomBytes(32).toString('hex');
const boot = `const fs = require('fs'), M = require('module'), f = ${JSON.stringify(path.join(__dirname, 'tracker.js'))}, m = new M(f);
  const s = fs.readFileSync(f, 'utf8').replace('PORT = 7788', 'PORT = ${P}').replace(".listen(PORT, '127.0.0.1', () => {", ".listen(PORT, '127.0.0.1', () => { return;");
  if (!s.includes('PORT = ${P}') || !s.includes('{ return;')) process.exit(3);
  m.filename = f; m.paths = M._nodeModulePaths(${JSON.stringify(__dirname)}); process.argv[2] = 'serve'; process.argv[3] = '--manual'; m._compile(s, f);`; // --manual: in-place test servers that get killed leave crash records here; skip the crash-loop gate (M7a)
const S = cp.spawn(process.execPath, ['-e', boot], { cwd: __dirname, env: { ...process.env, NEXUS_TOKEN: TOK, NEXUS_DATA: DATA }, stdio: 'ignore', windowsHide: true });
const J = { origin: 'http://127.0.0.1:' + P, 'content-type': 'application/json' };
const req = (p, h = {}, method = 'GET', body, tok = TOK) => new Promise(r => { const x = http.request({ host: '127.0.0.1', port: P, path: p, method, headers: { host: '127.0.0.1:' + P, ...(tok ? { 'x-nexus-token': tok } : {}), ...h } }, y => { let b = ''; y.on('data', c => b += c).on('end', () => r({ c: y.statusCode, b })) }); x.on('error', () => r({ c: 0, b: '' })); x.end(body) });
const exp = o => JSON.stringify({ version: 1, settings: o }, null, 2); // = settings.js exportJSON()
(async () => {
  try {
    let up = 0; for (let i = 0; i < 40 && up !== 200; i++) { await sleep(250); up = (await req('/')).c }
    ok(up === 200, 'server up');
    let g = await req('/api/settings'); ok(g.c === 200 && JSON.parse(g.b).settings === null, 'GET with no file → settings null (' + g.c + ')');
    const A = exp({ 'ui.accent': '#123456', 'sound.volume': .3, 'pl.key': ['a'] });
    let p = await req('/api/settings', J, 'POST', A); ok(p.c === 200 && JSON.parse(p.b).res === 'ok', 'POST export → ok (' + p.c + ')');
    g = await req('/api/settings'); ok(g.b === A, 'GET returns exactly the export JSON');
    ok(fs.readFileSync(SF, 'utf8') === A, 'stored in <data>/settings.json');
    ok(!fs.existsSync(SF + '.tmp'), 'no temp file left');
    for (const [b, m] of [['{bad', 'bad JSON'], ['{"version":2,"settings":{}}', 'version 2'], ['{"version":1,"settings":[]}', 'array settings'], ['{"version":1}', 'no settings'], ['null', 'null']]) {
      p = await req('/api/settings', J, 'POST', b); ok(p.c === 400, m + ' → 400 (' + p.c + ')');
    }
    ok(fs.readFileSync(SF, 'utf8') === A, 'refused POSTs left the file unchanged');
    p = await req('/api/settings', J, 'POST', exp({ big: 'x'.repeat(70e3) })); ok(p.c !== 200, 'body over 64 KB refused (' + p.c + ')');
    ok(fs.readFileSync(SF, 'utf8') === A, 'oversize POST left the file unchanged');
    const B = exp({ big: 'y'.repeat(60e3) }); p = await req('/api/settings', J, 'POST', B); ok(p.c === 200, 'body just under 64 KB accepted (' + p.c + ')');
    ok((await req('/api/settings', J, 'POST', A)).c === 200, 'restore A');
    ok((await req('/api/settings', J, 'PUT', A)).c === 403 || (await req('/api/settings', J, 'PUT', A)).c === 405, 'PUT refused');
    ok((await req('/api/settings', {}, 'GET', null, '')).c === 401, 'GET without token → 401');
    ok((await req('/api/settings', J, 'POST', A, 'f'.repeat(64))).c === 401, 'POST with wrong token → 401');
    ok((await req('/api/settings', { host: 'evil.example:' + P })).c === 403, 'rebinding Host refused');
    ok((await req('/api/settings', { ...J, origin: 'https://evil.example' }, 'POST', A)).c === 403, 'foreign Origin POST refused');
    ok((await req('/api/settings', { origin: J.origin, 'content-type': 'text/plain' }, 'POST', A)).c === 403, 'text/plain POST refused');
    ok((await req('/api/settings', { 'content-type': 'application/json' }, 'POST', A)).c === 403, 'POST without Origin refused');
    ok(fs.readFileSync(SF, 'utf8') === A, 'refused requests left the file unchanged');

    // ---------- client: settings.js with fake localStorage + fetch routed to the test server ----------
    const src = 'data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(__dirname, 'app/js/settings.js'), 'utf8'));
    const env = store => { const ls = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v) } }, posts = [];
      Object.assign(globalThis, { localStorage: ls, addEventListener() { }, matchMedia: () => ({ matches: false }),
        fetch: async (u, o = {}) => { if (o.method === 'POST') posts.push(o.body); const y = await req(u, { ...J, ...(o.headers || {}) }, o.method || 'GET', o.body); return { ok: y.c === 200, json: async () => JSON.parse(y.b) } } });
      return posts };
    let store = {}, posts = env(store); const M1 = await import(src + '%2F%2F1');
    await sleep(300); ok(M1.get('ui.accent') === '#123456' && M1.pref('sound.volume') === .3, 'empty localStorage imports the server copy');
    ok(JSON.parse(store['nexus.settings.v1'] || '{}')['ui.accent'] === '#123456', 'imported copy written to localStorage');
    ok(posts.length === 0, 'import does not POST back');
    M1.setPref('ui.accent', '#654321'); M1.setPref('sound.volume', .9); await sleep(700);
    ok(posts.length === 1, 'two quick saves → one POST (debounced) (' + posts.length + ')');
    g = await req('/api/settings'); ok(g.b === M1.exportJSON(), 'server copy equals exportJSON() after save');
    store = { 'nexus.settings.v1': JSON.stringify({ 'ui.theme': 'light' }) }; posts = env(store); const M2 = await import(src + '%2F%2F2');
    await sleep(300); ok(M2.get('ui.theme') === 'light' && M2.get('ui.accent') === undefined, 'filled localStorage wins over the server copy');
    g = await req('/api/settings'); ok(JSON.parse(g.b).settings['ui.theme'] === 'light', 'load with local prefs mirrors them to the server');
    store = {}; posts = env(store); globalThis.fetch = async () => { throw new Error('offline') }; const M3 = await import(src + '%2F%2F3');
    await sleep(100); M3.setPref('a11y.scale', 120); await sleep(600); ok(JSON.parse(store['nexus.settings.v1'])['a11y.scale'] === 120, 'server down: localStorage still saves');
  } catch (e) { fail.push('crash: ' + e.message) }
  finally { try { S.kill() } catch { } try { fs.rmSync(DATA, { recursive: true, force: true }) } catch { } }
  console.log(pass + '/' + (pass + fail.length) + ' passed' + (fail.length ? '\nFAIL: ' + fail.join(' | ') : ''));
  process.exit(fail.length ? 1 : 0);
})();
