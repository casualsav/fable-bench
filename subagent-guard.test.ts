// subagent-guard.test.ts — the decision rule of the PreToolUse guard on the
// Agent tool, plus the settings.json merge that installs it.
//
// The hazard the owner named (2026-09-20): an Agent call that pins no model
// inherits the PARENT session's model, so a Fable-led session spawning
// `general-purpose` ran the fan-out at Fable rates. The fix applies to
// Fable-led sessions ONLY, so it lives in the hook rather than in a box-wide
// setting: under a Fable parent the guard rewrites the call to `model: opus`;
// a Sonnet- or Opus-led parent passes through untouched.
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decide, loadRoster, parentModel, frontmatterModel, denyPayload, allowPayload,
  MANIFEST, FALLBACK_MODEL, type Roster, type Parent,
} from "./scripts/subagent-guard.ts";
import {
  mergeSettings, guardEntry, MARKER, STALE_ENV_KEY, STALE_ENV_VALUE,
} from "./scripts/install-subagent-guard.ts";

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

const PARENTS: Parent[] = ["fable", "safe", "unknown"];
// `fork` is not here: it always runs on the session's own model, so it has
// its own rule (see "the fork" below).
const INHERITING = ["general-purpose", "Explore", "Plan", "claude", "claude-code-guide", "unpinned"];

const call = (tool_input: Record<string, unknown>, parent: Parent, tool_name = "Agent") =>
  decide({ tool_name, tool_input }, ROSTER, parent);

// ---- under a Fable-led parent: rewritten, not blocked ------------------------

test("a Fable parent's inheriting spawn is rewritten to the Opus fallback", () => {
  for (const t of INHERITING) {
    const d = call({ subagent_type: t, prompt: "go" }, "fable");
    expect(d.allow).toBe(true);
    expect(d.allow && d.updatedInput).toEqual({ subagent_type: t, prompt: "go", model: FALLBACK_MODEL });
  }
});

test("the rewrite keeps the rest of the tool input intact", () => {
  const d = call({ subagent_type: "general-purpose", prompt: "go", description: "d", run_in_background: true }, "fable");
  expect(d.allow && d.updatedInput).toEqual({
    subagent_type: "general-purpose", prompt: "go", description: "d", run_in_background: true, model: FALLBACK_MODEL,
  });
});

test("the rewritten call carries a notice naming the defined workers", () => {
  const d = call({ subagent_type: "general-purpose" }, "fable");
  expect(d.allow && d.notice).toContain(`pinned this spawn to ${FALLBACK_MODEL}`);
  expect(d.allow && d.notice).toContain("researcher");
});

test("a Fable parent still may not spawn fable-planner — its frontmatter pin beats any rewrite", () => {
  const d = call({ subagent_type: "fable-planner", prompt: "plan" }, "fable");
  expect(d.allow).toBe(false);
  expect(!d.allow && d.reason).toContain("already the planner");
});

test("a Fable parent's defined workers are passed through untouched", () => {
  for (const t of ["coder", "explorer", "researcher", "engineer", "verifier", "broker-verifier", "assistant"])
    expect(call({ subagent_type: t, prompt: "go" }, "fable")).toEqual({ allow: true });
});

// ---- under a below-Fable parent: nothing happens at all ----------------------

test("a proven non-Fable parent is never rewritten and never nudged", () => {
  for (const t of [...INHERITING, "fork", "coder", "assistant", "fable-planner"])
    expect(call({ subagent_type: t, prompt: "go" }, "safe")).toEqual({ allow: true });
  expect(call({ prompt: "go" }, "safe")).toEqual({ allow: true });
});

test("the bridge's own `assistant` agent is never denied and never rewritten", () => {
  for (const parent of PARENTS) expect(call({ subagent_type: "assistant", prompt: "look" }, parent)).toEqual({ allow: true });
});

// ---- when the parent cannot be read ------------------------------------------

test("an unreadable parent fails closed — rewritten, never left to inherit", () => {
  const d = call({ subagent_type: "general-purpose" }, "unknown");
  expect(d.allow).toBe(true);
  expect(d.allow && d.updatedInput?.model).toBe(FALLBACK_MODEL);
  expect(d.allow && d.notice).toContain("could not be read");
});

test("failing closed does not block fable-planner — only a proven Fable parent does", () => {
  expect(call({ subagent_type: "fable-planner" }, "unknown")).toEqual({ allow: true });
});

// ---- the model parameter ------------------------------------------------------

test("a Fable model is denied under every parent, however it is spelled", () => {
  for (const model of ["fable", "claude-fable-5-1", "Mythos", "claude-fable-5"])
    for (const parent of PARENTS) {
      const d = call({ subagent_type: "explorer", model }, parent);
      expect(d.allow).toBe(false);
      expect(!d.allow && d.reason).toContain(`model: ${FALLBACK_MODEL}`);
    }
});

test("an explicit non-Fable model is always allowed untouched — it pins, so it cannot inherit", () => {
  expect(call({ subagent_type: "general-purpose", model: "sonnet" }, "fable")).toEqual({ allow: true });
  expect(call({ subagent_type: "explorer", model: "opus" }, "fable")).toEqual({ allow: true });
  expect(call({ model: "sonnet", prompt: "go" }, "fable")).toEqual({ allow: true });
});

// ---- the fork -----------------------------------------------------------------
// The Agent tool documents (2.1.325) that a fork always runs on the session's
// own model and ignores a model override, so neither the rewrite nor an
// explicit model can keep it off Fable.

test("a Fable parent may not fork, whatever model the call carries", () => {
  for (const model of [undefined, "opus", "sonnet", "haiku"]) {
    const d = call({ subagent_type: "fork", prompt: "go", ...(model && { model }) }, "fable");
    expect(d.allow).toBe(false);
    expect(!d.allow && d.reason).toContain("ignores a model override");
    expect(!d.allow && d.reason).toContain("researcher");
  }
});

test("a fork asking for a Fable model keeps the Fable-model denial", () => {
  for (const parent of PARENTS) {
    const d = call({ subagent_type: "fork", model: "fable" }, parent);
    expect(d.allow).toBe(false);
    expect(!d.allow && d.reason).toContain(`model: ${FALLBACK_MODEL}`);
  }
});

test("a fork under a below-Fable or unreadable parent is allowed untouched — it cannot be pinned", () => {
  for (const parent of ["safe", "unknown"] as Parent[])
    for (const model of [undefined, "opus"])
      expect(call({ subagent_type: "fork", prompt: "go", ...(model && { model }) }, parent)).toEqual({ allow: true });
});

// ---- plumbing -----------------------------------------------------------------

test("the legacy `Task` tool name is guarded too, and other tools are not", () => {
  expect(call({ subagent_type: "general-purpose" }, "fable", "Task").allow).toBe(true);
  expect(call({ subagent_type: "general-purpose" }, "fable", "Task").allow && call({ subagent_type: "general-purpose" }, "fable", "Task").updatedInput?.model).toBe(FALLBACK_MODEL);
  expect(call({ command: "ls" }, "fable", "Bash")).toEqual({ allow: true });
});

test("the payloads are the documented PreToolUse forms", () => {
  expect(JSON.parse(denyPayload("nope"))).toEqual({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "nope" },
  });
  // No permissionDecision: the call proceeds, with a new input and a line to read.
  expect(JSON.parse(allowPayload({ updatedInput: { model: "opus" }, notice: "fyi" }))).toEqual({
    hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { model: "opus" }, additionalContext: "fyi" },
  });
});

test("frontmatterModel reads only a leading --- block", () => {
  expect(frontmatterModel("---\nname: x\nmodel: claude-sonnet-5\n---\nbody\n")).toBe("claude-sonnet-5");
  expect(frontmatterModel("---\nname: x\n---\nmodel: claude-sonnet-5\n")).toBeUndefined();
  expect(frontmatterModel("no frontmatter\n")).toBeUndefined();
  expect(frontmatterModel('---\nmodel: "haiku"\n---\n')).toBe("haiku");
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
    expect(decide({ tool_name: "Agent", tool_input: { subagent_type: "assistant" } }, roster, "fable")).toEqual({ allow: true });
    const d = decide({ tool_name: "Agent", tool_input: { subagent_type: "unpinned" } }, roster, "fable");
    expect(d.allow && d.updatedInput?.model).toBe(FALLBACK_MODEL);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRoster keys an agent by its frontmatter name, falling back to the filename", () => {
  const dir = mkdtempSync(join(tmpdir(), "subguard-names-"));
  try {
    mkdirSync(join(dir, "agents"));
    writeFileSync(join(dir, "agents", "file-name.md"), "---\nname: real-name\nmodel: haiku\n---\nbody\n");
    writeFileSync(join(dir, "agents", "nameless.md"), "---\nmodel: sonnet\n---\nbody\n");
    writeFileSync(join(dir, MANIFEST), "real-name\n");
    const roster = loadRoster(dir);
    expect([...roster.keys()].sort()).toEqual(["nameless", "real-name"]);
    expect(roster.get("real-name")).toEqual({ model: "haiku", fableBench: true });
    expect(roster.get("nameless")).toEqual({ model: "sonnet" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRoster reads the project's agents, which replace user agents of the same name", () => {
  const home = mkdtempSync(join(tmpdir(), "subguard-project-"));
  const claudeDir = join(home, ".claude");
  const project = join(home, "proj");
  try {
    mkdirSync(join(claudeDir, "agents"), { recursive: true });
    mkdirSync(join(project, ".claude", "agents"), { recursive: true });
    const write = (dir: string, n: string, model?: string) =>
      writeFileSync(join(dir, "agents", `${n}.md`), `---\nname: ${n}\n${model ? `model: ${model}\n` : ""}---\nbody\n`);
    const projDir = join(project, ".claude");
    write(claudeDir, "explorer", "sonnet");
    write(claudeDir, "shadowed");
    write(claudeDir, "unpinned-by-project", "sonnet");
    write(claudeDir, "user-only", "opus");
    write(projDir, "shadowed", "haiku");
    write(projDir, "unpinned-by-project");
    write(projDir, "project-only", "haiku");
    write(projDir, "project-fable", "fable");
    writeFileSync(join(claudeDir, MANIFEST), "explorer\nshadowed\n");

    const roster = loadRoster(claudeDir, project);
    expect([...roster.keys()].sort()).toEqual(
      ["explorer", "project-fable", "project-only", "shadowed", "unpinned-by-project", "user-only"],
    );
    expect(roster.get("shadowed")).toEqual({ model: "haiku", fableBench: true });
    expect(roster.get("unpinned-by-project")?.model).toBeUndefined();
    expect(roster.get("user-only")).toEqual({ model: "opus" });

    // A project agent pinned below Fable is not silently upgraded to the fallback.
    const run = (t: string) => decide({ tool_name: "Agent", tool_input: { subagent_type: t } }, roster, "fable");
    expect(run("project-only")).toEqual({ allow: true });
    expect(run("shadowed")).toEqual({ allow: true });
    const unpinned = run("unpinned-by-project");
    expect(unpinned.allow && unpinned.updatedInput?.model).toBe(FALLBACK_MODEL);
    // A project agent pinned to Fable under a Fable parent is denied like any other.
    const fable = run("project-fable");
    expect(fable.allow).toBe(false);
    expect(!fable.allow && fable.reason).toContain("Fable-tier");

    // No project agents dir, or no cwd at all: the user roster alone.
    expect([...loadRoster(claudeDir, join(home, "nowhere")).keys()].sort()).toEqual(
      ["explorer", "shadowed", "unpinned-by-project", "user-only"],
    );
    expect(loadRoster(claudeDir).get("shadowed")?.model).toBeUndefined();
    // cwd whose .claude IS the config dir: the same dir read twice changes nothing.
    expect(loadRoster(claudeDir, home)).toEqual(loadRoster(claudeDir));
  } finally {
    rmSync(home, { recursive: true, force: true });
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

test("the hook binary rewrites under a Fable transcript and says nothing under a Sonnet one", () => {
  const dir = mkdtempSync(join(tmpdir(), "subguard-e2e-"));
  try {
    mkdirSync(join(dir, "agents"));
    writeFileSync(join(dir, MANIFEST), "explorer\ncoder\nfable-planner\n");
    for (const a of ["explorer", "coder"])
      writeFileSync(join(dir, "agents", `${a}.md`), `---\nname: ${a}\nmodel: claude-sonnet-5\n---\nbody\n`);
    writeFileSync(join(dir, "agents", "fable-planner.md"), "---\nname: fable-planner\nmodel: claude-fable-5\n---\nbody\n");
    const transcript = (name: string, model: string) => {
      const p = join(dir, name);
      writeFileSync(p, JSON.stringify({ type: "assistant", message: { model } }) + "\n");
      return p;
    };
    const fable = transcript("fable.jsonl", "claude-fable-5-1");
    const sonnet = transcript("sonnet.jsonl", "claude-sonnet-5");
    const run = (tool_input: Record<string, unknown>, transcript_path: string, cwd?: string) =>
      spawnSync("bun", [join(import.meta.dir, "scripts", "subagent-guard.ts")], {
        input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input, transcript_path, cwd }),
        env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
        encoding: "utf8",
      });

    const rewritten = run({ subagent_type: "general-purpose", prompt: "go" }, fable);
    expect(rewritten.status).toBe(0);
    const out = JSON.parse(rewritten.stdout).hookSpecificOutput;
    expect(out.updatedInput).toEqual({ subagent_type: "general-purpose", prompt: "go", model: FALLBACK_MODEL });
    expect(out.additionalContext).toContain("explorer");
    expect(out.permissionDecision).toBeUndefined();

    // Same call from a Sonnet-led session: nothing at all.
    expect(run({ subagent_type: "general-purpose", prompt: "go" }, sonnet).stdout.trim()).toBe("");
    expect(run({ subagent_type: "coder", prompt: "fix" }, fable).stdout.trim()).toBe("");

    const denied = run({ subagent_type: "fable-planner", prompt: "plan" }, fable);
    expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe("deny");

    // A fork runs on the session's model whatever it asks for.
    const fork = run({ subagent_type: "fork", model: "opus", prompt: "go" }, fable);
    expect(JSON.parse(fork.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(run({ subagent_type: "fork", model: "opus", prompt: "go" }, sonnet).stdout.trim()).toBe("");

    // A project agent's pin is read from the session's cwd and left alone.
    const project = join(dir, "proj");
    mkdirSync(join(project, ".claude", "agents"), { recursive: true });
    writeFileSync(join(project, ".claude", "agents", "lint.md"), "---\nname: lint\nmodel: haiku\n---\nbody\n");
    expect(run({ subagent_type: "lint", prompt: "go" }, fable, project).stdout.trim()).toBe("");
    expect(JSON.parse(run({ subagent_type: "lint", prompt: "go" }, fable).stdout).hookSpecificOutput.updatedInput.model)
      .toBe(FALLBACK_MODEL);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the settings.json merge --------------------------------------------------

test("mergeSettings adds the guard without disturbing other hooks, and is idempotent", () => {
  const other = { matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] };
  const before = { model: "haiku", env: { TELEGRAM_PORT: "8795" }, hooks: { PreToolUse: [other], Stop: [{ hooks: [] }] } };
  const once = mergeSettings(before, "/c/scripts/subagent-guard.ts");
  expect(once.hooks.PreToolUse).toEqual([other, guardEntry("/c/scripts/subagent-guard.ts")]);
  expect(once.hooks.Stop).toEqual(before.hooks.Stop);
  expect(once.env).toEqual({ TELEGRAM_PORT: "8795" });
  expect(once.model).toBe("haiku");
  expect(mergeSettings(once, "/c/scripts/subagent-guard.ts")).toEqual(once);
  const moved = mergeSettings(once, "/other/subagent-guard.ts");
  expect(moved.hooks.PreToolUse.filter((e: any) => e.hooks[0].command.includes(MARKER))).toHaveLength(1);
});

test("the guard writes no env at all, and clears the box-wide default it used to write", () => {
  // A settings.json with no env block stays that way.
  expect(mergeSettings({}, "/c/g.ts").env).toBeUndefined();
  // One an earlier install wrote is cleared, on install and on uninstall alike.
  const stale = { env: { TELEGRAM_PORT: "8795", [STALE_ENV_KEY]: STALE_ENV_VALUE } };
  expect(mergeSettings(stale, "/c/g.ts").env).toEqual({ TELEGRAM_PORT: "8795" });
  expect(mergeSettings(stale, "", true).env).toEqual({ TELEGRAM_PORT: "8795" });
  // The whole env block goes if that was all it held.
  expect(mergeSettings({ env: { [STALE_ENV_KEY]: STALE_ENV_VALUE } }, "/c/g.ts").env).toBeUndefined();
  // A default somebody else set by hand is not ours to remove.
  const handSet = { env: { [STALE_ENV_KEY]: "haiku" } };
  expect(mergeSettings(handSet, "/c/g.ts").env).toEqual({ [STALE_ENV_KEY]: "haiku" });
});

test("the sources never write an env default or the forcing variant", () => {
  const sources = ["install.sh", "uninstall.sh", "scripts/subagent-guard.ts"]
    .map((f) => readFileSync(join(import.meta.dir, f), "utf8"))
    .join("\n");
  expect(sources).not.toContain(STALE_ENV_KEY);
  expect(readFileSync(join(import.meta.dir, "scripts", "install-subagent-guard.ts"), "utf8"))
    .not.toContain(`${STALE_ENV_KEY}_FORCE`);
});

test("mergeSettings --uninstall removes only our entry", () => {
  const other = { matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] };
  const original = { env: { TELEGRAM_PORT: "8795" }, hooks: { PreToolUse: [other] } };
  expect(mergeSettings(mergeSettings(original, "/c/g.ts"), "", true)).toEqual(original);
  expect(mergeSettings(mergeSettings({}, "/c/g.ts"), "", true)).toEqual({});
});

test("the installer CLI installs, re-installs without duplicating, and uninstalls", () => {
  const dir = mkdtempSync(join(tmpdir(), "subguard-cli-"));
  const file = join(dir, "settings.json");
  const script = join(import.meta.dir, "scripts", "install-subagent-guard.ts");
  try {
    const original = {
      model: "haiku",
      env: { TELEGRAM_PORT: "8795" },
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rtk" }] }] },
    };
    writeFileSync(file, JSON.stringify({ ...original, env: { ...original.env, [STALE_ENV_KEY]: STALE_ENV_VALUE } }, null, 2));
    const run = (...args: string[]) => spawnSync("bun", [script, file, ...args], { encoding: "utf8" });
    const read = () => JSON.parse(readFileSync(file, "utf8"));

    expect(run("/c/g.ts").status).toBe(0);
    expect(read().hooks.PreToolUse).toHaveLength(2);
    // The stale box-wide default is gone; the other env key survives.
    expect(read().env).toEqual({ TELEGRAM_PORT: "8795" });
    expect(run("/c/g.ts").status).toBe(0);
    expect(read().hooks.PreToolUse).toHaveLength(2);
    expect(run("--uninstall").status).toBe(0);
    expect(read()).toEqual(original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
