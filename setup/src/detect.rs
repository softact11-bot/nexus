// M6c: read-only detection of existing NEXUS installs and the components NEXUS uses (port of tracker-dev setup.js).
// Never writes: fixed version commands, file lookups, registry reads, JSON reads. Profile files come from c.env (the mock profile in the test build).
// Status per item: installed | missing | outdated (older than the minimum) | unverified (found, but the version or files can't be confirmed).
use crate::core::{self, Ctx};
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}, process::{Command, Stdio}, sync::mpsc, time::Duration};

const WEBVIEW2: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
pub const APP_VER: &str = env!("CARGO_PKG_VERSION"); // the NEXUS version this Setup installs (same as src-tauri)

enum Out { Missing, Timeout, Ok(String) }

fn sys32(f: &str) -> PathBuf { PathBuf::from(std::env::var("SystemRoot").unwrap_or("C:\\Windows".into())).join("System32").join(f) }

/// one fixed command, no window, 8 s limit; a non-zero exit (e.g. the Store "python" alias) counts as missing
fn run(exe: PathBuf, args: &[&str]) -> Out { run_for(exe, args, Duration::from_secs(8)) }

/// M6d: the check runs in its own Windows job (started suspended, put in the job, then resumed, so nothing it starts escapes).
/// On timeout the job is terminated: the check and everything it started stop; no other process is touched.
fn run_for(exe: PathBuf, args: &[&str], limit: Duration) -> Out {
    use std::os::windows::{io::AsRawHandle, process::CommandExt};
    use windows_sys::Win32::{Foundation::CloseHandle, System::{JobObjects::*, Threading::*, Diagnostics::ToolHelp::*}};
    let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    let child = Command::new(exe).args(args).creation_flags(0x0800_0000 | CREATE_SUSPENDED).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn();
    let Ok(mut child) = child else { unsafe { CloseHandle(job) }; return Out::Missing };
    let pid = child.id();
    unsafe {
        if job.is_null() || AssignProcessToJobObject(job, child.as_raw_handle() as _) == 0 { let _ = child.kill(); let _ = child.wait(); CloseHandle(job); return Out::Missing }
        // resume the suspended main thread (the only thread of a new process)
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        let mut te: THREADENTRY32 = std::mem::zeroed(); te.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        let mut ok = Thread32First(snap, &mut te);
        while ok != 0 {
            if te.th32OwnerProcessID == pid { let t = OpenThread(THREAD_SUSPEND_RESUME, 0, te.th32ThreadID); if !t.is_null() { ResumeThread(t); CloseHandle(t); } }
            ok = Thread32Next(snap, &mut te);
        }
        CloseHandle(snap);
    }
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || { let _ = tx.send(child.wait_with_output()); });
    let r = match rx.recv_timeout(limit) {
        Ok(Ok(o)) if o.status.success() => Out::Ok(String::from_utf8_lossy(&o.stdout).trim().to_string()),
        Ok(_) => Out::Missing,
        Err(_) => { unsafe { TerminateJobObject(job, 1) }; let _ = rx.recv_timeout(Duration::from_secs(2)); Out::Timeout }
    };
    unsafe { CloseHandle(job) };
    r
}
/// a command found through PATH / PATHEXT (also .cmd shims such as npm's), via cmd /d /c with fixed arguments only
fn tool(name: &str, args: &[&str]) -> Out { let mut a = vec!["/d", "/c", name]; a.extend(args); run(sys32("cmd.exe"), &a) }
fn reg(key: &str, val: Option<&str>) -> Option<String> {
    let mut a = vec!["query", key]; if let Some(v) = val { a.extend(["/v", v]) }
    match run(sys32("reg.exe"), &a) { Out::Ok(s) => Some(s), _ => None }
}

/// first version-looking token after `marker` ("" = anywhere): digits and dots, plus letters (2.45.1.windows.1)
pub fn ver(s: &str, marker: &str) -> Option<String> {
    let i = s.find(marker)? + marker.len();
    let t = &s[i..];
    let j = t.find(|c: char| c.is_ascii_digit())?;
    let v: String = t[j..].chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '.').collect();
    Some(v.trim_end_matches('.').to_string())
}
/// a < b on the leading numbers (1.10 > 1.9)
pub fn older(a: &str, b: &str) -> bool {
    let n = |s: &str| s.split('.').map_while(|p| p.parse::<u64>().ok()).collect::<Vec<_>>();
    n(a) < n(b)
}
pub fn status(found: bool, version: Option<&str>, min: Option<&str>) -> &'static str {
    match (found, version) {
        (false, _) => "missing",
        (true, None) => "unverified",
        (true, Some(v)) if min.is_some_and(|m| older(v, m)) => "outdated",
        _ => "installed",
    }
}
fn from(o: &Out, marker: &str) -> (bool, Option<String>) {
    match o { Out::Missing => (false, None), Out::Timeout => (true, None), Out::Ok(s) => (true, ver(s, marker)) }
}

/// file version resource (ProductVersion numbers) of an exe, if it has one
fn file_version(p: &Path) -> Option<String> {
    use windows_sys::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO};
    let w: Vec<u16> = p.as_os_str().to_string_lossy().encode_utf16().chain([0]).collect();
    unsafe {
        let n = GetFileVersionInfoSizeW(w.as_ptr(), std::ptr::null_mut());
        if n == 0 { return None }
        let mut buf = vec![0u8; n as usize];
        if GetFileVersionInfoW(w.as_ptr(), 0, n, buf.as_mut_ptr() as _) == 0 { return None }
        let (mut fi, mut len) = (std::ptr::null_mut(), 0u32);
        let root: Vec<u16> = "\\".encode_utf16().chain([0]).collect();
        if VerQueryValueW(buf.as_ptr() as _, root.as_ptr(), &mut fi, &mut len) == 0 || fi.is_null() { return None }
        let f = &*(fi as *const VS_FIXEDFILEINFO);
        Some(format!("{}.{}.{}", f.dwProductVersionMS >> 16, f.dwProductVersionMS & 0xffff, f.dwProductVersionLS >> 16))
    }
}

fn is_file(p: &Path) -> bool { p.is_file() }
fn is_dir(p: &Path) -> bool { p.is_dir() }
fn read_json(p: &Path) -> Option<Value> { fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()) }

pub fn detect(c: &Ctx) -> Value {
    let e = &c.env;
    let real_home = std::env::var("USERPROFILE").unwrap_or_default();
    let red = |p: &Path| -> String {
        let mut s = p.to_string_lossy().to_string();
        for h in [e.home.to_string_lossy().to_string(), real_home.clone()] { if !h.is_empty() { s = s.replace(&h, "%USERPROFILE%") } }
        s
    };
    // all version commands at once
    let (node, claude, git, uv, tools, py, uvpy, rust, wv, wvu, lx) = std::thread::scope(|s| {
        let t = |n: &'static str, a: &'static [&'static str]| s.spawn(move || tool(n, a));
        let (a, b, g, u, ut, p, up, r) = (t("node", &["-v"]), t("claude", &["--version"]), t("git", &["--version"]), t("uv", &["--version"]),
            t("uv", &["tool", "list"]), t("python", &["--version"]), t("uv", &["python", "list", "--only-installed"]), t("rustc", &["--version"]));
        let w = s.spawn(|| reg(&format!("HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{WEBVIEW2}"), Some("pv")));
        let wu = s.spawn(|| reg(&format!("HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\{WEBVIEW2}"), Some("pv")));
        let l = s.spawn(|| reg("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss", None));
        let j = |h: std::thread::ScopedJoinHandle<'_, Out>| h.join().unwrap_or(Out::Missing);
        (j(a), j(b), j(g), j(u), j(ut), j(p), j(up), j(r), w.join().ok().flatten(), wu.join().ok().flatten(), l.join().ok().flatten())
    });

    // Obsidian (per-user install) + registered vaults: obsidian.json is read, each folder is only checked, inside a vault only .obsidian/plugins is listed
    let obs_exe = e.local.join("Programs").join("Obsidian").join("Obsidian.exe");
    let obs = is_file(&obs_exe);
    let vaults: Option<Vec<Value>> = read_json(&e.appdata.join("obsidian").join("obsidian.json")).map(|j| {
        j["vaults"].as_object().into_iter().flatten().filter_map(|(_, v)| v["path"].as_str()).map(|p| {
            let p = Path::new(p); let dot = p.join(".obsidian");
            let plugins = fs::read_dir(dot.join("plugins")).map_or(0, |d| d.count());
            json!({ "name": p.file_name().map_or(String::new(), |n| n.to_string_lossy().to_string()), "path": red(p), "exists": is_dir(p), "dot": is_dir(&dot), "plugins": plugins, "reg": true })
        }).collect()
    });
    let nv = vaults.as_ref().map(|v| v.len());

    let wv_ver = wv.as_deref().and_then(|s| ver(s, "REG_SZ")).or_else(|| wvu.as_deref().and_then(|s| ver(s, "REG_SZ")));
    let (py_f, py_v) = from(&py, "Python ");
    let uv_py = match &uvpy { Out::Ok(s) => ver(s, "cpython-"), _ => None };
    let (gf_f, gf_v) = match &tools { Out::Ok(s) if s.contains("graphifyy") => (true, ver(s, "graphifyy v")), Out::Timeout => (true, None), _ => (false, None) };
    let mut deps = vec![];
    let mut add = |id: &str, name: &str, role: &str, (found, version): (bool, Option<String>), min: Option<&str>, note: Option<String>, src: &str, check: &str| {
        let st = status(found, version.as_deref(), min);
        deps.push(json!({ "id": id, "name": name, "role": role, "status": st, "found": found, "version": version, "min": min, "note": note, "src": src, "check": check }));
    };
    add("webview2", "Microsoft Edge WebView2", "required", (wv_ver.is_some(), wv_ver.clone()), None, None, "Built into Windows 11 (Microsoft)", "Ships with Windows");
    // global Node first; else the private copy Setup installed (req.rs) in the NEXUS folder
    let (nf, nv0) = from(&node, "");
    let pn = crate::req::runtime_node(c);
    let (node_t, node_note) = if (!nf || nv0.as_deref().is_some_and(|v| older(v, "18"))) && pn.is_file() { (from(&run(pn, &["-v"]), ""), Some("private copy in the NEXUS folder".to_string())) } else { ((nf, nv0), None) };
    add("node", "Node.js", "required", node_t, Some("18"), node_note, "nodejs.org (LTS zip, private copy)", "SHA-256 vs SHASUMS256.txt");
    add("claude", "Claude Code", "required", from(&claude, ""), None, None, "claude.ai/install.ps1 (Anthropic)", "Official install script over HTTPS");
    add("obsidian", "Obsidian", "optional", (obs, obs.then(|| file_version(&obs_exe)).flatten()), None,
        nv.map(|n| format!("{n} vault{} registered", if n == 1 { "" } else { "s" })), "obsidian.md / official GitHub releases", "Authenticode signature");
    add("python", "Python", "optional", (py_f || uv_py.is_some(), py_v.clone().or(uv_py.clone())), None,
        (!py_f && uv_py.is_some()).then(|| "managed by uv".to_string()), "python.org, or a uv-managed Python", "Authenticode / uv hashes");
    add("uv", "uv (Python tool runner)", "optional", from(&uv, "uv "), None, None, "astral.sh/uv", "SHA-256 from the release");
    add("graphify", "Graphify", "optional", (gf_f, gf_v), None, None, "PyPI graphifyy via uv (third party)", "uv lockfile hashes");
    add("git", "Git for Windows", "optional", from(&git, "version "), None, None, "git-scm.com", "Authenticode signature");
    if let Some(g) = deps.iter_mut().find(|d| d["id"] == "graphify") { g["needs"] = json!("uv") }

    let mut shells: Vec<&str> = [("Windows PowerShell", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"), ("PowerShell 7", "C:\\Program Files\\PowerShell\\7\\pwsh.exe"),
        ("Command Prompt", "C:\\Windows\\System32\\cmd.exe"), ("Git Bash", "C:\\Program Files\\Git\\bin\\bash.exe")].iter().filter(|s| is_file(Path::new(s.1))).map(|s| s.0).collect();
    if is_file(Path::new("C:\\Windows\\System32\\wsl.exe")) && lx.is_some() { shells.push("WSL") } // a registered distro means WSL is usable

    let disk = disk(&e.local);
    json!({ "at": core::stamp(), "readOnly": true, "rust": matches!(rust, Out::Ok(_)), "deps": deps, "shells": shells, "disk": disk, "vaults": vaults.unwrap_or_default(),
        "graphifySkill": is_dir(&e.home.join(".claude").join("skills").join("graphify")),
        "existing": tracker(e, &red), "install": install(c, &red), "appVersion": APP_VER,
        "paths": { "program": red(&e.programs()), "data": red(&e.data()), "backups": red(&e.backups()) } })
}

/// the NEXUS people run today: the tracker folder (~/.claude/token-tracker) + its Claude Code hooks, counted only
fn tracker(e: &core::Env, red: &dyn Fn(&Path) -> String) -> Value {
    let t = e.home.join(".claude").join("token-tracker");
    if !is_file(&t.join("tracker.js")) { return Value::Null }
    let pj = read_json(&t.join("projects.json"));
    let list: Vec<Value> = pj.as_ref().and_then(|p| p.as_array().or(p["items"].as_array()).or(p["projects"].as_array())).cloned().unwrap_or_default();
    let plist: Vec<Value> = list.iter().map(|p| { let dir = p["dir"].as_str().unwrap_or("");
        json!({ "name": p["name"], "dir": red(Path::new(dir)), "vault": p["obsidian"].as_str().map_or(String::new(), |v| red(Path::new(v))),
                "graph": !dir.is_empty() && is_file(&Path::new(dir).join("graphify-out").join("graph.json")) }) }).collect();
    let mut hooks = 0;
    if let Some(s) = read_json(&e.home.join(".claude").join("settings.json")) {
        for g in s["hooks"].as_object().into_iter().flatten().map(|x| x.1) { for m in g.as_array().into_iter().flatten() { for h in m["hooks"].as_array().into_iter().flatten() {
            let cmd = h["command"].as_str().unwrap_or("").replace('/', "\\");
            if cmd.contains("token-tracker\\tracker.js") { hooks += 1 } } } }
    }
    // projects.json present but unreadable = the data can't be confirmed (never repaired by detection)
    let st = if is_file(&t.join("projects.json")) && pj.is_none() { "unverified" } else { "installed" };
    json!({ "kind": "tracker", "status": st, "dir": red(&t), "projects": plist.len(), "plist": plist, "hooks": hooks,
            "manifest": is_file(&t.join("install-manifest.json")), "automations": is_file(&t.join("automations.json")) })
}

/// a NEXUS placed by this Setup: Programs\NEXUS\install-manifest.json; its NEXUS-owned files are hash-checked, the version is compared with this Setup's
fn install(c: &Ctx, red: &dyn Fn(&Path) -> String) -> Value {
    let dir = c.env.programs();
    let Some(m) = read_json(&dir.join("install-manifest.json")) else { return Value::Null };
    let files = m["files"].as_object().cloned().unwrap_or_default();
    let own: Vec<_> = files.iter().filter(|(_, v)| v["owner"] == "nexus").collect();
    let changed = own.iter().filter(|(p, v)| fs::read(p).ok().map(|b| core::sha(&b)).as_deref() != v["sha256"].as_str()).count();
    let gone = own.iter().filter(|(p, _)| !Path::new(p).exists()).count();
    // M6d: the exact version Setup recorded at install is the reference; nexus.exe's own version resource must agree with it
    let (rec, exe) = (m["app"].as_str().map(String::from), file_version(&dir.join("nexus.exe")));
    let mismatch = matches!((&rec, &exe), (Some(a), Some(b)) if older(a, b) || older(b, a));
    let version = rec.clone().or(exe.clone());
    let (st, note) = if changed > 0 { ("unverified", format!("{changed} program file(s) changed or missing since install")) }
        else if mismatch { ("unverified", "nexus.exe version differs from the version recorded at install".into()) }
        else if version.as_deref().is_some_and(|v| older(APP_VER, v)) { ("newer", format!("newer than this Setup ({APP_VER}); Setup never downgrades it")) } // M6e
        else { (status(true, version.as_deref(), Some(APP_VER)), if version.is_none() { "no version recorded".into() } else { String::new() }) };
    json!({ "kind": "setup", "status": st, "note": note, "dir": red(&dir), "version": version, "recorded": rec, "exeVersion": exe, "installed": m["installed"], "files": files.len(), "owned": own.len(), "changed": changed, "missing": gone, "setupVersion": APP_VER })
}

fn disk(p: &Path) -> Value {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let w: Vec<u16> = p.as_os_str().to_string_lossy().encode_utf16().chain([0]).collect();
    let (mut free, mut total) = (0u64, 0u64);
    if unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut free, &mut total, std::ptr::null_mut()) } == 0 { return Value::Null }
    json!({ "free": free, "total": total })
}

/// vault folders registered in Obsidian (read-only)
pub fn vault_paths(e: &core::Env) -> Vec<PathBuf> {
    read_json(&e.appdata.join("obsidian").join("obsidian.json")).map_or(vec![], |j|
        j["vaults"].as_object().into_iter().flatten().filter_map(|(_, v)| v["path"].as_str().map(PathBuf::from)).collect())
}

/// M6c new vault: only a new or empty folder, never inside or around a registered vault; creates the folder + one starter note (NEXUS-owned).
/// Obsidian's own files (obsidian.json, .obsidian) are never written: the user opens the vault with the returned obsidian:// link (shown, never launched).
pub fn new_vault(c: &Ctx, m: &mut core::Manifest, p: &Path) -> Result<Value, String> {
    let (r, warn) = c.choose(p, "folder")?;
    if vault_paths(&c.env).iter().any(|v| { let v = core::real(v); core::within(&v, &r) || core::within(&r, &v) }) { return Err("That folder is inside (or contains) an existing vault; connect that vault instead.".into()) }
    if r.exists() && (!r.is_dir() || fs::read_dir(&r).map_or(true, |mut d| d.next().is_some())) { return Err("Pick a new or empty folder; Setup never writes into a folder that already has files.".into()) }
    let note = r.join("Welcome to NEXUS.md");
    c.write(&note, b"# Welcome\n\nThis vault was created by NEXUS Setup. Notes are plain Markdown files in this folder.\n")?;
    m.record(c, &note, "nexus")?;
    let enc: String = r.to_string_lossy().bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect();
    Ok(json!({ "path": r, "note": note, "open": format!("obsidian://open?path={enc}"), "warn": warn }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn new_vault_only_in_new_or_empty_folder() {
        let t = std::env::temp_dir().join(format!("nexus-m6c-vault-{}", std::process::id())); let _ = fs::remove_dir_all(&t);
        let c = Ctx::new(&t).unwrap(); let mut m = core::Manifest::load(&c);
        let docs = c.env.home.join("Documents"); let old = docs.join("Old Vault");
        fs::create_dir_all(old.join(".obsidian")).unwrap(); fs::create_dir_all(docs.join("Busy")).unwrap(); fs::write(docs.join("Busy").join("a.md"), "x").unwrap();
        let oj = c.env.appdata.join("obsidian"); fs::create_dir_all(&oj).unwrap();
        let reg = json!({ "vaults": { "a1": { "path": old } } }).to_string(); fs::write(oj.join("obsidian.json"), &reg).unwrap();
        assert!(new_vault(&c, &mut m, &old.join("Sub")).is_err(), "inside a registered vault refused");
        assert!(new_vault(&c, &mut m, &docs).is_err(), "folder holding a vault refused");
        assert!(new_vault(&c, &mut m, &docs.join("Busy")).is_err(), "non-empty folder refused");
        assert_eq!(fs::read_to_string(docs.join("Busy").join("a.md")).unwrap(), "x");
        assert!(new_vault(&c, &mut m, &std::env::temp_dir().join("nexus-elsewhere")).is_err(), "outside the test root refused");
        let v = new_vault(&c, &mut m, &docs.join("My Notes")).unwrap();
        assert!(docs.join("My Notes").join("Welcome to NEXUS.md").is_file() && v["open"].as_str().unwrap().starts_with("obsidian://open?path=C%3A%5C"));
        assert!(!docs.join("My Notes").join(".obsidian").exists() && fs::read_to_string(oj.join("obsidian.json")).unwrap() == reg, "Obsidian config never written");
        fs::create_dir_all(docs.join("Empty")).unwrap();
        assert!(new_vault(&c, &mut m, &docs.join("Empty")).is_ok(), "empty folder accepted");
        assert_eq!(m.removable().len(), 2, "both starter notes NEXUS-owned");
        let _ = fs::remove_dir_all(&t);
    }
    #[test]
    fn timeout_stops_the_check_and_its_children_only() {
        // processes whose command line holds `tag` (CIM, read-only)
        let alive = |tag: &str| { let o = Command::new(sys32("WindowsPowerShell\\v1.0\\powershell.exe")).args(["-NoProfile", "-Command",
            &format!("@(Get-CimInstance Win32_Process | ? {{ $_.CommandLine -like '*{tag}*' -and $_.Name -eq 'PING.EXE' }}).Count")]).output().unwrap();
            String::from_utf8_lossy(&o.stdout).trim().parse::<u32>().unwrap_or(99) };
        let mut other = Command::new(sys32("PING.EXE")).args(["-n", "30", "127.0.0.78"]).stdout(Stdio::null()).spawn().unwrap(); // unrelated
        let t = std::time::Instant::now();
        // cmd starts ping as a grandchild of Setup: both must stop at the limit
        assert!(matches!(run_for(sys32("cmd.exe"), &["/d", "/c", "ping", "-n", "30", "127.0.0.77"], Duration::from_secs(1)), Out::Timeout));
        assert!(t.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(alive("127.0.0.77"), 0, "timed-out check left a process running");
        assert_eq!(alive("127.0.0.78"), 1, "an unrelated process was touched");
        let _ = other.kill(); let _ = other.wait();
        assert!(matches!(run_for(sys32("cmd.exe"), &["/d", "/c", "echo", "v1.2.3"], Duration::from_secs(8)), Out::Ok(s) if s == "v1.2.3"));
    }
    #[test]
    fn versions_and_status() {
        assert_eq!(ver("v22.11.0", "").as_deref(), Some("22.11.0"));
        assert_eq!(ver("git version 2.45.1.windows.1", "version ").as_deref(), Some("2.45.1.windows.1"));
        assert_eq!(ver("uv 0.5.11 (c4d0caaee 2024-12-19)", "uv ").as_deref(), Some("0.5.11"));
        assert_eq!(ver("cpython-3.12.4-windows-x86_64-none  C:\\x", "cpython-").as_deref(), Some("3.12.4"));
        assert_eq!(ver("    pv    REG_SZ    131.0.2903.70", "REG_SZ").as_deref(), Some("131.0.2903.70"));
        assert_eq!(ver("graphifyy v0.3.1\n- graphify", "graphifyy v").as_deref(), Some("0.3.1"));
        assert!(older("16.20.0", "18") && !older("18.0.0", "18") && !older("1.10", "1.9") && older("0.0.1", "0.0.2"));
        assert_eq!(status(false, None, None), "missing");
        assert_eq!(status(true, None, None), "unverified");
        assert_eq!(status(true, Some("16.1.0"), Some("18")), "outdated");
        assert_eq!(status(true, Some("22.1.0"), Some("18")), "installed");
    }
}
