/**
 * barycenter.js — The Sun's wobble: the solar system's true pivot, traced.
 *
 * The Sun is not the centre — the barycentre is, and the planets (Jupiter
 * above all) drag it around by up to two solar radii. The scene is
 * heliocentric, so what we can honestly draw is the barycentre's path
 * around the Sun: b(jd) = Σ mᵢrᵢ / (M☉ + Σ mᵢ) from the same JPL mass
 * ratios the n-body integrator uses. The Sun's path around the barycentre
 * is this exact curve point-reflected — same rosette, same physics.
 *
 * Everything draws magnified ×MAG around the origin as an inset diagram:
 * the wandering glow is the barycentre, the amber circle is the Sun's own
 * photosphere at the same magnification. Watch the pivot leave the Sun's
 * surface entirely when Jupiter and Saturn gang up (as they did around the
 * 2020 great conjunction) and dive back inside when they oppose. The trail
 * covers ~130 years, enough to see the ~60-year Jupiter–Saturn beat twice.
 *
 * Flip the frame in your head — a star pinned to the trail, wobbling — and
 * this drawing is the radial-velocity/astrometry exoplanet method: we found
 * our first thousand worlds by watching other suns trace exactly this.
 * Samples are simulation-time based with analytic backfill, so time-lapse
 * speed cannot distort the figure.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Barycenter = (function () {
  'use strict';

  var MAG = 6500;                 // magnification: AU → scene units for the inset
  var R_SUN_AU = 0.0046547;       // photospheric radius
  var SAMPLE_DAYS = 22;
  var POINTS = 2200;              // × SAMPLE_DAYS ≈ 132 years of trail
  var MAX_BACKFILL = 600;
  var TELEPORT_DAYS = 365250;

  // M_sun / M_planet (JPL, same table as nbody.js — read-only, so dup'd here)
  var RATIOS = {
    mercury: 6023600,   venus: 408523.7, earth: 328900.56, mars: 3098708,
    jupiter: 1047.3486, saturn: 3497.898, uranus: 22902.98, neptune: 19412.24
  };

  var K, scene, group;
  var bodies = [];                // { el, w } with w = mᵢ/M☉
  var enabled = false;
  var trail = null, head = null, sunDisc = null;
  var ring = 0, used = 0, total = 0;
  var lastSample = null;

  /** Barycentre relative to the Sun, ecliptic AU. */
  function bary(jd, out) {
    var x = 0, y = 0, z = 0, wsum = 1;   // Sun's own weight
    for (var i = 0; i < bodies.length; i++) {
      var h = K.heliocentric(bodies[i].el, jd);
      x += h.x * bodies[i].w; y += h.y * bodies[i].w; z += h.z * bodies[i].w;
      wsum += bodies[i].w;
    }
    out.x = x / wsum; out.y = y / wsum; out.z = z / wsum;
    return out;
  }

  var B = { x: 0, y: 0, z: 0 };
  var PREV = { has: false, x: 0, y: 0, z: 0 };

  /** Append the segment previous-sample → jd-sample into the ring buffer. */
  function pushSample(jd) {
    bary(jd, B);
    var x = B.x * MAG, y = B.z * MAG, z = -B.y * MAG;   // linear ecliptic → scene
    if (PREV.has) {
      var p = trail.geometry.attributes.position;
      var i = ring * 6;
      p.array[i] = PREV.x; p.array[i + 1] = PREV.y; p.array[i + 2] = PREV.z;
      p.array[i + 3] = x; p.array[i + 4] = y; p.array[i + 5] = z;
      ring = (ring + 1) % POINTS;
      used = Math.min(used + 1, POINTS);
      total++;
    }
    PREV.has = true; PREV.x = x; PREV.y = y; PREV.z = z;
  }

  /** Age-fade every segment, newest brightest (additive: dark = gone). */
  function refade() {
    var c = trail.geometry.attributes.color;
    for (var k = 0; k < used; k++) {
      var slot = (ring - 1 - k + POINTS) % POINTS;
      var f = 0.10 + 0.90 * Math.pow(1 - k / POINTS, 1.35);
      var i = slot * 6;
      c.array[i] = 0.95 * f; c.array[i + 1] = 0.90 * f; c.array[i + 2] = 0.70 * f;
      c.array[i + 3] = c.array[i]; c.array[i + 4] = c.array[i + 1]; c.array[i + 5] = c.array[i + 2];
    }
    trail.geometry.setDrawRange(0, used * 2);
    trail.geometry.attributes.position.needsUpdate = true;
    c.needsUpdate = true;
  }

  function build() {
    group = new THREE.Group();
    group.visible = false;

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POINTS * 6), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(POINTS * 6), 3));
    geo.setDrawRange(0, 0);
    trail = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    trail.frustumCulled = false;
    group.add(trail);

    // The Sun's photosphere at inset scale — the "does the pivot leave the
    // star?" reference circle
    var circ = [];
    for (var i = 0; i <= 96; i++) {
      var a = (i / 96) * Math.PI * 2;
      circ.push(new THREE.Vector3(Math.cos(a) * R_SUN_AU * MAG, 0, Math.sin(a) * R_SUN_AU * MAG));
    }
    sunDisc = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(circ),
      new THREE.LineBasicMaterial({
        color: 0xf2a63c, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    sunDisc.frustumCulled = false;
    group.add(sunDisc);

    // Barycentre beacon: a small glow riding the trail head
    head = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ORRERY.Textures.glowSprite('rgba(255,250,235,0.95)', 'rgba(255,220,150,0.25)'),
      transparent: true, depthWrite: false
    }));
    head.scale.setScalar(4.5);
    group.add(head);

    scene.add(group);
  }

  function setEnabled(on) {
    enabled = on;
    group.visible = on;
    if (on) {
      ring = 0; used = 0; lastSample = null; PREV.has = false;
      trail.geometry.setDrawRange(0, 0);
    }
  }

  function tick(jd, suppressed) {
    group.visible = enabled && !suppressed;
    if (!enabled || suppressed) return;
    if (lastSample === null) {
      lastSample = jd;
      pushSample(jd);
      refade();
    } else {
      var d = jd - lastSample;
      if (d < 0 || d > TELEPORT_DAYS) { lastSample = jd; }
      else {
        var added = 0;
        while (jd - lastSample >= SAMPLE_DAYS && added < MAX_BACKFILL) {
          lastSample += SAMPLE_DAYS;
          pushSample(lastSample);
          added++;
        }
        if (added >= MAX_BACKFILL) lastSample = jd;
        if (added) refade();
      }
    }
    bary(jd, B);
    head.position.set(B.x * MAG, B.z * MAG, -B.y * MAG);
  }

  function init(opts) {
    K = ORRERY.Kepler;
    scene = opts.scene;
    ORRERY.DATA.PLANETS.forEach(function (p) {
      if (RATIOS[p.key]) bodies.push({ el: p.el, w: 1 / RATIOS[p.key] });
    });
    build();
    // The Sun's dossier earns a wobble line — this overlay is its proof
    ORRERY.DATA.SUN.stats.push(
      ['Barycentric wobble', '±1–2 solar radii — how exoplanets are found']
    );
  }

  return {
    init: init,
    tick: tick,
    setEnabled: setEnabled,
    MAG: MAG,
    count: function () { return total; },
    get enabled() { return enabled; }
  };
})();
