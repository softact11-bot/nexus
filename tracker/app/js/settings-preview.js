// Settings DESIGN PREVIEW bootstrap (settings-preview.html). Runs the real Settings page (pages/settings.js) on the memory-only
// sandbox store: the page's import map remaps settings.js → sandbox-settings.js, so look.js, graph3d.js and sound.js all read sandbox
// values and Save stores nothing. Data comes only from GET endpoints.
import * as S from './settings.js';
import * as Sound from './sound.js';
import './look.js';
import { PAGES } from './placeholder.js';
import * as P from './pages/settings.js';

const $ = id => document.getElementById(id), html = document.documentElement;
Sound.init();
// icons from the real shell (one copy, no drift)
fetch('/preview').then(r => r.text()).then(t => { const d = new DOMParser().parseFromString(t, 'text/html').querySelector('svg defs'); if (d) document.querySelector('svg defs').append(...d.children); });
$('nav').innerHTML = PAGES.map(([id, ic, t]) => `<a class="nav-i${id === 'settings' ? ' on' : ''}" href="#/${id}" data-id="${id}"><svg class="ic"><use href="#${ic}"/></svg>${t}</a>`).join('');
// anim.* → motion tokens (same rule as main.js)
const motion = () => { const k = 1 / Math.min(3, Math.max(.33, +S.pref('anim.speed') || 1)), red = S.reducedMotion();
  for (const [v, ms] of [['--t-page', 220], ['--t-fade', 110], ['--t-ui', 180]]) html.style.setProperty(v, Math.round(ms * k) + 'ms');
  html.style.setProperty('--slide', red ? '0px' : 8 * Math.min(2, Math.max(0, +S.pref('anim.intensity'))) + 'px'); html.classList.toggle('reduce', red); };
S.onChange(motion); motion();
// sidebar links leave the preview: same Save / Discard / Continue Editing guard as the router
document.addEventListener('click', e => { const a = e.target.closest('.side a[href^="#"]'); if (a && P.leave(a.href)) { e.preventDefault(); e.stopPropagation(); } }, true);
P.mount($('page'), [location.hash.split('/')[2]]).then(a => { $('side-state').textContent = a ? 'Tracker live · 127.0.0.1:7788' : 'Tracker offline'; $('side-state').previousElementSibling.className = 'dot ' + (a ? 'ok' : 'err'); });
window.sp = { S, stats: () => P.diag().stats, dirty: () => P.diag().dirty }; // diagnostics only
