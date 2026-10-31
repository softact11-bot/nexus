// NEXUS Assistant panel (post-M7 Phases 2, 3, 4, 7, 9, 10, 13). Docked on the right of every page; opened with the top-bar button or Ctrl+J.
// Text and voice share one engine: /api/assist/stream (assist.js on the tracker = Claude Code CLI on the user's own login).
// Voice in: /api/voice (Windows' offline recognizer, default microphone). Voice out: speechSynthesis with on-device voices only,
// unless "Allow online voices" is switched on. The NEXUS core (Home) follows the state: listening, thinking, speaking, executing, success, error.
import { esc, ago } from './fmt.js';
import { toast, MORE, more } from './ui.js';

// Phase 13: plain-language help (F1 or the i button) for the assistant's three choices.
Object.assign(MORE, {
  'as-model': { area: 'NEXUS Assistant', title: 'Model', what: 'Which Claude model answers. Auto picks the cheapest one that fits: Haiku for short questions, Sonnet for code and bugs, Opus for audits, architecture and big refactors.', when: ['Leave it on Auto for everyday use.', 'Pick Opus yourself when a hard problem needs the deepest answer.'], impact: { tokens: 'Haiku uses the least of your Claude plan, Opus the most. Each reply shows which model answered and why.', privacy: 'Same as Claude Code: your message goes to Anthropic under your own login.' }, notes: ['If you rate Haiku quick answers as not helpful several times, Auto starts sending quick questions to Sonnet. Settings → What NEXUS learned shows this and can undo it.'], tech: 'assist.js route(): user pick wins; opus words (architecture, audit, refactor…); under 200 chars without code words → haiku (sonnet when learned().upQuick); else sonnet.' },
  'as-mode': { area: 'NEXUS Assistant', title: 'Access', what: 'How much NEXUS may do in the chosen project. Read only and Plan never change anything. Edit files may create and change files in that project, and asks you first every time.', when: ['Read only for questions and explanations.', 'Plan for a step-by-step plan before work.', 'Edit files only when you want NEXUS to make the change.'], impact: { files: 'Read only and Plan: none. Edit files: files inside the chosen project only.', load: 'None.' }, notes: ['NEXUS can never run commands or programs, in any mode.', 'Edit files resets to Read only each time NEXUS starts.'], tech: 'Claude Code CLI --tools Read,Grep,Glob (+Edit,Write for edit), --permission-mode plan|acceptEdits, --strict-mcp-config, hooks disabled.' },
  'as-voice': { area: 'NEXUS Assistant', title: 'Microphone', what: 'Talk to NEXUS instead of typing. Push-to-talk listens when you press the mic button or Ctrl+Space; Hands-free sends every phrase; Wake word waits for "NEXUS…".', when: ['Push-to-talk is the safest choice in a noisy room.'], impact: { privacy: 'Speech is recognised offline by Windows. No audio is saved or sent anywhere; only the recognised text goes to Claude.', load: 'Small while the mic is on; nothing when it is off.' }, notes: ['Say "stop" or press Stop speaking to cut a spoken reply short.', 'Change the microphone in Windows Sound settings.'], tech: 'voice.ps1: System.Speech DictationGrammar + wake grammar on the default audio device; events streamed over /api/voice/events.' }
});

const K = 'nx.assist', D = { model: 'auto', mode: 'read', project: '', voice: 'off', speak: false, vname: '', rate: 1, vol: 1, online: false, keepTx: true };
const P = (() => { try { return { ...D, ...JSON.parse(localStorage.getItem(K)) } } catch { return { ...D } } })();
if (P.mode === 'edit') P.mode = 'read'; // Phase 10: Edit files never carries over to a new NEXUS start
const save = () => { try { localStorage.setItem(K, JSON.stringify(P)) } catch { } };
const PAGES = { home: 'home', sessions: 'sessions', analytics: 'analytics', optimizations: 'optimizations', learning: 'learning', 'learning lab': 'learning', plugins: 'plugins', skills: 'plugins', projects: 'projects', knowledge: 'knowledge', obsidian: 'knowledge', graphify: 'knowledge', settings: 'settings', 'claude code': 'claude-code', automation: 'automation', 'system health': 'system', system: 'system' };
const MODE_TXT = { read: 'Read only: NEXUS can read files in the project and your notes. It cannot change anything.', plan: 'Plan: NEXUS reads and writes a step-by-step plan. It cannot change anything.', edit: 'Edit files: NEXUS may create and change files inside the chosen project. It still cannot run commands.' };
const ST = { idle: 'Ready', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…', executing: 'Working…' };

let el = null, conv = null, msgs = [], runId = null, ctl = null, state = 'idle', att = [], projects = [], ev = null, evCtl = null, micOn = false, speaking = false;
const $ = s => el.querySelector(s);
const mood = (m, l) => { try { window.nexus?.mood?.(m, l) } catch { } };
const setState = s => { state = s; if (el) { $('#as-st').textContent = ST[s] || ''; el.dataset.st = s } mood(s) };
const post = (u, o) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });

// Safe markdown-lite: everything escaped first, then code blocks, inline code, bold, bullet lines.
export function md(s) {
  const parts = String(s ?? '').split(/```[\w-]*\n?/);
  return parts.map((p, i) => i % 2 ? `<pre><code>${esc(p.replace(/\n$/, ''))}</code></pre>` : esc(p).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/^[-*] (.*)$/gm, '• $1').replace(/\n/g, '<br>')).join('');
}

export function init() {
  if (document.getElementById('as-btn')) return;
  const b = Object.assign(document.createElement('button'), { className: 'icon-btn as-btn as-fab', id: 'as-btn', type: 'button', innerHTML: '<svg class="ic"><use href="#i-chat"/></svg><span class="as-mic" hidden></span>' });
  b.setAttribute('aria-label', 'NEXUS Assistant (Ctrl+J)'); b.dataset.tip = 'NEXUS Assistant (Ctrl+J)'; b.setAttribute('aria-expanded', 'false');
  b.onclick = () => toggle(); document.body.append(b); // floating chat button, bottom right (user 2026-10-29)
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); toggle() } else if (e.key === 'Escape' && el?.classList.contains('on') && el.contains(document.activeElement) && !e.defaultPrevented) { toggle(false); b.focus() } });
  if (P.voice !== 'off' && P.voice !== 'ptt') voiceOn(P.voice); // hands-free / wake word survive a reload, the mic dot shows it
}

function toggle(v) {
  build(); const on = v ?? !el.classList.contains('on');
  el.classList.toggle('on', on); el.inert = !on; const b = document.getElementById('as-btn'); b.setAttribute('aria-expanded', String(on)); b.hidden = on; // the open panel covers its corner
  if (on) { refresh(); setTimeout(() => $('#as-in').focus(), 30) }
}

function build() {
  if (el) return;
  el = document.createElement('aside'); el.id = 'as'; el.className = 'as'; el.setAttribute('aria-label', 'NEXUS Assistant'); el.inert = true; el.dataset.st = 'idle';
  el.innerHTML = `<header class="as-h"><span class="as-dot" aria-hidden="true"></span><div><b>NEXUS Assistant</b><small id="as-st" role="status">Ready</small></div>
    <button class="as-ib" data-a="new" type="button" aria-label="New chat" data-tip="New chat"><svg class="ic"><use href="#i-plus-folder"/></svg></button>
    <button class="as-ib" data-a="hist" type="button" aria-label="Chat history" aria-expanded="false" data-tip="Chat history and search"><svg class="ic"><use href="#i-clock"/></svg></button>
    <button class="as-ib" data-a="opts" type="button" aria-label="Assistant and voice settings" aria-expanded="false" data-tip="Settings"><svg class="ic"><use href="#i-gear"/></svg></button>
    <button class="as-ib" data-a="close" type="button" aria-label="Close assistant (Esc)" data-tip="Close (Esc)"><svg class="ic"><use href="#i-x"/></svg></button></header>
  <div class="as-ctx">
    <label><span class="as-lab">Project</span><select id="as-proj"><option value="">None</option></select></label>
    <label><span class="as-lab">Model ${more('as-model', 'Model')}</span><select id="as-model"><option value="auto">Auto</option><option value="haiku">Haiku (fast)</option><option value="sonnet">Sonnet (balanced)</option><option value="opus">Opus (deepest)</option></select></label>
    <label><span class="as-lab">Access ${more('as-mode', 'Access')}</span><select id="as-mode"><option value="read">Read only</option><option value="plan">Plan</option><option value="edit">Edit files</option></select></label>
  </div>
  <p class="as-modetxt" id="as-modetxt"></p>
  <section class="as-hist" id="as-hist" hidden><input id="as-q" type="search" placeholder="Search chats…" aria-label="Search chats"><ul id="as-hl" role="list"></ul></section>
  <section class="as-opts" id="as-opts" hidden>
    <h3>Voice</h3>
    <label>Microphone ${more('as-voice', 'Microphone')}<select id="as-voice"><option value="off">Off</option><option value="ptt">Push-to-talk (mic button or Ctrl+Space)</option><option value="free">Hands-free (every phrase)</option><option value="wake">Wake word: say "NEXUS…"</option></select></label>
    <p class="as-note">Uses Windows' built-in offline speech recognizer and your default microphone (change it in Windows Sound settings). No audio is saved.</p>
    <label class="as-chk"><input type="checkbox" id="as-speak"> Read replies aloud</label>
    <label>Voice<select id="as-vname"></select></label>
    <label class="as-chk"><input type="checkbox" id="as-online"> Allow online voices (text is sent to Microsoft to speak it)</label>
    <label>Speed <input type="range" id="as-rate" min="0.6" max="1.6" step="0.1"></label>
    <label>Volume <input type="range" id="as-vol" min="0" max="1" step="0.1"></label>
    <label class="as-chk"><input type="checkbox" id="as-keeptx"> Keep spoken requests in chat history</label>
    <p class="as-note">Speech plays on the Windows default output device.</p>
    <h3>Remembered notes</h3><p class="as-note">NEXUS reads these in every chat. Add one with "Remember" under a reply.</p><ul id="as-mem" class="as-list" role="list"></ul>
    <h3>Tasks</h3><form id="as-tf" class="as-tf"><input id="as-tn" type="text" maxlength="160" placeholder="New task…" aria-label="New task"><button class="as-ib" type="submit" aria-label="Add task"><svg class="ic"><use href="#i-plus-folder"/></svg></button></form><ul id="as-tl" class="as-list" role="list"></ul>
    <h3>What NEXUS learned</h3><p class="as-note" id="as-learn"></p><button type="button" class="as-lnk" data-a="resetLearn">Forget what was learned</button>
    <h3>Improvements</h3><p class="as-note">NEXUS studies your rated answers and proposes changes with the evidence. Nothing changes until you press Try it; every change can be rolled back.</p><div id="as-imp" class="as-imp"></div>
    <h3>Plans</h3><p class="as-note">Make a plan from a Plan answer ("Make plan" under it). A plan runs step by step only when you press Run.</p><ul id="as-jobs" class="as-list as-jobs" role="list"></ul>
    <h3>Project check</h3><p class="as-note">Checks the selected project for Roblox and Blender risks. No AI call, nothing is changed.</p><button type="button" class="as-lnk" data-a="scan">Check project</button><div id="as-scan" class="as-scan" aria-live="polite"></div>
  </section>
  <div class="as-log" id="as-log" role="log" aria-live="polite" aria-relevant="additions"></div>
  <div class="as-att" id="as-att"></div>
  <form class="as-in" id="as-form">
    <button class="as-ib" type="button" data-a="attach" aria-label="Attach a file or image" data-tip="Attach (images, text, code; up to 5 MB)"><svg class="ic"><use href="#i-ul"/></svg></button>
    <input type="file" id="as-file" hidden multiple accept="image/*,.txt,.md,.json,.lua,.luau,.js,.ts,.css,.html,.py,.csv,.log">
    <textarea id="as-in" rows="2" placeholder="Ask NEXUS anything… (Enter to send, Shift+Enter for a new line)" aria-label="Message to NEXUS"></textarea>
    <button class="as-ib as-mic-b" type="button" data-a="mic" aria-label="Talk (push-to-talk)" aria-pressed="false" data-tip="Talk (Ctrl+Space)"><svg class="ic"><use href="#i-vol"/></svg></button>
    <button class="as-send" type="submit" id="as-send">Send</button>
  </form>
  <button class="as-hush" id="as-hush" type="button" hidden>Stop speaking</button>`;
  document.body.append(el);
  const sel = (id, k, fn) => { const s = $(id); s.value = P[k]; s.onchange = () => { P[k] = s.type === 'checkbox' ? s.checked : s.type === 'range' ? +s.value : s.value; save(); fn?.() } };
  sel('#as-model', 'model'); sel('#as-mode', 'mode', modeTxt); sel('#as-proj', 'project'); sel('#as-voice', 'voice', () => { if (P.voice === 'off' || P.voice === 'ptt') voiceOff(); else voiceOn(P.voice) });
  for (const [id, k] of [['#as-speak', 'speak'], ['#as-online', 'online'], ['#as-keeptx', 'keepTx']]) { const c = $(id); c.checked = P[k]; c.onchange = () => { P[k] = c.checked; save(); if (k === 'online') voices() } }
  sel('#as-rate', 'rate'); sel('#as-vol', 'vol'); sel('#as-vname', 'vname'); modeTxt(); voices(); speechSynthesis?.addEventListener?.('voiceschanged', voices);
  el.addEventListener('click', onClick);
  $('#as-form').onsubmit = e => { e.preventDefault(); runId ? cancel() : send($('#as-in').value) };
  $('#as-in').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!runId) send($('#as-in').value) } });
  $('#as-file').onchange = e => upload([...e.target.files]);
  $('#as-q').oninput = () => hist($('#as-q').value);
  $('#as-hush').onclick = hush;
  $('#as-tf').onsubmit = e => { e.preventDefault(); const t = $('#as-tn').value.trim(); if (t) act({ op: 'task', title: t, conv }).then(() => { $('#as-tn').value = '' }) };
  addEventListener('keydown', e => { if (e.ctrlKey && e.code === 'Space' && el.classList.contains('on')) { e.preventDefault(); ptt() } });
  el.addEventListener('dragover', e => e.preventDefault()); el.addEventListener('drop', e => { e.preventDefault(); upload([...e.dataTransfer.files]) });
  draw();
}
const modeTxt = () => { $('#as-modetxt').textContent = MODE_TXT[P.mode]; $('#as-modetxt').classList.toggle('warn', P.mode === 'edit') };

async function refresh() {
  try { const s = await (await fetch('/api/assist/status', { cache: 'no-store' })).json(); projects = s.projects || [];
    const ps = $('#as-proj'); ps.innerHTML = '<option value="">None</option>' + projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''); ps.value = P.project;
    if (!s.bin) note('Claude Code was not found on this PC, so the assistant cannot answer yet. Install Claude Code, sign in, then reopen NEXUS.', 'err');
    lists(s);
    if (s.running && !runId) note('Another NEXUS window is answering right now.', 'warn');
  } catch { note('The NEXUS tracker is not reachable, so the assistant is offline. It reconnects on its own.', 'err') }
}

// Phase 5/7/8: remembered notes, tasks and the one learned rule, all shown and undoable here.
function lists(s) {
  $('#as-mem').innerHTML = s.memory?.length ? s.memory.map((m, i) => `<li data-i="${i}"><span>${esc(m.x)}</span><button type="button" class="as-ib" data-a="forget" aria-label="Forget: ${esc(m.x)}"><svg class="ic"><use href="#i-x"/></svg></button></li>`).join('') : '<li class="as-empty">Nothing remembered yet.</li>';
  $('#as-tl').innerHTML = s.tasks?.length ? s.tasks.map((t, i) => `<li data-i="${i}"><label class="as-chk"><input type="checkbox" data-a="taskset" ${t.done ? 'checked' : ''}> <span>${esc(t.title)}</span></label><button type="button" class="as-ib" data-a="taskdel" aria-label="Delete task: ${esc(t.title)}"><svg class="ic"><use href="#i-x"/></svg></button></li>`).join('') : '<li class="as-empty">No tasks yet.</li>';
  imp(s.brain || {}); jobsUi(s.jobs || [], s.plan);
  const L = s.learned || {}; $('#as-learn').textContent = L.upQuick ? `Quick questions now go to Sonnet, because ${L.down} of the last ${L.rated} rated Haiku answers were marked not helpful.` : `Nothing changed yet. ${L.rated ? L.rated + ' quick answer(s) rated so far.' : 'Rate replies with the thumbs to teach NEXUS.'}`;
}
// Phase 5/9 dashboard: proposals with evidence, rules and experiments, skills, history, lessons, measured cost per model and savings
const pct = x => x == null ? '–' : Math.round(x * 100) + '%', usd = x => x == null ? '–' : '$' + x.toFixed(x < 0.01 ? 4 : 2);
function imp(b) {
  const pr = b.proposals || [], ru = (b.rules || []).filter(r => r.status !== 'rolled back'), sk = b.skills || [], sv = b.savings || {};
  $('#as-imp').innerHTML = [
    pr.length ? '<b>Proposed</b><ul class="as-list" role="list">' + pr.map(p => `<li data-id="${esc(p.id)}"><span><b>${esc(p.title)}</b><small>${esc(p.why)} Risk: ${esc(p.risk)}.${p.kind === 'skill' ? ' Writes ~/.claude/skills/nexus-….' : ' Tested on 1 in 4 matching requests until 12 are rated, then kept or rolled back.'}</small></span><button type="button" class="as-lnk" data-a="impok">Try it</button><button type="button" class="as-lnk" data-a="impno">Dismiss</button></li>`).join('') + '</ul>' : '<p class="as-empty">No proposals yet. Rate replies with the thumbs; NEXUS needs at least 5 rated answers of one kind.</p>',
    ru.length ? '<b>Active</b><ul class="as-list" role="list">' + ru.map(r => `<li data-id="${esc(r.id)}"><span>${esc(r.title)} <small>${r.status === 'experiment' ? `experiment, ${r.tested || 0} of 12 rated` : `kept: ${pct(r.result?.new)} vs ${pct(r.result?.old)} helpful (v${r.v})`}</small></span><button type="button" class="as-lnk" data-a="impback">Roll back</button></li>`).join('') + '</ul>' : '',
    sk.length ? '<b>NEXUS skills</b><ul class="as-list" role="list">' + sk.map(k => `<li data-id="${esc(k.id)}"><span>${esc(k.dir)} <small>v${k.versions.at(-1)}, ${k.versions.length} version(s)</small></span><button type="button" class="as-lnk" data-a="impback">Roll back</button></li>`).join('') + '</ul>' : '',
    (b.stats || []).length ? '<b>Measured</b><table class="as-tb"><thead><tr><th>Model</th><th>Kind</th><th>Answers</th><th>Helpful</th><th>Avg cost</th></tr></thead><tbody>' + b.stats.map(x => `<tr><td>${esc(x.model)}</td><td>${esc(x.cls)}</td><td>${x.n}</td><td>${pct(x.help)}</td><td>${usd(x.avgCost)}</td></tr>`).join('') + '</tbody></table>' : '',
    sv.answers ? `<p class="as-note">Auto routing: ${usd(sv.actual)} spent on ${sv.answers} answers; all on Sonnet would be about ${usd(sv.allSonnet)} (saved ${usd(sv.saved)}, estimate from list prices).</p>` : '',
    (b.lessons || []).length ? '<b>Lessons</b><ul class="as-list" role="list">' + b.lessons.slice(0, 8).map(x => `<li><span>${esc(x)}</span></li>`).join('') + '</ul>' : '',
    (b.history || []).length ? '<details><summary>History</summary><ul class="as-list" role="list">' + b.history.slice(0, 15).map(h => `<li><span>${esc(h.what)} <small>${ago(h.at)}</small></span></li>`).join('') + '</ul></details>' : ''].join('');
}
const STEP = { wait: '○', run: '◐', ok: '✓', fail: '✕', skip: '–' };
let jobPoll = null;
function jobsUi(js, running) {
  $('#as-jobs').innerHTML = js.length ? js.map(j => `<li data-id="${esc(j.id)}" class="as-job"><span><b>${esc(j.title)}</b> <small>${esc(j.status)} · ${j.steps.filter(s => s.st === 'ok').length}/${j.steps.length} steps${j.cost ? ' · ' + usd(j.cost) : ''} · ${esc(j.mode)}</small>
    <ol>${j.steps.map(s => `<li title="${esc(s.out || '')}"><span aria-hidden="true">${STEP[s.st]}</span> ${esc(s.x)}${s.tries > 1 ? ' (retried)' : ''}</li>`).join('')}</ol>${j.log?.[0] ? `<small>${esc(j.log[0].x)}</small>` : ''}</span>
    ${j.status === 'running' ? '<button type="button" class="as-lnk" data-a="jobcancel">Cancel</button>' : j.status === 'done' ? '' : `<button type="button" class="as-lnk" data-a="jobrun">${j.status === 'queued' ? 'Run' : 'Run again'}</button>`}
    ${j.status === 'paused' ? '<button type="button" class="as-lnk" data-a="jobskip">Skip step</button>' : ''}${j.status !== 'running' ? `<button type="button" class="as-ib" data-a="jobdel" aria-label="Delete plan ${esc(j.title)}"><svg class="ic"><use href="#i-x"/></svg></button>` : ''}</li>`).join('') : '<li class="as-empty">No plans yet.</li>';
  clearTimeout(jobPoll); if (running) jobPoll = setTimeout(refresh, 2000);
}
function scanUi(r) {
  if (!r.roblox && !r.blender) return '<p class="as-empty">No Roblox or Blender files found in this project.</p>';
  return (r.roblox ? `<p>${r.scripts.server} server, ${r.scripts.client} client, ${r.scripts.modules} module scripts (${r.scripts.lines} lines).${r.tree.length ? ' Rojo: ' + esc(r.tree.join('; ')) : ''}</p>` : '')
    + (r.blender ? `<p>Blender: ${r.blend.files} file(s), ${r.blend.mb} MB, ${r.blend.exports} FBX/OBJ export(s).</p>` : '')
    + (r.findings.length ? '<ul class="as-list" role="list">' + r.findings.slice(0, 20).map(x => `<li><span><b>${esc(x.k)}</b> ${esc(x.file)}:${x.line} ${esc(x.msg)}</span></li>`).join('') + '</ul>' : '<p>No risks found by the static check.</p>')
    + (r.skills.length ? `<p class="as-note">Matching installed skills: ${esc(r.skills.join(', '))}</p>` : '');
}
// a Plan answer's numbered or bulleted lines become the plan's steps
const planSteps = x => String(x).split('\n').map(l => /^\s*(\d+[.)]|[-*•])\s+(.+)/.exec(l)?.[2]).filter(Boolean).map(l => l.replace(/[*`]/g, '').trim()).slice(0, 20);

async function act(o, ok) {
  try { const r = await (await post('/api/assist', o)).json(); if (r.res !== 'ok') return toast(r.res, 'warn', "Couldn't save"); if (ok) toast(ok, 'ok'); refresh(); return r }
  catch { toast('The NEXUS tracker is not reachable.', 'err', "Couldn't save") }
}

function onClick(e) {
  const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
  if (a === 'close') toggle(false);
  else if (a === 'new') { conv = null; msgs = []; draw(); $('#as-in').focus() }
  else if (a === 'hist' || a === 'opts') { const s = $(a === 'hist' ? '#as-hist' : '#as-opts'), b = e.target.closest('[data-a]'), open = s.hidden; s.hidden = !open; b.setAttribute('aria-expanded', String(open)); if (open && a === 'hist') { hist(''); $('#as-q').focus() } }
  else if (a === 'attach') $('#as-file').click();
  else if (a === 'mic') ptt();
  else if (a === 'open') load(e.target.closest('[data-id]').dataset.id);
  else if (a === 'del') { const id = e.target.closest('[data-id]').dataset.id; if (confirm('Delete this chat? This cannot be undone.')) post('/api/assist', { op: 'delete', id }).then(() => { if (conv === id) { conv = null; msgs = []; draw() } hist($('#as-q').value) }) }
  else if (a === 'unatt') { att.splice(+e.target.closest('[data-i]').dataset.i, 1); drawAtt() }
  else if (a === 'retry') send(e.target.closest('[data-x]').dataset.x);
  else if (a === 'forget') act({ op: 'forget', i: +e.target.closest('[data-i]').dataset.i });
  else if (a === 'taskset') act({ op: 'taskset', i: +e.target.closest('[data-i]').dataset.i, done: e.target.checked });
  else if (a === 'taskdel') act({ op: 'taskdel', i: +e.target.closest('[data-i]').dataset.i });
  else if (a === 'resetLearn') { if (confirm('Forget everything NEXUS learned from your ratings?')) act({ op: 'resetLearn' }, 'NEXUS forgot what it learned.') }
  else if (a === 'impok' || a === 'impno' || a === 'impback') { const id = e.target.closest('[data-id]').dataset.id;
    if (a === 'impok' && id.startsWith('skill:') && !confirm('Write a new NEXUS skill into ~/.claude/skills? Claude Code will load it in every session. You can roll it back here.')) return;
    act({ op: 'improve', do: { impok: 'approve', impno: 'dismiss', impback: 'rollback' }[a], id }, { impok: 'Started.', impno: 'Dismissed.', impback: 'Rolled back.' }[a]) }
  else if (/^job(run|cancel|skip|del)$/.test(a)) { const id = e.target.closest('[data-id]').dataset.id; if (a === 'jobdel' && !confirm('Delete this plan and its history?')) return; act({ op: a, id }, a === 'jobrun' ? 'Plan started.' : null) }
  else if (a === 'scan') { if (!P.project) return toast('Pick a project first (Project, at the top of the panel).', 'warn', 'No project'); $('#as-scan').textContent = 'Checking…'; act({ op: 'scan', project: P.project }).then(r => { $('#as-scan').innerHTML = r?.scan ? scanUi(r.scan) : '' }) }
  else if (a === 'again') { const m = msgs[+e.target.closest('[data-k]').dataset.k], u = msgs[msgs.indexOf(m) - 1]; if (u?.r === 'u') send(u.x, false, true) }
  else if (a === 'mkplan') { const m = msgs[+e.target.closest('[data-k]').dataset.k], st = planSteps(m?.x); if (!st.length) return toast('This answer has no numbered or bulleted steps to turn into a plan.', 'warn', 'No steps');
    const t = prompt(`Plan with ${st.length} step(s). Title:`, msgs[msgs.indexOf(m) - 1]?.x?.slice(0, 80) || 'Plan'); if (t?.trim()) act({ op: 'plan', title: t, steps: st, project: P.project || null, mode: P.mode === 'edit' ? 'edit' : 'read', conv: m.conv }, 'Plan added (Settings → Plans).') }
  else if (a === 'up' || a === 'down' || a === 'rem' || a === 'mktask') {
    const m = msgs[+e.target.closest('[data-k]').dataset.k]; if (!m || m.i == null) return;
    const first = String(m.x).split('\n').find(x => x.trim())?.replace(/[*#`]/g, '').trim().slice(0, 300) || '';
    if (a === 'rem') { const x = prompt('Remember this in future chats:', first); if (x?.trim()) act({ op: 'remember', text: x, project: P.project || null }, 'Remembered.') }
    else if (a === 'mktask') { const x = prompt('Task title:', first.slice(0, 160)); if (x?.trim()) act({ op: 'task', title: x, conv: m.conv }, 'Task added.') }
    else { const v = a === 'up' ? 1 : -1; m.v = m.v === v ? 0 : v; act({ op: 'rate', id: m.conv, i: m.i, v: m.v }); draw() }
  }
}

async function hist(q) {
  const ul = $('#as-hl');
  try { const l = await (await fetch('/api/assist/convs?q=' + encodeURIComponent(q || ''), { cache: 'no-store' })).json();
    ul.innerHTML = l.length ? l.map(c => `<li data-id="${esc(c.id)}"><button type="button" data-a="open">${esc(c.title)}<small>${ago(c.at)} · ${c.n} messages</small></button><button type="button" class="as-ib" data-a="del" aria-label="Delete chat ${esc(c.title)}"><svg class="ic"><use href="#i-x"/></svg></button></li>`).join('') : `<li class="as-empty">${q ? 'No chat matches.' : 'No chats yet.'}</li>`;
  } catch { ul.innerHTML = '<li class="as-empty">Chats could not be loaded (tracker not reachable).</li>' }
}
async function load(id) {
  try { const c = await (await fetch('/api/assist/conv?id=' + encodeURIComponent(id), { cache: 'no-store' })).json(); conv = c.id; msgs = c.msgs.map((m, i) => ({ r: m.r, x: m.x, model: m.model, tools: m.tools, ok: m.ok, at: m.at, v: m.v || 0, i, conv: c.id, cached: m.cached })); if (c.project) { P.project = c.project; $('#as-proj').value = c.project } $('#as-hist').hidden = true; draw() }
  catch { toast('The chat could not be opened.', 'err', "Couldn't open the chat") }
}

function note(t, k = 'info') { const log = $('#as-log'); if ([...log.querySelectorAll('.as-note-m')].some(n => n.textContent === t)) return; log.insertAdjacentHTML('beforeend', `<p class="as-note-m ${k}">${esc(t)}</p>`) }
function draw() {
  const log = $('#as-log');
  log.innerHTML = msgs.length ? msgs.map((m, k) => bubble(m, k)).join('') : `<div class="as-hello"><b>Hi, I'm NEXUS.</b><p>Ask about your projects, sessions, skills or usage; ask me to explain code, find a bug or plan a task.</p><ul>${['What should I work on next?', 'Summarize what changed today', 'Find the best installed skill for Roblox UI', 'Open settings'].map(x => `<li><button type="button" data-a="retry" data-x="${esc(x)}">${esc(x)}</button></li>`).join('')}</ul></div>`;
  log.scrollTop = log.scrollHeight;
}
const acts = (m, k) => m.i == null ? '' : `<div class="as-acts" data-k="${k}"><button type="button" data-a="up" aria-label="Helpful" aria-pressed="${m.v === 1}" data-tip="Helpful">👍</button><button type="button" data-a="down" aria-label="Not helpful" aria-pressed="${m.v === -1}" data-tip="Not helpful">👎</button><button type="button" data-a="rem">Remember</button><button type="button" data-a="mktask">Add task</button>${planSteps(m.x).length >= 2 ? '<button type="button" data-a="mkplan">Make plan</button>' : ''}${m.cached ? '<button type="button" data-a="again">Ask again</button>' : ''}</div>`;
const bubble = (m, k) => m.r === 'u' ? `<div class="as-m u">${esc(m.x)}</div>`
  : `<div class="as-m a${m.ok === false ? ' bad' : ''}">${m.tools?.length ? `<div class="as-tools">${m.tools.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}<div class="as-x">${md(m.x) || (m.ok === false ? '' : '<span class="as-typing" aria-label="Thinking"><i></i><i></i><i></i></span>')}</div>${m.meta ? `<small class="as-meta">${esc(m.meta)}</small>` : m.model ? `<small class="as-meta">${esc(m.model)}</small>` : ''}${acts(m, k)}</div>`;

// Local commands answered without Claude (free, instant): "open <page>", "stop".
function local(t) {
  const s = t.toLowerCase().replace(/^(hey |ok )?nexus[,.!]?\s*/, '').replace(/[.!?]+$/, '').trim();
  if (/^(stop|stop talking|stop speaking|be quiet)$/.test(s)) { hush(); return 'Stopped.' }
  const m = s.match(/^(open|go to|show)( the| my)? (.+?)( page| tab)?$/); if (!m) return null;
  const pg = PAGES[m[3]]; if (pg) { location.hash = '#/' + pg; return `Opened ${m[3]}.` }
  const p = projects.find(x => m[3].includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(m[3].replace(/ project$/, '')));
  if (p) { location.hash = '#/projects'; P.project = p.id; save(); if (el) $('#as-proj').value = p.id; return `Opened Projects and selected ${p.name} for this chat.` }
  return null;
}

async function send(text, spoken, fresh) {
  text = String(text || '').trim(); if (!text || runId) return;
  if (P.mode === 'edit' && !confirm('Access is "Edit files": NEXUS may change files in ' + (projects.find(p => p.id === P.project)?.name || 'your home folder') + '. Continue?')) return;
  $('#as-in').value = ''; $('#as-hist').hidden = true;
  const lc = local(text);
  if (lc) { msgs.push({ r: 'u', x: text }, { r: 'a', x: lc, model: 'NEXUS (local command)' }); draw(); say(lc); return }
  const u = { r: 'u', x: text }, a = { r: 'a', x: '', tools: [] };
  if (!(spoken && !P.keepTx)) msgs.push(u); msgs.push(a); draw();
  setState('thinking'); hush();
  ctl = new AbortController(); runId = 'pending'; $('#as-send').textContent = 'Stop'; $('#as-send').classList.add('stop');
  const names = att.map(x => x.name); att = []; drawAtt();
  let res; try { res = await fetch('/api/assist/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, conv, project: P.project || null, model: P.model, mode: P.mode, att: names, fresh: !!fresh }), signal: ctl.signal }) }
  catch { return finish(a, 'error', 'The NEXUS tracker is not reachable. Check that NEXUS is running, then try again.') }
  const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '', end = null;
  try {
    for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); let j; try { j = JSON.parse(l) } catch { continue }
        if (j.t === 'start') { runId = j.id; conv = j.conv; a.meta = `${j.model} · ${j.why}`; a.cached = !!j.cached; live(a) }
        else if (j.t === 'text') { a.x += j.d; live(a) }
        else if (j.t === 'tool') { a.tools.push(j.name + (j.info ? ': ' + j.info : '')); setState('executing'); live(a) }
        else end = j } }
  } catch { end ||= { t: 'cancelled' } }
  if (end?.t === 'done') { a.i = end.i; a.conv = conv; a.v = 0; a.meta += ` · ${(end.ms / 1000).toFixed(1)} s` + (end.usage ? ` · ${end.usage.in + (end.usage.cacheRead || 0)} in / ${end.usage.out} out tokens` : ''); finish(a, 'success'); say(a.x) }
  else if (end?.t === 'cancelled') finish(a, 'idle', a.x ? null : 'Stopped.')
  else finish(a, 'error', end?.msg || 'No answer came back. Try again.');
}
function live(a) { const n = $('#as-log').lastElementChild; if (n) n.outerHTML = bubble(a, msgs.indexOf(a)); const log = $('#as-log'); if (log.scrollHeight - log.scrollTop - log.clientHeight < 160) log.scrollTop = log.scrollHeight; if (state === 'executing' && !a.tools.length) setState('thinking') }
function finish(a, st, msg) {
  runId = null; ctl = null; $('#as-send').textContent = 'Send'; $('#as-send').classList.remove('stop');
  if (msg) { a.x = a.x ? a.x + '\n\n' + msg : msg; if (st === 'error') a.ok = false }
  live(a); setState(st === 'success' || st === 'error' ? 'idle' : st); if (st === 'success' || st === 'error') mood(st);
  if (st === 'error') note('If this keeps happening, open System Health or check that Claude Code is signed in.', 'info');
}
function cancel() { if (runId && runId !== 'pending') post('/api/assist', { op: 'cancel', id: runId }); ctl?.abort() }

async function upload(files) {
  for (const f of files.slice(0, 5 - att.length)) {
    if (f.size > 5 * 1048576) { toast(f.name + ' is over 5 MB.', 'err', "Couldn't attach the file"); continue }
    const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(f) });
    try { const x = await (await post('/api/assist', { op: 'attach', name: f.name, b64 })).json(); if (x.res === 'ok') att.push({ name: x.name, label: f.name }); else toast(x.res, 'err', "Couldn't attach the file") }
    catch { toast('The tracker is not reachable.', 'err', "Couldn't attach the file") }
  }
  drawAtt();
}
const drawAtt = () => { $('#as-att').innerHTML = att.map((a, i) => `<span data-i="${i}">${esc(a.label)}<button type="button" data-a="unatt" aria-label="Remove ${esc(a.label)}">×</button></span>`).join('') };

// ---------- voice out ----------
function voices() {
  const s = $('#as-vname'); if (!s || !window.speechSynthesis) return;
  const v = speechSynthesis.getVoices().filter(x => P.online || x.localService);
  s.innerHTML = '<option value="">Windows default</option>' + v.map(x => `<option value="${esc(x.name)}">${esc(x.name)}${x.localService ? '' : ' (online)'}</option>`).join('');
  s.value = v.some(x => x.name === P.vname) ? P.vname : '';
}
function say(text) {
  if (!P.speak || !window.speechSynthesis || !text) return;
  const t = String(text).replace(/```[\s\S]*?```/g, ' (code shown on screen) ').replace(/[`*#_>]/g, '').slice(0, 1500);
  const u = new SpeechSynthesisUtterance(t), v = speechSynthesis.getVoices().find(x => x.name === P.vname && (P.online || x.localService));
  if (v) u.voice = v; u.rate = P.rate; u.volume = P.vol;
  u.onstart = () => { speaking = true; $('#as-hush').hidden = false; setState('speaking') };
  u.onboundary = () => mood('speaking', .5 + Math.random() * .5); // speechSynthesis has no level meter: each word gives the core a beat
  u.onend = u.onerror = () => { speaking = false; if (el) $('#as-hush').hidden = true; if (state === 'speaking') setState('idle'); mood(null, 0) };
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
function hush() { if (window.speechSynthesis && (speaking || speechSynthesis.speaking)) speechSynthesis.cancel() }

// ---------- voice in ----------
async function voiceOn(mode, quiet) {
  if (!ev) listen();
  try { const x = await (await post('/api/voice', { op: 'start', mode })).json(); if (x.res !== 'ok') throw new Error(x.res) }
  catch (e) { if (!quiet) toast(String(e.message || 'The tracker is not reachable.'), 'err', "Couldn't start the microphone") }
}
function voiceOff() { clearTimeout(reTo); post('/api/voice', { op: 'stop' }).catch(() => { }); evCtl?.abort(); ev = null; mic(false) }
// V4: the event stream dropped (tracker restart / sleep) while hands-free or wake word was on: reconnect with backoff (3 s → 30 s), reset once the mic is ready
let reTo = 0, reMs = 3000;
function reconnect() { if (P.voice !== 'free' && P.voice !== 'wake') return; clearTimeout(reTo);
  if (el && reMs === 3000) note('Lost the connection to the microphone helper. Reconnecting…', 'warn');
  reTo = setTimeout(() => { if (P.voice === 'free' || P.voice === 'wake') voiceOn(P.voice, true) }, reMs); reMs = Math.min(30000, reMs * 2) }
function ptt() { if (micOn) return voiceOff(); hush(); voiceOn('ptt') }
function mic(on) {
  micOn = on; const d = document.querySelector('#as-btn .as-mic'); if (d) d.hidden = !on;
  if (el) { const b = $('[data-a=mic]'); b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on) }
  if (on) { if (state === 'idle') setState('listening') } else if (state === 'listening') setState('idle');
}
async function listen() {
  const ctl = evCtl = new AbortController(); ev = true;
  let res; try { res = await fetch('/api/voice/events', { cache: 'no-store', signal: ctl.signal }); if (!res.ok) throw 0 } catch { if (evCtl === ctl) { ev = null; if (!ctl.signal.aborted) reconnect() } return }
  const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
  try { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); let j; try { j = JSON.parse(l) } catch { continue } heard(j) } } } catch { }
  if (evCtl !== ctl) return; ev = null; mic(false); if (!ctl.signal.aborted) reconnect();
}
function heard(j) {
  if (j.t === 'ready') reMs = 3000;
  if (j.t === 'on' || j.t === 'ready' || (j.t === 'hello' && j.on)) mic(true);
  else if (j.t === 'off' || (j.t === 'hello' && !j.on)) mic(false);
  else if (j.t === 'level') { if (state === 'listening') mood('listening', j.v / 100) }
  else if (j.t === 'speech') hush(); // barge-in: talking over NEXUS stops its voice
  else if (j.t === 'wake') { hush(); setState('listening'); if (!el?.classList.contains('on')) toggle(true) }
  else if (j.t === 'cmd' && j.x === 'stop') { hush(); cancel() }
  else if (j.t === 'unsure') { if (el) note("Sorry, I didn't catch that. Try again a little closer to the microphone.", 'warn') }
  else if (j.t === 'text') { if (!el?.classList.contains('on')) toggle(true); send(j.x, true) }
  else if (j.t === 'error') { toast(j.x, 'err', 'Voice input'); mood('error') }
}
