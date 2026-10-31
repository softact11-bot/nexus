// M6 Setup core (spec §26.12): path rules (port of tracker-dev safepath.js), test-root write guard, install manifest, step journal,
// M6b: install-folder lock, verified backups, consent-only replace, resumable runs (Resume / Roll back after a crash), folder picker check.
// M6e: remove steps (backed up, undone by Roll back), the one Claude Code file Setup may change (settings.json, hooks steps only), owner kept on update,
// run kinds (install / update / repair / uninstall: the manifest is archived, Roll back restores it).
// Every write goes through Ctx::guard. Setup only runs with a test root inside %TEMP% holding a mock user profile (Q13).
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::{Path, PathBuf}};

pub fn sha(b: &[u8]) -> String { Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect() }
fn sha_file(p: &Path) -> Option<String> { fs::read(p).ok().map(|b| sha(&b)) }

fn norm(p: &Path) -> String { p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase() }
fn same(a: &Path, b: &Path) -> bool { norm(a) == norm(b) }
pub fn within(root: &Path, p: &Path) -> bool { let (r, q) = (norm(root), norm(p)); q == r || q.starts_with(&(r + "\\")) }
fn under(root: &Path, p: &Path) -> bool { within(root, p) && !same(root, p) }

/// real path of the longest existing prefix (.., 8.3 names, junctions, symlinks resolved) + the parts that don't exist yet
pub fn real(p: &Path) -> PathBuf {
    let mut abs = std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
    let mut rest = vec![];
    loop {
        if let Ok(c) = fs::canonicalize(&abs) {
            let s = c.to_string_lossy().to_string();
            let s = if let Some(u) = s.strip_prefix(r"\\?\UNC\") { format!(r"\\{u}") } else { s.trim_start_matches(r"\\?\").to_string() };
            return rest.iter().rev().fold(PathBuf::from(s), |a, x| a.join(x));
        }
        match (abs.parent().map(Path::to_path_buf), abs.file_name().map(|f| f.to_os_string())) {
            (Some(d), Some(f)) => { rest.push(f); abs = d }
            _ => return rest.iter().rev().fold(abs, |a, x| a.join(x)),
        }
    }
}

/// local time stamp YYYY-MM-DD_HHMMSS (UTC; days-from-civil inverse, no date crate)
pub fn stamp() -> String {
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs()) as i64;
    let (d, t) = (s.div_euclid(86400), s.rem_euclid(86400));
    let z = d + 719468; let era = z.div_euclid(146097); let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153; let day = doy - (153 * mp + 2) / 5 + 1; let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{day:02}_{:02}{:02}{:02}", t / 3600, t / 60 % 60, t % 60)
}

/// the user folders Setup knows; a mock profile under the root in test mode
#[derive(Clone)]
pub struct Env { pub home: PathBuf, pub appdata: PathBuf, pub local: PathBuf, pub system: Vec<PathBuf> }
impl Env {
    pub fn mock(root: &Path) -> Env {
        let home = root.join("Users").join("nexususer");
        Env { appdata: home.join("AppData").join("Roaming"), local: home.join("AppData").join("Local"),
              system: ["Windows", "Program Files", "Program Files (x86)", "ProgramData"].iter().map(|s| root.join(s)).collect(), home }
    }
    pub fn programs(&self) -> PathBuf { self.local.join("Programs").join("NEXUS") }
    pub fn data(&self) -> PathBuf { self.local.join("NEXUS") }
    pub fn backups(&self) -> PathBuf { self.home.join("NEXUS Backups") }
    pub fn claude(&self) -> PathBuf { self.home.join(".claude") }
}

const CRED: [&str; 8] = [".claude", ".ssh", ".aws", ".gnupg", ".config", ".azure", ".kube", ".docker"];

/// files NEXUS never writes: Claude Code settings / skills / plugins / hooks, Obsidian config, Graphify data
pub fn protected_why(r: &Path, e: &Env) -> Option<&'static str> {
    let n = norm(r);
    let parts: Vec<&str> = n.split('\\').collect();
    if parts.contains(&".obsidian") { return Some("an Obsidian settings folder (.obsidian)") }
    if parts.contains(&"graphify-out") { return Some("Graphify data (graphify-out)") }
    if within(&e.appdata.join("obsidian"), r) { return Some("Obsidian's own config") }
    if ["settings.json", "settings.local.json"].iter().any(|f| same(&e.claude().join(f), r)) { return Some("Claude Code settings") }
    if ["skills", "plugins", "hooks", "agents", "commands"].iter().any(|d| within(&e.claude().join(d), r)) { return Some("a Claude Code skills / plugins / hooks folder") }
    None
}

/// folder check for user-picked paths (kind "data" = NEXUS data, must sit inside the user's own profile). Ok((resolved, OneDrive warning))
pub fn check(p: &str, kind: &str, e: &Env) -> Result<(PathBuf, Option<String>), String> {
    let no = |m: &str| Err(m.to_string());
    let tail: String = p.chars().skip(2).collect();
    if p.trim().is_empty() || p.len() > 260 || tail.chars().any(|c| (c as u32) < 32 || "\"<>|?*".contains(c)) { return no("That is not a valid folder path.") }
    if p.starts_with("\\\\") || p.starts_with("//") { return no("Network paths are not allowed; pick a folder on this PC.") }
    let b = p.as_bytes();
    if !(b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')) { return no("Use a full path that starts with a drive letter, like C:\\Users\\you\\Documents\\MyGame.") }
    let r = real(Path::new(p));
    if r.to_string_lossy().starts_with("\\\\") { return no("That folder points to a network location.") }
    if r.parent().is_none() { return no("A whole drive can't be used; pick a folder inside it.") }
    if same(&e.home, &r) { return no("Your whole user folder can't be used; pick a folder inside it.") }
    if e.system.iter().any(|s| within(s, &r)) { return no("System and program folders can't be used.") }
    if same(&e.appdata, &r) || same(&e.local, &r) { return no("App settings folders can't be used.") }
    if let Some(users) = e.home.parent() { if under(users, &r) && !within(&e.home, &r) { return no("That folder belongs to another Windows user.") } }
    if let Some(w) = protected_why(&r, e) { return Err(format!("That is {w}; NEXUS never writes there.")) }
    if kind == "data" { if !under(&e.home, &r) { return no("NEXUS data must live inside your own user folder, so other Windows users can't see it.") } }
    else if let Some(c) = CRED.iter().find(|c| within(&e.home.join(c), &r)) { return Err(format!("Credential and app-settings folders ({c}) can't be used.")) }
    let warn = norm(&r).split('\\').any(|x| x.starts_with("onedrive")).then(|| "This folder is synced by OneDrive: its files can leave this PC through that sync.".to_string());
    Ok((r, warn))
}

/// test root + mock profile; every write is checked by guard()
pub struct Ctx { pub root: PathBuf, pub env: Env }
impl Ctx {
    /// the root must be a folder inside %TEMP% (never the real profile)
    pub fn new(root: &Path) -> Result<Ctx, String> { Ctx::new_in(root, &std::env::temp_dir()) }
    pub fn new_in(root: &Path, temp: &Path) -> Result<Ctx, String> {
        let (r, t) = (real(root), real(temp));
        if !under(&t, &r) { return Err(format!("Test root must be a folder inside {} (got {}).", t.display(), r.display())) }
        fs::create_dir_all(&r).map_err(|e| e.to_string())?;
        let root = real(&r);
        if !under(&t, &root) { return Err("Test root resolves outside the temp folder.".into()) }
        let env = Env::mock(&root);
        for d in [env.home.join("Desktop"), env.appdata.clone(), env.programs(), env.data()] { fs::create_dir_all(d).map_err(|e| e.to_string())? }
        Ok(Ctx { root, env })
    }
    pub fn guard(&self, p: &Path) -> Result<PathBuf, String> {
        let r = real(p);
        if let Some(w) = protected_why(&r, &self.env) { return Err(format!("Refused: {w} is protected.")) }
        if !under(&self.root, &r) { return Err(format!("Refused: {} is outside the test root.", r.display())) }
        Ok(r)
    }
    /// M6e: Claude Code's settings.json passes only in a hooks step (the user ticked it, saw the diff, a backup is made first)
    pub fn guard_k(&self, p: &Path, hooks: bool) -> Result<PathBuf, String> {
        let r = real(p);
        if hooks && same(&r, &self.env.claude().join("settings.json")) && under(&self.root, &r) { return Ok(r) }
        self.guard(p)
    }
    /// atomic write (temp file + rename); returns the SHA-256 written
    pub fn write(&self, p: &Path, b: &[u8]) -> Result<String, String> { self.write_k(p, b, false) }
    pub fn write_k(&self, p: &Path, b: &[u8], hooks: bool) -> Result<String, String> {
        let r = self.guard_k(p, hooks)?;
        if let Some(d) = r.parent() { fs::create_dir_all(d).map_err(|e| e.to_string())? }
        let tmp = r.with_extension("nexus-tmp");
        // M6f: a failed write or swap (read-only file, file in use) leaves no temp file behind and names the file
        fs::write(&tmp, b).and_then(|_| fs::rename(&tmp, &r)).map_err(|e| { let _ = fs::remove_file(&tmp); format!("could not write {}: {e}", r.display()) })?;
        Ok(sha(b))
    }
    pub fn log(&self, v: Value) {
        if let Ok(f) = self.guard(&self.root.join("setup.log")) {
            use std::io::Write;
            if let Ok(mut h) = fs::OpenOptions::new().create(true).append(true).open(f) { let _ = writeln!(h, "{v}"); }
        }
    }
    fn read_json(&self, p: &Path, d: Value) -> Value { fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(d) }
    /// a picked folder: the path rules, plus (test build) it must sit inside the test root
    pub fn choose(&self, p: &Path, kind: &str) -> Result<(PathBuf, Option<String>), String> {
        let (r, w) = check(&p.to_string_lossy(), kind, &self.env)?;
        if !under(&self.root, &r) { return Err(format!("Test build: pick a folder inside the test root {}.", self.root.display())) }
        Ok((r, w))
    }
}

/// one Setup per installation folder: an exclusive handle on Programs\NEXUS\.setup.lock, released by Windows when the process ends (even a crash)
pub struct Lock(#[allow(dead_code)] fs::File);
pub fn lock(c: &Ctx) -> Result<Lock, String> {
    use std::os::windows::fs::OpenOptionsExt;
    let p = c.guard(&c.env.programs().join(".setup.lock"))?;
    fs::OpenOptions::new().create(true).truncate(false).write(true).share_mode(0).open(&p).map(Lock).map_err(|e|
        if e.raw_os_error() == Some(32) { "Another NEXUS Setup is already working on this installation folder. Close it, then try again.".to_string() } else { e.to_string() })
}

/// M6f, on exit: delete the lock file, and when nothing is installed (no install record) also the folders left empty in Programs\NEXUS.
/// remove_dir only removes an empty folder, and links are never followed, so no file (the user's or NEXUS's) is ever touched.
pub fn tidy(progs: &Path) {
    let _ = fs::remove_file(progs.join(".setup.lock"));
    if progs.join("install-manifest.json").exists() { return }
    fn prune(d: &Path) {
        for e in fs::read_dir(d).into_iter().flatten().flatten() { if e.file_type().is_ok_and(|t| t.is_dir()) { prune(&e.path()) } }
        let _ = fs::remove_dir(d);
    }
    prune(progs);
}

fn free_bytes(p: &Path) -> Option<u64> {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let w: Vec<u16> = p.as_os_str().to_string_lossy().encode_utf16().chain([0]).collect();
    let mut free = 0u64;
    (unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) } != 0).then_some(free)
}

/// copy files into NEXUS Backups\<stamp>\ (new folder, never overwritten), hashes re-read, manifest.json written last
pub fn backup(c: &Ctx, files: &[PathBuf]) -> Result<PathBuf, String> {
    let base = c.env.backups();
    let need: u64 = files.iter().map(|f| fs::metadata(f).map_or(0, |m| m.len())).sum::<u64>() * 2 + (16 << 20);
    fs::create_dir_all(c.guard(&base)?).map_err(|e| e.to_string())?;
    if free_bytes(&base).is_some_and(|f| f < need) { return Err("Not enough free disk space for the backup; nothing was changed.".into()) }
    let s = stamp();
    let dir = (0..100).map(|n| base.join(if n == 0 { s.clone() } else { format!("{s}-{n}") }))
        .find(|d| c.guard(d).is_ok() && fs::create_dir(d).is_ok()).ok_or("could not create a new backup folder")?;
    let mut list = vec![];
    for (i, f) in files.iter().enumerate() {
        let b = fs::read(f).map_err(|e| format!("backup read {}: {e}", f.display()))?;
        let name = format!("{i:03}_{}", f.file_name().map_or("file".into(), |n| n.to_string_lossy().to_string()));
        let dst = c.guard(&dir.join(&name))?;
        fs::write(&dst, &b).map_err(|e| e.to_string())?;
        if sha_file(&dst).as_deref() != Some(sha(&b).as_str()) { return Err(format!("backup of {} did not verify; nothing was changed.", f.display())) }
        list.push(json!({ "src": f, "file": name, "sha256": sha(&b), "bytes": b.len() }));
    }
    c.write(&dir.join("manifest.json"), serde_json::to_string_pretty(&json!({ "created": s, "files": list })).unwrap().as_bytes())?;
    Ok(dir)
}

/// install-manifest.json: every file Setup placed, its SHA-256 and owner ("nexus" = Setup created it, "external" = was already there; never removed, Q14)
pub struct Manifest { pub file: PathBuf, pub v: Value }
impl Manifest {
    pub fn load(c: &Ctx) -> Manifest { let file = c.env.programs().join("install-manifest.json"); Manifest { v: c.read_json(&file, json!({ "version": 1, "files": {} })), file } }
    fn save(&self, c: &Ctx) -> Result<(), String> { c.write(&self.file, serde_json::to_string_pretty(&self.v).unwrap().as_bytes()).map(|_| ()) }
    pub fn record(&mut self, c: &Ctx, p: &Path, owner: &str) -> Result<(), String> {
        let r = c.guard(p)?;
        let h = sha_file(&r).ok_or("file missing")?;
        self.v["files"][r.to_string_lossy().to_string()] = json!({ "sha256": h, "owner": owner });
        self.save(c)
    }
    pub fn forget(&mut self, c: &Ctx, p: &Path) -> Result<(), String> {
        if let Some(o) = self.v["files"].as_object_mut() { o.remove(&p.to_string_lossy().to_string()); }
        self.save(c)
    }
    /// what an uninstall may remove: NEXUS-owned files whose content is unchanged; changed or external files are kept
    pub fn removable(&self) -> Vec<PathBuf> {
        self.v["files"].as_object().into_iter().flatten()
            .filter(|(p, m)| m["owner"] == "nexus" && sha_file(Path::new(p)).as_deref() == m["sha256"].as_str())
            .map(|(p, _)| PathBuf::from(p)).collect()
    }
}

/// one planned file: copy `src` (payload) to `path`; an existing target is replaced only with `replace` = the user's explicit OK.
/// M6e: `remove` = delete `path` (backed up first); `hooks` = the target is Claude Code's settings.json (see Ctx::guard_k).
#[derive(Default)]
pub struct Op { pub path: PathBuf, pub src: PathBuf, pub replace: bool, pub remove: bool, pub hooks: bool }

/// manifest fields a run sets (and Roll back restores)
const META: [&str; 7] = ["app", "setup", "installed", "options", "mode", "hooks", "dataCreated"];
pub fn key(p: &Path) -> String { p.to_string_lossy().to_string() }

/// setup-journal.json: the whole run is saved before anything changes (each step with what was there before + its backup);
/// steps go pending → running → done. An open run after a crash blocks a new one until it is resumed or rolled back.
pub struct Journal { file: PathBuf, pub v: Value }
impl Journal {
    pub fn load(c: &Ctx) -> Journal { let file = c.env.data().join("setup-journal.json"); Journal { v: c.read_json(&file, json!({ "open": false, "steps": [] })), file } }
    pub fn is_open(&self) -> bool { self.v["open"] == true }
    fn save(&self, c: &Ctx) -> Result<(), String> { c.write(&self.file, serde_json::to_string_pretty(&self.v).unwrap().as_bytes()).map(|_| ()) }
    fn set(&mut self, c: &Ctx, i: usize, state: &str) -> Result<(), String> { self.v["steps"][i]["state"] = json!(state); self.save(c) }

    /// check every step, back up every file that will be replaced, then save the run. Nothing on disk changes if this fails.
    pub fn begin(&mut self, c: &Ctx, ops: &[Op]) -> Result<(), String> { self.begin_kind(c, ops, "install", Value::Null) }
    /// `meta` (options, mode, hooks added, dataCreated) goes into the manifest when the run finishes
    pub fn begin_kind(&mut self, c: &Ctx, ops: &[Op], kind: &str, meta: Value) -> Result<(), String> {
        if self.is_open() { return Err("An unfinished Setup run was found: resume or roll it back first.".into()) }
        let man = Manifest::load(c);
        let mut steps = vec![]; let mut old = vec![];
        for o in ops {
            let p = c.guard_k(&o.path, o.hooks)?;
            if p.is_dir() { return Err(format!("{} is a folder.", p.display())) }
            let before = sha_file(&p);
            let owner = man.v["files"][key(&p)]["owner"].clone();
            if o.remove {
                let b = before.ok_or(format!("{} is already gone.", p.display()))?;
                old.push(p.clone());
                steps.push(json!({ "what": format!("remove {}", p.display()), "op": "remove", "path": p, "src": null, "sha256": null, "before": b,
                    "owner": owner, "backup": null, "hooks": false, "state": "pending" }));
                continue
            }
            let src = real(&o.src);
            let h = sha_file(&src).ok_or(format!("payload missing: {}", src.display()))?;
            if before.is_some() && !o.replace { return Err(format!("{} already exists; Setup replaces it only with your permission.", p.display())) }
            if before.is_some() { old.push(p.clone()) }
            steps.push(json!({ "what": format!("place {}", p.display()), "op": "place", "path": p, "src": src, "sha256": h, "before": before, "owner": owner, "backup": null, "hooks": o.hooks, "state": "pending" }));
        }
        let bdir = if old.is_empty() { None } else { Some(backup(c, &old)?) };
        let mut k = 0;
        for s in steps.iter_mut() { if s["before"].is_string() { s["backup"] = json!(bdir.as_ref().unwrap().join(format!("{k:03}_{}", Path::new(s["path"].as_str().unwrap()).file_name().unwrap().to_string_lossy()))); k += 1 } }
        self.v = json!({ "open": true, "kind": kind, "meta": meta, "started": stamp(), "backupDir": bdir, "steps": steps });
        self.save(c)
    }

    /// run (or resume) the open run. A step's target must still be as it was before (or already as Setup wrote it); anything else stops the run.
    /// `crash_after` (tests only): abort the process right after step n is written, before it is marked done.
    pub fn run(&mut self, c: &Ctx, m: &mut Manifest, crash_after: Option<usize>) -> Result<Vec<String>, String> {
        if !self.is_open() { return Err("No open Setup run.".into()) }
        let mut log = vec![];
        let n = self.v["steps"].as_array().map_or(0, |a| a.len());
        for i in 0..n {
            let s = self.v["steps"][i].clone();
            if s["state"] == "done" { continue }
            let hooks = s["hooks"] == true;
            let p = c.guard_k(Path::new(s["path"].as_str().unwrap_or("")), hooks)?;
            let (want, cur) = (s["sha256"].as_str().unwrap_or(""), sha_file(&p));
            let what = s["what"].as_str().unwrap_or("").to_string();
            if s["op"] == "remove" {
                if cur.is_none() { log.push(format!("{what}: already removed")) }
                else if cur.as_deref() != s["before"].as_str() { return Err(format!("{} changed since Setup started; stopped, nothing guessed. Roll back or check the file.", p.display())) }
                else {
                    self.set(c, i, "running")?;
                    fs::remove_file(&p).map_err(|e| format!("remove {}: {e}", p.display()))?;
                    if crash_after == Some(i) { std::process::abort() }
                    log.push(format!("{what}: removed"));
                }
                m.forget(c, &p)?; self.set(c, i, "done")?; continue
            }
            if cur.as_deref() != Some(want) {
                if cur.as_deref() != s["before"].as_str() { return Err(format!("{} changed since Setup started; stopped, nothing guessed. Roll back or check the file.", p.display())) }
                self.set(c, i, "running")?;
                let b = fs::read(s["src"].as_str().unwrap_or("")).map_err(|e| format!("payload: {e}"))?;
                if sha(&b) != want { return Err("payload changed since the run was planned; stopped.".into()) }
                c.write_k(&p, &b, hooks)?;
                if crash_after == Some(i) { std::process::abort() }
                log.push(format!("{}: written", s["what"].as_str().unwrap_or("")));
            } else { log.push(format!("{}: already written", s["what"].as_str().unwrap_or(""))) }
            // settings.json is never listed (uninstall edits only the hook entries NEXUS added); a NEXUS file replaced by an update stays NEXUS-owned
            if !hooks { m.record(c, &p, if s["before"].is_string() && s["owner"] != "nexus" { "external" } else { "nexus" })? }
            self.set(c, i, "done")?;
        }
        if self.v["kind"] == "uninstall" {
            // M6e: the install record goes too; a verified copy is kept in a backup folder first, so Roll back can put it back
            if m.file.exists() {
                if self.v["manifestBackup"].is_null() { let d = backup(c, &[m.file.clone()])?; self.v["manifestBackup"] = json!(d.join("000_install-manifest.json")); self.save(c)? }
                fs::remove_file(c.guard(&m.file)?).map_err(|e| e.to_string())?;
            }
            log.push("install record removed".into());
            self.v["open"] = json!(false); self.save(c)?; return Ok(log)
        }
        // M6d: record the exact NEXUS version + Setup build in the manifest (update detection compares it); the previous values go
        // into the journal first (kept on a resume) so Roll back can restore them
        if self.v.get("versionBefore").is_none() {
            self.v["versionBefore"] = META.iter().map(|k| (k.to_string(), m.v[*k].clone())).collect::<serde_json::Map<_, _>>().into(); self.save(c)?;
        }
        m.v["app"] = json!(env!("CARGO_PKG_VERSION")); m.v["setup"] = json!(env!("NEXUS_ID")); m.v["installed"] = json!(stamp());
        for (k, v) in self.v["meta"].as_object().into_iter().flatten() { m.v[k] = v.clone() }
        m.save(c)?;
        log.push(format!("version {} recorded", env!("CARGO_PKG_VERSION")));
        self.v["open"] = json!(false); self.save(c)?; Ok(log)
    }

    /// undo newest first. A file is undone only while it still holds what Setup wrote: a created file is removed, a replaced one restored
    /// from its verified backup. Files changed since are kept and reported.
    pub fn rollback(&mut self, c: &Ctx, m: &mut Manifest) -> Result<Vec<String>, String> {
        let mut log = vec![];
        if let Some(bk) = self.v["manifestBackup"].as_str().filter(|_| !m.file.exists()) {
            let b = fs::read(c.guard(Path::new(bk))?).map_err(|e| format!("install record backup: {e}"))?;
            c.write(&m.file, &b)?; *m = Manifest::load(c); log.push("install record restored".into());
        }
        let n = self.v["steps"].as_array().map_or(0, |a| a.len());
        for i in (0..n).rev() {
            let s = self.v["steps"][i].clone();
            if s["state"] == "undone" { continue }
            let hooks = s["hooks"] == true;
            let p = c.guard_k(Path::new(s["path"].as_str().unwrap_or("")), hooks)?;
            let cur = sha_file(&p);
            let what = s["what"].as_str().unwrap_or("");
            if s["op"] == "remove" {
                if cur.is_none() {
                    let bk = s["backup"].as_str().ok_or("no backup recorded; stopped, nothing restored.")?;
                    let b = fs::read(c.guard(Path::new(bk))?).map_err(|e| format!("backup: {e}"))?;
                    if Some(sha(&b).as_str()) != s["before"].as_str() { return Err(format!("backup {bk} does not match; stopped, nothing restored.")) }
                    c.write(&p, &b)?; log.push(format!("{what}: restored from backup"));
                } else if cur.as_deref() == s["before"].as_str() { log.push(format!("{what}: nothing to undo")) }
                else { log.push(format!("{what}: kept, a different file is there now")) }
                if let Some(o) = s["owner"].as_str() { if sha_file(&p).as_deref() == s["before"].as_str() { m.record(c, &p, o)? } }
                self.set(c, i, "undone")?; continue
            }
            if cur.as_deref() == s["before"].as_str() { log.push(format!("{}: nothing to undo", s["what"].as_str().unwrap_or(""))) }
            else if cur.as_deref() == s["sha256"].as_str() {
                match s["backup"].as_str() {
                    None => { fs::remove_file(&p).map_err(|e| e.to_string())?; m.forget(c, &p)?; log.push(format!("{}: removed", s["what"].as_str().unwrap_or(""))) }
                    Some(bk) => {
                        let b = fs::read(c.guard(Path::new(bk))?).map_err(|e| format!("backup: {e}"))?;
                        if Some(sha(&b).as_str()) != s["before"].as_str() { return Err(format!("backup {bk} does not match; stopped, nothing restored.")) }
                        c.write_k(&p, &b, hooks)?;
                        // a replaced NEXUS file goes back on the list with its old content; anything else leaves it
                        if let Some(o) = s["owner"].as_str().filter(|_| !hooks) { m.record(c, &p, o)? } else { m.forget(c, &p)? }
                        log.push(format!("{}: restored from backup", s["what"].as_str().unwrap_or("")))
                    }
                }
            } else { log.push(format!("{}: kept, changed since Setup wrote it", s["what"].as_str().unwrap_or(""))) }
            self.set(c, i, "undone")?;
        }
        if let Some(b) = self.v.get("versionBefore").cloned() {
            for k in META { m.v[k] = b[k].clone() }
            m.save(c)?; log.push("recorded version restored".into());
        }
        self.v["open"] = json!(false); self.save(c)?; Ok(log)
    }
}

/// native Windows folder picker (IFileOpenDialog, folders only). None = cancelled.
// starts in `start` (the mock profile), so the dialog never opens in the real Documents folder
pub fn pick_folder(owner: isize, title: &str, start: &Path) -> Option<PathBuf> {
    use windows::{core::HSTRING, Win32::{Foundation::HWND, System::Com::*, UI::Shell::*}};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let d: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).ok()?;
        let o = d.GetOptions().ok()?;
        d.SetOptions(o | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST).ok()?;
        let _ = d.SetTitle(&HSTRING::from(title));
        if let Ok(f) = SHCreateItemFromParsingName::<_, _, IShellItem>(&HSTRING::from(start.as_os_str()), None) { let _ = d.SetFolder(&f); }
        d.Show((owner != 0).then(|| HWND(owner as _))).ok()?;
        let p = d.GetResult().ok()?.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as _));
        s.map(PathBuf::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn tmp(tag: &str) -> PathBuf { let p = std::env::temp_dir().join(format!("nexus-m6-{tag}-{}", std::process::id())); let _ = fs::remove_dir_all(&p); p }
    fn junction(link: &Path, to: &Path) { let ok = Command::new("cmd").args(["/c", "mklink", "/J"]).arg(link).arg(to).output().unwrap().status.success(); assert!(ok, "mklink /J failed") }
    fn payload(c: &Ctx, name: &str, body: &str) -> PathBuf { let p = c.root.join("payload").join(name); fs::create_dir_all(p.parent().unwrap()).unwrap(); fs::write(&p, body).unwrap(); p }

    #[test]
    fn path_rules_table() {
        let c = Ctx::new(&tmp("paths")).unwrap(); let e = &c.env; let h = e.home.to_string_lossy().to_string();
        let other = c.root.join("Users").join("other"); fs::create_dir_all(other.join("x")).unwrap();
        fs::create_dir_all(e.home.join("Documents")).unwrap();
        junction(&e.home.join("Documents").join("jlink"), &other);
        let refuse = |p: &str, kind: &str, why: &str| { let r = check(p, kind, e); assert!(matches!(&r, Err(m) if m.contains(why)), "{p} -> {:?} (want {why})", r) };
        refuse("", "folder", "not a valid");
        refuse(&format!("{h}\\a|b"), "folder", "not a valid");
        refuse("\\\\server\\share\\x", "folder", "Network paths");
        refuse("relative\\x", "folder", "full path");
        refuse("C:\\", "folder", "whole drive");
        refuse(&h, "folder", "whole user folder");
        refuse(&format!("{}\\Windows\\x", c.root.display()), "folder", "System and program");
        refuse(&e.appdata.to_string_lossy(), "folder", "App settings");
        refuse(&format!("{}\\x", other.display()), "folder", "another Windows user");
        refuse(&format!("{h}\\Documents\\..\\..\\other\\x"), "folder", "another Windows user");
        refuse(&format!("{h}\\Documents\\jlink\\x"), "folder", "another Windows user");
        refuse(&format!("{h}\\.claude\\skills\\s"), "folder", "Claude Code");
        refuse(&format!("{h}\\.claude\\settings.json"), "folder", "Claude Code settings");
        refuse(&format!("{h}\\Vault\\.obsidian"), "folder", "Obsidian settings");
        refuse(&format!("{}\\obsidian\\x", e.appdata.display()), "folder", "Obsidian's own");
        refuse(&format!("{h}\\Game\\graphify-out"), "folder", "Graphify");
        refuse(&format!("{h}\\.ssh\\keys"), "folder", ".ssh");
        refuse(&format!("{}\\outside", c.root.display()), "data", "inside your own user folder");
        let (p, w) = check(&format!("{h}\\Documents\\MyGame"), "folder", e).unwrap(); assert!(within(&e.home, &p) && w.is_none());
        let (_, w) = check(&format!("{h}\\OneDrive\\Game"), "folder", e).unwrap(); assert!(w.is_some());
        assert!(check(&format!("{h}\\.claude\\nexus-data"), "data", e).is_ok(), "data kind may sit in the profile");
        // picked folders: same rules + must sit inside the test root
        assert!(c.choose(&e.home.join("Documents"), "folder").is_ok());
        assert!(c.choose(&std::env::temp_dir().join("elsewhere"), "folder").is_err(), "picked folder outside the root refused");
        assert!(c.choose(&e.home.join(".ssh"), "folder").is_err());
    }

    #[test]
    fn root_and_guard() {
        assert!(Ctx::new(Path::new("C:\\NEXUS-not-temp")).is_err(), "root outside %TEMP% refused");
        assert!(Ctx::new(&std::env::temp_dir()).is_err(), "%TEMP% itself refused");
        let c = Ctx::new(&tmp("guard")).unwrap();
        assert!(c.write(&c.env.programs().join("a.txt"), b"x").is_ok());
        assert!(c.guard(&c.root.join("..").join("escape.txt")).is_err(), ".. escape refused");
        assert!(c.guard(&c.env.home.join("Vault").join(".obsidian").join("app.json")).is_err(), "protected inside root refused");
        assert!(c.guard(&c.env.home.join(".claude").join("settings.json")).is_err());
        let real_home = PathBuf::from(std::env::var("USERPROFILE").unwrap()).join("nexus-m6a-should-not-exist.txt");
        assert!(c.write(&real_home, b"x").is_err() && !real_home.exists(), "real profile write refused");
        let out = tmp("guard-out"); fs::create_dir_all(&out).unwrap();
        junction(&c.env.programs().join("jout"), &out);
        assert!(c.write(&c.env.programs().join("jout").join("x.txt"), b"x").is_err() && !out.join("x.txt").exists(), "junction out of the root refused");
        assert!(c.guard(&c.root).is_err(), "the root itself is not a file target");
    }

    #[test]
    fn lock_one_setup_per_folder() {
        let c = Ctx::new(&tmp("lock")).unwrap();
        let l = lock(&c).unwrap();
        assert!(matches!(lock(&c), Err(m) if m.contains("Another NEXUS Setup")), "second lock refused");
        drop(l);
        assert!(lock(&c).is_ok(), "free again once the first ends");
    }

    #[test]
    fn manifest_keeps_changed_and_external() {
        let c = Ctx::new(&tmp("manifest")).unwrap(); let mut m = Manifest::load(&c); let p = c.env.programs();
        for f in ["a", "b", "ext"] { c.write(&p.join(f), f.as_bytes()).unwrap(); }
        m.record(&c, &p.join("a"), "nexus").unwrap(); m.record(&c, &p.join("b"), "nexus").unwrap(); m.record(&c, &p.join("ext"), "external").unwrap();
        fs::write(p.join("b"), "user edit").unwrap();
        let r = Manifest::load(&c).removable();
        assert_eq!(r.len(), 1); assert!(r[0].ends_with("a"), "only unchanged NEXUS-owned files are removable: {r:?}");
    }

    #[test]
    fn backup_verified_and_never_overwritten() {
        let c = Ctx::new(&tmp("backup")).unwrap(); let p = c.env.programs();
        c.write(&p.join("cfg.json"), b"old").unwrap();
        let d1 = backup(&c, &[p.join("cfg.json")]).unwrap(); let d2 = backup(&c, &[p.join("cfg.json")]).unwrap();
        assert!(d1 != d2 && within(&c.env.backups(), &d1), "each backup gets a new folder");
        let mf: Value = serde_json::from_slice(&fs::read(d1.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(mf["files"][0]["sha256"], sha(b"old")); assert_eq!(fs::read(d1.join("000_cfg.json")).unwrap(), b"old");
        assert!(backup(&c, &[c.env.home.join("missing")]).is_err());
        assert!(stamp().len() == 17 && &stamp()[4..5] == "-");
    }

    #[test]
    fn existing_file_needs_permission_and_is_backed_up() {
        let c = Ctx::new(&tmp("replace")).unwrap(); let p = c.env.programs();
        c.write(&p.join("user.txt"), b"mine").unwrap();
        let src = payload(&c, "user.txt", "new");
        let mut j = Journal::load(&c);
        assert!(j.begin(&c, &[Op { path: p.join("user.txt"), src: src.clone(), replace: false, ..Default::default() }]).is_err(), "no permission = refused");
        assert!(!j.is_open() && !c.env.backups().exists() && fs::read(p.join("user.txt")).unwrap() == b"mine", "nothing changed, no backup");
        let mut m = Manifest::load(&c);
        j.begin(&c, &[Op { path: p.join("user.txt"), src, replace: true, ..Default::default() }]).unwrap();
        j.run(&c, &mut m, None).unwrap();
        assert_eq!(fs::read(p.join("user.txt")).unwrap(), b"new");
        assert!(m.removable().is_empty(), "a replaced pre-existing file stays external: never removable");
        let bk = j.v["steps"][0]["backup"].as_str().unwrap().to_string(); assert_eq!(fs::read(&bk).unwrap(), b"mine");
        // a finished run can still be rolled back from its journal: the original comes back
        let log = j.rollback(&c, &mut m).unwrap();
        assert!(fs::read(p.join("user.txt")).unwrap() == b"mine" && fs::read(&bk).unwrap() == b"mine", "{log:?}");
    }

    #[test]
    fn resume_and_rollback_after_crash() {
        let c = Ctx::new(&tmp("resume")).unwrap(); let p = c.env.programs();
        let ops = || vec![Op { path: p.join("a.exe"), src: payload(&c, "a", "A"), replace: false, ..Default::default() }, Op { path: p.join("b.dll"), src: payload(&c, "b", "B"), replace: false, ..Default::default() }, Op { path: p.join("c.cfg"), src: payload(&c, "c", "C"), replace: false, ..Default::default() }];
        let mut j = Journal::load(&c); j.begin(&c, &ops()).unwrap();
        // simulated crash: step 0 done, step 1 written but still "running", step 2 pending
        let mut m = Manifest::load(&c);
        j.set(&c, 0, "running").unwrap(); c.write(&p.join("a.exe"), b"A").unwrap(); m.record(&c, &p.join("a.exe"), "nexus").unwrap(); j.set(&c, 0, "done").unwrap();
        j.set(&c, 1, "running").unwrap(); c.write(&p.join("b.dll"), b"B").unwrap();
        let mut j = Journal::load(&c);
        assert!(j.is_open() && j.begin(&c, &ops()).is_err(), "open run found, new run refused");
        let log = j.run(&c, &mut Manifest::load(&c), None).unwrap();
        assert!(log[0].contains("already written") && log[1].contains("written") && fs::read(p.join("c.cfg")).unwrap() == b"C", "{log:?}");
        assert_eq!(Manifest::load(&c).removable().len(), 3);
        // second run that crashes, user edits one file meanwhile, then roll back
        let ops2 = vec![Op { path: p.join("d.txt"), src: payload(&c, "d", "D"), replace: false, ..Default::default() }, Op { path: p.join("e.txt"), src: payload(&c, "e", "E"), replace: false, ..Default::default() }];
        let mut j = Journal::load(&c); j.begin(&c, &ops2).unwrap();
        j.set(&c, 0, "running").unwrap(); c.write(&p.join("d.txt"), b"D").unwrap(); j.set(&c, 0, "done").unwrap();
        j.set(&c, 1, "running").unwrap(); c.write(&p.join("e.txt"), b"E").unwrap();
        fs::write(p.join("d.txt"), "user changed it").unwrap();
        let mut j = Journal::load(&c);
        assert!(j.run(&c, &mut Manifest::load(&c), None).is_ok(), "resume ignores done steps");
        let mut j2 = Journal::load(&c); j2.begin(&c, &[Op { path: p.join("f.txt"), src: payload(&c, "f", "F"), replace: false, ..Default::default() }]).unwrap();
        fs::write(p.join("f.txt"), "appeared meanwhile").unwrap();
        assert!(matches!(j2.run(&c, &mut Manifest::load(&c), None), Err(e) if e.contains("changed since Setup started")), "target changed before its step: stop");
        let log = j2.rollback(&c, &mut Manifest::load(&c)).unwrap();
        assert!(fs::read(p.join("f.txt")).unwrap() == b"appeared meanwhile" && log[0].contains("kept"), "{log:?}");
        let mut j3 = Journal { file: c.env.data().join("setup-journal.json"), v: j.v.clone() };
        let log = j3.rollback(&c, &mut Manifest::load(&c)).unwrap();
        assert!(!p.join("e.txt").exists() && fs::read(p.join("d.txt")).unwrap() == b"user changed it", "{log:?}");
    }
}
