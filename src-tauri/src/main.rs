// M5b app shell (spec §26.9). One NEXUS window per Windows user session (single-instance plugin) that attaches to the running
// tracker or starts it detached (quitting the app never stops it). M5d: one command, `term` (term.rs), only for the tracker origin. Sign-in without any secret on a command line or in a URL:
// the app reads the user-only launch.key itself and puts the token straight into WebView2's cookie store as the same HttpOnly
// cookie /launch would set (M4b). Pages get no other IPC. Navigation is locked to the exact
// http://127.0.0.1:<port> origin (plus the bundled splash), new windows are refused, WEBVIEW2_* and NEXUS_TOKEN are dropped.
// Pages are the tracker's own: settings come from /api/settings (M4e) when this WebView2 profile has none yet.
// M5b 1a: the listener on the port is classified into 8 states before anything is sent (detect). The token goes only to a
// listener owned by this Windows user, running node.exe, that proved it holds launch.key (B61 /api/prove HMAC of a fresh nonce).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use sha2::{Digest, Sha256};
use std::{io::{ErrorKind, Read, Write}, net::TcpStream, os::windows::process::CommandExt, path::PathBuf, process::{Child, Command, Stdio}, sync::{atomic::{AtomicBool, AtomicU16, Ordering::SeqCst}, mpsc, Arc, Mutex}, thread, time::{Duration, Instant, SystemTime}};
mod term;
use tauri::{menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem}, tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}, webview::{Cookie, NewWindowResponse, PageLoadEvent}, AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

// wry's defaults (mini menu and SmartScreen off); setting our own args replaces them, so they are repeated here.
// Resolver lock: page-side names never resolve, so even a blocked navigation can't open a connection first (M5b test: it did,
// to example.com, in 2 of 4 runs). The WebView2 runtime's own accepted Microsoft connection is not affected.
const ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --host-resolver-rules=\"MAP * ~NOTFOUND , EXCLUDE 127.0.0.1\"";

// Tracker folder (launch.key, tracker.js) and port. NEXUS_APP_TRACKER / NEXUS_APP_PORT exist for dev tests on spare ports.
fn config() -> Result<(PathBuf, u16), String> {
    let home = PathBuf::from(std::env::var_os("USERPROFILE").ok_or("USERPROFILE is not set")?);
    let dir = std::env::var_os("NEXUS_APP_TRACKER").map(PathBuf::from).or_else(|| std::env::current_exe().ok()?.parent().map(|d| d.join("tracker")).filter(|d| d.join("tracker.js").is_file())).unwrap_or_else(|| home.join(".claude").join("token-tracker"));
    let port = std::env::var("NEXUS_APP_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(7788u16);
    let dir = dir.canonicalize().map_err(|_| format!("NEXUS tracker folder not found: {}", dir.display()))?;
    // per-user: the tracker (and the data it keeps beside it) must be this Windows user's own
    if !dir.starts_with(home.canonicalize().map_err(|e| e.to_string())?) { return Err("The NEXUS tracker folder is outside your user profile, so it is not used.".into()) }
    Ok((dir, port))
}

enum Http { Refused, Busy, Answer(u16, String) }
// One GET on loopback: 0.5 s to connect, 3 s to answer. Refused = nothing listens; no answer in time = Busy.
fn get(port: u16, path: &str, token: Option<&str>) -> Http { http(port, path, token, None) }
// M5c: a POST (tray Pause / Resume monitoring) carries the page's own Origin, as the tracker's local.js guard requires
fn http(port: u16, path: &str, token: Option<&str>, post: Option<&str>) -> Http {
    let mut s = match TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(500)) {
        Ok(s) => s, Err(e) if e.kind() == ErrorKind::ConnectionRefused => return Http::Refused, Err(_) => return Http::Busy };
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    let t = token.map(|t| format!("x-nexus-token: {t}\r\n")).unwrap_or_default();
    let (m, b) = match post { Some(b) => ("POST", format!("Origin: http://127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{b}", b.len())), None => ("GET", "\r\n".into()) };
    if write!(s, "{m} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{t}Connection: close\r\n{b}").is_err() { return Http::Busy }
    let mut b = Vec::new();
    let _ = (&s).take(8192).read_to_end(&mut b);
    let r = String::from_utf8_lossy(&b);
    match r.get(9..12).and_then(|c| c.parse().ok()) { Some(c) => Http::Answer(c, r.split_once("\r\n\r\n").map(|x| x.1.to_string()).unwrap_or_default()), None => Http::Busy }
}

// B61: HMAC-SHA256(token, "nexus-prove\0" + port + "\0" + nonce), as launch.js prove(). The token is 64 hex = one SHA-256 block.
fn mac(token: &str, port: u16, n: &str) -> String {
    let mut k = [0u8; 64];
    if token.len() > 64 { k[..32].copy_from_slice(&Sha256::digest(token.as_bytes())) } else { k[..token.len()].copy_from_slice(token.as_bytes()) }
    let pad = |x: u8| k.iter().map(|b| b ^ x).collect::<Vec<u8>>();
    let inner = Sha256::new().chain_update(pad(0x36)).chain_update(format!("nexus-prove\0{port}\0{n}")).finalize();
    Sha256::new().chain_update(pad(0x5c)).chain_update(inner).finalize().iter().map(|b| format!("{b:02x}")).collect()
}
fn same(a: &str, b: &str) -> bool { a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0 } // constant time

// Who owns the listener: read-only Win32 calls, every handle closed at once, no admin rights.
mod win {
    use windows_sys::Win32::{Foundation::{CloseHandle, HANDLE}, NetworkManagement::IpHelper::{GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER},
        Security::{GetLengthSid, GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER}, System::Threading::{GetCurrentProcess, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION}};
    // PID of the IPv4 listener on 127.0.0.1:port (or 0.0.0.0:port)
    pub fn listener(port: u16) -> Option<u32> { unsafe {
        let mut n = 0u32;
        GetExtendedTcpTable(std::ptr::null_mut(), &mut n, 0, 2, TCP_TABLE_OWNER_PID_LISTENER, 0);
        let mut b = vec![0u64; n as usize / 8 + 512]; // u64 = aligned; 4 KB headroom in case the table grows between the calls
        n = (b.len() * 8) as u32;
        if GetExtendedTcpTable(b.as_mut_ptr().cast(), &mut n, 0, 2, TCP_TABLE_OWNER_PID_LISTENER, 0) != 0 { return None }
        let t = &*(b.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
        let max = (b.len() * 8 - 4) / std::mem::size_of::<MIB_TCPROW_OWNER_PID>();
        std::slice::from_raw_parts(t.table.as_ptr(), (t.dwNumEntries as usize).min(max)).iter()
            .filter(|r| u16::from_be(r.dwLocalPort as u16) == port && (r.dwLocalAddr == u32::from_ne_bytes([127, 0, 0, 1]) || r.dwLocalAddr == 0))
            .max_by_key(|r| r.dwLocalAddr != 0).map(|r| r.dwOwningPid)
    } }
    unsafe fn sid(p: HANDLE) -> Option<Vec<u8>> {
        let mut t: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(p, TOKEN_QUERY, &mut t) == 0 { return None }
        let mut n = 0u32;
        GetTokenInformation(t, TokenUser, std::ptr::null_mut(), 0, &mut n);
        let mut b = vec![0u64; n as usize / 8 + 1];
        let ok = GetTokenInformation(t, TokenUser, b.as_mut_ptr().cast(), (b.len() * 8) as u32, &mut n) != 0;
        CloseHandle(t);
        if !ok { return None }
        let s = (*(b.as_ptr() as *const TOKEN_USER)).User.Sid;
        Some(std::slice::from_raw_parts(s as *const u8, GetLengthSid(s) as usize).to_vec())
    }
    // (exe file name, same Windows user as this app); None = cannot be inspected (another user, or elevated)
    pub fn owner(pid: u32) -> Option<(String, bool)> { unsafe {
        let p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if p.is_null() { return None }
        let mut w = [0u16; 1024];
        let mut n = w.len() as u32;
        let exe = if QueryFullProcessImageNameW(p, 0, w.as_mut_ptr(), &mut n) != 0 { String::from_utf16_lossy(&w[..n as usize]) } else { String::new() };
        let theirs = sid(p);
        CloseHandle(p);
        Some((exe.rsplit('\\').next().unwrap_or("").to_string(), theirs? == sid(GetCurrentProcess())?)) // pseudo handle: nothing to close
    } }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum St { NotRunning, Starting, Busy, Ready, Crashed, Locked, OtherUser, Foreign }
struct Det { st: St, token: String, why: &'static str, exe: String, pid: u32, owner: &'static str }

// Classify the port. Nothing secret is sent before the last step, and only to a proven tracker.
fn detect(dir: &PathBuf, port: u16) -> Det {
    let mut d = Det { st: St::NotRunning, token: String::new(), why: "", exe: String::new(), pid: 0, owner: "" };
    let Some(pid) = win::listener(port) else { return d };
    d.pid = pid;
    let own = win::owner(pid);
    #[cfg(feature = "m5a-test")] // test build only: pretend the listener belongs to another Windows user
    let own = if std::env::var_os("NEXUS_APP_OTHER_USER").is_some() { own.map(|(e, _)| (e, false)) } else { own };
    match own {
        None => { d.st = St::OtherUser; d.owner = "uninspectable"; return d }
        Some((e, mine)) => { d.exe = e; d.owner = if mine { "same" } else { "other" }; if !mine { d.st = St::OtherUser; return d } }
    }
    if !d.exe.eq_ignore_ascii_case("node.exe") { d.st = St::Foreign; return d }
    let mut n = [0u8; 32];
    if getrandom::fill(&mut n).is_err() { d.st = St::Locked; d.why = "rng"; return d }
    let n: String = n.iter().map(|b| format!("{b:02x}")).collect();
    let k = key(dir);
    d.st = match get(port, &format!("/api/prove?n={n}"), None) {
        Http::Refused => St::NotRunning,
        Http::Busy | Http::Answer(429, _) => St::Busy,
        Http::Answer(401 | 404, _) => { d.why = "noprove"; St::Locked } // an older tracker without /api/prove, or another node program
        Http::Answer(200, b) => match b.split("\"mac\":\"").nth(1).and_then(|m| m.get(..64)) {
            None => St::Foreign,
            Some(_) if k.is_empty() => { d.why = "key"; St::Locked }
            Some(m) if !same(m, &mac(&k, port, &n)) => { d.why = "mac"; St::Locked }
            Some(_) => match get(port, "/api/settings", Some(&k)) { // proven: now the token may be used
                Http::Answer(200, _) => { d.token = k; St::Ready }
                Http::Answer(_, _) => { d.why = "settings"; St::Locked }
                Http::Refused => St::NotRunning,
                Http::Busy => St::Busy,
            },
        },
        Http::Answer(_, _) => St::Foreign,
    };
    d
}

// Node by absolute path, never by PATH (user-writable PATH folders or the app's own folder could hold another node.exe).
// Program Files comes from HKLM, which only administrators can change; the official installer puts node.exe there.
fn node() -> Result<PathBuf, String> {
    let pf: String = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion")
        .and_then(|k| k.get_value("ProgramFilesDir")).map_err(|_| "Program Files folder not found in the registry.".to_string())?;
    #[cfg(feature = "m5a-test")] // test build only: a fake Program Files to check the Node-missing error
    let pf = std::env::var("NEXUS_APP_PF").unwrap_or(pf);
    let n = PathBuf::from(pf).join("nodejs").join("node.exe");
    if n.is_file() { return Ok(n) }
    // else the private copy Setup installs next to this exe (runtime\node, setup/src/req.rs): same folder, same trust as nexus-app.exe itself
    let p = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("runtime").join("node").join("node.exe")));
    match p { Some(p) if p.is_file() => Ok(p), _ => Err(format!("Node.js was not found at {}, so the NEXUS tracker could not be started. Install Node.js (LTS) from nodejs.org, or use Install now in NEXUS Setup.", n.display())) }
}

fn key(dir: &PathBuf) -> String { std::fs::read_to_string(dir.join("launch.key")).map(|k| k.trim().to_string()).unwrap_or_default() }

// startup.log in the app's data folder: one JSON line per start, the last 50. Phase names, times (ms), states, the listener's
// exe name and same / other user. Never a token, launch code, cookie, path or SID.
struct Log { t0: Instant, ev: Vec<(String, u128)>, exe: String, owner: &'static str, detect_ms: u128, done: bool }
impl Log {
    fn mark(&mut self, e: &str) { self.ev.push((e.into(), self.t0.elapsed().as_millis())) }
    fn save(&mut self, port: u16, result: &str) {
        if self.done { return }
        self.done = true;
        append(serde_json::json!({ "at": now_s(), "build": if cfg!(feature = "m5a-test") { "test" } else { "normal" }, "id": env!("NEXUS_ID"), "port": port, "result": result,
            "events": self.ev, "listener": self.exe, "owner": self.owner, "maxDetectMs": self.detect_ms }));
    }
}
pub(crate) fn now_s() -> u64 { SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|t| t.as_secs()).unwrap_or(0) }
fn app_dir() -> Option<PathBuf> { std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("local.nexus.m5a")) }
pub(crate) fn append(line: serde_json::Value) {
    let Some(d) = app_dir() else { return };
    let (f, line) = (d.join("startup.log"), line.to_string());
    let old = std::fs::read_to_string(&f).unwrap_or_default();
    let mut l: Vec<&str> = old.lines().collect();
    l.push(&line);
    let _ = std::fs::create_dir_all(&d);
    let _ = std::fs::write(&f, l[l.len().saturating_sub(50)..].join("\n") + "\n");
}

// P2a files in the tracker folder (tracker-dev recover.js). maintenance.lock: Some((valid, reason)); unreadable = valid 15 min from its write time.
fn lock(dir: &PathBuf) -> Option<(bool, String)> {
    let f = dir.join("maintenance.lock");
    let t = std::fs::read_to_string(&f).ok()?;
    let ms = |v: &serde_json::Value| v.as_f64().unwrap_or(0.0);
    let now = SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|t| t.as_millis() as f64).unwrap_or(0.0);
    match serde_json::from_str::<serde_json::Value>(&t) {
        Ok(j) => Some((now < ms(&j["until"]).min(ms(&j["at"]) + 9e5), j["reason"].as_str().or(j["by"].as_str()).unwrap_or("maintenance").chars().take(80).collect())),
        Err(_) => Some((std::fs::metadata(&f).and_then(|m| m.modified()).ok().and_then(|m| m.elapsed().ok()).is_some_and(|e| e.as_secs() < 900), "maintenance".into())),
    }
}
// the tracker's own crash-loop gate: more than 3 unexpected stops (crashes.json, ms) in 10 min
fn paused(dir: &PathBuf) -> bool {
    let now = SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|t| t.as_millis() as f64).unwrap_or(0.0);
    std::fs::read_to_string(dir.join("crashes.json")).ok().and_then(|t| serde_json::from_str::<Vec<f64>>(&t).ok())
        .is_some_and(|c| c.iter().filter(|&&t| t > now - 6e5).count() > 3)
}

// P3: the port serve bound (port.txt, written only on a fallback) is a hint: used only when detect() there says Ready or Busy
fn hint(dir: &PathBuf) -> Option<u16> { std::fs::read_to_string(dir.join("port.txt")).ok()?.split("\"port\":").nth(1)?.split(|c: char| !c.is_ascii_digit()).next()?.parse().ok() }
fn find(dir: &PathBuf, base: u16) -> (u16, Det) {
    if let Some(h) = hint(dir).filter(|&h| h != base) { let d = detect(dir, h); if matches!(d.st, St::Ready | St::Busy) { return (h, d) } }
    (base, detect(dir, base))
}

fn status(w: &WebviewWindow, m: &str, s: u64) { let _ = w.eval(format!("window.nexusStatus && window.nexusStatus({}, {s})", serde_json::to_string(m).unwrap_or_default())); }

// Attach, or start `node tracker.js serve` detached (only when nothing listens, at most once) and wait for it. Ok(token) once
// detect() says Ready. Starting ≤ 20 s, Busy ≤ 60 s in total; Locked / OtherUser / Foreign fail closed after a 1 s re-check.
// `manual`: a user start (Try again) passes `serve --manual` past the tracker's crash-loop gate; a valid maintenance lock still blocks it.
// P3: Ok also returns the port the tracker is on (port.txt hint or `base`); another program on `base` gets one serve start too (it takes the fallback).
fn connect(w: &WebviewWindow, dir: &PathBuf, base: u16, log: &Mutex<Log>, manual: bool) -> Result<(String, u16), (St, String)> {
    let t0 = Instant::now();
    let mut child: Option<Child> = None;
    let (mut last, mut bad_since, mut wait) = (None, None::<Instant>, 250u64);
    loop {
        let t = Instant::now();
        let (port, mut d) = find(dir, base);
        let other = matches!(d.st, St::OtherUser | St::Foreign | St::Locked); // if that start ends without a tracker of ours, this reason stands (fails closed as before)
        if d.st == St::NotRunning || other {
            match child.as_mut() {
                None => {
                    log.lock().unwrap().mark("NotRunning");
                    // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP: no console, and closing the app leaves the tracker running
                    child = Some(Command::new(node().map_err(|e| (St::NotRunning, e))?).args(if manual { &["tracker.js", "serve", "--manual"][..] } else { &["tracker.js", "serve"][..] }).current_dir(dir)
                        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
                        .creation_flags(0x0000_0008 | 0x0000_0200).spawn()
                        .map_err(|_| (St::NotRunning, "Node.js could not be started, so the NEXUS tracker is not running.".to_string()))?);
                    log.lock().unwrap().mark("spawn");
                    d.st = St::Starting;
                }
                Some(c) => if !matches!(c.try_wait(), Ok(Some(_))) { d.st = St::Starting } else if !other { d.st = if win::listener(port).is_none() { St::Crashed } else { St::Starting } },
            }
        }
        {
            let mut l = log.lock().unwrap();
            l.detect_ms = l.detect_ms.max(t.elapsed().as_millis());
            if d.exe.len() > 0 { l.exe = d.exe.clone(); l.owner = d.owner }
            if last != Some(d.st) { let e = format!("{:?}{}", d.st, if d.why.is_empty() { String::new() } else { format!(":{}", d.why) }); l.mark(&e); last = Some(d.st) }
        }
        let s = t0.elapsed().as_secs();
        let fail = |m: String| Err((d.st, m));
        match d.st {
            St::Ready => return Ok((d.token, port)),
            St::Crashed if paused(dir) => return fail("The NEXUS tracker stopped unexpectedly more than 3 times in 10 minutes, so automatic starts are paused. See guard.log, then Try again.".into()),
            St::Crashed if lock(dir).is_some_and(|l| l.0) => return fail(format!("NEXUS is being updated ({}): try again in a few minutes.", lock(dir).map(|l| l.1).unwrap_or_default())),
            St::Crashed => return fail("The NEXUS tracker stopped while starting: see guard.log in the tracker folder, or try start.cmd.".into()),
            St::Starting if s >= 20 => return fail("The NEXUS tracker did not start within 20 s: see guard.log in the tracker folder, or try start.cmd.".into()),
            St::Busy if s >= 60 => return fail("The NEXUS tracker is still busy after 60 s: close and reopen NEXUS.".into()),
            St::Starting => status(w, "Starting the NEXUS tracker…", s),
            St::Busy => status(w, "The NEXUS tracker is busy (first scan of new logs)…", s),
            St::Locked | St::OtherUser | St::Foreign => {
                let since = *bad_since.get_or_insert(Instant::now());
                if since.elapsed() >= Duration::from_secs(1) { return fail(why(&d, port)) }
            }
            _ => {}
        }
        if !matches!(d.st, St::Locked | St::OtherUser | St::Foreign) { bad_since = None }
        thread::sleep(Duration::from_millis(wait));
        wait = (wait * 3 / 2).min(1000);
    }
}

fn why(d: &Det, port: u16) -> String {
    match (d.st, d.why) {
        (St::OtherUser, _) => format!("Another Windows user's program (or one this user cannot inspect) is using port {port}, so your NEXUS key was not sent."),
        (St::Foreign, _) if d.exe.is_empty() || d.exe.eq_ignore_ascii_case("node.exe") => format!("Port {port} is used by another program (PID {}), not your NEXUS tracker, so your NEXUS key was not sent.", d.pid),
        (St::Foreign, _) => format!("Port {port} is used by {} (PID {}), not your NEXUS tracker, so your NEXUS key was not sent.", d.exe, d.pid),
        (_, "noprove") => format!("The program on port {port} did not prove it is your NEXUS tracker (an older tracker without /api/prove, or another program), so your NEXUS key was not sent. Update or restart the tracker."),
        (_, "key") => "launch.key could not be read, so NEXUS cannot sign in: restart the tracker.".into(),
        _ => format!("NEXUS key mismatch: the tracker on port {port} does not hold your launch.key, so your key was not sent. Restart the tracker."),
    }
}

fn sign_in(w: &WebviewWindow, port: u16, token: &str) -> tauri::Result<()> {
    w.set_cookie(Cookie::parse(format!("nexus{port}={token}; HttpOnly; SameSite=Strict; Path=/; Domain=127.0.0.1")).expect("cookie"))
}

fn fail(w: &WebviewWindow, m: &str) { let _ = w.eval(format!("window.nexusError({})", serde_json::to_string(m).unwrap_or_default())); }

// Small notice on the tracker page (text only, click to close); empty text removes it; hide_s > 0 removes it after that many seconds.
fn banner(m: &str, hide_s: u64) -> String {
    format!("(() => {{ const m = {}; let b = document.getElementById('nexus-app-banner'); if (!m) {{ b && b.remove(); return }} if (!b) {{ b = document.createElement('div'); b.id = 'nexus-app-banner'; b.title = 'Click to close'; \
        b.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;max-width:min(720px,90vw);background:#0c1a12;color:#cfe9d8;border:1px solid #2bd67b;border-radius:8px;padding:8px 14px;font:13px/1.4 Segoe UI,sans-serif;box-shadow:0 4px 18px #0008;cursor:pointer'; \
        b.onclick = () => b.remove(); document.body.appendChild(b) }} b.textContent = m; {} }})()", serde_json::to_string(m).unwrap_or_default(), if hide_s > 0 { format!("setTimeout(() => b.remove(), {hide_s}000);") } else { String::new() })
}

// P2b crash recovery (spec §26.9 rev 3, A1-A3), all on the one watchdog thread: the same 5 s detect() as before, no new timer.
enum Ui { Retry, Log }
struct Sup { w: WebviewWindow, dir: PathBuf, port: u16, base: u16, cur: Arc<AtomicU16>, log: Arc<Mutex<Log>>, rx: mpsc::Receiver<Ui>, manual: Arc<AtomicBool>, splash_js: Arc<Mutex<String>>, banner: Arc<Mutex<String>>, tries: Vec<Instant> }
impl Sup {
    // connect() and follow the tracker to its port: the old port's cookie is dropped, the navigation lock moves with it
    fn conn(&mut self, manual: bool) -> Result<String, (St, String)> {
        let (t, p) = connect(&self.w, &self.dir, self.base, &self.log, manual)?;
        if p != self.port { let _ = self.w.delete_cookie(Cookie::parse(format!("nexus{}=x; Path=/; Domain=127.0.0.1", self.port)).expect("cookie")); self.port = p; self.cur.store(p, SeqCst) }
        Ok(t)
    }
    // run js on the bundled splash, loading it first if the tracker page is shown (on_page_load re-applies the last js)
    fn splash(&self, js: String) {
        *self.splash_js.lock().unwrap() = js.clone();
        if self.w.url().ok().and_then(|u| u.host_str().map(|h| h == "tauri.localhost")) == Some(true) { let _ = self.w.eval(js); }
        else { let _ = self.w.navigate(Url::parse("http://tauri.localhost/index.html").expect("url")); }
    }
    fn say(&self, m: &str, s: u64) { self.splash(format!("window.nexusStatus({}, {s})", serde_json::to_string(m).unwrap_or_default())) }
    fn rec(&self, trigger: &str, attempt: usize, result: &str, t0: Instant, lk: &str) {
        append(serde_json::json!({ "at": now_s(), "kind": "recovery", "port": self.port, "trigger": trigger, "lock": lk, "attempt": attempt, "result": result, "ms": t0.elapsed().as_millis() as u64 }));
    }
    fn lk(&self) -> &'static str { match lock(&self.dir) { None => "none", Some((true, _)) => "valid", _ => "stale" } }

    // Signed in: watch the tracker. Returns a token once a restart (or the user's Try again) brought a proven tracker back.
    fn watch(&mut self, mut token: String) -> String {
        let (mut refused, mut bad, mut busy, mut away) = (0, 0, None::<Instant>, false);
        let (mut ti, mut tw) = (Instant::now(), SystemTime::now());
        loop {
            thread::sleep(Duration::from_secs(5));
            // wake guard: a long gap between ticks = sleep / hibernate, never counted; 10 s grace for the tracker's own timers to resume
            let gap = ti.elapsed().max(tw.elapsed().unwrap_or_default());
            if gap > Duration::from_secs(15) { (refused, bad, busy) = (0, 0, None); thread::sleep(Duration::from_secs(10)); (ti, tw) = (Instant::now(), SystemTime::now()); continue }
            (ti, tw) = (Instant::now(), SystemTime::now());
            let d = detect(&self.dir, self.port);
            if d.st != St::NotRunning { refused = 0 }
            if !matches!(d.st, St::Locked | St::OtherUser | St::Foreign) { bad = 0 }
            if d.st != St::Busy && busy.take().is_some_and(|b| b.elapsed() >= Duration::from_secs(60)) { let _ = self.w.eval(banner("", 0)); }
            match d.st {
                // back after one refused probe (restarted by someone else): the caller signs in and reopens the page
                St::Ready if away => return d.token,
                // tracker restarted by someone else (new token): sign in again once it proves itself, and reload
                St::Ready => if d.token != token && sign_in(&self.w, self.port, &d.token).is_ok() { token = d.token; let _ = self.w.eval("location.reload()"); },
                // busy is never a crash: a notice after 60 s, no restart
                St::Busy if away => self.say("The NEXUS tracker is busy or not responding. Waiting (it is not restarted)…", 0),
                St::Busy => if busy.get_or_insert_with(Instant::now).elapsed() >= Duration::from_secs(60) { let _ = self.w.eval(banner("NEXUS tracker not responding (busy for over a minute). It is not restarted; close it by hand if it stays like this.", 0)); },
                St::NotRunning => {
                    refused += 1;
                    // first refused probe: leave the tracker page (and drop its cookie) so nothing that takes the port next is sent the key
                    if refused == 1 {
                        away = true;
                        let _ = self.w.delete_cookie(Cookie::parse(format!("nexus{}=x; Path=/; Domain=127.0.0.1", self.port)).expect("cookie"));
                        self.say("Lost the connection to the NEXUS tracker, checking…", 0);
                    } else { return self.recover() }
                }
                _ => { bad += 1; if bad >= 2 { let _ = self.w.delete_cookie(Cookie::parse(format!("nexus{}=x; Path=/; Domain=127.0.0.1", self.port)).expect("cookie")); return if away { self.recover() } else { self.manual(&why(&d, self.port)) } } } // P3: our tracker gone and another program on its port → restart (serve takes the per-user port), never a key to that program
            }
        }
    }

    // Crash confirmed (2 refused probes, no listener of any owner): restart within the app budget (3 in 10 min, backoff 5 / 30 / 120 s).
    // The tracker's own gate (crashes.json, maintenance.lock) stays the hard limit; spawning and the B61 proof are connect()'s.
    fn recover(&mut self) -> String {
        let t0 = Instant::now();
        #[cfg(feature = "m5a-test")] // test build only: shorter backoff for the harness
        let back: Vec<u64> = std::env::var("NEXUS_APP_BACKOFF").ok().map(|v| v.split(',').filter_map(|x| x.parse().ok()).collect()).filter(|v: &Vec<u64>| v.len() == 3).unwrap_or(vec![5, 30, 120]);
        #[cfg(not(feature = "m5a-test"))]
        let back = [5u64, 30, 120];
        loop {
            if let Some((true, r)) = lock(&self.dir) { // deploy / maintenance: wait, it starts the tracker itself
                self.say(&format!("NEXUS is being updated ({r})…"), 0);
                thread::sleep(Duration::from_secs(2));
                let d = detect(&self.dir, self.port);
                if d.st == St::Ready { self.rec("lock", 0, "ready", t0, "valid"); return d.token }
                continue
            }
            self.tries.retain(|t| t.elapsed() < Duration::from_secs(600));
            let n = self.tries.len();
            if n >= 3 { self.rec("refused", n, "manual:budget", t0, self.lk()); return self.manual("The NEXUS tracker stopped unexpectedly 3 times in 10 minutes, so NEXUS stopped restarting it. See guard.log, then Try again.") }
            let w0 = Instant::now();
            while w0.elapsed() < Duration::from_secs(back[n]) && win::listener(self.port).is_none() {
                self.say(&format!("The NEXUS tracker stopped unexpectedly. Restarting (attempt {} of 3) in {} s…", n + 1, back[n].saturating_sub(w0.elapsed().as_secs())), 0);
                thread::sleep(Duration::from_millis(500));
            }
            if lock(&self.dir).is_some_and(|l| l.0) { continue }
            self.tries.push(Instant::now());
            let lk = self.lk();
            match self.conn(false) {
                Ok(t) => {
                    self.rec("refused", n + 1, "ready", t0, lk);
                    *self.banner.lock().unwrap() = format!("Tracker restarted after an unexpected stop (attempt {} of 3, {} s). Interrupted automation runs are listed on the Automation page.", n + 1, t0.elapsed().as_secs());
                    return t
                }
                Err((st, e)) => {
                    self.rec("refused", n + 1, &format!("error:{st:?}"), t0, lk);
                    if matches!(st, St::Locked | St::OtherUser | St::Foreign) || paused(&self.dir) { return self.manual(&e) }
                }
            }
        }
    }

    // Manual recovery (M5c: the window comes out of the tray, it needs the user): the bundled splash shows the reason, Try again (one `serve --manual` start; a valid lock still blocks) and Open guard.log.
    fn manual(&mut self, m: &str) -> String {
        while self.rx.try_recv().is_ok() {} // clicks left from an earlier splash
        let show = |s: &Self, m: &str| { s.manual.store(true, SeqCst); open(&s.w); s.splash(format!("window.nexusManual({})", serde_json::to_string(m).unwrap_or_default())) };
        show(self, m);
        loop {
            match self.rx.recv() {
                Ok(Ui::Log) => { let _ = Command::new(PathBuf::from(std::env::var_os("SystemRoot").unwrap_or("C:\\Windows".into())).join("explorer.exe")).arg(format!("/select,{}", self.dir.join("guard.log").display())).spawn(); }
                Ok(Ui::Retry) => {
                    let t0 = Instant::now();
                    if let Some((true, r)) = lock(&self.dir) { show(self, &format!("NEXUS is being updated ({r}): try again in a few minutes.")); continue }
                    self.manual.store(false, SeqCst);
                    self.say("Starting the NEXUS tracker…", 0);
                    match self.conn(true) {
                        Ok(t) => { self.rec("manual", 0, "ready", t0, self.lk()); return t }
                        Err((st, e)) => { self.rec("manual", 0, &format!("error:{st:?}"), t0, self.lk()); show(self, &e) }
                    }
                }
                Err(_) => loop { thread::park() }, // app closing
            }
        }
    }
}

// M5c tray + close (spec §26.9). app.json beside startup.log: {closeToTray (default true), notified}. No secrets.
fn prefs() -> serde_json::Value { app_dir().and_then(|d| std::fs::read_to_string(d.join("app.json")).ok()).and_then(|t| serde_json::from_str(&t).ok()).filter(|v: &serde_json::Value| v.is_object()).unwrap_or(serde_json::json!({})) }
fn set_pref(k: &str, v: bool) { let mut p = prefs(); p[k] = v.into(); if let Some(d) = app_dir() { let _ = std::fs::create_dir_all(&d); let _ = std::fs::write(d.join("app.json"), p.to_string()); } }
fn close_to_tray() -> bool { prefs()["closeToTray"].as_bool().unwrap_or(true) }

// Start with Windows: per-user Run value, written only when the user ticks it (default absent). Starts in the tray (--hidden).
const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
fn run_name() -> String {
    #[cfg(feature = "m5a-test")] // test build only: its own value name, so the real "NEXUS" value is never touched
    if let Ok(n) = std::env::var("NEXUS_APP_RUNVAL") { return n }
    "NEXUS".into()
}
fn autostart() -> bool { winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER).open_subkey(RUN).and_then(|k| k.get_value::<String, _>(run_name())).is_ok() }
fn set_autostart(on: bool) -> std::io::Result<()> {
    let (k, _) = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER).create_subkey(RUN)?;
    if on { k.set_value(run_name(), &format!("\"{}\" --hidden", std::env::current_exe()?.display())) } else { k.delete_value(run_name()) }
}

// M4d monitoring pause state, read from the tracker's own file (<NEXUS_DATA or tracker folder>/sys-paused.json) so no request starts its process scan
fn sys_paused(dir: &PathBuf) -> bool {
    let d = std::env::var_os("NEXUS_DATA").map(PathBuf::from).unwrap_or(dir.clone());
    std::fs::read_to_string(d.join("sys-paused.json")).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()).is_some_and(|j| !j["at"].is_null())
}

// Hidden: WebView2 not visible (page visibilityState = hidden, its drawing stops) and memory target Low; shown: back to Normal. No reload.
// Runtimes without ICoreWebView2_19 just skip the memory level.
fn webview(w: &WebviewWindow, on: bool) {
    let _ = w.with_webview(move |v| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use windows_core::Interface;
        let c = v.controller();
        let _ = c.SetIsVisible(on);
        if let Ok(c) = c.CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_19>()) { let _ = c.SetMemoryUsageTargetLevel(if on { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW }); }
    });
}
fn open(w: &WebviewWindow) { webview(w, true); let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus(); }
fn hide(w: &WebviewWindow) {
    let _ = w.hide();
    webview(w, false);
    if !prefs()["notified"].as_bool().unwrap_or(false) { // first hide only
        set_pref("notified", true);
        #[cfg(feature = "m5a-test")]
        if std::env::var_os("NEXUS_APP_NOBOX").is_some() { return }
        // ponytail: a one-time message box, as tray-icon 0.25 has no balloon API; a real tray balloon if users want one
        thread::spawn(|| unsafe { use windows_sys::Win32::UI::WindowsAndMessaging::*;
            let w = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
            MessageBoxW(std::ptr::null_mut(), w("NEXUS is still running in the system tray, and the tracker keeps working.\n\nClick the tray icon to open it again. To make the close button quit instead, untick \"Close button: hide to tray\" in the tray menu.").as_ptr(), w("NEXUS").as_ptr(), MB_OK | MB_ICONINFORMATION | MB_SETFOREGROUND | MB_TOPMOST);
        });
    }
}

struct Tray { pause: MenuItem<tauri::Wry>, close: CheckMenuItem<tauri::Wry>, auto: CheckMenuItem<tauri::Wry>, dir: Option<PathBuf>, cur: Arc<AtomicU16> }
fn label(t: &Tray) { if let Some(d) = &t.dir { let _ = t.pause.set_text(if sys_paused(d) { "Resume monitoring" } else { "Pause monitoring" }); } }
fn menu(app: &AppHandle, id: &str) {
    let t = app.state::<Tray>();
    match id {
        "open" => if let Some(w) = app.get_webview_window("main") { open(&w) },
        // System Health monitoring only (M4d, idempotent); the token goes only to a tracker that proves itself (detect)
        "pause" => if let Some(dir) = t.dir.clone() {
            let (port, app) = (t.cur.load(SeqCst), app.clone());
            thread::spawn(move || {
                let d = detect(&dir, port);
                if d.st == St::Ready { let _ = http(port, "/api/sys", Some(&d.token), Some(if sys_paused(&dir) { r#"{"op":"resume"}"# } else { r#"{"op":"pause"}"# })); }
                label(&app.state::<Tray>());
            });
        },
        "close" => set_pref("closeToTray", t.close.is_checked().unwrap_or(true)),
        "auto" => { let on = t.auto.is_checked().unwrap_or(false); if set_autostart(on).is_err() || autostart() != on { let _ = t.auto.set_checked(autostart()); } }
        "quit" => app.exit(0), // the app only: the tracker keeps running
        _ => {}
    }
}

fn main() {
    let log =Arc::new(Mutex::new(Log { t0: Instant::now(), ev: vec![], exe: String::new(), owner: "", detect_ms: 0, done: false }));
    for (k, _) in std::env::vars_os() {
        let k8 = k.to_string_lossy().to_uppercase();
        if k8.starts_with("WEBVIEW2_") || k8 == "NEXUS_TOKEN" { std::env::remove_var(k) } // NEXUS_TOKEN would stop the tracker writing launch.key
    }
    #[cfg(feature = "m5a-test")]
    let args = format!("{ARGS} --remote-debugging-port=9335 {}", std::env::var("NEXUS_M5A_ARGS").unwrap_or_default()); // test build: extra flags to try
    #[cfg(not(feature = "m5a-test"))]
    let args = ARGS.to_string();
    let cfg = config();
    let port = cfg.as_ref().map(|c| c.1).unwrap_or(7788);
    let (log2, log3) = (log.clone(), log.clone());
    let (tx, rx) = mpsc::channel::<Ui>();
    let tx = Mutex::new(tx);
    let (man, sj, bn) = (Arc::new(AtomicBool::new(false)), Arc::new(Mutex::new(String::new())), Arc::new(Mutex::new(String::new())));
    let (man2, sj2, bn2) = (man.clone(), sj.clone(), bn.clone());
    let cur = Arc::new(AtomicU16::new(port)); let (cur2, cur3, cur4, cur5) = (cur.clone(), cur.clone(), cur.clone(), cur.clone());
    let hidden = std::env::args().any(|a| a == "--hidden"); // M5c: Start with Windows opens in the tray // P3: the tracker's current port
    tauri::Builder::default()
        .manage(term::Terms::new(cur5))
        .invoke_handler(tauri::generate_handler![term::term])
        .plugin(tauri_plugin_single_instance::init(|app, _, _| { // second start: bring the open window forward instead
            if let Some(w) = app.get_webview_window("main") { open(&w) } // M5c: also out of the tray
        }))
        .on_window_event(|win, e| if let WindowEvent::CloseRequested { api, .. } = e { // M5c: X hides to the tray unless the user unticked it
            if close_to_tray() { if let Some(w) = win.get_webview_window("main") { api.prevent_close(); hide(&w) } }
        })
        .setup(move |app| {
            log.lock().unwrap().mark("setup");
            let w = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("NEXUS").inner_size(1440.0, 900.0).min_inner_size(940.0, 480.0).visible(!hidden).additional_browser_args(&args)
                .on_navigation(move |u| {
                    // splash buttons: handled here and never loaded; acted on only while the manual splash is shown (the tracker page is not loaded then)
                    if u.host_str() == Some("tauri.localhost") && u.path().starts_with("/nexus-") {
                        if man.load(SeqCst) { let _ = tx.lock().unwrap().send(if u.path() == "/nexus-retry" { Ui::Retry } else { Ui::Log }); }
                        return false
                    }
                    (u.scheme() == "http" && u.host_str() == Some("127.0.0.1") && u.port() == Some(cur.load(SeqCst))) || u.host_str() == Some("tauri.localhost")
                })
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .on_page_load(move |v, p| if p.event() == PageLoadEvent::Finished {
                    let port = cur2.load(SeqCst);
                    if p.url().port() == Some(port) && p.url().path() == "/preview" {
                        { let mut l = log2.lock().unwrap(); if !l.done { l.mark("page"); l.save(port, "ready") } }
                        let b = std::mem::take(&mut *bn.lock().unwrap());
                        if !b.is_empty() { let _ = v.eval(banner(&b, 30)); }
                    } else if p.url().host_str() == Some("tauri.localhost") { let j = sj.lock().unwrap().clone(); if !j.is_empty() { let _ = v.eval(j); } }
                })
                .build()?;
            log.lock().unwrap().mark("window");
            if hidden { webview(&w, false) }
            // M5c tray: one icon (single instance = one process). Left click opens; the menu label follows sys-paused.json when it opens.
            let item = |id: &str, s: &str| MenuItem::with_id(app, id, s, true, None::<&str>);
            let t = Tray { pause: item("pause", "Pause monitoring")?, close: CheckMenuItem::with_id(app, "close", "Close button: hide to tray", true, close_to_tray(), None::<&str>)?,
                auto: CheckMenuItem::with_id(app, "auto", "Start with Windows", true, autostart(), None::<&str>)?, dir: cfg.as_ref().ok().map(|c| c.0.clone()), cur: cur4 };
            label(&t);
            let m = Menu::with_items(app, &[&item("open", "Open NEXUS")?, &PredefinedMenuItem::separator(app)?, &t.pause, &t.close, &t.auto, &PredefinedMenuItem::separator(app)?, &item("quit", "Quit NEXUS")?])?;
            app.manage(t);
            let mut tb = TrayIconBuilder::with_id("nexus").tooltip("NEXUS").menu(&m).show_menu_on_left_click(false)
                .on_menu_event(|app, e| menu(app, e.id().as_ref()))
                .on_tray_icon_event(|ti, e| if let TrayIconEvent::Click { button, button_state, .. } = e { match (button, button_state) {
                    (MouseButton::Left, MouseButtonState::Up) => menu(ti.app_handle(), "open"),
                    (MouseButton::Right, MouseButtonState::Down) => label(&ti.app_handle().state::<Tray>()),
                    _ => {}
                } });
            if let Some(i) = app.default_window_icon() { tb = tb.icon(i.clone()) }
            tb.build(app)?;
            #[cfg(feature = "m5a-test")] // test build only: <app data>/m5c-cmd fires tray menu ids (a checkbox id toggles it first, as a click does); state goes to m5c-out
            { let h = app.handle().clone(); thread::spawn(move || { let Some(d) = app_dir() else { return }; loop {
                thread::sleep(Duration::from_millis(50));
                let Ok(c) = std::fs::read_to_string(d.join("m5c-cmd")) else { continue };
                let _ = std::fs::remove_file(d.join("m5c-cmd"));
                for id in c.split_whitespace() {
                    let t = h.state::<Tray>();
                    let b = match id { "close" => Some(&t.close), "auto" => Some(&t.auto), _ => None };
                    if let Some(b) = b { let _ = b.set_checked(!b.is_checked().unwrap_or(false)); }
                    if id == "x" { if let Some(w) = h.get_webview_window("main") { let _ = w.close(); } } else { menu(&h, id) }
                }
                thread::sleep(Duration::from_millis(400)); // the pause POST runs on its own thread
                let t = h.state::<Tray>();
                let _ = std::fs::write(d.join("m5c-out"), serde_json::json!({ "label": t.pause.text().unwrap_or_default(), "close": t.close.is_checked().unwrap_or(false), "auto": t.auto.is_checked().unwrap_or(false),
                    "visible": h.get_webview_window("main").and_then(|w| w.is_visible().ok()) }).to_string());
            } }); }
            thread::spawn(move || {
                let log = log3;
                let (dir, port) = match cfg { Ok(c) => c, Err(e) => { log.lock().unwrap().save(port, "error:Config"); return fail(&w, &e) } };
                let mut s = Sup { w, dir, port, base: port, cur: cur3, log, rx, manual: man2, splash_js: sj2, banner: bn2, tries: vec![] };
                let mut token = match s.conn(false) { Ok(t) => t, Err((st, e)) => { s.log.lock().unwrap().save(port, &format!("error:{st:?}")); s.manual(&e) } };
                loop {
                    status(&s.w, "Signing in…", 0);
                    if sign_in(&s.w, s.port, &token).is_err() { token = s.manual("NEXUS could not sign in to the tracker."); continue }
                    s.log.lock().unwrap().mark("cookie");
                    term::allow(s.w.app_handle(), s.port);
                    let _ = s.w.navigate(Url::parse(&format!("http://127.0.0.1:{}/preview", s.port)).expect("url"));
                    s.log.lock().unwrap().mark("navigate");
                    token = s.watch(token);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("NEXUS failed to start");
}
