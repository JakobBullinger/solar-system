---
name: e2e-harness
description: Write and run real browser e2e specs for the orrery with Playwright + system Chrome — console-error trap, rendered-pixel assertion, driveTicks virtual-time workaround. Use for every feature agent's end-to-end verification (the "changed feature exercised end-to-end" bar) instead of hand-rolled headless-Chrome one-offs.
---

# E2E harness (Playwright, dev-only)

`npm run e2e` runs the specs in `tools/e2e/*.spec.js` against the built
`dist/index.html` using the **system Chrome** (`channel: 'chrome'` — no
browser download; runtime stays zero-dep, Playwright is devDependencies
only). Always `node build.js` first: specs test the bundle, not `src/`.

CI does not run these yet (the runner would need Chrome or a
`playwright install` step) — that's documented future work. Locally this
is the verification workhorse; `/headless-check` remains the recipe for
quick one-off screenshots.

## Writing a spec

Import from the library, **not** from `@playwright/test` — the library's
`test` carries an automatic console-error trap that fails any test on any
console error or uncaught page error:

```js
const { test, expect, gotoOrrery, screenshot, assertSceneRendered,
        driveTicks } = require('./orrery');

test('my feature works end-to-end', async ({ page }) => {
  await gotoOrrery(page, '?jd=2461000&body=mars');   // ?/#params optional
  await page.click('#opt-missions');
  await expect(page.locator('#missions-hud')).toHaveClass(/show/);
  const shot = await screenshot(page, 'my-feature');  // tools/e2e/artifacts/
  assertSceneRendered(shot);                          // pixel-truth via CI checker
  await driveTicks(page, null, 365);                  // a year of real physics
  // …assert on ORRERY state via page.evaluate
});
```

Library (`tools/e2e/orrery.js`):

- `gotoOrrery(page, params?)` — file:// navigation + waits for the ORRERY
  modules and two real rendered frames. Pins the header's Explore/View menus
  open so legacy `page.click('#opt-…')` calls stay actionable (pass
  `{ pinMenus: false }` to test the real closed→open flow).
- `pinMenus(page)` — re-pin the menus. Clicking any Explore item closes that
  menu again, so gotoOrrery's pin only covers the FIRST `#opt-…` click —
  call this before every subsequent one or the button is `display:none`
  and the click times out.
- `screenshot(page, name)` — PNG into `tools/e2e/artifacts/screenshots/`.
- `assertSceneRendered(file)` — reuses `test/ci/check-screenshot.js`
  (zero-dep PNG decode, lit-pixel sampling).
- `driveTicks(page, jd0, days, stepDays=2)` — pauses the TimeBar and calls
  `ORRERY.Sandbox.tick(jd, jd+step)` in a loop, the live frame-loop code
  path; `jd0 = null` starts at the app clock. Returns the final jd.

Config: `tools/e2e/playwright.config.js` (1600×1000, single worker,
SwiftShader launch args). New spec = new `tools/e2e/<name>.spec.js`; no
registration needed.

## Failure modes this harness exists to prevent

Each of these burned a session before it was encoded here — do not
rediscover them:

- **Virtual time stalls async compute.** Chrome's `--virtual-time-budget`
  freezes rAF-driven physics and chunked async work (porkchop grids,
  long cruises), so "wait N days" specs hang or silently test nothing.
  Never use virtual time for time-lapses: `driveTicks` drives the real
  integrator entry point directly.
- **`--disable-gpu` = black canvas.** WebGL falls back wrong and every
  screenshot is pitch black while the test "passes". The config bakes the
  SwiftShader flags (`--use-angle=swiftshader --enable-unsafe-swiftshader`);
  `assertSceneRendered` catches any regression by sampling actual pixels.
- **SwiftShader canvas `blur()` poisons textures** (wave 3). Procedural
  textures built with canvas filter/blur come out as garbage texels under
  SwiftShader and visually poison the scene — locally-fine texture code can
  fail only headless. If a screenshot shows corrupted surfaces, suspect a
  canvas filter in `src/scene/textures.js` before suspecting the harness.
- **Opacity-0 lines still write depth** (wave 3, level 22). Fading a line
  to opacity 0 leaves it writing to the depth buffer, punching invisible
  black arcs into additive passes. Faded-out objects must be `visible =
  false`, not merely transparent — screenshot specs of overlay/zoom states
  are how this class of bug gets caught.
- **Tween-blur screenshots.** Camera fly-ins mid-screenshot make flaky
  pixel checks; `--force-prefers-reduced-motion` + `reducedMotion:
  'reduce'` are baked into the config so transitions land instantly.

## Bar for a feature agent

`npm test` green + `npm run e2e` green (including your new spec) is the
minimum before the ORCHESTRATION.md final five acts. A feature spec should
end-to-end the *changed* behavior: drive the UI the user would, assert
ORRERY state via `page.evaluate`, and keep one screenshot as the visual
record.
