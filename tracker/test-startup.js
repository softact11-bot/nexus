// M5b Phase 1b check: node test-startup.js. The `boot` hook and `open` (start.cmd) start a tracker only when nothing listens
// (ECONNREFUSED); a slow, hung, resetting or 401-answering listener on the port never gets a second tracker. Runs this folder's
// tracker.js on port 7792 against stub listeners; the `serve` spawn is replaced by a marker-file append, so no real tracker starts.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), http = require('http'), net = require('net');
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m), P = 7792, sleep = ms => new Promise(r => setTimeout(r, ms));
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-startup-')), SPAWN = "cp.spawn(process.execPath, [__filename, 'serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()";
const KEYF = path.join(T, 'launch.key'), KEY = require('crypto').randomBytes(32).toString('hex'), MAC = require('./launch.js').mac; fs.writeFileSync(KEYF, KEY); // fake key, never the dev tracker's
const src = fs.readFileSync(path.join(__dirname, 'tracker.js'), 'utf8').replace("'serve', '--manual']", "'serve']") /* P2a: open starts serve --manual; test-recovery checks the flag */, nSpawn = src.split(SPAWN).length - 1;
const run = (mode, mark, extra = []) => new Promise(res => {
  const boot = `const fs = require('fs'), M = require('module'), f = ${JSON.stringify(path.join(__dirname, 'tracker.js'))}, m = new M(f);
  const s = fs.readFileSync(f, 'utf8').replace("'serve', '--manual']", "'serve']").replace('PORT = 7788', 'PORT = ${P}').replace('const F = n => path.join(DIR, n);', () => ${JSON.stringify('const F = n => n === "launch.key" ? ' + JSON.stringify(KEYF) + ' : path.join(DIR, n);')}).split(${JSON.stringify(SPAWN)}).join(${JSON.stringify(`fs.appendFileSync(${JSON.stringify(mark)}, 'spawn\\n')`)});
  if (!s.includes('PORT = ${P}') || !s.includes('n === "launch.key"')) process.exit(3);
  m.filename = f; m.paths = M._nodeModulePaths(${JSON.stringify(__dirname)}); process.argv.length = 2; process.argv.push(${JSON.stringify(mode)}, ...${JSON.stringify(extra)}); m._compile(s, f);`;
  const e = { ...process.env }; delete e.NEXUS_TOKEN;
  const c = cp.spawn(process.execPath, ['-e', boot], { cwd: __dirname, env: e, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); let out = '', err = '';
  c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d); c.on('exit', code => res({ code, out, err, spawns: fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').split('\n').filter(Boolean).length : 0 }));
});
let k = 0; const mark = () => path.join(T, 'spawn-' + (k++));
// B61: stubs answer /api/prove with the right MAC for the fake key, except 'fake' (a same-user node server that is not the tracker: wrong MAC)
// stubs on P: hang (accepts, never answers), slow (each answer after ms), busy (no answer for the first ms, then at once), 401, reset (closes at once)
const stub = (kind, ms = 0) => new Promise(r => { const seen = [];
  const s = kind === 'reset' ? net.createServer(c => c.destroy()) : http.createServer((q, w) => { seen.push(q.headers['x-nexus-token'] || '');
    if ((kind === '429' || (kind === 'rl' && Date.now() - t0 < ms)) && q.url.startsWith('/api/prove?')) { w.writeHead(429); return w.end() } // B63: rate-limited tracker (always / for the first ms)
    if (kind === 'hang' || (kind === 'busy' && Date.now() - t0 < ms)) return; const end = () => { if (q.url.startsWith('/api/prove?') && kind !== '401') { const n = new URL(q.url, 'http://x').searchParams.get('n'); w.writeHead(200, { 'content-type': 'application/json' }); return w.end(JSON.stringify({ v: 1, mac: kind === 'fake' ? MAC('0'.repeat(64), P, n) : MAC(KEY, P, n) })) }
      if (kind === '401') { w.writeHead(401); w.end('NEXUS is locked.') } else { w.writeHead(200, { 'content-type': 'application/json' }); w.end(q.url === '/api/launch' ? '{"code":"' + 'a'.repeat(32) + '"}' : 'ok') } };
    kind === 'slow' ? setTimeout(end, ms) : end() }), t0 = Date.now();
  s.listen(P, '127.0.0.1', () => r({ seen, close: () => new Promise(z => { s.close(z); s.closeAllConnections?.(); for (const c of socks) c.destroy() }) }));
  const socks = new Set(); s.on('connection', c => { socks.add(c); c.on('close', () => socks.delete(c)) }) });

(async () => {
  try {
    ok(nSpawn === 2, `tracker.js has the serve spawn in boot and open (${nSpawn})`);
    // boot
    let r = await run('boot', mark()); ok(r.spawns === 1, 'boot, nothing listening → 1 tracker start (' + r.spawns + ')');
    let S = await stub('hang'); const H = await Promise.all(Array.from({ length: 10 }, () => run('boot', mark()))); await S.close();
    ok(H.every(x => x.spawns === 0 && x.code === 0), 'boot ×10 against a hung tracker (no answer) → 0 starts (' + H.map(x => x.spawns).join('') + ')');
    const B = []; for (const ms of [500, 1000, 3000]) { S = await stub('slow', ms); B.push(...await Promise.all(Array.from({ length: ms === 3000 ? 4 : 3 }, () => run('boot', mark())))); await S.close() }
    ok(B.length === 10 && B.every(x => x.spawns === 0), `boot ×${B.length} against a tracker busy 0.5-3 s → 0 starts (${B.map(x => x.spawns).join('')})`);
    S = await stub('401'); r = await run('boot', mark()); await S.close(); ok(r.spawns === 0, 'boot, port answers 401 (other key / other user) → 0 starts');
    S = await stub('reset'); r = await run('boot', mark()); await S.close(); ok(r.spawns === 0, 'boot, listener resets the connection → 0 starts');
    // open (start.cmd)
    const o1 = await run('open', mark(), ['--print']);
    S = await stub('busy', 5000); const o2 = await run('open', mark(), ['--print']); o2.seen = S.seen.length; o2.tok = S.seen.filter(Boolean); await S.close();
    S = await stub('hang'); const o3 = await run('open', mark(), ['--print']); await S.close();
    ok(o1.spawns === 1 && o1.code === 1 && /did not start/.test(o1.err), 'open, nothing listening → exactly 1 start over 20 retries, then "did not start" (' + o1.spawns + ')');
    ok(o2.spawns === 0 && o2.code === 0 && /\/launch\?c=a{32}$/.test(o2.out.trim()), 'open, tracker busy 5 s (no answer) then answers → 0 starts, link printed (' + o2.spawns + ', ' + o2.seen + ' tries)');
    ok(o3.spawns === 0 && o3.code === 1 && /busy/.test(o3.err), 'open, hung tracker → 0 starts, "running but did not answer (busy)" (' + o3.spawns + ')');
    S = await stub('fake'); const o4 = await run('open', mark(), ['--print']); o4.tok = S.seen.filter(Boolean); await S.close();
    S = await stub('401'); const o5 = await run('open', mark(), ['--print']); o5.tok = S.seen.filter(Boolean); await S.close();
    ok(o4.spawns === 1 && o4.code === 1 && /could not prove/.test(o4.err) && o4.tok.length === 0, 'B61 + P3: open, same-user node server with a wrong /api/prove MAC → key never sent, one tracker start (serve takes the fallback port), "could not prove" (' + o4.tok.length + ' tokens, ' + o4.spawns + ' starts)');
    ok(o5.spawns === 0 && o5.code === 1 && /no \/api\/prove/.test(o5.err) && o5.tok.length === 0, 'B61: open, listener without /api/prove (401: old tracker / other program) → key never sent (' + o5.tok.length + ')');
    ok(o2.tok.length === 1 && o2.tok[0] === KEY, 'B61: open sends the key once, only after a valid proof (' + o2.tok.length + ')');
    S = await stub('429'); const o6 = await run('open', mark(), ['--print']); o6.tok = S.seen.filter(Boolean); await S.close();
    S = await stub('rl', 2000); const o7 = await run('open', mark(), ['--print']); o7.tok = S.seen.filter(Boolean); await S.close();
    ok(o6.spawns === 0 && o6.code === 1 && /busy \(too many requests/.test(o6.err) && !/could not prove|no \/api\/prove/.test(o6.err) && o6.tok.length === 0, 'B63: open, tracker answers 429 → "busy (too many requests)", not an identity failure, key never sent (' + o6.tok.length + ')');
    ok(o7.spawns === 0 && o7.code === 0 && /\/launch\?c=a{32}$/.test(o7.out.trim()) && o7.tok.length === 1 && o7.tok[0] === KEY, 'B63: open, 429 for 2 s then a valid proof → retried, link printed, key sent once after the proof (' + o7.tok.length + ')');
    ok(![o1, o2, o3, o4, o5, o6, o7].some(x => /[0-9a-f]{64}/.test(x.out + x.err)), 'open output has no token');
  } catch (e) { fail.push('crash: ' + e.message) }
  fs.rmSync(T, { recursive: true, force: true });
  console.log(JSON.stringify({ pass, fail }, null, 1)); process.exit(fail.length ? 1 : 0);
})();
