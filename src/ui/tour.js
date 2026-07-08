/**
 * tour.js — Guided cinematic tour (v2: the capability showcase).
 *
 * A scripted sequence over everything the orrery can do. v1 covered the
 * solar system itself (camera flights, per-stop time rates, two time-travel
 * stops); v2 keeps that spine and adds self-contained stops for the
 * post-level-13 capabilities: the almanac, the 2026 total eclipse, the
 * what-if machine, the Mars mission previews, Earth orbit and the cosmic
 * zoom. While touring, the working UI hides behind a caption card; stops
 * advance automatically or via ◂ ▸ / arrow keys, and Escape exits.
 *
 * Restore discipline — the tour's whole contract:
 *   - Stops that borrow a mode do it through per-stop setup()/teardown():
 *     setup returns the teardown, and goTo/exit ALWAYS run the previous
 *     stop's teardown before doing anything else, so every stop begins from
 *     a clean scene and Esc anywhere unwinds whatever the current stop
 *     built (scenario → Sandbox.clear() snaps the planets back to rails,
 *     Earth orbit / cosmos → their own exit(), which restore camera,
 *     controls and clock exactly).
 *   - The visitor's clock {jd, rate, playing} is restored on the way out;
 *     the camera flies home (the v1 contract, pinned by camerapath.spec).
 *   - Earth orbit and the cosmic zoom are guarded AGAINST the tour in
 *     main.js (they refuse to engage and force-exit while a tour runs);
 *     the `hosting` getter is the tour's narrow exemption — it names the
 *     one mode the current stop intentionally drives, and main.js's guard
 *     closures let exactly that mode through.
 *
 * Stop-to-stop camera flights ride ORRERY.CameraPath through the focus /
 * flyHome hooks: each stop begins a new flight, which cancels the previous
 * one — jumping between stops mid-flight is safe by construction.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Tour = (function () {
  'use strict';

  var HOUR = 1 / 24;   // one hour per second, in days/s

  // Eclipse sweep choreography — the almanac's own numbers (almanac-ui.js):
  // land LEAD days before greatest eclipse, play at ~11.5 sim-min/s.
  var ECLIPSE_LEAD = 0.06;
  var ECLIPSE_RATE = 0.008;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtDate(jd) {
    var d = ORRERY.Kepler.dateFromJD(jd);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  // --- Lazy stop data ---------------------------------------------------------
  // Computed on first use with the app's own engines, never hand-baked:
  // the 12 Aug 2026 total solar eclipse instant and the next real sky event.

  var eclipseEv;                    // found once; the date is historical/fixed
  function eclipseJd() {
    if (!eclipseEv) {
      var list = ORRERY.Eclipse.findAll(2461250.5, 30);   // Aug 2026 window
      for (var i = 0; i < list.length; i++) {
        if (list[i].ecl === 'solar') { eclipseEv = list[i]; break; }
      }
      if (!eclipseEv) eclipseEv = { jd: 2461265.2413 };   // finder canon value
    }
    return eclipseEv.jd - ECLIPSE_LEAD;
  }

  var skyEv = null;                 // next upcoming event from the REAL clock
  function findSkyEvent() {
    var now = ORRERY.Kepler.julianDate(Date.now());
    var list = ORRERY.Almanac.findAll(now, 400);
    skyEv = list.length ? list[0] : null;
  }

  function mmx() {
    var m = null;
    ORRERY.DATA.MARS.MISSIONS.forEach(function (x) { if (x.key === 'mmx') m = x; });
    return m;
  }

  /* ==========================================================================
   * The stops. Optional fields beyond v1's:
   *   setup()    — runs first; builds the stop's spectacle and returns its
   *                teardown (or null). Teardown runs before the next stop
   *                and on any exit.
   *   hosted     — 'earthorbit' | 'cosmos': the stop drives that mode, which
   *                owns camera + clock; the tour skips its own choreography
   *                and main.js's guards let the named mode through.
   *   pause      — hold the clock still for this stop.
   *   jd / key / text may be functions (resolved at stop entry) so dynamic
   *   stops (almanac, eclipse) read their engines at the moment they play.
   * NOTE: stop 2 must keep the exact title 'Earth' — camerapath.spec pins it.
   * ========================================================================== */
  var STOPS = [
    {
      home: true, rate: 30, autoRotate: true, dur: 13000,
      eyebrow: 'Welcome', title: 'A living map of the solar system',
      text: 'Nothing here is animated by hand — every world sits where it really is, computed from its orbital elements, with time running at thirty days a second. This tour is the capability reel: an eclipse, a broken solar system, real Mars missions, Earth orbit, and the edge of the map.'
    },
    {
      key: 'sun', rate: 4, dur: 12000,
      eyebrow: 'The engine', title: 'The Sun',
      text: ' 99.86% of the solar system’s mass is right here. Everything else — every planet, moon and comet on this map — is rounding error, held on a string of gravity.'
    },
    {
      key: 'earth', rate: HOUR, dur: 14000,
      eyebrow: 'Home', title: 'Earth',
      text: 'Time has slowed to an hour per second: watch the day line sweep across real coastlines — the geography is baked from NASA imagery, and the night side glows with 265 real cities at their measured brightness. The Moon beside it is slowly leaving — 3.8 centimetres farther every year.'
    },
    {
      jd: 2446462.5, key: 'halley', rate: 1.5, dist: 4, dur: 16000,
      eyebrow: 'Time travel · February 1986', title: 'Halley’s comet',
      text: 'The clock has jumped back to 1986. This close to the Sun, Halley’s ices boil off into a blue ion tail and a curved dust tail — and the pulses streaming along every orbit move at each body’s true speed. Watch them whip through perihelion and crawl far out: Kepler’s second law, drawn live.',
      setup: function () {
        if (ORRERY.OrbitFlow.enabled) return null;
        var btn = document.getElementById('opt-flow');
        if (btn) btn.click();       // the real toggle: keeps menu state honest
        return function () { if (btn && ORRERY.OrbitFlow.enabled) btn.click(); };
      }
    },
    {
      pause: true, dur: 14000,
      jd: function () { return skyEv ? skyEv.jd : ORRERY.TimeBar.jd; },
      key: function () { return skyEv ? skyEv.bodyKey : 'earth'; },
      eyebrow: 'The almanac', title: 'The sky knows its schedule',
      setup: function () { findSkyEvent(); return null; },
      text: function () {
        var base = 'Oppositions, elongations, conjunctions and eclipses are computed years ahead — and a “sky tonight” panel reads the real clock, not the simulation. ';
        return skyEv
          ? base + 'You are looking at the next one: ' + skyEv.title + ', ' +
            fmtDate(skyEv.jd) + ' — paused, so you can stare.'
          : base + 'Open Events in the Explore menu to browse what’s coming.';
      }
    },
    {
      jd: eclipseJd, key: 'earth', dist: 0.85, rate: ECLIPSE_RATE, dur: 18000,
      eyebrow: 'Time travel · 12 August 2026', title: 'Total eclipse of the Sun',
      text: 'The Moon here runs on the full lunar theory — sixty terms of longitude — because a schematic Moon misses eclipses. On 12 August 2026 its umbra really crosses the North Atlantic into Spain: watch the dark spot sweep the globe. The finder works from raw shadow-cone geometry; no lookup tables.'
    },
    {
      // Wide vantage: every rail fading + every truth-trail + the intruder
      // itself at 50 AU in one frame (sun focus, dist 63·18 scene units)
      key: 'sun', dist: 18, dur: 22000,
      eyebrow: 'The what-if machine', title: 'Break the solar system',
      text: 'The sandbox launches anything up to a star. A 0.2-solar-mass red dwarf now circles at 50 AU — and this is no cartoon: every planet is being integrated honestly. The orbit lines fade because they would be lies now; Neptune grows a truth-telling trail instead and is dragged off its rail within decades.',
      setup: function () {
        ORRERY.Sandbox.runScenario('companion');   // sets its verified rate
        return function () { ORRERY.Sandbox.clear(); };  // clearing IS the restore
      }
    },
    {
      key: 'sun', dist: 2.2, rate: 10, dur: 16000,
      jd: function () { var m = mmx(); return m ? m.depJd + 5 : ORRERY.TimeBar.jd; },
      eyebrow: 'Back on the rails · Missions', title: 'Fly to Mars, for real',
      text: 'One click snapped every planet back onto its rail. The arc is MMX — Japan’s Phobos sample-return, departing November 2026 — re-flown in the app’s own n-body physics from the published window; the glyph rides the clock. The Mission Designer holds nine flights of its own: Δv budgets, launch-window heatmaps, challenge links to beat.',
      setup: function () {
        ORRERY.MarsPlanner.select('mmx');          // arc + glyph, drawer stays shut
        return function () { ORRERY.MarsPlanner.close(); };
      }
    },
    {
      home: true, rate: 120, dur: 24000,
      eyebrow: 'Time travel · August 1977', title: 'The grand tour',
      text: 'A probe leaves Earth at 38.5 km/s. Watch it steal momentum from Jupiter — the path visibly bends — and ride that slingshot on to Saturn, five years and 1.5 billion kilometres later. Two full missions, New Horizons and Cassini, are re-flown chapter by chapter under Explore → Replays.',
      setup: function () {
        ORRERY.Sandbox.runVoyager();  // clears bodies, jumps to 1977, launches
        return function () { ORRERY.Sandbox.clear(); };
      }
    },
    {
      hosted: 'earthorbit', dur: 20000,
      eyebrow: 'Zoom in · The satellite sky', title: 'Earth orbit, in kilometres',
      text: 'Scroll in past Earth and the map changes gears: 4,408 Starlink satellites in their real shells, GPS, Molniya and the geostationary ring hanging still over the turning surface — with the ISS drawing its ground track on the globe. Time runs in minutes per second here, not days.',
      setup: function () {
        hosting = 'earthorbit';
        ORRERY.EarthOrbit.enter();
        var iss = document.querySelector('.eo-key[data-eo="iss"]');
        if (iss) iss.click();       // the ISS dossier bakes + shows its ground track
        return function () {
          ORRERY.EarthOrbit.exit();  // restores camera, controls and clock exactly
          hosting = null;
        };
      }
    },
    {
      hosted: 'cosmos', rate: 4, dur: 21000,
      eyebrow: 'Zoom out · Powers of ten', title: 'To the edge of the map',
      text: 'And zooming out never hits a wall: past the Voyagers leaving the heliosphere, through the Oort cloud, past the twenty nearest stars, until the Milky Way resolves and the Local Group hangs in the dark — all real catalog data. One scroll brings you the whole way home.',
      setup: function () {
        hosting = 'cosmos';
        ORRERY.Cosmos.enter();
        // Ride the zoom the way a wheel would: ease L from the doorstep to
        // the galaxy over most of the stop, then dwell.
        var from = ORRERY.Cosmos.getL(), to = 10.8, T = 16000;
        var t0 = performance.now(), raf = 0;
        (function ramp() {
          var f = Math.min(1, (performance.now() - t0) / T);
          ORRERY.Cosmos.setL(from + (to - from) * (1 - Math.pow(1 - f, 2.2)));
          if (f < 1) raf = requestAnimationFrame(ramp);
        })();
        return function () {
          cancelAnimationFrame(raf);
          ORRERY.Cosmos.exit();
          hosting = null;
        };
      }
    },
    {
      home: true, restore: true, rate: 4, autoRotate: true, dur: 14000,
      eyebrow: 'Back to today', title: 'The sky is yours',
      text: 'Your clock is back where you left it. Click any world to visit it. Drag time. Open ✦ Explore for the missions, the replays, the Mars manifest and the sandbox — and if you want the written map, the visitor’s guide is one click away in the same menu.'
    }
  ];

  var api = null;
  var els = {};
  var active = false;
  var hosting = null;               // mode the current stop drives (guard exemption)
  var idx = -1;
  var timer = null;
  var saved = null;
  var cleanup = null;               // current stop's teardown, if it made one

  function init(hooks) {
    api = hooks;
    els.root = document.getElementById('tour');
    els.card = els.root.querySelector('.tour-card');
    els.eyebrow = document.getElementById('tour-eyebrow');
    els.title = document.getElementById('tour-title');
    els.text = document.getElementById('tour-text');
    els.dots = document.getElementById('tour-dots');
    els.fill = document.getElementById('tour-progress-fill');

    document.getElementById('opt-tour').addEventListener('click', start);
    // Guarded: the caption card is shared with Replays, which binds its own
    // handlers to the same buttons under its own active flag.
    document.getElementById('tour-prev').addEventListener('click', function () { if (active) step(-1); });
    document.getElementById('tour-next').addEventListener('click', function () { if (active) step(1); });
    document.getElementById('tour-exit').addEventListener('click', exit);

    window.addEventListener('keydown', function (e) {
      if (!active) return;
      if (e.code === 'Escape') exit();
      else if (e.code === 'ArrowRight') step(1);
      else if (e.code === 'ArrowLeft') step(-1);
    });

    els.offer = document.getElementById('tour-offer');
    document.getElementById('offer-start').addEventListener('click', function () {
      dismissOffer();
      start();
    });
    document.getElementById('offer-skip').addEventListener('click', dismissOffer);

    // Mission replays reuse this card and the same camera hooks
    if (ORRERY.Replays) ORRERY.Replays.init(hooks);
  }

  /**
   * Suggest the tour on a first visit with no deep-linked state. The offer
   * yields as soon as the visitor starts exploring on their own (touching
   * the scene) or after half a minute.
   */
  function maybeOffer() {
    var seen = null;
    try { seen = localStorage.getItem('orrery-tour-offered'); } catch (e) { }
    if (seen || ORRERY.Permalink.hasState) return;
    els.offer.classList.add('show');
    document.getElementById('scene').addEventListener('pointerdown', dismissOffer, { once: true });
    setTimeout(dismissOffer, 30000);
  }

  function dismissOffer() {
    els.offer.classList.remove('show');
    try { localStorage.setItem('orrery-tour-offered', '1'); } catch (e) { }
  }

  function start() {
    if (active) return;
    dismissOffer();
    if (ORRERY.Replays) ORRERY.Replays.exit();
    ORRERY.Ride.exit();
    active = true;
    var TB = ORRERY.TimeBar;
    saved = { jd: TB.jd, rate: TB.rate, playing: TB.playing };

    ORRERY.Panel.close();
    ORRERY.AlmanacUI.close();
    document.body.classList.add('touring');
    els.root.classList.add('show');
    els.root.setAttribute('aria-hidden', 'false');

    els.dots.innerHTML = '';
    STOPS.forEach(function (s, i) {
      var d = document.createElement('button');
      d.className = 'tour-dot';
      d.setAttribute('aria-label', 'Go to stop ' + (i + 1));
      d.addEventListener('click', function () { goTo(i); });
      els.dots.appendChild(d);
    });

    goTo(0);
  }

  /** Unwind whatever the current stop built. Always safe to call. */
  function runCleanup() {
    if (!cleanup) return;
    var fn = cleanup;
    cleanup = null;
    fn();
  }

  function resolve(v) { return typeof v === 'function' ? v() : v; }

  function applyStop(s) {
    var TB = ORRERY.TimeBar;
    if (s.setup) cleanup = s.setup() || null;

    api.controls.autoRotate = !!s.autoRotate;
    if (s.hosted) {                 // the hosted mode owns camera and clock
      if (s.rate != null) TB.rate = s.rate;
      return;
    }

    if (s.restore) {
      restoreTime();
    } else if (s.jd != null) {
      TB.jd = resolve(s.jd);        // eased jump; sandbox physics holds meanwhile
    }
    if (s.rate != null) TB.rate = s.rate;
    TB.playing = !s.pause;

    var key = resolve(s.key);
    if (key && api.registry[key]) {
      api.focus(api.registry[key], s.dist || 1);
    } else {
      api.clearFocus();
      api.flyHome();
    }
  }

  function goTo(i) {
    idx = i;
    clearTimeout(timer);
    runCleanup();                   // previous stop leaves a clean scene
    var s = STOPS[i];

    applyStop(s);                   // before captions: dynamic text may need setup

    els.card.classList.add('swap');
    setTimeout(function () {
      if (!active) return;
      els.eyebrow.textContent = resolve(s.eyebrow);
      els.title.textContent = resolve(s.title);
      els.text.textContent = resolve(s.text);
      els.card.classList.remove('swap');
    }, 180);

    els.dots.querySelectorAll('.tour-dot').forEach(function (d, k) {
      d.classList.toggle('active', k === i);
      d.classList.toggle('seen', k < i);
    });

    // Progress bar: restart, then animate to full over the stop's duration
    els.fill.style.transition = 'none';
    els.fill.style.width = '0%';
    void els.fill.offsetWidth;
    els.fill.style.transition = 'width ' + s.dur + 'ms linear';
    els.fill.style.width = '100%';

    timer = setTimeout(function () { step(1); }, s.dur);
  }

  function step(dir) {
    var n = idx + dir;
    if (n < 0) return;
    if (n >= STOPS.length) { exit(); return; }
    goTo(n);
  }

  /** Put the visitor's clock back; idempotent by value, so it can run both
   *  at the "back to today" stop and again on the way out. */
  function restoreTime() {
    var TB = ORRERY.TimeBar;
    TB.jd = saved.jd;
    TB.rate = saved.rate;
    TB.playing = saved.playing;
  }

  function exit() {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    runCleanup();                   // hosted modes / scenarios unwind first
    restoreTime();
    api.controls.autoRotate = false;
    api.clearFocus();
    api.flyHome();
    document.body.classList.remove('touring');
    els.root.classList.remove('show');
    els.root.setAttribute('aria-hidden', 'true');
  }

  return {
    init: init,
    start: start,
    exit: exit,
    maybeOffer: maybeOffer,
    get active() { return active; },
    /** Mode the current stop intentionally drives ('earthorbit' | 'cosmos'
     *  | null) — main.js's guard closures exempt exactly this mode. */
    get hosting() { return hosting; }
  };
})();
