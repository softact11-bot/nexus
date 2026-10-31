// M7e Rearrange Mode: drag and resize dashboard cards inside their own page only. Off by default. Saved per page in one localStorage
// write (nx.layout, schema v1); a saved layout that is invalid or no longer matches the page's cards is ignored (defaults shown).
// Grid flow + column spans means cards can never overlap; height only grows (min-height), so content is never clipped.
import { toast } from './ui.js';
const K = 'nx.layout', KT = 'nx.layout.tut', V = 1, MAXH = 20, STEP = 40;
const SEL = { home: '.home-grid', system: '.sh-grid', automation: '.au-grid' };
const TUT = ['Drag a card by its ⠿ handle to a new place on this page. The outlined card shows where it will go.', 'Use the corner handle, or the − / + buttons, to change a card\'s width and height. Sizes snap to the grid.', 'Save & Exit keeps the layout. Cancel undoes this edit. Reset puts the page back to its default layout.'];
const load = () => { try { const j = JSON.parse(localStorage.getItem(K)); if (j?.v === V && j.p && typeof j.p === 'object') return j } catch { } return { v: V, p: {} } };
let store = load(), ed = null, ro = null, mo = null; // ed = { page, g, view, L, saved }
const kids = g => [...g.children].filter(c => c.nodeType === 1);
const ok = (L, n) => L && Array.isArray(L.o) && L.o.length === n && new Set(L.o).size === n && L.o.every(i => Number.isInteger(i) && i >= 0 && i < n)
  && [L.w, L.h].every(a => Array.isArray(a) && a.length === n && a.every(x => Number.isInteger(x) && x >= 0 && x <= MAXH));
const cols = g => Math.max(1, Math.min(3, Math.floor((g.clientWidth + 16) / 300)));
function paint(g, L) {
  if (!L) { g.classList.remove('lx'); g.style.removeProperty('--lc'); for (const c of kids(g)) ['--o', '--w', '--mh'].forEach(p => c.style.removeProperty(p)); return }
  const n = cols(g); g.classList.add('lx'); g.style.setProperty('--lc', n);
  kids(g).forEach((c, i) => { c.style.setProperty('--o', L.o.indexOf(i)); c.style.setProperty('--w', Math.max(1, Math.min(L.w[i], n))); c.style.setProperty('--mh', L.h[i] ? L.h[i] * STEP + 'px' : 'auto') });
}
// the page's own look, measured, as the starting layout: DOM order, width in thirds of the grid
function measure(g) { const W = g.clientWidth, k = kids(g); return { o: k.map((_, i) => i), w: k.map(c => Math.max(1, Math.min(3, Math.round(c.getBoundingClientRect().width / W * 3)))), h: k.map(() => 0) } }

export function apply(page, view) {
  leave(); ro?.disconnect(); mo?.disconnect(); ro = mo = null; document.querySelector('.lx-btn')?.remove();
  const g = SEL[page] && view.querySelector(SEL[page]);
  if (!g) { if (SEL[page]) (mo = new MutationObserver(() => view.querySelector(SEL[page]) && apply(page, view))).observe(view, { childList: true, subtree: true }); return } // async pages render later
  const L = store.p[page]; paint(g, ok(L, kids(g).length) ? L : null);
  ro = new ResizeObserver(() => paint(g, ed?.g === g ? ed.L : ok(store.p[page], kids(g).length) ? store.p[page] : null)); ro.observe(g);
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn lx-btn'; b.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-layers"/></svg><span>Edit layout</span>'; b.setAttribute('aria-label', 'Edit layout');
  b.dataset.tip = 'Move and resize the cards on this page. Nothing moves until you choose Edit layout, and changes are kept only when you Save.';
  b.onclick = () => enter(page, view, g); (view.querySelector('.pg-h') || document.querySelector('.top-act') || g.parentElement).append(b); // no page header (Home, Automation): top bar, not floating over cards (B121)
}
function enter(page, view, g) {
  if (ed) return; const saved = ok(store.p[page], kids(g).length) ? store.p[page] : null;
  ed = { page, g, view, saved, L: structuredClone(saved || measure(g)) };
  g.classList.add('lx-edit'); paint(g, ed.L);
  kids(g).forEach((c, i) => { const t = document.createElement('div'); t.className = 'lx-t'; t.dataset.i = i;
    t.innerHTML = `<button type="button" class="lx-grip" data-a="grip" aria-label="Move card (drag, or use the arrow buttons)" data-tip="Drag to move this card">⠿</button><button type="button" data-a="prev" aria-label="Move earlier">←</button><button type="button" data-a="next" aria-label="Move later">→</button><button type="button" data-a="w-" aria-label="Narrower">W−</button><button type="button" data-a="w+" aria-label="Wider">W+</button><button type="button" data-a="h-" aria-label="Shorter">H−</button><button type="button" data-a="h+" aria-label="Taller">H+</button>`;
    const z = document.createElement('span'); z.className = 'lx-rz'; z.dataset.a = 'rz'; z.setAttribute('aria-hidden', 'true'); z.dataset.tip = 'Drag to resize (snaps to the grid)'; c.append(t, z) });
  const bar = document.createElement('div'); bar.className = 'lx-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Rearrange mode');
  bar.innerHTML = `<b>Rearranging this page</b><span class="lx-tut" aria-live="polite"></span><button type="button" class="btn" data-a="tut">Tips</button><button type="button" class="btn" data-a="reset">Reset to default</button><button type="button" class="btn" data-a="cancel">Cancel</button><button type="button" class="btn primary" data-a="save">Save &amp; Exit</button>`;
  document.body.append(bar); ed.bar = bar; bar.onclick = e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'save') save(); else if (a === 'cancel') leave(); else if (a === 'reset') reset(); else if (a === 'tut') tut(0) };
  g.addEventListener('click', act); g.addEventListener('pointerdown', drag); addEventListener('keydown', esc);
  let seen = false; try { seen = !!localStorage.getItem(KT) } catch { } if (!seen) tut(0); bar.querySelector('[data-a=save]').focus();
}
function tut(i) {
  const s = ed?.bar.querySelector('.lx-tut'); if (!s) return;
  if (i >= TUT.length) { s.innerHTML = ''; try { localStorage.setItem(KT, '1') } catch { } return }
  s.innerHTML = `${i + 1}/${TUT.length} ${TUT[i]} <button type="button" class="btn" data-t="${i + 1}">${i + 1 < TUT.length ? 'Next' : 'Finish'}</button>${i ? `<button type="button" class="btn" data-t="${i - 1}">Back</button>` : ''}<button type="button" class="btn" data-t="${TUT.length}">Skip</button>`;
  s.onclick = e => { const t = e.target.closest('[data-t]'); if (t) { e.stopPropagation(); tut(+t.dataset.t) } };
}
const esc = e => { if (e.key === 'Escape' && ed && !e.defaultPrevented) leave() };
function move(i, to) { const o = ed.L.o, p = o.indexOf(i); to = Math.max(0, Math.min(o.length - 1, to)); if (to === p) return; o.splice(p, 1); o.splice(to, 0, i); paint(ed.g, ed.L) }
function act(e) {
  const b = e.target.closest('.lx-t [data-a]'); if (!b || !ed) return; e.preventDefault(); e.stopPropagation();
  const i = +b.parentElement.dataset.i, L = ed.L, a = b.dataset.a, n = cols(ed.g);
  if (a === 'prev') move(i, L.o.indexOf(i) - 1); else if (a === 'next') move(i, L.o.indexOf(i) + 1);
  else if (a === 'w-' || a === 'w+') L.w[i] = Math.max(1, Math.min(n, Math.min(L.w[i], n) + (a === 'w+' ? 1 : -1)));
  else if (a === 'h-' || a === 'h+') L.h[i] = Math.max(0, Math.min(MAXH, L.h[i] + (a === 'h+' ? 1 : -1)));
  paint(ed.g, L); b.focus();
}
function drag(e) {
  const h = e.target.closest('.lx-grip, .lx-rz'); if (!h || !ed || e.button) return; e.preventDefault();
  const g = ed.g, c = h.closest('.lx-edit > *'), i = kids(g).indexOf(c), L = ed.L, x0 = e.clientX, y0 = e.clientY, w0 = Math.min(L.w[i], cols(g)), h0 = L.h[i], r0 = c.getBoundingClientRect();
  const colW = g.clientWidth / cols(g); let over = null; c.classList.add('lx-drag');
  const mv = ev => { if (h.dataset.a === 'rz') { L.w[i] = Math.max(1, Math.min(cols(g), w0 + Math.round((ev.clientX - x0) / colW)));
      L.h[i] = Math.max(0, Math.min(MAXH, Math.round((r0.height + ev.clientY - y0) / STEP))); paint(g, L); return } // min-height only: never smaller than its content
    const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.lx-edit > *'); over?.classList.remove('lx-drop'); over = t && t !== c ? t : null; over?.classList.add('lx-drop') };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); c.classList.remove('lx-drag'); over?.classList.remove('lx-drop');
    if (over) move(i, L.o.indexOf(kids(g).indexOf(over))) };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function persist(page, L) { const nx = structuredClone(store); if (L) nx.p[page] = L; else delete nx.p[page];
  try { localStorage.setItem(K, JSON.stringify(nx)); store = nx; return true } catch { toast('The layout could not be saved (browser storage is full or blocked). Your previous layout is unchanged.', 'err', "Couldn't save the layout"); return false } }
function save() { if (!ed) return; const { page, L } = ed; if (persist(page, L)) { ed.saved = L; leave(); toast('Layout saved for this page.') } }
function reset() { if (!ed || !confirm('Reset this page to its default layout? Your saved arrangement for this page will be removed.')) return;
  if (persist(ed.page, null)) { ed.saved = null; leave(); toast('Page layout reset to default.') } }
export function leave() {
  if (!ed) return; const { g, saved, bar } = ed; ed = null; removeEventListener('keydown', esc); g.removeEventListener('click', act); g.removeEventListener('pointerdown', drag);
  g.classList.remove('lx-edit'); g.querySelectorAll('.lx-t, .lx-rz').forEach(t => t.remove()); bar.remove(); paint(g, saved);
  document.querySelector('.lx-btn')?.focus?.();
}
