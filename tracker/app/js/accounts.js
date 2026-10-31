// NEXUS accounts UI (post-M7 Phase 14): login screen, account button + menu, Switch account dialog (Ctrl+Shift+A), Manage, Privacy.
// Backend: /api/accounts (accounts.js). Switching saves this page's localStorage to the old account, loads the new one's, reloads.
const G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
const IC = { sw: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>', add: '<circle cx="10" cy="8" r="4"/><path d="M3 21c0-4 3-6 7-6M19 14v6M16 17h6"/>', man: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>', priv: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const ini = a => esc((String(a.name || a.email || '?').match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase());
const av = (a, i) => `<span class="ac-av k${i % 4}" aria-hidden="true">${ini(a)}</span>`;
const sub = a => a.kind === 'local' ? 'No account · this PC only' : esc(a.email) + ' · Google' + (a.out ? ' · signed out' : '');
const api = (o) => fetch('/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }).then(r => r.json()).catch(() => ({ res: 'NEXUS could not reach its local service. Try again.' }));
const get = () => fetch('/api/accounts', { cache: 'no-store' }).then(r => r.json());
const snap = () => { const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k) } } catch { } return o };
function apply(ui) { // ui null = keep this page's storage (first move into the original data)
  if (ui) try { localStorage.clear(); for (const [k, v] of Object.entries(ui)) localStorage.setItem(k, v) } catch { }
  location.reload();
}
// Google did not confirm the revoke (offline, error, or no key stored): say so, never claim access was removed.
function revokeWarn(r, done, then) {
  const D = open(`<div class="ac-card ac-dlg" role="alertdialog" aria-modal="true" aria-labelledby="ac-rt" aria-describedby="ac-rd"><div class="ac-hd"><h2 id="ac-rt">Google access may still be active</h2></div>
    <p id="ac-rd" class="ac-mu">${esc(r.email)} ${done} and its sign-in key was deleted from this PC, but Google did not confirm that NEXUS's access was removed${r.revoke === 'none' ? ' (no sign-in key was stored here to revoke)' : ' (no connection, or Google refused the request)'}. To be sure, remove NEXUS in your Google Account → Security → Third-party apps &amp; services:</p>
    <p class="ac-mu" style="margin-top:8px;word-break:break-all">myaccount.google.com/connections</p>
    <div class="ac-2" style="margin-top:16px"><button class="ac-b" data-a="open">Open Google settings</button><button class="ac-b pri" data-a="ok">OK</button></div></div>`, 'ac-dim');
  D.querySelector('[data-a=open]').onclick = () => api({ op: 'perms' });
  D.querySelector('[data-a=ok]').onclick = then;
  D.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); then() } }, true);
  D.querySelector('[data-a=ok]').focus();
}
let S = null, poll = 0, layer = null, back = null;
const cur = () => S?.list.find(a => a.id === S.cur);

function shut() { layer?.remove(); layer = null; clearInterval(poll); poll = 0; const b = back; back = null; b?.focus?.() }
function open(html, cls) { shut(); back = document.activeElement; layer = document.createElement('div'); layer.className = cls; layer.innerHTML = html; document.body.append(layer);
  layer.addEventListener('keydown', e => { if (e.key === 'Escape' && !layer.classList.contains('ac-login')) { e.preventDefault(); shut() } trap(e) }); return layer }
function trap(e) { if (e.key !== 'Tab' || !layer) return; const f = [...layer.querySelectorAll('button:not(:disabled),[tabindex="0"]')].filter(x => x.offsetParent); if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus() } else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus() } }

// Google sign-in: the backend opens the system browser; this page waits for the loopback callback, then switches.
async function google(L, hint) {
  const w = L.querySelector('.ac-wait'), err = L.querySelector('.ac-err'); err.textContent = '';
  const x = await api({ op: 'google', hint }); if (x.res !== 'ok') { err.textContent = x.res; return }
  wait(L, x.url);
}
function wait(L, url) { // also used by login() to resume a sign-in that was open or finished when the page reloaded
  const w = L.querySelector('.ac-wait'), err = L.querySelector('.ac-err'), ag = w.querySelector('.ac-again');
  w.hidden = false; ag.hidden = !url; ag.onclick = () => window.open(url, '_blank', 'noopener');
  w.querySelector('.ac-cancel').onclick = () => { api({ op: 'cancel' }); w.hidden = true; clearInterval(poll) };
  clearInterval(poll); poll = setInterval(async () => {
    const s = await get().catch(() => null), f = s?.flow; if (!f || f.st === 'wait') return;
    clearInterval(poll); w.hidden = true;
    if (f.st === 'error') { if (f.msg !== 'Sign-in cancelled.') err.textContent = f.msg; return }
    const r = await api({ op: 'switch', id: f.id, ui: snap() }); r.res === 'ok' ? apply(r.ui) : err.textContent = r.res;
  }, 1000);
}
const waitBox = '<div class="ac-wait" hidden role="status"><span>Finish signing in in your browser. NEXUS continues here by itself.</span><span><button class="ac-link ac-again">Open the Google page again</button> · <button class="ac-link ac-cancel">Cancel</button></span></div><div class="ac-err" role="alert"></div>';

function login() {
  const L = open(`<div class="ac-card ac-lgc" role="dialog" aria-modal="true" aria-labelledby="ac-lt">
    <div class="ac-brand"><img src="img/nexus-logo.png" alt=""><b>NEXUS</b></div>
    <h1 id="ac-lt">Sign in to NEXUS</h1><p class="ac-mu">Each account gets its own chats, memory, tasks and settings on this PC.${S.first ? ' Your current NEXUS chats and settings go to the first account you choose.' : ''}</p>
    ${S.google === false ? '' : `<button class="ac-b g" data-a="g">${G}Continue with Google</button>
    <div class="ac-or">or</div>`}
    <button class="ac-b" data-a="l">Use NEXUS without an account</button>
    ${waitBox}
    <div class="ac-box"><ul class="ac-ck">
      ${S.google === false ? '' : "<li>Your browser opens Google's own sign-in page. NEXUS never sees your Google password.</li>"}
      <li>NEXUS only keeps your name and email.</li>
      <li>Profiles and settings stay on this PC. Nothing is synced to a cloud.</li>
      ${S.google === false ? '' : '<li>The sign-in key is locked in Windows Credential Manager, never saved in a file.</li>'}</ul></div>
    <div class="ac-foot"><span>Other sign-in methods come later</span><button class="ac-link" data-a="p">Privacy details</button></div></div>`, 'ac-login');
  const gb = L.querySelector('[data-a=g]'); if (gb) gb.onclick = () => google(L); // no Google button when this install has no client secret
  L.querySelector('[data-a=l]').onclick = async () => { const r = await api({ op: 'local', ui: snap() }); r.res === 'ok' ? apply(r.ui) : L.querySelector('.ac-err').textContent = r.res };
  L.querySelector('[data-a=p]').onclick = () => privacy(true);
  (gb || L.querySelector('button'))?.focus();
  if (S.flow?.st === 'wait' || S.flow?.st === 'done') wait(L);
}

function dialog(manage) {
  const c = cur(); let pick = c?.id;
  const D = open(`<div class="ac-card ac-dlg" role="dialog" aria-modal="true" aria-labelledby="ac-st">
    <div class="ac-hd"><h2 id="ac-st">${manage ? 'Manage accounts' : 'Switch account'}</h2><button class="ac-close" aria-label="Close">×</button></div>
    <p class="ac-mu">${manage ? 'Remove an account from this PC: its sign-in key and its own chats, memory, tasks and settings are deleted. The account you use now cannot be removed.' : 'Pick who is using NEXUS. Each account has its own chats, memory, tasks and settings. Usage, sessions and projects come from this PC\'s Claude Code and are shared.'}</p>
    <div class="ac-list" role="${manage ? 'list' : 'radiogroup'}" aria-label="Accounts">${S.list.map((a, i) => `<${manage ? 'div' : 'button'} class="ac-row" ${manage ? 'role="listitem"' : `role="radio" aria-checked="${a.id === pick}" tabindex="${a.id === pick ? 0 : -1}"`} data-id="${esc(a.id)}">${av(a, i)}<div><b>${esc(a.name)}</b><small class="ac-mu">${sub(a)}</small></div>${a.id === S.cur ? '<span class="ac-chip cur">Current</span>' : a.kind === 'local' ? '<span class="ac-chip">Local</span>' : ''}${manage && a.id !== S.cur && !a.legacy ? `<button class="ac-rm" data-rm="${esc(a.id)}">Remove</button>` : ''}</${manage ? 'div' : 'button'}>`).join('')}</div>
    ${manage ? '' : `<div class="ac-2"><button class="ac-b" data-a="add">+ Add account</button><button class="ac-b pri" data-a="go"></button></div>`}
    ${waitBox}
    ${manage ? '' : '<div class="ac-warn"><span aria-hidden="true">⚠</span><span>Switching stops a running assistant answer and the microphone, then reloads NEXUS.</span></div>'}</div>`, 'ac-dim');
  D.addEventListener('mousedown', e => { if (e.target === D) shut() });
  D.querySelector('.ac-close').onclick = shut;
  const err = D.querySelector('.ac-err');
  if (manage) {
    for (const b of D.querySelectorAll('[data-rm]')) b.onclick = async () => {
      const a = S.list.find(x => x.id === b.dataset.rm); if (!confirm(`Remove ${a.name} from this PC? Its chats, memory, tasks and settings on this PC are deleted. This cannot be undone.`)) return;
      const r = await api({ op: 'remove', id: a.id }); if (r.res !== 'ok') { err.textContent = r.res; return } S = await get();
      r.revoke && r.revoke !== 'ok' ? revokeWarn(r, 'was removed from NEXUS', () => dialog(true)) : dialog(true) };
    D.querySelector('.ac-close').focus(); return;
  }
  const go = D.querySelector('[data-a=go]'), rows = [...D.querySelectorAll('.ac-row')];
  const sel = id => { pick = id; for (const r of rows) { const on = r.dataset.id === id; r.setAttribute('aria-checked', on); r.tabIndex = on ? 0 : -1 } const a = S.list.find(x => x.id === id);
    go.disabled = !a || id === S.cur; go.textContent = !a || id === S.cur ? 'Current account' : a.out ? `Sign in as ${a.name}` : `Switch to ${a.name}` };
  rows.forEach((r, i) => { r.onclick = () => sel(r.dataset.id); r.onkeydown = e => { const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]; if (!d) return; e.preventDefault(); const n = rows[(i + d + rows.length) % rows.length]; sel(n.dataset.id); n.focus() } });
  sel(pick);
  go.onclick = async () => {
    const a = S.list.find(x => x.id === pick); if (!a) return; err.textContent = ''; go.disabled = true;
    const r = await api({ op: 'switch', id: a.id, ui: snap() }); go.disabled = false;
    if (r.res === 'ok') return apply(r.ui);
    if (r.res === 'signin') { err.textContent = `Google needs you to sign in to ${a.email} again.`; return google(D, a.email) }
    err.textContent = r.res;
  };
  const ab = D.querySelector('[data-a=add]'); if (S.google === false) ab.hidden = true; else ab.onclick = () => google(D);
  (rows.find(r => r.tabIndex === 0) || go).focus();
}

function privacy(fromLogin) {
  const keep = fromLogin ? layer : null; if (keep) { layer = null } // the login screen stays underneath
  const D = open(`<div class="ac-card ac-dlg" role="dialog" aria-modal="true" aria-labelledby="ac-pt"><div class="ac-hd"><h2 id="ac-pt">Privacy &amp; data on this PC</h2><button class="ac-close" aria-label="Close">×</button></div>
    <ul><li>Accounts live only on this PC, in the NEXUS data folder. Nothing is uploaded or synced.</li>
    <li>Google sign-in happens in your own browser on Google's page. NEXUS gets your name, email and a sign-in key, never your password.</li>
    <li>The sign-in key is kept in Windows Credential Manager for this Windows user. Sign out asks Google to revoke it and deletes it here; if Google does not confirm, NEXUS tells you.</li>
    <li>Each account has its own assistant chats, remembered notes, tasks, attachments and settings. Usage, sessions, projects and automations come from this PC's Claude Code and are shared.</li>
    <li>Accounts keep things apart for convenience; they are not a lock. Anyone using this Windows user can open every account's data. Different people should use their own Windows user.</li>
    <li>Remove an account in Manage accounts to delete its data from this PC. You can also remove NEXUS's access at myaccount.google.com → Security → Third-party connections.</li></ul></div>`, 'ac-dim');
  const done = () => { shut(); if (keep) { layer = keep; keep.querySelector('[data-a=g]')?.focus() } };
  D.querySelector('.ac-close').onclick = done; D.addEventListener('mousedown', e => { if (e.target === D) done() });
  D.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); done() } }, true);
  D.querySelector('.ac-close').focus();
}

function menu(btn) {
  const c = cur(), r = btn.getBoundingClientRect();
  const M = open(`<div class="ac-card ac-menu" role="menu" aria-label="Account" style="top:${Math.round(r.bottom + 8)}px;right:${Math.max(8, Math.round(innerWidth - r.right))}px">
    <div class="ac-mh">${av(c, S.list.indexOf(c))}<div><b>${esc(c.name)}</b><small class="ac-mu">${c.kind === 'google' ? esc(c.email) : 'No account'}</small><small class="ac-mu">${c.kind === 'google' ? 'Signed in with Google · this PC' : 'Local profile · this PC'}</small></div></div><hr>
    ${[['sw', 'Switch account', '<kbd>Ctrl+Shift+A</kbd>'], ['add', 'Add account'], ['man', 'Manage accounts'], ['priv', 'Privacy &amp; data on this PC']].map(([k, t, x = '']) => `<button class="ac-mi" role="menuitem" data-m="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg><span>${t}</span>${x}</button>`).join('')}<hr>
    <button class="ac-mi out" role="menuitem" data-m="out"><svg viewBox="0 0 24 24" aria-hidden="true">${IC.out}</svg><span>Sign out</span></button>
    <div class="ac-note">${c.kind === 'google' ? 'Sign out removes the sign-in key from this PC. ' : ''}Your chats and settings stay until you remove the account in Manage accounts.</div></div>`, 'ac-menu-l');
  const items = [...M.querySelectorAll('.ac-mi')]; items[0].focus();
  M.addEventListener('keydown', e => { const i = items.indexOf(document.activeElement), d = { ArrowDown: 1, ArrowUp: -1 }[e.key]; if (d) { e.preventDefault(); items[(i + d + items.length) % items.length].focus() } });
  const away = e => { if (!M.contains(e.target) && e.target !== btn) { removeEventListener('mousedown', away, true); if (layer === M) shut() } }; addEventListener('mousedown', away, true);
  M.onclick = async e => { const k = e.target.closest('[data-m]')?.dataset.m; if (!k) return; removeEventListener('mousedown', away, true);
    if (k === 'sw') dialog(); else if (k === 'man') dialog(true); else if (k === 'priv') privacy(); else if (k === 'add') { dialog(); google(layer) }
    else if (k === 'out') { shut(); const x = await api({ op: 'signout', ui: snap() }); if (x.res !== 'ok') return;
      x.revoke && x.revoke !== 'ok' ? revokeWarn(x, 'is signed out of NEXUS', () => apply({})) : apply({}) } };
}

export async function init() {
  try { S = await get() } catch { return } // tracker down: the page's own error card handles it
  if (!S.cur) return login();
  const c = cur(), act = document.querySelector('.top-act'); if (!act || !c) return;
  const b = document.createElement('button'); b.className = 'ac-btn'; b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-label', 'Account: ' + c.name);
  b.innerHTML = `${av(c, S.list.indexOf(c))}<span>${esc(c.name)}</span><span class="ac-mu" aria-hidden="true">▾</span>`;
  b.onclick = () => layer?.classList.contains('ac-menu-l') ? shut() : menu(b); act.prepend(b);
  addEventListener('keydown', e => { if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') { e.preventDefault(); dialog() } });
}
