#!/usr/bin/env bash
# launch-lane.sh <lane-name> — open a new Terminal window running the lane's
# Claude Code agent with its brief already submitted.
#
# Expects the orchestrator to have staged the lane first:
#   ../solar-system-<name>/           git worktree on feature/<name>
#   ../solar-system-<name>/.agent-brief.md   the agent's mission brief (git-excluded)
#
# macOS only. Uses a generated .command file + `open`, so no AppleScript
# automation permission is needed. The agent session starts in bypassPermissions
# via the worktree's .claude/settings.local.json, also staged by the orchestrator.
set -euo pipefail

LANE="${1:?usage: launch-lane.sh <lane-name>}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WT="$(dirname "$REPO")/solar-system-$LANE"
BRIEF="$WT/.agent-brief.md"

[ -d "$WT" ] || { echo "no worktree at $WT — stage the lane first" >&2; exit 1; }
[ -f "$BRIEF" ] || { echo "no brief at $BRIEF — orchestrator writes it at staging time" >&2; exit 1; }

LAUNCHER="$WT/.agent-launch.command"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
cd "$WT"
exec claude "\$(cat .agent-brief.md)"
EOF
chmod +x "$LAUNCHER"

open "$LAUNCHER"
echo "lane '$LANE' launching in a new Terminal window"
