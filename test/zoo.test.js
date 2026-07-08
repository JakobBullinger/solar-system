/**
 * zoo.test.js — Level 29 (Orbital Zoo) physics vs handbook values.
 *
 * All reference numbers are external (Vallado / GPS ICD / common textbook
 * Molniya parameters), not re-derived from the code under test — same
 * discipline as earthorbit.test.js.
 */
'use strict';

const { test, ok, close } = require('./lib/harness');
const { load } = require('./lib/orrery-loader');

const O = load(['data/starlink.js', 'data/bodies.js', 'physics/kepler.js', 'data/zoo.js']);
const Z = O.ZOO;
const S = O.STARLINK;
const K = O.Kepler;

test('GPS: semi-synchronous period = 717.97 min at the real 55°/20,182 km shell', function () {
  close(S.periodMin(Z.GPS.altKm), 717.97, 0.05, 'GPS period');
  close(Z.GPS.incDeg, 55, 1e-9, 'GPS inclination');
  ok(Z.GPS.planes === 6 && Z.GPS.perPlane === 4, 'GPS Block-II baseline 6 planes × 4');
});

test('GPS: 2 orbits ≈ 1 sidereal day — the semi-synchronous ground-track-repeat choice', function () {
  // Not exact (real GPS needs periodic station-keeping too) — but close.
  const twoOrbitsMin = 2 * S.periodMin(Z.GPS.altKm);
  close(twoOrbitsMin, S.SIDEREAL_H * 60, 0.3, '2 GPS orbits ~ 1 sidereal day');
});

test('Molniya: perigee/apogee altitudes land at the classic 12h/e=0.74 values', function () {
  const a = Z.MOLNIYA.a, e = Z.MOLNIYA.e;
  close(a, 26610, 5, 'Molniya semi-major axis from period via Kepler III');
  const rp = a * (1 - e), ra = a * (1 + e);
  // Handbook Molniya: perigee ~400-600 km altitude, apogee ~39,700-40,000 km
  ok(rp - S.RE > 400 && rp - S.RE < 700, 'perigee altitude in the classic band, got ' + (rp - S.RE));
  ok(ra - S.RE > 39000 && ra - S.RE < 40500, 'apogee altitude in the classic band, got ' + (ra - S.RE));
  close((ra + rp) / 2, a, 1e-6, 'semi-major axis self-consistent with perigee/apogee');
});

test('Molniya: J2 apsidal drift is exactly zero at the critical inclination', function () {
  close(Z.CRIT_INC_DEG, 63.4349, 0.001, 'critical inclination = arccos(1/sqrt(5))');
  const a = Z.MOLNIYA.a, e = Z.MOLNIYA.e;
  close(Z.argPeriRateDegPerDay(a, e, Z.CRIT_INC_DEG), 0, 1e-6, 'zero apsidal drift at critical inclination');
  // Off the critical inclination the drift is clearly nonzero — the formula
  // is genuinely inclination-dependent, not a constant zero.
  ok(Math.abs(Z.argPeriRateDegPerDay(a, e, 45)) > 0.01, 'nonzero drift at 45°');
  ok(Math.abs(Z.argPeriRateDegPerDay(a, e, 90)) > 0.01, 'nonzero drift at 90°');
  // The NODE still precesses at the critical inclination — only omega is pinned.
  ok(Math.abs(Z.raanRateEccDegPerDay(a, e, Z.CRIT_INC_DEG)) > 0.05,
    'node keeps precessing at the critical inclination');
});

test('Molniya: apogee dwells near the design latitude (argument of latitude 90° at apogee)', function () {
  const el = Z.molniyaElements(0, 0);
  const jd0 = S.EPOCH;
  // Find the jd of apogee by sampling one period and picking max radius
  const P = Z.MOLNIYA.periodMin / 1440;
  let bestJd = jd0, bestR = 0;
  for (let i = 0; i < 400; i++) {
    const t = jd0 + (i / 400) * P;
    const h = K.heliocentric(el, t);
    if (h.r > bestR) { bestR = h.r; bestJd = t; }
  }
  const hApo = K.heliocentric(el, bestJd);
  const lat = Math.asin(Math.max(-1, Math.min(1, hApo.z / hApo.r))) * 180 / Math.PI;
  close(lat, Z.MOLNIYA.incDeg, 1.5, 'apogee latitude ~ inclination (northern dwell), got ' + lat);
});

test('Sun-synchronous: node rate at 700 km/98.19° matches 0.9856°/day (Earth around the Sun) to <1%', function () {
  const rate = S.raanRateDegPerDay(Z.SUNSYNC.altKm, Z.SUNSYNC.incDeg);
  close(rate, 0.9856, 0.01 * 0.9856, 'sun-sync node rate within 1% of 0.9856°/day, got ' + rate);
});

test('GEO named slots hold their filed longitude over 10 days of propagation', function () {
  const jd0 = S.EPOCH + 500;
  Z.GEO_SLOTS.forEach(function (slot) {
    const lon0 = S.fixedLongitudeDeg(Z.geoSlotPosKm(slot.lonDeg, jd0), jd0);
    const lon1 = S.fixedLongitudeDeg(Z.geoSlotPosKm(slot.lonDeg, jd0 + 10), jd0 + 10);
    close(lon0, slot.lonDeg, 1e-6, slot.name + ' matches its filed longitude exactly');
    close(lon1, slot.lonDeg, 1e-6, slot.name + ' still at its filed longitude 10 days later');
  });
});

test('Graveyard ring sits ~300 km above GEO (IADC disposal guideline)', function () {
  close(Z.GRAVEYARD.altKm - S.GEO.altKm, 300, 1, 'graveyard altitude margin');
});

test('Ground-track closure: a GPS satellite returns near its start after 2 orbits (1 sidereal day)', function () {
  const jd0 = S.EPOCH + 1000;
  const posFn = function (t) { return S.satPosKm(Z.GPS, 0, 0, t); };
  const track = Z.groundTrack(posFn, jd0, 2 * S.periodMin(Z.GPS.altKm) / 1440, 2);
  const start = track[0], end = track[track.length - 1];
  close(start.lat, end.lat, 0.05, 'GPS ground track closes in latitude');
  let dLon = Math.abs(start.lon - end.lon);
  if (dLon > 180) dLon = 360 - dLon;
  ok(dLon < 0.1, 'GPS ground track closes in longitude to < 0.1°, got ' + dLon);
});

test('Ground-track distinctiveness: ISS sweeps many degrees per orbit, Molniya self-crosses (figure-8)', function () {
  const jd0 = S.EPOCH + 200;
  const issShell = { altKm: S.ISS.altKm, incDeg: S.ISS.incDeg, planes: 1, perPlane: 1, f: 0 };
  const issTrack = Z.groundTrack(function (t) { return S.satPosKm(issShell, 0, 0, t); },
    jd0, S.periodMin(S.ISS.altKm) / 1440, 60);
  const lonSpan = Math.max.apply(null, issTrack.map(function (p) { return p.lon; })) -
    Math.min.apply(null, issTrack.map(function (p) { return p.lon; }));
  ok(lonSpan > 20, 'ISS ground track sweeps a wide longitude band per orbit, got ' + lonSpan);

  // Molniya: over one full period the ground track must revisit a latitude
  // band on both the outbound and inbound legs (the hook that reads as a
  // figure-8) — i.e. some latitude value is crossed at least twice.
  const molTrack = Z.groundTrack(function (t) { return Z.molniyaPosKm(0, 0, t); },
    jd0, Z.MOLNIYA.periodMin / 1440, 200);
  let crossings = 0;
  const targetLat = 30; // mid-latitude the ascending and descending legs both pass through
  for (let i = 1; i < molTrack.length; i++) {
    const a = molTrack[i - 1].lat - targetLat, b = molTrack[i].lat - targetLat;
    if (a === 0 || (a < 0) !== (b < 0)) crossings++;
  }
  ok(crossings >= 2, 'Molniya ground track crosses mid-latitude on both legs, got ' + crossings);
});

test('Earth shadow cylinder: a satellite on the sun side is never eclipsed', function () {
  const sun = { x: 1, y: 0, z: 0 };
  ok(!Z.inShadow({ x: 10000, y: 0, z: 0 }, sun), 'sun-side point is lit');
  ok(!Z.inShadow({ x: -10000, y: 8000, z: 0 }, sun), 'far off-axis point on the night side but outside the cylinder');
  ok(Z.inShadow({ x: -10000, y: 100, z: 0 }, sun), 'point on the night side, inside Re of the axis is eclipsed');
});

test('Earth shadow cylinder: a real GEO slot eclipses daily near the March 2026 equinox, not in June', function () {
  const earth = O.DATA.PLANETS.filter(function (p) { return p.key === 'earth'; })[0];
  function everEclipsedOnDay(jdDay, lonDeg) {
    for (let m = 0; m <= 1440; m += 5) {
      const t = jdDay + m / 1440;
      const sun = Z.sunDirEquatorial(earth.el, t);
      if (Z.inShadow(Z.geoSlotPosKm(lonDeg, t), sun)) return true;
    }
    return false;
  }
  const marchEquinoxJd = 2461120; // 2026-03-20ish (JD for UT midnight)
  const juneSolsticeJd = 2461212; // 2026-06-21ish
  ok(everEclipsedOnDay(marchEquinoxJd, -75.2), 'GEO slot eclipsed near the March 2026 equinox');
  ok(!everEclipsedOnDay(juneSolsticeJd, -75.2), 'same GEO slot NOT eclipsed near the June 2026 solstice');
});
