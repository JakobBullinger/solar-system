/**
 * cosmos.test.js — Powers of Ten data layer (stars.js) vs external references.
 *
 * The cosmic zoom hardcodes real astronomy; these tests pin it to catalog
 * values that are independent of the code: J2000 equatorial→ecliptic
 * conversion checked against the galactic frame's own geometry and Sirius'
 * published ecliptic coordinates, Voyager ranges against the NASA mission
 * status trend, and the Local Group against standard distances.
 */
'use strict';

const { test, ok, close, between } = require('./lib/harness');
const { load } = require('./lib/orrery-loader');

const O = load(['data/stars.js']);
const C = O.COSMOS;

function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function len(a) { return Math.sqrt(dot(a, a)); }

test('dirFromRaDec returns unit vectors', function () {
  close(len(C.dirFromRaDec(0, 0)), 1, 1e-12);
  close(len(C.dirFromRaDec(17.7611, -29.008)), 1, 1e-12);
  close(len(C.dirFromRaDec(12.8567, 89.9)), 1, 1e-12);
});

test('galactic centre direction ⊥ north galactic pole (real geometry)', function () {
  const gc = C.dirFromRaDec(C.GALACTIC.centerRa, C.GALACTIC.centerDec);
  const np = C.dirFromRaDec(C.GALACTIC.poleRa, C.GALACTIC.poleDec);
  ok(Math.abs(dot(gc, np)) < 0.005, 'Sgr A* must lie in the galactic plane');
});

test('north galactic pole lands at its published ecliptic position', function () {
  // NGP ecliptic: λ ≈ 180.0°, β ≈ +29.8° → scene (-0.868, +0.497, ~0)
  const np = C.dirFromRaDec(C.GALACTIC.poleRa, C.GALACTIC.poleDec);
  close(np.x, -0.868, 0.01);
  close(np.y, 0.497, 0.01);
  close(np.z, 0, 0.01);
});

test('Sirius converts to its published ecliptic coordinates', function () {
  // Sirius: ecliptic λ ≈ 104.1°, β ≈ −39.6°
  const d = C.dirFromRaDec(6.752, -16.72);
  const beta = Math.asin(d.y) * 180 / Math.PI;
  const lambda = Math.atan2(-d.z, d.x) * 180 / Math.PI;
  close(beta, -39.6, 0.5, 'ecliptic latitude');
  close((lambda + 360) % 360, 104.1, 0.7, 'ecliptic longitude');
});

test('Voyager 1: range matches the mission-status trend', function () {
  // 2026-01-01 anchor 169 AU; ~166 AU mid-2025, +3.58 AU/yr
  const jd20260101 = 2461041.5;
  close(C.voyagerPos(C.VOYAGERS[0], jd20260101).r, 169.0, 0.01);
  close(C.voyagerPos(C.VOYAGERS[0], jd20260101 + 365.25).r, 172.58, 0.01);
  // heliopause crossing (Aug 2012) back-extrapolates to ~121.6 AU
  const jd2012 = 2456164.5;
  close(C.voyagerPos(C.VOYAGERS[0], jd2012).r, 121.6, 1.5);
});

test('Voyager 2: slower, closer, south of the ecliptic; V1 north', function () {
  const jd = 2461223;                       // mid-2026
  const v1 = C.voyagerPos(C.VOYAGERS[0], jd);
  const v2 = C.voyagerPos(C.VOYAGERS[1], jd);
  ok(v1.r > v2.r, 'V1 is farther than V2');
  between(v2.r, 142, 146, 'V2 mid-2026 range');
  ok(v1.y > 0, 'V1 escapes north of the ecliptic');
  ok(v2.y < 0, 'V2 escapes south of the ecliptic');
});

test('star catalog: 20 systems, all within a dozen light-years, sane fields', function () {
  ok(C.STARS.length === 20, 'exactly 20 systems, got ' + C.STARS.length);
  C.STARS.forEach(function (s) {
    between(s.ly, 4.2, 12.0, s.key + ' distance');
    between(s.ra, 0, 24, s.key + ' RA');
    between(s.dec, -90, 90, s.key + ' Dec');
    ok(/^#[0-9A-Fa-f]{6}$/.test(s.color), s.key + ' color');
    ok(s.fact && s.stats && s.stats.length >= 1, s.key + ' dossier');
  });
  ok(C.STARS[0].key === 'alphacen' && C.STARS[0].ly === 4.37,
    'Alpha Centauri leads the list at 4.37 ly');
});

test('Local Group: standard distances (LMC, Andromeda, Triangulum)', function () {
  function g(key) {
    return C.GALAXIES.filter(function (x) { return x.key === key; })[0];
  }
  ok(C.GALAXIES.length >= 10, 'at least 10 members');
  close(g('lmc').mly, 0.163, 0.01);
  close(g('m31').mly, 2.54, 0.03);
  close(g('m33').mly, 2.73, 0.03);
  ok(g('m31').kind === 'disc' && g('m33').kind === 'disc', 'the two spirals get discs');
  C.GALAXIES.forEach(function (x) {
    between(x.mly, 0.1, 3.2, x.key + ' distance');
    ok(x.fact && x.stats, x.key + ' dossier');
  });
});

test('constants: light-year and galactic radius', function () {
  close(C.LY_AU, 63241.077, 0.01);
  close(C.GALACTIC.sunToCenterLy, 26660, 1);
  ok(C.GALACTIC.discRadiusLy > 50000 && C.GALACTIC.discRadiusLy < 55000);
});
