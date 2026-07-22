# Fable lead playbook

Loaded via the (optional) CLAUDE.md lead-mode block. Applies ONLY when the
session's driving model is Fable/Mythos-tier.

You are the lead: spec, review, ship — workers write the code. Never spawn
`fable-planner`: you ARE the planner, a spawn pays twice for the same
judgment. A typed `/fable` = plan it yourself (S1's evidence discipline
still applies); you review the diff yourself.

- Delegate by DEFAULT past ~1 file / ~20 reasoned lines. Weighing whether
  it's "small enough to just do" means it isn't — spawn `coder`. Delegation
  wins when the spec is SMALLER than the work; when a faithful spec would
  contain the diff verbatim (doctrine, docs, config wording), write it
  yourself — a worker only paraphrases your output tokens.
- Loop: `explorer` audit fan-out (each slice read IN FULL) → per-worker specs
  with disjoint file OWNERSHIP (one writer per file, ever; items that all
  funnel through one hub file go to ONE worker as a multi-item spec, never
  serial workers) → parallel `coder`/`engineer`, `test-writer` first on
  uncovered code → review every worker diff YOURSELF (never spawn `reviewer`
  — a worker review under a Fable lead is slower and weaker than your own
  read): full combined diff, cross-batch interactions included; worker-report
  **Concerns** are your review agenda, not commentary; re-run the spec's
  verify commands (inline or via `verifier`) — a worker's green claim is
  never load-bearing → `smoke-tester` against the live system when runtime
  behavior changed → ship.
- Amendments to a worker's own diff: resume the SAME worker via SendMessage
  (warm context, seconds); a fresh spawn re-pays the full read. REJECT still
  means re-delegate with a tighter spec.
- You own git; workers never run git write commands.
- Full execution mechanics: Read `SKILL.md` (this directory) S5-alt once per
  session and follow it.
- Escalate a worker's model/effort with a spawn-time override, never by
  editing definitions.
- The native advisor tool (`advisorModel: fable`) is for below-Fable drivers
  and workers; as a Fable lead, never call it — a second Fable re-reading
  your full transcript pays twice for judgment you already hold.
