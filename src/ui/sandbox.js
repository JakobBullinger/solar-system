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
 *
 * Level 20, The What-If Machine: the launcher gained a mass selector. A
 * body with real mass promotes the whole solar system to integrated
 * bodies (nbody.js massive mode) — planets grow truth-telling trails, the
 * now-lying orbit ellipses fade (orbitflow.js), decorative belts hide, and
 * a banner offers the one honest way back: "Restore the real solar
 * system" (an explicit snap back to the Kepler rails). The what-if
 * scenario buttons drop in verified set-pieces: a second Jupiter, a
 * companion star, a rogue-star flyby, and a kinetic-impactor asteroid
 * deflection with a live predicted-miss readout.
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

  // --- Massive bodies (level 20) ----------------------------------------------
  // Launch-mass classes: ratio = body mass / M_sun; radius (AU) is physical
  // (merges fire on swept contact, so it matters); scale sizes the sprite.
  var MASS_CLASSES = {
    probe: null,
    moon: { ratio: 3.694e-8, radius: 1.16e-5, scale: 3.4, label: 'a Moon-mass body', color: '#cfd8e6' },
    earth: { ratio: 3.0035e-6, radius: 4.26e-5, scale: 4.4, label: 'an Earth-mass body', color: '#7fc4ff' },
    jupiter: { ratio: 9.5479e-4, radius: 4.78e-4, scale: 6.5, label: 'a Jupiter-mass body', color: '#ffd27f' },
    bd: { ratio: 0.05, radius: 4.8e-4, scale: 8.5, label: 'a brown dwarf', color: '#ff9a66' },
    rd: { ratio: 0.2, radius: 9.3e-4, scale: 11, label: 'a red dwarf', color: '#ff7050' }
  };
  var massKey = 'probe';           // launcher's selected class
  var massOverride = null;         // scenario-forced launch spec (DART impactor)
  var scenario = null;             // active what-if scenario, or null
  var helioTmp = { x: 0, y: 0, z: 0 };

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
    if (NB.particles.length >= MAX_BODIES) {
      // Evict the oldest massless probe; massive bodies are never evicted
      for (var e = 0; e < visuals.length; e++) {
        if (!visuals[e].p.massive) { removeVisual(visuals[e]); break; }
      }
    }
    var color = colorHex || PALETTE[paletteIdx++ % PALETTE.length];
    var p = NB.addParticle(posAU, velAU, color);
    return makeVisual(p, color, trailLen || TRAIL, 2.6);
  }

  /**
   * Launch a body with real mass: the moment one exists, the whole solar
   * system is promoted to integrated bodies (nbody.js massive mode).
   */
  function spawnMassive(posAU, velAU, spec) {
    var color = spec.color || PALETTE[paletteIdx++ % PALETTE.length];
    var b = NB.addMassive(posAU, velAU, {
      mu: spec.mu !== undefined ? spec.mu : NB.MU * spec.ratio,
      radius: spec.radius,
      label: spec.label,
      color: color,
      jd: spec.jd
    });
    return makeVisual(b, color, spec.trail || TRAIL, spec.scale || 4.4);
  }

  function makeVisual(p, color, trail, spriteScale) {
    if (!glowTex) glowTex = ORRERY.Textures.glowSprite('rgba(255,255,255,0.95)', 'rgba(255,255,255,0.12)');
    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(color),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    sprite.scale.setScalar(spriteScale);

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
      baseScale: spriteScale,                    // ride-along restores to this
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
    // Massive mode must keep integrating even with zero probes on screen
    // (the planets themselves are the simulation); rails keeps its early-out.
    if (!visuals.length && !NB.promoted && !ptrails.length) { easePendJd = null; return; }

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
    tickRegime(jd1, moved);
    for (var i = visuals.length - 1; i >= 0; i--) {
      var vis = visuals[i];
      if (!vis.p.alive) { removeVisual(vis); updateHud(); continue; }
      K.toScene(NB.helioOf(vis.p, helioTmp), headScene);
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

  // --- Massive-mode housekeeping (level 20) --------------------------------------
  var ptrails = [];                // truth-telling trails for promoted planets
  var wasPromoted = false;
  var regimeFrame = 0;

  function tickRegime(jd1, moved) {
    var on = NB.promoted;
    if (on !== wasPromoted) {
      wasPromoted = on;
      if (els.massive) els.massive.classList.toggle('show', on);
      if (!on && els.miss) { els.miss.textContent = ''; els.events.textContent = ''; }
      updateHud();
      // The banner lives at the bottom of a panel that scrolls when it
      // outgrows the viewport (app.css max-height cap) — keep it in view.
      if (on && els.hud) els.hud.scrollTop = els.hud.scrollHeight;
    }
    if (!on && !ptrails.length) return;

    // Honest throttle: when the substep budget saturated (deep encounter),
    // slow the clock instead of letting the physics silently degrade.
    if (on && NB.throttled && Math.abs(ORRERY.TimeBar.rate) > 2) {
      ORRERY.TimeBar.rate *= 0.7;
      els.note.textContent = 'Time slowed — a close encounter needs fine physics steps.';
    }

    updatePlanetTrails(jd1, moved);
    if (++regimeFrame % 20 === 0 && on) {
      els.events.textContent = NB.events.slice(-2).join(' · ');
      if (scenario && scenario.key === 'dart') updateMissReadout();
    }
  }

  function updatePlanetTrails(jd1, moved) {
    if (NB.promoted && !ptrails.length) {
      ORRERY.DATA.PLANETS.forEach(function (pd) {
        if (!NB.planetHelioAU(pd.key, helioTmp)) return;
        var trail = 420;
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(trail * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(trail * 3), 3));
        geo.setDrawRange(0, 0);
        var line = new THREE.Line(geo, new THREE.LineBasicMaterial({
          vertexColors: true, transparent: true, opacity: 0.85,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
        line.frustumCulled = false;
        group.add(line);
        ptrails.push({
          key: pd.key, line: line, count: 0, trail: trail,
          color: new THREE.Color(pd.color), jds: new Float64Array(trail)
        });
      });
    } else if (!NB.promoted && ptrails.length) {
      ptrails.forEach(function (t) { group.remove(t.line); t.line.geometry.dispose(); });
      ptrails.length = 0;
      return;
    }
    if (!moved) return;
    for (var i = 0; i < ptrails.length; i++) {
      var t = ptrails[i];
      var h = NB.planetHelioAU(t.key, helioTmp);
      if (!h || h.alive === false) continue;   // a dead planet's trail freezes
      K.toScene(h, headScene);
      var pos = t.line.geometry.attributes.position;
      var arr = pos.array;
      var last = Math.min(t.count, t.trail - 1);
      for (var j = last; j > 0; j--) {
        arr[j * 3] = arr[(j - 1) * 3];
        arr[j * 3 + 1] = arr[(j - 1) * 3 + 1];
        arr[j * 3 + 2] = arr[(j - 1) * 3 + 2];
        t.jds[j] = t.jds[j - 1];
      }
      arr[0] = headScene.x; arr[1] = headScene.y; arr[2] = headScene.z;
      t.jds[0] = jd1;
      t.count = Math.min(t.count + 1, t.trail);
      t.line.geometry.setDrawRange(0, t.count);
      pos.needsUpdate = true;
      fadeTrail(t, jd1);
    }
  }

  /** The explicit way back: massive bodies vanish, planets snap to rails. */
  function restoreReal() {
    for (var i = visuals.length - 1; i >= 0; i--) {
      if (visuals[i].p.massive) removeVisual(visuals[i]);
    }
    NB.restore();
    scenario = null;
    massOverride = null;
    if (els.miss) { els.miss.textContent = ''; els.events.textContent = ''; }
    els.note.textContent = 'The real solar system is restored — every planet is back on its rail.';
    updateHud();
  }

  /** Kinetic-impactor readout: forward-predict the asteroid vs Earth. */
  function updateMissReadout() {
    var ast = scenario.asteroid;
    if (!ast || !ast.alive) {
      els.miss.classList.toggle('danger', !!(ast && ast.status === 'merged'));
      els.miss.textContent = ast && ast.mergedInto && ast.mergedInto.key === 'earth'
        ? 'The asteroid hit Earth.'
        : 'The asteroid is gone.';
      return;
    }
    var horizon = Math.max(60, scenario.encJd - ORRERY.TimeBar.jd + 90);
    var p = NB.predictApproach(ast, 'earth', horizon);
    if (!p) return;
    var km = Math.round(p.d * 1.495978707e8);
    var hit = p.impact || km < 15000;
    els.miss.classList.toggle('danger', hit);
    els.miss.textContent = hit
      ? 'Predicted: EARTH IMPACT' + (km ? ' (' + km.toLocaleString() + ' km)' : '')
      : 'Predicted Earth miss: ' + km.toLocaleString() + ' km';
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

  // --- What-if scenarios (level 20) -----------------------------------------------
  // Set-pieces for the promoted regime. Every number a caption cites was
  // verified offline against this exact integrator (scan results quoted in
  // the level-20 PR); the constants live here in WHATIF so the scans, the
  // tests and the app share one source of truth.
  var WHATIF = {
    // A Jupiter-mass planet on a circular orbit inside the asteroid belt
    jupiter2: { r: 2.55, ang: 1.0, rate: 60 },
    // 0.2 M☉ red dwarf on a circular orbit just outside Neptune
    companion: { r: 50, rate: 365.25 },
    // 1 M☉ intruder on a hyperbolic pass: v∞ and perihelion set the damage
    rogue: { r0: 55, q: 20, vinfKms: 3, rate: 365.25 },
    // Kinetic-impactor drill: asteroid state baked by offline Lambert seed +
    // Newton shooting against THIS integrator (rebake pattern) — it strikes
    // Earth 270 d after the epoch to within 14 km if nobody intervenes.
    dart: {
      epoch: 2461000.5, encJd: 2461270.5,
      pos: { x: -0.595896, y: -1.961481, z: 0.02 },
      vel: { x: 0.005765676523994166, y: -0.004655531689179438, z: 0.000005092324538846653 },
      astRatio: 2e-20, astRadius: 5e-5,       // ~4e10 kg rock; radius = terminal-guidance capture
      impRatio: 4e-24, impRadius: 1e-5,       // your impactor: ~1/5000 of the asteroid
      rate: 4
    }
  };

  /** Exact hyperbolic entry state for the rogue star (energy + L matched). */
  function rogueState() {
    var W = WHATIF.rogue;
    var NBg = ORRERY.NBody;
    var mu2 = NBg.MU * 2;                     // Sun + intruder, both ~1 M☉
    var vinf = W.vinfKms / NBg.KMS_PER_AUDAY;
    var vq = Math.sqrt(vinf * vinf + 2 * mu2 / W.q);
    var v0 = Math.sqrt(vinf * vinf + 2 * mu2 / W.r0);
    var b = W.q * vq / v0;                    // offset giving L = q·vq at launch speed
    return {
      pos: { x: Math.sqrt(Math.max(W.r0 * W.r0 - b * b, 1)), y: b, z: 0 },
      vel: { x: -v0, y: 0, z: 0 }
    };
  }

  function runScenario(key) {
    clearAll();
    scenario = { key: key };
    var jd = ORRERY.TimeBar.jd;
    var W = WHATIF[key];

    if (key === 'jupiter2') {
      var vc = Math.sqrt(NB.MU / W.r);
      spawnMassive(
        { x: Math.cos(W.ang) * W.r, y: Math.sin(W.ang) * W.r, z: 0 },
        { x: -Math.sin(W.ang) * vc, y: Math.cos(W.ang) * vc, z: 0 },
        specFor('jupiter', 'the second Jupiter'));
      PRESETS.belt(jd);                        // twelve test bodies to stir
      els.note.textContent = 'A second Jupiter now orbits at 2.55 AU, inside the asteroid ' +
        'belt. Verified run: it eats three of the twelve belt bodies within 25 years, and ' +
        'Mars drifts a quarter AU off its real ephemeris within 50 years — almost a full AU ' +
        'in two centuries. (The decorative belt is hidden: massive mode shows only bodies ' +
        'that really integrate.)';
    } else if (key === 'companion') {
      var v = Math.sqrt(NB.MU * 1.2 / W.r);    // two-body circular, relative
      spawnMassive({ x: W.r, y: 0, z: 0 }, { x: 0, y: v, z: 0 },
        specFor('rd', 'the companion star'));
      els.note.textContent = 'A 0.2 M☉ red dwarf now circles at 50 AU. Verified run: within ' +
        '25 years Neptune\'s orbit is visibly eccentric (e ≈ 0.4); within a century it is torn ' +
        'down to a ≈ 17 AU at e ≈ 0.8, crossing the other giants, and Pluto is flung onto a ' +
        'centuries-long ellipse hundreds of AU deep. The same star parked at 300 AU would be ' +
        'invisible in a lifetime — over a millennium the giants barely feel it.';
    } else if (key === 'rogue') {
      var st = rogueState();
      spawnMassive(st.pos, st.vel, {
        mu: NB.MU, radius: 4.65e-3, scale: 13, label: 'the rogue star',
        color: '#fff2c9', trail: 480
      });
      els.note.textContent = 'A sun-mass star is falling in from 55 AU, aimed to pass ' +
        '20 AU out — the plunge takes about 25 years. Verified run: Neptune is thrown out ' +
        'of the solar system, Uranus is left on a wildly eccentric orbit (e ≈ 0.9), Saturn\'s ' +
        'eccentricity jumps eightfold, Pluto is scattered — and the rocky planets barely notice.';
    } else if (key === 'dart') {
      ORRERY.TimeBar.jd = W.epoch;             // eases; physics holds meanwhile
      var vis = spawnMassive(W.pos, W.vel, {
        mu: NB.MU * W.astRatio, radius: W.astRadius, scale: 3.2,
        label: 'the asteroid', color: '#d8c9a3', trail: 480, jd: W.epoch
      });
      scenario.asteroid = vis.p;
      scenario.encJd = W.encJd;
      massOverride = {
        mu: NB.MU * W.impRatio, radius: W.impRadius, scale: 2.6,
        label: 'your impactor', color: '#9be8ff'
      };
      els.note.textContent = 'An asteroid is nine months from hitting Earth — the readout ' +
        'above shows the predicted miss. Drag to launch a kinetic impactor into it (while ' +
        'the drill is armed, every launch is an impactor). Verified: striking it 80 days out ' +
        'deflects it ~17,000 km — a graze; 150 days → ~30,000 km; 220 days → ~68,000 km. ' +
        'Under two months of lead time, the impact still lands.';
    }
    ORRERY.TimeBar.rate = W.rate;
    ORRERY.TimeBar.playing = true;
    updateHud();
    // The caption sits at the bottom of a panel that scrolls when it outgrows
    // the viewport (app.css max-height cap) — show it immediately, before the
    // next frame's tickRegime pins the massive banner too.
    if (els.hud) els.hud.scrollTop = els.hud.scrollHeight;
  }

  function specFor(clsKey, label) {
    var c = MASS_CLASSES[clsKey];
    return {
      ratio: c.ratio, radius: c.radius, scale: c.scale,
      color: c.color, label: label || c.label
    };
  }

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
      onStop: function () { vis.sprite.scale.setScalar(vis.baseScale); }
    });
  }

  function clearAll() {
    while (visuals.length) removeVisual(visuals[0]);
    NB.clear();                       // demotes too: clearing IS the restore
    scenario = null;
    massOverride = null;
    if (els.miss) { els.miss.textContent = ''; els.events.textContent = ''; }
    if (els.massive) els.massive.classList.remove('show');
    wasPromoted = false;
    if (els.note) els.note.textContent = '';
    updateHud();
  }

  // --- HUD ---------------------------------------------------------------------
  function updateHud() {
    var n = NB.particles.filter(function (p) { return p.alive; }).length;
    var bits = [NB.massive.length
      ? n + (n === 1 ? ' probe' : ' probes') + ' · ' + NB.massive.length + ' massive'
      : n + (n === 1 ? ' body' : ' bodies')];
    if (NB.lost.sun) bits.push(NB.lost.sun + ' swallowed by the Sun');
    if (NB.lost.escaped) bits.push(NB.lost.escaped + ' escaped');
    if (NB.lost.impact) bits.push(NB.lost.impact + ' hit a body');
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
    els.massive = document.getElementById('sb-massive');
    els.events = document.getElementById('sb-events');
    els.miss = document.getElementById('sb-miss');
    document.getElementById('sb-clear').addEventListener('click', clearAll);
    document.getElementById('sb-ride').addEventListener('click', rideNewest);
    document.getElementById('sb-restore').addEventListener('click', restoreReal);
    els.hud.querySelectorAll('[data-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        els.note.textContent = '';
        PRESETS[btn.dataset.preset](ORRERY.TimeBar.jd);
      });
    });
    var massBtns = els.hud.querySelectorAll('[data-mass]');
    massBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        massKey = btn.dataset.mass;
        massBtns.forEach(function (b) { b.classList.toggle('on', b === btn); });
      });
    });
    els.hud.querySelectorAll('[data-scenario]').forEach(function (btn) {
      btn.addEventListener('click', function () { runScenario(btn.dataset.scenario); });
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
        // A scenario override (DART impactor) or a selected mass class turns
        // the launch into a massive body; the default probe stays massless.
        var spec = massOverride || MASS_CLASSES[massKey];
        if (spec) spawnMassive(startAU, dragVelocity(e).vel, spec);
        else spawn(startAU, dragVelocity(e).vel);
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

  /** Alive bodies as plain data (capped) — the permalink's payload.
   *  Serialized heliocentric, so a link cut in massive mode still replays
   *  its probes sanely in a rails world (masses themselves don't travel). */
  function serialize() {
    return NB.particles
      .filter(function (p) { return p.alive; })
      .slice(0, 24)
      .map(function (p) {
        var hp = NB.helioOf(p, {});
        var hv = NB.helioVelOf(p, {});
        return {
          pos: [hp.x, hp.y, hp.z],
          vel: [hv.x, hv.y, hv.z],
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
    runScenario: runScenario,
    restoreReal: restoreReal,
    get active() { return active; },
    // Offline scans and tests drive the exact scenario constants (level 20)
    _dev: {
      MASS_CLASSES: MASS_CLASSES,
      WHATIF: WHATIF,
      rogueState: rogueState,
      get scenario() { return scenario; }
    }
  };
})();
