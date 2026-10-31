var T = {};
(() => {
  const S = window.__setup, $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const w = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, ms = 40000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + f); await w(40) } };
  const cur = () => S.flow[S.i], next = () => $('[data-next]').click(), dis = () => $('[data-next]')?.getAttribute('aria-disabled') === 'true';
  const scen = s => $(`#scen [data-s="${s}"]`).click(), fail = on => { const f = $('#fail'); if (f.checked !== on) f.click() };
  const txt = s => $(s)?.textContent || '';
  const calls = []; const F = window.fetch; window.fetch = (u, o) => { calls.push([(o && o.method) || 'GET', String(u)]); return F(u, o) };
  let pass = 0; const bad = []; const ok = (c, m) => c ? pass++ : bad.push(m);
  const IG = ['obsidian', 'python', 'uv', 'graphify'];
  const toReview = async s => { scen(s); fail(false); await w(50); let n = 0; while (cur() !== 'review' && n++ < 12) next(); };
  const stats = () => $$('.stat b').map(b => +b.textContent);
  const setIn = (id, v) => { const e = $('#' + id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })) };
  const kinds = () => $$('.tg b .badge.dim').map(b => b.textContent);
  const integ = async s => { scen(s); fail(false); await w(30); $('[data-act-integ]').click() };

  T.overflow = async () => { const o = []; scen('this'); await w(50); for (let n = 0; n < 9; n++) { const b = $('#body'); if (b.scrollWidth > b.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1) o.push(cur()); if (n < 8) next() } return o.length ? o : 'none' };
  T.goto = async n => {
    if (n === 'welcome') { scen('this'); return }
    if (['location', 'claude', 'obsidian', 'graphify', 'review'].includes(n)) { await toReview('this'); while (cur() !== n) $('[data-back]').click(); return }
    if (n === 'review-new') { await toReview('new'); return }
    if (n === 'obsidian-mnew') { await integ('mnew'); return }
    if (n === 'progress') { await toReview('this'); next(); await w(2600); return }
    if (n === 'error' || n === 'rollback' || n === 'done-rb') { await toReview('this'); fail(true); next(); await until(() => S.prog?.err); if (n === 'error') return; $('[data-alt]').click(); if (n === 'rollback') { await w(450); return } await until(() => cur() === 'done'); return }
    if (n === 'done') { await toReview('this'); next(); await until(() => cur() === 'done'); return }
    if (n === 'uninstall-new') { scen('mnew'); await w(50); $('[data-act="uninstall"]').click(); next(); $('[data-deldata]').click(); return }
  };

  window.runAll = async () => {
    // A: this PC, connect existing
    scen('this'); await w(50);
    ok($('svg.logo') && $$('svg.logo polygon').length >= 3, 'A logo');
    ok(/Existing NEXUS found/.test(txt('.body')), 'A existing note');
    next(); ok(S.c.type === 'adopt', 'A adopt default'); next();
    ok(cur() === 'location' && $$('.fmap .card').length === 3 && !$('.note.err'), 'A location map');
    next(); next(); ok(cur() === 'claude' && $$('.feat .card').length === 3 && /no change/.test(txt('.diff')), 'A claude adopt');
    next(); ok(cur() === 'obsidian', 'A obsidian step'); next(); ok(cur() === 'graphify', 'A graphify step'); next(); next(); ok(cur() === 'review', 'A at review');
    ok($$('ol.rv.num li').length >= 4 && $$('.rv .pth').length >= 3 && !$('.rv li > span.dim.mono'), 'A review rows');
    ok($$('.rv li').every(li => { const t = li.querySelector('.tx > div'), p = li.querySelector('.pth'); return !p || p.offsetTop > t.offsetTop }), 'A path below title');
    ok(/simulation/i.test(txt('.ft .hint')), 'A review sim hint');
    ok($$('.pvt .pr').length === 6 && /third party/.test(txt('.pvt')) && /None · 127\.0\.0\.1 only/.test(txt('.pvt')), 'A privacy table');
    next(); await w(30); const n = S.prog.tasks.length;
    ok($$('.tasks .kind.real').length === 1 && $$('.tasks .kind:not(.real)').length === n - 1 && S.prog.tasks[0].real, 'A SIM/REAL tags');
    const smp = []; while (cur() === 'progress') { smp.push(parseInt(txt('.ring .pc b'))); await w(90) }
    ok(smp.every((v, i) => !i || v >= smp[i - 1]), 'A pct monotonic ' + smp.join(','));
    ok(new Set(smp).size > n + 2, 'A partial progress (' + new Set(smp).size + ' values, ' + n + ' steps)');
    ok(S.prog.tasks[0].sub.includes('components found'), 'A real step result');
    ok(cur() === 'done' && /nothing was installed/.test(txt('.simtag')) && txt('.done h1') === 'Install simulation complete', 'A done sim text');
    ok(JSON.stringify(stats()) === JSON.stringify([n - 1, 1, 0]), 'A stats ' + stats());
    ok(txt('[data-next]').includes('Finish preview') && txt('[data-alt]').includes('Run again'), 'A done buttons');
    ok(/Settings › Integrations/.test(txt('.sc .done')), 'A integrations-later note');
    $('[data-alt]').click(); ok(cur() === 'welcome', 'A run again');
    // B: simulated new PC
    scen('new'); await w(50); next();
    ok($('[data-type="adopt"]').getAttribute('aria-disabled') === 'true' && S.c.type === 'new', 'B adopt disabled'); next();
    const prog = S.c.prog; setIn('f-prog', 'C:\\Program Files\\NEXUS'); ok($('.note.err') && dis(), 'B admin path rejected');
    setIn('f-prog', prog); setIn('f-data', prog + '\\data'); ok(/outside the program/.test(txt('.note.err')) && dis(), 'B data in program rejected');
    setIn('f-data', '%APPDATA%\\NEXUS'); ok(!$('.note.err') && !dis(), 'B paths ok'); next();
    ok(S.real.deps.filter(x => !IG.includes(x.id)).length - 1 === $$('.dep.miss').length && IG.every(i => !$(`[data-row="${i}"]`)), 'B missing deps, integrations not on Components');
    next(); next(); ok(cur() === 'obsidian', 'B obsidian step');
    ok(/Obsidian is not installed/.test(txt('.body')) && $('[data-obs="skip"]').getAttribute('aria-checked') === 'true' && S.c.dep.obsidian === 'skip' && !dis(), 'B obsidian missing: explained, Skip default');
    $('[data-obs="use"]').click(); ok(S.c.dep.obsidian === 'auto' && /No vaults found/.test(txt('.body')) && dis(), 'B obsidian use: install auto, needs a vault');
    $('[data-dep="obsidian"][data-v="manual"]').click(); ok(S.c.dep.obsidian === 'manual', 'B obsidian manual'); $('[data-dep="obsidian"][data-v="auto"]').click();
    $('[data-obscreate]').click(); ok($('#f-cpath') && $('[data-obsok]') && dis(), 'B create: confirm gate');
    for (const p of ['C:\\', '%USERPROFILE%\\.claude\\x', 'notes\\x']) { setIn('f-cpath', p); ok($('.note.err') && dis() && !$('[data-obsok]'), 'B create rejects ' + p) }
    setIn('f-cpath', '%USERPROFILE%\\Documents\\NEXUS Vault'); ok(!$('.note.err') && dis(), 'B valid path still unconfirmed');
    $('[data-obsok]').click(); ok(S.c.obs.ok && !dis(), 'B confirm unlocks');
    setIn('f-cpath', '%USERPROFILE%\\Documents\\NEXUS Vault 2'); ok(!S.c.obs.ok && dis(), 'B path edit resets confirm');
    $('[data-obsok]').click(); next();
    ok(cur() === 'graphify' && S.c.gfy.mode === 'builtin' && !dis(), 'B graphify default built-in');
    $('[data-gmode="graphify"]').click(); ok(S.c.dep.graphify === 'auto' && S.c.dep.uv === 'auto', 'B graphify install selects uv');
    $('[data-dep="uv"][data-v="manual"]').click(); ok(S.c.dep.graphify === 'manual', 'B uv manual moves graphify to manual');
    $('[data-dep="graphify"][data-v="auto"]').click(); ok(S.c.dep.uv === 'auto', 'B graphify auto re-selects uv');
    ok($$('[data-gscope]').length === 1 && kinds()[0] === 'Vault' && dis(), 'B created vault offered, off by default');
    $('[data-gscope]').click(); ok(!dis(), 'B scope on unlocks');
    setIn('f-gdir', '%APPDATA%\\x'); $('[data-gadd]').click(); ok(/off limits/.test(S.c.gfy.ferr), 'B add folder rejects app folder');
    next(); next(); ok(cur() === 'review', 'B at review');
    ok($$('.pvt .pr').length === 6 && /1 folder you allowed/.test(txt('.pvt')) && /1 vault you confirmed/.test(txt('.pvt')), 'B privacy table rows');
    ok(/Graphify is a third-party tool/.test(txt('.consent')) && dis(), 'B consent gate names Graphify third party'); $('[data-consent]').click(); ok(!dis(), 'B consent unlocks');
    next(); await w(30); ok(!S.prog.tasks.some(t => t.real) && S.prog.tasks.some(t => t.t === 'Install Graphify') && S.prog.tasks.some(t => /^Create vault/.test(t.t)), 'B tasks: no real step, Graphify + vault');
    await until(() => cur() === 'done'); ok(stats()[1] === 0 && /none/.test(txt('.stat.real small')) && !S.c.fallback, 'B done real=0');
    // C: Graphify soft fail (fallback), then hard fail, then Retry
    scen('new'); fail(false); await w(30); while (cur() !== 'graphify') next();
    $('[data-gmode="graphify"]').click(); setIn('f-gdir', '%USERPROFILE%\\Documents\\Game'); $('[data-gadd]').click(); ok(!dis(), 'C added folder on');
    while (cur() !== 'review') next(); $('[data-consent]').click(); fail(true); next(); await until(() => S.prog?.err);
    ok($('.tasks li.warn') && S.c.fallback && /fallback/.test(txt('.tasks li.warn')), 'C Graphify soft fail shows fallback');
    ok(/Step \d+ of \d+ failed/.test(txt('.note.err')) && $('.rail li.err') && $('.ring.err') && $('.tasks li.bad'), 'C hard fail UI');
    ok(txt('[data-next]').includes('Retry') && txt('[data-alt]').includes('Roll back'), 'C buttons');
    next(); await until(() => cur() === 'done'); ok(txt('.done h1') === 'Install simulation complete' && /built-in graph/.test(txt('.sc .done')), 'C retry completes with fallback note');
    fail(false);
    // D: failure + rollback (this PC: real step must not be "undone")
    await toReview('this'); fail(true); next(); await until(() => S.prog?.err); const fi = S.prog.done;
    $('[data-alt]').click(); await w(60); ok($('.ring.rb') && $('.note.warn'), 'D rollback UI');
    await until(() => cur() === 'done'); const ts = S.prog.tasks;
    ok(S.c.rolled && ts.slice(fi + 1).every(t => t.s === 'skip') && ts[fi].s === 'bad' && ts.slice(1, fi).every(t => t.s === 'rb'), 'D task states');
    ok(ts[0].sub === 'read-only, nothing to undo', 'D real step not undone');
    ok(txt('.done h1') === 'Install rolled back' && /undone · 1 failed/.test(txt('.stat small')) && /nothing was installed/.test(txt('.simtag')), 'D done text');
    fail(false);
    // E: maintenance, this PC
    for (const a of ['update', 'repair']) { scen('mthis'); await w(30); $(`[data-act="${a}"]`).click(); next(); next(); await until(() => cur() === 'done'); ok(txt('.done h1') === a[0].toUpperCase() + a.slice(1) + ' simulation complete', 'E ' + a) }
    scen('mthis'); await w(30); $('[data-act="uninstall"]').click(); next(); ok(!$('.dz') && /No data deletion offered/.test(txt('.body')), 'E adopt uninstall keeps data');
    next(); ok($('[data-modal]'), 'E uninstall modal'); $('[data-m="yes"]').click(); await until(() => cur() === 'done'); ok(txt('.done h1') === 'Uninstall simulation complete', 'E uninstall');
    scen('mthis'); await w(30); $('[data-act-restore]').click(); ok(cur() === 'mrestore', 'E restore screen'); next(); $('[data-m="yes"]').click(); await until(() => cur() === 'done'); ok(txt('.done h1') === 'Restore simulation complete', 'E restore');
    // F: new layout uninstall with data delete gate
    scen('mnew'); await w(30); $('[data-act="uninstall"]').click(); next(); ok($('.dz') && !$('[data-typed]'), 'F delete off by default');
    $('[data-deldata]').click(); const ty = $('[data-typed]'); ok(ty && dis(), 'F typed gate');
    ty.value = 'delete'; ty.dispatchEvent(new Event('input', { bubbles: true })); ok(dis(), 'F lowercase rejected');
    ty.value = 'DELETE'; ty.dispatchEvent(new Event('input', { bubbles: true })); ok(!dis(), 'F DELETE accepted');
    next(); ok(/deleted after a backup/.test(txt('[data-modal]')), 'F modal'); $('[data-m="yes"]').click(); await until(() => cur() === 'done');
    ok(S.prog.tasks.some(t => t.t === 'Back up NEXUS data') && txt('.done h1') === 'Uninstall simulation complete', 'F uninstall run');
    // G: cancel
    scen('this'); await w(30); $('[data-cancel]').click(); ok($('[data-modal]'), 'G cancel modal'); $('[data-m="yes"]').click(); ok(/Nothing was changed/.test(txt('#toast')), 'G cancel toast');
    // I: this PC Obsidian + Graphify (kept vault, existing Graphify reused, scope toggles, Skip drops vaults)
    await T.goto('obsidian'); const cb = $$('[data-vault]');
    ok(cb.length === 1 && cb[0].checked && cb[0].disabled && /kept/.test(txt('.vrow')) && !$('[data-obsok]') && !dis(), 'I kept vault, no confirm needed');
    next(); ok(/Existing Graphify found/.test(txt('.body')) && S.c.gfy.mode === 'graphify' && !$('.dep.miss'), 'I existing Graphify reused');
    const on = $$('[data-gscope]').filter(s => s.getAttribute('aria-checked') === 'true');
    ok(on.length === 1 && /my-game$/.test(on[0].dataset.gscope), 'I existing-graph folder starts on');
    ok(kinds().some(k => /Vault/.test(k)), 'I connected vault offered to Graphify');
    on[0].click(); ok(dis() && /at least one folder/.test(txt('.ft .hint')), 'I all scopes off blocks Next');
    $$('[data-gscope]')[0].click(); ok(!dis(), 'I scope back on');
    $('[data-gmode="builtin"]').click(); ok(/Graphify stays installed/.test(txt('.body')) && !dis(), 'I built-in keeps Graphify installed'); $('[data-gmode="graphify"]').click();
    $('[data-back]').click(); $('[data-obs="skip"]').click(); next(); ok(!kinds().some(k => /Vault/.test(k)), 'I Obsidian Skip removes vaults from Graphify');
    // J: maintenance new layout, integrations only
    await integ('mnew'); ok(cur() === 'obsidian' && S.flow.join() === 'mwelcome,obsidian,graphify,review,progress,done' && /Integrations/.test(txt('.eyebrow')), 'J integ flow');
    const vb = $$('[data-vault]'); ok(vb.length === 4 && vb.filter(c => c.disabled).length === 2 && !vb.some(c => c.checked) && dis(), 'J 4 vaults, 2 disabled, none pre-selected');
    ok(/no \.obsidian folder/.test(txt('.vl')) && /Folder not found/.test(txt('.vl')), 'J invalid vault reasons');
    setIn('f-vault', '%USERPROFILE%\\Documents\\Work Notes'); $('[data-vadd]').click(); ok(/Already listed/.test(S.c.obs.berr), 'J duplicate browse rejected');
    setIn('f-vault', 'C:\\'); $('[data-vadd]').click(); ok(/whole drive/.test(S.c.obs.berr), 'J drive browse rejected');
    setIn('f-vault', '%USERPROFILE%\\Documents\\Extra Vault'); $('[data-vadd]').click(); ok(!S.c.obs.berr && $$('[data-vault]').length === 5 && /not checked/.test(txt('.confirm')) && dis(), 'J browse adds vault, not checked, confirm needed');
    $('[data-vault]').click(); $('[data-obsok]').click(); ok(!dis() && $$('.confirm li').length === 2, 'J confirm 2 vaults');
    next(); ok(cur() === 'graphify' && S.c.gfy.mode === 'builtin' && !dis(), 'J graphify built-in (not installed)');
    next(); ok(txt('h1') === 'Ready to apply' && $$('.pvt .pr').length === 6 && !$('[data-consent]'), 'J review');
    next(); await until(() => cur() === 'done'); ok(txt('.done h1') === 'Integration setup simulation complete' && S.prog.tasks.some(t => t.t === 'Link 2 vaults in NEXUS data'), 'J run to done');
    // K: maintenance this PC, integrations: done, then hard fail at save + retry
    await integ('mthis'); ok(cur() === 'obsidian' && !dis(), 'K obsidian kept'); next(); ok(!dis(), 'K graphify reused'); next(); ok(txt('h1') === 'Ready to apply', 'K review');
    next(); await until(() => cur() === 'done'); ok(txt('.done h1') === 'Integration setup simulation complete' && S.prog.tasks.some(t => t.t === 'Save Graphify access list'), 'K done');
    await integ('mthis'); next(); next(); fail(true); next(); await until(() => S.prog?.err); ok(S.prog.tasks[S.prog.done].t === 'Save integration settings', 'K hard fail at save');
    next(); await until(() => cur() === 'done'); ok(txt('.done h1') === 'Integration setup simulation complete', 'K retry completes'); fail(false);
    // H: network: only GET /api/setup/detect
    ok(calls.length > 0 && calls.every(([m, u]) => m === 'GET' && u.startsWith('/api/setup/detect')), 'H only read-only GETs ' + calls.length);
    scen('this');
    return { pass, fail: bad };
  };
})();
