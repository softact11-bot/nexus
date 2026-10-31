# NEXUS

A local desktop companion for [Claude Code](https://claude.com/claude-code) on Windows. It reads your Claude Code sessions, project folders and the Obsidian vaults you choose, and shows token use, savings, projects, a knowledge graph, automations and system health.

Everything runs on your PC. The dashboard listens on `127.0.0.1` only and needs a one-time login link.

## Install

1. Download `NEXUS-windows.zip` from [Releases](../../releases) and unzip it.
2. Run `nexus-setup.exe`. Keep the `package` folder next to it.

The build is not code-signed, so Windows SmartScreen will warn you. Check the SHA-256 on the release page, or build it yourself.

## Run from source

Needs Node.js. No npm install.

```bash
cd tracker
node tracker.js open
```

## Build the installer

Needs Rust, Node.js, Git Bash and WebView2.

```bash
bash build-release.sh
```

`build-release.sh` uses `cargo --offline`, so run `cargo fetch` in `src-tauri` and `setup` first on a new machine.

## Google sign-in (optional)

NEXUS works without an account. To turn on Google sign-in, create your own Google OAuth Desktop client, set `NEXUS_GOOGLE_CLIENT` to its ID, then store its secret on your PC:

```bash
cd tracker
node accounts.js secret
```

No client ID or secret ships with this project.

## Leak check

`node leakscan.js scan <folder>` looks for personal paths, this PC's names and secrets. `node leakscan.js test` runs its self-test.

## Status

Windows only. Tested on one PC by its author. Real microphone use, screen readers and touch are untested.

## License

MIT, see [LICENSE](LICENSE). Bundled software: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
