# Solar System — Live Orrery

An interactive, self-contained 3D solar system in the browser. Planet, comet and
moon positions come from real orbital mechanics (JPL Keplerian elements), a time
engine scrubs from real-time to a year per second, and a gravity sandbox lets you
launch bodies into genuine n-body physics — including a recreation of the
Voyager grand tour.

No framework, no dependencies, no network requests: everything (three.js,
procedural textures, physics, UI) bundles into a single `dist/index.html`.

## Running it

| How | Where |
|---|---|
| Hosted (no terminal needed) | https://claude.ai/code/artifact/6cebdb03-7a56-40d8-b300-d5e4ed6170ac |
| Dev server (auto-rebuild on save) | `npm run dev` → opens http://localhost:4173 |
| Just build | `npm run build` → open `dist/index.html` in any browser |

`dist/index.html` is fully self-contained — it can be double-clicked, mailed,
or hosted anywhere as a static file. The hosted artifact is private to your
claude.ai account (shareable from there); after changes, redeploy the rebuilt
`dist/index.html` to the same URL.

## Using the app

- **Share any moment**: the address bar always encodes the current view —
  `?jd=…&body=…&play=0` plus sandbox bodies in the `#sb=` hash. Copy the URL
  at a paused conjunction or with your creations flying and the link reproduces it
- **✦ Tour** (top right): a ~2-minute guided cinematic tour — Sun, Earth's spin,
  Jupiter's moons, Saturn, Halley in 1986, the Voyager grand tour — with captions.
  Auto-advances; arrow keys / dots navigate, Esc exits and restores your clock
- **Drag** to orbit, **scroll** to zoom, **click** a body (or its chip/label) to visit it
- **Space** pauses time; the time bar scrubs from real-time to 1 yr/s, presets + "Today"
- **Panel** shows a dossier per body: facts, stats, live distance/velocity from the physics
- **Planets with moons** list them in the panel — click to visit (e.g. Jupiter → Europa)
- **Comets** (Halley, Encke) grow comas and twin tails as they near the Sun;
  their panel has "jump to next perihelion"
- **Events** (top right): sky almanac of oppositions, elongations and conjunctions
  for the next 4 years, computed live — click one to time-jump there. Topped by
  **"The sky tonight"**: where the naked-eye planets are in the real sky right now
  (evening/morning/all night/hidden), with a teaser pill on load showing the
  headline planet and the next event countdown
- **Sandbox** (top right): drag anywhere in space to launch a body into real
  Sun + 8-planet gravity. Teal preview arc = captured orbit, red = escapes.
  Presets: **★ Voyager grand tour**, Mars transfer, mini belt, sun-diver, interstellar
- **Ride along**: chase-cam any sandbox body ("Ride along" in the sandbox HUD —
  launch the Voyager preset and ride the flybys) or a comet (button in its
  dossier). Scroll adjusts distance, Esc exits
- **True size** rescales planets to honest ratios vs the Sun

## Architecture

Plain ES5-style IIFE modules on a `window.ORRERY` namespace, concatenated in
dependency order by `build.js` (data → physics → scene → ui → main):

```
index.template.html      markup shell; {{CSS}} {{VENDOR}} {{APP}} placeholders
styles/app.css           all styling
vendor/                  three.js + OrbitControls
src/
  data/bodies.js         Sun/planet/moon/comet data; JPL Keplerian elements (valid 1800–2050)
  physics/kepler.js      Kepler solver, heliocentric positions, scene-space compression
  physics/almanac.js     sky-event finder (oppositions, elongations, conjunctions)
  physics/nbody.js       restricted n-body integrator for the sandbox (AU/day units)
  scene/textures.js      procedural canvas textures (planets, night lights, clouds, rings, glows)
  scene/shaders.js       custom materials: terminator, atmosphere rims, analytic shadows
  scene/environment.js   starfield, Milky Way band, asteroid + Kuiper belts
  scene/bodies3d.js      Sun/planet/ring/moon meshes and orbit lines
  scene/comets3d.js      comet nucleus, coma, ion + dust particle tails
  ui/timebar.js          simulation clock: Julian date advanced by a signed rate
  ui/labels.js           screen-projected HTML labels
  ui/panel.js            body dossier panel
  ui/almanac-ui.js       events drawer
  ui/sandbox.js          drag-to-launch, trails, presets, HUD
  ui/tour.js             guided cinematic tour: stops script, captions, choreography
  ui/ride.js             ride-along chase camera (probes, comets)
  ui/permalink.js        deep links: URL ↔ app state (clock, selection, sandbox)
  main.js                bootstrap: scene graph, render loop, camera, picking
build.js                 bundler → dist/index.html
serve.js                 dev server with watch + rebuild
```

### Physics notes

- **Positions**: Keplerian elements at epoch J2000 with per-century rates
  (JPL "Approximate Positions of the Planets"), Newton-iterated Kepler solver.
  For comet eccentricities (Halley e=0.967) the iteration starts at E₀=π,
  which is globally convergent.
- **Scene compression**: true AU distances are compressed with a power law
  (`sceneR = 62·AU^0.52`) so the outer system stays on screen while ordering
  and eccentricity remain honest. Same mapping everywhere (planets, belts,
  comet tails, sandbox trails).
- **Sandbox integrator** (`nbody.js`): kick-drift-kick leapfrog in heliocentric
  AU/days; test particles feel Sun + 8 planets (JPL mass ratios) incl. the
  indirect frame term. Substeps ≤ 0.25 d, refined near the Sun by local
  dynamical time; swept-segment collision test so sun-divers can't step across
  the Sun. Time-symmetric — scrubbing backwards works.
- **Almanac**: daily-grid scan + bisection/ternary refinement. Verified against
  published dates (Saturn opposition 2026-10-04, Mars opposition 2027-02-19 exact).
- **Shading** (`shaders.js`): the Sun sits at the world origin, so the sun
  direction at any fragment is `-normalize(worldPos)` — no light uniforms.
  Planet shader: day/night terminator, Earth night-lights map (same noise seed
  as the day texture's landmask), per-planet atmosphere fresnel rim, and
  analytic object-space shadows: the ring annulus band on Saturn, the planet's
  shadow across its rings, and up to four moon shadows on a disk (so Galilean
  eclipses just happen). Per-frame uniforms via updaters driven from the loop.
- **Voyager preset** (`sandbox.js` `VOYAGER` const): launch window found by an
  offline search against this exact integrator (coarse scan → Jupiter-targeting
  → aim-plane scan → coordinate descent). Departs Earth 6 Aug 1977 at 38.5 km/s
  (θ=10.9215° in-plane, φ=−3.2301° out-of-plane) → Jupiter flyby 0.0094 AU on
  1979-12-12 → Saturn 0.0006 AU on 1982-10-25. Stable for frame chunks 0.5–5 d.

### Verifying changes

- Physics: small node scripts that `eval` the modules with a THREE stub
  (see conventions in git-less scratchpad workflow below).
- Visual: headless Chrome needs SwiftShader —
  ```
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
    --use-angle=swiftshader --enable-unsafe-swiftshader \
    --window-size=1600,1000 --virtual-time-budget=15000 \
    --screenshot=out.png "file://$PWD/dist/index.html"
  ```
  (plain `--disable-gpu` renders a black canvas). Long time-lapses can't rely on
  virtual time; drive `ORRERY.Sandbox.tick(jd, jd+2)` in a loop from an injected
  script instead.

## Log

| Date | Level | What landed |
|---|---|---|
| 2026-07-02 | 1 · Scene | Sun, 8 planets + Pluto, procedural textures, starfield/Milky Way, asteroid + Kuiper belts, orbit camera |
| 2026-07-02 | 2 · Living physics | JPL Kepler engine, time bar (real-time → 1 yr/s), dossier panel with live telemetry, true-size mode, orbit lines, picking |
| 2026-07-02 | 3 · Wanderers | Comets Halley + Encke: distance-driven coma and ion/dust tails, dashed orbits, "jump to next perihelion" |
| 2026-07-06 | 4 · Events & moons | Moons selectable with own dossiers (Moon, Galileans, Titan), sky almanac drawer (oppositions/elongations/conjunctions, verified vs published dates), time-jump with auto-pause |
| 2026-07-06 | 5 · Sandbox | Restricted n-body gravity layer, drag-to-launch with bound/escape preview, presets (Mars transfer, mini belt, sun-diver, interstellar), fading trails, swallowed/escaped bookkeeping |
| 2026-07-06 | 6 · Grand tour | Voyager preset: offline launch-window search reproduced a 1977 Earth → Jupiter → Saturn slingshot chain in-app |
| 2026-07-06 | Tooling | Dev server (`serve.js`, `npm run dev`), this README as running log/reference, app published to a hosted URL |
| 2026-07-06 | 7 · Cinematic tour | Guided 8-stop tour: camera choreography via `focus`/`flyHome`, per-stop time rates, Halley-1986 + Voyager-1977 time-travel stops, caption card with auto-advance, UI auto-hide, clock restored on exit |
| 2026-07-06 | 8 · Worlds up close | Git repo initialized. Custom shaders: day/night terminators, Earth city lights + drifting clouds, atmosphere rims per planet, Saturn ring↔planet mutual shadows, moon transit shadows, limb-darkened animated Sun |
| 2026-07-06 | 9 · Sharing & mobile | Deep links (URL ↔ full app state incl. sandbox bodies), viewport + PWA meta with data-URI manifest/icon, touch-action + small-screen layout pass, first-visit tour offer |
| 2026-07-06 | 10 · Ride-along | Chase camera for sandbox probes and comets: ride the Voyager flybys from the probe's shoulder; scroll-zoom, Esc exit, auto-exit on body death, planet-interior avoidance |
| 2026-07-06 | 11 · Tonight's sky | Elongation-based visibility for naked-eye planets (real clock, not sim clock), "sky tonight" section in the almanac, load-time teaser pill with next-event countdown, "in Nd" chips on event rows |

## Ideas / backlog

- Mission Designer game mode (north star): Δv budget, targets, scoring,
  shareable challenges via deep links
- Mission replay chapters (New Horizons, Cassini) via the tour + search machinery
- Extend the tour search to Uranus/Neptune (Voyager 2's full itinerary)
- Eclipse finder in the almanac
- Procedural moon textures
