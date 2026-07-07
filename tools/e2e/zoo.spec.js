/**
 * zoo.spec.js — Level 29, The Orbital Zoo, end to end.
 *
 * Enters the Earth-orbit regime (same entry as earthorbit.spec.js), opens
 * each new family's dossier, screenshots the two ground-track money shots
 * (Molniya's self-crossing figure-8, ISS's marching sinusoid), and drives
 * the clock across a verified 2026 equinox eclipse window to prove a named
 * GEO satellite actually dims (state flip), not just that a boolean exists
 * somewhere. Zero console errors throughout (auto fixture).
 */
'use strict';

const { test, expect, gotoOrrery, screenshot, assertSceneRendered } = require('./orrery');

/** Snap the sim clock to an absolute jd and let one real frame apply it. */
async function snapTo(page, jd) {
  await page.evaluate((j) => {
    const TB = window.ORRERY.TimeBar;
    TB.playing = false;
    TB.snapJd(j);
  }, jd);
  await page.evaluate(
    () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
  );
}

/** Frame the camera looking down at Earth from a fixed elevated bearing. */
async function frameEarth(page, dist, elevate) {
  await page.evaluate(([d, e]) => {
    const O = window.ORRERY;
    const earth = O.DATA.PLANETS.filter((p) => p.key === 'earth')[0];
    const h = O.Kepler.heliocentric(earth.el, O.TimeBar.jd);
    const to = new window.THREE.Vector3(-h.x, -h.z, h.y).normalize().multiplyScalar(d);
    to.y += e;
    O.CameraPath.begin({ to, instant: true });
  }, [dist, elevate]);
  await page.evaluate(
    () => new Promise((res) =>
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res))))
  );
}

test('enter → every zoo family has a dossier → ground tracks render → GEO shadow flips', async ({ page }) => {
  await gotoOrrery(page);
  await page.click('#opt-earth');
  await expect(page.locator('#eo-ui')).toHaveClass(/on/);

  // Pin a deterministic date up front (equinox-adjacent, arbitrary time of
  // day) so every screenshot in this spec is reproducible.
  await snapTo(page, 2461120.30);
  await frameEarth(page, 88, 26);

  // --- Every new family opens its own dossier -------------------------------------
  const families = [
    ['gps', '20,182'],
    ['molniya', '63.4'],
    ['sunsync', '98.19'],
    ['geoslots', 'GOES'],
    ['graveyard', '300'],
  ];
  for (const [key, needle] of families) {
    await page.click('.eo-key[data-eo="' + key + '"]');
    await expect(page.locator('#eo-card')).toHaveClass(/show/);
    await expect(page.locator('#eo-card')).toContainText(needle);
    await page.click('.eo-card-close');
    await expect(page.locator('#eo-card')).not.toHaveClass(/show/);
  }

  // --- Money shot 1: Molniya's self-crossing ground track (the figure-8) ----------
  await page.click('.eo-key[data-eo="molniya"]');
  await expect(page.locator('#eo-card')).toHaveClass(/show/);
  const molTrack = await page.evaluate(() => {
    // Reach into the module via the debug hook's frame is not exposed, so
    // recompute the same baked shape the module drew, purely for a sanity
    // assertion that the geometry is non-degenerate before the screenshot.
    const Z = window.ORRERY.ZOO, S = window.ORRERY.STARLINK;
    return Z.groundTrack((t) => Z.molniyaPosKm(0, 0, t), window.ORRERY.TimeBar.jd,
      Z.MOLNIYA.periodMin / 1440, 200).map((p) => p.lat);
  });
  expect(Math.max(...molTrack) - Math.min(...molTrack), 'Molniya track spans a wide latitude range')
    .toBeGreaterThan(60);
  await frameEarth(page, 30, 14);
  await screenshot(page, 'zoo-molniya-figure8').then(assertSceneRendered);
  await page.click('.eo-card-close');

  // --- Money shot 2: ISS's marching sinusoid ground track --------------------------
  await page.click('.eo-key[data-eo="iss"]');
  await expect(page.locator('#eo-card')).toHaveClass(/show/);
  await frameEarth(page, 28, 20);
  await screenshot(page, 'zoo-iss-sinusoid').then(assertSceneRendered);
  await page.click('.eo-card-close');

  // --- Shadow crossing: a named GEO slot actually dims (state flip) ----------------
  // Verified offline against the app's own Kepler + J2 machinery: GOES-19
  // (75.2°W) sits in Earth's shadow cylinder from 23:32 UTC on 2026-03-20 to
  // 00:41 UTC on 2026-03-21 — a real equinox eclipse, not a contrived one.
  await snapTo(page, 2461120.4583333335); // 2026-03-20 23:00 UTC — sunlit
  const before = await page.evaluate(() => window.ORRERY.EarthOrbit.debug());
  expect(before.geoNamedShadow, 'sunlit before the eclipse window').toBe(false);

  await snapTo(page, 2461120.5); // 2026-03-21 00:00 UTC — inside the window
  const during = await page.evaluate(() => window.ORRERY.EarthOrbit.debug());
  expect(during.geoNamedShadow, 'in shadow during the equinox eclipse window').toBe(true);

  await snapTo(page, 2461120.548611111); // 2026-03-21 01:10 UTC — sunlit again
  const after = await page.evaluate(() => window.ORRERY.EarthOrbit.debug());
  expect(after.geoNamedShadow, 'sunlit again after the eclipse window').toBe(false);

  // --- Existing earthorbit money shot untouched: LEO moves / GEO hangs -------------
  const d0 = await page.evaluate(() => window.ORRERY.EarthOrbit.debug());
  await page.evaluate(() => {
    const TB = window.ORRERY.TimeBar;
    TB.playing = false;
    TB.snapJd(TB.jd + 20 / 1440);
  });
  await page.evaluate(
    () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
  );
  const d1 = await page.evaluate(() => window.ORRERY.EarthOrbit.debug());
  let geoDrift = Math.abs(d1.geoFixedLon - d0.geoFixedLon);
  if (geoDrift > 180) geoDrift = 360 - geoDrift;
  expect(geoDrift, 'named GEO slot still hangs fixed').toBeLessThan(0.01);

  await page.click('#eo-exit');
  await expect(page.locator('#eo-ui')).not.toHaveClass(/on/);
});
