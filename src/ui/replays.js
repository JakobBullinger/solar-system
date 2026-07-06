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
    var EJ = 2454131.2;                      // Jupiter closest approach (searched)
    var EP = 2457217.5;                      // Pluto closest approach (searched)
    REPLAYS.push({
      key: 'newhorizons',
      name: 'New Horizons',
      craft: 'New Horizons',
      years: '2006 – 2015',
      color: '#cfe3ff',
      blurb: 'The fastest launch in history, a slingshot off Jupiter, and a nine-year fall to Pluto.',
      launch: { jd: L, kms: 43.7268, theta: 2.1683, phi: 0.9063 },
      burns: [
        { jd: 2454191.15, dv: { x: -0.0000119, y: 0.000541, z: -0.0000991 } }
      ],
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
          text: 'A short thruster firing after the flyby hones the aim. Then the probe hibernates through most of a decade — mission control wakes it once a year to check its pulse.'
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
    var EV1 = 2450929.5;                     // Venus 1 (searched)
    var DSM = 2451150.5;                     // deep space maneuver
    var EV2 = 2451353.5;                     // Venus 2 (searched)
    var EE = 2451408.5;                      // Earth flyby (searched)
    var EJ = 2451908.5;                      // Jupiter (searched)
    var ES = 2453187.5;                      // Saturn arrival (searched)
    REPLAYS.push({
      key: 'cassini',
      name: 'Cassini–Huygens',
      craft: 'Cassini',
      years: '1997 – 2004',
      color: '#f5d9a0',
      blurb: 'Too heavy to fly straight to Saturn, Cassini went inward first — Venus, Venus, Earth, Jupiter, then home among the rings.',
      launch: { jd: L, kms: 27.0, theta: -8, phi: 0 },
      burns: [
        { jd: DSM, dv: { x: 0, y: 0, z: 0 } },
        { jd: EV2 + 8, dv: { x: 0, y: 0, z: 0 } },
        { jd: EE + 20, dv: { x: 0, y: 0, z: 0 } },
        { jd: EJ + 60, dv: { x: 0, y: 0, z: 0 } },
        { jd: ES, dv: { x: 0, y: 0, z: 0 } }
      ],
      checks: [
        { key: 'venus', win: [EV1 - 60, EV1 + 60], label: 'venus1' },
        { key: 'venus', win: [EV2 - 60, EV2 + 45], label: 'venus2' },
        { key: 'earth', win: [EE - 40, EE + 40] },
        { key: 'jupiter', win: [EJ - 120, EJ + 120] },
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
          jd: EV1 - 25, rate: 3, back: 8, target: 'venus',
          eyebrow: 'Gravity assist 1 of 4', title: 'First slingshot',
          text: 'Venus bends the trajectory and hands over momentum from its own orbit. The spacecraft gains speed; Venus slows by less than an atom’s width per century.'
        },
        {
          jd: EV1 + 20, rate: 20, back: 24,
          eyebrow: 'Cruise', title: 'One loop around the Sun',
          text: 'The new orbit swings out past Earth’s distance and back. Out here, near aphelion, moving slowly, is the cheapest place to reshape a trajectory.'
        },
        {
          jd: DSM - 10, rate: 4, back: 14, target: 'venus',
          eyebrow: 'Deep Space Maneuver', title: 'The engine lights, once',
          text: 'In December 1998 Cassini’s main engine burned for 90 minutes — the mission’s single biggest maneuver — bending the orbit to meet Venus a second time.'
        },
        {
          jd: DSM + 25, rate: 20, back: 24, target: 'venus',
          eyebrow: 'Inbound again', title: 'Back to Venus',
          text: 'Half a year of falling. One planet, used twice: the second Venus flyby is aimed far more tightly than the first — it must throw Cassini at Earth.'
        },
        {
          jd: EV2 - 25, rate: 3, back: 8, target: 'venus',
          eyebrow: 'Gravity assist 2 of 4', title: 'Second bite of Venus',
          text: 'Another pass over the cloud tops, another free lunch of momentum. Cassini is now moving fast enough to climb back to Earth’s orbit — where Earth will be.'
        },
        {
          jd: EV2 + 18, rate: 3, back: 10, target: 'earth',
          eyebrow: 'Gravity assist 3 of 4', title: 'A wave goodbye',
          text: 'Just eight weeks after Venus, Cassini flashes past its home planet and steals the biggest boost of the whole tour. It will never come back.'
        },
        {
          jd: EE + 25, rate: 60, back: 28, target: 'jupiter',
          eyebrow: 'Outbound', title: 'Crossing the belt',
          text: 'Finally flung outward, Cassini coasts across the asteroid belt for sixteen months. Ahead, one last accomplice: the largest planet of all.'
        },
        {
          jd: EJ - 60, rate: 8, back: 14, target: 'jupiter',
          eyebrow: 'Gravity assist 4 of 4', title: 'The heavyweight handshake',
          text: 'Jupiter’s pull adds the final 2 km/s. From here the trajectory is a pure ballistic fall — three and a half quiet years, all the way out to Saturn.'
        },
        {
          jd: EJ + 40, rate: 150, back: 28, target: 'saturn',
          eyebrow: 'The last leg', title: 'Alone in the dark',
          text: 'No more planets to borrow from. Cassini climbs a billion kilometres on momentum alone, slowing all the way, while Saturn grows from a dot to a destination.'
        },
        {
          jd: ES - 60, rate: 4, back: 8, target: 'saturn',
          eyebrow: 'Orbit insertion', title: 'Arrival, the hard way',
          text: 'On 1 July 2004 the main engine burns for 96 minutes against the direction of flight. Too short and Cassini skips past Saturn forever; it worked to the second.'
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
   * Advance a particle through the replay's rate schedule from fromJd to
   * toJd in frame-sized slices — the SAME slicing live playback produces —
   * splitting exactly at burn epochs. stepFn(jd0, jd1) does the physics
   * (Sandbox.tick in the app, NBody.step in the offline harness).
   */
  function driveSchedule(def, burns, p, stepFn, fromJd, toJd, dtFn, onFrame) {
    var t = fromJd, bi = 0;
    while (bi < burns.length && burns[bi].jd <= fromJd + 1e-9) bi++;
    while (t < toJd - 1e-6 && p.alive) {
      var d = Math.min(rateAt(def, t) * dtFn(), toJd - t);
      var t1 = t + d;
      while (bi < burns.length && burns[bi].jd <= t1 && burns[bi].jd > t - 1e-9) {
        stepFn(t, burns[bi].jd);
        p.vel.x += burns[bi].dv.x;
        p.vel.y += burns[bi].dv.y;
        p.vel.z += burns[bi].dv.z;
        t = burns[bi].jd;
        bi++;
      }
      stepFn(t, t1);
      t = t1;
      if (onFrame) onFrame(t);
    }
    return t;
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
    ORRERY.TimeBar.jd = def.launch.jd;

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

    var endJd = driveSchedule(def, burns, p, stepFn, def.launch.jd, opts.toJd || def.endJd, dtFn, onFrame);
    var out = {
      alive: p.alive, status: p.status, endJd: endJd,
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
    document.getElementById('tour-exit').addEventListener('click', function () {
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
    ORRERY.TimeBar.jd = def.launch.jd;
    vis = ORRERY.Sandbox.addBody(l.pos, l.vel, def.color, 2600);
    burnIdx = 0;
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
    driveSchedule(current, current.burns, vis.p,
      function (a, b) { ORRERY.Sandbox.tick(a, b); },
      current.launch.jd, target,
      function () { return FRAME; });
    ORRERY.TimeBar.jd = target;
    burnIdx = 0;
    while (burnIdx < current.burns.length && current.burns[burnIdx].jd <= target + 1e-9) burnIdx++;
    applyChapter(i);
  }

  /** Per-frame bookkeeping: exact-time burns, chapter advance, HUD. */
  function frame() {
    if (!active) return;
    raf = requestAnimationFrame(frame);
    var NB = ORRERY.NBody;
    var jd = ORRERY.TimeBar.jd;

    // The main loop integrates in frame slices; when a slice swallowed a
    // burn epoch, rewind to it, apply the impulse, and re-integrate — the
    // leapfrog is time-symmetric, so this is loss-free.
    while (burnIdx < current.burns.length && jd >= current.burns[burnIdx].jd) {
      var b = current.burns[burnIdx];
      if (jd > b.jd) NB.step(jd, b.jd - jd);
      vis.p.vel.x += b.dv.x;
      vis.p.vel.y += b.dv.y;
      vis.p.vel.z += b.dv.z;
      if (jd > b.jd) NB.step(b.jd, jd - b.jd);
      burnIdx++;
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
