// Central UI sound manager for every page. Sounds are synthesized locally once (OfflineAudioContext → AudioBuffers): no files,
// no downloads. Prefs (settings.js): sound.mute, sound.volume, sound.hover, sound.notify. One voice at a time: a sound never stacks
// on itself, a lower-priority sound never cuts in, and nothing plays without a user gesture in the last 8 s (no sounds for
// background activity). Global listeners cover clicks, nav, tabs, menus, dialogs and toasts; pages call play() for the rest.
import * as S from './settings.js';

// name: [priority, voices], voice = [startS, f0, f1, durS, wave, gain]; f1 = glide target
const DEF = {
  hover: [0, [[0, 2600, 2600, .03, 'sine', .05]]],
  click: [1, [[0, 1900, 1500, .035, 'sine', .22], [0, 3800, 3000, .02, 'sine', .05]]],
  toggle: [1, [[0, 1250, 1500, .045, 'sine', .18]]],
  tab: [2, [[0, 880, 880, .05, 'sine', .14], [.035, 1320, 1320, .07, 'sine', .12]]],
  nav: [2, [[0, 520, 780, .11, 'sine', .12], [.02, 1560, 1560, .09, 'sine', .04]]],
  open: [2, [[0, 620, 930, .09, 'sine', .14]]],
  close: [2, [[0, 930, 620, .08, 'sine', .11]]],
  notify: [3, [[0, 1320, 1320, .22, 'sine', .12], [.09, 1760, 1760, .3, 'sine', .1]]],
  success: [3, [[0, 784, 784, .16, 'sine', .12], [.07, 1047, 1047, .18, 'sine', .12], [.14, 1568, 1568, .3, 'sine', .1]]],
  warn: [3, [[0, 587, 587, .14, 'triangle', .1], [.12, 494, 494, .2, 'triangle', .1]]],
  error: [3, [[0, 330, 247, .22, 'triangle', .13]]],
  sync: [3, [[0, 523, 523, .1, 'sine', .1], [.06, 784, 784, .1, 'sine', .1], [.12, 1047, 1047, .22, 'sine', .1]]],
};
const RATE = 44100, buf = {}; let ctx = null, out = null, cur = null, lastIn = 0, lastPlay = {}, pend = null; const log = []; // log: last 20 sounds played (diagnostics)

async function render([, voices]) {
  const len = Math.max(...voices.map(v => v[0] + v[3])) + .05, oc = new OfflineAudioContext(1, Math.ceil(len * RATE), RATE);
  for (const [t, f0, f1, d, w, g] of voices) {
    const o = oc.createOscillator(), e = oc.createGain(); o.type = w; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + d);
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + .004); e.gain.exponentialRampToValueAtTime(.0001, t + d); // soft attack, exponential tail
    o.connect(e).connect(oc.destination); o.start(t); o.stop(t + d + .01);
  }
  return oc.startRendering();
}
async function boot() {
  if (ctx) return; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC(); out = ctx.createGain(); const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -10; out.connect(lim).connect(ctx.destination); vol();
  await Promise.all(Object.entries(DEF).map(async ([k, d]) => { buf[k] = await render(d); }));
  if (pend && performance.now() - pend.at < 400) play(pend.name); pend = null;
}
const vol = () => { if (out) out.gain.value = S.pref('sound.mute') ? 0 : Math.max(0, Math.min(1, +S.pref('sound.volume'))); };

// play(name, opts): obeys mute/volume/hover/notify prefs and the overlap rules. preview: true skips the gesture and hover/notify checks (Settings page).
export function play(name, { preview = false, task = false } = {}) { // task: result of a long job the user started (sync, plugin install)
  const d = DEF[name]; if (d && ctx && !buf[name]) pend = { name, at: performance.now() }; // still rendering (first gesture): play once ready
  if (!d || !ctx || !buf[name] || S.pref('sound.mute') || !(+S.pref('sound.volume') > 0)) return;
  if (!preview) {
    if (!task && performance.now() - lastIn > 8000) return; // background activity stays silent
    if (name === 'hover' && !S.pref('sound.hover')) return;
    if (d[0] === 3 && !S.pref('sound.notify')) return;
  }
  const now = performance.now(); if (now - (lastPlay[name] || 0) < 90) return; // no rapid repeats
  if (cur && now < cur.end && d[0] < cur.p) return; // never cut in on a more important sound
  if (cur && now < cur.end) try { cur.src.stop(); } catch { }
  if (ctx.state === 'suspended') ctx.resume();
  const src = ctx.createBufferSource(); src.buffer = buf[name]; src.connect(out); src.start();
  lastPlay[name] = now; log.push(name); if (log.length > 20) log.shift(); cur = { src, p: d[0], end: now + buf[name].duration * 1000 };
}
export const names = Object.keys(DEF);
export const diag = () => ({ state: ctx?.state ?? 'off', loaded: Object.keys(buf).length, gain: out?.gain.value, log: [...log] });

// ---------- global hooks (installed once from main.js) ----------
const HOVER = '.btn.pri, .nav-i, .kg-q'; // important targets only
export function init() {
  const gesture = () => { lastIn = performance.now(); boot(); };
  addEventListener('pointerdown', gesture, true); addEventListener('keydown', gesture, true);
  addEventListener('click', e => {
    if (!e.isTrusted) return; const t = e.target.closest?.('a, button, summary, [role="button"], [role="tab"], select, input[type="checkbox"], input[type="radio"]'); if (!t || t.disabled) return;
    if (t.matches('.nav-i')) play('nav');
    else if (t.closest('.otabs, .tabs, .seg, [role="tablist"]')) play('tab');
    else if (t.matches('summary')) play(t.parentElement?.open ? 'close' : 'open');
    else if (t.matches('input')) play('toggle');
    else if (!t.matches('[data-a="sync"], [data-a="doSync"]')) play('click');
  }, true);
  let hv = null; addEventListener('pointerover', e => { const t = e.target.closest?.(HOVER); if (t && t !== hv) play('hover'); hv = t; }, true);
  const D = HTMLDialogElement.prototype, sm = D.showModal;
  D.showModal = function (...a) { if (!this.open) play('open'); return sm.apply(this, a); };
  addEventListener('close', e => { if (e.target instanceof HTMLDialogElement) play('close'); }, true); // also form method=dialog closes
  S.onChange(k => { if (k === '*' || k.startsWith('sound.')) vol(); });
}
// toast kind → sound (ui.js toast calls this; silent unless the user acted in the last 8 s)
export const toastSound = kind => play({ ok: 'success', err: 'error', warn: 'warn' }[kind] || 'notify');
