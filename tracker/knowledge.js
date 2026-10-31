// Obsidian & Graphify page (NEXUS Phase D). Reads the vault and my-game/graphify-out/graph.json; never writes graph.json.
// Graph: the vault part of graphify_vault.py is re-done here (same ids, same rules: notes, folders, tags, [[links]], CLAUDE.md
// sections, skills + mentions), so live edits show at once. graph.json adds Graphify's communities; a node it doesn't have yet is
// marked "live". Changes reach the page as patches over Server-Sent Events (/api/graph/live). Watchers run only while a page listens.
// Writes: new notes, folders, daily notes, templates, saving notes that are NOT synced from the my-game project (diff confirmed in the
// page, file must be unchanged since it was opened, old version copied to NEXUS_DATA/vault-backups first). Never deletes, moves or renames.
const RED = require('./redact.js'); // M4c: home → ~ and secrets masked in logs, exports and error text (spec §26.8)
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), crypto = require('crypto');
const H = os.homedir(), C = process.env.CLAUDE_CONFIG_DIR || path.join(H, '.claude');
// M2: paths follow the active project (nexus-config.json); env overrides win; no config = the original defaults, so nothing changes.
let VAULT, PROJ, GOUT, GJ, PNAME, FOLDER, CMD, FKEY = null;
function follow() {
  let a = null; try { a = require('./config').active() } catch { }
  // M7a portability: no personal default; nothing linked = a folder that never exists (same as a PC without the old paths)
  const v = process.env.NEXUS_VAULT || a?.vault || path.join(DATA, 'no-vault-linked'), p = process.env.NEXUS_PROJ || a?.dir || path.join(DATA, 'no-project-linked');
  const go = a?.graph?.out || path.join(p, 'graphify-out'), key = [v, p, go, a?.name, a?.vaultFolder, a?.sync?.cmd].join('|');
  if (key === FKEY) return; const first = FKEY === null; FKEY = key;
  VAULT = v; PROJ = p; GOUT = go; GJ = path.join(GOUT, 'graph.json'); PNAME = a?.name || 'Demo Game'; FOLDER = a?.vaultFolder || 'Demo Game'; CMD = a?.sync?.cmd || 'bash sync_docs.sh';
  if (!first) { cur = null; gj = null; skillList = null; warn = null; if (watchers.length) { stopWatch(); if (subs.size) startWatch() } } // switched project: re-read everything
}
const DATA = process.env.NEXUS_DATA || __dirname, BK = path.join(DATA, 'vault-backups'), PJ = path.join(DATA, 'projects.json');
const SKILLS = process.env.NEXUS_SKILLS || path.join(C, 'skills'), PCACHE = process.env.NEXUS_PCACHE || path.join(C, 'plugins', 'cache'), PINST = path.join(C, 'plugins');
const BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const SKIP = new Set(['.obsidian', '.claude', '.copilot', 'copilot']), GRAPH_NOTE = 'Knowledge Graph', DAY = 864e5;
const SYNCED = { 'PROJECT_DOCS.md': 'Project Docs', 'INDEX.md': 'File Index', 'ASSET_REGISTRY.md': 'Asset Registry', 'redesign/SESSION_CONTEXT.md': 'Redesign Context',
  'cursors/SESSION_CONTEXT.md': 'Cursors Context', 'SESSION_CONTEXT.md': 'Merchant Context', 'PROJECT_MEMORY.md': 'Project Memory' }; // same table as graphify_vault.py
const LINK = /\[\[([^\]|#]+)/g, IMG = /\.(png|jpe?g|webp|gif|svg|bmp)$/i;
const TEMPLATES = {
  Note: '---\ntags: []\ncreated: {{date}}\n---\n\n# {{title}}\n\n',
  Asset: '---\ntags: [asset]\ncreated: {{date}}\nstatus: Prototype\n---\n\n# {{title}}\n\n## Source\n\n## Settings\n\n## Steps\n\n## Problems and fixes\n\n## Verify\n',
  Meeting: '---\ntags: [meeting]\ncreated: {{date}} {{time}}\n---\n\n# {{title}}\n\n## Attendees\n\n## Notes\n\n## Decisions\n\n## Actions\n- [ ] \n',
};

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
const ls = d => { try { return fs.readdirSync(d, { withFileTypes: true }) } catch { return [] } };
const isDir = d => { try { return fs.statSync(d).isDirectory() } catch { return false } };
const rel = f => path.relative(VAULT, f).split(path.sep).join('/');
const today = (t = Date.now()) => new Date(t).toLocaleDateString('sv');
const sha = t => crypto.createHash('sha1').update(t).digest('hex');
const fmOf = t => (/^---\n([\s\S]*?)\n---/.exec(t) || [, ''])[1];
const listval = (fm, k) => { const m = new RegExp(`^${k}:\\s*\\[(.*?)\\]`, 'm').exec(fm); return m ? m[1].split(',').map(x => x.trim().replace(/^['"]+|['"]+$/g, '')).filter(Boolean) : [] };

// ---------- vault files (text cached by mtime + size: only changed notes are re-read) ----------
const tcache = new Map();
function vaultFiles() { // every file except dot folders; md notes follow graphify's SKIP rule separately
  const out = [];
  const go = d => { for (const e of ls(d)) { const p = path.join(d, e.name); if (e.isSymbolicLink()) continue; if (e.isDirectory()) { if (!e.name.startsWith('.')) go(p); continue }
    let s; try { s = fs.statSync(p) } catch { continue } out.push({ f: p, r: rel(p), size: s.size, mtime: s.mtimeMs, birth: s.birthtimeMs || s.ctimeMs }) } };
  go(VAULT); return out;
}
function note(x) {
  const c = tcache.get(x.f); if (c && c.mtime === x.mtime && c.size === x.size) return c;
  let text = ''; try { text = fs.readFileSync(x.f, 'utf8').replace(/\r\n?/g, '\n') } catch { }
  const fm = fmOf(text), o = { ...x, text, tags: listval(fm, 'tags'), aliases: listval(fm, 'aliases') }; tcache.set(x.f, o); return o;
}
const isNote = x => /\.md$/i.test(x.r) && !x.r.split('/').some(p => SKIP.has(p));
// Python sorts WindowsPath objects by their lower-cased path string; same order here so name clashes resolve the same way.
const pyOrder = (a, b) => { const x = a.f.toLowerCase(), y = b.f.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0 };

// ---------- skills (re-scanned only when the skills folders or installed_plugins.json change) ----------
let skillList = null;
function skills() {
  if (skillList) return skillList;
  const L = [], name = f => { let t = ''; try { t = fs.readFileSync(f, 'utf8') } catch { } const m = /^name:\s*(.+)$/m.exec(t.replace(/\r\n?/g, '\n')); return (m ? m[1] : path.basename(path.dirname(f))).trim().replace(/^['"]+|['"]+$/g, '') };
  for (const [d, grp] of [[SKILLS, 'user skills'], [path.join(VAULT, 'copilot', 'skills'), 'obsidian copilot']])
    for (const e of ls(d)) { const f = path.join(d, e.name, 'SKILL.md'); if (fs.existsSync(f)) L.push({ f, plugin: grp, name: name(f) }) }
  const rg = d => { for (const e of ls(d)) { const p = path.join(d, e.name); if (e.isDirectory()) rg(p); else if (e.name === 'SKILL.md') L.push({ f: p, plugin: path.relative(PCACHE, p).split(path.sep)[1], name: name(p) }) } };
  rg(PCACHE); return skillList = L;
}

// ---------- extraction: the same graph graphify_vault.py builds (minus clustering) ----------
function extract() {
  const files = vaultFiles(), N = new Map(), E = new Map(), notes = new Map(), texts = new Map(), meta = new Map();
  const node = (kind, name, group, src, ft = 'document') => { const id = kind + '_' + slug(name); if (!N.has(id)) N.set(id, { id, label: name, file_type: ft, source_file: src, group }); return id };
  const edge = (a, b, r, conf = 'EXTRACTED', w = 1, src = '') => { if (a === b) return; E.set(a < b ? a + '|' + b : b + '|' + a, { source: a, target: b, relation: r, confidence: conf, weight: w, source_file: src }) };
  notes.set(GRAPH_NOTE.toLowerCase(), node('note', GRAPH_NOTE, 'Vault root', GRAPH_NOTE + '.md'));
  const root = path.basename(VAULT), md = files.filter(isNote).sort(pyOrder); let kgx = null;
  for (const x of md) {
    const parts = x.r.split('/'), stem = parts.at(-1).replace(/\.md$/i, ''); if (stem === GRAPH_NOTE) { kgx = x; continue }
    const group = parts.length > 1 ? parts[0] : 'Vault root', nid = node('note', stem, group, x.r), n = note(x);
    texts.set(nid, n.text); meta.set(nid, n); notes.set(stem.toLowerCase(), nid);
    for (const a of n.aliases) if (!notes.has(a.toLowerCase())) notes.set(a.toLowerCase(), nid);
    let prev;
    for (let i = 0; i < parts.length - 1; i++) {
      const fid = node('folder', parts.slice(0, i + 1).join('/'), group, parts.slice(0, i + 1).join('\\'), 'concept'); N.get(fid).label = parts[i];
      edge(i === 0 ? node('folder', root, 'Vault root', '', 'concept') : prev, fid, 'contains'); prev = fid;
    }
    edge(parts.length > 1 ? prev : node('folder', root, 'Vault root', '', 'concept'), nid, 'contains');
  }
  const use = new Map(); for (const n of meta.values()) for (const t of n.tags) use.set(t, (use.get(t) || 0) + 1);
  let resolved = 0; const unresolved = new Map();
  for (const [nid, text] of texts) {
    const src = N.get(nid).source_file;
    for (const t of meta.get(nid).tags) if (use.get(t) <= 40) edge(nid, node('tag', '#' + t, 'Tags', '', 'concept'), 'tagged', 'EXTRACTED', 1, src); // very common tags would tie everything together
    for (const m of text.matchAll(LINK)) { const tg = m[1].trim(), tid = notes.get(tg.split(/[\\/]/).pop().toLowerCase());
      if (tid) { edge(nid, tid, 'references', 'EXTRACTED', 1, src); resolved++ } else unresolved.set(tg, (unresolved.get(tg) || 0) + 1) }
  }
  const kg = [0, 0]; if (kgx) for (const m of note(kgx).text.matchAll(LINK)) kg[notes.has(m[1].trim().split(/[\\/]/).pop().toLowerCase()) ? 0 : 1]++; // [resolved, unresolved] in the Knowledge Graph note (Settings → Obsidian can count it in Graph Health)
  const proj = node('project', PNAME, FOLDER, '', 'concept');
  edge(proj, node('folder', FOLDER, FOLDER, FOLDER, 'concept'), 'documented_in');
  for (const fname of ['CLAUDE.md', 'PROJECT_MEMORY.md']) {
    let text; try { text = fs.readFileSync(path.join(PROJ, fname), 'utf8').replace(/\r\n?/g, '\n') } catch { continue }
    const fid = node('project_file', fname, 'Workflows', fname); edge(proj, fid, 'documented_in');
    for (const [f, nt] of Object.entries(SYNCED)) if (text.includes(f) && notes.has(nt.toLowerCase())) edge(fid, notes.get(nt.toLowerCase()), 'references', 'EXTRACTED', 1, fname);
    for (const m of text.matchAll(LINK)) { const t = m[1].trim().toLowerCase(); if (notes.has(t)) edge(fid, notes.get(t), 'references', 'EXTRACTED', 1, fname) }
    if (fname === 'CLAUDE.md') for (const m of text.matchAll(/^## (.+)$/gm)) edge(fid, node('workflow', m[1].replace(/\s*\(.*\)/g, ''), 'Workflows', fname, 'rationale'), 'defines', 'EXTRACTED', 1, fname);
  }
  for (const s of skills()) {
    const sid = node('skill', `${s.plugin}:${s.name}`, 'Skills', path.basename(path.dirname(s.f)), 'code'); N.get(sid).label = s.name;
    edge(node('plugin', s.plugin, 'Skills', '', 'concept'), sid, 'provides');
    if (s.name.length >= 6) { const re = new RegExp(`(?<![\\w-])${s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i');
      for (const [nid, text] of texts) if (re.test(text)) edge(nid, sid, 'mentions', 'INFERRED', .6, N.get(nid).source_file) }
  }
  return { N, E, files, md, meta, notes, resolved, unresolved, kg };
}

// ---------- merge with graph.json (communities) + NEXUS projects; clusters by fixed rules ----------
let gj = null;
function graphJson() {
  let s; try { s = fs.statSync(GJ) } catch { return gj = { mtime: 0, nodes: new Map(), keys: new Set(), commit: null, ok: false } }
  if (gj && gj.mtime === s.mtimeMs && gj.size === s.size) return gj;
  const g = readJ(GJ, null); if (!g || !Array.isArray(g.nodes)) throw new Error('graph.json could not be read (it may be mid-write); keeping the last good data');
  return gj = { mtime: s.mtimeMs, size: s.size, commit: g.built_at_commit || null, ok: true, nodes: new Map(g.nodes.map(n => [n.id, n])),
    keys: new Set((g.links || g.edges || []).map(l => l.source < l.target ? l.source + '|' + l.target : l.target + '|' + l.source)) };
}
const BLENDER = /blender/i;
function clusterOf(n, tags) {
  if (n.g === 'NEXUS Projects') return n.ptype === 'roblox' ? 'roblox' : n.ptype === 'blender' ? 'blender' : 'claude';
  if (BLENDER.test(n.l) || (tags || []).some(t => BLENDER.test(t))) return 'blender';
  if (n.g === 'Skills') return 'plugins';
  if (n.g === 'Tags') return 'refs';
  if (n.g === FOLDER || n.g === 'Knowledge Base') return 'roblox';
  if (n.g === 'Workflows' || n.g === 'Token Optimization') return 'claude';
  return 'obsidian';
}
function build() {
  const x = extract(), G = graphJson(), nodes = new Map(), links = new Map();
  for (const n of x.N.values()) {
    const g = G.nodes.get(n.id), m = x.meta.get(n.id);
    const o = { id: n.id, l: n.label, g: n.group, t: n.file_type, s: n.source_file, c: g ? g.community ?? null : null, cn: g ? g.community_name || null : null, o: g ? 'graphify' : 'live' };
    if (m) Object.assign(o, { p: m.r, tags: m.tags.slice(0, 12), mt: m.mtime });
    o.k = clusterOf(o, m?.tags); nodes.set(o.id, o);
  }
  for (const [k, e] of x.E) links.set(k, { k, a: e.source, b: e.target, r: e.relation, w: e.weight, o: G.keys.has(k) ? 'graphify' : 'live' });
  for (const p of readJ(PJ, {}).items || []) { const o = { id: 'nexusproj_' + p.id, l: p.name, g: 'NEXUS Projects', t: 'project', s: p.dir, c: null, cn: null, o: 'nexus', ptype: p.type }; o.k = clusterOf(o); nodes.set(o.id, o) }
  // what graph.json still has that the vault no longer does (or the reverse): shown as "changes since the last Graphify build"
  let gone = 0; for (const id of G.nodes.keys()) if (!nodes.has(id)) gone++;
  const fresh = [...nodes.values()].filter(n => n.o === 'live').length, deadLinks = [...G.keys].filter(k => !links.has(k)).length, newLinks = [...links.values()].filter(l => l.o === 'live').length;
  return { nodes, links, x, G, drift: { newNodes: fresh, goneNodes: gone, newLinks, deadLinks } };
}

// ---------- stats ----------
function stats(B) {
  const { x, G, nodes, links } = B, now = Date.now(), notesL = x.md, att = x.files.filter(f => !/\.md$/i.test(f.r) && !f.r.split('/').some(p => SKIP.has(p)));
  const tagc = new Map(); for (const n of x.meta.values()) for (const t of n.tags) tagc.set(t, (tagc.get(t) || 0) + 1);
  const deg = new Map(); for (const l of links.values()) if (l.r === 'references' || l.r === 'mentions') for (const id of [l.a, l.b]) deg.set(id, (deg.get(id) || 0) + 1);
  const orph = [...nodes.values()].filter(n => n.id.startsWith('note_') && n.p && !deg.get(n.id));
  const unres = [...x.unresolved.values()].reduce((a, b) => a + b, 0), comm = new Set([...nodes.values()].map(n => n.c).filter(c => c != null));
  const projNewer = Object.keys(SYNCED).concat(ls(path.join(PROJ, 'docs')).filter(e => /\.md$/i.test(e.name)).map(e => 'docs/' + e.name))
    .filter(f => { try { return fs.statSync(path.join(PROJ, f)).mtimeMs > G.mtime } catch { return false } });
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  return {
    at: now, vault: VAULT, vaultName: path.basename(VAULT), vaultOk: isDir(path.join(VAULT, '.obsidian')),
    notes: notesL.length, tags: tagc.size, attachments: att.length, modifiedToday: notesL.filter(n => n.mtime >= t0.getTime()).length, bytes: x.files.reduce((a, f) => a + f.size, 0),
    topTags: [...tagc].sort((a, b) => b[1] - a[1]).slice(0, 12),
    recent: [...notesL].sort((a, b) => b.mtime - a.mtime).slice(0, 12).map(n => ({ p: n.r, mtime: n.mtime, tags: note(n).tags.slice(0, 3) })),
    att: [...att].sort((a, b) => b.mtime - a.mtime).slice(0, 8).map(a => ({ p: a.r, size: a.size, mtime: a.mtime, img: IMG.test(a.r) })),
    series: notesL.map(n => [n.birth, n.mtime]), attSeries: att.map(a => a.birth),
    graph: { ok: G.ok, path: GJ, built: G.mtime || null, commit: G.commit, nodes: nodes.size, links: links.size, communities: comm.size, orphans: orph.length,
      orphanList: orph.slice(0, 60).map(n => n.p), resolved: x.resolved, unresolved: unres, unresolvedList: [...x.unresolved].sort((a, b) => b[1] - a[1]).slice(0, 30),
      health: x.resolved + unres ? Math.round(x.resolved / (x.resolved + unres) * 1000) / 10 : null, kgLinks: x.kg, drift: B.drift, projNewer },
  };
}

// ---------- live state, watchers, SSE ----------
const subs = new Set(); let cur = null, ver = 0, warn = null, watchers = [], deb = null, retry = 0, retryT = null, syncRun = null, lastSync = null, beat = null;
const pack = n => n; // nodes go out as-is (small: ~300)
function snapshot() { return { v: ver, at: Date.now(), nodes: [...cur.nodes.values()].map(pack), links: [...cur.links.values()], stats: cur.stats, warn, sync: syncRun ? { running: true, lines: syncRun.lines.slice(-200) } : lastSync } }
function refresh() {
  const B = build(); B.stats = stats(B);
  if (!cur) { cur = B; ver++; return null }
  const add = [], upd = [], rem = [], ladd = [], lrem = [];
  for (const [id, n] of B.nodes) { const o = cur.nodes.get(id); if (!o) add.push(n); else if (JSON.stringify(o) !== JSON.stringify(n)) upd.push(n) }
  for (const id of cur.nodes.keys()) if (!B.nodes.has(id)) rem.push(id);
  for (const [k, l] of B.links) { const o = cur.links.get(k); if (!o || o.r !== l.r || o.o !== l.o) ladd.push(l) }
  for (const k of cur.links.keys()) if (!B.links.has(k)) lrem.push(k);
  cur = B;
  if (!add.length && !upd.length && !rem.length && !ladd.length && !lrem.length) return { v: ver, stats: B.stats, at: Date.now(), warn };
  return { v: ++ver, add, update: upd, remove: rem, linksAdd: ladd, linksRemove: lrem, stats: B.stats, at: Date.now(), warn };
}
function send(ev, o) { const s = `event: ${ev}\ndata: ${JSON.stringify(o)}\n\n`; for (const r of subs) try { r.write(s) } catch { } }
function tick() { // debounced: many file events → one rebuild → one patch
  clearTimeout(deb); deb = setTimeout(() => {
    try { const p = refresh(); retry = 0; if (warn) { warn = null; p && (p.warn = null) } if (p) send('patch', p) }
    catch (e) { warn = 'Update failed: ' + RED(e.message) + '. Showing the last good data; retrying.'; send('warn', { warn, at: Date.now() }); clearTimeout(retryT); retryT = setTimeout(tick, 1000 * Math.min(30, 2 ** retry++)) }
  }, 500);
}
function startWatch() {
  if (watchers.length) return;
  const W = (dir, o, pick) => { try { const w = fs.watch(dir, o, (e, f) => { if (pick(String(f || ''))) tick() });
    w.on('error', e => { warn = `Watcher stopped (${path.basename(dir)}): ${RED(e.message)}. Retrying.`; send('warn', { warn, at: Date.now() }); stopWatch(); setTimeout(() => subs.size && (startWatch(), tick()), 1000 * Math.min(30, 2 ** retry++)) }); watchers.push(w) }
    catch (e) { warn = `Can't watch ${dir}: ${RED(e.message)}`; } };
  W(VAULT, { recursive: true }, f => !/^\.(obsidian|trash)[\\/]?/.test(f) && !/^\.(obsidian|trash)$/.test(f));
  W(GOUT, {}, f => f === 'graph.json');
  W(PROJ, {}, f => ['CLAUDE.md', 'PROJECT_MEMORY.md', 'PROJECT_DOCS.md'].includes(f));
  W(path.join(PROJ, 'docs'), {}, f => /\.md$/i.test(f));
  const sk = f => { skillList = null; return true };
  if (isDir(SKILLS)) W(SKILLS, { recursive: true }, f => /SKILL\.md$/i.test(f) || !f.includes('.') ? sk() : false);
  W(PINST, {}, f => f === 'installed_plugins.json' && sk());
  W(DATA, {}, f => f === 'projects.json');
  beat = setInterval(() => { for (const r of subs) try { r.write(': ping\n\n') } catch { } }, 25000); // keeps the connection open; the page never polls
}
function stopWatch() { for (const w of watchers) try { w.close() } catch { } watchers = []; clearInterval(beat); beat = null }
function live(q, r, v) { // GET /api/graph/live?v=N
  r.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  r.write('retry: 3000\n\n');
  try { if (!cur) refresh() } catch (e) { warn = RED(e.message) }
  subs.add(r); startWatch();
  if (cur && String(v) !== String(ver)) r.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
  q.on('close', () => { subs.delete(r); if (!subs.size) stopWatch() });
}
function graph() { if (!cur || !subs.size) { try { refresh() } catch (e) { warn = RED(e.message); if (!cur) throw e } } return snapshot() } // no listener → watchers are off, so re-read now

// ---------- notes: read, search ----------
function readOnly() { // the notes sync_docs.sh copies from the project: edit them in the project (or Obsidian) only
  let sh = ''; try { sh = fs.readFileSync(path.join(PROJ, 'sync_docs.sh'), 'utf8') } catch { }
  const vd = (/^V="[^"]*\/([^"/]+)"$/m.exec(sh) || [, FOLDER])[1], S = new Map();
  for (const m of sh.matchAll(/^sync1\s+"\$P\/([^"]+)"\s+"([^"]+)"/gm)) S.set(`${vd}/${m[2]}.md`, m[1]);
  if (sh.includes('"$P"/docs/*.md')) for (const e of ls(path.join(PROJ, 'docs'))) if (/\.md$/i.test(e.name)) S.set(`${vd}/${e.name}`, 'docs/' + e.name);
  S.set(GRAPH_NOTE + '.md', 'graphify_vault.py (generated, overwritten on every sync)');
  return S;
}
function safe(p, { mustExist = true, md = true } = {}) {
  if (typeof p !== 'string' || !p || p.length > 400 || /[\x00-\x1f]/.test(p)) return null;
  const abs = path.resolve(VAULT, p); if (!abs.startsWith(VAULT + path.sep)) return null;
  if (path.relative(VAULT, abs).split(path.sep).some(x => x.startsWith('.'))) return null;
  if (md && !/\.md$/i.test(abs)) return null;
  if (mustExist) { try { const s = fs.lstatSync(abs); if (s.isSymbolicLink() || !s.isFile()) return null } catch { return null } }
  return abs;
}
function noteDetail(p) {
  const abs = safe(p); if (!abs) return { res: 'Note not found in the vault.' };
  if (!cur) graph();
  const s = fs.statSync(abs), text = s.size > 2e6 ? null : fs.readFileSync(abs, 'utf8'), r = rel(abs), node = [...cur.nodes.values()].find(n => n.p === r);
  const ro = readOnly(), M = cur.x.notes, res = t => M.get(t.trim().split(/[\\/]/).pop().toLowerCase()) || null, item = (id, r) => { const o = cur.nodes.get(id); return { id, l: o?.l || id, p: o?.p || null, r } };
  const out = [...new Set([...(text || '').matchAll(LINK)].map(m => res(m[1])).filter(id => id && id !== node?.id))].map(id => item(id, 'references'));
  if (node) for (const l of cur.links.values()) if (l.r === 'mentions' && (l.a === node.id || l.b === node.id)) out.push(item(l.a === node.id ? l.b : l.a, 'mentions'));
  const back = node ? [...cur.x.meta].filter(([id, m]) => id !== node.id && [...m.text.matchAll(LINK)].some(x => res(x[1]) === node.id)).map(([id]) => item(id, 'references')) : [];
  return { res: 'ok', p: r, size: s.size, mtime: s.mtimeMs, birth: s.birthtimeMs, text, hash: text == null ? null : sha(text.replace(/\r\n?/g, '\n')), tooBig: text == null,
    readOnly: ro.has(r) ? ro.get(r) : null, id: node?.id || null, node, back, out, unresolved: text ? [...new Set([...text.matchAll(LINK)].map(m => m[1].trim()).filter(t => !res(t)))] : [] };
}
function search(q) {
  q = String(q || '').trim().toLowerCase(); if (!q || q.length > 100) return { res: 'ok', q, hits: [] };
  if (!cur) graph(); const hits = [];
  for (const n of cur.x.md.map(note)) { const t = n.text.toLowerCase(), title = n.r.toLowerCase(); let i = t.indexOf(q), c = 0; const inTitle = title.includes(q);
    if (i < 0 && !inTitle) continue; for (let j = i; j >= 0 && c < 999; j = t.indexOf(q, j + q.length)) c++;
    const at = Math.max(0, i - 60); hits.push({ p: n.r, title: inTitle, count: c, mtime: n.mtime, tags: n.tags.slice(0, 3), snip: i < 0 ? '' : (at ? '…' : '') + n.text.slice(at, i + q.length + 90).replace(/\s+/g, ' ') + '…' }) }
  return { res: 'ok', q, hits: hits.sort((a, b) => b.title - a.title || b.count - a.count).slice(0, 60) };
}
function tree() { // folders + files for the explorer (dot folders hidden, same as Obsidian)
  const go = (d, r) => ls(d).filter(e => !e.name.startsWith('.') && !e.isSymbolicLink()).map(e => { const p = r ? r + '/' + e.name : e.name;
    if (e.isDirectory()) { const k = go(path.join(d, e.name), p); return { n: e.name, p, d: k, c: k.reduce((a, x) => a + (x.d ? x.c : /\.md$/i.test(x.n) ? 1 : 0), 0) } }
    return { n: e.name, p } }).sort((a, b) => !!b.d - !!a.d || a.n.localeCompare(b.n, undefined, { numeric: true }));
  return go(VAULT, '');
}
let obs = { at: 0, v: null };
function obsidianRunning() {
  if (Date.now() - obs.at < 10000) return obs.v;
  try { obs.v = /obsidian\.exe/i.test(cp.execFileSync('tasklist', ['/FI', 'IMAGENAME eq Obsidian.exe', '/NH'], { encoding: 'utf8', timeout: 3000, windowsHide: true })) } catch { obs.v = null }
  obs.at = Date.now(); return obs.v;
}
function status() {
  const s = graph();
  return { res: 'ok', ...s.stats, obsidian: obsidianRunning(), tree: tree(), readOnly: [...readOnly().keys()], templates: ls(path.join(VAULT, 'Templates')).filter(e => /\.md$/i.test(e.name)).map(e => e.name.slice(0, -3)),
    daily: ls(path.join(VAULT, 'Daily Notes')).filter(e => /^\d{4}-\d\d-\d\d\.md$/.test(e.name)).map(e => e.name.slice(0, -3)).sort().reverse(), sync: s.sync, warn };
}

// ---------- writes ----------
const NAME = /^[^\\/:*?"<>|\x00-\x1f#^[\]]{1,120}$/;
const okName = n => typeof n === 'string' && NAME.test(n.trim()) && !/^[.\s]|[.\s]$/.test(n.trim());
function dirOf(d) { if (d === '' || d == null) return VAULT; const a = safe(d, { mustExist: false, md: false }); return a && isDir(a) ? a : null }
function writeNew(abs, text) { fs.writeFileSync(abs, text, { flag: 'wx' }); tick(); return { res: 'ok', p: rel(abs) } } // wx: never overwrites
const fill = (t, title) => { const d = new Date(); return t.replace(/{{title}}/g, title).replace(/{{date}}/g, today()).replace(/{{time}}/g, d.toTimeString().slice(0, 5)) };
function post(b) {
  if (b.op === 'create' || b.op === 'fromTemplate') {
    const dir = dirOf(b.dir); if (!dir) return { res: 'Pick an existing folder in the vault.' };
    if (!okName(b.name)) return { res: 'Use a name without / \\ : * ? " < > | # ^ [ ] (up to 120 characters).' };
    const name = b.name.trim().replace(/\.md$/i, ''), abs = path.join(dir, name + '.md'); if (fs.existsSync(abs)) return { res: 'A note with that name already exists in this folder.' };
    let text = typeof b.text === 'string' && b.text.length <= 5e5 ? b.text : `# ${name}\n\n`;
    if (b.op === 'fromTemplate') { const t = safe('Templates/' + b.template + '.md'); if (!t || typeof b.template !== 'string' || /[\\/]/.test(b.template)) return { res: 'Template not found.' }; text = fill(fs.readFileSync(t, 'utf8'), name) }
    return writeNew(abs, text);
  }
  if (b.op === 'mkdir') { const dir = dirOf(b.dir); if (!dir) return { res: 'Pick an existing folder in the vault.' }; if (!okName(b.name)) return { res: 'Use a folder name without / \\ : * ? " < > | # ^ [ ].' };
    const abs = path.join(dir, b.name.trim()); if (fs.existsSync(abs)) return { res: 'That folder already exists.' }; fs.mkdirSync(abs); tick(); return { res: 'ok', p: rel(abs) } }
  if (b.op === 'daily') {
    const dir = path.join(VAULT, 'Daily Notes'), d = today(), abs = path.join(dir, d + '.md');
    if (fs.existsSync(abs)) return { res: 'ok', p: rel(abs), existed: true };
    if (!isDir(dir)) { if (b.confirm !== true) return { res: 'confirm', ask: `Create the folder "Daily Notes" in your vault and today's note ${d}.md?` }; fs.mkdirSync(dir) }
    const t = safe('Templates/Daily.md'); return writeNew(abs, t ? fill(fs.readFileSync(t, 'utf8'), d) : `---\ntags: [daily]\ncreated: ${d}\n---\n\n# ${d}\n\n## Notes\n\n## Tasks\n- [ ] \n`);
  }
  if (b.op === 'templatesInit') {
    const dir = path.join(VAULT, 'Templates'), miss = Object.keys(TEMPLATES).filter(k => !fs.existsSync(path.join(dir, k + '.md')));
    if (!miss.length) return { res: 'ok', made: [] };
    if (b.confirm !== true) return { res: 'confirm', ask: `${isDir(dir) ? 'Add' : 'Create the folder "Templates" with'} the starter templates ${miss.join(', ')}? Obsidian's own settings are not changed.` };
    fs.mkdirSync(dir, { recursive: true }); for (const k of miss) fs.writeFileSync(path.join(dir, k + '.md'), TEMPLATES[k], { flag: 'wx' }); tick(); return { res: 'ok', made: miss };
  }
  if (b.op === 'save') {
    const abs = safe(b.p); if (!abs) return { res: 'Note not found in the vault.' };
    const r = rel(abs), ro = readOnly(); if (ro.has(r)) return { res: `Read-only here: this note is synced from the ${PNAME} project (${ro.get(r)}). Edit it there or in Obsidian.` };
    if (typeof b.text !== 'string' || b.text.length > 5e5) return { res: 'The note is too long to save from here.' };
    if (b.confirm !== true) return { res: 'Confirm the changes first.' };
    const old = fs.readFileSync(abs, 'utf8'); if (sha(old.replace(/\r\n?/g, '\n')) !== b.base) return { res: 'The note changed since you opened it (maybe in Obsidian). Reopen it to see the new version; nothing was saved.' };
    const crlf = /\r\n/.test(old), stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19), bk = path.join(BK, stamp, ...r.split('/'));
    fs.mkdirSync(path.dirname(bk), { recursive: true }); fs.copyFileSync(abs, bk);
    fs.writeFileSync(abs + '.nexus-tmp', crlf ? b.text.replace(/\r?\n/g, '\r\n') : b.text); fs.renameSync(abs + '.nexus-tmp', abs); tick();
    return { res: 'ok', p: r, backup: bk, hash: sha(b.text.replace(/\r\n?/g, '\n')) };
  }
  if (b.op === 'sync') return b.confirm === true ? sync() : { res: 'Confirm Sync All first.' };
  if (b.op === 'open') return open(b);
  return { res: 'Unknown action.' };
}
const run = (exe, args, o = {}) => { cp.spawn(exe, args, { detached: true, stdio: 'ignore', ...o }).on('error', () => { }).unref(); return { res: 'ok' } };
function open(b) {
  if (b.what === 'vault') return run('explorer.exe', ['obsidian://open?path=' + encodeURIComponent(VAULT)]);
  if (b.what === 'note') { const abs = safe(b.p); if (!abs) return { res: 'Note not found in the vault.' }; return run('explorer.exe', ['obsidian://open?path=' + encodeURIComponent(abs)]) }
  if (b.what === 'graph') { const f = path.join(GOUT, 'graph.html'); if (!fs.existsSync(f)) return { res: 'graph.html not found. Run Sync All once.' }; return run('explorer.exe', [f]) }
  if (b.what === 'folder') { const a = b.p ? safe(b.p, { md: false }) : VAULT; if (!a) return { res: 'Not found in the vault.' }; return a === VAULT ? run('explorer.exe', [VAULT]) : run('explorer.exe', [`/select,"${a}"`], { windowsVerbatimArguments: true }) }
  return { res: 'Unknown action.' };
}
// Sync All: bash sync_docs.sh in the my-game project. Output streams to the page; conflicts are only reported, never resolved here.
// B60: a cross-process lock for sync_docs.sh. It names the inner MSYS bash too: a killed tracker takes Git's bash.exe launcher with it, but
// the inner bash breaks away and finishes the sync (verified), so a restarted tracker must not start a second sync while the orphan still writes. ponytail: pid reuse could keep a dead lock "alive"; capped at LOCK_MS.
const LOCK = path.join(DATA, 'sync-locks', 'docs.lock'), LOCK_MS = 60 * 6e4;
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } };
function docLock() {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  for (let i = 0; i < 2; i++) {
    try { fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' }); return null } catch (e) { if (e.code !== 'EEXIST') return 'Could not take the doc sync lock: ' + RED(e.message) }
    let o = null; try { o = JSON.parse(fs.readFileSync(LOCK, 'utf8')) } catch { }
    const who = o && Date.now() - o.at < LOCK_MS && [o.inner, o.child, o.pid !== process.pid && o.pid].find(p => p && alive(p));
    if (who) return `A doc sync is still running (process ${who}). Wait for it to finish.`;
    fs.rmSync(LOCK, { force: true }); // left by a sync whose processes are gone
  }
  return 'Could not take the doc sync lock.';
}
function sync(o = {}) {
  if (syncRun) return { res: 'Sync All is already running.' };
  if (!fs.existsSync(BASH)) return { res: 'Git Bash not found at ' + BASH + '.' };
  const busy = docLock(); if (busy) return { res: busy };
  const watch = () => { const m = {}; for (const f of [...Object.keys(SYNCED).map(f => path.join(PROJ, f)), ...ls(path.join(PROJ, 'docs')).map(e => path.join(PROJ, 'docs', e.name)), ...ls(path.join(VAULT, 'Demo Game')).map(e => path.join(VAULT, 'Demo Game', e.name)), path.join(VAULT, GRAPH_NOTE + '.md'), GJ])
    try { m[f] = fs.statSync(f).mtimeMs } catch { } return m };
  const before = watch(), t0 = Date.now(); syncRun = { lines: [], at: t0 };
  const p = cp.spawn(BASH, ['-c', 'echo NEXUS_WINPID $(cat /proc/$$/winpid); bash sync_docs.sh'], { cwd: PROJ, windowsHide: true }); let buf = ''; // first line: the Windows pid of the bash that outlives us
  const hold = inner => { try { fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, child: p.pid, inner, at: t0 })) } catch { } }; hold();
  if (o.low) try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { } // scheduled runs only
  const line = l => { const m = /^NEXUS_WINPID (\d+)$/.exec(l.trim()); if (m) return hold(+m[1]); if (!l.trim()) return; l = RED(l); syncRun.lines.push(l); send('sync', { running: true, line: l, at: Date.now() }) };
  const on = d => { buf += d; const ls2 = buf.split(/\r?\n/); buf = ls2.pop(); ls2.forEach(line) };
  p.stdout.on('data', on); p.stderr.on('data', on);
  p.on('error', e => line('ERROR: ' + RED(e.message)));
  p.on('close', code => {
    if (buf) line(buf); const after = watch(), L = syncRun.lines;
    const written = Object.keys(after).filter(f => after[f] !== before[f]).map(f => path.relative(path.dirname(PROJ), f).split(path.sep).join('/'));
    const g = L.find(l => /^graph: /.test(l)), un = g ? +(/(\d+) unresolved links/.exec(g) || [])[1] : null;
    lastSync = { running: false, code, at: Date.now(), ms: Date.now() - t0, written, conflicts: L.filter(l => /^CONFLICT /.test(l)), broken: L.filter(l => /^BROKEN LINK/.test(l)), graph: g || null, unresolved: un,
      failed: L.some(l => /GRAPH BUILD FAILED|SYNC STOPPED/.test(l)) || code !== 0, lines: L.slice(-200) };
    syncRun = null; fs.rmSync(LOCK, { force: true }); send('sync', lastSync); tick();
  });
  return { res: 'ok', started: true };
}

module.exports = { live, graph, status, noteDetail, search, post, sync, syncState: () => syncRun ? { running: true, lines: syncRun.lines.slice(-200), at: syncRun.at } : lastSync, _: { extract, build, refresh, slug, readOnly, safe, okName, get cur() { return cur }, reset() { cur = null; ver = 0; skillList = null; gj = null; tcache.clear() } } };
follow(); // initial paths; every exported call re-checks the active project (config + projects.json are tiny)
for (const k of Object.keys(module.exports)) { const f = module.exports[k]; if (typeof f === 'function') module.exports[k] = (...a) => (follow(), f(...a)) }
module.exports.where = () => (follow(), { vault: VAULT, proj: PROJ, graph: GJ, name: PNAME, folder: FOLDER, cmd: CMD });
