/**
 * lagrange3d.js — The Three-Body Room: Lagrange-point markers + Trojan swarms.
 *
 * Ten selectable markers (Sun–Earth and Sun–Jupiter L1–L5, positions from
 * ORRERY.Lagrange) behind an options-row toggle, each with a dossier of the
 * point's physics and residents. The Jupiter Trojan swarms — the real,
 * visible population of L4/L5 — draw always, like the asteroid belt: two
 * tadpole point-clouds baked once around a unit circle, then rotated and
 * scaled each frame to ride Jupiter's actual L4/L5 directions. Only the
 * swarm's anchor is exact; the scatter is decoration, matching the belt.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Lagrange3D = (function () {
  'use strict';

  var SE_COLOR = '#9FD0F0', SJ_COLOR = '#D9B87A';

  var POINTS = [
    {
      key: 'earth-l1', sys: 'earth', pt: 'L1', name: 'Earth L1', color: SE_COLOR,
      fact: 'Sun and Earth pull to a balance here, 1.5 million km sunward of us. ' +
        'SOHO, ACE and DSCOVR hover at L1 staring at the Sun — the solar wind ' +
        'sweeps past them about an hour before it reaches Earth, and that hour ' +
        'is our storm warning.',
      stats: [
        ['Distance from Earth', '1.5 million km'],
        ['Stability', 'Unstable — saddle point'],
        ['Station-keeping', 'A nudge every few weeks'],
        ['Residents', 'SOHO · ACE · DSCOVR · Aditya-L1']
      ]
    },
    {
      key: 'earth-l2', sys: 'earth', pt: 'L2', name: 'Earth L2', color: SE_COLOR,
      fact: 'The quietest observatory site humanity has found: 1.5 million km ' +
        'down-Sun, where one shield can block Sun, Earth and Moon together. ' +
        'JWST and Euclid trace slow halo orbits around this empty point — ' +
        'unstable, so they spend a little fuel every month refusing to fall off.',
      stats: [
        ['Distance from Earth', '1.5 million km'],
        ['Stability', 'Unstable — saddle point'],
        ['Halo orbit period', '~6 months'],
        ['Residents', 'JWST · Euclid · Gaia (2014–25)']
      ]
    },
    {
      key: 'earth-l3', sys: 'earth', pt: 'L3', name: 'Earth L3', color: SE_COLOR,
      fact: 'Forever hidden on the far side of the Sun — a century of science ' +
        'fiction parked a secret “Counter-Earth” here. In reality it is weakly ' +
        'unstable, slightly closer to the Sun than we are, and nothing has ever ' +
        'been sent there: there is nothing to see that you cannot see from home.',
      stats: [
        ['Distance from Earth', '~2 AU — behind the Sun'],
        ['Stability', 'Unstable'],
        ['Residents', 'None — ever'],
        ['Claim to fame', 'Sci-fi’s Counter-Earth']
      ]
    },
    {
      key: 'earth-l4', sys: 'earth', pt: 'L4', name: 'Earth L4', color: SE_COLOR,
      fact: 'Sixty degrees ahead of Earth on its own orbit, and genuinely stable ' +
        '— debris that wanders in tends to stay. Earth’s first known Trojan ' +
        'asteroid, 2010 TK7, was found librating around this point in 2011.',
      stats: [
        ['Geometry', '60° ahead of Earth, 1 AU out'],
        ['Stability', 'Stable (m₁/m₂ ≫ 25)'],
        ['Residents', 'Asteroid 2010 TK7'],
        ['Motion', 'Residents librate — they orbit the point']
      ]
    },
    {
      key: 'earth-l5', sys: 'earth', pt: 'L5', name: 'Earth L5', color: SE_COLOR,
      fact: 'Sixty degrees behind Earth — the stable eddy in our wake. Asteroid ' +
        '2020 XL5 loiters here, and space-weather planners covet the spot: from ' +
        'L5 you see solar storms days before they rotate around to face Earth.',
      stats: [
        ['Geometry', '60° behind Earth, 1 AU out'],
        ['Stability', 'Stable'],
        ['Residents', 'Asteroid 2020 XL5'],
        ['Future', 'ESA’s Vigil space-weather sentinel']
      ]
    },
    {
      key: 'jupiter-l1', sys: 'jupiter', pt: 'L1', name: 'Jupiter L1', color: SJ_COLOR,
      fact: 'The balance point between the Sun and the heaviest planet, 0.35 AU ' +
        'sunward of Jupiter — over fifty times farther out than Earth’s L1, ' +
        'because Jupiter’s pull carves a far bigger sphere of influence.',
      stats: [
        ['Distance from Jupiter', '0.35 AU — 53 million km'],
        ['Stability', 'Unstable — saddle point'],
        ['Residents', 'None'],
        ['Role', 'Low-energy gateway into Jupiter’s realm']
      ]
    },
    {
      key: 'jupiter-l2', sys: 'jupiter', pt: 'L2', name: 'Jupiter L2', color: SJ_COLOR,
      fact: 'A third of an AU beyond Jupiter, in the giant’s permanent shadow-line. ' +
        'Unstable like every collinear point — but trajectories threading L1 and ' +
        'L2 form the “interplanetary superhighway” that lets probes tour the ' +
        'outer system on whispers of fuel.',
      stats: [
        ['Distance from Jupiter', '0.37 AU — 55 million km'],
        ['Stability', 'Unstable — saddle point'],
        ['Residents', 'None'],
        ['Role', 'Exit ramp of the low-energy highway']
      ]
    },
    {
      key: 'jupiter-l3', sys: 'jupiter', pt: 'L3', name: 'Jupiter L3', color: SJ_COLOR,
      fact: 'Jupiter’s anti-point: 5.3 AU from the Sun on the exact opposite side. ' +
        'Perturbed by every other planet and only weakly bound, nothing collects ' +
        'here — the loneliest address in the Jovian system.',
      stats: [
        ['Distance from Jupiter', '~10.5 AU — behind the Sun'],
        ['Stability', 'Unstable'],
        ['Residents', 'None'],
        ['View of Jupiter', 'Never — the Sun is always in the way']
      ]
    },
    {
      key: 'jupiter-l4', sys: 'jupiter', pt: 'L4', name: 'Jupiter L4', color: SJ_COLOR,
      fact: 'The Greek camp: thousands of Trojan asteroids swarm this stable point ' +
        '60° ahead of Jupiter — you can see the cloud from here. They are thought ' +
        'to be captured leftovers from the outer solar system’s formation, and ' +
        'NASA’s Lucy spacecraft is touring them right now.',
      stats: [
        ['Geometry', '60° ahead of Jupiter, 5.2 AU out'],
        ['Stability', 'Stable — holds a swarm'],
        ['Residents', '~7,000 known “Greek” Trojans'],
        ['Visitor', 'NASA Lucy (2027–2033 tour)']
      ]
    },
    {
      key: 'jupiter-l5', sys: 'jupiter', pt: 'L5', name: 'Jupiter L5', color: SJ_COLOR,
      fact: 'The Trojan camp proper, trailing Jupiter by 60°. Together the two ' +
        'swarms may hold as many large asteroids as the main belt — frozen ' +
        'time-capsules of the primordial nebula, dark and reddish, patiently ' +
        'orbiting a point of pure geometry.',
      stats: [
        ['Geometry', '60° behind Jupiter, 5.2 AU out'],
        ['Stability', 'Stable — holds a swarm'],
        ['Residents', '~5,000 known Trojans'],
        ['Composition', 'Dark, red, primordial']
      ]
    }
  ];

  var K, group, markers, entries = [];
  var swarmL4, swarmL5;
  var V = null;

  function seededRandom(seed) {
    var s = seed;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  /**
   * Tadpole cloud around angle 0 (+x), unit orbit radius. Angular scatter
   * tightens toward the point; radial/vertical scatter is relative so the
   * whole cloud can be scaled to Jupiter's compressed scene radius.
   */
  function trojanCloud(seed) {
    var rand = seededRandom(seed);
    var count = 750;
    var pos = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      var ang = (rand() + rand() + rand() - 1.5) / 1.5 * 0.42; // ±24°, peaked
      var r = 1 + (rand() + rand() - 1) * 0.035;
      var o = i * 3;
      pos[o] = Math.cos(ang) * r;
      pos[o + 1] = (rand() + rand() - 1) * 0.055;
      pos[o + 2] = -Math.sin(ang) * r;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({
      color: 0x9a8a72, size: 0.55, sizeAttenuation: true,
      transparent: true, opacity: 0.6, depthWrite: false
    });
    return new THREE.Points(geo, mat);
  }

  function build() {
    K = ORRERY.Kepler;
    V = new THREE.Vector3();
    group = new THREE.Group();
    markers = new THREE.Group();
    markers.visible = false;
    group.add(markers);

    POINTS.forEach(function (p) {
      var tex = ORRERY.Textures.glowSprite(
        p.sys === 'earth' ? 'rgba(214,238,255,0.95)' : 'rgba(255,236,200,0.95)',
        p.sys === 'earth' ? 'rgba(120,180,240,0.28)' : 'rgba(217,184,122,0.28)');
      var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false
      }));
      sprite.scale.setScalar(2.4);
      sprite.userData = {
        body: {
          key: p.key, name: p.name, color: p.color, fact: p.fact, stats: p.stats,
          type: 'Lagrange point — Sun–' + (p.sys === 'earth' ? 'Earth' : 'Jupiter') + ' system'
        },
        mesh: sprite,
        enhancedRadius: 1.2,
        moons: [],
        lagrange: p,
        labelClass: ' small',
        labelWhen: function () { return markers.visible; }
      };
      markers.add(sprite);
      entries.push(sprite);
    });

    swarmL4 = trojanCloud(424242);
    swarmL5 = trojanCloud(555111);
    group.add(swarmL4, swarmL5);
    return { group: group, entries: entries };
  }

  function place(obj, au) {
    K.toScene(au, V);
    obj.position.copy(V);
  }

  function update(jd) {
    var jp = ORRERY.Lagrange.points('jupiter', jd);

    // Swarms: rotate the baked clouds onto today's L4/L5 bearings
    K.toScene(jp.L4, V);
    var r = Math.sqrt(V.x * V.x + V.z * V.z);
    swarmL4.rotation.y = Math.atan2(-V.z, V.x);
    swarmL4.scale.setScalar(r);
    swarmL4.position.y = V.y;
    K.toScene(jp.L5, V);
    swarmL5.rotation.y = Math.atan2(-V.z, V.x);
    swarmL5.scale.setScalar(r);
    swarmL5.position.y = V.y;

    if (!markers.visible) return;
    var ep = ORRERY.Lagrange.points('earth', jd);
    entries.forEach(function (e) {
      var p = e.userData.lagrange;
      place(e, (p.sys === 'earth' ? ep : jp)[p.pt]);
    });
  }

  function setMarkersVisible(on) {
    markers.visible = on;
    if (on) update(ORRERY.TimeBar.jd);
  }

  return {
    build: build,
    update: update,
    setMarkersVisible: setMarkersVisible,
    get markersVisible() { return markers && markers.visible; }
  };
})();
