// subagent-guard.test.ts — the decision rule of the PreToolUse guard on the
// Agent tool, plus the settings.json merge that installs it.
//
// The hazard the owner named (2026-09-20): an Agent call that pins no model
// inherits the PARENT session's model, so a Fable-led session spawning
// `general-purpose` runs the fan-out at Fable rates. A definition that pins a
// non-Fable model cannot do that and is allowed under any parent.
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decide, loadRoster, parentModel, frontmatterModel, denyPayload, MANIFEST,
  type Roster, type Parent,
} from "./scripts/subagent-guard.ts";
import { mergeSettings, guardEntry, MARKER } from "./scripts/install-subagent-guard.ts";

const ROSTER: Roster = new Map([
  ["coder", { model: "claude-sonnet-5", fableBench: true }],
  ["explorer", { model: "claude-sonnet-5", fableBench: true }],
  ["researcher", { model: "claude-sonnet-5", fableBench: true }],
  ["engineer", { model: "claude-opus-5", fableBench: true }],
  ["verifier", { model: "claude-haiku-4-5-20251001", fableBench: true }],
  ["fable-planner", { model: "claude-fable-5", fableBench: true }],
  // Not fable-bench's, but pinned to a non-Fable model, so it cannot inherit.
  ["assistant", { model: "claude-sonnet-5" }],
  ["broker-verifier", { model: "sonnet" }],
  // An agent file with no `model:` — it inherits, exactly like general-purpose.
  ["unpinned", {}],
]);

const call = (tool_input: Record<string, unknown>, parent: Parent, tool_name = "Agent") =>
  decide({ tool_name, tool_input }, ROSTER, parent);

const INHERITING = ["general-purpose", "fork", "Explore", "Plan", "claude", "claude-code-guide", "unpinned"];

// ---- under a Fable-led parent -------------------------------------------------

test("a Fable parent may not spawn anything that would inherit its model", () => {
  for (const t of INHERITING) {
    const d = call({ subagent_type: t, prompt: "go" }, "fable");
    expect(d.allow).toBe(false);
    expect(!d.allow && d.reason).toContain("Fable-led");
  }
});

test("a Fable parent's denial names the fable-bench workers to use instead", () => {
  const d = call({ subagent_type: "general-purpose" }, "fable");
  expect(!d.allow && d.reason).toContain("researcher");
  expect(!d.allow && d.reason).toContain("explorer");
  // fable-planner is not offered as a substitute worker.
  expect(!d.allow && d.reason).not.toContain("fable-planner");
});

test("an Agent call with no subagent_type is denied under a Fable parent", () => {
  const d = call({ prompt: "go" }, "fable");
  expect(d.allow).toBe(false);
  expect(!d.allow && d.reason).toContain("no `subagent_type`");
});

test("a Fable parent may spawn any worker that pins a non-Fable model", () => {
  for (const t of ["coder", "explorer", "researcher", "engineer", "verifier", "broker-verifier"])
    expect(call({ subagent_type: t, prompt: "go" }, "fable").allow).toBe(true);
});

test("the bridge's own `assistant` agent is never denied", () => {
  for (const parent of ["fable", "safe", "unknown"] as Parent[])
    expect(call({ subagent_type: "assistant", prompt: "look" }, parent).allow).toBe(true);
});

test("a Fable parent may not spawn fable-planner — it is already the planner", () => {
  const d = call({ subagent_type: "fable-planner", prompt: "plan" }, "fable");
  expect(d.allow).toBe(false);
  expect(!d.allow && d.reason).toContain("already the planner");
});

// ---- under a parent that is provably not Fable --------------------------------

test("a non-Fable parent keeps the inheriting types — its subagents inherit Sonnet or Opus", () => {
  for (const t of INHERITING) expect(call({ subagent_type: t, prompt: "go" }, "safe").allow).toBe(true);
  expect(call({ prompt: "go" }, "safe").allow).toBe(true);
});

test("a non-Fable parent may spawn fable-planner — that is what /fable is", () => {
  expect(call({ subagent_type: "fable-planner", prompt: "plan" }, "safe").allow).toBe(true);
});

// ---- when the parent cannot be read -------------------------------------------

test("an unreadable parent fails closed, and the denial says so", () => {
  const d = call({ subagent_type: "general-purpose" }, "unknown");
  expect(d.allow).toBe(false);
  expect(!d.allow && d.reason).toContain("could not be read");
});

test("failing closed still allows pinned workers and fable-planner", () => {
  expect(call({ subagent_type: "coder" }, "unknown").allow).toBe(true);
  // Only a PROVEN Fable parent blocks the planner; a /fable typed as a
  // session's first action must not be denied on a missing reading.
  expect(call({ subagent_type: "fable-planner" }, "unknown").allow).toBe(true);
});

// ---- the model parameter ------------------------------------------------------

test("a Fable model is denied under every parent, however it is spelled", () => {
  for (const model of ["fable", "claude-fable-5-1", "Mythos", "claude-fable-5"])
    for (const parent of ["fable", "safe", "unknown"] as Parent[]) {
      const d = call({ subagent_type: "explorer", model }, parent);
      expect(d.allow).toBe(false);
      expect(!d.allow && d.reason).toContain("Fable-tier");
    }
});

test("an explicit non-Fable model is the escape hatch — it pins, so it cannot inherit", () => {
  expect(call({ subagent_type: "general-purpose", model: "sonnet" }, "fable").allow).toBe(true);
  expect(call({ subagent_type: "explorer", model: "opus" }, "fable").allow).toBe(true);
  expect(call({ model: "sonnet", prompt: "go" }, "fable").allow).toBe(true);
});

// ---- plumbing -----------------------------------------------------------------

test("the legacy `Task` tool name is guarded too, and other tools are not", () => {
  expect(call({ subagent_type: "general-purpose" }, "fable", "Task").allow).toBe(false);
  expect(call({ command: "ls" }, "fable", "Bash").allow).toBe(true);
});

test("the deny payload is the documented PreToolUse deny form", () => {
  expect(JSON.parse(denyPayload("nope"))).toEqual({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "nope",
    },
  });
});

test("frontmatterModel reads only a leading --- block", () => {
  expect(frontmatterModel("---\nname: x\nmodel: claude-sonnet-5\n---\nbody\n")).toBe("claude-sonnet-5");
  expect(frontmatterModel("---\nname: x\n---\nmodel: claude-sonnet-5\n")).toBeUndefined();
  expect(frontmatterModel("no frontmatter\n")).toBeUndefined();
});

test("loadRoster reads every installed agent file and marks fable-bench's own", () => {
  const dir = mkdtempSync(join(tmpdir(), "subguard-roster-"));
  try {
    mkdirSync(join(dir, "agents"));
    const write = (n: string, model?: string) =>
      writeFileSync(join(dir, "agents", `${n}.md`), `---\nname: ${n}\n${model ? `model: ${model}\n` : ""}---\nbody\n`);
    write("explorer", "claude-sonnet-5");
    write("fable-planner", "claude-fable-5");
    write("assistant", "claude-sonnet-5");
    write("unpinned");
    writeFileSync(join(dir, MANIFEST), "explorer\nfable-planner\n\n# a comment\n");
    const roster = loadRoster(dir);
    expect([...roster.keys()].sort()).toEqual(["assistant", "explorer", "fable-planner", "unpinned"]);
    expect(roster.get("explorer")).toEqual({ model: "claude-sonnet-5", fableBench: true });
    expect(roster.get("assistant")).toEqual({ model: "claude-sonnet-5" });
    expect(roster.get("unpinned")?.model).toBeUndefined();
    expect(decide({ tool_name: "Agent", tool_input: { subagent_type: "assistant" } }, roster, "fable").allow).toBe(true);
    expect(decide({ tool_name: "Agent", tool_input: { subagent_type: "unpinned" } }, roster, "fable").allow).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRoster with no agents dir is empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "subguard-empty-"));
  try {
    expect(loadRoster(dir).size).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parentModel reads the driving model off the transcript tail", () => {
  const dir = mkdtempSync(join(tmpdir(), "subguard-transcript-"));
  const write = (n: string, lines: unknown[]) => {
    const p = join(dir, n);
    writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    return p;
  };
  try {
    const turn = (model: string) => ({ type: "assistant", message: { model, content: [] } });
    expect(parentModel(write("fable.jsonl", [{ type: "user" }, turn("claude-fable-5-1"), { type: "user" }]))).toBe("fable");
    expect(parentModel(write("sonnet.jsonl", [turn("claude-opus-5"), turn("claude-sonnet-5")]))).toBe("safe");
    // The LAST assistant entry wins: a session switched onto Fable reads fable.
    expect(parentModel(write("switch.jsonl", [turn("claude-sonnet-5"), turn("claude-fable-5-1")]))).toBe("fable");
    expect(parentModel(write("none.jsonl", [{ type: "user" }, { type: "attachment" }]))).toBe("unknown");
    expect(parentModel(write("empty.jsonl", []))).toBe("unknown");
    expect(parentModel(join(dir, "missing.jsonl"))).toBe("unknown");
    expect(parentModel(undefined)).toBe("unknown");
    // Only the tail is read, so a big transcript still finds its last turn.
    const big = [turn("claude-fable-5-1"), ...Array.from({ length: 400 }, () => ({ type: "user", pad: "x".repeat(4096) })), turn("claude-sonnet-5")];
    expect(parentModel(write("big.jsonl", big))).toBe("safe");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the hook binary denies an inheriting spawn under a Fable transcript and allows a worker", () => {
  const dir = mkdtempSync(join(tmpdir(), "subguard-e2e-"));
  try {
    mkdirSync(join(dir, "agents"));
    writeFileSync(join(dir, MANIFEST), "explorer\ncoder\n");
    for (const a of ["explorer", "coder"])
      writeFileSync(join(dir, "agents", `${a}.md`), `---\nname: ${a}\nmodel: claude-sonnet-5\n---\nbody\n`);
    const transcript = join(dir, "t.jsonl");
    writeFileSync(transcript, JSON.stringify({ type: "assistant", message: { model: "claude-fable-5-1" } }) + "\n");
    const run = (tool_input: Record<string, unknown>) =>
      spawnSync("bun", [join(import.meta.dir, "scripts", "subagent-guard.ts")], {
        input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input, transcript_path: transcript }),
        env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
        encoding: "utf8",
      });

    const denied = run({ subagent_type: "general-purpose", prompt: "go" });
    expect(denied.status).toBe(0);
    expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecisionReason).toContain("explorer");

    const allowed = run({ subagent_type: "coder", prompt: "fix" });
    expect(allowed.status).toBe(0);
    expect(allowed.stdout.trim()).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mergeSettings adds the guard without disturbing other hooks, and is idempotent", () => {
  const other = { matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] };
  const before = { model: "haiku", hooks: { PreToolUse: [other], Stop: [{ hooks: [] }] } };
  const once = mergeSettings(before, "/c/scripts/subagent-guard.ts");
  expect(once.hooks.PreToolUse).toEqual([other, guardEntry("/c/scripts/subagent-guard.ts")]);
  expect(once.hooks.Stop).toEqual(before.hooks.Stop);
  expect(once.model).toBe("haiku");
  expect(mergeSettings(once, "/c/scripts/subagent-guard.ts")).toEqual(once);
  const moved = mergeSettings(once, "/other/subagent-guard.ts");
  expect(moved.hooks.PreToolUse.filter((e: any) => e.hooks[0].command.includes(MARKER))).toHaveLength(1);
});

test("mergeSettings --uninstall removes only our entry", () => {
  const other = { matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] };
  const installed = mergeSettings({ hooks: { PreToolUse: [other] } }, "/c/g.ts");
  expect(mergeSettings(installed, "", true)).toEqual({ hooks: { PreToolUse: [other] } });
  const alone = mergeSettings({}, "/c/g.ts");
  expect(mergeSettings(alone, "", true)).toEqual({});
});

test("the installer CLI installs, re-installs without duplicating, and uninstalls", () => {
  const dir = mkdtempSync(join(tmpdir(), "subguard-cli-"));
  const file = join(dir, "settings.json");
  const script = join(import.meta.dir, "scripts", "install-subagent-guard.ts");
  try {
    const original = { model: "haiku", hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rtk" }] }] } };
    writeFileSync(file, JSON.stringify(original, null, 2));
    const run = (...args: string[]) => spawnSync("bun", [script, file, ...args], { encoding: "utf8" });
    const read = () => JSON.parse(readFileSync(file, "utf8"));

    expect(run("/c/g.ts").status).toBe(0);
    expect(read().hooks.PreToolUse).toHaveLength(2);
    expect(run("/c/g.ts").status).toBe(0);
    expect(read().hooks.PreToolUse).toHaveLength(2);
    expect(run("--uninstall").status).toBe(0);
    expect(read()).toEqual(original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
