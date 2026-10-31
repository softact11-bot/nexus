// NEXUS M3 built-in knowledge graph (spec §26.7). Gate (b): engine only; knowledge.js still has its own copy of these rules and
// moves onto this module at gate (d) (ponytail: two copies until then, kept equal by test-graph.js's parity check).
// Same rules as graphify_vault.py's vault part: notes, folders, tags, wiki links, CLAUDE.md sections, skills + mentions. No LLM,
// deterministic (sorted, no timestamps inside). Per user and project: <NEXUS data>/graphs/<projectId>/graph.json + cache.json.
// Privacy: folders that other projects linked in the same vault are left out, so one project's graph never shows another's notes.
// Graphify stays optional: source() reads Graphify's graph.json when the project uses it and it is readable, else falls back here.
// Never writes into graphify-out, the vault or the project (safepath.guard with the data folder as the only root).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), sp = require('./safepath'), CF = require('./config');
const SKIP = new Set(['.obsidian', '.claude', '.copilot', 'copilot']), GRAPH_NOTE = 'Knowledge Graph', LINK = /\[\[([^\]|#]+)/g;
const SYNCED = { 'PROJECT_DOCS.md': 'Project Docs', 'INDEX.md': 'File Index', 'ASSET_REGISTRY.md': 'Asset Registry', 'redesign/SESSION_CONTEXT.md': 'Redesign Context',
  'cursors/SESSION_CONTEXT.md': 'Cursors Context', 'SESSION_CONTEXT.md': 'Merchant Context', 'PROJECT_MEMORY.md': 'Project Memory' };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
const ls = d => { try { return fs.readdirSync(d, { withFileTypes: true }) } catch { return [] } };
const fmOf = t => (/^---\n([\s\S]*?)\n---/.exec(t) || [, ''])[1];
const listval = (fm, k) => { const m = new RegExp(`^${k}:\\s*\\[(.*?)\\]`, 'm').exec(fm); return m ? m[1].split(',').map(x => x.trim().replace(/^['"]+|['"]+$/g, '')).filter(Boolean) : [] };
const pyOrder = (a, b) => { const x = a.f.toLowerCase(), y = b.f.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0 };

// folders of other projects linked inside this project's vault (left out of its graph)
function excludes(p, items) {
  const V = sp.real(p.vault); return items.filter(o => o.id !== p.id && o.vault && sp.within(V, sp.real(o.vault)) || o.id !== p.id && o.vault && sp.within(sp.real(o.vault), V))
    .map(o => sp.real(o.vaultFolder ? path.join(o.vault, o.vaultFolder) : o.vault)).filter(t => !sp.within(t, sp.real(p.vaultFolder ? path.join(p.vault, p.vaultFolder) : p.vault)));
}

// opts: { name, folder, skills: [[dir, group]], pcache, exclude: [abs], cache: Map }
function extract(vault, pdir, opts = {}) {
  const ex = (opts.exclude || []).map(x => x.toLowerCase()), cache = opts.cache || new Map(), N = new Map(), E = new Map(), notes = new Map(), meta = new Map(), stat = { parsed: 0, cached: 0 };
  const files = [], rel = f => path.relative(vault, f).split(path.sep).join('/');
  const go = d => { for (const e of ls(d)) { const p = path.join(d, e.name); if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (!e.name.startsWith('.') && !ex.some(x => sp.within(x, p))) go(p); continue }
    if (!/\.md$/i.test(e.name)) continue; let s; try { s = fs.statSync(p) } catch { continue } files.push({ f: p, r: rel(p), size: s.size, mtime: s.mtimeMs }) } };
  go(vault);
  const sname = f => { let t = ''; try { t = fs.readFileSync(f, 'utf8').replace(/\r\n?/g, '\n') } catch { } const m = /^name:\s*(.+)$/m.exec(t); return (m ? m[1] : path.basename(path.dirname(f))).trim().replace(/^['"]+|['"]+$/g, '') };
  const SK = []; for (const [d, grp] of opts.skills || []) for (const e of ls(d)) { const f = path.join(d, e.name, 'SKILL.md'); if (fs.existsSync(f)) SK.push({ f, plugin: grp, name: sname(f) }) }
  const rg = d => { for (const e of ls(d)) { const p = path.join(d, e.name); if (e.isDirectory()) rg(p); else if (e.name === 'SKILL.md') SK.push({ f: p, plugin: path.relative(opts.pcache, p).split(path.sep)[1], name: sname(p) }) } };
  if (opts.pcache) rg(opts.pcache);
  const sre = [...new Set(SK.map(s => s.name).filter(n => n.length >= 6))].sort().map(n => [n, new RegExp(`(?<![\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i')]);
  const skv = crypto.createHash('sha1').update(sre.map(x => x[0]).join('\n')).digest('hex').slice(0, 12);
  // cache = metadata only, never note text: tags, aliases, link targets, skill names mentioned; re-read when size, mtime or the skill list change
  const note = x => { const c = cache.get(x.r); if (c && c.mtime === x.mtime && c.size === x.size && c.sk === skv) { stat.cached++; return c }
    let text = ''; try { text = fs.readFileSync(x.f, 'utf8').replace(/\r\n?/g, '\n') } catch { }
    const fm = fmOf(text), o = { r: x.r, size: x.size, mtime: x.mtime, sk: skv, tags: listval(fm, 'tags'), aliases: listval(fm, 'aliases'), links: [...text.matchAll(LINK)].map(m => m[1]), mentions: sre.filter(([, re]) => re.test(text)).map(([n]) => n) };
    cache.set(x.r, o); stat.parsed++; return o };
  const node = (kind, name, group, src, ft = 'document') => { const id = kind + '_' + slug(name); if (!N.has(id)) N.set(id, { id, label: name, file_type: ft, source_file: src, group }); return id };
  const edge = (a, b, r, conf = 'EXTRACTED', w = 1, src = '') => { if (a === b) return; E.set(a < b ? a + '|' + b : b + '|' + a, { source: a, target: b, relation: r, confidence: conf, weight: w, source_file: src }) };
  notes.set(GRAPH_NOTE.toLowerCase(), node('note', GRAPH_NOTE, 'Vault root', GRAPH_NOTE + '.md'));
  const root = path.basename(vault), md = files.filter(x => !x.r.split('/').some(p => SKIP.has(p))).sort(pyOrder);
  for (const x of md) {
    const parts = x.r.split('/'), stem = parts.at(-1).replace(/\.md$/i, ''); if (stem === GRAPH_NOTE) continue;
    const group = parts.length > 1 ? parts[0] : 'Vault root', nid = node('note', stem, group, x.r), n = note(x);
    meta.set(nid, n); notes.set(stem.toLowerCase(), nid);
    for (const a of n.aliases) if (!notes.has(a.toLowerCase())) notes.set(a.toLowerCase(), nid);
    let prev;
    for (let i = 0; i < parts.length - 1; i++) {
      const fid = node('folder', parts.slice(0, i + 1).join('/'), group, parts.slice(0, i + 1).join('\\'), 'concept'); N.get(fid).label = parts[i];
      edge(i === 0 ? node('folder', root, 'Vault root', '', 'concept') : prev, fid, 'contains'); prev = fid;
    }
    edge(parts.length > 1 ? prev : node('folder', root, 'Vault root', '', 'concept'), nid, 'contains');
  }
  for (const k of [...cache.keys()]) if (!files.some(x => x.r === k)) cache.delete(k); // deleted notes leave the cache
  const use = new Map(); for (const n of meta.values()) for (const t of n.tags) use.set(t, (use.get(t) || 0) + 1);
  let unresolved = 0;
  for (const [nid, n] of meta) {
    const src = N.get(nid).source_file;
    for (const t of n.tags) if (use.get(t) <= 40) edge(nid, node('tag', '#' + t, 'Tags', '', 'concept'), 'tagged', 'EXTRACTED', 1, src);
    for (const l of n.links) { const tid = notes.get(l.trim().split(/[\\/]/).pop().toLowerCase()); if (tid) edge(nid, tid, 'references', 'EXTRACTED', 1, src); else unresolved++ }
  }
  const FOLDER = opts.folder || '', proj = node('project', opts.name || path.basename(pdir), FOLDER, '', 'concept');
  if (FOLDER) edge(proj, node('folder', FOLDER, FOLDER, FOLDER, 'concept'), 'documented_in');
  for (const fname of ['CLAUDE.md', 'PROJECT_MEMORY.md']) {
    let text; try { text = fs.readFileSync(path.join(pdir, fname), 'utf8').replace(/\r\n?/g, '\n') } catch { continue }
    const fid = node('project_file', fname, 'Workflows', fname); edge(proj, fid, 'documented_in');
    for (const [f, nt] of Object.entries(SYNCED)) if (text.includes(f) && notes.has(nt.toLowerCase())) edge(fid, notes.get(nt.toLowerCase()), 'references', 'EXTRACTED', 1, fname);
    for (const m of text.matchAll(LINK)) { const t = m[1].trim().toLowerCase(); if (notes.has(t)) edge(fid, notes.get(t), 'references', 'EXTRACTED', 1, fname) }
    if (fname === 'CLAUDE.md') for (const m of text.matchAll(/^## (.+)$/gm)) edge(fid, node('workflow', m[1].replace(/\s*\(.*\)/g, ''), 'Workflows', fname, 'rationale'), 'defines', 'EXTRACTED', 1, fname);
  }
  for (const s of SK) {
    const sid = node('skill', `${s.plugin}:${s.name}`, 'Skills', path.basename(path.dirname(s.f)), 'code'); N.get(sid).label = s.name;
    edge(node('plugin', s.plugin, 'Skills', '', 'concept'), sid, 'provides');
    if (s.name.length >= 6) for (const [nid, n] of meta) if (n.mentions.includes(s.name)) edge(nid, sid, 'mentions', 'INFERRED', .6, N.get(nid).source_file);
  }
  return { N, E, stat, notes: meta.size, unresolved };
}

// graph.json in the shape knowledge.js reads (graphify's node-link JSON); communities = groups, in sorted order
function toJson(x) {
  const nodes = [...x.N.values()].sort((a, b) => a.id < b.id ? -1 : 1), groups = [...new Set(nodes.map(n => n.group))].sort();
  return { directed: false, multigraph: false, graph: { builder: 'nexus-builtin', version: 1 },
    nodes: nodes.map(n => ({ ...n, community: groups.indexOf(n.group), community_name: n.group })),
    links: [...x.E.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([, e]) => e) };
}

function claudeDirs() { const C = process.env.CLAUDE_CONFIG_DIR || path.join(sp.home(), '.claude'); return { skills: path.join(C, 'skills'), pcache: path.join(C, 'plugins', 'cache') } }
// build + save one project's built-in graph. opts.out: another folder inside the data folder (tests / parity report)
function build(p, opts = {}) {
  if (!p?.vault || !/^[\w-]{1,64}$/.test(p.id || '')) throw new Error('This project has no linked vault.');
  const v = sp.check(p.vault); if (!v.ok) throw new Error('Vault refused: ' + v.why);
  const d = sp.check(p.dir); if (!d.ok) throw new Error('Project folder refused: ' + d.why);
  const data = opts.data || CF.dataDir(), dir = opts.out || path.join(data, 'graphs', p.id), roots = [opts.root || data], C = claudeDirs();
  const cf = path.join(dir, 'cache.json'), cj = readJ(cf, {}), cache = new Map(cj.version === 2 ? Object.entries(cj.notes || {}) : []); // v1 caches held note text: dropped and rebuilt
  const x = extract(v.path, d.path, { name: p.name, folder: p.vaultFolder, exclude: excludes(p, opts.items || readJ(path.join(data, 'projects.json'), { items: [] }).items), cache,
    skills: [[C.skills, 'user skills'], [path.join(v.path, 'copilot', 'skills'), 'obsidian copilot']], pcache: C.pcache });
  const g = toJson(x), out = path.join(dir, 'graph.json');
  for (const [f, o] of [[out, g], [cf, { version: 2, notes: Object.fromEntries(cache) }]]) {
    const r = sp.guard(f, roots); if (sp.protectedWhy(r)) throw new Error('Refused'); fs.mkdirSync(path.dirname(r), { recursive: true });
    const tmp = r + '.tmp-' + process.pid; fs.writeFileSync(tmp, JSON.stringify(o)); fs.renameSync(tmp, r);
  }
  return { file: out, nodes: g.nodes.length, links: g.links.length, notes: x.notes, unresolved: x.unresolved, ...x.stat, sha: crypto.createHash('sha256').update(JSON.stringify(g)).digest('hex') };
}

// which graph a project shows: Graphify's (when chosen and readable) or the built-in one, with a plain notice on fallback
function source(p) {
  if (p?.graph?.mode === 'graphify') {
    const f = path.join(p.graph.out || path.join(p.dir, 'graphify-out'), 'graph.json'), g = readJ(f, null);
    if (g && Array.isArray(g.nodes)) return { source: 'graphify', file: f };
    return { source: 'builtin', fallback: true, notice: 'Graphify data was not found or could not be read (' + f + '), so NEXUS shows its built-in graph. Graphify\'s files are not changed.' };
  }
  return { source: 'builtin' };
}

module.exports = { extract, toJson, build, source, excludes };
