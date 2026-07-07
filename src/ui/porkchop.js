/**
 * porkchop.js — Launch Window Lab: in-app porkchop plots.
 *
 * A Δv heatmap over departure date × flight time for a chosen target,
 * computed against the app's own physics (Lambert two-body transfers off
 * Earth's rail — the same Δv currency the Mission Designer charges).
 * The classic structure falls out for free: Mars windows every ~26
 * months, the 1977 Jupiter window Voyager rode, gold valleys where a
 * mission is cheap.
 *
 * The grid (180 departures × 80 flight times, ~6 years of departures) is
 * computed in setTimeout chunks so the frame loop never stalls, painted
 * progressively, and cached per target until the sim clock drifts out of
 * the computed range. Hover reads out a cell; click sets the sim clock to
 * that departure and — for targets with a mission — opens it straight
 * into aiming, window pre-found.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Porkchop = (function () {
  'use strict';

  var NX = 180, NY = 80;             // grid: departure columns × flight-time rows
  var SPAN_DAYS = 6 * 365.25;        // departures span ~2.8 Mars synodic periods
  var LEAD_DAYS = 60;                // start slightly before the sim clock
  var CHUNK_COLS = 6;                // columns per async chunk
  var STALE_DAYS = 180;              // recompute when the clock leaves the plot
  var BANDS = 16;                    // quantized color bands = cheap contours

  // Flight-time ranges bracket each target's Hohmann time (~0.4×–2×)
  var TARGETS = [
    { key: 'mercury', tof: [40, 300] },
    { key: 'venus',   tof: [60, 400],    mission: true },
    { key: 'mars',    tof: [90, 550],    mission: true },
    { key: 'jupiter', tof: [400, 2000],  mission: true },
    { key: 'saturn',  tof: [900, 3600] },
    { key: 'uranus',  tof: [2500, 7500] },
    { key: 'neptune', tof: [5000, 12000] }
  ];

  // Gold = cheap, fading through teal and slate to near-background = costly
  var STOPS = [[255, 210, 127], [103, 227, 210], [61, 95, 148], [14, 20, 34]];
  var MARGIN = { l: 48, r: 12, t: 10, b: 26 };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var els = {};
  var earthEl = null;
  var target = null;
  var plots = {};                    // per-target cache
  var token = 0;                     // bumping cancels the stale compute loop
  var hoverCell = null;
  var buffer, bufCtx, ctx, dpr = 1;

  function fmtDate(jd) {
    var d = ORRERY.Kepler.dateFromJD(jd);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  function bodyOf(key) {
    var b = null;
    ORRERY.DATA.PLANETS.forEach(function (p) { if (p.key === key) b = p; });
    return b;
  }

  // ---- Grid compute -----------------------------------------------------------
  function ensurePlot() {
    var want = ORRERY.TimeBar.jd - LEAD_DAYS;
    var p = plots[target.key];
    if (p && Math.abs(p.startJd - want) < STALE_DAYS) {
      if (!p.done) compute(p);       // resume a half-built cached grid
      return p;
    }
    p = {
      startJd: want,
      dv: new Float32Array(NX * NY).fill(NaN),
      cols: 0, done: false, min: null
    };
    plots[target.key] = p;
    compute(p);
    return p;
  }

  function compute(p) {
    var my = ++token;
    var eT = bodyOf(target.key).el;
    var tof0 = target.tof[0];
    var dTof = (target.tof[1] - tof0) / (NY - 1);
    var dDep = SPAN_DAYS / (NX - 1);
    function chunk() {
      if (my !== token) return;      // a newer compute superseded this one
      var end = Math.min(p.cols + CHUNK_COLS, NX);
      for (var ix = p.cols; ix < end; ix++) {
        var jd = p.startJd + ix * dDep;
        for (var iy = 0; iy < NY; iy++) {
          var tr = ORRERY.Lambert.transfer(earthEl, eT, jd, tof0 + iy * dTof);
          var dv = tr ? tr.dvDep : NaN;
          p.dv[ix * NY + iy] = dv;
          if (tr && (!p.min || dv < p.min.dv)) {
            p.min = { dv: dv, jd: jd, tof: tof0 + iy * dTof, ix: ix, iy: iy };
          }
        }
      }
      p.cols = end;
      p.done = end === NX;
      if (isOpen()) { paint(); renderReadout(); }
      if (!p.done) setTimeout(chunk, 0);
    }
    setTimeout(chunk, 0);
  }

  // ---- Painting ----------------------------------------------------------------
  function colorOf(t) {
    t = Math.min(1, Math.max(0, Math.floor(t * BANDS) / (BANDS - 1)));
    var seg = Math.min(STOPS.length - 2, Math.floor(t * (STOPS.length - 1)));
    var f = t * (STOPS.length - 1) - seg;
    var a = STOPS[seg], b = STOPS[seg + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  function plotRect() {
    var w = els.canvas.clientWidth, h = els.canvas.clientHeight;
    return { x: MARGIN.l, y: MARGIN.t, w: w - MARGIN.l - MARGIN.r, h: h - MARGIN.t - MARGIN.b };
  }

  function syncSize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = els.canvas.clientWidth, h = els.canvas.clientHeight;
    if (els.canvas.width !== Math.round(w * dpr)) {
      els.canvas.width = Math.round(w * dpr);
      els.canvas.height = Math.round(h * dpr);
    }
  }

  function paint() {
    var p = plots[target.key];
    if (!p || !ctx) return;
    syncSize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var w = els.canvas.clientWidth, h = els.canvas.clientHeight;
    var r = plotRect();
    ctx.clearRect(0, 0, w, h);

    // Heatmap: write the grid at native resolution, upscale smoothly.
    // Δv scale runs from the running minimum to ~2.2× it, so the valley
    // structure stays readable for cheap Mars and costly Neptune alike.
    var lo = p.min ? p.min.dv : 0;
    var span = Math.max(1.5, lo * 1.2);
    var img = bufCtx.createImageData(NX, NY);
    for (var ix = 0; ix < NX; ix++) {
      for (var iy = 0; iy < NY; iy++) {
        var idx = ((NY - 1 - iy) * NX + ix) * 4;
        if (ix >= p.cols) continue;                    // not computed yet → transparent
        var v = p.dv[ix * NY + iy];
        var c = isNaN(v) ? STOPS[STOPS.length - 1] : colorOf((v - lo) / span);
        img.data[idx] = c[0]; img.data[idx + 1] = c[1]; img.data[idx + 2] = c[2];
        img.data[idx + 3] = 255;
      }
    }
    bufCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(buffer, r.x, r.y, r.w, r.h);

    // Axes
    ctx.strokeStyle = 'rgba(140,160,200,0.28)';
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = '#8792A6';
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    var d0 = ORRERY.Kepler.dateFromJD(p.startJd);
    for (var yr = d0.getUTCFullYear() + 1; ; yr++) {
      var jd = ORRERY.Kepler.julianDate(Date.UTC(yr, 0, 1));
      if (jd > p.startJd + SPAN_DAYS) break;
      var x = r.x + (jd - p.startJd) / SPAN_DAYS * r.w;
      ctx.strokeStyle = 'rgba(140,160,200,0.14)';
      ctx.beginPath(); ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h + 4); ctx.stroke();
      ctx.fillText(String(yr), x, r.y + r.h + 15);
    }
    ctx.textAlign = 'right';
    var tofSpan = target.tof[1] - target.tof[0];
    var step = [30, 60, 100, 200, 500, 1000, 2000, 3000].filter(function (s) {
      return tofSpan / s <= 6;
    })[0] || 3000;
    for (var tof = Math.ceil(target.tof[0] / step) * step; tof <= target.tof[1]; tof += step) {
      var y = r.y + r.h - (tof - target.tof[0]) / tofSpan * r.h;
      ctx.fillText(tof + 'd', r.x - 5, y + 3);
    }
    ctx.save();
    ctx.translate(11, r.y + r.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('flight time', 0, 0);
    ctx.restore();

    // Cheapest cell + hover crosshair
    if (p.min && p.min.ix < p.cols) drawMark(r, p.min.ix, p.min.iy, '#ffd27f', 5);
    if (hoverCell) drawMark(r, hoverCell.ix, hoverCell.iy, '#e9eef7', 4);
  }

  function drawMark(r, ix, iy, color, rad) {
    var x = r.x + ix / (NX - 1) * r.w;
    var y = r.y + r.h - iy / (NY - 1) * r.h;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - rad - 3, y); ctx.lineTo(x - rad, y);
    ctx.moveTo(x + rad, y); ctx.lineTo(x + rad + 3, y);
    ctx.moveTo(x, y - rad - 3); ctx.lineTo(x, y - rad);
    ctx.moveTo(x, y + rad); ctx.lineTo(x, y + rad + 3);
    ctx.stroke();
  }

  // ---- Readout / interaction -----------------------------------------------------
  function cellAt(e) {
    var rect = els.canvas.getBoundingClientRect();
    var r = plotRect();
    var x = e.clientX - rect.left - r.x;
    var y = e.clientY - rect.top - r.y;
    if (x < 0 || y < 0 || x > r.w || y > r.h) return null;
    var ix = Math.round(x / r.w * (NX - 1));
    var iy = Math.round((r.h - y) / r.h * (NY - 1));
    var p = plots[target.key];
    if (!p || ix >= p.cols) return null;
    var dv = p.dv[ix * NY + iy];
    if (isNaN(dv)) return null;
    return {
      ix: ix, iy: iy, dv: dv,
      jd: p.startJd + ix * (SPAN_DAYS / (NX - 1)),
      tof: target.tof[0] + iy * ((target.tof[1] - target.tof[0]) / (NY - 1))
    };
  }

  function renderReadout(cell) {
    var p = plots[target.key];
    var name = bodyOf(target.key).name;
    var h;
    if (cell) {
      h = 'Depart <strong>' + fmtDate(cell.jd) + '</strong> · ' + Math.round(cell.tof) +
        ' d → ' + name + ' ' + fmtDate(cell.jd + cell.tof) +
        ' · Δv <strong>' + cell.dv.toFixed(1) + ' km/s</strong>';
    } else if (p && !p.done) {
      h = 'Computing ' + name + ' transfers… ' + Math.round(p.cols / NX * 100) + '%';
    } else if (p && p.min) {
      h = 'Cheapest: depart <strong>' + fmtDate(p.min.jd) + '</strong> · ' +
        Math.round(p.min.tof) + ' d · Δv <strong>' + p.min.dv.toFixed(1) +
        ' km/s</strong> — click the map to jump';
    } else {
      h = 'No transfers found in range.';
    }
    els.readout.innerHTML = h;
  }

  function jumpTo(cell) {
    ORRERY.TimeBar.jd = cell.jd;
    ORRERY.TimeBar.playing = false;
    if (target.mission && ORRERY.Missions.aimAt(target.key)) {
      close();
      return;
    }
    renderReadout(cell);
    els.readout.innerHTML += '<br>Clock set — no mission flies here, but the sandbox does.';
  }

  // ---- Drawer ------------------------------------------------------------------
  function isOpen() { return els.root.classList.contains('open'); }

  function open() {
    ORRERY.AlmanacUI.close();        // the left drawers would overlap
    if (ORRERY.MarsPlanner) ORRERY.MarsPlanner.close();
    els.root.classList.add('open');
    els.root.setAttribute('aria-hidden', 'false');
    els.btn.setAttribute('aria-pressed', 'true');
    var p = ensurePlot();
    els.range.textContent = '6 years of departures from ' + fmtDate(p.startJd);
    paint();
    renderReadout();
  }

  function close() {
    els.root.classList.remove('open');
    els.root.setAttribute('aria-hidden', 'true');
    els.btn.setAttribute('aria-pressed', 'false');
  }

  function setTarget(key) {
    TARGETS.forEach(function (t) { if (t.key === key) target = t; });
    els.targets.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.key === target.key);
    });
    hoverCell = null;
    if (els.marsLink) els.marsLink.style.display = target.key === 'mars' ? '' : 'none';
    if (isOpen()) {
      var p = ensurePlot();
      els.range.textContent = '6 years of departures from ' + fmtDate(p.startJd);
      paint();
      renderReadout();
    }
  }

  function init() {
    earthEl = bodyOf('earth').el;
    target = TARGETS[2];             // Mars: the canonical porkchop

    els.root = document.getElementById('porkchop');
    els.btn = document.getElementById('opt-porkchop');
    els.targets = document.getElementById('pc-targets');
    els.canvas = document.getElementById('pc-canvas');
    els.readout = document.getElementById('pc-readout');
    els.range = document.getElementById('pc-range');
    ctx = els.canvas.getContext('2d');
    buffer = document.createElement('canvas');
    buffer.width = NX; buffer.height = NY;
    bufCtx = buffer.getContext('2d');

    var h = '';
    TARGETS.forEach(function (t) {
      var b = bodyOf(t.key);
      h += '<button data-key="' + t.key + '"' +
        (t === target ? ' class="active"' : '') + '>' +
        '<span class="chip-dot" style="background:' + b.color + '"></span>' +
        b.name + (t.mission ? ' ◦' : '') + '</button>';
    });
    els.targets.innerHTML = h;
    els.targets.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { setTarget(b.dataset.key); });
    });

    els.btn.setAttribute('aria-pressed', 'false');
    els.btn.addEventListener('click', function () { isOpen() ? close() : open(); });
    document.getElementById('pc-close').addEventListener('click', close);
    document.getElementById('pc-refresh').addEventListener('click', function () {
      delete plots[target.key];
      var p = ensurePlot();
      els.range.textContent = '6 years of departures from ' + fmtDate(p.startJd);
      paint();
      renderReadout();
    });

    // Cross-link: Mars is the one target whose next windows are really booked
    if (ORRERY.MarsPlanner) {
      els.marsLink = document.createElement('button');
      els.marsLink.className = 'pc-mars-link';
      els.marsLink.textContent = 'Five real missions fly these windows — open the Mars planner ▸';
      els.marsLink.addEventListener('click', function () {
        close();
        ORRERY.MarsPlanner.open();
      });
      els.readout.parentNode.insertBefore(els.marsLink, els.readout.nextSibling);
    }

    els.canvas.addEventListener('pointermove', function (e) {
      var cell = cellAt(e);
      hoverCell = cell;
      els.canvas.style.cursor = cell ? 'crosshair' : '';
      paint();
      renderReadout(cell);
    });
    els.canvas.addEventListener('pointerleave', function () {
      hoverCell = null;
      paint();
      renderReadout();
    });
    els.canvas.addEventListener('click', function (e) {
      var cell = cellAt(e);
      if (cell) jumpTo(cell);
    });
    window.addEventListener('resize', function () { if (isOpen()) paint(); });
  }

  /** Introspection for tests and the curious console visitor. */
  function getState() {
    var p = plots[target.key];
    return {
      target: target.key,
      open: isOpen(),
      progress: p ? p.cols / NX : 0,
      done: !!(p && p.done),
      startJd: p ? p.startJd : null,
      min: p && p.min ? { jd: p.min.jd, tof: p.min.tof, dv: p.min.dv } : null
    };
  }

  return { init: init, open: open, close: close, setTarget: setTarget, getState: getState };
})();
