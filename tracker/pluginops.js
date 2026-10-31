// Plugin and skill actions for the NEXUS Plugins & Skills page. Two steps: prepare (validates, returns a one-time token bound to the plan, 2 min)
// then run (needs that token). One job at a time; every result is verified by re-reading what Claude Code reads, not by trusting the CLI.
// - Installed Claude Code plugins (by id): `claude plugin update|enable|disable|uninstall <id> --json`.
// - My Catalog plugins (by key): `claude plugin marketplace add <owner/repo> --json` when the marketplace is new, then `claude plugin install <id> --json`.
// - My Catalog skills (by key): git clone (depth 1) to a temp folder, copy the skill folder into ~/.claude/skills/<name> with a .nexus-source.json marker.
//   Uninstall moves the folder to removed-skills/ (restorable), and only for folders NEXUS installed. Update = fresh copy, old one moved aside.
// - MCP servers and external apps: never run here (manual, shown on the page).
// Never passes -y / --accept-command: a marketplace-declared command must be confirmed by the user in a terminal.
const RED = require('./redact.js'); // M4c: home → ~ and secrets masked in logs, exports and error text (spec §26.8)
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), { execFile } = require('child_process');
const DATA = process.env.NEXUS_DATA || __dirname, HIST = path.join(DATA, 'plugin-history.json'), BIN = path.join(DATA, 'removed-skills'), ID = /^[a-z0-9][a-z0-9._-]{0,63}@[a-z0-9][a-z0-9._-]{0,63}$/i;
const SKILLS = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills'), MARK = '.nexus-source.json';
const ACTIONS = { install: 'Install', uninstall: 'Uninstall', enable: 'Enable', disable: 'Disable', update: 'Update' };
const EXE = (() => { const f = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'); return fs.existsSync(f) ? f : 'claude' })();
const tokens = new Map(); let job = null;
const inv = r => require('./inv.js')(r), cat = () => require('./catalog.js').load();
const hist = () => { try { return JSON.parse(fs.readFileSync(HIST, 'utf8')) } catch { return [] } };
const save = h => fs.writeFileSync(HIST, RED(JSON.stringify(h.slice(0, 200), null, 1)));
const marker = name => { try { return JSON.parse(fs.readFileSync(path.join(SKILLS, name, MARK), 'utf8')) } catch { return null } };

// What an action on an installed plugin must find before it may run; returns an error string or null.
function check(action, id, I = inv(true)) {
  if (!Object.hasOwn(ACTIONS, action)) return 'unknown action';
  if (typeof id !== 'string' || !ID.test(id)) return 'bad plugin id';
  const p = I.plugins.find(x => x.id === id && x.kind === 'plugin'), c = I.catalog.find(x => x.id === id);
  if (action === 'install') return p ? 'already installed' : c ? null : 'not in your local marketplace catalogs';
  if (!p) return 'not an installed Claude Code plugin';
  if (action === 'enable' && p.enabled !== false) return 'already enabled';
  if (action === 'disable' && p.enabled === false) return 'already disabled';
  if (action === 'update' && !c) return 'its marketplace is not in your local catalogs';
  return null;
}
// The steps an action takes, or { e } when it may not run. Shown in the preview exactly as they will run.
function plan({ action, id, key }) {
  if (!Object.hasOwn(ACTIONS, action)) return { e: 'unknown action' };
  const I = inv(true);
  if (key == null) { const e = check(action, id, I); if (e) return { e };
    if (action === 'install' && !cat().items.some(x => x.id === id)) return { e: 'not in My Catalog: add it there first' };
    return { kind: 'plugin', id, name: id.split('@')[0], steps: [['cli', ['plugin', action, id, ...(action === 'uninstall' ? ['--keep-data'] : []), '--json']]] } }
  const e = typeof key === 'string' && cat().items.find(x => x.key === key); if (!e) return { e: 'not in My Catalog' };
  if (e.method === 'plugin') {
    if (action !== 'install') return plan({ action, id: e.id });
    if (I.plugins.some(p => p.id === e.id)) return { e: 'already installed' };
    const m = I.markets.find(x => x.name === e.market), steps = [];
    if (m && e.repo && m.repo && m.repo.toLowerCase().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '') !== e.repo.toLowerCase()) return { e: `a different marketplace named "${e.market}" is already added (${m.repo}). Remove that one first in Claude Code` };
    if (!m) { if (!e.repo) return { e: 'no repo to add its marketplace from' }; steps.push(['cli', ['plugin', 'marketplace', 'add', e.repo, '--json']]) }
    else if (!I.catalog.some(c => c.id === e.id)) return { e: `${e.market} is added but doesn't list ${e.name}. Update the marketplace in Claude Code (claude plugin marketplace update ${e.market})` };
    steps.push(['cli', ['plugin', 'install', e.id, '--json']]);
    return { kind: 'plugin', id: e.id, name: e.name, key, market: !m && e.market, steps };
  }
  if (e.method !== 'skill') return { e: e.method === 'manual' ? 'NEXUS doesn\'t install this type: follow its own instructions' : 'this repo can\'t be installed from here' };
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(e.name) || !/^[\w.-]+\/[\w.-]+$/.test(e.repo)) return { e: 'bad skill name or repo' };
  const dest = path.join(SKILLS, e.name), mk = marker(e.name), there = fs.existsSync(dest);
  if (action === 'install' && there) return { e: mk ? 'already installed' : `a skill folder named "${e.name}" already exists (not from NEXUS). Nothing is overwritten` };
  if (action !== 'install' && (!there || mk?.repo?.toLowerCase() !== e.repo.toLowerCase())) return { e: there ? 'that skill folder wasn\'t installed by NEXUS from this repo, so NEXUS won\'t touch it' : 'not installed' };
  if (!['install', 'update', 'uninstall'].includes(action)) return { e: 'skills can only be installed, updated or uninstalled' };
  const url = `https://github.com/${e.repo}.git`, clone = ['git', ['clone', '--depth', '1', ...(e.ref ? ['--branch', e.ref] : []), '--', url, '<temp>']], move = ['move', dest, path.join(BIN, e.name + '-' + new Date().toISOString().replace(/[:.]/g, '-'))];
  return { kind: 'skill', id: e.key, name: e.name, key, dest, entry: e, steps: action === 'install' ? [clone, ['copy', e.dir || '', dest]] : action === 'uninstall' ? [move] : [clone, move, ['copy', e.dir || '', dest]] };
}
const show = s => s[0] === 'cli' ? 'claude ' + s[1].join(' ') : s[0] === 'git' ? 'git ' + s[1].join(' ') : s[0] === 'copy' ? `copy ${s[1] || '(repo root)'} → ${s[2]}` : `move ${s[1]} → ${s[2]}`;
// Did the change really happen? Read the files Claude Code reads.
function verify(action, P, from) {
  if (P.kind === 'skill') return action === 'uninstall' ? !fs.existsSync(P.dest) : fs.existsSync(path.join(P.dest, 'SKILL.md')) && marker(P.name)?.at >= from;
  const p = inv(true).plugins.find(x => x.id === P.id && x.kind === 'plugin');
  return { install: !!p, uninstall: !p, enable: p?.enabled === true, disable: p?.enabled === false, update: !!p && (p.version !== from || !p.update) }[action];
}

function prepare(o) {
  const P = plan(o); if (P.e) return { res: P.e };
  for (const [k, v] of tokens) if (v.exp < Date.now()) tokens.delete(k);
  const token = crypto.randomBytes(16).toString('hex'); tokens.set(token, { action: o.action, id: o.id, key: o.key, exp: Date.now() + 120e3 });
  return { res: 'ok', token, cmd: P.steps.map(show).join('\n'), steps: P.steps.map(show), dest: P.dest || null, expires: 120 };
}
const lastJson = out => { for (const l of String(out).split('\n').reverse()) { try { return JSON.parse(l) } catch { } } return null };
const sh = (j, exe, args) => new Promise((ok, no) => {
  // cwd is not the home folder: there the CLI also reads ~/.claude/settings.json as project settings, so an isolated test would write to it.
  j.child = execFile(exe, args, { cwd: DATA, timeout: 300e3, windowsHide: true, maxBuffer: 1 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, out, errOut) => {
    j.child = null; if (j.cancelled) return no(Error('cancelled'));
    const r = exe === EXE ? lastJson(out) : null;
    if (r?.shownCommand) return no(Object.assign(Error('This plugin runs a command from its marketplace to install. NEXUS never accepts those for you: run the command below in a terminal to review and confirm it.'), { code: r.failureCode, terminal: true }));
    if (err || r?.outcome === 'failed') return no(Object.assign(Error(r?.message || (err?.killed ? 'Timed out after 5 minutes.' : String(errOut || err?.message || '').trim().split('\n').pop() || 'Failed.')), { code: r?.failureCode }));
    ok({ out: String(out), r });
  });
});
async function steps(j, P) {
  let tmp = null;
  try {
    for (const [i, s] of P.steps.entries()) {
      j.step = i; if (j.cancelled) throw Error('cancelled');
      if (s[0] === 'cli') { const { r } = await sh(j, EXE, s[1]); j.message = r?.message || j.message;
        if (s[1][1] === 'marketplace' && !inv(true).markets.some(m => m.name === P.market)) throw Error(`The marketplace was added, but not under the name "${P.market}" this catalog entry expects. Nothing was installed.`) }
      else if (s[0] === 'git') { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-skill-')); await sh(j, 'git', s[1].map(a => a === '<temp>' ? tmp : a)); j.sha = (await sh(j, 'git', ['-C', tmp, 'rev-parse', 'HEAD'])).out.trim() }
      else if (s[0] === 'move') { fs.mkdirSync(BIN, { recursive: true }); fs.renameSync(s[1], s[2]); j.moved = s[2] }
      else if (s[0] === 'copy') {
        const src = path.resolve(tmp, s[1]); if (!src.startsWith(tmp) || !fs.existsSync(path.join(src, 'SKILL.md'))) throw Error('SKILL.md not found in the downloaded repo. Nothing was installed.');
        fs.cpSync(src, s[2], { recursive: true, errorOnExist: true, force: false, filter: f => path.basename(f) !== '.git' });
        fs.writeFileSync(path.join(s[2], MARK), JSON.stringify({ repo: P.entry.repo, dir: P.entry.dir || '', ref: P.entry.ref || null, sha: j.sha, at: Date.now(), key: P.key }, null, 1));
      }
    }
    return null;
  } catch (e) {
    if (j.moved && j.action === 'update' && !fs.existsSync(P.dest)) { try { fs.renameSync(j.moved, P.dest); j.restored = true } catch { } } // failed update: put the old copy back
    return e;
  } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) }
}
function run({ token }) {
  const t = typeof token === 'string' && tokens.get(token); if (!t || t.exp < Date.now()) return { res: 'confirmation expired: open the preview again' };
  tokens.delete(token);
  if (job?.state === 'running') return { res: 'another plugin action is still running' };
  const P = plan(t); if (P.e) return { res: P.e };
  job = { n: crypto.randomBytes(6).toString('hex'), action: t.action, id: P.id, name: P.name, kind: P.kind, key: P.key || null, cmd: P.steps.map(show).join('\n'), steps: P.steps.map(show), step: 0, state: 'running', start: Date.now(),
    from: P.kind === 'skill' ? Date.now() : inv(false).plugins.find(x => x.id === P.id)?.version || null };
  const j = job;
  steps(j, P).then(err => {
    const ver = verify(j.action, P, j.from);
    j.state = j.cancelled ? 'cancelled' : !err && ver ? 'done' : 'failed';
    j.message = j.cancelled ? `Cancelled. ${ver ? 'The change had already been applied.' : 'Nothing was changed.'}` : err ? RED(err.message) + (j.restored ? ' The previous version was put back.' : '') : j.message || 'Done.';
    if (!err && !ver && !j.cancelled) j.message = 'The steps reported success, but the installed list does not show the change. Nothing is claimed.';
    if (j.state === 'done' && P.kind === 'skill') j.message = j.action === 'uninstall' ? `Moved to ${j.moved} (restore by moving it back).` : `Copied into ${P.dest} at commit ${String(j.sha).slice(0, 7)}. New Claude Code sessions load it.` + (j.moved ? ` Old copy kept in ${j.moved}.` : '');
    j.terminal = !!err?.terminal; j.code = err?.code || null; j.verified = ver; j.end = Date.now();
    const h = hist(); h.unshift({ at: j.start, end: j.end, action: j.action, id: j.id, name: j.name, kind: j.kind, state: j.state, verified: ver, message: j.message, code: j.code, sha: j.sha || null }); save(h);
  });
  return { res: 'ok', job: pub(j) };
}
function cancel({ job: n }) {
  if (!job || job.n !== n || job.state !== 'running') return { res: 'nothing to cancel' };
  job.cancelled = true; job.child?.kill(); return { res: 'ok' };
}
// Skills NEXUS installed: the commit they came from vs the repo's current one (git ls-remote: no GitHub API quota). Read-only.
async function skillUpdates() {
  const out = {}, j = {};
  for (const e of cat().items.filter(x => x.method === 'skill')) { const m = marker(e.name); if (!m || m.repo?.toLowerCase() !== e.repo.toLowerCase()) continue;
    try { const head = (await sh(j, 'git', ['ls-remote', `https://github.com/${e.repo}.git`, e.ref ? 'refs/heads/' + e.ref : 'HEAD'])).out.split('\t')[0].trim(); out[e.key] = { from: m.sha, to: head, update: !!head && head !== m.sha } }
    catch (x) { out[e.key] = { error: x.message } } }
  return { res: 'ok', skills: out };
}
// Install state of every My Catalog entry, read from disk (nothing run).
function states() {
  const I = inv(false);
  return Object.fromEntries(cat().items.map(e => { const p = e.method === 'plugin' && I.plugins.find(x => x.id === e.id);
    return [e.key, e.method === 'plugin' ? (p ? (p.enabled === false ? 'disabled' : 'installed') : 'no')
      : e.method === 'skill' ? (marker(e.name)?.repo?.toLowerCase() === e.repo?.toLowerCase() ? 'installed' : fs.existsSync(path.join(SKILLS, e.name)) ? 'clash' : 'no') : 'manual'] }));
}
const pub = j => j && (({ child, cancelled, moved, restored, ...x }) => x)(j);
module.exports = { status: () => ({ job: pub(job), history: hist().slice(0, 50), cli: EXE, states: states() }),
  post: o => o?.op === 'prepare' ? prepare(o) : o?.op === 'run' ? run(o) : o?.op === 'cancel' ? cancel(o) : o?.op === 'skillUpdates' ? skillUpdates() : { res: 'unknown op' }, check, plan, ACTIONS };
