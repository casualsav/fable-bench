#!/usr/bin/env bun
// PreToolUse hook on the Agent tool (Claude Code 2.1.278 names it `Agent`;
// `Task` is the legacy spelling and still circulates internally, so both match).
//
// Why: an Agent call with no `model` inherits the PARENT session's model. A
// Fable-led session that spawns `general-purpose` therefore runs the whole
// fan-out at Fable rates — observed 2026-09-20, five unnamed subagents that
// spawned four more each. Prose in skills/fable/LEAD.md asks for the defined
// workers; this hook is the deterministic half.
//
// The decision uses the tool input plus the installed agent files only: no
// model call, no network. The parent's driving model is NOT available to a
// PreToolUse hook (measured 2026-09-20 against 2.1.278: the hook input carries
// session_id, transcript_path, cwd, prompt_id, permission_mode, agent_id,
// agent_type, effort, hook_event_name, tool_name, tool_input, tool_use_id —
// no model; and the hook's environment carries CLAUDE_EFFORT but no model
// var). So the rule cannot be scoped to Fable parents and applies box-wide.
//
// Canonical copy: fable-bench/scripts/subagent-guard.ts. Installed copy (the
// one settings.json runs): ~/.claude/scripts/subagent-guard.ts — keep
// byte-identical.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Agent types this guard lets through; everything else is denied. */
export type Roster = Map<string, { model?: string }>;

export type HookInput = {
  tool_name?: string;
  tool_input?: unknown;
};

export type Decision = { allow: true } | { allow: false; reason: string };

/** The one roster entry allowed to be pinned to Fable: it IS the /fable plan. */
const FABLE_PLANNER = "fable-planner";

/** Name of the roster manifest install.sh writes next to the agent files. */
export const MANIFEST = "fable-bench-agents";

const isFableModel = (m: string) => /fable|mythos/i.test(m);

function workerList(roster: Roster): string {
  return [...roster.keys()].sort().join(", ");
}

export function decide(input: HookInput, roster: Roster): Decision {
  if (input.tool_name !== "Agent" && input.tool_name !== "Task") return { allow: true };
  // No roster means fable-bench is not installed here; the guard has nothing
  // to allow against, so it stays out of the way rather than denying every spawn.
  if (roster.size === 0) return { allow: true };

  const ti = (typeof input.tool_input === "object" && input.tool_input !== null
    ? input.tool_input
    : {}) as Record<string, unknown>;
  const model = typeof ti.model === "string" ? ti.model.trim() : "";
  const type = typeof ti.subagent_type === "string" ? ti.subagent_type.trim() : "";
  const use = `Spawn a defined worker instead: ${workerList(roster)}. Escalate one with a spawn-time \`model: sonnet\` / \`model: opus\` if it needs more.`;

  if (model && isFableModel(model))
    return { allow: false, reason: `fable-bench: subagent model "${model}" is Fable-tier — no subagent may run on Fable. ${use}` };

  if (!type)
    return {
      allow: false,
      reason:
        `fable-bench: this Agent call names no \`subagent_type\`, so the subagent would inherit the session's model — on a Fable-led session that runs it at Fable rates. ${use}`,
    };

  const entry = roster.get(type);
  if (!entry)
    return {
      allow: false,
      reason: `fable-bench: \`${type}\` is not one of this box's defined workers. ${use}`,
    };

  if (type !== FABLE_PLANNER) {
    if (!entry.model)
      return {
        allow: false,
        reason: `fable-bench: \`${type}\` pins no \`model:\` in its frontmatter, so it would inherit the session's model. ${use}`,
      };
    if (isFableModel(entry.model))
      return {
        allow: false,
        reason: `fable-bench: \`${type}\` is pinned to "${entry.model}", which is Fable-tier — no subagent may run on Fable. ${use}`,
      };
  }

  return { allow: true };
}

/** `model:` from a `---`-fenced markdown frontmatter block, if it has one. */
export function frontmatterModel(text: string): string | undefined {
  if (!text.startsWith("---")) return undefined;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return undefined;
  const m = text.slice(0, end).match(/^model:[ \t]*(.+?)[ \t]*$/m);
  return m ? m[1] : undefined;
}

/**
 * Roster = the agent names install.sh recorded in the manifest, each paired
 * with the `model:` its installed agent file pins. A name whose file is
 * missing or unreadable stays in the roster with no model, so `decide` denies
 * it rather than guessing.
 */
export function loadRoster(claudeDir: string): Roster {
  const roster: Roster = new Map();
  let manifest: string;
  try {
    manifest = readFileSync(join(claudeDir, MANIFEST), "utf8");
  } catch {
    return roster;
  }
  for (const line of manifest.split("\n")) {
    const name = line.trim();
    if (!name || name.startsWith("#")) continue;
    let model: string | undefined;
    try {
      model = frontmatterModel(readFileSync(join(claudeDir, "agents", `${name}.md`), "utf8"));
    } catch {
      model = undefined;
    }
    roster.set(name, { model });
  }
  return roster;
}

export function denyPayload(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0); // Not a hook payload we understand — never block on our own bug.
  }
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME ?? "", ".claude");
  const d = decide(input, loadRoster(claudeDir));
  if (!d.allow) console.log(denyPayload(d.reason));
  process.exit(0);
}
