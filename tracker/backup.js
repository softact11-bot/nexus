// NEXUS M2 backups, safe JSON writes and the step journal (spec §26.4), shared with Setup (M6).
// backup(): dated copy of the given files into <data>/backups/nexus/<stamp>-<label>/ + manifest of sha256, re-read and verified.
// Backups are never overwritten or auto-deleted. writeJSON(): guard → backup the old file → temp + fsync + rename → re-read check.
// Journal: each step is recorded with its undo before it runs and marked done after it is checked; open() lists unfinished steps.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), sp = require('./safepath');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
// B65: on Windows a rename over a file fails (EPERM/EACCES/EBUSY) while any other process has it open, even for a read or stat.
// Retry for up to ~1.3 s, blocking (callers are sync); still failing → throw: the old file and its .bak stay as they were.
const rename = (a, b) => { for (let w = 5; ; w *= 2) { try { return fs.renameSync(a, b) } catch (e) { if (w > 640 || !/^(EPERM|EACCES|EBUSY)$/.test(e.code)) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, w) } } };
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');

function backup(files, dataDir, label = 'backup') {
  const have = files.filter(f => fs.existsSync(f)), size = have.reduce((a, f) => a + fs.statSync(f).size, 0);
  try { const s = fs.statfsSync(dataDir); if (s.bavail * s.bsize < size * 2 + 50e6) throw new Error('Not enough free disk space for a backup.') } catch (e) { if (/disk space/.test(e.message)) throw e }
  let dir = path.join(dataDir, 'backups', 'nexus', stamp() + '-' + label.replace(/[^\w-]/g, '')), n = 1;
  while (fs.existsSync(dir)) dir = dir.replace(/(_\d+)?$/, '_' + ++n);
  sp.guard(path.join(dir, 'manifest.json'), [dataDir]); fs.mkdirSync(dir, { recursive: true });
  const man = have.map((f, i) => { const b = fs.readFileSync(f), to = i + '-' + path.basename(f); fs.writeFileSync(path.join(dir, to), b, { flag: 'wx' }); return { from: f, to, sha256: sha(b), size: b.length } });
  for (const m of man) if (sha(fs.readFileSync(path.join(dir, m.to))) !== m.sha256) throw new Error('Backup check failed for ' + path.basename(m.from));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ at: Date.now(), label, files: man }, null, 1), { flag: 'wx' });
  return dir;
}

function writeJSON(file, obj, dataDir, label) {
  const f = sp.guard(file, [dataDir]), bk = fs.existsSync(f) ? backup([f], dataDir, label || path.basename(f, '.json')) : null;
  const txt = JSON.stringify(obj, null, 1), tmp = f + '.tmp-' + process.pid;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const fd = fs.openSync(tmp, 'w'); try { fs.writeSync(fd, txt); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  rename(tmp, f);
  if (fs.readFileSync(f, 'utf8') !== txt) throw new Error('Write check failed for ' + path.basename(f));
  return bk;
}

class Journal {
  constructor(file, dataDir) { this.f = sp.guard(file, [dataDir]); this.d = dataDir }
  read() { try { return JSON.parse(fs.readFileSync(this.f, 'utf8')) } catch { return { steps: [] } } }
  save(j) { const tmp = this.f + '.tmp'; fs.mkdirSync(path.dirname(this.f), { recursive: true }); fs.writeFileSync(tmp, JSON.stringify(j, null, 1)); rename(tmp, this.f) }
  begin(step, undo) { const j = this.read(); j.steps.push({ step, undo, state: 'started', at: Date.now() }); this.save(j) }
  done(step) { const j = this.read(), s = j.steps.findLast(x => x.step === step && x.state === 'started'); if (!s) throw new Error('No started step ' + step); s.state = 'done'; s.doneAt = Date.now(); this.save(j) }
  open() { return this.read().steps.filter(s => s.state === 'started') }
}

// B59 store (moved from auto.js for P2a T4): files a crash or power loss must not wipe (automations, runs, state.json, projects.json).
// readJ: missing → default; unreadable → kept as <file>.corrupt-<stamp>, <file>.bak loaded if valid, message queued in BAD for the bell.
// writeJ: tmp → fsync → current copied to .bak → rename. Takes an object or an already-serialised string.
const BAD = [], NOBAK = new Set();
const readJ = (f, d) => {
  let t; try { t = fs.readFileSync(f, 'utf8') } catch (e) { if (e.code === 'ENOENT') return d; t = null }
  try { return JSON.parse(t) } catch { }
  const keep = f + '.corrupt-' + new Date().toISOString().replace(/[:.]/g, '-'); let moved = false; try { fs.renameSync(f, keep); moved = true } catch { try { fs.copyFileSync(f, keep) } catch { } NOBAK.add(f) } // the bad copy is never overwritten; a bad file left in place is never copied over .bak
  let o = d; try { o = JSON.parse(fs.readFileSync(f + '.bak', 'utf8')); if (moved) fs.copyFileSync(f + '.bak', f) } catch { } // restored copy back on disk, so the next read (projects.js reads per request) sees it
  BAD.push(`${path.basename(f)} could not be read; kept as ${path.basename(keep)}, ${o === d ? 'no earlier copy, starting empty' : 'restored the previous save (' + path.basename(f) + '.bak)'}.`); return o };
const writeJ = (f, o) => {
  fs.mkdirSync(path.dirname(f), { recursive: true }); const fd = fs.openSync(f + '.tmp', 'w');
  try { fs.writeSync(fd, typeof o === 'string' ? o : JSON.stringify(o)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  if (!NOBAK.delete(f)) try { fs.copyFileSync(f, f + '.bak') } catch { } rename(f + '.tmp', f) };

module.exports = { backup, writeJSON, Journal, sha, readJ, writeJ, BAD, rename };
