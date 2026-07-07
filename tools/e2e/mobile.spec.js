/**
 * mobile.spec.js — touch/mobile regression guard (feature/mobile-touch).
 *
 * Runs the whole file under iPhone 13 emulation (390×664, DPR 3, touch,
 * coarse pointer) against the same built bundle as the desktop specs. Guards
 * the touch-audit fixes:
 *
 *  - pinch is a first-class zoom handoff: pinch-out enters the cosmic zoom,
 *    pinch drives L through the stages, pinch-in comes home; pinch-in on a
 *    focused Earth enters Earth orbit, pinch-out past the Moon exits
 *    (cosmos.js / earthorbit.js touch handlers mirror the wheel thresholds);
 *  - an OPEN header menu beats the sandbox HUD and the first-visit tour
 *    offer on narrow screens (app.css `body:has(.hdr-menu.open)` block) —
 *    asserted via hit-testing and computed styles, not presence-in-sheet
 *    (ORCHESTRATION.md: only computed styles reveal swallowed rules);
 *  - a sandbox body can be launched by touch drag (labels are click-through
 *    for coarse pointers while aiming — body.sandboxing hook);
 *  - drawers open/scroll/close by touch (Mars planner, sticky header);
 *  - the timebar scrubs by touch.
 *
 * Pinch synthesis is raw CDP touch events (Input.dispatchTouchEvent): the
 * app's handlers listen for real two-finger touchmove gap deltas, and
 * Playwright's touchscreen only taps.
 */
'use strict';

const { devices } = require('@playwright/test');
const { test, expect, gotoOrrery, screenshot, assertSceneRendered } = require('./orrery');

const IPHONE = devices['iPhone 13'];
test.use({
  viewport: IPHONE.viewport,           // 390×664
  userAgent: IPHONE.userAgent,
  deviceScaleFactor: IPHONE.deviceScaleFactor,
  isMobile: IPHONE.isMobile,
  hasTouch: true,                      // pointer: coarse — the CSS gate for touch-only UI
});

// Every test starts as a RETURNING visitor: the first-visit timers (Explore
// menu auto-open at 600ms, tour offer) otherwise fire mid-test and cover the
// canvas on a phone. The occlusion test re-summons the offer explicitly.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('orrery-explore-shown', '1');
      localStorage.setItem('orrery-tour-offered', '1');
    } catch (e) { }
  });
});

// --- touch helpers ---------------------------------------------------------------

async function cdpFor(page) {
  return page.context().newCDPSession(page);
}

const tp = (pts) => pts.map((p) => ({ x: p.x, y: p.y, id: p.id, force: 1, radiusX: 2, radiusY: 2 }));

/** Two-finger pinch at (cx,cy): gap animates startGap → endGap.
 *  Fingers closing (start > end) reads as "zoom out", opening as "zoom in". */
async function pinch(page, cdp, cx, cy, startGap, endGap, steps) {
  const n = steps || 10;
  const pts = (gap) => [{ x: cx - gap / 2, y: cy, id: 1 }, { x: cx + gap / 2, y: cy, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(pts(startGap)) });
  for (let i = 1; i <= n; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: tp(pts(startGap + (endGap - startGap) * (i / n))),
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(60);
}

/** One-finger touch drag. */
async function touchDrag(page, cdp, x0, y0, x1, y1, steps) {
  const n = steps || 14;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([{ x: x0, y: y0, id: 1 }]) });
  for (let i = 1; i <= n; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: tp([{ x: x0 + (x1 - x0) * (i / n), y: y0 + (y1 - y0) * (i / n), id: 1 }]),
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(120);
}

/** Open one header menu exclusively (phone menus are full-width sheets that
 *  overlap when both are pinned open). */
async function soloMenu(page, name) {
  await page.evaluate((n) => {
    window.ORRERY.Header.closeAll();
    window.ORRERY.Header.setOpen(n, true);
  }, name);
}

/** Touch-tap an element by selector (scrolled into view first). */
async function tapEl(page, sel) {
  const b = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, sel);
  if (!b) throw new Error('tapEl: not found ' + sel);
  await page.touchscreen.tap(b.x, b.y);
  await page.waitForTimeout(120);
}

// --- specs -----------------------------------------------------------------------

test('pinch-out enters the cosmic zoom, drives the stages, pinch-in comes home', async ({ page }) => {
  await gotoOrrery(page);
  const cdp = await cdpFor(page);
  await page.evaluate(() => {
    const O = window.ORRERY;
    O.Header.closeAll();
    O.TimeBar.playing = false;
    // park just inside max zoom along the current bearing (the wheel spec's trick)
    const pose = O.CameraPath.pose();
    const target = new window.THREE.Vector3().fromArray(pose.target);
    const pos = new window.THREE.Vector3().fromArray(pose.position);
    const dir = pos.sub(target).normalize().multiplyScalar(2590).add(target);
    O.CameraPath.begin({ to: dir, instant: true });
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  // fingers closing = zoom out → past the stop → cosmos
  for (let i = 0; i < 6 && !(await page.evaluate(() => window.ORRERY.Cosmos.active)); i++) {
    await pinch(page, cdp, 195, 330, 300, 60);
  }
  expect(await page.evaluate(() => window.ORRERY.Cosmos.active)).toBe(true);

  // pinch keeps going: target L advances through the stages
  const L1 = await page.evaluate(() => window.ORRERY.Cosmos.getTargetL());
  await pinch(page, cdp, 195, 330, 320, 60);
  await pinch(page, cdp, 195, 330, 320, 60);
  const L2 = await page.evaluate(() => window.ORRERY.Cosmos.getTargetL());
  expect(L2).toBeGreaterThan(L1 + 0.3);

  // the touch way home is visible (coarse pointers only) and the hint speaks touch
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.cz-exit')).display)).toBe('block');
  expect(await page.evaluate(() => document.querySelector('.cz-hint').textContent)).toContain('pinch');
  const shot = await screenshot(page, 'mobile-cosmos');
  assertSceneRendered(shot);

  // fingers opening = zoom in → below L_MIN → home
  for (let i = 0; i < 8 && (await page.evaluate(() => window.ORRERY.Cosmos.active)); i++) {
    await pinch(page, cdp, 195, 330, 60, 340);
  }
  expect(await page.evaluate(() => window.ORRERY.Cosmos.active)).toBe(false);
});

test('earth orbit on a phone: menu tap enters, ✕ exits, rate buttons are finger-sized', async ({ page }) => {
  // On a 390px phone the info panel is full-screen, so the follow+pinch
  // combination that mirrors the desktop wheel cannot exist — the Explore
  // menu row IS the touch entry there (the pinch mirror is guarded on a
  // tablet viewport below).
  await gotoOrrery(page);
  await soloMenu(page, 'explore');
  await tapEl(page, '#opt-earth');
  await expect(page.locator('#eo-ui')).toHaveClass(/on/);
  expect(await page.evaluate(() => window.ORRERY.EarthOrbit.active)).toBe(true);

  const sizes = await page.evaluate(() => {
    const r = document.getElementById('eo-exit').getBoundingClientRect();
    const rate = document.querySelector('.eo-rate').getBoundingClientRect();
    return { exit: { w: r.width, h: r.height, y: r.y }, rate: { w: rate.width, h: rate.height } };
  });
  expect(sizes.exit.h).toBeGreaterThanOrEqual(28);
  expect(sizes.rate.h).toBeGreaterThanOrEqual(28);
  const shot = await screenshot(page, 'mobile-earthorbit');
  assertSceneRendered(shot);

  await tapEl(page, '#eo-exit');
  await expect(page.locator('#eo-ui')).not.toHaveClass(/on/);
  expect(await page.evaluate(() => window.ORRERY.EarthOrbit.active)).toBe(false);
});

test.describe('tablet-sized touch screen', () => {
  // Wide enough that the info panel is a side drawer (follow survives, the
  // canvas stays pinchable) — the regime where the pinch mirrors the wheel.
  test.use({ viewport: { width: 1024, height: 768 } });

  test('pinch-in on a focused Earth enters Earth orbit; pinch-out past the Moon exits', async ({ page }) => {
    await gotoOrrery(page, '?body=earth');
    const cdp = await cdpFor(page);
    await page.evaluate(() => {
      const O = window.ORRERY;
      O.Header.closeAll();
      O.TimeBar.playing = false;   // Earth outruns a camera parked at the stop
      const pose = O.CameraPath.pose();
      const target = new window.THREE.Vector3().fromArray(pose.target);
      const pos = new window.THREE.Vector3().fromArray(pose.position);
      const dir = pos.sub(target).normalize().multiplyScalar(4.05).add(target);
      O.CameraPath.begin({ to: dir, instant: true });
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    // fingers opening = zoom in → past the stop → Earth orbit (pinch on the
    // exposed canvas left of the 340px panel drawer)
    for (let i = 0; i < 6 && !(await page.evaluate(() => window.ORRERY.EarthOrbit.active)); i++) {
      await pinch(page, cdp, 340, 380, 60, 320);
    }
    expect(await page.evaluate(() => window.ORRERY.EarthOrbit.active)).toBe(true);
    await expect(page.locator('#eo-ui')).toHaveClass(/on/);
    const shot = await screenshot(page, 'tablet-earthorbit-pinch');
    assertSceneRendered(shot);

    // fingers closing = zoom out; OrbitControls dollies to the mode's stop,
    // then the accumulator hands back to the solar system
    for (let i = 0; i < 25 && (await page.evaluate(() => window.ORRERY.EarthOrbit.active)); i++) {
      await pinch(page, cdp, 340, 380, 320, 50);
    }
    expect(await page.evaluate(() => window.ORRERY.EarthOrbit.active)).toBe(false);
    await expect(page.locator('#eo-ui')).not.toHaveClass(/on/);
  });
});

test('sandbox: a touch drag on clear sky launches a body', async ({ page }) => {
  await gotoOrrery(page);
  const cdp = await cdpFor(page);
  await soloMenu(page, 'explore');
  await tapEl(page, '#opt-sandbox');
  await expect(page.locator('#sandbox-hud')).toHaveClass(/show/);
  // the coarse-pointer label fix hangs off this class
  expect(await page.evaluate(() => document.body.classList.contains('sandboxing'))).toBe(true);

  // The drag STARTS on clear sky (mid-height: low-screen rays can miss the
  // ecliptic); crossing the HUD mid-drag is fine — the touch began on the
  // canvas (touch-action: none), and the release is a window listener.
  const spot = await page.evaluate(() => {
    for (let y = 240; y < 420; y += 20) {
      for (let x = 25; x < 360; x += 15) {
        const a = document.elementFromPoint(x, y);
        if (a && a.id === 'scene') return { x, y };
      }
    }
    return null;
  });
  expect(spot).not.toBeNull();
  await touchDrag(page, cdp, spot.x, spot.y, spot.x + 150, spot.y - 80);
  await expect(page.locator('#sb-count')).toHaveText(/1 body/);
  const shot = await screenshot(page, 'mobile-sandbox-launch');
  assertSceneRendered(shot);
  await page.evaluate(() => document.getElementById('sb-clear').click());
});

test('an open header menu beats the sandbox HUD and the tour offer (phone occlusion)', async ({ page }) => {
  await gotoOrrery(page, null, { pinMenus: false });
  // recreate the worst case the audit caught: first-visit offer showing AND
  // the sandbox HUD up, then the user opens Explore by touch
  await page.evaluate(() => {
    window.ORRERY.Header.closeAll();
    document.getElementById('tour-offer').classList.add('show');
    document.getElementById('opt-sandbox').click();
  });
  await page.waitForTimeout(200);
  if (!(await page.evaluate(() => window.ORRERY.Header.isOpen('explore')))) {
    await tapEl(page, '#hdr-explore');
  }
  expect(await page.evaluate(() => window.ORRERY.Header.isOpen('explore'))).toBe(true);

  // every Explore item is hit-testable — nothing overlays the open menu
  const covered = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#hdr-menu-explore .mi').forEach((b) => {
      b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect();
      const at = document.elementFromPoint(r.x + r.width / 2, Math.min(r.y + r.height / 2, innerHeight - 1));
      if (!at || !at.closest('#hdr-menu-explore')) out.push(b.id + '<-' + (at ? at.id || at.className : 'null'));
    });
    return out;
  });
  expect(covered).toEqual([]);

  // computed styles, not presence-in-sheet: the overlays really did yield
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('sandbox-hud')).opacity)).toBe('0');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('tour-offer')).opacity)).toBe('0');
  await screenshot(page, 'mobile-menu-over-hud');

  // and they come back when the menu closes
  await page.evaluate(() => window.ORRERY.Header.closeAll());
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('sandbox-hud')).opacity)).toBe('1');
  await page.evaluate(() => document.getElementById('opt-sandbox').click());
});

test('Mars planner drawer opens, scrolls and closes by touch; ✕ stays reachable', async ({ page }) => {
  await gotoOrrery(page);
  const cdp = await cdpFor(page);
  await soloMenu(page, 'explore');
  await tapEl(page, '#opt-mars');
  await expect(page.locator('#marsplan')).toHaveClass(/open/);

  // touch-scroll the timeline; the sticky header must keep ✕ on screen
  const box = await page.evaluate(() => {
    const r = document.getElementById('marsplan').getBoundingClientRect();
    return { x: r.x + r.width / 2, top: r.y, h: r.height };
  });
  await touchDrag(page, cdp, box.x, box.top + box.h * 0.7, box.x, box.top + box.h * 0.2, 10);
  const st = await page.evaluate(() => document.getElementById('marsplan').scrollTop);
  expect(st).toBeGreaterThan(50);
  const closeBtn = await page.evaluate(() => {
    const r = document.getElementById('mp-close').getBoundingClientRect();
    return { y: r.y, h: r.height, w: r.width };
  });
  expect(closeBtn.y).toBeGreaterThanOrEqual(0);      // did not scroll away
  expect(closeBtn.w).toBeGreaterThanOrEqual(44);     // finger-sized (mobile CSS)
  expect(closeBtn.h).toBeGreaterThanOrEqual(44);
  await screenshot(page, 'mobile-marsplan');

  await tapEl(page, '#mp-close');
  await expect(page.locator('#marsplan')).not.toHaveClass(/open/);
});

test('timebar scrubs by touch (tap jumps, drag slides)', async ({ page }) => {
  await gotoOrrery(page);
  const cdp = await cdpFor(page);
  await page.evaluate(() => window.ORRERY.Header.closeAll());
  const s = await page.evaluate(() => {
    const r = document.getElementById('tb-slider').getBoundingClientRect();
    return { x: r.x, y: r.y + r.height / 2, w: r.width, h: r.height };
  });
  expect(s.h).toBeGreaterThanOrEqual(28);            // finger-sized hit strip (mobile CSS)
  const v0 = await page.evaluate(() => document.getElementById('tb-slider').value);
  await page.touchscreen.tap(s.x + s.w * 0.25, s.y);
  await page.waitForTimeout(120);
  const v1 = await page.evaluate(() => document.getElementById('tb-slider').value);
  expect(v1).not.toBe(v0);
  await touchDrag(page, cdp, s.x + s.w * 0.25, s.y, s.x + s.w * 0.9, s.y, 10);
  const v2 = await page.evaluate(() => document.getElementById('tb-slider').value);
  expect(Number(v2)).toBeGreaterThan(Number(v1));
});
