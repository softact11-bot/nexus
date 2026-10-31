// /api/inv: read-only inventory for the NEXUS Plugins & Skills page. Loaded only when the preview asks (never on the hook path).
// Reads installed plugins, Claude-app plugins, skills, hooks and the LOCAL marketplace catalogs. Writes nothing, runs nothing, no network.
const fs = require('fs'), path = require('path'), os = require('os');
const H = os.homedir(), C = process.env.CLAUDE_CONFIG_DIR || path.join(H, '.claude'), P = path.join(C, 'plugins');
const APPDIR = path.join(process.env.APPDATA || path.join(H, 'AppData', 'Roaming'), 'Claude', 'local-agent-mode-sessions');
const readJ = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
const readT = (f, max = 512e3) => { try { const s = fs.statSync(f); return s.size <= max ? fs.readFileSync(f, 'utf8') : '' } catch { return '' } };
const ls = (d, dirsOnly) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(x => !dirsOnly || x.isDirectory()).map(x => x.name) } catch { return [] } };
const mtime = f => { try { return fs.statSync(f).mtimeMs } catch { return null } };
const exists = f => { try { fs.accessSync(f); return true } catch { return false } };
const hex = s => /^[0-9a-f]{7,40}$/i.test(s || '');

// SKILL.md front matter: name + description (single-line or quoted values; enough for the files Claude Code itself accepts).
function front(t) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t); if (!m) return null; const o = {};
  for (const l of m[1].split(/\r?\n/)) { const k = /^(\w[\w-]*):\s*(.*)$/.exec(l); if (k) o[k[1]] = k[2].replace(/^(["'])([\s\S]*)\1$/, '$2').trim() }
  return o;
}
function skillAt(dir, source, owner) {
  const f = path.join(dir, 'SKILL.md'), t = readT(f, 2e6), fm = t ? front(t) : null, name = fm?.name || path.basename(dir);
  return { name, dir, source, owner: owner || null, description: fm?.description || '', ok: !!t, front: !!fm, hasName: !!fm?.name, hasDesc: !!fm?.description,
    alwaysChars: (fm?.name || '').length + (fm?.description || '').length, invokeChars: t.length, mtime: mtime(f) };
}

// Static security scan: code files only (Markdown is instructions for Claude, not code that runs). Heuristic signals to review, not proof of harm.
const CODE = /\.(js|mjs|cjs|ts|py|sh|ps1|psm1|cmd|bat|lua|luau|rb|go)$/i, SKIPD = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', 'tests', 'test', 'examples', 'benchmarks', 'i18n']);
const SIG = { net: [/\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b|\bfetch\(|\bhttps?\.(get|request)\(|\brequests\.(get|post)\(|\burllib\b|\bnew WebSocket\(/, 'Network access'],
  exec: [/\bchild_process\b|\bexecSync\(|\bexecFile(Sync)?\(|\bspawn(Sync)?\(|\bsubprocess\.|\bos\.system\(|\bStart-Process\b|\beval\(/, 'Runs other programs'],
  del: [/\brm\s+-[a-z]*r[a-z]*f?\b|\bRemove-Item\b[^\n]*-Recurse|\bshutil\.rmtree\(|\bfs\.(rm|rmdir|unlink)(Sync)?\(|\bos\.remove\(/, 'Deletes files'],
  env: [/\bprocess\.env\b|\bos\.environ\b|\$env:|\.ssh[\\/]|credentials\.json|_API_KEY\b/, 'Reads environment or credentials'] };
const scanCache = new Map();
function scan(dir) {
  const key = dir + '|' + mtime(dir); if (scanCache.has(key)) return scanCache.get(key);
  const out = { files: 0, code: 0, bytes: 0, sig: {} }; let n = 0;
  const walk = (d, rel) => { for (const x of ls(d)) { if (n > 800) return; const p = path.join(d, x), r = rel ? rel + '/' + x : x; let s; try { s = fs.statSync(p) } catch { continue }
    if (s.isDirectory()) { if (!SKIPD.has(x)) walk(p, r); continue }
    n++; out.files++; out.bytes += s.size; if (!CODE.test(x) || s.size > 512e3) continue; out.code++;
    const lines = readT(p).split('\n');
    for (const [k, [re]] of Object.entries(SIG)) for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) { const g = out.sig[k] ??= { n: 0, at: [] }; g.n++; if (g.at.length < 3) g.at.push(`${r}:${i + 1}`) } } };
  walk(dir, '');
  scanCache.set(key, out); return out;
}
// Auto-run surface: hooks run on Claude Code events, MCP servers start as processes. These matter more than files that only run when asked.
function level(sc, hooks, mcp) {
  const s = Object.keys(sc?.sig || {});
  return (hooks || mcp) && s.some(k => k === 'net' || k === 'del') ? 'review' : s.length || hooks || mcp ? 'note' : 'clean';
}
function components(dir, man = {}) {
  const sk = ls(path.join(dir, 'skills'), true).filter(d => exists(path.join(dir, 'skills', d, 'SKILL.md')));
  const md = d => ls(path.join(dir, d)).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3));
  const hk = typeof man.hooks === 'object' ? man.hooks : readJ(path.join(dir, typeof man.hooks === 'string' ? man.hooks : 'hooks/hooks.json'), {});
  const mc = typeof man.mcpServers === 'object' ? man.mcpServers : readJ(path.join(dir, '.mcp.json'), {});
  const mcp = mc.mcpServers || mc;
  return { skills: sk, commands: md('commands'), agents: md('agents'), hooks: Object.keys(hk.hooks || hk || {}).filter(k => /^[A-Z]/.test(k)),
    mcp: Object.entries(mcp || {}).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => ({ name: k, cmd: [v.command, ...(v.args || [])].filter(Boolean).join(' ').slice(0, 160) || v.url || '' })) };
}
function gitHead(dir) { // marketplace clone HEAD commit, read from files (no git process)
  const h = readT(path.join(dir, '.git', 'HEAD')).trim(); if (hex(h)) return h;
  const ref = /^ref: (.+)$/.exec(h)?.[1]; if (!ref) return null;
  const f = readT(path.join(dir, '.git', ref)).trim(); if (hex(f)) return f;
  return new RegExp('^([0-9a-f]{40}) ' + ref.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '$', 'm').exec(readT(path.join(dir, '.git', 'packed-refs')))?.[1] || null;
}

function build() {
  const now = Date.now(), set = readJ(path.join(C, 'settings.json'), {}), enabled = set.enabledPlugins || {};
  const ip = readJ(path.join(P, 'installed_plugins.json'), {}).plugins || {}, km = readJ(path.join(P, 'known_marketplaces.json'), {});
  const cc = readJ(path.join(P, 'plugin-catalog-cache.json'), {}), cat = cc.catalog?.plugins || {}, model = cc.catalog?.models?.[0];
  const dir = readJ(path.join(P, 'plugin-directory-cache-v2.json'), {}), reviewed = new Map((dir.listings || []).map(l => [String(l.name).toLowerCase(), l.checks?.review?.state === 'done' && l.checks.review.by?.type === 'anthropic']));
  const issues = [], plugins = [], skills = [], catalog = [];
  const issue = (sev, item, text, fix) => issues.push({ sev, item, text, fix });

  // 1. Marketplace catalogs (local clones only). "Check for Updates" re-reads these; fetching new ones is Claude Code's job.
  const markets = {};
  for (const [m, v] of Object.entries(km)) {
    const loc = v.installLocation || path.join(P, 'marketplaces', m), mj = readJ(path.join(loc, '.claude-plugin', 'marketplace.json'));
    markets[m] = { name: m, updated: v.lastUpdated ? Date.parse(v.lastUpdated) : null, head: gitHead(loc), count: mj?.plugins?.length || 0, repo: v.source?.repo || v.source?.url || null, ok: !!mj };
    for (const e of mj?.plugins || []) {
      const id = `${e.name}@${m}`, c = cat[id], local = typeof e.source === 'string' ? path.resolve(loc, e.source) : null;
      const man = local ? readJ(path.join(local, '.claude-plugin', 'plugin.json'), readJ(path.join(local, 'plugin.json'), {})) : {};
      const comp = c ? { skills: c.components.skills.map(s => s.name), commands: c.components.commands.map(x => x.name || x), agents: c.components.agents.map(x => x.name || x),
        hooks: c.components.hooks.map(x => x.event || x.name || String(x)), mcp: c.components.mcpServers.map(x => ({ name: x.name || String(x), cmd: '' })) } : local ? components(local, man) : null;
      const src = typeof e.source === 'string' ? 'catalog repo' : e.source?.url || e.source?.repo || e.source?.source || 'unknown';
      catalog.push({ id, name: e.name, market: m, description: e.description || man.description || '', category: e.category || c?.marketplace_entry?.category || 'other',
        author: e.author?.name || man.author?.name || null, homepage: e.homepage || man.homepage || null, repo: e.source?.url || man.repository || (e.source?.repo ? 'https://github.com/' + e.source.repo : null),
        version: e.version || man.version || null, sha: e.source?.sha || null, installs: c?.unique_installs ?? null, updated: c?.last_updated ? Date.parse(c.last_updated) : null,
        tokens: c?.tokens?.[model] || null, components: comp, reviewed: reviewed.get(e.name.toLowerCase()) || false, external: typeof e.source !== 'string', source: src, lsp: e.lspServers ? Object.keys(e.lspServers) : [] });
    }
  }
  const byId = new Map(catalog.map(c => [c.id, c]));

  // 2. Installed Claude Code plugins.
  for (const [id, arr] of Object.entries(ip)) {
    const v = [].concat(arr)[0] || {}, [name, m] = id.split('@'), d = v.installPath, ok = !!d && exists(d);
    const man = ok ? readJ(path.join(d, '.claude-plugin', 'plugin.json'), readJ(path.join(d, 'plugin.json'), {})) : {};
    const comp = ok ? components(d, man) : { skills: [], commands: [], agents: [], hooks: [], mcp: [] }, sc = ok ? scan(d) : null, c = byId.get(id);
    let update = null;
    if (c && c.version && v.version && !hex(v.version) && c.version !== v.version) update = { from: v.version, to: c.version, kind: 'version' };
    else if (c?.sha && v.gitCommitSha && !c.sha.startsWith(v.gitCommitSha.slice(0, 12)) && !v.gitCommitSha.startsWith(c.sha.slice(0, 12))) update = { from: v.gitCommitSha.slice(0, 12), to: c.sha.slice(0, 12), kind: 'commit' };
    else if (c && !c.external && hex(v.version) && markets[m]?.head && !markets[m].head.startsWith(v.version)) update = { from: v.version, to: markets[m].head.slice(0, 12), kind: 'catalog', note: 'The catalog has a newer commit; this plugin\'s own files may be unchanged.' };
    const old = ok ? ls(path.dirname(d), true).filter(x => path.join(path.dirname(d), x) !== d) : [];
    plugins.push({ id, name, market: m, kind: 'plugin', version: v.version || man.version || '?', sha: v.gitCommitSha || null, path: d, ok, enabled: !!enabled[id],
      installed: Date.parse(v.installedAt) || null, updated: Date.parse(v.lastUpdated) || null, description: man.description || c?.description || '', author: man.author?.name || c?.author || null,
      homepage: man.homepage || c?.homepage || null, repo: (typeof man.repository === 'string' ? man.repository : man.repository?.url) || c?.repo || null, category: c?.category || null,
      reviewed: c?.reviewed || reviewed.get(name.toLowerCase()) || false, installs: c?.installs ?? null, tokens: c?.tokens || null, components: comp, scan: sc,
      risk: level(sc, comp.hooks.length, comp.mcp.length), update, oldVersions: old.length, scope: v.scope || 'user' });
    if (!ok) issue('high', id, 'Installed, but its folder is missing.', 'Reinstall it in Claude Code: /plugin install ' + id);
    if (!markets[m]) issue('low', id, `Its marketplace "${m}" is not in your local catalogs, so updates can't be checked.`, null);
    for (const s of comp.skills) skills.push({ ...skillAt(path.join(d, 'skills', s), 'plugin', id) });
  }
  for (const id of Object.keys(enabled)) if (enabled[id] && !ip[id]) issue('high', id, 'Enabled in settings.json but not installed.', 'Install it, or turn it off in Claude Code: /plugin');

  // 3. Claude desktop app plugins: the signed-in account = the app folder whose plugin manifest was updated last (other folders are old accounts/orgs).
  let acct = null;
  for (const a of ls(APPDIR, true)) for (const b of ls(path.join(APPDIR, a), true)) { const mf = readJ(path.join(APPDIR, a, b, 'rpm', 'manifest.json')); if (mf && (!acct || (mf.lastUpdated || 0) > acct.t)) acct = { a, b, t: mf.lastUpdated || 0, mf } }
  const app = new Map();
  for (const e of acct?.mf.plugins || []) {
    const d = path.join(APPDIR, acct.a, acct.b, 'rpm', e.id), man = readJ(path.join(d, '.claude-plugin', 'plugin.json'), readJ(path.join(d, 'plugin.json'), {})), name = man.name || e.displayName;
    if (exists(d) && name) app.set(name, { t: Date.parse(e.updatedAt) || 0, d, e, man });
  }
  for (const [name, { t, d, e, man }] of app) {
    const comp = components(d, man), sc = scan(d);
    plugins.push({ id: name + '@claude-app', name, market: e.marketplaceName || 'claude-app', kind: 'app plugin', version: man.version || '?', path: d, ok: true, enabled: null,
      installed: null, updated: t || null, description: man.description || '', author: man.author?.name || null, homepage: man.homepage || null, repo: null, category: null,
      reviewed: e.marketplaceName === 'anthropic-plugin-directory' && e.updatedAtVerified === true, installs: null, tokens: null, components: comp, scan: sc,
      risk: level(sc, comp.hooks.length, comp.mcp.length), update: null, oldVersions: 0, scope: 'Claude app', pref: e.installationPreference || null });
    for (const s of comp.skills) skills.push(skillAt(path.join(d, 'skills', s), 'app plugin', name + '@claude-app'));
  }

  // 4. Standalone skills: yours (~/.claude/skills) and the ones the Claude app syncs (newest copy per name).
  for (const s of ls(path.join(C, 'skills'), true)) if (s !== 'synced') skills.push(skillAt(path.join(C, 'skills', s), 'custom'));
  const syn = new Map();
  for (const g of ls(path.join(C, 'skills', 'synced'), true).filter(g => !acct || g === acct.b + '_' + acct.a)) for (const s of ls(path.join(C, 'skills', 'synced', g), true)) {
    const x = skillAt(path.join(C, 'skills', 'synced', g, s), 'synced'); if (!syn.has(x.name) || (syn.get(x.name).mtime || 0) < (x.mtime || 0)) syn.set(x.name, x);
  }
  skills.push(...syn.values());
  for (const s of skills) {
    s.scan = scan(s.dir); s.risk = level(s.scan, 0, 0);
    if (!s.ok) issue('high', s.name, 'Skill folder has no SKILL.md, so Claude Code cannot load it.', null);
    else if (!s.hasDesc) issue('medium', s.name, 'SKILL.md has no description in its front matter, so Claude cannot tell when to use it.', 'Add a description: line to the front matter.');
    else if (s.description.length > 1024) issue('medium', s.name, `Description is ${s.description.length} characters; Claude Code allows 1,024 and may cut it.`, 'Shorten the description.');
  }
  // Same skill name from two different sources: one issue per pair of owners (a plugin installed twice would otherwise list every skill).
  const seen = new Map(), dup = new Map();
  for (const s of skills) { const k = s.name.toLowerCase(), o = seen.get(k); if (!o) { seen.set(k, s); continue } const w = [o.owner || o.source, s.owner || s.source].sort().join(' and '); if (o.owner !== s.owner) (dup.get(w) || dup.set(w, []).get(w)).push(s.name) }
  // One tool, one entry: a plugin's same-named skill is the plugin itself, and a copy with the same name and description loaded from elsewhere is that plugin again.
  // The page lists the plugin once and shows the copies in its details. Nothing on disk changes; the issue below still reports copies Claude loads twice.
  const own = new Map(plugins.map(p => [p.id, p]));
  for (const s of skills) if (own.get(s.owner)?.name.toLowerCase() === s.name.toLowerCase()) s.same = s.owner;
  for (const s of skills) if (!s.owner) s.same = skills.find(k => k.same && k.name.toLowerCase() === s.name.toLowerCase() && k.description === s.description)?.same;
  for (const p of plugins) p.copies = skills.filter(s => s.same === p.id).map(s => ({ source: s.source, path: s.dir }));
  for (const [w, n] of dup) issue('medium', n.length > 1 ? `${n.length} skills` : n[0], `Loaded from two places (${w})${n.length > 1 ? ': ' + n.slice(0, 4).join(', ') + (n.length > 4 ? '…' : '') : ''}. Both copies are listed to Claude, so it may pick the older one and pays for both.`, 'Keep one copy: disable the plugin in Claude Code (/plugin) or in the Claude app.');

  // 5. Hooks in your settings.json (run a command on every matching event).
  const hooks = []; for (const [ev, arr] of Object.entries(set.hooks || {})) for (const h of arr) for (const c of h.hooks || []) hooks.push({ event: ev, matcher: h.matcher || '', cmd: String(c.command || '').slice(0, 200), timeout: c.timeout || null });

  for (const c of catalog) c.installed = plugins.some(p => p.id === c.id);
  return { at: now, model, account: acct ? acct.a.slice(0, 8) : null, catalogAt: cc.fetchedAt ? Date.parse(cc.fetchedAt) : null, markets: Object.values(markets), plugins, skills: skills.map(({ dir, ...s }) => ({ ...s, path: dir })), catalog, hooks, issues };
}
let cache = null;
module.exports = (refresh) => { if (refresh || !cache || Date.now() - cache.at > 60e3) cache = build(); return cache };
module.exports.front = front; module.exports.scan = scan; module.exports.level = level;
