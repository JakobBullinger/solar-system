/**
 * readme-shots.js — regenerate the README gallery screenshots in docs/img/.
 *
 * A one-shot tool, deliberately NOT an e2e spec (it would add ~2 min to every
 * suite run for images that only change when the README does). It reuses the
 * e2e library's navigation + pixel-truth helpers and the exact camera/state
 * recipes proven in the specs (zoo.spec.js frameEarth, eclipse.spec.js
 * daySideCamera, whatif.spec.js scenario flow), with every clock pinned so
 * reruns reproduce the same frames.
 *
 * Usage:  node build.js && node tools/readme-shots.js [shot ...]
 *         (no args = all; names: hero eclipse earthorbit galaxy whatif)
 * Output: docs/img/readme-*.png at 1600×1000. The committed gallery uses JPEG
 * (starfield PNGs resample badly and stay > 300 KB; JPEG 85 lands ~250 KB):
 *   cd docs/img && for f in readme-*.png; do \
 *     sips -s format jpeg -s formatOptions 85 "$f" --out "${f%.png}.jpg" && rm "$f"; done
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { gotoOrrery, assertSceneRendered } = require('./e2e/orrery');

const OUT = path.join(__dirname, '..', 'docs', 'img');

const JD = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) / 86400000 + 2440587.5;
const SOLAR_MAX = JD(2026, 8, 12, 17, 46); // greatest eclipse, pinned by eclipse.test.js

const raf = (page, n) => page.evaluate((k) => new Promise((res) => {
  const step = (i) => (i <= 0 ? res() : requestAnimationFrame(() => step(i - 1)));
  step(k);
}), n || 3);

async function shot(page, name, clip) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file, clip });
  assertSceneRendered(file); // black-canvas guard, same checker as CI
  console.log('  wrote', path.relative(process.cwd(), file));
  return file;
}

/** Hide menus/offers that would photobomb a clean scene shot. */
async function clearChrome(page) {
  await page.evaluate(() => {
    window.ORRERY.Header.closeAll();
    const offer = document.getElementById('tour-offer');
    if (offer) offer.classList.remove('show');
  });
}

async function snapTo(page, jd) {
  await page.evaluate((j) => {
    const TB = window.ORRERY.TimeBar;
    TB.playing = false;
    TB.snapJd(j);
  }, jd);
  await raf(page);
}

/** Earth-orbit regime: camera on the sunward side of the origin-parked Earth. */
async function frameEarth(page, dist, elevate) {
  await page.evaluate(([d, e]) => {
    const O = window.ORRERY;
    const earth = O.DATA.PLANETS.filter((p) => p.key === 'earth')[0];
    const h = O.Kepler.heliocentric(earth.el, O.TimeBar.jd);
    const to = new window.THREE.Vector3(-h.x, -h.z, h.y).normalize().multiplyScalar(d);
    to.y += e;
    O.CameraPath.begin({ to, instant: true });
  }, [dist, elevate]);
  await raf(page);
}

/** Heliocentric: park day-side of Earth, off the Sun–Earth axis (eclipse framing). */
async function daySideCamera(page, sunDist, sideDist, lift) {
  await page.evaluate(({ sunDist, sideDist, lift }) => {
    const O = window.ORRERY;
    const earth = O.DATA.PLANETS.filter((p) => p.key === 'earth')[0];
    const w = O.Kepler.scenePosition(earth.el, O.TimeBar.jd, new window.THREE.Vector3());
    const sunward = w.clone().normalize().multiplyScalar(-1);
    const side = sunward.clone().cross(new window.THREE.Vector3(0, 1, 0)).normalize();
    const to = w.clone().add(sunward.multiplyScalar(sunDist)).add(side.multiplyScalar(sideDist));
    to.y += lift;
    O.CameraPath.begin({ to, instant: true });
  }, { sunDist, sideDist, lift });
  await raf(page);
}

async function driveTicks(page, days, stepDays) {
  await page.evaluate(([span, step]) => {
    const TB = window.ORRERY.TimeBar;
    TB.playing = false;
    let jd = TB.jd;
    const end = jd + span;
    while (jd < end) {
      const next = Math.min(jd + step, end);
      window.ORRERY.Sandbox.tick(jd, next);
      jd = next;
    }
    TB.jd = jd;
  }, [days, stepDays]);
}

const SHOTS = {
  // ---- Hero: the live orrery, wide ------------------------------------------------
  async hero(context) {
    const page = await context.newPage();
    await gotoOrrery(page, '?jd=' + JD(2026, 7, 4, 12, 0) + '&play=0');
    await clearChrome(page);
    await raf(page, 4);
    await shot(page, 'readme-hero');
    await page.close();
  },

  // ---- Total solar eclipse, 2026-08-12: umbra on Earth -----------------------------
  async eclipse(context) {
    const page = await context.newPage();
    await gotoOrrery(page, '?jd=' + SOLAR_MAX + '&body=earth&play=0');
    await clearChrome(page);
    // More lateral offset than the spec's framing pushes the Moon's display
    // sphere toward the frame edge; the clip crops it and the dossier panel
    // out so the lit disc + umbra carry the image, at the same 1.6:1 aspect
    // as the other gallery shots (uneven rows read badly in the README grid).
    await daySideCamera(page, 5.2, 6.4, 2.0);
    await raf(page, 6); // SwiftShader: extra frames before shooting
    await shot(page, 'readme-eclipse', { x: 0, y: 148, width: 1100, height: 688 });
    await page.close();
  },

  // ---- Earth-orbit regime: Starlink swarm, then Molniya ground track ---------------
  async earthorbit(context) {
    const page = await context.newPage();
    await gotoOrrery(page, '?jd=2461120.30&play=0'); // zoo.spec.js pinned equinox jd
    await page.click('#opt-earth');
    await page.waitForSelector('#eo-ui.on');
    await clearChrome(page);
    await snapTo(page, 2461120.30);
    await frameEarth(page, 24, 3);
    await raf(page, 6);
    await shot(page, 'readme-earth-orbit');

    await page.click('.eo-key[data-eo="molniya"]');
    await page.waitForSelector('#eo-card.show');
    await frameEarth(page, 30, 14); // the zoo.spec.js money-shot framing
    await raf(page, 6);
    await shot(page, 'readme-groundtrack');
    await page.close();
  },

  // ---- Cosmic zoom: the Milky Way stage ---------------------------------------------
  async galaxy(context) {
    const page = await context.newPage();
    await gotoOrrery(page, '?jd=' + JD(2026, 7, 4, 12, 0) + '&play=0');
    await clearChrome(page);
    await page.evaluate(() => window.ORRERY.Cosmos.enter());
    await raf(page);
    await page.evaluate(() => window.ORRERY.Cosmos.setL(9.4));
    await page.waitForFunction(() => window.ORRERY.Cosmos.getL() > 9.35, null, { timeout: 20000 });
    await raf(page, 8); // let the stage cross-fade settle
    await shot(page, 'readme-galaxy');
    await page.close();
  },

  // ---- Launch Window Lab: the Mars porkchop plot ------------------------------------
  async porkchop(context) {
    const page = await context.newPage();
    await gotoOrrery(page, '?jd=' + JD(2026, 7, 4, 12, 0) + '&play=0');
    await clearChrome(page);
    await page.evaluate(() => {
      window.ORRERY.Porkchop.open();
      window.ORRERY.Porkchop.setTarget('mars');
    });
    await page.waitForFunction(() => window.ORRERY.Porkchop.getState().done, null, { timeout: 60000 });
    await raf(page, 4);
    await shot(page, 'readme-porkchop');
    await page.close();
  },

  // ---- What-if: red-dwarf companion at 50 AU, a century in --------------------------
  async whatif(context) {
    const page = await context.newPage();
    await gotoOrrery(page, '?jd=' + JD(2026, 7, 4, 12, 0) + '&play=0');
    await page.click('#opt-sandbox');
    await page.waitForSelector('#sandbox-hud.show');
    await page.click('[data-scenario="companion"]');
    await driveTicks(page, 365 * 100, 5);
    await page.waitForFunction(() => window.ORRERY.OrbitFlow.railsFade > 0.95, null, { timeout: 8000 });
    await clearChrome(page); // the pinned View menu would photobomb the HUD
    await raf(page, 6);
    await shot(page, 'readme-whatif');
    await page.close();
  },
};

(async () => {
  const wanted = process.argv.slice(2);
  const names = wanted.length ? wanted : Object.keys(SHOTS);
  for (const n of names) {
    if (!SHOTS[n]) throw new Error('unknown shot "' + n + '" (have: ' + Object.keys(SHOTS).join(' ') + ')');
  }
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--force-prefers-reduced-motion',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: 'reduce',
  });
  for (const n of names) {
    console.log('shot:', n);
    await SHOTS[n](context);
  }
  await browser.close();
  console.log('done.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
