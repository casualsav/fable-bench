#!/usr/bin/env bash
# ID8 runs this, through the plug-in install.sh registers under ~/.id8/plugins, once per config dir
# it launches workers from, with CLAUDE_CONFIG_DIR set to that dir. ID8 never loads a worker's
# CLAUDE.md, so the lead-mode block cannot reach its sessions; instead this installs fable-bench
# there and hands ID8 the lead prompt, which ID8 appends only to a worker launched on Fable.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE="${CLAUDE_CONFIG_DIR:?ID8 runs this with CLAUDE_CONFIG_DIR set}"

FABLE_ID8_SYNC=1 "$SRC/install.sh" </dev/null >/dev/null

mkdir -p "$CLAUDE/id8-model-prompts"
sed "s|@CONFIG_DIR@|$CLAUDE|g" "$SRC/id8-fable-lead.md" > "$CLAUDE/id8-model-prompts/fable.md"
