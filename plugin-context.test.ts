// plugin-context.test.ts — the SessionStart hook a /plugin install runs, and
// the manifests that make the repo a plugin at all.
//
// A plugin cannot ship a CLAUDE.md (measured 2026-11-15 on 2.1.325), so the
// lead-mode block reaches the session as SessionStart `additionalContext`
// instead, behind a paragraph telling the model that the kit's agents and
// skills answer only to their "<prefix>:" names.
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginContext } from "./scripts/plugin-context.ts";

const SCRIPT = join(import.meta.dir, "scripts", "plugin-context.ts");
const LEAD = "# lead mode\nOnly when Fable.\nRead `@CONFIG_DIR@/skills/fable/LEAD.md` and follow it.\nAlso @CONFIG_DIR@.\n";

/** A throwaway plugin root; `dirPrefix` lets a test put awkward characters in the path. */
function fixture(name: string | undefined, dirPrefix = "pctx-") {
  const root = mkdtempSync(join(tmpdir(), dirPrefix));
  if (name !== undefined) {
    mkdirSync(join(root, ".claude-plugin"));
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name }));
  }
  writeFileSync(join(root, "CLAUDE-fable-bench.md"), LEAD);
  return root;
}

const run = (env: Record<string, string | undefined>) => {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...env })) if (v !== undefined) e[k] = v;
  return spawnSync("bun", [SCRIPT], { input: "", env: e, encoding: "utf8" });
};

test("the context is two paragraphs: the prefix notice, then the lead block rooted at the plugin", () => {
  const root = fixture("probe-kit");
  try {
    const paras = pluginContext(root).split("\n\n");
    expect(paras).toHaveLength(2);
    // The prefix comes from plugin.json, not from the directory or a constant.
    expect(paras[0]).toContain("probe-kit:coder");
    expect(paras[0]).toContain("/probe-kit:fable");
    expect(paras[0]).toContain(root);
    expect(paras[0]).not.toContain("fable-bench");
    expect(paras[1]).toBe(LEAD.trimEnd().replaceAll("@CONFIG_DIR@", root));
    expect(paras[1]).not.toContain("@CONFIG_DIR@");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a root containing replacement-pattern characters is inserted literally", () => {
  const root = fixture("probe-kit", "pctx-$&-$1-");
  try {
    const ctx = pluginContext(root);
    expect(ctx).toContain(`${root}/skills/fable/LEAD.md`);
    expect(ctx).not.toContain("@CONFIG_DIR@");
    expect(ctx.split(root).length - 1).toBe(4); // twice in the notice, twice in the block
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pluginContext throws when the plugin cannot be read", () => {
  const bare = fixture(undefined);
  const nameless = fixture("");
  try {
    expect(() => pluginContext(bare)).toThrow();
    expect(() => pluginContext(nameless)).toThrow();
  } finally {
    rmSync(bare, { recursive: true, force: true });
    rmSync(nameless, { recursive: true, force: true });
  }
});

test("the hook binary prints SessionStart additionalContext for CLAUDE_PLUGIN_ROOT", () => {
  const root = fixture("probe-kit");
  try {
    const r = run({ CLAUDE_PLUGIN_ROOT: root });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    expect(out.hookEventName).toBe("SessionStart");
    expect(out.additionalContext).toBe(pluginContext(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the hook binary prints nothing and exits 0 when the plugin cannot be read", () => {
  const bare = fixture(undefined);
  const badJson = fixture(undefined);
  mkdirSync(join(badJson, ".claude-plugin"));
  writeFileSync(join(badJson, ".claude-plugin", "plugin.json"), "{ not json");
  const noLead = fixture("probe-kit");
  rmSync(join(noLead, "CLAUDE-fable-bench.md"));
  try {
    for (const root of [bare, badJson, noLead, join(bare, "missing")]) {
      const r = run({ CLAUDE_PLUGIN_ROOT: root });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
    }
  } finally {
    for (const d of [bare, badJson, noLead]) rmSync(d, { recursive: true, force: true });
  }
});

test("without CLAUDE_PLUGIN_ROOT the hook binary roots itself at its own parent dir", () => {
  const r = run({ CLAUDE_PLUGIN_ROOT: undefined });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toBe(pluginContext(import.meta.dir));
});

// ---- the real repo is a loadable plugin ---------------------------------------

test("the repo is a plugin: hooks.json points at scripts that exist, and the manifests agree", () => {
  const read = (p: string) => JSON.parse(readFileSync(join(import.meta.dir, p), "utf8"));
  const hooks = read("hooks/hooks.json").hooks;
  const commands: string[] = Object.values(hooks).flatMap((entries: any) =>
    entries.flatMap((e: any) => e.hooks.map((h: any) => h.command)));
  expect(commands.length).toBeGreaterThanOrEqual(2);
  for (const c of commands) {
    const m = c.match(/"\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s"]+)"/);
    expect(m).not.toBeNull();
    expect(existsSync(join(import.meta.dir, m![1]!))).toBe(true);
  }
  expect(hooks.SessionStart).toBeDefined();
  expect(hooks.PreToolUse[0].matcher).toBe("Agent|Task");

  const plugin = read(".claude-plugin/plugin.json");
  const market = read(".claude-plugin/marketplace.json");
  expect(market.plugins).toHaveLength(1);
  expect(market.plugins[0].name).toBe(plugin.name);
  expect(market.plugins[0].source).toBe("./");
  // No version anywhere: each commit is its own version.
  expect(plugin.version).toBeUndefined();
  expect(market.plugins[0].version).toBeUndefined();
});
