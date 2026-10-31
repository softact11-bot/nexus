// M3 Knowledge page Sync tab (spec §26.7). GET: read-only preview + conflict texts (gate d). POST (gate e1): run a manual sync of the preview the
// user saw (one-time token, sync.run(): changed-since-preview skipped, verified backup, atomic writes, never deletes) and set mode / engine.
// One project per request (?id=): the answer holds only that project's paths, notes, graph and history. Automatic stays locked.
const RED = require('./redact.js'); // M4c: home → ~ and secrets masked in logs, exports and error text (spec §26.8)
const fs = require('fs'), path = require('path'), crypto = require('crypto'), CF = require('./config'), S = require('./sync'), G = require('./graph');
const MAX = 4e5; // diff text cap per side (bytes)
const TTL = 10 * 60e3, PREV = new Map(); // id → { token, plan, at }: the last preview shown, the only one a run accepts

function proj(id) {
  if (!/^[\w-]{1,64}$/.test(id || '')) throw new Error('Unknown project.');
  const s = CF.settings(id); if (!s) throw new Error('Unknown project.');
  const p = JSON.parse(fs.readFileSync(path.join(CF.dataDir(), 'projects.json'), 'utf8')).items.find(x => x.id === id); return { ...p, ...s };
}
const engineOf = p => p.sync.engine || (p.sync.cmd ? 'command' : 'builtin');
// which last synced copy the preview compares against: NEXUS's own, else (own-command projects only) sync_docs.sh's .sync_base (read only), else none (first sync).
// The built-in engine always previews against its own copies, exactly what a run uses.
function ancestor(p) {
  if (fs.existsSync(path.join(CF.dataDir(), 'sync-base', p.id, 'base.json'))) return { label: 'NEXUS last synced copies' };
  const d = path.join(p.dir, '.sync_base');
  if (engineOf(p) === 'command' && fs.existsSync(path.join(p.dir, 'sync_docs.sh')) && fs.existsSync(d)) return { dir: d, label: 'sync_docs.sh last synced copies (.sync_base, read only)' };
  return { label: 'none yet (first sync)' };
}
function graphInfo(p) {
  const s = G.source(p), f = s.file || path.join(CF.dataDir(), 'graphs', p.id, 'graph.json'); let n = null;
  try { const st = fs.statSync(f), g = JSON.parse(fs.readFileSync(f, 'utf8')); n = { nodes: g.nodes?.length || 0, links: (g.links || g.edges || []).length, at: st.mtimeMs } } catch { }
  return { mode: p.graph.mode, out: p.graph.out, ...s, file: f, stats: n };
}
function runWhy(p) {
  if (engineOf(p) === 'command') return 'This project syncs with its own command (Sync All). Switch the engine to Built-in to sync here.';
  if (p.sync.mode !== 'manual') return 'Set the mode to Manual to sync here.';
  return '';
}

function view(id) {
  const p = proj(id), o = { id, name: p.name, dir: p.dir, vault: p.vault, vaultFolder: p.vaultFolder, sync: p.sync, engine: engineOf(p), realSync: false,
    mapping: fs.existsSync(path.join(p.dir, 'sync_docs.sh')) ? 'sync_docs.sh pair table (kept as is)' : 'default pairs: PROJECT_DOCS.md → Project Docs, PROJECT_MEMORY.md → Project Memory, INDEX.md → File Index, docs\\*.md (CLAUDE.md never synced)',
    graph: graphInfo(p), history: S.historyOf(id).slice(-200).reverse(), plan: null, runWhy: runWhy(p) };
  PREV.delete(id);
  if (!p.vault) return { ...o, why: 'No Obsidian vault is linked to this project.' };
  try {
    const a = ancestor(p), pl = S.plan(p, a.dir ? { baseDir: a.dir } : {});
    o.plan = { at: pl.at, first: !a.dir && pl.first, ancestor: a.label, project: pl.project, vaultFolder: pl.vaultFolder, counts: pl.counts,
      items: pl.items.map(i => ({ note: i.note, src: i.src, project: i.project, vault: i.vault, action: i.action, kind: i.kind, why: i.why, record: i.action === 'same' && i.sha?.base !== i.sha?.project })) };
    if (!o.runWhy && !a.dir) { o.token = crypto.randomBytes(16).toString('hex'); PREV.set(id, { token: o.token, plan: pl, at: Date.now() }) }
  } catch (e) { o.why = RED(e.message) }
  return o;
}

// the texts of one conflict (project / vault / last synced copy / existing twin note), for the side-by-side view; read only
function diff(id, note) {
  const p = proj(id), a = ancestor(p), pl = S.plan(p, a.dir ? { baseDir: a.dir } : {}), i = pl.items.find(x => x.note === note && x.action === 'conflict');
  if (!i || !i.project) throw new Error('No such conflict in this project.');
  const rd = f => { try { const b = fs.readFileSync(f); return b.length > MAX ? null : b.toString('utf8').replace(/\r\n?/g, '\n') } catch { return null } };
  const twin = i.kind === 'duplicate-content' ? (/"([^"]+)"/.exec(i.why) || [])[1] : null;
  const bdir = a.dir || path.join(CF.dataDir(), 'sync-base', p.id);
  return { note, kind: i.kind, src: i.src, project: rd(i.project), vault: rd(i.vault), base: i.kind === 'first-sync' ? null : rd(path.join(bdir, note + '.md')), twin, twinText: twin ? rd(path.join(pl.vaultFolder, twin + '.md')) : null };
}

// POST /api/sync/run { id, token, choices: { note: 'project' | 'vault' | 'skip' }, confirm: true }
function run(b) {
  const p = proj(b.id), why = runWhy(p); if (why) return { res: why };
  if (b.confirm !== true) return { res: 'Confirm the list first.' };
  const pv = PREV.get(p.id); PREV.delete(p.id); // one run per preview
  if (!pv || typeof b.token !== 'string' || b.token !== pv.token || Date.now() - pv.at > TTL) return { res: 'This preview is out of date. Refresh the preview, check the list, then confirm again.' };
  const C = new Set(pv.plan.items.filter(i => i.action === 'conflict').map(i => i.note)), choices = {};
  for (const [k, v] of Object.entries(b.choices && typeof b.choices === 'object' ? b.choices : {})) {
    if (!C.has(k) || !['project', 'vault', 'skip'].includes(v)) return { res: 'Unknown conflict choice: ' + String(k).slice(0, 80) };
    choices[k] = v;
  }
  const R = S.run(p, { preview: pv.plan, choices }); if (R.res !== 'ok') return { res: R.res };
  return { res: 'ok', result: R };
}

// POST /api/sync/engine { id, mode: 'off' | 'manual', engine: 'builtin' | 'command' }: saved through the Projects link form's own path (projects.json backed up first)
function engine(b) {
  const p = proj(b.id);
  if (b.mode === 'auto') return { res: 'Automatic stays locked until a first real manual sync has been approved and completed.' };
  if (!['off', 'manual'].includes(b.mode)) return { res: 'Unknown sync mode.' };
  if (!['builtin', 'command'].includes(b.engine)) return { res: 'Unknown sync engine.' };
  if (b.engine === 'command' && !p.sync.cmd) return { res: 'This project has no own sync command.' };
  const o = require('./projects.js').post({ op: 'link', id: p.id, sync: { mode: b.mode, cmd: p.sync.cmd, engine: b.engine } });
  PREV.delete(p.id); return o.res === 'ok' ? { res: 'ok', sync: CF.settings(p.id).sync } : { res: o.res };
}

function handle(q, r, port) {
  const json = (c, o) => { r.writeHead(c, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify(o)) };
  const u = new URL(q.url, 'http://x'), id = u.searchParams.get('id');
  if (q.method === 'GET') {
    try { if (u.pathname === '/api/sync') return json(200, view(id)); if (u.pathname === '/api/sync/diff') return json(200, diff(id, u.searchParams.get('note'))) } catch (e) { return json(400, { res: RED(e.message) }) }
    r.writeHead(404); return r.end();
  }
  const op = { '/api/sync/run': run, '/api/sync/engine': engine }[u.pathname];
  if (q.method !== 'POST' || !op) { r.writeHead(405); return r.end() }
  let b = ''; q.on('data', c => { if ((b += c).length > 64e3) q.destroy() }).on('end', () => { let o; try { o = op(JSON.parse(b)) } catch (e) { o = { res: 'bad request: ' + RED(e.message) } } json(o.res === 'ok' ? 200 : 400, o) });
}

module.exports = { view, diff, run, engine, handle };
