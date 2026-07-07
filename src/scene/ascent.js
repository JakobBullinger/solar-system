/**
 * ascent.js — "Ride a launch": a chase-cam ride along the baked pad-to-ISS
 * ascent (src/data/ascentprofile.js) inside the Earth-orbit regime.
 *
 * Physics tier: offline-baked 2D point-mass integration (see
 * ascentprofile.js's header) — the trajectory here is real physics found by
 * bisection, not a scripted flight path. This module is pure presentation:
 * it reads ORRERY.AscentProfile.stateAtMissionTime(t) every frame, places a
 * marker sprite + growing trail along the equatorial-frame position, and
 * chases it with a hand-rolled camera (the ride.js PATTERN — position
 * behind the direction of travel with exponential smoothing — reimplemented
 * locally rather than calling into ride.js's shared singleton: ORRERY.Ride
 * is a cross-mode guard elsewhere [main.js's Cosmos/EarthOrbit `guards`
 * check `ORRERY.Ride.active`], so touching it from inside EarthOrbit would
 * make the regime think a conflicting mode had opened and exit itself).
 *
 * At this scale a real Falcon-9-class rocket is a few dozen meters — many
 * orders of magnitude under a pixel (1 scene unit = 1,000 km here, same as
 * earthorbit.js) — so, like the ISS itself in earthorbit.js, it renders as
 * a glow sprite plus its flown path, honestly captioned as a marker.
 *
 * Time: the regime's own TimeBar is what actually drives every position
 * (satellites, ISS, Earth spin, this rocket) — this module doesn't run its
 * own separate clock. During the scripted ascent+coast it drives
 * ORRERY.TimeBar via snapJd() (the instant-teleport entry point timebar.js
 * documents for exactly this "choreography that immediately re-integrates
 * against the new date" case — plain `TimeBar.jd = v` EASES any jump over a
 * day, which every ride frame is, since the epoch is baked near J2000) at a
 * phase-dependent compression: 6× real through the ~7-minute powered
 * ascent, 45× through the ~44-minute coast — both "readable": stage events
 * read as distinct beats, not a blur. Once
 * circularized it hands the clock back to the regime's OWN rate mechanism
 * at the "real" preset (1/86400, identical to earthorbit.js's own real-time
 * button) — the ride's final "parked alongside the ISS" state is literally
 * just riding the regime's normal clock from then on, so its own rate
 * buttons keep working exactly as documented.
 *
 * Entry/exit: mount() is called once from earthorbit.js's buildAll() (a
 * button appended into its DOM) and tick()/stop() from its tick()/exit()/
 * onKey() — the only hooks earthorbit.js carries. Every start() snapshots
 * camera pose, controls.enabled and the TimeBar {jd, rate, playing}; stop()
 * (Esc mid-ride, the ride's own exit button, or the whole regime exiting)
 * restores all of it exactly, and clears the scene group — nothing keeps
 * running after exit.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Ascent = (function () {
  'use strict';

  var KM = 0.001;                 // scene units per km — same convention as earthorbit.js
  var EARTH_R = 6.371;             // scene units — must not let the chase camera clip inside
  var ASCENT_COMPRESSION = 6;      // × real time through the ~7 min powered ascent
  var COAST_COMPRESSION = 45;      // × real time through the ~44 min unpowered coast
  var FLARE_DURATION = 1.6;        // s, real time (unaffected by compression, so it always reads)

  var mounted = false, active = false, state = 'idle';   // state: idle | flying | parked
  var eoCtx = null, frame = null, A = null;
  var group = null, rocketSprite = null, trailLine = null, trailAttr = null;
  var trailCount = 0, TRAIL_MAX = 3000;
  var flares = [];
  var dom = {};
  var beats = [], beatIndex = 0;
  var saved = null;
  var missionElapsed = 0;
  var back = 0.03;
  var first = true;
  var dir = new THREE.Vector3(0, 1, 0);
  var prevWorld = new THREE.Vector3();
  var smoothTarget = new THREE.Vector3();
  var dCam = new THREE.Vector3(), dTar = new THREE.Vector3(), vWorld = new THREE.Vector3();
  var UP = new THREE.Vector3(0, 1, 0);

  // --- Scene ------------------------------------------------------------------------
  function buildScene() {
    group = new THREE.Group();
    group.visible = false;
    frame.add(group);

    rocketSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ORRERY.Textures.glowSprite('rgba(255,255,255,0.95)', 'rgba(255,190,120,0.35)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    rocketSprite.scale.setScalar(0.5);
    group.add(rocketSprite);

    trailAttr = new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', trailAttr);
    geo.setDrawRange(0, 0);
    trailLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xFFC978, transparent: true, opacity: 0.85
    }));
    trailLine.frustumCulled = false;
    group.add(trailLine);
  }

  function spawnFlare(localPos) {
    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ORRERY.Textures.glowSprite('rgba(255,255,255,1)', 'rgba(255,170,90,0.5)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 1
    }));
    sprite.position.copy(localPos);
    sprite.scale.setScalar(0.4);
    group.add(sprite);
    flares.push({ sprite: sprite, t: 0 });
  }

  function updateFlares(dtReal) {
    for (var i = flares.length - 1; i >= 0; i--) {
      var f = flares[i];
      f.t += dtReal;
      var p = Math.min(1, f.t / FLARE_DURATION);
      f.sprite.scale.setScalar(0.4 + p * 2.6);
      f.sprite.material.opacity = 1 - p;
      if (p >= 1) {
        group.remove(f.sprite);
        f.sprite.material.map = null;
        f.sprite.material.dispose();
        flares.splice(i, 1);
      }
    }
  }

  /** Equatorial km -> frame-local scene units, same formula as earthorbit.js eqToLocal. */
  function eciToLocal(p, out) {
    return out.set(p.x * KM, p.z * KM, -p.y * KM);
  }

  // --- DOM --------------------------------------------------------------------------
  function fmt(n, d) { return n.toFixed(d === undefined ? 1 : d); }

  function buildBeats() {
    var P = A.PROFILE, m = P.milestones;
    var az = P.constants.AZIMUTH_DEG;
    beats = [
      { t: 0, title: 'Liftoff', body: 'Cape Canaveral, 28.5°N — azimuth ' + fmt(az, 0) +
          '° NE, the real heading for a 51.6° ISS-compatible inclination from this latitude.' },
      { t: P.maxQ.t, title: 'Max-Q', flare: true, body: 'Peak aerodynamic pressure, ' + fmt(P.maxQ.alt) +
          ' km up — the roughest few seconds of the ride.' },
      { t: m.stage1Cutoff.t, title: 'MECO', flare: true, body: 'Stage 1 cutoff: ' + fmt(m.stage1Cutoff.alt, 0) +
          ' km, ' + fmt(m.stage1Cutoff.v, 2) + ' km/s. Stage separation.' },
      { t: m.stageIgnition2.t, title: 'Stage 2 ignition', body: 'Second stage picks up the burn toward orbit.' },
      { t: m.seco.t, title: 'SECO', flare: true, body: 'Second-stage cutoff: ' + fmt(m.seco.alt, 0) + ' km, ' +
          fmt(m.seco.v, 2) + ' km/s — an elliptical transfer orbit, apogee ahead.' },
      { t: m.seco.t + 1.5, title: 'Coasting to apogee', body: 'Unpowered for ' + fmt(P.tToApogee / 60, 0) +
          ' real minutes, shown heavily sped up, while the orbit climbs to 420 km.' },
      { t: P.missionDurationSeconds, title: 'Circularization', flare: true,
          body: fmt(m.circularization.dv * 1000, 0) + ' m/s burn at apogee closes the orbit: 420 km, ' +
          fmt(P.vCirc, 2) + ' km/s — the same speed the ISS itself holds.' },
      { t: P.missionDurationSeconds + 3, title: 'In orbit', body: 'Alongside the ISS, ' +
          'same plane, closing slowly — a kinematic finish, not a docking.' }
    ];
  }

  function showBeat(i) {
    if (i < 0 || i >= beats.length) return;
    var b = beats[i];
    dom.title.textContent = b.title;
    dom.body.textContent = b.body;
    if (b.flare) spawnFlare(rocketSprite.position);
  }

  function updateBeats(curT) {
    while (beatIndex < beats.length && beats[beatIndex].t <= curT) {
      showBeat(beatIndex);
      beatIndex++;
    }
  }

  function buildDom(container) {
    dom.launchBtn = document.createElement('button');
    dom.launchBtn.className = 'asc-launch-btn';
    dom.launchBtn.id = 'asc-launch';
    dom.launchBtn.type = 'button';
    dom.launchBtn.textContent = 'Ride a launch — pad to ISS';
    dom.launchBtn.addEventListener('click', start);
    container.appendChild(dom.launchBtn);

    dom.hud = document.createElement('div');
    dom.hud.className = 'asc-hud';
    dom.hud.id = 'asc-hud';
    dom.hud.innerHTML =
      '<div class="asc-caption"><h3 class="asc-title"></h3><p class="asc-body"></p></div>' +
      '<button class="asc-exit" id="asc-exit" type="button">Exit ride</button>';
    document.body.appendChild(dom.hud);
    dom.title = dom.hud.querySelector('.asc-title');
    dom.body = dom.hud.querySelector('.asc-body');
    document.getElementById('asc-exit').addEventListener('click', stop);

    var canvas = eoCtx.canvas;
    canvas.addEventListener('wheel', function (e) {
      if (!active) return;
      e.preventDefault();
      back *= Math.exp(e.deltaY * 0.0015);
      back = Math.max(0.01, Math.min(3, back));
    }, { passive: false });
  }

  // --- Mount (called once from earthorbit.js buildAll()) -----------------------------
  function mount(opts) {
    if (mounted) return;
    mounted = true;
    eoCtx = opts.ctx;
    frame = opts.frame;
    A = ORRERY.AscentProfile;
    buildScene();
    buildBeats();
    buildDom(opts.container);
  }

  // --- Start / stop -------------------------------------------------------------------
  function start() {
    if (!mounted || active || !eoCtx) return;
    active = true;
    state = 'flying';
    missionElapsed = 0;
    beatIndex = 0;
    first = true;
    trailCount = 0;
    trailLine.geometry.setDrawRange(0, 0);
    group.visible = true;

    saved = {
      camPos: eoCtx.camera.position.clone(),
      target: eoCtx.controls.target.clone(),
      controlsEnabled: eoCtx.controls.enabled,
      jd: ORRERY.TimeBar.jd,
      rate: ORRERY.TimeBar.rate,
      playing: ORRERY.TimeBar.playing
    };
    ORRERY.CameraPath.cancel();
    eoCtx.controls.enabled = false;
    ORRERY.TimeBar.playing = false;
    ORRERY.TimeBar.snapJd(A.PROFILE.jd0);   // instant — TimeBar.jd= would ease a >1-day jump

    document.body.classList.add('riding-ascent');
    dom.hud.classList.add('show');
    showBeat(0);
    beatIndex = 1;
  }

  function cleanupFlares() {
    flares.forEach(function (f) {
      group.remove(f.sprite);
      f.sprite.material.dispose();
    });
    flares.length = 0;
  }

  function stop() {
    if (!active) return;
    active = false;
    state = 'idle';
    group.visible = false;
    cleanupFlares();

    eoCtx.controls.enabled = saved.controlsEnabled;
    eoCtx.controls.target.copy(saved.target);
    ORRERY.CameraPath.begin({ to: saved.camPos, instant: true });
    ORRERY.TimeBar.snapJd(saved.jd);
    ORRERY.TimeBar.rate = saved.rate;
    ORRERY.TimeBar.playing = saved.playing;

    document.body.classList.remove('riding-ascent');
    dom.hud.classList.remove('show');
  }

  function enterParked() {
    state = 'parked';
    ORRERY.TimeBar.rate = 1 / 86400;   // identical to earthorbit.js's own "real" rate preset
    ORRERY.TimeBar.playing = true;
  }

  var localTmp = new THREE.Vector3(), lastTrailTmp = new THREE.Vector3();

  // --- Per-frame update -----------------------------------------------------------------
  function updateRocket() {
    var st = A.stateAtMissionTime(missionElapsed);
    var eci = A.toECI(st.x, st.y, A.PROFILE.constants.TARGET_INC_DEG, A.PROFILE.omegaAscentDeg);
    eciToLocal(eci, localTmp);
    rocketSprite.position.copy(localTmp);

    var farEnough = trailCount === 0 ||
      lastTrailTmp.set(trailAttr.getX(trailCount - 1), trailAttr.getY(trailCount - 1), trailAttr.getZ(trailCount - 1))
        .distanceTo(localTmp) > 0.01;
    if (farEnough && trailCount < TRAIL_MAX) {
      trailAttr.setXYZ(trailCount, localTmp.x, localTmp.y, localTmp.z);
      trailCount++;
      trailAttr.needsUpdate = true;
      trailLine.geometry.setDrawRange(0, trailCount);
    }
    return st;
  }

  function updateCamera(dtReal) {
    frame.updateMatrixWorld(true);
    vWorld.copy(rocketSprite.position);
    frame.localToWorld(vWorld);

    if (first) {
      prevWorld.copy(vWorld);
      smoothTarget.copy(vWorld);
      dir.copy(vWorld).normalize();
      if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
      first = false;
    }
    var moved = vWorld.clone().sub(prevWorld);
    if (moved.length() > 1e-6) dir.copy(moved).normalize();
    prevWorld.copy(vWorld);

    dCam.copy(vWorld).addScaledVector(dir, -back).addScaledVector(UP, back * 0.45);
    if (dCam.length() < EARTH_R * 1.05) dCam.setLength(EARTH_R * 1.05);

    var k = 1 - Math.exp(-dtReal * 5);
    eoCtx.camera.position.lerp(dCam, k);
    dTar.copy(vWorld).addScaledVector(dir, back * 1.3);
    smoothTarget.lerp(dTar, k);
    eoCtx.camera.lookAt(smoothTarget);
    eoCtx.controls.target.copy(smoothTarget);
  }

  function tick(dtReal) {
    if (!active) return;

    if (state === 'flying') {
      var comp = missionElapsed < A.PROFILE.constants.T_SECO ? ASCENT_COMPRESSION : COAST_COMPRESSION;
      missionElapsed += dtReal * comp;
      if (missionElapsed >= A.PROFILE.missionDurationSeconds) {
        missionElapsed = A.PROFILE.missionDurationSeconds;
      }
      ORRERY.TimeBar.snapJd(A.PROFILE.jd0 + missionElapsed / 86400);   // instant, no ease
      if (missionElapsed >= A.PROFILE.missionDurationSeconds) enterParked();
    } else if (state === 'parked') {
      missionElapsed = (ORRERY.TimeBar.jd - A.PROFILE.jd0) * 86400;
    }

    updateRocket();
    updateBeats(missionElapsed);   // after updateRocket: flares spawn at the current position
    updateCamera(dtReal);
    updateFlares(dtReal);
  }

  return {
    mount: mount,
    tick: tick,
    start: start,
    stop: stop,
    get active() { return active; },
    /** Headless-verification hook: mission-elapsed time + rocket state + phase. */
    debug: function () {
      if (!mounted) return null;
      var st = A.stateAtMissionTime(missionElapsed);
      return {
        active: active, state: state, missionElapsed: missionElapsed,
        alt: st.alt, speed: st.speed, phase: st.phase, beatIndex: beatIndex,
        jd: ORRERY.TimeBar.jd
      };
    }
  };
})();
