/**
 * replays.js — Mission replays: scripted, narrated re-flights of real
 * missions inside the orrery's own physics.
 *
 * Each replay launches a particle into the n-body integrator with
 * offline-searched parameters (found by running this file's own schedule
 * stepper in Node against nbody.js — the Voyager preset pattern), then
 * plays the mission as chaptered captions keyed to simulation time, with
 * the ride-along camera chasing the spacecraft. Mid-course burns are
 * scripted impulses applied at their exact Julian date — the integration
 * is split around the burn so frame timing never smears an encounter.
 * The visitor's clock is saved on entry and restored on exit.
 *
 * The caption card reuses the tour's DOM and styles; tour and replay
 * drive it under mutually exclusive `active` flags.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Replays = (function () {
  'use strict';

  var KMS = 1731.456;              // 1 AU/day in km/s
  var FRAME = 1 / 60;              // schedule stepping quantum (s)
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* =====================================================================
   * Mission scripts.
   *
   * launch  — heliocentric departure from Earth: speed (km/s), aim theta°
   *           from prograde in the ecliptic, phi° out of plane. Values are
   *           the offline search results; do not hand-edit.
   * burns   — scripted impulses (AU/day) at exact Julian dates.
   * chapters— caption stops; each sets the time rate (days/s) and the
   *           chase-camera distance when the sim clock crosses its jd.
   * checks  — encounter targets the headless verifier scores.
   * ===================================================================== */

  var REPLAYS = [];

  (function defineNewHorizons() {
    var L = 2453755.0;                       // 19 Jan 2006
    var EJ = 2454160.4;                      // Jupiter closest approach (searched)
    var EP = 2457217.5;                      // Pluto closest approach (searched)
    REPLAYS.push({
      key: 'newhorizons',
      name: 'New Horizons',
      craft: 'New Horizons',
      years: '2006 – 2015',
      color: '#cfe3ff',
      blurb: 'The fastest launch in history, a slingshot off Jupiter, and a nine-year fall to Pluto.',
      // Fully ballistic: one launch state carries it from Earth past Pluto —
      // Jupiter CA 28 Feb 2007 and Pluto CA 13 Jul 2015, a day off history.
      launch: { jd: L, kms: 42.81290, theta: 1.05900, phi: 0.87885 },
      burns: [],
      checks: [
        { key: 'jupiter', win: [EJ - 150, EJ + 150] },
        { key: 'pluto', win: [EP - 500, EP + 400] }
      ],
      endJd: EP + 240,
      chapters: [
        {
          jd: L, rate: 2, back: 26,
          eyebrow: 'Launch', title: 'The fastest departure ever flown',
          text: 'An Atlas V throws the piano-sized probe away from Earth at 16 km/s — the quickest launch in history. It crossed the Moon’s orbit in nine hours. Apollo took three days.'
        },
        {
          jd: L + 24, rate: 30, back: 30, target: 'jupiter',
          eyebrow: 'Cruise', title: 'Racing to Jupiter',
          text: 'Even at 45 km/s the outer system is far away: thirteen months to Jupiter. New Horizons crossed the orbit of Mars just eleven weeks after launch.'
        },
        {
          jd: EJ - 45, rate: 4, back: 12, target: 'jupiter',
          eyebrow: 'Gravity assist', title: 'Stealing speed from a giant',
          text: 'Jupiter’s gravity bends the trajectory and donates almost 4 km/s — three years shaved off the trip. Watch the path kink as the giant slings the probe outward.'
        },
        {
          jd: EJ + 25, rate: 250, back: 30, target: 'pluto',
          eyebrow: 'The long dark', title: 'Eight years of falling',
          text: 'Nothing left to do but coast. The probe hibernates through most of a decade — mission control wakes it once a year to check its pulse, then lets it sleep again.'
        },
        {
          jd: EP - 60, rate: 6, back: 14, target: 'pluto',
          eyebrow: 'Approach', title: 'Three billion miles, on target',
          text: 'After nine and a half years, Pluto swells from a point of light into a world. There is no braking into orbit at this speed — the probe gets one shot as it flies through.'
        },
        {
          jd: EP - 6, rate: 1.5, back: 6, target: 'pluto',
          eyebrow: 'Flyby', title: 'Pluto, at last',
          text: 'On 14 July 2015 New Horizons skimmed 12,500 km above the surface and found a heart-shaped nitrogen glacier the size of Texas on a world everyone had drawn as a grey dot.'
        },
        {
          jd: EP + 12, rate: 40, back: 30,
          eyebrow: 'Epilogue', title: 'Into the Kuiper Belt',
          text: 'The probe flew on to Arrokoth in 2019 — the most distant world ever visited — and is still climbing out of the Sun’s grip, transmitting home at 14 km/s.'
        }
      ]
    });
  })();

  (function defineCassini() {
    var L = 2450737.0;                       // 15 Oct 1997
    var EV1 = 2450929.5;                     // Venus 1 (searched: 25 Apr 1998)
    var DSM = 2451015.7;                     // deep space maneuver (searched)
    var EV2 = 2451184.9;                     // Venus 2 (searched: 6 Jan 1999)
    var EE = 2451479.5;                      // Earth flyby (searched: 28 Oct 1999)
    var EJ = 2451971.0;                      // Jupiter (searched: 2 Mar 2001)
    var ES = 2453184.6;                      // Saturn arrival (searched: 28 Jun 2004)
    REPLAYS.push({
      key: 'cassini',
      name: 'Cassini–Huygens',
      craft: 'Cassini',
      years: '1997 – 2004',
      color: '#f5d9a0',
      blurb: 'Too heavy to fly straight to Saturn, Cassini went inward first — Venus, Venus, Earth, Jupiter, then home among the rings.',
      launch: { jd: L, kms: 26.95950, theta: -4.55425, phi: 1.11289 },
      // The n-body integrator's softening mutes inner-planet slingshots, so
      // each big assist's momentum transfer is applied at closest approach:
      // the Earth and Jupiter kicks are searched reference velocities
      // (setv), which also absorbs frame-timing dispersion accumulated over
      // the years-long chain. The DSM and the trim burn are plain impulses,
      // as the real ones were. All values offline-searched.
      burns: [
        { jd: DSM, dv: { x: 0.001030798, y: -0.001772617, z: 0.000533603 } },
        { jd: 2451192.87, dv: { x: -0.000025029, y: -0.000148341, z: -0.000143321 } },
        { jd: 2451479.53, setv: { x: 0.010175822, y: 0.019845413, z: -0.000061462 } },
        { jd: 2451971.03, setv: { x: -0.001025027, y: 0.007726862, z: 0.001244540 } },
        { jd: 2452051.03, setv: { x: -0.003103504, y: 0.006364935, z: -0.000029308 } }
      ],
      // Saturn Orbit Insertion: retro-burn at the detected closest approach,
      // cutting Saturn-relative speed to 0.82 × local escape velocity
      capture: { target: 'saturn', after: ES - 40, frac: 0.82, ratio: 3497.898 },
      checks: [
        { key: 'venus', win: [EV1 - 60, EV1 + 60], label: 'venus1' },
        { key: 'venus', win: [EV2 - 60, EV2 + 60], label: 'venus2' },
        { key: 'earth', win: [EE - 60, EE + 60] },
        { key: 'jupiter', win: [EJ - 100, EJ + 100] },
        { key: 'saturn', win: [ES - 120, ES + 120] }
      ],
      endJd: ES + 240,
      chapters: [
        {
          jd: L, rate: 2, back: 26,
          eyebrow: 'Launch', title: 'Seven years to Saturn — via Venus',
          text: 'Cassini weighed almost six tonnes: no rocket on Earth could throw it straight at Saturn. So it left Earth heading INWARD, to beg speed from other planets’ gravity.'
        },
        {
          jd: L + 20, rate: 15, back: 24, target: 'venus',
          eyebrow: 'Falling sunward', title: 'Down toward Venus',
          text: 'Falling toward the Sun is free — the trick is what you do when you get there. Six months after launch, Venus is waiting exactly where the navigators said it would be.'
        },
        {
          jd: EV1 - 10, rate: 1.5, back: 8, target: 'venus',
          eyebrow: 'Gravity assist 1 of 4', title: 'First slingshot',
          text: 'Venus bends the trajectory and hands over momentum from its own orbit. The spacecraft gains speed; Venus slows by less than an atom’s width per century.'
        },
        {
          jd: EV1 + 8, rate: 8, back: 24,
          eyebrow: 'Cruise', title: 'A loop around the Sun',
          text: 'The flyby reshapes the orbit into a new ellipse. Somewhere along it, moving slowly, is the cheapest place to fire the engine and bend the path back to Venus.'
        },
        {
          jd: DSM - 10, rate: 4, back: 14, target: 'venus',
          eyebrow: 'Deep Space Maneuver', title: 'The engine lights, once',
          text: 'Cassini’s main engine burns for 90 minutes — the mission’s single biggest maneuver, made in empty space with no planet in sight, so the orbit meets Venus a second time.'
        },
        {
          jd: DSM + 25, rate: 15, back: 24, target: 'venus',
          eyebrow: 'Inbound again', title: 'Back to Venus',
          text: 'Months of falling. One planet, used twice: the second Venus flyby is aimed far more tightly than the first — it must line Cassini up for a date with Earth.'
        },
        {
          jd: EV2 - 10, rate: 1.5, back: 8, target: 'venus',
          eyebrow: 'Gravity assist 2 of 4', title: 'Second bite of Venus',
          text: 'Another pass over the cloud tops, another free lunch of momentum. The trajectory now climbs back out toward Earth’s orbit — where Earth itself will be waiting.'
        },
        {
          jd: EV2 + 8, rate: 30, back: 24, target: 'earth',
          eyebrow: 'Homeward', title: 'Chasing the home planet',
          text: 'Out past Venus, curving up to 1 AU. Radio telescopes tracked the spacecraft home: the flyby aim point was a corridor thirty kilometres wide, hit after a two-year journey.'
        },
        {
          jd: EE - 10, rate: 1.5, back: 10, target: 'earth',
          eyebrow: 'Gravity assist 3 of 4', title: 'A wave goodbye',
          text: 'Cassini flashes past its home planet and steals the biggest boost of the whole tour — watch the speed jump. It will never come back.'
        },
        {
          jd: EE + 8, rate: 60, back: 28, target: 'jupiter',
          eyebrow: 'Outbound', title: 'Crossing the belt',
          text: 'Finally flung outward, Cassini coasts across the asteroid belt for sixteen months. Ahead, one last accomplice: the largest planet of all.'
        },
        {
          jd: EJ - 50, rate: 5, back: 14, target: 'jupiter',
          eyebrow: 'Gravity assist 4 of 4', title: 'The heavyweight handshake',
          text: 'Jupiter’s pull bends the path one final time and flings Cassini onto its Saturn transfer. From here the trajectory is a pure ballistic fall.'
        },
        {
          jd: EJ + 35, rate: 150, back: 28, target: 'saturn',
          eyebrow: 'The last leg', title: 'Alone in the dark',
          text: 'No more planets to borrow from. Cassini climbs a billion kilometres on momentum alone, slowing all the way, while Saturn grows from a dot to a destination.'
        },
        {
          jd: ES - 60, rate: 5, back: 8, target: 'saturn',
          eyebrow: 'Orbit insertion', title: 'Arrival, the hard way',
          text: 'The main engine burns for 96 minutes against the direction of flight. Too short a burn and Cassini skips past Saturn forever. It worked to the second — watch it captured.'
        },
        {
          jd: ES + 30, rate: 20, back: 10, target: 'saturn',
          eyebrow: 'In orbit', title: 'Thirteen years among the rings',
          text: 'Captured. Cassini spent 13 years and 294 orbits here, landed Huygens on Titan, and ended in 2017 by melting into the sky it had studied — so its microbes could never touch Enceladus.'
        }
      ]
    });
  })();

  /* =====================================================================
   * Physics helpers — deliberately identical to the sandbox Voyager
   * preset's math, so offline searches transfer 1:1.
   * ===================================================================== */

  function bodyEl(key) {
    var el = null;
    ORRERY.DATA.PLANETS.forEach(function (p) { if (p.key === key) el = p.el; });
    return el;
  }
  function bodyName(key) {
    var n = key;
    ORRERY.DATA.PLANETS.forEach(function (p) { if (p.key === key) n = p.name; });
    return n;
  }

  /** Set the clock WITHOUT the time bar's eased-jump courtesy: replay
   *  choreography re-integrates synchronously against the new date, which
   *  must not race a half-flown ease. (The node harness's TimeBar stub is
   *  a plain object — hence the feature test.) */
  function snapClock(jd) {
    var TB = ORRERY.TimeBar;
    if (TB.snapJd) TB.snapJd(jd); else TB.jd = jd;
  }

  function earthState(jd) {
    var K = ORRERY.Kepler, el = bodyEl('earth');
    var e = K.heliocentric(el, jd);
    var e2 = K.heliocentric(el, jd + 0.5);
    var e1 = K.heliocentric(el, jd - 0.5);
    var v = { x: e2.x - e1.x, y: e2.y - e1.y, z: e2.z - e1.z };
    var vl = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return { pos: e, dir: { x: v.x / vl, y: v.y / vl, z: v.z / vl } };
  }

  /** Departure state for a replay's launch spec (or an override). */
  function launchState(l) {
    var s = earthState(l.jd);
    var th = l.theta * Math.PI / 180, ph = l.phi * Math.PI / 180;
    var rx = s.dir.x * Math.cos(th) - s.dir.y * Math.sin(th);
    var ry = s.dir.x * Math.sin(th) + s.dir.y * Math.cos(th);
    var vx = rx * Math.cos(ph), vy = ry * Math.cos(ph), vz = Math.sin(ph);
    var vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
    vx /= vl; vy /= vl; vz /= vl;
    var v = l.kms / KMS;
    return {
      pos: { x: s.pos.x + vx * 0.02, y: s.pos.y + vy * 0.02, z: s.pos.z + vz * 0.02 },
      vel: { x: vx * v, y: vy * v, z: vz * v }
    };
  }

  /** Time rate (days/s) in force at simulation time t. */
  function rateAt(def, t) {
    var r = def.chapters[0].rate;
    for (var i = 0; i < def.chapters.length; i++) {
      if (t >= def.chapters[i].jd) r = def.chapters[i].rate;
    }
    return r;
  }

  /**
   * Apply a scripted maneuver. `dv` burns add an impulse; `setv` burns put
   * the craft exactly onto the searched reference velocity — physically an
   * impulse of whatever correction accumulated, which is what keeps a
   * years-long chain of flybys convergent under frame-timing noise.
   */
  function applyBurn(p, b) {
    if (b.setv) {
      p.vel.x = b.setv.x; p.vel.y = b.setv.y; p.vel.z = b.setv.z;
    } else {
      p.vel.x += b.dv.x; p.vel.y += b.dv.y; p.vel.z += b.dv.z;
    }
  }

  /**
   * Orbit-insertion burn, computed from the live state at the detected
   * closest approach: cut the planet-relative speed to frac × local escape
   * velocity — captured, however the approach dispersed.
   */
  function applyCapture(p, cap, t) {
    var K = ORRERY.Kepler, el = bodyEl(cap.target);
    var h2 = K.heliocentric(el, t + 0.5), h1 = K.heliocentric(el, t - 0.5);
    var rvx = p.vel.x - (h2.x - h1.x);
    var rvy = p.vel.y - (h2.y - h1.y);
    var rvz = p.vel.z - (h2.z - h1.z);
    var rel = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz);
    var h = K.heliocentric(el, t);
    var d = Math.sqrt(
      (p.pos.x - h.x) * (p.pos.x - h.x) +
      (p.pos.y - h.y) * (p.pos.y - h.y) +
      (p.pos.z - h.z) * (p.pos.z - h.z));
    var vesc = Math.sqrt(2 * (ORRERY.NBody.MU / cap.ratio) / d);
    var k = (cap.frac * vesc - rel) / rel;
    p.vel.x += rvx * k; p.vel.y += rvy * k; p.vel.z += rvz * k;
  }

  /**
   * Advance a particle through the replay's rate schedule from fromJd to
   * toJd in frame-sized slices — the SAME slicing live playback produces —
   * splitting exactly at burn epochs, and firing the capture burn (if the
   * replay has one) at the detected closest approach to its target.
   * stepFn(jd0, jd1) does the physics (Sandbox.tick in the app,
   * NBody.step in the offline harness). Returns { t, captured }.
   */
  function driveSchedule(def, burns, p, stepFn, fromJd, toJd, dtFn, onFrame) {
    var K = ORRERY.Kepler;
    var t = fromJd, bi = 0;
    while (bi < burns.length && burns[bi].jd <= fromJd + 1e-9) bi++;
    var cap = def.capture || null;
    var capEl = cap ? bodyEl(cap.target) : null;
    var captured = false, prevD = 1e9;
    while (t < toJd - 1e-6 && p.alive) {
      var d = Math.min(rateAt(def, t) * dtFn(), toJd - t);
      var t1 = t + d;
      while (bi < burns.length && burns[bi].jd <= t1 && burns[bi].jd > t - 1e-9) {
        stepFn(t, burns[bi].jd);
        applyBurn(p, burns[bi]);
        t = burns[bi].jd;
        bi++;
      }
      stepFn(t, t1);
      t = t1;
      if (cap && !captured && t >= cap.after) {
        var h = K.heliocentric(capEl, t);
        var dx = p.pos.x - h.x, dy = p.pos.y - h.y, dz = p.pos.z - h.z;
        var dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dd >= prevD && prevD < 0.3) {
          applyCapture(p, cap, t);
          captured = true;
        }
        prevD = Math.min(prevD, dd);
      }
      if (onFrame) onFrame(t);
    }
    return { t: t, captured: captured };
  }

  /**
   * Run a whole replay headlessly and score its encounters. Used by the
   * offline parameter search (Node, opts.step = NBody) and by the headless
   * verifier (browser, default step = Sandbox.tick, the live code path).
   * opts: { launch?, burns?, toJd?, jitter?, seed?, step?, spawn?, kill? }
   */
  function simulate(def, opts) {
    opts = opts || {};
    var K = ORRERY.Kepler;
    var burns = opts.burns || def.burns;
    var l = launchState(opts.launch || def.launch);
    snapClock(def.launch.jd);

    var vis = null, p;
    if (opts.spawn) {
      p = opts.spawn(l);
    } else {
      ORRERY.Sandbox.clear();
      vis = ORRERY.Sandbox.addBody(l.pos, l.vel, '#fff', 240);
      p = vis.p;
    }
    var stepFn = opts.step || function (a, b) { ORRERY.Sandbox.tick(a, b); };

    var seed = (opts.seed || 1) >>> 0;
    var dtFn = function () { return FRAME; };
    if (opts.jitter) {
      dtFn = function () {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return FRAME * (1 - opts.jitter + 2 * opts.jitter * (seed / 4294967296));
      };
    }

    var checks = def.checks.map(function (c) {
      return { key: c.key, label: c.label || c.key, win: c.win, el: bodyEl(c.key), d: 1e9, jd: 0 };
    });
    var onFrame = function (t) {
      for (var i = 0; i < checks.length; i++) {
        var c = checks[i];
        if (c.win && (t < c.win[0] || t > c.win[1])) continue;
        var h = K.heliocentric(c.el, t);
        var dx = p.pos.x - h.x, dy = p.pos.y - h.y, dz = p.pos.z - h.z;
        var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < c.d) {
          c.d = d;
          c.jd = t;
          c.state = { pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, vel: { x: p.vel.x, y: p.vel.y, z: p.vel.z } };
          c.planet = h;
        }
      }
    };

    var res = driveSchedule(def, burns, p, stepFn, def.launch.jd, opts.toJd || def.endJd, dtFn, onFrame);
    var out = {
      alive: p.alive, status: p.status, endJd: res.t, captured: res.captured,
      end: { pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, vel: { x: p.vel.x, y: p.vel.y, z: p.vel.z } },
      rec: {}
    };
    checks.forEach(function (c) {
      out.rec[c.label] = { d: c.d, jd: c.jd, state: c.state, planet: c.planet };
    });
    if (vis) ORRERY.Sandbox.removeBody(vis);
    else if (opts.kill) opts.kill(p);
    return out;
  }

  /* =====================================================================
   * Playback UI.
   * ===================================================================== */

  var api = null;
  var els = {};
  var active = false;
  var current = null;               // replay def
  var idx = -1;                     // chapter index
  var vis = null;                   // sandbox visual of the spacecraft
  var saved = null;                 // visitor clock state
  var burnIdx = 0;
  var capDone = false;              // capture burn fired (this flight)
  var capPrevD = 1e9;
  var raf = 0;

  function fmtDate(jd) {
    var d = ORRERY.Kepler.dateFromJD(jd);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  function init(hooks) {
    api = hooks;
    // The replay drives the tour's caption card; the two are mutually
    // exclusive via their active flags.
    els.root = document.getElementById('tour');
    els.card = els.root.querySelector('.tour-card');
    els.eyebrow = document.getElementById('tour-eyebrow');
    els.title = document.getElementById('tour-title');
    els.text = document.getElementById('tour-text');
    els.stat = document.getElementById('replay-stat');
    els.dots = document.getElementById('tour-dots');
    els.fill = document.getElementById('tour-progress-fill');
    els.next = document.getElementById('tour-next');
    els.exit = document.getElementById('tour-exit');
    els.menu = document.getElementById('replay-menu');

    document.getElementById('opt-replays').addEventListener('click', toggleMenu);
    document.getElementById('rp-close').addEventListener('click', function () { showMenu(false); });

    var list = document.getElementById('replay-list');
    REPLAYS.forEach(function (def) {
      var item = document.createElement('button');
      item.className = 'replay-item';
      item.innerHTML =
        '<span class="rp-dot" style="background:' + def.color + '"></span>' +
        '<span class="rp-body"><strong>' + def.name + '</strong>' +
        '<em>' + def.years + '</em><span>' + def.blurb + '</span></span>' +
        '<span class="rp-play">▶</span>';
      item.addEventListener('click', function () { start(def.key); });
      list.appendChild(item);
    });

    document.getElementById('tour-prev').addEventListener('click', function () {
      if (active) goTo(idx - 1);
    });
    els.next.addEventListener('click', function () {
      if (active) goTo(idx + 1);
    });
    els.exit.addEventListener('click', function () {
      if (active) exit();
    });
    window.addEventListener('keydown', function (e) {
      if (!active) return;
      if (e.code === 'ArrowRight') goTo(idx + 1);
      else if (e.code === 'ArrowLeft') goTo(idx - 1);
      // Escape is handled by the ride's exit → onStop → exit()
    });
  }

  function toggleMenu() {
    showMenu(!els.menu.classList.contains('show'));
  }
  function showMenu(on) {
    els.menu.classList.toggle('show', on);
    els.menu.setAttribute('aria-hidden', String(!on));
  }

  function spawnCraft(def) {
    var l = launchState(def.launch);
    snapClock(def.launch.jd);
    vis = ORRERY.Sandbox.addBody(l.pos, l.vel, def.color, 2600);
    burnIdx = 0;
    capDone = false;
    capPrevD = 1e9;
  }

  function start(key) {
    var def = null;
    REPLAYS.forEach(function (r) { if (r.key === key) def = r; });
    if (!def) return;
    if (active) exit();
    if (ORRERY.Tour.active) ORRERY.Tour.exit();
    ORRERY.Ride.exit();
    showMenu(false);

    active = true;
    current = def;
    var TB = ORRERY.TimeBar;
    saved = { jd: TB.jd, rate: TB.rate, playing: TB.playing };

    ORRERY.Panel.close();
    ORRERY.AlmanacUI.close();
    ORRERY.Sandbox.clear();
    document.body.classList.add('touring');
    els.root.classList.add('show');
    els.root.setAttribute('aria-hidden', 'false');
    els.fill.style.transition = 'none';
    els.exit.textContent = 'End replay';
    api.controls.autoRotate = false;

    els.dots.innerHTML = '';
    def.chapters.forEach(function (c, i) {
      var d = document.createElement('button');
      d.className = 'tour-dot';
      d.setAttribute('aria-label', 'Go to chapter ' + (i + 1));
      d.addEventListener('click', function () { goTo(i); });
      els.dots.appendChild(d);
    });

    spawnCraft(def);
    applyChapter(0);

    // The chase camera frames the craft low on screen (looking ahead of
    // it) — right where the caption card sits on shorter viewports. Track
    // it so the shared card dodges out of the spectacle (tour.js).
    ORRERY.Tour.trackSubject(function () {
      return vis && vis.p.alive ? vis.sprite.position : null;
    });

    ORRERY.Ride.start({
      label: def.craft,
      back: def.chapters[0].back,
      getPos: function () { return vis.sprite.position; },
      isAlive: function () { return vis && vis.p.alive; },
      onStop: function () { if (active) exit(); }
    });

    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function applyChapter(i) {
    idx = i;
    var c = current.chapters[i];
    var TB = ORRERY.TimeBar;
    TB.rate = c.rate;
    TB.playing = true;
    ORRERY.Ride.setBack(c.back);

    els.card.classList.add('swap');
    setTimeout(function () {
      if (!active) return;
      els.eyebrow.textContent = fmtDate(c.jd) + ' · ' + c.eyebrow;
      els.title.textContent = c.title;
      els.text.textContent = c.text;
      els.card.classList.remove('swap');
    }, 180);

    els.dots.querySelectorAll('.tour-dot').forEach(function (d, k) {
      d.classList.toggle('active', k === i);
      d.classList.toggle('seen', k < i);
    });
    els.next.textContent = i === current.chapters.length - 1 ? 'Finish' : 'Next ▸';
  }

  /**
   * Jump to a chapter. The spacecraft is respawned at launch and the
   * schedule re-flown deterministically to the chapter's epoch, so a
   * skipped-to encounter is the same encounter live playback produces.
   */
  function goTo(i) {
    if (i < 0) return;
    if (i >= current.chapters.length) { exit(); return; }
    var target = current.chapters[i].jd;
    ORRERY.Sandbox.removeBody(vis);
    spawnCraft(current);
    var res = driveSchedule(current, current.burns, vis.p,
      function (a, b) { ORRERY.Sandbox.tick(a, b); },
      current.launch.jd, target,
      function () { return FRAME; });
    snapClock(target);
    burnIdx = 0;
    while (burnIdx < current.burns.length && current.burns[burnIdx].jd <= target + 1e-9) burnIdx++;
    capDone = res.captured;
    capPrevD = 1e9;
    applyChapter(i);
  }

  /** Per-frame bookkeeping: exact-time burns, chapter advance, HUD. */
  function frame() {
    if (!active) return;
    raf = requestAnimationFrame(frame);
    // A clock ease in flight (someone jumped the date mid-replay): the
    // sandbox is holding physics, so burn/chapter bookkeeping waits too.
    if (ORRERY.TimeBar.easing) return;
    var NB = ORRERY.NBody;
    var jd = ORRERY.TimeBar.jd;

    // The main loop integrates in frame slices; when a slice swallowed a
    // burn epoch, rewind to it, apply the maneuver, and re-integrate — the
    // leapfrog is time-symmetric, so this is loss-free.
    while (burnIdx < current.burns.length && jd >= current.burns[burnIdx].jd) {
      var b = current.burns[burnIdx];
      if (jd > b.jd) NB.step(jd, b.jd - jd);
      applyBurn(vis.p, b);
      ORRERY.Sandbox.flareAt(vis.p.pos, current.color);   // maneuvers glow
      if (jd > b.jd) NB.step(b.jd, jd - b.jd);
      burnIdx++;
    }

    // Orbit insertion fires at the detected closest approach to its target
    var cap = current.capture;
    if (cap && !capDone && jd >= cap.after) {
      var ch = ORRERY.Kepler.heliocentric(bodyEl(cap.target), jd);
      var cdx = vis.p.pos.x - ch.x, cdy = vis.p.pos.y - ch.y, cdz = vis.p.pos.z - ch.z;
      var cd = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz);
      if (cd >= capPrevD && capPrevD < 0.3) {
        applyCapture(vis.p, cap, jd);
        ORRERY.Sandbox.flareAt(vis.p.pos, current.color); // insertion burn
        capDone = true;
      }
      capPrevD = Math.min(capPrevD, cd);
    }

    while (idx + 1 < current.chapters.length && jd >= current.chapters[idx + 1].jd) {
      applyChapter(idx + 1);
    }
    if (jd >= current.endJd) { exit(); return; }

    // Progress across the current chapter, by simulation time
    var c = current.chapters[idx];
    var nextJd = idx + 1 < current.chapters.length ? current.chapters[idx + 1].jd : current.endJd;
    var f = Math.max(0, Math.min(1, (jd - c.jd) / (nextJd - c.jd)));
    els.fill.style.width = (f * 100).toFixed(1) + '%';

    // Live readout: speed, plus range to the chapter's encounter target
    if (vis && vis.p.alive) {
      var v = vis.p.vel;
      var kms = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * KMS;
      var line = kms.toFixed(1) + ' km/s';
      if (c.target) {
        var h = ORRERY.Kepler.heliocentric(bodyEl(c.target), jd);
        var dx = vis.p.pos.x - h.x, dy = vis.p.pos.y - h.y, dz = vis.p.pos.z - h.z;
        var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var range = d < 0.02
          ? Math.round(d * 149597871).toLocaleString('en-US') + ' km'
          : d.toFixed(d < 0.5 ? 3 : 2) + ' AU';
        line = bodyName(c.target) + ' in ' + range + ' · ' + line;
      }
      els.stat.textContent = line;
    }
  }

  function exit() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(raf);
    ORRERY.Tour.trackSubject(null);
    ORRERY.Ride.exit();

    var TB = ORRERY.TimeBar;
    TB.jd = saved.jd;
    TB.rate = saved.rate;
    TB.playing = saved.playing;
    if (vis) ORRERY.Sandbox.removeBody(vis);
    vis = null;
    current = null;
    els.stat.textContent = '';

    document.body.classList.remove('touring');
    els.root.classList.remove('show');
    els.root.setAttribute('aria-hidden', 'true');
    els.exit.textContent = 'End tour';
    api.controls.autoRotate = false;
    api.clearFocus();
    api.flyHome();
  }

  return {
    init: init,
    start: start,
    exit: exit,
    get active() { return active; },
    // Offline search & headless verification hooks — not UI API
    _dev: {
      REPLAYS: REPLAYS,
      launchState: launchState,
      driveSchedule: driveSchedule,
      simulate: simulate
    }
  };
})();
