/**
 * director.js — ORRERY.Director: the idle attract mode (level 25).
 *
 * After a while with no input the camera starts cutting between slow,
 * composed beauty shots of the system — a planetarium screensaver built
 * entirely on ORRERY.CameraPath: each shot is a hard CUT (instant flight
 * to a fresh vantage) followed by one long eased DRIFT (a single flight
 * arcing around the subject), then a dwell, then the next subject. The
 * one-flight-at-a-time ownership rule means anything else that grabs the
 * camera simply wins; the subject is tracked through main.js's follow
 * lerp (setFollow), so moving bodies stay centered without this module
 * touching the controls target every frame.
 *
 * Any input exits instantly. The activity guards (Ride / Tour / Sandbox /
 * Missions / Cosmos / Replays / open drawers, supplied by main.js) both
 * block entry and force an exit if a mode starts underneath us. Reduced
 * motion disables auto-entry; a manual start() still works and degrades
 * to a slideshow of held shots (CameraPath snaps, the dwell still paces).
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Director = (function () {
  'use strict';

  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var IDLE_S = 75;                 // input silence before the show starts
  var SHOT_S = 14;                 // one drift
  var DWELL_S = 4;                 // hold after arrival before cutting
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  var api = null;                  // { registry, camera, controls, setFollow, clearFocus, guards }
  var pool = [];                   // shootable subjects
  var active = false;
  var idle = 0;
  var idleLimit = IDLE_S;
  var phase = 'drift';             // drift | dwell (while active)
  var dwell = 0;
  var lastKey = null;
  var note = null;
  var P = null, DIR = null;        // scratch vectors (lazy)

  function init(opts) {
    api = opts;
    // Subjects: the sun, planets and comets — top-level bodies only.
    Object.keys(api.registry).forEach(function (k) {
      var e = api.registry[k];
      var u = e.userData;
      if (u.isSun || (u.body && u.body.el && !u.parentGroup && u.moons)) pool.push(e);
    });

    note = document.createElement('div');
    note.className = 'director-note';
    note.setAttribute('aria-hidden', 'true');
    document.body.appendChild(note);

    // Any input both resets the idle clock and ends the show.
    ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'].forEach(function (ev) {
      window.addEventListener(ev, poke, { passive: true });
    });
  }

  function poke() {
    idle = 0;
    if (active) exit();
  }

  function pickSubject() {
    var candidates = pool.filter(function (e) { return e.userData.body.key !== lastKey; });
    var e = candidates[Math.floor(Math.random() * candidates.length)] || pool[0];
    lastKey = e.userData.body.key;
    return e;
  }

  /** Cut to a fresh vantage of a new subject, then drift once around it. */
  function shot() {
    var entry = pickSubject();
    api.setFollow(entry);

    if (!P) { P = new THREE.Vector3(); DIR = new THREE.Vector3(); }
    entry.getWorldPosition(P);
    var r = entry.userData.isSun
      ? ORRERY.DATA.SUN.sceneRadius : entry.userData.enhancedRadius;
    var d1 = Math.max(r * 6.5, 8) * (0.9 + Math.random() * 0.6);
    var az = Math.random() * Math.PI * 2;
    var el = 0.1 + Math.random() * 0.4;

    function vantage(azimuth, elevation, dist) {
      DIR.set(
        Math.cos(azimuth) * Math.cos(elevation),
        Math.sin(elevation),
        Math.sin(azimuth) * Math.cos(elevation)
      );
      return P.clone().addScaledVector(DIR, dist);
    }

    // The cut: land instantly on the opening frame of the shot.
    api.controls.target.copy(P);
    ORRERY.CameraPath.begin({ to: vantage(az, el, d1), instant: true });

    // The drift: one long arc — part orbit, part push-in or pull-out.
    var az2 = az + (0.5 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1);
    var el2 = Math.max(0.06, Math.min(0.55, el + (Math.random() - 0.5) * 0.3));
    var d2 = d1 * (0.7 + Math.random() * 0.6);
    phase = 'drift';
    ORRERY.CameraPath.begin({
      to: vantage(az2, el2, d2),
      duration: SHOT_S,
      ease: easeInOut,
      onArrive: function () { phase = 'dwell'; dwell = 0; }
    });

    note.textContent = '✦ ' + entry.userData.body.name + ' · ambient mode — move to exit';
  }

  function start() {
    if (active || !api || api.guards()) return;
    active = true;
    document.body.classList.add('directing');
    note.classList.add('show');
    shot();
  }

  function exit() {
    if (!active) return;
    active = false;
    idle = 0;
    ORRERY.CameraPath.cancel();
    api.clearFocus();
    document.body.classList.remove('directing');
    note.classList.remove('show');
  }

  /** Per-frame from the main loop: idle bookkeeping + shot pacing. */
  function tick(dt) {
    if (!api) return;
    if (!active) {
      if (reducedMotion || document.hidden || api.guards()) { idle = 0; return; }
      idle += dt;
      if (idle >= idleLimit) start();
      return;
    }
    if (api.guards()) { exit(); return; }
    if (phase === 'dwell') {
      dwell += dt;
      if (dwell >= DWELL_S) shot();
    }
  }

  return {
    init: init,
    tick: tick,
    start: start,
    exit: exit,
    get active() { return active; },
    /** Headless-verification hooks — not UI API. */
    _dev: {
      setIdleLimit: function (s) { idleLimit = s; },
      get subjectKey() { return lastKey; }
    }
  };
})();
