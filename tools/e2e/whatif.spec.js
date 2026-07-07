/**
 * whatif.spec.js — Level 20, The What-If Machine, end to end.
 *
 * Exercises the promoted n-body regime through the real UI: a pointer-drag
 * launch of a Jupiter-mass body promotes the system; planets demonstrably
 * leave their Kepler rails; scenarios load with verified captions; the
 * kinetic-impactor readout flips from IMPACT to a miss after a strike;
 * restore snaps the planets back to the rails; and missions refuse to fly
 * while massive mode is on. Zero console errors throughout (auto fixture).
 */
'use strict';

const { test, expect, gotoOrrery, pinMenus, screenshot, assertSceneRendered, driveTicks } = require('./orrery');

/** Let the frame loop run until the lying orbit ellipses have faded out. */
async function waitForEllipseFade(page) {
  await page.waitForFunction(() => window.ORRERY.OrbitFlow.railsFade > 0.95, null, { timeout: 8000 });
}

/** Heliocentric deviation (AU) of a promoted planet from its Kepler rail. */
async function offRail(page, key) {
  return page.evaluate((k) => {
    const O = window.ORRERY;
    const h = O.NBody.planetHelioAU(k, {});
    if (!h) return null;
    const p = O.DATA.PLANETS.filter((x) => x.key === k)[0];
    const r = O.Kepler.heliocentric(p.el, O.TimeBar.jd);
    return Math.hypot(h.x - r.x, h.y - r.y, h.z - r.z);
  }, key);
}

async function openSandbox(page) {
  await pinMenus(page);
  await page.click('#opt-sandbox');
  await expect(page.locator('#sandbox-hud')).toHaveClass(/show/);
}

test('drag-launching a Jupiter-mass body promotes the system; restore demotes it', async ({ page }) => {
  await gotoOrrery(page);
  await openSandbox(page);
  await page.click('[data-mass="jupiter"]');

  const vp = page.viewportSize();
  const cx = vp.width / 2, cy = vp.height / 2;
  await page.mouse.move(cx + 190, cy + 40);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy - 80, { steps: 8 });
  await page.mouse.up();

  const promoted = await page.evaluate(() => window.ORRERY.NBody.promoted);
  expect(promoted, 'massive launch promoted the system').toBe(true);
  await expect(page.locator('#sb-massive')).toHaveClass(/show/);

  // Planets are now integrated: a year on, they have left the rails
  // (initial-state agreement is ~1e-8, so any real deviation reads > 1e-7)
  await driveTicks(page, null, 365, 2);
  const dev = await offRail(page, 'mars');
  expect(dev, 'Mars is integrated, not railed').toBeGreaterThan(1e-7);

  await waitForEllipseFade(page);
  await screenshot(page, 'whatif-massive-launch').then(assertSceneRendered);

  await page.click('#sb-restore');
  const after = await page.evaluate(() => ({
    promoted: window.ORRERY.NBody.promoted,
    mars: window.ORRERY.NBody.planetHelioAU('mars', {}),
  }));
  expect(after.promoted, 'restore demotes').toBe(false);
  expect(after.mars, 'Mars renders from its rail again').toBe(null);
  await driveTicks(page, null, 30, 2); // rails integration keeps running clean
});

test('Second Jupiter: belt bodies get eaten, Mars drifts off its ephemeris', async ({ page }) => {
  await gotoOrrery(page);
  await openSandbox(page);
  await page.click('[data-scenario="jupiter2"]');
  await expect(page.locator('#sb-note')).toContainText('second Jupiter');

  await driveTicks(page, null, 365 * 20, 5);
  const state = await page.evaluate(() => ({
    impacts: window.ORRERY.NBody.lost.impact,
    promoted: window.ORRERY.NBody.promoted,
  }));
  expect(state.promoted).toBe(true);
  expect(state.impacts, 'the second Jupiter ate belt bodies (scan: 2 within 10 y)').toBeGreaterThan(0);
  expect(await offRail(page, 'mars'), 'Mars visibly off-rail after 20 y (scan: ~0.1 AU)')
    .toBeGreaterThan(0.03);
  await waitForEllipseFade(page);
  await screenshot(page, 'whatif-second-jupiter').then(assertSceneRendered);
});

test('Rogue star: Neptune is torn off its orbit within ~30 years', async ({ page }) => {
  await gotoOrrery(page);
  await openSandbox(page);
  await page.click('[data-scenario="rogue"]');
  await expect(page.locator('#sb-note')).toContainText('sun-mass star');

  await driveTicks(page, null, 365 * 30, 5);
  expect(await offRail(page, 'neptune'), 'Neptune far off-rail (scan: unbound)').toBeGreaterThan(1);
  await waitForEllipseFade(page);
  await screenshot(page, 'whatif-rogue-star').then(assertSceneRendered);
});

test('Companion star at 50 AU: Neptune wrecked within a century', async ({ page }) => {
  await gotoOrrery(page);
  await openSandbox(page);
  await page.click('[data-scenario="companion"]');
  await expect(page.locator('#sb-note')).toContainText('red dwarf');

  await driveTicks(page, null, 365 * 100, 5);
  expect(await offRail(page, 'neptune'), 'Neptune torn inward (scan: a 30→17 AU)').toBeGreaterThan(3);
  await waitForEllipseFade(page);
  await screenshot(page, 'whatif-companion-star').then(assertSceneRendered);
});

test('DART drill: readout predicts impact, then a real strike deflects it', async ({ page }) => {
  await gotoOrrery(page);
  await openSandbox(page);
  await page.click('[data-scenario="dart"]');
  await expect(page.locator('#sb-note')).toContainText('kinetic impactor');

  // Let the readout tick a few times: undeflected = predicted impact
  await driveTicks(page, null, 60, 1);
  await expect(page.locator('#sb-miss')).toContainText('IMPACT');

  // Strike the asteroid head-on at ~150 d lead (same construction the unit
  // test uses), through the real merge machinery
  await driveTicks(page, null, 60, 1);
  await page.evaluate(() => {
    const O = window.ORRERY;
    const NB = O.NBody;
    const W = O.Sandbox._dev.WHATIF.dart;
    const ast = O.Sandbox._dev.scenario.asteroid;
    const hp = NB.helioOf(ast, {});
    const hv = NB.helioVelOf(ast, {});
    const s = Math.hypot(hv.x, hv.y, hv.z);
    const dir = { x: hv.x / s, y: hv.y / s, z: hv.z / s };
    const rel = 15 / NB.KMS_PER_AUDAY;
    NB.addMassive(
      { x: hp.x + dir.x * 0.012, y: hp.y + dir.y * 0.012, z: hp.z + dir.z * 0.012 },
      { x: hv.x - dir.x * rel, y: hv.y - dir.y * rel, z: hv.z - dir.z * rel },
      { mu: NB.MU * W.impRatio, radius: W.impRadius, label: 'e2e impactor' });
  });
  await driveTicks(page, null, 30, 1);
  await expect(page.locator('#sb-miss')).toContainText('miss');
  const missKm = await page.evaluate(() =>
    parseInt(document.getElementById('sb-miss').textContent.replace(/[^0-9]/g, ''), 10));
  expect(missKm, 'deflected clear of the 15,000 km impact corridor').toBeGreaterThan(15000);
  await waitForEllipseFade(page);
  await screenshot(page, 'whatif-dart').then(assertSceneRendered);
});

test('missions refuse to start while massive mode is active', async ({ page }) => {
  await gotoOrrery(page);
  await openSandbox(page);
  await page.click('[data-scenario="jupiter2"]');
  await pinMenus(page);
  await page.click('#opt-sandbox'); // leave sandbox mode; massive mode persists

  await pinMenus(page);
  await page.click('#opt-missions');
  await page.click('.ms-row'); // first mission → brief
  await page.click('[data-act="aim"]');
  await expect(page.locator('#ms-tip')).toContainText('Massive mode');
  // Still on the brief (the aim state would have swapped the actions away)
  await expect(page.locator('[data-act="aim"]')).toBeVisible();

  // Restore, and the same click-through is allowed again
  await page.evaluate(() => window.ORRERY.Sandbox.restoreReal());
  await page.click('[data-act="aim"]');
  await expect(page.locator('[data-act="aim"]')).toHaveCount(0);
});
