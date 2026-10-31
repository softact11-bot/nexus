// Local Claude Code token tracker + optimizer. No deps, no AI calls, network only on 127.0.0.1.
// node tracker.js serve   -> dashboard http://127.0.0.1:7788 (rescans logs every 30s)
// node tracker.js boot    -> SessionStart hook: start server if down, print learned tips
// node tracker.js update  -> one scan, print summary (testing)
// node tracker.js audit   -> force the Accuracy & Verification checks and print them (testing)
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os'), cp = require('child_process'), RED = require('./redact.js'); // M4c: home → ~ and secrets masked in logs, exports and error text (spec §26.8)
const DIR = __dirname, LOGS = path.join(os.homedir(), '.claude', 'projects'), PORT = 7788;
const F = n => path.join(DIR, n);
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
const writeF = (f, s) => { fs.writeFileSync(f + '.tmp', s); require('./backup.js').rename(f + '.tmp', f) }; // B65: bounded retry on a Windows sharing error
const CFG = Object.assign({ fiveHourLimitTokens: null, oversizedChars: 30000, rebuildMinTokens: 20000, vaultNote: null }, readJ(F('config.json'), {}));
const DAY = 864e5, H5 = 5 * 36e5;
// Hook modes never use the state: skip parsing it so every prompt/start/compact hook stays fast.
let st = /^(hook|snap|boot)$/.test(process.argv[2]) ? {} : require('./backup.js').readJ(F('state.json'), null) || { files: {}, sessions: {}, days: {}, recent: [], tipsLog: {}, installed: Date.now(), noteAt: 0 };
// Request index (F6a): st.rids = short request key -> number; st.sids[number] = full session id. Numbers are unique per session, so no id can collide.
const RK = k => k.startsWith('req_011C') && k[8] !== '#' ? k.slice(8) : '#' + k; // drops the shared prefix; one-to-one (only unstripped keys start with '#')
let SIX = null; const six = id => { SIX ??= new Map((st.sids ??= []).map((s, i) => [s, i])); let i = SIX.get(id); if (i == null) SIX.set(id, i = st.sids.push(id) - 1); return i };
if (st.rids && !st.sids) { writeF(F('state.pre-f6a.json'), JSON.stringify(st)); const o = st.rids; st.rids = {}; for (const k in o) st.rids[RK(k)] = six(o[k]) } // old full-id index: convert once, backup first

// ---------- parsing ----------
function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}
const norm = p => p.replace(/\\/g, '/').toLowerCase();
const base = p => p.split('/').pop();
function sess(j, file) {
  let S = st.sessions[j.sessionId];
  if (!S) {
    const cwd = j.cwd || path.basename(path.dirname(file));
    S = st.sessions[j.sessionId] = { id: j.sessionId, project: /scratch/i.test(cwd) ? 'scratch' : path.basename(cwd), start: 0, end: 0, n: 0,
      models: {}, issues: {}, tools: {}, skills: {}, req: {}, reads: {}, calls: {}, pend: {} };
  }
  if (j.cwd && !S.cwd) { S.cwd = 1; S.project = /scratch/i.test(j.cwd) ? 'scratch' : path.basename(j.cwd) }
  S.req ??= {}; S.reads ??= {}; S.calls ??= {}; S.pend ??= {};
  return S;
}
function add(o, k, d) { const a = o[k] ??= [0, 0, 0, 0]; for (let i = 0; i < 4; i++) a[i] += d[i] }
function issue(S, type, subj, waste) { const x = S.issues[type + ':' + subj] ??= { n: 0, w: 0 }; x.n++; x.w += waste }

function line(s, file) {
  let j; try { j = JSON.parse(s) } catch { return }
  if (!j.sessionId) return;
  const S = sess(j, file), ts = Date.parse(j.timestamp) || 0;
  if (ts) { S.start = S.start ? Math.min(S.start, ts) : ts; S.end = Math.max(S.end, ts) }
  if (j.subtype === 'compact_boundary' || j.isCompactSummary) { S.reads = {}; S.compacted = 1 } // re-reading after compaction is legit
  if (j.subtype === 'compact_boundary') { S.compacts = (S.compacts || 0) + 1; (S.pre ??= []).push(S.lastCtx || 0) }
  const at = j.attachment; // tips actually delivered to this session by the SessionStart hook
  if (j.type === 'attachment' && at && at.hookEvent === 'SessionStart' && /TOKEN TIPS/.test(at.content || '')) {
    S.tipsSeen = 1; S.tipTok = Math.round(at.content.length / 4); S.tipTypes = Object.keys(TIPRE).filter(t => TIPRE[t].test(at.content));
  }
  if (j.type === 'attachment' && at && at.hookEvent === 'SessionStart') { // startup context injected by hooks = measurable skill cost
    const txt = typeof at.content === 'string' ? at.content : JSON.stringify(at.content || '');
    S.injU ??= {}; if (txt.length > 20 && !S.injU[j.uuid]) { S.injU[j.uuid] = 1; const nm = hookName(txt, at.hookName); S.inj ??= {}; S.inj[nm] = (S.inj[nm] || 0) + Math.round(txt.length / 4) }
  }
  if (j.sourceToolUseID && S.skillIds?.[j.sourceToolUseID] && j.message) { // skill body loaded by the Skill tool
    const nm = S.skillIds[j.sourceToolUseID]; S.skillTok ??= {}; S.skillTok[nm] = (S.skillTok[nm] || 0) + Math.round(JSON.stringify(j.message.content || '').length / 4);
  }
  const m = j.message; if (!m) return;
  if (j.type === 'assistant' && m.usage && j.requestId) usage(S, j.requestId, m.model || '?', m.usage, ts, j.isSidechain);
  if (Array.isArray(m.content)) for (const c of m.content) {
    if (c.type === 'tool_use') toolUse(S, c); else if (c.type === 'tool_result') toolResult(S, c);
  }
}
// One request is logged on several lines with the same requestId: count the delta only, so nothing is double counted.
function usage(S, rid, model, u, ts, side) {
  const v = U(u);
  if (v.every(x => !x)) return; // an aborted/retried request can be re-logged with all-zero usage; it must not cancel tokens already used
  // A resumed chat copies earlier requests into its new log: tokens stay with the session that logged the request first (provenance only here).
  const me = six(S.id), own = (st.rids ??= {})[RK(rid)] ??= me; if (own !== me) { (S.from ??= {})[st.sids[own]] = 1; return }
  const old = S.req[rid], d = v.map((x, i) => x - (old ? old[i] : 0));
  S.req[rid] = v;
  if (!old) {
    S.n++;
    if (!side) { // subagents have their own context; compaction and model switches legitimately re-cache
      const ctx = v[0] + v[2] + v[3];
      if (S.firstCtx == null) S.firstCtx = ctx;
      else if (!S.compacted && model === S.lastModel && v[2] >= CFG.rebuildMinTokens && v[3] < S.lastCtx * 0.5) issue(S, 'rebuild', 'context', v[2]);
      if (S.compacted) (S.post ??= []).push(ctx); // measured context size right after a compaction
      S.sinceCompact = S.compacted ? 0 : (S.sinceCompact ?? 99) + 1; S.lastAt = ts;
      S.lastCtx = ctx; S.lastModel = model; S.compacted = 0;
    }
  }
  if (d.every(x => !x)) return;
  add(S.models, model, d);
  if (ts) { add(st.days[new Date(ts).toLocaleDateString('sv')] ??= {}, model, d); st.recent.push([ts, ...d]) }
}
function toolUse(S, c) {
  const i = c.input || {}, n = c.name; let kind = null;
  S.tools[n] = (S.tools[n] || 0) + 1;
  if (n === 'Read' && i.file_path) {
    const k = [norm(i.file_path), i.offset, i.limit, i.pages].join('|');
    if (S.reads[k]) kind = 'reread:' + base(norm(i.file_path)); S.reads[k] = 1;
  } else if (/^(Edit|Write|NotebookEdit)$/.test(n) && (i.file_path || i.notebook_path)) {
    const p = norm(i.file_path || i.notebook_path) + '|';
    for (const k in S.reads) if (k.startsWith(p)) delete S.reads[k];
  } else if (/^(Grep|Glob|WebFetch|WebSearch)$/.test(n)) {
    const k = n + JSON.stringify(i); if (S.calls[k]) kind = 'dup:' + n; S.calls[k] = 1;
  } else if (n === 'Skill') {
    const s = i.skill || '?'; if (S.skills[s]) kind = 'skilldup:' + s; S.skills[s] = (S.skills[s] || 0) + 1; (S.skillIds ??= {})[c.id] = s;
  }
  S.pend[c.id] = [n, kind];
}
function toolResult(S, c) {
  const p = S.pend[c.tool_use_id]; if (!p) return; delete S.pend[c.tool_use_id];
  const cont = c.content, len = typeof cont === 'string' ? cont.length
    : Array.isArray(cont) ? cont.reduce((a, b) => a + (b.type === 'text' ? (b.text || '').length : 0), 0) : 0; // images excluded
  if (p[0].startsWith("mcp__")) { const m = (S.mcp ??= {})["plugin: " + p[0].split("__")[1]] ??= [0, 0]; m[0]++; m[1] += Math.round(len / 4) } // MCP plugin calls + output cost
  if (p[1]) issue(S, p[1].split(':')[0], p[1].slice(p[1].indexOf(':') + 1), Math.round(len / 4));
  if (len > CFG.oversizedChars) issue(S, 'oversized', p[0], Math.round((len - CFG.oversizedChars) / 4));
}

const BUF = Buffer.alloc(1 << 24);
// Calls cb for each complete line in [pos, size); returns the offset after the last complete line (a partial last line is re-read later).
function eachLine(f, pos, size, cb) {
  const fd = fs.openSync(f, 'r'); let carry = Buffer.alloc(0);
  try {
    while (pos < size) {
      const n = fs.readSync(fd, BUF, 0, Math.min(BUF.length, size - pos), pos); if (!n) break; pos += n;
      const b = Buffer.concat([carry, BUF.subarray(0, n)]), e = b.lastIndexOf(10);
      if (e < 0) { carry = b; continue }
      for (const l of b.toString('utf8', 0, e).split('\n')) if (l) cb(l);
      carry = Buffer.from(b.subarray(e + 1));
    }
  } finally { fs.closeSync(fd) }
  return pos - carry.length;
}
const born = f => fs.statSync(f).birthtimeMs; // the original log is created before any resumed copy of it
function scan() {
  for (const [f, s] of walk(LOGS).map(f => [f, fs.statSync(f)]).sort((a, b) => a[1].birthtimeMs - b[1].birthtimeMs)) { // one stat per log
    const size = s.size, r = st.files[f] ??= { off: 0 };
    if (size < r.off) r.off = 0;
    if (size === r.off) continue;
    r.off = eachLine(f, r.off, size, l => line(l, f));
  }
  const now = Date.now();
  st.recent = st.recent.filter(x => x[0] > now - DAY);
  for (const S of Object.values(st.sessions)) if (S.end < now - 2 * DAY) { delete S.req; delete S.reads; delete S.calls; delete S.pend }
}

// ---------- analysis ----------
const sum = a => a[0] + a[1] + a[2] + a[3];
const tot = models => Object.values(models).reduce((a, v) => (v.forEach((x, i) => a[i] += x), a), [0, 0, 0, 0]);
const waste = S => Object.values(S.issues).reduce((a, x) => a + x.w, 0);
const typeWaste = (S, t) => Object.entries(S.issues).reduce((a, [k, x]) => a + (k.startsWith(t + ':') ? x.w : 0), 0);
const TIPS = {
  reread: s => `Re-read ${s} repeatedly in past sessions: read once, then use offset/limit or Grep.`,
  dup: s => `Repeated identical ${s} calls: reuse the earlier result.`,
  oversized: s => `${s} outputs over ${CFG.oversizedChars / 4 | 0} tokens: narrow with limit/head_limit/filters.`,
  rebuild: () => `Context re-cached after idle gaps (cache TTL): /compact or /clear before long breaks.`,
  skilldup: s => `Skill ${s} loaded more than once per session: load once.`,
};
const GEN = { reread: 'Re-read files repeatedly in past sessions: read once, then use offset/limit or Grep.', dup: 'Repeated identical tool calls: reuse the earlier result.',
  oversized: `Tool outputs over ${CFG.oversizedChars / 4 | 0} tokens: narrow with limit/head_limit/filters.`, rebuild: 'Context re-cached after idle gaps (cache TTL): /compact or /clear before long breaks.',
  skilldup: 'A skill loaded more than once per session: load it once.' };
const TIPRE = { reread: /Re-read /, dup: /identical \S+ calls/, oversized: /outputs over/, rebuild: /re-cached/, skilldup: /loaded more than once/ };
const cnt = (S, t) => Object.entries(S.issues).reduce((y, [k, v]) => y + (!t || k.startsWith(t + ':') ? v.n : 0), 0);
const tk = a => a.reduce((x, S) => x + sum(tot(S.models)), 0) || 1, rq = a => a.reduce((x, S) => x + S.n, 0) || 1;
// Efficiency metrics for a group of sessions. Counts are measured; waste is estimated.
function rates(a) {
  const t = a.reduce((x, S) => (tot(S.models).forEach((v, i) => x[i] += v), x), [0, 0, 0, 0]), m = sum(t) || 1, req = rq(a);
  const r = { 'tokens per request': m / req, 'cache read share %': t[3] / m * 100, 'tool calls per request': a.reduce((x, S) => x + Object.values(S.tools).reduce((y, v) => y + v, 0), 0) / req };
  for (const ty in TIPRE) r[ty + ' per 100 requests'] = a.reduce((x, S) => x + cnt(S, ty), 0) / req * 100;
  r['est. waste per 100k tokens'] = a.reduce((x, S) => x + waste(S), 0) / m * 1e5;
  return r;
}
// Baseline = sessions before install, same projects. After = sessions where the hook really delivered the tip.
// Verified only with >=5 sessions each side, >=25% less est. waste AND fewer measured occurrences.
function effect(all, t) {
  const after = all.filter(S => S.tipsSeen && S.n && (!t || (S.tipTypes || []).includes(t) && !(S.start < (st.retest?.[t] || 0)))), projs = new Set(after.map(S => S.project));
  const before = all.filter(S => S.n && S.end < st.installed && (!after.length || projs.has(S.project))).slice(-30);
  const f = t ? S => typeWaste(S, t) : waste;
  const b = before.reduce((x, S) => x + f(S), 0) / tk(before) * 1e5, a = after.reduce((x, S) => x + f(S), 0) / tk(after) * 1e5;
  const bc = before.reduce((x, S) => x + cnt(S, t), 0) / rq(before) * 100, ac = after.reduce((x, S) => x + cnt(S, t), 0) / rq(after) * 100;
  const clean = g => g.length ? Math.round(g.filter(S => !cnt(S, t)).length / g.length * 100) : null;
  const status = before.length < 5 || after.length < 5 ? `collecting data (${before.length} baseline / ${after.length} with tips seen, need 5 each)`
    : b > 0 && a <= b * 0.75 && ac < bc ? `verified: est. waste -${Math.round((1 - a / b) * 100)}%, measured occurrences -${Math.round((1 - ac / bc) * 100)}%` : 'no clear effect';
  const savedEst = status.startsWith('verified') ? Math.round((b - a) * tk(after) / 1e5) : 0, costEst = after.reduce((x, S) => x + (S.tipTok || 0), 0);
  return { before: Math.round(b), after: Math.round(a), status, savedEst, costEst, net: savedEst - costEst, cleanBefore: clean(before), cleanAfter: clean(after), n: after.length, nBase: before.length, drop: b > 0 ? Math.round((1 - a / b) * 100) : null, dropOcc: bc > 0 ? Math.round((1 - ac / bc) * 100) : null };
}
// Hook text -> skill/plugin name. Unknown hooks fall back to the hook's own name.
const HOOKS = [[/CAVEMAN MODE/, 'caveman'], [/PONYTAIL MODE/, 'ponytail'], [/superpowers/i, 'superpowers'], [/OBSIDIAN PROJECT MEMORY/, 'obsidian memory (hook)'], [/TOKEN TIPS/, 'token tips']];
const hookName = (t, h) => (HOOKS.find(([re]) => re.test(t)) || [0, (h || 'hook').replace(/^SessionStart:?/, '') || 'hook'])[1];
const outPerReq = a => a.reduce((x, S) => x + tot(S.models)[1], 0) / rq(a);
// Skill efficiency. Cost = injected/loaded text (chars measured, tokens = chars/4 est.).
// Savings only from with/without comparisons in the same projects, never because a skill is enabled.
function skillStats(all) {
  const done = all.filter(S => S.n), names = new Set();
  const SKIP = /^superpowers/; // not tracked, by request
  for (const S of done) for (const n of [...Object.keys(S.inj || {}), ...Object.keys(S.skills), ...Object.keys(S.mcp || {})]) if (!SKIP.test(n)) names.add(n);
  const cmp = (w, wo) => {
    const p = new Set(w.map(S => S.project)); wo = wo.filter(S => p.has(S.project)).slice(-30); w = w.slice(-30);
    if (w.length < 5 || wo.length < 5) return { status: 'Not enough data', nW: w.length, nWo: wo.length };
    const a = outPerReq(w), b = outPerReq(wo), pct = Math.round((a - b) / b * 100), est = Math.round((b - a) * rq(w) / w.length);
    const verified = w.length >= 10 && wo.length >= 10 && pct <= -25;
    return { status: verified ? 'verified' : pct < 0 ? 'estimate' : 'no saving seen', nW: w.length, nWo: wo.length, outWith: Math.round(a), outWithout: Math.round(b), pct, perSession: est };
  };
  const rows = [...names].map(n => {
    const has = S => (S.inj || {})[n] || S.skills[n] || (S.mcp || {})[n], w = done.filter(has), wo = done.filter(S => !has(S));
    const cost = w.reduce((x, S) => x + ((S.inj || {})[n] || 0) + ((S.skillTok || {})[n] || 0) + ((S.mcp || {})[n] || [0, 0])[1], 0);
    const uses = w.reduce((x, S) => x + (S.skills[n] || 0) + ((S.inj || {})[n] ? 1 : 0) + ((S.mcp || {})[n] || [0])[0], 0);
    return { name: n, sessions: w.length, uses, cost, costPerSession: w.length ? Math.round(cost / w.length) : 0, ...cmp(w, wo) };
  }).sort((a, b) => b.sessions - a.sessions || b.cost - a.cost);
  // Combined: sessions with any tracked hook/skill vs none, one comparison so shared savings are not double counted.
  const any = S => Object.keys(S.inj || {}).some(n => !SKIP.test(n)) || Object.keys(S.skills).some(n => !SKIP.test(n));
  return { rows, combined: cmp(done.filter(any), done.filter(S => !any(S))), totalCost: rows.reduce((x, r) => x + r.cost, 0) };
}
const FIX = {
  reread: 'Read the file once; use offset/limit for the part you need.', dup: 'Reuse the earlier result instead of repeating the search.',
  oversized: 'Narrow the output (limit, head_limit, filters, Headroom).', rebuild: 'Avoid long idle gaps mid-session, or /compact before a break.',
  skilldup: 'Load a skill once per session.',
};
// ---------- Context Advisor: local rules over measured context sizes, no AI ----------
// Never acts on its own and needs no approval: it warns in-reply; the user types /compact or /clear. snap() auto-saves context to Obsidian first.
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const RISK = { compact: 'Older turns get summarized: exact file contents and tool outputs are dropped. Key context is auto-saved to Obsidian first.',
  'new chat': 'Chat history is gone. Key context is auto-saved to Obsidian first; project docs carry the rest.' };
const CMD = { compact: '/compact', 'new chat': '/clear' };
const LABEL = { continue: 'Keep Using This Chat', compact: 'Compact Soon', 'new chat': 'Start a New Chat' };
const PLAIN = { continue: 'There is plenty of room left in this chat. Nothing to do.',
  compact: 'This chat is getting long. Every message re-sends the whole conversation, so compacting shrinks it into a summary and makes each reply cheaper.',
  'new chat': 'This chat is too long or went stale. A fresh chat starts small and cheap; your progress carries over through Obsidian and project docs.' };
// Session lifecycle from hooks: starts[sid] = [time, startup|clear|compact|resume], ended[sid] = [time, reason]. Last 50 each.
const life = (sid, k, v) => { const R = readJ(F('responses.json'), { log: [] }); (R[k] ??= {})[sid] = [Date.now(), v]; R[k] = Object.fromEntries(Object.entries(R[k]).sort((a, b) => b[1][0] - a[1][0]).slice(0, 50)); writeF(F('responses.json'), JSON.stringify(R)) };
const logAct = (R, sid, what, res) => { R.log = [[Date.now(), sid.slice(0, 8), what, res], ...(R.log || [])].slice(0, 40) };
// PreCompact (manual/auto) and SessionEnd(reason=clear): save recent requests, changed files and the last reply to the vault, then read it back to verify.
function snap(j) {
  const ev = j.hook_event_name === 'PreCompact' ? (j.trigger === 'auto' ? 'auto-compact' : 'compact') : j.reason === 'clear' ? 'new chat' : j.hook_event_name === 'SessionEnd' ? 'chat closed' : null;
  if (!ev || !CFG.vaultNote || !j.session_id) return;
  let lines = [];
  try { const fd = fs.openSync(j.transcript_path, 'r'), sz = fs.fstatSync(fd).size, n = Math.min(sz, 8e5), b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, sz - n); fs.closeSync(fd); lines = b.toString('utf8').split('\n').slice(1) } catch { }
  const q = (s, n = 300) => s.replace(/<([\w-]+)[^>]*>[\s\S]*?<\/\1>/g, '').replace(/\[\[/g, '[ [').replace(/\s+/g, ' ').trim().slice(0, n), asks = [], files = new Set(); let last = '';
  for (const l of lines) { let m; try { m = JSON.parse(l) } catch { continue } const c = m.message?.content;
    if (m.type === 'user' && !m.isMeta && !m.isCompactSummary) { const t = q(typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join(' ') : ''); if (t) asks.push(t) }
    if (m.type === 'assistant' && Array.isArray(c)) for (const x of c) { if (x.type === 'text' && x.text.trim()) last = x.text; if (x.type === 'tool_use' && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(x.name) && x.input?.file_path) files.add(x.input.file_path) } }
  if (ev === 'chat closed' && !asks.length) return;
  const f = path.join(path.dirname(CFG.vaultNote), 'Session Snapshots.md'), id = j.session_id.slice(0, 8), stamp = new Date().toLocaleString('sv').slice(0, 16);
  const entry = `## ${stamp} · ${path.basename(j.cwd || '')} · ${id} · before ${ev}\n- **Recent requests:**\n${asks.slice(-3).map(a => '  - ' + a).join('\n') || '  - none found'}\n` +
    `- **Files changed:** ${[...files].slice(-15).map(p => '`' + p.replace(/\\/g, '/') + '`').join(', ') || 'none'}\n- **Last reply:** ${q(last, 500) || 'none'}\n`;
  let old = ''; try { old = fs.readFileSync(f, 'utf8') } catch { }
  const prev = old.split('\n## ').slice(1).slice(0, 9).map(e => '## ' + e.trimEnd() + '\n');
  writeF(f, `---\ntags: [memory, snapshots]\n---\n# Session Snapshots\nAuto-saved by the token tracker before each compaction or new chat (last 10). Fuller handoffs live in MEMORY.md. Don't edit; it is overwritten.\n\n` + [entry, ...prev].join('\n'));
  let ok = false; try { ok = fs.readFileSync(f, 'utf8').includes(`${stamp} · ${path.basename(j.cwd || '')} · ${id}`) } catch { }
  const R = readJ(F('responses.json'), { log: [] }); logAct(R, j.session_id, 'saved before ' + ev, ok ? 'verified in Obsidian' : 'save FAILED'); writeF(F('responses.json'), JSON.stringify(R));
}
function advise(all, now) {
  const done = all.filter(S => S.n), post = done.flatMap(S => S.post || []), pre = done.flatMap(S => S.pre || []);
  const postAvg = post.length >= 3 ? avg(post) : null, starts = done.map(S => S.firstCtx).filter(Boolean).slice(-20), startAvg = starts.length >= 5 ? avg(starts) : null;
  const pv = pre.filter(x => x > 5e4), win = CFG.contextWindow || (pv.length >= 3 ? Math.round(avg(pv)) : 2e5); // measured: where auto-compaction actually happens
  const R = readJ(F('responses.json'), { log: [] }), sessions = [], SS = R.starts || {}, E = R.ended || {};
  // Live = not ended, and either the newest chat or used after the newest chat began. Everything else goes to history (no warnings).
  const newest = Math.max(0, ...done.map(S => S.start), ...Object.values(SS).filter(x => x[1] !== 'compact').map(x => x[0]));
  const last = S => S.lastAt || S.end, gone = S => E[S.id] && E[S.id][0] >= last(S) && E[S.id][0] >= (SS[S.id]?.[0] || 0);
  const live = S => !gone(S) && (S.start >= newest || last(S) >= newest) && now - last(S) < 24 * 36e5;
  const history = done.filter(S => !live(S)).slice(-20).reverse().map(S => { const t = tot(S.models);
    return { id: S.id, project: S.project, start: S.start, end: last(S), n: S.n, fresh: t[0] + t[1] + t[2], cached: t[3], k: S.compacts || 0, peak: Math.max(S.lastCtx || 0, ...(S.pre || [])),
      why: gone(S) ? (E[S.id][1] === 'clear' ? 'cleared (/clear)' : 'chat closed') : 'a newer chat started' } });
  const SV = require('./savings.js'), RESTORE = 8e3, lens = done.map(S => S.n); // RESTORE: tokens to re-read handoff + docs in a new chat (estimate)
  for (const S of done.filter(live).slice(-12).reverse()) {
    const ctx = S.lastCtx || 0, pct = ctx / win, idle = (now - (S.lastAt || S.end)) / 6e4, rr = cnt(S, 'reread'), k = S.compacts || 0, sc = S.sinceCompact ?? 99;
    let action = 'continue', why = 'context is healthy', save = null, n = 0;
    if (S.compacted) why = 'just compacted; the next request measures the new size';
    else if (k >= 2 && pct >= 0.5) { action = 'new chat'; why = `already compacted ${k}× and context is ${Math.round(pct * 100)}% full again` }
    else if (idle >= 60 && ctx >= 5e4) { action = 'new chat'; why = `idle ${Math.round(idle)} min: the cache expired, so your next message re-caches all ${Math.round(ctx / 1e3)}k tokens` }
    else if (pct >= 0.6 && sc >= 20) { action = 'compact'; why = `context is ${Math.round(pct * 100)}% full; every request re-reads all ${Math.round(ctx / 1e3)}k tokens` }
    else if (rr >= 3 && ctx >= 1e5 && sc >= 20) { action = 'compact'; why = `${rr} repeated file reads in a ${Math.round(ctx / 1e3)}k-token context` }
    // A5: net US$ at the session's main model's cached-token prices, over the expected remaining requests (savings.js).
    const rem = SV.remaining(lens, S.n), price = SV.priceFor(SV.dom(S.models), ctx), base = action === 'compact' ? postAvg : startAvg && startAvg + RESTORE;
    if (action !== 'continue' && base && price) { save = +SV.advisorNet({ action, ctx, idle, rem, base, price }).toFixed(2); n = action === 'compact' ? post.length : starts.length }
    const unit = `net at API list price over ~${rem} more requests; a subscription bills limits, not dollars`;
    const conf = save == null ? 'low' : n >= 10 ? 'high' : 'medium';
    const r = R[S.id] || {};
    // Benefit check: notify only with a measured estimate worth it (>=40k context dropped), never when auto-compact is about to happen anyway.
    const gain = action === 'compact' ? ctx - (postAvg || ctx) : ctx - (startAvg || ctx);
    const worth = save != null && save > 0 && gain >= 4e4 && !(action === 'compact' && pct >= 0.92);
    if (action !== 'continue' && !worth) why += ' (not worth acting: ' + (save == null ? 'Not enough data' : save <= 0 ? 'no net saving after startup and restore costs' : gain < 4e4 ? 'small gain' : 'auto-compact is imminent') + ')';
    const notify = action !== 'continue' && worth;
    sessions.push({ id: S.id, project: S.project, ctx, pct: Math.round(pct * 100), win, k, idle: Math.round(idle), rr, n: S.n, action, why, save, unit, conf,
      risk: RISK[action] || '', cmd: CMD[action] || '', notify, label: LABEL[action], plain: PLAIN[action], worth, active: true,
      health: pct < 0.5 ? 'Healthy' : pct < 0.75 ? 'Getting full' : 'Nearly full', warnedAt: r.notifiedAt || null });
  }
  const out = { at: now, win, postAvg: postAvg && Math.round(postAvg), startAvg: startAvg && Math.round(startAvg), sessions, history, log: R.log || [] };
  writeF(F('advice.json'), JSON.stringify({ at: now, sessions: Object.fromEntries(sessions.map(s => [s.id, s])) }));
  return out;
}
// ---------- Skill Efficiency Advisor: auto-discovers skills/plugins/hooks from config files, judges from logs. Never changes anything. ----------
const IMPORTANT = new Set(CFG.important || ['ponytail', 'caveman', 'headroom', 'graphify', 'claude-memory', 'skill-creator', 'roblox-dev', 'roblox-dev-skill', 'roblox-studio', 'plugin: roblox_studio', 'plugin: robloxstudio', 'plugin: blender', 'obsidian memory (hook)', 'token tips', 'hook: sessionstart skills-boot', 'hook: sessionstart tracker', 'hook: userpromptsubmit tracker']);
// "roblox-dev:review" / "x@market" -> owning skill/plugin; MCP rows ("plugin: server") and hooks keep their full name.
const keyOf = n => (n = n.toLowerCase().trim(), /^(plugin|hook): /.test(n) ? n : n.split(/[:@]/)[0].trim());
const dirs = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name) } catch { return [] } };
function inventory() {
  const C = path.join(os.homedir(), '.claude'), out = {}, put = (n, type, x = {}) => { out[keyOf(n)] ??= { name: n, type, ...x } };
  const ip = readJ(path.join(C, 'plugins', 'installed_plugins.json'), {}), set = readJ(path.join(C, 'settings.json'), {});
  for (const k in ip.plugins || {}) { const v = [].concat(ip.plugins[k])[0] || {}; put(k.split('@')[0], 'plugin', { version: v.version || '?', enabled: !!(set.enabledPlugins || {})[k] }) }
  for (const d of dirs(path.join(C, 'skills'))) if (d !== 'synced') put(d, 'skill');
  for (const g of dirs(path.join(C, 'skills', 'synced'))) for (const d of dirs(path.join(C, 'skills', 'synced', g))) put(d, 'synced skill');
  for (const [ev, arr] of Object.entries(set.hooks || {})) for (const h of arr) for (const c of h.hooks || [])
    put(`hook: ${ev} ${((c.command || '').match(/([\w-]+)\.(?:sh|js|cmd|ps1)/) || [, (c.command || '').slice(0, 24)])[1]}`, 'hook');
  return out;
}
function skillAdvisor(sk, now) {
  const inv = inventory(), prev = st.inv;
  st.invLog ??= [];
  if (prev) { // install / update / remove detection (first run only sets the baseline)
    for (const k in inv) if (!prev[k]) st.invLog.unshift([now, inv[k].name, 'installed']); else if ((prev[k].version || '') !== (inv[k].version || '')) st.invLog.unshift([now, inv[k].name, `updated ${prev[k].version} → ${inv[k].version}`]);
    for (const k in prev) if (!inv[k]) st.invLog.unshift([now, prev[k].name, 'removed']);
    st.invLog = st.invLog.slice(0, 30);
  }
  st.inv = Object.fromEntries(Object.entries(inv).map(([k, v]) => [k, { name: v.name, version: v.version }]));
  const items = {}, SKIP = /^superpowers/;
  for (const [k, v] of Object.entries(inv)) if (!SKIP.test(k)) items[k] = { ...v, rows: [] };
  for (const r of sk.rows) (items[keyOf(r.name)] ??= { name: r.name, type: /^plugin: /.test(r.name) ? 'MCP tools' : 'from logs', rows: [] }).rows.push(r);
  const costs = Object.values(items).map(it => it.rows.reduce((x, r) => x + r.costPerSession, 0)).filter(Boolean).sort((a, b) => a - b), med = costs[costs.length >> 1] || 0;
  const out = Object.entries(items).map(([k, it]) => {
    const R = it.rows, ses = Math.max(0, ...R.map(r => r.sessions)), uses = R.reduce((x, r) => x + r.uses, 0), cost = R.reduce((x, r) => x + r.costPerSession, 0);
    const best = R.find(r => r.status === 'verified') || R.find(r => r.nW >= 10 && r.nWo >= 10) || R[0], imp = IMPORTANT.has(k), exp = ses >= 3 && cost >= 5000 && cost > 2 * med;
    let status = 'Review', conf = 'low', why;
    if (best && best.status === 'verified') { status = 'Keep'; conf = 'high'; why = `verified: ${-best.pct}% less output per request with it (${best.nW} vs ${best.nWo} sessions)` }
    else if (!imp && best && best.status === 'no saving seen' && best.nW >= 10 && best.nWo >= 10 && best.pct >= 25) { status = 'Consider removing'; conf = 'medium'; why = `${best.pct}% more output per request with it over ${best.nW} vs ${best.nWo} sessions, and no measured benefit` }
    else if (imp) { status = 'Keep'; conf = 'medium'; why = 'part of your core workflow (quality, accuracy, memory, or token savings that logs cannot measure)' }
    else if (ses >= 3) { status = 'Keep'; conf = 'medium'; why = `used in ${ses} sessions: active use suggests it helps your work` }
    else why = ses ? `used in ${ses} session${ses > 1 ? 's' : ''}: Not enough data to judge` : 'no use in tracked logs yet: Not enough data (rarely used ≠ useless)';
    const rec = status === 'Consider removing' ? 'Consider removing (needs your approval)' : exp ? 'Optimize: unusually expensive' : status === 'Keep' ? 'Keep' : 'Keep watching';
    return { name: it.name, type: it.type, version: it.version || '', enabled: it.enabled, status, conf, why, rec, sessions: ses, uses, cost: cost || null, expensive: exp,
      removeSave: cost ? cost : null, compare: best && best.outWith != null ? `${best.outWith} → ${best.outWithout} output/request (${best.pct > 0 ? '+' : ''}${best.pct}%)` : 'Not enough data' };
  }).sort((a, b) => ['Consider removing', 'Review', 'Keep'].indexOf(a.status) - ['Consider removing', 'Review', 'Keep'].indexOf(b.status) || (b.cost || 0) - (a.cost || 0));
  // Notices: once per skill per state, only for non-core skills that look inefficient or unusually expensive.
  st.skillNoticed ??= {}; const notices = [];
  for (const x of out) { const s = x.status === 'Consider removing' ? 'remove' : x.expensive && !IMPORTANT.has(keyOf(x.name)) ? 'expensive' : null;
    if (s && st.skillNoticed[x.name] !== s) { st.skillNoticed[x.name] = s; notices.push(`${x.name}: ${x.rec}. ${x.why}${x.cost ? `; ~${x.cost} tokens/session (est.)` : ''}`) } }
  st.skillNotices = [...notices.map(n => [now, n]), ...(st.skillNotices || [])].slice(0, 20); if (notices.length || !fs.existsSync(F('notices.json'))) writeF(F('notices.json'), JSON.stringify(st.skillNotices));
  return { items: out, med, changes: st.invLog, notices: st.skillNotices };
}
// Startup context breakdown: what Claude Code logged before the session's first request (chars ÷ 4 = estimate). Tool schemas and most of the
// base system prompt are never written to the log, so they are shown as the measured total minus the logged parts. Cached in st.boot per session.
const OWN = { prompt_snapshot: 'Claude Code itself', environment: 'Claude Code itself', deferred_tools_delta: 'Claude Code itself', agent_listing_delta: 'Claude Code itself',
  skill_listing: 'Plugins, skills & MCP', mcp_instructions_delta: 'Plugins, skills & MCP', instructions: 'Your CLAUDE.md files & auto-memory' };
function bootOf(S, files) {
  const B = st.boot ??= {}; if (B[S.id]) return B[S.id];
  const f = files.find(x => x.endsWith(S.id + '.jsonl')); if (!f) return null;
  const p = {}, put = (k, v) => { const t = typeof v === 'string' ? v : JSON.stringify(v ?? ''); p[k] = (p[k] || 0) + Math.round(t.length / 4) }; let v = null;
  eachLine(f, 0, Math.min(fs.statSync(f).size, 4e6), l => { if (v) return; let j; try { j = JSON.parse(l) } catch { return }
    const a = j.attachment;
    if (a && /^hook_(success|additional_context)$/.test(a.type)) { const t = String(a.content || a.stdout || ''); if (t.length > 20) put(/^(TOKEN TIPS|CONTEXT ADVISOR|SKILL ADVISOR)/.test(t) ? 'Token tracker' : /OBSIDIAN PROJECT MEMORY|CAVEMAN MODE/.test(t) ? 'Your hooks (vault memory, caveman, auto-skills)' : 'Plugins, skills & MCP', t) }
    else if (a && OWN[a.type]) put(OWN[a.type], a.content ?? a.files ?? a.addedBlocks ?? a.addedLines ?? a.systemPrompt ?? a.snapshot);
    const u = j.message?.usage; if (j.type === 'assistant' && u && !j.isSidechain && U(u).some(Boolean)) v = U(u) });
  if (!v) return null;
  const ctx = v[0] + v[2] + v[3], logged = Object.values(p).reduce((x, y) => x + y, 0);
  B[S.id] = { ctx, fresh: v[0] + v[2], cached: v[3], parts: Object.entries(p).sort((a, b) => b[1] - a[1]), rest: Math.max(0, ctx - logged) };
  for (const k of Object.keys(B).slice(0, -60)) delete B[k];
  return B[S.id];
}
function report() {
  const now = Date.now(), all = Object.values(st.sessions).sort((a, b) => a.end - b.end);
  // Claude's usage window: starts at the first request, lasts 5h; next request after that starts a new window.
  let ws = 0; for (const r of [...st.recent].sort((a, b) => a[0] - b[0])) if (!ws || r[0] >= ws + H5) ws = r[0];
  const win = ws && now < ws + H5 ? st.recent.filter(r => r[0] >= ws).reduce((a, r) => (a.forEach((_, i) => a[i] += r[i + 1]), a), [0, 0, 0, 0]) : [0, 0, 0, 0];
  const lim = CFG.fiveHourLimitTokens, winBill = win[0] + win[1] + win[2];
  const days = Object.keys(st.days).sort().slice(-14).map(d => [d, ...tot(st.days[d])]);
  const models = {}; for (const d in st.days) for (const m in st.days[d]) add(models, m, st.days[d][m]);
  const projects = {}; for (const S of all) add(projects, S.project, tot(S.models));
  const recent = all.slice(-10), agg = {};
  for (const S of recent) for (const [k, x] of Object.entries(S.issues)) { const a = agg[k] ??= { s: 0, n: 0, w: 0 }; a.s++; a.n += x.n; a.w += x.w }
  const issues = Object.entries(agg).sort((a, b) => b[1].w - a[1].w);
  const xs = Object.values(st.exps ||= {}), xOn = t => xs.some(x => x.k === t && x.status === 'running'), xPaused = t => xs.some(x => x.k === t && x.status === 'paused');
  const tips = issues.filter(([k, a]) => a.s >= 2 && a.w > 500 && !(st.retired ??= {})[k.split(':')[0]] && !xPaused(k.split(':')[0])).slice(0, 5).map(([k]) => {
    const t = k.split(':')[0]; st.tipsLog[t] ??= now; return TIPS[t](k.slice(t.length + 1));
  });
  for (const t of Object.keys(TIPRE)) if (xOn(t) && !tips.some(x => TIPRE[t].test(x))) { const top = issues.find(([k]) => k.startsWith(t + ':')); tips.push(top ? TIPS[t](top[0].slice(t.length + 1)) : GEN[t]) }
  writeF(F('tips.txt'), tips.length && !st.autoOff ? 'TOKEN TIPS (local tracker, learned from past sessions). Cut only waste; never skip reads, steps or tests the work needs, and spend more tokens when quality needs it:\n- ' + tips.join('\n- ') + '\n' : '');
  const opts = [['All tips', null], ...Object.keys(TIPRE).filter(t => st.tipsLog[t]).map(t => ['Tip: ' + t, t])].map(([name, t]) => ({ name, ...effect(all, t) }));
  const base = all.filter(S => S.n && S.end < st.installed), seen = all.filter(S => S.tipsSeen && S.n), B = rates(base), N = rates(seen);
  const verify = { base: base.length, seen: seen.length, enough: base.length >= 5 && seen.length >= 5,
    rows: Object.keys(B).map(k => [k, B[k], seen.length ? N[k] : null, seen.length && B[k] ? Math.round((N[k] - B[k]) / B[k] * 100) : null, /waste/.test(k) ? 'estimated' : 'measured', /share/.test(k) ? 1 : -1]) };
  const sk = skillStats(all);
  const ve = verify.rows.find(x => /waste/.test(x[0]));
  const status = !verify.enough ? 'collecting data' : ve[3] <= -10 ? 'improving' : ve[3] >= 10 ? 'declining' : 'stable';
  const half = all.filter(S => S.n).slice(-20), rA = rates(half.slice(0, 10)), rB = rates(half.slice(10));
  const trend = half.length >= 20 ? { tokPerReq: Math.round((rB['tokens per request'] - rA['tokens per request']) / rA['tokens per request'] * 100), waste: rA['est. waste per 100k tokens'] ? Math.round((rB['est. waste per 100k tokens'] - rA['est. waste per 100k tokens']) / rA['est. waste per 100k tokens'] * 100) : null } : null;
  const ver = opts[0].status.startsWith('verified') ? opts[0].savedEst : 0, skV = sk.combined.status === 'verified' ? sk.combined.perSession * sk.combined.nW : 0;
  // Verified = token amount itself measured (output tokens from usage logs). Tip savings prove fewer problems, but their size is chars/4, so they count as estimates.
  const skE = sk.combined.status === 'estimate' ? sk.combined.perSession * sk.combined.nW : 0;
  const saved = { verified: skV, estimated: skE + ver, tipVerifiedEst: ver, tipCost: opts[0].costEst, skillCost: sk.totalCost };
  // M7d Saved Usage: cache-aware, price-weighted (savings.js). Recomputed only when sessions or the day change; one ledger snapshot per day in st.savHist.
  const svKey = all.length + ':' + (all.at(-1)?.end || 0) + ':' + new Date(now).toISOString().slice(0, 10);
  if (svMemo?.k !== svKey) { const on = S => S.tipsSeen || Object.keys(S.inj || {}).some(n => !/^superpowers/.test(n)) || Object.keys(S.skills || {}).some(n => !/^superpowers/.test(n));
    svMemo = { k: svKey, v: require('./savings.js').compute(all, { uses: on, wasteTok: saved.estimated, hist: st.savHist ||= {}, now }) } }
  let noteOk = false; try { noteOk = !!CFG.vaultNote && fs.statSync(CFG.vaultNote).mtimeMs > now - 864e5 } catch {}
  const lastS = all.filter(S => S.n).at(-1);
  const health = [
    ['Tracking', all.length > 0, `${all.length} sessions scanned`],
    ['Startup tips', !!(lastS && lastS.tipsSeen) || !tips.length, tips.length ? (lastS && lastS.tipsSeen ? 'loaded in the latest session' : 'not seen in the latest session') : 'no tips needed yet'],
    ['Learning', Object.keys(st.tipsLog).length > 0, `${Object.keys(st.tipsLog).length} problem types learned`],
    ['Obsidian sync', noteOk, CFG.vaultNote ? (noteOk ? 'note updated in the last 24h' : 'note not updated in 24h') : 'no vault note set'],
    (b => ['Claude Code', fs.existsSync(b), fs.existsSync(b) ? 'CLI found (Assistant, plans, limit checks)' : 'CLI not found at ' + b.replace(os.homedir(), '~') + ': the Assistant cannot answer. Install Claude Code or set NEXUS_CLAUDE.'])(require('./assist.js')._.bin()),
    ['Evidence', verify.enough, verify.enough ? 'enough sessions to judge' : `${verify.seen}/5 sessions with tips`],
  ];
  const fixes = issues.slice(0, 6).map(([k, a]) => [k.replace(':', ' · '), a.w, a.s, FIX[k.split(':')[0]] || '']);
  const advisor = advise(all, now);
  const skadv = skillAdvisor(sk, now);
  const recs = [], recKeys = [], rec = (k, t) => { recs.push(t); recKeys.push(k) };
  const files = walk(LOGS), firsts = all.filter(S => S.firstCtx).slice(-15), lastB = firsts.slice().reverse().map(S => [S, bootOf(S, files)]).find(x => x[1]);
  const startup = { rows: firsts.reverse().map(S => { const b = bootOf(S, files); return [S.start, S.project, S.firstCtx, b ? b.fresh : null, b ? b.cached : null] }),
    latest: lastB && { id: lastB[0].id, project: lastB[0].project, ...lastB[1] } };
  // Auto-retire a tip proven useless (no quality impact: tips are hints only). Reversible: delete its key from state.json "retired".
  if (!st.autoOff) for (const o of opts) { const t = o.name.slice(5); if (o.name.startsWith('Tip: ') && o.status === 'no clear effect' && !st.retired[t] && !xOn(t) && !xPaused(t)) { st.retired[t] = now; (st.autoLog ??= []).unshift([now, `Retired tip "${t}": shown in ${o.n} sessions with no clear drop`]) } }
  if (opts[0].n >= 5 && opts[0].net < 0) rec('tipsoff', `Tips cost ~${opts[0].costEst} tokens but verified savings are ${opts[0].savedEst}: consider turning tips off.`);
  const long = recent.filter(S => S.n > 150); if (long.length) rec('long', `${long.length} of the last 10 sessions had >150 requests. Consider /clear between unrelated tasks.`);
  const rb = recent.reduce((a, S) => a + typeWaste(S, 'rebuild'), 0); if (rb > 2e5) rec('rebuild', `~${Math.round(rb / 1e3)}k tokens re-cached after idle gaps in the last 10 sessions. Consider shorter sessions or /compact before breaks.`);
  return {
    at: new Date(now).toLocaleString(), window: { start: ws && now < ws + H5 ? new Date(ws).toLocaleTimeString() : null, resets: ws && now < ws + H5 ? new Date(ws + H5).toLocaleTimeString() : null, tokens: win, limit: lim, pct: lim ? Math.round(winBill / lim * 100) : null },
    days, models: Object.entries(models).map(([m, v]) => [m, ...v]), projects: Object.entries(projects).map(([p, v]) => [p, ...v]),
    sessions: all.slice(-25).reverse().map(S => { const t = tot(S.models), top = Object.entries(S.issues).sort((a, b) => b[1].w - a[1].w)[0];
      return [S.id.slice(0, 8), S.project, new Date(S.start).toLocaleString(), S.n, ...t, waste(S), top ? top[0] : ''] }),
    auto: (st.autoLog || []).slice(0, 20), issues: issues.slice(0, 15).map(([k, a]) => [k, a.s, a.n, a.w]), tips, opts, recs, verify, lab: { installed: st.installed, tipsLog: st.tipsLog, retired: st.retired || {}, retest: st.retest || {}, autoOff: !!st.autoOff, dismissed: st.dismissed || {}, recKeys, exps: xs.map(x => ({ ...x, live: x.status === 'stopped' ? null : opts.find(o => o.name === 'Tip: ' + x.k) || null })).sort((a, b) => b.start - a.start) }, startup, skills: sk, skadv, advisor, status, trend, saved, savings: svMemo.v, health, fixes,
  };
}

// ---------- outputs ----------
function note(r) {
  if (!CFG.vaultNote || Date.now() - st.noteAt < 6e5) return;
  const k = n => (n / 1e3).toFixed(1) + 'k', d7 = r.days.slice(-7).reduce((a, d) => (a.forEach((_, i) => a[i] += d[i + 1]), a), [0, 0, 0, 0]);
  const s = `---\ntags: [tokens, optimizer]\nupdated: ${new Date().toLocaleDateString('sv')}\n---\n# Token Optimizer\n` +
    `Auto-written by \`~/.claude/token-tracker/tracker.js\` (local, no AI). Dashboard: http://127.0.0.1:7788. Don't edit; it is overwritten. Lessons and proven results: [[Roblox Efficiency]] · [[General Efficiency]].\n\n` +
    `## Last 7 days (measured)\ninput ${k(d7[0])} · output ${k(d7[1])} · cache write ${k(d7[2])} · cache read ${k(d7[3])}\n\n` +
    `## Top inefficiencies, last 10 sessions (estimated waste)\n${r.issues.slice(0, 6).map(i => `- ${i[0]}: ${i[2]}x in ${i[1]} sessions, ~${k(i[3])}`).join('\n') || '- none'}\n\n` +
    `## Auto-applied tips (shown at session start)\n${r.tips.map(t => '- ' + t).join('\n') || '- none'}\n\n` +
    `## Is it improving? (baseline ${r.verify.base} sessions vs ${r.verify.seen} with tips seen)\n${r.verify.enough ? r.verify.rows.map(x => `- ${x[0]} (${x[4]}): ${x[1].toFixed(1)} → ${x[2].toFixed(1)} (${x[3] > 0 ? '+' : ''}${x[3]}%)`).join('\n') : '- not enough data yet; no improvement claimed'}\n\n## Tip results\n${r.opts.map(o => `- ${o.name}: ${o.status}; tip cost ~${o.costEst} tokens (est.)`).join('\n')}\n\n` +
    `## Needs your judgment (not automated)\n${r.recs.map(x => '- ' + x).join('\n') || '- none'}\n`;
  const body = s.replace(/updated: .*\n/, '');
  if (body !== st.noteBody) { writeF(CFG.vaultNote, s); st.noteBody = body }
  st.noteAt = Date.now();
}
// ---------- Obsidian knowledge notes: an entry is rewritten only when its status changes; text outside the auto markers is never touched ----------
const RBX = /roblox|luau|studio|blender|rojo/i, A0 = '<!-- auto:start (tracker.js rewrites only between these markers) -->', A1 = '<!-- auto:end -->';
const LESSONS = [
  ['l:studio-output', 1, 'Studio MCP output is the largest token cost (~135k tokens/session, est.). Search first, then read line ranges; print only needed values from execute_luau (rules in my-game/CLAUDE.md).'],
  ['l:studio-tree', 1, 'Tree tools (descendants, project structure): start at the smallest root with low depth; widen only when results are incomplete.'],
  ['l:autocompact', 0, 'Auto-compact happens near ~167k context tokens (measured). Ponytail and Superpowers re-inject ~1.3k tokens each after every compaction (est.).'],
  ['l:idle', 0, 'An idle gap over ~60 min expires the prompt cache, so the next message re-writes the whole context. Compact or /clear before long breaks.'],
  ['l:skill-cost', 0, 'Judge skills by with/without comparisons in the same projects, never because a skill is enabled.'],
];
const KSEC = [['Proven', 'verified savings'], ['Not helping', 'enough data, no saving'], ['Recurring waste', 'estimated, tip applied at startup'], ['Resolved', 'no longer in the last 10 sessions'], ['Lessons', '']];
// ---------- Cross-project learning (no AI): preferences, decisions, mistakes + fixes from every chat in every project -> Obsidian ----------
// Rules only: user sentences with preference / decision words, Claude sentences naming a cause or fix. Own offsets, at most 64 MB of log per tick,
// so the first run backfills old chats over a few ticks. Notes: CFG.learnDir/Learned - <project>.md + NEXUS Learned.md (auto block only; notes outside it stay).
// Nothing is applied on its own: preferences seen in 2+ chats are listed as "Suggested rules" for the user to approve into CLAUDE.md.
const LPREF = /\b(always|never|from now on|i (?:want|prefer|like|hate)|don'?t|do not|avoid|make sure|remember)\b/i, LDEC = /\b(i approve|approved|i reject|rejected|go with|decided|use .{1,30} instead)\b/i;
const LFIX = /\b(root cause|caused by|cause:|fixed by|the fix (?:is|was)|was wrong|mistake)\b/i, LSECRET = /api[_ -]?key|password|secret|token\s*[:=]|\bsk-[a-z0-9]|bearer /i;
const lText = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text || '').join('\n') : '';
const lSents = t => t.replace(/<(system-reminder|command-[a-z-]+|local-command-[a-z-]+|task-notification)[\s\S]*?<\/\1>/g, ' ').replace(/<\/?pasted_content[^>]*>/g, '\n').replace(/```[\s\S]*?```/g, ' ')
  .split(/\n+|(?<=[.!?])\s+/).map(x => x.replace(/^[\s>*\-\d.)#]+/, '').replace(/\s+/g, ' ').trim());
// Resumed chats copy old lines with their original timestamps: an entry counts a message timestamp once, so copies add nothing.
// Context: each fix / decision keeps the topic of the request it answered (first clear sentence of the last user message in that chat).
const lAsk = new Map(), LVAGUE = /^(this|that|it|they|these|those|which|so|and|but|or|the fix is (in|to|a|that|based))\b/i;
// Evicted entries keep only their message stamps + chat count (st.lGone), so a later copy of the same text resumes its real count instead of restarting.
const lHash = k => { let h = 5381; for (let i = 0; i < k.length; i++) h = (h * 33 ^ k.charCodeAt(i)) >>> 0; return h.toString(36) };
const lTopic = a => (a.find(x => x.length >= 20 && x.length <= 160 && !LSECRET.test(x) && !/^(continue|ok|yes|no|go)\b/i.test(x)) || '').slice(0, 120);
function learnLine(l) {
  let j; try { j = JSON.parse(l) } catch { return }
  if (!j.sessionId || !j.message || j.isMeta || j.isCompactSummary || !/^(user|assistant)$/.test(j.type)) return;
  const P = st.sessions[j.sessionId]?.project || 'unknown', ts = j.timestamp || '', day = ts.slice(0, 10), L = (st.learn ??= {})[P] ??= { pref: {}, dec: {}, fix: {} };
  const sents = lSents(lText(j.message.content)), topic = j.type === 'user' ? lTopic(sents) : lAsk.get(j.sessionId) || '';
  if (j.type === 'user' && topic && !Array.isArray(j.message.content?.[0]?.content)) lAsk.set(j.sessionId, topic);
  for (const x of sents) {
    if (LSECRET.test(x) || /[{};=]{2}|\|\/[a-z]+\//i.test(x)) continue; // no secrets, code or paths
    const c = j.type === 'assistant' ? (x.length >= 30 && x.length <= 240 && x.split(' ').length >= 6 && !LVAGUE.test(x) && LFIX.test(x) ? 'fix' : null)
      : x.length < 12 || x.length > 200 ? null : LDEC.test(x) ? 'dec' : LPREF.test(x) ? 'pref' : null;
    if (!c) continue;
    const k = x.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 80), e = L[c][k] ??= { t: x, n: 0, s: 0, sid: '', first: day, last: day, ts: [] };
    const G = st.lGone?.[P]?.[c], gk = lHash(k); if (G?.[gk]) { const [t, s] = G[gk].split('|'); e.ts = t.split(',').map(v => new Date(parseInt(v, 36)).toISOString()).sort(); e.n = e.ts.length; e.s = +s; e.first = e.ts[0].slice(0, 10); e.last = e.ts[e.n - 1].slice(0, 10); delete G[gk] }
    if ((e.ts ??= []).includes(ts)) continue; e.ts.push(ts); // same message seen again (resumed copy)
    if (c !== 'pref' && topic && topic !== x && !e.ctx) e.ctx = topic;
    e.n++; if (day > e.last) e.last = day; if (e.sid !== j.sessionId) { e.sid = j.sessionId; e.s++ }
  }
}
function learnScan() {
  if (!CFG.learnDir) return; let budget = 64 << 20; const O = st.lOff ??= {};
  for (const f of walk(LOGS)) { if (budget <= 0) break; let size; try { size = fs.statSync(f).size } catch { continue }
    const off = O[f] > size ? 0 : O[f] || 0; if (off >= size) continue; const end = Math.min(size, off + budget); O[f] = eachLine(f, off, end, learnLine); budget -= end - off }
  for (const [P, L] of Object.entries(st.learn || {})) for (const c in L) { const a = Object.entries(L[c]); if (a.length <= 80) continue;
    a.sort((x, y) => y[1].s - x[1].s || y[1].n - x[1].n || (y[1].last > x[1].last) - (y[1].last < x[1].last) || (x[0] > y[0]) - (x[0] < y[0])); L[c] = Object.fromEntries(a.slice(0, 60));
    const G = ((st.lGone ??= {})[P] ??= {})[c] ??= {}; for (const [k, e] of a.slice(60)) { const T = e.ts.filter(Boolean); if (T.length) G[lHash(k)] = T.map(t => Date.parse(t).toString(36)).join(',') + '|' + e.s }
    const g = Object.keys(G); if (g.length > 4000) for (const k of g.slice(0, g.length - 4000)) delete G[k] } // ponytail: drops oldest-evicted past 4000 per category; raise if counts drift on huge histories
  if (Date.now() - (st.learnAt || 0) < 6e5) return; st.learnAt = Date.now(); learnNotes();
}
function learnNotes() {
  fs.mkdirSync(CFG.learnDir, { recursive: true });
  const top = (o, by, k) => Object.values(o).sort(by).slice(0, k), freq = (a, b) => b.s - a.s || b.n - a.n, recent = (a, b) => (b.last > a.last) - (b.last < a.last);
  const li = e => `- ${e.t}${e.ctx ? ` — while: “${e.ctx}”` : ''}`.replace(/\[\[|\]\]/g, m => m[0] + '​' + m[1]) + ` _(${e.s} chat${e.s > 1 ? 's' : ''}, ${e.first === e.last ? e.last : e.first + ' → ' + e.last})_`, idx = [], none = a => a.length ? a : ['- none yet'];
  const put = (file, head, auto) => { let s = null; try { s = fs.readFileSync(file, 'utf8') } catch { }
    const blk = A0 + '\n' + auto + '\n' + A1, out = s == null ? head + '\n\n' + blk + '\n' : s.includes(A0) && s.includes(A1) ? s.slice(0, s.indexOf(A0)) + blk + s.slice(s.indexOf(A1) + A1.length) : s.trimEnd() + '\n\n' + blk + '\n';
    if (out !== s) writeF(file, out) };
  for (const [P, L] of Object.entries(st.learn || {}).sort()) {
    const counts = [L.pref, L.dec, L.fix].map(o => Object.keys(o).length); if (!counts.some(Boolean)) continue;
    const name = 'Learned - ' + P.replace(/[\/:*?"<>|#^[\]]/g, '-'), sug = top(L.pref, freq, 40).filter(e => e.s >= 2).slice(0, 10);
    idx.push(`- [[${name}]]: ${counts[0]} preferences, ${counts[1]} decisions, ${counts[2]} fixes${sug.length ? `, ${sug.length} suggested rules` : ''}`);
    put(path.join(CFG.learnDir, name + '.md'), `---\ntags: [nexus-learned, project]\n---\n# ${name}\nLearned by the NEXUS tracker from the chats in project "${P}" (local rules, no AI). Index: [[NEXUS Learned]].`,
      ['## Suggested rules (need your approval; nothing is applied automatically)', ...(sug.length ? sug.map(li) : ['- none yet (a preference must appear in 2+ chats)']),
       '', '## Preferences (most repeated)', ...none(top(L.pref, freq, 25).map(li)), '', '## Decisions (latest)', ...none(top(L.dec, recent, 20).map(li)),
       '', '## Mistakes and fixes (latest)', ...none(top(L.fix, recent, 20).map(li))].join('\n'));
  }
  put(path.join(CFG.learnDir, 'NEXUS Learned.md'), "---\ntags: [nexus-learned, index]\n---\n# NEXUS Learned\nWhat the NEXUS tracker learned from every project's chats (preferences, decisions, mistakes and fixes). Token lessons: [[Token Optimizer]]. Approve a suggested rule by asking Claude to add it to that project's CLAUDE.md.",
    '## Projects\n' + (idx.join('\n') || '- none yet'));
}
function kb(r) {
  if (!CFG.kbDir || Date.now() - (st.kbAt || 0) < 6e5) return; st.kbAt = Date.now();
  const day = new Date().toLocaleDateString('sv'), E = st.kb ??= {}, kn = n => (n / 1e3).toFixed(1) + 'k';
  const set = (key, rbx, sec, text) => { const e = E[key]; if (!e) E[key] = { rbx: +rbx, sec, text, first: day, changed: day }; else if (e.sec !== sec) Object.assign(e, { sec, text, changed: day }) };
  for (const [key, rbx, t] of LESSONS) set(key, rbx, 'Lessons', t);
  for (const o of r.opts) { const s = o.status.startsWith('verified') ? 'Proven' : o.status === 'no clear effect' ? 'Not helping' : null;
    if (s) set('tip:' + o.name, 0, s, `${o.name}: ${o.status}. Est. waste per 100k tokens ${o.before} → ${o.after}${o.savedEst ? `, ~${kn(o.savedEst)} saved (est.)` : ''}; tip cost ~${o.costEst} tokens.`) }
  if (r.verify.enough) for (const x of r.verify.rows) if (x[2] != null) set('ba:' + x[0], 0, x[3] * x[5] > 0 && Math.abs(x[3]) >= 10 ? 'Proven' : 'Not helping', `${x[0]} (${x[4]}): ${x[1].toFixed(1)} → ${x[2].toFixed(1)} (${x[3] > 0 ? '+' : ''}${x[3]}%) after startup tips.`);
  for (const x of r.skadv.items) { const s = x.conf === 'high' ? 'Proven' : x.status === 'Consider removing' ? 'Not helping' : null; if (s) set('sk:' + x.name, RBX.test(x.name), s, `${x.name}: ${x.why}.`) }
  const now = new Set(r.issues.map(i => i[0]));
  for (const [k, s, n, w] of r.issues.slice(0, 8)) if (s >= 2 && w > 500) { const [t, ...tool] = k.split(':'); set('w:' + k, RBX.test(k), 'Recurring waste', `${tool.join(':') || t}: ${t} (~${kn(w)} est. waste, ${n}× in ${s} of the last 10 sessions when first seen). Fix: ${FIX[t] || 'see dashboard'}`) }
  for (const [key, e] of Object.entries(E)) if (e.sec === 'Recurring waste' && !now.has(key.slice(2))) set(key, e.rbx, 'Resolved', e.text.split(' Fix:')[0]);
  fs.mkdirSync(CFG.kbDir, { recursive: true });
  for (const [rbx, title] of [[1, 'Roblox Efficiency'], [0, 'General Efficiency']]) {
    const es = Object.values(E).filter(e => e.rbx === rbx), f = path.join(CFG.kbDir, title + '.md');
    const auto = A0 + '\n' + KSEC.map(([s, d]) => `## ${s}${d ? ` (${d})` : ''}\n` + (es.filter(e => e.sec === s).map(e => `- ${e.text} _(${e.first}${e.changed !== e.first ? `, changed ${e.changed}` : ''})_`).join('\n') || '- none yet')).join('\n\n') + '\n' + A1;
    let s = null; try { s = fs.readFileSync(f, 'utf8') } catch { }
    const out = s == null ? `---\ntags: [tokens, optimizer, ${rbx ? 'roblox' : 'general'}]\n---\n# ${title}\nSummaries from the local token tracker (detailed stats stay in the tracker). Hub: [[Token Optimizer]]. Your own notes outside the auto block are kept.\n\n${auto}\n`
      : s.includes(A0) && s.includes(A1) ? s.slice(0, s.indexOf(A0)) + auto + s.slice(s.indexOf(A1) + A1.length) : s.trimEnd() + '\n\n' + auto + '\n';
    if (out !== s) writeF(f, out);
  }
}
// ---------- Accuracy & Verification Center: local re-checks of the tracker's own numbers, no AI. Every 10 min; the first run reads every log once. ----------
// Verified = re-checked and correct. Collecting Data = not enough evidence yet. Needs Attention = wrong, missing or failing.
const VER = 'Verified', COL = 'Collecting Data', ATT = 'Needs Attention', U = u => [u.input_tokens || 0, u.output_tokens || 0, u.cache_creation_input_tokens || 0, u.cache_read_input_tokens || 0];
const homeP = p => p.replace(/^~/, os.homedir()).replace(/^\/([a-z])\//i, '$1:/');
const fixLog = msg => (st.autoLog ??= []).unshift([Date.now(), RED(msg)]);
// Independent recount: last usage per requestId (the scanner sums deltas instead), only up to the offset the scanner reached.
function recount(f, A) {
  const q = { bad: 0, noRid: 0, noSid: 0 }, ses = {}, hooks = {}, ov = {}, dev = new Set(), o = (k, t) => { const x = ov[k] ??= [0, 0]; x[0]++; x[1] += Math.round(t.length / 4) };
  eachLine(f, 0, st.files[f]?.off || 0, l => {
    const isU = l.includes('"usage"'), isH = l.includes('"hook_'); if (!isU && !isH) return;
    let j; try { j = JSON.parse(l) } catch { if (isU) q.bad++; return }
    const a = j.attachment;
    if (a && /^hook_(success|cancelled|error|non_blocking_error|blocking_error)$/.test(a.type) && a.command) {
      const h = hooks[a.command] ??= { n: 0, fail: 0, last: 0, lastOk: 1, ms: 0 }, ok = a.type === 'hook_success' && !a.exitCode && !a.timedOut, t = Date.parse(j.timestamp) || 0;
      h.n++; h.ms += a.durationMs || 0; if (!ok) h.fail++; if (t >= h.last) { h.last = t; h.lastOk = +ok }
      if (!ok) (h.fl ??= []).push([t, +!!a.timedOut]); if (a.durationMs > 5000) (h.sl ??= []).push(t); // failures (time, timed out) + slow runs, to tell one-off stalls from recurring failures
    }
    // Tracker overhead: text it injects (tips at startup, advisor warnings) and the warning lines Claude writes because of it.
    if (a?.type === 'hook_success') { const t = String(a.content || a.stdout || ''), m = /^(TOKEN TIPS|CONTEXT ADVISOR|SKILL ADVISOR)/.exec(t); if (m) o(m[1], t) }
    if (j.type === 'assistant' && Array.isArray(j.message?.content)) for (const c of j.message.content) {
      if (c.type === 'text' && c.text.includes('⚠ Context Advisor:')) o('warning line in reply', c.text.slice(c.text.indexOf('⚠ Context Advisor:')));
      if (c.type === 'tool_use' && /^(Edit|Write|MultiEdit)$/.test(c.name) && /token-tracker/i.test(c.input?.file_path || '') && j.sessionId) dev.add(j.sessionId) }
    const u = j.message?.usage; if (j.type !== 'assistant' || !u) return;
    if (!U(u).some(Boolean)) return; // synthetic/error messages carry all-zero usage
    if (!j.sessionId) return q.noSid++; if (!j.requestId) return q.noRid++;
    (ses[j.sessionId] ??= {})[j.requestId] = [j.message.model || '?', U(u)];
  });
  A.fq[f] = q; A.fh[f] = hooks; A.fo[f] = ov; A.fd[f] = [...dev]; A.off[f] = st.files[f]?.off || 0;
  return ses;
}
function audit(r, now, force) {
  const A = st.audit ??= {}; for (const k of ['fq', 'fh', 'fo', 'fd', 'off', 'ses', 'since']) A[k] ??= {};
  if (A.v !== 4) { A.off = {}; A.ses = {}; A.v = 4 } // v4 cross-session dedup: recount every log once
  if (!force && now - (A.at || 0) < 6e5) return A.out;
  A.at = now; const files = walk(LOGS), C = [], day = d => new Date(d).toLocaleDateString('sv');
  const put = (id, name, status, detail, why) => { const p = A.since[id]; if (!p || p[0] !== status) A.since[id] = [status, now]; C.push({ id, name, status, detail, why, at: now, since: A.since[id][1] }) };
  // 1. Token counts vs logs (+ safe auto-fix with a state backup)
  const R = {}; delete A.rid; A.fs ??= {}; A.sf ??= {}; // ownership now lives in st.rids (full request id -> session)
  const todo = new Set(files.filter(f => A.off[f] !== (st.files[f]?.off || 0))); // changed logs + every other log of the same sessions, so totals are complete
  for (const f of [...todo]) for (const s of A.fs[f] || []) for (const g of A.sf[s] || []) if (files.includes(g)) todo.add(g);
  for (const f of todo) { const ses = recount(f, A); A.fs[f] = Object.keys(ses);
    for (const [sid, reqs] of Object.entries(ses)) { Object.assign(R[sid] ??= {}, reqs); A.sf[sid] = [...new Set([...(A.sf[sid] || []), f])] } }
  let dup = 0, copies = 0, bad = [], fixed = 0, backup = null; // dup = requests the scanner never indexed (owner unknown)
  for (const [sid, reqs] of Object.entries(R)) {
    for (const k in reqs) { const o = st.rids?.[RK(k)]; if (o == null) dup++; else if (st.sids[o] !== sid) { delete reqs[k]; copies++ } } // copies count in their original session only
    const m = {}; for (const [md, v] of Object.values(reqs)) add(m, md, v);
    const S = st.sessions[sid], t = S ? tot(S.models) : [0, 0, 0, 0], c = tot(m), ok = !!S && t.every((x, i) => x === c[i]);
    if (!ok && S && A.sf[sid].every(g => todo.has(g))) { // tracker total differs from the log: replace with the recount; the per-day chart is corrected on the session's last day
      backup ??= (writeF(F(`state.pre-fix-${day(now)}.json`), JSON.stringify(st)), `state.pre-fix-${day(now)}.json`);
      for (const md of new Set([...Object.keys(m), ...Object.keys(S.models)])) { const d = (m[md] || [0, 0, 0, 0]).map((x, i) => x - ((S.models[md] || [])[i] || 0)); add(st.days[day(S.end || now)] ??= {}, md, d) }
      S.models = m; fixed++; fixLog(`Corrected token totals for session ${sid.slice(0, 8)} to match its log (was ${sum(t)}, log ${sum(c)}). Backup: ${backup}`);
    } else if (!ok) bad.push(sid.slice(0, 8));
    A.ses[sid] = [Object.keys(reqs).length, sum(c), now, c];
  }
  const sv = Object.values(A.ses), nReq = sv.reduce((x, s) => x + s[0], 0), nTok = sv.reduce((x, s) => x + s[1], 0);
  put('tokens', 'Token counts vs Claude Code logs', bad.length ? ATT : sv.length ? VER : COL,
    `${sv.length} sessions · ${nReq} requests · ${k1(nTok)} tokens re-counted from the raw logs${fixed ? ` · ${fixed} corrected automatically this check` : ' · all match exactly'}${bad.length ? ` · ${bad.length} sessions don't match and couldn't be fixed safely (${bad.slice(0, 3).join(', ')})` : ''}`,
    'Re-reads the logs with a different method (final usage per request) and compares with the dashboard totals. Mismatches are corrected automatically; a backup of the old numbers is kept.');
  // 2. Missing data
  const q = Object.values(A.fq).reduce((x, y) => (x.bad += y.bad, x.noRid += y.noRid, x.noSid += y.noSid, x), { bad: 0, noRid: 0, noSid: 0 });
  const stuck = files.filter(f => { const s = fs.statSync(f); return s.size - (st.files[f]?.off || 0) > 0 && now - s.mtimeMs > 6e4 }), gone = Object.keys(st.sessions).filter(s => !A.ses[s]).length;
  const miss = q.bad + q.noRid + q.noSid + stuck.length;
  put('missing', 'Missing data', miss ? ATT : VER,
    miss ? `${q.bad} unreadable usage lines · ${q.noRid + q.noSid} usage lines without request/session id · ${stuck.length} log files not fully scanned` : `All ${files.length} log files fully scanned; no unreadable or unlabelled usage lines` + (gone ? ` · ${gone} older sessions kept from logs Claude Code has since deleted (can't be re-checked)` : ''),
    'Looks for usage lines the tracker would skip and log files it has not finished reading.');
  // 3. Duplicates
  put('dupes', 'Duplicated data', dup || bad.length ? ATT : VER, dup ? `${dup} requests have no owning session (index missing: run "node tracker.js dedup")` : `Each request counted once across ${Object.keys(st.rids || {}).length} requests · ${copies} copies from resumed chats excluded this check`,
    'Each request has one id. A resumed chat copies earlier requests into its new log; they count only in the session that logged them first. Totals are re-checked against the logs above.');
  // 4. Optimization effectiveness (tips)
  const o = r.opts[0], retired = Object.keys(st.retired || {});
  put('optim', 'Optimization effectiveness', o.status.startsWith('verified') ? VER : o.status === 'no clear effect' ? ATT : COL,
    `${o.status}${retired.length ? ` · retired tips: ${retired.join(', ')}` : ''}`,
    'Compares problem counts (measured) before vs after startup tips. "Verified" proves fewer problems; the token size of the saving is an estimate (chars ÷ 4).');
  // 5. Context Advisor: how close the "after compaction" prediction is to real compactions (leave-one-out)
  const pairs = all().flatMap(S => (S.post || []).map((p, i) => [(S.pre || [])[i], p]).filter(([a, b]) => a > 5e4 && b));
  const med = a => a.sort((x, y) => x - y)[a.length >> 1]; // median: a few odd compactions shouldn't swing the score
  const err = pairs.length >= 3 ? Math.round(med(pairs.map(([a, b], i) => { const o = avg(pairs.filter((_, j) => j !== i).map(x => x[1])); return Math.abs(o - b) / Math.max(1, a - b) })) * 100) : null;
  const snaps = (readJ(F('responses.json'), {}).log || []).filter(x => /^saved before/.test(x[2])), aj = readJ(F('advice.json'), {}), stale = now - (aj.at || 0) > 5 * 6e4;
  put('advisor', 'Context Advisor', stale ? ATT : err == null ? COL : err <= 30 ? VER : ATT,
    `${pairs.length} measured compactions${err != null ? ` · savings estimates off by ~${err}% (median)` : ' (need 3)'} · auto-compact point ${k1(r.advisor.win)} · advice ${stale ? 'STALE (in-chat warnings paused)' : 'fresh'} · ${snaps.length} auto-saves logged`,
    'Checks the predicted context size after /compact against real compactions, and that advice is fresh enough for the in-chat hook to use.');
  // 6. Skills: every skill load in the last 10 sessions should have a measured cost
  const rec = all().filter(S => S.n).slice(-10), loads = new Set(), costed = new Set();
  for (const S of rec) for (const n in S.skills) { if (/^superpowers/.test(n)) continue; loads.add(n); if ((S.skillTok || {})[n]) costed.add(n) }
  const gap = [...loads].filter(n => !costed.has(n)), sc = r.skills.combined;
  put('skills', 'Skills tracking', gap.length ? ATT : loads.size ? VER : COL,
    `${r.skadv.items.length} skills/plugins/hooks found · ${costed.size}/${loads.size} skills loaded recently have a measured cost${gap.length ? ` (missing: ${gap.join(', ')})` : ''} · savings: ${sc.status} (${sc.nW} with / ${sc.nWo} without)`,
    'Confirms each skill load is measured. Savings need 10+ sessions with and without skills in the same projects.');
  // 7. Hooks: configured hooks vs runs seen in the logs
  const H = {}; for (const fh of Object.values(A.fh)) for (const [c, h] of Object.entries(fh)) { const x = H[c] ??= { n: 0, fail: 0, last: 0, lastOk: 1, fl: [], sl: [] }; x.n += h.n; x.fail += h.fail; x.fl.push(...h.fl || []); x.sl.push(...h.sl || []); if (h.last >= x.last) { x.last = h.last; x.lastOk = h.lastOk } }
  // Isolated = exactly one failure in 7 days and it was a timeout. Any exit-code error or a 2nd failure = recurring (Needs Attention).
  // A failure while other hooks also failed or were slow (within 60 s) = PC stall/glitch, not this hook. 3+ such moments in 7 days still count as recurring.
  const near = (c, t) => Object.entries(H).some(([o, x]) => o !== c && (x.sl.some(s => Math.abs(s - t) < 6e4) || x.fl.some(s => Math.abs(s[0] - t) < 6e4)));
  const cls = (c, h) => { const f = (h?.fl || []).filter(x => now - x[0] < 7 * DAY); if (!f.length) return 'ok'; const o = f.filter(x => !near(c, x[0])), inc = new Set(f.filter(x => near(c, x[0])).map(x => Math.round(x[0] / 6e4))).size;
    return o.length > 1 || o.some(x => !x[1]) || inc >= 3 ? 'recurring' : 'isolated' };
  const isoTxt = ([c, h]) => { const f = h.fl.filter(x => now - x[0] < 7 * DAY), t = f.at(-1)[0]; return `${base(norm(c)).slice(0, 40)} (${f.length > 1 ? f.length + ' failures, last' : '1 ' + (f[0][1] ? 'timeout' : 'error')} on ${new Date(t).toLocaleString('sv').slice(0, 16)}${near(c, t) ? '; other hooks failed or were slow at the same moment = PC stall, not this hook' : ''})` };
  const set = readJ(path.join(os.homedir(), '.claude', 'settings.json'), {}), hk = [];
  for (const [ev, arr] of Object.entries(set.hooks || {})) for (const g of arr) for (const c of g.hooks || []) if (c.command) {
    const p = (c.command.match(/"([^"]+\.(?:js|sh|cmd|ps1))"|(\S+\.(?:js|sh|cmd|ps1))/) || []).slice(1).find(Boolean), exists = !p || fs.existsSync(homeP(p)), h = H[c.command];
    const ran = h ? h.lastOk : /snap$/.test(c.command) ? (snaps[0] ? +/verified/.test(snaps[0][3]) : null) : null;
    hk.push({ ev, cmd: c.command, exists, ran, n: h?.n || 0, fail: h?.fail || 0 });
  }
  const isoOwn = hk.filter(h => h.exists && h.ran === 0 && cls(h.cmd, H[h.cmd]) === 'isolated').map(h => [h.cmd, H[h.cmd]]);
  const badH = hk.filter(h => !h.exists || h.ran === 0 && !isoOwn.some(x => x[0] === h.cmd)), waitH = hk.filter(h => h.ran == null);
  const plug = Object.entries(H).filter(([c]) => !hk.some(x => x.cmd === c)), otherFail = plug.filter(([c, h]) => cls(c, h) === 'recurring' && (!h.lastOk || h.fl.filter(x => now - x[0] < 7 * DAY).length > 1));
  const iso = [...isoOwn, ...plug.filter(([c, h]) => cls(c, h) === 'isolated' && !h.lastOk)];
  put('hooks', 'Hooks', badH.length || otherFail.length ? ATT : waitH.length || iso.length ? COL : VER,
    `${hk.length - badH.length - waitH.length - isoOwn.length}/${hk.length} of your hooks ran OK last time` + (badH.length ? ` · failing or missing: ${badH.map(h => h.ev + ' ' + base(norm(h.cmd)).slice(0, 40)).join('; ')}` : '') +
    (waitH.length ? ` · no run logged yet: ${waitH.map(h => h.ev).join(', ')}` : '') + (otherFail.length ? ` · plugin or project hooks failing repeatedly or with errors in the past 7 days (they are never changed automatically): ${otherFail.map(([c]) => base(norm(c)).slice(0, 40)).join('; ')}` : '') +
    (iso.length ? ` · isolated timeout, watching for a repeat (a 2nd failure within 7 days = Needs Attention): ${iso.map(isoTxt).join('; ')}` : ''),
    'Reads hook results Claude Code writes to the logs (exit code, timeouts) and checks each hook script exists. Compact/clear auto-save hooks are checked through their Obsidian save log. One timeout in 7 days is shown as isolated (Collecting Data); a repeat or any error exit is Needs Attention.');
  // 8. Obsidian: tracker notes in sync (auto-fix: rewrite them) + project docs equal to their vault copies
  const ob = [], rd = f => { try { return fs.readFileSync(f, 'utf8') } catch { return null } };
  if (CFG.vaultNote) { const s = rd(CFG.vaultNote); if (s == null || s.replace(/updated: .*\n/, '') !== st.noteBody) { st.noteBody = null; st.noteAt = 0; note(r); fixLog('Rewrote the Token Optimizer note in Obsidian (it was missing or out of date)') } ob.push(rd(CFG.vaultNote)?.replace(/updated: .*\n/, '') === st.noteBody) }
  if (CFG.kbDir) for (const t of ['Roblox Efficiency', 'General Efficiency']) { const s = rd(path.join(CFG.kbDir, t + '.md')); if (!s || !s.includes(A0) || !s.includes(A1)) { st.kbAt = 0; kb(r); fixLog(`Restored the auto section of ${t}.md in Obsidian`) } ob.push(!!rd(path.join(CFG.kbDir, t + '.md'))?.includes(A1)) }
  const sh = rd(CFG.syncScript || ''), pairs2 = [];
  if (sh) { const P = homeP((sh.match(/^P="([^"]+)"/m) || [])[1] || ''), V = homeP((sh.match(/^V="([^"]+)"/m) || [])[1] || '');
    for (const [, a, b] of sh.matchAll(/^cp "\$P\/([^"]+)"\s+"\$V\/([^"]+)"/gm)) pairs2.push([path.join(P, a), path.join(V, b)]);
    for (const n of fs.existsSync(path.join(P, 'docs')) ? fs.readdirSync(path.join(P, 'docs')).filter(n => n.endsWith('.md')) : []) pairs2.push([path.join(P, 'docs', n), path.join(V, n)]) }
  const diff = pairs2.filter(([a, b]) => rd(a) !== rd(b)), sOk = !snaps.length || /verified/.test(snaps[0][3]);
  put('obsidian', 'Obsidian syncing', ob.includes(false) || diff.length || !sOk ? ATT : VER,
    `tracker notes ${ob.filter(Boolean).length}/${ob.length} in sync · project docs ${pairs2.length - diff.length}/${pairs2.length} match the vault${diff.length ? ` (out of date: ${diff.map(([a]) => path.basename(a)).join(', ')}; run bash sync_docs.sh)` : ''} · last auto-save: ${snaps[0] ? snaps[0][3] : 'none yet'}`,
    'Compares the files on disk with the vault copies byte for byte. Obsidian Sync\'s cloud upload can\'t be checked from here.');
  // Savings, kept apart: only token amounts read from usage logs are "verified".
  const sv2 = r.saved, ad = r.advisor.sessions.filter(s => s.save > 0 && s.action !== 'continue');
  const savings = [
    { src: 'Skills (with vs without)', amount: sc.status === 'verified' ? sv2.verified : sc.status === 'estimate' ? sc.perSession * sc.nW : null, kind: sc.status === 'verified' ? 'verified' : 'estimate', unit: 'output tokens (measured in usage logs)', note: sc.status === 'Not enough data' ? `Not enough data (${sc.nW} with / ${sc.nWo} without)` : `${sc.status}; a correlation across sessions, not a controlled test` },
    { src: 'Startup tips', amount: sv2.tipVerifiedEst || null, kind: 'estimate', unit: 'tokens (chars ÷ 4)', note: o.status.startsWith('verified') ? 'fewer problems is verified; the token size is estimated' : o.status },
    { src: 'Context Advisor (if followed)', amount: ad.length ? +ad.reduce((x, s) => x + s.save, 0).toFixed(2) : null, usd: true, kind: 'estimate', unit: 'US$ net at API list price', note: 'a forecast, not a saving; dollars at list price are not the same as Claude Pro usage' },
  ];
  // Net = savings (verified + estimated) minus the tokens the tracker itself adds to chats. Advisor forecasts are not savings. Build cost shown apart.
  const OV = {}; for (const x of Object.values(A.fo)) for (const [k, v] of Object.entries(x)) { const y = OV[k] ??= [0, 0]; y[0] += v[0]; y[1] += v[1] }
  const over = Object.entries(OV).map(([k, v]) => ({ what: k === 'TOKEN TIPS' ? 'Startup tips (every new chat/compact)' : k === 'CONTEXT ADVISOR' ? 'Context Advisor instructions' : k === 'SKILL ADVISOR' ? 'Skill Advisor notices' : 'Context Advisor line in replies', n: v[0], tok: v[1] })).sort((a, b) => b.tok - a.tok);
  const devS = new Set(Object.values(A.fd).flat()), bt = [0, 0, 0, 0]; for (const sid of devS) (A.ses[sid]?.[3] || []).forEach((x, i) => bt[i] += x);
  const overTok = over.reduce((x, y) => x + y.tok, 0), got = savings.slice(0, 2).filter(x => x.amount != null), gain = got.reduce((x, y) => x + y.amount, 0);
  const enough = sc.status !== 'Not enough data' || o.n >= 5 && !o.status.startsWith('collecting');
  const net = { status: !enough ? 'Insufficient Data' : gain - overTok >= 0 ? 'Net Positive' : 'Net Negative', gain, overTok, net: enough ? gain - overTok : null, over,
    build: { sessions: devS.size, fresh: bt[0] + bt[1] + bt[2], cached: bt[3] },
    why: !enough ? `Savings are still unmeasured: tips ${o.status}; skills ${sc.status} (${sc.nW} with / ${sc.nWo} without). Overhead is measured: ~${k1(overTok)} tokens injected so far.`
      : `Measured/estimated savings ~${k1(gain)} vs ~${k1(overTok)} tokens the tracker added to chats.` };
  A.out = { at: now, checks: C, savings, net, counts: Object.fromEntries([VER, COL, ATT].map(s => [s, C.filter(c => c.status === s).length])) };
  return A.out;
}
const k1 = n => n == null ? '–' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : '' + n;
const all = () => Object.values(st.sessions).sort((a, b) => a.end - b.end);
let rep = null, saved = null, svMemo = null;
// User actions from the NEXUS Optimizations page / Learning Lab. Only the tracker's own optimizer state; every change is logged and reversible.
const RECK = /^(tipsoff|long|rebuild)$/;
function act(o) {
  const now = Date.now(), k = String(o?.k || ''), log = m => { (st.autoLog ??= []).unshift([now, RED('You: ' + m)]); st.autoLog.length = Math.min(st.autoLog.length, 100) };
  if (o?.a === 'analyze') { }
  else if (o?.a === 'tip' && Object.hasOwn(TIPRE, k)) {
    if (o.on) { if (!st.retired?.[k]) return 'already active'; delete st.retired[k]; (st.retest ??= {})[k] = now; log(`re-enabled tip "${k}" (fresh test from now)`) }
    else { if (st.retired?.[k]) return 'already retired'; (st.retired ??= {})[k] = now; log(`retired tip "${k}"`) } }
  else if (o?.a === 'dismiss' && RECK.test(k)) { const d = st.dismissed ??= {}; if (!o.on === !d[k]) return 'unchanged'; if (o.on) d[k] = now; else delete d[k]; log(`${o.on ? 'dismissed' : 'restored'} recommendation "${k}"`) }
  else if (o?.a === 'exp') {
    const X = st.exps ||= {}, x = X[String(o.id || '')], goal = Math.round(+o.goal);
    if (o.op === 'new') {
      if (!Object.hasOwn(TIPRE, k) || !(goal >= 10 && goal <= 90)) return 'unknown action';
      if (Object.values(X).some(y => y.k === k && y.status !== 'stopped')) return 'already testing this type';
      const id = 'x' + now.toString(36); X[id] = { id, k, goal, start: now, status: 'running', prev: { retired: st.retired?.[k] || null, tipsLog: st.tipsLog[k] || null, retest: st.retest?.[k] || null } };
      if (st.retired) delete st.retired[k]; (st.retest ??= {})[k] = now; st.tipsLog[k] ??= now; log(`started experiment "${k}" (goal: ${goal}% less est. waste)`) }
    else if (!x) return 'unknown action';
    else if (o.op === 'pause' || o.op === 'resume') { const to = o.op === 'pause' ? 'paused' : 'running'; if (x.status !== (to === 'paused' ? 'running' : 'paused')) return 'unchanged'; x.status = to; log(`${o.op}d experiment "${x.k}"`) }
    else if (o.op === 'stop') {
      if (x.status === 'stopped') return 'unchanged';
      const r = (rep?.opts || []).find(y => y.name === 'Tip: ' + x.k); x.result = r ? { ...r } : null; x.status = 'stopped'; x.end = now; const p = x.prev;
      if (p.retired) (st.retired ??= {})[x.k] = p.retired; else if (!p.tipsLog) delete st.tipsLog[x.k]; // a tip only the experiment created stops loading (auto-learning can still pick it up later)
      if (p.retest) st.retest[x.k] = p.retest; else delete st.retest[x.k];
      log(`stopped experiment "${x.k}": ${r ? r.status : 'no result'} (tip state restored)`) }
    else return 'unknown action' }
  else if (o?.a === 'config') { // Settings → Claude Code: the two tracker values the Settings page may change (config.json, nothing else)
    const lim = o.fiveHourLimitTokens == null ? null : Math.round(+o.fiveHourLimitTokens), ov = Math.round(+o.oversizedChars);
    if ((lim !== null && !(lim >= 1e4 && lim <= 1e10)) || !(ov >= 4000 && ov <= 4e5)) return 'bad values';
    if (lim === CFG.fiveHourLimitTokens && ov === CFG.oversizedChars) return 'unchanged';
    CFG.fiveHourLimitTokens = lim; CFG.oversizedChars = ov; writeF(F('config.json'), JSON.stringify({ ...readJ(F('config.json'), {}), fiveHourLimitTokens: lim, oversizedChars: ov }, null, 2));
    log(`Settings: 5-hour limit ${lim ?? 'unknown'}, waste tip over ${ov / 4 | 0} tokens`) }
  else if (o?.a === 'auto') { if (!o.on === !!st.autoOff) return 'unchanged'; st.autoOff = !o.on; log(o.on ? 'resumed automatic optimization' : 'paused automatic optimization') }
  else return 'unknown action';
  tick(o.a === 'analyze'); return 'ok';
}
function tick(force) { for (const m of require('./backup.js').BAD.splice(0)) fixLog('Data: ' + m); // P2a T4: corrupt state.json / projects.json → bell
  try { scan(); rep = report(); note(rep); kb(rep); learnScan(); rep.audit = audit(rep, Date.now(), force) } catch (e) { rep = { ...(rep || {}), error: String(e.stack || e) } }
  const s = JSON.stringify(st); if (s !== saved) try { require('./backup.js').writeJ(F('state.json'), s); saved = s } catch (e) { fixLog('Data: state.json could not be saved (' + e.code + '); kept in memory, saved again next tick') } } // unchanged state = no disk write; B65: a failed save no longer stops the server

// Page lives in dashboard.html (read per request, so edits need no restart).

// /api/proc: live machine + current-session facts for the M4 preview. Only runs when the preview asks; never on the hook path.
let cpuLast = [process.cpuUsage(), Date.now()], tl = { at: 0, rows: [], wait: null };
const APPS = [['Claude Code', /^claude\.exe$/i], ['Obsidian', /^obsidian\.exe$/i], ['Blender', /^blender\.exe$/i], ['Roblox Studio', /^robloxstudio/i]];
function tasks(cb) { // one async tasklist, cached 30 s
  if (Date.now() - tl.at < 30000) return cb(tl.rows);
  if (tl.wait) return tl.wait.push(cb);
  tl.wait = [cb];
  cp.execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, out) => {
    const m = {}; for (const l of e ? [] : out.split('\n')) { const c = l.trim().slice(1, -1).split('","'); for (const [n, re] of APPS) if (re.test(c[0])) m[n] = (m[n] || 0) + (parseInt((c[4] || '').replace(/\D/g, '')) || 0) * 1024 }
    tl.rows = e ? null : APPS.map(([n]) => [n, m[n] || 0]); tl.at = Date.now(); const w = tl.wait; tl.wait = null; w.forEach(f => f(tl.rows));
  });
}
function proc(r) {
  const c = process.cpuUsage(cpuLast[0]), now = Date.now(), cpu = (c.user + c.system) / 1e3 / Math.max(1, now - cpuLast[1]) * 100 / os.cpus().length; cpuLast = [process.cpuUsage(), now];
  let disk = null; try { const s = fs.statfsSync(path.parse(DIR).root); disk = [s.blocks * s.bsize, (s.blocks - s.bfree) * s.bsize] } catch { }
  let data = 0; for (const f of fs.readdirSync(DIR)) try { const s = fs.statSync(F(f)); if (s.isFile()) data += s.size } catch { }
  const S = all().at(-1), cur = S && { id: S.id, project: S.project, start: S.start, end: S.end, n: S.n,
    model: Object.entries(S.models).sort((a, b) => (b[1][1] || 0) - (a[1][1] || 0))[0]?.[0] || null,
    ctx: Object.values(S.req || {}).slice(-60).map(v => v[0] + v[2] + v[3]) };
  tasks(rows => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ at: now, cpu: Math.round(cpu * 10) / 10, rss: process.memoryUsage().rss, mem: [os.totalmem(), os.totalmem() - os.freemem()], disk, data, apps: rows, cur })) });
}
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
function app(u, r) { // static files of the M4 preview, only from app/
  const root = F('app'); let p; try { p = path.resolve(root, '.' + decodeURIComponent(u.split('?')[0])) } catch { }
  try { if (p && p.startsWith(root + path.sep) && fs.statSync(p).isFile()) { r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' }); return r.end(fs.readFileSync(p)) } } catch { }
  r.writeHead(404); r.end();
}

const mode = process.argv[2];
if (mode === 'serve') {
  // P2a T1/T2 (recover.js): no start while maintenance.lock is valid; crash record (serve.json) + crash-loop limit checked once listening, before launch.key
  const REC = require('./recover.js')(DIR), MANUAL = process.argv.includes('--manual'), glog = m => { try { fs.appendFileSync(F('guard.log'), new Date().toISOString() + ' ' + RED(m) + '\n') } catch { } };
  const LK = REC.lock(); if (LK) { glog(LK.valid ? 'serve not started: maintenance lock (' + LK.why + ')' : 'stale maintenance lock ignored (' + LK.why + ')'); if (LK.valid) process.exit(0) }
  let died = false; const crash = e => { died = true; glog('serve crashed: ' + String(e?.message || e).slice(0, 200) + ' | ' + String(e?.stack || '').split('\n')[1]?.trim().replace(/\(.*[\\/]/, '(')); process.exit(1) };
  process.on('uncaughtException', crash).on('unhandledRejection', crash).on('exit', () => died || REC.clean()); // clean exit = record removed; a crash keeps it
  for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(s, () => process.exit(0));
  const LOCAL = require('./local.js'), PT = require('./port.js'); let AUTH, port = PORT, proveT = 0, proveN = 0; // serve only: CLI modes (act, update, dedup) run without them. AUTH: made once bound (P3: proof + cookie use the real port)
  const srv = http.createServer((q, r) => {
    if (!LOCAL(q, port)) { r.writeHead(403); return r.end() } // M4a: Host, loopback, Origin, JSON POST (local.js)
    if (q.url.startsWith('/launch?')) { // M4b: one-time code from `node tracker.js open` → HttpOnly cookie, code gone from the address bar
      const c = AUTH.redeem(new URL(q.url, 'http://x').searchParams.get('c'));
      if (!c) { r.writeHead(403, { 'content-type': 'text/plain' }); return r.end('Launch link used or expired. Open NEXUS again (start.cmd or: node tracker.js open).') }
      r.writeHead(302, { 'set-cookie': c, location: '/preview', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); return r.end()
    }
    if (q.url.startsWith('/api/prove?') && q.method === 'GET') { // B61: identity proof before any token is sent (launch.js prove); 10/s cap, 400 for a bad nonce
      const now = Date.now(); if (now - proveT >= 1000) { proveT = now; proveN = 0 } if (++proveN > 10) { r.writeHead(429); return r.end() }
      const m = AUTH.prove(new URL(q.url, 'http://x').searchParams.getAll('n').join('&')); r.writeHead(m ? 200 : 400, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return r.end(m ? JSON.stringify({ v: 1, mac: m }) : '{}')
    }
    if (!AUTH.ok(q)) { r.writeHead(401, { 'content-type': 'text/plain' }); return r.end('NEXUS is locked. Open it with start.cmd or: node tracker.js open' + (AUTH.keyErr ? '\nlaunch.key could not be made user-only, so launching is off (see guard.log).' : '')) } // M4b: cookie or x-nexus-token (launch.js)
    if (q.url === '/api/launch' && q.method === 'POST') { r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify({ code: AUTH.code() })) }
    if (q.url === '/api') { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ ...(rep || {}), sys: require('./sys.js').bell() })) }
    else if (q.url === '/api/proc') proc(r)
    else if (q.url.split('?')[0] === '/api/setup/detect') { if (q.method !== 'GET') { r.writeHead(405); return r.end() } require('./setup.js')(q.url.endsWith('?refresh=1'), o => { r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify(o)) }) } // M0 Setup preview: read-only detection (setup.js)
    else if (q.url.split('?')[0] === '/api/inv') { if (q.method !== 'GET') { r.writeHead(405); r.end(); return } let j; try { j = JSON.stringify(require('./inv.js')(q.url.endsWith('?refresh=1'))) } catch (e) { j = JSON.stringify({ error: RED(e.message) }) } r.writeHead(200, { 'content-type': 'application/json' }); r.end(j) } // read-only, Plugins & Skills page
    else if (q.url === '/api/act' && q.method === 'POST') {
      let b = ''; q.on('data', c => { if ((b += c).length > 1e3) q.destroy() }).on('end', () => {
        let res; try { res = act(JSON.parse(b)) } catch { res = 'bad request' }
        r.writeHead(res === 'ok' ? 200 : 400, { 'content-type': 'application/json' }); r.end(JSON.stringify({ res })) }) }
    else if (q.url.split('?')[0] === '/api/projects' || q.url.startsWith('/api/projects/img?')) { // Projects page (projects.js): GET list / detail / picture, POST same guards as /api/plugin, body ≤ 8 KB
      const P = require('./projects.js'), u = new URL(q.url, 'http://x'), json = (c, o) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)) };
      if (q.method === 'GET') { try {
        if (u.pathname.endsWith('/img')) { const f = P.img(u.searchParams.get('id'), u.searchParams.get('f')); if (!f) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': f.type, 'cache-control': 'max-age=300' }); return r.end(fs.readFileSync(f.file)) }
        return json(200, u.searchParams.get('id') ? P.detail(u.searchParams.get('id')) : P.status({ refresh: u.searchParams.has('refresh') })) } catch (e) { return json(500, { res: RED(e.message) }) } }
      const ok = q.method === 'POST';
      if (!ok) { r.writeHead(403); return r.end() }
      let b = ''; q.on('data', c => { if ((b += c).length > 8e3) q.destroy() }).on('end', () => { let o; try { o = P.post(JSON.parse(b)) } catch (e) { o = { res: 'bad request: ' + RED(e.message) } } json(o.res === 'ok' ? 200 : 400, o) }) }
    else if (/^\/api\/(graph|vault)(\/live)?(\?|$)/.test(q.url)) { // Obsidian & Graphify page (knowledge.js): GET graph, live patches (SSE), vault status / note / search; POST same guards as /api/projects, body ≤ 600 KB (note saves)
      const K = require('./knowledge.js'), u = new URL(q.url, 'http://x'), json = (c, o) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)) };
      if (q.method === 'GET') { try {
        if (u.pathname === '/api/graph/live') return K.live(q, r, u.searchParams.get('v'));
        if (u.pathname === '/api/graph') return json(200, K.graph());
        const op = u.searchParams.get('op'); return json(200, op === 'note' ? K.noteDetail(u.searchParams.get('p')) : op === 'search' ? K.search(u.searchParams.get('q')) : K.status()) } catch (e) { return json(500, { res: RED(e.message) }) } }
      const ok = q.method === 'POST' && u.pathname === '/api/vault';
      if (!ok) { r.writeHead(403); return r.end() }
      let b = ''; q.on('data', c => { if ((b += c).length > 6e5) q.destroy() }).on('end', () => { let o; try { o = K.post(JSON.parse(b)) } catch (e) { o = { res: 'bad request: ' + RED(e.message) } } json(o.res === 'ok' || o.res === 'confirm' ? 200 : 400, o) }) }
    else if (/^\/api\/sync(\/diff|\/run|\/engine)?(\?|$)/.test(q.url)) require('./syncview.js').handle(q, r, port) // Knowledge page Sync tab (syncview.js): GET preview / diff, POST run / engine (same guards as /api/auto), one project per request
    else if (q.url === '/api/scan') { // M7f Startup Change Scan (scan.js): GET last report, POST {force} runs a scan (startup scans skip if the last one is < 2 min old)
      const SC = require('./scan.js'), dir = require('./accounts.js').dir(), json = (c, o) => { r.writeHead(c, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify(o)) };
      if (q.method === 'GET') return json(200, SC.last(dir)); if (q.method !== 'POST') { r.writeHead(405); return r.end() }
      let b = ''; q.on('data', c => { if ((b += c).length > 1e3) q.destroy() }).on('end', () => { let o = {}; try { o = JSON.parse(b || '{}') } catch { }
        SC.run({ dir, force: !!o.force, sessions: st.sessions }).then(j => json(j.res === 'ok' ? 200 : 500, j)) }) }
    else if (/^\/api\/auto(\/runs|\/export)?(\?|$)/.test(q.url)) { // Automation page (auto.js): GET status / runs / export; POST same guards as /api/projects + confirm:true, body ≤ 64 KB
      const A = require('./auto.js'), u = new URL(q.url, 'http://x'), g = k => u.searchParams.get(k), json = (c, o) => { r.writeHead(c, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify(o)) };
      if (q.method === 'GET') { try { return json(200, u.pathname === '/api/auto/runs' ? A.runs({ id: g('id'), result: g('result'), limit: g('limit') }) : u.pathname === '/api/auto/export' ? A.exportJ(g('id')) : A.status()) } catch (e) { return json(500, { res: RED(e.message) }) } }
      const ok = q.method === 'POST' && u.pathname === '/api/auto';
      if (!ok) { r.writeHead(403); return r.end() }
      let b = ''; q.on('data', c => { if ((b += c).length > 64e3) q.destroy() }).on('end', () => { let o; try { o = A.post(JSON.parse(b)) } catch (e) { o = { res: 'bad request: ' + RED(e.message) } } json(o.res === 'ok' ? 200 : 400, o) }) }
    else if (q.url === '/api/settings') { // M4e: server copy of the Settings export ({version:1, settings}) in <data>/settings.json; same guards as /api/sys, body ≤ 64 KB
      const SF = path.join(require('./accounts.js').dir(), 'settings.json'), // Phase 14: per account
      json = (c, o) => { r.writeHead(c, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(typeof o === 'string' ? o : JSON.stringify(o)) };
      if (q.method === 'GET') { let t; try { t = fs.readFileSync(SF, 'utf8') } catch { t = '{"version":1,"settings":null}' } return json(200, t) }
      if (q.method !== 'POST') { r.writeHead(405); return r.end() }
      let b = ''; q.on('data', c => { if ((b += c).length > 64e3) q.destroy() }).on('end', () => { let o; try { o = JSON.parse(b) } catch { return json(400, { res: 'bad request' }) }
        if (o?.version !== 1 || !o.settings || typeof o.settings !== 'object' || Array.isArray(o.settings)) return json(400, { res: 'bad request: not a NEXUS settings file (version 1)' });
        try { writeF(SF, b); json(200, { res: 'ok' }) } catch (e) { json(500, { res: RED(e.message) }) } }) }
    else if (/^\/api\/sys(\/hist|\/procs)?(\?|$)/.test(q.url)) { // System Health page (sys.js): GET status / history / processes; POST same guards as /api/auto, body ≤ 4 KB
      const Y = require('./sys.js'), u = new URL(q.url, 'http://x'), json = (c, o) => { r.writeHead(c, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify(o)) };
      if (q.method === 'GET') { try { if (u.pathname === '/api/sys/hist') return json(200, Y.hist(+u.searchParams.get('since') || 0)); if (u.pathname === '/api/sys/procs') return json(200, Y.procs()); return Y.status(o => json(200, o)) } catch (e) { return json(500, { res: RED(e.message) }) } }
      const ok = q.method === 'POST' && u.pathname === '/api/sys';
      if (!ok) { r.writeHead(403); return r.end() }
      let b = ''; q.on('data', c => { if ((b += c).length > 4e3) q.destroy() }).on('end', () => { let o; try { o = JSON.parse(b) } catch { return json(400, { res: 'bad request' }) } try { Y.post(o, x => json(x.res === 'ok' ? 200 : 400, x)) } catch (e) { json(400, { res: 'bad request: ' + RED(e.message) }) } }) }
    else if (q.url === '/api/voice' || q.url === '/api/voice/events') { // NEXUS voice input (voice.js, post-M7 Ph 3): GET events = NDJSON stream; POST {op:start|stop}, body ≤ 200 B
      const V = require('./voice.js');
      if (q.method === 'GET' && q.url === '/api/voice/events') return V.events(q, r);
      if (q.method !== 'POST' || q.url !== '/api/voice') { r.writeHead(405); return r.end() }
      let b = ''; q.on('data', c => { if ((b += c).length > 200) q.destroy() }).on('end', () => { let x; try { x = V.post(JSON.parse(b)) } catch { x = { res: 'bad request' } } r.writeHead(x.res === 'ok' ? 200 : 400, { 'content-type': 'application/json' }); r.end(JSON.stringify(x)) }) }
    else if (q.url === '/api/accounts') { // NEXUS accounts (accounts.js, post-M7 Ph 14): GET status; POST {op: google|cancel|local|switch|signout|remove}, body ≤ 300 KB (ui = page storage)
      const ACC = require('./accounts.js'), json = (c, o) => { r.writeHead(c, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify(o)) };
      if (q.method === 'GET') return json(200, ACC.status());
      if (q.method !== 'POST') { r.writeHead(405); return r.end() }
      let b = ''; q.on('data', c => { if ((b += c).length > 3e5) q.destroy() }).on('end', () => { let o; try { o = JSON.parse(b) } catch { return json(400, { res: 'bad request' }) }
        ACC.handle(o || {}).then(x => json(x.res === 'ok' || x.res === 'signin' ? 200 : 400, x), e => json(500, { res: RED(e.message) })) }) }
    else if (/^\/api\/watch(\?|$)/.test(q.url)) { // live Claude Code sessions + subscription limits (watch.js): GET ?after=<event id>; POST {op:'probe'} = user-pressed limits check (one tiny Haiku call)
      const W = require('./watch.js'), json = (c, o) => { r.writeHead(c, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify(o)) };
      if (q.method === 'GET') { try { return json(200, W.status(+new URL(q.url, 'http://x').searchParams.get('after') || 0)) } catch (e) { return json(500, { res: RED(e.message) }) } }
      if (q.method !== 'POST') { r.writeHead(405); return r.end() }
      let b = ''; q.on('data', c => { if ((b += c).length > 1000) q.destroy() }).on('end', () => { let o; try { o = JSON.parse(b) } catch { return json(400, { res: 'bad json' }) }
        if (o?.op !== 'probe') return json(400, { res: 'unknown op' }); W.probe(require('./assist.js')._.bin()).then(x => json(x.res === 'ok' ? 200 : 502, x)) }) }
    else if (/^\/api\/assist(\/(convs|conv|stream|status))?(\?|$)/.test(q.url)) { // NEXUS Assistant (assist.js, post-M7 Ph 2): GET status / convs (?q= search) / conv?id=; POST /api/assist/stream = one streamed run; POST /api/assist = cancel / attach (≤ 7 MB) / rename / delete
      const X = require('./assist.js'), u = new URL(q.url, 'http://x'), json = (c, o) => { r.writeHead(c, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify(o)) };
      if (q.method === 'GET') { if (u.pathname === '/api/assist/status') return json(200, X.status()); if (u.pathname === '/api/assist/convs') return json(200, X.search(u.searchParams.get('q'))); if (u.pathname === '/api/assist/conv') { const c = X.one(u.searchParams.get('id')); return json(c ? 200 : 404, c || { res: 'not found' }) } r.writeHead(405); return r.end() }
      if (q.method !== 'POST' || !['/api/assist', '/api/assist/stream'].includes(u.pathname)) { r.writeHead(405); return r.end() }
      const cap = u.pathname === '/api/assist' ? 7.2e6 : 2e4; let b = ''; q.on('data', c => { if ((b += c).length > cap) q.destroy() }).on('end', () => { let o; try { o = JSON.parse(b) } catch { return json(400, { res: 'bad request' }) }
        if (u.pathname === '/api/assist/stream') return X.send(o, r); try { const x = X.post(o); json(x.res === 'ok' ? 200 : 400, x) } catch (e) { json(500, { res: RED(e.message) }) } }) }
    else if (q.url.startsWith('/api/cc/')) { // Claude Code page (cc.js): GET only, read-only (tree / file / git / live). Launches go through POST /api/projects.
      const C = require('./cc.js'), u = new URL(q.url, 'http://x'), g = k => u.searchParams.get(k), json = (c, o) => { r.writeHead(c, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify(o)) };
      if (q.method !== 'GET') { r.writeHead(405); return r.end() }
      const op = { '/api/cc/tree': () => C.tree(g('id'), g('dir') || ''), '/api/cc/file': () => C.file(g('id'), g('f')), '/api/cc/git': () => C.git(g('id')), '/api/cc/live': () => C.live(g('id'), g('sid')) }[u.pathname];
      if (!op) { r.writeHead(404); return r.end() }
      Promise.resolve().then(op).then(o => json(o.code || 200, o), e => json(500, { res: RED(e.message) })) }
    else if (q.url === '/api/plugin' || q.url === '/api/catalog') { // plugin/skill actions (pluginops.js, one-time confirm token) and My Catalog (catalog.js): same guards as /api/act
      const ops = require(q.url === '/api/plugin' ? './pluginops.js' : './catalog.js'), json = (c, o) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)) };
      if (q.method === 'GET') return json(200, ops.status());
      const ok = q.method === 'POST';
      if (!ok) { r.writeHead(403); return r.end() }
      let b = ''; q.on('data', c => { if ((b += c).length > 1e3) q.destroy() }).on('end', () => { Promise.resolve().then(() => ops.post(JSON.parse(b))).catch(() => ({ res: 'bad request' })).then(o => json(o.res === 'ok' ? 200 : 400, o)) }) }
    else if (q.url.startsWith('/preview/')) app(q.url.slice(8), r)
    else { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync(q.url.split('?')[0] === '/preview' ? F('app/index.html') : F('dashboard.html'))) } // /preview = M4 JARVIS preview (old blue one: preview.html, unused)
  });
  // P3 (port.js): PORT first; when another program holds it, the per-user fallback. This folder's tracker already running anywhere (proved, busy,
  // rate-limited, old, or its serve.json PID alive) means no second one: exit as before. The bound port goes to port.txt (removed on PORT).
  const next = [PT.hint(F('port.txt')), ...Array.from({ length: 10 }, (_, i) => PT.seed() + i)].filter((p, i, a) => p && p !== PORT && a.indexOf(p) === i);
  const alive = () => { const p = readJ(F('serve.json'), {}).pid; try { return !!p && p !== process.pid && process.kill(p, 0) } catch (e) { return e.code === 'EPERM' } }; // ponytail: a reused PID blocks the fallback (fails safe: no duplicate)
  const stop = m => { glog('serve not started: ' + m); process.exit(0) };
  srv.on('error', async e => {
    if (e.code !== 'EADDRINUSE') return stop(e.code || RED(e.message));
    let s = await PT.probe(F('launch.key'), port);
    if (s === 'bad') { await new Promise(r => setTimeout(r, 500)); s = alive() ? 'running' : await PT.probe(F('launch.key'), port) } // a tracker that just bound may not have published launch.key yet
    if (s !== 'bad' && s !== 'refused') return stop('port ' + port + ' already in use (this NEXUS tracker: ' + s + '); launch.key left as it was');
    const p = next.shift(); if (!p) return stop('port ' + PORT + ' and the per-user fallback ports are all used by other programs');
    glog('serve: port ' + port + ' is used by another program, trying ' + p); port = p; srv.listen(port, '127.0.0.1');
  }).on('listening', () => { port = srv.address().port; AUTH = require('./launch.js')(F('launch.key'), port, true); const g = REC.started(MANUAL); for (const n of g.notes) { glog('serve: ' + n); fixLog('Tracker: ' + n) } if (!g.ok) process.exit(0); AUTH.publish();
    if (port === PORT) { try { fs.unlinkSync(F('port.txt')) } catch { } } else require('./launch.js').writeKey(F('port.txt'), JSON.stringify({ port, pid: process.pid, at: Date.now() })) });
  const h = PT.hint(F('port.txt')); (h && h !== PORT ? PT.probe(F('launch.key'), h) : Promise.resolve('bad')).then(s => s === 'bad' || s === 'refused' ? srv.listen(PORT, '127.0.0.1', () => { tick(); setInterval(tick, 30000); require('./auto.js').init({ log: m => { fixLog(m); st.autoLog.length = Math.min(st.autoLog.length, 100) }, analyze: () => tick(true), rep: () => rep, K: require('./knowledge.js'), P: require('./projects.js') }); require('./sys.js').init({ rep: () => rep, tasks, K: require('./knowledge.js'), A: require('./auto.js'), resp: F('responses.json'), graph: path.join(process.env.NEXUS_PROJ || path.join(os.homedir(), 'Desktop', 'my-game'), 'graphify-out', 'graph.json') }); fs.watchFile(F('responses.json'), { interval: 2000 }, () => tick()) }) : stop('this NEXUS tracker already runs on port ' + h + ' (' + s + ')'));
} else if (mode === 'boot') {
  const PT = require('./port.js'), ps = [...new Set([PT.hint(F('port.txt')), PORT].filter(Boolean))]; // P3: port.txt hint first, then PORT
  Promise.all(ps.map(p => PT.probe(F('launch.key'), p, 400))).then(st => { if (st.every(s => s === 'refused' || s === 'bad') && !require('./recover.js')(DIR).lock()?.valid) cp.spawn(process.execPath, [__filename, 'serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); done() }); // M5b 1b: never a second tracker: busy / rate / old / ours = running; only nothing or another program (serve then falls back) starts one
  let inp = '', got = 0; const rec = () => { if (got++) return; process.stdin.destroy(); try { const j = JSON.parse(inp); if (j.session_id) life(j.session_id, 'starts', j.source || 'startup') } catch { } };
  if (process.stdin.isTTY) rec(); else { process.stdin.on('data', c => inp += c).on('end', rec).on('error', rec); setTimeout(rec, 300).unref() } // unref: exit as soon as stdin ends, don't idle 300 ms
  function done() { try { process.stdout.write(fs.readFileSync(F('tips.txt'), 'utf8')) } catch { } }
} else if (mode === 'open') { // M4b: start.cmd / shortcut. Boots the server if needed, swaps launch.key for a one-time link, opens it (--print: print it instead)
  let spawned = false, busy = false, last = '';
  const LK = require('./recover.js')(DIR).lock(); if (LK?.valid) { console.error('NEXUS is being updated (' + LK.why + '): try again in a few minutes.'); process.exit(1) } // P2a
  const MSG = { old: 'The program on port ' + PORT + ' has no /api/prove (NEXUS tracker older than this start.cmd?): update it. The NEXUS key was not sent.', bad: 'The program on port ' + PORT + ' could not prove it is your NEXUS tracker, so the NEXUS key was not sent.', rate: 'NEXUS is running but busy (too many requests on port ' + PORT + '): try again in a few seconds. The NEXUS key was not sent.' };
  const again = (n, why) => { last = why; n < 20 ? setTimeout(go, 250, n + 1) : (console.error(MSG[last] || (busy ? 'NEXUS is running but did not answer (busy): try again in a minute, or see guard.log' : last === 'refused' ? 'NEXUS refused the launch: see guard.log' : 'NEXUS did not start')), process.exit(1)) };
  const PT = require('./port.js'), req = (n, o, body, then) => { const q = http.request({ host: '127.0.0.1', timeout: 2000, ...o }, r => { let b = ''; r.on('data', c => b += c).on('end', () => then(r.statusCode, b)) });
    q.on('error', () => again(n, '')).on('timeout', function () { this.destroy() }).end(body) };
  const go = (n = 0) => { const ps = [...new Set([PT.hint(F('port.txt')), PORT].filter(Boolean))]; // P3: port.txt hint first, then PORT; B61: the key goes only to a listener that proves it holds it (port.js probe)
    Promise.all(ps.map(p => PT.probe(F('launch.key'), p))).then(st => { const i = st.indexOf('ours'), port = ps[i]; let key = ''; try { key = fs.readFileSync(F('launch.key'), 'utf8').trim() } catch { }
      if (i < 0) { // M5b 1b: start a tracker once, only when nothing of ours answers (nothing listens, or another program: serve falls back); busy / rate / old = running, never a second one. P2a: start.cmd is a user start, so --manual
        if (st.includes('busy')) busy = true;
        else if (!spawned && st.every(s => s === 'refused' || s === 'bad')) { spawned = true; cp.spawn(process.execPath, [__filename, 'serve', '--manual'], { detached: true, stdio: 'ignore', windowsHide: true }).unref() }
        return again(n, ['rate', 'old', 'bad'].find(s => st.includes(s)) || '') } // B63: 429 = rate-limited tracker, retried, never an identity failure
      req(n, { port, path: '/api/launch', method: 'POST', headers: { origin: 'http://127.0.0.1:' + port, 'content-type': 'application/json', 'x-nexus-token': key } }, '{}', (c, b) => {
        if (c !== 200) return again(n, 'refused');
        const url = `http://127.0.0.1:${port}/launch?c=${JSON.parse(b).code}`;
        if (process.argv.includes('--print')) console.log(url); else cp.spawn('explorer.exe', [url], { stdio: 'ignore', detached: true }).unref() }) });
  };
  go();
} else if (mode === 'snap') { // PreCompact + SessionEnd hooks
  let inp = ''; process.stdin.on('data', c => inp += c).on('end', () => { try { const j = JSON.parse(inp); if (j.hook_event_name === 'SessionEnd' && j.session_id) life(j.session_id, 'ended', j.reason || 'other'); snap(j) } catch { } });
} else if (mode === 'hook') { // UserPromptSubmit: prints only when there is something to say, otherwise 0 tokens
  let inp = ''; process.stdin.on('data', c => inp += c).on('end', () => {
    try {
      const sid = JSON.parse(inp).session_id, A = readJ(F('advice.json'), {}), a = (A.sessions || {})[sid], now = Date.now();
      if (!a || now - A.at > 5 * 6e4) return;
      const R = readJ(F('responses.json'), { log: [] }), r = R[sid] || {};
      if ((R.starts?.[sid]?.[0] || 0) > A.at) return; // compacted/cleared since this advice was computed
      const save = a.save == null ? 'Not enough data' : '~$' + a.save.toFixed(2) + ' ' + a.unit + ' (estimate, ' + a.conf + ' confidence)';
      let msg = '';
      if (require('./savings.js').shouldWarn(a, r)) {
        msg = `CONTEXT ADVISOR (local, no AI): ${a.label} (${a.cmd}). Why: ${a.why}. Est. savings: ${save}.
` +
          `Finish the user's current request first (never interrupt a task). Then end your reply with ONE line, no question, no AskUserQuestion: "⚠ Context Advisor: ${a.label}. ${a.plain} Type ${a.cmd} when ready; key context auto-saves to Obsidian first." Never compact or clear yourself. If the user says "save handoff", also write a full handoff via the project's docs workflow and verify it.`;
        R[sid] = { ...r, notifiedAt: now, warnCtx: a.ctx, warnAct: a.action }; logAct(R, sid, a.label, 'warned in chat');
      }
      const N = readJ(F('notices.json'), []).filter(([t]) => t > (R.skillSeen || 0));
      if (N.length) { msg += (msg ? '\n' : '') + 'SKILL ADVISOR (local): ' + N.map(n => n[1]).join(' | ') + '\nMention this briefly to the user after finishing the current request. Never remove, disable or modify any skill/plugin/hook without explicit approval.'; R.skillSeen = now }
      if (msg) { writeF(F('responses.json'), JSON.stringify(R)); process.stdout.write(msg + '\n') }
    } catch { }
  });
} else if (mode === 'dedup') { // one-time correction of totals counted before st.rids existed. Dry run unless --apply.
  if (st.dedupAt) { console.log(`Already corrected on ${new Date(st.dedupAt).toLocaleString('sv')}; running it again would subtract twice.`); process.exit(0) }
  const apply = process.argv[3] === '--apply', now = Date.now(), day = t => new Date(t).toLocaleDateString('sv'), seen = {}, prev = {}, fix = {};
  const g = () => Object.values(st.sessions).reduce((a, S) => (tot(S.models).forEach((x, i) => a[i] += x), a), [0, 0, 0, 0]);
  const w5 = () => { let ws = 0; for (const r of [...st.recent].sort((a, b) => a[0] - b[0])) if (!ws || r[0] >= ws + H5) ws = r[0];
    return ws && now < ws + H5 ? st.recent.filter(r => r[0] >= ws).reduce((a, r) => (a.forEach((_, i) => a[i] += r[i + 1]), a), [0, 0, 0, 0]) : [0, 0, 0, 0] };
  const G0 = g(), W0 = w5(), D0 = JSON.parse(JSON.stringify(st.days)), M0 = Object.fromEntries(Object.entries(st.sessions).map(([k, S]) => [k, sum(tot(S.models))]));
  for (const f of walk(LOGS).sort((a, b) => born(a) - born(b))) eachLine(f, 0, st.files[f]?.off || 0, l => { // only lines already counted; the scanner indexes the rest
    if (!l.includes('"usage"')) return; let j; try { j = JSON.parse(l) } catch { return }
    const u = j.message?.usage; if (j.type !== 'assistant' || !u || !j.requestId || !j.sessionId) return;
    const v = U(u); if (v.every(x => !x)) return;
    const rid = j.requestId, sid = j.sessionId, own = seen[rid] ??= sid, k = sid + rid, o = prev[k], d = v.map((x, i) => x - (o ? o[i] : 0)); prev[k] = v;
    if (own === sid || !st.sessions[sid]) return;
    const x = fix[sid] ??= { n: new Set(), lines: [] }; x.n.add(rid); if (d.some(Boolean)) x.lines.push([Date.parse(j.timestamp) || 0, j.message.model || '?', d]);
  });
  for (const [sid, x] of Object.entries(fix)) { const S = st.sessions[sid]; S.n -= x.n.size;
    for (const [ts, md, d] of x.lines) { const neg = d.map(y => -y); add(S.models, md, neg); if (ts) add(st.days[day(ts)] ??= {}, md, neg);
      const i = ts > now - DAY ? st.recent.findIndex(r => r[0] === ts && d.every((y, n) => r[n + 1] === y)) : -1; if (i >= 0) st.recent.splice(i, 1) }
    S.from = {}; for (const r of x.n) S.from[seen[r]] = 1 }
  st.rids = {}; for (const r in seen) st.rids[RK(r)] = six(seen[r]);
  const G1 = g(), W1 = w5(), f4 = a => a.map(k1).join(' / ') + ' = ' + k1(sum(a));
  console.log(`${apply ? 'APPLIED' : 'DRY RUN (nothing written)'} · ${Object.keys(seen).length} requests indexed · ${Object.values(fix).reduce((a, x) => a + x.n.size, 0)} copies in ${Object.keys(fix).length} sessions\n\nPer session (tokens before → after, copied requests):`);
  for (const [sid, x] of Object.entries(fix)) { const S = st.sessions[sid]; console.log(`  ${sid.slice(0, 8)} ${S.project.padEnd(14)} ${M0[sid]} → ${sum(tot(S.models))} (−${M0[sid] - sum(tot(S.models))}) · ${x.n.size} copies from ${Object.keys(S.from).map(s => s.slice(0, 8)).join(', ')}`) }
  console.log('\nPer day (total before → after):'); for (const d of Object.keys(st.days).sort()) { const a = sum(tot(D0[d] || {})), b = sum(tot(st.days[d])); if (a !== b) console.log(`  ${d}  ${a} → ${b} (−${a - b})`) }
  console.log(`\nGlobal (input / output / cache write / cache read):\n  before ${f4(G0)}\n  after  ${f4(G1)}\n  removed ${G0[0] + G0[1] + G0[2] + G0[3] - sum(G1)}\n5-hour window: before ${f4(W0)} · after ${f4(W1)}`);
  if (apply) { if (!fs.existsSync(F('state.pre-dedup-2026-10-14.json'))) throw Error('backup missing'); st.dedupAt = now; writeF(F('state.json'), JSON.stringify(st)) }
} else if (mode === 'act') { tick(); console.log(act(JSON.parse(process.argv[3] || '{}')))
} else if (mode === 'audit') { // force a verification run and print it (testing)
  tick(true); const a = rep.audit || {}; console.log(rep.error || '', JSON.stringify(a.counts), '\n' + (a.checks || []).map(c => `[${c.status}] ${c.name}: ${c.detail}`).join('\n'), '\nsavings', a.savings, '\nauto', (st.autoLog || []).slice(0, 5));
} else {
  const t = Date.now(); tick(); const r = rep;
  console.log(r.error || '', `scan ${Date.now() - t}ms; sessions ${Object.keys(st.sessions).length}; days ${r.days.length}; window`, r.window, '\nissues', r.issues.slice(0, 5), '\ntips', r.tips, '\nopts', r.opts, '\nrecs', r.recs);
}
