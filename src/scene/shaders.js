/**
 * shaders.js — "Worlds up close": custom materials for the Sun, planets,
 * clouds and rings.
 *
 * Lighting exploits the scene's one truth: the Sun sits at the world origin,
 * so the sun direction at any fragment is just -normalize(worldPos) and no
 * light uniforms are needed. On top of that, three analytic shadow effects:
 *
 *   ring band on the planet   ray from surface point toward the Sun crosses
 *                             the ring annulus (object space, y = 0 plane)
 *   planet shadow on rings    ray from ring point toward the Sun passes
 *                             within the planet's radius of its centre
 *   moon shadows on the disk  same test against up to four moon spheres —
 *                             eclipses happen live as the moons orbit
 *
 * Per-frame uniforms (sun direction in object space, moon positions, time)
 * are refreshed by updaters registered here and driven from the render loop
 * via ORRERY.Shaders.update(dt).
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Shaders = (function () {
  'use strict';

  var VERT = [
    'varying vec2 vUv;',
    'varying vec3 vNormal;',
    'varying vec3 vWorldPos;',
    'varying vec3 vObjPos;',
    'void main() {',
    '  vUv = uv;',
    '  vObjPos = position;',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vWorldPos = wp.xyz;',
    '  vNormal = normalize(mat3(modelMatrix) * normal);',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  var PLANET_FRAG = [
    'uniform sampler2D map;',
    'uniform sampler2D nightMap;',
    'uniform float hasNight;',
    'uniform vec3 atmoColor;',
    'uniform float atmoI;',
    'uniform vec3 sunDirLocal;',
    'uniform float ringInner;',      // 0.0 → no ring shadow
    'uniform float ringOuter;',
    'uniform vec4 moonShadow[4];',   // xyz object-space pos, w radius (0 = off)
    'varying vec2 vUv;',
    'varying vec3 vNormal;',
    'varying vec3 vWorldPos;',
    'varying vec3 vObjPos;',
    'void main() {',
    '  vec3 n = normalize(vNormal);',
    '  vec3 sunDir = normalize(-vWorldPos);',
    '  float ndl = dot(n, sunDir);',
    '  float dayT = smoothstep(-0.12, 0.18, ndl);',
    '  float lit = max(ndl, 0.0);',
    '',
    '  vec3 tex = texture2D(map, vUv).rgb;',
    '',
    '  float shade = 1.0;',
    '  vec3 sd = normalize(sunDirLocal);',
    '  if (ringOuter > 0.0 && abs(sd.y) > 0.001) {',
    '    float t = -vObjPos.y / sd.y;',
    '    if (t > 0.0) {',
    '      float r = length(vObjPos.xz + sd.xz * t);',
    '      float band = smoothstep(ringInner - 0.06, ringInner + 0.06, r) *',
    '                   (1.0 - smoothstep(ringOuter - 0.06, ringOuter + 0.06, r));',
    '      shade -= band * 0.5;',
    '    }',
    '  }',
    '  for (int i = 0; i < 4; i++) {',
    '    if (moonShadow[i].w > 0.0) {',
    '      vec3 v = moonShadow[i].xyz - vObjPos;',
    '      float tc = dot(v, sd);',
    '      if (tc > 0.0) {',
    '        float d = length(v - sd * tc);',
    '        shade -= 0.85 * (1.0 - smoothstep(moonShadow[i].w * 0.7,',
    '                                          moonShadow[i].w * 1.3, d));',
    '      }',
    '    }',
    '  }',
    '  shade = clamp(shade, 0.0, 1.0);',
    '',
    '  vec3 dayCol = tex * (0.16 + 1.02 * lit) * shade;',
    '  vec3 nightCol = tex * 0.05;',
    '  if (hasNight > 0.5) nightCol += texture2D(nightMap, vUv).rgb * 1.2;',
    '  vec3 col = mix(nightCol, dayCol, dayT);',
    '',
    '  vec3 vd = normalize(cameraPosition - vWorldPos);',
    // Ocean sun-glint — gated on hasNight (only Earth ever gets a night
    // map), so this never touches the other planets' materials. The ocean
    // mask is read straight off the day texture's real coastlines (water
    // is reliably blue-dominant vs. any land/ice tint textures.js paints —
    // see geodata.js) rather than a second texture.
    '  if (hasNight > 0.5) {',
    '    float ocean = step(tex.r * 1.3, tex.b) * step(tex.g * 1.05, tex.b);',
    '    vec3 halfV = normalize(sunDir + vd);',
    '    float spec = pow(max(dot(n, halfV), 0.0), 140.0);',
    '    col += vec3(1.0, 0.98, 0.9) * spec * ocean * lit * 2.4 * shade;',
    '  }',
    '',
    '  float fr = pow(1.0 - max(dot(vd, n), 0.0), 2.4);',
    '  col += atmoColor * fr * atmoI * (0.22 + 0.78 * dayT);',
    '',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var CLOUD_FRAG = [
    'uniform sampler2D map;',
    'varying vec2 vUv;',
    'varying vec3 vNormal;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  float a = texture2D(map, vUv).a;',
    '  vec3 n = normalize(vNormal);',
    '  float lit = max(dot(n, normalize(-vWorldPos)), 0.0);',
    '  float dayT = smoothstep(-0.1, 0.2, dot(n, normalize(-vWorldPos)));',
    '  vec3 col = vec3(1.0, 0.99, 0.97) * (0.06 + 1.0 * lit);',
    '  gl_FragColor = vec4(col, a * (0.25 + 0.75 * dayT) * 0.92);',
    '}'
  ].join('\n');

  var RING_FRAG = [
    'uniform sampler2D map;',
    'uniform float ringOpacity;',
    'uniform vec3 planetCenter;',
    'uniform float planetR;',
    'varying vec2 vUv;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  vec4 tex = texture2D(map, vUv);',
    '  vec3 toSun = normalize(-vWorldPos);',
    '  vec3 toC = planetCenter - vWorldPos;',
    '  float tc = dot(toC, toSun);',
    '  float shadow = 0.0;',
    '  if (tc > 0.0) {',
    '    float d = length(toC - toSun * tc);',
    '    shadow = 1.0 - smoothstep(planetR * 0.86, planetR * 1.04, d);',
    '  }',
    '  vec3 col = tex.rgb * (1.0 - 0.78 * shadow);',
    '  gl_FragColor = vec4(col, tex.a * ringOpacity);',
    '}'
  ].join('\n');

  var SUN_FRAG = [
    'uniform sampler2D map;',
    'uniform float time;',
    'varying vec2 vUv;',
    'varying vec3 vNormal;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  vec3 c1 = texture2D(map, vUv + vec2(time * 0.004, 0.0)).rgb;',
    '  vec3 c2 = texture2D(map, vUv * 1.6 + vec2(-time * 0.007, time * 0.0015)).rgb;',
    '  vec3 col = c1 * 0.72 + c2 * 0.5;',
    '  vec3 vd = normalize(cameraPosition - vWorldPos);',
    '  float dn = max(dot(vd, normalize(vNormal)), 0.0);',
    '  col *= 0.72 + 0.55 * pow(dn, 1.3);',
    '  col = mix(vec3(1.05, 0.42, 0.12), col, smoothstep(0.0, 0.35, dn));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var updaters = [];
  var ORIGIN = new THREE.Vector3();
  var TMP = new THREE.Vector3();

  function emptyMoonShadows() {
    return [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  }

  function planetMaterial(opts) {
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: PLANET_FRAG,
      uniforms: {
        map: { value: opts.map },
        nightMap: { value: opts.nightMap || opts.map },
        hasNight: { value: opts.nightMap ? 1 : 0 },
        atmoColor: { value: new THREE.Color(opts.atmo || '#000000') },
        atmoI: { value: opts.atmoI || 0 },
        sunDirLocal: { value: new THREE.Vector3(1, 0, 0) },
        ringInner: { value: 0 },
        ringOuter: { value: 0 },
        moonShadow: { value: emptyMoonShadows() }
      }
    });
  }

  /**
   * Refresh a planet's object-space uniforms each frame: sun direction,
   * ring-shadow radii, and moon shadow-caster positions (all divided by the
   * mesh scale so true-size mode stays consistent).
   */
  function registerPlanet(mat, mesh, moons, ring) {
    updaters.push(function () {
      mesh.updateWorldMatrix(true, false);
      var s = mesh.scale.x;
      var u = mat.uniforms;
      u.sunDirLocal.value.copy(mesh.worldToLocal(TMP.copy(ORIGIN))).normalize();
      if (ring) {
        u.ringInner.value = ring.inner / s;
        u.ringOuter.value = ring.outer / s;
      }
      for (var i = 0; i < 4; i++) {
        var slot = u.moonShadow.value[i];
        var m = moons[i];
        if (m && m.pivot.visible) {
          m.mesh.getWorldPosition(TMP);
          mesh.worldToLocal(TMP);
          slot.set(TMP.x, TMP.y, TMP.z, (m.sceneRadius / s) * 1.05);
        } else {
          slot.w = 0;
        }
      }
    });
    return mat;
  }

  function cloudMaterial(tex) {
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: { map: { value: tex } },
      transparent: true,
      depthWrite: false
    });
  }

  function ringMaterial(tex, opacity) {
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: RING_FRAG,
      uniforms: {
        map: { value: tex },
        ringOpacity: { value: opacity },
        planetCenter: { value: new THREE.Vector3() },
        planetR: { value: 1 }
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
  }

  function registerRing(mat, planetMesh, radius) {
    updaters.push(function () {
      planetMesh.getWorldPosition(mat.uniforms.planetCenter.value);
      mat.uniforms.planetR.value = radius * planetMesh.scale.x;
    });
    return mat;
  }

  function sunMaterial(tex) {
    var mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: SUN_FRAG,
      uniforms: { map: { value: tex }, time: { value: 0 } }
    });
    updaters.push(function (t) { mat.uniforms.time.value = t; });
    return mat;
  }

  var elapsed = 0;
  function update(dt) {
    elapsed += dt;
    for (var i = 0; i < updaters.length; i++) updaters[i](elapsed);
  }

  return {
    planetMaterial: planetMaterial,
    registerPlanet: registerPlanet,
    cloudMaterial: cloudMaterial,
    ringMaterial: ringMaterial,
    registerRing: registerRing,
    sunMaterial: sunMaterial,
    update: update
  };
})();
