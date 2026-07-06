#!/usr/bin/env node
/**
 * check-screenshot.js — Assert a headless-Chrome smoke screenshot actually
 * rendered a scene (the classic failure mode is a pitch-black canvas when
 * WebGL fell back wrong — see CLAUDE.md "Verification").
 *
 * Zero-dependency PNG decode: parse chunks, inflate IDAT with node's zlib,
 * unfilter scanlines, then sample pixels. Passes when a meaningful fraction
 * of sampled pixels are lit (starfield + Sun + UI chrome ≫ threshold).
 *
 * Usage: node test/ci/check-screenshot.js <screenshot.png>
 */
'use strict';

const fs = require('fs');
const zlib = require('zlib');

function die(msg) {
  console.error('screenshot check FAILED: ' + msg);
  process.exit(1);
}

const file = process.argv[2];
if (!file) die('usage: node check-screenshot.js <png>');
if (!fs.existsSync(file)) die(file + ' does not exist');
const buf = fs.readFileSync(file);

// Belt and braces: a black 1600×1000 PNG compresses to a few KB
if (buf.length < 30000) die('file only ' + buf.length + ' bytes — near-empty frame');

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
for (let i = 0; i < 8; i++) {
  if (buf[i] !== SIG[i]) die('not a PNG (bad signature)');
}

// ---- Chunk walk ---------------------------------------------------------------
let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
const idat = [];
let off = 8;
while (off + 8 <= buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.slice(off + 8, off + 8 + len);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
    interlace = data[12];
  } else if (type === 'IDAT') {
    idat.push(data);
  } else if (type === 'IEND') {
    break;
  }
  off += 12 + len;
}

if (!width || !height) die('no IHDR found');
console.log('png: ' + width + 'x' + height + ', depth ' + bitDepth +
  ', colorType ' + colorType + ', ' + buf.length + ' bytes');
if (width < 800 || height < 500) die('unexpectedly small viewport');
if (bitDepth !== 8 || interlace !== 0) {
  die('unsupported PNG layout (depth ' + bitDepth + ', interlace ' + interlace + ')');
}
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
if (!CHANNELS) die('unsupported color type ' + colorType);

// ---- Inflate + unfilter -------------------------------------------------------
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = width * CHANNELS;
if (raw.length < (stride + 1) * height) die('truncated pixel data');

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

const px = Buffer.alloc(stride * height);
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)];
  const rowIn = (stride + 1) * y + 1;
  const rowOut = stride * y;
  for (let x = 0; x < stride; x++) {
    const cur = raw[rowIn + x];
    const left = x >= CHANNELS ? px[rowOut + x - CHANNELS] : 0;
    const up = y > 0 ? px[rowOut - stride + x] : 0;
    const upLeft = (y > 0 && x >= CHANNELS) ? px[rowOut - stride + x - CHANNELS] : 0;
    let v;
    switch (filter) {
      case 0: v = cur; break;
      case 1: v = cur + left; break;
      case 2: v = cur + up; break;
      case 3: v = cur + ((left + up) >> 1); break;
      case 4: v = cur + paeth(left, up, upLeft); break;
      default: die('bad filter byte ' + filter + ' on row ' + y);
    }
    px[rowOut + x] = v & 0xff;
  }
}

// ---- Sample the canvas band ----------------------------------------------------
// The failure mode to catch is a black WebGL canvas with the DOM UI still
// drawn — so sampling the whole frame is fooled by nav buttons and the
// timebar. Sample only the central band (rows 15%–82%: below the header,
// above the timebar), where a real render shows the starfield + Sun in
// nearly every region and a dead canvas shows nothing at all.
// Calibrated on real captures: good render 10.2% lit / 95 of 96 cells;
// black canvas 0.00% lit / 0 cells.
const y0 = Math.floor(height * 0.15);
const y1 = Math.floor(height * 0.82);
const GX = 12, GY = 8;                       // coverage grid over the band
const cells = new Set();
let sampled = 0, lit = 0, bright = 0;
const nCol = colorType === 0 || colorType === 4 ? 1 : 3;
for (let y = y0; y < y1; y += 3) {
  for (let x = 0; x < width; x += 3) {
    const i = y * stride + x * CHANNELS;
    let v = 0;                               // luminance proxy: max color channel
    for (let c = 0; c < nCol; c++) v = Math.max(v, px[i + c]);
    sampled++;
    if (v > 16) {
      lit++;
      cells.add(Math.floor((y - y0) / (y1 - y0) * GY) * GX + Math.floor(x / width * GX));
    }
    if (v > 100) bright++;
  }
}

const litFrac = lit / sampled;
console.log('central band, ' + sampled + ' px sampled: lit(>16) ' +
  (litFrac * 100).toFixed(2) + '%, bright(>100) ' + ((bright / sampled) * 100).toFixed(3) +
  '%, star coverage ' + cells.size + '/' + (GX * GY) + ' cells');

if (litFrac < 0.02) die('canvas band is essentially black (' + (litFrac * 100).toFixed(2) + '% lit)');
if (cells.size < (GX * GY) / 2) {
  die('lit pixels are clustered (' + cells.size + '/' + (GX * GY) +
    ' cells) — looks like stray UI over a dead canvas, not a starfield');
}
if (bright === 0) die('no bright pixels in the scene — no Sun');
console.log('screenshot check OK — scene rendered');
