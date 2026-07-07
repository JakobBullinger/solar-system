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
 *
 * SECOND REGIME (level 20, The What-If Machine): the moment any body with
 * real mass exists, the restricted problem is no longer honest — massive
 * bodies must pull the planets and the planets must pull each other. The
 * "promoted" regime (see the Massive mode section below) integrates
 * Sun + eight planets + every massive body as a full mutual n-body system;
 * massless probes feel all of them. When no massive body exists, every
 * code path here is bit-identical to the rails regime above — the
 * trajectory regression guard in npm test is the judge.
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
  var lost = { sun: 0, escaped: 0, impact: 0 };

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
    if (promoted) return addParticlePromoted(pos, vel, color);
    var p = {
      pos: { x: pos.x, y: pos.y, z: pos.z },
      vel: { x: vel.x, y: vel.y, z: vel.z },
      acc: { x: 0, y: 0, z: 0 },
      color: color,
      alive: true,
      status: 'orbiting',
      burns: null,                 // optional [{jd, dv:{x,y,z}, done}] impulses
      minR: Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z)
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
        var rNow = Math.sqrt(r2);
        if (rNow < p.minR) p.minR = rNow;
        if (r2 > ESCAPE_R * ESCAPE_R) { p.alive = false; p.status = 'escaped'; lost.escaped++; }
      }
      remaining -= hl;
    }
  }

  /**
   * Advance one particle across [t0, t1], splitting the step at any pending
   * scheduled impulse so the kick lands at its exact jd. Burns only fire
   * while time runs forward — scrubbing back does not un-burn.
   */
  function advanceWithBurns(p, t0, t1, src) {
    if (p.burns && t1 > t0) {
      for (var b = 0; b < p.burns.length; b++) {
        var burn = p.burns[b];
        if (!burn.done && burn.jd > t0 && burn.jd <= t1) {
          advance(p, burn.jd - t0, src);
          if (!p.alive) return;
          p.vel.x += burn.dv.x; p.vel.y += burn.dv.y; p.vel.z += burn.dv.z;
          burn.done = true;
          advance(p, t1 - burn.jd, src);
          return;
        }
      }
    }
    advance(p, t1 - t0, src);
  }

  /** Advance all particles from jd0 by dDays (either sign). */
  function step(jd0, dDays) {
    if (promoted) return stepPromoted(dDays);
    if (!particles.length || dDays === 0) return;
    if (Math.abs(dDays) > 30) return; // time-teleport (e.g. "Today"): don't integrate
    if (!stepSrc) stepSrc = makeSrcBuffer();

    var n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(Math.abs(dDays) / MAX_STEP)));
    var h = dDays / n;
    for (var s = 1; s <= n; s++) {
      srcAt(jd0 + s * h, stepSrc);
      for (var i = 0; i < particles.length; i++) {
        if (particles[i].alive) {
          advanceWithBurns(particles[i], jd0 + (s - 1) * h, jd0 + s * h, stepSrc);
        }
      }
    }
  }

  /**
   * Preview trajectory from (pos, vel) with the planets frozen at jd:
   * an aiming guide, not a promise. Returns positions every `every` steps.
   */
  function preview(pos, vel, jd, steps, h, every) {
    if (promoted) return previewPromoted(pos, vel, steps, h, every);
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

  /**
   * Mission-grade preview: unlike preview(), the planets MOVE during the
   * integration, and the pass is scored against a target — closest approach
   * to `targetEl` (with the moment and both positions), minimum solar
   * distance, death, and final orbital energy. This is what makes aiming at
   * a planet that won't be there for another year a playable game.
   *
   * `burns` (optional): scheduled mid-course impulses [{t, dv:{x,y,z}}] with
   * t in days after jd0 and dv in AU/day, sorted by t. Each is applied once,
   * at the start of the first integration step whose window contains it.
   * Points carry `t` (days after jd0) so the UI can map arc → time.
   */
  function previewLive(pos, vel, jd0, steps, h, targetEl, every, burns) {
    initSources();
    var src = makeSrcBuffer();
    var ti = -1;
    for (var k = 0; k < sources.length; k++) {
      if (sources[k].el === targetEl) ti = k;
    }
    var px = pos.x, py = pos.y, pz = pos.z;
    var vx = vel.x, vy = vel.y, vz = vel.z;
    var a = { x: 0, y: 0, z: 0 };
    srcAt(jd0, src);
    accel(px, py, pz, src, a);
    var out = {
      points: [], died: null, minR: 1e9, maxR: 0, endEnergy: 0,
      minRJd: jd0, maxRJd: jd0,
      target: ti >= 0 ? { d: 1e9, jd: jd0, x: 0, y: 0, z: 0 } : null,
      capture: null              // longest bound streak vs the target (below)
    };
    var burnIdx = 0;
    var capBest = null, capCur = null;
    for (var s = 1; s <= steps; s++) {
      if (burns && burnIdx < burns.length && burns[burnIdx].t <= (s - 1) * h) {
        var dv = burns[burnIdx].dv;
        vx += dv.x; vy += dv.y; vz += dv.z;
        burnIdx++;
      }
      srcAt(jd0 + s * h, src);
      // Adaptive inner steps (same rule as advance()) so a sun-grazer's
      // perihelion is resolved instead of leapt across
      var remaining = h, guard = 0, r = 0;
      while (remaining !== 0 && guard++ < 500) {
        r = Math.sqrt(px * px + py * py + pz * pz);
        var hMax = 0.08 * Math.sqrt(r * r * r / MU) + 1e-4;
        var hl = remaining;
        if (Math.abs(hl) > hMax) hl = remaining > 0 ? hMax : -hMax;
        vx += 0.5 * hl * a.x; vy += 0.5 * hl * a.y; vz += 0.5 * hl * a.z;
        px += hl * vx; py += hl * vy; pz += hl * vz;
        accel(px, py, pz, src, a);
        vx += 0.5 * hl * a.x; vy += 0.5 * hl * a.y; vz += 0.5 * hl * a.z;
        r = Math.sqrt(px * px + py * py + pz * pz);
        if (r < out.minR) { out.minR = r; out.minRJd = jd0 + s * h; }
        if (r > out.maxR) { out.maxR = r; out.maxRJd = jd0 + s * h; }
        if (r < SUN_R) { out.died = 'sun'; break; }
        remaining -= hl;
      }

      if (s % every === 0) out.points.push({ x: px, y: py, z: pz, t: s * h, vz: vz });
      if (ti >= 0) {
        var t = src[ti];
        var d = Math.sqrt((px - t.x) * (px - t.x) + (py - t.y) * (py - t.y) + (pz - t.z) * (pz - t.z));
        if (d < out.target.d) {
          out.target.d = d;
          out.target.jd = jd0 + s * h;
          out.target.x = t.x; out.target.y = t.y; out.target.z = t.z;
        }
        // Capture tracking (orbit-insertion missions): count consecutive
        // days bound to the target — negative two-body energy inside its
        // Hill sphere, the same relPlanet() test the flight HUD runs — and
        // carry the streak's osculating rp/ra (worstRp = the streak's
        // largest periapsis, so a "periapsis under X" verdict can't be
        // gamed by one lucky sample).
        var rel = relPlanet({ x: px, y: py, z: pz }, { x: vx, y: vy, z: vz },
          targetEl, jd0 + s * h);
        if (rel && rel.bound) {
          if (!capCur) capCur = { days: 0, startJd: jd0 + s * h, worstRp: 0, worstRa: 0, rp: 0, ra: 0 };
          capCur.days += h;
          capCur.rp = rel.orb.rp; capCur.ra = rel.orb.ra;
          if (rel.orb.rp > capCur.worstRp) capCur.worstRp = rel.orb.rp;
          if (rel.orb.ra > capCur.worstRa) capCur.worstRa = rel.orb.ra;
          if (!capBest || capCur.days >= capBest.days) capBest = capCur;
        } else {
          capCur = null;
        }
      }
      if (out.died || r * r > 6400) break;
    }
    out.endEnergy = energy({ x: px, y: py, z: pz }, { x: vx, y: vy, z: vz });
    out.capture = capBest;
    return out;
  }

  /** Specific orbital energy vs the Sun: negative = bound. */
  function energy(pos, vel) {
    var v2 = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
    var r = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
    return 0.5 * v2 - MU / r;
  }

  /**
   * Osculating two-body elements from a relative state. Returns null when
   * the state is unbound. rp/ra are what an insertion HUD wants: the orbit's
   * periapsis is known the instant the capture burn fires, without waiting
   * half a period to sample it.
   */
  function oscElements(dx, dy, dz, vx, vy, vz, mu) {
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var v2 = vx * vx + vy * vy + vz * vz;
    var e = 0.5 * v2 - mu / d;
    if (e >= 0) return null;
    var a = -mu / (2 * e);
    var hx = dy * vz - dz * vy, hy = dz * vx - dx * vz, hz = dx * vy - dy * vx;
    var ecc = Math.sqrt(Math.max(0, 1 - (hx * hx + hy * hy + hz * hz) / (mu * a)));
    return { a: a, e: ecc, rp: a * (1 - ecc), ra: a * (1 + ecc) };
  }

  /**
   * State of (pos, vel) relative to a planet at jd: separation, the planet's
   * Hill radius at its current solar distance, two-body energy against its
   * potential, and osculating elements when bound. `bound` — negative energy
   * inside the Hill sphere — is the game's definition of "captured". The
   * planet's velocity comes from a central Kepler difference (±0.5 d), which
   * is accurate to ~1e-8 AU/day; a one-sided difference over a preview step
   * would drown capture-orbit speeds (~2e-4 AU/day at Mars) in error.
   */
  function relPlanet(pos, vel, el, jd) {
    initSources();
    var mu = 0;
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].el === el) mu = sources[i].mu;
    }
    if (!mu) return null;
    var hp = ORRERY.Kepler.heliocentric(el, jd);
    var h1 = ORRERY.Kepler.heliocentric(el, jd - 0.5);
    var h2 = ORRERY.Kepler.heliocentric(el, jd + 0.5);
    var dx = pos.x - hp.x, dy = pos.y - hp.y, dz = pos.z - hp.z;
    var vx = vel.x - (h2.x - h1.x), vy = vel.y - (h2.y - h1.y), vz = vel.z - (h2.z - h1.z);
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var rT = Math.sqrt(hp.x * hp.x + hp.y * hp.y + hp.z * hp.z);
    var hill = rT * Math.pow(mu / (3 * MU), 1 / 3);
    var orb = oscElements(dx, dy, dz, vx, vy, vz, mu);
    return { d: d, hill: hill, mu: mu, orb: orb, bound: !!orb && d < hill };
  }

  // ==== Massive mode (level 20: The What-If Machine) ==========================
  //
  // Internal frame: INERTIAL, not heliocentric. At promotion the Sun sits at
  // the origin and receives the recoil velocity that puts the system
  // barycenter at rest — with star-class masses in play, plain leapfrog is
  // symplectic only in an inertial frame (energy bounded, total momentum
  // conserved to rounding); the rails regime's heliocentric-frame indirect
  // term would surrender both. Everything the app sees stays heliocentric:
  // helioOf()/planetHelioAU() subtract the Sun's integrated position.
  //
  // Promotion takes planet states off the Kepler rails (position + central
  // velocity difference over ±0.5 d, the relPlanet() trick — good to
  // ~1e-8 AU/day). Demotion (restore()) snaps them back to the rails: an
  // explicit discontinuity, surfaced in the sandbox as "restore the real
  // solar system".
  //
  // Substeps: one global adaptive h shared by every body — 0.08× the
  // tightest pair's dynamical time, capped at H_CAP. H_CAP = 0.25 d was set
  // by MEASUREMENT (1000 y promoted-but-unperturbed, whatif.test.js pins
  // the bounds): relative energy drift 1.6e-7, Mercury's perihelion
  // distance stable to 0.026%, total momentum conserved to ~1e-22, cost
  // 78 µs per simulated day (≈0.5 ms/frame at the slider's 1 yr/s max, so
  // no hard rate cap is needed; the substep budget below is the throttle).
  // H = 1 d would let Mercury's perihelion wander 15% per kyr; 0.25 d is
  // also exactly the rails MAX_STEP. Known artifact, measured: Mercury's
  // apsidal line precesses numerically at ~-0.14°/yr (leapfrog step error
  // at perihelion; halving H quarters it) — invisible in-app since massive
  // mode hides the static ellipses and trails show the recent truth.
  // Adaptive h also means the promoted regime is NOT exactly
  // time-symmetric, unlike rails — scrubbing backwards retraces only
  // approximately. Bodies that sweep inside each other's radii merge
  // inelastically (momentum-conserving), which is also what makes the
  // kinetic-impactor scenario physical.
  var PROMOTED_ESCAPE_R = 1500;  // AU — companion-star scenarios live far out
  // Body-body softening is (near) zero: bodies have physical radii and merge
  // on swept contact, so the singularity never arrives — and the rails
  // softening length (1e-3 AU) would drive a visible artificial retrograde
  // precession of Mercury (measured ~0.04°/orbit). Particle-body forces keep
  // the rails SOFT2 so probes slingshot exactly as they do off-rails.
  var SOFT2_B = 1e-12;
  var H_CAP = 0.25;              // max promoted substep, days (measured)
  var H_MIN = 5e-4;              // adaptive floor: ~43 s, deep-encounter resolution
  var MAX_PSUB = 1200;           // per-step() substep budget: ~22 ms worst-case
                                 // frame; past it the slice is dropped and
                                 // `throttled` tells the sandbox to slow the clock
  var AU_KM = 1.495978707e8;

  var promoted = null;           // { bodies: [sun, planets..., massive...] }
  var massive = [];              // the user-launched massive subset
  var events = [];               // human-readable regime events for the HUD
  var throttled = false;         // set when a step() ran out of substep budget
  var mid = 0;

  function pushEvent(msg) {
    events.push(msg);
    if (events.length > 8) events.shift();
  }

  /** Promote Sun + planets to integrated bodies, initial state from rails. */
  function promote(jd) {
    if (promoted) return;
    initSources();
    var sun = {
      key: 'sun', label: 'the Sun', mu: MU, radius: SUN_R,
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
      acc: { x: 0, y: 0, z: 0 }, ox: 0, oy: 0, oz: 0,
      alive: true, status: 'sun'
    };
    var bodies = [sun];
    ORRERY.DATA.PLANETS.forEach(function (p) {
      if (!RATIOS[p.key]) return;
      var h0 = ORRERY.Kepler.heliocentric(p.el, jd);
      var h1 = ORRERY.Kepler.heliocentric(p.el, jd - 0.5);
      var h2 = ORRERY.Kepler.heliocentric(p.el, jd + 0.5);
      bodies.push({
        key: p.key, label: p.name, planet: true,
        mu: MU / RATIOS[p.key], radius: p.radiusKm / AU_KM,
        pos: { x: h0.x, y: h0.y, z: h0.z },
        vel: { x: h2.x - h1.x, y: h2.y - h1.y, z: h2.z - h1.z },
        acc: { x: 0, y: 0, z: 0 }, ox: 0, oy: 0, oz: 0,
        alive: true, status: 'orbiting'
      });
    });
    // Barycenter-at-rest frame: the Sun recoils against the planets' momentum
    var px = 0, py = 0, pz = 0, mTot = MU;
    for (var i = 1; i < bodies.length; i++) {
      var b = bodies[i];
      px += b.mu * b.vel.x; py += b.mu * b.vel.y; pz += b.mu * b.vel.z;
      mTot += b.mu;
    }
    sun.vel.x = -px / mTot; sun.vel.y = -py / mTot; sun.vel.z = -pz / mTot;
    for (i = 1; i < bodies.length; i++) {
      bodies[i].vel.x += sun.vel.x;
      bodies[i].vel.y += sun.vel.y;
      bodies[i].vel.z += sun.vel.z;
    }
    // Existing massless particles ride along: heliocentric → inertial
    particles.forEach(function (p) {
      p.vel.x += sun.vel.x; p.vel.y += sun.vel.y; p.vel.z += sun.vel.z;
    });
    promoted = { bodies: bodies, jd: jd };
    computeAccels(bodies);
    particles.forEach(function (p) {
      if (p.alive) accelInertial(p.pos.x, p.pos.y, p.pos.z, bodies, p.acc);
    });
  }

  /** Demote: massive bodies vanish, planets return to their Kepler rails. */
  function restore() {
    if (!promoted) return;
    var sun = promoted.bodies[0];
    particles.forEach(function (p) {
      p.pos.x -= sun.pos.x; p.pos.y -= sun.pos.y; p.pos.z -= sun.pos.z;
      p.vel.x -= sun.vel.x; p.vel.y -= sun.vel.y; p.vel.z -= sun.vel.z;
    });
    promoted = null;
    massive.length = 0;
    events.length = 0;
    throttled = false;
    // Refresh particle accelerations for the rails kick
    if (particles.length) {
      var src = srcAt(ORRERY.TimeBar.jd, makeSrcBuffer());
      particles.forEach(function (p) {
        if (p.alive) accel(p.pos.x, p.pos.y, p.pos.z, src, p.acc);
      });
    }
  }

  /**
   * Launch a body with real mass (mu in AU³/day², radius in AU). Promotes
   * the system on first use. pos/vel arrive heliocentric like every launch.
   */
  function addMassive(pos, vel, opts) {
    promote(ORRERY.TimeBar.jd);
    var sun = promoted.bodies[0];
    var b = {
      key: 'massive' + (mid++), label: opts.label || 'massive body',
      massive: true, mu: opts.mu, radius: opts.radius || 1e-5,
      color: opts.color,
      pos: { x: pos.x + sun.pos.x, y: pos.y + sun.pos.y, z: pos.z + sun.pos.z },
      vel: { x: vel.x + sun.vel.x, y: vel.y + sun.vel.y, z: vel.z + sun.vel.z },
      acc: { x: 0, y: 0, z: 0 }, ox: 0, oy: 0, oz: 0,
      alive: true, status: 'orbiting',
      minR: Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z)
    };
    promoted.bodies.push(b);
    massive.push(b);
    computeAccels(promoted.bodies);
    return b;
  }

  /** Remove a massive body (sandbox eviction). The system stays promoted. */
  function removeMassive(b) {
    b.alive = false;
    var i = massive.indexOf(b);
    if (i !== -1) massive.splice(i, 1);
    if (promoted) {
      i = promoted.bodies.indexOf(b);
      if (i !== -1) promoted.bodies.splice(i, 1);
      computeAccels(promoted.bodies);
    }
  }

  function addParticlePromoted(pos, vel, color) {
    var sun = promoted.bodies[0];
    var p = {
      pos: { x: pos.x + sun.pos.x, y: pos.y + sun.pos.y, z: pos.z + sun.pos.z },
      vel: { x: vel.x + sun.vel.x, y: vel.y + sun.vel.y, z: vel.z + sun.vel.z },
      acc: { x: 0, y: 0, z: 0 },
      color: color,
      alive: true,
      status: 'orbiting',
      burns: null,
      minR: Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z)
    };
    accelInertial(p.pos.x, p.pos.y, p.pos.z, promoted.bodies, p.acc);
    particles.push(p);
    return p;
  }

  /** Heliocentric view of any particle or body owned by this module. */
  function helioOf(p, out) {
    out = out || { x: 0, y: 0, z: 0 };
    if (promoted) {
      var s = promoted.bodies[0];
      out.x = p.pos.x - s.pos.x; out.y = p.pos.y - s.pos.y; out.z = p.pos.z - s.pos.z;
    } else {
      out.x = p.pos.x; out.y = p.pos.y; out.z = p.pos.z;
    }
    return out;
  }

  /** Heliocentric AU position of a promoted planet, or null when on rails. */
  function planetHelioAU(key, out) {
    if (!promoted) return null;
    for (var i = 1; i < promoted.bodies.length; i++) {
      var b = promoted.bodies[i];
      if (b.key === key) {
        out = helioOf(b, out);
        out.alive = b.alive;
        return out;
      }
    }
    return null;
  }

  /** Inertial-frame gravity from every alive body — no indirect term. */
  function accelInertial(px, py, pz, bodies, out) {
    var ax = 0, ay = 0, az = 0;
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (!b.alive) continue;
      var dx = b.pos.x - px, dy = b.pos.y - py, dz = b.pos.z - pz;
      var d2 = dx * dx + dy * dy + dz * dz + SOFT2;
      var di = b.mu / (d2 * Math.sqrt(d2));
      ax += dx * di; ay += dy * di; az += dz * di;
    }
    out.x = ax; out.y = ay; out.z = az;
  }

  /** Mutual accelerations, pairwise-symmetric so momentum is exact. */
  function computeAccels(bodies) {
    var i, j;
    for (i = 0; i < bodies.length; i++) {
      bodies[i].acc.x = 0; bodies[i].acc.y = 0; bodies[i].acc.z = 0;
    }
    for (i = 0; i < bodies.length; i++) {
      var a = bodies[i];
      if (!a.alive) continue;
      for (j = i + 1; j < bodies.length; j++) {
        var b = bodies[j];
        if (!b.alive) continue;
        var dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z;
        var d2 = dx * dx + dy * dy + dz * dz + SOFT2_B;
        var inv = 1 / (d2 * Math.sqrt(d2));
        var fb = b.mu * inv, fa = a.mu * inv;
        a.acc.x += dx * fb; a.acc.y += dy * fb; a.acc.z += dz * fb;
        b.acc.x -= dx * fa; b.acc.y -= dy * fa; b.acc.z -= dz * fa;
      }
    }
  }

  /** Global substep: 0.08× the tightest pair's dynamical time, capped. */
  function chooseH(bodies) {
    var h = H_CAP;
    for (var i = 0; i < bodies.length; i++) {
      var a = bodies[i];
      if (!a.alive) continue;
      for (var j = i + 1; j < bodies.length; j++) {
        var b = bodies[j];
        if (!b.alive) continue;
        var dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z;
        var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var t = 0.08 * Math.sqrt(d * d * d / (a.mu + b.mu));
        if (t < h) h = t;
      }
    }
    return h < H_MIN ? H_MIN : h;
  }

  /** Squared closest approach of segment A→B to the origin. */
  function segMinD2(ax, ay, az, bx, by, bz) {
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var l2 = dx * dx + dy * dy + dz * dz;
    var t = l2 > 0 ? -(ax * dx + ay * dy + az * dz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + t * dx, cy = ay + t * dy, cz = az + t * dz;
    return cx * cx + cy * cy + cz * cz;
  }

  /** Inelastic, momentum-conserving merge of the lighter body into the heavier. */
  function mergeBodies(bodies, i, j, silent) {
    var big = bodies[i].mu >= bodies[j].mu ? bodies[i] : bodies[j];
    var small = big === bodies[i] ? bodies[j] : bodies[i];
    var tot = big.mu + small.mu;
    big.vel.x = (big.mu * big.vel.x + small.mu * small.vel.x) / tot;
    big.vel.y = (big.mu * big.vel.y + small.mu * small.vel.y) / tot;
    big.vel.z = (big.mu * big.vel.z + small.mu * small.vel.z) / tot;
    big.pos.x = (big.mu * big.pos.x + small.mu * small.pos.x) / tot;
    big.pos.y = (big.mu * big.pos.y + small.mu * small.pos.y) / tot;
    big.pos.z = (big.mu * big.pos.z + small.mu * small.pos.z) / tot;
    big.mu = tot;
    if (small.radius > big.radius) big.radius = small.radius;
    small.alive = false;
    small.status = big.key === 'sun' ? 'sun' : 'merged';
    small.mergedInto = big;
    if (!silent) {
      pushEvent(big.key === 'sun'
        ? small.label + ' fell into the Sun'
        : small.label + ' merged with ' + big.label);
    }
  }

  /** One shared-h leapfrog step for all bodies + swept merge/escape checks. */
  function bodyStep(bodies, h, silent) {
    var i, j, b;
    for (i = 0; i < bodies.length; i++) {
      b = bodies[i];
      if (!b.alive) continue;
      b.ox = b.pos.x; b.oy = b.pos.y; b.oz = b.pos.z;
      b.vel.x += 0.5 * h * b.acc.x;
      b.vel.y += 0.5 * h * b.acc.y;
      b.vel.z += 0.5 * h * b.acc.z;
      b.pos.x += h * b.vel.x;
      b.pos.y += h * b.vel.y;
      b.pos.z += h * b.vel.z;
    }
    computeAccels(bodies);
    for (i = 0; i < bodies.length; i++) {
      b = bodies[i];
      if (!b.alive) continue;
      b.vel.x += 0.5 * h * b.acc.x;
      b.vel.y += 0.5 * h * b.acc.y;
      b.vel.z += 0.5 * h * b.acc.z;
    }
    // Swept collisions: relative segment vs summed radii, so a 30 km/s
    // impactor cannot tunnel through its target between substeps
    var hit = false;
    for (i = 0; i < bodies.length; i++) {
      var a = bodies[i];
      if (!a.alive) continue;
      for (j = i + 1; j < bodies.length; j++) {
        b = bodies[j];
        if (!b.alive) continue;
        var rr = a.radius + b.radius;
        if (segMinD2(a.ox - b.ox, a.oy - b.oy, a.oz - b.oz,
          a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z) < rr * rr) {
          mergeBodies(bodies, i, j, silent);
          hit = true;
        }
      }
    }
    // Escape: measured from the (moving) Sun
    var sun = bodies[0];
    for (i = 1; i < bodies.length; i++) {
      b = bodies[i];
      if (!b.alive) continue;
      var dx = b.pos.x - sun.pos.x, dy = b.pos.y - sun.pos.y, dz = b.pos.z - sun.pos.z;
      if (dx * dx + dy * dy + dz * dz > PROMOTED_ESCAPE_R * PROMOTED_ESCAPE_R) {
        b.alive = false;
        b.status = 'escaped';
        if (!silent) pushEvent(b.label + ' left the solar system');
        hit = true;
      }
    }
    if (hit) computeAccels(bodies);
  }

  /**
   * Advance one massless particle by h against bodies frozen at their
   * post-substep positions — the same frozen-source trick as advance(),
   * with the near-source refinement extended to sun + massive bodies.
   */
  function advancePromoted(p, h, bodies) {
    var sun = bodies[0];
    var remaining = h, guard = 0;
    while (remaining !== 0 && p.alive && guard++ < 500) {
      var hMax = 1e9;
      for (var i = 0; i < bodies.length; i++) {
        var b = bodies[i];
        if (!b.alive || (i > 0 && !b.massive)) continue;
        var dx = p.pos.x - b.pos.x, dy = p.pos.y - b.pos.y, dz = p.pos.z - b.pos.z;
        var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var t = 0.08 * Math.sqrt(d * d * d / b.mu);
        if (t < hMax) hMax = t;
      }
      hMax += 1e-4;
      var hl = remaining;
      if (Math.abs(hl) > hMax) hl = remaining > 0 ? hMax : -hMax;

      var ox = p.pos.x, oy = p.pos.y, oz = p.pos.z;
      p.vel.x += 0.5 * hl * p.acc.x;
      p.vel.y += 0.5 * hl * p.acc.y;
      p.vel.z += 0.5 * hl * p.acc.z;
      p.pos.x += hl * p.vel.x;
      p.pos.y += hl * p.vel.y;
      p.pos.z += hl * p.vel.z;
      accelInertial(p.pos.x, p.pos.y, p.pos.z, bodies, stepAcc);
      p.vel.x += 0.5 * hl * stepAcc.x;
      p.vel.y += 0.5 * hl * stepAcc.y;
      p.vel.z += 0.5 * hl * stepAcc.z;
      p.acc.x = stepAcc.x; p.acc.y = stepAcc.y; p.acc.z = stepAcc.z;

      // Deaths: the Sun's kill sphere and massive-body surfaces, both swept
      if (segMinD2(ox - sun.pos.x, oy - sun.pos.y, oz - sun.pos.z,
        p.pos.x - sun.pos.x, p.pos.y - sun.pos.y, p.pos.z - sun.pos.z) < SUN_R * SUN_R) {
        p.alive = false; p.status = 'sun'; lost.sun++;
      } else {
        for (i = 0; i < massive.length; i++) {
          var m = massive[i];
          if (!m.alive) continue;
          if (segMinD2(ox - m.ox, oy - m.oy, oz - m.oz,
            p.pos.x - m.pos.x, p.pos.y - m.pos.y, p.pos.z - m.pos.z) < m.radius * m.radius) {
            p.alive = false; p.status = 'impact'; lost.impact++;
            break;
          }
        }
        if (p.alive) {
          var rx = p.pos.x - sun.pos.x, ry = p.pos.y - sun.pos.y, rz = p.pos.z - sun.pos.z;
          var r2 = rx * rx + ry * ry + rz * rz;
          var rNow = Math.sqrt(r2);
          if (rNow < p.minR) p.minR = rNow;
          if (r2 > PROMOTED_ESCAPE_R * PROMOTED_ESCAPE_R) {
            p.alive = false; p.status = 'escaped'; lost.escaped++;
          }
        }
      }
      remaining -= hl;
    }
  }

  /** Advance the whole promoted system by dDays within the substep budget. */
  function stepPromoted(dDays) {
    if (dDays === 0) return;
    if (Math.abs(dDays) > 30) return; // same time-teleport guard as rails
    var bodies = promoted.bodies;
    var remaining = dDays, guard = 0;
    while (remaining !== 0 && guard++ < MAX_PSUB) {
      var h = chooseH(bodies);
      var hl = remaining > 0 ? Math.min(h, remaining) : Math.max(-h, remaining);
      bodyStep(bodies, hl, false);
      for (var i = 0; i < particles.length; i++) {
        if (particles[i].alive) advancePromoted(particles[i], hl, bodies);
      }
      remaining -= hl;
    }
    // Budget exhausted mid-slice: drop the remainder and flag it, so the
    // sandbox can slow the clock instead of the physics silently degrading
    throttled = remaining !== 0;
  }

  /** Aiming preview in massive mode: every body frozen where it is now. */
  function previewPromoted(pos, vel, steps, h, every) {
    var bodies = promoted.bodies;
    var sun = bodies[0];
    var px = pos.x + sun.pos.x, py = pos.y + sun.pos.y, pz = pos.z + sun.pos.z;
    var vx = vel.x + sun.vel.x, vy = vel.y + sun.vel.y, vz = vel.z + sun.vel.z;
    var a = { x: 0, y: 0, z: 0 };
    accelInertial(px, py, pz, bodies, a);
    var out = [];
    var esc2 = PROMOTED_ESCAPE_R * PROMOTED_ESCAPE_R;
    for (var s = 0; s < steps; s++) {
      vx += 0.5 * h * a.x; vy += 0.5 * h * a.y; vz += 0.5 * h * a.z;
      px += h * vx; py += h * vy; pz += h * vz;
      accelInertial(px, py, pz, bodies, a);
      vx += 0.5 * h * a.x; vy += 0.5 * h * a.y; vz += 0.5 * h * a.z;
      if (s % every === 0) out.push({ x: px - sun.pos.x, y: py - sun.pos.y, z: pz - sun.pos.z });
      var rx = px - sun.pos.x, ry = py - sun.pos.y, rz = pz - sun.pos.z;
      var r2 = rx * rx + ry * ry + rz * rz;
      if (r2 < SUN_R * SUN_R || r2 > esc2) break;
    }
    return out;
  }

  /**
   * Forward prediction of a promoted body's closest approach to a planet —
   * the kinetic-impactor scenario's miss-distance readout. Clones the whole
   * promoted system (merges included, so a launched impactor's deflection
   * shows up immediately) and integrates up to `days` ahead.
   */
  function predictApproach(bodyRef, planetKey, days) {
    if (!promoted) return null;
    var clones = promoted.bodies.map(function (b) {
      return {
        key: b.key, label: b.label, massive: b.massive, planet: b.planet,
        mu: b.mu, radius: b.radius,
        pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
        vel: { x: b.vel.x, y: b.vel.y, z: b.vel.z },
        acc: { x: b.acc.x, y: b.acc.y, z: b.acc.z },
        ox: 0, oy: 0, oz: 0,
        alive: b.alive, status: b.status, src: b
      };
    });
    var target = null, planet = null;
    clones.forEach(function (c) {
      if (c.src === bodyRef) target = c;
      if (c.key === planetKey) planet = c;
    });
    if (!target || !planet || !target.alive) return null;
    var best = { d: 1e9, t: 0, impact: false };
    var t = 0, guard = 0;
    while (t < days && guard++ < 40000) {
      var h = Math.min(chooseH(clones), days - t);
      bodyStep(clones, h, true);
      t += h;
      if (!target.alive) {
        // The asteroid merged into something. Into the planet = impact.
        best.impact = target.mergedInto === planet;
        if (best.impact) { best.d = 0; best.t = t; }
        break;
      }
      var dx = target.pos.x - planet.pos.x, dy = target.pos.y - planet.pos.y, dz = target.pos.z - planet.pos.z;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < best.d) { best.d = d; best.t = t; }
    }
    return best;
  }

  // Conserved-quantity readouts for tests and measurement scans
  function systemEnergy(bodies) {
    bodies = bodies || (promoted && promoted.bodies);
    var E = 0, i, j;
    for (i = 0; i < bodies.length; i++) {
      var a = bodies[i];
      if (!a.alive) continue;
      E += 0.5 * a.mu * (a.vel.x * a.vel.x + a.vel.y * a.vel.y + a.vel.z * a.vel.z);
      for (j = i + 1; j < bodies.length; j++) {
        var b = bodies[j];
        if (!b.alive) continue;
        var dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z;
        E -= a.mu * b.mu / Math.sqrt(dx * dx + dy * dy + dz * dz + SOFT2_B);
      }
    }
    return E;
  }

  function systemMomentum(bodies) {
    bodies = bodies || (promoted && promoted.bodies);
    var p = { x: 0, y: 0, z: 0 };
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (!b.alive) continue;
      p.x += b.mu * b.vel.x; p.y += b.mu * b.vel.y; p.z += b.mu * b.vel.z;
    }
    return p;
  }

  function remove(p) {
    if (p && p.massive) return removeMassive(p);
    var i = particles.indexOf(p);
    if (i !== -1) particles.splice(i, 1);
  }

  function clear() {
    if (promoted) restore();
    particles.length = 0;
    lost.sun = 0;
    lost.escaped = 0;
    lost.impact = 0;
  }

  return {
    MU: MU,
    KMS_PER_AUDAY: KMS_PER_AUDAY,
    particles: particles,
    lost: lost,
    addParticle: addParticle,
    step: step,
    preview: preview,
    previewLive: previewLive,
    energy: energy,
    relPlanet: relPlanet,
    remove: remove,
    clear: clear,
    // Massive mode (level 20)
    addMassive: addMassive,
    restore: restore,
    helioOf: helioOf,
    planetHelioAU: planetHelioAU,
    predictApproach: predictApproach,
    massive: massive,
    events: events,
    get promoted() { return !!promoted; },
    get throttled() { return throttled; },
    _dev: {
      promote: promote,
      systemEnergy: systemEnergy,
      systemMomentum: systemMomentum,
      chooseH: chooseH,
      bodies: function () { return promoted && promoted.bodies; },
      setHCap: function (h) { H_CAP = h; },
      getHCap: function () { return H_CAP; }
    }
  };
})();
