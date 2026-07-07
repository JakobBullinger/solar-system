---
name: rebake
description: The offline trajectory-baking pattern (levels 6/15/18/23) — seed from handbook values or a coarse scan, refine by Newton shooting against the app's own integrator, bake constants into a data module, and pin them with a regression test that re-integrates and asserts the encounter. Use whenever a feature ships a precomputed trajectory, launch state, or mission par.
---

# Rebake: offline trajectory baking

Any number the app ships that claims "this state reaches that encounter"
must be *found* offline against the app's own integrator, *baked* as
constants, and *pinned* by a test that re-integrates them. Levels 6
(Voyager search), 15 (New Horizons / Cassini replays), 18 (insertion
champions), and 23 (Mars planner reference arcs) all follow this shape.

## 1. Seed

Get a starting guess that is roughly in the basin:

- **Handbook values** — published windows/C3 (the level-23 route: NASA
  design-handbook departure dates seeded every Lambert transfer), or
- **Coarse scan** — brute-force grid over (departure jd × Δv × direction)
  using a node script that `eval`s the physics modules with a THREE stub
  (the voyager-search pattern; keep scripts in the scratchpad, not the
  repo). `/playtest-scan` is this same idea aimed at mission winnability.

Lambert (`src/physics/lambert.js`) turns a (t1, t2, target) guess into a
velocity seed. **When zero-rev C3 explodes, go multi-rev**: long cruises
past ~one revolution have no sane zero-rev solution — Rosalind Franklin's
26-month arc bottomed out at C3 ≈ 40 zero-rev, while the one-revolution
Lambert family gave C3 21.6. Scan revs = 0 and 1 and take the cheaper.

## 2. Refine (Newton shooting)

Lambert lives in two-body land; the app integrates restricted n-body, so
the seed misses by ~10⁴–10⁵ km. Shoot with the *live* code path
(`previewLive` / the same stepping the frame loop uses — never a private
re-implementation): integrate, measure the miss at the encounter epoch,
Newton-correct the departure velocity via a finite-difference Jacobian,
repeat until the miss is inside tolerance.

**WARNING: fixed-damping Newton shooting diverges near 180° transfers.**
Close to a half-revolution the Jacobian goes ill-conditioned and a
constant step factor oscillates or blows up. Use adaptive damping (halve
the step until the miss actually shrinks) or fall back to bisection along
the correction direction. If it still won't converge, the transfer
geometry itself is the problem — reseed with a different flight time or
rev count rather than force it.

## 3. Bake

Write the found constants — departure jd, velocity vector (full
precision), encounter jd, expected miss — into a data module or the
feature's definition table (`src/data/marsmissions.js`, the replay defs in
`src/ui/replays.js`, mission pars in `missions.js`). Comment each baked
state with how it was found and what it achieves ("42.813 km/s, Jupiter
0.0153 AU on 2007-02-28"). Never leave the search script as the only
record.

## 4. Pin (regression test)

Add a test that **re-integrates the baked state and asserts the
encounter** — precedents to copy: `test/trajectories.test.js` (replay
launch states re-integrated to their flyby distances/dates) and
`test/mars-planner.test.js` (baked departures thread Mars within km-level
tolerance on the reference date; also pins Lambert against 7 published
handbook fixtures). Assert on physical outcomes (encounter distance at
epoch, capture held N days) with honest tolerances, not on raw state
vectors — the test is the canary for any future integrator change, and
`npm test` runs it in CI on every push.

## Checklist

- [ ] Seed: handbook value or coarse scan (multi-rev Lambert checked for long cruises)
- [ ] Refine: Newton shooting through the live integrator path, adaptive damping
- [ ] Verify robustness: re-run at flight *and* preview step sizes / playback-rate jitter (the level-18 36/36 bar)
- [ ] Bake: constants + provenance comment in a data module
- [ ] Pin: regression test re-integrates and asserts the encounter; `npm test` green
