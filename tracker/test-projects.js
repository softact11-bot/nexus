// Self-check for projects.js: detection, stats, guards, writes, backup. Uses throwaway folders (NEXUS_DATA / CLAUDE_CONFIG_DIR /
// NEXUS_STATE in temp, one test project folder in the home dir because temp folders are never projects). Spawns nothing. Cleans up.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-')), PROJ = path.join(os.homedir(), '.nexus-pj-selftest-' + process.pid);
process.env.NEXUS_DATA = path.join(T, 'data'); process.env.CLAUDE_CONFIG_DIR = path.join(T, 'cfg'); process.env.NEXUS_STATE = path.join(T, 'state.json');
try {
  fs.mkdirSync(path.join(PROJ, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'CLAUDE.md'), '# Test Game (Roblox)\n'); fs.writeFileSync(path.join(PROJ, 'a.luau'), 'print(1)');
  fs.writeFileSync(path.join(PROJ, 'docs', 'todo.md'), '---\nupdated: 2020-01-01\n---\n- [ ] one\n- [x] two\n'); fs.writeFileSync(path.join(PROJ, 'pic.png'), 'x');
  const td = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', PROJ.replace(/[^a-zA-Z0-9]/g, '-')); fs.mkdirSync(td, { recursive: true });
  const id = '11111111-2222-3333-4444-555555555555', t0 = Date.now() - 3600e3, L = (o, m) => JSON.stringify({ type: 'user', cwd: PROJ, timestamp: new Date(t0 + m * 60e3).toISOString(), message: { role: 'user', content: o } });
  fs.writeFileSync(path.join(td, id + '.jsonl'), [L('build the shop', 0), L('next', 5), L('later', 60)].join('\n') + '\n'); // 5 min active + one 55 min idle gap
  fs.writeFileSync(process.env.NEXUS_STATE, JSON.stringify({ sessions: [{ id, project: path.basename(PROJ), models: { m: [10, 20, 30, 40] }, tools: { Read: 3, Bash: 1 }, skills: {}, issues: {}, compacted: 0 }] }));
  const P = require('./projects.js');
  // guards
  for (const d of ['C:\\', 'C:\\Windows\\System32', os.homedir(), path.join(os.homedir(), '.claude'), 'C:\\Program Files\\x', os.tmpdir()]) assert(P._.banned(d), 'banned ' + d);
  assert(!P._.banned(PROJ)); assert(P._.checkDir('relative\\x')); assert(P._.checkDir('C:\\a"b')); assert.strictEqual(P._.checkDir(PROJ, true), null);
  // detection + stats
  const s = P.status({ refresh: true }), p = s.items.find(x => x.dir.toLowerCase() === PROJ.toLowerCase());
  assert(p, 'detected'); assert.strictEqual(p.name, 'Test Game'); assert.strictEqual(p.type, 'roblox'); assert.strictEqual(p.stats.sessions, 1);
  assert.strictEqual(p.stats.active, 5 * 60e3, 'idle gap left out'); assert.strictEqual(p.stats.tokens, 100); assert.strictEqual(p.stats.tracked, 1);
  const D = P.detail(p.id); assert.strictEqual(D.res, 'ok'); assert.strictEqual(D.sessions[0].prompt, 'build the shop'); assert.strictEqual(D.todo.length, 2); assert.strictEqual(D.stale.length, 1); assert(D.img.includes('pic.png'));
  // writes (NEXUS data only)
  const ok = o => { const r = P.post(o); assert.strictEqual(r.res, 'ok', JSON.stringify(r)); return r };
  ok({ op: 'update', id: p.id, set: { desc: 'd', tags: ['A'], status: 'paused', main: true, thumb: 'pic.png' } });
  assert.match(P.post({ op: 'update', id: p.id, set: { thumb: '../x.png' } }).res, /thumb/); assert.match(P.post({ op: 'update', id: p.id, set: { evil: 1 } }).res, /evil/);
  ok({ op: 'addTask', id: p.id, t: 'ship it', kind: 'milestone' }); const tid = P.status({}).items.find(x => x.id === p.id).tasks[0].id;
  ok({ op: 'task', id: p.id, tid, done: true }); ok({ op: 'delTask', id: p.id, tid });
  assert.match(P.post({ op: 'open', id: p.id, what: 'session', resume: 'not-a-uuid' }).res, /Unknown session/);
  assert.match(P.post({ op: 'open', id: p.id, what: 'reveal', f: '..\\..\\x' }).res, /not found/);
  assert.match(P.post({ op: 'backup', id: p.id }).res, /Confirm/);
  const b = ok({ op: 'backup', id: p.id, confirm: true }).backup; assert(b.files >= 3); assert(!fs.existsSync(path.join(PROJ, 'backups')), 'backup is outside the project');
  assert.strictEqual(P.post({ op: 'add', dir: PROJ }).res, 'That folder is already a project.');
  ok({ op: 'remove', id: p.id }); assert(fs.existsSync(path.join(PROJ, 'CLAUDE.md')), 'remove keeps files');
  assert(!P.status({ refresh: true }).items.some(x => x.id === p.id), 'removed stays dismissed');
  assert.strictEqual(P.img(p.id, '../state.json'), null);
  console.log('test-projects: all passed');
} finally { fs.rmSync(T, { recursive: true, force: true }); fs.rmSync(PROJ, { recursive: true, force: true }); }
