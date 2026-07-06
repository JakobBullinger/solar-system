---
name: deploy
description: Rebuild the orrery and redeploy dist/index.html to the hosted claude.ai artifact URL. Use after a feature lands on main (post-merge, post-verification).
---

# Deploy

Deploy only from `main`, only after verification — never from a feature
branch/worktree (the artifact is a single URL; deploying mid-feature flip-flops
the hosted version).

1. Confirm on main and clean: `git status -sb`.
2. `node build.js` — must exit clean.
3. Run `/headless-check` if the change wasn't already verified post-merge.
4. Redeploy `dist/index.html` to the existing hosted artifact URL — it's in the
   README's "Running it" table. Same URL = redeploy; a new URL is wrong.
5. Confirm the README Log table has an entry for what shipped; push main.

The hosted artifact is private to the claude.ai account and shareable from
there. `dist/index.html` is fully self-contained, so the file itself can also
be mailed or hosted anywhere as a fallback.
