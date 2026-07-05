#!/usr/bin/env bash
# Install fable-bench-lite: the manual /fable skill, the worker agents, and a
# ~24-line lead-mode block merged into your CLAUDE.md behind sentinels (it
# activates only when Fable is the session's driving model; below-Fable
# sessions ignore it and use /fable on demand). No auto layer in this variant.
#
# Interactive install asks two questions:
#   1. Fable PLAN-consult effort?              (recommended: high)
#   2. Fable REVIEW / mid-consult effort?      (recommended: medium)
# Non-interactive: FABLE_EFFORT=high FABLE_REVIEW_EFFORT=medium ./install.sh
#
# Worker efforts are pinned in their frontmatter (speed/quality, no Fable
# cost): verifier+explorer low · coder+smoke-tester medium · test-writer high ·
# engineer+reviewer high. Edit the agent files to change.
set -euo pipefail

EFFORTS="low medium high xhigh max"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

ask() { # ask <prompt> <default> <valid...>
  local prompt="$1" def="$2"; shift 2
  local ans
  if [ ! -t 0 ]; then printf '%s' "$def"; return; fi
  while :; do
    printf '%s ' "$prompt" >&2
    read -r ans || { ans="$def"; break; }
    ans="${ans:-$def}"
    case " $* " in *" $ans "*) break ;; *) printf 'Invalid: %s\n' "$ans" >&2 ;; esac
  done
  printf '%s' "$ans"
}

PLAN_EFFORT="${FABLE_EFFORT:-$(ask 'Fable PLAN-consult effort? [low/medium/high/xhigh/max] (recommended: high)' high $EFFORTS)}"
REVIEW_EFFORT="${FABLE_REVIEW_EFFORT:-$(ask 'Fable REVIEW effort? [low/medium/high/xhigh/max] (recommended: medium)' medium $EFFORTS)}"
case " $EFFORTS " in *" $PLAN_EFFORT "*) ;; *) echo "FABLE_EFFORT must be one of: $EFFORTS" >&2; exit 1 ;; esac
case " $EFFORTS " in *" $REVIEW_EFFORT "*) ;; *) echo "FABLE_REVIEW_EFFORT must be one of: $EFFORTS" >&2; exit 1 ;; esac

mkdir -p "$CLAUDE/skills" "$CLAUDE/agents"

rm -rf "$CLAUDE/skills/fable"
cp -a "$SRC/skills/fable" "$CLAUDE/skills/fable"

for a in explorer fable-planner verifier coder engineer test-writer reviewer smoke-tester; do
  cp -a "$SRC/agents/$a.md" "$CLAUDE/agents/$a.md"
done

# Pin the two Fable efforts (BSD + GNU sed compatible).
sed -i.bak -E "s|^effort:.*|effort: ${PLAN_EFFORT}|" "$CLAUDE/agents/fable-planner.md"
sed -i.bak -E "s|effort down to \`[a-z]+\`|effort down to \`${REVIEW_EFFORT}\`|g; s|the same \`[a-z]+\` override|the same \`${REVIEW_EFFORT}\` override|g; s|Effort override \`[a-z]+\`|Effort override \`${REVIEW_EFFORT}\`|g" "$CLAUDE/skills/fable/SKILL.md"
rm -f "$CLAUDE/agents/fable-planner.md.bak" "$CLAUDE/skills/fable/SKILL.md.bak"

# Merge the lead-mode block into CLAUDE.md behind sentinels (idempotent; also
# strips blocks left by the full fable-bench or legacy fable-auto installs).
BEGIN_S='<!-- fable-bench:begin -->'
END_S='<!-- fable-bench:end -->'
CMD="$CLAUDE/CLAUDE.md"
touch "$CMD"
awk '$0=="<!-- fable-auto:begin -->"{skip=1} !skip{print} $0=="<!-- fable-auto:end -->"{skip=0}' "$CMD" > "$CMD.tmp" && mv "$CMD.tmp" "$CMD"
awk -v b="$BEGIN_S" -v e="$END_S" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$CMD" > "$CMD.tmp" && mv "$CMD.tmp" "$CMD"
{ printf '%s\n' "$BEGIN_S"; cat "$SRC/CLAUDE-fable-bench.md"; printf '%s\n' "$END_S"; } >> "$CMD"

# Lite variant has no auto layer: clear any stale marker so nothing implies it.
rm -f "$CLAUDE/fable-auto.on"

echo "Installed fable-bench-lite into $CLAUDE"
echo "  plan effort  : $PLAN_EFFORT    review effort: $REVIEW_EFFORT"
echo "  lead playbook: on when Fable drives · /fable: on demand below Fable"
echo "  agents       : fable-planner + explorer, verifier, coder,"
echo "                 engineer, test-writer, reviewer, smoke-tester"
echo
echo "Restart / reload your session."
