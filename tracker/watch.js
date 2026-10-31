// Live Claude Code sessions + real subscription limits (JARVIS comparison, 2026-10-30). Read-only, no AI except the user-pressed check.
// Sessions: Claude Code keeps ~/.claude/sessions/<pid>.json (status busy / idle / waiting, waitingFor). A session "needs you" when it
// waits for a permission or answer, or went idle on a question / AskUserQuestion / ExitPlanMode. "Finished" = busy for 30 s+, then idle or gone.
// Limits: the CLI's stream-json rate_limit_event (unifiedWindows five_hour / seven_day, utilization 0-1) seen in any Assistant run.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), ACC = require('./accounts.js');
const SD = () => process.env.NEXUS_CC_SESSIONS || path.join(os.homedir(), '.claude', 'sessions');
const PD = () => path.join(path.dirname(SD()), 'projects');
const LF = () => path.join(ACC.dir(), 'assist', 'limits.json');
const MIN_WORK = 30e3, STALE = 30 * 60e3, GONE_KEEP = 10 * 60e3, MAXEV = 50;
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
const writeJ = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o)); fs.renameSync(f + '.tmp', f) };
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } };

// child env for every Claude Code spawn: no ANTHROPIC_* so runs bill the signed-in subscription, never a stray API key
const env = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^ANTHROPIC_/i.test(k)));

// ---- limits
function record(info) {
  if (!info || typeof info !== 'object') return;
  const now = Date.now(), cur = readJ(LF(), { windows: {} }), w = { ...(cur.windows || {}) };
  const put = (k, x) => { if (!x || typeof x.utilization !== 'number') return; w[k] = { pct: Math.max(0, Math.min(100, x.utilization <= 1 ? x.utilization * 100 : x.utilization)), resets: x.resetsAt ? x.resetsAt * 1000 : null, at: now } };
  for (const [k, x] of Object.entries(info.unifiedWindows || {})) put(k, x);
  if (info.rateLimitType && !info.unifiedWindows) put(info.rateLimitType, info);
  writeJ(LF(), { at: now, status: String(info.status || ''), windows: w });
}
function limits(now = Date.now()) {
  const f = readJ(LF(), null), out = { at: f?.at || null, status: f?.status || null, windows: {} };
  for (const k of ['five_hour', 'seven_day', ...Object.keys(f?.windows || {})]) {
    const x = f?.windows?.[k]; if (out.windows[k]) continue;
    out.windows[k] = x ? { pct: Math.round(x.pct), resets: x.resets, at: x.at, stale: now - x.at > STALE, expired: !!x.resets && x.resets <= now } : { pct: null };
  }
  return out;
}
let probing = null;
// user-pressed "Check limits": the smallest possible Haiku call (no tools, no hooks, no MCP); its rate_limit_event is recorded
function probe(bin) {
  if (probing) return probing;
  return probing = new Promise(ok => {
    let buf = '', got = false, c;
    try { c = cp.spawn(bin, ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--tools', '', '--strict-mcp-config', '--settings', JSON.stringify({ disableAllHooks: true })], { cwd: os.homedir(), env: env(), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }) }
    catch (e) { probing = null; return ok({ res: 'Claude Code could not start: ' + e.message }) }
    const t = setTimeout(() => c.kill(), 60e3);
    c.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const j = JSON.parse(l); if (j.type === 'rate_limit_event') { record(j.rate_limit_info); got = true } } catch { } } });
    c.on('error', () => { }); c.stdin.on('error', () => { }); c.stdin.end('Reply with: ok');
    c.on('close', () => { clearTimeout(t); probing = null; ok(got ? { res: 'ok', limits: limits() } : { res: 'Claude Code did not report limits. Is it signed in? Run claude once in a terminal.' }) });
  });
}

// ---- sessions
const seen = new Map(); // pid -> { state, since, workFrom, name, cwd, sid, gone }
const events = []; let evId = 0, first = true;
const QTOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
// last 64 KB of the transcript: did the final assistant turn ask something?
function asked(cwd, sid) {
  const f = path.join(PD(), String(cwd).replace(/[^A-Za-z0-9]/g, '-'), sid + '.jsonl');
  let t = ''; try { const fd = fs.openSync(f, 'r'), n = fs.fstatSync(fd).size, b = Buffer.alloc(Math.min(n, 65536)); fs.readSync(fd, b, 0, b.length, n - b.length); fs.closeSync(fd); t = b.toString('utf8') } catch { return false }
  const last = t.split('\n').reverse().map(l => { try { return JSON.parse(l) } catch { return null } }).find(j => j?.type === 'assistant' && !j.isSidechain);
  const bl = last?.message?.content || [];
  if (bl.some(b => b.type === 'tool_use' && QTOOLS.has(b.name))) return true;
  const txt = bl.filter(b => b.type === 'text').map(b => b.text).join('\n').replace(/https?:\/\/\S+/g, '').trim();
  return txt.split('\n').map(s => s.trim()).filter(Boolean).slice(-6).some(s => /\?["')\]*_]*$/.test(s));
}
function derive(j, p) {
  const prev = p?.state;
  if (j.waitingFor) return ['needs', String(j.waitingFor)];
  if (j.status === 'waiting') return ['needs', 'waiting for you'];
  if (j.status === 'busy') return ['working'];
  if (j.status === 'idle') return prev === 'working' && asked(j.cwd, j.sessionId) ? ['needs', 'asked a question'] : prev === 'needs' && p.why === 'asked a question' ? ['needs', p.why] : ['idle'];
  return ['unknown'];
}
function push(type, s, why) { events.unshift({ id: ++evId, at: Date.now(), type, name: s.name, cwd: s.cwd, why }); events.length = Math.min(events.length, MAXEV) }
function poll(now = Date.now()) {
  let files = []; try { files = fs.readdirSync(SD()).filter(f => /^\d+\.json$/.test(f)) } catch { }
  const live = new Set();
  for (const f of files) {
    const j = readJ(path.join(SD(), f), null); if (!j?.pid || !alive(j.pid)) continue;
    live.add(j.pid); const p = seen.get(j.pid), [st, why] = derive(j, p);
    const s = { state: st, why, since: p?.state === st ? p.since : (j.statusUpdatedAt || now), workFrom: st === 'working' ? (p?.state === 'working' ? p.workFrom : now) : p?.workFrom, name: j.name || path.basename(j.cwd || '') || 'Claude Code', cwd: j.cwd, sid: j.sessionId, kind: j.entrypoint };
    if (!first && p) {
      if (st === 'needs' && p.state !== 'needs') push('needs', s, why);
      if (p.state === 'working' && st !== 'working' && st !== 'needs' && now - (p.workFrom || now) >= MIN_WORK) push('finished', s);
    }
    seen.set(j.pid, s);
  }
  for (const [pid, s] of seen) if (!live.has(pid)) {
    if (!s.gone) { if (!first && s.state === 'working' && now - (s.workFrom || now) >= MIN_WORK) push('finished', s); s.gone = now; s.state = 'gone' }
    else if (now - s.gone > GONE_KEEP) seen.delete(pid);
  }
  first = false;
}
let iv = null;
const start = () => { if (!iv) { poll(); iv = setInterval(poll, 2000); iv.unref?.() } };
function status(after = 0) {
  start();
  return { sessions: [...seen.values()].filter(s => s.state !== 'gone').map(({ state, why, since, name, cwd, kind }) => ({ state, why, since, name, cwd: cwd ? cwd.replace(os.homedir(), '~') : null, kind })).sort((a, b) => (a.state === 'needs' ? -1 : 0) - (b.state === 'needs' ? -1 : 0) || b.since - a.since),
    events: events.filter(e => e.id > after).map(e => ({ ...e, cwd: e.cwd ? e.cwd.replace(os.homedir(), '~') : null })), last: evId, limits: limits() };
}

module.exports = { status, record, limits, probe, env, _: { poll, derive, asked, reset: () => { seen.clear(); events.length = 0; first = true } } };
