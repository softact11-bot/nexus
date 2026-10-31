// M7a: temp roots for the dev test scripts. Each root is removed when the process exits with code 0 (kept on failure for debugging,
// or always with NEXUS_KEEP_TMP=1). Only folders this process created under %TEMP% named nexus-*; links are removed, never followed.
const fs = require('fs'), path = require('path'), os = require('os');
const made = [];
process.on('exit', code => {
  if (code || process.env.NEXUS_KEEP_TMP) return;
  for (const d of made) if (path.dirname(d) === os.tmpdir() && path.basename(d).startsWith('nexus-')) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }) } catch { }
});
module.exports = prefix => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d };
