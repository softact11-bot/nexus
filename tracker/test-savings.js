// M7d Saved Usage self-check: node test-savings.js. Synthetic sessions only; never reads or writes state.json.
const SV = require('./savings.js');
let pass = 0; const fail = []; const ok = (c, m) => c ? pass++ : fail.push(m);
let id = 0, seed = 42; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
// One session: n requests, per-request tokens ~ base × f with ±15% noise; inj = optimizer text (tokens) when on.
const ses = (n, f, on, proj = 'p', model = 'claude-opus-5-5') => { const k = f * (0.85 + rnd() * 0.3);
  return { id: 's' + id++, project: proj, n, end: id, models: { [model]: [50 * n, 800 * n * k, 2000 * n * k, 40000 * n * k].map(Math.round) }, inj: on ? { caveman: 300 } : {}, skills: {}, skillTok: {}, mcp: {} } };
const mk = (nb, na, f) => [...Array.from({ length: nb }, () => ses(20, 1, false)), ...Array.from({ length: na }, () => ses(20, f, true))];

// price math: 1M of each token type on Opus 5.5 = 4 + 20 + 5 + 0.2
ok(Math.abs(SV.cost({ 'claude-opus-5-5': [1e6, 1e6, 1e6, 1e6] }) - 32.2) < 1e-9, 'opus price sum');
ok(Math.abs(SV.cost({ 'claude-sonnet-5-5': [1e6, 1e6, 1e6, 1e6] }) - 16.1) < 1e-9, 'sonnet price sum');
ok(Math.abs(SV.cost({ 'claude-haiku-5-5': [1e6, 1e6, 1e6, 1e6] }) - 0.81) < 1e-9, 'haiku price sum');
ok(Math.abs(SV.cost({ 'claude-fable-5-1': [1e6, 1e6, 1e6, 1e6] }) - 80.25) < 1e-9, 'fable price sum');
ok(SV.priceFor('claude-haiku-5-5', 1e5) && SV.priceFor('claude-haiku-5-5', 1e5 + 1) === null && SV.priceFor('some-new-model', 1) === null && SV.priceFor('claude-opus-5-5', 9e5), 'over the Haiku tier or unknown: no price, Not enough data');
ok(SV.cost({ 'some-new-model': [1, 0, 0, 0] }) === null, 'unknown model is unpriced, never guessed');

// 1. too few sessions → collecting, nothing verified, net not measured
let r = SV.compute(mk(6, 6, 0.7));
ok(r.verified.status === 'collecting' && r.verified.usd === 0, 'insufficient data stays collecting: ' + r.verified.status);
ok(r.net.status === 'not measured', 'insufficient data: net not measured');

// 2. no change → no clear effect, verified 0
r = SV.compute(mk(20, 20, 1));
ok(r.verified.status === 'no clear effect' && r.verified.usd === 0, 'no improvement not verified: ' + r.verified.status + ' ' + r.verified.pct + '% ci ' + r.verified.ci);
ok(r.net.status === 'not measured', 'no improvement: net not measured');

// 3. genuine 30% drop → verified, positive, CI excludes 0, net measured = verified
r = SV.compute(mk(20, 20, 0.7));
ok(r.verified.status === 'verified' && r.verified.usd > 0, 'genuine improvement verified: ' + r.verified.status);
ok(r.verified.pct >= 20 && r.verified.pct <= 40 && r.verified.ci[0] > 0, 'drop ~30% with CI above 0: ' + r.verified.pct + ' ' + r.verified.ci);
ok(r.net.status === 'measured' && r.net.usd === r.verified.usd, 'net = verified (already after overhead)');

// 4. costlier → not verified
r = SV.compute(mk(20, 20, 1.4));
ok(r.verified.status === 'costlier' && r.verified.usd === 0, 'costlier is not a saving: ' + r.verified.status);

// 5. tiny improvement smaller than its overhead must not verify: 2% drop, heavy noise
r = SV.compute(mk(20, 20, 0.98));
ok(r.verified.status !== 'verified', 'sub-noise drop not verified: ' + r.verified.pct + '% ci ' + r.verified.ci);

// 6. overhead is cache-aware: 1 write + 19 reads, far below the full-price view; never double counted
r = SV.compute([ses(20, 1, true)]);
ok(Math.abs(r.overhead.usd - 300 * (8 + 19 * 0.2) / 1e6) < 1e-12, 'overhead = 1 cache write + (n-1) reads');
ok(Math.abs(r.overhead.usdFull - 300 * 20 * 4 / 1e6) < 1e-12 && r.overhead.usd < r.overhead.usdFull, 'full-price view is the upper bound');

// 7. other projects do not count as baseline (fair comparison)
r = SV.compute([...Array.from({ length: 20 }, () => ses(20, 1, false, 'other')), ...Array.from({ length: 20 }, () => ses(20, 0.5, true, 'p'))]);
ok(r.verified.status === 'collecting' && r.verified.nAfter === 0, 'no same-project baseline → collecting');

// 8. estimate never leaks into verified; estimate kept separate
r = SV.compute(mk(6, 6, 0.7), { wasteTok: 50000 });
ok(r.estimated.usd > 0 && r.verified.usd === 0, 'estimate stays separate from verified');

// 9. ledger: one snapshot per day, never rewritten
const hist = {}; SV.compute(mk(20, 20, 0.7), { hist, now: Date.UTC(2026, 9, 28) });
const first = JSON.stringify(hist); SV.compute(mk(6, 6, 1), { hist, now: Date.UTC(2026, 9, 28, 20) });
ok(JSON.stringify(hist) === first, 'same-day snapshot not rewritten');
SV.compute(mk(6, 6, 1), { hist, now: Date.UTC(2026, 9, 29) });
ok(Object.keys(hist).length === 2 && hist['2026-10-28'].status === 'verified' && hist['2026-10-29'].status === 'collecting', 'next day appended, old kept');

// 10. unpriced model sessions are left out, not guessed
r = SV.compute([...mk(20, 20, 0.7), ses(20, 1, true, 'p', 'some-new-model')]);
ok(r.unpriced === 1 && r.verified.status === 'verified', 'unpriced session excluded');

// 11. deterministic
ok(JSON.stringify(SV.compute(mk(20, 20, 0.8)).verified) !== '' && (() => { seed = 7; id = 0; const a = SV.compute(mk(20, 20, 0.8)).verified; seed = 7; id = 0; const b = SV.compute(mk(20, 20, 0.8)).verified; return JSON.stringify(a) === JSON.stringify(b) })(), 'same data → same interval');

// 12. Context Advisor A5 (real Opus 5.5 / Sonnet 5.5 prices)
const O = SV.PRICES['claude-opus-5-5'], Sn = SV.PRICES['claude-sonnet-5-5'], near = (a, b) => Math.abs(a - b) < 1e-9;
// 400k ctx, 40 more requests, new chat at 30k: keep 400k*0.2*40 = $3.20 (+$0.08 next); act 30k*8 + 30k*0.2*40 = $0.48 -> +$2.80
ok(near(SV.advisorNet({ action: 'new chat', ctx: 4e5, idle: 0, rem: 40, base: 3e4, price: O }), (4e5 * .2 * 41 - (3e4 * 8 + 3e4 * .2 * 40)) / 1e6), 'new chat net');
// compact adds the summary request: next read + 4k output
ok(near(SV.advisorNet({ action: 'compact', ctx: 4e5, idle: 0, rem: 40, base: 3e4, price: O }), (4e5 * .2 * 40 - (4e3 * 20 + 3e4 * 8 + 3e4 * .2 * 40)) / 1e6), 'compact net');
// idle past the cache: continuing pays a full re-cache
ok(SV.advisorNet({ action: 'new chat', ctx: 2e5, idle: 90, rem: 5, base: 3e4, price: O }) > 0.9, 'idle new chat counts re-cache');
// few requests left: startup + restore cost more than the context saved -> never positive
ok(SV.advisorNet({ action: 'new chat', ctx: 1e5, idle: 0, rem: 5, base: 6e4, price: O }) <= 0, 'short remainder: no saving');
// a dearer cache read makes a big context cost more to keep, so the price table matters
ok(SV.advisorNet({ action: 'new chat', ctx: 1.5e5, idle: 0, rem: 10, base: 4e4, price: { ...Sn, cr: 0.2 } }) > SV.advisorNet({ action: 'new chat', ctx: 1.5e5, idle: 0, rem: 10, base: 4e4, price: Sn }), 'cache-read price drives the result');
ok(SV.remaining([300, 400, 500, 600, 700], 100) === 100 && SV.remaining([10, 20], 5) === 20 && SV.remaining([11, 12, 13, 14, 15], 10) === 5, 'remaining: median, clamp, fallback');
const w = { notify: true, action: 'compact', ctx: 1e5 };
ok(SV.shouldWarn(w, {}) && !SV.shouldWarn(w, { warnAct: 'compact', warnCtx: 1e5 }) && !SV.shouldWarn({ ...w, ctx: 1.4e5 }, { warnAct: 'compact', warnCtx: 1e5 }), 'once per session');
ok(SV.shouldWarn({ ...w, ctx: 1.6e5 }, { warnAct: 'compact', warnCtx: 1e5 }) && SV.shouldWarn({ ...w, action: 'new chat' }, { warnAct: 'compact', warnCtx: 1e5 }) && !SV.shouldWarn({ ...w, notify: false }, {}), 'material change re-warns; no notify never');

console.log('pass', pass, 'FAIL', fail.length); for (const f of fail) console.log(' FAIL', f); process.exit(fail.length ? 1 : 0);
