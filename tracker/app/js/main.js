// Shell: hash router (full pages, sidebar stays), search, notifications, tracker banner.
import { start, on, state, poll, retryText } from './api.js';
import './look.js'; // appearance + accessibility prefs on every page
import { PAGES, placeholder } from './placeholder.js';
import * as Home from './home.js';
import { tips, help, stateBox, toast } from './ui.js';
import * as Layout from './layout.js'; // M7e Rearrange Mode
import { esc, ago } from './fmt.js';
import { createCore } from './core/core.js';
import * as Sound from './sound.js';
import * as S from './settings.js';
Sound.init();
// anim.* prefs → CSS motion tokens (tokens.css); reduced motion (OS or anim.reduced = on) → html.reduce
const motion = () => { const d = document.documentElement, k = 1 / Math.min(3, Math.max(.33, +S.pref('anim.speed') || 1)), red = S.reducedMotion();
  for (const [v, ms] of [['--t-page', 220], ['--t-fade', 110], ['--t-ui', 180]]) d.style.setProperty(v, Math.round(ms * k) + 'ms');
  d.style.setProperty('--slide', red ? '0px' : 8 * Math.min(2, Math.max(0, Number.isFinite(+S.pref('anim.intensity')) ? +S.pref('anim.intensity') : 1)) + 'px'); d.classList.toggle('reduce', red); };
motion(); S.onChange(k => { if (k === '*' || k.startsWith('anim.')) motion(); }); matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', motion);

const $ = id => document.getElementById(id), page = $('page');
let core = null; // ponytail: the Home 3D core is built on the first Home visit, not at every boot (saves ~200 ms of WebGL setup when another page opens first)
const useCore = () => core ||= createCore($('core'));
window.nexus = window.jarvis = { get core() { return useCore(); }, sound: Sound, mood: (s, l) => core?.mood(s, l) }; // mood: assistant state → Home core (post-M7 Ph 4); no core is built just for it
import('./accounts.js').then(A => A.init()); // NEXUS accounts (post-M7 Ph 14): login screen when nobody is signed in, account button + menu, Ctrl+Shift+A
import('./scan.js').then(S => S.init()); import('./tour.js').then(T => T.init()); // M7g Tutorials // M7f Startup Change Scan
import('./assist.js').then(A => A.init()); // NEXUS Assistant panel (post-M7 Ph 2/3), top-bar button + Ctrl+J // diagnostics only (core.bench(), sound.diag())
let cur = null;

$('nav').innerHTML = PAGES.map(([id, ic, t]) => `<a class="nav-i" href="#/${id}" data-id="${id}"><svg class="ic"><use href="#${ic}"/></svg>${t}</a>`).join('');

// Pages with a real module (lazy). Everything else keeps its placeholder until its phase.
const LAZY = { sessions: () => import('./pages/sessions.js'), analytics: () => import('./pages/analytics.js'),
  optimizations: () => import('./pages/optimizations.js'), learning: () => import('./pages/learning.js'),
  plugins: () => import('./pages/plugins.js'), projects: () => import('./pages/projects.js'), knowledge: () => import('./pages/knowledge.js'), settings: () => import('./pages/settings.js'),
  'claude-code': () => import('./pages/claude-code.js'), automation: () => import('./pages/automation.js'), system: () => import('./pages/system.js') };
let mod = null, curKey = '';
const scroll = {}; // scroll position per route (#/page/sub), restored on back/forward
// Page cache: these pages stay built while hidden (their unmount only drops refs; plugins keeps polling a running job, which is wanted).
// Coming back re-attaches the same DOM and refreshes it in place, so nothing flashes, reloads or replays its intro.
// The others run timers, rAF or WebGL and are rebuilt on each visit as before.
const KEEP = new Set(['home', 'analytics', 'optimizations', 'learning', 'sessions', 'projects', 'plugins']), views = {};

// #/page/sub/… → page id + params. Filter state lives in each page module, so it survives leaving and coming back.
function route() {
  const [, id, sub] = location.hash.match(/^#\/([\w-]+)(?:\/(.+))?/) || [];
  const next = PAGES.some(p => p[0] === id) ? id : 'home', key = next + '/' + (sub || ''), params = sub ? sub.split('/') : [];
  if (key === curKey) return;
  if (next !== cur && mod?.leave?.(location.hash, curKey)) return; // Settings with unsaved changes asks Save / Discard / Continue Editing, then navigates itself
  if (S.pref('perf.live') === 'manual' && curKey) poll(); // Settings → Performance: manual live data = refresh on page change
  if (next === cur && mod?.nav) { scroll[curKey] = page.scrollTop; curKey = key; if (views[cur]) views[cur].dataset.key = key; return mod.nav(params); } // same page: let it switch view in place
  if (curKey) scroll[curKey] = page.scrollTop;
  const first = cur == null, same = next === cur;
  if (cur === 'home') core?.slot(null);
  else if (mod && !KEEP.has(cur)) { mod.unmount(); delete views[cur]; }
  if (same && views[next]) { if (next === 'home') Home.unmount(); else mod?.unmount(); delete views[next]; } // same page without nav(): rebuild
  mod = null;
  const view = views[next] ||= Object.assign(document.createElement('div'), { className: 'view' }), warm = !!view.dataset.key;
  cur = next; curKey = key;
  document.querySelectorAll('.nav-i').forEach(a => a.classList.toggle('on', a.dataset.id === next));
  document.body.classList.toggle('home', next === 'home');
  if (next === 'home') useCore(); core?.active(next === 'home');
  try { localStorage.setItem('jv.page', next); } catch { }
  const show = async () => {
    if (curKey !== key) return; // a newer route won during the fade
    let m = null;
    if (LAZY[next]) { try { m = await LAZY[next](); } catch (e) { view.innerHTML = stateBox('error', 'This page failed to load.', esc(e.message)); } if (curKey !== key) return page.classList.remove('out'); } // a newer route won
    page.replaceChildren(view);
    if (next === 'home') { if (warm) core?.slot(view.querySelector('#core-slot')); else Home.mount(view, core); if (state.r) Home.update(state); }
    else if (m) { mod = m; if (!warm) m.mount(view, params); else if (view.dataset.key !== key) m.nav ? m.nav(params) : m.mount(view, params); m.update(state); if (warm) m.resize?.(); }
    else if (!LAZY[next]) placeholder(view, next);
    Layout.apply(next, view);
    if (KEEP.has(next) && (m || next === 'home')) view.dataset.key = key; else delete views[next];
    if (warm) { view.getAnimations({ subtree: true }).forEach(a => a.effect?.getTiming().iterations !== Infinity && a.finish()); view.classList.remove('view-in'); void view.offsetWidth; view.classList.add('view-in'); } // re-attaching restarts CSS animations: jump the one-shot intros to their end
    page.classList.remove('out'); page.scrollTop = scroll[key] || 0;
    document.title = `${PAGES.find(p => p[0] === next)[2]} · NEXUS`;
  };
  if (first || same || warm) return show();
  page.classList.add('out'); setTimeout(show, document.documentElement.classList.contains('reduce') ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--t-fade')) || 110);
}
addEventListener('hashchange', route);
if (!location.hash) { let p = 'home'; try { p = localStorage.getItem('jv.page') || p; } catch { } location.hash = '#/' + p; }
route();
$('banner').onclick = e => { if (e.target.closest('button[data-a=retry]')) poll(); }; // M7d D3: same check as the timer

on((st, ev) => {
  $('banner').hidden = st.ok || st.at === 0;
  if (!st.ok) { const b = $('banner'), t = (st.r ? `Tracker not reachable, showing data from ${st.r.at}.` : 'Tracker not reachable. Start it with: node ~/.claude/token-tracker/tracker.js serve.') + ' ' + retryText(); if (b.dataset.t !== t) { b.dataset.t = t; b.innerHTML = `${esc(t)} <button class="btn sm" type="button" data-a="retry">Retry now</button>`; } } // rebuilt only when the text changes, so a focused Retry now keeps focus
  document.body.classList.toggle('stale', !st.ok && !!st.r);
  $('side-state').textContent = st.ok ? 'Tracker live · ' + location.host : 'Tracker offline';
  $('side-state').previousElementSibling.className = 'dot ' + (st.ok ? 'ok' : 'err');
  if (cur === 'home') Home.update(st); else mod?.update(st);
  watchEv(st);
  bell(st);
});
// Claude Code sessions (watch.js): the first poll only sets the mark, so old events never toast
let evMark = null, wnotes = [];
function watchEv(st) {
  const w = st.w; if (!w) return;
  const nu = evMark == null ? [] : (w.events || []).filter(e => e.id > evMark); evMark = w.last;
  wnotes = [...nu.map(e => ({ c: e.type === 'needs' ? 'warn' : 'ok', txt: e.type === 'needs' ? `${e.name} needs you: ${e.why}` : `${e.name} finished`, t: e.at })), ...wnotes].slice(0, 10);
  if (!S.pref('cc.watch')) return;
  for (const e of nu.filter(e => e.type === 'needs')) toast(`${e.name} ${e.why === 'asked a question' ? 'asked you a question' : 'is waiting: ' + e.why}.`, 'need', 'Claude Code needs you');
  const fin = nu.filter(e => e.type === 'finished');
  if (fin.length) toast(fin.length === 1 ? `${fin[0].name} finished its work.` : `${fin.length} sessions finished: ${fin.map(e => e.name).join(', ')}.`, 'ok', fin.length === 1 ? 'Session finished' : 'Sessions finished');
}
start();
tips(); help();
setInterval(() => cur === 'home' && Home.fps(core.fps()), 1000);
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { core?.resize(); Home.resize(); mod?.resize?.(); }, 120); });

// ---------- search (local: pages, sessions, projects) ----------
const q = $('q'), drop = $('q-drop'); let sel = 0, hits = [];
function items() {
  const r = state.r || {};
  return [
    ...PAGES.map(([id, ic, t]) => ({ g: 'Pages', ic, t, href: '#/' + id })),
    ...[...new Set((r.sessions || []).map(s => s[1]))].map(p => ({ g: 'Projects', ic: 'i-folder', t: p, href: '#/projects' })),
    ...(r.sessions || []).map(s => ({ g: 'Sessions', ic: 'i-clock', t: `${s[1]} · ${s[0]}`, sub: s[2], href: '#/sessions/' + s[0] })),
  ];
}
function render() {
  const v = q.value.trim().toLowerCase();
  hits = items().filter(i => !v || (i.t + ' ' + (i.sub || '')).toLowerCase().includes(v)).slice(0, 12);
  sel = Math.min(sel, hits.length - 1);
  let g = '';
  drop.innerHTML = hits.length ? hits.map((h, i) => (h.g !== g ? `<div class="drop-h">${g = h.g}</div>` : '') + `<div class="drop-i ${i === sel ? 'sel' : ''}" data-i="${i}"><svg class="ic"><use href="#${h.ic}"/></svg>${esc(h.t)}<small>${esc(h.sub || '')}</small></div>`).join('') : '<div class="drop-empty">No matches. Search covers pages, projects and sessions.</div>';
  drop.classList.add('open');
}
const go = h => { if (!h) return; location.hash = h.href; q.value = ''; q.blur(); drop.classList.remove('open'); };
q.addEventListener('focus', () => { sel = 0; render(); });
q.addEventListener('input', () => { sel = 0; render(); });
q.addEventListener('blur', () => setTimeout(() => drop.classList.remove('open'), 120));
q.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; render(); }
  else if (e.key === 'Enter') go(hits[sel]);
  else if (e.key === 'Escape') q.blur();
});
drop.addEventListener('mousedown', e => { const i = e.target.closest('[data-i]'); if (i) go(hits[+i.dataset.i]); });
addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); q.focus(); } });

// ---------- notifications ----------
const bd = $('bell-drop'); let notes = [];
// Settings alerts (Claude Code + Plugins & Skills). Each is stamped when first raised, so the badge only lights for new ones.
const stamp = (k, every) => { let m = {}; try { m = JSON.parse(localStorage.getItem('jv.alerts') || '{}'); } catch { } const n = Date.now();
  if (!m[k] || n - m[k] > every) { m[k] = n; try { localStorage.setItem('jv.alerts', JSON.stringify(m)); } catch { } } return m[k]; };
const sess = k => { try { let v = +sessionStorage.getItem('jv.a.' + k); if (!v) { v = Date.now(); sessionStorage.setItem('jv.a.' + k, v); } return v; } catch { return Date.now(); } }; // "each session" = once per NEXUS window
let inv = null; const loadInv = refresh => fetch('/api/inv' + (refresh ? '?refresh=1' : '')).then(x => x.json()).then(j => { if (!j.error) inv = j; return j; }).catch(() => null);
function alerts(st) {
  const A = [], w = st.r?.window, ctx = st.p?.cur?.ctx?.at?.(-1), H5 = 5 * 36e5;
  for (const [k, x] of Object.entries(st.w?.limits?.windows || {})) if (x.pct != null && !x.expired && x.pct >= S.pref('cc.alertPct')) A.push({ c: 'warn', txt: `${k === 'five_hour' ? '5-hour' : k === 'seven_day' ? '7-day' : k.replace(/_/g, ' ')} limit at ${x.pct}% (reported by Claude Code)`, t: stamp('lim' + k + x.resets, 36e5) });
  if (st.w?.limits?.windows?.five_hour?.pct == null && w?.pct != null && w.pct >= S.pref('cc.alertPct')) A.push({ c: 'warn', txt: `5-hour window at ${w.pct}% of your limit (alert at ${S.pref('cc.alertPct')}%)`, t: stamp('win' + w.start, H5) });
  if (ctx && ctx / 2e5 * 100 >= S.pref('cc.ctxWarn')) A.push({ c: 'warn', txt: `Context at ${Math.round(ctx / 2e5 * 100)}% of 200k (estimate): consider /compact`, t: stamp('ctx' + st.p.cur.model, H5) });
  if (inv && S.pref('cc.monitor')) { const every = { session: 0, daily: 864e5, weekly: 6048e5 }[S.pref('pl.freq')] ?? 0, at = k => every ? stamp(k, every) : sess(k), by = {};
    if (S.pref('pl.dup')) { for (const s of inv.skills) (by[s.name] ||= []).push(s.owner || s.source); for (const [n, o] of Object.entries(by)) if (o.length > 1) A.push({ c: 'warn', txt: `Skill loaded ${o.length}×: ${n} (${o.join(' · ')})`, t: at('dup' + n) }); }
    for (const p of inv.plugins) { const k = p.tokens?.always_on; if (k > S.pref('pl.alertTok')) A.push({ c: 'warn', txt: `${p.name} adds ~${k.toLocaleString()} tokens to every session (catalog count)`, t: at('tok' + p.name) }); } }
  return A;
}
// Settings → Plugins & Skills: catalog refresh every N days (reads the marketplaces only; never installs or changes anything)
loadInv().then(j => { if (j && !j.error && S.pref('pl.refresh') === 'days' && Date.now() - (j.catalogAt || 0) > S.pref('pl.days') * 864e5) loadInv(true); });
function bell(st) {
  if (!st.r) return;
  const r = st.r, now = Date.now();
  notes = [
    ...(r.health || []).filter(x => !x[1]).map(x => ({ c: 'warn', txt: `${x[0]}: ${x[2]}`, t: now })),
    ...(r.advisor?.log || []).slice(0, 10).map(x => ({ c: 'ok', txt: `${x[2]} · ${x[3]}`, t: x[0] })),
    ...alerts(st), ...wnotes,
    ...(!S.pref('au.notices') ? [] : r.auto || []).slice(0, 10).map(x => ({ c: 'info', txt: x[1].replace(/\. Backup:.*$/, ''), t: x[0] })),
    ...(!S.pref('sh.bell') ? [] : r.sys || []).map(x => ({ ...x, txt: 'System Health: ' + x.txt })),
  ].sort((a, b) => b.t - a.t).slice(0, 12);
  let seen = 0; try { seen = +localStorage.getItem('jv.seen') || 0; } catch { }
  $('bell').querySelector('.badge').hidden = !notes.some(n => n.t > seen);
}
$('bell').addEventListener('click', e => {
  e.stopPropagation();
  const open = !bd.classList.contains('open');
  bd.innerHTML = '<div class="drop-h">Notifications</div>' + (notes.length ? notes.map(n => `<div class="drop-i" style="cursor:default"><span class="dot ${n.c}"></span>${esc(n.txt)}<small>${ago(n.t)}</small></div>`).join('') : '<div class="drop-empty">Nothing new.</div>');
  bd.classList.toggle('open', open);
  if (open) { try { localStorage.setItem('jv.seen', Date.now()); } catch { } $('bell').querySelector('.badge').hidden = true; }
});
addEventListener('click', e => { if (!bd.contains(e.target)) bd.classList.remove('open'); });

// <base href="/preview/"> turns href="#/x" into /preview/#/x (a different, blank URL), so route every in-app hash link here instead.
addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || e.button || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault(); location.hash = a.getAttribute('href');
});
