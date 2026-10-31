// M2 real-page check: node test-link-page.js. Headless Chrome on the RUNNING tracker (127.0.0.1:7788/preview): every page loads with no
// script errors, the Projects "Link Vault" form opens with its help text and checks, ../ disables Save, a system folder is refused by the
// server on Save. Never saves a valid link. --switch: also switches the active project to the other one and back through the page's API
// (writes only nexus-config.json, restored to the same content). Without --switch projects.json, nexus-config.json and protected files must not change.
const A = require('./test-auth.js'); // M4b launch token + port
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const OUT = path.join(os.tmpdir(), 'nexus-link-shots'), PROF = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-link-chrome-')); fs.mkdirSync(OUT, { recursive: true });
const ch = cp.spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9334', '--user-data-dir=' + PROF, '--no-first-run', '--disable-extensions', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pend = {}, errs = [];
const send = (method, params = {}) => new Promise((ok, no) => { const i = ++id; pend[i] = { ok, no }; ws.send(JSON.stringify({ id: i, method, params })) });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value };
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(r.data, 'base64')) };
const H = os.homedir(), APPD = process.env.APPDATA || '', OBS = path.join(APPD, 'obsidian', 'obsidian.json');
let VAULTS = []; try { VAULTS = Object.values(JSON.parse(fs.readFileSync(OBS, 'utf8')).vaults || {}).map(v => v.path) } catch { }
const SW = process.argv.includes('--switch'), CFG = path.join(require('./config').dataDir(), 'nexus-config.json'), cfg0 = fs.existsSync(CFG) ? JSON.parse(fs.readFileSync(CFG, 'utf8')) : null;
const WATCH = [path.join(H, '.claude', 'settings.json'), OBS, path.join(require('./config').dataDir(), 'projects.json'), ...(SW ? [] : [CFG, path.join(require('./config').dataDir(), 'backups', 'nexus')]),
  ...VAULTS.flatMap(v => ['app.json', 'community-plugins.json'].map(f => path.join(v, '.obsidian', f)))];
const snap = () => WATCH.map(f => { try { const s = fs.statSync(f); return s.isDirectory() ? 'dir' : crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') } catch { return 'missing' } });
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m);
(async () => {
  const before = snap();
  let tgt; for (let i = 0; i < 40 && !tgt; i++) { await sleep(250); try { tgt = (await (await fetch('http://127.0.0.1:9334/json/list')).json()).find(t => t.type === 'page') } catch { } }
  ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  ws.onmessage = m => { const j = JSON.parse(m.data); if (j.id && pend[j.id]) { (j.error ? pend[j.id].no : pend[j.id].ok)(j.error || j.result); delete pend[j.id] }
    else if (j.method === 'Runtime.exceptionThrown') errs.push(j.params.exceptionDetails.exception?.description?.split('\n')[0] || j.params.exceptionDetails.text);
    else if (j.method === 'Runtime.consoleAPICalled' && j.params.type === 'error') errs.push(j.params.args.map(a => a.value || a.description).join(' ')) };
  await send('Runtime.enable'); await send('Page.enable'); await A.cookie(send);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + A.PORT + '/preview#/home' }); await sleep(3500);
  // every page loads with content and no script errors (existing integrations)
  const pages = await ev(`[...new Set([...document.querySelectorAll('a[href^="#/"]')].map(a => a.getAttribute('href')))]`);
  ok(pages.length >= 10, 'nav has the pages (' + pages.length + ')');
  for (const p of pages) { const e0 = errs.length; await ev(`location.hash = ${JSON.stringify(p)}`); await sleep(2200);
    const t = await ev(`(document.querySelector('main')?.innerText || '').length`); ok(t > 100 && errs.length === e0, `page ${p} loads (${t} chars${errs.length > e0 ? ', ' + errs.slice(e0).join(' | ') : ''})`) }
  // Projects: Link Vault form
  await ev(`location.hash = '#/projects'`); await sleep(2500);
  ok(await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => /Link Vault/.test(b.textContent)); if (!b) return false; b.click(); return true })()`), 'Link Vault button');
  await sleep(700);
  const F = `document.querySelector('form [name=vpath]')?.form`, SET = `const f = ${F}, set = (n, v) => { const e = f.elements[n]; e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })) }, save = () => [...f.querySelectorAll('button')].find(b => /Save link/.test(b.textContent));`;
  const form = await ev(`(() => { const f = ${F}; if (!f) return null; return { text: f.innerText, vaults: f.querySelectorAll('input[name=v]').length, names: [...f.elements].map(e => e.name).filter(Boolean) } })()`);
  ok(form, 'link form opens');
  if (form) {
    for (const s of ['a vault is a folder of notes', 'keeps project docs and vault notes in step', 'a map of how your notes link together', 'never changed here', 'Make this the active project']) ok(form.text.includes(s), 'help text: ' + s);
    ok(form.vaults === VAULTS.length, 'vault list = Obsidian vaults (' + form.vaults + ')');
    for (const n of ['vpath', 'folder', 'sync', 'cmd', 'graph', 'out', 'active']) ok(form.names.includes(n), 'field ' + n);
    const r = await ev(`(async () => { ${SET} const w = t => new Promise(r => setTimeout(r, t)), R = {};
      f.querySelector('input[name=v]')?.click(); set('folder', 'Demo Game'); await w(300); R.good = !save().disabled;
      set('folder', '../x'); await w(300); R.dotdot = save().disabled;
      set('folder', 'Demo Game'); f.querySelectorAll('input[name=graph]')[1].click(); await w(200); R.outShown = f.elements.out.offsetParent !== null;
      f.querySelectorAll('input[name=graph]')[0].click(); await w(200); R.outHidden = f.elements.out.offsetParent === null; return R })()`);
    ok(r.good, 'valid choice enables Save'); ok(r.dotdot, '../ disables Save'); ok(r.outShown && r.outHidden, 'Graphify output field only for Graphify');
    await ev(`(async () => { ${SET} f.querySelectorAll('input[name=graph]')[1].click(); f.querySelectorAll('input[name=sync]')[1].click() })()`); await sleep(300); await shot('link-form');
    // server refusal on Save (nothing written): typed system folder
    const ref = await ev(`(async () => { ${SET} f.querySelectorAll('input[name=v]').forEach(x => x.checked = false); set('vpath', 'C:\\\\Windows'); set('folder', ''); f.active.checked = false;
      f.querySelectorAll('input[name=sync]')[0].click(); f.querySelectorAll('input[name=graph]')[0].click(); await new Promise(r => setTimeout(r, 300)); save().click(); await new Promise(r => setTimeout(r, 1500));
      return { open: document.getElementById('p-dlg')?.open, toast: [...document.querySelectorAll('[class*=toast]')].map(t => t.innerText).join(' ') } })()`);
    ok(ref.open && /System and program folders/.test(ref.toast), 'server refuses C:\\Windows, dialog stays open (' + ref.toast.slice(0, 80) + ')');
    await ev(`[...${F}.querySelectorAll('button')].find(b => /Cancel/.test(b.textContent))?.click()`); await sleep(300);
    ok(!(await ev(`document.getElementById('p-dlg')?.open`)), 'Cancel closes the form');
  }
  // active project shown by the API = nexus-config.json (null before the migration)
  const st = await ev(`fetch('/api/projects').then(r => r.json())`), slug = n => n.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  ok((st.active ?? null) === (cfg0?.active ?? null), 'API active = nexus-config.json (' + st.active + ')');
  const pnode = async () => (await ev(`fetch('/api/graph').then(r => r.json()).then(g => (g.nodes || []).filter(n => /^project_(?!file_)/.test(n.id)).map(n => n.l).join(','), e => 'error ' + e.message)`));
  if (SW && cfg0?.active) {
    const other = st.items.find(p => p.id !== cfg0.active), mine = st.items.find(p => p.id === cfg0.active);
    ok(new RegExp(mine.name).test(await pnode()), 'Knowledge graph project node = ' + mine.name);
    const r1 = await ev(`fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'active', id: '${other.id}' }) }).then(r => r.json())`);
    ok(r1.res === 'ok' && JSON.parse(fs.readFileSync(CFG, 'utf8')).active === other.id, 'switch to ' + other.name);
    const pn = await pnode(); ok(pn.includes(other.name) || /^error/.test(pn), 'Knowledge follows the switch (' + pn.slice(0, 60) + ')');
    await ev(`location.hash = '#/knowledge'`); await sleep(2500); const e0 = errs.length; ok(errs.length === e0, 'Knowledge page loads after the switch');
    const r2 = await ev(`fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'active', id: '${mine.id}' }) }).then(r => r.json())`);
    ok(r2.res === 'ok' && JSON.stringify(JSON.parse(fs.readFileSync(CFG, 'utf8'))) === JSON.stringify(cfg0), 'switch back: nexus-config.json same content as before');
    ok(new RegExp(mine.name).test(await pnode()), 'Knowledge graph back on ' + mine.name);
    await sleep(1500); const wn = await ev(`fetch('/api/graph').then(r => r.json()).then(g => g.warn || '')`);
    ok(!wn.includes(other.dir), 'no stale warning from ' + other.name + ' after switching back (' + (wn || 'none').slice(0, 80) + ')');
  }
  ok(!errs.length, 'no script errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  const after = snap(); WATCH.forEach((f, i) => ok(before[i] === after[i], 'unchanged ' + path.relative(H, f) + (before[i] === 'missing' ? ' (still missing)' : '')));
  ws.close(); ch.kill(); try { fs.rmSync(PROF, { recursive: true, force: true }) } catch { }
  console.log(JSON.stringify({ pass, fail, shot: path.join(OUT, 'link-form.png') }, null, 1)); process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); ch.kill(); process.exit(1) });
