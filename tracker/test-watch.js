// Self-check for watch.js (live sessions + real limits); no Claude call, temp folders only. node test-watch.js
const fs = require('fs'), path = require('path'), os = require('os'), a = require('assert');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-watch-')); for (const f of ['watch.js', 'accounts.js', 'redact.js']) fs.copyFileSync(path.join(__dirname, f), path.join(T, f));
const SD = path.join(T, 'cc', 'sessions'), PD = path.join(T, 'cc', 'projects'); fs.mkdirSync(SD, { recursive: true });
process.env.NEXUS_CC_SESSIONS = SD; process.env.NEXUS_DATA = T;
const W = require(path.join(T, 'watch.js')), P = W._.poll;
const ses = (pid, o) => fs.writeFileSync(path.join(SD, pid + '.json'), JSON.stringify({ pid, sessionId: 's' + pid, cwd: 'C:\\w\\app', name: 'App ' + pid, statusUpdatedAt: 1, ...o }));
const tx = (pid, content) => { const d = path.join(PD, 'C--w-app'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 's' + pid + '.jsonl'), JSON.stringify({ type: 'user' }) + '\n' + JSON.stringify({ type: 'assistant', message: { content } }) + '\n') };
const me = process.pid, dead = 2147480000;

// first poll is silent; needs-you from waitingFor; finished only after 30 s+ of work
ses(me, { status: 'busy' }); ses(dead, { status: 'busy' }); P(0);
let s = W.status(); a.strictEqual(s.events.length, 0, 'first poll silent'); a.strictEqual(s.sessions.length, 1, 'dead pid ignored'); a.strictEqual(s.sessions[0].state, 'working');
ses(me, { status: 'busy', waitingFor: 'permission to run Bash' }); P(5e3);
s = W.status(); a.strictEqual(s.events[0].type, 'needs'); a.strictEqual(s.events[0].why, 'permission to run Bash'); a.strictEqual(s.sessions[0].state, 'needs');
P(6e3); a.strictEqual(W.status().events.length, 1, 'no repeat while still waiting');
ses(me, { status: 'busy' }); P(7e3); ses(me, { status: 'idle' }); tx(me, [{ type: 'text', text: 'Done. All tests pass.' }]); P(9e3);
a.ok(!W.status().events.some(e => e.type === 'finished'), 'short work (<30 s) is not announced');
ses(me, { status: 'busy' }); P(10e3); ses(me, { status: 'idle' }); P(50e3);
a.strictEqual(W.status().events[0].type, 'finished', 'finished after 30 s+');
// idle on a question = needs you; a URL query is not a question
ses(me, { status: 'busy' }); P(60e3); tx(me, [{ type: 'text', text: 'See https://x.dev/a?b=1 for docs.' }]); ses(me, { status: 'idle' }); P(61e3);
a.notStrictEqual(W.status().sessions[0].state, 'needs', 'URL ? is not a question');
ses(me, { status: 'busy' }); P(62e3); tx(me, [{ type: 'text', text: 'Which option do you want?\n\n1. A\n2. B' }]); ses(me, { status: 'idle' }); P(63e3);
s = W.status(); a.strictEqual(s.sessions[0].state, 'needs'); a.strictEqual(s.events[0].why, 'asked a question');
ses(me, { status: 'busy' }); P(64e3); tx(me, [{ type: 'tool_use', name: 'AskUserQuestion', input: {} }]); ses(me, { status: 'idle' }); P(65e3);
a.strictEqual(W.status().events[0].why, 'asked a question', 'AskUserQuestion = needs you');
// after= filters events; home dir is shortened
const last = W.status().last; a.strictEqual(W.status(last).events.length, 0);

// limits: fraction → percent, merge windows, stale after 30 min, expired after reset
a.strictEqual(W.limits().windows.five_hour.pct, null, 'never seen = null, not 0');
const now = Date.now(), fut = Math.floor(now / 1000) + 3600;
W.record({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.82, unifiedWindows: { five_hour: { utilization: 0.76, resetsAt: fut }, seven_day: { utilization: 0.82, resetsAt: fut + 9e4 } } });
let L = W.limits(); a.strictEqual(L.windows.five_hour.pct, 76); a.strictEqual(L.windows.seven_day.pct, 82); a.strictEqual(L.windows.five_hour.stale, false); a.strictEqual(L.windows.five_hour.expired, false);
W.record({ rateLimitType: 'five_hour', utilization: 0.9, resetsAt: fut }); L = W.limits();
a.strictEqual(L.windows.five_hour.pct, 90, 'rejection without unifiedWindows updates its window'); a.strictEqual(L.windows.seven_day.pct, 82, 'other window kept');
a.strictEqual(W.limits(now + 31 * 60e3).windows.five_hour.stale, true); a.strictEqual(W.limits(now + 2 * 36e5).windows.five_hour.expired, true);
W.record(null); W.record({ unifiedWindows: { five_hour: { utilization: 'x' } } }); a.strictEqual(W.limits().windows.five_hour.pct, 90, 'bad input ignored');

// child env never carries ANTHROPIC_* (runs bill the subscription)
process.env.ANTHROPIC_API_KEY = 'sk-test'; process.env.anthropic_base_url = 'x'; const e = W.env();
a.ok(!Object.keys(e).some(k => /^anthropic_/i.test(k)), 'ANTHROPIC_* stripped'); a.ok(e.PATH || e.Path, 'rest kept');
fs.rmSync(T, { recursive: true, force: true }); console.log('test-watch: all checks passed'); process.exit(0);
