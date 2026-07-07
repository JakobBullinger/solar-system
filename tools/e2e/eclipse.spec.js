/**
 * eclipse.spec.js — Level 27, eclipse finder + umbra sweep, end to end.
 *
 * Opens the real almanac drawer with the clock pinned to July 2026, asserts
 * the Eclipses section lists the 2026-08-12 total solar eclipse, clicks it
 * and proves the sweep choreography (clock lands just before maximum and
 * PLAYS at the readable rate). Then pins the exact greatest-eclipse jd
 * (wave-5 lesson: deterministic clock + day-side framing) and screenshots
 * the Moon's shadow on Earth, asserting the real Sun–Moon–Earth alignment
 * from ORRERY state AND a pixel-level A/B (same framing at max vs +3 days:
 * the disc darkens where the umbra lands). Second test: the 2026-03-03 total
 * lunar eclipse turns the Moon copper (material state + screenshot) and
 * cleanly reverts a day later. Zero console errors throughout (auto fixture).
 */
'use strict';

const fs = require('fs');
const zlib = require('zlib');
const { test, expect, gotoOrrery, screenshot, assertSceneRendered } = require('./orrery');

/**
 * Mean luminance (max RGB channel) over a pixel box of a PNG — the umbra
 * proof is an A/B: the same camera framing at greatest eclipse vs 3 days
 * later, asserting the disc actually DARKENS where the shadow lands (state
 * checks can't catch a shader that silently no-ops). Minimal zero-dep PNG
 * decode, same approach as test/ci/check-screenshot.js.
 */
function pngRegionLuma(file, x0, y0, x1, y1) {
  const buf = fs.readFileSync(file);
  let width = 0, channels = 4, off = 8;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(off + 8);
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[buf[off + 8 + 9]];
    } else if (type === 'IDAT') idat.push(buf.slice(off + 8, off + 8 + len));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
  };
  const px = Buffer.alloc(raw.length);
  let sum = 0, n = 0;
  for (let y = 0; y <= y1; y++) {
    const f = raw[y * (stride + 1)], ri = y * (stride + 1) + 1, ro = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[ri + x];
      const left = x >= channels ? px[ro + x - channels] : 0;
      const up = y > 0 ? px[ro - stride + x] : 0;
      const ul = y > 0 && x >= channels ? px[ro - stride + x - channels] : 0;
      px[ro + x] = (f === 0 ? cur : f === 1 ? cur + left : f === 2 ? cur + up
        : f === 3 ? cur + ((left + up) >> 1) : cur + paeth(left, up, ul)) & 0xff;
    }
    if (y < y0) continue;
    for (let x = x0; x < x1; x++) {
      const i = ro + x * channels;
      sum += Math.max(px[i], px[i + 1], px[i + 2]);
      n++;
    }
  }
  return sum / n;
}

// Greatest-eclipse instants pinned by test/eclipse.test.js against the canon
const JD = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) / 86400000 + 2440587.5;
const SOLAR_MAX = JD(2026, 8, 12, 17, 46);   // total solar, Iceland sector
const LUNAR_MAX = JD(2026, 3, 3, 11, 34);    // total lunar

const raf2 = (page) => page.evaluate(
  () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
);

/**
 * Park the camera day-side of a world point but OFF the Sun–Earth axis
 * (sunDist units toward the Sun — the scene origin — plus a lateral offset),
 * so during a solar eclipse the Moon doesn't block Earth: both the lit disc
 * and the umbra on it stay visible. target = 'earth' | 'moon'.
 */
async function daySideCamera(page, target, sunDist, sideDist, lift) {
  await page.evaluate(({ target, sunDist, sideDist, lift }) => {
    const O = window.ORRERY;
    const earth = O.DATA.PLANETS.filter((p) => p.key === 'earth')[0];
    const w = O.Kepler.scenePosition(earth.el, O.TimeBar.jd, new window.THREE.Vector3());
    if (target === 'moon') {
      const d = O.MoonSync.debug();
      w.add(new window.THREE.Vector3(d.pos.x, d.pos.y, d.pos.z));
    }
    const sunward = w.clone().normalize().multiplyScalar(-1);
    const side = sunward.clone().cross(new window.THREE.Vector3(0, 1, 0)).normalize();
    const to = w.clone()
      .add(sunward.multiplyScalar(sunDist))
      .add(side.multiplyScalar(sideDist));
    to.y += lift;
    O.CameraPath.begin({ to, instant: true });
  }, { target, sunDist, sideDist, lift });
}

/**
 * Clear canvas-covering overlays before a screenshot. Deliberately does NOT
 * close the body dossier panel: Panel.close() clears `follow`, and with it
 * the camera target (first take of these shots framed the Sun instead of
 * Earth). The panel is the app's real post-jump state anyway.
 */
async function clearOverlays(page) {
  await page.evaluate(() => {
    window.ORRERY.Header.closeAll();
    document.getElementById('tour-offer').classList.remove('show');
  });
}

test('almanac lists 2026-08-12 total solar; jump sweeps; umbra lands on Earth at max', async ({ page }) => {
  // ?jd pins the almanac window deterministically (and counts as deep-linked
  // state, so the first-visit tour card never competes with the screenshot)
  await gotoOrrery(page, '?jd=' + JD(2026, 7, 1, 0, 0) + '&play=0');

  await page.click('#opt-events');
  await expect(page.locator('#events')).toHaveClass(/open/);

  // Eclipses section exists and leads the list, with its honesty note
  await expect(page.locator('.ev-sec').first()).toContainText('Eclipses');
  await expect(page.locator('.ev-sec-note')).toContainText('schematic');

  // The showcase row: 12 Aug 2026, total solar, with instant + ground point
  const row = page.locator('.ev-row.ev-eclipse.ev-ecl-solar', { hasText: '12 Aug 2026' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Total solar eclipse');
  await expect(row).toContainText('17:4');            // greatest ≈ 17:46-47 UTC
  // Lunar rows are present too (2026-08-28 partial is in this window)
  await expect(
    page.locator('.ev-row.ev-ecl-lunar', { hasText: '28 Aug 2026' })
  ).toContainText('Partial lunar eclipse');

  // --- The jump is a sweep: lands just before max, playing, readable rate ---
  await row.click();
  const sweep = await page.evaluate(() => ({
    jd: window.ORRERY.TimeBar.jd,
    playing: window.ORRERY.TimeBar.playing,
    rate: window.ORRERY.TimeBar.rate,
  }));
  expect(sweep.playing, 'sweep plays the event').toBe(true);
  expect(sweep.rate, 'readable sweep rate').toBeLessThan(0.02);
  expect(sweep.jd, 'lands before maximum').toBeLessThan(SOLAR_MAX - 0.02);
  expect(sweep.jd, 'lands within the event window').toBeGreaterThan(SOLAR_MAX - 0.09);

  // --- Pin greatest eclipse exactly and prove the alignment is real --------
  await page.evaluate((jd) => {
    window.ORRERY.TimeBar.playing = false;
    window.ORRERY.TimeBar.snapJd(jd);
  }, SOLAR_MAX);
  await raf2(page);

  const align = await page.evaluate(() => {
    const O = window.ORRERY;
    const d = O.MoonSync.debug();
    const earth = O.DATA.PLANETS.filter((p) => p.key === 'earth')[0];
    const e = O.Kepler.scenePosition(earth.el, O.TimeBar.jd, new window.THREE.Vector3());
    const moonDir = new window.THREE.Vector3(d.pos.x, d.pos.y, d.pos.z).normalize();
    const sunDir = e.clone().multiplyScalar(-1).normalize(); // Earth → Sun
    return { dot: moonDir.dot(sunDir), moonDist: Math.hypot(d.pos.x, d.pos.y, d.pos.z) };
  });
  // Real geometry: at greatest eclipse the Moon sits on the Earth–Sun line
  // (γ=0.90 ≈ 0.9° off-axis as seen from Earth's centre; cos 2° = 0.9994)
  expect(align.dot, 'Moon between Earth and Sun at max').toBeGreaterThan(0.9994);
  expect(align.moonDist, 'Moon at its display radius').toBeGreaterThan(1);

  // --- Screenshot: day side of Earth, Moon's shadow on the disc ------------
  // Drawer closes cleanly first, then clear all overlays for the shot
  await page.click('#ev-close');
  await expect(page.locator('#events')).not.toHaveClass(/open/);
  await clearOverlays(page);
  await daySideCamera(page, 'earth', 6.5, 4.5, 1.6);
  await raf2(page);
  await raf2(page); // SwiftShader: extra frames before shooting (wave-5 lesson)
  const shot = await screenshot(page, 'eclipse-solar-umbra-max');
  assertSceneRendered(shot);

  // --- A/B umbra proof: same sun-relative framing 3 days later -------------
  // The umbra reads as a soft dark blob near the disc centre (in compressed
  // display space the shadow axis passes ~0.06 units from Earth's centre, so
  // it lands near the sub-solar point). Prove the pixels darken AT max and
  // recover after — a state check alone can't catch a shader that no-ops.
  await page.evaluate((jd) => window.ORRERY.TimeBar.snapJd(jd), SOLAR_MAX + 3);
  await raf2(page);
  await daySideCamera(page, 'earth', 6.5, 4.5, 1.6);
  await raf2(page);
  await raf2(page);
  const clearShot = await screenshot(page, 'eclipse-solar-umbra-clear');
  assertSceneRendered(clearShot);
  // Right-of-centre disc box (Earth is the follow target, centred ~(800,500)
  // at the pinned framing; disc radius ~215 px) — where the umbra sits at max
  const lumaMax = pngRegionLuma(shot, 760, 400, 1000, 620);
  const lumaClear = pngRegionLuma(clearShot, 760, 400, 1000, 620);
  expect(lumaClear, 'off-eclipse disc is lit terrain').toBeGreaterThan(40);
  expect(lumaMax, 'umbra darkens the disc at maximum (A/B vs +3d)')
    .toBeLessThan(lumaClear * 0.65);
});

test('2026-03-03 total lunar: Moon turns copper through the umbra, reverts after', async ({ page }) => {
  await gotoOrrery(page, '?body=moon');

  // Mid-totality, pinned
  await page.evaluate((jd) => {
    window.ORRERY.TimeBar.playing = false;
    window.ORRERY.TimeBar.snapJd(jd);
  }, LUNAR_MAX);
  await raf2(page);

  const mid = await page.evaluate(() => window.ORRERY.MoonSync.debug());
  expect(mid.shading.umbra, 'fully immersed at totality').toBe(1);
  // Copper: red holds a strong lead over green/blue vs the neutral base
  expect(mid.color.r, 'tinted away from base').toBeLessThan(mid.base.r - 0.1);
  expect(mid.color.r / Math.max(0.001, mid.color.g), 'copper ratio').toBeGreaterThan(2);

  // Anti-solar side, as a lunar eclipse demands: Moon direction ≈ Earth's
  // outward (away-from-Sun) direction
  const geom = await page.evaluate(() => {
    const O = window.ORRERY;
    const d = O.MoonSync.debug();
    const earth = O.DATA.PLANETS.filter((p) => p.key === 'earth')[0];
    const e = O.Kepler.scenePosition(earth.el, O.TimeBar.jd, new window.THREE.Vector3());
    return new window.THREE.Vector3(d.pos.x, d.pos.y, d.pos.z).normalize()
      .dot(e.normalize());
  });
  expect(geom, 'Moon opposite the Sun').toBeGreaterThan(0.999);

  // Screenshot the copper Moon from between Earth and Moon, close in (the
  // copper face looks at Earth/Sun; from farther sunward the camera lands
  // inside Earth's neighbourhood — first take framed Earth's limb instead)
  await clearOverlays(page);
  await daySideCamera(page, 'moon', 2.4, 0.9, 0.5);
  await raf2(page);
  await raf2(page);
  const shot = await screenshot(page, 'eclipse-lunar-copper');
  assertSceneRendered(shot);

  // A day later: shading gone, exact base color restored — no residual state
  await page.evaluate((jd) => window.ORRERY.TimeBar.snapJd(jd), LUNAR_MAX + 1);
  await raf2(page);
  const after = await page.evaluate(() => window.ORRERY.MoonSync.debug());
  expect(after.shading.umbra).toBe(0);
  expect(after.shading.penumbra).toBe(0);
  expect(after.color.r).toBeCloseTo(after.base.r, 5);
  expect(after.color.g).toBeCloseTo(after.base.g, 5);
  expect(after.color.b).toBeCloseTo(after.base.b, 5);
});
