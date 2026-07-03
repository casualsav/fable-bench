# fable-consult

An on-demand `/fable` skill for Claude Code: get a **Claude Fable 5 plan-consult** on any
task, then an **automatic warm diff-review** of the result. You drive; Fable consults.

The philosophy: **you (Opus) hold full session context and do the work.** Fable 5 has stronger
judgment but zero session context, so it's a consultant you touch exactly twice per `/fable`
— one plan critique before you build, one warm review of the diff after. Never a third touch.
It's the plan-and-review discipline of a heavier "Opus-drives / Fable-consults" config,
repackaged so **you decide when to invoke it** instead of it firing automatically.

## What it does

Run `/fable` on a nontrivial task and it drives this flow:

1. **Ground** — map the relevant code with `explore` workers (scaled to the task) and capture the project's test command.
2. **Preflight** — confirm your harness can resume a subagent (the hard dependency below).
3. **Draft + draft check** — you write a short plan; a self-test picks *critique-my-draft* vs *dual-plan*.
4. **Plan consult** — Fable critiques the draft and returns a terse coded verdict (`ENDORSE / AMEND / REPLACE`).
5. **Execute** — you build it, logging any deviations from the accepted plan.
6. **Warm review** — the *same* Fable agent is resumed to review the diff (`SHIP / FIX-THEN-SHIP / RECONSULT`).
7. **Apply MUST-FIX, self-verify, ship** — no third consult.

## Install

```
/plugin marketplace add casualsav/fable-consult
/plugin install fable-consult
```

Then invoke `/fable` on any task.

## Uninstall

```
/plugin uninstall fable-consult
/plugin marketplace remove casualsav/fable-consult
```

That removes the skill and its three agents from the plugin cache. `/fable` writes nothing
persistent outside the plugin — its only runtime state is an in-session task checkpoint that
lives and dies with the session — so nothing is left behind.

## Requirements

- **Claude Fable 5** access (the consultant agent runs `model: fable` at `effort: high`).
- **A harness that supports warm subagent-resume** (`SendMessage` to a spawned agent). The
  warm review resumes the plan agent; there is **no cold fallback**. If resume isn't available,
  `/fable` detects it at preflight and stops rather than half-running.

## What's inside

| File | Role |
|---|---|
| `skills/fable/SKILL.md` | The `/fable` flow + all the consult discipline (brief format, coded-output decoding, bindingness). |
| `agents/fable-planner.md` | The Fable 5 consultant — dual-mode: plan critique, and warm review when resumed. |
| `agents/explore.md` | Sonnet discovery worker (grounds the brief; also spawned by the consultant for its own search). |
| `agents/verification.md` | Sonnet test/lint/build runner (returns distilled pass/fail for self-verify). |

## Post-install check (one-time)

Plugin subagents may be **namespaced** (e.g. `fable-consult:explore` rather than bare
`explore`). After installing, run one `/fable` on a throwaway task and confirm the discovery
and verification workers resolve. If bare names don't resolve, qualify them in
`agents/fable-planner.md` (its nested `explore` spawn) and in `SKILL.md`.

## License

MIT
