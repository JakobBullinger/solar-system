/**
 * header.spec.js — the two-control header redesign (Explore ▾ / View ▾).
 *
 * The old thirteen-chip row folded into two menus; every chip kept its
 * element ID so the feature modules needed zero changes (the legacy specs
 * prove that via gotoOrrery's pinned-open menus). THESE specs cover what
 * the legacy ones can't: the real closed→open→click flow, so every test
 * here passes { pinMenus: false }.
 *
 * Auto-open note: on a first visit ever (localStorage-gated) the Explore
 * menu opens by itself after ~600 ms — and every Playwright context IS a
 * first visit. Tests that assert closed-by-default seed the localStorage
 * flag before load; the auto-open behaviour itself gets its own test.
 */
'use strict';

const { test, expect, gotoOrrery, screenshot, assertSceneRendered } = require('./orrery');

/** Suppress the first-visit auto-open so menu state is deterministic. */
async function markSeen(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('orrery-explore-shown', '1'); } catch (e) { }
  });
}

test('menus are closed by default; control, canvas and Escape drive open/close', async ({ page }) => {
  await markSeen(page);
  await gotoOrrery(page, null, { pinMenus: false });

  await expect(page.locator('#hdr-menu-explore')).not.toBeVisible();
  await expect(page.locator('#hdr-menu-view')).not.toBeVisible();
  const shot = await screenshot(page, 'header-desktop-closed');
  assertSceneRendered(shot);

  // Control opens its menu (and only its menu); ARIA reflects it.
  await page.click('#hdr-explore');
  await expect(page.locator('#hdr-menu-explore')).toBeVisible();
  await expect(page.locator('#hdr-explore')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#hdr-menu-view')).not.toBeVisible();

  // Opening the other menu closes the first (one at a time on user clicks).
  await page.click('#hdr-view');
  await expect(page.locator('#hdr-menu-view')).toBeVisible();
  await expect(page.locator('#hdr-menu-explore')).not.toBeVisible();
  await screenshot(page, 'header-desktop-view-open');

  // Touching the scene closes everything — the canvas is "outside".
  await page.mouse.click(400, 400);
  await expect(page.locator('#hdr-menu-view')).not.toBeVisible();

  // Escape closes too.
  await page.click('#hdr-explore');
  await expect(page.locator('#hdr-menu-explore')).toBeVisible();
  await screenshot(page, 'header-desktop-explore-open');
  await page.keyboard.press('Escape');
  await expect(page.locator('#hdr-menu-explore')).not.toBeVisible();
});

test('launching an experience closes Explore and names the control', async ({ page }) => {
  await markSeen(page);
  await gotoOrrery(page, null, { pinMenus: false });

  await page.click('#hdr-explore');
  await page.click('#opt-missions');

  // The feature engaged exactly as before (ID binding untouched)…
  await expect(page.locator('#missions-hud')).toHaveClass(/show/);
  expect(await page.evaluate(() => window.ORRERY.Missions.active)).toBe(true);
  await expect(page.locator('#opt-missions')).toHaveAttribute('aria-pressed', 'true');

  // …the menu folded away, and the closed control shows what is running.
  await expect(page.locator('#hdr-menu-explore')).not.toBeVisible();
  await expect(page.locator('#hdr-explore-text')).toHaveText('Missions');
  await expect(page.locator('#hdr-explore')).toHaveClass(/active/);
  await screenshot(page, 'header-active-experience');

  // Ending the mission hands the control its resting name back.
  await page.click('#hdr-explore');
  await page.click('#opt-missions');
  await expect(page.locator('#hdr-explore-text')).toHaveText('Explore');
  await expect(page.locator('#hdr-explore')).not.toHaveClass(/active/);
});

test('View toggles stay open for combining; the count badge tracks them', async ({ page }) => {
  await markSeen(page);
  await gotoOrrery(page, null, { pinMenus: false });

  // Orbits, labels and flow are on by default → the badge already reads 3.
  await expect(page.locator('#hdr-view-count')).toHaveText('3');

  await page.click('#hdr-view');
  await page.click('#opt-orbits');
  await expect(page.locator('#opt-orbits')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#hdr-menu-view')).toBeVisible(); // toggles don't close it
  await expect(page.locator('#hdr-view-count')).toHaveText('2');

  await page.click('#opt-lagrange');
  await expect(page.locator('#hdr-view-count')).toHaveText('3');
  expect(await page.evaluate(() => window.ORRERY.Lagrange3D !== undefined)).toBe(true);
});

test('overlay quick-toggles proxy the vizpanel heads both ways', async ({ page }) => {
  await markSeen(page);
  await gotoOrrery(page, null, { pinMenus: false });

  await page.click('#hdr-view');
  const proxies = page.locator('#vt-overlays .vt-viz');
  await expect(proxies).toHaveCount(4); // gravity, speed, resonance, wobble

  // Proxy → real state: the quick toggle drives the drawer's own button.
  await proxies.nth(0).click();
  expect(await page.evaluate(() => window.ORRERY.GravityWell.enabled)).toBe(true);
  await expect(proxies.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#vizpanel .vz-head').nth(0)).toHaveAttribute('aria-pressed', 'true');

  // Real → proxy state: flipping it inside the drawer updates the mirror.
  await page.click('#opt-viz');
  await expect(page.locator('#vizpanel')).toHaveClass(/open/);
  await page.locator('#vizpanel .vz-head').nth(0).click();
  expect(await page.evaluate(() => window.ORRERY.GravityWell.enabled)).toBe(false);
  await expect(proxies.nth(0)).toHaveAttribute('aria-pressed', 'false');
});

test('right-docked drawers slide the header clear and hand the corner back', async ({ page }) => {
  await markSeen(page);
  await gotoOrrery(page, null, { pinMenus: false });

  // The vizpanel drawer covers the top-right corner → body.drawer-open.
  await page.click('#hdr-view');
  await page.click('#opt-viz');
  await expect(page.locator('#vizpanel')).toHaveClass(/open/);
  await expect(page.locator('body')).toHaveClass(/drawer-open/);

  await page.click('#vizpanel header button');
  await expect(page.locator('body')).not.toHaveClass(/drawer-open/);

  // The info panel (planet click) is the other 340px right drawer.
  await page.locator('#rail .chip', { hasText: /^Earth$/ }).click();
  await expect(page.locator('#panel')).toHaveClass(/open/);
  await expect(page.locator('body')).toHaveClass(/drawer-open/);
  await page.click('#p-close');
  await expect(page.locator('body')).not.toHaveClass(/drawer-open/);
});

test('chrome-hiding modes hide the header exactly like the old rail', async ({ page }) => {
  await markSeen(page);
  await gotoOrrery(page, null, { pinMenus: false });

  // Tour: body.touring hides the header (menus included).
  await page.click('#hdr-explore');
  await page.click('#opt-tour');
  await expect(page.locator('body')).toHaveClass(/touring/);
  await expect(page.locator('#hdr')).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/touring/);
  await expect(page.locator('#hdr')).toBeVisible();

  // Cosmos: deep space wants a bare cockpit.
  await page.evaluate(() => window.ORRERY.Cosmos.enter());
  await expect(page.locator('#hdr')).not.toBeVisible();
  await page.evaluate(() => window.ORRERY.Cosmos.exit());
  await expect(page.locator('#hdr')).toBeVisible();
});

test('first visit ever auto-opens Explore once; later visits stay calm', async ({ page }) => {
  // No markSeen: this IS the first-visit test.
  await gotoOrrery(page, null, { pinMenus: false });
  await expect(page.locator('#hdr-menu-explore')).toBeVisible({ timeout: 3000 });

  // Same context = same localStorage: a reload must NOT auto-open.
  await gotoOrrery(page, null, { pinMenus: false });
  await page.waitForTimeout(900); // auto-open fires at 600 ms (header.js) — 50% margin past it
  await expect(page.locator('#hdr-menu-explore')).not.toBeVisible();
});

test('mobile: icon controls, full-width sheet menus, no chip rail', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await markSeen(page);
  await gotoOrrery(page, null, { pinMenus: false });

  // No assertSceneRendered here: the CI pixel checker guards against small
  // viewports by design; the desktop tests already assert rendered pixels.
  await screenshot(page, 'header-mobile-closed');

  // Controls are finger-sized targets.
  const box = await page.locator('#hdr-explore').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(40);

  // The menu opens as a full-width sheet under the header.
  await page.click('#hdr-explore');
  const menu = await page.locator('#hdr-menu-explore').boundingBox();
  expect(menu.width).toBeGreaterThan(340); // 390 − 2·12px margins
  await expect(page.locator('#opt-missions')).toBeVisible();
  await screenshot(page, 'header-mobile-explore-open');

  await page.click('#hdr-view');
  await expect(page.locator('#hdr-menu-view')).toBeVisible();
  await screenshot(page, 'header-mobile-view-open');
});
