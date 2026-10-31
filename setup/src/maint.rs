// M6e: install / Update / Repair / Uninstall (spec §26.12 stage 5, Q10, Q14). plan() is read-only: it lists every step, the Claude Code
// hooks diff and the data that would go; apply() runs it through the M6b journal (verified backups, Resume / Roll back) and rolls a failed run back at once.
// Code-only: Update and Repair touch program files, shortcuts and the startup entry; personal data, vaults, Graphify, skills, plugins never.
// Each file is swapped atomically (temp + rename) and the whole run is undone from its backups if any step fails (release.js keeps the old exe the same way).
// Test build: the Start with Windows entry is a mock registry value under the test root (the real app writes HKCU\...\Run "NEXUS"; never touched here).
// M6f: Apps & features record (Q14 "install records") = mock HKCU\...\Uninstall\NEXUS key under the test root, one Name=Value line per value;
// its UninstallString points at the copy of Setup placed in the program folder (NEXUS Setup.exe).
use crate::{core::{self, Ctx, Op}, detect};
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}};

const HOOKS: [(&str, &str); 4] = [("SessionStart", "boot"), ("UserPromptSubmit", "hook"), ("Stop", "snap"), ("PreCompact", "snap")];

pub struct Plan { pub ops: Vec<Op>, pub meta: Value, pub preview: Value }

fn sha_file(p: &Path) -> Option<String> { fs::read(p).ok().map(|b| core::sha(&b)) }
fn desk(c: &Ctx) -> PathBuf { c.env.home.join("Desktop").join("NEXUS.lnk") }
fn start(c: &Ctx) -> PathBuf { c.env.appdata.join("Microsoft").join("Windows").join("Start Menu").join("Programs").join("NEXUS.lnk") }
/// mock HKCU\Software\Microsoft\Windows\CurrentVersion\Run value "NEXUS" (test build)
pub fn run_value(c: &Ctx) -> PathBuf { c.root.join("registry").join("HKCU").join("Software\\Microsoft\\Windows\\CurrentVersion\\Run").join("NEXUS") }
/// mock HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\NEXUS key (Apps & features; test build)
pub fn arp_key(c: &Ctx) -> PathBuf { c.root.join("registry").join("HKCU").join("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall").join("NEXUS") }
fn setup_copy(c: &Ctx) -> PathBuf { c.env.programs().join("NEXUS Setup.exe") }
/// the Setup that is running now, if it runs from the program folder (Apps & features): it cannot remove its own exe
fn running(p: &Path) -> bool { std::env::current_exe().is_ok_and(|e| core::key(&core::real(&e)).eq_ignore_ascii_case(&core::key(p))) }
/// M6f: a new staging folder per plan (two Setups in the same second must never share one: a later plan would overwrite
/// the files an unfinished run still points at, and Resume would then stop with "payload changed")
fn stage_dir(c: &Ctx) -> Result<PathBuf, String> {
    let (base, s) = (c.root.join("staging"), core::stamp());
    fs::create_dir_all(c.guard(&base)?).map_err(|e| e.to_string())?;
    (0..1000).map(|n| base.join(format!("{s}-{n}"))).find(|d| fs::create_dir(d).is_ok()).ok_or("could not create a staging folder".into())
}
fn tracker(c: &Ctx) -> PathBuf { c.env.programs().join("tracker").join("tracker.js") }
/// adopt mode = the tracker people run today exists; then Setup writes no hooks and never offers to delete data (Q14)
pub fn adopt(c: &Ctx) -> bool { c.env.claude().join("token-tracker").join("tracker.js").is_file() }

fn files_in(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() { files_in(&p, out) } else { out.push(p) }
    }
}

/// Windows shortcut through IShellLinkW (Shell API, no script host)
fn make_lnk(dst: &Path, target: &Path, args: &str) -> Result<(), String> {
    use windows::{core::{Interface, HSTRING}, Win32::{System::Com::*, UI::Shell::*}};
    let e = |e: windows::core::Error| format!("shortcut: {e}");
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let l: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(e)?;
        l.SetPath(&HSTRING::from(target.as_os_str())).map_err(e)?;
        if let Some(d) = target.parent() { l.SetWorkingDirectory(&HSTRING::from(d.as_os_str())).map_err(e)? }
        l.SetArguments(&HSTRING::from(args)).map_err(e)?;
        l.SetDescription(&HSTRING::from("NEXUS")).map_err(e)?;
        l.cast::<IPersistFile>().map_err(e)?.Save(&HSTRING::from(dst.as_os_str()), true).map_err(e)?;
    }
    Ok(())
}

/// the 4 tracker hook entries NEXUS adds (same shape as Claude Code's settings.json)
fn hook_entries(c: &Ctx) -> Vec<Value> {
    let t = tracker(c).to_string_lossy().replace('\\', "/");
    HOOKS.iter().map(|(ev, a)| json!({ "event": ev, "entry": { "hooks": [{ "type": "command", "command": format!("node \"{t}\" {a}"), "timeout": 5 }] } })).collect()
}
fn settings(c: &Ctx) -> Result<(PathBuf, Option<Value>), String> {
    let p = c.env.claude().join("settings.json");
    match fs::read(&p) {
        Err(_) => Ok((p, None)),
        Ok(b) => serde_json::from_slice::<Value>(&b).ok().filter(|v| v.is_object() && (v["hooks"].is_null() || v["hooks"].is_object()))
            .map(|v| (p.clone(), Some(v))).ok_or("Claude Code's settings.json could not be read; Setup leaves it alone, no hooks changed.".into()),
    }
}
/// add (or remove) exact entries; returns the new settings + diff lines. Other settings and hooks are never touched.
fn edit_hooks(cur: Option<Value>, entries: &[Value], add: bool) -> (Value, Vec<String>) {
    let mut s = cur.unwrap_or(json!({}));
    let mut diff = vec![];
    for h in entries {
        let (ev, en) = (h["event"].as_str().unwrap_or(""), &h["entry"]);
        let list = s["hooks"][ev].as_array().cloned().unwrap_or_default();
        let has = list.contains(en);
        if add && !has { let mut l = list.clone(); l.push(en.clone()); s["hooks"][ev] = json!(l); diff.push(format!("+ \"{ev}\": {en}")) }
        if !add && has {
            let l: Vec<Value> = list.into_iter().filter(|x| x != en).collect();
            // ponytail: an event list left empty is dropped, even if it existed empty before NEXUS (harmless to Claude Code)
            if l.is_empty() { if let Some(o) = s["hooks"].as_object_mut() { o.remove(ev); } } else { s["hooks"][ev] = json!(l) }
            diff.push(format!("- \"{ev}\": {en}"));
        }
    }
    (s, diff)
}

/// build a run without changing anything (staged shortcuts / settings go to <root>\staging only)
pub fn plan(c: &Ctx, kind: &str, payload: Option<&Path>, o: &Value) -> Result<Plan, String> {
    // M6f: an unfinished run comes first; planning against a half-changed install would give misleading answers
    if core::Journal::load(c).is_open() { return Err("An unfinished Setup run was found: resume or roll it back first.".into()) }
    let m = core::Manifest::load(c);
    let installed = m.file.exists();
    let adopt = adopt(c);
    let red = |p: &Path| p.to_string_lossy().replace(&c.env.home.to_string_lossy().to_string(), "%USERPROFILE%");
    let recorded = m.v["app"].as_str().unwrap_or("");
    // M6f: a damaged install record would make every NEXUS file look foreign (or nothing removable): stop instead of guessing
    if installed && fs::read(&m.file).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).is_none_or(|v| !v["files"].is_object()) {
        return Err("The install record (install-manifest.json) is damaged, so Setup will not guess what it may change. Restore it from NEXUS Backups; nothing changed.".into())
    }
    match kind {
        "install" if installed => return Err("NEXUS is already installed here: use Update, Repair or Uninstall.".into()),
        "update" | "repair" | "uninstall" if !installed => return Err("NEXUS is not installed here (no install record), so there is nothing to change.".into()),
        "update" if detect::older(detect::APP_VER, recorded) => return Err(format!("NEXUS {recorded} is newer than this Setup ({}); Setup never downgrades it.", detect::APP_VER)),
        "update" if !detect::older(recorded, detect::APP_VER) => return Err(format!("NEXUS {recorded} is already this version; use Repair to check its files.")),
        "install" | "update" | "repair" | "uninstall" => {}
        _ => return Err("unknown action".into()),
    }
    let opt = if kind == "install" { json!({ "desk": o["desk"] == true, "start": o["start"] == true, "boot": o["boot"] == true, "hooks": o["hooks"] == true && !adopt }) }
        else { m.v["options"].clone() };
    let mut ops = vec![]; let mut steps = vec![]; let mut kept = vec![]; let mut diff = vec![]; let mut data = vec![];
    let mut meta = json!({ "options": opt, "mode": if kind == "install" { json!(if adopt { "adopt" } else { "new" }) } else { m.v["mode"].clone() },
        "hooks": m.v["hooks"].clone(), "dataCreated": m.v["dataCreated"].clone() });

    if kind == "uninstall" {
        // only what Setup placed and nobody changed: program files, shortcuts, the startup entry. Anything else NEXUS-owned (a starter note in a vault) stays.
        let mine = |p: &Path| core::within(&c.env.programs(), p) || [desk(c), start(c), run_value(c), arp_key(c)].iter().any(|x| core::key(&core::real(x)).eq_ignore_ascii_case(&core::key(p)));
        let ok = m.removable();
        for (k, v) in m.v["files"].as_object().into_iter().flatten() {
            let p = PathBuf::from(k);
            if running(&p) { kept.push(json!({ "path": red(&p), "why": "Setup is running from here" })); continue }
            if v["owner"] == "nexus" && mine(&p) && ok.contains(&p) { steps.push(json!({ "do": "remove", "path": red(&p) })); ops.push(Op { path: p, remove: true, ..Default::default() }) }
            else if p.exists() { kept.push(json!({ "path": red(&p), "why": if v["owner"] != "nexus" { "existed before Setup" } else if !mine(&p) { "your file (vault note)" } else { "changed since install" } })) }
        }
        let added: Vec<Value> = m.v["hooks"].as_array().cloned().unwrap_or_default();
        if o["rmHooks"] == true && !added.is_empty() {
            let (p, cur) = settings(c)?;
            let (new, d) = edit_hooks(cur, &added, false);
            if !d.is_empty() { ops.push(staged_op(c, &p, &serde_json::to_vec_pretty(&new).unwrap(), true)?); steps.push(json!({ "do": "edit", "path": red(&p) })); diff = d }
        }
        if o["delData"] == true {
            if adopt || m.v["mode"] == "adopt" || m.v["dataCreated"] != true { return Err("NEXUS did not create this data, so Setup never offers to delete it.".into()) }
            if o["typed"] != "DELETE" { return Err("Type DELETE to confirm removing NEXUS app data.".into()) }
            let mut f = vec![]; files_in(&c.env.data(), &mut f);
            let vaults: Vec<PathBuf> = detect::vault_paths(&c.env).iter().map(|v| core::real(v)).collect();
            for p in f.into_iter().map(|p| core::real(&p)) {
                let n = p.file_name().map_or(String::new(), |n| n.to_string_lossy().to_lowercase());
                if n.starts_with("setup-journal.json") || vaults.iter().any(|v| core::within(v, &p)) || c.guard(&p).is_err() { continue }
                data.push(red(&p)); ops.push(Op { path: p, remove: true, ..Default::default() });
            }
        }
        meta = Value::Null;
    } else {
        let pl = payload.ok_or("No NEXUS package given (test build: --payload <folder>).")?;
        if !pl.join("nexus.exe").is_file() { return Err("The NEXUS package has no nexus.exe; nothing changed.".into()) }
        let mut f = vec![]; files_in(pl, &mut f);
        let mut want: Vec<(PathBuf, PathBuf)> = f.iter().map(|s| (c.env.programs().join(s.strip_prefix(pl).unwrap()), s.clone())).collect();
        let exe = c.env.programs().join("nexus.exe");
        let stage = stage_dir(c)?;
        for (on, dst, name) in [(opt["desk"] == true, desk(c), "desk.lnk"), (opt["start"] == true, start(c), "start.lnk")] {
            if on { let s = stage.join(name); make_lnk(&s, &exe, "")?; want.push((dst, s)) }
        }
        // Setup itself goes into the program folder (Apps & features runs it to uninstall), then the Apps & features record
        let me = std::env::current_exe().map_err(|e| e.to_string())?;
        want.push((setup_copy(c), me.clone()));
        let kb = want.iter().filter_map(|(_, s)| fs::metadata(s).ok()).map(|m| m.len()).sum::<u64>() / 1024;
        let p = c.env.programs();
        let arp = format!("DisplayName=NEXUS\nDisplayVersion={}\nPublisher=NEXUS\nInstallLocation={}\nDisplayIcon={}\nUninstallString=\"{}\"\nNoModify=1\nNoRepair=1\nEstimatedSize={kb}\n",
            detect::APP_VER, p.display(), exe.display(), setup_copy(c).display());
        let s = stage.join("arp.txt"); c.write(&s, arp.as_bytes())?; want.push((arp_key(c), s));
        if opt["boot"] == true { let s = stage.join("run.txt"); c.write(&s, format!("\"{}\" --hidden", exe.display()).as_bytes())?; want.push((run_value(c), s)) }
        for (t, s) in &want {
            let t = core::real(t);
            let (cur, ent) = (sha_file(&t), &m.v["files"][core::key(&t)]);
            if cur == sha_file(s) || (kind == "repair" && cur.is_some() && cur.as_deref() == ent["sha256"].as_str()) { continue }
            if cur.is_some() && ent["owner"] != "nexus" { return Err(format!("{} already exists and is not a NEXUS file; Setup never replaces it.", red(&t))) }
            steps.push(json!({ "do": if cur.is_some() { "replace" } else { "place" }, "path": red(&t) }));
            ops.push(Op { path: t, src: s.clone(), replace: cur.is_some(), ..Default::default() });
        }
        if kind == "update" {
            // program files the new version no longer has: removed if unchanged, kept (and listed) if someone changed them
            let new: Vec<String> = want.iter().map(|(t, _)| core::key(&core::real(t)).to_lowercase()).collect();
            let ok = m.removable();
            for (k, v) in m.v["files"].as_object().into_iter().flatten() {
                let p = PathBuf::from(k);
                if v["owner"] != "nexus" || !core::within(&c.env.programs(), &p) || new.contains(&k.to_lowercase()) || !p.exists() { continue }
                if ok.contains(&p) { steps.push(json!({ "do": "remove", "path": red(&p) })); ops.push(Op { path: p, remove: true, ..Default::default() }) }
                else { kept.push(json!({ "path": red(&p), "why": "changed since install" })) }
            }
        }
        if kind == "install" {
            let mut d = vec![]; files_in(&c.env.data(), &mut d);
            meta["dataCreated"] = json!(!adopt && d.iter().all(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("setup-journal.json"))));
            meta["hooks"] = json!([]);
            if opt["hooks"] == true {
                if !pl.join("tracker").join("tracker.js").is_file() { return Err("This NEXUS package has no tracker, so no Claude Code hooks can point at it; nothing changed.".into()) }
                let (p, cur) = settings(c)?;
                let entries = hook_entries(c);
                let (new, d) = edit_hooks(cur, &entries, true);
                if !d.is_empty() { ops.push(staged_op(c, &p, &serde_json::to_vec_pretty(&new).unwrap(), true)?); steps.push(json!({ "do": "edit", "path": red(&p) })); diff = d }
                meta["hooks"] = json!(entries);
            }
        }
    }
    let preview = json!({ "kind": kind, "mode": if adopt { "adopt" } else { "new" }, "version": detect::APP_VER, "recorded": m.v["app"], "steps": steps,
        "hooksDiff": diff, "data": data, "kept": kept, "options": opt, "dataOffer": !adopt && m.v["mode"] != "adopt" && m.v["dataCreated"] == true });
    Ok(Plan { ops, meta, preview })
}

/// new settings.json content staged under the root, placed by a hooks step (backup + hash re-check by the journal)
fn staged_op(c: &Ctx, target: &Path, body: &[u8], hooks: bool) -> Result<Op, String> {
    let s = stage_dir(c)?.join("settings.json");
    c.write(&s, body)?;
    Ok(Op { path: target.to_path_buf(), src: s, replace: target.exists(), hooks, ..Default::default() })
}

/// plan + run; a run that fails part way is rolled back at once (nothing half-installed)
pub fn apply(c: &Ctx, kind: &str, payload: Option<&Path>, o: &Value, crash_after: Option<usize>) -> Value {
    let p = match plan(c, kind, payload, o) { Ok(p) => p, Err(e) => return json!({ "ok": false, "error": e }) };
    // M6f: only Repair can have nothing to do; an Update whose files all match still records its version (detect would say outdated forever)
    if p.ops.is_empty() && kind == "repair" { return json!({ "ok": true, "log": ["nothing to do: every file already matches"], "preview": p.preview }) }
    let mut j = core::Journal::load(c);
    if let Err(e) = j.begin_kind(c, &p.ops, kind, p.meta) { return json!({ "ok": false, "error": e, "preview": p.preview }) }
    match j.run(c, &mut core::Manifest::load(c), crash_after) {
        Ok(log) => json!({ "ok": true, "log": log, "preview": p.preview, "backup": j.v["backupDir"] }),
        Err(e) => {
            let rb = j.rollback(c, &mut core::Manifest::load(c));
            json!({ "ok": false, "error": e, "rolledBack": rb.as_ref().is_ok(), "rollback": rb.unwrap_or_else(|e| vec![e]), "preview": p.preview })
        }
    }
}
