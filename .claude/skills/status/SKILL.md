---
name: status
description: Fleet/status digest for the parallel-agent workflow — what's in flight, what landed, what's blocked. Use when the user asks "where are we", at orchestrator session start, and on watcher heartbeats.
---

# Status digest

Gather (all read-only):

1. `git worktree list` — active lanes (main + one per in-flight feature).
2. Per feature worktree: last 3 lines of `.agent-status.md`, `git log --oneline main..HEAD | head -3`, `git status -s | head -3` (uncommitted work?), does `.agent-done` exist?
3. Main: `git log --oneline -5`, `git status -sb` (clean? pushed?).
4. Last shipped level + date: bottom rows of the README `## Log` table.
5. If `npm test` exists, whether it passes on main.

Report as a short table — one row per lane: lane, level/feature, branch head vs main (rebased or behind?), last status line + its timestamp, verdict (working / stalled / done-awaiting-merge / landed). Below the table: main's state (clean, pushed, deployed?), and any action items (stale worktree to remove, agent silent >45 min → nudge via `.orchestrator-inbox.md`, unmerged `.agent-done`).

Merge order and lane ownership live in the roadmap memory and ORCHESTRATION.md — flag contradictions (e.g. an agent committing to a file outside its lane) rather than silently accepting them.
