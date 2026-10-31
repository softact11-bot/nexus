// P2a crash recovery (spec §26.9 "M5b Phase 2 crash recovery, design revision 3"): one start gate for every starter (app, boot hook, start.cmd / open, deploy.js).
// maintenance.lock {by, reason, at, until}: written by a deploy script. While valid (until ahead, never more than 15 min after at) nothing starts the tracker.
// serve.json {pid, at, boot}: written once serve listens, removed on a clean exit. Still there at the next start = the last run ended unexpectedly,
//   unless Windows restarted in between (boot time differs) or deploy.js removed it after stopping the server (a deploy is not a crash).
// crashes.json: times of those unexpected ends (last 20). More than MAX in WIN → automatic starts are paused; `serve --manual` (start.cmd, the app's Try again, deploy) still starts.
const fs = require('fs'), path = require('path'), os = require('os');
const LOCK_MS = 15 * 6e4, WIN = 10 * 6e4, MAX = 3;
const bootAt = () => Math.round((Date.now() - os.uptime() * 1e3) / 6e4) * 6e4; // uptime counts sleep, so the boot time only changes with a real restart

module.exports = dir => {
  const f = n => path.join(dir, n);
  const rd = n => { try { return JSON.parse(fs.readFileSync(f(n), 'utf8')) } catch (e) { return e.code === 'ENOENT' ? undefined : null } }; // undefined = no file, null = unreadable
  const put = (n, o) => { fs.writeFileSync(f(n) + '.tmp', JSON.stringify(o)); fs.renameSync(f(n) + '.tmp', f(n)) };
  function lock(now = Date.now()) { // null = no lock file; else { valid, why }. An unreadable lock counts from its write time.
    const j = rd('maintenance.lock'); if (j === undefined) return null;
    let at = +j?.at, until = +j?.until;
    if (!j) { try { at = fs.statSync(f('maintenance.lock')).mtimeMs } catch { return null } until = at + LOCK_MS }
    return { valid: now < Math.min(until || 0, (at || 0) + LOCK_MS), why: String(j?.reason || j?.by || 'maintenance').slice(0, 80) };
  }
  // B64: a record whose PID is still running belongs to another serve of this folder (e.g. a test copy on another port): not a crash, left alone
  const alive = p => { try { return !!p && p !== process.pid && process.kill(p, 0) } catch (e) { return e.code === 'EPERM' } }; // ponytail: a reused PID after a real crash hides that one crash
  function started(manual, now = Date.now()) { // called by serve once it listens, before launch.key is published; { ok, notes }
    const prev = rd('serve.json'), notes = []; let cr = rd('crashes.json'); if (!Array.isArray(cr)) cr = [];
    if (prev && alive(+prev.pid)) return { ok: true, n: cr.filter(t => t > now - WIN).length, notes: ['serve.json belongs to running pid ' + prev.pid + ': not a crash, record kept'] };
    if (prev !== undefined) {
      if (prev && Math.abs((+prev.boot || 0) - bootAt()) > 2 * 6e4) notes.push('the last run ended with a Windows restart or shutdown (not counted as a crash)');
      else { cr = [...cr, now].slice(-20); put('crashes.json', cr); notes.push('the last run ended unexpectedly (crash)') }
      try { fs.unlinkSync(f('serve.json')) } catch { }
    }
    const n = cr.filter(t => t > now - WIN).length;
    if (n > MAX && !manual) return { ok: false, n, notes: [...notes, `crash loop: ${n} unexpected stops in 10 min, automatic starts paused. Start it by hand (start.cmd or NEXUS Try again) once the cause is fixed; see guard.log.`] };
    put('serve.json', { pid: process.pid, at: now, boot: bootAt() });
    return { ok: true, n, notes };
  }
  const clean = () => { try { if (rd('serve.json')?.pid === process.pid) fs.unlinkSync(f('serve.json')) } catch { } }; // only our own record
  return { lock, started, clean, bootAt, MAX, WIN, LOCK_MS };
};
