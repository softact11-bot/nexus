// Claude Code page backend (#/claude-code). Read-only: one folder level, one file's text, git state, the live session feed.
// Every path is checked on the server: inside the project folder (realpath, so no symlink escape), no hidden folders, and the
// sensitive-file deny list below. Nothing here writes to the project, to ~/.claude or to Claude Code's config.
const fs = require('fs'), path = require('path'), cp = require('child_process'), P = require('./projects.js');
const DENY = /^\.env|\.(pem|key|p12|pfx|kdbx|jks|keystore)$|^id_(rsa|dsa|ecdsa|ed25519)|^\.(npmrc|netrc|git-credentials)$|(^|[-_.])(secrets?|credentials?|passwords?)([-_.]|$)/i;
const BIN = /\.(png|jpe?g|webp|gif|ico|bmp|tga|psd|blend1?|fbx|obj|glb|gltf|rbxl|rbxm|exe|dll|so|zip|7z|rar|gz|pdf|mp3|wav|ogg|mp4|mov|ttf|otf|woff2?|db|sqlite)$/i;
const SKIP = new Set(['node_modules', 'backups']), MAX = 1048576, TAIL = 512 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (code, res) => ({ code, res });

function proj(id) { const p = typeof id === 'string' && P.byId(id); if (!p) return err(404, 'Unknown project.'); try { if (!fs.statSync(p.dir).isDirectory()) throw 0 } catch { return err(404, 'The project folder is missing.') } return p }
// rel → absolute path inside the project, or an error. Hidden folders, skipped folders and deny-listed names are refused at every level.
function inside(p, rel, file) {
  if (typeof rel !== 'string' || rel.length > 400 || /[\x00-\x1f"<>|?*:]/.test(rel)) return err(400, 'Bad path.');
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.some(x => x === '..' || x === '.')) return err(400, 'Bad path.');
  if (parts.slice(0, file ? -1 : undefined).some(x => x.startsWith('.') || SKIP.has(x))) return err(403, 'Blocked: hidden or skipped folder.');
  if (parts.some(x => DENY.test(x))) return err(403, 'Blocked: sensitive file.');
  const full = path.resolve(p.dir, ...parts), root = path.resolve(p.dir);
  let real, rroot; try { real = fs.realpathSync(full); rroot = fs.realpathSync(root) } catch { return err(404, 'Not found.') }
  if (real !== rroot && !real.toLowerCase().startsWith(rroot.toLowerCase() + path.sep)) return err(403, 'Blocked: outside the project.');
  if (DENY.test(path.basename(real))) return err(403, 'Blocked: sensitive file.'); // a link named safely pointing at a secret
  return { full: real, rel: parts.join('/') };
}

function tree(id, dir = '') {
  const p = proj(id); if (p.code) return p; const d = inside(p, dir, false); if (d.code) return d;
  let names; try { names = fs.readdirSync(d.full) } catch { return err(404, 'Not found.') }
  const items = [];
  for (const n of names) { let s; try { s = fs.lstatSync(path.join(d.full, n)) } catch { continue }
    if (s.isSymbolicLink()) continue;
    if (s.isDirectory()) { if (!n.startsWith('.') && !SKIP.has(n)) items.push({ n, dir: true }); continue }
    items.push({ n, dir: false, size: s.size, mtime: s.mtimeMs, lock: DENY.test(n) || undefined, big: s.size > MAX || undefined, bin: BIN.test(n) || undefined }) }
  items.sort((a, b) => b.dir - a.dir || a.n.localeCompare(b.n, undefined, { sensitivity: 'base' }));
  return { res: 'ok', dir: d.rel, items: items.slice(0, 500), more: Math.max(0, items.length - 500) };
}

function file(id, f) {
  const p = proj(id); if (p.code) return p; const d = inside(p, f, true); if (d.code) return d;
  let s; try { s = fs.statSync(d.full) } catch { return err(404, 'Not found.') }
  if (!s.isFile()) return err(400, 'Not a file.');
  if (BIN.test(d.full)) return err(415, 'Binary file: not shown.');
  if (s.size > MAX) return err(413, 'Over 1 MB: not shown.');
  const b = fs.readFileSync(d.full); if (b.subarray(0, 8192).includes(0)) return err(415, 'Binary file: not shown.');
  return { res: 'ok', f: d.rel, size: s.size, mtime: s.mtimeMs, text: b.toString('utf8').replace(/^﻿/, '') };
}

// ---------- git: fixed `git -C <dir>` args only, cached 3 s ----------
const gc = new Map();
const git = (dir, args) => new Promise(ok => cp.execFile('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 2 << 20 }, (e, out) => ok(e ? null : out)));
async function gitInfo(id) {
  const p = proj(id); if (p.code) return p; const c = gc.get(p.id); if (c && Date.now() - c.at < 3000) return c.v;
  const [br, st, lg] = await Promise.all([git(p.dir, ['symbolic-ref', '--short', '-q', 'HEAD']), git(p.dir, ['status', '--porcelain']), git(p.dir, ['log', '-20', '--format=%h%x1f%ct%x1f%s'])]);
  const v = st == null ? { res: 'ok', repo: false } : { res: 'ok', repo: true, branch: (br || '').trim() || 'detached HEAD', // status works in a repo with no commits yet
    changes: (st || '').split('\n').filter(Boolean).slice(0, 200).map(l => { const f = l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop(); let m = null; try { m = fs.statSync(path.join(p.dir, f)).mtimeMs } catch { } return { st: l.slice(0, 2), f, mtime: m, conflict: /^(UU|AA|DD|AU|UA|DU|UD)$/.test(l.slice(0, 2)) } }),
    log: (lg || '').split('\n').filter(Boolean).map(l => { const [h, t, s] = l.split('\x1f'); return { h, t: +t * 1000, s } }) };
  gc.set(p.id, { at: Date.now(), v }); return v;
}

// ---------- live: tail of one session transcript of this project → requests, prompts, tools, edited files (cached by size) ----------
const lc = new Map();
function live(id, sid) {
  const p = proj(id); if (p.code) return p;
  if (!UUID.test(sid || '')) return err(400, 'Bad session id.');
  const t = P._.transcripts(p).find(x => x.id === sid); if (!t) return err(404, 'Unknown session for this project.');
  const c = lc.get(t.f); if (c && c.size === t.size) return c.v;
  let txt = ''; const fd = fs.openSync(t.f, 'r');
  try { const n = Math.min(TAIL, t.size), b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, t.size - n); txt = b.toString('utf8') } finally { fs.closeSync(fd) }
  const lines = txt.split('\n'); if (t.size > TAIL) lines.shift(); // first line is cut
  const req = new Map(), edits = new Map(), root = path.resolve(p.dir).toLowerCase() + path.sep; let ask = null;
  for (const l of lines) { if (!l) continue; let j; try { j = JSON.parse(l) } catch { continue } const ts = Date.parse(j.timestamp) || 0, m = j.message;
    if (j.type === 'user' && !j.isMeta) { const c = m?.content, s = typeof c === 'string' ? c : Array.isArray(c) && !c.some(x => x.type === 'tool_result') ? c.find(x => x.type === 'text')?.text : null;
      const q = String(s || '').replace(/<[^>]+>[^<]*<\/[^>]+>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); if (q && !/^Caveat:|^\[Request interrupted/.test(q)) ask = { t: ts, q: q.slice(0, 200) }; continue }
    if (j.type !== 'assistant' || !m?.usage || !j.requestId) continue;
    const u = m.usage, r = req.get(j.requestId) || { t: ts, model: m.model, tools: [], ask: null };
    if (!req.has(j.requestId)) { r.ask = ask; ask = null; req.set(j.requestId, r) }
    r.in = u.input_tokens || 0; r.out = u.output_tokens || 0; r.cw = u.cache_creation_input_tokens || 0; r.cr = u.cache_read_input_tokens || 0;
    for (const x of Array.isArray(m.content) ? m.content : []) if (x.type === 'tool_use') { r.tools.push(x.name);
      const f = x.input?.file_path || x.input?.notebook_path; if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(x.name) && typeof f === 'string' && path.resolve(f).toLowerCase().startsWith(root)) edits.set(path.relative(p.dir, path.resolve(f)).split(path.sep).join('/'), ts) } }
  const reqs = [...req.values()].slice(-40).map(r => ({ t: r.t, model: r.model, in: r.in, out: r.out, cw: r.cw, cr: r.cr, ctx: r.in + r.cw + r.cr, tools: r.tools, ask: r.ask }));
  const v = { res: 'ok', sid, at: Date.now(), size: t.size, last: t.last, reqs, edits: [...edits].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([f, t]) => ({ f, t })) };
  if (lc.size > 20) lc.clear(); lc.set(t.f, { size: t.size, v }); return v;
}

module.exports = { tree, file, git: gitInfo, live, _: { DENY, inside } };
