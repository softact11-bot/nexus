// M0 Setup preview tests: node test-setup-preview.js [screen names to capture]. Headless Chrome, temp profile, needs the tracker on 127.0.0.1:7788.
const A = require('./test-auth.js'); // M4b launch token + port
const cp = require('child_process'), fs = require('fs'), path = require('path');
const OUT = path.join(require('os').tmpdir(), 'nexus-setup-shots'), PROF = path.join(require('os').tmpdir(), 'nexus-setup-chrome'); fs.mkdirSync(OUT, { recursive: true });
const URL = 'http://127.0.0.1:' + A.PORT + '/preview/setup-preview.html';
const ch = cp.spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9333', '--user-data-dir=' + PROF, '--no-first-run', '--disable-extensions', '--window-size=1280,860', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pend = {};
const send = (method, params = {}) => new Promise((ok, no) => { const i = ++id; pend[i] = { ok, no }; ws.send(JSON.stringify({ id: i, method, params })) });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value };
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(r.data, 'base64')) };
const size = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
// privacy: detect JSON leaks no home path or username; foreign Host 403, bare POST 403 (M4a guard), same-origin JSON POST 405; static scan of the preview + setup.js
const os = require('os'), http = require('http'), HOME = os.homedir(), USER = os.userInfo().username, EMAIL = (() => { try { return cp.execSync('git -C "' + path.join(os.homedir(), 'Desktop', 'my-game') + '" log -1 --format=%ae', { encoding: 'utf8' }).trim() } catch { return '' } })();
const leaks = s => [HOME, HOME.replace(/\\/g, '/'), JSON.stringify(HOME).slice(1, -1), USER, EMAIL].filter(x => x && s.toLowerCase().includes(x.toLowerCase()));
const req = (method, host, extra) => new Promise(ok => http.request({ host: '127.0.0.1', port: A.PORT, path: '/api/setup/detect', method, headers: { ...(host ? { host } : {}), ...A.H, ...extra } }, r => { let b = ''; r.on('data', d => b += d).on('end', () => ok([r.statusCode, b])) }).on('error', e => ok([0, e.message])).end());
// files the preview must never change (mtime + size before and after the run)
const APPD = process.env.APPDATA || '', OBS = path.join(APPD, 'obsidian', 'obsidian.json');
let VAULTS = []; try { VAULTS = Object.values(JSON.parse(fs.readFileSync(OBS, 'utf8')).vaults || {}).map(v => v.path) } catch { }
const WATCH = [path.join(HOME, '.claude', 'settings.json'), OBS, path.join(require('./config').dataDir(), 'projects.json'), path.join(HOME, 'Desktop', 'my-game', 'graphify-out', 'graph.json'),
  ...VAULTS.flatMap(v => ['app.json', 'community-plugins.json'].map(f => path.join(v, '.obsidian', f)))];
const snap = () => WATCH.map(f => { try { const s = fs.statSync(f); return s.mtimeMs + ':' + s.size } catch { return 'missing' } });
(async () => {
  const P = []; const pk = (c, m) => P.push((c ? 'ok   ' : 'FAIL ') + m);
  const [c0, body] = await req('GET'); pk(c0 === 200 && !leaks(body).length, 'detect JSON 200, no home path / username / email ' + leaks(body).length);
  pk((await req('GET', 'evil.example:7788'))[0] === 403, 'foreign Host 403'); pk((await req('POST'))[0] === 403, 'bare POST 403 (M4a guard: no Origin / JSON)');
  pk((await req('POST', 0, { origin: 'http://127.0.0.1:' + A.PORT, 'content-type': 'application/json' }))[0] === 405, 'same-origin JSON POST 405 (detect is GET only)');
  for (const f of ['app/setup-preview.html', 'app/js/setup-preview.js', 'app/css/setup-preview.css', 'setup.js', 'test-setup-preview.page.js']) { const l = leaks(fs.readFileSync(path.join(__dirname, f), 'utf8')); pk(!l.length, 'static scan ' + f + (l.length ? ' ' + l.length + ' hit(s)' : '')) }
  const before = snap();
  let tgt; for (let i = 0; i < 40 && !tgt; i++) { await sleep(250); try { tgt = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).find(t => t.type === 'page') } catch { } }
  ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  const errs = []; ws.onmessage = m => { const j = JSON.parse(m.data); if (j.id && pend[j.id]) { (j.error ? pend[j.id].no : pend[j.id].ok)(j.error || j.result); delete pend[j.id] }
    if (j.method === 'Runtime.exceptionThrown') errs.push(j.params.exceptionDetails.text + ' ' + (j.params.exceptionDetails.exception?.description || '')); if (j.method === 'Runtime.consoleAPICalled' && j.params.type === 'error') errs.push(j.params.args.map(a => a.value).join(' ')) };
  await send('Runtime.enable'); await send('Page.enable'); await A.cookie(send); await size(1280, 860);
  await send('Page.navigate', { url: URL }); await sleep(2500);
  await ev(fs.readFileSync(path.join(__dirname, 'test-setup-preview.page.js'), 'utf8'));
  const res = await ev('runAll()'); // returns { pass, fail: [], shots: [names in order] }
  console.log(JSON.stringify(res, null, 1));
  // screenshots: each named state is re-created by T.goto(name)
  for (const n of process.argv.slice(2)) { await ev(`T.goto(${JSON.stringify(n)})`); await sleep(900); await shot(n) }
  // widths: no horizontal overflow on any install screen
  for (const w of [880, 1280, 1600]) { await size(w, 860); console.log('width', w, await ev('T.overflow()')) }
  console.log('console errors:', errs.length ? errs : 'none');
  const after = snap(); WATCH.forEach((f, i) => pk(before[i] === after[i], 'unchanged ' + path.relative(HOME, f) + (before[i] === 'missing' ? ' (missing)' : '')));
  console.log('node-side checks:\n' + P.join('\n'));
  ws.close(); ch.kill(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); ch.kill(); process.exit(1) });
