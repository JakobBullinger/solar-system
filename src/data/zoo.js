/**
 * zoo.js — Level 29: The Orbital Zoo. The MEO/GEO/sun-sync/Molniya family
 * layer that answers "why is this orbit shaped this way" for everything
 * above LEO. Real orbital parameters, synthetic per-satellite catalogs (no
 * TLEs, zero network) — same honesty contract as `starlink.js`, which this
 * module reuses for Earth's constants and the circular-orbit + J2 machinery
 * (MU, RE, J2, radiusKm, vCirc, periodMin, meanMotion, raanRateDegPerDay,
 * satPosKm, earthSpinFraction, fixedLongitudeDeg — all shape-compatible
 * with the shell descriptors below, so GPS and the sun-synchronous family
 * are plotted with `ORRERY.STARLINK.satPosKm` directly). Kept as its own
 * module rather than folded into starlink.js because it is a genuinely
 * different regime (elliptical propagation, fixed-longitude slots, shadow
 * geometry) even though it leans on starlink.js's constants throughout.
 *
 * New physics beyond starlink.js's circular/J2 pair:
 *
 *   Elliptical J2 secular rates (Vallado eq. 9-38/9-39, generalized from
 *   starlink.js's circular special case via the semi-latus rectum p =
 *   a(1-e²) in place of the circular radius r):
 *     node (RAAN)          Ω̇ = -(3/2) n J₂ (Rₑ/p)² cos i
 *     argument of perigee  ω̇ =  (3/4) n J₂ (Rₑ/p)² (5cos²i - 1)
 *   ω̇ = 0 exactly at the CRITICAL INCLINATION i = arccos(1/√5) ≈ 63.435°
 *   (5cos²i = 1): Molniya's whole reason for existing at that inclination
 *   is that its argument of perigee — and therefore the latitude at which
 *   apogee dwells — never drifts, so the northern-hemisphere loiter the
 *   orbit is built for doesn't degrade over the mission. The node still
 *   precesses at the critical inclination (only the apsidal line is
 *   pinned); nothing about Ω̇ is special there.
 *
 *   Elliptical propagation reuses `ORRERY.Kepler.heliocentric` — its
 *   E - e·sin(E) = M solver and orbital-plane rotation are pure geometry,
 *   indifferent to whose focus is at the origin or what units `a` carries.
 *   Feeding it a km-scale, Earth-centered element set (built by
 *   `molniyaElements` below, in the same [a,ȧ,e,ė,I,İ,L,L̇,ϖ,ϖ̇,Ω,Ω̇]
 *   layout as bodies.js) makes it a perfectly good geocentric elliptical
 *   propagator for free — no second Kepler solver to maintain or drift out
 *   of sync with the one everything else in the app trusts.
 *
 *   Fixed-longitude GEO slots: a real operator doesn't sit at a Walker
 *   phase, it sits at a filed longitude. `geoSlotPosKm` places a slot by
 *   inertial angle = longitude + current Earth spin phase — the same
 *   identity `fixedLongitudeDeg` inverts, so `fixedLongitudeDeg(geoSlotPosKm
 *   (lon, jd), jd) === lon` for any jd (the "GEO slots hold their longitude"
 *   test below).
 *
 *   Earth-shadow cylinder test: a satellite is eclipsed when it is on the
 *   night side of the sun-Earth line (proj < 0) AND within Rₑ of that line
 *   (perp < Rₑ) — the simple cylinder, not the full umbra cone eclipse.js
 *   uses for the Moon (that machinery answers a different question: exact
 *   contact instants for a body big enough for penumbra/umbra to matter at
 *   Earth's distance from the Sun; here we just need "is this satellite
 *   dark right now").
 *
 * Frame throughout: Earth-centered inertial equatorial, same as
 * starlink.js (x/y in the equatorial plane, z north). No THREE, no DOM —
 * loads in plain node for the unit tests exactly like starlink.js.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.ZOO = (function () {
  'use strict';

  var DEG = Math.PI / 180;

  function S() { return ORRERY.STARLINK; }

  // ---- Elliptical J2 secular rates (generalizes starlink.js's circular case) ----

  /** Semi-major axis (km) that gives an exact period (minutes) via Kepler III. */
  function aFromPeriodMin(periodMin) {
    var Tsec = periodMin * 60;
    return Math.cbrt(S().MU * Tsec * Tsec / (4 * Math.PI * Math.PI));
  }

  function semiLatusRectumKm(a, e) { return a * (1 - e * e); }

  function meanMotionDegPerDay(a) {
    return Math.sqrt(S().MU / (a * a * a)) * 86400 / DEG;
  }

  /** Node precession, deg/day — Vallado 9-38 with p in place of a circular r. */
  function raanRateEccDegPerDay(a, e, incDeg) {
    var n = Math.sqrt(S().MU / (a * a * a));
    var p = semiLatusRectumKm(a, e);
    return -1.5 * n * S().J2 * Math.pow(S().RE / p, 2) * Math.cos(incDeg * DEG) * 86400 / DEG;
  }

  /** Argument-of-perigee precession, deg/day — Vallado 9-39; zero at critical inclination. */
  function argPeriRateDegPerDay(a, e, incDeg) {
    var n = Math.sqrt(S().MU / (a * a * a));
    var p = semiLatusRectumKm(a, e);
    return 0.75 * n * S().J2 * Math.pow(S().RE / p, 2) *
      (5 * Math.pow(Math.cos(incDeg * DEG), 2) - 1) * 86400 / DEG;
  }

  /** The critical inclination: 5cos²i = 1, so argPeriRateDegPerDay(_, _, this) ≡ 0. */
  var CRIT_INC_DEG = Math.acos(1 / Math.sqrt(5)) / DEG;

  // ---- GPS / MEO — semi-synchronous, 6 planes × 55° ------------------------------

  // Real Block-II baseline: 24 slots, 6 planes 60° apart, 55° inclination,
  // ~11h58m period. Chosen so 2 orbits ≈ 1 sidereal day: the ground track
  // very nearly repeats daily, which is WHY this altitude (not a random
  // MEO shell) — a predictable, repeating footprint is what makes a
  // navigation constellation plannable. `f` is a synthetic inter-plane
  // phasing factor (no operational slot assignments shipped).
  var GPS = {
    key: 'gps', name: 'GPS / MEO', color: '#8FE3B0',
    altKm: 20182, incDeg: 55, planes: 6, perPlane: 4, f: 1
  };

  // ---- Sun-synchronous — retrograde, node keeps pace with the Sun ----------------

  // 700 km / 98.19°: the classic Earth-observation shell (Landsat/Sentinel-
  // class altitudes). At this specific retrograde inclination the J2 node
  // rate exactly matches the Earth's ~1°/day revolution around the Sun
  // (test below asserts the match against starlink.js's own J2 formula),
  // so every satellite in the family crosses the equator at the same local
  // solar time on every orbit, forever — consistent lighting for imagery.
  var SUNSYNC = {
    key: 'sunsync', name: 'Sun-synchronous', color: '#7EC8E3',
    altKm: 700, incDeg: 98.19, planes: 6, perPlane: 3, f: 1
  };

  // ---- Molniya — the critical-inclination apogee-dwell orbit ---------------------

  // e = 0.74 and a 12 h period are the classic Molniya numbers (the Soviet
  // comsat system this orbit is named for); the semi-major axis is derived
  // from the period via Kepler III rather than hand-picked, so it stays
  // exactly self-consistent with `periodMin` below. Argument of perigee
  // 270° puts perigee in the south and lets apogee dwell over the far
  // north (argument of latitude 90° at apogee ⇒ latitude ≈ inclination,
  // ~63.4°N) for hours per orbit — the point of the whole design: high-
  // latitude coverage a GEO bird (stuck over the equator) cannot reach.
  // Three planes 120° apart, two satellites per plane phased 180° in mean
  // anomaly, mirrors the real system's handoff scheme: as one satellite's
  // dwell ends, the next is rising to take over continuous coverage.
  var MOLNIYA = {
    key: 'molniya', name: 'Molniya', color: '#F27FB0',
    e: 0.74, incDeg: CRIT_INC_DEG, argPeriDeg: 270,
    periodMin: 720, planes: 3, perPlane: 2
  };
  MOLNIYA.a = aFromPeriodMin(MOLNIYA.periodMin);

  /** JPL-style element array [a,ȧ,e,ė,I,İ,L,L̇,ϖ,ϖ̇,Ω,Ω̇] for one Molniya slot. */
  function molniyaElements(planeIdx, satIdx) {
    var a = MOLNIYA.a, e = MOLNIYA.e, inc = MOLNIYA.incDeg;
    var century = 36525; // days per Julian century — matches Kepler.elementsAt's T
    var nDay = meanMotionDegPerDay(a);
    var raanDot = raanRateEccDegPerDay(a, e, inc);
    var argDot = argPeriRateDegPerDay(a, e, inc); // ≈ 0 at the critical inclination
    var node0 = (planeIdx / MOLNIYA.planes) * 360;
    var peri0 = (node0 + MOLNIYA.argPeriDeg) % 360;               // ϖ = Ω + ω
    var M0 = (satIdx / MOLNIYA.perPlane) * 360;
    var L0 = (peri0 + M0) % 360;                                   // L = ϖ + M
    return [
      a, 0,
      e, 0,
      inc, 0,
      L0, (nDay + raanDot + argDot) * century,
      peri0, (raanDot + argDot) * century,
      node0, raanDot * century
    ];
  }

  /** Geocentric equatorial km position of Molniya slot (plane, sat) at jd. */
  function molniyaPosKm(planeIdx, satIdx, jd) {
    return ORRERY.Kepler.heliocentric(molniyaElements(planeIdx, satIdx), jd);
  }

  /** Static ellipse shape (km) for drawing an orbit line — n+1 points, closed. */
  function orbitShapeKm(a, e, incDeg, argPeriDeg, nodeDeg, n) {
    var omega = argPeriDeg * DEG, node = nodeDeg * DEG, inc = incDeg * DEG;
    var cw = Math.cos(omega), sw = Math.sin(omega);
    var cn = Math.cos(node), sn = Math.sin(node);
    var ci = Math.cos(inc), si = Math.sin(inc);
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var E = (i / n) * 2 * Math.PI;
      var xp = a * (Math.cos(E) - e);
      var yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
      pts.push({
        x: (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp,
        y: (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp,
        z: (sw * si) * xp + (cw * si) * yp
      });
    }
    return pts;
  }

  // ---- GEO — named slots + the disposal graveyard --------------------------------

  // A handful of REAL geostationary operators (public longitude filings,
  // approximate as of 2024–2026 — GEO slots do get renegotiated). Weather
  // birds bracket the globe for continuous imagery; the comms/TV birds are
  // included for scale and variety, not completeness.
  // GOES-19 (GOES-East) is first on purpose: it's the flagship equinox-
  // eclipse example in the GEO dossier (and the one the shadow-crossing
  // e2e spec/debug() hook reads), so keeping it at index 0 means "the
  // named GEO slot" always means the same, documented satellite.
  var GEO_SLOTS = [
    { name: 'GOES-19 (GOES-East)', lonDeg: -75.2, kind: 'weather', op: 'NOAA' },
    { name: 'GOES-18 (GOES-West)', lonDeg: -137.2, kind: 'weather', op: 'NOAA' },
    { name: 'Meteosat-11', lonDeg: 0.0, kind: 'weather', op: 'EUMETSAT' },
    { name: 'Himawari-9', lonDeg: 140.7, kind: 'weather', op: 'JMA' },
    { name: 'Astra 19.2°E', lonDeg: 19.2, kind: 'tv', op: 'SES' },
    { name: 'Intelsat 903', lonDeg: -34.5, kind: 'comms', op: 'Intelsat' },
    { name: 'DIRECTV 12', lonDeg: -102.8, kind: 'tv', op: 'DIRECTV' }
  ];

  /** Fixed-longitude GEO position (km, equatorial): loni = lon + spin phase. */
  function geoSlotPosKm(lonDeg, jd) {
    var spin = S().earthSpinFraction(jd) * 2 * Math.PI;
    var loni = lonDeg * DEG + spin;
    var r = S().radiusKm(S().GEO.altKm);
    return { x: r * Math.cos(loni), y: r * Math.sin(loni), z: 0 };
  }

  // IADC guideline: retire at least ~300 km above GEO so the ring stays
  // clear for operational traffic. Schematic markers, not named — real
  // graveyarded hardware isn't individually catalogued here.
  var GRAVEYARD = {
    key: 'graveyard', name: 'GEO graveyard', color: '#8A8F99',
    altKm: 36086, incDeg: 0, planes: 1, perPlane: 8, f: 0
  };

  // ---- Ground tracks ---------------------------------------------------------------

  /** Earth-fixed {lat, lon} samples of `posFn(t)` over `spanDays` from jd0. */
  function groundTrack(posFn, jd0, spanDays, steps) {
    var pts = [];
    for (var i = 0; i <= steps; i++) {
      var t = jd0 + (i / steps) * spanDays;
      var p = posFn(t);
      var r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      var lat = Math.asin(Math.max(-1, Math.min(1, p.z / r))) / DEG;
      pts.push({ lat: lat, lon: S().fixedLongitudeDeg(p, t) });
    }
    return pts;
  }

  // ---- Earth-shadow cylinder ---------------------------------------------------------

  var OBLIQUITY_DEG = 23.439281; // mean J2000 obliquity — matches the app's tilt elsewhere

  /** Unit vector from Earth toward the Sun, in the equatorial (z-north) frame. */
  function sunDirEquatorial(earthEl, jd) {
    var h = ORRERY.Kepler.heliocentric(earthEl, jd);
    var sx = -h.x, sy = -h.y, sz = -h.z;             // Earth → Sun, ecliptic frame
    var eps = OBLIQUITY_DEG * DEG;
    var yeq = sy * Math.cos(eps) - sz * Math.sin(eps);
    var zeq = sy * Math.sin(eps) + sz * Math.cos(eps);
    var n = Math.sqrt(sx * sx + yeq * yeq + zeq * zeq);
    return { x: sx / n, y: yeq / n, z: zeq / n };
  }

  /** True when `pos` (km, equatorial) sits inside Earth's shadow cylinder. */
  function inShadow(pos, sunDir) {
    var proj = pos.x * sunDir.x + pos.y * sunDir.y + pos.z * sunDir.z;
    if (proj >= 0) return false;                     // day side of the sun-Earth line
    var px = pos.x - proj * sunDir.x, py = pos.y - proj * sunDir.y, pz = pos.z - proj * sunDir.z;
    var perp = Math.sqrt(px * px + py * py + pz * pz);
    return perp < S().RE;
  }

  return {
    CRIT_INC_DEG: CRIT_INC_DEG,
    GPS: GPS,
    SUNSYNC: SUNSYNC,
    MOLNIYA: MOLNIYA,
    GEO_SLOTS: GEO_SLOTS,
    GRAVEYARD: GRAVEYARD,
    aFromPeriodMin: aFromPeriodMin,
    semiLatusRectumKm: semiLatusRectumKm,
    meanMotionDegPerDay: meanMotionDegPerDay,
    raanRateEccDegPerDay: raanRateEccDegPerDay,
    argPeriRateDegPerDay: argPeriRateDegPerDay,
    molniyaElements: molniyaElements,
    molniyaPosKm: molniyaPosKm,
    orbitShapeKm: orbitShapeKm,
    geoSlotPosKm: geoSlotPosKm,
    groundTrack: groundTrack,
    sunDirEquatorial: sunDirEquatorial,
    inShadow: inShadow
  };
})();
