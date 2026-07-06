# Solar System — Live Orrery

Interactive 3D solar system: real Keplerian orbits, n-body gravity sandbox,
Mission Designer game. Zero dependencies — everything bundles into a single
self-contained `dist/index.html`. The README is the running log and user-facing
reference; **update its Log table after every landed change**.

## Commands

- `npm run dev` — dev server with rebuild-on-save at http://localhost:4173 (`node serve.js <port>` for another port)
- `npm run build` — bundle to `dist/index.html` (this is also the deploy artifact; see `/deploy`)

## Conventions

- Plain ES5-style IIFE modules on the `window.ORRERY` namespace. No framework,
  no npm dependencies, no network requests at runtime.
- `build.js` concatenates in dependency order: data → physics → scene → ui → main.
  **New source files must be registered there.**
- `dist/` is generated and gitignored — never edit it.
- Match the existing comment style: a header block explaining each module's
  physics/design rationale, sparse inline comments only where the math needs it.

## Architecture

- `src/data/bodies.js` — JPL Keplerian elements (J2000 + per-century rates), facts, moons, comets
- `src/physics/kepler.js` — Kepler solver, heliocentric positions, scene compression `sceneR = 62·AU^0.52`
- `src/physics/nbody.js` — restricted n-body (Sun + 8 planets), leapfrog w/ adaptive substeps, `previewLive`
- `src/physics/almanac.js` — oppositions/elongations/conjunctions + tonight's-sky visibility
- `src/scene/` — textures (procedural), bodies3d, comets3d, environment, shaders (terminators, eclipses)
- `src/ui/` — timebar, panel, labels, almanac-ui, sandbox, tour, ride, permalink, missions
- `src/main.js` — wiring, camera, frame loop

## Physics notes (hard-won, don't rediscover)

- Kepler solver starts Newton at E₀ = π for e > 0.8 — globally convergent for comets.
- Scene distances are compressed (`kepler.js DIST_K/DIST_P`); anything mixing scene
  and AU space must convert via `toScene`/`sceneToAU`, and close flybys can pass
  "inside" planet meshes (ride.js pushes the camera out).
- Heliocentric impulse economics: direct transfers are cheaper in Δv than
  slingshots — force slingshots via win conditions (flyby distance + reach radius
  + deadline), never via budgets.
- In-plane 2D aiming cannot reach Saturn < 0.5 AU (Saturn sits ~0.4 AU out of
  plane at encounter) — keep mission goals z-tolerant.
- Never ship or retune a mission par without brute-force playtest verification — see `/playtest-scan`.

## Verification

- No test suite; verification is driving the real app — see `/headless-check`
  for the headless-Chrome recipe (plain `--disable-gpu` gives a black canvas).
- Long time-lapses can't use virtual time: drive `ORRERY.Sandbox.tick(jd, jd+n)`
  directly from an injected script.
- Physics can be tested in plain node: small scripts that `eval` the modules
  with a THREE stub (see the voyager-search scripts pattern).

## Workflow

- Parallel feature work happens in sibling git worktrees (`git worktree list`);
  feature branches merge to main via the orchestrator session. Keep diffs in
  shared hotspots (`main.js`, `index.template.html`, `build.js`, `styles/app.css`,
  README) minimal and additive.
- After merging to main: rebuild, `/headless-check`, update README log, push,
  `/deploy` to the hosted artifact.
