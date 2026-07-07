/**
 * marsplanner.js — Mars Mission Planner: the real next missions to Mars,
 * visualized (level 23).
 *
 * A left drawer (sibling of the Launch Window Lab) with a timeline of the
 * five verified missions from marsmissions.js. Selecting one opens its
 * dossier and draws its reference trajectory in the scene — not a sketch:
 * the baked departure state is re-integrated through NBody.previewLive
 * (moving planets, the flight-grade step size), so the drawn arc is the
 * path a sandbox probe would actually fly, and the dossier reports how
 * close it passes to Mars. "Fly it" does exactly that: jumps the clock to
 * departure, hands a probe with the mission's velocity to the sandbox
 * integrator, and runs time until arrival. ESCAPADE's year parked near
 * Sun–Earth L2 draws as a faint loiter arc from Lagrange.point samples;
 * its flight starts at the powered Earth-flyby departure.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.MarsPlanner = (function () {
  'use strict';

  var KMS = 1731.456;              // 1 AU/day in km/s
  var STEP_H = 0.25;               // integration step (days) — flight grade
  var PT_EVERY = 6;                // keep a line point every 1.5 days
  var T0 = 2460858.5;              // timeline span: 1 Jul 2025 …
  var T1 = 2463281.5;              // … 15 Jun 2032
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var els = {};
  var scene, group;
  var selectedKey = null;
  var trajCache = {};              // key → { res, transferLine, loiterLine, marker }
  var shown = [];                  // objects currently added to `group`
  var trajGlyph = null;            // TrajAnim sprite riding the shown transfer
  var flight = null;               // { m, vis, saved, arrived }
  var raf = 0;

  function fmtDate(jd) {
    var d = ORRERY.Kepler.dateFromJD(jd);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function bodyEl(key) {
    var el = null;
    ORRERY.DATA.PLANETS.forEach(function (p) { if (p.key === key) el = p.el; });
    return el;
  }
  function missionOf(key) {
    var m = null;
    ORRERY.DATA.MARS.MISSIONS.forEach(function (x) { if (x.key === key) m = x; });
    return m;
  }

  // ---- Reference trajectory physics -------------------------------------------
  function railVel(el, jd) {
    var a = ORRERY.Kepler.heliocentric(el, jd - 0.5);
    var b = ORRERY.Kepler.heliocentric(el, jd + 0.5);
    return { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  }

  /** Departure state: Earth nudged 0.02 AU along the outgoing v∞ direction
   *  (the sandbox/replays convention — the baked v1 was refined this way). */
  function launchState(m) {
    var p = ORRERY.Kepler.heliocentric(bodyEl('earth'), m.depJd);
    var ve = railVel(bodyEl('earth'), m.depJd);
    var dx = m.v1.x - ve.x, dy = m.v1.y - ve.y, dz = m.v1.z - ve.z;
    var dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= dl; dy /= dl; dz /= dl;
    return {
      pos: { x: p.x + dx * 0.02, y: p.y + dy * 0.02, z: p.z + dz * 0.02 },
      vel: { x: m.v1.x, y: m.v1.y, z: m.v1.z }
    };
  }

  /** n-body re-integration of the baked transfer (cached): the drawn line
   *  and the dossier's closest-approach verification come from this. */
  function transferPreview(m) {
    var l = launchState(m);
    var steps = Math.ceil((m.arrJd - m.depJd) / STEP_H) + 8;
    return ORRERY.NBody.previewLive(l.pos, l.vel, m.depJd, steps, STEP_H,
      bodyEl('mars'), PT_EVERY);
  }

  // ---- Scene visuals -----------------------------------------------------------
  function lineOf(ptsAU, color, opacity, dashed) {
    var v = new THREE.Vector3();
    var pts = [];
    for (var i = 0; i < ptsAU.length; i++) {
      ORRERY.Kepler.toScene(ptsAU[i], v);
      pts.push(v.clone());
    }
    var geo = new THREE.BufferGeometry().setFromPoints(pts);
    var mat = dashed
      ? new THREE.LineDashedMaterial({ color: color, transparent: true, opacity: opacity, dashSize: 2.2, gapSize: 1.6 })
      : new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: opacity });
    var line = new THREE.Line(geo, mat);
    if (dashed) line.computeLineDistances();
    line.frustumCulled = false;
    return line;
  }

  function buildVisuals(m) {
    if (trajCache[m.key]) return trajCache[m.key];
    var res = transferPreview(m);
    var entry = { res: res };
    var dashed = m.confidence === 'aspirational';
    entry.transferLine = lineOf(res.points, m.color, dashed ? 0.6 : 0.85, dashed);

    if (m.loiter) {              // ESCAPADE: the year parked near Sun–Earth L2
      var lp = [];
      for (var jd = m.loiter.fromJd; jd <= m.loiter.toJd; jd += 4) {
        lp.push(ORRERY.Lagrange.point('earth', 'L2', jd));
      }
      entry.loiterLine = lineOf(lp, m.color, 0.3);
    }

    // Arrival marker at Mars' position on the reference arrival date
    var tex = ORRERY.Textures.glowSprite('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.1)');
    var marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(m.color),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    marker.scale.setScalar(2.0);
    var v = new THREE.Vector3();
    ORRERY.Kepler.toScene(ORRERY.Kepler.heliocentric(bodyEl('mars'), m.arrJd), v);
    marker.position.copy(v);
    entry.marker = marker;

    trajCache[m.key] = entry;
    return entry;
  }

  function clearShown() {
    if (shown.length) ORRERY.TrajAnim.cancel(shown[0]);   // shown[0] = transferLine
    if (trajGlyph) { trajGlyph.remove(); trajGlyph = null; }
    shown.forEach(function (o) { group.remove(o); });
    shown = [];
  }

  function showTrajectory(m) {
    clearShown();
    var e = buildVisuals(m);
    shown = [e.transferLine, e.marker];
    if (e.loiterLine) shown.push(e.loiterLine);
    shown.forEach(function (o) { group.add(o); });
    // Living orbits: the transfer draws in along its own time of flight,
    // and a glyph walks the arc wherever the sim clock stands — scrubbing
    // the time bar flies ESCAPADE (and friends) along the cached points.
    ORRERY.TrajAnim.play(e.transferLine);
    trajGlyph = ORRERY.TrajAnim.glyph({
      points: e.res.points, jd0: m.depJd, color: m.color
    });
  }

  // ---- Timeline ----------------------------------------------------------------
  function pct(jd) { return ((jd - T0) / (T1 - T0) * 100).toFixed(2); }

  function renderTimeline() {
    var h = '<div class="mp-years">';
    for (var y = 2026; y <= 2032; y++) {
      var jd = ORRERY.Kepler.julianDate(Date.UTC(y, 0, 1));
      h += '<span style="left:' + pct(jd) + '%">' + y + '</span>';
    }
    h += '</div>';
    ORRERY.DATA.MARS.MISSIONS.forEach(function (m) {
      var asp = m.confidence === 'aspirational';
      var start = m.loiter ? m.loiter.fromJd : m.depJd;
      h += '<button class="mp-row' + (asp ? ' asp' : '') + '" data-key="' + m.key + '">' +
        '<span class="mp-row-head">' +
        '<span class="chip-dot" style="background:' + m.color + '"></span>' +
        '<strong>' + m.name + '</strong><em>' + m.status + '</em></span>' +
        '<span class="mp-track">';
      if (m.loiter) {
        h += '<span class="mp-seg loiter" style="left:' + pct(m.loiter.fromJd) +
          '%;width:' + (pct(m.loiter.toJd) - pct(m.loiter.fromJd)).toFixed(2) +
          '%;background:' + m.color + '"></span>';
      }
      h += '<span class="mp-seg" style="left:' + pct(m.depJd) + '%;width:' +
        (pct(m.arrJd) - pct(m.depJd)).toFixed(2) + '%;background:' + m.color + '"></span>';
      if (m.returnJd) {
        h += '<span class="mp-seg ret" style="left:' + pct(m.arrJd) + '%;width:' +
          (pct(m.returnJd) - pct(m.arrJd)).toFixed(2) + '%;background:' + m.color + '"></span>';
      }
      h += '</span></button>';
    });
    els.timeline.innerHTML = h;
    els.timeline.querySelectorAll('.mp-row').forEach(function (b) {
      b.addEventListener('click', function () { select(b.dataset.key); });
    });
  }

  // ---- Dossier -----------------------------------------------------------------
  function select(key) {
    selectedKey = key;
    var m = missionOf(key);
    els.timeline.querySelectorAll('.mp-row').forEach(function (b) {
      b.classList.toggle('active', b.dataset.key === key);
    });
    showTrajectory(m);
    renderDossier(m);
  }

  function renderDossier(m) {
    var e = buildVisuals(m);
    var ca = e.res.target;
    var tof = Math.round(m.arrJd - m.depJd);
    var caKm = Math.round(ca.d * 149597871).toLocaleString('en-US');
    var rows = [
      ['Departs', fmtDate(m.depJd) + (m.loiter ? ' — powered Earth flyby out of the L2 loiter' : '')],
      ['Ship', m.vehicle],
      ['Cruise', tof + ' days' + (m.multirev ? ' — 1.4 revolutions around the Sun' : '') +
        ' · C3 ' + m.c3.toFixed(1) + ' km²/s²'],
      ['Arrival', fmtDate(m.arrJd) + ' at ' + m.vinfArr.toFixed(1) + ' km/s v∞ — ' + m.arrival],
      ['Payload', m.payload],
      ['This trajectory', 'Re-flown in the app’s own n-body physics: passes ' +
        caKm + ' km from Mars on ' + fmtDate(ca.jd) +
        (m.confidence === 'aspirational' ? ' (representative — real transfer type is an open question)' : '')]
    ];
    var h = '<span class="mp-eyebrow">' + m.agency +
      (m.confidence === 'aspirational' ? ' · <b class="mp-asp">aspirational</b>' : '') + '</span>' +
      '<h4>' + m.name + '</h4><p>' + m.blurb + '</p><div class="mp-stats">';
    rows.forEach(function (r) {
      h += '<div><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    });
    h += '</div><div class="mp-actions">' +
      '<button id="mp-fly">▶ Fly the transfer</button>' +
      '<button id="mp-window">Launch window ▸</button></div>' +
      '<p class="mp-flight" id="mp-flight"></p>';
    els.dossier.innerHTML = h;
    els.dossier.querySelector('#mp-fly').addEventListener('click', function () { fly(m); });
    els.dossier.querySelector('#mp-window').addEventListener('click', function () {
      close();
      ORRERY.Porkchop.setTarget('mars');
      ORRERY.Porkchop.open();
    });
    updateFlightReadout();
  }

  // ---- Fly it -------------------------------------------------------------------
  function fly(m) {
    stopFlight(false);
    var TB = ORRERY.TimeBar;
    flight = {
      m: m,
      saved: { jd: TB.jd, rate: TB.rate, playing: TB.playing },
      arrived: false
    };
    TB.jd = m.depJd;
    TB.rate = 16;
    TB.playing = true;
    var l = launchState(m);
    flight.vis = ORRERY.Sandbox.addBody(l.pos, l.vel, m.color, 1200);
    showTrajectory(m);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    updateFlightReadout();
  }

  function stopFlight(restore) {
    cancelAnimationFrame(raf);
    if (!flight) return;
    if (flight.vis) ORRERY.Sandbox.removeBody(flight.vis);
    if (restore) {
      var TB = ORRERY.TimeBar;
      TB.jd = flight.saved.jd;
      TB.rate = flight.saved.rate;
      TB.playing = flight.saved.playing;
    }
    flight = null;
    updateFlightReadout();
  }

  function updateFlightReadout() {
    var el = els.dossier.querySelector('#mp-flight');
    if (!el) return;
    if (!flight || flight.m.key !== selectedKey) { el.innerHTML = ''; return; }
    var m = flight.m, jd = ORRERY.TimeBar.jd;
    var h;
    if (!flight.vis || !flight.vis.p.alive) {
      h = 'The probe was lost — that shouldn’t happen on a reference transfer.';
    } else if (flight.arrived) {
      h = '<strong>Arrived.</strong> ' + m.arrival +
        ' <button id="mp-stop">Done — restore my clock</button>';
    } else {
      var p = flight.vis.p;
      var mh = ORRERY.Kepler.heliocentric(bodyEl('mars'), jd);
      var d = Math.sqrt(
        (p.pos.x - mh.x) * (p.pos.x - mh.x) +
        (p.pos.y - mh.y) * (p.pos.y - mh.y) +
        (p.pos.z - mh.z) * (p.pos.z - mh.z));
      var v = Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y + p.vel.z * p.vel.z) * KMS;
      h = fmtDate(jd) + ' · Mars in ' + (d < 0.02
        ? Math.round(d * 149597871).toLocaleString('en-US') + ' km'
        : d.toFixed(2) + ' AU') + ' · ' + v.toFixed(1) + ' km/s' +
        ' <button id="mp-stop">Stop</button>';
    }
    el.innerHTML = h;
    var stop = el.querySelector('#mp-stop');
    if (stop) stop.addEventListener('click', function () { stopFlight(true); });
  }

  /** Per-frame while flying: readout + arrival detection at the reference date. */
  function frame() {
    if (!flight) return;
    raf = requestAnimationFrame(frame);
    if (!flight.arrived && ORRERY.TimeBar.jd >= flight.m.arrJd) {
      flight.arrived = true;
      ORRERY.TimeBar.playing = false;
    }
    updateFlightReadout();
  }

  // ---- Drawer ------------------------------------------------------------------
  function isOpen() { return els.root.classList.contains('open'); }

  function open() {
    ORRERY.AlmanacUI.close();      // left drawers are mutually exclusive
    ORRERY.Porkchop.close();
    els.root.classList.add('open');
    els.root.setAttribute('aria-hidden', 'false');
    els.btn.setAttribute('aria-pressed', 'true');
    if (!selectedKey) select(ORRERY.DATA.MARS.MISSIONS[0].key);
    else showTrajectory(missionOf(selectedKey));
  }

  function close() {
    els.root.classList.remove('open');
    els.root.setAttribute('aria-hidden', 'true');
    els.btn.setAttribute('aria-pressed', 'false');
    clearShown();                  // flight (if any) keeps running visibly
  }

  function init(opts) {
    scene = opts.scene;
    group = new THREE.Group();
    scene.add(group);

    els.root = document.getElementById('marsplan');
    els.btn = document.getElementById('opt-mars');
    els.timeline = document.getElementById('mp-timeline');
    els.dossier = document.getElementById('mp-dossier');

    els.btn.setAttribute('aria-pressed', 'false');
    els.btn.addEventListener('click', function () { isOpen() ? close() : open(); });
    document.getElementById('mp-close').addEventListener('click', close);
    // The almanac doesn't know about this drawer; close ours when it opens
    document.getElementById('opt-events').addEventListener('click', function () {
      if (isOpen()) close();
    });

    renderTimeline();
  }

  /** Introspection for tests and the headless verifier. */
  function getState() {
    var m = selectedKey ? missionOf(selectedKey) : null;
    var e = m && trajCache[m.key];
    return {
      open: isOpen(),
      selected: selectedKey,
      shownObjects: shown.length,
      flying: !!flight,
      arrived: !!(flight && flight.arrived),
      ca: e ? { d: e.res.target.d, jd: e.res.target.jd } : null,
      points: e ? e.res.points.length : 0
    };
  }

  return {
    init: init,
    open: open,
    close: close,
    select: select,
    getState: getState,
    // Offline verification hooks — not UI API
    _dev: { launchState: launchState, transferPreview: transferPreview }
  };
})();
