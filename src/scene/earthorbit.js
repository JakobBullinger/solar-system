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
 *
 * Level 29 (Orbital Zoo) additions live here as CONTENT only — the family
 * physics/catalogs are in `data/zoo.js`. GPS/MEO and the sun-synchronous
 * shell reuse the exact same circular + J2 machinery as the Starlink
 * shells above (`S.satPosKm`); Molniya is genuinely different (elliptical,
 * propagated via `ORRERY.Kepler.heliocentric` at km scale) and gets its
 * own render path. GEO gained named real slots (replacing the old 12
 * schematic markers) plus a graveyard ring, and every zoo family dims
 * while inside Earth's shadow cylinder (`Z.inShadow`). Selecting a family
 * (legend or a 3D label) draws its ground track on the globe — baked once
 * as Earth-fixed {lat,lon} pairs, then re-projected every tick through the
 * current spin phase, so the track visually stays painted on the turning
 * surface exactly like the GEO-hangs-still money shot generalizes.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.EarthOrbit = (function () {
  'use strict';

  var DEG = Math.PI / 180;
  var KM = 0.001;                 // scene units per km (1 unit = 1,000 km)
  var MIN_D = 7.2;                // just above the cloud deck (Rₑ = 6.378)
  var MAX_D = 620;                // past the Moon (384.4 units)
  var ENTER_VIEW = { x: 0, y: 40, z: 105 };   // Earth + LEO swarm + GEO ring

  var ctx = null, S = null, K = null, Z = null;
  var active = false, built = false;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var root = null;                // world frame (ecliptic axes, Earth at origin)
  var frame = null;               // equatorial frame (tilted like bodies3d)
  var earthMesh = null, clouds = null, sunGlow = null, moonMesh = null;
  var shellsR = [];               // { shell, pts, attr }
  var issSprite = null, issShell = null;
  var geoRing = null;             // the amber outline (unchanged, still "the GEO ring")
  var labels = [], dom = {}, cardLive = null;
  var saved = null;               // camera/controls/timebar snapshot
  var earthEl = null;
  var oversIn = 0, oversOut = 0, tAnim = 0;
  var sunDir = null, vTmp = null;
  var sunDirEqKm = null;          // Earth→Sun unit vector, equatorial km frame (Z.inShadow input)

  // --- Level 29: Orbital Zoo state ------------------------------------------------
  var zooShellsR = [];            // { family, pts, attr, colorAttr, base } — GPS/sun-sync/graveyard
  var molPts = null, molAttr = null, molColorAttr = null, molBase = null;
  var molOrbitLines = [];
  var geoSlots = [];              // { slot, sprite }
  var graveyardRing = null;
  var trackLine = null, trackAttr = null, trackLatLon = null;
  var TRACK_STEPS = 220;
  var TRACK_R = 6.40;             // scene units: just above the 6.371 surface, below the 6.448 cloud deck

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
    // Ocean sun-glint, same real-coastline-as-ocean-mask trick as the
    // global shader path (shaders.js PLANET_FRAG) — this regime always
    // renders Earth, so no gating uniform is needed here.
    '  float ocean = step(tex.r * 1.3, tex.b) * step(tex.g * 1.05, tex.b);',
    '  vec3 halfV = normalize(normalize(sunDir) + vd);',
    // This regime's camera can sit only ~2-3 Earth radii out (LEO close-ups),
    // close enough that vd sweeps fast across the disc — a much tighter
    // exponent than a "far camera" glint needs, or the highlight balloons
    // into a sun-sized blob instead of a sparkle.
    '  float spec = pow(max(dot(n, halfV), 0.0), 600.0);',
    '  col += vec3(1.0, 0.98, 0.9) * spec * ocean * lit * 3.2;',
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

    // GEO — the amber ring outline. The 12 schematic marker satellites this
    // used to carry are now the real named slots (Level 29, buildGeoSlots).
    var rGeo = S.radiusKm(S.GEO.altKm) * KM;
    var ringPts = [];
    for (var i = 0; i <= 128; i++) {
      var a = (i / 128) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * rGeo, 0, Math.sin(a) * rGeo));
    }
    geoRing = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: 0xF2A63C, transparent: true, opacity: 0.35 })
    );
    frame.add(geoRing);

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

  // --- Level 29: Orbital Zoo scene content -----------------------------------------------
  // GPS/MEO, sun-sync and the graveyard are circular Walker families exactly
  // like the Starlink shells above — S.satPosKm is shape-generic, so they
  // reuse it directly. Molniya is elliptical and gets its own points below.
  // Every family here (plus the named GEO slots) dims per-vertex/per-sprite
  // while inside Earth's shadow cylinder (Z.inShadow), tick()'s job.
  function buildZooShell(family) {
    var n = S.shellCount(family);
    var attr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    var colorAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', attr);
    geo.setAttribute('color', colorAttr);
    var mat = new THREE.PointsMaterial({
      size: 2.4, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 0.9, depthWrite: false
    });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    frame.add(pts);
    var base = new THREE.Color(family.color);
    zooShellsR.push({ family: family, pts: pts, attr: attr, colorAttr: colorAttr, base: base });
  }

  function buildMolniya() {
    var n = Z.MOLNIYA.planes * Z.MOLNIYA.perPlane;
    molAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    molColorAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', molAttr);
    geo.setAttribute('color', molColorAttr);
    molPts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 3, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 0.95, depthWrite: false
    }));
    molPts.frustumCulled = false;
    frame.add(molPts);
    molBase = new THREE.Color(Z.MOLNIYA.color);

    // Decorative orbit ellipses (one per plane) — static at epoch; the J2
    // apsidal drift is ~0 by design and the node drift is too slow to
    // matter visually, so redrawing every frame would be wasted work.
    for (var p = 0; p < Z.MOLNIYA.planes; p++) {
      var node0 = (p / Z.MOLNIYA.planes) * 360;
      var shapePts = Z.orbitShapeKm(Z.MOLNIYA.a, Z.MOLNIYA.e, Z.MOLNIYA.incDeg, Z.MOLNIYA.argPeriDeg, node0, 96)
        .map(function (q) { return new THREE.Vector3(q.x * KM, q.z * KM, -q.y * KM); });
      var line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(shapePts),
        new THREE.LineBasicMaterial({ color: Z.MOLNIYA.color, transparent: true, opacity: 0.22 })
      );
      frame.add(line);
      molOrbitLines.push(line);
    }
  }

  function buildGeoSlots() {
    Z.GEO_SLOTS.forEach(function (slot) {
      var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ORRERY.Textures.glowSprite('rgba(242,166,60,0.95)', 'rgba(242,166,60,0.28)'),
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
      }));
      sprite.scale.setScalar(2.0);
      frame.add(sprite);
      geoSlots.push({ slot: slot, sprite: sprite });
      addLabel(slot.name, function (out, jd) {
        eqToLocal(Z.geoSlotPosKm(slot.lonDeg, jd), out);
        return frame.localToWorld(out);
      }, function () { return geoSlotDossier(slot); }, '#F2A63C');
    });

    // Graveyard ring outline (schematic, ~300 km above GEO — IADC guideline)
    var rGrave = S.radiusKm(Z.GRAVEYARD.altKm) * KM;
    var pts = [];
    for (var i = 0; i <= 96; i++) {
      var a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * rGrave, 0, Math.sin(a) * rGrave));
    }
    graveyardRing = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: Z.GRAVEYARD.color, transparent: true, opacity: 0.3 })
    );
    frame.add(graveyardRing);
  }

  function buildZooFamilies() {
    buildZooShell(Z.GPS);
    buildZooShell(Z.SUNSYNC);
    buildZooShell(Z.GRAVEYARD);
    buildMolniya();
    buildGeoSlots();
    buildTrackLine();
  }

  // --- Ground tracks (selectable orbit → path painted on the turning surface) -----------
  function buildTrackLine() {
    trackAttr = new THREE.BufferAttribute(new Float32Array((TRACK_STEPS + 1) * 3), 3);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', trackAttr);
    geo.setDrawRange(0, 0);
    trackLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xFFFFFF, transparent: true, opacity: 0.85, depthWrite: false
    }));
    trackLine.frustumCulled = false;
    frame.add(trackLine);
  }

  /** Select (or clear) the family whose ground track is currently painted. */
  function setTrack(track) {
    if (!track) {
      trackLatLon = null;
      trackLine.geometry.setDrawRange(0, 0);
      return;
    }
    trackLine.material.color.set(track.color || '#FFFFFF');
    trackLatLon = Z.groundTrack(track.posFn, ORRERY.TimeBar.jd, track.spanDays, TRACK_STEPS);
    trackLine.geometry.setDrawRange(0, TRACK_STEPS + 1);
  }

  /** Re-project the baked {lat,lon} track through the CURRENT spin phase — this
   *  is what keeps it painted on the turning surface (same trick as the
   *  GEO-hangs-still math, generalized: an Earth-fixed shape rotates with
   *  Earth for free as long as its inertial angle always adds the current
   *  spin phase, exactly like `S.fixedLongitudeDeg` inverted). */
  function updateTrack(jd) {
    if (!trackLatLon) return;
    var spin = S.earthSpinFraction(jd) * 360;
    for (var i = 0; i < trackLatLon.length; i++) {
      var pt = trackLatLon[i];
      var latR = pt.lat * DEG, loni = (pt.lon + spin) * DEG;
      var cl = Math.cos(latR);
      // equatorial km → local scene (matches eqToLocal's axis mapping)
      trackAttr.setXYZ(i,
        TRACK_R * cl * Math.cos(loni),
        TRACK_R * Math.sin(latR),
        -TRACK_R * cl * Math.sin(loni));
    }
    trackAttr.needsUpdate = true;
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
        'spinning Earth. Watch: the amber ring turns WITH the surface while the ' +
        'LEO swarm races past. Real operators sitting in this ring — weather ' +
        'birds, TV and comms satellites — are named individually below.',
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

  // --- Level 29: Orbital Zoo dossiers ---------------------------------------------------
  var GPS_DOSSIER = null, SUNSYNC_DOSSIER = null, MOLNIYA_DOSSIER = null, GRAVEYARD_DOSSIER = null,
    GEOSLOTS_DOSSIER = null;

  function gpsTrackFn() {
    var shell = Z.GPS;
    return function (t) { return S.satPosKm(shell, 0, 0, t); };
  }
  function sunsyncTrackFn() {
    var shell = Z.SUNSYNC;
    return function (t) { return S.satPosKm(shell, 0, 0, t); };
  }
  function molniyaTrackFn() {
    return function (t) { return Z.molniyaPosKm(0, 0, t); };
  }
  function issTrackFn() {
    return function (t) { return S.satPosKm(issShell, 0, 0, t); };
  }

  function buildZooDossiers() {
    GPS_DOSSIER = {
      name: 'GPS · MEO',
      color: Z.GPS.color,
      type: Z.GPS.planes + ' planes × ' + Z.GPS.perPlane + ' — ' + fmtInt(Z.GPS.altKm) +
        ' km · ' + Z.GPS.incDeg.toFixed(0) + '°',
      fact: 'Semi-synchronous by design: 2 orbits take almost exactly one sidereal ' +
        'day, so every satellite’s ground track very nearly repeats daily — a ' +
        'predictable, plannable footprint is the whole point of a navigation ' +
        'constellation (real GPS needs occasional station-keeping to hold the ' +
        'repeat; this synthetic catalog does not drift).',
      stats: [
        ['Altitude', fmtInt(Z.GPS.altKm) + ' km'],
        ['Inclination', Z.GPS.incDeg.toFixed(1) + '°'],
        ['Orbital period', S.periodMin(Z.GPS.altKm).toFixed(2) + ' min'],
        ['Speed', S.vCirc(Z.GPS.altKm).toFixed(2) + ' km/s'],
        ['2 orbits vs 1 sidereal day', (2 * S.periodMin(Z.GPS.altKm)).toFixed(1) +
          ' vs ' + (S.SIDEREAL_H * 60).toFixed(1) + ' min']
      ],
      track: { posFn: gpsTrackFn(), spanDays: 2 * S.periodMin(Z.GPS.altKm) / 1440, color: Z.GPS.color }
    };
    SUNSYNC_DOSSIER = {
      name: 'Sun-synchronous',
      color: Z.SUNSYNC.color,
      type: '700 km · ' + Z.SUNSYNC.incDeg.toFixed(2) + '° — Earth-observation altitude',
      fact: 'Retrograde and steep enough that its J2 node precession exactly ' +
        'cancels the ~1°/day the Earth sweeps around the Sun — this family ' +
        'crosses the equator at the same local solar time on every single orbit, ' +
        'forever, which is why every optical imaging satellite (Landsat, ' +
        'Sentinel-2, …) flies one.',
      stats: [
        ['Altitude', Z.SUNSYNC.altKm + ' km'],
        ['Inclination', Z.SUNSYNC.incDeg.toFixed(2) + '°'],
        ['Orbital period', S.periodMin(Z.SUNSYNC.altKm).toFixed(1) + ' min'],
        ['Node drift (J2)', S.raanRateDegPerDay(Z.SUNSYNC.altKm, Z.SUNSYNC.incDeg).toFixed(4) + '°/day'],
        ['Earth around the Sun', '0.9856°/day']
      ],
      track: { posFn: sunsyncTrackFn(), spanDays: S.periodMin(Z.SUNSYNC.altKm) / 1440 * 3, color: Z.SUNSYNC.color }
    };
    MOLNIYA_DOSSIER = {
      name: 'Molniya',
      color: Z.MOLNIYA.color,
      type: 'e ' + Z.MOLNIYA.e.toFixed(2) + ' · ' + Z.MOLNIYA.incDeg.toFixed(1) +
        '° · 12 h — the apogee-dwell orbit',
      fact: '63.4° is the CRITICAL INCLINATION: at 5cos²i = 1 the J2 drift of the ' +
        'argument of perigee is exactly zero (verified against the same J2 code ' +
        'as the Starlink shells), so apogee keeps dwelling over the far north ' +
        'orbit after orbit instead of drifting away. A geostationary bird can’t ' +
        'reach these latitudes at all — this is how the USSR covered them before ' +
        'GEO relay was practical from Siberian latitudes.',
      stats: [
        ['Perigee altitude', fmtInt(Z.MOLNIYA.a * (1 - Z.MOLNIYA.e) - S.RE) + ' km'],
        ['Apogee altitude', fmtInt(Z.MOLNIYA.a * (1 + Z.MOLNIYA.e) - S.RE) + ' km'],
        ['Period', (Z.MOLNIYA.periodMin / 60).toFixed(0) + ' h'],
        ['Apsidal (ω) drift', Z.argPeriRateDegPerDay(Z.MOLNIYA.a, Z.MOLNIYA.e, Z.MOLNIYA.incDeg).toFixed(5) + '°/day'],
        ['Node (Ω) drift', Z.raanRateEccDegPerDay(Z.MOLNIYA.a, Z.MOLNIYA.e, Z.MOLNIYA.incDeg).toFixed(3) + '°/day (not pinned)']
      ],
      track: { posFn: molniyaTrackFn(), spanDays: Z.MOLNIYA.periodMin / 1440, color: Z.MOLNIYA.color }
    };
    GRAVEYARD_DOSSIER = {
      name: 'GEO graveyard',
      color: Z.GRAVEYARD.color,
      type: (Z.GRAVEYARD.altKm - S.GEO.altKm) + ' km above the operational ring',
      fact: 'The IADC end-of-life guideline: raise a retiring GEO satellite at ' +
        'least ~300 km above the operational belt before its last drop of fuel ' +
        'runs out, keeping the working ring clear. These markers are schematic — ' +
        'real graveyarded hardware is not individually catalogued here.',
      stats: [
        ['Altitude', fmtInt(Z.GRAVEYARD.altKm) + ' km'],
        ['Margin above GEO', (Z.GRAVEYARD.altKm - S.GEO.altKm) + ' km'],
        ['Orbital period', S.periodMin(Z.GRAVEYARD.altKm).toFixed(1) + ' min (vs GEO 1436.1)']
      ]
    };
    GEOSLOTS_DOSSIER = {
      name: 'Named GEO slots',
      color: '#F2A63C',
      type: Z.GEO_SLOTS.length + ' real operators, filed longitudes',
      fact: 'Public longitude filings (approximate — GEO slots are periodically ' +
        'renegotiated). Around the equinoxes, Earth’s shadow sweeps across the ' +
        'ring near each satellite’s local midnight: GOES-19 (75.2°W) dims for ' +
        'about 69 minutes overnight on 20–21 Mar 2026 — try that date. Away from ' +
        'the equinox windows the Sun sits too far above or below the equatorial ' +
        'plane for the shadow to reach this far out.',
      stats: Z.GEO_SLOTS.map(function (s) {
        return [s.name, (s.lonDeg >= 0 ? s.lonDeg.toFixed(1) + '°E' : (-s.lonDeg).toFixed(1) + '°W') + ' · ' + s.op];
      })
    };
    ISS_DOSSIER.track = { posFn: issTrackFn(), spanDays: S.periodMin(S.ISS.altKm) / 1440 * 3.2, color: '#FFFFFF' };
  }

  function geoSlotDossier(slot) {
    return {
      name: slot.name,
      color: '#F2A63C',
      type: (slot.lonDeg >= 0 ? slot.lonDeg.toFixed(1) + '°E' : (-slot.lonDeg).toFixed(1) + '°W') +
        ' · ' + slot.kind + ' · ' + slot.op,
      fact: 'Geostationary: filed at a fixed longitude rather than a Walker slot ' +
        '— its earth-fixed position does not move at all, only its position in ' +
        'inertial space (it "hangs" only relative to the spinning surface).',
      stats: [
        ['Longitude', slot.lonDeg.toFixed(1) + '°'],
        ['Operator', slot.op],
        ['Kind', slot.kind],
        ['Altitude', fmtInt(S.GEO.altKm) + ' km']
      ],
      liveFn: function (jd) {
        var sun = Z.sunDirEquatorial(earthEl, jd);
        var dark = Z.inShadow(Z.geoSlotPosKm(slot.lonDeg, jd), sun);
        return '<div class="eo-stat"><span>Status</span><span>' +
          (dark ? 'in Earth’s shadow' : 'sunlit') + '</span></div>';
      }
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
      'synthetic catalog · with the ISS, the GEO ring and the Moon for scale, plus ' +
      'the GPS/Molniya/sun-sync/GEO-slot orbital zoo below');

    // Clock + rate control (the mode's own time feel — minutes, not days).
    // The bottom-center chrome is ONE flex column (hint → clock → rate pills
    // → the ascent ride's launch button, mounted here by buildAll): every
    // absolutely-anchored sibling in this band eventually collided with
    // another lane's element (launch button on the pills, then the pills on
    // the hint), so the column owns the stacking and no offsets are tuned.
    dom.clockWrap = el('div', 'eo-clock', dom.wrap);
    dom.hint = el('div', 'eo-hint', dom.clockWrap,
      window.matchMedia && window.matchMedia('(pointer: coarse)').matches
        ? 'drag to orbit · pinch from the cloud tops to the Moon · ✕ returns to the solar system'
        : 'drag to orbit · scroll from the cloud tops to the Moon · <kbd>esc</kbd> returns to the solar system');
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

    // The Orbital Zoo (level 29): the reason each family's orbit is shaped
    // the way it is, plus the named GEO slots + graveyard as one grouped row.
    el('div', 'eo-legend-h', dom.legend, 'The orbital zoo');
    [['gps', 'GPS · MEO', Z.GPS.color, '20,182 km · 55° · semi-sync', function () { return GPS_DOSSIER; }],
     ['molniya', 'Molniya', Z.MOLNIYA.color, 'e 0.74 · 63.4° · 12 h', function () { return MOLNIYA_DOSSIER; }],
     ['sunsync', 'Sun-synchronous', Z.SUNSYNC.color, '700 km · 98.2°', function () { return SUNSYNC_DOSSIER; }],
     ['geoslots', 'Named GEO slots', '#F2A63C', Z.GEO_SLOTS.length + ' operators', function () { return GEOSLOTS_DOSSIER; }],
     ['graveyard', 'GEO graveyard', Z.GRAVEYARD.color, '+300 km · disposal', function () { return GRAVEYARD_DOSSIER; }]
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

    dom.exit = el('button', 'eo-exit', dom.wrap, '✕ Solar system');
    dom.exit.id = 'eo-exit';
    dom.exit.addEventListener('click', exit);

    if (!dom.labelLayer) dom.labelLayer = el('div', 'eo-labels', document.body); // addLabel may have made it

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
    // Lazy-create the layer: addLabel must never fall back to document.body
    // (el() does when its parent is undefined). Unclipped body-level labels
    // escape the layer's overflow:hidden, and their per-frame transforms
    // make mobile Chrome ratchet the LAYOUT viewport up to 4× the device
    // width — sliding the fixed ✕-exit off the visual viewport and breaking
    // the phone exit tap (level-29 lesson: buildGeoSlots ran before
    // buildDom, so its 7 GEO-slot labels landed on body).
    if (!dom.labelLayer) dom.labelLayer = el('div', 'eo-labels', document.body);
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
    } : (data.liveFn || null);
    setTrack(data.track);
    c.classList.add('show');
  }
  function closeCard() {
    dom.card.classList.remove('show');
    cardLive = null;
    setTrack(null);
  }

  // --- Label projection ------------------------------------------------------------------
  // Project, then declutter: GEO slots at nearby longitudes project onto the
  // same pixels at shallow bearings — and the "GEO ring" anchor shares
  // Meteosat-11's 0° slot exactly — so overlapping glyphs interleave into
  // garbage. Greedy pass in insertion order (earlier label = higher
  // priority): when a label's box would intersect an already-placed one it
  // drops just below the blocker, keeping every label legible and clickable.
  // Box sizes are measured once and cached (text and font never change), so
  // the per-frame pass is pure arithmetic over ~10 visible labels — no
  // layout reads in the steady state.
  function updateLabels(jd) {
    var cam = ctx.camera, w = window.innerWidth, h = window.innerHeight;
    var placed = [];
    labels.forEach(function (it) {
      it.posFn(vTmp, jd);
      vTmp.project(cam);
      if (vTmp.z > 1 || vTmp.x < -1.02 || vTmp.x > 1.02 || vTmp.y < -1.05 || vTmp.y > 1.05) {
        it.el.style.display = 'none';
        return;
      }
      it.el.style.display = '';
      var sx = (vTmp.x * 0.5 + 0.5) * w;
      var sy = (-vTmp.y * 0.5 + 0.5) * h - 14;   // box bottom (anchor is translate -100%)
      if (!it.bw) { it.bw = it.el.offsetWidth; it.bh = it.el.offsetHeight; }
      if (it.bw) {
        var x0 = sx - it.bw / 2, hit = true, guard = 0;
        while (hit && guard++ < 16) {
          hit = false;
          for (var i = 0; i < placed.length; i++) {
            var p = placed[i];
            if (x0 < p.r && x0 + it.bw > p.l && sy - it.bh < p.b && sy > p.t) {
              sy = p.b + it.bh + 2;               // top lands 2px below the blocker
              hit = true;
            }
          }
        }
        placed.push({ l: x0, t: sy - it.bh, r: x0 + it.bw, b: sy });
      }
      it.el.style.transform = 'translate(' + sx.toFixed(1) + 'px,' +
        sy.toFixed(1) + 'px) translate(-50%, -100%)';
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
    Z = ORRERY.ZOO;
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
    buildZooFamilies();
    buildDossiers();
    buildZooDossiers();
    buildDom();

    addLabel('ISS', function (out, jd) {
      eqToLocal(S.satPosKm(issShell, 0, 0, jd), out);
      return frame.localToWorld(out);
    }, function () { return ISS_DOSSIER; }, '#FFFFFF');
    addLabel('GEO ring', function (out, jd) {
      eqToLocal(Z.geoSlotPosKm(0, jd), out);
      return frame.localToWorld(out);
    }, function () { return GEO_DOSSIER; }, '#F2A63C');
    addLabel('Moon', function (out) {
      return out.copy(moonMesh.position);
    }, function () { return MOON_DOSSIER; }, '#C4C0BA');

    root.updateMatrixWorld(true);

    // Ascent ride-along (new module, additive hook only — see ascent.js header).
    // The entry button mounts INTO the clock column (clock → rate pills →
    // button) so it shares the bottom-center flex flow instead of being
    // absolutely anchored at the same left:50%/bottom:26px as the pills —
    // the two lanes' CSS appends collided there (user-reported overlap).
    if (ORRERY.Ascent) ORRERY.Ascent.mount({ ctx: ctx, frame: frame, container: dom.clockWrap });
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
    if (ORRERY.Ascent && ORRERY.Ascent.active) ORRERY.Ascent.stop();
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
  // Shared by the wheel and the pinch (below): deltaY < 0 means "zoom in".
  // Both demand an active follow on Earth — on narrow phones the full-screen
  // info panel makes that state unpinchable (the Explore-menu row is the
  // touch entry there); on tablet-sized touch screens the pinch mirrors the
  // wheel exactly.
  function zoomIntent(e, deltaY) {
    if (!ctx) return;
    if (active) {
      // zooming out past the mode's max distance → back to the solar system
      if (deltaY > 0) {
        var d = ctx.camera.position.distanceTo(ctx.controls.target);
        if (d >= MAX_D * 0.985) {
          oversOut += deltaY;
          if (oversOut > 60) exit();
        } else {
          oversOut = 0;
        }
      }
      return;                              // OrbitControls owns normal zoom
    }
    if (deltaY >= 0) return;
    if (ctx.guards && ctx.guards()) return;
    var f = ctx.getFollow ? ctx.getFollow() : null;
    if (!f || f !== ctx.earthEntry) { oversIn = 0; return; }
    var dist = ctx.camera.position.distanceTo(ctx.controls.target);
    if (dist <= ctx.controls.minDistance * 1.05) {
      oversIn -= deltaY;
      if (oversIn > 40) { if (e.cancelable) e.preventDefault(); enter(); }
    } else {
      oversIn = 0;
    }
  }

  function onWheel(e) { zoomIntent(e, e.deltaY); }

  // --- Touch handoff (the pinch mirror of the wheel; mobile audit fix) --------------------------
  // Pinch gap deltas feed the SAME entry/exit thresholds the wheel uses
  // (fingers opening = wheel-in, deltaY < 0). OrbitControls keeps owning the
  // actual dolly in both regimes; this only watches for the past-the-stop
  // intent, exactly like the wheel accumulators.
  var PINCH_TO_WHEEL = 3;
  var pinchGap = 0;
  function gapOf(e) {
    return Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                      e.touches[0].clientY - e.touches[1].clientY);
  }
  function onTouchStart(e) {
    if (e.touches.length === 2) pinchGap = gapOf(e);
  }
  function onTouchMove(e) {
    if (e.touches.length !== 2) return;
    var g = gapOf(e);
    var deltaY = (pinchGap - g) * PINCH_TO_WHEEL;
    pinchGap = g;
    zoomIntent(e, deltaY);
  }
  function onTouchEnd(e) {
    if (e.touches.length === 2) pinchGap = gapOf(e);   // 3 → 2 fingers: re-seed
  }

  function onKey(e) {
    if (!active) return;
    if (e.code === 'Escape') {
      if (ORRERY.Ascent && ORRERY.Ascent.active) ORRERY.Ascent.stop();
      else if (dom.card.classList.contains('show')) closeCard();
      else exit();
    }
  }

  // --- Init / tick -----------------------------------------------------------------------------------
  function init(options) {
    ctx = options;
    ctx.canvas.addEventListener('wheel', onWheel, { passive: false });
    ctx.canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    ctx.canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    ctx.canvas.addEventListener('touchend', onTouchEnd, { passive: true });
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
    if (ORRERY.Ascent) ORRERY.Ascent.tick(dt, jd);
    tAnim += dt;

    // Sun direction from Earth at the sim clock (ecliptic → scene axes)
    var h = K.heliocentric(earthEl, jd);
    sunDir.set(-h.x, -h.z, h.y).normalize();
    sunGlow.position.copy(sunDir).multiplyScalar(3600);
    sunDirEqKm = Z.sunDirEquatorial(earthEl, jd);   // same Sun, equatorial-km frame (Z.inShadow)

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

    // Moon: true distance/period, schematic phase, ecliptic plane
    var ma = ((jd - S.EPOCH) / 27.322) * Math.PI * 2;
    moonMesh.position.set(Math.cos(ma) * 384.4, 0, -Math.sin(ma) * 384.4);

    // --- Level 29: Orbital Zoo propagation + shadow dimming ---------------------------
    var DIM = 0.28; // brightness multiplier while inside Earth's shadow cylinder

    zooShellsR.forEach(function (zr) {
      var fam = zr.family, a = zr.attr, ca = zr.colorAttr, base = zr.base, idx = 0;
      for (var p = 0; p < fam.planes; p++) {
        for (var s = 0; s < fam.perPlane; s++) {
          S.satPosKm(fam, p, s, jd, eqTmp);
          a.setXYZ(idx, eqTmp.x * KM, eqTmp.z * KM, -eqTmp.y * KM);
          var f = Z.inShadow(eqTmp, sunDirEqKm) ? DIM : 1;
          ca.setXYZ(idx, base.r * f, base.g * f, base.b * f);
          idx++;
        }
      }
      a.needsUpdate = true;
      ca.needsUpdate = true;
    });

    var mIdx = 0;
    for (var mp = 0; mp < Z.MOLNIYA.planes; mp++) {
      for (var ms = 0; ms < Z.MOLNIYA.perPlane; ms++) {
        var mPos = Z.molniyaPosKm(mp, ms, jd);
        molAttr.setXYZ(mIdx, mPos.x * KM, mPos.z * KM, -mPos.y * KM);
        var mf = Z.inShadow(mPos, sunDirEqKm) ? DIM : 1;
        molColorAttr.setXYZ(mIdx, molBase.r * mf, molBase.g * mf, molBase.b * mf);
        mIdx++;
      }
    }
    molAttr.needsUpdate = true;
    molColorAttr.needsUpdate = true;

    geoSlots.forEach(function (gs) {
      var pos = Z.geoSlotPosKm(gs.slot.lonDeg, jd);
      gs.sprite.position.set(pos.x * KM, pos.z * KM, -pos.y * KM);
      var dark = Z.inShadow(pos, sunDirEqKm);
      gs.sprite.material.color.setScalar(dark ? DIM : 1);
    });

    updateTrack(jd);
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
      var jd = ORRERY.TimeBar.jd;
      var a = new THREE.Vector3(), b = new THREE.Vector3(), gp = new THREE.Vector3(), mp = new THREE.Vector3();
      frame.updateMatrixWorld(true);
      eqToLocal(S.satPosKm(shellsR[0].shell, 0, 0, jd), a);
      frame.localToWorld(a);
      var geoLon0 = Z.GEO_SLOTS[0].lonDeg;
      var geoPos = Z.geoSlotPosKm(geoLon0, jd);
      eqToLocal(geoPos, b);
      frame.localToWorld(b);
      eqToLocal(S.satPosKm(Z.GPS, 0, 0, jd), gp);
      frame.localToWorld(gp);
      var molPos = Z.molniyaPosKm(0, 0, jd);
      eqToLocal(molPos, mp);
      frame.localToWorld(mp);
      return {
        jd: jd,
        leoWorld: a.toArray(),
        geoWorld: b.toArray(),
        spinFraction: S.earthSpinFraction(jd),
        geoFixedLon: S.fixedLongitudeDeg(geoPos, jd),
        leoFixedLon: S.fixedLongitudeDeg(S.satPosKm(shellsR[0].shell, 0, 0, jd), jd),
        // Level 29: Orbital Zoo
        gpsWorld: gp.toArray(),
        molniyaWorld: mp.toArray(),
        molniyaR: molPos.r,
        geoNamedFixedLon: S.fixedLongitudeDeg(geoPos, jd),
        geoNamedShadow: Z.inShadow(geoPos, Z.sunDirEquatorial(earthEl, jd))
      };
    }
  };
})();
