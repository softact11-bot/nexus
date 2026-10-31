// M7h required software: Install / Update for WebView2 Runtime and Node.js. Plan: my-game/docs/NEXUS Setup Requirements Plan.md
// (APPROVED 2026-10-30, private Node). Runs only on the user's click. Downloads with Windows' own curl.exe (HTTPS only, TLS 1.2+),
// Node zip SHA-256 vs nodejs.org SHASUMS256.txt, WebView2 bootstrapper Authenticode signer Microsoft. Node unpacks into
// <Programs\NEXUS>\runtime\node: the user's global Node and PATH are never touched. Setup's Ctx is a test root, so the WebView2
// installer (a system component) is verified but not run in this build.
use crate::{core::{self, Ctx}, detect};
use serde_json::{json, Value};
use std::{fs, os::windows::process::CommandExt, path::{Path, PathBuf}, process::{Command, Stdio}, sync::{atomic::{AtomicBool, Ordering}, Mutex}, time::{Duration, Instant}};

const NO_WINDOW: u32 = 0x0800_0000;
pub const WV2_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
pub const NODE_DIST: &str = "https://nodejs.org/dist/";
pub static CANCEL: AtomicBool = AtomicBool::new(false);
static PROG: Mutex<Option<(PathBuf, u64, String)>> = Mutex::new(None); // file being downloaded, expected bytes, step

fn sys32(f: &str) -> PathBuf { PathBuf::from(std::env::var("SystemRoot").unwrap_or("C:\\Windows".into())).join("System32").join(f) }
fn arch() -> &'static str {
    let a = std::env::var("PROCESSOR_ARCHITEW6432").or_else(|_| std::env::var("PROCESSOR_ARCHITECTURE")).unwrap_or_default();
    if a.eq_ignore_ascii_case("ARM64") { "arm64" } else { "x64" }
}
pub fn runtime_node(c: &Ctx) -> PathBuf { c.env.programs().join("runtime").join("node").join("node.exe") }
fn step(s: &str, f: Option<(&Path, u64)>) { *PROG.lock().unwrap() = Some((f.map(|x| x.0.to_path_buf()).unwrap_or_default(), f.map_or(0, |x| x.1), s.into())) }
pub fn progress() -> Value {
    match &*PROG.lock().unwrap() {
        Some((p, t, s)) => json!({ "step": s, "bytes": fs::metadata(p).map(|m| m.len()).unwrap_or(0), "total": t }),
        None => json!({ "step": null }),
    }
}

// one curl.exe run; Cancel kills it and deletes the partial file
fn curl(args: &[&str], limit: Duration) -> Result<String, String> {
    let mut ch = Command::new(sys32("curl.exe")).args(["-fsSL", "--proto", "=https", "--proto-redir", "=https", "--tlsv1.2", "--connect-timeout", "20"]).args(args)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).creation_flags(NO_WINDOW).spawn().map_err(|e| format!("Windows' download tool (curl.exe) could not start: {e}"))?;
    let t0 = Instant::now();
    loop {
        if CANCEL.load(Ordering::SeqCst) { let _ = ch.kill(); let _ = ch.wait(); return Err("Cancelled. Nothing was installed.".into()) }
        if t0.elapsed() > limit { let _ = ch.kill(); let _ = ch.wait(); return Err("The download took too long and was stopped. Nothing was installed.".into()) }
        if let Some(st) = ch.try_wait().map_err(|e| e.to_string())? {
            let o = ch.wait_with_output().map_err(|e| e.to_string())?;
            return if st.success() { Ok(String::from_utf8_lossy(&o.stdout).into()) }
                else { Err(format!("The download failed (curl code {}). You may be offline, or a firewall blocks the site.", st.code().unwrap_or(-1))) };
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}
// text files go through a file too: a piped stdout fills up and blocks curl (index.json is several hundred KB)
fn text(url: &str, dl: &Path) -> Result<String, String> {
    let f = dl.join("t.txt");
    curl(&["-o", &f.to_string_lossy(), url], Duration::from_secs(120))?;
    fs::read_to_string(&f).map_err(|e| e.to_string())
}
fn fetch(url: &str, out: &Path, name: &str) -> Result<(), String> {
    let total = curl(&["-I", url], Duration::from_secs(30)).ok().and_then(|h| h.lines().filter_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<u64>().unwrap_or(0))).last()).unwrap_or(0);
    step(&format!("Downloading {name}"), Some((out, total)));
    let r = curl(&["-o", &out.to_string_lossy(), url], Duration::from_secs(900));
    if r.is_err() { let _ = fs::remove_file(out); }
    r.map(|_| ())
}

// newest LTS from nodejs.org/dist/index.json (read at click time, never hard-coded)
pub fn node_lts(dl: &Path) -> Result<String, String> {
    let j: Value = serde_json::from_str(&text(&format!("{NODE_DIST}index.json"), dl)?).map_err(|_| "nodejs.org sent an unreadable version list.".to_string())?;
    j.as_array().and_then(|a| a.iter().find(|v| v["lts"].is_string()).and_then(|v| v["version"].as_str().map(String::from))).ok_or_else(|| "No LTS version found on nodejs.org.".into())
}
pub fn sha_line(sums: &str, file: &str) -> Option<String> {
    sums.lines().find_map(|l| { let mut p = l.split_whitespace(); let (h, f) = (p.next()?, p.next()?); (f == file && h.len() == 64).then(|| h.to_ascii_lowercase()) })
}

fn node(c: &Ctx, dl: &Path) -> Result<Value, String> {
    step("Checking nodejs.org for the newest LTS", None);
    let v = node_lts(dl)?;
    let file = format!("node-{v}-win-{}.zip", arch());
    let sums = text(&format!("{NODE_DIST}{v}/SHASUMS256.txt"), dl)?;
    let want = sha_line(&sums, &file).ok_or("nodejs.org has no checksum for this download, so it was not used.")?;
    let zip = dl.join(&file);
    fetch(&format!("{NODE_DIST}{v}/{file}"), &zip, &format!("Node.js {v}"))?;
    step("Checking the download", None);
    let got = core::sha(&fs::read(&zip).map_err(|e| e.to_string())?);
    if got != want { let _ = fs::remove_file(&zip); return Err("The download does not match nodejs.org's checksum, so it was deleted and not installed. Try again later.".into()) }
    step("Unpacking", None);
    let x = dl.join("x");
    fs::create_dir_all(&x).map_err(|e| e.to_string())?;
    let st = Command::new(sys32("tar.exe")).args(["-xf", &zip.to_string_lossy(), "-C", &x.to_string_lossy()]).creation_flags(NO_WINDOW).status().map_err(|e| e.to_string())?;
    let new = x.join(file.trim_end_matches(".zip"));
    if !st.success() || !new.join("node.exe").is_file() { return Err("The Node.js download could not be unpacked. Nothing was changed.".into()) }
    // swap in: old copy kept until the new one is in place
    let dst = runtime_node(c).parent().unwrap().to_path_buf();
    let old = dst.with_extension("old");
    let _ = fs::remove_dir_all(&old);
    if dst.exists() { fs::rename(&dst, &old).map_err(|e| format!("The old private Node.js copy is in use (close NEXUS and retry): {e}"))? }
    if let Err(e) = fs::rename(&new, &dst) { if old.exists() { let _ = fs::rename(&old, &dst); } return Err(format!("Node.js could not be put in place: {e}")) }
    let _ = fs::remove_dir_all(&old);
    step("Checking the installed version", None);
    let out = Command::new(runtime_node(c)).arg("-v").creation_flags(NO_WINDOW).output().map_err(|e| e.to_string())?;
    let got_v = detect::ver(&String::from_utf8_lossy(&out.stdout), "").unwrap_or_default(); // "v26.1.0" -> "26.1.0"
    if !out.status.success() || detect::older(&got_v, "18") { return Err(format!("The private Node.js copy does not run correctly ({got_v}).")) }
    Ok(json!({ "version": got_v, "where": "private copy in the NEXUS folder" }))
}

pub fn signer(p: &Path) -> Result<String, String> {
    let ps = format!("$s = Get-AuthenticodeSignature -LiteralPath '{}'; \"$($s.Status)|$($s.SignerCertificate.Subject)\"", p.to_string_lossy().replace('\'', "''"));
    let o = Command::new(sys32("WindowsPowerShell\\v1.0\\powershell.exe")).args(["-NoProfile", "-NonInteractive", "-Command", &ps]).creation_flags(NO_WINDOW).output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
}
pub fn microsoft_signed(s: &str) -> bool { s.strip_prefix("Valid|").is_some_and(|sub| sub.split(", ").any(|f| f.trim() == "O=Microsoft Corporation")) }

fn webview2(dl: &Path) -> Result<Value, String> {
    let exe = dl.join("MicrosoftEdgeWebview2Setup.exe");
    fetch(WV2_URL, &exe, "the WebView2 installer")?;
    step("Checking Microsoft's signature", None);
    if !microsoft_signed(&signer(&exe)?) { let _ = fs::remove_file(&exe); return Err("The WebView2 installer is not validly signed by Microsoft, so it was deleted and not run.".into()) }
    // ponytail: test-root Setup never changes the real system; run `<exe> /silent /install` unelevated here once Setup installs for real
    Ok(json!({ "verified": true, "ran": false, "note": "Installer downloaded and verified (signed by Microsoft). This Setup build installs into a test folder, so the system installer was not run." }))
}

pub fn install(c: &Ctx, id: &str) -> Value {
    CANCEL.store(false, Ordering::SeqCst);
    let dl = c.env.programs().join("runtime").join(format!(".dl-{}", std::process::id()));
    let r = fs::create_dir_all(&dl).map_err(|e| e.to_string()).and_then(|_| match id { "node" => node(c, &dl), "webview2" => webview2(&dl), _ => Err("Unknown component.".into()) });
    let _ = fs::remove_dir_all(&dl);
    *PROG.lock().unwrap() = None;
    c.log(json!({ "event": "req install", "id": id, "ok": r.is_ok() }));
    match r { Ok(v) => json!({ "ok": true, "result": v }), Err(e) => json!({ "ok": false, "error": e }) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checksum_and_signer_rules() {
        let s = "aa  node-v1-win-x64.zip\n".replace("aa", &"a".repeat(64));
        assert_eq!(sha_line(&s, "node-v1-win-x64.zip").as_deref(), Some("a".repeat(64).as_str()));
        assert_eq!(sha_line(&s, "node-v1-win-arm64.zip"), None);
        assert!(sha_line("abc  node-v1-win-x64.zip", "node-v1-win-x64.zip").is_none());
        assert!(microsoft_signed("Valid|CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond"));
        assert!(!microsoft_signed("HashMismatch|CN=Microsoft Corporation, O=Microsoft Corporation"));
        assert!(!microsoft_signed("Valid|CN=Evil, O=Microsoft Corporation Fake"), "exact O= value");
    }
}
