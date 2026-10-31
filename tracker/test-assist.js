// Self-check for the NEXUS Assistant backend (assist.js) and voice filter (voice.js); no Claude call, no microphone. node test-assist.js
// Runs against a temporary copy so the real assist/ folder is never touched.
const fs = require('fs'), path = require('path'), os = require('os'), a = require('assert');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-assist-')); for (const f of ['assist.js', 'brain.js', 'watch.js', 'accounts.js', 'redact.js', 'voice.js']) fs.copyFileSync(path.join(__dirname, f), path.join(T, f));
fs.writeFileSync(path.join(T, 'projects.json'), JSON.stringify({ items: [{ id: 'p1', name: 'Game', dir: T }] })); fs.writeFileSync(path.join(T, 'default.project.json'), '{}');
const X = require(path.join(T, 'assist.js')), V = require(path.join(T, 'voice.js'));
// routing
a.deepEqual(X.route('what is my usage?', 'auto'), { model: 'haiku', why: 'quick question' });
a.equal(X.route('fix the error in shop.lua', 'auto').model, 'sonnet');
a.equal(X.route('security audit of the tracker', 'auto').model, 'opus');
a.equal(X.route('anything', 'opus').why, 'chosen by you');
a.equal(X.route('x', 'gpt-9').model, 'haiku'); // unknown pick = auto
// Roblox context from folder contents
a.match(X._.kind({ dir: T }), /Roblox project/);
// permissions: never Bash, never MCP, hooks off; plan/edit flags
const ar = m => X._.args({ mode: m, p: null }, 'haiku').join(' ');
for (const m of ['read', 'plan', 'edit']) { a.ok(!/Bash/.test(ar(m))); a.ok(ar(m).includes('--strict-mcp-config')); a.ok(ar(m).includes('disableAllHooks')) }
a.ok(ar('plan').includes('--permission-mode plan')); a.ok(!/Edit/.test(ar('read'))); a.ok(/acceptEdits/.test(ar('edit')));
// memory, tasks, limits, input cleaning
a.equal(X.post({ op: 'remember', text: '  likes   purple  ' }).res, 'ok'); a.equal(X.status().memory[0].x, 'likes purple');
a.match(X._.sys(null), /likes purple/);
a.equal(X.post({ op: 'task', title: 'Ship voice', conv: 'c' }).res, 'ok'); a.match(X._.sys(null), /Ship voice/);
a.equal(X.post({ op: 'taskset', i: 0, done: true }).res, 'ok'); a.ok(!/Ship voice/.test(X._.sys(null)));
a.equal(X.post({ op: 'taskdel', i: 0 }).res, 'ok'); a.equal(X.post({ op: 'forget', i: 0 }).res, 'ok'); a.equal(X.post({ op: 'forget', i: 9 }).res, 'not found');
a.notEqual(X.post({ op: 'remember', text: '   ' }).res, 'ok'); a.equal(X.post({ op: 'nope' }).res, 'bad request');
// attachments: type + size checks, safe names
a.match(X.post({ op: 'attach', name: 'x.exe', b64: 'AA==' }).res, /not supported/);
const at = X.post({ op: 'attach', name: '../../evil name.txt', b64: Buffer.from('hi').toString('base64') }); a.equal(at.res, 'ok'); a.ok(/^[\w.-]+$/.test(at.name) && !at.name.includes('..'));
a.ok(fs.existsSync(path.join(T, 'assist', 'att', at.name)));
// self-improvement rule: 3 of 4 Haiku quick answers rated down → quick questions go to Sonnet; reset undoes it
const cf = path.join(T, 'assist', 'convs.json'); fs.writeFileSync(cf, JSON.stringify([{ id: 'c1', title: 't', msgs: [0, 1, 2, 3].flatMap(() => [{ r: 'u', x: 'q' }, { r: 'a', x: 'a', model: 'haiku', route: 'quick question' }]), at: 1 }]));
for (const [i, v] of [[1, -1], [3, -1], [5, 1], [7, -1]]) a.equal(X.post({ op: 'rate', id: 'c1', i, v }).res, 'ok');
{ let code, body = ''; X.send({ text: 'hi', mode: 'edit' }, { writeHead: c => { code = c }, end: x => { body += x }, write: () => { }, on: () => { } }); a.equal(code, 400); a.ok(/Pick a project first/.test(body)) } // edit mode never runs without a project
a.equal(X.route('what time is it?', 'auto').model, 'sonnet'); a.ok(X.status().learned.upQuick);
a.equal(X.post({ op: 'rate', id: 'c1', i: 0, v: 1 }).res, 'bad request'); // user message cannot be rated
X.post({ op: 'resetLearn' }); a.equal(X.route('what time is it?', 'auto').model, 'haiku');
// conversations: search, rename, delete
a.equal(X.search('t').length, 1); a.equal(X.post({ op: 'rename', id: 'c1', title: 'Renamed' }).res, 'ok'); a.equal(X.list()[0].title, 'Renamed');
a.equal(X.post({ op: 'delete', id: 'c1' }).res, 'ok'); a.equal(X.list().length, 0);
// plain errors
a.match(X.explain('Error: usage limit reached'), /usage limit/); a.match(X.explain('not logged in'), /not signed in/); a.match(X.explain('spawn ENOENT'), /not found/);
// voice wake word
const w = V._.wake; a.equal(w('Nexus, open my project'), 'open my project'); a.equal(w('hello there'), null); a.equal(w('nexus'), ''); a.equal(w('check usage'), 'check usage');
// voice recovery (V1-V3): fake helper scripts, no microphone
(async () => {
  const got = [], r = { writeHead() { }, write: l => got.push(...l.trim().split('\n').map(x => JSON.parse(x))) }, q = new (require('events'))();
  V.events(q, r); const ps1 = path.join(T, 'voice.ps1'), wait = t => new Promise(f => { const go = () => got.some(t) ? f() : setTimeout(go, 100); go() });
  const run = async body => { got.length = 0; fs.writeFileSync(ps1, body); a.equal(V.post({ op: 'start', mode: 'free' }).res, 'ok'); await wait(j => j.t === 'off'); return got.filter(j => j.t === 'error').map(j => j.x) };
  let e = await run('[Console]::Error.WriteLine("boom here"); exit 3'); a.ok(e.length === 1 && /boom here \(exit code 3\)/.test(e[0]), e); // V1
  e = await run(`Write-Output '{"t":"error","x":"No recognizer of the required ID found."}'; exit 1`); a.ok(e.length === 1 && /English \(United States\)/.test(e[0]), e); // V2, no duplicate
  e = await run('exit 0'); a.equal(e.length, 0); // clean exit: no error
  const cp = require('child_process'), sp = cp.spawn; cp.spawn = (c, ...x) => sp('nx-no-such-exe', ...x); // V3: async spawn error must not crash
  e = await run('exit 0'); cp.spawn = sp; a.ok(e.length === 1 && /could not start/.test(e[0]), e);
  q.emit('close');
})().then(() => { fs.rmSync(T, { recursive: true, force: true }); console.log('test-assist: all checks passed') }, e => { console.error(e); process.exit(1) });
