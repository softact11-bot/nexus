// Installs the NEXUS Obsidian plugin into a vault: node install.js [vault folder]. Default: the open Obsidian vault that has MEMORY.md.
// Copies main.js, manifest.json, styles.css to <vault>/.obsidian/plugins/nexus and switches it on in community-plugins.json.
const fs = require('fs'), path = require('path');
const vaults = Object.values((() => { try { return JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'obsidian', 'obsidian.json'), 'utf8')).vaults } catch { return {} } })()).map(v => v.path);
const V = process.argv[2] || vaults.find(p => fs.existsSync(path.join(p, 'MEMORY.md'))) || vaults[0];
if (!V || !fs.existsSync(path.join(V, '.obsidian'))) { console.error('no Obsidian vault found'); process.exit(1) }
const D = path.join(V, '.obsidian', 'plugins', 'nexus'); fs.mkdirSync(D, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) fs.copyFileSync(path.join(__dirname, f), path.join(D, f));
const C = path.join(V, '.obsidian', 'community-plugins.json'); let on = []; try { on = JSON.parse(fs.readFileSync(C, 'utf8')) } catch { }
if (!on.includes('nexus')) { on.push('nexus'); fs.writeFileSync(C, JSON.stringify(on, null, 2)) }
console.log('installed', D, '- restart Obsidian or reload plugins to load it');
