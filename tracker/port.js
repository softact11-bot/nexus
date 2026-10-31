// M5b Phase 3 per-user port (spec §26.9). 7788 stays the default. When something else holds it (another Windows user's tracker, any
// program), serve takes a per-user fallback (seed .. seed+9) and records the port it bound in port.txt (user-only ACL, like launch.key).
// Readers (open, boot, the app) treat port.txt as a hint only: a port is used only after its listener proves it holds launch.key (B61).
const http = require('http'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const fnv = s => { let h = 0x811c9dc5; for (const b of Buffer.from(s)) h = Math.imul(h ^ b, 0x01000193) >>> 0; return h };
const seed = () => 47000 + fnv(os.homedir()) % 1000; // FNV-1a of the profile path: per user like the SID, no process spawn; only a preference, never assumed unique
const hint = f => { try { const p = +JSON.parse(fs.readFileSync(f, 'utf8')).port; return p > 0 && p < 65536 ? p : 0 } catch { return 0 } };
// 'ours' (proved launch.key) | 'rate' (429) | 'busy' (timeout, reset) | 'refused' (nothing listens) | 'old' (401: a NEXUS tracker without /api/prove) | 'bad' (anything else: not ours)
const probe = (keyFile, port, ms = 2000) => new Promise(res => {
  let key = ''; try { key = fs.readFileSync(keyFile, 'utf8').trim() } catch { }
  const n = crypto.randomBytes(32).toString('hex'), want = key && require('./launch.js').mac(key, port, n);
  http.get({ host: '127.0.0.1', port, path: '/api/prove?n=' + n, timeout: ms }, r => { let b = ''; r.on('data', c => b += c).on('end', () => { let m; try { m = JSON.parse(b).mac } catch { }
    res(r.statusCode === 200 && want && typeof m === 'string' && m.length === want.length && crypto.timingSafeEqual(Buffer.from(m), Buffer.from(want)) ? 'ours' : r.statusCode === 429 ? 'rate' : r.statusCode === 401 ? 'old' : 'bad') }) })
    .on('error', e => res(e.code === 'ECONNREFUSED' ? 'refused' : 'busy')).on('timeout', function () { this.destroy() });
});
module.exports = { seed, hint, probe };
