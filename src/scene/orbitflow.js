/**
 * orbitflow.js — ORRERY.OrbitFlow: orbit lines as slowly flowing streams
 * (level 25, Living Orbits).
 *
 * Each orbit line gets an additive overlay whose fragment shader lights a
 * train of short pulses at fixed offsets of MEAN ANOMALY behind the body.
 * The per-vertex attribute aM stores the mean-anomaly fraction at that
 * vertex — Kepler's equation applied to the same uniform-E sweep
 * orbitPath drew — and the per-frame uniform uM0 is the body's own mean
 * fraction at the sim clock. Equal steps of mean anomaly are equal steps
 * of TIME, so the pulses move at the body's true local speed: they
 * stretch long and whip through perihelion, and crawl bunched-up at
 * aphelion — Kepler's 2nd law made visible, dramatic on the comets.
 *
 * Constraints honoured:
 * - Base lines are untouched: the cosmic-zoom fade and the Orbits toggle
 *   keep working as-is. The overlay is a child of its base line, mirrors
 *   the base material's opacity each tick (so cosmos carries it out with
 *   everything else), and hides outright when faded — additive passes
 *   must never see a depth-writing invisible line (level-22 lesson), so
 *   the overlay is depthWrite:false and visibility-gated as well.
 * - Phase rides the SIM clock, not wall time: pause the time bar and the
 *   streams stand still; run time backwards and they flow backwards.
 * - SwiftShader-safe: one varying, no derivatives, no textures.
 * - Quality toggle: setEnabled(false) hides the overlays and skips all
 *   per-frame work (13 elementsAt calls otherwise — cheap, but the extra
 *   translucent overdraw is what a weak GPU wants gone).
 * - Massive mode (level 20): a promoted planet's static ellipse is a lie,
 *   so entries attached with `railsFadable` fade their BASE line out while
 *   NBody.promoted — the overlay follows automatically because it already
 *   mirrors the base opacity. The fade never writes while Cosmos owns the
 *   materials, and writes stop entirely once fully restored, so the rails
 *   render path is untouched when massive mode was never entered.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.OrbitFlow = (function () {
  'use strict';

  var TWO_PI = Math.PI * 2;
  var entries = [];
  var enabled = true;

  var VERT = [
    'attribute float aM;',
    'varying float vM;',
    'void main() {',
    '  vM = aM;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  // d = how far (in mean anomaly, i.e. time) a fragment sits ahead of the
  // body; s picks its place inside one pulse period. Pulses peak where
  // s wraps, with a soft head and a longer tail trailing the motion.
  var FRAG = [
    'varying float vM;',
    'uniform float uM0;',
    'uniform float uFade;',
    'uniform float uCount;',
    'uniform vec3 uColor;',
    'void main() {',
    '  float d = fract(vM - uM0);',
    '  float s = fract(d * uCount);',
    '  float head = smoothstep(0.16, 0.0, s);',
    '  float tail = smoothstep(0.45, 1.0, s);',
    '  float p = max(head, tail * tail * 0.75);',
    '  gl_FragColor = vec4(uColor * (1.0 + 0.6 * head), p * uFade * 0.9);',
    '}'
  ].join('\n');

  /** Mean-anomaly fraction of the body at jd, in [0, 1). */
  function meanFrac(el, jd) {
    var o = ORRERY.Kepler.elementsAt(el, jd);
    var m = (o.L - o.peri) / TWO_PI;
    return m - Math.floor(m);
  }

  /**
   * Attach a flow overlay to an orbit line built by buildOrbitLine.
   * The overlay shares the base line's position buffer; only the aM
   * attribute and the shader are its own. Returns the base line so the
   * call can wrap the existing add() sites.
   */
  function attach(line, body, jd, railsFadable) {
    var o = ORRERY.Kepler.elementsAt(body.el, jd);
    var pos = line.geometry.attributes.position;
    var n = pos.count;

    // orbitPath swept E uniformly over n-1 segments; convert each E to
    // its time fraction via Kepler's equation. aM is monotonic 0 → 1.
    var aM = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var E = (i / (n - 1)) * TWO_PI;
      aM[i] = (E - o.e * Math.sin(E)) / TWO_PI;
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', pos);
    geo.setAttribute('aM', new THREE.BufferAttribute(aM, 1));

    // Pulse count scales with the compressed on-screen circumference so
    // spacing reads similar from Mercury to Neptune.
    var count = Math.max(10, Math.min(120,
      Math.round(20 * Math.pow(o.a, ORRERY.Kepler.DIST_P))));

    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uM0: { value: meanFrac(body.el, jd) },
        uFade: { value: 1 },
        uCount: { value: count },
        uColor: { value: new THREE.Color(body.color) }
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    var overlay = new THREE.Line(geo, mat);
    overlay.frustumCulled = false;
    overlay.renderOrder = 1;                 // after the base line
    line.add(overlay);

    entries.push({
      el: body.el,
      line: line,
      overlay: overlay,
      mat: mat,
      baseMat: line.material,
      base0: line.material.opacity || 1,
      fadable: !!railsFadable
    });
    return line;
  }

  // Massive-mode fade state: 0 = rails truth, 1 = ellipses hidden.
  var railsFade = 0;

  /** Ease the fadable base lines toward (1 - railsFade)·base0. */
  function tickRailsFade() {
    var target = ORRERY.NBody && ORRERY.NBody.promoted ? 1 : 0;
    if (railsFade === target) return;
    if (ORRERY.Cosmos && ORRERY.Cosmos.active) return; // cosmos owns opacity up there; resume after
    railsFade += (target - railsFade) * 0.06;
    if (Math.abs(railsFade - target) < 0.004) railsFade = target;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e.fadable) continue;
      e.baseMat.opacity = e.base0 * (1 - railsFade);
      e.line.visible = railsFade < 0.999;
    }
  }

  /** Per-frame: advance phases with the sim clock, mirror cosmos fades. */
  function tick(jd) {
    tickRailsFade();
    if (!enabled) return;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var fade = e.baseMat.opacity / e.base0;
      e.overlay.visible = fade > 0.02;
      if (!e.overlay.visible) continue;
      e.mat.uniforms.uFade.value = fade;
      e.mat.uniforms.uM0.value = meanFrac(e.el, jd);
    }
  }

  function setEnabled(on) {
    enabled = on;
    for (var i = 0; i < entries.length; i++) entries[i].overlay.visible = on;
  }

  return {
    attach: attach,
    tick: tick,
    setEnabled: setEnabled,
    get enabled() { return enabled; }
  };
})();
