/**
 * orrery.js — the e2e spec library. Import `test`/`expect` from HERE, not
 * from @playwright/test: the exported `test` carries an auto fixture that
 * captures every console error and page error and FAILS the test if any
 * occurred. Zero console errors is the baseline contract of every spec.
 *
 * Encodes the repo's headless verification lore once (see
 * .claude/skills/e2e-harness/SKILL.md for the full failure-mode list):
 *
 * - The app is a self-contained file:// page — no server, no network.
 *   Specs run against `dist/index.html`; build first (`node build.js`).
 * - Long time-lapses cannot use virtual time (Chrome's virtual-time budget
 *   stalls async compute and rAF-driven physics). `driveTicks()` is the
 *   workaround: pause the app clock and call the real integrator entry
 *   point `ORRERY.Sandbox.tick(jd0, jd1)` in a loop — the exact code path
 *   the frame loop uses.
 * - Screenshot pixel truth is asserted by reusing the CI checker
 *   (test/ci/check-screenshot.js), which catches the black-canvas WebGL
 *   fallback that a merely "successful" screenshot call would hide.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const base = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist', 'index.html');
const SHOTS = path.join(__dirname, 'artifacts', 'screenshots');

/**
 * `test` with an automatic console-error trap. The fixture attaches before
 * navigation and asserts after the test body: any console.error or uncaught
 * page error fails the test, whether or not the spec references `errors`.
 */
const test = base.test.extend({
  errors: [
    async ({ page }, use) => {
      const errors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push('[console] ' + msg.text());
      });
      page.on('pageerror', (err) => errors.push('[pageerror] ' + String(err)));
      await use(errors);
      base.expect(errors, 'zero console/page errors is the baseline contract').toEqual([]);
    },
    { auto: true },
  ],
});

/**
 * Navigate to the built app (file://dist/index.html + optional ?/# params,
 * e.g. '?jd=2461000&body=mars' or '?ch=…') and wait until the ORRERY
 * modules are wired and the frame loop has produced real frames.
 */
async function gotoOrrery(page, params, opts) {
  if (!fs.existsSync(DIST)) {
    throw new Error('dist/index.html missing — run `node build.js` first (specs test the built bundle)');
  }
  // Playwright's use.reducedMotion / Chrome's --force-prefers-reduced-motion
  // never reach a file:// page here (PR #2 finding) — emulate it explicitly.
  // Default ON (instant camera snaps, deterministic screenshots); pass
  // { reducedMotion: false } to test real tweens (see camerapath.spec.js).
  const rm = !opts || opts.reducedMotion !== false;
  await page.emulateMedia({ reducedMotion: rm ? 'reduce' : 'no-preference' });
  await page.goto('file://' + DIST + (params || ''));
  await page.waitForFunction(() => {
    const O = window.ORRERY;
    return !!(O && O.TimeBar && O.Sandbox && typeof O.Sandbox.tick === 'function' && O.Missions);
  });
  // The header redesign folded the old always-visible toggle row into the
  // Explore/View menus. Pin both open (they stack in-flow, nothing overlaps)
  // so legacy `page.click('#opt-…')` calls — the ID-preservation contract —
  // stay actionable without touching any spec. The real closed→open→click
  // flow is covered by header.spec.js, which passes { pinMenus: false }.
  if (!opts || opts.pinMenus !== false) {
    await page.evaluate(() => {
      window.ORRERY.Header.setOpen('explore', true);
      window.ORRERY.Header.setOpen('view', true);
    });
  }
  // Two real animation frames: the scene has actually rendered, not just parsed.
  await page.evaluate(
    () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
  );
}

/** Screenshot into tools/e2e/artifacts/screenshots/<name>.png; returns the path. */
async function screenshot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: file });
  return file;
}

/**
 * Assert a screenshot shows a rendered scene by reusing the CI pixel
 * checker (zero-dep PNG decode + lit-pixel sampling). Catches the classic
 * black-canvas failure when WebGL fell back wrong. Throws on failure.
 */
function assertSceneRendered(file) {
  execFileSync(process.execPath, [path.join(ROOT, 'test', 'ci', 'check-screenshot.js'), file], {
    stdio: 'pipe',
  });
}

/**
 * Advance the sandbox/mission integrator by `days` starting at `jd0`
 * (pass null to start at the app clock). THE virtual-time workaround,
 * encoded once: pauses the TimeBar (so the frame loop stops double-stepping
 * the same particles), then drives ORRERY.Sandbox.tick — the live code
 * path — in `stepDays` slices, exactly like the frame loop slices real
 * frames. Leaves the app clock at the final jd; returns it.
 */
async function driveTicks(page, jd0, days, stepDays) {
  return page.evaluate(
    ([start, span, step]) => {
      const TB = window.ORRERY.TimeBar;
      TB.playing = false;
      let jd = start == null ? TB.jd : start;
      const end = jd + span;
      while (jd < end) {
        const next = Math.min(jd + step, end);
        window.ORRERY.Sandbox.tick(jd, next);
        jd = next;
      }
      TB.jd = jd;
      return jd;
    },
    [jd0, days, stepDays || 2]
  );
}

module.exports = {
  test,
  expect: base.expect,
  gotoOrrery,
  screenshot,
  assertSceneRendered,
  driveTicks,
  ROOT,
  DIST,
};
