/**
 * textures.js — Procedural planet surfaces.
 *
 * Every texture is painted at runtime onto a canvas with horizontally
 * periodic value noise (so sphere seams are invisible). No image assets;
 * the whole solar system ships as code.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Textures = (function () {
  'use strict';

  var W = 512, H = 256;

  /** Horizontally periodic value-noise + fbm, seeded. */
  function makeNoise(seed) {
    function hash(x, y) {
      var s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
      return s - Math.floor(s);
    }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function noise(x, y, period) {
      var xi = Math.floor(x), yi = Math.floor(y);
      var xf = x - xi, yf = y - yi;
      var x0 = ((xi % period) + period) % period;
      var x1 = ((xi + 1) % period + period) % period;
      var a = hash(x0, yi), b = hash(x1, yi);
      var c = hash(x0, yi + 1), d = hash(x1, yi + 1);
      var u = smooth(xf), v = smooth(yf);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    function fbm(x, y, oct, period) {
      var v = 0, amp = 0.5, f = 1;
      for (var i = 0; i < oct; i++) {
        v += amp * noise(x * f, y * f, period * f);
        f *= 2; amp *= 0.5;
      }
      return v;
    }
    return { noise: noise, fbm: fbm };
  }

  function canvasTexture(paint) {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(W, H);
    paint(img.data);
    ctx.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  function px(data, i, r, g, b) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

  /** Paint per-pixel: cb(u, v, lat) → [r,g,b]. u wraps, lat in [-90, 90]. */
  function perPixel(cb) {
    return canvasTexture(function (data) {
      for (var y = 0; y < H; y++) {
        var v = y / H;
        var lat = 90 - v * 180;
        for (var x = 0; x < W; x++) {
          var rgb = cb(x / W, v, lat);
          px(data, (y * W + x) * 4, rgb[0], rgb[1], rgb[2]);
        }
      }
    });
  }

  // ---- Cratered grey worlds (Mercury) -------------------------------------
  function cratered(seed, base, dark) {
    var n = makeNoise(seed);
    var craters = [];
    var rng = makeNoise(seed + 9);
    for (var i = 0; i < 90; i++) {
      craters.push({
        x: rng.noise(i * 13.7, 3.1, 997) * W,
        y: rng.noise(i * 7.3, 11.9, 997) * H,
        r: 2 + rng.noise(i * 3.1, 5.7, 997) * 11
      });
    }
    return perPixel(function (u, v) {
      var m = n.fbm(u * 8, v * 4, 5, 8);
      var t = 0.55 + (m - 0.5) * 0.9;
      var r = lerp(dark[0], base[0], t), g = lerp(dark[1], base[1], t), b = lerp(dark[2], base[2], t);
      var X = u * W, Y = v * H;
      for (var i = 0; i < craters.length; i++) {
        var c = craters[i];
        var dx = Math.min(Math.abs(X - c.x), W - Math.abs(X - c.x));
        var dy = Y - c.y;
        var d = Math.sqrt(dx * dx + dy * dy) / c.r;
        if (d < 1.15) {
          var shade = d < 0.85 ? -0.22 * (1 - d) : 0.18 * (1.15 - d);
          r += shade * 255; g += shade * 255; b += shade * 255;
        }
      }
      return [clamp01(r / 255) * 255, clamp01(g / 255) * 255, clamp01(b / 255) * 255];
    });
  }

  // ---- Banded gas giants ---------------------------------------------------
  function banded(seed, palette, turb, spot) {
    var n = makeNoise(seed);
    return perPixel(function (u, v) {
      var w = v + (n.fbm(u * 6, v * 14, 4, 6) - 0.5) * turb;
      var band = w * palette.length * 1.6 + 1.2 * Math.sin(w * 21 + seed);
      var i = ((Math.floor(band) % palette.length) + palette.length) % palette.length;
      var j = (i + 1) % palette.length;
      var f = band - Math.floor(band);
      f = f * f * (3 - 2 * f);
      var A = palette[i], B = palette[j];
      var r = lerp(A[0], B[0], f), g = lerp(A[1], B[1], f), b = lerp(A[2], B[2], f);
      var shade = (n.fbm(u * 18, v * 30, 3, 18) - 0.5) * 22;
      r += shade; g += shade; b += shade;
      if (spot) {
        var dx = Math.min(Math.abs(u - spot.u), 1 - Math.abs(u - spot.u)) / spot.w;
        var dy = (v - spot.v) / spot.h;
        var d = dx * dx + dy * dy;
        if (d < 1) {
          var s = (1 - d) * (1 - d);
          r = lerp(r, spot.rgb[0], s); g = lerp(g, spot.rgb[1], s); b = lerp(b, spot.rgb[2], s);
        }
      }
      return [r, g, b];
    });
  }

  // ---- Individual worlds ---------------------------------------------------
  var builders = {

    mercury: function () {
      return cratered(11, [190, 183, 176], [96, 91, 88]);
    },

    venus: function () {
      var n = makeNoise(23);
      return perPixel(function (u, v) {
        var swirl = n.fbm(u * 5 + n.fbm(u * 3, v * 3, 3, 3) * 1.5, v * 8, 5, 5);
        var t = clamp01(0.35 + swirl * 0.75);
        return [lerp(196, 240, t), lerp(158, 214, t), lerp(106, 160, t)];
      });
    },

    earth: function () {
      var n = makeNoise(42);
      return perPixel(function (u, v, lat) {
        var m = n.fbm(u * 5, v * 2.6, 6, 5);
        var polar = Math.abs(lat) - 68 + n.fbm(u * 9, v * 4, 3, 9) * 10;
        if (polar > 0) return [235, 241, 246];
        if (m > 0.52) { // land
          var h = n.fbm(u * 11 + 40, v * 6, 4, 11);
          var green = [72, 110, 58], sand = [168, 148, 96], rock = [116, 96, 72];
          var warm = clamp01(1 - Math.abs(lat) / 60);
          var r = lerp(rock[0], lerp(green[0], sand[0], clamp01(h * 1.6 - 0.4)), warm);
          var g = lerp(rock[1], lerp(green[1], sand[1], clamp01(h * 1.6 - 0.4)), warm);
          var b = lerp(rock[2], lerp(green[2], sand[2], clamp01(h * 1.6 - 0.4)), warm);
          return [r, g, b];
        }
        var depth = clamp01((0.52 - m) * 4);
        var cloud = n.fbm(u * 7 + 90, v * 5, 4, 7);
        var r = lerp(38, 12, depth), g = lerp(92, 48, depth), b = lerp(148, 110, depth);
        if (cloud > 0.60) {
          var cw = clamp01((cloud - 0.60) * 5);
          r = lerp(r, 236, cw); g = lerp(g, 240, cw); b = lerp(b, 244, cw);
        }
        return [r, g, b];
      });
    },

    mars: function () {
      var n = makeNoise(7);
      return perPixel(function (u, v, lat) {
        var m = n.fbm(u * 6, v * 3, 5, 6);
        var t = 0.4 + m * 0.7;
        var r = lerp(120, 205, t), g = lerp(58, 118, t), b = lerp(36, 74, t);
        var dark = n.fbm(u * 4 + 30, v * 2.4, 4, 4);
        if (dark > 0.58) { var d = (dark - 0.58) * 2.4; r -= d * 70; g -= d * 42; b -= d * 26; }
        var cap = Math.abs(lat) - 76 + n.fbm(u * 8, v * 4, 3, 8) * 6;
        if (cap > 0) return [232, 226, 220];
        return [r, g, b];
      });
    },

    jupiter: function () {
      return banded(5, [
        [206, 178, 138], [166, 128, 92], [226, 210, 184],
        [186, 142, 100], [214, 190, 158], [150, 110, 82]
      ], 0.05, { u: 0.30, v: 0.66, w: 0.075, h: 0.055, rgb: [188, 92, 58] });
    },

    saturn: function () {
      return banded(15, [
        [222, 200, 158], [206, 180, 136], [232, 214, 176],
        [214, 192, 150], [226, 206, 166]
      ], 0.03, null);
    },

    uranus: function () {
      var n = makeNoise(31);
      return perPixel(function (u, v) {
        var m = n.fbm(u * 3, v * 6, 3, 3);
        var t = 0.5 + (m - 0.5) * 0.3;
        return [lerp(140, 172, t), lerp(200, 224, t), lerp(206, 226, t)];
      });
    },

    neptune: function () {
      var n = makeNoise(63);
      return perPixel(function (u, v) {
        var m = n.fbm(u * 4, v * 8, 4, 4);
        var t = 0.5 + (m - 0.5) * 0.55;
        var r = lerp(38, 92, t), g = lerp(74, 132, t), b = lerp(178, 226, t);
        var dx = Math.min(Math.abs(u - 0.62), 1 - Math.abs(u - 0.62)) / 0.06;
        var dy = (v - 0.62) / 0.045;
        var d = dx * dx + dy * dy;
        if (d < 1) { var s = (1 - d); r = lerp(r, 24, s); g = lerp(g, 44, s); b = lerp(b, 120, s); }
        return [r, g, b];
      });
    },

    pluto: function () {
      var n = makeNoise(77);
      return perPixel(function (u, v) {
        var m = n.fbm(u * 5, v * 3, 5, 5);
        var t = 0.35 + m * 0.8;
        var r = lerp(122, 214, t), g = lerp(100, 190, t), b = lerp(84, 168, t);
        // Sputnik Planitia — the bright heart
        var dx = Math.min(Math.abs(u - 0.5), 1 - Math.abs(u - 0.5)) / 0.09;
        var dy = (v - 0.48) / 0.13;
        var d = dx * dx + dy * dy;
        if (d < 1) { var s = (1 - d) * 0.9; r = lerp(r, 238, s); g = lerp(g, 230, s); b = lerp(b, 216, s); }
        return [r, g, b];
      });
    },

    sun: function () {
      var n = makeNoise(3);
      return perPixel(function (u, v) {
        var g = n.fbm(u * 14, v * 14, 5, 14);
        var t = 0.45 + g * 0.85;
        return [
          clamp01(t * 1.15) * 255,
          clamp01(t * 0.78) * 255,
          clamp01(t * 0.38) * 255
        ];
      });
    }
  };

  /** Saturn's rings: radial band structure with the Cassini division. */
  function ringTexture() {
    var w = 1024, h = 16;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    var n = makeNoise(51);
    for (var x = 0; x < w; x++) {
      var t = x / w;
      var a = 0.75 * (0.55 + 0.45 * n.fbm(t * 60, 0.5, 4, 60));
      if (t < 0.06) a *= t / 0.06;                       // inner fade (D ring)
      if (t > 0.60 && t < 0.67) a *= 0.12;               // Cassini division
      if (t > 0.94) a *= (1 - t) / 0.06;                 // outer fade
      var bright = 190 + n.fbm(t * 90, 0.2, 3, 90) * 55;
      ctx.fillStyle = 'rgba(' + Math.round(bright) + ',' + Math.round(bright * 0.94) + ',' +
        Math.round(bright * 0.82) + ',' + a.toFixed(3) + ')';
      ctx.fillRect(x, 0, 1, h);
    }
    return new THREE.CanvasTexture(c);
  }

  /** Soft radial glow sprite (for the Sun's corona and bloom). */
  function glowSprite(inner, outer) {
    var s = 256;
    var c = document.createElement('canvas');
    c.width = s; c.height = s;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.25, outer);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
  }

  return {
    build: function (key) { return builders[key](); },
    ringTexture: ringTexture,
    glowSprite: glowSprite
  };
})();
