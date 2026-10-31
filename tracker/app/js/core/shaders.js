// GLSL (WebGL2). All motion happens here; the CPU only sends a few uniforms per frame.
const HEAD = `#version 300 es
precision highp float;
uniform vec2 uRes, uC; uniform float uS, uD, uT, uLift; uniform mat3 uCam, uRot;
// homogeneous perspective: sphere centre lands on uC (buffer px), radius 1 = uS px at depth 0
vec4 proj(vec3 c) {
  float z = c.z + uD;
  vec2 s = vec2(uC.x * z + c.x * uS * uD, uC.y * z - c.y * uS * uD);
  return vec4(s.x / uRes.x * 2.0 - z, z - s.y / uRes.y * 2.0, 0.0, z);
}
vec3 wob(vec3 p, float k) { return p + k * vec3(sin(uT * .7 + p.y * 13.1 + p.z * 7.0), sin(uT * .9 + p.z * 11.3 + p.x * 5.0), sin(uT * .8 + p.x * 9.7 + p.y * 3.0)); }
// network position in view space (floating lift applied before the camera)
vec3 net(vec3 p) { return uCam * (uRot * p + vec3(0.0, uLift, 0.0)); }
`;

export const POINTS = [HEAD + `
in vec3 aP; in vec3 aK; // size, kind, rnd
uniform float uBreath, uPulse, uSizeK, uBright, uDpr; uniform vec3 uCol1, uCol2;
out vec3 vCol; out float vA, vHot;
void main() {
  bool dust = aK.y > 1.5 && aK.y < 2.5, core = aK.y > .5 && aK.y < 1.5;
  vec3 p = wob(aP * uBreath, dust ? .06 : core ? .02 : .004);
  vec3 c = net(p);
  gl_Position = proj(c);
  float z = c.z + uD, r = length(aP);
  float depth = clamp((c.z - uCam[1].z * uLift + 1.05) / 2.1, 0.0, 1.0);
  float rim = smoothstep(.72, 1.0, length(c.xy - (uCam * vec3(0.0, uLift, 0.0)).xy)) * step(.9, r);
  float wave = uPulse < 2.2 ? exp(-pow((r - uPulse * .95) * 6.0, 2.0)) : 0.0;
  float tw = .7 + .3 * sin(uT * (1.2 + aK.z * 2.0) + aK.z * 40.0);
  vHot = aK.x > 3.0 ? 1.0 : 0.0;
  vec3 col = mix(uCol1, uCol2, aK.z * .8);
  vCol = core ? mix(col, vec3(1.0), .35 * (1.0 - r / .5)) : col;
  float fade = mix(1.15, .16, depth * depth);
  vA = (fade * (1.0 + rim * 1.1) * tw * uBright + wave * .9) * (dust ? .28 : core ? .55 : aK.y > 2.5 ? .7 : 1.0);
  gl_PointSize = max(1.0, aK.x * uSizeK * uDpr * uD / z * (1.0 + wave * .6));
}`, `#version 300 es
precision highp float;
in vec3 vCol; in float vA, vHot; out vec4 o;
void main() {
  float d = length(gl_PointCoord - .5) * 2.0;
  float a = exp(-d * d * 6.0) + .25 * exp(-d * d * 1.8);
  vec3 c = mix(vCol, vec3(1.0), vHot * exp(-d * d * 22.0) * .8);
  o = vec4(c * a * vA, 0.0);
}`];

export const LINES = [HEAD + `
in vec4 aP; in vec2 aK; // xyz + alpha | s along arc, arc rnd
uniform float uBreath, uLine; uniform vec3 uCol1, uCol2;
out vec3 vCol; out vec2 vS;
void main() {
  vec3 c = net(wob(aP.xyz * uBreath, .004));
  gl_Position = proj(c);
  float depth = clamp((c.z - uCam[1].z * uLift + 1.05) / 2.1, 0.0, 1.0);
  float rim = smoothstep(.75, 1.0, length(c.xy - (uCam * vec3(0.0, uLift, 0.0)).xy));
  vCol = mix(uCol1, uCol2, aK.y * .7) * aP.w * mix(1.0, .1, depth * depth) * (1.0 + rim * .8) * uLine;
  vS = aK;
}`, `#version 300 es
precision highp float;
in vec3 vCol; in vec2 vS; uniform float uT; out vec4 o;
void main() {
  // travelling signal on ~35% of the arcs
  float head = fract(vS.y * 7.13 + uT * (.08 + .1 * fract(vS.y * 3.7))) * 1.6 - .3;
  float sig = exp(-pow((vS.x - head) * 9.0, 2.0)) * step(.65, fract(vS.y * 13.7));
  o = vec4(vCol * (1.0 + sig * 3.0), 0.0);
}`];

// Platform + rings: one band mesh drawn as flat rings (uH = 0) or vertical walls (uH > 0).
export const BAND = [HEAD + `
in vec2 aB; // angle, t across
uniform float uR0, uR1, uY, uH, uSpin;
out vec2 vB;
void main() {
  float a = aB.x + uSpin;
  vec3 p = uH > 0.0 ? vec3(cos(a) * uR0, uY + aB.y * uH, sin(a) * uR0) : vec3(cos(a), 0.0, sin(a)) * mix(uR0, uR1, aB.y) + vec3(0.0, uY, 0.0);
  gl_Position = proj(uCam * p);
  vB = aB;
}`, `#version 300 es
precision highp float;
in vec2 vB; uniform int uType; uniform float uN, uA, uT; uniform vec3 uCol; out vec4 o;
void main() {
  float t = vB.y, soft = exp(-pow((t - .5) * 3.6, 2.0)), a = 0.0;
  float u = vB.x * uN / 6.28318, w = fwidth(u);
  if (uType == 0) a = soft;                                                          // glow band
  else if (uType == 1) a = soft * smoothstep(.62 + w, .62 - w, fract(u));             // dashes
  else if (uType == 2) a = smoothstep(.12 + w, .12 - w, abs(fract(u) - .5)) * soft;                        // dots
  else if (uType == 3) {                                                              // disc: dark centre, fine rings, faint edge
    float rings = pow(.5 + .5 * cos(t * 90.0), 24.0);
    a = .03 + .25 * pow(t, 4.0) + rings * .12 * smoothstep(.15, 1.0, t) + .12 * exp(-t * 7.0);
  } else {                                                                            // wall: bright lip, slits fading down
    a = pow(t, 3.0) * (.45 + .55 * step(.35, fract(u))) + .05;
  }
  o = vec4(uCol * a * uA, 0.0);
}`];

// Floor grid at y = uY: only a small pool of light around the platform.
export const GRID = [HEAD + `
in vec2 aQ; uniform float uY; out vec2 vW;
void main() { vW = vec2(mix(-7.0, 7.0, aQ.x), mix(-4.0, 7.0, aQ.y)); gl_Position = proj(uCam * vec3(vW.x, uY, vW.y)); }`, `#version 300 es
precision highp float;
in vec2 vW; uniform vec3 uCol; uniform float uA; out vec4 o;
void main() {
  vec2 g = vW / .5, f = abs(fract(g - .5) - .5) / fwidth(g);
  float line = 1.0 - min(min(f.x, f.y), 1.0);
  float d = length(vW), fade = smoothstep(5.0, .8, d);
  o = vec4(uCol * (line * .35 * fade + exp(-d * d * .35) * .5) * uA, 0.0);
}`];

// Screen-space sprites: 0 soft glow, 1 light beam, 2 thin ring with arcs, 3 sphere rim (fresnel).
export const SPRITE = [`#version 300 es
in vec2 aQ; uniform vec2 uRes, uPos, uSize; out vec2 vQ;
void main() { vQ = aQ * 2.0 - 1.0; vec2 p = uPos + vQ * uSize; gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0); }`, `#version 300 es
precision highp float;
in vec2 vQ; uniform vec3 uCol; uniform float uA, uR, uW, uN, uFill, uSpin; uniform int uShape; out vec4 o;
void main() {
  float a, d = length(vQ);
  if (uShape == 1) a = pow(max(0.0, 1.0 - abs(vQ.x)), 2.5) * smoothstep(-1.0, .9, vQ.y) * smoothstep(1.0, .8, vQ.y);
  else if (uShape == 2) {
    float ang = fract(atan(vQ.y, vQ.x) / 6.28318 + uSpin) * uN, f = fract(ang), aw = fwidth(ang);
    float m = uN > 0.0 ? smoothstep(0.0, aw * 2.0, f) * smoothstep(uFill, uFill - aw * 2.0, f) : 1.0;
    a = exp(-pow((d - uR) / uW, 2.0)) * m;
  }
  else if (uShape == 3) a = (d < uR ? pow(d / uR, 8.0) * .22 : 0.0) + exp(-pow((d - uR) / uW, 2.0));
  else a = exp(-d * d * 3.2);
  o = vec4(uCol * a * uA, 0.0);
}`];

// Post: copy / blur / composite.
const QV = `#version 300 es
in vec2 aQ; out vec2 vU; void main() { vU = aQ; gl_Position = vec4(aQ * 2.0 - 1.0, 0.0, 1.0); }`;
export const BLUR = [QV, `#version 300 es
precision highp float;
in vec2 vU; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main() {
  vec3 c = texture(uTex, vU).rgb * .227;
  c += (texture(uTex, vU + uDir * 1.385).rgb + texture(uTex, vU - uDir * 1.385).rgb) * .316;
  c += (texture(uTex, vU + uDir * 3.231).rgb + texture(uTex, vU - uDir * 3.231).rgb) * .070;
  o = vec4(c, 1.0);
}`];
export const COMP = [QV, `#version 300 es
precision highp float;
in vec2 vU; uniform sampler2D uScene, uBloom, uBloom2; uniform float uBloomK, uBloomOn; out vec4 o;
void main() {
  vec3 c = texture(uScene, vU).rgb + (texture(uBloom, vU).rgb * .9 + texture(uBloom2, vU).rgb * 1.1) * uBloomK * uBloomOn;
  c = 1.0 - exp(-c * 1.25);              // soft tone curve: bright cores stay smooth, no harsh clipping
  float a = clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0);
  o = vec4(c, a);                        // premultiplied: glow adds over the page
}`];
