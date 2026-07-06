---
name: playtest-scan
description: Brute-force playtest verification for Mission Designer — REQUIRED before shipping or retuning any mission, par, budget, or win condition, and after any change to the n-body integrator or previewLive.
---

# Playtest scan

Iron rule: **never ship a mission or par that hasn't been beaten by a script.**
A mission that "looks winnable" in the preview may not be — and a par set by
feel is either trivial or impossible.

## Method

Write a node script (scratchpad, not repo) that `eval`s `src/data/bodies.js`,
`src/physics/kepler.js`, `src/physics/nbody.js` with a THREE stub, then scans:

- **departure date** across the mission's plausible window (step a few days),
- **burn direction θ** in-plane (and φ out-of-plane where the target needs it),
- **Δv magnitude** from small up to the budget,

simulating each candidate with the same integrator the app uses (`previewLive`
semantics: moving planets, adaptive substeps) and recording whether the win
condition triggers and at what Δv. This is the voyager-search pattern.

## Setting pars

- Par = found minimum Δv, rounded up slightly (the player aims by hand).
- Star bands: 3★ ≤ par, 2★ ≤ par × 1.3, 1★ any win (see `missions.js finish()`).

## Design constraints (learned the hard way)

- Direct transfers beat slingshots on Δv — if a mission should force a
  slingshot, encode it in the win condition (flyby < tol AND reach radius by
  deadline), never in the budget.
- Keep goals z-tolerant: in-plane aiming can't reach targets sitting far out of
  the ecliptic (Saturn is ~0.4 AU out of plane at typical encounters).
- Window-bound missions (Grand Tour '77) are epoch-anchored (`epoch` field) —
  scan around that epoch only.

## Report

State per mission: min Δv found, at what date/θ, current par, verdict
(winnable / retune needed). Retuned pars go through the scan again.
