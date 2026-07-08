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

/** Snap the sim clock to an absolute jd and let one real frame apply it (zoo.spec.js pattern). */
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

/** Frame the camera looking down at Earth from a fixed elevated bearing (zoo.spec.js pattern). */
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
      // The clock/hint text is written by the regime's per-frame tick — the
      // `on` class flips synchronously in the click handler, so under
      // parallel CPU contention this measurement could land BEFORE the first
      // regime frame and read an empty (0×0) clock. Wait for the regime to
      // have actually painted its chrome, then measure (latent race even at
      // one worker; caught by the w=4 stability runs).
      await page.waitForFunction(() => {
        const c = document.getElementById('eo-clock');
        return c && c.textContent.trim().length > 0;
      });

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

// --- Satellite label declutter (user-reported: GEO labels interleave) -------------
//
// The "GEO ring" anchor label is pinned at longitude 0° — exactly
// Meteosat-11's slot — so the two labels project onto the SAME pixels at
// every camera angle and their glyphs interleave into garbage. Nearby GEO
// slots do the same at shallow bearings. Guard: at a pinned jd + camera, no
// two VISIBLE labels in the eo label layer intersect, the always-coincident
// pair is resolved (stacked apart or one hidden), and a label click still
// opens its dossier.
test.describe('earth-orbit satellite labels', () => {
  test('visible labels never overlap; coincident GEO pair resolved; dossier click intact', async ({ page }) => {
    await gotoOrrery(page);
    await page.evaluate(() => document.getElementById('opt-earth').click());
    await expect(page.locator('#eo-ui')).toHaveClass(/on/);

    // Deterministic view: zoo.spec.js's pinned jd + the belt-framing camera.
    await snapTo(page, 2461120.30);
    await frameEarth(page, 88, 26);

    const boxes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.eo-label'))
        .filter((el) => el.style.display !== 'none')
        .map((el) => {
          const b = el.getBoundingClientRect();
          return { text: el.textContent, left: b.left, top: b.top, right: b.right, bottom: b.bottom };
        });
    });
    await screenshot(page, 'hud-overlap-eo-labels');

    // The coincident pair must both be in play at this framing (visible or
    // deliberately hidden by the declutter pass — never interleaved).
    const meteosat = boxes.find((b) => b.text.indexOf('Meteosat') !== -1);
    const geoRing = boxes.find((b) => b.text.indexOf('GEO ring') !== -1);
    expect(meteosat, 'Meteosat-11 label visible at the pinned framing').toBeTruthy();
    if (meteosat && geoRing) {
      expect(overlapArea(meteosat, geoRing), 'coincident pair separated').toBe(0);
    }

    // Generic declutter contract: every visible label pair is disjoint.
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlapArea(boxes[i], boxes[j]),
          `"${boxes[i].text}" clear of "${boxes[j].text}"`).toBe(0);
      }
    }

    // Labels stay clickable after the declutter pass: dossier opens.
    await page.click('.eo-label:has-text("Meteosat-11")');
    await expect(page.locator('#eo-card')).toHaveClass(/show/);
    await expect(page.locator('#eo-card')).toContainText('Meteosat-11');
    await page.click('.eo-card-close');
    await expect(page.locator('#eo-card')).not.toHaveClass(/show/);
  });
});
