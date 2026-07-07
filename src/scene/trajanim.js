/**
 * trajanim.js — ORRERY.TrajAnim: physics-driven animation for trajectory
 * polylines (level 25, Living Orbits).
 *
 * Two primitives, both riding data the physics already produced — nothing
 * here integrates anything:
 *
 * - Draw-in: previewLive/preview keep a point every fixed number of
 *   integrator steps, so a trajectory polyline is uniform in TIME along
 *   its index. Animating the geometry draw range with an ease therefore
 *   plays the flight along its own time axis — the arc leaves Earth first
 *   and arrives last, at no physics cost.
 *
 * - Glyphs: a glow sprite riding a cached previewLive point list, indexed
 *   by the simulation clock (points carry t = days after their departure
 *   epoch). Scrubbing the time bar walks the glyph along its flight for
 *   free — the points exist; positions are lerped in AU, then compressed,
 *   so the glyph stays exactly on the drawn arc.
 *
 * main.js ticks this once per frame AFTER Sandbox.tick, so a draw-in may
 * own a sandbox trail's draw range while it runs — sandbox defers to the
 * line.userData.trajAnim flag this module sets (see sandbox.js tick).
 * Reduced motion snaps draw-ins to complete; glyphs are position, not
 * motion, and always work.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.TrajAnim = (function () {
  'use strict';

  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DURATION = 1.1;                        // draw-in seconds
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  var group = null;                          // glyph sprites live here
  var anims = [];                            // { line, n, t, onDone }
  var glyphs = [];                           // { sprite, points, jd0, seg }
  var glowTex = null;
  var V = null;                              // scratch Vector3 (lazy: THREE stubs)

  function init(opts) {
    group = new THREE.Group();
    opts.scene.add(group);
  }

  /**
   * Grow `line` along its draw range from 0 to n points (default: all of
   * them), eased over `duration` seconds. Replaces any draw-in already
   * running on the same line. opts: { n, duration, onDone }.
   */
  function play(line, opts) {
    opts = opts || {};
    var n = opts.n || line.geometry.attributes.position.count;
    cancel(line);
    if (reducedMotion) {
      line.geometry.setDrawRange(0, n);
      if (opts.onDone) opts.onDone();
      return;
    }
    line.userData.trajAnim = true;
    line.geometry.setDrawRange(0, 0);
    anims.push({ line: line, n: n, t: 0, duration: opts.duration || DURATION, onDone: opts.onDone || null });
  }

  /** Stop a draw-in on `line`, restoring its full draw range (no onDone). */
  function cancel(line) {
    for (var i = anims.length - 1; i >= 0; i--) {
      if (anims[i].line === line) {
        line.geometry.setDrawRange(0, anims[i].n);
        anims.splice(i, 1);
      }
    }
    line.userData.trajAnim = false;
  }

  function isAnimating(line) {
    return !!line.userData.trajAnim;
  }

  /**
   * A sprite riding `points` (previewLive output: {x,y,z,t} in AU, t in
   * days after jd0), positioned by the sim clock each tick. Returns a
   * handle with remove(). opts: { points, jd0, color, scale }.
   */
  function glyph(opts) {
    if (!glowTex) {
      glowTex = ORRERY.Textures.glowSprite('rgba(255,255,255,0.95)', 'rgba(255,255,255,0.12)');
    }
    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(opts.color || '#ffffff'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    sprite.scale.setScalar(opts.scale || 2.2);
    sprite.visible = false;
    group.add(sprite);
    var g = { sprite: sprite, points: opts.points, jd0: opts.jd0, seg: 0 };
    glyphs.push(g);
    return {
      sprite: sprite,
      remove: function () {
        var i = glyphs.indexOf(g);
        if (i !== -1) glyphs.splice(i, 1);
        group.remove(sprite);
      }
    };
  }

  /** Position one glyph for time jd; hides it outside its flight window. */
  function placeGlyph(g, jd) {
    var pts = g.points;
    var t = jd - g.jd0;
    if (!pts.length || t < pts[0].t || t > pts[pts.length - 1].t) {
      g.sprite.visible = false;
      return;
    }
    // Walk the cached segment index — the clock usually moves a little
    // between frames, so this is O(1) amortized even while scrubbing.
    var i = Math.min(g.seg, pts.length - 2);
    while (i > 0 && pts[i].t > t) i--;
    while (i < pts.length - 2 && pts[i + 1].t < t) i++;
    g.seg = i;
    var a = pts[i], b = pts[i + 1];
    var f = (t - a.t) / (b.t - a.t || 1);
    if (!V) V = new THREE.Vector3();
    ORRERY.Kepler.toScene({
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      z: a.z + (b.z - a.z) * f
    }, V);
    g.sprite.position.copy(V);
    g.sprite.visible = true;
  }

  /** Advance draw-ins by real dt and glyphs to sim time jd (per frame). */
  function tick(dt, jd) {
    for (var i = anims.length - 1; i >= 0; i--) {
      var a = anims[i];
      a.t = Math.min(1, a.t + dt / a.duration);
      a.line.geometry.setDrawRange(0, Math.round(easeOutCubic(a.t) * a.n));
      if (a.t >= 1) {
        a.line.userData.trajAnim = false;
        anims.splice(i, 1);
        if (a.onDone) a.onDone();
      }
    }
    for (var k = 0; k < glyphs.length; k++) placeGlyph(glyphs[k], jd);
  }

  return {
    init: init,
    play: play,
    cancel: cancel,
    isAnimating: isAnimating,
    glyph: glyph,
    tick: tick,
    /** Headless-verification snapshot — not UI API. */
    _dev: {
      state: function () {
        return {
          anims: anims.map(function (a) {
            return { n: a.n, t: a.t, drawn: a.line.geometry.drawRange.count };
          }),
          glyphs: glyphs.map(function (g) {
            return {
              visible: g.sprite.visible,
              x: g.sprite.position.x, y: g.sprite.position.y, z: g.sprite.position.z
            };
          })
        };
      }
    }
  };
})();
