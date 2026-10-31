// M4c unit check: node test-redact.js. Planted home paths + fake secrets in → masked out; normal text unchanged; speed.
const R = require('./redact.js'), os = require('os'), H = os.homedir(), U = os.userInfo().username, D = H[0];
let pass = 0; const fail = [], eq = (i, want, m) => { const o = R(i); o === want ? pass++ : fail.push(m + ' → ' + JSON.stringify(o)) };
const ok = (c, m) => c ? pass++ : fail.push(m);
// home folder
eq(H + '\\Desktop\\my-game\\PROJECT_DOCS.md', '~\\Desktop\\my-game\\PROJECT_DOCS.md', 'backslash home');
eq(H.replace(/\\/g, '/') + '/.claude/x', '~/.claude/x', 'slash home');
eq(JSON.stringify(H + '\\a'), '"~\\\\a"', 'JSON-escaped home');
eq('cd /' + D.toLowerCase() + '/Users/' + U + '/Desktop', 'cd ~/Desktop', 'git bash home');
eq(H.toUpperCase() + '\\x', '~\\x', 'other case');
eq('open ' + H, 'open ~', 'home at end');
eq(H + 'Extra\\x', H + 'Extra\\x', 'longer user name not touched');
eq(D + '--Users-' + U + '-Desktop-my-game', D + '--Users-~-Desktop-my-game', 'encoded project folder');
eq('DESKTOP-ABC1234\\' + U + ':(F)', 'DESKTOP-ABC1234\\~:(F)', 'icacls account');
// secrets
eq('key sk-ant-api03-AbC_123-xyz used', 'key sk-ant-[hidden] used', 'Anthropic key');
eq('Authorization: Bearer eyJhbGciOi.payload.sig', 'Authorization: Bearer [hidden]', 'bearer');
eq('GET /x?token=abcd1234&p=1', 'GET /x?token=[hidden]&p=1', 'token= query');
eq('{"password":"hunter22","n":1}', '{"password":"[hidden]","n":1}', 'JSON password');
eq('api_key=ZZZZ9999 ok', 'api_key=[hidden] ok', 'api_key=');
const tok = require('crypto').randomBytes(32).toString('hex'); eq('x-nexus-token: ' + tok, 'x-nexus-token: [hidden]', 'launch token (64 hex)');
eq('code ' + 'a'.repeat(32), 'code [hidden]', '32 hex');
eq('b64 QWxhZGRpbjpvcGVuIHNlc2FtZQ0K9876ABCdefGHIjklMNO+pq==', 'b64 [hidden]', 'base64 40+');
// unchanged
for (const s of ['commit 18eeed9 deployed', 'hash 127082e86380 same', 'session 8a42efca-43a1-4bfd-9f6b-b5ca20c5d537', 'C:\\Users\\Public\\x', 'Rewrote the Token Optimizer note in Obsidian', 'key: value in prose',
  'C--Users-someuser2-AppData-Roaming-Claude-scratch-workspaces-764c389b-7a6d-4db3', 'https://fonts.googleapis.com/css2?family=Inter', 'D:\\Games\\x', 'token budget 4000 used', '']) eq(s, s, 'unchanged: ' + s);
ok(R(null) === null && R(5) === 5, 'non-strings passed through');
const line = (H + '\\x sk-ant-abcdefgh token=zzzz ' + 'word '.repeat(150)).slice(0, 1024), n = 2e4, t = process.hrtime.bigint(); for (let i = 0; i < n; i++) R(line);
const us = Number(process.hrtime.bigint() - t) / n / 1e3; ok(us < 20, 'speed ' + us.toFixed(1) + ' µs per 1 KB line (< 20)');
console.log(`test-redact: ${pass}/${pass + fail.length} passed (${us.toFixed(1)} µs/KB)` + (fail.length ? ' | FAIL: ' + fail.join(' | ') : ''));
process.exit(fail.length ? 1 : 0);
