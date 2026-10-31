// /api + /api/proc → Home view model. Pure (no DOM), checked by test-map.js.
import { sum, pct } from './fmt.js';

const DAY = 864e5, ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayTot = d => d ? d[1] + d[2] + d[3] + d[4] : 0; // days row: [date, input, output, cache write, cache read]
const sesTot = s => s[4] + s[5] + s[6] + s[7];          // sessions row: [id, project, start, requests, in, out, cw, cr, waste, issue]
export const modelName = m => !m ? null : m.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^\w/, c => c.toUpperCase());

export function series(days, n, now) {
  const m = Object.fromEntries((days || []).map(d => [d[0], d]));
  return Array.from({ length: n }, (_, i) => { const k = ymd(now - (n - 1 - i) * DAY), d = m[k]; return { k, inp: d?.[1] || 0, out: d?.[2] || 0, cw: d?.[3] || 0, cr: d?.[4] || 0, has: !!d }; });
}

export function usage(r, n, now) {
  const s = series(r.days, n, now), prev = series(r.days, 2 * n, now).slice(0, n);
  const total = sum(s.map(d => d.inp + d.out + d.cw + d.cr)), before = sum(prev.map(d => d.inp + d.out + d.cw + d.cr));
  const first = (r.days || [])[0]?.[0];
  // Only compare when the previous range was fully tracked.
  const delta = first && first <= prev[0].k && before ? Math.round((total - before) / before * 100) : null;
  return { s, total, delta, cacheShare: pct(sum(s.map(d => d.cr)), total) };
}

export function home(r, p, now = Date.now()) {
  const h = new Date(now).getHours();
  const greet = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const bad = (r.health || []).filter(x => !x[1]);
  const scan = r.at ? new Date(r.at) : null;

  const w = r.window || {}, winTok = w.tokens ? sum(w.tokens) : null;
  const week = usage(r, 7, now), d7 = week.total;
  const total = sum((r.days || []).map(dayTot));
  const recentProj = new Set((r.sessions || []).filter(s => now - new Date(s[2]) < 7 * DAY).map(s => s[1]));

  const cur = p?.cur || null, adv = (r.advisor?.sessions || []).find(s => cur && s.id === cur.id) || null;
  const running = !!cur && now - cur.end < 5 * 60e3;
  const today = (r.days || []).find(d => d[0] === ymd(now));
  const ctx = adv?.ctx ?? cur?.ctx?.at(-1) ?? null, win = adv?.win ?? r.advisor?.win ?? null;

  const opt = [];
  const tips = (r.opts || [])[0];
  if (tips) { const m = /waste\s*(-?\d+)%/.exec(tips.status || ''); opt.push({ ic: 'i-spark', title: 'Startup tips', sub: tips.status, badge: m ? `${m[1].replace('-', '−')}% waste` : 'no data', kind: m ? 'est' : 'unk', why: `Estimated from ${tips.n} sessions with and without tips.` }); }
  opt.push({ ic: 'i-bolt', title: 'Token rules A, B, E', sub: 'approved Oct 14 · savings being measured', badge: 'unverified', kind: 'unk', t: Date.parse('2026-10-14T09:18Z'), why: 'Savings count only after ~1,000 requests are measured against the baseline.' });
  for (const [t, txt] of (r.auto || []).slice(0, 4)) opt.push({ ic: /Retired/.test(txt) ? 'i-check' : 'i-db', title: txt.replace(/\. Backup:.*$/, ''), t, badge: /Retired/.test(txt) ? 'tip retired' : 'corrected', kind: 'live' });

  const pr = {}; for (const s of r.sessions || []) { const o = pr[s[1]] ||= { n: 0, tok: 0 }; o.n++; o.tok += sesTot(s); }
  const ptot = sum(Object.values(pr).map(o => o.tok));
  const projects = Object.entries(pr).sort((a, b) => b[1].tok - a[1].tok).slice(0, 6).map(([name, o]) => ({ name, n: o.n, pct: pct(o.tok, ptot) || 0 }));

  // M7c Home #5: sessions started per day for each listed project, last 7 local days. Only the last 25 sessions are in the report,
  // so days older than the oldest of those 25 are "no data" (null), never shown as zero.
  const ses = (r.sessions || []).map(s => [s[1], Date.parse(s[2])]).filter(s => s[1] > 0), day0 = new Date(now).setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(day0); d.setDate(d.getDate() - 6 + i); return +d });
  const from = (r.sessions || []).length >= 25 && ses.length ? Math.min(...ses.map(s => s[1])) : 0;
  const act = { days, rows: projects.map(p => ({ name: p.name, last: Math.max(0, ...ses.filter(s => s[0] === p.name).map(s => s[1])),
    d: days.map((d, i) => { const e = days[i + 1] ?? Infinity; return e <= from ? null : ses.filter(s => s[0] === p.name && s[1] >= d && s[1] < e).length }) })) };

  const apps = p?.apps ? [['Claude Code', p.apps.find(a => a[0] === 'Claude Code')?.[1] || 0], ['Token Tracker', p.rss || 0], ...p.apps.filter(a => a[0] !== 'Claude Code')] : null;

  const notes = [
    ...bad.map(x => ({ c: 'warn', txt: `${x[0]}: ${x[2]}`, t: null })),
    ...(r.advisor?.log || []).slice(0, 6).map(x => ({ c: 'ok', txt: `${x[2][0].toUpperCase() + x[2].slice(1)} · ${x[3]}`, t: x[0] })),
    ...(r.auto || []).slice(0, 4).map(x => ({ c: 'info', txt: x[1].replace(/\. Backup:.*$/, ''), t: x[0] })),
  ].sort((a, b) => (b.t ?? 9e15) - (a.t ?? 9e15));
  for (const t of r.recs || []) notes.push({ c: 'warn', txt: t, t: null });

  return {
    greet, scan, bad: bad.length,
    win: { tok: winTok, resets: w.resets, pct: w.pct ?? null },
    d7, total, nDays: (r.days || []).length, active: recentProj.size,
    status: cur && { running, model: modelName(cur.model), ctx, win, eff: today ? pct(today[4], today[1] + today[3] + today[4]) : null, time: (running ? now : cur.end) - cur.start, resets: w.resets, spark: cur.ctx || [], project: cur.project, id: cur.id.slice(0, 8), n: cur.n },
    opt: opt.slice(0, 4), projects, act, apps,
    sys: p && { cpu: p.cpu, mem: pct(p.mem[1], p.mem[0]), memTxt: p.mem, disk: p.disk && pct(p.disk[1], p.disk[0]), diskTxt: p.disk, data: p.data },
    notes: notes.slice(0, 5), allNotes: notes,
    week,
  };
}

// ---------- Sessions + Analytics pages (pure) ----------
// "C--Users-<user>-Desktop-my-game" → "my-game" (Claude Code project dir → the name sessions use).
export const projName = d => (d || '').replace(/^[A-Za-z]--(Users-[^-]+-)?((Desktop|Documents|OneDrive)-)?/, '').replace(/-/g, ' ') || d;

// One object per session row, joined with the advisor (live context / ended history) and /api/proc (current session).
export function sessions(r, p, now = Date.now()) {
  const adv = r.advisor || {}, live = adv.sessions || [], hist = adv.history || [];
  return (r.sessions || []).map(([id, project, st, n, inp, out, cw, cr, waste, issue]) => {
    const L = live.find(x => x.id.startsWith(id)), H = hist.find(x => x.id.startsWith(id)), C = p?.cur?.id?.startsWith(id) ? p.cur : null;
    const start = H?.start ?? (Date.parse(st) || null), end = H?.end ?? C?.end ?? null;
    return {
      id, full: (L || H || C)?.id || id, project, start, end, live: !!L, n, inp, out, cw, cr, tot: inp + out + cw + cr, waste, issue,
      eff: pct(cr, inp + cw + cr), perReq: n ? Math.round((inp + out + cw + cr) / n) : null,
      ctx: L?.ctx ?? null, win: L?.win ?? adv.win ?? null, health: L?.health || null, advice: L?.plain || null,
      peak: H?.peak ?? null, k: H?.k ?? null, why: H?.why || null, spark: C?.ctx || null, model: C ? modelName(C.model) : null,
      dur: end && start ? end - start : L && start ? now - start : null,
      log: (adv.log || []).filter(x => String(x[1]).slice(0, 8) === id), // handoff / advisor actions for this session
    };
  });
}

export function filterSessions(rows, f) {
  const q = (f.q || '').trim().toLowerCase();
  return rows.filter(s => (!f.project || s.project === f.project) && (!f.since || s.start >= f.since) && (!f.issues || s.issue) && (!f.live || s.live)
    && (!q || `${s.id} ${s.full} ${s.project} ${s.issue}`.toLowerCase().includes(q)));
}
// Stable sort on one key; nulls always last.
export const sortBy = (rows, k, dir) => [...rows].sort((a, b) => a[k] == null ? (b[k] == null ? 0 : 1) : b[k] == null ? -1 : (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);

// range: 7 | 14 | 30 | 'all' (from the first tracked day). Days before tracking started are flagged pre (= unknown, not zero).
export function analytics(r, range, now = Date.now()) {
  const days = r.days || [], first = days[0]?.[0] || null;
  const len = range === 'all' ? (first ? Math.round((Date.parse(ymd(now)) - Date.parse(first)) / DAY) + 1 : 0) : range;
  const s = series(days, len, now).map(d => ({ ...d, pre: !first || d.k < first, eff: pct(d.cr, d.inp + d.cw + d.cr) }));
  const t = { inp: sum(s.map(d => d.inp)), out: sum(s.map(d => d.out)), cw: sum(s.map(d => d.cw)), cr: sum(s.map(d => d.cr)) };
  t.all = t.inp + t.out + t.cw + t.cr;
  const by = list => {
    const m = {}; for (const [k, ...v] of list || []) { const o = m[k] ||= [0, 0, 0, 0]; v.forEach((x, i) => o[i] += x || 0); }
    const rows = Object.entries(m).map(([name, v]) => ({ name, v, tot: sum(v) })).filter(x => x.tot).sort((a, b) => b.tot - a.tot);
    const all = sum(rows.map(x => x.tot)); rows.forEach(x => x.share = pct(x.tot, all)); return rows;
  };
  return {
    s, len, t, first, pre: s.filter(d => d.pre).length, eff: pct(t.cr, t.inp + t.cw + t.cr),
    models: by((r.models || []).map(([m, ...v]) => [modelName(m), ...v])),
    projects: by((r.projects || []).map(([d, ...v]) => [projName(d), ...v])),
  };
}

// RFC 4180 CSV.
export const csv = rows => rows.map(r => r.map(v => /[",\n]/.test(v ?? '') ? `"${String(v).replace(/"/g, '""')}"` : v ?? '').join(',')).join('\n') + '\n';

// ---------- Optimizations + Learning Lab (Phase B) ----------
// Problem types the tracker detects (tracker.js TIPRE). rule = what the startup tip tells Claude.
export const OTYPES = {
  rebuild: { name: 'Context rebuilds', cat: 'Context', ic: 'i-layers', rule: 'Context re-cached after idle gaps (cache TTL): /compact or /clear before long breaks.' },
  oversized: { name: 'Oversized tool output', cat: 'Tool output', ic: 'i-db', rule: 'Tool outputs over ~7.5K tokens: narrow with limit / head_limit / filters.' },
  reread: { name: 'Repeated file reads', cat: 'File reads', ic: 'i-book', rule: 'Files re-read repeatedly: read once, then use offset/limit or Grep.' },
  dup: { name: 'Duplicate tool calls', cat: 'Tool calls', ic: 'i-flow', rule: 'Repeated identical tool calls: reuse the earlier result.' },
  skilldup: { name: 'Skills loaded twice', cat: 'Skills', ic: 'i-puzzle', rule: 'Skill loaded more than once per session: load once.' },
};
export const tipState = (lab, t) => lab.retired?.[t] ? 'retired' : !lab.tipsLog?.[t] ? 'watching' : lab.autoOff ? 'paused' : lab.retest?.[t] ? 'retest' : 'active';

export function optim(r) {
  const lab = r.lab || {}, issues = r.issues || [], opts = r.opts || [];
  const types = Object.entries(OTYPES).map(([t, o]) => {
    const rows = issues.filter(i => i[0].startsWith(t + ':'));
    const opt = opts.find(x => x.name === 'Tip: ' + t) || null, st = tipState(lab, t);
    return { t, ...o, waste: sum(rows.map(i => i[3])), n: sum(rows.map(i => i[2])), sessions: Math.max(0, ...rows.map(i => i[1])),
      details: rows.map(i => ({ d: i[0].slice(t.length + 1), s: i[1], n: i[2], w: i[3] })), state: st === 'retest' && opt && !/^collecting/.test(opt.status) ? 'active' : st, opt, at: lab.tipsLog?.[t] || null, retiredAt: lab.retired?.[t] || null, retestAt: lab.retest?.[t] || null };
  });
  const checks = r.audit?.checks || [], wasteRow = (r.verify?.rows || []).find(x => /waste/.test(x[0])) || null;
  const log = (r.auto || []).map(([t, m]) => ({ t, you: m.startsWith('You: '), msg: m.replace(/^You: /, ''), backup: (m.match(/Backup: (\S+?)\.?$/) || [])[1] || null }));
  return {
    lab, types, opts, all: opts[0] || null, checks, pass: checks.filter(c => c.status === 'Verified').length, wasteRow, log,
    recs: (r.recs || []).map((t, i) => ({ k: lab.recKeys?.[i] || null, t, dismissed: !!lab.dismissed?.[lab.recKeys?.[i]] })),
    active: types.filter(x => x.state === 'active' || x.state === 'retest').length, retired: types.filter(x => x.state === 'retired').length,
    learned: types.filter(x => x.at).length, waste: sum(types.map(x => x.waste)),
  };
}
