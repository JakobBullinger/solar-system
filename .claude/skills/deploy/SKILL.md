---
name: deploy
description: Rebuild the orrery and redeploy dist/index.html to the hosted claude.ai artifact URL. Use after a feature lands on main (post-merge, post-verification).
---

# Deploy

Since 2026-07-07 the PRIMARY deploy is automatic: every push to `main` ships
`dist/index.html` to https://jakobbullinger.github.io/solar-system/ via
`.github/workflows/deploy.yml` (verify with `gh run list --workflow=deploy.yml`).
So "deploying" is: get verified work onto main and push.

Mechanism (since PR previews): Pages serves the **`gh-pages` branch** (root),
not an Actions artifact. `deploy.yml` builds main and pushes the root
`index.html` to that branch; `pr-preview.yml` parks per-PR builds under
`previews/pr-<n>/` on the same branch (auto-comment on the PR, deleted on
close). Deploy's last step polls the live URL until it serves the exact
built bytes — a green Deploy run MEANS the site updated, and it goes red if
the Pages source setting ever drifts off "branch: gh-pages, path /". Never
edit the gh-pages branch by hand; the two workflows own it.

1. Confirm on main and clean: `git status -sb`.
2. `node build.js` + `npm test` — must be clean/green.
3. Run `/headless-check` if the change wasn't already verified post-merge.
4. Confirm the README Log table has an entry for what shipped; push main.
5. Check the Deploy workflow succeeded; spot-check the live URL.
6. OPTIONAL mirror: redeploy `dist/index.html` to the claude.ai artifact URL in
   the README's "Running it" table (same URL = redeploy) — keeps the private
   mirror current, but the Pages site is canonical.

The hosted artifact is private to the claude.ai account and shareable from
there. `dist/index.html` is fully self-contained, so the file itself can also
be mailed or hosted anywhere as a fallback.
