// M4b: launch token for the tests that hit a running tracker. NEXUS_PORT (default 7788) + NEXUS_TOKEN, else the live launch.key
// (missing before M4b is live: then no token is sent). H = header for node requests; cookie(send) = CDP cookie for headless Chrome.
const fs = require('fs'), path = require('path'), os = require('os');
const PORT = +process.env.NEXUS_PORT || 7788;
let TOKEN = process.env.NEXUS_TOKEN || ''; if (!TOKEN) try { TOKEN = fs.readFileSync(path.join(os.homedir(), '.claude', 'token-tracker', 'launch.key'), 'utf8') } catch { }
module.exports = {
  PORT, TOKEN, H: TOKEN ? { 'x-nexus-token': TOKEN } : {},
  cookie: (send, port = PORT, token = TOKEN) => token && send('Network.setCookie', { name: 'nexus' + port, value: token, url: 'http://127.0.0.1:' + port + '/', httpOnly: true, sameSite: 'Strict' }),
};
