/**
 * hud-overlap.spec.js — Earth-orbit HUD layout guard (user-reported bug).
 *
 * The regime's rate-pill row (.eo-rates, level 24) and the ascent ride's
 * entry button (#asc-launch, PR #19) were authored by different lanes and
 * both anchored at left:50% / bottom:26px inside #eo-ui — after the merge
 * they rendered on top of each other. This spec pins the fix: at desktop,
 * laptop and phone viewports the launch button, the rate pills and the
 * clock text must all be fully on-screen and pairwise non-intersecting.
 * Pure layout truth via getBoundingClientRect — no pixel sampling needed.
 */
'use strict';

const { test, expect, gotoOrrery, screenshot } = require('./orrery');

const VIEWPORTS = [
  { name: 'desktop', width: 1600, height: 1000 },
  { name: 'laptop', width: 1280, height: 720 },
  { name: 'phone', width: 390, height: 664 }, // iPhone 13 logical size (mobile.spec.js)
];

/** Overlap area (px²) of two DOMRect-like boxes; 0 = clear of each other. */
function overlapArea(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return Math.max(0, w) * Math.max(0, h);
}

VIEWPORTS.forEach((vp) => {
  test.describe(`earth-orbit HUD at ${vp.name} (${vp.width}×${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('launch button clears the rate pills; all chrome on-screen', async ({ page }) => {
      await gotoOrrery(page);
      // The real menu entry handler (evaluate-click: with both header menus
      // pinned open on a phone the row can sit under the other menu, which
      // would flake a positional click — entry UX itself is covered by
      // earthorbit.spec.js / mobile.spec.js).
      await page.evaluate(() => document.getElementById('opt-earth').click());
      await expect(page.locator('#eo-ui')).toHaveClass(/on/);

      const m = await page.evaluate(() => {
        const r = (el) => {
          const b = el.getBoundingClientRect();
          return { left: b.left, top: b.top, right: b.right, bottom: b.bottom,
                   width: b.width, height: b.height };
        };
        return {
          launch: r(document.getElementById('asc-launch')),
          rates: r(document.querySelector('.eo-rates')),
          clock: r(document.getElementById('eo-clock')),
          hint: r(document.querySelector('.eo-hint')),
          ruler: r(document.querySelector('.eo-ruler')),
          vw: window.innerWidth,
          vh: window.innerHeight,
        };
      });
      await screenshot(page, `hud-overlap-${vp.name}`);

      // All rendered (a zero-size box means display:none / detached)
      for (const key of ['launch', 'rates', 'clock', 'hint']) {
        expect(m[key].width, `${key} has width`).toBeGreaterThan(0);
        expect(m[key].height, `${key} has height`).toBeGreaterThan(0);
        expect(m[key].left, `${key} on-screen left`).toBeGreaterThanOrEqual(0);
        expect(m[key].top, `${key} on-screen top`).toBeGreaterThanOrEqual(0);
        expect(m[key].right, `${key} on-screen right`).toBeLessThanOrEqual(m.vw);
        expect(m[key].bottom, `${key} on-screen bottom`).toBeLessThanOrEqual(m.vh);
      }

      // The reported bug: the launch button sat directly on the pills. The
      // whole bottom-center stack (hint / clock / pills / button) must be
      // pairwise clear — the first fix attempt uncovered the same collision
      // between the grown clock column and the hint's old absolute anchor.
      // (the right-docked km ruler shares the bottom band too — its width is
      // scale-dependent, so guard it against the column's widest rows)
      const keys = ['launch', 'rates', 'clock', 'hint', 'ruler'];
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          expect(overlapArea(m[keys[i]], m[keys[j]]),
            `${keys[i]} clear of ${keys[j]}`).toBe(0);
        }
      }

      // Touch-audit floor: the button stays finger-sized everywhere
      expect(m.launch.height, 'launch button touch height').toBeGreaterThanOrEqual(28);
    });
  });
});
