// Shared runtime for the React Bits background ports (react-shim.js + ogl/vgpu where used). Bundled by esbuild from the MIT React Bits sources.
// react-shim.js
var cur = null;
var slot = () => cur.hooks[cur.i++] ??= {};
var changed = (h2, deps) => !deps || !h2.deps || deps.length !== h2.deps.length || deps.some((d, k) => !Object.is(d, h2.deps[k]));
var Fragment = /* @__PURE__ */ Symbol("Fragment");
var h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });
function useRef(v) {
  const s = slot();
  return s.ref ??= { current: v };
}
function useState(init) {
  const s = slot(), inst = cur;
  if (!("val" in s)) {
    s.val = typeof init === "function" ? init() : init;
    s.set = (v) => {
      const n = typeof v === "function" ? v(s.val) : v;
      if (Object.is(n, s.val)) return;
      s.val = n;
      inst.queue();
    };
  }
  return [s.val, s.set];
}
function useMemo(fn, deps) {
  const s = slot();
  if (changed(s, deps)) {
    s.val = fn();
    s.deps = deps;
  }
  return s.val;
}
function useEffect(fn, deps) {
  const s = slot();
  if (changed(s, deps)) {
    s.deps = deps;
    cur.fx.push(() => {
      s.clean?.();
      s.clean = fn();
    });
  }
}
var UNITLESS = /^(opacity|zIndex|flex|flexGrow|flexShrink|fontWeight|lineHeight|order|zoom)$/;
function dom(v, inst, out) {
  if (v == null || v === false || v === true) return;
  if (Array.isArray(v)) return v.forEach((c) => dom(c, inst, out));
  if (typeof v !== "object") return void out.push(document.createTextNode(String(v)));
  if (v.type === Fragment) return v.children.forEach((c) => dom(c, inst, out));
  const k = inst.di++, old = inst.els[k], el = old?.localName === v.type ? old : inst.els[k] = document.createElement(v.type);
  for (const [p, x] of Object.entries(v.props)) {
    if (p === "children" || p === "key") continue;
    if (p === "ref") {
      typeof x === "function" ? x(el) : x && (x.current = el);
      continue;
    }
    if (p === "className") {
      el.className = x || "";
      continue;
    }
    if (p === "style") {
      el.removeAttribute("style");
      for (const [s, y] of Object.entries(x || {})) if (y != null) s.startsWith("--") ? el.style.setProperty(s, y) : el.style[s] = typeof y === "number" && !UNITLESS.test(s) ? y + "px" : y;
      continue;
    }
    if (/^on[A-Z]/.test(p)) {
      el[p.toLowerCase()] = x;
      continue;
    }
    x == null || x === false ? el.removeAttribute(p) : el.setAttribute(p === "htmlFor" ? "for" : p, x === true ? "" : x);
  }
  const kids = [];
  dom(v.children.length ? v.children : v.props.children, inst, kids);
  el.replaceChildren(...kids);
  out.push(el);
}
function mount(Comp, container, props = {}) {
  const inst = { hooks: [], els: [], i: 0, di: 0, fx: [], dead: false, root: null, q: false };
  const render = () => {
    if (inst.dead) return;
    inst.q = false;
    inst.i = 0;
    inst.di = 0;
    inst.fx = [];
    cur = inst;
    let tree;
    try {
      tree = Comp(props);
    } finally {
      cur = null;
    }
    const out = [];
    dom(tree, inst, out);
    if (!inst.root) {
      inst.root = out;
      container.append(...out);
    }
    inst.fx.forEach((f) => f());
  };
  inst.queue = () => {
    if (!inst.q) {
      inst.q = true;
      queueMicrotask(render);
    }
  };
  render();
  return { stop() {
    inst.dead = true;
    inst.hooks.forEach((s) => s.clean?.());
    inst.root?.forEach((n) => n.remove());
  } };
}

export {
  h,
  useRef,
  useState,
  useMemo,
  useEffect,
  mount
};
