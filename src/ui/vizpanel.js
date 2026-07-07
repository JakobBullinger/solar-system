/**
 * vizpanel.js — "Seeing the invisible": the physics-visualization drawer.
 *
 * One options-row button opens a panel of four independent overlay toggles
 * (gravity landscape, speed colours, resonance rose, the Sun's wobble),
 * each with its sub-controls and a note saying what the picture teaches.
 * This module owns ALL the wiring: main.js calls init() once and tick(jd)
 * once per frame, and everything else — the four scene modules, their
 * DOM, their suppression while the cosmic zoom owns the screen — lives
 * here. The panel DOM is built in JS so the shared template gains only
 * the one nav button.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.VizPanel = (function () {
  'use strict';

  var root, btn;
  var GW, OV, SG, BC;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function toggleRow(title, sub, onChange) {
    var row = el('div', 'vz-row');
    var head = el('button', 'vz-head');
    head.setAttribute('aria-pressed', 'false');
    head.innerHTML = '<span class="vz-dot"></span><span class="vz-title">' + title +
      '</span><span class="vz-state">off</span>';
    head.addEventListener('click', function () {
      var on = head.getAttribute('aria-pressed') !== 'true';
      head.setAttribute('aria-pressed', String(on));
      head.querySelector('.vz-state').textContent = on ? 'on' : 'off';
      row.classList.toggle('vz-on', on);
      onChange(on);
    });
    row.appendChild(head);
    if (sub) row.appendChild(sub);
    return row;
  }

  function chipRow(items, activeKey, onPick) {
    var wrap = el('div', 'vz-chips');
    items.forEach(function (it) {
      var c = el('button', 'vz-chip' + (it.key === activeKey ? ' active' : ''), it.label);
      c.addEventListener('click', function () {
        wrap.querySelectorAll('.vz-chip').forEach(function (x) { x.classList.remove('active'); });
        c.classList.add('active');
        onPick(it.key);
      });
      wrap.appendChild(c);
    });
    return wrap;
  }

  function note(html) { return el('p', 'vz-note', html); }

  // --- Sections -----------------------------------------------------------------

  function gravitySection() {
    var sub = el('div', 'vz-sub');
    sub.appendChild(note('Every mass dents the landscape; orbits are what ' +
      'falling along the dents looks like. Depths are log-scaled so Earth’s ' +
      'pinprick and Jupiter’s gorge fit one picture — ordering is honest, ' +
      'absolute depth is not.'));
    sub.appendChild(el('div', 'vz-label', 'Frame'));
    sub.appendChild(chipRow([
      { key: 'sun', label: 'Sun-centred' },
      { key: 'earth', label: 'Earth co-rotating' },
      { key: 'jupiter', label: 'Jupiter co-rotating' }
    ], 'sun', function (k) {
      GW.setFrame(k);
      frameNote.innerHTML = k === 'sun' ? '' :
        'A magnified patch rides ' + (k === 'earth' ? 'Earth' : 'Jupiter') +
        ' in its rotating frame: the two bright dots are <b>L1 and L2</b> — ' +
        'saddle passes out of the planet’s hollow. Turn on <b>L-points</b> in ' +
        'the options row to name them.';
    }));
    var frameNote = note('');
    sub.appendChild(frameNote);
    sub.appendChild(el('div', 'vz-label', 'Quality'));
    sub.appendChild(chipRow([
      { key: 'hi', label: 'High' },
      { key: 'lo', label: 'Low' }
    ], 'hi', function (k) { GW.setQuality(k); }));
    return toggleRow('Gravity landscape', sub, function (on) { GW.setEnabled(on); });
  }

  function speedSection() {
    var sub = el('div', 'vz-sub');
    var legend = el('div', 'vz-legend');
    legend.innerHTML = '<span>3</span><span class="vz-grad"></span><span>60 km/s</span>';
    sub.appendChild(legend);
    sub.appendChild(note('Vis-viva: v² = GM(2/r − 1/a). One colour ramp for ' +
      'everything — the inner system runs hot, comets flash red at perihelion, ' +
      'and an arrow rides the selected body. Aim a sandbox launch or a mission ' +
      'and the arc itself shows a slingshot stealing speed from a planet.'));
    return toggleRow('Speed colours', sub, function (on) { OV.setSpeedMode(on); });
  }

  function resonanceSection() {
    var sub = el('div', 'vz-sub');
    var pairNote = note(ORRERY.Spirograph.PAIRS[0].note);
    sub.appendChild(chipRow(
      ORRERY.Spirograph.PAIRS.map(function (p) { return { key: p.key, label: p.label }; }),
      ORRERY.Spirograph.PAIRS[0].key,
      function (k) {
        SG.setPair(k);
        ORRERY.Spirograph.PAIRS.forEach(function (p) {
          if (p.key === k) {
            pairNote.innerHTML = p.note;
            if (SG.enabled) setPace(p);
          }
        });
      }
    ));
    sub.appendChild(pairNote);
    sub.appendChild(note('<span class="vz-hint">Draws as time runs — enabling ' +
      'this sets a pace that completes the figure in about half a minute. ' +
      'Any speed works; the pattern only depends on where the planets truly are.</span>'));
    return toggleRow('Resonance rose', sub, function (on) {
      SG.setEnabled(on);
      if (on) {
        ORRERY.Spirograph.PAIRS.forEach(function (p) { if (p.key === SG.pair) setPace(p); });
      }
    });
  }

  function setPace(p) {
    ORRERY.TimeBar.rate = p.rate;
    ORRERY.TimeBar.playing = true;
  }

  function wobbleSection() {
    var sub = el('div', 'vz-sub');
    sub.appendChild(note('The planets drag the Sun around the solar system’s ' +
      'true pivot — the <b>barycentre</b> (bright dot, magnified ×' +
      ORRERY.Barycenter.MAG.toLocaleString('en-US') + '; the amber ring is the ' +
      'Sun’s surface at the same scale). Jupiter alone hauls it a full solar ' +
      'radius. Run years-per-second time and watch the rosette build: a distant ' +
      'astronomer reading this wobble in our star’s light would discover ' +
      'Jupiter — exactly how we found our first exoplanets.'));
    return toggleRow('The Sun’s wobble', sub, function (on) { BC.setEnabled(on); });
  }

  // --- Panel shell -----------------------------------------------------------------

  function buildPanel() {
    root = el('aside', 'vizpanel');
    root.id = 'vizpanel';
    root.setAttribute('aria-hidden', 'true');

    var header = el('header', '',
      '<div><h3>Seeing the invisible</h3>' +
      '<span class="vz-sub-title">Physics overlays — each one draws something real</span></div>');
    var close = el('button', '', '✕');
    close.setAttribute('aria-label', 'Close physics overlays');
    close.addEventListener('click', function () { setOpen(false); });
    header.appendChild(close);
    root.appendChild(header);

    var body = el('div', 'vz-body');
    body.appendChild(gravitySection());
    body.appendChild(speedSection());
    body.appendChild(resonanceSection());
    body.appendChild(wobbleSection());
    root.appendChild(body);

    document.body.appendChild(root);
  }

  function setOpen(on) {
    root.classList.toggle('open', on);
    root.setAttribute('aria-hidden', String(!on));
    btn.setAttribute('aria-pressed', String(on));
  }

  function init(opts) {
    GW = ORRERY.GravityWell;
    OV = ORRERY.Overlays;
    SG = ORRERY.Spirograph;
    BC = ORRERY.Barycenter;
    GW.init({ scene: opts.scene });
    OV.init({
      scene: opts.scene, camera: opts.camera,
      orbitLines: opts.orbitLines, getFollow: opts.getFollow
    });
    SG.init({ scene: opts.scene, planets: opts.planets });
    BC.init({ scene: opts.scene });

    buildPanel();
    btn = document.getElementById('opt-viz');
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', function () {
      setOpen(!root.classList.contains('open'));
    });
  }

  /** Per-frame dispatch; overlays yield the stage while the cosmic zoom runs. */
  function tick(jd) {
    var suppressed = !!(ORRERY.Cosmos && ORRERY.Cosmos.active);
    GW.tick(jd, suppressed);
    OV.tick(jd, suppressed);
    SG.tick(jd, suppressed);
    BC.tick(jd, suppressed);
  }

  return { init: init, tick: tick, setOpen: setOpen };
})();
