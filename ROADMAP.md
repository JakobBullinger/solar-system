# Roadmap

Forward-looking plans. What already shipped is in the README's Log table;
how we work is in ORCHESTRATION.md. Keep this file updated when plans change —
it is the only place forward plans live *in the repo* (session memory mirrors
it but is machine-local).

## In flight

(nothing — 2026-07-08 landed: Grand Tour v2 + visitor guide (#21), README
landing page (#23), three user-reported fix lanes (HUD overlap #20, GEO
label declutter #22, replay caption dodge #24), and the e2e speed lane
(#25: 4-worker parallel suite 2.4m local / 5.5m CI, five latent flakes
root-caused). Previously: wave 7 landed 2026-07-07/08: Level 28 Real Earth (#18), Level 29
Orbital Zoo (#17), ascent ride-along (#19). The overnight laptop sleep
killed all three lanes mid-flight; all three were recovered — resume-from-
transcript, takeover agent, and an orchestrator hand-finish respectively.
Level 21 Mission Control remains gated on human playtest feedback (user:
"later").)

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

- L-point close-up camera: back the fly-in off the marker glow.
- Photo mode; bloom/post-processing; planet shaders II (flowing Jupiter
  bands, ocean glint, aurorae) — the "cinematic" list, additive polish.
- Comet rendezvous + Venus-assist-to-Mercury missions (better with burns +
  insertion now in the game).
- Sandbox HUD phone layout pass (mobile-audit deferral: buttons 23–28px,
  HUD fills half the screen — needs layout work, not CSS appends).
- Per-pixel lunar-eclipse gradient (eclipse-lane deferral: tint is
  whole-disk today); umbra-blob look retune in shaders.js.
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
