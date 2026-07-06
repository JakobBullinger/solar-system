---
name: explain-diff
description: Learning-mode walkthrough of a commit range — explains what changed and WHY, with the physics/graphics concepts behind it. Invoke manually after a merge, e.g. `/explain-diff HEAD~1..HEAD`.
disable-model-invocation: true
---

# Explain diff (learning mode)

The user is building this project **to learn**. Given a ref range (default
`HEAD~1..HEAD`):

1. Read the diff (`git diff <range>`) and enough surrounding code for context.
2. Explain, in teaching prose (not a change-list):
   - what changed and the problem it solves,
   - the physics / orbital-mechanics / graphics concepts involved, named
     properly (e.g. "this is a Hohmann transfer window", "this is symplectic
     integration"), with the relevant equations where they illuminate,
   - why this approach over the obvious alternative,
   - what to watch for when touching this code again.
3. Pitch at an interested engineer who is not (yet) an orbital-mechanics or
   WebGL specialist. Prefer "here's the idea, here's where the code embodies
   it (`file:line`)" over restating the code.
4. If the diff revealed a genuinely non-obvious insight, offer to save it —
   as a "Physics notes" bullet in CLAUDE.md (repo-visible) for project truths,
   or to auto-memory for workflow lessons. Ask, don't auto-write.
