// NEXUS for Obsidian: shows the NEXUS app (local tracker, 127.0.0.1) in an Obsidian tab. No build step.
// Sign-in is the same as start.cmd: `node tracker.js open --print` swaps launch.key for a one-time /launch link (30 s), so the
// token never reaches this plugin. The page runs in an Electron <webview> (own top-level context: the SameSite=Strict cookie works,
// unlike an iframe). Desktop only. Source: ~/.claude/nexus-app-dev/obsidian, installed by install.js.
const { Plugin, ItemView, Notice, PluginSettingTab, Setting } = require("obsidian");
const cp = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");

const VIEW = "nexus-app";
const PAGES = [["home", "Home"], ["claude-code", "Claude Code"], ["projects", "Projects"], ["optimizations", "Optimizations"], ["plugins", "Plugins & Skills"],
  ["learning", "Learning Lab"], ["knowledge", "Obsidian & Graphify"], ["analytics", "Analytics"], ["sessions", "Sessions"], ["automation", "Automation"], ["system", "System Health"], ["settings", "Settings"]]; // = the NEXUS sidebar (#/id)
const DEF = { tracker: path.join(os.homedir(), ".claude", "token-tracker"), node: "" };
const nodeExe = (s) => [s.node, "C:/Program Files/nodejs/node.exe", path.join(process.env.ProgramFiles || "", "nodejs", "node.exe")].find((p) => p && fs.existsSync(p)) || "node";

// one-time sign-in link from the tracker (starts it if needed, exactly like start.cmd)
const launchLink = (s) => new Promise((ok, no) => cp.execFile(nodeExe(s), ["tracker.js", "open", "--print"], { cwd: s.tracker, timeout: 20000, windowsHide: true },
  (e, out, err) => { const u = /http:\/\/127\.0\.0\.1:\d+\/launch\S*/.exec(out || ""); u ? ok(u[0]) : no(new Error((err || e?.message || "no link").trim().split("\n").pop())); }));

class NexusView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW; }
  getDisplayText() { return "NEXUS"; }
  getIcon() { return "activity"; }
  async onOpen() { this.contentEl.addClass("nexus-view"); const p = this.plugin.nextPage; this.plugin.nextPage = null; await this.load(p); }
  async load(page) {
    const n = this.n = (this.n || 0) + 1; this.contentEl.empty(); this.wv = null; // only the newest load may attach a webview
    const msg = this.contentEl.createDiv({ cls: "nexus-msg", text: "Opening NEXUS…" });
    let url; try { url = await launchLink(this.plugin.settings); if (n !== this.n) return; }
    catch (e) { msg.setText("NEXUS could not be opened: " + e.message); this.retry(msg); return; }
    const wv = document.createElement("webview");
    if (typeof wv.loadURL !== "function" && !("getWebContentsId" in wv)) { msg.setText("This Obsidian build has no webview support. Use the NEXUS desktop app."); return; }
    wv.setAttribute("partition", "nexus"); wv.setAttribute("src", url); wv.className = "nexus-wv";
    wv.addEventListener("did-finish-load", () => { msg.remove(); if (page) this.go(page); page = null; });
    wv.addEventListener("did-fail-load", (e) => { if (e.errorCode !== -3) { msg.setText("NEXUS stopped answering (" + e.errorDescription + ")."); this.retry(msg); } });
    this.contentEl.appendChild(wv); this.wv = wv;
  }
  retry(el) { el.createEl("button", { text: "Try again" }).onclick = () => this.load(); }
  go(page) { let u = ""; try { u = this.wv?.getURL() || ""; } catch { } if (u.startsWith("http://127.0.0.1")) this.wv.executeJavaScript(`location.hash = ${JSON.stringify("#/" + page)}`); else this.load(page); }
}

class NexusSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const el = this.containerEl, s = this.plugin.settings, save = () => this.plugin.saveData(s); el.empty();
    new Setting(el).setName("NEXUS tracker folder").setDesc("The folder with tracker.js. Default: ~/.claude/token-tracker").addText((t) => t.setValue(s.tracker).onChange((v) => { s.tracker = v.trim() || DEF.tracker; save(); }));
    new Setting(el).setName("Node.js").setDesc("node.exe path. Empty = find it automatically.").addText((t) => t.setPlaceholder(nodeExe({})).setValue(s.node).onChange((v) => { s.node = v.trim(); save(); }));
  }
}

module.exports = class NexusPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEF, await this.loadData());
    this.registerView(VIEW, (leaf) => new NexusView(leaf, this));
    this.addRibbonIcon("activity", "Open NEXUS", () => this.open());
    this.addCommand({ id: "open", name: "Open NEXUS", callback: () => this.open() });
    for (const [id, name] of PAGES) this.addCommand({ id: "page-" + id, name: "Open " + name, callback: () => this.open(id) });
    this.addCommand({ id: "reload", name: "Reload NEXUS", callback: () => { const l = this.app.workspace.getLeavesOfType(VIEW)[0]; l ? l.view.load() : this.open(); } });
    this.addSettingTab(new NexusSettings(this.app, this));
  }
  async open(page) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { this.nextPage = page; leaf = this.app.workspace.getLeaf("tab"); await leaf.setViewState({ type: VIEW, active: true }); }
    else if (page) leaf.view.go(page);
    this.app.workspace.revealLeaf(leaf);
    return leaf.view;
  }
};
