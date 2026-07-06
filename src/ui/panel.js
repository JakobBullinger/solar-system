/**
 * panel.js — The body dossier: static facts plus live telemetry
 * (current heliocentric distance and orbital speed from the physics).
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Panel = (function () {
  'use strict';

  var root, els = {};
  var current = null;
  var onCloseCb = null;
  var onPickCb = null;

  function fmt(n, digits) {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: digits, maximumFractionDigits: digits
    });
  }

  function dayLength(hours) {
    var h = Math.abs(hours);
    var retro = hours < 0 ? ' · retrograde' : '';
    if (h < 48) return fmt(h, 1) + ' hours' + retro;
    return fmt(h / 24, 1) + ' Earth days' + retro;
  }

  function yearLength(a) {
    var d = ORRERY.Kepler.periodDays(a);
    if (d < 1000) return fmt(d, 0) + ' days';
    return fmt(d / 365.25, 1) + ' years';
  }

  function init(onClose, onPick) {
    onCloseCb = onClose;
    onPickCb = onPick;
    root = document.getElementById('panel');
    els.name = document.getElementById('p-name');
    els.type = document.getElementById('p-type');
    els.fact = document.getElementById('p-fact');
    els.stats = document.getElementById('p-stats');
    els.live = document.getElementById('p-live');
    els.actions = document.getElementById('p-actions');
    els.moons = document.getElementById('p-moons');
    document.getElementById('p-close').addEventListener('click', close);
  }

  function statRow(label, value) {
    return '<div class="stat"><span class="stat-label">' + label +
      '</span><span class="stat-value">' + value + '</span></div>';
  }

  function show(entry) {
    var b = entry.userData.body;
    current = entry;
    els.name.textContent = b.name;
    els.type.textContent = b.type;
    els.fact.textContent = b.fact;
    els.name.style.setProperty('--accent', b.color);

    var rows = '';
    if (b.stats) {
      b.stats.forEach(function (s) { rows += statRow(s[0], s[1]); });
    } else if (b.orbitDays) {
      rows += statRow('Diameter', fmt(b.radiusKm * 2, 0) + ' km');
      rows += statRow('Distance from ' + b.parentName, fmt(b.distanceKm, 0) + ' km');
      rows += statRow('Orbital period', fmt(b.orbitDays, 1) + ' days');
      rows += statRow('Rotation', 'Tidally locked');
    } else {
      rows += statRow('Diameter', fmt(b.radiusKm * 2, 0) + ' km');
      rows += statRow('Day length', dayLength(b.rotationHours));
      rows += statRow('Year length', yearLength(b.el[0]));
      rows += statRow('Axial tilt', fmt(b.axialTilt, 1) + '°');
      rows += statRow('Mean temp', fmt(b.tempC, 0) + ' °C');
      rows += statRow('Moons', String(b.moonCount));
    }
    els.stats.innerHTML = rows;
    if (!b.el) els.live.innerHTML = '';

    els.moons.innerHTML = '';
    if (b.moons) {
      var mh = '<div class="p-moons-title">Visit a moon</div>';
      b.moons.forEach(function (m) {
        mh += '<button class="p-moon-row" data-key="' + m.key + '">' +
          '<span class="chip-dot" style="background:' + m.color + '"></span>' +
          '<span class="p-moon-name">' + m.name + '</span>' +
          '<span class="p-moon-period">' + m.orbitDays.toFixed(1) + ' d</span></button>';
      });
      els.moons.innerHTML = mh;
      els.moons.querySelectorAll('[data-key]').forEach(function (btn) {
        btn.addEventListener('click', function () { onPickCb(btn.dataset.key); });
      });
    }

    els.actions.innerHTML = '';
    if (b.parentKey) {
      var back = document.createElement('button');
      back.className = 'p-jump';
      back.textContent = '◂ Back to ' + b.parentName;
      back.addEventListener('click', function () { onPickCb(b.parentKey); });
      els.actions.appendChild(back);
    }
    if (b.isComet) {
      var jump = document.createElement('button');
      jump.className = 'p-jump';
      renderJump(jump, b);
      jump.addEventListener('click', function () {
        ORRERY.TimeBar.jd = ORRERY.Kepler.nextPerihelion(b.el, ORRERY.TimeBar.jd);
        renderJump(jump, b);
      });
      els.actions.appendChild(jump);

      var ride = document.createElement('button');
      ride.className = 'p-jump';
      ride.textContent = 'Ride along with ' + b.name + ' ▸';
      var entry = current;
      ride.addEventListener('click', function () {
        ORRERY.Ride.start({
          label: b.name,
          back: 24,
          getPos: function () { return entry.position; }
        });
      });
      els.actions.appendChild(ride);
    }

    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function renderJump(btn, b) {
    var jd = ORRERY.Kepler.nextPerihelion(b.el, ORRERY.TimeBar.jd);
    var d = ORRERY.Kepler.dateFromJD(jd);
    btn.textContent = 'Jump to next perihelion — ' +
      MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ▸';
  }

  /** Refresh live telemetry each frame while an orbiting body is selected. */
  function tick(jd) {
    if (!current || !current.userData.body.el || !root.classList.contains('open')) return;
    var b = current.userData.body;
    var h = ORRERY.Kepler.heliocentric(b.el, jd);
    var speed = ORRERY.Kepler.orbitalSpeed(h.r, h.a);
    els.live.innerHTML =
      '<div class="live-row"><span class="live-label">Distance from Sun</span>' +
      '<span class="live-value">' + fmt(h.r, 3) + ' AU</span></div>' +
      '<div class="live-row"><span class="live-label">Orbital velocity</span>' +
      '<span class="live-value">' + fmt(speed, 2) + ' km/s</span></div>';
  }

  function close() {
    current = null;
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    if (onCloseCb) onCloseCb();
  }

  return {
    init: init, show: show, tick: tick, close: close,
    get current() { return current; }
  };
})();
