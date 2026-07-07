/**
 * moonsync.js — Drives the rendered Moon from the real lunar theory.
 *
 * bodies3d.js builds moons as schematic circular pivots (fine for Jupiter's
 * clockwork, wrong for eclipses: Earth's pivot spins in the EQUATORIAL
 * plane and knows nothing of the real Moon). This module re-sources ONLY
 * Earth's Moon from moon.js: real geocentric direction (so new/full moon,
 * phases and syzygy alignment are honest) at the existing schematic display
 * radius (the true 60 R⊕ would be off past Venus in compressed scene space
 * — distance stays a display convention, direction becomes real).
 *
 * With the direction real, the analytic moon-shadow pass in shaders.js
 * lands the umbra on Earth exactly at the finder's solar-eclipse instants,
 * and the copper tint below renders lunar eclipses — both for free off the
 * same series the finder was verified against.
 *
 * Lane note: this deliberately patches around main.js/bodies3d/shaders
 * instead of editing them (sibling lanes own diffs there):
 *   - wraps Bodies3D.buildPlanet to capture Earth's moon entry, moving the
 *     mesh + orbit ring out of the equatorial pivot into the planet group
 *     (world-aligned axes, so scene-frame ecliptic coordinates apply
 *     directly, and main.js's schematic pivot writes become inert);
 *   - wraps Shaders.update to place the Moon each frame BEFORE the shadow
 *     updaters read it (same-frame umbra, no lag);
 *   - mirrors pivot.visible so the true-size-mode fade keeps working.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.MoonSync = (function () {
  'use strict';

  var captured = null;   // { mesh, ring, pivot, orbitR, baseColor }
  var COPPER = { r: 0.42, g: 0.16, b: 0.07 };   // deep totality tint

  var baseBuild = ORRERY.Bodies3D.buildPlanet;
  ORRERY.Bodies3D.buildPlanet = function (data) {
    var group = baseBuild(data);
    if (data.key === 'earth' && group.userData.moons.length) {
      var m = group.userData.moons[0];
      // Reparent out of the tilted, spinning pivot into the group, whose
      // axes are world axes: local coords == scene-frame ecliptic coords.
      m.pivot.remove(m.mesh);
      m.pivot.remove(m.ring);
      group.add(m.mesh);
      group.add(m.ring);            // rotation.x=π/2 → ring in the ecliptic
      captured = {
        mesh: m.mesh,
        ring: m.ring,
        pivot: m.pivot,             // main.js still drives .visible on this
        orbitR: m.mesh.position.x,  // schematic display radius
        baseColor: m.mesh.material.color.clone()
      };
    }
    return group;
  };

  function sync() {
    if (!captured) return;
    var jd = ORRERY.TimeBar.jd;
    var g = ORRERY.Moon.geoJ2000(jd);
    var s = captured.orbitR / g.distKm;
    // Ecliptic (x, y, z-north) → scene (x, z-north→y, -y), like toScene
    captured.mesh.position.set(g.x * s, g.z * s, -g.y * s);

    // True-size mode hides moons via the (now empty) pivot — mirror it.
    captured.mesh.visible = captured.ring.visible = captured.pivot.visible;

    // Copper Moon: whole-disk tint by umbral immersion (per-pixel gradient
    // would need a shader swap; the uniform tint is labeled in the almanac).
    var sh = ORRERY.Eclipse.lunarShading(jd);
    var c = captured.mesh.material.color;
    var b = captured.baseColor;
    if (sh.umbra > 0 || sh.penumbra > 0) {
      var dim = 1 - 0.25 * sh.penumbra;           // shallow penumbral dusk
      var u = sh.umbra;
      c.setRGB(b.r * dim * (1 - u) + COPPER.r * u,
               b.g * dim * (1 - u) + COPPER.g * u,
               b.b * dim * (1 - u) + COPPER.b * u);
    } else if (c.r !== b.r || c.g !== b.g || c.b !== b.b) {
      c.copy(b);
    }
  }

  var baseUpdate = ORRERY.Shaders.update;
  ORRERY.Shaders.update = function (dt) {
    sync();               // before the shadow updaters → same-frame umbra
    baseUpdate(dt);
  };

  return {
    /** e2e/debug hook: the Moon's current scene-space state. */
    debug: function () {
      if (!captured) return null;
      return {
        pos: { x: captured.mesh.position.x, y: captured.mesh.position.y, z: captured.mesh.position.z },
        color: { r: captured.mesh.material.color.r, g: captured.mesh.material.color.g, b: captured.mesh.material.color.b },
        base: { r: captured.baseColor.r, g: captured.baseColor.g, b: captured.baseColor.b },
        shading: ORRERY.Eclipse.lunarShading(ORRERY.TimeBar.jd),
        // Earth-shader shadow state: slot 0 of the moonShadow uniform (object
        // space) + the object-space sun direction — lets the e2e spec assert
        // the umbra actually DRAWS, not just that the geometry aligns.
        shadow: (function () {
          var g = captured.mesh.parent;                  // the Earth group
          var u = g.userData.mesh.material.uniforms;
          var s = u.moonShadow.value[0];
          var sd = u.sunDirLocal.value;
          return { x: s.x, y: s.y, z: s.z, w: s.w,
                   sun: { x: sd.x, y: sd.y, z: sd.z } };
        })()
      };
    }
  };
})();
