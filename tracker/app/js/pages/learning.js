// Learning Lab: learned rules, user experiments (start / pause / stop with rollback), results and history. Real tracker data only:
// no quality score, no invented savings. A result counts as a success only when the tracker's own test says "verified".
import { optim, OTYPES } from '../data.js';
import { tok, esc, chip, ago, dur, sum } from '../fmt.js';
import { icon, stateBox, kpi, setKpi, toast, donut, download, seg, MORE, more, errBox } from '../ui.js';
import { act, poll, retryText } from '../api.js';


// Experiment categories the user picks from → the problem type whose startup tip is tested.
const CATS = [['oversized', 'Token efficiency', 'i-db'], ['reread', 'Context management', 'i-book'], ['rebuild', 'Caching', 'i-layers'], ['dup', 'Tool usage', 'i-flow'], ['skilldup', 'Skill optimization', 'i-puzzle']];
const CAT = Object.fromEntries(CATS.map(([k, n, ic]) => [k, { n, ic }]));
const TCOL = { rebuild: '#5AB8F2', oversized: '#F2B544', reread: '#31D67A', dup: '#A2F7C5', skilldup: '#C48BFF' };
const NEED = 5; // sessions each side before the tracker judges a tip (tracker.js effect())
const RES = { ok: ['Success', 'ok'], partial: ['Below goal', 'est'], none: ['No improvement', 'warn'], data: ['Collecting data', 'unk'] };
// M7d D3: Learn More, checked against tracker.js (tip learning, effect(), act()) and data.js tipState.
const IMP = { privacy: 'Stays on this PC', load: 'None' };
Object.assign(MORE, {
  'lx-rules': { area: 'Learning', title: 'Learned rules (startup tips)', what: 'A rule is a short startup tip. The tracker learns one when the same waste type shows up in 2+ of your last 10 sessions and is over ~500 est. tokens; at most 5 load at a time, plus the tip of each running experiment. The tips go into tips.txt and the SessionStart hook (tracker.js boot) adds them to the start of every new Claude session.',
    when: ['Seeing which tips Claude gets at startup.', 'Turning off a tip you do not want.'], impact: { tokens: 'A few lines of context in each new session (measured per session as tip tokens)', files: 'Tracker state and tips.txt only', ...IMP },
    notes: ['Switch off: the tip stops loading (retired). Switch on: it gets a fresh test, judged only on new sessions.', 'While automatic optimization is paused (Optimizations), no tips load, even if a switch shows on.', 'When automatic optimization is on, a tip whose test shows "no clear effect" is turned off automatically. A running experiment keeps its tip.'],
    tech: 'tracker.js: learned when a type is seen in 2+ of the last 10 sessions and est. waste > threshold; tips.txt written each tick (empty while autoOff); boot prints it at SessionStart. tipTok = tip context tokens per session.' },
  'lx-exp': { area: 'Learning', title: 'Experiments', what: 'An experiment forces one startup tip on and measures it against your own sessions from before tips (same projects, up to 30). Only one experiment per category can run at a time; the goal is 10–90 % less est. waste.',
    when: ['Testing whether a tip really cuts waste for you.'], impact: { tokens: 'No Claude API calls. The tip adds a few lines to each new session (tip tokens)', files: 'Tracker state and tips.txt only', ...IMP },
    notes: [`It is judged after ${NEED}+ sessions with the tip and ${NEED}+ baseline sessions.`, '"Verified" means est. waste per 100K tokens fell 25 % or more AND occurrences fell. Success also needs your goal to be met.', 'Pause holds the tip back; data so far is kept. Stop saves the result and restores the tip\'s earlier state (asks to confirm).'],
    tech: 'POST /api/act {"a":"exp","op":"new|pause|resume|stop"}. tracker.js effect(): baseline = pre-tip sessions, same projects, ≤30.' },
  'lx-verdict': { area: 'Learning', title: 'Results', what: 'How each judged test is labelled.',
    when: ['Reading Results Summary and Experiment History.'], impact: { tokens: 'None used', files: 'Nothing changed', ...IMP },
    notes: ['Success: the tracker verified the drop (and your goal was met).', 'Below goal: verified drop, but smaller than your goal.', 'No improvement: no clear effect. Auto-learned tips with this result are turned off when automatic optimization is on.', 'Collecting data: not enough sessions on one side yet.'] },
  'lx-imp': { area: 'Learning', title: 'Estimated Improvement', what: 'The change in ESTIMATED waste per 100K tokens for sessions with tips vs the sessions before tips. Shown only once the tracker\'s test is verified.',
    when: ['A quick check that tips help overall.'], impact: { tokens: 'None used', files: 'Nothing changed', ...IMP },
    notes: ['It is not tokens saved, and response quality is not measured.', 'Occurrence counts are measured; waste size is estimated.', 'Optimizations › Waste Reduction uses a different baseline, so its % can differ.'] },
  'lx-cand': { area: 'Learning', title: 'Candidate Strategies', what: 'Ideas without a running experiment, with the est. waste seen for each in your last 10 sessions.',
    when: ['Picking what to test next.'], impact: { tokens: 'None used', files: 'Nothing changed until you start an experiment', ...IMP },
    notes: ['+ Add only opens the New Experiment dialog. Nothing starts until you press Start Experiment.'] },
  'lx-analyze': { area: 'Learning', title: 'Run Auto-Analysis', what: 'Re-scans your logs and re-judges every test right away. The tracker also does this on its own regularly.',
    when: ['Seeing a result now instead of waiting.'], impact: { tokens: 'None used (no Claude API calls)', files: 'Tracker state only', privacy: 'Stays on this PC', load: 'A short log scan' },
    notes: ['It can retire auto-learned tips with no clear effect, as the normal run does.'], tech: 'POST /api/act {"a":"analyze"} runs one tracker tick.' },
});
// Tracker answers → plain reasons (tracker.js act()).
const WHY = { 'already testing this type': 'An experiment for this category is already running.', 'already active': 'This rule is already on.', 'already retired': 'This rule is already off.', unchanged: 'It was already in that state.', 'unknown action': 'The tracker did not recognise this request (the experiment may already be stopped). The page has been refreshed.' };
let root, last = null, o = null, drawn = '', busy = false, range = 14, rq = '', rcat = 'all', rsort = 'impact', rpage = 0, rper = 5, armed = null;
const $ = id => root?.querySelector('#' + id);
const day = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
const card = (i, ic, title, end, body, cls = '') => `<section class="card ${cls}" style="--i:${i}"><div class="card-h">${icon(ic)}<h2>${title}</h2><div class="end">${end}</div></div>${body}</section>`;
// Tracker test → result key. goal: experiment target (% less est. waste); auto-learned rules have none.
const verdict = (opt, goal) => !opt || /^collecting/.test(opt.status) ? 'data' : /^verified/.test(opt.status) ? (goal && opt.drop < goal ? 'partial' : 'ok') : 'none';
const hyp = (k, goal) => `If Claude gets the “${OTYPES[k].name.toLowerCase()}” tip at startup, est. waste from ${OTYPES[k].cat.toLowerCase()} falls by ${goal}% or more vs your sessions before tips.`;
const impact = opt => opt?.drop == null ? '—' : `${opt.drop > 0 ? '−' : '+'}${Math.abs(opt.drop)}% est. waste`;

export function mount(el) {
  root = el;
  el.innerHTML = `<div class="pg enter">
  <header class="pg-h" style="--i:0">
    <span class="tile-ic pg-ic">${icon('i-flask')}</span>
    <div class="pg-t"><h1>Learning Lab</h1><p>Test ideas, learn what works, and keep only what your own sessions prove.</p></div>
    <div class="end"><button class="btn pri" data-a="new">${icon('i-flask')}New Experiment</button><a class="btn" href="#/optimizations/experiments">${icon('i-chart')}Experiment Details</a></div>
  </header>
  <div class="kpis k5" style="--i:1">${kpi('l-rules', 'i-book', 'Rules Learned')}${kpi('l-done', 'i-flask', 'Experiments Completed')}${kpi('l-act', 'i-gauge', 'Active Experiments')}${kpi('l-pat', 'i-graph', 'Patterns Discovered')}${kpi('l-imp', 'i-arrow-down', 'Estimated Improvement')}</div>
  <div id="l-body"></div>
  <dialog class="lx-dlg" id="l-dlg" aria-labelledby="l-dlg-t"></dialog>
</div>`;
  el.querySelector('.pg').addEventListener('click', e => e.target.closest('button[data-a=retry]') ? poll() : onClick(e));
  el.querySelector('.pg').addEventListener('input', onInput);
  el.querySelector('.pg').addEventListener('change', onInput);
}
export function update(st) {
  if (!root || !st) return; last = st;
  if (!st.r) return void ($('l-body').innerHTML = st.at ? errBox({ title: 'Tracker not reachable', where: 'Learning', what: "NEXUS can't reach its tracker, so no rules or experiments can be shown.", why: "Experiments and tips can't be changed until it answers. Nothing is lost: the tracker keeps its own data.", affected: 'Everything on this page. ' + retryText(),
    steps: ['Make sure the tracker is running: node ~/.claude/token-tracker/tracker.js serve', 'Press Retry now.'], actions: [['retry', 'Retry now', true]], more: ['lx-rules', 'Learned rules'], tech: 'GET /api failed (api.js poll). Retry now runs the same poll once.' }) : stateBox('loading', 'Loading learning data…'));
  const r = st.r, k = r.at + JSON.stringify([r.lab, r.opts, (r.auto || [])[0], r.issues?.length]);
  if (k === drawn || document.querySelector('.lm')) return; drawn = k; o = optim(r); // B75: wait while a Learn More panel is open, so Esc can return focus to its ⓘ
  keep(() => { $('l-body').innerHTML = body(r); kpis(r); chart(r); results(); rules(); history(); });
}
// B75: a new report rebuilds l-body. Refocus the same control (id, else its data-* key, else aria-label), keep the caret and open ⋯ menus.
function keep(fn) {
  const f = document.activeElement, A = ['data-a', 'data-op', 'data-id', 'data-k', 'data-v', 'data-more'];
  const q = root.querySelector('#l-body')?.contains(f) ? (f.id ? '#' + CSS.escape(f.id) : A.filter(a => f.hasAttribute(a)).map(a => `[${a}="${CSS.escape(f.getAttribute(a))}"]`).join('') || (f.getAttribute('aria-label') ? `${f.localName}[aria-label="${CSS.escape(f.getAttribute('aria-label'))}"]` : '')) : '';
  const c = q && f.selectionStart, open = [...root.querySelectorAll('#l-body details[open] > summary')].map(s => s.getAttribute('aria-label'));
  fn();
  for (const l of open) root.querySelector(`#l-body summary[aria-label="${CSS.escape(l)}"]`)?.parentElement.setAttribute('open', '');
  const n = q && !f.isConnected && root.querySelector('#l-body ' + q); if (!n) return;
  n.focus({ preventScroll: true }); if (c != null) try { n.setSelectionRange(c, c) } catch { }
}
export function resize() { if (o && last?.r) chart(last.r); }
export function unmount() { root = null; drawn = ''; }

// ---------- data ----------
const exps = () => o.lab.exps || [];
const running = () => exps().filter(x => x.status !== 'stopped');
// One row per finished-or-running test: user experiments + tips the optimizer learned on its own.
function tests() {
  const mine = exps().map(x => { const opt = x.status === 'stopped' ? x.result : x.live;
    return { id: x.id, k: x.k, who: 'yours', name: CAT[x.k].n, goal: x.goal, opt, res: x.status === 'stopped' ? verdict(opt, x.goal) : 'data', start: x.start, end: x.end || null, status: x.status }; });
  const auto = o.types.filter(t => t.at && t.opt && !exps().some(x => x.k === t.t && x.start <= t.at + 6e4))
    .map(t => ({ id: t.t, k: t.t, who: 'auto', name: t.name, goal: null, opt: t.opt, res: verdict(t.opt), start: t.at, end: t.retiredAt, status: t.state }));
  return [...mine, ...auto].sort((a, b) => (b.end || b.start) - (a.end || a.start));
}
const finished = () => tests().filter(t => t.res !== 'data' && (t.who === 'auto' || t.status === 'stopped'));

function kpis(r) {
  const fin = finished(), ok = fin.filter(t => t.res === 'ok').length, run = running(), all = o.all;
  const pats = (r.issues || []).length, ptypes = new Set((r.issues || []).map(i => i[0].split(':')[0])).size;
  setKpi($('l-rules'), o.learned, n => String(Math.round(n)), `${o.active} in use · ${o.retired} retired`, chip('live', 'Startup tips learned from repeated waste in your own logs, or started by an experiment. Retired = turned off by a test result or by you.'));
  setKpi($('l-done'), fin.length, n => String(Math.round(n)), fin.length ? `${ok} successful (${Math.round(ok / fin.length * 100)}%)` : 'none judged yet', chip('live', `A test is judged after ${NEED}+ sessions with the tip and ${NEED}+ before.`));
  setKpi($('l-act'), run.length, n => String(Math.round(n)), run.length ? `${run.filter(x => x.status === 'running').length} running · ${run.filter(x => x.status === 'paused').length} paused` : 'none running', chip('live', 'Experiments you started that are not stopped.'));
  setKpi($('l-pat'), pats, n => String(Math.round(n)), `${ptypes} problem type${ptypes === 1 ? '' : 's'} · last 10 sessions`, chip('live', 'Distinct waste patterns (type + file/tool) in your last 10 sessions. Top 15 kept.'));
  const v = all && /^verified/.test(all.status);
  setKpi($('l-imp'), v ? all.drop : null, n => v ? `−${Math.round(n)}%` : '—', v ? `est. waste/100K · not token savings or quality` : 'not verified yet', v ? chip('est', `Measured change in ESTIMATED waste per 100K tokens: ${all.n} sessions with tips vs ${all.nBase} before (tracker test: ${all.status}). Occurrence counts are measured; waste size is estimated. This is not a verified token saving, and response quality is not measured. Optimizations › Waste Reduction uses every project as its baseline, so its % can differ.`) + more('lx-imp', 'Estimated Improvement') : chip('unk', all ? all.status : 'No tip test yet.') + more('lx-imp', 'Estimated Improvement'));
}

// ---------- layout ----------
function body(r) {
  const run = running(), free = CATS.filter(([k]) => !run.some(x => x.k === k));
  return `<div class="pgrid r-2-1 enter">
  ${card(2, 'i-chart', 'Experiment Timeline', `<select class="btn" id="l-range" aria-label="Timeline range">${[7, 14, 30].map(d => `<option value="${d}"${d === range ? ' selected' : ''}>Last ${d} days</option>`).join('')}</select>`,
    `<div class="lx-chart" id="l-chart"></div><div class="legend lx-lg"><span><i style="background:var(--primary)"></i>Est. waste per 100K tokens</span><span><i style="background:#5AB8F2"></i>Token usage</span><span><i style="background:var(--warn)"></i>Experiment events</span><span class="off" data-tip="Response quality isn't in your logs, so no score is shown."><i></i>Quality score: not measured</span></div>`, 'glass')}
  ${card(3, 'i-check', 'Results Summary', chip('live', 'Judged tests only. Success = the tracker verified the drop (and your goal was met).') + more('lx-verdict', 'Results'), `<div class="lx-res"><div class="donut-box" id="l-donut"></div><div class="lx-rl" id="l-rl"></div></div>`)}
</div>
<div class="pgrid lx-r3 enter">
  ${card(4, 'i-book', 'Learned Rules', `<label class="field">${icon('i-search')}<input id="l-q" placeholder="Search learned rules…" value="${esc(rq)}" aria-label="Search learned rules"></label>
    <select class="btn" id="l-sort" aria-label="Sort rules">${[['impact', 'Most Impact'], ['sessions', 'Most Sessions'], ['new', 'Newest']].map(([v, t]) => `<option value="${v}"${v === rsort ? ' selected' : ''}>${t}</option>`).join('')}</select>${more('lx-rules', 'Learned rules')}`,
    `${seg([['all', 'All Rules'], ...[...new Set(Object.values(OTYPES).map(x => x.cat))].map(c => [c, c])], rcat, 'tabs chips lx-cats')}<div id="l-rules-l"></div>`)}
  ${card(5, 'i-gauge', 'Active Experiments', chip('live') + more('lx-exp', 'Experiments'), run.length ? `<div class="lx-ax">${run.map(axRow).join('')}</div>` : stateBox('empty', 'No experiments running.', 'Start one with New Experiment or + Add.'))}
  ${card(6, 'i-spark', 'Candidate Strategies', chip('est', 'Waste seen in your last 10 sessions for each idea. Size is estimated; no saving is claimed until a test verifies it.') + more('lx-cand', 'Candidate Strategies'), free.length ? `<div class="lx-cs">${free.map(([k, n, ic]) => { const t = o.types.find(x => x.t === k);
    return `<div class="lx-c" style="--tc:${TCOL[k]}"><span class="o-ic sm">${icon(ic)}</span><div><b>${n}</b><small>${t.waste ? `Potential: ~${tok(t.waste)} est. tokens wasted` : t.n ? `Seen ${t.n}× · size not estimated` : 'Not seen recently'}</small></div><button class="btn sm" data-a="new" data-k="${k}">+ Add</button></div>`; }).join('')}</div>` : stateBox('empty', 'Every idea is being tested.'))}
</div>
<div class="pgrid r-2-1 enter">
  ${card(7, 'i-clock', 'Experiment History', chip('live', 'Your experiments plus tips the optimizer learned on its own. Hover a row for before vs after.') + more('lx-verdict', 'Results'), `<div id="l-hist"></div>`)}
  ${card(8, 'i-bolt', 'Quick Actions', more('lx-analyze', 'Run Auto-Analysis'), `<div class="lx-qa">
    <button class="lx-q" data-a="analyze">${icon('i-bolt')}<span><b>Run Auto-Analysis</b><small>Re-scan logs and re-judge every test</small></span></button>
    <button class="lx-q" data-a="new">${icon('i-flask')}<span><b>Create Experiment</b><small>Test a new idea</small></span></button>
    <button class="lx-q" disabled data-tip="Unavailable until a safe, validated import format exists. Nothing is imported from outside.">${icon('i-arrow-up')}<span><b>Import Rule</b><small>Unavailable: no safe import yet</small></span></button>
    <button class="lx-q" data-a="export">${icon('i-arrow-down')}<span><b>Export Results</b><small>Save experiments and tests as JSON</small></span></button></div>`)}
</div>`;
}

function axRow(x) {
  const L = x.live, n = Math.min(L?.n || 0, NEED), b = Math.min(L?.nBase || 0, NEED), p = Math.round(n / NEED * 100), paused = x.status === 'paused', stop = armed === x.id;
  return `<div class="lx-x${paused ? ' paused' : ''}" style="--tc:${TCOL[x.k]}"><span class="o-ic sm">${icon(CAT[x.k].ic)}</span><div class="lx-xt"><b>${CAT[x.k].n}</b><small data-tip="${esc(hyp(x.k, x.goal))}">Goal: −${x.goal}% est. waste · ${paused ? 'paused' : 'started ' + ago(x.start)}</small>
    <div class="lx-p" data-tip="${esc(`${L?.n || 0} sessions with the tip (need ${NEED}) · ${L?.nBase || 0} baseline sessions (need ${NEED}).${L && !/^collecting/.test(L.status) ? ' Current result: ' + L.status : ''}`)}"><span>${n}/${NEED} tests${b < NEED ? ` · baseline ${b}/${NEED}` : ''}</span><div class="bar"><i style="width:${p}%"></i></div><em>${p}%</em></div></div>
    <div class="lx-xa"><button class="btn sm ghost" data-a="exp" data-op="${paused ? 'resume' : 'pause'}" data-id="${x.id}" data-tip="${paused ? 'Resume: the tip loads again.' : 'Pause: the tip stops loading; data so far is kept.'}">${icon(paused ? 'i-play' : 'i-timer')}${paused ? 'Resume' : 'Pause'}</button>
    <button class="btn sm lx-stop${stop ? ' armed' : ''}" data-a="exp" data-op="stop" data-id="${x.id}" data-tip="Stop: saves the result and restores the tip's state from before the experiment.">${icon('i-x')}${stop ? 'Confirm' : 'Stop'}</button></div></div>`;
}

// ---------- widgets ----------
function results() {
  const fin = finished(), c = k => fin.filter(t => t.res === k).length, ok = c('ok'), rev = c('partial'), no = c('none'), el = $('l-donut');
  if (!fin.length) { el.innerHTML = stateBox('empty', 'No judged tests yet.'); $('l-rl').innerHTML = ''; return; }
  donut(el, [['Successful', ok, 'var(--primary)'], ['Below goal', rev, '#5AB8F2'], ['No improvement', no, 'var(--warn)']], `${Math.round(ok / fin.length * 100)}%`, `success rate<br>${ok} of ${fin.length} tests`);
  $('l-rl').innerHTML = [['Successful', ok, 'var(--primary)', 'Verified drop (and goal met)'], ['Below goal', rev, '#5AB8F2', 'Verified drop but below your goal'], ['No improvement', no, 'var(--warn)', 'No clear effect: auto tips are retired, experiments stopped']]
    .map(([t, v, col, why]) => `<div data-tip="${why}"><i style="background:${col}"></i><span>${t}</span><b>${v}</b><small>${Math.round(v / fin.length * 100)}%</small></div>`).join('');
}

function rules() {
  const el = $('l-rules-l'); if (!el) return;
  const xk = new Set(running().map(x => x.k)), q = rq.toLowerCase();
  let rows = o.types.filter(t => t.at && (rcat === 'all' || t.cat === rcat) && (!q || (t.name + ' ' + t.rule + ' ' + t.cat).toLowerCase().includes(q)));
  rows.sort(rsort === 'new' ? (a, b) => b.at - a.at : rsort === 'sessions' ? (a, b) => (b.opt?.n || 0) - (a.opt?.n || 0) : (a, b) => (b.opt?.drop ?? -1e9) - (a.opt?.drop ?? -1e9));
  const pages = Math.max(1, Math.ceil(rows.length / rper)); rpage = Math.min(rpage, pages - 1);
  const vis = rows.slice(rpage * rper, rpage * rper + rper);
  el.innerHTML = (vis.length ? `<div class="lx-rules">${vis.map(t => { const on = t.state !== 'retired', ex = xk.has(t.t), v = verdict(t.opt), ot = t.opt;
    return `<div class="lx-r" style="--tc:${TCOL[t.t]}"><span class="o-ic sm">${icon(t.ic)}</span><div class="lx-rt"><b>${t.name}</b><small data-tip="${esc(t.rule)}">${esc(t.rule)}</small></div>
      <span class="pill ${v === 'ok' ? 'ok' : v === 'data' ? 'unk' : 'est'}" data-tip="${esc(ot ? `${ot.status}. Waste per 100K tokens ${tok(ot.before)} → ${tok(ot.after)} (estimated).` : 'Not tested yet.')}">${ot && v !== 'data' ? impact(ot) : 'collecting'}</span>
      <span class="lx-m" data-tip="Sessions that received this tip.">${ot?.n || 0} sessions</span><span class="lx-m">${ago(t.at)}</span>
      <button class="tgl${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="${t.name} rule" ${ex ? 'disabled data-tip="Controlled by a running experiment."' : `data-a="tip" data-k="${t.t}" data-on="${on ? 0 : 1}" data-tip="${o.lab.autoOff && on ? 'Automatic optimization is paused (Optimizations): no tips load. ' : ''}${on ? 'Turn off: the tip stops loading (rule retired).' : 'Turn on: re-test from now; judged only on new sessions.'}"`}><i></i></button>
      <details class="lx-more"><summary aria-label="More for ${t.name}">⋯</summary><div><button data-a="new" data-k="${t.t}"${ex ? ' disabled' : ''}>${icon('i-flask')}Test as experiment</button><a href="#/optimizations/experiments">${icon('i-chart')}View evidence</a></div></details></div>`; }).join('')}</div>`
    : stateBox('empty', o.learned ? 'No rules match.' : 'No rules learned yet.', o.learned ? '' : 'A rule is learned when the same waste shows up in 2+ of your last 10 sessions and is over ~500 est. tokens (up to 5 tips at a time), or when you start an experiment.'))
    + `<div class="lx-pg"><span>${rows.length ? `Showing ${rpage * rper + 1}–${rpage * rper + vis.length} of ${rows.length} rule${rows.length === 1 ? '' : 's'}` : ''}</span>
      <span class="lx-pn"><button class="btn sm ghost" data-a="rp" data-v="${rpage - 1}" ${rpage ? '' : 'disabled'} aria-label="Previous page">‹</button>${Array.from({ length: pages }, (_, i) => `<button class="btn sm ${i === rpage ? 'pri' : 'ghost'}" data-a="rp" data-v="${i}">${i + 1}</button>`).join('')}<button class="btn sm ghost" data-a="rp" data-v="${rpage + 1}" ${rpage < pages - 1 ? '' : 'disabled'} aria-label="Next page">›</button></span>
      <label>Rows per page <select class="btn sm" id="l-per">${[5, 10].map(n => `<option${n === rper ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>`;
}

function history() {
  const el = $('l-hist'), rows = tests();
  if (!rows.length) return void (el.innerHTML = stateBox('empty', 'No experiments yet.'));
  el.innerHTML = `<table class="tbl lx-h"><thead><tr><th>Experiment</th><th>Type</th><th>Result</th><th class="n">Impact</th><th class="n">Duration</th><th class="n">Date</th></tr></thead><tbody>${rows.map(t => { const ot = t.opt, [lbl, k] = t.status === 'running' || t.status === 'paused' ? [t.status === 'paused' ? 'Paused' : 'Running', 'unk'] : RES[t.res];
    return `<tr data-html="1" data-tip="${esc(`<b>${esc(t.name)}</b>${t.goal ? `<br>${esc(hyp(t.k, t.goal))}` : ''}<br>${ot ? `Before: ${tok(ot.before)} est. waste / 100K (${ot.nBase} sessions)<br>After: ${tok(ot.after)} (${ot.n} sessions)<br>Occurrences ${ot.dropOcc == null ? '—' : (ot.dropOcc > 0 ? '−' : '+') + Math.abs(ot.dropOcc) + '%'} (measured)<br>${esc(ot.status)}` : 'No data yet'}`)}">
      <td><b>${esc(t.name)}</b> <small class="muted">${t.who === 'yours' ? 'yours' : 'auto'}</small></td><td>${esc(OTYPES[t.k].cat)}</td><td><span class="chip ${k}">${lbl}</span></td>
      <td class="n ${ot?.drop > 0 && t.res === 'ok' ? 'gd' : ''}">${ot && t.res !== 'data' ? impact(ot) : '—'}</td><td class="n">${dur((t.end || Date.now()) - t.start)}</td><td class="n">${day(t.end || t.start)}</td></tr>`; }).join('')}</tbody></table>`;
}

// Daily est. waste per 100K tokens (recent sessions) + token usage (all days) + experiment events. Each line on its own scale.
function chart(r) {
  const el = $('l-chart'); if (!el) return; const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
  const keyOf = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const keys = Array.from({ length: range }, (_, i) => keyOf(Date.now() - (range - 1 - i) * 864e5));
  const toks = Object.fromEntries((r.days || []).map(d => [d[0], sum(d.slice(1))])), ws = {};
  for (const s of r.sessions || []) { const k = keyOf(new Date(s[2])); (ws[k] ||= [0, 0]); ws[k][0] += s[8] || 0; ws[k][1] += sum(s.slice(4, 8)); }
  const wv = keys.map(k => ws[k]?.[1] ? ws[k][0] / ws[k][1] * 1e5 : null), tv = keys.map(k => toks[k] ?? null);
  const ev = []; for (const t of o.types) { if (t.at) ev.push([t.at, `Rule learned: ${t.name}`]); if (t.retiredAt) ev.push([t.retiredAt, `Rule retired: ${t.name}`]); }
  for (const x of exps()) { ev.push([x.start, `Experiment started: ${CAT[x.k].n}`]); if (x.end) ev.push([x.end, `Experiment stopped: ${CAT[x.k].n}`]); }
  const L = 16, R = 16, T = 14, B = 26, iw = W - L - R, ih = H - T - B, n = keys.length, x = i => L + (n < 2 ? iw / 2 : i / (n - 1) * iw);
  const line = (vals, cls) => { const m = Math.max(1, ...vals.filter(v => v != null)) * 1.15, y = v => T + ih - v / m * ih; let d = '', pts = '';
    vals.forEach((v, i) => { if (v == null) return; d += `${d && vals[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pts += `<circle class="pt ${cls}" cx="${x(i)}" cy="${y(v)}" r="3.5"/>`; });
    const area = cls === 'w' && d ? vals.map((v, i) => v == null ? null : i).filter(i => i != null) : null;
    return (area?.length > 1 ? `<path class="ar" d="${d} L${x(area.at(-1))},${T + ih} L${x(area[0])},${T + ih} Z"/>` : '') + `<path class="ln ${cls}" d="${d}"/>${pts}`; };
  let g = ''; for (let i = 0; i <= 3; i++) g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${T + ih * i / 3}" y2="${T + ih * i / 3}"/>`;
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
  keys.forEach((k, i) => { if ((n - 1 - i) % step === 0) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}">${day(new Date(k + 'T12:00'))}</text>`; });
  const t0 = new Date(keys[0] + 'T00:00').getTime(), span = n * 864e5, ex = t => L + (t - t0) / span * iw;
  const marks = ev.filter(([t]) => t >= t0).map(([t, l]) => `<g class="evm" data-html="1" data-tip="${esc(`<b>${esc(l)}</b><br>${new Date(t).toLocaleString()}`)}"><line x1="${ex(t)}" x2="${ex(t)}" y1="${T}" y2="${T + ih}"/><circle cx="${ex(t)}" cy="${T + 4}" r="5"/></g>`).join('');
  const hw = n < 2 ? iw : iw / (n - 1), hits = keys.map((k, i) => `<rect class="hit" x="${x(i) - hw / 2}" y="${T}" width="${hw}" height="${ih}" data-html="1" data-tip="${esc(`<b>${day(new Date(k + 'T12:00'))}</b><br>Est. waste / 100K tokens: ${wv[i] == null ? 'no session in the recent list' : tok(Math.round(wv[i]))}<br>Token usage: ${tv[i] == null ? 'none' : tok(tv[i])}`)}"/>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}${line(tv, 't')}${line(wv, 'w')}${hits}${marks}</svg>`;
}

// ---------- new-experiment dialog ----------
function openNew(k) {
  const d = $('l-dlg'), busyK = new Set(running().map(x => x.k)), first = (k && !busyK.has(k) ? k : CATS.find(([c]) => !busyK.has(c))?.[0]);
  if (!first) return toast('Every category already has an experiment running. Stop one first.', 'warn');
  d.innerHTML = `<form method="dialog" class="lx-f"><div class="card-h">${icon('i-flask')}<h2 id="l-dlg-t">New Experiment</h2><div class="end"><button class="btn sm ghost" value="x" aria-label="Close">${icon('i-x')}</button></div></div>
    <fieldset><legend>What to test</legend><div class="lx-pick">${CATS.map(([c, nm, ic]) => `<label class="lx-o${busyK.has(c) ? ' dis' : ''}" style="--tc:${TCOL[c]}"><input type="radio" name="k" value="${c}"${c === first ? ' checked' : ''}${busyK.has(c) ? ' disabled' : ''}><span class="o-ic sm">${icon(ic)}</span><span><b>${nm}</b><small>${busyK.has(c) ? 'already running' : OTYPES[c].name}</small></span></label>`).join('')}</div></fieldset>
    <label class="lx-goal">Goal: est. waste lower by <input type="number" name="goal" min="10" max="90" step="5" value="25" required>%</label>
    <dl class="lx-dl" id="l-dl"></dl>
    <div class="lx-fa"><button class="btn ghost" value="x">Cancel</button><button class="btn pri" value="go">${icon('i-play')}Start Experiment</button></div></form>`;
  const f = d.querySelector('form'), fill = () => { const c = f.k.value, g = Math.max(10, Math.min(90, Math.round(+f.goal.value) || 25)), t = o.types.find(x => x.t === c), all = o.all;
    $('l-dl').innerHTML = `<dt>Hypothesis</dt><dd>${esc(hyp(c, g))}</dd><dt>Change made</dt><dd>One startup tip: “${esc(OTYPES[c].rule)}” Tracker state only; no code, plugin, skill or setting is touched.</dd>
      <dt>Baseline</dt><dd>${all?.nBase ?? 0} sessions from before tips (same projects, up to 30). Seen now: ${t.n ? `${t.n}× in your last 10 sessions${t.waste ? `, ~${tok(t.waste)} est. tokens` : ''}` : 'not in your last 10 sessions'}.</dd>
      <dt>Measured by</dt><dd>Est. waste per 100K tokens and measured occurrences, after ${NEED}+ sessions with the tip. Verified only if waste drops ≥25% and occurrences fall; success also needs your ${g}% goal.</dd>
      <dt>Rollback</dt><dd>Stop restores this tip's earlier state. Pause holds the tip back without losing data. No Claude API calls; the tip adds a few lines to each new session (counted as tip tokens).</dd>`; };
  f.addEventListener('change', fill); f.addEventListener('input', fill); fill();
  f.onsubmit = async e => { if (e.submitter?.value !== 'go') return; const g = Math.round(+f.goal.value);
    if (!(g >= 10 && g <= 90)) return toast('Goal must be 10–90%.', 'warn');
    await run({ a: 'exp', op: 'new', k: f.k.value, goal: g }, `Experiment started: ${CAT[f.k.value].n}. Its tip loads from your next session.`); };
  d.showModal();
}

// ---------- events ----------
// What each request does, for error titles ("Couldn't start the experiment").
const OPS = { new: 'start the experiment', pause: 'pause the experiment', resume: 'resume the experiment', stop: 'stop the experiment', analyze: 'run the analysis', tip: 'change the rule' };
async function run(body, okMsg) {
  if (busy) return toast('Still working on the last change. Try again in a moment.', 'warn'); busy = true;
  const what = "Couldn't " + OPS[body.op || body.a];
  try { const res = await act(body); res === 'ok' ? toast(okMsg) : toast(WHY[res] || `The tracker answered: ${res}. Nothing was changed.`, 'err', what); }
  catch (e) { toast(`The tracker didn't answer (${e.message}), so the change may not have arrived. Check the page after the next update, then try again.`, 'err', what + ': tracker not reachable'); }
  busy = false; drawn = ''; update(last);
}
function onClick(e) {
  const cv = e.target.closest('.lx-cats [data-v]'); if (cv) { rcat = cv.dataset.v; rpage = 0; root.querySelectorAll('.lx-cats .tab').forEach(x => { const on = x === cv; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); }); return rules(); }
  const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
  const a = b.dataset.a, k = b.dataset.k;
  if (a !== 'exp') armed = null;
  if (a === 'new') { b.closest('details')?.removeAttribute('open'); return openNew(k); }
  if (a === 'rp') { rpage = +b.dataset.v; return rules(); }
  if (a === 'export') return download(`learning-lab-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exported: new Date().toISOString(), note: 'Waste sizes are estimates; occurrence counts are measured. No quality score is recorded.',
    experiments: exps().map(({ live, ...x }) => ({ ...x, current: live })), tests: o.opts, rules: o.types.filter(t => t.at).map(t => ({ type: t.t, name: t.name, rule: t.rule, learned: t.at, state: t.state, test: t.opt })) }, null, 2), 'application/json');
  if (a === 'analyze') return run({ a: 'analyze' }, 'Analysis finished: every test was re-judged.');
  if (a === 'tip') { const on = b.dataset.on === '1'; return run({ a: 'tip', k, on }, on ? `Rule “${k}” on: fresh test from now.` : `Rule “${k}” off (retired).`); }
  if (a === 'exp') {
    const { op, id } = b.dataset;
    if (op === 'stop' && armed !== id) { armed = id; drawn = ''; update(last); setTimeout(() => { if (armed === id) { armed = null; drawn = ''; update(last); } }, 4000); return; }
    armed = null; return run({ a: 'exp', op, id }, op === 'stop' ? 'Experiment stopped: result saved, tip state restored.' : op === 'pause' ? 'Experiment paused: its tip is held back.' : 'Experiment resumed.');
  }
}
function onInput(e) {
  const t = e.target;
  if (t.id === 'l-q') { rq = t.value; rpage = 0; rules(); }
  else if (t.id === 'l-sort' && e.type === 'change') { rsort = t.value; rules(); }
  else if (t.id === 'l-per' && e.type === 'change') { rper = +t.value; rpage = 0; rules(); }
  else if (t.id === 'l-range' && e.type === 'change') { range = +t.value; chart(last.r); }
}
