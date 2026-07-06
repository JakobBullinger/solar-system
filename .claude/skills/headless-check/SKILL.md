---
name: headless-check
description: Verify the orrery visually/behaviorally without a display — headless Chrome recipe (SwiftShader flags, virtual-time caveats) plus how to drive the sandbox integrator directly. Use after any change to scene, shaders, UI, physics, or before deploying.
---

# Headless verification

Always rebuild first: `node build.js` (must exit clean).

## Screenshot / smoke test

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --use-angle=swiftshader --enable-unsafe-swiftshader \
  --force-prefers-reduced-motion \
  --window-size=1600,1000 --virtual-time-budget=15000 \
  --screenshot=/tmp/orrery.png "file://$PWD/dist/index.html"
```

- Plain `--disable-gpu` renders a **black canvas** — SwiftShader flags are mandatory.
- `--force-prefers-reduced-motion` makes camera fly-ins instant (SwiftShader frames
  are too slow for tweens to finish inside the virtual-time budget).
- Append `#` params / `?jd=…&body=…` to the URL to screenshot a specific state
  (permalinks encode full app state).

## Behavioral checks (evaluate JS in the page)

Use `--headless=new --dump-dom` with an injected `<script>`, or run Chrome with
`--remote-debugging-port` and drive via CDP. Key rule:

- **Long time-lapses cannot use virtual time.** Instead call the integrator
  directly in a loop: `ORRERY.Sandbox.tick(jd, jd + 2)` stepping jd forward,
  then assert on body positions/state.

## Pure-physics checks (no browser)

Small node scripts that `eval` the physics modules with a THREE stub — the
pattern used by the voyager-search scripts. Fastest loop for integrator or
Kepler-solver changes; keep such scripts in the session scratchpad, not the repo.

## Minimum bar before declaring a change verified

1. `node build.js` clean.
2. Screenshot shows a rendered scene (not black, not missing UI).
3. The changed feature exercised end-to-end (behavioral check or targeted permalink screenshot).
