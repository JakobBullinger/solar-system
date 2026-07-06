/**
 * missions.js — Mission Designer: the gravity sandbox with goals.
 *
 * Each mission is a departure burn from Earth against a hard Δv budget:
 * drag to set the burn (direction = where you push, length = Δv added to
 * Earth's own orbital velocity — zero drag means you simply ride along
 * with Earth). While aiming, a time-accurate preview integrates the flight
 * with the planets MOVING and live-reports the closest approach to the
 * target, so the launch-window hunt — scrub the time bar, watch the
 * geometry — is the actual gameplay. Scoring: stars by Δv efficiency
 * against par, best results kept in localStorage.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Missions = (function () {
  'use strict';

  var KMS = 1731.456;              // 1 AU/day in km/s
  var DV_PER_PX = 0.055;           // km/s of burn per pixel dragged
  var PREVIEW_STEPS = 1100;        // × 2 days ≈ 6 years of lookahead
  var PREVIEW_H = 2;
  var PREVIEW_N = 220;             // points kept for the drawn arc

  var MISSIONS = [
    {
      key: 'mars', name: 'Mars Express', targetKey: 'mars', tol: 0.05,
      budget: 6, par: 3.6, limitY: 6,
      desc: 'Fly within 0.05 AU of Mars.',
      hint: 'Windows open every ~26 months. Burn prograde when Mars leads Earth — your arc rises outward to meet it.'
    },
    {
      key: 'venus', name: 'Morning Star', targetKey: 'venus', tol: 0.05,
      budget: 6, par: 3.5, limitY: 5,
      desc: 'Fall inward and meet Venus.',
      hint: 'Going in means slowing down: burn against Earth’s motion and let the Sun pull you inward.'
    },
    {
      key: 'jupiter', name: 'King of Worlds', targetKey: 'jupiter', tol: 0.15,
      budget: 11, par: 9.3, limitY: 9,
      desc: 'Reach within 0.15 AU of Jupiter.',
      hint: 'A long prograde burn and a long cruise — aim far ahead of where Jupiter is today.'
    },
    {
      key: 'grazer', name: 'Icarus', special: 'sunGraze', rGoal: 0.08,
      budget: 21, par: 18.8, limitY: 4,
      desc: 'Skim inside 0.08 AU of the Sun — and survive.',
      hint: 'Earth moves at 29.8 km/s. To fall, you must throw almost all of it away — burn hard retrograde.'
    },
    {
      key: 'escape', name: 'Starman', special: 'escape',
      budget: 14, par: 12.6, limitY: 20,
      desc: 'Break the Sun’s grip and leave the solar system.',
      hint: 'Escape velocity at Earth’s distance is 42.1 km/s. Every km/s of prograde burn counts double out here.'
    },
    {
      key: 'grandtour', name: 'Grand Tour ’77', special: 'slingshot',
      targetKey: 'jupiter', flybyTol: 0.1, reachR: 9.2,
      budget: 11.5, par: 11.1, limitY: 5.5, epoch: 2443330.5,
      desc: 'Fly by Jupiter under 0.1 AU and let its gravity fling you out across Saturn’s orbit (9.2 AU) — within 5½ years.',
      hint: 'The clock is set to the 1977 window Voyager used. Aim at where Jupiter WILL be — the gold arc shows when the slingshot works. No burn on this budget coasts that far that fast alone.'
    }
  ];

  var K, NB, DATA;
  var camera, canvas, controls;
  var els = {};
  var group;                       // preview visuals
  var state = 'closed';            // closed | list | brief | aim | flight | result
  var current = null;
  var attempt = null;
  var stars = {};

  // ---- Persistence -----------------------------------------------------------
  function loadStars() {
    try { stars = JSON.parse(localStorage.getItem('orrery-mission-stars') || '{}'); }
    catch (e) { stars = {}; }
  }
  function saveStars() {
    try { localStorage.setItem('orrery-mission-stars', JSON.stringify(stars)); } catch (e) { }
  }
  function starStr(n) {
    return '★★★'.slice(0, n) + '<span class="ms-star-dim">' + '★★★'.slice(0, 3 - n) + '</span>';
  }

  // ---- Earth departure state ---------------------------------------------------
  function earthState(jd) {
    var el = null;
    DATA.PLANETS.forEach(function (p) { if (p.key === 'earth') el = p.el; });
    var e = K.heliocentric(el, jd);
    var e2 = K.heliocentric(el, jd + 0.5);
    var e1 = K.heliocentric(el, jd - 0.5);
    return {
      pos: { x: e.x, y: e.y, z: e.z },
      vel: { x: e2.x - e1.x, y: e2.y - e1.y, z: e2.z - e1.z }
    };
  }

  function targetEl() {
    var el = null;
    if (current.targetKey) {
      DATA.PLANETS.forEach(function (p) { if (p.key === current.targetKey) el = p.el; });
    }
    return el;
  }

  // ---- Aiming ---------------------------------------------------------------------
  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();
  var ecliptic = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  var hit = new THREE.Vector3();
  var dragging = false;
  var startAU = null, startPx = { x: 0, y: 0 };
  var lastEvent = null, lastPreviewAt = 0;
  var previewLine, burnLine, targetMark;

  function pickEcliptic(e, out) {
    ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(ecliptic, out) !== null;
  }

  function sceneToAU(v) {
    var r = v.length();
    if (r < 1e-6) return { x: 0.05, y: 0, z: 0 };
    var au = Math.pow(r / K.DIST_K, 1 / K.DIST_P);
    var s = au / r;
    return { x: v.x * s, y: -v.z * s, z: v.y * s };
  }

  function makeAimVisuals(scene) {
    group = new THREE.Group();
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PREVIEW_N * 3), 3));
    previewLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0x8ce8dd, transparent: true, opacity: 0.85
    }));
    burnLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
    );
    targetMark = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ORRERY.Textures.glowSprite('rgba(255,225,168,0.95)', 'rgba(242,166,60,0.2)'),
      transparent: true, depthWrite: false
    }));
    targetMark.scale.setScalar(4.5);
    previewLine.frustumCulled = burnLine.frustumCulled = false;
    previewLine.visible = burnLine.visible = targetMark.visible = false;
    group.add(previewLine, burnLine, targetMark);
    scene.add(group);
  }

  /** Current drag → burn Δv vector (AU/day) + km/s magnitude, budget-clamped. */
  function dragBurn(e) {
    var cur = sceneToAU(hit);
    var dx = cur.x - startAU.x, dy = cur.y - startAU.y, dz = cur.z - startAU.z;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var px = Math.hypot(e.clientX - startPx.x, e.clientY - startPx.y);
    var kms = Math.min(current.budget, Math.max(0.3, px * DV_PER_PX));
    if (len < 1e-9) return null;
    var v = kms / KMS / len;
    return { vec: { x: dx * v, y: dy * v, z: dz * v }, kms: kms };
  }

  var V1 = new THREE.Vector3(), V2 = new THREE.Vector3();

  function refreshPreview(e) {
    if (!pickEcliptic(e, hit)) return;
    var burn = dragBurn(e);
    if (!burn) return;
    var jd = ORRERY.TimeBar.jd;
    var es = earthState(jd);
    var vel = { x: es.vel.x + burn.vec.x, y: es.vel.y + burn.vec.y, z: es.vel.z + burn.vec.z
    };
    var vl = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    var pos = {
      x: es.pos.x + vel.x / vl * 0.02,
      y: es.pos.y + vel.y / vl * 0.02,
      z: es.pos.z + vel.z / vl * 0.02
    };
    var pv = NB.previewLive(pos, vel, jd, PREVIEW_STEPS, PREVIEW_H,
      targetEl(), Math.ceil(PREVIEW_STEPS / PREVIEW_N));

    // Would this burn succeed?
    var good = false, readout = '';
    if (current.special === 'sunGraze') {
      good = !pv.died && pv.minR <= current.rGoal;
      readout = 'perihelion ' + pv.minR.toFixed(3) + ' AU' + (pv.died ? ' · consumed!' : '');
    } else if (current.special === 'escape') {
      good = pv.endEnergy > 0;
      readout = good ? 'escape trajectory' : 'still bound to the Sun';
    } else if (current.special === 'slingshot') {
      var pass = pv.target && pv.target.d <= current.flybyTol;
      good = pass && pv.maxR >= current.reachR;
      readout = 'Jupiter pass ' + (pv.target ? pv.target.d.toFixed(3) : '—') +
        ' AU · flings to ' + pv.maxR.toFixed(1) + ' AU';
      if (pv.target) {
        K.toScene(pv.target, V1);
        targetMark.position.copy(V1);
        targetMark.visible = true;
      }
    } else if (pv.target) {
      good = pv.target.d <= current.tol;
      var days = Math.round(pv.target.jd - jd);
      readout = 'closest ' + pv.target.d.toFixed(3) + ' AU · T+' +
        (days > 400 ? (days / 365.25).toFixed(1) + ' y' : days + ' d');
      K.toScene(pv.target, V1);
      targetMark.position.copy(V1);
      targetMark.visible = true;
    }
    previewLine.material.color.setHex(good ? 0xffd27f : 0x8ce8dd);
    if (pv.died) previewLine.material.color.setHex(0xff8585);

    var posAttr = previewLine.geometry.attributes.position;
    var n = Math.min(pv.points.length, PREVIEW_N);
    for (var i = 0; i < PREVIEW_N; i++) {
      K.toScene(pv.points[Math.min(i, n - 1)] || pos, V2);
      posAttr.setXYZ(i, V2.x, V2.y, V2.z);
    }
    posAttr.needsUpdate = true;
    previewLine.visible = n > 1;

    K.toScene(es.pos, V1);
    K.toScene(pos, V2);
    V2.sub(V1).setLength(6 + burn.kms * 0.5).add(V1);
    burnLine.geometry.setFromPoints([V1, V2.clone()]);
    burnLine.visible = true;

    els.tip.innerHTML = '<strong>Δv ' + burn.kms.toFixed(1) + ' km/s</strong>' +
      (burn.kms >= current.budget - 0.01 ? ' · MAX' : '') +
      '<br>' + readout;
    els.tip.classList.toggle('good', good);
    els.tip.style.transform = 'translate(' + (e.clientX + 16) + 'px,' + (e.clientY - 8) + 'px)';
    els.tip.classList.add('show');
    attempt.pendingBurn = burn;
  }

  function clearAim() {
    dragging = false;
    controls.enabled = true;
    previewLine.visible = burnLine.visible = targetMark.visible = false;
    els.tip.classList.remove('show');
  }

  // ---- Launch & flight -----------------------------------------------------------
  function launch() {
    var burn = attempt.pendingBurn;
    var jd = ORRERY.TimeBar.jd;
    var es = earthState(jd);
    var vel = { x: es.vel.x + burn.vec.x, y: es.vel.y + burn.vec.y, z: es.vel.z + burn.vec.z };
    var vl = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    var pos = {
      x: es.pos.x + vel.x / vl * 0.02,
      y: es.pos.y + vel.y / vl * 0.02,
      z: es.pos.z + vel.z / vl * 0.02
    };
    attempt.probe = ORRERY.Sandbox.addBody(pos, vel, '#e9eef7', 1600);
    attempt.launchJd = jd;
    attempt.spent = burn.kms;
    attempt.closest = 1e9;
    attempt.minR = 1e9;
    state = 'flight';
    ORRERY.TimeBar.rate = 20;
    ORRERY.TimeBar.playing = true;
    render();
  }

  /** Challenge links: re-fly a recorded departure burn as a ghost run. */
  function replayBurn(key, jd, vec) {
    var m = null;
    MISSIONS.forEach(function (mi) { if (mi.key === key) m = mi; });
    if (!m) return false;
    var kms = Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z) * KMS;
    if (kms < 0.1 || kms > m.budget + 0.01) return false;   // forged or corrupt link
    if (ORRERY.Sandbox.active) document.getElementById('opt-sandbox').click();
    dropProbe();
    current = m;
    attempt = { ghost: true, pendingBurn: { vec: vec, kms: kms } };
    els.btn.setAttribute('aria-pressed', 'true');
    ORRERY.TimeBar.jd = jd;
    launch();
    return true;
  }

  function finish(won, msg) {
    state = 'result';
    attempt.won = won;
    attempt.msg = msg;
    if (won) {
      var n = attempt.spent <= current.par ? 3 : (attempt.spent <= current.par * 1.3 ? 2 : 1);
      attempt.stars = n;
      // Ghost runs (challenge-link replays) demonstrate, they don't bank stars
      if (!attempt.ghost && (!stars[current.key] || stars[current.key] < n)) {
        stars[current.key] = n;
        saveStars();
      }
    }
    render();
    if (ORRERY.Challenge) {
      ORRERY.Challenge.onFinish({
        key: current.key, won: won, stars: attempt.stars || 0, ghost: !!attempt.ghost,
        jd: attempt.launchJd, vec: attempt.pendingBurn.vec, kms: attempt.spent,
        actions: els.hud.querySelector('.ms-actions')
      });
    }
  }

  function tick(jd) {
    if (state === 'aim' && dragging && lastEvent && performance.now() - lastPreviewAt > 130) {
      lastPreviewAt = performance.now();
      refreshPreview(lastEvent);
    }
    if (state !== 'flight') return;

    var p = attempt.probe.p;
    var years = (jd - attempt.launchJd) / 365.25;

    if (current.special === 'sunGraze') {
      attempt.minR = p.minR;   // tracked inside the integrator's substeps
      if (p.alive && attempt.minR <= current.rGoal) { finish(true); return; }
      if (!p.alive) { finish(false, p.status === 'sun' ? 'Too close — the Sun took it.' : 'Lost.'); return; }
    } else if (current.special === 'slingshot') {
      if (!p.alive) { finish(false, 'Lost the probe.'); return; }
      var tj = K.heliocentric(targetEl(), jd);
      var dj = Math.sqrt(
        (p.pos.x - tj.x) * (p.pos.x - tj.x) +
        (p.pos.y - tj.y) * (p.pos.y - tj.y) +
        (p.pos.z - tj.z) * (p.pos.z - tj.z));
      if (dj < attempt.closest) attempt.closest = dj;
      if (!attempt.flybyDone && dj <= current.flybyTol) attempt.flybyDone = true;
      var rNow = Math.sqrt(p.pos.x * p.pos.x + p.pos.y * p.pos.y + p.pos.z * p.pos.z);
      if (attempt.flybyDone && rNow >= current.reachR) { finish(true); return; }
    } else if (current.special === 'escape') {
      if (!p.alive && p.status === 'sun') { finish(false, 'Consumed by the Sun.'); return; }
      var rr = Math.sqrt(p.pos.x * p.pos.x + p.pos.y * p.pos.y + p.pos.z * p.pos.z);
      if (rr > 1.5 && NB.energy(p.pos, p.vel) > 0) { finish(true); return; }
    } else {
      if (!p.alive) { finish(false, p.status === 'sun' ? 'Consumed by the Sun.' : 'It left the solar system.'); return; }
      var t = K.heliocentric(targetEl(), jd);
      var d = Math.sqrt(
        (p.pos.x - t.x) * (p.pos.x - t.x) +
        (p.pos.y - t.y) * (p.pos.y - t.y) +
        (p.pos.z - t.z) * (p.pos.z - t.z));
      if (d < attempt.closest) attempt.closest = d;
      if (d <= current.tol) { finish(true); return; }
    }

    if (years > current.limitY) {
      finish(false, 'The window closed — ' + current.limitY + ' years elapsed.');
      return;
    }
    if (els.flightStatus && performance.now() - (attempt.lastHud || 0) > 400) {
      attempt.lastHud = performance.now();
      els.flightStatus.innerHTML = flightStatusHtml(jd);
    }
  }

  function flightStatusHtml(jd) {
    var years = (jd - attempt.launchJd) / 365.25;
    var t = years < 0.35 ? Math.round(years * 365.25) + ' d' : years.toFixed(1) + ' y';
    var line = 'T+ ' + t;
    if (current.special === 'sunGraze') {
      line += ' · perihelion so far: ' + attempt.minR.toFixed(3) + ' AU';
    } else if (current.special === 'slingshot') {
      line += attempt.flybyDone
        ? ' · Jupiter flyby ✓ — now coasting outward'
        : (attempt.closest < 1e8 ? ' · Jupiter closest: ' + attempt.closest.toFixed(3) + ' AU' : '');
    } else if (current.special !== 'escape' && attempt.closest < 1e8) {
      line += ' · closest so far: ' + attempt.closest.toFixed(3) + ' AU';
    }
    return line;
  }

  // ---- HUD rendering ---------------------------------------------------------------
  function render() {
    var m = current;
    var h = '';
    if (state === 'list') {
      h = '<div class="ms-title">Missions</div>';
      MISSIONS.forEach(function (mi, i) {
        h += '<button class="ms-row" data-i="' + i + '">' +
          '<span class="ms-stars">' + starStr(stars[mi.key] || 0) + '</span>' +
          '<span class="ms-name">' + mi.name + '</span>' +
          '<span class="ms-budget">' + mi.budget + ' km/s</span></button>';
      });
    } else if (state === 'brief') {
      h = '<div class="ms-title">' + m.name + '</div>' +
        '<p class="ms-desc">' + m.desc + '</p>' +
        '<p class="ms-hint">' + m.hint + '</p>' +
        '<div class="ms-meta">Budget <strong>' + m.budget + ' km/s</strong> · 3★ under ' +
          m.par + ' km/s · time limit ' + m.limitY + ' y</div>' +
        '<div class="ms-actions"><button data-act="aim" class="ms-primary">Start aiming</button>' +
        '<button data-act="list">Back</button></div>';
    } else if (state === 'aim') {
      h = '<div class="ms-title">' + m.name + '</div>' +
        '<p class="ms-desc">Drag anywhere in space: direction is where you push off from Earth, ' +
        'length is your burn. <span class="ms-gold">Gold arc</span> = mission accomplished. ' +
        'Scrub the time bar to hunt a better launch window.</p>' +
        '<div class="ms-meta">Budget <strong>' + m.budget + ' km/s</strong></div>' +
        '<div class="ms-actions"><button data-act="brief">Cancel</button></div>';
    } else if (state === 'flight') {
      h = '<div class="ms-title">' + m.name + ' — en route</div>' +
        '<div class="ms-flight" id="ms-flight">T+ 0 d</div>' +
        '<div class="ms-meta">Δv spent <strong>' + attempt.spent.toFixed(1) + ' / ' +
          m.budget + ' km/s</strong></div>' +
        '<div class="ms-actions"><button data-act="ride">Ride along</button>' +
        '<button data-act="abort">Abort</button></div>';
    } else if (state === 'result') {
      if (attempt.won) {
        var years = (ORRERY.TimeBar.jd - attempt.launchJd) / 365.25;
        h = '<div class="ms-title">Mission complete</div>' +
          '<div class="ms-result-stars">' + starStr(attempt.stars) + '</div>' +
          '<div class="ms-meta">' + m.name + ' · Δv ' + attempt.spent.toFixed(1) + ' / ' +
            m.budget + ' km/s · ' + years.toFixed(1) + ' years</div>' +
          '<div class="ms-actions"><button data-act="retry" class="ms-primary">Fly it again</button>' +
          '<button data-act="ride">Ride along</button>' +
          '<button data-act="list">Missions</button></div>';
      } else {
        h = '<div class="ms-title">Mission failed</div>' +
          '<p class="ms-desc">' + attempt.msg + '</p>' +
          '<div class="ms-actions"><button data-act="retry" class="ms-primary">Try again</button>' +
          '<button data-act="list">Missions</button></div>';
      }
    }
    els.hud.innerHTML = h;
    els.hud.classList.toggle('show', state !== 'closed');
    els.flightStatus = document.getElementById('ms-flight');

    els.hud.querySelectorAll('[data-i]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        current = MISSIONS[parseInt(btn.dataset.i, 10)];
        state = 'brief';
        render();
      });
    });
    els.hud.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () { act(btn.dataset.act); });
    });
  }

  function dropProbe() {
    if (attempt && attempt.probe) ORRERY.Sandbox.removeBody(attempt.probe);
  }

  function act(a) {
    if (a === 'aim') {
      if (ORRERY.Sandbox.active) document.getElementById('opt-sandbox').click();
      attempt = {};
      state = 'aim';
      ORRERY.Panel.close();
      canvas.style.cursor = 'crosshair';
      if (current.epoch) {
        // Window-bound mission: set the clock to its launch era
        ORRERY.TimeBar.jd = current.epoch;
        ORRERY.TimeBar.playing = false;
      }
    } else if (a === 'brief') {
      clearAim();
      canvas.style.cursor = '';
      state = 'brief';
    } else if (a === 'list') {
      dropProbe();
      attempt = null;
      state = 'list';
    } else if (a === 'abort') {
      dropProbe();
      state = 'brief';
    } else if (a === 'retry') {
      dropProbe();
      act('aim');
      return;
    } else if (a === 'ride') {
      var probe = attempt.probe;
      ORRERY.Ride.start({
        label: current.name,
        back: 7,
        getPos: function () { return probe.sprite.position; },
        isAlive: function () { return probe.p.alive; },
        onStart: function () { probe.sprite.scale.setScalar(0.9); },
        onStop: function () { probe.sprite.scale.setScalar(2.6); }
      });
      return;
    }
    render();
  }

  function open() {
    state = 'list';
    els.btn.setAttribute('aria-pressed', 'true');
    render();
  }

  function close() {
    clearAim();
    canvas.style.cursor = '';
    dropProbe();
    attempt = null;
    state = 'closed';
    els.btn.setAttribute('aria-pressed', 'false');
    render();
  }

  // ---- Setup -----------------------------------------------------------------------
  function init(opts) {
    K = ORRERY.Kepler;
    NB = ORRERY.NBody;
    DATA = ORRERY.DATA;
    camera = opts.camera;
    canvas = opts.canvas;
    controls = opts.controls;
    makeAimVisuals(opts.scene);
    loadStars();

    els.hud = document.getElementById('missions-hud');
    els.tip = document.getElementById('ms-tip');
    els.btn = document.getElementById('opt-missions');
    els.btn.setAttribute('aria-pressed', 'false');
    els.btn.addEventListener('click', function () {
      state === 'closed' ? open() : close();
    });

    canvas.addEventListener('pointerdown', function (e) {
      if (state !== 'aim' || e.button !== 0) return;
      if (!pickEcliptic(e, hit)) return;
      dragging = true;
      controls.enabled = false;
      startAU = sceneToAU(hit);
      startPx.x = e.clientX; startPx.y = e.clientY;
    });
    canvas.addEventListener('pointermove', function (e) {
      if (state === 'aim' && dragging) {
        lastEvent = e;
        refreshPreview(e);
        lastPreviewAt = performance.now();
      }
    });
    window.addEventListener('pointerup', function (e) {
      if (state !== 'aim' || !dragging) return;
      var px = Math.hypot(e.clientX - startPx.x, e.clientY - startPx.y);
      var burn = attempt.pendingBurn;
      clearAim();
      if (px > 8 && burn) {
        canvas.style.cursor = '';
        launch();
      }
    });
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Escape' && state === 'aim') act('brief');
    });
  }

  return {
    init: init,
    tick: tick,
    close: close,
    replayBurn: replayBurn,
    get aiming() { return state === 'aim'; },
    get active() { return state !== 'closed'; }
  };
})();
