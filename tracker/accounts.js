// NEXUS accounts (post-M7 Phase 14; user 2026-10-29: local-only, Google first, no cloud sync, no plaintext secrets).
// Index <data>/accounts/index.json { cur, list: [{ id, kind: 'google'|'local', sub, name, email, legacy, out, at, chk }] }, no secrets.
// Per-account data: <data>/accounts/<id>/ (assist chats, memory, tasks, learned rule, attachments; settings.json; ui.json = the
// page's localStorage at switch time). The first account ever made keeps the original <data> folder (legacy), so nothing is moved.
// Shared on purpose (they come from this PC's one Claude Code login): usage, sessions, projects list, automations, sync.
// Google: system browser, Authorization Code + PKCE S256, random state + nonce, loopback http://127.0.0.1:<random>/cb, scopes
// openid email profile. The ID token comes straight from Google's token endpoint over TLS (OpenID Connect Core 3.1.3.7: TLS stands
// in for the signature check); iss, aud, exp, iat, nonce, sub and email_verified are checked. The refresh token goes only to
// Windows Credential Manager (keyring.ps1); sign-out asks Google to revoke it, deletes it here, and reports whether Google confirmed. Switching to a Google account re-checks
// it (at most every 10 min); Google refusing it = sign in again; no network = allowed (data is local), re-checked next time.
// CLI: node accounts.js secret   (store the Desktop client's secret in Credential Manager; Google's token endpoint asks for it)
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto'), cp = require('child_process'), RED = require('./redact.js');
const DATA = process.env.NEXUS_DATA || __dirname, AC = path.join(DATA, 'accounts'), IDX = path.join(AC, 'index.json');
const CLIENT = process.env.NEXUS_GOOGLE_CLIENT || ''; // your own Google OAuth client id; without one the Google button is hidden
const EP = { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke', ...JSON.parse(process.env.NEXUS_GOOGLE_EP || '{}') }; // EP override: tests only
const KR = process.env.NEXUS_KR || 'NEXUS/', ISS = ['https://accounts.google.com', 'accounts.google.com'], RECHECK = 10 * 60e3, WAIT = 5 * 60e3;

// Windows Credential Manager (async: the server keeps answering during the ~0.5 s PowerShell start). Calls run one at a time in call
// order, so a set / get / del on the same key never overtake each other. The secret goes over stdin, never on the command line.
function kr1(op, t, s) {
  return new Promise((res, rej) => {
    const c = cp.execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'keyring.ps1'), op, t], { encoding: 'utf8', windowsHide: true, timeout: 30e3 }, (e, out, err) => {
      const st = e ? e.code : 0;
      if (st === 0) return res(op === 'get' ? out : true);
      if (st === 3) return res(null);
      rej(new Error('Windows Credential Manager failed: ' + RED(String(err || e.message || st).split('\n')[0])));
    });
    c.stdin.on('error', () => { }); c.stdin.end(s || '');
  });
}
let krQ = Promise.resolve();
const kr = (op, t, s) => { const p = krQ.then(() => kr1(op, t, s)); krQ = p.catch(() => { }); return p };
const keyT = a => KR + 'google/' + a.id;
// The Desktop client secret: env, this PC's Credential Manager, or google-client.json { "secret": "..." } shipped next to this file by Setup (gitignored).
// Google treats installed-app secrets as non-confidential; PKCE still protects each sign-in. No secret anywhere = the Google button is hidden.
const GF = path.join(__dirname, 'google-client.json'), gfile = () => { try { return JSON.parse(fs.readFileSync(GF, 'utf8')).secret || null } catch { return null } };
let SEC = null; const secret = async () => SEC ||= process.env.NEXUS_GOOGLE_SECRET || await kr('get', KR + 'google-client-secret').catch(() => null) || gfile();
secret().catch(() => { }); // warm SEC so status() knows whether Google sign-in can work
const PERMS = 'https://myaccount.google.com/connections'; // Google Account → Security → Third-party apps & services
const browse = u => { if (!process.env.NEXUS_NO_BROWSER) cp.spawn('rundll32', ['url.dll,FileProtocolHandler', u], { detached: true, stdio: 'ignore', windowsHide: true }).unref() }; // system browser, no shell

const rd = () => { try { const o = JSON.parse(fs.readFileSync(IDX, 'utf8')); return { cur: o.cur || null, list: Array.isArray(o.list) ? o.list : [] } } catch { return { cur: null, list: [] } } };
const wr = o => { fs.mkdirSync(AC, { recursive: true }); fs.writeFileSync(IDX + '.tmp', JSON.stringify(o, null, 1)); fs.renameSync(IDX + '.tmp', IDX) };
const dirOf = a => a.legacy ? DATA : path.join(AC, a.id);
// Data folder of the signed-in account. No accounts yet = the original folder (installs before Phase 14); signed out = an empty one.
function dir() { const o = rd(), a = o.list.find(x => x.id === o.cur); return a ? dirOf(a) : o.list.length ? path.join(AC, '_none') : DATA }
const pub = a => ({ id: a.id, kind: a.kind, name: a.name, email: a.email || null, out: !!a.out, legacy: !!a.legacy, at: a.at });
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const b64 = n => crypto.randomBytes(n).toString('base64url'), uid = () => crypto.randomBytes(6).toString('hex');
const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

function stopRuns() { // switching / signing out: stop a running assistant answer and the microphone first
  try { require('./assist.js').stopAny() } catch { }
  try { require('./voice.js').post({ op: 'stop' }) } catch { }
}
const saveUi = (a, ui) => { if (!ui || typeof ui !== 'object' || Array.isArray(ui)) return; const d = dirOf(a), o = {}; for (const [k, v] of Object.entries(ui)) if (typeof v === 'string') o[k] = v; fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'ui.json'), JSON.stringify(o)) };
// null = keep the page's current storage (first switch into the original data: its settings are already there)
const loadUi = a => { try { return JSON.parse(fs.readFileSync(path.join(dirOf(a), 'ui.json'), 'utf8')) } catch { return a.legacy ? null : {} } };

async function post(url, form) {
  let r; try { r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(15e3) }) }
  catch { throw Object.assign(new Error('Could not reach Google. Check the internet connection and try again.'), { net: true }) }
  const t = await r.text(); let j = {}; try { j = JSON.parse(t) } catch { }
  if (r.ok) return j;
  const e = String(j.error || ''), d = String(j.error_description || '');
  throw Object.assign(new Error(/client_secret/i.test(d) ? 'Google needs the NEXUS client secret on this PC. Run: node accounts.js secret'
    : e === 'invalid_grant' ? 'Google did not accept the sign-in (expired or already used). Try again.'
    : 'Google sign-in failed: ' + RED((d || e || 'HTTP ' + r.status).slice(0, 160))), { net: r.status >= 500, google: r.status < 500 });
}
function claims(jwt, nonce) {
  const p = String(jwt || '').split('.'); let c; try { c = JSON.parse(Buffer.from(p[1], 'base64url').toString('utf8')) } catch { }
  const now = Date.now() / 1000, bad = w => { throw new Error('Sign-in check failed (' + w + '). Try again.') };
  if (p.length !== 3 || !c) bad('token');
  if (!ISS.includes(c.iss)) bad('issuer'); if (c.aud !== CLIENT) bad('audience'); if (!(c.exp > now)) bad('expired'); if (!(c.iat < now + 300)) bad('issued time');
  if (nonce !== null && !same(c.nonce, nonce)) bad('nonce'); if (!c.sub || typeof c.sub !== 'string') bad('account id');
  if (!c.email || c.email_verified !== true) throw new Error('Google did not confirm this email address, so NEXUS cannot use it.');
  return c;
}

let flow = null; // one sign-in at a time: { st: 'wait'|'error'|'done', msg, id, srv, state, nonce, ver, redirect, timer, busy }
function close(f) { clearTimeout(f.timer); if (f.srv) { f.srv.close(); setTimeout(() => f.srv.closeAllConnections?.(), 500) } }
function fail(f, m) { if (flow === f && f.st === 'wait') { f.st = 'error'; f.msg = m } close(f) }
function google(hint) {
  if (flow?.st === 'wait') fail(flow, 'replaced');
  const f = flow = { st: 'wait', state: b64(24), nonce: b64(24), ver: b64(48) }; // verifier: 64 chars (RFC 7636: 43-128)
  return new Promise(res => {
    const srv = f.srv = http.createServer((q, r) => cb(f, q, r));
    srv.on('error', e => { fail(f, 'Could not open a local sign-in port (' + e.code + ').'); res({ res: f.msg }) });
    srv.listen(0, '127.0.0.1', () => {
      f.redirect = `http://127.0.0.1:${srv.address().port}/cb`;
      const u = new URL(EP.auth), q = { client_id: CLIENT, redirect_uri: f.redirect, response_type: 'code', scope: 'openid email profile', code_challenge: crypto.createHash('sha256').update(f.ver).digest('base64url'), code_challenge_method: 'S256', state: f.state, nonce: f.nonce, prompt: 'select_account' };
      if (typeof hint === 'string' && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(hint)) q.login_hint = hint;
      for (const k in q) u.searchParams.set(k, q[k]);
      f.timer = setTimeout(() => fail(f, 'Sign-in timed out. Try again.'), WAIT);
      browse(u.href);
      res({ res: 'ok', url: u.href });
    });
  });
}
async function cb(f, q, r) {
  const u = new URL(q.url, 'http://x'), page = (ok, m) => { r.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" }); r.end(`<!doctype html><meta charset="utf-8"><title>NEXUS sign-in</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0D0819;color:#F4EEFF;font:16px 'Segoe UI',system-ui,sans-serif"><p>${esc(m)}</p>`) };
  if (u.pathname !== '/cb' || q.method !== 'GET') { r.writeHead(404); return r.end() }
  if (flow !== f || f.st !== 'wait' || f.busy) return page(false, 'This sign-in is no longer active. Go back to NEXUS and try again.');
  if (!same(u.searchParams.get('state'), f.state)) return page(false, 'Sign-in check failed. Go back to NEXUS and try again.'); // a stray request does not end the real one
  const err = u.searchParams.get('error');
  if (err) { const m = err === 'access_denied' ? 'Sign-in was cancelled in the browser.' : 'Google sign-in failed: ' + RED(err.slice(0, 80)); fail(f, m); return page(false, m) }
  f.busy = true;
  try { const a = await finish(f, u.searchParams.get('code')); page(true, `Signed in as ${a.email}. You can close this tab and go back to NEXUS.`) }
  catch (e) { f.busy = false; fail(f, e.message); page(false, e.message) }
}
async function finish(f, code) {
  if (!code) throw new Error('Google sent no sign-in code. Try again.');
  const sec = await secret(), t = await post(EP.token, { code, client_id: CLIENT, ...(sec ? { client_secret: sec } : {}), redirect_uri: f.redirect, grant_type: 'authorization_code', code_verifier: f.ver });
  const c = claims(t.id_token, f.nonce), id = rd().list.find(x => x.kind === 'google' && x.sub === c.sub)?.id || uid();
  if (t.refresh_token) await kr('set', KR + 'google/' + id, t.refresh_token); // key stored before the account is listed as signed in
  const o = rd(); let a = o.list.find(x => x.id === id); // read again after the await: no lost index writes
  if (!a) { a = { id, kind: 'google', sub: c.sub }; if (!o.list.length) a.legacy = true; o.list.push(a) }
  Object.assign(a, { name: String(c.name || c.email).slice(0, 80), email: String(c.email).slice(0, 254), at: Date.now(), chk: Date.now() }); delete a.out;
  wr(o); f.st = 'done'; f.id = a.id; close(f); return a;
}
// Ask Google to revoke the stored key, then delete it here either way. 'ok' only when Google answered 200 (revoked);
// 'failed' = not confirmed (offline, Google error, Credential Manager error); 'none' = no key on this PC, nothing to revoke.
async function forget(a) {
  let rt; try { rt = await kr('get', keyT(a)) } catch { return 'failed' }
  if (!rt) return 'none';
  let r = 'ok'; try { await post(EP.revoke, { token: rt }) } catch { r = 'failed' }
  try { await kr('del', keyT(a)) } catch { r = 'failed' }
  return r;
}
async function check(a) { // false = Google refused the stored sign-in (removed access, expired testing token, other account)
  const rt = await kr('get', keyT(a)); if (!rt) return false;
  try {
    const sec = await secret(), t = await post(EP.token, { client_id: CLIENT, ...(sec ? { client_secret: sec } : {}), grant_type: 'refresh_token', refresh_token: rt });
    return !t.id_token || claims(t.id_token, null).sub === a.sub;
  } catch (e) { return !e.google }
}

async function switchTo(id, ui) {
  let o = rd(), a = o.list.find(x => x.id === id);
  if (!a) return { res: 'not found' };
  if (a.kind === 'google') {
    if (a.out) return { res: 'signin', email: a.email };
    if (!(Date.now() - (a.chk || 0) < RECHECK)) {
      const ok = await check(a); o = rd(); a = o.list.find(x => x.id === id); if (!a) return { res: 'not found' };
      if (!ok) { try { await kr('del', keyT(a)) } catch { } o = rd(); a = o.list.find(x => x.id === id); if (a) { a.out = true; wr(o) } return { res: 'signin', email: a?.email } }
      a.chk = Date.now();
    }
  }
  stopRuns();
  const old = o.list.find(x => x.id === o.cur); if (old) saveUi(old, ui);
  o.cur = a.id; a.at = Date.now(); wr(o);
  return { res: 'ok', ui: loadUi(a) };
}
async function local(ui) {
  const o = rd(); let a = o.list.find(x => x.kind === 'local');
  if (!a) { a = { id: uid(), kind: 'local', name: 'Local profile', at: Date.now() }; if (!o.list.length) a.legacy = true; o.list.push(a); wr(o) }
  return switchTo(a.id, ui);
}
async function signOut(ui) {
  const o = rd(), a = o.list.find(x => x.id === o.cur); if (!a) return { res: 'not signed in' };
  stopRuns(); saveUi(a, ui);
  if (a.kind === 'google') a.out = true;
  o.cur = null; wr(o); // signed out here first, whatever Google answers
  return a.kind === 'google' ? { res: 'ok', revoke: await forget(a), email: a.email } : { res: 'ok' };
}
async function remove(id) { // a different account than the signed-in one: sign-in key revoked + deleted, its own data folder deleted
  const o = rd(), a = o.list.find(x => x.id === id);
  if (!a) return { res: 'not found' };
  if (a.id === o.cur) return { res: 'Switch to another account before removing this one.' };
  if (a.legacy) return { res: 'This account holds the original NEXUS data on this PC, so it cannot be removed here.' };
  const rv = a.kind === 'google' ? await forget(a) : null;
  if (/^[0-9a-f]{12}$/.test(a.id)) fs.rmSync(path.join(AC, a.id), { recursive: true, force: true });
  const n = rd(); n.list = n.list.filter(x => x.id !== id); wr(n);
  return rv ? { res: 'ok', revoke: rv, email: a.email } : { res: 'ok' };
}
function status() { const o = rd(); return { cur: o.cur, list: o.list.map(pub).sort((x, y) => (y.at || 0) - (x.at || 0)), first: !o.list.length, google: !!(CLIENT && (SEC || process.env.NEXUS_GOOGLE_SECRET || gfile())), flow: flow && { st: flow.st, msg: flow.msg || null, id: flow.id || null } } }
async function handle(b) {
  if (b.op === 'google') return google(b.hint);
  if (b.op === 'cancel') { if (flow?.st === 'wait') fail(flow, 'Sign-in cancelled.'); return { res: 'ok' } }
  if (b.op === 'local') { if (flow?.st !== 'wait') flow = null; return local(b.ui) }
  if (b.op === 'switch') { if (flow?.st === 'done' && flow.id === b.id) flow = null; return switchTo(String(b.id || ''), b.ui) } // a finished sign-in is used once (the login page resumes it after a reload)
  if (b.op === 'signout') { if (flow?.st !== 'wait') flow = null; return signOut(b.ui) }
  if (b.op === 'remove') return remove(String(b.id || ''));
  if (b.op === 'perms') { browse(PERMS); return { res: 'ok', url: PERMS } } // fixed Google page, never a URL from the request
  return { res: 'bad request' };
}
module.exports = { dir, status, handle, _: { claims, kr, rd } };

if (require.main === module && process.argv[2] === 'secret') { // node accounts.js secret [--clear]
  if (process.argv[3] === '--clear') kr('del', KR + 'google-client-secret').then(() => console.log('Client secret removed from Credential Manager.'));
  else {
    process.stdout.write('Paste the Google Desktop client secret (from Google Auth Platform → Clients), then press Enter: ');
    process.stdin.once('data', d => { const s = String(d).trim(); if (!/^[\w-]{10,100}$/.test(s)) { console.log('\nThat does not look like a client secret. Nothing saved.'); process.exit(1) } kr('set', KR + 'google-client-secret', s).then(() => { console.log('Saved to Windows Credential Manager (NEXUS/google-client-secret).'); process.exit(0) }, e => { console.log('\n' + e.message); process.exit(1) }) });
  }
}
