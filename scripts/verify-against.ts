#!/usr/bin/env bun
// verify-against — the verifier's delta runner.
//
//   bun verify-against.ts --against <ref> [--full] [--no-install] -- <suite cmd…>
//
// Runs the suite in the current tree, then re-runs the FAILING files (default) or
// the whole suite (--full) in a detached git worktree at <ref>, and reports each
// current failure as NEW / PRE-EXISTING / NEW-because-absent-at-ref, with a
// provenance (MEASURED:) line per run and a per-failure rerun: invocation.
//
// Strictly descriptive: every verdict here is a diff of two measurements. An
// instrument failure (worktree, install, unreadable junit) is reported as an
// instrument failure and exits 2 — it is never folded into a classification.
// Exit codes: 0 no new failures · 1 new failures · 2 instrument error.
//
// Suite command must be `bun test`-shaped (junit comes from bun's own reporter);
// other runners are a later flag, not silently mis-driven.
//
// Canonical copy: fable-bench/scripts/verify-against.ts. Installed copy (the one
// agents run): ~/.claude/scripts/verify-against.ts — keep byte-identical.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

export interface CaseResult {
  file: string;
  name: string;
  failed: boolean;
}

export type RefReading =
  | { ok: true; cases: Map<string, CaseResult> }
  | { ok: false };

export type Verdict =
  | { kind: "new" }
  | { kind: "pre-existing" }
  | { kind: "new-test-absent" }
  | { kind: "new-file-absent" }
  | { kind: "unclassifiable" };

const unescapeXml = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

export function caseKey(c: { file: string; name: string; classname?: string }): string {
  const label = c.classname ? `${c.classname} > ${c.name}` : c.name;
  return `${c.file} :: ${label}`;
}

// Bun's junit: nested <testsuite> per describe, <testcase> self-closing on pass,
// wrapping a <failure>/<error> child on failure. Attributes carry name/classname/file.
export function parseJunit(xml: string): Map<string, CaseResult> {
  const cases = new Map<string, CaseResult>();
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = unescapeXml(a[2]);
    if (!attrs.name || !attrs.file) continue;
    const body = m[3] ?? "";
    const c: CaseResult = {
      file: attrs.file,
      name: attrs.classname ? `${attrs.classname} > ${attrs.name}` : attrs.name,
      failed: /<(failure|error)\b/.test(body),
    };
    cases.set(`${c.file} :: ${c.name}`, c);
  }
  return cases;
}

export function classifyFailure(cur: CaseResult, ref: RefReading): Verdict {
  if (!ref.ok) return { kind: "unclassifiable" };
  const key = `${cur.file} :: ${cur.name}`;
  const at = ref.cases.get(key);
  if (!at) return { kind: "new-test-absent" };
  return at.failed ? { kind: "pre-existing" } : { kind: "new" };
}

// ---------------- CLI half ----------------

interface Run {
  cmdShown: string;
  cwd: string;
  status: number | null;
  junitPath: string;
  junitOk: boolean;
  cases: Map<string, CaseResult>;
  finished: string;
}

function git(cwd: string, args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function treeStamp(cwd: string): string {
  const head = git(cwd, ["rev-parse", "--short", "HEAD"]);
  if (head.status !== 0) return "not a git repo";
  const dirty = git(cwd, ["status", "--porcelain"]).stdout.trim();
  const n = dirty ? dirty.split("\n").length : 0;
  return `HEAD ${head.stdout.trim()}${n ? ` (dirty: ${n} file${n === 1 ? "" : "s"})` : " (clean)"}`;
}

function runJunit(cmd: string[], cwd: string, junitPath: string): Run {
  const full = [...cmd, "--reporter=junit", `--reporter-outfile=${junitPath}`];
  const r = spawnSync(full[0], full.slice(1), { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const junitOk = existsSync(junitPath);
  return {
    cmdShown: cmd.join(" "),
    cwd,
    status: r.status,
    junitPath,
    junitOk,
    cases: junitOk ? parseJunit(readFileSync(junitPath, "utf8")) : new Map(),
    finished: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
}

function measuredLine(run: Run, treeLabel: string): string {
  const src = run.junitOk ? `counts read from junit ${run.junitPath}` : "junit MISSING — run unreadable";
  return `MEASURED: \`${run.cmdShown}\` · cwd ${run.cwd} · ${treeLabel} · ${src} · finished ${run.finished}`;
}

function rerunLine(cmd: string[], file: string, name: string): string {
  if (cmd[0] === "bun" && cmd.includes("test")) {
    // Rerun with the leaf test name — bun -t matches the test's own name.
    const leaf = name.includes(" > ") ? name.slice(name.lastIndexOf(" > ") + 3) : name;
    return `rerun: bun test ${file} -t "${leaf.replace(/"/g, '\\"')}"`;
  }
  return `rerun: unknown — suite invoked via \`${cmd.join(" ")}\``;
}

function fail2(msg: string): never {
  console.error(`instrument error: ${msg}`);
  process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf("--");
  if (sep < 0) fail2("usage: verify-against.ts --against <ref> [--full] [--no-install] -- <suite cmd…>");
  const opts = argv.slice(0, sep);
  const cmd = argv.slice(sep + 1);
  const againstIdx = opts.indexOf("--against");
  if (againstIdx < 0 || !opts[againstIdx + 1]) fail2("--against <ref> is required");
  const ref = opts[againstIdx + 1];
  const full = opts.includes("--full");
  const noInstall = opts.includes("--no-install");
  if (!(cmd[0] === "bun" && cmd.includes("test")))
    fail2(`suite command must be bun test-shaped (got \`${cmd.join(" ")}\`) — other runners are not driven yet`);

  const cwd = process.cwd();
  if (git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status !== 0)
    fail2(`ref '${ref}' does not resolve in ${cwd}`);

  const scratch = mkdtempSync(join(tmpdir(), "verify-against-"));
  const wtDir = join(scratch, "ref-tree");
  let wtAdded = false;
  try {
    // 1. Current tree, whole suite.
    const cur = runJunit(cmd, cwd, join(scratch, "current.xml"));
    console.log(measuredLine(cur, treeStamp(cwd)));
    if (!cur.junitOk) fail2("current-tree run produced no junit file");
    const failures = [...cur.cases.values()].filter((c) => c.failed);

    if (failures.length === 0 && !full) {
      console.log(`\nSUMMARY: 0 failures in current tree — nothing to compare against ${ref}`);
      process.exit(0);
    }

    // 2. Ref tree.
    const wt = git(cwd, ["worktree", "add", "--detach", wtDir, ref]);
    if (wt.status !== 0) fail2(`git worktree add failed: ${wt.stderr.trim()}`);
    wtAdded = true;
    const refSha = git(wtDir, ["rev-parse", "--short", "HEAD"]).stdout.trim();
    let installed = "no lockfile — skipped";
    if (!noInstall && existsSync(join(wtDir, "bun.lock"))) {
      const inst = spawnSync("bun", ["install", "--frozen-lockfile"], { cwd: wtDir, encoding: "utf8" });
      installed = inst.status === 0 ? "yes" : "FAILED (ref runs may be unreadable)";
    } else if (noInstall) installed = "skipped (--no-install)";
    console.log(`AGAINST ${ref} (${refSha}) · worktree ${wtDir} · installed deps: ${installed}`);

    // 3. Ref readings: whole suite once (--full), else per failing file.
    const refReadings = new Map<string, RefReading>(); // by current-tree file path
    const failingFiles = [...new Set(failures.map((f) => f.file))];
    if (full) {
      const run = runJunit(cmd, wtDir, join(scratch, "ref-full.xml"));
      console.log(measuredLine(run, `worktree @ ${refSha} (clean)`));
      const reading: RefReading = run.junitOk ? { ok: true, cases: run.cases } : { ok: false };
      for (const f of failingFiles) refReadings.set(f, reading);
      // --full extra: fixed-at-current.
      const fixed = [...run.cases.values()].filter((c) => c.failed && cur.cases.get(`${c.file} :: ${c.name}`)?.failed === false);
      for (const c of fixed) console.log(`FIXED        ${c.file} :: ${c.name} — at ${ref}(${refSha}): FAIL · here: PASS`);
    } else {
      for (const f of failingFiles) {
        const rel = isAbsolute(f) ? relative(cwd, f) : f;
        if (git(cwd, ["cat-file", "-e", `${ref}:${rel}`]).status !== 0) {
          refReadings.set(f, { ok: true, cases: new Map() }); // absent file: measured absence, not an error
          continue;
        }
        const run = runJunit([...cmd, rel], wtDir, join(scratch, `ref-${refReadings.size}.xml`));
        console.log(measuredLine(run, `worktree @ ${refSha} (clean)`));
        refReadings.set(f, run.junitOk ? { ok: true, cases: run.cases } : { ok: false });
      }
    }

    // 4. Classify and report.
    const fileAbsent = new Set(
      failingFiles.filter((f) => {
        const rel = isAbsolute(f) ? relative(cwd, f) : f;
        return git(cwd, ["cat-file", "-e", `${ref}:${rel}`]).status !== 0;
      }),
    );
    let nNew = 0, nPre = 0, nUncl = 0;
    console.log("");
    for (const f of failures) {
      const reading = refReadings.get(f.file) ?? { ok: false as const };
      const v = fileAbsent.has(f.file) ? ({ kind: "new-file-absent" } as Verdict) : classifyFailure(f, reading);
      let label: string, detail: string;
      switch (v.kind) {
        case "new": nNew++; label = "NEW         "; detail = `at ${ref}(${refSha}): PASS · here: FAIL`; break;
        case "pre-existing": nPre++; label = "PRE-EXISTING"; detail = `at ${ref}(${refSha}): FAIL · here: FAIL`; break;
        case "new-test-absent": nNew++; label = `NEW (test absent at ${ref})`; detail = `no such test at ${ref}(${refSha}) · here: FAIL`; break;
        case "new-file-absent": nNew++; label = `NEW (file absent at ${ref})`; detail = `file not at ${ref}(${refSha}) · here: FAIL`; break;
        case "unclassifiable": nUncl++; label = "UNCLASSIFIABLE"; detail = `ref reading failed — see MEASURED lines`; break;
      }
      console.log(`${label} ${f.file} :: ${f.name}`);
      console.log(`             ${detail}`);
      console.log(`             ${rerunLine(cmd, f.file, f.name)}`);
    }
    console.log(`\nSUMMARY: ${nNew} new · ${nPre} pre-existing · ${nUncl} unclassifiable`);
    process.exit(nUncl > 0 ? 2 : nNew > 0 ? 1 : 0);
  } finally {
    if (wtAdded) git(cwd, ["worktree", "remove", "--force", wtDir]);
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) main();
