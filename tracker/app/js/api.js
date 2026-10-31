// Polls the tracker. Keeps the last good data and emits observable events (diffs only, nothing invented).
import * as S from './settings.js';
const subs = new Set();
export const state = { r: null, p: null, w: null, ok: false, at: 0, events: [] };
let prevKey = '', prevLog = null;

async function getJ(u) { const x = await fetch(u, { cache: 'no-store' }); if (!x.ok) throw new Error(x.status); return x.json(); }

export async function poll() {
  const ev = [];
  try {
    const [r, p, w] = await Promise.all([getJ('/api'), getJ('/api/proc').catch(() => state.p), getJ('/api/watch').catch(() => state.w)]);
    if (!r || !r.days) throw new Error('empty');
    const key = JSON.stringify(r.days.at(-1)) + r.at;
    if (prevKey && key !== prevKey) ev.push('data-update');
    const log = r.advisor?.log?.[0]?.[0] ?? null;
    if (prevLog != null && log !== prevLog) ev.push('sync-done');
    if (!state.ok && state.at) ev.push('recovered');
    prevKey = key; prevLog = log;
    Object.assign(state, { r, p, w, ok: true, at: Date.now() });
  } catch {
    if (state.ok || !state.at) ev.push('error');
    state.ok = false; state.at ||= -1;
  }
  state.events = ev;
  subs.forEach(f => f(state, ev));
}
export const on = f => (subs.add(f), () => subs.delete(f));
// perf.live (Settings → Performance): live = every 10 s, slow = every 30 s, manual = only on page change (main.js)
// M7d D3: retry wording shared by the banner, Home and Analytics. Follows perf.live, never claims a retry that is not scheduled.
export const liveEvery = () => ({ slow: 'every 30 s', manual: 'only when you change page' })[S.pref('perf.live')] || 'every 10 s';
export const retryText = () => S.pref('perf.live') === 'manual' ? 'No automatic retry (manual updates): press Retry now or change page.' : `NEXUS retries every ${S.pref('perf.live') === 'slow' ? 30 : 10} s.`;
let iv = 0; const sched = () => { clearInterval(iv); const m = S.pref('perf.live'); if (m !== 'manual') iv = setInterval(poll, m === 'slow' ? 30000 : 10000); };
export function start() { poll(); sched(); S.onChange(k => (k === '*' || k === 'perf.live') && sched()); }

// Write API (Phase B): tracker-owned optimizer state only. Resolves to the tracker's answer ('ok', 'unchanged', …), then refreshes.
export async function act(o) {
  const x = await fetch('/api/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  const { res } = await x.json().catch(() => ({ res: 'HTTP ' + x.status }));
  await poll(); return res;
}
