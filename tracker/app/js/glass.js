// Glass theme backgrounds (React Bits 1:1 ports): the picked backdrop behind the app (Settings → Purple glass background, CRT Warp default, optional 10-min shuffle), Micro Slats inside the side rail, Pattern Waves in the Home Welcome card. Only while html[data-theme=glass].
// The app and rail backgrounds mount once per theme/background switch; only the page card background remounts on tab change (remounting all of them replayed the intro and flashed the screen).
// Backdrops in ./bg/ are lazy-loaded: only the picked one is downloaded. Each pauses itself when hidden and honours prefers-reduced-motion (their own code).
import { patternWaves } from './bits.js';
import { microSlats, MICRO_SLATS_PREVIEW } from './microslats.js';
import { crtWarp, CRT_WARP_PREVIEW } from './crtwarp.js';
import * as S from './settings.js';
// backdrop + rail tint: the accent pick, muted toward grey (purple B794FF gives the original 8f7cc0-ish violet)
const tone = () => '#' + [1, 3, 5].map(i => Math.round(parseInt((S.pref('ui.accent') || '#B794FF').slice(i, i + 2), 16) * .62 + 23).toString(16).padStart(2, '0')).join('');
const VIOLET = [0.72, 0.55, 1], H = document.documentElement, INK = '#131118', P = ['#5227FF', '#8F5BFF', '#B794FF', '#E6DCFF']; let shell = [], page = [], gen = 0;
// Unmount frees each WebGL context explicitly: browsers cap live contexts (~16), and tab/theme remounts left old ones alive until the oldest (backdrop, orb) went blank white.
const free = el => (el.localName === 'canvas' ? [el] : el.querySelectorAll('canvas')).forEach(c => (c.getContext('webgl2') || c.getContext('webgl'))?.getExtension('WEBGL_lose_context')?.loseContext());
const add = (list, host, cls, make) => { if (!host) return; const el = document.createElement(make ? 'div' : 'canvas'); el.className = 'bits-bg ' + cls; host.prepend(el);
  let r = make ? make(el) : patternWaves(el, { color: VIOLET }), dead = false; if (r?.then) r.then(x => { if (dead) { x.stop(); free(el) } else r = x }); list.push(() => { dead = true; r?.stop?.(); free(el); el.remove() }) };
const lazy = (n, props) => el => import('./bg/' + n + '.js').then(m => m.default(el, { className: '', ...props }));
// Ripple Distortion needs an image to bend: a purple nebula drawn locally (the demo photo would be a network fetch)
const nebula = () => { const c = Object.assign(document.createElement('canvas'), { width: 1600, height: 1000 }), x = c.getContext('2d'); x.fillStyle = INK; x.fillRect(0, 0, 1600, 1000);
  [[300, 250, 520, '#5227FF'], [1250, 300, 480, '#8F5BFF'], [800, 800, 600, '#3B1F8C'], [1100, 700, 300, '#B794FF']].forEach(([cx, cy, r, col]) => { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, col + '99'); g.addColorStop(1, col + '00'); x.fillStyle = g; x.fillRect(0, 0, 1600, 1000) });
  return c.toDataURL('image/png') };
export const BG = {
  crt: el => crtWarp(el, { ...CRT_WARP_PREVIEW, color: tone(), backgroundColor: INK, fps: 30 }),
  ripple: el => lazy('RippleDistortion', { src: nebula(), tint: '#B794FF', tintAmount: 0.35, grayscale: false, highlightColor: '#E6DCFF' })(el),
  waves: lazy('PatternWaves', { color: '#B794FF', backgroundColor: INK }),
  flux: lazy('FluxLines', { colors: [P[2], P[1], P[3]], backgroundColor: INK, transparent: false }),
  shapes: lazy('ShapeWaves', { color: '#7C5CC4', hoverColor: P[3], backgroundColor: INK }),
  fibers: lazy('GhostFibers', { glowColor: '#8B5CF6' }),
  molten: lazy('MoltenMetal', { colors: [P[0], P[2]], coreColor: P[3], backgroundColor: INK }),
  bends: lazy('ColorBends', { colors: P, transparent: false }),
  pillar: lazy('LightPillar', { topColor: P[0], bottomColor: '#C9A8FF' }),
  terminal: lazy('FaultyTerminal', { tint: P[2] }),
  galaxy: lazy('Galaxy', { hueShift: 270, saturation: 0.45, backgroundColor: INK, transparent: false }),
  silk: lazy('Silk', { color: '#5B3AA8', sheenColor: P[3] }),
  slats: el => microSlats(el, { ...MICRO_SLATS_PREVIEW, color: tone(), glintColor: '#e6dcff', backgroundColor: INK }) };
const mountPage = () => { page.forEach(f => f()); page = []; if (H.dataset.theme === 'glass') add(page, document.querySelector('.card.welcome'), 'glass-card-bg') };
const mount = () => { shell.forEach(f => f()); shell = []; mountPage(); if (H.dataset.theme !== 'glass') return; H.dataset.gbg = cur();
  add(shell, document.body, 'glass-bg', BG[cur()] || BG.crt);
  // ASCII Text brand: the NEXUS word drawn as animated ASCII over the (now transparent) title text, which stays for screen readers
  add(shell, document.querySelector('.brand b'), 'brand-ascii', lazy('ASCIIText', { text: 'NEXUS', textColor: '#fff', colors: [P[2], P[3], '#fff'], asciiFontSize: 2, fontWeight: 800, chroma: 0, hueShift: 0, waves: 0.2, tilt: 0 }));
  add(shell, document.querySelector('.side'), 'side-bg', el => microSlats(el, { ...MICRO_SLATS_PREVIEW, color: tone(), glintColor: '#e6dcff', backgroundColor: 'transparent', intro: false })) };
// shuffle: a random other backdrop every 10 min while the pref is on (session only: the saved pick stays as chosen)
let shuffled = null; const cur = () => shuffled || S.pref('ui.glassBg');
setInterval(() => { if (!S.pref('ui.bgShuffle') || H.dataset.theme !== 'glass') return; const k = Object.keys(BG).filter(x => x !== cur()); shuffled = k[Math.random() * k.length | 0]; mount() }, 600000);
S.onChange(k => { if (k === 'ui.accent') return mount(); if (k === 'ui.glassBg' || k === '*') { shuffled = null; if (cur() !== H.dataset.gbg) mount() } if (k === 'ui.bgShuffle' && !S.pref('ui.bgShuffle') && shuffled) { shuffled = null; mount() } });
new MutationObserver(mount).observe(H, { attributes: true, attributeFilter: ['data-theme'] });
addEventListener('hashchange', () => setTimeout(mountPage, 500)); setTimeout(mount, 800);
// the backdrop sits under the app, so it never gets the pointer: re-send moves over the app to it (its own hover effects then follow the cursor)
addEventListener('pointermove', e => { const b = document.querySelector('.glass-bg > div'); if (b && !b.contains(e.target)) (b.querySelector('canvas') || b).dispatchEvent(new PointerEvent('pointermove', e)) }, { passive: true });

// Interaction layer (React Bits ideas, vanilla, glass only): Spotlight Card + border glow, Magnet on primary buttons, Click Spark, sliding nav pill.
// One delegated pointermove batched to rAF; it only writes CSS vars on the card/button under the cursor.
const glass = () => H.dataset.theme === 'glass', calm = () => H.classList.contains('reduce') || matchMedia('(prefers-reduced-motion: reduce)').matches;
let pe = null, pr = 0, card = null, mag = null;
const unmag = () => { if (mag) { mag.style.removeProperty('--tx'); mag.style.removeProperty('--ty'); mag = null } };
addEventListener('pointermove', e => { pe = e; pr ||= requestAnimationFrame(() => {
  pr = 0; if (!glass()) return; const t = pe.target.closest ? pe.target : null;
  const c = t?.closest('.card'); if (card !== c) { card?.classList.remove('spot'); card = c; c?.classList.add('spot') }
  if (c) { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', pe.clientX - r.left + 'px'); c.style.setProperty('--my', pe.clientY - r.top + 'px') }
  const b = calm() ? null : t?.closest('.btn.pri, .icon-btn'); if (b !== mag) unmag();
  if (b) { mag = b; const r = b.getBoundingClientRect(); b.style.setProperty('--tx', ((pe.clientX - r.left) / r.width - .5) * 6 + 'px'); b.style.setProperty('--ty', ((pe.clientY - r.top) / r.height - .5) * 5 + 'px') }
}) }, { passive: true });
document.addEventListener('pointerleave', () => { card?.classList.remove('spot'); card = null; unmag() });
addEventListener('pointerdown', e => { // Click Spark: 8 short rays from the click point
  if (!glass() || calm() || e.button !== 0 || !e.target.closest?.('.btn, .nav-i, .tab, .icon-btn, .chip, [role="tab"], [role="radio"]')) return;
  const s = document.createElement('i'); s.className = 'spark'; s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px'; s.innerHTML = '<b></b>'.repeat(8);
  document.body.append(s); setTimeout(() => s.remove(), 450) }, { passive: true });
// sliding pill behind the active nav item (spring ease), follows the .on class main.js sets
const nav = document.querySelector('.side nav'), pill = Object.assign(document.createElement('span'), { className: 'nav-pill' });
const place = () => { const on = nav?.querySelector('.nav-i.on'); if (!on) return; pill.style.transform = `translateY(${on.offsetTop}px)`; pill.style.height = on.offsetHeight + 'px'; pill.style.opacity = 1 };
if (nav) { nav.prepend(pill); new MutationObserver(place).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] }); addEventListener('resize', place); setTimeout(place, 50) }
