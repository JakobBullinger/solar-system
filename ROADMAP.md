# Roadmap

Forward-looking plans. What already shipped is in the README's Log table;
how we work is in ORCHESTRATION.md. Keep this file updated when plans change —
it is the only place forward plans live *in the repo* (session memory mirrors
it but is machine-local).

## In flight (launched 2026-07-07, background-subagent lanes)

- **CI e2e gate** (`../solar-system-ci`, `feature/ci-e2e`): the full
  Playwright suite as a CI job on PRs, with a proven-red teeth check.
  Merges FIRST (small; then the Level 24 PR gets the new gate).
- **Level 24 — Earth Orbit & Starlink** (`../solar-system-earth`,
  `feature/earth-orbit`, port 4175): DONE, PR open — Earth-centered
  km/minutes regime + structural Starlink (real Gen1 shells, synthetic
  Walker catalog, no TLEs/zero network) + ISS/GEO/Moon anchors. The
  rocket-ascent ride-along stretch was deliberately not attempted — moved
  to the backlog. Level 21 Mission Control remains gated on human playtest
  feedback about mission pars/difficulty.

## Next, in order

- **Level 21 — Mission Control**: campaign/progression tying missions 13–20
  together — unlock arc from "reach Mars" through slingshots, L2
  station-keeping, and asteroid deflection. Mostly game design; the pieces
  exist. Needs human playtest feedback on pars/difficulty first.

## Hosting arc (learning ladder; step 1 done 2026-07-07)

1. ✅ Public repo + GitHub Pages: `.github/workflows/deploy.yml` ships
   `dist/index.html` to https://jakobbullinger.github.io/solar-system/ on
   every push to main (CI verifies, Deploy ships).
2. Custom domain: DNS CNAME → Pages, auto-HTTPS. Learn: DNS, certificates.
3. PR preview deployments (per-PR live URLs for reviewing features by
   playing them). Learn: ephemeral environments.
4. The backend moment — challenge-link leaderboards need the first
   server-side state (tiny API + DB; app stays offline-capable, leaderboard
   is optional enhancement). Learn: servers, persistence, auth.
5. Only then, and only if wanted: containers, observability.

## Backlog (small, any gap)

- Eclipse finder in the almanac + animated umbra sweep (level-25 stretch,
  not attempted).
- Rocket ascent ride-along in the Earth-orbit regime (level-24 stretch, not
  attempted): scripted launch-to-LEO camera ride on a baked kinematic
  gravity-turn profile, honestly labeled — the regime's km scale and time
  controls are already in place for it.
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
