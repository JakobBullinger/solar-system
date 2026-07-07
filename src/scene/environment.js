/**
 * environment.js — Starfield, Milky Way band, asteroid belt, Kuiper belt.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Environment = (function () {
  'use strict';

  function seededRandom(seed) {
    var s = seed;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function starfield() {
    var group = new THREE.Group();
    var rand = seededRandom(1234567);
    var R = 4200;

    function makeStars(count, sizeMin, sizeMax, bandBias) {
      var pos = new Float32Array(count * 3);
      var col = new Float32Array(count * 3);
      var i = 0;
      while (i < count) {
        var u = rand() * 2 - 1, phi = rand() * Math.PI * 2;
        if (bandBias) {
          // Concentrate toward a tilted great circle — the Milky Way
          u = (rand() * 2 - 1) * Math.pow(rand(), 1.8) * 0.55;
        }
        var st = Math.sqrt(1 - u * u);
        var x = st * Math.cos(phi), y = u, z = st * Math.sin(phi);
        if (bandBias) {
          // Orient the band to the REAL galactic plane: the north galactic
          // pole sits at scene (-0.868, 0.497, 0) — the same ~60° tilt as
          // before, but now the cosmos zoom (cosmos.js) can resolve this
          // band into a galaxy whose plane actually matches it.
          var tx = x * 0.4970 - y * 0.8677;
          var ty = x * 0.8677 + y * 0.4970;
          x = tx; y = ty;
        }
        var o = i * 3;
        pos[o] = x * R; pos[o + 1] = y * R; pos[o + 2] = z * R;
        var temp = rand();
        var r = 0.75 + temp * 0.25;
        var b = 1.0 - temp * 0.3;
        var m = 0.55 + rand() * 0.45;
        col[o] = r * m; col[o + 1] = (0.82 + temp * 0.1) * m; col[o + 2] = b * m;
        i++;
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      var mat = new THREE.PointsMaterial({
        size: sizeMin + rand() * (sizeMax - sizeMin),
        vertexColors: true,
        sizeAttenuation: false,
        transparent: true,
        opacity: bandBias ? 0.55 : 0.9,
        depthWrite: false
      });
      mat.size = (sizeMin + sizeMax) / 2;
      return new THREE.Points(geo, mat);
    }

    var main = makeStars(6500, 1.2, 1.6, false);
    var band = makeStars(4500, 0.9, 1.1, true);
    group.add(main, band);
    // Tagged so the cosmic zoom can cross-fade the band into the galaxy
    group.userData.mainStars = main;
    group.userData.bandStars = band;
    return group;
  }

  /** Ring of debris between rMin and rMax (scene units). */
  function debrisBelt(count, rMin, rMax, ySpread, size, color, seed) {
    var rand = seededRandom(seed);
    var pos = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      var ang = rand() * Math.PI * 2;
      var t = Math.pow(rand(), 0.7);
      var r = rMin + t * (rMax - rMin) + (rand() - 0.5) * 6;
      var o = i * 3;
      pos[o] = Math.cos(ang) * r;
      pos[o + 1] = (rand() - 0.5) * ySpread * (0.4 + rand());
      pos[o + 2] = Math.sin(ang) * r;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({
      color: color, size: size, sizeAttenuation: true,
      transparent: true, opacity: 0.7, depthWrite: false
    });
    return new THREE.Points(geo, mat);
  }

  function asteroidBelt() {
    // Main belt: 2.1–3.3 AU, mapped through the same distance compression
    var K = ORRERY.Kepler;
    var rMin = K.DIST_K * Math.pow(2.1, K.DIST_P);
    var rMax = K.DIST_K * Math.pow(3.3, K.DIST_P);
    var belt = debrisBelt(4200, rMin, rMax, 7, 0.55, 0x8a8378, 31337);
    belt.userData.spinRate = 0.004;
    return belt;
  }

  function kuiperBelt() {
    var K = ORRERY.Kepler;
    var rMin = K.DIST_K * Math.pow(32, K.DIST_P);
    var rMax = K.DIST_K * Math.pow(48, K.DIST_P);
    var belt = debrisBelt(2600, rMin, rMax, 16, 0.8, 0x5a6478, 77777);
    belt.material.opacity = 0.45;
    belt.userData.spinRate = 0.0012;
    return belt;
  }

  return { starfield: starfield, asteroidBelt: asteroidBelt, kuiperBelt: kuiperBelt };
})();
