// Sessions workspace: KPIs, daily usage + breakdown, table or timeline with filters and paging, details / compare / actions column.
// Routes: #/sessions (table), #/sessions/timeline, #/sessions/<id8> (table with that session selected).
import { sessions, filterSessions, sortBy, usage, csv } from '../data.js';
import { tok, esc, chip, dur, pct, ago } from '../fmt.js';
import { icon, seg, stateBox, table, spark, ring, setRing, chart, kpi, setKpi, donut, toast, download, compareRows, MORE, more, errBox } from '../ui.js';
import { poll, retryText } from '../api.js';
import * as S from '../settings.js';

// M7d D3 Learn More (Sessions copy, checked against tracker.js / data.js). All read-only, local, no tokens.
const RO = { tokens: 'None used', files: 'Nothing changed', privacy: 'Stays on this PC', load: 'None' };
Object.assign(MORE, {
  'se-list': { area: 'Sessions', title: 'Which sessions are shown', what: 'The 25 newest Claude Code sessions the tracker has logged on this PC, newest first. Search, Project, Date, With issues and Live now only narrow that list.',
    when: ['Finding one session to look at or compare.'], impact: RO, notes: ['Older sessions still count in Analytics totals; they are just not listed here.', 'Live now = a session that sent a request recently and has not ended.'], tech: 'GET /api → sessions (tracker.js: last 25 of state.sessions). Filters run in the page (data.js filterSessions).' },
  'se-eff': { area: 'Sessions', title: 'Cache efficiency', what: 'How much of the input side came from cache: cache reads ÷ (input + cache write + cache read). Higher is cheaper, because cache reads cost about a tenth of normal input.',
    when: ['Spotting sessions that kept rebuilding their context.'], impact: RO, notes: ['A dash means the session had no input-side tokens.'], tech: 'data.js: eff = cr ÷ (inp + cw + cr), rounded to whole %.' },
  'se-waste': { area: 'Sessions', title: 'Estimated waste and top issue', what: 'Tokens the tracker thinks were spent for nothing: the same file read again, very large tool output, or a context rebuilt after an idle gap. The biggest one is the session\'s top issue.',
    when: ['Deciding which habit to fix first.'], impact: RO, notes: ['It is an estimate from the size of the repeated or oversized content, not a billing figure.', 'Optimizations shows the matching tip when one exists.'], tech: 'tracker.js issue(): reread (same file read twice), oversized (tool output over 30000 chars, waste = extra chars ÷ 4), rebuild (context fell under half after an idle gap, ≥ 20000 tokens).' },
  'se-chart': { area: 'Sessions', title: 'Token Usage Over Time', what: 'Tokens per day for all sessions, split into input, output, cache write and cache read. Cache read uses the right-hand scale because it is usually much larger.',
    when: ['Seeing which days were heavy.'], impact: RO, notes: ['The range (7 or 14 days) is remembered.', 'The chart is not affected by the filters below; the breakdown donut is.'], tech: 'data.js usage(r, range): from r.days.' },
  'se-time': { area: 'Sessions', title: 'Timeline', what: 'One bar per session from start to end. Brighter bars used more tokens. A dot means the end time is not known.',
    when: ['Seeing overlap between sessions, or long sessions.'], impact: RO, notes: ['End times are known for live sessions and the last 20 ended ones the context advisor keeps.'], tech: 'Start/end from responses.json (starts / ended) and the advisor history.' },
  'se-cmp': { area: 'Sessions', title: 'Compare', what: 'The selected session next to any other of the 25 listed: requests, tokens per type, cache efficiency, waste and duration.',
    when: ['Checking whether a change of habit made a session cheaper.'], impact: RO, notes: ['Pick a row in the list to change the left side; use the menu for the right side.'], tech: 'ui.js compareRows(A, B).' },
  'se-ctx': { area: 'Sessions', title: 'Context and handoff', what: 'How full the context window was (live sessions: the last request; ended ones: the peak), how many times it was compacted, and any handoff the advisor saved.',
    when: ['Deciding when to save a handoff and start a fresh chat.'], impact: RO, notes: ['Only live sessions and the last 20 ended ones have context data.'], tech: 'advice.json (context advisor) + advisor history.' },
  'se-csv': { area: 'Sessions', title: 'Export shown sessions', what: 'Saves the sessions that match the current filters as a CSV file, one row per session with every token type, cache efficiency, estimated waste and top issue.',
    when: ['Keeping a record or opening it in a spreadsheet.'], impact: { tokens: 'None used', files: 'Saves one new file to Downloads', privacy: 'The file stays on this PC unless you share it', load: 'None' }, notes: ['Only reads: nothing in the tracker changes.'], tech: 'data.js csv(); file name nexus-sessions-YYYY-MM-DD.csv.' },
});

const DAY = 864e5, PER = 10;
const TYPES = [['inp', 'Input', 'var(--t-in)'], ['out', 'Output', 'var(--t-out)'], ['cw', 'Cache write', 'var(--t-cw)'], ['cr', 'Cache read', 'var(--t-cr)']];
const ISSUE = { rebuild: 'Context rebuilt after an idle gap', oversized: 'Oversized tool output', reread: 'Same file read again' };
// module scope: filters, sort, paging and selection survive leaving the page and coming back
const f = { q: '', project: '', when: 'all', issues: false, live: false };
let sort = S.get('sessions.sort', ['start', -1]), range = S.get('sessions.range', 7), pg = 0, sel = null, other = null, view = 'table';
let root, last = null, rows = [], list = [], drawn = '', ckey = '', anim = true, jump = false;
const $ = id => root?.querySelector('#' + id);
const when = t => t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const full = n => n == null ? '—' : Math.round(n).toLocaleString();
const issueTxt = k => { if (!k) return ''; const [t, ...s] = k.split(':'); return `${ISSUE[t] || t}${s.length ? ': ' + s.join(':') : ''}`; };
const since = w => { if (w === 'all') return 0; const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() - (+w - 1) * DAY; };

export function mount(el, params) {
  root = el; anim = true; ckey = ''; route(params);
  el.innerHTML = `<div class="pg enter">
  <header class="pg-h" style="--i:0">
    <span class="tile-ic pg-ic">${icon('i-clock')}</span>
    <div class="pg-t"><h1>Sessions</h1><p>Every Claude Code session the tracker has logged: tokens, cache, waste and context.</p></div>
    <div class="end" id="s-views"></div>
  </header>
  <div id="s-err"></div>
  <section class="card glass" style="--i:1"><div class="card-h">${icon('i-term')}<h2>Live now</h2><div class="end">${chip('live', 'Read every 2 s from the session files Claude Code keeps in ~/.claude/sessions. No AI, nothing changed.')}<button type="button" class="btn" id="s-lim" data-tip="Asks Claude Code for your plan limits with the smallest possible Haiku request (no tools). Any Assistant answer also refreshes them.">Check limits</button></div></div>
    <div id="s-limits" class="as-note"></div><ul id="s-live" class="as-list" role="list" aria-live="polite"></ul></section>
  <div class="kpis k5" style="--i:1">
    ${kpi('k-n', 'i-db', 'Total Sessions')}${kpi('k-tok', 'i-chart', 'Total Tokens')}${kpi('k-req', 'i-term', 'Requests')}${kpi('k-eff', 'i-gauge', 'Cache Efficiency')}${kpi('k-waste', 'i-bolt', 'Estimated Waste', 'var(--warn)')}
  </div>
  <div class="pgrid r-2-1" style="--i:2">
    <section class="card glass">
      <div class="card-h">${icon('i-chart')}<h2>Token Usage Over Time</h2><div class="end">${chip('live', 'All sessions per day, from the tracker log.')}<select class="btn" id="s-range" aria-label="Chart range"><option value="7">Last 7 days</option><option value="14">Last 14 days</option></select>${more('se-chart', 'Token Usage Over Time')}</div></div>
      <div class="chart pchart" id="s-chart"></div>
      <div class="legend"><span><i style="background:var(--t-in)"></i>Input</span><span><i style="background:var(--t-out)"></i>Output</span><span><i style="background:var(--t-cw)"></i>Cache write</span><span><i style="background:var(--t-cr);height:2px;vertical-align:3px"></i>Cache read (right scale)</span></div>
    </section>
    <section class="card glass">
      <div class="card-h">${icon('i-layers')}<h2>Usage Breakdown</h2><div class="end">${chip('live', 'Token types in the sessions that match the filters below.')}</div></div>
      <div class="brk-wrap"><div class="donut-box" id="s-donut"></div><div class="brk-list" id="s-brk"></div></div>
    </section>
  </div>
  <div class="pgrid r-ws" style="--i:3">
    <div class="side-col">
    <section class="card ws">
      <div class="card-h">${icon('i-clock')}<h2 id="s-title">Recent Sessions</h2>${more('se-list', 'Which sessions are shown')}
        <div class="end tools">
          <label class="field">${icon('i-search')}<input id="s-q" placeholder="Search sessions…" aria-label="Search sessions" value="${esc(f.q)}"></label>
          <select class="btn" id="s-proj" aria-label="Project"></select>
          <select class="btn" id="s-when" aria-label="Date">${[['all', 'All time'], ['1', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days']].map(([v, t]) => `<option value="${v}"${f.when === v ? ' selected' : ''}>${t}</option>`).join('')}</select>
        </div>
      </div>
      <div class="subbar"><div class="tabs chips" id="s-flags"></div><span class="count" id="s-count"></span></div>
      <div id="s-main">${stateBox('loading', 'Loading sessions…')}</div>
    </section>
    <div class="pgrid r-cmp">
      <section class="card">
        <div class="card-h">${icon('i-flow')}<h2>Compare</h2><div class="end">${chip('live', 'Selected session against any other of the 25 newest.')}${more('se-cmp', 'Compare')}</div></div>
        <div id="s-cmp"></div>
      </section>
      <section class="card">
        <div class="card-h">${icon('i-bolt')}<h2>Quick Actions</h2></div>
        <div class="qa">
          <button class="act" id="qa-csv" data-tip="Save the sessions that match the filters as a CSV file in Downloads">${icon('i-arrow-down')}Export shown sessions (CSV)</button>${more('se-csv', 'Export shown sessions')}
          <button class="act" id="qa-copy" data-tip="Copy the full id of the selected session, to find it in Claude Code">${icon('i-code')}Copy selected session id</button>
          <a class="act" href="#/analytics" data-tip="Totals over any range, models and projects">${icon('i-chart')}Open Analytics</a>
        </div>
      </section>
    </div>
    </div>
    <div class="side-col"><section class="card" id="s-det"></section></div>
  </div>
</div>`;
  el.addEventListener('click', e => { if (e.target.closest('button[data-a=retry]')) poll() });
  $('s-range').value = range;
  $('s-range').onchange = e => { range = +e.target.value; S.set('sessions.range', range); drawChart(); };
  $('s-q').oninput = e => { f.q = e.target.value; pg = 0; drawList(); };
  $('s-proj').onchange = e => { f.project = e.target.value; pg = 0; drawList(); };
  $('s-when').onchange = e => { f.when = e.target.value; pg = 0; drawList(); };
  $('s-flags').onclick = e => { const k = e.target.closest('[data-v]')?.dataset.v; if (k) { f[k] = !f[k]; pg = 0; drawList(); } };
  $('qa-csv').onclick = () => {
    if (!list.length) return toast('No sessions match the filters. Clear the search or pick another filter, then export again.', 'warn', 'Nothing to export');
    const name = `nexus-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
    download(name, csv([['session', 'project', 'started', 'ended', 'requests', 'input', 'output', 'cache_write', 'cache_read', 'total', 'cache_efficiency_pct', 'est_waste', 'top_issue'],
      ...list.map(r => [r.full, r.project, r.start && new Date(r.start).toISOString(), r.end && new Date(r.end).toISOString(), r.n, r.inp, r.out, r.cw, r.cr, r.tot, r.eff, r.waste, r.issue])]));
    toast(`Exported ${list.length} sessions to ${name}`);
  };
  $('qa-copy').onclick = async () => {
    const r = rows.find(x => x.id === sel); if (!r) return toast('Pick a session in the list first.', 'warn', 'No session selected');
    try { await navigator.clipboard.writeText(r.full); toast(`Copied ${r.full}`); } catch { toast('Windows did not allow NEXUS to use the clipboard. The id is shown under Session Details: select it and press Ctrl+C.', 'warn', "Couldn't copy"); }
  };
}

function route(params) {
  const p = params[0] || '';
  view = p === 'timeline' ? 'timeline' : 'table';
  if (p && p !== 'timeline') { sel = p; anim = jump = true; }
}
// Same-page route change (row click, Table / Timeline): switch in place, no remount.
export function nav(params) { route(params); if (last) { drawViews(); drawList(); } }

const LS = { needs: ['warn', 'Needs you'], working: ['ok', 'Working'], idle: ['', 'Idle'], unknown: ['', 'Unknown'] };
function live(w) {
  if (!w) return void ($('s-live').innerHTML = '<li class="as-empty">Live sessions not available (tracker too old or not reachable).</li>');
  const L = w.limits?.windows || {}, t = (k, n) => L[k]?.pct != null ? `${n} ${L[k].pct}%${L[k].expired ? ' (window reset since)' : ''}` : null;
  $('s-limits').textContent = [t('five_hour', '5-hour limit'), t('seven_day', '7-day limit')].filter(Boolean).join(' · ') + (w.limits?.at ? ` · reported ${ago(w.limits.at)}` : 'Limits not reported yet: press Check limits.');
  $('s-live').innerHTML = w.sessions.length ? w.sessions.map(s => `<li><span><span class="dot ${LS[s.state]?.[0] || ''}"></span> <b>${esc(s.name)}</b> <small>${esc(LS[s.state]?.[1] || s.state)}${s.why ? ': ' + esc(s.why) : ''} · ${ago(s.since)} · ${esc(s.cwd || '')}</small></span></li>`).join('') : '<li class="as-empty">No Claude Code session is running.</li>';
}
export function update(st) {
  if (!root) return;
  drawViews(); live(st.w);
  $('s-err').innerHTML = !st.r && st.at ? errBox({ title: 'Tracker not reachable', where: 'Sessions', what: "NEXUS can't reach its tracker, so the session list can't load.", why: "No sessions, totals or details can show. Nothing is lost: the tracker keeps its own log.", affected: 'The session list, details and compare. ' + retryText(),
    steps: ['Make sure the tracker is running: node ~/.claude/token-tracker/tracker.js serve', 'Press Retry now.'], actions: [['retry', 'Retry now', true]], tech: 'GET /api failed (api.js poll). Retry now runs the same poll at once.' }) : ''; // B76: at the top, not below the fold
  if (!st.r) return void ($('s-main').innerHTML = st.at ? stateBox('error', 'No sessions to show.', 'See the message at the top of the page.') : stateBox('loading', 'Loading sessions…'));
  const k = JSON.stringify([st.r.sessions, st.r.days?.slice(-14), st.r.advisor?.sessions?.map(x => x.ctx), st.r.advisor?.history?.length, st.r.advisor?.log?.[0], st.p?.cur?.n]);
  if (k === drawn) return; drawn = k; // redraw only on real change
  last = st; rows = sessions(st.r, st.p);
  drawChart(); drawList();
}
export function resize() { if (last && root) { drawChart(); if (view === 'timeline') drawTimeline(); } }
export function unmount() { root = null; drawn = ''; }
addEventListener('click', async e => {
  const b = e.target.closest?.('#s-lim'); if (!b) return;
  b.disabled = true; b.textContent = 'Checking…';
  try { const x = await fetch('/api/watch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"op":"probe"}' }), j = await x.json(); if (j.res !== 'ok') toast(j.res, 'err', "Couldn't check limits"); else toast('Limits updated from Claude Code.', 'ok', 'Limits checked'); await poll() }
  catch { toast('The tracker did not answer.', 'err', "Couldn't check limits") }
  b.disabled = false; b.textContent = 'Check limits';
});

function drawViews() { $('s-views').innerHTML = seg([['table', 'Table', '#/sessions' + (sel ? '/' + sel : '')], ['timeline', 'Timeline', '#/sessions/timeline']], view); }

function drawChart() {
  const u = usage(last.r, range, Date.now()), el = $('s-chart'), k = range + JSON.stringify(u.s) + el.clientWidth + 'x' + el.clientHeight;
  if (k === ckey) return; ckey = k;
  el.classList.remove('shown'); chart(el, u.s);
}

// Everything that depends on the filters.
function drawList() {
  const projects = [...new Set(rows.map(r => r.project))];
  if (f.project && !projects.includes(f.project)) f.project = '';
  $('s-proj').innerHTML = [['', 'All projects'], ...projects.map(p => [p, p])].map(([v, t]) => `<option value="${esc(v)}"${v === f.project ? ' selected' : ''}>${esc(t)}</option>`).join('');
  $('s-flags').innerHTML = [['issues', 'With issues', 'Only sessions with an estimated waste pattern'], ['live', 'Live now', 'Only sessions that are still running']].map(([k, t, tip]) => `<button class="tab${f[k] ? ' on' : ''}" data-v="${k}" aria-pressed="${f[k]}" data-tip="${tip}">${t}</button>`).join('');
  list = sortBy(filterSessions(rows, { ...f, since: since(f.when) }), sort[0], sort[1]);
  if (!rows.some(r => r.id === sel)) sel = rows[0]?.id || null;
  const sumOf = k => list.reduce((a, r) => a + (r[k] || 0), 0), tot = sumOf('tot'), eff = pct(sumOf('cr'), sumOf('inp') + sumOf('cw') + sumOf('cr'));
  setKpi($('k-n'), list.length, n => String(Math.round(n)), list.length === rows.length ? `${rows.length} newest tracked` : `of ${rows.length} newest tracked`, chip('live'));
  setKpi($('k-tok'), tot, tok, `${full(tot)} tokens`, chip('live'));
  setKpi($('k-req'), sumOf('n'), n => Math.round(n).toLocaleString(), `${sumOf('n') ? tok(tot / sumOf('n')) : '—'} tokens per request`, chip('live'));
  setKpi($('k-eff'), eff, n => n == null ? '—' : Math.round(n) + '%', 'cache read ÷ input side', (eff == null ? chip('unk', 'No input-side tokens in the shown sessions.') : chip('live', 'Cache reads ÷ (input + cache write + cache read).')) + more('se-eff', 'Cache efficiency'));
  setKpi($('k-waste'), sumOf('waste'), tok, tot ? `${(sumOf('waste') / tot * 100).toFixed(1)}% of shown tokens` : 'no tokens shown', chip('est', 'Estimated by the tracker from re-reads, oversized output and context rebuilds.') + more('se-waste', 'Estimated waste'));
  const parts = TYPES.map(([k, t, c]) => [t, sumOf(k), c]);
  donut($('s-donut'), parts, tok(tot), 'tokens');
  $('s-brk').innerHTML = parts.map(([t, v, c]) => `<div class="bl"><span class="sw" style="background:${c}"></span><span>${t}</span><b>${tok(v)}</b><small>${pct(v, tot) ?? 0}%</small></div>`).join('');
  $('s-count').textContent = `${list.length} of ${rows.length} sessions`;
  $('s-title').textContent = view === 'timeline' ? 'Session Timeline' : 'Recent Sessions';
  if (view === 'timeline') drawTimeline(); else drawTable();
  drawDetail(); drawCompare();
}

const COLS = [
  ['id', 'Session', { f: (v, r) => `<span class="sx"><span class="sx-ic${r.live ? ' live' : ''}">${icon('i-term')}</span><span class="sx-t"><b class="mono">${esc(v)}</b><small>${when(r.start)}</small></span></span>` }],
  ['project', 'Project', { f: v => `<span class="pchip">${icon('i-folder')}<span>${esc(v)}</span></span>` }],
  ['n', 'Requests', { num: 1, f: full }],
  ['tot', 'Tokens', { num: 1, f: (v, r) => `<b data-html="1" data-tip="${esc(TYPES.map(([k, t]) => `${t} ${tok(r[k])}`).join('<br>'))}">${tok(v)}</b>` }],
  ['eff', 'Cache', { num: 1, tip: 'Cache efficiency: cache reads ÷ input side.', f: v => v == null ? '<span class="muted">—</span>' : v + '%' }],
  ['waste', 'Waste <small>est.</small>', { num: 1, tip: 'Estimated tokens lost to waste patterns.', f: v => v ? `<span class="wv">${tok(v)}</span>` : '<span class="muted">0</span>' }],
  ['dur', 'Duration', { num: 1, f: (v, r) => v == null ? '<span class="muted" data-tip="End not known: older than the 20 ended sessions the advisor keeps.">—</span>' : dur(v) + (r.live ? '<span class="lv">live</span>' : '') }],
  ['start', 'Started', { num: 1, f: v => `<span class="muted">${v ? ago(v) : '—'}</span>` }],
];

function drawTable() {
  const el = $('s-main');
  if (!list.length) return void (el.innerHTML = stateBox('empty', 'No sessions match.', 'Clear the search or pick another filter.'));
  const pages = Math.ceil(list.length / PER), at = list.findIndex(r => r.id === sel);
  if (jump && at >= 0) pg = Math.floor(at / PER); jump = false; // opening a session: jump to the page that holds it
  pg = Math.max(0, Math.min(pg, pages - 1));
  const shown = list.slice(pg * PER, pg * PER + PER);
  el.innerHTML = '<div class="tbl-wrap" id="s-tbl"></div><div class="pager" id="s-pager"></div>';
  table($('s-tbl'), COLS, shown, sort, {
    sort: k => { sort = [k, sort[0] === k ? -sort[1] : (k === 'project' || k === 'id' ? 1 : -1)]; S.set('sessions.sort', sort); pg = 0; drawList(); },
    row: r => location.hash = '#/sessions/' + r.id,
  });
  $('s-tbl').querySelectorAll('tbody tr').forEach((tr, i) => { tr.classList.toggle('sel', shown[i].id === sel); if (anim) { tr.classList.add('in'); tr.style.setProperty('--i', i); } });
  anim = false;
  $('s-pager').innerHTML = `<span class="muted">Showing ${pg * PER + 1}–${pg * PER + shown.length} of ${list.length}</span><div class="pg-btns"><button class="pgb" data-p="${pg - 1}" ${pg ? '' : 'disabled'} aria-label="Previous page">‹</button>${Array.from({ length: pages }, (_, i) => `<button class="pgb${i === pg ? ' on' : ''}" data-p="${i}" aria-label="Page ${i + 1}">${i + 1}</button>`).join('')}<button class="pgb" data-p="${pg + 1}" ${pg < pages - 1 ? '' : 'disabled'} aria-label="Next page">›</button></div>`;
  $('s-pager').onclick = e => { const b = e.target.closest('[data-p]'); if (b && !b.disabled) { pg = +b.dataset.p; anim = false; drawTable(); } };
}

// Gantt: one row per session, start → end (advisor history) or now (live).
function drawTimeline() {
  const el = $('s-main'), now = Date.now(), L = sortBy(list.filter(r => r.start), 'start', 1);
  if (!L.length) return void (el.innerHTML = stateBox('empty', 'No sessions match.', 'Clear the search or pick another filter.'));
  el.innerHTML = `<div class="tl" id="tl"></div><div class="lgd"><span><i></i>Ended</span><span><i class="live"></i>Live now</span><span><i class="unk"></i>End not known</span><span>Brightness = tokens used · click a row for details</span>${more('se-time', 'Timeline')}</div>`;
  const box = $('tl'), W = box.clientWidth, LBL = 190, R = 12, row = 30, T = 28, H = T + L.length * row + 4, iw = W - LBL - R;
  const t0 = L[0].start, t1 = Math.max(now, ...L.map(r => r.end || r.start)), span = t1 - t0 || 1;
  const x = t => LBL + (t - t0) / span * iw, mx = Math.log10(Math.max(...L.map(r => r.tot), 10));
  let g = '';
  for (let d = new Date(t0); d <= t1; d.setDate(d.getDate() + 1)) { // a tick at every local midnight
    const m = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); if (m < t0) continue;
    g += `<line class="gl" x1="${x(m)}" x2="${x(m)}" y1="${T - 10}" y2="${H}"/><text x="${x(m) + 5}" y="${T - 14}">${new Date(m).toLocaleDateString([], { weekday: 'short', day: 'numeric' })}</text>`;
  }
  g += L.map((r, i) => {
    const y = T + i * row, end = r.end || (r.live ? now : null), a = .35 + .65 * Math.log10(Math.max(r.tot, 10)) / mx;
    const tip = `<b>${esc(r.project)} · ${r.id}</b><br>${when(r.start)}${end ? ' → ' + when(end) + ` (${dur(end - r.start)})` : ' · end not known'}<br>${r.n} requests · ${tok(r.tot)} tokens`;
    const mark = end ? `<rect class="tb${r.live ? ' live' : ''}" x="${x(r.start)}" y="${y + 8}" width="${Math.max(5, x(end) - x(r.start))}" height="${row - 16}" rx="4" style="opacity:${a.toFixed(2)};--i:${i}"/>` : `<circle class="tb unk" cx="${x(r.start) + 5}" cy="${y + row / 2}" r="4.5"/>`;
    return `<a href="#/sessions/${r.id}" data-html="1" data-tip="${esc(tip)}" class="${r.id === sel ? 'sel' : ''}"><rect class="hit" x="0" y="${y + 1}" width="${W}" height="${row - 2}" rx="6"/><text class="tl-l" x="10" y="${y + row / 2 + 4}"><tspan class="mono">${r.id}</tspan>  ${esc(r.project.length > 14 ? r.project.slice(0, 13) + '…' : r.project)}</text>${mark}</a>`;
  }).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}">${g}</svg>`;
}

function drawDetail() {
  const el = $('s-det'), r = rows.find(x => x.id === sel);
  if (!r) return void (el.innerHTML = `<div class="card-h">${icon('i-book')}<h2>Session Details</h2></div>${stateBox('empty', 'No session selected', 'Select a session from the list to see its details.')}`);
  const fix = (last.r.fixes || []).find(x => x[0] === r.issue.replace(':', ' · '));
  el.innerHTML = `<div class="card-h">${icon('i-book')}<h2>Session Details</h2><div class="end"><span class="pill${r.live ? '' : ' unk'}"><span class="dot${r.live ? ' ok' : ''}"></span>${r.live ? 'Live' : 'Ended'}</span></div></div>
  <div class="det">
    <div class="det-id"><span class="sx-ic${r.live ? ' live' : ''}">${icon('i-term')}</span><div><b>${esc(r.project)}</b><span class="mono muted">${esc(r.full)}</span></div></div>
    <dl class="dl g4">
      <div><dt>Started</dt><dd>${when(r.start)}</dd></div>
      <div><dt>Duration</dt><dd>${r.dur == null ? '<span class="muted" data-tip="End not known: older than the 20 ended sessions the advisor keeps.">unknown</span>' : dur(r.dur)}</dd></div>
      <div><dt>Requests</dt><dd>${full(r.n)}</dd></div>
      <div><dt>Model</dt><dd>${r.model || '<span class="muted" data-tip="The tracker reports the model only for the current session.">unknown</span>'}</dd></div>
    </dl>
    <h3>Token breakdown ${chip('live')}</h3>
    <div class="brk">${TYPES.map(([k, t, c]) => `<div class="brow"><span class="sw" style="background:${c}"></span><span>${t}</span><div class="bar"><i style="width:${pct(r[k], r.tot) || 0}%;background:${c};box-shadow:none"></i></div><b data-tip="${full(r[k])} tokens">${tok(r[k])}</b></div>`).join('')}</div>
    <dl class="dl g3"><div><dt>Total</dt><dd>${tok(r.tot)}</dd></div><div><dt>Cache eff.</dt><dd>${r.eff == null ? '—' : r.eff + '%'}</dd></div><div><dt>Per request</dt><dd>${tok(r.perReq)}</dd></div></dl>
    <h3>Context ${more('se-ctx', 'Context and handoff')} ${r.ctx != null || r.peak != null ? chip('live', r.live ? 'From the context advisor (last request).' : 'From the advisor history when the session ended.') : chip('unk', 'The advisor keeps live sessions and the last 20 ended ones.')}</h3>
    ${r.ctx != null ? `<div class="ctx-live">${ring('d-ring', 'context')}<div><b>${tok(r.ctx)} / ${tok(r.win)}</b><span class="muted">${esc(r.health || '')}</span><p>${esc(r.advice || '')}</p></div></div>`
      : r.peak != null ? `<dl class="dl g3"><div><dt>Peak</dt><dd>${tok(r.peak)}</dd></div><div><dt>Compactions</dt><dd>${r.k}</dd></div><div><dt>Ended</dt><dd class="sm">${esc(r.why || '—')}</dd></div></dl>`
      : '<p class="muted sm">No context data: this session ended before the 20 the advisor keeps.</p>'}
    ${r.spark?.length > 1 ? '<div class="spark det-spark"><canvas id="d-spark"></canvas><span class="cap">context per request</span></div>' : ''}
    <h3>Top issue ${more('se-waste', 'Estimated waste')} ${r.issue ? chip('est', 'Waste is estimated from the size of the repeated or oversized content.') : ''}</h3>
    ${r.issue ? `<div class="issue"><b>${esc(issueTxt(r.issue))}</b><span class="muted sm">~${tok(r.waste)} tokens est. waste in this session</span>${fix?.[3] ? `<p class="fix">${icon('i-check')}<span>${esc(fix[3])}</span></p>` : ''}</div>` : '<p class="muted sm">No waste pattern found.</p>'}
    <h3>Handoff &amp; advisor</h3>
    ${r.log.length ? `<div class="hlog">${r.log.slice(0, 4).map(x => `<div><span class="dot ok"></span><span>${esc(x[2])}<small>${esc(x[3])}</small></span><small>${ago(x[0])}</small></div>`).join('')}</div>` : '<p class="muted sm">No handoff saved for this session.</p>'}
  </div>`;
  if (r.ctx != null) requestAnimationFrame(() => setRing($('d-ring'), r.ctx / r.win * 100, pct(r.ctx, r.win) + '%', r.ctx / r.win > .85));
  if (r.spark?.length > 1) requestAnimationFrame(() => $('d-spark') && spark($('d-spark'), r.spark));
}

function drawCompare() {
  const el = $('s-cmp'), A = rows.find(x => x.id === sel);
  if (!A || rows.length < 2) return void (el.innerHTML = stateBox('empty', 'Needs at least two sessions.'));
  if (!other || other === sel || !rows.some(r => r.id === other)) other = rows.find(r => r.id !== sel).id;
  const B = rows.find(x => x.id === other);
  el.innerHTML = `<div class="cmp-pick"><span class="mono">${A.id}</span><span class="muted">vs</span><select class="btn" id="s-other" aria-label="Compare with">${rows.filter(r => r.id !== sel).map(r => `<option value="${r.id}"${r.id === other ? ' selected' : ''}>${r.id} · ${esc(r.project)}</option>`).join('')}</select></div>${compareRows(A, B, ['Selected', 'Other'])}`;
  $('s-other').onchange = e => { other = e.target.value; drawCompare(); };
}
