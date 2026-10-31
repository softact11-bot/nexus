// M6a: same NEXUS_ID stamp as the app ("<commit>[-dirty];<profile>;setup"), written to setup.log at start
fn main() {
    let git = |a: &[&str]| std::process::Command::new("git").args(a).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    let commit = git(&["rev-parse", "--short", "HEAD"]).unwrap_or_else(|| "unknown".into());
    let dirty = git(&["status", "--porcelain"]).map_or(true, |s| !s.is_empty());
    println!("cargo:rustc-env=NEXUS_ID={commit}{};{};setup", if dirty { "-dirty" } else { "" }, std::env::var("PROFILE").unwrap_or_default());
    for p in ["../.git/HEAD", "../.git/refs/heads", "../.git/index"] { println!("cargo:rerun-if-changed={p}"); }
    tauri_build::build()
}
