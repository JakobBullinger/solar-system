/**
 * starlink.js — the Earth-orbit data layer: real shell structure,
 * synthetic catalog.
 *
 * Shell parameters (altitude, inclination, plane count, sats per plane) are
 * the REAL SpaceX Gen1 constellation as licensed by the FCC (2018 grant as
 * modified April 2019 / April 2021 — the canonical 4,408-satellite set).
 * The per-satellite catalog is SYNTHETIC: phases are generated procedurally
 * from Walker-delta geometry, so no TLEs and no network — the artifact
 * stays a self-contained offline file. Gen2 (licensed Dec 2022) is noted in
 * the dossiers but not plotted.
 *
 * Physics (all standard textbook two-body + first-order J2, verified in
 * test/earthorbit.test.js against handbook values):
 *   circular speed   v = √(μ/r)
 *   period           T = 2π√(r³/μ)
 *   nodal precession Ω̇ = −(3/2) n J₂ (Rₑ/r)² cos i   (Vallado eq. 9-38)
 * with μ = 398600.4418 km³/s², Rₑ = 6378.137 km (altitudes are quoted above
 * the equatorial radius), J₂ = 1.08263×10⁻³. GEO sits at 35,786 km where
 * T = 1436.07 min — one sidereal day, the same 23.9345 h the orrery already
 * uses to spin the Earth mesh, so a GEO satellite genuinely hangs still
 * over the rendered surface.
 *
 * Frame: Earth-centered inertial, equatorial — x/y in the equator plane,
 * z toward the north pole. The scene module maps this into the orrery's
 * tilted-Earth frame; nothing here touches THREE or the DOM, so the whole
 * module loads in plain node for the unit tests.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.STARLINK = (function () {
  'use strict';

  var DEG = Math.PI / 180;
  var MU = 398600.4418;         // km³/s²
  var RE = 6378.137;            // km, equatorial
  var J2 = 1.08262668e-3;
  var EPOCH = 2451545.0;        // J2000 — synthetic phases are defined here
  var SIDEREAL_H = 23.9345;     // matches DATA.PLANETS earth.rotationHours

  // The Gen1 shells, straight from the FCC filings. `f` is the synthetic
  // Walker inter-plane phasing factor (real per-sat phases are operational
  // data we deliberately don't ship).
  var SHELLS = [
    { key: 'shell1', name: 'Shell 1', altKm: 550, incDeg: 53.0, planes: 72, perPlane: 22, f: 17, color: '#7DB8FF' },
    { key: 'shell2', name: 'Shell 2', altKm: 540, incDeg: 53.2, planes: 72, perPlane: 22, f: 29, color: '#5FD4C4' },
    { key: 'shell3', name: 'Shell 3', altKm: 570, incDeg: 70.0, planes: 36, perPlane: 20, f: 11, color: '#C9A2F5' },
    { key: 'shell4', name: 'Shell 4 (polar)', altKm: 560, incDeg: 97.6, planes: 6, perPlane: 58, f: 1, color: '#F5C97D' },
    { key: 'shell5', name: 'Shell 5 (polar)', altKm: 560, incDeg: 97.6, planes: 4, perPlane: 43, f: 1, color: '#F59DA0' }
  ];

  // Reference anchors so the scale story lands: the crewed benchmark in
  // LEO, and the geostationary ring 65× farther out than Starlink.
  var ISS = { key: 'iss', name: 'ISS', altKm: 420, incDeg: 51.6, color: '#FFFFFF' };
  var GEO = { key: 'geo', name: 'GEO ring', altKm: 35786, incDeg: 0, color: '#F2A63C' };

  function radiusKm(altKm) { return RE + altKm; }

  /** Circular orbital speed, km/s. */
  function vCirc(altKm) { return Math.sqrt(MU / radiusKm(altKm)); }

  /** Orbital period, minutes. */
  function periodMin(altKm) {
    var r = radiusKm(altKm);
    return 2 * Math.PI * Math.sqrt(r * r * r / MU) / 60;
  }

  /** Mean motion, rad per day. */
  function meanMotion(altKm) {
    var r = radiusKm(altKm);
    return Math.sqrt(MU / (r * r * r)) * 86400;
  }

  /** First-order J2 nodal precession, degrees per day (westward < 0). */
  function raanRateDegPerDay(altKm, incDeg) {
    var r = radiusKm(altKm);
    var n = Math.sqrt(MU / (r * r * r));
    return -1.5 * n * J2 * Math.pow(RE / r, 2) * Math.cos(incDeg * DEG) * 86400 / DEG;
  }

  /** Total satellites in a shell. */
  function shellCount(shell) { return shell.planes * shell.perPlane; }

  /**
   * Synthetic Walker-delta position of satellite `s` in plane `p` of `shell`
   * at Julian date jd. Circular orbit + J2 RAAN drift. Returns {x,y,z} in km,
   * equatorial inertial frame (z = north). Pass `out` to avoid allocation
   * (the scene module updates 4,408 of these per frame).
   */
  function satPosKm(shell, p, s, jd, out) {
    var r = radiusKm(shell.altKm);
    var t = jd - EPOCH;                                       // days
    var total = shellCount(shell);
    var raan = (p / shell.planes) * 2 * Math.PI +
      raanRateDegPerDay(shell.altKm, shell.incDeg) * DEG * t;
    var u = (s / shell.perPlane) * 2 * Math.PI +              // in-plane slot
      (shell.f * p / total) * 2 * Math.PI +                   // Walker phasing
      meanMotion(shell.altKm) * t;
    var ci = Math.cos(shell.incDeg * DEG), si = Math.sin(shell.incDeg * DEG);
    var cO = Math.cos(raan), sO = Math.sin(raan);
    var cu = Math.cos(u), su = Math.sin(u);
    var o = out || { x: 0, y: 0, z: 0 };
    o.x = r * (cO * cu - sO * su * ci);
    o.y = r * (sO * cu + cO * su * ci);
    o.z = r * (su * si);
    return o;
  }

  /**
   * Earth spin fraction at jd — THE SAME phase formula main.js uses to spin
   * the mesh ((days since J2000)·24 / rotationHours mod 1), so anything
   * computed here agrees with the rendered surface by construction.
   */
  function earthSpinFraction(jd) {
    var f = ((jd - EPOCH) * 24 / SIDEREAL_H) % 1;
    return f < 0 ? f + 1 : f;
  }

  /**
   * Earth-fixed longitude (deg, [-180,180)) of an inertial equatorial
   * position at jd — the observable that moves for LEO and stands still
   * for GEO.
   */
  function fixedLongitudeDeg(pos, jd) {
    var lon = Math.atan2(pos.y, pos.x) / DEG - earthSpinFraction(jd) * 360;
    lon = ((lon % 360) + 540) % 360 - 180;
    return lon;
  }

  return {
    MU: MU,
    RE: RE,
    J2: J2,
    EPOCH: EPOCH,
    SIDEREAL_H: SIDEREAL_H,
    SHELLS: SHELLS,
    ISS: ISS,
    GEO: GEO,
    radiusKm: radiusKm,
    vCirc: vCirc,
    periodMin: periodMin,
    meanMotion: meanMotion,
    raanRateDegPerDay: raanRateDegPerDay,
    shellCount: shellCount,
    satPosKm: satPosKm,
    earthSpinFraction: earthSpinFraction,
    fixedLongitudeDeg: fixedLongitudeDeg
  };
})();
