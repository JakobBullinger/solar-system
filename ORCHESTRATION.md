# Multi-agent orchestration

How this repo is developed by parallel Claude Code sessions, how work is
verified, and where the process is headed. Established 2026-07-06 (levels
13–15 were the first parallel wave; level 13 landed the same day).

## Roles

- **Orchestrator** — the session in the main checkout (`~/personal/solar-system`,
  branch `main`). It builds no features. It monitors agents, merges finished
  branches, verifies on main, pushes, and redeploys the hosted artifact.
  Runs in normal permission mode on purpose: it's the only session that
  touches `main` and the deploy.
- **Feature agents** — one Claude Code session per feature, each in its own
  git worktree on its own branch (shared `.git`, independent working dirs —
  agents cannot step on each other's files or on main). Agent worktrees run
  `bypassPermissions` via their local `.claude/settings.local.json`.

Worktree convention: `../solar-system-<name>` on `feature/<name>`, dev server
port 4174+ (main uses 4173). Example wave 1: `links` (challenge links, 4174),
`burns` (mid-course burns, 4175), `replays` (mission replays, 4176).

## Communication protocol (filesystem, v1)

No direct messaging — three untracked files per worktree, all listed in
`.git/info/exclude` (shared across worktrees; never commit them):

| File | Writer | Meaning |
|---|---|---|
| `.agent-status.md` | agent | append-only progress log (`HH:MM message`) |
| `.agent-done` | agent | feature finished **and verified**; body = handoff summary (what changed, how it was verified, merge caveats) |
| `.orchestrator-inbox.md` | orchestrator | instructions/nudges for the agent (e.g. "rebase onto main, level N landed") |

The orchestrator runs a background watcher polling for `.agent-done` every
60 s with a 30-min heartbeat; on heartbeat it reads status files + branch
logs, nudges via inbox, and pushes agent branches to origin as backup.
Restart the watcher each orchestrator session while agents are active.

## Integration procedure

Merge order matters when branches touch the same modules (wave 1: links →
burns → replays, all overlapping in `missions.js`). Agents never push to
main. For each `.agent-done`:

1. Read the `.agent-done` handoff + `git diff main...branch --stat`.
2. `git merge feature/<name>` in the main checkout. Expected conflict:
   the README log table — every branch adds its own "level N" row; keep all
   rows in level order.
3. Verify on main (see below).
4. `git push origin main`.
5. Redeploy `dist/index.html` to the hosted artifact URL (see the deploy
   skill / orrery-workflow memory).
6. Tell remaining agents via their inboxes to rebase onto main.
7. `git worktree remove ../solar-system-<name>` + `git branch -d` (agents
   may have already self-cleaned per CLAUDE.md worktree discipline).

## Verification procedure

Two layers — the **agent** proves the feature before touching `.agent-done`,
and the **orchestrator** re-proves on main after merging (a clean branch can
still merge into a broken main).

Minimum bar (both layers, from `.claude/skills/headless-check`):

1. `node build.js` exits clean.
2. Headless screenshot shows a rendered scene — Chrome with
   `--use-angle=swiftshader --enable-unsafe-swiftshader
   --force-prefers-reduced-motion` (plain `--disable-gpu` = black canvas).
3. The changed feature exercised end-to-end: a targeted permalink/`?ch=`
   screenshot, a behavioral check via CDP, or driving
   `ORRERY.Sandbox.tick(jd, jd+n)` directly (long time-lapses can't use
   virtual time).

For mission/physics changes additionally: offline brute-force playtest
(`.claude/skills/playtest-scan`) proving winnability; pars set from found
minima; never ship a goal that hasn't been beaten by a script.

Example (level 13): the agent proved a byte-identical challenge-link
round-trip; the orchestrator independently re-screenshotted main with a
fresh in-budget `?ch=` link and confirmed banner + en-route HUD — and the
first attempt with an over-budget vector correctly fell back gracefully,
accidentally verifying the forged-link guard too.

## v2: PR-based flow (planned)

The filesystem protocol works but is invisible outside the machine and has
no enforced gate between "agent says verified" and "merged". The upgrade:

1. **Agents open PRs instead of touching `.agent-done`.** On finish:
   `git push -u origin feature/<name>` then `gh pr create` with the handoff
   summary (what/how-verified/merge-caveats) as the PR body. The PR replaces
   `.agent-done`; `.agent-status.md` stays for live progress.
2. **CI verifies every PR** (`.github/workflows/ci.yml`): `node build.js` +
   headless Chrome smoke screenshot (uploaded as an Actions artifact) + a
   non-black-canvas pixel check. The orchestrator stops re-running the
   basics by hand and only does feature-specific end-to-end checks.
3. **Orchestrator reviews the PR** (`/review` or the code-review skill),
   merges in dependency order via `gh pr merge --merge`, still redeploys the
   artifact manually (the Artifact tool only exists in a Claude session).
4. **Watcher becomes `gh pr list --state open` polling** — survives machine
   sleep, and branch backup is free because branches live on origin.
5. Later, if wanted: branch protection requiring CI green before merge;
   auto-generated PR review checklists per touched module; a deploy job
   that publishes `dist/index.html` to GitHub Pages as a second, always-on
   mirror of the artifact.

**Blocker:** `gh` on this machine is authenticated to the work account only;
this repo lives on the personal account (`JakobBullinger/solar-system`).
Agents can't open PRs until `gh` has personal-account auth (see the
repo-migration memory for how to re-auth). Until then, v1 protocol stays.
