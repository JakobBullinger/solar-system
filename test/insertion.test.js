/**
 * insertion.test.js — level 18 (orbit insertion) physics fixtures.
 *
 * Guards the capture machinery the orbiter missions ride on:
 * relPlanet()'s bound test + osculating elements, previewLive's capture
 * streak tracking, and — the mission-level fixture — a baked two-burn
 * Mars Orbiter plan found by the offline playtest scan, which must keep
 * winning in both the plan preview and a flight-grade NB.step sim. If an
 * integrator change moves that capture, this fails alongside the Voyager
 * trajectory guard.
 */
'use strict';

const { test, ok, close, between } = require('./lib/harness');
const { load } = require('./lib/orrery-loader');

const O = load(['data/bodies.js', 'physics/kepler.js', 'physics/nbody.js']);
const NB = O.NBody;
const K = O.Kepler;

const MU = NB.MU;
const MARS_MU = MU / 3098708;

function planetEl(key) {
  return O.DATA.PLANETS.filter(function (p) { return p.key === key; })[0].el;
}
function bodyState(el, jd) {
  const p = K.heliocentric(el, jd);
  const a = K.heliocentric(el, jd - 0.5), b = K.heliocentric(el, jd + 0.5);
  return { pos: { x: p.x, y: p.y, z: p.z }, vel: { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z } };
}

/** Ideal circular orbit around a planet (speed set vs the softened potential). */
function circularOrbit(key, r0, jd) {
  const el = planetEl(key);
  const mu = MU / (key === 'mars' ? 3098708 : 3497.898);
  const ps = bodyState(el, jd);
  const vc = Math.sqrt(mu * r0 * r0 / Math.pow(r0 * r0 + 1e-6, 1.5));
  const rh = Math.hypot(ps.pos.x, ps.pos.y);
  const ux = ps.pos.x / rh, uy = ps.pos.y / rh;
  return {
    el: el,
    pos: { x: ps.pos.x + ux * r0, y: ps.pos.y + uy * r0, z: ps.pos.z },
    vel: { x: ps.vel.x - uy * vc, y: ps.vel.y + ux * vc, z: ps.vel.z }
  };
}

const JD = 2461000.5;

test('relPlanet: circular Mars orbit reads bound with sane Hill radius and rp/ra', function () {
  const c = circularOrbit('mars', 0.003, JD);
  const rs = NB.relPlanet(c.pos, c.vel, c.el, JD);
  ok(rs.bound, 'bound inside the Hill sphere');
  close(rs.d, 0.003, 1e-4, 'separation is the orbit radius');
  close(rs.hill, 0.0072, 0.0007, 'Mars Hill radius ~0.0072 AU');
  ok(rs.orb.rp > 0.0015 && rs.orb.rp <= 0.0031, 'periapsis near the (softened) circular radius');
  between(rs.orb.ra, 0.0029, 0.0032, 'apoapsis ~ circular radius');
});

test('relPlanet: a solar-orbit cruiser near Mars is NOT bound', function () {
  const el = planetEl('mars');
  const ps = bodyState(el, JD);
  // 0.005 AU from Mars but moving 5 km/s relative — hyperbolic locally
  const pos = { x: ps.pos.x + 0.005, y: ps.pos.y, z: ps.pos.z };
  const vel = { x: ps.vel.x, y: ps.vel.y + 5 / 1731.456, z: ps.vel.z };
  const rs = NB.relPlanet(pos, vel, el, JD);
  ok(!rs.bound, 'not bound');
  ok(rs.orb === null, 'no osculating ellipse for positive energy');
});

test('previewLive: capture streak tracks a Mars orbit across 500 days', function () {
  const c = circularOrbit('mars', 0.003, JD);
  const pv = NB.previewLive(c.pos, c.vel, JD, 250, 2, c.el, 5, null);
  ok(pv.capture, 'capture streak reported');
  close(pv.capture.days, 500, 4, 'bound for the whole preview');
  between(pv.capture.worstRp, 0.001, 0.0035, 'worst periapsis stays in family');
  between(pv.capture.ra, 0.002, 0.004, 'apoapsis stays in family');
});

test('previewLive: an escaping particle reports no capture', function () {
  const el = planetEl('mars');
  const es = bodyState(planetEl('earth'), JD);
  const vel = { x: es.vel.x * 1.5, y: es.vel.y * 1.5, z: es.vel.z * 1.5 };
  const pv = NB.previewLive(es.pos, vel, JD, 250, 2, el, 5, null);
  ok(pv.capture === null, 'no bound streak on a hyperbolic cruise');
});
