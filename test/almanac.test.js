/**
 * almanac.test.js — Sky-event finder vs known almanac dates.
 *
 * Reference dates from published astronomical almanacs; the model must land
 * within a day (its Kepler elements are the JPL approximate series).
 */
'use strict';

const { test, ok, close } = require('./lib/harness');
const { load } = require('./lib/orrery-loader');

const O = load(['data/bodies.js', 'physics/kepler.js', 'physics/almanac.js']);
const K = O.Kepler;

function jdUTC(y, mo, d) {
  return K.julianDate(Date.UTC(y, mo - 1, d));
}

// One scan covers both reference events (plus whatever else falls in it)
const events = O.Almanac.findAll(jdUTC(2026, 6, 1), 300);

function opposition(key) {
  return events.filter(function (e) {
    return e.kind === 'opposition' && e.bodyKey === key;
  })[0];
}

test('Saturn opposition 2026-10-04 (±1 day)', function () {
  const e = opposition('saturn');
  ok(e, 'Saturn opposition found in Jun 2026 – Mar 2027 scan');
  close(e.jd, jdUTC(2026, 10, 4) + 0.5, 1.0, 'opposition epoch');
});

test('Mars opposition 2027-02-19 (±1 day)', function () {
  const e = opposition('mars');
  ok(e, 'Mars opposition found in Jun 2026 – Mar 2027 scan');
  close(e.jd, jdUTC(2027, 2, 19) + 0.5, 1.0, 'opposition epoch');
});

test('oppositions come out sorted and only for superior planets', function () {
  let prev = -Infinity;
  events.forEach(function (e) {
    ok(e.jd >= prev, 'events sorted by date');
    prev = e.jd;
    if (e.kind === 'opposition') {
      ok(['mercury', 'venus', 'earth'].indexOf(e.bodyKey) === -1,
        'no opposition for inferior planets (' + e.bodyKey + ')');
    }
  });
});

test('visibility: a planet near opposition reads "up all night"', function () {
  const sat = opposition('saturn');
  const vis = O.Almanac.visibility(sat.jd);
  const s = vis.filter(function (v) { return v.key === 'saturn'; })[0];
  ok(s, 'Saturn present in naked-eye visibility list');
  ok(s.kind === 'allnight', 'Saturn at opposition is up all night, got ' + s.kind);
  ok(s.elong > 150, 'elongation near 180°, got ' + s.elong);
});
