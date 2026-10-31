// Home page: mount once, then update() on every poll. Each number carries its source chip.
import { home, usage } from './data.js';
import { tok, bytes, ago, dur, esc, chip } from './fmt.js';
import { counter, spark, ring, setRing, chart, savedStrip, setSaved, MORE, more } from './ui.js';
import { retryText, liveEvery } from './api.js';

// M7d D3 Learn More (approved Home copy). Read-only, local, no tokens.
const RO = { tokens: 'None used', files: 'Nothing changed', privacy: 'Stays on this PC', load: 'None' };
Object.assign(MORE, {
  'home-5h': { area: 'Home', title: '5h Usage', what: 'Tokens used in the current 5-hour window. The window starts at your first request and lasts 5 hours, so the reset time is an estimate.',
    when: ['Checking how close you are to your 5-hour limit.'], impact: RO, notes: ['A percent shows only when your plan\'s 5-hour limit is set in Settings (5-hour window limit).', 'NEXUS only shows this. Your real Claude limit stays the same.'], tech: 'Window start and reset come from the tracker log.' },
  'home-week': { area: 'Home', title: 'Weekly', what: 'All token types added up over the last 7 days.',
    when: ['Seeing how much you used this week.'], impact: RO, notes: ['No weekly limit is known, so no percent is shown.'], tech: 'Sum of the last 7 tracked days, all token types.' },
  'home-status': { area: 'Home', title: 'Claude Code Status', what: 'What your latest Claude Code session is doing.',
    when: ['Checking whether Claude is working and how full its context is.'], impact: RO, notes: ['Running = a request was logged in the last 5 minutes; Idle = none.', 'Context = current context size vs where compaction happened on average (measured).', 'Cache Efficiency = today: cache reads ÷ all input-side tokens.', 'Estimated Reset = end of the 5-hour window.', 'Open Terminal opens the Claude Code page.'], tech: 'From the tracker log of the latest session.' },
  'home-core': { area: 'Home', title: 'RGB core', what: 'The animated core shows NEXUS activity. While a Claude Code session is active it spins faster, draws more lines and glows a little brighter.',
    when: ['A quick look at whether Claude is busy.'], impact: { ...RO, load: 'Uses the graphics card only while Home is visible' }, notes: ['It pulses when new data arrives and flashes when a sync finishes or the tracker comes back.', 'Reduced motion (Settings) slows it right down.'], tech: 'Core FPS in System Health is its frame rate.' },
  'home-usage': { area: 'Home', title: 'Token Usage', what: 'Tokens per day for the last 7 or 14 days, by type.',
    when: ['Spotting busy days or a sudden rise.'], impact: RO, notes: ['The % compares with the 7 or 14 days before. "No comparison" means those days were not fully tracked.', 'Cache read uses the right-hand scale because it is much larger than the others.', 'The line under the total says how much of it is cache reads.'], tech: 'Daily totals from the tracker log.' },
  'home-health': { area: 'Home', title: 'System Health', what: 'Quick readings from this PC.',
    when: ['Checking whether NEXUS or your PC is under load.'], impact: RO, notes: ['Tracker CPU: the tracker process only, as % of all cores. The ring is drawn ×4 so small values show.', 'Memory: the whole PC.', 'Disk: the drive the tracker is on (the tooltip adds the tracker\'s own data size).', 'Core FPS: frame rate of the 3D core in this window (60 = smooth).', 'Updated each time NEXUS checks the tracker (Settings → Performance → Live data).'], tech: 'From GET /api/proc, read with each tracker check.' } });
const hchip = () => { const c = el('h-hchip'), t = `Measured on this PC each time NEXUS checks the tracker (${liveEvery()}); process list cached 30 s.`; if (c.dataset.t !== t) { c.dataset.t = t; c.innerHTML = chip('live', t); } };

const I = id => `<svg class="ic"><use href="#${id}"/></svg>`;
let el, range = 7, last = null, core = null, ukey = '';

export function mount(root, c) {
  core = c;
  root.innerHTML = `<div class="home-grid enter">
  <section class="card glass welcome" style="--i:0">
    <div class="hello" id="h-greet">Hello</div>
    <h1>Welcome back!</h1>
    <div class="sub" id="h-sub">Connecting to the tracker…</div>
    <div class="stats">
      ${stat('s-win', 'i-gauge', '5h Usage', 'home-5h')}${stat('s-week', 'i-cal', 'Weekly', 'home-week')}${stat('s-total', 'i-db', 'Total Tokens')}${stat('s-proj', 'i-folder', 'Active Projects')}
    </div>
  </section>
  <section class="core-slot" id="core-slot" style="--i:1">
    <div class="core-title"><b>NEXUS</b><small>Claude Code Intelligence System</small></div>
    <div class="core-state"><span id="core-state" style="display:contents"></span><span style="display:contents;pointer-events:auto">${more('home-core', 'RGB core')}</span></div>
  </section>
  ${savedStrip()}
  <div class="rcol">
    <section class="card glass" style="--i:2">
      <div class="card-h">${I('i-spark')}<h2>Claude Code Status</h2><span class="state-pill" id="cc-state"><span class="dot"></span>—</span>
        <div class="end"><a class="btn pri" href="#/claude-code">Open Terminal</a>${more('home-status', 'Claude Code Status')}</div></div>
      <div class="status-body">
        <div class="kv" id="cc-kv"></div>
        <div class="spark" data-tip="Context size of each request in this session. A sudden drop is a compaction or /clear."><span class="cap">Context per request</span><canvas id="cc-spark"></canvas></div>
      </div>
    </section>
    <section class="card" style="--i:3">
      <div class="card-h">${I('i-bolt')}<h2>Quick Actions</h2><div class="end"><button class="btn" data-tip="Coming later: drag, resize and hide panels." disabled style="opacity:.55;cursor:not-allowed">Customize</button></div></div>
      <div class="actions">
        ${act('#/optimizations', 'i-bolt', 'Optimizations')}${act('#/plugins', 'i-puzzle', 'Manage Plugins')}${act('#/claude-code', 'i-term', 'Open Terminal')}
        ${act('#/projects', 'i-plus-folder', 'New Project')}${act('#/analytics', 'i-chart', 'View Analytics')}${act('#/knowledge', 'i-search', 'Search Notes')}
      </div>
    </section>
  </div>
  <section class="card" style="--i:4">
    <div class="card-h">${I('i-spark')}<h2>Recent Optimizations</h2><div class="end"><a class="btn" href="#/optimizations">View All</a></div></div>
    <div class="list" id="h-opt"></div>
  </section>
  <section class="card usage" style="--i:5">
    <div class="card-h">${I('i-db')}<h2>Token Usage</h2><div class="end">${chip('live')}<select class="btn" id="h-range" aria-label="Range"><option value="7">Last 7 days</option><option value="14">Last 14 days</option></select>${more('home-usage', 'Token Usage')}</div></div>
    <div class="usage-top"><span class="big"><span id="u-big">—</span><small>tokens</small></span><span id="u-delta"></span></div>
    <div class="usage-sub" id="u-sub"></div>
    <div class="chart" id="u-chart"></div>
    <div class="legend"><span><i style="background:var(--t-in)"></i>Input</span><span><i style="background:var(--t-out)"></i>Output</span><span><i style="background:var(--t-cw)"></i>Cache write</span><span><i style="background:var(--t-cr);height:2px;vertical-align:3px"></i>Cache read (right scale)</span></div>
  </section>
  <section class="card proj" style="--i:6">
    <div class="card-h">${I('i-folder')}<h2>Project Activity</h2><div class="end">${chip('live', 'Share of all tokens in your last 25 sessions.')}<a class="btn" href="#/projects">View Projects</a></div></div>
    <div id="h-proj"></div><div class="pact" id="h-act"></div>
  </section>
  <section class="card compact" style="--i:7">
    <div class="card-h">${I('i-heart')}<h2>System Health</h2><div class="end"><span id="h-hchip"></span>${more('home-health', 'System Health')}</div></div>
    <div class="rings">${ring('r-cpu', 'Tracker CPU')}${ring('r-mem', 'Memory')}${ring('r-disk', 'Disk')}${ring('r-fps', 'Core FPS')}</div>
  </section>
  <section class="card compact" style="--i:8">
    <div class="card-h">${I('i-pulse')}<h2>Active Processes</h2><div class="end"><a class="btn" href="#/system">View All</a></div></div>
    <div id="h-procs"></div>
  </section>
  <section class="card compact" style="--i:9">
    <div class="card-h">${I('i-bell')}<h2>Notifications</h2><div class="end"><button class="btn" id="h-notes-all">View All</button></div></div>
    <div id="h-notes"></div>
  </section>
</div>`;
  el = id => root.querySelector('#' + id);
  el('h-range').onchange = e => { range = +e.target.value; if (last) drawUsage(last); };
  el('h-notes-all').onclick = e => { e.stopPropagation(); document.getElementById('bell').click(); };
  el('r-fps').dataset.tip = 'Frames per second of the 3D core in this window (60 = smooth).';
  core?.slot(el('core-slot')); hchip();
}

const stat = (id, ic, lbl, mk) => `<div class="stat" id="${id}"><div class="stat-top"><span class="tile-ic">${I(ic)}</span><span class="c"></span></div><div class="lbl">${lbl}${mk ? more(mk, lbl) : ''}</div><div class="val"><span class="v">—</span><small class="u"></small></div><div class="bar"><i style="width:0"></i></div><div class="foot"></div></div>`;
const act = (href, ic, t) => `<a class="act" href="${href}">${I(ic)}${t}</a>`;

function setStat(id, v, f, opt) {
  const s = el(id); counter(s.querySelector('.v'), v, f);
  s.querySelector('.c').innerHTML = opt.chip; s.querySelector('.u').textContent = opt.unit || '';
  s.querySelector('.foot').textContent = opt.foot || '';
  const bar = s.querySelector('.bar'); bar.hidden = opt.bar == null; bar.firstElementChild.style.width = (opt.bar || 0) + '%';
}

export function update(st) {
  if (el) hchip();
  if (el && !st.r && st.at) el('h-sub').textContent = 'Tracker not reachable, so there is no data to show yet. ' + retryText();
  if (!el || !st.r) return;
  const now = Date.now(), v = home(st.r, st.p, now); last = st;
  el('h-greet').textContent = v.greet;
  setSaved(el('core-slot').parentElement, st.r.savings);
  el('h-sub').textContent = st.ok ? (v.bad ? `${v.bad} tracker check${v.bad > 1 ? 's need' : ' needs'} attention.` : 'The tracker is running and your data is up to date.') + (v.scan ? ` Last scan ${v.scan.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : '') : 'Tracker not reachable. Showing the last data received. ' + retryText();

  const L = st.w?.limits?.windows || {}, lim = (x, what) => ({ chip: chip(x.stale ? 'est' : 'live', `${what} reported by Claude Code ${ago(x.at)}${x.stale ? ' (over 30 min old; refreshed by any Assistant answer or Sessions → Check limits)' : ''}.`), foot: x.resets ? 'resets ' + new Date(x.resets).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '', bar: x.pct, unit: x.pct + '%' });
  const l5 = L.five_hour?.pct != null && !L.five_hour.expired ? L.five_hour : null, l7 = L.seven_day?.pct != null && !L.seven_day.expired ? L.seven_day : null;
  setStat('s-win', v.win.tok, tok, l5 ? lim(l5, '5-hour limit used,') : v.win.pct == null
    ? { chip: chip('unk', 'Your plan limit is not known to the tracker, so no percent is shown. The number is tokens used in the current 5-hour window.'), foot: v.win.resets ? `resets ${v.win.resets.replace(/:\d\d (?=[AP]M)/, ' ')}` : 'no active window', bar: null }
    : { chip: chip('est'), foot: `resets ${v.win.resets}`, bar: v.win.pct, unit: `${v.win.pct}%` });
  setStat('s-week', v.d7, tok, l7 ? lim(l7, '7-day limit used,') : { chip: chip('est', 'Sum of all token types over the last 7 days. Claude Code has not reported the weekly limit yet: ask the Assistant anything or press Sessions → Check limits.'), foot: '7-day total, all types', bar: null });
  setStat('s-total', v.total, tok, { chip: chip('live'), foot: `last ${v.nDays} tracked days`, bar: null });
  setStat('s-proj', v.active, n => n == null ? '—' : String(Math.round(n)), { chip: chip('live', 'Projects with a Claude Code session in the last 7 days.'), foot: 'with sessions in 7 days', bar: null });

  // status
  const s = v.status, pill = el('cc-state');
  pill.innerHTML = s ? `<span class="dot ${s.running ? 'ok' : ''}"></span>${s.running ? 'Running' : 'Idle'}` : '<span class="dot"></span>No session';
  pill.dataset.tip = s ? (s.running ? 'A request was logged in the last 5 minutes.' : 'No request in the last 5 minutes.') : '';
  el('cc-kv').innerHTML = s ? [
    ['i-chip', 'Model', s.model || '—'],
    ['i-layers', 'Context', s.ctx ? `${tok(s.ctx)} / ${tok(s.win)}` : '—', 'Current context vs where compaction happened on average (measured).'],
    ['i-db', 'Cache Efficiency', s.eff == null ? '—' : s.eff + '%', 'Today: cache reads ÷ all input-side tokens.'],
    ['i-clock', 'Session Time', dur(s.time)],
    ['i-timer', 'Estimated Reset', s.resets || '—', '5-hour window estimate: starts at the first request, lasts 5 hours.'],
  ].map(([ic, k, val, tip]) => `<div${tip ? ` data-tip="${esc(tip)}"` : ''}>${I(ic)}<span>${k}</span><b>${esc(val)}</b></div>`).join('') : '<div class="empty">No Claude Code session found yet.</div>';
  requestAnimationFrame(() => spark(el('cc-spark'), s?.spark));
  { const c = document.getElementById('ctx'); c.removeAttribute('title'); c.dataset.tip = s ? s.project + ' · session ' + s.id + ' · ' + s.n + ' requests' : ''; c.innerHTML = s ? `<b>${esc(s.project)}</b> · ${esc(s.id)}` : ''; }

  // optimizations
  el('h-opt').innerHTML = v.opt.length ? v.opt.map(o => `<div class="row"><span class="ico">${I(o.ic)}</span><span class="t"><span class="tt">${esc(o.title)}</span><small>${esc(o.t ? ago(o.t, now) : o.sub || '')}</small></span><span class="pill ${o.kind === 'live' ? '' : o.kind}" data-tip="${esc(o.why || o.sub || o.title)}">${esc(o.badge)}</span></div>`).join('') : '<div class="empty">No optimizations recorded yet.</div>';

  for (const t of document.querySelectorAll('.home-grid .tt, .home-grid .stat .foot')) if (t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1) t.dataset.tip = t.textContent; else delete t.dataset.tip;
  drawUsage(st);

  el('h-proj').innerHTML = v.projects.length ? v.projects.map(p => `<div class="prow">${I(/roblox/i.test(p.name) ? 'i-roblox' : /scratch/i.test(p.name) ? 'i-flask' : /tracker|\.claude/i.test(p.name) ? 'i-code' : /blender/i.test(p.name) ? 'i-cube' : 'i-folder')}<span class="n">${esc(p.name)}<small>${p.n} session${p.n > 1 ? 's' : ''} · ${s?.running && s.project === p.name ? 'active now' : 'latest ' + ago(v.act.rows.find(r => r.name === p.name)?.last, now)}</small></span><div class="bar"><i style="width:${p.pct}%"></i></div><span class="pct">${p.pct}%</span></div>`).join('') + (v.projects.length < 3 ? `<div class="empty">${v.projects.length === 1 ? 'All' : 'These are all'} of your last 25 sessions. Other projects appear here once you use Claude Code in them.</div>` : '') : '<div class="empty">No sessions yet.</div>';
  drawAct(v.act);

  if (v.sys) {
    setRing(el('r-cpu'), Math.max(2, v.sys.cpu * 4), v.sys.cpu + '%');
    el('r-cpu').dataset.tip = `Token Tracker process CPU since the last check: ${v.sys.cpu}% of all cores. Ring scaled ×4 so small values show.`;
    setRing(el('r-mem'), v.sys.mem, v.sys.mem + '%', v.sys.mem > 90); el('r-mem').dataset.tip = `PC memory in use: ${bytes(v.sys.memTxt[1])} of ${bytes(v.sys.memTxt[0])}`;
    if (v.sys.disk != null) { setRing(el('r-disk'), v.sys.disk, v.sys.disk + '%', v.sys.disk > 90); el('r-disk').dataset.tip = `Drive with the tracker: ${bytes(v.sys.diskTxt[1])} used of ${bytes(v.sys.diskTxt[0])}. Tracker data: ${bytes(v.sys.data)}.`; }
  }
  const mx = Math.max(1, ...(v.apps || []).map(a => a[1]));
  el('h-procs').innerHTML = v.apps ? v.apps.map(([n, m]) => `<div class="proc"><span class="dot ${m ? 'ok' : ''}"></span><span>${n}</span><div class="bar"><i style="width:${m / mx * 100}%"></i></div><span class="v">${m ? bytes(m) : 'not running'}</span></div>`).join('') : `<div class="empty">Process list unavailable: NEXUS couldn't read it from the tracker yet. ${esc(retryText())}</div>`;
  const g = []; for (const n of v.allNotes) { const o = g.find(x => x.txt === n.txt && x.c === n.c); if (o) o.ts.push(n.t); else g.push({ ...n, ts: [n.t] }); }
  const when = t => t ? ago(t, now) : 'now';
  el('h-notes').innerHTML = g.length ? g.slice(0, 5).map(n => `<div class="note-row" data-html="1" data-tip="${esc(`<b>${esc(n.txt)}</b>${n.ts.length > 1 ? '<br>' + n.ts.length + ' times: ' + n.ts.map(when).join(', ') : ''}`)}"><span class="dot ${n.c}"></span><span>${esc(n.txt)}</span><small>${n.ts.length > 1 ? `<em class="cnt">×${n.ts.length}</em>` : ''}${when(n.t)}</small></div>`).join('') : '<div class="empty">Nothing new.</div>';

  core?.status({ running: !!s?.running, events: st.events });
  const cs = el('core-state'); cs.innerHTML = `<span class="dot ${s?.running ? 'ok' : ''}"></span>${s?.running ? 'Session active' : 'Idle'} · ${st.ok ? 'tracker live' : 'tracker offline'}`;
}

function drawUsage(st) {
  const u = usage(st.r, range, Date.now());
  counter(el('u-big'), u.total, n => n == null ? '—' : Math.round(n).toLocaleString());
  el('u-delta').innerHTML = u.delta == null ? `<span class="pill unk" data-tip="The previous ${range} days were not fully tracked, so no comparison.">no comparison</span>` : `<span class="pill ${u.delta > 0 ? 'est' : ''}">${u.delta > 0 ? '↑' : '↓'} ${Math.abs(u.delta)}%</span>`;
  el('u-sub').textContent = `${u.delta == null ? '' : 'Compared to the previous ' + range + ' days · '}${u.cacheShare ?? 0}% are cache reads`;
  const k = range + JSON.stringify(u.s) + el('u-chart').clientWidth; if (k === ukey) return; ukey = k; // redraw only on real change or resize
  const c = el('u-chart'); c.classList.remove('shown'); chart(c, u.s);
}
// #5: sessions started per day, stacked by project (row order). null = older than the report's last 25 sessions: drawn as "no data", not 0.
function drawAct(a) {
  const c = el('h-act'), W = c.clientWidth, H = c.clientHeight, k = JSON.stringify(a.rows.map(r => r.d)) + a.days[0] + W + 'x' + H; if (!W || !H || c._k === k) return; c._k = k;
  const cs = getComputedStyle(document.documentElement), sh = ['--t-out', '--t-in', '--t-cw', '--hover', '--deep', '--pale'].map(v => cs.getPropertyValue(v).trim()), B = 16, T = 22, n = a.days.length, cw = W / n, bw = Math.min(24, cw * .42), ih = H - B - T;
  const tot = a.days.map((_, i) => a.rows.reduce((s, r) => s + (r.d[i] || 0), 0)), mx = Math.max(1, ...tot);
  let svg = `<svg viewBox="0 0 ${W} ${H}"><text class="ttl" x="0" y="11">Sessions started per day</text><line class="base" x1="0" x2="${W}" y1="${T + ih + .5}" y2="${T + ih + .5}"/>`;
  a.days.forEach((d, i) => {
    const x = i * cw + (cw - bw) / 2, none = a.rows.length > 0 && a.rows.every(r => r.d[i] == null); let y = T + ih, bars = '';
    if (!none) a.rows.forEach((r, j) => { if (!r.d[i]) return; const h = Math.max(3, r.d[i] / mx * ih); y -= h; bars += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="3" fill="${sh[j % sh.length]}"/>`; });
    const tip = `<b>${new Date(d).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</b><br>` + (none ? 'Older than the last 25 sessions in the report: no data.' : a.rows.map(r => `${esc(r.name)}: ${r.d[i]} session${r.d[i] === 1 ? '' : 's'}`).join('<br>'));
    svg += (none ? `<rect class="nd" x="${x}" y="${T + ih - 3}" width="${bw}" height="3" rx="1.5"/>` : bars) + (tot[i] ? `<text class="v" x="${x + bw / 2}" y="${y - 5}">${tot[i]}</text>` : '')
      + `<text class="d${i === n - 1 ? ' now' : ''}" x="${x + bw / 2}" y="${H - 2}">${i === n - 1 ? 'Today' : new Date(d).toLocaleDateString([], { weekday: 'short' })}</text><rect class="hit" x="${i * cw}" y="0" width="${cw}" height="${H}" data-html="1" data-tip="${esc(tip)}"/>`;
  });
  c.innerHTML = svg + '</svg>';
}
export function resize() { if (el && last) { drawUsage(last); drawAct(home(last.r, last.p, Date.now()).act); spark(el('cc-spark'), home(last.r, last.p).status?.spark); } }

export function fps(f) { const r = Math.round(f); if (el) setRing(el('r-fps'), r / 60 * 100, f ? String(r) : '—', f && f < 40); } // M7b: arc follows the shown whole number, so 14.9 ↔ 15.1 jitter does not move it
export function unmount() { core?.slot(null); el = null; ukey = ''; }
