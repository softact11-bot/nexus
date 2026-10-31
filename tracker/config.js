// NEXUS M2 per-user config (spec §26.6). nexus-config.json lives in the current Windows user's NEXUS data folder:
// NEXUS_DATA, else this folder when it sits inside the user's profile (this PC, adopt mode), else %LOCALAPPDATA%\NEXUS
// (shared program install). The data folder must be inside the current user's profile, so accounts never share it.
// Project link fields (vault, vaultFolder, sync, graph) are optional extras on projects.json items; missing = today's behaviour.
// plan() only computes the migration; migrate() writes it (backup first) and is run only after the user approves.
const fs = require('fs'), path = require('path'), sp = require('./safepath'), bk = require('./backup');
const VER = 1, SYNC = ['off', 'manual', 'auto'], GRAPH = ['builtin', 'graphify'], ENGINE = ['builtin', 'command'];

function dataDir() {
  const d = process.env.NEXUS_DATA || (sp.within(sp.home(), __dirname) ? __dirname : path.join(process.env.LOCALAPPDATA || path.join(sp.home(), 'AppData', 'Local'), 'NEXUS'));
  const c = sp.check(d, 'data'); if (!c.ok) throw new Error('NEXUS data folder refused: ' + c.why); return c.path;
}
const file = () => path.join(dataDir(), 'nexus-config.json');
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
const load = () => readJ(file(), null);
const projects = () => readJ(path.join(dataDir(), 'projects.json'), { items: [] });

function save(cfg) {
  if (!cfg || cfg.version !== VER) throw new Error('Unknown config version.');
  return bk.writeJSON(file(), { ...load(), ...cfg }, dataDir(), 'nexus-config'); // unknown fields kept
}

// the vault folder a project link points at: vault root or a folder inside it
function target(l) { return l.vaultFolder ? path.join(l.vault, l.vaultFolder) : l.vault }

// is this link safe for project id, given every other project's link?
function validateLink(items, id, l) {
  if (!l || !l.vault) return { ok: true, clear: true };
  const v = sp.check(l.vault); if (!v.ok) return v;
  if (!fs.existsSync(path.join(v.path, '.obsidian'))) return { ok: false, why: 'That folder is not an Obsidian vault (no .obsidian folder inside).' };
  const f = (l.vaultFolder || '').replace(/^[\\/]+|[\\/]+$/g, '');
  if (f && (path.isAbsolute(f) || f.split(/[\\/]/).some(x => x === '..' || x === '' || x.startsWith('.')))) return { ok: false, why: 'The folder must be a plain folder inside the vault (no .., no hidden folders).' };
  const t = target({ vault: v.path, vaultFolder: f });
  if (!sp.within(v.path, sp.real(t))) return { ok: false, why: 'That folder leads outside the vault.' };
  for (const o of items) if (o.id !== id && o.vault && sp.overlap(target(o), t))
    return { ok: false, why: `"${o.name}" already uses ${o.vaultFolder ? 'the folder ' + o.vaultFolder : 'the whole vault'} here. Pick a separate folder so the projects never mix.` };
  return { ok: true, vault: v.path, vaultFolder: f, warn: v.warn };
}

function validateSettings(p, s) {
  const out = {};
  if (s.sync) { if (!SYNC.includes(s.sync.mode)) return { ok: false, why: 'Unknown sync mode.' }; const cmd = typeof s.sync.cmd === 'string' ? s.sync.cmd.trim() : '';
    if (cmd.length > 300 || /[\x00-\x1f]/.test(cmd)) return { ok: false, why: 'The custom command is too long or has control characters.' };
    const e = s.sync.engine; if (e !== undefined && !ENGINE.includes(e)) return { ok: false, why: 'Unknown sync engine.' }; if (e === 'command' && !cmd) return { ok: false, why: 'Your own command is empty.' };
    out.sync = { mode: s.sync.mode, cmd, ...(e ? { engine: e } : {}) } } // engine missing = own command when there is one, else built-in
  if (s.graph) { if (!GRAPH.includes(s.graph.mode)) return { ok: false, why: 'Unknown graph mode.' }; const o = s.graph.out || '';
    if (o) { const c = sp.check(path.dirname(o)); if (!c.ok) return c; c.path = path.join(c.path, path.basename(o)); /* graph output is only read here; Graphify writes it */ if (!sp.within(p.dir, c.path) && !sp.within(dataDir(), c.path)) return { ok: false, why: 'Graph data must stay inside the project or your NEXUS data folder.' } }
    out.graph = { mode: s.graph.mode, out: o } }
  return { ok: true, ...out };
}

// migration for the first NEXUS (no nexus-config.json yet): the project with a sync_docs.sh `V="<vault>/<folder>"` line (or NEXUS_PROJ)
// becomes the active project with that vault + folder, so nothing behaves differently. No personal paths in the code (M7a portability).
function plan(env = process.env) {
  const H = sp.home(), V = d => { try { return /^V="([^"]*)\/([^"/]+)"$/m.exec(fs.readFileSync(path.join(d, 'sync_docs.sh'), 'utf8')) } catch { return null } };
  const items = projects().items, p = env.NEXUS_PROJ ? items.find(x => sp.within(x.dir, env.NEXUS_PROJ) && sp.within(env.NEXUS_PROJ, x.dir)) : items.find(x => V(x.dir));
  if (load()) return { needed: false, why: 'nexus-config.json already exists.' };
  if (!p) return { needed: true, config: { version: VER, active: items[0]?.id || '' }, fields: {} };
  const m = V(p.dir), unix = s => s.replace(/^(\$HOME|\$\{HOME\}|~)(?=\/|$)/, H).replace(/^\/([a-z])\//i, '$1:/'); // Git Bash /c/... → C:/...
  const VAULT = env.NEXUS_VAULT || (m ? path.resolve(unix(m[1])) : '');
  return { needed: true, config: { version: VER, active: p.id }, fields: { [p.id]: { ...(VAULT ? { vault: VAULT } : {}), vaultFolder: m?.[2] || '', sync: { mode: 'manual', cmd: 'bash sync_docs.sh' }, graph: { mode: 'graphify', out: path.join(p.dir, 'graphify-out') } } } };
}

// writes the plan: projects.json backed up first, only the new fields added; journaled; re-running changes nothing
function migrate() {
  const pl = plan(); if (!pl.needed) return { res: 'nothing to do', ...pl };
  const d = dataDir(), pf = path.join(d, 'projects.json'), j = new bk.Journal(path.join(d, 'nexus-journal.json'), d);
  if (j.open().length) throw new Error('An earlier step did not finish; resolve it first.');
  const pj = projects(), b = fs.existsSync(pf) ? bk.backup([pf], d, 'migration') : null;
  j.begin('migrate-projects', { restore: b }); for (const it of pj.items) if (pl.fields[it.id]) for (const [k, v] of Object.entries(pl.fields[it.id])) if (it[k] === undefined) it[k] = v;
  if (Object.keys(pl.fields).length) bk.writeJSON(pf, pj, d, 'projects'); j.done('migrate-projects');
  j.begin('write-config', { remove: file() }); save(pl.config); j.done('write-config');
  return { res: 'ok', backup: b, config: pl.config, fields: pl.fields };
}

// effective settings of one project (defaults where a field is missing)
function settings(id) {
  const p = projects().items.find(x => x.id === id); if (!p) return null;
  return { id, name: p.name, dir: p.dir, type: p.type, vault: p.vault || '', vaultFolder: p.vaultFolder || '', sync: p.sync || { mode: 'off', cmd: '' }, graph: p.graph || { mode: 'builtin', out: '' } };
}
const active = () => { const c = load(); return settings(c?.active) || null };

module.exports = { dataDir, file, load, save, validateLink, validateSettings, plan, migrate, settings, active, VER };
