#!/usr/bin/env bash
# Lints every tracked shell script. What shellcheck found when it came in is listed in
# .shellcheck-baseline and left alone; anything new fails. `lint-shell.sh record` rewrites the list.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
baseline=.shellcheck-baseline

scripts() {
  git ls-files -z | while IFS= read -r -d '' f; do
    case "$f" in
      *.sh | *.bash) printf '%s\n' "$f" ;;
      *) if [ -f "$f" ] && head -n1 -- "$f" | grep -Eq '^#!.*[/ ](ba|da|k)?sh([[:space:]]|$)'; then printf '%s\n' "$f"; fi ;;
    esac
  done
}

if [ "${1:-}" = record ]; then
  scripts | while IFS= read -r f; do
    # Exit 1 is findings, which are what is being recorded; any other failure stops the run.
    out=$(shellcheck -f gcc -- "$f") || [ $? -eq 1 ]
    codes=$(printf '%s\n' "$out" | sed -n 's/.*\[\(SC[0-9]*\)\]$/\1/p' | sort -u | paste -sd, -)
    if [ -n "$codes" ]; then printf '%s\t%s\n' "$f" "$codes"; fi
  done > "$baseline"
  exit 0
fi

status=0
while IFS= read -r f; do
  codes=$(awk -F '\t' -v f="$f" '$1 == f { print $2 }' "$baseline")
  if [ -n "$codes" ]; then shellcheck --exclude="$codes" -- "$f" || status=1
  else shellcheck -- "$f" || status=1; fi
done < <(scripts)
exit "$status"
