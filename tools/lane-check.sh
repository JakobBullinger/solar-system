#!/usr/bin/env bash
#
# lane-check.sh — pre-PR self-audit for feature agents.
#
# Every lane brief declares which files the agent owns (new modules) and
# which shared files it may touch. This script turns that declaration into
# a check: diff the branch against main, flag anything outside the lane,
# and print line deltas for the shared hotspots so "additive and small"
# (CLAUDE.md, Workflow) is measured, not claimed.
#
# Mandatory before the ORCHESTRATION.md final five acts — see
# .claude/skills/lane-check/SKILL.md. Kept bash-3.2 compatible (macOS stock).
set -eo pipefail

HOTSPOTS="src/main.js build.js index.template.html styles/app.css README.md"
HOTSPOT_WARN_ADDS=60   # informational: hotspot growth above this gets a WARN

usage() {
  cat <<'EOF'
usage: tools/lane-check.sh [--base <ref>] <allowed-path> [<allowed-path> ...]

  <allowed-path>   file, shell glob, or directory declaring your lane:
                   the new modules you own plus any files your brief says
                   you may edit. Directories match by prefix; quote globs
                   so the shell does not expand them ('src/ui/foo*.js').
  --base <ref>     diff base (default: main)

Shared hotspots (src/main.js, build.js, index.template.html,
styles/app.css, README.md) are implicitly in-lane, but their line deltas
are always printed and large additions are warned about.

Exit codes: 0 clean, 1 out-of-lane files found, 2 usage error.
EOF
}

BASE=main
if [ "$1" = "--base" ]; then
  [ $# -ge 2 ] || { usage >&2; exit 2; }
  BASE=$2
  shift 2
fi
[ $# -ge 1 ] || { usage >&2; exit 2; }
ALLOWED=("$@")

is_hotspot() {
  local h
  for h in $HOTSPOTS; do [ "$1" = "$h" ] && return 0; done
  return 1
}

in_lane() {
  local f=$1 p
  for p in "${ALLOWED[@]}"; do
    # shellcheck disable=SC2053  # unquoted RHS on purpose: glob match
    [[ $f == $p ]] && return 0
    [[ $f == ${p%/}/* ]] && return 0   # directory prefix
  done
  return 1
}

# "+added / -deleted" for one changed file (binary files show as "+- / --")
deltas() {
  git diff --numstat "$BASE...HEAD" -- "$1" | awk '{ printf "+%s / -%s", $1, $2 }'
}

CHANGED=$(git diff --name-only "$BASE...HEAD")
NCHANGED=0; [ -n "$CHANGED" ] && NCHANGED=$(printf '%s\n' "$CHANGED" | wc -l | tr -d ' ')
echo "lane check: $(git rev-parse --abbrev-ref HEAD) vs $BASE ($NCHANGED changed files)"
echo

IN="" OUT="" HOT=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if is_hotspot "$f"; then HOT="$HOT$f"$'\n'
  elif in_lane "$f"; then IN="$IN$f"$'\n'
  else OUT="$OUT$f"$'\n'
  fi
done <<EOF
$CHANGED
EOF

echo "in lane:"
if [ -n "$IN" ]; then
  printf '%s' "$IN" | while IFS= read -r f; do echo "  $f  ($(deltas "$f"))"; done
else
  echo "  (none)"
fi
echo

echo "shared hotspots (keep additive and small):"
touched_hot=0
for h in $HOTSPOTS; do
  if printf '%s' "$HOT" | grep -qx "$h"; then
    touched_hot=1
    d=$(deltas "$h")
    adds=$(printf '%s' "$d" | sed 's/^+\([^ ]*\).*/\1/')
    warn=""
    case $adds in
      *[!0-9]*|'') ;;  # binary or unparsable: no threshold check
      *) [ "$adds" -gt "$HOTSPOT_WARN_ADDS" ] && warn="   <-- WARN: large for a shared file" ;;
    esac
    echo "  $h  ($d)$warn"
  fi
done
[ $touched_hot -eq 0 ] && echo "  (untouched)"
echo

if [ -n "$OUT" ]; then
  echo "OUT OF LANE — not in your declaration and not a hotspot:"
  printf '%s' "$OUT" | while IFS= read -r f; do echo "  $f  ($(deltas "$f"))"; done
  echo
  echo "FAIL: revert these, or get the lane widened via the orchestrator inbox"
  exit 1
fi

echo "OK: every changed file is inside the declared lane"
