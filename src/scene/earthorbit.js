/**
 * earthorbit.js — Level 24: the Earth-centered scale regime.
 *
 * The heliocentric scene compresses distances (sceneR = 62·AU^0.52), so
 * everything from LEO to GEO is sub-pixel around the Earth mesh. This mode
 * is the zoom-IN mirror of the cosmic zoom (cosmos.js): entering hides the
 * orrery's solids (starfield stays), parks an Earth-centered world at the
 * origin, and hands the camera free rein between just-above-the-clouds and
 * past the Moon. No world-scaling trick is needed here — LEO→GEO→Moon spans
 * barely two orders of magnitude, so the camera simply moves, in a scale
 * where 1 scene unit = 1,000 km.
 *
 * Time: a LEO period is ~93 minutes, so the main timebar's day-scale rates
 * are useless. The mode saves the TimeBar's {rate, playing}, drives it with
 * its own minutes-scale rate buttons, and restores the saved state exactly
 * on exit. The sim clock itself keeps flowing through ORRERY.TimeBar.jd, so
 * the Sun direction (terminator), the Earth's spin phase and every satellite
 * stay consistent with the rest of the app — the Earth mesh here spins with
 * the SAME phase formula main.js uses.
 *
 * Content: the real Starlink Gen1 shell structure with a synthetic Walker
 * catalog (src/data/starlink.js — physics verified in test/earthorbit.test.js),
 * plus the ISS and a schematic GEO ring as scale anchors, and the Moon at
 * its true 384,400 km for the final "even GEO is a ninth of the way" beat.
 *
 * Lighting: the orrery's planet shader assumes the Sun at the world origin
 * (sunDir = -normalize(worldPos)) — with Earth AT the origin that's
 * degenerate, so this module carries its own Earth/cloud materials taking
 * an explicit sun-direction uniform computed from Earth's Kepler position
 * at the sim clock.
 *
 * Entry: the Explore-menu row (#opt-earth), or wheeling IN past max zoom
 * while focused on Earth (the mirror of the cosmos wheel-out). Exit (Esc,
 * the HUD button, or wheeling out past the mode's max distance) restores
 * the heliocentric camera pose exactly via an instant CameraPath flight.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.EarthOrbit = (function () {
  'use strict';

  var DEG = Math.PI / 180;
  var KM = 0.001;                 // scene units per km (1 unit = 1,000 km)
  var MIN_D = 7.2;                // just above the cloud deck (Rₑ = 6.378)
  var MAX_D = 620;                // past the Moon (384.4 units)
  var ENTER_VIEW = { x: 0, y: 40, z: 105 };   // Earth + LEO swarm + GEO ring

  var ctx = null, S = null, K = null;
  var active = false, built = false;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var root = null;                // world frame (ecliptic axes, Earth at origin)
  var frame = null;               // equatorial frame (tilted like bodies3d)
  var earthMesh = null, clouds = null, sunGlow = null, moonMesh = null;
  var shellsR = [];               // { shell, pts, attr }
  var issSprite = null, issShell = null;
  var geoPts = null, geoAttr = null, geoShell = null;
  var labels = [], dom = {}, cardLive = null;
  var saved = null;               // camera/controls/timebar snapshot
  var earthEl = null;
  var oversIn = 0, oversOut = 0, tAnim = 0;
  var sunDir = null, vTmp = null;

  // Own minutes-scale rates (days per real second)
  var RATES = [
    { label: 'real', rate: 1 / 86400 },
    { label: '1 min/s', rate: 1 / 1440 },
    { label: '15 min/s', rate: 15 / 1440 },
    { label: '1 hr/s', rate: 1 / 24 }
  ];
  var DEFAULT_RATE = 15 / 1440;

  // --- Materials (explicit sun direction — see header) -------------------------
  var VERT = [
    'varying vec2 vUv;',
    'varying vec3 vNormal;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  vUv = uv;',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vWorldPos = wp.xyz;',
    '  vNormal = normalize(mat3(modelMatrix) * normal);',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  var EARTH_FRAG = [
    'uniform sampler2D map;',
    'uniform sampler2D nightMap;',
    'uniform vec3 atmoColor;',
    'uniform vec3 sunDir;',
    'varying vec2 vUv;',
    'varying vec3 vNormal;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  vec3 n = normalize(vNormal);',
    '  float ndl = dot(n, normalize(sunDir));',
    '  float dayT = smoothstep(-0.12, 0.18, ndl);',
    '  float lit = max(ndl, 0.0);',
    '  vec3 tex = texture2D(map, vUv).rgb;',
    '  vec3 dayCol = tex * (0.16 + 1.02 * lit);',
    '  vec3 nightCol = tex * 0.05 + texture2D(nightMap, vUv).rgb * 1.2;',
    '  vec3 col = mix(nightCol, dayCol, dayT);',
    '  vec3 vd = normalize(cameraPosition - vWorldPos);',
    '  float fr = pow(1.0 - max(dot(vd, n), 0.0), 2.4);',
    '  col += atmoColor * fr * 0.9 * (0.22 + 0.78 * dayT);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var CLOUD_FRAG = [
    'uniform sampler2D map;',
    'uniform vec3 sunDir;',
    'varying vec2 vUv;',
    'varying vec3 vNormal;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  float a = texture2D(map, vUv).a;',
    '  vec3 n = normalize(vNormal);',
    '  float lit = max(dot(n, normalize(sunDir)), 0.0);',
    '  float dayT = smoothstep(-0.1, 0.2, dot(n, normalize(sunDir)));',
    '  vec3 col = vec3(1.0, 0.99, 0.97) * (0.06 + 1.0 * lit);',
    '  gl_FragColor = vec4(col, a * (0.25 + 0.75 * dayT) * 0.92);',
    '}'
  ].join('\n');

  // --- Small helpers --------------------------------------------------------------
  function el(tag, cls, parent, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    (parent || document.body).appendChild(e);
    return e;
  }

  /** Equatorial inertial km {x,y,z-north} → frame-local scene units (y-up). */
  function eqToLocal(p, out) {
    return out.set(p.x * KM, p.z * KM, -p.y * KM);
  }

  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }

  // --- Build ------------------------------------------------------------------------
  function buildEarth() {
    var mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: EARTH_FRAG,
      uniforms: {
        map: { value: ORRERY.Textures.build('earth') },
        nightMap: { value: ORRERY.Textures.earthNight() },
        atmoColor: { value: new THREE.Color('#7DB8FF') },
        sunDir: { value: sunDir }
      }
    });
    earthMesh = new THREE.Mesh(new THREE.SphereGeometry(6.371, 64, 44), mat);
    frame.add(earthMesh);

    clouds = new THREE.Mesh(
      new THREE.SphereGeometry(6.371 * 1.012, 64, 44),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: { map: { value: ORRERY.Textures.earthClouds() }, sunDir: { value: sunDir } },
        transparent: true,
        depthWrite: false
      })
    );
    frame.add(clouds);
  }

  function buildShells() {
    S.SHELLS.forEach(function (shell) {
      var n = S.shellCount(shell);
      var attr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', attr);
      var mat = new THREE.PointsMaterial({
        color: new THREE.Color(shell.color), size: 1.9, sizeAttenuation: false,
        transparent: true, opacity: 0.85, depthWrite: false
      });
      var pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      frame.add(pts);
      shellsR.push({ shell: shell, pts: pts, attr: attr });
    });
  }

  function buildAnchors() {
    // ISS — a glow sprite; its orbit is the real 420 km / 51.6°
    issShell = { altKm: S.ISS.altKm, incDeg: S.ISS.incDeg, planes: 1, perPlane: 1, f: 0 };
    issSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ORRERY.Textures.glowSprite('rgba(255,255,255,0.95)', 'rgba(160,200,255,0.30)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    issSprite.scale.setScalar(1.6);
    frame.add(issSprite);

    // GEO — the ring line plus 12 schematic marker satellites that rotate
    // with the Earth (their mean motion IS the sidereal spin — the point).
    geoShell = { altKm: S.GEO.altKm, incDeg: 0, planes: 1, perPlane: 12, f: 0 };
    var rGeo = S.radiusKm(S.GEO.altKm) * KM;
    var ringPts = [];
    for (var i = 0; i <= 128; i++) {
      var a = (i / 128) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * rGeo, 0, Math.sin(a) * rGeo));
    }
    var ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: 0xF2A63C, transparent: true, opacity: 0.35 })
    );
    frame.add(ring);
    geoAttr = new THREE.BufferAttribute(new Float32Array(12 * 3), 3);
    var geoGeo = new THREE.BufferGeometry();
    geoGeo.setAttribute('position', geoAttr);
    geoPts = new THREE.Points(geoGeo, new THREE.PointsMaterial({
      color: 0xF2A63C, size: 3.2, sizeAttenuation: false,
      transparent: true, opacity: 0.95, depthWrite: false
    }));
    geoPts.frustumCulled = false;
    frame.add(geoPts);

    // Moon — true distance and period, schematic phase (honestly labeled).
    moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.7374, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0xC4C0BA })
    );
    root.add(moonMesh);

    // The Sun — a distant glow in the true direction, for orientation.
    sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ORRERY.Textures.glowSprite('rgba(255,220,150,0.9)', 'rgba(242,140,40,0.25)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    sunGlow.scale.setScalar(320);
    root.add(sunGlow);
  }

  // --- Dossiers ------------------------------------------------------------------------
  function shellDossier(shell) {
    var alt = shell.altKm, inc = shell.incDeg;
    return {
      name: 'Starlink · ' + shell.name,
      color: shell.color,
      type: shell.planes + ' planes × ' + shell.perPlane + ' satellites',
      fact: 'Real shell structure from the FCC Gen1 license (4,408 satellites in five ' +
        'shells); the individual phases here are synthetic Walker-delta slots, not ' +
        'live tracking data.',
      stats: [
        ['Satellites', fmtInt(S.shellCount(shell))],
        ['Altitude', fmtInt(alt) + ' km'],
        ['Inclination', inc.toFixed(1) + '°'],
        ['Orbital period', S.periodMin(alt).toFixed(1) + ' min'],
        ['Speed', S.vCirc(alt).toFixed(2) + ' km/s'],
        ['Node drift (J2)', S.raanRateDegPerDay(alt, inc).toFixed(2) + '°/day']
      ]
    };
  }

  var ISS_DOSSIER = null, GEO_DOSSIER = null, MOON_DOSSIER = null;
  function buildDossiers() {
    ISS_DOSSIER = {
      name: 'International Space Station',
      color: '#FFFFFF',
      type: '420 km · 51.6° — low Earth orbit',
      fact: 'The crewed benchmark of LEO: one sunrise every ' +
        S.periodMin(S.ISS.altKm).toFixed(0) + ' minutes, sixteen a day. Its orbit ' +
        'position here is propagated, not tracked — the altitude, inclination, ' +
        'speed and period are the real ones.',
      stats: [
        ['Altitude', '420 km'],
        ['Inclination', '51.6°'],
        ['Orbital period', S.periodMin(S.ISS.altKm).toFixed(1) + ' min'],
        ['Speed', S.vCirc(S.ISS.altKm).toFixed(2) + ' km/s'],
        ['Node drift (J2)', S.raanRateDegPerDay(S.ISS.altKm, S.ISS.incDeg).toFixed(2) + '°/day']
      ],
      live: 'iss'
    };
    GEO_DOSSIER = {
      name: 'Geostationary ring',
      color: '#F2A63C',
      type: '35,786 km above the equator',
      fact: 'At exactly this altitude the orbital period equals one sidereal day ' +
        '(23 h 56 m 04 s), so a satellite hangs motionless over one spot on the ' +
        'spinning Earth. Watch: the amber markers turn WITH the surface while the ' +
        'LEO swarm races past. The 12 markers are schematic — the real belt holds ' +
        'hundreds of stations.',
      stats: [
        ['Altitude', '35,786 km'],
        ['Radius', fmtInt(S.radiusKm(S.GEO.altKm)) + ' km'],
        ['Orbital period', '1436.1 min = 23 h 56 m'],
        ['Speed', S.vCirc(S.GEO.altKm).toFixed(2) + ' km/s'],
        ['vs Starlink', Math.round(S.GEO.altKm / 550) + '× higher']
      ]
    };
    MOON_DOSSIER = {
      name: 'The Moon',
      color: '#C4C0BA',
      type: '384,400 km — for scale',
      fact: 'True mean distance and period; the phase along its orbit here is ' +
        'schematic. Even the geostationary ring is only a ninth of the way out.',
      stats: [
        ['Distance', '384,400 km'],
        ['Period', '27.32 days'],
        ['GEO is', '11% of the way']
      ]
    };
  }

  // --- DOM -----------------------------------------------------------------------------
  function buildDom() {
    dom.wrap = el('div', 'eo-ui', document.body);
    dom.wrap.id = 'eo-ui';

    dom.caption = el('div', 'eo-caption', dom.wrap);
    el('h2', null, dom.caption, 'Earth Orbit');
    el('p', null, dom.caption,
      '4,408 Starlink satellites in their five licensed shells — real structure, ' +
      'synthetic catalog · with the ISS, the GEO ring and the Moon for scale');

    // Clock + rate control (the mode's own time feel — minutes, not days)
    dom.clockWrap = el('div', 'eo-clock', dom.wrap);
    dom.clock = el('span', 'eo-clock-txt', dom.clockWrap);
    dom.clock.id = 'eo-clock';
    dom.rates = el('div', 'eo-rates', dom.clockWrap);
    RATES.forEach(function (r) {
      var b = el('button', 'eo-rate', dom.rates, r.label);
      b.dataset.eorate = String(r.rate);
      b.addEventListener('click', function () {
        ORRERY.TimeBar.rate = r.rate;
        ORRERY.TimeBar.playing = true;
        refreshRates();
      });
    });

    // Legend: shells + anchors → dossier cards
    dom.legend = el('div', 'eo-legend', dom.wrap);
    S.SHELLS.forEach(function (shell) {
      var b = el('button', 'eo-key', dom.legend,
        '<span class="eo-dot" style="background:' + shell.color + '"></span>' +
        '<strong>' + shell.name + '</strong><em>' + fmtInt(S.shellCount(shell)) + ' sats · ' +
        shell.altKm + ' km · ' + shell.incDeg.toFixed(1) + '°</em>');
      b.dataset.eo = shell.key;
      b.addEventListener('click', function () { showCard(shellDossier(shell)); });
    });
    [['iss', 'ISS', '#FFFFFF', '420 km · 51.6°', function () { return ISS_DOSSIER; }],
     ['geo', 'GEO ring', '#F2A63C', '35,786 km · sidereal', function () { return GEO_DOSSIER; }],
     ['moon', 'Moon', '#C4C0BA', '384,400 km', function () { return MOON_DOSSIER; }]
    ].forEach(function (row) {
      var b = el('button', 'eo-key', dom.legend,
        '<span class="eo-dot" style="background:' + row[2] + '"></span>' +
        '<strong>' + row[1] + '</strong><em>' + row[3] + '</em>');
      b.dataset.eo = row[0];
      b.addEventListener('click', function () { showCard(row[4]()); });
    });

    // Ruler (nice-number km scale at the orbit distance)
    var ruler = el('div', 'eo-ruler', dom.wrap);
    dom.rulerBar = el('div', 'eo-ruler-bar', ruler);
    dom.rulerTxt = el('span', 'eo-ruler-txt', ruler);

    dom.hint = el('div', 'eo-hint', dom.wrap,
      'drag to orbit · scroll from the cloud tops to the Moon · <kbd>esc</kbd> returns to the solar system');

    dom.exit = el('button', 'eo-exit', dom.wrap, '✕ Solar system');
    dom.exit.id = 'eo-exit';
    dom.exit.addEventListener('click', exit);

    dom.labelLayer = el('div', 'eo-labels', document.body);

    dom.card = el('aside', 'eo-card', document.body);
    dom.card.id = 'eo-card';
    dom.card.innerHTML =
      '<button class="eo-card-close" aria-label="Close">✕</button>' +
      '<h3 class="eo-card-name"></h3><p class="eo-card-type"></p>' +
      '<p class="eo-card-fact"></p><div class="eo-card-stats"></div>' +
      '<div class="eo-card-live"></div>';
    dom.card.querySelector('.eo-card-close').addEventListener('click', closeCard);
  }

  function refreshRates() {
    var cur = ORRERY.TimeBar.rate;
    Array.prototype.forEach.call(dom.rates.children, function (b) {
      b.classList.toggle('on', Math.abs(parseFloat(b.dataset.eorate) - cur) < 1e-12);
    });
  }

  function addLabel(text, posFn, data, color) {
    var e = el('button', 'eo-label', dom.labelLayer, text);
    e.style.setProperty('--dot', color);
    var it = { el: e, posFn: posFn, data: data };
    e.addEventListener('click', function () { showCard(typeof data === 'function' ? data() : data); });
    labels.push(it);
    return it;
  }

  function showCard(data) {
    var c = dom.card;
    c.querySelector('.eo-card-name').textContent = data.name;
    c.querySelector('.eo-card-name').style.setProperty('--accent', data.color || '#7DB8FF');
    c.querySelector('.eo-card-type').textContent = data.type || '';
    c.querySelector('.eo-card-fact').textContent = data.fact || '';
    c.querySelector('.eo-card-stats').innerHTML = (data.stats || []).map(function (r) {
      return '<div class="eo-stat"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    }).join('');
    cardLive = data.live === 'iss' ? function (jd) {
      var p = S.satPosKm(issShell, 0, 0, jd);
      var lat = Math.asin(p.z / S.radiusKm(issShell.altKm)) / DEG;
      var lon = S.fixedLongitudeDeg(p, jd);
      return '<div class="eo-stat"><span>Sub-satellite point</span><span>' +
        Math.abs(lat).toFixed(1) + '°' + (lat >= 0 ? 'N' : 'S') + ' · ' +
        Math.abs(lon).toFixed(1) + '°' + (lon >= 0 ? 'E' : 'W') + '</span></div>';
    } : null;
    c.classList.add('show');
  }
  function closeCard() {
    dom.card.classList.remove('show');
    cardLive = null;
  }

  // --- Label projection ------------------------------------------------------------------
  function updateLabels(jd) {
    var cam = ctx.camera, w = window.innerWidth, h = window.innerHeight;
    labels.forEach(function (it) {
      it.posFn(vTmp, jd);
      vTmp.project(cam);
      if (vTmp.z > 1 || vTmp.x < -1.02 || vTmp.x > 1.02 || vTmp.y < -1.05 || vTmp.y > 1.05) {
        it.el.style.display = 'none';
        return;
      }
      it.el.style.display = '';
      it.el.style.transform = 'translate(' + ((vTmp.x * 0.5 + 0.5) * w).toFixed(1) + 'px,' +
        ((-vTmp.y * 0.5 + 0.5) * h - 14).toFixed(1) + 'px) translate(-50%, -100%)';
    });
  }

  // --- Ruler -------------------------------------------------------------------------------
  function niceNum(x) {
    var p = Math.pow(10, Math.floor(Math.log10(x)));
    var m = x / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }
  function updateRuler() {
    var dist = ctx.camera.position.distanceTo(ctx.controls.target);
    var unitsPerPx = 2 * Math.tan(ctx.camera.fov * 0.5 * DEG) * dist / window.innerHeight;
    var kmPerPx = unitsPerPx / KM;
    var rawKm = Math.min(260, window.innerWidth * 0.24) * kmPerPx;
    var len = niceNum(rawKm);
    dom.rulerBar.style.width = (len / kmPerPx).toFixed(0) + 'px';
    dom.rulerTxt.textContent = fmtInt(len) + ' km';
  }

  function updateClock(jd) {
    var d = K.dateFromJD(jd);
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    dom.clock.textContent = d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' +
      d.getUTCFullYear() + ' · ' +
      String(d.getUTCHours()).padStart(2, '0') + ':' +
      String(d.getUTCMinutes()).padStart(2, '0') + ':' +
      String(d.getUTCSeconds()).padStart(2, '0') + ' UTC';
  }

  // --- Build all -----------------------------------------------------------------------------
  function buildAll() {
    built = true;
    S = ORRERY.STARLINK;
    K = ORRERY.Kepler;
    vTmp = new THREE.Vector3();
    sunDir = new THREE.Vector3(1, 0, 0);
    earthEl = ORRERY.DATA.PLANETS.filter(function (p) { return p.key === 'earth'; })[0].el;

    root = new THREE.Group();
    root.visible = false;
    frame = new THREE.Group();
    frame.rotation.z = -23.44 * DEG;      // same axial-tilt convention as bodies3d
    root.add(frame);
    ctx.scene.add(root);

    buildEarth();
    buildShells();
    buildAnchors();
    buildDossiers();
    buildDom();

    addLabel('ISS', function (out, jd) {
      eqToLocal(S.satPosKm(issShell, 0, 0, jd), out);
      return frame.localToWorld(out);
    }, function () { return ISS_DOSSIER; }, '#FFFFFF');
    addLabel('GEO — 35,786 km', function (out, jd) {
      eqToLocal(S.satPosKm(geoShell, 0, 0, jd), out);
      return frame.localToWorld(out);
    }, function () { return GEO_DOSSIER; }, '#F2A63C');
    addLabel('Moon', function (out) {
      return out.copy(moonMesh.position);
    }, function () { return MOON_DOSSIER; }, '#C4C0BA');

    root.updateMatrixWorld(true);
  }

  // --- Enter / exit ------------------------------------------------------------------------------
  function setOrreryVisible(on) {
    ctx.orrery.roots.forEach(function (o) { o.visible = on; });
  }

  function enter() {
    if (active || !ctx) return;
    if (ctx.guards && ctx.guards()) return;
    if (!built) buildAll();
    active = true;
    oversIn = 0;
    oversOut = 0;

    saved = {
      camPos: ctx.camera.position.clone(),
      target: ctx.controls.target.clone(),
      minD: ctx.controls.minDistance,
      maxD: ctx.controls.maxDistance,
      pan: ctx.controls.enablePan,
      rate: ORRERY.TimeBar.rate,
      playing: ORRERY.TimeBar.playing
    };

    ctx.controls.minDistance = MIN_D;
    ctx.controls.maxDistance = MAX_D;
    ctx.controls.enablePan = false;
    ctx.controls.target.set(0, 0, 0);

    ORRERY.TimeBar.rate = DEFAULT_RATE;
    ORRERY.TimeBar.playing = true;
    refreshRates();

    ORRERY.Labels.setVisible(false);
    ORRERY.Panel.close();
    ORRERY.CameraPath.cancel();
    if (ctx.onEnter) ctx.onEnter();

    setOrreryVisible(false);
    root.visible = true;
    ORRERY.CameraPath.begin({
      to: new THREE.Vector3(ENTER_VIEW.x, ENTER_VIEW.y, ENTER_VIEW.z),
      duration: 1.2
    });

    var opt = document.getElementById('opt-earth');
    if (opt) opt.setAttribute('aria-pressed', 'true');
    dom.wrap.classList.add('on');
    dom.labelLayer.classList.add('on');
    document.body.classList.add('earthorbit');
  }

  function exit() {
    if (!active) return;
    active = false;

    root.visible = false;
    setOrreryVisible(true);
    ORRERY.Labels.setVisible(ctx.orrery.labelsOn());

    // TimeBar back exactly as found (the mode's whole claim on it)
    ORRERY.TimeBar.rate = saved.rate;
    ORRERY.TimeBar.playing = saved.playing;

    ctx.controls.minDistance = saved.minD;
    ctx.controls.maxDistance = saved.maxD;
    ctx.controls.enablePan = saved.pan;
    ctx.controls.target.copy(saved.target);
    ORRERY.CameraPath.begin({ to: saved.camPos, instant: true });

    var opt = document.getElementById('opt-earth');
    if (opt) opt.setAttribute('aria-pressed', 'false');
    dom.wrap.classList.remove('on');
    dom.labelLayer.classList.remove('on');
    document.body.classList.remove('earthorbit');
    labels.forEach(function (it) { it.el.style.display = 'none'; });
    closeCard();
    if (ctx.onExit) ctx.onExit();
  }

  // --- Wheel handoff (mirror of the cosmos wheel-out) ----------------------------------------------
  function onWheel(e) {
    if (!ctx) return;
    if (active) {
      // wheeling out past the mode's max distance → back to the solar system
      if (e.deltaY > 0) {
        var d = ctx.camera.position.distanceTo(ctx.controls.target);
        if (d >= MAX_D * 0.985) {
          oversOut += e.deltaY;
          if (oversOut > 60) exit();
        } else {
          oversOut = 0;
        }
      }
      return;                              // OrbitControls owns normal zoom
    }
    if (e.deltaY >= 0) return;
    if (ctx.guards && ctx.guards()) return;
    var f = ctx.getFollow ? ctx.getFollow() : null;
    if (!f || f !== ctx.earthEntry) { oversIn = 0; return; }
    var dist = ctx.camera.position.distanceTo(ctx.controls.target);
    if (dist <= ctx.controls.minDistance * 1.05) {
      oversIn -= e.deltaY;
      if (oversIn > 40) { e.preventDefault(); enter(); }
    } else {
      oversIn = 0;
    }
  }

  function onKey(e) {
    if (!active) return;
    if (e.code === 'Escape') {
      if (dom.card.classList.contains('show')) closeCard();
      else exit();
    }
  }

  // --- Init / tick -----------------------------------------------------------------------------------
  function init(options) {
    ctx = options;
    ctx.canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    var opt = document.getElementById('opt-earth');
    if (opt) {
      opt.setAttribute('aria-pressed', 'false');
      opt.addEventListener('click', function () {
        if (active) exit(); else enter();
      });
    }
  }

  var eqTmp = { x: 0, y: 0, z: 0 };

  function tick(dt, jd) {
    if (!active) return;
    if (ctx.guards && ctx.guards()) { exit(); return; }
    tAnim += dt;

    // Sun direction from Earth at the sim clock (ecliptic → scene axes)
    var h = K.heliocentric(earthEl, jd);
    sunDir.set(-h.x, -h.z, h.y).normalize();
    sunGlow.position.copy(sunDir).multiplyScalar(3600);

    // Earth spin — the SAME phase formula main.js uses for the orrery mesh
    var spin = S.earthSpinFraction(jd) * Math.PI * 2;
    earthMesh.rotation.y = spin;
    clouds.rotation.y = spin * 0.96;

    // Constellation propagation (synthetic Walker catalog, real shell physics)
    shellsR.forEach(function (sr) {
      var sh = sr.shell, a = sr.attr, idx = 0;
      for (var p = 0; p < sh.planes; p++) {
        for (var s = 0; s < sh.perPlane; s++) {
          S.satPosKm(sh, p, s, jd, eqTmp);
          a.setXYZ(idx++, eqTmp.x * KM, eqTmp.z * KM, -eqTmp.y * KM);
        }
      }
      a.needsUpdate = true;
    });

    S.satPosKm(issShell, 0, 0, jd, eqTmp);
    issSprite.position.set(eqTmp.x * KM, eqTmp.z * KM, -eqTmp.y * KM);

    for (var g = 0; g < 12; g++) {
      S.satPosKm(geoShell, 0, g, jd, eqTmp);
      geoAttr.setXYZ(g, eqTmp.x * KM, eqTmp.z * KM, -eqTmp.y * KM);
    }
    geoAttr.needsUpdate = true;

    // Moon: true distance/period, schematic phase, ecliptic plane
    var ma = ((jd - S.EPOCH) / 27.322) * Math.PI * 2;
    moonMesh.position.set(Math.cos(ma) * 384.4, 0, -Math.sin(ma) * 384.4);

    updateLabels(jd);
    updateClock(jd);
    updateRuler();
    if (cardLive) {
      dom.card.querySelector('.eo-card-live').innerHTML = cardLive(jd);
    }
  }

  return {
    init: init,
    tick: tick,
    enter: enter,
    exit: exit,
    get active() { return active; },
    /** Headless-verification hook: world positions + spin for the e2e spec. */
    debug: function () {
      var a = new THREE.Vector3(), b = new THREE.Vector3();
      frame.updateMatrixWorld(true);
      eqToLocal(S.satPosKm(shellsR[0].shell, 0, 0, ORRERY.TimeBar.jd), a);
      frame.localToWorld(a);
      eqToLocal(S.satPosKm(geoShell, 0, 0, ORRERY.TimeBar.jd), b);
      frame.localToWorld(b);
      return {
        jd: ORRERY.TimeBar.jd,
        leoWorld: a.toArray(),
        geoWorld: b.toArray(),
        spinFraction: S.earthSpinFraction(ORRERY.TimeBar.jd),
        geoFixedLon: S.fixedLongitudeDeg(S.satPosKm(geoShell, 0, 0, ORRERY.TimeBar.jd), ORRERY.TimeBar.jd),
        leoFixedLon: S.fixedLongitudeDeg(S.satPosKm(shellsR[0].shell, 0, 0, ORRERY.TimeBar.jd), ORRERY.TimeBar.jd)
      };
    }
  };
})();
