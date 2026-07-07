/**
 * main.js — Application bootstrap: scene graph, render loop,
 * camera choreography, picking, and view options.
 */
(function () {
  'use strict';

  var K = ORRERY.Kepler;
  var DATA = ORRERY.DATA;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Renderer / scene -----------------------------------------------------
  var canvas = document.getElementById('scene');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(50, 1, 0.1, 12000);

  var controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 4;
  controls.maxDistance = 2600;

  scene.add(new THREE.AmbientLight(0x1c2330, 1.4));
  var sunLight = new THREE.PointLight(0xfff2dc, 1.8, 0, 2);
  scene.add(sunLight);

  // --- Build the system -----------------------------------------------------
  var starfield = ORRERY.Environment.starfield();
  scene.add(starfield);
  var asteroids = ORRERY.Environment.asteroidBelt();
  var kuiper = ORRERY.Environment.kuiperBelt();
  scene.add(asteroids, kuiper);

  var sun = ORRERY.Bodies3D.buildSun(DATA.SUN);
  scene.add(sun);

  var planets = [];
  var orbitLines = new THREE.Group();
  var jd0 = K.julianDate(Date.now());

  DATA.PLANETS.forEach(function (p) {
    var group = ORRERY.Bodies3D.buildPlanet(p);
    scene.add(group);
    planets.push(group);
    // OrbitFlow overlays each orbit line with its Kepler-true stream;
    // `true` = fade this ellipse out in massive mode (it lies off-rails)
    orbitLines.add(ORRERY.OrbitFlow.attach(ORRERY.Bodies3D.buildOrbitLine(p, jd0), p, jd0, true));
  });

  var comets = [];
  DATA.COMETS.forEach(function (c) {
    var group = ORRERY.Comets3D.build(c);
    scene.add(group);
    comets.push(group);
    orbitLines.add(ORRERY.OrbitFlow.attach(ORRERY.Comets3D.buildOrbitLine(c, jd0), c, jd0));
  });
  scene.add(orbitLines);

  var selectables = [sun].concat(planets, comets);

  // Moons become first-class selectable entries; the parent link lets the
  // panel navigate between a planet and its moons, and keeps moon labels
  // hidden until you're actually visiting that neighbourhood.
  var registry = {};
  selectables.forEach(function (e) { registry[e.userData.body.key] = e; });

  var moonEntries = [];
  planets.forEach(function (g) {
    g.userData.moons.forEach(function (m) {
      m.mesh.userData = {
        body: m.data,
        mesh: m.mesh,
        enhancedRadius: m.sceneRadius,
        moons: [],
        parentGroup: g,
        labelClass: ' small',
        labelWhen: function () {
          return follow === m.mesh || follow === g ||
            (follow !== null && follow.userData.parentGroup === g);
        }
      };
      moonEntries.push(m.mesh);
      registry[m.data.key] = m.mesh;
    });
  });
  // Lagrange-point markers + Trojan swarms: selectable, but not on the rail
  var lagrange = ORRERY.Lagrange3D.build();
  scene.add(lagrange.group);
  lagrange.entries.forEach(function (e) { registry[e.userData.body.key] = e; });

  var pickables = selectables.concat(moonEntries, lagrange.entries);

  // --- UI -------------------------------------------------------------------
  ORRERY.CameraPath.init({ camera: camera, controls: controls });
  ORRERY.TrajAnim.init({ scene: scene });
  ORRERY.TimeBar.init();
  ORRERY.Panel.init(
    function () { follow = null; },
    function (key) { if (registry[key]) select(registry[key]); }
  );
  ORRERY.Labels.init(pickables, select);
  ORRERY.AlmanacUI.init(function (ev) {
    ORRERY.TimeBar.jd = ev.jd;
    ORRERY.TimeBar.playing = false;   // hold the alignment still to look at it
    if (registry[ev.bodyKey]) select(registry[ev.bodyKey]);
  });
  ORRERY.Sandbox.init({ scene: scene, camera: camera, canvas: canvas, controls: controls });
  ORRERY.Ride.init({
    camera: camera,
    controls: controls,
    canvas: canvas,
    avoid: [{ obj: sun, radius: DATA.SUN.sceneRadius }].concat(
      planets.map(function (g) { return { obj: g, radius: g.userData.enhancedRadius }; })
    )
  });
  ORRERY.Missions.init({ scene: scene, camera: camera, canvas: canvas, controls: controls });
  // Physics-visualization overlays (gravity landscape, speed colours,
  // resonance roses, the Sun's wobble) — vizpanel owns all their wiring.
  ORRERY.VizPanel.init({
    scene: scene, camera: camera, orbitLines: orbitLines, planets: planets,
    getFollow: function () { return follow; }
  });
  ORRERY.Porkchop.init();
  ORRERY.MarsPlanner.init({ scene: scene });
  ORRERY.Tour.init({
    registry: registry,
    focus: focus,
    clearFocus: function () { follow = null; },
    flyHome: flyHome,
    controls: controls
  });
  // Powers of Ten: scrolling out past maxDistance hands the camera to the
  // cosmic zoom (cosmos.js), which fades the orrery and takes over until
  // the user scrolls back in. Everything cosmos needs to fade is passed
  // here; it never touches anything else.
  ORRERY.Cosmos.init({
    scene: scene, camera: camera, canvas: canvas, controls: controls,
    orrery: {
      orbitLines: orbitLines,
      belts: [asteroids, kuiper],
      solids: [sun].concat(planets, comets, [lagrange.group]),
      starfield: starfield,
      labelsOn: function () { return opts.labels; }
    },
    guards: function () {
      return ORRERY.Ride.active || ORRERY.Tour.active ||
        ORRERY.Sandbox.active || ORRERY.Missions.active;
    },
    onEnter: function () { follow = null; }   // cosmos cancels flights itself
  });
  // Idle attract mode: slow composed shots once nothing has been touched
  // for a while; any mode that owns the camera or the screen blocks it.
  ORRERY.Director.init({
    registry: registry,
    camera: camera,
    controls: controls,
    setFollow: function (entry) { follow = entry; },
    clearFocus: function () { follow = null; },
    guards: function () {
      return ORRERY.Ride.active || ORRERY.Tour.active || ORRERY.Sandbox.active ||
        ORRERY.Missions.active || ORRERY.Cosmos.active || ORRERY.Replays.active ||
        !!document.querySelector('#panel.open, #events.open, #porkchop.open, #marsplan.open');
    }
  });

  // Planet nav rail
  var rail = document.getElementById('rail');
  selectables.forEach(function (entry) {
    var b = entry.userData.body;
    var chip = document.createElement('button');
    chip.className = 'chip';
    chip.innerHTML = '<span class="chip-dot" style="background:' + b.color + '"></span>' + b.name;
    chip.addEventListener('click', function () { select(entry); });
    rail.appendChild(chip);
    entry.userData.chip = chip;
  });

  // View toggles
  var opts = { orbits: true, labels: true, trueSize: false, sandbox: false, lagrange: false, flow: true };
  function bindToggle(id, key, apply) {
    var el = document.getElementById(id);
    el.setAttribute('aria-pressed', String(opts[key]));
    el.addEventListener('click', function () {
      opts[key] = !opts[key];
      el.setAttribute('aria-pressed', String(opts[key]));
      apply(opts[key]);
    });
  }
  bindToggle('opt-orbits', 'orbits', function (on) { orbitLines.visible = on; });
  bindToggle('opt-flow', 'flow', function (on) { ORRERY.OrbitFlow.setEnabled(on); });
  bindToggle('opt-labels', 'labels', function (on) { ORRERY.Labels.setVisible(on); });
  bindToggle('opt-true', 'trueSize', applyScaleMode);
  bindToggle('opt-sandbox', 'sandbox', function (on) { ORRERY.Sandbox.setMode(on); });
  bindToggle('opt-lagrange', 'lagrange', function (on) { ORRERY.Lagrange3D.setMarkersVisible(on); });

  var scaleLerp = { value: 0, target: 0 };
  function applyScaleMode(on) {
    scaleLerp.target = on ? 1 : 0;
    document.getElementById('scale-note').classList.toggle('show', on);
    // Moons vanish in true-size mode; hand the camera back to the parent
    if (on && follow && follow.userData.parentGroup) {
      select(follow.userData.parentGroup);
    }
  }

  // --- Selection & camera choreography --------------------------------------
  // Flights (focus / fly home) ride ORRERY.CameraPath — the shared primitive
  // owns the tween, reduced-motion snapping, and the one-flight-at-a-time rule.
  var follow = null;
  var HOME_POS = new THREE.Vector3(0, 165, 330);

  /** Camera-only part of selection: follow a body and fly the camera to it. */
  function focus(entry, distMul) {
    follow = entry;
    var target = entry.getWorldPosition(new THREE.Vector3());
    var r = entry.userData.isSun ? DATA.SUN.sceneRadius : entry.userData.enhancedRadius;
    var dist = Math.max(r * 7, 6) * (distMul || 1);
    var dir = camera.position.clone().sub(controls.target).normalize();
    ORRERY.CameraPath.begin({
      to: target.add(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, dist * 0.35, 0))
    });
  }

  function flyHome() {
    ORRERY.CameraPath.begin({ to: HOME_POS });
  }

  function select(entry) {
    if (ORRERY.Cosmos.active) ORRERY.Cosmos.exit(); // chip click from deep space → come home
    focus(entry, 1);
    ORRERY.Panel.show(entry);
    selectables.forEach(function (s) {
      s.userData.chip.classList.toggle('active',
        s === entry || s === entry.userData.parentGroup);
    });
  }

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Escape') ORRERY.Panel.close();
  });

  // Picking
  var raycaster = new THREE.Raycaster();
  var pointer = new THREE.Vector2();
  var downAt = { x: 0, y: 0 };
  canvas.addEventListener('pointerdown', function (e) {
    downAt.x = e.clientX; downAt.y = e.clientY;
  });
  canvas.addEventListener('pointerup', function (e) {
    if (ORRERY.Sandbox.active) return; // sandbox owns the pointer while armed
    if (ORRERY.Tour.active) return;    // no dossier pop-ups mid-tour
    if (ORRERY.Ride.active) return;    // the ride owns the camera
    if (ORRERY.Missions.aiming) return; // aiming owns the pointer
    if (ORRERY.Cosmos.active) return;   // cosmos does its own screen-space picking
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return; // drag, not click
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    var meshes = pickables.map(function (s) { return s.userData.mesh; });
    var hits = raycaster.intersectObjects(meshes).filter(function (h) {
      // Skip meshes hidden by an invisible ancestor (moons in true-size mode)
      for (var o = h.object; o; o = o.parent) if (o.visible === false) return false;
      return true;
    });
    if (hits.length) {
      var mesh = hits[0].object;
      var entry = pickables.find(function (s) { return s.userData.mesh === mesh; });
      if (entry) select(entry);
    }
  });

  // --- Resize ----------------------------------------------------------------
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // --- Intro -----------------------------------------------------------------
  if (!reducedMotion) camera.position.set(0, 620, 1150);
  flyHome();
  controls.target.set(0, 0, 0);

  // Deep-linked state (must come after the intro so a ?body fly-to wins),
  // then the first-visit tour offer if the URL carried nothing.
  ORRERY.Permalink.init({
    registry: registry,
    select: select,
    selectedKey: function () {
      return follow && follow.userData.body ? follow.userData.body.key : null;
    }
  });
  ORRERY.Challenge.init();   // a ?ch= link starts a ghost mission replay
  ORRERY.Tour.maybeOffer();
  ORRERY.Header.init();      // after the features: it observes their buttons

  // --- Render loop -------------------------------------------------------------
  var clock = new THREE.Clock();
  var tmp = new THREE.Vector3();
  var pvTmp = { x: 0, y: 0, z: 0, alive: true };
  var jdPrev = ORRERY.TimeBar.jd;

  function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.1);

    ORRERY.TimeBar.tick(dt);
    var jd = ORRERY.TimeBar.jd;
    var daysSinceEpoch = jd - K.J2000;

    ORRERY.Sandbox.tick(jdPrev, jd);
    ORRERY.Missions.tick(jd);
    ORRERY.Cosmos.tick(dt, jd);
    ORRERY.TrajAnim.tick(dt, jd);   // after Sandbox: draw-ins own draw ranges
    ORRERY.OrbitFlow.tick(jd);
    ORRERY.Director.tick(dt);
    jdPrev = jd;

    // Positions from the physics. In massive mode (level 20) a promoted
    // planet renders from the integrator, not its Kepler rail — and a
    // planet the regime killed (swallowed, ejected) honestly disappears.
    planets.forEach(function (group) {
      var b = group.userData.body;
      var pv = ORRERY.NBody.planetHelioAU(b.key, pvTmp);
      if (pv) {
        K.toScene(pv, group.position);
        group.visible = pv.alive !== false;
      } else {
        K.scenePosition(b.el, jd, group.position);
        if (!group.visible) group.visible = true;
      }

      // Axial spin (rotationHours sign encodes retrograde)
      var spins = (daysSinceEpoch * 24 / b.rotationHours) % 1;
      group.userData.mesh.rotation.y = spins * Math.PI * 2;
      if (group.userData.clouds) {
        // Cloud deck drifts relative to the surface
        group.userData.clouds.rotation.y = spins * Math.PI * 2 * 0.92;
      }

      // Moons: circular orbits at true relative periods
      group.userData.moons.forEach(function (m) {
        m.pivot.rotation.y = (daysSinceEpoch / m.data.orbitDays) * Math.PI * 2;
      });

      // Size mode crossfade
      var s = 1 + (group.userData.trueScale - 1) * scaleLerp.value;
      group.userData.mesh.scale.setScalar(s);
      if (group.userData.clouds) group.userData.clouds.scale.setScalar(s);
    });

    // Moon visibility fades out in true-size mode (they'd be sub-pixel)
    if (Math.abs(scaleLerp.value - scaleLerp.target) > 0.001) {
      scaleLerp.value += (scaleLerp.target - scaleLerp.value) * (reducedMotion ? 1 : 0.08);
      planets.forEach(function (g) {
        g.userData.moons.forEach(function (m) {
          m.pivot.visible = scaleLerp.value < 0.5;
        });
      });
    }

    comets.forEach(function (c) { ORRERY.Comets3D.update(c, jd); });
    ORRERY.Lagrange3D.update(jd);
    ORRERY.VizPanel.tick(jd);

    sun.userData.mesh.rotation.y = (daysSinceEpoch * 24 / DATA.SUN.rotationHours) * Math.PI * 2;
    // Belts are decorative point clouds that do not integrate — massive
    // mode hides them honestly (the sandbox caption says so).
    asteroids.visible = kuiper.visible = !ORRERY.NBody.promoted;
    asteroids.rotation.y += asteroids.userData.spinRate * dt;
    kuiper.rotation.y += kuiper.userData.spinRate * dt;

    // Camera: ride-along owns it entirely; otherwise flight + follow.
    // A flight begun mid-ride is deliberately never ticked here — Ride
    // cancels it on exit, so it can neither fight the chase nor resume.
    if (ORRERY.Ride.active) {
      ORRERY.Ride.tick(dt);
    } else {
      ORRERY.CameraPath.tick(dt);
      if (follow) {
        follow.getWorldPosition(tmp);
        controls.target.lerp(tmp, reducedMotion ? 1 : 0.12);
      } else {
        controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.05);
      }
      controls.update();
    }

    ORRERY.Panel.tick(jd);
    ORRERY.Labels.update(camera, window.innerWidth, window.innerHeight);
    ORRERY.Shaders.update(dt);

    renderer.render(scene, camera);
  }

  animate();
})();
