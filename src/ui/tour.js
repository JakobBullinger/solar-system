/**
 * tour.js — Guided cinematic tour.
 *
 * A scripted sequence over everything the orrery can do: camera flights
 * between bodies, per-stop time rates (slow enough to watch Jupiter's moons,
 * fast enough to watch Voyager cross the system), and two time-travel stops
 * (Halley 1986, Voyager 1977). While touring, the working UI hides behind a
 * caption card; stops advance automatically or via ◂ ▸ / arrow keys, and
 * Escape exits. The visitor's clock state is restored on the way out.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Tour = (function () {
  'use strict';

  var HOUR = 1 / 24;   // one hour per second, in days/s

  var STOPS = [
    {
      home: true, rate: 30, autoRotate: true, dur: 12000,
      eyebrow: 'Welcome', title: 'A living map of the solar system',
      text: 'Nothing here is animated by hand — every world sits where it really is, computed from its orbital elements. Right now time is running at thirty days a second.'
    },
    {
      key: 'sun', rate: 4, dur: 13000,
      eyebrow: 'The engine', title: 'The Sun',
      text: ' 99.86% of the solar system’s mass is right here. Everything else — every planet, moon and comet on this map — is rounding error, held on a string of gravity.'
    },
    {
      key: 'earth', rate: HOUR, dur: 14000,
      eyebrow: 'Home', title: 'Earth',
      text: 'Time has slowed to an hour per second: watch the day line sweep across the planet. The Moon beside it is slowly leaving — 3.8 centimetres farther every year.'
    },
    {
      key: 'jupiter', rate: 0.4, dur: 15000,
      eyebrow: 'The giant', title: 'Jupiter’s clockwork',
      text: 'Io, Europa, Ganymede, Callisto — the four dots Galileo saw in 1610, the first proof that not everything orbits the Earth. Io laps the giant in under two days.'
    },
    {
      key: 'saturn', rate: 2, dur: 13000,
      eyebrow: 'The jewel', title: 'Saturn',
      text: 'The rings span 280,000 kilometres and average about ten metres thick — proportionally thinner than a sheet of paper the size of a city.'
    },
    {
      key: 'halley', jd: 2446462.5, rate: 1.5, dist: 4, dur: 15000,
      eyebrow: 'Time travel · February 1986', title: 'Halley’s comet',
      text: 'We’ve jumped the clock back to 1986. This close to the Sun, Halley’s ices boil off into a blue ion tail and a curved dust tail. It returns in July 2061.'
    },
    {
      voyager: true, home: true, rate: 120, dur: 26000,
      eyebrow: 'Time travel · August 1977', title: 'The grand tour',
      text: 'A probe leaves Earth at 38.5 km/s. Watch it steal momentum from Jupiter — the path visibly bends — and ride that slingshot on to Saturn, five years and 1.5 billion kilometres later.'
    },
    {
      home: true, restore: true, rate: 4, autoRotate: true, dur: 14000,
      eyebrow: 'Back to today', title: 'The sky is yours',
      text: 'Click any world to visit it. Drag time. Open the almanac to jump to the next opposition, or launch something of your own in the gravity sandbox.'
    }
  ];

  var api = null;
  var els = {};
  var active = false;
  var idx = -1;
  var timer = null;
  var saved = null;
  var restored = false;
  var voyagerUsed = false;

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
    document.getElementById('tour-prev').addEventListener('click', function () { step(-1); });
    document.getElementById('tour-next').addEventListener('click', function () { step(1); });
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
    ORRERY.Ride.exit();
    active = true;
    restored = false;
    voyagerUsed = false;
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

  function applyStop(s) {
    var TB = ORRERY.TimeBar;
    if (s.voyager) {
      ORRERY.Sandbox.runVoyager();   // clears bodies, jumps to 1977, launches
      voyagerUsed = true;
    } else if (s.restore) {
      restoreTime();
    } else if (s.jd) {
      TB.jd = s.jd;
    }
    if (s.rate != null) TB.rate = s.rate;
    TB.playing = true;

    api.controls.autoRotate = !!s.autoRotate;
    if (s.key && api.registry[s.key]) {
      api.focus(api.registry[s.key], s.dist || 1);
    } else {
      api.clearFocus();
      api.flyHome();
    }
  }

  function goTo(i) {
    idx = i;
    clearTimeout(timer);
    var s = STOPS[i];

    els.card.classList.add('swap');
    setTimeout(function () {
      els.eyebrow.textContent = s.eyebrow;
      els.title.textContent = s.title;
      els.text.textContent = s.text;
      els.card.classList.remove('swap');
    }, 180);

    applyStop(s);

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

  /** Put the visitor's clock back; safe to call more than once. */
  function restoreTime() {
    if (restored) return;
    restored = true;
    var TB = ORRERY.TimeBar;
    TB.jd = saved.jd;
    TB.rate = saved.rate;
    TB.playing = saved.playing;
    if (voyagerUsed) ORRERY.Sandbox.clear();
  }

  function exit() {
    if (!active) return;
    active = false;
    clearTimeout(timer);
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
    get active() { return active; }
  };
})();
