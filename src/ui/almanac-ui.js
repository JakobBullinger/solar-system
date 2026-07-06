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

  function init(onJump) {
    onJumpCb = onJump;
    els.root = document.getElementById('events');
    els.list = document.getElementById('ev-list');
    els.from = document.getElementById('ev-from');
    els.btn = document.getElementById('opt-events');

    els.btn.setAttribute('aria-pressed', 'false');
    els.btn.addEventListener('click', function () {
      isOpen() ? close() : open();
    });
    document.getElementById('ev-close').addEventListener('click', close);
    document.getElementById('ev-refresh').addEventListener('click', function () {
      compute(ORRERY.TimeBar.jd);
    });
  }

  function isOpen() { return els.root.classList.contains('open'); }

  function open() {
    els.root.classList.add('open');
    els.root.setAttribute('aria-hidden', 'false');
    els.btn.setAttribute('aria-pressed', 'true');
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

    var html = '';
    events.forEach(function (ev, i) {
      html +=
        '<button class="ev-row ev-' + ev.kind + '" data-i="' + i + '">' +
          '<span class="ev-date">' + fmtDate(ev.jd) + '</span>' +
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
