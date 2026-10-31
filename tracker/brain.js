// NEXUS Assistant brain (post-M7 Phases 5, 6, 8, 9; master prompt in my-game/docs/NEXUS M7 Master Prompt.md). Pure Node, no new dependency.
// Phase 5 controlled self-improvement: Observe (rated answers) → Analyze (per route: help rate, cost, errors) → Propose (with evidence)
//   → Test (A/B experiment on a share of requests, only after the user's Approve) → Measure → Validate (keep or auto-roll-back) → Remember.
//   Boundaries: only routing rules and NEXUS-managed skills (~/.claude/skills/nexus-*) change, each only on the user's click, every
//   version is kept and can be rolled back. Nothing edits code, installs anything or changes itself recursively.
// Phase 6 Roblox/Blender project check: static scan (Luau risks, structure, Blender files, matching installed skills).
// Phase 8 context: ranks vault + project notes and the project's Graphify graph for the request, so Claude reads only the top few.
// Phase 9: measured cost per model, estimated savings vs all-Sonnet, repeat-question cache.
const fs = require('fs'), path = require('path'), os = require('os');
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
const writeJ = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o)); fs.renameSync(f + '.tmp', f) };
const SKILLS = () => process.env.NEXUS_SKILLS || path.join(os.homedir(), '.claude', 'skills');
const CLASSES = ['quick question', 'development task', 'complex reasoning'];
// list-price ratios vs Sonnet (estimate, input+output priced alike: Haiku 1/3, Opus 5/3 of Sonnet)
const PRICE = { haiku: 1 / 3, sonnet: 1, opus: 5 / 3 };
const STOP = new Set('the and for with that this what how why when where you your are was can not but all any have has from into about please could would should does did its my our use make get also just more than then them they there their which will'.split(' '));
const words = s => String(s || '').toLowerCase().match(/[a-z0-9][a-z0-9_]{2,}/g)?.filter(w => !STOP.has(w)) || [];
const jac = (a, b) => { const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i) };
const cls = route => CLASSES.find(c => String(route || '').startsWith(c)) || 'development task';

// ---------- Phase 5 + 9: observe + analyze ----------
function observe(convs) {
  const out = [];
  for (const c of convs) for (let i = 0; i < c.msgs.length; i++) { const m = c.msgs[i]; if (m.r !== 'a' || m.cached) continue;
    out.push({ conv: c.id, i, project: c.project, model: m.model, cls: cls(m.route), exp: m.exp || null, ok: m.ok !== false, v: m.v || 0, cost: typeof m.cost === 'number' ? m.cost : null, tools: (m.tools || []).length, q: c.msgs[i - 1]?.x || '' }) }
  return out;
}
function stats(obs) {
  const g = {};
  for (const o of obs) { const k = o.model + '|' + o.cls, s = g[k] ||= { model: o.model, cls: o.cls, n: 0, up: 0, down: 0, err: 0, cost: 0, costN: 0, tools: 0 };
    s.n++; s.up += o.v > 0; s.down += o.v < 0; s.err += !o.ok; s.tools += o.tools; if (o.cost != null) { s.cost += o.cost; s.costN++ } }
  return Object.values(g).map(s => ({ ...s, help: s.up + s.down ? s.up / (s.up + s.down) : null, avgCost: s.costN ? s.cost / s.costN : null, avgTools: s.n ? s.tools / s.n : 0 }));
}
function savings(obs) {
  let actual = 0, base = 0, n = 0;
  for (const o of obs) if (o.cost != null && PRICE[o.model]) { actual += o.cost; base += o.cost / PRICE[o.model]; n++ }
  return { answers: n, actual: +actual.toFixed(4), allSonnet: +base.toFixed(4), saved: +(base - actual).toFixed(4), estimate: true };
}
// repeated requests in 3+ different chats = a skill opportunity (reusable instructions)
function repeats(obs) {
  const qs = obs.filter(o => o.q.length > 20).map(o => ({ ...o, w: words(o.q) })), seen = new Set(), out = [];
  for (const a of qs) { if (seen.has(a.conv + a.i)) continue; const grp = qs.filter(b => jac(a.w, b.w) >= 0.6); const chats = new Set(grp.map(b => b.conv));
    if (chats.size >= 3) { grp.forEach(b => seen.add(b.conv + b.i)); out.push({ q: a.q.slice(0, 200), n: grp.length, chats: chats.size, up: grp.filter(b => b.v > 0).length }) } }
  return out;
}
const slug = s => words(s).slice(0, 4).join('-').slice(0, 40) || 'task';
function analyze(convs, L) {
  const obs = observe(convs), st = stats(obs), props = [], has = id => (L.rules || []).some(r => r.id === id && r.status !== 'rolled back') || (L.dismissed || []).includes(id);
  const at = (m, c) => st.find(s => s.model === m && s.cls === c);
  for (const c of CLASSES) {
    const cur = c === 'quick question' ? 'haiku' : c === 'development task' ? 'sonnet' : 'opus', s = at(cur, c);
    if (!s || s.up + s.down < 5) continue;
    const up = { haiku: 'sonnet', sonnet: 'opus' }[cur], down = { sonnet: 'haiku', opus: 'sonnet' }[cur];
    if (up && s.help < 0.5 && !has(`route:${c}:${up}`)) props.push({ id: `route:${c}:${up}`, kind: 'route', cls: c, from: cur, to: up, risk: 'low',
      title: `Try ${up} for ${c}s`, why: `${s.down} of ${s.up + s.down} rated ${cur} answers for ${c}s were not helpful (${Math.round(s.help * 100)}% helpful).`, evidence: s });
    if (down && s.help >= 0.85 && s.up + s.down >= 10 && !has(`route:${c}:${down}`)) props.push({ id: `route:${c}:${down}`, kind: 'route', cls: c, from: cur, to: down, risk: 'low',
      title: `Try cheaper ${down} for ${c}s`, why: `${Math.round(s.help * 100)}% of ${s.up + s.down} rated ${cur} answers were helpful; ${down} costs about ${Math.round((1 - PRICE[down] / PRICE[cur]) * 100)}% less (list price, estimate).`, evidence: s });
  }
  for (const r of repeats(obs)) { const id = 'skill:' + slug(r.q); if (!has(id) && !(L.skills || []).some(k => k.id === id)) props.push({ id, kind: 'skill', risk: 'medium', title: `Make a reusable skill: "${r.q.slice(0, 60)}"`, why: `You asked this ${r.n} times in ${r.chats} chats (${r.up} answers rated helpful). A skill saves re-explaining it.`, evidence: r }) }
  const lessons = st.filter(s => s.n >= 5 && s.err / s.n > 0.2).map(s => `${s.model} failed ${s.err} of ${s.n} ${s.cls}s; check sign-in or usage limits.`);
  const heavy = st.filter(s => s.n >= 5 && s.avgTools > 8).map(s => `${s.model} ${s.cls}s use ${s.avgTools.toFixed(1)} tool calls on average; pick a project and add notes so it searches less.`);
  return { stats: st, proposals: props, lessons: [...(L.lessons || []), ...lessons, ...heavy], savings: savings(obs) };
}

// ---------- Phase 5: experiments + rules (route() consults these) ----------
const EXP_N = 12, EXP_SHARE = 0.25; // an experiment sends 1 in 4 matching requests to the new model until 12 of them are rated
function routeRule(L, c, rnd = Math.random()) {
  for (const r of L.rules || []) if (r.kind === 'route' && r.cls === c) {
    if (r.status === 'active') return { model: r.to, why: `${c} (learned rule v${r.v})` };
    if (r.status === 'experiment' && rnd < EXP_SHARE) return { model: r.to, why: `${c} (experiment: testing ${r.to})`, exp: r.id };
  }
  return null;
}
// Validate: experiment answers vs the same class on the old model in the same period; keep if help rate within 10 points
function measure(convs, L) {
  const obs = observe(convs); let changed = false;
  for (const r of L.rules || []) { if (r.status !== 'experiment') continue;
    const e = obs.filter(o => o.exp === r.id && o.v);
    r.tested = e.length;
    if (e.length < EXP_N) continue;
    const base = obs.filter(o => !o.exp && o.cls === r.cls && o.model === r.from && o.v), help = x => x.length ? x.filter(o => o.v > 0).length / x.length : 0;
    r.result = { new: +help(e).toFixed(2), old: +help(base).toFixed(2), n: e.length, nOld: base.length, cost: { new: avg(e), old: avg(base) } };
    const keep = r.result.new >= r.result.old - 0.1; r.status = keep ? 'active' : 'rolled back'; r.done = Date.now(); changed = true;
    (L.history ||= []).unshift({ at: r.done, what: `${r.title}: ${keep ? 'kept' : 'rolled back automatically'} (${Math.round(r.result.new * 100)}% vs ${Math.round(r.result.old * 100)}% helpful, ${e.length} rated)` });
    (L.lessons ||= []).unshift(`${r.to} for ${r.cls}s: ${keep ? 'works as well' : 'worse'} than ${r.from} (${Math.round(r.result.new * 100)}% vs ${Math.round(r.result.old * 100)}%), ${new Date(r.done).toISOString().slice(0, 10)}.`);
  }
  L.lessons = (L.lessons || []).slice(0, 30); L.history = (L.history || []).slice(0, 100);
  return changed;
}
const avg = x => { const c = x.filter(o => o.cost != null); return c.length ? +(c.reduce((s, o) => s + o.cost, 0) / c.length).toFixed(5) : null };

// approve / dismiss / roll back; skill files only under SKILLS()/nexus-*, every version kept in vdir
function decide(L, op, id, prop, vdir) {
  const rules = L.rules ||= [], hist = L.history ||= [];
  if (op === 'dismiss') { (L.dismissed ||= []).push(id); hist.unshift({ at: Date.now(), what: `Dismissed: ${prop?.title || id}` }); return 'ok' }
  if (op === 'approve') {
    if (!prop) return 'This proposal is no longer current.';
    if (prop.kind === 'route') { const old = rules.filter(r => r.cls === prop.cls); rules.splice(0, rules.length, ...rules.filter(r => r.cls !== prop.cls));
      rules.push({ id: prop.id, kind: 'route', cls: prop.cls, from: prop.from, to: prop.to, title: prop.title, why: prop.why, status: 'experiment', v: old.length + 1, at: Date.now(), tested: 0 });
      hist.unshift({ at: Date.now(), what: `Experiment started: ${prop.title}` }); return 'ok' }
    if (prop.kind === 'skill') return writeSkill(L, prop, vdir);
  }
  if (op === 'rollback') {
    const r = rules.find(x => x.id === id); if (r) { r.status = 'rolled back'; r.done = Date.now(); hist.unshift({ at: r.done, what: `Rolled back by you: ${r.title}` }); return 'ok' }
    const k = (L.skills || []).find(x => x.id === id); if (!k) return 'not found';
    const f = path.join(SKILLS(), k.dir, 'SKILL.md'), vs = k.versions;
    if (vs.length > 1) { vs.pop(); fs.writeFileSync(f, fs.readFileSync(path.join(vdir, k.dir, `v${vs.at(-1)}.md`))) } else { fs.rmSync(path.join(SKILLS(), k.dir), { recursive: true, force: true }); L.skills = L.skills.filter(x => x !== k) }
    hist.unshift({ at: Date.now(), what: `Skill ${k.dir} rolled back to ${vs.length ? 'v' + vs.at(-1) : 'removed'}` }); return 'ok';
  }
  return 'bad request';
}
function writeSkill(L, prop, vdir) {
  const dir = 'nexus-' + prop.id.slice(6), d = path.join(SKILLS(), dir), q = prop.evidence.q.replace(/\s+/g, ' ').trim();
  if (fs.existsSync(d) && !(L.skills || []).some(k => k.dir === dir)) return `A skill folder named ${dir} already exists and is not managed by NEXUS, so it was left alone.`;
  const k = (L.skills ||= []).find(x => x.dir === dir) || (L.skills.push({ id: prop.id, dir, versions: [], at: Date.now() }), L.skills.at(-1)), v = (k.versions.at(-1) || 0) + 1;
  const md = `---\nname: ${dir}\ndescription: Use when the user asks something like "${q.slice(0, 160).replace(/"/g, "'")}". Made by NEXUS from ${prop.evidence.n} similar requests (v${v}).\n---\n\n# ${prop.title.replace(/^Make a reusable skill: /, '')}\n\nThe user often asks: "${q}"\n\n- Start from the project's notes (PROJECT_MEMORY.md, the vault MEMORY.md) instead of searching the whole folder.\n- Answer in short plain language; offer detail only when asked.\n- Reuse what worked before; say which files you changed.\n\nManaged by NEXUS (Settings → Improvements). Edit it freely; NEXUS keeps each version and can roll back.\n`;
  fs.mkdirSync(d, { recursive: true }); fs.mkdirSync(path.join(vdir, dir), { recursive: true });
  fs.writeFileSync(path.join(vdir, dir, `v${v}.md`), md); fs.writeFileSync(path.join(d, 'SKILL.md'), md); k.versions.push(v);
  (L.history ||= []).unshift({ at: Date.now(), what: `Skill ${dir} v${v} written (${prop.evidence.n} similar requests)` }); return 'ok';
}

// ---------- Phase 6: Roblox / Blender project check ----------
const SKIP = /^(node_modules|\.git|Packages|DevPackages|backups?|dist|build|target|graphify-out|\.obsidian)$/i;
function walk(dir, max = 3000) {
  const out = [], q = [[dir, 0]];
  while (q.length && out.length < max) { const [d, depth] = q.shift(); let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of es) { const f = path.join(d, e.name); if (e.isDirectory()) { if (!SKIP.test(e.name) && depth < 8) q.push([f, depth + 1]) } else out.push(f) } }
  return out;
}
const RULES = [
  [/\.OnServerEvent:Connect\(/, (ls, i) => !ls.slice(i, i + 15).some(l => /typeof\(|type\(|assert\(|:IsA\(|tonumber\(/.test(l)), 'security', 'RemoteEvent handler with no argument checks: validate type and range on the server (exploiters can send anything).'],
  [/\.OnServerInvoke\s*=/, (ls, i) => !ls.slice(i, i + 15).some(l => /typeof\(|type\(|assert\(/.test(l)), 'security', 'RemoteFunction handler with no argument checks.'],
  [/:(GetAsync|SetAsync|UpdateAsync|IncrementAsync|RemoveAsync)\(/, (ls, i) => !ls.slice(Math.max(0, i - 3), i + 1).some(l => /pcall|xpcall/.test(l)), 'data', 'DataStore call outside pcall: it can fail (throttling, outages) and stop the script.'],
  [/^\s*while\s+true\s+do/, (ls, i) => !ls.slice(i, i + 8).some(l => /task\.wait|wait\(|\.Heartbeat:Wait|RunService/.test(l)), 'performance', 'while true loop without a wait: freezes the game.'],
  [/(^|[^.\w])wait\(/, () => true, 'style', 'Deprecated wait(): use task.wait().'],
  [/(^|[^.\w])(spawn|delay)\(/, () => true, 'style', 'Deprecated spawn/delay: use task.spawn / task.delay.'],
  [/\.(RenderStepped|Heartbeat|Stepped):Connect\(/, (ls, i) => ls.slice(i, i + 12).some(l => /Instance\.new\(/.test(l)), 'performance', 'Instance.new inside a per-frame loop: creates objects every frame (memory, mobile lag).'],
];
const cache = new Map();
function scan(p, skillNames = installedSkills()) {
  const hit = cache.get(p.dir); if (hit && Date.now() - hit.at < 5 * 60e3) return hit.r;
  const files = walk(p.dir), lua = files.filter(f => /\.(lua|luau)$/i.test(f)), blend = files.filter(f => /\.blend$/i.test(f)), fbx = files.filter(f => /\.(fbx|obj)$/i.test(f));
  const rojo = files.find(f => /default\.project\.json$/i.test(f)), find = [], kinds = {};
  let lines = 0, server = 0, client = 0, modules = 0;
  for (const f of lua.slice(0, 600)) { let s; try { if (fs.statSync(f).size > 400e3) continue; s = fs.readFileSync(f, 'utf8') } catch { continue }
    const ls = s.split(/\r?\n/), rel = path.relative(p.dir, f).replace(/\\/g, '/'); lines += ls.length;
    if (/\.server\.(lua|luau)$/i.test(f)) server++; else if (/\.client\.(lua|luau)$/i.test(f)) client++; else modules++;
    ls.forEach((l, i) => { if (/^\s*--/.test(l)) return; for (const [re, bad, k, msg] of RULES) if (re.test(l) && bad(ls, i)) { kinds[k] = (kinds[k] || 0) + 1; if (find.length < 60) find.push({ k, file: rel, line: i + 1, msg }) } }) }
  let tree = []; if (rojo) { const t = readJ(rojo, {}).tree || {}; tree = Object.keys(t).filter(k => !k.startsWith('$')).map(k => k + (typeof t[k] === 'object' ? ': ' + Object.keys(t[k]).filter(x => !x.startsWith('$')).slice(0, 6).join(', ') : '')) }
  const blendMB = blend.reduce((s, f) => { try { return s + fs.statSync(f).size } catch { return s } }, 0) / 1048576;
  const roblox = !!rojo || lua.length > 0 || files.some(f => /\.rbxl[x]?$/i.test(f)), want = [roblox && /roblox|luau|rojo|studio/i, blend.length && /blender/i].filter(Boolean);
  const r = { roblox, blender: blend.length > 0, scripts: { server, client, modules, lines }, tree, blend: { files: blend.length, mb: +blendMB.toFixed(1), exports: fbx.length },
    counts: kinds, findings: find.sort((a, b) => ['security', 'data', 'performance', 'style'].indexOf(a.k) - ['security', 'data', 'performance', 'style'].indexOf(b.k)),
    skills: skillNames.filter(n => want.some(w => w.test(n))).slice(0, 12), at: Date.now() };
  cache.set(p.dir, { at: Date.now(), r }); return r;
}
function installedSkills() {
  const out = new Set(), base = path.join(os.homedir(), '.claude');
  for (const d of [path.join(base, 'skills')]) { try { for (const n of fs.readdirSync(d)) out.add(n) } catch { } }
  try { for (const f of walk(path.join(base, 'plugins'), 4000)) if (/[\\/]skills[\\/][^\\/]+[\\/]SKILL\.md$/i.test(f)) out.add(path.basename(path.dirname(f))) } catch { }
  return [...out];
}
// short text for the system prompt: architecture + top findings, so Claude knows the project before suggesting changes
function brief(r) {
  if (!r.roblox && !r.blender) return '';
  return [r.roblox && `Roblox project scan: ${r.scripts.server} server, ${r.scripts.client} client, ${r.scripts.modules} module scripts (${r.scripts.lines} lines).` + (r.tree.length ? ' Rojo tree: ' + r.tree.join('; ') + '.' : ''),
    r.findings.length && 'Static check found: ' + Object.entries(r.counts).map(([k, n]) => `${n} ${k}`).join(', ') + '. Top: ' + r.findings.slice(0, 3).map(f => `${f.file}:${f.line} ${f.msg}`).join(' | '),
    r.blender && `Blender: ${r.blend.files} .blend file(s), ${r.blend.mb} MB, ${r.blend.exports} FBX/OBJ export(s).`,
    r.skills.length && 'Relevant installed skills: ' + r.skills.join(', ') + '.'].filter(Boolean).join('\n');
}

// ---------- Phase 8: ranked context ----------
const idx = new Map(); // file -> { mt, title, w: Map(word->count), status }
function index(files) {
  for (const f of files) { let st; try { st = fs.statSync(f) } catch { continue } const old = idx.get(f); if (old && old.mt === st.mtimeMs) continue;
    let s = ''; try { const fd = fs.openSync(f, 'r'), b = Buffer.alloc(12000); s = b.toString('utf8', 0, fs.readSync(fd, b, 0, 12000, 0)); fs.closeSync(fd) } catch { continue }
    const w = new Map(); for (const x of words(s)) w.set(x, (w.get(x) || 0) + 1);
    const status = /^status:\s*(.*)$/mi.exec(s)?.[1] || '';
    idx.set(f, { mt: st.mtimeMs, title: path.basename(f, '.md'), tw: new Set(words(path.basename(f, '.md'))), w, status: /superseded|scrapped|obsolete/i.test(status) ? 'outdated' : /approved/i.test(status) ? 'approved' : '' }) }
}
function recall(text, dirs, k = 3) {
  const files = dirs.flatMap(d => { try { return walk(d, 1500).filter(f => /\.md$/i.test(f)) } catch { return [] } }).slice(0, 2000);
  index(files);
  const q = [...new Set(words(text))]; if (!q.length) return [];
  const N = files.length || 1, df = w => { let n = 0; for (const f of files) if (idx.get(f)?.w.has(w)) n++; return n };
  const idf = Object.fromEntries(q.map(w => [w, Math.log(1 + N / (1 + df(w)))]));
  return files.map(f => { const e = idx.get(f); if (!e) return null; let s = 0; for (const w of q) s += idf[w] * (Math.min(e.w.get(w) || 0, 5) + (e.tw.has(w) ? 4 : 0)); return { f, s: e.status === 'outdated' ? s / 2 : s, title: e.title, status: e.status } })
    .filter(x => x && x.s > 2).sort((a, b) => b.s - a.s).slice(0, k);
}
function graphHits(text, dir, k = 3) {
  const g = readJ(path.join(dir, 'graphify-out', 'graph.json'), null); if (!g) return [];
  const q = new Set(words(text)); if (!q.size) return [];
  return (g.nodes || []).map(n => ({ n, s: words(n.label || n.id).filter(w => q.has(w)).length })).filter(x => x.s > 0 && x.n.source_file).sort((a, b) => b.s - a.s).slice(0, k).map(x => ({ label: x.n.label || x.n.id, file: x.n.source_file }));
}
const dup = (x, list) => list.find(m => jac(words(m.x), words(x)) >= 0.8);

module.exports = { analyze, measure, routeRule, decide, scan, brief, recall, graphHits, dup, words, jac, cls, CLASSES, installedSkills, _: { stats, savings, repeats, observe, index, RULES } };
