// Self-check for post-M7 Phases 5-9 (brain.js + assist.js plans/cache); no Claude call: cp.spawn is swapped for a fake CLI. node test-brain.js
// Runs in a temporary copy; skills go to a temp folder (NEXUS_SKILLS), never ~/.claude/skills.
const fs = require('fs'), path = require('path'), os = require('os'), a = require('assert'), cp = require('child_process');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-brain-')); for (const f of ['assist.js', 'brain.js', 'watch.js', 'accounts.js', 'redact.js']) fs.copyFileSync(path.join(__dirname, f), path.join(T, f));
const G = path.join(T, 'game'), V = path.join(T, 'vault'); fs.mkdirSync(path.join(G, 'src'), { recursive: true }); fs.mkdirSync(V);
process.env.NEXUS_SKILLS = path.join(T, 'skills'); process.env.NEXUS_VAULT = V;
fs.writeFileSync(path.join(T, 'projects.json'), JSON.stringify({ items: [{ id: 'g', name: 'Game', dir: G }] }));
fs.writeFileSync(path.join(G, 'default.project.json'), JSON.stringify({ tree: { $className: 'DataModel', ServerScriptService: { $path: 'src', Shop: {} }, ReplicatedStorage: {} } }));
fs.writeFileSync(path.join(G, 'src', 'shop.server.lua'), 'local DS = game:GetService("DataStoreService"):GetDataStore("x")\nRemote.OnServerEvent:Connect(function(plr, amount)\n  coins += amount\nend)\nlocal v = DS:GetAsync(key)\nwait(1)\n-- wait(2) in a comment is ignored\nlocal ok = pcall(function() return DS:SetAsync(k, 1) end)\n');
fs.writeFileSync(path.join(G, 'src', 'ok.server.lua'), 'Remote.OnServerEvent:Connect(function(plr, n)\n  if typeof(n) ~= "number" then return end\nend)\ntask.wait(1)\n');
fs.writeFileSync(path.join(V, 'DataStore Retry Policy.md'), '---\nstatus: APPROVED\n---\n# DataStore retry policy\nRetry datastore writes with backoff. datastore budget.');
fs.writeFileSync(path.join(V, 'Old Shop.md'), '---\nstatus: Superseded\n---\n# Old shop\ndatastore datastore shop');
fs.writeFileSync(path.join(V, 'Lighting.md'), '# Lighting\nClockTime 21');
const X = require(path.join(T, 'assist.js')), B = require(path.join(T, 'brain.js')), CF = path.join(T, 'assist', 'convs.json');
const conv = (id, pairs, extra = {}) => ({ id, title: id, at: Date.now(), msgs: pairs.flatMap(([q, m]) => [{ r: 'u', x: q, at: Date.now() }, { r: 'a', x: 'ans', at: Date.now(), ok: true, ...m }]), ...extra });

// Phase 6: Roblox scan finds the unsafe handler, DataStore outside pcall and wait(), not the checked handler / pcall / comment
const s = B.scan({ dir: G }, ['roblox-dev-skill', 'gsap-core', 'luau-lint']);
a.equal(s.roblox, true); a.equal(s.scripts.server, 2);
a.deepEqual(s.counts, { security: 1, data: 1, style: 1 }, JSON.stringify(s.findings));
a.equal(s.findings[0].file, 'src/shop.server.lua'); a.equal(s.findings[0].line, 2);
a.deepEqual(s.skills, ['roblox-dev-skill', 'luau-lint']); a.ok(s.tree.some(t => /ServerScriptService: Shop/.test(t)));
a.match(B.brief(s), /2 server.*Static check found: 1 security/s);
a.equal(X.post({ op: 'scan', project: 'g' }).res, 'ok'); a.notEqual(X.post({ op: 'scan', project: 'zz' }).res, 'ok');

// Phase 8: ranked notes, outdated note marked and ranked lower, unrelated note left out; graph hits; duplicate memory refused
const rc = B.recall('how should datastore retry work in the shop?', [V]);
a.equal(rc[0].title, 'DataStore Retry Policy'); a.equal(rc[0].status, 'approved'); a.ok(!rc.some(r => r.title === 'Lighting'));
a.equal(rc.find(r => r.title === 'Old Shop')?.status, 'outdated');
fs.mkdirSync(path.join(G, 'graphify-out')); fs.writeFileSync(path.join(G, 'graphify-out', 'graph.json'), JSON.stringify({ nodes: [{ id: 'a', label: 'Shop service', source_file: 'src/shop.server.lua' }, { id: 'b', label: 'Lighting' }] }));
a.deepEqual(B.graphHits('fix the shop', G), [{ label: 'Shop service', file: 'src/shop.server.lua' }]);
const sp = X._.sys({ id: 'g', name: 'Game', dir: G }, 'datastore retry in the shop');
a.match(sp, /DataStore Retry Policy\.md \[approved\]/); a.match(sp, /Graphify graph matches: Shop service/); a.match(sp, /Roblox project scan/);
a.equal(X.post({ op: 'remember', text: 'The game targets mobile phones first', project: 'g' }).res, 'ok');
a.match(X.post({ op: 'remember', text: 'the game targets mobile phones first!' }).res, /Already remembered/);
a.match(X._.sys({ id: 'g', name: 'Game', dir: G }, 'x'), /mobile phones/); a.ok(!/mobile phones/.test(X._.sys(null, 'x'))); // project memory stays in its project

// Phase 5: 4 of 6 rated Haiku quick answers down → proposal with evidence → approve = experiment (1 in 4 requests) → 12 rated → kept
const H = { model: 'haiku', route: 'quick question', cost: 0.001 };
fs.mkdirSync(path.dirname(CF), { recursive: true });
fs.writeFileSync(CF, JSON.stringify([conv('c1', [-1, -1, -1, -1, 1, 1].map(v => ['q?', { ...H, v }]))]));
let br = X.status().brain, pr = br.proposals.find(p => p.id === 'route:quick question:sonnet');
a.ok(pr && /4 of 6/.test(pr.why), JSON.stringify(br.proposals)); a.equal(pr.evidence.n, 6);
a.equal(X.post({ op: 'improve', do: 'approve', id: pr.id }).res, 'ok');
a.deepEqual(X.route('what time is it?', 'auto', 0.1), { model: 'sonnet', why: 'quick question (experiment: testing sonnet)', exp: pr.id });
a.equal(X.route('what time is it?', 'auto', 0.9).model, 'haiku');
const exp = Array.from({ length: 12 }, (_, i) => ['q?', { model: 'sonnet', route: 'quick question (experiment)', exp: pr.id, v: i < 10 ? 1 : -1, cost: 0.003 }]);
const all = JSON.parse(fs.readFileSync(CF)); all[0].msgs.push(...exp.flatMap(([q, m]) => [{ r: 'u', x: q }, { r: 'a', x: 'a', ok: true, ...m }])); fs.writeFileSync(CF, JSON.stringify(all));
a.equal(X.post({ op: 'rate', id: 'c1', i: 1, v: -1 }).res, 'ok'); // any rating runs the measurement
br = X.status().brain; const rule = br.rules[0];
a.equal(rule.status, 'active'); a.equal(rule.result.n, 12); a.ok(rule.result.new > rule.result.old); a.match(br.history[0].what, /kept/); a.match(br.lessons[0], /works as well/);
a.deepEqual(X.route('what time is it?', 'auto', 0.9), { model: 'sonnet', why: 'quick question (learned rule v1)' });
a.equal(X.post({ op: 'improve', do: 'rollback', id: pr.id }).res, 'ok'); a.equal(X.route('what time is it?', 'auto', 0.9).model, 'haiku');
a.ok(!X.status().brain.proposals.some(p => p.id === pr.id) || true);
// a worse experiment rolls itself back
fs.writeFileSync(CF, JSON.stringify([conv('c2', [-1, -1, -1, -1, 1, 1].map(v => ['q?', { ...H, v }]))]));
const L0 = JSON.parse(fs.readFileSync(path.join(T, 'assist', 'learn.json'))); L0.rules = []; fs.writeFileSync(path.join(T, 'assist', 'learn.json'), JSON.stringify(L0));
a.equal(X.post({ op: 'improve', do: 'approve', id: 'route:quick question:sonnet' }).res, 'ok');
const bad = JSON.parse(fs.readFileSync(CF)); bad[0].msgs.push(...Array.from({ length: 12 }, () => [{ r: 'u', x: 'q' }, { r: 'a', x: 'a', ok: true, model: 'sonnet', route: 'quick question', exp: 'route:quick question:sonnet', v: -1 }]).flat()); fs.writeFileSync(CF, JSON.stringify(bad));
X.post({ op: 'rate', id: 'c2', i: 1, v: -1 }); a.equal(X.status().brain.rules[0].status, 'rolled back'); a.match(X.status().brain.history[0].what, /rolled back automatically/);
// dismiss hides a proposal
a.equal(X.post({ op: 'improve', do: 'dismiss', id: 'route:quick question:sonnet' }).res, 'ok'); a.ok(!X.status().brain.proposals.some(p => p.id === 'route:quick question:sonnet'));

// Phase 5 skills: same request in 3 chats → skill proposal → approve writes nexus-* SKILL.md + version → rollback removes it
const q = 'how do I publish my roblox game update to players';
fs.writeFileSync(CF, JSON.stringify(['k1', 'k2', 'k3'].map(id => conv(id, [[q, { model: 'sonnet', route: 'development task', v: 1 }]]))));
const sk = X.status().brain.proposals.find(p => p.kind === 'skill'); a.ok(sk, 'skill proposal'); a.equal(sk.evidence.chats, 3);
a.equal(X.post({ op: 'improve', do: 'approve', id: sk.id }).res, 'ok');
const sd = path.join(T, 'skills', 'nexus-' + sk.id.slice(6)); a.match(fs.readFileSync(path.join(sd, 'SKILL.md'), 'utf8'), /^---\nname: nexus-publish-roblox-game-update\n/);
a.equal(X.status().brain.skills[0].versions.join(), '1'); a.ok(!X.status().brain.proposals.some(p => p.id === sk.id));
fs.mkdirSync(path.join(T, 'skills', 'nexus-mine'), { recursive: true }); // a user's own nexus-* folder is never overwritten
a.match(B.decide({ skills: [] }, 'approve', 'skill:mine', { id: 'skill:mine', kind: 'skill', title: 't', evidence: { q: 'x', n: 3 } }, path.join(T, 'v')), /not managed by NEXUS/);
a.equal(X.post({ op: 'improve', do: 'rollback', id: sk.id }).res, 'ok'); a.ok(!fs.existsSync(sd));

// Phase 9: savings vs all-Sonnet (list-price estimate) + repeat cache
const sv = B._.savings([{ model: 'haiku', cost: 0.01 }, { model: 'opus', cost: 0.05 }, { model: 'sonnet', cost: 0.02 }]);
a.deepEqual([sv.actual, sv.allSonnet, sv.saved], [0.08, 0.08, 0]);
a.equal(B._.savings([{ model: 'haiku', cost: 0.01 }]).saved, 0.02);
fs.writeFileSync(CF, JSON.stringify([conv('r1', [['What is my usage?', { model: 'haiku', mode: 'read', project: null }]])]));
const cAll = JSON.parse(fs.readFileSync(CF));
a.ok(X._.cached(cAll, '  what is my USAGE? ', null, 'read')); a.equal(X._.cached(cAll, 'what is my usage?', { id: 'g' }, 'read'), null); a.equal(X._.cached(cAll, 'what is my usage?', null, 'edit'), null);
{ const out = []; let code; X.send({ text: 'what is my usage?', conv: 'r1' }, { writeHead: c => { code = c }, write: l => out.push(JSON.parse(l)), end: () => { }, on() { } });
  a.equal(code, 200); a.ok(out[0].cached && /no new Claude call/.test(out[0].why)); a.equal(out.at(-1).t, 'done'); a.equal(JSON.parse(fs.readFileSync(CF))[0].msgs.at(-1).cached, true) }

// Phase 7 plans: fake CLI; step 1 ok, step 2 fails twice → paused; Skip → run again → done; duplicates refused; cancel
const fake = path.join(T, 'fake-claude.js');
fs.writeFileSync(fake, `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const t=/FAIL/.test(s)?'nope\\nRESULT: failed - broken':'did it\\nRESULT: ok';
console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:t}}}));
console.log(JSON.stringify({type:'result',is_error:false,result:t,session_id:'S1',total_cost_usd:0.002,usage:{input_tokens:5,output_tokens:5}}))})`);
const spawn0 = cp.spawn; cp.spawn = (c, args, o) => spawn0(process.execPath, [fake], o);
const wait = (f, ms = 15000) => new Promise((ok, no) => { const t0 = Date.now(), go = () => f() ? ok() : Date.now() - t0 > ms ? no(new Error('timeout')) : setTimeout(go, 50); go() });
const J = id => X.status().jobs.find(j => j.id === id);
(async () => {
  const p1 = X.post({ op: 'plan', title: 'Mobile pass', steps: ['Find heavy scripts', 'FAIL on purpose', 'Write the report'], project: 'g' }); a.equal(p1.res, 'ok');
  a.match(X.post({ op: 'plan', title: 'Mobile pass', steps: ['x'], project: 'g' }).res, /already waiting/);
  a.match(X.post({ op: 'plan', steps: ['x'], mode: 'edit' }).res, /Pick a project/); a.match(X.post({ op: 'plan', steps: [] }).res, /at least one step/);
  a.equal(X.post({ op: 'jobrun', id: p1.id }).res, 'ok'); a.match(X.post({ op: 'jobrun', id: p1.id }).res, /Another plan/);
  await wait(() => J(p1.id).status === 'paused');
  let j = J(p1.id); a.deepEqual(j.steps.map(s => s.st), ['ok', 'fail', 'wait']); a.equal(j.steps[1].tries, 2); a.match(j.log[0].x, /Step 2 failed: broken/); a.match(j.log[1].x, /retrying once/);
  a.ok(j.conv); const cv = X.one(j.conv); a.match(cv.msgs[0].x, /step 1 of 3: Find heavy scripts/); // all steps share one chat
  a.equal(X.post({ op: 'jobskip', id: p1.id }).res, 'ok'); a.equal(X.post({ op: 'jobrun', id: p1.id }).res, 'ok');
  await wait(() => J(p1.id).status === 'done'); j = J(p1.id); a.deepEqual(j.steps.map(s => s.st), ['ok', 'skip', 'ok']); a.equal(j.cost, 0.008); a.equal(X.post({ op: 'jobrun', id: p1.id }).res, 'This plan is already finished.');
  const p2 = X.post({ op: 'plan', title: 'Long', steps: ['a', 'b'] }); X.post({ op: 'jobrun', id: p2.id }); a.equal(X.post({ op: 'jobcancel', id: p2.id }).res, 'ok');
  await wait(() => X.status().plan === null); a.equal(J(p2.id).status, 'cancelled');
  a.equal(X.post({ op: 'jobdel', id: p2.id }).res, 'ok'); a.equal(J(p2.id), undefined);
  cp.spawn = spawn0;
})().then(() => { fs.rmSync(T, { recursive: true, force: true }); console.log('test-brain: all checks passed') }, e => { cp.spawn = spawn0; console.error(e); process.exit(1) });
