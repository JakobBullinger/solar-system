/**
 * ascent.spec.js — the ascent ride-along, end to end.
 *
 * Enters Earth orbit through the real menu, starts the ride through its
 * real entry button, then fast-forwards through the whole ~50-minute
 * mission by calling the live ORRERY.Ascent.tick(dt) in a tight loop with
 * small dt slices (the driveTicks pattern, adapted: this module's tick is
 * driven by real per-frame dt, not a jd span, so the workaround is calling
 * it directly with realistic per-frame dt many times rather than waiting
 * ~2 minutes of actual wall-clock ride time). Screenshots at pad / stage
 * separation / parked-in-orbit; asserts milestone bands via the module's
 * own debug() state at each waypoint; exits mid-ride and confirms the
 * regime's camera/clock are restored exactly; confirms earthorbit.spec.js's
 * own contract (the regime itself) stays intact.
 */
'use strict';

const { test, expect, gotoOrrery, screenshot, assertSceneRendered } = require('./orrery');

/**
 * Drive the ride to an ABSOLUTE mission-elapsed time (seconds since
 * liftoff) by calling the live tick() in small real-dt slices — the
 * driveTicks pattern, adapted: this module's tick() takes real dt (scaled
 * internally by the phase compression), not a jd span, so the workaround
 * is many small direct tick() calls rather than waiting out the ride's
 * actual ~2-minute wall-clock duration. Absolute (not relative) so it is
 * unaffected by any mission time the real frame loop also advances during
 * an intervening settle() — SwiftShader frame times are slow enough that a
 * few dozen real rAFs can itself add tens of mission-seconds.
 */
async function rideTo(page, targetSeconds, dt) {
  await page.evaluate(([target, step]) => {
    const A = window.ORRERY.Ascent;
    let guard = 0;
    while (A.debug().missionElapsed < target && A.debug().state !== 'parked' && guard < 400000) {
      A.tick(step);
      guard++;
    }
  }, [targetSeconds, dt || 0.05]);
}

/**
 * Real animation frames so SwiftShader renders the new state AND the chase
 * camera's exponential smoothing (~0.2 s time constant) has visibly
 * converged on the rocket before a screenshot — a few rAFs is enough for
 * pixel-truth, but a chase-cam screenshot wants the camera to have actually
 * arrived.
 */
async function settle(page, frames) {
  await page.evaluate((n) => new Promise((res) => {
    let i = 0;
    function step() { i++; if (i >= n) res(); else requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }), frames || 60);
}

test('ride a launch: pad -> max-Q -> MECO -> SECO -> circularization -> parked alongside the ISS', async ({ page }) => {
  await gotoOrrery(page);

  const before = await page.evaluate(() => ({
    pose: window.ORRERY.CameraPath.pose(),
    rate: window.ORRERY.TimeBar.rate,
    playing: window.ORRERY.TimeBar.playing,
  }));

  await page.click('#opt-earth');
  await expect(page.locator('#eo-ui')).toHaveClass(/on/);

  // Earth-orbit's own clock state (minutes-scale rate) right before riding —
  // what the ride's stop() must hand back exactly.
  const beforeRide = await page.evaluate(() => ({
    rate: window.ORRERY.TimeBar.rate,
    playing: window.ORRERY.TimeBar.playing,
  }));

  // --- Entry: the real "Ride a launch" button in the Earth-orbit HUD -------
  await expect(page.locator('#asc-launch')).toBeVisible();
  await page.click('#asc-launch');
  await expect(page.locator('#asc-hud')).toHaveClass(/show/);
  expect(await page.evaluate(() => window.ORRERY.Ascent.active)).toBe(true);
  expect(await page.evaluate(() => document.body.classList.contains('riding-ascent'))).toBe(true);

  let d = await page.evaluate(() => window.ORRERY.Ascent.debug());
  expect(d.alt, 'liftoff altitude ~0').toBeLessThan(1);
  expect(d.speed, 'liftoff speed ~0 km/s').toBeLessThan(0.1);

  await settle(page);
  await screenshot(page, 'ascent-pad').then(assertSceneRendered);

  // --- Max-Q (~65 s mission time) -------------------------------------------
  await rideTo(page, 65);
  d = await page.evaluate(() => window.ORRERY.Ascent.debug());
  expect(d.alt, 'max-Q altitude band').toBeGreaterThan(8);
  expect(d.alt, 'max-Q altitude band').toBeLessThan(18);

  // --- MECO / stage separation (~155-159 s mission time) --------------------
  await rideTo(page, 165);
  d = await page.evaluate(() => window.ORRERY.Ascent.debug());
  expect(d.alt, 'MECO altitude plausible').toBeGreaterThan(50);
  expect(d.alt, 'MECO altitude plausible').toBeLessThan(130);
  expect(d.speed, 'MECO speed plausible (km/s)').toBeGreaterThan(2);
  expect(d.speed, 'MECO speed plausible (km/s)').toBeLessThan(4.5);
  await settle(page);
  await screenshot(page, 'ascent-stage-sep').then(assertSceneRendered);

  // --- SECO (~429.5 s mission time) -----------------------------------------
  await rideTo(page, 450);
  d = await page.evaluate(() => window.ORRERY.Ascent.debug());
  expect(d.phase, 'past SECO, coasting').toBe('coast');
  expect(d.speed, 'SECO-area speed near 7.9 km/s').toBeGreaterThan(7);

  // --- Fast-forward the whole coast to circularization + parked ------------
  // Mission ends ~3051 s in; drive the module directly so the test doesn't
  // need to wait out the ride's real ~2-minute wall-clock duration.
  await rideTo(page, 3300, 0.25);
  d = await page.evaluate(() => window.ORRERY.Ascent.debug());
  expect(d.phase, 'parked in the final circular orbit').toBe('parked');
  expect(d.alt, 'circularized altitude ~420 km').toBeGreaterThan(415);
  expect(d.alt, 'circularized altitude ~420 km').toBeLessThan(425);
  expect(d.speed, 'circularized speed ~7.66 km/s').toBeGreaterThan(7.6);
  expect(d.speed, 'circularized speed ~7.66 km/s').toBeLessThan(7.7);

  // The ride genuinely ends NEAR the ISS: geocentric separation vs the real
  // starlink.js ISS model at the app's own current jd — alongside (same
  // plane, small along-track gap), honestly not docked.
  const sepKm = await page.evaluate(() => {
    const A = window.ORRERY.AscentProfile;
    const S = window.ORRERY.STARLINK;
    const dbg = window.ORRERY.Ascent.debug();
    const st = A.stateAtMissionTime(dbg.missionElapsed);
    const eci = A.toECI(st.x, st.y, A.PROFILE.constants.TARGET_INC_DEG, A.PROFILE.omegaAscentDeg);
    const iss = S.satPosKm(
      { altKm: S.ISS.altKm, incDeg: S.ISS.incDeg, planes: 1, perPlane: 1, f: 0 },
      0, 0, window.ORRERY.TimeBar.jd
    );
    return Math.hypot(eci.x - iss.x, eci.y - iss.y, eci.z - iss.z);
  });
  expect(sepKm, 'parked genuinely alongside the ISS, not somewhere else').toBeLessThan(500);
  expect(sepKm, 'and honestly not docked at the exact same point').toBeGreaterThan(20);

  await settle(page);
  await screenshot(page, 'ascent-orbit').then(assertSceneRendered);

  // Parked stays parked under the REAL frame loop (TimeBar's own "real" rate
  // now drives it, per the module's design) — altitude/speed hold even as
  // more wall-clock time (and hence sim time) actually passes.
  const jdAtPark = await page.evaluate(() => window.ORRERY.TimeBar.jd);
  await settle(page, 90);
  const parked = await page.evaluate(() => window.ORRERY.Ascent.debug());
  const jdAfter = await page.evaluate(() => window.ORRERY.TimeBar.jd);
  expect(parked.phase).toBe('parked');
  expect(parked.alt).toBeCloseTo(d.alt, 0);
  expect(parked.speed).toBeCloseTo(d.speed, 2);
  expect(jdAfter, 'the regime\'s own real-time rate is genuinely advancing the parked clock').toBeGreaterThan(jdAtPark);

  // --- Exit mid-"ride" (still parked/active) restores camera + clock -------
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.ORRERY.Ascent.active)).toBe(false);
  await expect(page.locator('#asc-hud')).not.toHaveClass(/show/);
  expect(await page.evaluate(() => document.body.classList.contains('riding-ascent'))).toBe(false);

  const afterRide = await page.evaluate(() => ({
    rate: window.ORRERY.TimeBar.rate,
    playing: window.ORRERY.TimeBar.playing,
  }));
  expect(afterRide.rate, 'TimeBar rate restored to the pre-ride Earth-orbit rate exactly').toBe(beforeRide.rate);
  expect(afterRide.playing, 'TimeBar playing restored to the pre-ride Earth-orbit state exactly').toBe(beforeRide.playing);
  // Earth-orbit itself is still active and usable — its own contract holds.
  expect(await page.evaluate(() => window.ORRERY.EarthOrbit.active)).toBe(true);

  // --- Exiting the whole regime afterward restores the heliocentric pose ---
  await page.click('#eo-exit');
  const after = await page.evaluate(() => ({
    active: window.ORRERY.EarthOrbit.active,
    pose: window.ORRERY.CameraPath.pose(),
    rate: window.ORRERY.TimeBar.rate,
    playing: window.ORRERY.TimeBar.playing,
  }));
  expect(after.active).toBe(false);
  expect(after.rate, 'TimeBar rate restored exactly').toBe(before.rate);
  expect(after.playing, 'TimeBar playing restored exactly').toBe(before.playing);
  for (let i = 0; i < 3; i++) {
    expect(after.pose.position[i], 'camera position restored').toBeCloseTo(before.pose.position[i], 1);
    expect(after.pose.target[i], 'orbit target restored').toBeCloseTo(before.pose.target[i], 1);
  }
});

test('exiting the ride mid-ascent restores the earth-orbit camera pose exactly', async ({ page }) => {
  await gotoOrrery(page);
  await page.click('#opt-earth');
  await expect(page.locator('#eo-ui')).toHaveClass(/on/);

  // Snapshot the free-look Earth-orbit camera pose right before riding.
  const beforeRide = await page.evaluate(() => window.ORRERY.CameraPath.pose());

  await page.click('#asc-launch');
  expect(await page.evaluate(() => window.ORRERY.Ascent.active)).toBe(true);
  await rideTo(page, 80);   // mid-ascent, well before MECO
  await settle(page);

  // Camera should have moved away from the pre-ride pose while riding.
  const midRide = await page.evaluate(() => window.ORRERY.CameraPath.pose());
  const moved = Math.hypot(
    midRide.position[0] - beforeRide.position[0],
    midRide.position[1] - beforeRide.position[1],
    midRide.position[2] - beforeRide.position[2]
  );
  expect(moved, 'chase camera actually moved during the ride').toBeGreaterThan(0.001);

  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.ORRERY.Ascent.active)).toBe(false);
  // Still inside Earth orbit (Escape stopped the RIDE, not the whole regime).
  expect(await page.evaluate(() => window.ORRERY.EarthOrbit.active)).toBe(true);

  const restored = await page.evaluate(() => window.ORRERY.CameraPath.pose());
  for (let i = 0; i < 3; i++) {
    expect(restored.position[i], 'camera pose restored to pre-ride exactly').toBeCloseTo(beforeRide.position[i], 3);
    expect(restored.target[i], 'orbit target restored to pre-ride exactly').toBeCloseTo(beforeRide.target[i], 3);
  }

  // earthorbit.spec.js's own contract: the regime is still fully functional.
  await page.click('#eo-exit');
  expect(await page.evaluate(() => window.ORRERY.EarthOrbit.active)).toBe(false);
});
