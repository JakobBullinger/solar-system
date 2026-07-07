/**
 * mars-planner.test.js — Level 23 fixtures: our Mars transfer physics vs the
 * NASA Interplanetary Mission Design Handbook (TM-2010-216764).
 *
 * Three layers:
 *  1. lambert.js must reproduce the handbook's published C3 / arrival-v∞ for
 *     the 2026/2028/2031 windows (external reference — this doubles as
 *     validation of the level-17 Launch Window Lab).
 *  2. A porkchop-style grid scan must find each window's minimum where the
 *     handbook puts it (right dates, right energy).
 *  3. The five baked mission trajectories in marsmissions.js, re-integrated
 *     through previewLive from MarsPlanner's own launchState, must thread
 *     Mars at their reference arrival dates (regression guard on the baked
 *     v1 vectors — like the champion-plan fixtures).
 */
'use strict';

const { test, ok, eq, close, between } = require('./lib/harness');
const { load } = require('./lib/orrery-loader');

const O = load([
  'data/bodies.js', 'data/marsmissions.js',
  'physics/kepler.js', 'physics/nbody.js', 'physics/lambert.js', 'physics/lagrange.js',
  'ui/marsplanner.js'
]);
const K = O.Kepler, L = O.Lambert, MARS = O.DATA.MARS;

const earthEl = O.DATA.PLANETS.filter(p => p.key === 'earth')[0].el;
const marsEl = O.DATA.PLANETS.filter(p => p.key === 'mars')[0].el;

// ---- 1. Handbook C3 / v∞ fixtures ---------------------------------------------

test('handbook fixtures: 7 published transfers, C3 to ±0.05 km²/s², v∞ to ±0.02 km/s', function () {
  eq(MARS.HANDBOOK.length, 7, 'fixture count');
  MARS.HANDBOOK.forEach(function (f) {
    const tr = L.transfer(earthEl, marsEl, f.depJd, f.arrJd - f.depJd);
    ok(tr, f.name + ': Lambert solves');
    // dvDep off Earth's rail IS the departure v∞, so C3 = dvDep²
    close(tr.dvDep * tr.dvDep, f.c3, 0.05, f.name + ' C3');
    close(tr.vInfArr, f.vinfArr, 0.02, f.name + ' arrival v∞');
  });
});

// ---- 2. Window minima land where the handbook puts them ------------------------

function gridMin(centerDep) {
  let best = null;
  for (let dep = centerDep - 120; dep <= centerDep + 120; dep += 4) {
    for (let tof = 150; tof <= 400; tof += 8) {
      const tr = L.transfer(earthEl, marsEl, dep, tof);
      if (tr && (!best || tr.dvDep < best.dv)) best = { dv: tr.dvDep, dep: dep, tof: tof };
    }
  }
  return best;
}

test('2026 window minimum: dep ≈ 31 Oct 2026, C3 ≈ 9.14 (handbook Type II)', function () {
  const m = gridMin(2461344.5);
  close(m.dep, 2461344.5, 8, 'departure date (days)');
  close(m.dv * m.dv, 9.144, 0.25, 'min C3');
});

test('2028 window minimum: dep ≈ 2 Dec 2028, C3 ≈ 8.93 (handbook Type II)', function () {
  const m = gridMin(2462107.5);
  close(m.dep, 2462107.5, 8, 'departure date (days)');
  close(m.dv * m.dv, 8.928, 0.25, 'min C3');
});

// ---- 3. Baked mission trajectories thread Mars ---------------------------------

test('five missions, verified manifest only (no MSR, no Starship), SR-1 aspirational', function () {
  const keys = MARS.MISSIONS.map(m => m.key);
  eq(keys.join(','), 'escapade,mmx,rosalind,tianwen3,sr1', 'manifest keys, launch order');
  ok(!keys.some(k => /msr|starship/.test(k)), 'excluded missions stay excluded');
  eq(MARS.MISSIONS.filter(m => m.confidence === 'aspirational').length, 1, 'one aspirational');
  eq(MARS.MISSIONS.filter(m => m.confidence === 'aspirational')[0].key, 'sr1', 'it is SR-1');
  MARS.MISSIONS.forEach(function (m) {
    ok(m.arrJd > m.depJd, m.key + ': arrives after departing');
    ok(m.v1 && isFinite(m.v1.x + m.v1.y + m.v1.z), m.key + ': baked v1');
  });
  const esc = MARS.MISSIONS[0];
  ok(esc.loiter && esc.loiter.toJd === esc.depJd,
    'ESCAPADE loiter ends at its powered Earth-flyby departure');
});

MARS.MISSIONS.forEach(function (m) {
  test(m.name + ': baked state re-integrates to Mars at the reference arrival', function () {
    const res = O.MarsPlanner._dev.transferPreview(m);
    // Offline Newton shooting left misses of 670–1,700 km; 5e-5 AU ≈ 7,500 km
    // of headroom still fails loudly if v1 or the planetary elements drift.
    ok(res.target.d < 5e-5,
      'closest approach ' + (res.target.d * 149597871).toFixed(0) + ' km < 7,500 km');
    close(res.target.jd, m.arrJd, 1.5, 'closest approach lands on the reference arrival date');
    ok(!res.died, 'probe survives the cruise');
  });
});

test('direct transfers stay near their zero-rev Lambert seeds (rebake alarm)', function () {
  const KMS = 1731.456;
  MARS.MISSIONS.forEach(function (m) {
    if (m.multirev) return;        // Rosalind Franklin is a 1-rev transfer
    const tr = L.transfer(earthEl, marsEl, m.depJd, m.arrJd - m.depJd);
    ok(tr, m.key + ': zero-rev Lambert solves at the baked dates');
    const d = Math.hypot(m.v1.x - tr.v1.x, m.v1.y - tr.v1.y, m.v1.z - tr.v1.z) * KMS;
    ok(d < 2.5, m.key + ': baked v1 within 2.5 km/s of fresh Lambert (got ' + d.toFixed(2) + ')');
  });
});

test('ESCAPADE loiter arc rides Sun–Earth L2 (1.5 Mkm down-Sun of Earth)', function () {
  const m = MARS.MISSIONS[0];
  for (let jd = m.loiter.fromJd; jd <= m.loiter.toJd; jd += 60) {
    const p = O.Lagrange.point('earth', 'L2', jd);
    const e = K.heliocentric(earthEl, jd);
    const dKm = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z) * 149597871;
    between(dKm, 1.3e6, 1.7e6, 'L2–Earth distance at jd ' + jd);
    ok(Math.hypot(p.x, p.y, p.z) > e.r, 'L2 sits beyond Earth from the Sun');
  }
});
