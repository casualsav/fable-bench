# fable-bench

**Fable is the planner.** `/fable` on any nontrivial task: you (a below-Fable
driver — Sonnet or Opus) gather the evidence, Claude Fable 5 writes the plan
— unanchored by any draft of yours — you execute it, and the *same* Fable
agent is resumed at the end for a warm diff-review. Nothing fires unless you
type it (this is the LITE variant — no auto layer).

An optional **lead mode** covers sessions where Fable itself is the driving
model: plan engagements are suppressed as redundant — Fable specs, reviews,
and ships; the worker agents write the code. It's a ~6-line CLAUDE.md block
(pointing at `skills/fable/LEAD.md`), NOT installed by default, and inert in
below-Fable sessions.

The philosophy: **the driver holds full session context and does the work;
Fable holds the judgment.** Fable 5 has stronger judgment but zero session
context, so the driver's job is to compress that context into a terse
evidence brief — constraints, acceptance criteria, file map, load-bearing
code — and Fable's job is the plan. Two touches per `/fable` — the plan
engagement before you build, the warm review of the diff after — plus at most
one exception-triggered mid-consult if a checkpoint or assumption Fable
flagged fails mid-task.

## What it does

Run `/fable` on a nontrivial task and it drives this flow:

1. **Ground** — map the relevant code with `explorer` workers (scaled to the task), capture the test command and baseline.
2. **Preflight** — confirm your harness can resume a subagent (the hard dependency below).
3. **Brief** — compress the evidence into a terse plan brief (≤3.5k tokens): intent, task verbatim, constraints, `DONE-MEANS`, file map, pasted load-bearing code. Zero approach content — no draft, no leading questions.
4. **Plan** — Fable returns the numbered plan (terse, coded) with risks, checkpoints, assumptions.
5. **Execute** — you build it, logging deviations; if a Fable checkpoint or assumption fails, one warm mid-consult is allowed.
6. **Warm review** — the *same* Fable agent is resumed to review the diff (`SHIP / FIX-THEN-SHIP / RECONSULT`).
7. **Apply MUST-FIX, self-verify, ship** — no third engagement.

(An opt-in **critique mode** — you draft, Fable attacks it with
`ENDORSE / AMEND / REPLACE` — survives for when the user explicitly asks for a
critique of the driver's own plan.)

Three additions from the execution-layer marriage:

- **Orchestrated parallel execution (S5-alt):** for a batch of independent items, the driver
  fans out to `coder` / `engineer` / `test-writer` workers in parallel,
  gates every result through `reviewer`, and sends the merged diff to the one warm
  review. Speed comes from parallelism; quality holds because of the gates. Dependent chains
  stay inline.
- **Batch mode:** ≤3 small, vetted, non-interacting items share one plan engagement and one
  warm review — thinking overhead bills per engagement, so batching amortizes it.
- **Review-only mode:** pre-approved mechanical items skip the plan engagement; a cold
  `REVIEW-ONLY` Fable engagement (or, for trivial diffs, the Sonnet `reviewer` at zero
  Fable) judges the result. Tiered so no diff is double-reviewed by default.

## Install

**Recommended — bare `/fable` (user-level skill):**

```
git clone https://github.com/casualsav/fable-bench
./fable-bench/install.sh
```

This copies the skills and agents into your Claude config dir
(`~/.claude`, or `$CLAUDE_CONFIG_DIR`). Your `CLAUDE.md` is untouched by
default (stale blocks from earlier installs are stripped). The installer asks
three questions (env vars skip them for non-interactive installs):

1. **Fable plan effort** (`FABLE_EFFORT`, recommended **high**).
2. **Fable review effort** (`FABLE_REVIEW_EFFORT`, recommended **medium**) —
   applied as the per-invocation override on the warm review, mid-consults, and
   cold REVIEW-ONLY engagements.
3. **Lead mode** (`FABLE_LEAD`, default **no**) — only worth `yes` if you run
   sessions with Fable as the driving model; it merges a ~6-line block into
   `CLAUDE.md` behind sentinels that points Fable-led sessions at
   `skills/fable/LEAD.md`. Below-Fable sessions ignore it.

Worker efforts are pinned in frontmatter (they cost speed, not Fable):
verification + explore `low` · coder + smoke-tester `medium` · test-writer `high` ·
engineer + reviewer `high`.

User skills aren't namespaced, so the command is exactly `/fable`. Restart / reload your session after
installing.

**Alternative — as a plugin (namespaced `/fable-bench:fable`):**

```
/plugin marketplace add casualsav/fable-bench
/plugin install fable-bench
```

You get `/plugin`-managed updates, but Claude Code namespaces every plugin
command, so it invokes as `/fable-bench:fable` — not bare `/fable` — and the
workers are namespaced too (see the plugin note below). Pick this only if you
want the managed-update path over the clean name.

## Uninstall

If you used the script:

```
./fable-bench/uninstall.sh
```

If you installed the plugin:

```
/plugin uninstall fable-bench
/plugin marketplace remove casualsav/fable-bench
```

Either way, `/fable` writes nothing persistent beyond those files — its only
runtime state is an in-session task checkpoint that lives and dies with the
session — so nothing is left behind.

## Requirements

- **Claude Fable 5** access (the planner agent runs `model: fable`; `install.sh` prompts
  for effort, recommended `high` — see below).
- **A harness that supports warm subagent-resume** (`SendMessage` to a spawned agent). The
  warm review resumes the plan agent; there is **no cold fallback**. If resume isn't available,
  `/fable` detects it at preflight and stops rather than half-running.

## Tuning Fable's effort

Fable's reasoning depth is set by the `effort:` frontmatter in the installed
`fable-planner` agent. `install.sh` **prompts** for it and writes your choice in —
**recommended: high** — Anthropic's own default for nontrivial work, and `/fable` only fires
on nontrivial work; Fable at medium buys little margin over the Opus driver (Fable-low is
comparable to Opus-xhigh). Raise to `xhigh` for a rare, capability-critical plan. One honest caveat: thinking
tokens bill at Fable's output rate ($50/MTok), so effort — not the visible reply caps — is
the biggest cost dial in the system; `medium` is the legitimate lever if usage limits bite:

```
./fable-bench/install.sh                      # prompts: low | medium | high | xhigh | max
FABLE_EFFORT=high ./fable-bench/install.sh     # or set it to skip the prompt / for CI
```

Re-run with a new value to change it. (**Two efforts now govern the two engagements** —
verified: changing effort mid-conversation does NOT invalidate the message cache. The
frontmatter effort applies to the plan engagement; the warm review and any exception mid-consult
are resumed with a per-invocation override to `medium`, since they're bounded judgment
against an already-vetted plan. This makes `xhigh` plans affordable: the deep
thinking is spent once, not twice. If you install via `/plugin` instead of `install.sh`, the
shipped default is `high`; edit the agent's `effort:` frontmatter to change it.)

## What's inside

| File | Role |
|---|---|
| `skills/fable/SKILL.md` | The `/fable` flow + all the engagement discipline (brief format, coded-output decoding, bindingness). |
| `skills/fable/LEAD.md` | The Fable-lead playbook, loaded by the optional lead-mode CLAUDE.md block (Fable-driven sessions only). |
| `skills/fable-method/SKILL.md` | Fable’s working method distilled for the below-Fable driver — decomposition, self-verification, next-action selection. Load at the start of any nontrivial task. |
| `agents/fable-planner.md` | The Fable 5 planner — writes the plan from the evidence brief; warm diff-review when resumed; opt-in critique mode. |
| `agents/explorer.md` | Sonnet discovery worker (grounds the brief; also spawned by the planner for its own search). |
| `agents/verifier.md` | Haiku test/lint/build runner (returns distilled pass/fail for self-verify). |
| `agents/coder.md` | Sonnet worker: small, precisely-specced fixes. Gated by `reviewer`. |
| `agents/engineer.md` | Sonnet worker: behavior-preserving structural refactors, tests-first on uncovered code. |
| `agents/test-writer.md` | Sonnet worker: characterization/regression tests; orchestrator escalates gnarly cases with a spawn-time model/effort override. |
| `agents/reviewer.md` | Sonnet read-only gate: reviews worker diffs under a below-Fable driver (a Fable lead reads diffs itself); also the zero-Fable review tier and the degraded fallback when a warm-review handle is lost. |
| `agents/smoke-tester.md` | Sonnet live prober: drives the real running app end-to-end post-deploy — green unit tests are not the finish line. |
| `install.sh` / `uninstall.sh` | User-level install of the skill + agents into `~/.claude` (`$CLAUDE_CONFIG_DIR`), giving bare `/fable`. |
| `.claude-plugin/` | Manifests for the alternative `/plugin` install (namespaced `/fable-bench:fable`). |

## Plugin note (only if you chose the plugin path)

The script install puts the agents at user level, where they resolve by bare name
(`explorer`, `fable-planner`, `verifier`) — exactly what `SKILL.md` and
`fable-planner.md` reference — so there's nothing to check.

The **plugin** path is different: Claude Code namespaces plugin subagents (e.g.
`fable-bench:explore`). After a plugin install, run one `/fable` on a throwaway
task and confirm the discovery and verification workers resolve; if bare names
don't, qualify them in `agents/fable-planner.md` (its nested `explorer` spawn) and
in `SKILL.md`. This mismatch is the main reason the script install is recommended.

## License

MIT
