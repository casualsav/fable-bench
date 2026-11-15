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
// The fix has to apply to Fable-led sessions ONLY (owner's ruling,
// 2026-09-20), so it cannot be a settings.json env default — that is box-wide.
// Instead, when the parent is Fable the hook REWRITES the call, pinning it to
// Opus (one step down from Fable rather than two) with PreToolUse
// `updatedInput`, and rides a one-line notice along. A Sonnet- or Opus-led
// session is passed through untouched: its subagents inherit as they always
// did. Preferring the defined workers is skills/fable/LEAD.md's rule; the hook
// only says so.
//
// The one spawn the rewrite cannot reach is `subagent_type: "fork"`: the Agent
// tool documents (2.1.325) that a fork "always runs on your model — a model
// override is ignored". Under a Fable parent a fork is therefore denied, with
// or without a `model`; elsewhere it passes untouched.
//
// The decision reads the tool input, the agent files (user-level under the
// config dir, then project-level under the session's cwd, which win by name)
// and the session transcript. No model call, no network.
//
// Canonical copy: fable-bench/scripts/subagent-guard.ts. Installed copy (the
// one settings.json runs): ~/.claude/scripts/subagent-guard.ts — keep
// byte-identical.
import { readFileSync, openSync, readSync, fstatSync, closeSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every agent type the session can spawn, by name. `model` is the frontmatter
 * pin; a type with no pin inherits the parent's model, which is the hazard.
 */
export type Roster = Map<string, { model?: string; fableBench?: boolean }>;

/** Whether the session doing the spawning is itself running on Fable. */
export type Parent = "fable" | "safe" | "unknown";

export type HookInput = { tool_name?: string; tool_input?: unknown; transcript_path?: string; cwd?: string };

/**
 * `updatedInput` replaces the tool input; `notice` is advice the session reads
 * without being blocked. Both ride the same allowed call.
 */
export type Decision =
  | { allow: true; updatedInput?: Record<string, unknown>; notice?: string }
  | { allow: false; reason: string };

/** What a Fable-led session's unnamed subagents are pinned to instead of Fable. */
export const FALLBACK_MODEL = "opus";

/** Name of the fable-bench roster manifest install.sh writes beside the agent files. */
export const MANIFEST = "fable-bench-agents";

/** How much of the transcript tail to read looking for the parent's model. */
const TAIL_BYTES = 1 << 20;

const isFableModel = (m: string) => /fable|mythos/i.test(m);

/**
 * Allow, rewrite or deny one Agent call. A Fable-model request is denied under
 * every parent. A `fork` always runs on the session's own model, so under a
 * Fable parent it is denied whatever `model` it carries, and otherwise passes
 * untouched — it cannot be pinned, so there is no fail-closed rewrite for it.
 * Any other call that pins no model, by tool input or by its roster entry, is
 * rewritten to the fallback under a Fable or unreadable parent.
 */
export function decide(input: HookInput, roster: Roster, parent: Parent): Decision {
  if (input.tool_name !== "Agent" && input.tool_name !== "Task") return { allow: true };

  const ti = (typeof input.tool_input === "object" && input.tool_input !== null
    ? input.tool_input
    : {}) as Record<string, unknown>;
  const model = typeof ti.model === "string" ? ti.model.trim() : "";
  const type = typeof ti.subagent_type === "string" ? ti.subagent_type.trim() : "";
  const workers = [...roster].filter(([, e]) => e.fableBench && e.model && !isFableModel(e.model)).map(([n]) => n).sort();
  const use = workers.length
    ? ` A Fable-led session prefers the defined workers — ${workers.join(", ")}.`
    : "";

  // No subagent may run on Fable, whatever the parent is. The tool's `model`
  // is an enum — sonnet | opus | haiku | fable on 2.1.278 — so in practice
  // this catches the literal "fable"; the pattern also covers full ids and
  // Mythos in case the enum widens.
  if (model && isFableModel(model))
    return {
      allow: false,
      reason: `fable-bench: subagent model "${model}" is Fable-tier — no subagent runs on Fable. Pass \`model: ${FALLBACK_MODEL}\` instead.`,
    };

  // Neither the rewrite nor an explicit model reaches a fork, so it must be
  // settled before the explicit-model allow below.
  if (type === "fork") {
    if (parent !== "fable") return { allow: true };
    return {
      allow: false,
      reason: `fable-bench: a fork always runs on this session's own model and ignores a model override, and this session is Fable-led — the fork would run on Fable.${use}`,
    };
  }

  // An explicit non-Fable model pins the call, so nothing about it can inherit.
  if (model) return { allow: true };

  const entry = type ? roster.get(type) : undefined;
  if (entry?.model) {
    if (!isFableModel(entry.model)) return { allow: true };
    // fable-planner is pinned to Fable on purpose: it IS the /fable plan. A
    // below-Fable driver may spawn it; a Fable lead is its own planner. The
    // rewrite below cannot help here — a frontmatter pin beats the tool input's
    // absence, and overriding it would silently turn the planner into a worker.
    if (entry.fableBench && parent !== "fable") return { allow: true };
    return {
      allow: false,
      reason: `fable-bench: \`${type}\` is pinned to "${entry.model}", which is Fable-tier, and this session is Fable-led — you are already the planner.${use}`,
    };
  }

  // Past here the call pins no model of its own and would inherit the parent's.
  // Under a parent that is provably not Fable that is exactly right, and the
  // call is passed through untouched.
  if (parent === "safe") return { allow: true };

  const what = type ? `\`${type}\` pins no model` : "this Agent call names no `subagent_type`";
  const why =
    parent === "fable"
      ? "this session is Fable-led"
      : "this session's model could not be read from its transcript, so the guard assumes Fable";
  return {
    allow: true,
    updatedInput: { ...ti, model: FALLBACK_MODEL },
    notice: `fable-bench: ${what} and ${why} — the guard pinned this spawn to ${FALLBACK_MODEL} rather than let it inherit Fable.${use}`,
  };
}

/** `<key>:` from a `---`-fenced markdown frontmatter block, if it has one. */
export function frontmatterField(text: string, key: string): string | undefined {
  if (!text.startsWith("---")) return undefined;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return undefined;
  const m = text.slice(0, end).match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m"));
  return m ? m[1]!.replace(/^(["'])(.*)\1$/, "$2") : undefined;
}

/** `model:` from a `---`-fenced markdown frontmatter block, if it has one. */
export const frontmatterModel = (text: string) => frontmatterField(text, "model");

/**
 * Agent files in <dir>/agents into the roster, keyed by frontmatter `name:`
 * (what Claude Code spawns by) or the filename stem without one. Each entry
 * replaces any earlier one of the same name outright, pin included.
 */
function readAgents(roster: Roster, dir: string): void {
  let files: string[] = [];
  try {
    files = readdirSync(join(dir, "agents")).filter((f) => f.endsWith(".md"));
  } catch {
    /* no agents dir: every type inherits, and the parent check decides */
  }
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(join(dir, "agents", f), "utf8");
    } catch {
      roster.set(f.slice(0, -3), {});
      continue;
    }
    roster.set(frontmatterField(text, "name") ?? f.slice(0, -3), { model: frontmatterModel(text) });
  }
}

/**
 * The roster is evidence, not a hand-kept list: every agent file under
 * <claudeDir>/agents, then every one under <cwd>/.claude/agents — a project
 * agent beats a user agent of the same name in Claude Code, so here it
 * replaces it, a project file with no `model:` un-pinning the name. The
 * manifest install.sh writes marks which names are fable-bench's, which is
 * what the denial message offers and what earns `fable-planner` its exemption.
 */
export function loadRoster(claudeDir: string, cwd?: string): Roster {
  const roster: Roster = new Map();
  readAgents(roster, claudeDir);
  if (cwd) readAgents(roster, join(cwd, ".claude"));
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

/**
 * An allowed call, optionally with a rewritten input and a line for the session
 * to read. Proved on 2.1.278: `updatedInput` really does change the model the
 * subagent runs on, and `additionalContext` reaches the model as a
 * system-reminder without blocking the call.
 */
export function allowPayload(d: { updatedInput?: Record<string, unknown>; notice?: string }): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      ...(d.updatedInput !== undefined && { updatedInput: d.updatedInput }),
      ...(d.notice !== undefined && { additionalContext: d.notice }),
    },
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
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : undefined;
  const d = decide(input, loadRoster(claudeDir, cwd), parentModel(input.transcript_path));
  if (!d.allow) console.log(denyPayload(d.reason));
  else if (d.updatedInput || d.notice) console.log(allowPayload(d));
  process.exit(0);
}
