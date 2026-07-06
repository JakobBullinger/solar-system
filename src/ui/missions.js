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
 *
 * Mid-course burns: releasing the departure drag opens a flight plan
 * instead of launching. There the player may click a point on the arc
 * (each carries its time-of-flight) and drag a second Δv from it; the
 * preview re-integrates with the impulse applied at that moment, and both
 * burns draw from the one budget. In flight the scheduled impulse fires
 * inside the integrator at its exact jd.
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
      budget: 21, par: 15, limitY: 4,
      desc: 'Skim inside 0.08 AU of the Sun — and survive.',
      hint: 'Burning hard retrograde works — but the stylish way is out, then in: coast high, ' +
        'and a mid-course burn against your motion up there costs far less. Falling is free.'
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
  var state = 'closed';            // closed | list | brief | aim | plan | flight | result
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
  var previewLine, burnLine, targetMark, midMark;

  // Mid-course planning: the arc point being dragged from (plan state)
  var planDragging = false;
  var planPick = null;             // { t: days after departure, au: {x,y,z} }

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
    midMark = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ORRERY.Textures.glowSprite('rgba(190,255,244,0.95)', 'rgba(103,227,210,0.25)'),
      transparent: true, depthWrite: false
    }));
    midMark.scale.setScalar(3.4);
    previewLine.frustumCulled = burnLine.frustumCulled = false;
    previewLine.visible = burnLine.visible = targetMark.visible = midMark.visible = false;
    group.add(previewLine, burnLine, targetMark, midMark);
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

  /** Departure state: Earth's velocity plus the burn, nudged off the surface. */
  function launchState(jd, burnVec) {
    var es = earthState(jd);
    var vel = { x: es.vel.x + burnVec.x, y: es.vel.y + burnVec.y, z: es.vel.z + burnVec.z };
    var vl = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    var pos = {
      x: es.pos.x + vel.x / vl * 0.02,
      y: es.pos.y + vel.y / vl * 0.02,
      z: es.pos.z + vel.z / vl * 0.02
    };
    return { es: es, pos: pos, vel: vel };
  }

  /** Integrate the full flight plan (departure burn + optional mid-course). */
  function runPlan(jd, burn1Vec, burn2) {
    var ls = launchState(jd, burn1Vec);
    var burns = burn2 ? [{ t: burn2.t, dv: burn2.vec }] : null;
    var pv = NB.previewLive(ls.pos, ls.vel, jd, PREVIEW_STEPS, PREVIEW_H,
      targetEl(), Math.ceil(PREVIEW_STEPS / PREVIEW_N), burns);
    return { ls: ls, pv: pv };
  }

  /** Would this plan succeed? Also parks the target marker. */
  function assess(pv, jd) {
    var good = false, readout = '';
    var limitJd = jd + current.limitY * 365.25;   // milestones after this don't count
    if (current.special === 'sunGraze') {
      good = !pv.died && pv.minR <= current.rGoal && pv.minRJd <= limitJd;
      readout = 'perihelion ' + pv.minR.toFixed(3) + ' AU' + (pv.died ? ' · consumed!' : '');
      if (!pv.died && pv.minR <= current.rGoal && pv.minRJd > limitJd) readout += ' · too late!';
    } else if (current.special === 'escape') {
      good = pv.endEnergy > 0;
      readout = good ? 'escape trajectory' : 'still bound to the Sun';
    } else if (current.special === 'slingshot') {
      var pass = pv.target && pv.target.d <= current.flybyTol;
      var reachJd = null;                          // when the fling first clears the goal radius
      if (pass && pv.maxR >= current.reachR) {
        for (var k = 0; k < pv.points.length; k++) {
          var pt = pv.points[k];
          if (Math.sqrt(pt.x * pt.x + pt.y * pt.y + pt.z * pt.z) >= current.reachR) {
            reachJd = jd + pt.t;
            break;
          }
        }
      }
      good = reachJd !== null && reachJd <= limitJd;
      readout = 'Jupiter pass ' + (pv.target ? pv.target.d.toFixed(3) : '—') +
        ' AU · flings to ' + pv.maxR.toFixed(1) + ' AU';
      if (pv.target) {
        K.toScene(pv.target, V1);
        targetMark.position.copy(V1);
        targetMark.visible = true;
      }
    } else if (pv.target) {
      good = pv.target.d <= current.tol && pv.target.jd <= limitJd;
      var days = Math.round(pv.target.jd - jd);
      readout = 'closest ' + pv.target.d.toFixed(3) + ' AU · T+' +
        (days > 400 ? (days / 365.25).toFixed(1) + ' y' : days + ' d');
      K.toScene(pv.target, V1);
      targetMark.position.copy(V1);
      targetMark.visible = true;
    }
    return { good: good, readout: readout };
  }

  /** Draw the trajectory arc + departure burn tick for a computed plan. */
  function drawPlan(run, good) {
    var pv = run.pv;
    previewLine.material.color.setHex(good ? 0xffd27f : 0x8ce8dd);
    if (pv.died) previewLine.material.color.setHex(0xff8585);

    var posAttr = previewLine.geometry.attributes.position;
    var n = Math.min(pv.points.length, PREVIEW_N);
    for (var i = 0; i < PREVIEW_N; i++) {
      K.toScene(pv.points[Math.min(i, n - 1)] || run.ls.pos, V2);
      posAttr.setXYZ(i, V2.x, V2.y, V2.z);
    }
    posAttr.needsUpdate = true;
    previewLine.visible = n > 1;

    K.toScene(run.ls.es.pos, V1);
    K.toScene(run.ls.pos, V2);
    V2.sub(V1).setLength(6 + (attempt.burn1 ? attempt.burn1.kms : 3) * 0.5).add(V1);
    burnLine.geometry.setFromPoints([V1, V2.clone()]);
    burnLine.visible = true;
  }

  function showTip(e, kms, atMax, readout, good) {
    els.tip.innerHTML = '<strong>Δv ' + kms.toFixed(1) + ' km/s</strong>' +
      (atMax ? ' · MAX' : '') + '<br>' + readout;
    els.tip.classList.toggle('good', good);
    els.tip.style.transform = 'translate(' + (e.clientX + 16) + 'px,' + (e.clientY - 8) + 'px)';
    els.tip.classList.add('show');
  }

  function refreshPreview(e) {
    if (!pickEcliptic(e, hit)) return;
    var burn = dragBurn(e);
    if (!burn) return;
    var jd = ORRERY.TimeBar.jd;
    var run = runPlan(jd, burn.vec, null);
    var a = assess(run.pv, jd);
    attempt.burn1 = burn;          // so drawPlan scales the burn tick
    drawPlan(run, a.good);
    showTip(e, burn.kms, burn.kms >= current.budget - 0.01, a.readout, a.good);
    attempt.pendingBurn = burn;
  }

  // ---- Mid-course planning ------------------------------------------------------
  function remainingKms() {
    return Math.max(0, current.budget - attempt.burn1.kms -
      (attempt.burn2 ? attempt.burn2.kms : 0));
  }

  /** Re-integrate + redraw the committed plan (no drag in progress). */
  function refreshPlanCommitted() {
    var run = runPlan(attempt.departJd, attempt.burn1.vec, attempt.burn2);
    var a = assess(run.pv, attempt.departJd);
    if (!current.targetKey) targetMark.visible = false;
    drawPlan(run, a.good);
    attempt.planPv = run.pv;
    attempt.planGood = a.good;
    attempt.planReadout = a.readout;
    placeMidMark();
  }

  function placeMidMark() {
    var at = planDragging && planPick ? planPick.au
      : (attempt.burn2 ? attempt.burn2.au : null);
    if (at) {
      K.toScene(at, V1);
      midMark.position.copy(V1);
      midMark.visible = true;
    } else {
      midMark.visible = false;
    }
  }

  /** Find the preview-arc point nearest the pointer (screen space). */
  function pickArcPoint(e) {
    if (!attempt.planPv) return null;
    var pts = attempt.planPv.points;
    var limitD = current.limitY * 365.25;
    var best = null, bestD2 = 26 * 26;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].t > limitD) break;  // a burn after the deadline is wasted
      K.toScene(pts[i], V1);
      V1.project(camera);
      if (V1.z > 1) continue;        // behind the camera
      var sx = (V1.x + 1) / 2 * window.innerWidth;
      var sy = (-V1.y + 1) / 2 * window.innerHeight;
      var d2 = (sx - e.clientX) * (sx - e.clientX) + (sy - e.clientY) * (sy - e.clientY);
      if (d2 < bestD2) { bestD2 = d2; best = pts[i]; }
    }
    return best;
  }

  /** Current plan drag → mid-course Δv (in-plane), clamped to what's left. */
  function dragBurn2(e) {
    var left = current.budget - attempt.burn1.kms;
    var cur = sceneToAU(hit);
    var dx = cur.x - planPick.au.x, dy = cur.y - planPick.au.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9 || left < 0.1) return null;
    var px = Math.hypot(e.clientX - startPx.x, e.clientY - startPx.y);
    var kms = Math.min(left, Math.max(0.1, px * DV_PER_PX));
    var v = kms / KMS / len;
    return {
      t: planPick.t, au: planPick.au,
      vec: { x: dx * v, y: dy * v, z: 0 }, kms: kms
    };
  }

  function refreshPlanDrag(e) {
    if (!pickEcliptic(e, hit)) return;
    var burn2 = dragBurn2(e);
    if (!burn2) return;
    var run = runPlan(attempt.departJd, attempt.burn1.vec, burn2);
    var a = assess(run.pv, attempt.departJd);
    if (!current.targetKey) targetMark.visible = false;
    drawPlan(run, a.good);
    placeMidMark();
    var total = attempt.burn1.kms + burn2.kms;
    showTip(e, burn2.kms, total >= current.budget - 0.01,
      'T+' + Math.round(burn2.t) + ' d · total ' + total.toFixed(1) + ' km/s<br>' + a.readout,
      a.good);
    attempt.pendingBurn2 = burn2;
  }

  function finishPlanDrag(e) {
    planDragging = false;
    controls.enabled = true;
    els.tip.classList.remove('show');
    var px = Math.hypot(e.clientX - startPx.x, e.clientY - startPx.y);
    if (px > 8 && attempt.pendingBurn2) attempt.burn2 = attempt.pendingBurn2;
    attempt.pendingBurn2 = null;
    planPick = null;
    refreshPlanCommitted();
    render();
  }

  /** Departure drag released → freeze the clock and open the flight plan. */
  function enterPlan(burn) {
    attempt.burn1 = burn;
    attempt.burn2 = null;
    attempt.departJd = ORRERY.TimeBar.jd;
    ORRERY.TimeBar.playing = false;
    state = 'plan';
    refreshPlanCommitted();
    render();
  }

  function clearAim() {
    dragging = false;
    planDragging = false;
    planPick = null;
    controls.enabled = true;
    previewLine.visible = burnLine.visible = targetMark.visible = midMark.visible = false;
    els.tip.classList.remove('show');
  }

  // ---- Launch & flight -----------------------------------------------------------
  function launch() {
    var jd = attempt.departJd;
    ORRERY.TimeBar.jd = jd;        // plan may have scrubbed the clock; depart on schedule
    var ls = launchState(jd, attempt.burn1.vec);
    attempt.probe = ORRERY.Sandbox.addBody(ls.pos, ls.vel, '#e9eef7', 1600);
    if (attempt.burn2) {
      attempt.probe.p.burns = [
        { jd: jd + attempt.burn2.t, dv: attempt.burn2.vec, done: false }
      ];
    }
    attempt.launchJd = jd;
    attempt.spent = attempt.burn1.kms + (attempt.burn2 ? attempt.burn2.kms : 0);
    attempt.closest = 1e9;
    attempt.minR = 1e9;
    clearAim();
    canvas.style.cursor = '';
    state = 'flight';
    ORRERY.TimeBar.rate = 20;
    ORRERY.TimeBar.playing = true;
    render();
  }

  /**
   * Launch Window Lab: open the target's mission straight into aiming.
   * The porkchop drawer has already set the sim clock to the chosen
   * departure, so the player lands on a pre-found window.
   */
  function aimAt(key) {
    var m = null;
    MISSIONS.forEach(function (mi) { if (!mi.special && mi.targetKey === key) m = mi; });
    if (!m) return false;
    dropProbe();
    current = m;
    els.btn.setAttribute('aria-pressed', 'true');
    act('aim');
    return true;
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
    // Challenge links carry the departure burn only (no mid-course leg)
    attempt = { ghost: true, burn1: { vec: vec, kms: kms }, burn2: null, departJd: jd };
    els.btn.setAttribute('aria-pressed', 'true');
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
        jd: attempt.launchJd, vec: attempt.burn1.vec, kms: attempt.spent,
        midBurn: !!attempt.burn2,   // links can't carry the second leg (yet)
        actions: els.hud.querySelector('.ms-actions')
      });
    }
  }

  function tick(jd) {
    if (state === 'aim' && dragging && lastEvent && performance.now() - lastPreviewAt > 130) {
      lastPreviewAt = performance.now();
      refreshPreview(lastEvent);
    }
    if (state === 'plan' && planDragging && lastEvent && performance.now() - lastPreviewAt > 130) {
      lastPreviewAt = performance.now();
      refreshPlanDrag(lastEvent);
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
    if (attempt.burn2) {
      var b = attempt.probe.p.burns && attempt.probe.p.burns[0];
      line += b && b.done
        ? ' · mid-burn ✓'
        : ' · mid-burn in ' + Math.max(0, Math.round(attempt.launchJd + attempt.burn2.t - jd)) + ' d';
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
        'Scrub the time bar to hunt a better launch window. ' +
        'Release to review your flight plan.</p>' +
        '<div class="ms-meta">Budget <strong>' + m.budget + ' km/s</strong></div>' +
        '<div class="ms-actions"><button data-act="brief">Cancel</button></div>';
    } else if (state === 'plan') {
      var spent = attempt.burn1.kms + (attempt.burn2 ? attempt.burn2.kms : 0);
      h = '<div class="ms-title">' + m.name + ' — flight plan</div>' +
        '<p class="ms-desc">Departure burn set. Click a point on the arc and drag to add a ' +
        'mid-course burn there — both draw from the same budget. ' +
        '<span class="ms-gold">Gold arc</span> = mission accomplished.</p>' +
        '<div class="ms-meta">Δv <strong>' + spent.toFixed(1) + ' / ' + m.budget + ' km/s</strong>' +
        (attempt.burn2
          ? ' · mid-burn <strong>' + attempt.burn2.kms.toFixed(1) + ' km/s</strong> at T+' +
            Math.round(attempt.burn2.t) + ' d'
          : ' · no mid-course burn') +
        (attempt.planReadout ? '<br>' + attempt.planReadout : '') + '</div>' +
        '<div class="ms-actions"><button data-act="launch" class="ms-primary">Launch</button>' +
        (attempt.burn2 ? '<button data-act="clearburn">Clear mid-burn</button>' : '') +
        '<button data-act="aim">Re-aim</button>' +
        '<button data-act="brief">Cancel</button></div>';
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
      clearAim();
      attempt = {};
      state = 'aim';
      ORRERY.Panel.close();
      canvas.style.cursor = 'crosshair';
      if (current.epoch) {
        // Window-bound mission: set the clock to its launch era
        ORRERY.TimeBar.jd = current.epoch;
        ORRERY.TimeBar.playing = false;
      }
    } else if (a === 'launch') {
      launch();
      return;
    } else if (a === 'clearburn') {
      attempt.burn2 = null;
      refreshPlanCommitted();
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
      if (state === 'plan' && e.button === 0) {
        if (current.budget - attempt.burn1.kms < 0.1) return;  // nothing left to burn
        var pt = pickArcPoint(e);
        if (!pt || !pickEcliptic(e, hit)) return;
        planPick = { t: pt.t, au: { x: pt.x, y: pt.y, z: pt.z } };
        planDragging = true;
        controls.enabled = false;
        startPx.x = e.clientX; startPx.y = e.clientY;
        placeMidMark();
        return;
      }
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
      } else if (state === 'plan' && planDragging) {
        lastEvent = e;
        refreshPlanDrag(e);
        lastPreviewAt = performance.now();
      }
    });
    window.addEventListener('pointerup', function (e) {
      if (state === 'plan' && planDragging) {
        finishPlanDrag(e);
        return;
      }
      if (state !== 'aim' || !dragging) return;
      var px = Math.hypot(e.clientX - startPx.x, e.clientY - startPx.y);
      var burn = attempt.pendingBurn;
      clearAim();
      if (px > 8 && burn) enterPlan(burn);
    });
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Escape' && (state === 'aim' || state === 'plan')) act('brief');
    });
  }

  return {
    init: init,
    tick: tick,
    close: close,
    replayBurn: replayBurn,
    aimAt: aimAt,
    get aiming() { return state === 'aim' || state === 'plan'; },
    get active() { return state !== 'closed'; }
  };
})();
