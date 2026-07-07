/**
 * gravitywell.js — The gravity landscape: spacetime's rubber sheet, drawn
 * under the ecliptic.
 *
 * Global surface (heliocentric frame): a polar wireframe whose depth is the
 * log-scaled solar potential — depth ∝ log(edge/r), so the funnel reads all
 * the way from Mercury to Neptune instead of being one vertical spike — with
 * a dimple carved at each planet. Dimples get per-planet log scaling (depth
 * ordered by mass, width ~the Hill radius but floored so Earth's well
 * survives the scene's distance compression): ORDERING is honest, absolute
 * depth is not, and that is the only way both Jupiter's gorge and Mercury's
 * pinprick fit in one picture.
 *
 * Co-rotating frames (Sun–Earth / Sun–Jupiter): a magnified patch centred on
 * the planet showing the CR3BP effective potential Φeff = −(1−μ)/r₁ − μ/r₂
 * − ½ρ² in the same normalized rotating frame lagrange.js solves — the
 * saddle passes at L1/L2 appear as the two mountain passes out of the
 * planet's hollow. Saddle positions are taken from ORRERY.Lagrange (read
 * only) so the surface and the L-point markers can never disagree. The
 * patch geometry is static in the rotating frame; each frame it just
 * re-rotates to the planet's current bearing (the scene's radial power-law
 * compression commutes with rotations about the pole, so this is exact).
 *
 * All rendering is LineSegments + vertex colours + additive blending with
 * depthWrite off — no custom shaders, SwiftShader-safe by construction.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.GravityWell = (function () {
  'use strict';

  var MU = 2.9591220828e-4;          // GM_sun, AU³/day² (matches nbody.js)
  var EDGE_AU = 36, INNER_AU = 0.06; // radial extent of the global sheet
  var BASE_Y = -2;                   // sheet hangs just under the ecliptic
  var SUN_S = 19;                    // scene units per decade of solar potential
  var REBUILD_DAYS = 4;              // dimples refresh when jd drifts this far

  var QUALITY = {
    hi: { rings: 104, spokes: 168, patch: 72 },
    lo: { rings: 60,  spokes: 100, patch: 44 }
  };

  var K, scene;
  var enabled = false, frame = 'sun', quality = 'hi';
  var group;                          // everything lives here
  var sheet = null;                   // { line, base:{x,z,au[],ang[]}, builtJd }
  var patch = null;                   // { group, sysKey, planet }
  var planets = [];                   // { el, mu, wellD, wellW }
  var C = null, V = null;

  // M_sun / M_planet (JPL, same table as nbody.js — read-only module, so dup'd)
  var RATIOS = {
    mercury: 6023600,   venus: 408523.7, earth: 328900.56, mars: 3098708,
    jupiter: 1047.3486, saturn: 3497.898, uranus: 22902.98, neptune: 19412.24
  };

  function initPlanets() {
    if (planets.length) return;
    var muMin = MU / 6023600;
    ORRERY.DATA.PLANETS.forEach(function (p) {
      if (!RATIOS[p.key]) return;
      var mu = MU / RATIOS[p.key];
      planets.push({
        key: p.key, el: p.el, mu: mu,
        // depth: ~2.5 units for Mercury up to ~11 for Jupiter (log in mass)
        wellD: 2.5 + 2.3 * Math.log(mu / muMin) / Math.LN10
      });
    });
  }

  // --- Global sheet ------------------------------------------------------------

  /** Depth of the solar funnel at heliocentric radius r (AU). */
  function sunDepth(r) {
    return SUN_S * Math.log(EDGE_AU / Math.max(r, INNER_AU)) / Math.LN10;
  }

  function colorForDepth(d, out) {
    var t = Math.max(0, Math.min(1, d / 46));
    out.setRGB(0.10 + 0.85 * t, 0.16 + 0.50 * t, 0.34 - 0.10 * t);
    return out;
  }

  function buildSheet() {
    var q = QUALITY[quality];
    var nR = q.rings, nS = q.spokes;
    var count = (nR + 1) * nS;
    var pos = new Float32Array(count * 3);
    var col = new Float32Array(count * 3);
    var au = new Float32Array(count);   // per-vertex ecliptic AU coords, cached
    var ex = new Float32Array(count), ey = new Float32Array(count);

    var idx = [];
    for (var i = 0; i <= nR; i++) {
      var r = INNER_AU * Math.pow(EDGE_AU / INNER_AU, i / nR);
      var sr = K.DIST_K * Math.pow(r, K.DIST_P);
      for (var j = 0; j < nS; j++) {
        var th = (j / nS) * Math.PI * 2;
        var v = i * nS + j;
        var x = Math.cos(th), y = Math.sin(th);       // ecliptic frame
        ex[v] = x * r; ey[v] = y * r; au[v] = r;
        pos[v * 3] = x * sr;
        pos[v * 3 + 1] = BASE_Y;                       // depth filled by updateSheet
        pos[v * 3 + 2] = -y * sr;                      // ecliptic y → scene −z
        idx.push(v, i * nS + (j + 1) % nS);            // ring segment
        if (i < nR) idx.push(v, (i + 1) * nS + j);     // spoke segment
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    var line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    line.frustumCulled = false;
    sheet = { line: line, au: au, ex: ex, ey: ey, builtJd: null };
    group.add(line);
  }

  /** Re-carve the planet dimples for the planet positions at jd. */
  function updateSheet(jd) {
    initPlanets();
    var pos = sheet.line.geometry.attributes.position;
    var col = sheet.line.geometry.attributes.color;
    var n = sheet.au.length;

    var wells = planets.map(function (p) {
      var h = K.heliocentric(p.el, jd);
      var hill = h.r * Math.pow(p.mu / (3 * MU), 1 / 3);
      return {
        x: h.x, y: h.y, z2: h.z * h.z,
        d: p.wellD,
        w: Math.max(hill, 0.13 * Math.sqrt(h.r)),  // visual floor: see header
        cut: 7 * Math.max(hill, 0.13 * Math.sqrt(h.r))
      };
    });

    for (var v = 0; v < n; v++) {
      var depth = sunDepth(sheet.au[v]);
      var x = sheet.ex[v], y = sheet.ey[v];
      for (var k = 0; k < wells.length; k++) {
        var w = wells[k];
        var dx = x - w.x, dy = y - w.y;
        if (dx > w.cut || dx < -w.cut || dy > w.cut || dy < -w.cut) continue;
        var d = Math.sqrt(dx * dx + dy * dy + w.z2);
        depth += w.d * Math.log(1 + w.w / (d + 0.02 * w.w));
      }
      pos.setY(v, BASE_Y - depth);
      colorForDepth(depth, C);
      col.setXYZ(v, C.r, C.g, C.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    sheet.builtJd = jd;
  }

  // --- Co-rotating patch ---------------------------------------------------------

  /** Φeff in the normalized rotating frame (Sun at −μ, planet at 1−μ). */
  function phiEff(xn, yn, mu, r2min) {
    var r1 = Math.sqrt((xn + mu) * (xn + mu) + yn * yn);
    var r2 = Math.sqrt((xn - 1 + mu) * (xn - 1 + mu) + yn * yn);
    if (r2 < r2min) r2 = r2min;
    return -(1 - mu) / r1 - mu / r2 - 0.5 * (xn * xn + yn * yn);
  }

  function buildPatch(sysKey) {
    var sys = null;
    ORRERY.Lagrange.SYSTEMS.forEach(function (s) { if (s.key === sysKey) sys = s; });
    var pd = null;
    ORRERY.DATA.PLANETS.forEach(function (p) { if (p.key === sysKey) pd = p; });
    var mu = 1 / (sys.ratio + 1);

    // Saddle geometry from the solved L-points (read-only ground truth)
    var jd = ORRERY.TimeBar.jd;
    var pts = ORRERY.Lagrange.points(sysKey, jd);
    var h = K.heliocentric(pd.el, jd);
    var lp = 1 - mu;
    function normX(P) {                       // heliocentric AU → rotating-frame x
      return Math.sqrt(P.x * P.x + P.y * P.y + P.z * P.z) / h.r - mu;
    }
    var xL1 = normX(pts.L1), xL2 = normX(pts.L2);
    var W = 2.6 * Math.max(lp - xL1, xL2 - lp);   // half-width, L1/L2 well inside
    var r2min = 0.10 * (xL2 - lp);
    var phiL1 = phiEff(xL1, 0, mu, r2min);

    var N = QUALITY[quality].patch;
    var count = (N + 1) * (N + 1);
    var pos = new Float32Array(count * 3);
    var col = new Float32Array(count * 3);

    // First pass: field values, to self-scale the vertical exaggeration
    var f = new Float32Array(count), maxAbs = 0;
    for (var i = 0; i <= N; i++) {
      for (var j = 0; j <= N; j++) {
        var xn = lp + (i / N - 0.5) * 2 * W;
        var yn = (j / N - 0.5) * 2 * W;
        var d = phiL1 - phiEff(xn, yn, mu, r2min);  // 0 at the saddle level
        f[i * (N + 1) + j] = d;
        if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
      }
    }

    // Display: patch spans a fixed on-screen size regardless of the system's
    // true (compressed) extent — a magnified inset pinned to the planet. It
    // hangs BELOW the planet like the global sheet, so the close-up camera
    // looks down onto the relief instead of sitting inside it.
    var H = Math.max(17, ORRERY.Bodies3D.enhancedRadius(pd.radiusKm) * 9);
    var S = H / W;                              // scene units per normalized unit
    var A = 6.5;                                // vertical scale (asinh-compressed)
    var BASE = -7;
    var soft = 0.055 * maxAbs;

    var idx = [];
    for (i = 0; i <= N; i++) {
      for (j = 0; j <= N; j++) {
        var v = i * (N + 1) + j;
        var lx = (i / N - 0.5) * 2 * W * S;
        var lz = -(j / N - 0.5) * 2 * W * S;    // prograde (+y rot) → scene −z
        var depth = A * asinh(f[v] / soft) / asinh(maxAbs / soft) * 3.2;
        pos[v * 3] = lx;
        pos[v * 3 + 1] = BASE - Math.max(depth, -A * 1.2);
        pos[v * 3 + 2] = lz;
        // Palette: hollow → amber (like the sheet), ridge/L4-L5 → teal
        if (depth >= 0) {
          colorForDepth(10 + depth * 1.6, C);
        } else {
          var u = Math.min(1, -depth / A);
          C.setRGB(0.10 + 0.25 * u, 0.30 + 0.45 * u, 0.38 + 0.42 * u);
        }
        col[v * 3] = C.r; col[v * 3 + 1] = C.g; col[v * 3 + 2] = C.b;
        if (j < N) idx.push(v, v + 1);
        if (i < N) idx.push(v, v + N + 1);
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    var line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    line.frustumCulled = false;

    var g = new THREE.Group();
    g.add(line);

    // L1/L2 saddle beacons, at the surface's own saddle height
    [xL1, xL2].forEach(function (xl) {
      var dot = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ORRERY.Textures.glowSprite('rgba(235,245,255,0.95)', 'rgba(140,200,255,0.25)'),
        transparent: true, depthWrite: false
      }));
      dot.scale.setScalar(2.6);
      dot.position.set((xl - lp) * S, BASE, 0);
      g.add(dot);
    });

    group.add(g);
    patch = { group: g, sysKey: sysKey, el: pd.el };
  }

  function asinh(x) { return Math.log(x + Math.sqrt(x * x + 1)); }

  function destroyPatch() {
    if (!patch) return;
    group.remove(patch.group);
    patch.group.children.forEach(function (c) {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    patch = null;
  }

  /** Pin the patch to the planet and face it down the Sun→planet axis. */
  function updatePatch(jd) {
    var h = K.heliocentric(patch.el, jd);
    K.toScene(h, V);
    patch.group.position.copy(V);
    patch.group.rotation.y = Math.atan2(h.y, h.x);
  }

  // --- Lifecycle -------------------------------------------------------------------

  function rebuild() {
    if (sheet) {
      group.remove(sheet.line);
      sheet.line.geometry.dispose();
      sheet.line.material.dispose();
      sheet = null;
    }
    buildSheet();
    updateSheet(ORRERY.TimeBar.jd);
    var sys = frame !== 'sun' ? frame : null;
    destroyPatch();
    if (sys) buildPatch(sys);
  }

  function setEnabled(on) {
    enabled = on;
    group.visible = on;
    if (on && !sheet) rebuild();
    if (on && sheet) updateSheet(ORRERY.TimeBar.jd);
  }

  function setFrame(f) {
    frame = f;
    if (!enabled) return;
    destroyPatch();
    if (f !== 'sun') buildPatch(f);
  }

  function setQuality(q) {
    quality = q;
    if (enabled) rebuild();
  }

  function tick(jd, suppressed) {
    group.visible = enabled && !suppressed;
    if (!enabled || suppressed) return;
    if (sheet.builtJd === null || Math.abs(jd - sheet.builtJd) > REBUILD_DAYS) {
      updateSheet(jd);
    }
    if (patch) updatePatch(jd);
  }

  function init(opts) {
    K = ORRERY.Kepler;
    scene = opts.scene;
    C = new THREE.Color();
    V = new THREE.Vector3();
    group = new THREE.Group();
    group.visible = false;
    scene.add(group);
  }

  return {
    init: init,
    tick: tick,
    setEnabled: setEnabled,
    setFrame: setFrame,
    setQuality: setQuality,
    get enabled() { return enabled; },
    get frame() { return frame; }
  };
})();
