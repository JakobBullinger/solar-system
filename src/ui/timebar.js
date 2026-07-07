/**
 * timebar.js — The time engine and its controls.
 *
 * Simulation time is a Julian date advanced by a signed rate in
 * days-per-real-second, chosen on a log slider from real time (1 s/s)
 * up to one year per second.
 *
 * Clock jumps (porkchop picks, almanac events, mission epochs, "Now")
 * are not teleports but a short logarithmic ease — most of the distance
 * covered immediately, a gentle landing on the target date, so the sky
 * visibly swings instead of blinking. Consumers that must not see
 * mid-flight dates check the `easing` getter (sandbox accumulates the
 * whole jump into one step, so the n-body 30-day teleport guard keeps
 * its exact single-frame semantics). Reduced motion snaps, as does any
 * jump too small to read.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.TimeBar = (function () {
  'use strict';

  var REAL = 1 / 86400;              // real time, in days per second
  var MAX = 365.25;                  // one year per second
  var LOG_MIN = Math.log10(REAL);
  var LOG_MAX = Math.log10(MAX);

  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var EASE_S = 0.55;                 // jump duration, seconds
  var EASE_MIN = 1;                  // jumps under a day just snap
  var easeFlight = null;             // { from, to, t }
  function logEase(t) { return Math.log(1 + 47 * t) / Math.log(48); }

  /** Route every clock assignment here: big jumps ease, small ones snap. */
  function setJd(v) {
    if (!reducedMotion && Math.abs(v - state.jd) > EASE_MIN) {
      easeFlight = { from: state.jd, to: v, t: 0 };
    } else {
      easeFlight = null;
      state.jd = v;
    }
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var state = {
    jd: ORRERY.Kepler.julianDate(Date.now()),
    rate: 4,                         // days per second
    playing: true
  };

  var els = {};

  function sliderFromRate(rate) {
    return (Math.log10(Math.abs(rate)) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  }
  function rateFromSlider(t) {
    return Math.pow(10, LOG_MIN + t * (LOG_MAX - LOG_MIN));
  }

  function describeRate(rate) {
    var d = Math.abs(rate);
    if (d <= REAL * 1.5) return 'real time';
    if (d < 1 / 24) return Math.round(d * 1440) + ' min / s';
    if (d < 1) return (d * 24).toFixed(1) + ' hr / s';
    if (d < 60) return d.toFixed(d < 10 ? 1 : 0) + ' days / s';
    if (d < 365) return (d / 30.44).toFixed(1) + ' months / s';
    return (d / 365.25).toFixed(1) + ' yr / s';
  }

  function formatDate(jd) {
    var d = ORRERY.Kepler.dateFromJD(jd);
    var day = d.getUTCDate();
    var mon = MONTHS[d.getUTCMonth()];
    var yr = d.getUTCFullYear();
    var hh = String(d.getUTCHours()).padStart(2, '0');
    var mm = String(d.getUTCMinutes()).padStart(2, '0');
    return { date: day + ' ' + mon + ' ' + yr, time: hh + ':' + mm + ' UTC' };
  }

  function updateReadout() {
    var f = formatDate(state.jd);
    els.date.textContent = f.date;
    els.time.textContent = f.time;
    els.rateLabel.textContent = describeRate(state.rate);
    els.play.textContent = state.playing ? '❚❚' : '▶';
    els.play.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  }

  function init() {
    els.date = document.getElementById('tb-date');
    els.time = document.getElementById('tb-time');
    els.rateLabel = document.getElementById('tb-rate');
    els.play = document.getElementById('tb-play');
    els.slider = document.getElementById('tb-slider');
    els.now = document.getElementById('tb-now');

    els.slider.value = sliderFromRate(state.rate);

    els.play.addEventListener('click', function () {
      state.playing = !state.playing;
      updateReadout();
    });

    els.slider.addEventListener('input', function () {
      state.rate = rateFromSlider(parseFloat(els.slider.value));
      updateReadout();
    });

    els.now.addEventListener('click', function () {
      setJd(ORRERY.Kepler.julianDate(Date.now()));
      updateReadout();
    });

    document.querySelectorAll('[data-rate]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.rate = parseFloat(btn.dataset.rate);
        els.slider.value = sliderFromRate(state.rate);
        state.playing = true;
        updateReadout();
      });
    });

    window.addEventListener('keydown', function (e) {
      if (e.code === 'Space' && !e.target.closest('input, button')) {
        e.preventDefault();
        state.playing = !state.playing;
        updateReadout();
      }
    });

    updateReadout();
  }

  /** Advance simulation clock. dt in real seconds. */
  function tick(dt) {
    if (easeFlight) {
      // The rate is suspended while the jump flies; playback resumes
      // from the target date the moment the ease lands.
      easeFlight.t = Math.min(1, easeFlight.t + dt / EASE_S);
      state.jd = easeFlight.from +
        (easeFlight.to - easeFlight.from) * logEase(easeFlight.t);
      if (easeFlight.t >= 1) {
        state.jd = easeFlight.to;
        easeFlight = null;
      }
      updateClockOnly();
      return;
    }
    if (state.playing) state.jd += state.rate * dt;
    if (state.playing) updateClockOnly();
  }

  var lastText = '';
  function updateClockOnly() {
    var f = formatDate(state.jd);
    var text = f.date + f.time;
    if (text !== lastText) {
      lastText = text;
      els.date.textContent = f.date;
      els.time.textContent = f.time;
    }
  }

  return {
    init: init,
    tick: tick,
    get jd() { return state.jd; },
    set jd(v) { setJd(v); updateReadout(); },
    /** Teleport without the ease — for choreography that immediately
     *  re-integrates against the new date (replay skips, simulate). */
    snapJd: function (v) {
      easeFlight = null;
      state.jd = v;
      updateReadout();
    },
    get easing() { return !!easeFlight; },
    get playing() { return state.playing; },
    set playing(v) { state.playing = v; updateReadout(); },
    get rate() { return state.rate; },
    set rate(v) {
      state.rate = v;
      els.slider.value = sliderFromRate(v);
      updateReadout();
    }
  };
})();
