/**
 * lagrange.js — Lagrange points for the Sun–Earth and Sun–Jupiter systems.
 *
 * Positions come from the circular restricted three-body problem applied
 * osculating: at any jd the planet's instantaneous distance d and orbital
 * plane define the rotating frame. The collinear points L1–L3 are the roots
 * of the axial force balance in that frame — solved by bisection, which is
 * globally convergent and needs no quintic bookkeeping; the roots depend
 * only on the mass parameter μ so they're solved once per system and
 * cached. L4/L5 sit at ±60° along the orbit at the planet's distance.
 *
 * Earth's mass ratio includes the Moon — the real L2 residents (JWST) orbit
 * the Earth–Moon barycenter's Lagrange point, so that's the honest choice.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Lagrange = (function () {
  'use strict';

  // M_sun / M_planet (JPL; Earth value includes the Moon)
  var SYSTEMS = [
    { key: 'earth',   ratio: 328900.56 },
    { key: 'jupiter', ratio: 1047.3486 }
  ];

  var COS60 = 0.5, SIN60 = Math.sqrt(3) / 2;
  var rootCache = {};

  /**
   * Net axial acceleration in the rotating frame (normalized units:
   * d = 1, ω = 1, Sun at −μ, planet at 1−μ on the x-axis).
   * Zeros of this function are the collinear Lagrange points.
   */
  function axial(x, mu) {
    var s = x + mu;           // offset from the Sun
    var p = x - 1 + mu;       // offset from the planet
    return x - (1 - mu) * s / Math.abs(s * s * s) - mu * p / Math.abs(p * p * p);
  }

  /** Bisect axial() to a root inside [lo, hi] (signs must differ). */
  function bisect(mu, lo, hi) {
    var flo = axial(lo, mu);
    for (var i = 0; i < 80; i++) {
      var mid = 0.5 * (lo + hi);
      var f = axial(mid, mu);
      if (f === 0) return mid;
      if ((f > 0) === (flo > 0)) { lo = mid; flo = f; }
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /** Collinear roots (barycentric x, normalized) for mass parameter μ. */
  function collinear(mu) {
    if (rootCache[mu]) return rootCache[mu];
    var eps = 1e-9;
    var roots = {
      x1: bisect(mu, 0.3, 1 - mu - eps),   // L1: between Sun and planet
      x2: bisect(mu, 1 - mu + eps, 2),     // L2: beyond the planet
      x3: bisect(mu, -2, -mu - eps)        // L3: opposite side of the Sun
    };
    rootCache[mu] = roots;
    return roots;
  }

  function findSystem(sysKey) {
    for (var i = 0; i < SYSTEMS.length; i++) {
      if (SYSTEMS[i].key === sysKey) return SYSTEMS[i];
    }
    return null;
  }

  /**
   * All five points for a system at jd, heliocentric ecliptic AU:
   * { L1, L2, L3, L4, L5 }, each { x, y, z }.
   */
  function points(sysKey, jd) {
    var sys = findSystem(sysKey);
    if (!sys.el) {
      ORRERY.DATA.PLANETS.forEach(function (p) {
        if (p.key === sys.key) sys.el = p.el;
      });
    }
    var K = ORRERY.Kepler;
    var h = K.heliocentric(sys.el, jd);
    var h2 = K.heliocentric(sys.el, jd + 0.5);
    var h1 = K.heliocentric(sys.el, jd - 0.5);
    var d = h.r;

    // Frame: û radial (Sun→planet), n̂ orbit normal, t̂ prograde in-plane
    var ux = h.x / d, uy = h.y / d, uz = h.z / d;
    var vx = h2.x - h1.x, vy = h2.y - h1.y, vz = h2.z - h1.z;
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx /= nl; ny /= nl; nz /= nl;
    var tx = ny * uz - nz * uy, ty = nz * ux - nx * uz, tz = nx * uy - ny * ux;

    var mu = 1 / (sys.ratio + 1);
    var c = collinear(mu);

    function radial(xBary) {
      var r = (xBary + mu) * d;   // barycentric → heliocentric along û
      return { x: ux * r, y: uy * r, z: uz * r };
    }
    function angular(sin) {      // ±60° from the planet, at its distance
      return {
        x: (ux * COS60 + tx * sin) * d,
        y: (uy * COS60 + ty * sin) * d,
        z: (uz * COS60 + tz * sin) * d
      };
    }

    return {
      L1: radial(c.x1),
      L2: radial(c.x2),
      L3: radial(c.x3),
      L4: angular(SIN60),        // leading
      L5: angular(-SIN60)        // trailing
    };
  }

  /** One point only (e.g. 'L2') — same cost, friendlier call site. */
  function point(sysKey, name, jd) {
    return points(sysKey, jd)[name];
  }

  return { SYSTEMS: SYSTEMS, points: points, point: point };
})();
