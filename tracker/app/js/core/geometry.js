// Core geometry, built once per quality tier with a fixed seed (same shape every load).
// Points: [x, y, z, size, kind, rnd]  kind 0 = node, 1 = inner core, 2 = outer dust, 3 = trace particle.
// Lines:  [x, y, z, alpha, s, rnd] per vertex, s = position along its arc (0..1) for travelling signals.
const rng = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
// point on the great-circle arc a→b at t, at radius rad
const slerp = (a, b, t, rad) => norm(a.map((x, i) => x + (b[i] - x) * t)).map(x => x * rad);

export function build(M, dust = 160, seed = 11) {
  const r = rng(seed), gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(6.2832 * r());
  const P = [], L = [];
  const dir = () => norm([gauss(), gauss(), gauss()]);

  // one shell: jittered Fibonacci nodes linked to their nearest neighbours along the surface
  function shell(n, rad, k, alpha, seg, traces, hubs) {
    const N = [], jit = 1.1 / Math.sqrt(n);
    for (let i = 0; i < n; i++) {
      const y = 1 - (i + .5) / n * 2, rr = Math.sqrt(1 - y * y), a = i * 2.39996;
      N.push(norm([Math.cos(a) * rr + gauss() * jit, y + gauss() * jit, Math.sin(a) * rr + gauss() * jit]));
    }
    for (const d of N) { const hot = r() < hubs; P.push([d[0] * rad, d[1] * rad, d[2] * rad, hot ? 3.4 + r() * 2 : 1.3 + r() * 1.1, 0, r()]); }
    const seen = new Set();
    N.forEach((a, i) => {
      const near = [];
      N.forEach((b, j) => { if (j !== i) { const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; if (d < 40 / n) near.push([d, j]); } });
      near.sort((x, y) => x[0] - y[0]);
      near.slice(0, k + (r() < .3 ? 1 : 0)).forEach(([d, j]) => {
        const key = i < j ? i * 1e5 + j : j * 1e5 + i; if (seen.has(key)) return; seen.add(key);
        if (r() < .12) return; // gaps open the web into cells
        arc(a, N[j], rad, alpha * (.55 + .45 * r()), seg, traces);
      });
    });
    return N;
  }
  function arc(a, b, rad, al, seg, traces) {
    const rnd = r();
    for (let s = 0; s < seg; s++) {
      const p = slerp(a, b, s / seg, rad), q = slerp(a, b, (s + 1) / seg, rad);
      L.push(...p, al, s / seg, rnd, ...q, al, (s + 1) / seg, rnd);
    }
    for (let i = 0; i < traces; i++) { const p = slerp(a, b, r(), rad * (1 + gauss() * .006)); P.push([...p, .55 + r() * .6, 3, r()]); }
  }

  const outer = shell(M, 1, 3, 1, 5, 3, .1);
  shell(Math.round(M * .4), .74, 2, .45, 4, 1, .06);
  // long sweeping arcs over the surface (the curves in the reference)
  for (let i = 0; i < M / 14; i++) { const a = outer[Math.floor(r() * M)], b = norm(a.map(x => x + gauss() * .9)); arc(a, b, 1.005, .35, 18, 6); }
  // dense bright centre + faint radial filaments to the shell
  for (let i = 0; i < M * .7; i++) { const d = dir(), rad = Math.abs(gauss()) * .2; P.push([d[0] * rad, d[1] * rad, d[2] * rad, .8 + r() * 1.6, 1, r()]); }
  for (let i = 0; i < M / 12; i++) { const a = outer[Math.floor(r() * M)], q = a.map(x => x * .08); L.push(...q, .1, 1, r(), ...a, .22, 0, r()); }
  // fine surface glitter + loose dust around the core
  for (let i = 0; i < M * 1.6; i++) { const d = dir(), rad = .985 + r() * .03; P.push([d[0] * rad, d[1] * rad, d[2] * rad, .45 + r() * .5, 3, r()]); }
  for (let i = 0; i < dust; i++) { const d = dir(), rad = 1.3 + r() * 2; P.push([d[0] * rad, d[1] * rad * .6, d[2] * rad, .7 + r() * .8, 2, r()]); }
  return { pts: new Float32Array(P.flat()), nPts: P.length, lines: new Float32Array(L), nLineV: L.length / 6 };
}

// Flat band (ring, disc) in the XZ plane: [angle, t across] per vertex, triangle strip.
export function band(seg = 256) {
  const v = [];
  for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2; v.push(a, 0, a, 1); }
  return new Float32Array(v);
}
