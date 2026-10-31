// L6 React Bits ports for NEXUS (vanilla, no dependencies). Spring Check, Rubber Segment, Lattice Loader and Branched Menu follow the
// React Bits micro components (motion springs replaced by a small spring integrator); Pattern Waves and Micro Slats are light one-pass
// WebGL shaders inspired by the React Bits backgrounds (no ogl, no fluid sim), capped at 30 fps and paused when hidden or off-screen.
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeOut = p => 1 - Math.pow(1 - p, 5);
const h = (tag, cls, attrs = {}) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const k in attrs) e.setAttribute(k, attrs[k]); return e };

// one animated number: spring (duration s, bounce 0-1) or tween; on(v) paints
class MV {
  constructor(v, on) { this.v = v; this.vel = 0; this.on = on; this.raf = 0; this.done = null }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; const d = this.done; this.done = null; d?.(false) }
  jump(v) { this.stop(); this.v = v; this.vel = 0; this.on(v) }
  run(step) { return new Promise(res => { this.done = res; let last = performance.now();
    const tick = now => { const dt = Math.min(0.064, (now - last) / 1000); last = now;
      if (step(dt, now)) { this.raf = 0; this.done = null; this.on(this.v); res(true) } else { this.on(this.v); this.raf = requestAnimationFrame(tick) } };
    this.raf = requestAnimationFrame(tick) }) }
  spring(to, { duration = 0.3, bounce = 0, velocity, rest = 0.01 } = {}) {
    this.stop(); if (velocity != null) this.vel = velocity; const w = 2 * Math.PI / duration, k = w * w, c = 2 * (1 - bounce) * w;
    return this.run(dt => { const n = Math.max(1, Math.ceil(dt * 240)), s = dt / n;
      for (let i = 0; i < n; i++) { this.vel += (-k * (this.v - to) - c * this.vel) * s; this.v += this.vel * s }
      if (Math.abs(this.v - to) < rest && Math.abs(this.vel) < rest * 20) { this.v = to; this.vel = 0; return true } }) }
  tween(to, duration, ease = easeOut) {
    this.stop(); const from = this.v, t0 = performance.now();
    return this.run((dt, now) => { const p = Math.min(1, (now - t0) / (duration * 1000)), v = from + (to - from) * ease(p); this.vel = dt ? (v - this.v) / dt : 0; this.v = v; return p >= 1 }) }
}

// ---- Spring Check: one spring fills the box, draws the tick and strikes through the label
export function springCheck(el, { label, checked = false, onChange, doneOpacity = 0.42, strikeLag = 0.12 } = {}) {
  const b = h('button', 'sc', { type: 'button', role: 'checkbox', 'aria-checked': checked });
  b.innerHTML = '<span class="sc-press"><span class="sc-box"><span class="sc-ring"></span><span class="sc-fill"></span><svg class="sc-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1" stroke-dasharray="1"/></svg></span></span><span class="sc-label"><span class="sc-word"></span><span class="sc-rule" aria-hidden="true"></span></span>';
  b.querySelector('.sc-word').textContent = label; el.append(b);
  const [box, fill, tick, word, rule] = ['.sc-box', '.sc-fill', '.sc-tick path', '.sc-word', '.sc-rule'].map(s => b.querySelector(s));
  const t = new MV(checked ? 1 : 0, v => { const held = clamp(v, 0, 1);
    fill.style.transform = `scale(${Math.max(v, 0)})`; box.style.transform = `scale(${1 + 0.35 * Math.max(0, v - 1)})`;
    tick.style.strokeDashoffset = 1 - held; word.style.opacity = 1 - (1 - doneOpacity) * held;
    rule.style.transform = `scaleX(${clamp((held - strikeLag) / (0.84 - strikeLag), 0, 1)})` });
  t.jump(t.v); let on = checked, ptr = false;
  b.onpointerdown = e => { if (e.button === 0) { ptr = true; if (!reduce()) b.dataset.pressed = '' } };
  b.onpointerup = b.onpointerleave = b.onpointercancel = () => delete b.dataset.pressed;
  b.onclick = () => { on = !on; b.setAttribute('aria-checked', on);
    if (reduce() || !ptr) t.jump(on ? 1 : 0); else t.spring(on ? 1 : 0, { duration: 0.32, bounce: 0.54, rest: 0.002 });
    ptr = false; onChange?.(on) };
  return { get checked() { return on } };
}

// ---- Rubber Segment: thumb stretches over both slots, then springs into place (squash on landing); drag + flick the thumb
export function rubberSegment(el, { items, value = items[0], onChange, label = 'Segmented control', inset = 3, radius = 10 } = {}) {
  const root = h('div', 'rs', { role: 'radiogroup', 'aria-label': label }); root.style.setProperty('--rs-inset', inset + 'px'); root.style.setProperty('--rs-r', radius + 'px');
  const track = h('div', 'rs-track'), over = h('div', 'rs-over', { 'aria-hidden': 'true' });
  const btns = items.map(v => { const b = h('button', 'rs-i', { type: 'button', role: 'radio' }); b.textContent = v; track.append(b); const o = h('span', 'rs-i'); o.textContent = v; over.append(o); return b });
  root.append(track, over); el.append(root);
  let idx = Math.max(0, items.indexOf(value)), slots = [], W = 0, gen = 0, hand = 0, drag = null;
  const paint = () => { over.style.clipPath = `inset(${inset}px ${Math.max(0, W - R.v) + inset}px ${inset}px ${Math.max(0, L.v) + inset}px round ${Math.max(0, radius - inset)}px)` };
  const L = new MV(0, paint), R = new MV(0, paint);
  const sel = i => btns.forEach((b, j) => { b.setAttribute('aria-checked', i === j); b.tabIndex = i === j ? 0 : -1 });
  const measure = () => { const r = root.getBoundingClientRect(); W = r.width - inset * 2;
    slots = btns.map(b => { const q = b.getBoundingClientRect(); return { l: q.left - r.left - inset, r: q.right - r.left - inset } }); if (!drag) { L.jump(slots[idx].l); R.jump(slots[idx].r) } };
  new ResizeObserver(measure).observe(root); document.fonts?.ready.then(measure);
  const land = (to, v, flick, squash) => { const b = slots[to], g = ++gen, dir = Math.sign((b.l + b.r) / 2 - (L.v + R.v) / 2) || 1;
    const [lead, lt, trail, tt] = dir > 0 ? [R, b.r, L, b.l] : [L, b.l, R, b.r], vel = mv => clamp(v ?? mv.vel, -2000, 2000);
    lead.spring(lt, { duration: flick ? 0.4 : 0.3, bounce: flick ? 0.2 : 0, velocity: vel(lead), rest: 0.3 });
    if (!squash) { trail.spring(tt, { duration: 0.3, velocity: vel(trail), rest: 0.3 }); return }
    trail.spring(tt + dir * 3, { duration: 0.3, velocity: vel(trail), rest: 0.3 }).then(ok => { if (ok && g === gen) trail.spring(tt, { duration: 0.16, rest: 0.3 }) }) };
  const travel = (from, to) => { const a = slots[from], b = slots[to]; clearTimeout(hand); gen++;
    if (reduce()) { L.jump(b.l); R.jump(b.r); return }
    L.tween(Math.min(a.l, b.l), 0.19); R.tween(Math.max(a.r, b.r), 0.19); hand = setTimeout(() => land(to, null, false, true), 150) };
  const commit = (i, anim = true) => { if (i === idx) return; const from = idx; idx = i; sel(i); if (anim) travel(from, i); onChange?.(items[i], i) };
  const lx = e => e.clientX - root.getBoundingClientRect().left - inset;
  btns.forEach((b, i) => {
    b.onclick = () => { if (drag?.moved) return; commit(i) };
    b.onkeydown = e => { const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return; e.preventDefault(); const n = (idx + d + items.length) % items.length; commit(n); btns[n].focus() };
  });
  root.onpointerdown = e => { const x = lx(e); if (e.button !== 0 || x < L.v || x > R.v) return; root.setPointerCapture(e.pointerId); clearTimeout(hand); gen++; L.stop(); R.stop();
    drag = { x0: x, off: x - L.v, w: R.v - L.v, hist: [[e.timeStamp, x]], moved: false } };
  root.onpointermove = e => { if (!drag) return; const x = lx(e); drag.hist.push([e.timeStamp, x]); if (drag.hist.length > 8) drag.hist.shift();
    if (!drag.moved) { if (Math.abs(x - drag.x0) < 4) return; drag.moved = true; root.dataset.held = '' }
    let l = x - drag.off; const max = W - drag.w, rub = o => o * drag.w * 0.55 / (drag.w + 0.55 * Math.abs(o));
    if (l < 0) { L.jump(0); R.jump(Math.max(8, drag.w + rub(l))) } else if (l > max) { R.jump(W); L.jump(Math.min(W - 8, max + rub(l - max))) } else { L.jump(l); R.jump(l + drag.w) } };
  root.onpointerup = root.onpointercancel = e => { const d = drag; if (!d) return; delete root.dataset.held;
    if (!d.moved) { drag = null; return } // plain click on the thumb: handled by its button
    const rec = d.hist.filter(([t]) => e.timeStamp - t <= 100), v = rec.length > 1 ? (rec.at(-1)[1] - rec[0][1]) / Math.max(8, rec.at(-1)[0] - rec[0][0]) * 1000 : 0;
    const proj = (L.v + R.v) / 2 + v * 0.12; let best = 0; slots.forEach((s, i) => { if (Math.abs((s.l + s.r) / 2 - proj) < Math.abs((slots[best].l + slots[best].r) / 2 - proj)) best = i });
    const prev = idx; idx = best; sel(best); land(best, v, Math.abs(v) > 110, false); if (best !== prev) onChange?.(items[best], best); setTimeout(() => drag = null) };
  sel(idx);
  return { set: v => commit(Math.max(0, items.indexOf(v))) };
}

// ---- Lattice Loader: agent status row, cells brighten in a wave beside a live stopwatch; done / error marks
const PAT = { orbit: { n: 3, cells: [0, 1, 2, 7, null, 3, 6, 5, 4], loop: 8, scale: 1.2 }, sweep: { n: 4, cells: [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6], loop: 5, scale: 1 },
  pulse: { n: 4, cells: [2, 1, 1, 2, 1, 0, 0, 1, 1, 0, 0, 1, 2, 1, 1, 2], loop: 2.4, scale: 2.5 } };
const MARK = { 3: { done: [2, 3, 5, 7], error: [0, 2, 4, 6, 8] }, 4: { done: [7, 8, 10, 13], error: [0, 3, 5, 6, 9, 10, 12, 15] } };
const fmt = ds => ds < 600 ? `${(ds / 10).toFixed(1)}s` : `${Math.floor(ds / 600)}m ${((ds % 600) / 10).toFixed(1)}s`;
export function latticeLoader(el, { label = 'Thinking', doneLabel = 'Done in', errorLabel = 'Failed after', pattern = 'orbit', step = 90 } = {}) {
  const p = PAT[pattern], d = step * p.scale, root = h('span', 'll', { role: 'status' }), run = h('span', 'll-layer ll-run'), mark = h('span', 'll-layer ll-mark');
  root.style.setProperty('--ll-n', p.n); root.style.setProperty('--ll-cycle', Math.round(p.loop * d) + 'ms');
  p.cells.forEach(u => { const c = h('span', 'll-cell'); if (u == null) c.dataset.hole = ''; else c.style.animationDelay = Math.round(u * d) + 'ms'; run.append(c); mark.append(h('span', 'll-cell')) });
  const grid = h('span', 'll-grid', { 'aria-hidden': 'true' }), txt = h('span', 'll-label'), timer = h('span', 'll-timer', { 'aria-hidden': 'true' });
  grid.append(run, mark); root.append(grid, txt, timer); el.append(root);
  let iv = 0, t0 = 0;
  const set = (status, text) => { root.dataset.status = status; clearInterval(iv);
    txt.textContent = text ?? (status === 'working' ? label : status === 'done' ? doneLabel : errorLabel);
    [...mark.children].forEach((c, i) => c.toggleAttribute('data-on', status !== 'working' && MARK[p.n][status].includes(i)));
    if (status === 'working') { t0 = performance.now(); timer.textContent = '0.0s'; iv = setInterval(() => timer.textContent = fmt(Math.floor((performance.now() - t0) / 100)), 100) } };
  set('working'); return { set };
}

// ---- Branched Menu: collapsible sections branch from a trunk; a line traces from the top of the trunk to the pick
export function branchedMenu(el, { sections, value, onChange } = {}) {
  const nav = h('nav', 'bm'); let cur = null;
  const pick = (item, sec) => { if (cur === item) return; nav.querySelectorAll('.bm-i[aria-current]').forEach(i => i.removeAttribute('aria-current'));
    nav.querySelectorAll('.bm-sec').forEach(s => { if (s !== sec) s.style.setProperty('--bm-trace', 0) });
    item.setAttribute('aria-current', 'true'); cur = item; trace(sec); onChange?.(item.textContent) };
  const trace = sec => { const inner = sec.querySelector('.bm-inner'), it = inner.querySelector('.bm-i[aria-current]'), items = inner.querySelectorAll('.bm-i');
    const last = items[items.length - 1], y = el => el.offsetTop + el.offsetHeight / 2;
    inner.style.setProperty('--bm-trunk', y(last) + 'px'); sec.style.setProperty('--bm-trace', it ? y(it) / y(last) : 0) };
  for (const s of sections) {
    const sec = h('div', 'bm-sec'), head = h('button', 'bm-head', { type: 'button', 'aria-expanded': s.open !== false }), body = h('div', 'bm-body'), inner = h('div', 'bm-inner');
    head.innerHTML = '<span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'; head.firstChild.textContent = s.title;
    inner.append(h('span', 'bm-trunk'), h('span', 'bm-trace'));
    for (const t of s.items) { const b = h('button', 'bm-i', { type: 'button' }); b.textContent = t; b.prepend(h('span', 'bm-elbow')); b.onclick = () => pick(b, sec); inner.append(b); if (t === value) cur = b }
    if (s.open !== false) sec.dataset.open = '';
    head.onclick = () => { const o = sec.toggleAttribute('data-open'); head.setAttribute('aria-expanded', o) };
    body.append(inner); sec.append(head, body); nav.append(sec);
  }
  el.append(nav); if (cur) { cur.setAttribute('aria-current', 'true'); trace(cur.closest('.bm-sec')) } else nav.querySelectorAll('.bm-sec').forEach(trace);
  new ResizeObserver(() => nav.querySelectorAll('.bm-sec').forEach(trace)).observe(nav);
}

// ---- shared WebGL background runner: one full-screen triangle, DPR <= 1.25, 30 fps cap, paused when hidden / off-screen, one still frame on reduced motion
function glBackground(canvas, frag, color, still, hook) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true }); if (!gl) return { stop() {} };
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}')); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision mediump float;uniform vec2 R;uniform float T;uniform vec3 C;' + frag));
  gl.linkProgram(pr); gl.useProgram(pr); gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const uR = gl.getUniformLocation(pr, 'R'), uT = gl.getUniformLocation(pr, 'T'); gl.uniform3fv(gl.getUniformLocation(pr, 'C'), color); const per = hook?.(gl, pr);
  let raf = 0, last = 0, vis = true, t = 0, prev = 0;
  const size = () => { const k = Math.min(devicePixelRatio || 1, 1.25), w = Math.round(canvas.clientWidth * k), hh = Math.round(canvas.clientHeight * k);
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; gl.viewport(0, 0, w, hh) } gl.uniform2f(uR, w, hh) };
  const draw = () => { size(); gl.uniform1f(uT, t); per?.(); gl.drawArrays(gl.TRIANGLES, 0, 3) };
  const loop = now => { raf = requestAnimationFrame(loop); if (now - last < 32) return; t += Math.min(0.1, (now - (prev || now)) / 1000); prev = now; last = now; draw() };
  const go = () => { cancelAnimationFrame(raf); raf = 0; prev = 0; if (reduce() || still) { t = 4; draw() } else if (vis && !document.hidden) raf = requestAnimationFrame(loop) };
  const io = new IntersectionObserver(([e]) => { vis = e.isIntersecting; go() }); io.observe(canvas);
  const ro = new ResizeObserver(() => { if (!raf) draw() }); ro.observe(canvas); document.addEventListener('visibilitychange', go); go();
  return { stop() { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', go) } };
}
const green = [0.192, 0.839, 0.478];

// Pattern Waves: lit halftone dots over a draped-silk height field
export const patternWaves = (canvas, { cell = 9, color = green } = {}) => glBackground(canvas, `
float H(vec2 p){return sin(p.x*.011+T*.55)*.7+sin((p.x*.6+p.y)*.008-T*.42)*.9+sin((p.y*.8-p.x*.35)*.014+T*.8)*.35;}
void main(){float G=${cell.toFixed(1)};vec2 px=gl_FragCoord.xy,c=floor(px/G)*G+G*.5;
float hx=H(c+vec2(2.,0.))-H(c-vec2(2.,0.)),hy=H(c+vec2(0.,2.))-H(c-vec2(0.,2.));vec3 n=normalize(vec3(-hx*9.,-hy*9.,1.)),L=normalize(vec3(-.55,.55,.62));
float lit=pow(clamp(dot(n,L),0.,1.),3.),sp=pow(max(0.,reflect(-L,n).z),26.),b=clamp(lit*.85+sp*.7,0.,1.);vec2 uv=px/R;b*=smoothstep(1.05,.25,length((uv-.5)*vec2(1.,.8))*1.35);
float r=G*.48*sqrt(b),a=smoothstep(r+.7,r-.7,length(px-c));gl_FragColor=vec4(C*(.3+.7*b)*a,a*(.25+.75*b));}`, color);

// Micro Slats (React Bits port): a flat grid of 10x25 pills, lit by a rolling-sea height field in perspective; the cursor leaves a glowing trail (8-point decaying trail stands in for the original fluid sim)
export const microSlats = (canvas, { color = green, still, interactive = true } = {}) => {
  const P = new Float32Array(24); let head = 0, mx = -1e4, my = 0;
  const move = e => { const r = canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top };
  if (interactive) addEventListener('pointermove', move, { passive: true });
  const r = glBackground(canvas, `uniform float K;uniform vec3 P[8];
float wv(vec2 w,float a,float L,float A,float s,float m,float t){vec2 h=vec2(cos(a),sin(a));float k=6.2831853/L,th=k*dot(w,h)-sqrt(9.81*k)*.35*t+s+m;return A*(cos(th)+.2475*cos(2.*th));}
float pill(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
void main(){vec2 S=R/K,p=vec2(gl_FragCoord.x,R.y-gl_FragCoord.y)/K,pitch=vec2(13.,28.),c=floor(p/pitch)*pitch+pitch*.5;
float v=clamp(c.y/S.y,0.,1.),hz=4.025,dep=(1.+hz)/(v+hz),t=T*.6,D=4.3633;vec2 w=vec2((c.x-S.x*.5)/S.y*dep,(dep-1.)*hz*2.2)/1.5;
float m=.55*sin(dot(w,vec2(.23,.41))*.9+t*.13)+.3*sin(dot(w,vec2(-.37,.19))*1.4-t*.09);
float h=wv(w,D,2.6,1.,0.,m*.6,t)+wv(w,D-.95,1.7,.75,2.3,m*.9,t)+wv(w,D+.78,1.12,.5,4.1,m*1.2,t)+wv(w,D+1.62,.76,.3,1.1,m*1.5,t);
float lv=clamp(.5+.5*h/2.704,0.,1.),cr=smoothstep(.6,1.,lv),gl=cr*cr*.7,ink=0.;
for(int i=0;i<8;i++){vec2 d=c-P[i].xy;ink+=P[i].z*exp(-dot(d,d)/1600.);}
float glow=1.-exp(-ink*1.6),li=(pow(lv,1.25)+gl*.8)*mix(1.,.45,pow(1.-v,1.4));li=max(1.-(1.-clamp(li,0.,1.))*(1.-glow),.045);
vec2 hb=vec2(5.,12.5);float a=clamp(.5-pill(p-c,hb,3.75)*K,0.,1.)*li,tn=clamp(max(gl*1.4,glow*.9),0.,1.);
gl_FragColor=vec4(mix(C,vec3(1.),tn)*a,a);}`, color, still && !interactive, (gl, pr) => {
    const uK = gl.getUniformLocation(pr, 'K'), uP = gl.getUniformLocation(pr, 'P');
    return () => { for (let i = 2; i < 24; i += 3) P[i] *= .9; if (mx > -1e4 && (Math.abs(P[head * 3] - mx) > 2 || Math.abs(P[head * 3 + 1] - my) > 2)) { head = (head + 1) % 8; P.set([mx, my, 1], head * 3) }
      gl.uniform1f(uK, canvas.width / Math.max(1, canvas.clientWidth)); gl.uniform3fv(uP, P) } });
  return { stop() { r.stop(); removeEventListener('pointermove', move) } };
};

// Sliced Waves: stacked wave slices, back to front, each with a lit crest edge
export const slicedWaves = (canvas, { slices = 14, color = green } = {}) => glBackground(canvas, `
void main(){vec2 uv=gl_FragCoord.xy/R;float x=uv.x*R.x/R.y,a=0.,e=0.;vec3 col=vec3(0.);
for(int j=0;j<${slices};j++){float i=float(${slices - 1}-j),k=i/${(slices - 1).toFixed(1)};
float f=.08+k*.9+.05*sin(x*(2.2+k*1.3)+T*(.5+k*.25)+i*.7)+.025*sin(x*5.1-T*.9+i*1.9);
float m=smoothstep(f+.002,f-.002,uv.y);if(m>0.){float d=f-uv.y;e=exp(-d*140.)*(1.-k*.6);
col=C*(.08+.22*(1.-k))+C*smoothstep(.12,0.,d)*.18+mix(C,vec3(1.),.6)*e*.6;a=(.55+.45*(1.-k))*mix(1.,.0,k*.15);}}
a*=smoothstep(0.,.08,uv.x)*smoothstep(1.,.92,uv.x);gl_FragColor=vec4(col*a,a);}`, color);
