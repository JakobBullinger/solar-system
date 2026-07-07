---
name: status
description: Fleet/status digest for the parallel-agent workflow — what's in flight, what landed, what's blocked. Use when the user asks "where are we", at orchestrator session start, and on watcher heartbeats.
---

# Status digest

START with the fleet tool — it machine-gathers most of the digest in one shot:

```bash
node tools/fleet.js          # one row per lane + main: verdict, runtime, idle,
                             # turns, tokens, commits ahead, dirty, last status line
node tools/fleet.js --serve  # same data as a self-refreshing dashboard on :4199
```

Verdict column: `WORKING` (session active <30 min idle), `STALLED <t>` (idle
>30 min — the sleep-stall smell from ORCHESTRATION.md process lessons),
`PR OPEN #n` / `CI RED #n` (finish-line states from `gh`), `no session`
(worktree exists but no transcript found — agent never launched or launched
oddly). A ` [sub]` suffix on any verdict means the lane runs as a background
subagent of the orchestrator session (the wave-5 mode): its telemetry comes
from an `agent-*.jsonl` transcript under the orchestrator's project dir,
attributed by the launch prompt naming the lane's worktree, not from a
per-worktree terminal session. Token columns are summed from the lane's
Claude Code transcript (in = input+cache-creation, cache = cache reads).

Then gather what the tool can't see (all read-only):

1. Per feature worktree, if a row needs digging: last 3 lines of `.agent-status.md` (fleet shows only the last), does `.agent-done` exist (v1 fallback)?
2. Main: `git log --oneline -5`, `git status -sb` (clean? pushed?).
3. Last shipped level + date: bottom rows of the README `## Log` table.
4. If `npm test` exists, whether it passes on main.

Report as a short table — one row per lane: lane, level/feature, branch head vs main (rebased or behind?), last status line + its timestamp, verdict (working / stalled / done-awaiting-merge / landed). Below the table: main's state (clean, pushed, deployed?), and any action items (stale worktree to remove, agent silent >45 min → nudge via `.orchestrator-inbox.md`, unmerged `.agent-done`).

Merge order and lane ownership live in the roadmap memory and ORCHESTRATION.md — flag contradictions (e.g. an agent committing to a file outside its lane) rather than silently accepting them.
