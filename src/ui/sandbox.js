/**
 * sandbox.js — The gravity sandbox: drag-to-launch interaction, trajectory
 * preview, particle trails, and scenario presets.
 *
 * Launching: press on empty space (the press point is projected onto the
 * ecliptic plane and un-compressed into real AU), drag to aim — direction
 * follows the cursor, speed grows with drag length — and release to hand
 * the body to the n-body integrator. While aiming, a preview arc shows the
 * trajectory with planets frozen: teal means gravitationally bound, red
 * means the Sun never gets it back.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Sandbox = (function () {
  'use strict';

  var TRAIL = 240;                 // points per particle trail
  var SPEED_PER_PX = 0.11;         // km/s of launch speed per pixel dragged
  var MIN_KMS = 2, MAX_KMS = 60;
  var MAX_BODIES = 48;
  var BOUND_COLOR = 0x67e3d2, ESCAPE_COLOR = 0xff8585;
  var PALETTE = ['#7fc4ff', '#ffd27f', '#9bd496', '#f2a0b5', '#c9a8ff', '#8ce8dd'];

  var K, NB;
  var scene, camera, canvas, controls;
  var group;                       // all sandbox visuals live here
  var active = false;
  var visuals = [];                // { p, sprite, line, pos[], count }
  var paletteIdx = 0;
  var els = {};

  // --- Coordinate mapping ----------------------------------------------------
  // Scene <-> AU: invert the power-law distance compression of kepler.js.
  function sceneToAU(v) {
    var r = v.length();
    if (r < 1e-6) return { x: 0.05, y: 0, z: 0 };
    var au = Math.pow(r / K.DIST_K, 1 / K.DIST_P);
    var s = au / r;
    // scene (x, y-up, z) → ecliptic (x, y, z-north); inverse of toScene
    return { x: v.x * s, y: -v.z * s, z: v.y * s };
  }

  // --- Aiming state ------------------------------------------------------------
  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();
  var ecliptic = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  var hitScene = new THREE.Vector3();
  var dragging = false;
  var startScene = new THREE.Vector3();
  var startAU = null;
  var startPx = { x: 0, y: 0 };
  var aimLine, previewLine;
  var PREVIEW_N = 160;

  function pickEcliptic(e, out) {
    ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(ecliptic, out) !== null;
  }

  function makeAimLines() {
    aimLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })
    );
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PREVIEW_N * 3), 3));
    previewLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: BOUND_COLOR, transparent: true, opacity: 0.75
    }));
    aimLine.visible = previewLine.visible = false;
    aimLine.frustumCulled = previewLine.frustumCulled = false;
    group.add(aimLine, previewLine);
  }

  /** Launch velocity (AU/day) for the current drag; speed from drag length. */
  function dragVelocity(e) {
    var au = sceneToAU(hitScene);
    var dx = au.x - startAU.x, dy = au.y - startAU.y, dz = au.z - startAU.z;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var px = Math.hypot(e.clientX - startPx.x, e.clientY - startPx.y);
    var kms = Math.min(MAX_KMS, Math.max(MIN_KMS, px * SPEED_PER_PX));
    if (len < 1e-9) return { vel: { x: 0, y: 0, z: 0 }, kms: 0 };
    var v = kms / NB.KMS_PER_AUDAY / len;
    return { vel: { x: dx * v, y: dy * v, z: dz * v }, kms: kms };
  }

  function updateAim(e) {
    if (!pickEcliptic(e, hitScene)) return;
    var d = dragVelocity(e);

    aimLine.geometry.setFromPoints([startScene, hitScene.clone()]);
    aimLine.visible = true;

    var bound = NB.energy(startAU, d.vel) < 0;
    var pts = NB.preview(startAU, d.vel, ORRERY.TimeBar.jd, 1400, 1.5, Math.ceil(1400 / PREVIEW_N));
    var pos = previewLine.geometry.attributes.position;
    var v = new THREE.Vector3();
    var n = Math.min(pts.length, PREVIEW_N);
    for (var i = 0; i < PREVIEW_N; i++) {
      K.toScene(pts[Math.min(i, n - 1)], v);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    previewLine.material.color.setHex(bound ? BOUND_COLOR : ESCAPE_COLOR);
    if (ORRERY.Overlays) ORRERY.Overlays.tintPreview(previewLine, pts, 1.5 * Math.ceil(1400 / PREVIEW_N));
    previewLine.visible = n > 1;

    els.speed.textContent = d.kms.toFixed(0) + ' km/s · ' + (bound ? 'captured orbit' : 'escapes the Sun');
    els.speed.classList.toggle('esc', !bound);
    els.speed.style.transform = 'translate(' + (e.clientX + 14) + 'px,' + (e.clientY - 10) + 'px)';
    els.speed.classList.add('show');
  }

  function endAim() {
    dragging = false;
    controls.enabled = true;
    aimLine.visible = previewLine.visible = false;
    els.speed.classList.remove('show');
  }

  // --- Particle visuals --------------------------------------------------------
  var glowTex = null;

  function spawn(posAU, velAU, colorHex, trailLen) {
    if (NB.particles.length >= MAX_BODIES) removeVisual(visuals[0]);
    var color = colorHex || PALETTE[paletteIdx++ % PALETTE.length];
    var trail = trailLen || TRAIL;
    var p = NB.addParticle(posAU, velAU, color);

    if (!glowTex) glowTex = ORRERY.Textures.glowSprite('rgba(255,255,255,0.95)', 'rgba(255,255,255,0.12)');
    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(color),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    sprite.scale.setScalar(2.6);

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(trail * 3), 3));
    var cols = new Float32Array(trail * 3);
    var c = new THREE.Color(color);
    for (var i = 0; i < trail; i++) {
      var f = Math.pow(1 - i / trail, 1.6);
      cols[i * 3] = c.r * f; cols[i * 3 + 1] = c.g * f; cols[i * 3 + 2] = c.b * f;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.setDrawRange(0, 0);
    var line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    line.frustumCulled = false;

    group.add(sprite, line);
    var vis = {
      p: p, sprite: sprite, line: line, count: 0, trail: trail,
      color: c,                                  // base for the age-fade
      jds: new Float64Array(trail),              // sim time each point was laid
      burnsSeen: 0                               // fired-burn count → flare
    };
    visuals.push(vis);
    updateHud();
    return vis;
  }

  function removeVisual(vis) {
    group.remove(vis.sprite, vis.line);
    vis.line.geometry.dispose();
    NB.remove(vis.p);
    visuals.splice(visuals.indexOf(vis), 1);
  }

  var headScene = new THREE.Vector3();

  // --- Burn flares -------------------------------------------------------------
  // A short additive bloom where an impulse fired — mid-course burns are
  // otherwise invisible outside the HUD. Real-time lifetime: a flare
  // finishes even if the sim clock is paused the next frame.
  var flares = [];
  var flareClock = 0;

  /** Bloom at a heliocentric AU position (replays call this on scripted burns). */
  function flareAt(posAU, color) {
    if (!glowTex) glowTex = ORRERY.Textures.glowSprite('rgba(255,255,255,0.95)', 'rgba(255,255,255,0.12)');
    var s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(color || '#ffe9c9'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    K.toScene(posAU, headScene);
    s.position.copy(headScene);
    s.scale.setScalar(2);
    group.add(s);
    flares.push({ sprite: s, t: 0 });
  }

  function updateFlares() {
    if (!flares.length) { flareClock = 0; return; }
    var now = performance.now();
    var dt = flareClock ? Math.min((now - flareClock) / 1000, 0.1) : 0;
    flareClock = now;
    for (var i = flares.length - 1; i >= 0; i--) {
      var f = flares[i];
      f.t += dt / 1.1;
      if (f.t >= 1) {
        group.remove(f.sprite);
        flares.splice(i, 1);
        continue;
      }
      var e = 1 - Math.pow(1 - f.t, 3);
      f.sprite.scale.setScalar(2.5 + 11 * e);
      f.sprite.material.opacity = Math.pow(1 - f.t, 1.5);
    }
  }

  /** Age-fade: per-vertex color scaled by how long ago (sim time) each
   *  point was laid, so the tail dissolves by actual age — dense slow
   *  stretches hold their glow, fast stretches fade in flight. */
  function fadeTrail(vis, jdNow) {
    if (vis.count < 2) return;
    var cols = vis.line.geometry.attributes.color;
    var span = Math.max(Math.abs(jdNow - vis.jds[vis.count - 1]), 1e-9);
    for (var j = 0; j < vis.count; j++) {
      var f = Math.pow(Math.max(0, 1 - Math.abs(jdNow - vis.jds[j]) / span), 1.6);
      cols.array[j * 3] = vis.color.r * f;
      cols.array[j * 3 + 1] = vis.color.g * f;
      cols.array[j * 3 + 2] = vis.color.b * f;
    }
    cols.needsUpdate = true;
  }

  var easePendJd = null;           // slice start deferred across a clock ease

  /** Advance physics across the frame's time slice and refresh visuals. */
  function tick(jd0, jd1) {
    updateFlares();
    if (!visuals.length) { easePendJd = null; return; }

    // While the time bar eases a clock jump, hold the physics and treat
    // the whole jump as the single step it used to be — so the n-body
    // 30-day teleport guard sees exactly the same delta as before.
    if (ORRERY.TimeBar.easing) {
      if (easePendJd === null) easePendJd = jd0;
      return;
    }
    if (easePendJd !== null) { jd0 = easePendJd; easePendJd = null; }

    NB.step(jd0, jd1 - jd0);

    var moved = jd1 !== jd0;
    for (var i = visuals.length - 1; i >= 0; i--) {
      var vis = visuals[i];
      if (!vis.p.alive) { removeVisual(vis); updateHud(); continue; }
      K.toScene(vis.p.pos, headScene);
      vis.sprite.position.copy(headScene);

      if (vis.p.burns) {
        var fired = 0;
        for (var b = 0; b < vis.p.burns.length; b++) if (vis.p.burns[b].done) fired++;
        if (fired > vis.burnsSeen) flareAt(vis.p.pos, vis.p.color);
        vis.burnsSeen = fired;
      }

      if (moved) {
        var pos = vis.line.geometry.attributes.position;
        var arr = pos.array;
        var last = Math.min(vis.count, vis.trail - 1);
        for (var j = last; j > 0; j--) {
          arr[j * 3] = arr[(j - 1) * 3];
          arr[j * 3 + 1] = arr[(j - 1) * 3 + 1];
          arr[j * 3 + 2] = arr[(j - 1) * 3 + 2];
          vis.jds[j] = vis.jds[j - 1];
        }
        arr[0] = headScene.x; arr[1] = headScene.y; arr[2] = headScene.z;
        vis.jds[0] = jd1;
        vis.count = Math.min(vis.count + 1, vis.trail);
        // A draw-in (TrajAnim) may own the draw range for a moment
        if (!vis.line.userData.trajAnim) vis.line.geometry.setDrawRange(0, vis.count);
        pos.needsUpdate = true;
        fadeTrail(vis, jd1);
      }
    }
  }

  // --- Presets -------------------------------------------------------------------
  function earthState(jd) {
    var e = K.heliocentric(ORRERY.DATA.PLANETS[2].el, jd);
    var e2 = K.heliocentric(ORRERY.DATA.PLANETS[2].el, jd + 0.5);
    var e1 = K.heliocentric(ORRERY.DATA.PLANETS[2].el, jd - 0.5);
    var v = { x: e2.x - e1.x, y: e2.y - e1.y, z: e2.z - e1.z };
    var vl = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return { pos: e, dir: { x: v.x / vl, y: v.y / vl, z: v.z / vl }, r: e.r };
  }

  function fromEarth(speedKms, jd) {
    var s = earthState(jd);
    // Nudge the start off Earth itself so we don't spawn inside its gravity well
    var pos = { x: s.pos.x + s.dir.x * 0.02, y: s.pos.y + s.dir.y * 0.02, z: s.pos.z + s.dir.z * 0.02 };
    var v = speedKms / NB.KMS_PER_AUDAY;
    return { pos: pos, vel: { x: s.dir.x * v, y: s.dir.y * v, z: s.dir.z * v } };
  }

  /**
   * Found by an offline launch-window search run against this exact
   * integrator: depart Earth on 6 Aug 1977 at 38.5 km/s heliocentric,
   * aimed 10.92° outside Earth's prograde direction and 3.23° below the
   * ecliptic. Jupiter flyby Dec 1979 at 0.009 AU slings the probe on to
   * a 0.001 AU Saturn encounter in Oct 1982 — our own grand tour, 13 days
   * off the real Voyager 2 launch date.
   */
  var VOYAGER = { jd: 2443361.5, kms: 38.5, theta: 10.9215, phi: -3.2301 };

  function voyagerLaunchState() {
    var s = earthState(VOYAGER.jd);
    var th = VOYAGER.theta * Math.PI / 180, ph = VOYAGER.phi * Math.PI / 180;
    var rx = s.dir.x * Math.cos(th) - s.dir.y * Math.sin(th);
    var ry = s.dir.x * Math.sin(th) + s.dir.y * Math.cos(th);
    var vx = rx * Math.cos(ph), vy = ry * Math.cos(ph), vz = Math.sin(ph);
    var vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
    vx /= vl; vy /= vl; vz /= vl;
    var v = VOYAGER.kms / NB.KMS_PER_AUDAY;
    return {
      pos: { x: s.pos.x + vx * 0.02, y: s.pos.y + vy * 0.02, z: s.pos.z + vz * 0.02 },
      vel: { x: vx * v, y: vy * v, z: vz * v }
    };
  }

  var PRESETS = {
    // The grand tour: time-travels to 1977 and launches the probe
    voyager: function () {
      while (visuals.length) removeVisual(visuals[0]);
      NB.clear();
      ORRERY.TimeBar.jd = VOYAGER.jd;
      ORRERY.TimeBar.rate = 40;
      ORRERY.TimeBar.playing = true;
      var l = voyagerLaunchState();
      spawn(l.pos, l.vel, '#e9eef7', 2600);
      els.note.textContent =
        'Voyager — launched 6 Aug 1977. Jupiter slingshot Dec ’79 bends it on to Saturn, Oct ’82.';
    },
    // Hohmann transfer: perihelion speed of an ellipse from Earth to Mars' orbit
    mars: function (jd) {
      var s = earthState(jd);
      var aT = (s.r + 1.524) / 2;
      var v = Math.sqrt(NB.MU * (2 / s.r - 1 / aT)) * NB.KMS_PER_AUDAY;
      var l = fromEarth(v, jd);
      spawn(l.pos, l.vel, '#f2a0b5');
    },
    // A dozen bodies on circular orbits — watch Jupiter stir them
    belt: function (jd) {
      for (var i = 0; i < 12; i++) {
        var ang = (i / 12) * Math.PI * 2;
        var r = 1.9 + (i % 3) * 0.35;
        var vc = Math.sqrt(NB.MU / r);
        spawn(
          { x: Math.cos(ang) * r, y: Math.sin(ang) * r, z: 0 },
          { x: -Math.sin(ang) * vc, y: Math.cos(ang) * vc, z: 0 },
          PALETTE[i % PALETTE.length]
        );
      }
    },
    // Nearly no tangential speed at 2.2 AU: a long fall into the Sun.
    // (Above ~8% of circular speed the perihelion clears the Sun and it
    // survives as a sungrazer ellipse instead.)
    grazer: function (jd) {
      var s = earthState(jd);
      var ang = Math.atan2(s.pos.y, s.pos.x) + 2.1;
      var r = 2.2, vc = Math.sqrt(NB.MU / r) * 0.06;
      spawn(
        { x: Math.cos(ang) * r, y: Math.sin(ang) * r, z: 0 },
        { x: -Math.sin(ang) * vc, y: Math.cos(ang) * vc, z: 0 },
        '#ffd27f'
      );
    },
    // Well past solar escape velocity (42 km/s at 1 AU)
    escape: function (jd) {
      var l = fromEarth(47, jd);
      spawn(l.pos, l.vel, '#ff8585');
    }
  };

  /** Chase-cam the most recently launched body. */
  function rideNewest() {
    var vis = visuals[visuals.length - 1];
    if (!vis) return;
    ORRERY.Ride.start({
      label: 'your probe',
      back: 7,
      getPos: function () { return vis.sprite.position; },
      isAlive: function () { return vis.p.alive && visuals.indexOf(vis) !== -1; },
      onStart: function () { vis.sprite.scale.setScalar(0.9); },
      onStop: function () { vis.sprite.scale.setScalar(2.6); }
    });
  }

  function clearAll() {
    while (visuals.length) removeVisual(visuals[0]);
    NB.clear();
    if (els.note) els.note.textContent = '';
    updateHud();
  }

  // --- HUD ---------------------------------------------------------------------
  function updateHud() {
    var n = NB.particles.filter(function (p) { return p.alive; }).length;
    var bits = [n + (n === 1 ? ' body' : ' bodies')];
    if (NB.lost.sun) bits.push(NB.lost.sun + ' swallowed by the Sun');
    if (NB.lost.escaped) bits.push(NB.lost.escaped + ' escaped');
    els.count.textContent = bits.join(' · ');
  }

  // --- Setup ---------------------------------------------------------------------
  function init(opts) {
    K = ORRERY.Kepler;
    NB = ORRERY.NBody;
    scene = opts.scene; camera = opts.camera;
    canvas = opts.canvas; controls = opts.controls;

    group = new THREE.Group();
    scene.add(group);
    makeAimLines();

    els.hud = document.getElementById('sandbox-hud');
    els.count = document.getElementById('sb-count');
    els.speed = document.getElementById('sb-speed');
    els.note = document.getElementById('sb-note');
    document.getElementById('sb-clear').addEventListener('click', clearAll);
    document.getElementById('sb-ride').addEventListener('click', rideNewest);
    els.hud.querySelectorAll('[data-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        els.note.textContent = '';
        PRESETS[btn.dataset.preset](ORRERY.TimeBar.jd);
      });
    });

    canvas.addEventListener('pointerdown', function (e) {
      if (!active || e.button !== 0) return;
      if (!pickEcliptic(e, hitScene)) return;
      dragging = true;
      controls.enabled = false;
      startScene.copy(hitScene);
      startAU = sceneToAU(startScene);
      startPx.x = e.clientX; startPx.y = e.clientY;
    });
    canvas.addEventListener('pointermove', function (e) {
      if (dragging) updateAim(e);
    });
    window.addEventListener('pointerup', function (e) {
      if (!dragging) return;
      var px = Math.hypot(e.clientX - startPx.x, e.clientY - startPx.y);
      if (px > 6 && pickEcliptic(e, hitScene)) {
        spawn(startAU, dragVelocity(e).vel);
      }
      endAim();
    });
  }

  function setMode(on) {
    active = on;
    els.hud.classList.toggle('show', on);
    canvas.style.cursor = on ? 'crosshair' : '';
    if (!on && dragging) endAim();
    if (on) updateHud();
  }

  /** Alive bodies as plain data (capped) — the permalink's payload. */
  function serialize() {
    return NB.particles
      .filter(function (p) { return p.alive; })
      .slice(0, 24)
      .map(function (p) {
        return {
          pos: [p.pos.x, p.pos.y, p.pos.z],
          vel: [p.vel.x, p.vel.y, p.vel.z],
          color: p.color
        };
      });
  }

  return {
    init: init,
    setMode: setMode,
    tick: tick,
    clear: clearAll,
    runVoyager: function () { PRESETS.voyager(); },
    addBody: function (pos, vel, color, trailLen) { return spawn(pos, vel, color, trailLen); },
    removeBody: function (vis) { if (visuals.indexOf(vis) !== -1) { removeVisual(vis); updateHud(); } },
    flareAt: flareAt,
    serialize: serialize,
    get active() { return active; }
  };
})();
