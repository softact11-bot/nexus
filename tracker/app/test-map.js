// node app/test-map.js : checks the /api → Home mapping with a fixed fixture.
import assert from 'node:assert/strict';
import { home, usage, modelName, sessions, filterSessions, sortBy, analytics, projName, csv } from './js/data.js';
import * as settings from './js/settings.js';

const now = new Date('2026-10-14T12:00:00').getTime(), d = n => new Date(now - n * 864e5).toISOString().slice(0, 10);
const r = {
  at: '10/14/2026, 11:59:00 AM',
  window: { start: '9:00 AM', resets: '2:00 PM', tokens: [1, 2, 3, 4], limit: null, pct: null },
  days: [[d(20), 9, 9, 9, 9], [d(1), 10, 20, 30, 40], [d(0), 1, 2, 3, 94]],
  sessions: [['aaaaaaaa', 'my-game', new Date(now - 3600e3).toLocaleString(), 5, 10, 10, 10, 70, 0, ''], ['bbbbbbbb', 'scratch', new Date(now - 20 * 864e5).toLocaleString(), 2, 25, 25, 25, 25, 0, '']],
  health: [['Tracking', true, 'ok'], ['Obsidian sync', false, 'stale']],
  opts: [{ name: 'All tips', status: 'verified: est. waste -38%, measured occurrences -73%', n: 11 }],
  auto: [[now - 60e3, 'Retired tip "x": shown in 5 sessions with no clear drop']],
  advisor: { win: 180000, log: [[now - 120e3, 'aaaaaaaa-1', 'saved before compact', 'verified in Obsidian']], sessions: [{ id: 'aaaaaaaa-1', ctx: 90000, win: 180000 }] },
  recs: [],
};
const p = { cpu: 0.4, rss: 50e6, mem: [16e9, 8e9], disk: [500e9, 250e9], data: 3e6, apps: [['Claude Code', 9e8], ['Obsidian', 0], ['Blender', 0], ['Roblox Studio', 0]],
  cur: { id: 'aaaaaaaa-1', project: 'my-game', start: now - 600e3, end: now - 60e3, n: 5, model: 'claude-opus-5-5', ctx: [1, 2, 3] } };

const v = home(r, p, now);
assert.equal(v.greet, 'Good afternoon');
assert.equal(v.win.tok, 10);                       // sum of the 4 types
assert.equal(v.win.pct, null);                     // no plan limit → no percent
assert.equal(v.d7, 10 + 20 + 30 + 40 + 1 + 2 + 3 + 94); // day 20 is outside 7 days
assert.equal(v.total, 36 + 100 + 100);
assert.equal(v.active, 1);                         // scratch session is 20 days old
assert.equal(v.bad, 1);
assert.equal(v.status.running, true);              // last request 1 min ago
assert.equal(v.status.model, 'Opus 5.5');
assert.equal(v.status.ctx, 90000);
assert.equal(v.status.eff, 96);                    // 94 / (1 + 3 + 94) = 95.9 %
assert.deepEqual(v.projects.map(x => [x.name, x.pct]), [['my-game', 50], ['scratch', 50]]);
assert.equal(v.opt[0].badge, '−38% waste');
assert.equal(v.opt[1].kind, 'unk');                // M3 savings stay unverified
assert.equal(v.sys.mem, 50);
assert.equal(v.apps[1][0], 'Token Tracker');
assert.equal(v.notes[0].c, 'warn');                // health problem first
const u = usage(r, 7, now);
assert.equal(u.delta, null);                       // previous 7 days had no tokens → no comparison
assert.equal(modelName('claude-sonnet-5-5'), 'Sonnet 5.5');

// ---------- Sessions page ----------
r.advisor.history = [{ id: 'bbbbbbbb-2', start: now - 20 * 864e5, end: now - 20 * 864e5 + 3600e3, peak: 150000, k: 2, why: 'a newer chat started' }];
r.sessions[1][9] = 'reread:a.png';
const ss = sessions(r, p, now), [A, B] = ss;
assert.equal(A.live, true);                        // in advisor.sessions
assert.equal(A.full, 'aaaaaaaa-1');
assert.equal(A.ctx, 90000);
assert.equal(A.end, now - 60e3);                   // from /api/proc cur
assert.equal(A.model, 'Opus 5.5');
assert.equal(A.tot, 100);
assert.equal(A.eff, 78);                           // 70 / (10 + 10 + 70)
assert.equal(A.perReq, 20);
assert.equal(B.live, false);
assert.equal(B.dur, 3600e3);                       // end from advisor history
assert.equal(B.peak, 150000);
assert.equal(B.model, null);                       // model only known for the current session
assert.deepEqual(filterSessions(ss, { q: 'SCRATCH' }).map(x => x.id), ['bbbbbbbb']);
assert.deepEqual(filterSessions(ss, { issues: true }).map(x => x.id), ['bbbbbbbb']);
assert.deepEqual(filterSessions(ss, { live: true, project: 'my-game' }).map(x => x.id), ['aaaaaaaa']);
assert.equal(filterSessions(ss, { project: 'nope' }).length, 0);
assert.deepEqual(filterSessions(ss, { since: now - 7 * 864e5 }).map(x => x.id), ['aaaaaaaa']); // date filter
assert.equal(A.log.length, 1);                     // advisor log entry for aaaaaaaa
assert.equal(B.log.length, 0);
assert.deepEqual(sortBy(ss, 'start', 1).map(x => x.id), ['bbbbbbbb', 'aaaaaaaa']);
assert.deepEqual(sortBy([{ v: null }, { v: 2 }, { v: 1 }], 'v', 1).map(x => x.v), [1, 2, null]); // nulls last both ways
assert.deepEqual(sortBy([{ v: null }, { v: 1 }, { v: 2 }], 'v', -1).map(x => x.v), [2, 1, null]);

// ---------- Analytics page ----------
r.models = [['claude-opus-5-5', 1, 2, 3, 4], ['claude-sonnet-5-5', 0, 0, 0, 0]];
r.projects = [['C--Users-someuser-Desktop-my-game', 5, 5, 5, 5], ['my-game', 1, 1, 1, 1], ['scratch', 0, 0, 0, 0]];
const a7 = analytics(r, 7, now);
assert.equal(a7.len, 7);
assert.deepEqual(a7.t, { inp: 11, out: 22, cw: 33, cr: 134, all: 200 });
assert.equal(a7.pre, 0);                           // tracking started 20 days ago
assert.equal(a7.eff, 75);                          // 134 / (11 + 33 + 134)
assert.equal(a7.s.at(-1).eff, 96);
assert.equal(a7.s[0].eff, null);                   // no requests that day → unknown, not 0
const all = analytics(r, 'all', now);
assert.equal(all.len, 21);                         // day -20 … today
assert.equal(all.pre, 0);
const a30 = analytics(r, 30, now);
assert.equal(a30.pre, 9);                          // 30-day range, tracking started 20 days ago
assert.equal(a30.t.all, 236);
assert.deepEqual(a7.models.map(x => [x.name, x.tot, x.share]), [['Opus 5.5', 10, 100]]); // zero rows dropped
assert.deepEqual(a7.projects.map(x => [x.name, x.tot]), [['my-game', 24]]);              // dir name merged with the session name
assert.equal(projName('C--Users-someuser-Documents-My-Game'), 'My Game');
assert.equal(analytics({}, 'all', now).len, 0);    // nothing tracked yet
assert.equal(csv([['a', 'b,c', 'say "hi"', null, 0]]), 'a,"b,c","say ""hi""",,0\n');

// ---------- settings store (memory only under node) ----------
settings.set('analytics.range', 14);
const dump = settings.exportJSON();
settings.set('analytics.range', 7);
settings.importJSON(dump);
assert.equal(settings.get('analytics.range'), 14);
assert.equal(settings.get('missing', 'd'), 'd');
assert.throws(() => settings.importJSON('{"settings":[]}'));
assert.throws(() => settings.importJSON('not json'));
console.log('test-map: all checks pass');
