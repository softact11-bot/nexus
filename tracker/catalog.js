// My Catalog for the NEXUS Plugins & Skills page: the plugins, skills and tools the user approved, saved in my-catalog.json.
// Starts empty. Adding an entry never installs anything; removing one never uninstalls anything.
// validate() reads a GitHub repo (API + raw files, no clone, nothing run) and works out what it is and how it installs:
// plugin marketplace → `claude plugin marketplace add` + `install`; standalone skill → copy into ~/.claude/skills;
// MCP server or external app → manual: NEXUS shows the repo's own instructions and never runs them.
const RED = require('./redact.js'); // M4c: home → ~ and secrets masked in logs, exports and error text (spec §26.8)
const fs = require('fs'), path = require('path');
const DATA = process.env.NEXUS_DATA || __dirname, FILE = path.join(DATA, 'my-catalog.json'), CACHE = path.join(DATA, 'repo-cache.json');
const ID = /^[a-z0-9][a-z0-9._-]{0,63}@[a-z0-9][a-z0-9._-]{0,63}$/i, NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i, PART = /^[\w.-]{1,100}$/;
const inv = r => require('./inv.js')(r);
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
const load = () => { const c = readJ(FILE, {}); return { items: c.items || [], decisions: c.decisions || {} } };
const save = c => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(c, null, 1)); fs.renameSync(FILE + '.tmp', FILE) }; // write-then-rename: a crash never leaves half a file

// The 11 repos the user sent as candidates (2026-10-14), with what research found. Candidates, not authorization: each needs its own approval.
const CANDIDATES = [
  ['DietrichGebert/ponytail', 'Same repo as your installed ponytail@ponytail.'],
  ['JuliusBrussee/caveman', 'You already have Caveman as a Claude app plugin: installing this too would load it twice.'],
  ['anthonybo/headroom', 'A Rust status-line app, NOT the Headroom large-file skill you have. Same name, different tool. Installs with curl | sh.'],
  ['rtk-ai/rtk', 'A Rust command-line proxy app, not a Claude plugin. Installs with brew or curl | sh.'],
  ['anthropics/skills', 'Official Anthropic marketplace. skill-creator overlaps with the one you have from claude-plugins-official.'],
  ['Graphify-Labs/graphify', 'You already have the graphify skill. The CLI is a Python package (uv tool install graphifyy).'],
  ['codenamev/claude_memory', 'Same plugin name as your installed claude-memory. Needs Ruby and the claude_memory gem.'],
  ['GaZmagik/claude-memory-plugin', 'No marketplace in this repo; its README says it installs from GaZmagik/enhance. Needs bun.'],
  ['Roblox/roblox-studio-agent-plugin', 'Official Roblox plugin. Same name as your installed roblox-studio@skills (third party).'],
  ['vo1dleaf/roblox-claude-kit', 'No license. Its README clones a repo from a different account (timasigmapro228).'],
  ['Nuos/blender-mcp', 'A fork with 0 stars. You already have two Blender MCP servers connected.']];

// "https://github.com/o/r", "github.com/o/r/tree/main/skills/x", "o/r" or a marketplace id "name@market".
function parse(s) {
  s = String(s || '').trim();
  if (ID.test(s)) return { kind: 'id', id: s };
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/tree\/([^/\s]+)((?:\/[^/\s]+)*))?\/?$/i.exec(s) || /^([^/\s@:]+)\/([^/\s@:]+)$/.exec(s);
  if (!m) return { error: 'Not a GitHub link, owner/repo or plugin id (name@marketplace). Other sources aren\'t supported yet.' };
  const [, o, r, ref = null, sub = ''] = m, p = sub.replace(/^\//, '');
  if (!PART.test(o) || !PART.test(r) || (ref && !PART.test(ref)) || p.split('/').some(x => x && (!PART.test(x) || x === '..' || x === '.'))) return { error: 'That link has characters a GitHub repo can\'t have.' };
  return { kind: 'github', repo: o + '/' + r, ref, path: p };
}

const gh = async (u, raw) => {
  const r = await fetch(u, { headers: { 'user-agent': 'nexus-tracker', accept: raw ? '*/*' : 'application/vnd.github+json' }, signal: AbortSignal.timeout(15e3) });
  if (r.status === 404) return null;
  const reset = +r.headers.get('x-ratelimit-reset'), at = reset ? ' after ' + new Date(reset * 1e3).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ' later';
  if (!r.ok) throw Error(r.status === 403 || r.status === 429 ? `GitHub's limit for checks without sign-in (60 an hour) is used up. Try again${at}. Repos checked before stay available for a day.` : 'GitHub answered HTTP ' + r.status);
  return raw ? r.text() : r.json();
};
const front = t => require('./inv.js').front(t) || {};
// Lines in a README that install or run something, shown to the user word for word. Never executed.
const INST = /(^|\s)(curl|wget|irm|iwr|brew|npm|npx|pnpm|bun|bunx|pip|pipx|uv|uvx|gem|cargo|go install|git clone|claude (plugin|mcp)|\/plugin)\b/;
const PIPE = /(curl|wget|irm|iwr|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]*\|\s*(sh|bash|zsh|iex|Invoke-Expression|pwsh|powershell)\b/i;
function readmeFacts(md, repo) {
  const lines = [], fences = md.match(/```[\s\S]*?```/g) || [];
  for (const f of fences) for (const l of f.split('\n').slice(1, -1)) { const t = l.trim().replace(/^\$\s*/, ''); if (t && INST.test(t) && t.length < 240 && !lines.includes(t)) lines.push(t) }
  const [o, r] = repo.toLowerCase().split('/'), other = [...md.matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)/gi)].map(x => [x[1].toLowerCase(), x[2].toLowerCase().replace(/\.git$|\.$/, '')]).find(([a, b]) => b === r && a !== o);
  const deps = [['bun', /\bbun(x)?\b/i], ['Ruby gem', /\bgem install\b|\bruby\b/i], ['Python (uv / pip)', /\buvx?\b|\bpipx?\b/i], ['Node.js (npm)', /\bnpm\b|\bnpx\b|\bnode\b/i], ['Rust (cargo)', /\bcargo\b/i], ['Homebrew', /\bbrew\b/i], ['Blender', /\bblender\b/i], ['Roblox Studio', /roblox studio/i]]
    .filter(([, re]) => lines.some(l => re.test(l)) || (re.source.includes('blender') || re.source.includes('roblox')) && re.test(md.slice(0, 4000))).map(([n]) => n);
  return { lines: lines.slice(0, 12), pipe: lines.filter(l => PIPE.test(l)), other: other ? other.join('/') : null, deps };
}
// What a folder of the repo would add, read from the file list (nothing downloaded).
function compOf(files, base) {
  const b = base ? base.replace(/\/$/, '') + '/' : '', rel = files.filter(f => f.startsWith(b)).map(f => f.slice(b.length));
  return { skills: rel.filter(f => /^skills\/[^/]+\/SKILL\.md$/.test(f)).map(f => f.split('/')[1]), commands: rel.filter(f => /^commands\/[^/]+\.md$/.test(f)).map(f => f.slice(9, -3)),
    agents: rel.filter(f => /^agents\/[^/]+\.md$/.test(f)).map(f => f.slice(7, -3)), hooks: rel.includes('hooks/hooks.json'), mcp: rel.includes('.mcp.json'),
    code: rel.filter(f => /\.(js|mjs|cjs|ts|py|sh|ps1|rb|go|rs|lua|luau)$/i.test(f)).length, scripts: rel.filter(f => /(^|\/)(install|setup)[^/]*\.(sh|ps1|bat|cmd)$/i.test(f)) };
}

// Read a repo and decide type + install method. Result is cached for a day (GitHub allows 60 unauthenticated API calls an hour).
async function inspect(repo, ref, sub) {
  const cache = readJ(CACHE, {}), ck = [repo, ref || '', sub || ''].join('|').toLowerCase();
  if (cache[ck] && Date.now() - cache[ck].at < 864e5) return cache[ck];
  const meta = await gh('https://api.github.com/repos/' + repo);
  if (!meta) throw Error(`github.com/${repo} doesn't exist or is private.`);
  const br = ref || meta.default_branch, R = `https://raw.githubusercontent.com/${meta.full_name}/${br}/`;
  const tree = await gh(`https://api.github.com/repos/${meta.full_name}/git/trees/${encodeURIComponent(br)}?recursive=1`), files = (tree?.tree || []).filter(x => x.type === 'blob').map(x => x.path);
  if (!tree) throw Error(`Branch or tag "${br}" not found in ${meta.full_name}.`);
  const b = sub ? sub + '/' : '', has = f => files.includes(b + f), get = f => gh(R + b + f, true).catch(() => null);
  const readme = files.find(f => new RegExp('^' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 'readme\\.md$', 'i').test(f)) || files.find(f => /^readme\.md$/i.test(f));
  const md = readme ? await gh(R + readme, true).catch(() => '') || '' : '', rf = readmeFacts(md, meta.full_name);
  const out = { at: Date.now(), repo: meta.full_name, ref: br, path: sub || '', url: meta.html_url + (sub ? `/tree/${br}/${sub}` : ''), owner: { login: meta.owner.login, type: meta.owner.type },
    description: meta.description || '', license: meta.license?.spdx_id && meta.license.spdx_id !== 'NOASSERTION' ? meta.license.spdx_id : null, stars: meta.stargazers_count, fork: meta.fork ? meta.parent?.full_name || 'unknown' : null,
    archived: meta.archived, pushed: Date.parse(meta.pushed_at) || null, readme: readme ? `${meta.html_url}/blob/${br}/${readme}` : null, install: rf.lines, pipe: rf.pipe, otherRepo: rf.other, deps: rf.deps, files: files.length, items: [] };
  const mj = has('.claude-plugin/marketplace.json') ? JSON.parse(await get('.claude-plugin/marketplace.json') || 'null') : null;
  if (mj?.name && NAME.test(mj.name) && Array.isArray(mj.plugins)) {
    out.market = mj.name;
    for (const p of mj.plugins) if (p?.name && NAME.test(p.name)) { const local = typeof p.source === 'string' ? path.posix.normalize(b + p.source.replace(/^\.\//, '')).replace(/^\.$/, '') : null;
      const comp = local != null ? compOf(files, local) : null; if (comp && Array.isArray(p.skills)) comp.skills = p.skills.map(s => path.posix.basename(String(s))); // entry lists its own skills (several plugins sharing one folder)
      out.items.push({ type: 'plugin', method: 'plugin', name: p.name, id: p.name + '@' + mj.name, description: p.description || '', version: p.version || null, comp, external: local == null }) }
  } else if (has('.claude-plugin/plugin.json')) {
    const pj = JSON.parse(await get('.claude-plugin/plugin.json') || '{}');
    out.items.push({ type: 'plugin', method: 'none', name: pj.name || meta.name, description: pj.description || '', version: pj.version || null, comp: compOf(files, sub),
      why: 'This repo has a plugin but no marketplace, so Claude Code can\'t install it from here. Ask the publisher which marketplace lists it, then add that.' });
  }
  if (!out.items.length) { // standalone skills: SKILL.md at the root, in skills/<name>/ or one level down
    const sk = files.filter(f => f.startsWith(b) && /(^|\/)SKILL\.md$/.test(f) && f.slice(b.length).split('/').length <= 3 && !/(^|\/)(node_modules|\.git|tests?|examples?)\//.test(f));
    for (const f of sk.slice(0, 20)) { const dir = f.slice(0, -9).replace(/\/$/, ''), fm = front(await get(f.slice(b.length)) || '');
      const name = NAME.test(fm.name || '') ? fm.name : path.posix.basename(dir || meta.name);
      if (NAME.test(name)) out.items.push({ type: 'skill', method: 'skill', name, dir, description: fm.description || '', version: null, comp: compOf(files, dir) }) }
  }
  if (!out.items.length) { const mcp = has('.mcp.json') || rf.lines.some(l => /claude mcp add|mcp-server|\bmcp\b/i.test(l)) || /\bmcp\b/i.test(meta.name);
    out.items.push({ type: mcp ? 'mcp' : 'app', method: 'manual', name: meta.name, description: meta.description || '', version: null, comp: compOf(files, sub),
      why: mcp ? 'An MCP server: added with claude mcp add using the repo\'s own command, which NEXUS shows but doesn\'t run.' : 'Not a Claude plugin or skill: a separate app with its own installer. NEXUS shows the official steps and never runs them.' }) }
  out.findings = findings(out); cache[ck] = out;
  for (const k in cache) if (Date.now() - cache[k].at > 864e5) delete cache[k];
  try { fs.writeFileSync(CACHE, JSON.stringify(cache)) } catch { }
  return out;
}
// Security and trust notes. Signals to read, not a verdict on the code.
function findings(o) {
  const F = [], add = (lvl, t) => F.push({ lvl, t }), c = o.items[0]?.comp || {};
  add(o.owner.type === 'Organization' ? 'ok' : 'note', `Publisher: ${o.owner.login} (${o.owner.type === 'Organization' ? 'organization' : 'personal account'})${o.stars != null ? ` · ${o.stars} star${o.stars === 1 ? '' : 's'}` : ''}`);
  add(o.license ? 'ok' : 'warn', o.license ? 'License: ' + o.license : 'No license: you may not have the right to use or copy it');
  if (o.fork) add('warn', `Fork of ${o.fork}: prefer the original unless you know what this fork changed`);
  if (o.archived) add('warn', 'Archived by its owner: no more updates');
  if (o.otherRepo) add('warn', `README installs from a different account (${o.otherRepo}), not ${o.repo}`);
  for (const l of o.pipe) add('bad', `README pipes a download straight into a shell: ${l}. That runs whatever the server sends, unseen. NEXUS never runs it`);
  if (o.items.some(i => i.comp?.hooks)) add('warn', 'Has hooks: runs commands automatically on Claude Code events');
  if (o.items.some(i => i.comp?.mcp)) add('warn', 'Starts an MCP server process');
  const code = o.items.reduce((a, i) => a + (i.comp?.code || 0), 0); if (code) add('note', `${code} code file${code === 1 ? '' : 's'} in what it installs`);
  if (c.scripts?.length) add('warn', 'Install scripts in the repo: ' + c.scripts.slice(0, 3).join(', '));
  return F;
}

// Same thing already installed or already in the catalog? Matches by id, then by name across marketplaces.
function related(it, C = load()) {
  const I = inv(false), n = it.name.toLowerCase(), out = [];
  if (it.id && I.plugins.some(p => p.id === it.id)) out.push({ lvl: 'ok', t: 'Already installed: ' + it.id });
  for (const p of I.plugins) if (p.id !== it.id && p.name.toLowerCase() === n) out.push({ lvl: 'warn', t: `Same name as installed ${p.id}${p.kind === 'plugin' ? '' : ' (Claude app)'}: both would load` });
  for (const s of I.skills) if (s.name.toLowerCase() === n && !(it.id && s.owner === it.id)) { out.push({ lvl: 'warn', t: `Same name as your skill "${s.name}" (${s.owner || s.source})` }); break }
  for (const sk of it.comp?.skills || []) { const s = I.skills.find(x => x.name.toLowerCase() === sk.toLowerCase() && x.owner !== it.id); if (s) out.push({ lvl: 'warn', t: `Skill "${sk}" clashes with yours from ${s.owner || s.source}` }) }
  return out;
}
const keyOf = it => it.id ? 'plugin:' + it.id.toLowerCase() : `${it.type}:${it.repo.toLowerCase()}${it.dir ? '/' + it.dir.toLowerCase() : ''}`;

// Everything the page needs to show a source before adding it. Plugin ids already in a local catalog need no network.
async function validate({ source }) {
  const s = parse(source); if (s.error) return { res: s.error };
  if (s.kind === 'id') {
    const c = inv(true).catalog.find(x => x.id.toLowerCase() === s.id.toLowerCase());
    if (!c) return { res: `${s.id} isn't in your local marketplace catalogs. Add its marketplace by GitHub link instead.` };
    const it = { type: 'plugin', method: 'plugin', name: c.name, id: c.id, description: c.description, version: c.version, comp: c.components ? { ...c.components, hooks: !!c.components.hooks?.length, mcp: !!c.components.mcp?.length } : null, local: true };
    const r = { repo: c.repo?.replace(/^https:\/\/github\.com\//, '') || null, url: c.repo || c.homepage, market: c.market, owner: { login: c.author || c.market, type: 'catalog' }, license: null, description: c.description, items: [it], install: [], deps: [],
      findings: [{ lvl: c.reviewed ? 'ok' : 'note', t: c.reviewed ? 'Anthropic-reviewed in the plugin directory' : 'Not marked as Anthropic-reviewed' }, { lvl: 'ok', t: `Listed in your local catalog ${c.market}` }] };
    return finish(r);
  }
  try { return finish(await inspect(s.repo, s.ref, s.path)) } catch (e) { return { res: RED(e.message) } }
}
function finish(r) {
  const C = load(); r.items = r.items.map(it => { const x = { ...it, repo: r.repo, market: r.market || null }; x.key = keyOf(x); x.inCatalog = C.items.some(e => e.key === x.key); x.related = related(x, C); return x });
  return { res: 'ok', repo: r };
}
// Add one item of a validated source. The server checks it again: the page only says which source and which item.
async function add({ source, name, from, note }) {
  const v = await validate({ source }); if (v.res !== 'ok') return v;
  const it = v.repo.items.find(i => i.name === name) || (v.repo.items.length === 1 ? v.repo.items[0] : null); if (!it) return { res: 'Pick which item of this repo to add.' };
  const C = load(); if (C.items.some(e => e.key === it.key)) return { res: `${it.name} is already in My Catalog.` };
  const r = v.repo;
  C.items.unshift({ key: it.key, type: it.type, method: it.method, name: it.name, id: it.id || null, repo: r.repo, ref: r.ref || null, dir: it.dir ?? null, market: r.market || null, url: r.url || null,
    publisher: r.owner, license: r.license || null, description: it.description || r.description || '', version: it.version || null, comp: it.comp || null, why: it.why || null,
    install: r.install || [], deps: r.deps || [], findings: [...(r.findings || []), ...it.related], readme: r.readme || null, added: Date.now(), from: ['url', 'id', 'review', 'discover'].includes(from) ? from : 'url', note: String(note || '').slice(0, 200) });
  if (r.repo && from === 'review') C.decisions[r.repo.toLowerCase()] = { state: 'approved', at: Date.now() };
  save(C); return { res: 'ok', key: it.key };
}
function remove({ key }) { const C = load(), n = C.items.length; C.items = C.items.filter(e => e.key !== key); if (C.items.length === n) return { res: 'Not in My Catalog.' }; save(C); return { res: 'ok' } }
function decide({ repo, state }) {
  if (!CANDIDATES.some(([r]) => r.toLowerCase() === String(repo).toLowerCase()) || !['skipped', 'rejected', 'pending'].includes(state)) return { res: 'bad request' };
  const C = load(); if (state === 'pending') delete C.decisions[repo.toLowerCase()]; else C.decisions[repo.toLowerCase()] = { state, at: Date.now() }; save(C); return { res: 'ok' };
}
const status = () => { const C = load(); return { ...C, candidates: CANDIDATES.map(([repo, note]) => ({ repo, note, decision: C.decisions[repo.toLowerCase()] || null, added: C.items.filter(e => e.repo?.toLowerCase() === repo.toLowerCase()).map(e => e.key) })) } };
const OPS = { validate, add, remove, decide };
module.exports = { status, post: o => Object.hasOwn(OPS, o?.op) ? OPS[o.op](o) : { res: 'unknown op' }, parse, load, keyOf, readmeFacts, CANDIDATES, FILE };
