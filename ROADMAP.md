# Roadmap

Forward-looking plans. What already shipped is in the README's Log table;
how we work is in ORCHESTRATION.md. Keep this file updated when plans change —
it is the only place forward plans live *in the repo* (session memory mirrors
it but is machine-local).

## In flight (wave 6, launched 2026-07-07 evening, background-subagent lanes)

- **PR previews** (`../solar-system-previews`, `feature/pr-previews`):
  hosting-arc step 3 — per-PR live URLs on Pages + auto-comment + cleanup.
  Merges FIRST (then the sibling PRs get preview links).
- **Level 27 — Eclipse finder** (`../solar-system-eclipse`,
  `feature/eclipse-finder`, port 4174): real truncated-series lunar position
  (`physics/moon.js` — the deliberately-deferred "real lunar elements"
  moment), syzygy eclipse search verified vs the published canon (incl.
  2026-08-12 total), almanac section + umbra-sweep spectacle.
- **Mobile/touch audit** (`../solar-system-mobile`, `feature/mobile-touch`,
  port 4176): Playwright touch-emulation audit of waves 3–5 modes, fix
  unreachable/broken touch paths (Earth-orbit + cosmos pinch entries,
  drags, drawers), `mobile.spec.js`. Merges LAST (broadest UI surface).

Level 21 Mission Control remains gated on human playtest feedback about
mission pars/difficulty (user: "later").

## Next, in order

- **Level 21 — Mission Control**: campaign/progression tying missions 13–20
  together — unlock arc from "reach Mars" through slingshots, L2
  station-keeping, and asteroid deflection. Mostly game design; the pieces
  exist. Needs human playtest feedback on pars/difficulty first.

## Hosting arc (learning ladder; steps 1+3 done 2026-07-07)

1. ✅ Public repo + GitHub Pages: `.github/workflows/deploy.yml` ships
   `dist/index.html` to https://jakobbullinger.github.io/solar-system/ on
   every push to main (CI verifies, Deploy ships).
2. Custom domain: DNS CNAME → Pages, auto-HTTPS. Learn: DNS, certificates.
3. ✅ PR preview deployments: Pages serves the `gh-pages` branch — Deploy
   owns the root, `pr-preview.yml` parks each same-repo PR's build at
   `previews/pr-<n>/` with a sticky auto-comment, deleted on close.
   Learned: ephemeral environments, artifact- vs branch-mode Pages,
   shared-branch write races (rebase-retry), sticky-comment upsert.
4. The backend moment — challenge-link leaderboards need the first
   server-side state (tiny API + DB; app stays offline-capable, leaderboard
   is optional enhancement). Learn: servers, persistence, auth.
5. Only then, and only if wanted: containers, observability.

## Backlog (small, any gap)

- Rocket ascent ride-along in the Earth-orbit regime (level-24 stretch, not
  attempted): scripted launch-to-LEO camera ride on a baked kinematic
  gravity-turn profile, honestly labeled — the regime's km scale and time
  controls are already in place for it.
- L-point close-up camera: back the fly-in off the marker glow.
- Photo mode; bloom/post-processing; planet shaders II (flowing Jupiter
  bands, ocean glint, aurorae) — the "cinematic" list, additive polish.
- Comet rendezvous + Venus-assist-to-Mercury missions (better with burns +
  insertion now in the game).
- Command palette / search: press `/`, type "Halley" / "eclipse" / "ride
  ISS" → fly there. Discoverability for ~27 levels of buried features
  (brainstorm 2026-07-07).
- Performance pass on a mid-range phone: frame budget with Starlink's 4,408
  instanced sats + all overlay modes (brainstorm 2026-07-07).
- Historical sky / "your birthday sky": almanac machinery + a date input →
  that night's sky, shareable permalink (brainstorm 2026-07-07).
- Procedural sound (offline-pure, zero-asset): Kepler-driven ambient tones,
  burn rumble; would transform director/attract mode (brainstorm 2026-07-07).
- Wildcards: light-time delay rendering; low-thrust ion propulsion missions;
  WebXR/VR mode (wave-sized).

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
