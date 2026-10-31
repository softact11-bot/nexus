// M5d: the app's one command (`term`) gets an allow-term permission, granted at runtime only to the tracker origin (term::allow)
// M5e: NEXUS_ID = "<commit>[-dirty];<profile>;<normal|test>", logged at startup and checked by release.js before a freeze
fn main() {
    let git = |a: &[&str]| std::process::Command::new("git").args(a).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    let commit = git(&["rev-parse", "--short", "HEAD"]).unwrap_or_else(|| "unknown".into());
    let dirty = git(&["status", "--porcelain"]).map_or(true, |s| !s.is_empty());
    let kind = if std::env::var("CARGO_FEATURE_M5A_TEST").is_ok() { "test" } else { "normal" };
    println!("cargo:rustc-env=NEXUS_ID={commit}{};{};{kind}", if dirty { "-dirty" } else { "" }, std::env::var("PROFILE").unwrap_or_default());
    for p in ["../.git/HEAD", "../.git/refs/heads", "../.git/index"] { println!("cargo:rerun-if-changed={p}"); }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["term"]))).expect("tauri-build")
}
