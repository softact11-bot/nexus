// M7f Startup Change Scan: what changed since the last successful scan, from data NEXUS already has (no Claude call, no network, read-only
// except its own snapshot). Sources: sessions (tracker state), projects (projects.js), vault notes (file size + mtime, bounded walk), Graphify graph,
// automations (auto.js), plugins + skills (inv.js). Snapshot per account in <account dir>/scan.json, written atomically. A source that fails keeps
// its previous snapshot (no false "removed"), and is reported. One scan at a time; a second request joins it. Labels are names, never full paths.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const V = 1, MAXF = 20000, h = o => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12), base = p => path.basename(String(p || ''));
const SRC = {
  sessions: c => Object.fromEntries(Object.values(c.sessions || {}).filter(s => s?.id).map(s => [s.id, [s.end + ':' + s.n, `${s.project || 'chat'} · ${String(s.id).slice(0, 8)}`]])),
  projects: () => Object.fromEntries(require('./projects.js').status().items.map(p => [p.id, [h([p.name, p.dir, p.exists]), p.name || base(p.dir)]])),
  notes: () => { const K = require('./knowledge.js').where(), o = {}; let n = 0; if (!K.vault) return o; // no vault set up: nothing to check, not a failure
    for (const f of fs.readdirSync(K.vault, { recursive: true })) { if (!/\.md$/i.test(f) || /(^|[\\/])\./.test(f)) continue; if (++n > MAXF) throw new Error(`more than ${MAXF} notes, scan stopped`);
      const s = fs.statSync(path.join(K.vault, f)); o[f.replace(/\\/g, '/')] = [s.size + ':' + Math.round(s.mtimeMs), base(f).slice(0, -3)] } return o },
  graph: () => { const g = require('./knowledge.js').where().graph; if (!g || !fs.existsSync(g)) return {}; const s = fs.statSync(g); return { graph: [s.size + ':' + Math.round(s.mtimeMs), 'Graphify graph'] } },
  automations: () => Object.fromEntries(require('./auto.js').status().items.map(a => [a.id, [h([a.name, a.on, a.sched, a.steps]), a.name]])),
  plugins: () => { const i = require('./inv.js')(); return Object.fromEntries([...(i.plugins || []).map(p => ['p:' + (p.id || p.name), [h([p.version, p.enabled]), p.name || p.id]]), ...(i.skills || []).map(s => ['s:' + (s.id || s.name), [h([s.version, s.enabled, s.mtime]), s.name || s.id]])]) }
};
let busy = null;
const file = d => path.join(d, 'scan.json');
function read(d) { try { const j = JSON.parse(fs.readFileSync(file(d), 'utf8')); if (j.v === V && j.src && typeof j.src === 'object') return j } catch { } return null }
function last(d) { const j = read(d); return j ? { res: 'ok', at: j.at, report: j.report || null } : { res: 'ok', at: null, report: null } }
async function scan(c) {
  const t0 = Date.now(), old = read(c.dir), src = {}, failed = {}, changes = {};
  for (const [k, f] of Object.entries(SRC)) {
    await new Promise(r => setImmediate(r)); // let the server answer other requests between sources
    try { src[k] = f(c) } catch (e) { failed[k] = String(e.message || e).replace(/[A-Z]:\\[^\s'"]*/gi, '…').slice(0, 160); if (old?.src[k]) src[k] = old.src[k]; continue }
    const a = old?.src[k], b = src[k]; if (!a) continue; // first time this source is seen: baseline, no change list
    const ch = { added: [], changed: [], removed: [] };
    for (const id in b) if (!(id in a)) ch.added.push(b[id][1]); else if (a[id][0] !== b[id][0] || a[id][1] !== b[id][1]) ch.changed.push(b[id][1]);
    for (const id in a) if (!(id in b)) ch.removed.push(a[id][1]);
    if (ch.added.length + ch.changed.length + ch.removed.length) changes[k] = { n: [ch.added.length, ch.changed.length, ch.removed.length], added: ch.added.slice(0, 50), changed: ch.changed.slice(0, 50), removed: ch.removed.slice(0, 50) };
  }
  const report = { at: t0, since: old?.at || null, first: !old, ms: Date.now() - t0, changes, failed };
  fs.mkdirSync(c.dir, { recursive: true }); const tmp = file(c.dir) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ v: V, at: t0, src, report })); fs.renameSync(tmp, file(c.dir)); // atomic
  return { res: 'ok', ...report };
}
// op 'scan': startup (skipped when the last scan is under 2 min old, so reloads do not rescan) or manual (force)
function run(c) {
  if (busy) return busy;
  if (!c.force) { const j = read(c.dir); if (j && Date.now() - j.at < 120e3) return Promise.resolve({ res: 'ok', recent: true, ...(j.report || {}) }) }
  return busy = scan(c).catch(e => ({ res: 'The scan could not finish: ' + String(e.message || e).slice(0, 160) })).finally(() => { busy = null });
}
module.exports = { run, last, _: { SRC, read } };
