// B51 regression: node test-b51.js [path to sys.js]. typeperf prints -1 for a process that exited between two readings (seen on this PC:
// % Processor Time, ID Process and Working Set - Private); the process list must never show a negative CPU or memory value.
// Feeds the sampler fixed typeperf lines, no real typeperf. Pass an old sys.js to show the test catches the bug.
const S = require(process.argv[2] || './sys.js');
let pass = 0; const fail = []; const ok = (c, m) => c ? pass++ : fail.push(m);
const cols = ['app', 'gone', 'dead'].flatMap(n => ['% Processor Time', 'ID Process', 'Working Set - Private'].map(c => `"\\\\PC\\Process(${n})\\${c}"`));
const row = v => '"10/15/2026 22:00:00.000",' + v.map(x => `"${x}"`).join(',');
const L = S._prFeed(['"(PDH-CSV 4.0) (GMT)",' + cols.join(','), row([10, 100, 5000, 5, 200, 3000, 1, 300, 100]), row([20, 100, 6000, -1, 200, -1, -1, -1, -1])]);
ok(Array.isArray(L) && L.length > 0, 'process list built from the fixed lines');
ok((L || []).every(x => x[1] >= 0 && x[1] <= 100 && x[2] >= 0), 'no negative CPU or memory (' + JSON.stringify((L || []).map(x => [x[0], x[1], x[2]])) + ')');
ok((L || []).every(x => x[4].every(p => p > 0)), 'no -1 process ids');
ok((L || []).some(x => x[0] === 'app.exe' && x[2] === 6000), 'valid readings kept');
console.log(JSON.stringify({ pass, fail }, null, 1)); process.exit(fail.length ? 1 : 0);
