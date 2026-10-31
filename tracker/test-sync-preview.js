// M3 gate (c) preview check: node test-sync-preview.js. Headless Chrome on the RUNNING tracker (127.0.0.1:7788/preview/sync-preview.html).
// Four desktop sizes: no page or card overflow, no script errors. Interactions: filters, conflict choice, simulate, modes, graph source.
// Isolation: switching projects never shows another project's notes, graph or history. No request other than GETs for the page's own
// files + Google fonts; NEXUS sync data never created; protected files unchanged. Screenshots in %TEMP%\nexus-sync-shots.
const A = require('./test-auth.js'); // M4b launch token + port
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const OUT = path.join(os.tmpdir(), 'nexus-sync-shots'), PROF = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sync-chrome-')); fs.mkdirSync(OUT, { recursive: true });
const ch = cp.spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9335', '--user-data-dir=' + PROF, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms)), URL0 = 'http://127.0.0.1:' + A.PORT + '/preview/sync-preview.html';
let ws, id = 0; const pend = {}, errs = [], reqs = [];
const send = (method, params = {}) => new Promise((ok, no) => { const i = ++id; pend[i] = { ok, no }; ws.send(JSON.stringify({ id: i, method, params })) });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value };
const shot = async (n, full) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full }); fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(r.data, 'base64')) };
const size = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const H = os.homedir(), D = __dirname, OBS = path.join(process.env.APPDATA || '', 'obsidian', 'obsidian.json');
const WATCH = [path.join(H, '.claude', 'settings.json'), OBS, path.join(D, 'projects.json'), path.join(D, 'nexus-config.json'), path.join(H, 'Desktop', 'my-game', 'sync_docs.sh'), path.join(H, 'Desktop', 'my-game', 'graphify-out', 'graph.json')];
const snap = () => WATCH.map(f => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') } catch { return 'missing' } });
const NX = ['sync-base', 'sync-locks', 'graphs', 'sync-history.json'].map(f => path.join(D, f)), nx0 = NX.map(f => fs.existsSync(f));
let pass = 0; const fail = [], ok = (c, m) => c ? pass++ : fail.push(m);
const click = sel => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`);
const pick = (name, v) => ev(`(() => { const e = document.querySelector('input[name=${name}][value=${v}]'); if (!e || e.disabled) return false; e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); return true })()`);
const text = () => ev(`(() => { const c = document.body.cloneNode(true); c.querySelector("select")?.remove(); document.body.append(c); c.style.cssText = "position:absolute;left:-9999px;width:1400px"; const t = c.innerText; c.remove(); return t })()`);
(async () => {
  const before = snap();
  let tgt; for (let i = 0; i < 40 && !tgt; i++) { await sleep(250); try { tgt = (await (await fetch('http://127.0.0.1:9335/json/list')).json()).find(t => t.type === 'page') } catch { } }
  ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  ws.onmessage = m => { const j = JSON.parse(m.data); if (j.id && pend[j.id]) { (j.error ? pend[j.id].no : pend[j.id].ok)(j.error || j.result); delete pend[j.id] }
    else if (j.method === 'Runtime.exceptionThrown') errs.push(j.params.exceptionDetails.exception?.description?.split('\n')[0] || j.params.exceptionDetails.text);
    else if (j.method === 'Runtime.consoleAPICalled' && j.params.type === 'error') errs.push(j.params.args.map(a => a.value || a.description).join(' '))
    else if (j.method === 'Network.requestWillBeSent') reqs.push([j.params.request.method, j.params.request.url]) };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await A.cookie(send);
  // sizes: no page overflow, no card overflow, all five sections drawn
  for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 800], [1024, 768]]) {
    await size(w, h); await send('Page.navigate', { url: URL0 + '?p=spooky' }); await sleep(1800);
    const m = await ev(`(() => { const cards = [...document.querySelectorAll('.card')]; return { pw: document.documentElement.scrollWidth, iw: innerWidth, n: cards.length,
      bad: cards.filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.id), cut: [...document.querySelectorAll('.syn-kpi, .syn-a, .btn, h2')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0, 20)),
      tbl: [...document.querySelectorAll('.tbl-wrap')].map(t => t.scrollWidth - t.clientWidth) } })()`);
    ok(m.pw <= m.iw && m.n === 5 && !m.bad.length && !m.cut.length, `${w}x${h}: no overflow (page ${m.pw}/${m.iw}, cards ${m.n}, overflowing cards ${m.bad}, cut text ${m.cut}, table scroll ${m.tbl})`);
    await shot(`spooky-${w}x${h}`, w === 1440);
  }
  await size(1440, 900); await send('Page.navigate', { url: URL0 + '?p=spooky' }); await sleep(1500);
  // preview table: counts, paths, backup + explanations, sync disabled
  let t = await text();
  ok(/Create\s*\n?\s*\d/.test(t) || (await ev(`[...document.querySelectorAll('.syn-kpi b')].map(b => b.textContent).join()`)) === '1,3,5,1,0', 'KPI counts create/update/same/conflict/refused = 1,3,5,1,0');
  ok(await ev(`document.querySelectorAll('#syn-prev tbody tr').length`) === 10 && /Demo Game\\PROJECT_DOCS\.md/.test(t) && /Game Vault\\Demo Game\\Project Docs\.md/.test(t), 'every pair listed with source and destination path');
  ok(/Vault note backed up first/.test(t) && /Project file backed up first/.test(t) && /Both files backed up first/.test(t) && /New note: nothing to back up/.test(t), 'backup status per row');
  ok(['Create', 'Update', 'Unchanged', 'Conflict', 'Refused'].every(k => t.includes(k)) && await ev(`document.querySelectorAll('.syn-legend li').length`) === 5, 'legend explains every action');
  ok(await ev(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Sync now').disabled`), 'Sync now disabled in checkpoint (c)');
  ok(/sync is disabled/i.test(t) && /sample data/i.test(t), 'preview banner says sync disabled + sample data');
  await click('.syn-kpi[data-f=conflict]'); ok((await ev(`[...document.querySelectorAll('#syn-prev tbody .syn-a')].map(e => e.textContent).join()`)) === 'Conflict', 'filter: Conflicts only');
  await click('.syn-kpi[data-f=conflict]'); ok(await ev(`document.querySelectorAll('#syn-prev tbody tr').length`) === 10, 'filter toggles back to all');
  // conflict panel: side by side, never automatic, choice recorded only for this note
  ok(await ev(`document.querySelectorAll('#syn-cfl .syn-pane pre').length`) >= 2 && await ev(`document.querySelectorAll('#syn-cfl .del').length`) > 0 && await ev(`document.querySelectorAll('#syn-cfl .add').length`) > 0, 'conflict panel: both versions with changed lines marked');
  ok(await ev(`!document.querySelector('input[name=res]:checked')`), 'no resolution chosen by default (never automatic)');
  ok(await pick('res', 'vault'), 'choose keep Obsidian version'); ok(/your choice: keep the Obsidian version/.test(await text()), 'choice shown in the preview row');
  await shot('spooky-conflict-chosen');
  // simulate: adds a SIMULATED history row only, no network
  const r0 = reqs.length; await click('[data-a=sim]'); t = await text();
  ok(/SIMULATED/.test(t) && /Simulated only/.test(t) && reqs.length === r0, 'simulate adds a SIMULATED history row, no request');
  // settings + graph source
  ok(await pick('mode', 'manual') && /only when you press Sync/.test(await text()), 'mode Manual explained');
  ok(await pick('mode', 'auto') && /switches this project back to Manual/.test(await text()), 'mode Automatic explained (conflict → Manual)');
  ok(await pick('mode', 'cmd') && await ev(`!!document.querySelector('input[name=cmd]')`), 'custom command field');
  ok(await ev(`document.querySelector('.syn-src').dataset.src`) === 'graphify', 'graph source: Graphify');
  await pick('graph', 'builtin'); ok(await ev(`document.querySelector('.syn-src').dataset.src`) === 'builtin' && /Metadata only/.test(await text()), 'graph source: built-in, cache = metadata only');
  // isolation: each project shows only its own names; state never carried over
  const names = await ev(`Object.fromEntries(SX.data.map(k => [k, SX.names(k)]))`);
  for (const k of Object.keys(names)) {
    await ev(`SX.project(${JSON.stringify(k)})`); await sleep(600); t = await text();
    const own = new Set(names[k]), leak = Object.entries(names).filter(([o]) => o !== k).flatMap(([, n]) => n).filter(n => !own.has(n) && t.includes(n));
    ok(!leak.length, `${k}: no other project's notes or name (${leak.join(', ')})`);
    if (k !== 'spooky') ok(!/SIMULATED/.test(t) && !/your choice:/.test(t), `${k}: no history or choices from another project`);
    await shot('project-' + k, true);
  }
  await ev(`SX.project('arcade')`); t = await text();
  ok(await ev(`document.querySelector('.syn-src').dataset.src`) === 'fallback' && /Graphify not found/.test(t), 'arcade: Graphify missing → built-in fallback notice');
  ok(await ev(`document.querySelector('input[name=mode][value=auto]').disabled`) && /first sync/i.test(t), 'arcade: first sync, Automatic locked until a manual sync');
  ok(/already has this exact text/.test(t) && !/CLAUDE\.md\s*→/.test(t), 'arcade: duplicate-content conflict, CLAUDE.md never paired');
  await click('[data-sel="File Index"]'); ok(/Leave it/.test(await text()) && /Create it anyway/.test(await text()), 'duplicate conflict offers Leave it / Create anyway');
  await ev(`SX.project('spooky')`); ok(/SIMULATED/.test(await text()) && /your choice:/.test(await text()), 'spooky keeps its own state after switching back');
  await ev(`SX.project('racer')`); t = await text(); ok(/No Obsidian vault is linked/.test(t) && await ev(`document.querySelector('.syn-src').dataset.src`) === 'none', 'racer: no vault → empty states, no graph');
  // network + files
  const bad = reqs.filter(([m, u]) => m !== 'GET' || !(u.startsWith('http://127.0.0.1:' + A.PORT + '/preview/') || u.startsWith('data:')));
  ok(!bad.length, 'only GETs for the page files + fonts (' + bad.map(x => x.join(' ')).join(', ') + ')');
  ok(!reqs.some(([, u]) => /\/api\//.test(u)), 'no tracker API call');
  ok(!errs.length, 'no script errors (' + errs.join(' | ') + ')');
  const after = snap(); ok(before.every((h, i) => h === after[i]), 'protected files unchanged (' + WATCH.filter((f, i) => before[i] !== after[i]).join(', ') + ')');
  ok(NX.every((f, i) => fs.existsSync(f) === nx0[i]), 'no NEXUS sync data created');
})().catch(e => fail.push('crash: ' + e.message)).finally(() => { try { ws?.close(); ch.kill() } catch { }
  setTimeout(() => { try { fs.rmSync(PROF, { recursive: true, force: true }) } catch { } console.log(JSON.stringify({ pass, fail, shots: OUT }, null, 1)); process.exit(fail.length ? 1 : 0) }, 800) });
