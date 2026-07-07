/**
 * camerapath.spec.js — parity proof for the CameraPath refactor.
 *
 * The four camera-easing implementations (main.js focus/flyHome, tour stop
 * choreography, cosmos enter/exit restore, ride boundary cancels) now ride
 * ORRERY.CameraPath. These specs drive each flow the way a user would and
 * assert the camera lands exactly where the old per-module tweens put it.
 *
 * Reduced motion note: the config's `use.reducedMotion` does NOT actually
 * reach the page in this harness (measured: matchMedia stays false and
 * `--force-prefers-reduced-motion` is a no-op on this Chrome) — so each
 * snap-based test calls page.emulateMedia() itself before navigation,
 * which verifiably works. One test deliberately keeps motion ON to prove
 * the animated flight is real and lands on the same destination.
 */
'use strict';

const {
  test,
  expect,
  gotoOrrery,
  screenshot,
  assertSceneRendered,
} = require('./orrery');

const HOME = [0, 165, 330]; // main.js HOME_POS

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

async function settleFrames(page, n) {
  await page.evaluate(
    (count) =>
      new Promise((res) => {
        let left = count;
        (function next() {
          requestAnimationFrame(() => (--left > 0 ? next() : res()));
        })();
      }),
    n
  );
}

/** Reduced motion must be emulated per-page BEFORE load (see header). */
async function gotoReduced(page, params) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoOrrery(page, params);
}

/**
 * Replicate focus()'s destination math in-page from the CURRENT camera
 * pose: dist = max(enhancedRadius·7, 6)·distMul, destination = body +
 * dir·dist + (0, 0.35·dist, 0) with dir = normalize(camera − target).
 */
function expectedFocus(page, key) {
  return page.evaluate((k) => {
    const O = window.ORRERY;
    const pose = O.CameraPath.pose();
    const p = O.DATA.PLANETS.find((pl) => pl.key === k);
    const body = new THREE.Vector3();
    O.Kepler.scenePosition(p.el, O.TimeBar.jd, body);
    const dist = Math.max(O.Bodies3D.enhancedRadius(p.radiusKm) * 7, 6);
    const dir = new THREE.Vector3()
      .fromArray(pose.position)
      .sub(new THREE.Vector3().fromArray(pose.target))
      .normalize();
    const to = body
      .clone()
      .add(dir.multiplyScalar(dist))
      .add(new THREE.Vector3(0, dist * 0.35, 0));
    return { to: to.toArray(), body: body.toArray(), focusDist: to.distanceTo(body) };
  }, key);
}

test('planet chip click flies the camera to the focus distance (reduced motion)', async ({ page }) => {
  await gotoReduced(page);
  await page.evaluate(() => {
    window.ORRERY.TimeBar.playing = false; // hold Mars still for the measurement
  });
  const exp = await expectedFocus(page, 'mars');

  await page.locator('#rail .chip', { hasText: 'Mars' }).click();
  await settleFrames(page, 4);

  const pose = await page.evaluate(() => window.ORRERY.CameraPath.pose());
  // Camera arrived on the flight destination…
  expect(dist3(pose.position, exp.to)).toBeLessThan(1.0);
  // …which sits at the focus distance from Mars, and the follow lerp put
  // the orbit target on the planet.
  expect(Math.abs(dist3(pose.position, exp.body) - exp.focusDist)).toBeLessThan(1.0);
  expect(dist3(pose.target, exp.body)).toBeLessThan(0.5);
  // Instant under reduced motion: no flight left running.
  expect(await page.evaluate(() => window.ORRERY.CameraPath.isActive())).toBe(false);
});

test('without reduced motion the flight tweens and lands on the same spot', async ({ page }) => {
  await gotoOrrery(page, '', { reducedMotion: false }); // real motion: the 1.6 s cubic ease-out flight
  await page.evaluate(() => {
    window.ORRERY.TimeBar.playing = false;
  });
  const exp = await expectedFocus(page, 'mars');

  await page.locator('#rail .chip', { hasText: 'Mars' }).click();
  // A real flight is in progress…
  expect(await page.evaluate(() => window.ORRERY.CameraPath.isActive())).toBe(true);
  // …and completes on its own (1.6 s of flight time; generous wall-clock
  // budget because SwiftShader frames are slow and dt is clamped).
  await page.waitForFunction(() => !window.ORRERY.CameraPath.isActive(), null, {
    timeout: 30000,
  });

  const pose = await page.evaluate(() => window.ORRERY.CameraPath.pose());
  expect(dist3(pose.position, exp.to)).toBeLessThan(1.0); // same destination as the snap
});

test('Esc mid-tour restores the camera home and the visitor clock', async ({ page }) => {
  await gotoReduced(page);
  const rate0 = await page.evaluate(() => window.ORRERY.TimeBar.rate);

  await page.click('#opt-tour');
  await expect(page.locator('body')).toHaveClass(/touring/);

  // Advance to stop 2 (Earth) — a focused stop with a real camera flight.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tour-title')).toHaveText('Earth');
  await settleFrames(page, 4);

  const atEarth = await page.evaluate(() => {
    const O = window.ORRERY;
    const pose = O.CameraPath.pose();
    const p = O.DATA.PLANETS.find((pl) => pl.key === 'earth');
    const earth = new THREE.Vector3();
    O.Kepler.scenePosition(p.el, O.TimeBar.jd, earth);
    return {
      pose,
      earth: earth.toArray(),
      focusDist: Math.max(O.Bodies3D.enhancedRadius(p.radiusKm) * 7, 6),
    };
  });
  // Focused: target glued to Earth, camera in the focus-distance band
  // (dist … 1.35·dist covers any approach bearing).
  expect(dist3(atEarth.pose.target, atEarth.earth)).toBeLessThan(0.5);
  const dEarth = dist3(atEarth.pose.position, atEarth.earth);
  expect(dEarth).toBeGreaterThan(atEarth.focusDist * 0.95);
  expect(dEarth).toBeLessThan(atEarth.focusDist * 1.35);

  const shot = await screenshot(page, 'camerapath-tour-stop2');
  assertSceneRendered(shot);

  await page.keyboard.press('Escape');
  await settleFrames(page, 6);

  expect(await page.evaluate(() => window.ORRERY.Tour.active)).toBe(false);
  const after = await page.evaluate(() => {
    const O = window.ORRERY;
    return { pose: O.CameraPath.pose(), rate: O.TimeBar.rate };
  });
  expect(dist3(after.pose.position, HOME)).toBeLessThan(2.0); // flyHome landed
  expect(after.rate).toBe(rate0); // visitor clock restored
});

test('cosmos round trip lands the camera back inside the orrery', async ({ page }) => {
  await gotoReduced(page);
  await page.evaluate(() => {
    window.ORRERY.TimeBar.playing = false;
    window.ORRERY.Cosmos.enter();
  });
  expect(await page.evaluate(() => window.ORRERY.Cosmos.active)).toBe(true);

  // Deep zoom out to the stellar neighbourhood, let a few ticks apply it…
  await page.evaluate(() => window.ORRERY.Cosmos.setL(6));
  await settleFrames(page, 6);

  // …and come home: exit restores the camera just inside max zoom (the
  // instant CameraPath flight — maxDistance · 0.9 along the same bearing).
  const exitRadius = await page.evaluate(() => {
    window.ORRERY.Cosmos.exit();
    const p = window.ORRERY.CameraPath.pose().position;
    return Math.hypot(p[0], p[1], p[2]);
  });
  expect(await page.evaluate(() => window.ORRERY.Cosmos.active)).toBe(false);
  expect(Math.abs(exitRadius - 2600 * 0.9)).toBeLessThan(1.0);
  expect(await page.evaluate(() => window.ORRERY.CameraPath.isActive())).toBe(false);

  await settleFrames(page, 6);
  const shot = await screenshot(page, 'camerapath-cosmos-exit');
  assertSceneRendered(shot); // orrery chrome faded back in, scene renders
});

test('mission aim state holds with no stray camera flight', async ({ page }) => {
  await gotoReduced(page);
  await page.click('#opt-missions');
  await expect(page.locator('#missions-hud')).toHaveClass(/show/);

  await page.locator('#missions-hud .ms-row').first().click();
  await page.locator('#missions-hud [data-act="aim"]').click();
  expect(await page.evaluate(() => window.ORRERY.Missions.aiming)).toBe(true);
  // Any focus flight the mission UI began has already snapped; nothing is
  // left fighting the aiming camera.
  expect(await page.evaluate(() => window.ORRERY.CameraPath.isActive())).toBe(false);

  await settleFrames(page, 4);
  const shot = await screenshot(page, 'camerapath-mission-aim');
  assertSceneRendered(shot);
});
