#!/usr/bin/env bash
# Install fable-bench-lite: the manual /fable skill (Fable plans, you execute)
# and the worker agents. By default it writes NOTHING new into your CLAUDE.md
# (stale fable-bench blocks from earlier installs are stripped).
#
# Optional lead mode (for sessions where Fable itself is the driving model)
# merges a ~6-line block into CLAUDE.md behind sentinels, pointing at the
# installed skills/fable/LEAD.md by its full path. Below-Fable sessions
# ignore it entirely.
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

mkdir -p "$CLAUDE/skills" "$CLAUDE/agents" "$CLAUDE/scripts"

rm -rf "$CLAUDE/skills/fable" "$CLAUDE/skills/oracle" "$CLAUDE/skills/fable-method"
cp -a "$SRC/skills/fable" "$CLAUDE/skills/fable"
cp -a "$SRC/skills/fable-method" "$CLAUDE/skills/fable-method"

AGENTS="explorer researcher fable-planner verifier coder engineer test-writer reviewer smoke-tester"
for a in $AGENTS; do
  cp -a "$SRC/agents/$a.md" "$CLAUDE/agents/$a.md"
done

# The verifier's delta runner (verifier.md invokes it by this installed path).
cp -a "$SRC/scripts/verify-against.ts" "$CLAUDE/scripts/verify-against.ts"

# The subagent guard: a PreToolUse hook on the Agent tool. An Agent call that
# pins no model inherits the PARENT session's model, which is how an unnamed
# subagent of a Fable-led session ran at Fable rates. Under a Fable-led parent
# the hook rewrites such a call to run on Opus; below-Fable sessions are left
# alone, which is why this is a hook and not a box-wide setting. The hook
# leaves alone any agent file that pins a non-Fable model; the manifest below
# marks which ones are ours, so the notice can name them and so fable-planner
# keeps its /fable exemption.
cp -a "$SRC/scripts/subagent-guard.ts" "$CLAUDE/scripts/subagent-guard.ts"
cp -a "$SRC/scripts/install-subagent-guard.ts" "$CLAUDE/scripts/install-subagent-guard.ts"
printf '%s\n' $AGENTS > "$CLAUDE/fable-bench-agents"
GUARD=skipped
if command -v bun >/dev/null 2>&1; then
  bun "$CLAUDE/scripts/install-subagent-guard.ts" "$CLAUDE/settings.json" "$CLAUDE/scripts/subagent-guard.ts"
  GUARD=installed
fi

# Pin the two Fable efforts (BSD + GNU sed compatible).
sed -i.bak -E "s|^effort:.*|effort: ${PLAN_EFFORT}|" "$CLAUDE/agents/fable-planner.md"
sed -i.bak -E "s|effort down to \`[a-z]+\`|effort down to \`${REVIEW_EFFORT}\`|g; s|the same \`[a-z]+\` override|the same \`${REVIEW_EFFORT}\` override|g; s|Effort override \`[a-z]+\`|Effort override \`${REVIEW_EFFORT}\`|g" "$CLAUDE/skills/fable/SKILL.md"
rm -f "$CLAUDE/agents/fable-planner.md.bak" "$CLAUDE/skills/fable/SKILL.md.bak"

# ID8's sync (id8-sync.sh, FABLE_ID8_SYNC=1) stops here: ID8 never loads a
# worker's CLAUDE.md, and the dir may be the user's own, whose lead-mode
# choice this run must not undo.
if [ -n "${FABLE_ID8_SYNC:-}" ]; then exit 0; fi

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
  # awk, not sed: the config dir is inserted as a literal, whatever characters it holds.
  { printf '%s\n' "$BEGIN_S"
    DIR="$CLAUDE" awk '{ while ((i = index($0, "@CONFIG_DIR@"))) $0 = substr($0, 1, i - 1) ENVIRON["DIR"] substr($0, i + 12); print }' "$SRC/CLAUDE-fable-bench.md"
    printf '%s\n' "$END_S"; } >> "$CMD"
fi

# Lite variant has no auto layer: clear any stale marker so nothing implies it.
rm -f "$CLAUDE/fable-auto.on"

# Beside ID8, register as its plug-in: at every boot ID8 runs it once per config
# dir it launches workers from (a worker account included), and appends the
# lead prompt it leaves there to every worker launched on Fable.
ID8_ROOT="$HOME/.id8"
ID8_PLUGIN=skipped
if [ -d "$ID8_ROOT" ]; then
  mkdir -p "$ID8_ROOT/plugins"
  printf '#!/usr/bin/env bash\n# Written by fable-bench install.sh; ID8 runs it per worker config dir.\nexec env FABLE_EFFORT=%s FABLE_REVIEW_EFFORT=%s %q\n' \
    "$PLAN_EFFORT" "$REVIEW_EFFORT" "$SRC/id8-sync.sh" > "$ID8_ROOT/plugins/fable-bench"
  chmod +x "$ID8_ROOT/plugins/fable-bench"
  ID8_PLUGIN=registered
fi

echo "Installed fable-bench-lite into $CLAUDE"
echo "  plan effort  : $PLAN_EFFORT    review effort: $REVIEW_EFFORT"
if [ "$LEAD" = yes ]; then
  echo "  lead mode    : installed (6-line CLAUDE.md block; Fable-driven sessions only)"
else
  echo "  lead mode    : not installed (CLAUDE.md untouched; FABLE_LEAD=yes to add)"
fi
echo "  /fable       : Fable plans, you execute (on demand)"
echo "  agents       : fable-planner + explorer, researcher, verifier, coder,"
echo "                 engineer, test-writer, reviewer, smoke-tester"
if [ "$GUARD" = installed ]; then
  echo "  subagent guard: PreToolUse hook on Agent in settings.json — in a"
  echo "                 Fable-led session a subagent naming no model is pinned"
  echo "                 to Opus instead of inheriting Fable; below-Fable"
  echo "                 sessions are untouched"
else
  echo "  subagent guard: NOT INSTALLED — bun is missing. Unnamed subagents will"
  echo "                 keep inheriting the session model, Fable included."
fi
if [ "$ID8_PLUGIN" = registered ]; then
  echo "  ID8 plug-in  : registered in $ID8_ROOT/plugins — from ID8's next boot"
  echo "                 (a restart or /update), every ID8 account gets this kit"
  echo "                 and a worker launched on Fable leads per LEAD.md"
fi
echo
echo "Restart / reload your session."
