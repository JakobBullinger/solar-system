/**
 * kepler.js — Orbital mechanics.
 *
 * Converts Keplerian elements (J2000 + rates) into heliocentric ecliptic
 * coordinates for an arbitrary Julian date, via Newton-iterated solution
 * of Kepler's equation. Also provides the scene-space distance mapping:
 * true AU distances are compressed with a power law so the outer system
 * stays on screen while ordering and eccentricity remain honest.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Kepler = (function () {
  'use strict';

  var DEG = Math.PI / 180;
  var J2000 = 2451545.0;

  // Scene distance compression: sceneR = DIST_K * (AU ^ DIST_P)
  var DIST_K = 62;
  var DIST_P = 0.52;

  function julianDate(dateMs) {
    return dateMs / 86400000 + 2440587.5;
  }

  function dateFromJD(jd) {
    return new Date((jd - 2440587.5) * 86400000);
  }

  /**
   * Solve Kepler's equation  E - e·sin(E) = M  (all radians).
   * For high eccentricities (comets) Newton from E₀ = M can oscillate,
   * so we start at π where the iteration is globally convergent.
   */
  function solveKepler(M, e) {
    var E = e > 0.8 ? Math.PI : M + e * Math.sin(M);
    if (M < 0 && e > 0.8) E = -Math.PI;
    for (var i = 0; i < 24; i++) {
      var dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-9) break;
    }
    return E;
  }

  /** Current element set for a body at Julian date jd. */
  function elementsAt(el, jd) {
    var T = (jd - J2000) / 36525;
    return {
      a:    el[0] + el[1]  * T,
      e:    el[2] + el[3]  * T,
      I:   (el[4] + el[5]  * T) * DEG,
      L:   (el[6] + el[7]  * T) * DEG,
      peri:(el[8] + el[9]  * T) * DEG,
      node:(el[10]+ el[11] * T) * DEG
    };
  }

  /**
   * Heliocentric ecliptic position (AU) at Julian date jd.
   * Returns { x, y, z, r } in the ecliptic frame (z = ecliptic north).
   */
  function heliocentric(el, jd) {
    var o = elementsAt(el, jd);
    var omega = o.peri - o.node;          // argument of perihelion
    var M = o.L - o.peri;                 // mean anomaly
    M = M % (2 * Math.PI);
    if (M > Math.PI) M -= 2 * Math.PI;
    if (M < -Math.PI) M += 2 * Math.PI;

    var E = solveKepler(M, o.e);
    var xp = o.a * (Math.cos(E) - o.e);                     // orbital-plane coords,
    var yp = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);  // x toward perihelion

    var cw = Math.cos(omega), sw = Math.sin(omega);
    var cn = Math.cos(o.node), sn = Math.sin(o.node);
    var ci = Math.cos(o.I),   si = Math.sin(o.I);

    var x = (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp;
    var y = (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp;
    var z = (sw * si) * xp + (cw * si) * yp;

    return { x: x, y: y, z: z, r: Math.sqrt(x * x + y * y + z * z), a: o.a };
  }

  /** Compress a heliocentric AU position into scene space (three.js, y-up). */
  function toScene(p, out) {
    var r = p.r || Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    var s = r > 1e-9 ? DIST_K * Math.pow(r, DIST_P) / r : 0;
    // Ecliptic (x, y, z-north)  →  scene (x, z-north→y-up, -y→z)
    out.set(p.x * s, p.z * s, -p.y * s);
    return out;
  }

  /** Scene-space position for a body at jd, written into `out` (Vector3). */
  function scenePosition(el, jd, out) {
    return toScene(heliocentric(el, jd), out);
  }

  /**
   * Sampled orbit path in scene space (closed loop of `n` Vector3s),
   * traced by sweeping eccentric anomaly at the current epoch.
   */
  function orbitPath(el, jd, n) {
    var o = elementsAt(el, jd);
    var omega = o.peri - o.node;
    var cw = Math.cos(omega), sw = Math.sin(omega);
    var cn = Math.cos(o.node), sn = Math.sin(o.node);
    var ci = Math.cos(o.I),   si = Math.sin(o.I);
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var E = (i / n) * 2 * Math.PI;
      var xp = o.a * (Math.cos(E) - o.e);
      var yp = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
      var x = (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp;
      var y = (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp;
      var z = (sw * si) * xp + (cw * si) * yp;
      var v = new THREE.Vector3();
      toScene({ x: x, y: y, z: z }, v);
      pts.push(v);
    }
    return pts;
  }

  /** Orbital period in days (Kepler's third law, a in AU). */
  function periodDays(a) {
    return 365.25 * Math.pow(a, 1.5);
  }

  /** Vis-viva orbital speed in km/s at heliocentric distance r (AU). */
  function orbitalSpeed(r, a) {
    return 29.7847 * Math.sqrt(Math.max(0, 2 / r - 1 / a));
  }

  /** Julian date of the next perihelion passage after jd. */
  function nextPerihelion(el, jd) {
    var o = elementsAt(el, jd);
    var M = (o.L - o.peri) % (2 * Math.PI);
    if (M < 0) M += 2 * Math.PI;
    var P = periodDays(o.a);
    return jd + ((2 * Math.PI - M) / (2 * Math.PI)) * P;
  }

  return {
    J2000: J2000,
    DIST_K: DIST_K,
    DIST_P: DIST_P,
    julianDate: julianDate,
    dateFromJD: dateFromJD,
    heliocentric: heliocentric,
    toScene: toScene,
    scenePosition: scenePosition,
    orbitPath: orbitPath,
    periodDays: periodDays,
    orbitalSpeed: orbitalSpeed,
    elementsAt: elementsAt,
    nextPerihelion: nextPerihelion
  };
})();
