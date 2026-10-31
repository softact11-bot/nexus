// M2 preview: Projects page "Link vault & settings" form. Sample data only, no fetch, nothing saved (spec §26.6 gate b).
// The checks mirror config.validateLink / validateSettings so the wording matches what the real form will say.
import { esc } from './fmt.js';
const $ = id => document.getElementById(id);
const PROJ = { name: 'Haunted Arcade', dir: 'C:\\Users\\you\\Desktop\\Haunted Arcade' };
const VAULTS = [
  { n: 'Game Notes', p: 'C:\\Users\\you\\Documents\\Game Notes', ok: true, used: [['Spooky Tycoon', 'Spooky Tycoon']] },
  { n: 'Cloud Vault', p: 'C:\\Users\\you\\OneDrive\\Cloud Vault', ok: true, used: [], od: true },
  { n: 'Old Notes', p: 'C:\\Users\\you\\Documents\\Old Notes', ok: false, why: 'No .obsidian folder inside, so it is not an Obsidian vault.' }];
const SC = { ok: [0, 'Haunted Arcade'], clash: [0, 'Spooky Tycoon/Levels'], whole: [0, ''], nov: [2, ''], od: [1, 'Haunted Arcade'] };
let st = { v: 0, folder: 'Haunted Arcade', sync: 'manual', cmd: '', graph: 'builtin', out: '', active: false };

function checks() {
  const v = VAULTS[st.v], f = st.folder.trim().replace(/^[\\/]+|[\\/]+$/g, ''), L = [];
  if (!v.ok) return [['no', v.why]];
  L.push(['', 'Folder exists on this PC and belongs to you']); L.push(['', 'Obsidian vault (.obsidian found)']);
  if (f && f.split(/[\\/]/).some(x => x === '..' || x.startsWith('.'))) return [...L, ['no', 'The folder must be a plain folder inside the vault (no .., no hidden folders).']];
  const hit = v.used.find(([, uf]) => !f || uf.toLowerCase() === f.toLowerCase() || f.toLowerCase().startsWith(uf.toLowerCase() + '/') || uf.toLowerCase().startsWith(f.toLowerCase() + '/'));
  L.push(hit ? ['no', `"${hit[0]}" already uses ${f ? 'the folder ' + hit[1] : 'a folder in this vault'}. Pick a separate folder so the projects never mix.`] : ['', 'Not used by another project']);
  if (v.od) L.push(['warn', 'This vault is synced by OneDrive: its files can leave this PC through that sync.']);
  return L;
}
const seg = (name, cur, opts) => `<div class="lk-seg" role="radiogroup">${opts.map(([v, t]) => `<label><input type="radio" name="${name}" value="${v}"${v === cur ? ' checked' : ''}>${t}</label>`).join('')}</div>`;

function draw(msg = '') {
  const v = VAULTS[st.v], C = checks(), bad = C.some(c => c[0] === 'no'), f = st.folder.trim();
  $('lk-dlg').innerHTML = `<form method="dialog" class="lx-f">
  <div class="card-h"><h2 id="lk-t">Link vault &amp; settings · ${esc(PROJ.name)}</h2><div class="end"><button class="btn sm ghost" value="x" aria-label="Close">✕</button></div></div>
  <p class="muted sm">Where this project's notes live in Obsidian, how its docs sync and which graph it uses. Saving changes only NEXUS's own project list (backed up first). Your vault, Obsidian settings and Graphify data are never changed here.</p>
  <div class="pj-form">
    <section class="lk-sec"><h3>1 · Obsidian vault</h3>
      <div class="lk-vaults" role="radiogroup" aria-label="Vault">${VAULTS.map((x, i) => `<label class="lk-v${i === st.v ? ' on' : ''}${x.ok ? '' : ' off'}" title="${esc(x.ok ? x.p : x.why)}"><input type="radio" name="v" value="${i}"${i === st.v ? ' checked' : ''}${x.ok ? '' : ' disabled'}><b>${esc(x.n)}</b><small>${x.ok ? 'registered in Obsidian' : 'not a vault'}</small></label>`).join('')}
        <div class="lk-seg"><button class="btn sm" type="button" data-a="browse">Browse for another vault…</button><span class="muted sm">Read from Obsidian's vault list; NEXUS never edits it.</span></div></div>
      <label>Folder inside the vault <span class="muted sm">(empty = the whole vault)</span><input class="pj-in" name="folder" maxlength="120" value="${esc(st.folder)}" placeholder="e.g. Haunted Arcade"></label>
      <ul class="lk-checks" aria-live="polite">${C.map(([k, t]) => `<li class="${k}">${esc(t)}</li>`).join('')}</ul>
      ${v.ok ? `<div><small class="muted">Notes for this project will go to</small><div class="lk-path">${esc(v.p + (f ? '\\' + f.replace(/\//g, '\\') : ''))}</div></div>` : ''}</section>
    <section class="lk-sec"><h3>2 · Doc sync</h3>
      ${seg('sync', st.sync, [['off', 'Off'], ['manual', 'Manual (Sync button)'], ['auto', 'Automatic']])}
      <label>Custom sync command <span class="muted sm">(optional)</span><input class="pj-in" name="cmd" maxlength="300" value="${esc(st.cmd)}" placeholder="e.g. bash sync_docs.sh"></label>
      <p class="muted sm lk-note">${st.sync === 'auto' ? 'Automatic sync arrives with the built-in sync engine (M3); until then it behaves like Manual.' : 'A custom command runs in the project folder and always asks you first.'}</p></section>
    <section class="lk-sec"><h3>3 · Knowledge graph</h3>
      ${seg('graph', st.graph, [['builtin', 'Built-in (no extra installs)'], ['graphify', 'Graphify']])}
      ${st.graph === 'graphify' ? `<label>Graphify output folder<input class="pj-in" name="out" maxlength="260" value="${esc(st.out)}" placeholder="${esc(PROJ.dir)}\\graphify-out"></label><p class="muted sm lk-note">NEXUS only reads this graph. It must be inside this project or your NEXUS data folder.</p>` : '<p class="muted sm lk-note">The built-in graph arrives in M3; until then the page shows the current graph.</p>'}</section>
    <label class="px-ack"><input type="checkbox" name="active"${st.active ? ' checked' : ''}> Make this the active project (Knowledge, Automation and Home follow it)</label>
  </div>
  <div class="lx-fa"><button class="btn ghost" type="button" data-a="unlink">Unlink vault</button><button class="btn ghost" value="x">Cancel</button><button class="btn pri" type="button" data-a="save"${bad ? ' disabled' : ''}>Save link</button></div>
  ${msg ? `<p class="muted sm lk-toast" role="status">${esc(msg)}</p>` : ''}</form>`;
}
function scenario(k) { const [v, f] = SC[k]; st = { ...st, v, folder: f }; draw() }
$('lk-dlg').addEventListener('input', e => { const t = e.target;
  if (t.name === 'v') st.v = +t.value; else if (t.name === 'active') st.active = t.checked; else if (t.name in st) st[t.name] = t.value;
  if (t.type === 'radio' || t.type === 'checkbox') draw(); else { const C = checks(); $('lk-dlg').querySelector('.lk-checks').innerHTML = C.map(([k, x]) => `<li class="${k}">${esc(x)}</li>`).join(''); $('lk-dlg').querySelector('[data-a="save"]').disabled = C.some(c => c[0] === 'no');
    const p = $('lk-dlg').querySelector('.lk-path'); if (p) p.textContent = VAULTS[st.v].p + (st.folder.trim() ? '\\' + st.folder.trim().replace(/\//g, '\\') : '') } });
$('lk-dlg').addEventListener('click', e => { const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
  if (a === 'save') draw('Preview: nothing saved. The real form saves to projects.json after a backup.');
  if (a === 'unlink') { st.folder = ''; draw('Preview: the real Unlink removes only the link in NEXUS; the vault and its notes stay.') }
  if (a === 'browse') draw('Preview: the real button opens the Windows folder picker; the folder then goes through the same checks.') });
$('lk-sc').onchange = e => { scenario(e.target.value); if (!$('lk-dlg').open) $('lk-dlg').showModal() };
$('lk-open').onclick = () => { draw(); $('lk-dlg').showModal() };
window.LK = { scenario, checks, st: () => st };
draw(); $('lk-dlg').showModal();
