/**
 * spirograph.js — Resonance made visible: draw the line between two bodies
 * at a fixed cadence and let orbital resonance do the drawing.
 *
 * Venus–Earth is the marquee: 8 Earth years ≈ 13 Venus years, so the chord
 * sweeps out the famous five-petalled rose (5 inferior conjunctions per
 * cycle). Jupiter–Saturn traces the slow 5:2 "great inequality"; the
 * Galilean view runs in Jupiter's own frame, where Io–Europa–Ganymede's
 * 1:2:4 lock pulses instead of smearing.
 *
 * Sampling is by SIMULATION time, decoupled from frame rate: when the clock
 * jumps a whole frame's worth of days (fast time-lapse, or a headless test
 * driving the integrator directly), the intermediate chords are backfilled
 * analytically from the Kepler solver — the pattern is identical at any
 * playback speed. Chords live in a ring buffer and fade with age, newest
 * brightest, so the figure accumulates and dissolves like a long-exposure
 * photograph.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Spirograph = (function () {
  'use strict';

  var J2000 = 2451545.0;
  var MAX_BACKFILL = 420;      // chords backfilled after one clock jump
  var TELEPORT_DAYS = 36525;   // beyond this, don't backfill — restart there

  var PAIRS = [
    {
      key: 'venus-earth', label: 'Venus – Earth', a: 'venus', b: 'earth',
      interval: 4, segs: 760, color: 0xa8c8ff, rate: 120,
      note: '8 Earth years ≈ 13 Venus years. Their connecting line, sampled ' +
        'every 4 days, sweeps a five-petalled rose — one petal per meeting.'
    },
    {
      key: 'earth-mars', label: 'Earth – Mars', a: 'earth', b: 'mars',
      interval: 7, segs: 900, color: 0xf2a0b5, rate: 240,
      note: 'No neat lock here — Mars meets Earth every 780 days and the ' +
        'petals precess. Ragged, and that raggedness is why launch windows drift.'
    },
    {
      key: 'jupiter-saturn', label: 'Jupiter – Saturn', a: 'jupiter', b: 'saturn',
      interval: 80, segs: 900, color: 0xffd9a0, rate: 2400,
      note: 'Five Jupiter years ≈ two Saturn years: a slow three-lobed figure ' +
        'that repeats every ~60 years. Their meetings are the "great conjunctions".'
    },
    {
      key: 'galilean', label: 'Io · Europa · Ganymede', jovian: true,
      interval: 0.06, segs: 520, rate: 4,
      note: 'Jupiter’s frame. Io orbits twice for Europa’s once, four times for ' +
        'Ganymede’s — the 1:2:4 Laplace resonance. The chords pulse in lockstep; ' +
        'the same repeated tugs knead Io’s volcanoes hot.'
    }
  ];

  var K, scene, planetsByKey = {};
  var enabled = false;
  var pair = PAIRS[0];
  var lines = [];                // active ribbon(s): { line, colors[], head, used }
  var lastSample = null;
  var total = 0;                 // monotonic chord counter (e2e introspection)
  var VA = null, VB = null;

  function makeRibbon(segs, colorHex, parent) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs * 6), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segs * 6), 3));
    geo.setDrawRange(0, 0);
    var line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    line.frustumCulled = false;
    parent.add(line);
    return { line: line, segs: segs, head: 0, used: 0, color: new THREE.Color(colorHex) };
  }

  function pushChord(rib, ax, ay, az, bx, by, bz) {
    var p = rib.line.geometry.attributes.position;
    var i = rib.head * 6;
    p.array[i] = ax; p.array[i + 1] = ay; p.array[i + 2] = az;
    p.array[i + 3] = bx; p.array[i + 4] = by; p.array[i + 5] = bz;
    rib.head = (rib.head + 1) % rib.segs;
    rib.used = Math.min(rib.used + 1, rib.segs);
    total++;
  }

  /** Age-fade every chord: newest bright, oldest embers. */
  function refade(rib) {
    var c = rib.line.geometry.attributes.color;
    for (var k = 0; k < rib.used; k++) {
      // slot age: distance behind the head in the ring
      var slot = (rib.head - 1 - k + rib.segs) % rib.segs;
      var f = 0.16 + 0.84 * Math.pow(1 - k / rib.segs, 1.7);
      var i = slot * 6;
      c.array[i] = rib.color.r * f; c.array[i + 1] = rib.color.g * f; c.array[i + 2] = rib.color.b * f;
      c.array[i + 3] = c.array[i]; c.array[i + 4] = c.array[i + 1]; c.array[i + 5] = c.array[i + 2];
    }
    rib.line.geometry.setDrawRange(0, rib.used * 2);
    rib.line.geometry.attributes.position.needsUpdate = true;
    c.needsUpdate = true;
  }

  /** One chord (or chord-pair, Galilean mode) at simulation date jd. */
  function sample(jd) {
    if (pair.jovian) {
      var g = planetsByKey.jupiter;
      var moons = g.userData.moons;
      var io = null, eu = null, ga = null;
      moons.forEach(function (m) {
        if (m.data.key === 'io') io = m;
        if (m.data.key === 'europa') eu = m;
        if (m.data.key === 'ganymede') ga = m;
      });
      var t = jd - J2000;
      function moonPos(m, out) {
        var a = (t / m.data.orbitDays) * Math.PI * 2;
        var R = m.mesh.position.x;
        out.set(Math.cos(a) * R, 0, -Math.sin(a) * R);
      }
      moonPos(io, VA); moonPos(eu, VB);
      pushChord(lines[0], VA.x, VA.y, VA.z, VB.x, VB.y, VB.z);
      moonPos(eu, VA); moonPos(ga, VB);
      pushChord(lines[1], VA.x, VA.y, VA.z, VB.x, VB.y, VB.z);
    } else {
      K.scenePosition(planetsByKey[pair.a].userData.body.el, jd, VA);
      K.scenePosition(planetsByKey[pair.b].userData.body.el, jd, VB);
      pushChord(lines[0], VA.x, VA.y, VA.z, VB.x, VB.y, VB.z);
    }
  }

  function clearRibbons() {
    lines.forEach(function (rib) {
      rib.line.parent.remove(rib.line);
      rib.line.geometry.dispose();
      rib.line.material.dispose();
    });
    lines = [];
    lastSample = null;
  }

  function buildRibbons() {
    if (pair.jovian) {
      // Chords live in Jupiter's tilt frame so they ride along with the planet
      var tilt = planetsByKey.jupiter.userData.tiltGroup;
      lines = [makeRibbon(pair.segs, 0x6fe3d2, tilt), makeRibbon(pair.segs, 0xffd24a, tilt)];
    } else {
      lines = [makeRibbon(pair.segs, pair.color, scene)];
    }
  }

  function setPair(key) {
    var next = null;
    PAIRS.forEach(function (p) { if (p.key === key) next = p; });
    if (!next) return;
    clearRibbons();
    pair = next;
    if (enabled) buildRibbons();
  }

  function setEnabled(on) {
    enabled = on;
    if (on && !lines.length) buildRibbons();
    if (!on) clearRibbons();
  }

  function tick(jd, suppressed) {
    lines.forEach(function (rib) { rib.line.visible = !suppressed; });
    if (!enabled || suppressed) return;
    if (lastSample === null) { lastSample = jd; sample(jd); refade(lines[0]); if (lines[1]) refade(lines[1]); return; }
    var d = jd - lastSample;
    if (d <= 0) { if (d < 0) lastSample = jd; return; }   // paused / scrubbed back
    if (d > TELEPORT_DAYS) { lastSample = jd; return; }    // time teleport: restart
    var added = 0;
    while (jd - lastSample >= pair.interval && added < MAX_BACKFILL) {
      lastSample += pair.interval;
      sample(lastSample);
      added++;
    }
    if (added >= MAX_BACKFILL) lastSample = jd;           // jump too big: catch up
    if (added) {
      refade(lines[0]);
      if (lines[1]) refade(lines[1]);
    }
  }

  function init(opts) {
    K = ORRERY.Kepler;
    scene = opts.scene;
    opts.planets.forEach(function (g) { planetsByKey[g.userData.body.key] = g; });
    VA = new THREE.Vector3();
    VB = new THREE.Vector3();
  }

  return {
    init: init,
    tick: tick,
    setEnabled: setEnabled,
    setPair: setPair,
    PAIRS: PAIRS,
    count: function () { return total; },
    get enabled() { return enabled; },
    get pair() { return pair.key; }
  };
})();
