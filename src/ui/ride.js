/**
 * ride.js — Ride-along camera: fly WITH a body instead of watching it.
 *
 * While riding, OrbitControls is suspended and the camera sits just behind
 * the body along its direction of motion, looking ahead — Jupiter swelling
 * from a dot to a wall during the Voyager flyby, or Halley's tail streaming
 * past at perihelion. Scroll adjusts the chase distance, Esc (or the Exit
 * button) hands the camera back, and the ride ends itself if the body dies.
 *
 * Close flybys pass nearer than a planet's compressed mesh radius, so the
 * chase camera is pushed out of planet interiors rather than clipping
 * through the cloud tops.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Ride = (function () {
  'use strict';

  var camera, controls, canvas;
  var avoid = [];                    // { obj, radius } — sun + planets
  var active = false;
  var getPos = null, isAlive = null, onStop = null, onExitCam = null;
  var back = 8;
  var first = true;
  var els = {};

  var dir = new THREE.Vector3(1, 0, 0);
  var prev = new THREE.Vector3();
  var smoothTarget = new THREE.Vector3();
  var dCam = new THREE.Vector3(), dTar = new THREE.Vector3();
  var scratch = new THREE.Vector3();
  var UP = new THREE.Vector3(0, 1, 0);

  function init(opts) {
    camera = opts.camera;
    controls = opts.controls;
    canvas = opts.canvas;
    avoid = opts.avoid || [];
    onExitCam = opts.onExitCam || null;

    els.hud = document.getElementById('ride-hud');
    els.label = document.getElementById('ride-label');
    document.getElementById('ride-exit').addEventListener('click', exit);

    window.addEventListener('keydown', function (e) {
      if (active && e.code === 'Escape') exit();
    });
    canvas.addEventListener('wheel', function (e) {
      if (!active) return;
      e.preventDefault();
      back *= Math.exp(e.deltaY * 0.0012);
      back = Math.max(2, Math.min(90, back));
    }, { passive: false });
  }

  /** opts: { label, getPos() → Vector3, isAlive()?, back?, onStart?, onStop? } */
  function start(opts) {
    if (active) exit();
    getPos = opts.getPos;
    isAlive = opts.isAlive || function () { return true; };
    onStop = opts.onStop || null;
    back = opts.back || 8;
    first = true;
    active = true;
    controls.enabled = false;
    if (opts.onStart) opts.onStart();
    ORRERY.Panel.close();
    els.label.textContent = 'Riding with ' + opts.label;
    els.hud.classList.add('show');
  }

  function tick(dt) {
    if (!active) return;
    if (!isAlive()) { exit(); return; }
    var p = getPos();
    if (first) {
      prev.copy(p);
      smoothTarget.copy(p);
      first = false;
    }
    scratch.copy(p).sub(prev);
    if (scratch.length() > 1e-4) dir.copy(scratch).normalize();
    prev.copy(p);

    dCam.copy(p).addScaledVector(dir, -back).addScaledVector(UP, back * 0.38);
    for (var i = 0; i < avoid.length; i++) {
      avoid[i].obj.getWorldPosition(scratch);
      var r = avoid[i].radius * 1.35;
      if (dCam.distanceTo(scratch) < r) {
        dCam.sub(scratch).setLength(r).add(scratch);
      }
    }

    var k = 1 - Math.exp(-dt * 5);
    camera.position.lerp(dCam, k);
    dTar.copy(p).addScaledVector(dir, back * 1.2);
    smoothTarget.lerp(dTar, k);
    camera.lookAt(smoothTarget);
  }

  function exit() {
    if (!active) return;
    active = false;
    controls.enabled = true;
    controls.target.copy(prev);   // resume orbiting from where the ride ended
    els.hud.classList.remove('show');
    if (onStop) onStop();
    onStop = null;
    if (onExitCam) onExitCam();
  }

  return {
    init: init,
    start: start,
    tick: tick,
    exit: exit,
    get active() { return active; }
  };
})();
