// Saved Usage (M7d): cache-aware, price-weighted savings. Pure: compute(sessions, opts) → r.savings. Self-check: node test-savings.js.
// Estimates and measurements never mix: 'verified' needs a fair, noise-checked comparison of real usage-log costs; everything else is labelled estimate.
// Prices: Anthropic first-party $/MTok (platform.claude.com/docs/en/about-claude/pricing, fetched 2026-10-30). The tracker logs cache writes as one number,
// so every write is priced at the 1-hour rate: 99.3 % of Claude Code's write tokens here are 1-hour (measured 2026-10-30). Unknown model → session left out (counted as unpriced).
// ponytail: Haiku 5.5 is 5x dearer per request over 100K prompt tokens, and sessions log totals only, so cost() uses the lower tier (0 of 22 real Haiku requests went over); log per-request size if that changes.
const PRICES = {
  'claude-opus-5-5': { in: 4, out: 20, cw: 8, cr: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, cw: 4, cr: 0.1 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cw: 0.2, cr: 0.01, maxCtx: 1e5 },
  'claude-fable-5-1': { in: 10, out: 50, cw: 20, cr: 0.25 },
};
const PRICE_SRC = 'Anthropic API list prices (pricing page, fetched 2026-10-30); cache writes at the 1-hour rate; Haiku 5.5 at its up-to-100K tier';
// Price for a request of this size, or null (Not enough data) past the tier the table holds.
const priceFor = (model, ctx) => { const p = PRICES[model]; return p && !(ctx > p.maxCtx) ? p : null };
const MIN = 10, B = 1000; // sessions each side; bootstrap resamples
const cost = m => { let usd = 0, ok = true; for (const [k, v] of Object.entries(m || {})) { const p = PRICES[k]; if (!p) { if (v.some(x => x)) ok = false; continue } usd += (v[0] * p.in + v[1] * p.out + v[2] * p.cw + v[3] * p.cr) / 1e6 } return ok ? usd : null };
const dom = m => Object.entries(m || {}).sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0))[0]?.[0] || '?';
const bucket = n => n <= 10 ? 's' : n <= 50 ? 'm' : 'l';
const med = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2 };
const rng = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }; // mulberry32: same data → same interval
// Injected optimizer text (tips, hooks, skills, plugin tool results), chars/4 estimate. Sent once as a cache write, then re-read on every later request.
const injTok = S => Object.values(S.inj || {}).reduce((x, v) => x + v, 0) + Object.values(S.skillTok || {}).reduce((x, v) => x + v, 0) + (S.tipTok || 0) + Object.values(S.mcp || {}).reduce((x, v) => x + (v[1] || 0), 0);
// opts.uses(S): session ran with an optimizer (tips, hooks, skills). opts.wasteTok: tip-effect waste saved (estimate, tokens). opts.now: snapshot day.
function compute(sessions, opts = {}) {
  const uses = opts.uses || (S => injTok(S) > 0), done = sessions.filter(S => S.n > 0), unpriced = [];
  const rows = done.map(S => { const c = cost(S.models); if (c == null) unpriced.push(S.id); return { S, c, per: c / S.n, k1: S.project + '|' + dom(S.models) + '|' + bucket(S.n), k2: S.project + '|' + dom(S.models), on: !!uses(S) } }).filter(r => r.c != null);
  // Overhead: cache-aware (1 write + (n-1) reads at the session's main model) vs the old full-price view (every request at input price).
  let oTok = 0, oUsd = 0, oFull = 0;
  for (const r of rows) { const t = injTok(r.S), p = PRICES[dom(r.S.models)]; if (!t || !p) continue; oTok += t; oUsd += t * (p.cw + (r.S.n - 1) * p.cr) / 1e6; oFull += t * r.S.n * p.in / 1e6 }
  // Fair comparison: each optimizer session vs the median cost/request of no-optimizer sessions in its stratum (project + model + length; fallback project + model; ≥3 baseline).
  const base = rows.filter(r => !r.on), meds = {};
  for (const r of base) for (const k of [r.k1, r.k2]) (meds[k] ||= []).push(r.per);
  const ref = r => meds[r.k1]?.length >= 3 ? med(meds[r.k1]) : meds[r.k2]?.length >= 3 ? med(meds[r.k2]) : null;
  const after = rows.filter(r => r.on).map(r => ({ r, m: ref(r) })).filter(x => x.m > 0).slice(-30);
  const baseM = base.map(r => ({ r, m: ref(r) })).filter(x => x.m > 0).slice(-30);
  const rA = after.map(x => x.r.per / x.m), rB = baseM.map(x => x.r.per / x.m);
  const v = { nAfter: rA.length, nBase: rB.length, min: MIN, status: 'collecting', pct: null, ci: null, usd: 0 };
  if (rA.length >= MIN && rB.length >= MIN) {
    const R = rng(rA.length * 7919 + rB.length), pick = a => Array.from(a, () => a[R() * a.length | 0]), d = [];
    for (let i = 0; i < B; i++) d.push(med(pick(rA)) - med(pick(rB)));
    d.sort((x, y) => x - y);
    const diff = med(rA) - med(rB), lo = d[B * 0.05 | 0], hi = d[B * 0.95 | 0];
    v.pct = Math.round(-diff * 100); v.ci = [Math.round(-hi * 100), Math.round(-lo * 100)]; // as % saved
    const usd = after.reduce((x, a) => x + (a.m * a.r.S.n - a.r.c), 0); // after costs already include the overhead → net of it
    v.point = usd;
    v.status = hi < 0 && usd > 0 ? 'verified' : lo > 0 ? 'costlier' : 'no clear effect';
    if (v.status === 'verified') v.usd = usd;
  }
  const effRate = rows.reduce((x, r) => x + r.c, 0) / Math.max(1, rows.reduce((x, r) => x + Object.values(r.S.models).flat().reduce((y, z) => y + z, 0), 0)); // $/token actually paid
  const wasteTok = opts.wasteTok || 0, cmpEst = v.status !== 'verified' && v.point > 0 ? v.point : 0;
  const est = { usd: cmpEst + wasteTok * effRate, wasteTok, cmpUsd: cmpEst };
  const res = { priced: rows.length, unpriced: unpriced.length, prices: PRICES, priceSrc: PRICE_SRC,
    estimated: est, verified: v, overhead: { tok: oTok, usd: oUsd, usdFull: oFull },
    net: v.status === 'verified' ? { status: 'measured', usd: v.usd } : { status: 'not measured', estUsd: est.usd - oUsd } };
  // Ledger: one snapshot per day, written once, never rewritten. Measured and estimated values carry their own label.
  if (opts.hist) { const day = new Date(opts.now || Date.now()).toISOString().slice(0, 10);
    opts.hist[day] ??= { at: opts.now || Date.now(), status: v.status, nAfter: v.nAfter, nBase: v.nBase, measuredUsd: v.usd, estimatedUsd: +est.usd.toFixed(4), overheadUsd: +oUsd.toFixed(4), overheadTok: oTok };
    res.hist = Object.entries(opts.hist).sort().slice(-30) }
  return res;
}
// Context Advisor A5. Pure. Expected remaining requests: median of past sessions that went past n (5-100), else 20.
const remaining = (lens, n) => { const m = lens.filter(x => x > n).map(x => x - n); return m.length >= 5 ? Math.min(100, Math.max(5, med(m))) : 20 };
// Net US$ (API list price) of acting vs continuing over rem requests. base = context after acting (measured startup or post-compact + restore estimate).
// A compact also pays one request over the whole context + its summary output (SUMMARY, estimate). Under 10 % net: not worth the lost continuity (<= 0).
const SUMMARY = 4e3;
const advisorNet = ({ action, ctx, idle, rem, base, price: p }) => { const next = idle >= 60 ? ctx * p.cw : ctx * p.cr, cont = next + ctx * p.cr * rem;
  const act = (action === 'compact' ? next + SUMMARY * p.out : 0) + base * p.cw + base * p.cr * rem, net = (cont - act) / 1e6;
  return net < cont / 1e6 * 0.1 ? Math.min(net, 0) : net };
// Once per session; again only if the advice changes or context grew 50 %+ since the last warning.
const shouldWarn = (a, r) => !!a.notify && (r.warnAct !== a.action || a.ctx > (r.warnCtx || 0) * 1.5);
module.exports = { compute, cost, PRICES, priceFor, injTok, dom, remaining, advisorNet, shouldWarn };
