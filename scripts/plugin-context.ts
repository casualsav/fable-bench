#!/usr/bin/env bun
// SessionStart hook of the /plugin install (hooks/hooks.json). A plugin cannot
// ship a CLAUDE.md (measured 2026-11-15 on Claude Code 2.1.325), so the
// lead-mode block install.sh splices into CLAUDE.md reaches a plugin session
// as SessionStart `additionalContext` instead.
//
// The hook's input carries no model (same measurement), so it cannot tell a
// Fable-led session from any other: the block goes to every session, and its
// own first sentence tells a below-Fable one to ignore it.
//
// In front of the block goes a paragraph on naming. A plugin's agents and
// skills answer only to "<plugin name>:<name>" — a bare `coder` is "not
// found" — and the kit's files are written for the install.sh layout under
// ~/.claude/, so the session is told both translations once, here.
//
// Plugin-only: install.sh does not copy this file. Never blocks a session:
// any failure prints nothing and exits 0.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The lead-mode block, with install.sh's config-dir placeholder. */
export const LEAD_FILE = "CLAUDE-fable-bench.md";
const PLACEHOLDER = "@CONFIG_DIR@";

/**
 * The SessionStart context for a plugin rooted at `root`: the naming notice,
 * a blank line, the lead block pointed at `root`. Throws when plugin.json or
 * the lead block cannot be read, or plugin.json carries no name.
 */
export function pluginContext(root: string): string {
  const name = JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8"))?.name;
  if (typeof name !== "string" || !name) throw new Error("plugin.json has no name");
  const lead = readFileSync(join(root, LEAD_FILE), "utf8").trimEnd();
  const notice =
    `${name} is installed here as a Claude Code plugin, rooted at ${root}. ` +
    `Its agents and skills carry the "${name}:" prefix: wherever its files name a worker or skill ` +
    `(coder, explorer, /fable), spawn or invoke ${name}:coder, ${name}:explorer, /${name}:fable — ` +
    `a bare name is not found. Where they name a path under ~/.claude/ (~/.claude/scripts/verify-against.ts), ` +
    `the file is under ${root}/ instead.`;
  // split/join, not replace: a path may hold `$&`, which replace would expand.
  return `${notice}\n\n${lead.split(PLACEHOLDER).join(root)}`;
}

if (import.meta.main) {
  try {
    const root = process.env.CLAUDE_PLUGIN_ROOT || dirname(import.meta.dir);
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: pluginContext(root) },
    }));
  } catch {
    /* not a readable plugin — say nothing rather than block the session */
  }
  process.exit(0);
}
