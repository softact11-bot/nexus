// Plugins & Skills marketplace. Three places: Installed (what is really on this PC), My Catalog (only what you approved: starts empty,
// saved in my-catalog.json, never auto-filled) and Discover (suggestions from your local marketplace catalogs, never added for you).
// Add Plugin / Add Skill check a GitHub repo or plugin id first (tracker /api/catalog). Install is offered only for catalog entries that are
// approved, compatible and installable here: a preview of the exact steps, your confirmation, a one-time token, then the result is verified
// on disk (tracker /api/plugin). MCP servers and external apps are manual: NEXUS shows their official steps and never runs them.
import { tok, esc, chip, ago, bytes } from '../fmt.js';
import { icon, seg, stateBox, kpi, setKpi, toast, MORE, more as lm, errBox } from '../ui.js';
import { poll, retryText } from '../api.js';
import * as P from '../settings.js';

const TABS = [['installed', 'Installed'], ['catalog', 'My Catalog'], ['discover', 'Discover'], ['review', 'Review Candidates'], ['updates', 'Updates'], ['security', 'Security']];
const CATC = { development: ['#31D67A', 'i-code'], productivity: ['#5AB8F2', 'i-bolt'], security: ['#FF7A6B', 'i-shield'], database: ['#F2B544', 'i-db'], design: ['#E58BFF', 'i-spark'],
  monitoring: ['#4FE0C6', 'i-pulse'], gamedev: ['#31D67A', 'i-roblox'], deployment: ['#A2F7C5', 'i-arrow-up'], automation: ['#5AB8F2', 'i-flow'], learning: ['#F2B544', 'i-book'], skill: ['#C48BFF', 'i-book'],
  mcp: ['#4FE0C6', 'i-chip'], app: ['#F2B544', 'i-term'] };
const cc = c => CATC[c] || ['#8FA89A', 'i-puzzle'];
// Icon from what the tool is about (name first, then description); falls back to its category icon.
const ICONS = [[/roblox|luau|rojo/, 'i-roblox'], [/blender|\b3d\b|mesh/, 'i-cube'], [/graph/, 'i-graph'], [/memory|obsidian|notes?\b|knowledge/, 'i-book'], [/secur|vuln|audit|semgrep/, 'i-shield'],
  [/test|eval|playwright/, 'i-flask'], [/database|sql|postgres|mongo|supabase|redis/, 'i-db'], [/design|frontend|figma|\bui\b/, 'i-spark'], [/deploy|vercel|netlify|aws|docker|cloud/, 'i-arrow-up'],
  [/monitor|sentry|observab|logs?\b/, 'i-pulse'], [/token|context|compress|caveman|ponytail|headroom|optimi|rtk/, 'i-gauge'], [/automat|workflow|agent/, 'i-flow'], [/terminal|shell|\bcli\b/, 'i-term'], [/git|code|lint|review|lsp/, 'i-code']];
const icOf = (name, desc, cat) => { const n = String(name).toLowerCase(), d = String(desc || '').toLowerCase().slice(0, 120); return (ICONS.find(([re]) => re.test(n)) || ICONS.find(([re]) => re.test(d)) || [0, cc(cat)[1]])[1]; };
const RISK = { clean: ['ok', 'No signals', 'No network, process, delete or credential code found, and nothing runs automatically.'], note: ['est', 'Review notes', 'Has code that runs programs, uses the network, deletes files or reads the environment, or it runs automatically (hooks, MCP server). Normal for many tools: check the details.'],
  review: ['warn', 'Review', 'Runs automatically (hooks or MCP server) AND has network or delete code. Worth a look before trusting it.'] };
// Compatibility status shown everywhere. None of them is a safety guarantee.
const ST = { ok: ['ok', 'Compatible', 'Passed the checks NEXUS can run (files, settings, name clashes). Not proof that it is safe or bug-free.'], warn: ['warn', 'Warning', 'Works, but something needs attention: a clash, a duplicate, a missing license or a catalog problem.'],
  bad: ['bad', 'Incompatible', 'Can\'t be installed or loaded as it is: files missing, no marketplace, or a folder with the same name is in the way.'], unk: ['unk', 'Unknown', 'Not enough data to check: no component list.'],
  rev: ['rev', 'Needs review', 'Runs automatically (hooks or MCP servers) or its instructions pipe a download into a shell. Read the findings before trusting it.'],
  man: ['unk', 'Manual install', 'An app or MCP server: NEXUS shows its official install steps and never runs them for you.'] };
const SIGN = { net: 'Network access', exec: 'Runs other programs', del: 'Deletes files', env: 'Reads environment or credentials' };
const SRC = { custom: 'Your skill', synced: 'Claude app (synced)', plugin: 'Plugin skill', 'app plugin': 'Claude app plugin' };
const TYPE = { plugin: 'Plugin', skill: 'Skill', mcp: 'MCP server', app: 'External app' };
const METHOD = { plugin: ['Claude Code plugin', 'claude plugin marketplace add (if new) + claude plugin install'], skill: ['Standalone skill', 'downloaded with git, copied into ~/.claude/skills/<name>'],
  manual: ['Manual', 'NEXUS shows the official steps; you run them yourself'], none: ['Not installable here', 'a plugin without a marketplace: Claude Code can\'t install it from this repo'] };
const GOALS = [['roblox', 'Roblox', /roblox|luau|rojo/], ['blender', 'Blender & 3D', /blender|\b3d\b|mesh|modell?ing/], ['opt', 'Claude Code optimization', /token|context window|compress|optimi[sz]|caching|cost/],
  ['memory', 'Memory', /memory|obsidian|knowledge base|remember|notes/], ['graph', 'Graphify & graphs', /graph/], ['skills', 'Skill development', /skill|plugin dev|evals?\b|prompt/]];
const VERB = { install: ['Install', 'i-arrow-down', 'Installing'], update: ['Update', 'i-undo', 'Updating'], enable: ['Enable', 'i-check', 'Enabling'], disable: ['Disable', 'i-x', 'Disabling'], uninstall: ['Uninstall', 'i-x', 'Uninstalling'] };
const DEC = { approved: ['ok', 'Approved'], skipped: ['unk', 'Skipped'], rejected: ['warn', 'Rejected'] };
let root, last = null, inv = null, err = null, mine = { items: [], decisions: {}, candidates: [] }, ops = { job: null, history: [], states: {} }, skUp = null;
let tab = 'installed', sel = null, dsub = 'overview', goal = 'all', q = '', fc = 'all', ft = 'all', fs = 'all', sort = 'pop', pg = 0, per = 12, loading = false, drawn = '', poller = null;
const $ = id => root?.querySelector('#' + id);
let netDown = false, appDown = false, down = false, shownEB = '', lost = 0; // D3 B88/B89: down = the app poll or this page's own requests can't reach the tracker
const NET = 'Tracker not reachable', OFF = 'The tracker is not reachable. This works again once it answers.';
const LOCK = ['op', 'add', 'check', 'additem', 'decide', 'rmok', 'skup', 'confirm', 'addid', 'rm', 'cancel'].map(a => `[data-a="${a}"]`).join(', '); // changes; navigation is never locked
// B90: a plain sentence instead of a raw tracker code
const why = r => r === NET ? 'Tracker not reachable, so nothing was changed. Start it with node ~/.claude/token-tracker/tracker.js serve, then try again.'
  : /^(HTTP \d+|bad request|unknown op|unknown action)$/.test(r || '') ? 'The tracker did not accept this request, so nothing was changed. Press Check for Updates, then try again.'
  : `${String(r || 'Unknown problem').replace(/^./, c => c.toUpperCase()).replace(/\.$/, '')}. Nothing was changed.`;
const RO = { tokens: 'None: this page uses no AI tokens.', files: 'None: reading only.', privacy: 'Stays on this PC.', load: 'Light: local files only.' };
Object.assign(MORE, {
  'pl-page': { area: 'Plugins & Skills', title: 'What this page does', what: 'Three places: Installed is what is really on this PC, My Catalog holds only what you approved, Discover suggests tools from the marketplace catalogs already on this PC.',
    when: ['Seeing what is installed and what it costs.', 'Adding, installing, updating or removing a plugin or skill.'], impact: RO, notes: ['Nothing is added, installed or removed without a preview and your confirmation.', 'Check for Updates re-reads everything on this PC; it asks no server.'], tech: 'GET /api/inv (inv.js), GET /api/plugin (pluginops.js), GET /api/catalog (catalog.js).' },
  'pl-inst': { area: 'Plugins & Skills', title: 'Installed plugins and skills', what: 'Plugins are read from installed_plugins.json (Claude Code) and the Claude app plugin folder for your signed-in account. Skills are every SKILL.md Claude Code can load: ~/.claude/skills, synced Claude app skills and skills inside installed plugins.',
    when: ['Checking what loads in your sessions.'], impact: RO, notes: ['Claude app plugins are installed, updated and removed in the Claude app, not here.', 'A skill loaded from two places is listed once and flagged under Security.'], tech: 'inv.js: installed_plugins.json, settings.json enabledPlugins, skills folders.' },
  'pl-cat': { area: 'Plugins & Skills', title: 'My Catalog', what: 'Only the plugins and skills you approved. It starts empty and is never filled for you; it is saved in my-catalog.json in the tracker folder.',
    when: ['Keeping a short list of tools you trust before installing them.'], impact: { ...RO, files: 'Adding or removing changes my-catalog.json only.' }, notes: ['Install shows only for entries that are compatible and that NEXUS can install here.', 'Remove from Catalog never uninstalls anything.'], tech: 'POST /api/catalog {op: add | remove | decide | validate}.' },
  'pl-disc': { area: 'Plugins & Skills', title: 'Discover', what: 'Every plugin in your local marketplace catalogs that you do not have, best matches for your work areas first. The match is a keyword rule, not a quality rating.',
    when: ['Looking for a tool for Roblox, Blender, memory, graphs, token savings or skill work.'], impact: RO, notes: ['"Overlaps with yours" means you already have something for the same work.', 'Add to Catalog only approves it; installing is a separate step you confirm.'], tech: 'inv.catalog filtered by installed, GOALS keyword rules.' },
  'pl-rev': { area: 'Plugins & Skills', title: 'Review Candidates', what: 'Links you sent are candidates, not approvals. Review reads the repo on GitHub and lists what it holds and what NEXUS found; nothing is downloaded or run.',
    when: ['Going through suggested repos one by one.'], impact: { ...RO, privacy: 'Review asks GitHub for the repo details.' }, notes: ['Approve adds one item to My Catalog. Skip and Reject add nothing; Undo decision resets it.'], tech: 'POST /api/catalog {op: validate | decide}.' },
  'pl-upd': { area: 'Plugins & Skills', title: 'Updates', what: 'Installed plugins are compared with your local marketplace catalogs (no network). Skills NEXUS installed are compared with their repo when you press Check skills (git ls-remote, read only).',
    when: ['Seeing what is out of date.'], impact: RO, notes: ['"Catalog newer" can mean a newer commit with unchanged files.', 'Nothing updates on its own: each update shows a preview first. Restart Claude Code to load new versions.'], tech: 'inv.plugins[].update; POST /api/plugin {op: skillUpdates}.' },
  'pl-st': { area: 'Plugins & Skills', title: 'Compatibility status', what: 'Compatible, Warning, Incompatible, Unknown, Needs review and Manual install come from the checks NEXUS can run: files, settings, name clashes, hooks and MCP servers. Findings are High (stops something working), Medium (confusion or wasted tokens) or Low.',
    when: ['Deciding what to fix first.'], impact: RO, notes: ['None of these statuses is a safety guarantee.'], tech: 'inv.issues + stOf() in plugins.js.' },
  'pl-scan': { area: 'Plugins & Skills', title: 'Static scan', what: 'Reads the code files of installed plugins and your skills for network access, running other programs, deleting files and reading the environment, and lists what runs automatically (hooks, MCP servers).',
    when: ['Checking a tool before trusting it.'], impact: RO, notes: ['It does not run code. No signals is not proof that a tool is safe.'], tech: 'inv.js scan: pattern counts per file type.' },
  'pl-cost': { area: 'Plugins & Skills', title: 'Startup cost', what: 'Tokens a tool adds to every session through the skill list. A number from a marketplace catalog is its own count; a ~ number is an estimate: name + description characters ÷ 4.',
    when: ['Finding tools that cost tokens every session.'], impact: RO, notes: ['Sessions used and uses come from your own logs.', 'This is not plan usage.'], tech: 'catalog tokens.always_on / on_invoke, or (description chars + 40) ÷ 4.' },
  'pl-ops': { area: 'Plugins & Skills', title: 'How install, update and uninstall work', what: 'Each action opens a preview with the exact steps. Confirming gives a one-time token valid for 2 minutes; the local tracker then runs the official Claude Code CLI (plugins) or git (skills) and checks the result on disk.',
    when: ['Before installing, updating, enabling, disabling or uninstalling.'], impact: { tokens: 'None.', files: 'Changes your Claude Code plugin or skill folders and settings.json, as the preview says.', privacy: 'Downloads from the plugin\'s marketplace or the skill\'s repo.', load: 'Short: one download.' },
    notes: ['Hide closes the window; the job keeps running. Cancel stops it.', 'If the tracker stops answering during a job, the outcome stays unknown until it answers again; it is not shown as failed.', 'Uninstalled skills are moved to removed-skills/ in the tracker folder.'], tech: 'POST /api/plugin {op: prepare → run(token) → status}.' },
  'pl-hist': { area: 'Plugins & Skills', title: 'History', what: 'Installs, updates, enables, disables and uninstalls done through NEXUS, newest first, with the result: Done · verified, failed or cancelled.',
    when: ['Checking what changed and when.'], impact: RO, notes: ['Changes made in Claude Code or the Claude app directly are not listed.'], tech: 'pluginops.js history (GET /api/plugin).' },
  'pl-imp': { area: 'Plugins & Skills', title: 'Improve', what: 'Rule-based ideas for a skill: missing or long descriptions, a large SKILL.md and no use in your logs. Each idea comes with a prompt you can give Claude.',
    when: ['Making a skill cheaper or easier for Claude to pick.'], impact: RO, notes: ['Nothing is edited here. Claude shows a diff before saving anything.'], tech: 'recsFor() in plugins.js.' } });
const day = t => t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const n1 = n => n == null ? '—' : tok(n);
const keyOf = n => String(n || '').toLowerCase().trim().split(/[:@]/)[0].trim();
const sevChip = s => `<span class="chip ${s === 'high' ? 'warn' : s === 'medium' ? 'est' : 'unk'}">${s}</span>`;
const riskChip = r => `<span class="chip ${RISK[r][0]}" data-tip="${esc(RISK[r][2] + ' Static scan of code files: a heuristic to guide review, not proof of harm.')}">${RISK[r][1]}</span>`;
const stTag = s => `<span class="tg st-${ST[s][0]}" data-tip="${esc(ST[s][2])}"><i></i>${ST[s][1]}</span>`;
const LV = { ok: ['ok', 'i-check'], note: ['ok', 'i-bolt'], warn: ['no', 'i-bolt'], bad: ['no', 'i-x'] };
const finds = F => `<div class="px-chk">${F.map(f => `<div class="${LV[f.lvl]?.[0] || 'no'} px-f-${f.lvl}">${icon(LV[f.lvl]?.[1] || 'i-bolt')}<span>${esc(f.t)}</span></div>`).join('')}</div>`;
const cli = p => p?.kind === 'plugin';
const ghLink = r => r ? `<a href="https://github.com/${esc(r)}" target="_blank" rel="noopener noreferrer">${esc(r)}</a>` : '';

export function mount(el, params = []) {
  root = el; tab = TABS.some(t => t[0] === params[0]) ? params[0] : TABS.some(t => t[0] === P.pref('pl.tab')) ? P.pref('pl.tab') : 'installed'; // default tab: Settings → Plugins & Skills
  el.innerHTML = `<div class="pg enter">
  <header class="pg-h" style="--i:0">
    <span class="tile-ic pg-ic">${icon('i-puzzle')}</span>
    <div class="pg-t"><h1>Plugins &amp; Skills</h1><p>Your installed tools, the ones you approved, and suggestions. Nothing is added, installed or removed without your confirmation.</p></div>
    <div class="end"><span class="muted sm" id="x-at"></span>
    <button class="btn" data-a="refresh" data-tip="Re-reads installed plugins, skills, your catalog and the local marketplace catalogs now. No network.">${icon('i-undo')}Check for Updates</button>
    <button class="btn" data-a="history" id="x-hist" data-tip="Installs, updates, enables, disables and uninstalls done through NEXUS.">${icon('i-clock')}History</button>${lm('pl-hist', 'History')}
    <button class="btn px-add" data-a="add" data-v="skill" data-tip="Add a skill to My Catalog from a GitHub link. Nothing is installed yet.">${icon('i-book')}Add Skill</button>
    <button class="btn pri px-add" data-a="add" data-v="plugin" data-tip="Add a plugin to My Catalog from a GitHub link or plugin id. Nothing is installed yet.">${icon('i-puzzle')}Add Plugin</button>${lm('pl-page', 'Plugins & Skills')}</div>
  </header>
  <div id="x-err"></div>
  <div class="kpis k5" style="--i:1">${kpi('x-pl', 'i-layers', 'Installed Plugins ' + lm('pl-inst', 'Installed plugins and skills'))}${kpi('x-sk', 'i-book', 'Installed Skills')}${kpi('x-my', 'i-check', 'In My Catalog ' + lm('pl-cat', 'My Catalog'))}${kpi('x-up', 'i-undo', 'Updates Available ' + lm('pl-upd', 'Updates'))}${kpi('x-co', 'i-shield', 'Compatibility Issues ' + lm('pl-st', 'Compatibility status'))}</div>
  <div class="pgrid r-ws px-l enter"><section class="card ws px-ws" style="--i:2"><nav class="otabs" id="x-tabs"></nav><div id="x-job"></div><div id="x-body"></div></section><aside class="card px-det" id="x-det" style="--i:3"></aside></div>
  <dialog class="lx-dlg px-dlg" id="x-dlg" aria-labelledby="x-dlg-t"></dialog>
</div>`;
  const pgEl = el.querySelector('.pg');
  pgEl.addEventListener('click', onClick); pgEl.addEventListener('input', onInput); pgEl.addEventListener('change', onInput);
  pgEl.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.px-c, tr[data-a]')) { e.preventDefault(); e.target.click(); } // U2: Space too
    if (/^Arrow(Left|Right)$/.test(e.key) && e.target.closest('.px-dt')) { const B = [...e.target.parentNode.children], n = B[(B.indexOf(e.target) + (e.key === 'ArrowRight' ? 1 : B.length - 1)) % B.length]; dsub = n.dataset.v; detail(); $('x-dt-' + dsub)?.focus(); } // U4
    if (e.key === 'Enter' && e.target.id === 'x-src') { e.preventDefault(); $('x-dlg').querySelector('[data-a="check"]')?.click(); } });
  Promise.all([load(false), loadOps(), loadMine()]).then(() => root && draw());
}
export function nav(params = []) { tab = TABS.some(t => t[0] === params[0]) ? params[0] : 'installed'; pg = 0; q = ''; fc = ft = fs = 'all'; sel = null; draw(); root?.closest('#page')?.scrollTo({ top: 0 }); }
export function update(st) { // usage data only feeds the detail panel's Usage tab; never redraw under the user's cursor or an open menu
  if (!root || !st) return; last = st; appDown = !st.ok && !!st.at;
  if (st.ok && (down || netDown || (!inv && !loading))) return void reloadAll(false); // B89: recovery rides on the app poll (Settings → Performance), no timer of its own
  if (down !== (netDown || appDown)) return draw(); if (down) paint();
  const k = st.r?.at; if (k === drawn || !inv || err) return; drawn = k;
  if (!$('x-det').querySelector('details[open]')) { const f = focusOf(); detail(); refocus(f); } } // B91: focus survives the usage redraw
export function unmount() { root = null; drawn = ''; clearInterval(poller); poller = null; }

async function load(refresh) {
  if (loading) return; loading = true;
  try { const x = await fetch('/api/inv' + (refresh ? '?refresh=1' : ''), { cache: 'no-store' }); inv = await x.json(); err = inv.error || null; netDown = false; }
  catch { netDown = true; } // B88: keep the last inventory, the top card says it is old
  loading = false; if (root) draw(); return !err && !netDown;
}
async function loadOps() {
  const was = ops.job;
  try { ops = await (await fetch('/api/plugin', { cache: 'no-store' })).json(); netDown = false; } catch { netDown = true; if (root) draw(); return false; }
  if (!root) return true;
  if (was?.state === 'running' && ops.job?.n === was.n && ops.job.state !== 'running') { // the job ended (seen by the job poll or after the tracker came back)
    const j = ops.job, V = VERB[j.action][0], nm = j.name || j.id; clearInterval(poller); poller = null; progress();
    if (j.state === 'done') toast(`${V} ${nm}: done and verified.`); else if (j.state === 'cancelled') toast(`${V} ${nm}: cancelled.`, 'warn'); else toast(j.message || 'It did not finish.', 'err', `${V} failed: ${nm}`);
    Promise.all([load(true), loadMine()]).then(() => root && draw()); } jobBar(); const h = $('x-hist'); if (h) h.innerHTML = `${icon('i-clock')}History${ops.history.length ? ` <span class="px-n">${ops.history.length}</span>` : ''}`;
  if (ops.job?.state === 'running' && !poller) poller = setInterval(pollJob, 1000);
  return true;
}
async function loadMine() { try { mine = await (await fetch('/api/catalog', { cache: 'no-store' })).json(); netDown = false; } catch { netDown = true; return; } if (root && inv) draw(); }
async function post(o, url = '/api/plugin') {
  try { const x = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }); return await x.json().catch(() => ({ res: 'HTTP ' + x.status })); }
  catch { netDown = true; if (root) draw(); return { res: NET }; }
}
const cat = o => post(o, '/api/catalog');
async function reloadAll(refresh = true) { await Promise.all([load(refresh), loadOps(), loadMine()]); if (root) draw(); }

// ---------- data ----------
const eff = n => (last?.r?.skadv?.items || []).find(x => keyOf(x.name) === keyOf(n)) || null;
const issuesFor = n => (inv.issues || []).filter(i => i.item === n || keyOf(i.item) === keyOf(n) || i.text.includes(n + '@') || i.text.includes('(' + n));
const skillTok = s => Math.round((s.alwaysChars + 40) / 4); // name + description + list formatting, chars ÷ 4
const plugTok = p => { const s = inv.skills.filter(k => k.owner === p.id); return s.length ? s.reduce((a, k) => a + skillTok(k), 0) : null; };
const instOf = id => inv.plugins.find(p => p.id === id) || null;
const clashOf = c => { const names = new Set(inv.skills.filter(s => s.owner !== c.id).map(s => s.name.toLowerCase())); return (c.components?.skills || []).filter(s => names.has(s.toLowerCase())); };
const autoOf = c => [...(c?.hooks || []).map(h => 'hook on ' + h), ...(c?.mcp || []).map(m => 'MCP server ' + m.name)];
const goalsOf = t => GOALS.filter(([, , re]) => re.test(t.toLowerCase()));
const mineOf = id => mine.items.find(e => e.id && e.id === id) || null;
// A catalog entry's components in the inventory's shape (the catalog stores hooks / MCP as yes/no read from the repo's file list).
const compOfMine = c => c && { skills: c.skills || [], commands: c.commands || [], agents: c.agents || [], hooks: c.hooks === true ? ['hooks.json'] : Array.isArray(c.hooks) ? c.hooks : [], mcp: c.mcp === true ? [{ name: '.mcp.json', cmd: '' }] : Array.isArray(c.mcp) ? c.mcp : [] };
function rowOf(kind, x) {
  if (kind === 'mine') { const s = ops.states?.[x.key] || 'no', inst = s === 'installed' || s === 'disabled';
    return { key: 'm:' + x.key, kind, name: x.name, ver: x.version || '', desc: x.description || '(no description)', type: TYPE[x.type] || x.type, cat: x.type === 'plugin' ? 'development' : x.type, src: x.repo || x.market || '', srcK: x.type,
      installs: null, tok: null, updated: x.added, inst, state: s, reviewed: false, x, comp: compOfMine(x.comp), p: x.method === 'plugin' && inst ? instOf(x.id) : null }; }
  if (kind === 'catalog') return { key: 'c:' + x.id, kind, name: x.name, ver: x.version || (x.sha ? x.sha.slice(0, 7) : ''), desc: x.description, type: 'Plugin', cat: x.category, src: x.market, installs: x.installs,
    tok: x.tokens?.always_on ?? null, tokSrc: 'catalog', updated: x.updated, inst: x.installed, reviewed: x.reviewed, x, comp: x.components, p: x.installed ? instOf(x.id) : null, mine: mineOf(x.id) };
  if (kind === 'skill') return { key: 's:' + x.source + ':' + (x.owner || '') + ':' + x.name, kind, name: x.name, ver: '', desc: x.description || '(no description)', type: 'Skill', cat: 'skill',
    src: x.owner ? x.owner.split('@')[0] : SRC[x.source], srcK: 'skill', installs: null, tok: skillTok(x), tokSrc: 'est', updated: x.mtime, inst: true, reviewed: false, x, risk: x.risk };
  return { key: 'p:' + x.id, kind: 'plugin', name: x.name, ver: x.version.length > 14 ? x.version.slice(0, 12) : x.version, desc: x.description, type: cli(x) ? 'Plugin' : 'App plugin', cat: x.category || 'other',
    src: cli(x) ? x.market : 'Claude app', srcK: cli(x) ? 'plugin' : 'app', installs: x.installs, tok: x.tokens?.always_on ?? plugTok(x), tokSrc: x.tokens ? 'catalog' : 'est', updated: x.updated, inst: true, reviewed: x.reviewed, x, risk: x.risk, comp: x.components, p: x };
}
function items() {
  if (tab === 'catalog') return mine.items.map(e => rowOf('mine', e));
  if (tab === 'discover') return recItems();
  return [...inv.plugins.map(p => rowOf('plugin', p)), ...inv.skills.filter(s => !s.same).map(s => rowOf('skill', s))];
}
// Can a My Catalog entry be installed here, and if not, why. Install also needs your confirmation in the preview.
function installable(i) {
  const x = i.x;
  if (i.inst) return [false, 'Already installed.'];
  if (x.method === 'manual') return [false, 'Manual install: NEXUS shows the official steps.'];
  if (x.method === 'none') return [false, x.why || 'No marketplace in this repo.'];
  if (i.state === 'clash') return [false, `A skill folder named "${x.name}" already exists and wasn't installed by NEXUS.`];
  if (x.method === 'plugin' && instOf(x.id)) return [false, 'Already installed.'];
  return [true, ''];
}
function stOf(i) {
  const x = i.x, iss = issuesFor(i.name);
  if (i.kind === 'mine') { const F = x.findings || [];
    if (x.method === 'none' || i.state === 'clash') return 'bad'; if (x.method === 'manual') return 'man';
    if (F.some(f => f.lvl === 'bad') || autoOf(i.comp).length) return 'rev'; return F.some(f => f.lvl === 'warn') ? 'warn' : 'ok'; }
  if ((i.kind !== 'catalog' && x.ok === false) || iss.some(s => s.sev === 'high')) return 'bad';
  if (i.risk === 'review' || (i.kind === 'catalog' && !x.reviewed && autoOf(x.components).length)) return 'rev';
  if (iss.length || (i.kind === 'catalog' && clashOf(x).length)) return 'warn';
  if (i.kind === 'catalog' && !x.components) return 'unk';
  return 'ok';
}
function filtered() {
  let L = items(); const s = q.toLowerCase();
  if (tab === 'discover' && goal !== 'all') L = L.filter(i => goal === 'other' ? !i.goals.length : i.goals.some(g => g[0] === goal));
  if (s) L = L.filter(i => (i.name + ' ' + i.desc + ' ' + i.src + ' ' + (i.comp?.skills || []).join(' ')).toLowerCase().includes(s));
  if (fc !== 'all') L = L.filter(i => i.cat === fc);
  if (fs !== 'all') L = L.filter(i => i.srcK === fs);
  if (ft !== 'all') L = L.filter(i => ft === 'installed' ? i.inst : ft === 'available' ? !i.inst : ft === 'reviewed' ? i.reviewed : ft === 'mcp' ? i.comp?.mcp?.length : ft === 'hooks' ? i.comp?.hooks?.length
    : ft === 'flag' ? (i.risk && i.risk !== 'clean') || ['rev', 'warn', 'bad'].includes(stOf(i)) : ft === 'dup' ? i.dups?.length : ft === 'new' ? !i.dups?.length : ft === 'ready' ? installable(i)[0] : ft === 'mine' ? i.mine : true);
  const by = { pop: (a, b) => (b.installs ?? -1) - (a.installs ?? -1) || a.name.localeCompare(b.name), cost: (a, b) => (a.tok ?? 1e9) - (b.tok ?? 1e9), new: (a, b) => (b.updated || 0) - (a.updated || 0),
    name: (a, b) => a.name.localeCompare(b.name), rel: (a, b) => b.score - a.score || (b.installs ?? -1) - (a.installs ?? -1) };
  const K = P.pref('pl.key') || []; // Key Tools (Settings) first, keeping the chosen order inside each group
  return L.sort(by[tab === 'discover' && sort === 'pop' ? 'rel' : tab === 'catalog' && sort === 'pop' ? 'new' : sort] || by.pop).sort((a, b) => K.includes(b.name) - K.includes(a.name));
}
// Discover: every plugin in your local marketplace catalogs you don't have, best matches for your work areas first. Keyword rules, not a quality rating.
function recItems() {
  const have = [...inv.plugins.map(p => ({ n: p.name, t: p.name + ' ' + p.description })), ...inv.skills.map(s => ({ n: s.name, t: s.name + ' ' + s.description }))];
  return inv.catalog.filter(c => !c.installed).map(c => { const g = goalsOf(c.name + ' ' + c.description);
    const r = rowOf('catalog', c), dups = g.length ? have.filter(h => goalsOf(h.t).some(x => g.includes(x))).map(h => h.n) : [], clash = clashOf(c);
    r.goals = g; r.dups = [...new Set([...clash, ...dups])].slice(0, 4); r.score = g.length * 3 + (c.reviewed ? 2 : 0) - (clash.length ? 3 : 0);
    r.why = g.length ? `Matches ${g.map(x => x[1]).join(' + ')}.` + (clash.length ? ` Same skill name as yours: ${clash.join(', ')}.` : dups.length ? ` You already have ${[...new Set(dups)].slice(0, 3).join(', ')} for this.` : ' Nothing you have covers this yet.') : null;
    return r; });
}

// ---------- draw ----------
function draw() {
  if (!root) return; const f = focusOf(); down = netDown || appDown; lost = down ? lost || Date.now() : 0; // U3: focus + caret survive every redraw
  const n = { catalog: mine.items.length, review: mine.candidates.filter(c => !c.decision).length, updates: inv && !err ? inv.plugins.filter(p => p.update).length + Object.values(skUp || {}).filter(s => s.update).length : 0 };
  $('x-tabs').innerHTML = seg(TABS.map(([v, t]) => [v, n[v] ? `${t} (${n[v]})` : t, '#/plugins/' + v]), tab);
  if (err || !inv) { $('x-body').innerHTML = err ? stateBox('error', err, 'Start the tracker with <code>node ~/.claude/token-tracker/tracker.js serve</code>.') : down ? stateBox('error', 'No plugin data yet.', 'See the message at the top of the page.') : skeleton(); $('x-det').innerHTML = ''; paint(); return refocus(f); }
  $('x-at').textContent = down ? `Last data ${ago(inv.at)} · tracker not reachable` : 'Checked ' + ago(inv.at);
  kpis();
  $('x-body').innerHTML = { installed: grid, catalog: grid, discover: grid, review, updates, security }[tab]();
  if (!findSel()) sel = tab === 'security' || tab === 'review' || tab === 'updates' ? sel : filtered()[pg * per]?.key || null;
  detail(); jobBar(); paint(); progress(); refocus(f);
}
function paint() { // E1/E2: tracker-down card at the top, unsafe actions off with the reason; tabs, search, filters, paging and details stay usable
  const eb = down ? errBox({ title: 'Tracker not reachable', where: 'Plugins & Skills', what: "NEXUS can't reach its tracker, so plugin and skill data can't update.",
    why: inv && !err ? `What you see is the last data, from ${ago(inv.at)}. Installs, updates, removals and catalog changes are off until the tracker is back; tabs, search, filters, paging and details still work.` : 'No plugin data can show until the tracker answers.',
    affected: 'Install, update, enable, disable, uninstall, Add Plugin / Add Skill and My Catalog changes. ' + retryText(), steps: ['Make sure the tracker is running: node ~/.claude/token-tracker/tracker.js serve', 'Press Retry now.'],
    actions: [['retry', 'Retry now', true]], tech: 'GET /api, /api/inv, /api/plugin or /api/catalog failed. Retry now asks again; otherwise the app asks on its own schedule (Settings → Performance).' }) : '';
  if (eb !== shownEB) $('x-err').innerHTML = shownEB = eb;
  for (const b of root.querySelectorAll(down ? LOCK : '[data-off]')) {
    if (down) { if (!b.dataset.off) { b.dataset.off = b.disabled ? '2' : '1'; b.dataset.tip0 = b.dataset.tip ?? ''; } b.disabled = true; b.dataset.tip = OFF; }
    else { b.disabled = b.dataset.off === '2'; if (b.dataset.tip0) b.dataset.tip = b.dataset.tip0; else delete b.dataset.tip; delete b.dataset.off; delete b.dataset.tip0; } }
}
const skeleton = () => `<div class="px-fl"><span class="px-skl" style="flex:1"></span><span class="px-skl" style="width:140px"></span><span class="px-skl" style="width:140px"></span></div><div class="px-grid">${'<div class="px-c px-sk"><span class="px-skl" style="height:64px"></span><span class="px-skl"></span><span class="px-skl" style="width:60%"></span><span class="px-skl" style="height:34px"></span></div>'.repeat(8)}</div>`;
function kpis() {
  const Z = c => down ? chip('unk', `Last data from ${ago(inv.at)}: the tracker is not reachable.`) : c; // E2
  const P = inv.plugins, C = P.filter(cli), S = inv.skills, up = P.filter(p => p.update).length, I = inv.issues, M = mine.items, mi = M.filter(e => ['installed', 'disabled'].includes(ops.states?.[e.key])).length;
  setKpi($('x-pl'), P.length, n => String(Math.round(n)), `${C.length} Claude Code · ${P.length - C.length} Claude app`, Z(chip('live', 'Read from installed_plugins.json and the Claude app plugin folder for your signed-in account.')));
  setKpi($('x-sk'), S.length, n => String(Math.round(n)), `${S.filter(s => s.source === 'custom').length} yours · ${S.filter(s => s.source === 'synced').length} synced · ${S.filter(s => /plugin/.test(s.source)).length} from plugins`, Z(chip('live', 'Every SKILL.md Claude Code can load: ~/.claude/skills, synced Claude app skills, and skills inside installed plugins.')));
  setKpi($('x-my'), M.length, n => String(Math.round(n)), M.length ? `${mi} installed · ${M.length - mi} not installed` : 'empty: add or review', Z(chip('live', 'Only entries you approved, saved in my-catalog.json. Starts empty and is never filled for you.')));
  setKpi($('x-up'), up, n => String(Math.round(n)), skUp ? `${up} plugin${up === 1 ? '' : 's'} · ${Object.values(skUp).filter(s => s.update).length} skills (checked)` : up ? 'plugins · vs local catalogs' : 'up to date with local catalogs', Z(chip('live', `Installed version vs your local marketplace catalogs (official catalog refreshed ${ago(inv.markets.find(m => m.name === 'claude-plugins-official')?.updated || inv.at)}). Skills NEXUS installed are checked in Updates.`)));
  setKpi($('x-co'), I.length, n => String(Math.round(n)), I.length ? `${I.filter(i => i.sev === 'high').length} high · ${I.filter(i => i.sev === 'medium').length} medium · ${I.filter(i => i.sev === 'low').length} low` : 'no issues found', Z(chip('live', 'Missing folders, enabled-but-missing plugins, broken SKILL.md files, over-long descriptions and skills loaded from two places.')));
}
function opts(id, all, vals, cur, lab) { return `<select class="btn" id="${id}" aria-label="${lab}"><option value="all">${all}</option>${vals.map(([v, t]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`; }
function grid() {
  const all = items(), L = filtered(), pages = Math.max(1, Math.ceil(L.length / per)); pg = Math.min(pg, pages - 1);
  if (tab === 'catalog' && !all.length) return `<div class="px-empty">${icon('i-check')}<h3>My Catalog is empty</h3><p>It holds only the plugins and skills you approve. Nothing is added for you.<br>Add one by GitHub link or plugin id, or go through the candidate list.</p>
    <div class="px-act"><button class="btn pri" data-a="add" data-v="plugin">${icon('i-puzzle')}Add Plugin</button><button class="btn" data-a="add" data-v="skill">${icon('i-book')}Add Skill</button><a class="btn" href="#/plugins/review">${icon('i-search')}Review Candidates</a></div></div>`;
  const disc = tab === 'discover', inst = tab === 'installed';
  const types = disc ? [['new', 'Nothing similar installed'], ['dup', 'Overlaps with yours'], ['reviewed', 'Anthropic-reviewed'], ['mine', 'In My Catalog'], ['mcp', 'Has MCP servers'], ['hooks', 'Has hooks']]
    : inst ? [['flag', 'Has security notes'], ['mcp', 'Has MCP servers'], ['hooks', 'Has hooks']] : [['ready', 'Ready to install'], ['installed', 'Installed'], ['available', 'Not installed'], ['flag', 'Has findings']];
  const kinds = inst ? [['plugin', 'Claude Code plugins'], ['app', 'Claude app plugins'], ['skill', 'Skills']] : tab === 'catalog' ? Object.entries(TYPE) : null;
  const vis = L.slice(pg * per, pg * per + per);
  const goalBar = disc ? `<div class="px-goals">${[['all', 'All'], ...GOALS, ['other', 'Other']].map(([v, t]) => { const n = v === 'all' ? all.length : v === 'other' ? all.filter(i => !i.goals.length).length : all.filter(i => i.goals.some(g => g[0] === v)).length;
    return `<button class="tab${goal === v ? ' on' : ''}" data-a="goal" data-v="${v}" aria-pressed="${goal === v}">${esc(t)} <span class="px-n">${n}</span></button>`; }).join('')}</div>
    <p class="px-note">${icon('i-spark')}Suggestions from the marketplace catalogs already on this PC, best matches for your work first. Never added for you: use <b>Add to Catalog</b> to approve one, then install it from My Catalog. ${lm('pl-disc', 'Discover')}</p>`
    : tab === 'catalog' ? `<p class="px-note">${icon('i-check')}Only what you approved. <b>Install</b> appears when an entry is compatible and NEXUS supports its install method. <b>Remove from Catalog</b> never uninstalls anything. ${lm('pl-cat', 'My Catalog')}</p>` : '';
  return `${goalBar}<div class="px-fl"><label class="field">${icon('i-search')}<input id="x-q" placeholder="Search ${inst ? 'installed plugins and skills' : tab === 'catalog' ? 'My Catalog' : 'suggestions'}…" value="${esc(q)}" aria-label="Search"></label>
    ${kinds ? opts('x-fs', 'All Types', kinds, fs, 'Type') : ''}${opts('x-ft', 'All Filters', types, ft, 'Filter')}
    <select class="btn" id="x-sort" aria-label="Sort">${[['pop', disc ? 'Best match' : tab === 'catalog' ? 'Recently added' : 'Most Popular'], ['cost', 'Lowest Startup Cost'], ['new', 'Recently Updated'], ['name', 'Name']].map(([v, t]) => `<option value="${v}"${v === sort ? ' selected' : ''}>${t}</option>`).join('')}</select>${lm('pl-cost', 'Startup cost')}</div>
  ${vis.length ? `<div class="px-grid">${vis.map(cardOf).join('')}</div>` : stateBox('empty', 'Nothing matches.', 'Clear the search or filters.')}
  <div class="pager"><span class="muted">${L.length ? `Showing ${pg * per + 1}–${pg * per + vis.length} of ${L.length}` : ''}</span><div class="pg-btns">${pagerBtns(pages)}</div>
    <label class="muted px-per">Items per page <select class="btn sm" id="x-per">${[12, 24].map(n => `<option${n === per ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>`;
}
function pagerBtns(pages) {
  const b = (p, t, on, dis, lab) => `<button class="pgb${on ? ' on' : ''}" data-a="pg" data-v="${p}" ${dis ? 'disabled' : ''}${lab ? ` aria-label="${lab}" data-tip="${lab}"` : ''}${on ? ' aria-current="page"' : ''}>${t}</button>`;
  const nums = pages <= 7 ? [...Array(pages).keys()] : [...new Set([0, 1, pg - 1, pg, pg + 1, pages - 2, pages - 1].filter(i => i >= 0 && i < pages))].sort((a, b) => a - b);
  let out = b(pg - 1, '‹', 0, !pg, 'Previous page'), prev = -1; for (const i of nums) { if (i - prev > 1) out += '<span class="muted">…</span>'; out += b(i, i + 1, i === pg, 0, 'Page ' + (i + 1)); prev = i; }
  return out + b(pg + 1, '›', 0, pg >= pages - 1, 'Next page');
}
// The one main action for an item, used by cards and the detail panel.
function mainAct(i, big) {
  const k = esc(i.key), p = i.p, cls = big ? 'btn' : 'btn sm', b = (a, op, t, ic, c = 'pri', tip = '') => `<button class="${cls} ${c}" data-a="${a}"${op ? ` data-op="${op}"` : ''} data-k="${k}"${tip ? ` data-tip="${esc(tip)}"` : ''}>${icon(ic)}${t}</button>`;
  if (i.kind === 'mine') { const [ok, why] = installable(i);
    if (i.state === 'disabled' && i.p) return b('op', 'enable', 'Enable', 'i-check', 'pri', 'Installed but turned off in settings.json. Opens a preview before enabling.');
    if (ok) return b('op', 'install', 'Install', 'i-arrow-down', 'pri px-go', 'Opens an install preview with the exact steps. Nothing is installed until you confirm.');
    if (i.x.method === 'manual') return b('manual', '', 'How to install', 'i-book', 'ghost', 'Shows the official install steps. NEXUS never runs them.');
    if (i.inst) return big ? (i.x.method === 'skill' ? b('op', 'uninstall', 'Uninstall', 'i-x', 'px-danger') : `<button class="btn pri" disabled>${icon('i-check')}Installed</button>`) : `<button class="btn sm ghost px-ok" data-a="sel" data-k="${k}">${icon('i-check')}Installed</button>`;
    return `<button class="${cls} ghost" disabled data-tip="${esc(why)}">${icon('i-x')}Can't install</button>`; }
  if (i.kind === 'catalog' && !i.inst) return i.mine ? b('sel', '', 'In My Catalog', 'i-check', 'ghost px-ok') : b('addid', '', 'Add to Catalog', 'i-check', '', 'Review it and add it to My Catalog. Nothing is installed.');
  if (i.kind === 'skill') return b('improve', '', 'Improve', 'i-spark', 'ghost', 'Improvement ideas for this skill. Nothing is edited.');
  if (p && !cli(p)) return `<button class="${cls} ghost" disabled data-tip="Claude app plugins are installed, updated and removed in the Claude app.">${icon('i-check')}Claude app</button>`;
  if (p?.update) return b('op', 'update', 'Update', 'i-undo');
  if (p?.enabled === false) return b('op', 'enable', 'Enable', 'i-check');
  return big ? `<button class="btn pri" disabled>${icon('i-check')}Installed</button>` : `<button class="btn sm ghost px-ok" data-a="sel" data-k="${k}">${icon('i-check')}Installed</button>`;
}
function cardOf(i) {
  const [col] = cc(i.cat), ic = icOf(i.name, i.desc, i.cat), st = stOf(i), m = i.kind === 'mine', ses = i.kind === 'skill' || (i.kind === 'plugin' && i.installs == null && i.x.copies?.length); // a plugin that is one skill shows that skill's use
  const foot = m ? `<span class="px-pub" data-tip="${esc('Publisher · added ' + ago(i.x.added))}">${icon('i-code')}${esc(i.src.split('/')[0] || '—')}</span>`
    : `<span data-tip="${ses ? (last?.r ? 'Sessions that loaded it (your logs).' : 'Usage loads with the next refresh.') : i.installs != null ? 'Unique installs (marketplace catalog).' : 'Not in a catalog with install counts.'}">${icon(ses ? 'i-clock' : 'i-arrow-down')}${ses ? (last?.r ? (eff(i.name)?.sessions ?? 0) + ' ses.' : '—') : n1(i.installs)}</span>
      <span data-tip="${i.tok == null ? 'Startup cost unknown.' : i.tokSrc === 'catalog' ? 'Tokens added to every session (skill list), counted by the marketplace catalog.' : 'Est. tokens added to every session: skill name + description, characters ÷ 4.'}">${icon('i-db')}${i.tok == null ? '—' : (i.tokSrc === 'est' ? '~' : '') + tok(i.tok)}</span>`;
  return `<article class="px-c${i.key === sel ? ' on' : ''}" data-a="sel" data-k="${esc(i.key)}" tabindex="0" style="--tc:${col}" aria-label="${esc(i.name)}">
    <div class="px-top"><span class="px-ic">${icon(ic)}</span><span class="px-art">${icon(ic)}${i.reviewed ? `<span class="px-rv" data-tip="Reviewed by Anthropic (plugin directory).">${icon('i-check')}</span>` : ''}</span></div>
    <div class="px-h"><b title="${esc(i.name)}">${(P.pref('pl.key') || []).includes(i.name) ? '<span class="px-key" data-tip="Key Tool (Settings → Plugins & Skills)">★</span> ' : ''}${esc(i.name)}</b><span class="mono">${esc(i.ver ? 'v' + i.ver.replace(/^v/, '') : '')}</span></div>
    <div class="px-tags"><span class="tg">${i.type}</span>${m ? (i.inst ? (i.state === 'disabled' ? '<span class="tg w">Disabled</span>' : '<span class="tg ok">Installed</span>') : '') : `<span class="tg c">${esc(i.kind === 'skill' ? i.src : i.cat)}</span>`}${P.pref('pl.risk') ? stTag(st) : ''}</div>
    <p title="${esc(i.why || i.desc)}">${esc(i.why || i.desc)}</p>
    <div class="px-f"><span class="px-fm">${foot}</span>${mainAct(i)}</div></article>`;
}

// ---------- review candidates ----------
function review() {
  const C = mine.candidates, done = C.filter(c => c.decision).length;
  return `<p class="px-note">${icon('i-shield')}The links you sent (${C.length}) are candidates, not approvals. Open each one, read what NEXUS found, then approve the items you want into My Catalog one by one. Skip or reject the rest. ${done} of ${C.length} decided. ${lm('pl-rev', 'Review Candidates')}</p>
  <div class="px-rvl">${C.map(c => { const d = c.decision && DEC[c.decision.state], [o] = c.repo.split('/');
    return `<div class="px-rvr"><span class="px-ic">${icon(icOf(c.repo.split('/')[1], c.note, 'other'))}</span><div><b>${ghLink(c.repo)}</b><small>${esc(c.note)}</small></div>
      <div class="px-rvs">${d ? `<span class="chip ${d[0]}">${d[1]}${c.added.length ? ` · ${c.added.length} in catalog` : ''}</span>` : c.added.length ? `<span class="chip ok">${c.added.length} in catalog</span>` : '<span class="chip unk">Not reviewed</span>'}</div>
      <button class="btn ${d ? 'ghost' : 'pri'}" data-a="review" data-v="${esc(c.repo)}" aria-label="Review ${esc(o)}">${icon('i-search')}${d ? 'Open' : 'Review'}</button></div>`; }).join('')}</div>`;
}
// What a checked source holds, with one Add button per item. Used by Add Plugin / Add Skill, Discover and Review.
function repoView(r, from, want) {
  const pushed = r.pushed ? ` · updated ${ago(r.pushed)}` : '';
  const head = `<div class="px-rh"><div><b>${r.repo ? ghLink(r.repo) : esc(r.market)}</b><small class="muted">${esc(r.owner?.login || '')}${r.owner?.type && r.owner.type !== 'catalog' ? ` (${r.owner.type === 'Organization' ? 'organization' : 'personal account'})` : ''}${r.license ? ' · ' + esc(r.license) : ''}${r.stars != null ? ` · ${tok(r.stars)} stars` : ''}${pushed}</small></div></div>
    ${r.description ? `<p class="px-desc">${esc(r.description)}</p>` : ''}`;
  const its = r.items.map(it => { const [mt, md] = METHOD[it.method] || [it.method, ''], c = compOfMine(it.comp), wrong = want && it.type !== want && !(want === 'plugin' && it.type === 'plugin');
    const feats = c ? [['skill', c.skills], ['command', c.commands], ['agent', c.agents], ['hook file', c.hooks], ['MCP config', c.mcp.map(m => m.name)]].filter(([, v]) => v.length).map(([n, v]) => `${v.length} ${n}${v.length > 1 ? 's' : ''}`).join(' · ') : '';
    return `<div class="px-it"><div class="px-ith"><b>${esc(it.name)}</b>${it.version ? `<span class="mono muted">v${esc(String(it.version).replace(/^v/, ''))}</span>` : ''}<span class="tg">${TYPE[it.type]}</span><span class="tg ${it.method === 'plugin' || it.method === 'skill' ? 'ok' : it.method === 'none' ? 'w' : 'n'}" data-tip="${esc(md)}">${esc(mt)}</span></div>
      ${it.description ? `<small>${esc(it.description)}</small>` : ''}${feats ? `<small class="muted">Adds: ${esc(feats)}</small>` : ''}${it.why ? `<small class="px-warn">${esc(it.why)}</small>` : ''}
      ${wrong ? `<small class="px-warn">This is ${it.type === 'skill' ? 'a skill' : 'not a skill'}: it will be listed as ${TYPE[it.type]}.</small>` : ''}
      ${it.related.length ? finds(it.related) : ''}
      <div class="px-itf">${it.inCatalog ? `<span class="chip ok">${icon('i-check')}In My Catalog</span>` : `<button class="btn sm pri" type="button" data-a="additem" data-v="${esc(it.name)}" data-from="${from}">${icon('i-check')}Approve: add to My Catalog</button>`}</div></div>`; }).join('');
  const steps = r.install?.length ? `<h3>Official install steps <span class="muted sm">from the README, shown word for word, never run by NEXUS</span></h3><div class="px-cmds">${r.install.map(l => `<code>${esc(l)}</code>`).join('')}</div>` : '';
  return `${head}<h3>Findings <span class="muted sm">signals to read, not a verdict</span></h3>${finds(r.findings || [])}${r.deps?.length ? `<p class="px-note">${icon('i-layers')}May need: ${esc(r.deps.join(', '))} (from its install steps).</p>` : ''}
    <h3>${r.items.length > 1 ? `${r.items.length} items in this repo <span class="muted sm">approve each one separately</span>` : 'Item'}</h3><div class="px-its">${its}</div>${steps}`;
}
async function check(src, from, want) {
  const box = $('x-dlg').querySelector('#x-res'); if (!box) return; box.innerHTML = stateBox('loading', 'Checking the source…', 'Reads the repo on GitHub. Nothing is downloaded or run.');
  const r = await cat({ op: 'validate', source: src }); if (!$('x-dlg').querySelector('#x-res')) return;
  box.dataset.src = src; box.dataset.from = from;
  box.innerHTML = r.res === 'ok' ? repoView(r.repo, from, want) : stateBox('error', "Couldn't check this source", why(r.res));
}
function addDlg(kind, src = '', from = 'url') {
  const P = kind === 'plugin';
  dlg(dlgHead(P ? 'i-puzzle' : 'i-book', P ? 'Add Plugin' : 'Add Skill') + `<p class="muted sm">${P ? 'A GitHub link or owner/repo of a plugin marketplace, or a plugin id (name@marketplace) from your local catalogs.' : 'A GitHub link to a repo or folder with a SKILL.md, or owner/repo.'} NEXUS checks it first. Adding only puts it in My Catalog: installing is a separate step you confirm.</p>
    <div class="px-src"><label class="field">${icon('i-search')}<input id="x-src" value="${esc(src)}" placeholder="${P ? 'https://github.com/owner/repo  or  name@marketplace' : 'https://github.com/owner/repo/tree/main/skills/name'}" aria-label="Source" autocomplete="off" spellcheck="false"></label>
    <button class="btn pri" type="button" data-a="check" data-v="${kind}" data-from="${from}">${icon('i-search')}Check</button></div>
    <div id="x-res" class="px-resv"></div><div class="lx-fa"><button class="btn ghost" value="x">Close</button></div>`, 'add');
  if (src) check(src, from, kind); else $('x-src').focus();
}
async function reviewDlg(repo) {
  const c = mine.candidates.find(x => x.repo === repo); if (!c) return;
  dlg(dlgHead('i-search', 'Review: ' + esc(repo)) + `<p class="px-note">${icon('i-book')}Research note: ${esc(c.note)}</p><div id="x-res" class="px-resv"></div>
    <div class="lx-fa"><span class="muted sm px-exp">${c.decision ? `Decision: ${DEC[c.decision.state][1]} ${ago(c.decision.at)}` : 'Not decided yet'}</span>
    ${c.decision ? `<button class="btn ghost" type="button" data-a="decide" data-v="pending" data-r="${esc(repo)}">Undo decision</button>` : ''}
    <button class="btn" type="button" data-a="decide" data-v="rejected" data-r="${esc(repo)}" data-tip="Mark as not wanted. Nothing is added.">Reject</button>
    <button class="btn" type="button" data-a="decide" data-v="skipped" data-r="${esc(repo)}" data-tip="Decide later. Nothing is added.">Skip</button><button class="btn ghost" value="x">Close</button></div>`, 'review');
  check('https://github.com/' + repo, 'review');
}
function manualDlg(i) {
  const x = i.x, pipe = (x.findings || []).filter(f => f.lvl === 'bad');
  dlg(dlgHead('i-book', `How to install: ${esc(x.name)}`) + `<p class="px-note">${icon('i-shield')}${x.type === 'mcp' ? 'An MCP server. Claude Code adds it with <code>claude mcp add</code> using the command its README gives.' : 'A separate app, not a Claude plugin or skill.'} NEXUS doesn't run installers: copy a step, read it, and run it yourself in a terminal if you trust it.</p>
    ${pipe.length ? `<div class="px-chk">${pipe.map(f => `<div class="no">${icon('i-x')}<span>${esc(f.t)}. Safer: download the script, read it, then run it; or use a package manager line if one is listed.</span></div>`).join('')}</div>` : ''}
    ${x.install?.length ? `<h3>Steps from its README <span class="muted sm">word for word</span></h3><div class="px-cmds">${x.install.map(l => `<div><code>${esc(l)}</code><button class="btn sm ghost" type="button" data-a="copy" data-v="${esc(l)}">Copy</button></div>`).join('')}</div>` : '<p class="muted sm">No install commands found in its README.</p>'}
    ${x.deps?.length ? `<p class="px-note">${icon('i-layers')}May need: ${esc(x.deps.join(', '))}.</p>` : ''}
    <div class="lx-fa">${x.readme ? `<a class="btn" href="${esc(x.readme)}" target="_blank" rel="noopener noreferrer">${icon('i-book')}Open README</a>` : ''}<button class="btn pri" value="x">Close</button></div>`);
}
function removeDlg(i) {
  dlg(dlgHead('i-x', `Remove from Catalog: ${esc(i.x.name)}`) + `<p>This removes <b>${esc(i.x.name)}</b> from My Catalog only.</p><div class="px-chk"><div class="ok">${icon('i-check')}<span>${i.inst ? 'It stays installed. Uninstall it separately if you want it gone.' : 'Nothing is installed, so nothing else changes.'}</span></div><div class="ok">${icon('i-check')}<span>You can add it again any time.</span></div></div>
    <div class="lx-fa"><button class="btn ghost" value="x">Cancel</button><button class="btn px-danger" type="button" data-a="rmok" data-k="${esc(i.x.key)}">${icon('i-x')}Remove from Catalog</button></div>`);
}

// ---------- updates / security ----------
function updates() {
  const P = inv.plugins.filter(cli), S = mine.items.filter(e => e.method === 'skill' && ops.states?.[e.key] === 'installed');
  return `<p class="px-note">${icon('i-undo')}Nothing updates on its own. Plugins are compared with your local catalogs; skills NEXUS installed are compared with their repo when you press Check. Each update shows a preview and waits for you. Restart Claude Code to load new versions. ${lm('pl-upd', 'Updates')}</p>
  <div class="px-sec"><h3>${icon('i-layers')}Plugins</h3><table class="tbl click px-t"><thead><tr><th>Plugin</th><th>Installed</th><th>Catalog</th><th>Status</th><th class="n">Action</th></tr></thead><tbody>${P.map(p => { const c = inv.catalog.find(x => x.id === p.id);
    return `<tr data-a="sel" data-k="p:${esc(p.id)}" tabindex="0"><td><b>${esc(p.name)}</b> <small class="muted">${esc(p.market)}</small></td><td class="mono">${esc(p.version.slice(0, 14))}</td><td class="mono">${esc(p.update ? p.update.to : c ? (c.version || (c.sha || '').slice(0, 12) || 'same catalog') : '—')}</td>
    <td>${p.update ? `<span class="chip ${p.update.kind === 'catalog' ? 'est' : 'warn'}" data-tip="${esc(p.update.note || 'A newer version is listed.')}">${p.update.kind === 'catalog' ? 'Catalog newer' : 'Update available'}</span>` : c ? '<span class="chip ok">Up to date</span>' : '<span class="chip unk" data-tip="Its marketplace is not in your local catalogs.">Not checkable</span>'}</td>
    <td class="n">${p.update ? `<button class="btn sm pri" data-a="op" data-op="update" data-k="p:${esc(p.id)}">${icon('i-undo')}Update</button>` : `<span class="muted sm">${day(p.updated)}</span>`}</td></tr>`; }).join('')}</tbody></table></div>
  <div class="px-sec"><h3>${icon('i-book')}Skills installed by NEXUS <span class="muted sm">${S.length}</span><span class="end"></span><button class="btn sm" data-a="skup" ${S.length ? '' : 'disabled'} data-tip="Asks GitHub for each repo's latest commit (git ls-remote). Read-only.">${icon('i-search')}Check skills</button></h3>
    ${S.length ? `<table class="tbl px-t"><thead><tr><th>Skill</th><th>Installed commit</th><th>Repo now</th><th>Status</th><th class="n">Action</th></tr></thead><tbody>${S.map(e => { const u = skUp?.[e.key];
      return `<tr><td><b>${esc(e.name)}</b> <small class="muted">${esc(e.repo)}</small></td><td class="mono">${esc(u?.from?.slice(0, 7) || '—')}</td><td class="mono">${esc(u?.to?.slice(0, 7) || '—')}</td>
      <td>${!u ? '<span class="chip unk">Not checked</span>' : u.error ? `<span class="chip warn" data-tip="${esc(u.error)}">Check failed</span>` : u.update ? '<span class="chip warn">Update available</span>' : '<span class="chip ok">Up to date</span>'}</td>
      <td class="n">${u?.update ? `<button class="btn sm pri" data-a="op" data-op="update" data-k="m:${esc(e.key)}">${icon('i-undo')}Update</button>` : ''}</td></tr>`; }).join('')}</tbody></table>` : '<p class="muted sm">None yet. Skills you install from My Catalog are listed here.</p>'}</div>`;
}
function security() {
  const I = inv.issues, rows = [...inv.plugins.map(p => rowOf('plugin', p)), ...inv.skills.filter(s => (s.source === 'custom' || s.source === 'synced') && !s.same).map(s => rowOf('skill', s))]
    .map(r => ({ ...r, st: stOf(r), auto: r.kind === 'plugin' ? autoOf(r.comp) : [] })).sort((a, b) => ['bad', 'rev', 'warn', 'unk', 'ok'].indexOf(a.st) - ['bad', 'rev', 'warn', 'unk', 'ok'].indexOf(b.st));
  const cnt = s => rows.filter(r => r.st === s).length, SEV = [['high', 'High', 'Stops something from loading or working.'], ['medium', 'Medium', 'Works, but causes confusion or wasted tokens.'], ['low', 'Low', 'Worth knowing; nothing breaks.']];
  return `<div class="px-legend">${['ok', 'warn', 'bad', 'unk', 'rev'].map(s => `<div class="st-${s}" data-tip="${esc(ST[s][2])}"><i></i><b>${cnt(s)}</b><span>${ST[s][1]}</span></div>`).join('')}</div>
  <p class="px-note">${icon('i-shield')}A clean result means these checks found nothing. It is not proof that a plugin or skill is safe: the scan reads code for risky patterns, it doesn't run it.</p>
  <div class="px-sec"><h3>${icon('i-check')}Compatibility findings <span class="muted sm">${I.length || 'none'}</span></h3>
    ${I.length ? SEV.filter(([s]) => I.some(i => i.sev === s)).map(([s, t, d]) => `<div class="px-grp"><div class="px-gh">${sevChip(s)}<b>${t}</b><span class="muted sm">${d}</span></div>
      ${I.filter(i => i.sev === s).map(i => `<div class="px-is"><div><b>${esc(i.item)}</b><span>${esc(i.text)}</span>${i.fix ? `<small>${icon('i-bolt')}${esc(i.fix)}</small>` : ''}</div>${selBtn(i.item)}</div>`).join('')}</div>`).join('') : stateBox('empty', 'No compatibility findings.', 'Files, settings and names all check out.')}</div>
  <div class="px-sec"><h3>${icon('i-shield')}Installed plugins and your skills <span class="muted sm">static scan of code files</span>${lm('pl-scan', 'Static scan')}</h3>
  <table class="tbl click px-t px-sc"><thead><tr><th>Name</th><th>Status</th><th>Runs automatically</th><th>Signals</th></tr></thead><tbody>${rows.map(r => `<tr data-a="sel" data-k="${esc(r.key)}" tabindex="0"><td><b>${esc(r.name)}</b> <small class="muted">${esc(r.type === 'Skill' ? SRC[r.x.source] : r.type)}</small></td><td>${stTag(r.st)}</td>
    <td class="sm">${r.auto.length ? esc(r.auto.join(', ')) : '<span class="muted">no</span>'}</td><td>${sigTags(r.x.scan)}</td></tr>`).join('')}</tbody></table></div>
  <div class="px-sec"><h3>${icon('i-flow')}Hooks in your settings.json <span class="muted sm">each runs a command on its event</span></h3>
    ${inv.hooks.map(h => `<div class="px-hk"><span class="tg">${esc(h.event)}${h.matcher ? ' · ' + esc(h.matcher) : ''}</span><code title="${esc(h.cmd)}">${esc(h.cmd)}</code></div>`).join('') || stateBox('empty', 'No hooks.')}</div>`;
}
const selBtn = name => { const p = inv.plugins.find(x => x.name === name || x.id === name || keyOf(x.id) === keyOf(name)), s = !p && inv.skills.find(x => x.name === name);
  const k = p ? 'p:' + p.id : s ? 's:' + s.source + ':' + (s.owner || '') + ':' + s.name : null; return k ? `<button class="btn sm ghost" data-a="sel" data-k="${esc(k)}">Details</button>` : ''; };
const sigTags = sc => { const e = Object.entries(sc?.sig || {}); return e.length ? e.map(([k, v]) => `<span class="tg n" data-tip="${esc(`${SIGN[k]}: ${v.n} line${v.n === 1 ? '' : 's'}, e.g. ${v.at.join(', ')}`)}">${SIGN[k]} ${v.n}</span>`).join(' ') : '<span class="muted sm">none</span>'; };

// ---------- improvement ideas (rule-based; each says what it's based on) ----------
function recsFor(i) {
  const R = [], add = (lvl, tag, t, prompt) => R.push({ lvl, tag, t, prompt }), e = eff(i.name), x = i.x;
  if (i.kind === 'skill') {
    const P = goal => `Use the skill-creator skill to improve the "${x.name}" skill at ${x.path}: ${goal} Keep its behaviour and trigger words. Show me the diff before saving anything.`;
    if (!x.ok) add('w', 'Broken', 'No SKILL.md: Claude Code can\'t load this skill.', null);
    else if (!x.hasDesc) add('w', 'Fix', 'No description: Claude can\'t tell when to use it.', P('add a one-sentence description to the front matter that says when to use it.'));
    else if (x.description.length > 1024) add('w', 'Fix', `Description is ${x.description.length} chars (limit 1,024): it may be cut off.`, P('shorten the description to under 1,024 characters.'));
    else if (x.description.length > 500) add('n', 'Trim', `Description ~${tok(Math.round(x.description.length / 4))} tokens is listed in every session. A shorter trigger line costs less.`, P(`shorten the description from ${x.description.length} to about 300 characters.`));
    if (x.invokeChars > 40000) add('n', 'Split', `SKILL.md is ~${tok(Math.round(x.invokeChars / 4))} tokens when loaded. Moving detail into reference files loads less each time.`, P('move long examples and reference material into separate files that SKILL.md links to, so less loads each time.'));
    if (x.source === 'custom' && (!e || !e.sessions)) add('u', 'Unused', 'No use in your tracked logs yet. Rarely used isn\'t useless: your call.', null);
  } else if (i.kind === 'plugin') {
    if (x.update) add('w', 'Update', x.update.kind === 'catalog' ? 'Catalog has a newer commit (files may be unchanged).' : `Update ${x.update.from} → ${x.update.to}.`, null);
    if (x.oldVersions) add('u', 'Disk', `${x.oldVersions} older cached cop${x.oldVersions === 1 ? 'y' : 'ies'} kept in plugins/cache by Claude Code.`, null);
    if (x.risk === 'review') add('w', 'Security', 'Runs automatically and has network or delete code: review the signals.', null);
    if (e?.status === 'Consider removing') add('w', 'Remove?', e.why + ' (needs your approval).', null);
    else if (e?.expensive) add('n', 'Costly', `~${tok(e.cost)} tokens per session, over twice the median.`, null);
  }
  if (i.kind !== 'mine') for (const s of issuesFor(i.name)) if (!R.some(r => r.t === s.text)) add(s.sev === 'high' ? 'w' : 'n', 'Conflict', s.text, null);
  return R;
}

// ---------- detail panel ----------
function findSel() {
  if (!sel || !inv) return null; const [t, ...rest] = sel.split(':'), id = rest.join(':');
  if (t === 'm') { const e = mine.items.find(x => x.key === id); return e && rowOf('mine', e); }
  if (t === 'c') { const c = inv.catalog.find(x => x.id === id); return c && rowOf('catalog', c); }
  if (t === 'p') { const p = inv.plugins.find(x => x.id === id); return p && rowOf('plugin', p); }
  const [src, owner, ...nm] = rest, name = nm.join(':'), s = inv.skills.find(k => k.source === src && (k.owner || '') === owner && k.name === name) || inv.skills.find(k => k.source === src && k.name === name);
  return s && rowOf('skill', s);
}
const DSUB = [['overview', 'Overview'], ['compat', 'Compatibility'], ['security', 'Security'], ['perf', 'Usage'], ['updates', 'Updates']];
function detail() {
  const el = $('x-det'), i = findSel();
  if (!i) return void (el.innerHTML = stateBox('empty', 'Select a plugin or skill', tab === 'review' ? 'Open a candidate to review it.' : 'Pick a card or row to see what it adds, its compatibility, security and cost.'));
  const x = i.x, sk = i.kind === 'skill', m = i.kind === 'mine', [col] = cc(i.cat), ic = icOf(i.name, i.desc, i.cat), st = stOf(i), p = i.p, url = m ? x.url || (x.repo && 'https://github.com/' + x.repo) : x.repo || x.homepage;
  const status = sk ? `<span class="tg ok">Installed</span>` : m ? `<span class="tg ok">${icon('i-check')}In My Catalog</span>${i.inst ? `<span class="tg ok">${i.state === 'disabled' ? 'Installed · disabled' : 'Installed'}</span>` : ''}`
    : !i.inst ? '<span class="tg">Not installed</span>' : p && !cli(p) ? '<span class="tg ok">Installed · Claude app</span>' : p?.enabled === false ? '<span class="tg w">Installed · disabled</span>' : '<span class="tg ok">Installed · enabled</span>';
  const pp = p && cli(p) ? p : null, sec = pp ? [pp.enabled === false ? ['enable', 'Enable', 'i-check'] : ['disable', 'Disable', 'i-x'], ['uninstall', 'Uninstall', 'i-x']].filter(([op]) => !(op === 'enable' && m)) : []; // the main button already offers Enable
  const pk = pp ? 'p:' + pp.id : i.key, subs = DSUB.filter(([v]) => !((sk || m) && v === 'updates') && !(m && v === 'perf'));
  const sub = subs.some(([v]) => v === dsub) ? dsub : 'overview';
  el.innerHTML = `<div class="det px-d" style="--tc:${col}">
    <div class="px-dh"><span class="px-ic lg">${icon(ic)}</span><div><b>${esc(x.name)}</b><span class="muted">${esc(sk ? (x.owner ? 'from ' + x.owner : SRC[x.source]) : m ? (x.publisher?.login ? 'by ' + x.publisher.login : x.market || '') : x.author ? 'by ' + x.author : x.market || '')}</span><div class="px-tags">${status}${stTag(st)}${x.reviewed ? `<span class="tg ok" data-tip="Reviewed by Anthropic in the plugin directory.">${icon('i-check')}Reviewed</span>` : ''}</div></div></div>
    <p class="px-desc">${esc(x.description || '(no description)')}</p>
    <div class="px-meta">${sk ? '' : `<span data-tip="Version">${icon('i-code')}${esc((p?.version || x.version || (x.sha || '').slice(0, 7) || '—').slice(0, 14))}</span>`}<span data-tip="${m ? 'Added to My Catalog' : 'Last updated'}">${icon('i-cal')}${day(sk ? x.mtime : m ? x.added : x.updated)}</span>${x.installs != null ? `<span data-tip="Unique installs (marketplace catalog).">${icon('i-arrow-down')}${n1(x.installs)}</span>` : ''}
      <span class="px-tags"><span class="tg">${i.type}</span><span class="tg c">${esc(sk ? SRC[x.source] : m ? (METHOD[x.method] || [x.method])[0] : i.cat)}</span></span></div>
    <div class="px-act">${mainAct(i, true)}${sk ? lm('pl-imp', 'Improve') : lm('pl-ops', 'How install, update and uninstall work')}${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('i-code')}View Source</a>` : `<button class="btn" disabled data-tip="No source link in its manifest.">${icon('i-code')}View Source</button>`}<details class="lx-more"><summary aria-label="More options">⋯</summary><div>${x.path ? `<button data-a="copy" data-v="${esc(x.path)}">${icon('i-folder')}Copy folder path</button>` : ''}<button data-a="copy" data-v="${esc(x.name)}">${icon('i-book')}Copy name</button>${!sk && x.id ? `<button data-a="copy" data-v="${esc(x.id)}">${icon('i-term')}Copy plugin id</button>` : ''}</div></details></div>
    ${sec.length || m || (i.kind === 'catalog' && i.mine) ? `<div class="px-act2">
      ${sec.map(([op, t, ico]) => `<button class="btn sm${op === 'uninstall' ? ' px-danger' : ''}" data-a="op" data-op="${op}" data-k="${esc(pk)}">${icon(ico)}${t}</button>`).join('')}
      ${m && x.method === 'skill' && i.inst ? `<button class="btn sm" data-a="op" data-op="update" data-k="${esc(i.key)}" data-tip="Downloads the repo again and swaps the folder; the old copy is kept in removed-skills.">${icon('i-undo')}Update</button>` : ''}
      ${m ? `<button class="btn sm ghost" data-a="rm" data-k="${esc(i.key)}" data-tip="Removes it from My Catalog only. Never uninstalls.">${icon('i-x')}Remove from Catalog</button>` : ''}
      ${!m && i.mine ? `<button class="btn sm ghost" data-a="sel" data-k="m:${esc(i.mine.key)}">${icon('i-check')}Open in My Catalog</button>` : ''}</div>` : ''}
    <nav class="px-dt" role="tablist">${subs.map(([v, t]) => `<button class="${v === sub ? 'on' : ''}" role="tab" id="x-dt-${v}" aria-controls="x-dp" tabindex="${v === sub ? 0 : -1}" aria-selected="${v === sub}" data-a="dsub" data-v="${v}">${t}</button>`).join('')}</nav>
    <div class="px-dp" id="x-dp" role="tabpanel" aria-labelledby="x-dt-${sub}">${({ overview, compat: compatP, security: securityP, perf: perfP, updates: updatesP }[sub])(i)}</div>
  </div>`;
  paint();
}
function overview(i) {
  const c = i.comp, x = i.x, sk = i.kind === 'skill', m = i.kind === 'mine';
  const feats = c ? [['Skills', c.skills], ['Commands', c.commands], ['Agents', c.agents], ['Hooks', c.hooks], ['MCP servers', (c.mcp || []).map(m => m.name)], ['LSP servers', x.lsp]].filter(([, v]) => v?.length) : [];
  const where = m ? (x.method === 'plugin' ? `~/.claude/plugins/cache/${x.market}/${x.name}/` : x.method === 'skill' ? `~/.claude/skills/${x.name}/` : 'its own installer decides') : null;
  return `${sk ? `<h3>Skill</h3><div class="dl g2"><div><dt>Source</dt><dd>${esc(SRC[x.source])}</dd></div><div><dt>Owner</dt><dd>${esc(x.owner || 'you')}</dd></div><div style="grid-column:1/-1"><dt>Folder</dt><dd class="mono sm px-path">${esc(x.path)}</dd></div></div>` : `
    ${m ? `<h3>Install</h3><div class="dl g2"><div><dt>Method</dt><dd>${esc((METHOD[x.method] || [x.method])[0])}</dd></div><div><dt>Source</dt><dd>${x.repo ? ghLink(x.repo) : esc(x.market || '—')}</dd></div><div><dt>Publisher</dt><dd>${esc(x.publisher?.login || '—')}</dd></div><div><dt>License</dt><dd>${esc(x.license || 'none found')}</dd></div><div style="grid-column:1/-1"><dt>Location</dt><dd class="mono sm px-path">${esc(where)}</dd></div></div>
      ${x.method === 'manual' ? `<button class="btn sm" data-a="manual" data-k="${esc(i.key)}">${icon('i-book')}Show official install steps</button>` : ''}` : ''}
    <h3>Features <span class="muted sm">what it adds</span></h3>${feats.length ? `<div class="px-feat">${feats.map(([t, v]) => `<div data-tip="${esc(v.join(', '))}">${icon('i-check')}<span><b>${v.length} ${t}</b><small>${esc(v.slice(0, 4).join(', '))}${v.length > 4 ? '…' : ''}</small></span></div>`).join('')}</div>` : '<p class="muted sm">No component list available.</p>'}
    ${x.copies?.length ? `<h3>Also loaded as <span class="muted sm">same tool, listed once here</span></h3><div class="px-chk">${x.copies.map(c => `<div class="ok">${icon('i-layers')}<span>Skill · ${esc(c.source === 'plugin' || c.source === 'app plugin' ? 'inside this plugin' : SRC[c.source])}<small class="mono px-path">${esc(c.path)}</small></span></div>`).join('')}</div>` : ''}
    <h3>Requirements &amp; permissions</h3><div class="px-chk">${perms(i).map(([lvl, t]) => `<div class="${lvl}">${icon(lvl === 'ok' ? 'i-check' : 'i-bolt')}<span>${t}</span></div>`).join('')}</div>`}
    ${recsFor(i).length ? `<h3>Recommendations</h3><div class="px-rl">${recsFor(i).map(r => `<div class="px-r"><span class="tg ${r.lvl}">${esc(r.tag)}</span><small>${esc(r.t)}</small>${r.prompt ? `<button class="btn sm ghost" data-a="copy" data-v="${esc(r.prompt)}" data-tip="Copies a prompt you can give Claude. Nothing is changed here.">Copy prompt</button>` : ''}</div>`).join('')}</div>` : ''}`;
}
function perms(i) {
  const c = i.comp || {}, x = i.x, out = [['ok', i.kind === 'mine' && x.method !== 'plugin' ? (x.method === 'skill' ? 'Claude Code (reads ~/.claude/skills)' : 'Its own runtime: see the install steps') : 'Claude Code (plugins need the /plugin system)']];
  if (c.hooks?.length) out.push(['no', `Runs commands automatically on: ${esc(c.hooks.join(', '))}`]);
  if (c.mcp?.length) out.push(['no', `Starts ${c.mcp.length} MCP server process${c.mcp.length > 1 ? 'es' : ''} (${esc(c.mcp.map(m => m.name).join(', '))}); may need its own app, key or account`]);
  if (x.lsp?.length) out.push(['no', `Starts a language server for ${esc(x.lsp.join(', '))}; needs that language's tools installed`]);
  if (!c.hooks?.length && !c.mcp?.length && !x.lsp?.length) out.push(['ok', 'Nothing runs on its own: skills, commands and agents are text Claude reads when used']);
  out.push(x.deps?.length ? ['no', `May need: ${esc(x.deps.join(', '))} (from its install steps)`] : ['ok', i.kind === 'catalog' ? 'Dependencies: none declared in the catalog' : 'Dependencies: none declared']);
  return out;
}
function checks(i) {
  const x = i.x, out = [], iss = issuesFor(i.name);
  if (i.kind === 'mine') { const [ok, why] = installable(i); out.push([ok || i.inst, ok ? 'Can be installed here after your confirmation' : why]); for (const f of x.findings || []) if (f.lvl !== 'note') out.push([f.lvl === 'ok', f.t]); return out; }
  if (i.kind === 'skill') { out.push([x.ok, x.ok ? 'SKILL.md found' : 'SKILL.md missing: it can\'t load']); out.push([x.hasDesc, x.hasDesc ? 'Has a description, so Claude knows when to use it' : 'No description: Claude can\'t tell when to use it']); out.push([x.description.length <= 1024, `Description ${x.description.length} / 1,024 characters`]); }
  else if (i.kind === 'catalog' && !i.inst) {
    const clash = clashOf(x);
    out.push([true, 'Claude Code plugin format (listed in your local catalog)']);
    out.push([!clash.length, clash.length ? `Same skill names as yours: ${clash.join(', ')}. Both would be listed and Claude may pick the wrong one.` : 'No skill-name clash with what you have']);
    out.push([!!x.components, x.components ? 'Component list known from the catalog' : 'No component list: contents unknown until installed']);
  } else { const p = i.p || x; out.push([p.ok !== false, p.ok !== false ? 'Files present on disk' : 'Folder missing: reinstall it']); if (p.enabled != null) out.push([p.enabled, p.enabled ? 'Enabled in settings.json' : 'Disabled in settings.json']); out.push([!p.update, p.update ? 'A newer version is in your catalog' : 'Current with your local catalog']); }
  for (const s of iss) out.push([false, s.text + (s.fix ? ' Fix: ' + s.fix : '')]);
  return out;
}
const compatP = i => `<div class="px-st">${stTag(stOf(i))}<span class="muted sm">${esc(ST[stOf(i)][2])}</span></div><div class="px-chk">${checks(i).map(([ok, t]) => `<div class="${ok ? 'ok' : 'no'}">${icon(ok ? 'i-check' : 'i-x')}<span>${esc(t)}</span></div>`).join('')}</div>`;
function securityP(i) {
  const x = i.x, c = i.comp, auto = autoOf(c);
  if (i.kind === 'mine') return `${finds(x.findings || [])}${auto.length ? `<div class="px-chk"><div class="no">${icon('i-bolt')}<span>Runs automatically: ${esc(auto.join(', '))}</span></div></div>` : ''}
    <p class="px-note">${icon('i-search')}Read from the repo's file list and README when you added it. ${i.inst ? 'Installed files are scanned under Installed.' : 'Its code is scanned after install.'} No findings is not proof of safety.</p>`;
  const trust = i.kind === 'skill' ? (x.source === 'custom' ? 'Your own skill folder' : x.owner ? 'Bundled with ' + x.owner : 'Synced from the Claude app')
    : `${x.reviewed ? 'Anthropic-reviewed in the plugin directory' : 'Not marked as Anthropic-reviewed'} · ${esc(x.market || '')}${x.external ? ` · code from an outside repo${x.sha ? ' pinned at ' + esc(x.sha.slice(0, 7)) : ' (not pinned)'}` : ''}`;
  const head = `<div class="px-chk"><div class="${x.reviewed || i.kind === 'skill' ? 'ok' : 'no'}">${icon(x.reviewed ? 'i-check' : 'i-shield')}<span>${trust}</span></div>
    ${i.kind !== 'skill' ? `<div class="${auto.length ? 'no' : 'ok'}">${icon(auto.length ? 'i-bolt' : 'i-check')}<span>${auto.length ? 'Runs automatically: ' + esc(auto.join(', ')) : 'Nothing runs automatically'}</span></div>` : ''}</div>`;
  if (i.kind === 'catalog' && !i.inst) return head + `<p class="px-note">${icon('i-search')}Not scanned: its files aren't on this PC until installed. After installing, the scan runs on the next check. Absence of findings is not proof of safety.</p>`;
  const sc = (i.p || x).scan; if (!sc) return head + '<p class="muted sm">Not scanned.</p>';
  return head + `<div class="px-sc1">${riskChip((i.p || x).risk)}<span class="muted sm">${sc.files} files · ${sc.code} code · ${bytes(sc.bytes)}</span></div><div class="px-sig">${sigTags(sc)}</div>
    <p class="px-note">${icon('i-shield')}Static scan for risky patterns (network, processes, deletes, environment). It doesn't run code and can't prove safety.</p>`;
}
function perfP(i) {
  const x = i.x, e = eff(i.name), t = i.p?.tokens || x.tokens;
  return `<div class="dl g2"><div><dt>Startup cost</dt><dd>${i.tok == null ? '—' : (i.tokSrc === 'est' ? '~' : '') + tok(i.tok)} tokens / session ${chip(i.tokSrc === 'est' ? 'est' : 'live', i.tokSrc === 'est' ? 'Estimate: name + description characters ÷ 4.' : 'Catalog token count for the skill list.')}</dd></div>
    <div><dt>When its skills load</dt><dd>${t?.on_invoke ? 'up to ' + tok(t.on_invoke) : i.kind === 'skill' ? '~' + tok(Math.round(x.invokeChars / 4)) : '—'}</dd></div>
    <div><dt>Sessions used</dt><dd>${e ? e.sessions : i.inst ? '0 in your logs' : 'not installed'}</dd></div><div><dt>Uses</dt><dd>${e ? e.uses : '—'}</dd></div>
    ${e ? `<div><dt>Tokens / session</dt><dd>${e.cost ? '~' + tok(e.cost) : '—'}</dd></div><div><dt>Verdict</dt><dd>${esc(e.status)}${e.expensive ? ' · costly' : ''}</dd></div><div style="grid-column:1/-1"><dt>Why</dt><dd class="sm">${esc(e.why)}</dd></div>` : ''}</div>
    <p class="px-note">${icon('i-gauge')}Measured from your own session logs. No ratings or savings are invented.</p>`;
}
function updatesP(i) {
  const p = i.p, c = inv.catalog.find(x => x.id === (p?.id || i.x.id));
  if (!p) return `<div class="dl g2"><div><dt>Catalog version</dt><dd>${esc(c?.version || (c?.sha || '').slice(0, 12) || '—')}</dd></div><div><dt>Catalog updated</dt><dd>${day(c?.updated)}</dd></div></div><p class="muted sm">Not installed.</p>`;
  return `<div class="dl g2"><div><dt>Installed</dt><dd class="mono">${esc(p.version.slice(0, 14))}</dd></div><div><dt>Catalog</dt><dd class="mono">${esc(p.update ? p.update.to : c ? (c.version || (c.sha || '').slice(0, 12) || 'same') : 'not checkable')}</dd></div>
    <div><dt>Last updated</dt><dd>${day(p.updated)}</dd></div><div><dt>Old cached copies</dt><dd>${p.oldVersions || 0}</dd></div></div>
    ${p.update ? `<p class="px-note">${icon('i-undo')}${esc(p.update.note || `Update ${p.update.from} → ${p.update.to}.`)} Restart Claude Code after updating.</p>` : `<p class="muted sm">${c ? 'Up to date with your local catalog.' : cli(p) ? 'Its marketplace is not in your local catalogs, so updates can\'t be checked.' : 'Updated by the Claude app.'}</p>`}`;
}

// ---------- actions: preview → confirm → run → verify ----------
function dlg(h, mode = '') { const d = $('x-dlg'); d.dataset.mode = mode; d.innerHTML = `<form method="dialog" class="lx-f">${h}</form>`; if (!d.open) d.showModal(); paint(); return d; }
const dlgHead = (ic, t) => `<div class="card-h">${icon(ic)}<h2 id="x-dlg-t">${t}</h2><div class="end"><button class="btn sm ghost" value="x" aria-label="Close">${icon('i-x')}</button></div></div>`;
async function opPreview(op, i) {
  const m = i.kind === 'mine', x = i.x, [V, ic] = VERB[op], title = `${V}: ${esc(x.name)}`;
  dlg(dlgHead(ic, title) + stateBox('loading', 'Checking…'));
  const r = await post(m ? { op: 'prepare', action: op, key: x.key } : { op: 'prepare', action: op, id: x.id });
  if (r.res !== 'ok') return dlg(dlgHead(ic, title) + stateBox('error', `Couldn't ${op} ${x.name}`, why(r.res)) + '<div class="lx-fa"><button class="btn" value="x">Close</button></div>');
  const c = i.comp || {}, t = x.tokens, auto = autoOf(c), F = m ? (x.findings || []).filter(f => f.lvl === 'warn' || f.lvl === 'bad') : [], clash = op === 'install' && !m ? clashOf(x) : [];
  const risky = op === 'install' && (m ? F.length || auto.length : !x.reviewed || auto.length), sk = m && x.method === 'skill';
  const comps = [['skill', c.skills], ['command', c.commands], ['agent', c.agents], ['hook', c.hooks], ['MCP server', (c.mcp || []).map(m => m.name)], ['LSP server', x.lsp]].filter(([, v]) => v?.length).map(([n, v]) => `${v.length} ${n}${v.length > 1 ? 's' : ''} (${esc(v.join(', '))})`).join('; ');
  const loc = sk ? esc(r.dest) : `~/.claude/plugins/cache/${esc(x.market)}/${esc(x.name)}/`;
  const CH = { install: sk ? `Creates ${loc} with the skill's files and a .nexus-source.json note of where it came from. Nothing else changes. New Claude Code sessions load it.`
      : `${r.steps.length > 1 ? `Adds the marketplace "${esc(x.market)}" to known_marketplaces.json and settings.json, then downloads` : 'Downloads'} the plugin into ${loc}, adds it to installed_plugins.json and enables it in settings.json (user scope).`,
    update: sk ? `Downloads the repo again, moves the current folder to removed-skills/ (kept, restorable), and copies the new files into ${loc}.` : `Downloads the newer version into ${loc} and switches to it. Restart Claude Code to load it.`,
    enable: 'Sets it to enabled in settings.json. It loads in new Claude Code sessions.', disable: 'Sets it to disabled in settings.json. Files stay; enable again any time.',
    uninstall: sk ? `Moves ${loc} to removed-skills/ in the tracker folder (restore by moving it back). My Catalog keeps the entry.` : 'Removes it from installed_plugins.json and settings.json. Its data folder is kept (--keep-data). My Catalog keeps any entry for it.' };
  const src = m ? `${x.repo ? ghLink(x.repo) : esc(x.market)} · by ${esc(x.publisher?.login || '?')}${x.publisher?.type && x.publisher.type !== 'catalog' ? ` (${x.publisher.type === 'Organization' ? 'organization' : 'personal account'})` : ''}${x.license ? ' · ' + esc(x.license) : ' · <b class="px-warn">no license</b>'}`
    : `${esc(x.market || '')}${x.repo ? ` · <a href="${esc(x.repo)}" target="_blank" rel="noopener noreferrer">${esc(x.repo.replace(/^https:\/\//, ''))}</a>` : ''}${x.sha ? ' @ ' + esc(x.sha.slice(0, 7)) : ''} · ${x.reviewed ? 'Anthropic-reviewed' : '<b class="px-warn">not marked as Anthropic-reviewed</b>'}`;
  const rows = [['Source', src], ['Type', `${esc(i.type)}${m ? ' · ' + esc((METHOD[x.method] || [x.method])[0]) : ''}`], ['About', `${esc(x.description || '(no description)')}${(op === 'update' && !m) ? '' : ` <small class="muted">Version: ${esc((op === 'update' && x.update ? `${x.update.from} → ${x.update.to}` : (i.p?.version || x.version || (x.sha || '').slice(0, 7) || 'latest on its default branch')).slice(0, 40))}</small>`}`],
    ...(op === 'install' || op === 'update' ? [['Adds', comps || 'No component list'], ['Permissions', auto.length ? `<b class="px-warn">Runs on its own:</b> ${esc(auto.join(', '))}` : 'Nothing runs on its own'], ['Dependencies', x.deps?.length ? `May need ${esc(x.deps.join(', '))} (from its install steps)` : 'None declared'],
      ...(m ? [['Findings', F.length ? F.map(f => `<span class="${f.lvl === 'bad' ? 'px-warn' : ''}">${esc(f.t)}</span>`).join('<br>') : 'No warnings']] : [['Startup cost', t ? `${tok(t.always_on)} tokens every session · up to ${tok(t.on_invoke)} when its skills load (catalog count)` : 'Unknown']])] : []),
    ...(op === 'install' && !m ? [['Compatibility', clash.length ? `<b class="px-warn">Same skill names as yours:</b> ${esc(clash.join(', '))}` : 'No clashes found with what you have']] : []),
    ['Location', `<code>${loc}</code>`], ['Changes', CH[op]],
    ['Steps', `${r.steps.map((s, n) => `<code>${r.steps.length > 1 ? n + 1 + '. ' : ''}${esc(s)}</code>`).join('<br>')}<small class="muted">${sk ? 'git downloads the repo into a temporary folder that is deleted afterwards. Nothing from the repo is run.' : 'Official Claude Code CLI, run by the local tracker. If the plugin needs a marketplace-declared command, NEXUS stops and asks you to run it in a terminal.'}</small>`]];
  dlg(dlgHead(ic, `${V} preview: ${esc(x.name)}`) + `<dl class="lx-dl">${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>
    ${risky ? `<label class="px-ack"><input type="checkbox" id="x-ack"> I've read the findings and the source. ${auto.length ? 'It runs code automatically on my PC.' : m ? 'I accept the warnings above.' : 'It is not Anthropic-reviewed.'}</label>` : ''}
    <div class="lx-fa"><span class="muted sm px-exp">Confirmation valid for 2 minutes.</span><button class="btn ghost" value="x">Cancel</button><button class="btn ${op === 'uninstall' || op === 'disable' ? 'px-danger' : 'pri'}" type="button" data-a="confirm" data-v="${esc(r.token)}" data-op="${op}" data-k="${esc(i.key)}" ${risky ? 'disabled' : ''}>${icon(ic)}${V}</button></div>`);
}
async function confirmOp(token, op, key) {
  const r = await post({ op: 'run', token });
  if (r.res !== 'ok') return dlg(dlgHead('i-x', 'Not started') + stateBox('error', 'The action did not start.', why(r.res)) + `<div class="lx-fa"><button class="btn ghost" value="x">Close</button><button class="btn pri" type="button" data-a="op" data-op="${op}" data-k="${esc(key)}">Try again</button></div>`);
  ops.job = r.job; progress(true); jobBar(); clearInterval(poller); poller = setInterval(pollJob, 1000);
}
function progress(force) {
  const j = ops.job, d = $('x-dlg'); if (!j || !d || (!force && (!d.open || d.dataset.mode !== 'job'))) return;
  const [V, ic, ing] = VERB[j.action], name = j.name || j.id.split('@')[0];
  const list = `<ol class="px-steps">${(j.steps || [j.cmd]).map((s, n) => `<li class="${j.state === 'running' ? (n < j.step ? 'ok' : n === j.step && !down ? 'run' : '') : j.state === 'done' ? 'ok' : n < j.step ? 'ok' : n === j.step ? 'bad' : ''}"><code>${esc(s)}</code></li>`).join('')}</ol>`;
  if (j.state === 'running' && down) return dlg(dlgHead('i-bolt', `${V}: outcome unknown`) + `<div class="px-res" role="status">${icon('i-bolt')}<div><b>${esc(name)}</b><span>Lost contact with the tracker ${ago(lost)}, about ${Math.max(0, Math.round((lost - j.start) / 1000))} s into the job, at step ${j.step + 1} of ${(j.steps || [1]).length}. It may still be running or may already have finished. NEXUS can't tell until the tracker answers, so this is not shown as a failure.</span>
    <small class="muted">${esc(retryText())} The result shows here once the tracker answers.</small></div></div>${list}
    <div class="lx-fa"><button class="btn ghost" value="x">Hide</button><button class="btn px-danger" type="button" data-a="cancel" data-v="${esc(j.n)}">Cancel</button></div>`, 'job'); // B92: unknown, not failed and not progressing
  if (j.state === 'running') return dlg(dlgHead(ic, `${ing} ${esc(name)}…`) + `<div class="px-prog"><span class="spin"></span><div><b>${ing} ${esc(name)}</b><small class="muted">${Math.round((Date.now() - j.start) / 1000)} s · step ${j.step + 1} of ${(j.steps || [1]).length}</small></div></div>${list}
    <div class="lx-fa"><button class="btn ghost" value="x" data-tip="Closes this window; the job keeps running and NEXUS tells you when it ends.">Hide</button><button class="btn px-danger" type="button" data-a="cancel" data-v="${esc(j.n)}">Cancel</button></div>`, 'job');
  const ok = j.state === 'done';
  dlg(dlgHead(ok ? 'i-check' : 'i-x', ok ? `${V} complete` : j.state === 'cancelled' ? 'Cancelled' : `${V} failed`) + `<div class="px-res ${ok ? 'ok' : 'bad'}">${icon(ok ? 'i-check' : 'i-x')}<div><b>${esc(name)}</b><span>${esc(j.message)}</span>
    <small class="muted">${ok ? `Verified: ${j.kind === 'skill' ? 'the skill folder' : 'the installed plugin list'} shows the change.` : j.verified ? 'The installed list shows the change anyway.' : 'Verified: nothing changed in the installed list.'}${j.code ? ' · code ' + esc(j.code) : ''}</small></div></div>${list}
    ${j.terminal ? `<p class="px-note">${icon('i-term')}Run in a terminal: <code>claude plugin ${esc(j.action)} ${esc(j.id)}</code></p>` : ''}
    ${!ok && j.state !== 'cancelled' ? `<p class="px-note">${icon('i-undo')}Recovery: nothing is half-applied that NEXUS knows of. ${j.kind === 'skill' ? 'Skill folders that were moved aside are in removed-skills/ in the tracker folder.' : 'Check the Installed tab, then try again or run the step above in a terminal to see the full error.'}</p>` : ''}
    <div class="lx-fa"><button class="btn pri" value="x">Close</button></div>`, 'job');
}
async function pollJob() {
  if (!root) return clearInterval(poller);
  const ok = await loadOps(); progress(); // the end-of-job toast is in loadOps
  if (!ok || ops.job?.state !== 'running') { clearInterval(poller); poller = null; } // B92: no contact = stop asking every second; the app poll brings it back (update → reloadAll → loadOps)
}
function jobBar() {
  const el = $('x-job'), j = ops.job; if (!el) return;
  el.innerHTML = j?.state === 'running' ? `<div class="px-jb">${down ? `${icon('i-bolt')}<span>Lost contact while ${VERB[j.action][2].toLowerCase()} <b>${esc(j.name || j.id)}</b>: outcome unknown until the tracker answers.</span>` : `<span class="spin"></span><span>${VERB[j.action][2]} <b>${esc(j.name || j.id)}</b>… step ${j.step + 1} of ${(j.steps || [1]).length}</span>`}<button class="btn sm" data-a="showjob">Details</button></div>` : '';
}
function historyDlg() {
  const H = ops.history;
  dlg(dlgHead('i-clock', 'Install history') + (H.length ? `<table class="tbl px-t px-ht"><thead><tr><th>When</th><th>Action</th><th>Item</th><th>Result</th></tr></thead><tbody>${H.map(h => `<tr data-tip="${esc(h.message || '')}"><td>${ago(h.at)}</td><td>${esc(VERB[h.action]?.[0] || h.action)}</td><td>${esc(h.name || h.id)}${h.kind === 'skill' ? ' <small class="muted">skill</small>' : ''}</td>
    <td><span class="chip ${h.state === 'done' ? 'ok' : h.state === 'cancelled' ? 'unk' : 'warn'}">${h.state === 'done' ? 'Done · verified' : esc(h.state)}</span></td></tr>`).join('')}</tbody></table>` : stateBox('empty', 'No actions yet.', 'Installs, updates, enables, disables and uninstalls done through NEXUS are listed here.'))
    + '<div class="lx-fa"><button class="btn" value="x">Close</button></div>');
}
function improve(i) {
  const R = recsFor(i).filter(r => r.prompt), x = i.x;
  dlg(dlgHead('i-spark', `Improve preview: ${esc(x.name)}`) + `<dl class="lx-dl"><dt>Now</dt><dd>Description ${x.description.length} chars (~${tok(skillTok(x))} tokens every session) · SKILL.md ${tok(Math.round(x.invokeChars / 4))} tokens when loaded (est.)${eff(x.name)?.sessions ? ` · used in ${eff(x.name).sessions} sessions` : ''}</dd>
    ${R.length ? R.map(r => `<dt>${esc(r.tag)}</dt><dd>${esc(r.t)}<br><small class="muted">${esc(r.prompt)}</small></dd>`).join('') : '<dt>Ideas</dt><dd>Nothing to improve by these rules: description and size are fine.</dd>'}
    <dt>How</dt><dd>Nothing is edited here. Copy the prompt and give it to Claude; it shows a diff before saving.</dd></dl>
    <div class="lx-fa"><button class="btn ghost" value="x">Close</button>${R.length ? `<button class="btn pri" type="button" data-a="copy" data-v="${esc(R.map(r => r.prompt).join('\n'))}">${icon('i-book')}Copy prompt</button>` : ''}</div>`);
}

// ---------- events ----------
async function copy(v) { try { await navigator.clipboard.writeText(v); toast('Copied to clipboard.'); } catch { toast('Copy failed: select and copy it manually.', 'warn'); } }
function focusOf() { const a = document.activeElement; if (!a || a === document.body || !root?.contains(a)) return null;
  const s = a.id ? '#' + CSS.escape(a.id) : a.dataset.a ? `[data-a="${a.dataset.a}"]` + ['k', 'v', 'op'].map(d => a.dataset[d] != null ? `[data-${d}="${CSS.escape(a.dataset[d])}"]` : '').join('') : a.getAttribute('href') ? `[href="${CSS.escape(a.getAttribute('href'))}"]` : null;
  return s && { s, a, p: typeof a.selectionStart === 'number' ? a.selectionStart : null }; }
function refocus(f) { if (!f || f.a.isConnected) return; const n = root?.querySelector(f.s); if (!n) return; n.focus({ preventScroll: true }); if (f.p != null) n.setSelectionRange?.(f.p, f.p); }
function select(k) { sel = k; root.querySelectorAll('.px-c.on').forEach(c => c.classList.remove('on')); root.querySelector(`.px-c[data-k="${CSS.escape(k)}"]`)?.classList.add('on'); detail(); }
async function onClick(e) {
  const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
  const a = b.dataset.a, k = b.dataset.k;
  if (a === 'retry') return poll();
  if (a === 'copy') { e.preventDefault(); b.closest('details')?.removeAttribute('open'); return copy(b.dataset.v); }
  if (a === 'pg') { pg = +b.dataset.v; draw(); return root.querySelector('.px-ws').scrollIntoView({ block: 'nearest' }); }
  if (a === 'goal') { goal = b.dataset.v; pg = 0; return draw(); }
  if (a === 'dsub') { dsub = b.dataset.v; return detail(); }
  if (a === 'history') return historyDlg();
  if (a === 'showjob') return progress(true);
  if (a === 'add') return addDlg(b.dataset.v);
  if (a === 'review') return reviewDlg(b.dataset.v);
  if (a === 'check') { e.preventDefault(); const v = $('x-src').value.trim(); if (!v) return $('x-src').focus(); return check(v, b.dataset.from, b.dataset.v); }
  if (a === 'additem') { e.preventDefault(); const box = $('x-res'); b.disabled = true; b.classList.add('busy');
    const r = await cat({ op: 'add', source: box.dataset.src, name: b.dataset.v, from: b.dataset.from });
    if (r.res !== 'ok') { b.disabled = false; b.classList.remove('busy'); return toast(why(r.res), 'err', 'Not added to My Catalog'); }
    b.outerHTML = `<span class="chip ok">${icon('i-check')}Added to My Catalog</span>`; toast(`${b.dataset.v} added to My Catalog. Nothing was installed.`); await Promise.all([loadMine(), loadOps()]); return draw(); }
  if (a === 'decide') { e.preventDefault(); const r = await cat({ op: 'decide', repo: b.dataset.r, state: b.dataset.v }); if (r.res !== 'ok') return toast(why(r.res), 'err', "Couldn't save the decision");
    $('x-dlg').close(); await loadMine(); return toast(b.dataset.v === 'pending' ? 'Decision undone.' : `${b.dataset.r}: ${DEC[b.dataset.v][1].toLowerCase()}. Nothing was added.`); }
  if (a === 'rmok') { e.preventDefault(); const r = await cat({ op: 'remove', key: k }); $('x-dlg').close(); if (r.res !== 'ok') return toast(why(r.res), 'err', "Couldn't remove it from My Catalog"); sel = null; await Promise.all([loadMine(), loadOps()]); draw(); return toast('Removed from My Catalog. Nothing was uninstalled.'); }
  if (a === 'skup') { b.disabled = true; b.classList.add('busy'); const r = await post({ op: 'skillUpdates' }); if (r.res !== 'ok') { draw(); return toast(why(r.res), 'err', "Couldn't check skill repos"); } skUp = r.skills || {}; draw(); return toast('Checked skill repos.'); }
  if (a === 'cancel') { b.disabled = true; const r = await post({ op: 'cancel', job: b.dataset.v }); if (r.res !== 'ok') toast(why(r.res), 'err', "Couldn't cancel"); return pollJob(); }
  if (a === 'confirm') { e.preventDefault(); b.disabled = true; b.classList.add('busy'); return confirmOp(b.dataset.v, b.dataset.op, k); }
  if (a === 'refresh') { b.disabled = true; b.classList.add('busy'); await reloadAll(); b.disabled = false; b.classList.remove('busy');
    if (err || netDown) return toast(why(netDown ? NET : err), 'err', 'Check failed');
    return toast(!err ? `Checked on this PC: ${inv.plugins.length} plugins, ${inv.skills.length} skills, ${mine.items.length} in My Catalog, ${inv.plugins.filter(p => p.update).length} updates.` : 'Check failed: ' + err, !err ? 'ok' : 'warn'); }
  if (['sel', 'op', 'improve', 'addid', 'manual', 'rm'].includes(a)) {
    e.stopPropagation(); e.preventDefault(); if (k !== sel) select(k); const i = findSel(); if (!i) return;
    if (a === 'op') { if (ops.job?.state === 'running') return toast('Another action is still running.', 'warn'); return opPreview(b.dataset.op, i.kind === 'mine' && i.p && b.dataset.op !== 'install' ? rowOf('plugin', i.p) : i.kind === 'mine' || b.dataset.op === 'install' ? i : { ...i, x: i.p || i.x }); }
    if (a === 'improve') return improve(i);
    if (a === 'addid') return addDlg('plugin', i.x.id, 'discover');
    if (a === 'manual') return manualDlg(i);
    if (a === 'rm') return removeDlg(i);
    if (innerWidth <= 1280) $('x-det').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
function onInput(e) {
  const t = e.target, ch = e.type === 'change';
  if (t.id === 'x-ack') { const c = $('x-dlg').querySelector('[data-a="confirm"]'); if (c) c.disabled = !t.checked || down; return; }
  if (t.id === 'x-q') { q = t.value; pg = 0; const p = t.selectionStart; draw(); const n = $('x-q'); n.focus(); n.setSelectionRange(p, p); }
  else if (ch && t.id === 'x-ft') { ft = t.value; pg = 0; draw(); }
  else if (ch && t.id === 'x-fs') { fs = t.value; pg = 0; draw(); }
  else if (ch && t.id === 'x-sort') { sort = t.value; pg = 0; draw(); }
  else if (ch && t.id === 'x-per') { per = +t.value; pg = 0; draw(); }
}
