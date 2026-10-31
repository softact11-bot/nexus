// NEXUS M3 doc sync engine (spec §26.7). Gate (b): engine only, not wired to any page; this PC keeps `bash sync_docs.sh`.
// Pairs: project doc file ↔ <vault>/<vaultFolder>/<note>.md. Three-way: the last synced copy of each pair (the common ancestor)
// is kept per user in <NEXUS data>/sync-base/<projectId>/ with its sha256 in base.json; a missing or damaged ancestor = no guessing.
// plan(): read-only (temp merge files go to the user's temp folder). run(): lock → fresh plan → only items unchanged since the
// preview → one verified backup of every file it will overwrite → atomic writes (temp + fsync + rename + re-read) → new ancestors.
// Never deletes. Never writes through a symlink/junction or outside the project folder / linked vault folder (safepath.guard).
const RED = require('./redact.js'); // M4c: home → ~ and secrets masked in logs, exports and error text (spec §26.8)
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), crypto = require('crypto');
const sp = require('./safepath'), bk = require('./backup'), CF = require('./config');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
// default doc files → the note names sync_docs.sh uses (CLAUDE.md is Claude Code's file: never a default pair)
const DEFAULT = [['PROJECT_DOCS.md', 'Project Docs'], ['PROJECT_MEMORY.md', 'Project Memory'], ['INDEX.md', 'File Index']];
const NOTE_OK = n => typeof n === 'string' && n.length > 0 && n.length < 120 && !/[\\/:*?"<>|\x00-\x1f]/.test(n) && !n.startsWith('.') && n.trim() === n;
const SRC_OK = s => typeof s === 'string' && /\.md$/i.test(s) && !path.isAbsolute(s) && !s.split(/[\\/]/).some(x => x === '..' || x === '' || x.startsWith('.'));

// the pairs of one project: explicit p.pairs, else sync_docs.sh's own table when the project has one, else the default doc files + docs/*.md
function pairs(p) {
  if (Array.isArray(p.pairs)) return p.pairs.map(x => ({ src: x.src, note: x.note }));
  if (fs.existsSync(path.join(p.dir, 'sync_docs.sh'))) try { const L = pairsFromScript(p.dir); if (L.length) return L } catch { }
  return [...DEFAULT.filter(([f]) => fs.existsSync(path.join(p.dir, f))).map(([src, note]) => ({ src, note })), ...docsPairs(p.dir)];
}
const docsPairs = dir => { let d = []; try { d = fs.readdirSync(path.join(dir, 'docs'), { withFileTypes: true }) } catch { }
  return d.filter(e => e.isFile() && /\.md$/i.test(e.name)).map(e => ({ src: 'docs/' + e.name, note: e.name.replace(/\.md$/i, '') })) };
// the pair table of an existing sync_docs.sh (read-only; used for the dry run / parity and, after approval, a migration)
function pairsFromScript(dir) {
  const t = fs.readFileSync(path.join(dir, 'sync_docs.sh'), 'utf8'), L = [...t.matchAll(/^sync1 "\$P\/([^"]+)"\s+"([^"]+)"/gm)].map(m => ({ src: m[1], note: m[2] }));
  if (/for f in "\$P"\/docs\/\*\.md/.test(t)) L.push(...docsPairs(dir));
  return L;
}

// format of a file: BOM, line endings, text or binary; two sides are merged only when these match
function fmt(b) {
  const bom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 'utf8-bom' : b[0] === 0xff && b[1] === 0xfe ? 'utf16le' : b[0] === 0xfe && b[1] === 0xff ? 'utf16be' : '';
  if (bom.startsWith('utf16')) return { bom, eol: '?', text: false };
  const body = bom ? b.subarray(3) : b, text = !body.includes(0) && Buffer.from(body.toString('utf8'), 'utf8').equals(body);
  const crlf = (body.toString('latin1').match(/\r\n/g) || []).length, lf = (body.toString('latin1').match(/\n/g) || []).length;
  return { bom: bom || 'none', eol: !lf ? 'none' : crlf === lf ? 'crlf' : crlf ? 'mixed' : 'lf', text };
}
const sameFmt = (...f) => f.every(x => x.text && x.bom === f[0].bom && (x.eol === f[0].eol || x.eol === 'none' || f[0].eol === 'none'));

// one side of a pair: refuses symlinks / junctions and anything whose real path leaves its root
function side(file, root) {
  const o = { file, exists: false };
  let st; try { st = fs.lstatSync(file) } catch { }
  const r = sp.real(file), R = sp.real(root); if (!sp.within(R, r) || r.toLowerCase() === R.toLowerCase()) return { ...o, refused: 'its real path leads outside ' + root };
  if (st) { if (st.isSymbolicLink()) return { ...o, refused: 'it is a symlink or junction' }; if (!st.isFile()) return { ...o, refused: 'it is not a file' }
    const b = fs.readFileSync(file); return { ...o, exists: true, buf: b, sha: sha(b), fmt: fmt(b) } }
  return o;
}

// project → validated places, or throws with a plain reason
function where(p) {
  if (!p || !p.id || !/^[\w-]{1,64}$/.test(p.id)) throw new Error('Unknown project.');
  if (!p.vault) throw new Error('This project has no linked vault.');
  const d = sp.check(p.dir); if (!d.ok) throw new Error('Project folder refused: ' + d.why);
  const v = sp.check(p.vault); if (!v.ok) throw new Error('Vault refused: ' + v.why);
  if (!fs.existsSync(path.join(v.path, '.obsidian'))) throw new Error('That folder is not an Obsidian vault.');
  const f = (p.vaultFolder || '').replace(/^[\\/]+|[\\/]+$/g, '');
  if (f && f.split(/[\\/]/).some(x => x === '..' || x === '' || x.startsWith('.'))) throw new Error('Bad vault folder.');
  const T = sp.real(f ? path.join(v.path, f) : v.path); if (!sp.within(v.path, T)) throw new Error('The vault folder leads outside the vault (junction or link).');
  if (sp.overlap(d.path, T)) throw new Error('The project folder and the vault folder overlap.');
  const data = CF.dataDir(); return { dir: d.path, T, data, base: path.join(data, 'sync-base', p.id) };
}

function readBase(dir) { const m = readJ(path.join(dir, 'base.json'), null); return m && m.version === 1 && m.notes ? m : null }
function baseOf(W, man, note) {
  const e = man?.notes[note]; if (!e) return { has: false };
  const f = path.join(W.base, note + '.md'); let b; try { b = fs.readFileSync(f) } catch { return { has: true, damaged: 'the last synced copy is missing' } }
  return sha(b) === e.sha ? { has: true, buf: b, sha: e.sha, fmt: fmt(b) } : { has: true, damaged: 'the last synced copy was changed outside NEXUS' };
}

let GIT = null;
function git() { if (GIT !== null) return GIT; for (const g of [process.env.NEXUS_GIT, 'git', 'C:\\Program Files\\Git\\cmd\\git.exe'].filter(Boolean)) { try { if (cp.spawnSync(g, ['--version'], { windowsHide: true }).status === 0) return GIT = g } catch { } } return GIT = '' }
// three-way merge with git merge-file; null = conflict (or git missing)
function merge(ours, base, theirs) {
  const g = git(); if (!g) return null;
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-merge-')), f = n => path.join(t, n);
  try { fs.writeFileSync(f('o'), ours); fs.writeFileSync(f('b'), base); fs.writeFileSync(f('t'), theirs);
    const r = cp.spawnSync(g, ['merge-file', '-p', f('o'), f('b'), f('t')], { windowsHide: true, maxBuffer: 64e6 }); return r.status === 0 ? r.stdout : null }
  finally { fs.rmSync(t, { recursive: true, force: true }) }
}

// what one pair needs. action: same | push | pull | merge | create-vault | conflict | refused | none
function classify(W, man, x) {
  const it = { note: x.note, src: x.src, project: path.join(W.dir, x.src), vault: path.join(W.T, x.note + '.md') };
  if (!NOTE_OK(x.note) || !SRC_OK(x.src)) return { ...it, action: 'refused', why: 'bad file or note name' };
  const s = side(it.project, W.dir), d = side(it.vault, W.T), b = baseOf(W, man, x.note);
  it.sha = { project: s.sha || null, vault: d.sha || null, base: b.sha || null };
  const c = (kind, why) => ({ ...it, action: 'conflict', kind, why });
  if (s.refused || d.refused) return { ...it, action: 'refused', why: 'Not touched: ' + (s.refused ? 'project file: ' + s.refused : 'vault note: ' + d.refused) };
  if (!s.exists && !d.exists) return { ...it, action: 'none', why: 'missing on both sides' };
  const twin = s.exists && !d.exists && !b.has && W.notes?.get(s.sha)?.find(n => n.toLowerCase() !== x.note.toLowerCase());
  if (twin) return c('duplicate-content', 'the vault already has this exact text as "' + twin + '"; creating "' + x.note + '" would make a duplicate note: pick another pair, or leave it');
  if (s.exists && !d.exists) return { ...it, action: 'create-vault', why: b.has ? 'missing in the vault; copied back from the project' : 'new note in the vault' };
  if (!s.exists) return c('missing-project', 'the project file is missing; NEXUS never deletes, pick: copy the vault note back, or leave it');
  if (s.sha === d.sha) return { ...it, action: 'same', why: b.has && b.sha === s.sha ? '' : 'identical; recorded as the last synced copy' };
  if (!b.has) return c('first-sync', 'differs and there is no last synced copy yet: pick which side to keep');
  if (b.damaged) return c('base-damaged', b.damaged + '; cannot tell which side changed');
  if (b.sha === d.sha) return { ...it, action: 'push', why: 'changed in the project' };
  if (b.sha === s.sha) return { ...it, action: 'pull', why: 'changed in the vault' };
  if (!sameFmt(s.fmt, d.fmt, b.fmt)) return c('format', `both sides changed and their encoding or line endings differ (project ${s.fmt.bom}/${s.fmt.eol}, vault ${d.fmt.bom}/${d.fmt.eol})`);
  const m = merge(s.buf, b.buf, d.buf);
  if (!m) return c('same-lines', git() ? 'the same lines were changed in the project and in the vault' : 'both sides changed and Git (needed to merge) is not installed');
  return Object.defineProperty({ ...it, action: 'merge', why: 'changes on both sides combined', merged: sha(m) }, '_m', { value: m }); // merged bytes kept off JSON
}

// read-only preview. opts.baseDir: read another ancestor folder (sync_docs.sh's .sync_base) for comparison only
function plan(p, opts = {}) {
  const W = where(p); if (opts.baseDir) W.base = opts.baseDir;
  const man = opts.baseDir ? { version: 1, notes: Object.fromEntries(fs.readdirSync(opts.baseDir).filter(f => /\.md$/i.test(f)).map(f => [f.slice(0, -3), { sha: sha(fs.readFileSync(path.join(opts.baseDir, f))) }])) } : readBase(W.base);
  const L = opts.pairs || pairs(p), seen = new Map(), items = [];
  W.notes = new Map(); let vf = []; try { vf = fs.readdirSync(W.T, { withFileTypes: true }) } catch { } // sha → existing note names (duplicate-content check)
  for (const e of vf) if (e.isFile() && /\.md$/i.test(e.name)) { const h = side(path.join(W.T, e.name), W.T).sha; if (h) W.notes.set(h, [...(W.notes.get(h) || []), e.name.slice(0, -3)]) }
  for (const x of [...L, ...Object.keys(man?.notes || {}).filter(n => !L.some(y => y.note === n)).map(n => ({ src: man.notes[n].src, note: n }))]) {
    if (!x.src) { items.push({ note: x.note, action: 'conflict', kind: 'missing-project', why: 'synced before, but its project file is no longer listed; NEXUS never deletes' }); continue }
    const k = x.note.toLowerCase(); if (seen.has(k)) { items.push({ note: x.note, src: x.src, action: 'conflict', kind: 'duplicate', why: 'two project files map to the same note (' + seen.get(k) + ')' }); continue }
    seen.set(k, x.src); items.push(classify(W, man, x));
  }
  const counts = {}; for (const i of items) counts[i.action] = (counts[i.action] || 0) + 1;
  return { id: p.id, at: Date.now(), first: !man, project: W.dir, vaultFolder: W.T, items, counts };
}

// ---------- writes ----------
function atomic(file, buf, roots) {
  const f = sp.guard(file, roots); let st; try { st = fs.lstatSync(f) } catch { }
  if (st && st.isSymbolicLink()) throw new Error('Refused: ' + f + ' is a symlink');
  fs.mkdirSync(path.dirname(f), { recursive: true }); sp.guard(path.dirname(f) + path.sep + 'x', roots);
  const tmp = path.join(path.dirname(f), '.' + path.basename(f) + '.nexus-' + process.pid + '.tmp'), fd = fs.openSync(tmp, 'wx');
  try { fs.writeSync(fd, buf); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  try { fs.renameSync(tmp, f) } catch (e) { fs.rmSync(tmp, { force: true }); throw e }
  if (sha(fs.readFileSync(f)) !== sha(buf)) throw new Error('Write check failed for ' + f);
}
function alive(pid) { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
function lock(W) {
  const f = path.join(W.data, 'sync-locks', crypto.createHash('sha1').update(W.T.toLowerCase()).digest('hex') + '.lock');
  sp.guard(f, [W.data]); fs.mkdirSync(path.dirname(f), { recursive: true });
  for (let i = 0; i < 2; i++) {
    try { fs.writeFileSync(f, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' }); return () => fs.rmSync(f, { force: true }) } catch (e) { if (e.code !== 'EEXIST') throw e }
    const o = readJ(f, null); if (o && alive(o.pid)) throw new Error('Another sync of this vault folder is running (process ' + o.pid + ').');
    fs.rmSync(f, { force: true }); // left by a sync that crashed
  }
  throw new Error('Could not take the sync lock.');
}

// opts: { preview: the plan the user saw (required unless auto), choices: { note: 'project' | 'vault' | 'skip' }, auto }
function run(p, opts = {}) {
  const mode = p.sync?.mode || 'off';
  if (mode === 'off') return { res: 'Sync is off for this project.' };
  if (p.sync?.cmd && p.sync.engine !== 'builtin') return { res: 'This project uses its own sync command (' + p.sync.cmd + '); the built-in engine does not run.' };
  if (opts.auto && mode !== 'auto') return { res: 'Auto sync is not on for this project.' };
  if (!opts.auto && !opts.preview) return { res: 'Show the preview first, then confirm.' };
  const W = where(p), unlock = lock(W), t0 = Date.now();
  try {
    const now = plan(p, { pairs: opts.pairs }), ch = opts.choices || {}, prev = new Map((opts.preview?.items || []).map(i => [i.note, i]));
    if (opts.auto && now.first) return { res: 'The first sync needs a preview and your confirmation.' };
    const R = { res: 'ok', pushed: [], pulled: [], merged: [], created: [], recorded: [], conflicts: [], skipped: [], refused: [], changed: [] };
    const todo = [];
    for (const i of now.items) {
      const pv = prev.get(i.note);
      if (!opts.auto && (!pv || JSON.stringify(pv.sha) !== JSON.stringify(i.sha) || pv.action !== i.action)) { if (i.action !== 'none') R.changed.push(i.note); continue } // changed since the preview: not touched
      if (i.action === 'refused') { R.refused.push(i.note + ': ' + i.why); continue }
      if (i.action === 'conflict') { const c = ch[i.note];
        if (!opts.auto && (c === 'project' && i.sha?.project || c === 'vault' && i.sha?.vault) && i.kind !== 'duplicate') todo.push({ i, use: c }); else (c === 'skip' ? R.skipped : R.conflicts).push(i); continue }
      if (i.action === 'same' && i.sha.base === i.sha.project) continue; // already recorded (a damaged ancestor has no sha, so it is re-recorded)
      if (i.action !== 'none') todo.push({ i, use: { push: 'project', 'create-vault': 'project', pull: 'vault', merge: 'merge', same: 'record' }[i.action] });
    }
    // one verified backup of every file about to be overwritten (new files have nothing to back up)
    const over = todo.flatMap(({ i, use }) => use === 'project' ? [i.vault] : use === 'vault' ? [i.project] : use === 'merge' ? [i.project, i.vault] : []).filter(f => fs.existsSync(f));
    let backup = null;
    if (over.length) { backup = bk.backup(over, W.data, 'sync-' + p.id); const m = readJ(path.join(backup, 'manifest.json'), {});
      for (const f of over) { const e = m.files.find(x => x.from === f); if (!e || sha(fs.readFileSync(path.join(backup, e.to))) !== sha(fs.readFileSync(f))) throw new Error('Backup check failed; nothing was written.') } }
    const man = readBase(W.base) || { version: 1, notes: {} };
    for (const { i, use } of todo) {
      try {
        const s = side(i.project, W.dir), d = side(i.vault, W.T); // re-check right before writing: unchanged since the plan
        if ((s.sha || null) !== i.sha.project || (d.sha || null) !== i.sha.vault) { R.changed.push(i.note); continue }
        let final;
        if (use === 'project') { atomic(i.vault, s.buf, [W.T]); final = s.buf; (d.exists ? R.pushed : R.created).push(i.note) }
        else if (use === 'vault') { atomic(i.project, d.buf, [W.dir]); final = d.buf; (s.exists ? R.pulled : R.created).push(i.note) }
        else if (use === 'merge') { const m = i._m; if (sha(m) !== i.merged) throw new Error('merge result changed'); atomic(i.project, m, [W.dir]); atomic(i.vault, m, [W.T]); final = m; R.merged.push(i.note) }
        else { final = s.buf; R.recorded.push(i.note) }
        atomic(path.join(W.base, i.note + '.md'), final, [W.data]); man.notes[i.note] = { sha: sha(final), src: i.src, at: Date.now() };
      } catch (e) { R.refused.push(i.note + ': ' + RED(e.message)) }
    }
    if (todo.length) atomic(path.join(W.base, 'base.json'), Buffer.from(JSON.stringify(man, null, 1)), [W.data]);
    if (R.conflicts.length) { // both versions + ancestor copied for the Conflicts panel; the files themselves stay untouched
      const cd = path.join(W.data, 'backups', 'sync-conflicts', stamp() + '-' + p.id);
      for (const i of R.conflicts) for (const [k, f] of [['project', i.project], ['vault', i.vault], ['base', i.note && path.join(W.base, i.note + '.md')]])
        if (f && fs.existsSync(f)) atomic(path.join(cd, i.note + '.' + k + '.md'), fs.readFileSync(f), [W.data]);
      R.conflictDir = cd; R.conflicts = R.conflicts.map(i => ({ note: i.note, kind: i.kind, why: i.why }));
      if (opts.auto) R.switchToManual = true;
    }
    R.backup = backup; R.ms = Date.now() - t0; history(W, p, opts.auto ? 'auto' : 'manual', R);
    return R;
  } finally { unlock() }
}

function history(W, p, mode, R) {
  const f = path.join(W.data, 'sync-history.json'), h = readJ(f, { runs: [] });
  h.runs.push({ at: Date.now(), project: p.id, mode, pushed: R.pushed.length, pulled: R.pulled.length, merged: R.merged.length, created: R.created.length, conflicts: R.conflicts.length, recorded: R.recorded.length, skipped: R.skipped.length, refused: R.refused.length, changed: R.changed.length });
  h.runs = h.runs.slice(-200); atomic(f, Buffer.from(JSON.stringify(h, null, 1)), [W.data]);
}
const historyOf = id => readJ(path.join(CF.dataDir(), 'sync-history.json'), { runs: [] }).runs.filter(r => !id || r.project === id);

module.exports = { pairs, pairsFromScript, plan, run, historyOf, fmt, where, _: { merge, side, lock, atomic } };
