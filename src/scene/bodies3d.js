/**
 * bodies3d.js — Builds the Sun, planets, rings, moons and orbit lines.
 *
 * Visual scale policy: planetary radii are compressed with a power law so
 * every world is visible, while relative ordering is preserved. The
 * "true size" mode rescales each mesh to its honest ratio against the
 * Sun's on-screen radius.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Bodies3D = (function () {
  'use strict';

  var EARTH_KM = 6371;

  function enhancedRadius(radiusKm) {
    return Math.max(0.55, 1.6 * Math.pow(radiusKm / EARTH_KM, 0.45));
  }

  function buildSun(data) {
    var group = new THREE.Group();
    var geo = new THREE.SphereGeometry(data.sceneRadius, 48, 32);
    var mat = ORRERY.Shaders.sunMaterial(ORRERY.Textures.build('sun'));
    var mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    var glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ORRERY.Textures.glowSprite('rgba(255,220,150,0.85)', 'rgba(242,140,40,0.28)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    glow.scale.setScalar(data.sceneRadius * 7);
    group.add(glow);

    var halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ORRERY.Textures.glowSprite('rgba(255,190,110,0.30)', 'rgba(210,90,30,0.10)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    halo.scale.setScalar(data.sceneRadius * 16);
    group.add(halo);

    group.userData = { body: data, mesh: mesh, isSun: true };
    return group;
  }

  function buildRings(planet, radius) {
    var inner = radius * 1.25, outer = radius * 2.35;
    var geo = new THREE.RingGeometry(inner, outer, 128, 1);
    // Re-map UVs radially so the band texture reads as concentric rings
    var pos = geo.attributes.position, uv = geo.attributes.uv;
    var v = new THREE.Vector3();
    for (var i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      uv.setXY(i, (v.length() - inner) / (outer - inner), 0.5);
    }
    var mat = ORRERY.Shaders.ringMaterial(
      ORRERY.Textures.ringTexture(),
      planet.hasRings === 'faint' ? 0.28 : 1.0
    );
    var mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  /**
   * Planet group hierarchy:
   *   group (heliocentric position)
   *   └─ tiltGroup (axial tilt)
   *      ├─ mesh (spins about local Y)
   *      ├─ rings?
   *      └─ moon pivots
   */
  function buildPlanet(data) {
    var group = new THREE.Group();
    var radius = enhancedRadius(data.radiusKm);
    var isEarth = data.texture === 'earth';

    var tex = ORRERY.Textures.build(data.texture);
    var mat = ORRERY.Shaders.planetMaterial({
      map: tex,
      nightMap: isEarth ? ORRERY.Textures.earthNight() : null,
      atmo: data.atmo,
      atmoI: data.atmoI
    });
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 28), mat);

    var tiltGroup = new THREE.Group();
    tiltGroup.rotation.z = -data.axialTilt * Math.PI / 180;
    tiltGroup.add(mesh);

    var clouds = null;
    if (isEarth) {
      clouds = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.018, 40, 28),
        ORRERY.Shaders.cloudMaterial(ORRERY.Textures.earthClouds())
      );
      tiltGroup.add(clouds);
    }

    var ringCfg = null;
    if (data.hasRings) {
      var rings = buildRings(data, radius);
      tiltGroup.add(rings);
      ringCfg = { inner: radius * 1.25, outer: radius * 2.35 };
      ORRERY.Shaders.registerRing(rings.material, mesh, radius);
    }

    var moons = [];
    (data.moons || []).forEach(function (m, idx) {
      m.type = 'Moon of ' + data.name;
      m.parentKey = data.key;
      m.parentName = data.name;
      var pivot = new THREE.Group();
      var mr = Math.max(0.18, radius * (m.radiusKm / data.radiusKm) * 2.2);
      var orbitR = radius * (2.4 + idx * 1.15);
      var moonMesh = new THREE.Mesh(
        new THREE.SphereGeometry(mr, 20, 14),
        new THREE.MeshLambertMaterial({ color: new THREE.Color(m.color) })
      );
      moonMesh.position.x = orbitR;
      pivot.add(moonMesh);

      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(orbitR, 0.015, 4, 90),
        new THREE.MeshBasicMaterial({ color: 0x8a94a8, transparent: true, opacity: 0.18 })
      );
      ring.rotation.x = Math.PI / 2;
      pivot.add(ring);

      tiltGroup.add(pivot);
      moons.push({ data: m, pivot: pivot, mesh: moonMesh, ring: ring, sceneRadius: mr });
    });

    ORRERY.Shaders.registerPlanet(mat, mesh, moons, ringCfg);

    group.add(tiltGroup);
    group.userData = {
      body: data,
      mesh: mesh,
      tiltGroup: tiltGroup,
      moons: moons,
      clouds: clouds,
      enhancedRadius: radius,
      trueScale: (data.radiusKm / ORRERY.DATA.SUN.radiusKm) * ORRERY.DATA.SUN.sceneRadius / radius
    };
    return group;
  }

  function buildOrbitLine(data, jd) {
    var pts = ORRERY.Kepler.orbitPath(data.el, jd, 256);
    var geo = new THREE.BufferGeometry().setFromPoints(pts);
    var mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(data.color),
      transparent: true,
      opacity: 0.28
    });
    return new THREE.Line(geo, mat);
  }

  return {
    buildSun: buildSun,
    buildPlanet: buildPlanet,
    buildOrbitLine: buildOrbitLine,
    enhancedRadius: enhancedRadius
  };
})();
