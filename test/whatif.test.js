/**
 * whatif.test.js — Invariants for the PROMOTED n-body regime (level 20).
 *
 * When a massive body exists, Sun + planets are integrated bodies in an
 * inertial barycentric frame. These tests pin what the measurement scans
 * established (see nbody.js header): bounded energy drift, momentum
 * conservation to rounding, massless probes indistinguishable from rails
 * when the massive body is negligible, honest promote/demote round trips,
 * and kinetic-impactor deflection that grows with lead time.
 *
 * Rails bit-compatibility is enforced by the OTHER test files — they run
 * the unpromoted paths and must stay green with this feature merged.
 */
'use strict';

const { test, ok, eq, close } = require('./lib/harness');
const { load } = require('./lib/orrery-loader');

const JD0 = 2451545.0;
const MOON_MU_RATIO = 3.694e-8;      // M_moon / M_sun
const JUP_RATIO = 1047.3486;

function ctx() {
  return load(['data/bodies.js', 'physics/kepler.js', 'physics/nbody.js']);
}

function stepDays(O, jd, days) {
  for (let i = 0; i < days; i++) O.NBody.step(jd + i, 1);
}

test('promoted, unperturbed: energy drift and Mercury perihelion hold over 20 y', function () {
  const O = ctx();
  const NB = O.NBody;
  NB._dev.promote(JD0);
  const bodies = NB._dev.bodies();
  const E0 = NB._dev.systemEnergy(bodies);
  const mercury = bodies.find((b) => b.key === 'mercury');
  const sun = bodies[0];

  function periQ() {
    const rel = {
      x: mercury.pos.x - sun.pos.x, y: mercury.pos.y - sun.pos.y, z: mercury.pos.z - sun.pos.z
    };
    const vel = {
      x: mercury.vel.x - sun.vel.x, y: mercury.vel.y - sun.vel.y, z: mercury.vel.z - sun.vel.z
    };
    const d = Math.hypot(rel.x, rel.y, rel.z);
    const v2 = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
    const mu = sun.mu + mercury.mu;
    const a = -mu / (2 * (0.5 * v2 - mu / d));
    const hx = rel.y * vel.z - rel.z * vel.y;
    const hy = rel.z * vel.x - rel.x * vel.z;
    const hz = rel.x * vel.y - rel.y * vel.x;
    const e = Math.sqrt(Math.max(0, 1 - (hx * hx + hy * hy + hz * hz) / (mu * a)));
    return a * (1 - e);
  }

  const q0 = periQ();
  let maxE = 0, maxQ = 0;
  for (let y = 0; y < 20; y++) {
    stepDays(O, JD0 + y * 365, 365);
    maxE = Math.max(maxE, Math.abs((NB._dev.systemEnergy(bodies) - E0) / E0));
    maxQ = Math.max(maxQ, Math.abs(periQ() - q0) / q0);
  }
  // Measured over 1000 y at H_CAP=0.25: dE/E 1.6e-7, dq/q 2.6e-4
  ok(maxE < 1e-6, 'relative energy drift ' + maxE.toExponential(2));
  ok(maxQ < 1e-3, 'Mercury perihelion distance drift ' + maxQ.toExponential(2));
  ok(bodies.every((b) => b.alive), 'nobody died in a quiet solar system');
});

test('momentum is conserved with a massive pair stirring the system', function () {
  const O = ctx();
  const NB = O.NBody;
  O.TimeBar.jd = JD0;
  const vc = Math.sqrt(NB.MU / 2.8);
  NB.addMassive({ x: 2.8, y: 0, z: 0 }, { x: 0, y: vc, z: 0 },
    { mu: NB.MU / JUP_RATIO, radius: 4.7e-4, label: 'second Jupiter' });
  NB.addMassive({ x: -3.4, y: 0, z: 0.1 }, { x: 0, y: -Math.sqrt(NB.MU / 3.4), z: 0 },
    { mu: NB.MU / JUP_RATIO, radius: 4.7e-4, label: 'third Jupiter' });
  ok(NB.promoted, 'system promoted on first massive launch');

  // The massive pair arrives carrying its own momentum (the launch is an
  // external insertion), so |P| is small but nonzero — what must hold is
  // that it never changes again.
  const bodies = NB._dev.bodies();
  const P0 = NB._dev.systemMomentum(bodies);
  stepDays(O, JD0, 3650);
  const P1 = NB._dev.systemMomentum(bodies);
  const dP = Math.hypot(P1.x - P0.x, P1.y - P0.y, P1.z - P0.z);
  // Measured ~1e-22 (pairwise-symmetric forces); 1e-15 catches a broken pair term
  ok(dP < 1e-15, 'momentum drift over 10 y ' + dP.toExponential(2));
});

test('a massless probe cannot tell a far-away moon-mass from the rails', function () {
  // Same probe, two worlds: pure rails, and promoted by a Moon-mass parked
  // at 300 AU. Over a year the trajectories must agree to fine precision —
  // the probe's physics is the same, only the integration regime changed.
  const rails = ctx();
  O_TB(rails);
  const pR = rails.NBody.addParticle({ x: 1.3, y: 0, z: 0 }, { x: 0, y: Math.sqrt(rails.NBody.MU / 1.3), z: 0 });
  stepDays(rails, JD0, 365);

  const prom = ctx();
  O_TB(prom);
  prom.NBody.addMassive({ x: 300, y: 0, z: 0 }, { x: 0, y: Math.sqrt(prom.NBody.MU / 300), z: 0 },
    { mu: prom.NBody.MU * MOON_MU_RATIO, radius: 1.2e-5, label: 'far moon' });
  const pP = prom.NBody.addParticle({ x: 1.3, y: 0, z: 0 }, { x: 0, y: Math.sqrt(prom.NBody.MU / 1.3), z: 0 });
  stepDays(prom, JD0, 365);

  ok(pR.alive && pP.alive, 'both probes alive');
  const hP = prom.NBody.helioOf(pP);
  const dev = Math.hypot(hP.x - pR.pos.x, hP.y - pR.pos.y, hP.z - pR.pos.z);
  ok(dev < 5e-4, 'heliocentric divergence after 1 y: ' + dev.toExponential(2) + ' AU');

  function O_TB(O) { O.TimeBar.jd = JD0; }
});

test('promote → restore round trip returns the planets to their rails', function () {
  const O = ctx();
  const NB = O.NBody;
  const K = O.Kepler;
  O.TimeBar.jd = JD0;
  const p = NB.addParticle({ x: 1, y: 0, z: 0.02 }, { x: 0, y: Math.sqrt(NB.MU), z: 0 });
  const eBefore = NB.energy(p.pos, p.vel);

  NB.addMassive({ x: 5, y: 5, z: 0 }, { x: 0, y: 0.001, z: 0 },
    { mu: NB.MU * MOON_MU_RATIO, radius: 1.2e-5, label: 'pebble' });
  ok(NB.promoted, 'promoted');
  ok(NB.planetHelioAU('mars', {}), 'Mars is an integrated body while promoted');
  stepDays(O, JD0, 30);
  O.TimeBar.jd = JD0 + 30;

  NB.restore();
  ok(!NB.promoted, 'demoted');
  eq(NB.planetHelioAU('mars', {}), null, 'Mars is back on its rail');
  eq(NB.massive.length, 0, 'massive list cleared');
  ok(p.alive, 'probe survived the round trip');
  // The probe's state converts back to heliocentric: still a sane bound orbit
  const eAfter = NB.energy(p.pos, p.vel);
  close(eAfter, eBefore, Math.abs(eBefore) * 0.02, 'probe orbit energy preserved through both frame changes');
  // And rails integration keeps working afterwards
  stepDays(O, JD0 + 30, 30);
  ok(p.alive, 'rails integration continues after restore');
});

test('massive body launched at the Sun merges into it, momentum-conserving', function () {
  const O = ctx();
  const NB = O.NBody;
  O.TimeBar.jd = JD0;
  const b = NB.addMassive({ x: 0.5, y: 0.0001, z: 0 }, { x: -0.5, y: 0, z: 0 },
    { mu: NB.MU / JUP_RATIO, radius: 4.7e-4, label: 'sun-diver Jupiter' });
  const bodies = NB._dev.bodies();
  const P0 = NB._dev.systemMomentum(bodies);
  const sunMu0 = bodies[0].mu;
  stepDays(O, JD0, 10);
  ok(!b.alive, 'diver merged');
  eq(b.status, 'sun', 'merged into the Sun');
  close(bodies[0].mu, sunMu0 + NB.MU / JUP_RATIO, 1e-12, 'the Sun gained its mass');
  const P1 = NB._dev.systemMomentum(bodies);
  ok(Math.hypot(P1.x - P0.x, P1.y - P0.y, P1.z - P0.z) < 1e-15, 'merge conserved momentum');
  ok(NB.events.length > 0, 'the HUD got told');
});

test('DART drill: the baked asteroid hits Earth; deflection grows with lead time', function () {
  // Constants are baked into sandbox.js WHATIF.dart by the offline shooting
  // scan (Lambert seed + Newton against this integrator, miss 14 km).
  const W = load(['data/bodies.js', 'physics/kepler.js', 'physics/nbody.js', 'ui/sandbox.js'])
    .Sandbox._dev.WHATIF.dart;

  function flight(leadDays) {
    const O = ctx();
    const NB = O.NBody;
    O.TimeBar.jd = W.epoch;
    const ast = NB.addMassive(W.pos, W.vel,
      { mu: NB.MU * W.astRatio, radius: W.astRadius, label: 'asteroid', jd: W.epoch });
    const tof = W.encJd - W.epoch;
    const tHit = tof - (leadDays || 0);
    for (let d = 0; d < tHit && ast.alive; d++) NB.step(W.epoch + d, 1);
    if (leadDays && ast.alive) {
      // Head-on impactor, 15 km/s closing speed, 0.012 AU out
      const hp = NB.helioOf(ast, {});
      const hv = NB.helioVelOf(ast, {});
      const s = Math.hypot(hv.x, hv.y, hv.z);
      const dir = { x: hv.x / s, y: hv.y / s, z: hv.z / s };
      const rel = 15 / NB.KMS_PER_AUDAY;
      const imp = NB.addMassive(
        { x: hp.x + dir.x * 0.012, y: hp.y + dir.y * 0.012, z: hp.z + dir.z * 0.012 },
        { x: hv.x - dir.x * rel, y: hv.y - dir.y * rel, z: hv.z - dir.z * rel },
        { mu: NB.MU * W.impRatio, radius: W.impRadius, label: 'impactor' });
      for (let d = 0; d < 6 && ast.alive; d++) NB.step(W.epoch + tHit + d, 1);
      ok(!imp.alive && imp.mergedInto === ast, 'impactor struck the asteroid');
    }
    const p = ast.alive ? NB.predictApproach(ast, 'earth', (leadDays || 0) + 60) : null;
    return { ast, predict: p };
  }

  // Undeflected: the prediction machinery itself must call it an impact
  const base = flight(0);
  ok(!base.ast.alive && base.ast.mergedInto && base.ast.mergedInto.key === 'earth',
    'undeflected asteroid merged into Earth (baked trajectory holds)');

  const late = flight(80);
  const early = flight(150);
  ok(late.predict && early.predict, 'deflected runs produce predictions');
  ok(!early.predict.impact, '150 d of lead turns the impact into a miss');
  ok(early.predict.d > late.predict.d,
    'deflection grows with lead time: 150 d → ' +
    Math.round(early.predict.d * 1.496e8).toLocaleString() + ' km vs 80 d → ' +
    Math.round(late.predict.d * 1.496e8).toLocaleString() + ' km');
});

test('a heavy intruder pulls the planets off their rails (and clear() puts them back)', function () {
  const O = ctx();
  const NB = O.NBody;
  const K = O.Kepler;
  O.TimeBar.jd = JD0;
  const mars = O.DATA.PLANETS[3];
  NB.addMassive({ x: 2.2, y: 0, z: 0 }, { x: 0, y: Math.sqrt(NB.MU / 2.2), z: 0 },
    { mu: NB.MU / JUP_RATIO, radius: 4.7e-4, label: 'second Jupiter' });
  stepDays(O, JD0, 3650);
  const hm = NB.planetHelioAU('mars', {});
  const km = K.heliocentric(mars.el, JD0 + 3650);
  const dev = Math.hypot(hm.x - km.x, hm.y - km.y, hm.z - km.z);
  ok(dev > 0.01, 'Mars left its rail: ' + dev.toFixed(4) + ' AU off after 10 y next to a second Jupiter');
  NB.clear();
  ok(!NB.promoted, 'clear() demotes');
  eq(NB.planetHelioAU('mars', {}), null, 'Mars rendered from rails again');
});
