#!/usr/bin/env bash
# Install fable-bench-lite: the manual /fable skill (Fable plans, you execute)
# and the worker agents. By default it writes NOTHING new into your CLAUDE.md
# (stale fable-bench blocks from earlier installs are stripped).
#
# Optional lead mode (for sessions where Fable itself is the driving model)
# merges a ~6-line block into CLAUDE.md behind sentinels, pointing at
# skills/fable/LEAD.md. Below-Fable sessions ignore it entirely.
#
# Interactive install asks three questions:
#   1. Fable PLAN effort?                      (recommended: high)
#   2. Fable REVIEW / mid-consult effort?      (recommended: medium)
#   3. Install lead mode (CLAUDE.md block)?    (default: no)
# Non-interactive: FABLE_EFFORT=high FABLE_REVIEW_EFFORT=medium FABLE_LEAD=no ./install.sh
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

PLAN_EFFORT="${FABLE_EFFORT:-$(ask 'Fable PLAN effort? [low/medium/high/xhigh/max] (recommended: high)' high $EFFORTS)}"
REVIEW_EFFORT="${FABLE_REVIEW_EFFORT:-$(ask 'Fable REVIEW effort? [low/medium/high/xhigh/max] (recommended: medium)' medium $EFFORTS)}"
LEAD="${FABLE_LEAD:-$(ask 'Install lead mode (~6-line CLAUDE.md block, Fable-driven sessions only)? [yes/no] (default: no)' no yes no)}"
case " $EFFORTS " in *" $PLAN_EFFORT "*) ;; *) echo "FABLE_EFFORT must be one of: $EFFORTS" >&2; exit 1 ;; esac
case " $EFFORTS " in *" $REVIEW_EFFORT "*) ;; *) echo "FABLE_REVIEW_EFFORT must be one of: $EFFORTS" >&2; exit 1 ;; esac
case " yes no " in *" $LEAD "*) ;; *) echo "FABLE_LEAD must be yes or no" >&2; exit 1 ;; esac

mkdir -p "$CLAUDE/skills" "$CLAUDE/agents"

rm -rf "$CLAUDE/skills/fable" "$CLAUDE/skills/fable-method"
cp -a "$SRC/skills/fable" "$CLAUDE/skills/fable"
cp -a "$SRC/skills/fable-method" "$CLAUDE/skills/fable-method"

for a in explorer fable-planner verifier coder engineer test-writer reviewer smoke-tester; do
  cp -a "$SRC/agents/$a.md" "$CLAUDE/agents/$a.md"
done

# Pin the two Fable efforts (BSD + GNU sed compatible).
sed -i.bak -E "s|^effort:.*|effort: ${PLAN_EFFORT}|" "$CLAUDE/agents/fable-planner.md"
sed -i.bak -E "s|effort down to \`[a-z]+\`|effort down to \`${REVIEW_EFFORT}\`|g; s|the same \`[a-z]+\` override|the same \`${REVIEW_EFFORT}\` override|g; s|Effort override \`[a-z]+\`|Effort override \`${REVIEW_EFFORT}\`|g" "$CLAUDE/skills/fable/SKILL.md"
rm -f "$CLAUDE/agents/fable-planner.md.bak" "$CLAUDE/skills/fable/SKILL.md.bak"

# CLAUDE.md handling: always strip stale sentinel blocks (from earlier
# fable-bench or legacy fable-auto installs); append the minimal lead-mode
# block only when lead mode was requested.
BEGIN_S='<!-- fable-bench:begin -->'
END_S='<!-- fable-bench:end -->'
CMD="$CLAUDE/CLAUDE.md"
touch "$CMD"
awk '$0=="<!-- fable-auto:begin -->"{skip=1} !skip{print} $0=="<!-- fable-auto:end -->"{skip=0}' "$CMD" > "$CMD.tmp" && mv "$CMD.tmp" "$CMD"
awk -v b="$BEGIN_S" -v e="$END_S" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$CMD" > "$CMD.tmp" && mv "$CMD.tmp" "$CMD"
if [ "$LEAD" = yes ]; then
  { printf '%s\n' "$BEGIN_S"; cat "$SRC/CLAUDE-fable-bench.md"; printf '%s\n' "$END_S"; } >> "$CMD"
fi

# Lite variant has no auto layer: clear any stale marker so nothing implies it.
rm -f "$CLAUDE/fable-auto.on"

echo "Installed fable-bench-lite into $CLAUDE"
echo "  plan effort  : $PLAN_EFFORT    review effort: $REVIEW_EFFORT"
if [ "$LEAD" = yes ]; then
  echo "  lead mode    : installed (6-line CLAUDE.md block; Fable-driven sessions only)"
else
  echo "  lead mode    : not installed (CLAUDE.md untouched; FABLE_LEAD=yes to add)"
fi
echo "  /fable       : Fable plans, you execute (on demand)"
echo "  agents       : fable-planner + explorer, verifier, coder,"
echo "                 engineer, test-writer, reviewer, smoke-tester"
echo
echo "Restart / reload your session."
