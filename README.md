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
- **Replays** (top right): fly real missions start to finish in the app's own
  physics, from the spacecraft's shoulder. **New Horizons** (2006–2015: fastest
  launch ever → Jupiter slingshot → Pluto) and **Cassini–Huygens** (1997–2004:
  Venus → Venus → Earth → Jupiter → captured at Saturn). Chaptered captions keyed
  to the sim clock, a live range/speed readout, dots/arrows to jump chapters
  (each jump re-flies the trajectory deterministically), Esc exits and restores
  your clock
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
- **Missions** (top right): the sandbox with goals. Seven missions launch from
  Earth against a hard Δv budget — drag sets your departure burn (direction +
  size, added to Earth's own velocity), a live preview with *moving* planets
  shows your closest approach, and the gold arc means you've got it. Release
  to review the flight plan: click the arc and drag to add a **mid-course
  burn** at that moment of the flight (same budget), then Launch. Stars for
  Δv efficiency; Grand Tour '77 sets the clock to the real Voyager window;
  **Halo Keeper** asks you to park at Sun–Earth L2 and hold station on the saddle
- **Windows** (top right): the Launch Window Lab — a porkchop plot per target
  planet: departure Δv (color) over 6 years of departure dates × flight time,
  computed live from the app's own physics via a Lambert solver. Gold valleys
  are cheap windows (Mars repeats every ~26 months; scrub to 1977 and pick
  Jupiter to see the window Voyager rode). Hover reads a cell out; click one
  to set the clock to that departure — Venus/Mars/Jupiter open their mission
  ready to aim, window pre-found
- **L-points** (top right): markers for the Sun–Earth and Sun–Jupiter Lagrange
  points L1–L5, each selectable with a dossier of its physics and residents
  (JWST at Earth L2, the Trojan camps at Jupiter L4/L5 — their asteroid swarms
  ride Jupiter's orbit whether the markers are on or not)
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
  ui/missions.js         Mission Designer: goals, aiming, budgets, scoring
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
| 2026-07-06 | 12 · Mission Designer | Six missions with Δv budgets, drag-set departure burns, time-accurate aiming preview (moving planets + live closest-approach), star scoring vs par, localStorage bests. All verified winnable by brute-force playtest; Grand Tour '77 anchored to the real Voyager window and verified to require the slingshot |
| 2026-07-06 | Tooling | CLAUDE.md (architecture + hard-won physics/verification notes) and four Claude Code project skills in `.claude/skills/`: headless-check, playtest-scan, deploy, explain-diff. Levels 13 (challenge links) + 14 (mid-course burns) in development on parallel worktree branches |
| 2026-07-06 | 13 · Challenge links | Mission runs are shareable: `?ch=mission,jd,vx,vy,vz,stars` (burn vector as integer micro-AU/day, ~0.002 km/s precision) replays the exact flight as a ghost run under a "Beat this: ★★★ by a friend" banner — no stars banked, budget-validated against forged links — then hands over for a counter-attempt with a beat/matched/still-theirs verdict. Every win grows a "Copy challenge link" action (`challenge.js`); permalink freezes the URL while the ghost flies; classic `?jd/body` + `#sb=` links untouched. Round-trip verified headless: a 3★ Mars link found by offline search replays to the same 3★ and regenerates a byte-identical link |
| 2026-07-06 | Tooling | ORCHESTRATION.md: multi-agent worktree setup (roles, filesystem protocol, merge order, two-layer verification bar) + planned v2 PR-based flow with CI. Level 13 merged to main, verified, deployed |
| 2026-07-06 | 14 · Mid-course burns | Releasing the departure drag now opens a flight plan: click a point on the previewed arc (each point carries its time-of-flight) and drag a second Δv from it — both burns share the mission budget, and the flight integrator splits its step to fire the impulse at its exact jd (`previewLive` gained scheduled burns + timestamped points). Gold-arc verdicts are now time-gated to the mission limit. Icarus par retuned 18.8 → 15: a two-burn scan (raise aphelion, then kill your speed out there) found a flight-confirmed 14.5 km/s minimum vs ~18.2 single-burn, and the hint teaches the trick. All six missions re-verified 3★-able at par by scans + flight-grade sims; a Grand Tour two-burn scan found nothing below its single-burn minimum, so its par stands. Challenge links replay the departure burn only for now |
| 2026-07-06 | 15 · Mission replays | Narrated, chaptered replays of real missions riding the spacecraft (`replays.js`, reusing the tour card + ride cam): **New Horizons** is fully ballistic — one offline-searched launch state (42.813 km/s, found by stepping the app's own integrator exactly as live playback slices frames) hits Jupiter at 0.0153 AU on 28 Feb 2007, the historical date, then Pluto at ~0.0003 AU on 14 Jul 2015. **Cassini** flies the whole VVEJGA chain (Venus 0.0025 → Venus 0.0025 → Earth 0.0025 → Jupiter 0.020 AU → Saturn, captured); the softened integrator can't bend inner-planet flybys hard enough, so each big assist is applied as a searched reference velocity at closest approach, and SOI is computed live at the detected Saturn closest approach — the chain survives ±35% frame-time jitter. Burns split the integration at their exact jd; chapter jumps re-fly the trajectory deterministically; clock saved/restored on exit. Verified headless through `Sandbox.tick` (the live code path) + UI state assertions + a rendered mid-replay screenshot |
| 2026-07-06 | 16 · Share everything | Challenge links now carry the whole flight plan: `?ch=` gains an optional 4-field suffix (`t` days after departure + the mid-burn vector in the same integer micro-AU/day encoding), validated on replay against the mission's own budget and deadline — legacy 6-field links decode unchanged and single-burn runs still emit them. And every mission now banks your best winning run (burns + launch jd in `orrery-mission-best`, kept when it out-stars or out-thrifts the record): the brief screen grows a "Watch best run · ★★★ 14.8 km/s" action that ghost-replays your own record with a "top yourself" verdict. Verified headless: an offline-searched two-burn 3★ Icarus link (8 + 6.75 km/s, retro at aphelion T+720 d, perihelion 0.068 AU) replays to the same 3★ with the impulse firing in-flight and regenerates a byte-identical link; a legacy Mars link round-trips likewise; over-budget and malformed mid-burn links refuse to fly; best-run record → guard → brief button → replay → banner exercised in the real app |
| 2026-07-06 | 17 · Launch Window Lab | In-app porkchop plots: a universal-variable Lambert solver (`lambert.js`, bisection on z with y<0 treated as z-too-low so >180° transfers never break the bracket) feeds a Δv heatmap per target — 180 departures × 80 flight times over 6 years, computed in async chunks (UI never blocks), painted progressively, cached per target until the clock drifts. Δv is the game's own currency (heliocentric impulse off Earth's rail), so valleys agree with mission pars. Hover reads out a cell; click sets the clock to that departure, and Venus/Mars/Jupiter open their mission aiming at the pre-found window (`Missions.aimAt`, the module's one new entry point). Verified offline (Mars minima 2.8–3.0 km/s spaced 780–820 d; 1977 Jupiter window 10 d from Voyager 1's launch; Lambert arcs re-integrated in `previewLive` hit within mission tolerances) and headless via CDP (grids, valley-vs-plateau contrast 9.4 vs 33.8 km/s for Sep 1977, click-to-aim flow, zero console errors) |
| 2026-07-06 | 19 · Three-Body Room | Lagrange points as first-class citizens: `lagrange.js` solves the CR3BP collinear balance by bisection (roots cached per mass ratio; node-checked: Sun–Earth L1/L2 at 0.0102 AU, Sun–Jupiter L1 at 0.35 AU) and L4/L5 ride ±60°; an **L-points** toggle shows ten selectable markers with dossiers (JWST/Euclid at Earth L2, SOHO's storm-warning perch at L1, the sci-fi Counter-Earth at L3, Lucy touring the Trojans); always-on Trojan swarm clouds track Jupiter's actual L4/L5 bearings. New mission **Halo Keeper**: park within 0.01 AU of Sun–Earth L2 and hold 60 days — departure-only tops out at ~51 d (the saddle is real), so the mid-course burn is the mission. Playtest scan: 6,233 winning plans, 304/400 robust to frame-step jitter, min 0.4 km/s → par 0.5; station-keeping preview runs flight-grade steps (h=0.25), 99% verdict agreement; beaten 3★ in-app headless |

## Ideas / backlog

- Mission Designer v2: more missions (comet rendezvous, Mercury via Venus assist)
- Mission replay chapters (New Horizons, Cassini) via the tour + search machinery
- Extend the tour search to Uranus/Neptune (Voyager 2's full itinerary)
- L-point close-up camera: back the fly-in off the marker glow (post-19 polish)
- Eclipse finder in the almanac
- Procedural moon textures
