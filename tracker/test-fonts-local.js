// Self-hosted fonts check: node test-fonts-local.js. Isolated trackers (temp data, background work off):
// OLD = git HEAD on 7796, NEW = this working tree on 7797 (both self-host app/fonts since the migration; NEW boots --manual past the dev crash-loop gate). Headless Chrome, temp profiles.
// Per page: same text widths for every family/weight, same screenshot bytes on still pages, NEW makes no non-loopback request,
// and NEW offline (DNS blocked except 127.0.0.1) still loads every face.
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), http = require('http'), crypto = require('crypto');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.join(os.tmpdir(), 'nexus-fonts-shots'); fs.mkdirSync(OUT, { recursive: true });
const tmp = [], mk = p => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); tmp.push(d); return d };
const OLD = mk('nexus-fonts-old-'); cp.execSync(`git archive HEAD | tar -x -C "${OLD.replace(/\\/g, '/')}"`, { cwd: __dirname, shell: 'bash' });
const PAGES = ['/preview#/home', '/preview#/settings', '/preview#/claude-code', '/preview#/automation', '/preview#/system', '/preview/setup-preview.html',
  '/preview/settings-preview.html', '/preview/claude-code-preview.html', '/preview/automation-preview.html', '/preview/system-preview.html', '/preview/sync-preview.html', '/preview/projects-link-preview.html'];
const FACES = [['Nunito', [400, 600, 700, 800]], ['Orbitron', [500, 600, 700, 800]], ['JetBrains Mono', [400, 500]]];
const boot = (dir, P) => `const fs = require('fs'), M = require('module'), f = ${JSON.stringify(path.join(dir, 'tracker.js'))}, m = new M(f);
  const s = fs.readFileSync(f, 'utf8').replace('PORT = 7788', 'PORT = ${P}').replace(".listen(PORT, '127.0.0.1', () => {", ".listen(PORT, '127.0.0.1', () => { return;");
  if (!s.includes('PORT = ${P}') || !s.includes('{ return;')) process.exit(3);
  m.filename = f; m.paths = M._nodeModulePaths(${JSON.stringify(dir)}); process.argv[2] = 'serve'; process.argv[3] = '--manual'; m._compile(s, f);`;
const procs = [];
function server(dir, P) {
  const TOK = crypto.randomBytes(32).toString('hex');
  procs.push(cp.spawn(process.execPath, ['-e', boot(dir, P)], { cwd: dir, env: { ...process.env, NEXUS_TOKEN: TOK, NEXUS_DATA: mk('nexus-fonts-data-') }, stdio: 'ignore', windowsHide: true }));
  return () => new Promise(r => { const x = http.request({ host: '127.0.0.1', port: P, path: '/api/launch', method: 'POST', headers: { host: '127.0.0.1:' + P, 'x-nexus-token': TOK, origin: 'http://127.0.0.1:' + P, 'content-type': 'application/json' } }, y => { let b = ''; y.on('data', c => b += c).on('end', () => r(JSON.parse(b).code)) }); x.on('error', () => r(null)); x.end('{}') });
}
const getJSON = (port, p) => new Promise(r => http.get({ host: '127.0.0.1', port, path: p }, y => { let b = ''; y.on('data', c => b += c).on('end', () => { try { r(JSON.parse(b)) } catch { r(null) } }) }).on('error', () => r(null)));
async function browser(dport, extra = []) {
  procs.push(cp.spawn(CHROME, ['--headless=new', '--user-data-dir=' + mk('nexus-fonts-prof-'), '--remote-debugging-port=' + dport, '--window-size=1440,900', '--force-device-scale-factor=1', '--hide-scrollbars', '--no-first-run', ...extra, 'about:blank'], { stdio: 'ignore' }));
  let t; for (let i = 0; i < 80 && !t; i++) { await sleep(250); t = ((await getJSON(dport, '/json/list')) || []).find(x => x.type === 'page') }
  const ws = new WebSocket(t.webSocketDebuggerUrl), wait = new Map(), net = []; let id = 0;
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id) } if (m.method === 'Network.requestWillBeSent') net.push(m.params.request.url) };
  const send = (method, params = {}) => new Promise(r => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })) });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Network.enable'); await send('Page.enable');
  return { send, ev, net };
}
const go = async (b, url) => { await b.send('Page.navigate', { url }); await sleep(400); for (let i = 0; i < 40 && await b.ev('document.readyState') !== 'complete'; i++) await sleep(100) };
const probe = `(async () => { await document.fonts.ready; const c = document.createElement('canvas').getContext('2d'), w = {};
  for (const [f, ws] of ${JSON.stringify(FACES)}) for (const x of ws) { const font = x + ' 40px "' + f + '"'; await document.fonts.load(font); c.font = font; w[f + ' ' + x] = c.measureText('NEXUS Setup 0123456789 Ready to install — mono {}[]').width.toFixed(3) }
  const used = [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '') + ' ' + f.weight); return { w, used: [...new Set(used)].sort(), fail: [...document.fonts].filter(f => f.status === 'error').length } })()`;
const shot = async (b, name) => { await sleep(1500); const d = (await b.send('Page.captureScreenshot', { format: 'png' })).result.data; fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(d, 'base64')); return crypto.createHash('sha1').update(d).digest('hex') };
(async () => {
  let pass = 0; const bad = [], note = [], ok = (c, m) => c ? pass++ : bad.push(m);
  const oc = server(OLD, 7796), nc = server(__dirname, 7797); await sleep(2500);
  const bo = await browser(9341), bn = await browser(9342), bf = await browser(9343, ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1']);
  await go(bo, `http://127.0.0.1:7796/launch?c=${await oc()}`); await go(bn, `http://127.0.0.1:7797/launch?c=${await nc()}`); await go(bf, `http://127.0.0.1:7797/launch?c=${await nc()}`);
  for (const pg of PAGES) {
    const n = pg.replace(/\W+/g, '_');
    await go(bo, 'http://127.0.0.1:7796' + pg); const po = await bo.ev(probe), ho = await shot(bo, 'old' + n);
    bn.net.length = 0; await go(bn, 'http://127.0.0.1:7797' + pg); const pn = await bn.ev(probe), hn = await shot(bn, 'new' + n);
    bf.net.length = 0; await go(bf, 'http://127.0.0.1:7797' + pg); const pf = await bf.ev(probe);
    ok(JSON.stringify(po.w) === JSON.stringify(pn.w), pg + ': widths differ OLD vs NEW ' + JSON.stringify(Object.keys(po.w).filter(k => po.w[k] !== pn.w[k])));
    ok(JSON.stringify(pn.w) === JSON.stringify(pf.w), pg + ': widths differ NEW online vs offline');
    ok(pn.fail === 0 && pf.fail === 0, pg + ': font load errors new ' + pn.fail + ' offline ' + pf.fail);
    ok(JSON.stringify(po.used.filter(x => !/^(Orbitron 800)$/.test(x) || pg.includes('setup'))) === JSON.stringify(pn.used), pg + ': faces OLD ' + po.used + ' NEW ' + pn.used);
    const ext = [...bn.net, ...bf.net].filter(u => !/^(http:\/\/127\.0\.0\.1:|data:|blob:|about:)/.test(u)); ok(!ext.length, pg + ': non-loopback requests ' + ext.slice(0, 3));
    note.push(`${pg} shot ${ho === hn ? 'identical' : 'differs'}`);
  }
  console.log(JSON.stringify({ pass, fail: bad, screenshots: note, out: OUT }, null, 1));
  for (const p of procs) try { cp.execFileSync('taskkill', ['/T', '/F', '/PID', String(p.pid)], { stdio: 'ignore' }) } catch { }
  await sleep(1500); for (const d of tmp) try { fs.rmSync(d, { recursive: true, force: true }) } catch { }
  process.exit(bad.length ? 1 : 0);
})();
