---
name: lane-check
description: Pre-PR self-audit that your branch stayed inside its declared lane — run tools/lane-check.sh with your allowed modules/files before the ORCHESTRATION.md final five acts. Flags out-of-lane files and prints line deltas for the shared hotspots so "additive and small" is measured, not claimed.
---

# Lane check (mandatory pre-PR)

Every feature brief declares a lane: the new modules you own plus the
files you may edit. Before starting the ORCHESTRATION.md **final five
acts**, prove you stayed inside it:

```bash
tools/lane-check.sh 'src/ui/myfeature.js' 'test/myfeature.test.js' '.claude/skills/myskill/'
```

- Arguments are files, quoted shell globs, or directories (prefix match).
- The shared hotspots — `src/main.js`, `build.js`, `index.template.html`,
  `styles/app.css`, `README.md` — are implicitly allowed (every lane wires
  into them), but their `+added / -deleted` counts are printed and large
  additions get a WARN. CLAUDE.md says hotspot diffs must be "minimal and
  additive"; this is where that stops being an honor-system claim.
- Any other changed file fails the check (exit 1).
- `--base <ref>` overrides the default diff base of `main` (e.g. after
  fetching, `--base origin/main`).

## When it fails

- **Out-of-lane file you meant to change** — you widened your own lane.
  Ask via `.agent-status.md` / wait for the orchestrator inbox; do not
  just ship it, another agent may own that file this wave.
- **Out-of-lane file you didn't mean to change** — revert it
  (`git checkout main -- <file>`).
- **Hotspot WARN** — reread the diff: can the change shrink, or move into
  your own module? Big hotspot diffs are what merge conflicts are made of.

## Place in the finish sequence

Run lane-check **before** act 1 of the final five (re-read inbox → rebase
→ test → push → PR), and again after the rebase if the rebase touched
anything. Paste its output into the PR body's "what changed" section —
it is the mechanical summary of your diff shape.
