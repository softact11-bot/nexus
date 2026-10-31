// NEXUS M2 path safety (spec §26.4 / §26.6), shared with Setup (M6). No writes here; it only decides.
// check(p, kind): resolves the real path (.., 8.3 names, junctions, symlinks) and refuses roots, system and credential
// folders, network paths and other users' profiles. kind 'data' = NEXUS data folder (must sit inside the current user's profile).
// guard(file, roots): throws unless the file is inside one of the allowed roots and outside every protected path.
// Env is read on every call (USERPROFILE, APPDATA, …) so tests can switch to mock user profiles.
const fs = require('fs'), path = require('path'), os = require('os');
const E = k => process.env[k] || '';
const home = () => E('USERPROFILE') || os.homedir();
const low = p => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
const same = (a, b) => !!a && !!b && low(a) === low(b);
function within(root, p) { if (!root || !p) return false; const r = path.relative(low(root), low(p)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)) }
const under = (root, p) => within(root, p) && !same(root, p);

// real path of the longest existing prefix + the rest (folders that don't exist yet)
function real(p) {
  let abs = path.resolve(p); const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(abs), ...rest.reverse()) } catch { }
    const d = path.dirname(abs); if (d === abs) return path.join(abs, ...rest.reverse()); rest.push(path.basename(abs)); abs = d;
  }
}

const CRED = ['.claude', '.ssh', '.aws', '.gnupg', '.config', '.azure', '.kube', '.docker'];
// files NEXUS never writes (M2): Claude Code settings, hooks, skills, plugins; Obsidian config; Graphify data
function protectedWhy(r) {
  const H = home(), C = E('CLAUDE_CONFIG_DIR') || path.join(H, '.claude'), parts = low(r).split(path.sep);
  if (parts.includes('.obsidian')) return 'an Obsidian settings folder (.obsidian)';
  if (parts.includes('graphify-out')) return 'Graphify data (graphify-out)';
  if (E('APPDATA') && within(path.join(E('APPDATA'), 'obsidian'), r)) return "Obsidian's own config";
  for (const f of ['settings.json', 'settings.local.json']) if (same(path.join(C, f), r)) return 'Claude Code settings';
  for (const d of ['skills', 'plugins', 'hooks', 'agents', 'commands']) if (within(path.join(C, d), r)) return 'Claude Code ' + d;
  return '';
}

function check(p, kind = 'folder') {
  const no = why => ({ ok: false, why });
  if (typeof p !== 'string' || !p.trim() || p.length > 260 || /[\x00-\x1f"<>|?*]/.test(p.slice(2))) return no('That is not a valid folder path.');
  if (/^[\\/]{2}/.test(p)) return no('Network paths are not allowed; pick a folder on this PC.');
  if (!/^[a-z]:[\\/]/i.test(p)) return no('Use a full path that starts with a drive letter, like C:\\Users\\you\\Documents\\MyGame.');
  const r = real(p), H = home(), users = path.dirname(H);
  if (/^[\\/]{2}/.test(r)) return no('That folder points to a network location.');
  if (same(path.parse(r).root, r)) return no('A whole drive can\'t be used; pick a folder inside it.');
  if (same(H, r)) return no('Your whole user folder can\'t be used; pick a folder inside it.');
  for (const k of ['SystemRoot', 'windir', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData']) if (E(k) && within(E(k), r)) return no('System and program folders can\'t be used.');
  for (const k of ['APPDATA', 'LOCALAPPDATA']) if (E(k) && same(E(k), r)) return no('App settings folders can\'t be used.');
  if (under(users, r) && !within(H, r)) return no('That folder belongs to another Windows user.');
  const why = protectedWhy(r); if (why) return no('That is ' + why + '; NEXUS never writes there.');
  if (kind === 'data') { if (!under(H, r)) return no('NEXUS data must live inside your own user folder, so other Windows users can\'t see it.') }
  else for (const c of CRED) if (within(path.join(H, c), r)) return no('Credential and app-settings folders (' + c + ') can\'t be used.');
  return { ok: true, path: r, warn: /[\\/]OneDrive[^\\/]*([\\/]|$)/i.test(r) ? 'This folder is synced by OneDrive: its files can leave this PC through that sync.' : '' };
}

// two folders clash when they are the same or one is inside the other
const overlap = (a, b) => within(real(a), real(b)) || within(real(b), real(a));

function guard(file, roots) {
  const r = real(file), why = protectedWhy(r);
  if (why) throw new Error('Refused: ' + why + ' is protected.');
  const H = home(); if (under(path.dirname(H), r) && !within(H, r)) throw new Error('Refused: that belongs to another Windows user.');
  if (!roots.some(x => under(real(x), r))) throw new Error('Refused: write outside the allowed folders.');
  return r;
}

module.exports = { check, guard, overlap, within, real, home, protectedWhy };
