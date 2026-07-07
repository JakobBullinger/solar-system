# Roadmap

Forward-looking plans. What already shipped is in the README's Log table;
how we work is in ORCHESTRATION.md. Keep this file updated when plans change —
it is the only place forward plans live *in the repo* (session memory mirrors
it but is machine-local).

## In flight

- **Level 20 — The What-If Machine** (solo lane, `feature/what-if-machine`):
  massive sandbox bodies perturbing the planets; promoted-planet integration
  regime (rails regime must stay bit-identical — the trajectory regression
  guard is the judge); scenario library (Second Jupiter, Companion Star,
  Rogue Star, DART deflection); missions locked out of massive mode.

## Next, in order

- **Level 21 — Mission Control**: campaign/progression tying missions 13–20
  together — unlock arc from "reach Mars" through slingshots, L2
  station-keeping, and asteroid deflection. Mostly game design; the pieces
  exist. Needs human playtest feedback on pars/difficulty first.
- **Level 24 — Earth Orbit & Starlink** (deliberately deferred until now-ish;
  wave-sized): new Earth-centered scale regime (km/minutes), STRUCTURAL
  Starlink constellation render (real shells/planes/inclinations, synthetic
  catalog — no live TLEs, zero-network purity), rocket ascent ride-alongs.

## Backlog (small, any gap)

- Eclipse finder in the almanac + animated umbra sweep (level-25 stretch,
  not attempted).
- L-point close-up camera: back the fly-in off the marker glow.
- Photo mode; bloom/post-processing; planet shaders II (flowing Jupiter
  bands, ocean glint, aurorae) — the "cinematic" list, additive polish.
- Comet rendezvous + Venus-assist-to-Mercury missions (better with burns +
  insertion now in the game).
- CI: run the Playwright e2e suite on PRs (needs Chrome or `playwright
  install` on the runner) — today CI runs build + unit tests + smoke only.
- Wildcards: light-time delay rendering; low-thrust ion propulsion missions.

## Deliberately deferred

Exoplanets, real lunar orbital elements, multiplayer, live network data of
any kind (the artifact stays a self-contained offline file).

## Working from a new machine

1. Clone: `git clone git@github.com:JakobBullinger/solar-system.git`
   (personal account; set repo-local `git config user.name "Jakob Bullinger"`
   and `user.email jfx.bullinger@gmx.de` if the machine has no includeIf
   rule; add an SSH key to the personal GitHub account).
2. `gh auth login` with the personal account (PR flow needs it).
3. `npm install` (dev-only deps: Playwright on system Chrome), `npm test`,
   `npm run e2e`, `node build.js` — all green means the machine is ready.
4. Read CLAUDE.md + ORCHESTRATION.md + this file; that's the whole context.
   Claude Code sessions rebuild project memory from these three files.
5. The hosted artifact redeploys from any Claude Code session logged into
   the same claude.ai account (URL in the README).
