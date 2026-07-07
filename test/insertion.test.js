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
const { load, readSource } = require('./lib/orrery-loader');

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

// ---- Baked champion plans (offline playtest scan, 2026-07-06) ----------------
// The pars in missions.js were set from these scan minima; each plan was
// jitter-robust 36/36 across playback rates 10/20/40. Like the Voyager
// guard, they re-fly here against the real integrator: if an nbody/kepler
// change breaks these captures, the missions ship unwinnable.

/** Pull an orbiter mission's win criteria out of missions.js source. */
function missionDef(key) {
  const src = readSource('ui/missions.js');
  const m = src.match(new RegExp("key: '" + key + "'[\\s\\S]*?desc:"));
  ok(m, key + ' mission found in missions.js');
  const num = function (field) {
    const f = m[0].match(new RegExp(field + ':\\s*([\\d.]+)'));
    ok(f, key + '.' + field + ' parsed');
    return parseFloat(f[1]);
  };
  return {
    rpMax: num('rpMax'), raMax: num('raMax'), holdDays: num('holdDays'),
    budget: num('budget'), par: num('par'), limitY: num('limitY')
  };
}

/** missions.js launchState: Earth's velocity plus the burn, nudged 0.02 AU. */
function launchState(jd, burn) {
  const es = bodyState(planetEl('earth'), jd);
  const vel = { x: es.vel.x + burn.x, y: es.vel.y + burn.y, z: es.vel.z + burn.z };
  const vl = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
  return {
    pos: {
      x: es.pos.x + vel.x / vl * 0.02,
      y: es.pos.y + vel.y / vl * 0.02,
      z: es.pos.z + vel.z / vl * 0.02
    },
    vel: vel
  };
}

/**
 * Fly a baked two-burn plan the way missions.js does: NB.step in
 * frame-sized slices with the scheduled burn firing inside the
 * integrator, tick()'s orbiter win test on top.
 */
function flyPlan(def, plan, rate) {
  const el = planetEl(plan.target);
  NB.clear();
  const ls = launchState(plan.jd, plan.burn1);
  O.TimeBar.jd = plan.jd;
  const p = NB.addParticle(ls.pos, ls.vel, '#fff');
  p.burns = [{ jd: plan.jd + plan.t2, dv: plan.burn2, done: false }];
  const h = rate / 60;
  let capStart = null, worstRp = 0, worstRa = 0, rp = 0, ra = 0;
  for (let t = plan.jd; t < plan.jd + def.limitY * 365.25 && p.alive; t += h) {
    NB.step(t, h);
    const ro = NB.relPlanet(p.pos, p.vel, el, t + h);
    if (ro.bound) {
      if (!capStart) { capStart = t + h; worstRp = 0; worstRa = 0; }
      if (ro.orb.rp > worstRp) worstRp = ro.orb.rp;
      if (ro.orb.ra > worstRa) worstRa = ro.orb.ra;
      rp = ro.orb.rp; ra = ro.orb.ra;
      if (t + h - capStart >= def.holdDays &&
          worstRp <= def.rpMax && worstRa <= def.raMax) {
        NB.remove(p);
        return { won: true, rp: rp, ra: ra, tWin: t + h - plan.jd };
      }
    } else if (capStart) { capStart = null; }
  }
  NB.remove(p);
  return { won: false, alive: p.alive };
}

const MARS_PLAN = {
  target: 'mars', jd: 2461350.5,                    // depart 2026-11-06
  burn1: { x: -0.0011621706971638992, y: 0.0013237535383249838, z: 0 },   // 3.05 km/s
  t2: 285,
  burn2: { x: 0.0014026669161482854, y: -0.0004131424111448858, z: -0.00043332389747305263 }  // 2.64 km/s (plane-matched)
};

const SATURN_PLAN = {
  target: 'saturn', jd: 2461980,                    // depart 2028-07-27
  burn1: { x: 0.00579051681482902, y: 0.0019872054445531713, z: 0 },      // 10.6 km/s
  t2: 2256,
  burn2: { x: -0.001686635438555159, y: -0.00033804882634282715, z: -0.0006767626840442782 }  // 3.20 km/s (plane-matched)
};

test('Mars Orbiter: baked 5.69 km/s scan champion still captures at par criteria', function () {
  const def = missionDef('marsorbit');
  ok(def.par >= 5.69, 'par (' + def.par + ') at or above the scan minimum 5.69');
  const res = flyPlan(def, MARS_PLAN, 20);
  ok(res.won, 'capture + 60 d hold inside rp<' + def.rpMax + ', ra<' + def.raMax);
  between(res.tWin, 285, 500, 'hold completes within months of insertion');
});

test('Ringside: baked 13.80 km/s scan champion still captures at par criteria', function () {
  const def = missionDef('ringside');
  ok(def.par >= 13.8, 'par (' + def.par + ') at or above the scan minimum 13.80');
  const res = flyPlan(def, SATURN_PLAN, 40);
  ok(res.won, 'Saturn capture + 90 d hold inside rp<' + def.rpMax + ', ra<' + def.raMax);
  between(res.tWin, 2256, 2557, 'insertion at T+2256 d, hold done before the 7 y limit');
});
