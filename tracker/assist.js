// NEXUS Assistant backend (post-M7 Phases 2/7/8/9/10): chat with Claude Code through the local `claude -p` CLI, so it runs on the
// user's own Claude Code login (subscription); no API key is read or stored here. One run at a time, streamed to the page as NDJSON.
// Permission levels (Phase 10): read (Read/Grep/Glob only, default), plan (same tools, plan mode: proposes, never changes files),
// edit (adds Edit/Write in the chosen project; the page asks first). Never Bash, never MCP servers (--strict-mcp-config), hooks off.
// Conversations: <tracker>/assist/convs.json (text + tool names only; no audio, no attachments' contents). Attachments: assist/att/.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), RED = require('./redact.js'), B = require('./brain.js'), W = require('./watch.js');
const DIR = __dirname, ACC = require('./accounts.js'), AD = () => path.join(ACC.dir(), 'assist'), CF = (d = AD()) => path.join(d, 'convs.json'), ATT = (d = AD()) => path.join(d, 'att'); // Phase 14: per-account folder (accounts.js)
// long-term memory vault: NEXUS_VAULT, else the first Obsidian vault (obsidian.json) with a MEMORY.md at its root, else none (no path is hard-coded: it would ship)
const VAULT = process.env.NEXUS_VAULT || Object.values(readJ0(path.join(process.env.APPDATA || '', 'obsidian', 'obsidian.json')).vaults || {}).map(v => v && v.path).find(p => p && fs.existsSync(path.join(p, 'MEMORY.md'))) || null;
function readJ0(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return {} } }
const MAXC = 200, MAXM = 200, MAXT = 8000, MAXATT = 5 * 1048576, TIMEOUT = 10 * 60e3;
let BIN = process.env.NEXUS_CLAUDE || path.join(os.homedir(), '.local', 'bin', 'claude.exe');
const TOOLS = { read: 'Read,Grep,Glob', plan: 'Read,Grep,Glob', edit: 'Read,Grep,Glob,Edit,Write' };
const MODELS = ['haiku', 'sonnet', 'opus'];
let run = null; // { id, child, conv, killed }

const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
const writeJ = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o)); fs.renameSync(f + '.tmp', f) };
const convs = d => readJ(CF(d), []);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const projects = () => (readJ(path.join(DIR, 'projects.json'), {}).items || []).filter(p => p && p.id && p.dir);

// Phase 9 model routing: cheapest model that fits the request; the user's pick always wins. Returns { model, why }.
// Phase 5 (controlled self-improvement): replies the user rated feed one learned rule. When quick-question answers from Haiku get
// 3+ thumbs-down and at least half of the last 20 ratings for that route, auto routing sends quick questions to Sonnet instead.
// Shown in the panel (Settings → What NEXUS learned) and undone with one click (op resetLearn). Nothing else changes by itself.
const LF = () => path.join(AD(), 'learn.json'), MF = () => path.join(AD(), 'memory.json'), TF = () => path.join(AD(), 'tasks.json');
const learned = () => { const r = (readJ(LF(), {}).rates || []).filter(x => x.k === 'haiku|quick question').slice(-20), down = r.filter(x => x.v < 0).length; return { upQuick: down >= 3 && down * 2 >= r.length, rated: r.length, down } };
const mem = () => readJ(MF(), []), tasks = () => readJ(TF(), []);
function route(text, pick, rnd) {
  if (MODELS.includes(pick)) return { model: pick, why: 'chosen by you' };
  const t = String(text || '');
  const c = /\b(architect(ure)?|redesign|security (review|audit)|audit|refactor|deep (dive|analysis)|root cause|complex|migrat)/i.test(t) ? 'complex reasoning'
    : t.length < 200 && !/```|\bcode\b|\bbug|\berror|\bfix\b|\bimplement|\bwrite\b|\bplan\b|\bscript|\bfunction/i.test(t) ? 'quick question' : 'development task';
  const rule = B.routeRule(readJ(LF(), {}), c, rnd); if (rule) return rule; // Phase 5: approved experiment / validated rule
  if (c === 'complex reasoning') return { model: 'opus', why: c };
  if (c === 'quick question') return learned().upQuick ? { model: 'sonnet', why: 'quick question (learned: Haiku answers were rated poorly)' } : { model: 'haiku', why: c };
  return { model: 'sonnet', why: c };
}

function sys(p, text) {
  const notes = text ? B.recall(text, [VAULT, p?.dir].filter(Boolean)) : [], gh = text && p ? B.graphHits(text, p.dir) : []; // Phase 8: only the notes that match
  return ['You are the NEXUS assistant, built into the NEXUS desktop app (Windows). Answer in short plain language a beginner understands; offer detail only when asked.',
    `Today is ${new Date().toISOString().slice(0, 10)}.`, p ? `Active project: ${p.name} (${p.dir}).` : 'No project selected.',
    'Known projects: ' + projects().slice(0, 30).map(x => x.name).join(', ') + '.',
    (VAULT ? `Long-term memory: ${path.join(VAULT, 'MEMORY.md')} (read it for progress, decisions and open tasks). ` : '') + 'Project notes may also be in PROJECT_MEMORY.md / NEXT_CHAT.md in the project folder.',
    'You cannot run shell commands. If a request needs one, say which command and why, and let the user run it.',
    'Never reveal secrets, tokens or file contents that look like credentials.', p ? kind(p) : '', p ? B.brief(B.scan(p)) : '',
    notes.length ? 'Notes that match this request (read these first instead of whole folders; outdated = check before trusting):\n' + notes.map(n => `- ${n.f}${n.status ? ' [' + n.status + ']' : ''}`).join('\n') : '',
    gh.length ? 'Graphify graph matches: ' + gh.map(g => `${g.label} (${g.file})`).join('; ') : '',
    mem().some(m => !m.p || m.p === p?.id) ? 'Things the user asked you to remember:\n' + mem().filter(m => !m.p || m.p === p?.id).map(m => '- ' + m.x).join('\n') : '',
    tasks().some(t => !t.done) ? 'Open NEXUS tasks:\n' + tasks().filter(t => !t.done).slice(0, 10).map(t => '- ' + t.title).join('\n') : ''].filter(Boolean).join('\n');
}

// Phase 6: Roblox / Blender projects get domain guidance (Luau, Studio, mobile performance, Blender export) from the folder contents.
function kind(p) {
  let n = []; try { n = fs.readdirSync(p.dir).slice(0, 400) } catch { return '' }
  const rb = n.some(x => /\.(rbxlx?|rbxmx?)$|^default\.project\.json$|^(selene|stylua|wally)\.toml$/i.test(x)), bl = n.some(x => /\.blend$/i.test(x));
  return [rb && 'This is a Roblox project: give Luau-correct answers (strict typing, server authority for RemoteEvents, DataStore safety, mobile performance: draw calls, part count, texture memory). The user works in Roblox Studio and has roblox-dev skills installed; name the right one when it helps.',
    bl && 'This project has Blender files: for 3D work mention scale and units for Roblox export, triangle budgets, UV/texture size and FBX export settings.'].filter(Boolean).join('\n');
}

function args(o, m) {
  const a = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', m, '--tools', TOOLS[o.mode], '--strict-mcp-config',
    '--settings', JSON.stringify({ disableAllHooks: true }), '--append-system-prompt', sys(o.p, o.text), ...(VAULT ? ['--add-dir', VAULT] : []), '--add-dir', ATT()];
  if (o.mode === 'plan') a.push('--permission-mode', 'plan');
  else if (o.mode === 'edit') a.push('--permission-mode', 'acceptEdits');
  if (o.sid) a.push('--resume', o.sid);
  return a;
}

// POST {op:'send', text, conv?, project?, model?: auto|haiku|sonnet|opus, mode?: read|plan|edit, att?: [names]} → NDJSON stream:
// {t:'start', id, conv, model, why} {t:'text', d} {t:'tool', name, info} {t:'done', ms, cost, usage} {t:'error', msg} {t:'cancelled'}
function send(o, r) {
  const out = x => { try { r.write(JSON.stringify(x) + '\n') } catch { } };
  const text = typeof o.text === 'string' ? o.text.trim().slice(0, MAXT) : '';
  if (!text) return end(r, 400, { t: 'error', msg: 'Type a message first.' });
  if (run) return end(r, 409, { t: 'error', msg: 'NEXUS is still answering. Wait for it, or press Stop.' });
  const mode = TOOLS[o.mode] ? o.mode : 'read';
  const ad = AD(), all = convs(ad); let c = all.find(x => x.id === o.conv); // ad: the account at start owns this answer, even after a switch
  if (!c) { c = { id: uid(), title: text.slice(0, 60), project: null, sid: null, msgs: [], at: Date.now() }; all.unshift(c) }
  const p = (o.project && projects().find(x => x.id === o.project)) || (c.project && projects().find(x => x.id === c.project)) || null;
  if (p) c.project = p.id;
  if (mode === 'edit' && !p) return end(r, 400, { t: 'error', msg: 'Pick a project first: Edit files only works inside a project folder.' }); // review 2026-10-29: never acceptEdits in the home folder
  const att = (Array.isArray(o.att) ? o.att : []).filter(n => typeof n === 'string' && /^[\w.-]{1,80}$/.test(n) && fs.existsSync(path.join(ATT(ad), n))).slice(0, 5);
  const { model, why, exp } = route(text, o.model);
  if (!o.fresh && !att.length) { const h = cached(all, text, p, mode); if (h) return replay(r, c, all, ad, text, h, out) }
  const prompt = text + (att.length ? '\n\nAttached files (read them):\n' + att.map(n => path.join(ATT(ad), n)).join('\n') : '');
  let cwd = p ? p.dir : os.homedir(); try { if (!fs.statSync(cwd).isDirectory()) cwd = os.homedir() } catch { cwd = os.homedir() }
  let child; try { child = cp.spawn(BIN, args({ mode, p, sid: c.sid, text }, model), { cwd, env: W.env(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }) }
  catch (e) { return end(r, 500, { t: 'error', msg: 'Claude Code could not start: ' + RED(e.message) }) }
  const id = uid(), t0 = Date.now(); run = { id, child, conv: c.id, killed: false };
  r.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  out({ t: 'start', id, conv: c.id, model, why, mode, project: p ? p.name : null });
  let buf = '', reply = '', tools = [], err = '', res = null;
  const timer = setTimeout(() => stop(id, 'timeout'), TIMEOUT);
  child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); line(l) } });
  child.stderr.on('data', d => { err = (err + d).slice(-2000) });
  function line(l) {
    let j; try { j = JSON.parse(l) } catch { return }
    if (j.type === 'stream_event' && j.event?.type === 'content_block_delta' && j.event.delta?.type === 'text_delta') { reply += j.event.delta.text; out({ t: 'text', d: j.event.delta.text }) }
    else if (j.type === 'assistant') { for (const b of j.message?.content || []) if (b.type === 'tool_use') { const info = RED(String(b.input?.file_path || b.input?.pattern || b.input?.path || '').replace(os.homedir(), '~')).slice(0, 120); tools.push(b.name); out({ t: 'tool', name: b.name, info }) } }
    else if (j.type === 'result') res = j;
    else if (j.type === 'rate_limit_event') W.record(j.rate_limit_info);
  }
  child.stdin.on('error', () => { }); child.stdin.end(prompt);
  child.on('error', e => { err = e.message });
  child.on('close', code => {
    if (buf.trim()) line(buf); buf = '';
    clearTimeout(timer); const k = run?.killed; run = null;
    const ok = res && !res.is_error && !k;
    const now = Date.now(), all2 = convs(ad), c2 = all2.find(x => x.id === c.id) || (all2.unshift(c), c);
    c2.msgs.push({ r: 'u', x: text, at: t0, att }, { r: 'a', x: reply || (res?.result ?? ''), at: now, model, route: why, exp, tools: [...new Set(tools)], ok: !!ok, why: k || (ok ? undefined : 'error'), cost: res?.total_cost_usd ?? undefined, mode, project: c.project });
    c2.msgs = c2.msgs.slice(-MAXM); if (res?.session_id) c2.sid = res.session_id; c2.project = c.project; c2.at = now;
    writeJ(CF(ad), all2.sort((a, b) => b.at - a.at).slice(0, MAXC));
    if (k) out({ t: 'cancelled', why: k });
    else if (ok) out({ t: 'done', i: c2.msgs.length - 1, ms: now - t0, cost: res.total_cost_usd ?? null, usage: res.usage ? { in: res.usage.input_tokens, out: res.usage.output_tokens, cacheRead: res.usage.cache_read_input_tokens } : null });
    else out({ t: 'error', msg: explain(res?.result || err, code) });
    r.end();
  });
  r.on('close', () => { if (!r.writableFinished && run?.id === id) stop(id, 'page closed') });
}

// Phase 9 duplicate-work prevention: the same question (same project and access) answered well in the last 30 min is replayed
// with no new Claude call; the reply says so and "Ask again" sends it fresh.
function cached(all, text, p, mode) {
  const n = x => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim(), t = n(text), since = Date.now() - 30 * 60e3;
  for (const c of all) { if (c.at < since) continue; for (let i = c.msgs.length - 1; i > 0; i--) { const a = c.msgs[i], u = c.msgs[i - 1];
    if (a.r === 'a' && u.r === 'u' && a.at >= since && a.ok && !a.cached && !(a.v < 0) && !u.att?.length && (a.project || null) === (p?.id || null) && (a.mode || 'read') === mode && n(u.x) === t) return a } }
  return null;
}
function replay(r, c, all, ad, text, h, out) {
  const now = Date.now(), why = `same question ${Math.max(1, Math.round((now - h.at) / 60e3))} min ago: earlier answer reused, no new Claude call`;
  r.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  out({ t: 'start', id: uid(), conv: c.id, model: h.model, why, mode: h.mode || 'read', project: null, cached: true }); out({ t: 'text', d: h.x });
  c.msgs.push({ r: 'u', x: text, at: now, att: [] }, { r: 'a', x: h.x, at: now, model: h.model, route: why, tools: [], ok: true, cached: true, cost: 0, mode: h.mode, project: h.project });
  c.msgs = c.msgs.slice(-MAXM); c.at = now; writeJ(CF(ad), all.sort((a, b) => b.at - a.at).slice(0, MAXC));
  out({ t: 'done', i: c.msgs.length - 1, ms: 0, cost: 0, usage: null, cached: true }); r.end();
}

// Plain-language reasons for the common CLI failures (Phase 13 beginner errors).
function explain(m, code) {
  m = RED(String(m || '')).replace(os.homedir(), '~');
  if (/not logged in|login|authenticat|401/i.test(m)) return 'Claude Code is not signed in. To sign in: 1) open PowerShell (Start menu → type PowerShell), 2) type claude and press Enter, 3) type /login and press Enter, 4) finish the sign-in in the browser window that opens, 5) come back here and send your message again.';
  if (/usage limit|rate limit|429|limit reached/i.test(m)) return 'Your Claude usage limit is reached. NEXUS can answer again when it resets.';
  if (/ENOENT/i.test(m)) return 'Claude Code was not found at ' + BIN.replace(os.homedir(), '~') + '. Install or repair Claude Code, then try again.';
  if (/No conversation found|session/i.test(m)) return 'The earlier chat could not be continued. Start a new chat.';
  return 'Claude Code stopped with an error' + (code != null ? ' (code ' + code + ')' : '') + (m ? ': ' + m.slice(0, 300) : '.');
}

function stop(id, why = 'stopped') {
  if (!run || (id && run.id !== id)) return false;
  run.killed = why; const pid = run.child.pid;
  try { cp.execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => { }) } catch { try { run.child.kill() } catch { } }
  return true;
}

function end(r, code, o) { r.writeHead(code, { 'content-type': 'application/x-ndjson' }); r.end(JSON.stringify(o) + '\n') }

// Attachment: {op:'attach', name, b64} → {res:'ok', name}. Text and images up to 5 MB; names are made safe and unique.
function attach(o) {
  const ext = String(o.name || '').toLowerCase().match(/\.(png|jpe?g|webp|gif|txt|md|json|lua|luau|js|ts|css|html|py|csv|log)$/);
  if (!ext) return { res: 'This file type is not supported. Use an image or a text/code file.' };
  let b; try { b = Buffer.from(String(o.b64 || ''), 'base64') } catch { return { res: 'bad request' } }
  if (!b.length || b.length > MAXATT) return { res: 'The file must be under 5 MB.' };
  const n = uid() + '-' + String(o.name).replace(/[^\w.-]/g, '_').replace(/\.{2,}/g, '.').slice(-60);
  fs.mkdirSync(ATT(), { recursive: true }); fs.writeFileSync(path.join(ATT(), n), b);
  return { res: 'ok', name: n };
}

// GET list (no messages) / one conversation / search (titles + message text, case-insensitive).
const list = () => convs().map(c => ({ id: c.id, title: c.title, project: c.project, at: c.at, n: c.msgs.length }));
const one = id => convs().find(c => c.id === id) || null;
function search(q) {
  q = String(q || '').toLowerCase().trim(); if (!q) return list();
  return convs().filter(c => c.title.toLowerCase().includes(q) || c.msgs.some(m => String(m.x).toLowerCase().includes(q))).map(c => ({ id: c.id, title: c.title, project: c.project, at: c.at, n: c.msgs.length }));
}
function post(o) {
  if (o.op === 'cancel') return { res: stop(o.id) ? 'ok' : 'nothing is running' };
  if (o.op === 'attach') return attach(o);
  const txt = (x, n) => String(x || '').replace(/\s+/g, ' ').trim().slice(0, n);
  if (o.op === 'rate') { const all = convs(), c = all.find(x => x.id === o.id), m = c?.msgs[o.i]; if (!m || m.r !== 'a' || ![1, -1, 0].includes(o.v)) return { res: 'bad request' };
    m.v = o.v || undefined; writeJ(CF(), all);
    const L = readJ(LF(), {}); L.rates = [...(L.rates || []).filter(x => !(x.c === o.id && x.i === o.i)), ...(o.v ? [{ c: o.id, i: o.i, v: o.v, k: m.model + '|' + String(m.route || '').replace(/ \(learned.*$/, ''), at: Date.now() }] : [])].slice(-500); B.measure(convs(), L); writeJ(LF(), L); return { res: 'ok', learned: learned() } }
  if (o.op === 'resetLearn') { const L = readJ(LF(), {}); writeJ(LF(), { ...L, rates: [] }); return { res: 'ok' } }
  if (o.op === 'improve') { const L = readJ(LF(), {}), prop = B.analyze(convs(), L).proposals.find(x => x.id === o.id); const res = B.decide(L, o.do, String(o.id || ''), prop, path.join(AD(), 'skills')); writeJ(LF(), L); return { res } }
  if (o.op === 'scan') { const p = projects().find(x => x.id === o.project); return p ? { res: 'ok', scan: B.scan(p) } : { res: 'Pick a project first.' } }
  if (o.op === 'plan' || /^job/.test(o.op)) return job(o);
  if (o.op === 'remember') { const x = txt(o.text, 300); if (!x) return { res: 'Nothing to remember.' }; const m = mem(); if (m.length >= 50) return { res: 'Memory is full (50 notes). Remove one first.' }; const d = B.dup(x, m); if (d) return { res: 'Already remembered: ' + d.x }; m.push({ x, at: Date.now(), ...(projects().some(q => q.id === o.project) ? { p: o.project } : {}) }); writeJ(MF(), m); return { res: 'ok' } }
  if (o.op === 'forget') { const m = mem(); if (!m[o.i]) return { res: 'not found' }; m.splice(o.i, 1); writeJ(MF(), m); return { res: 'ok' } }
  if (o.op === 'task') { const x = txt(o.title, 160); if (!x) return { res: 'A task needs a title.' }; const t = tasks(); if (t.length >= 200) return { res: 'Too many tasks (200). Remove finished ones first.' }; t.unshift({ title: x, conv: typeof o.conv === 'string' ? o.conv : null, done: false, at: Date.now() }); writeJ(TF(), t); return { res: 'ok' } }
  if (o.op === 'taskset' || o.op === 'taskdel') { const t = tasks(); if (!t[o.i]) return { res: 'not found' }; if (o.op === 'taskdel') t.splice(o.i, 1); else t[o.i].done = !!o.done; writeJ(TF(), t); return { res: 'ok' } }
  const all = convs(), i = all.findIndex(c => c.id === o.id);
  if (o.op === 'delete') { if (i < 0) return { res: 'not found' }; all.splice(i, 1); writeJ(CF(), all); return { res: 'ok' } }
  if (o.op === 'rename') { if (i < 0) return { res: 'not found' }; all[i].title = String(o.title || '').trim().slice(0, 80) || all[i].title; writeJ(CF(), all); return { res: 'ok' } }
  return { res: 'bad request' };
}
const status = () => ({ running: run ? { id: run.id, conv: run.conv } : null, bin: fs.existsSync(BIN), projects: projects().map(p => ({ id: p.id, name: p.name })), memory: mem(), tasks: tasks(), learned: learned(), brain: brain(), jobs: jobs().slice(0, 20), plan: jobRun ? jobRun.id : null });
// Phase 7 plans: a plan (from a Plan-mode answer or typed steps) runs step by step through send() in one chat, so each step sees the
// earlier ones (--resume). Runs only when the user presses Run; one plan at a time, never alongside a chat answer. A failed step is
// retried once, then the plan pauses (Run again / Skip / Cancel). Access is the plan's own (read by default; edit only with a project).
// ponytail: no shell, so "run the tests" steps can only read/inspect; a test runner needs the no-shell rule changed (user approval).
const JF = (d = AD()) => path.join(d, 'jobs.json'), jobs = () => readJ(JF(), []), saveJobs = (j, d) => writeJ(JF(d), j.slice(0, 50));
let jobRun = null;
function job(o) {
  const all = jobs(), j = all.find(x => x.id === o.id);
  if (o.op === 'plan') {
    const steps = (Array.isArray(o.steps) ? o.steps : []).map(x => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 600)).filter(Boolean).slice(0, 20);
    const title = String(o.title || '').trim().slice(0, 120) || steps[0]?.slice(0, 60);
    if (!steps.length) return { res: 'A plan needs at least one step.' };
    const mode = TOOLS[o.mode] ? o.mode : 'read', project = projects().some(p => p.id === o.project) ? o.project : null;
    if (mode === 'edit' && !project) return { res: 'Pick a project first: Edit files only works inside a project folder.' };
    if (all.some(x => x.title === title && x.project === project && /queued|running|paused/.test(x.status))) return { res: 'This plan is already waiting or running.' };
    const n = { id: uid(), title, project, mode, conv: typeof o.conv === 'string' ? o.conv : null, status: 'queued', at: Date.now(), steps: steps.map(x => ({ x, st: 'wait', tries: 0 })), log: [] };
    saveJobs([n, ...all]); return { res: 'ok', id: n.id };
  }
  if (!j) return { res: 'not found' };
  if (o.op === 'jobdel') { if (jobRun?.id === j.id) return { res: 'Cancel the plan first.' }; saveJobs(all.filter(x => x !== j)); return { res: 'ok' } }
  if (o.op === 'jobcancel') { if (jobRun?.id === j.id) { jobRun.cancel = true; if (jobRun.run) stop(jobRun.run) } j.status = 'cancelled'; j.log.unshift({ at: Date.now(), x: 'Cancelled by you' }); saveJobs(all); return { res: 'ok' } }
  if (o.op === 'jobskip') { const s = j.steps.find(x => x.st === 'fail'); if (!s || j.status !== 'paused') return { res: 'Nothing to skip.' }; s.st = 'skip'; j.status = 'queued'; saveJobs(all); return { res: 'ok' } }
  if (o.op === 'jobrun') {
    if (jobRun) return { res: 'Another plan is running. Wait for it or cancel it.' };
    if (run) return { res: 'NEXUS is still answering. Wait for it, or press Stop.' };
    if (!/queued|paused|cancelled/.test(j.status)) return { res: 'This plan is already finished.' };
    for (const s of j.steps) if (s.st === 'fail' || s.st === 'run') { s.st = 'wait'; s.tries = 0 }
    j.status = 'running'; saveJobs(all); jobRun = { id: j.id, ad: AD() }; step(j.id); return { res: 'ok' };
  }
  return { res: 'bad request' };
}
function step(id) {
  const ad = jobRun.ad, all = readJ(JF(ad), []), j = all.find(x => x.id === id);
  if (!j || jobRun.cancel || j.status !== 'running') { jobRun = null; return }
  const k = j.steps.findIndex(s => s.st === 'wait');
  if (k < 0) { j.status = 'done'; j.done = Date.now(); j.cost = +j.steps.reduce((s, x) => s + (x.cost || 0), 0).toFixed(4); j.log.unshift({ at: j.done, x: 'Finished' }); saveJobs(all, ad); jobRun = null; return }
  const s = j.steps[k]; s.st = 'run'; s.tries++; s.at = Date.now(); saveJobs(all, ad);
  const text = `Plan "${j.title}", step ${k + 1} of ${j.steps.length}: ${s.x}\nDo only this step. End with one line: "RESULT: ok" or "RESULT: failed - <reason>".`;
  let reply = '', err = '', done = null, conv = j.conv;
  const ev = l => { for (const x of String(l).split('\n')) { let e; try { e = JSON.parse(x) } catch { continue }
    if (e.t === 'start') { jobRun && (jobRun.run = e.id); conv = e.conv } else if (e.t === 'text') reply += e.d; else if (e.t === 'done') done = e; else if (e.t === 'error' || e.t === 'cancelled') err = e.msg || e.why } };
  const r = { writeHead() { }, on() { }, write: ev, end: l => { if (l) ev(l); after() } };
  function after() {
    const all2 = readJ(JF(ad), []), j2 = all2.find(x => x.id === id); if (!j2) { jobRun = null; return }
    const s2 = j2.steps[k]; j2.conv = conv || j2.conv;
    const failed = !done || /RESULT:\s*failed/i.test(reply); s2.out = (reply.trim() || err).slice(-600); s2.cost = +((s2.cost || 0) + (done?.cost || 0)).toFixed(5); s2.ms = Date.now() - s.at;
    if (!jobRun || jobRun.cancel || j2.status !== 'running') { s2.st = 'wait'; saveJobs(all2, ad); jobRun = null; return }
    if (!failed) { s2.st = 'ok'; saveJobs(all2, ad); return setTimeout(() => step(id), 50) }
    if (s2.tries < 2 && done) { s2.st = 'wait'; j2.log.unshift({ at: Date.now(), x: `Step ${k + 1} failed, retrying once` }); saveJobs(all2, ad); return setTimeout(() => step(id), 50) }
    s2.st = 'fail'; j2.status = 'paused'; j2.log.unshift({ at: Date.now(), x: `Step ${k + 1} failed: ${(err || /RESULT:\s*failed\s*-?\s*(.*)/i.exec(reply)?.[1] || 'no result').slice(0, 200)}` }); saveJobs(all2, ad); jobRun = null;
  }
  send({ text, conv, project: j.project, mode: j.mode, model: 'auto', fresh: true }, r);
}
function brain() { const L = readJ(LF(), {}), a = B.analyze(convs(), L); return { ...a, rules: L.rules || [], history: (L.history || []).slice(0, 30), skills: L.skills || [] } }

module.exports = { stopAny: () => { if (jobRun) jobRun.cancel = true; return !!run && stop(run.id, 'account switched') }, send, post, list, one, search, status, route, explain, _: { bin: () => BIN, args, sys, kind, learned, cached, setBin: b => { BIN = b } } };
