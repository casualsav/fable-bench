#!/usr/bin/env bun
// Merge (or remove) the subagent guard's PreToolUse entry in a Claude Code
// settings.json. settings.json is live config with other tools' hooks in it,
// so this never rewrites the file wholesale: it drops the entries carrying our
// MARKER and appends one fresh entry, leaving every other key untouched.
//
// Usage: bun install-subagent-guard.ts <settings.json> <script-path> [--uninstall]
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";

/** Stands in for install.sh's `<!-- fable-bench:begin -->` sentinels, which JSON cannot carry. */
export const MARKER = "fable-bench:subagent-guard";

/**
 * A settings.json default for unnamed subagents, which an earlier fable-bench
 * install wrote here. It is box-wide, and the fallback was only ever meant for
 * Fable-led sessions (owner's ruling, 2026-09-20), so the hook now pins those
 * spawns itself and this key is removed wherever we put it.
 */
export const STALE_ENV_KEY = "CLAUDE_CODE_SUBAGENT_MODEL";
export const STALE_ENV_VALUE = "opus";

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

  // Installing and uninstalling both clear the stale box-wide default, and only
  // while it still reads what we wrote — a hand-set default is somebody else's.
  const env = { ...(out.env ?? {}) };
  if (env[STALE_ENV_KEY] === STALE_ENV_VALUE) {
    delete env[STALE_ENV_KEY];
    if (Object.keys(env).length > 0) out.env = env;
    else delete out.env;
  }

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
