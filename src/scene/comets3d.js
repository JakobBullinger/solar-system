/**
 * comets3d.js — Comets: nucleus, coma glow, and twin particle tails.
 *
 * Tail physics, simplified honestly: both tails point away from the Sun
 * and only exist when the comet is close enough for ices to sublimate
 * (inside ~3.5 AU). The ion tail is straight and blue; the dust tail is
 * warmer and curves back along the orbit, lagging the comet's motion.
 * Activity — coma size, tail length, brightness — scales continuously
 * with heliocentric distance, so scrubbing time makes a comet bloom on
 * approach and fade as it recedes.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Comets3D = (function () {
  'use strict';

  var TAIL_N = 320;
  var ACTIVE_AU = 3.5;   // sublimation switches on inside this distance

  function tailPoints(color, size) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(TAIL_N * 3), 3));
    var mat = new THREE.PointsMaterial({
      color: color, size: size, sizeAttenuation: true,
      transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  function build(data) {
    var group = new THREE.Group();

    var nucleus = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 20, 14),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(data.color) })
    );
    group.add(nucleus);

    var coma = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ORRERY.Textures.glowSprite('rgba(215,240,255,0.9)', 'rgba(120,180,230,0.22)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    group.add(coma);

    var ion = tailPoints(0x7fc4ff, 0.7);
    var dust = tailPoints(0xffe9c9, 0.95);
    group.add(ion, dust);

    // Per-particle randoms, fixed for the comet's lifetime: fraction along
    // the tail (dense near the head) and a lateral jitter pair.
    var grains = [];
    for (var i = 0; i < TAIL_N; i++) {
      grains.push({
        t: Math.pow(Math.random(), 1.6),
        j1: Math.random() * 2 - 1,
        j2: Math.random() * 2 - 1
      });
    }

    group.userData = {
      body: data,
      mesh: nucleus,
      coma: coma,
      ion: ion,
      dust: dust,
      grains: grains,
      enhancedRadius: 1.6,
      moons: []
    };
    return group;
  }

  /** Comet orbits get dashed lines to read differently from planets. */
  function buildOrbitLine(data, jd) {
    var pts = ORRERY.Kepler.orbitPath(data.el, jd, 512);
    var geo = new THREE.BufferGeometry().setFromPoints(pts);
    var line = new THREE.Line(geo, new THREE.LineDashedMaterial({
      color: new THREE.Color(data.color),
      dashSize: 2.6, gapSize: 2.2,
      transparent: true, opacity: 0.22
    }));
    line.computeLineDistances();
    return line;
  }

  // Scratch vectors for the per-frame update
  var AHEAD = new THREE.Vector3(), BEHIND = new THREE.Vector3();
  var DIR = new THREE.Vector3(), VEL = new THREE.Vector3();
  var SIDE = new THREE.Vector3(), UP = new THREE.Vector3();

  function writeTail(points, grains, len, curve, spread) {
    var pos = points.geometry.attributes.position;
    for (var i = 0; i < TAIL_N; i++) {
      var g = grains[i];
      var t = g.t;
      var along = t * len;
      var bend = curve * len * t * t;      // quadratic lag → curved tail
      var wob = spread * len * t;
      pos.setXYZ(i,
        DIR.x * along + SIDE.x * (bend + g.j1 * wob) + UP.x * g.j2 * wob,
        DIR.y * along + SIDE.y * (bend + g.j1 * wob) + UP.y * g.j2 * wob,
        DIR.z * along + SIDE.z * (bend + g.j1 * wob) + UP.z * g.j2 * wob);
    }
    pos.needsUpdate = true;
  }

  function update(group, jd) {
    var d = group.userData;
    var b = d.body;
    var h = ORRERY.Kepler.heliocentric(b.el, jd);
    ORRERY.Kepler.toScene(h, group.position);

    var activity = Math.max(0, Math.min(1, (ACTIVE_AU - h.r) / (ACTIVE_AU - 0.5)));
    d.activity = activity;

    d.coma.material.opacity = 0.12 + activity * 0.88;
    d.coma.scale.setScalar(2.2 + activity * 5.5);

    var show = activity > 0.02;
    d.ion.visible = show;
    d.dust.visible = show;
    if (!show) return;

    // Anti-sunward direction (Sun sits at the origin)
    DIR.copy(group.position).normalize();

    // Orbital velocity direction via central difference, ±1 day
    ORRERY.Kepler.scenePosition(b.el, jd + 1, AHEAD);
    ORRERY.Kepler.scenePosition(b.el, jd - 1, BEHIND);
    VEL.copy(AHEAD).sub(BEHIND).normalize();

    // Lateral frame: SIDE = trailing direction, perpendicular to the tail axis
    SIDE.copy(VEL).addScaledVector(DIR, -VEL.dot(DIR)).normalize().negate();
    UP.copy(DIR).cross(SIDE).normalize();

    var len = 5 + 27 * activity;
    writeTail(d.ion, d.grains, len * 1.15, 0.04, 0.045);
    writeTail(d.dust, d.grains, len * 0.8, 0.45, 0.09);
    d.ion.material.opacity = 0.8 * activity;
    d.dust.material.opacity = 0.55 * activity;
  }

  return { build: build, buildOrbitLine: buildOrbitLine, update: update };
})();
