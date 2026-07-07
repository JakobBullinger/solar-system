/**
 * living-orbits.spec.js — Level 25 end-to-end: physics-driven animation.
 *
 * Covers the six shipped behaviours:
 *  - trajectory draw-in runs and completes (and snaps under reduced motion)
 *  - the probe glyph tracks the sim clock along a cached previewLive arc
 *  - orbit flow renders (screenshot artifact) and the Flow toggle kills it
 *  - a scheduled burn fires a flare (screenshot artifact)
 *  - clock jumps ease (log ease, ~0.55 s) and the >30-day teleport guard
 *    still holds through an eased jump
 *  - director mode enters, composes a shot, exits on input, and respects
 *    the activity guards
 */
'use strict';

const { test, expect, gotoOrrery, screenshot, assertSceneRendered, driveTicks } =
  require('./orrery');

/** Two real animation frames — lets per-frame ticks (TrajAnim etc.) run. */
function frames(page) {
  return page.evaluate(
    () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
  );
}

test('trajectory draw-in animates to completion (Mars planner arc)', async ({ page }) => {
  await gotoOrrery(page, null, { reducedMotion: false });
  await page.click('#opt-mars');
  await page.waitForFunction(() => ORRERY.MarsPlanner.getState().selected !== null);
  // An anim should be live and partial shortly after selection…
  const mid = await page.evaluate(() => ORRERY.TrajAnim._dev.state());
  expect(mid.anims.length).toBe(1);
  expect(mid.anims[0].n).toBeGreaterThan(10);
  // …and gone (draw range restored to full) once the 1.1 s ease lands.
  await page.waitForFunction(() => ORRERY.TrajAnim._dev.state().anims.length === 0);
});

test('draw-in snaps instantly under reduced motion', async ({ page }) => {
  await gotoOrrery(page);
  await page.click('#opt-mars');
  await page.waitForFunction(() => ORRERY.MarsPlanner.getState().selected !== null);
  const st = await page.evaluate(() => ORRERY.TrajAnim._dev.state());
  expect(st.anims.length).toBe(0);
});

test('probe glyph walks its arc under the sim clock', async ({ page }) => {
  await gotoOrrery(page);
  await page.click('#opt-mars');
  await page.waitForFunction(() => ORRERY.MarsPlanner.getState().selected !== null);
  const win = await page.evaluate(() => {
    const st = ORRERY.MarsPlanner.getState();
    const m = ORRERY.DATA.MARS.MISSIONS.filter((x) => x.key === st.selected)[0];
    ORRERY.TimeBar.playing = false;
    return { dep: m.depJd, arr: m.arrJd };
  });

  const at = async (jd) => {
    await page.evaluate((v) => ORRERY.TimeBar.snapJd(v), jd);
    await frames(page);
    return page.evaluate(() => ORRERY.TrajAnim._dev.state().glyphs[0]);
  };

  const early = await at(win.dep + (win.arr - win.dep) * 0.25);
  const late = await at(win.dep + (win.arr - win.dep) * 0.75);
  const after = await at(win.arr + 200);
  expect(early.visible).toBe(true);
  expect(late.visible).toBe(true);
  const moved = Math.hypot(late.x - early.x, late.y - early.y, late.z - early.z);
  expect(moved).toBeGreaterThan(5); // it genuinely travelled along the arc
  expect(after.visible).toBe(false); // and parks outside the flight window
  const shot = await screenshot(page, 'living-glyph');
  assertSceneRendered(shot);
});

test('orbit flow renders and the Flow toggle disables it', async ({ page }) => {
  await gotoOrrery(page);
  const shot = await screenshot(page, 'living-orbitflow');
  assertSceneRendered(shot);
  expect(await page.evaluate(() => ORRERY.OrbitFlow.enabled)).toBe(true);
  await page.click('#opt-flow');
  expect(await page.evaluate(() => ORRERY.OrbitFlow.enabled)).toBe(false);
  await expect(page.locator('#opt-flow')).toHaveAttribute('aria-pressed', 'false');
  await page.click('#opt-flow');
  expect(await page.evaluate(() => ORRERY.OrbitFlow.enabled)).toBe(true);
});

test('orbit flow close-up: Kepler bunching at a comet (artifact)', async ({ page }) => {
  await gotoOrrery(page, '?body=encke');
  await frames(page);
  const shot = await screenshot(page, 'living-orbitflow-comet');
  assertSceneRendered(shot);
});

test('a scheduled burn fires (and flares) mid-flight', async ({ page }) => {
  await gotoOrrery(page);
  await page.evaluate(() => {
    const TB = ORRERY.TimeBar;
    TB.playing = false;
    // A tame near-circular orbiter with one scheduled prograde impulse.
    window.__vis = ORRERY.Sandbox.addBody(
      { x: 1.1, y: 0, z: 0 }, { x: 0, y: 0.0164, z: 0 }, '#ffd27f');
    window.__vis.p.burns = [{ jd: TB.jd + 4, dv: { x: 0, y: 0.002, z: 0 }, done: false }];
  });
  await driveTicks(page, null, 3.5, 1);   // approach the burn epoch…
  await page.click('#offer-skip');        // clear the first-visit card from frame
  await page.evaluate(() => {
    // …compose a close-up of the probe so the flash is unmissable…
    const v = window.__vis.sprite.position;
    const dir = v.clone().normalize();
    ORRERY.CameraPath.begin({
      to: v.clone().addScaledVector(dir, 20).add(new THREE.Vector3(0, 4, 0)),
      instant: true
    });
  });
  await driveTicks(page, null, 1, 1);     // …then cross it (flare spawns now)
  const shot = await screenshot(page, 'living-burnflash'); // inside the flare's ~1 s
  assertSceneRendered(shot);
  const st = await page.evaluate(() => ({
    done: window.__vis.p.burns[0].done,
    flared: window.__vis.burnsSeen
  }));
  expect(st.done).toBe(true);
  expect(st.flared).toBe(1);
});

test('clock jumps ease logarithmically and land exactly; teleport guard holds', async ({ page }) => {
  await gotoOrrery(page, null, { reducedMotion: false });
  const r = await page.evaluate(() => {
    const TB = ORRERY.TimeBar;
    TB.playing = false;
    const from = TB.jd;
    const vis = ORRERY.Sandbox.addBody(
      { x: 1.1, y: 0, z: 0 }, { x: 0, y: 0.0164, z: 0 }, '#7fc4ff');
    const p0 = { x: vis.p.pos.x, y: vis.p.pos.y };
    TB.jd = from + 365;          // a porkchop-sized jump
    return { from, easing: TB.easing, midJd: TB.jd, p0 };
  });
  expect(r.easing).toBe(true);
  expect(r.midJd).toBe(r.from);  // the ease flies from here, no snap
  await page.waitForFunction(() => !ORRERY.TimeBar.easing);
  const after = await page.evaluate(() => ({
    jd: ORRERY.TimeBar.jd,
    p: { x: ORRERY.NBody.particles[0].pos.x, y: ORRERY.NBody.particles[0].pos.y }
  }));
  expect(after.jd).toBeCloseTo(r.from + 365, 6);
  // >30-day jump: the accumulated step is a teleport — physics untouched.
  expect(after.p.x).toBeCloseTo(r.p0.x, 12);
  expect(after.p.y).toBeCloseTo(r.p0.y, 12);
});

test('director mode enters, composes, exits on input, respects guards', async ({ page }) => {
  await gotoOrrery(page);
  const before = await page.evaluate(() => ORRERY.CameraPath.pose());
  const entered = await page.evaluate(() => {
    ORRERY.Director.start();
    return ORRERY.Director.active;
  });
  expect(entered).toBe(true);
  const during = await page.evaluate(() => ORRERY.CameraPath.pose());
  expect(during.position).not.toEqual(before.position); // the cut moved us
  await expect(page.locator('.director-note')).toHaveClass(/show/);
  const shot = await screenshot(page, 'living-director');
  assertSceneRendered(shot);

  await page.mouse.move(700, 400); // any input ends the show
  await page.waitForFunction(() => !ORRERY.Director.active);
  await expect(page.locator('.director-note')).not.toHaveClass(/show/);

  // An active mode blocks entry outright.
  await page.click('#opt-missions');
  const blocked = await page.evaluate(() => {
    ORRERY.Director.start();
    return ORRERY.Director.active;
  });
  expect(blocked).toBe(false);
});
