// Self-check for M7f scan.js with stub sources (no real data read). node test-scan.js
const fs = require('fs'), path = require('path'), os = require('os'), a = require('assert');
const S = require('./scan.js'), D = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-scan-')), SRC = S._.SRC;
let P = { a: ['1', 'Alpha'], b: ['1', 'Beta'] }, boom = false;
for (const k of Object.keys(SRC)) delete SRC[k];
SRC.projects = () => P; SRC.notes = () => { if (boom) throw new Error(String.raw`vault locked at C:\Users\x\v`); return { n1: ['1', 'Note'] } }; SRC.sessions = c => Object.fromEntries(Object.values(c.sessions).map(s => [s.id, [s.end + ':' + s.n, s.id]]));
(async () => {
  const ses = { s1: { id: 's1', end: 1, n: 1 } }, R = o => S.run({ dir: D, sessions: ses, ...o });
  let r = await R(); a.ok(r.first && !Object.keys(r.changes).length, 'first scan = baseline');
  r = await R(); a.ok(r.recent, 'startup rescan within 2 min skipped');
  r = await R({ force: true }); a.ok(!r.first && !Object.keys(r.changes).length, 'no changes → empty');
  const [x, y] = [R({ force: true }), R({ force: true })]; a.equal(x, y, 'concurrent scans share one run'); await x;
  P = { a: ['2', 'Alpha 2'], c: ['1', 'Gamma'] }; ses.s2 = { id: 's2', end: 5, n: 1 };
  r = await R({ force: true }); a.deepEqual(r.changes.projects.n, [1, 1, 1]); a.deepEqual(r.changes.projects.added, ['Gamma']); a.deepEqual(r.changes.projects.removed, ['Beta']); a.deepEqual(r.changes.sessions.added, ['s2']);
  r = await R({ force: true }); a.ok(!Object.keys(r.changes).length, 'idempotent: same state → no changes again');
  boom = true; r = await R({ force: true }); a.ok(r.failed.notes && !/Users/.test(r.failed.notes) && !r.changes.notes, 'failed source reported, path redacted, no false removal');
  boom = false; r = await R({ force: true }); a.ok(!r.changes.notes && !r.failed.notes, 'recovered source: no false change');
  a.ok(fs.existsSync(path.join(D, 'scan.json')) && !fs.existsSync(path.join(D, 'scan.json.tmp')), 'atomic snapshot');
  a.equal(S.last(D).report.at, r.at, 'GET last report');
  fs.writeFileSync(path.join(D, 'scan.json'), '{broken'); r = await R(); a.ok(r.first, 'corrupt snapshot → new baseline');
  fs.rmSync(D, { recursive: true, force: true }); console.log('test-scan: all checks passed');
})().catch(e => { console.error(e); process.exit(1) });
