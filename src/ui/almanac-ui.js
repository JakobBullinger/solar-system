/**
 * almanac-ui.js — The sky-almanac drawer: a browsable list of upcoming
 * oppositions, elongations and conjunctions, each with a time-jump.
 *
 * Events are computed from the simulation's current date when the drawer
 * opens, and recomputed automatically if the clock has since drifted more
 * than a year from the computed window.
 *
 * Eclipses (level 27) get their own section at the top, from the verified
 * finder in physics/eclipse.js. An eclipse jump is a SWEEP, not a freeze:
 * the clock eases to just before greatest eclipse and then plays at a
 * readable rate, so the Moon's umbra visibly crosses Earth (solar) or the
 * Moon slides copper through Earth's shadow (lunar).
 */
window.ORRERY = window.ORRERY || {};

ORRERY.AlmanacUI = (function () {
  'use strict';

  var SPAN_DAYS = 4 * 365.25;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Eclipse sweep choreography: land the clock LEAD days before greatest
  // eclipse, then play at RATE (days/sim-second) — ~11.5 sim-min per real
  // second, so a ~3 h eclipse plays out in ~15 s.
  var ECLIPSE_LEAD = 0.06;
  var ECLIPSE_RATE = 0.008;

  var els = {};
  var events = [];     // eclipses first, then planetary events (one index space)
  var computedFrom = null;
  var onJumpCb = null;

  function fmtDate(jd) {
    var d = ORRERY.Kepler.dateFromJD(jd);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  function nowJd() { return ORRERY.Kepler.julianDate(Date.now()); }

  function init(onJump) {
    onJumpCb = onJump;
    els.root = document.getElementById('events');
    els.list = document.getElementById('ev-list');
    els.from = document.getElementById('ev-from');
    els.btn = document.getElementById('opt-events');
    els.tonight = document.getElementById('ev-tonight');
    els.pill = document.getElementById('tonight-pill');
    els.pillText = document.getElementById('tp-text');

    els.btn.setAttribute('aria-pressed', 'false');
    els.btn.addEventListener('click', function () {
      isOpen() ? close() : open();
    });
    document.getElementById('ev-close').addEventListener('click', close);
    document.getElementById('ev-refresh').addEventListener('click', function () {
      compute(ORRERY.TimeBar.jd);
    });

    document.getElementById('tp-main').addEventListener('click', function () {
      hidePill();
      open();
    });
    document.getElementById('tp-close').addEventListener('click', hidePill);
    initTeaser();
  }

  /** "The sky tonight" — always from the real clock, not the sim clock. */
  function renderTonight() {
    var vis = ORRERY.Almanac.visibility(nowJd());
    var html = '<div class="ev-t-title">The sky tonight</div>';
    vis.forEach(function (v) {
      html += '<div class="ev-t-row' + (v.kind === 'hidden' ? ' dim' : '') + '">' +
        '<span class="chip-dot" style="background:' + v.color + '"></span>' +
        '<span class="ev-t-name">' + v.name + '</span>' +
        '<span class="ev-t-what">' + v.phrase + '</span></div>';
    });
    els.tonight.innerHTML = html;
  }

  /**
   * The retention hook: a one-line pill on load — tonight's headline planet
   * plus the next upcoming sky event with a countdown. Click opens the
   * almanac; deferred so it never competes with first paint.
   */
  function initTeaser() {
    setTimeout(function () {
      var jd = nowJd();
      var vis = ORRERY.Almanac.visibility(jd).filter(function (v) { return v.kind !== 'hidden'; });
      vis.sort(function (a, b) { return b.elong - a.elong; });
      var bits = [];
      if (vis.length) {
        var star = vis[0];
        bits.push(star.name + (star.kind === 'allnight' ? ' is up all night'
          : ' in the ' + star.kind + ' sky'));
      }
      var next = ORRERY.Almanac.findAll(jd, 400)[0];
      if (next) {
        bits.push(next.title + ' in ' + Math.max(1, Math.round(next.jd - jd)) + ' days');
      }
      if (!bits.length) return;
      els.pillText.textContent = bits.join(' · ');
      els.pill.classList.add('show');
    }, 900);
  }

  function hidePill() { els.pill.classList.remove('show'); }

  function isOpen() { return els.root.classList.contains('open'); }

  function open() {
    els.root.classList.add('open');
    els.root.setAttribute('aria-hidden', 'false');
    els.btn.setAttribute('aria-pressed', 'true');
    renderTonight();
    if (computedFrom === null || Math.abs(ORRERY.TimeBar.jd - computedFrom) > 365) {
      compute(ORRERY.TimeBar.jd);
    }
  }

  function close() {
    els.root.classList.remove('open');
    els.root.setAttribute('aria-hidden', 'true');
    els.btn.setAttribute('aria-pressed', 'false');
  }

  function rowHtml(ev, i, now) {
    var dd = Math.round(ev.jd - now);
    var chip = (dd > 0 && dd < 400) ? '<span class="ev-in">in ' + dd + 'd</span>' : '';
    var cls = ev.kind === 'eclipse' ? 'eclipse ev-ecl-' + ev.ecl : ev.kind;
    return '<button class="ev-row ev-' + cls + '" data-i="' + i + '">' +
        '<span class="ev-date">' + fmtDate(ev.jd) + chip + '</span>' +
        '<span class="ev-body"><strong>' + ev.title + '</strong>' +
          '<span class="ev-sub">' + ev.sub + '</span></span>' +
      '</button>';
  }

  function compute(jd0) {
    computedFrom = jd0;
    var eclipses = ORRERY.Eclipse ? ORRERY.Eclipse.findAll(jd0, SPAN_DAYS) : [];
    var sky = ORRERY.Almanac.findAll(jd0, SPAN_DAYS);
    events = eclipses.concat(sky);
    els.from.textContent = 'next 4 years from ' + fmtDate(jd0);

    var now = nowJd();
    var html = '';
    if (eclipses.length) {
      html += '<div class="ev-sec">Eclipses' +
        '<span class="ev-sec-note">jump plays the event — umbra size on the ' +
        'globe is schematic, timing and track are real</span></div>';
      eclipses.forEach(function (ev, i) { html += rowHtml(ev, i, now); });
      html += '<div class="ev-sec">Planets</div>';
    }
    sky.forEach(function (ev, i) { html += rowHtml(ev, eclipses.length + i, now); });
    els.list.innerHTML = html;

    els.list.querySelectorAll('.ev-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var ev = events[parseInt(row.dataset.i, 10)];
        els.list.querySelectorAll('.ev-row').forEach(function (r) {
          r.classList.toggle('active', r === row);
        });
        if (ev.kind === 'eclipse') {
          // Sweep: fly to just before maximum, then let it play readably.
          if (onJumpCb) onJumpCb({ jd: ev.jd - ECLIPSE_LEAD, bodyKey: ev.bodyKey });
          ORRERY.TimeBar.rate = ECLIPSE_RATE;
          ORRERY.TimeBar.playing = true;
        } else if (onJumpCb) {
          onJumpCb(ev);
        }
      });
    });
  }

  return { init: init, close: close };
})();
