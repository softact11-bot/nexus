// M7g Tutorials. A first-run welcome tour (offered once, optional) and a short walkthrough of the page on screen, from the ? button in the top bar.
// Steps point at real controls: a highlight ring follows the control (scroll, resize, reflow), and a step whose control is not on screen is left
// out. A tour only shows and explains: it never clicks, saves or changes anything. Seen / skipped state: localStorage nx.tour (schema v1).
import { PAGES } from './placeholder.js';
import { on, state } from './api.js';
import { esc } from './fmt.js';
const K = 'nx.tour', load = () => { try { const j = JSON.parse(localStorage.getItem(K)); if (j?.v === 1 && j.seen) return j } catch { } return { v: 1, seen: {} } };
const keep = f => { const o = load(); f(o); try { localStorage.setItem(K, JSON.stringify(o)) } catch { } };
const WELCOME = [
  ['#nav', 'Pages', 'Every NEXUS page is listed here. The highlighted one is the page you are on.'],
  ['#search', 'Search', 'Find pages, sessions and projects from anywhere. Shortcut: Ctrl + K.'],
  ['#as-btn', 'Assistant', 'Ask NEXUS about your usage, by text or voice. Shortcut: Ctrl + J.'],
  ['.side-foot', 'Tracker status', 'A green dot means NEXUS is reading your Claude Code data live. If it stops, a banner says what to do.'],
  ['.side-scan', 'What changed', 'Each launch, NEXUS checks what changed since last time. Scan for changes checks again.'],
  ['#help-b', 'Help on every page', 'Press ? on any page for a short tour of that page. The last step lets you replay this welcome tour.']];
const pageSteps = id => { const p = PAGES.find(x => x[0] === id) || [id, '', id], f = p[4];
  return [['.view .pg-h, .view .home-grid', p[2], p[3] || "Your overview: today's usage, live activity and the NEXUS core."],
    ['.view .pg-h .btn:not(.lx-btn)', 'Page actions', 'Buttons here act on this page. Anything that changes files, settings or installs asks you first.'],
    ['.view .card', 'Cards', f ? `On this page: ${f.slice(0, 4).join(', ')}.` : 'Each card shows one part of this page.'],
    ['.view .nx-i', 'Learn more', 'An i button explains the control next to it: what it does and what it changes. F1 on a focused control does the same.'],
    ['.lx-btn', 'Edit layout', 'Move and resize the cards on this page. Nothing changes until you choose Save.'],
    ['#help-b', 'Replay any time', 'This ? button starts the tour of the page you are on.']] };
const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' };
const find = s => [...document.querySelectorAll(s)].find(vis);
let T = null; // { steps, i, kind, id, from, ring, box, raf, r }

export function start(kind = 'page') {
  stop(); document.querySelector('.tour-offer')?.remove();
  const id = (location.hash.match(/^#\/([\w-]+)/) || [])[1] || 'home', steps = (kind === 'welcome' ? WELCOME : pageSteps(id)).filter(s => find(s[0]));
  if (!steps.length) return;
  const ring = document.createElement('div'), box = document.createElement('div'); ring.className = 'tour-ring'; ring.setAttribute('aria-hidden', 'true');
  box.className = 'tour-box'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-labelledby', 'tour-t'); box.setAttribute('aria-describedby', 'tour-p');
  document.body.append(ring, box); T = { steps, i: 0, kind, id, from: document.activeElement, ring, box };
  box.onclick = e => { const a = e.target.closest('[data-t]')?.dataset.t; if (!a) return; if (a === 'next') show(T.i + 1); else if (a === 'back') show(T.i - 1);
    else if (a === 'replay') show(0); else if (a === 'welcome') start('welcome'); else stop(a === 'finish') };
  addEventListener('keydown', key, true); show(0); place();
}
function show(i) {
  const { steps, kind, box } = T, n = steps.length, [sel, h, p] = steps[i], last = i === n - 1; T.i = i; T.r = null;
  find(sel)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  box.innerHTML = `<small>${kind === 'welcome' ? 'Welcome tour' : 'Page tour'} · step ${i + 1} of ${n}</small><h3 id="tour-t">${esc(h)}</h3><p id="tour-p">${esc(p)}</p>
  <div class="tour-f"><button type="button" class="btn sm ghost" data-t="skip">Skip tour</button><span></span>${i ? '<button type="button" class="btn sm" data-t="back">Back</button>' : ''}${last
    ? `${kind === 'page' ? '<button type="button" class="btn sm" data-t="welcome">Welcome tour</button>' : ''}<button type="button" class="btn sm" data-t="replay">Replay</button><button type="button" class="btn sm pri" data-t="finish">Finish</button>`
    : '<button type="button" class="btn sm pri" data-t="next">Next</button>'}</div>`;
  box.querySelector('.pri').focus();
}
// ponytail: one rAF loop while a tour is open (re-reads one rect per frame); stops with the tour
function place() {
  if (!T) return; T.raf = requestAnimationFrame(place);
  const el = find(T.steps[T.i][0]); if (!el) return; const r = el.getBoundingClientRect(), k = [r.left, r.top, r.width, r.height].map(Math.round).join();
  if (k === T.r) return; T.r = k; const P = 6, W = innerWidth, H = innerHeight, b = T.box.getBoundingClientRect();
  Object.assign(T.ring.style, { left: r.left - P + 'px', top: r.top - P + 'px', width: r.width + 2 * P + 'px', height: r.height + 2 * P + 'px' });
  const below = r.bottom + P + 12 + b.height < H, top = below ? r.bottom + P + 12 : Math.max(12, r.top - P - 12 - b.height);
  Object.assign(T.box.style, { left: Math.max(12, Math.min(W - b.width - 12, r.left)) + 'px', top: Math.min(top, H - b.height - 12) + 'px' });
}
function key(e) {
  if (!T) return; if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return stop(false) }
  if (e.key === 'Tab') { const f = [...T.box.querySelectorAll('button')], a = f[0], z = f.at(-1), at = document.activeElement; // focus stays in the tour
    if (!T.box.contains(at) || (e.shiftKey ? at === a : at === z)) { e.preventDefault(); (e.shiftKey ? z : a).focus() } }
}
export function stop(done) {
  if (!T) return; const { kind, id, from, ring, box, raf } = T; T = null; cancelAnimationFrame(raf); ring.remove(); box.remove(); removeEventListener('keydown', key, true);
  keep(o => { if (kind === 'welcome') o.welcome = done ? 'done' : 'skipped'; else o.seen[id] = done ? 'done' : 'skipped' });
  if (from?.isConnected) from.focus();
}
function offer() {
  if (load().welcome || T) return;
  const d = document.createElement('div'); d.className = 'tour-offer'; d.setAttribute('role', 'region'); d.setAttribute('aria-label', 'Welcome');
  d.innerHTML = `<b>New to NEXUS?</b><p>Take a one-minute tour of the main controls. You can also start it later from the ? button.</p><div class="tour-f"><span></span><button type="button" class="btn sm" data-t="no">Not now</button><button type="button" class="btn sm pri" data-t="go">Start tour</button></div>`;
  d.onclick = e => { const a = e.target.closest('[data-t]')?.dataset.t; if (a === 'go') start('welcome'); else if (a === 'no') { keep(o => o.welcome = 'skipped'); d.remove() } };
  document.body.append(d);
}
export function init() {
  const top = document.querySelector('.top-act'); if (!top || document.getElementById('help-b')) return;
  top.insertAdjacentHTML('afterbegin', '<button class="icon-btn" id="help-b" type="button" aria-label="Help: tour of this page" data-tip="Tour of this page">?</button>');
  document.getElementById('help-b').onclick = () => start('page');
  addEventListener('hashchange', () => stop(false)); // a page tour belongs to its page
  if (state.ok) offer(); else { const off = on(st => { if (st.ok) { off(); offer() } }) } // after sign-in, not over the login screen
}
