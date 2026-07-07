/**
 * camerapath.js — ORRERY.CameraPath: the one camera-flight primitive.
 *
 * Every scripted camera move in the orrery is a "flight": a keyframed
 * position (optionally orbit-target) path played over a fixed duration
 * with an easing curve. Focusing a body, flying home, tour stop
 * transitions and the cosmic-zoom exit restore all ride this module;
 * before it existed each of them carried its own tween state.
 *
 * Ownership rule — exactly ONE flight is active at a time:
 * - begin() silently replaces any previous flight; the loser's onArrive
 *   never fires. Whoever most recently claimed the camera wins.
 * - Modes that own the camera outright suspend or cancel flights at their
 *   boundaries: main.js does not tick CameraPath while Ride is active
 *   (a flight begun mid-ride stays frozen), and Ride/Cosmos call cancel()
 *   at the exact points where they used to zero the main.js tween.
 * - Ride's continuous chase is NOT a flight: it follows a moving target
 *   every frame with its own exponential smoothing. Only its boundary
 *   cancellations go through here.
 *
 * The orbit-controls target normally stays under the caller's control
 * (main.js's follow lerp keeps it glued to the selected body); a flight
 * only drives it when a key carries an explicit `target`.
 *
 * Reduced motion, `instant: true`, or a non-positive duration apply the
 * final key immediately and fire onArrive synchronously from begin() —
 * the tween is a courtesy, never load-bearing.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.CameraPath = (function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DEFAULT_DURATION = 1.6;                            // the classic focus flight
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  var camera = null, controls = null;
  var flight = null;   // { keys, hasTarget, duration, ease, onArrive, t }

  function init(opts) {
    camera = opts.camera;
    controls = opts.controls;
  }

  /**
   * Start a flight from the camera's current position.
   *
   * spec:
   *   to        Vector3 — destination (shorthand for keys: [{ pos: to }])
   *   keys      [{ pos: Vector3, target?: Vector3 }] — waypoints flown in
   *             order, equal time per segment; all vectors are cloned
   *   duration  seconds (default 1.6)
   *   ease      t → [0, 1] (default cubic ease-out, 1 − (1 − t)³)
   *   instant   true → snap to the final key now (reduced motion implies it)
   *   onArrive  called once on completion; never on cancel/replace
   */
  function begin(spec) {
    flight = null;   // ownership rule: a new flight replaces the old, no callback
    var keys = (spec.keys || [{ pos: spec.to, target: spec.target }]).map(function (k) {
      return { pos: k.pos.clone(), target: k.target ? k.target.clone() : null };
    });
    var hasTarget = keys.some(function (k) { return !!k.target; });
    keys.unshift({
      pos: camera.position.clone(),
      target: hasTarget ? controls.target.clone() : null
    });
    // Forward-fill missing targets so every segment can interpolate
    if (hasTarget) {
      for (var i = 1; i < keys.length; i++) {
        if (!keys[i].target) keys[i].target = keys[i - 1].target;
      }
    }
    var duration = spec.duration === undefined ? DEFAULT_DURATION : spec.duration;
    if (reducedMotion || spec.instant || duration <= 0) {
      applyKeys(keys, 1, hasTarget);
      if (spec.onArrive) spec.onArrive();
      return;
    }
    flight = {
      keys: keys, hasTarget: hasTarget, duration: duration,
      ease: spec.ease || easeOutCubic, onArrive: spec.onArrive || null, t: 0
    };
  }

  /** Place camera (and target track, if any) at eased progress e ∈ [0, 1]. */
  function applyKeys(keys, e, hasTarget) {
    var segs = keys.length - 1;
    var x = Math.min(e, 1) * segs;
    var i = Math.min(segs - 1, Math.floor(x));
    var f = x - i;
    camera.position.lerpVectors(keys[i].pos, keys[i + 1].pos, f);
    if (hasTarget) controls.target.lerpVectors(keys[i].target, keys[i + 1].target, f);
  }

  /** Drop the active flight without completing it (onArrive does not fire). */
  function cancel() {
    flight = null;
  }

  function isActive() {
    return flight !== null;
  }

  /** Advance the active flight; called once per frame from the main loop. */
  function tick(dt) {
    if (!flight) return;
    flight.t = Math.min(1, flight.t + dt / flight.duration);
    applyKeys(flight.keys, flight.ease(flight.t), flight.hasTarget);
    if (flight.t >= 1) {
      var done = flight;
      flight = null;
      if (done.onArrive) done.onArrive();
    }
  }

  return {
    init: init,
    begin: begin,
    cancel: cancel,
    isActive: isActive,
    tick: tick,
    /** Headless-verification hook (camera/controls are main.js locals) — not UI API. */
    pose: function () {
      return { position: camera.position.toArray(), target: controls.target.toArray() };
    }
  };
})();
