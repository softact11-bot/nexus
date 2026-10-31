// Self-check for NEXUS accounts (accounts.js, post-M7 Phase 14) against a mock Google on loopback. node test-accounts.js
// Temp data folder, test-only Credential Manager targets (NEXUS-test-<rand>/…, all deleted at the end), no browser, no real Google.
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), crypto = require('crypto'), a = require('assert');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-acc-')), KR = 'NEXUS-test-' + crypto.randomBytes(4).toString('hex') + '/', CID = 'test-client.apps.googleusercontent.com';
const codes = new Map(), revoked = new Set(); let down = false, revokeDown = false, calls = { revoke: 0 };
const jwt = c => ['e30', Buffer.from(JSON.stringify(c)).toString('base64url'), 'sig'].join('.');
const claims = (sub, x = {}) => ({ iss: 'https://accounts.google.com', aud: CID, sub, email: sub + '@example.com', email_verified: true, name: 'User ' + sub, iat: Date.now() / 1000 | 0, exp: (Date.now() / 1000 | 0) + 3600, ...x });
const mock = http.createServer((q, r) => { let b = ''; q.on('data', c => b += c).on('end', () => {
  const f = Object.fromEntries(new URLSearchParams(b)), send = (s, o) => { r.writeHead(s, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)) };
  if (down) return send(503, { error: 'backend_error' });
  if (q.url === '/revoke') { calls.revoke++; if (revokeDown) return send(503, { error: 'backend_error' }); revoked.add(f.token); return send(200, {}) }
  if (f.client_id !== CID || f.client_secret !== 'test-secret') return send(401, { error: 'invalid_client' });
  if (f.grant_type === 'authorization_code') { const c = codes.get(f.code); codes.delete(f.code);
    if (!c || f.redirect_uri !== c.redirect || crypto.createHash('sha256').update(f.code_verifier || '').digest('base64url') !== c.challenge) return send(400, { error: 'invalid_grant' });
    return send(200, { id_token: jwt({ ...claims(c.sub, c.x), nonce: c.x.nonce ?? c.nonce }), refresh_token: 'rt-' + c.sub + '-' + crypto.randomBytes(3).toString('hex'), access_token: 'at' }) }
  if (f.grant_type === 'refresh_token') { if (revoked.has(f.refresh_token)) return send(400, { error: 'invalid_grant' }); return send(200, { id_token: jwt(claims(f.refresh_token.split('-')[1])), access_token: 'at' }) }
  send(400, { error: 'unsupported_grant_type' }) }) });

(async () => {
  await new Promise(r => mock.listen(0, '127.0.0.1', r)); const M = 'http://127.0.0.1:' + mock.address().port;
  Object.assign(process.env, { NEXUS_DATA: T, NEXUS_KR: KR, NEXUS_NO_BROWSER: '1', NEXUS_GOOGLE_CLIENT: CID, NEXUS_GOOGLE_SECRET: 'test-secret', NEXUS_GOOGLE_EP: JSON.stringify({ auth: M + '/auth', token: M + '/token', revoke: M + '/revoke' }) });
  const A = require('./accounts.js'), X = require('./assist.js'), kr = A._.kr, h = o => A.handle(o), st = () => A.status();
  const get = u => new Promise((res, rej) => http.get(u, r => { let b = ''; r.on('data', c => b += c).on('end', () => res({ s: r.statusCode, b })) }).on('error', rej));
  const wait = async () => { for (let i = 0; i < 100 && st().flow?.st === 'wait'; i++) await new Promise(r => setTimeout(r, 20)); return st().flow };
  // "browser": read the auth URL, let mock Google issue a code, hit the loopback callback
  async function signIn(sub, x = {}, { state, hint } = {}) {
    const g = await h({ op: 'google', hint }); a.equal(g.res, 'ok'); const u = new URL(g.url), p = k => u.searchParams.get(k);
    a.equal(p('code_challenge_method'), 'S256'); a.equal(p('code_challenge').length, 43); a.equal(p('scope'), 'openid email profile'); a.equal(p('client_id'), CID); a.equal(p('response_type'), 'code');
    a.match(p('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/cb$/); a.ok(p('state').length >= 32 && p('nonce').length >= 32);
    const code = crypto.randomBytes(8).toString('hex'); codes.set(code, { sub, x, nonce: p('nonce'), challenge: p('code_challenge'), redirect: p('redirect_uri') });
    const r = await get(p('redirect_uri') + '?code=' + code + '&state=' + (state || p('state'))); return { r, u, f: await wait(), p };
  }
  const idx = () => JSON.parse(fs.readFileSync(path.join(T, 'accounts', 'index.json'), 'utf8'));

  // before any account: original folder, login shown as first run
  a.equal(A.dir(), T); a.equal(st().first, true); a.equal(st().cur, null);
  // 1 first Google sign-in → legacy account, refresh token only in Credential Manager
  let s = await signIn('111'); a.equal(s.r.s, 200); a.match(s.r.b, /Signed in as 111@example\.com/); a.equal(s.f.st, 'done');
  const A1 = s.f.id; a.equal(st().list[0].legacy, true); a.match(await kr('get', KR + 'google/' + A1), /^rt-111-/); a.ok(!/rt-/.test(fs.readFileSync(path.join(T, 'accounts', 'index.json'), 'utf8')));
  let w = await h({ op: 'switch', id: A1, ui: { a: '1' } }); a.equal(w.res, 'ok'); a.equal(w.ui, null); a.equal(A.dir(), T); // first account keeps the original data and storage
  a.equal(st().flow, null); // the finished sign-in was used once: a reloaded login page will not resume it again
  // callback is single-use: replay after done is refused, port closed
  a.ok(await get(s.p('redirect_uri') + '?code=x&state=' + s.p('state')).then(r => r.s === 400, () => true));
  // 2 bad state: stray request refused, real sign-in still finishes
  { const g = await h({ op: 'google' }), u = new URL(g.url), p = k => u.searchParams.get(k); const bad = await get(p('redirect_uri') + '?code=zz&state=wrong'); a.equal(bad.s, 400); a.equal(st().flow.st, 'wait');
    const code = 'c2'; codes.set(code, { sub: '111', x: {}, nonce: p('nonce'), challenge: p('code_challenge'), redirect: p('redirect_uri') }); await get(p('redirect_uri') + '?code=' + code + '&state=' + p('state')); a.equal((await wait()).id, A1) } // same Google account → same NEXUS account
  // 3 ID token checks
  for (const [x, m] of [[{ nonce: 'other' }, /nonce/], [{ aud: 'evil.apps.googleusercontent.com' }, /audience/], [{ iss: 'https://evil.example' }, /issuer/], [{ exp: 1 }, /expired/], [{ email_verified: false }, /confirm this email/]]) {
    s = await signIn('999', x); a.equal(s.f.st, 'error'); a.match(s.f.msg, m); a.equal(s.r.s, 400) }
  a.equal(st().list.length, 1); // none of them made an account
  // 4 PKCE: a code redeemed with the wrong verifier is refused (mock checks S256)
  { const g = await h({ op: 'google' }), u = new URL(g.url), p = k => u.searchParams.get(k); codes.set('c4', { sub: '111', x: {}, nonce: p('nonce'), challenge: 'x'.repeat(43), redirect: p('redirect_uri') });
    await get(p('redirect_uri') + '?code=c4&state=' + p('state')); const f = await wait(); a.equal(f.st, 'error'); a.match(f.msg, /did not accept/) }
  // 5 cancel in browser + cancel in NEXUS
  { const g = await h({ op: 'google' }), u = new URL(g.url); await get(u.searchParams.get('redirect_uri') + '?error=access_denied&state=' + u.searchParams.get('state')); a.match((await wait()).msg, /cancelled in the browser/) }
  { await h({ op: 'google' }); await h({ op: 'cancel' }); a.equal(st().flow.st, 'error') }
  // 6 second account: own folder; assist memory and page storage stay apart
  a.equal(X.post({ op: 'remember', text: 'note of A' }).res, 'ok');
  s = await signIn('222'); const B = s.f.id; a.notEqual(B, A1); w = await h({ op: 'switch', id: B, ui: { theme: 'A-theme' } }); a.equal(w.res, 'ok'); a.deepEqual(w.ui, {});
  a.equal(A.dir(), path.join(T, 'accounts', B)); a.equal(X.status().memory.length, 0); a.equal(X.post({ op: 'remember', text: 'note of B' }).res, 'ok');
  w = await h({ op: 'switch', id: A1, ui: { theme: 'B-theme' } }); a.deepEqual(w.ui, { theme: 'A-theme' }); a.deepEqual(X.status().memory.map(m => m.x), ['note of A']);
  w = await h({ op: 'switch', id: B, ui: {} }); a.deepEqual(w.ui, { theme: 'B-theme' }); a.deepEqual(X.status().memory.map(m => m.x), ['note of B']);
  // 7 sign out: revoked at Google, key deleted, signed-out account needs Google again, no account's data while signed out
  const rtB = await kr('get', KR + 'google/' + B), rv = calls.revoke; w = await h({ op: 'signout', ui: { theme: 'B2' } }); a.equal(w.res, 'ok');
  a.equal(w.revoke, 'ok'); a.equal(calls.revoke, rv + 1); a.ok(revoked.has(rtB)); a.equal(await kr('get', KR + 'google/' + B), null); a.equal(st().cur, null); a.equal(A.dir(), path.join(T, 'accounts', '_none')); a.equal(X.status().memory.length, 0);
  a.equal((await h({ op: 'switch', id: B })).res, 'signin');
  s = await signIn('222', {}, { hint: '222@example.com' }); a.equal(s.u.searchParams.get('login_hint'), '222@example.com'); a.equal(s.f.id, B); a.equal(st().list.find(x => x.id === B).out, false);
  w = await h({ op: 'switch', id: B }); a.deepEqual(w.ui, { theme: 'B2' }); // its settings came back
  // 8 re-check on switch: Google refusing the stored key → sign in again; Google down → allowed (local data)
  let o = idx(); o.list.find(x => x.id === A1).chk = 0; fs.writeFileSync(path.join(T, 'accounts', 'index.json'), JSON.stringify(o));
  down = true; a.equal((await h({ op: 'switch', id: A1 })).res, 'ok'); down = false; // offline: allowed, re-checked next time
  o = idx(); o.list.find(x => x.id === B).chk = 0; fs.writeFileSync(path.join(T, 'accounts', 'index.json'), JSON.stringify(o)); revoked.add(await kr('get', KR + 'google/' + B));
  a.equal((await h({ op: 'switch', id: B })).res, 'signin'); a.equal(await kr('get', KR + 'google/' + B), null); a.equal(st().cur, A1); // stays on A
  // 8b revoke not confirmed: signed out locally anyway, key deleted, reported as 'failed' (Google down) / 'none' (no key stored), never 'ok'
  const rtA = await kr('get', KR + 'google/' + A1); revokeDown = true; w = await h({ op: 'signout', ui: {} }); revokeDown = false;
  a.equal(w.res, 'ok'); a.equal(w.revoke, 'failed'); a.equal(w.email, '111@example.com'); a.ok(!revoked.has(rtA)); a.equal(await kr('get', KR + 'google/' + A1), null); a.equal(st().cur, null); a.equal(st().list.find(x => x.id === A1).out, true);
  await signIn('111'); await kr('del', KR + 'google/' + A1); w = await h({ op: 'switch', id: A1 }); a.equal(w.res, 'ok'); w = await h({ op: 'signout' }); a.equal(w.revoke, 'none'); a.equal(st().cur, null);
  a.deepEqual(await h({ op: 'perms', url: 'https://evil.example' }), { res: 'ok', url: 'https://myaccount.google.com/connections' }); // fixed page only
  // 8c Credential Manager: async (server not blocked), queued in call order on the same key
  { const K = KR + 'q', p = Promise.all([kr('set', K, 'v1'), kr('get', K), kr('set', K, 'v2'), kr('get', K), kr('del', K), kr('get', K), kr('del', K)]); let ticks = 0; const iv = setInterval(() => ticks++, 10);
    const [, g1, , g2, , g3, d2] = await p; clearInterval(iv); a.equal(g1, 'v1'); a.equal(g2, 'v2'); a.equal(g3, null); a.equal(d2, null); a.ok(ticks > 5, 'event loop ran during keyring calls: ' + ticks);
    await a.rejects(kr('get', ''), /Credential Manager failed/); a.equal(await kr('get', K), null) } // a failed call does not stall the queue
  // 9 local profile + remove
  w = await h({ op: 'local', ui: {} }); a.equal(w.res, 'ok'); const L = st().cur; a.notEqual(L, A1); a.equal(st().list.find(x => x.id === L).kind, 'local');
  a.match((await h({ op: 'remove', id: L })).res, /Switch to another/); a.match((await h({ op: 'remove', id: A1 })).res, /original NEXUS data/);
  a.ok(fs.existsSync(path.join(T, 'accounts', B))); w = await h({ op: 'remove', id: B }); a.equal(w.res, 'ok'); a.equal(w.revoke, 'none'); a.ok(!fs.existsSync(path.join(T, 'accounts', B))); a.equal(st().list.length, 2);
  a.equal((await h({ op: 'nope' })).res, 'bad request'); a.equal((await h({ op: 'switch', id: '../x' })).res, 'not found');
  // 10 the real Credential Manager round trip with the test prefix (set/get/del); index never holds a secret
  a.ok(!/rt-|test-secret/.test(fs.readFileSync(path.join(T, 'accounts', 'index.json'), 'utf8')));
  for (const id of [A1, B]) try { await kr('del', KR + 'google/' + id) } catch { }
  mock.close(); fs.rmSync(T, { recursive: true, force: true });
  console.log('test-accounts: all checks passed');
})().catch(e => { console.error(e); process.exit(1) }); // on failure: test credentials may stay; list with: cmdkey /list | findstr NEXUS-test
