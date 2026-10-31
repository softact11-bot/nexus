// Self-check: live graph patches on a temp copy of the vault. Add, rename, delete a note; add and remove a link.
// Replays every patch on a client-side copy and checks it equals the server state (no duplicates, dead links removed).
// Run: node test-knowledge.js   (never touches the real vault: NEXUS_VAULT/NEXUS_DATA point at a temp copy)
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const SRC = path.join(os.homedir(), 'Desktop', 'VAULT', 'My Vault');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-kg-')), V = path.join(T, 'vault');
fs.cpSync(SRC, V, { recursive: true, filter: s => !/[\\/]\./.test(s.slice(SRC.length)) && !fs.lstatSync(s).isSymbolicLink() });
process.on('exit', () => fs.rmSync(T, { recursive: true, force: true }));
fs.mkdirSync(path.join(V, '.obsidian'));
process.env.NEXUS_VAULT = V; process.env.NEXUS_DATA = T;
const K = require('./knowledge.js')._;

assert.strictEqual(K.refresh(), null, 'first refresh = snapshot');
const nodes = new Map([...K.cur.nodes].map(([k, n]) => [k, n])), links = new Map(K.cur.links), n0 = nodes.size, l0 = links.size;
const apply = p => {
  if (!p.add) return; // stats-only
  for (const n of [...p.add, ...p.update]) nodes.set(n.id, n);
  for (const id of p.remove) nodes.delete(id);
  for (const l of p.linksAdd) links.set(l.k, l);
  for (const k of p.linksRemove) links.delete(k);
};
const check = what => {
  const p = K.refresh(); apply(p);
  assert.deepStrictEqual([...nodes.keys()].sort(), [...K.cur.nodes.keys()].sort(), what + ': nodes');
  assert.deepStrictEqual([...links.keys()].sort(), [...K.cur.links.keys()].sort(), what + ': links');
  for (const l of links.values()) assert(nodes.has(l.a) && nodes.has(l.b), what + ': dead link ' + l.k);
  assert.strictEqual(new Set([...nodes.values()].map(n => n.p).filter(Boolean)).size, [...nodes.values()].filter(n => n.p).length, what + ': duplicate paths');
  return p;
};
const W = (f, t) => fs.writeFileSync(path.join(V, f), t), id = f => 'note_' + K.slug(f), linked = (a, b) => [...links.values()].some(l => l.r === 'references' && [l.a, l.b].includes(id(a)) && [l.a, l.b].includes(id(b)));

W('ZZ Test A.md', '# A\nSee [[ZZ Test B]].\n'); let p = check('add A');
assert(nodes.has(id('ZZ Test A')) && p.add.length >= 1 && !linked('ZZ Test A', 'ZZ Test B'));
W('ZZ Test B.md', '# B note\n'); check('add B');
assert(linked('ZZ Test A', 'ZZ Test B'), 'A→B link appears');
fs.renameSync(path.join(V, 'ZZ Test B.md'), path.join(V, 'ZZ Test C.md')); p = check('rename B→C');
assert(!nodes.has(id('ZZ Test B')) && nodes.has(id('ZZ Test C')) && !linked('ZZ Test A', 'ZZ Test B'), 'rename drops B and its link');
W('ZZ Test A.md', '# A\nSee [[ZZ Test C]] now.\n'); check('add link A→C');
assert(linked('ZZ Test A', 'ZZ Test C'));
W('ZZ Test A.md', '# A\nNo links here any more.\n'); check('remove link');
assert(!linked('ZZ Test A', 'ZZ Test C'));
fs.unlinkSync(path.join(V, 'ZZ Test A.md')); fs.unlinkSync(path.join(V, 'ZZ Test C.md')); check('delete A, C');
assert.strictEqual(nodes.size, n0); assert.strictEqual(links.size, l0);
assert.strictEqual(K.refresh().add, undefined, 'no change → stats-only patch');

console.log(`ok: ${n0} nodes, ${l0} links; add/rename/delete note + add/remove link replay clean, no duplicates, no dead links`);
