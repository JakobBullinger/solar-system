/**
 * almanac.js — Sky-event finder.
 *
 * Scans a window of time for the classic almanac events, all derived from
 * the same Kepler engine that drives the scene:
 *
 *   opposition   superior planet opposite the Sun in Earth's sky
 *                (heliocentric longitudes of Earth and planet align)
 *   elongation   Mercury/Venus at greatest angular distance from the Sun
 *   conjunction  two planets within 2.5° of each other in Earth's sky
 *
 * Strategy: sample daily on a coarse grid, detect crossings / extrema,
 * then refine each candidate with bisection or ternary search.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Almanac = (function () {
  'use strict';

  var K = ORRERY.Kepler;
  var RAD2DEG = 180 / Math.PI;
  var CONJ_LIMIT = 2.5 / RAD2DEG;   // list conjunctions closer than this

  function wrapPi(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  function clampAcos(d) {
    return Math.acos(Math.min(1, Math.max(-1, d)));
  }

  /** Geocentric unit vector + distance for a body. */
  function geo(el, earthEl, jd) {
    var p = K.heliocentric(el, jd);
    var e = K.heliocentric(earthEl, jd);
    var x = p.x - e.x, y = p.y - e.y, z = p.z - e.z;
    var r = Math.sqrt(x * x + y * y + z * z);
    return { x: x / r, y: y / r, z: z / r, r: r, e: e };
  }

  /** Angular separation of two bodies in Earth's sky (radians). */
  function separation(elA, elB, earthEl, jd) {
    var a = geo(elA, earthEl, jd);
    var b = geo(elB, earthEl, jd);
    return clampAcos(a.x * b.x + a.y * b.y + a.z * b.z);
  }

  /** Angular distance of a body from the Sun in Earth's sky (radians). */
  function elongation(el, earthEl, jd) {
    var g = geo(el, earthEl, jd);
    var er = Math.sqrt(g.e.x * g.e.x + g.e.y * g.e.y + g.e.z * g.e.z);
    return clampAcos(-(g.x * g.e.x + g.y * g.e.y + g.z * g.e.z) / er);
  }

  /** Signed helio-longitude difference planet − Earth; oppositions at 0. */
  function lonDiff(el, earthEl, jd) {
    var p = K.heliocentric(el, jd);
    var e = K.heliocentric(earthEl, jd);
    return wrapPi(Math.atan2(p.y, p.x) - Math.atan2(e.y, e.x));
  }

  function bisect(f, lo, hi) {
    var flo = f(lo);
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (f(mid) * flo > 0) { lo = mid; flo = f(mid); } else { hi = mid; }
    }
    return (lo + hi) / 2;
  }

  /** Ternary search: jd of the minimum of f on [lo, hi]. */
  function minimize(f, lo, hi) {
    for (var i = 0; i < 60; i++) {
      var m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      if (f(m1) < f(m2)) hi = m2; else lo = m1;
    }
    return (lo + hi) / 2;
  }

  /**
   * All events in [jd0, jd0 + spanDays], sorted by date.
   * Each: { jd, kind, bodyKey, title, sub }
   */
  function findAll(jd0, spanDays) {
    var PLANETS = ORRERY.DATA.PLANETS;
    var earth = null;
    PLANETS.forEach(function (p) { if (p.key === 'earth') earth = p; });
    var others = PLANETS.filter(function (p) { return p !== earth; });
    var events = [];

    // Daily grid: geocentric unit vectors, helio-longitude diffs, elongations
    var N = Math.floor(spanDays);
    var grid = others.map(function () { return { u: [], ld: [], el: [] }; });
    for (var i = 0; i <= N; i++) {
      var jd = jd0 + i;
      var e = K.heliocentric(earth.el, jd);
      var er = Math.sqrt(e.x * e.x + e.y * e.y + e.z * e.z);
      var lonE = Math.atan2(e.y, e.x);
      others.forEach(function (p, k) {
        var h = K.heliocentric(p.el, jd);
        var x = h.x - e.x, y = h.y - e.y, z = h.z - e.z;
        var r = Math.sqrt(x * x + y * y + z * z);
        x /= r; y /= r; z /= r;
        var g = grid[k];
        g.u.push({ x: x, y: y, z: z });
        g.ld.push(wrapPi(Math.atan2(h.y, h.x) - lonE));
        g.el.push(clampAcos(-(x * e.x + y * e.y + z * e.z) / er));
      });
    }

    // Oppositions: helio-longitude difference crosses zero (superior planets)
    others.forEach(function (p, k) {
      if (p.el[0] < 1) return;
      var ld = grid[k].ld;
      for (var i = 1; i <= N; i++) {
        if (ld[i - 1] * ld[i] < 0 && Math.abs(ld[i] - ld[i - 1]) < 1) {
          var jd = bisect(function (t) { return lonDiff(p.el, earth.el, t); },
                          jd0 + i - 1, jd0 + i);
          var g = geo(p.el, earth.el, jd);
          events.push({
            jd: jd, kind: 'opposition', bodyKey: p.key,
            title: p.name + ' at opposition',
            sub: 'Closest & brightest — ' + g.r.toFixed(2) + ' AU from Earth'
          });
        }
      }
    });

    // Greatest elongations: local maxima for Mercury and Venus
    others.forEach(function (p, k) {
      if (p.el[0] >= 1) return;
      var el = grid[k].el;
      for (var i = 1; i < N; i++) {
        if (el[i] > el[i - 1] && el[i] >= el[i + 1]) {
          var jd = minimize(function (t) { return -elongation(p.el, earth.el, t); },
                            jd0 + i - 1, jd0 + i + 1);
          var g = geo(p.el, earth.el, jd);
          var e = g.e;
          // East of the Sun (evening sky) if geocentric longitude leads the Sun's
          var d = wrapPi(Math.atan2(g.y, g.x) - Math.atan2(-e.y, -e.x));
          var deg = Math.round(elongation(p.el, earth.el, jd) * RAD2DEG);
          events.push({
            jd: jd, kind: 'elongation', bodyKey: p.key,
            title: p.name + ' — greatest elongation',
            sub: deg + '° ' + (d > 0 ? 'east of the Sun · evening sky'
                                     : 'west of the Sun · morning sky')
          });
        }
      }
    });

    // Conjunctions: pairwise separation minima under the limit.
    // Pluto is skipped — a naked-eye-invisible "conjunction" is noise.
    for (var a = 0; a < others.length; a++) {
      if (others[a].key === 'pluto') continue;
      for (var b = a + 1; b < others.length; b++) {
        if (others[b].key === 'pluto') continue;
        var ua = grid[a].u, ub = grid[b].u;
        var prev = 10, cur = 10;
        for (var i = 0; i <= N; i++) {
          var next = clampAcos(ua[i].x * ub[i].x + ua[i].y * ub[i].y + ua[i].z * ub[i].z);
          if (i >= 2 && cur < prev && cur <= next && cur < CONJ_LIMIT * 1.5) {
            var pA = others[a], pB = others[b];
            var jd = minimize(sepFn(pA, pB, earth), jd0 + i - 2, jd0 + i);
            var sep = separation(pA.el, pB.el, earth.el, jd) * RAD2DEG;
            if (sep < CONJ_LIMIT * RAD2DEG) {
              events.push({
                jd: jd, kind: 'conjunction', bodyKey: pA.key,
                title: pA.name + ' – ' + pB.name + ' conjunction',
                sub: sep.toFixed(1) + '° apart in Earth’s sky'
              });
            }
          }
          prev = cur; cur = next;
        }
      }
    }

    events.sort(function (x, y) { return x.jd - y.jd; });
    return events;
  }

  function sepFn(pA, pB, earth) {
    return function (t) { return separation(pA.el, pB.el, earth.el, t); };
  }

  return { findAll: findAll };
})();
