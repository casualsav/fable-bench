---
name: consult
description: Run a Claude Fable 5 plan-consult on the current task, then an automatic warm diff-review after you execute. Invoke when you want a stronger-judgment second opinion on a plan before building, plus a review of the result after. You (the driver, Opus) hold full session context and execute; Fable is a context-blind consultant you touch at most twice — one plan critique at the start, one warm review at the end. Trigger on "/consult", "consult Fable", "get a Fable plan review", or when the user wants an independent plan-and-review pass on a nontrivial change.
---

# /consult — you drive, Fable consults

You are the driver (Opus): you hold full session context, execute inline, and make every
micro-judgment yourself. Fable 5 is a consultant with stronger judgment but ZERO session
context — it reads only what your brief points to. It is never in the loop. Across one
`/consult` you touch Fable exactly twice: **one plan critique** at the start and **one warm
review** at the end (a resume of the same agent). Never a third touch.

**Hard dependency:** the warm review resumes the plan agent via `SendMessage`. If your harness
cannot resume a subagent, `/consult` cannot review — there is no cold fallback. The preflight
(S0.5) checks this before you spend the plan consult.

## The flow

**S0 — Ground the brief.** Fable plans only as well as your brief. For anything beyond a
local, self-evident change, delegate mapping to `explore` workers (scale it: skip for a
one-file change, fan out several for a subsystem or repo-wide consult) and fold their
CONCLUSIONS — not raw dumps — into the brief. Also capture the project's **test / verify
command** here: this skill runs in cold sessions with no project-facts block to inherit it
from, and S7 needs it. Resolve every lookup yourself now (see the Lookup fence) so the brief
carries established facts, not questions.

**S0.5 — Preflight dependencies.** Confirm warm subagent-resume (`SendMessage` to a spawned
agent) is available. If it is NOT, tell the user `/consult` can't run without it and STOP —
fail before paying for the plan consult, not at review time. Also check `TaskCreate`: unlike
resume this one is degradable, not fatal — if it's absent, carry the owed-review checkpoint
(S4) as an explicit item in your own running plan/notes instead of a task, and continue.

**S1 — Draft + draft check.** Write a draft plan (5–15 lines). Run the draft check (below) to
pick the mode: critique-your-draft, or dual-plan when the approach itself is a first idea.

**S2 — Build the plan brief.** Assemble it to the spec below, gated by the Lookup fence and
the reasoning-extraction rule, and always carrying the independence probe.

**S3 — Spawn `fable-planner`.** One plan consult. Decode the coded verdict against the table
below and apply per Bindingness.

**S4 — Register the owed warm review as a self-contained task item.** `TaskCreate` a checkpoint
that survives the execution turns — and make it self-contained, because a surviving item is
useless if the firing knowledge has faded from attention. It MUST embed:
- the **`fable-planner` agent id/handle** to resume (from S3's spawn result),
- a pointer to the **warm review brief spec** (below),
- the precondition: **fire only after execution AND verification evidence are complete** — never on a half-done task.

**S5 — Execute inline.** Keep a deviations log: one line per departure from the accepted plan,
with reason. Check Fable's CHECKPOINTS as you pass them.

**S6 — Warm review.** When the S4 checkpoint's precondition is met, resume the SAME
`fable-planner` agent with the warm review brief. This is engagement 2.

**S6b — Resume-failure path.** If the agent handle is gone (session restart, context
compaction, resume unsupported now), DISCLOSE to the user that the owed warm review can't be
fulfilled and why. Do NOT substitute a fresh Fable spawn — a cold spawn silently violates
warm-only and re-bills context the resume was meant to reuse. Ship with the gap disclosed, or
let the user decide.

**S7 — Apply MUST-FIX, self-verify, ship.** Apply MUST-FIX per Bindingness. For each: diff the
fixed lines against the item (file:line + what was wrong), confirm the fix addresses it, then
run the narrowest test that exercises the change (inline, or the `verification` worker). Ship
on green. **No third Fable touch.** A MUST-FIX that genuinely can't be made to pass is
disclosed to the user, not sent back to Fable.

## The draft check — decision or first idea? (zero Fable, picks the mode)
Before S3, run one test on your own draft: can you name the approach you REJECTED, and why?
Factual, not felt — "am I confident?" is always yes and self-deceiving; "what did I kill, and
why?" you can either answer or you can't.
- **YES** — you weighed a runner-up and cut it for a concrete reason → your draft is a vetted
  prior. Critique-the-draft: Fable spends its rate on the failure modes of a structure you've
  already reasoned through.
- **NO** — no runner-up, or you can't say why you passed it → you have a first idea, not a
  chosen approach. Nothing to critique yet; critiquing it launders your uncertainty into false
  convergence. Get independence instead — **dual-plan**.

Run it on the plan's load-bearing approach, not every line. A mostly-vetted draft with ONE
first-idea step still critiques — but name that step in your questions so Fable weighs it fresh.

**Dual-plan (rare)** — fires on a draft-check NO on the load-bearing approach: no runner-up you
can name, several viable architectures, a wrong structure expensive to unwind. Send your draft
AND ask Fable for its OWN full plan, then YOU diff the two. The divergence is the signal; you
arbitrate (you hold the context). Cost is real — a full second plan, no delta-encoding, a
reconciliation pass — so never a default. A draft-check YES means critique-the-draft, and the
independence probe is the in-band hedge for a YES that was itself mis-calibrated.

## Building the brief — this is where a consult lives or dies
Transfer conclusions, not context. Fable reads pointed-to files (≤8 reads) and delegates any
search to a Sonnet `explore` child, so point, don't dump — EXCEPT the load-bearing core, which
you paste.

**Never ask Fable to show its reasoning.** Fable 5 refuses prompts that tell it to echo,
transcribe, or explain its internal reasoning as response text — and a refusal silently falls
back to Opus, so you pay for Fable and get Opus, losing the judgment you consulted for. The
coded findings format is safe (it compresses conclusions, not thinking); keep it. Just never
add "explain your reasoning / show your thinking / why you concluded X" to a brief. A
suspiciously generic verdict is the tell that a call quietly fell back.

**Lookup fence — run before the consult.** Scan the brief for any clause that is discovery /
lookup / "verify / check the docs" rather than judgment: Fable at 5× is never for finding
facts. Resolve each yourself (inline, or `explore`) and replace it with the answer — the brief
carries only established facts + the judgment question. Structural, not felt: run it even when
the brief looks clean.

**Plan brief** (target ≤2.5k tokens): task verbatim · one line of INTENT (why it matters / what
it's for — Fable plans better knowing the goal, not just the request) · session-only constraints
Fable cannot discover from files (user prefs, prior decisions, scope boundaries) · file map
(3–10 abs paths, 1-line role each) · pasted load-bearing code ≤150 lines (the
interfaces/schemas/functions being changed, with file:line headers) · YOUR DRAFT PLAN (the
draft check picks the mode) · 1–3 questions you are actually unsure about · the INDEPENDENCE
PROBE (below) — always in critique mode; dual-plan replaces it (a full independent plan makes
the probe a redundant APPROACH, so omit it there).

**Independence probe — one fixed question in every plan brief, on top of your 1–3.**
Critique-your-draft anchors Fable to your structure: it drifts toward local AMENDs and can
rubber-stamp a step's very existence. Counter it with one standing question: "Before critiquing
— would you take a materially different APPROACH (not just edits)? If yes, sketch it in ≤3 lines
+ why; if no, say so and proceed." It forces an explicit alternative without buying a full
second plan and makes convergence mean something — a "no" is real agreement, not a fault Fable
felt pressed to invent.

**Warm review brief** (resumed `fable-planner`; target ≤1.5k tokens + diff): open with the
stance line "Review duty: judge the RESULT as if a stranger built it from a plan a stranger
wrote — your plan is under review too; fault it where the diff proves it wrong." Then ONLY what
is new since planning: deviations log · the diff (full if ≤400 lines; else --stat + risky hunks
in full) · verification evidence (command → result, one line each) · 1–3 concerns. Never re-send
the plan, file map, or pasted code — the agent holds them; re-sending is the waste warm mode
exists to avoid.

A brief missing the draft plan or the session constraints is a wasted consult — Fable will
return generic advice worth less than your own judgment.

## Reading Fable's coded output
Fable replies in a coded, exception-based format to spend its 5× output rate minimally. Parse
it thus:
- Codes (NIL/BOUND/RACE/AUTHZ/VALID/ERRPATH/INVARIANT/LEAK/TYPE/DEADCODE/REGRESS/PERF) are the
  SAME table Fable's prompt defines — expand each to its fault class yourself; Fable will not
  spell it out. A `FREE:` line is already plain.
- Silence = accept / nothing to say. An omitted section is NOT an oversight: no MUST-FIX line ⇒
  SHIP; a deviation absent from DEVIATION AUDIT ⇒ ACCEPTED; no PLAN AUDIT line ⇒ the plan held;
  empty RISKS/ASSUMPTIONS ⇒ none. Never re-ask Fable to "confirm the rest is fine" — that
  confirmation is the silence.
- References are pointers into context YOU hold: `S#` = a step of your draft plan, `H#` = a hunk
  of the diff you sent, `D#` = a logged deviation. Resolve them against your own copy.
- AMEND emits only deltas — apply them onto your draft; unlisted steps stand. ENDORSE with only
  a verdict line means run your draft as-is.
- A line is one finding: `path:line CODE imperative`. If a line is genuinely undecodable (not
  just terse), that is the ONE case for a RECONSULT — but read the FREE: escape first.

## Bindingness & tie-breaks
- Fable's plan is the default. Deviate freely — but log every deviation; it gets audited at
  review.
- A plan point or MUST-FIX resting on a listed ASSUMPTION you know is false is void. For plan
  points: note it in the deviations log and proceed. For MUST-FIX: you may override, but you
  MUST tell the user ("Fable flagged X; overriding because Y"). The user only hears about real
  disagreements.
- All other MUST-FIX items are binding. SHOULD-FIX is your call.
- RECONSULT = your brief was insufficient to JUDGE (missing context, not missing fixes). Answer
  it inside engagement 2: one follow-up `SendMessage` to the warm agent with exactly what Fable
  asked for. No code changes between the RECONSULT and its answer, or it becomes a banned
  post-change re-review.
- After MUST-FIX, you do NOT re-consult. Apply the fix, verify it against the item and the
  narrowest test (S7), and ship. A MUST-FIX that can't be made to pass is disclosed to the user,
  not sent back to Fable.

## What NOT to consult about
Intent ambiguity is never a Fable consult — Fable has no access to the user's intent and would
guess at 5× your rate. If the user's instruction has two readings that diverge and the wrong
pick costs a redo, ask the USER one line, not Fable.
