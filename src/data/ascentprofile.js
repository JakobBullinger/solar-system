/**
 * ascentprofile.js — Level "ascent ride-along": a baked pad-to-ISS launch
 * trajectory, physics tier 1 (offline-baked 2D point-mass integration —
 * see CLAUDE.md's rebake pattern and .claude/skills/rebake).
 *
 * PHYSICS HONESTY: this is a 2D point-mass simulation in the launch's own
 * orbital plane (thrust + spherical gravity + a simple exponential-atmosphere
 * drag), with real-ish Falcon-9-class numbers (two stages, μ/Isp/mass from
 * public specs) and a Newton/bisection-tuned free parameter. It is NOT a
 * high-fidelity 6-DOF guidance sim: the steering law is an explicit pitch
 * program shaped like a gravity turn (angle-from-vertical eased over a fixed
 * window) rather than closed-loop guidance, drag opposes INERTIAL velocity
 * (ignores the ~0.4 km/s the atmosphere itself carries from Earth's spin —
 * a small effect at these altitudes/speeds), and stage thrust ramps with
 * ambient pressure fraction (not a real per-second throttle table). Every
 * number that "reaches" 420 km circular was FOUND by re-running this exact
 * integrator (see rebake() below / test/ascent.test.js), never asserted.
 *
 * Sequence (mission-elapsed seconds from liftoff):
 *   stage 1 burn (thrust+gravity+drag, RK4)          0        → BURN1
 *   stage separation coast (no thrust)                BURN1    → BURN1+SEP_COAST
 *   stage 2 burn (thrust+gravity, RK4)                 …        → T_SECO (BAKED)
 *   unpowered coast to apogee (closed-form Kepler)     T_SECO   → apogee
 *   circularization burn (instantaneous, analytic Δv) at apogee
 *   parked circular orbit at 420 km, 7.66 km/s, forever after
 *
 * T_SECO (stage-2 cutoff time) is the ONE free parameter: for the fixed
 * pitch program below, apogee-of-resulting-orbit(T_SECO) is smooth and
 * monotonic in the region used, bisected here to land the transfer orbit's
 * apogee exactly at the ISS's 420 km (see rebake() and test/ascent.test.js,
 * which re-integrates and re-bisects independently as its own regression
 * guard). Found: T_SECO ≈ 429.535 s → apogee 420.6 km, perigee 126.9 km
 * (a genuine, non-degenerate transfer orbit — perigee clears the Earth, no
 * re-entry risk in the modeled physics), circularization Δv ≈ 85 m/s.
 *
 * Launch site: Cape Canaveral, 28.5°N. Target inclination 51.6° (the ISS's,
 * from ORRERY.STARLINK.ISS) requires a NE launch azimuth — spherical trig,
 * sin(azimuth) = cos(inclination)/cos(latitude) — because a ground track's
 * maximum latitude reached equals the orbit's inclination, and the launch
 * site's latitude (28.5°) must be ≤ that inclination (51.6°) for the launch
 * to reach it at all. Azimuth ≈ 45° (NE), matching real Kennedy/Canaveral
 * ISS-bound launches.
 *
 * Rendezvous framing: the module also picks a plane (RAAN) and launch epoch
 * so the finished circular orbit sits in the SAME orbital plane as the
 * (real, propagated) ISS model in starlink.js, a chosen RENDEZVOUS_GAP_DEG
 * of along-track separation ahead of the rocket — "alongside", not docked.
 * This is itself found by solving the ISS's own (real) mean-motion/RAAN
 * formulas for the epoch, not asserted.
 *
 * No THREE, no DOM — loads in plain node (test/ascent.test.js), same
 * pattern as data/starlink.js. Depends on ORRERY.STARLINK for μ, R⊕, the
 * ISS's real model and epoch — load order in build.js keeps starlink.js
 * first.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.AscentProfile = (function () {
  'use strict';

  var S = ORRERY.STARLINK;
  var MU = S.MU;               // km^3/s^2 — same Earth model as starlink.js
  var RE = S.RE;                // km
  var G0 = 9.80665e-3;          // km/s^2

  // --- Launch site / target plane -------------------------------------------------
  var LAUNCH_LAT_DEG = 28.5;                 // Cape Canaveral
  var TARGET_INC_DEG = S.ISS.incDeg;         // 51.6° — the ISS's real inclination
  var TARGET_APOGEE_KM = S.ISS.altKm;        // 420 km — the ISS's real altitude
  var DEG = Math.PI / 180;
  // sin(az) = cos(i)/cos(lat): the ground-track-max-latitude relation.
  var AZIMUTH_DEG = Math.asin(Math.cos(TARGET_INC_DEG * DEG) / Math.cos(LAUNCH_LAT_DEG * DEG)) / DEG;

  // --- Vehicle (Falcon-9-class, real-ish public specs) ----------------------------
  var M1_DRY = 25600, M1_PROP = 411000;          // kg — stage 1 (9 Merlin 1D)
  var M2_DRY = 4500, M2_PROP = 92670;            // kg — stage 2 (1 Merlin Vacuum)
  var BURN1 = 155;                                // s — stage-1 burn duration (design constant)
  var MDOT1 = M1_PROP / BURN1;                    // kg/s
  var ISP1_SL = 282, ISP1_VAC = 311;              // s — Merlin 1D sea-level/vacuum
  var SEP_COAST = 4;                              // s — stage separation, unpowered
  var MDOT2 = 273.7;                              // kg/s — Merlin Vacuum flow rate
  var ISP2 = 348;                                 // s — vacuum only (stage 2 never sees dense air)

  // --- Atmosphere / drag (simple exponential model) -------------------------------
  var RHO0 = 1.225, ATMO_H = 8500;                // kg/m^3, m — sea-level density, scale height
  var CD = 0.3, AREA = 10.75;                     // drag coefficient, m^2 (~3.7 m diameter)
  var CDA = CD * AREA;

  // --- Pitch program (gravity-turn-SHAPED steering, not closed-loop guidance) -----
  var T_VERT = 10;                                // s — straight up off the pad
  var PITCH_T1 = 150;                             // s — window over which pitch eases in
  var THETA_MAX_DEG = 82;                         // ° from vertical at the end of the window

  // --- The one baked free parameter ------------------------------------------------
  var T_SECO = 429.535;                            // s — found by bisection, see rebake() below
  var INTEGRATION_DT = 0.01;                       // s — RK4 step for the baked run (converged:
                                                    // 0.05/0.02/0.01/0.005 s agree on apogee within ~1 km)

  var RENDEZVOUS_GAP_DEG = 1.5;                    // ° along-track — "alongside", not docked

  function smoothstep(f) { f = f < 0 ? 0 : f > 1 ? 1 : f; return f * f * (3 - 2 * f); }
  function pitchAngle(t) {
    if (t < T_VERT) return 0;
    return (THETA_MAX_DEG * DEG) * smoothstep((t - T_VERT) / (PITCH_T1 - T_VERT));
  }
  function pressureFraction(altKm) { return Math.exp(-Math.max(altKm, 0) * 1000 / ATMO_H); }
  function rho(altKm) { return RHO0 * pressureFraction(altKm); }
  /** Thrust (kN) from a fixed mass flow + altitude-interpolated Isp: F = mdot·Isp·g0. */
  function thrustKN(mdot, ispSl, ispVac, altKm) {
    var isp = ispVac - (ispVac - ispSl) * pressureFraction(altKm);
    return mdot * isp * G0;
  }

  /** phase(t) -> 'stage1' | 'sep' | 'stage2' | 'coast', for a given SECO cutoff. */
  function phaseAt(t, tSeco) {
    if (t < BURN1) return 'stage1';
    if (t < BURN1 + SEP_COAST) return 'sep';
    if (t < tSeco) return 'stage2';
    return 'coast';
  }

  /** State derivative: y = [x, y, vx, vy, m] (km, km, km/s, km/s, kg). */
  function derivative(t, y, tSeco) {
    var x = y[0], yy = y[1], m = y[4];
    var r = Math.sqrt(x * x + yy * yy), alt = r - RE;
    var vx = y[2], vy = y[3], v = Math.sqrt(vx * vx + vy * vy);
    var rHatX = x / r, rHatY = yy / r;
    var hHatX = -yy / r, hHatY = x / r;   // prograde tangential (CCW travel)
    var th = pitchAngle(t);
    var dirX = Math.cos(th) * rHatX + Math.sin(th) * hHatX;
    var dirY = Math.cos(th) * rHatY + Math.sin(th) * hHatY;

    var thrustMag = 0, mdot = 0;
    var phase = phaseAt(t, tSeco);
    if (phase === 'stage1') { mdot = MDOT1; thrustMag = thrustKN(MDOT1, ISP1_SL, ISP1_VAC, alt); }
    else if (phase === 'stage2') { mdot = MDOT2; thrustMag = thrustKN(MDOT2, ISP2, ISP2, alt); }

    var g = -MU / (r * r * r);
    var agX = g * x, agY = g * yy;
    var atX = (thrustMag / m) * dirX, atY = (thrustMag / m) * dirY;
    var adX = 0, adY = 0;
    if (alt < 100 && v > 1e-9) {
      var vms = v * 1000;
      var fN = 0.5 * rho(alt) * vms * vms * CDA;             // N
      var aKms2 = fN / m / 1e6;                              // km/s^2
      adX = -aKms2 * vx / v; adY = -aKms2 * vy / v;
    }
    return [vx, vy, agX + atX + adX, agY + atY + adY, -mdot];
  }

  function rk4Step(t, y, dt, tSeco) {
    var k1 = derivative(t, y, tSeco);
    var y2 = [y[0] + k1[0] * dt / 2, y[1] + k1[1] * dt / 2, y[2] + k1[2] * dt / 2, y[3] + k1[3] * dt / 2, y[4] + k1[4] * dt / 2];
    var k2 = derivative(t + dt / 2, y2, tSeco);
    var y3 = [y[0] + k2[0] * dt / 2, y[1] + k2[1] * dt / 2, y[2] + k2[2] * dt / 2, y[3] + k2[3] * dt / 2, y[4] + k2[4] * dt / 2];
    var k3 = derivative(t + dt / 2, y3, tSeco);
    var y4 = [y[0] + k3[0] * dt, y[1] + k3[1] * dt, y[2] + k3[2] * dt, y[3] + k3[3] * dt, y[4] + k3[4] * dt];
    var k4 = derivative(t + dt, y4, tSeco);
    var out = new Array(5);
    for (var i = 0; i < 5; i++) out[i] = y[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    return out;
  }

  /**
   * Integrate liftoff → tSeco with the LIVE integrator (RK4, thrust+gravity+
   * drag). Returns milestones (liftoff, max-Q, stage-1 cutoff, SECO) and a
   * decimated sample list {t,x,y,vx,vy,m,alt,speed} for playback, plus the
   * exact final state vector. This is the function both rebake() (the
   * offline search) and test/ascent.test.js (the pin) call — there is no
   * separate "private" integrator; what ships is what was searched.
   */
  function poweredFlight(tSeco, dt, sampleEvery) {
    dt = dt || INTEGRATION_DT;
    sampleEvery = sampleEvery || 20;   // store one sample per N steps (~0.2 s @ dt=0.01)
    var m0 = M1_DRY + M1_PROP + M2_DRY + M2_PROP;
    var y = [RE, 0, 0, 0, m0], t = 0, staged = false, step = 0;
    var milestones = { liftoff: { t: 0, alt: 0, v: 0 } };
    var maxQ = { q: 0, alt: 0, t: 0 };
    var samples = [];

    function pushSample() {
      var r = Math.sqrt(y[0] * y[0] + y[1] * y[1]);
      samples.push({ t: t, x: y[0], y: y[1], vx: y[2], vy: y[3], m: y[4], alt: r - RE, speed: Math.sqrt(y[2] * y[2] + y[3] * y[3]) });
    }
    pushSample();

    while (t < tSeco - dt / 2) {
      var r = Math.sqrt(y[0] * y[0] + y[1] * y[1]), alt = r - RE;
      var v = Math.sqrt(y[2] * y[2] + y[3] * y[3]);
      if (!staged && t >= BURN1) {
        y[4] -= M1_DRY;   // jettison stage-1 dry mass at MECO
        staged = true;
        milestones.stage1Cutoff = { t: t, alt: alt, v: v };
      }
      if (alt < 60) {
        var q = 0.5 * rho(alt) * (v * 1000) * (v * 1000);   // Pa
        if (q > maxQ.q) maxQ = { q: q, alt: alt, t: t };
      }
      y = rk4Step(t, y, dt, tSeco);
      t += dt;
      step++;
      if (step % sampleEvery === 0) pushSample();
    }
    var rf = Math.sqrt(y[0] * y[0] + y[1] * y[1]), vf = Math.sqrt(y[2] * y[2] + y[3] * y[3]);
    milestones.seco = { t: tSeco, alt: rf - RE, v: vf, m: y[4] };
    pushSample();

    return { finalState: y, milestones: milestones, maxQ: maxQ, samples: samples, tSeco: tSeco };
  }

  /** Classical 2D orbital elements from a geocentric state vector. */
  function elementsFromState(x, y, vx, vy) {
    var r = Math.sqrt(x * x + y * y), v2 = vx * vx + vy * vy;
    var energy = v2 / 2 - MU / r;
    var a = -MU / (2 * energy);
    var h = x * vy - y * vx;                       // specific angular momentum (2D scalar)
    var e = Math.sqrt(Math.max(0, 1 - (h * h) / (MU * a)));
    var rdot = (x * vx + y * vy) / r;
    var cosNu = e > 1e-9 ? Math.min(1, Math.max(-1, (a * (1 - e * e) / r - 1) / e)) : 1;
    var nu = Math.acos(cosNu);
    if (rdot < 0) nu = 2 * Math.PI - nu;
    var theta = Math.atan2(y, x);
    var omega = theta - nu;
    return { a: a, e: e, nu0: nu, omega: omega, h: h };
  }

  /** Closed-form Kepler propagation of a 2D conic by dtSeconds from nu0. */
  function keplerPropagate(el, dtSeconds) {
    var n = Math.sqrt(MU / (el.a * el.a * el.a));
    var E0 = 2 * Math.atan2(Math.sqrt(1 - el.e) * Math.sin(el.nu0 / 2), Math.sqrt(1 + el.e) * Math.cos(el.nu0 / 2));
    var M0 = E0 - el.e * Math.sin(E0);
    var M = M0 + n * dtSeconds;
    var E = M;   // Newton from E0=M: fine for the low eccentricities here (e < 0.1)
    for (var i = 0; i < 20; i++) {
      var f = E - el.e * Math.sin(E) - M;
      var fp = 1 - el.e * Math.cos(E);
      var dE = f / fp;
      E -= dE;
      if (Math.abs(dE) < 1e-12) break;
    }
    var r = el.a * (1 - el.e * Math.cos(E));
    var nu = 2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E / 2), Math.sqrt(1 - el.e) * Math.cos(E / 2));
    var theta = el.omega + nu;
    var rdot = (n * el.a * el.e * Math.sin(E)) / (1 - el.e * Math.cos(E));
    var rnudot = el.h / r;   // r·dθ/dt = h/r
    var x = r * Math.cos(theta), y = r * Math.sin(theta);
    var vx = rdot * Math.cos(theta) - rnudot * Math.sin(theta);
    var vy = rdot * Math.sin(theta) + rnudot * Math.cos(theta);
    return { x: x, y: y, vx: vx, vy: vy, r: r, speed: Math.sqrt(vx * vx + vy * vy), theta: theta, nu: nu };
  }

  /** Time from nu0 to apogee (nu=π) along a conic with mean motion n. */
  function timeToApogee(el) {
    var n = Math.sqrt(MU / (el.a * el.a * el.a));
    var E0 = 2 * Math.atan2(Math.sqrt(1 - el.e) * Math.sin(el.nu0 / 2), Math.sqrt(1 + el.e) * Math.cos(el.nu0 / 2));
    var M0 = E0 - el.e * Math.sin(E0);
    return (Math.PI - M0) / n;   // apogee: E=π, M=π
  }

  /**
   * Bisect T_SECO so the resulting transfer orbit's apogee lands exactly at
   * targetApogeeKm. This is what FOUND the 429.535 s baked above — kept here
   * (not thrown away, per the rebake pattern) so the pin test can re-derive
   * it independently rather than trust the hardcoded constant blindly.
   */
  function bisectSeco(targetApogeeKm, dt) {
    var target = RE + targetApogeeKm;
    function apogeeR(tSeco) {
      var f = poweredFlight(tSeco, dt, 1e9).finalState;   // sampleEvery huge: skip sample storage
      var el = elementsFromState(f[0], f[1], f[2], f[3]);
      return el.a * (1 + el.e);
    }
    var lo = BURN1 + SEP_COAST + 5, hi = BURN1 + SEP_COAST + (M2_PROP / MDOT2) * 0.98;
    var eLo = apogeeR(lo) - target, eHi = apogeeR(hi) - target;
    if ((eLo > 0) === (eHi > 0)) {
      // fall back to a narrower bracket around the known-good region
      lo = 427; hi = 430.5;
      eLo = apogeeR(lo) - target; eHi = apogeeR(hi) - target;
    }
    for (var i = 0; i < 30; i++) {
      var mid = (lo + hi) / 2, eMid = apogeeR(mid) - target;
      if ((eMid > 0) === (eLo > 0)) { lo = mid; eLo = eMid; } else { hi = mid; }
    }
    return (lo + hi) / 2;
  }

  /** In-plane (x,y) km -> equatorial ECI km, same rotation convention as starlink.js satPosKm. */
  function toECI(x, y, incDeg, omegaAscDeg) {
    var r = Math.sqrt(x * x + y * y), u = Math.atan2(y, x);
    var inc = incDeg * DEG, raan = omegaAscDeg * DEG;
    var ci = Math.cos(inc), si = Math.sin(inc);
    var cO = Math.cos(raan), sO = Math.sin(raan);
    var cu = Math.cos(u), su = Math.sin(u);
    return {
      x: r * (cO * cu - sO * su * ci),
      y: r * (sO * cu + cO * su * ci),
      z: r * (su * si)
    };
  }

  /**
   * The bake: run the powered flight, derive the coast/circularization/
   * rendezvous framing, and package one PROFILE object. Runs once at module
   * load (a few tens of ms — ~43k RK4 steps at dt=0.01 over T_SECO≈430 s).
   */
  function build() {
    var flight = poweredFlight(T_SECO, INTEGRATION_DT);
    var f = flight.finalState;
    var el = elementsFromState(f[0], f[1], f[2], f[3]);
    var rApo = el.a * (1 + el.e), rPeri = el.a * (1 - el.e);
    var vApo = el.h / rApo;
    var vCirc = Math.sqrt(MU / rApo);
    var tToApogee = timeToApogee(el);
    var thetaApogeeDeg = ((el.omega + Math.PI) / DEG) % 360;
    var missionDurationSeconds = T_SECO + tToApogee;

    // Rendezvous framing: pick the ISS epoch whose real (starlink.js) argument
    // of latitude sits RENDEZVOUS_GAP_DEG ahead of our circularization point,
    // then set our own plane's RAAN to the ISS's real RAAN at that instant —
    // same inclination + same RAAN + a small along-track gap = "alongside".
    var targetUdeg = ((thetaApogeeDeg - RENDEZVOUS_GAP_DEG) % 360 + 360) % 360;
    var nIssRadPerDay = S.meanMotion(TARGET_APOGEE_KM);
    var periodDays = S.periodMin(TARGET_APOGEE_KM) / 1440;
    var dtDays = (targetUdeg * DEG) / nIssRadPerDay;
    dtDays = ((dtDays % periodDays) + periodDays) % periodDays;
    var jdInsert = S.EPOCH + dtDays;
    var omegaAscentDeg = S.raanRateDegPerDay(TARGET_APOGEE_KM, TARGET_INC_DEG) * dtDays;
    var jd0 = jdInsert - missionDurationSeconds / 86400;

    var milestones = flight.milestones;
    milestones.stageIgnition2 = { t: BURN1 + SEP_COAST };
    milestones.apogee = { t: missionDurationSeconds, alt: rApo - RE, v: vApo };
    milestones.circularization = {
      t: missionDurationSeconds, dv: vCirc - vApo, altKm: rApo - RE, vBefore: vApo, vAfter: vCirc
    };
    milestones.finalOrbit = { altKm: rApo - RE, v: vCirc, periodMin: S.periodMin(rApo - RE) };

    return {
      constants: {
        BURN1: BURN1, SEP_COAST: SEP_COAST, T_SECO: T_SECO, THETA_MAX_DEG: THETA_MAX_DEG,
        PITCH_T1: PITCH_T1, T_VERT: T_VERT, AZIMUTH_DEG: AZIMUTH_DEG,
        LAUNCH_LAT_DEG: LAUNCH_LAT_DEG, TARGET_INC_DEG: TARGET_INC_DEG, TARGET_APOGEE_KM: TARGET_APOGEE_KM,
        RENDEZVOUS_GAP_DEG: RENDEZVOUS_GAP_DEG
      },
      milestones: milestones,
      maxQ: flight.maxQ,
      elements: el,
      apogee: { r: rApo, alt: rApo - RE, v: vApo, t: missionDurationSeconds },
      perigeeAltKm: rPeri - RE,
      vCirc: vCirc,
      tToApogee: tToApogee,
      missionDurationSeconds: missionDurationSeconds,
      omegaAscentDeg: omegaAscentDeg,
      jdInsert: jdInsert,
      jd0: jd0,
      poweredSamples: flight.samples
    };
  }

  var PROFILE = build();

  /**
   * Rocket state at mission-elapsed seconds `t` (0 at liftoff). Powered
   * phase interpolates the baked samples; coast is exact closed-form Kepler;
   * past the mission end it keeps circling at the final circular rate
   * forever (the "parked alongside the ISS" epilogue) — one function for
   * the whole ride, ascent.js never special-cases the ending.
   */
  function stateAtMissionTime(t) {
    if (t <= PROFILE.constants.T_SECO) {
      var s = PROFILE.poweredSamples;
      if (t <= s[0].t) return sampleToState(s[0], phaseLabel(t));
      for (var i = 1; i < s.length; i++) {
        if (t <= s[i].t) {
          var a = s[i - 1], b = s[i], f = (t - a.t) / (b.t - a.t || 1);
          return {
            t: t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f,
            alt: a.alt + (b.alt - a.alt) * f, speed: a.speed + (b.speed - a.speed) * f,
            m: a.m + (b.m - a.m) * f, phase: phaseLabel(t)
          };
        }
      }
      var last = s[s.length - 1];
      return sampleToState(last, phaseLabel(t));
    }
    if (t < PROFILE.missionDurationSeconds) {
      var k = keplerPropagate(PROFILE.elements, t - PROFILE.constants.T_SECO);
      return { t: t, x: k.x, y: k.y, alt: k.r - RE, speed: k.speed, m: PROFILE.milestones.seco.m, phase: 'coast' };
    }
    // Parked: circular orbit continuing indefinitely from the circularization point.
    // (t >= missionDurationSeconds here; at the exact instant this is continuous with
    // the coast branch above — same r, same speed, purely tangential.)
    var nFinal = Math.sqrt(MU / (PROFILE.apogee.r * PROFILE.apogee.r * PROFILE.apogee.r));
    var thetaFinal = PROFILE.elements.omega + Math.PI + nFinal * (t - PROFILE.missionDurationSeconds);
    var rFinal = PROFILE.apogee.r;
    return {
      t: t, x: rFinal * Math.cos(thetaFinal), y: rFinal * Math.sin(thetaFinal),
      alt: rFinal - RE, speed: PROFILE.vCirc, m: PROFILE.milestones.seco.m, phase: 'parked'
    };
  }
  function sampleToState(s, phase) {
    return { t: s.t, x: s.x, y: s.y, alt: s.alt, speed: s.speed, m: s.m, phase: phase };
  }
  function phaseLabel(t) {
    var c = PROFILE.constants;
    if (t < c.T_VERT) return 'liftoff';
    if (t < c.BURN1) return 'stage1';
    if (t < c.BURN1 + c.SEP_COAST) return 'sep';
    return 'stage2';
  }

  return {
    MU: MU, RE: RE,
    poweredFlight: poweredFlight,
    elementsFromState: elementsFromState,
    keplerPropagate: keplerPropagate,
    timeToApogee: timeToApogee,
    bisectSeco: bisectSeco,
    toECI: toECI,
    stateAtMissionTime: stateAtMissionTime,
    PROFILE: PROFILE
  };
})();
