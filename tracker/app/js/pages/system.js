// System Health (Phase I, spec §24). Real page: every reading comes from the tracker's sampler (sys.js via /api/sys, /api/sys/hist,
// /api/sys/procs). system-preview.html runs the same page with { preview: true }: labelled DEMO samples (+ /api/proc RAM / C: disk).
// Nothing here changes the system: no ending programs, no service start / stop, no settings.
import { esc, chip, bytes } from '../fmt.js';
import { icon, seg, toast, MORE, more, errBox } from '../ui.js';

MORE['sys-pause'] = { area: 'System Health', title: 'Pause monitoring', // M7d D2 Learn More (approved mockup text)
  what: 'Stops the System Health readings (CPU, GPU, RAM, disk, network and processes) until you press Resume.',
  when: ['A game, Roblox Studio or Blender needs all the CPU it can get.', "You leave the PC on and don't need live graphs."],
  impact: { tokens: 'None used', files: 'Nothing changed', privacy: 'Stays on this PC', load: 'Lower (not measured)' },
  notes: ['Token tracking, hooks, automations and doc sync keep running.', 'Resume is instant. The paused time shows as a gap in the graphs.', 'The tray menu has the same Pause / Resume.'],
  tech: 'POST /api/sys {op:"pause"} → sys.js stops sampling.\nNo data is deleted; sampling restarts on {op:"resume"}.' };

// M7d D3 System Health Learn More (facts checked against sys.js: 5 s typeperf, nvidia-smi 10 s / 30 s, statfs 60 s, process list only while this page is open)
const IMP = { tokens: 'None used', files: 'Nothing changed', privacy: 'Stays on this PC' };
Object.assign(MORE, {
  'sys-alerts': { area: 'System Health', title: 'System Status and alerts', what: 'One verdict for the PC: CPU, free memory, free disk space, GPU temperature and the NEXUS services, each compared with a safe limit.',
    when: ['Something feels slow and you want to know which part is struggling.', 'You want to see whether a past problem fixed itself.'], impact: { ...IMP, load: 'None (uses readings already taken)' },
    notes: ['An alert fires only when a limit is passed for 2 minutes in a row (default), so short spikes never alert. A NEXUS service failure alerts right away.', 'The same alert waits 15 minutes before it can fire again. Alerts are kept for 7 days; "Recovered" means the reading went back to normal by itself.', 'Change the limits in Settings → System Health.', 'While monitoring is paused, hardware alerts are not checked.'],
    tech: 'Default limits (sys-limits.json): CPU 90 %, free RAM 1.5 GB, free disk 10 GB (any drive), GPU 83 °C, sustain 2 min, cooldown 15 min. Alerts: sys-alerts.json, 7 days, 50 newest shown.' },
  'sys-graph': { area: 'System Health', title: 'Performance graphs', what: 'CPU, GPU, RAM, disk activity or network over the range you pick at the top (1 minute to 24 hours).',
    when: ['To see when a slowdown started or how long a spike lasted.', 'To compare before and after closing an app.'], impact: { ...IMP, load: 'Low: drawn about 30 times a second, only while visible' },
    notes: ['One reading every 5 seconds while the tracker runs. 24 hours are kept.', 'Long ranges show the highest reading of each slice, so short spikes stay visible.', 'Shaded "Paused" areas are times monitoring was paused; they are never drawn as zero. Times the tracker was off are gaps.'],
    tech: 'GET /api/sys/hist?since=… (NEXUS_DATA/sys-history.ndjson, compacted hourly). Up to 320 points per graph.' },
  'sys-gpuD': { area: 'System Health', title: 'GPU details', what: 'Usage, temperature, graphics memory, fan, clocks and power of an NVIDIA graphics card, read from its driver.',
    when: ['Blender or Roblox Studio stutters and you suspect the graphics card.', 'The PC gets loud or hot during renders.'], impact: { ...IMP, load: 'Very low: one driver query every 10 s (30 s while the CPU is above 85 %)' },
    notes: ['Read-only: NEXUS never changes clocks, fans or power.', 'Values the driver does not report (often power draw) show as "Not reported", never as a guess.', 'Without an NVIDIA card or driver tool this card says so and stays empty.'],
    tech: 'nvidia-smi --query-gpu (read-only). Missing tool → "nvidia-smi not found".' },
  'sys-proc': { area: 'System Health', title: 'Processes', what: 'Programs running on this PC with their share of the whole CPU and their private memory, heaviest first.',
    when: ['To find what is slowing the PC down.', 'To check whether an app really closed.'], impact: { ...IMP, load: 'Low, and only while this page is open' },
    notes: ['NEXUS can never end a program. The ⋮ menu only shows details, opens the file location in Explorer or copies the name.', 'The list is read only while this page is open and stops about 30 seconds after you leave. New programs appear within about 3 minutes.', 'Several copies of the same program are shown as one row with all their PIDs.'],
    tech: 'typeperf \\Process(*) every 5 s (CPU from processor time, memory = Working Set - Private). Stops 30 s after the last GET /api/sys/procs; restarts every 3 min.' },
  'sys-svc': { area: 'System Health', title: 'Services', what: 'The parts NEXUS depends on: tracker, usage tracking, automation scheduler, doc sync, Graphify, Obsidian and Claude Code.',
    when: ['A page stopped updating and you want to know which part is down.'], impact: { ...IMP, load: 'None' },
    notes: ['The ↻ button only re-reads the status. It never starts or stops anything.', 'Obsidian and Claude Code show "Unavailable" when they are simply closed; that is not an error.', 'The › button opens the page that uses that service.'],
    tech: 'POST /api/sys {op:"check", id}. Services are also re-read every 30 s; a failure alerts right away.' },
  'sys-net': { area: 'System Health', title: 'Network', what: 'Data coming in and going out through the network adapter, measured on this PC.',
    when: ['A download, sync or upload seems stuck or slow.'], impact: { ...IMP, load: 'None extra (same 5 s reading as CPU)' },
    notes: ['NEXUS sends no test traffic, so ping and internet speed are not measured.', 'The numbers cover every program, not only NEXUS.'], tech: 'typeperf \\Network Interface(*)\\Bytes Received/sec + Bytes Sent/sec.' },
  'sys-storage': { area: 'System Health', title: 'Storage', what: 'Every readable drive with used and free space.',
    when: ['Before a big download, render or backup.', 'When the Disk space check says a drive is low.'], impact: { ...IMP, load: 'None (read once a minute)' },
    notes: ['Read once a minute, so freed space can take up to a minute to show.', 'Below 10 GB free on any drive raises an alert (default).'], tech: 'fs.statfs on each drive every 60 s.' },
  'sys-apps': { area: 'System Health', title: 'Development apps', what: 'Memory and CPU of Roblox Studio, Blender, Obsidian and Claude Code, taken from the process list.',
    when: ['To see which of your tools is using the most.'], impact: { ...IMP, load: 'None extra' }, notes: ['"Not running" means the app is closed.', 'CPU is the share of the whole CPU in the last reading.'] },
  'sys-foot': { area: 'System Health', title: 'NEXUS footprint', what: "What NEXUS's own tracker costs: CPU, memory, the size of the 24-hour history file, and the CPU used by the measuring tools.",
    when: ['To check that monitoring is not slowing games or editors down.'], impact: { ...IMP, load: 'None extra' },
    notes: ['If the sampler cost seems too high, Pause monitoring stops every hardware reader until you resume.', 'The history file drops readings older than 24 hours every hour.'] },
  'sys-down': { area: 'System Health', title: 'Tracker not reachable', what: 'Every reading on this page comes from the NEXUS tracker on this PC. When it does not answer, the page cannot measure anything.',
    when: ['The red card at the top of System Health is showing.'], impact: IMP,
    notes: ['Graph history already loaded stays visible; new readings start again as soon as the tracker answers.', 'Pause, Resume and Check again are off until then, because they need the tracker.', 'This page asks again every 5 seconds while it is open.'],
    tech: 'GET /api/sys failed (network error or non-200). Start: node ~/.claude/token-tracker/tracker.js serve' },
});

const RANGES = [['1m', 6e4], ['5m', 3e5], ['15m', 9e5], ['1h', 36e5], ['6h', 216e5], ['24h', 864e5]];
const STEP = 5e3; // one reading every 5 s (the real sampler's rate)
const COL = { cpu: '#31D67A', gpu: '#58E89B', ram: '#5AB8F2', disk: '#F2B544', down: '#31D67A', up: '#5AB8F2' };
// plain-language help (Q1: every technical metric explained for beginners)
const HELP = {
  cpu: 'CPU (processor) = the part of the PC that does the thinking for every program. Usage is how busy it is right now. Short spikes are normal; staying above 90 % for minutes makes everything slow.',
  gpu: 'GPU (graphics card) = the part that draws everything you see: games, Roblox Studio and Blender viewports. High usage while one of them is open is expected and fine.',
  ram: 'RAM (memory) = the desk space open programs work on. More open programs = less free desk. When it fills up, Windows borrows the much slower disk and apps stutter.',
  disk: 'Disk (drive) = the long-term storage that keeps your files when the PC is off. The card shows how full drive C: is. Low free space slows Windows updates, backups and saving big files.',
  net: 'Network = data coming in (download) and going out (upload) through your network adapter, measured on this PC only. No test traffic is sent.',
  graph: 'The same readings over time. Pick a range at the top. Every point is one reading taken every 5 seconds while NEXUS runs.',
  gpuD: 'Details read from the NVIDIA driver (nvidia-smi, read-only). Only values the driver actually reports are shown.',
  storage: 'Every drive in this PC with used and free space.',
  apps: 'How hard your main creative tools are working right now. "Not running" means the app is closed.',
  foot: 'What NEXUS itself costs. Monitoring is meant to stay tiny so games and editors never notice it.',
  proc: 'Programs running on this PC, heaviest first. Click a row for what it is. NEXUS can never end a program.',
  svc: 'The parts NEXUS needs. Check Again only re-reads the status; it never starts or stops anything.',
  alerts: 'Problems that lasted at least 2 minutes (a service failure: right away), each with what it means and what you can safely do.',
};
// what common processes are, in simple words (shown in details)
const WHAT = {
  'claude.exe': 'Claude Code, the AI coding assistant running in your terminal.', 'node.exe': 'Node.js: runs JavaScript tools. NEXUS (the tracker) runs on it.',
  'robloxstudiobeta.exe': 'Roblox Studio, where you build and test your game.', 'blender.exe': 'Blender, the 3D modelling app.', 'obsidian.exe': 'Obsidian, your notes vault.',
  'chrome.exe': 'Google Chrome web browser. Each tab is its own process, so it often shows many times.', 'msedge.exe': 'Microsoft Edge web browser (also powers some app windows).',
  'explorer.exe': 'Windows Explorer: the taskbar, desktop and file windows.', 'dwm.exe': 'Desktop Window Manager: Windows draws every window with it. Always running.',
  'msmpeng.exe': 'Microsoft Defender antivirus scanning files. Busy after downloads or big copies.', 'svchost.exe': 'A Windows helper that hosts system services. Many copies are normal.',
  'discord.exe': 'Discord chat app.', 'code.exe': 'Visual Studio Code editor.', 'system': 'The Windows core. Always running.',
};
const SCALE = { cpu: 'Under 70 % = relaxed · 70-90 % = busy · over 90 % for minutes = slow', gpu: 'High while a game, Studio or Blender is open = normal', ram: 'Under 70 % = plenty free · over 90 % = apps may stutter', disk: 'Under 75 % full = fine · over 90 % = free up space soon' };
const WORD = { cpu: { warn: 'Busy', err: 'Very busy' }, gpu: { err: 'Maxed out' }, ram: { warn: 'High', err: 'Very high' }, disk: { warn: 'Filling up', err: 'Almost full' } };
const tw = new WeakMap(); // smooth number changes: ease from the shown value to the new one (speed from the central animation setting)
function tween(e, to, f) { if (!e) return; if (to == null || !isFinite(to)) { tw.delete(e); e.textContent = '—'; return; }
  const from = tw.get(e); tw.set(e, to); if (from == null || reduce() || Math.abs(from - to) < 1e-6) { e.textContent = f(to); return; }
  const t0 = performance.now(), d = 650 * k(), id = (e._tw = (e._tw || 0) + 1);
  const st = ts => { if (e._tw !== id || !e.isConnected) return; const p = Math.min(1, Math.max(0, (ts - t0) / d)), v = from + (to - from) * (1 - (1 - p) ** 3), s = f(v); if (e.textContent !== s) e.textContent = s; /* M7b: same digits = no relayout */ if (p < 1) requestAnimationFrame(st); };
  requestAnimationFrame(st); }
function bump(e) { if (!e || reduce()) return; e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); }
let sim = 0; // preview only: "Show warning look" pushes the DEMO samples over the limits for 30 s
const DEV = [['Roblox Studio', 'i-roblox'], ['Blender', 'i-cube'], ['Obsidian', 'i-graph'], ['Claude Code', 'i-term']];

let root, O = {}, KEY, ui, ac, raf = 0, poll = 0, proc = null, auto = null, last = 0, sy = null, pl = null, lastT = 0, down = false, lost = 0; // D3 B103: down = /api/sys not answering
const H = {}; // series name → [[t, v], …] (24 h at most)
const G = new Set(); // live graphs
const $ = id => root?.querySelector('#' + id);
const k = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--t-ui')) / 180 || 1; // central anim speed
const reduce = () => document.documentElement.classList.contains('reduce');
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ui)); } catch { } };
const now = () => Date.now();
const lastV = s => H[s]?.at(-1)?.[1];
// M7b: a card whose markup did not change is not written again (the 5 s refresh rebuilt every card: layout + paint under the glass blur + restarted CSS animations ≈ 27 % of a core)
const IH = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
const keep = e => e && Object.defineProperty(e, 'innerHTML', { configurable: true, get() { return IH.get.call(this); }, set(h) { if (this._h !== h) { this._h = h; IH.set.call(this, h); } } });

// ---------- sample generator (preview only; deterministic, labelled DEMO everywhere it shows) ----------
function noise(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function demoSeries() {
  const t1 = now(), n = 864e5 / STEP, r = noise(7);
  const mk = (name, base, amp, spike, lo = 0, hi = 100) => { let v = base; const a = new Array(n);
    for (let i = 0; i < n; i++) { const t = t1 - (n - i) * STEP, hr = new Date(t).getHours(), day = hr >= 9 && hr <= 23 ? 1 : .45;
      v += (base * day - v) * .08 + (r() - .5) * amp; let x = v + (r() < spike ? r() * 45 : 0); a[i] = [t, Math.max(lo, Math.min(hi, x))]; } H[name] = a; };
  mk('cpu', 14, 6, .012); mk('gpu', 30, 9, .02); mk('ram', 58, 1.2, 0); mk('disk', 3, 3, .03); mk('down', 2.4, 2.2, .02, 0, 120); mk('up', .6, .7, .02, 0, 40);
  mk('gtemp', 41, 1.4, 0, 30, 90); mk('vram', 14, 1, 0); mk('fan', 30, 1, 0);
}
function demoTick() { // one new reading for every series (RAM / disk from the real /api/proc when the tracker answers)
  const t = now(), r = Math.random, nx = (s, v) => { H[s].push([t, v]); while (H[s][0][0] < t - 864e5) H[s].shift(); };
  const d = (s, base, amp, lo = 0, hi = 100) => nx(s, Math.max(lo, Math.min(hi, lastV(s) + (base - lastV(s)) * .1 + (r() - .5) * amp + (r() < .03 ? r() * 30 : 0))));
  const hot = sim > t; d('cpu', hot ? 96 : 14, 7); d('gpu', hot ? 97 : 30, 10); if (hot) { H.cpu.at(-1)[1] = Math.max(H.cpu.at(-1)[1], 91 + r() * 6); H.gpu.at(-1)[1] = Math.max(H.gpu.at(-1)[1], 92); } d('disk', 3, 3); d('down', 2.4, 2.4, 0, 120); d('up', .6, .8, 0, 40); d('gtemp', hot ? 88 : 41, 1.2, 30, 90); if (hot) H.gtemp.at(-1)[1] = Math.max(H.gtemp.at(-1)[1], 84 + r() * 3); d('vram', 14, 1); d('fan', 30, 1);
  nx('ram', proc?.mem ? proc.mem[1] / proc.mem[0] * 100 : lastV('ram') + (r() - .5));
}

// ---------- smooth flowing graphs: one rAF loop, ~30 fps max, paused when hidden / off screen ----------
function graph(cv, keys, o = {}) { const g = { cv, keys, o, vis: true }; G.add(g); io?.observe(cv); return g; }
let io = null;
function frame(ts) {
  raf = requestAnimationFrame(frame); if (document.hidden || ts - last < 33) return; last = ts;
  const t = now() - STEP * 0.98; // draw one step behind so new points slide in instead of popping
  for (const g of G) if (g.vis && g.cv.isConnected) draw(g, reduce() ? now() : t);
}
function bucket(a, from, to, n) { // ≤ n points per graph (24 h = 17 280 readings → max per bucket keeps spikes visible)
  const out = [], w = (to - from) / n; let i = a.findIndex(p => p[0] >= from - w); if (i < 0) return out; i = Math.max(0, i - 1);
  if ((to - from) / STEP <= n) return a.slice(i);
  // M7b: bucket edges on a fixed time grid (not tied to the moving left edge), so the drawn points only change when data or a bucket edge does
  for (let e = (Math.floor(a[i][0] / w) + 1) * w; i < a.length; e += w) { let mx = null, tt = 0; while (i < a.length && a[i][0] < e) { if (mx == null || a[i][1] > mx) { mx = a[i][1]; tt = a[i][0]; } i++; } if (mx != null) out.push([tt, mx]); }
  return out;
}
// M7b: the costly parts (axis text, glowing line + fill) are drawn into cached layers only when the data, scale or size changes; each frame slides
// the line layer left by the elapsed time (same motion as redrawing it) and draws the gaps, head dots and hover on top. Was ≈ 7 full redraws × 30 / s.
const layer = (cv, w, h, dpr) => { cv ||= document.createElement('canvas'); cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(h * dpr); const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); return [cv, c]; };
function draw(g, t) {
  const { cv, o } = g, dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const win = o.win?.() || 6e4, from = t - win, L = o.axis ? 40 : 0, B = o.axis ? 20 : 0, T = o.axis ? 8 : 4, W = w - L - 4, HH = h - B - T;
  const sets = g.keys.map(kk => bucket(H[kk] || [], from, t, Math.min(320, Math.round(W / 3))));
  const mx = o.max || Math.max(1, ...sets.flat().map(p => p[1])) * 1.15, X = tt => L + (tt - from) / win * W, Y = v => T + (1 - Math.min(v, mx) / mx) * HH;
  if (o.axis) { const ak = [w, h, dpr, mx, win, o.unit].join();
    if (g.ak !== ak) { g.ak = ak; const [l, a] = layer(g.ax, w, h, dpr); g.ax = l;
      a.font = '600 12px Nunito, sans-serif'; a.fillStyle = '#8CA295'; a.strokeStyle = 'rgba(255,255,255,.05)'; a.lineWidth = 1;
      for (let i = 0; i <= 4; i++) { const y = T + i / 4 * HH; a.beginPath(); a.moveTo(L, y); a.lineTo(w - 4, y); a.stroke(); a.fillText(o.unit === '%' ? (100 - i * 25) + '%' : (mx * (1 - i / 4)).toFixed(1), 2, y + 4); }
      for (let i = 0; i <= 6; i++) { const x = L + i / 6 * W, ago = win * (1 - i / 6); a.fillText(i === 6 ? 'Now' : fmtAgo(ago), Math.min(x - 10, w - 30), h - 4); } }
    c.drawImage(g.ax, 0, 0, w, h); c.font = '600 12px Nunito, sans-serif'; c.fillStyle = '#8CA295'; c.strokeStyle = 'rgba(255,255,255,.05)'; c.lineWidth = 1; }
  const gaps = O.preview ? [] : (sy?.gaps || []).concat(sy?.paused ? [[sy.paused, now()]] : []); // M4d: paused spans shaded, never drawn as zero
  for (const [a, b] of gaps) { if (b < from || a > t) continue; const x0 = Math.max(L, X(a)), x1 = Math.min(L + W, X(b)); if (x1 - x0 < 1) continue;
    c.fillStyle = 'rgba(242,181,68,.07)'; c.fillRect(x0, T, x1 - x0, HH); c.fillStyle = 'rgba(242,181,68,.45)'; c.fillRect(x0, T, 1, HH); c.fillRect(x1 - 1, T, 1, HH);
    if (o.axis && x1 - x0 > 52) { c.font = '600 11px Nunito, sans-serif'; c.fillText('Paused', (x0 + x1) / 2 - 18, T + 16); } }
  const gap = Math.max(3 * STEP, 2.5 * win / Math.min(320, Math.round(W / 3))), pad = Math.ceil(2 * STEP / win * W) + 16; // pad: points newer than t wait right of the plot, then slide in
  g.sl ||= []; g.t0 ||= [];
  sets.forEach((a, si) => { if (a.length < 2) return; const col = COL[g.keys[si]] || o.color || '#31D67A';
    const sk = [w, h, dpr, mx, win, reduce(), g.keys[si], a.length, a[0][0], a.at(-1)[0], a.at(-1)[1]].join();
    if (g.sl[si]?.k !== sk) { const [l, s] = layer(g.sl[si], w + pad, h, dpr); l.k = sk; g.sl[si] = l; g.t0[si] = t;
      const segs = [[]]; a.forEach((p, i) => { if (i && p[0] - a[i - 1][0] > gap) segs.push([]); segs.at(-1).push(p); });
      const path = s2 => { s.beginPath(); s2.forEach((p, i, a) => { const x = X(p[0]), y = Y(p[1]); if (!i) return s.moveTo(x, y); const q = a[i - 1], mxp = (X(q[0]) + x) / 2; s.bezierCurveTo(mxp, Y(q[1]), mxp, y, x, y); }); };
      for (const s2 of segs) { if (s2.length < 2) continue;
        if (!o.noFill) { path(s2); s.lineTo(X(s2.at(-1)[0]), T + HH); s.lineTo(X(s2[0][0]), T + HH); s.closePath(); const f = s.createLinearGradient(0, T, 0, T + HH); f.addColorStop(0, col + '55'); f.addColorStop(1, col + '00'); s.fillStyle = f; s.fill(); }
        path(s2); s.strokeStyle = col; s.lineWidth = o.axis ? 1.8 : 1.5; s.shadowColor = col; s.shadowBlur = 10; s.stroke(); s.shadowBlur = 0; } }
    const l = g.sl[si], dx = (t - g.t0[si]) / win * W;
    c.save(); c.beginPath(); c.rect(L, 0, W, h); c.clip(); c.drawImage(l, -dx, 0, l.width / dpr, l.height / dpr);
    const p = a.at(-1), px = X(p[0]), py = Y(p[1]), pulse = reduce() ? 0 : (Math.sin(performance.now() / (420 * k())) + 1) / 2; // head dot breathes
    c.fillStyle = col + '33'; c.beginPath(); c.arc(px, py, 4 + pulse * 4, 0, 7); c.fill(); c.fillStyle = '#EAF6EE'; c.beginPath(); c.arc(px, py, 2.4, 0, 7); c.fill(); c.restore(); });
  if (g.hx != null && o.axis) { const tt = from + (g.hx - L) / W * win, a = sets[0], p = a.reduce((b, q) => Math.abs(q[0] - tt) < Math.abs(b[0] - tt) ? q : b, a[0] || [0, 0]);
    if (a.length) { const x = X(p[0]); c.strokeStyle = 'rgba(162,247,197,.35)'; c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + HH); c.stroke();
      const txt = `${o.fmt ? o.fmt(p[1]) : p[1].toFixed(1)} · ${new Date(p[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`; c.font = '12px Nunito, sans-serif';
      const tw = c.measureText(txt).width + 16, bx = Math.min(Math.max(L, x - tw / 2), w - tw - 4); c.fillStyle = 'rgba(10,15,13,.92)'; c.strokeStyle = 'rgba(49,214,122,.45)'; c.beginPath(); c.roundRect(bx, T + 2, tw, 22, 6); c.fill(); c.stroke(); c.fillStyle = '#EAF6EE'; c.fillText(txt, bx + 8, T + 17); } }
}
const fmtAgo = ms => ms >= 36e5 ? Math.round(ms / 36e5) + 'h' : ms >= 6e4 ? Math.round(ms / 6e4) + 'm' : Math.round(ms / 1e3) + 's';

// ---------- markup ----------
const help = key => `<p class="sh-help"${ui.explain ? '' : ' hidden'}>${icon('i-info')}<span>${esc(HELP[key])}</span></p>`;
const tipI = key => `<button class="sh-i" data-tip="${esc(HELP[key])}" aria-label="What is this?">${icon('i-info')}</button>`;
const src = () => O.preview ? SRC.demo : SRC.live;
const SRC = { demo: chip('demo', 'Design preview sample. The real page measures this every 5 s.'), live: chip('live', 'Real value from the tracker right now.'), det: chip('live', 'Detected on this PC (2026-10-15).').replace('LIVE', 'DETECTED') };
const card = (id, ic, t, key, body, sc = src(), end = '') => `<section class="card sh-c" id="${id}"><div class="card-h"><span class="tile-ic sm">${icon(ic)}</span><h2>${t}</h2>${tipI(key)}${MORE['sys-' + key] ? more('sys-' + key, t) : ''}${sc}<div class="end">${end}</div></div>${help(key)}${body}</section>`;
const metric = (k2, ic, t, sub) => `<section class="card sh-m" id="m-${k2}" style="--mc:${COL[k2]}"><div class="sh-mh"><span class="tile-ic">${icon(ic)}</span><div><span class="k">${t}${tipI(k2)}</span><span class="sh-vr"><b class="v" id="v-${k2}">—</b><em class="sh-wb" id="w-${k2}" aria-live="polite"></em></span><span class="f" id="f-${k2}">${sub}</span></div><span class="sh-src" id="s-${k2}">${k2 === 'ram' || k2 === 'disk' ? SRC.live : src()}</span></div><div class="sh-mx" id="x-${k2}"></div><p class="sh-sc"${ui.explain ? '' : ' hidden'}>${esc(SCALE[k2])}</p><div class="sh-spw"><canvas class="sh-sp" id="c-${k2}" role="img" aria-label="${t} over the last minute"></canvas></div></section>`;
const bar = (p, c) => `<span class="sh-bar" style="--p:${Math.max(0, Math.min(100, p))}%;--bc:${c}"><i></i></span>`;
const level = p => p >= 90 ? 'err' : p >= 70 ? 'warn' : 'ok';

// processes (sample rows; the real page lists live processes with CPU from cumulative CPU-time deltas)
const PROCS = [['RobloxStudioBeta.exe', 9.8, 1.42e9, 'dev'], ['claude.exe', 2.6, 3.1e8, 'dev'], ['blender.exe', 0, 0, 'dev'], ['chrome.exe', 1.9, 6.8e8, 'app'], ['Obsidian.exe', 0.4, 2.9e8, 'dev'], ['node.exe', 0.3, 8.5e7, 'nexus'],
  ['MsMpEng.exe', 0.8, 2.1e8, 'bg'], ['dwm.exe', 1.1, 1.3e8, 'bg'], ['explorer.exe', 0.2, 1.9e8, 'bg'], ['svchost.exe', 0.5, 6.0e7, 'bg'], ['Discord.exe', 0.6, 3.4e8, 'app'], ['System', 0.4, 1.0e6, 'bg']].filter(p => p[2]);
const SVC = [
  ['tracker', 'Tracker server', 'i-pulse', 'The NEXUS engine at 127.0.0.1:7788. Every page gets its data from it.', 'If it stops, this page shows "Tracker offline" and nothing updates.', '#/home'],
  ['hook', 'Usage tracking', 'i-chart', 'Counts tokens for every Claude Code request (a tiny hook).', 'Without it, Analytics and Sessions stop growing.', '#/analytics'],
  ['auto', 'Automation scheduler', 'i-flow', 'Runs your scheduled automations inside the tracker.', 'Paused means no scheduled runs; Run Now still works.', '#/automation'],
  ['sync', 'Doc sync', 'i-refresh', 'Merges project docs with your Obsidian vault (sync_docs.sh).', 'A CONFLICT needs you to pick a version; NEXUS never picks for you.', '#/knowledge'],
  ['graph', 'Graphify graph', 'i-graph', 'The knowledge graph rebuilt on every doc sync.', 'Unresolved links mean a [[note]] points nowhere.', '#/knowledge'],
  ['obs', 'Obsidian app', 'i-book', 'Your notes app. NEXUS works without it, but opening notes needs it.', 'Unavailable just means it is closed.', '#/knowledge'],
  ['cc', 'Claude Code', 'i-term', 'The AI assistant sessions on this PC.', 'Shows how many are running right now.', '#/claude-code'],
];
const ALERTS = [ // sample alerts in the approved plain-language format
  ['warn', 'Free RAM was low for 4 minutes', 'Only 1.2 GB of memory was free while Roblox Studio and Chrome were open.', 'Apps may stutter or close unsaved work when memory runs out.', 'Close browser tabs or apps you are not using. Recovered by itself 11 min later.', 52 * 6e4, true],
  ['err', 'Doc sync needs attention', 'sync_docs.sh reported a CONFLICT in PROJECT_DOCS.md.', 'The doc and its Obsidian copy changed in the same place; both versions were kept.', 'Open Obsidian & Graphify, choose which version to keep, then sync again.', 3.2 * 36e5, false],
  ['ok', 'GPU temperature back to normal', 'The graphics card is at 64 °C again after 86 °C during a Blender render.', 'Long periods above 83 °C make the card slow itself down.', 'Nothing to do. Keep the case vents clear.', 20 * 36e5, true],
];

function shell() {
  return `<div class="pg sh enter">
  <header class="pg-h" style="--i:0"><span class="tile-ic pg-ic">${icon('i-pulse')}</span>
    <div class="pg-t"><h1>System Health ${O.preview ? chip('demo', 'Design preview: RAM, C: disk, NEXUS footprint, dev-app memory and the scheduler are real; other readings are samples. Nothing changes on this PC.').replace('DEMO', 'PREVIEW') : '<span class="chip warn" id="sh-pc" data-tip="Monitoring is paused: no CPU, GPU, RAM, disk, network or process readings are taken. Everything else in NEXUS keeps running." hidden>PAUSED</span>'}</h1>
      <p>How hard your PC is working right now, explained simply. Measured on this PC only.</p></div>
    <div class="end"><div id="sh-r">${seg(RANGES.map(([v]) => [v, v]), ui.range)}</div>
      <label class="sh-ex"><input type="checkbox" id="sh-ex" ${ui.explain ? 'checked' : ''}><i></i><span>Explain</span></label>
      ${O.preview ? `<button class="btn ghost" data-a="sim" data-tip="Preview only: pushes the DEMO samples over the safe limits for 30 seconds so you can see how warnings look. Nothing on this PC changes.">${icon('i-warn')}Show warning look</button>` : `<button class="btn" data-a="pause" id="sh-pz" data-tip="Pause stops only the System Health readings (CPU, GPU, RAM, disk, network, processes) to save CPU. Token tracking, hooks, automations and doc sync keep running. Resume is instant; the paused time shows as a gap."></button>${more('sys-pause', 'Pause monitoring')}`}<button class="btn" data-a="refresh">${icon('i-refresh')}Refresh</button><a class="btn sq" href="#/settings/system" data-tip="Settings → System Health: alert limits, sounds, sampling" aria-label="System Health settings">${icon('i-gear')}</a></div></header>
  <div id="sh-eb"></div>
  <div class="sh-grid" style="--i:1">
    <div class="sh-ms">${metric('cpu', 'i-chip', 'CPU', O.preview ? 'Intel Core i5-14400F' : esc(sy?.cpu?.name || '—'))}${metric('gpu', 'i-cube', 'GPU', O.preview ? 'NVIDIA GeForce RTX 4060' : esc(sy?.gpu?.name || 'No NVIDIA GPU reading'))}${metric('ram', 'i-db', 'RAM', '—')}${metric('disk', 'i-layers', 'Disk', '—')}</div>
    <section class="card sh-st" id="sh-st"></section>
    ${card('sh-pg', 'i-chart', 'Performance Graphs', 'graph', `<div class="sh-gw"><canvas id="c-big" role="img" aria-label="Performance graph"></canvas></div><div class="sh-leg" id="sh-leg"></div>`, src(), `<div id="sh-gt">${seg([['cpu', 'CPU'], ['gpu', 'GPU'], ['ram', 'RAM'], ['disk', 'Disk'], ['net', 'Network']], ui.gt)}</div>`)}
    ${card('sh-gd', 'i-cube', 'GPU Details', 'gpuD', `<div class="sh-gg" id="sh-gg"></div><div class="sh-kv" id="sh-gk"></div>`, src())}
    <div class="sh-l">
    ${card('sh-pr', 'i-layers', 'Processes', 'proc', `<div class="sh-pt"><div id="sh-pf">${seg([['all', 'All'], ['cpu', 'High CPU'], ['mem', 'High Memory'], ['dev', 'Dev apps'], ['bg', 'Background']], ui.pf, 'tabs chips')}</div>
      <label class="sh-q">${icon('i-search')}<input id="sh-q" placeholder="Search processes…" aria-label="Search processes" value="${esc(ui.q)}"></label></div><div class="sh-tw"><table class="sh-t"><thead><tr>${[['n', 'Name'], ['c', 'CPU'], ['m', 'Memory'], ['s', 'Status']].map(([kk, t]) => `<th data-s="${kk}" class="${kk === 'n' ? '' : 'num'}" tabindex="0" aria-sort="${ui.ps[0] === kk ? (ui.ps[1] > 0 ? 'ascending' : 'descending') : 'none'}">${t}<span class="sh-so">${ui.ps[0] === kk ? (ui.ps[1] > 0 ? '▲' : '▼') : ''}</span></th>`).join('')}<th aria-label="Actions"></th></tr></thead><tbody id="sh-pb"></tbody></table></div>`, src(), '<span class="muted" id="sh-pn"></span>')}
    <div class="sh-cs">
      ${card('sh-sv', 'i-shield', 'Services', 'svc', '<div class="sh-svl" id="sh-svl"></div>', O.preview ? chip('live', 'Scheduler, Obsidian and Claude Code are real; the rest are samples in this preview.') : SRC.live, '<span class="chip ok" id="sv-n"></span>')}
      ${card('sh-al', 'i-bell', 'Recent Alerts', 'alerts', '<div class="sh-all" id="sh-all"></div>', src(), '<span class="muted">7 days</span>')}</div>
    </div>
    <div class="sh-r">
    ${card('sh-net', 'i-arrow-down', 'Network', 'net', `<div class="sh-nw"><div><span class="k">Download</span><b id="v-down">—</b></div><canvas id="c-down" role="img" aria-label="Download over the selected range"></canvas></div><div class="sh-nw"><div><span class="k">Upload</span><b id="v-up">—</b></div><canvas id="c-up" role="img" aria-label="Upload over the selected range"></canvas></div>
      <div class="sh-kv"><span>Adapter</span><b id="net-a">${O.preview ? 'Ethernet · Realtek PCIe GbE' : '—'}</b><span>Link speed</span><b id="net-l">${O.preview ? '1 Gbps' : '—'}</b><span>Ping</span><b class="muted" data-tip="Measuring ping means sending traffic to an outside server. NEXUS keeps everything on this PC, so it is not measured.">Not measured</b></div>`, src(), '<span class="chip ok" id="net-st">Connected</span>')}
      ${card('sh-sto', 'i-db', 'Storage', 'storage', '<div id="sh-sb"></div>', O.preview ? SRC.det : SRC.live)}
      ${card('sh-dev', 'i-code', 'Development Apps', 'apps', '<div class="sh-dv" id="sh-dv"></div>', SRC.live)}
      ${card('sh-ft', 'i-heart', 'NEXUS Footprint', 'foot', '<div class="sh-kv" id="sh-fk"></div>', SRC.live)}
    </div>
  </div></div>`;
}

// ---------- renders ----------
const fmtR = v => v >= 1 ? v.toFixed(1) + ' MB/s' : Math.round(v * 1000) + ' KB/s';
function metrics() {
  const set = (kk, v, f) => { const e = $('v-' + kk); if (!e) return; const l = v == null ? '' : kk === 'gpu' ? (v >= 98 ? 'err' : 'ok') : kk === 'disk' ? (v >= 95 ? 'err' : v >= 90 ? 'warn' : 'ok') : level(v), c = $('m-' + kk), w = $('w-' + kk); tween(e, v, x => Math.round(x) + '%');
    if (c.dataset.l !== l) { c.dataset.l = l; e.dataset.l = l; w.textContent = l && l !== 'ok' ? WORD[kk][l] : ''; if (l && l !== 'ok') bump(c); } if (f) $('f-' + kk).textContent = f; };
  for (const kk of ['cpu', 'gpu', 'ram', 'disk']) { const a = (H[kk] || []).filter(p => p[0] >= now() - 6e4).map(p => p[1]), e = $('x-' + kk); if (e && a.length) e.innerHTML = `<span>${kk === 'disk' ? 'activity, ' : ''}last minute: avg <b>${Math.round(a.reduce((x, y) => x + y, 0) / a.length)}%</b></span><span>peak <b>${Math.round(Math.max(...a))}%</b></span>`; }
  set('cpu', lastV('cpu'), O.preview ? null : sy?.cpu?.name || '—'); set('gpu', O.preview || sy?.gpu?.util != null ? lastV('gpu') : null, O.preview ? null : sy?.gpu?.name || (sy?.err?.gpu ? 'Not measured' : 'Tracker offline'));
  if (!O.preview && sy?.net) { $('net-a').textContent = sy.net.name || '—'; $('net-l').textContent = sy.net.link ? (sy.net.link >= 1e9 ? sy.net.link / 1e9 + ' Gbps' : Math.round(sy.net.link / 1e6) + ' Mbps') : '—'; const ns = $('net-st'); ns.textContent = sy.net.up ? 'Connected' : 'Disconnected'; ns.className = 'chip ' + (sy.net.up ? 'ok' : 'warn'); }
  set('ram', lastV('ram'), proc?.mem ? `${(proc.mem[1] / 1e9).toFixed(1)} / ${(proc.mem[0] / 1e9).toFixed(1)} GB used` : 'Tracker offline');
  const dk = proc?.disk; set('disk', dk ? dk[1] / dk[0] * 100 : null, dk ? `C: ${Math.round(dk[1] / 1e9)} / ${Math.round(dk[0] / 1e9)} GB used` : 'Tracker offline');
  tween($('v-down'), lastV('down'), fmtR); tween($('v-up'), lastV('up'), fmtR);
}
function status() {
  const cpu = lastV('cpu'), ram = proc?.mem ? (proc.mem[0] - proc.mem[1]) / 1e9 : null, free = proc?.disk ? (proc.disk[0] - proc.disk[1]) / 1e9 : null, gt = lastV('gtemp');
  const lim = (kk, d) => sy?.limits?.[kk] ?? d, dmin = !O.preview && sy?.disks?.length ? Math.min(...sy.disks.map(x => (x[1] - x[2]) / 1e9)) : free;
  const tpE = !O.preview && sy?.err?.tp; // B104: the CPU / disk / network reader failed: say so instead of showing an old number
  const rows = [tpE ? ['Processor', 'na', 'Not measured', `The CPU reader (typeperf) failed: ${tpE}. NEXUS restarts it by itself; CPU, disk activity and network show no new readings until then.`]
    : ['Processor', cpu == null ? 'na' : cpu > lim('cpu', 90) ? 'warn' : 'ok', cpu == null ? 'Unknown' : cpu > lim('cpu', 90) ? 'Very busy' : 'Normal', `How busy the processor is. Over ${lim('cpu', 90)} % for ${lim('sustain', 2)} min raises an alert.`],
    ['Memory', ram == null ? 'na' : ram < lim('ram', 1.5) ? 'warn' : 'ok', ram == null ? 'Unknown' : ram.toFixed(1) + ' GB free', `Below ${lim('ram', 1.5)} GB free for ${lim('sustain', 2)} min raises an alert.`],
    ['Disk space', dmin == null ? 'na' : dmin < lim('disk', 10) ? 'warn' : 'ok', dmin == null ? 'Unknown' : Math.round(dmin) + ' GB free' + (!O.preview && sy?.disks?.length > 1 ? ' (lowest drive)' : ''), `Below ${lim('disk', 10)} GB free on any drive raises an alert.`],
    ['GPU temperature', gt == null ? 'na' : gt > lim('gtemp', 83) ? 'warn' : 'ok', gt == null ? 'Not measured' : Math.round(gt) + ' °C', `How hot the graphics card is. Above ${lim('gtemp', 83)} °C for ${lim('sustain', 2)} min raises an alert.`],
    O.preview ? ['Services', auto ? 'ok' : 'na', auto ? (auto.paused ? 'Scheduler paused' : 'All running') : 'Unknown', 'A NEXUS service failure alerts right away.']
      : (n => ['Services', !sy ? 'na' : n ? 'warn' : 'ok', !sy ? 'Unknown' : n ? n + ' need' + (n > 1 ? '' : 's') + ' attention' : 'No problems', 'A NEXUS service failure alerts right away.'])(sy ? Object.values(sy.services).filter(v => v[0] === 'att').length : 0)];
  const bad = rows.filter(r => r[1] === 'warn').length, st = !proc ? ['na', 'Tracker offline', 'NEXUS cannot read this PC right now. Start node tracker.js serve.'] : bad ? ['warn', 'Needs attention', `${bad} reading${bad > 1 ? 's are' : ' is'} above the safe limit right now. An alert fires if it lasts 2 minutes.`] : ['ok', 'Healthy', 'Everything is within safe limits.'];
  const was = $('sh-st').dataset.s; $('sh-st').dataset.s = st[0]; $('sh-st').dataset.p = '';
  $('sh-st').innerHTML = `<div class="card-h"><span class="tile-ic sm">${icon('i-shield')}</span><h2>System Status</h2>${tipI('alerts')}</div>
    <div class="sh-big ${st[0]}"><span class="sh-orb"><i></i></span><div><b>${st[1]}</b><span>${st[2]}</span></div></div>
    <ul class="sh-chk">${rows.map(r => `<li class="${r[1]}" data-tip="${esc(r[3])}">${icon(r[1] === 'ok' ? 'i-check' : r[1] === 'na' ? 'i-info' : 'i-warn')}<span>${r[0]}</span><b>${esc(r[2])}</b></li>`).join('')}</ul>`;
  if (was && was !== st[0]) bump($('sh-st').querySelector('.sh-big'));
}
function gpu() {
  const G2 = sy?.gpu; if (!O.preview && !G2?.at) { $('sh-gg').innerHTML = ''; $('sh-gk').innerHTML = `<span>Reading</span><b class="muted">${esc(sy?.err?.gpu || (sy ? 'Waiting for the first reading…' : 'Tracker offline'))}</b>`; return; }
  const g = [['Usage', lastV('gpu'), '%', 100, 'How busy the graphics card is.'], ['Temperature', lastV('gtemp'), '°C', 100, 'Heat of the GPU chip. Under 80 °C is comfortable; above 83 °C it slows down to protect itself.'],
    ['VRAM', lastV('vram'), '%', 100, 'Graphics memory (' + (O.preview ? 8 : Math.round((sy?.gpu?.mt || 8192) / 1024)) + ' GB). Textures and 3D scenes live here. Full VRAM makes Blender and Studio swap and stutter.'], ['Fan', lastV('fan'), '%', 100, 'How fast the GPU fans spin. Higher = more cooling, more noise.']];
  const gg = $('sh-gg'); if (!gg.children.length) gg.innerHTML = g.map(([t, , , , tip]) => `<div class="sh-ga" data-tip="${esc(tip)}"><svg viewBox="0 0 64 40"><path class="bg" d="M6 36a26 26 0 0 1 52 0"/><path class="fg" d="M6 36a26 26 0 0 1 52 0" style="--p:0"/></svg><b>—</b><span>${t}</span></div>`).join('');
  g.forEach(([t, v, u, mx], i) => { const el = gg.children[i], hot = t === 'Temperature' ? (v > 83 ? 'err' : v > 75 ? 'warn' : '') : v >= 95 ? 'warn' : '';
    el.querySelector('.fg').style.setProperty('--p', v == null ? 0 : Math.min(1, v / mx)); el.dataset.l = hot; tween(el.querySelector('b'), v, x => Math.round(x) + u); });
  if (!O.preview) { const gb = v => v == null ? '—' : (v / 1024).toFixed(1);
    $('sh-gk').innerHTML = `<span data-tip="How fast the GPU's cores run right now. Rises under load, drops when idle to save power.">Core clock</span><b>${G2.gr ?? '—'} MHz${G2.maxgr ? ` <span class="muted">/ ${G2.maxgr} max</span>` : ''}</b>
    <span data-tip="Speed of the graphics memory.">Memory clock</span><b>${G2.mem ?? '—'} MHz</b><span data-tip="Graphics memory in use out of the card's total.">VRAM used</span><b>${gb(G2.mu)} / ${gb(G2.mt)} GB</b>
    ${G2.pw != null ? `<span data-tip="Power the card draws right now.">Power draw</span><b>${Math.round(G2.pw)} W</b>` : '<span data-tip="This driver does not report live power draw (nvidia-smi shows N/A), so NEXUS does not show a number.">Power draw</span><b class="muted">Not reported by the driver</b>'}
    <span data-tip="The most power the card is allowed to use.">Power limit</span><b>${G2.plim != null ? Math.round(G2.plim) + ' W' : '—'}</b>`; return; }
  $('sh-gk').innerHTML = `<span data-tip="How fast the GPU's cores run right now. Rises under load, drops when idle to save power.">Core clock</span><b>${Math.min(3105, Math.round(525 + lastV('gpu') * 20))} MHz <span class="muted">/ 3105 max</span></b>
    <span data-tip="Speed of the graphics memory.">Memory clock</span><b>5001 MHz</b><span data-tip="VRAM in use out of the card's 8 GB.">VRAM used</span><b>${(lastV('vram') / 100 * 8.19).toFixed(1)} / 8.2 GB</b>
    <span data-tip="This driver does not report live power draw (nvidia-smi shows N/A), so NEXUS does not show a number.">Power draw</span><b class="muted">Not reported by the driver</b><span data-tip="The most power the card is allowed to use.">Power limit</span><b>115 W</b>`;
}
function storage() {
  const D = O.preview ? [['C:', proc?.disk ? proc.disk[1] : 891.6e9, proc?.disk ? proc.disk[0] : 998.5e9, 'System drive (Windows + apps)'], ['D:', 323.0e9, 1000.2e9, 'Second drive']]
    : (sy?.disks || []).map(([n, t, u]) => [n, u, t, n === 'C:' ? 'System drive (Windows + apps)' : 'Drive ' + n]);
  if (!D.length) { $('sh-sb').innerHTML = `<p class="muted">${sy ? 'No drives readable' : 'Tracker offline'}</p>`; return; }
  $('sh-sb').innerHTML = D.map(([n, u, t, s]) => { const p = u / t * 100, c = p > 90 ? 'var(--error)' : p > 75 ? 'var(--warn)' : 'var(--primary)';
    return `<div class="sh-dr"><span class="sh-dn">${n}</span><div><div class="sh-dl"><span>${s}</span><b>${bytes(t - u)} free</b></div>${bar(p, c)}<span class="sh-ds">${bytes(u)} of ${bytes(t)} used (${Math.round(p)}%)</span></div></div>`; }).join('');
}
const DRE = { 'Roblox Studio': /^robloxstudio/i, Blender: /^blender\.exe$/i, Obsidian: /^obsidian\.exe$/i, 'Claude Code': /^claude\.exe$/i };
function dev() {
  const m = Object.fromEntries(proc?.apps || []), pc = {}; if (!O.preview && pl?.list?.length) for (const [n, re] of Object.entries(DRE)) { const p = pl.list.find(x => re.test(x[0])); m[n] = p ? p[2] : 0; pc[n] = p ? p[1] : 0; }
  $('sh-dv').innerHTML = DEV.map(([n, ic]) => { const b = m[n], on = b > 0;
    return `<div class="sh-da${on ? ' on' : ''}"><span class="tile-ic sm">${icon(ic)}</span><div><b>${n}</b><span>${proc ? on ? 'Running' : 'Not running' : 'Unknown'}</span></div><div class="sh-dm"><b>${on ? bytes(b) : '—'}</b><span>memory</span></div>
      <div class="sh-dm" data-tip="${O.preview ? 'Per-app CPU arrives with the real sampler (sample value in this preview)' : 'Share of the whole CPU this app used in the last reading.'}"><b>${on ? O.preview ? (n === 'Claude Code' ? 2.6 : n === 'Roblox Studio' ? 9.8 : 0.4).toFixed(1) + '%' : pc[n] != null ? pc[n].toFixed(1) + '%' : '…' : '—'}</b><span>CPU ${on ? '<i class="sh-dot"></i>' : ''}</span></div></div>`; }).join('');
}
function footprint() {
  const F2 = sy?.foot; if (!O.preview) { $('sh-fk').innerHTML = F2 ? `<span data-tip="Share of the whole CPU the tracker used since the last reading.">Tracker CPU</span><b>${F2.cpu.toFixed(1)}%</b>
    <span data-tip="Memory the tracker process holds.">Tracker memory</span><b>${bytes(F2.rss)}</b><span data-tip="24 h of readings on disk (NEXUS_DATA/sys-history.ndjson). Older readings are dropped every hour.">History file</span><b>${bytes(F2.hist)} · ${F2.rows.toLocaleString()} readings</b>
    <span data-tip="CPU used by the measuring tools (typeperf + nvidia-smi) in the last reading. The process list only runs while this page is open.">Sampler cost</span><b>${F2.sampler == null ? '<span class="muted">reading…</span>' : F2.sampler.toFixed(1) + '%'}</b>` : '<span>Tracker</span><b class="muted">offline</b>'; return; }
  $('sh-fk').innerHTML = proc ? `<span data-tip="Share of the whole CPU the tracker used since the last reading.">Tracker CPU</span><b>${proc.cpu.toFixed(1)}%</b>
    <span data-tip="Memory the tracker process holds.">Tracker memory</span><b>${bytes(proc.rss)}</b><span data-tip="Size of NEXUS's own data files (usage logs, settings).">Data folder</span><b>${bytes(proc.data)}</b>
    <span data-tip="The planned 24 h history file. Capped, oldest readings dropped first.">History file</span><b class="muted">≈ 1-2 MB (after build)</b><span data-tip="Measured after the sampler is built and shown here live.">Sampler cost</span><b class="muted">measured after build</b>` : '<span>Tracker</span><b class="muted">offline</b>';
}
function procs() {
  const src2 = O.preview ? PROCS : pl?.list || [];
  if (!O.preview && !src2.length) { $('sh-pn').textContent = ''; $('sh-pb').innerHTML = `<tr><td colspan="5" class="muted">${pl ? pl.err ? `Process list unavailable: ${esc(pl.err)}. Press Refresh to try again.` : 'Reading the process list… (first reading in about 5 s)' : 'Tracker offline'}</td></tr>`; return; }
  const q = ui.q.toLowerCase(), f = ui.pf, L = src2.filter(p => (!q || p[0].toLowerCase().includes(q)) && (f === 'all' || (f === 'cpu' ? p[1] >= 2 : f === 'mem' ? p[2] >= 3e8 : p[3] === f)));
  const [sk, sd] = ui.ps, key = { n: 0, c: 1, m: 2, s: 1 }[sk]; L.sort((a, b) => (typeof a[key] === 'string' ? a[key].localeCompare(b[key]) : a[key] - b[key]) * sd);
  $('sh-pn').textContent = `${L.length} shown`;
  $('sh-pb').innerHTML = L.map(p => { const heavy = p[1] >= 5 || p[2] >= 1e9, open = ui.open === p[0];
    return `<tr class="${heavy ? 'heavy' : ''}${open ? ' open' : ''}" data-p="${esc(p[0])}" tabindex="0" aria-expanded="${open}"><td><span class="sh-pi">${p[0].slice(0, 1).toUpperCase()}</span>${esc(p[0])}${heavy ? `<span class="chip warn" data-tip="Using a lot of ${p[1] >= 5 ? 'CPU' : 'memory'} compared with other programs.">Heavy</span>` : ''}</td>
      <td class="num"><span class="sh-cv">${p[1].toFixed(1)}%</span>${bar(p[1] * 4, p[1] >= 5 ? 'var(--warn)' : 'var(--primary)')}</td><td class="num">${bytes(p[2])}</td><td class="num"><span class="sh-run"><i></i>Running</span></td>
      <td><button class="sh-km" data-m="${esc(p[0])}" data-pid="${p[4]?.[0] ?? ''}" aria-label="Actions for ${esc(p[0])}">⋮</button></td></tr>${open ? `<tr class="sh-pd"><td colspan="5"><b>What is this?</b> ${esc(WHAT[p[0].toLowerCase()] || 'A program running on this PC. NEXUS shows it but never ends or changes it.')}
      <span class="muted"> · ${O.preview ? `PID ${1000 + p[0].length * 37} · started ${Math.round(p[0].length * 3.1)} min ago (sample)` : `${p[4].length > 1 ? p[4].length + ' copies, PIDs ' : 'PID '}${p[4].slice(0, 8).join(', ')}${p[4].length > 8 ? '…' : ''} · memory = private working set`}</span></td></tr>` : ''}`; }).join('') || '<tr><td colspan="5" class="muted">No process matches.</td></tr>';
}
function services(spin) {
  const m = Object.fromEntries(proc?.apps || []), cc = m['Claude Code'] > 0;
  const st = !O.preview ? sy?.services || Object.fromEntries(SVC.map(x => [x[0], ['na', 'Unknown', 'tracker offline']])) : { tracker: proc ? ['run', 'Running', 'up 6h 12m (sample)'] : ['na', 'Unavailable', 'not answering'], hook: ['run', 'Running', 'last event 8 s ago (sample)'],
    auto: auto ? auto.paused ? ['pause', 'Paused', 'scheduled runs off'] : ['run', 'Running', `${auto.items.filter(a => a.on).length} enabled · last ${auto.runs?.[0]?.res || 'no runs yet'}`] : ['na', 'Unavailable', 'not reachable'],
    sync: ['run', 'Running', 'last sync OK, 0 conflicts (sample)'], graph: ['run', 'Running', '0 unresolved links (sample)'],
    obs: proc ? m.Obsidian > 0 ? ['run', 'Running', bytes(m.Obsidian) + ' memory'] : ['na', 'Unavailable', 'closed'] : ['na', 'Unknown', ''], cc: proc ? cc ? ['run', 'Running', bytes(m['Claude Code']) + ' memory'] : ['na', 'Unavailable', 'no session'] : ['na', 'Unknown', ''] };
  const n = SVC.filter(s => st[s[0]][0] === 'run').length; $('sv-n').textContent = `${n} / ${SVC.length} running`;
  $('sh-svl').innerHTML = SVC.map(([id, t, ic, what, why, href]) => { const [c, l, d] = st[id];
    return `<div class="sh-sv ${c}${spin === id ? ' spin' : ''}" data-tip="${esc(what + ' ' + why)}"><span class="sh-sd"><i></i></span>${icon(ic)}<div><b>${t}</b><span>${esc(d)}</span></div><em>${l}</em>
      <button class="sh-ib" data-chk="${id}" aria-label="Check ${t} again" data-tip="Check again (only re-reads the status)">${icon('i-refresh')}</button><a class="sh-ib" href="${href}" aria-label="Open the ${t} page">${icon('i-chev')}</a></div>`; }).join('');
}
function alerts() {
  const list = O.preview ? ALERTS : (sy?.alerts || []).map(a => [a.rec ? 'ok' : a.lvl, a.title, a.what + (a.rec ? ` Back to normal after ${fmtAgo(a.rec - a.t)}.` : ''), a.why, a.todo, now() - a.at, !!a.rec]);
  if (!list.length) { $('sh-all').innerHTML = `<p class="muted sh-none">${sy || O.preview ? 'No alerts in the last 7 days. NEXUS watches CPU, memory, disk space, GPU temperature and its own services.' : 'Tracker offline'}</p>`; return; }
  $('sh-all').innerHTML = list.map(([c, t, what, why, todo, ago2, rec], i) => `<details class="sh-a ${c}"${i === 0 ? ' open' : ''}><summary><span class="sh-sd"><i></i></span><b>${t}</b><span class="muted">${fmtAgo(ago2)} ago</span>${rec ? '<span class="chip ok">Recovered</span>' : ''}</summary>
    <dl><dt>What happened</dt><dd>${esc(what)}</dd><dt>Why it matters</dt><dd>${esc(why)}</dd><dt>What you can safely do</dt><dd>${esc(todo)}</dd></dl></details>`).join('');
}
function legend() {
  const ks = ui.gt === 'net' ? ['down', 'up'] : [ui.gt], nm = { cpu: 'CPU usage', gpu: 'GPU usage', ram: 'RAM used', disk: 'Disk activity', down: 'Download', up: 'Upload' };
  const win = RANGES.find(r => r[0] === ui.range)[1], from = now() - win;
  $('sh-leg').innerHTML = ks.map(kk => { const a = (H[kk] || []).filter(p => p[0] >= from).map(p => p[1]), av = a.reduce((s, v) => s + v, 0) / (a.length || 1), mx = Math.max(0, ...a), f = kk === 'down' || kk === 'up' ? fmtR : v => Math.round(v) + '%';
    return `<span><i style="background:${COL[kk]}"></i>${nm[kk]}</span><span class="muted">avg <b>${f(av)}</b> · peak <b>${f(mx)}</b> · ${a.length.toLocaleString()} readings</span>`; }).join('');
}
// ---------- paused (M4d): no old readings shown as live; history and the paused gap stay on the graphs ----------
const PZ = () => !O.preview && !!sy?.paused;
function hdr() { const b = $('sh-pz'); if (!b) return; b.innerHTML = PZ() ? icon('i-play') + 'Resume monitoring' : icon('i-timer') + 'Pause monitoring'; b.classList.toggle('pri', PZ()); $('sh-pc').hidden = !PZ();
  const [cl, tx, tp] = PZ() ? ['warn', 'PAUSED', 'Monitoring is paused: this card is not being measured.'] : down ? ['unk', 'OFFLINE', 'The tracker is not answering: this card gets no new readings.'] : ['live', 'LIVE', 'Real value from the tracker right now.'];
  root.querySelectorAll('.sh-m .sh-src .chip, :is(#sh-pg, #sh-gd, #sh-pr, #sh-net, #sh-sto) .card-h > .chip').forEach(c => { c.dataset.rd ??= c.classList.contains('live') ? '1' : ''; if (!c.dataset.rd) return; // reading cards only: services, dev apps and footprint keep their own chip
    if (c.textContent !== tx) { c.className = 'chip ' + cl; c.textContent = tx; c.dataset.tip = tp; } });
  paint(); }
function lock() { // E1: actions that need the tracker are off while it is gone (runs after services(), which may rebuild the buttons)
  if (!O.preview) for (const b of root.querySelectorAll('#sh-pz, [data-chk]')) { b.disabled = down; if (down) { b.dataset.tip0 ??= b.dataset.tip || ''; b.dataset.tip = 'Needs the tracker, which is not answering. See the card at the top.'; } else if (b.dataset.tip0 != null) { b.dataset.tip = b.dataset.tip0; delete b.dataset.tip0; } } }
function paint() { // D3 E1: tracker-lost card at the page top, written only when it changes (keeps focus on Retry now)
  const eb = $('sh-eb'); if (!eb) return; const k = down ? 'd' : ''; if (eb.dataset.k === k) return; eb.dataset.k = k;
  eb.innerHTML = down ? errBox({ title: 'Tracker not reachable', where: 'System Health', what: "NEXUS can't reach its tracker, so this page gets no new CPU, GPU, memory, disk, network or process readings.",
    why: 'Numbers on this page would be out of date, so they are hidden instead of shown as live.', affected: 'Readings, alerts, Pause / Resume and Check again. Graph history already loaded stays visible. This page asks again every 5 s while it is open.',
    steps: ['Make sure the tracker is running: node ~/.claude/token-tracker/tracker.js serve', 'Press Retry now.'], actions: [['retry', 'Retry now', true]], more: ['sys-down', 'Tracker not reachable'],
    tech: `GET /api/sys failed${lost ? ' since ' + new Date(lost).toLocaleTimeString() : ''}.` }) : ''; }
function downView() { // B103: no old reading shown as live while the tracker is gone
  for (const kk of ['cpu', 'gpu', 'ram', 'disk']) { tween($('v-' + kk), null); $('m-' + kk).dataset.l = ''; $('w-' + kk).textContent = ''; $('f-' + kk).textContent = 'No new readings'; $('x-' + kk).innerHTML = ''; }
  tween($('v-down'), null); tween($('v-up'), null); const ns = $('net-st'); ns.textContent = 'Unknown'; ns.className = 'chip unk'; status(); gpu(); storage(); procs(); }
function pausedView() {
  for (const kk of ['cpu', 'gpu', 'ram', 'disk']) { tween($('v-' + kk), null); $('m-' + kk).dataset.l = ''; $('w-' + kk).textContent = ''; $('f-' + kk).textContent = 'Monitoring paused'; $('x-' + kk).innerHTML = ''; }
  tween($('v-down'), null); tween($('v-up'), null); const ns = $('net-st'); ns.textContent = 'Paused'; ns.className = 'chip warn';
  const since = new Date(sy.paused).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), sc = $('sh-st'); if (sc.dataset.p == sy.paused) return; // drawn once per pause, so the Resume button is not replaced every poll
  sc.dataset.s = 'na'; sc.dataset.p = sy.paused; sc.innerHTML = `<div class="card-h"><span class="tile-ic sm">${icon('i-shield')}</span><h2>System Status</h2>${tipI('alerts')}</div>
    <div class="sh-big na"><span class="sh-orb"><i></i></span><div><b>Monitoring paused</b><span>Since ${since}. CPU, GPU, RAM, disk, network and process readings are off, and hardware alerts are not checked. Token tracking, hooks, automations, doc sync and service checks keep running.</span></div></div>
    <button class="btn pri" data-a="pause">${icon('i-play')}Resume monitoring</button>`;
  $('sh-gg').innerHTML = ''; $('sh-gk').innerHTML = '<span>Reading</span><b class="muted">Paused</b>';
  $('sh-sb').innerHTML = '<p class="muted">Paused. Drive space is read again on Resume.</p>';
  $('sh-pn').textContent = ''; $('sh-pb').innerHTML = '<tr><td colspan="5" class="muted">Paused. The process list starts again on Resume.</td></tr>';
}
function all() { hdr(); if (PZ()) pausedView(); else if (down) downView(); else { metrics(); status(); gpu(); storage(); procs(); } dev(); footprint(); services(); alerts(); legend(); lock(); }
const live = () => { hdr(); if (PZ()) pausedView(); else if (down) downView(); else { metrics(); status(); gpu(); if (!O.preview) { storage(); procs(); } } dev(); footprint(); services(); legend(); if (!O.preview) alerts(); lock(); };

// ---------- data ----------
const getJ = async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return r.json(); };
const ROW = [['cpu', 1], ['ram', 2], ['disk', 3], ['down', 4, 1e6], ['up', 5, 1e6], ['gpu', 6], ['gtemp', 7], ['vram', 8], ['fan', 9]]; // /api/sys/hist row → series (network B/s → MB/s)
function addRows(rows) { for (const r of rows) { if (r[0] <= lastT) continue; lastT = r[0]; for (const [kk, i, d] of ROW) if (r[i] != null) (H[kk] ||= []).push([r[0], d ? r[i] / d : r[i]]); }
  const cut = now() - 864e5; for (const kk in H) { const a = H[kk]; let i = 0; while (i < a.length && a[i][0] < cut) i++; if (i) a.splice(0, i); } }
async function fetchAll() {
  if (O.preview) { const [a, b] = await Promise.allSettled([getJ('/api/proc'), getJ('/api/auto')]); proc = a.value || null; auto = b.value || null; return; }
  const [a, b, c] = await Promise.allSettled([getJ('/api/sys'), getJ('/api/sys/hist' + (lastT ? '?since=' + lastT : '')), getJ('/api/sys/procs')]);
  sy = a.value || null; pl = c.value || null; if (b.value) addRows(b.value.rows); down = !sy; lost = down ? lost || now() : 0;
  const cd = sy?.disks?.find(x => x[0] === 'C:'); proc = sy && { mem: sy.mem, disk: cd && [cd[1], cd[2]], cpu: sy.foot.cpu, rss: sy.foot.rss, apps: sy.apps };
}

export async function mount(el, params = [], opts = {}) {
  root = el; O = opts; KEY = opts.preview ? 'jv.sys.preview' : 'jv.sys'; ac = new AbortController(); const sig = { signal: ac.signal };
  ui = { range: '1h', gt: 'cpu', pf: 'all', q: '', ps: ['c', -1], explain: true, open: null };
  try { Object.assign(ui, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { }
  if (opts.preview && location.hash === '#warn') sim = now() + 3e4; // preview: open with the warning look (DEMO samples)
  for (const kk in H) delete H[kk]; lastT = 0; sy = pl = null;
  if (opts.preview) { demoSeries(); await fetchAll(); demoTick(); } else await fetchAll();
  if (!root) return; el.innerHTML = shell(); ['sh-st', 'sh-gg', 'sh-gk', 'sh-sb', 'sh-dv', 'sh-fk', 'sh-pb', 'sh-svl', 'sh-all', 'sh-leg'].forEach(id => keep($(id)));
  const win = () => RANGES.find(r => r[0] === ui.range)[1];
  for (const kk of ['cpu', 'gpu', 'ram', 'disk']) graph($('c-' + kk), [kk], { max: 100 });
  const big = graph($('c-big'), ['cpu'], { axis: true, max: 100, unit: '%', win, fmt: v => Math.round(v) + '%' });
  graph($('c-down'), ['down'], { win, noFill: false }); graph($('c-up'), ['up'], { win });
  const setBig = () => { const net = ui.gt === 'net'; big.keys = net ? ['down', 'up'] : [ui.gt]; big.o.max = net ? 0 : 100; big.o.unit = net ? 'MB/s' : '%'; big.o.fmt = net ? fmtR : v => Math.round(v) + '%'; legend(); };
  setBig();
  io = new IntersectionObserver(es => es.forEach(e => { for (const g of G) if (g.cv === e.target) g.vis = e.isIntersecting; })); for (const g of G) io.observe(g.cv);
  const cv = $('c-big'); cv.addEventListener('pointermove', e => { big.hx = e.offsetX; }, sig); cv.addEventListener('pointerleave', () => { big.hx = null; }, sig);
  all(); raf = requestAnimationFrame(frame);
  poll = setInterval(async () => { if (document.hidden || !root) return; await fetchAll(); if (!root) return; if (O.preview) demoTick(); live(); }, STEP);
  el.addEventListener('click', async e => {
    const tb = e.target.closest('#sh-r .tab'); if (tb) { ui.range = tb.dataset.v; save(); root.querySelectorAll('#sh-r .tab').forEach(x => { x.classList.toggle('on', x === tb); x.setAttribute('aria-selected', x === tb); }); return legend(); }
    const gt = e.target.closest('#sh-gt .tab'); if (gt) { ui.gt = gt.dataset.v; save(); root.querySelectorAll('#sh-gt .tab').forEach(x => { x.classList.toggle('on', x === gt); x.setAttribute('aria-selected', x === gt); }); return setBig(); }
    const pf = e.target.closest('#sh-pf .tab'); if (pf) { ui.pf = pf.dataset.v; save(); root.querySelectorAll('#sh-pf .tab').forEach(x => { x.classList.toggle('on', x === pf); x.setAttribute('aria-selected', x === pf); }); return procs(); } // B106
    const th = e.target.closest('th[data-s]'); if (th) { const s = th.dataset.s; ui.ps = [s, ui.ps[0] === s ? -ui.ps[1] : s === 'n' ? 1 : -1]; save(); root.querySelectorAll('th[data-s]').forEach(x => { const on = x.dataset.s === s; x.setAttribute('aria-sort', on ? (ui.ps[1] > 0 ? 'ascending' : 'descending') : 'none'); x.querySelector('.sh-so').textContent = on ? (ui.ps[1] > 0 ? '▲' : '▼') : ''; }); return procs(); }
    const km = e.target.closest('.sh-km'); if (km) return menu(km);
    const tr = e.target.closest('tr[data-p]'); if (tr) { ui.open = ui.open === tr.dataset.p ? null : tr.dataset.p; return procs(); }
    const ck = e.target.closest('[data-chk]'); if (ck) { const id = ck.dataset.chk; services(id);
      let j = null; if (O.preview) await fetchAll(); else { j = await post({ op: 'check', id }); if (j?.svc && sy) sy.services = j.svc; } if (!root) return; setTimeout(() => root && services(), reduce() ? 0 : 650 * k());
      if (!O.preview && j?.res !== 'ok') return toast(`The status was not re-read: ${j?.res || 'the tracker did not answer'}. Nothing was started or stopped. Try again in a few seconds.`, 'err', "Couldn't check the service"); // B105
      return toast('Re-read the status (nothing was started or stopped).'); }
    if (e.target.closest('[data-a=retry]')) { await fetchAll(); if (!root) return; all(); return toast(down ? 'Still not reachable.' : 'Tracker back. Readings resumed.', down ? 'warn' : 'ok'); }
    if (e.target.closest('[data-a=sim]')) { sim = now() + 3e4; demoTick(); metrics(); status(); gpu(); return toast('DEMO: warning look for 30 s (sample data only)', 'warn'); }
    if (e.target.closest('[data-a=pause]')) { const res = PZ(), j = await post({ op: res ? 'resume' : 'pause' }); if (!root) return;
      if (j?.res !== 'ok') return toast(`Monitoring was not ${res ? 'resumed' : 'paused'}: ${j?.res || 'the tracker did not answer'}. Check that the tracker is running, then try again.`, 'err', `Couldn't ${res ? 'resume' : 'pause'} monitoring`); // B108
      await fetchAll(); if (!root) return; all(); return toast(res ? 'Monitoring resumed. New readings arrive in about 5 s.' : 'Monitoring paused. Everything else in NEXUS keeps running.'); }
    if (e.target.closest('[data-a=refresh]')) { await fetchAll(); if (!root) return; all(); live(); return proc ? toast('Refreshed') : toast('No new readings: the tracker did not answer. See the card at the top for how to fix it.', 'err', "Couldn't refresh"); } // B108
  }, sig);
  el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('tr[data-p], th[data-s]')) { e.preventDefault(); e.target.click(); } }, sig);
  $('sh-q').addEventListener('input', e => { ui.q = e.target.value; save(); procs(); }, sig);
  $('sh-ex').addEventListener('change', e => { ui.explain = e.target.checked; save(); root.querySelectorAll('.sh-help, .sh-sc').forEach(p => p.hidden = !ui.explain); }, sig);
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.sh-menu, .sh-km')) root?.querySelector('.sh-menu')?.remove(); }, sig);
  return !!proc;
}
function menu(btn) { // safe actions only: details, open file location, copy name. Never end process.
  root.querySelector('.sh-menu')?.remove(); const n = btn.dataset.m, pid = +btn.dataset.pid, m = document.createElement('div'); m.className = 'sh-menu'; m.setAttribute('role', 'menu');
  m.innerHTML = `<button role="menuitem" data-x="info">${icon('i-info')}Details</button><button role="menuitem" data-x="loc">${icon('i-folder')}Open file location</button><button role="menuitem" data-x="copy">${icon('i-layers')}Copy name</button><p>${icon('i-lock')}NEXUS never ends programs.</p>`;
  btn.closest('td').append(m); m.querySelector('button').focus(); btn.setAttribute('aria-expanded', 'true');
  const close = () => { m.remove(); btn.setAttribute('aria-expanded', 'false'); if (btn.isConnected) btn.focus(); };
  m.addEventListener('keydown', e => { const bs = [...m.querySelectorAll('button')], i = bs.indexOf(document.activeElement); // B107: Escape closes, arrows move
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus(); } else if (e.key === 'Tab') close(); });
  m.addEventListener('click', e => { const x = e.target.closest('[data-x]')?.dataset.x; if (!x) return; close();
    if (x === 'info') { ui.open = n; procs(); } else if (x === 'copy') { navigator.clipboard?.writeText(n).then(() => toast('Copied ' + n), () => toast('Copy blocked by the browser', 'warn')); }
    else if (O.preview) toast('Preview: the real page opens Explorer at this program (explorer.exe /select)', 'warn');
    else post({ op: 'reveal', pid }).then(j => toast(j?.res === 'ok' ? 'Opened Explorer at ' + j.path : j?.res || 'Tracker not reachable', j?.res === 'ok' ? 'ok' : 'warn')); });
}
async function post(b) { try { return await (await fetch('/api/sys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json(); } catch { return null; } }
export function update() { } // main.js calls this with the usage state; this page polls /api/sys itself
export function unmount() { cancelAnimationFrame(raf); clearInterval(poll); ac?.abort(); io?.disconnect(); io = null; G.clear(); root = null; sim = 0; } // drop the observer: a stale one re-observed the next visit's canvases and kept the old page alive
