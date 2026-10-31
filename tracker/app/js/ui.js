// Small UI parts: tweened counters, sparkline, progress ring, 7/14-day chart, tooltips.
import { toastSound } from './sound.js';
import { esc, tok, sum } from './fmt.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = t => 1 - Math.pow(1 - t, 3);

// Tween a number only when the real value changes.
export function counter(el, v, f = tok) {
  if (!el) return;
  if (v == null || isNaN(v)) { el.textContent = f(null); el._v = null; return; }
  const from = el._v;
  el._v = v;
  if (from == null || from === v || reduced) { el.textContent = f(v); return; }
  const t0 = performance.now();
  const step = now => { const k = Math.min(1, (now - t0) / 600); if (el._v !== v) return; el.textContent = f(from + (v - from) * ease(k)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// Sparkline with a soft fill and a glowing last point.
export function spark(cv, arr, color = '#31D67A') {
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  if (!arr || arr.length < 2) { g.fillStyle = '#63786B'; g.font = '12px Nunito, sans-serif'; g.fillText('Not enough requests yet', 4, h / 2); return; }
  const mx = Math.max(...arr) * 1.08, mn = Math.min(...arr) * .9, pad = 6;
  const X = i => pad + i / (arr.length - 1) * (w - pad * 2), Y = v => pad + (1 - (v - mn) / (mx - mn || 1)) * (h - pad * 2 - 12);
  const path = () => { g.beginPath(); arr.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); };
  path(); g.lineTo(X(arr.length - 1), h); g.lineTo(X(0), h); g.closePath();
  const fill = g.createLinearGradient(0, 0, 0, h); fill.addColorStop(0, 'rgba(49,214,122,.32)'); fill.addColorStop(1, 'rgba(49,214,122,0)');
  g.fillStyle = fill; g.fill();
  path(); g.strokeStyle = color; g.lineWidth = 1.6; g.shadowColor = color; g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;
  const lx = X(arr.length - 1), ly = Y(arr.at(-1));
  g.fillStyle = '#A2F7C5'; g.shadowColor = color; g.shadowBlur = 12; g.beginPath(); g.arc(lx, ly, 3, 0, 7); g.fill(); g.shadowBlur = 0;
}

// Progress ring (SVG). Set the value later with setRing so it animates in.
const C = 2 * Math.PI * 34;
export const ring = (id, label) => `<div class="ring" id="${id}"><svg viewBox="0 0 84 84"><circle class="bg" cx="42" cy="42" r="34"/><circle class="fg" cx="42" cy="42" r="34" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><div><span>${label}</span><b>—</b></div></div>`;
export function setRing(el, p, txt, warn) {
  if (!el) return;
  const fg = el.querySelector('.fg'), off = p == null ? C : C * (1 - Math.max(0, Math.min(100, p)) / 100), b = el.querySelector('b');
  if (fg._o !== off) { fg._o = off; fg.style.strokeDashoffset = off; } // M7b: same value = no restarted 1.1 s transition (no repaint every frame)
  fg.classList.toggle('warn', !!warn); if (b.textContent !== txt) b.textContent = txt;
}

// Daily chart: stacked bars (input, output, cache write) + cache read as a dashed line on its own scale.
export function chart(el, s) {
  const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
  const L = 48, R = 48, T = 8, B = 24, iw = W - L - R, ih = H - T - B, n = s.length, bw = Math.min(30, iw / n * .5);
  const newT = s.map(d => d.inp + d.out + d.cw), m1 = nice(Math.max(...newT, 1)), m2 = nice(Math.max(...s.map(d => d.cr), 1));
  const x = i => L + (i + .5) * iw / n, y1 = v => T + ih - v / m1 * ih, y2 = v => T + ih - v / m2 * ih;
  const day = k => new Date(k + 'T12:00').toLocaleDateString([], n > 7 ? { day: 'numeric' } : { weekday: 'short' });
  let g = '<g class="grid">', b = '', lab = '';
  const k = ih < 110 ? 2 : 4; // fewer gridlines when the chart is short, so axis labels never overlap
  for (let i = 0; i <= k; i++) { const yy = T + ih * i / k; g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`; lab += `<text x="${L - 8}" y="${yy + 4}" text-anchor="end">${tok(m1 * (1 - i / k))}</text><text x="${W - R + 8}" y="${yy + 4}" fill="#5AB8F2" style="fill:#5AB8F2;opacity:.8">${tok(m2 * (1 - i / k))}</text>`; }
  g += '</g>';
  // vertical gradients per token type + a rounded clip per bar so stacks read as one glowing column
  let defs = '<defs>' + [['gi', '#C9FFDF', '#7FE3AA'], ['go', '#5EEB9D', '#1FA862'], ['gw', '#23955A', '#0F5733']].map(([id, a, z]) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--${id}-a, ${a})"/><stop offset="1" style="stop-color:var(--${id}-z, ${z})"/></linearGradient>`).join('');
  s.forEach((d, i) => {
    let yy = T + ih; const segs = [[d.cw, 'url(#gw)'], [d.out, 'url(#go)'], [d.inp, 'url(#gi)']];
    const parts = segs.map(([v, c]) => { const hgt = v / m1 * ih, r = `<rect x="${x(i) - bw / 2}" y="${yy - hgt}" width="${bw}" height="${hgt}" fill="${c}"/>`; yy -= hgt; return r; }).join('');
    defs += `<clipPath id="cb${i}"><rect x="${x(i) - bw / 2}" y="${yy}" width="${bw}" height="${T + ih - yy}" rx="${Math.min(5, bw / 4)}"/></clipPath>`;
    const top = yy < T + ih - 1 ? `<rect x="${x(i) - bw / 2}" y="${yy}" width="${bw}" height="2" style="fill:var(--bar-top, #E6FFF0)" opacity=".7"/>` : '';
    b += `<g class="b" style="transition-delay:${i * 50}ms;filter:drop-shadow(0 0 8px var(--bar-glow, rgba(49,214,122,.3)))"><g clip-path="url(#cb${i})">${parts}${top}</g></g>`;
    lab += `<text x="${x(i)}" y="${H - 4}" text-anchor="middle">${day(d.k)}</text>`;
    b += `<rect class="hit" x="${x(i) - iw / n / 2}" y="${T}" width="${iw / n}" height="${ih}" data-tip="${esc(`<b>${new Date(d.k + 'T12:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</b><br>Input ${tok(d.inp)} · Output ${tok(d.out)}<br>Cache write ${tok(d.cw)} · Cache read ${tok(d.cr)}${d.has ? '' : '<br>No requests tracked'}`)}" data-html="1"/>`;
  });
  const pts = s.map((d, i) => `${x(i)},${y2(d.cr)}`).join(' ');
  const line = `<polyline class="cr" points="${pts}"/>` + s.map((d, i) => `<circle class="crp" cx="${x(i)}" cy="${y2(d.cr)}" r="2.6"/>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${defs}</defs>${g}${lab}${b}${line}</svg>`;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('shown')));
}
function nice(v) { const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; }

// One shared tooltip for every [data-tip] (native title= is folded in). Mouse: follows the pointer. Keyboard focus: under the control,
// flipped above when there is no room. Always inside the window; Escape or blur hides it; announced via aria-describedby.
export function tips() {
  const t = document.createElement('div'); t.className = 'tip'; t.id = 'nx-tip'; t.setAttribute('role', 'tooltip'); document.body.append(t);
  let cur = null;
  const find = n => { const el = n?.closest?.('[data-tip], [title]'); if (el && !el.dataset.tip && el.title) { el.dataset.tip = el.title; el.removeAttribute('title') } return el };
  const hide = () => { t.classList.remove('on'); cur?.removeAttribute('aria-describedby'); cur = null };
  const show = el => {
    if (!el?.dataset.tip) return hide();
    if (cur !== el) { hide(); cur = el; el.setAttribute('aria-describedby', t.id) }
    if (el.dataset.html) t.innerHTML = el.dataset.tip; else t.textContent = el.dataset.tip;
    if (!el.matches('button[data-more]') && moreOf(el)) t.insertAdjacentHTML('beforeend', '<span class="more">ⓘ Learn more <kbd>F1</kbd></span>');
    t.classList.add('on'); return true;
  };
  const at = (x, y) => { const r = t.getBoundingClientRect(); t.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x)) + 'px'; t.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, y)) + 'px' };
  addEventListener('pointerover', e => show(find(e.target)) && at(e.clientX + 14, e.clientY + 16));
  addEventListener('pointermove', e => cur && t.classList.contains('on') && at(e.clientX + 14, e.clientY + 16));
  addEventListener('focusin', e => { if (!e.target.matches?.(':focus-visible')) return; const el = find(e.target); if (!show(el)) return;
    const b = el.getBoundingClientRect(), h = t.getBoundingClientRect().height;
    at(b.left, b.bottom + h + 14 > innerHeight ? b.top - h - 6 : b.bottom + 6) });
  addEventListener('focusout', hide);
  addEventListener('keydown', e => e.key === 'Escape' && cur && hide(), true);
}

// ---------- shared page parts (Phase A) ----------
export const icon = id => `<svg class="ic"><use href="#${id}"/></svg>`;

// Segmented tabs / filter chips. items: [value, label, href?]. With href it routes, else a button with data-v.
export const seg = (items, cur, cls = 'tabs') => `<div class="${cls}" role="tablist">${items.map(([v, t, href]) => {
  const on = String(v) === String(cur), a = `class="tab${on ? ' on' : ''}" role="tab" aria-selected="${on}"`;
  return href ? `<a ${a} href="${href}">${esc(t)}</a>` : `<button ${a} data-v="${esc(v)}">${esc(t)}</button>`;
}).join('')}</div>`;

// Empty / loading / error state.
export const stateBox = (kind, title, msg = '') => `<div class="state ${kind}" role="${kind === 'error' ? 'alert' : 'status'}">${kind === 'loading' ? '<span class="spin"></span>' : icon(kind === 'error' ? 'i-pulse' : 'i-search')}<b>${esc(title)}</b>${msg ? `<span>${msg}</span>` : ''}</div>`;

// Sortable table. cols: [key, label, { num, f(value,row), tip, cls }]. sort: [key, dir]. on.sort(key), on.row(row).
export function table(el, cols, rows, sort, on = {}) {
  el.innerHTML = `<table class="tbl${on.row ? ' click' : ''}"><thead><tr>${cols.map(([k, t, o = {}]) => `<th class="${o.num ? 'n' : ''}" aria-sort="${sort[0] === k ? (sort[1] > 0 ? 'ascending' : 'descending') : 'none'}"><button data-k="${k}"${o.tip ? ` data-tip="${esc(o.tip)}"` : ''}>${t}<i></i></button></th>`).join('')}</tr></thead>
<tbody>${rows.map((r, i) => `<tr data-i="${i}"${on.row ? ' tabindex="0"' : ''}>${cols.map(([k, , o = {}]) => `<td class="${o.num ? 'n ' : ''}${o.cls || ''}">${o.f ? o.f(r[k], r) : esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  el.querySelector('thead').onclick = e => { const b = e.target.closest('[data-k]'); if (b) on.sort?.(b.dataset.k); };
  if (on.row) {
    const go = e => { const tr = e.target.closest('tr[data-i]'); if (tr) on.row(rows[+tr.dataset.i]); };
    const tb = el.querySelector('tbody'); tb.onclick = go; tb.onkeydown = e => e.key === 'Enter' && go(e);
  }
}

// Toasts stack bottom-right. M7d D2: error toasts stay until closed; the same message again bumps a ×n count; at most 3 errors (oldest goes).
export function toast(msg, kind = 'ok', title = "Couldn't finish that") {
  let box = document.getElementById('nx-toasts'); if (!box) { box = document.createElement('div'); box.id = 'nx-toasts'; document.body.append(box) }
  const t = document.createElement('div'); t.className = 'toast ' + (kind === 'need' ? 'warn' : kind); // need = stays until closed, like err, but warn-styled (Claude Code needs you)
  if (kind === 'err' || kind === 'need') {
    const same = [...box.children].find(x => x._m === msg); if (same) { same.querySelector('.n').textContent = '×' + ++same._n; return toastSound(kind) }
    t._m = msg; t._n = 1; t.setAttribute('role', 'alert'); if (kind === 'need') t.classList.add('err');
    t.innerHTML = `<span class="ico" aria-hidden="true">!</span><div><b>${esc(title)}</b> <small>· stays until closed <span class="n"></span></small><p>${esc(msg)}</p></div><button class="x" type="button" aria-label="Dismiss">×</button>`;
    t.querySelector('.x').onclick = () => t.remove();
    const errs = box.querySelectorAll('.toast.err'); if (errs.length >= 3) errs[0].remove();
  } else { t.setAttribute('role', 'status'); t.textContent = msg; setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 300); }, 2800) }
  box.append(t); requestAnimationFrame(() => t.classList.add('on')); toastSound(kind);
}

// M7d D2 Learn More. more(key, name) = the ⓘ button placed after a control; it, F1 on the focused control, or an errBox "Learn more" opens a side panel.
// Content: MORE[key] = { area, title, what, when[], impact: { tokens, files, privacy, load }, notes[], tech }. Pages add their own entries.
export const MORE = {};
export const more = (key, name) => `<button class="nx-i" type="button" data-more="${esc(key)}" aria-label="Learn more: ${esc(name)}" data-tip="Learn more (F1)">i</button>`;
const moreOf = el => { const m = el?.closest?.('[data-more]') || (el?.nextElementSibling?.matches('button[data-more]') && el.nextElementSibling); return m && MORE[m.dataset.more] ? m.dataset.more : null };
export function learnMore(key, from = document.activeElement) {
  const m = MORE[key]; if (!m) return;
  document.querySelector('.lm')?._close();
  const li = a => a?.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '', I = m.impact || {};
  const imp = [['Claude tokens', I.tokens], ['Your files', I.files], ['Privacy', I.privacy], ['PC load', I.load]].filter(x => x[1]).map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('');
  const sec = (h, x) => x ? `<section><h4>${h}</h4>${x}</section>` : '';
  document.body.insertAdjacentHTML('beforeend', `<div class="lm-scrim"></div><aside class="lm" role="dialog" aria-modal="true" aria-labelledby="lm-t">
  <div class="lm-h"><span class="ico" aria-hidden="true">i</span><div><small>Learn more · ${esc(m.area)}</small><h3 id="lm-t">${esc(m.title)}</h3></div><button class="lm-x" type="button" aria-label="Close">×</button></div>
  <div class="lm-b" tabindex="0">${sec('What it does', m.what && `<p>${esc(m.what)}</p>`)}${sec('When to use it', li(m.when))}${sec('What changes', imp && `<div class="lm-imp">${imp}</div>`)}${sec('Good to know', li(m.notes))}
  ${m.tech ? `<details><summary>Technical details</summary><div class="mono">${esc(m.tech)}</div></details>` : ''}</div>
  <div class="lm-f"><span><kbd>Esc</kbd> closes · <kbd>F1</kbd> opens help for the focused control</span><button class="btn sm lm-c" type="button">Close</button></div></aside>`);
  const p = document.querySelector('.lm'), s = p.previousElementSibling;
  const keys = e => { if (e.key === 'Escape') { e.stopPropagation(); return p._close() } if (e.key !== 'Tab') return; // focus stays inside the panel
    const f = [...p.querySelectorAll('button, summary, .lm-b')], a = f[0], z = f.at(-1), at = document.activeElement;
    if (!p.contains(at) || (e.shiftKey ? at === a : at === z)) { e.preventDefault(); (e.shiftKey ? z : a).focus() } };
  p._close = () => { p.remove(); s.remove(); removeEventListener('keydown', keys, true); if (from?.isConnected) from.focus() };
  addEventListener('keydown', keys, true); s.onclick = p.querySelector('.lm-x').onclick = p.querySelector('.lm-c').onclick = p._close;
  p.querySelector('.lm-x').focus();
}

// M7d D2 error card: what happened, why it matters, what is affected, how to recover; technical details collapsed.
// o: { title, where, what, why, affected, steps[], safe, actions: [[data-a, label, primary]], more: [key, name], tech }.
// Offer an action only for a real, tested recovery (the page handles its data-a); anything destructive must ask first.
export const errBox = o => `<section class="eb" role="alert">
  <div class="eb-h"><span class="ico" aria-hidden="true">!</span><div><h3>${esc(o.title)}</h3>${o.where ? `<small>${esc(o.where)}</small>` : ''}</div>${o.safe ? `<span class="eb-safe">✓ ${esc(o.safe)}</span>` : ''}</div>
  <div class="eb-g">${[['What happened', o.what], ['Why it matters', o.why], ["What's affected", o.affected]].filter(x => x[1]).map(([h, p]) => `<div><span>${h}</span><p>${esc(p)}</p></div>`).join('')}</div>
  ${o.steps?.length || o.actions?.length || o.more ? `<div class="eb-fix">${o.steps?.length ? `<ol>${o.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}${(o.actions || []).map(([a, l, pri]) => `<button class="btn sm${pri ? ' pri' : ''}" type="button" data-a="${esc(a)}">${esc(l)}</button>`).join('')}${o.more ? `<button class="btn sm ghost" type="button" data-more="${esc(o.more[0])}" aria-label="Learn more: ${esc(o.more[1])}">Learn more</button>` : ''}</div>` : ''}
  ${o.tech ? `<details><summary>Technical details</summary><div class="mono">${esc(o.tech)}</div><div class="eb-cp"><button class="btn sm ghost" type="button" data-copy-tech>Copy details</button></div></details>` : ''}</section>`;

// Wire Learn More (click + F1) and "Copy details" once for the whole app.
export function help() {
  addEventListener('click', e => { const b = e.target.closest?.('button[data-more]'); if (b) return learnMore(b.dataset.more, b);
    const c = e.target.closest?.('[data-copy-tech]'); if (c) navigator.clipboard?.writeText(c.closest('details').querySelector('.mono').textContent).then(() => toast('Copied.'), () => toast('Copy failed.', 'err')) });
  addEventListener('keydown', e => { if (e.key !== 'F1') return; const k = moreOf(document.activeElement) || moreOf(document.querySelector('[aria-describedby="nx-tip"]')); if (k) { e.preventDefault(); learnMore(k, document.activeElement) } });
}

// Line/area chart for one series. null values are gaps (no data). keys = 'YYYY-MM-DD' per point.
// o: { color (CSS color, may be var()), f (axis/tip format), max, tip(i) → html }
let gid = 0;
export function area(el, vals, keys, o = {}) {
  const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
  const f = o.f || tok, c = o.color || 'var(--primary)', n = vals.length, id = 'ag' + gid++;
  const L = 46, R = 12, T = 10, B = 22, iw = W - L - R, ih = H - T - B;
  const m = o.max ?? nice(Math.max(1, ...vals.filter(v => v != null)));
  const x = i => L + (n < 2 ? iw / 2 : i / (n - 1) * iw), y = v => T + ih - Math.min(v, m) / m * ih;
  const segs = []; let run = [];
  vals.forEach((v, i) => { if (v == null) { run.length && segs.push(run); run = []; } else run.push(i); }); run.length && segs.push(run);
  let shape = '';
  for (const sg of segs) {
    const pts = sg.map(i => `${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ');
    shape += sg.length > 1 ? `<polygon class="af" fill="url(#${id})" points="${x(sg[0])},${T + ih} ${pts} ${x(sg.at(-1))},${T + ih}"/><polyline class="al" pathLength="1" points="${pts}"/>` : `<circle class="ap" cx="${x(sg[0])}" cy="${y(vals[sg[0]])}" r="3"/>`;
  }
  let g = '';
  for (let i = 0; i <= 2; i++) { const yy = T + ih * i / 2; g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end">${f(m * (1 - i / 2))}</text>`; }
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
  keys.forEach((k, i) => { if ((n - 1 - i) % step === 0) g += `<text x="${x(i)}" y="${H - 5}" text-anchor="${n > 1 && i === n - 1 ? 'end' : 'middle'}">${new Date(k + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}</text>`; });
  const hw = n < 2 ? iw : iw / (n - 1);
  const hits = keys.map((k, i) => `<rect class="hit" x="${x(i) - hw / 2}" y="${T}" width="${hw}" height="${ih}" data-html="1" data-tip="${esc(o.tip ? o.tip(i) : `<b>${k}</b><br>${vals[i] == null ? 'No data' : f(vals[i])}`)}"/>`).join('');
  el.innerHTML = `<svg class="area" viewBox="0 0 ${W} ${H}" style="--c:${c}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--c);stop-opacity:.34"/><stop offset="1" style="stop-color:var(--c);stop-opacity:0"/></linearGradient></defs>${g}${shape}${hits}</svg>`;
}

// Download text as a file (CSV / JSON export).
export function download(name, text, type = 'text/csv') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// KPI tile: icon left, label / animated value / foot right, source chip top-right. tint = CSS color for the icon tile.
export const kpi = (id, ic, label, tint) => `<div class="kpi" id="${id}"${tint ? ` style="--tc:${tint}"` : ''}><span class="tile-ic">${icon(ic)}</span><div class="kpi-b"><span class="k">${label}</span><b class="v">—</b><small class="f"></small></div><span class="kc"></span></div>`;
export function setKpi(el, v, f, foot, c) {
  if (!el) return;
  counter(el.querySelector('.v'), v, f); el.querySelector('.f').innerHTML = foot; el.querySelector('.kc').innerHTML = c;
}

// Donut: parts [[label, value, color]]; segments grow in once drawn.
export function donut(el, parts, center, sub) {
  const tot = sum(parts.map(p => p[1])) || 1; let off = 25; // circumference 100, start at 12 o'clock
  const segs = parts.map(([t, v, c]) => {
    const len = v / tot * 100, seg = `<circle class="dseg" r="15.9155" cx="21" cy="21" style="--len:${Math.max(0, len - (len > 1 ? .5 : 0))};--off:${off};stroke:${c}" data-tip="${esc(`${t}: ${tok(v)} (${Math.round(len)}%)`)}"/>`;
    off -= len; return seg;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 42 42" class="donut"><circle class="dbg" r="15.9155" cx="21" cy="21"/>${segs}</svg><div class="dc"><b>${center}</b><small>${sub}</small></div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('shown')));
}

// Session A vs B comparison table (Sessions + Analytics). labels: column names for A and B.
export function compareRows(A, B, labels = ['A', 'B']) {
  const full = n => n == null ? '—' : Math.round(n).toLocaleString();
  const M = [['n', 'Requests', full], ['inp', 'Input', tok], ['out', 'Output', tok], ['cw', 'Cache write', tok], ['cr', 'Cache read', tok], ['tot', 'Total', tok],
    ['perReq', 'Per request', tok], ['eff', 'Cache efficiency', v => v == null ? '—' : v + '%'], ['waste', 'Waste (est.)', tok]];
  const diff = (x, y) => x == null || y == null || !x ? '<span class="muted">—</span>' : y === x ? '<span class="muted">same</span>' : `<span class="${y > x ? 'up' : 'down'}">${y > x ? '+' : '−'}${Math.abs(Math.round((y - x) / x * 100))}%</span>`;
  return `<table class="tbl cmp-t"><thead><tr><th></th><th class="n">${labels[0]}</th><th class="n">${labels[1]}</th><th class="n">Diff</th></tr></thead><tbody>
${M.map(([k, n, f]) => `<tr><td>${n}</td><td class="n">${f(A[k])}</td><td class="n">${f(B[k])}</td><td class="n">${diff(A[k], B[k])}</td></tr>`).join('')}</tbody></table>`;
}

// M7d Saved Usage strip (Home + Analytics): estimated, verified, overhead and net kept apart; r.savings from the tracker (savings.js).
const usd = v => v == null || isNaN(v) ? '—' : Math.abs(v) < 0.01 ? (v ? '<$0.01' : '$0') : (v < 0 ? '−$' : '$') + (Math.abs(v) < 100 ? Math.abs(v).toFixed(2) : Math.round(Math.abs(v)).toLocaleString());
const svTile = (k, label, [c, t]) => `<div class="m ${k}" tabindex="0" data-html="1" data-tip=""><span>${label} <i class="tg ${c}">${t}</i></span><b>—</b><small>&nbsp;</small></div>`;
export const savedStrip = () => `<section class="svs" aria-label="Saved usage" hidden>
  <div class="hd"><span class="ico" aria-hidden="true">↓</span><div><b>Saved Usage</b><small>All time · tracker on this PC</small></div></div>
  ${svTile('est', 'Est. saved', ['est', 'Estimate'])}${svTile('ver', 'Verified', ['ver', 'Measured'])}${svTile('ovh', 'Overhead', ['est', 'Estimate'])}${svTile('net', 'Net', ['unk', 'Unknown'])}
  <a class="btn sm go" href="#/optimizations/savings" data-tip="Open Optimizations → Verified Savings">Details →</a></section>`;
export function setSaved(root, sv) {
  const el = root?.querySelector('.svs'); if (!el) return;
  if (!sv) return void (el.hidden = true);
  if (el.hidden) { el.hidden = false; if (!reduced) el.addEventListener('pointermove', e => el.style.setProperty('--mx', (e.clientX - el.getBoundingClientRect().left) + 'px')) }
  const v = sv.verified, o = sv.overhead, e = sv.estimated, ver = v.status === 'verified', P = Object.entries(sv.prices || {}).map(([m, p]) => `${esc(m.replace(/^claude-/, ''))}: $${p.in} in · $${p.out} out · $${p.cw} cache write · $${p.cr} cache read`).join('<br>');
  const set = (k, val, sub, tip, dim) => { const t = el.querySelector('.m.' + k), b = t.querySelector('b');
    if (typeof val === 'number') { if (b._v === undefined && val) b._v = 0; counter(b, val, usd) } else { b._v = undefined; b.textContent = val }
    b.classList.toggle('dim', !!dim); t.querySelector('small').textContent = sub; t.dataset.tip = tip };
  const src = `<br><i>Prices per million tokens (${esc(sv.priceSrc)}):<br>${P}</i>`;
  set('est', e.usd, e.usd ? 'from before/after checks' : 'no clear effect yet',
    `<b>Estimated saved</b><br>Waste avoided after tips (repeat reads, duplicate searches; text length ÷ 4, so an estimate) priced at the rate you actually paid per token, plus any cost drop that is not yet proven. <b>Never</b> counted as verified.<br><i>Source: tracker session logs.</i>`);
  set('ver', v.usd, ver ? `−${v.pct}% cost per request (90%: ${v.ci[0]} to ${v.ci[1]}%)` : v.status === 'collecting' ? `collecting: ${v.nAfter}/${v.min} with, ${v.nBase}/${v.min} without` : v.status === 'costlier' ? 'no saving: cost per request went up' : 'no clear effect',
    `<b>Verified saved</b><br>Real dollar cost per request from Claude Code usage logs, priced per model with cache writes and reads at their own rates. Sessions with optimizers are compared only with sessions without them in the same project, model and length. Counted only with ${v.min}+ sessions on each side, a 90% interval that excludes zero, and a drop that is still positive after the optimizers' own cost (it is already inside the measured sessions).${src}`, !ver);
  set('ovh', o.usd, `${tok(o.tok)} tokens · ${usd(o.usdFull)} at full price`,
    `<b>Optimizer overhead</b><br>Text that tips, hooks, skills and plugins add (${tok(o.tok)} tokens, characters ÷ 4: estimate). Priced cache-aware: written to cache once per session, then re-read at the cache-read rate, so cached content is not counted twice. Assumes it all arrives at session start, so it is an upper bound. At full input price every request it would be ${usd(o.usdFull)}.${src}`);
  const n = sv.net, m = n.status === 'measured', tg = el.querySelector('.m.net .tg');
  tg.className = 'tg ' + (m ? 'ver' : 'unk'); tg.textContent = m ? 'Measured' : 'Unknown';
  set('net', m ? n.usd : 'Not measured yet', m ? 'verified saving, after overhead' : `est. ${usd(n.estUsd)} (estimate − overhead)`,
    m ? `<b>Net saved</b><br>Equals the verified saving: the measured sessions already include the optimizers' own cost.` : `<b>Net saved: not yet measured</b><br>Shown once a verified saving exists.<br><br>Rough estimate: estimated saved − overhead = <b>${usd(n.estUsd)}</b>. Both sides are estimates, and the overhead is an upper bound.`);
  el.querySelector('.m.net').classList.toggle('unk', !m);
}
