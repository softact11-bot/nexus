// Projects for the NEXUS Projects page. The list lives in projects.json (NEXUS data dir), never in the project folders.
// Detection: Claude Code transcript folders (~/.claude/projects/<encoded cwd>/*.jsonl) name the directories you work in; each real,
// existing folder is added once (system, home and scratch folders are skipped). Removing a project only removes it from this list.
// Stats are read-only: session count, active time (gaps of 10 min or less between transcript timestamps), tracked tokens from
// state.json, folder size. Project files are only read, except New Project (creates the empty folder you confirmed). Backups are
// copied OUT of the project into NEXUS_DATA/project-backups. Launching uses fixed programs only: explorer.exe, wt.exe / PowerShell /
// Git Bash (+ claude), VS Code. AI Tool prompts go to claude from a file in NEXUS_DATA/prompts, never through a shell string.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), crypto = require('crypto');
const DATA = process.env.NEXUS_DATA || __dirname, FILE = path.join(DATA, 'projects.json'), CACHE = path.join(DATA, 'projects-cache.json'), BK = path.join(DATA, 'project-backups');
const H = os.homedir(), C = process.env.CLAUDE_CONFIG_DIR || path.join(H, '.claude'), TR = path.join(C, 'projects'), STATE = process.env.NEXUS_STATE || path.join(__dirname, 'state.json');
const EXE = (() => { const f = path.join(H, '.local', 'bin', 'claude.exe'); return fs.existsSync(f) ? f : 'claude' })();
const IDLE = 10 * 60e3, DAY = 864e5, TYPES = ['roblox', 'blender', 'other'], STATUS = ['active', 'paused', 'completed', 'archived'];
const IMG = /\.(png|jpe?g|webp|gif)$/i, TEXT = /\.(md|txt|lua|luau|js|mjs|cjs|ts|json|py|sh|ps1|cmd|bat|html|css|toml|ya?ml|csv|svg|xml|rbxmx|rbxlx|ini|cfg)$/i;
const SKIP = new Set(['.git', 'node_modules', 'backups', 'graphify-out', '__pycache__', '.venv']), UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
const writeJ = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o)); fs.renameSync(f + '.tmp', f) }; // write-then-rename
const B = require('./backup.js'); // P2a T4: projects.json via the B59 store (.bak, .corrupt-*, fsync)
const load = () => { const c = B.readJ(FILE, {}); return { items: c.items || [], dismissed: c.dismissed || [] } };
const save = c => B.writeJ(FILE, c);
const day = t => new Date(t).toLocaleDateString('sv');
const enc = d => d.replace(/[^a-zA-Z0-9]/g, '-'); // Claude Code's transcript folder name for a cwd
const norm = d => path.resolve(d).replace(/[\\/]+$/, '');
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
const isDir = d => { try { return fs.statSync(d).isDirectory() } catch { return false } };
const idOf = d => crypto.createHash('sha1').update(norm(d).toLowerCase()).digest('hex').slice(0, 10);
// Folders that are never projects: drive roots, Windows, Program Files, the home folder itself, AppData, temp and scratch.
function banned(d) {
  const n = norm(d).toLowerCase(), w = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();
  return n === path.parse(n).root.replace(/[\\/]$/, '').toLowerCase() || n.length < 4 || n === norm(H).toLowerCase() || n.startsWith(w) || /\\program files|\\appdata\\|\\temp\\|[\\/]scratch/.test(n + '\\') || [C, path.join(H, '.claude')].some(c => n === norm(c).toLowerCase() || n.startsWith(norm(c).toLowerCase() + path.sep));
}

// ---------- transcripts: incremental scan, cached per file (size + offset) ----------
let cache = null;
const C0 = () => cache ??= readJ(CACHE, { files: {}, walks: {} });
function cwdOf(dir) { // first transcript line that names its cwd
  for (const f of ls(dir).filter(x => x.endsWith('.jsonl'))) { const m = /"cwd":"((?:[^"\\]|\\.)+)"/.exec(head(path.join(dir, f), 65536)); if (m) try { return JSON.parse('"' + m[1] + '"') } catch { } }
  return null;
}
const ls = d => { try { return fs.readdirSync(d) } catch { return [] } };
function head(f, n) { let fd; try { fd = fs.openSync(f, 'r'); const b = Buffer.alloc(n), k = fs.readSync(fd, b, 0, n, 0); return b.toString('utf8', 0, k) } catch { return '' } finally { if (fd != null) fs.closeSync(fd) } }
function prompt(f) { // first thing you typed in the session (commands and system text stripped)
  for (const l of head(f, 262144).split('\n')) { if (!l.includes('"type":"user"') || l.includes('tool_result')) continue; let j; try { j = JSON.parse(l) } catch { continue }
    const c = j.message?.content, t = typeof c === 'string' ? c : Array.isArray(c) ? c.find(x => x.type === 'text')?.text : '';
    const s = String(t || '').replace(/<[^>]+>[^<]*<\/[^>]+>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); if (s && !/^Caveat:|^\[Request interrupted|^Base directory for this skill/.test(s)) return s.slice(0, 160) }
  return '';
}
function scan(f) { // timestamps → first, last, active ms and active ms per day. Reads only bytes added since the last scan.
  let st; try { st = fs.statSync(f) } catch { return null }
  const c = C0().files, e = c[f] && c[f].size <= st.size ? c[f] : (c[f] = { size: 0, off: 0, first: 0, last: 0, active: 0, days: {}, prompt: null });
  if (e.prompt == null) e.prompt = prompt(f);
  if (e.size === st.size) return e;
  const fd = fs.openSync(f, 'r'), B = Buffer.alloc(4 << 20), re = /"timestamp":"(\d{4}-\d\d-\d\dT[\d:.]+Z)"/g; let pos = e.off, tail = '';
  try { for (;;) { const k = fs.readSync(fd, B, 0, B.length, pos); if (!k) break; pos += k; let s = tail + B.toString('latin1', 0, k), cut = s.lastIndexOf('\n');
    if (cut < 0) { tail = s.length > 8 << 20 ? '' : s; continue } tail = s.slice(cut + 1); s = s.slice(0, cut); let m;
    while ((m = re.exec(s))) { const t = Date.parse(m[1]); if (!t) continue; if (!e.first) e.first = t; const dt = t - e.last;
      if (e.last && dt > 0 && dt <= IDLE) { e.active += dt; const d = day(t); e.days[d] = (e.days[d] || 0) + dt } if (t > e.last) e.last = t } } }
  finally { fs.closeSync(fd) }
  e.off = pos - Buffer.byteLength(tail, 'latin1'); e.size = st.size; return e;
}
function transcripts(p) { // every session transcript for the project's folder (+ its alias folders)
  const dirs = [p.dir, ...(p.aliases || []).filter(a => path.isAbsolute(a))].map(d => path.join(TR, enc(norm(d))));
  return dirs.flatMap(d => ls(d).filter(x => x.endsWith('.jsonl')).map(x => { const s = scan(path.join(d, x)); return s && { id: x.slice(0, -6), f: path.join(d, x), ...s } }).filter(Boolean));
}

// ---------- folder walk: size, week size, images, docs, type signals (cached 10 min) ----------
function walk(dir, force) {
  const W = C0().walks, k = norm(dir).toLowerCase(), w = W[k]; if (!force && w && Date.now() - w.at < 10 * 60e3) return w;
  const o = { at: Date.now(), bytes: 0, week: 0, files: 0, capped: false, img: [], docs: [], sig: { roblox: 0, blender: 0, obsidian: 0, git: 0 } }, wk = Date.now() - 7 * DAY;
  const go = (d, rel, depth) => { for (const n of ls(d)) { if (o.files > 50000) { o.capped = true; return } const p = path.join(d, n), r = rel ? rel + '/' + n : n; let s; try { s = fs.lstatSync(p) } catch { continue }
    if (s.isSymbolicLink()) continue;
    if (s.isDirectory()) { if (depth === 0 && n === '.obsidian') o.sig.obsidian++; if (depth === 0 && n === '.git') o.sig.git++; go(p, r, depth + 1); continue }
    o.files++; o.bytes += s.size; if (s.mtimeMs > wk) o.week += s.size;
    const top = !r.split('/').slice(0, -1).some(x => SKIP.has(x) || x[0] === '.'); // skip hidden folders (.git, .sync_base, .obsidian …) too
    if (top && /\.(rbxlx?|rbxmx?|luau)$|^default\.project\.json$|\.lua$/i.test(n)) o.sig.roblox++;
    if (top && /\.blend$/i.test(n)) o.sig.blender++;
    if (top && depth <= 3 && IMG.test(n) && o.img.length < 300 && s.size < 15e6) o.img.push(r);
    if (top && depth <= 1 && /\.md$/i.test(n) && o.docs.length < 200) o.docs.push({ f: r, size: s.size, mtime: s.mtimeMs }) } };
  go(dir, '', 0); W[k] = o; return o;
}
const typeOf = w => w.sig.roblox ? 'roblox' : w.sig.blender ? 'blender' : 'other';
function titleOf(dir) { const t = head(path.join(dir, 'CLAUDE.md'), 4096) || head(path.join(dir, 'README.md'), 4096); const m = /^#\s+(.+)$/m.exec(t); return m ? m[1].replace(/\s*\([^)]*\)\s*$/, '').trim().slice(0, 80) : '' }

// ---------- tracked tokens + tools (state.json, the tracker's own record of recent sessions) ----------
let stc = { m: 0, s: {} };
function tracked() { let m = 0; try { m = fs.statSync(STATE).mtimeMs } catch { } if (m !== stc.m) stc = { m, s: readJ(STATE, {}).sessions || {} }; return stc.s }
const TG = [['Roblox Studio', /roblox/i], ['Blender', /blender/i], ['Files (read/edit)', /^(Read|Edit|Write|MultiEdit|NotebookEdit)$/], ['Search', /^(Grep|Glob|ToolSearch|WebSearch|WebFetch)$/], ['Shell', /^(Bash|PowerShell)$/],
  ['Browser', /Browser|chrome/i], ['Agents & skills', /^(Agent|Task|Skill)$/], ['Planning', /update_plan|wrap_up|TodoWrite|mark_chapter/]];
const grp = n => (TG.find(([, re]) => re.test(n)) || ['Other'])[0];

function stats(p, now = Date.now()) {
  const T = transcripts(p), S = tracked(), ids = new Set(T.map(t => t.id)), mine = Object.values(S).filter(s => ids.has(s.id));
  const days = {}; for (const t of T) for (const [d, ms] of Object.entries(t.days)) days[d] = (days[d] || 0) + ms;
  const tools = {}, skills = {}; let tok = 0, compacts = 0, issues = {};
  for (const s of mine) { for (const v of Object.values(s.models || {})) tok += v.reduce((a, b) => a + (b || 0), 0);
    for (const [n, c] of Object.entries(s.tools || {})) tools[n] = (tools[n] || 0) + c; for (const [n, c] of Object.entries(s.skills || {})) skills[n] = (skills[n] || 0) + c;
    compacts += s.compacted || 0; for (const [k, v] of Object.entries(s.issues || {})) issues[k] = (issues[k] || 0) + (typeof v === 'number' ? v : 1) }
  const g = {}; for (const [n, c] of Object.entries(tools)) g[grp(n)] = (g[grp(n)] || 0) + c;
  const wk = now - 7 * DAY, week = T.filter(t => t.last > wk), w = isDir(p.dir) ? walk(p.dir) : null;
  return { sessions: T.length, week: week.length, active: T.reduce((a, t) => a + t.active, 0), activeWeek: Object.entries(days).filter(([d]) => d >= day(wk)).reduce((a, [, v]) => a + v, 0),
    last: Math.max(0, ...T.map(t => t.last)), first: Math.min(...T.map(t => t.first || Infinity).concat([Infinity])), days, tracked: mine.length, tokens: tok, compacts, issues,
    tools: Object.entries(g).sort((a, b) => b[1] - a[1]), toolsRaw: Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 30), skills: Object.entries(skills).sort((a, b) => b[1] - a[1]),
    bytes: w?.bytes ?? null, weekBytes: w?.week ?? null, files: w?.files ?? null, capped: !!w?.capped, sig: w?.sig || null };
}

// ---------- detection ----------
function detect(c) {
  const found = [], missing = [];
  for (const d of ls(TR)) { const full = path.join(TR, d); if (!isDir(full)) continue; const cwd = cwdOf(full); if (!cwd || banned(cwd)) continue;
    if (!isDir(cwd)) { missing.push({ dir: cwd, sessions: ls(full).filter(x => x.endsWith('.jsonl')).length }); continue }
    if (c.items.some(p => same(p.dir, cwd) || (p.aliases || []).some(a => same(a, cwd))) || c.dismissed.some(x => same(x, cwd))) continue;
    found.push(cwd) }
  for (const dir of found) { const w = walk(dir); c.items.push(blank(dir, { name: titleOf(dir) || path.basename(dir), type: typeOf(w), detected: true, tags: [...(w.sig.roblox ? ['Roblox'] : []), ...(w.sig.blender ? ['Blender'] : []), ...(w.sig.obsidian ? ['Obsidian vault'] : [])], obsidian: w.sig.obsidian ? norm(dir) : '' })) }
  return { added: found.length, missing };
}
const blank = (dir, o = {}) => ({ id: idOf(dir), dir: norm(dir), name: path.basename(dir), desc: '', type: 'other', status: 'active', tags: [], main: false, thumb: '', obsidian: '', aliases: [], tools: [], tasks: [], added: Date.now(), detected: false, ...o });

// ---------- status (list) + detail ----------
let lastMissing = [];
function status(q = {}) {
  const c = load(); if (q.refresh) { C0().walks = {} }
  const d = detect(c); if (d.added) save(c); lastMissing = d.missing;
  const items = c.items.map(p => ({ ...p, exists: isDir(p.dir), stats: stats(p) }));
  writeJ(CACHE, C0());
  let active = null, vaults = []; try { active = require('./config').load()?.active || null } catch { }
  try { vaults = Object.values(JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || '', 'obsidian', 'obsidian.json'), 'utf8')).vaults || {}).map(x => ({ name: path.basename(x.path), path: x.path, ok: isDir(path.join(x.path, '.obsidian')) })) } catch { } // read-only
  return { at: Date.now(), items, missing: d.missing, detectedNew: d.added, data: FILE, active, vaults };
}
function git(dir, args) { try { return cp.execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null } }
function detail(id) {
  const c = load(), p = c.items.find(x => x.id === id); if (!p) return { res: 'Unknown project.' };
  if (!isDir(p.dir)) return { res: 'ok', id, exists: false };
  const w = walk(p.dir), S = tracked(), T = transcripts(p).sort((a, b) => b.last - a.last);
  const top = ls(p.dir).map(n => { try { const s = fs.statSync(path.join(p.dir, n)); return { n, dir: s.isDirectory(), size: s.isDirectory() ? null : s.size, mtime: s.mtimeMs } } catch { return null } }).filter(Boolean)
    .sort((a, b) => b.dir - a.dir || a.n.localeCompare(b.n)).slice(0, 200);
  const log = git(p.dir, ['log', '-15', '--format=%h%x1f%ct%x1f%s']), porc = git(p.dir, ['status', '--porcelain']);
  const bdir = path.join(p.dir, 'backups'), folders = isDir(bdir) ? ls(bdir).filter(n => isDir(path.join(bdir, n))).map(n => { const sub = ls(path.join(bdir, n)).filter(x => isDir(path.join(bdir, n, x)));
    let m = 0; try { m = fs.statSync(path.join(bdir, n)).mtimeMs } catch { } return { n, snaps: sub.length, latest: sub.sort().at(-1) || null, mtime: m } }) : [];
  const mine = ls(path.join(BK, p.id)).filter(n => /^\d{4}-/.test(n)).sort().reverse().map(n => { const m = readJ(path.join(BK, p.id, n, 'nexus-backup.json'), {}); return m.state === 'in-progress' || m.files == null ? { n, incomplete: true } : { n, ...m } }); // P2a T5: no finished manifest = interrupted, never counted
  const todo = [], reg = {}; let stale = [];
  for (const d of w.docs) { const t = (() => { try { return fs.readFileSync(path.join(p.dir, d.f), 'utf8') } catch { return '' } })();
    for (const m of t.matchAll(/^\s*[-*] \[( |x)\] (.+)$/gim)) if (todo.length < 200) todo.push({ f: d.f, t: m[2].trim().slice(0, 200), done: m[1].toLowerCase() === 'x' });
    const u = /^updated:\s*(\d{4}-\d\d-\d\d)/m.exec(t.slice(0, 400)); if (u && Date.now() - Date.parse(u[1]) > 14 * DAY) stale.push({ f: d.f, updated: u[1] });
    if (/^asset_registry\.md$/i.test(d.f)) for (const l of t.split('\n')) { const col = l.split('|'); if (col.length > 4 && !/^\s*(Asset|---)/.test(col[1])) { const s = (/^\s*(Approved|Pending|Superseded|Prototype|Unknown|Rejected)/i.exec(col[3]) || [, 'Other'])[1]; const k = s[0].toUpperCase() + s.slice(1).toLowerCase(); reg[k] = (reg[k] || 0) + 1 } } }
  let graph = null; const gf = path.join(p.dir, 'graphify-out', 'graph.json');
  try { const s = fs.statSync(gf); const g = s.size < 30e6 ? readJ(gf, null) : null; graph = { mtime: s.mtimeMs, nodes: g?.nodes?.length ?? null, links: (g?.links || g?.edges)?.length ?? null, report: fs.existsSync(path.join(p.dir, 'graphify-out', 'GRAPH_REPORT.md')) } } catch { }
  return { res: 'ok', id, exists: true, top, docs: w.docs, img: w.img, sig: w.sig,
    sessions: T.slice(0, 100).map(t => { const s = S[t.id]; return { id: t.id, first: t.first, last: t.last, active: t.active, size: t.size, prompt: t.prompt, tokens: s ? Object.values(s.models || {}).reduce((a, v) => a + v.reduce((x, y) => x + (y || 0), 0), 0) : null, compacts: s?.compacted ?? null } }),
    git: log == null ? null : { log: log.trim().split('\n').filter(Boolean).map(l => { const [h, t, s] = l.split('\x1f'); return { h, t: +t * 1000, s } }), dirty: porc == null ? null : porc.split('\n').filter(Boolean).length },
    folders, backups: mine, todo, stale, reg, graph };
}

// ---------- writes ----------
const S = (v, n) => typeof v === 'string' && v.length <= n ? v.trim() : null;
const arr = (v, n, m) => Array.isArray(v) && v.length <= n && v.every(x => typeof x === 'string' && x.trim() && x.length <= m) ? [...new Set(v.map(x => x.trim()))] : null;
function checkDir(d, mustExist) {
  if (typeof d !== 'string' || d.length > 260 || /["<>|?*\x00-\x1f]/.test(d.slice(2)) || !path.isAbsolute(d) || !/^[a-z]:\\/i.test(path.resolve(d))) return 'Use a full folder path like C:\\Users\\you\\Desktop\\MyGame.';
  if (banned(d)) return 'That is a system, home or temporary folder, not a project folder.';
  if (mustExist && !isDir(d)) return 'Folder not found.';
  return null;
}
function post(b) {
  const c = load(), p = b.id ? c.items.find(x => x.id === b.id) : null, done = (o = {}) => (save(c), { res: 'ok', ...o });
  if (b.op === 'add') {
    const why = checkDir(b.dir, !b.create); if (why) return { res: why };
    const dir = norm(b.dir); if (c.items.some(x => same(x.dir, dir))) return { res: 'That folder is already a project.' };
    if (b.create) { if (fs.existsSync(dir)) return { res: 'Something with that name already exists there. Use Import Project for an existing folder.' };
      if (!isDir(path.dirname(dir))) return { res: 'The parent folder doesn\'t exist.' }; fs.mkdirSync(dir) }
    const w = walk(dir, true), name = S(b.name, 80) || titleOf(dir) || path.basename(dir), type = TYPES.includes(b.type) ? b.type : typeOf(w);
    c.dismissed = c.dismissed.filter(x => !same(x, dir)); const it = blank(dir, { name, type, obsidian: w.sig.obsidian ? dir : '' }); c.items.push(it); return done({ item: it });
  }
  if (!p) return { res: 'Unknown project.' };
  if (b.op === 'update') { const s = b.set || {}, bad = [];
    const f = { name: () => S(s.name, 80) || null, desc: () => S(s.desc, 400), type: () => TYPES.includes(s.type) ? s.type : null, status: () => STATUS.includes(s.status) ? s.status : null, main: () => typeof s.main === 'boolean' ? s.main : null,
      tags: () => arr(s.tags, 8, 24), tools: () => arr(s.tools, 12, 64), aliases: () => { const a = arr(s.aliases, 8, 260); return a && a.every(x => !checkDir(x, true)) ? a.map(norm) : null },
      thumb: () => s.thumb === '' || (typeof s.thumb === 'string' && isDir(p.dir) && walk(p.dir).img.includes(s.thumb)) ? s.thumb : null,
      obsidian: () => s.obsidian === '' ? '' : !checkDir(s.obsidian, true) && isDir(path.join(s.obsidian, '.obsidian')) ? norm(s.obsidian) : null };
    for (const k of Object.keys(s)) { if (!f[k]) { bad.push(k); continue } const v = f[k](); if (v == null) bad.push(k); else p[k] = v }
    if (bad.length) return { res: 'Not saved: check ' + bad.join(', ') + (bad.includes('obsidian') ? ' (the folder must be an Obsidian vault, with a .obsidian folder)' : '') + '.' };
    if (s.main) for (const x of c.items) if (x !== p) x.main = false; return done({ item: p }) }
  if (b.op === 'link') { // M2: vault + folder, sync mode, graph mode; checked by config.js, projects.json backed up first
    const CF = require('./config'), v = CF.validateLink(c.items, p.id, b.unlink ? null : { vault: b.vault, vaultFolder: b.vaultFolder }); if (!v.ok) return { res: v.why };
    const st = CF.validateSettings(p, { sync: b.sync, graph: b.graph }); if (!st.ok) return { res: st.why };
    require('./backup').backup([FILE], CF.dataDir(), 'projects-link');
    if (b.unlink) { delete p.vault; delete p.vaultFolder } else if (!v.clear) { p.vault = v.vault; p.vaultFolder = v.vaultFolder }
    if (st.sync) p.sync = st.sync; if (st.graph) p.graph = st.graph; return done({ item: p, warn: v.warn || '' }) }
  if (b.op === 'active') { const CF = require('./config'); CF.save({ ...(CF.load() || {}), version: CF.VER, active: p.id }); return { res: 'ok', active: p.id } }
  if (b.op === 'remove') { c.items = c.items.filter(x => x !== p); c.dismissed.push(p.dir); return done() } // files untouched
  if (b.op === 'addTask') { const t = S(b.t, 200); if (!t) return { res: 'Write the task (up to 200 characters).' }; if (p.tasks.length >= 200) return { res: 'Too many tasks.' };
    p.tasks.push({ id: crypto.randomBytes(4).toString('hex'), t, kind: b.kind === 'milestone' ? 'milestone' : 'task', done: false, at: Date.now() }); return done() }
  const t = p.tasks.find(x => x.id === b.tid);
  if (b.op === 'task') { if (!t) return { res: 'Unknown task.' }; t.done = !!b.done; t.doneAt = t.done ? Date.now() : null; return done() }
  if (b.op === 'delTask') { if (!t) return { res: 'Unknown task.' }; p.tasks = p.tasks.filter(x => x !== t); return done() }
  if (!isDir(p.dir)) return { res: 'The project folder is missing.' };
  if (b.op === 'open') return open(p, b);
  if (b.op === 'backup') return b.confirm === true ? backup(p) : { res: 'Confirm the backup first.' };
  return { res: 'Unknown action.' };
}
const run = (exe, args, o = {}) => { cp.spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false, ...o }).on('error', () => { }).unref(); return { res: 'ok' } };
// Settings → Claude Code "Open terminals in": Windows Terminal (default), PowerShell or Git Bash. Fixed programs; args are only --resume + a checked UUID.
const GITBASH = ['C:/Program Files/Git/git-bash.exe', 'C:/Program Files (x86)/Git/git-bash.exe'].find(f => fs.existsSync(f));
function term(t, dir, args) {
  // PowerShell through `start` (own console): spawned directly (detached, stdin ignored) it exits without running the command. dir has no quotes (checkDir).
  if (t === 'pwsh') return run('cmd.exe', ['/d', '/s', '/c', `start "" /d "${dir}" powershell.exe -NoExit -Command "& '${EXE.replace(/'/g, "''")}' ${args.join(' ')}"`], { windowsHide: true, windowsVerbatimArguments: true });
  if (t === 'bash') return GITBASH ? run(GITBASH, ['--cd=' + dir, '-c', `"${EXE.replace(/\\/g, '/')}" ${args.join(' ')}; exec bash`]) : { res: 'Git Bash not found. Pick another terminal in Settings → Claude Code.' };
  return run('wt.exe', ['-d', dir, EXE, ...args]);
}
function shell(t, dir) { // a plain shell in the folder (Claude Code page Quick Access / Terminal tab)
  if (t === 'pwsh') return run('cmd.exe', ['/d', '/s', '/c', `start "" /d "${dir}" powershell.exe -NoExit`], { windowsHide: true, windowsVerbatimArguments: true });
  if (t === 'bash') return GITBASH ? run(GITBASH, ['--cd=' + dir]) : { res: 'Git Bash not found. Pick another terminal in Settings → Claude Code.' };
  return run('wt.exe', ['-d', dir]);
}
// AI Tools: the prompt is written to a file; PowerShell reads it with -EncodedCommand (base64 of a fixed script), Git Bash with "$(cat file)".
// Neither re-parses the prompt text as code. PowerShell 5.1 drops inner double quotes when passing to a native program, hence the \" escape.
const AI_TOOLS = ['sum', 'exp', 'iss', 'ref', 'gen', 'opt'], PR = path.join(DATA, 'prompts');
const CODE = [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe')].find(f => fs.existsSync(f));
function promptCmd(file) {
  const q = s => "'" + s.replace(/'/g, "''") + "'", ps = `$t = Get-Content -Raw -Encoding UTF8 -LiteralPath ${q(file)}; & ${q(EXE)} ($t -replace '\"', '\\"')`;
  return { b64: Buffer.from(ps, 'utf16le').toString('base64'), bash: `"${EXE.replace(/\\/g, '/')}" "$(cat '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}')"; exec bash` };
}
function ai(t, dir, tool, text) {
  if (!AI_TOOLS.includes(tool)) return { res: 'Unknown AI tool.' };
  if (typeof text !== 'string' || !text.trim() || text.length > 4096 || text.includes('\0')) return { res: 'Write a prompt (up to 4096 characters).' };
  fs.mkdirSync(PR, { recursive: true });
  for (const n of ls(PR).filter(x => x.endsWith('.txt')).sort().slice(0, -19)) try { fs.unlinkSync(path.join(PR, n)) } catch { } // keep the last 20 (NEXUS's own temp files)
  const f = path.join(PR, new Date().toISOString().replace(/[:.]/g, '-') + '-' + tool + '.txt'); fs.writeFileSync(f, text.trim());
  const c = promptCmd(f);
  if (t === 'pwsh') return run('cmd.exe', ['/d', '/s', '/c', `start "" /d "${dir}" powershell.exe -NoExit -EncodedCommand ${c.b64}`], { windowsHide: true, windowsVerbatimArguments: true });
  if (t === 'bash') return GITBASH ? run(GITBASH, ['--cd=' + dir, '-c', c.bash]) : { res: 'Git Bash not found. Pick another terminal in Settings → Claude Code.' };
  return run('wt.exe', ['-d', dir, 'powershell.exe', '-NoExit', '-EncodedCommand', c.b64]);
}
function open(p, b) {
  if (b.what === 'explorer') return run('explorer.exe', [p.dir]);
  if (b.what === 'reveal') { const f = typeof b.f === 'string' ? path.resolve(p.dir, b.f) : ''; if (!f.startsWith(p.dir + path.sep) || !fs.existsSync(f) || f.includes('"')) return { res: 'File not found in this project.' };
    return run('explorer.exe', [`/select,"${f}"`], { windowsVerbatimArguments: true }) }
  if (b.what === 'session') { if (b.resume != null) { if (!UUID.test(b.resume) || !transcripts(p).some(t => t.id === b.resume)) return { res: 'Unknown session for this project.' }; return term(b.term, p.dir, ['--resume', b.resume]) }
    return term(b.term, p.dir, []) }
  if (b.what === 'term') return shell(b.term, p.dir);
  if (b.what === 'ai') return ai(b.term, p.dir, b.tool, b.prompt);
  if (b.what === 'vscode') { if (!CODE) return { res: 'VS Code not found. Install it, or use Explorer.' };
    if (b.f == null) return run(CODE, [p.dir]);
    const d = require('./cc.js')._.inside(p, b.f, true); if (d.code) return { res: d.res }; return run(CODE, [p.dir, '-g', d.full]) }
  if (b.what === 'obsidian') { const v = p.obsidian || p.vault; // B82: a vault set in Project Settings wins; else the Link Vault one
    if (!v || !isDir(v)) return { res: 'No vault to open: use Link Vault (or set one in Project Settings) first.' }; return run('explorer.exe', ['obsidian://open?path=' + encodeURIComponent(v)]) }
  return { res: 'Unknown action.' };
}
// Copies the project's text files (code, docs, configs; no binaries, .git, node_modules, backups or graphify-out) OUT of the project.
function backup(p) { const g = backupSteps(p); let x; while (!(x = g.next()).done); return x.value }
// Generator: yields after each copied file (automations cancel between files: the partial folder is kept and marked cancelled).
function* backupSteps(p, why = () => null) {
  let stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19), k = 2; while (fs.existsSync(path.join(BK, p.id, stamp + (k > 2 ? '-' + (k - 1) : '')))) k++; // never reuse a folder
  stamp += k > 2 ? '-' + (k - 1) : ''; const dest = path.join(BK, p.id, stamp); let n = 0, bytes = 0, skipped = 0, stop = null;
  writeJ(path.join(dest, 'nexus-backup.json'), { state: 'in-progress', started: Date.now(), from: p.dir }); // P2a T5: a crash leaves it marked, never counted as a backup
  function* go(d, rel) { for (const x of ls(d)) { if (stop) return; const s = (() => { try { return fs.lstatSync(path.join(d, x)) } catch { return null } })(); if (!s || s.isSymbolicLink()) continue;
    if (s.isDirectory()) { if (!SKIP.has(x) && !x.startsWith('.')) yield* go(path.join(d, x), rel ? rel + '/' + x : x); continue }
    if (!TEXT.test(x) || s.size > 5e6) { skipped++; continue } if (n >= 20000 || bytes + s.size > 300e6) { skipped++; continue }
    const to = path.join(dest, ...(rel ? rel.split('/') : []), x); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(d, x), to); n++; bytes += s.size; yield n; stop = why() } }
  yield* go(p.dir, ''); const meta = { at: Date.now(), from: p.dir, files: n, bytes, skipped, state: stop ? 'cancelled' : 'complete', ...(stop ? { cancelled: stop + ' (partial)' } : {}) }; writeJ(path.join(dest, 'nexus-backup.json'), meta);
  return { res: stop ? 'cancelled' : 'ok', backup: { n: stamp, path: dest, ...meta } };
}
function img(id, f) { // a picture from the project folder, only if the folder walk listed it
  const p = load().items.find(x => x.id === id); if (!p || !isDir(p.dir) || !walk(p.dir).img.includes(f)) return null;
  const full = path.resolve(p.dir, f); return full.startsWith(p.dir + path.sep) ? { file: full, type: MIME[path.extname(full).toLowerCase()] } : null;
}

const byId = id => load().items.find(x => x.id === id) || null;
module.exports = { status, detail, post, img, byId, backupSteps, _: { banned, enc, scan, checkDir, typeOf, grp, transcripts, promptCmd } };
