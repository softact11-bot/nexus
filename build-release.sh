# M7a: leak-free release build of the app + Setup (bash build-release.sh). Paths are worked out at run time, so no user name is stored here.
#  - --remap-path-prefix rewrites cargo registry / rustup / source paths in panic + debug strings
#  - tauri/custom-protocol = the production build `tauri build` makes; without it Tauri embeds this source folder (dev config_parent)
#  - isolated target folder; then leakscan.js must pass on both exes
set -e
cd "$(dirname "$0")"
H=$(cygpath -w ~); R=$(cygpath -w "$PWD")
export CARGO_TARGET_DIR="$R\\src-tauri\\target\\m7a-remap"
export RUSTFLAGS="--remap-path-prefix=$H\\.cargo\\registry=/cargo/registry --remap-path-prefix=$H\\.cargo\\git=/cargo/git --remap-path-prefix=$H\\.rustup=/rustup --remap-path-prefix=$R=/nexus"
(cd setup && cargo build --release --offline --features tauri/custom-protocol)
(cd src-tauri && cargo build --release --offline --features tauri/custom-protocol)
node leakscan.js scan src-tauri/target/m7a-remap/release/nexus-app.exe src-tauri/target/m7a-remap/release/nexus-setup.exe > /dev/null && echo "leakscan: both exes clean"
