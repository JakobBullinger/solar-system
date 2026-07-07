/**
 * ascent.test.js — the ascent ride-along's baked trajectory, pinned.
 *
 * Physics tier: offline-baked 2D point-mass integration (thrust + spherical
 * gravity + a simple exponential-atmosphere drag), Newton/bisection-tuned —
 * see src/data/ascentprofile.js's header and .claude/skills/rebake. This
 * test re-integrates through the SAME live integrator the module ships
 * (poweredFlight), independently re-bisects the SECO cutoff, and asserts
 * physical milestones with honest tolerances — never raw state vectors.
 */
'use strict';

const { test, ok, close, between } = require('./lib/harness');
const { load } = require('./lib/orrery-loader');

const O = load(['data/starlink.js', 'data/ascentprofile.js']);
const A = O.AscentProfile;
const S = O.STARLINK;
const P = A.PROFILE;

test('liftoff starts at rest at the pad', function () {
  close(P.milestones.liftoff.alt, 0, 1e-6, 'liftoff altitude');
  close(P.milestones.liftoff.v, 0, 1e-6, 'liftoff speed ~0 km/s');
});

test('max dynamic pressure occurs in the 10-15 km band (real ascent max-Q)', function () {
  between(P.maxQ.alt, 10, 15, 'max-Q altitude band');
  ok(P.maxQ.q > 15000 && P.maxQ.q < 55000, 'max-Q magnitude plausible (Pa), got ' + P.maxQ.q);
});

test('stage-1 cutoff (MECO) lands in a plausible real-ascent band', function () {
  close(P.constants.BURN1, 155, 1e-9, 'stage-1 burn duration design constant');
  between(P.milestones.stage1Cutoff.alt, 50, 130, 'MECO altitude band');
  between(P.milestones.stage1Cutoff.v, 2.0, 4.5, 'MECO speed band (km/s)');
  between(P.milestones.stage1Cutoff.t, 140, 170, 'MECO time band (s)');
});

test('stage separation is a brief unpowered coast before stage-2 ignition', function () {
  close(P.milestones.stageIgnition2.t, P.constants.BURN1 + P.constants.SEP_COAST, 1e-9, 'ignition-2 time');
  ok(P.constants.SEP_COAST > 0 && P.constants.SEP_COAST < 15, 'sep coast is a few seconds');
});

test('orbital insertion: circularized speed matches the ISS handbook value at 420 km', function () {
  close(P.milestones.finalOrbit.altKm, 420, 3, 'circularized altitude ~420 km');
  close(P.milestones.finalOrbit.v, 7.66, 0.02, 'circular speed ~7.66 km/s (earthorbit.test.js pins the same number)');
  close(P.milestones.finalOrbit.v, S.vCirc(P.milestones.finalOrbit.altKm), 1e-6, 'matches vis-viva at that altitude exactly');
});

test('the transfer orbit is real: perigee clears the Earth, apogee is the ISS altitude', function () {
  ok(P.perigeeAltKm > 0, 'perigee altitude positive (no re-entry in the modeled physics), got ' + P.perigeeAltKm);
  close(P.apogee.alt, 420, 3, 'transfer-orbit apogee ~420 km');
  ok(P.elements.e > 0 && P.elements.e < 0.2, 'modestly eccentric transfer orbit, e=' + P.elements.e);
});

test('circularization burn is a small, realistic trim (tens to a few hundred m/s)', function () {
  between(P.milestones.circularization.dv * 1000, 20, 400, 'circularization Δv in m/s, got ' +
    (P.milestones.circularization.dv * 1000).toFixed(1));
});

test('final orbit is circular within tolerance: re-propagating post-circ state gives constant radius', function () {
  // Purely tangential velocity at v_circ, at r = apogee radius -> a == r, e == 0.
  const r = P.apogee.r, v = P.vCirc;
  const el = A.elementsFromState(r, 0, 0, v);   // place at (r,0) moving +y (tangential)
  close(el.a, r, 1e-6, 'semi-major axis equals the circular radius');
  close(el.e, 0, 1e-6, 'eccentricity ~0');
  // Propagate a quarter and a half orbit forward: radius must not change.
  const T = 2 * Math.PI * Math.sqrt(r * r * r / A.MU);
  [T / 4, T / 2, 0.9 * T].forEach(function (dt) {
    const k = A.keplerPropagate(el, dt);
    close(k.r, r, 1e-3, 'radius constant through the orbit at dt=' + dt);
    close(k.speed, v, 1e-6, 'speed constant through the orbit at dt=' + dt);
  });
});

test('independent re-bisection reproduces the baked SECO cutoff (the rebake pin)', function () {
  const found = A.bisectSeco(420, 0.1);   // coarser+faster dt than the shipped bake, still converges
  close(found, P.constants.T_SECO, 1, 'bisection reproduces the baked T_SECO within 1 s');
});

test('re-integrating the baked T_SECO at a different step size still reaches ~420 km apogee', function () {
  // Robustness check (rebake skill: verify at flight AND preview step sizes).
  [0.02, 0.005].forEach(function (dt) {
    const flight = A.poweredFlight(P.constants.T_SECO, dt);
    const el = A.elementsFromState(flight.finalState[0], flight.finalState[1], flight.finalState[2], flight.finalState[3]);
    const apogeeAlt = el.a * (1 + el.e) - A.RE;
    close(apogeeAlt, 420, 5, 'apogee altitude stable across dt=' + dt);
  });
});

test('launch azimuth is the real spherical-trig solution for a 51.6 deg ISS-compatible inclination from 28.5N', function () {
  close(P.constants.LAUNCH_LAT_DEG, 28.5, 1e-9, 'Cape Canaveral latitude');
  close(P.constants.TARGET_INC_DEG, S.ISS.incDeg, 1e-9, 'targets the real ISS inclination');
  const rad = Math.PI / 180;
  const expected = Math.asin(Math.cos(P.constants.TARGET_INC_DEG * rad) / Math.cos(P.constants.LAUNCH_LAT_DEG * rad)) / rad;
  close(P.constants.AZIMUTH_DEG, expected, 1e-6, 'azimuth matches sin(az)=cos(i)/cos(lat)');
  between(P.constants.AZIMUTH_DEG, 40, 50, 'azimuth is a real NE Canaveral-ISS launch azimuth (~45 deg)');
  ok(P.constants.LAUNCH_LAT_DEG <= P.constants.TARGET_INC_DEG, 'launch site latitude must not exceed the target inclination');
});

test('the ride ends near the ISS: same plane (inclination+RAAN), small along-track gap', function () {
  const finalState = A.stateAtMissionTime(P.missionDurationSeconds);
  const eci = A.toECI(finalState.x, finalState.y, P.constants.TARGET_INC_DEG, P.omegaAscentDeg);
  const issPos = S.satPosKm({ altKm: S.ISS.altKm, incDeg: S.ISS.incDeg, planes: 1, perPlane: 1, f: 0 }, 0, 0, P.jdInsert);
  const sep = Math.hypot(eci.x - issPos.x, eci.y - issPos.y, eci.z - issPos.z);
  ok(sep > 20, 'genuinely alongside, not docked at the exact same point, got ' + sep + ' km');
  ok(sep < 400, 'close enough to read as "alongside" at this scale, got ' + sep + ' km');
  // Both on the real ISS shell radius, honestly.
  close(Math.hypot(eci.x, eci.y, eci.z), S.radiusKm(S.ISS.altKm), 1, 'rocket parks on the real ISS shell radius');
});

test('stateAtMissionTime is continuous across every phase boundary and holds forever after', function () {
  const c = P.constants;
  const boundaries = [0, c.T_VERT, c.BURN1, c.BURN1 + c.SEP_COAST, c.T_SECO, P.missionDurationSeconds];
  boundaries.forEach(function (t) {
    const before = A.stateAtMissionTime(Math.max(0, t - 0.01));
    const after = A.stateAtMissionTime(t + 0.01);
    ok(Math.abs(after.alt - before.alt) < 5, 'altitude continuous near t=' + t + ' (Δ=' + Math.abs(after.alt - before.alt) + ')');
  });
  const parked1 = A.stateAtMissionTime(P.missionDurationSeconds + 500);
  const parked2 = A.stateAtMissionTime(P.missionDurationSeconds + 5000);
  close(parked1.alt, 420, 3, 'stays parked at ~420 km long after the ride ends');
  close(parked2.alt, 420, 3, 'stays parked indefinitely');
  close(parked1.speed, P.vCirc, 1e-6, 'parked speed is exactly the circular speed');
});
