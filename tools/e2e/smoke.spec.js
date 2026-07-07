/**
 * smoke.spec.js — the example spec and the harness's own proof of life.
 *
 * Three tests, one per library capability: clean load + rendered-pixels
 * assertion, a UI interaction (Missions HUD), and driveTicks() pushing a
 * test particle through 120 days of n-body physics without virtual time.
 * Every test also inherits the auto console-error trap from orrery.js —
 * a single console error anywhere fails the run.
 */
'use strict';

const {
  test,
  expect,
  gotoOrrery,
  screenshot,
  assertSceneRendered,
  driveTicks,
} = require('./orrery');

test('app loads with zero console errors and a rendered scene', async ({ page }) => {
  await gotoOrrery(page);
  const shot = await screenshot(page, 'smoke-loaded');
  assertSceneRendered(shot); // catches the black-canvas WebGL fallback
});

test('missions HUD opens from the toolbar', async ({ page }) => {
  await gotoOrrery(page);
  await page.click('#opt-missions');
  await expect(page.locator('#missions-hud')).toHaveClass(/show/);
  expect(await page.evaluate(() => window.ORRERY.Missions.active)).toBe(true);
  await screenshot(page, 'smoke-missions-hud');
});

test('driveTicks advances the live integrator across 120 days', async ({ page }) => {
  await gotoOrrery(page);

  // Freeze the clock, then drop a circular test body at 1 AU
  // (v_circ = 2π/365.25 ≈ 0.01720 AU/day, in-plane).
  const jd0 = await page.evaluate(() => {
    const O = window.ORRERY;
    O.TimeBar.playing = false;
    O.Sandbox.addBody({ x: 1, y: 0, z: 0 }, { x: 0, y: 0.01720, z: 0 }, '#7fd4ff');
    return O.TimeBar.jd;
  });

  const jd1 = await driveTicks(page, jd0, 120);
  expect(jd1).toBeCloseTo(jd0 + 120, 6);

  const body = await page.evaluate(() => window.ORRERY.Sandbox.serialize()[0]);
  expect(body).toBeTruthy(); // survived (not swallowed by the Sun)
  const [x, y, z] = body.pos;
  const r = Math.hypot(x, y, z);
  expect(r).toBeGreaterThan(0.9); // circular orbit held its radius…
  expect(r).toBeLessThan(1.1);
  const swept = Math.hypot(x - 1, y, z);
  expect(swept).toBeGreaterThan(1.0); // …and swept ~2 rad around the Sun
});
