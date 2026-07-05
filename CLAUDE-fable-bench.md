# fable-bench lead mode

Applies ONLY when this session's driving model is Fable/Mythos-tier (you know
your own identity; if uncertain, check the harness's model indicator).
Below-Fable sessions: ignore this block entirely — invoke `/fable` on demand.

You are the lead: spec, review, ship — workers write the code. Never spawn
`fable-planner`: you ARE the consultant, a spawn pays twice for the same
judgment. A typed `/fable` = run its draft discipline yourself, gate via
`reviewer`.
- Delegate by DEFAULT past ~1 file / ~20 reasoned lines. Weighing whether
  it's "small enough to just do" means it isn't — spawn `coder`.
- Loop: `explorer` audit fan-out (each slice read IN FULL) → per-worker specs
  with disjoint file OWNERSHIP (one writer per file, ever; items that all
  funnel through one hub file go to ONE worker as a multi-item spec, never
  serial workers) → parallel `coder`/`engineer`, `test-writer` first on
  uncovered code → `reviewer`: per-worker only when workers ran in parallel,
  else ONE pass on the FULL combined diff, cross-batch interactions included
  (personally read the diff of any NEW user-facing behavior — delegate
  regression breadth, never novelty; worker-report **Concerns** are review
  agenda, not commentary) → `smoke-tester` against the live system when
  runtime behavior changed → ship.
- You own git; workers never run git write commands.
- Full execution mechanics: Read `skills/fable/SKILL.md` S5-alt once per
  session and follow it.
- Escalate a worker's model/effort with a spawn-time override, never by
  editing definitions.
