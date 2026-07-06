/**
 * trajectories.test.js — REGRESSION GUARD for the baked mission constants.
 *
 * The Voyager preset (src/ui/sandbox.js) and the mission replays
 * (src/ui/replays.js) carry offline-searched launch/burn parameters that
 * were tuned against the EXACT behavior of nbody.js + kepler.js. Any edit
 * to the integrator (step sizes, softening, indirect term, burn splitting)
 * or to the planetary elements that shifts these encounters will fail here
 * — before it ships as a replay that sails past Saturn.
 *
 * Integration uses the same chunking the app produces: frame-sized slices
 * of rate/60 days through NBody.step / Replays.driveSchedule.
 */
'use strict';

const { test, ok, close } = require('./lib/harness');
const { load, readSource } = require('./lib/orrery-loader');

const O = load(['data/bodies.js', 'physics/kepler.js', 'physics/nbody.js', 'ui/replays.js']);
const NB = O.NBody;
const K = O.Kepler;
const DEV = O.Replays._dev;

function planet(key) {
  return O.DATA.PLANETS.filter(function (p) { return p.key === key; })[0];
}
function jdUTC(y, mo, d) {
  return K.julianDate(Date.UTC(y, mo - 1, d));
}

/**
 * The VOYAGER constant is private to sandbox.js (whose IIFE needs the full
 * scene stack), so parse it from source — stubbing the whole UI would be
 * disproportionate. The regex fails loudly if the constant is reshaped.
 */
function parseVoyagerConst() {
  const src = readSource('ui/sandbox.js');
  const m = src.match(/VOYAGER\s*=\s*\{([^}]*)\}/);
  ok(m, 'VOYAGER constant found in src/ui/sandbox.js');
  const f = {};
  m[1].split(',').forEach(function (kv) {
    const parts = kv.split(':');
    f[parts[0].trim()] = parseFloat(parts[1]);
  });
  ['jd', 'kms', 'theta', 'phi'].forEach(function (k) {
    ok(isFinite(f[k]), 'VOYAGER.' + k + ' parsed');
  });
  return f;
}

test('Voyager preset: depart 1977-08-06 → Jupiter < 0.02 AU → Saturn < 0.01 AU', function () {
  const V = parseVoyagerConst();
  close(V.jd, jdUTC(1977, 8, 6) + 0.5, 1.5, 'departure epoch is 6 Aug 1977');

  // launchState in replays.js is deliberately identical to the sandbox
  // preset's aiming math (see the header comment in replays.js)
  const l = DEV.launchState({ jd: V.jd, kms: V.kms, theta: V.theta, phi: V.phi });
  O.TimeBar.jd = V.jd;
  const p = NB.addParticle(l.pos, l.vel, '#fff');

  // App chunking: the preset plays at rate 40 days/s → 2/3-day frame slices
  const h = 40 / 60;
  const best = { jupiter: { d: 1e9, jd: 0 }, saturn: { d: 1e9, jd: 0 } };
  for (let t = V.jd; t < V.jd + 2100 && p.alive; t += h) {
    NB.step(t, h);
    Object.keys(best).forEach(function (k) {
      const hp = K.heliocentric(planet(k).el, t + h);
      const d = Math.sqrt(
        Math.pow(p.pos.x - hp.x, 2) + Math.pow(p.pos.y - hp.y, 2) + Math.pow(p.pos.z - hp.z, 2));
      if (d < best[k].d) { best[k].d = d; best[k].jd = t + h; }
    });
  }
  ok(p.alive, 'probe survived the grand tour');
  NB.remove(p);

  // Measured on the shipped constants: Jupiter 0.0088 AU (11 Dec 1979),
  // Saturn 0.0015 AU (22 Oct 1982)
  ok(best.jupiter.d < 0.02, 'Jupiter flyby ' + best.jupiter.d.toFixed(4) + ' AU');
  close(best.jupiter.jd, jdUTC(1979, 12, 10), 45, 'Jupiter encounter ~Dec 1979');
  ok(best.saturn.d < 0.01, 'Saturn flyby ' + best.saturn.d.toFixed(4) + ' AU');
  close(best.saturn.jd, jdUTC(1982, 10, 20), 45, 'Saturn encounter ~Oct 1982');
});

/** Run a baked replay through its own offline harness against real NBody. */
function flyReplay(key) {
  const def = DEV.REPLAYS.filter(function (r) { return r.key === key; })[0];
  ok(def, 'replay "' + key + '" exists');
  NB.clear();
  return DEV.simulate(def, {
    step: function (a, b) { NB.step(a, b - a); },
    spawn: function (l) { return NB.addParticle(l.pos, l.vel, '#fff'); },
    kill: function (p) { NB.remove(p); }
  });
}

test('New Horizons replay: ballistic to Pluto < 0.005 AU on 14 Jul 2015', function () {
  const res = flyReplay('newhorizons');
  ok(res.alive, 'probe survived');
  // Measured: Jupiter 0.0153 AU, Pluto 0.0003 AU on 2015-07-14
  ok(res.rec.jupiter.d < 0.05, 'Jupiter assist ' + res.rec.jupiter.d.toFixed(4) + ' AU');
  ok(res.rec.pluto.d < 0.005, 'Pluto flyby ' + res.rec.pluto.d.toFixed(5) + ' AU');
  close(res.rec.pluto.jd, jdUTC(2015, 7, 14), 10, 'Pluto encounter ~14 Jul 2015');
});

test('Cassini replay: VVEJ chain holds and Saturn arrival captures', function () {
  const res = flyReplay('cassini');
  ok(res.alive, 'craft survived');
  // Measured: Venus 1/2 and Earth 0.0025 AU, Jupiter 0.0201 AU,
  // Saturn 0.0019 AU with the SOI capture burn firing
  ok(res.rec.venus1.d < 0.01, 'Venus 1 flyby ' + res.rec.venus1.d.toFixed(4) + ' AU');
  ok(res.rec.venus2.d < 0.01, 'Venus 2 flyby ' + res.rec.venus2.d.toFixed(4) + ' AU');
  ok(res.rec.earth.d < 0.01, 'Earth flyby ' + res.rec.earth.d.toFixed(4) + ' AU');
  ok(res.rec.jupiter.d < 0.05, 'Jupiter flyby ' + res.rec.jupiter.d.toFixed(4) + ' AU');
  ok(res.rec.saturn.d < 0.01, 'Saturn arrival ' + res.rec.saturn.d.toFixed(4) + ' AU');
  close(res.rec.saturn.jd, jdUTC(2004, 7, 1), 30, 'Saturn arrival ~mid-2004');
  ok(res.captured, 'Saturn Orbit Insertion fired — craft captured');
});
