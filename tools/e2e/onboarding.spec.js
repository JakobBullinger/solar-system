/**
 * onboarding.spec.js — Grand Tour v2 + visitor guide (onboarding lane).
 *
 * The tour is the app's most state-entangled feature: it drives the clock,
 * the camera, the sandbox's massive mode, the Mars planner, and two whole
 * regimes (Earth orbit, cosmic zoom) that are normally guarded AGAINST it.
 * These specs walk every stop asserting the caption and the per-stop mode
 * state, then prove the restore discipline the hard way: Esc in the middle
 * of a hosted stop must unwind the hosted mode, the clock, the camera and
 * every body class in one keypress.
 *
 * The guide half checks the static site/guide.html: the file the deploy
 * workflow ships, its deep links resolving to real in-app states, and the
 * in-app menu link pointing at the live URL.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  test, expect, gotoOrrery, screenshot, assertSceneRendered, ROOT,
} = require('./orrery');

const TITLES = [
  'A living map of the solar system',
  'The Sun',
  'Earth',
  'Halley’s comet',
  'The sky knows its schedule',
  'Total eclipse of the Sun',
  'Break the solar system',
  'Fly to Mars, for real',
  'The grand tour',
  'Earth orbit, in kilometres',
  'To the edge of the map',
  'The sky is yours',
];

// The finder's 12 Aug 2026 greatest-eclipse instant (pinned by eclipse.test.js
// against the published canon); the tour lands ECLIPSE_LEAD = 0.06 d early.
const ECLIPSE_JD = 2461265.2413;

const modeState = (page) =>
  page.evaluate(() => ({
    touring: document.body.classList.contains('touring'),
    earthorbit: document.body.classList.contains('earthorbit'),
    cosmos: document.body.classList.contains('cosmos'),
    tourActive: window.ORRERY.Tour.active,
    hosting: window.ORRERY.Tour.hosting,
    eoActive: window.ORRERY.EarthOrbit.active,
    czActive: window.ORRERY.Cosmos.active,
    promoted: window.ORRERY.NBody.promoted,
    jd: window.ORRERY.TimeBar.jd,
    rate: window.ORRERY.TimeBar.rate,
    playing: window.ORRERY.TimeBar.playing,
  }));

const settleFrames = (page, n) =>
  page.evaluate(
    (k) =>
      new Promise((res) => {
        const step = (i) => (i <= 0 ? res() : requestAnimationFrame(() => step(i - 1)));
        step(k);
      }),
    n
  );

test('Grand Tour v2 walks all twelve stops, each self-contained', async ({ page }) => {
  test.setTimeout(180000); // twelve stops incl. a real cosmic-zoom ramp
  await gotoOrrery(page);
  const pre = await modeState(page);

  await page.click('#opt-tour');
  await expect(page.locator('body')).toHaveClass(/touring/);
  await expect(page.locator('#tour-dots .tour-dot')).toHaveCount(TITLES.length);

  for (let i = 0; i < TITLES.length; i++) {
    if (i > 0) await page.click('#tour-next');
    await expect(page.locator('#tour-title')).toHaveText(TITLES[i], { timeout: 15000 });
    await settleFrames(page, 4);

    if (i === 3) {
      // Halley 1986: time-travel landed, Flow overlay on
      const s = await page.evaluate(() => ({
        jd: window.ORRERY.TimeBar.jd,
        flow: window.ORRERY.OrbitFlow.enabled,
      }));
      expect(Math.abs(s.jd - 2446462.5)).toBeLessThan(2);
      expect(s.flow).toBe(true);
    }

    if (i === 4) {
      // Almanac stop: paused on a real upcoming event, caption names it
      const s = await modeState(page);
      expect(s.playing).toBe(false);
      const txt = await page.locator('#tour-text').textContent();
      expect(txt).toContain('sky tonight');
    }

    if (i === 5) {
      // Eclipse: clock landed just before greatest eclipse, sweeping slowly
      const s = await modeState(page);
      expect(Math.abs(s.jd - (ECLIPSE_JD - 0.06))).toBeLessThan(0.02);
      expect(s.rate).toBeCloseTo(0.008, 5);
      expect(s.playing).toBe(true);
      const shot = await screenshot(page, 'onboarding-eclipse-stop');
      assertSceneRendered(shot);
    }

    if (i === 6) {
      // What-if: the companion-star scenario really promoted the system
      const s = await page.evaluate(() => ({
        promoted: window.ORRERY.NBody.promoted,
        scenario: window.ORRERY.Sandbox._dev.scenario && window.ORRERY.Sandbox._dev.scenario.key,
      }));
      expect(s.promoted).toBe(true);
      expect(s.scenario).toBe('companion');
    }

    if (i === 7) {
      // Mars preview: rails restored, MMX arc shown WITHOUT the drawer
      const s = await page.evaluate(() => {
        const mp = window.ORRERY.MarsPlanner.getState();
        return { promoted: window.ORRERY.NBody.promoted, mp };
      });
      expect(s.promoted).toBe(false);
      expect(s.mp.selected).toBe('mmx');
      expect(s.mp.open).toBe(false);
      expect(s.mp.shownObjects).toBeGreaterThanOrEqual(2);
      expect(s.mp.ca.d).toBeLessThan(0.005); // the baked arc threads Mars
    }

    if (i === 8) {
      // Voyager: probe launched in 1977, previous stop's planner cleaned up
      const s = await page.evaluate(() => ({
        n: window.ORRERY.NBody.particles.filter((p) => p.alive).length,
        jd: window.ORRERY.TimeBar.jd,
        mpShown: window.ORRERY.MarsPlanner.getState().shownObjects,
      }));
      expect(s.n).toBe(1);
      expect(s.jd).toBeGreaterThan(2443361);
      expect(s.jd).toBeLessThan(2446500);
      expect(s.mpShown).toBe(0);
    }

    if (i === 9) {
      // Earth orbit: the guarded regime engaged via the hosting exemption,
      // ISS dossier + ground track up
      const s = await modeState(page);
      expect(s.eoActive).toBe(true);
      expect(s.hosting).toBe('earthorbit');
      expect(s.earthorbit).toBe(true);
      await expect(page.locator('#eo-card')).toHaveClass(/show/);
      await expect(page.locator('#eo-card .eo-card-name')).toContainText('Space Station');
      await settleFrames(page, 6);
      const shot = await screenshot(page, 'onboarding-earthorbit-stop');
      assertSceneRendered(shot);
    }

    if (i === 10) {
      // Cosmic zoom: previous stop exited cleanly, the ramp is climbing
      const s = await modeState(page);
      expect(s.eoActive).toBe(false);
      expect(s.earthorbit).toBe(false);
      expect(s.czActive).toBe(true);
      expect(s.hosting).toBe('cosmos');
      await page.waitForFunction(() => window.ORRERY.Cosmos.getL() > 9.5, null, {
        timeout: 20000,
      });
      await settleFrames(page, 6);
      const shot = await screenshot(page, 'onboarding-cosmos-stop');
      assertSceneRendered(shot);
    }

    if (i === 11) {
      // Finale: every mode unwound, visitor clock restored (then playing at 4 d/s)
      const s = await modeState(page);
      expect(s.czActive).toBe(false);
      expect(s.cosmos).toBe(false);
      expect(s.eoActive).toBe(false);
      expect(s.promoted).toBe(false);
      expect(s.hosting).toBe(null);
      expect(Math.abs(s.jd - pre.jd)).toBeLessThan(30); // restored + a few sim-days of playback
      expect(s.rate).toBe(4);
    }
  }

  // Step past the last stop = exit; the world is exactly a world again
  await page.click('#tour-next');
  const post = await modeState(page);
  expect(post.tourActive).toBe(false);
  expect(post.touring).toBe(false);
  expect(post.earthorbit).toBe(false);
  expect(post.cosmos).toBe(false);
  expect(post.promoted).toBe(false);
  expect(post.rate).toBe(pre.rate);
  expect(post.playing).toBe(pre.playing);
  expect(Math.abs(post.jd - pre.jd)).toBeLessThan(30);
});

test('Esc during the hosted Earth-orbit stop unwinds everything in one keypress', async ({ page }) => {
  await gotoOrrery(page);
  // Pause the visitor clock ATOMICALLY with the pre-capture: at the default
  // 4 d/s a playing clock drifts ~4 sim-days per wall-second across the CDP
  // roundtrips below, which made the old |post.jd − pre.jd| < 5 a wall-clock
  // race under parallel workers (measured 6.05 at w=4). Paused, the restore
  // is exact and the bound TIGHTENS to < 2; the playing-clock restore path
  // (rate 4, playing) is covered by the twelve-stop finale test above.
  const pre = await page.evaluate(() => {
    window.ORRERY.TimeBar.playing = false;
    return {
      jd: window.ORRERY.TimeBar.jd,
      rate: window.ORRERY.TimeBar.rate,
      playing: window.ORRERY.TimeBar.playing,
      minD: 0,
      ctl: [window.ORRERY.CameraPath ? 1 : 1],
    };
  });

  await page.click('#opt-tour');
  await expect(page.locator('body')).toHaveClass(/touring/);
  // Straight to the Earth-orbit stop via its dot
  await page.click('#tour-dots .tour-dot:nth-child(10)');
  await expect(page.locator('#tour-title')).toHaveText(TITLES[9]);
  await page.waitForFunction(() => window.ORRERY.EarthOrbit.active);
  await settleFrames(page, 4);

  await page.keyboard.press('Escape');
  await settleFrames(page, 6);

  const post = await page.evaluate(() => ({
    tourActive: window.ORRERY.Tour.active,
    hosting: window.ORRERY.Tour.hosting,
    eoActive: window.ORRERY.EarthOrbit.active,
    touring: document.body.classList.contains('touring'),
    earthorbit: document.body.classList.contains('earthorbit'),
    jd: window.ORRERY.TimeBar.jd,
    rate: window.ORRERY.TimeBar.rate,
    playing: window.ORRERY.TimeBar.playing,
    cam: window.ORRERY.CameraPath.pose().position,
  }));
  expect(post.tourActive).toBe(false);
  expect(post.hosting).toBe(null);
  expect(post.eoActive).toBe(false);
  expect(post.touring).toBe(false);
  expect(post.earthorbit).toBe(false);
  expect(post.rate).toBe(pre.rate);
  expect(post.playing).toBe(pre.playing);
  expect(Math.abs(post.jd - pre.jd)).toBeLessThan(2); // paused clock: exact restore
  // The v1 exit contract: the camera flies home (reduced motion = instant).
  // "Home" allows a small damped orbit-controls residual: stop 0's
  // autoRotate accumulates a spherical delta that freezes while the hosted
  // regime owns the camera and thaws after Esc, settling the pose a couple
  // of units off HOME (dt-dependent — measured 2.25 under parallel
  // contention). A FAILED restore parks hundreds of units away (or at
  // Earth-orbit scene coords), so a 6-unit bound (1.6% of |HOME|) keeps
  // the claim unambiguous; the condition-wait replaces a fixed-frame
  // sample of a still-decaying pose.
  await page.waitForFunction(() => {
    const p = window.ORRERY.CameraPath.pose().position;
    return Math.hypot(p[0] - 0, p[1] - 165, p[2] - 330) < 6;
  }, null, { timeout: 10000 });
});

test('Esc during the cosmic-zoom finale stop comes all the way home', async ({ page }) => {
  await gotoOrrery(page);
  // Same paused-clock capture as the Earth-orbit Esc test above (the old
  // playing-clock capture made the jd bound a wall-clock race at 4 d/s).
  const pre = await page.evaluate(() => {
    window.ORRERY.TimeBar.playing = false;
    return {
      jd: window.ORRERY.TimeBar.jd,
      rate: window.ORRERY.TimeBar.rate,
    };
  });

  await page.click('#opt-tour');
  await page.click('#tour-dots .tour-dot:nth-child(11)');
  await expect(page.locator('#tour-title')).toHaveText(TITLES[10]);
  await page.waitForFunction(() => window.ORRERY.Cosmos.active);
  await page.waitForFunction(() => window.ORRERY.Cosmos.getL() > 3, null, { timeout: 15000 });

  await page.keyboard.press('Escape');
  await settleFrames(page, 6);

  const post = await page.evaluate(() => ({
    tourActive: window.ORRERY.Tour.active,
    czActive: window.ORRERY.Cosmos.active,
    cosmos: document.body.classList.contains('cosmos'),
    touring: document.body.classList.contains('touring'),
    rate: window.ORRERY.TimeBar.rate,
    jd: window.ORRERY.TimeBar.jd,
    zoomOn: true,
  }));
  expect(post.tourActive).toBe(false);
  expect(post.czActive).toBe(false);
  expect(post.cosmos).toBe(false);
  expect(post.touring).toBe(false);
  expect(post.rate).toBe(pre.rate);
  expect(Math.abs(post.jd - pre.jd)).toBeLessThan(2); // paused clock: exact restore
  const shot = await screenshot(page, 'onboarding-post-esc-home');
  assertSceneRendered(shot);
});

test('first-visit offer shows once, sells the new tour, and stays dismissed', async ({ page }) => {
  await gotoOrrery(page);
  await expect(page.locator('#tour-offer')).toHaveClass(/show/);
  await expect(page.locator('#offer-start')).toContainText('grand tour');
  await page.click('#offer-skip');
  await expect(page.locator('#tour-offer')).not.toHaveClass(/show/);

  await page.reload();
  await page.waitForFunction(() => window.ORRERY && window.ORRERY.Tour);
  await settleFrames(page, 4);
  // maybeOffer runs synchronously during init (main.js calls it right after
  // Permalink.init) — there is no deferral window. The module wait + 4 real
  // frames above are already past the only point the offer could appear;
  // 300 ms is pure margin against a future micro-deferral, not a 1.2 s guess.
  await page.waitForTimeout(300);
  await expect(page.locator('#tour-offer')).not.toHaveClass(/show/);
});

test('guide.html is real, shipped by the deploy workflow, and its deep links resolve', async ({ page }) => {
  const guidePath = path.join(ROOT, 'site', 'guide.html');
  expect(fs.existsSync(guidePath)).toBe(true);
  const guide = fs.readFileSync(guidePath, 'utf8');

  // Shipped: deploy.yml copies it next to index.html; pr-preview stays index-only
  const deploy = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
  expect(deploy).toContain('cp site/guide.html');
  const preview = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pr-preview.yml'), 'utf8');
  expect(preview).not.toContain('guide.html');

  // Self-contained + theme-aware: no external fetches, both color schemes
  expect(guide).not.toMatch(/src=["']https?:|href=["']https?:\/\/(?!jakobbullinger)/);
  expect(guide).toContain('prefers-color-scheme');

  // Every relative deep link parses; spot-check the eclipse one end-to-end
  const links = [...guide.matchAll(/href="\.\/(\?[^"]+)"/g)].map((m) =>
    m[1].replace(/&amp;/g, '&')
  );
  expect(links.length).toBeGreaterThanOrEqual(4);
  const eclipseLink = links.find((l) => l.includes('rate=0.008'));
  expect(eclipseLink).toBeTruthy();

  await gotoOrrery(page, eclipseLink);
  const s = await page.evaluate(() => ({
    jd: window.ORRERY.TimeBar.jd,
    rate: window.ORRERY.TimeBar.rate,
    name: document.getElementById('p-name').textContent,
  }));
  expect(Math.abs(s.jd - (ECLIPSE_JD - 0.06))).toBeLessThan(0.02);
  expect(s.rate).toBeCloseTo(0.008, 5);
  expect(s.name).toBe('Earth');

  // The challenge link engages a real ghost replay under the banner
  const chLink = links.find((l) => l.startsWith('?ch='));
  expect(chLink).toBeTruthy();
  await gotoOrrery(page, chLink);
  await page.waitForFunction(() => window.ORRERY.Challenge.replaying, null, { timeout: 10000 });
  await expect(page.locator('.ch-banner')).toContainText('Beat this');

  // The app links back: the Explore menu carries the guide at the live URL
  await gotoOrrery(page);
  const href = await page.getAttribute('#hdr-guide', 'href');
  expect(href).toBe('https://jakobbullinger.github.io/solar-system/guide.html');
  await expect(page.locator('#hdr-guide')).toBeVisible();
});
