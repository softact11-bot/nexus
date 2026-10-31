// NEXUS core: WebGL2 particle network + platform, rings, grid floor, bloom.
// Runs only while Home is visible. API: active(on), slot(el), status({running, events}), fps(), resize().
import { build, band } from './geometry.js';
import * as SH from './shaders.js';

const TIERS = { low: { n: 300, bloom: 0, dpr: 1 }, medium: { n: 450, bloom: 1, dpr: 1.25 }, high: { n: 650, bloom: 1, dpr: 1.5 }, ultra: { n: 900, bloom: 1, dpr: 2 } };
const ORDER = ['low', 'medium', 'high', 'ultra'];
// RGB cycle: blue → violet → magenta → green → cyan → (blue), saturated so it never looks washed out
const KEYS = [[.12, .42, 1], [.48, .22, 1], [1, .18, .72], [.12, .95, .42], [.08, .82, 1]];
const GLASS = [[.72, .58, 1], [.55, .35, 1], [.9, .5, 1], [.56, .64, 1]]; // glass theme: lavender, violet, orchid, periwinkle (purple only, matches the glass scene)
const DEF = { tier: 'high', rgb: true, fixed: '#31D67A', cycle: 60, speed: 1, lines: 1, glow: 1 };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TILT = .13, D = 4, PLAT = -1.2, PK = .8; // PK scales the pedestal radii

const load = () => { try { return JSON.parse(localStorage.getItem('jv.core')) || {}; } catch { return {}; } };
const save = c => { try { localStorage.setItem('jv.core', JSON.stringify(c)); } catch { } };
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const sstep = t => t * t * (3 - 2 * t);
const rotY = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; };   // column-major
const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const mul = (a, b) => { const o = []; for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2]; return o; };
const apply = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];

export function createCore(cv) {
  const cfg = { ...DEF, ...load() };
  const gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });
  if (!gl) return fallback(cv);
  const green = hex(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#31D67A');

  // ---------- programs ----------
  function prog([vs, fs]) {
    const p = gl.createProgram();
    for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    for (const a of ['aP', 'aB', 'aQ']) gl.bindAttribLocation(p, 0, a);
    gl.bindAttribLocation(p, 1, 'aK');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {}; p.u = n => n in loc ? loc[n] : (loc[n] = gl.getUniformLocation(p, n));
    return p;
  }
  const P = { pts: prog(SH.POINTS), lines: prog(SH.LINES), band: prog(SH.BAND), grid: prog(SH.GRID), sprite: prog(SH.SPRITE), blur: prog(SH.BLUR), comp: prog(SH.COMP) };
  const u = (p, n, ...v) => { const l = p.u(n); if (l == null) return; v.length === 9 ? gl.uniformMatrix3fv(l, false, v) : gl['uniform' + v.length + 'f'](l, ...v); };
  const ui = (p, n, v) => gl.uniform1i(p.u(n), v);

  // ---------- geometry ----------
  function vao(data, layout) {
    const v = gl.createVertexArray(); gl.bindVertexArray(v);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = layout.reduce((s, n) => s + n, 0) * 4; let off = 0;
    layout.forEach((n, i) => { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, stride, off); off += n * 4; });
    gl.bindVertexArray(null); v.buf = b; return v;
  }
  const quad = vao(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), [2]);
  const bandV = vao(band(256), [2]), bandN = 257 * 2;
  let G, ptsV, linesV;
  function geo() {
    for (const v of [ptsV, linesV]) if (v) { gl.deleteBuffer(v.buf); gl.deleteVertexArray(v); }
    G = build(TIERS[cfg.tier].n); ptsV = vao(G.pts, [3, 3]); linesV = vao(G.lines, [4, 2]);
  }
  geo();

  // ---------- render targets ----------
  let W = 0, H = 0, dpr = 1, ms, msRB, scene, half = [], qtr = [], samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
  const tex = (w, h) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
  const fbo = t => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); f.t = t; return f; };
  function targets() {
    dpr = Math.min(devicePixelRatio || 1, TIERS[cfg.tier].dpr);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (w === W && h === H && scene) return;
    W = cv.width = w; H = cv.height = h;
    for (const f of [scene, ...half, ...qtr]) if (f) { gl.deleteTexture(f.t); gl.deleteFramebuffer(f); }
    if (ms) { gl.deleteFramebuffer(ms); gl.deleteRenderbuffer(msRB); }
    msRB = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, msRB); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, W, H);
    ms = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, ms); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msRB);
    scene = fbo(tex(W, H)); half = [fbo(tex(W >> 1, H >> 1)), fbo(tex(W >> 1, H >> 1))]; qtr = [fbo(tex(W >> 2, H >> 2)), fbo(tex(W >> 2, H >> 2))];
  }

  // ---------- live state ----------
  let on = false, slotEl = null, raf = 0, last = 0, t = 0, ang = 0, spd = .05, lineK = 1, bright = 1;
  let mood = 'idle', amp = 0, ampS = 0; // post-M7 Ph 4: assistant state (idle listening thinking speaking executing) + mic / speech level 0..1
  let running = false, pulseAt = -1e9, flashAt = -1e9, errAt = -1e9, mx = 0, my = 0, tmx = 0, tmy = 0;
  let due = 0, frames = 0, fpsNow = 0, fpsAt = 0, slowSince = 0, tierAt = 0, dts = [];
  let inputAt = 0; const live = now => document.hasFocus() && now - inputAt < 6e4; // M5b CPU: 30 fps while focused and used in the last minute, else 15
  for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => inputAt = performance.now(), { passive: true });
  addEventListener('pointermove', e => { inputAt = performance.now(); tmx = e.clientX / innerWidth * 2 - 1; tmy = e.clientY / innerHeight * 2 - 1; });

  function colors() {
    if (!cfg.rgb) { const f = hex(cfg.fixed); return [f, mix(f, [1, 1, 1], .25)]; }
    const K = document.documentElement.dataset.theme === 'glass' ? GLASS : KEYS, at = k => { const x = ((t / cfg.cycle + k) % 1 + 1) % 1 * K.length, i = Math.floor(x); return mix(K[i], K[(i + 1) % K.length], sstep(x - i)); };
    return [at(0), at(.18)];
  }

  // M5b CPU: draw at most 30 fps (15 when unfocused or idle, see live()); hidden or minimized = no frames at all
  function frame(now) {
    raf = on && !document.hidden ? requestAnimationFrame(frame) : 0;
    const step = live(now) ? 1000 / 30 : 1000 / 15; // due advances by whole steps: exactly 30 (15) fps on average at any refresh rate
    if (raf && now >= due - 2) { due = due + step > now ? due + step : now + step; draw(now); }
  }
  function draw(now) {
    const raw = (now - (last || now)) / 1000, dt = Math.min(.05, raw); last = now; t += dt;
    // fps + adaptive quality (drop one tier if frames stay slow)
    frames++; if (now - fpsAt >= 1000) { fpsNow = frames * 1000 / (now - fpsAt || 1000); frames = 0; fpsAt = now; }
    if (raw < .1 && live(now)) { dts.push(raw); if (dts.length > 120) dts.shift(); } // >100 ms gaps = throttled or hidden view, not GPU load
    const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
    if (avg > .045 && dts.length === 120 && now - tierAt > 4000 && cfg.tier !== 'low') { slowSince ||= now; if (now - slowSince > 2000) { cfg.tier = ORDER[ORDER.indexOf(cfg.tier) - 1]; tierAt = now; slowSince = 0; dts = []; geo(); W = 0; console.info('core: quality lowered to', cfg.tier); } } else slowSince = 0;

    targets();
    if (!slotEl) return;
    const cr = cv.getBoundingClientRect(), sr = slotEl.getBoundingClientRect();
    const cx = (sr.left - cr.left + sr.width / 2) * dpr, cy = (sr.top - cr.top + sr.height * .41) * dpr;
    const S = Math.min(sr.width * .33, sr.height * .38) * dpr;

    const k = Math.min(1, dt * 1.5);
    ampS += (amp - ampS) * Math.min(1, dt * 10);
    const busy = running || mood === 'executing', think = mood === 'thinking';
    if (mood === 'executing' && t - pulseAt > 1.2) pulseAt = t; // energy moving through the network while a task runs
    spd += (((think ? .12 : busy ? .09 : .05) * cfg.speed * (reduced ? .2 : 1)) - spd) * k;
    lineK += ((cfg.lines * (think ? 1.5 : busy ? 1.25 : 1)) - lineK) * k;
    bright += ((think ? 1.15 : busy ? 1.1 : mood === 'speaking' ? 1 + .25 * ampS : mood === 'listening' ? 1.05 + .2 * ampS : 1) - bright) * k;
    ang += spd * dt; mx += (tmx - mx) * k; my += (tmy - my) * k;
    const cam = mul(rotX(TILT + my * .035), rotY(mx * .05));
    const rot = mul(rotY(ang), rotX(.22 * Math.sin(t * .05)));
    const breath = 1 + (reduced ? 0 : .015 * Math.sin(t * 6.2832 / 6) + (mood === 'listening' ? .02 + .05 * ampS : mood === 'speaking' ? .03 * ampS : 0));
    const [c1, c2] = colors();
    const ringCol = mix(document.documentElement.dataset.theme === 'glass' ? GLASS[0] : green, c1, .3), flash = Math.exp(-(t - flashAt) * 2.2) * 1.3, err = Math.max(0, 1 - (t - errAt) / 1.5);
    const rc = mix(ringCol, [.95, .7, .27], err), sp = reduced ? .2 : 1;
    const lift = reduced ? 0 : .035 * Math.sin(t * 6.2832 / 7);

    gl.bindFramebuffer(gl.FRAMEBUFFER, ms); gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    const common = p => { gl.useProgram(p); u(p, 'uRes', W, H); u(p, 'uC', cx, cy); u(p, 'uS', S); u(p, 'uD', D); u(p, 'uT', t); u(p, 'uLift', lift); u(p, 'uCam', ...cam); u(p, 'uRot', ...rot); };
    const scr = v => { const c = apply(cam, v), z = c[2] + D; return [cx + c[0] * S * D / z, cy - c[1] * S * D / z]; };

    // floor: small pool of grid light around the pedestal
    const FL = PLAT - .23;
    common(P.grid); u(P.grid, 'uY', FL); u(P.grid, 'uCol', ...mix(rc, [0, 0, 0], .2)); u(P.grid, 'uA', .16);
    gl.bindVertexArray(quad); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // soft light: halo, bright centre, sphere rim, frame rings, pedestal glow, beam, floor reflection
    const [sx, sy] = scr([0, lift, 0]), [px, py] = scr([0, PLAT, 0]), [fx, fy] = scr([0, FL, 0]), R = S * breath * 1.033;
    gl.useProgram(P.sprite); u(P.sprite, 'uRes', W, H);
    const spr = (x, y, w, h, col, a, shape = 0, ex = {}) => {
      u(P.sprite, 'uPos', x, y); u(P.sprite, 'uSize', w, h); u(P.sprite, 'uCol', ...col); u(P.sprite, 'uA', a); ui(P.sprite, 'uShape', shape);
      u(P.sprite, 'uR', ex.r ?? 1); u(P.sprite, 'uW', ex.w ?? .1); u(P.sprite, 'uN', ex.n ?? 0); u(P.sprite, 'uFill', ex.fill ?? 1); u(P.sprite, 'uSpin', ex.spin ?? 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const arcs = (rad, lw, n, fill, spin, a, col) => { const z = R * rad * 1.08; spr(sx, sy, z, z, col, a * cfg.glow, 2, { r: 1 / 1.08, w: lw * dpr / z, n, fill, spin }); };
    spr(sx, sy, R * 2, R * 2, c1, .09 * cfg.glow);
    spr(sx, sy, R * .55, R * .55, mix(c1, [1, 1, 1], .35), .22 * cfg.glow);
    spr(sx, sy, R * 1.2, R * 1.2, mix(c1, c2, .5), .5 * cfg.glow, 3, { r: 1 / 1.2, w: 5 * dpr / (R * 1.2) });
    arcs(1.1, 1.2, 0, 1, 0, .35, mix(c1, [1, 1, 1], .2));
    arcs(1.16, 1.6, 3, .27, t * .02 * sp, .55, c2);
    arcs(1.16, 1, 3, .27, t * .02 * sp + .16, .25, c1);
    arcs(1.23, 1, 64, .5, -t * .006 * sp, .3, c1);
    spr(px, py, S * .95, S * .16, rc, .2 * cfg.glow);
    spr(px, (py + sy) / 2 + S * .25, S * .55, (py - sy) / 2 + S * .1, mix(rc, [1, 1, 1], .2), .05 * cfg.glow, 1);
    spr(fx, fy + (fy - sy) * .12, R * .9, R * .18, c1, .07 * cfg.glow);

    // pedestal: three stepped tiers (top disc, walls with light slits, bright lips) + floor rings
    common(P.band); gl.bindVertexArray(bandV);
    const ring = (r0, r1, y, spin, type, n, a, col = rc) => { u(P.band, 'uR0', r0 * PK); u(P.band, 'uR1', r1 * PK); u(P.band, 'uY', y); u(P.band, 'uH', 0); u(P.band, 'uSpin', spin); ui(P.band, 'uType', type); u(P.band, 'uN', n); u(P.band, 'uA', a); u(P.band, 'uCol', ...col); gl.drawArrays(gl.TRIANGLE_STRIP, 0, bandN); };
    const wall = (r, y, h, n, a) => { u(P.band, 'uR0', r * PK); u(P.band, 'uY', y); u(P.band, 'uH', h); u(P.band, 'uSpin', 0); ui(P.band, 'uType', 4); u(P.band, 'uN', n); u(P.band, 'uA', a); u(P.band, 'uCol', ...rc); gl.drawArrays(gl.TRIANGLE_STRIP, 0, bandN); };
    ring(0, .6, PLAT, 0, 3, 0, .55);
    ring(.585, .615, PLAT, 0, 0, 0, .9 + flash);
    ring(.42, .44, PLAT + .004, -t * .2 * sp, 1, 30, .4);
    wall(.62, PLAT - .07, .07, 72, .45);
    ring(.62, .92, PLAT - .07, 0, 3, 0, .22);
    ring(.75, .79, PLAT - .07, t * .05 * sp, 2, 72, .6);
    ring(.905, .93, PLAT - .07, 0, 0, 0, .7 + flash * .6);
    wall(.935, PLAT - .15, .08, 108, .3);
    ring(1.04, 1.08, PLAT - .15, t * .1 * sp, 1, 40, .5);
    ring(1.215, 1.24, PLAT - .15, 0, 0, 0, .5 + flash * .4);
    wall(1.245, FL, .08, 144, .18);
    ring(1.36, 1.42, FL, -t * .04 * sp, 2, 180, .3);
    ring(1.25, 1.75, FL, 0, 0, 0, .07 + flash * .15);
    ring(1.6, 1.615, FL, 0, 0, 0, .3);
    ring(1.76, 1.78, FL, t * .03 * sp, 1, 6, .35);

    // network: lines then points
    common(P.lines); u(P.lines, 'uBreath', breath); u(P.lines, 'uLine', 1.05 * lineK); u(P.lines, 'uCol1', ...c1); u(P.lines, 'uCol2', ...c2);
    gl.bindVertexArray(linesV); gl.drawArrays(gl.LINES, 0, G.nLineV);
    common(P.pts); u(P.pts, 'uBreath', breath); u(P.pts, 'uPulse', t - pulseAt); u(P.pts, 'uSizeK', S / (170 * dpr)); u(P.pts, 'uBright', bright); u(P.pts, 'uDpr', dpr); u(P.pts, 'uCol1', ...c1); u(P.pts, 'uCol2', ...c2);
    gl.bindVertexArray(ptsV); gl.drawArrays(gl.POINTS, 0, G.nPts);

    // resolve MSAA → scene, bloom at half res, composite to screen
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scene);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindVertexArray(quad);
    const bloom = TIERS[cfg.tier].bloom;
    if (bloom) {
      gl.useProgram(P.blur); gl.viewport(0, 0, W >> 1, H >> 1); gl.activeTexture(gl.TEXTURE0); ui(P.blur, 'uTex', 0);
      const pass = (src, dst, dx, dy) => { gl.bindFramebuffer(gl.FRAMEBUFFER, dst); gl.bindTexture(gl.TEXTURE_2D, src); u(P.blur, 'uDir', dx / (W >> 1), dy / (H >> 1)); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
      pass(scene.t, half[0], 1, 0); pass(half[0].t, half[1], 0, 1);                   // tight glow, half res
      gl.viewport(0, 0, W >> 2, H >> 2);
      const qpass = (src, dst, dx, dy) => { gl.bindFramebuffer(gl.FRAMEBUFFER, dst); gl.bindTexture(gl.TEXTURE_2D, src); u(P.blur, 'uDir', dx / (W >> 2), dy / (H >> 2)); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
      qpass(half[1].t, qtr[0], 1, 0); qpass(qtr[0].t, qtr[1], 0, 1);                     // wide glow, quarter res
      qpass(qtr[1].t, qtr[0], 2.5, 0); qpass(qtr[0].t, qtr[1], 0, 2.5);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    gl.useProgram(P.comp);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene.t); ui(P.comp, 'uScene', 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, half[1].t); ui(P.comp, 'uBloom', 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, qtr[1].t); ui(P.comp, 'uBloom2', 2);
    u(P.comp, 'uBloomK', .9 * cfg.glow); u(P.comp, 'uBloomOn', bloom);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
  }

  const kick = () => { if (on && !raf && !document.hidden) { last = 0; fpsAt = performance.now(); frames = 0; raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', kick);
  tuner(cfg, change => { Object.assign(cfg, change); save(cfg); if ('tier' in change) { geo(); W = 0; } });

  return {
    active(v) { on = v; if (v) kick(); else { cancelAnimationFrame(raf); raf = 0; fpsNow = 0; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); } },
    slot(el) { slotEl = el; },
    // post-M7 Ph 4: assistant/voice state. success = one confirmation flash, error = the existing amber warning; level = mic or speech 0..1
    mood(m, level) { if (m === 'success') { flashAt = t; m = 'idle'; } else if (m === 'error') { errAt = t; m = 'idle'; } if (m) mood = m; if (level != null) amp = Math.max(0, Math.min(1, +level || 0)); },
    status({ running: r, events = [] }) {
      running = r;
      if (events.includes('data-update')) pulseAt = t;
      if (events.includes('sync-done') || events.includes('recovered')) flashAt = t;
      if (events.includes('error')) errAt = t;
    },
    fps: () => raf ? fpsNow : 0,
    resize() { W = 0; },
    tier: () => cfg.tier,
    // Diagnostics: render n frames back to back and wait for the GPU each time → real ms per frame.
    bench(n = 60) { const px = new Uint8Array(4), t0 = performance.now(); for (let i = 0; i < n; i++) { draw(t0 + i * 16.7); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return { msPerFrame: +((performance.now() - t0) / n).toFixed(2), w: W, h: H, tier: cfg.tier, points: G.nPts, lineSegs: G.nLineV / 2 }; },
  };
}

// Preview-only tuning panel (backquote key). Real controls move to Settings later.
function tuner(cfg, set) {
  let el;
  addEventListener('keydown', e => {
    if (e.code !== 'Backquote' || e.target.matches?.('input, textarea')) return;
    if (!el) {
      el = document.createElement('div'); el.className = 'tune';
      const row = (k, lbl, min, max, step) => `<label>${lbl}<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${cfg[k]}"><output>${cfg[k]}</output></label>`;
      el.innerHTML = `<h3>Core (preview tuning)</h3>
        <label>RGB cycle<input type="checkbox" data-k="rgb" ${cfg.rgb ? 'checked' : ''}><output></output></label>
        <label>Fixed color<input type="color" data-k="fixed" value="${cfg.fixed}"><output></output></label>
        ${row('cycle', 'Cycle (s)', 15, 180, 5)}${row('speed', 'Rotation', 0, 3, .1)}${row('lines', 'Lines', 0, 2.5, .1)}${row('glow', 'Glow', 0, 2, .1)}
        <label>Quality<select data-k="tier">${ORDER.map(q => `<option ${q === cfg.tier ? 'selected' : ''}>${q}</option>`).join('')}</select><output></output></label>`;
      el.addEventListener('input', e => {
        const i = e.target, k = i.dataset.k; if (!k) return;
        const v = i.type === 'checkbox' ? i.checked : i.type === 'range' ? +i.value : i.value;
        if (i.type === 'range') i.nextElementSibling.textContent = v;
        set({ [k]: v });
      });
      document.body.append(el);
    }
    el.classList.toggle('open');
  });
}

// No WebGL2: a simple 2D version so Home still has a core.
function fallback(cv) {
  const g = cv.getContext('2d'), pts = build(500, 0).pts; let on = false, slotEl = null, a = 0, raf = 0;
  const draw = () => {
    raf = on ? requestAnimationFrame(draw) : 0; if (!slotEl) return;
    const d = Math.min(devicePixelRatio || 1, 1.5); cv.width = cv.clientWidth * d; cv.height = cv.clientHeight * d;
    const cr = cv.getBoundingClientRect(), sr = slotEl.getBoundingClientRect(), cx = (sr.left - cr.left + sr.width / 2) * d, cy = (sr.top - cr.top + sr.height * .41) * d, S = Math.min(sr.width * .3, sr.height * .37) * d;
    a += .004; const c = Math.cos(a), s = Math.sin(a); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < pts.length; i += 6) { const x = pts[i] * c + pts[i + 2] * s, z = -pts[i] * s + pts[i + 2] * c; g.fillStyle = `rgba(49,214,122,${.25 + .5 * (1 - (z + 1) / 2)})`; g.fillRect(cx + x * S, cy - pts[i + 1] * S, 2 * d, 2 * d); }
  };
  return { active(v) { on = v; if (v && !raf) raf = requestAnimationFrame(draw); }, slot(el) { slotEl = el; }, mood() { }, status() { }, fps: () => 0, resize() { }, tier: () => '2d' };
}
