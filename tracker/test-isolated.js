// Real end-to-end test of My Catalog + installs in a throwaway Claude Code config (CLAUDE_CONFIG_DIR) and data folder (NEXUS_DATA).
// Uses the network (GitHub + marketplace clone). Never touches ~/.claude: checked at the end by comparing its plugin files.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cfg-')), D = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-data-'));
process.env.CLAUDE_CONFIG_DIR = T; process.env.NEXUS_DATA = D;
try { fs.copyFileSync(path.join(__dirname, 'repo-cache.json'), path.join(D, 'repo-cache.json')) } catch { } // reuse repo checks: GitHub allows 60 unauthenticated API calls an hour
const real = ['plugins/installed_plugins.json', 'plugins/known_marketplaces.json', 'settings.json'].map(f => path.join(os.homedir(), '.claude', f)), stamp = () => real.map(f => fs.statSync(f).mtimeMs).join();
const before = stamp(), C = require('./catalog.js'), O = require('./pluginops.js'), inv = () => require('./inv.js')(true);
const wait = async () => { for (let i = 0; i < 300; i++) { const j = O.status().job; if (j.state !== 'running') return j; await new Promise(r => setTimeout(r, 1000)) } throw Error('job timeout') };
const act = async o => { const p = O.post({ op: 'prepare', ...o }); assert.strictEqual(p.res, 'ok', JSON.stringify(o) + ': ' + p.res); console.log('   steps:', p.steps.join(' ; '));
  const r = O.post({ op: 'run', token: p.token }); assert.strictEqual(r.res, 'ok'); const j = await wait(); console.log(`   ${o.action} → ${j.state} (verified ${j.verified}): ${j.message}`); assert.strictEqual(j.state, 'done', j.message); return j };
const ok = (name, f) => f().then(() => console.log('PASS', name));
(async () => {
  assert.deepStrictEqual(C.load().items, [], 'catalog starts empty');
  await ok('add plugin by GitHub link', async () => { const r = await C.post({ op: 'add', source: 'https://github.com/DietrichGebert/ponytail', from: 'url' }); assert.strictEqual(r.res, 'ok', r.res) });
  await ok('duplicate refused', async () => { assert.match((await C.post({ op: 'add', source: 'DietrichGebert/ponytail' })).res, /already in My Catalog/) });
  await ok('saved to disk', async () => { assert.strictEqual(JSON.parse(fs.readFileSync(path.join(D, 'my-catalog.json'))).items[0].id, 'ponytail@ponytail') });
  await ok('install refused when not in catalog', async () => { assert.match(O.post({ op: 'prepare', action: 'install', key: 'plugin:nope@nope' }).res, /not in My Catalog/) });
  await ok('install plugin (marketplace add + install)', async () => { await act({ action: 'install', key: 'plugin:ponytail@ponytail' }); assert(inv().plugins.some(p => p.id === 'ponytail@ponytail')) });
  await ok('disable', () => act({ action: 'disable', id: 'ponytail@ponytail' }));
  await ok('enable', () => act({ action: 'enable', id: 'ponytail@ponytail' }));
  await ok('remove from catalog keeps it installed', async () => { assert.strictEqual(C.post({ op: 'remove', key: 'plugin:ponytail@ponytail' }).res, 'ok'); assert(inv().plugins.some(p => p.id === 'ponytail@ponytail')) });
  await ok('uninstall', async () => { await act({ action: 'uninstall', id: 'ponytail@ponytail' }); assert(!inv().plugins.some(p => p.id === 'ponytail@ponytail')) });
  const SK = 'skill:vo1dleaf/roblox-claude-kit', dest = path.join(T, 'skills', 'roblox-claude-kit');
  await ok('add skill', async () => { const r = await C.post({ op: 'add', source: 'vo1dleaf/roblox-claude-kit', from: 'review' }); assert.strictEqual(r.res, 'ok', r.res); assert.strictEqual(C.load().decisions['vo1dleaf/roblox-claude-kit'].state, 'approved') });
  await ok('install skill (clone + copy)', async () => { await act({ action: 'install', key: SK }); assert(fs.existsSync(path.join(dest, 'SKILL.md')) && fs.existsSync(path.join(dest, '.nexus-source.json')) && !fs.existsSync(path.join(dest, '.git'))) });
  await ok('skill shows in inventory', async () => { assert(inv().skills.some(s => s.name === 'roblox-claude-kit' && s.source === 'custom')); assert.strictEqual(O.status().states[SK], 'installed') });
  await ok('skill update check (ls-remote)', async () => { const r = await O.post({ op: 'skillUpdates' }); assert.strictEqual(r.skills[SK].update, false, JSON.stringify(r.skills[SK])) });
  await ok('skill update (fresh copy, old kept)', () => act({ action: 'update', key: SK }));
  await ok('skill uninstall moves to removed-skills', async () => { const j = await act({ action: 'uninstall', key: SK }); assert(!fs.existsSync(dest)); assert(fs.readdirSync(path.join(D, 'removed-skills')).length >= 2) });
  await ok('never overwrites a folder NEXUS did not install', async () => { fs.mkdirSync(dest, { recursive: true }); assert.match(O.post({ op: 'prepare', action: 'install', key: SK }).res, /already exists \(not from NEXUS\)/);
    assert.match(O.post({ op: 'prepare', action: 'uninstall', key: SK }).res, /wasn't installed by NEXUS/); fs.rmSync(dest, { recursive: true }) });
  await ok('manual items never run', async () => { assert.strictEqual((await C.post({ op: 'add', source: 'rtk-ai/rtk' })).res, 'ok'); assert.match(O.post({ op: 'prepare', action: 'install', key: 'app:rtk-ai/rtk' }).res, /doesn't install this type/) });
  await ok('repo validation errors', async () => { assert.match((await C.post({ op: 'validate', source: 'https://gitlab.com/a/b' })).res, /Not a GitHub link/); const r = (await C.post({ op: 'validate', source: 'nexus-test-zz/does-not-exist-zz' })).res; assert.match(r, /doesn't exist|limit for checks/); console.log('   missing repo →', r) });
  await ok('your real ~/.claude untouched', async () => assert.strictEqual(stamp(), before));
  console.log('test-isolated: all passed');
})().catch(e => { console.error('FAIL', e.message); process.exitCode = 1 }).finally(() => { for (const d of [T, D]) try { fs.rmSync(d, { recursive: true, force: true }) } catch { } });
