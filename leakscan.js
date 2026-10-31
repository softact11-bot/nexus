// M7a: release leak scanner + strict payload allowlist (build gate). Read-only on its inputs; reports never contain the matched text.
//   node leakscan.js scan <file|folder>... [--allow payload.allow.json]   exit 1 on any finding (or file not on the allowlist)
//   node leakscan.js pack <outdir> [--exe <nexus.exe>] [--google]         stage a candidate payload (allowlisted git-tracked tracker files + exe) and scan it
//     --google: also write tracker/google-client.json from this PC's Credential Manager (NEXUS/google-client-secret; never printed).
//     Google treats installed-app secrets as non-confidential, so google-secret is the one rule that file is exempt from (user OK 2026-10-29).
//   node leakscan.js test                                                 self-test on temp folders
// Rules: personal paths / names (this PC's user, home, computer name, git email, vault names), secrets (API keys, private keys, JWT,
// the live + dev launch.key values), source maps, forbidden file names. Binary files are searched as latin1 and UTF-16LE text.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const HOME = os.homedir(), DIR = __dirname, TRACKER = path.join(DIR, 'tracker');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const glob = g => new RegExp('^' + g.split('/').map(p => p === '**' ? '\0' : esc(p).replace(/\\\*/g, '[^/]*').replace(/\\\?/g, '[^/]')).join('/').replace(/\0\//g, '(?:.*/)?').replace(/\/?\0$/, '(?:/.*)?') + '$', 'i');
const rd = f => { try { return fs.readFileSync(f, 'utf8').trim() } catch { return '' } };

function personal() { // strings that identify this PC / user; kept in memory only
  const s = new Set([os.userInfo().username, path.basename(HOME), os.hostname()]);
  for (const r of [DIR, TRACKER]) try { s.add(execFileSync('git', ['-C', r, 'log', '-1', '--format=%ae'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) } catch { }
  try { for (const v of Object.values(JSON.parse(rd(path.join(process.env.APPDATA || '', 'obsidian', 'obsidian.json'))).vaults || {})) if (v.path) s.add(path.basename(v.path)) } catch { }
  const keys = [path.join(HOME, '.claude', 'token-tracker', 'launch.key'), path.join(TRACKER, 'launch.key')].map(rd).filter(k => k.length >= 16);
  return { words: [...s].filter(w => w && w.length >= 4 && !/^(users|desktop|vault|admin|user)$/i.test(w)), keys };
}
function rules(p = personal()) {
  return [
    ['home-path', /[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}(?!Public\b|Default\b|you\b|x\b|<|%|\{|\$)[^\\/\s"'<>|:*?\x00]{2,}/gi],
    ['unix-home', /\/(?:c\/)?(?:Users|home)\/(?!runner\b|user\b|<|\$)[A-Za-z0-9._-]{2,}\//g],
    ...p.words.map((w, i) => ['personal-name#' + i, new RegExp('(?<![A-Za-z0-9])' + esc(w) + '(?![A-Za-z0-9])', 'gi')]),
    ...p.keys.map((k, i) => ['launch-key-value#' + i, new RegExp(esc(k), 'g')]),
    ['anthropic-key', /sk-ant-[A-Za-z0-9_-]{20,}/g], ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/g],
    ['github-token', /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/g], ['aws-key', /\bAKIA[0-9A-Z]{16}\b/g],
    ['google-secret', /GOCSPX-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}/g], ['slack-token', /xox[abprs]-[A-Za-z0-9-]{10,}/g],
    ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g], ['jwt', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
    ['source-map', /[#@] sourceMappingURL=(?!data:)/g],
  ];
}
const BAD_NAME = /(^|\/)(launch\.key|\.env[^/]*|.*\.(pem|pfx|p12|key|map)|id_rsa[^/]*|settings\.json|state\.json|projects\.json|crashes\.json|config\.json|guard\.log|.*\.bak[^/]*|test-[^/]*|[^/]*\.log)$/i;

function files(p, base = p) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return [{ abs: p, rel: path.basename(p) }];
  const out = [];
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const a = path.join(p, e.name);
    if (e.isDirectory()) out.push(...files(a, base)); else if (e.isFile()) out.push({ abs: a, rel: path.relative(base, a).split(path.sep).join('/') });
  }
  return out;
}
function scan(targets, allow, R = rules()) {
  const findings = [], list = targets.flatMap(t => files(t));
  const ok = allow && allow.allow.map(glob), deny = allow && (allow.deny || []).map(glob);
  for (const f of list) {
    if (BAD_NAME.test(f.rel)) findings.push({ file: f.rel, rule: 'forbidden-file' });
    if (ok && (!ok.some(r => r.test(f.rel)) || deny.some(r => r.test(f.rel)))) findings.push({ file: f.rel, rule: 'not-allowlisted' });
    const b = fs.readFileSync(f.abs);
    for (const text of [b.toString('latin1'), b.toString('utf16le'), b.subarray(1).toString('utf16le')])
      for (const [name, re] of R) {
        if (name === 'google-secret' && f.rel === GCLIENT) continue; // user OK 2026-10-29: Google Desktop-app secret is non-confidential (PKCE)
        re.lastIndex = 0; let n = 0, first = -1, m;
        while ((m = re.exec(text))) { if (first < 0) first = m.index; n++; if (!m[0].length) re.lastIndex++ }
        if (n && !findings.some(x => x.file === f.rel && x.rule === name)) findings.push({ file: f.rel, rule: name, count: n, at: first });
      }
  }
  return { ok: !findings.length, files: list.length, findings };
}
const loadAllow = () => JSON.parse(fs.readFileSync(path.join(DIR, 'payload.allow.json'), 'utf8'));

const GCLIENT = 'tracker/google-client.json';
function pack(out, exe, google) { // candidate payload: never copies anything outside the allowlist
  const allow = loadAllow(), ok = allow.allow.map(glob), deny = (allow.deny || []).map(glob);
  fs.mkdirSync(out, { recursive: true }); if (fs.readdirSync(out).length) throw new Error('pack: output folder must be empty');
  const tracked = execFileSync('git', ['-C', TRACKER, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of tracked) { const rel = 'tracker/' + f; if (ok.some(r => r.test(rel)) && !deny.some(r => r.test(rel))) { const d = path.join(out, rel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(TRACKER, f), d) } }
  if (exe) fs.copyFileSync(exe, path.join(out, 'nexus.exe'));
  if (google) fs.writeFileSync(path.join(out, GCLIENT), JSON.stringify({ secret: google }));
  return scan([out], allow);
}

function test() {
  let pass = 0; const fail = [], t = (c, m) => c ? pass++ : fail.push(m);
  const T = require('./setup/tmproot')('nexus-leak-'), put = (f, s) => { fs.mkdirSync(path.dirname(path.join(T, f)), { recursive: true }); fs.writeFileSync(path.join(T, f), s) };
  const P = { words: ['zorbuser', 'ZORB-PC'], keys: ['k'.repeat(40)] }, R = rules(P), A = { allow: ['nexus.exe', 'tracker/*.js', 'tracker/app/**'], deny: ['tracker/app/**/*.bak*'] };
  put('tracker/a.js', 'const ok = 1; // C:\\Users\\Public\\x and %USERPROFILE% and C:\\Users\\<name>'); const clean = scan([T], A, R);
  t(clean.ok, 'clean file passes: ' + JSON.stringify(clean.findings));
  const hit = (name, body, rule, allow = A) => { const d = require('./setup/tmproot')('nexus-leak-'); fs.mkdirSync(path.join(d, 'tracker'), { recursive: true }); fs.writeFileSync(path.join(d, 'tracker', name), body); const r = scan([d], allow, R); t(r.findings.some(f => f.rule === rule) && !JSON.stringify(r).includes('zorbuser') && !JSON.stringify(r).includes('k'.repeat(40)), rule + ' caught, text not echoed') };
  hit('b.js', 'p = "C:\\\\Users\\\\zorbuser\\\\x"', 'home-path'); hit('b.js', 'p = "/c/Users/zorbuser/x"', 'unix-home'); hit('b.js', 'by zorbuser', 'personal-name#0');
  hit('b.js', 'host ZORB-PC', 'personal-name#1'); hit('b.js', 'x=' + 'k'.repeat(40), 'launch-key-value#0'); hit('b.js', 'k="sk-ant-' + 'a'.repeat(30) + '"', 'anthropic-key');
  hit('b.js', 'ghp_' + 'a'.repeat(36), 'github-token'); hit('b.js', 'AKIA' + 'A'.repeat(16), 'aws-key'); hit('b.js', '-----BEGIN RSA PRIVATE KEY-----', 'private-key');
  hit('b.js', 'GOCSPX-' + 'a'.repeat(24), 'google-secret'); hit('b.js', '//# sourceMappingURL=a.js.map', 'source-map');
  hit('google-client.json', '{"secret":"GOCSPX-' + 'a'.repeat(24) + '","x":"C:\\\\Users\\\\zorbuser"}', 'home-path', { allow: ['tracker/google-client.json'] });
  { const d = require('./setup/tmproot')('nexus-leak-'); fs.mkdirSync(path.join(d, 'tracker')); fs.writeFileSync(path.join(d, GCLIENT), '{"secret":"GOCSPX-' + 'a'.repeat(24) + '"}');
    t(scan([d], { allow: [GCLIENT] }, R).ok, 'google-client.json exempt from google-secret only'); hit('b.json', 'GOCSPX-' + 'a'.repeat(24), 'google-secret', { allow: ['tracker/*'] }); }
  hit('b.js', Buffer.from('C:\\Users\\zorbuser\\x', 'utf16le'), 'home-path'); hit('launch.key', 'x', 'forbidden-file'); hit('config.json', '{}', 'forbidden-file');
  hit('x.txt', 'fine', 'not-allowlisted'); hit('b.js', 'fine', 'not-allowlisted', { allow: ['nexus.exe'] });
  const d = require('./setup/tmproot')('nexus-leak-'); fs.mkdirSync(path.join(d, 'tracker/app'), { recursive: true }); fs.writeFileSync(path.join(d, 'tracker/app/x.bak1.js'), '');
  t(scan([d], A, R).findings.filter(f => f.rule === 'not-allowlisted').length === 1, 'deny pattern wins over allow');
  t(!glob('tracker/*.js').test('tracker/app/x.js') && glob('tracker/app/**').test('tracker/app/js/x.js') && glob('nexus.exe').test('NEXUS.EXE'), 'glob rules');
  t(rules().some(([n]) => n.startsWith('personal-name')), 'this PC yields personal-name rules');
  return { pass, fail };
}

if (require.main === module) {
  const [cmd, ...a] = process.argv.slice(2), opt = k => { const i = a.indexOf(k); return i >= 0 ? a.splice(i, 2)[1] : undefined };
  let r;
  if (cmd === 'test') r = test();
  else if (cmd === 'scan') { const al = opt('--allow'); r = scan(a, al && JSON.parse(fs.readFileSync(al, 'utf8'))) }
  else if (cmd === 'pack') {
    const exe = opt('--exe'), g = a.includes('--google'), dir = a.find(x => x !== '--google');
    if (g) { console.error('REFUSED: the Google client secret is never packaged into Setup.exe (user 2026-10-30). Each PC stores it once with node accounts.js secret.'); process.exit(2) }
    r = pack(dir, exe);
  }
  else { console.log('usage: node leakscan.js scan <path>... [--allow f] | pack <outdir> [--exe f] [--google] | test'); process.exit(2) }
  console.log(JSON.stringify(r, null, 1)); process.exit((r.ok ?? !r.fail.length) ? 0 : 1);
}
module.exports = { scan, rules, pack };
