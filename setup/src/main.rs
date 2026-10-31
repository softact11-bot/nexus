// NEXUS Setup.exe (M6, spec §26.12). Runs only with --root <folder inside %TEMP%>: a mock user profile there, every write guarded.
// The window shows the approved M0 screens (setup-ui/); Browse opens the real folder picker (M6b), an unfinished run offers Resume / Roll back.
// M6c: read-only detection of existing NEXUS installs + components (detect.rs); new vault only in a new / empty folder.
// M6d: version checks run in a Windows job and are stopped with their children at the time limit; a finished run records the exact NEXUS version.
// M6e: install / Update / Repair / Uninstall (maint.rs): a read-only plan first (steps, hooks diff, data list), then the journal run; a failed run rolls back.
// Test modes (same guard + lock): --run <plan.json> [--crash-after N], --resume, --rollback, --pick <folder|data>, --detect, --new-vault <folder>,
//   --plan|--apply <install|update|repair|uninstall> [--payload <folder>] [--opts <json>] [--crash-after N]. No HTTP server, no network.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod core;
mod detect;
mod maint;
mod req;
use serde_json::{json, Value};
use std::{path::{Path, PathBuf}, sync::Mutex, time::{Duration, Instant}};
use tauri::{State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

static HELD: Mutex<Option<core::Lock>> = Mutex::new(None); // the install-folder lock; let go (and tidied, M6f) before the process ends
fn bye(progs: &Path) { HELD.lock().unwrap().take(); core::tidy(progs) }
static RUN: Mutex<()> = Mutex::new(()); // one journal action at a time inside this process
struct Payload(Option<PathBuf>); // test build: the NEXUS package folder (--payload); a real Setup carries it inside
static DET: Mutex<Option<(Instant, Value)>> = Mutex::new(None); // one detection at a time, reused for 60 s unless Re-scan

fn picked(c: &core::Ctx, p: Option<PathBuf>, kind: &str) -> Value {
    let raw = p.clone();
    match p.map(|p| c.choose(&p, kind)) {
        None => json!(null),
        Some(Ok((p, w))) => json!({ "path": p, "warn": w }),
        Some(Err(e)) => json!({ "error": e, "picked": raw }),
    }
}
fn journal(c: &core::Ctx, act: &str) -> Value {
    let _g = RUN.lock().unwrap();
    let (mut j, mut m) = (core::Journal::load(c), core::Manifest::load(c));
    let r = match act { "resume" => j.run(c, &mut m, None), "rollback" => j.rollback(c, &mut m), _ => Err("unknown action".into()) };
    let v = match r { Ok(log) => json!({ "ok": true, "log": log }), Err(e) => json!({ "ok": false, "error": e }) };
    c.log(json!({ "event": act, "result": v }));
    v
}

#[tauri::command]
fn setup_info(c: State<'_, core::Ctx>) -> Value {
    json!({ "id": env!("NEXUS_ID"), "root": c.root, "programs": c.env.programs(), "data": c.env.data(), "openRun": core::Journal::load(&c).is_open() })
}
#[tauri::command]
fn setup_ready(c: State<'_, core::Ctx>) { c.log(json!({ "event": "ui ready" })) }
#[tauri::command]
fn pick_folder(c: State<'_, core::Ctx>, w: WebviewWindow, kind: String) -> Value {
    let owner = w.hwnd().map_or(0, |h| h.0 as isize);
    let v = picked(&c, core::pick_folder(owner, "NEXUS Setup: choose a folder", &c.env.home), &kind);
    c.log(json!({ "event": "pick", "kind": kind, "result": v }));
    v
}
#[tauri::command]
fn setup_detect(c: State<'_, core::Ctx>, refresh: bool) -> Value {
    let mut g = DET.lock().unwrap();
    if let Some((_, v)) = g.as_ref().filter(|(t, _)| !refresh && t.elapsed() < Duration::from_secs(60)) { return v.clone() }
    let v = detect::detect(&c);
    c.log(json!({ "event": "detect", "found": v["deps"].as_array().map_or(0, |d| d.iter().filter(|x| x["found"] == true).count()), "existing": !v["existing"].is_null(), "install": v["install"]["status"] }));
    *g = Some((Instant::now(), v.clone()));
    v
}
// M7h Install / Update (req.rs): async so the UI can poll progress and cancel while it runs
#[tauri::command]
async fn req_install(c: State<'_, core::Ctx>, id: String) -> Result<Value, ()> { let v = req::install(&c, &id); DET.lock().unwrap().take(); Ok(v) }
#[tauri::command]
fn req_progress() -> Value { req::progress() }
#[tauri::command]
fn req_cancel() { req::CANCEL.store(true, std::sync::atomic::Ordering::SeqCst) }
#[tauri::command]
fn run_action(c: State<'_, core::Ctx>, act: String) -> Value { journal(&c, &act) }
#[tauri::command]
fn setup_plan(c: State<'_, core::Ctx>, pl: State<'_, Payload>, kind: String, opts: Value) -> Value {
    let _g = RUN.lock().unwrap();
    maint::plan(&c, &kind, pl.0.as_deref(), &opts).map_or_else(|e| json!({ "ok": false, "error": e }), |p| json!({ "ok": true, "preview": p.preview }))
}
#[tauri::command]
fn setup_apply(c: State<'_, core::Ctx>, pl: State<'_, Payload>, kind: String, opts: Value) -> Value {
    let _g = RUN.lock().unwrap();
    let v = maint::apply(&c, &kind, pl.0.as_deref(), &opts, None);
    c.log(json!({ "event": kind, "result": { "ok": v["ok"], "error": v["error"], "log": v["log"] } }));
    *DET.lock().unwrap() = None; // the install changed: detect again
    v
}

fn fail(m: &str, code: i32) -> ! {
    eprintln!("{m}");
    if std::env::var_os("NEXUS_SETUP_NOBOX").is_none() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK};
        let w = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
        unsafe { MessageBoxW(std::ptr::null_mut(), w(m).as_ptr(), w("NEXUS Setup").as_ptr(), MB_OK | MB_ICONWARNING) };
    }
    std::process::exit(code)
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let arg = |k: &str| a.iter().position(|x| x == k).map(|i| a.get(i + 1).cloned().unwrap_or_default());
    let ctx = match arg("--root").map(|r| core::Ctx::new(Path::new(&r))) {
        Some(Ok(c)) => c,
        Some(Err(e)) => fail(&e, 2),
        None => fail("This NEXUS Setup build is a test build: start it with --root <a new folder inside %TEMP%>. Nothing on this PC is installed or changed.", 2),
    };
    *HELD.lock().unwrap() = Some(core::lock(&ctx).unwrap_or_else(|e| fail(&e, 3)));
    let progs = ctx.env.programs();
    ctx.log(json!({ "event": "start", "id": env!("NEXUS_ID"), "root": ctx.root, "args": &a[1..] }));

    // test modes: print one JSON line, exit 0 / 1
    let out = |v: Value| -> ! { println!("{v}"); bye(&progs); std::process::exit(if v["ok"] == false || v.get("error").is_some() { 1 } else { 0 }) };
    if let Some(plan) = arg("--run") {
        let r = (|| -> Result<Vec<String>, String> {
            let p: Value = serde_json::from_slice(&std::fs::read(&plan).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            let ops: Vec<core::Op> = p.as_array().ok_or("plan must be a list")?.iter().map(|o| core::Op {
                path: o["path"].as_str().unwrap_or("").into(), src: o["src"].as_str().unwrap_or("").into(), replace: o["replace"] == true, ..Default::default() }).collect();
            let (mut j, mut m) = (core::Journal::load(&ctx), core::Manifest::load(&ctx));
            j.begin(&ctx, &ops)?;
            j.run(&ctx, &mut m, arg("--crash-after").and_then(|n| n.parse().ok()))
        })();
        let v = match r { Ok(log) => json!({ "ok": true, "log": log }), Err(e) => json!({ "ok": false, "error": e }) };
        ctx.log(json!({ "event": "run", "result": v })); out(v)
    }
    for act in ["resume", "rollback"] { if a.iter().any(|x| x == &format!("--{act}")) { out(journal(&ctx, act)) } }
    if a.iter().any(|x| x == "--detect") { out(detect::detect(&ctx)) }
    if let Some(id) = arg("--req-install") { out(req::install(&ctx, &id)) }
    let payload = arg("--payload").map(PathBuf::from).or_else(|| std::env::current_exe().ok()?.parent().map(|d| d.join("package")).filter(|p| p.is_dir()));
    let opts: Value = arg("--opts").and_then(|o| serde_json::from_str(&o).ok()).unwrap_or(json!({}));
    if let Some(k) = arg("--plan") { out(maint::plan(&ctx, &k, payload.as_deref(), &opts).map_or_else(|e| json!({ "ok": false, "error": e }), |p| json!({ "ok": true, "preview": p.preview }))) }
    if let Some(k) = arg("--apply") {
        let v = maint::apply(&ctx, &k, payload.as_deref(), &opts, arg("--crash-after").and_then(|n| n.parse().ok()));
        ctx.log(json!({ "event": k, "result": { "ok": v["ok"], "error": v["error"], "log": v["log"] } })); out(v)
    }
    if let Some(p) = arg("--new-vault") {
        let v = detect::new_vault(&ctx, &mut core::Manifest::load(&ctx), Path::new(&p)).map_or_else(|e| json!({ "ok": false, "error": e }), |v| json!({ "ok": true, "result": v }));
        ctx.log(json!({ "event": "new vault", "result": v })); out(v)
    }
    if let Some(kind) = arg("--pick") {
        let v = picked(&ctx, core::pick_folder(0, "NEXUS Setup: choose a folder", &ctx.env.home), &kind);
        ctx.log(json!({ "event": "pick", "kind": kind, "result": v })); out(json!({ "ok": !v.is_null() && v.get("error").is_none(), "result": v }))
    }

    let webview = ctx.root.join("webview");
    tauri::Builder::default()
        .manage(ctx).manage(Payload(payload))
        .invoke_handler(tauri::generate_handler![setup_info, setup_ready, pick_folder, setup_detect, req_install, req_progress, req_cancel, run_action, setup_plan, setup_apply])
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("index.html".into()))
                .title("NEXUS Setup").inner_size(1180.0, 800.0).min_inner_size(900.0, 640.0)
                .data_directory(webview).build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("NEXUS Setup failed to start")
        .run(move |_, e| if let tauri::RunEvent::Exit = e { bye(&progs) })
}
