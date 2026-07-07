/**
 * earthorbit.test.js — the Earth-orbit regime's math vs handbook values.
 *
 * Guards the km/minutes scale regime (level 24) forever: circular speeds
 * and periods at the ISS/Starlink altitudes, GEO's defining property
 * (period = one sidereal day = the orrery's own Earth spin), first-order
 * J2 nodal precession, and the structural honesty of the synthetic Walker
 * catalog (counts, radii, inclinations, phasing coverage). All reference
 * numbers are external — Vallado / NASA fact sheets — not re-derived from
 * the code under test.
 */
'use strict';

const { test, ok, close } = require('./lib/harness');
const { load } = require('./lib/orrery-loader');

const O = load(['data/starlink.js', 'data/bodies.js']);
const S = O.STARLINK;

test('circular speed at ISS / Starlink / GEO altitudes (handbook)', function () {
  close(S.vCirc(420), 7.66, 0.01, 'ISS ~7.66 km/s');
  close(S.vCirc(540), 7.59, 0.01, 'Starlink shell 2 ~7.59 km/s');
  close(S.vCirc(550), 7.585, 0.01, 'Starlink shell 1');
  close(S.vCirc(35786), 3.075, 0.005, 'GEO ~3.07 km/s');
});

test('periods: ISS ~92.9 min, Starlink ~95.6 min, GEO = 1436.07 min', function () {
  close(S.periodMin(420), 92.97, 0.15, 'ISS period');
  close(S.periodMin(550), 95.65, 0.15, 'Starlink shell 1 period');
  close(S.periodMin(35786), 1436.07, 0.05, 'GEO = 23h 56m 04s');
});

test('GEO hangs still: its mean motion equals the orrery Earth spin rate', function () {
  // The scene spins Earth with rotationHours = 23.9345 (bodies.js); a GEO
  // satellite must match that rate or it would visibly creep along the surface.
  const earth = O.DATA.PLANETS.filter(function (p) { return p.key === 'earth'; })[0];
  close(S.SIDEREAL_H, earth.rotationHours, 1e-9, 'spin constants agree');
  const spinRadPerDay = 24 / earth.rotationHours * 2 * Math.PI;
  close(S.meanMotion(S.GEO.altKm), spinRadPerDay, 0.0002 * spinRadPerDay, 'GEO n = spin');
  // and over a simulated day the earth-fixed longitude barely moves
  const jd = S.EPOCH + 3210.25;
  const lon0 = S.fixedLongitudeDeg(S.satPosKm({ altKm: 35786, incDeg: 0, planes: 1, perPlane: 1, f: 0 }, 0, 0, jd), jd);
  const lon1 = S.fixedLongitudeDeg(S.satPosKm({ altKm: 35786, incDeg: 0, planes: 1, perPlane: 1, f: 0 }, 0, 0, jd + 1), jd + 1);
  ok(Math.abs(lon1 - lon0) < 0.05, 'GEO fixed longitude drift < 0.05°/day, got ' + (lon1 - lon0));
});

test('LEO moves: a shell-1 satellite sweeps ~degrees of fixed longitude per minute', function () {
  const jd = S.EPOCH + 1234.5;
  const sh = S.SHELLS[0];
  const dLon = Math.abs(
    S.fixedLongitudeDeg(S.satPosKm(sh, 0, 0, jd + 1 / 1440), jd + 1 / 1440) -
    S.fixedLongitudeDeg(S.satPosKm(sh, 0, 0, jd), jd));
  ok(dLon > 1, 'LEO ground track moves > 1°/min, got ' + dLon);
});

test('J2 nodal precession matches the textbook first-order rate', function () {
  // ISS: ~ -5.0 °/day (Vallado ex. 9-1 ballpark); polar shells barely precess
  close(S.raanRateDegPerDay(420, 51.6), -4.95, 0.1, 'ISS RAAN drift');
  ok(Math.abs(S.raanRateDegPerDay(560, 97.6)) < 1.0, 'near-sun-synchronous shell ~small positive');
  ok(S.raanRateDegPerDay(560, 97.6) > 0, 'retrograde orbit precesses eastward');
});

test('Gen1 structure: 4,408 satellites in the licensed five shells', function () {
  const total = S.SHELLS.reduce(function (n, sh) { return n + S.shellCount(sh); }, 0);
  ok(total === 4408, 'FCC Gen1 total, got ' + total);
  ok(S.SHELLS[0].planes === 72 && S.SHELLS[0].perPlane === 22, 'shell 1 = 72×22');
  close(S.SHELLS[1].incDeg, 53.2, 1e-9, 'shell 2 at 53.2°');
  close(S.SHELLS[1].altKm, 540, 1e-9, 'shell 2 at 540 km');
});

test('synthetic catalog is geometrically honest', function () {
  const jd = S.EPOCH + 777.7;
  S.SHELLS.forEach(function (sh) {
    // every sat sits exactly on the shell radius
    for (let k = 0; k < 5; k++) {
      const p = (k * 13) % sh.planes, s = (k * 7) % sh.perPlane;
      const pos = S.satPosKm(sh, p, s, jd);
      close(Math.hypot(pos.x, pos.y, pos.z), S.radiusKm(sh.altKm), 1e-6, sh.key + ' radius');
    }
    // max |z| over a period reaches r·sin(i) — the inclination is real
    const r = S.radiusKm(sh.altKm);
    let zMax = 0;
    const P = S.periodMin(sh.altKm) / 1440;
    for (let i = 0; i < 200; i++) {
      const pos = S.satPosKm(sh, 3 % sh.planes, 0, jd + (i / 200) * P);
      zMax = Math.max(zMax, Math.abs(pos.z));
    }
    const si = Math.sin(sh.incDeg * Math.PI / 180);
    close(zMax / r, si > 1 ? 1 : Math.abs(si), 0.01, sh.key + ' inclination via z-extent');
  });
});

test('planes are spread over the full RAAN circle (no clumped synthetic phases)', function () {
  const jd = S.EPOCH;
  const sh = S.SHELLS[0];
  // sample sat 0 of each plane; their longitudes of ascending node cover 360°
  const lons = [];
  for (let p = 0; p < sh.planes; p++) {
    const pos = S.satPosKm(sh, p, 0, jd);
    lons.push(Math.atan2(pos.y, pos.x));
  }
  // nearest-neighbour gap must never exceed a few plane spacings
  lons.sort(function (a, b) { return a - b; });
  let maxGap = 2 * Math.PI + lons[0] - lons[lons.length - 1];
  for (let i = 1; i < lons.length; i++) maxGap = Math.max(maxGap, lons[i] - lons[i - 1]);
  ok(maxGap < (2 * Math.PI / sh.planes) * 4, 'RAAN coverage is even, max gap ' + maxGap);
});
