/**
 * eclipse.js — Syzygy-based solar & lunar eclipse finder.
 *
 * Strategy (no Besselian elements — direct 3D geometry from the same
 * positions the scene uses):
 *
 *   1. Scan for syzygies: the geocentric ecliptic longitude of the Moon
 *      (moon.js, real series) minus that of the Sun crosses 0 (new moon)
 *      or 180° (full moon). Daily grid + bisection, like almanac.js.
 *   2. At each syzygy, run the actual shadow-cone geometry in km:
 *        solar — distance of the Moon's shadow axis (Sun→Moon line) from
 *                Earth's centre, minimized over ±0.07 d around new moon;
 *                compare against Earth radius + penumbral/umbral cone radii.
 *        lunar — distance of the Moon from the anti-solar axis vs Earth's
 *                umbral/penumbral cone radii at the Moon (Danjon-style 2%
 *                shadow enlargement), minimized around full moon.
 *
 * One subtlety that actually matters: the "earth" Kepler elements in
 * bodies.js are (per JPL's approximate-elements table) the Earth–Moon
 * BARYCENTER. The EMB sits up to ~4700 km from Earth's centre — 0.7 Earth
 * radii of pure error in eclipse geometry — so Earth's true position is
 * recovered as  EMB − r_moon/(1 + M_earth/M_moon)  before anything else.
 *
 * Honesty about classification: positions are good to ~10 arcsec, so type
 * (total/annular/partial) is reliable except within ~0.01 of a geometric
 * boundary; borderline central eclipses are labelled "hybrid" and the test
 * suite pins only what the model gets robustly right (verified against the
 * published canon: 2025–2028 eclipse dates, types and instants).
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Eclipse = (function () {
  'use strict';

  var AU_KM = 149597870.7;
  var R_SUN = 696000;         // km
  var R_EARTH = 6378.137;     // km (equatorial — the convention gamma uses)
  var R_MOON = 1737.4;        // km
  var EMB_F = 1 / 82.300679;  // Moon mass / (Earth+Moon mass)
  var SHADOW_ENLARGE = 1.02;  // Danjon: Earth's atmosphere fattens its shadow
  var DEG = Math.PI / 180;
  var SYNODIC = 29.530589;    // days

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function earthEl() {
    var PLANETS = ORRERY.DATA.PLANETS;
    for (var i = 0; i < PLANETS.length; i++) {
      if (PLANETS[i].key === 'earth') return PLANETS[i].el;
    }
    return null;
  }

  /**
   * Geocentric Sun position in km (J2000 ecliptic), EMB-corrected:
   * Earth = EMB − moonGeo·(m_moon/m_total); Sun_geo = −Earth_helio.
   */
  function sunGeoKm(jd, moonGeo) {
    var emb = ORRERY.Kepler.heliocentric(earthEl(), jd);
    var m = moonGeo || ORRERY.Moon.geoJ2000(jd);
    return {
      x: -(emb.x * AU_KM - m.x * EMB_F),
      y: -(emb.y * AU_KM - m.y * EMB_F),
      z: -(emb.z * AU_KM - m.z * EMB_F)
    };
  }

  function wrapPi(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  /** Moon−Sun geocentric elongation in ecliptic longitude (radians). */
  function phase(jd) {
    var m = ORRERY.Moon.geoJ2000(jd);
    var s = sunGeoKm(jd, m);
    return wrapPi(Math.atan2(m.y, m.x) - Math.atan2(s.y, s.x));
  }

  function bisect(f, lo, hi) {
    var flo = f(lo);
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (f(mid) * flo > 0) { lo = mid; flo = f(mid); } else { hi = mid; }
    }
    return (lo + hi) / 2;
  }

  function minimize(f, lo, hi) {
    for (var i = 0; i < 60; i++) {
      var m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      if (f(m1) < f(m2)) hi = m2; else lo = m1;
    }
    return (lo + hi) / 2;
  }

  /**
   * All syzygies in [jd0, jd0+span]: { jd, full } with `full` true at full
   * moon. The phase angle gains ~12.2°/day, so a daily grid can't skip one.
   */
  function syzygies(jd0, spanDays) {
    var out = [];
    var N = Math.ceil(spanDays);
    var prevNew = phase(jd0), prevFull = wrapPi(prevNew - Math.PI);
    for (var i = 1; i <= N; i++) {
      var jd = jd0 + i;
      var pNew = phase(jd);
      var pFull = wrapPi(pNew - Math.PI);
      if (prevNew * pNew < 0 && Math.abs(pNew - prevNew) < 1) {
        out.push({ jd: bisect(phase, jd - 1, jd), full: false });
      }
      if (prevFull * pFull < 0 && Math.abs(pFull - prevFull) < 1) {
        out.push({ jd: bisect(function (t) { return wrapPi(phase(t) - Math.PI); }, jd - 1, jd), full: true });
      }
      prevNew = pNew; prevFull = pFull;
    }
    return out;
  }

  /**
   * Solar-eclipse geometry at instant jd: perpendicular distance d (km) of
   * the Moon's shadow axis from Earth's centre, plus everything needed to
   * classify. Returns null if the shadow points away from Earth.
   */
  function solarGeom(jd) {
    var m = ORRERY.Moon.geoJ2000(jd);
    var s = sunGeoKm(jd, m);
    var ux = m.x - s.x, uy = m.y - s.y, uz = m.z - s.z;
    var rms = Math.sqrt(ux * ux + uy * uy + uz * uz);   // Sun–Moon distance
    ux /= rms; uy /= rms; uz /= rms;
    var t = -(m.x * ux + m.y * uy + m.z * uz);          // Moon → closest point
    if (t < 0) return null;
    var qx = m.x + ux * t, qy = m.y + uy * t, qz = m.z + uz * t;
    var d = Math.sqrt(qx * qx + qy * qy + qz * qz);
    return { d: d, t: t, rms: rms, m: m, u: { x: ux, y: uy, z: uz }, qz: qz };
  }

  /** Cone radii (km) at distance t beyond the Moon along the shadow axis. */
  function umbraRadius(rms, t) {
    var L = rms * R_MOON / (R_SUN - R_MOON);   // umbral cone length
    return R_MOON * (L - t) / L;               // < 0 → antumbra (annular)
  }
  function penumbraRadius(rms, t) {
    var L = rms * R_MOON / (R_SUN + R_MOON);
    return R_MOON * (L + t) / L;
  }

  /** Rough geographic point under the shadow axis at jd (central only). */
  function groundPoint(jd, g) {
    var tSurf = g.t - Math.sqrt(Math.max(0, R_EARTH * R_EARTH - g.d * g.d));
    var px = g.m.x + g.u.x * tSurf,
        py = g.m.y + g.u.y * tSurf,
        pz = g.m.z + g.u.z * tSurf;
    // Ecliptic → equatorial (mean obliquity, J2000 value is plenty here)
    var eps = 23.4392911 * DEG;
    var yq = py * Math.cos(eps) - pz * Math.sin(eps);
    var zq = py * Math.sin(eps) + pz * Math.cos(eps);
    var r = Math.sqrt(px * px + yq * yq + zq * zq);
    var lat = Math.asin(zq / r) / DEG;
    var ra = Math.atan2(yq, px) / DEG;
    var gmst = (280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360;
    var lon = ra - gmst;
    lon = ((lon % 360) + 540) % 360 - 180;
    return { lat: lat, lon: lon };
  }

  function fmtLatLon(p) {
    return Math.abs(p.lat).toFixed(0) + '°' + (p.lat >= 0 ? 'N' : 'S') + ' ' +
           Math.abs(p.lon).toFixed(0) + '°' + (p.lon >= 0 ? 'E' : 'W');
  }

  /** Classify the solar eclipse around new moon jdNM; null if no eclipse. */
  function solarEclipse(jdNM) {
    var jdMax = minimize(function (t) {
      var g = solarGeom(t);
      return g ? g.d : 1e12;
    }, jdNM - 0.07, jdNM + 0.07);
    var g = solarGeom(jdMax);
    if (!g) return null;
    var rp = penumbraRadius(g.rms, g.t);
    if (g.d >= R_EARTH + rp) return null;               // penumbra misses Earth
    var gamma = (g.d / R_EARTH) * (g.qz >= 0 ? 1 : -1); // sign: ecliptic N/S
    var ev = { jdMax: jdMax, gamma: gamma };
    if (g.d < R_EARTH) {
      // Central: evaluate the umbra where the axis meets the surface
      var tSurf = g.t - Math.sqrt(R_EARTH * R_EARTH - g.d * g.d);
      var ru = umbraRadius(g.rms, tSurf);
      ev.type = Math.abs(ru) < 20 ? 'hybrid' : (ru > 0 ? 'total' : 'annular');
      ev.ground = groundPoint(jdMax, g);
    } else {
      var ruMid = umbraRadius(g.rms, g.t);
      // Non-central total/annular (umbra grazes without the axis) is rare
      // and our 10" accuracy can't split it from a deep partial — hedge.
      ev.type = g.d < R_EARTH + Math.abs(ruMid) ? 'partial (near-central)' : 'partial';
      // Partial magnitude: penumbral depth at Earth's nearest limb
      ev.mag = (R_EARTH + rp - g.d) / (rp + umbraRadius(g.rms, g.t));
    }
    return ev;
  }

  /**
   * Lunar-eclipse geometry at jd: Moon's perpendicular distance from the
   * anti-solar axis and Earth's shadow-cone radii at the Moon's range.
   */
  function lunarGeom(jd) {
    var m = ORRERY.Moon.geoJ2000(jd);
    var s = sunGeoKm(jd, m);
    var rs = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
    var ax = -s.x / rs, ay = -s.y / rs, az = -s.z / rs;
    var t = m.x * ax + m.y * ay + m.z * az;             // range down the axis
    // The shadow axis is a RAY, not a line: on the sunward side (t ≤ 0,
    // i.e. around new moon) there is no Earth shadow to be in — without
    // this guard the tint fired at new moon, seen in the first e2e shot.
    if (t <= 0) return { d: Infinity, ru: 0, rp: 0 };
    var dx = m.x - ax * t, dy = m.y - ay * t, dz = m.z - az * t;
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var Lu = rs * R_EARTH / (R_SUN - R_EARTH);
    var Lp = rs * R_EARTH / (R_SUN + R_EARTH);
    return {
      d: d,
      ru: SHADOW_ENLARGE * R_EARTH * (Lu - t) / Lu,
      rp: SHADOW_ENLARGE * R_EARTH * (Lp + t) / Lp
    };
  }

  /** Classify the lunar eclipse around full moon jdFM; null if none. */
  function lunarEclipse(jdFM) {
    var jdMax = minimize(function (t) { return lunarGeom(t).d; },
                         jdFM - 0.07, jdFM + 0.07);
    var g = lunarGeom(jdMax);
    var magU = (g.ru + R_MOON - g.d) / (2 * R_MOON);    // umbral magnitude
    var magP = (g.rp + R_MOON - g.d) / (2 * R_MOON);
    if (magP <= 0) return null;
    return {
      jdMax: jdMax,
      magU: magU,
      magP: magP,
      type: magU >= 1 ? 'total' : (magU > 0 ? 'partial' : 'penumbral')
    };
  }

  /**
   * Per-frame hook for the copper-Moon look: how deep the rendered Moon
   * should look eclipsed at jd. Returns { umbra, penumbra } in [0, 1] —
   * fraction of the Moon's DIAMETER inside each shadow (clamped magnitude).
   * Cheap enough to run every frame (one series evaluation).
   */
  function lunarShading(jd) {
    var g = lunarGeom(jd);
    var magU = (g.ru + R_MOON - g.d) / (2 * R_MOON);
    var magP = (g.rp + R_MOON - g.d) / (2 * R_MOON);
    return {
      umbra: Math.min(1, Math.max(0, magU)),
      penumbra: Math.min(1, Math.max(0, magP))
    };
  }

  function fmtUTC(jd) {
    var d = ORRERY.Kepler.dateFromJD(jd);
    return String(d.getUTCHours()).padStart(2, '0') + ':' +
           String(d.getUTCMinutes()).padStart(2, '0') + ' UTC';
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /**
   * All eclipses in [jd0, jd0+spanDays], sorted. Event shape matches
   * almanac.js rows plus eclipse extras:
   *   { jd (= max eclipse), kind: 'eclipse', ecl: 'solar'|'lunar',
   *     type, gamma?, magU?, ground?, bodyKey, title, sub }
   * bodyKey drives the jump camera: Earth for solar, the Moon for lunar.
   */
  function findAll(jd0, spanDays) {
    var out = [];
    syzygies(jd0, spanDays).forEach(function (s) {
      if (s.full) {
        var le = lunarEclipse(s.jd);
        if (!le) return;
        var subL = le.type === 'penumbral'
          ? 'Subtle penumbral shading only · greatest ' + fmtUTC(le.jdMax)
          : cap(le.type) + ' — umbral magnitude ' + le.magU.toFixed(2) +
            ' · greatest ' + fmtUTC(le.jdMax);
        out.push({
          jd: le.jdMax, kind: 'eclipse', ecl: 'lunar', type: le.type,
          magU: le.magU, bodyKey: 'moon',
          title: cap(le.type) + ' lunar eclipse',
          sub: subL
        });
      } else {
        var se = solarEclipse(s.jd);
        if (!se) return;
        var subS;
        if (se.ground) {
          subS = cap(se.type) + ' along a narrow path · max near ' +
                 fmtLatLon(se.ground) + ' · ' + fmtUTC(se.jdMax);
        } else {
          subS = 'Partial only — Moon covers ~' +
                 Math.round(Math.min(0.99, Math.max(0.05, se.mag)) * 100) +
                 '% at best · ' + fmtUTC(se.jdMax);
        }
        out.push({
          jd: se.jdMax, kind: 'eclipse', ecl: 'solar', type: se.type,
          gamma: se.gamma, ground: se.ground || null, bodyKey: 'earth',
          title: cap(se.type) + ' solar eclipse',
          sub: subS + ' · |γ| ' + Math.abs(se.gamma).toFixed(2)
        });
      }
    });
    out.sort(function (a, b) { return a.jd - b.jd; });
    return out;
  }

  return {
    findAll: findAll,
    lunarShading: lunarShading,
    // exposed for tests / offline verification
    syzygies: syzygies,
    solarEclipse: solarEclipse,
    lunarEclipse: lunarEclipse,
    sunGeoKm: sunGeoKm
  };
})();
