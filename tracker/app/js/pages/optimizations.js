// Optimizations command center: 8 subtabs over the tracker's real optimizer data (opts, verify, issues, skadv, audit, advisor, auto, lab).
// Buttons call /api/act: tracker-owned state only (tips, dismissals, pause, re-analysis), logged and reversible. Never plugins, skills or code.
import { optim, sessions, projName } from '../data.js';
import { act, poll, retryText } from '../api.js';
import { tok, esc, chip, ago } from '../fmt.js';
import { icon, seg, stateBox, kpi, setKpi, donut, toast, table, MORE, more as lm, errBox } from '../ui.js';

// M7d D3 Learn More (read-only facts from tracker.js act() / report() / setInterval(tick, 30000))
const RO = { tokens: 'None used', files: 'Nothing changed', privacy: 'Stays on this PC', load: 'None' };
const TR = { tokens: 'None used', files: "Tracker's state.json only (logged, reversible)", privacy: 'Stays on this PC', load: 'One rescan' };
Object.assign(MORE, {
  'op-page': { area: 'Optimizations', title: 'What this page does', what: 'The tracker reads your Claude Code logs, finds repeated token waste (re-reads, oversized outputs, idle re-caching, duplicates) and learns short startup tips that try to cut it. This page shows what it found, what it changed and how each change is measured.',
    when: ['Checking whether the optimizer helps or costs you tokens.'], impact: RO, notes: ['The tracker rescans every 30 s by itself. Run Auto-Analysis only forces a rescan and every accuracy check now.', 'No AI is used and nothing in your projects, plugins or skills is changed from this page.'], tech: 'GET /api (optimizer report) · POST /api/act {a: analyze} → tick(force).' },
  'op-sav': { area: 'Optimizations', title: 'Estimated vs verified savings', what: 'Estimated = fewer measured problems × their size, counted as characters ÷ 4. Verified = a token amount that is itself measured in your usage logs (for example output tokens with vs without a skill). Net = estimated savings minus the text the optimizer itself adds to your sessions.',
    when: ['Reading the savings numbers.'], impact: RO, notes: ['The two are never added together: they use different units.', 'Neither is plan usage or a bill.', 'Verified is often 0 until there are enough sessions with and without on each side.'], tech: 'r.saved.estimated / r.saved.verified / r.audit.net.' },
  'op-act': { area: 'Optimizations', title: 'Optimizations Active', what: 'Active startup tips plus the 3 always-on rules: token self-correction, Context Advisor and Skill Advisor. Retired tips and tips still being watched are not counted.',
    when: ['Seeing what currently runs for you.'], impact: RO, notes: ['Pausing automatic optimization stops the tips; the 3 always-on rules keep running.'], tech: 'o.active + 3 (data.js optim()).' },
  'op-waste': { area: 'Optimizations', title: 'Waste Change and Waste per Session', what: 'Estimated waste per 100K tokens: the baseline is every session before tips existed, compared with the sessions since. Minus means less waste, plus means more. The chart shows the rate per session (newest 25), with the baseline and with-tips lines.',
    when: ['Checking whether waste went up or down.'], impact: RO, notes: ['Waste size is estimated (characters ÷ 4); the problems themselves are counted from your logs.', 'Response quality is not measured.', 'The stricter Learning Lab test uses only same-project sessions and can show a different %.'], tech: 'r.verify.rows (waste row): [metric, baseline, with tips, (with − base) / base × 100].' },
  'op-aud': { area: 'Optimizations', title: 'Data Accuracy Audit', what: 'Checks that re-count your tokens from the raw logs with a second method and compare them with the tracker totals. Verified = both agree; Collecting Data = not enough sessions yet; Needs Attention = they differ.',
    when: ['Deciding whether to trust the numbers on this page.'], impact: RO, notes: ['Wrong totals are corrected automatically, with a backup of the old numbers (History & Rollback → Data Corrections).', 'Run Auto-Analysis re-runs every check now.'], tech: 'r.audit.checks (audit() in tracker.js).' },
  'op-tips': { area: 'Optimizations', title: 'How a startup tip works', what: 'Watching: the waste was seen but not yet in 2+ of the last 10 sessions with over 500 est. tokens. Active: a one-line hint is loaded at each session start. Retired: turned off after 5+ sessions with no clear drop. Re-test turns it back on and judges it only on sessions from then.',
    when: ['Before you retire or re-test a tip.'], impact: TR, notes: ['A tip is a hint only: it never blocks a tool, skips a read or changes code.', 'Retire and Re-test are logged and reversible.'], tech: 'POST /api/act {a: tip, k, on} → st.retired / st.retest.' },
  'op-auto': { area: 'Optimizations', title: 'Automatic optimization', what: 'On: tips are learned, loaded at session start and retired automatically when they do not help. Paused: no tips load and nothing is retired automatically. The accuracy audit and both advisors keep running either way.',
    when: ['Turning the optimizer off for a while.'], impact: TR, notes: ['Saved in the tracker only. Resume brings it back as it was.'], tech: 'POST /api/act {a: auto, on} → st.autoOff.' },
  'op-rec': { area: 'Optimizations', title: 'Recommendations', what: 'Startup tips (learned from repeated waste), your habits (very long sessions, idle gaps) and plugins or skills that cost more than they help. Confidence comes from the amount of evidence; risk says what acting on it could affect.',
    when: ['Choosing what to act on first.'], impact: RO, notes: ['Dismiss only hides a habit recommendation. Restore it any time from History & Rollback.', 'Plugin and skill changes always need your approval and are made on the Plugins page.'], tech: 'o.types, o.recs, r.skadv.items · POST /api/act {a: dismiss, k, on}.' },
  'op-skill': { area: 'Optimizations', title: 'Plugin & Skill Efficiency', what: 'Load cost = text a plugin or skill adds to a session, counted as characters ÷ 4. Keep / Review / Consider removing come from use and cost; Expensive = well above your median. With vs without compares sessions in the same projects.',
    when: ['Finding plugins or skills that cost a lot for little use.'], impact: RO, notes: ['Nothing is installed, removed or changed from here.'], tech: 'r.skadv (Skill Advisor).' },
  'op-exp': { area: 'Optimizations', title: 'How tips are tested', what: 'Baseline = up to 30 sessions before tips existed, in the same projects; candidate = sessions where the tip was really loaded. A tip counts as Worked only with 5+ sessions on each side, at least 25% less est. waste and fewer measured occurrences.',
    when: ['Reading an experiment result.'], impact: RO, notes: ['Net = est. tokens saved minus what the tip text itself costs.', 'Start, pause and stop experiments in Learning Lab.'], tech: 'r.opts (report() in tracker.js).' },
  'op-hist': { area: 'Optimizations', title: 'History & Rollback', what: 'Every change the optimizer or you made: your actions, automatic changes, data fixes, plugin changes seen in ~/.claude and Context Advisor saves. Rollback lists what can be undone: retired tips, dismissed recommendations and a paused optimizer.',
    when: ['Finding out why something changed, or undoing it.'], impact: RO, notes: ['Data corrections are kept: they fixed wrong counts. The backup file holds the old numbers.'], tech: 'r.auto, r.skadv.changes, r.advisor.log.' },
});
const OFF = 'The tracker is not reachable. This works again once it answers.', AB = 'Re-scans your Claude Code logs and re-runs every accuracy check now (normally every 30 s). Uses no AI tokens.';
const FT = { analyze: () => "Couldn't re-scan", tip: on => on ? "Couldn't re-enable the tip" : "Couldn't retire the tip", dismiss: on => on ? "Couldn't dismiss the recommendation" : "Couldn't restore the recommendation", auto: on => on ? "Couldn't resume automatic optimization" : "Couldn't pause automatic optimization" };
const SAME = /^(already active|already retired|unchanged)$/;

const TABS = [['overview', 'Overview'], ['recommendations', 'Recommendations'], ['automatic', 'Automatic'], ['plugins', 'Plugins & Skills'],
  ['experiments', 'Experiments'], ['savings', 'Verified Savings'], ['history', 'History & Rollback'], ['diagnostics', 'Diagnostics']];
const TCOL = { rebuild: '#5AB8F2', oversized: '#F2B544', reread: '#31D67A', dup: '#A2F7C5', skilldup: '#C48BFF' };
const SL = { active: ['ver', 'Active', 'Learned tip, loaded at every session start.'], retest: ['est', 'Re-testing', 'Turned back on: judged only on sessions since then.'],
  retired: ['unk', 'Retired', 'Turned off: no clear drop in its waste. Re-test it any time.'], watching: ['unk', 'Watching', 'Seen, but not yet in 2+ of the last 10 sessions with >500 est. tokens, so no tip yet.'],
  paused: ['est', 'Paused', 'Automatic optimization is paused: no tips are loaded.'] };
const stc = s => `<span class="chip ${SL[s][0]}" data-tip="${esc(SL[s][2])}">${SL[s][1]}</span>`;
const RECT = { long: 'Very long sessions', rebuild: 'Idle gaps re-cache your context', tipsoff: 'Tips cost more than they save' };
let shownEB = '', root, last = null, o = null, tab = 'overview', drawn = '', busy = false, hq = '', hf = 'all', pf = 'all', pq = '', psort = ['cost', -1], ppage = 0, rf = 'all', showDis = false;
const $ = id => root?.querySelector('#' + id);
const full = n => n == null ? '—' : Math.round(n).toLocaleString();
const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const card = (i, ic, title, ch, body, cls = '') => `<section class="card ${cls}" style="--i:${i}"><div class="card-h">${icon(ic)}<h2>${title}</h2><div class="end">${ch}</div></div>${body}</section>`;

export function mount(el, params = []) {
  root = el; tab = TABS.some(t => t[0] === params[0]) ? params[0] : 'overview';
  el.innerHTML = `<div class="pg enter">
  <header class="pg-h" style="--i:0">
    <span class="tile-ic pg-ic">${icon('i-bolt')}</span>
    <div class="pg-t"><h1>Optimizations</h1><p>Where token waste is found, fixed, tested and verified. Real tracker data only.</p></div>
    <div class="end"><span class="muted sm" id="o-at"></span><button class="btn pri" data-a="analyze" data-tip="${AB}">${icon('i-play')}Run Auto-Analysis</button>${lm('op-page', 'What this page does')}</div>
  </header>
  <div id="o-err"></div>
  <nav class="otabs" id="o-tabs" style="--i:1"></nav>
  <div id="o-body"></div>
</div>`;
  el.querySelector('.pg').addEventListener('click', onClick);
  el.querySelector('.pg').addEventListener('input', onInput);
}
export function nav(params = []) { tab = TABS.some(t => t[0] === params[0]) ? params[0] : 'overview'; drawn = ''; update(last); root?.closest('#page')?.scrollTo({ top: 0 }); }
export function update(st) {
  if (!root || !st) return; last = st; const f = focusOf(), down = !st.ok && !!st.at; // B84: a failed poll keeps the old st.r, so st.ok decides
  const eb = down ? errBox({ title: 'Tracker not reachable', where: 'Optimizations', what: "NEXUS can't reach its tracker, so the optimizer data can't update.",
    why: st.r ? `The numbers below are the last data, from ${ago(st.at)}. Changes are off until the tracker is back; tabs, filters and paging still work.` : 'No optimizer data can show until the tracker answers.',
    affected: 'Tips, recommendations, the optimizer switch and Run Auto-Analysis. ' + retryText(), steps: ['Make sure the tracker is running: node ~/.claude/token-tracker/tracker.js serve', 'Press Retry now.'],
    actions: [['retry', 'Retry now', true]], tech: 'GET /api failed. Retry now asks again; otherwise the app asks on its own schedule (Settings → Performance).' }) : '';
  if (eb !== shownEB) $('o-err').innerHTML = shownEB = eb; // B85 wording follows perf.live; rewritten only when it changes
  const ab = root.querySelector('[data-a=analyze]'); if (!busy) ab.disabled = down; ab.dataset.tip = down ? OFF : AB;
  $('o-tabs').innerHTML = seg(TABS.map(([v, t]) => [v, t, '#/optimizations/' + v]), tab);
  if (!st.r) { $('o-body').innerHTML = st.at ? stateBox('error', 'No optimizer data yet.', 'See the message at the top of the page.') : stateBox('loading', 'Loading optimizer data…'); return refocus(f); }
  const r = st.r, k = tab + down + r.at + JSON.stringify([r.lab, r.auto, r.audit?.at]) + [hq, hf, pf, pq, psort, ppage, rf, showDis];
  $('o-at').textContent = down ? `Last data ${ago(st.at)} · tracker not reachable` : `Analysed ${r.audit?.at ? ago(r.audit.at) : r.at}`;
  if (k !== drawn) { drawn = k; o = optim(r);
    $('o-body').innerHTML = `<div class="ob enter">${VIEWS[tab]()}</div>`;
    after(); if (down) root.querySelectorAll('#o-body [data-a=tip], #o-body [data-a=dismiss], #o-body [data-a=auto]').forEach(b => { b.disabled = true; b.dataset.tip = OFF; }); }
  refocus(f);
}
// U3: keep keyboard focus (and the caret) when a poll redraws the tabs or the body
function focusOf() { const a = document.activeElement; if (!a || !root.contains(a)) return null;
  const s = a.id ? '#' + a.id : a.dataset.a ? `[data-a="${a.dataset.a}"]${a.dataset.k != null ? `[data-k="${CSS.escape(a.dataset.k)}"]` : ''}` : a.getAttribute('href') ? `[href="${a.getAttribute('href')}"]` : null;
  return s && { s, a, p: typeof a.selectionStart === 'number' ? a.selectionStart : null }; }
function refocus(f) { if (!f || f.a.isConnected) return; const n = root?.querySelector(f.s); if (!n) return; n.focus(); if (f.p != null) n.setSelectionRange?.(f.p, f.p); }
const S = c => last.ok ? c : chip('unk', `Last data from ${ago(last.at)}: the tracker is not reachable.`); // E2 stale KPIs
export function resize() { if (tab === 'overview' && o) wchart(); }
export function unmount() { root = null; drawn = ''; }

// ---------- actions ----------
async function onClick(e) {
  const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
  const a = b.dataset.a, k = b.dataset.k, on = b.dataset.on === '1';
  if (a === 'retry') return void poll();
  // B86: filters, paging and links work while an action is still running
  if (a === 'hf' || a === 'pf' || a === 'rf') { ({ hf: () => hf = k, pf: () => (pf = k, ppage = 0), rf: () => rf = k })[a](); return update(last); }
  if (a === 'dis') { showDis = !showDis; return update(last); }
  if (a === 'pp') { ppage = +k; return update(last); }
  if (a === 'go') return void (location.hash = k);
  if (!FT[a]) return;
  if (busy) return toast('Still working on the last action. Try again in a moment.', 'warn', 'Busy');
  if (!last?.ok) return toast(OFF, 'warn');
  busy = true; b.disabled = true; b.classList.add('busy');
  const MSG = { analyze: 'Analysis finished: logs re-scanned and all checks re-run. No AI, no tokens.', tip: on ? `Tip "${k}" re-enabled. It is judged only on sessions from now.` : `Tip "${k}" retired. Re-test it any time.`,
    dismiss: on ? 'Recommendation dismissed.' : 'Recommendation restored.', auto: on ? 'Automatic optimization resumed.' : 'Automatic optimization paused. No tips load until you resume.' };
  try { const res = await act({ a, k, on }); res === 'ok' ? toast(MSG[a]) : SAME.test(res) ? toast('Already done: the page was a step behind and is now up to date.', 'warn') // B87
    : toast('The tracker did not accept this change, so nothing was changed. Press Run Auto-Analysis, then try again.', 'err', FT[a](on)); }
  catch { toast('Tracker not reachable, so nothing was changed. Start it with node ~/.claude/token-tracker/tracker.js serve, then try again.', 'err', FT[a](on)); }
  busy = false; b.disabled = false; b.classList.remove('busy'); drawn = ''; update(last); // header buttons are not re-rendered
}
function onInput(e) {
  if (e.target.id === 'h-q') { hq = e.target.value; keepFocus('h-q'); }
  if (e.target.id === 'p-q') { pq = e.target.value; ppage = 0; keepFocus('p-q'); }
}
function keepFocus(id) { const p = $(id).selectionStart; update(last); const i = $(id); i.focus(); i.setSelectionRange(p, p); }
const tipBtn = x => x.state === 'retired' ? `<button class="btn sm" data-a="tip" data-k="${x.t}" data-on="1" data-tip="Turn this tip back on. It is judged only on sessions from now and retired again automatically if 5 sessions show no clear drop.">${icon('i-undo')}Re-test</button>`
  : x.state === 'active' || x.state === 'retest' ? `<button class="btn sm ghost" data-a="tip" data-k="${x.t}" data-on="0" data-tip="Stop loading this tip at session start. Reversible: Re-test brings it back.">${icon('i-x')}Retire</button>` : '';
const tgl = on => `<button class="tgl${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="Automatic optimization" data-a="auto" data-on="${on ? 0 : 1}" data-tip="${on ? 'Pause: no tips load and nothing is retired automatically. Data accuracy checks keep running.' : 'Resume automatic optimization.'}"><i></i><span>${on ? 'ON' : 'OFF'}</span></button>`;

// ---------- Overview ----------
function overview() {
  const r = last.r, sv = r.saved || {}, w = o.wasteRow, net = r.audit?.net, on = !o.lab.autoOff;
  const opp = [...o.types].filter(x => x.waste || x.at).sort((a, b) => b.waste - a.waste).slice(0, 5);
  return `<div class="kpis k4" style="--i:2">
  ${kpi('o-sav', 'i-db', 'Est. Tokens Saved ' + lm('op-sav', 'Estimated vs verified savings'))}${kpi('o-act', 'i-check', 'Optimizations Active ' + lm('op-act', 'Optimizations Active'))}${kpi('o-waste', 'i-gauge', 'Waste Change ' + lm('op-waste', 'Waste Change'))}
  <a class="kpi-link" href="#/optimizations/diagnostics" data-tip="Open the full audit in Diagnostics">${kpi('o-aud', 'i-shield', 'Data Accuracy Audit')}</a>
</div>
<div class="pgrid r-2-1 enter">
  ${card(3, 'i-chart', 'Waste per Session ' + lm('op-waste', 'Waste per Session'), chip('est', 'Estimated waste ÷ session tokens × 100K, per session (newest 25). Waste size = chars ÷ 4; the problems themselves are counted from your logs.'), `
    <div class="wchart" id="o-chart"></div>
    <div class="legend"><span><i style="background:var(--primary)"></i>Below your baseline</span><span><i style="background:var(--warn)"></i>Above baseline</span>
    <span><i class="ln dash"></i>Baseline ${w ? tok(w[1]) : '—'} (before tips)</span><span><i class="ln"></i>With tips ${w ? tok(w[2]) : '—'}</span></div>`, 'glass')}
  ${card(4, 'i-layers', 'Where Waste Comes From', chip('est', 'Estimated waste by problem type, last 10 sessions.'), o.waste ? `
    <div class="brk-wrap"><div class="donut-box" id="o-donut"></div><div class="brk-list">${o.types.filter(x => x.waste).sort((a, b) => b.waste - a.waste).map(x =>
      `<div class="bl"><span class="sw" style="background:${TCOL[x.t]}"></span><span>${x.name}</span><b>${tok(x.waste)}</b><small>${Math.round(x.waste / o.waste * 100)}%</small></div>`).join('')}</div></div>`
    : stateBox('empty', 'No waste found in the last 10 sessions.'), 'glass')}
</div>
<div class="pgrid r-ov enter">
  ${card(5, 'i-spark', 'Top Opportunities ' + lm('op-tips', 'How a startup tip works'), `<a class="btn sm ghost" href="#/optimizations/recommendations">View All</a>`, opp.length ? `<div class="opps">${opp.map(x => `
    <div class="opp"><span class="o-ic" style="--tc:${TCOL[x.t]}">${icon(x.ic)}</span>
      <div class="o-t"><b>${x.name}</b><small>${esc(x.rule)}</small></div>
      <div class="o-v"><b>${tok(x.waste)}</b><small>est. tokens · ${x.sessions} sess.</small></div>
      <div class="o-a">${stc(x.state)}${tipBtn(x)}</div></div>`).join('')}</div>` : stateBox('empty', 'Nothing to optimize yet.'))}
  ${card(6, 'i-check', 'Recent Activity', `<a class="btn sm ghost" href="#/optimizations/history">View All</a>`, logList(o.log.slice(0, 6)))}
  ${card(7, 'i-gear', 'Auto-Optimization ' + lm('op-auto', 'Automatic optimization'), tgl(on), `
    <p class="muted sm" style="margin:0 0 10px">${on ? 'Only proven, low-risk, reversible changes: startup hints that never block a tool or skip work.' : 'Paused. No tips load at session start and nothing is retired automatically.'}</p>
    <div class="rules-s">${RULES().map(x => `<div class="rs${x.on ? ' on' : ''}">${icon(x.on ? 'i-check' : 'i-x')}<span>${x.name}</span><small>${x.short}</small></div>`).join('')}</div>
    <div class="scope"><span class="k">Safety level</span><b>Conservative</b><small>fixed: the tracker has no riskier level</small></div>`)}
</div>
${card(8, 'i-layers', 'Optimization Categories', `<span class="muted sm">${net ? `Net effect: <b class="${net.net >= 0 ? 'up' : 'down'}">${net.net >= 0 ? '+' : '−'}${tok(Math.abs(net.net))}</b> est. after optimizer overhead` : ''}</span>`,
  `<div class="cats">${o.types.map(x => `<a class="cat" href="#/optimizations/diagnostics" style="--tc:${TCOL[x.t]}"><span class="o-ic">${icon(x.ic)}</span>
    <div><b>${x.cat}</b><small>${x.n} found · ${x.sessions} sess.</small><span class="cpill">${x.waste ? tok(x.waste) + ' est.' : x.n ? '<span data-tip="Found, but its token size is not estimated (e.g. image reads have no text to count).">size not estimated</span>' : 'no waste'}</span></div>${stc(x.state)}</a>`).join('')}</div>`)}`;
}
function overviewAfter() {
  const r = last.r, sv = r.saved || {}, w = o.wasteRow, tips = o.types.filter(x => x.at);
  setKpi($('o-sav'), sv.estimated, tok, `net ${tok(r.audit?.net?.net)} after optimizer cost`, S(chip('est', 'Verified fewer problems × estimated size (chars ÷ 4). Verified token-for-token savings: ' + tok(sv.verified || 0) + '.')));
  setKpi($('o-act'), o.active + 3, n => String(Math.round(n)), `${o.active} tip${o.active === 1 ? '' : 's'} · 3 always-on checks · ${o.retired} retired`, S(chip('live', 'Active tips plus the 3 always-on rules (token self-correction, Context Advisor, Skill Advisor).')));
  const wd = w?.[3] == null ? 'not enough sessions' : w[3] === 0 ? 'no change in est. waste' : `${Math.abs(w[3])}% ${w[3] > 0 ? 'more' : 'less'} est. waste`; // M2: minus = less waste
  setKpi($('o-waste'), w?.[3] == null ? null : Math.abs(w[3]), n => (w[3] > 0 ? '+' : w[3] < 0 ? '−' : '') + Math.round(n) + '%', w ? `${wd} · per 100K: ${tok(w[1])} → ${tok(w[2])}` : 'not enough sessions', w ? S(chip('est', `${w[3] > 0 ? 'Waste went UP' : w[3] < 0 ? 'Waste went DOWN' : 'No change'}. Change in ESTIMATED waste per 100K tokens. Baseline: all ${r.verify.base} sessions before tips (every project). With tips: ${r.verify.seen} sessions. Not a verified token saving; response quality is not measured. The stricter tip test (Learning Lab) uses only same-project sessions and can show a different %: ${o.all?.status || 'no result yet'}.`)) : S(chip('unk')));
  setKpi($('o-aud'), o.pass, n => `${Math.round(n)}/${o.checks.length}`, `checks verified · ${r.audit?.at ? ago(r.audit.at) : '—'}`, S(o.checks.length ? chip('live', o.checks.map(c => `${c.status}: ${c.name}`).join(' · ')) : chip('unk')));
  if (o.waste) donut($('o-donut'), o.types.filter(x => x.waste).map(x => [x.name, x.waste, TCOL[x.t]]), tok(o.waste), 'est. waste');
  wchart(); void tips;
}
// Per-session est. waste rate, oldest → newest, with the measured baseline and with-tips lines.
function wchart() {
  const el = $('o-chart'); if (!el) return; const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
  const rows = sessions(last.r, last.p).slice().reverse().map(s => ({ ...s, rate: s.tot ? s.waste / s.tot * 1e5 : 0 })), w = o.wasteRow;
  if (!rows.length) return void (el.innerHTML = stateBox('empty', 'No sessions yet.'));
  const L = 46, R = 10, T = 12, B = 24, iw = W - L - R, ih = H - T - B, n = rows.length, bw = Math.min(26, iw / n * .56);
  const m = nice(Math.max(1, w?.[1] || 0, ...rows.map(s => s.rate)) * 1.08), x = i => L + (i + .5) * iw / n, y = v => T + ih - v / m * ih;
  let g = ''; for (let i = 0; i <= 3; i++) { const yy = T + ih * i / 3; g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end">${tok(m * (1 - i / 3))}</text>`; }
  const step = Math.ceil(n / Math.max(2, Math.floor(iw / 70)));
  const bars = rows.map((s, i) => { const hi = w && s.rate > w[1], hgt = Math.max(s.rate ? 2 : 0, ih - (y(s.rate) - T));
    return `<rect class="wb${hi ? ' hi' : ''}" x="${x(i) - bw / 2}" y="${T + ih - hgt}" width="${bw}" height="${hgt}" rx="${Math.min(4, bw / 4)}" style="--i:${i}"/>`
      + ((n - 1 - i) % step === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === n - 1 ? 'end' : 'middle'}">${new Date(s.start).toLocaleDateString([], { month: 'short', day: 'numeric' })}</text>` : '')
      + `<rect class="hit" x="${x(i) - iw / n / 2}" y="${T}" width="${iw / n}" height="${ih}" data-html="1" data-tip="${esc(`<b>${esc(s.project)} · ${s.id}</b><br>${when(s.start)} · ${s.n} requests<br>Est. waste ${tok(s.waste)} of ${tok(s.tot)} tokens<br>Rate ${tok(s.rate)} per 100K${s.issue ? '<br>Top problem: ' + esc(s.issue) : ''}`)}"/>`; }).join('');
  const line = (v, c) => v == null ? '' : `<line class="${c}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
  const top = rows.reduce((a, b) => b.rate > a.rate ? b : a), day = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); // req 8: one spoken summary instead of 25 hover-only bars
  const sum = `Waste per session, ${n} session${n === 1 ? '' : 's'} from ${day(Math.min(...rows.map(s => +new Date(s.start))))} to ${day(Math.max(...rows.map(s => +new Date(s.start))))}. Highest ${tok(top.rate)} per 100K tokens on ${day(top.start)} (${top.project}).${w ? ` ${rows.filter(s => s.rate > w[1]).length} above the baseline of ${tok(w[1])}; with tips ${tok(w[2])}.` : ''}`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(sum)}">${g}${bars}${w ? line(w[1], 'bl0') + line(w[2], 'bl1') : ''}</svg>`;
}
function nice(v) { const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; }

// ---------- Recommendations ----------
function recItems() {
  const r = last.r, items = [];
  for (const x of o.types) if (x.waste || x.at) {
    const ot = x.opt, conf = /^verified/.test(ot?.status || '') ? 'high' : x.sessions >= 2 ? 'medium' : 'low';
    items.push({ kind: 'tip', key: x.t, ic: x.ic, tc: TCOL[x.t], title: x.name, state: x.state, conf, risk: 'none',
      problem: x.waste ? `${tok(x.waste)} est. tokens wasted in the last 10 sessions: ${x.n} time${x.n === 1 ? '' : 's'} across ${x.sessions} session${x.sessions === 1 ? '' : 's'}.` : 'No waste of this type in the last 10 sessions.',
      affected: x.details.slice(0, 3).map(d => d.d).join(', ') || '—',
      benefit: ot ? `${ot.status}. Waste per 100K tokens ${tok(ot.before)} → ${tok(ot.after)} over ${ot.n} session${ot.n === 1 ? '' : 's'} with the tip.` : 'Not measured yet: a tip is learned once it shows up in 2+ sessions with >500 est. tokens.',
      evidence: ot ? `Clean sessions ${ot.cleanBefore ?? '—'}% → ${ot.cleanAfter ?? '—'}% · tip cost ${tok(ot.costEst)} · net ${ot.net < 0 ? '−' : '+'}${tok(Math.abs(ot.net))}` : `${x.n} occurrence${x.n === 1 ? '' : 's'} counted in your logs`,
      plan: `Startup hint: “${x.rule}” Measured every rescan; retired automatically after 5 sessions with no clear drop.`, action: tipBtn(x) });
  }
  o.recs.forEach(rc => rc.k && items.push({ kind: 'habit', key: rc.k, ic: 'i-clock', tc: '#5AB8F2', title: RECT[rc.k] || 'Recommendation', dismissed: rc.dismissed, conf: 'medium', risk: 'low',
    problem: rc.t, affected: 'Your sessions (last 10)', benefit: 'Estimated from your last 10 sessions; depends on how you work.', evidence: 'Request counts and re-cache sizes from your logs.',
    plan: rc.k === 'tipsoff' ? 'Pause automatic optimization (Automatic tab) if this stays true.' : 'Manual: you decide when to /clear or /compact in Claude Code. Nothing runs automatically.',
    action: `<button class="btn sm ghost" data-a="dismiss" data-k="${rc.k}" data-on="${rc.dismissed ? 0 : 1}" data-tip="${rc.dismissed ? 'Show it again.' : 'Hide this recommendation. Restore it any time from History &amp; Rollback.'}">${icon(rc.dismissed ? 'i-undo' : 'i-x')}${rc.dismissed ? 'Restore' : 'Dismiss'}</button>` }));
  for (const s of r.skadv?.items || []) if (s.status === 'Consider removing' || s.expensive) items.push({ kind: 'skill', key: s.name, ic: 'i-puzzle', tc: '#C48BFF', title: s.name, conf: s.conf, risk: 'approval',
    problem: s.why, affected: `${s.sessions} session${s.sessions === 1 ? '' : 's'} · ${s.uses} uses`, benefit: s.removeSave ? `~${tok(s.removeSave)} est. tokens per session if removed` : 'Not enough data',
    evidence: s.compare, plan: `${s.rec}. Plugin and skill changes always need your approval and are made in Plugins & Skills.`,
    action: `<a class="btn sm ghost" href="#/optimizations/plugins">${icon('i-puzzle')}Review</a>` });
  return items;
}
function recommendations() {
  const all = recItems(), dis = all.filter(x => x.dismissed).length;
  const list = all.filter(x => (rf === 'all' || x.kind === rf) && (showDis || !x.dismissed));
  const RISK = { none: ['ver', 'No risk', 'A hint only: never blocks a tool, skips a read or changes code.'], low: ['est', 'Low risk', 'Manual: only you act on it.'], approval: ['est', 'Needs approval', 'Changing plugins or skills can break workflows, so it is never automatic.'] };
  return `<div class="subbar" style="--i:2">${lm('op-rec', 'Recommendations')}${seg([['all', 'All'], ['tip', 'Startup tips'], ['habit', 'Your habits'], ['skill', 'Plugins & skills']].map(([v, t]) => [v, `${t} (${all.filter(x => v === 'all' || x.kind === v).length})`]), rf, 'tabs chips').replace(/data-v=/g, 'data-a="rf" data-k=')}
  <span class="count">${dis ? `<button class="btn sm ghost" data-a="dis">${showDis ? 'Hide' : 'Show'} ${dis} dismissed</button>` : ''}</span></div>
  ${list.length ? `<div class="recs">${list.map((x, i) => `<article class="card rec${x.dismissed ? ' dim' : ''}" style="--i:${i + 3};--tc:${x.tc}">
    <div class="rec-h"><span class="o-ic">${icon(x.ic)}</span><div><b>${esc(x.title)}</b><small>${{ tip: 'Startup tip', habit: 'Your habit', skill: 'Plugin / skill' }[x.kind]}</small></div>
      <div class="end">${x.state ? stc(x.state) : ''}<span class="chip ${x.conf === 'high' ? 'ver' : x.conf === 'medium' ? 'live' : 'unk'}" data-tip="How sure the tracker is, from the amount of evidence.">${x.conf} confidence</span><span class="chip ${RISK[x.risk][0]}" data-tip="${RISK[x.risk][2]}">${RISK[x.risk][1]}</span></div></div>
    <dl class="rec-dl"><div><dt>Problem</dt><dd>${esc(x.problem)}</dd></div><div><dt>Affected</dt><dd>${esc(x.affected)}</dd></div>
      <div><dt>Expected benefit</dt><dd>${esc(x.benefit)}</dd></div><div><dt>Evidence</dt><dd>${esc(x.evidence)}</dd></div><div class="wide"><dt>Plan</dt><dd>${esc(x.plan)}</dd></div></dl>
    <div class="rec-a">${x.action || '<span class="muted sm">Not learned yet: nothing to apply.</span>'}</div></article>`).join('')}</div>` : stateBox('empty', 'No recommendations here.', 'The tracker adds them when your logs show a repeated problem.')}`;
}

// ---------- Automatic ----------
const RULES = () => { const on = !o.lab.autoOff; return [
  { name: 'Startup tips', on, short: `${o.active} active`, ic: 'i-book', what: 'Learns a hint when the same waste appears in 2+ of the last 10 sessions (>500 est. tokens) and loads it at each session start.', when: 'Every rescan (30 s) and session start', scope: 'Hint text only', pausable: true },
  { name: 'Auto-retire ineffective tips', on, short: `${o.retired} retired`, ic: 'i-undo', what: 'Turns a tip off by itself after 5+ sessions with no clear drop in its waste (automatic revert). Re-test any time.', when: 'Every rescan', scope: 'Its own tips only', pausable: true },
  { name: 'Token self-correction', on: true, short: 'always on', ic: 'i-shield', what: 'Re-counts tokens from the raw logs with a second method; mismatches are corrected with a backup of the old numbers.', when: 'Every audit run', scope: 'Tracker data only', pausable: false },
  { name: 'Context Advisor', on: true, short: 'warns only', ic: 'i-gauge', what: 'Warns in chat when a session gets long or stale. Never clears or compacts anything itself.', when: 'Each prompt (local, no AI)', scope: 'One warning line', pausable: false },
  { name: 'Skill Advisor', on: true, short: 'notices only', ic: 'i-puzzle', what: 'Flags unusually expensive or unhelpful skills. Never installs, removes or edits anything.', when: 'Every rescan', scope: 'Notices only', pausable: false },
]; };
function automatic() {
  const on = !o.lab.autoOff, r = last.r;
  return `<div class="pgrid r-ws enter">
  ${card(2, 'i-bolt', 'Automatic Optimization ' + lm('op-auto', 'Automatic optimization'), tgl(on), `
    <div class="auto-st ${on ? 'on' : ''}"><span class="dot ${on ? 'ok' : 'warn'}"></span><div><b>${on ? 'Running' : 'Paused'}</b><small>${on ? 'Proven, low-risk, reversible changes are applied and measured automatically.' : `Paused${o.log.find(x => /paused automatic/.test(x.msg)) ? ' ' + ago(o.log.find(x => /paused automatic/.test(x.msg)).t) : ''}. Accuracy checks and advisors keep running.`}</small></div></div>
    <div class="rules">${RULES().map(x => `<div class="rule${x.on ? '' : ' off'}"><span class="o-ic">${icon(x.ic)}</span>
      <div class="r-t"><b>${x.name}</b><small>${x.what}</small></div>
      <dl><div><dt>Runs</dt><dd>${x.when}</dd></div><div><dt>Scope</dt><dd>${x.scope}</dd></div></dl>
      <span class="chip ${x.on ? 'ver' : 'est'}">${x.on ? (x.pausable ? 'On' : 'Always on') : 'Paused'}</span></div>`).join('')}</div>`)}
  <div class="side-col">
    ${card(3, 'i-shield', 'Safeguards', '', `<ul class="guards">${['Quality and reliability outrank token savings: tips never skip reads, steps or tests the work needs.', 'Never clears or compacts context by itself.', 'Never hides required tool output.', 'Never installs, removes or disables plugins, skills or hooks.', 'Every automatic change is logged and reversible (History & Rollback).', 'An idle tracker uses zero AI tokens.'].map(t => `<li>${icon('i-check')}<span>${t}</span></li>`).join('')}</ul>`)}
    ${card(4, 'i-timer', 'Schedule & Permissions', '', `<dl class="dl g2">
      <div><dt>Rescan</dt><dd>every 30 s</dd></div><div><dt>Last analysis</dt><dd>${r.audit?.at ? ago(r.audit.at) : '—'}</dd></div>
      <div><dt>Writes</dt><dd>tracker folder only</dd></div><div><dt>Network</dt><dd>127.0.0.1 only</dd></div>
      <div><dt>Learned tips</dt><dd>${o.learned}</dd></div><div><dt>Auto-retired</dt><dd>${o.retired}</dd></div></dl>`)}
  </div></div>`;
}

// ---------- Plugins & Skills ----------
function plugins() {
  const r = last.r, items = r.skadv?.items || [], ST = { Keep: 'ver', Review: 'unk', 'Consider removing': 'est' };
  const F = { all: () => true, Keep: s => s.status === 'Keep', Review: s => s.status === 'Review', remove: s => s.status === 'Consider removing', exp: s => s.expensive };
  const q = pq.trim().toLowerCase(), rows = items.filter(F[pf] || F.all).filter(s => !q || (s.name + ' ' + s.type).toLowerCase().includes(q))
    .sort((a, b) => ((a[psort[0]] ?? -1) > (b[psort[0]] ?? -1) ? 1 : (a[psort[0]] ?? -1) < (b[psort[0]] ?? -1) ? -1 : 0) * psort[1]);
  const PER = 10, pages = Math.max(1, Math.ceil(rows.length / PER)); ppage = Math.min(ppage, pages - 1);
  const cnt = k => items.filter(F[k]).length;
  pluginsAfter = pTable;
  return `<div class="pgrid r-ws enter">
  ${card(2, 'i-puzzle', 'Plugin & Skill Efficiency ' + lm('op-skill', 'Plugin & Skill Efficiency'), chip('est', 'Load cost = injected/loaded text (chars ÷ 4). Savings only from with/without comparisons in the same projects.'), `
    <div class="subbar">${seg([['all', `All (${items.length})`], ['Keep', `Keep (${cnt('Keep')})`], ['Review', `Review (${cnt('Review')})`], ['remove', `Consider removing (${cnt('remove')})`], ['exp', `Expensive (${cnt('exp')})`]], pf, 'tabs chips').replace(/data-v=/g, 'data-a="pf" data-k=')}
      <label class="field" style="margin-left:auto">${icon('i-search')}<input id="p-q" placeholder="Filter by name" value="${esc(pq)}" aria-label="Filter plugins and skills"></label></div>
    <div class="tbl-wrap" id="p-tbl"></div>
    <div class="pager"><span class="muted">${rows.length ? `${ppage * PER + 1}–${Math.min(rows.length, (ppage + 1) * PER)} of ${rows.length}` : '0 items'}</span><div class="pg-btns">${Array.from({ length: pages }, (_, i) => `<button class="pgb${i === ppage ? ' on' : ''}" data-a="pp" data-k="${i}" aria-label="Page ${i + 1}"${i === ppage ? ' aria-current="page"' : ''}>${i + 1}</button>`).join('')}</div></div>`)}
  <div class="side-col">
    ${card(3, 'i-gauge', 'Summary', '', `<dl class="dl g2">
      <div><dt>Tracked</dt><dd>${items.length}</dd></div><div><dt>Total load cost</dt><dd>${tok(r.saved?.skillCost)} <small class="muted">est.</small></dd></div>
      <div><dt>Median / session</dt><dd>${tok(r.skadv?.med)}</dd></div><div><dt>Skill savings</dt><dd class="sm">${esc(r.skills?.combined?.status || '—')} (${r.skills?.combined?.nW ?? 0} with / ${r.skills?.combined?.nWo ?? 0} without)</dd></div></dl>
      <p class="muted sm">Install, remove and Improve are on the <a href="#/plugins">Plugins page</a>. Nothing changes without your approval.</p>`)}
    ${card(4, 'i-clock', 'Recent Changes', chip('live', 'Detected from your ~/.claude folders.'), `<div class="hlog">${(r.skadv?.changes || []).slice(0, 8).map(([t, n, w]) => `<div><span class="dot info"></span><span>${esc(n)}<small>${esc(w)}</small></span><small>${ago(t)}</small></div>`).join('') || stateBox('empty', 'No changes seen.')}</div>`)}
  </div></div>`;
  function pTable() {
    const el = $('p-tbl'); if (!el) return;
    if (!rows.length) return void (el.innerHTML = stateBox('empty', 'No matches.'));
    table(el, [['name', 'Name', { f: (v, s) => `<div class="sx-t"><b>${esc(v)}</b><small>${esc(s.type)}${s.version ? ' · ' + esc(s.version) : ''}</small></div>` }],
      ['status', 'Status', { f: (v, x) => `<span class="chip ${ST[v] || 'unk'}" data-tip="Confidence: ${esc(x.conf)}">${esc(v)}</span>` }], ['conf', 'Conf.', { f: v => `<span class="muted">${esc(v)}</span>` }],
      ['sessions', 'Sessions', { num: 1 }], ['uses', 'Uses', { num: 1, f: full }], ['cost', 'Cost / sess.', { num: 1, f: (v, s) => `<b class="${s.expensive ? 'wv' : ''}">${tok(v)}</b>`, tip: 'Estimated tokens it loads per session (chars ÷ 4).' }],
      ['compare', 'With vs without', { f: v => `<span class="muted">${esc(v)}</span>` }], ['rec', 'Recommendation', { f: (v, s) => `<span data-tip="${esc(s.why)}">${esc(v)}</span>` }]],
    rows.slice(ppage * PER, ppage * PER + PER), psort, { sort: k => { psort = [k, psort[0] === k ? -psort[1] : -1]; update(last); } });
  }
}
let pluginsAfter = () => { };

// ---------- Experiments ----------
function experiments() {
  const r = last.r, v = r.verify, srows = (r.skills?.rows || []).filter(s => s.outWith != null);
  const res = s => /^verified/.test(s) ? ['ver', 'Worked'] : /no clear/.test(s) ? ['unk', 'No clear effect'] : ['est', 'Measuring'];
  const bar = (a, b, f = tok) => { const m = Math.max(a || 0, b || 0, 1); return `<div class="ab"><span>Before</span><div class="bar"><i style="width:${(a || 0) / m * 100}%;background:var(--dim)"></i></div><b>${f(a)}</b></div><div class="ab"><span>After</span><div class="bar"><i style="width:${(b || 0) / m * 100}%"></i></div><b>${f(b)}</b></div>`; };
  return `<p class="muted sm intro" style="--i:2">${lm('op-exp', 'How tips are tested')} Each tip is a controlled experiment: <b>baseline</b> = up to 30 sessions before tips existed, in the same projects; <b>candidate</b> = sessions where the tip was really loaded. A tip counts as worked only with 5+ sessions on each side, ≥25% less est. waste and fewer measured occurrences.</p>
  <div class="exps enter">${o.opts.map((x, i) => { const [c, t] = res(x.status), ty = o.types.find(y => 'Tip: ' + y.t === x.name);
    return `<section class="card exp" style="--i:${i + 3}"><div class="card-h">${icon(ty ? ty.ic : 'i-flask')}<h2>${esc(x.name)}</h2><div class="end">${ty ? stc(ty.state) : ''}<span class="chip ${c}" data-tip="${esc(x.status)}">${t}</span></div></div>
      <div class="exp-g"><div><span class="k">Est. waste per 100K tokens</span>${bar(x.before, x.after)}</div><div><span class="k">Sessions with none of it</span>${bar(x.cleanBefore, x.cleanAfter, n => n == null ? '—' : n + '%')}</div></div>
      <dl class="dl g3"><div><dt>Sessions with tip</dt><dd>${x.n}</dd></div><div><dt>Tip cost</dt><dd>${tok(x.costEst)}</dd></div><div><dt>Net</dt><dd class="${x.net < 0 ? 'wv' : ''}">${x.net < 0 ? '−' : '+'}${tok(Math.abs(x.net))}</dd></div></dl>
      ${ty ? `<div class="rec-a">${tipBtn(ty)}</div>` : ''}</section>`; }).join('') || stateBox('empty', 'No experiments yet.')}</div>
  <div class="pgrid r-2-1 enter">
    ${card(6, 'i-chart', 'Baseline vs With Tips', chip('live', 'Counts are measured from your logs; waste size is estimated.'), v ? `<table class="tbl cmp-t"><thead><tr><th>Metric</th><th class="n">Baseline (${v.base})</th><th class="n">With tips (${v.seen})</th><th class="n">Change</th><th>Kind</th></tr></thead><tbody>
      ${v.rows.map(([m, a, b, p, k, dir]) => `<tr><td>${esc(m)}</td><td class="n">${fmtM(m, a)}</td><td class="n">${fmtM(m, b)}</td><td class="n">${p == null ? '<span class="muted">—</span>' : `<span class="${p * dir > 0 ? 'down' : p ? 'up' : 'muted'}">${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%</span>`}</td><td><span class="chip ${k === 'measured' ? 'live' : 'est'}">${k}</span></td></tr>`).join('')}</tbody></table>
      <p class="muted sm">${v.enough ? 'Enough sessions on both sides to judge.' : `Collecting: needs 5 sessions on each side (${v.base} / ${v.seen}).`}</p>` : stateBox('empty', 'No baseline yet.'))}
    ${card(7, 'i-puzzle', 'Skills: With vs Without', chip('est', 'Output tokens per request in sessions with vs without the skill, same projects. Verified needs 10+ sessions each side and ≥25% less.'), srows.length ? `<div class="cmpbars">${srows.map(s => `<div class="cb" data-tip="${esc(`${s.nW} sessions with / ${s.nWo} without · ${s.status}`)}"><div class="cb-h"><span class="n">${esc(s.name)}</span><b data-tip="Output tokens per request with the skill vs without. Not good or bad by itself.">${s.pct > 0 ? '+' : ''}${s.pct}%</b><small>${s.nW}/${s.nWo}</small></div>
      <div class="ab2"><i style="width:${s.outWith / Math.max(s.outWith, s.outWithout) * 100}%"></i></div><div class="ab2 wo"><i style="width:${s.outWithout / Math.max(s.outWith, s.outWithout) * 100}%"></i></div></div>`).join('')}</div>
      <div class="legend"><span><i style="background:var(--primary)"></i>With (output / request)</span><span><i style="background:var(--dim)"></i>Without</span></div>` : stateBox('empty', 'Not enough sessions without skills to compare.'))}
  </div>`;
}
const fmtM = (m, v) => v == null ? '—' : /%/.test(m) ? v.toFixed(1) + '%' : /per 100/.test(m) ? v.toFixed(2) : /tool calls/.test(m) ? v.toFixed(2) : tok(v);

// ---------- Verified Savings ----------
function savings() {
  const r = last.r, sv = r.saved || {}, a = r.audit || {}, net = a.net || {};
  const K = { estimate: 'est', verified: 'ver', measured: 'live' };
  const overMax = Math.max(1, ...(net.over || []).map(x => x.tok));
  return `<div class="kpis k4" style="--i:2">${kpi('s-ver', 'i-shield', 'Verified Savings ' + lm('op-sav', 'Estimated vs verified savings'))}${kpi('s-est', 'i-spark', 'Estimated Savings')}${kpi('s-cost', 'i-arrow-up', 'Optimizer Overhead', 'var(--warn)')}${kpi('s-net', 'i-gauge', 'Net Effect')}</div>
  <div class="pgrid r-2-1 enter">
    ${card(3, 'i-db', 'Savings by Source', chip('live', 'From the tracker’s accuracy audit.'), `<table class="tbl cmp-t"><thead><tr><th>Source</th><th class="n">Amount</th><th>Kind</th><th>Unit</th></tr></thead><tbody>
      ${(a.savings || []).map(s => `<tr><td><b>${esc(s.src)}</b><small class="muted sm" style="display:block;white-space:normal">${esc(s.note || '')}</small></td><td class="n"><b>${s.amount == null ? '—' : s.usd ? '~$' + s.amount.toFixed(2) : tok(s.amount)}</b></td><td><span class="chip ${K[s.kind] || 'unk'}">${esc(s.kind)}</span></td><td class="muted sm" style="white-space:normal">${esc(s.unit)}</td></tr>`).join('')}</tbody></table>
      <p class="muted sm">Each source keeps its own unit: output tokens, chars ÷ 4 and dollars are never added together.</p>`)}
    ${card(4, 'i-arrow-up', 'What the Optimizer Costs', chip('est', 'Tokens the tracker’s own text adds to your sessions (chars ÷ 4).'), `<div class="cmpbars">${(net.over || []).map(x => `<div class="cb"><div class="cb-h"><span class="n">${esc(x.what)}</span><b>${tok(x.tok)}</b><small>${x.n}×</small></div><div class="stack"><i style="width:${x.tok / overMax * 100}%;background:var(--warn)"></i></div></div>`).join('') || stateBox('empty', 'No overhead recorded.')}</div>
      <p class="muted sm">${esc(net.status || '')}: ${tok(net.gain)} est. saved − ${tok(net.overTok)} overhead = ${net.net < 0 ? '−' : '+'}${tok(Math.abs(net.net || 0))}.</p>`)}
  </div>
  ${card(5, 'i-book', 'Verified vs Estimated', '', `<div class="ve"><div><span class="chip ver">VERIFIED</span><p>The token amount itself is measured in your usage logs (e.g. output tokens with vs without a skill). Currently <b>${tok(sv.verified || 0)}</b>: ${esc(r.skills?.combined?.status || 'Not enough data')}.</p></div>
    <div><span class="chip est">EST.</span><p>The problem is measured (fewer re-reads, smaller outputs), but its size is chars ÷ 4. Tips: <b>${tok(sv.tipVerifiedEst)}</b> (${esc(o.all?.status || '—')}).</p></div>
    <div><span class="chip unk">FORECAST</span><p>Context Advisor savings are a forecast for when you follow it, not a saving. Dollars at API list price are not the same as plan usage.</p></div></div>`)}`;
}
function savingsAfter() {
  const r = last.r, sv = r.saved || {}, net = r.audit?.net || {};
  setKpi($('s-ver'), sv.verified || 0, tok, 'token amount measured in logs', S(sv.verified ? chip('ver') : chip('unk', 'Nothing verified token-for-token yet: ' + (r.skills?.combined?.status || ''))));
  setKpi($('s-est'), sv.estimated, tok, 'fewer problems × est. size', S(chip('est')));
  setKpi($('s-cost'), net.overTok, tok, 'tracker text added to sessions', S(chip('est')));
  setKpi($('s-net'), net.net, n => (n < 0 ? '−' : '+') + tok(Math.abs(n)), esc(net.status || ''), S(chip('est')));
}

// ---------- History & Rollback ----------
function history() {
  const r = last.r, lab = o.lab;
  const ev = [...o.log.map(x => ({ t: x.t, k: x.you ? 'you' : x.backup ? 'fix' : 'auto', msg: x.msg, sub: x.backup ? 'Backup: ' + x.backup : '' })),
    ...(r.skadv?.changes || []).map(([t, n, w]) => ({ t, k: 'plugin', msg: `${n}: ${w}`, sub: '' })),
    ...(r.advisor?.log || []).map(([t, id, w, res]) => ({ t, k: 'ctx', msg: `${w} · ${String(id).slice(0, 8)}`, sub: res }))].sort((a, b) => b.t - a.t);
  const KN = { you: ['Your actions', 'i-check', 'ok'], auto: ['Automatic', 'i-bolt', 'ok'], fix: ['Data fixes', 'i-shield', 'info'], plugin: ['Plugins', 'i-puzzle', 'info'], ctx: ['Context saves', 'i-book', 'ok'] };
  const q = hq.trim().toLowerCase(), list = ev.filter(x => (hf === 'all' || x.k === hf) && (!q || (x.msg + ' ' + x.sub).toLowerCase().includes(q)));
  const undo = [...o.types.filter(x => x.state === 'retired').map(x => `<div class="ub"><span class="o-ic" style="--tc:${TCOL[x.t]}">${icon(x.ic)}</span><div><b>Tip “${x.t}” retired</b><small>${ago(x.retiredAt)} · ${x.opt ? esc(x.opt.status) : ''}</small></div>${tipBtn(x)}</div>`),
    ...o.recs.filter(x => x.dismissed).map(x => `<div class="ub"><span class="o-ic">${icon('i-clock')}</span><div><b>${RECT[x.k]} dismissed</b><small>${ago(lab.dismissed[x.k])}</small></div><button class="btn sm" data-a="dismiss" data-k="${x.k}" data-on="0" data-tip="Show this recommendation again.">${icon('i-undo')}Restore</button></div>`),
    ...(lab.autoOff ? [`<div class="ub"><span class="o-ic">${icon('i-bolt')}</span><div><b>Automatic optimization paused</b><small>no tips load</small></div><button class="btn sm" data-a="auto" data-on="1">${icon('i-play')}Resume</button></div>`] : [])];
  const fixes = o.log.filter(x => x.backup);
  return `<div class="pgrid r-ws enter">
  ${card(2, 'i-clock', 'Change Log ' + lm('op-hist', 'History & Rollback'), chip('live'), `<div class="subbar">${seg([['all', `All (${ev.length})`], ...Object.entries(KN).map(([k, [t]]) => [k, `${t} (${ev.filter(x => x.k === k).length})`])], hf, 'tabs chips').replace(/data-v=/g, 'data-a="hf" data-k=')}
    <label class="field" style="margin-left:auto">${icon('i-search')}<input id="h-q" placeholder="Search history" value="${esc(hq)}" aria-label="Search history"></label></div>
    <div class="hist">${list.slice(0, 60).map(x => `<div class="he"><span class="o-ic sm">${icon(KN[x.k][1])}</span><div><b>${esc(x.msg)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</div><span class="chip ${x.k === 'you' ? 'ver' : x.k === 'fix' ? 'live' : 'unk'}">${KN[x.k][0]}</span><small class="muted" data-tip="${esc(new Date(x.t).toLocaleString())}">${ago(x.t)}</small></div>`).join('') || stateBox('empty', 'Nothing matches.')}</div>`)}
  <div class="side-col">
    ${card(3, 'i-undo', 'Rollback', '', undo.length ? `<div class="ubs">${undo.join('')}</div>` : stateBox('empty', 'Nothing to roll back.', 'Retired tips, dismissed recommendations and a paused optimizer show up here.'))}
    ${card(4, 'i-shield', 'Data Corrections', chip('live', 'Token totals the audit corrected to match your logs.'), fixes.length ? `<div class="hlog">${fixes.map(x => `<div><span class="dot info"></span><span>${esc(x.msg.replace(/\. Backup:.*$/, ''))}<small class="mono">${esc(x.backup)}</small></span><small>${ago(x.t)}</small></div>`).join('')}</div>
      <p class="muted sm">These fixed wrong counts, so they are kept. The backup file holds the old numbers.</p>` : stateBox('empty', 'No corrections needed.'))}
  </div></div>`;
}

// ---------- Diagnostics ----------
function diagnostics() {
  const r = last.r, a = r.audit || {}, sl = r.startup?.latest, adv = r.advisor || {}, v = r.verify;
  const SC = { Verified: 'ver', 'Collecting Data': 'est', 'Needs Attention': 'est' };
  const issues = o.types.flatMap(x => x.details.map(d => ({ ...d, x }))).sort((p, q) => q.w - p.w);
  const parts = sl ? [...sl.parts, ['Not in logs (tool schemas, system prompt)', sl.rest]].filter(p => p[1]) : [], PC = ['#31D67A', '#5AB8F2', '#A2F7C5', '#C48BFF', '#1E8F55', '#63786B'];
  const cr = v?.rows.find(x => /cache read/.test(x[0]));
  return `<div class="pgrid r-2-1 enter">
  ${card(2, 'i-search', 'Detected Problems', chip('est', 'Occurrences are counted from your logs; token size is estimated. Last 10 sessions.'), issues.length ? `<table class="tbl cmp-t"><thead><tr><th>Problem</th><th>Where</th><th class="n">Sessions</th><th class="n">Times</th><th class="n">Est. waste</th><th>Tip</th></tr></thead><tbody>
    ${issues.slice(0, 12).map(d => `<tr><td><span class="sw" style="background:${TCOL[d.x.t]};margin-right:8px"></span>${d.x.name}</td><td class="mono sm" style="max-width:260px;overflow:hidden;text-overflow:ellipsis">${esc(d.d)}</td><td class="n">${d.s}</td><td class="n">${d.n}</td><td class="n">${d.w ? `<b>${tok(d.w)}</b>` : '<span class="muted" data-tip="Counted, but its size is not estimated (e.g. image reads have no text to count).">not est.</span>'}</td><td>${stc(d.x.state)}</td></tr>`).join('')}</tbody></table>` : stateBox('empty', 'No problems detected in the last 10 sessions.'))}
  ${card(3, 'i-shield', 'Accuracy Audit ' + lm('op-aud', 'Data Accuracy Audit'), `<span class="chip ${o.pass === o.checks.length ? 'ver' : 'est'}">${o.pass}/${o.checks.length} verified</span>`, `<div class="checks">${o.checks.map(c => `<details class="chk"><summary><span class="dot ${c.status === 'Verified' ? 'ok' : 'warn'}"></span><b>${esc(c.name)}</b><span class="chip ${SC[c.status] || 'unk'}">${esc(c.status)}</span></summary><p>${esc(c.detail)}</p>${c.why ? `<p class="muted sm">${esc(c.why)}</p>` : ''}</details>`).join('')}</div>
    <p class="muted sm">Last run ${a.at ? ago(a.at) : '—'}. Run Auto-Analysis re-runs every check now.</p>`, 'glass')}
  </div>
  <div class="pgrid r-3 enter">
  ${card(4, 'i-layers', 'Startup Context', chip('est', 'What the newest session loaded before its first request. Logged parts: chars ÷ 4. The rest is the measured total minus logged parts.'), sl ? `<div class="brk-wrap"><div class="donut-box" id="d-donut"></div><div class="brk-list">${parts.map((p, i) => `<div class="bl"><span class="sw" style="background:${PC[i]}"></span><span data-tip="${esc(p[0])}">${esc(p[0])}</span><b>${tok(p[1])}</b><small>${Math.round(p[1] / sl.ctx * 100)}%</small></div>`).join('')}</div></div>
    <p class="muted sm">${esc(projName(sl.project))} · ${tok(sl.ctx)} tokens at start (${tok(sl.cached)} cached).</p>` : stateBox('empty', 'No startup data yet.'))}
  ${card(5, 'i-gauge', 'Cache Behaviour', chip('live'), `<dl class="dl g2">
    <div><dt>Cache read share</dt><dd>${cr ? `${cr[2]?.toFixed(1)}% <small class="muted">was ${cr[1].toFixed(1)}%</small>` : '—'}</dd></div>
    <div><dt>Auto-compact point</dt><dd>${tok(adv.win)}</dd></div>
    <div><dt>Avg context at start</dt><dd>${tok(adv.startAvg)}</dd></div><div><dt>Avg after compact</dt><dd>${tok(adv.postAvg)}</dd></div>
    <div><dt>Re-cached after gaps</dt><dd>${tok(o.types.find(x => x.t === 'rebuild')?.waste)} <small class="muted">est.</small></dd></div>
    <div><dt>Tool calls / request</dt><dd>${v?.rows.find(x => /tool calls/.test(x[0]))?.[2]?.toFixed(2) ?? '—'}</dd></div></dl>`)}
  ${card(6, 'i-pulse', 'Hooks & Overhead', chip('live'), `<p class="sm" style="margin:0 0 10px;color:var(--ink-2, #D3E2D9)">${esc(o.checks.find(c => c.id === 'hooks')?.detail || 'No hook data.')}</p>
    <div class="hlog">${(a.net?.over || []).slice(0, 4).map(x => `<div><span class="dot warn"></span><span>${esc(x.what)}<small>${x.n} times</small></span><small>${tok(x.tok)} est.</small></div>`).join('')}</div>`)}
  </div>
  ${card(7, 'i-clock', 'Context Advisor: Live Sessions', chip('live'), (adv.sessions || []).length ? `<table class="tbl cmp-t"><thead><tr><th>Session</th><th class="n">Context</th><th>Health</th><th>Advice</th><th>Why</th></tr></thead><tbody>
    ${adv.sessions.map(s => `<tr><td><a href="#/sessions/${esc(s.id.slice(0, 8))}" class="mono">${esc(s.id.slice(0, 8))}</a> <small class="muted">${esc(s.project)}</small></td><td class="n">${tok(s.ctx)} <small class="muted">${s.pct}%</small></td><td>${esc(s.health || '—')}</td><td>${esc(s.label || s.action)}</td><td class="muted sm" style="white-space:normal">${esc(s.why)}</td></tr>`).join('')}</tbody></table>` : stateBox('empty', 'No live sessions.'))}`;
}
function diagnosticsAfter() {
  const sl = last.r.startup?.latest; if (!sl) return;
  const PC = ['#31D67A', '#5AB8F2', '#A2F7C5', '#C48BFF', '#1E8F55', '#63786B'];
  donut($('d-donut'), [...sl.parts, ['Not in logs', sl.rest]].filter(p => p[1]).map((p, i) => [p[0], p[1], PC[i]]), tok(sl.ctx), 'at start');
}

function logList(items) {
  if (!items.length) return stateBox('empty', 'No changes yet.');
  return `<div class="acts">${items.map(x => `<div class="ac"><span class="o-ic sm">${icon(x.you ? 'i-check' : x.backup ? 'i-shield' : 'i-bolt')}</span><span class="ac-t">${esc(x.msg.replace(/\. Backup:.*$/, ''))}</span><small>${ago(x.t)}</small><span class="chip ${x.you ? 'ver' : 'unk'}">${x.you ? 'you' : 'auto'}</span></div>`).join('')}</div>`;
}

const VIEWS = { overview, recommendations, automatic, plugins, experiments, savings, history, diagnostics };
const AFTER = { overview: overviewAfter, savings: savingsAfter, diagnostics: diagnosticsAfter, plugins: () => pluginsAfter() };
function after() { AFTER[tab]?.(); }
