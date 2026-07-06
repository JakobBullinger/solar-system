/**
 * lambert.js — Two-body Lambert solver for the Launch Window Lab.
 *
 * Given two heliocentric positions and a time of flight, find the conic
 * that connects them (universal-variable formulation, Bate–Mueller–White/
 * Curtis). Solved by bisection on the universal parameter z: t(z) is
 * monotonic for the zero-revolution problem, and an invalid y(z) < 0
 * (possible when the transfer angle exceeds 180°) simply means z is too
 * low, so the bracket never breaks. Robust for every elliptic and
 * hyperbolic transfer a porkchop grid asks for; multi-revolution
 * solutions are out of scope and reported as null.
 *
 * Everything is in the app's native units — heliocentric ecliptic AU and
 * days, GM_sun as in nbody.js — so a solution can be handed straight to
 * NBody.previewLive for n-body validation.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Lambert = (function () {
  'use strict';

  var MU = 2.9591220828e-4;      // GM_sun in AU³/day² (matches NBody.MU)
  var KMS = 1731.456;            // 1 AU/day in km/s
  var Z_MAX = 4 * Math.PI * Math.PI * 0.999;  // just below the full-revolution limit

  // Stumpff functions, with series near z = 0 to avoid 0/0
  function stumpffC(z) {
    if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
    if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / (-z);
    return 0.5 - z / 24;
  }
  function stumpffS(z) {
    if (z > 1e-6) {
      var sz = Math.sqrt(z);
      return (sz - Math.sin(sz)) / (sz * sz * sz);
    }
    if (z < -1e-6) {
      var sn = Math.sqrt(-z);
      return (Math.sinh(sn) - sn) / (sn * sn * sn);
    }
    return 1 / 6 - z / 120;
  }

  /**
   * Solve Lambert's problem from r1 to r2 ({x,y,z} AU) in tof days,
   * prograde (counter-clockwise seen from ecliptic north — every planet).
   * Returns { v1, v2 } in AU/day, or null when degenerate/unreachable.
   */
  function solve(r1v, r2v, tof) {
    if (tof <= 0) return null;
    var r1 = Math.sqrt(r1v.x * r1v.x + r1v.y * r1v.y + r1v.z * r1v.z);
    var r2 = Math.sqrt(r2v.x * r2v.x + r2v.y * r2v.y + r2v.z * r2v.z);
    if (r1 < 1e-9 || r2 < 1e-9) return null;

    var cosD = (r1v.x * r2v.x + r1v.y * r2v.y + r1v.z * r2v.z) / (r1 * r2);
    cosD = Math.max(-1, Math.min(1, cosD));
    var dnu = Math.acos(cosD);
    // Prograde: the ecliptic-north component of r1×r2 picks the short way round
    if (r1v.x * r2v.y - r1v.y * r2v.x < 0) dnu = 2 * Math.PI - dnu;

    var A = Math.sin(dnu) * Math.sqrt(r1 * r2 / (1 - cosD));
    if (!isFinite(A) || Math.abs(A) < 1e-9) return null;  // 0° or 180° transfer

    function yOf(z, C) { return r1 + r2 + A * (z * stumpffS(z) - 1) / Math.sqrt(C); }

    // Bisection on z: y < 0 counts as "time too short", i.e. z too low
    var zLo = -4 * Math.PI * Math.PI;
    var zHi = Z_MAX;
    var z = 0, y = 0, C = 0;
    for (var i = 0; i < 70; i++) {
      z = 0.5 * (zLo + zHi);
      C = stumpffC(z);
      y = yOf(z, C);
      if (y < 0) { zLo = z; continue; }
      var chi = Math.sqrt(y / C);
      var t = (chi * chi * chi * stumpffS(z) + A * Math.sqrt(y)) / Math.sqrt(MU);
      if (t < tof) zLo = z; else zHi = z;
    }
    C = stumpffC(z);
    y = yOf(z, C);
    if (y < 0) return null;
    var tEnd = (Math.pow(y / C, 1.5) * stumpffS(z) + A * Math.sqrt(y)) / Math.sqrt(MU);
    if (Math.abs(tEnd - tof) > 1e-3 * tof + 0.01) return null;  // bracket never met tof

    var f = 1 - y / r1;
    var g = A * Math.sqrt(y / MU);
    var gdot = 1 - y / r2;
    if (Math.abs(g) < 1e-12) return null;
    return {
      v1: {
        x: (r2v.x - f * r1v.x) / g,
        y: (r2v.y - f * r1v.y) / g,
        z: (r2v.z - f * r1v.z) / g
      },
      v2: {
        x: (gdot * r2v.x - r1v.x) / g,
        y: (gdot * r2v.y - r1v.y) / g,
        z: (gdot * r2v.z - r1v.z) / g
      }
    };
  }

  /** A body's rail velocity (AU/day) by central difference, as missions.js does. */
  function railVel(el, jd) {
    var a = ORRERY.Kepler.heliocentric(el, jd - 0.5);
    var b = ORRERY.Kepler.heliocentric(el, jd + 0.5);
    return { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  }

  /**
   * One porkchop cell: depart elFrom's rail at jdDep, intercept elTo after
   * tof days. Returns departure Δv (the game's currency: heliocentric
   * impulse off the rail, km/s), arrival v∞ (km/s) and the transfer
   * velocities (AU/day) — or null when Lambert has no zero-rev solution.
   */
  function transfer(elFrom, elTo, jdDep, tof) {
    var p1 = ORRERY.Kepler.heliocentric(elFrom, jdDep);
    var p2 = ORRERY.Kepler.heliocentric(elTo, jdDep + tof);
    var sol = solve(p1, p2, tof);
    if (!sol) return null;
    var vd = railVel(elFrom, jdDep);
    var va = railVel(elTo, jdDep + tof);
    var dx = sol.v1.x - vd.x, dy = sol.v1.y - vd.y, dz = sol.v1.z - vd.z;
    var ax = sol.v2.x - va.x, ay = sol.v2.y - va.y, az = sol.v2.z - va.z;
    return {
      dvDep: Math.sqrt(dx * dx + dy * dy + dz * dz) * KMS,
      vInfArr: Math.sqrt(ax * ax + ay * ay + az * az) * KMS,
      v1: sol.v1,
      v2: sol.v2
    };
  }

  return { solve: solve, transfer: transfer };
})();
