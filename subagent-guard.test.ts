// subagent-guard.test.ts — the decision rule of the PreToolUse guard on the
// Agent tool, plus the settings.json merge that installs it.
//
// The hazard the owner named (2026-09-20): an Agent call that pins no model
// inherits the PARENT session's model, so a Fable-led session spawning
// `general-purpose` ran the fan-out at Fable rates. install.sh now sets a
// box-wide fallback (CLAUDE_CODE_SUBAGENT_MODEL=opus), so such a spawn lands
// on Opus instead; the guard is what holds when that default is missing, and
// what refuses Fable outright.
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decide, loadRoster, parentModel, frontmatterModel, denyPayload, noticePayload, MANIFEST,
  type Roster, type Parent,
} from "./scripts/subagent-guard.ts";
import {
  mergeSettings, guardEntry, MARKER, SUBAGENT_MODEL_KEY, SUBAGENT_MODEL,
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
const INHERITING = ["general-purpose", "fork", "Explore", "Plan", "claude", "claude-code-guide", "unpinned"];

const call = (tool_input: Record<string, unknown>, parent: Parent, subagentDefault = "opus", tool_name = "Agent") =>
  decide({ tool_name, tool_input }, ROSTER, parent, subagentDefault);

// ---- with the Opus fallback installed (the shipped state) ---------------------

test("a Fable parent may spawn an unnamed subagent — it lands on the Opus fallback", () => {
  for (const t of INHERITING) expect(call({ subagent_type: t, prompt: "go" }, "fable").allow).toBe(true);
  expect(call({ prompt: "go" }, "fable").allow).toBe(true);
});

test("a Fable parent is told, without being blocked, to prefer a defined worker", () => {
  const d = call({ subagent_type: "general-purpose" }, "fable");
  expect(d.allow).toBe(true);
  expect(d.allow && d.notice).toContain("runs on opus");
  expect(d.allow && d.notice).toContain("researcher");
});

test("a below-Fable parent gets no notice — preferring the workers is a Fable-lead rule", () => {
  for (const parent of ["safe", "unknown"] as Parent[])
    expect(call({ subagent_type: "general-purpose" }, parent).allow && call({ subagent_type: "general-purpose" }, parent).notice).toBeUndefined();
});

test("a Fable parent still may not spawn fable-planner — it is pinned to Fable and is already the planner", () => {
  const d = call({ subagent_type: "fable-planner", prompt: "plan" }, "fable");
  expect(d.allow).toBe(false);
  expect(!d.allow && d.reason).toContain("already the planner");
});

test("a below-Fable parent may spawn fable-planner — that is what /fable is", () => {
  for (const parent of ["safe", "unknown"] as Parent[])
    expect(call({ subagent_type: "fable-planner", prompt: "plan" }, parent).allow).toBe(true);
});

test("every worker pinned to a non-Fable model is allowed under every parent", () => {
  for (const parent of PARENTS)
    for (const t of ["coder", "explorer", "researcher", "engineer", "verifier", "broker-verifier"])
      expect(call({ subagent_type: t, prompt: "go" }, parent).allow).toBe(true);
});

test("the bridge's own `assistant` agent is never denied", () => {
  for (const parent of PARENTS)
    for (const def of ["opus", ""])
      expect(call({ subagent_type: "assistant", prompt: "look" }, parent, def).allow).toBe(true);
});

// ---- when the fallback is missing, the old inheritance hazard is back ---------

test("without the fallback a Fable parent may not spawn anything that would inherit", () => {
  for (const t of INHERITING) {
    const d = call({ subagent_type: t, prompt: "go" }, "fable", "");
    expect(d.allow).toBe(false);
    expect(!d.allow && d.reason).toContain("no CLAUDE_CODE_SUBAGENT_MODEL default");
    expect(!d.allow && d.reason).toContain("install.sh");
  }
});

test("without the fallback an unreadable parent fails closed, and the denial says so", () => {
  const d = call({ subagent_type: "general-purpose" }, "unknown", "");
  expect(d.allow).toBe(false);
  expect(!d.allow && d.reason).toContain("could not be read");
});

test("without the fallback a provably non-Fable parent is still fine — it inherits Sonnet or Opus", () => {
  for (const t of INHERITING) expect(call({ subagent_type: t, prompt: "go" }, "safe", "").allow).toBe(true);
  expect(call({ prompt: "go" }, "safe", "").allow).toBe(true);
});

test("a fallback that itself names Fable is refused under every parent", () => {
  for (const parent of PARENTS) {
    const d = call({ subagent_type: "general-purpose" }, parent, "fable");
    expect(d.allow).toBe(false);
    expect(!d.allow && d.reason).toContain("no subagent runs on Fable");
  }
});

// ---- the model parameter ------------------------------------------------------

test("a Fable model is denied under every parent, however it is spelled", () => {
  for (const model of ["fable", "claude-fable-5-1", "Mythos", "claude-fable-5"])
    for (const parent of PARENTS) {
      const d = call({ subagent_type: "explorer", model }, parent);
      expect(d.allow).toBe(false);
      expect(!d.allow && d.reason).toContain("Fable-tier");
    }
});

test("an explicit non-Fable model is always allowed — it pins, so it cannot inherit", () => {
  expect(call({ subagent_type: "general-purpose", model: "sonnet" }, "fable", "").allow).toBe(true);
  expect(call({ subagent_type: "explorer", model: "opus" }, "fable", "").allow).toBe(true);
  expect(call({ model: "sonnet", prompt: "go" }, "fable", "").allow).toBe(true);
});

// ---- plumbing -----------------------------------------------------------------

test("the legacy `Task` tool name is guarded too, and other tools are not", () => {
  expect(call({ subagent_type: "general-purpose" }, "fable", "", "Task").allow).toBe(false);
  expect(call({ command: "ls" }, "fable", "", "Bash").allow).toBe(true);
});

test("the payloads are the documented PreToolUse forms", () => {
  expect(JSON.parse(denyPayload("nope"))).toEqual({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "nope" },
  });
  // No permissionDecision: the call proceeds and the session just reads this.
  expect(JSON.parse(noticePayload("fyi"))).toEqual({
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "fyi" },
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
    expect(decide({ tool_name: "Agent", tool_input: { subagent_type: "assistant" } }, roster, "fable", "").allow).toBe(true);
    expect(decide({ tool_name: "Agent", tool_input: { subagent_type: "unpinned" } }, roster, "fable", "").allow).toBe(false);
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

test("the hook binary reads the fallback out of its own environment", () => {
  const dir = mkdtempSync(join(tmpdir(), "subguard-e2e-"));
  try {
    mkdirSync(join(dir, "agents"));
    writeFileSync(join(dir, MANIFEST), "explorer\ncoder\n");
    for (const a of ["explorer", "coder"])
      writeFileSync(join(dir, "agents", `${a}.md`), `---\nname: ${a}\nmodel: claude-sonnet-5\n---\nbody\n`);
    const transcript = join(dir, "t.jsonl");
    writeFileSync(transcript, JSON.stringify({ type: "assistant", message: { model: "claude-fable-5-1" } }) + "\n");
    const run = (tool_input: Record<string, unknown>, fallback?: string) => {
      const env: Record<string, string> = { ...process.env, CLAUDE_CONFIG_DIR: dir };
      if (fallback === undefined) delete env[SUBAGENT_MODEL_KEY];
      else env[SUBAGENT_MODEL_KEY] = fallback;
      return spawnSync("bun", [join(import.meta.dir, "scripts", "subagent-guard.ts")], {
        input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input, transcript_path: transcript }),
        env,
        encoding: "utf8",
      });
    };

    // Fable parent, fallback installed: allowed, with the prefer-a-worker notice.
    const noticed = run({ subagent_type: "general-purpose", prompt: "go" }, "opus");
    expect(noticed.status).toBe(0);
    expect(JSON.parse(noticed.stdout).hookSpecificOutput.additionalContext).toContain("runs on opus");
    expect(JSON.parse(noticed.stdout).hookSpecificOutput.permissionDecision).toBeUndefined();

    // Same call with the fallback missing: denied.
    const denied = run({ subagent_type: "general-purpose", prompt: "go" });
    expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecisionReason).toContain("explorer");

    // "inherit" is the CLI's own word for no default, so it is not a fallback.
    expect(JSON.parse(run({ subagent_type: "general-purpose" }, "inherit").stdout).hookSpecificOutput.permissionDecision).toBe("deny");

    const allowed = run({ subagent_type: "coder", prompt: "fix" }, "opus");
    expect(allowed.status).toBe(0);
    expect(allowed.stdout.trim()).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the settings.json merge --------------------------------------------------

test("mergeSettings adds the guard and the fallback without disturbing anything else", () => {
  const other = { matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] };
  const before = { model: "haiku", env: { TELEGRAM_PORT: "8795" }, hooks: { PreToolUse: [other], Stop: [{ hooks: [] }] } };
  const once = mergeSettings(before, "/c/scripts/subagent-guard.ts");
  expect(once.hooks.PreToolUse).toEqual([other, guardEntry("/c/scripts/subagent-guard.ts")]);
  expect(once.hooks.Stop).toEqual(before.hooks.Stop);
  expect(once.env).toEqual({ TELEGRAM_PORT: "8795", [SUBAGENT_MODEL_KEY]: SUBAGENT_MODEL });
  expect(once.model).toBe("haiku");
  expect(mergeSettings(once, "/c/scripts/subagent-guard.ts")).toEqual(once);
  const moved = mergeSettings(once, "/other/subagent-guard.ts");
  expect(moved.hooks.PreToolUse.filter((e: any) => e.hooks[0].command.includes(MARKER))).toHaveLength(1);
});

test("mergeSettings creates the env block when the file has none", () => {
  const fresh = mergeSettings({}, "/c/g.ts");
  expect(fresh.env).toEqual({ [SUBAGENT_MODEL_KEY]: SUBAGENT_MODEL });
});

test("the fallback is the plain default and never the forcing variant", () => {
  const merged = mergeSettings({}, "/c/g.ts");
  expect(SUBAGENT_MODEL).toBe("opus");
  expect(Object.keys(merged.env)).toEqual([SUBAGENT_MODEL_KEY]);
  // A forcing default would override each agent's own frontmatter model.
  const sources = ["install.sh", "uninstall.sh", "scripts/subagent-guard.ts", "scripts/install-subagent-guard.ts"]
    .map((f) => readFileSync(join(import.meta.dir, f), "utf8"))
    .join("\n");
  expect(sources).not.toContain(`${SUBAGENT_MODEL_KEY}_FORCE`);
});

test("mergeSettings --uninstall removes only what we installed", () => {
  const other = { matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] };
  const original = { env: { TELEGRAM_PORT: "8795" }, hooks: { PreToolUse: [other] } };
  expect(mergeSettings(mergeSettings(original, "/c/g.ts"), "", true)).toEqual(original);
  // Nothing of ours left behind: no empty env or hooks keys.
  expect(mergeSettings(mergeSettings({}, "/c/g.ts"), "", true)).toEqual({});
  // A default somebody else set by hand is not ours to remove.
  const handSet = { env: { [SUBAGENT_MODEL_KEY]: "haiku" } };
  expect(mergeSettings(handSet, "", true)).toEqual(handSet);
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
    writeFileSync(file, JSON.stringify(original, null, 2));
    const run = (...args: string[]) => spawnSync("bun", [script, file, ...args], { encoding: "utf8" });
    const read = () => JSON.parse(readFileSync(file, "utf8"));

    expect(run("/c/g.ts").status).toBe(0);
    expect(read().hooks.PreToolUse).toHaveLength(2);
    expect(read().env[SUBAGENT_MODEL_KEY]).toBe(SUBAGENT_MODEL);
    expect(run("/c/g.ts").status).toBe(0);
    expect(read().hooks.PreToolUse).toHaveLength(2);
    expect(run("--uninstall").status).toBe(0);
    expect(read()).toEqual(original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
