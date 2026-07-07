/**
 * moon.js — Real geocentric lunar position (truncated ELP-2000/82 series).
 *
 * The orrery's rendered Moon was schematic (a circular pivot at a display
 * radius); eclipse prediction needs the real Moon. This implements the
 * classical truncated lunar theory from Meeus, "Astronomical Algorithms",
 * chapter 47: the full 60-term periodic series for longitude and distance
 * (table 47.A) and the 60-term series for latitude (table 47.B), plus the
 * A1/A2/A3 planetary additives. Accuracy of this truncation: ~10 arcsec in
 * longitude, ~4 arcsec in latitude, ~30 km in distance — comfortably inside
 * the arcminute bar that syzygy-based eclipse finding requires (the Moon
 * moves its own ~1900" diameter in an hour, so 10" ≈ 20 s of timing).
 *
 * Two frames on purpose:
 *   position(jd)  — ecliptic longitude/latitude OF DATE (what Meeus tables
 *                   and almanacs quote; pinned by the ch. 47 worked example).
 *   geoJ2000(jd)  — Cartesian km in the J2000 ecliptic frame, precessed by
 *                   the general precession in longitude so it can be mixed
 *                   with kepler.js heliocentric positions (which are J2000).
 *                   By 2026 the frames differ by ~22', which would corrupt
 *                   eclipse geometry by thousands of km if ignored.
 *
 * Deliberately omitted, with rationale:
 *   nutation — shifts Sun and Moon longitudes equally, so syzygy timing and
 *              eclipse geometry are unaffected (≤ 17" absolute).
 *   ΔT       — the app clock is UTC; the series wants TT. The ~70 s offset
 *              (2026) is far below the ±hours verification bar.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Moon = (function () {
  'use strict';

  var DEG = Math.PI / 180;
  var J2000 = 2451545.0;

  // Table 47.A — periodic terms for longitude (Σl, 1e-6 deg) and
  // distance (Σr, 1e-3 km). Columns: D, M, M', F, l, r.
  var TERMS_LR = [
    [0, 0, 1, 0, 6288774, -20905355],
    [2, 0, -1, 0, 1274027, -3699111],
    [2, 0, 0, 0, 658314, -2955968],
    [0, 0, 2, 0, 213618, -569925],
    [0, 1, 0, 0, -185116, 48888],
    [0, 0, 0, 2, -114332, -3149],
    [2, 0, -2, 0, 58793, 246158],
    [2, -1, -1, 0, 57066, -152138],
    [2, 0, 1, 0, 53322, -170733],
    [2, -1, 0, 0, 45758, -204586],
    [0, 1, -1, 0, -40923, -129620],
    [1, 0, 0, 0, -34720, 108743],
    [0, 1, 1, 0, -30383, 104755],
    [2, 0, 0, -2, 15327, 10321],
    [0, 0, 1, 2, -12528, 0],
    [0, 0, 1, -2, 10980, 79661],
    [4, 0, -1, 0, 10675, -34782],
    [0, 0, 3, 0, 10034, -23210],
    [4, 0, -2, 0, 8548, -21636],
    [2, 1, -1, 0, -7888, 24208],
    [2, 1, 0, 0, -6766, 30824],
    [1, 0, -1, 0, -5163, -8379],
    [1, 1, 0, 0, 4987, -16675],
    [2, -1, 1, 0, 4036, -12831],
    [2, 0, 2, 0, 3994, -10445],
    [4, 0, 0, 0, 3861, -11650],
    [2, 0, -3, 0, 3665, 14403],
    [0, 1, -2, 0, -2689, -7003],
    [2, 0, -1, 2, -2602, 0],
    [2, -1, -2, 0, 2390, 10056],
    [1, 0, 1, 0, -2348, 6322],
    [2, -2, 0, 0, 2236, -9884],
    [0, 1, 2, 0, -2120, 5751],
    [0, 2, 0, 0, -2069, 0],
    [2, -2, -1, 0, 2048, -4950],
    [2, 0, 1, -2, -1773, 4130],
    [2, 0, 0, 2, -1595, 0],
    [4, -1, -1, 0, 1215, -3958],
    [0, 0, 2, 2, -1110, 0],
    [3, 0, -1, 0, -892, 3258],
    [2, 1, 1, 0, -810, 2616],
    [4, -1, -2, 0, 759, -1897],
    [0, 2, -1, 0, -713, -2117],
    [2, 2, -1, 0, -700, 2354],
    [2, 1, -2, 0, 691, 0],
    [2, -1, 0, -2, 596, 0],
    [4, 0, 1, 0, 549, -1423],
    [0, 0, 4, 0, 537, -1117],
    [4, -1, 0, 0, 520, -1571],
    [1, 0, -2, 0, -487, -1739],
    [2, 1, 0, -2, -399, 0],
    [0, 0, 2, -2, -381, -4421],
    [1, 1, 1, 0, 351, 0],
    [3, 0, -2, 0, -340, 0],
    [4, 0, -3, 0, 330, 0],
    [2, -1, 2, 0, 327, 0],
    [0, 2, 1, 0, -323, 1165],
    [1, 1, -1, 0, 299, 0],
    [2, 0, 3, 0, 294, 0],
    [2, 0, -1, -2, 0, 8752]
  ];

  // Table 47.B — periodic terms for latitude (Σb, 1e-6 deg).
  // Columns: D, M, M', F, b.
  var TERMS_B = [
    [0, 0, 0, 1, 5128122],
    [0, 0, 1, 1, 280602],
    [0, 0, 1, -1, 277693],
    [2, 0, 0, -1, 173237],
    [2, 0, -1, 1, 55413],
    [2, 0, -1, -1, 46271],
    [2, 0, 0, 1, 32573],
    [0, 0, 2, 1, 17198],
    [2, 0, 1, -1, 9266],
    [0, 0, 2, -1, 8822],
    [2, -1, 0, -1, 8216],
    [2, 0, -2, -1, 4324],
    [2, 0, 1, 1, 4200],
    [2, 1, 0, -1, -3359],
    [2, -1, -1, 1, 2463],
    [2, -1, 0, 1, 2211],
    [2, -1, -1, -1, 2065],
    [0, 1, -1, -1, -1870],
    [4, 0, -1, -1, 1828],
    [0, 1, 0, 1, -1794],
    [0, 0, 0, 3, -1749],
    [0, 1, -1, 1, -1565],
    [1, 0, 0, 1, -1491],
    [0, 1, 1, 1, -1475],
    [0, 1, 1, -1, -1410],
    [0, 1, 0, -1, -1344],
    [1, 0, 0, -1, -1335],
    [0, 0, 3, 1, 1107],
    [4, 0, 0, -1, 1021],
    [4, 0, -1, 1, 833],
    [0, 0, 1, -3, 777],
    [4, 0, -2, 1, 671],
    [2, 0, 0, -3, 607],
    [2, 0, 2, -1, 596],
    [2, -1, 1, -1, 491],
    [2, 0, -2, 1, -451],
    [0, 0, 3, -1, 439],
    [2, 0, 2, 1, 422],
    [2, 0, -3, -1, 421],
    [2, 1, -1, 1, -366],
    [2, 1, 0, 1, -351],
    [4, 0, 0, 1, 331],
    [2, -1, 1, 1, 315],
    [2, -2, 0, -1, 302],
    [0, 0, 1, 3, -283],
    [2, 1, 1, -1, -229],
    [1, 1, 0, -1, 223],
    [1, 1, 0, 1, 223],
    [0, 1, -2, -1, -220],
    [2, 1, -1, -1, -220],
    [1, 0, 1, 1, -185],
    [2, -1, -2, -1, 181],
    [0, 1, 2, 1, -177],
    [4, 0, -2, -1, 176],
    [4, -1, -1, -1, 166],
    [1, 0, 1, -1, -164],
    [4, 0, 1, -1, 132],
    [1, 0, -1, -1, -119],
    [4, -1, 0, -1, 115],
    [2, -2, 0, 1, 107]
  ];

  function norm360(x) {
    x = x % 360;
    return x < 0 ? x + 360 : x;
  }

  /**
   * Geocentric ecliptic position of date at Julian date jd (treated as TT;
   * see header re ΔT). Returns { lonDeg, latDeg, distKm } — geometric,
   * mean equinox of date, no nutation.
   */
  function position(jd) {
    var T = (jd - J2000) / 36525;

    // Fundamental arguments (Meeus 47.1–47.5), degrees.
    var Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T +
                     T * T * T / 538841 - T * T * T * T / 65194000);
    var D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T +
                    T * T * T / 545868 - T * T * T * T / 113065000);
    var M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T +
                    T * T * T / 24490000);
    var Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T +
                     T * T * T / 69699 - T * T * T * T / 14712000);
    var F = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T -
                    T * T * T / 3526000 + T * T * T * T / 863310000);

    var A1 = norm360(119.75 + 131.849 * T);        // Venus perturbation
    var A2 = norm360(53.09 + 479264.290 * T);      // Jupiter perturbation
    var A3 = norm360(313.45 + 481266.484 * T);
    // Eccentricity-of-Earth's-orbit damping for terms involving M
    var E = 1 - 0.002516 * T - 0.0000074 * T * T;
    var E2 = E * E;

    var sl = 0, sr = 0, sb = 0;
    var i, t, arg, e;
    for (i = 0; i < TERMS_LR.length; i++) {
      t = TERMS_LR[i];
      arg = (t[0] * D + t[1] * M + t[2] * Mp + t[3] * F) * DEG;
      e = t[1] === 0 ? 1 : (t[1] === 1 || t[1] === -1 ? E : E2);
      sl += t[4] * e * Math.sin(arg);
      sr += t[5] * e * Math.cos(arg);
    }
    sl += 3958 * Math.sin(A1 * DEG) +
          1962 * Math.sin((Lp - F) * DEG) +
           318 * Math.sin(A2 * DEG);

    for (i = 0; i < TERMS_B.length; i++) {
      t = TERMS_B[i];
      arg = (t[0] * D + t[1] * M + t[2] * Mp + t[3] * F) * DEG;
      e = t[1] === 0 ? 1 : (t[1] === 1 || t[1] === -1 ? E : E2);
      sb += t[4] * e * Math.sin(arg);
    }
    sb += -2235 * Math.sin(Lp * DEG) +
            382 * Math.sin(A3 * DEG) +
            175 * Math.sin((A1 - F) * DEG) +
            175 * Math.sin((A1 + F) * DEG) +
            127 * Math.sin((Lp - Mp) * DEG) -
            115 * Math.sin((Lp + Mp) * DEG);

    return {
      lonDeg: norm360(Lp + sl / 1e6),
      latDeg: sb / 1e6,
      distKm: 385000.56 + sr / 1000
    };
  }

  /**
   * Geocentric Cartesian position in km, J2000 ecliptic frame (matching
   * kepler.js heliocentric output): x toward the J2000 equinox, z toward
   * ecliptic north. Longitude is precessed from equinox-of-date back to
   * J2000 with the general precession in longitude (IAU 1976 rates);
   * the tiny motion of the ecliptic pole itself (~47"/cy in latitude) is
   * ignored — ~10 km at the Moon over this app's ±century range.
   */
  function geoJ2000(jd) {
    var p = position(jd);
    var T = (jd - J2000) / 36525;
    var pA = (5029.0966 * T + 1.11113 * T * T) / 3600;   // degrees
    var lon = (p.lonDeg - pA) * DEG;
    var lat = p.latDeg * DEG;
    var cl = Math.cos(lat);
    return {
      x: p.distKm * cl * Math.cos(lon),
      y: p.distKm * cl * Math.sin(lon),
      z: p.distKm * Math.sin(lat),
      distKm: p.distKm
    };
  }

  return {
    position: position,
    geoJ2000: geoJ2000
  };
})();
