// NEXUS 3D knowledge graph (three.js r160, bundled in app/vendor/three). Loaded only by the Obsidian & Graphify page.
// Real data only: nodes and links come from /api/graph (vault + graph.json). Hubs and the NEXUS core are layout anchors, not links:
// the beams core → hub show the cluster rule, never a relationship between notes. Live patches tween in place (camera, selection,
// filters and collapsed clusters stay). Quality adapts to frame time; reduced motion stops flow, auto-rotate and tweens; rendering
// stops while the graph is off screen, the tab is hidden or the page says pause().
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as S from './settings.js';

// Deeper than the UI accents on purpose: on the dark graph they read as colour, not glare.
export const CLUSTERS = [
  { k: 'obsidian', name: 'Obsidian Notes', color: '#8B5CF6', ic: 'i-book', pos: [-120, 98, 10], rule: 'Vault root notes, folders, Daily Notes, Templates and any note outside the other rules.' },
  { k: 'roblox', name: 'Roblox Projects', color: '#E8742A', ic: 'i-roblox', pos: [125, 100, -10], rule: 'The active project\'s notes + the Knowledge Base (Roblox KB), and NEXUS projects of type Roblox.' },
  { k: 'claude', name: 'Claude Code', color: '#22B868', ic: 'i-term', pos: [-190, -8, -20], rule: 'CLAUDE.md, PROJECT_MEMORY.md, their workflow sections, Token Optimization notes and other NEXUS projects.' },
  { k: 'plugins', name: 'Plugins & Skills', color: '#3474E0', ic: 'i-puzzle', pos: [200, -12, 20], rule: 'Every installed skill and the plugin that provides it.' },
  { k: 'blender', name: 'Blender Assets', color: '#D9A02B', ic: 'i-cube', pos: [-118, -112, 15], rule: 'Notes or projects with "blender" in the name or a tag.' },
  { k: 'refs', name: 'References', color: '#D9405C', ic: 'i-layers', pos: [118, -110, -15], rule: 'Tag nodes (#tags used by 40 notes or fewer, the same cut-off Graphify uses).' },
];
// glass theme (user ref docs/nexus_refs/brain-target.webp): pink/violet/blue clusters, accent core
const GPAL = ['#FF4FB8', '#9B7BFF', '#C86BFF', '#5C8BFF', '#FF6FD8', '#7C5CFF', '#E46BFF', '#4FA8FF', '#FF5F9E', '#B794FF', '#A35CFF', '#6F7BFF', '#F28BFF', '#8F5BFF', '#FF7AC8', '#5CF2FF'];
const CORE0 = '#3DFFB0', PAL0 = ['#31D67A', '#3D8BFF', '#FF8A3D', '#A26BFF', '#FF4D6A', '#FFC23D', '#2EE6D6', '#F25FD0', '#9BE15D', '#5AB8F2', '#FF6F3C', '#C9A0FF', '#4DE8A0', '#F2B544', '#7A8CFF', '#E85D75'];
const REL_A = { references: 1, mentions: .75, provides: .55, tagged: .42, contains: .34, documented_in: .6, defines: .6 };
const SHAPE = { document: 'doc', concept: 'con', code: 'code', rationale: 'rat', project: 'proj' };
const SEG = 10;

export function createGraph(host, opt = {}) {
  const GL = document.documentElement.dataset.theme === 'glass', CORE = GL ? (getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#B794FF') : CORE0, PAL = GL ? GPAL : PAL0, LK = GL ? 1.7 : 1;
  let P = S.graphPrefs(); const reduced = S.reducedMotion(); // P: bloom, bright, links, particles, size, labels, anim, quality (settings.js)
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(GL ? 0x0a0616 : 0x000000, 1); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = GL ? .9 : .95;
  host.append(renderer.domElement); renderer.domElement.className = 'g3-cv';
  const labels = document.createElement('div'); labels.className = 'g3-labels'; host.append(labels);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(48, 1, 1, 4000);
  camera.position.set(0, 40, 560);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: .06, minDistance: 60, maxDistance: 1400, autoRotate: !reduced, autoRotateSpeed: .16 * P.anim, rotateSpeed: .7, panSpeed: .7, enableZoom: false });
  // bloom: strength from prefs (Balanced .45, was 1.05), tighter radius and a higher threshold so only cores glow, not the whole frame
  const composer = new EffectComposer(renderer), bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), P.bloom * (GL ? 1.15 : 1), GL ? .4 : .18, GL ? .42 : .34);
  composer.addPass(new RenderPass(scene, camera)); composer.addPass(bloom); composer.addPass(new OutputPass());
  const U = { uTime: { value: 0 }, uFlow: { value: reduced ? 0 : 1 }, uPR: { value: 1 }, uScale: { value: 1 }, uBright: { value: P.bright }, uLinkA: { value: P.links * LK } };

  // ---------- materials ----------
  const fres = new THREE.ShaderMaterial({ uniforms: U, vertexShader: `
    attribute float aA; varying vec3 vN; varying vec3 vV; varying vec3 vC; varying float vA; varying float vD;
    void main(){ mat4 m = modelMatrix * instanceMatrix; vec4 wp = m * vec4(position,1.); vN = normalize(mat3(m) * normal); vV = normalize(cameraPosition - wp.xyz);
      vC = instanceColor; vA = aA; vec4 mv = viewMatrix * wp; vD = smoothstep(380., 1300., -mv.z); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uBright; varying vec3 vN; varying vec3 vV; varying vec3 vC; varying float vA; varying float vD;
    void main(){ float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), 2.5); vec3 c = vC * (.16 + .44 * (1. - f)) + vC * f * 1.5 + vec3(f * .08) + vC * .35 * pow(1. - f, 6.) + vec3(.18) * pow(1. - f, 8.);
      gl_FragColor = vec4(c * vA * uBright * (1. - .78 * vD), 1.); }` });
  const halo = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: `
    attribute float aSize; attribute vec3 aCol; attribute float aA; uniform float uPR; uniform float uScale; varying vec3 vC; varying float vA;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = aSize * uPR * uScale / max(1., -mv.z); gl_Position = projectionMatrix * mv; vC = aCol; vA = aA * (1. - .75 * smoothstep(380., 1300., -mv.z)); }`,
  fragmentShader: `varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord - .5) * 2.; float g = pow(max(0., 1. - r), 5.); gl_FragColor = vec4(vC * g * vA, g * vA); }` });
  const lineMat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: `
    attribute vec3 aCol; attribute float aT; attribute float aPh; attribute float aA; varying vec3 vC; varying float vT; varying float vPh; varying float vA; varying float vD;
    void main(){ vC = aCol; vT = aT; vPh = aPh; vA = aA; vec4 mv = modelViewMatrix * vec4(position,1.); vD = smoothstep(380., 1300., -mv.z); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uTime; uniform float uFlow; uniform float uLinkA; varying vec3 vC; varying float vT; varying float vPh; varying float vA; varying float vD;
    void main(){ float x = fract(vT - uTime * .28 + vPh) - .5; float p = exp(-x * x * 220.) * uFlow; float a = (.3 + .6 * p) * vA * uLinkA * (1. - .78 * vD);
      gl_FragColor = vec4(vC * a, a); }` });
  const beamMat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: `
    attribute vec3 aCol; varying vec3 vC; varying float vT; void main(){ vC = aCol; vT = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform float uTime; uniform float uFlow; uniform float uA; varying vec3 vC; varying float vT;
    void main(){ float x = fract(vT * 2. - uTime * .45) - .5; float p = exp(-x * x * 60.) * uFlow; float a = (.14 + .7 * p) * uA; gl_FragColor = vec4(vC * a, a); }` });

  // ---------- scene: dust, core ----------
  const world = new THREE.Group(); scene.add(world);
  const dust = (() => { const n = 1800, P = new Float32Array(n * 3), S = new Float32Array(n), Cc = new Float32Array(n * 3), A = new Float32Array(n), c = new THREE.Color();
    for (let i = 0; i < n; i++) { const r = 260 + Math.random() * 1100, t = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1);
      P.set([r * Math.sin(ph) * Math.cos(t), r * Math.cos(ph) * .6, r * Math.sin(ph) * Math.sin(t)], i * 3); S[i] = 4 + Math.random() * 10; A[i] = .08 + Math.random() * .24;
      c.set(GL ? GPAL[Math.random() * 8 | 0] : Math.random() < .7 ? '#3DFFB0' : Math.random() < .5 ? '#3D8BFF' : '#A26BFF'); Cc.set([c.r, c.g, c.b], i * 3) }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(S, 1)); g.setAttribute('aCol', new THREE.BufferAttribute(Cc, 3)); g.setAttribute('aA', new THREE.BufferAttribute(A, 1));
    g.setDrawRange(0, Math.round(n * P.particles)); const p = new THREE.Points(g, halo); scene.add(p); return p })();
  const core = new THREE.Group(); world.add(core);
  const coreCol = new THREE.Color(CORE);
  const coreBall = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(17, 3), fres, 1); coreBall.setMatrixAt(0, new THREE.Matrix4()); coreBall.setColorAt(0, coreCol.clone().multiplyScalar(.74));
  coreBall.geometry.setAttribute('aA', new THREE.InstancedBufferAttribute(new Float32Array([1]), 1)); core.add(coreBall);
  const shell = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(27, 1)), new THREE.LineBasicMaterial({ color: CORE, transparent: true, opacity: .2, blending: THREE.AdditiveBlending, depthWrite: false })); core.add(shell);
  const rings = [0, 1, 2].map(i => { const m = new THREE.Mesh(new THREE.TorusGeometry(36 + i * 7, .22 + (i === 0) * .16, 8, 140), new THREE.MeshBasicMaterial({ color: i === 1 ? (GL ? '#FF6FD8' : '#7DFFD0') : CORE, transparent: true, opacity: .27 - i * .07, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.set(1.2 + i * .5, i * .8, 0); core.add(m); return m });
  if (GL) { const shard = new THREE.ConeGeometry(2.4, 15, 5), sm = new THREE.MeshBasicMaterial({ color: new THREE.Color(CORE).lerp(new THREE.Color('#fff'), .25), transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false }), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 26; i++) { const d = new THREE.Vector3().randomDirection(), m = new THREE.Mesh(shard, sm); m.scale.y = .6 + Math.random() * .9; m.position.copy(d).multiplyScalar(19 + 5 * m.scale.y); m.quaternion.setFromUnitVectors(up, d); core.add(m) } } // crystal spikes
  const coreHalo = points([[0, 0, 0]], [82], [coreCol], [.3]); core.add(coreHalo);

  // ---------- state ----------
  const N = new Map(), L = new Map(); let hubs = [], hubObj = new THREE.Group(); world.add(hubObj);
  let mode = 'nexus', dim3 = true, filter = null, sel = null, hover = null, collapsed = new Set(), nb = new Set(), moving = true, flyT = null;
  const meshes = {}, nodeHalo = { obj: null }; let linkObj = null;
  const geo = { doc: new THREE.IcosahedronGeometry(1, 2), con: new THREE.OctahedronGeometry(1.25, 0), code: new THREE.BoxGeometry(1.5, 1.5, 1.5), rat: new THREE.TetrahedronGeometry(1.4, 0), proj: new THREE.DodecahedronGeometry(1.3, 0) };
  const col = new THREE.Color(), m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), v3 = new THREE.Vector3();

  function points(P, S, Cs, A) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P.flat()), 3)); g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(S), 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(Cs.flatMap(c => [c.r, c.g, c.b])), 3)); g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(A), 1));
    const p = new THREE.Points(g, halo); p.frustumCulled = false; return p;
  }
  const hubOf = n => hubs.find(h => h.k === (mode === 'nexus' ? n.k : 'c' + (n.c ?? 'new')));
  const colorOf = n => (hubOf(n) || { color: '#94A99C' }).color;

  // ---------- hubs (NEXUS clusters or Graphify communities) ----------
  function makeHubs(keep) { const old = new Map(hubs.map(h => [h.k, h.pos.clone()]));
    for (const h of hubs) { h.el?.remove() } world.remove(hubObj); hubObj.traverse(o => o.geometry?.dispose?.()); hubObj = new THREE.Group(); world.add(hubObj);
    if (mode === 'nexus') hubs = CLUSTERS.map((c, i) => ({ ...c, color: GL ? PAL[i] : c.color, pos: new THREE.Vector3(...c.pos) }));
    else { const cm = new Map(); for (const n of N.values()) if (!n.dead) { const k = n.c ?? 'new'; if (!cm.has(k)) cm.set(k, n.c == null ? 'Not yet in Graphify (run Sync All)' : n.cn || 'Community ' + n.c) }
      const ks = [...cm.keys()].sort((a, b) => (a === 'new') - (b === 'new') || a - b);
      hubs = ks.map((k, i) => { const t = i / Math.max(1, ks.length), y = 1 - 2 * (i + .5) / ks.length, r = Math.sqrt(1 - y * y), a = i * 2.39996;
        return { k: 'c' + k, name: cm.get(k), color: k === 'new' ? '#94A99C' : PAL[k % PAL.length], ic: 'i-graph', pos: new THREE.Vector3(Math.cos(a) * r * 230, y * 150, Math.sin(a) * r * 230), rule: k === 'new' ? 'Nodes the live vault has that graph.json does not yet: Graphify assigns their community on the next Sync All.' : 'Graphify community ' + k + ' (from graph.json).' } }) }
    if (keep) for (const h of hubs) { if (old.has(h.k)) h.pos.copy(old.get(h.k)) } else arrange(); // live patch: hubs stay put
    for (const h of hubs) {
      const c = new THREE.Color(h.color); h.c3 = c; h.g = new THREE.Group(); h.g.position.copy(h.pos); hubObj.add(h.g);
      h.ball = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(mode === 'nexus' ? 9 : GL ? 9 : 6, 2), fres, 1); h.ball.setMatrixAt(0, new THREE.Matrix4()); h.ball.setColorAt(0, GL ? c.clone().lerp(new THREE.Color('#fff'), .35) : c);
      h.ball.geometry.setAttribute('aA', new THREE.InstancedBufferAttribute(new Float32Array([1]), 1)); h.ball.userData.hub = h; h.g.add(h.ball);
      h.ring = new THREE.Mesh(new THREE.TorusGeometry(mode === 'nexus' ? 14 : 9.5, .2, 6, 90), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false }));
      h.ring.rotation.x = Math.PI / 2.3; h.g.add(h.ring);
      h.halo = points([[0, 0, 0]], [mode === 'nexus' ? 58 : GL ? 60 : 36], [c], [GL ? .38 : .32]); h.g.add(h.halo);
      h.orb = GL ? [24, 33].map((r, i) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, .16, 4, 120), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .32 - i * .1, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.set(1.25 + i * .35, i * .7, 0); h.g.add(m); return m }) : []; // orbit rings
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), h.pos.clone().multiplyScalar(.5).add(new THREE.Vector3(0, 18, 0)), h.pos.clone());
      const tg = new THREE.TubeGeometry(curve, 48, mode === 'nexus' ? .55 : GL ? 1.1 : .3, 6, false), n = tg.attributes.position.count, cc = new Float32Array(n * 3), uv = tg.attributes.uv;
      for (let i = 0; i < n; i++) { const t = uv.getX(i); col.copy(coreCol).lerp(c, t); cc.set([col.r, col.g, col.b], i * 3) } tg.setAttribute('aCol', new THREE.BufferAttribute(cc, 3));
      h.beam = new THREE.Mesh(tg, beamMat.clone()); h.beam.material.uniforms = { ...U, uA: { value: GL ? .6 : .35 } }; hubObj.add(h.beam);
      h.el = document.createElement('div'); h.el.className = 'g3-l hub'; h.el.style.setProperty('--c', h.color); labels.append(h.el);
    }
  }

  // Hub placement from real links: clusters that share many links pull together, unlinked ones push apart; all stay on a flattened
  // shell around the core. Deterministic (starts from the fixed positions), so the same data always gives the same picture.
  function arrange() {
    const n = hubs.length, ix = new Map(hubs.map((h, i) => [h.k, i])), w = hubs.map(() => new Float32Array(n)); let mx = 0;
    for (const l of L.values()) { const a = ix.get(hubOf(N.get(l.a))?.k), b = ix.get(hubOf(N.get(l.b))?.k); if (a != null && b != null && a !== b) { w[a][b]++; w[b][a]++ } }
    for (const r of w) for (const v of r) mx = Math.max(mx, v); if (!mx) return;
    const R = mode === 'nexus' ? 205 : 235, Pp = hubs.map(h => h.pos.clone().setLength(R)), f = new THREE.Vector3(), d = new THREE.Vector3();
    for (let it = 0; it < 220; it++) for (let i = 0; i < n; i++) { f.set(0, 0, 0);
      for (let j = 0; j < n; j++) { if (i === j) continue; d.subVectors(Pp[i], Pp[j]); const len = Math.max(d.length(), 1); d.divideScalar(len);
        f.addScaledVector(d, 52000 / (len * len) - .0065 * len * Math.sqrt(w[i][j] / mx)) } // ponytail: sqrt keeps one huge cluster from collapsing the rest
      Pp[i].add(f.clampLength(0, 6)).setLength(R) }
    hubs.forEach((h, i) => h.pos.set(Pp[i].x, Pp[i].y * .62, Pp[i].z));
  }

  // ---------- data ----------
  function setData(nodes, links) {
    const keep = new Map([...N].map(([id, n]) => [id, n]));
    N.clear(); L.clear();
    for (const x of nodes) N.set(x.id, Object.assign(keep.get(x.id) || { cp: null, tq: new THREE.Vector3(), z: reduced ? 1 : 0, st: 1, a: 1, at: 1 }, x, { dead: false }));
    for (const l of links) if (N.has(l.a) && N.has(l.b)) L.set(l.k, l);
    degrees(); makeHubs(); layout(true); rebuild(); refreshLabels(); if (!touched) fit(false); select(sel && (N.has(sel) || sel.startsWith('hub:')) ? sel : null, false);
  }
  function patch(p) {
    for (const id of p.remove || []) { const n = N.get(id); if (n) { n.dead = true; n.st = 0 } }
    for (const k of p.linksRemove || []) L.delete(k);
    for (const x of [...(p.add || []), ...(p.update || [])]) { const n = N.get(x.id); if (n) Object.assign(n, x, { dead: false, st: 1 }); else N.set(x.id, Object.assign({ cp: null, tq: new THREE.Vector3(), z: 0, st: 1, a: 1, at: 1 }, x)) }
    for (const l of p.linksAdd || []) if (N.has(l.a) && N.has(l.b)) L.set(l.k, l);
    for (const [k, l] of L) if (N.get(l.a)?.dead || N.get(l.b)?.dead) L.delete(k); // a link to a removed note is dead: drop it
    degrees(); const reHub = mode !== 'nexus' && (p.add?.length || p.update?.some(u => 'c' in u)); if (reHub) makeHubs(true);
    layout(false); rebuild(); refreshLabels(); applyHighlight(); if (sel && !sel.startsWith('hub:') && !N.get(sel) ) select(null);
    if (reduced) purge();
  }
  function purge() { let ch = false; for (const [id, n] of N) if (n.dead && (reduced || n.z < .02)) { N.delete(id); ch = true } if (ch) { rebuild(); refreshLabels() } }
  function degrees() { for (const n of N.values()) { n.deg = 0; n.rdeg = 0 } for (const l of L.values()) { const a = N.get(l.a), b = N.get(l.b); a.deg++; b.deg++; if (l.r === 'references' || l.r === 'mentions') { a.rdeg++; b.rdeg++ } } }

  // ---------- force layout (anchor springs + repulsion + link springs; CPU, ~300 nodes) ----------
  function layout(full) {
    const live = [...N.values()].filter(n => !n.dead), n = live.length; if (!n) return;
    const P = new Float32Array(n * 3), V = new Float32Array(n * 3), A = new Float32Array(n * 3), fixed = new Uint8Array(n), idx = new Map();
    live.forEach((x, i) => { idx.set(x.id, i); const h = hubOf(x), hp = h ? h.pos : v3.set(0, 0, 0); let p = dim3 ? x.p3 : x.p2;
      if (!p) { p = x.p3 || x.p2 || null; if (!p) { const r = 14 + Math.random() * 20, t = Math.random() * 6.283, f = Math.acos(2 * Math.random() - 1); p = [hp.x + r * Math.sin(f) * Math.cos(t), hp.y + r * Math.cos(f), hp.z + r * Math.sin(f) * Math.sin(t)] } else if (!full && x.cp) fixed[i] = 0 }
      else if (!full) fixed[i] = 1;
      P.set([p[0], p[1], dim3 ? p[2] : 0], i * 3); A.set([hp.x, hp.y, dim3 ? hp.z : 0], i * 3) });
    const E = [...L.values()].map(l => [idx.get(l.a), idx.get(l.b), REL_A[l.r] || .4]).filter(e => e[0] != null && e[1] != null);
    const HB = live.map(hubOf), cnt = {}; for (const h of HB) cnt[h?.k] = (cnt[h?.k] || 0) + 1; const SK = HB.map(h => .012 / Math.sqrt(Math.max(1, (cnt[h?.k] || 1) / 12))); // hub lookups once, not per iteration
    const iters = full ? 260 : 140;
    for (let it = 0; it < iters; it++) {
      const al = Math.max(.03, 1 - it / iters);
      for (let i = 0; i < n; i++) { if (fixed[i]) continue; const s = SK[i];
        for (let d = 0; d < 3; d++) V[i * 3 + d] += (A[i * 3 + d] - P[i * 3 + d]) * s * al }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const dx = P[i * 3] - P[j * 3], dy = P[i * 3 + 1] - P[j * 3 + 1], dz = P[i * 3 + 2] - P[j * 3 + 2], d2 = dx * dx + dy * dy + dz * dz + .01; if (d2 > 3600) continue;
        const f = Math.min(4, 90 / d2) * al; if (!fixed[i]) { V[i * 3] += dx * f / 6; V[i * 3 + 1] += dy * f / 6; V[i * 3 + 2] += dz * f / 6 } if (!fixed[j]) { V[j * 3] -= dx * f / 6; V[j * 3 + 1] -= dy * f / 6; V[j * 3 + 2] -= dz * f / 6 } }
      for (const [a, b, w] of E) { const dx = P[b * 3] - P[a * 3], dy = P[b * 3 + 1] - P[a * 3 + 1], dz = P[b * 3 + 2] - P[a * 3 + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) + .01, f = (d - 22) / d * .0035 * w * al;
        if (!fixed[a]) { V[a * 3] += dx * f; V[a * 3 + 1] += dy * f; V[a * 3 + 2] += dz * f } if (!fixed[b]) { V[b * 3] -= dx * f; V[b * 3 + 1] -= dy * f; V[b * 3 + 2] -= dz * f } }
      for (let i = 0; i < n; i++) { if (fixed[i]) continue; const o = i * 3, r = Math.hypot(P[o], P[o + 1], P[o + 2]);
        if (r < 62) { const f = (62 - r) / Math.max(r, 1) * .2; V[o] += P[o] * f; V[o + 1] += P[o + 1] * f; V[o + 2] += P[o + 2] * f } // keep the core clear
        const h = HB[i], hx = P[o] - A[o], hy = P[o + 1] - A[o + 1], hz = P[o + 2] - A[o + 2], hr = Math.hypot(hx, hy, hz); if (h && hr < 15) { const f = (15 - hr) / Math.max(hr, .5) * .25; V[o] += hx * f; V[o + 1] += hy * f; V[o + 2] += hz * f }
        for (let d = 0; d < 3; d++) { V[o + d] *= .62; P[o + d] += V[o + d] } if (!dim3) P[o + 2] = 0 }
    }
    live.forEach((x, i) => { const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]; if (dim3) x.p3 = p; else x.p2 = p; x.tq.set(...p); if (!x.cp || reduced) x.cp = x.tq.clone() });
    moving = true;
  }

  // ---------- GPU buffers ----------
  function rebuild() {
    const all = [...N.values()], by = {};
    for (const n of all) (by[SHAPE[n.t] || 'doc'] ||= []).push(n);
    for (const s of Object.keys(geo)) {
      const list = by[s] || [], need = Math.max(8, list.length);
      if (!meshes[s] || meshes[s].instanceMatrix.count < need) { if (meshes[s]) { world.remove(meshes[s]); meshes[s].dispose() }
        const g = geo[s].clone(); g.setAttribute('aA', new THREE.InstancedBufferAttribute(new Float32Array(need * 2), 1));
        const m = new THREE.InstancedMesh(g, fres, need * 2); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(need * 6), 3); m.frustumCulled = false; meshes[s] = m; world.add(m) }
      const m = meshes[s]; m.count = list.length; m.userData.ids = list.map(n => n.id); list.forEach((n, i) => { n.mesh = m; n.i = i; col.set(colorOf(n)); m.setColorAt(i, col) }); m.instanceColor.needsUpdate = true;
    }
    if (nodeHalo.obj) { world.remove(nodeHalo.obj); nodeHalo.obj.geometry.dispose() }
    nodeHalo.list = all; nodeHalo.obj = points(all.map(() => [0, 0, 0]), all.map(n => (12 + 5 * Math.sqrt(n.deg)) * P.size), all.map(n => new THREE.Color(colorOf(n))), all.map(() => .3)); world.add(nodeHalo.obj);
    if (linkObj) { world.remove(linkObj); linkObj.geometry.dispose() }
    const ls = [...L.values()], nv = ls.length * (SEG + 1), g = new THREE.BufferGeometry(), C3 = new Float32Array(nv * 3), T = new Float32Array(nv), Ph = new Float32Array(nv), I = [];
    ls.forEach((l, j) => { const a = new THREE.Color(colorOf(N.get(l.a))), b = new THREE.Color(colorOf(N.get(l.b))), ph = Math.random();
      for (let s = 0; s <= SEG; s++) { const v = j * (SEG + 1) + s; col.copy(a).lerp(b, s / SEG); C3.set([col.r, col.g, col.b], v * 3); T[v] = s / SEG; Ph[v] = ph; if (s) I.push(v - 1, v) } });
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3)); g.setAttribute('aCol', new THREE.BufferAttribute(C3, 3)); g.setAttribute('aT', new THREE.BufferAttribute(T, 1));
    g.setAttribute('aPh', new THREE.BufferAttribute(Ph, 1)); g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(nv), 1)); g.setIndex(I);
    linkObj = new THREE.LineSegments(g, lineMat); linkObj.frustumCulled = false; linkObj.userData.ls = ls; world.add(linkObj);
    applyHighlight(); moving = true;
  }

  // ---------- highlight: selection, hover, filter, collapsed clusters ----------
  function applyHighlight() {
    nb = new Set(); const focus = hover || sel;
    if (focus && !focus.startsWith('hub:')) { nb.add(focus); for (const l of L.values()) { if (l.a === focus) nb.add(l.b); if (l.b === focus) nb.add(l.a) } }
    const hubSel = focus?.startsWith('hub:') ? focus.slice(4) : null;
    for (const n of N.values()) {
      const hk = hubOf(n)?.k, hidden = collapsed.has(hk), pass = !filter || filter(n);
      n.st = n.dead || hidden ? 0 : 1;
      n.at = !pass ? .1 : nb.size ? (nb.has(n.id) ? (n.id === focus ? 1.6 : 1.15) : .14) : hubSel ? (hk === hubSel ? 1.2 : .16) : 1;
      if (reduced) { n.a = n.at; n.z = n.st }
    }
    if (linkObj) { const A = linkObj.geometry.attributes.aA;
      linkObj.userData.ls.forEach((l, j) => { const a = N.get(l.a), b = N.get(l.b); let v = (REL_A[l.r] || .4) * Math.min(a.at, b.at) * Math.min(a.st, b.st);
        if (nb.size) v = (l.a === focus || l.b === focus) ? 1.7 : v * .2; for (let s = 0; s <= SEG; s++) A.array[j * (SEG + 1) + s] = v });
      A.needsUpdate = true }
    for (const h of hubs) { const empty = !count(h.k), on = !hubSel || hubSel === h.k; h.ball.geometry.attributes.aA.array[0] = empty ? .22 : on ? .95 : .3; h.ball.geometry.attributes.aA.needsUpdate = true;
      h.ring.material.opacity = empty ? .1 : on ? .45 : .12; h.halo.geometry.attributes.aA.array[0] = empty ? .1 : on ? .32 : .1; h.halo.geometry.attributes.aA.needsUpdate = true; h.beam.material.uniforms.uA.value = empty ? .08 : on ? .35 : .1 }
    moving = true; refreshLabels();
  }
  const links = k => { const o = new Set(); for (const l of L.values()) { const a = hubOf(N.get(l.a))?.k, b = hubOf(N.get(l.b))?.k; if (a && b && a !== b) { if (a === k) o.add(b); else if (b === k) o.add(a) } } return o.size }; // clusters this one links to
  const count = k => { let c = 0; for (const n of N.values()) if (!n.dead && hubOf(n)?.k === k) c++; return c };

  // ---------- labels (HTML, crisp; only hubs, core, focus and the most linked nodes) ----------
  const coreEl = document.createElement('div'); coreEl.className = 'g3-l core'; coreEl.innerHTML = '<b>NEXUS</b>'; labels.append(coreEl);
  let nodeEls = new Map();
  function refreshLabels() {
    for (const h of hubs) { const c = count(h.k); const cn = GL ? links(h.k) : 0; h.el.innerHTML = `<svg class="ic"><use href="#${h.ic}"/></svg><span><b>${esc(h.name)}</b><small>${c ? c + ' node' + (c === 1 ? '' : 's') : '0 notes'}${cn ? ' · ' + cn + ' connection' + (cn === 1 ? '' : 's') : ''}${collapsed.has(h.k) ? ' · collapsed' : ''}</small></span>${GL ? '<svg class="chev"><use href="#i-chev"/></svg>' : ''}`; h.el.classList.toggle('empty', !c); h.c = c }
    hubOrder = [...hubs].sort((a, b) => b.c - a.c) // Graphify: biggest communities claim label space first
    // candidates in priority order: focus, its neighbours, then every visible node by link count. layoutLabels() shows as many as the
    // zoom level allows and skips any that would overlap one already placed.
    const focus = hover || sel, ok = n => n && !n.dead && !collapsed.has(hubOf(n)?.k) && (!filter || filter(n)), want = [];
    if (focus && !focus.startsWith('hub:')) { want.push(focus); [...nb].filter(id => id !== focus).map(id => N.get(id)).filter(ok).sort((a, b) => b.rdeg - a.rdeg).slice(0, 24).forEach(n => want.push(n.id)) }
    const seen = new Set(want); for (const n of [...N.values()].filter(ok).sort((a, b) => b.rdeg - a.rdeg || b.deg - a.deg).slice(0, 70)) if (!seen.has(n.id)) want.push(n.id);
    nFocus = focus && !focus.startsWith('hub:') ? Math.min(want.length, 1 + Math.min(24, nb.size - 1)) : 0;
    const keepIds = new Set(want); for (const [id, el] of nodeEls) if (!keepIds.has(id)) { el.remove(); nodeEls.delete(id) }
    order = want.filter(id => N.get(id));
    for (const id of order) { const n = N.get(id); let el = nodeEls.get(id); if (!el) { el = document.createElement('div'); el.className = 'g3-l n hid'; labels.append(el); nodeEls.set(id, el) }
      if (el.textContent !== n.l) { el.textContent = n.l; el._w = 0 } el.classList.toggle('on', id === focus); el.style.setProperty('--c', colorOf(n)) }
  }
  let order = [], hubOrder = [], nFocus = 0; const boxes = [];
  const hit = (x, y, w, h) => boxes.some(b => x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]);
  function layoutLabels() { // every frame: budget from camera distance, greedy no-overlap placement
    const dist = camera.position.distanceTo(controls.target), budget = Math.max(2, Math.min(60, Math.round(8 * Math.pow(fitD / dist, 1.6) * P.labels)));
    boxes.length = 0;
    const put = (el, p, off, force) => { v3.copy(p).project(camera); const on = v3.z < 1 && Math.abs(v3.x) < 1.02 && Math.abs(v3.y) < 1.02;
      if (!on) { if (!el.classList.contains('hid')) el.classList.add('hid'); return }
      const x = (v3.x + 1) / 2 * W, y = (1 - v3.y) / 2 * Hh + off; if (!el._w) el._w = el.offsetWidth || 60; const w = el._w + 14, h = (el._h || (el._h = el.offsetHeight || 16)) + 6;
      if (!force && hit(x - w / 2, y, w, h)) { if (!el.classList.contains('hid')) el.classList.add('hid'); return }
      boxes.push([x - w / 2, y, w, h]); el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,0)`; if (el.classList.contains('hid')) el.classList.remove('hid') };
    put(coreEl, v3.set(0, -40, 0), 0, true); for (const h of hubOrder) put(h.el, h.pos.clone().add(new THREE.Vector3(0, mode === 'nexus' ? -18 : GL ? -30 : -11, 0)), 0, mode === 'nexus'); // Graphify hubs overlap-checked (legend lists them all)
    order.forEach((id, i) => { const el = nodeEls.get(id), n = N.get(id); if (!el) return;
      if (!n || !n.st || n.z < .3 || (i >= budget && i >= nFocus)) { if (!el.classList.contains('hid')) el.classList.add('hid'); return }
      put(el, n.cp, 8, i === 0 && nFocus) });
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';');

  // ---------- picking ----------
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let down = null, pend = null;
  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect(); ptr.set((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects([...Object.values(meshes), ...hubs.map(h => h.ball), coreBall], false)[0]; if (!hit) return null;
    if (hit.object === coreBall) return 'core'; if (hit.object.userData.hub) return 'hub:' + hit.object.userData.hub.k;
    const id = hit.object.userData.ids?.[hit.instanceId], n = N.get(id); return n && !n.dead && n.st ? id : null;
  }
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; controls.autoRotate = false; touched = true });
  // wheel zoom: eased toward a target distance (no jumps); trackpads send small deltas, mouse wheels ~100 per notch
  cv.addEventListener('wheel', e => { e.preventDefault(); flyT = null; touched = true; const d = zoomD ?? camera.position.distanceTo(controls.target);
    zoomD = THREE.MathUtils.clamp(d * Math.pow(1.0012, Math.max(-240, Math.min(240, e.deltaY * (e.deltaMode ? 40 : 1)))), controls.minDistance, controls.maxDistance); if (reduced) zoomStep(1) }, { passive: false });
  cv.addEventListener('pointermove', e => { if (pend) return; pend = requestAnimationFrame(() => { pend = null; if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return; const h = pick(e), hv = h === 'core' ? null : h;
    cv.style.cursor = h ? 'pointer' : 'grab'; if (hv !== hover) { hover = hv; applyHighlight(); opt.onHover?.(hover && info(hover), e) } }) });
  cv.addEventListener('pointerleave', () => { if (hover) { hover = null; applyHighlight(); opt.onHover?.(null) } });
  cv.addEventListener('pointerup', e => { const moved = !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5; down = null; if (moved) return; const h = pick(e); select(h === 'core' ? null : h, true); opt.onSelect?.(sel && info(sel)) });
  cv.addEventListener('dblclick', e => { const h = pick(e); if (h?.startsWith('hub:')) toggleCluster(h.slice(4)) });

  function info(id) {
    if (id.startsWith('hub:')) { const h = hubs.find(x => 'hub:' + x.k === id); if (!h) return null; const mem = [...N.values()].filter(n => !n.dead && hubOf(n)?.k === h.k);
      return { hub: true, id, k: h.k, name: h.name, color: h.color, rule: h.rule, count: mem.length, collapsed: collapsed.has(h.k), top: mem.sort((a, b) => b.rdeg - a.rdeg).slice(0, 8).map(n => ({ id: n.id, l: n.l, d: n.rdeg })) } }
    const n = N.get(id); if (!n) return null; const nbs = []; for (const l of L.values()) { const o = l.a === id ? l.b : l.b === id ? l.a : null; if (o && N.has(o)) nbs.push({ id: o, l: N.get(o).l, r: l.r, o: l.o, color: colorOf(N.get(o)) }) }
    return { ...n, p3: undefined, p2: undefined, cp: undefined, tq: undefined, mesh: undefined, note: n.id.startsWith('note_') ? n.p : null, hub: false, cluster: hubOf(n)?.name, color: colorOf(n), nbs: nbs.sort((a, b) => a.r.localeCompare(b.r) || a.l.localeCompare(b.l)) };
  }

  // ---------- camera ----------
  // fit: smallest distance (along the current view direction) that keeps every node, hub and the core in frame with room for labels
  let touched = false, zoomD = null, fitD = 520; const fitC = new THREE.Vector3();
  function fit(anim) {
    const pts = [new THREE.Vector3(0, -48, 0), ...hubs.flatMap(h => [h.pos, h.pos.clone().add(new THREE.Vector3(0, mode === 'nexus' ? -52 : -36, 0))])]; // hub + its 2-line label + the help line under the graph for (const n of N.values()) if (!n.dead && n.st) pts.push(n.tq);
    const box = new THREE.Box3().setFromPoints(pts); box.getCenter(fitC); if (!dim3) fitC.z = 0;
    const back = camera.position.clone().sub(controls.target).normalize(); if (!dim3 || back.lengthSq() < .5) back.set(0, dim3 ? .07 : 0, 1).normalize();
    const up = new THREE.Vector3(0, 1, 0).projectOnPlane(back).normalize(), right = new THREE.Vector3().crossVectors(up, back), tv0 = Math.tan(camera.fov * Math.PI / 360), tv = tv0 * .8, th = tv0 * camera.aspect * .86; // margins: labels, help line, legend
    const kh = Math.sqrt(1 / (th * th) + 1); // 3D auto-rotates about Y: horizontal fit must hold at every angle, so use the radius in XZ
    let d = 120; for (const p of pts) { v3.subVectors(p, fitC); const rxz = Math.hypot(v3.x, v3.z); d = Math.max(d, dim3 ? rxz * kh : Math.abs(v3.x) / th, Math.abs(v3.dot(up)) / tv + (dim3 ? rxz * .7 : 0)) }
    fitD = Math.min(controls.maxDistance, d); const pos = fitC.clone().addScaledVector(back, fitD);
    if (anim) fly(fitC.clone(), fitD); else { flyT = null; zoomD = null; controls.target.copy(fitC); camera.position.copy(pos) }
    if (anim) touched = false;
  }
  function zoomStep(dt) { const off = camera.position.clone().sub(controls.target), d = off.length(), nd = d + (zoomD - d) * (1 - Math.exp(-dt * 9));
    camera.position.copy(controls.target).add(off.setLength(nd)); if (Math.abs(nd - zoomD) < .4) zoomD = null }
  function fly(to, dist) {
    const from = controls.target.clone(), fp = camera.position.clone(), dir = fp.clone().sub(from).normalize(), tp = to.clone().add(dir.multiplyScalar(dist));
    if (reduced) { controls.target.copy(to); camera.position.copy(tp); return }
    zoomD = null; const T = Math.min(1300, 650 + fp.distanceTo(tp) * .9), t0 = performance.now(); flyT = now => { const k = Math.min(1, (now - t0) / T), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      controls.target.lerpVectors(from, to, e); camera.position.lerpVectors(fp, tp, e); if (k >= 1) flyT = null };
  }
  function select(id, go) {
    sel = id; applyHighlight();
    if (!go || !id) return;
    if (id.startsWith('hub:')) { const h = hubs.find(x => 'hub:' + x.k === id); if (h) fly(h.pos.clone(), 230) }
    else { const n = N.get(id); if (n) fly(n.tq.clone(), 120) }
  }
  function reset() { controls.autoRotate = !reduced; sel = null; applyHighlight(); fit(true); }
  function toggleCluster(k) { collapsed.has(k) ? collapsed.delete(k) : collapsed.add(k); applyHighlight(); refreshLabels(); opt.onSelect?.(sel && info(sel)) }

  // ---------- frame loop, adaptive quality, pause ----------
  let W = 1, Hh = 1, raf = 0, last = performance.now(), ema = 16, slow = 0, fast = 0, tier = P.quality, act = performance.now(), lastR = 0, tAcc = 0, visible = true, onScreen = true, paused = false, fpsN = 0, fpsT = performance.now(), fps = 0, lastD = 0;
  // quality tiers: the preset picks the start (Cinematic 0, Balanced 1, Minimal 2); slow frames step down, fast frames step back up to the start
  const TIERS = [{ pr: Math.min(2, devicePixelRatio || 1), bloom: true }, { pr: 1.5, bloom: true }, { pr: 1.25, bloom: true }, { pr: 1, bloom: false }];
  let sk = ''; function size() { W = host.clientWidth || 1; Hh = host.clientHeight || 1; const pr = Math.min(TIERS[tier].pr, devicePixelRatio || 1), k = W + 'x' + Hh + '@' + pr + TIERS[tier].bloom; if (k === sk) return; sk = k; renderer.setPixelRatio(pr); renderer.setSize(W, Hh, false);
    composer.setPixelRatio(pr); composer.setSize(W, Hh); bloom.enabled = TIERS[tier].bloom; U.uPR.value = pr; U.uScale.value = Hh / 2 / Math.tan(camera.fov * Math.PI / 360) / 6; camera.aspect = W / Hh; camera.updateProjectionMatrix(); if (!touched && N.size) fit(false); if (raf) composer.render() } // same size: no-op (setSize clears the canvas = flash); new size: draw at once, no blank frame
  const ro = new ResizeObserver(() => size()); ro.observe(host);
  const io = new IntersectionObserver(es => { onScreen = es[0].isIntersecting; run() }); io.observe(host);
  const vis = () => { visible = !document.hidden; run() }; document.addEventListener('visibilitychange', vis);
  function run() { const go = visible && onScreen && !paused; if (go && !raf) { last = performance.now(); raf = requestAnimationFrame(frame) } else if (!go && raf) { cancelAnimationFrame(raf); raf = 0 } }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now; ema = ema * .93 + dt * 1000 * .07; if (now - fpsT > 1000) { fps = fpsN; fpsN = 0; fpsT = now }
    if (ema > 26) { slow += dt; fast = 0 } else if (ema < 13) { fast += dt; slow = 0 } else { slow = fast = 0 }
    if (slow > 2 && tier < TIERS.length - 1) { tier++; slow = 0; size() } else if (fast > 5 && tier > P.quality) { tier--; fast = 0; size() }
    const idle = now - act > 4000 && !moving && !flyT && zoomD == null; // ponytail: idle = no input for 4 s → 30 fps; full rate while the user interacts
    const cap = +S.pref('perf.fps'), iv = Math.max(idle ? 32 : 0, cap ? 1000 / cap : 0); if (now - lastR < iv - 1) return; // perf.fps: Settings frame-rate limit (0 = none)
    lastR = iv ? Math.max(lastR + iv, now - iv) : now; const rdt = Math.min(.05, (now - lastD) / 1000), da = rdt * P.anim; lastD = now; tAcc += da; // fixed step, so a cap between display rates averages out (60 on 75 Hz = 4 of 5 frames)
    U.uTime.value = reduced ? 0 : tAcc;
    if (flyT) flyT(now); else if (zoomD != null) zoomStep(rdt); controls.update();
    if (!reduced) { core.rotation.y += da * .2; shell.rotation.x += da * .1; rings.forEach((r, i) => { r.rotation.z += da * (.25 + i * .12) * (i % 2 ? -1 : 1) }); dust.rotation.y += da * .005;
      const pulse = 1 + Math.sin(tAcc * 1.4) * .025; coreBall.scale.setScalar(pulse); for (const h of hubs) { h.ring.rotation.z += da * .4; h.orb.forEach((o, i) => { o.rotation.z += da * (i ? -.22 : .3) }) } }
    if (moving) step(rdt);
    fpsN++; composer.render(); // fps = frames actually rendered (idle throttle included)
    layoutLabels();
  }
  function step(dt) { // tween positions, scale and brightness; write matrices + halo + link curves
    const k = reduced ? 1 : 1 - Math.exp(-dt * 5); let still = true; const H = nodeHalo.obj?.geometry.attributes, mid = new THREE.Vector3(), ctl = new THREE.Vector3();
    nodeHalo.list?.forEach((n, j) => {
      if (n.cp.distanceToSquared(n.tq) > .01) { n.cp.lerp(n.tq, k); still = false } else n.cp.copy(n.tq);
      const ds = n.st - n.z, da = n.at - n.a; if (Math.abs(ds) > .005 || Math.abs(da) > .005) { n.z += ds * k; n.a += da * k; still = false } else { n.z = n.st; n.a = n.at }
      const sc = (1.3 + .7 * Math.sqrt(n.deg)) * P.size * (GL ? 1.4 : 1) * Math.min(4.2, n.z) * (n.id === sel ? 1.35 : 1);
      m4.compose(n.cp, q0, v3.set(sc, sc, sc)); n.mesh.setMatrixAt(n.i, m4); n.mesh.geometry.attributes.aA.array[n.i] = n.a * Math.min(1, n.z * 1.5);
      H.position.array.set([n.cp.x, n.cp.y, n.cp.z], j * 3); H.aA.array[j] = (GL ? .3 : .26) * n.a * n.z;
    });
    for (const m of Object.values(meshes)) { m.instanceMatrix.needsUpdate = true; m.geometry.attributes.aA.needsUpdate = true }
    if (H) { H.position.needsUpdate = true; H.aA.needsUpdate = true }
    if (linkObj) { const Pa = linkObj.geometry.attributes.position, A = Pa.array;
      linkObj.userData.ls.forEach((l, j) => { const a = N.get(l.a).cp, b = N.get(l.b).cp; mid.addVectors(a, b).multiplyScalar(.5); const len = a.distanceTo(b);
        ctl.copy(mid).normalize().multiplyScalar(len * .18).add(mid); if (!dim3) ctl.z = 0;
        for (let s = 0; s <= SEG; s++) { const t = s / SEG, u = 1 - t, o = (j * (SEG + 1) + s) * 3; A[o] = u * u * a.x + 2 * u * t * ctl.x + t * t * b.x; A[o + 1] = u * u * a.y + 2 * u * t * ctl.y + t * t * b.y; A[o + 2] = u * u * a.z + 2 * u * t * ctl.z + t * t * b.z } });
      Pa.needsUpdate = true }
    if (still) { moving = false; purge() }
  }
  const wake = () => { act = performance.now() }; for (const e of ['pointermove', 'pointerdown', 'wheel', 'keydown']) cv.addEventListener(e, wake, { passive: true });
  function applyPrefs() { // Settings changed (this tab or another): restyle in place, camera and selection untouched
    P = S.graphPrefs(); bloom.strength = P.bloom * (GL ? 1.15 : 1); U.uBright.value = P.bright; U.uLinkA.value = P.links * LK; controls.autoRotateSpeed = .16 * P.anim;
    dust.geometry.setDrawRange(0, Math.round(dust.geometry.attributes.position.count * P.particles)); tier = P.quality; sk = ''; size(); rebuild(); refreshLabels(); wake();
  }
  const unPrefs = S.onChange(k => { if (k === '*' || k.startsWith('graph.')) applyPrefs() });
  size(); run();

  return {
    setData, patch, select: (id, go = true) => { select(id, go); return id && info(id) }, info, reset, toggleCluster,
    setMode(m) { if (m === mode) return; mode = m; labels.classList.toggle('gfy', m !== 'nexus'); for (const el of nodeEls.values()) el._w = el._h = 0; for (const n of N.values()) { n.p3 = n.p2 = null } makeHubs(); layout(true); rebuild(); refreshLabels(); applyHighlight() },
    setDim(d3) { if (d3 === dim3) return; dim3 = d3; controls.enableRotate = d3; controls.autoRotate = d3 && !reduced; layout(true); rebuild();
      fit(true); if (!d3) { const end = fitC.clone().add(new THREE.Vector3(0, 0, fitD)); if (reduced) camera.position.copy(end); else { const s = camera.position.clone(), t0 = performance.now(); flyT = now => { const k = Math.min(1, (now - t0) / 900); camera.position.lerpVectors(s, end, k * k * (3 - 2 * k)); controls.target.lerp(fitC, k); if (k >= 1) flyT = null } } } },
    setFilter(f) { filter = f; applyHighlight() },
    find(q) { q = q.trim().toLowerCase(); if (!q) return []; return [...N.values()].filter(n => !n.dead && n.l.toLowerCase().includes(q)).sort((a, b) => (a.l.toLowerCase().startsWith(q) ? 0 : 1) - (b.l.toLowerCase().startsWith(q) ? 0 : 1) || b.rdeg - a.rdeg).slice(0, 8).map(n => ({ id: n.id, l: n.l, color: colorOf(n), cluster: hubOf(n)?.name })) },
    hubs: () => hubs.map(h => ({ k: h.k, name: h.name, color: h.color, count: count(h.k), rule: h.rule, collapsed: collapsed.has(h.k) })),
    pause(p) { paused = p; run() }, resize: size,
    snap: (t = 'image/jpeg') => { composer.render(); return renderer.domElement.toDataURL(t, .9) }, // diagnostics: frame grab
    stats: () => ({ fps, tier, preset: S.pref('graph.preset'), bloomK: bloom.strength, labels: order.filter(id => !nodeEls.get(id)?.classList.contains('hid')).length, pr: renderer.getPixelRatio(), bloom: bloom.enabled, nodes: [...N.values()].filter(n => !n.dead).length, links: L.size, calls: renderer.info.render.calls, reduced, running: !!raf }),
    state: () => ({ cam: camera.position.toArray().map(v => +v.toFixed(2)), target: controls.target.toArray().map(v => +v.toFixed(2)), sel, collapsed: [...collapsed], mode, dim3, filter: !!filter }),
    dispose() { unPrefs(); cancelAnimationFrame(raf); raf = 0; ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', vis); controls.dispose(); composer.dispose?.();
      scene.traverse(o => { o.geometry?.dispose?.(); if (o.material && o.material !== fres && o.material !== halo && o.material !== lineMat) o.material.dispose?.() }); [fres, halo, lineMat, beamMat].forEach(m => m.dispose()); renderer.dispose(); renderer.forceContextLoss(); host.innerHTML = '' },
  };
}
