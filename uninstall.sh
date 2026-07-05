#!/usr/bin/env bash
# Remove the user-level fable-bench-lite install (mirror of install.sh).
# Strips only the sentinel blocks from CLAUDE.md; everything else untouched.
set -euo pipefail

CLAUDE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

rm -rf "$CLAUDE/skills/fable"
for a in explorer fable-planner verifier coder engineer test-writer reviewer smoke-tester; do
  rm -f "$CLAUDE/agents/$a.md"
done
rm -f "$CLAUDE/fable-auto.on"

CMD="$CLAUDE/CLAUDE.md"
if [ -f "$CMD" ]; then
  for pair in fable-bench fable-auto; do
    awk -v b="<!-- ${pair}:begin -->" -v e="<!-- ${pair}:end -->" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$CMD" > "$CMD.tmp" && mv "$CMD.tmp" "$CMD"
  done
fi

echo "Removed fable-bench-lite from $CLAUDE (CLAUDE.md block stripped)"
echo "Note: explorer.md / verifier.md are generic worker names — if you"
echo "installed other tools that shipped their own, re-add those as needed."
