// M3 built-in graph tests: node test-graph.js. Mock user alice, mock vault + projects in a temp folder; never touches real data.
// Covers: graph.json shape, same input → same bytes, incremental cache, deleted notes, parity with knowledge.js's extraction,
// Graphify optional (fallback notice, Graphify's files never written), privacy (another project's folder and another user left out).
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-graph-')), SAVE = { ...process.env };
let pass = 0; const fail = []; const ok = (c, m) => c ? pass++ : fail.push(m);
const mk = (...p) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d };
const W = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) };
const H = mk(T, 'Users', 'alice'), D = mk(H, 'AppData', 'Local', 'NEXUS'), C = mk(H, '.claude');
const V = mk(H, 'Vaults', 'Main'), PA = mk(H, 'Games', 'A'), PB = mk(H, 'Games', 'B');
Object.assign(process.env, { USERPROFILE: H, APPDATA: mk(H, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(H, 'AppData', 'Local'), NEXUS_DATA: D, CLAUDE_CONFIG_DIR: C,
  NEXUS_VAULT: V, NEXUS_PROJ: PA, NEXUS_SKILLS: path.join(C, 'skills'), NEXUS_PCACHE: path.join(C, 'plugins', 'cache') });
try {
  mk(V, '.obsidian'); W(path.join(V, 'MEMORY.md'), '---\ntags: [memory]\n---\n# Memory\n[[Project Docs]] [[Rules]] [[Missing]] [[Secret B]]\n');
  W(path.join(V, 'Rules.md'), '---\ntags: [memory, rules]\naliases: [Rulebook]\n---\nUses roblox-dev-skill. [[MEMORY]]\n');
  W(path.join(V, 'Demo Game', 'Project Docs.md'), '# Docs\n[[Rulebook]]\n'); W(path.join(V, 'KB', 'Deep', 'Api.md'), '---\ntags: [kb]\n---\n[[Rules]]\n');
  W(path.join(V, 'Game B', 'Secret B.md'), '# B private\n[[Rules]]\n'); W(path.join(V, '.trash', 'Old.md'), 'old'); W(path.join(V, 'copilot', 'skills', 'cop', 'SKILL.md'), '---\nname: copilot-helper\n---\n');
  W(path.join(C, 'skills', 'roblox', 'SKILL.md'), '---\nname: roblox-dev-skill\n---\n'); W(path.join(C, 'plugins', 'cache', 'mkt', 'plug', '1.0', 'skills', 's', 'SKILL.md'), '---\nname: headroom\n---\n');
  W(path.join(PA, 'CLAUDE.md'), '# A\nRead PROJECT_DOCS.md and [[Rules]].\n## Approval workflow (every asset)\n## Backups\n'); W(path.join(PA, 'PROJECT_MEMORY.md'), 'See [[MEMORY]].\n');
  const G = require('./graph.js'), K = require('./knowledge.js'), sp = require('./safepath');
  const pa = { id: 'pa', name: 'Demo Game', dir: PA, vault: V, vaultFolder: 'Demo Game', graph: { mode: 'builtin', out: '' } };
  const pb = { id: 'pb', name: 'Game B', dir: PB, vault: V, vaultFolder: 'Game B' };
  // parity: same nodes and links as knowledge.js's extraction (the rules graphify_vault.py uses), with no other project linked
  const x = G.extract(V, PA, { name: pa.name, folder: pa.vaultFolder, skills: [[path.join(C, 'skills'), 'user skills'], [path.join(V, 'copilot', 'skills'), 'obsidian copilot']], pcache: path.join(C, 'plugins', 'cache') });
  const k = K._.extract(), key = m => [...m.values()].map(n => n.id + '|' + n.label + '|' + n.group + '|' + n.file_type).sort().join('\n'), ek = m => [...m.entries()].map(([k, e]) => k + '|' + e.relation + '|' + e.weight).sort().join('\n');
  ok(key(x.N) === key(k.N) && x.N.size > 15, 'parity with knowledge.js: same nodes (' + x.N.size + ' / ' + k.N.size + ')');
  ok(ek(x.E) === ek(k.E) && x.E.size > 15, 'parity with knowledge.js: same links (' + x.E.size + ' / ' + k.E.size + ')');
  // shape + determinism + per-project output in the data folder
  const items = [pa, pb]; let b1 = G.build(pa, { items });
  const g = JSON.parse(fs.readFileSync(b1.file, 'utf8')), ids = new Set(g.nodes.map(n => n.id));
  ok(b1.file === path.join(fs.realpathSync.native(D), 'graphs', 'pa', 'graph.json'), 'graph saved per project in the NEXUS data folder');
  ok(g.nodes.every(n => n.id && n.label && n.group !== undefined && Number.isInteger(n.community)) && g.links.every(l => ids.has(l.source) && ids.has(l.target) && l.relation), 'graph.json shape: nodes + links that point at real nodes');
  ok(['note_memory', 'note_rules', 'folder_kb_deep', 'tag_memory', 'project_spooky_clicker_simulator', 'workflow_approval_workflow', 'skill_user_skills_roblox_dev_skill', 'skill_plug_headroom'].every(i => ids.has(i)), 'notes, nested folders, tags, project, workflows, skills present');
  ok(g.links.some(l => l.relation === 'mentions' && [l.source, l.target].includes('skill_user_skills_roblox_dev_skill')) && g.links.some(l => l.source === 'note_project_docs' && l.target === 'note_rules' || l.target === 'note_project_docs' && l.source === 'note_rules'), 'mentions + alias links resolved');
  ok(!ids.has('note_old'), 'hidden folders (.trash) left out');
  const b2 = G.build(pa, { items }); ok(b2.sha === b1.sha && fs.readFileSync(b1.file, 'utf8') === JSON.stringify(g), 'same input → same graph bytes');
  ok(b1.parsed > 0 && b2.parsed === 0 && b2.cached === b1.parsed, 'incremental: second build re-read no notes (' + b2.cached + ' cached)');
  const cj = fs.readFileSync(path.join(D, 'graphs', 'pa', 'cache.json'), 'utf8'), cn = JSON.parse(cj).notes;
  ok(JSON.parse(cj).version === 2 && !/# Memory|Uses roblox|B private|# Docs/.test(cj) && Object.values(cn).every(n => !('text' in n) && Array.isArray(n.links) && Array.isArray(n.mentions)), 'cache = metadata only: no note text (tags, aliases, link targets, skill names)');
  W(path.join(D, 'graphs', 'pa', 'cache.json'), JSON.stringify({ version: 1, notes: { 'MEMORY.md': { r: 'MEMORY.md', text: 'OLD SECRET TEXT' } } }));
  ok(G.build(pa, { items }).sha === b1.sha && !/OLD SECRET/.test(fs.readFileSync(path.join(D, 'graphs', 'pa', 'cache.json'), 'utf8')), 'old v1 cache with note text dropped and rebuilt without text');
  W(path.join(C, 'skills', 'extra', 'SKILL.md'), '---\nname: brand-new-skill\n---\n'); const bs = G.build(pa, { items }); ok(bs.parsed > 0 && bs.cached === 0, 'skill list changed → mentions re-read');
  fs.rmSync(path.join(C, 'skills', 'extra'), { recursive: true }); G.build(pa, { items });
  fs.rmSync(path.join(D, 'graphs', 'pa', 'cache.json')); ok(G.build(pa, { items }).sha === b1.sha, 'build without cache = same graph');
  W(path.join(V, 'Rules.md'), '---\ntags: [memory, rules]\naliases: [Rulebook]\n---\nUses roblox-dev-skill. [[MEMORY]] [[Api]] edited\n');
  const b3 = G.build(pa, { items }); ok(b3.parsed === 1 && b3.sha !== b1.sha, 'one note edited → one note re-read, graph updated');
  fs.rmSync(path.join(V, 'KB', 'Deep', 'Api.md')); const b4 = G.build(pa, { items }), g4 = JSON.parse(fs.readFileSync(b4.file, 'utf8'));
  ok(!g4.nodes.some(n => n.id === 'note_api') && !Object.keys(JSON.parse(fs.readFileSync(path.join(D, 'graphs', 'pa', 'cache.json'))).notes).some(r => /Api/.test(r)), 'deleted note leaves the graph and the cache');
  // privacy: project B's linked folder never appears in A's graph (and the reverse), output folders separate
  const ga = fs.readFileSync(b4.file, 'utf8'); ok(!/Secret B|Game B|B private/.test(ga), "A's graph has none of B's notes, folder or text");
  ok(!Object.keys(JSON.parse(fs.readFileSync(path.join(D, 'graphs', 'pa', 'cache.json'), 'utf8')).notes).some(r => r.startsWith('Game B/')), "A's cache holds none of B's notes");
  W(path.join(PB, 'CLAUDE.md'), '# B\n'); const bb = G.build(pb, { items }), gb = fs.readFileSync(bb.file, 'utf8');
  ok(/Secret B/.test(gb) && !/Project Docs\.md/.test(gb) && bb.file.includes(path.join('graphs', 'pb')), "B's graph has B's notes, not A's linked folder; separate output");
  const solo = G.build(pa, { items: [pa], out: path.join(D, 'tmp-solo') }); ok(/Secret B/.test(fs.readFileSync(solo.file, 'utf8')), 'an unlinked folder is a normal folder of this user (only linked project folders are private)');
  // Graphify optional: fallback notice, never writes graphify-out
  const GO = mk(PA, 'graphify-out'); W(path.join(GO, 'graph.json'), '{"nodes":[{"id":"x"}],"links":[]}'); const goh = fs.readFileSync(path.join(GO, 'graph.json'));
  ok(G.source({ ...pa, graph: { mode: 'graphify', out: GO } }).source === 'graphify', 'Graphify chosen + readable → Graphify graph');
  const fb = G.source({ ...pa, graph: { mode: 'graphify', out: path.join(PA, 'nope') } }); ok(fb.source === 'builtin' && fb.fallback && /not found/.test(fb.notice), 'Graphify missing → built-in graph with a notice');
  W(path.join(GO, 'bad', 'graph.json'), '{broken'); ok(G.source({ ...pa, graph: { mode: 'graphify', out: path.join(GO, 'bad') } }).fallback, 'Graphify unreadable → fallback');
  ok(G.source(pa).source === 'builtin', 'built-in mode → built-in graph');
  let e = ''; try { G.build(pa, { items, out: GO, root: PA }) } catch (x) { e = x.message } ok(/Graphify/.test(e), 'build into graphify-out refused (' + e.slice(0, 50) + ')');
  e = ''; try { G.build(pa, { items, out: path.join(PA, 'g') }) } catch (x) { e = x.message } ok(/outside the allowed/.test(e), 'build outside the data folder refused');
  ok(fs.readFileSync(path.join(GO, 'graph.json')).equals(goh) && fs.readdirSync(GO).sort().join() === 'bad,graph.json', "Graphify's files unchanged");
  ok(!fs.readdirSync(V, { recursive: true }).some(f => /graph\.json|cache\.json/.test(f)) && !fs.existsSync(path.join(PA, 'graphs')), 'nothing written into the vault or the project');
  // another user: their vault and data refused
  const BOB = mk(T, 'Users', 'bob', 'Vault'); mk(BOB, '.obsidian'); e = ''; try { G.build({ ...pa, id: 'pbob', vault: BOB }, { items }) } catch (x) { e = x.message } ok(/another Windows user/.test(e), "another user's vault refused");
  ok(fs.readdirSync(path.join(D, 'graphs'), { recursive: true }).every(f => sp.within(H, path.join(D, 'graphs', f))), "graph data inside alice's profile");
} catch (e) { fail.push('crash: ' + e.stack.split('\n').slice(0, 3).join(' | ')) }
finally { for (const k of Object.keys(process.env)) if (!(k in SAVE)) delete process.env[k]; Object.assign(process.env, SAVE); try { fs.rmSync(T, { recursive: true, force: true }) } catch { } }
console.log(JSON.stringify({ pass, fail }, null, 1)); process.exit(fail.length ? 1 : 0);
