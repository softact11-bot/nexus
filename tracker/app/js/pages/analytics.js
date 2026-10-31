// Analytics: token use over a range (7/14/30/all), each type separately, cache efficiency, models, projects, savings, session compare, CSV.
import { analytics, sessions, csv } from '../data.js';
import { tok, esc, chip, pct } from '../fmt.js';
import { icon, seg, stateBox, area, chart, kpi, setKpi, donut, download, toast, compareRows, savedStrip, setSaved, MORE, more, errBox } from '../ui.js';
import { poll, retryText } from '../api.js';
import * as S from '../settings.js';

// M7d D3 Learn More (approved Analytics copy). All read-only, local, no tokens.
const RO = { tokens: 'None used', files: 'Nothing changed', privacy: 'Stays on this PC', load: 'None' };
Object.assign(MORE, {
  'an-types': { area: 'Analytics', title: 'Token types', what: 'Input is what Claude reads. Output is what it writes. Cache write stores a reusable chunk of context; cache read reuses it, which costs much less than reading it fresh.',
    when: ['Working out where your usage goes.'], impact: RO, notes: ['Total = all four types added up.', 'Colours match the charts: each type keeps its colour everywhere.'], tech: 'Per day from the tracker log (input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens).' },
  'an-eff': { area: 'Analytics', title: 'Cache efficiency', what: 'Cache reads ÷ (input + cache write + cache read). Higher means more of each request came from cache, so the same work costs less.',
    when: ['Checking whether long sessions reuse context well.'], impact: RO, notes: ['Days with no requests are blank, not zero.', 'Output is not part of it: only the input side can come from cache.'], tech: 'eff = cr / (inp + cw + cr) × 100, per day and over the range.' },
  'an-alltime': { area: 'Analytics', title: 'All-time cards', what: 'Model Usage and Project Comparison show all tracked time. The tracker does not split them per day, so the 7 / 14 / 30-day buttons do not change them.',
    when: ['Comparing models or projects overall.'], impact: RO, notes: ['The top 6 are shown; the rest are counted below the list.'], tech: 'From the tracker totals per model / project, not from the daily log.' },
  'an-savings': { area: 'Analytics', title: 'Optimization savings', what: 'What the tracker estimates each tip saved: waste per session before vs after the tip, times the sessions since.',
    when: ['Seeing which tips helped.'], impact: RO, notes: ['Est. saved is an estimate, not measured token-for-token.', 'Verified stays 0 until a tip is proven by a measured before/after.', 'Net = est. saved − what the tip itself costs.', 'None of these are billing figures or charges.'], tech: 'Tracker before/after check per tip (status: Worked / No clear effect / Measuring).' },
  'an-csv': { area: 'Analytics', title: 'Export CSV', what: 'Downloads one row per day in the selected range: input, output, cache write, cache read, total, cache efficiency % and whether that day was tracked.',
    when: ['Keeping your own records or opening the numbers in a spreadsheet.'], impact: { ...RO, files: 'One .csv saved to your downloads folder' }, notes: ['Nothing is sent anywhere.', 'Days before tracking started are marked tracked = no.'], tech: 'Built in the page and saved through a browser download (Blob).' } });
const retryTxt = () => 'All charts and totals on this page. ' + retryText();

const TYPES = [['inp', 'Input', 'var(--t-in)'], ['out', 'Output', 'var(--t-out)'], ['cw', 'Cache write', 'var(--t-cw)'], ['cr', 'Cache read', 'var(--t-cr)']];
const RANGES = [[7, '7 days'], [14, '14 days'], [30, '30 days'], ['all', 'All time']];
const ALLTIME = 'All tracked time. The tracker does not split this per day, so the range does not apply.';
let root, last = null, a = null, rows = [], drawn = '', ckey = '', range = S.get('analytics.range', 7), pick = [null, null];
const $ = id => root?.querySelector('#' + id);
const full = n => n == null ? '—' : Math.round(n).toLocaleString();
const day = k => new Date(k + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

export function mount(el) {
  root = el; ckey = '';
  el.innerHTML = `<div class="pg enter">
  <header class="pg-h" style="--i:0">
    <span class="tile-ic pg-ic">${icon('i-chart')}</span>
    <div class="pg-t"><h1>Analytics</h1><p id="a-sub">Token use over time, by type, model, project and session.</p></div>
    <div class="end"><div id="a-range"></div><button class="btn pri" id="a-csv">${icon('i-arrow-down')}Export CSV</button>${more('an-csv', 'Export CSV')}</div>
  </header>
  <div class="kpis k6" style="--i:1">
    ${kpi('a-tot', 'i-db', 'Total Tokens')}${kpi('a-inp', 'i-arrow-down', 'Input', 'var(--t-in)')}${kpi('a-out', 'i-arrow-up', 'Output', 'var(--t-out)')}${kpi('a-cw', 'i-layers', 'Cache Write', 'var(--t-cw)')}${kpi('a-cr', 'i-spark', 'Cache Read', 'var(--t-cr)')}${kpi('a-eff', 'i-gauge', 'Cache Efficiency')}
  </div>
  ${savedStrip()}
  <div id="a-body"></div>
</div>`;
  el.addEventListener('click', e => { if (e.target.closest('button[data-a=retry]')) poll() });
  $('a-range').onclick =e => { const v = e.target.closest('[data-v]')?.dataset.v; if (!v) return; range = v === 'all' ? v : +v; S.set('analytics.range', range); drawn = ''; update(last); };
  $('a-csv').onclick = () => {
    if (!a?.len) return toast('No data to export yet.', 'warn');
    const name = `nexus-daily-${range === 'all' ? 'all' : range + 'd'}-${a.s.at(-1).k}.csv`;
    download(name, csv([['date', 'input', 'output', 'cache_write', 'cache_read', 'total', 'cache_efficiency_pct', 'tracked'],
      ...a.s.map(d => [d.k, d.inp, d.out, d.cw, d.cr, d.inp + d.out + d.cw + d.cr, d.eff ?? '', d.pre ? 'no' : 'yes'])]));
    toast(`Exported ${a.s.length} days to ${name}`);
  };
}

export function update(st) {
  if (!root || !st) return;
  $('a-range').innerHTML = seg(RANGES, range);
  if (!st.r) return void ($('a-body').innerHTML = st.at ? errBox({ title: 'Tracker not reachable', where: 'Analytics', what: "NEXUS can't reach its tracker, so there is no data to show.", why: "The charts and totals can't load. Nothing is lost: the tracker keeps its own log.", affected: retryTxt(),
    steps: ['Make sure the tracker is running: node ~/.claude/token-tracker/tracker.js serve', 'Press Retry now.'], actions: [['retry', 'Retry now', true]], tech: 'GET /api failed (api.js poll). Retry now runs the same poll at once.' }) : stateBox('loading', 'Loading analytics…'));
  last = st; a = analytics(st.r, range); rows = sessions(st.r, st.p); setSaved(root, st.r.savings);
  const k = range + JSON.stringify(a) + JSON.stringify(st.r.sessions) + JSON.stringify(st.r.opts); if (k === drawn) return; drawn = k;
  draw();
}
export function resize() { if (a?.len && root) charts(); }
export function unmount() { root = null; drawn = ''; }

function draw() {
  const t = a.t, inSide = t.inp + t.cw + t.cr, tracked = a.s.filter(d => !d.pre), active = tracked.filter(d => d.inp + d.out + d.cw + d.cr);
  $('a-sub').innerHTML = `${a.len} day${a.len === 1 ? '' : 's'}${a.s.length ? ` · ${day(a.s[0].k)} to ${day(a.s.at(-1).k)}` : ''}${a.pre ? ` · <span class="warn-t" data-tip="Tracking started ${esc(a.first)}. Earlier days are unknown, not zero.">${a.pre} day${a.pre > 1 ? 's' : ''} before tracking started (unknown)</span>` : ''}`;
  setKpi($('a-tot'), t.all, tok, `${full(t.all)} tokens`, chip('live'));
  for (const [k] of TYPES) setKpi($('a-' + k), t[k], tok, `${pct(t[k], t.all) ?? 0}% of total`, chip('live'));
  setKpi($('a-eff'), a.eff, n => n == null ? '—' : Math.round(n) + '%', 'cache read ÷ input side', a.eff == null ? chip('unk', 'No input-side tokens in this range.') : chip('live', 'Cache reads ÷ (input + cache write + cache read) over the range.'));
  if (!a.len) return void ($('a-body').innerHTML = stateBox('empty', 'No tracked days yet.', 'Use Claude Code for a while and come back.'));
  const peak = active.reduce((m, d) => (d.inp + d.out + d.cw + d.cr) > (m ? m.inp + m.out + m.cw + m.cr : -1) ? d : m, null), tt = d => d.inp + d.out + d.cw + d.cr;
  $('a-body').innerHTML = `
<div class="pgrid r-2-1 enter">
  <section class="card glass" style="--i:2">
    <div class="card-h">${icon('i-chart')}<h2>Token Usage Over Time</h2><div class="end">${chip('live', 'Per day from the tracker log. Days before tracking started are unknown and shown empty.')}</div></div>
    <div class="chart pchart" id="a-chart"></div>
    <div class="legend"><span><i style="background:var(--t-in)"></i>Input</span><span><i style="background:var(--t-out)"></i>Output</span><span><i style="background:var(--t-cw)"></i>Cache write</span><span><i style="background:var(--t-cr);height:2px;vertical-align:3px"></i>Cache read (right scale)</span></div>
  </section>
  <section class="card glass" style="--i:3">
    <div class="card-h">${icon('i-layers')}<h2>Usage Breakdown</h2><div class="end">${chip('live')}${more('an-types', 'Token types')}</div></div>
    <div class="brk-wrap"><div class="donut-box" id="a-donut"></div><div class="brk-list">${TYPES.map(([k, n, c]) => `<div class="bl"><span class="sw" style="background:${c}"></span><span>${n}</span><b>${tok(t[k])}</b><small>${pct(t[k], t.all) ?? 0}%</small></div>`).join('')}</div></div>
  </section>
</div>
<div class="pgrid r-2-1 enter">
  <section class="card" style="--i:4">
    <div class="card-h">${icon('i-layers')}<h2>Token Types Over Time</h2><div class="end"><span class="muted sm">each type on its own scale</span>${chip('live')}</div></div>
    <div class="multi">${TYPES.map(([k, n, c]) => `<div class="mini"><div class="mini-h"><span class="sw" style="background:${c}"></span>${n}<b>${tok(t[k])}</b></div><div class="achart" id="c-${k}"></div></div>`).join('')}</div>
  </section>
  <section class="card" style="--i:5">
    <div class="card-h">${icon('i-gauge')}<h2>Cache Efficiency</h2><div class="end">${chip('live', 'Per day: cache reads ÷ (input + cache write + cache read). Higher means more of each request came from cache.')}${more('an-eff', 'Cache efficiency')}</div></div>
    <div class="eff-top"><b>${a.eff == null ? '—' : a.eff + '%'}</b><span class="muted sm">${inSide ? `${tok(t.cr)} of ${tok(inSide)} input-side tokens came from cache` : 'No requests in this range.'}</span></div>
    <div class="achart tall" id="c-eff"></div>
    <p class="muted sm">Days with no requests are left blank, not zero.</p>
  </section>
</div>
<div class="pgrid r-3 enter">
  <section class="card" style="--i:6">
    <div class="card-h">${icon('i-chip')}<h2>Model Usage</h2><div class="end">${chip('live', ALLTIME)}${more('an-alltime', 'All-time cards')}</div></div>
    ${bars(a.models, 'No model usage recorded.')}
  </section>
  <section class="card" style="--i:7">
    <div class="card-h">${icon('i-folder')}<h2>Project Comparison</h2><div class="end">${chip('live', ALLTIME)}${more('an-alltime', 'All-time cards')}</div></div>
    ${bars(a.projects, 'No project usage recorded.')}
  </section>
  <section class="card" style="--i:8">
    <div class="card-h">${icon('i-spark')}<h2>Optimization Savings</h2><div class="end">${chip('est', 'Estimated by the tracker: waste per session before vs after each tip, times sessions since. Not measured token-for-token.')}${more('an-savings', 'Optimization savings')}</div></div>
    ${savings()}
  </section>
</div>
<div class="pgrid r-2-1 enter">
  <section class="card" style="--i:9">
    <div class="card-h">${icon('i-flow')}<h2>Session Comparison</h2><div class="end">${chip('live', 'Any two of your 25 newest sessions.')}</div></div>
    <div id="cmp"></div>
  </section>
  <section class="card" style="--i:10">
    <div class="card-h">${icon('i-cal')}<h2>Range Summary</h2><div class="end">${chip('live')}</div></div>
    <dl class="dl g2 sum-dl">
      <div><dt>Days with requests</dt><dd>${active.length} <small class="muted">of ${tracked.length} tracked</small></dd></div>
      <div><dt>Average per active day</dt><dd>${active.length ? tok(t.all / active.length) : '—'}</dd></div>
      <div><dt>Peak day</dt><dd>${peak ? `${tok(tt(peak))} <small class="muted">${day(peak.k)}</small>` : '—'}</dd></div>
      <div><dt>Output share</dt><dd>${pct(t.out, t.all) ?? '—'}${t.all ? '%' : ''}</dd></div>
      <div><dt>Tracking started</dt><dd>${a.first ? day(a.first) : '—'}</dd></div>
      <div><dt>Unknown days in range</dt><dd>${a.pre}</dd></div>
    </dl>
  </section>
</div>`;
  ckey = ''; charts(); compare();
}

function bars(list, empty) {
  if (!list.length) return stateBox('empty', empty);
  return `<div class="cmpbars">${list.slice(0, 6).map(x => `<div class="cb" data-html="1" data-tip="${esc(`<b>${esc(x.name)}</b><br>${TYPES.map(([, n], i) => `${n} ${tok(x.v[i])}`).join('<br>')}`)}">
    <div class="cb-h"><span class="n">${esc(x.name)}</span><b>${tok(x.tot)}</b><small>${x.share}%</small></div><div class="stack">${TYPES.map(([, , c], i) => `<i style="width:${x.v[i] / list[0].tot * 100}%;background:${c}"></i>`).join('')}</div></div>`).join('')}</div>
  ${list.length > 6 ? `<p class="muted sm">${list.length - 6} more not shown.</p>` : ''}`;
}

// Tip results from the tracker's before/after check. Estimated waste saved; nothing here is verified token-for-token.
function savings() {
  const sv = last.r.saved, opts = last.r.opts || [];
  if (!sv && !opts.length) return stateBox('empty', 'No optimization data yet.');
  const st = s => /^verified/.test(s) ? ['ver', 'Worked'] : /no clear/.test(s) ? ['unk', 'No clear effect'] : ['est', 'Measuring'];
  return `<div class="sv-top"><div><span class="k">Est. tokens saved</span><b class="sv-v">${tok(sv?.estimated)}</b></div><div><span class="k">Verified</span><b class="sv-v dim">${sv?.verified ? tok(sv.verified) : '0'}</b></div></div>
  <div class="sv-list">${opts.map(o => { const [c, t] = st(o.status || ''); return `<div class="sv" data-tip="${esc(o.status || '')}"><span class="n">${esc(o.name)}</span><span class="chip ${c}">${t}</span><b class="${o.net < 0 ? 'down' : 'up'}">${o.net < 0 ? '−' : '+'}${tok(Math.abs(o.net || 0))}</b></div>`; }).join('')}</div>
  <p class="muted sm">Net = est. saved − tokens the tip itself costs. ${opts[0]?.n ? `${opts[0].n} sessions since tips started.` : ''}</p>`;
}

function charts() {
  const el = $('a-chart'); if (!el) return;
  const key = range + el.clientWidth + 'x' + el.clientHeight; if (key === ckey) return; ckey = key;
  el.classList.remove('shown'); chart(el, a.s);
  donut($('a-donut'), TYPES.map(([k, n, c]) => [n, a.t[k], c]), tok(a.t.all), 'tokens');
  const keys = a.s.map(d => d.k), tip = (d, line) => `<b>${day(d.k)}</b><br>${d.pre ? 'Not tracked yet (unknown)' : line}`;
  for (const [k, n, c] of TYPES) area($('c-' + k), a.s.map(d => d.pre ? null : d[k]), keys, { color: c, tip: i => tip(a.s[i], `${n}: ${full(a.s[i][k])}`) });
  area($('c-eff'), a.s.map(d => d.eff), keys, { color: 'var(--t-cr)', max: 100, f: v => Math.round(v) + '%', tip: i => tip(a.s[i], a.s[i].eff == null ? 'No requests' : `Cache efficiency ${a.s[i].eff}%`) });
}

function compare() {
  const el = $('cmp');
  if (rows.length < 2) return void (el.innerHTML = stateBox('empty', 'Needs at least two sessions.'));
  pick = pick.map((id, i) => rows.some(r => r.id === id) ? id : rows[i].id);
  const opt = cur => rows.map(r => `<option value="${r.id}"${r.id === cur ? ' selected' : ''}>${esc(r.project)} · ${r.id} · ${new Date(r.start).toLocaleDateString([], { month: 'short', day: 'numeric' })}</option>`).join('');
  const [A, B] = pick.map(id => rows.find(r => r.id === id));
  el.innerHTML = `<div class="cmp-pick"><select class="btn" id="cmp-a" aria-label="Session A">${opt(pick[0])}</select><span class="muted">vs</span><select class="btn" id="cmp-b" aria-label="Session B">${opt(pick[1])}</select></div>${compareRows(A, B)}`;
  $('cmp-a').onchange = e => { pick[0] = e.target.value; compare(); };
  $('cmp-b').onchange = e => { pick[1] = e.target.value; compare(); };
}
