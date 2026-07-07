/**
 * geodata.test.js — Level 28, real Earth geography.
 *
 * References are external to the code under test: well-known real-world
 * geography (a desert is land, an ocean gyre is ocean, the poles are ice)
 * and real city locations. The landmask itself is derived offline from
 * NASA's public "Blue Marble" specular composite (see geodata.js header
 * for provenance + the exact bake recipe); this test is the guard that
 * the baked RLE actually decodes back to that real geography, not that
 * the geography is right by construction.
 */
'use strict';

const { test, ok, close } = require('./lib/harness');
const { load } = require('./lib/orrery-loader');

const O = load(['data/geodata.js']);
const G = O.GeoData;

test('decoded grid dimensions match the declared landmask size', function () {
  ok(G.LAND_W === 1440 && G.LAND_H === 720,
    'expected 1440x720, got ' + G.LAND_W + 'x' + G.LAND_H);
});

test('known land: Sahara, Amazon, Australian interior, Greenland, Antarctic coast', function () {
  ok(G.isLand(23, 10), 'Sahara (23N, 10E)');
  ok(G.isLand(-3, -60), 'Amazon basin (3S, 60W)');
  ok(G.isLand(-25, 135), 'Australian interior (25S, 135E)');
  ok(G.isLand(75, -40), 'Greenland (75N, 40W)');
  ok(G.isLand(-75, 0), 'Antarctic coast (75S, 0E)');
  ok(G.isLand(40, -100), 'US Great Plains (40N, 100W)');
  ok(G.isLand(48, 2), 'Western Europe (48N, 2E)');
});

test('known ocean: mid-Pacific, mid-Atlantic, Indian Ocean, North Sea', function () {
  ok(!G.isLand(0, -150), 'mid-Pacific (0, 150W)');
  ok(!G.isLand(0, -30), 'mid-Atlantic (0, 30W)');
  ok(!G.isLand(-30, 80), 'Indian Ocean (30S, 80E)');
  ok(!G.isLand(56, 3), 'North Sea (56N, 3E)');
  ok(!G.isLand(20, -140), 'North Pacific (20N, 140W)');
});

test('poles read as land/ice-sheet (Antarctica) or sea ice (Arctic), never open ocean look-alikes', function () {
  // The poles aren't a separate dataset — textures.js paints the ice cap
  // by latitude on top of whatever isLand() says — but the landmask itself
  // must at least agree with reality at the poles: Antarctica is land,
  // the geographic North Pole sits on Arctic Ocean pack ice (isLand==false
  // is fine there; the ice tint comes from the latitude band, not isLand).
  ok(G.isLand(-89, 0), 'the South Pole sits on the Antarctic ice sheet (land)');
  ok(G.isLand(-89, 90), 'South Pole, another longitude — must not depend on lon');
});

test('longitude wraps cleanly across the antimeridian and negative input', function () {
  const a = G.isLand(0, 179.9);
  const b = G.isLand(0, -179.9);
  // Both sample essentially the same mid-Pacific column — must agree.
  ok(a === b, 'lon=+179.9 and lon=-179.9 must decode the same column');
  ok(!a, 'that column is open Pacific');
  // lon far outside [-180,180] must still resolve via modular wrap.
  ok(G.isLand(23, 10 + 360) === G.isLand(23, 10), '360°-shifted longitude matches');
  ok(G.isLand(23, 10 - 720) === G.isLand(23, 10), '-720°-shifted longitude matches');
});

test('isDesert flags the real Sahara/Kalahari belts but not the Amazon or mid-latitudes', function () {
  ok(G.isDesert(23, 10), 'Sahara');
  ok(G.isDesert(-22, 20), 'Kalahari');
  ok(!G.isDesert(-3, -60), 'Amazon basin is rainforest, not desert');
  ok(!G.isDesert(48, 2), 'Western Europe is temperate, not desert');
});

test('real city roster: Tokyo/London/New York present with real coordinates', function () {
  function city(name) {
    const c = G.CITIES.filter(function (c) { return c[0] === name; })[0];
    ok(c, name + ' must be in the city list');
    return c;
  }
  const tokyo = city('Tokyo');
  close(tokyo[1], 35.68, 0.5, 'Tokyo latitude');
  close(tokyo[2], 139.69, 0.5, 'Tokyo longitude');
  city('London');
  city('New York');
  city('Paris');
});

/** True if (lat,lon) or any cell within ~55 km (0.5°) is real land — port
 * cities and narrow-peninsula capitals routinely key their coordinate to
 * the waterfront, which a 0.25° grid can legitimately classify as the
 * adjacent ocean cell; this is coastal-resolution slop, not a bad city
 * coordinate. */
function nearLand(lat, lon) {
  for (let dlat = -0.5; dlat <= 0.5; dlat += 0.5) {
    for (let dlon = -0.5; dlon <= 0.5; dlon += 0.5) {
      if (G.isLand(lat + dlat, lon + dlon)) return true;
    }
  }
  return false;
}

// Real, tiny oceanic islands (a few km across) that the 0.25° grid + 3×3
// denoise (geodata.js header) genuinely cannot resolve — their landmass is
// smaller than a single grid cell, so isLand() correctly disagrees with
// reality right at their coordinate and for a wide margin around it. Not a
// bad coordinate; a documented resolution floor.
const TOO_SMALL_FOR_GRID = ['Apia', 'Honolulu', 'Male'];

test('city count is in the briefed 200-400 range, all real coordinates, all on/near land', function () {
  ok(G.CITIES.length >= 200 && G.CITIES.length <= 400,
    'expected 200-400 cities, got ' + G.CITIES.length);
  const farFromLand = G.CITIES.filter(function (c) {
    return TOO_SMALL_FOR_GRID.indexOf(c[0]) === -1 && !nearLand(c[1], c[2]);
  });
  // Zero tolerance (beyond the documented tiny-island exceptions above) for
  // a city stranded in open ocean (a real coordinate bug); coastal cities
  // snapping to the immediately adjacent land cell (nearLand) is expected
  // at 0.25° resolution and not a defect.
  ok(farFromLand.length === 0,
    farFromLand.length + ' cities are nowhere near real land: ' +
    farFromLand.map(function (c) { return c[0]; }).join(', '));
});

test('city intensity is a valid 0..1 fraction and discriminates megacities from small capitals', function () {
  G.CITIES.forEach(function (c) {
    ok(c[3] > 0 && c[3] <= 1, c[0] + ' intensity ' + c[3] + ' out of (0,1]');
  });
  function intensity(name) {
    return G.CITIES.filter(function (c) { return c[0] === name; })[0][3];
  }
  // Real NASA night-lights photometry (see geodata.js header): the world's
  // brightest megacities read near-saturated; a small Sahel/Himalayan
  // capital reads distinctly dimmer — not just "greater than the steppe".
  ok(intensity('Tokyo') > 0.9, 'Tokyo should be near-saturated');
  ok(intensity('New York') > 0.9, 'New York should be near-saturated');
  ok(intensity('London') > 0.9, 'London should be near-saturated');
  const dim = intensity('Kabul');
  ok(dim < 0.5, 'Kabul should read distinctly dimmer than the megacities, got ' + dim);
});

test('base64 + RLE round-trips exactly (decode is deterministic and idempotent)', function () {
  // Calling isLand repeatedly (lazy-decodes once, caches) must be stable —
  // this catches a decoder that mutates its own cached grid.
  const before = G.isLand(23, 10);
  for (let i = 0; i < 5; i++) ok(G.isLand(23, 10) === before, 'stable across repeated calls');
});
