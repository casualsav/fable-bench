#!/usr/bin/env bun
// PreToolUse hook on the Agent tool (Claude Code 2.1.278 names it `Agent`;
// `Task` is the legacy spelling and still circulates internally, so both match).
//
// Why: an Agent call whose `subagent_type` pins no model INHERITS the parent
// session's model unless a box-wide default says otherwise. A Fable-led
// session that spawns `general-purpose` therefore ran the whole fan-out at
// Fable rates — observed 2026-09-20, five unnamed subagents, three of which
// spawned four more each.
//
// install.sh now sets that default (CLAUDE_CODE_SUBAGENT_MODEL=opus), so an
// unnamed spawn lands on Opus instead of inheriting. This hook is what holds
// when the default is missing, and what refuses Fable outright. Preferring the
// defined workers is skills/fable/LEAD.md's rule; the hook only says so.
//
// The decision reads the tool input, the installed agent files, the session
// transcript and the process environment. No model call, no network.
//
// Canonical copy: fable-bench/scripts/subagent-guard.ts. Installed copy (the
// one settings.json runs): ~/.claude/scripts/subagent-guard.ts — keep
// byte-identical.
import { readFileSync, openSync, readSync, fstatSync, closeSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every agent type the box defines, by name. `model` is the frontmatter pin;
 * a type with no pin inherits the parent's model, which is the hazard.
 */
export type Roster = Map<string, { model?: string; fableBench?: boolean }>;

/** Whether the session doing the spawning is itself running on Fable. */
export type Parent = "fable" | "safe" | "unknown";

export type HookInput = { tool_name?: string; tool_input?: unknown; transcript_path?: string };

/** `notice` is advice the session should see without being blocked. */
export type Decision = { allow: true; notice?: string } | { allow: false; reason: string };

/** Name of the fable-bench roster manifest install.sh writes beside the agent files. */
export const MANIFEST = "fable-bench-agents";

/** How much of the transcript tail to read looking for the parent's model. */
const TAIL_BYTES = 1 << 20;

const isFableModel = (m: string) => /fable|mythos/i.test(m);

/**
 * @param subagentDefault the box-wide `CLAUDE_CODE_SUBAGENT_MODEL` as this
 *   process sees it — "" when no default is in force, in which case a spawn
 *   that pins no model of its own falls back to the parent's.
 */
export function decide(input: HookInput, roster: Roster, parent: Parent, subagentDefault = ""): Decision {
  if (input.tool_name !== "Agent" && input.tool_name !== "Task") return { allow: true };

  const ti = (typeof input.tool_input === "object" && input.tool_input !== null
    ? input.tool_input
    : {}) as Record<string, unknown>;
  const model = typeof ti.model === "string" ? ti.model.trim() : "";
  const type = typeof ti.subagent_type === "string" ? ti.subagent_type.trim() : "";
  const workers = [...roster].filter(([, e]) => e.fableBench && e.model && !isFableModel(e.model)).map(([n]) => n).sort();
  const use = workers.length
    ? ` Spawn a defined worker instead — ${workers.join(", ")} — or escalate one with a spawn-time \`model: sonnet\` / \`model: opus\`.`
    : "";

  // No subagent may run on Fable, whatever the parent is. The tool's `model`
  // is an enum — sonnet | opus | haiku | fable on 2.1.278 — so in practice
  // this catches the literal "fable"; the pattern also covers full ids and
  // Mythos in case the enum widens.
  if (model && isFableModel(model))
    return { allow: false, reason: `fable-bench: subagent model "${model}" is Fable-tier — no subagent runs on Fable.${use}` };

  // An explicit non-Fable model pins the call, so nothing about it can inherit.
  if (model) return { allow: true };

  const entry = type ? roster.get(type) : undefined;
  if (entry?.model) {
    // A frontmatter pin beats the box-wide default, so a Fable-pinned agent
    // really does run on Fable.
    if (!isFableModel(entry.model)) return { allow: true };
    // fable-planner is pinned to Fable on purpose: it IS the /fable plan. A
    // below-Fable driver may spawn it; a Fable lead is its own planner.
    if (entry.fableBench && parent !== "fable") return { allow: true };
    return {
      allow: false,
      reason: `fable-bench: \`${type}\` is pinned to "${entry.model}", which is Fable-tier, and this session is Fable-led — you are already the planner.${use}`,
    };
  }

  // Past here the call pins no model of its own. The box-wide default decides
  // what it runs on; only without one does it fall back to the parent.
  const what = type ? `\`${type}\` pins no model` : "this Agent call names no `subagent_type`";
  if (subagentDefault) {
    if (isFableModel(subagentDefault))
      return {
        allow: false,
        reason: `fable-bench: ${what}, and the box-wide CLAUDE_CODE_SUBAGENT_MODEL default is "${subagentDefault}" — no subagent runs on Fable.${use}`,
      };
    return parent === "fable"
      ? { allow: true, notice: `fable-bench: ${what}, so it runs on ${subagentDefault} rather than a worker you chose. A Fable-led session prefers the defined workers.${use}` }
      : { allow: true };
  }

  if (parent === "safe") return { allow: true };
  const why =
    parent === "fable"
      ? "this session is Fable-led"
      : "this session's model could not be read from its transcript, so the guard assumes Fable";
  return {
    allow: false,
    reason:
      `fable-bench: ${what} and this session has no CLAUDE_CODE_SUBAGENT_MODEL default, so it would inherit the session's model — ${why}. ` +
      `Re-run fable-bench's install.sh (and restart the session) to restore the Opus fallback.${use}`,
  };
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
 * The roster is evidence, not a hand-kept list: every agent file installed
 * under <claudeDir>/agents, with the model its frontmatter pins. The manifest
 * install.sh writes marks which of them are fable-bench's, which is what the
 * denial message offers and what earns `fable-planner` its exemption.
 */
export function loadRoster(claudeDir: string): Roster {
  const roster: Roster = new Map();
  let files: string[] = [];
  try {
    files = readdirSync(join(claudeDir, "agents")).filter((f) => f.endsWith(".md"));
  } catch {
    /* no agents dir: every type inherits, and the parent check decides */
  }
  for (const f of files) {
    const name = f.slice(0, -3);
    try {
      roster.set(name, { model: frontmatterModel(readFileSync(join(claudeDir, "agents", f), "utf8")) });
    } catch {
      roster.set(name, {});
    }
  }
  try {
    for (const line of readFileSync(join(claudeDir, MANIFEST), "utf8").split("\n")) {
      const name = line.trim();
      if (!name || name.startsWith("#")) continue;
      roster.set(name, { ...(roster.get(name) ?? {}), fableBench: true });
    }
  } catch {
    /* fable-bench not installed here: the guard still denies inheriting spawns */
  }
  return roster;
}

/**
 * The driving model of the session making the call. A PreToolUse hook is not
 * told it (measured 2026-09-20 against Claude Code 2.1.278: the hook input
 * carries session_id, transcript_path, cwd, prompt_id, permission_mode,
 * agent_id, agent_type, effort, tool_name, tool_input and tool_use_id but no
 * model, and the hook's environment exposes CLAUDE_EFFORT and no model
 * variable), so the transcript is the only evidence. Two measured limits:
 * the assistant message carrying THIS tool call has not been flushed yet, so
 * the reading is the previous turn's; and on a session's very first tool call
 * there is no assistant entry at all, which reads "unknown" and fails closed.
 */
export function parentModel(transcriptPath?: string): Parent {
  if (!transcriptPath) return "unknown";
  let tail: string;
  try {
    const fd = openSync(transcriptPath, "r");
    try {
      const size = fstatSync(fd).size;
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(Math.min(size, TAIL_BYTES));
      readSync(fd, buf, 0, buf.length, start);
      tail = buf.toString("utf8");
      if (start > 0) tail = tail.slice(tail.indexOf("\n") + 1); // drop the partial first line
    } finally {
      closeSync(fd);
    }
  } catch {
    return "unknown";
  }
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.includes('"assistant"')) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const m = o?.type === "assistant" ? o?.message?.model : undefined;
    if (typeof m === "string" && m) return isFableModel(m) ? "fable" : "safe";
  }
  return "unknown";
}

/** Advice on an allowed call: the session reads it, nothing is blocked. */
export function noticePayload(notice: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: notice },
  });
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
    process.exit(0); // Not a payload we understand — never block on our own bug.
  }
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME ?? "", ".claude");
  // settings.json `env` keys reach hook commands, so the default this session
  // actually runs under is readable here. "inherit" is the CLI's own word for
  // "no default".
  const envDefault = (process.env.CLAUDE_CODE_SUBAGENT_MODEL ?? "").trim();
  const d = decide(
    input,
    loadRoster(claudeDir),
    parentModel(input.transcript_path),
    envDefault === "inherit" ? "" : envDefault,
  );
  if (!d.allow) console.log(denyPayload(d.reason));
  else if (d.notice) console.log(noticePayload(d.notice));
  process.exit(0);
}
