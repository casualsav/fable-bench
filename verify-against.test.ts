// verify-against.test.ts — red-first tests for scripts/verify-against.ts.
//
// E2E half: a real throwaway git repo with a mini bun suite — one test red at the
// ref AND now (PRE-EXISTING), one green at the ref and broken in the working tree
// (NEW), one test file added after the ref (NEW, file absent at ref). The script
// runs for real: real bun, real git worktree.
//
// Known-answer control (fleet doctrine): the classifier is fed a ref reading that
// FAILED — it must come out UNCLASSIFIABLE, never NEW. A broken build that folded
// instrument errors into NEW would pass the e2e on this fixture; this control is
// what catches it.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyFailure, parseJunit } from "./scripts/verify-against.ts";

const SCRIPT = join(import.meta.dir, "scripts", "verify-against.ts");

let repo: string;

function sh(cwd: string, cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} → ${r.status}\n${r.stderr}`);
  return r.stdout;
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "verify-against-fixture-"));
  sh(repo, "git", ["init", "-q"]);
  sh(repo, "git", ["config", "user.email", "fixture@test"]);
  sh(repo, "git", ["config", "user.name", "fixture"]);
  writeFileSync(
    join(repo, "math.test.ts"),
    `import { test, expect } from "bun:test";
test("stays red", () => { expect(1).toBe(2); });
test("flips", () => { expect(2 + 2).toBe(${"4"}); });
`,
  );
  sh(repo, "git", ["add", "math.test.ts"]);
  sh(repo, "git", ["commit", "-qm", "ref state: stays-red is red, flips is green"]);
  // Working-tree changes after the ref: break "flips", add a new failing file.
  writeFileSync(
    join(repo, "math.test.ts"),
    `import { test, expect } from "bun:test";
test("stays red", () => { expect(1).toBe(2); });
test("flips", () => { expect(2 + 2).toBe(5); });
`,
  );
  writeFileSync(
    join(repo, "added.test.ts"),
    `import { test, expect } from "bun:test";
test("born failing", () => { expect(true).toBe(false); });
`,
  );
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

function runScript(args: string[], cwd: string) {
  return spawnSync("bun", [SCRIPT, ...args], { cwd, encoding: "utf8" });
}

test("e2e: classifies NEW vs PRE-EXISTING vs file-absent against a real ref", () => {
  const r = runScript(["--against", "HEAD", "--", "bun", "test"], repo);
  const out = r.stdout + r.stderr;
  expect(out).toContain("PRE-EXISTING math.test.ts :: stays red");
  expect(out).toContain("NEW          math.test.ts :: flips");
  expect(out).toMatch(/NEW \(file absent at HEAD\)\s+added\.test\.ts :: born failing/);
  // New failures exist, no instrument errors → exit 1.
  expect(r.status).toBe(1);
}, 60_000);

test("e2e: per-failure rerun lines carry the exact single-file invocation", () => {
  const r = runScript(["--against", "HEAD", "--", "bun", "test"], repo);
  const out = r.stdout + r.stderr;
  expect(out).toContain('rerun: bun test math.test.ts -t "flips"');
  expect(out).toContain('rerun: bun test math.test.ts -t "stays red"');
  expect(out).toContain('rerun: bun test added.test.ts -t "born failing"');
}, 60_000);

test("e2e: MEASURED provenance lines name command, cwd, sha, and the junit file read", () => {
  const r = runScript(["--against", "HEAD", "--", "bun", "test"], repo);
  const out = r.stdout + r.stderr;
  const sha = sh(repo, "git", ["rev-parse", "--short", "HEAD"]).trim();
  const measured = out.split("\n").filter((l) => l.startsWith("MEASURED:"));
  expect(measured.length).toBeGreaterThanOrEqual(2); // current tree + at least one ref run
  expect(measured[0]).toContain("`bun test`");
  expect(measured[0]).toContain(repo);
  expect(measured[0]).toContain("junit ");
  expect(out).toContain(sha);
  expect(out).toMatch(/SUMMARY: 2 new · 1 pre-existing · 0 unclassifiable/);
}, 60_000);

test("e2e: unresolvable ref is an instrument error — exit 2, nothing classified", () => {
  const r = runScript(["--against", "no-such-ref-xyzzy", "--", "bun", "test"], repo);
  expect(r.status).toBe(2);
  const out = r.stdout + r.stderr;
  expect(out).toContain("instrument error");
  expect(out).not.toContain("PRE-EXISTING");
}, 60_000);

// ---- known-answer controls on the classifier itself ----

const CUR_FAIL = { file: "a.test.ts", name: "t1", failed: true };

test("control: a FAILED ref reading is UNCLASSIFIABLE, never NEW", () => {
  const v = classifyFailure(CUR_FAIL, { ok: false as const });
  expect(v.kind).toBe("unclassifiable");
});

test("control: ref shows the same test red → pre-existing; green → new", () => {
  const red = new Map([["a.test.ts :: t1", { file: "a.test.ts", name: "t1", failed: true }]]);
  const green = new Map([["a.test.ts :: t1", { file: "a.test.ts", name: "t1", failed: false }]]);
  expect(classifyFailure(CUR_FAIL, { ok: true, cases: red }).kind).toBe("pre-existing");
  expect(classifyFailure(CUR_FAIL, { ok: true, cases: green }).kind).toBe("new");
});

test("control: test present nowhere in the ref junit → new (test absent)", () => {
  const other = new Map([["a.test.ts :: other", { file: "a.test.ts", name: "other", failed: false }]]);
  expect(classifyFailure(CUR_FAIL, { ok: true, cases: other }).kind).toBe("new-test-absent");
});

test("parseJunit reads bun's real format, nested describes and entities included", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" failures="2">
  <testsuite name="s.test.ts" file="s.test.ts">
    <testcase name="adds" classname="" file="s.test.ts" line="2" />
    <testcase name="fails &quot;here&quot;" classname="" file="s.test.ts" line="3">
      <failure type="AssertionError" />
    </testcase>
    <testsuite name="grp" file="s.test.ts">
      <testcase name="nested fail" classname="grp" file="s.test.ts" line="4">
        <failure type="AssertionError" />
      </testcase>
    </testsuite>
  </testsuite>
</testsuites>`;
  const cases = parseJunit(xml);
  expect(cases.get("s.test.ts :: adds")?.failed).toBe(false);
  expect(cases.get('s.test.ts :: fails "here"')?.failed).toBe(true);
  expect(cases.get("s.test.ts :: grp > nested fail")?.failed).toBe(true);
});
