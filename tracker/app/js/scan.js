// M7f Startup Change Scan (client). Once per launch, after the tracker first answers (so the user is signed in) and the browser is idle, asks
// /api/scan what changed since the last scan. Silent when nothing changed; a toast + "What's new" (the Learn More panel) when something did.
// Sidebar: last scan time, "What's new", "Scan for changes" (also the retry). A reload within 2 min reuses the last scan (server side).
import { toast, MORE, learnMore } from './ui.js';
import { on, poll, state } from './api.js';
import { ago } from './fmt.js';
const NAME = { sessions: 'Sessions', projects: 'Projects', notes: 'Vault notes', graph: 'Knowledge graph', automations: 'Automations', plugins: 'Plugins & skills' };
const total = r => Object.values(r?.changes || {}).reduce((a, c) => a + c.n[0] + c.n[1] + c.n[2], 0), pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
let rep = null, busy = false; const $ = id => document.getElementById(id);

function paint() {
  const s = $('scan-s'), w = $('scan-w'), b = $('scan-b'); if (!s) return;
  const n = total(rep), nf = Object.keys(rep?.failed || {}).length;
  s.textContent = busy ? 'Checking for changes…' : rep?.at ? `Checked ${ago(rep.at)}${n ? ' · ' + pl(n, 'change') : rep.first ? ' · first scan' : ' · no changes'}${nf ? ' · ' + nf + ' failed' : ''}` : 'Not checked yet';
  w.hidden = busy || !(n || nf); w.textContent = `What's new${n ? ` (${n})` : ''}`; b.disabled = busy;
}
function panel(from) {
  const c = rep?.changes || {}, f = rep?.failed || {}, n = total(rep);
  const part = x => [[x.n[0], 'added', x.added], [x.n[1], 'changed', x.changed], [x.n[2], 'removed', x.removed]].filter(y => y[0])
    .map(([k, w, l]) => `${k} ${w}${l.length ? ` (${l.slice(0, 5).join(', ')}${k > 5 ? ', …' : ''})` : ''}`).join('; ');
  MORE.scan = { area: 'Startup scan', title: "What's new since last launch",
    what: n ? `${pl(n, 'change')} found since ${rep.since ? new Date(rep.since).toLocaleString() : 'the previous scan'}.` : 'Nothing changed since the previous scan.',
    impact: { tokens: 'None (no Claude call)', files: 'Read only', privacy: 'Stays on this PC' },
    notes: [...Object.entries(c).map(([k, x]) => `${NAME[k] || k}: ${part(x)}`),
      ...Object.entries(f).map(([k, m]) => `${NAME[k] || k} could not be checked (${m}). Its last known state was kept, so nothing is shown as removed. Use Scan for changes to retry.`)],
    tech: `Scanned ${new Date(rep.at).toLocaleString()} in ${rep.ms} ms. NEXUS compares names, sizes and dates it already has, against a snapshot in this account's data folder.` };
  learnMore('scan', from);
}
async function scan(force) {
  if (busy) return; busy = true; paint();
  try {
    const x = await fetch('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force }) });
    const j = await x.json().catch(() => ({ res: 'HTTP ' + x.status })); if (j.res !== 'ok') throw new Error(j.res);
    rep = j; const n = total(j), fl = Object.keys(j.failed || {}).map(k => NAME[k] || k);
    if (n) poll(); // refresh the page on screen with the changed data
    if (n && !j.recent) toast(`What's new since last launch: ${pl(n, 'change')}. Open What's new in the sidebar for details.`);
    else if (force) toast(j.first ? 'First scan saved. Next time NEXUS will show what changed.' : 'No changes since the last scan.');
    if (fl.length && (force || !j.recent)) toast(`${fl.join(', ')} could not be checked. The last known state was kept. Use Scan for changes to retry.`, 'err', 'Part of the change scan failed');
  } catch (e) { toast(`The change scan could not run (${e.message}). Use Scan for changes in the sidebar to retry.`, 'err', "Couldn't check for changes") }
  busy = false; paint();
}
export function init() {
  $('scan-b').onclick = () => scan(true); $('scan-w').onclick = e => panel(e.currentTarget);
  const go = () => (window.requestIdleCallback || setTimeout)(() => scan(false), { timeout: 4000 });
  if (state.ok) go(); else { const off = on(st => { if (st.ok) { off(); go() } }) } // first poll may have answered before this module loaded
  setInterval(paint, 60e3); paint();
}
