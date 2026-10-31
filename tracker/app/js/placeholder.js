// Sidebar pages. Every page except Home is a full-page placeholder until the Home design is approved.
export const PAGES = [
  ['home', 'i-home', 'Home'],
  ['claude-code', 'i-term', 'Claude Code', 'Terminal workspace with tabs, split panes and project switching.', ['Terminal tabs and resizable splits', 'Project switcher', 'Quick access to skills and sessions', 'Context and optimization controls']],
  ['projects', 'i-folder', 'Projects', 'Every project with its usage, sessions and tools. Roblox and Blender work live here as project profiles.', ['Project directory with usage per project', 'Roblox Studio profile', 'Blender profile', 'Linked notes and recent sessions']],
  ['optimizations', 'i-bolt', 'Optimizations', 'Where token savings are found, tested and verified.', ['Overview and Recommendations', 'Automatic optimization rules', 'Experiments vs baseline', 'Verified savings, history and rollback', 'Diagnostics']],
  ['plugins', 'i-puzzle', 'Plugins & Skills', 'Installed plugins, skills and MCP servers, with their cost and status. Nothing is installed or removed without your approval.', ['Installed inventory with measured cost', 'Discover new skills', 'Improve a skill (diff + test)', 'Install and remove with approval']],
  ['learning', 'i-flask', 'Learning Lab', 'Experiments the tracker runs on its own rules, and what they showed.', ['Experiment timeline', 'Approval queue', 'Before and after charts', 'Rollback history']],
  ['knowledge', 'i-graph', 'Obsidian & Graphify', 'Your real vault notes and their links as an interactive graph. Notes open in Obsidian for editing.', ['Interactive knowledge graph', 'Note search and preview', 'Backlinks and related notes', 'Sync status and handoffs']],
  ['analytics', 'i-chart', 'Analytics', 'Token use over time, split by type, project, model and session.', ['Token types over time', 'Cache efficiency', 'Project and session comparisons', 'Export']],
  ['sessions', 'i-clock', 'Sessions', 'Every Claude Code session with its tokens, context growth and handoff notes.', ['Session table and timeline', 'Token breakdown per session', 'Context growth chart', 'Links to Obsidian handoffs']],
  ['automation', 'i-flow', 'Automation', 'One-click, scheduled and condition-based checks that run locally.', ['One-click runs', 'Schedules', 'Conditions on real metrics', 'Run history']],
  ['system', 'i-pulse', 'System Health', 'What the tracker itself costs: CPU, memory, hook time and disk.', ['Tracker CPU and memory', 'Hook latency', 'Frame rate and quality mode', 'Privacy and data inventory']],
  ['settings', 'i-gear', 'Settings', 'Themes, graph, motion, sound, accessibility, alerts, Obsidian, plugins, automation and performance.', ['Live preview, Save to keep', 'Undo, Redo, Discard, Reset', 'Export and import', 'Leave guard for unsaved changes']],
];

export function placeholder(root, id) {
  const p = PAGES.find(x => x[0] === id);
  root.innerHTML = `<div class="ph enter">
    <div class="ph-head" style="--i:0"><svg class="ic"><use href="#${p[1]}"/></svg><h1>${p[2]}</h1></div>
    <p style="--i:1">${p[3]}</p>
    <ul style="--i:2">${p[4].map(x => `<li>${x}</li>`).join('')}</ul>
    <span class="note" style="--i:3">Built after you approve the Home design.</span>
  </div>`;
}
