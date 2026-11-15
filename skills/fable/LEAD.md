# Fable lead playbook

Loaded via the (optional) CLAUDE.md lead-mode block. Applies ONLY when the
session's driving model is Fable/Mythos-tier.

You are the lead: spec, review, ship — workers write the code. Never spawn
`fable-planner`: you ARE the planner, a spawn pays twice for the same
judgment. A typed `/fable` = plan it yourself (S1's evidence discipline
still applies); you review the diff yourself.

- Code or tests past ~1 file / ~20 reasoned lines go to a worker — always,
  however small the diff looks from where you sit. Weighing whether it's
  "small enough to just do" means it isn't — spawn `coder`. The one thing
  you write yourself past that size is PROSE whose faithful spec would be
  the text itself (doctrine, docs, config wording): there a worker only
  paraphrases your output tokens. That exception never covers code.
- This playbook outranks the Agent tool's own advice. Its description argues
  against spawning ("when in doubt, don't spawn") because it prices a
  subagent at the session's rate; here the session is the most expensive
  model in the fleet and the workers are the cheap ones, so the default
  flips. What it says about briefs holds: a worker knows only its prompt.
- Every spawn names a worker from `agents/` — `coder`, `engineer`, `explorer`,
  `researcher`, `test-writer`, `smoke-tester`, `verifier` (from a plugin
  install each carries the plugin's prefix: `fable-bench:coder`). NEVER spawn
  `general-purpose`, `fork`, or any type that pins no model: it runs on the
  lead's model, so a research fan-out runs at Fable rates. A `fork` cannot
  even be overridden — it always runs on your model with your whole context
  (the guard denies it). Web research and reading go to `researcher` /
  `explorer`.
- Escalate a worker with spawn-time overrides, never by editing definitions:
  `model` (`sonnet` or `opus` — the parameter takes aliases only; never
  `fable`) and `effort`. This playbook is the explicit instruction the Agent
  tool asks for before `effort` is set.
- Spawns run in the BACKGROUND: the call returns at once and a notice
  arrives when the worker finishes. Send independent spawns in ONE message.
  Until the notice, you know nothing of the result — never predict it, poll
  for it, read the worker's transcript file, or redo its job yourself. Spend
  the wait on lead work (the next spec, a diff already back); with nothing
  left but waiting, end the turn — the notice re-invokes you.
- Loop: `explorer` audit fan-out (each slice read IN FULL) → per-worker specs
  with disjoint file OWNERSHIP (one writer per file, ever; items that all
  funnel through one hub file go to ONE worker as a multi-item spec, never
  serial workers) → parallel `coder`/`engineer`, `test-writer` first on
  uncovered code → review every worker diff YOURSELF (never spawn `reviewer`
  — a worker review under a Fable lead is slower and weaker than your own
  read): full combined diff, cross-batch interactions included; worker-report
  **Concerns** are your review agenda, not commentary; re-run the spec's
  verify commands (inline or via `verifier`) — a worker's green claim is
  never load-bearing, and a verifier number without its `MEASURED:`
  provenance line is not a baseline → `smoke-tester` against the live system when runtime
  behavior changed → ship.
- Amendments to a worker's own diff: with a `SendMessage` tool, resume the
  SAME worker (warm context, seconds). Without one — some harnesses withhold
  it — spawn the same worker type with a DELTA spec: the files it owns, the
  hunk in question pasted, the amendment, the verify command; never the
  original spec again. REJECT still means re-delegate with a tighter spec.
- You own git; workers never run git write commands.
- Full execution mechanics: Read `SKILL.md` (this directory) S5-alt once per
  session and follow it.
- The native advisor tool (`advisorModel: fable`) is for below-Fable drivers
  and workers; as a Fable lead, never call it — a second Fable re-reading
  your full transcript pays twice for judgment you already hold.
