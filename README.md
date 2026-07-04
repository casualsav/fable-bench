# fable-consult

An on-demand `/fable` skill for Claude Code: get a **Claude Fable 5 plan-consult** on any
task, then an **automatic warm diff-review** of the result. You drive; Fable consults.

The philosophy: **you (Opus) hold full session context and do the work.** Fable 5 has stronger
judgment but zero session context, so it's a consultant you touch twice per `/fable`
— one plan consult before you build, one warm review of the diff after — plus at most one
exception-triggered mid-consult if a checkpoint or assumption Fable flagged fails mid-task.
It's the plan-and-review discipline of a heavier "Opus-drives / Fable-consults" config,
repackaged so **you decide when to invoke it** instead of it firing automatically.

## What it does

Run `/fable` on a nontrivial task and it drives this flow:

1. **Ground** — map the relevant code with `explore` workers (scaled to the task) and capture the project's test command.
2. **Preflight** — confirm your harness can resume a subagent (the hard dependency below).
3. **Draft + draft check** — you write a short plan; a structural self-test (can you write the `REJECTED:` line?) picks *critique-my-draft*, *blind-sketch* (Fable sketches its approach before seeing your draft), or rarely *dual-plan*.
4. **Plan consult** — Fable returns a terse coded verdict (`ENDORSE / AMEND / REPLACE`).
5. **Execute** — you build it, logging deviations; if a Fable checkpoint or assumption fails, one warm mid-consult is allowed.
6. **Warm review** — the *same* Fable agent is resumed to review the diff (`SHIP / FIX-THEN-SHIP / RECONSULT`).
7. **Apply MUST-FIX, self-verify, ship** — no third consult.

## Install

**Recommended — bare `/fable` (user-level skill):**

```
git clone https://github.com/casualsav/fable-consult
./fable-consult/install.sh
```

This copies the skill and its three agents into your Claude config dir
(`~/.claude`, or `$CLAUDE_CONFIG_DIR`). User skills aren't namespaced, so the
command is exactly `/fable`. Restart / reload your session, then invoke `/fable`
on any task.

**Alternative — as a plugin (namespaced `/fable-consult:fable`):**

```
/plugin marketplace add casualsav/fable-consult
/plugin install fable-consult
```

You get `/plugin`-managed updates, but Claude Code namespaces every plugin
command, so it invokes as `/fable-consult:fable` — not bare `/fable` — and the
workers are namespaced too (see the plugin note below). Pick this only if you
want the managed-update path over the clean name.

## Uninstall

If you used the script:

```
./fable-consult/uninstall.sh
```

If you installed the plugin:

```
/plugin uninstall fable-consult
/plugin marketplace remove casualsav/fable-consult
```

Either way, `/fable` writes nothing persistent beyond those files — its only
runtime state is an in-session task checkpoint that lives and dies with the
session — so nothing is left behind.

## Requirements

- **Claude Fable 5** access (the consultant agent runs `model: fable`; `install.sh` prompts
  for effort, recommended `high` — see below).
- **A harness that supports warm subagent-resume** (`SendMessage` to a spawned agent). The
  warm review resumes the plan agent; there is **no cold fallback**. If resume isn't available,
  `/fable` detects it at preflight and stops rather than half-running.

## Tuning Fable's effort

Fable's reasoning depth is set by the `effort:` frontmatter in the installed
`fable-planner` agent. `install.sh` **prompts** for it and writes your choice in —
**recommended: high** — Anthropic's own default for nontrivial work, and `/fable` only fires
on nontrivial work; Fable at medium buys little margin over the Opus driver (Fable-low is
comparable to Opus-xhigh). Raise to `xhigh` for a rare, capability-critical consult. One honest caveat: thinking
tokens bill at Fable's output rate ($50/MTok), so effort — not the visible reply caps — is
the biggest cost dial in the system; `medium` is the legitimate lever if usage limits bite:

```
./fable-consult/install.sh                      # prompts: low | medium | high | xhigh | max
FABLE_EFFORT=high ./fable-consult/install.sh     # or set it to skip the prompt / for CI
```

Re-run with a new value to change it. (One effort governs both Fable engagements — the plan
consult and the warm-review resume — which is correct: it must stay constant across a single
conversation, since changing effort mid-conversation invalidates the message cache. If you
install via `/plugin` instead of `install.sh`, the shipped default is `high`; edit the
agent's `effort:` frontmatter to change it.)

## What's inside

| File | Role |
|---|---|
| `skills/fable/SKILL.md` | The `/fable` flow + all the consult discipline (brief format, coded-output decoding, bindingness). |
| `agents/fable-planner.md` | The Fable 5 consultant — dual-mode: plan critique, and warm review when resumed. |
| `agents/explore.md` | Sonnet discovery worker (grounds the brief; also spawned by the consultant for its own search). |
| `agents/verification.md` | Sonnet test/lint/build runner (returns distilled pass/fail for self-verify). |
| `install.sh` / `uninstall.sh` | User-level install of the skill + agents into `~/.claude` (`$CLAUDE_CONFIG_DIR`), giving bare `/fable`. |
| `.claude-plugin/` | Manifests for the alternative `/plugin` install (namespaced `/fable-consult:fable`). |

## Plugin note (only if you chose the plugin path)

The script install puts the agents at user level, where they resolve by bare name
(`explore`, `fable-planner`, `verification`) — exactly what `SKILL.md` and
`fable-planner.md` reference — so there's nothing to check.

The **plugin** path is different: Claude Code namespaces plugin subagents (e.g.
`fable-consult:explore`). After a plugin install, run one `/fable` on a throwaway
task and confirm the discovery and verification workers resolve; if bare names
don't, qualify them in `agents/fable-planner.md` (its nested `explore` spawn) and
in `SKILL.md`. This mismatch is the main reason the script install is recommended.

## License

MIT
