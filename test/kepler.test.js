/**
 * kepler.test.js — Heliocentric positions vs independent references, plus
 * Kepler-solver convergence at comet eccentricity.
 *
 * References are external to the code under test: JPL Horizons / published
 * ephemeris facts (Earth at J2000, the record 2003 Mars close approach,
 * Halley's Feb 1986 perihelion).
 */
'use strict';

const { test, ok, close, between } = require('./lib/harness');
const { load } = require('./lib/orrery-loader');

const O = load(['data/bodies.js', 'physics/kepler.js']);
const K = O.Kepler;

function planet(key) {
  return O.DATA.PLANETS.filter(function (p) { return p.key === key; })[0];
}
function jdUTC(y, mo, d, h) {
  return K.julianDate(Date.UTC(y, mo - 1, d, h || 0));
}
function wrapPi(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

test('julianDate: 2000-01-01 12:00 UTC is JD 2451545.0', function () {
  close(K.julianDate(Date.UTC(2000, 0, 1, 12)), 2451545.0, 1e-9);
});

test('Earth at J2000: ~1 AU near perihelion, heliocentric longitude ~100°', function () {
  const h = K.heliocentric(planet('earth').el, K.J2000);
  // Early January = near perihelion: r ≈ 0.9833 AU (Horizons: 0.98329)
  close(h.r, 0.9833, 0.002, 'Earth-Sun distance');
  let lon = Math.atan2(h.y, h.x) * 180 / Math.PI;
  if (lon < 0) lon += 360;
  close(lon, 100.4, 0.5, 'heliocentric ecliptic longitude');   // Horizons: ~100.38°
  ok(Math.abs(h.z) < 1e-3, 'Earth stays in the ecliptic plane');
});

test('Mars 2003-08-27: record close approach, Earth-Mars ≈ 0.3727 AU', function () {
  // Closest Mars approach in ~60,000 years — published minimum 0.37272 AU
  const jd = jdUTC(2003, 8, 27, 10);
  const e = K.heliocentric(planet('earth').el, jd);
  const m = K.heliocentric(planet('mars').el, jd);
  const d = Math.sqrt(
    (m.x - e.x) * (m.x - e.x) + (m.y - e.y) * (m.y - e.y) + (m.z - e.z) * (m.z - e.z));
  close(d, 0.3727, 0.003, 'geocentric Mars distance');
});

test('Halley: Feb 1986 perihelion at ~0.59 AU', function () {
  const halley = O.DATA.COMETS.filter(function (c) { return c.key === 'halley'; })[0];
  // Real perihelion passage: 1986-02-09 (JD 2446470.9)
  const jdP = K.nextPerihelion(halley.el, jdUTC(1985, 1, 1));
  close(jdP, jdUTC(1986, 2, 9), 3, 'perihelion epoch');
  close(K.heliocentric(halley.el, jdP).r, 0.5871, 0.01, 'perihelion distance');   // published q
  // And it really is a minimum, not a plateau
  ok(K.heliocentric(halley.el, jdP - 40).r > 0.75, 'r rises before perihelion');
  ok(K.heliocentric(halley.el, jdP + 40).r > 0.75, 'r rises after perihelion');
});

test('Kepler solver converges for e = 0.967 across all mean anomalies', function () {
  // The solver is private; verify it through heliocentric(): rotate the
  // output back into the orbital plane, recover E, and check the residual
  // of Kepler's equation E - e·sinE = M for M swept over the full circle.
  const a = 17.857, e = 0.967;
  const DEG = Math.PI / 180;
  const I = 30 * DEG, node = 40 * DEG, periLon = 100 * DEG;
  const cw = Math.cos(periLon - node), sw = Math.sin(periLon - node);
  const cn = Math.cos(node), sn = Math.sin(node);
  const ci = Math.cos(I), si = Math.sin(I);

  for (let k = -18; k <= 18; k++) {
    const Mdeg = k * 10 + 0.5;                 // dodge the ±180° wrap seam
    const el = [a, 0, e, 0, 30, 0, 100 + Mdeg, 0, 100, 0, 40, 0];
    const h = K.heliocentric(el, K.J2000);
    ok(isFinite(h.x) && isFinite(h.y) && isFinite(h.z), 'finite position at M=' + Mdeg);
    between(h.r, a * (1 - e) - 1e-6, a * (1 + e) + 1e-6, 'r inside ellipse bounds at M=' + Mdeg);

    // Orthonormal rotation: orbital-plane coords are the column dot products
    const xp = (cw * cn - sw * sn * ci) * h.x + (cw * sn + sw * cn * ci) * h.y + (sw * si) * h.z;
    const yp = (-sw * cn - cw * sn * ci) * h.x + (-sw * sn + cw * cn * ci) * h.y + (cw * si) * h.z;
    const E = Math.atan2(yp / (a * Math.sqrt(1 - e * e)), xp / a + e);
    const resid = wrapPi(E - e * Math.sin(E) - Mdeg * DEG);
    ok(Math.abs(resid) < 1e-7,
      'Kepler equation residual ' + resid + ' at M=' + Mdeg + '°');
  }
});

test('periodDays: Kepler\'s third law, periodDays(1) = 365.25', function () {
  close(K.periodDays(1), 365.25, 1e-9);
  close(K.periodDays(5.2028870), 4332, 15, 'Jupiter ~11.86 yr');
});
