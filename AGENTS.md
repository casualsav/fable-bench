# AGENTS.md

## Code standard

The repo's own rules come first: `README.md` says what each file is for, the
header comment of each script says what it must keep true, and
`skills/fable/LEAD.md` is the playbook a Fable-led session works by.

- An error is handled, logged with what failed, or raised. Never turn it into a
  default or an empty result in silence; where a default is right, a comment
  says why. The hooks exit 0 on their own failure on purpose, so a broken hook
  never blocks a session, and each says so.
- A comment says why the code is the way it is. What changed, when and for whom
  goes in the commit.
- A test drives the behaviour through the public interface and fails on a
  broken version of it.
- One concern per file. New code goes in the file of its concern, not the
  largest one open; a file past 800 lines (400 for shell) is split rather than
  grown.
- Nothing is added for a state that cannot occur: no speculative option, layer
  or fallback.
- The linter is green on new code: `bun run lint`. What it recorded when it
  came in (`biome.json` overrides, `.shellcheck-baseline`) is left alone unless
  a change is about it.
- Shell scripts start with `set -euo pipefail`, and carry no `|| true` without
  a comment saying why.
- The installers send errors to stderr with a non-zero exit, and never prompt
  when not on a terminal.
