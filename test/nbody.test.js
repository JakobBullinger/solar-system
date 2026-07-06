/**
 * nbody.test.js — Integrator invariants for the restricted n-body engine.
 *
 * The leapfrog must (a) hold energy on a circular orbit, (b) be
 * time-symmetric so scrubbing the timebar backwards retraces the path, and
 * (c) kill sun-divers via the swept-segment test rather than letting a fast
 * step jump across the kill sphere.
 */
'use strict';

const { test, ok, eq, close } = require('./lib/harness');
const { load } = require('./lib/orrery-loader');

const JD0 = 2451545.0;

/** Fresh pure two-body context: no planets, only the Sun's gravity. */
function pureContext() {
  return load(['physics/kepler.js', 'physics/nbody.js'], {
    setup: function (ctx) { ctx.ORRERY = { DATA: { PLANETS: [] } }; }
  });
}
/** Fresh full context with the real eight perturbing planets. */
function fullContext() {
  return load(['data/bodies.js', 'physics/kepler.js', 'physics/nbody.js']);
}

test('circular orbit, Sun only: energy drift < 1e-8 over one year', function () {
  const NB = pureContext().NBody;
  const p = NB.addParticle({ x: 1, y: 0, z: 0 }, { x: 0, y: Math.sqrt(NB.MU), z: 0 });
  const E0 = NB.energy(p.pos, p.vel);
  let maxDrift = 0, maxRdev = 0;
  for (let i = 0; i < 365; i++) {
    NB.step(JD0 + i, 1);
    maxDrift = Math.max(maxDrift, Math.abs((NB.energy(p.pos, p.vel) - E0) / E0));
    const r = Math.sqrt(p.pos.x * p.pos.x + p.pos.y * p.pos.y + p.pos.z * p.pos.z);
    maxRdev = Math.max(maxRdev, Math.abs(r - 1));
  }
  ok(p.alive, 'still orbiting');
  // Measured ~1.5e-10; 1e-8 leaves headroom without hiding a broken kick
  ok(maxDrift < 1e-8, 'relative energy drift ' + maxDrift.toExponential(2));
  ok(maxRdev < 1e-4, 'circular radius held, max deviation ' + maxRdev.toExponential(2));
});

test('circular orbit, real planets: solar-energy wobble stays perturbation-sized', function () {
  const NB = fullContext().NBody;
  const vc = Math.sqrt(NB.MU / 1.3);
  const p = NB.addParticle({ x: 1.3, y: 0, z: 0 }, { x: 0, y: vc, z: 0 });
  const E0 = NB.energy(p.pos, p.vel);
  let maxDrift = 0;
  for (let i = 0; i < 365; i++) {
    NB.step(JD0 + i, 1);
    maxDrift = Math.max(maxDrift, Math.abs((NB.energy(p.pos, p.vel) - E0) / E0));
  }
  ok(p.alive, 'still orbiting');
  // Two-body energy is not conserved with planets pulling, but the wobble
  // must stay at genuine-perturbation scale (measured ~7e-5)
  ok(maxDrift < 5e-4, 'relative energy wobble ' + maxDrift.toExponential(2));
});

test('time symmetry: 60 days forward then 60 back returns to the start', function () {
  const NB = fullContext().NBody;
  const p = NB.addParticle(
    { x: 1, y: 0, z: 0.05 },
    { x: 0, y: 1.1 * Math.sqrt(NB.MU), z: 0 });
  const start = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
  const N = 60;
  for (let i = 0; i < N; i++) NB.step(JD0 + i, 1);
  for (let i = 0; i < N; i++) NB.step(JD0 + N - i, -1);
  const err = Math.sqrt(
    Math.pow(p.pos.x - start.x, 2) +
    Math.pow(p.pos.y - start.y, 2) +
    Math.pow(p.pos.z - start.z, 2));
  ok(p.alive, 'survived the round trip');
  // Measured ~1e-16 (leapfrog is reversible to rounding); 1e-9 catches any
  // asymmetric term someone slips into the kick-drift-kick
  ok(err < 1e-9, 'return error ' + err.toExponential(2) + ' AU');
});

test('fast sun-diver dies via the swept segment, not by stepping across', function () {
  const NB = fullContext().NBody;
  // 1 AU/day straight at the Sun, offset 0.0005 AU: every integration point
  // lies OUTSIDE the 0.008 AU kill sphere, only the segment sweeps through it
  const p = NB.addParticle({ x: 0.1, y: 0.0005, z: 0 }, { x: -1, y: 0, z: 0 });
  NB.step(JD0, 1);
  ok(!p.alive, 'diver was killed');
  eq(p.status, 'sun', 'died to the Sun');
  eq(NB.lost.sun, 1, 'sun-loss counter incremented');
  const r = Math.sqrt(p.pos.x * p.pos.x + p.pos.y * p.pos.y + p.pos.z * p.pos.z);
  ok(r > 0.008, 'final point outside the kill sphere (' + r.toFixed(4) +
    ' AU) — the sweep test caught the crossing');
});

test('slow sun-diver from 2.2 AU-style fall also dies at perihelion', function () {
  const NB = fullContext().NBody;
  const vc = Math.sqrt(NB.MU / 0.9);
  const p = NB.addParticle({ x: 0.9, y: 0, z: 0 }, { x: 0, y: 0.05 * vc, z: 0 });
  for (let i = 0; i < 80 && p.alive; i++) NB.step(JD0 + i, 1);
  ok(!p.alive, 'diver was killed');
  eq(p.status, 'sun', 'died to the Sun');
  ok(p.minR < 0.01, 'perihelion was resolved, minR ' + p.minR.toExponential(2));
});

test('time-teleports (>30 days) are not integrated', function () {
  const NB = fullContext().NBody;
  const p = NB.addParticle({ x: 1, y: 0, z: 0 }, { x: 0, y: Math.sqrt(NB.MU), z: 0 });
  NB.step(JD0, 31);
  close(p.pos.x, 1, 1e-12, 'position untouched by a "Today" jump');
  close(p.pos.y, 0, 1e-12);
});

test('escape: a particle past 80 AU is flagged escaped', function () {
  const NB = fullContext().NBody;
  const p = NB.addParticle({ x: 79.9, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  NB.step(JD0, 1);
  ok(!p.alive, 'particle removed');
  eq(p.status, 'escaped');
  eq(NB.lost.escaped, 1, 'escape counter incremented');
});
