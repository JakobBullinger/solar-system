/**
 * seeing-invisible.spec.js — Level 26 physics-visualization overlays.
 *
 * Each overlay must toggle on and off with zero console errors (the
 * library's auto error trap enforces that), render real pixels, and the
 * accumulating overlays (resonance rose, Sun's wobble) must actually
 * accumulate when simulation time is driven through the live integrator
 * entry point — including across the big clock jumps driveTicks makes,
 * which exercise the analytic backfill path.
 */
const { test, expect, gotoOrrery, screenshot, assertSceneRendered, driveTicks } =
  require('./orrery');

const HEADS = '#vizpanel .vz-row .vz-head';

async function frames(page, n) {
  await page.evaluate(
    (k) => new Promise((res) => {
      const step = (i) => (i <= 0 ? res() : requestAnimationFrame(() => step(i - 1)));
      step(k);
    }),
    n || 2
  );
}

async function openPanel(page) {
  await page.click('#opt-viz');
  await expect(page.locator('#vizpanel')).toHaveClass(/open/);
}

test('all four overlays toggle on and off cleanly', async ({ page }) => {
  await gotoOrrery(page);
  await openPanel(page);
  const heads = page.locator(HEADS);
  await expect(heads).toHaveCount(4);

  for (let i = 0; i < 4; i++) {
    await heads.nth(i).click();
    await expect(heads.nth(i)).toHaveAttribute('aria-pressed', 'true');
  }
  await frames(page, 3);
  const on = await page.evaluate(() => [
    ORRERY.GravityWell.enabled, ORRERY.Overlays.enabled,
    ORRERY.Spirograph.enabled, ORRERY.Barycenter.enabled,
  ]);
  expect(on).toEqual([true, true, true, true]);
  assertSceneRendered(await screenshot(page, 'viz-all-on'));

  for (let i = 0; i < 4; i++) {
    await heads.nth(i).click();
    await expect(heads.nth(i)).toHaveAttribute('aria-pressed', 'false');
  }
  await frames(page, 3);
  const off = await page.evaluate(() => [
    ORRERY.GravityWell.enabled, ORRERY.Overlays.enabled,
    ORRERY.Spirograph.enabled, ORRERY.Barycenter.enabled,
  ]);
  expect(off).toEqual([false, false, false, false]);
  assertSceneRendered(await screenshot(page, 'viz-all-off'));
});

test('gravity landscape draws in all three frames', async ({ page }) => {
  await gotoOrrery(page);
  await openPanel(page);
  await page.locator(HEADS).nth(0).click();
  await frames(page, 3);
  assertSceneRendered(await screenshot(page, 'gravity-heliocentric'));

  // Quality drop rebuilds without error
  await page.locator('#vizpanel .vz-chip', { hasText: 'Low' }).click();
  await frames(page, 3);
  assertSceneRendered(await screenshot(page, 'gravity-low-quality'));
  await page.locator('#vizpanel .vz-chip', { hasText: 'High' }).click();

  await page.locator('#vizpanel .vz-chip', { hasText: 'Jupiter co-rotating' }).click();
  await frames(page, 3);
  expect(await page.evaluate(() => ORRERY.GravityWell.frame)).toBe('jupiter');
  assertSceneRendered(await screenshot(page, 'gravity-jupiter-rotating'));

  await page.locator('#vizpanel .vz-chip', { hasText: 'Earth co-rotating' }).click();
  await frames(page, 3);
  expect(await page.evaluate(() => ORRERY.GravityWell.frame)).toBe('earth');
  // The L1/L2 saddle patch, magnified onto Earth — visual record of the
  // "saddles visible in the rotating frame" requirement. The open panel
  // overlaps the nav row, so close it before touching the toggles.
  await page.click('#vizpanel header button');
  await page.click('#opt-lagrange');
  await page.locator('#rail .chip').filter({ hasText: /^Earth$/ }).click();
  await frames(page, 6);   // reduced motion: the focus flight snaps
  assertSceneRendered(await screenshot(page, 'gravity-earth-rotating'));
});

test('speed colours: orbit lines, velocity arrow and sandbox arc', async ({ page }) => {
  await gotoOrrery(page, '?body=earth');
  await openPanel(page);
  await page.locator(HEADS).nth(1).click();
  await frames(page, 3);

  // The live velocity tag rides the selected body (Earth ≈ 29.8 km/s)
  await expect(page.locator('.vz-vel-label')).toHaveClass(/show/);
  const tag = await page.locator('.vz-vel-label').textContent();
  expect(parseFloat(tag)).toBeGreaterThan(28);
  expect(parseFloat(tag)).toBeLessThan(32);
  assertSceneRendered(await screenshot(page, 'speed-colours'));

  // Sandbox aim: drag on empty space — the preview arc must tint by speed
  // (vertexColors flips on) without a single console error
  await page.click('#opt-sandbox');
  const box = page.viewportSize();
  await page.mouse.move(box.width * 0.32, box.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(box.width * 0.48, box.height * 0.36, { steps: 8 });
  await frames(page, 2);
  assertSceneRendered(await screenshot(page, 'speed-sandbox-arc'));
  await page.mouse.up();
});

test('resonance spirograph accumulates through time-lapse', async ({ page }) => {
  await gotoOrrery(page);
  await openPanel(page);
  await page.locator(HEADS).nth(2).click();   // Venus–Earth marquee
  await frames(page, 2);

  const before = await page.evaluate(() => ORRERY.Spirograph.count());
  // Two big clock jumps (backfill path) + frames between: ~8 Earth years
  await driveTicks(page, null, 1500);
  await frames(page, 2);
  await driveTicks(page, null, 1500);
  await frames(page, 2);
  const after = await page.evaluate(() => ORRERY.Spirograph.count());
  expect(after - before).toBeGreaterThan(500);   // 3000 days / 4-day cadence

  assertSceneRendered(await screenshot(page, 'venus-earth-rose'));

  // Galilean pulse view swaps ribbons into Jupiter's frame without error
  await page.locator('#vizpanel .vz-chip', { hasText: 'Io · Europa · Ganymede' }).click();
  await frames(page, 6);
  const jovian = await page.evaluate(() => ORRERY.Spirograph.pair);
  expect(jovian).toBe('galilean');
  assertSceneRendered(await screenshot(page, 'galilean-pulse'));
});

test("the Sun's wobble trail accumulates and stays on screen", async ({ page }) => {
  await gotoOrrery(page);
  await openPanel(page);
  await page.locator(HEADS).nth(3).click();
  await frames(page, 2);

  await driveTicks(page, null, 6000);           // ~16 years ≈ 270 samples
  await frames(page, 2);
  const n = await page.evaluate(() => ORRERY.Barycenter.count());
  expect(n).toBeGreaterThan(200);
  assertSceneRendered(await screenshot(page, 'sun-wobble'));
});
