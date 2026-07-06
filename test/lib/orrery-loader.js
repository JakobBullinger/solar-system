/**
 * orrery-loader.js — Load the orrery's browser IIFE modules into plain Node.
 *
 * The app modules are ES5 IIFEs that hang themselves on `window.ORRERY` and
 * reference a handful of browser globals (THREE, document, location). This
 * loader evals each requested source file inside a fresh `vm` context whose
 * global object doubles as `window`, with minimal stubs — the same pattern
 * the offline voyager-search scripts used (see CLAUDE.md "Verification").
 *
 * Usage:
 *   const { load } = require('./lib/orrery-loader');
 *   const O = load(['data/bodies.js', 'physics/kepler.js', 'physics/nbody.js']);
 *   O.Kepler.heliocentric(...); O.NBody.step(...);
 *
 * Each load() call gets an isolated context, so module-level state
 * (NBody.particles, Challenge.incoming, ...) never leaks between tests.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

// ---- THREE stub -------------------------------------------------------------
// Just enough for modules that construct math objects at load time
// (sandbox.js). Physics modules only use THREE inside render-path functions
// the tests never call.
function makeTHREE() {
  function Vector3(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  Vector3.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
  Vector3.prototype.copy = function (v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; };
  Vector3.prototype.clone = function () { return new Vector3(this.x, this.y, this.z); };
  Vector3.prototype.length = function () {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  };
  Vector3.prototype.setScalar = function (s) { return this.set(s, s, s); };
  function Vector2(x, y) { this.x = x || 0; this.y = y || 0; }
  function Plane(normal, constant) { this.normal = normal; this.constant = constant || 0; }
  function Raycaster() { this.ray = { intersectPlane: function () { return null; } }; }
  Raycaster.prototype.setFromCamera = function () {};
  return { Vector3: Vector3, Vector2: Vector2, Plane: Plane, Raycaster: Raycaster };
}

// ---- DOM stub ---------------------------------------------------------------
// Elements record classes, children and innerHTML. Setting innerHTML spawns a
// stub child per class="..." occurrence, so code like challenge.js's banner
// (innerHTML then querySelector('.ch-text')) works and tests can read back
// what was written via findByClass().
function makeElement(tag) {
  let html = '';
  const el = {
    tagName: tag || 'div',
    children: [],
    className: '',
    style: {},
    dataset: {},
    textContent: '',
    title: '',
    value: '',
    classList: {
      _s: new Set(),
      add: function () { for (let i = 0; i < arguments.length; i++) this._s.add(arguments[i]); },
      remove: function () { for (let i = 0; i < arguments.length; i++) this._s.delete(arguments[i]); },
      toggle: function (c, on) {
        const want = on === undefined ? !this._s.has(c) : !!on;
        if (want) this._s.add(c); else this._s.delete(c);
      },
      contains: function (c) { return this._s.has(c); }
    },
    setAttribute: function () {},
    getAttribute: function () { return null; },
    addEventListener: function () {},
    removeEventListener: function () {},
    focus: function () {},
    select: function () {},
    appendChild: function (c) { this.children.push(c); return c; },
    removeChild: function (c) {
      const i = this.children.indexOf(c);
      if (i !== -1) this.children.splice(i, 1);
      return c;
    },
    querySelector: function (sel) {
      if (sel.charAt(0) === '.') return findByClass(el, sel.slice(1));
      return null;
    },
    querySelectorAll: function () { return []; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return html; },
    set: function (v) {
      html = v;
      el.children = el.children.filter(function (c) { return !c.__fromHTML; });
      const re = /class="([^"]+)"/g;
      let m;
      while ((m = re.exec(v)) !== null) {
        const child = makeElement('span');
        child.__fromHTML = true;
        m[1].split(/\s+/).forEach(function (cl) { child.classList.add(cl); });
        el.children.push(child);
      }
    }
  });
  return el;
}

function hasClass(el, cls) {
  return (el.classList && el.classList.contains(cls)) ||
    (typeof el.className === 'string' && el.className.split(/\s+/).indexOf(cls) !== -1);
}

/** Depth-first search of a stub-element tree for a class name. */
function findByClass(el, cls) {
  for (let i = 0; i < el.children.length; i++) {
    const c = el.children[i];
    if (hasClass(c, cls)) return c;
    const hit = findByClass(c, cls);
    if (hit) return hit;
  }
  return null;
}

function makeDocument() {
  const ids = {};
  return {
    body: makeElement('body'),
    createElement: function (t) { return makeElement(t); },
    getElementById: function (id) {
      if (!ids[id]) ids[id] = makeElement('div');
      return ids[id];
    },
    querySelectorAll: function () { return []; },
    addEventListener: function () {}
  };
}

// ---- Loader -----------------------------------------------------------------
/**
 * Evaluate src/ modules (paths relative to src/) in a fresh context.
 * opts:
 *   location — stub for window.location (challenge/permalink tests)
 *   document — a makeDocument() instance to inspect afterwards
 *   setup(ctx) — runs before any module evals; e.g. preset ctx.ORRERY.DATA
 *                with empty PLANETS for a pure two-body n-body context.
 * Returns the context's ORRERY namespace. A plain-data TimeBar stub
 * ({ jd, rate, playing }) is provided unless the real timebar was loaded.
 */
function load(modules, opts) {
  opts = opts || {};
  const ctx = {};
  ctx.window = ctx;                       // window.X === global X, like a browser
  ctx.console = console;
  ctx.THREE = makeTHREE();
  ctx.document = opts.document || makeDocument();
  ctx.location = opts.location || { search: '', hash: '', origin: 'https://orrery.test', pathname: '/' };
  ctx.navigator = {};
  ctx.URLSearchParams = URLSearchParams;
  ctx.history = { replaceState: function () {} };
  ctx.addEventListener = function () {};
  ctx.removeEventListener = function () {};
  ctx.requestAnimationFrame = function () { return 0; };
  ctx.cancelAnimationFrame = function () {};
  ctx.setTimeout = function () { return 0; };  // deferred UI work: never runs in tests
  ctx.clearTimeout = function () {};
  ctx.setInterval = function () { return 0; };
  ctx.clearInterval = function () {};
  vm.createContext(ctx);
  if (opts.setup) opts.setup(ctx);

  modules.forEach(function (rel) {
    const file = path.join(ROOT, 'src', rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: rel });
  });

  if (!ctx.ORRERY) throw new Error('no module attached to window.ORRERY');
  if (!ctx.ORRERY.TimeBar) ctx.ORRERY.TimeBar = { jd: 2451545.0, rate: 1, playing: false };
  return ctx.ORRERY;
}

/** Raw source text of a src/ module — for parsing baked constants. */
function readSource(rel) {
  return fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8');
}

module.exports = {
  load: load,
  readSource: readSource,
  makeDocument: makeDocument,
  makeElement: makeElement,
  findByClass: findByClass
};
