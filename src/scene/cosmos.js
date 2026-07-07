/**
 * cosmos.js — Powers of Ten: the cosmic zoom (level 22).
 *
 * Scrolling out past the orrery's maximum camera distance enters "cosmos
 * mode": the camera freezes and a single group holding everything beyond
 * the planets — heliosphere, Oort cloud, nearest stars, the Galaxy, the
 * Local Group — is rescaled every frame by  scale = viewR / 10^L,  where
 * L = log10(half-view height in AU). One wheel notch nudges L; five stages
 * cross-fade in and out of their L-windows. Because the world scales
 * instead of the camera moving, there are no far-plane or float-precision
 * cliffs anywhere between 100 AU and 10 million light-years.
 *
 * All content sits at REAL positions (stars.js: J2000 RA/Dec → scene frame,
 * distances in AU): the Voyagers drift along their true outbound tracks
 * with the app clock, the Milky Way band re-resolves into a galaxy whose
 * plane and Sgr A* direction are the real ones, and Andromeda hangs where
 * Andromeda is. Zooming back below L_MIN restores the orrery exactly
 * (camera placed just inside maxDistance, all faded materials restored).
 *
 * Owns its own DOM: stage captions, a live nice-number scale ruler,
 * projected labels, and a dossier card for Voyagers / stars / galaxies.
 * main.js only wires init(), tick(), and a picking guard.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Cosmos = (function () {
  'use strict';

  var DEG = Math.PI / 180;
  var L_MIN = 2.05, L_MAX = 11.8;
  var WHEEL_RATE = 0.0016;

  var ctx = null;
  var active = false, built = false;
  var L = L_MIN, targetL = L_MIN;
  var camDist = 1000, viewR = 466;
  var overs = 0, tAnim = 0;
  var savedCtrl = null;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var group = null;      // scaled world — child positions in AU
  var fixed = null;      // unscaled overlay for fixed-pixel sprites
  var stages = [];       // { key, group, win, mats:[{m,base}], worldPts:[{m,sizeAU}] }
  var fixedItems = [];   // { sprite, posAU|posFn, px|pxFn, win, base }
  var labels = [];       // { el, posAU|posFn, win, dy, data?, sx, sy, alpha }
  var fadeReg = null;    // orrery fade registry
  var starTags = null;   // {band:{m,base}, main:{m,base}}
  var dom = {};
  var cardLive = null;
  var vTmp = null, vTmp2 = null;

  // --- Stage fade windows (L = log10 AU of half-view) -------------------------
  var WIN = {
    orrery: [2.08, 2.55],                  // fade OUT over this
    rings:  [2.02, 2.25, 2.90, 3.60],
    kuiper: [2.02, 2.30, 3.10, 3.90],
    helio:  [2.02, 2.30, 3.80, 4.50],
    voy:    [2.05, 2.30, 3.90, 4.60],
    sedna:  [2.35, 2.80, 4.60, 5.30],
    sun:    [2.02, 2.10, 7.00, 7.60],
    oort:   [3.50, 4.20, 5.30, 6.00],
    stars:  [5.50, 6.05, 7.20, 7.90],
    lyRings:[5.60, 6.20, 6.90, 7.50],
    galaxy: [8.10, 9.10, 99, 99],
    band:   [8.00, 8.90],                  // band stars fade OUT over this
    gmarks: [9.00, 9.45, 10.40, 10.90],
    lgroup: [10.00, 10.60, 99, 99]
  };

  var CAPTIONS = [
    { win: [2.02, 2.30, 3.60, 4.30], title: 'The Heliosphere',
      sub: 'The Sun’s wind inflates a bubble ~120 AU wide in the interstellar gas. Two machines from 1977 have pierced it.' },
    { win: [3.70, 4.30, 5.20, 5.90], title: 'The Oort Cloud',
      sub: 'A shell of a trillion dormant comets reaching past a light-year — the Sun’s true edge. 1 light-year = 63,241 AU.' },
    { win: [5.50, 6.10, 7.00, 7.70], title: 'The Stellar Neighbourhood',
      sub: 'Every star system within a dozen light-years. Click one — its light left years ago.' },
    { win: [8.00, 9.00, 9.90, 10.50], title: 'The Milky Way',
      sub: 'The band across our night sky, seen from outside: 100,000 light-years, ~300 billion stars.' },
    { win: [10.10, 10.70, 99, 99], title: 'The Local Group',
      sub: 'Ten million light-years — our galaxy’s neighbourhood, all of it slowly falling together.' }
  ];

  // --- Small helpers -----------------------------------------------------------
  function smooth(x, a, b) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function fade(l, w) {
    return smooth(l, w[0], w[1]) * (1 - smooth(l, w[2], w[3]));
  }
  function seededRandom(seed) {
    var s = seed;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }
  function el(tag, cls, parent, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    (parent || document.body).appendChild(e);
    return e;
  }
  function pxToWorld(px, dist) {
    return px * (2 * Math.tan(ctx.camera.fov * 0.5 * DEG) * dist) / window.innerHeight;
  }
  function dirV(raH, decD) {
    var d = ORRERY.COSMOS.dirFromRaDec(raH, decD);
    return new THREE.Vector3(d.x, d.y, d.z);
  }

  // --- Sprite textures ----------------------------------------------------------
  function radialTex(size, stops) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(function (s) { grd.addColorStop(s[0], s[1]); });
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    var t = new THREE.CanvasTexture(c);
    return t;
  }
  function glowTex() {
    return radialTex(128, [
      [0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.5)'],
      [0.6, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']
    ]);
  }
  function starTex(color) {
    return radialTex(64, [
      [0, 'rgba(255,255,255,1)'], [0.22, color],
      [0.62, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0)']
    ]);
  }
  function ringTex() {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,220,150,0.9)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(64, 64, 52, 0, Math.PI * 2);
    g.stroke();
    return new THREE.CanvasTexture(c);
  }

  function makeSprite(tex, color, additive) {
    var m = new THREE.SpriteMaterial({
      map: tex, color: color || 0xffffff, transparent: true,
      blending: additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false, depthTest: false
    });
    return new THREE.Sprite(m);
  }

  // --- Stage plumbing ------------------------------------------------------------
  function stage(key, win) {
    var st = { key: key, win: win, group: new THREE.Group(), mats: [], worldPts: [] };
    st.group.visible = false;
    group.add(st.group);
    stages.push(st);
    return st;
  }
  function reg(st, mat) {
    mat.transparent = true;
    mat.depthWrite = false;
    st.mats.push({ m: mat, base: mat.opacity });
    return mat;
  }
  function addFixed(sprite, posAU, px, win, base) {
    sprite.visible = false;
    fixed.add(sprite);
    var it = { sprite: sprite, px: px, win: win, base: base === undefined ? 1 : base };
    if (typeof posAU === 'function') it.posFn = posAU; else it.posAU = posAU;
    fixedItems.push(it);
    return it;
  }
  function addLabel(text, posAU, win, opts) {
    opts = opts || {};
    var e = el(opts.data ? 'button' : 'span',
      'cz-label' + (opts.cls ? ' ' + opts.cls : ''), dom.labelLayer, text);
    if (opts.color) e.style.setProperty('--dot', opts.color);
    var it = { el: e, win: win, dy: opts.dy || 14, data: opts.data || null, alpha: 0, sx: 0, sy: 0 };
    if (typeof posAU === 'function') it.posFn = posAU; else it.posAU = posAU;
    if (opts.data) {
      e.addEventListener('click', function () { showCard(it.data); });
    }
    labels.push(it);
    return it;
  }

  // --- Build: stage 1 — heliosphere ----------------------------------------------
  function circlePoints(r, n, y) {
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var a = (i / n) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y || 0, Math.sin(a) * r));
    }
    return pts;
  }
  function lineLoop(pts, color, opacity, st) {
    var geo = new THREE.BufferGeometry().setFromPoints(pts);
    var mat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: opacity });
    reg(st, mat);
    return new THREE.Line(geo, mat);
  }

  function buildHeliosphere() {
    var C = ORRERY.COSMOS;
    var stR = stage('rings', WIN.rings);
    ORRERY.DATA.PLANETS.forEach(function (p) {
      stR.group.add(lineLoop(circlePoints(p.el[0], 96), 0x5A6C8E, 0.4, stR));
    });

    var stK = stage('kuiper', WIN.kuiper);
    var rand = seededRandom(424242);
    var n = 2800, pos = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var ang = rand() * Math.PI * 2;
      var r = 30 + Math.pow(rand(), 0.8) * 20;
      var o = i * 3;
      pos[o] = Math.cos(ang) * r;
      pos[o + 1] = (rand() - 0.5) * r * 0.28;
      pos[o + 2] = Math.sin(ang) * r;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({
      color: 0x8A97B4, size: 1.3, sizeAttenuation: false,
      transparent: true, opacity: 0.55
    });
    reg(stK, mat);
    stK.group.add(new THREE.Points(geo, mat));

    // Heliopause: Parker's blunt teardrop r(θ) = R0·sqrt(2/(1+cosθ)), tail-capped
    var stH = stage('helio', WIN.helio);
    var R0 = C.HELIOPAUSE.noseAu;
    var nose = dirV(C.HELIOPAUSE.noseRa, C.HELIOPAUSE.noseDec).normalize();
    var cMin = 2 / Math.pow(C.HELIOPAUSE.tailCapAu / R0, 2) - 1;
    var sph = new THREE.SphereGeometry(1, 48, 32);
    var pa = sph.getAttribute('position');
    var v = new THREE.Vector3();
    for (var j = 0; j < pa.count; j++) {
      v.set(pa.getX(j), pa.getY(j), pa.getZ(j)).normalize();
      var ct = Math.max(v.dot(nose), cMin);
      var rr = R0 * Math.sqrt(2 / (1 + ct));
      pa.setXYZ(j, v.x * rr, v.y * rr, v.z * rr);
    }
    sph.computeVertexNormals();
    var hpIn = new THREE.MeshBasicMaterial({
      color: 0x4A6FA5, transparent: true, opacity: 0.14,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    var hpOut = new THREE.MeshBasicMaterial({
      color: 0x3A5A8C, transparent: true, opacity: 0.07,
      side: THREE.FrontSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    reg(stH, hpIn); reg(stH, hpOut);
    stH.group.add(new THREE.Mesh(sph, hpIn), new THREE.Mesh(sph.clone(), hpOut));
    // Label on the flank, away from Voyager 1 (which exited near the nose)
    var flank = new THREE.Vector3().crossVectors(nose, new THREE.Vector3(0, 1, 0)).normalize();
    addLabel('Heliopause', flank.multiplyScalar(R0 * 1.35).addScaledVector(nose, -R0 * 0.2),
      WIN.helio, { cls: 'tag' });

    // Sedna's orbit — the bridge to the Oort cloud
    var stS = stage('sedna', WIN.sedna);
    var sd = C.SEDNA;
    var ci = Math.cos(sd.i * DEG), si = Math.sin(sd.i * DEG);
    var cn = Math.cos(sd.node * DEG), sn = Math.sin(sd.node * DEG);
    var cw = Math.cos(sd.argPeri * DEG), sw = Math.sin(sd.argPeri * DEG);
    var pts = [], apoAU = null;
    for (var k = 0; k <= 180; k++) {
      var E = (k / 180) * Math.PI * 2;
      var xp = sd.a * (Math.cos(E) - sd.e);
      var yp = sd.a * Math.sqrt(1 - sd.e * sd.e) * Math.sin(E);
      var x = (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp;
      var y = (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp;
      var z = (sw * si) * xp + (cw * si) * yp;
      var p = new THREE.Vector3(x, z, -y);
      pts.push(p);
      if (k === 90) apoAU = p.clone();      // E = π → aphelion
    }
    stS.group.add(lineLoop(pts, 0xB07B4F, 0.5, stS));
    addLabel('Sedna’s orbit', apoAU, WIN.sedna, { cls: 'tag' });

    // Voyagers: fixed-pixel star-like sprites + drifting trail lines
    var stV = stage('voy', WIN.voy);
    C.VOYAGERS.forEach(function (vg) {
      var posFn = function (out, jd) {
        var p = C.voyagerPos(vg, jd);
        return out.set(p.x, p.y, p.z);
      };
      var sp = makeSprite(glowTex(), 0xD7E4F5);
      addFixed(sp, posFn, 9, WIN.voy, 0.95);

      var tGeo = new THREE.BufferGeometry();
      tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      var tMat = new THREE.LineBasicMaterial({
        color: 0x9FB6D9, transparent: true, opacity: 0.38,
        blending: THREE.AdditiveBlending
      });
      reg(stV, tMat);
      var trail = new THREE.Line(tGeo, tMat);
      trail.userData.posFn = posFn;
      trail.frustumCulled = false;
      stV.group.add(trail);

      addLabel(vg.name, posFn, WIN.voy, { data: vg, color: vg.color, dy: 16 });
    });

    // The Sun itself: a glow that shrinks from "the star we orbit" to
    // "one star among twenty" as the neighbourhood opens up.
    var sunSp = makeSprite(starTex('rgba(255,196,110,1)'), 0xffffff);
    addFixed(sunSp, new THREE.Vector3(0, 0, 0),
      function (l) { return 30 - 22 * smooth(l, 2.6, 5.8); }, WIN.sun, 1);
    addLabel('Sun', new THREE.Vector3(0, 0, 0), [5.5, 6.0, 7.0, 7.6],
      { color: '#F2A63C', dy: 16 });
  }

  // --- Build: stage 2 — Oort cloud -------------------------------------------------
  function buildOort() {
    var st = stage('oort', WIN.oort);
    var rand = seededRandom(90210);

    function shell(count, rMin, rMax, flat, opacity, size) {
      var pos = new Float32Array(count * 3);
      for (var i = 0; i < count; i++) {
        var u = (rand() * 2 - 1) * flat, phi = rand() * Math.PI * 2;
        var stt = Math.sqrt(1 - u * u);
        var r = rMin + Math.pow(rand(), 1.6) * (rMax - rMin);
        var o = i * 3;
        pos[o] = stt * Math.cos(phi) * r;
        pos[o + 1] = u * r;
        pos[o + 2] = stt * Math.sin(phi) * r;
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      var mat = new THREE.PointsMaterial({
        color: 0x6E7C99, size: size, sizeAttenuation: false,
        transparent: true, opacity: opacity
      });
      reg(st, mat);
      return new THREE.Points(geo, mat);
    }

    // Hills cloud: flattened inner torus; outer cloud: isotropic sphere
    st.group.add(shell(2600, 2000, 20000, 0.45, 0.7, 1.5));
    st.group.add(shell(5600, 20000, 100000, 1.0, 0.6, 1.6));
    addLabel('Inner (Hills) cloud', new THREE.Vector3(14000, 2500, 0),
      [3.6, 4.1, 4.9, 5.4], { cls: 'tag' });
    addLabel('Outer Oort cloud — 1.6 light-years', new THREE.Vector3(0, 52000, 78000),
      [4.4, 4.9, 5.4, 6.0], { cls: 'tag' });
  }

  // --- Build: stage 3 — stellar neighbourhood ---------------------------------------
  function buildStars() {
    var C = ORRERY.COSMOS;
    var st = stage('lyRings', WIN.lyRings);
    [5, 10].forEach(function (ly) {
      st.group.add(lineLoop(circlePoints(ly * C.LY_AU, 128), 0x4E5C77, 0.16, st));
      addLabel(ly + ' light-years', new THREE.Vector3(ly * C.LY_AU * 0.71, 0, ly * C.LY_AU * 0.71),
        WIN.lyRings, { cls: 'tag' });
    });

    C.STARS.forEach(function (s) {
      var posAU = dirV(s.ra, s.dec).multiplyScalar(s.ly * C.LY_AU);
      var sp = makeSprite(starTex(hexToRgba(s.color)), 0xffffff);
      addFixed(sp, posAU, 9 + s.mag * 9, WIN.stars, 1);
      addLabel(s.name, posAU, WIN.stars, { data: s, color: s.color, dy: 15 });
    });
  }
  function hexToRgba(hex) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',1)';
  }

  // --- Build: stage 4 — the Milky Way ------------------------------------------------
  // Shared arm model: 4 logarithmic arms, 12.5° pitch, phase chosen so the
  // Sun's spot (angle 0, r ≈ 0.5 R_disc in the local frame) falls between
  // arms, on a short painted Orion spur.
  var ARM = { pitch: 12.5 * DEG, phase: 0.55, arms: 4, r0frac: 0.08 };
  function armTheta(rFrac, k) {
    return Math.log(Math.max(rFrac, 0.02) / ARM.r0frac) / Math.tan(ARM.pitch) +
      ARM.phase + k * (Math.PI * 2 / ARM.arms);
  }

  function paintGalaxy(size, warm, arms, pitch) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var cx = size / 2, R = size / 2;
    var rand = seededRandom(55555);

    // Disc glow
    var grd = g.createRadialGradient(cx, cx, 0, cx, cx, R);
    grd.addColorStop(0, warm ? 'rgba(255,226,182,1.0)' : 'rgba(230,222,200,0.95)');
    grd.addColorStop(0.10, 'rgba(232,220,198,0.5)');
    grd.addColorStop(0.42, 'rgba(178,193,220,0.19)');
    grd.addColorStop(0.85, 'rgba(148,168,202,0.05)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);

    // Arms: dense clouds of small soft dots along log spirals — drawn small
    // and numerous so they read as continuous luminosity rather than speckle.
    var nArms = arms || ARM.arms;
    var pitchR = (pitch || 12.5) * DEG;
    for (var k = 0; k < nArms; k++) {
      for (var i = 0; i < 2100; i++) {
        var rf = 0.10 + Math.pow(rand(), 0.75) * 0.85;
        var th = Math.log(rf / ARM.r0frac) / Math.tan(pitchR) +
          ARM.phase + k * (Math.PI * 2 / nArms);
        th += (rand() - 0.5) * 0.22;
        var rr = rf * R * (1 + (rand() - 0.5) * 0.06);
        var x = cx + Math.cos(th) * rr, y = cx + Math.sin(th) * rr;
        var young = rand();
        var alpha = (1 - rf) * 0.11 + 0.015;
        g.fillStyle = young > 0.92 ? 'rgba(255,168,190,' + alpha + ')'
          : young > 0.45 ? 'rgba(158,192,244,' + alpha + ')'
          : 'rgba(230,224,206,' + (alpha * 0.75) + ')';
        var s = 1.5 + rand() * 4.5 * (1 - rf * 0.6);
        g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
      }
    }
    // Orion spur: a short arc through the Sun's spot (angle 0, r ≈ 0.504)
    if (nArms === ARM.arms) {
      for (var q = 0; q < 500; q++) {
        var a = (rand() - 0.5) * 0.9;
        var rf2 = 0.504 + a * 0.09 + (rand() - 0.5) * 0.03;
        var th2 = a + (rand() - 0.5) * 0.06;
        var x2 = cx + Math.cos(th2) * rf2 * R, y2 = cx + Math.sin(th2) * rf2 * R;
        g.fillStyle = 'rgba(185,206,242,' + (0.09 * (1 - Math.abs(a))) + ')';
        g.beginPath(); g.arc(x2, y2, 2 + rand() * 3.5, 0, Math.PI * 2); g.fill();
      }
    }
    var t = new THREE.CanvasTexture(c);
    return t;
  }

  function galaxyBasis() {
    var C = ORRERY.COSMOS;
    var gc = dirV(C.GALACTIC.centerRa, C.GALACTIC.centerDec).normalize();
    var ez = dirV(C.GALACTIC.poleRa, C.GALACTIC.poleDec).normalize();
    var ex = gc.clone().multiplyScalar(-1);            // GC → Sun
    ex.sub(ez.clone().multiplyScalar(ex.dot(ez))).normalize();
    var ey = new THREE.Vector3().crossVectors(ez, ex);
    return { gc: gc, ex: ex, ey: ey, ez: ez };
  }

  function buildGalaxy() {
    var C = ORRERY.COSMOS;
    var st = stage('galaxy', WIN.galaxy);
    var B = galaxyBasis();
    var R0 = C.GALACTIC.sunToCenterLy * C.LY_AU;
    var Rd = C.GALACTIC.discRadiusLy * C.LY_AU;
    var gcPos = B.gc.clone().multiplyScalar(R0);

    var frame = new THREE.Group();
    frame.matrix.makeBasis(B.ex, B.ey, B.ez).setPosition(gcPos);
    frame.matrixAutoUpdate = false;
    st.group.add(frame);

    // Painted disc (local xy-plane = galactic plane, +x toward the Sun)
    var planeMat = new THREE.MeshBasicMaterial({
      map: paintGalaxy(1024, true), transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    reg(st, planeMat);
    var plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * Rd, 2 * Rd), planeMat);
    frame.add(plane);

    // Particle disc sampled from the same arm model
    var rand = seededRandom(13579);
    var n = 15000;
    var pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var o = i * 3, rf, th, r, cr, cg, cb;
      if (i < n * 0.22) {                         // bulge / bar
        rf = Math.pow(rand(), 2) * 0.16;
        th = rand() * Math.PI * 2;
        var bar = 1 + 1.6 * Math.pow(Math.abs(Math.cos(th - 2.1)), 3);
        r = rf * Rd * Math.min(bar, 2.2) * 0.6;
        cr = 1.0; cg = 0.85; cb = 0.62;
      } else {                                     // disc + arms
        rf = 0.08 + Math.pow(rand(), 0.85) * 0.9;
        var k = Math.floor(rand() * ARM.arms);
        th = armTheta(rf, k) + (rand() - 0.5) * (0.35 + rf * 0.5);
        r = rf * Rd;
        var young2 = rand();
        if (young2 > 0.94) { cr = 1.0; cg = 0.62; cb = 0.72; }
        else if (young2 > 0.45) { cr = 0.60; cg = 0.74; cb = 0.98; }
        else { cr = 0.85; cg = 0.82; cb = 0.74; }
      }
      var m = 0.5 + rand() * 0.5;
      pos[o] = Math.cos(th) * r;
      pos[o + 1] = Math.sin(th) * r;
      pos[o + 2] = (rand() - 0.5) * Rd * 0.02 * (1 + (1 - rf) * 2);
      col[o] = cr * m; col[o + 1] = cg * m; col[o + 2] = cb * m;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    var pMat = new THREE.PointsMaterial({
      size: 1, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    reg(st, pMat);
    st.worldPts.push({ m: pMat, sizeAU: 8e6 });
    var pts = new THREE.Points(geo, pMat);
    pts.frustumCulled = false;
    frame.add(pts);

    // Central bulge glow
    var bulge = makeSprite(glowTex(), 0xFFD9A0);
    bulge.material.opacity = 0.7;
    reg(st, bulge.material);
    bulge.scale.setScalar(Rd * 0.38);
    bulge.position.copy(gcPos);
    st.group.add(bulge);

    // "You are here" — pulsing amber ring at the Sun's true spot
    var marker = makeSprite(ringTex(), 0xFFC46E);
    marker.userData.pulse = true;
    addFixed(marker, new THREE.Vector3(0, 0, 0), 26, WIN.gmarks, 0.9);
    addLabel('You are here — Orion Arm', new THREE.Vector3(0, 0, 0), WIN.gmarks,
      { color: '#F2A63C', dy: 22, data: C.MILKY_WAY });
    addLabel('Galactic centre — Sgr A*', gcPos, WIN.gmarks, { cls: 'tag', dy: 16 });
    var perseus = B.gc.clone().multiplyScalar(-7000 * C.LY_AU);
    var sagitt = B.gc.clone().multiplyScalar(6200 * C.LY_AU);
    addLabel('Perseus Arm', perseus, [9.15, 9.5, 10.2, 10.6], { cls: 'tag' });
    addLabel('Sagittarius Arm', sagitt, [9.15, 9.5, 10.2, 10.6], { cls: 'tag' });
  }

  // --- Build: stage 5 — the Local Group ------------------------------------------------
  function buildLocalGroup() {
    var C = ORRERY.COSMOS;
    var st = stage('lgroup', WIN.lgroup);
    var los = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler();

    C.GALAXIES.forEach(function (gx) {
      var posAU = dirV(gx.ra, gx.dec).multiplyScalar(gx.mly * 1e6 * C.LY_AU);
      var sizeAU = gx.sizeLy * C.LY_AU;

      if (gx.kind === 'disc') {
        var sub = new THREE.Group();
        sub.position.copy(posAU);
        los.copy(posAU).normalize();
        sub.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), los);
        e.set(gx.tiltDeg * DEG, 0, gx.paDeg * DEG);
        q.setFromEuler(e);
        sub.quaternion.multiply(q);
        var mat = new THREE.MeshBasicMaterial({
          map: paintGalaxy(512, true, 2, 22), transparent: true, opacity: 0.95,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
        });
        reg(st, mat);
        sub.add(new THREE.Mesh(new THREE.PlaneGeometry(sizeAU * 1.5, sizeAU * 1.5), mat));
        var core = makeSprite(glowTex(), 0xFFE2BC);
        core.material.opacity = 0.9;
        reg(st, core.material);
        core.scale.setScalar(sizeAU * 0.5);
        sub.add(core);
        st.group.add(sub);
      } else {
        var blob = makeSprite(glowTex(), new THREE.Color(gx.color));
        blob.material.opacity = 0.65 + gx.glow * 0.3;
        reg(st, blob.material);
        blob.scale.setScalar(sizeAU * 4.5);
        blob.position.copy(posAU);
        st.group.add(blob);
      }
      addLabel(gx.name, posAU, WIN.lgroup, { data: gx, color: gx.color, dy: 15 });
    });

    // The Milky Way's own far-field glow: its particle disc goes subpixel
    // out here, so give home a presence to match its neighbours.
    var mwPos = galaxyBasis().gc.clone()
      .multiplyScalar(ORRERY.COSMOS.GALACTIC.sunToCenterLy * C.LY_AU);
    var mwGlow = makeSprite(glowTex(), 0xEFE2C4);
    mwGlow.material.opacity = 0.95;
    reg(st, mwGlow.material);
    mwGlow.scale.setScalar(C.GALACTIC.discRadiusLy * C.LY_AU * 3.2);
    mwGlow.position.copy(mwPos);
    st.group.add(mwGlow);
    addLabel('Milky Way — home', mwPos,
      [10.35, 10.7, 99, 99], { data: C.MILKY_WAY, color: '#F2A63C', dy: 18 });
  }

  // --- DOM: captions, ruler, dossier card ----------------------------------------------
  function buildDom() {
    dom.wrap = el('div', 'cz-ui', document.body);
    dom.caption = el('div', 'cz-caption', dom.wrap);
    dom.title = el('h2', null, dom.caption);
    dom.sub = el('p', null, dom.caption);
    var ruler = el('div', 'cz-ruler', dom.wrap);
    dom.rulerBar = el('div', 'cz-ruler-bar', ruler);
    dom.rulerTxt = el('span', 'cz-ruler-txt', ruler);
    dom.hint = el('div', 'cz-hint', dom.wrap,
      'scroll out to keep going · scroll in to come home');
    dom.labelLayer = el('div', 'cz-labels', document.body);

    dom.card = el('aside', 'cz-card', document.body);
    dom.card.innerHTML =
      '<button class="cz-card-close" aria-label="Close">✕</button>' +
      '<h3 class="cz-card-name"></h3><p class="cz-card-type"></p>' +
      '<p class="cz-card-fact"></p><div class="cz-card-stats"></div>' +
      '<div class="cz-card-live"></div>';
    dom.card.querySelector('.cz-card-close').addEventListener('click', closeCard);
  }

  function showCard(data) {
    var c = dom.card;
    c.querySelector('.cz-card-name').textContent = data.name;
    c.querySelector('.cz-card-name').style.setProperty('--accent', data.color || '#9FB6D9');
    c.querySelector('.cz-card-type').textContent = data.type || (data.spec ? data.spec : '');
    c.querySelector('.cz-card-fact').textContent = data.fact || '';
    c.querySelector('.cz-card-stats').innerHTML = (data.stats || []).map(function (r) {
      return '<div class="cz-stat"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    }).join('');
    cardLive = null;
    if (data.auPerDay) {                      // a Voyager: live telemetry
      cardLive = function (jd) {
        var p = ORRERY.COSMOS.voyagerPos(data, jd);
        var lh = p.r * ORRERY.COSMOS.LIGHT_H_PER_AU;
        return '<div class="cz-stat"><span>Distance now</span><span>' +
          p.r.toFixed(1) + ' AU</span></div>' +
          '<div class="cz-stat"><span>One-way light time</span><span>' +
          lh.toFixed(1) + ' hours</span></div>';
      };
    } else if (data.ly) {                     // a star: light departure year
      cardLive = function (jd) {
        var year = ORRERY.Kepler.dateFromJD(jd).getUTCFullYear();
        return '<div class="cz-stat"><span>Light arriving now</span><span>left in ' +
          Math.round(year - data.ly) + '</span></div>';
      };
    } else if (data.mly) {
      var kya = data.mly * 1e6;
      cardLive = function () {
        return '<div class="cz-stat"><span>Light arriving now</span><span>left ' +
          (kya >= 1e6 ? (kya / 1e6).toFixed(2) + ' million' :
            Math.round(kya / 1000) + ',000') + ' years ago</span></div>';
      };
    }
    c.classList.add('show');
  }
  function closeCard() {
    dom.card.classList.remove('show');
    cardLive = null;
  }

  // --- Orrery fade -----------------------------------------------------------------------
  function captureOrrery() {
    if (fadeReg) { refreshRootBases(); return; }
    fadeReg = {
      mats: [], solids: ctx.orrery.solids,
      // Faded-to-zero lines still write depth and would punch black holes
      // into the additive galaxy — hide the roots outright once invisible.
      roots: [ctx.orrery.orbitLines].concat(ctx.orrery.belts)
        .map(function (o) { return { obj: o, base: o.visible }; })
    };
    function grab(root) {
      root.traverse(function (o) {
        if (o.material && o.material.opacity !== undefined) {
          fadeReg.mats.push({
            m: o.material, base: o.material.opacity, trans: o.material.transparent
          });
        }
      });
    }
    grab(ctx.orrery.orbitLines);
    ctx.orrery.belts.forEach(function (b) { grab(b); });
    var sf = ctx.orrery.starfield.userData;
    starTags = {
      band: sf.bandStars ? { m: sf.bandStars.material, base: sf.bandStars.material.opacity } : null,
      main: sf.mainStars ? { m: sf.mainStars.material, base: sf.mainStars.material.opacity } : null
    };
  }
  function refreshRootBases() {
    fadeReg.roots.forEach(function (r) { r.base = r.obj.visible; });
  }
  function applyOrreryFade(a) {
    fadeReg.mats.forEach(function (r) {
      r.m.opacity = r.base * a;
      r.m.transparent = a < 0.999 ? true : r.trans;
    });
    fadeReg.solids.forEach(function (s) { s.visible = a > 0.35; });
    fadeReg.roots.forEach(function (r) { r.obj.visible = r.base && a > 0.02; });
  }

  // --- Ruler --------------------------------------------------------------------------------
  function niceNum(x) {
    var p = Math.pow(10, Math.floor(Math.log10(x)));
    var m = x / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }
  function fmtInt(n) {
    return Math.round(n).toLocaleString('en-US');
  }
  function updateRuler() {
    var LY = ORRERY.COSMOS.LY_AU;
    var auPerPx = 2 * Math.pow(10, L) / window.innerHeight;
    var rawAU = Math.min(260, window.innerWidth * 0.24) * auPerPx;
    var len, txt;
    if (rawAU < 20000) {
      len = niceNum(rawAU);
      txt = fmtInt(len) + ' AU';
    } else if (rawAU < 5e8) {
      len = niceNum(rawAU / LY) ;
      txt = (len < 1 ? len : fmtInt(len)) + ' light-year' + (len === 1 ? '' : 's');
      len *= LY;
    } else {
      len = niceNum(rawAU / (1e6 * LY));
      txt = (len < 1 ? len : fmtInt(len)) + ' million light-years';
      len *= 1e6 * LY;
    }
    dom.rulerBar.style.width = (len / auPerPx).toFixed(0) + 'px';
    dom.rulerTxt.textContent = txt;
  }

  function updateCaption() {
    var best = null, bestA = 0;
    CAPTIONS.forEach(function (c) {
      var a = fade(L, c.win);
      if (a > bestA) { bestA = a; best = c; }
    });
    if (best && dom.title.textContent !== best.title) {
      dom.title.textContent = best.title;
      dom.sub.textContent = best.sub;
    }
    dom.caption.style.opacity = (bestA * 0.95).toFixed(2);
  }

  // --- Labels ----------------------------------------------------------------------------
  function updateLabels(jd, s) {
    var cam = ctx.camera, w = window.innerWidth, h = window.innerHeight;
    labels.forEach(function (it) {
      var a = fade(L, it.win);
      it.alpha = a;
      if (a < 0.02) { it.el.style.display = 'none'; return; }
      if (it.posFn) it.posFn(vTmp, jd); else vTmp.copy(it.posAU);
      vTmp.multiplyScalar(s).project(cam);
      if (vTmp.z > 1 || vTmp.x < -1.05 || vTmp.x > 1.05 || vTmp.y < -1.1 || vTmp.y > 1.1) {
        it.el.style.display = 'none';
        return;
      }
      it.sx = (vTmp.x * 0.5 + 0.5) * w;
      it.sy = (-vTmp.y * 0.5 + 0.5) * h;
      it.el.style.display = '';
      it.el.style.opacity = a.toFixed(2);
      it.el.style.transform = 'translate(' + it.sx.toFixed(1) + 'px,' +
        (it.sy - it.dy).toFixed(1) + 'px) translate(-50%, -100%)';
    });
  }

  // --- Picking (screen-space nearest) ------------------------------------------------------
  var downAt = { x: 0, y: 0 };
  function onPointerDown(e) { downAt.x = e.clientX; downAt.y = e.clientY; }
  function onPointerUp(e) {
    if (!active) return;
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
    var best = null, bestD = 30;
    labels.forEach(function (it) {
      if (!it.data || it.alpha < 0.15) return;
      var d = Math.hypot(e.clientX - it.sx, e.clientY - it.sy);
      if (d < bestD) { bestD = d; best = it; }
    });
    if (best) showCard(best.data);
    else closeCard();
  }

  // --- Enter / exit --------------------------------------------------------------------------
  function buildAll() {
    built = true;
    vTmp = new THREE.Vector3();
    vTmp2 = new THREE.Vector3();
    group = new THREE.Group();
    group.visible = false;
    fixed = new THREE.Group();
    fixed.visible = false;
    ctx.scene.add(group, fixed);
    buildDom();
    buildHeliosphere();
    buildOort();
    buildStars();
    buildGalaxy();
    buildLocalGroup();
  }

  function enter() {
    if (active || !ctx) return;
    if (ctx.guards && ctx.guards()) return;
    if (!built) buildAll();
    active = true;
    overs = 0;
    camDist = Math.min(Math.max(ctx.camera.position.length(), 400), ctx.controls.maxDistance);
    viewR = Math.tan(ctx.camera.fov * 0.5 * DEG) * camDist;
    L = targetL = L_MIN;
    ctx.controls.target.set(0, 0, 0);
    savedCtrl = { zoom: ctx.controls.enableZoom, pan: ctx.controls.enablePan };
    ctx.controls.enableZoom = false;
    ctx.controls.enablePan = false;
    captureOrrery();
    ORRERY.Labels.setVisible(false);
    ORRERY.Panel.close();
    if (ctx.onEnter) ctx.onEnter();
    group.visible = true;
    fixed.visible = true;
    dom.wrap.classList.add('on');
    dom.labelLayer.classList.add('on');
    document.body.classList.add('cosmos');
  }

  function exit() {
    if (!active) return;
    active = false;
    applyOrreryFade(1);
    if (starTags.band) starTags.band.m.opacity = starTags.band.base;
    if (starTags.main) starTags.main.m.opacity = starTags.main.base;
    ORRERY.Labels.setVisible(ctx.orrery.labelsOn());
    ctx.controls.enableZoom = savedCtrl.zoom;
    ctx.controls.enablePan = savedCtrl.pan;
    var dir = ctx.camera.position.clone();
    if (dir.lengthSq() < 1) dir.set(0, 0.45, 0.89);
    dir.normalize();
    ctx.camera.position.copy(dir.multiplyScalar(ctx.controls.maxDistance * 0.9));
    group.visible = false;
    fixed.visible = false;
    dom.wrap.classList.remove('on');
    dom.labelLayer.classList.remove('on');
    document.body.classList.remove('cosmos');
    labels.forEach(function (it) { it.el.style.display = 'none'; });
    closeCard();
    if (ctx.onExit) ctx.onExit();
  }

  // --- Wheel handoff ----------------------------------------------------------------------
  function onWheel(e) {
    if (!ctx) return;
    if (active) {
      e.preventDefault();
      targetL = Math.min(L_MAX, targetL + e.deltaY * WHEEL_RATE);
      if (targetL < L_MIN - 0.10) exit();
      return;
    }
    if (e.deltaY <= 0) return;
    if (ctx.guards && ctx.guards()) return;
    var dist = ctx.camera.position.distanceTo(ctx.controls.target);
    if (dist >= ctx.controls.maxDistance * 0.985) {
      overs += e.deltaY;
      if (overs > 40) { e.preventDefault(); enter(); }
    } else {
      overs = 0;
    }
  }

  function onKey(e) {
    if (!active) return;
    if (e.code === 'Escape') {
      if (dom.card.classList.contains('show')) closeCard();
      else exit();
    }
  }

  // --- Init / tick -----------------------------------------------------------------------------
  function init(options) {
    ctx = options;
    ctx.canvas.addEventListener('wheel', onWheel, { passive: false });
    ctx.canvas.addEventListener('pointerdown', onPointerDown);
    ctx.canvas.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKey);
  }

  function tick(dt, jd) {
    if (!active) return;
    if (ctx.guards && ctx.guards()) { exit(); return; }
    tAnim += dt;

    L += (targetL - L) * (reducedMotion ? 1 : Math.min(1, dt * 5));
    var s = viewR / Math.pow(10, L);
    group.scale.setScalar(s);

    applyOrreryFade(1 - smooth(L, WIN.orrery[0], WIN.orrery[1]));
    if (starTags.band) {
      starTags.band.m.opacity = starTags.band.base * (1 - smooth(L, WIN.band[0], WIN.band[1]));
    }
    if (starTags.main) {
      starTags.main.m.opacity = starTags.main.base * (1 - 0.5 * smooth(L, 10.0, 10.9));
    }

    stages.forEach(function (st) {
      var a = fade(L, st.win);
      st.group.visible = a > 0.004;
      if (!st.group.visible) return;
      st.mats.forEach(function (r) { r.m.opacity = r.base * a; });
      st.worldPts.forEach(function (p) { p.m.size = p.sizeAU * s; });
      // Voyager trails follow the clock
      if (st.key === 'voy') {
        st.group.children.forEach(function (c) {
          if (!c.userData.posFn) return;
          c.userData.posFn(vTmp, jd);
          var pa = c.geometry.getAttribute('position');
          pa.setXYZ(0, vTmp.x * 0.25, vTmp.y * 0.25, vTmp.z * 0.25);
          pa.setXYZ(1, vTmp.x, vTmp.y, vTmp.z);
          pa.needsUpdate = true;
        });
      }
    });

    var pxw = pxToWorld(1, camDist);
    fixedItems.forEach(function (it) {
      var a = fade(L, it.win) * it.base;
      it.sprite.visible = a > 0.004;
      if (!it.sprite.visible) return;
      it.sprite.material.opacity = a;
      if (it.posFn) it.posFn(vTmp, jd); else vTmp.copy(it.posAU);
      it.sprite.position.copy(vTmp.multiplyScalar(s));
      var px = typeof it.px === 'function' ? it.px(L) : it.px;
      if (it.sprite.userData.pulse) px *= 1 + 0.12 * Math.sin(tAnim * 2.4);
      it.sprite.scale.setScalar(px * pxw);
    });

    updateLabels(jd, s);
    updateCaption();
    updateRuler();
    dom.hint.style.opacity = L < 3.4 ? 0.8 : 0.35;

    if (cardLive) {
      dom.card.querySelector('.cz-card-live').innerHTML = cardLive(jd);
    }
  }

  return {
    init: init,
    tick: tick,
    enter: enter,
    exit: exit,
    setL: function (x) {
      targetL = Math.min(L_MAX, Math.max(L_MIN, x));
      L = targetL;                          // debug/headless: jump instantly
    },
    getL: function () { return L; },
    getTargetL: function () { return targetL; },
    get active() { return active; }
  };
})();
