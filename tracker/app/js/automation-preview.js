// Automation DESIGN PREVIEW bootstrap (automation-preview.html). Runs pages/automation.js with { preview: true }:
// GET data only, actions stop at the confirm dialog, layout saved under jv.auto.preview.
import './look.js';
import { PAGES } from './placeholder.js';
import * as P from './pages/automation.js';

const $ = id => document.getElementById(id);
// icons from the real shell (one copy, no drift)
const icons = fetch('/preview').then(r => r.text()).then(t => { const d = new DOMParser().parseFromString(t, 'text/html').querySelector('svg defs'); if (d) document.querySelector('svg defs').append(...d.children); });
$('nav').innerHTML = PAGES.map(([id, ic, t]) => `<a class="nav-i${id === 'automation' ? ' on' : ''}" href="#/${id}" data-id="${id}"><svg class="ic"><use href="#${ic}"/></svg>${t}</a>`).join('');
icons.then(() => P.mount($('page'), [], { preview: true })).then(a => { $('side-state').textContent = a ? 'Tracker live · 127.0.0.1:7788' : 'Tracker offline'; $('side-state').previousElementSibling.className = 'dot ' + (a ? 'ok' : 'err'); });
