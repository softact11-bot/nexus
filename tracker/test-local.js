// M4a check: node test-local.js. The local-access guard (local.js) as a unit, then end to end on this folder's tracker.js routes
// (port 7792, real data, read-only: only refused POSTs are sent; background work removed like test-sync-tab).
// Refused: foreign / rebinding Host, foreign or null Origin, POST without Origin or JSON type. Allowed: same-origin pages, hooks' GET /.
const cp = require('child_process'), path = require('path'), http = require('http'), L = require('./local.js'), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m), P = 7792;

// ---------- unit ----------
const q = (h = {}, method = 'GET', ip = '127.0.0.1') => ({ method, headers: { host: '127.0.0.1:' + P, ...h }, socket: { remoteAddress: ip } });
const J = { origin: 'http://127.0.0.1:' + P, 'content-type': 'application/json' };
ok(L(q(), P), 'plain GET allowed');
ok(L(q({ host: 'localhost:' + P }), P), 'localhost Host allowed');
ok(L(q({}, 'GET', '::ffff:127.0.0.1'), P) && L(q({}, 'GET', '::1'), P), 'IPv4-mapped and IPv6 loopback allowed');
ok(L(q(J, 'POST'), P) && L(q({ ...J, origin: 'http://localhost:' + P, host: 'localhost:' + P }, 'POST'), P), 'same-origin JSON POST allowed');
ok(!L(q({ host: 'evil.example:' + P }), P), 'rebinding Host refused');
ok(!L(q({ host: '127.0.0.1:7788' }), P), 'other port in Host refused');
ok(!L(q({ host: undefined }), P), 'missing Host refused');
ok(!L(q({}, 'GET', '192.168.1.5'), P), 'non-loopback address refused');
ok(!L(q({ origin: 'https://evil.example' }), P), 'foreign Origin on GET refused');
ok(!L(q({ origin: 'null' }), P), 'null Origin refused');
ok(!L(q({ origin: 'https://127.0.0.1:' + P }), P), 'https Origin refused');
ok(!L(q({ 'content-type': 'application/json' }, 'POST'), P), 'POST without Origin refused');
ok(!L(q({ origin: J.origin, 'content-type': 'text/plain' }, 'POST'), P), 'POST text/plain refused');
ok(!L(q({ ...J, origin: 'https://evil.example' }, 'POST'), P), 'cross-site POST refused');

// ---------- end to end ----------
const TOK = require('crypto').randomBytes(32).toString('hex'); // M4b: test server token (no launch.key); every request below carries it, so only local.js decides
const boot = `const fs = require('fs'), M = require('module'), f = ${JSON.stringify(path.join(__dirname, 'tracker.js'))}, m = new M(f);
  const s = fs.readFileSync(f, 'utf8').replace('PORT = 7788', 'PORT = ${P}').replace(".listen(PORT, '127.0.0.1', () => {", ".listen(PORT, '127.0.0.1', () => { return;");
  if (!s.includes('PORT = ${P}') || !s.includes('{ return;')) process.exit(3);
  m.filename = f; m.paths = M._nodeModulePaths(${JSON.stringify(__dirname)}); process.argv[2] = 'serve'; m._compile(s, f);`;
const S = cp.spawn(process.execPath, ['-e', boot], { cwd: __dirname, env: { ...process.env, NEXUS_TOKEN: TOK }, stdio: 'ignore', windowsHide: true });
const req = (p, h = {}, method = 'GET', body) => new Promise(r => { const x = http.request({ host: '127.0.0.1', port: P, path: p, method, headers: { host: '127.0.0.1:' + P, 'x-nexus-token': TOK, ...h } }, y => { y.resume(); r(y.statusCode) }); x.on('error', () => r(0)); x.end(body) });
(async () => {
  try {
    let up = 0; for (let i = 0; i < 40 && up !== 200; i++) { await sleep(250); up = await req('/') }
    ok(up === 200, 'server up, hooks-style GET / allowed');
    const GETS = ['/api', '/api/proc', '/api/projects', '/api/graph', '/api/vault', '/api/vault?op=note&p=MEMORY.md', '/api/sync', '/api/auto', '/api/sys', '/api/cc/tree?id=x', '/api/inv', '/api/plugin', '/api/catalog', '/api/setup/detect', '/preview', '/preview/js/main.js'];
    for (const p of GETS) { const c = await req(p, { host: 'evil.example:' + P }); ok(c === 403, 'rebinding Host refused on ' + p + ' (' + c + ')') }
    for (const p of ['/api', '/api/vault?op=note&p=MEMORY.md', '/api/cc/file?id=x&f=a']) { const c = await req(p, { origin: 'https://evil.example' }); ok(c === 403, 'foreign Origin refused on ' + p + ' (' + c + ')') }
    for (const p of ['/api', '/api/projects', '/preview']) { const c = await req(p); ok(c === 200, 'same-origin GET ' + p + ' still 200 (' + c + ')') }
    const POSTS = ['/api/act', '/api/projects', '/api/vault', '/api/auto', '/api/sys', '/api/plugin', '/api/catalog', '/api/sync/run', '/api/sync/engine'];
    for (const p of POSTS) { // bodies are invalid on purpose: even a guard miss could not change anything
      const a = await req(p, { origin: 'https://evil.example', 'content-type': 'application/json' }, 'POST', '{}');
      const b = await req(p, { origin: 'http://127.0.0.1:' + P, 'content-type': 'text/plain' }, 'POST', '{}');
      const c = await req(p, { 'content-type': 'application/json' }, 'POST', '{}');
      ok(a === 403 && b === 403 && c === 403, 'POST ' + p + ' refused: foreign Origin / text / no Origin (' + [a, b, c] + ')');
    }
  } catch (e) { fail.push('crash: ' + e.message) }
  finally { try { S.kill() } catch { } }
  console.log(pass + '/' + (pass + fail.length) + ' passed' + (fail.length ? '\nFAIL: ' + fail.join(' | ') : ''));
  process.exit(fail.length ? 1 : 0);
})();
