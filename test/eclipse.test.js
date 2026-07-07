/**
 * eclipse.test.js — Lunar theory + eclipse finder vs the published canon.
 *
 * Three layers:
 *   1. moon.js against the worked example in Meeus ch. 47 (1992 Apr 12.0 TD)
 *      — pins the 120-term series verbatim.
 *   2. The finder against the published eclipse canon 2025–2028 (NASA five
 *      millennium canon dates/types/instants): every eclipse found, typed
 *      correctly, greatest-eclipse instant within ±2 h, gamma within ±0.01,
 *      and NO events that aren't in the canon (completeness both ways).
 *   3. The showcase: 2026-08-12 total solar — instant, gamma, and a ground
 *      point in the Iceland sector; plus lunarShading() mid-totality
 *      2026-03-03 reporting a fully-immersed Moon for the copper tint.
 */
'use strict';

const { test, ok, close } = require('./lib/harness');
const { load } = require('./lib/orrery-loader');

const O = load(['data/bodies.js', 'physics/kepler.js', 'physics/moon.js', 'physics/eclipse.js']);
const K = O.Kepler;

function jdUTC(y, mo, d, h, mi) {
  return K.julianDate(Date.UTC(y, mo - 1, d, h || 0, mi || 0));
}

test('moon.js reproduces Meeus example 47.a (1992 Apr 12.0 TD)', function () {
  const p = O.Moon.position(2448724.5);
  close(p.lonDeg, 133.162655, 0.0005, 'geocentric longitude (deg, of date)');
  close(p.latDeg, -3.229126, 0.0005, 'geocentric latitude (deg)');
  close(p.distKm, 368409.7, 5, 'distance (km)');
});

test('geoJ2000 precession correction is applied and distance-preserving', function () {
  const jd = jdUTC(2026, 8, 12);
  const raw = O.Moon.position(jd);
  const g = O.Moon.geoJ2000(jd);
  const lon = Math.atan2(g.y, g.x) * 180 / Math.PI;
  // General precession 2000→2026 ≈ 26.6 y × 50.29"/y ≈ 0.372°
  const dLon = ((raw.lonDeg - lon) % 360 + 360) % 360;
  close(dLon, 0.372, 0.01, 'J2000 longitude lags date longitude by p_A');
  close(Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z), raw.distKm, 1, 'radius preserved');
});

test('syzygies are spaced by the synodic month', function () {
  const s = O.Eclipse.syzygies(jdUTC(2026, 1, 1), 90);
  ok(s.length >= 5, 'at least 5 syzygies in 90 days, got ' + s.length);
  for (let i = 2; i < s.length; i++) {
    if (s[i].full === s[i - 2].full) {
      close(s[i].jd - s[i - 2].jd, 29.53, 0.9, 'same-phase spacing ≈ synodic month');
    }
  }
});

// ---- The canon, 2025-01-01 → 2028-12-31 (NASA eclipse canon) ---------------
// [y, m, d, hUT, mUT of greatest eclipse, type, gamma (solar) | umbral mag (lunar)]
const SOLAR_CANON = [
  [2025, 3, 29, 10, 47, 'partial', 1.0405],
  [2025, 9, 21, 19, 42, 'partial', -1.0651],
  [2026, 2, 17, 12, 12, 'annular', -0.9743],
  [2026, 8, 12, 17, 46, 'total', 0.8977],
  [2027, 2, 6, 16, 0, 'annular', -0.2952],
  [2027, 8, 2, 10, 7, 'total', 0.1421],
  [2028, 1, 26, 15, 8, 'annular', 0.3901],
  [2028, 7, 22, 2, 56, 'total', -0.6056]
];
const LUNAR_CANON = [
  [2025, 3, 14, 6, 59, 'total', 1.18],
  [2025, 9, 7, 18, 12, 'total', 1.36],
  [2026, 3, 3, 11, 34, 'total', 1.15],
  [2026, 8, 28, 4, 13, 'partial', 0.93],
  [2027, 2, 20, 23, 13, 'penumbral', null],
  [2027, 7, 18, 16, 4, 'penumbral', null],
  [2027, 8, 17, 7, 14, 'penumbral', null],
  [2028, 1, 12, 4, 13, 'partial', 0.07],
  [2028, 7, 6, 18, 20, 'partial', 0.39],
  [2028, 12, 31, 16, 52, 'total', 1.25]
];

const events = O.Eclipse.findAll(jdUTC(2025, 1, 1), 4 * 365.25);
const solar = events.filter(function (e) { return e.ecl === 'solar'; });
const lunar = events.filter(function (e) { return e.ecl === 'lunar'; });

test('completeness: exactly the canon solar eclipses, no extras', function () {
  ok(solar.length === SOLAR_CANON.length,
    'expected ' + SOLAR_CANON.length + ' solar eclipses, found ' + solar.length);
});

test('completeness: exactly the canon lunar eclipses, no extras', function () {
  ok(lunar.length === LUNAR_CANON.length,
    'expected ' + LUNAR_CANON.length + ' lunar eclipses, found ' + lunar.length);
});

SOLAR_CANON.forEach(function (c, i) {
  test('solar ' + c[0] + '-' + c[1] + '-' + c[2] + ' ' + c[5] +
       ' (±2 h, gamma ±0.01)', function () {
    const e = solar[i];
    ok(e, 'event present at index ' + i);
    close(e.jd, jdUTC(c[0], c[1], c[2], c[3], c[4]), 2 / 24, 'greatest eclipse instant');
    ok(e.type === c[5], 'type ' + c[5] + ', got ' + e.type);
    close(e.gamma, c[6], 0.01, 'gamma');
  });
});

LUNAR_CANON.forEach(function (c, i) {
  test('lunar ' + c[0] + '-' + c[1] + '-' + c[2] + ' ' + c[5] + ' (±2 h)', function () {
    const e = lunar[i];
    ok(e, 'event present at index ' + i);
    close(e.jd, jdUTC(c[0], c[1], c[2], c[3], c[4]), 2 / 24, 'greatest eclipse instant');
    ok(e.type === c[5], 'type ' + c[5] + ', got ' + e.type);
    if (c[6] !== null) close(e.magU, c[6], 0.03, 'umbral magnitude');
  });
});

test('showcase: 2026-08-12 total solar tracks the Iceland sector', function () {
  const e = solar.filter(function (s) {
    return Math.abs(s.jd - jdUTC(2026, 8, 12, 17, 46)) < 0.5;
  })[0];
  ok(e && e.type === 'total', 'found as total');
  ok(e.ground, 'central eclipse carries a ground point');
  close(e.ground.lat, 65.2, 2.5, 'max-eclipse latitude (Iceland sector)');
  close(e.ground.lon, -25.5, 5, 'max-eclipse longitude (Denmark Strait)');
  ok(/total/i.test(e.title) && /solar/i.test(e.title), 'title says total solar');
});

test('lunarShading: fully copper at 2026-03-03 mid-totality, clean a day later', function () {
  const mid = O.Eclipse.lunarShading(jdUTC(2026, 3, 3, 11, 34));
  ok(mid.umbra === 1, 'umbra fraction saturates at totality, got ' + mid.umbra);
  const off = O.Eclipse.lunarShading(jdUTC(2026, 3, 4, 11, 34));
  ok(off.umbra === 0 && off.penumbra === 0, 'no shading one day after');
});

test('lunarShading: never fires at NEW moon (shadow axis is a ray, not a line)', function () {
  // Regression: at new moon the Moon sits near the Sun–Earth LINE but on the
  // sunward side; an unsigned axis distance falsely coppered it (caught by
  // the first e2e screenshot of the 2026-08-12 solar eclipse).
  const s = O.Eclipse.lunarShading(jdUTC(2026, 8, 12, 17, 46));
  ok(s.umbra === 0 && s.penumbra === 0,
    'no lunar shading at solar-eclipse maximum, got ' + JSON.stringify(s));
});

test('event rows carry the almanac-ui contract', function () {
  events.forEach(function (e) {
    ok(e.kind === 'eclipse', 'kind');
    ok(e.bodyKey === (e.ecl === 'solar' ? 'earth' : 'moon'), 'jump target body');
    ok(typeof e.title === 'string' && e.title.length > 0, 'title');
    ok(typeof e.sub === 'string' && e.sub.indexOf('UTC') !== -1, 'sub mentions the instant');
  });
});
