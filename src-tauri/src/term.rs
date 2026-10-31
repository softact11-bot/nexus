// M5d embedded terminals (spec §26.9): Windows ConPTY straight from windows-sys (no new crate). The tracker's Claude Code page
// drives them through one Tauri command, `term`, allowed only for the main window at the exact http://127.0.0.1:<port> origin
// (runtime capability, re-checked in the command); output goes back by eval. Shells are fixed absolute paths picked by id,
// never a path or command line from the page. Every shell is in one kill-on-close Job Object: they end when NEXUS quits or
// crashes and keep running while it is hidden in the tray. Nothing typed or printed is logged.
use std::{collections::{HashMap, VecDeque}, fs::File, io::{Read, Write}, os::windows::io::FromRawHandle, path::PathBuf, sync::{atomic::{AtomicU16, Ordering::SeqCst}, Arc, Mutex, OnceLock}, thread, time::Duration};
use tauri::{AppHandle, Manager, WebviewWindow};
use windows_sys::Win32::{Foundation::{CloseHandle, HANDLE}, System::{Console::{ClosePseudoConsole, CreatePseudoConsole, ResizePseudoConsole, COORD, HPCON}, JobObjects::*, Pipes::CreatePipe, Threading::*}};

const MAX: usize = 8;
const KEEP: usize = 256 * 1024; // replay buffer per terminal (page reloads, the page opened later)

struct T { shell: &'static str, pc: HPCON, input: Mutex<File>, proc: usize, buf: Mutex<(VecDeque<u8>, u64)> } // (last KEEP bytes, total bytes)
unsafe impl Send for T {}
unsafe impl Sync for T {}
pub struct Terms { map: Mutex<HashMap<u32, Arc<T>>>, next: Mutex<u32>, pub cur: Arc<AtomicU16> }
impl Terms { pub fn new(cur: Arc<AtomicU16>) -> Self { Terms { map: Mutex::new(HashMap::new()), next: Mutex::new(1), cur } } }

fn pf() -> Option<PathBuf> {
    winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion").and_then(|k| k.get_value::<String, _>("ProgramFilesDir")).ok().map(PathBuf::from)
}
// (id, name, exe, args): detected shells, absolute paths from HKLM / SystemRoot only (never PATH)
fn shells() -> Vec<(&'static str, &'static str, PathBuf, &'static str)> {
    let sys = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or("C:\\Windows".into())).join("System32");
    let pf = pf();
    let wsl = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER).open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Lxss").map(|k| k.enum_keys().next().is_some()).unwrap_or(false);
    [("pwsh", "PowerShell 7", pf.as_ref().map(|p| p.join(r"PowerShell\7\pwsh.exe")), "-NoLogo"),
     ("powershell", "Windows PowerShell", Some(sys.join(r"WindowsPowerShell\v1.0\powershell.exe")), "-NoLogo"),
     ("cmd", "Command Prompt", Some(sys.join("cmd.exe")), ""),
     ("bash", "Git Bash", pf.as_ref().map(|p| p.join(r"Git\bin\bash.exe")), "--login -i"),
     ("wsl", "WSL", if wsl { Some(sys.join("wsl.exe")) } else { None }, "")]
        .into_iter().filter_map(|(i, n, p, a)| p.filter(|p| p.is_file()).map(|p| (i, n, p, a))).collect()
}

fn job() -> HANDLE {
    static J: OnceLock<usize> = OnceLock::new();
    *J.get_or_init(|| unsafe {
        let j = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        let mut i: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        i.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(j, JobObjectExtendedLimitInformation, (&i as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(), std::mem::size_of_val(&i) as u32);
        j as usize // never closed: the handle closes when this process ends, which ends every shell
    }) as HANDLE
}

fn w16(s: &str) -> Vec<u16> { s.encode_utf16().chain([0]).collect() }

// shell in a new pseudo console: (pseudo console, input pipe, output pipe, process handle)
unsafe fn spawn(exe: &PathBuf, args: &str, cwd: &PathBuf, cols: u16, rows: u16) -> Result<(HPCON, File, File, usize), String> {
    let (mut ir, mut iw, mut or, mut ow): (HANDLE, HANDLE, HANDLE, HANDLE) = (std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut());
    if CreatePipe(&mut ir, &mut iw, std::ptr::null(), 0) == 0 || CreatePipe(&mut or, &mut ow, std::ptr::null(), 1 << 16) == 0 { return Err("pipe".into()) }
    let mut pc: HPCON = 0;
    let hr = CreatePseudoConsole(COORD { X: cols as i16, Y: rows as i16 }, ir, ow, 0, &mut pc);
    CloseHandle(ir); CloseHandle(ow); // the pseudo console holds its own copies
    let (input, output) = (File::from_raw_handle(iw), File::from_raw_handle(or));
    if hr < 0 { return Err(format!("CreatePseudoConsole {hr:#x}")) }
    let mut n = 0usize;
    InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut n);
    let mut al = vec![0u64; n / 8 + 1];
    let mut si: STARTUPINFOEXW = std::mem::zeroed();
    si.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    si.StartupInfo.dwFlags = STARTF_USESTDHANDLES; // null std handles: else the shell gets this app's redirected ones (EOF) instead of the pseudo console
    si.lpAttributeList = al.as_mut_ptr().cast();
    if InitializeProcThreadAttributeList(si.lpAttributeList, 1, 0, &mut n) == 0
        || UpdateProcThreadAttribute(si.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize, pc as *const _, std::mem::size_of::<HPCON>(), std::ptr::null_mut(), std::ptr::null()) == 0 { ClosePseudoConsole(pc); return Err("attribute".into()) }
    let mut cl = w16(&format!("\"{}\" {args}", exe.display()));
    let mut pi: PROCESS_INFORMATION = std::mem::zeroed();
    // suspended until it is in the job, so nothing it starts can escape the job
    let ok = CreateProcessW(w16(&exe.display().to_string()).as_ptr(), cl.as_mut_ptr(), std::ptr::null(), std::ptr::null(), 0, EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED, std::ptr::null(), w16(&cwd.display().to_string()).as_ptr(), &si.StartupInfo, &mut pi) != 0;
    DeleteProcThreadAttributeList(si.lpAttributeList);
    if !ok { ClosePseudoConsole(pc); return Err("CreateProcess".into()) }
    if AssignProcessToJobObject(job(), pi.hProcess) == 0 { TerminateProcess(pi.hProcess, 1); CloseHandle(pi.hThread); CloseHandle(pi.hProcess); ClosePseudoConsole(pc); return Err("job".into()) }
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    Ok((pc, input, output, pi.hProcess as usize))
}

fn send(app: &AppHandle, js: String) { if let Some(w) = app.get_webview_window("main") { let _ = w.eval(js); } }

// output: UTF-8 split safely across reads; bursts are batched (a short wait lets the pipe fill) so a flood is not one eval per line
fn reader(app: AppHandle, id: u32, t: Arc<T>, mut out: File) {
    let (mut b, mut carry) = (vec![0u8; 1 << 16], Vec::new());
    while let Ok(n) = out.read(&mut b) {
        if n == 0 { break }
        carry.extend_from_slice(&b[..n]);
        let ok = match std::str::from_utf8(&carry) { Ok(_) => carry.len(), Err(e) if e.error_len().is_none() => e.valid_up_to(), Err(_) => carry.len() };
        let s = String::from_utf8_lossy(&carry[..ok]).into_owned();
        carry.drain(..ok);
        let end = { let mut g = t.buf.lock().unwrap(); g.0.extend(s.as_bytes()); let over = g.0.len().saturating_sub(KEEP); g.0.drain(..over); g.1 += s.len() as u64; g.1 };
        send(&app, format!("window.nexusTerm&&nexusTerm.out({id},{},{end})", serde_json::to_string(&s).unwrap_or_default()));
        if n > 4096 { thread::sleep(Duration::from_millis(16)) }
    }
}

// shell ended (exit, tab closed, or killed): close the pseudo console (ends the reader), drop it, tell the page
fn waiter(app: AppHandle, id: u32, t: Arc<T>) {
    let mut code = 0u32;
    unsafe { WaitForSingleObject(t.proc as HANDLE, u32::MAX); GetExitCodeProcess(t.proc as HANDLE, &mut code); ClosePseudoConsole(t.pc); CloseHandle(t.proc as HANDLE); }
    app.state::<Terms>().map.lock().unwrap().remove(&id);
    crate::append(serde_json::json!({ "at": crate::now_s(), "kind": "term", "op": "exit", "shell": t.shell }));
    send(&app, format!("window.nexusTerm&&nexusTerm.exit({id},{code})"));
}

fn replay(t: &T) -> (String, u64) { let g = t.buf.lock().unwrap(); (String::from_utf8_lossy(&g.0.iter().copied().collect::<Vec<u8>>()).into_owned(), g.1) }

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn term(app: AppHandle, webview: WebviewWindow, st: tauri::State<Terms>, op: String, id: Option<u32>, shell: Option<String>, data: Option<String>, cols: Option<u16>, rows: Option<u16>, cwd: Option<String>) -> Result<serde_json::Value, String> {
    // the capability already limits this to the main window at the tracker origin; checked again here (defence in depth)
    let u = webview.url().map_err(|e| e.to_string())?;
    if webview.label() != "main" || u.scheme() != "http" || u.host_str() != Some("127.0.0.1") || u.port() != Some(st.cur.load(SeqCst)) { return Err("not allowed".into()) }
    let size = |c: Option<u16>, d: u16, m: u16| c.unwrap_or(d).clamp(2, m);
    let get = |id: Option<u32>| id.and_then(|i| st.map.lock().unwrap().get(&i).cloned()).ok_or("no such terminal");
    match op.as_str() {
        "shells" => Ok(shells().iter().map(|s| serde_json::json!({ "id": s.0, "name": s.1 })).collect()),
        "list" => Ok(st.map.lock().unwrap().iter().map(|(i, t)| { let (b, n) = replay(t); serde_json::json!({ "id": i, "shell": t.shell, "buf": b, "end": n }) }).collect()),
        "open" => {
            if st.map.lock().unwrap().len() >= MAX { return Err(format!("At most {MAX} terminals.")) }
            let want = shell.unwrap_or_default();
            let all = shells();
            let (sid, _, exe, args) = all.iter().find(|s| s.0 == want).or(all.first()).ok_or("No shell found.")?;
            let home = PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default());
            let dir = cwd.map(PathBuf::from).filter(|d| d.is_absolute() && d.is_dir()).unwrap_or(home);
            let (pc, input, output, proc) = unsafe { spawn(exe, args, &dir, size(cols, 100, 500), size(rows, 30, 300))? };
            let i = { let mut n = st.next.lock().unwrap(); *n += 1; *n - 1 };
            let t = Arc::new(T { shell: sid, pc, input: Mutex::new(input), proc, buf: Mutex::new((VecDeque::new(), 0)) });
            st.map.lock().unwrap().insert(i, t.clone());
            let (a, b, tt) = (app.clone(), app.clone(), t.clone());
            thread::spawn(move || reader(a, i, tt, output));
            thread::spawn(move || waiter(b, i, t));
            crate::append(serde_json::json!({ "at": crate::now_s(), "kind": "term", "op": "open", "shell": sid }));
            Ok(serde_json::json!({ "id": i, "shell": sid }))
        }
        "write" => { let t = get(id)?; t.input.lock().unwrap().write_all(data.unwrap_or_default().as_bytes()).map_err(|e| e.to_string())?; Ok(serde_json::Value::Null) }
        "resize" => { let t = get(id)?; unsafe { ResizePseudoConsole(t.pc, COORD { X: size(cols, 100, 500) as i16, Y: size(rows, 30, 300) as i16 }) }; Ok(serde_json::Value::Null) }
        "close" => { let t = get(id)?; unsafe { TerminateProcess(t.proc as HANDLE, 1) }; Ok(serde_json::Value::Null) } // the waiter cleans up
        _ => Err("unknown op".into()),
    }
}

// the page may call `term` only from the main window at the tracker's current origin; one capability per port it has used (P3 fallback)
pub fn allow(app: &AppHandle, port: u16) {
    use tauri::ipc::CapabilityBuilder;
    static SEEN: Mutex<Vec<u16>> = Mutex::new(Vec::new());
    let mut s = SEEN.lock().unwrap();
    if s.contains(&port) { return }
    if app.add_capability(CapabilityBuilder::new(format!("term-{port}")).remote(format!("http://127.0.0.1:{port}/*")).window("main").permission("allow-term")).is_ok() { s.push(port) }
}
