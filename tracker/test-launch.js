// M4b check: node test-launch.js. launch.js unit checks (user-only launch.key, cookie / header, one-time 30 s codes, fail closed),
// then this folder's tracker.js on port 7794 (real data, background work removed like test-local): no token → 401 everywhere,
// /launch → HttpOnly cookie, `open --print` end to end, a restart voids old cookies. Writes launch.key in this folder (gitignored).
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), http = require('http');
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m), P = 7794, sleep = ms => new Promise(r => setTimeout(r, ms));
const acl = f => cp.execFileSync('icacls', [f], { encoding: 'utf8' }).split(/\r?\n/).map(l => l.replace(f, '').trim()).filter(l => /:\(/.test(l));
const ME = os.userInfo().username.toLowerCase();

// ---------- unit ----------
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-launch-')), KF = path.join(T, 'launch.key'), NT = process.env.NEXUS_TOKEN; delete process.env.NEXUS_TOKEN;
const L = require('./launch.js')(KF, P), key = fs.readFileSync(KF, 'utf8'), q = h => ({ headers: h });
ok(L.keyErr === null && /^[0-9a-f]{64}$/.test(key), 'launch.key written (64 hex)');
const who = acl(KF); ok(who.length === 1 && who[0].toLowerCase().split(':(')[0].endsWith('\\' + ME) && /\(F\)/.test(who[0]), 'launch.key ACL = only this user, full (' + who.join(' | ') + ')');
ok(!fs.existsSync(path.join(T, 'guard.log')), 'no guard.log on success');
ok(L.ok(q({ 'x-nexus-token': key })), 'header token ok'); ok(L.ok(q({ cookie: 'a=1; nexus' + P + '=' + key })), 'cookie token ok');
ok(!L.ok(q({})), 'no token refused'); ok(!L.ok(q({ 'x-nexus-token': key.slice(1) + 'x' })), 'wrong token refused'); ok(!L.ok(q({ 'x-nexus-token': key + '0' })), 'longer token refused');
ok(!L.ok(q({ cookie: 'nexus7788=' + key })), 'cookie for another port refused'); ok(!L.ok(q({ 'x-nexus-token': ['a', 'b'] })), 'non-string header refused');
const c1 = L.code(), set = L.redeem(c1); ok(set === `nexus${P}=${key}; HttpOnly; SameSite=Strict; Path=/`, 'redeem gives HttpOnly SameSite=Strict cookie');
ok(L.redeem(c1) === null, 'code works once'); ok(L.redeem('nope') === null && L.redeem(null) === null, 'unknown code refused');
// B61 /api/prove: HMAC of a client nonce, bound to port + protocol label; never the token, never for a bad nonce
const MAC = require('./launch.js').mac, N1 = 'a'.repeat(64), N2 = 'b'.repeat(64), p1 = L.prove(N1);
ok(/^[0-9a-f]{64}$/.test(p1) && p1 === MAC(key, P, N1) && p1 !== key && !p1.includes(key.slice(0, 16)), 'prove: 64-hex HMAC, not the token');
ok(L.prove(N2) !== p1, 'prove: another nonce → another MAC (no replay)'); ok(MAC(key, 7788, N1) !== p1, 'prove: MAC is bound to the port (no cross-port reuse)');
ok(MAC('f'.repeat(64), P, N1) !== p1, 'prove: another token → another MAC');
ok(['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), N1 + '\n', null, undefined, ['a'.repeat(64)], 5].every(n => L.prove(n) === null), 'prove: malformed nonces refused');
const now = Date.now, c2 = L.code(); Date.now = () => now() + 31e3; ok(L.redeem(c2) === null, 'code expires after 30 s'); Date.now = now;
const L2 = require('./launch.js')(KF, P); ok(!L2.ok(q({ 'x-nexus-token': key })), 'restart = new token, old one refused'); ok(fs.readFileSync(KF, 'utf8') !== key, 'restart rewrites launch.key');
const BAD = path.join(T, 'no-such-dir', 'launch.key'), L3 = require('./launch.js')(BAD, P);
ok(L3.keyErr && !fs.existsSync(BAD), 'fail closed: key not writable → keyErr, no file (' + L3.keyErr + ')'); ok(!L3.ok(q({})), 'fail closed: still locked');
process.env.NEXUS_TOKEN = 'b'.repeat(64); const KF2 = path.join(T, 'k2'), L4 = require('./launch.js')(KF2, P);
ok(!fs.existsSync(KF2) && L4.ok(q({ 'x-nexus-token': 'b'.repeat(64) })), 'NEXUS_TOKEN (tests): used, no launch.key written');
delete process.env.NEXUS_TOKEN; const KF3 = path.join(T, 'k3'), L5 = require('./launch.js')(KF3, P, true);
ok(!fs.existsSync(KF3), 'B57: deferred → no launch.key before publish()'); L5.publish(); ok(L5.keyErr === null && L5.ok(q({ 'x-nexus-token': fs.readFileSync(KF3, 'utf8') })), 'B57: publish() writes the key');
if (NT === undefined) delete process.env.NEXUS_TOKEN; else process.env.NEXUS_TOKEN = NT;
fs.rmSync(T, { recursive: true, force: true });

// ---------- end to end ----------
const run = (mode, extra = []) => { const boot = `const fs = require('fs'), M = require('module'), f = ${JSON.stringify(path.join(__dirname, 'tracker.js'))}, m = new M(f);
  const s = fs.readFileSync(f, 'utf8').replace('PORT = 7788', 'PORT = ${P}').replace(".listen(PORT, '127.0.0.1', () => {", ".listen(PORT, '127.0.0.1', () => { return;");
  if (!s.includes('PORT = ${P}') || !s.includes('{ return;')) process.exit(3);
  m.filename = f; m.paths = M._nodeModulePaths(${JSON.stringify(__dirname)}); process.argv.length = 2; process.argv.push(${JSON.stringify(mode)}, ...${JSON.stringify(extra)}); m._compile(s, f);`;
  const e = { ...process.env }; delete e.NEXUS_TOKEN; return cp.spawn(process.execPath, ['-e', boot], { cwd: __dirname, env: e, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }) };
const req = (p, h = {}, method = 'GET', body) => new Promise(r => { const x = http.request({ host: '127.0.0.1', port: P, path: p, method, headers: { host: '127.0.0.1:' + P, ...h } }, y => { let b = ''; y.on('data', c => b += c).on('end', () => r({ c: y.statusCode, h: y.headers, b })) }); x.on('error', () => r({ c: 0, h: {} })); x.end(body) });
const KEY = path.join(__dirname, 'launch.key'), LOG = path.join(__dirname, 'guard.log'), log0 = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
for (const n of ['serve.json', 'crashes.json']) fs.rmSync(path.join(__dirname, n), { force: true }); // P2a: this test force-kills its serve; start each run with no crash history (only P2a crash lines may appear in guard.log)
let S = run('serve');
(async () => {
  try {
    let up = 0; for (let i = 0; i < 40 && up !== 401; i++) { await sleep(250); up = (await req('/')).c }
    ok(up === 401, 'server up, GET / without token → 401 (hooks boot probe still sees it running)');
    const k = fs.readFileSync(KEY, 'utf8'), wk = acl(KEY), T1 = { 'x-nexus-token': k };
    ok(wk.length === 1 && wk[0].toLowerCase().split(':(')[0].endsWith('\\' + ME), 'live-style launch.key ACL = only this user (' + wk.join(' | ') + ')');
    const GETS = ['/', '/preview', '/preview/js/main.js', '/state.json', '/api', '/api/proc', '/api/projects', '/api/graph', '/api/vault', '/api/vault?op=note&p=MEMORY.md', '/api/sync', '/api/auto', '/api/sys', '/api/cc/tree?id=x', '/api/inv', '/api/plugin', '/api/catalog', '/api/setup/detect'];
    for (const p of GETS) { const r = await req(p); ok(r.c === 401 && !/[0-9a-f]{64}/.test(r.b), 'no token → 401 on ' + p + ' (' + r.c + ')') }
    const PJ = { origin: 'http://127.0.0.1:' + P, 'content-type': 'application/json' };
    for (const p of ['/api/act', '/api/projects', '/api/vault', '/api/auto', '/api/sys', '/api/plugin', '/api/catalog', '/api/sync/run', '/api/sync/engine', '/api/launch']) { const c = (await req(p, PJ, 'POST', '{}')).c; ok(c === 401, 'no token → 401 on POST ' + p + ' (' + c + ')') }
    ok((await req('/api', { cookie: 'nexus7788=' + k })).c === 401, 'cookie named for another port → 401');
    ok((await req('/api', { 'x-nexus-token': 'f'.repeat(64) })).c === 401, 'wrong token → 401');
    for (const p of ['/api', '/api/projects', '/preview', '/']) { const c = (await req(p, T1)).c; ok(c === 200, 'token header → 200 on ' + p + ' (' + c + ')') }
    ok((await req('/api/launch', { ...T1, 'content-type': 'application/json' }, 'POST', '{}')).c === 403, 'POST /api/launch without Origin → 403 (local.js first)');
    ok((await req('/launch?c=x', { host: 'evil.example:' + P })).c === 403, 'rebinding Host on /launch → 403');
    const code = JSON.parse((await req('/api/launch', { ...PJ, ...T1 }, 'POST', '{}')).b).code; ok(/^[0-9a-f]{32}$/.test(code), 'POST /api/launch → one-time code');
    const l = await req('/launch?c=' + code), ck = (l.h['set-cookie'] || [])[0] || '';
    ok(l.c === 302 && l.h.location === '/preview' && !l.h.location.includes(k), '/launch → 302 /preview, token not in the address');
    ok(ck === `nexus${P}=${k}; HttpOnly; SameSite=Strict; Path=/`, 'cookie HttpOnly SameSite=Strict Path=/');
    ok(/no-store/.test(l.h['cache-control']) && l.h['referrer-policy'] === 'no-referrer', '/launch not cached, no referrer');
    ok((await req('/preview', { cookie: ck.split(';')[0] })).c === 200, 'browser cookie → /preview 200');
    ok((await req('/launch?c=' + code)).c === 403, 'code reuse → 403'); ok((await req('/launch?c=bad')).c === 403, 'unknown code → 403');
    // B61 /api/prove end to end (no token needed, nothing about the token revealed)
    const n1 = require('crypto').randomBytes(32).toString('hex'), pr = await req('/api/prove?n=' + n1), pj = (() => { try { return JSON.parse(pr.b) } catch { return {} } })();
    ok(pr.c === 200 && pj.v === 1 && pj.mac === require('./launch.js').mac(k, P, n1) && !pr.b.includes(k) && /no-store/.test(pr.h['cache-control']), '/api/prove → 200 {v:1, mac} = HMAC(key), no-store, no token');
    const pw = await req('/api/prove?n=' + n1, { 'x-nexus-token': 'f'.repeat(64) });
    ok(pw.b === pr.b, '/api/prove ignores any sent token (cannot be used to check a guessed token)');
    for (const n of ['', 'zz', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'a'.repeat(64) + '&n=' + 'b'.repeat(64)]) ok((await req('/api/prove?n=' + n)).c === 400, '/api/prove malformed nonce → 400 (' + n.slice(0, 12) + ')');
    ok((await req('/api/prove?n=' + n1, { host: 'evil.example:' + P })).c === 403, '/api/prove rebinding Host → 403 (local.js first)');
    ok((await req('/api/prove?n=' + n1, { origin: 'https://evil.example' })).c === 403, '/api/prove foreign Origin → 403');
    ok((await req('/api/prove?n=' + n1, PJ, 'POST', '{}')).c === 401, 'POST /api/prove is not a route (401 locked)');
    await sleep(1100); const burst = await Promise.all(Array.from({ length: 20 }, () => req('/api/prove?n=' + n1))), n200 = burst.filter(x => x.c === 200).length, n429 = burst.filter(x => x.c === 429).length;
    ok(n200 === 10 && n429 === 10, '/api/prove rate limit: 20 at once → 10 × 200, 10 × 429 (' + n200 + '/' + n429 + ')'); await sleep(1100);
    const o = run('open', ['--print']); let out = ''; o.stdout.on('data', d => out += d); await new Promise(r => o.on('exit', r)); out = out.trim();
    ok(/^http:\/\/127\.0\.0\.1:7794\/launch\?c=[0-9a-f]{32}$/.test(out) && !out.includes(k), 'open --print → one-time link, no token (' + out.slice(0, 50) + ')');
    const lo = await req(out.replace('http://127.0.0.1:' + P, '')); ok(lo.c === 302 && (lo.h['set-cookie'] || [])[0].startsWith('nexus' + P + '=' + k), 'open link redeems to the cookie');
    S.kill(); await sleep(500); S = run('serve'); up = 0; for (let i = 0; i < 40 && up !== 401; i++) { await sleep(250); up = (await req('/')).c }
    ok((await req('/preview', { cookie: ck.split(';')[0] })).c === 401, 'restart: old browser cookie → 401');
    ok(fs.readFileSync(KEY, 'utf8') !== k, 'restart: new launch.key');
    const log1 = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : ''; ok(log1.slice(log0.length).split('\n').every(l => !l || /Z serve: the last run ended unexpectedly \(crash\)$/.test(l)) && !log1.includes(fs.readFileSync(KEY, 'utf8').trim()), 'guard.log unchanged apart from P2a crash lines (no ACL failure, no token logged)');
    const k2 = fs.readFileSync(KEY, 'utf8'), S2 = run('serve'), x2 = await new Promise(r => S2.on('exit', r)); // B57: second tracker while one runs
    const log2 = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
    ok(x2 === 0 && fs.readFileSync(KEY, 'utf8') === k2, 'B57: second serve on a busy port exits, launch.key unchanged');
    ok((await req('/api', { 'x-nexus-token': k2 })).c === 200, 'B57: running tracker still accepts the key in launch.key');
    ok(/serve not started: port 7794 already in use/.test(log2.slice(log1.length)) && !log2.includes(k2), 'B57: guard.log says why, no token logged');
  } finally { S.kill() }
  console.log(`test-launch: ${pass}/${pass + fail.length} passed` + (fail.length ? ' | FAIL: ' + fail.join(' | ') : ''));
  process.exit(fail.length ? 1 : 0);
})();
