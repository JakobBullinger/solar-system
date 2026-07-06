/**
 * almanac-ui.js — The sky-almanac drawer: a browsable list of upcoming
 * oppositions, elongations and conjunctions, each with a time-jump.
 *
 * Events are computed from the simulation's current date when the drawer
 * opens, and recomputed automatically if the clock has since drifted more
 * than a year from the computed window.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.AlmanacUI = (function () {
  'use strict';

  var SPAN_DAYS = 4 * 365.25;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var els = {};
  var events = [];
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

  function compute(jd0) {
    computedFrom = jd0;
    events = ORRERY.Almanac.findAll(jd0, SPAN_DAYS);
    els.from.textContent = 'next 4 years from ' + fmtDate(jd0);

    var now = nowJd();
    var html = '';
    events.forEach(function (ev, i) {
      var dd = Math.round(ev.jd - now);
      var chip = (dd > 0 && dd < 400) ? '<span class="ev-in">in ' + dd + 'd</span>' : '';
      html +=
        '<button class="ev-row ev-' + ev.kind + '" data-i="' + i + '">' +
          '<span class="ev-date">' + fmtDate(ev.jd) + chip + '</span>' +
          '<span class="ev-body"><strong>' + ev.title + '</strong>' +
            '<span class="ev-sub">' + ev.sub + '</span></span>' +
        '</button>';
    });
    els.list.innerHTML = html;

    els.list.querySelectorAll('.ev-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var ev = events[parseInt(row.dataset.i, 10)];
        els.list.querySelectorAll('.ev-row').forEach(function (r) {
          r.classList.toggle('active', r === row);
        });
        if (onJumpCb) onJumpCb(ev);
      });
    });
  }

  return { init: init, close: close };
})();
