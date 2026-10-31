// M4b launch token (spec §26.8, Q-M4-1 / Q-M4-2). One secret per tracker start; every request needs it as the HttpOnly cookie
// nexus<port> or the x-nexus-token header. The browser gets the cookie only through a one-time /launch code (30 s) that
// `node tracker.js open` asks for with the token from launch.key, so the token never reaches the address bar or history.
// launch.key is made user-only with icacls before the token is written; if that fails no token is written (fails closed).
// NEXUS_TOKEN (tests only): use this token and write no launch.key.
// defer (tracker serve, B57): write launch.key only via publish(), once the port is ours; a second tracker that fails to
// listen must not replace the running tracker's key.
// B61 identity proof (M5b): prove(n) = HMAC-SHA256(token, "nexus-prove\0" + port + "\0" + n) for a client's fresh 64-hex nonce, so the
// app and `open` can check they talk to the tracker that owns launch.key before they send the token. The token never leaves.
const crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), RED = require('./redact.js');

function writeKey(f, token) { // empty file → icacls user-only → check only this user is listed → write in place (a rename would inherit the folder ACL)
  try {
    fs.writeFileSync(f, '');
    const me = os.userInfo().username, run = a => cp.execFileSync('icacls', [f, ...a], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    run(['/inheritance:r', '/grant:r', me + ':F']);
    const who = run([]).split(/\r?\n/).map(l => l.replace(f, '').trim()).filter(l => /:\(/.test(l)).map(l => l.split(':(')[0]);
    if (who.length !== 1 || !who[0].toLowerCase().endsWith('\\' + me.toLowerCase())) throw new Error('launch.key ACL lists ' + (who.join(', ') || 'nobody'));
    fs.writeFileSync(f, token);
    return null;
  } catch (e) {
    try { fs.appendFileSync(path.join(path.dirname(f), 'guard.log'), new Date().toISOString() + ' ' + path.basename(f) + ' not written: ' + RED(e.message.split('\n')[0]) + '\n') } catch { }
    return RED(e.message.split('\n')[0]);
  }
}

const mac = (token, port, n) => crypto.createHmac('sha256', token).update('nexus-prove\0' + port + '\0' + n).digest('hex');

module.exports = (keyFile, port, defer) => {
  const token = process.env.NEXUS_TOKEN || crypto.randomBytes(32).toString('hex'), name = 'nexus' + port, codes = new Map();
  const same = a => typeof a === 'string' && a.length === token.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(token));
  const cookie = q => (q.headers.cookie || '').split(/;\s*/).map(c => c.split('=')).find(([k]) => k === name)?.[1];
  const A = {
    keyErr: null,
    publish() { if (!process.env.NEXUS_TOKEN) A.keyErr = writeKey(keyFile, token) },
    prove: n => typeof n === 'string' && /^[0-9a-f]{64}$/.test(n) ? mac(token, port, n) : null,
    ok: q => same(q.headers['x-nexus-token']) || same(cookie(q)),
    code() { const now = Date.now(); for (const [c, t] of codes) if (t < now) codes.delete(c); const c = crypto.randomBytes(16).toString('hex'); codes.set(c, now + 30e3); return c },
    redeem(c) { const t = codes.get(c); codes.delete(c); return t > Date.now() ? `${name}=${token}; HttpOnly; SameSite=Strict; Path=/` : null },
  };
  if (!defer) A.publish();
  return A;
};
module.exports.mac = mac;
module.exports.writeKey = writeKey; // P3: port.txt gets the same user-only ACL
