// Self-check for pluginops.js guards: action/id validation and token gate. Runs nothing (no CLI call).
const assert = require('assert'), o = require('./pluginops.js');
assert.strictEqual(o.check('nuke', 'a@b'), 'unknown action');
assert.strictEqual(o.check('__proto__', 'a@b'), 'unknown action');
assert.strictEqual(o.check('install', '../x@y'), 'bad plugin id');
assert.strictEqual(o.check('install', 'a@b --yes'), 'bad plugin id');
assert.strictEqual(o.check('install', 'zz-none@nowhere'), 'not in your local marketplace catalogs');
assert.strictEqual(o.check('uninstall', 'zz-none@nowhere'), 'not an installed Claude Code plugin');
assert.strictEqual(o.post({ op: 'run', token: 'x' }).res, 'confirmation expired: open the preview again');
assert.strictEqual(o.post({ op: 'zap' }).res, 'unknown op');
console.log('test-pluginops: all passed');
