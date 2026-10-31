// Self-check for inv.js (Plugins & Skills inventory): front matter, static scan, risk level, read-only build.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), inv = require('./inv.js');

assert.deepStrictEqual(inv.front('---\nname: a-b\ndescription: "Say hi"\n---\nbody'), { name: 'a-b', description: 'Say hi' });
assert.strictEqual(inv.front('no front matter'), null);

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-'));
fs.writeFileSync(path.join(d, 'a.js'), "fetch('https://x')\nrequire('child_process').exec('ls')\nfs.rmSync('x')\n");
fs.mkdirSync(path.join(d, 'node_modules')); fs.writeFileSync(path.join(d, 'node_modules', 'b.js'), "fetch('https://y')\n");
const sc = inv.scan(d);
assert.strictEqual(sc.code, 1, 'node_modules skipped');
for (const k of ['net', 'exec', 'del']) assert.ok(sc.sig[k]?.n >= 1, k + ' found');
assert.ok(sc.sig.net.at[0].startsWith('a.js:'), 'sample has file:line');
fs.rmSync(d, { recursive: true });

assert.strictEqual(inv.level({ sig: {} }, 0, 0), 'clean');
assert.strictEqual(inv.level({ sig: { exec: {} } }, 0, 0), 'note');
assert.strictEqual(inv.level({ sig: { net: {} } }, 0, 0), 'note', 'net code that only runs when asked');
assert.strictEqual(inv.level({ sig: { net: {} } }, 1, 0), 'review', 'auto-run hook with net');
assert.strictEqual(inv.level({ sig: {} }, 0, 1), 'note', 'MCP server alone');

// Build must not write anything it reads from.
const P = path.join(os.homedir(), '.claude'), files = [path.join(P, 'settings.json'), path.join(P, 'plugins', 'installed_plugins.json')];
const before = files.map(f => fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);
const b = inv(true);
assert.ok(Array.isArray(b.plugins) && Array.isArray(b.skills) && Array.isArray(b.issues));
assert.deepStrictEqual(files.map(f => fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0), before, 'nothing modified');
// One entry per tool: a plugin's same-named skill, and identical copies of it elsewhere, fold into the plugin (a flag in the inventory; no file changes).
for (const s of b.skills.filter(s => !s.same)) assert.ok(!b.plugins.some(p => p.name.toLowerCase() === s.name.toLowerCase() && (s.owner === p.id || b.skills.some(k => k.same === p.id && k.description === s.description))), 'listed twice: ' + s.name);
for (const p of b.plugins) assert.strictEqual(p.copies.length, b.skills.filter(s => s.same === p.id).length);
console.log(`test-inv: all passed (${b.plugins.length} plugins, ${b.skills.length} skills, ${b.issues.length} issues)`);
