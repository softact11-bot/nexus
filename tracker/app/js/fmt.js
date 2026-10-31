// Formatting + source labels. Pure functions (also used by test-map.js).
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
export const sum = a => a.reduce((x, y) => x + (y || 0), 0);
export const tok = n => n == null || isNaN(n) ? '—' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K' : String(Math.round(n));
export const bytes = n => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : Math.round(n / 1e3) + ' KB';
export const pct = (a, b) => b ? Math.round(a / b * 100) : null;
export const ago = (t, now = Date.now()) => {
  const s = Math.max(0, (now - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago';
};
export const dur = ms => { const m = Math.round(ms / 60000); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };
// Source label chip: every number on screen says where it comes from.
const CHIP = {
  live: ['LIVE', 'Read from your Claude Code logs by the tracker.'],
  est: ['EST.', 'Estimate: see the tooltip for how it is worked out.'],
  demo: ['DEMO', 'Sample value for the preview, not your data.'],
  unk: ['UNKNOWN', 'The tracker has no data for this yet.'],
  ver: ['VERIFIED', 'Measured before and after in your logs.'],
};
export const chip = (k, why) => `<span class="chip ${k}" data-tip="${esc(why || CHIP[k][1])}">${CHIP[k][0]}</span>`;
