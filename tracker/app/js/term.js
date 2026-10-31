// M5d embedded terminals (desktop app only): xterm.js 6 (vendor/xterm) on the app's ConPTY shells. The app's one command, `term`,
// answers only this page at the tracker origin; output arrives as nexusTerm.out(id, text, end) evals. The terminals live in
// one detached element that the Claude Code page re-attaches, so they survive page switches; after a reload the app replays
// each shell's last 256 KB. Nothing here is sent to the tracker.
import * as S from './settings.js';
import { toast } from './ui.js';

export const app = !!window.__TAURI_INTERNALS__;
const inv = (op, a = {}) => window.__TAURI_INTERNALS__.invoke('term', { op, ...a });
const T = new Map(), P = {}; // id → { x: xterm, el, end, name }; P: output that came before its terminal was made
let box, bar, view, shells = [], cur = null, Terminal, ready;

const NAMES = { pwsh: 'PowerShell 7', powershell: 'PowerShell', cmd: 'cmd', bash: 'Git Bash', wsl: 'WSL' };
window.nexusTerm = { T, // T: for the desktop tests
 
  out(id, s, end) { const t = T.get(id); if (!t) (P[id] ||= []).push([s, end]); else if (end - enc.encode(s).length > t.end) sync(); else if (end > t.end) { t.x.write(s); t.end = end; } },
  exit(id, code) { const t = T.get(id); if (t) { t.x.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`); t.dead = true; tabs(); } },
};

// a missed chunk (gap in the byte count, or output while the window was hidden): fill in from the app's replay buffer
const enc = new TextEncoder();
async function sync() {
  try { for (const l of await inv('list')) { const t = T.get(l.id); if (t && l.end > t.end) { const b = enc.encode(l.buf); t.x.write(new TextDecoder().decode(b.slice(Math.max(0, b.length - (l.end - t.end))))); t.end = l.end; } } } catch { }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && box) sync(); });
function css() { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'vendor/xterm/xterm.css'; document.head.appendChild(l); }
function make(id, shell, buf = '', end = 0) {
  const st = getComputedStyle(document.documentElement), el = document.createElement('div'); el.className = 'cc-xv'; // opened visible (and attached) so xterm measures its cell; show() hides the others
  const x = new Terminal({ fontFamily: st.getPropertyValue('--mono').trim() || 'Consolas, monospace', fontSize: 12.5, lineHeight: 1.2, cursorBlink: true, scrollback: 5000, allowTransparency: true,
    theme: { background: '#00000000', foreground: '#CFE1D5', cursor: st.getPropertyValue('--primary').trim() || '#2bd67b', selectionBackground: '#2bd67b44' } });
  view.appendChild(el); x.open(el); if (buf) x.write(buf);
  x.onData(d => inv('write', { id, data: d }).catch(() => { }));
  const t = { x, el, end, name: NAMES[shell] || shell }; T.set(id, t);
  for (const [s, e] of P[id] || []) if (e > t.end) { x.write(s); t.end = e; } delete P[id];
  return id;
}
// cols / rows from the panel size and xterm's measured cell; the shell is told on every change
function fit() {
  const t = T.get(cur); if (!t || !view.isConnected || !view.clientWidth) return;
  const c = t.x._core?._renderService?.dimensions?.css?.cell; if (!c?.width) return;
  const cols = Math.max(2, Math.floor((view.clientWidth - 12) / c.width)), rows = Math.max(2, Math.floor((view.clientHeight - 8) / c.height));
  if (cols !== t.x.cols || rows !== t.x.rows) { t.x.resize(cols, rows); inv('resize', { id: cur, cols, rows }).catch(() => { }); }
}
function show(id) {
  cur = id; for (const [i, t] of T) t.el.hidden = i !== id; tabs();
  requestAnimationFrame(() => { const t = T.get(id); if (!t) return; const r = t.x._core?._renderService;
    // ponytail: xterm 6.0.0 internals (vendored, pinned). Its IntersectionObserver can leave a shown terminal paused (seen when the window is in the background); laid out = visible
    if (r?._isPaused && t.el.offsetParent && t.el.clientHeight) r._handleIntersectionChange({ isIntersecting: true });
    t.x._core?._charSizeService?.measure?.(); fit(); t.x.refresh(0, t.x.rows - 1); t.x.focus(); });
}
function tabs() {
  const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`), n = {};
  bar.innerHTML = [...T].map(([i, t]) => { n[t.name] = (n[t.name] || 0) + 1; return `<span class="tab${i === cur ? ' on' : ''}${t.dead ? ' dead' : ''}" data-xt="${i}" role="tab" aria-selected="${i === cur}">${esc(t.name)} ${n[t.name]}<button class="cc-x" data-xc="${i}" aria-label="Close terminal">×</button></span>`; }).join('')
    + `<button class="cc-x cc-add" data-xn="" aria-label="New terminal" data-tip="New terminal (${esc(NAMES[S.pref('cc.shell')] || 'default shell')})">+</button>`
    + `<select class="cc-xs" aria-label="New terminal with shell"><option value="">Shell…</option>${shells.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>`
    + (T.size ? '' : '<span class="cc-xe">No terminal open. Press + for a shell in this project.</span>');
}
async function init() {
  css(); ({ Terminal } = await import('../vendor/xterm/xterm.module.js'));
  box = document.createElement('div'); box.className = 'cc-tx';
  box.innerHTML = '<div class="cc-xb" role="tablist" aria-label="Terminals"></div><div class="cc-xw"></div>';
  bar = box.firstChild; view = box.lastChild;
  new ResizeObserver(() => fit()).observe(view);
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-xc],[data-xn],[data-xt]'); if (!b) return;
    if (b.dataset.xc) { e.stopPropagation(); const id = +b.dataset.xc, t = T.get(id); inv('close', { id }).catch(() => { }); t.x.dispose(); t.el.remove(); T.delete(id); if (cur === id) cur = [...T.keys()].at(-1) ?? null; cur != null ? show(cur) : tabs(); }
    else if (b.dataset.xn != null) open(null, box.dataset.cwd).then(e => e && toast(e, 'warn'));
    else show(+b.dataset.xt);
  });
  bar.addEventListener('change', e => { if (e.target.value) open(e.target.value, box.dataset.cwd).then(e => e && toast(e, 'warn')); e.target.value = ''; });
  try { shells = await inv('shells'); } catch { }
  tabs();
}
// shells still running from before a page reload: made once the panel is attached
let restored;
async function restore() { try { for (const t of await inv('list')) if (!T.has(t.id)) make(t.id, t.shell, t.buf, t.end); } catch { } const last = [...T.keys()].at(-1); last != null ? show(last) : tabs(); }

// the terminal element for the Claude Code panel (created once); cwd = the selected project folder for new shells
export async function mount(el, cwd) {
  if (!ready) ready = init(); await ready;
  box.dataset.cwd = cwd || ''; if (box.parentNode !== el) { el.textContent = ''; el.appendChild(box); }
  if (!restored) { restored = true; await restore(); } else if (cur != null) show(cur);
}
// shell: an id, or the setting / first detected; cmd: a line typed after the prompt (Resume / New session)
export async function open(shell, cwd, cmd) {
  if (!ready) ready = init(); await ready;
  const want = shell && shells.some(s => s.id === shell) ? shell : shells.some(s => s.id === S.pref('cc.shell')) ? S.pref('cc.shell') : shells[0]?.id;
  try { const r = await inv('open', { shell: want, cwd: cwd || null, cols: 100, rows: 30 }); show(make(r.id, r.shell)); if (cmd) setTimeout(() => inv('write', { id: r.id, data: cmd + '\r' }), 600); return ''; }
  catch (e) { return String(e); } // the error text, shown by the caller
}
