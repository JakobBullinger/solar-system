/**
 * nbody.js — Restricted n-body physics for the gravity sandbox.
 *
 * User-spawned test particles feel the gravity of the Sun and all eight
 * planets (which stay on their exact Kepler rails and are not perturbed
 * back — the "restricted" problem). Everything here works in real units:
 * heliocentric ecliptic AU and days, with GM values from JPL mass ratios.
 * The scene-space compression is applied only at render time.
 *
 * Integrator: kick-drift-kick leapfrog with substeps capped at 0.25 days,
 * plus a small softening term so close passes slingshot instead of
 * dividing by zero. Time-symmetric, so scrubbing time backwards works.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.NBody = (function () {
  'use strict';

  var MU = 2.9591220828e-4;      // GM_sun in AU³/day²
  var SOFT2 = 1e-6;              // softening length² (AU²)
  var MAX_STEP = 0.25;           // max substep, days
  var MAX_SUBSTEPS = 240;        // per frame, keeps sun-divers cheap
  var KMS_PER_AUDAY = 1731.456;  // 1 AU/day in km/s

  var SUN_R = 0.008;             // swallowed inside this radius (AU)
  var ESCAPE_R = 80;             // gone beyond this radius (AU)

  // M_sun / M_planet (JPL; Earth value includes the Moon)
  var RATIOS = {
    mercury: 6023600,   venus: 408523.7, earth: 328900.56, mars: 3098708,
    jupiter: 1047.3486, saturn: 3497.898, uranus: 22902.98, neptune: 19412.24
  };

  var sources = [];
  function initSources() {
    if (sources.length) return;
    ORRERY.DATA.PLANETS.forEach(function (p) {
      if (RATIOS[p.key]) sources.push({ el: p.el, mu: MU / RATIOS[p.key] });
    });
  }

  var particles = [];
  var lost = { sun: 0, escaped: 0 };

  /** Planet source positions (heliocentric AU) at time jd. */
  function srcAt(jd, out) {
    for (var i = 0; i < sources.length; i++) {
      var h = ORRERY.Kepler.heliocentric(sources[i].el, jd);
      out[i].x = h.x; out[i].y = h.y; out[i].z = h.z;
      out[i].mu = sources[i].mu;
    }
    return out;
  }

  function makeSrcBuffer() {
    initSources();
    var buf = [];
    for (var i = 0; i < sources.length; i++) buf.push({ x: 0, y: 0, z: 0, mu: 0 });
    return buf;
  }

  /**
   * Gravitational acceleration at (px,py,pz): Sun + planets, including the
   * indirect term that accounts for the heliocentric frame's own motion.
   */
  function accel(px, py, pz, src, out) {
    var r2 = px * px + py * py + pz * pz + SOFT2;
    var inv = 1 / (r2 * Math.sqrt(r2));
    var ax = -MU * px * inv, ay = -MU * py * inv, az = -MU * pz * inv;
    for (var i = 0; i < src.length; i++) {
      var s = src[i];
      var dx = s.x - px, dy = s.y - py, dz = s.z - pz;
      var d2 = dx * dx + dy * dy + dz * dz + SOFT2;
      var di = 1 / (d2 * Math.sqrt(d2));
      var s2 = s.x * s.x + s.y * s.y + s.z * s.z;
      var si = 1 / (s2 * Math.sqrt(s2));
      ax += s.mu * (dx * di - s.x * si);
      ay += s.mu * (dy * di - s.y * si);
      az += s.mu * (dz * di - s.z * si);
    }
    out.x = ax; out.y = ay; out.z = az;
  }

  function addParticle(pos, vel, color) {
    initSources();
    var p = {
      pos: { x: pos.x, y: pos.y, z: pos.z },
      vel: { x: vel.x, y: vel.y, z: vel.z },
      acc: { x: 0, y: 0, z: 0 },
      color: color,
      alive: true,
      status: 'orbiting'
    };
    var src = srcAt(ORRERY.TimeBar.jd, makeSrcBuffer());
    accel(p.pos.x, p.pos.y, p.pos.z, src, p.acc);
    particles.push(p);
    return p;
  }

  /** Did the segment A→B sweep through the Sun's kill sphere? */
  function hitsSun(ax, ay, az, bx, by, bz) {
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var l2 = dx * dx + dy * dy + dz * dz;
    var t = l2 > 0 ? -(ax * dx + ay * dy + az * dz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + t * dx, cy = ay + t * dy, cz = az + t * dz;
    return cx * cx + cy * cy + cz * cz < SUN_R * SUN_R;
  }

  var stepSrc = null;
  var stepAcc = { x: 0, y: 0, z: 0 };

  /**
   * Advance one particle by h days against fixed sources, refining the
   * step near the Sun: hl scales with the local dynamical time so a
   * sun-diver's perihelion is resolved instead of stepped across.
   */
  function advance(p, h, src) {
    var remaining = h, guard = 0;
    while (remaining !== 0 && p.alive && guard++ < 500) {
      var r = Math.sqrt(p.pos.x * p.pos.x + p.pos.y * p.pos.y + p.pos.z * p.pos.z);
      var hMax = 0.08 * Math.sqrt(r * r * r / MU) + 1e-4;
      var hl = remaining;
      if (Math.abs(hl) > hMax) hl = remaining > 0 ? hMax : -hMax;

      var ox = p.pos.x, oy = p.pos.y, oz = p.pos.z;
      p.vel.x += 0.5 * hl * p.acc.x;
      p.vel.y += 0.5 * hl * p.acc.y;
      p.vel.z += 0.5 * hl * p.acc.z;
      p.pos.x += hl * p.vel.x;
      p.pos.y += hl * p.vel.y;
      p.pos.z += hl * p.vel.z;
      accel(p.pos.x, p.pos.y, p.pos.z, src, stepAcc);
      p.vel.x += 0.5 * hl * stepAcc.x;
      p.vel.y += 0.5 * hl * stepAcc.y;
      p.vel.z += 0.5 * hl * stepAcc.z;
      p.acc.x = stepAcc.x; p.acc.y = stepAcc.y; p.acc.z = stepAcc.z;

      if (hitsSun(ox, oy, oz, p.pos.x, p.pos.y, p.pos.z)) {
        p.alive = false; p.status = 'sun'; lost.sun++;
      } else {
        var r2 = p.pos.x * p.pos.x + p.pos.y * p.pos.y + p.pos.z * p.pos.z;
        if (r2 > ESCAPE_R * ESCAPE_R) { p.alive = false; p.status = 'escaped'; lost.escaped++; }
      }
      remaining -= hl;
    }
  }

  /** Advance all particles from jd0 by dDays (either sign). */
  function step(jd0, dDays) {
    if (!particles.length || dDays === 0) return;
    if (Math.abs(dDays) > 30) return; // time-teleport (e.g. "Today"): don't integrate
    if (!stepSrc) stepSrc = makeSrcBuffer();

    var n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(Math.abs(dDays) / MAX_STEP)));
    var h = dDays / n;
    for (var s = 1; s <= n; s++) {
      srcAt(jd0 + s * h, stepSrc);
      for (var i = 0; i < particles.length; i++) {
        if (particles[i].alive) advance(particles[i], h, stepSrc);
      }
    }
  }

  /**
   * Preview trajectory from (pos, vel) with the planets frozen at jd:
   * an aiming guide, not a promise. Returns positions every `every` steps.
   */
  function preview(pos, vel, jd, steps, h, every) {
    var src = srcAt(jd, stepSrc || (stepSrc = makeSrcBuffer()));
    var px = pos.x, py = pos.y, pz = pos.z;
    var vx = vel.x, vy = vel.y, vz = vel.z;
    var a = { x: 0, y: 0, z: 0 };
    accel(px, py, pz, src, a);
    var out = [];
    for (var s = 0; s < steps; s++) {
      vx += 0.5 * h * a.x; vy += 0.5 * h * a.y; vz += 0.5 * h * a.z;
      px += h * vx; py += h * vy; pz += h * vz;
      accel(px, py, pz, src, a);
      vx += 0.5 * h * a.x; vy += 0.5 * h * a.y; vz += 0.5 * h * a.z;
      if (s % every === 0) out.push({ x: px, y: py, z: pz });
      var r2 = px * px + py * py + pz * pz;
      if (r2 < SUN_R * SUN_R || r2 > 6400) break;
    }
    return out;
  }

  /** Specific orbital energy vs the Sun: negative = bound. */
  function energy(pos, vel) {
    var v2 = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
    var r = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
    return 0.5 * v2 - MU / r;
  }

  function remove(p) {
    var i = particles.indexOf(p);
    if (i !== -1) particles.splice(i, 1);
  }

  function clear() {
    particles.length = 0;
    lost.sun = 0;
    lost.escaped = 0;
  }

  return {
    MU: MU,
    KMS_PER_AUDAY: KMS_PER_AUDAY,
    particles: particles,
    lost: lost,
    addParticle: addParticle,
    step: step,
    preview: preview,
    energy: energy,
    remove: remove,
    clear: clear
  };
})();
