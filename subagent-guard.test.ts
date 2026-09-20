// subagent-guard.test.ts — the decision rule of the PreToolUse guard on the
// Agent tool, plus the settings.json merge that installs it.
//
// The rule the owner asked for (2026-09-20): a subagent may only be a worker
// this box defines. Anything else — `general-purpose`, a built-in type, a bare
// `model:` with no type — would inherit the parent session's model, and under a
// Fable lead that is a Fable-rate fan-out.
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, loadRoster, frontmatterModel, denyPayload, MANIFEST, type Roster } from "./scripts/subagent-guard.ts";
import { mergeSettings, guardEntry, MARKER } from "./scripts/install-subagent-guard.ts";

const ROSTER: Roster = new Map([
  ["coder", { model: "claude-sonnet-5" }],
  ["explorer", { model: "claude-sonnet-5" }],
  ["researcher", { model: "claude-sonnet-5" }],
  ["engineer", { model: "claude-opus-5" }],
  ["verifier", { model: "claude-haiku-4-5-20251001" }],
  ["fable-planner", { model: "claude-fable-5" }],
]);

const call = (tool_input: Record<string, unknown>, tool_name = "Agent") => decide({ tool_name, tool_input }, ROSTER);

test("general-purpose with no model is denied — it would inherit the session model", () => {
  const d = call({ subagent_type: "general-purpose", prompt: "go" });
  expect(d.allow).toBe(false);
  expect(!d.allow && d.reason).toContain("general-purpose");
  expect(!d.allow && d.reason).toContain("coder");
});

test("a defined worker is allowed", () => {
  expect(call({ subagent_type: "explorer", prompt: "look" }).allow).toBe(true);
  expect(call({ subagent_type: "researcher", prompt: "search" }).allow).toBe(true);
});

test("a defined worker with a non-Fable spawn-time override is allowed", () => {
  expect(call({ subagent_type: "explorer", model: "sonnet" }).allow).toBe(true);
  expect(call({ subagent_type: "coder", model: "opus" }).allow).toBe(true);
});

test("a Fable model is denied however it is spelled", () => {
  for (const model of ["fable", "claude-fable-5-1", "Mythos", "claude-fable-5"]) {
    const d = call({ subagent_type: "explorer", model });
    expect(d.allow).toBe(false);
    expect(!d.allow && d.reason).toContain("Fable");
  }
});

test("an explicit non-Fable model does NOT rescue an undefined type", () => {
  // The owner's sharpened rule: defined workers only, not merely "not Fable".
  expect(call({ subagent_type: "general-purpose", model: "sonnet" }).allow).toBe(false);
  expect(call({ model: "sonnet", prompt: "go" }).allow).toBe(false);
});

test("a missing subagent_type is denied", () => {
  const d = call({ prompt: "go" });
  expect(d.allow).toBe(false);
  expect(!d.allow && d.reason).toContain("no `subagent_type`");
});

test("built-in and fork types are denied", () => {
  for (const t of ["fork", "Explore", "Plan", "claude", "statusline-setup"])
    expect(call({ subagent_type: t }).allow).toBe(false);
});

test("fable-planner is the one allowed Fable-pinned worker — it IS the /fable plan", () => {
  expect(call({ subagent_type: "fable-planner", prompt: "plan" }).allow).toBe(true);
});

test("any other roster agent pinned to Fable is denied", () => {
  const poisoned: Roster = new Map([["coder", { model: "claude-fable-5-1" }]]);
  const d = decide({ tool_name: "Agent", tool_input: { subagent_type: "coder" } }, poisoned);
  expect(d.allow).toBe(false);
  expect(!d.allow && d.reason).toContain("Fable-tier");
});

test("a roster agent whose frontmatter pins no model is denied", () => {
  const unpinned: Roster = new Map([["coder", {}]]);
  const d = decide({ tool_name: "Agent", tool_input: { subagent_type: "coder" } }, unpinned);
  expect(d.allow).toBe(false);
  expect(!d.allow && d.reason).toContain("pins no `model:`");
});

test("the legacy `Task` tool name is guarded too, and other tools are not", () => {
  expect(call({ subagent_type: "general-purpose" }, "Task").allow).toBe(false);
  expect(call({ command: "ls" }, "Bash").allow).toBe(true);
});

test("an empty roster means fable-bench is not installed — the guard stays inert", () => {
  expect(decide({ tool_name: "Agent", tool_input: { subagent_type: "general-purpose" } }, new Map()).allow).toBe(true);
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

test("loadRoster pairs the manifest with the installed agent files", () => {
  const dir = mkdtempSync(join(tmpdir(), "subguard-roster-"));
  try {
    mkdirSync(join(dir, "agents"));
    writeFileSync(join(dir, MANIFEST), "explorer\nfable-planner\nghost\n\n# comment\n");
    writeFileSync(join(dir, "agents", "explorer.md"), "---\nname: explorer\nmodel: claude-sonnet-5\n---\nbody\n");
    writeFileSync(join(dir, "agents", "fable-planner.md"), "---\nname: fable-planner\nmodel: claude-fable-5\n---\nbody\n");
    const roster = loadRoster(dir);
    expect([...roster.keys()].sort()).toEqual(["explorer", "fable-planner", "ghost"]);
    expect(roster.get("explorer")?.model).toBe("claude-sonnet-5");
    // Named in the manifest but not on disk: no model, so decide() denies it.
    expect(roster.get("ghost")?.model).toBeUndefined();
    expect(decide({ tool_name: "Agent", tool_input: { subagent_type: "ghost" } }, roster).allow).toBe(false);
    expect(decide({ tool_name: "Agent", tool_input: { subagent_type: "explorer" } }, roster).allow).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRoster with no manifest is empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "subguard-empty-"));
  try {
    expect(loadRoster(dir).size).toBe(0);
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
  // Re-running after a path change replaces rather than duplicates.
  const moved = mergeSettings(once, "/other/subagent-guard.ts");
  expect(moved.hooks.PreToolUse.filter((e: any) => e.hooks[0].command.includes(MARKER))).toHaveLength(1);
});

test("mergeSettings --uninstall removes only our entry", () => {
  const other = { matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] };
  const installed = mergeSettings({ hooks: { PreToolUse: [other] } }, "/c/g.ts");
  expect(mergeSettings(installed, "", true)).toEqual({ hooks: { PreToolUse: [other] } });
  // Removing the last PreToolUse entry drops the empty key rather than leaving [].
  const alone = mergeSettings({}, "/c/g.ts");
  expect(mergeSettings(alone, "", true)).toEqual({});
});

test("the hook binary denies a general-purpose spawn and stays silent on a worker", () => {
  const dir = mkdtempSync(join(tmpdir(), "subguard-e2e-"));
  try {
    mkdirSync(join(dir, "agents"));
    writeFileSync(join(dir, MANIFEST), "explorer\ncoder\n");
    for (const a of ["explorer", "coder"])
      writeFileSync(join(dir, "agents", `${a}.md`), `---\nname: ${a}\nmodel: claude-sonnet-5\n---\nbody\n`);
    const run = (tool_input: Record<string, unknown>) =>
      spawnSync("bun", [join(import.meta.dir, "scripts", "subagent-guard.ts")], {
        input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input }),
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
