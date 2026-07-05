---
name: fable
description: Run a Claude Fable 5 plan-consult on the current task, then an automatic warm diff-review after you execute. Invoke when you want a stronger-judgment second opinion on a plan before building, plus a review of the result after. You (the driver, Opus) hold full session context and execute; Fable is a context-blind consultant — one plan consult at the start, one warm review at the end. Trigger on "/fable", "consult Fable", "get a Fable plan review", or when the user wants an independent plan-and-review pass on a nontrivial change.
---

# /fable — you drive, Fable consults

You are the driver (Opus): you hold full session context, execute inline, and make every
micro-judgment yourself. Fable 5 is a consultant with stronger judgment but ZERO session
context — it reads only what your brief points to. It is never in the loop. Across one
`/fable` you touch Fable twice — **one plan consult** at the start, **one warm review** at
the end (a resume of the same agent) — plus at most one exception-triggered mid-consult
(S5). Never a scheduled third touch. **MODEL GATE:** if this session's
driving model is itself Fable-tier, never spawn `fable-planner` — you ARE the
consultant, and a spawn pays twice for the same judgment. `/fable` then means:
run S1 and the draft check on yourself, execute per S5/S5-alt, take the review
gate via `reviewer` (effort high) plus `smoke-tester` when runtime behavior
changed. All Fable-touch budgets read as zero.

**Hard dependency:** the warm review resumes the plan agent via `SendMessage`. If your harness
cannot resume a subagent, `/fable` cannot review — there is no cold fallback. The preflight
(S0.5) checks this before you spend the plan consult.

## The flow

**S0 — Ground the brief.** Fable plans only as well as your brief. For anything beyond a
local, self-evident change, delegate mapping to `explorer` workers (scale it: skip for a
one-file change, fan out several for a subsystem consult) and fold their CONCLUSIONS — not
raw dumps — into the brief. When the mapping is destined for a consult brief, instruct
`explorer` to return NEUTRAL fact-maps (interfaces, call paths, invariants, line refs), not
recommendations — Opus-flavored conclusions re-anchor the exact frame blind-sketch exists to
avoid. Capture the project's **test / verify command** and RUN it once
(inline or via `verifier`): the brief must state the baseline (`BASELINE: green`, or the
red facts) so Fable never plans against a false premise, and S7 needs the command. Resolve
every lookup yourself now (Lookup fence, below) so the brief carries established facts, not
questions.

**S0.5 — Preflight dependencies.** Confirm warm subagent-resume (`SendMessage` to a spawned
agent) is available; if NOT, tell the user `/fable` can't run without it and STOP — fail
before paying for the plan consult. `TaskCreate` is degradable: if absent, carry the S4
checkpoint in your own running notes and continue.

**S1 — Draft + draft check.** Write a draft plan (5–15 lines). Run the draft check (below):
it picks critique-your-draft, blind-sketch, or (rarely) dual-plan.

**S2 — Build the plan brief** to the spec below, gated by the Lookup fence.

**S3 — Spawn `fable-planner`.** One plan consult (blind-sketch mode uses two messages in the
same engagement). Decode the coded verdict against the table below; apply per Bindingness.

**S4 — Register the owed warm review as a self-contained task item.** `TaskCreate` a
checkpoint that survives the execution turns. It MUST embed: the **`fable-planner` agent
id/handle** (from S3's spawn result), a pointer to the **warm review brief spec** (below),
and the precondition — **fire only after execution AND verification evidence are complete**.

**S5 — Execute inline.** Keep a deviations log: one line per departure from the accepted
plan, with reason. Check Fable's CHECKPOINTS as you pass them. **Exception mid-consult:** if
a CHECKPOINT fails or a listed ASSUMPTION proves false mid-task, you may resume the agent
once — send only the failed item + the observed facts; it rules on holding vs replanning the
affected steps. This is the only permitted mid-task touch; never resume for reassurance or a
partial-diff review (half-built code reads as false positives).

**S5-alt — Orchestrated parallel execution (multi-item batches).** When the accepted plan is
a batch of INDEPENDENT items, don't execute inline: fan out to workers in parallel —
`coder` (Sonnet) for small specced fixes, `engineer` (Opus) for
structural work and spec'd feature builds, `test-writer` FIRST wherever touched code lacks
coverage. If the batch needed a fresh audit, fan that out too: parallel read-only `explorer`
passes, each owning a slice small enough to read IN FULL — precise findings (file:line,
evidence) are what make delegation briefs good; vague specs make workers improvise. Write
each worker a self-contained spec: the files it OWNS (touch nothing else), the problem, the
intended change, exact verify commands. **One writer per file, ever** — sequence anything
that shares a file, or set `isolation: worktree` when ownership can't be split cleanly.
**You own git:** workers never run git write commands (`stash`, `checkout --`, `reset`,
`clean`, commit, push — a bare stash in a shared tree destroys other workers' in-flight
edits); you stage and commit between batches, and `git add` new files before any deploy step
that syncs tracked files. Gate EVERY worker result through `reviewer` before merging —
you read verdicts, never raw diffs, with ONE exception: personally read the diff of any NEW
user-facing behavior first-hand regardless of verdict. Delegate regression breadth, never
novelty. REJECT means re-delegate with a tighter spec, not a fix-it argument with the
worker. The merged diff then gets the single S6 warm review as normal. Keep DEPENDENT chains
inline: spawn overhead and lost shared context make sequential delegation slower than driving
it yourself, and speed is the only reason this alt exists. (In long multi-phase sessions,
lean toward delegating even single items past ~1 file / ~20 reasoned lines — context
leanness compounds, and full-file reading is cheap in a worker.)

**S6 — Warm review.** When the S4 precondition is met, resume the SAME `fable-planner` agent
with the warm review brief, **overriding effort down to `medium` per-invocation** (verified:
changing effort mid-conversation does not break the message cache). The review is bounded
judgment on a diff against an already-vetted plan — the open-ended reasoning was paid for at
plan effort. The S5 exception mid-consult takes the same `medium` override. **Resume-failure path:** if the handle is gone (session restart,
compaction), DISCLOSE to the user that the owed review can't be fulfilled and why. Do NOT
substitute a fresh Fable spawn — a cold spawn violates warm-only and re-bills the context the
resume was meant to reuse. **Degraded fallback:** spawn the Opus `reviewer` worker on the
diff + task spec and disclose the downgrade — a reviewed ship at Opus judgment beats an
unreviewed one. Ship with the gap disclosed, or let the user decide.

**S7 — Apply MUST-FIX, self-verify, ship.** For each MUST-FIX: diff the fixed lines against
the item, confirm the fix addresses it, run the narrowest test that exercises it (inline, or
`verifier`). If the change altered runtime or user-facing behavior and the system can be
driven, spawn `smoke-tester` with one concrete scenario (trigger → expected observable →
timeout) before shipping — green unit tests are not the finish line. Ship on green. No
post-fix Fable touch — a MUST-FIX that genuinely can't be made to pass is disclosed to the
user, not sent back to Fable.

## The draft check — decision or first idea? (zero Fable, picks the mode)
Write the line `REJECTED: <alternative> — <reason>` for your draft's load-bearing approach.
Structural, not felt: either the line exists in the brief or it doesn't — "am I confident?"
is always yes and self-deceiving.
- **You can write it** → your draft is a vetted prior. **Critique mode:** Fable spends its
  rate on the failure modes of a structure you've already reasoned through, and the REJECTED
  line stops it re-proposing the alternative you killed — its "aligned" then means real
  convergence.
- **You can't** (no runner-up, or no concrete reason it lost) → you have a first idea, not a
  chosen approach; critiquing it launders your uncertainty into false convergence. Use
  **blind-sketch:** send the brief WITHOUT the draft, asking for Fable's approach sketch
  (≤5 lines). Its sketch is generated unanchored. Then send your draft in a follow-up message
  of the same conversation for the normal critique. Cost over critique mode: one round trip
  + a few lines.
- **Dual-plan (rare):** several viable architectures and a wrong structure is expensive to
  unwind → ask Fable for its OWN full numbered plan alongside your draft, then YOU diff and
  arbitrate (you hold the context). Cost is real — a full second plan is pure output
  ($50/MTok), no delta-encoding — so never a default; blind-sketch covers most draft-check failures.

Run the check on the load-bearing approach, not every line. A mostly-vetted draft with ONE
first-idea step still critiques — name that step in your questions so Fable weighs it fresh.

## Building the brief — this is where a consult lives or dies
Transfer conclusions, not context. Fable reads pointed-to files (≤8 reads) and delegates
search to a Sonnet `explorer` child, so point, don't dump — EXCEPT the load-bearing core,
which you paste.

**Lookup fence — run before the consult.** Scan the brief for any clause that is discovery /
lookup / "verify / check the docs" rather than judgment: Fable is never for finding facts.
Resolve each yourself (inline, or `explorer`) and replace it with the answer. Structural, not
felt: run it even when the brief looks clean.

**Plan brief** (target ≤3.5k tokens — input is Fable's cheap channel; spend it on evidence,
never on hints of approach), in this order — goal first, bulk in the middle, the
ask at the end:
1. INTENT — one line: the larger goal, why it matters, who it's for. Fable plans better
   knowing the goal, not just the request.
2. Task verbatim.
3. Session-only constraints Fable cannot discover from files (user prefs, prior decisions,
   scope boundaries) + `BASELINE:` from S0 + `DONE-MEANS:` — 2–5 observable acceptance
   criteria and invariants (tests that must stay green, behaviors preserved). Fully specify
   the WHAT; carry zero HOW — this section is the biggest accuracy lever in the brief.
4. File map — 3–10 abs paths, 1-line role each — plus a raw skeleton (≤40-line tree of the
   relevant dirs, uninterpreted) and `PRIOR ART:` — patterns this repo already uses for this
   kind of change, stated factually, not as recommendation.
5. Pasted load-bearing code ≤150 lines (the interfaces/schemas/functions being changed, with
   file:line headers).
6. `REJECTED: <alt> — <reason>` (from the draft check).
7. YOUR DRAFT PLAN, opened with "my draft view, for you to critique or replace".
   (Blind-sketch: omit 6–8 from message one — your questions are born from the draft and
   telegraph its shape, anchoring the sketch; send 6–8 together in the follow-up.)
8. 1–3 questions you are actually unsure about, then the bare marker `PROBE` — the agent
   prompt defines it (would Fable take a materially different approach?); don't restate it.

**Warm review brief** (resumed `fable-planner`; target ≤1.5k tokens + diff): ONLY what is new
since planning — deviations log · the diff (full if ≤400 lines; else --stat + risky hunks in
full) · verification evidence (command → result, one line each) · 1–3 concerns. No stance
line (the agent prompt carries review stance); never re-send the plan, file map, or pasted
code — the agent holds them, and re-sending is the waste warm mode exists to avoid.

A brief missing the draft plan (in critique mode) or the session constraints is a wasted
consult — Fable will return generic advice worth less than your own judgment.

## Batch mode (≤3 small related items)
Thinking bills at output rate per ENGAGEMENT, so N tiny consults pay that overhead N times.
When several small items share a subsystem and EVERY draft passes the draft check (a
first-idea item gets its own consult — blind-sketch doesn't batch), send ONE plan brief
carrying T1/T2/T3 blocks: each block = task verbatim, its REJECTED line, its draft (≤6
lines). Shared file map, constraints, and pasted code appear once. Fable's findings reference
`T#S#`; one VERDICT line per task. Execute all (S5 or S5-alt), then ONE warm review over the
combined diff — deviations and hunks labeled by T#. Never batch items that interact: a
cross-item flaw needs one plan, not a batch.

## Review-only mode (mechanical, pre-approved items)
For items where a plan consult buys nothing — dead-code removal, renames, dependency bumps
you've already decided — skip the consult machinery: execute (or delegate to a worker), then
spawn `fable-planner` COLD with a review-only brief: task spec, diff, verification evidence,
and the literal marker `REVIEW-ONLY`. Warm-only doesn't apply — there is no planning context
to reuse. Effort override `medium`. Returns the normal SHIP / FIX-THEN-SHIP block. Cheaper
still: route genuinely trivial diffs to the Opus `reviewer` worker and spend zero Fable.
The tiering, so the same diff is never double-reviewed by default: trivial → `reviewer`
only; mechanical-but-worth-Fable → review-only; anything that got a plan consult → warm
review only.

## Reading Fable's coded output
Fable replies in a coded, exception-based format because its OUTPUT bills at 5× its input
($50/MTok) — output is the expensive channel, and these codes are where the savings live:
- Codes (NIL/BOUND/RACE/AUTHZ/VALID/ERRPATH/INVARIANT/LEAK/TYPE/DEADCODE/REGRESS/PERF +
  plan-level SEQ/SCOPE/SIMPLER) are the SAME table Fable's prompt defines — expand each to
  its fault class yourself. A `FREE:` line is already plain.
- **Integrity check first:** every valid reply ends with a literal `END` line. No `END` ⇒
  the reply is truncated or the call silently fell back (see below) — treat all silences in
  it as unreliable, never as endorsement.
- Given `END` is present: silence = accept. No MUST-FIX line ⇒ SHIP; a deviation absent from
  DEVIATION AUDIT ⇒ ACCEPTED; no PLAN AUDIT line ⇒ the plan held; empty RISKS/ASSUMPTIONS ⇒
  none. Never re-ask Fable to "confirm the rest is fine" — that confirmation is the silence.
- References are pointers into context YOU hold: `S#` = a step of your draft plan, `H#` = a
  diff hunk, `D#` = a logged deviation. Resolve them against your own copy.
- AMEND emits only deltas — apply them onto your draft; unlisted steps stand. ENDORSE with
  only a verdict line means run your draft as-is.
- A line is one finding: `path:line CODE imperative` (plan-level codes reference `S#`). A
  genuinely undecodable line (not just terse) is the ONE case for a RECONSULT — read the
  FREE: escape first.

## Bindingness & tie-breaks
- Fable's plan is the default. Deviate freely — but log every deviation; it gets audited at
  review.
- A plan point or MUST-FIX resting on a listed ASSUMPTION you know is false is void. Plan
  points: note it in the deviations log and proceed. MUST-FIX: you may override, but you
  MUST tell the user ("Fable flagged X; overriding because Y").
- All other MUST-FIX items are binding. SHOULD-FIX is your call.
- RECONSULT = your brief was insufficient to JUDGE (missing context, not missing fixes).
  Answer it inside engagement 2: one follow-up `SendMessage` with exactly what Fable asked
  for. No code changes between the RECONSULT and its answer, or it becomes a banned
  post-change re-review.
- After MUST-FIX, you do NOT re-consult (S7).

## Never consult Fable about
- **Intent ambiguity** — Fable has no access to the user's intent and would guess in
  output tokens, its most expensive channel. Two divergent readings where the wrong pick costs a redo: ask the USER one line.
- **Silent-fallback domains.** Two things trip Fable 5's classifiers, and a refusal
  (`stop_reason: refusal`) silently falls back to Opus 4.8 — you get Opus judgment while
  believing you consulted Fable: (1) any brief wording that asks Fable to echo, transcribe,
  or explain its internal reasoning ("show your thinking / why you concluded X" — the coded
  findings format is safe: it compresses conclusions, not thinking); (2) offensive-security
  work (exploits, malware, attack tooling — even benign hardening tasks can trip it) and
  biology / life-sciences content — keep those tasks off `/fable` entirely. The missing
  `END` line is your mechanical detector for a fallback that slipped through.
