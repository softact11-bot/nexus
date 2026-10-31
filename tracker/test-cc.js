// Self-check for cc.js (Claude Code page backend) and the AI-prompt guards in projects.js. Throwaway NEXUS_DATA / CLAUDE_CONFIG_DIR /
// NEXUS_STATE in temp, one test project in the home dir (temp folders are never projects), one "outside" folder for the link escape.
// Launches nothing: only the refusal paths of open() run. Cleans up.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-')), PROJ = path.join(os.homedir(), '.nexus-cc-selftest-' + process.pid), OUT = path.join(T, 'outside');
process.env.NEXUS_DATA = path.join(T, 'data'); process.env.CLAUDE_CONFIG_DIR = path.join(T, 'cfg'); process.env.NEXUS_STATE = path.join(T, 'state.json');
const w = (f, s) => { fs.mkdirSync(path.dirname(path.join(PROJ, f)), { recursive: true }); fs.writeFileSync(path.join(PROJ, f), s); };
(async () => {
  w('CLAUDE.md', '\uFEFF# CC Test (Roblox)\n'); w('src/main.luau', 'print(1)'); w('.env', 'KEY=1'); w('config/secrets.json', '{}'); w('db-password.txt', 'x');
  w('id_rsa', 'k'); w('my.pem', 'k'); w('.git-credentials', 'x'); w('node_modules/a/index.js', 'x'); w('.hidden/a.txt', 'x'); w('backups/a.lua', 'x');
  w('pic.png', 'x'); w('nul.txt', 'a\0b'); w('big.log', Buffer.alloc(1048577, 97)); w('secretary.md', 'fine');
  fs.mkdirSync(OUT); fs.writeFileSync(path.join(OUT, 'loot.txt'), 'outside');
  let link = true; try { fs.symlinkSync(OUT, path.join(PROJ, 'esc'), 'junction') } catch { link = false }
  const td = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', PROJ.replace(/[^a-zA-Z0-9]/g, '-')); fs.mkdirSync(td, { recursive: true });
  const sid = '11111111-2222-3333-4444-555555555555', t0 = Date.now() - 600e3, ts = m => new Date(t0 + m * 1e3).toISOString();
  const A = (rid, m, content) => JSON.stringify({ type: 'assistant', requestId: rid, cwd: PROJ, timestamp: ts(m), message: { model: 'claude-x-1-2', usage: { input_tokens: 5, output_tokens: 7, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }, content } });
  fs.writeFileSync(path.join(td, sid + '.jsonl'), [
    JSON.stringify({ type: 'user', cwd: PROJ, timestamp: ts(0), message: { role: 'user', content: '<system-reminder>noise</system-reminder>fix the  shop' } }),
    A('r1', 1, [{ type: 'text', text: 'ok' }]), A('r1', 2, [{ type: 'tool_use', name: 'Edit', input: { file_path: path.join(PROJ, 'src', 'main.luau') } }]),
    A('r2', 3, [{ type: 'tool_use', name: 'Write', input: { file_path: path.join(OUT, 'loot.txt') } }, { type: 'tool_use', name: 'Read', input: {} }]),
  ].join('\n') + '\n');
  fs.writeFileSync(process.env.NEXUS_STATE, JSON.stringify({ sessions: [] }));
  const P = require('./projects.js'), C = require('./cc.js');
  const p = P.status({ refresh: true }).items.find(x => x.dir.toLowerCase() === PROJ.toLowerCase()); assert(p, 'detected');
  const code = (o, c, re) => { assert.strictEqual(o.code, c, JSON.stringify(o)); if (re) assert.match(o.res, re); };
  // tree: hidden / skipped folders and links left out, flags set
  const r = C.tree(p.id, ''), n = r.items.map(x => x.n);
  assert.strictEqual(r.res, 'ok'); for (const x of ['node_modules', '.hidden', 'backups', 'esc']) assert(!n.includes(x), 'tree hides ' + x);
  const f = k => r.items.find(x => x.n === k); assert(f('.env').lock && f('id_rsa').lock && f('my.pem').lock && f('db-password.txt').lock && f('.git-credentials').lock);
  assert(!f('secretary.md').lock, 'secretary is not a secret'); assert(f('pic.png').bin && f('big.log').big); assert(f('src').dir);
  for (const d of ['node_modules', '.hidden', '.git', 'backups']) code(C.tree(p.id, d), 403);
  code(C.tree(p.id, '..'), 400); code(C.tree('nope', ''), 404);
  // file: deny list at every level, traversal, absolute paths, size, binary, BOM
  const ok = C.file(p.id, 'CLAUDE.md'); assert.strictEqual(ok.res, 'ok'); assert.strictEqual(ok.text, '# CC Test (Roblox)\n');
  assert.strictEqual(C.file(p.id, 'src\\main.luau').text, 'print(1)');
  for (const x of ['.env', 'config/secrets.json', 'db-password.txt', 'id_rsa', 'my.pem', '.git-credentials', 'SECRETS/x.txt']) code(C.file(p.id, x), 403, /sensitive|hidden/);
  for (const x of ['../x', 'src/../../x', '..\\x', 'a/./b', 'C:\\Windows\\win.ini', 'a"b', 'a\0b']) code(C.file(p.id, x), 400);
  code(C.file(p.id, 'node_modules/a/index.js'), 403); code(C.file(p.id, '.hidden/a.txt'), 403);
  code(C.file(p.id, 'big.log'), 413); code(C.file(p.id, 'pic.png'), 415); code(C.file(p.id, 'nul.txt'), 415); code(C.file(p.id, 'src'), 400); code(C.file(p.id, 'nope.md'), 404);
  if (link) { code(C.file(p.id, 'esc/loot.txt'), 403, /outside/); code(C.tree(p.id, 'esc'), 403, /outside/); } else console.log('  (no junction support: link escape not tested)');
  // git: not a repo, then a repo with no commits, then one change
  assert.strictEqual((await C.git(p.id)).repo, false);
  cp.execFileSync('git', ['-C', PROJ, 'init', '-q']); await new Promise(k => setTimeout(k, 3100)); // past the 3 s cache
  const g = await C.git(p.id); assert(g.repo && g.branch && g.changes.length > 0 && g.log.length === 0, JSON.stringify(g).slice(0, 200));
  // live: requests, prompt, tools, edits inside the project only, guards
  const L = C.live(p.id, sid); assert.strictEqual(L.res, 'ok'); assert.strictEqual(L.reqs.length, 2);
  assert.strictEqual(L.reqs[0].ask.q, 'fix the shop'); assert.strictEqual(L.reqs[0].ctx, 1105); assert.deepStrictEqual(L.reqs[0].tools, ['Edit']); assert.deepStrictEqual(L.reqs[1].tools, ['Write', 'Read']);
  assert.deepStrictEqual(L.edits.map(e => e.f), ['src/main.luau'], 'edits outside the project are left out');
  code(C.live(p.id, 'not-a-uuid'), 400); code(C.live(p.id, '00000000-0000-0000-0000-000000000000'), 404);
  // launches: refusal paths only (nothing starts)
  const op = b => P.post({ op: 'open', id: p.id, ...b }).res;
  assert.match(op({ what: 'ai', tool: 'rm', prompt: 'x', term: 'wt' }), /Unknown AI tool/);
  for (const pr of ['', '   ', 'x'.repeat(4097), 'a\0b', 5]) assert.match(op({ what: 'ai', tool: 'sum', prompt: pr, term: 'wt' }), /Write a prompt/);
  assert(!fs.existsSync(path.join(process.env.NEXUS_DATA, 'prompts')) || !fs.readdirSync(path.join(process.env.NEXUS_DATA, 'prompts')).length, 'no prompt file for a refused launch');
  assert.match(op({ what: 'session', resume: '00000000-0000-0000-0000-000000000000' }), /Unknown session/);
  const vs = op({ what: 'vscode', f: '.env' }); assert(/sensitive|VS Code not found/.test(vs), vs);
  // the prompt reaches claude as one argument, never as code
  const c = P._.promptCmd('C:\\a b\\it\'s.txt'), ps = Buffer.from(c.b64, 'base64').toString('utf16le');
  assert(ps.includes("-LiteralPath 'C:\\a b\\it''s.txt'") && ps.includes("($t -replace '\"', '\\\"')"), ps);
  assert(c.bash.includes(`"$(cat 'C:/a b/it'\\''s.txt')"`), c.bash);
  console.log('test-cc: all passed');
})().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => { fs.rmSync(T, { recursive: true, force: true }); fs.rmSync(PROJ, { recursive: true, force: true }); });
