// NEXUS voice input (post-M7 Phase 3): runs voice.ps1 (Windows' offline recognizer) only while the microphone is switched on in NEXUS.
// Modes: ptt = one phrase then stop; free = every phrase until stopped; wake = only phrases that contain "NEXUS" (the word is removed;
// "NEXUS" alone arms the next phrase for 8 s; "NEXUS stop" is sent as the stop command). Nothing is recorded or saved: the page gets
// text + mic level over GET /api/voice/events (NDJSON) and decides what to do with it. Speaking (text-to-speech) happens in the page.
const cp = require('child_process'), path = require('path');
const PS = path.join(__dirname, 'voice.ps1'), MODES = ['ptt', 'free', 'wake'];
let ps = null, mode = null, armed = 0, buf = '';
const subs = new Set();
const send = o => { const l = JSON.stringify(o) + '\n'; for (const r of subs) try { r.write(l) } catch { } };

// Wake-word filter, exported for the self-check. Returns the text to forward, '' to arm, or null to drop.
function wake(x, now = Date.now()) {
  const t = String(x || '').trim(), m = t.match(/^(?:hey\s+|ok\s+)?nexus\b[\s,.:!?]*(.*)$/i) || t.match(/\bnexus\b[\s,.:!?]*(.*)$/i);
  if (m) { if (!m[1]) { armed = now + 8000; return '' } armed = 0; return m[1] }
  if (armed > now) { armed = 0; return t }
  return null;
}

function start(m) {
  if (!MODES.includes(m)) return { res: 'bad request' };
  if (ps) stop();
  mode = m; armed = 0; buf = '';
  try { ps = cp.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS, '-mode', m], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch (e) { return { res: 'The microphone helper could not start: ' + e.message } }
  const me = ps; let errTail = '', said = false; // V1: a helper that dies without an error line still tells the page why
  me.stdout.on('data', d => { if (ps !== me) return; buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) { if (l.includes('"t":"error"')) said = true; line(l) } } });
  me.stderr.on('data', d => { errTail = (errTail + d).slice(-400) });
  me.on('error', e => { if (ps !== me) return; said = true; line(JSON.stringify({ t: 'error', x: 'The microphone helper could not start: ' + e.message })) }); // V3: spawn errors arrive async; unhandled they crash the tracker
  me.on('close', c => { if (ps !== me) return; ps = null; mode = null; if (c && !said) line(JSON.stringify({ t: 'error', x: (errTail.trim().split('\n').pop() || 'the helper ended') + ` (exit code ${c})` })); send({ t: 'off' }) });
  send({ t: 'on', mode: m });
  return { res: 'ok' };
}
function line(l) {
  let j; try { j = JSON.parse(l) } catch { return }
  if (j.t === 'text') {
    if (mode === 'wake') { const x = wake(j.x); if (x === null) return; if (x === '') return send({ t: 'wake' }); j.x = x }
    if (/^(nexus\s+)?stop( talking| speaking)?\.?$/i.test(j.x.trim())) return send({ t: 'cmd', x: 'stop' });
    if (!j.x.trim() || j.c < 0.15) return send({ t: 'unsure', c: j.c });
  }
  if (j.t === 'error') j.x = /No audio input|audio device|SetInputToDefaultAudioDevice/i.test(j.x) ? 'No microphone found. Plug one in or pick it as the Windows default input, then try again.'
    : /recognizer|required ID|culture/i.test(j.x) ? 'Windows speech recognition for English (United States) is not installed. Add it in Windows Settings → Time & language → Speech, then try again.' // V2
    : /^The microphone helper could not start/.test(j.x) ? String(j.x).slice(0, 240) : 'Voice input stopped: ' + String(j.x).slice(0, 200);
  send(j);
}
function stop() {
  if (!ps) return false;
  const p = ps; ps = null; mode = null;
  try { cp.execFile('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }, () => { }) } catch { try { p.kill() } catch { } }
  send({ t: 'off' }); return true;
}
// GET /api/voice/events: one long NDJSON response per open page; the mic stops when the last page closes.
function events(q, r) {
  r.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  subs.add(r); r.write(JSON.stringify({ t: 'hello', on: !!ps, mode }) + '\n');
  const ka = setInterval(() => { try { r.write('{"t":"ka"}\n') } catch { } }, 20000);
  q.on('close', () => { clearInterval(ka); subs.delete(r); if (!subs.size) stop() });
}
function post(o) {
  if (o.op === 'start') return start(o.mode);
  if (o.op === 'stop') return { res: stop() ? 'ok' : 'ok' };
  return { res: 'bad request' };
}
const status = () => ({ on: !!ps, mode });
module.exports = { post, events, status, _: { wake } };
