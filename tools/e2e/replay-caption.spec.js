/**
 * replay-caption.spec.js — the caption card must never sit in front of the
 * spectacle it narrates (user-reported: during both mission replays the
 * bottom-center card occluded the spacecraft/comet the chase-cam frames).
 *
 * Root cause: the ride chase rig frames its subject ~70% down the screen
 * (camera above, looking ahead) — exactly the card's home zone. Before the
 * fix, EVERY chapter of both replays put the craft inside the card at
 * 1280×720, and the flagship flybys (Pluto, Saturn SOI) grazed it at
 * 1600×1000. The fix is the subject-aware card dodge in tour.js
 * (trackSubject/dodgeTick): when the tracked subject projects into the
 * card's footprint, the card rides to the top of the screen.
 *
 * These tests pin the previously-occluding chapters and assert, from the
 * live per-frame probe (ORRERY.Tour._dev.probe — the exact projection the
 * dodge machinery computes), that the subject's screen position does not
 * intersect the card's CURRENT bounding box; an elementFromPoint check
 * adds hit-test truth on top of the geometry. A tour leg guards the other
 * direction: centered tour subjects must never trigger the dodge.
 */
'use strict';

const { test, expect, gotoOrrery, screenshot, assertSceneRendered } = require('./orrery');

// Chapter jumps re-fly the whole schedule synchronously (deterministic
// encounters) — late Cassini chapters re-integrate seven years of cruise.
test.setTimeout(180000);

/** Start a replay and let the chase camera settle on chapter 0. */
async function startReplay(page, key) {
  await page.evaluate((k) => window.ORRERY.Replays.start(k), key);
  await page.waitForTimeout(1500);
}

/** Jump straight to chapter i via its dot (one deterministic re-fly). */
async function jumpToChapter(page, i) {
  await page.evaluate((n) => {
    document.querySelectorAll('#tour-dots .tour-dot')[n].click();
  }, i);
  // Chase-cam lerp (~5/s) + the card's dodge engage/slide settle well
  // inside this window.
  await page.waitForTimeout(2600);
}

/**
 * Sample the dodge probe over several real frames and assert the subject
 * never intersects the card's live box (small pad for the glyph core),
 * and that hit-testing the subject's pixel does not land on the card.
 */
async function assertSubjectClear(page, label) {
  for (let s = 0; s < 5; s++) {
    const m = await page.evaluate(() => {
      const p = window.ORRERY.Tour._dev.probe;
      if (!p) return { probe: null };
      const r = document.querySelector('.tour-card').getBoundingClientRect();
      const PAD = 10;
      const inside = !p.behind &&
        p.x > r.left - PAD && p.x < r.right + PAD &&
        p.y > r.top - PAD && p.y < r.bottom + PAD;
      const el = document.elementFromPoint(
        Math.max(0, Math.min(window.innerWidth - 1, p.x)),
        Math.max(0, Math.min(window.innerHeight - 1, p.y)));
      const overCard = !!(el && el.closest && el.closest('.tour-card'));
      return {
        probe: { x: Math.round(p.x), y: Math.round(p.y) },
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom) },
        dodged: window.ORRERY.Tour._dev.dodged,
        inside,
        overCard,
      };
    });
    expect(m.probe, label + ': dodge probe must be live during a replay').not.toBeNull();
    expect(m.inside, label + ': subject ' + JSON.stringify(m.probe) +
      ' intersects the caption card ' + JSON.stringify(m.rect)).toBe(false);
    expect(m.overCard, label + ': elementFromPoint at the subject hits the card').toBe(false);
    await page.waitForTimeout(150);
  }
}

// Previously-occluding chapters, pinned. At 1280×720 every chapter of both
// replays occluded (craft y≈465–515 inside the card, top≈441–463); these
// are the launch, the flagship gravity assist, and the destination flyby.
const PINNED = {
  newhorizons: [0, 2, 5],   // launch, Jupiter assist, Pluto flyby
  cassini: [2, 8, 12],      // Venus 1, Earth flyby, Saturn orbit insertion
};

for (const [key, chapters] of Object.entries(PINNED)) {
  test(key + ' replay: caption card never occludes the craft at 1280×720', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoOrrery(page);
    await startReplay(page, key);
    for (const ch of chapters) {
      if (ch > 0) await jumpToChapter(page, ch);
      await assertSubjectClear(page, key + ' ch' + ch + ' @720p');
    }
    const shot = await screenshot(page, 'replay-caption-' + key + '-720');
    assertSceneRendered(shot);
    await page.evaluate(() => window.ORRERY.Replays.exit());
  });
}

test('flagship flybys stay clear at 1600×1000 (craft grazed the card pre-fix)', async ({ page }) => {
  await gotoOrrery(page);   // config default viewport: 1600×1000
  await startReplay(page, 'newhorizons');
  await jumpToChapter(page, 5);                    // Pluto, at last
  await assertSubjectClear(page, 'newhorizons ch5 @1600');
  const shot = await screenshot(page, 'replay-caption-pluto-1600');
  assertSceneRendered(shot);
  await page.evaluate(() => window.ORRERY.Replays.exit());
  await page.waitForTimeout(400);

  await startReplay(page, 'cassini');
  await jumpToChapter(page, 12);                   // Saturn orbit insertion
  await assertSubjectClear(page, 'cassini ch12 @1600');
  await page.evaluate(() => window.ORRERY.Replays.exit());
});

test('tour stops keep the card home — centered subjects never trigger the dodge', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await gotoOrrery(page);
  await page.evaluate(() => window.ORRERY.Tour.start());
  for (let stop = 1; stop <= 3; stop++) {          // Sun, Earth, Halley
    if (stop > 1) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(2000);
    const m = await page.evaluate(() => {
      const r = document.querySelector('.tour-card').getBoundingClientRect();
      return {
        dodged: window.ORRERY.Tour._dev.dodged,
        // home = bottom-anchored (26px gap at desktop width)
        homeGap: Math.round(window.innerHeight - r.bottom),
      };
    });
    expect(m.dodged, 'tour stop ' + stop + ' must not dodge').toBe(false);
    expect(m.homeGap, 'tour stop ' + stop + ' card must sit at its home bottom anchor').toBe(26);
  }
  await page.evaluate(() => window.ORRERY.Tour.exit());
});
