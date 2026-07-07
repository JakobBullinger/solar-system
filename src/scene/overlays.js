/**
 * overlays.js — Velocity made visible.
 *
 * Three ways to SEE speed instead of reading it off a dial:
 *
 *  - Orbit lines recolour by vis-viva speed. The colours are baked once as a
 *    vertex attribute (no per-frame CPU): each sampled orbit vertex is
 *    un-compressed back to its true AU radius, the semi-major axis recovered
 *    from the loop's own min/max radii (a = (r_min + r_max)/2), and
 *    v = 29.78·√(2/r − 1/a) mapped through a single global log ramp
 *    (3 → 60 km/s). One ramp for everybody, so the lesson is double:
 *    the inner system is fast (Mercury burns, Neptune crawls) AND every
 *    eccentric orbit is fast at perihelion — comets flash red at the Sun.
 *  - Preview arcs (sandbox drags, mission plans) tint by speed along the
 *    arc, with speeds recovered from consecutive sample spacing — so a
 *    slingshot's energy theft shows as the arc going hot at the flyby and
 *    STAYING hotter downstream than it arrived.
 *  - A live velocity vector rides the selected body: true direction
 *    (ecliptic → scene axes, uncompressed), length and colour from speed,
 *    with a km/s tag at the tip.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Overlays = (function () {
  'use strict';

  var KMS_PER_AUDAY = 1731.456;
  var V_LO = 3, V_HI = 60;             // km/s endpoints of the global ramp

  var K, scene, camera, orbitLines, getFollow;
  var enabled = false;

  // Ramp stops: cold blue → teal → amber → hot coral (log-spaced in speed)
  var STOPS = [
    [0.00, new THREE.Color(0x3a62c4)],
    [0.45, new THREE.Color(0x58dfd0)],
    [0.72, new THREE.Color(0xffd24a)],
    [1.00, new THREE.Color(0xff6f5e)]
  ];

  /** Colour for a heliocentric speed in km/s (global log ramp). */
  function speedColor(kms, out) {
    var t = (Math.log(Math.max(kms, 0.01)) - Math.log(V_LO)) /
            (Math.log(V_HI) - Math.log(V_LO));
    t = Math.max(0, Math.min(1, t));
    for (var i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0] || i === STOPS.length - 1) {
        var f = (t - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0]);
        return out.copy(STOPS[i - 1][1]).lerp(STOPS[i][1], Math.max(0, Math.min(1, f)));
      }
    }
    return out.copy(STOPS[0][1]);
  }

  // --- Orbit-line speed mode ---------------------------------------------------
  // Works on any closed Kepler orbit line without touching its builder:
  // scene radius → AU radius inverts the power-law compression, and the
  // ellipse's own extremes give the semi-major axis for vis-viva.
  var C = null;

  function bakeOrbitColors(line) {
    var pos = line.geometry.attributes.position;
    var n = pos.count;
    var radii = new Float32Array(n);
    var rMin = 1e9, rMax = 0;
    for (var i = 0; i < n; i++) {
      var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      var sr = Math.sqrt(x * x + y * y + z * z);
      var au = Math.pow(sr / K.DIST_K, 1 / K.DIST_P);
      radii[i] = au;
      if (au < rMin) rMin = au;
      if (au > rMax) rMax = au;
    }
    var a = (rMin + rMax) / 2;
    var cols = new Float32Array(n * 3);
    for (var j = 0; j < n; j++) {
      speedColor(K.orbitalSpeed(radii[j], a), C);
      cols[j * 3] = C.r; cols[j * 3 + 1] = C.g; cols[j * 3 + 2] = C.b;
    }
    line.geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }

  function setSpeedMode(on) {
    enabled = on;
    orbitLines.children.forEach(function (line) {
      if (!line.geometry || !line.geometry.attributes.position) return;
      var mat = line.material;
      if (on) {
        if (!line.geometry.attributes.color) bakeOrbitColors(line);
        if (mat.userData.vzOrig === undefined) {
          mat.userData.vzOrig = { color: mat.color.getHex(), opacity: mat.opacity };
        }
        mat.color.set(0xffffff);
        mat.opacity = Math.max(mat.opacity, 0.75);
        mat.vertexColors = true;
      } else if (mat.userData.vzOrig !== undefined) {
        mat.color.setHex(mat.userData.vzOrig.color);
        mat.opacity = mat.userData.vzOrig.opacity;
        mat.vertexColors = false;
      }
      mat.needsUpdate = true;
    });
    if (!on) hideArrow();
  }

  // --- Preview-arc tint ---------------------------------------------------------
  /**
   * Tint a preview line's vertices by speed. `pts` are the AU sample points
   * the caller just wrote into the line (may be fewer than the attribute
   * holds — the tail repeats the last point, so do the same with colours).
   * Speeds come from consecutive sample spacing: pts carry `t` (days) or the
   * caller passes a fixed `dtDays`. When the mode is off this restores the
   * line to its plain single-colour material and gets out of the way.
   */
  function tintPreview(line, pts, dtDays) {
    var mat = line.material;
    if (!enabled) {
      if (mat.vertexColors) { mat.vertexColors = false; mat.needsUpdate = true; }
      return;
    }
    var posAttr = line.geometry.attributes.position;
    var count = posAttr.count;
    var colAttr = line.geometry.attributes.color;
    if (!colAttr || colAttr.count !== count) {
      colAttr = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
      line.geometry.setAttribute('color', colAttr);
    }
    var n = Math.min(pts.length, count);
    for (var i = 0; i < count; i++) {
      var k = Math.min(i, n - 1);
      var a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
      var dt = (b.t !== undefined && a.t !== undefined) ? (b.t - a.t)
        : dtDays * (Math.min(n - 1, k + 1) - Math.max(0, k - 1));
      var kms = 0;
      if (dt > 0) {
        var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        kms = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt * KMS_PER_AUDAY;
      }
      speedColor(kms, C);
      colAttr.setXYZ(i, C.r, C.g, C.b);
    }
    colAttr.needsUpdate = true;
    if (!mat.vertexColors) { mat.vertexColors = true; mat.needsUpdate = true; }
    mat.color.set(0xffffff);   // callers set bound/escape hues — don't multiply
  }

  // --- Velocity vector on the selected body --------------------------------------
  var arrow = null, label = null;
  var ORIGIN = null, DIR = null, TIP = null;

  function makeArrow() {
    arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 10, 0xffffff, 3.2, 1.7);
    arrow.line.material.depthWrite = false;
    arrow.cone.material.depthWrite = false;
    arrow.line.material.transparent = arrow.cone.material.transparent = true;
    arrow.visible = false;
    scene.add(arrow);

    label = document.createElement('div');
    label.className = 'vz-vel-label';
    document.body.appendChild(label);
  }

  function hideArrow() {
    if (arrow) arrow.visible = false;
    if (label) label.classList.remove('show');
  }

  function tick(jd, suppressed) {
    if (!enabled || suppressed) { hideArrow(); return; }
    var follow = getFollow();
    var b = follow && follow.userData.body;
    if (!b || !b.el) { hideArrow(); return; }

    var h1 = K.heliocentric(b.el, jd - 0.5);
    var h2 = K.heliocentric(b.el, jd + 0.5);
    var vx = h2.x - h1.x, vy = h2.y - h1.y, vz = h2.z - h1.z;
    var v = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (v < 1e-9) { hideArrow(); return; }
    var kms = v * KMS_PER_AUDAY;

    follow.getWorldPosition(ORIGIN);
    DIR.set(vx / v, vz / v, -vy / v);       // ecliptic → scene axes, uncompressed
    var len = 5 + kms * 0.4;
    var r = follow.userData.isSun ? ORRERY.DATA.SUN.sceneRadius
      : (follow.userData.enhancedRadius || 1);
    arrow.position.copy(ORIGIN).addScaledVector(DIR, r * 1.05);
    arrow.setDirection(DIR);
    arrow.setLength(len, Math.min(3.2, len * 0.3), 1.7);
    speedColor(kms, C);
    arrow.setColor(C);
    arrow.visible = true;

    TIP.copy(arrow.position).addScaledVector(DIR, len).project(camera);
    if (TIP.z < 1) {
      label.textContent = kms.toFixed(1) + ' km/s';
      label.style.transform = 'translate(' +
        ((TIP.x * 0.5 + 0.5) * window.innerWidth + 10).toFixed(0) + 'px,' +
        ((-TIP.y * 0.5 + 0.5) * window.innerHeight - 8).toFixed(0) + 'px)';
      label.style.color = '#' + C.getHexString();
      label.classList.add('show');
    } else {
      label.classList.remove('show');
    }
  }

  function init(opts) {
    K = ORRERY.Kepler;
    scene = opts.scene;
    camera = opts.camera;
    orbitLines = opts.orbitLines;
    getFollow = opts.getFollow;
    C = new THREE.Color();
    ORIGIN = new THREE.Vector3(); DIR = new THREE.Vector3(); TIP = new THREE.Vector3();
    makeArrow();
  }

  return {
    init: init,
    tick: tick,
    setSpeedMode: setSpeedMode,
    speedColor: speedColor,
    tintPreview: tintPreview,
    get enabled() { return enabled; }
  };
})();
