#!/usr/bin/env bun
// Merge (or remove) the subagent guard's two pieces of a Claude Code
// settings.json: its PreToolUse entry, and the box-wide default model for
// subagents that name none. settings.json is live config with other tools'
// hooks in it, so this never rewrites the file wholesale — it touches our hook
// entry and our one env key, and leaves every other key untouched.
//
// Usage: bun install-subagent-guard.ts <settings.json> <script-path> [--uninstall]
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";

/** Stands in for install.sh's `<!-- fable-bench:begin -->` sentinels, which JSON cannot carry. */
export const MARKER = "fable-bench:subagent-guard";

/**
 * A subagent that names no model falls back to this instead of inheriting the
 * parent's. Opus is one step down from Fable rather than two (owner's ruling,
 * 2026-09-20), and it is what makes an unnamed spawn under a Fable lead safe.
 */
export const SUBAGENT_MODEL_KEY = "CLAUDE_CODE_SUBAGENT_MODEL";
export const SUBAGENT_MODEL = "opus";

type Entry = { matcher?: string; hooks?: { type?: string; command?: string }[] };

export const guardEntry = (scriptPath: string): Entry => ({
  matcher: "Agent|Task",
  hooks: [{ type: "command", command: `bun ${scriptPath} # ${MARKER}` }],
});

const isOurs = (e: Entry) =>
  Array.isArray(e?.hooks) && e.hooks.length > 0 && e.hooks.every((h) => h?.command?.includes(MARKER));

/** Idempotent: strip our entries, then append one unless uninstalling. */
export function mergeSettings(settings: Record<string, any>, scriptPath: string, uninstall = false) {
  const out = { ...settings };

  const hooks = { ...(out.hooks ?? {}) };
  const pre: Entry[] = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse.filter((e: Entry) => !isOurs(e)) : [];
  if (!uninstall) pre.push(guardEntry(scriptPath));
  if (pre.length > 0) hooks.PreToolUse = pre;
  else delete hooks.PreToolUse;
  if (Object.keys(hooks).length > 0) out.hooks = hooks;
  else delete out.hooks;

  const env = { ...(out.env ?? {}) };
  if (uninstall) {
    // Only our own value comes out. A hand-set default is somebody else's key.
    if (env[SUBAGENT_MODEL_KEY] === SUBAGENT_MODEL) delete env[SUBAGENT_MODEL_KEY];
  } else {
    env[SUBAGENT_MODEL_KEY] = SUBAGENT_MODEL;
  }
  if (Object.keys(env).length > 0) out.env = env;
  else delete out.env;

  return out;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const uninstall = argv.includes("--uninstall");
  const [file, scriptPath] = argv.filter((a) => !a.startsWith("--"));
  if (!file || (!scriptPath && !uninstall)) {
    console.error("usage: install-subagent-guard.ts <settings.json> <script-path> [--uninstall]");
    process.exit(2);
  }
  if (!existsSync(file) && uninstall) process.exit(0);
  let settings: Record<string, any> = {};
  if (existsSync(file)) {
    const raw = readFileSync(file, "utf8").trim();
    if (raw) {
      try {
        settings = JSON.parse(raw);
      } catch (e) {
        console.error(`${file} is not valid JSON; refusing to touch it: ${e}`);
        process.exit(1);
      }
    }
  }
  const merged = mergeSettings(settings, scriptPath ?? "", uninstall);
  const tmp = `${file}.fable-bench.tmp`;
  writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`);
  JSON.parse(readFileSync(tmp, "utf8")); // never rename a file we cannot read back
  renameSync(tmp, file);
}
