/**
 * marsplanner.spec.js — the Mars drawer's real manifest, end-to-end.
 *
 * Born from a regression: a hand-resolved CSS merge spliced the cosmic-zoom
 * block into the middle of the `#mp-close` rule, so every `.mp-*` (and
 * `.cz-*`) rule after it parsed as CSS-nested under `#mp-close` and stopped
 * matching — five unstyled rows, no timeline geometry, broken dossier. The
 * stylesheet was still "valid" and every JS test stayed green, so only
 * computed-style assertions catch this class of bug. That's what this spec
 * pins: the drawer opens, five rows render WITH their layout actually
 * applied, each mission selects, draws its arc in-scene, and opens a dossier.
 */
'use strict';

const {
  test,
  expect,
  gotoOrrery,
  screenshot,
  assertSceneRendered,
} = require('./orrery');

const MISSIONS = [
  { key: 'escapade', name: 'ESCAPADE' },
  { key: 'mmx', name: 'MMX' },
  { key: 'rosalind', name: 'Rosalind Franklin' },
  { key: 'tianwen3', name: 'Tianwen-3' },
  { key: 'sr1', name: 'SR-1 Freedom' },
];

test('Mars drawer renders the five-mission manifest with its styles applied', async ({ page }) => {
  await gotoOrrery(page);
  await page.click('#opt-mars');
  await expect(page.locator('#marsplan')).toHaveClass(/open/);

  // Five rows, all visible.
  await expect(page.locator('#mp-timeline .mp-row')).toHaveCount(5);
  for (const m of MISSIONS) {
    await expect(page.locator(`.mp-row[data-key="${m.key}"]`)).toBeVisible();
  }

  // The regression tell: rules swallowed into an unclosed block stop
  // matching, so assert COMPUTED style, not just presence in the sheet.
  const css = await page.evaluate(() => {
    const track = getComputedStyle(document.querySelector('.mp-track'));
    const row = getComputedStyle(document.querySelector('.mp-row'));
    const seg = getComputedStyle(document.querySelector('.mp-seg'));
    const years = getComputedStyle(document.querySelector('.mp-years'));
    return {
      trackPosition: track.position,   // 'relative' when .mp-track applies
      trackHeight: track.height,       // '7px'
      rowDisplay: row.display,         // 'block'
      segPosition: seg.position,       // 'absolute'
      yearsPosition: years.position,   // 'absolute'
    };
  });
  expect(css.trackPosition).toBe('relative');
  expect(css.trackHeight).toBe('7px');
  expect(css.rowDisplay).toBe('block');
  expect(css.segPosition).toBe('absolute');
  expect(css.yearsPosition).toBe('absolute');

  // Timeline segments carry real geometry (left/width computed from JDs).
  const segCount = await page.locator('.mp-seg').count();
  expect(segCount).toBeGreaterThanOrEqual(6); // 5 transfers + ESCAPADE loiter (+ returns)

  // ESCAPADE is the default selection: dossier open, transfer + marker +
  // faint L2-loiter arc in the scene (shownObjects === 3).
  await expect(page.locator('.mp-row[data-key="escapade"]')).toHaveClass(/active/);
  const st = await page.evaluate(() => window.ORRERY.MarsPlanner.getState());
  expect(st.open).toBe(true);
  expect(st.selected).toBe('escapade');
  expect(st.shownObjects).toBe(3);
  expect(st.points).toBeGreaterThan(100);

  const shot = await screenshot(page, 'marsplanner-manifest');
  assertSceneRendered(shot);
});

test('every mission selects: dossier opens and its trajectory draws in-scene', async ({ page }) => {
  await gotoOrrery(page);
  await page.click('#opt-mars');

  for (const m of MISSIONS) {
    await page.click(`.mp-row[data-key="${m.key}"]`);
    await expect(page.locator('#mp-dossier h4')).toHaveText(m.name);
    await expect(page.locator('#mp-fly')).toBeVisible();

    const st = await page.evaluate(() => window.ORRERY.MarsPlanner.getState());
    expect(st.selected).toBe(m.key);
    // Transfer line + arrival marker (+ loiter arc for ESCAPADE only).
    expect(st.shownObjects).toBe(m.key === 'escapade' ? 3 : 2);
    expect(st.points).toBeGreaterThan(100);
    // The re-integrated reference arc actually threads Mars.
    expect(st.ca.d).toBeLessThan(0.005); // < ~750,000 km closest approach
  }
});
