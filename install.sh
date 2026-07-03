#!/usr/bin/env bash
# Install fable-consult as a USER-LEVEL skill so it invokes as bare `/fable`
# (not the namespaced `/fable-consult:fable` you'd get from `/plugin install`).
#
# It copies the skill and its three agents into your Claude config dir:
#   skills/fable/        -> $CLAUDE/skills/fable/
#   agents/{explore,fable-planner,verification}.md -> $CLAUDE/agents/
#
# User skills/agents are not namespaced, so the command is `/fable` and the
# agents resolve by bare name (which is what SKILL.md and fable-planner.md use).
#
# Fable's reasoning effort (low|medium|high|xhigh|max) is written into the installed
# fable-planner agent's `effort:` frontmatter. install.sh prompts for it (recommended:
# medium); set the FABLE_EFFORT env var to skip the prompt (e.g. FABLE_EFFORT=high) or
# for non-interactive installs. Re-run install.sh to change it.
set -euo pipefail

EFFORTS="low medium high xhigh max"
# Precedence: FABLE_EFFORT env > interactive prompt > recommended default (medium).
# Skips the prompt on a non-TTY (piped) install.
choose_effort() {
  if [ -n "${FABLE_EFFORT:-}" ]; then printf '%s' "$FABLE_EFFORT"; return; fi
  if [ ! -t 0 ]; then printf 'medium'; return; fi
  local ans
  while :; do
    printf 'Fable reasoning effort? [low/medium/high/xhigh/max] (recommended: medium): ' >&2
    read -r ans || { ans=medium; break; }
    ans="${ans:-medium}"
    case " $EFFORTS " in *" $ans "*) break ;; *) printf 'Invalid effort: %s\n' "$ans" >&2 ;; esac
  done
  printf '%s' "$ans"
}

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
FABLE_EFFORT="$(choose_effort)"
case " $EFFORTS " in *" $FABLE_EFFORT "*) ;; *) echo "FABLE_EFFORT must be one of: $EFFORTS" >&2; exit 1 ;; esac

mkdir -p "$CLAUDE/skills" "$CLAUDE/agents"

rm -rf "$CLAUDE/skills/fable"
cp -a "$SRC/skills/fable" "$CLAUDE/skills/fable"

for a in explore fable-planner verification; do
  cp -a "$SRC/agents/$a.md" "$CLAUDE/agents/$a.md"
done

# Pin Fable's effort into the installed agent frontmatter (BSD + GNU sed compatible).
sed -i.bak -E "s|^effort:.*|effort: ${FABLE_EFFORT}|" "$CLAUDE/agents/fable-planner.md"
rm -f "$CLAUDE/agents/fable-planner.md.bak"

echo "Installed /fable into $CLAUDE"
echo "  skill : $CLAUDE/skills/fable/SKILL.md"
echo "  agents: explore.md, fable-planner.md (effort: ${FABLE_EFFORT}), verification.md"
echo
echo "Restart / reload your Claude Code session, then run /fable on any task."
