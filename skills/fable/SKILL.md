---
name: fable
description: Have Claude Fable 5 plan the current task, then run an automatic warm diff-review after you execute. You (the below-Fable driver — Sonnet or Opus) gather the evidence and execute; Fable is the context-blind PLANNER — one plan engagement at the start (it writes the plan, unanchored by any draft of yours), one warm review at the end. Trigger on "/fable", "get a Fable plan", "consult Fable", or when the user wants Fable-planned execution of a nontrivial change. An explicit "critique my plan" request switches to the opt-in critique mode.
---

# /fable — Fable plans, you execute

You are the driver (below-Fable — Sonnet or Opus): you hold full session context, gather the
evidence, execute, and make every micro-judgment yourself. Fable 5 is the PLANNER — stronger
judgment, ZERO session context; it reads only what your brief points to, and it writes the
plan unanchored by any draft of yours. It is never in the loop. Across one `/fable` you touch
Fable twice — **one plan engagement** at the start, **one warm review** at
the end (a resume of the same agent) — plus at most one exception-triggered mid-consult
(S5). Never a scheduled third touch. **MODEL GATE:** if this session's
driving model is itself Fable-tier, never spawn `fable-planner` — you ARE the
planner, and a spawn pays twice for the same judgment. `/fable` then means:
plan it yourself (S1's evidence discipline still applies), execute per S5/S5-alt, review the
diff YOURSELF (S5-alt's `reviewer` spawns don't apply — a Fable lead reads
worker diffs first-hand), plus `smoke-tester` when runtime behavior changed.
All Fable-touch budgets read as zero.

**Hard dependency:** the warm review resumes the plan agent via `SendMessage`. If your harness
cannot resume a subagent, `/fable` cannot review — there is no cold fallback. The preflight
(S0.5) checks this before you spend the plan consult.

**Native advisor first:** when `advisorModel: fable` is set (as on this install), a below-Fable driver
already has Fable judgment on tap mid-task — the advisor reads the FULL conversation
server-side, no brief needed. For an ad-hoc second opinion, prefer asking for an advisor
consult over invoking this skill. `/fable` remains the right tool when you want the full
discipline: a Fable-authored plan built from grounded evidence, plus the owed warm
diff-review at the end.

## The flow

**S0 — Ground the brief.** Fable plans only as well as your brief. For anything beyond a
local, self-evident change, delegate mapping to `explorer` workers (scale it: skip for a
one-file change, fan out several for a subsystem consult) and fold their CONCLUSIONS — not
raw dumps — into the brief. When the mapping is destined for a consult brief, instruct
`explorer` to return NEUTRAL fact-maps (interfaces, call paths, invariants, line refs), not
recommendations — driver-flavored conclusions re-anchor the exact frame the blind plan
exists to avoid. Capture the project's **test / verify command** and RUN it once
(inline or via `verifier`): the brief must state the baseline (`BASELINE: green`, or the
red facts) so Fable never plans against a false premise, and S7 needs the command. Resolve
every lookup yourself now (Lookup fence, below) so the brief carries established facts, not
questions.

**S0.5 — Preflight dependencies.** Confirm warm subagent-resume (`SendMessage` to a spawned
agent) is available; if NOT, tell the user `/fable` can't run without it and STOP — fail
before paying for the plan consult. `TaskCreate` is degradable: if absent, carry the S4
checkpoint in your own running notes and continue.

**S1 — Mode check.** Default is **plan mode**: the brief carries evidence and NO plan of
yours — Fable writes the plan. Do NOT draft one first, even privately-then-discarded: your
questions and framing leak its shape, and an anchored Fable plan is the failure this skill
exists to avoid. **Critique mode** is opt-in only — the user explicitly asked you to draft
and have Fable critique it (see Critique mode below).

**S2 — Build the plan brief** to the spec below, gated by the Lookup fence.

**S3 — Spawn `fable-planner`.** One plan engagement. It returns a numbered PLAN (S1, S2…)
with RISKS / CHECKPOINTS / ASSUMPTIONS in the coded format below; that plan is what you
execute and what the warm review audits against. Apply per Bindingness.

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
`coder` (Sonnet) for small specced fixes, `engineer` (Sonnet) for
structural work and spec'd feature builds, `test-writer` FIRST wherever touched code lacks
coverage. If the batch needed a fresh audit, fan that out too: parallel read-only `explorer`
passes, each owning a slice small enough to read IN FULL — precise findings (file:line,
evidence) are what make delegation briefs good; vague specs make workers improvise. Write
each worker a self-contained spec in four parts — delegation quality IS spec quality:
(1) **FACTS** — the audit findings it needs, file:line, PASTED in (workers verify drift,
never re-discover); (2) **OWNERSHIP + change** — the files it OWNS (touch nothing else),
the problem, the intended design; (3) **DECIDED** — design decisions already made and why,
so the worker implements instead of relitigating; (4) **HAZARDS + VERIFY** — known edge
cases to check and the exact verify commands. **One writer per file, ever** — sequence anything
that shares a file, or set `isolation: worktree` when ownership can't be split cleanly.
**Hub-file batching:** when the batch's items all funnel through one hub file (a monolith
daemon, a central router), don't serialize workers through it — give ONE worker a
multi-item spec for the whole batch; extra workers enter only for files the hub never
touches.
**You own git:** workers never run git write commands (`stash`, `checkout --`, `reset`,
`clean`, commit, push — a bare stash in a shared tree destroys other workers' in-flight
edits); you stage and commit between batches, and `git add` new files before any deploy step
that syncs tracked files. **Review cadence (below-Fable driver only — a Fable-tier
lead never spawns `reviewer`; it reads every worker diff itself, per the MODEL
GATE):** workers that ran in PARALLEL (worktrees or
disjoint files) each gate through `reviewer` before you merge them; a SERIAL batch in one
tree takes ONE `reviewer` pass over the combined diff at the end — same coverage, fewer
spawns. Tiny mechanical diffs (template-following, ≲30 lines, no new logic) skip the
`reviewer` spawn entirely: the lead reads the diff directly — faster than the spawn, and
the same first-hand eyes the user-facing rule already demands.
Either way you read verdicts, never raw diffs, with ONE exception: personally read
the diff of any NEW user-facing behavior first-hand regardless of verdict. Delegate
regression breadth, never novelty. Treat each worker report's **Concerns** section as
review agenda, not commentary — feed every named hazard to the `reviewer`/`smoke-tester`
pass or rule on it yourself; workers self-flag exactly what specs miss. **Amendments to a
worker's own diff resume the SAME worker** (`SendMessage` to its agent id) — its context is
warm and the turnaround is seconds; a fresh spawn re-pays the full read. REJECT is
different: re-delegate with a tighter spec, not a fix-it argument with the
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
resume was meant to reuse. **Degraded fallback:** spawn the `reviewer` worker (Sonnet) on the
diff + task spec and disclose the downgrade — a reviewed ship beats an
unreviewed one. Ship with the gap disclosed, or let the user decide.

**S7 — Apply MUST-FIX, self-verify, ship.** For each MUST-FIX: diff the fixed lines against
the item, confirm the fix addresses it, run the narrowest test that exercises it (inline, or
`verifier`). If the change altered runtime or user-facing behavior and the system can be
driven, spawn `smoke-tester` with one concrete scenario (trigger → expected observable →
timeout) before shipping — green unit tests are not the finish line. Ship on green. No
post-fix Fable touch — a MUST-FIX that genuinely can't be made to pass is disclosed to the
user, not sent back to Fable.

## Critique mode (opt-in only — user explicitly asked for a critique of YOUR plan)
Write a draft plan (5–15 lines), and write the line `REJECTED: <alternative> — <reason>`
for its load-bearing approach. If you CAN'T write that line (no runner-up, or no concrete
reason it lost), you have a first idea, not a chosen approach — tell the user and fall back
to default plan mode: critiquing a first idea launders your uncertainty into false
convergence. If you can, send the brief with sections 6–8 included: Fable spends its rate
on the failure modes of a structure you've already reasoned through, and the REJECTED line
stops it re-proposing the alternative you killed — its ENDORSE then means real convergence.
Verdicts here are ENDORSE / AMEND / REPLACE (AMEND = deltas onto your draft, unlisted steps
stand; REPLACE only when the draft is wrong end-to-end).

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
6. 0–3 numbered questions you genuinely can't resolve from evidence (open design forks,
   unstated tradeoffs). Phrase them neutrally — a question that telegraphs your preferred
   answer anchors the plan you're paying Fable not to anchor.
7. *(Critique mode only)* `REJECTED: <alt> — <reason>`, then YOUR DRAFT PLAN, opened with
   "my draft view, for you to critique or replace".

The default brief carries ZERO approach content — no draft, no leading questions, no
"prior art" phrased as recommendation. Evidence in, plan out.

**Warm review brief** (resumed `fable-planner`; target ≤1.5k tokens + diff): ONLY what is new
since planning — deviations log · the diff (full if ≤400 lines; else --stat + risky hunks in
full) · verification evidence (command → result, one line each) · 1–3 concerns. No stance
line (the agent prompt carries review stance); never re-send the plan, file map, or pasted
code — the agent holds them, and re-sending is the waste warm mode exists to avoid.

A brief missing the session constraints or DONE-MEANS is a wasted engagement — Fable will
plan against a false or vague premise and you'll deviate your way back to your own judgment.

## Batch mode (≤3 small related items)
Thinking bills at output rate per ENGAGEMENT, so N tiny engagements pay that overhead N
times. When several small items share a subsystem, send ONE plan brief carrying T1/T2/T3
blocks: each block = task verbatim + its DONE-MEANS. Shared file map, constraints, and
pasted code appear once. Fable returns one `T# PLAN:` block per task, steps referenced as
`T#S#`. Execute all (S5 or S5-alt), then ONE warm review over the
combined diff — deviations and hunks labeled by T#. Never batch items that interact: a
cross-item flaw needs one plan, not a batch.

## Review-only mode (mechanical, pre-approved items)
For items where a plan consult buys nothing — dead-code removal, renames, dependency bumps
you've already decided — skip the consult machinery: execute (or delegate to a worker), then
spawn `fable-planner` COLD with a review-only brief: task spec, diff, verification evidence,
and the literal marker `REVIEW-ONLY`. Warm-only doesn't apply — there is no planning context
to reuse. Effort override `medium`. Returns the normal SHIP / FIX-THEN-SHIP block. Cheaper
still: route genuinely trivial diffs to the Sonnet `reviewer` worker and spend zero Fable.
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
- The plan engagement returns `PLAN:` numbered steps (`S# imperative (files)`), plus answers
  to your numbered questions and any RISKS / CHECKPOINTS / ASSUMPTIONS. That plan IS the
  plan of record; `S#` everywhere after (checkpoints, deviations, review) references it.
  (Critique mode only: verdicts are ENDORSE / AMEND / REPLACE; AMEND emits deltas onto your
  draft, unlisted steps stand, and `S#` references your draft.)
- References are pointers into context YOU hold: `S#` = a plan step, `H#` = a
  diff hunk, `D#` = a logged deviation. Resolve them against your own copy.
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
