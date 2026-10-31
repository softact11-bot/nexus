// B65: writeJ (state.json) must survive another process reading the file during the rename (Windows EPERM), and must not
// lose or half-write data when the file stays locked. Temp folder only: node test-b65.js
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), { writeJ, rename } = require('./backup.js');
const D = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-b65-')), F = path.join(D, 'state.json');
let pass = 0; const fail = [], ok = (c, n) => c ? pass++ : fail.push(n);
fs.writeFileSync(F, JSON.stringify({ v: -1 }));
// 1. a reader re-reading the file every 2 ms (e.g. a stat or a dashboard read): every write lands, the last one wins, no temp file left
const rd = cp.spawn(process.execPath, ['-e', `const t=Date.now(),z=new Int32Array(new SharedArrayBuffer(4));while(Date.now()-t<8000){try{require('fs').readFileSync(${JSON.stringify(F)})}catch{}Atomics.wait(z,0,0,2)}`], { stdio: 'ignore' });
const big = 'y'.repeat(400000); let thrown = 0; const t0 = Date.now();
while (Date.now() - t0 < 300) { } // let the reader start
for (let i = 0; i < 300; i++) try { writeJ(F, { v: i, big }) } catch (e) { thrown++ }
rd.kill();
ok(thrown === 0, 'concurrent reader: 300 writes, ' + thrown + ' threw');
ok(JSON.parse(fs.readFileSync(F, 'utf8')).v === 299, 'concurrent reader: last write is on disk');
ok(!fs.existsSync(F + '.tmp'), 'concurrent reader: no temp file left');
// 2. file held open without delete sharing for 4 s: gives up within the bound, old data and .bak intact
fs.writeFileSync(F, JSON.stringify({ v: 'old' })); fs.writeFileSync(F + '.bak', JSON.stringify({ v: 'older' }));
const lk = cp.spawn('powershell', ['-NoProfile', '-Command', `$f=[IO.File]::Open('${F}','Open','Read','None'); [Console]::Out.WriteLine('held'); Start-Sleep 4; $f.Close()`], { stdio: ['ignore', 'pipe', 'ignore'] });
(async () => {
  await new Promise(r => lk.stdout.on('data', d => /held/.test(d) && r()));
  const t1 = Date.now(); let code = ''; try { writeJ(F, { v: 'new' }) } catch (e) { code = e.code } const ms = Date.now() - t1;
  ok(/^(EPERM|EACCES|EBUSY)$/.test(code), 'locked: throws a sharing error (' + code + ')');
  ok(ms >= 900 && ms < 3000, 'locked: retries are bounded (' + ms + ' ms)');
  await new Promise(r => lk.on('exit', r));
  ok(JSON.parse(fs.readFileSync(F, 'utf8')).v === 'old', 'locked: state.json keeps the last good save');
  ok(JSON.parse(fs.readFileSync(F + '.tmp', 'utf8')).v === 'new', 'locked: the unsaved state is kept in state.json.tmp, not discarded');
  writeJ(F, { v: 'after' }); ok(JSON.parse(fs.readFileSync(F, 'utf8')).v === 'after', 'locked: next save after the lock is released works');
  // 3. a non-sharing error is not retried
  const t2 = Date.now(); let c3 = ''; try { rename(path.join(D, 'missing'), F) } catch (e) { c3 = e.code }
  ok(c3 === 'ENOENT' && Date.now() - t2 < 100, 'ENOENT: thrown at once, no retry');
  // 4. the server's tick keeps going when a save still fails (state stays in memory, saved next tick)
  ok(fs.readFileSync(path.join(__dirname, 'tracker.js'), 'utf8').includes("if (s !== saved) try { require('./backup.js').writeJ(F('state.json'), s); saved = s } catch"),'tick: a failed state.json save is caught, not a crash');
  fs.rmSync(D, { recursive: true, force: true });
  console.log(`test-b65: ${pass}/${pass + fail.length} passed`); for (const f of fail) console.log('FAIL: ' + f); process.exit(fail.length ? 1 : 0);
})();
