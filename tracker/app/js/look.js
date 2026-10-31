// Appearance + accessibility prefs → the whole app (imported once by main.js; settings-preview.html runs it on the sandbox store).
// html[data-theme|layout|bg|cb|contrast|focus], accent vars, status colours per colour-blind mode, interface scale on #page.
import * as S from './settings.js';
const html = document.documentElement, hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) || 0);
// [ok, warn, err, info] + 4 chart series + 6 clusters, picked so neighbours stay apart under each simulation
export const CVD = {
  off: [['#31D67A', '#F2B544', '#F2555A', '#5AB8F2'], ['#A2F7C5', '#31D67A', '#1E8F55', '#5AB8F2'], ['#8B5CF6', '#E8742A', '#22B868', '#3474E0', '#D9A02B', '#D9405C']],
  protan: [['#56B4E9', '#F0E442', '#E69F00', '#CC79A7'], ['#56B4E9', '#F0E442', '#E69F00', '#CC79A7'], ['#56B4E9', '#E69F00', '#F0E442', '#0072B2', '#CC79A7', '#FFFFFF']],
  deutan: [['#56B4E9', '#F0E442', '#D55E00', '#CC79A7'], ['#56B4E9', '#F0E442', '#D55E00', '#CC79A7'], ['#56B4E9', '#D55E00', '#F0E442', '#0072B2', '#CC79A7', '#FFFFFF']],
  tritan: [['#2EC4B6', '#FF8FB1', '#E8202A', '#E8E8E8'], ['#2EC4B6', '#FF8FB1', '#E8202A', '#9A9A9A'], ['#2EC4B6', '#E8202A', '#FF8FB1', '#006D77', '#9A9A9A', '#FFFFFF']],
};
const lum = c => hex(c).reduce((s, v, i) => { v /= 255; return s + [.2126, .7152, .0722][i] * (v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); }, 0);
const dark = c => { let x = c; for (let i = 0; i < 30 && 1.05 / (lum(x) + .05) < 4.5; i++) x = '#' + hex(x).map(v => Math.round(v * .93).toString(16).padStart(2, '0')).join(''); return x; };
export function look() {
  try { if (localStorage.getItem('jv.glassPreview')) { localStorage.removeItem('jv.glassPreview'); S.set('ui.theme', 'glass'); } } catch { } // old preview flag → saved theme
  const th = S.pref('ui.theme'), t = th === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : th, acc = S.pref('ui.accent');
  Object.assign(html.dataset, { theme: t, layout: S.pref('ui.layout'), bg: S.pref('ui.bg'), cb: S.pref('a11y.cb'), contrast: S.pref('a11y.contrast') ? 1 : 0, focus: S.pref('a11y.focus') ? 1 : 0 });
  // light: accent + status colours darkened until they read on white (4.5:1); --accent keeps the raw pick for the 3D core glow
  const ink = t === 'light' ? dark : c => c, pri = ink(acc), [r, g, b] = hex(pri);
  html.style.setProperty('--accent', acc); html.style.setProperty('--primary', pri); html.style.setProperty('--primary-rgb', `${r}, ${g}, ${b}`);
  const [st] = CVD[S.pref('a11y.cb')] || CVD.off; ['--ok', '--warn', '--error', '--info'].forEach((v, i) => html.style.setProperty(v, ink(st[i])));
  const p = document.getElementById('page'); if (p) p.style.zoom = +S.pref('a11y.scale') === 100 ? '' : S.pref('a11y.scale') / 100;
}
S.onChange(k => { if (k === '*' || /^(ui|a11y)./.test(k)) look(); });
matchMedia('(prefers-color-scheme: light)').addEventListener('change', look);
look();
