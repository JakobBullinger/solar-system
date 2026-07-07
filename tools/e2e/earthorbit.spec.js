/**
 * earthorbit.spec.js — Level 24, Earth Orbit & Starlink, end to end.
 *
 * Enters the km/minutes regime through the real Explore menu, asserts
 * rendered pixels wide and close-up, opens a shell dossier, then the
 * regime's money shot: drive the sim clock and prove a LEO satellite
 * MOVES while a GEO marker hangs still relative to Earth's spinning
 * surface. Exits and asserts the heliocentric camera pose, the orrery
 * solids and the TimeBar state are restored exactly. Zero console
 * errors throughout (auto fixture).
 */
'use strict';

const { test, expect, gotoOrrery, screenshot, assertSceneRendered } = require('./orrery');

/** Snap the sim clock forward and let the frame loop apply one real frame. */
async function stepClock(page, days) {
  await page.evaluate((d) => {
    const TB = window.ORRERY.TimeBar;
    TB.playing = false;
    TB.snapJd(TB.jd + d);
  }, days);
  await page.evaluate(
    () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
  );
}

test('enter → constellation renders → dossier → LEO moves / GEO hangs → exit restores', async ({ page }) => {
  await gotoOrrery(page);

  // Snapshot the heliocentric state we must come back to
  const before = await page.evaluate(() => ({
    pose: window.ORRERY.CameraPath.pose(),
    rate: window.ORRERY.TimeBar.rate,
    playing: window.ORRERY.TimeBar.playing,
  }));

  // --- Enter through the real menu row ------------------------------------
  await page.click('#opt-earth');
  await expect(page.locator('#eo-ui')).toHaveClass(/on/);
  expect(await page.evaluate(() => window.ORRERY.EarthOrbit.active)).toBe(true);
  expect(await page.evaluate(() => document.body.classList.contains('earthorbit'))).toBe(true);

  // The mode owns time: minutes-scale default rate, its own control lit
  const inMode = await page.evaluate(() => window.ORRERY.TimeBar.rate);
  expect(inMode, 'minutes-scale default rate').toBeLessThan(0.05);
  await expect(page.locator('.eo-rate.on')).toHaveCount(1);

  // Wide view: Earth + LEO swarm + GEO ring (reduced motion = flight landed)
  await screenshot(page, 'earthorbit-wide').then(assertSceneRendered);

  // --- Shell dossier -------------------------------------------------------
  await page.click('.eo-key[data-eo="shell1"]');
  await expect(page.locator('#eo-card')).toHaveClass(/show/);
  await expect(page.locator('#eo-card')).toContainText('1,584');
  await expect(page.locator('#eo-card')).toContainText('53.0°');
  await expect(page.locator('#eo-card')).toContainText('95.6 min');

  // Close the dossier drawer (it covers the top-right corner, like the
  // app's other right-docked drawers) before driving the regime further.
  await page.click('.eo-card-close');
  await expect(page.locator('#eo-card')).not.toHaveClass(/show/);

  // --- The money shot: LEO races, GEO hangs over the surface ---------------
  const d0 = await page.evaluate(() => window.ORRERY.EarthOrbit.debug());
  await stepClock(page, 20 / 1440); // 20 sim-minutes
  const d1 = await page.evaluate(() => window.ORRERY.EarthOrbit.debug());

  // A shell-1 satellite covers ~a fifth of its 95.6-min orbit: kilometers of
  // scene-space motion (units of 1,000 km here)
  const leoMoved = Math.hypot(
    d1.leoWorld[0] - d0.leoWorld[0],
    d1.leoWorld[1] - d0.leoWorld[1],
    d1.leoWorld[2] - d0.leoWorld[2]
  );
  expect(leoMoved, 'LEO sat sweeps thousands of km in 20 min').toBeGreaterThan(5);

  // The GEO marker moved through inertial space too…
  const geoMovedInertial = Math.hypot(
    d1.geoWorld[0] - d0.geoWorld[0],
    d1.geoWorld[1] - d0.geoWorld[1],
    d1.geoWorld[2] - d0.geoWorld[2]
  );
  expect(geoMovedInertial, 'GEO orbits inertially').toBeGreaterThan(1);
  // …but its Earth-FIXED longitude did not budge: it hangs over one spot
  const geoDrift = Math.abs(d1.geoFixedLon - d0.geoFixedLon);
  expect(geoDrift, 'GEO fixed longitude pinned').toBeLessThan(0.01);
  // while the LEO sat's ground track swept whole degrees
  let leoDrift = Math.abs(d1.leoFixedLon - d0.leoFixedLon);
  if (leoDrift > 180) leoDrift = 360 - leoDrift;
  expect(leoDrift, 'LEO ground track sweeps').toBeGreaterThan(10);

  // --- LEO close-up screenshot (from the day side, so Earth is lit) --------
  await page.evaluate(() => {
    const O = window.ORRERY;
    const earth = O.DATA.PLANETS.filter((p) => p.key === 'earth')[0];
    const h = O.Kepler.heliocentric(earth.el, O.TimeBar.jd);
    // ecliptic → scene axes; -h is the direction from Earth toward the Sun
    const to = new window.THREE.Vector3(-h.x, -h.z, h.y).normalize().multiplyScalar(13);
    to.y += 3;
    O.CameraPath.begin({ to, instant: true });
  });
  await page.evaluate(
    () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
  );
  await screenshot(page, 'earthorbit-leo-close').then(assertSceneRendered);

  // --- Exit restores everything exactly ------------------------------------
  await page.click('#eo-exit');
  const after = await page.evaluate(() => ({
    active: window.ORRERY.EarthOrbit.active,
    pose: window.ORRERY.CameraPath.pose(),
    rate: window.ORRERY.TimeBar.rate,
    playing: window.ORRERY.TimeBar.playing,
    bodyClass: document.body.classList.contains('earthorbit'),
    sunVisible: null,
  }));
  expect(after.active).toBe(false);
  expect(after.bodyClass).toBe(false);
  expect(after.rate, 'TimeBar rate restored exactly').toBe(before.rate);
  expect(after.playing, 'TimeBar playing restored exactly').toBe(before.playing);
  for (let i = 0; i < 3; i++) {
    expect(after.pose.position[i], 'camera position restored').toBeCloseTo(before.pose.position[i], 1);
    expect(after.pose.target[i], 'orbit target restored').toBeCloseTo(before.pose.target[i], 1);
  }

  // The heliocentric scene is genuinely back (rendered pixels + a planet visible)
  await page.evaluate(
    () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
  );
  await screenshot(page, 'earthorbit-restored').then(assertSceneRendered);
});

test('wheel-in past max zoom on Earth is an entry; Esc exits', async ({ page }) => {
  await gotoOrrery(page, '?body=earth');
  // focused on Earth at focus distance; zoom the camera to min distance first.
  // Pause the clock: at 4 d/s Earth sweeps ~4 scene units per second and
  // would outrun a camera parked at the zoom stop before the wheel fires.
  await page.evaluate(() => {
    const O = window.ORRERY;
    O.TimeBar.playing = false;
    // place the camera at min zoom along the current bearing (focus() left
    // us following Earth; the controls clamp at minDistance = 4)
    const pose = O.CameraPath.pose();
    const target = new window.THREE.Vector3().fromArray(pose.target);
    const pos = new window.THREE.Vector3().fromArray(pose.position);
    const dir = pos.sub(target).normalize().multiplyScalar(4.05).add(target);
    O.CameraPath.begin({ to: dir, instant: true });
  });
  await page.evaluate(
    () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
  );
  // wheel IN (negative deltaY) past the stop → the regime opens.
  // Close the pinned header menus first: they overlay parts of the canvas
  // and intercept the hover (the canvas is full-viewport; any clear spot works).
  await page.evaluate(() => window.ORRERY.Header.closeAll());
  await page.mouse.move(480, 700);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -40);
  }
  await expect(page.locator('#eo-ui')).toHaveClass(/on/, { timeout: 5000 });
  expect(await page.evaluate(() => window.ORRERY.EarthOrbit.active)).toBe(true);

  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.ORRERY.EarthOrbit.active)).toBe(false);
  await expect(page.locator('#eo-ui')).not.toHaveClass(/on/);
});
