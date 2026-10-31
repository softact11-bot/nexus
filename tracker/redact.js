// M4c redaction (spec §26.8): R(text) for free text that is logged, exported or sent back as an error. Home folder → ~,
// Claude's encoded project folders (C--Users-<name>-…) → C--Users-~-…, the user name after a backslash (icacls: PC\name) → ~,
// secrets → [hidden]. Never used on paths that code reads back (projects.json, usage data, backup copies).
const os = require('os');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), H = os.homedir(), U = esc(os.userInfo().username), D = H.slice(0, 1);
const RULES = [
  [new RegExp(`(?:${esc(D)}:|/${esc(D)})[\\\\/]+Users[\\\\/]+${U}(?![\\w.-])`, 'gi'), '~'], // C:\Users\x, C:/Users/x, C:\\Users\\x (JSON), /c/Users/x
  [new RegExp(`(${esc(D)}--Users-)${U}(?![A-Za-z0-9.])`, 'gi'), '$1~'],
  [new RegExp(`(?<=\\\\)${U}(?![\\w.-])`, 'gi'), '~'],
  [/\bsk-ant-[\w-]{6,}/g, 'sk-ant-[hidden]'],
  [/\b(Bearer\s+)[\w.~+/=-]{8,}/gi, '$1[hidden]'],
  [/\b((?:x-nexus-)?(?:token|api[_-]?key|key|secret|password|passwd|auth)(?:=|"\s*:\s*"))[^\s"'&,;]{4,}/gi, '$1[hidden]'],
  [/\b[0-9a-f]{32,}\b/gi, '[hidden]'],
  [/(?<![A-Za-z0-9+])(?=[A-Za-z0-9+]*\d)(?=[A-Za-z0-9+]*[A-Z])(?=[A-Za-z0-9+]*[a-z])[A-Za-z0-9+]{40,}={0,2}/g, '[hidden]'], // ponytail: base64 without / - _ (paths and folder names have them); add url-safe keys if one turns up
];
module.exports = s => typeof s === 'string' ? RULES.reduce((t, [re, to]) => t.replace(re, to), s) : s;
