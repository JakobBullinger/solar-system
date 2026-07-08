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

Launching a lane (since wave 5): the orchestrator stages the worktree, the
bypass-mode `.claude/settings.local.json`, AND the mission brief as
`.agent-brief.md` in the worktree root (git-excluded). Then
`tools/launch-lane.sh <name>` — runnable by the human or the orchestrator —
opens a new Terminal window already running `claude` with the brief
submitted. No copy-paste. macOS `.command`+`open`, no automation permission.

## Communication protocol (v2, PR-based — ACTIVE since 2026-07-07)

Live progress and orchestrator→agent nudges stay on the filesystem; the
done-signal is now a pull request. Untracked local files (in
`.git/info/exclude`, never commit them):

| Channel | Writer | Meaning |
|---|---|---|
| `.agent-status.md` | agent | append-only progress log (`HH:MM message`) |
| `.agent-status.md` (main checkout) | orchestrator | same format for the orchestrator's own actions (merges, deploys, lane launches) — fleet.js shows it on the `main` row; the durable record stays git history + PRs |
| `.orchestrator-inbox.md` | orchestrator | instructions/nudges for the agent |
| **pull request** | agent | replaces v1's `.agent-done`: feature finished **and verified**; the PR body is the handoff (what changed / how verified / merge caveats) |

Verification pacing (2026-07-08): while ITERATING, run only the specs your
change touches; run the FULL e2e suite exactly once, post-rebase, as act 3
of the finish sequence. CI re-runs the full suite on the PR regardless — a
second and third local full-suite run buys nothing but wall-clock.

Agent finish sequence — the FINAL FIVE ACTS, in order, none skippable:
1. Re-read `.orchestrator-inbox.md`.
2. `git rebase main` (fresh main — `git fetch` first if in doubt).
3. `npm test` green + your headless e2e still passing post-rebase.
4. `git push -u origin feature/<name>` (your branch only — never main).
5. `gh pr create --title "Level N: <feature>" --body "<handoff>"`.

Prerequisites (already configured on this machine): `gh auth status` must
show **JakobBullinger** as the active account (`gh auth switch -u
JakobBullinger` if the work account is active); pushes ride the
`github-personal` SSH alias regardless of `gh`.

The orchestrator's watcher polls `gh pr list --state open` (survives laptop
sleep — PR state lives on GitHub, not in a suspended session) with a 30-min
heartbeat; on heartbeat it reads status files + branch logs and nudges via
inbox. CI (`.github/workflows/ci.yml`) runs build + `npm test` + headless
smoke on every PR automatically.

## Integration procedure

Merge order matters when branches touch the same modules. Agents never
push to main. For each open PR:

1. Read the PR body (handoff) + `gh pr diff <n>` / `git diff main...branch --stat`.
2. Wait for CI green on the PR (`gh pr checks <n>`) — the orchestrator no
   longer re-runs build/test basics by hand; it does feature-specific
   end-to-end checks only.
3. `git merge --no-ff feature/<name>` in the main checkout (local merge keeps
   the working tree for immediate verification; close the PR as merged when
   pushing). Expected conflict: the README log table — keep rows in level order.
4. Verify on main (see below), `git push origin main` (auto-closes the PR).
5. Redeploy `dist/index.html` to the hosted artifact URL (deploy skill).
6. Tell remaining agents via their inboxes to rebase onto main.
7. `git worktree remove ../solar-system-<name>` + delete the local branch;
   delete the remote branch via the PR UI or leave as history (orchestrator
   does NOT force-delete remote branches).

## v1 protocol (retired 2026-07-07)

Waves 1–3 (levels 13–19, 22–23) used an `.agent-done` marker file instead of
PRs, with a filesystem watcher. It worked but was invisible off-machine, had
no enforced verification gate, and stalled silently through machine sleep.
If `gh` auth is ever broken, v1 remains the documented fallback: write the
handoff to `.agent-done` at the worktree root and the orchestrator's file
watcher takes over.

## Verification procedure

Two layers — the **agent** proves the feature before touching `.agent-done`,
and the **orchestrator** re-proves on main after merging (a clean branch can
still merge into a broken main).

Minimum bar (both layers, from `.claude/skills/headless-check`):

1. `node build.js` exits clean.
2. `npm test` green (since 2026-07-06: zero-dep suite in `test/`, ~1.5 s —
   the trajectory regression guard is the canary for any physics edit).
3. Headless screenshot shows a rendered scene — Chrome with
   `--use-angle=swiftshader --enable-unsafe-swiftshader
   --force-prefers-reduced-motion` (plain `--disable-gpu` = black canvas).
4. The changed feature exercised end-to-end: a targeted permalink/`?ch=`
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

## Process lessons (waves 1–2, levels 13–19)

- **Agents forget the final rebase.** Two of five lanes wrote `.agent-done`
  from a stale base because inbox rebase requests arrived mid-verification
  and were never re-read. Rule now IN THE BRIEFS: the last two acts before
  `.agent-done` are (1) re-read `.orchestrator-inbox.md`, (2) rebase onto
  current main and re-run `npm test`. The orchestrator can hand-resolve a
  stale merge (it's the usual README/append conflicts), but shouldn't have to.
- **Machine sleep stalls everything silently.** An overnight laptop sleep
  froze an agent mid-verification and the filesystem watcher with it; nothing
  surfaced until morning. Mitigation: on resume, check every lane's
  `.agent-status.md` mtime first. Real fix: the v2 PR flow below (state lives
  on GitHub, not in suspended sessions).
- **Physics-honesty-first briefs pay off.** Two features (Cassini assists,
  capture orbits) hinged on measuring what the integrator actually does
  before designing goals. Both agents found the textbook answer wrong for
  our integrator and designed honestly around measurements. Put "measure
  first" in any brief whose win conditions depend on close-encounter physics.
- **After any hand resolution in app.css, count braces FIRST.** Wave 6's
  final merge dropped a `}` when the conflict hunk split a media query —
  one `python3 -c "s=open('styles/app.css').read(); print(s.count('{'),
  s.count('}'))"` against both parents caught it before commit (both
  parents balanced + merged imbalanced = the resolution ate a brace). Then
  still run both sides' computed-style e2e guards; balance is necessary,
  not sufficient.
- **Hand-resolved CSS merges can silently swallow rules.** A marker-strip
  resolution spliced one block into the middle of a rule; braces stayed
  balanced file-wide, so the sheet parsed — but CSS Nesting made ~300 lines
  of rules unreachable (unstyled Mars drawer, shipped, user-reported; PR #5).
  Rule: after any hand resolution in app.css, screenshot the FEATURE AREAS
  both sides own, and prefer computed-style e2e assertions over
  presence-in-sheet checks — only computed styles reveal swallowed rules.
- **Stalled/killed subagents recover in tiers (wave 7 overnight sleep).**
  Try SendMessage-resume first (works even on failed agents if the
  transcript survived — full context retained); if the transcript is gone,
  a takeover agent works from `.agent-status.md` + committed code (and
  should re-verify inherited theories — two takeovers found the dead
  agent's last hypothesis wrong); if an agent stalls repeatedly on the same
  long-running step, the orchestrator finishes the mechanical last mile
  (verify/push/CI-watch) by hand rather than burning resume cycles.
- **Lanes can run as background subagents (wave 5).** When Terminal windows
  can't be launched (macOS blocks `.command` files spawned from a sandboxed
  session), the orchestrator runs each lane as a background subagent pointed
  at the worktree + `.agent-brief.md`. Everything else is identical (status
  files, inbox, final five acts, PR). Caveats: subagents stop when their
  own background jobs (e2e runs, CI watches) finish — the orchestrator
  resumes them with the result; fleet.js session-telemetry columns don't see
  subagent transcripts (status lines + PR states still work).
- **The e2e CI gate caught a real flake on its first day.** PR #10's
  duplicate runs split green/red on the same commit: a mostly-black wide
  screenshot sat at 1.97% lit pixels vs the 2% threshold, timing- and
  clock-dependent (unpinned `Date.now()` sim clock). Fix pattern: pin the
  jd, frame reliably-lit content, extra rAFs before shooting — never weaken
  `check-screenshot.js`. Screenshot specs should pin their clock from the
  start.
- **The knowledge base compounds.** Wave-2 briefs were a third the length of
  wave-1's because CLAUDE.md + skills + this file carry the conventions; the
  level-19 agent fact-checked and corrected its own brief against the code.
  Keep promoting lane discoveries into CLAUDE.md's physics notes.

## Later, if wanted

Branch protection requiring CI green before merge; auto-generated PR review
checklists per touched module; a deploy job publishing `dist/index.html` to
GitHub Pages as a second, always-on mirror of the artifact.
